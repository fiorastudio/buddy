// scripts/reinject-harness.mjs
//
// Pure, dependency-free logic for the re-injection premise eval. The Anthropic
// call is injected (`callModel`) so this module is fully unit-testable without a
// key; the runner (reinject-eval.mjs) supplies the real SDK-backed callModel.
//
// The experiment isolates ONE thing: does re-presenting the extraction
// instruction in fresh context (near the decision point) restore the host's
// willingness to emit a claims call that decayed as the instruction drifted far
// away? Conditions:
//   A   — instruction only in the (far) system block; normal substantive turn
//   B   — A + the instruction re-injected into the final user turn (the nudge)
//   pos — instruction near + TINY context + substantive turn  → ceiling
//   neg — instruction near + TINY context + trivial turn      → floor
// pos/neg bracket the signal: trust A/B deltas only if pos is high AND neg low.

/** Claims/edges tool schema — mirrors the buddy_observe input in server/index.ts. */
export const CLAIMS_EDGES_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          basis: { type: 'string', enum: ['research', 'empirical', 'deduction', 'analogy', 'definition', 'convention', 'llm_output', 'assumption', 'vibes'] },
          speaker: { type: 'string', enum: ['user', 'assistant'] },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          external_id: { type: 'string' },
        },
        required: ['text', 'basis', 'speaker', 'confidence', 'external_id'],
      },
    },
    edges: { type: 'array', items: { type: 'object' } },
  },
  required: ['claims'],
};

/** Rough token estimate without a tokenizer dependency (~4 chars/token). */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Build a synthetic coding-dialogue context padded to ~targetTokens. Deterministic
 * (templated with index variation) so runs are reproducible and cacheable. The
 * filler is mundane on purpose — it must occupy context without itself being
 * substantive enough to trigger claim extraction.
 */
export function generateSyntheticContext(targetTokens) {
  const messages = [];
  let tokens = 0;
  let i = 0;
  while (tokens < targetTokens) {
    const userMsg =
      `Turn ${i}: can you tweak the ${['parser', 'logger', 'cache', 'router', 'serializer'][i % 5]} ` +
      `so it handles the ${['empty', 'unicode', 'nested', 'concurrent', 'malformed'][i % 5]} case? ` +
      `Here is the current code:\n` + `  const x${i} = compute(${i});\n`.repeat(40);
    const asstMsg =
      `Sure — here's an updated version for turn ${i}:\n` +
      `  function handle${i}(input) { return input.map(v => v + ${i}); }\n`.repeat(40) +
      `That should cover the ${['empty', 'unicode', 'nested', 'concurrent', 'malformed'][i % 5]} case.`;
    messages.push({ role: 'user', content: userMsg });
    messages.push({ role: 'assistant', content: asstMsg });
    tokens += estimateTokens(userMsg) + estimateTokens(asstMsg);
    i++;
  }
  return messages;
}

/**
 * Build context from REAL Claude Code transcript lines (JSONL). Extracts text of
 * user/assistant turns only (drops tool_use/tool_result for valid, clean
 * alternation), merges consecutive same-role turns, trims to start with user and
 * end with assistant, and stops once ~targetTokens is reached. Pure: takes an
 * array of line strings so it's unit-testable.
 */
/** Parse one JSONL line → {role, content:text} for a user/assistant TEXT turn, or null. */
export function entryText(line) {
  const trimmed = (line || '').trim();
  if (!trimmed) return null;
  let entry;
  try { entry = JSON.parse(trimmed); } catch { return null; }
  let role = entry.role;
  let content = entry.content;
  if (!role && entry.message?.role) { role = entry.message.role; content = entry.message.content; }
  if (role !== 'user' && role !== 'assistant') return null;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) text = content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
  text = text.trim();
  return text ? { role, content: text } : null;
}

export function parseTranscriptContext(lines, targetTokens) {
  const raw = [];
  let tokens = 0;
  for (const line of lines) {
    const turn = entryText(line);
    if (!turn) continue;
    raw.push(turn);
    tokens += estimateTokens(turn.content);
    if (tokens >= targetTokens) break;
  }
  // Merge consecutive same-role turns (Messages API requires alternation).
  const merged = [];
  for (const m of raw) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else merged.push({ ...m });
  }
  // Trim to start with user and end with assistant (the final A/B turn is user).
  while (merged.length && merged[0].role !== 'user') merged.shift();
  while (merged.length && merged[merged.length - 1].role !== 'assistant') merged.pop();
  return merged;
}

