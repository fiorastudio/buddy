#!/usr/bin/env node
// src/hooks/stop-handler.ts
//
// Stop hook handler for Buddy MCP.
// Fires after every Claude response. Two responsibilities:
//   1. Detect task-completion signals → encouraging statusline reaction
//      (zero token cost, pattern-matched).
//   2. Hook-driven claim extraction when guard mode is on and an extraction
//      key resolves. The transcript is read, sent to Anthropic, and the
//      structured output is fed into runGuardPipeline. Errors are swallowed
//      so a hook process can never crash the host.

import { readFileSync, writeFileSync } from "fs";
import { BUDDY_STATUS_PATH } from "../lib/constants.js";

// Conservative completion signals — require explicit past-tense "done" phrasing.
// Avoids firing on planning sentences like "I'll implement..." or mid-task narration.
export const COMPLETION_REGEX =
  /\b(?:I(?:'ve| have) (?:implemented|added|created|updated|fixed|refactored|written|deployed|pushed|committed|completed|finished)|(?:all )?tests? (?:pass(?:ed|ing)?|are passing)|(?:the )?(?:fix|change|implementation) is (?:in place|complete|done)|successfully (?:deployed|committed|pushed|built)|(?:build|compilation) (?:succeeded|passed))\b/i;

// Bail if the response looks like ongoing work rather than completion.
export const ONGOING_REGEX =
  /^(?:I'?ll |Let me |I (?:need to|should|will|can)|Looking at|Checking|Reading|I'm (?:going to|working on|looking at))/i;

const COMPLETION_REACTIONS = [
  "ooh, new code! let me have a look...",
  "nice work! shipping things...",
  "that looks solid",
  "progress! the bits are flying",
  "task complete~",
  "committed? good.",
];

export interface StopInput {
  session_id?: string;
  transcript_path?: string;
  stop_hook_active?: boolean;
  // Some Claude Code builds surface this directly; fall back to transcript otherwise.
  last_assistant_message?: string;
}

function extractLastMessage(input: StopInput): string {
  if (input.last_assistant_message) return input.last_assistant_message;

  if (!input.transcript_path) return "";
  try {
    const raw = readFileSync(input.transcript_path, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const entry = JSON.parse(lines[i]);
      // Handle both flat {role, content} and nested {type, message} transcript formats
      const role = entry.role ?? entry.message?.role;
      const content = entry.content ?? entry.message?.content;
      if (role !== "assistant" || !content) continue;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .filter((c: { type?: string }) => c.type === "text")
          .map((c: { text?: string }) => c.text ?? "")
          .join(" ");
      }
    }
  } catch { /* silent — transcript may not exist yet */ }
  return "";
}

export function writeCompletionReaction(statusPath: string = BUDDY_STATUS_PATH, expiryMs: number = 15_000): boolean {
  try {
    const raw = readFileSync(statusPath, "utf-8");
    const status = JSON.parse(raw);
    if (!status?.name) return false;

    // Single-pass race protection: don't overwrite an active reaction.
    if (status.reaction_expires && status.reaction_expires > Date.now()) return false;

    const reaction = COMPLETION_REACTIONS[Math.floor(Date.now() / 1000) % COMPLETION_REACTIONS.length];
    status.reaction = "excited";
    status.reaction_text = reaction;
    status.reaction_expires = Date.now() + expiryMs;
    status.reaction_eye = "^";
    status.reaction_indicator = "!";
    // No bubble_lines — hook reactions are statusline-only to keep them lightweight.

    writeFileSync(statusPath, JSON.stringify(status));
    return true;
  } catch {
    return false;
  }
}

export function handleStop(input: StopInput, statusPath: string = BUDDY_STATUS_PATH): boolean {
  const message = extractLastMessage(input);
  // Skip very short responses — unlikely to be a task completion turn.
  if (!message || message.length < 60) return false;
  if (ONGOING_REGEX.test(message)) return false;
  if (!COMPLETION_REGEX.test(message)) return false;

  return writeCompletionReaction(statusPath);
}

// ─── extraction (guard-mode only) ──────────────────────────────────────────

/**
 * Resolve the active companion + check guard mode + run hook-driven extraction
 * if a key is available. Returns silently — extraction failures must never
 * crash the host. Logs to stderr for debugging.
 *
 * Imports are dynamic so the existing synchronous statusline path (and its
 * tests) don't pay a startup cost from SQLite/SDK initialization unless
 * extraction is actually attempted.
 */
export async function runExtractionForStop(input: StopInput): Promise<void> {
  if (!input.transcript_path) return;

  const { resolveExtractionKey, resolveExtractionModel } = await import("../lib/reasoning/extraction-key.js");
  const resolved = resolveExtractionKey();
  if (!resolved.key) return; // no key → fall back to model-driven extraction
  const model = resolveExtractionModel() ?? undefined; // undefined → SDK default

  const { db, initDb } = await import("../db/schema.js");
  initDb();

  const companion = db.prepare(
    "SELECT id, guard_mode, mood FROM companions LIMIT 1",
  ).get() as { id: string; guard_mode: number | null; mood: string | null } | undefined;
  if (!companion) return;
  if ((companion.guard_mode ?? 0) === 0) return;
  // While muted, skip extraction entirely. User is paying API costs they
  // explicitly opted out of receiving output for. The cursor doesn't
  // advance, so post-unmute the next Stop hook resumes processing from
  // the muted period — no claims permanently lost.
  if (companion.mood === 'muted') return;

  const {
    readRecentTranscript, extractClaims, toBuddyShape, countTranscriptTurns,
  } = await import("../lib/reasoning/transcript-extractor.js");
  const { runGuardPipeline } = await import("../lib/reasoning/pipeline.js");
  const telemetry = await import("../lib/reasoning/telemetry.js");
  const state = await import("../lib/reasoning/extraction-state.js");
  const { loadRecentClaims } = await import("../lib/reasoning/writer.js");
  const { resolveProjectRoot } = await import("../lib/reasoning/project-root.js");
  const { deriveSessionId } = await import("../lib/reasoning/session.js");
  const { REASONING_CONFIG } = await import("../lib/reasoning/config.js");

  // Backoff: if recent extractions have been failing, skip this one. Counter
  // resets on any successful extraction, so transient outages naturally
  // un-stall. Stderr log is BUDDY_DEBUG-gated — every Stop hook while in
  // backoff would emit one line otherwise, and Claude Code captures hook
  // stderr to a debug log; non-engineer maintainers seeing 50+ "extraction
  // in backoff" lines would assume the system is broken when it's
  // actually gracefully degrading. The doctor + buddy_reasoning_status
  // surfaces communicate this state more accessibly.
  const stats = state.getStats(db, companion.id);
  if (state.shouldBackoff(stats)) {
    if (process.env.BUDDY_DEBUG) {
      process.stderr.write(`[buddy] extraction in backoff (${stats.consecutiveFailures} consecutive failures, last ${stats.lastFailureReason ?? 'unknown'})\n`);
    }
    return;
  }

  // Incremental cursor: only process turns we haven't seen. Without this the
  // hook re-extracts the last 50 turns every fire, populating the graph with
  // duplicates of the same claims under fresh UUIDs.
  const hostSessionId = state.deriveHostKey(input.session_id, input.transcript_path);
  if (!hostSessionId) return; // can't track without a stable key
  const cursor = state.getCursor(db, hostSessionId);
  const chunk = readRecentTranscript(input.transcript_path, cursor.lastExtractedTurnCount);
  if (!chunk.trim()) return;

  // Cross-batch context: hand the LLM recent claims from this workspace's
  // session graph so it can edge into them via `_existing` IDs (8-char UUID
  // prefixes resolved by writeClaims). Without this, every extraction is an
  // island and the workspace graph stays fragmented across turns.
  const projectRoot = resolveProjectRoot(process.env.CLAUDE_PROJECT_DIR ?? null);
  const buddySessionId = deriveSessionId(projectRoot.path);
  const recentClaims = loadRecentClaims(db, buddySessionId, REASONING_CONFIG.RECENT_CLAIMS_CONTEXT);
  const existing = recentClaims.map(c => ({
    id: c.id.slice(0, 8),
    text: c.text,
    basis: c.basis,
  }));

  telemetry.recordExtractionAttempt();
  state.recordAttempt(db, companion.id);

  const resp = await extractClaims(chunk, existing, { apiKey: resolved.key, model });
  if (!resp.ok) {
    const bucket = telemetry.bucketFailureReason(resp.reason);
    telemetry.recordExtractionFailure(resp.reason);
    state.recordFailure(db, companion.id, bucket, resp.reason);
    // Failure is captured in persistent stats + bucketed for the doctor;
    // stderr is the engineer-debug path only.
    if (process.env.BUDDY_DEBUG) {
      process.stderr.write(`[buddy] extraction failed: ${resp.reason}\n`);
    }
    return;
  }
  telemetry.recordExtractionSuccess();
  state.recordSuccess(db, companion.id);

  // Bump the cursor so the next Stop hook reads only what's been added since.
  // We do this BEFORE writing claims to the pipeline — even if the pipeline
  // throws on this batch, we don't want to re-process the same turns next
  // time and pay the API cost again. Worst case: one batch lost.
  const newTurnCount = countTranscriptTurns(input.transcript_path);
  state.bumpCursor(db, hostSessionId, newTurnCount);

  const shaped = toBuddyShape(resp.result);
  if (shaped.claims.length === 0) return;

  try {
    runGuardPipeline(db, {
      companionId: companion.id,
      cwd: process.env.CLAUDE_PROJECT_DIR ?? null,
      claims: shaped.claims,
      edges: shaped.edges,
    });
  } catch (err: any) {
    if (process.env.BUDDY_DEBUG) {
      process.stderr.write(`[buddy] pipeline failed: ${err?.message ?? String(err)}\n`);
    }
  }
}

// --- CLI entry point ---
const isDirectRun = process.argv[1]?.includes("stop-handler");
if (isDirectRun) {
  (async () => {
    let input: StopInput | null = null;
    try {
      const stdin = readFileSync(0, "utf-8");
      input = JSON.parse(stdin);
    } catch {
      // Silent failure on stdin parse — hooks must never crash the host.
      return;
    }
    if (!input) return;

    // Statusline reaction first (synchronous, zero-cost).
    try { handleStop(input); } catch { /* swallow */ }

    // Extraction second (async, gated on guard mode + key).
    try { await runExtractionForStop(input); } catch { /* swallow */ }
  })();
}
