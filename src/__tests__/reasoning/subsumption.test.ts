// Regression coverage for #150.
//
// Some detectors are specializations of others — their predicate is another
// detector's plus extra conjuncts — so both fire on the same anchor and
// describe one situation at two resolutions. Selection takes candidates[0],
// so before `dropSubsumed` the general finding always won on array order and
// the specific one could never surface. `echo_chamber` was fully unreachable:
// every echo case is also a load-bearing case, and the per-anchor cooldown
// meant load-bearing's emission blocked echo on that anchor too.

import { describe, it, expect } from 'vitest';
import type { SessionGraph, Node, Edge } from '../../lib/reasoning/graph.js';
import type { Basis, EdgeType, Speaker, Finding } from '../../lib/reasoning/types.js';
import { SUBSUMES, CAUTION_FINDINGS } from '../../lib/reasoning/types.js';
import {
  dropSubsumed,
  runAllDetectors,
  detectEchoChamber,
  detectLoadBearingVibes,
  detectGroundedPremiseAdopted,
  detectWellSourcedLoadBearer,
} from '../../lib/reasoning/detectors.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';

type FixtureClaim = { id: string; speaker?: Speaker; text?: string; basis: Basis };
type FixtureEdge = { from: string; to: string; type: EdgeType };

function buildGraph(claims: FixtureClaim[], edges: FixtureEdge[]): SessionGraph {
  const nodes = new Map<string, Node>();
  for (const c of claims) {
    nodes.set(c.id, {
      id: c.id, session_id: 'fixture', speaker: c.speaker ?? 'assistant',
      text: c.text ?? c.id, basis: c.basis, confidence: 'medium', created_at: 0,
    });
  }
  const edgesById = new Map<string, Edge>();
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  let i = 0;
  for (const e of edges) {
    const edge: Edge = {
      id: `e${i++}`, session_id: 'fixture',
      from_claim: e.from, to_claim: e.to, type: e.type, created_at: 0,
    };
    edgesById.set(edge.id, edge);
    const o = outgoing.get(edge.from_claim) ?? []; o.push(edge); outgoing.set(edge.from_claim, o);
    const n = incoming.get(edge.to_claim) ?? []; n.push(edge); incoming.set(edge.to_claim, n);
  }
  return { sessionId: 'fixture', nodes, edgesById, outgoing, incoming };
}

function withFiller(claims: FixtureClaim[], edges: FixtureEdge[]): SessionGraph {
  const pad: FixtureClaim[] = [];
  for (let i = claims.length; i < REASONING_CONFIG.COLD_START_MIN_CLAIMS; i++) {
    pad.push({ id: `filler${i}`, basis: 'definition', text: `filler claim ${i}` });
  }
  return buildGraph([...claims, ...pad], edges);
}

// A user vibes claim with N assistant supports and no pushback: the canonical
// echo chamber, and simultaneously a load-bearing vibes claim.
function echoGraph(supports = REASONING_CONFIG.ECHO_CHAMBER_MIN_SUPPORTS): SessionGraph {
  const backers = Array.from({ length: supports }, (_, i) => ({
    id: `a${i}`, basis: 'deduction' as const, speaker: 'assistant' as const,
  }));
  return withFiller(
    [{ id: 'u1', basis: 'vibes', speaker: 'user', text: 'this is the right approach' }, ...backers],
    backers.map(b => ({ from: b.id, to: 'u1', type: 'supports' as const })),
  );
}

const typesOf = (fs: Finding[]) => fs.map(f => f.type);

