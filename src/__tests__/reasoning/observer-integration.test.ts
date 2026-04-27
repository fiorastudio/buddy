import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import {
  writeClaims,
  loadSessionGraph,
  runAllDetectors,
  selectFinding,
  logFinding,
  buildExtractionInstruction,
  loadRecentClaims,
  getAndBumpObserveSeq,
  getStressedVoice,
} from '../../lib/reasoning/index.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';
import { buildObserverPrompt } from '../../lib/observer.js';
import type { Companion } from '../../lib/types.js';

const COMPANION_ID = 'c-mushroom';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  db.prepare(`INSERT INTO companions (id, name) VALUES (?, 't')`).run(COMPANION_ID);
  return db;
}

const mockCompanion: Companion = {
  name: 'Sporemind',
  species: 'Mushroom',
  personalityBio: 'A networked mushroom with deep wisdom',
  rarity: 'common',
  eye: '.',
  hat: 'none',
  shiny: false,
  stats: { DEBUGGING: 20, PATIENCE: 40, CHAOS: 10, WISDOM: 90, SNARK: 20 },
  level: 1,
  xp: 0,
  mood: 'happy',
  hatchedAt: Date.now(),
};

const SID = 'ws-20260422';

function primeClaims(db: Database.Database) {
  // Build a graph that triggers load-bearing vibes:
  //   v1 (vibes, user)  ← supports by d1, d2, d3
  // Plus filler to pass cold-start.
  const claims: any[] = [
    { text: 'we need auth', basis: 'vibes', speaker: 'user', confidence: 'medium', external_id: 'v1' },
    { text: 'so we need sessions', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'd1' },
    { text: 'so we need token rotation', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'd2' },
    { text: 'so we need a rate limiter', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'd3' },
    { text: 'framework is express', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f1' },
    { text: 'node version is 20', basis: 'definition', speaker: 'assistant', confidence: 'high', external_id: 'f2' },
  ];
  const edges: any[] = [
    { from: 'd1', to: 'v1', type: 'depends_on' },
    { from: 'd2', to: 'v1', type: 'depends_on' },
    { from: 'd3', to: 'v1', type: 'depends_on' },
  ];
  writeClaims(db, SID, claims, edges);
}

describe('observer integration — full pipeline', () => {
  it('surfaces a load-bearing-vibes finding through the observer prompt', () => {
    const db = memDb();
    primeClaims(db);

    const graph = loadSessionGraph(db, SID);
    expect(graph.nodes.size).toBeGreaterThanOrEqual(REASONING_CONFIG.COLD_START_MIN_CLAIMS);

    const candidates = runAllDetectors(graph);
    expect(candidates.length).toBeGreaterThan(0);
    const loadBearing = candidates.find(c => c.type === 'load_bearing_vibes');
    expect(loadBearing).toBeDefined();

    const seq = getAndBumpObserveSeq(db, COMPANION_ID, true);
    const chosen = selectFinding(db, COMPANION_ID, seq.seq, candidates);
    expect(chosen).not.toBeNull();

    const recent = loadRecentClaims(db, SID, REASONING_CONFIG.RECENT_CLAIMS_CONTEXT);
    const instruction = buildExtractionInstruction(recent);
    expect(instruction).toContain('[insight mode]');
    expect(instruction).toContain('Recent claims you can edge into');

    const result = buildObserverPrompt(mockCompanion, 'both', 'refactored the auth module', {
      finding: chosen,
      stressedVoice: getStressedVoice(mockCompanion.species),
      extractionInstruction: instruction,
    });

    // Prompt must carry the finding context, the stressed voice, and the
    // extraction block. The MAX MODE label itself is intentionally absent
    // from the prompt — the instructions frame the notice in-character to
    // reduce chance of the model leaking the label in its reaction.
    expect(result.prompt).not.toMatch(/\bMAX MODE\b/);
    expect(result.prompt).toContain('You have noticed something');
    expect(result.prompt).toContain('Stay fully in character');
    expect(result.prompt).toContain('Suddenly attentive'); // mushroom stressed voice
    expect(result.prompt).toContain('[insight mode]');
    expect(result.prompt).toContain('we need auth');

    // Template fallback should also include finding phrasing.
    expect(result.templateFallback.length).toBeGreaterThan(0);
    expect(result.templateFallback).toContain('we need auth');

    // The `finding` surface must round-trip back out of buildObserverPrompt.
    expect(result.finding).not.toBeNull();
    expect(result.finding!.type).toBe(chosen!.type);
  });

  it('cooldown blocks the same anchor from surfacing twice in quick succession', () => {
    const db = memDb();
    primeClaims(db);

    const graph = loadSessionGraph(db, SID);
    const candidates = runAllDetectors(graph);
    const firstSeq = getAndBumpObserveSeq(db, COMPANION_ID, true);
    const first = selectFinding(db, COMPANION_ID, firstSeq.seq, candidates);
    expect(first).not.toBeNull();
    logFinding(db, COMPANION_ID, SID, first!, firstSeq.seq);

    // Run the selection again immediately (next observe); same anchor, same
    // candidates — dark cooldown should block it.
    const secondSeq = getAndBumpObserveSeq(db, COMPANION_ID, true);
    const lb = candidates.filter(c => c.type === 'load_bearing_vibes' && c.anchor_claim_id === first!.anchor_claim_id);
    const second = selectFinding(db, COMPANION_ID, secondSeq.seq, lb);
    expect(second).toBeNull();
  });

  it('does not surface any finding below cold-start threshold', () => {
    const db = memDb();
    writeClaims(db, SID, [
      { text: 'tiny', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' },
      { text: 'also tiny', basis: 'deduction', speaker: 'assistant', confidence: 'low', external_id: 'c2' },
    ], [
      { from: 'c2', to: 'c1', type: 'depends_on' },
    ]);
    const graph = loadSessionGraph(db, SID);
    expect(runAllDetectors(graph)).toEqual([]);
  });

  it('buildObserverPrompt returns same shape without insightInjection (backward compat)', () => {
    const result = buildObserverPrompt(mockCompanion, 'backseat', 'wrote some code');
    expect(result.prompt).not.toContain('MAX MODE');
    expect(result.finding).toBe(null);
  });
});
