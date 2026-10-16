import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, SCHEMA_VERSION } from '../db/schema.js';
import { awardWithGates } from '../lib/award.js';

/**
 * X5(a): upgrading a real 1.0.6 install is the riskiest thing initDb() does,
 * and nothing exercised it end to end. LEGACY_1_0_6 below is the schema that
 * v1.0.6's initDb() produced (`git show v1.0.6:src/db/schema.ts` and
 * `v1.0.6:src/lib/reasoning/schema.ts`), statement for statement and in the
 * same order, including its ADD COLUMN migrations and the fresh-install branch
 * of the guard_mode migration. A 1.0.6 DB never set user_version (0).
 *
 * Each test uses its own temp DB file: never the shared test DB, never
 * ~/.buddy/buddy.db.
 */
const LEGACY_1_0_6 = `
  CREATE TABLE IF NOT EXISTS companions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    species TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    mood TEXT DEFAULT 'happy',
    personality_bio TEXT DEFAULT '',
    user_id TEXT,
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

  ALTER TABLE companions ADD COLUMN observer_mode TEXT DEFAULT 'both';
  ALTER TABLE companions ADD COLUMN cc_rescue INTEGER DEFAULT 0;

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

  ALTER TABLE companions ADD COLUMN guard_mode INTEGER DEFAULT 0;
`;

/** A 1.0.6 user's data: one buddy muted the old way (mood = 'muted'), one with NULL xp. */
const LEGACY_DATA = `
  INSERT INTO companions (id, name, species, level, xp, mood, personality_bio, user_id, created_at, observer_mode, cc_rescue, guard_mode)
    VALUES ('c-old', 'Fernsquire', 'Turtle', 3, 420, 'muted', 'unflappable', 'user-1', '2026-03-01 10:00:00', 'backseat', 1, 1);
  INSERT INTO companions (id, name, species, level, xp, mood, user_id, created_at)
    VALUES ('c-null', 'Nully', 'Duck', 1, NULL, 'happy', 'user-2', '2026-03-02 11:00:00');

  INSERT INTO memories (id, companion_id, content, importance, tag, created_at)
    VALUES ('m1', 'c-old', 'prefers small PRs', 3, 'pref', '2026-03-03 09:00:00');
  INSERT INTO xp_events (id, companion_id, event_type, xp_gained, created_at)
    VALUES ('x1', 'c-old', 'commit', 20, '2026-03-03 09:05:00'),
           ('x2', 'c-old', 'observe', 5, '2026-03-04 09:05:00');
  INSERT INTO evolution_history (id, companion_id, from_level, to_level, from_species, to_species, created_at)
    VALUES ('ev1', 'c-old', 2, 3, 'Turtle', 'Turtle', '2026-03-04 09:06:00');
  INSERT INTO sessions (id, companion_id, start_time, context_summary)
    VALUES ('s1', 'c-old', '2026-03-04 08:00:00', 'refactor');
  INSERT INTO reasoning_claims (id, session_id, speaker, text, basis, confidence, created_at)
    VALUES ('rc1', 'sess', 'assistant', 'the cache is stale', 'empirical', 'high', 1772600000000),
           ('rc2', 'sess', 'assistant', 'so the test flakes', 'deduction', 'medium', 1772600000001);
  INSERT INTO reasoning_edges (id, session_id, from_claim, to_claim, type, created_at)
    VALUES ('re1', 'sess', 'rc2', 'rc1', 'depends_on', 1772600000002);
  INSERT INTO reasoning_findings_log (companion_id, session_id, finding_type, anchor_claim_id, observe_seq, created_at)
    VALUES ('c-old', 'sess', 'unchallenged_chain', 'rc1', 7, 1772600000003);
  INSERT INTO reasoning_observe_seq (companion_id, seq, last_claims_received_seq) VALUES ('c-old', 7, 6);
`;

const LEGACY_TABLES = [
  'companions', 'memories', 'xp_events', 'evolution_history', 'sessions',
  'reasoning_claims', 'reasoning_edges', 'reasoning_findings_log', 'reasoning_observe_seq',
];

const dirs: string[] = [];
const open: Database.Database[] = [];

function tempConn(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'buddy-x5-legacy-'));
  dirs.push(dir);
  const conn = new Database(join(dir, 'buddy.db'));
  conn.pragma('journal_mode = WAL');
  open.push(conn);
  return conn;
}

