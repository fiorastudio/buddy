// src/lib/reasoning/schema.ts
//
// Additive schema for claims + edges + guard_mode column. Called from initDb()
// so it lands on startup alongside buddy's existing migrations.
//
// Pattern: CREATE TABLE IF NOT EXISTS for new tables; PRAGMA-then-ALTER for
// new columns on existing tables. Idempotent across SQLite versions.

import type Database from 'better-sqlite3';

export function initReasoningSchema(db: Database.Database): void {
  // Ensure foreign key enforcement is on for this connection. SQLite turns
  // this off by default for backward compatibility; our CASCADEs rely on it.
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS reasoning_claims (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      speaker TEXT NOT NULL,
      text TEXT NOT NULL,
      basis TEXT NOT NULL,
      confidence TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reasoning_claims_session
      ON reasoning_claims(session_id, created_at);

    CREATE TABLE IF NOT EXISTS reasoning_edges (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      from_claim TEXT NOT NULL,
      to_claim TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reasoning_edges_session
      ON reasoning_edges(session_id);

    CREATE INDEX IF NOT EXISTS idx_reasoning_edges_to
      ON reasoning_edges(session_id, to_claim);

    CREATE INDEX IF NOT EXISTS idx_reasoning_edges_from
      ON reasoning_edges(session_id, from_claim);

    CREATE TABLE IF NOT EXISTS reasoning_findings_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      companion_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      finding_type TEXT NOT NULL,
      anchor_claim_id TEXT NOT NULL,
      observe_seq INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(companion_id) REFERENCES companions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_findings_log_companion
      ON reasoning_findings_log(companion_id, observe_seq);

    CREATE TABLE IF NOT EXISTS reasoning_observe_seq (
      companion_id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL DEFAULT 0,
      last_claims_received_seq INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(companion_id) REFERENCES companions(id) ON DELETE CASCADE
    );
  `);

  // Add guard_mode column to companions (PRAGMA-then-alter for idempotency).
  // Four-way branch with mutually exclusive precedence:
  //   guard_mode + insight_mode both exist → copy insight_mode value, drop old column
  //   guard_mode exists alone → no-op (already migrated)
  //   insight_mode exists → rename to guard_mode
  //   max_mode exists → rename to guard_mode
  //   none exist → add guard_mode fresh
  const cols = db.prepare(`PRAGMA table_info(companions)`).all() as Array<{ name: string }>;
  const hasGuardMode = cols.some(c => c.name === 'guard_mode');
  if (hasGuardMode) {
    // Edge case: both columns exist from a partial migration. Preserve the
    // user's insight_mode=1 setting by copying it into guard_mode.
    const hasInsightMode = cols.some(c => c.name === 'insight_mode');
    if (hasInsightMode) {
      db.exec(`UPDATE companions SET guard_mode = insight_mode WHERE guard_mode = 0 AND insight_mode != 0`);
    }
  } else {
    const hasInsightMode = cols.some(c => c.name === 'insight_mode');
    const hasMaxMode = cols.some(c => c.name === 'max_mode');
    if (hasInsightMode) {
      db.exec(`ALTER TABLE companions RENAME COLUMN insight_mode TO guard_mode`);
    } else if (hasMaxMode) {
      db.exec(`ALTER TABLE companions RENAME COLUMN max_mode TO guard_mode`);
    } else {
      db.exec(`ALTER TABLE companions ADD COLUMN guard_mode INTEGER DEFAULT 0`);
    }
  }
}
