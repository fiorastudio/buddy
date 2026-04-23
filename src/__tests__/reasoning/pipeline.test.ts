import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { runMaxModePipeline } from '../../lib/reasoning/pipeline.js';
import { telemetry, resetGraphCache } from '../../lib/reasoning/index.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';

function memDb(companionIds: string[] = ['c1']): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  // Seed companion rows referenced by the reasoning FK constraints.
  const ins = db.prepare(`INSERT INTO companions (id, name) VALUES (?, 't')`);
  for (const id of companionIds) ins.run(id);
  return db;
}

// Build a payload that pre-primes the graph with load-bearing vibes.
function primingPayload() {
  const claims = [
    { text: 'we need auth', basis: 'vibes' as const, speaker: 'user' as const, confidence: 'medium' as const, external_id: 'v1' },
    { text: 'so we need sessions', basis: 'deduction' as const, speaker: 'assistant' as const, confidence: 'medium' as const, external_id: 'd1' },
    { text: 'so we need tokens', basis: 'deduction' as const, speaker: 'assistant' as const, confidence: 'medium' as const, external_id: 'd2' },
    { text: 'so we need rate limits', basis: 'deduction' as const, speaker: 'assistant' as const, confidence: 'medium' as const, external_id: 'd3' },
    { text: 'using express', basis: 'definition' as const, speaker: 'assistant' as const, confidence: 'high' as const, external_id: 'f1' },
    { text: 'node 20', basis: 'definition' as const, speaker: 'assistant' as const, confidence: 'high' as const, external_id: 'f2' },
  ];
  const edges = [
    { from: 'd1', to: 'v1', type: 'depends_on' as const },
    { from: 'd2', to: 'v1', type: 'depends_on' as const },
    { from: 'd3', to: 'v1', type: 'depends_on' as const },
  ];
  return { claims, edges };
}

describe('runMaxModePipeline', () => {
  beforeEach(() => { telemetry.reset(); resetGraphCache(); });

  it('happy path: writes claims, fires finding, bumps observe seq', () => {
    const db = memDb();
    const out = runMaxModePipeline(db, {
      companionId: 'c1',
      cwd: '/project',
      ...primingPayload(),
    });
    expect(out.writeResult.claimsWritten).toBe(6);
    expect(out.writeResult.edgesWritten).toBe(3);
    expect(out.finding).not.toBeNull();
    expect(out.finding!.type).toBe('load_bearing_vibes');
    expect(out.extractionInstruction).toContain('[max mode]');
    const stats = telemetry.snapshot();
    expect(stats.claims_received_total).toBe(6);
    expect(stats.findings_surfaced_total).toBe(1);
  });

  it('skips finding injection when detector budget is exceeded', () => {
    const db = memDb();
    // Seed the graph so a finding would normally fire.
    runMaxModePipeline(db, { companionId: 'c1', cwd: '/p', ...primingPayload() });
    telemetry.reset();

    // Force the detector step to "take" more time than the budget allows.
    const out = runMaxModePipeline(db, {
      companionId: 'c1',
      cwd: '/p',
      claims: [],
      edges: [],
    }, {
      detectorBudgetMs: 5,
      measureDetectorMs: <T,>(fn: () => T) => ({ value: fn(), ms: 999 }),
    });
    expect(out.budgetExceeded).toBe(true);
    expect(out.finding).toBeNull();
    expect(telemetry.snapshot().budget_exceeded_total).toBe(1);
  });

  it('handles malformed claims gracefully — no throw, no writes', () => {
    const db = memDb();
    const out = runMaxModePipeline(db, {
      companionId: 'c1',
      cwd: '/p',
      claims: [
        { /* missing everything */ } as any,
        { text: 'ok', basis: 'not-a-basis', speaker: 'user', confidence: 'low', external_id: 'c1' } as any,
      ],
      edges: 'not an array' as any,
    });
    expect(out.writeResult.claimsWritten).toBe(0);
    expect(out.writeResult.claimsDropped).toBe(2);
    expect(out.finding).toBeNull();
  });

  it('records telemetry on observe seq and claims receipt', () => {
    const db = memDb();
    // Observe 1: no claims sent — seq advances, lastClaims stays 0.
    runMaxModePipeline(db, { companionId: 'c1', cwd: '/p', claims: [], edges: [] });
    const seq1 = db.prepare('SELECT seq, last_claims_received_seq FROM reasoning_observe_seq WHERE companion_id = ?').get('c1') as any;
    expect(seq1.seq).toBe(1);
    expect(seq1.last_claims_received_seq).toBe(0);

    // Observe 2: claims sent — lastClaims bumps to 2.
    runMaxModePipeline(db, { companionId: 'c1', cwd: '/p', ...primingPayload() });
    const seq2 = db.prepare('SELECT seq, last_claims_received_seq FROM reasoning_observe_seq WHERE companion_id = ?').get('c1') as any;
    expect(seq2.seq).toBe(2);
    expect(seq2.last_claims_received_seq).toBe(2);
  });

  it('session_id derivation is stable across observes within the same UTC day', () => {
    const db = memDb();
    const now = Date.UTC(2026, 3, 22, 5, 0, 0);
    const later = Date.UTC(2026, 3, 22, 20, 0, 0);
    const a = runMaxModePipeline(db, { companionId: 'c1', cwd: '/p', claims: [], edges: [] }, { now: () => now });
    const b = runMaxModePipeline(db, { companionId: 'c1', cwd: '/p', claims: [], edges: [] }, { now: () => later });
    expect(a.sessionId).toBe(b.sessionId);
  });

  it('session_id rolls over at UTC midnight', () => {
    const db = memDb();
    const beforeMidnight = Date.UTC(2026, 3, 22, 23, 59);
    const afterMidnight = Date.UTC(2026, 3, 23, 0, 1);
    const a = runMaxModePipeline(db, { companionId: 'c1', cwd: '/p', claims: [], edges: [] }, { now: () => beforeMidnight });
    const b = runMaxModePipeline(db, { companionId: 'c1', cwd: '/p', claims: [], edges: [] }, { now: () => afterMidnight });
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});
