// src/lib/award.ts
// XP award chokepoint, extracted from the MCP server so it can be unit-tested
// directly (index.ts opens a stdio server on import and can't be imported).
//
// Two Claude Code sessions run two server processes against the same
// ~/.buddy/buddy.db. Every read-then-decide gate in an award must therefore be
// atomic across processes, or one session reads a value the other is about to
// change and they clobber each other (#161). The award is a self-referential
// UPDATE (xp = xp + ?) so companions.xp stays equal to sum(xp_events.xp_gained)
// regardless of interleaving, and the whole gated award runs under one
// BEGIN IMMEDIATE transaction so the daily damper and the streak-milestone
// check see a consistent, serialized view.

import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { XP_REWARDS, levelFromXp, applyBlessing } from './leveling.js';
import { zenyForEvent } from './zeny.js';
import { isWorldBlessed } from './world/client.js';
import { checkStreakMilestone } from './streaks.js';
import { shouldDampenSelfReport } from './xp-classify.js';

type DB = BetterSqlite3.Database;

export interface XpResult {
  newXp: number;
  newLevel: number;
  leveledUp: boolean;
  xpGained: number;
  newZeny: number;
}

export interface PendingEvent { type: string }

export interface GatedAward {
  xpResult: XpResult;
  worldEvents: string[];
}

/** Provenance of an xp_events row — see db/xp-events-schema.ts. */
export type XpSource = 'self' | 'hook' | 'system';

export interface AwardEvent {
  type: string;
  source?: XpSource;
  /** Self-report folded into this hook row's id (stored as xp_events.dedupe_of). */
  dedupeOf?: string;
  /** Row id; generated when omitted. */
  id?: string;
}

/**
 * How far back a self-report looks for a hook-verified event of the same type
 * that another session's observe already consumed. Matches the pending queue's
 * own staleness bound (pending-events.ts MAX_EVENT_AGE_MS): an event that old
 * would not have deduped the self-report in a single session either.
 */
export const HOOK_DEDUPE_WINDOW_MINUTES = 15;

/**
 * Non-transactional award body — inserts one append-only xp_events row per
 * event, then bumps the denormalized companions columns with a self-referential
 * UPDATE. MUST be called inside a transaction (see awardWithGates): on its own
 * the level read-derive-write is not atomic against a concurrent writer.
 *
 * COALESCE guards a legacy row whose xp/zeny is explicitly NULL (the columns are
 * nullable; DEFAULT 0 only covers rows created after the migration); without it
 * `x + NULL` is NULL and the column would be wiped.
 */
export function awardXpBatchCore(db: DB, companionId: string, events: Array<string | AwardEvent>): XpResult {
  // Buddy World blessing: teleported buddies earn +10% (local file check, cached).
  const blessed = isWorldBlessed();
  const insert = db.prepare(
    "INSERT INTO xp_events (id, companion_id, event_type, xp_gained, source, dedupe_of) VALUES (?, ?, ?, ?, ?, ?)"
  );
  let xpGained = 0;
  let zenyGained = 0;
  for (const raw of events) {
    const ev: AwardEvent = typeof raw === 'string' ? { type: raw } : raw;
    const xp = applyBlessing(XP_REWARDS[ev.type] || 1, blessed);
    insert.run(ev.id ?? randomUUID(), companionId, ev.type, xp, ev.source ?? null, ev.dedupeOf ?? null);
    xpGained += xp;
    zenyGained += applyBlessing(zenyForEvent(ev.type), blessed);
  }

  // Pre-award level, read inside the txn, is what leveledUp compares against.
  const before = db.prepare("SELECT level FROM companions WHERE id = ?").get(companionId) as any;

  // Self-referential: SQLite does the addition under the write lock, so two
  // interleaved sessions can't clobber each other.
  db.prepare("UPDATE companions SET xp = COALESCE(xp, 0) + ?, zeny = COALESCE(zeny, 0) + ? WHERE id = ?")
    .run(xpGained, zenyGained, companionId);

  const after = db.prepare("SELECT xp, zeny FROM companions WHERE id = ?").get(companionId) as any;
  const newXp = after?.xp ?? xpGained;
  const newZeny = after?.zeny ?? zenyGained;
  const newLevel = levelFromXp(newXp);
  const leveledUp = newLevel > (before?.level || 1);
  db.prepare("UPDATE companions SET level = ? WHERE id = ?").run(newLevel, companionId);

  return { newXp, newLevel, leveledUp, xpGained, newZeny };
}

