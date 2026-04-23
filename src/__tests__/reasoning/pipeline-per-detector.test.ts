import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { runMaxModePipeline } from '../../lib/reasoning/pipeline.js';
import { writeClaims } from '../../lib/reasoning/writer.js';
import { telemetry, resetGraphCache } from '../../lib/reasoning/index.js';
import type { FindingType } from '../../lib/reasoning/types.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name) VALUES ('c1', 't')`).run();
  return db;
}

const SID = 'aaaaaaaaaaaaaaaa-20260422';

// Pre-seed a graph shape that should trigger the given detector, then run
// the pipeline and assert the finding's type.
function seedAndRun(fixture: { claims: any[]; edges: any[] }): FindingType | null {
  const db = memDb();
  // Seed via writeClaims so we bypass the pipeline's own write step; we
  // want the pipeline called with EMPTY claims so observe_seq is clean
  // and the cooldown path isn't exercised by a prior finding.
  writeClaims(db, SID, fixture.claims, fixture.edges);
  // Now also need the session_id derived by the pipeline to match — but
  // the pipeline derives from cwd + today's UTC day. We work around by
  // passing a fixed `now` and using the cwd that hashes to the same prefix.
  // Simpler: just call the pipeline twice — first seeds, second detects.
  const pipelineSeed = runMaxModePipeline(db, {
    companionId: 'c1', cwd: '/proj',
    claims: fixture.claims, edges: fixture.edges,
  });
  expect(pipelineSeed.writeResult.claimsWritten).toBeGreaterThan(0);
  return pipelineSeed.finding?.type ?? null;
}

describe('pipeline integration — all 6 detectors end-to-end', () => {
  beforeEach(() => { telemetry.reset(); resetGraphCache(); });

  it('fires load_bearing_vibes', () => {
    const t = seedAndRun({
      claims: [
        { text: 'we need auth', basis: 'vibes', speaker: 'user', confidence: 'medium', external_id: 'v' },
        { text: 'a', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'a' },
        { text: 'b', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'b' },
        { text: 'c', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'c' },
        { text: 'f1', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f1' },
        { text: 'f2', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f2' },
      ],
      edges: [
        { from: 'a', to: 'v', type: 'depends_on' },
        { from: 'b', to: 'v', type: 'depends_on' },
        { from: 'c', to: 'v', type: 'depends_on' },
      ],
    });
    expect(t).toBe('load_bearing_vibes');
  });

  it('fires unchallenged_chain', () => {
    const t = seedAndRun({
      claims: [
        { text: 'premise', basis: 'assumption', speaker: 'user', confidence: 'medium', external_id: 'p' },
        { text: 'a', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'a' },
        { text: 'b', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'b' },
        { text: 'c', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'c' },
        { text: 'f1', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f1' },
        { text: 'f2', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f2' },
      ],
      edges: [
        { from: 'p', to: 'a', type: 'depends_on' },
        { from: 'a', to: 'b', type: 'depends_on' },
        { from: 'b', to: 'c', type: 'depends_on' },
      ],
    });
    // Load-bearing vibes also fires here (p has 1 downstream — only 'a'),
    // actually no — p has 1 incoming edge only. So only unchallenged_chain
    // should fire. But load_bearing threshold is ≥3 incoming supports; p
    // has only 1 incoming. Expect unchallenged_chain.
    expect(t).toBe('unchallenged_chain');
  });

  it('fires echo_chamber', () => {
    const t = seedAndRun({
      claims: [
        { text: 'im sure', basis: 'vibes', speaker: 'user', confidence: 'medium', external_id: 'u' },
        { text: 'yes', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'a1' },
        { text: 'yes2', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'a2' },
        { text: 'f1', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f1' },
        { text: 'f2', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f2' },
        { text: 'f3', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f3' },
      ],
      edges: [
        { from: 'a1', to: 'u', type: 'supports' },
        { from: 'a2', to: 'u', type: 'supports' },
      ],
    });
    expect(t).toBe('echo_chamber');
  });

  it('fires well_sourced_load_bearer', () => {
    const t = seedAndRun({
      claims: [
        { text: 'p99 is 240ms', basis: 'empirical', speaker: 'assistant', confidence: 'high', external_id: 'e' },
        { text: 'a', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'a' },
        { text: 'b', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'b' },
        { text: 'c', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'c' },
        { text: 'f1', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f1' },
        { text: 'f2', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f2' },
      ],
      edges: [
        { from: 'a', to: 'e', type: 'depends_on' },
        { from: 'b', to: 'e', type: 'depends_on' },
        { from: 'c', to: 'e', type: 'depends_on' },
      ],
    });
    expect(t).toBe('well_sourced_load_bearer');
  });

  it('fires productive_stress_test', () => {
    const t = seedAndRun({
      claims: [
        { text: 'p', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'p' },
        { text: 'a', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'a' },
        { text: 'b', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'b' },
        { text: 'c', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'c' },
        { text: 'f1', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f1' },
        { text: 'f2', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f2' },
      ],
      edges: [
        { from: 'p', to: 'a', type: 'depends_on' },
        { from: 'a', to: 'b', type: 'depends_on' },
        { from: 'b', to: 'c', type: 'depends_on' },
        { from: 'b', to: 'a', type: 'questions' }, // mid-chain
      ],
    });
    expect(t).toBe('productive_stress_test');
  });

  it('fires grounded_premise_adopted', () => {
    const t = seedAndRun({
      claims: [
        { text: 'OWASP XSS #3', basis: 'research', speaker: 'user', confidence: 'high', external_id: 'u' },
        { text: 'a', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'a' },
        { text: 'b', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'b' },
        { text: 'f1', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f1' },
        { text: 'f2', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f2' },
        { text: 'f3', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f3' },
      ],
      edges: [
        { from: 'a', to: 'u', type: 'supports' },
        { from: 'b', to: 'u', type: 'depends_on' },
      ],
    });
    expect(t).toBe('grounded_premise_adopted');
  });
});
