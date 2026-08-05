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
export function awardXpBatchCore(db: DB, companionId: string, eventTypes: string[]): XpResult {
  // Buddy World blessing: teleported buddies earn +10% (local file check, cached).
  const blessed = isWorldBlessed();
  const insert = db.prepare("INSERT INTO xp_events (id, companion_id, event_type, xp_gained) VALUES (?, ?, ?, ?)");
  let xpGained = 0;
  let zenyGained = 0;
  for (const eventType of eventTypes) {
    const xp = applyBlessing(XP_REWARDS[eventType] || 1, blessed);
    insert.run(randomUUID(), companionId, eventType, xp);
    xpGained += xp;
    zenyGained += applyBlessing(zenyForEvent(eventType), blessed);
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
 */
export function awardWithGates(
  db: DB,
  companionId: string,
  requestedSelfType: string,
  pending: PendingEvent[],
): GatedAward {
  const run = db.transaction((): GatedAward => {
    let selfType = requestedSelfType;
    // Honor-system damper: summary-classified elevated events cap per day;
    // hook-verified events below are exempt.
    if (selfType !== 'observe' && selfType !== 'session') {
      const elevated = (db.prepare(
        "SELECT COUNT(*) AS n FROM xp_events WHERE companion_id = ? AND date(created_at) = date('now') AND event_type IN ('commit','tests_passed','bug_fix','deploy')"
      ).get(companionId) as any)?.n ?? 0;
      if (shouldDampenSelfReport(elevated)) selfType = 'observe';
    }

    const worldEvents: string[] = [selfType];
    for (const ev of pending) {
      if (XP_REWARDS[ev.type] !== undefined) worldEvents.push(ev.type);
    }

    let xpResult = awardXpBatchCore(db, companionId, worldEvents);

    // Streak milestone: first award of a new day landing on a 7-day multiple.
    // Awarded through the core so its XP and Zeny (500z) actually land.
    if (checkStreakMilestone(db, companionId, worldEvents.length)) {
      worldEvents.push('streak_7');
      const streakResult = awardXpBatchCore(db, companionId, ['streak_7']);
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
