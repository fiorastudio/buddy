import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { initDb, db } from '../db/schema.js';
import { createCompanion, rescueCompanion, loadCompanion } from '../lib/companion.js';
import { applyStatAllocation } from '../lib/allocate.js';
import { STAT_NAMES } from '../lib/types.js';
// Safe to import: server/index.ts only auto-starts when run directly
// (same pattern as self-healing.test.ts importing recalcMood).
import { awardXpAndRefresh } from '../server/index.js';
import { XP_REWARDS, levelFromXp } from '../lib/leveling.js';

function wipeCompanionData() {
  // Children before parents: foreign_keys is ON (initReasoningSchema enables it).
  db.prepare('DELETE FROM xp_events').run();
  db.prepare('DELETE FROM memories').run();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM evolution_history').run();
  db.prepare('DELETE FROM companions').run();
}

beforeEach(() => {
  initDb();
  wipeCompanionData();
});

// Test files share one BUDDY_DB_PATH file (see vitest.config.ts). The
// awardXpAndRefresh tests insert xp_events rows; leave the DB empty so later
// files whose cleanup only does `DELETE FROM companions` don't hit the
// xp_events foreign key.
afterAll(() => {
  wipeCompanionData();
});

function givePoints(id: string, pts: number) {
  db.prepare('UPDATE companions SET stat_points_available = ? WHERE id = ?').run(pts, id);
}

function getRow(id: string): any {
  return db.prepare('SELECT * FROM companions WHERE id = ?').get(id);
}

// Deterministic rolls can put a rarity's "peak stat" at 100 already, which
// would spuriously trip the at_cap path in tests that just want to exercise
// plain allocation bookkeeping. Pin a stat to a known-safe baseline so those
// tests don't depend on which stat a given userId happens to roll as peak.
function pinStat(id: string, stat: string, value: number) {
  db.prepare(`UPDATE companions SET stat_${stat.toLowerCase()} = ? WHERE id = ?`).run(value, id);
}

// ─── fresh companions ────────────────────────────────────────────────────────

