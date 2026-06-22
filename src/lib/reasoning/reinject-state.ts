// src/lib/reasoning/reinject-state.ts
//
// State machine for guard-mode extraction-instruction re-injection.
//
// The UserPromptSubmit hook fires once per user turn. When the host stops
// calling buddy_observe (the graph goes silent past ~100k tokens of context),
// the hook re-injects the extraction instruction to pull it back. This module
// owns the lapse counter and the efficacy metric, persisted in the DB (NOT the
// shared status JSON — that file is rewritten wholesale by writeBuddyStatus and
// would clobber hook-private state).
//
// State is scoped to ONE session at a time (cwd+day). A different session id
// resets the lapse baseline so a claim in another project can't mask silence
// in this one.

import type Database from 'better-sqlite3';

export type ReinjectStats = {
  reinjections_total: number;
  recoveries_total: number;
};

type ReinjectRow = {
  session_id: string;
  lapse_turns: number;
  last_claim_at: number;
  pending_recovery: number;
  reinjections_total: number;
  recoveries_total: number;
};

function readRow(db: Database.Database, companionId: string): ReinjectRow | undefined {
  return db.prepare(
    `SELECT session_id, lapse_turns, last_claim_at, pending_recovery,
            reinjections_total, recoveries_total
       FROM reasoning_reinject WHERE companion_id = ?`,
  ).get(companionId) as ReinjectRow | undefined;
}

function writeRow(db: Database.Database, companionId: string, r: ReinjectRow): void {
  db.prepare(
    `INSERT INTO reasoning_reinject
       (companion_id, session_id, lapse_turns, last_claim_at, pending_recovery,
        reinjections_total, recoveries_total)
     VALUES (@companion_id, @session_id, @lapse_turns, @last_claim_at, @pending_recovery,
             @reinjections_total, @recoveries_total)
     ON CONFLICT(companion_id) DO UPDATE SET
       session_id = @session_id,
       lapse_turns = @lapse_turns,
       last_claim_at = @last_claim_at,
       pending_recovery = @pending_recovery,
       reinjections_total = @reinjections_total,
       recoveries_total = @recoveries_total`,
  ).run({ companion_id: companionId, ...r });
}

/**
 * Advance the lapse state machine by one turn and decide whether to re-inject.
 *
 * - New/changed session → establish baseline, never emit (avoids a spurious
 *   nudge on the first turn of a session).
 * - A claim landed since last check (newestAt > last_claim_at) → host is
 *   complying: reset the counter, and if a re-injection was pending, count it
 *   as a recovery.
 * - Otherwise increment; once silent for `threshold` turns, emit and reset the
 *   counter (cadence = every `threshold` silent turns), marking a pending
 *   recovery so the next claim is attributed to this nudge.
 *
 * Returns true iff the caller should emit the extraction instruction this turn.
 */
export function evaluateReinject(
  db: Database.Database,
  companionId: string,
  sessionId: string,
  newestAt: number,
  threshold: number,
): boolean {
  const row = readRow(db, companionId);

  // First time, or the active session changed (new project/day): baseline only.
  if (!row || row.session_id !== sessionId) {
    writeRow(db, companionId, {
      session_id: sessionId,
      lapse_turns: 0,
      last_claim_at: newestAt,
      pending_recovery: 0,
      reinjections_total: row?.reinjections_total ?? 0,
      recoveries_total: row?.recoveries_total ?? 0,
    });
    return false;
  }

  // A claim landed since last check — host is complying.
  if (newestAt > row.last_claim_at) {
    writeRow(db, companionId, {
      session_id: sessionId,
      lapse_turns: 0,
      last_claim_at: newestAt,
      pending_recovery: 0,
      reinjections_total: row.reinjections_total,
      recoveries_total: row.recoveries_total + (row.pending_recovery ? 1 : 0),
    });
    return false;
  }

  // Still silent this turn.
  const lapseTurns = row.lapse_turns + 1;
  const shouldEmit = lapseTurns >= threshold;
  writeRow(db, companionId, {
    session_id: sessionId,
    lapse_turns: shouldEmit ? 0 : lapseTurns,
    last_claim_at: row.last_claim_at,
    pending_recovery: shouldEmit ? 1 : row.pending_recovery,
    reinjections_total: row.reinjections_total + (shouldEmit ? 1 : 0),
    recoveries_total: row.recoveries_total,
  });
  return shouldEmit;
}

/** Cumulative re-injection efficacy counters for doctor / status surfaces. */
export function getReinjectStats(db: Database.Database, companionId: string): ReinjectStats {
  const row = db.prepare(
    `SELECT reinjections_total, recoveries_total FROM reasoning_reinject WHERE companion_id = ?`,
  ).get(companionId) as Pick<ReinjectRow, 'reinjections_total' | 'recoveries_total'> | undefined;
  return {
    reinjections_total: row?.reinjections_total ?? 0,
    recoveries_total: row?.recoveries_total ?? 0,
  };
}
