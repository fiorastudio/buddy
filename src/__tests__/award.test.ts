import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, initDb } from '../db/schema.js';
import { awardXpBatchCore, awardWithGates } from '../lib/award.js';

/**
 * Direct tests of the extracted award chokepoint (src/lib/award.ts). Because
 * the logic no longer lives inside the stdio-server module, the real award
 * path is exercisable here — the storage invariant, the streak-milestone gate
 * (which used to race across separate transactions), the honor-system damper,
 * and NULL-column safety.
 */

const ID = 'award-test-companion';

function seed(cols = '', vals = '') {
  db.prepare('DELETE FROM xp_events').run();
  db.prepare('DELETE FROM companions').run();
  db.prepare(
    `INSERT INTO companions (id, name, species, level, mood, user_id${cols})
     VALUES (?, 'Testy', 'Owl', 1, 'happy', 'anon'${vals})`,
  ).run(ID);
}

const xp = () => (db.prepare('SELECT xp FROM companions WHERE id = ?').get(ID) as { xp: number }).xp;
const zeny = () => (db.prepare('SELECT zeny FROM companions WHERE id = ?').get(ID) as { zeny: number }).zeny;
const eventSum = () =>
  (db.prepare('SELECT COALESCE(sum(xp_gained), 0) AS s FROM xp_events WHERE companion_id = ?').get(ID) as { s: number }).s;
const countType = (t: string) =>
  (db.prepare('SELECT count(*) AS n FROM xp_events WHERE companion_id = ? AND event_type = ?').get(ID, t) as { n: number }).n;

beforeEach(() => {
  initDb();
  seed(', xp, zeny', ', 0, 0');
});

afterAll(() => {
  db.prepare('DELETE FROM xp_events').run();
  db.prepare('DELETE FROM companions').run();
});

describe('awardXpBatchCore', () => {
  it('keeps companions.xp == sum(xp_events) and accrues zeny', () => {
    for (let i = 0; i < 30; i++) awardXpBatchCore(db, ID, ['observe']);
    expect(xp()).toBe(eventSum());
    expect(xp()).toBeGreaterThan(0);
    expect(zeny()).toBeGreaterThanOrEqual(0);
  });

  it('derives level and leveledUp from the post-update stored xp', () => {
    const r = awardXpBatchCore(db, ID, ['observe']);
    expect(r.newXp).toBe(xp());
    expect(r.newLevel).toBe(1);
    expect(r.leveledUp).toBe(false);
  });

  it('never wipes a legacy NULL xp/zeny row to NULL (COALESCE guard)', () => {
    seed(', xp, zeny', ', NULL, NULL');
    const r = awardXpBatchCore(db, ID, ['observe']);
    // Award still lands as a real number rather than `NULL + n = NULL`.
    expect(xp()).not.toBeNull();
    expect(zeny()).not.toBeNull();
    expect(xp()).toBe(r.newXp);
    expect(xp()).toBe(eventSum());
    expect(zeny()).toBe(r.newZeny);
  });
});

describe('awardWithGates', () => {
  it('awards a plain observe and pins the invariant', () => {
    const { xpResult, worldEvents } = awardWithGates(db, ID, 'observe', []);
    expect(worldEvents).toEqual(['observe']);
    expect(xpResult.newXp).toBe(xp());
    expect(xp()).toBe(eventSum());
  });

  it('appends hook-verified pending events to the same atomic award', () => {
    const { worldEvents } = awardWithGates(db, ID, 'observe', [{ type: 'commit' }, { type: 'not_a_reward' }]);
    expect(worldEvents).toContain('observe');
    expect(worldEvents).toContain('commit');
    expect(worldEvents).not.toContain('not_a_reward'); // unknown types are filtered
    expect(xp()).toBe(eventSum());
  });

  it('dampens an elevated self-report once the daily cap is hit', () => {
    // Seed 8 elevated events today (SELF_REPORT_DAILY_CAP = 8), crediting the
    // companion too so the xp == sum(events) invariant stays meaningful.
    for (let i = 0; i < 8; i++) seedPastEvent(`seed-${i}`, 'deploy', 60, 0);
    const { worldEvents } = awardWithGates(db, ID, 'deploy', []);
    expect(worldEvents[0]).toBe('observe'); // downgraded
    expect(xp()).toBe(eventSum());
  });
});

/**
 * Insert a ledger row `daysAgo` days back AND credit companions.xp by the same
 * amount, so hand-seeded history keeps companions.xp == sum(xp_events) — the
 * exact state a real award sequence would have left.
 */
function seedPastEvent(id: string, type: string, gained: number, daysAgo: number) {
  db.prepare(
    "INSERT INTO xp_events (id, companion_id, event_type, xp_gained, created_at) VALUES (?, ?, ?, ?, datetime('now', ?))",
  ).run(id, ID, type, gained, `-${daysAgo} days`);
  db.prepare('UPDATE companions SET xp = xp + ? WHERE id = ?').run(gained, ID);
}

describe('awardWithGates — 7-day streak milestone (the cross-transaction race)', () => {
  // Seed a distinct xp_event on each of the previous 6 UTC days, so today's
  // first award makes the streak land on 7.
  function seedSixPriorDays() {
    for (let d = 1; d <= 6; d++) seedPastEvent(`prior-${d}`, 'observe', 8, d);
  }

  it('awards streak_7 exactly once on the first award of a milestone day', () => {
    seedSixPriorDays();
    const { worldEvents } = awardWithGates(db, ID, 'observe', []);
    expect(worldEvents).toContain('streak_7');
    expect(countType('streak_7')).toBe(1);
    expect(xp()).toBe(eventSum());
  });

  it('does not re-award streak_7 on a later award the same day', () => {
    seedSixPriorDays();
    awardWithGates(db, ID, 'observe', []); // first award → streak_7
    const { worldEvents } = awardWithGates(db, ID, 'observe', []); // second award, same day
    expect(worldEvents).not.toContain('streak_7');
    expect(countType('streak_7')).toBe(1); // still exactly one, never doubled
    expect(xp()).toBe(eventSum());
  });

  it('two serialized first-of-day awards yield exactly one streak_7, not zero or two', () => {
    // BEGIN IMMEDIATE serializes concurrent awards; the second sees the first's
    // committed events and correctly detects it is not the first of the day.
    // Under the old split-transaction code both could read the pre-award count
    // and both skip (or both grant) the milestone. Two back-to-back calls model
    // the serialized outcome the transaction guarantees.
    seedSixPriorDays();
    awardWithGates(db, ID, 'observe', []);
    awardWithGates(db, ID, 'observe', []);
    expect(countType('streak_7')).toBe(1);
    expect(xp()).toBe(eventSum());
  });
});
