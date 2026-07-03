import { db } from '../db/schema.js';
import { loadCompanion } from './companion.js';
import type { StatName } from './types.js';

export type AllocateResult =
  | { ok: true; spent: number; newValue: number; remaining: number }
  | { ok: false; reason: 'no_companion' | 'no_points' | 'at_cap' | 'invalid_points' };

/**
 * Spend `points` stat points on `stat` for the companion identified by
 * `companionId`.
 *
 * Resolves NULL stat columns (rescued/legacy companions that predate the stat
 * migration) via loadCompanion's bones fallback before writing. This prevents
 * NULL + n = NULL corruption that SQL-level increment would produce.
 *
 * `points` must be a positive integer; non-integer or non-positive values
 * return { ok: false, reason: 'invalid_points' }.
 */
export function applyStatAllocation(companionId: string, stat: StatName, points: number): AllocateResult {
  if (!Number.isInteger(points) || points < 1) {
    return { ok: false, reason: 'invalid_points' };
  }

  const row = db.prepare('SELECT * FROM companions WHERE id = ?').get(companionId) as any;
  if (!row) return { ok: false, reason: 'no_companion' };

  const available = row.stat_points_available ?? 0;
  if (available <= 0) return { ok: false, reason: 'no_points' };

  // loadCompanion resolves NULL stat columns to deterministic bones values so
  // a rescued companion with missing stat_ rows is handled correctly.
  const companion = loadCompanion(row)!;
  const currentValue = companion.stats[stat];
  if (currentValue >= 100) return { ok: false, reason: 'at_cap' };

  const canSpend = Math.min(points, available, 100 - currentValue);
  const newValue = currentValue + canSpend;

  // Column names are stat_debugging / stat_patience / etc. (not the bare stat name).
  // Write a concrete value rather than `col = col + ?` so NULL-column rows are
  // initialised to the bones value rather than producing NULL.
  const dbCol = `stat_${stat.toLowerCase()}`;
  db.prepare(`UPDATE companions SET ${dbCol} = ?, stat_points_available = stat_points_available - ? WHERE id = ?`)
    .run(newValue, canSpend, companionId);

  const after = db.prepare('SELECT stat_points_available FROM companions WHERE id = ?').get(companionId) as any;
  return { ok: true, spent: canSpend, newValue, remaining: after.stat_points_available ?? 0 };
}
