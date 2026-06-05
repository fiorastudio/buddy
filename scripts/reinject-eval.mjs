#!/usr/bin/env node
// scripts/reinject-eval.mjs
//
// Premise eval for guard-mode re-injection: does re-presenting the extraction
// instruction in fresh context restore a host's willingness to emit claims that
// decayed as the instruction drifted far away? A/B across context lengths,
// bracketed by positive/negative controls. See scripts/reinject-harness.mjs.
//
// REQUIRES (eval-only, NOT a runtime dependency of buddy):
//   npm i -D @anthropic-ai/sdk
//   export ANTHROPIC_API_KEY=sk-ant-...   (or BUDDY_EXTRACTION_KEY)
//   npm run build            # the runner reads the real instruction from dist/
//
// Usage:
//   node scripts/reinject-eval.mjs                              # DRY RUN (no calls)
//   node scripts/reinject-eval.mjs --run                        # synthetic context, live
//   node scripts/reinject-eval.mjs --run --transcript PATH      # REAL transcript context, live
//   ... --samples 20 --lengths 50000,100000,150000 --model claude-sonnet-4-6
//
// Real context is preferred (--transcript): a real long Claude Code session is a
// far better saturation fixture than synthetic filler. Controls always use a
// tiny synthetic context (they test salience at minimal length, content-agnostic).

import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  CLAIMS_EDGES_SCHEMA, generateSyntheticContext, loadRealContext, estimateTokens,
  buildFinalTurn, runCell, aggregate, withCacheBreakpoint,
  finalTurnText, makeQualityClassifier,
} from './reinject-harness.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const RUN = process.argv.includes('--run');
const SAMPLES = parseInt(arg('samples', '15'), 10);
const LENGTHS = arg('lengths', '50000,100000,150000').split(',').map(n => parseInt(n, 10));
const MODEL = arg('model', 'claude-sonnet-4-6');
const TRANSCRIPT = arg('transcript', '');
const GRADE = process.argv.includes('--grade');
const GRADER_MODEL = arg('grader-model', 'claude-haiku-4-5');
const CTRL_TOKENS = 3000;
const CACHE_DIR = join(process.cwd(), '.eval-cache');
const SYSTEM_BASE = 'You are a coding assistant helping with a software project. The buddy_observe tool is available to record structured reasoning claims.';

async function loadInstructions() {
  const mod = await import('../dist/lib/reasoning/index.js').catch(() => null);
  if (!mod?.buildExtractionInstruction) throw new Error('dist not built — run `npm run build` first.');
  // The full instruction sits in the (distant) system block, like CLAUDE.md (far),
  // and is also what the hook re-injects near the turn (nudge). Same text both
  // places — the shipping design.
  const instr = mod.buildExtractionInstruction([]);
  return { far: instr, nudge: instr };
}

const ctxTokens = ctx => ctx.reduce((n, m) => n + estimateTokens(m.content), 0);

function buildRequest(far, nudge, condition, context) {
  const ctx = withCacheBreakpoint(context);
  return {
    system: [{ type: 'text', text: `${SYSTEM_BASE}\n\n${far}`, cache_control: { type: 'ephemeral' } }],
    tools: [{ name: 'buddy_observe', description: 'Record reasoning claims from the conversation.', input_schema: CLAIMS_EDGES_SCHEMA }],
    tool_choice: { type: 'auto' },
    messages: [...ctx, buildFinalTurn(condition, nudge)],
  };
}

function cacheKey(model, request, sample) {
  return createHash('sha256').update(JSON.stringify({ model, request, sample })).digest('hex').slice(0, 32);
}

async function makeCallModel(client, usage) {
  mkdirSync(CACHE_DIR, { recursive: true });
  return async (request, sample) => {
    const key = cacheKey(MODEL, request, sample);
    const path = join(CACHE_DIR, `${key}.json`);
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
    const resp = await client.messages.create({ ...request, model: MODEL, max_tokens: 1024, temperature: 1.0 });
    if (resp.usage) {
      usage.input += resp.usage.input_tokens ?? 0;
      usage.output += resp.usage.output_tokens ?? 0;
      usage.cacheRead += resp.usage.cache_read_input_tokens ?? 0;
      usage.cacheWrite += resp.usage.cache_creation_input_tokens ?? 0;
    }
    writeFileSync(path, JSON.stringify(resp));
    return resp;
  };
}