/**
 * The full XP award for one observe/pet, in a single BEGIN IMMEDIATE
 * transaction so every read-then-decide gate is atomic against concurrent
 * server processes:
 *   - the daily honor-system damper (elevated-event count → maybe downgrade),
 *   - the base award,
 *   - the 7-day streak-milestone check, and its award.
 *
 * Splitting the base award and the streak check across separate transactions
 * let two concurrent first-of-day awards both read the same today-count and
 * both skip (or both grant) the streak — the same lost-update class as the XP
 * race itself. IMMEDIATE takes the write lock up front so the second session
 * waits (busy_timeout) and re-reads instead.
 *
 * `pending` (ground-truth hook events) is read from a file upstream and passed
 * in, so no file I/O happens while the write lock is held.
 *
 * `requestedSelfType` is the RAW summary classification. Arbitration between
 * the two channels happens here, against the ledger, not against `pending`
 * alone: pending-events.jsonl is global, so another session's observe may
 * already have consumed (and paid for) the hook event behind this session's
 * self-report. A self-reported elevated type is therefore folded into an
 * unmatched hook row of the same type — one consumed in this award, else one
 * any session recorded in the last HOOK_DEDUPE_WINDOW_MINUTES — and pays as a
 * plain observe. Each hook row absorbs at most one self-report (dedupe_of), so
 * two real commits still back two self-reports. See X3.
 */
export function awardWithGates(
  db: DB,
  companionId: string,
  requestedSelfType: string,
  pending: PendingEvent[],
): GatedAward {
  const run = db.transaction((): GatedAward => {
    let selfType = requestedSelfType;
    let dedupeOf: string | undefined;

    // Hook rows get their ids up front so the self-report can point at one.
    const hookEvents: AwardEvent[] = pending
      .filter((ev) => XP_REWARDS[ev.type] !== undefined)
      .map((ev) => ({ type: ev.type, source: 'hook', id: randomUUID() }));

    if (isElevated(selfType)) {
      dedupeOf = hookEvents.find((ev) => ev.type === selfType)?.id
        ?? findUnmatchedHookEvent(db, companionId, selfType);
      if (dedupeOf) selfType = 'observe';
    }

    // Honor-system damper: summary-classified elevated events cap per day;
    // hook-verified events below are exempt.
    if (isElevated(selfType)) {
      const elevated = (db.prepare(
        "SELECT COUNT(*) AS n FROM xp_events WHERE companion_id = ? AND date(created_at) = date('now') AND event_type IN ('commit','tests_passed','bug_fix','deploy')"
      ).get(companionId) as any)?.n ?? 0;
      if (shouldDampenSelfReport(elevated)) selfType = 'observe';
    }

    const events: AwardEvent[] = [{ type: selfType, source: 'self', dedupeOf }, ...hookEvents];
    const worldEvents: string[] = events.map((ev) => ev.type);

    let xpResult = awardXpBatchCore(db, companionId, events);

    // Streak milestone: first award of a new day landing on a 7-day multiple.
    // Awarded through the core so its XP and Zeny (500z) actually land.
    if (checkStreakMilestone(db, companionId, worldEvents.length)) {
      worldEvents.push('streak_7');
      const streakResult = awardXpBatchCore(db, companionId, [{ type: 'streak_7', source: 'system' }]);
      xpResult = {
        ...streakResult,
        xpGained: xpResult.xpGained + streakResult.xpGained,
        leveledUp: xpResult.leveledUp || streakResult.leveledUp,
      };
    }

    return { xpResult, worldEvents };
  });
  return run.immediate();
}

function isElevated(type: string): boolean {
  return type !== 'observe' && type !== 'session';
}

/**
 * Oldest hook-verified `type` row in the dedupe window that no self-report has
 * been folded into yet. Must run inside the award transaction so two sessions
 * can't both claim the same row.
 */
function findUnmatchedHookEvent(db: DB, companionId: string, type: string): string | undefined {
  const row = db.prepare(
    `SELECT h.id FROM xp_events h
      WHERE h.companion_id = ? AND h.source = 'hook' AND h.event_type = ?
        AND h.created_at >= datetime('now', ?)
        AND NOT EXISTS (SELECT 1 FROM xp_events s WHERE s.dedupe_of = h.id)
      ORDER BY h.created_at ASC, h.rowid ASC
      LIMIT 1`
  ).get(companionId, type, `-${HOOK_DEDUPE_WINDOW_MINUTES} minutes`) as { id: string } | undefined;
  return row?.id;
}
