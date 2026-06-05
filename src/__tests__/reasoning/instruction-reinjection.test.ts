import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { evaluateReinject, getReinjectStats, writeClaims, loadRecentClaims } from '../../lib/reasoning/index.js';
import { reinjectExtractionInstructionIfLapsed } from '../../hooks/prompt-handler.js';

const CID = 'c-1';
const SID = 'abc0123456789def-20260604';

function memDb(guard = 1, mood = 'happy'): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT, guard_mode INTEGER, mood TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name, guard_mode, mood) VALUES (?, 't', ?, ?)`).run(CID, guard, mood);
  return db;
}

function insertClaim(db: Database.Database, sid: string, at: number): void {
  db.prepare(
    `INSERT INTO reasoning_claims (id, session_id, speaker, text, basis, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(`cl-${sid}-${at}`, sid, 'assistant', 'x', 'vibes', 'high', at);
}

function tmpStatus(fields: Record<string, unknown>): string {
  const p = join(tmpdir(), `buddy-status-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify({ name: 'Testbuddy', ...fields }));
  return p;
}

// ── the state machine (real DB, no mocks) ──────────────────────────────────
describe('evaluateReinject', () => {
  it('emits after N silent turns, resets cadence, and counts a recovery', () => {
    const db = memDb();
    insertClaim(db, SID, 1000);
    expect(evaluateReinject(db, CID, SID, 1000, 2)).toBe(false); // baseline
    expect(evaluateReinject(db, CID, SID, 1000, 2)).toBe(false); // silent 1
    expect(evaluateReinject(db, CID, SID, 1000, 2)).toBe(true);  // silent 2 → emit
    expect(getReinjectStats(db, CID)).toEqual({ reinjections_total: 1, recoveries_total: 0 });

    insertClaim(db, SID, 2000);                                   // host complied
    expect(evaluateReinject(db, CID, SID, 2000, 2)).toBe(false); // claim landed → recovery
    expect(getReinjectStats(db, CID)).toEqual({ reinjections_total: 1, recoveries_total: 1 });
  });

  it('stays silent when a fresh claim lands before the threshold', () => {
    const db = memDb();
    insertClaim(db, SID, 1000);
    evaluateReinject(db, CID, SID, 1000, 2);                      // baseline
    insertClaim(db, SID, 1500);
    expect(evaluateReinject(db, CID, SID, 1500, 2)).toBe(false); // reset on new claim
    expect(evaluateReinject(db, CID, SID, 1500, 2)).toBe(false); // silent 1
    expect(evaluateReinject(db, CID, SID, 1500, 2)).toBe(true);  // silent 2 → emit
  });

  it('resets baseline on session change (no cross-project false counting)', () => {
    const db = memDb();
    expect(evaluateReinject(db, CID, SID, 0, 1)).toBe(false);                 // baseline A
    expect(evaluateReinject(db, CID, SID, 0, 1)).toBe(true);                  // silent → emit
    // a different session starts fresh, even at threshold 1
    expect(evaluateReinject(db, CID, 'ffff000000000000-20260604', 0, 1)).toBe(false);
  });
});

// ── the hook end-to-end (real evaluateReinject + real instruction + real
//    loadRecentClaims; only db/statusPath/sessionId/threshold/emit injected) ──
describe('reinjectExtractionInstructionIfLapsed (real path)', () => {
  it('emits the real instruction with real recent claims after the threshold', async () => {
    const db = memDb();
    writeClaims(db, SID, [
      { text: 'we standardize on postgres', basis: 'convention', speaker: 'user', confidence: 'high', external_id: 'a1' },
    ], []);
    const statusPath = tmpStatus({ guard_mode: 1, mood: 'happy' });
    const emits: string[] = [];
    const deps = { db, statusPath, sessionId: SID, threshold: 2, emit: (s: string) => emits.push(s) };

    expect(await reinjectExtractionInstructionIfLapsed(deps)).toBe(false); // baseline
    expect(await reinjectExtractionInstructionIfLapsed(deps)).toBe(false); // silent 1
    expect(await reinjectExtractionInstructionIfLapsed(deps)).toBe(true);  // silent 2 → emit

    expect(emits).toHaveLength(1);
    expect(emits[0]).toContain('[guard mode]');           // the real instruction body
    expect(emits[0]).not.toContain('(none yet)');         // real recent claims, not a misleading empty list
    rmSync(statusPath, { force: true });
  });

  it('is silent when guard mode is off or muted (status pre-check, no DB work)', async () => {
    const db = memDb();
    insertClaim(db, SID, 1000);
    const emits: string[] = [];
    const off = tmpStatus({ guard_mode: 0, mood: 'happy' });
    const muted = tmpStatus({ guard_mode: 1, mood: 'muted' });
    for (let i = 0; i < 4; i++) {
      expect(await reinjectExtractionInstructionIfLapsed({ db, statusPath: off, sessionId: SID, threshold: 1, emit: (s: string) => emits.push(s) })).toBe(false);
      expect(await reinjectExtractionInstructionIfLapsed({ db, statusPath: muted, sessionId: SID, threshold: 1, emit: (s: string) => emits.push(s) })).toBe(false);
    }
    expect(emits).toHaveLength(0);
    rmSync(off, { force: true });
    rmSync(muted, { force: true });
  });
});

describe('convention basis', () => {
  it('round-trips through writeClaims (added to BASIS_VALUES)', () => {
    const db = memDb();
    const res = writeClaims(
      db, SID,
      [{ text: 'this project uses beads for issue tracking', basis: 'convention', speaker: 'user', confidence: 'high', external_id: 'c1' }],
      [],
    );
    expect(res.claimsDropped).toBe(0);
    expect(loadRecentClaims(db, SID, 10).some(c => c.basis === 'convention')).toBe(true);
  });
});
