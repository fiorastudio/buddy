import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, db } from '../db/schema.js';
import { createCompanion, rescueCompanion, loadCompanion } from '../lib/companion.js';
import { applyStatAllocation } from '../lib/allocate.js';

beforeEach(() => {
  initDb();
  db.prepare('DELETE FROM xp_events').run();
  db.prepare('DELETE FROM memories').run();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM evolution_history').run();
  db.prepare('DELETE FROM companions').run();
});

function givePoints(id: string, pts: number) {
  db.prepare('UPDATE companions SET stat_points_available = ? WHERE id = ?').run(pts, id);
}

function getRow(id: string): any {
  return db.prepare('SELECT * FROM companions WHERE id = ?').get(id);
}

// ─── fresh companions ────────────────────────────────────────────────────────

describe('fresh companion', () => {
  it('raises the target stat by the requested amount', () => {
    const { id } = createCompanion({ userId: 'fresh-1' });
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
    givePoints(id, 3);
    applyStatAllocation(id, 'DEBUGGING', 2);
    const row = getRow(id);
    // stat_debugging must be updated; the bare "debugging" column does not exist
    expect(typeof row.stat_debugging).toBe('number');
    expect(row.stat_debugging).toBeGreaterThan(0);
    // sanity: stat_points_available must be decremented
    expect(row.stat_points_available).toBe(1);
  });

  it('does not touch other stat columns', () => {
    const { id } = createCompanion({ userId: 'fresh-notouch' });
    givePoints(id, 5);
    const before = loadCompanion(getRow(id))!;
    applyStatAllocation(id, 'CHAOS', 2);
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

describe('rescued companion (NULL stat columns)', () => {
  it('initialises a NULL stat column rather than producing NULL', () => {
    const { id } = rescueCompanion({ name: 'Nullbert', species: 'Lava Salamander' });
    // rescueCompanion does not set stat_* columns, so they are NULL
    expect(getRow(id).stat_snark).toBeNull();

    givePoints(id, 5);

    const companion = loadCompanion(getRow(id))!; // bones fallback resolves NULL
    const expectedNew = companion.stats.SNARK + 2;

    const result = applyStatAllocation(id, 'SNARK', 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = getRow(id);
    expect(row.stat_snark).toBe(expectedNew); // must be a number, not NULL
    expect(result.newValue).toBe(expectedNew);
  });

  it('deducts stat_points_available correctly even with NULL stat columns', () => {
    const { id } = rescueCompanion({ name: 'Nullbert2' });
    givePoints(id, 8);
    applyStatAllocation(id, 'CHAOS', 3);
    expect(getRow(id).stat_points_available).toBe(5);
  });

  it('returns the correct remaining count after multiple allocations on a rescued companion', () => {
    const { id } = rescueCompanion({ name: 'Nullbert3' });
    givePoints(id, 10);
    applyStatAllocation(id, 'PATIENCE', 4);
    const result = applyStatAllocation(id, 'WISDOM', 2);
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
    db.prepare('UPDATE companions SET stat_points_available = stat_points_available + 10 WHERE id = ?').run(id);
    expect(getRow(id).stat_points_available).toBe(10);
    const result = applyStatAllocation(id, 'WISDOM', 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.remaining).toBe(0);
  });
});
