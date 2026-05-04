import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { deliverPendingFindings } from '../../lib/reasoning/delivery.js';
import type { FindingType } from '../../lib/reasoning/types.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name) VALUES (?, ?)`).run('c1', 'Datao');
  return db;
}

function seedClaim(db: Database.Database, opts: { id: string; text: string; sessionId?: string }): void {
  db.prepare(`INSERT INTO reasoning_claims (id, session_id, speaker, text, basis, confidence, created_at)
              VALUES (?, ?, 'user', ?, 'vibes', 'medium', ?)`)
    .run(opts.id, opts.sessionId ?? 's1', opts.text, Date.now());
}

function seedFinding(
  db: Database.Database,
  companionId: string,
  type: FindingType,
  anchorClaimId: string,
  observeSeq: number = 1,
): number {
  const r = db.prepare(`INSERT INTO reasoning_findings_log
    (companion_id, session_id, finding_type, anchor_claim_id, observe_seq, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(companionId, 's1', type, anchorClaimId, observeSeq, Date.now());
  return r.lastInsertRowid as number;
}

describe('deliverPendingFindings', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let captured: string[];

  beforeEach(() => {
    captured = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      captured.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    }) as any);
  });
  afterEach(() => stdoutSpy.mockRestore());

  it('emits nothing when there are no pending findings', () => {
    const db = memDb();
    const r = deliverPendingFindings(db, 'c1');
    expect(r.delivered).toBe(0);
    expect(captured.join('')).toBe('');
  });

  it('writes a [buddy observation] block when findings exist', () => {
    const db = memDb();
    seedClaim(db, { id: 'claim-1', text: 'we need authentication everywhere immediately' });
    seedFinding(db, 'c1', 'load_bearing_vibes', 'claim-1');

    const r = deliverPendingFindings(db, 'c1');
    expect(r.delivered).toBe(1);
    const out = captured.join('');
    expect(out).toContain('[buddy observation]');
    expect(out).toMatch(/we need authentication/);
  });

  it('skips findings whose anchor claim has been pruned', () => {
    const db = memDb();
    // Finding refers to a claim id that does not exist (pruned).
    seedFinding(db, 'c1', 'load_bearing_vibes', 'pruned-claim-id');
    const r = deliverPendingFindings(db, 'c1');
    // Row counts as delivered (high-water mark advances) but no output emitted.
    expect(captured.join('')).toBe('');
    expect(r.delivered).toBe(1);
  });

  it('advances the high-water mark so later calls do not re-emit', () => {
    const db = memDb();
    seedClaim(db, { id: 'claim-1', text: 'a load-bearing assertion' });
    seedFinding(db, 'c1', 'load_bearing_vibes', 'claim-1');

    deliverPendingFindings(db, 'c1');
    captured.length = 0;
    const r2 = deliverPendingFindings(db, 'c1');

    expect(r2.delivered).toBe(0);
    expect(captured.join('')).toBe('');
  });

  it('still delivers findings logged after the high-water mark', () => {
    const db = memDb();
    seedClaim(db, { id: 'claim-1', text: 'first claim' });
    seedClaim(db, { id: 'claim-2', text: 'second claim' });

    seedFinding(db, 'c1', 'load_bearing_vibes', 'claim-1', 1);
    deliverPendingFindings(db, 'c1');
    captured.length = 0;

    seedFinding(db, 'c1', 'echo_chamber', 'claim-2', 2);
    const r = deliverPendingFindings(db, 'c1');

    expect(r.delivered).toBe(1);
    expect(captured.join('')).toMatch(/second claim/);
  });

  it('isolates by companion_id', () => {
    const db = memDb();
    db.prepare(`INSERT INTO companions (id, name) VALUES (?, ?)`).run('c2', 'Other');
    seedClaim(db, { id: 'claim-x', text: 'foreign claim' });
    seedFinding(db, 'c2', 'load_bearing_vibes', 'claim-x');

    const r = deliverPendingFindings(db, 'c1');
    expect(r.delivered).toBe(0);
    expect(captured.join('')).toBe('');
  });
});
