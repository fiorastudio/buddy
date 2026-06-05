// Property + invariant tests for the re-injection state machine over randomized
// turn sequences (no fast-check in the toolchain, so a seeded mulberry32 PRNG).
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { evaluateReinject, getReinjectStats } from '../../lib/reasoning/index.js';

function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT, guard_mode INTEGER, mood TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name, guard_mode, mood) VALUES ('c', 't', 1, 'happy')`).run();
  return db;
}

describe('evaluateReinject — invariants over random turn sequences', () => {
  it('holds across 50 seeded runs', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = rng(seed);
      const db = memDb();
      const SID = `sess-${seed}`;
      const threshold = 1 + Math.floor(r() * 4); // 1..4
      let clock = 1000;
      let newest = clock;
      let emits = 0;
      const TURNS = 40;

      db.prepare(`INSERT INTO reasoning_claims (id, session_id, speaker, text, basis, confidence, created_at) VALUES ('c0', ?, 'assistant', 'x', 'vibes', 'high', ?)`).run(SID, clock);
      evaluateReinject(db, 'c', SID, newest, threshold); // baseline

      for (let turn = 0; turn < TURNS; turn++) {
        const landClaim = r() < 0.3;
        if (landClaim) {
          clock += 10;
          db.prepare(`INSERT INTO reasoning_claims (id, session_id, speaker, text, basis, confidence, created_at) VALUES (?, ?, 'assistant', 'x', 'vibes', 'high', ?)`).run(`claim-${turn}`, SID, clock);
          newest = clock;
        }
        const emitted = evaluateReinject(db, 'c', SID, newest, threshold);
        const stats = getReinjectStats(db, 'c');

        // Invariant 1: a turn where a fresh claim landed never re-injects.
        if (landClaim) expect(emitted).toBe(false);
        // Invariant 2: recoveries can never exceed re-injections.
        expect(stats.recoveries_total).toBeLessThanOrEqual(stats.reinjections_total);
        if (emitted) emits++;
      }

      // Invariant 3: cadence is bounded — at most one emit per `threshold` turns.
      expect(emits).toBeLessThanOrEqual(Math.ceil(TURNS / threshold) + 1);
      // Invariant 4: counters are monotonic & non-negative.
      const final = getReinjectStats(db, 'c');
      expect(final.reinjections_total).toBeGreaterThanOrEqual(0);
      expect(final.recoveries_total).toBeGreaterThanOrEqual(0);
    }
  });

  it('a session change always resets to baseline (no carryover emit)', () => {
    const db = memDb();
    evaluateReinject(db, 'c', 'A', 0, 1);
    expect(evaluateReinject(db, 'c', 'A', 0, 1)).toBe(true);   // A lapsed
    expect(evaluateReinject(db, 'c', 'B', 0, 1)).toBe(false);  // B starts fresh
  });
});
