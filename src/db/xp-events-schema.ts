// src/db/xp-events-schema.ts
//
// Provenance columns on the xp_events ledger. Called from initDb().
//
//   source     'self'   — the buddy_observe / buddy_pet award itself (the
//                         summary-classified, honor-system channel)
//              'hook'   — a ground-truth event the PostToolUse hook queued in
//                         pending-events.jsonl (commit / deploy / tests_passed)
//              'system' — derived awards such as streak_7
//              NULL     — rows written before this column existed
//   dedupe_of  on a self-report that was folded into a hook-verified event of
//              the same type, the id of that hook row. Each hook row absorbs at
//              most one self-report, across sessions (see lib/award.ts).
//
// Pure DDL, no backfill (a legacy row's provenance is unknowable), so it is
// safe to run on every initDb(): a duplicate-column ALTER fails at prepare
// time and CREATE INDEX IF NOT EXISTS is a no-op — neither takes the write lock.

import type Database from 'better-sqlite3';
import { addColumnIfMissing } from './add-column.js';

export function initXpEventsSchema(conn: Database.Database): void {
  // Only "duplicate column name" is ignored; SQLITE_BUSY, a read-only or
  // corrupt file etc. propagate out of initDb() instead of leaving the award
  // INSERT to fail later on a missing column (X11).
  addColumnIfMissing(conn, 'xp_events', 'source TEXT');
  addColumnIfMissing(conn, 'xp_events', 'dedupe_of TEXT');
  conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_xp_events_dedupe_of
      ON xp_events(dedupe_of) WHERE dedupe_of IS NOT NULL;
  `);
}
