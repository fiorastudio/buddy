import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { selectFinding, logFinding } from '../../lib/reasoning/findings.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';
import type { Finding } from '../../lib/reasoning/types.js';

const COMP = 'c-bias';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name) VALUES (?, 't')`).run(COMP);
  return db;
}

function cautionFinding(id = 'anchor-caution'): Finding {
  return { type: 'load_bearing_vibes', anchor_claim_id: id, claim_text: 'caution claim', downstream_count: 5 };
}
function kudosFinding(id = 'anchor-kudos'): Finding {
  return { type: 'well_sourced_load_bearer', anchor_claim_id: id, claim_text: 'kudos claim', downstream_count: 5 };
}

describe('selectFinding — kudos bias', () => {
  it('forces kudos when recent window has ≥threshold caution and zero kudos', () => {
    const db = memDb();
    for (let i = 1; i <= REASONING_CONFIG.KUDOS_BIAS_CAUTION_THRESHOLD; i++) {
      logFinding(db, COMP, 'fixture', cautionFinding(`d${i}`), i);
    }
    const currentSeq = REASONING_CONFIG.KUDOS_BIAS_CAUTION_THRESHOLD + 1;
    const caution = cautionFinding('d-new');
    const kudos = kudosFinding();
    const chosen = selectFinding(db, COMP, currentSeq, [caution, kudos]);
    expect(chosen).not.toBeNull();
    expect(chosen!.type).toBe('well_sourced_load_bearer');
  });

  it('does NOT force kudos when recent window already had a kudos', () => {
    const db = memDb();
    logFinding(db, COMP, 'fixture', cautionFinding('d1'), 1);
    logFinding(db, COMP, 'fixture', cautionFinding('d2'), 2);
    logFinding(db, COMP, 'fixture', cautionFinding('d3'), 3);
    logFinding(db, COMP, 'fixture', kudosFinding('b1'), 4);
    // Next observe; both candidates available; kudos bias should NOT trigger
    // because there's already a recent kudos in the window.
    const caution = cautionFinding('d-new');
    const kudos = kudosFinding('b-new');
    // Deterministic tie-break is seq-based; with seq=10 + no kudos-bias
    // trigger, we expect caution by default (weight is 0.4 toward kudos).
    const chosen = selectFinding(db, COMP, 10, [caution, kudos]);
    expect(chosen).not.toBeNull();
    expect(chosen!.type).toBe('load_bearing_vibes');
  });

  it('returns null when no candidates', () => {
    const db = memDb();
    expect(selectFinding(db, COMP, 1, [])).toBeNull();
  });

  it('respects cooldown: same anchor blocked within CAUTION_COOLDOWN_OBSERVES', () => {
    const db = memDb();
    const f = cautionFinding('same-anchor');
    logFinding(db, COMP, 'fixture', f, 5);
    const justBefore = 5 + REASONING_CONFIG.CAUTION_COOLDOWN_OBSERVES - 1;
    expect(selectFinding(db, COMP, justBefore, [f])).toBeNull();
    const atBoundary = 5 + REASONING_CONFIG.CAUTION_COOLDOWN_OBSERVES;
    const chosen = selectFinding(db, COMP, atBoundary, [f]);
    expect(chosen).not.toBeNull();
  });

  it('kudos cooldown is shorter than caution', () => {
    const db = memDb();
    const f = kudosFinding('b-anchor');
    logFinding(db, COMP, 'fixture', f, 10);
    const inBetween = 10 + REASONING_CONFIG.KUDOS_COOLDOWN_OBSERVES - 1;
    expect(selectFinding(db, COMP, inBetween, [f])).toBeNull();
    const atBoundary = 10 + REASONING_CONFIG.KUDOS_COOLDOWN_OBSERVES;
    expect(selectFinding(db, COMP, atBoundary, [f])).not.toBeNull();
  });
});
