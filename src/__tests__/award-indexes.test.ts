import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb } from '../db/schema.js';
import { CREATED_TODAY_UTC } from '../lib/streaks.js';

/**
 * X13: every award ran its daily-cap / dedupe / streak / mood queries as full
 * table scans of xp_events (and memories). initDb() now creates
 * (companion_id, created_at) indexes, and the "today" filters are range
 * predicates the index can serve. Own temp DB file, never the shared one.
 */

let dir: string;
let conn: Database.Database;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'buddy-x13-'));
  conn = new Database(join(dir, 'buddy.db'));
  initDb(conn);
  conn.prepare("INSERT INTO companions (id, name, species) VALUES ('c', 'Idx', 'Duck')").run();
});

afterAll(() => {
  conn.close();
  rmSync(dir, { recursive: true, force: true });
});

const plan = (sql: string, ...args: unknown[]) =>
  (conn.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>).map((r) => r.detail).join(' | ');

describe('award-path indexes (X13)', () => {
  it('initDb creates the companion/created_at indexes', () => {
    const names = (table: string) =>
      (conn.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((i) => i.name);
    expect(names('xp_events')).toContain('idx_xp_events_companion_created');
    expect(names('memories')).toContain('idx_memories_companion_created');
  });

  it("today's-events count (damper, streak) searches the index on a time range", () => {
    const p = plan(`SELECT COUNT(*) FROM xp_events WHERE companion_id = ? AND ${CREATED_TODAY_UTC}`, 'c');
    expect(p).toMatch(/SEARCH xp_events USING (COVERING )?INDEX idx_xp_events_companion_created \(companion_id=\? AND created_at>\? AND created_at<\?\)/);
    expect(p).not.toMatch(/\bSCAN xp_events\b/);
  });

  it('the old date(created_at) form could not use the time range (regression guard)', () => {
    const p = plan(`SELECT COUNT(*) FROM xp_events WHERE companion_id = ? AND date(created_at) = date('now')`, 'c');
    expect(p).not.toMatch(/created_at>\?/);
  });

  it('cross-session dedupe lookup searches the index', () => {
    const p = plan(
      `SELECT h.id FROM xp_events h
        WHERE h.companion_id = ? AND h.source = 'hook' AND h.event_type = ?
          AND h.created_at >= datetime('now', ?)
          AND NOT EXISTS (SELECT 1 FROM xp_events s WHERE s.dedupe_of = h.id)
        ORDER BY h.created_at ASC, h.rowid ASC LIMIT 1`,
      'c', 'commit', '-15 minutes',
    );
    expect(p).toMatch(/SEARCH h USING INDEX idx_xp_events_companion_created/);
    expect(p).not.toMatch(/\bSCAN h\b/);
  });

  it('recalcMood memory count searches the index', () => {
    const p = plan(`SELECT count(*) FROM memories WHERE companion_id = ? AND created_at > datetime('now', '-1 hour')`, 'c');
    expect(p).toMatch(/idx_memories_companion_created/);
  });

  it('the range form selects exactly the rows date(created_at) = date(now) did', () => {
    conn.prepare('DELETE FROM xp_events').run();
    const ins = conn.prepare(
      "INSERT INTO xp_events (id, companion_id, event_type, xp_gained, created_at) VALUES (?, 'c', 'observe', 1, ?)"
    );
    const at = (sql: string) => (conn.prepare(`SELECT ${sql} AS v`).get() as { v: string }).v;
    const rows: Array<[string, string]> = [
      ['yesterday-last-second', at("datetime(date('now'), '-1 second')")],
      ['midnight', at("datetime(date('now'))")],
      ['now', at("datetime('now')")],
      ['today-last-second', at("datetime(date('now'), '+1 day', '-1 second')")],
      ['tomorrow-midnight', at("datetime(date('now'), '+1 day')")],
      // An ISO-8601 'T'/'Z' timestamp, should one ever be written explicitly.
      ['iso-today', at("strftime('%Y-%m-%dT%H:%M:%SZ', 'now')")],
      ['null', null as unknown as string],
    ];
    for (const [id, ts] of rows) ins.run(id, ts);

    const ids = (where: string) =>
      (conn.prepare(`SELECT id FROM xp_events WHERE companion_id = 'c' AND ${where} ORDER BY id`).all() as Array<{ id: string }>)
        .map((r) => r.id);
    const viaRange = ids(CREATED_TODAY_UTC);
    expect(viaRange).toEqual(ids("date(created_at) = date('now')"));
    expect(viaRange).toEqual(['iso-today', 'midnight', 'now', 'today-last-second']);
  });
});
