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

function darkFinding(id = 'anchor-dark'): Finding {
  return { type: 'load_bearing_vibes', anchor_claim_id: id, claim_text: 'dark claim', downstream_count: 5 };
}
function brightFinding(id = 'anchor-bright'): Finding {
  return { type: 'well_sourced_load_bearer', anchor_claim_id: id, claim_text: 'bright claim', downstream_count: 5 };
}

describe('selectFinding — bright bias', () => {
  it('forces bright when recent window has ≥threshold dark and zero bright', () => {
    const db = memDb();
    // Seed THRESHOLD dark findings in the last window at distinct anchors.
    for (let i = 1; i <= REASONING_CONFIG.BRIGHT_BIAS_DARK_THRESHOLD; i++) {
      logFinding(db, COMP, 'fixture', darkFinding(`d${i}`), i);
    }
    const currentSeq = REASONING_CONFIG.BRIGHT_BIAS_DARK_THRESHOLD + 1;
    // Both dark and bright candidates available at THIS observe.
    const dark = darkFinding('d-new');
    const bright = brightFinding();
    const chosen = selectFinding(db, COMP, currentSeq, [dark, bright]);
    expect(chosen).not.toBeNull();
    expect(chosen!.type).toBe('well_sourced_load_bearer');
  });

  it('does NOT force bright when recent window already had a bright', () => {
    const db = memDb();
    logFinding(db, COMP, 'fixture', darkFinding('d1'), 1);
    logFinding(db, COMP, 'fixture', darkFinding('d2'), 2);
    logFinding(db, COMP, 'fixture', darkFinding('d3'), 3);
    logFinding(db, COMP, 'fixture', brightFinding('b1'), 4);
    // Next observe; both candidates available; bright bias should NOT trigger
    // because there's already a recent bright in the window.
    const dark = darkFinding('d-new');
    const bright = brightFinding('b-new');
    // Deterministic tie-break is seq-based; with seq=10 + no bright-bias
    // trigger, we expect dark by default (weight is 0.4 toward bright).
    const chosen = selectFinding(db, COMP, 10, [dark, bright]);
    expect(chosen).not.toBeNull();
    expect(chosen!.type).toBe('load_bearing_vibes');
  });

  it('returns null when no candidates', () => {
    const db = memDb();
    expect(selectFinding(db, COMP, 1, [])).toBeNull();
  });

  it('respects cooldown: same anchor blocked within DARK_COOLDOWN_OBSERVES', () => {
    const db = memDb();
    const f = darkFinding('same-anchor');
    logFinding(db, COMP, 'fixture', f, 5);
    // At seq=5 + (cooldown - 1) we should still be blocked.
    const justBefore = 5 + REASONING_CONFIG.DARK_COOLDOWN_OBSERVES - 1;
    expect(selectFinding(db, COMP, justBefore, [f])).toBeNull();
    // At seq=5 + cooldown we become eligible again (strict-less-than boundary).
    const atBoundary = 5 + REASONING_CONFIG.DARK_COOLDOWN_OBSERVES;
    const chosen = selectFinding(db, COMP, atBoundary, [f]);
    expect(chosen).not.toBeNull();
  });

  it('bright cooldown is shorter than dark', () => {
    const db = memDb();
    const f = brightFinding('b-anchor');
    logFinding(db, COMP, 'fixture', f, 10);
    const inBetween = 10 + REASONING_CONFIG.BRIGHT_COOLDOWN_OBSERVES - 1;
    expect(selectFinding(db, COMP, inBetween, [f])).toBeNull();
    const atBoundary = 10 + REASONING_CONFIG.BRIGHT_COOLDOWN_OBSERVES;
    expect(selectFinding(db, COMP, atBoundary, [f])).not.toBeNull();
  });
});