const SUBSTANTIVE_TURN =
  'I think we should switch the auth service to postgres — mysql is the bottleneck, ' +
  'and the OWASP cheat sheet says parameterized queries are mandatory. Do it.';
const TRIVIAL_TURN = 'thanks, looks good!';

/**
 * Final user turn for a condition. `instruction` is the EXTRACTION_INSTRUCTION
 * text; for the "near" conditions it's prepended to put it in fresh context.
 */
export function buildFinalTurn(condition, instruction) {
  switch (condition) {
    case 'A':   return { role: 'user', content: SUBSTANTIVE_TURN };
    // B = bare inline prefix (max salience, instruction reads as the user's words) → UPPER BOUND.
    case 'B':   return { role: 'user', content: `${instruction}\n\n${SUBSTANTIVE_TURN}` };
    // B' = instruction wrapped as a system-reminder block adjacent to the user turn, modeling how
    // Claude Code folds UserPromptSubmit hook stdout into context (the ACTUAL shipped placement).
    case 'Bprime': return { role: 'user', content: `<system-reminder>\n${instruction}\n</system-reminder>\n\n${SUBSTANTIVE_TURN}` };
    case 'pos': return { role: 'user', content: `${instruction}\n\n${SUBSTANTIVE_TURN}` };
    case 'neg': return { role: 'user', content: `${instruction}\n\n${TRIVIAL_TURN}` };
    default: throw new Error(`unknown condition: ${condition}`);
  }
}

/**
 * Stream a transcript file and return real context messages up to ~targetTokens.
 * Reads only the prefix it needs (early-break), so a multi-hundred-MB JSONL is
 * fine. Dynamic fs/readline import keeps the pure logic above dependency-free.
 */
export async function loadRealContext(path, targetTokens) {
  const { createReadStream } = await import('fs');
  const { createInterface } = await import('readline');
  const lines = [];
  let textTokens = 0;
  const rl = createInterface({ input: createReadStream(path, 'utf-8'), crlfDelay: Infinity });
  for await (const line of rl) {
    lines.push(line);
    const turn = entryText(line);            // count only real text-turn tokens
    if (turn) textTokens += estimateTokens(turn.content);
    if (textTokens >= targetTokens * 1.1) break; // headroom; parse trims to exact target
  }
  rl.close();
  return parseTranscriptContext(lines, targetTokens);
}

/**
 * Mark the last context message as the prompt-cache breakpoint. cache_control
 * must live on a CONTENT BLOCK, not on the message object — so the last message's
 * string content is converted to a single text block carrying cache_control.
 * (The API rejects cache_control placed directly on a message.)
 */
export function withCacheBreakpoint(context) {
  const out = context.slice();
  if (!out.length) return out;
  const last = out[out.length - 1];
  const text = typeof last.content === 'string' ? last.content : String(last.content);
  out[out.length - 1] = { role: last.role, content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }] };
  return out;
}

/** Did the model choose to emit a non-empty claims call? */
export function detectCompliance(response) {
  const content = response?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    b => b && b.type === 'tool_use' && b.name === 'buddy_observe' &&
         b.input && Array.isArray(b.input.claims) && b.input.claims.length > 0,
  );
}

/** Extract the emitted claims array from a buddy_observe tool_use, or null. */
export function extractClaims(response) {
  const block = response?.content?.find?.(b => b?.type === 'tool_use' && b.name === 'buddy_observe');
  return block?.input?.claims ?? null;
}

/** Concatenate text blocks of a model response. */
export function extractResponseText(response) {
  const content = response?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
}

/** The substantive-vs-trivial content of a cell's final turn (no instruction). */
export function finalTurnText(condition) {
  return condition === 'neg' ? TRIVIAL_TURN : SUBSTANTIVE_TURN;
}

/** Grader prompt: are the extracted claims SUBSTANTIVE or reflexive FILLER? */
export function buildGradePrompt(turnText, claims) {
  return `You audit a claim-extraction system. Judge whether the extracted claims are SUBSTANTIVE ` +
    `(they capture a meaningful assertion, decision, or piece of reasoning) or FILLER (vacuous, ` +
    `reflexive, or merely restating an acknowledgment like "thanks").\n\n` +
    `User's latest message: ${turnText}\n\n` +
    `Extracted claims: ${JSON.stringify(claims)}\n\n` +
    `Reply with exactly one word: SUBSTANTIVE or FILLER.`;
}

