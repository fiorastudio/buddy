import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, initDb } from '../db/schema.js';
import { awardXpBatchCore, awardWithGates, HOOK_DEDUPE_WINDOW_MINUTES } from '../lib/award.js';
import { appendPendingEvent, consumePendingEvents } from '../lib/pending-events.js';
import { classifySummary, SELF_REPORT_DAILY_CAP } from '../lib/xp-classify.js';
import { hasXpReward, xpRewardFor } from '../lib/leveling.js';

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
 * X2: the damper used to count every elevated row of the day regardless of
 * source, so after 8 hook-verified test runs every self-reported bug_fix paid
 * as a plain observe. Only self-reports may use up the self-report cap.
 */
describe('awardWithGates — damper counts self-reports only (X2)', () => {
  it('hook-verified events do not use up the self-report cap', () => {
    // A day of green test runs, all seen by the PostToolUse hook.
    for (let i = 0; i < SELF_REPORT_DAILY_CAP + 2; i++) {
      awardWithGates(db, ID, 'observe', [{ type: 'tests_passed' }]);
    }
    expect(countType('tests_passed')).toBe(SELF_REPORT_DAILY_CAP + 2);

    const { worldEvents } = awardWithGates(db, ID, 'bug_fix', []);
    expect(worldEvents[0]).toBe('bug_fix'); // still pays as a bug fix
    expect(xp()).toBe(eventSum());
  });

  it('self-reports still hit the cap, whatever the hook did', () => {
    for (let i = 0; i < 5; i++) awardWithGates(db, ID, 'observe', [{ type: 'commit' }]);
    for (let i = 0; i < SELF_REPORT_DAILY_CAP; i++) {
      expect(awardWithGates(db, ID, 'bug_fix', []).worldEvents[0]).toBe('bug_fix');
    }
    expect(awardWithGates(db, ID, 'bug_fix', []).worldEvents[0]).toBe('observe');
    expect(countType('bug_fix')).toBe(SELF_REPORT_DAILY_CAP);
    expect(xp()).toBe(eventSum());
  });

  it('records the source of every row it writes', () => {
    awardWithGates(db, ID, 'bug_fix', [{ type: 'commit' }]);
    const rows = db.prepare(
      'SELECT event_type, source FROM xp_events WHERE companion_id = ? ORDER BY rowid',
    ).all(ID);
    expect(rows).toEqual([
      { event_type: 'bug_fix', source: 'self' },
      { event_type: 'commit', source: 'hook' },
    ]);
  });

  it('legacy rows with no recorded source count as self-reports', () => {
    for (let i = 0; i < SELF_REPORT_DAILY_CAP; i++) seedPastEvent(`legacy-${i}`, 'tests_passed', 20, 0);
    expect(awardWithGates(db, ID, 'bug_fix', []).worldEvents[0]).toBe('observe');
  });
});

/**
 * X3: pending-events.jsonl is global. Session B's observe can consume the
 * commit session A's hook queued; A's own observe then finds the queue empty
 * and, before the fix, paid its "committed …" summary as a second commit.
 */
