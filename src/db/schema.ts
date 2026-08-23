import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { initReasoningSchema } from '../lib/reasoning/schema.js';

// BUDDY_DB_PATH env var allows tests to use an isolated DB
// instead of the production ~/.buddy/buddy.db
const dbPath = process.env.BUDDY_DB_PATH || path.join(homedir(), '.buddy', 'buddy.db');
mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
// Two processes hold this file open: the long-lived MCP server and the per-turn
// UserPromptSubmit hook (which writes reasoning_reinject on the user's critical
// path). WAL is the standard journaling mode for concurrent SQLite access —
// readers don't block the writer and vice-versa — so the hook never stalls on
// the server's transaction; busy_timeout then only covers the rare writer-writer
// race. WAL adds buddy.db-wal / buddy.db-shm sidecars next to buddy.db; if you
// sync ~/.buddy across machines they must travel with the main DB.
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      species TEXT NOT NULL,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      mood TEXT DEFAULT 'happy',
      personality_bio TEXT DEFAULT '',
      user_id TEXT,
      stat_debugging INTEGER,
      stat_patience INTEGER,
      stat_chaos INTEGER,
      stat_wisdom INTEGER,
      stat_snark INTEGER,
      stat_points_available INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 1,
      tag TEXT,
      metadata TEXT,
      is_consolidated INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(companion_id) REFERENCES companions(id)
    );

    CREATE TABLE IF NOT EXISTS xp_events (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      event_type TEXT NOT NULL,
      xp_gained INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(companion_id) REFERENCES companions(id)
    );

    CREATE TABLE IF NOT EXISTS evolution_history (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      from_level INTEGER NOT NULL,
      to_level INTEGER NOT NULL,
      from_species TEXT NOT NULL,
      to_species TEXT NOT NULL,
      is_shiny INTEGER DEFAULT 0,
      is_mutation INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(companion_id) REFERENCES companions(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      companion_id TEXT,
      start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      end_time DATETIME,
      context_summary TEXT,
      FOREIGN KEY(companion_id) REFERENCES companions(id)
    );
  `);

  // Migration: add observer_mode column (safe for existing DBs)
  try {
    db.exec(`ALTER TABLE companions ADD COLUMN observer_mode TEXT DEFAULT 'both'`);
  } catch { /* column already exists */ }

  // Migration: add cc_rescue flag for CC-imported buddies (uses Bun wyhash for stats)
  try {
    db.exec(`ALTER TABLE companions ADD COLUMN cc_rescue INTEGER DEFAULT 0`);
  } catch { /* column already exists */ }

  // Migration: add stat columns for growth
  try { db.exec(`ALTER TABLE companions ADD COLUMN stat_debugging INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE companions ADD COLUMN stat_patience INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE companions ADD COLUMN stat_chaos INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE companions ADD COLUMN stat_wisdom INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE companions ADD COLUMN stat_snark INTEGER`); } catch {}
  try { db.exec(`ALTER TABLE companions ADD COLUMN stat_points_available INTEGER DEFAULT 0`); } catch {}

  // Reasoning-layer migration (claims/edges tables + guard_mode column).
  initReasoningSchema(db);

  // Collapse any legacy duplicate companion rows down to a single canonical
  // buddy. Runs last, after every table exists, so child-row cleanup is safe.
  repairDuplicateCompanions();
}

/**
 * Repair legacy databases that accumulated more than one companion row.
 *
 * The old buddy_hatch did a bare INSERT, so hatching repeatedly left several
 * rows behind. Every read path uses `SELECT ... LIMIT 1` with no ORDER BY, so
 * those extras are stale duplicates that can shadow the real buddy (deleting a
 * single row — as an earlier fix attempt did — is not enough when three or more
 * exist). This collapses them down to one.
 *
 * The survivor is the most-progressed companion (highest XP): because the buggy
 * LIMIT-1 read funnelled all observe/pet XP into whichever single row it kept
 * surfacing, that row is the buddy the user actually raised; the rest are
 * level-1 duplicates. Ties resolve to the earliest row (natural rowid order) —
 * the buddy that was surfaced first.
 *
 * Returns the number of duplicate rows removed. Idempotent: a no-op at 0 or 1.
 */
export function repairDuplicateCompanions(): number {
  const rows = db.prepare('SELECT id, xp FROM companions').all() as Array<{ id: string; xp: number }>;
  if (rows.length <= 1) return 0;

  let keep = rows[0];
  for (const r of rows) {
    if ((r.xp || 0) > (keep.xp || 0)) keep = r;
  }
  const doomed = rows.filter(r => r.id !== keep.id).map(r => r.id);

  // One transaction so a crash mid-repair can never leave the DB half-collapsed.
  // Legacy tables (sessions/xp_events/memories/evolution_history) have no
  // ON DELETE CASCADE and foreign_keys is ON, so clear children before the
  // parent row; the reasoning_* tables cascade via their own FK.
  const purge = db.transaction((ids: string[]) => {
    for (const id of ids) {
      db.prepare('DELETE FROM sessions WHERE companion_id = ?').run(id);
      db.prepare('DELETE FROM evolution_history WHERE companion_id = ?').run(id);
      db.prepare('DELETE FROM xp_events WHERE companion_id = ?').run(id);
      db.prepare('DELETE FROM memories WHERE companion_id = ?').run(id);
      db.prepare('DELETE FROM reasoning_findings_log WHERE companion_id = ?').run(id);
      db.prepare('DELETE FROM reasoning_observe_seq WHERE companion_id = ?').run(id);
      db.prepare('DELETE FROM companions WHERE id = ?').run(id);
    }
  });
  purge(doomed);

  return doomed.length;
}
