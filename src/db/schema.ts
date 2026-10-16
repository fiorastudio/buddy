import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import { initReasoningSchema } from '../lib/reasoning/schema.js';
import { initXpEventsSchema } from './xp-events-schema.js';

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

// `conn` defaults to the shared connection; tests pass their own to exercise a
// legacy-shaped DB file without touching the module-level one.
export function initDb(conn: Database.Database = db) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS companions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      species TEXT NOT NULL,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      mood TEXT DEFAULT 'happy',
      muted INTEGER DEFAULT 0,
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

  // xp_events provenance columns (source, dedupe_of).
  initXpEventsSchema(db);

  // Migration: add observer_mode column (safe for existing DBs)
  addColumnIfMissing(conn, 'companions', `observer_mode TEXT DEFAULT 'both'`);

  // Migration: add cc_rescue flag for CC-imported buddies (uses Bun wyhash for stats)
  addColumnIfMissing(conn, 'companions', 'cc_rescue INTEGER DEFAULT 0');

  // Migration: mute is its own flag rather than a value parked in `mood`.
  // calculateMood never returns 'muted', so every mood recompute overwrote it.
  addColumnIfMissing(conn, 'companions', 'muted INTEGER DEFAULT 0');

  // Migration: add stat columns for growth
  addColumnIfMissing(conn, 'companions', 'stat_debugging INTEGER');
  addColumnIfMissing(conn, 'companions', 'stat_patience INTEGER');
  addColumnIfMissing(conn, 'companions', 'stat_chaos INTEGER');
  addColumnIfMissing(conn, 'companions', 'stat_wisdom INTEGER');
  addColumnIfMissing(conn, 'companions', 'stat_snark INTEGER');
  addColumnIfMissing(conn, 'companions', 'stat_points_available INTEGER DEFAULT 0');

  // Migration: Zeny (RO currency) earned from coding events
  addColumnIfMissing(conn, 'companions', 'zeny INTEGER DEFAULT 0');
  // Reasoning-layer migration (claims/edges tables + guard_mode column).
  initReasoningSchema(conn);

  // One-time data backfills, gated by PRAGMA user_version.
  runVersionedMigrations(conn);
}

/** True for SQLite's "duplicate column name: x" — the column is already there. */
export function isDuplicateColumnError(err: unknown): boolean {
  return err instanceof Error && /duplicate column name/i.test(err.message);
}

/**
 * `ALTER TABLE <table> ADD COLUMN <columnDef>`, tolerating only the column
 * already existing. Anything else — SQLITE_BUSY past busy_timeout, a read-only
 * or corrupt DB file, a full disk — is rethrown (X11). The old bare
 * `catch {}` swallowed those too, so initDb() reported success with the column
 * missing and the first query that used it failed somewhere far away.
 */
export function addColumnIfMissing(conn: Database.Database, table: string, columnDef: string): void {
  try {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }
}

/**
 * One-time data migrations, keyed by `PRAGMA user_version`.
 *
 * initDb() runs on every MCP server start AND on every UserPromptSubmit hook
 * (guard mode), i.e. on the user's critical path. The DDL above is safe to
 * repeat without writing: `CREATE ... IF NOT EXISTS` on an existing object is a
 * no-op, and an ALTER on a duplicate column fails at prepare time, before
 * SQLite takes the write lock. A data UPDATE is different — it takes the write
 * lock even when it matches 0 rows, and with busy_timeout=5000 that can stall
 * the prompt behind another session's award transaction. So every data
 * backfill lives here and runs once per DB file; steady-state initDb() writes
 * nothing.
 *
 * To add one, append `{ version: <last + 1>, up }`. Never edit, renumber or
 * reorder a shipped entry — a DB that recorded its version won't re-run it.
 * Keep each `up` idempotent anyway: every DB created before this mechanism
 * existed starts at user_version 0 and replays all of them once.
 */
export const MIGRATIONS: ReadonlyArray<{ version: number; up: (conn: Database.Database) => void }> = [
  {
    version: 1,
    up: (conn) => {
      // Mute moved out of `mood` into its own column: anyone muted under the
      // old scheme stays muted.
      conn.exec(`UPDATE companions SET muted = 1 WHERE mood = 'muted'`);
      // Explicit NULLs, so the self-referential `zeny = zeny + ?` award never
      // resolves to NULL and wipes the balance. DEFAULT 0 only covers rows
      // created after the column existed; a legacy/imported row can still carry
      // NULL. Belt-and-suspenders with the COALESCE in lib/award.ts, which
      // covers any NULL that appears after this has run.
      conn.exec(`UPDATE companions SET zeny = 0 WHERE zeny IS NULL`);
      conn.exec(`UPDATE companions SET xp = 0 WHERE xp IS NULL`);
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

function userVersion(conn: Database.Database): number {
  return conn.pragma('user_version', { simple: true }) as number;
}

function runVersionedMigrations(conn: Database.Database): void {
  // Fast path: user_version is read from the DB header — no write lock.
  if (userVersion(conn) >= SCHEMA_VERSION) return;

  // Slow path, once per DB: take the write lock up front (IMMEDIATE) and
  // re-read the version under it, so two processes starting together don't
  // both replay a backfill. user_version is written transactionally with them.
  conn.transaction(() => {
    const current = userVersion(conn);
    for (const m of MIGRATIONS) {
      if (m.version > current) m.up(conn);
    }
    if (current < SCHEMA_VERSION) conn.pragma(`user_version = ${SCHEMA_VERSION}`);
  }).immediate();
}