describe('awardWithGates — cross-session hook/self-report dedupe (X3)', () => {
  let dir: string;
  let queue: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'buddy-x3-'));
    queue = join(dir, 'pending-events.jsonl');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('pays once when another session consumed the hook event (the double-pay)', () => {
    // Session A runs `git commit`; its PostToolUse hook queues the event.
    appendPendingEvent(queue, { type: 'commit', ts: Date.now() });
    // Session B observes first and drains the shared queue.
    const b = awardWithGates(db, ID, classifySummary('wrote a CSV parser'), consumePendingEvents(queue));
    expect(b.worldEvents).toEqual(['observe', 'commit']);
    // Session A observes with an honest summary of the same commit.
    const pendingForA = consumePendingEvents(queue);
    expect(pendingForA).toEqual([]);
    const a = awardWithGates(db, ID, classifySummary('committed the parser refactor'), pendingForA);

    expect(a.worldEvents).toEqual(['observe']); // folded into B's hook row
    expect(countType('commit')).toBe(1);        // one real commit, paid once
    expect(xp()).toBe(eventSum());
    const selfRow = db.prepare(
      "SELECT dedupe_of FROM xp_events WHERE companion_id = ? AND source = 'self' ORDER BY rowid DESC LIMIT 1",
    ).get(ID) as { dedupe_of: string };
    const hookRow = db.prepare(
      "SELECT id FROM xp_events WHERE companion_id = ? AND source = 'hook'",
    ).get(ID) as { id: string };
    expect(selfRow.dedupe_of).toBe(hookRow.id);
  });

  it('still dedupes within one session (hook event consumed by the same award)', () => {
    const { worldEvents } = awardWithGates(db, ID, 'commit', [{ type: 'commit' }]);
    expect(worldEvents).toEqual(['observe', 'commit']);
    expect(countType('commit')).toBe(1);
    expect(xp()).toBe(eventSum());
  });

  it('each hook row absorbs at most one self-report', () => {
    awardWithGates(db, ID, 'observe', [{ type: 'commit' }]); // B consumes A's commit
    const first = awardWithGates(db, ID, 'commit', []);      // A: folded
    const second = awardWithGates(db, ID, 'commit', []);     // nothing left to fold into
    expect(first.worldEvents[0]).toBe('observe');
    expect(second.worldEvents[0]).toBe('commit');
    expect(countType('commit')).toBe(2);
  });

  it('two real commits back two self-reports', () => {
    awardWithGates(db, ID, 'observe', [{ type: 'commit' }, { type: 'commit' }]);
    expect(awardWithGates(db, ID, 'commit', []).worldEvents[0]).toBe('observe');
    expect(awardWithGates(db, ID, 'commit', []).worldEvents[0]).toBe('observe');
    expect(countType('commit')).toBe(2);
  });

  it('only folds into a hook event of the same type', () => {
    awardWithGates(db, ID, 'observe', [{ type: 'tests_passed' }]);
    expect(awardWithGates(db, ID, 'commit', []).worldEvents[0]).toBe('commit');
  });

  it('ignores hook events outside the dedupe window', () => {
    db.prepare(
      `INSERT INTO xp_events (id, companion_id, event_type, xp_gained, source, created_at)
       VALUES ('old-hook', ?, 'commit', 0, 'hook', datetime('now', ?))`,
    ).run(ID, `-${HOOK_DEDUPE_WINDOW_MINUTES + 1} minutes`);
    expect(awardWithGates(db, ID, 'commit', []).worldEvents[0]).toBe('commit');
  });

  it('does not fold into legacy rows with no recorded source', () => {
    seedPastEvent('legacy-commit', 'commit', 25, 0);
    expect(awardWithGates(db, ID, 'commit', []).worldEvents[0]).toBe('commit');
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

/**
 * X7: XP_REWARDS is a plain object, so `XP_REWARDS['__proto__']` is
 * Object.prototype and `XP_REWARDS['constructor']` is a function. A queued
 * hook event with such a type passed the `!== undefined` filter, then failed
 * to bind as xp_gained and threw — aborting the whole award.
 */
describe('prototype-key event types (X7)', () => {
  const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];

  it('xpRewardFor / hasXpReward only honor own keys', () => {
    for (const k of PROTO_KEYS) {
      expect(hasXpReward(k), k).toBe(false);
      expect(xpRewardFor(k), k).toBe(1);
    }
    expect(hasXpReward('commit')).toBe(true);
    expect(xpRewardFor('commit')).toBe(25);
    expect(xpRewardFor('pet')).toBe(1);
  });

  it('drops prototype-key hook events instead of aborting the award', () => {
    const pending = [...PROTO_KEYS.map((type) => ({ type })), { type: 'commit' }];
    const { worldEvents, xpResult } = awardWithGates(db, ID, 'observe', pending);
    expect(worldEvents).toEqual(['observe', 'commit']);
    expect(xpResult.xpGained).toBeGreaterThan(0);
    expect(xp()).toBe(eventSum());
  });

  it('pays a prototype-key type passed straight to the core as the 1-XP fallback', () => {
    const r = awardXpBatchCore(db, ID, ['constructor']);
    expect(Number.isFinite(r.xpGained)).toBe(true);
    expect(xp()).toBe(eventSum());
  });

  it('drops prototype-key types read from the pending-events file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'buddy-x7-'));
    try {
      const queue = join(dir, 'pending-events.jsonl');
      for (const type of PROTO_KEYS) appendPendingEvent(queue, { type, ts: Date.now() });
      const { worldEvents } = awardWithGates(db, ID, 'observe', consumePendingEvents(queue));
      expect(worldEvents).toEqual(['observe']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
