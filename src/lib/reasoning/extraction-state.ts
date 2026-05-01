// src/lib/reasoning/extraction-state.ts
//
// Persistent state for hook-driven extraction. Two concerns:
//
//   1. Incremental cursor — what turn number have we already extracted up
//      to, per host (Claude Code) session. Without this, each Stop hook
//      re-processes the full transcript tail and the graph fills with
//      duplicates. Keyed by host session id (the StopInput.session_id).
//
//   2. Cross-process telemetry — the Stop hook is a fresh Node process per
//      fire, so the in-memory `telemetry.ts` counters are useless for
//      cross-call aggregates. Persist attempts / successes / failures /
//      consecutive failures so the doctor sees real history and the hook
//      can apply backoff.
//
// All writes are best-effort: extraction must never fail because state
// can't be persisted. We try, swallow on error, and keep going.

import type Database from 'better-sqlite3';

/**
 * Derive a stable cursor key from the host's StopInput payload. Prefers the
 * explicit `session_id` when it's a non-empty string; otherwise falls back to
 * the transcript path. Handles three host quirks:
 *
 *   - Some host builds emit `session_id: ""` for unidentified sessions —
 *     using `""` as the key would collapse every such session into one
 *     cursor row.
 *   - Some hosts emit `session_id: null` — same fallback.
 *   - The path-based fallback is prefixed `path:` so it can never collide
 *     with a real `session_id`-shaped string from a host that uses path-
 *     like ids.
 *
 * Returns null if neither field is usable; caller should bail without
 * recording state.
 */
export function deriveHostKey(
  sessionId: string | null | undefined,
  transcriptPath: string | null | undefined,
): string | null {
  if (typeof sessionId === 'string' && sessionId.length > 0) return sessionId;
  if (typeof transcriptPath === 'string' && transcriptPath.length > 0) return `path:${transcriptPath}`;
  return null;
}

const BACKOFF_FAILURE_THRESHOLD = 5;          // skip after this many in a row
const BACKOFF_WINDOW_MS = 5 * 60 * 1000;       // ...if last failure was this recent

export type ExtractionCursor = {
  hostSessionId: string;
  lastExtractedTurnCount: number;
};

export function getCursor(db: Database.Database, hostSessionId: string): ExtractionCursor {
  try {
    const row = db.prepare(
      `SELECT last_extracted_turn_count FROM reasoning_extraction_state WHERE host_session_id = ?`,
    ).get(hostSessionId) as { last_extracted_turn_count: number } | undefined;
    return {
      hostSessionId,
      lastExtractedTurnCount: row?.last_extracted_turn_count ?? 0,
    };
  } catch {
    return { hostSessionId, lastExtractedTurnCount: 0 };
  }
}

export function bumpCursor(db: Database.Database, hostSessionId: string, newTurnCount: number): void {
  try {
    db.prepare(
      `INSERT INTO reasoning_extraction_state (host_session_id, last_extracted_turn_count, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(host_session_id) DO UPDATE SET
         last_extracted_turn_count = excluded.last_extracted_turn_count,
         updated_at = excluded.updated_at`,
    ).run(hostSessionId, newTurnCount, Date.now());
  } catch { /* best-effort */ }
}

// ── persistent telemetry ─────────────────────────────────────────────

export type ExtractionStats = {
  attemptsTotal: number;
  succeededTotal: number;
  failedTotal: number;
  consecutiveFailures: number;
  failureReasons: Record<string, number>;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  lastFailureReason: string | null;
  findingsDeliveredTotal: number;
};

/**
 * Build a fresh zero-state. Returned by value, never shared — `failureReasons`
 * is a fresh object every call so callers can mutate without poisoning a
 * module-level singleton.
 */
function freshZeroStats(): ExtractionStats {
  return {
    attemptsTotal: 0,
    succeededTotal: 0,
    failedTotal: 0,
    consecutiveFailures: 0,
    failureReasons: {},
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    findingsDeliveredTotal: 0,
  };
}

export function getStats(db: Database.Database, companionId: string): ExtractionStats {
  try {
    const row = db.prepare(
      `SELECT attempts_total, succeeded_total, failed_total, consecutive_failures,
              failure_reasons_json, last_attempt_at, last_success_at, last_failure_at,
              last_failure_reason, findings_delivered_total
         FROM reasoning_extraction_stats WHERE companion_id = ?`,
    ).get(companionId) as any;
    if (!row) return freshZeroStats();
    let reasons: Record<string, number> = {};
    try { reasons = JSON.parse(row.failure_reasons_json ?? '{}'); } catch { /* corrupt JSON — start fresh */ }
    return {
      attemptsTotal: row.attempts_total ?? 0,
      succeededTotal: row.succeeded_total ?? 0,
      failedTotal: row.failed_total ?? 0,
      consecutiveFailures: row.consecutive_failures ?? 0,
      failureReasons: reasons,
      lastAttemptAt: row.last_attempt_at ?? null,
      lastSuccessAt: row.last_success_at ?? null,
      lastFailureAt: row.last_failure_at ?? null,
      lastFailureReason: row.last_failure_reason ?? null,
      findingsDeliveredTotal: row.findings_delivered_total ?? 0,
    };
  } catch {
    return freshZeroStats();
  }
}