/** Parse a grader reply → true iff judged substantive. */
export function parseGrade(text) {
  return /\bsubstantive\b/i.test(text || '') && !/\bfiller\b/i.test(text || '');
}

/** True iff a claims call was made AND the grader judges the claims substantive. */
export async function isSubstantive(callGrader, turnText, claims) {
  if (!claims || !claims.length) return false;
  const resp = await callGrader(buildGradePrompt(turnText, claims));
  return parseGrade(extractResponseText(resp));
}

/** Quality classifier: compliance := emitted a call AND graded substantive. */
export function makeQualityClassifier(callGrader, turnText) {
  return async (resp) => detectCompliance(resp) && isSubstantive(callGrader, turnText, extractClaims(resp));
}

/**
 * Run one cell: `samples` calls through the injected callModel, classified by
 * `classify` (default: binary detectCompliance; quality mode injects a grader).
 */
export async function runCell({ callModel, request, samples, classify }) {
  const judge = classify ?? (async (r) => detectCompliance(r));
  let complied = 0;   // by `classify` (graded, in quality mode)
  let binary = 0;     // raw detectCompliance — to expose over-emission
  for (let s = 0; s < samples; s++) {
    const resp = await callModel(request, s);
    if (detectCompliance(resp)) binary++;
    if (await judge(resp)) complied++;
  }
  return {
    complied, total: samples, rate: samples ? complied / samples : 0,
    binaryComplied: binary, binaryRate: samples ? binary / samples : 0,
  };
}

/**
 * Aggregate cell results into deltas + a validity gate. `cells` is a map like
 * { pos, neg, 'A@50000', 'B@50000', ... } → {rate}. Returns rates, per-length
 * B−A deltas, and whether the experiment is interpretable.
 */
export function aggregate(cells, lengths, gate = { posMin: 0.7, negMax: 0.3 }) {
  const posRate = cells.pos?.rate ?? 0;
  const negRate = cells.neg?.rate ?? 1;
  const negLongRate = cells.negLong?.rate; // long-context negative control (optional)
  // Validity now also requires the long-context negative control to stay low when present,
  // so "controls valid" covers the regime the claim is actually about (not just short context).
  const valid = posRate >= gate.posMin && negRate <= gate.negMax
    && (negLongRate == null || negLongRate <= gate.negMax);
  const deltas = lengths.map(L => ({
    length: L,
    a: cells[`A@${L}`]?.rate ?? null,
    b: cells[`B@${L}`]?.rate ?? null,
    bprime: cells[`Bprime@${L}`]?.rate ?? null,
    delta: (cells[`B@${L}`]?.rate ?? 0) - (cells[`A@${L}`]?.rate ?? 0),
    deltaPrime: (cells[`Bprime@${L}`]?.rate ?? 0) - (cells[`A@${L}`]?.rate ?? 0),
  }));
  // Judge on B' (the realistic shipped placement) when present, else B.
  const useP = deltas.some(d => d.bprime != null);
  const judged = deltas.map(d => ({ length: d.length, delta: useP ? d.deltaPrime : d.delta }));
  let verdict;
  if (!valid) {
    const nl = negLongRate == null ? '' : `, negLong=${negLongRate.toFixed(2)}`;
    verdict = `INVALID — controls failed (pos=${posRate.toFixed(2)} need ≥${gate.posMin}, neg=${negRate.toFixed(2)}${nl} need ≤${gate.negMax}). Fix before believing any delta.`;
  } else {
    const meaningful = judged.filter(d => d.delta >= 0.2);
    const placement = useP ? 'shipped placement (B′)' : 'prefix upper-bound (B)';
    verdict = meaningful.length
      ? `Re-injection HELPS [${placement}] at: ${meaningful.map(d => `${d.length}(+${d.delta.toFixed(2)})`).join(', ')} → premise supported (directional).`
      : `Re-injection shows no meaningful lift [${placement}] (all deltas < 0.20) → premise NOT supported by this run.`;
  }
  return { posRate, negRate, negLongRate, valid, deltas, verdict };
}
