import { db } from '../db/schema.js';
import { loadCompanion } from './companion.js';
import { STAT_NAMES, type StatName } from './types.js';

export type AllocateResult =
  | { ok: true; spent: number; newValue: number; remaining: number }
  | { ok: false; reason: 'no_companion' | 'no_points' | 'at_cap' | 'invalid_points' | 'invalid_stat' };

/**
 * Spend `points` stat points on `stat` for the companion identified by
 * `companionId`.
 *
 * Resolves NULL stat columns (rescued/legacy companions that predate the stat
 * migration) via loadCompanion's bones fallback before writing. This prevents
 * NULL + n = NULL corruption that SQL-level increment would produce.
 *
 * `stat` is re-validated against STAT_NAMES here (not just by the MCP handler)
 * because it gets interpolated into the UPDATE column list below — this
 * function, not its caller, is what has to guarantee that's safe.
 *
 * `points` must be a positive integer; non-integer or non-positive values
 * return { ok: false, reason: 'invalid_points' }.
 *
 * The read-check-write runs as one BEGIN IMMEDIATE transaction. Two processes
 * hold this DB file open (the MCP server and the UserPromptSubmit hook), and
 * under WAL a deferred transaction that reads first can fail its write upgrade
 * (SQLITE_BUSY_SNAPSHOT) if the other process commits in between — immediate
 * mode takes the write lock up front, so busy_timeout does the waiting and the
 * SELECT-then-UPDATE pair is atomic.
 */
export function applyStatAllocation(companionId: string, stat: StatName, points: number): AllocateResult {
  if (!STAT_NAMES.includes(stat)) {
    return { ok: false, reason: 'invalid_stat' };
  }
  if (!Number.isInteger(points) || points < 1) {
    return { ok: false, reason: 'invalid_points' };
  }

  const allocate = db.transaction((): AllocateResult => {
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

    // Column names are stat_debugging / stat_patience / etc. (not the bare stat
    // name). `stat` is guaranteed to be one of STAT_NAMES at this point, so this
    // interpolation can't produce an arbitrary column reference.
    // Write a concrete value rather than `col = col + ?` so NULL-column rows are
    // initialised to the bones value rather than producing NULL.
    const dbCol = `stat_${stat.toLowerCase()}`;
    db.prepare(`UPDATE companions SET ${dbCol} = ?, stat_points_available = stat_points_available - ? WHERE id = ?`)
      .run(newValue, canSpend, companionId);

    const after = db.prepare('SELECT stat_points_available FROM companions WHERE id = ?').get(companionId) as any;
    return { ok: true, spent: canSpend, newValue, remaining: after.stat_points_available ?? 0 };
  });

  return allocate.immediate();
}