describe('detector subsumption (#150)', () => {
  it('the overlap is real: both detectors independently fire on the same anchor', () => {
    const g = echoGraph();
    const echo = detectEchoChamber(g);
    const general = detectLoadBearingVibes(g);
    expect(typesOf(echo)).toEqual(['echo_chamber']);
    expect(typesOf(general)).toEqual(['load_bearing_vibes']);
    expect(echo[0].anchor_claim_id).toBe(general[0].anchor_claim_id);
  });

  it('runAllDetectors surfaces echo_chamber, not the general finding it subsumes', () => {
    const types = typesOf(runAllDetectors(echoGraph()));
    expect(types).toContain('echo_chamber');
    expect(types).not.toContain('load_bearing_vibes');
  });

  it('echo_chamber is reachable as the FIRST candidate, so selection can pick it', () => {
    // findings.ts takes candidates[0] within a category. Before the fix this
    // was always load_bearing_vibes and echo could never be selected.
    const caution = runAllDetectors(echoGraph()).filter(f => f.type !== 'unverified_hedge');
    expect(caution[0].type).toBe('echo_chamber');
  });

  it('grounded_premise_adopted wins over well_sourced_load_bearer on a shared anchor', () => {
    const g = withFiller([
      { id: 'u1', basis: 'research', speaker: 'user', text: 'OWASP lists XSS third' },
      { id: 'a1', basis: 'deduction', speaker: 'assistant' },
      { id: 'a2', basis: 'deduction', speaker: 'assistant' },
    ], [
      { from: 'a1', to: 'u1', type: 'supports' },
      { from: 'a2', to: 'u1', type: 'depends_on' },
    ]);
    expect(typesOf(detectWellSourcedLoadBearer(g))).toEqual(['well_sourced_load_bearer']);
    expect(typesOf(detectGroundedPremiseAdopted(g))).toEqual(['grounded_premise_adopted']);

    const types = typesOf(runAllDetectors(g));
    expect(types).toContain('grounded_premise_adopted');
    expect(types).not.toContain('well_sourced_load_bearer');
  });

  it('leaves the general finding alone when the specific one did not fire', () => {
    // Same shape, but assistant-authored — echo_chamber requires a user
    // speaker, so there is nothing to subsume and load-bearing stands.
    const backers = Array.from({ length: REASONING_CONFIG.LOAD_BEARING_MIN_DOWNSTREAM }, (_, i) => ({
      id: `a${i}`, basis: 'deduction' as const, speaker: 'assistant' as const,
    }));
    const g = withFiller(
      [{ id: 'x1', basis: 'vibes', speaker: 'assistant' }, ...backers],
      backers.map(b => ({ from: b.id, to: 'x1', type: 'supports' as const })),
    );
    const types = typesOf(runAllDetectors(g));
    expect(types).toContain('load_bearing_vibes');
    expect(types).not.toContain('echo_chamber');
  });

  it('only subsumes on a SHARED anchor, never across different anchors', () => {
    const specific: Finding = { type: 'echo_chamber', anchor_claim_id: 'A', claim_text: 'a' };
    const general: Finding = { type: 'load_bearing_vibes', anchor_claim_id: 'B', claim_text: 'b' };
    expect(dropSubsumed([general, specific])).toHaveLength(2);
    expect(dropSubsumed([
      general,
      { ...specific, anchor_claim_id: 'B' },
    ])).toEqual([{ ...specific, anchor_claim_id: 'B' }]);
  });

  it('is a no-op on findings with no subsumption relationship', () => {
    const fs: Finding[] = [
      { type: 'unchallenged_chain', anchor_claim_id: 'A', claim_text: 'a' },
      { type: 'unverified_hedge', anchor_claim_id: 'A', claim_text: 'a' },
    ];
    expect(dropSubsumed(fs)).toEqual(fs);
  });

  it('every SUBSUMES pair stays within one category, so the kudos/caution mix is unchanged', () => {
    // findings.ts balances caution against kudos. If a specific caution
    // finding displaced a general kudos one (or vice versa) the bias logic
    // would silently skew.
    for (const [specific, general] of Object.entries(SUBSUMES)) {
      const sameCategory =
        CAUTION_FINDINGS.includes(specific as never) === CAUTION_FINDINGS.includes(general as never);
      expect(sameCategory, `${specific} → ${general} crosses categories`).toBe(true);
    }
  });
});