async function makeCallGrader(client, usage) {
  mkdirSync(CACHE_DIR, { recursive: true });
  return async (prompt) => {
    const key = 'grade-' + createHash('sha256').update(GRADER_MODEL + prompt).digest('hex').slice(0, 28);
    const path = join(CACHE_DIR, `${key}.json`);
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf-8'));
    const resp = await client.messages.create({ model: GRADER_MODEL, max_tokens: 10, temperature: 0, messages: [{ role: 'user', content: prompt }] });
    if (resp.usage) { usage.input += resp.usage.input_tokens ?? 0; usage.output += resp.usage.output_tokens ?? 0; }
    writeFileSync(path, JSON.stringify(resp));
    return resp;
  };
}

async function main() {
  const { far, nudge } = await loadInstructions();
  // Controls use an EMPTY context so the final turn is the ONLY extractable
  // material: pos (substantive turn) → should call; neg (trivial turn) → should
  // skip. A prior substantive context would give the model claims to extract
  // even on a "trivial" turn, defeating the floor test.
  const ctrlCtx = [];
  const contexts = {};
  for (const L of LENGTHS) {
    contexts[L] = TRANSCRIPT ? await loadRealContext(TRANSCRIPT, L) : generateSyntheticContext(L);
  }

  const longest = LENGTHS[LENGTHS.length - 1];
  const cells = [
    ['pos', 'pos', ctrlCtx],
    ['neg', 'neg', ctrlCtx],
    ['negLong', 'neg', contexts[longest]], // long-context negative control
  ];
  for (const L of LENGTHS) {
    cells.push(
      [`A@${L}`, 'A', contexts[L]],
      [`B@${L}`, 'B', contexts[L]],             // bare inline prefix (upper bound)
      [`Bprime@${L}`, 'Bprime', contexts[L]],   // system-reminder block (shipped placement)
    );
  }

  console.log(`reinject-eval — model=${MODEL} samples=${SAMPLES} source=${TRANSCRIPT || 'synthetic'}`);
  for (const L of LENGTHS) console.log(`  context @${L}: ${contexts[L].length} msgs, ~${ctxTokens(contexts[L])} tokens`);
  const totalInput = cells.reduce((n, [, , c]) => n + ctxTokens(c) * SAMPLES, 0);
  const dollars = (totalInput * 0.1 * 3 + 300 * SAMPLES * cells.length * 15) / 1e6;
  console.log(`~${cells.length * SAMPLES} calls, rough upper-bound ~$${dollars.toFixed(2)} (prompt+disk caching cut repeats).`);

  if (!RUN) { console.log('\nDRY RUN. Re-run with --run to execute.'); return; }

  const key = process.env.ANTHROPIC_API_KEY || process.env.BUDDY_EXTRACTION_KEY;
  if (!key) throw new Error('set ANTHROPIC_API_KEY (or BUDDY_EXTRACTION_KEY) to run.');
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    throw new Error('@anthropic-ai/sdk not installed — run `npm i -D @anthropic-ai/sdk`.');
  });
  const client = new Anthropic({ apiKey: key });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const callModel = await makeCallModel(client, usage);
  const callGrader = GRADE ? await makeCallGrader(client, usage) : null;
  if (GRADE) console.log(`quality mode: claims graded by ${GRADER_MODEL} (compliance := emitted AND substantive)`);

  const results = {};
  for (const [label, condition, ctx] of cells) {
    process.stdout.write(`  ${label} ... `);
    const classify = GRADE ? makeQualityClassifier(callGrader, finalTurnText(condition)) : undefined;
    results[label] = await runCell({ callModel, request: buildRequest(far, nudge, condition, ctx), samples: SAMPLES, classify });
    const r = results[label];
    const overEmit = GRADE ? ` (binary ${(r.binaryRate * 100).toFixed(0)}% → graded ${(r.rate * 100).toFixed(0)}%)` : '';
    console.log(`${(r.rate * 100).toFixed(0)}% (${r.complied}/${r.total})${overEmit}`);
  }

  const summary = aggregate(results, LENGTHS);
  const pct = r => (r == null ? ' n/a' : `${(r * 100).toFixed(0)}%`);
  console.log('\n── results ──');
  console.log(`controls — pos: ${pct(summary.posRate)}  neg(short): ${pct(summary.negRate)}  neg(long-ctx): ${pct(summary.negLongRate)}  valid=${summary.valid}`);
  for (const d of summary.deltas) {
    console.log(`  ${d.length}: A=${pct(d.a)}  B(prefix)=${pct(d.b)}  Bʹ(shipped)=${pct(d.bprime)}   ΔBʹ=${(d.deltaPrime >= 0 ? '+' : '')}${(d.deltaPrime * 100).toFixed(0)}pp`);
  }
  console.log(`\nVERDICT: ${summary.verdict}`);
  console.log(`tokens — input:${usage.input} output:${usage.output} cacheRead:${usage.cacheRead} cacheWrite:${usage.cacheWrite}`);
}

main().catch(e => { console.error('eval failed:', e.message); process.exit(1); });