describe('fresh companion', () => {
  it('raises the target stat by the requested amount', () => {
    const { id } = createCompanion({ userId: 'fresh-1' });
    pinStat(id, 'SNARK', 50);
    givePoints(id, 5);
    const before = loadCompanion(getRow(id))!;
    const result = applyStatAllocation(id, 'SNARK', 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spent).toBe(3);
    expect(result.newValue).toBe(before.stats.SNARK + 3);
    expect(result.remaining).toBe(2);
  });

  it('writes the correct stat_ column name (not the bare stat name)', () => {
    const { id } = createCompanion({ userId: 'fresh-col' });
    pinStat(id, 'DEBUGGING', 50);
    givePoints(id, 3);
    applyStatAllocation(id, 'DEBUGGING', 2);
    const row = getRow(id);
    // stat_debugging must be updated; the bare "debugging" column does not exist
    expect(row.stat_debugging).toBe(52);
    // sanity: stat_points_available must be decremented
    expect(row.stat_points_available).toBe(1);
  });

  it('does not touch other stat columns', () => {
    const { id } = createCompanion({ userId: 'fresh-notouch' });
    pinStat(id, 'CHAOS', 50); // ensure the target actually has headroom to write
    givePoints(id, 5);
    const before = loadCompanion(getRow(id))!;
    const result = applyStatAllocation(id, 'CHAOS', 2);
    expect(result.ok).toBe(true);
    const after = loadCompanion(getRow(id))!;
    expect(after.stats.DEBUGGING).toBe(before.stats.DEBUGGING);
    expect(after.stats.PATIENCE).toBe(before.stats.PATIENCE);
    expect(after.stats.WISDOM).toBe(before.stats.WISDOM);
    expect(after.stats.SNARK).toBe(before.stats.SNARK);
  });

  it('returns no_points when none are available', () => {
    const { id } = createCompanion({ userId: 'fresh-nopoints' });
    const result = applyStatAllocation(id, 'WISDOM', 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_points');
  });
});

// ─── rescued companions (NULL stat columns) ──────────────────────────────────
//
// These tests can't pin the target stat -- the whole point is to exercise the
// NULL-column bones-fallback path. Instead they dynamically pick any stat
// that currently has headroom (a rescued companion has at most one stat
// pinned near a cap by its rarity roll, so 4 of 5 are virtually guaranteed to
// have room).

describe('rescued companion (NULL stat columns)', () => {
  it('initialises a NULL stat column rather than producing NULL', () => {
    const { id } = rescueCompanion({ name: 'Nullbert', species: 'Lava Salamander' });
    // rescueCompanion does not set stat_* columns, so they are all NULL
    const row0 = getRow(id);
    for (const s of STAT_NAMES) {
      expect(row0[`stat_${s.toLowerCase()}`]).toBeNull();
    }

    givePoints(id, 5);

    const companion = loadCompanion(getRow(id))!; // bones fallback resolves NULL
    const stat = STAT_NAMES.find(s => companion.stats[s] < 100)!;
    const expectedNew = companion.stats[stat] + 2;

    const result = applyStatAllocation(id, stat, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = getRow(id);
    expect(row[`stat_${stat.toLowerCase()}`]).toBe(expectedNew); // must be a number, not NULL
    expect(result.newValue).toBe(expectedNew);
  });

  it('deducts stat_points_available correctly even with NULL stat columns', () => {
    const { id } = rescueCompanion({ name: 'Nullbert2' });
    givePoints(id, 8);
    const companion = loadCompanion(getRow(id))!;
    const stat = STAT_NAMES.find(s => companion.stats[s] < 98)!; // headroom for 3 points
    const result = applyStatAllocation(id, stat, 3);
    expect(result.ok).toBe(true);
    expect(getRow(id).stat_points_available).toBe(5);
  });

  it('returns the correct remaining count after multiple allocations on a rescued companion', () => {
    const { id } = rescueCompanion({ name: 'Nullbert3' });
    givePoints(id, 10);
    const companion = loadCompanion(getRow(id))!;
    const [statA, statB] = STAT_NAMES.filter(s => companion.stats[s] < 96); // headroom for 4 then 2
    const r1 = applyStatAllocation(id, statA, 4);
    const result = applyStatAllocation(id, statB, 2);
    expect(r1.ok).toBe(true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remaining).toBe(4);
  });
});

// ─── stat cap ────────────────────────────────────────────────────────────────

describe('stat cap', () => {
  it('returns at_cap when the target stat is already 100', () => {
    const { id } = createCompanion({ userId: 'cap-1' });
    givePoints(id, 5);
    db.prepare('UPDATE companions SET stat_debugging = 100 WHERE id = ?').run(id);
    const result = applyStatAllocation(id, 'DEBUGGING', 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('at_cap');
  });

  it('clamps spending so the stat does not exceed 100', () => {
    const { id } = createCompanion({ userId: 'cap-clamp' });
    givePoints(id, 10);
    db.prepare('UPDATE companions SET stat_patience = 98 WHERE id = ?').run(id);
    const result = applyStatAllocation(id, 'PATIENCE', 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newValue).toBe(100);
    expect(result.spent).toBe(2);      // clamped from 5 to 2
    expect(result.remaining).toBe(8);  // 10 - 2
  });
});

// ─── invalid stat names ──────────────────────────────────────────────────────

describe('invalid stat names', () => {
  it('rejects a stat name outside STAT_NAMES', () => {
    const { id } = createCompanion({ userId: 'badstat-1' });
    givePoints(id, 5);
    const result = applyStatAllocation(id, 'NOTASTAT' as any, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_stat');
  });

  it('rejects a lowercase stat name (must match STAT_NAMES exactly)', () => {
    const { id } = createCompanion({ userId: 'badstat-2' });
    givePoints(id, 5);
    const result = applyStatAllocation(id, 'snark' as any, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_stat');
  });

  it('safely rejects a SQL-injection-shaped stat string without touching the DB', () => {
    const { id } = createCompanion({ userId: 'badstat-injection' });
    givePoints(id, 5);
    const before = getRow(id);

    const result = applyStatAllocation(id, 'snark = 999; DROP TABLE companions; --' as any, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_stat');

    // Table must still exist and this row must be untouched.
    const after = getRow(id);
    expect(after).toEqual(before);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='companions'").get()).toBeTruthy();
  });
});

// ─── invalid point amounts ───────────────────────────────────────────────────

describe('invalid point amounts', () => {
  it('rejects 0', () => {
    const { id } = createCompanion({ userId: 'inv-zero' });
    givePoints(id, 5);
    const result = applyStatAllocation(id, 'SNARK', 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_points');
  });

  it('rejects negative numbers', () => {
    const { id } = createCompanion({ userId: 'inv-neg' });
    givePoints(id, 5);
    const result = applyStatAllocation(id, 'CHAOS', -2);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_points');
  });

  it('rejects fractional numbers', () => {
    const { id } = createCompanion({ userId: 'inv-frac' });
    givePoints(id, 5);
    const result = applyStatAllocation(id, 'WISDOM', 1.5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('invalid_points');
  });

  it('does not mutate the DB when points are invalid', () => {
    const { id } = createCompanion({ userId: 'inv-nomut' });
    givePoints(id, 5);
    const before = getRow(id);
    applyStatAllocation(id, 'SNARK', -1);
    const after = getRow(id);
    expect(after.stat_points_available).toBe(before.stat_points_available);
  });
});

// ─── multi-level gains ───────────────────────────────────────────────────────

describe('multi-level point gains', () => {
  it('allows spending points earned across multiple levels', () => {
    const { id } = createCompanion({ userId: 'multilevel-1' });
    pinStat(id, 'SNARK', 50);
    pinStat(id, 'CHAOS', 50);
    // Simulate 3 level-ups (10 points each)
    givePoints(id, 30);
    const r1 = applyStatAllocation(id, 'SNARK', 10);
    const r2 = applyStatAllocation(id, 'CHAOS', 15);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.spent).toBe(10);
    expect(r2.spent).toBe(15);
    expect(r2.remaining).toBe(5);
  });

  it('each allocation is reflected in subsequent loadCompanion calls', () => {
    const { id } = createCompanion({ userId: 'multilevel-2' });
    pinStat(id, 'DEBUGGING', 50);
    givePoints(id, 20);
    const base = loadCompanion(getRow(id))!.stats.DEBUGGING;
    applyStatAllocation(id, 'DEBUGGING', 5);
    expect(loadCompanion(getRow(id))!.stats.DEBUGGING).toBe(base + 5);
    applyStatAllocation(id, 'DEBUGGING', 3);
    expect(loadCompanion(getRow(id))!.stats.DEBUGGING).toBe(base + 8);
  });

  it('stat_points_available from a level-up is honoured by the allocator', () => {
    // Simulate what awardXp does when a companion levels up
    const { id } = createCompanion({ userId: 'levelup-sim' });
    pinStat(id, 'WISDOM', 50);
    db.prepare('UPDATE companions SET stat_points_available = stat_points_available + 10 WHERE id = ?').run(id);
    expect(getRow(id).stat_points_available).toBe(10);
    const result = applyStatAllocation(id, 'WISDOM', 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remaining).toBe(0);
  });

  it('a single award spanning 3 levels (levelsGained * 10) can be fully spent across stats', () => {
    // Mirrors awardXp's `stat_points_available += levelsGained * 10` for a
    // 3-level jump from one XP award, then spends all 30 across 3 stats.
    const { id } = createCompanion({ userId: 'multilevel-jump' });
    pinStat(id, 'DEBUGGING', 50);
    pinStat(id, 'PATIENCE', 50);
    pinStat(id, 'SNARK', 50);
    const levelsGained = 3;
    db.prepare('UPDATE companions SET stat_points_available = stat_points_available + ? WHERE id = ?')
      .run(levelsGained * 10, id);
    expect(getRow(id).stat_points_available).toBe(30);

    const r1 = applyStatAllocation(id, 'DEBUGGING', 10);
    const r2 = applyStatAllocation(id, 'PATIENCE', 10);
    const r3 = applyStatAllocation(id, 'SNARK', 10);
    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    if (!r1.ok || !r2.ok || !r3.ok) return;
    expect(r3.remaining).toBe(0);
    expect(getRow(id).stat_points_available).toBe(0);
  });
});

// ─── refresh after awarding (awardXpAndRefresh) ──────────────────────────────
//
// The maintainer's review: "Reload the companion and update the status file
// after awarding or allocating points; current refresh logic uses stale point
// data." The allocating side is covered above; these cover the awarding side.
// awardXpAndRefresh used to patch xp/level/mood onto the caller's pre-award
// row snapshot, so on a level-up turn the returned companion carried the
// stale stat_points_available (observe/pet then wrote it to the status file).

describe('awardXpAndRefresh point freshness', () => {
  it('returns fresh availablePoints on the turn a level-up happens', () => {
    const { id } = createCompanion({ userId: 'award-refresh' });
    // Park XP so the next observe event crosses at least one level boundary,
    // while the DB still says level 1 — exactly the state awardXp levels from.
    db.prepare('UPDATE companions SET xp = 500, level = 1 WHERE id = ?').run(id);
    const staleRow = getRow(id); // handler-style snapshot taken BEFORE the award

    const { companion, xpResult } = awardXpAndRefresh(staleRow, 'observe');

    expect(xpResult.leveledUp).toBe(true);
    const levelsGained = levelFromXp(500 + XP_REWARDS.observe) - 1;
    expect(levelsGained).toBeGreaterThan(0);
    // The returned companion must reflect the points awardXp just granted —
    // the same object the observe/pet handlers pass to writeBuddyStatus.
    expect(companion.availablePoints).toBe(levelsGained * 10);
    expect(getRow(id).stat_points_available).toBe(levelsGained * 10);
  });

  it('reflects pre-existing unspent points even when no level-up occurs', () => {
    const { id } = createCompanion({ userId: 'award-noref' });
    givePoints(id, 7);
    const staleRow = getRow(id);

    const { companion, xpResult } = awardXpAndRefresh(staleRow, 'session'); // +3 xp, stays level 1

    expect(xpResult.leveledUp).toBe(false);
    expect(companion.availablePoints).toBe(7);
  });
});
