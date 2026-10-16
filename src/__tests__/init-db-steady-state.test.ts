import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, SCHEMA_VERSION } from '../db/schema.js';

/**
 * X4: initDb() runs on every UserPromptSubmit hook (guard mode). It used to run
 * three backfill UPDATEs unconditionally; each one takes the SQLite write lock
 * even when it matches 0 rows, so the user's prompt could stall up to
 * busy_timeout behind another session's award. Backfills are now gated by
 * PRAGMA user_version and steady-state initDb() must not write at all.
 *
 * Every test uses its own temp DB file (never the shared test DB, and never
 * ~/.buddy/buddy.db).
 */

const dirs: string[] = [];
const open: Database.Database[] = [];

function tempDb(): { file: string; conn: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'buddy-initdb-'));
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

describe('initDb steady state (X4)', () => {
  it('records the schema version on a fresh DB', () => {
    const { conn } = tempDb();
    initDb(conn);
    expect(conn.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('a second initDb() makes no changes', () => {
    const { conn } = tempDb();
    initDb(conn);
    conn.prepare(
      `INSERT INTO companions (id, name, species) VALUES ('c1', 'Testy', 'Owl')`,
    ).run();
    const before = conn.prepare('SELECT total_changes() AS n').get() as { n: number };
    initDb(conn);
    const after = conn.prepare('SELECT total_changes() AS n').get() as { n: number };
    expect(after.n).toBe(before.n);
  });

  it('a second initDb() does not need the write lock', () => {
    const { file, conn } = tempDb();
    initDb(conn);

    // Another "session" holds the write lock (e.g. mid-award).
    const other = new Database(file);
    open.push(other);
    other.pragma('busy_timeout = 0');
    other.exec('BEGIN IMMEDIATE');

    // With no busy wait, any write attempt would throw SQLITE_BUSY at once.
    conn.pragma('busy_timeout = 0');
    try {
      expect(() => initDb(conn)).not.toThrow();
    } finally {
      other.exec('ROLLBACK');
    }
  });

  it('backfills a legacy-shaped DB exactly once', () => {
    const { conn } = tempDb();
    // Pre-migration shape: no muted/zeny columns, mute parked in `mood`,
    // nullable xp carrying an explicit NULL. user_version is 0.
    conn.exec(`
      CREATE TABLE companions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, species TEXT NOT NULL,
        level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, mood TEXT DEFAULT 'happy',
        personality_bio TEXT DEFAULT '', user_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO companions (id, name, species, xp, mood) VALUES ('old', 'Oldie', 'Owl', NULL, 'muted');
    `);
    // A legacy row imported with an explicit NULL zeny once the column exists.
    conn.exec(`ALTER TABLE companions ADD COLUMN zeny INTEGER DEFAULT 0`);
    conn.exec(`UPDATE companions SET zeny = NULL`);
    expect(conn.pragma('user_version', { simple: true })).toBe(0);

    initDb(conn);

    const row = conn.prepare('SELECT muted, xp, zeny FROM companions WHERE id = ?').get('old') as any;
    expect(row).toEqual({ muted: 1, xp: 0, zeny: 0 });
    expect(conn.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);

    // Once recorded, the backfill is not replayed: a later NULL is left for the
    // award's COALESCE guard rather than costing a write lock on every call.
    conn.exec(`UPDATE companions SET xp = NULL WHERE id = 'old'`);
    initDb(conn);
    const again = conn.prepare('SELECT xp FROM companions WHERE id = ?').get('old') as any;
    expect(again.xp).toBeNull();
  });
});
