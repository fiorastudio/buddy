import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../db/schema.js';
import { runDiagnostics } from '../../lib/doctor.js';
import { REASONING_CONFIG, telemetry } from '../../lib/reasoning/index.js';

function resetDb() {
  db.exec(`
    DELETE FROM companions;
    DELETE FROM reasoning_observe_seq;
    DELETE FROM reasoning_claims;
    DELETE FROM reasoning_edges;
    DELETE FROM reasoning_findings_log;
  `);
  telemetry.reset();
}

function seedCompanion(maxOn: boolean): string {
  const id = 'test-comp-doctor';
  db.prepare(
    `INSERT INTO companions (id, name, species, user_id, personality_bio, max_mode) VALUES (?, 'Test', 'Mushroom', 'u', 'bio', ?)`
  ).run(id, maxOn ? 1 : 0);
  return id;
}

describe("doctor's reasoning.max check", () => {
  beforeEach(resetDb);

  it('reports "off" when max_mode=0', () => {
    seedCompanion(false);
    const checks = runDiagnostics();
    const c = checks.find(c => c.id === 'reasoning.max')!;
    expect(c.status).toBe('ok');
    expect(c.detail).toMatch(/off/);
  });

  it('reports "on (no observes yet)" when max is on but no seq row exists', () => {
    seedCompanion(true);
    const checks = runDiagnostics();
    const c = checks.find(c => c.id === 'reasoning.max')!;
    expect(c.status).toBe('ok');
    expect(c.detail).toMatch(/no observes yet/);
  });

  it('warns when max is on, observes elapsed, and zero claims received', () => {
    const id = seedCompanion(true);
    // Persisted seq >= threshold, last_claims_received_seq = 0 → inert.
    db.prepare(
      `INSERT INTO reasoning_observe_seq (companion_id, seq, last_claims_received_seq) VALUES (?, ?, 0)`
    ).run(id, REASONING_CONFIG.INERT_MAX_WARN_OBSERVES + 2);
    const checks = runDiagnostics();
    const c = checks.find(c => c.id === 'reasoning.max')!;
    expect(c.status).toBe('warn');
    expect(c.detail).toMatch(/0 claims received/);
    expect(c.suggestion).toMatch(/honoring the max-mode extraction prompt/);
  });

  it('does NOT warn when claims have been received', () => {
    const id = seedCompanion(true);
    db.prepare(
      `INSERT INTO reasoning_observe_seq (companion_id, seq, last_claims_received_seq) VALUES (?, ?, ?)`
    ).run(id, REASONING_CONFIG.INERT_MAX_WARN_OBSERVES + 2, 5);
    const checks = runDiagnostics();
    const c = checks.find(c => c.id === 'reasoning.max')!;
    expect(c.status).toBe('ok');
    expect(c.detail).toMatch(/on · /);
  });
});
