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

  // WAL journaling — readers don't block writers, writers don't block
  // readers. Critical now that the Stop hook process holds the same DB
  // open as the long-running MCP server: extraction calls take seconds,
  // the MCP can't be locked out of buddy_status / buddy_observe writes
  // for that long. WAL is per-database (not per-connection), idempotent.
  db.pragma('journal_mode = WAL');

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

  // Hook-driven extraction needs a per-companion high-water mark so the
  // UserPromptSubmit hook knows which findings have already been injected
  // into a previous prompt. The PRAGMA-check-then-ALTER pattern is NOT
  // atomic — wrap in try/catch matching the existing migration style in
  // src/db/schema.ts so a race between the MCP server and a Stop-hook
  // process both running initDb() for the first time can't crash either.
  try {
    db.exec(`ALTER TABLE reasoning_observe_seq ADD COLUMN last_delivered_finding_id INTEGER NOT NULL DEFAULT 0`);
  } catch { /* column already exists */ }

  // Per-Claude-Code-session incremental extraction state. Keyed by the
  // host's session id (not buddy's session id) because a transcript file
  // is the unit of "what we've already extracted from." A buddy session
  // (cwd-hash + day) groups graph claims by workspace, but the *source*
  // of truth for what's been processed is the host's transcript.
  //
  // Without this table, every Stop hook re-extracts the last ~50 turns
  // and the graph fills with duplicates. With it, we only process turns
  // newer than `last_extracted_turn_count`.
  db.exec(`
    CREATE TABLE IF NOT EXISTS reasoning_extraction_state (
      host_session_id TEXT PRIMARY KEY,
      last_extracted_turn_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);

  // Persistent extraction telemetry. Counters in `telemetry.ts` reset per
  // process; the Stop hook is a fresh Node process every fire, so its
  // counters never accumulate. The MCP server's `buddy_doctor` reads this
  // table for cross-process aggregates: success/failure rates, dominant
  // failure reason, consecutive-failure backoff state.
  //
  // failure_reasons_json is a JSON-encoded Record<bucket, count>. We could
  // normalize into a separate row-per-bucket table but the bucket set is
  // small and bounded (~6 keys); a JSON blob keeps the read path single-row.
  db.exec(`
    CREATE TABLE IF NOT EXISTS reasoning_extraction_stats (
      companion_id TEXT PRIMARY KEY,
      attempts_total INTEGER NOT NULL DEFAULT 0,
      succeeded_total INTEGER NOT NULL DEFAULT 0,
      failed_total INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      failure_reasons_json TEXT NOT NULL DEFAULT '{}',
      last_attempt_at INTEGER,
      last_success_at INTEGER,
      last_failure_at INTEGER,
      last_failure_reason TEXT,
      findings_delivered_total INTEGER NOT NULL DEFAULT 0,
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
