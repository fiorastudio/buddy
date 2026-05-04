import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import {
  loadSessionGraphCached, resetGraphCache, cacheStats, bumpGeneration,
} from '../../lib/reasoning/graph-cache.js';
import { writeClaims } from '../../lib/reasoning/writer.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name) VALUES ('c1', 't')`).run();
  return db;
}

const SID = 'aaaaaaaaaaaaaaaa-20260422';

describe('graph cache', () => {
  beforeEach(resetGraphCache);

  it('returns the same graph instance on consecutive calls with no writes', () => {
    const db = memDb();
    writeClaims(db, SID, [
      { text: 'x', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    const g1 = loadSessionGraphCached(db, SID);
    const g2 = loadSessionGraphCached(db, SID);
    expect(g1).toBe(g2);
  });

  it('invalidates after writeClaims adds more rows', () => {
    const db = memDb();
    writeClaims(db, SID, [
      { text: 'x', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    const g1 = loadSessionGraphCached(db, SID);
    writeClaims(db, SID, [
      { text: 'y', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'c2' },
    ], []);
    const g2 = loadSessionGraphCached(db, SID);
    expect(g2).not.toBe(g1);
    expect(g2.nodes.size).toBe(2);
  });

  it('different sessions get different cache entries', () => {
    const db = memDb();
    const sid2 = 'bbbbbbbbbbbbbbbb-20260422';
    writeClaims(db, SID, [
      { text: 'a', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    writeClaims(db, sid2, [
      { text: 'b', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    const g1 = loadSessionGraphCached(db, SID);
    const g2 = loadSessionGraphCached(db, sid2);
    expect(g1).not.toBe(g2);
    expect(g1.nodes.size).toBe(1);
    expect(g2.nodes.size).toBe(1);
    expect(cacheStats().size).toBe(2);
  });

  it('manual bumpGeneration forces a refresh', () => {
    const db = memDb();
    writeClaims(db, SID, [
      { text: 'a', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    const g1 = loadSessionGraphCached(db, SID);
    bumpGeneration(SID);
    const g2 = loadSessionGraphCached(db, SID);
    expect(g2).not.toBe(g1);
  });

  it('writeClaims with 0 writes does not invalidate', () => {
    const db = memDb();
    writeClaims(db, SID, [
      { text: 'a', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    const g1 = loadSessionGraphCached(db, SID);
    // A call with no valid claims — writeClaims returns 0/0.
    const res = writeClaims(db, SID, [{ bogus: true } as any], []);
    expect(res.claimsWritten).toBe(0);
    const g2 = loadSessionGraphCached(db, SID);
    expect(g2).toBe(g1);
  });
});

// Cross-process invalidation: simulates the real Stop hook + MCP server
// pattern where two processes hold separate connections to the same on-disk
// DB. Without the data_version check, the "MCP server" connection's cache
// would serve a stale graph after the "Stop hook" connection writes.
describe('graph cache — cross-connection invalidation via PRAGMA data_version', () => {
  let tmp: string;
  let dbPath: string;
  let mcpDb: Database.Database;
  let hookDb: Database.Database;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'buddy-cache-'));
    dbPath = join(tmp, 'buddy.db');
    mcpDb = new Database(dbPath);
    mcpDb.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
    initReasoningSchema(mcpDb);
    mcpDb.prepare(`INSERT INTO companions (id, name) VALUES ('c1', 't')`).run();
    hookDb = new Database(dbPath);
    initReasoningSchema(hookDb);  // ensures pragma + WAL on hook connection too
    resetGraphCache();
  });

  afterEach(() => {
    mcpDb.close();
    hookDb.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("invalidates the MCP server's cache when the hook connection writes", () => {
    // ── Step 1: MCP server caches the graph at its current state.
    writeClaims(mcpDb, SID, [
      { text: 'auth on every endpoint', basis: 'vibes', speaker: 'user', confidence: 'medium', external_id: 'c1' },
    ], []);
    const g1 = loadSessionGraphCached(mcpDb, SID);
    expect(g1.nodes.size).toBe(1);

    // ── Step 2: Hook process (separate connection) writes new claims.
    // Crucially, this does NOT call bumpGeneration() in the MCP server's
    // process — generations Map is per-process. Pre-fix, the MCP server's
    // cache would think nothing changed and serve the stale 1-node graph.
    writeClaims(hookDb, SID, [
      { text: 'so we need session storage', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'c2' },
    ], []);

    // ── Step 3: MCP server reads. With the data_version check, the cache
    // detects the cross-connection write and rebuilds.
    const g2 = loadSessionGraphCached(mcpDb, SID);
    expect(g2).not.toBe(g1);
    expect(g2.nodes.size).toBe(2);
  });

  it("does NOT invalidate when nothing has changed cross-connection (cache stays warm)", () => {
    writeClaims(mcpDb, SID, [
      { text: 'a', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    const g1 = loadSessionGraphCached(mcpDb, SID);
    // Hook connection reads but doesn't write. data_version stays put.
    hookDb.prepare(`SELECT count(*) FROM reasoning_claims WHERE session_id = ?`).get(SID);
    const g2 = loadSessionGraphCached(mcpDb, SID);
    expect(g2).toBe(g1);
  });
});
