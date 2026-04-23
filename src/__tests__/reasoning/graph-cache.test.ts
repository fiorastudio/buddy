import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
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
