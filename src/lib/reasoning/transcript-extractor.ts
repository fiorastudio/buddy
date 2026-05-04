// src/lib/reasoning/transcript-extractor.ts
//
// Hook-driven extraction. Reads a Claude Code transcript JSONL, slices recent
// turns, calls the Anthropic Messages API with the v7 extraction prompt, and
// converts the structured output to buddy's `ClaimInput[]` / `EdgeInput[]`
// shape — ready to feed straight into `runGuardPipeline`.
//
// Design notes:
// - Single full read per fire: the reader returns both the LLM-bound chunk
//   AND the total turn count from one parse. An earlier version did a
//   tail-seek for the chunk and a separate full scan for the count; that
//   left a race window where the file could grow between the two reads,
//   advancing the cursor past turns the LLM never saw.
// - `convention` (slimemold v7) maps to `definition` (buddy's nearest basis).
// - Errors return `{ ok: false, reason }`; the hook wrapper logs and continues.
//   Extraction must never crash a hook.

import { readFileSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import {
  EXTRACTION_SYSTEM_PROMPT,
  EXTRACTION_TOOL_SCHEMA,
  USER_PROMPT_TEMPLATE,
  formatExistingClaims,
  type ExistingClaimRef,
  type ExtractionResult,
} from './extract-prompt-v7.js';
import type { ClaimInput, EdgeInput, Basis, EdgeType } from './types.js';

// Cap the number of messages we hand to the LLM. Slimemold uses 50; same here.
const MAX_MESSAGES = 50;

// ─── transcript reader ───────────────────────────────────────────────

export type TranscriptRead = {
  /** `[role]: text` blocks, joined by blank lines. Capped at MAX_MESSAGES. */
  chunk: string;
  /** Total user+assistant turns observed in this read — for cursor advance. */
  totalTurns: number;
};

/**
 * Read recent assistant/user messages from a Claude Code transcript JSONL.
 * Returns the LLM-bound chunk and the total turn count from a SINGLE pass —
 * eliminates the read/count race window that existed when these were two
 * separate calls. `sinceTurn` is the cursor: turns at or below it are skipped.
 *
 * Cost: O(file size) every fire. In practice transcripts top out in the low
 * MBs and parse in <50ms; the prior tail-seek micro-optimization didn't apply
 * once a cursor existed (sinceTurn>0 already did a full scan), so keeping it
 * only complicated the cursor advance for marginal savings on the first fire.
 */
export function readRecentTranscript(path: string, sinceTurn = 0): TranscriptRead {
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); } catch { return { chunk: '', totalTurns: 0 }; }

  const lines = raw.split('\n');
  const messages: string[] = [];
  let totalTurns = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: any;
    try { entry = JSON.parse(trimmed); } catch { continue; }

    // Two transcript formats observed: flat {role, content} and nested
    // {type, message: {role, content}}. Handle both.
    let role: string | undefined = entry.role;
    let content: any = entry.content;
    if (!role && entry.message?.role) {
      role = entry.message.role;
      content = entry.message.content;
    }
    if (role !== 'user' && role !== 'assistant') continue;

    totalTurns++;
    if (sinceTurn > 0 && totalTurns <= sinceTurn) continue;

    const text = extractTextContent(content);
    if (text) messages.push(`[${role}]: ${text}`);
  }

  // Trim to the most recent MAX_MESSAGES — older entries dropped first.
  if (messages.length > MAX_MESSAGES) {
    messages.splice(0, messages.length - MAX_MESSAGES);
  }

  return { chunk: messages.join('\n\n'), totalTurns };
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object' && (block as any).type === 'text') {
        const t = (block as any).text;
        if (typeof t === 'string') parts.push(t);
      }
    }
    return parts.join('\n');
  }
  return '';
}

// ─── Anthropic API call (via SDK) ────────────────────────────────────

export type ExtractOptions = {
  apiKey: string;
  model?: string;          // default: claude-haiku-4-5
  maxTokens?: number;      // default: 16384
  timeoutMs?: number;      // default: 180_000 (3 min, matches slimemold)
  /** Inject a custom Anthropic client (tests). Ignores apiKey when present. */
  client?: Anthropic;
};

export type ExtractResponse =
  | { ok: true; result: ExtractionResult }
  | { ok: false; reason: string };

const DEFAULT_MODEL = 'claude-haiku-4-5';