function legacyConn(): Database.Database {
  const conn = tempConn();
  conn.exec(LEGACY_1_0_6);
  conn.exec(LEGACY_DATA);
  return conn;
}

afterEach(() => {
  for (const c of open.splice(0)) { try { c.close(); } catch { /* closed */ } }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Tables -> sorted column signatures, plus sorted index names, user tables only. */
function schemaShape(conn: Database.Database) {
  const tables = (conn.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as Array<{ name: string }>).map((t) => t.name);
  const columns: Record<string, string[]> = {};
  for (const t of tables) {
    columns[t] = (conn.prepare(`PRAGMA table_info(${t})`).all() as Array<{
      name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
    }>).map((c) => `${c.name} ${c.type} notnull=${c.notnull} default=${c.dflt_value} pk=${c.pk}`).sort();
  }
  const indexes = (conn.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as Array<{ name: string }>).map((i) => i.name);
  return { tables, columns, indexes };
}

function dump(conn: Database.Database, table: string): unknown[] {
  return conn.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

describe('initDb on a 1.0.6 database (X5)', () => {
  it('migrates to exactly the schema a fresh install gets', () => {
    const legacy = legacyConn();
    initDb(legacy);
    const fresh = tempConn();
    initDb(fresh);
    expect(schemaShape(legacy)).toEqual(schemaShape(fresh));
    expect(legacy.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('preserves every legacy row', () => {
    const conn = legacyConn();
    const before = Object.fromEntries(LEGACY_TABLES.map((t) => [t, dump(conn, t)]));
    initDb(conn);
    for (const t of LEGACY_TABLES) {
      const after = dump(conn, t) as Array<Record<string, unknown>>;
      const prev = before[t] as Array<Record<string, unknown>>;
      expect(after, t).toHaveLength(prev.length);
      // Every legacy column keeps its value, except the documented one-time
      // backfill of companions.xp NULL -> 0 (asserted below).
      after.forEach((row, i) => {
        for (const [col, val] of Object.entries(prev[i])) {
          if (t === 'companions' && col === 'xp' && val === null) continue;
          expect(row[col], `${t}.${col}`).toEqual(val);
        }
      });
    }
  });

  it('applies the one-time backfills and new-column defaults', () => {
    const conn = legacyConn();
    initDb(conn);
    const c = (id: string) => conn.prepare('SELECT * FROM companions WHERE id = ?').get(id) as Record<string, unknown>;

    // Muted the 1.0.6 way (mood = 'muted') stays muted under the muted column.
    expect(c('c-old').muted).toBe(1);
    expect(c('c-null').muted).toBe(0);
    // NULL xp would turn `xp = xp + ?` into NULL; backfilled to 0.
    expect(c('c-null').xp).toBe(0);
    expect(c('c-old').zeny).toBe(0);
    expect(c('c-null').zeny).toBe(0);
    // Settings carried over untouched.
    expect(c('c-old')).toMatchObject({ guard_mode: 1, observer_mode: 'backseat', cc_rescue: 1, xp: 420, level: 3 });
    // Legacy ledger rows have unknown provenance.
    expect(conn.prepare('SELECT source, dedupe_of FROM xp_events').all())
      .toEqual([{ source: null, dedupe_of: null }, { source: null, dedupe_of: null }]);
  });

  it('is a no-op the second time', () => {
    const conn = legacyConn();
    initDb(conn);
    const shape = schemaShape(conn);
    const rows = Object.fromEntries(LEGACY_TABLES.map((t) => [t, dump(conn, t)]));
    initDb(conn);
    expect(schemaShape(conn)).toEqual(shape);
    expect(Object.fromEntries(LEGACY_TABLES.map((t) => [t, dump(conn, t)]))).toEqual(rows);
  });

  it('can award XP on the migrated DB', () => {
    const conn = legacyConn();
    initDb(conn);
    const { xpResult } = awardWithGates(conn, 'c-null', 'observe', []);
    expect(xpResult.xpGained).toBeGreaterThan(0);
    const row = conn.prepare("SELECT xp, zeny FROM companions WHERE id = 'c-null'").get() as { xp: number; zeny: number };
    expect(row.xp).toBe(xpResult.xpGained);
    expect(row.zeny).toBe(xpResult.newZeny);
    const ledger = conn.prepare("SELECT event_type, source FROM xp_events WHERE companion_id = 'c-null'").all();
    expect(ledger).toEqual([{ event_type: 'observe', source: 'self' }]);
  });
});