function ensureStatsRow(db: Database.Database, companionId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO reasoning_extraction_stats (companion_id) VALUES (?)`,
  ).run(companionId);
}

export function recordAttempt(db: Database.Database, companionId: string): void {
  try {
    ensureStatsRow(db, companionId);
    db.prepare(
      `UPDATE reasoning_extraction_stats
          SET attempts_total = attempts_total + 1,
              last_attempt_at = ?
        WHERE companion_id = ?`,
    ).run(Date.now(), companionId);
  } catch { /* best-effort */ }
}

export function recordSuccess(db: Database.Database, companionId: string): void {
  try {
    ensureStatsRow(db, companionId);
    // Clear last_failure_reason on success — it represents "the most recent
    // problem" and shouldn't outlive the recovery. Doctor and reasoning_status
    // surface it; leaving stale failure text after the system recovers is
    // misleading.
    db.prepare(
      `UPDATE reasoning_extraction_stats
          SET succeeded_total = succeeded_total + 1,
              consecutive_failures = 0,
              last_success_at = ?,
              last_failure_reason = NULL
        WHERE companion_id = ?`,
    ).run(Date.now(), companionId);
  } catch { /* best-effort */ }
}

export function recordFailure(db: Database.Database, companionId: string, bucket: string, rawReason: string): void {
  try {
    ensureStatsRow(db, companionId);
    // Increment the per-bucket count atomically at the SQL level via JSON1
    // (json_set + json_extract). Read-modify-write in TypeScript would lose
    // increments under the rare-but-possible case of two Stop-hook
    // processes firing simultaneously for the same companion (e.g., two
    // Claude Code windows in different projects both ending an assistant
    // turn in the same tick). All bucket names we generate are
    // /[a-z0-9_]+/ — safe to interpolate as a JSON path component without
    // escaping.
    //
    // Defensive guard: if failure_reasons_json was corrupted by a manual
    // edit to the DB, json_valid checks return 0 and we fall back to '{}'
    // before json_extract / json_set, so the column self-heals on the
    // next failure write.
    db.prepare(
      `UPDATE reasoning_extraction_stats
          SET failed_total = failed_total + 1,
              consecutive_failures = consecutive_failures + 1,
              failure_reasons_json = json_set(
                CASE WHEN json_valid(failure_reasons_json) THEN failure_reasons_json ELSE '{}' END,
                '$.' || ?,
                coalesce(json_extract(
                  CASE WHEN json_valid(failure_reasons_json) THEN failure_reasons_json ELSE '{}' END,
                  '$.' || ?
                ), 0) + 1
              ),
              last_failure_at = ?,
              last_failure_reason = ?
        WHERE companion_id = ?`,
    ).run(bucket, bucket, Date.now(), rawReason.slice(0, 200), companionId);
  } catch { /* best-effort */ }
}

export function recordFindingsDelivered(db: Database.Database, companionId: string, n: number): void {
  if (n <= 0) return;
  try {
    ensureStatsRow(db, companionId);
    db.prepare(
      `UPDATE reasoning_extraction_stats
          SET findings_delivered_total = findings_delivered_total + ?
        WHERE companion_id = ?`,
    ).run(n, companionId);
  } catch { /* best-effort */ }
}

// ── backoff ──────────────────────────────────────────────────────────

/**
 * Should the Stop hook skip this fire because we've been failing recently?
 * After N consecutive failures within Y minutes, back off. Reset semantics:
 * `consecutive_failures` zeros on every success, so backoff naturally
 * un-stalls the moment any extraction succeeds.
 *
 * Calling code is expected to bypass entirely if the user has taken a
 * corrective action (changed key, disabled guard mode) — that's outside
 * this function's responsibility.
 */
export function shouldBackoff(stats: ExtractionStats, now: number = Date.now()): boolean {
  if (stats.consecutiveFailures < BACKOFF_FAILURE_THRESHOLD) return false;
  if (stats.lastFailureAt == null) return false;
  return now - stats.lastFailureAt < BACKOFF_WINDOW_MS;
}

/**
 * Should buddy_observe treat precise mode as active right now?
 *
 *   - keyResolved=true + healthy hook → suppress model claims (precise mode
 *     active; the Stop hook is the source of truth)
 *   - keyResolved=true + hook in backoff → DON'T suppress (graceful
 *     degradation; the hook is dead, accepting model claims keeps the
 *     graph from going silent)
 *   - keyResolved=false → never suppress (lossy fallback, no precise mode
 *     to coexist with)
 *
 * Backoff threshold matches `shouldBackoff` so the runtime view ("model
 * claims accepted") and the Stop hook's view ("skip extraction") are
 * symmetric: the moment one starts skipping, the other starts accepting.
 * Counter resets on any successful extraction, so recovery is automatic.
 */
export function preciseModeActiveForObserve(stats: ExtractionStats, keyResolved: boolean): boolean {
  if (!keyResolved) return false;
  return stats.consecutiveFailures < BACKOFF_FAILURE_THRESHOLD;
}

export const BACKOFF = {
  FAILURE_THRESHOLD: BACKOFF_FAILURE_THRESHOLD,
  WINDOW_MS: BACKOFF_WINDOW_MS,
} as const;
