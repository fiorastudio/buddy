// src/lib/reasoning/transcript-extractor.ts
//
// Hook-driven extraction. Reads a Claude Code transcript JSONL, slices recent
// turns (with a tail-seek for large files), calls the Anthropic Messages API
// with the v7 extraction prompt, and converts the structured output to
// buddy's `ClaimInput[]` / `EdgeInput[]` shape — ready to feed straight into
// `runGuardPipeline`.
//
// Design notes:
// - The reader is a TS port of slimemold's `readRecentTranscript` (2MB tail
//   seek when sinceTurn==0; forward-scan-with-cap when sinceTurn>0).
// - `convention` (slimemold v7) maps to `definition` (buddy's nearest basis).
// - Errors return `{ ok: false, reason }`; the hook wrapper logs and continues.
//   Extraction must never crash a hook.

import { openSync, readSync, statSync, closeSync, readFileSync } from 'fs';
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

// 2MB tail covers several hundred turns in practice. Matches
// slimemold/internal/extract/extract.go:209.
const MAX_TAIL_BYTES = 2 * 1024 * 1024;

// Cap the number of messages we hand to the LLM. Slimemold uses 50; same here.
const MAX_MESSAGES = 50;

// ─── transcript reader ───────────────────────────────────────────────

/**
 * Read recent assistant/user messages from a Claude Code transcript JSONL.
 * When sinceTurn==0, seeks the last 2MB to avoid full I/O on large sessions.
 * When sinceTurn>0, forward-scans and stops `MAX_MESSAGES` past the boundary.
 */
export function readRecentTranscript(path: string, sinceTurn = 0): string {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    return '';
  }

  let raw: string;
  let skipFirstLine = false;

  if (sinceTurn === 0 && stat.size > MAX_TAIL_BYTES) {
    // Tail-seek: open, position to the last 2MB, read forward. Discard the
    // first (likely partial) line.
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.allocUnsafe(MAX_TAIL_BYTES);
      readSync(fd, buf, 0, MAX_TAIL_BYTES, stat.size - MAX_TAIL_BYTES);
      raw = buf.toString('utf-8');
      skipFirstLine = true;
    } finally {
      closeSync(fd);
    }
  } else {
    raw = readFileSync(path, 'utf-8');
  }

  const lines = raw.split('\n');
  const messages: string[] = [];
  let turnCount = 0;

  for (let i = 0; i < lines.length; i++) {
    if (i === 0 && skipFirstLine) continue;
    const line = lines[i].trim();
    if (!line) continue;

    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }

    // Two transcript formats observed: flat {role, content} and nested
    // {type, message: {role, content}}. Handle both.
    let role: string | undefined = entry.role;
    let content: any = entry.content;
    if (!role && entry.message?.role) {
      role = entry.message.role;
      content = entry.message.content;
    }
    if (role !== 'user' && role !== 'assistant') continue;

    turnCount++;
    if (sinceTurn > 0 && turnCount <= sinceTurn) continue;

    const text = extractTextContent(content);
    if (text) messages.push(`[${role}]: ${text}`);

    if (sinceTurn > 0 && messages.length >= MAX_MESSAGES) break;
  }

  // Tail-seek path may have collected more than the cap; trim to the most recent.
  if (messages.length > MAX_MESSAGES) {
    messages.splice(0, messages.length - MAX_MESSAGES);
  }

  return messages.join('\n\n');
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

/**
 * Count the total number of user/assistant turns in a transcript file. Used
 * after a successful extraction to advance the per-host-session cursor so the
 * next Stop hook only processes turns added since this extraction. Single
 * forward pass; cheap on transcripts up to a few MB.
 */
export function countTranscriptTurns(path: string): number {
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); } catch { return 0; }
  let count = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: any;
    try { entry = JSON.parse(trimmed); } catch { continue; }
    let role: string | undefined = entry.role;
    if (!role && entry.message?.role) role = entry.message.role;
    if (role === 'user' || role === 'assistant') count++;
  }
  return count;
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
