import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addColumnIfMissing, initDb, isDuplicateColumnError } from '../db/schema.js';
import { initXpEventsSchema } from '../db/xp-events-schema.js';

/**
 * X11: every ADD COLUMN migration was wrapped in a bare `catch {}`, so
 * SQLITE_BUSY (or a read-only / full / corrupt DB) was swallowed exactly like
 * "column already exists", and initDb() reported success with the column
 * missing. Only the duplicate-column error may be ignored.
 *
 * Every test uses its own temp DB file (never the shared test DB, and never
 * ~/.buddy/buddy.db).
 */

const dirs: string[] = [];
const open: Database.Database[] = [];

function tempDb(): { file: string; conn: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'buddy-x11-'));
  dirs.push(dir);
  const file = join(dir, 'buddy.db');
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  open.push(conn);
  return { file, conn };
}

afterEach(() => {
  for (const c of open.splice(0)) { try { c.close(); } catch { /* already closed */ } }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const columns = (conn: Database.Database, table: string) =>
  (conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

describe('addColumnIfMissing (X11)', () => {
  it('adds a missing column', () => {
    const { conn } = tempDb();
    conn.exec('CREATE TABLE t (id TEXT)');
    addColumnIfMissing(conn, 't', 'zeny INTEGER DEFAULT 0');
    expect(columns(conn, 't')).toContain('zeny');
  });

  it('ignores "duplicate column name"', () => {
    const { conn } = tempDb();
    conn.exec('CREATE TABLE t (id TEXT, zeny INTEGER)');
    expect(() => addColumnIfMissing(conn, 't', 'zeny INTEGER DEFAULT 0')).not.toThrow();
  });

  it('rethrows SQLITE_BUSY instead of pretending the column exists', () => {
    const { file, conn } = tempDb();
    conn.exec('CREATE TABLE t (id TEXT)');

    // Another session holds the write lock; no busy wait on this connection.
    const other = new Database(file);
    open.push(other);
    other.exec('BEGIN IMMEDIATE');
    conn.pragma('busy_timeout = 0');
    try {
      let caught: unknown;
      try { addColumnIfMissing(conn, 't', 'zeny INTEGER'); } catch (err) { caught = err; }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as { code?: string }).code).toBe('SQLITE_BUSY');
    } finally {
      other.exec('ROLLBACK');
    }
    expect(columns(conn, 't')).not.toContain('zeny');
  });

  it('rethrows other errors (read-only DB, missing table)', () => {
    const { file, conn } = tempDb();
    conn.exec('CREATE TABLE t (id TEXT)');
    const ro = new Database(file, { readonly: true });
    open.push(ro);
    expect(() => addColumnIfMissing(ro, 't', 'zeny INTEGER')).toThrow(/readonly/i);
    expect(() => addColumnIfMissing(conn, 'no_such_table', 'zeny INTEGER')).toThrow(/no such table/i);
  });

  it('isDuplicateColumnError only matches the duplicate-column message', () => {
    expect(isDuplicateColumnError(new Error('duplicate column name: zeny'))).toBe(true);
    expect(isDuplicateColumnError(Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }))).toBe(false);
    expect(isDuplicateColumnError('duplicate column name: zeny')).toBe(false); // not an Error
  });
});

describe('initDb surfaces migration failures (X11)', () => {
  it('throws instead of reporting success with a column still missing', () => {
    const { file, conn } = tempDb();
    // A fully initialized DB that is missing exactly one migrated column, so
    // every other step of initDb() is a no-op that needs no write.
    initDb(conn);
    conn.exec('ALTER TABLE companions DROP COLUMN zeny');

    // The ALTER that would add it back cannot write (read-only handle). The
    // old bare catch swallowed this and initDb() returned normally.
    const ro = new Database(file, { readonly: true });
    open.push(ro);
    expect(() => initDb(ro)).toThrow(/readonly/i);
    expect(columns(conn, 'companions')).not.toContain('zeny');
  });

  it('still succeeds, twice, on a legacy DB', () => {
    const { conn } = tempDb();
    conn.exec(`
      CREATE TABLE companions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, species TEXT NOT NULL,
        level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, mood TEXT DEFAULT 'happy',
        personality_bio TEXT DEFAULT '', user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    initDb(conn);
    initDb(conn);
    expect(columns(conn, 'companions')).toEqual(expect.arrayContaining([
      'observer_mode', 'cc_rescue', 'muted', 'stat_debugging', 'stat_points_available', 'zeny',
    ]));
  });
});

describe('xp_events provenance columns (X11 follow-up to X3)', () => {
  const legacyXpEvents = `
    CREATE TABLE xp_events (
      id TEXT PRIMARY KEY, companion_id TEXT, event_type TEXT NOT NULL,
      xp_gained INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  it('adds source and dedupe_of, and is idempotent', () => {
    const { conn } = tempDb();
    conn.exec(legacyXpEvents);
    initXpEventsSchema(conn);
    initXpEventsSchema(conn);
    expect(columns(conn, 'xp_events')).toEqual(expect.arrayContaining(['source', 'dedupe_of']));
  });

  it('rethrows SQLITE_BUSY instead of leaving the award INSERT to fail later', () => {
    const { file, conn } = tempDb();
    conn.exec(legacyXpEvents);
    const other = new Database(file);
    open.push(other);
    other.exec('BEGIN IMMEDIATE');
    conn.pragma('busy_timeout = 0');
    try {
      let caught: unknown;
      try { initXpEventsSchema(conn); } catch (err) { caught = err; }
      expect((caught as { code?: string } | undefined)?.code).toBe('SQLITE_BUSY');
    } finally {
      other.exec('ROLLBACK');
    }
    expect(columns(conn, 'xp_events')).not.toContain('source');
  });

  it('rethrows a read-only failure', () => {
    const { file, conn } = tempDb();
    conn.exec(legacyXpEvents);
    const ro = new Database(file, { readonly: true });
    open.push(ro);
    expect(() => initXpEventsSchema(ro)).toThrow(/readonly/i);
  });

  it('initDb(conn) migrates the connection it was given, not the shared one', () => {
    const { conn } = tempDb();
    conn.exec(legacyXpEvents);
    initDb(conn);
    expect(columns(conn, 'xp_events')).toEqual(expect.arrayContaining(['source', 'dedupe_of']));
    const indexes = (conn.prepare('PRAGMA index_list(xp_events)').all() as Array<{ name: string }>).map((i) => i.name);
    expect(indexes).toContain('idx_xp_events_dedupe_of');
  });
});