export async function extractClaims(
  transcriptChunk: string,
  existing: ExistingClaimRef[],
  opts: ExtractOptions,
): Promise<ExtractResponse> {
  if (!transcriptChunk.trim()) return { ok: true, result: { claims: [] } };

  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
  const userPrompt = USER_PROMPT_TEMPLATE(transcriptChunk, formatExistingClaims(existing));

  let resp: Anthropic.Message;
  try {
    resp = await client.messages.create(
      {
        model: opts.model ?? DEFAULT_MODEL,
        max_tokens: opts.maxTokens ?? 16384,
        // 1h cache TTL on the system block keeps the (large) extraction
        // prompt warm across many Stop-hook fires within an active session.
        system: [
          {
            type: 'text',
            text: EXTRACTION_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ],
        messages: [{ role: 'user', content: userPrompt }],
        tools: [
          {
            name: 'extract_claims',
            description: 'Output the extracted claims as structured data',
            // EXTRACTION_TOOL_SCHEMA is `as const`, so its inferred type is
            // deeply readonly. Cast to the SDK's structural shape.
            // ToolInputSchemaParam is permissive (`type: 'object'` + open
            // `properties` map) so this is a structural identity, not a
            // compatibility shim.
            input_schema: EXTRACTION_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ],
        tool_choice: { type: 'tool', name: 'extract_claims' },
      },
      { timeout: opts.timeoutMs ?? 180_000 },
    );
  } catch (err: any) {
    // SDK wraps network/timeout/rate-limit errors. Any failure here is
    // recoverable on the next Stop hook fire — we never retry inline.
    return { ok: false, reason: errorReason(err) };
  }

  if (resp.stop_reason === 'max_tokens') {
    return { ok: false, reason: 'truncated (max_tokens)' };
  }

  for (const block of resp.content) {
    if (block.type === 'tool_use' && block.name === 'extract_claims') {
      const input = block.input;
      if (!input || typeof input !== 'object' || !Array.isArray((input as any).claims)) {
        return { ok: false, reason: 'tool_use missing claims[]' };
      }
      return { ok: true, result: input as ExtractionResult };
    }
  }
  return { ok: false, reason: 'no tool_use block in response' };
}

// Match the API key prefixes Anthropic ships (`sk-ant-` for live keys,
// `sk-` for older variants) and any 20+ char run that follows. Redaction is
// belt-and-suspenders — the SDK already redacts in most error paths, but
// we route err.message to stderr in the Stop hook and we never want a
// rotated-but-still-active key surviving in logs.
const KEY_PATTERN = /sk-(?:ant-)?[A-Za-z0-9_-]{20,}/g;

function redactKey(s: string): string {
  return s.replace(KEY_PATTERN, 'sk-***REDACTED***');
}

function errorReason(err: any): string {
  if (err?.name === 'APIConnectionTimeoutError' || err?.code === 'ETIMEDOUT') return 'timeout';
  if (err?.status) return `http ${err.status}: ${redactKey((err.message ?? '').slice(0, 200))}`;
  return `${err?.name ?? 'error'}: ${redactKey((err?.message ?? String(err)).slice(0, 200))}`;
}

// ─── shape conversion ────────────────────────────────────────────────

const VALID_BASES: ReadonlySet<Basis> = new Set([
  'research', 'empirical', 'deduction', 'analogy', 'definition',
  'llm_output', 'assumption', 'vibes',
]);

/**
 * Convert the v7 structured output into buddy's `ClaimInput[]` / `EdgeInput[]`
 * shape. Drops claims with unmappable basis (shouldn't happen given the
 * prompt enum, but defensively guarded). Edges referencing unknown indices
 * are dropped silently — matches writeClaims's pre-existing tolerance for
 * malformed inputs.
 */
export function toBuddyShape(result: ExtractionResult): { claims: ClaimInput[]; edges: EdgeInput[] } {
  const claims: ClaimInput[] = [];
  const edges: EdgeInput[] = [];

  // index → external_id, so edges can resolve.
  const indexToExt = new Map<number, string>();

  for (const c of result.claims) {
    if (!c || typeof c.text !== 'string') continue;
    const basis = mapBasis(c.basis);
    if (!basis) continue;
    if (c.speaker !== 'user' && c.speaker !== 'assistant') continue;
    if (c.confidence !== 'low' && c.confidence !== 'medium' && c.confidence !== 'high') continue;
    if (typeof c.index !== 'number') continue;

    const externalId = `c${c.index}`;
    claims.push({
      text: c.text,
      basis,
      speaker: c.speaker,
      confidence: c.confidence,
      external_id: externalId,
    });
    indexToExt.set(c.index, externalId);
  }

  // Flatten {kind}_indices and {kind}_existing arrays into directed edges.
  for (const c of result.claims) {
    if (typeof c?.index !== 'number') continue;
    const fromExt = indexToExt.get(c.index);
    if (!fromExt) continue;

    pushEdges(edges, fromExt, c.depends_on_indices, indexToExt, 'depends_on');
    pushEdges(edges, fromExt, c.supports_indices, indexToExt, 'supports');
    pushEdges(edges, fromExt, c.contradicts_indices, indexToExt, 'contradicts');
    pushEdges(edges, fromExt, c.questions_indices, indexToExt, 'questions');

    pushExisting(edges, fromExt, c.depends_on_existing, 'depends_on');
    pushExisting(edges, fromExt, c.supports_existing, 'supports');
    pushExisting(edges, fromExt, c.contradicts_existing, 'contradicts');
    pushExisting(edges, fromExt, c.questions_existing, 'questions');
  }

  return { claims, edges };
}

function mapBasis(b: string): Basis | null {
  // slimemold v7 admits `convention`; buddy doesn't. Map to nearest neighbor.
  if (b === 'convention') return 'definition';
  return VALID_BASES.has(b as Basis) ? (b as Basis) : null;
}

function pushEdges(
  out: EdgeInput[],
  fromExt: string,
  indices: number[] | undefined,
  indexToExt: Map<number, string>,
  type: EdgeType,
): void {
  if (!Array.isArray(indices)) return;
  for (const idx of indices) {
    const toExt = indexToExt.get(idx);
    if (!toExt || toExt === fromExt) continue;
    out.push({ from: fromExt, to: toExt, type });
  }
}

function pushExisting(
  out: EdgeInput[],
  fromExt: string,
  existing: string[] | undefined,
  type: EdgeType,
): void {
  if (!Array.isArray(existing)) return;
  for (const id of existing) {
    if (typeof id !== 'string' || !id) continue;
    out.push({ from: fromExt, to: id, type });
  }
}

export type { ExistingClaimRef };
