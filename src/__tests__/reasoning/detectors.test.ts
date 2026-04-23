import { describe, it, expect } from 'vitest';
import type { SessionGraph, Node, Edge } from '../../lib/reasoning/graph.js';
import type { Basis, EdgeType, Speaker } from '../../lib/reasoning/types.js';
import {
  detectLoadBearingVibes,
  detectUnchallengedChain,
  detectEchoChamber,
  detectWellSourcedLoadBearer,
  detectProductiveStressTest,
  detectGroundedPremiseAdopted,
  runAllDetectors,
} from '../../lib/reasoning/detectors.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';

// ── Fixture builder — in-memory graph without touching DB ──────────────────

type FixtureClaim = { id: string; speaker?: Speaker; text?: string; basis: Basis };
type FixtureEdge = { from: string; to: string; type: EdgeType };

function buildGraph(claims: FixtureClaim[], edges: FixtureEdge[]): SessionGraph {
  const nodes = new Map<string, Node>();
  for (const c of claims) {
    nodes.set(c.id, {
      id: c.id,
      session_id: 'fixture',
      speaker: c.speaker ?? 'assistant',
      text: c.text ?? c.id,
      basis: c.basis,
      confidence: 'medium',
      created_at: 0,
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

// Pad a graph with N extra filler claims so it passes the cold-start gate.
function withFiller(claims: FixtureClaim[], edges: FixtureEdge[], padTo: number = REASONING_CONFIG.COLD_START_MIN_CLAIMS): SessionGraph {
  const pad: FixtureClaim[] = [];
  for (let i = claims.length; i < padTo; i++) {
    pad.push({ id: `filler${i}`, basis: 'definition', text: `filler claim ${i}` });
  }
  return buildGraph([...claims, ...pad], edges);
}

// ── Load-bearing vibes ──────────────────────────────────────────────────────

describe('detectLoadBearingVibes', () => {
  it('fires when vibes claim has ≥3 downstream', () => {
    const g = withFiller([
      { id: 'v1', basis: 'vibes', text: 'we need auth' },
      { id: 'd1', basis: 'deduction' },
      { id: 'd2', basis: 'deduction' },
      { id: 'd3', basis: 'deduction' },
    ], [
      { from: 'd1', to: 'v1', type: 'depends_on' },
      { from: 'd2', to: 'v1', type: 'depends_on' },
      { from: 'd3', to: 'v1', type: 'supports' },
    ]);
    const findings = detectLoadBearingVibes(g);
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor_claim_id).toBe('v1');
    expect(findings[0].downstream_count).toBe(3);
    expect(findings[0].claim_text).toBe('we need auth');
  });

  it('does not fire below threshold', () => {
    const g = withFiller([
      { id: 'v1', basis: 'vibes' },
      { id: 'd1', basis: 'deduction' },
      { id: 'd2', basis: 'deduction' },
    ], [
      { from: 'd1', to: 'v1', type: 'depends_on' },
      { from: 'd2', to: 'v1', type: 'supports' },
    ]);
    expect(detectLoadBearingVibes(g)).toHaveLength(0);
  });

  it('ignores sourced claims even if load-bearing', () => {
    const g = withFiller([
      { id: 'r1', basis: 'research' },
      { id: 'd1', basis: 'deduction' },
      { id: 'd2', basis: 'deduction' },
      { id: 'd3', basis: 'deduction' },
    ], [
      { from: 'd1', to: 'r1', type: 'depends_on' },
      { from: 'd2', to: 'r1', type: 'depends_on' },
      { from: 'd3', to: 'r1', type: 'depends_on' },
    ]);
    expect(detectLoadBearingVibes(g)).toHaveLength(0);
  });

  it('treats assumption the same as vibes', () => {
    const g = withFiller([
      { id: 'a1', basis: 'assumption' },
      { id: 'd1', basis: 'deduction' }, { id: 'd2', basis: 'deduction' }, { id: 'd3', basis: 'deduction' },
    ], [
      { from: 'd1', to: 'a1', type: 'depends_on' },
      { from: 'd2', to: 'a1', type: 'depends_on' },
      { from: 'd3', to: 'a1', type: 'depends_on' },
    ]);
    expect(detectLoadBearingVibes(g)).toHaveLength(1);
  });
});

// ── Unchallenged chain ──────────────────────────────────────────────────────

describe('detectUnchallengedChain', () => {
  it('fires on chain of required length with no challenge', () => {
    const g = withFiller([
      { id: 'c1', basis: 'assumption' },
      { id: 'c2', basis: 'deduction' },
      { id: 'c3', basis: 'deduction' },
      { id: 'c4', basis: 'deduction' },
    ], [
      { from: 'c1', to: 'c2', type: 'depends_on' },
      { from: 'c2', to: 'c3', type: 'depends_on' },
      { from: 'c3', to: 'c4', type: 'depends_on' },
    ]);
    const findings = detectUnchallengedChain(g);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].chain_length).toBeGreaterThanOrEqual(REASONING_CONFIG.UNCHALLENGED_CHAIN_MIN_LENGTH);
  });

  it('does not fire when chain has a question edge touching it', () => {
    const g = withFiller([
      { id: 'c1', basis: 'assumption' },
      { id: 'c2', basis: 'deduction' },
      { id: 'c3', basis: 'deduction' },
      { id: 'c4', basis: 'deduction' },
      { id: 'q1', basis: 'assumption' },
    ], [
      { from: 'c1', to: 'c2', type: 'depends_on' },
      { from: 'c2', to: 'c3', type: 'depends_on' },
      { from: 'c3', to: 'c4', type: 'depends_on' },
      { from: 'q1', to: 'c2', type: 'questions' },
    ]);
    // The chain-detection only flags chains where NO node in the chain has a
    // challenge edge. But q1 is not in the chain — the challenge is FROM q1 TO c2.
    // chainHasChallenge inspects edges where both endpoints are in the chain,
    // so a challenge from outside doesn't count. To properly challenge, the
    // question edge needs both endpoints in the chain.
    // Reconfigure: have c2 questions c1 within the chain.
    const g2 = withFiller([
      { id: 'c1', basis: 'assumption' },
      { id: 'c2', basis: 'deduction' },
      { id: 'c3', basis: 'deduction' },
      { id: 'c4', basis: 'deduction' },
    ], [
      { from: 'c1', to: 'c2', type: 'depends_on' },
      { from: 'c2', to: 'c3', type: 'depends_on' },
      { from: 'c3', to: 'c4', type: 'depends_on' },
      { from: 'c2', to: 'c1', type: 'questions' },
    ]);
    expect(detectUnchallengedChain(g2)).toHaveLength(0);
  });

  it('does not fire below minimum length', () => {
    const g = withFiller([
      { id: 'c1', basis: 'assumption' },
      { id: 'c2', basis: 'deduction' },
      { id: 'c3', basis: 'deduction' },
    ], [
      { from: 'c1', to: 'c2', type: 'depends_on' },
      { from: 'c2', to: 'c3', type: 'depends_on' },
    ]);
    expect(detectUnchallengedChain(g)).toHaveLength(0);
  });

  it('handles cycles without infinite looping', () => {
    const g = withFiller([
      { id: 'c1', basis: 'assumption' }, { id: 'c2', basis: 'deduction' },
    ], [
      { from: 'c1', to: 'c2', type: 'depends_on' },
      { from: 'c2', to: 'c1', type: 'depends_on' },
    ]);
    // Should terminate and not throw.
    expect(() => detectUnchallengedChain(g)).not.toThrow();
  });
});

// ── Echo chamber ────────────────────────────────────────────────────────────

describe('detectEchoChamber', () => {
  it('fires when user vibes claim has ≥2 assistant supports and 0 questions', () => {
    const g = withFiller([
      { id: 'u1', basis: 'vibes', speaker: 'user', text: 'this is definitely the right approach' },
      { id: 'a1', basis: 'deduction', speaker: 'assistant' },
      { id: 'a2', basis: 'deduction', speaker: 'assistant' },
    ], [
      { from: 'a1', to: 'u1', type: 'supports' },
      { from: 'a2', to: 'u1', type: 'supports' },
    ]);
    const findings = detectEchoChamber(g);
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor_claim_id).toBe('u1');
  });

  it('does not fire if assistant questioned the claim at all', () => {
    const g = withFiller([
      { id: 'u1', basis: 'vibes', speaker: 'user' },
      { id: 'a1', basis: 'deduction', speaker: 'assistant' },
      { id: 'a2', basis: 'deduction', speaker: 'assistant' },
      { id: 'a3', basis: 'deduction', speaker: 'assistant' },
    ], [
      { from: 'a1', to: 'u1', type: 'supports' },
      { from: 'a2', to: 'u1', type: 'supports' },
      { from: 'a3', to: 'u1', type: 'questions' },
    ]);
    expect(detectEchoChamber(g)).toHaveLength(0);
  });

  it('does not fire on assistant-speaker vibes claims', () => {
    const g = withFiller([
      { id: 'a0', basis: 'vibes', speaker: 'assistant' },
      { id: 'a1', basis: 'deduction', speaker: 'assistant' },
      { id: 'a2', basis: 'deduction', speaker: 'assistant' },
    ], [
      { from: 'a1', to: 'a0', type: 'supports' },
      { from: 'a2', to: 'a0', type: 'supports' },
    ]);
    expect(detectEchoChamber(g)).toHaveLength(0);
  });
});

// ── Bright: well-sourced load-bearer ────────────────────────────────────────

describe('detectWellSourcedLoadBearer', () => {
  it('fires on research/empirical/deduction basis with ≥3 downstream', () => {
    const g = withFiller([
      { id: 'r1', basis: 'research', text: 'OWASP ranks XSS #3' },
      { id: 'd1', basis: 'deduction' }, { id: 'd2', basis: 'deduction' }, { id: 'd3', basis: 'deduction' },
    ], [
      { from: 'd1', to: 'r1', type: 'depends_on' },
      { from: 'd2', to: 'r1', type: 'depends_on' },
      { from: 'd3', to: 'r1', type: 'supports' },
    ]);
    const findings = detectWellSourcedLoadBearer(g);
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor_claim_id).toBe('r1');
  });

  it('does not fire on vibes even with high downstream count', () => {
    const g = withFiller([
      { id: 'v1', basis: 'vibes' },
      { id: 'd1', basis: 'deduction' }, { id: 'd2', basis: 'deduction' },
      { id: 'd3', basis: 'deduction' }, { id: 'd4', basis: 'deduction' },
    ], [
      { from: 'd1', to: 'v1', type: 'depends_on' },
      { from: 'd2', to: 'v1', type: 'depends_on' },
      { from: 'd3', to: 'v1', type: 'depends_on' },
      { from: 'd4', to: 'v1', type: 'depends_on' },
    ]);
    expect(detectWellSourcedLoadBearer(g)).toHaveLength(0);
  });
});

// ── Bright: productive stress-test ──────────────────────────────────────────

describe('detectProductiveStressTest', () => {
  it('fires when a mid-chain challenge exists and chain continues', () => {
    const g = withFiller([
      { id: 'c1', basis: 'deduction' },
      { id: 'c2', basis: 'deduction' },
      { id: 'c3', basis: 'deduction' },
      { id: 'c4', basis: 'deduction' },
    ], [
      { from: 'c1', to: 'c2', type: 'depends_on' },
      { from: 'c2', to: 'c3', type: 'depends_on' },
      { from: 'c3', to: 'c4', type: 'depends_on' },
      // challenge mid-chain: c3 questions c2
      { from: 'c3', to: 'c2', type: 'questions' },
    ]);
    const findings = detectProductiveStressTest(g);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not fire when the chain has no challenge at all', () => {
    const g = withFiller([
      { id: 'c1', basis: 'deduction' }, { id: 'c2', basis: 'deduction' },
      { id: 'c3', basis: 'deduction' }, { id: 'c4', basis: 'deduction' },
    ], [
      { from: 'c1', to: 'c2', type: 'depends_on' },
      { from: 'c2', to: 'c3', type: 'depends_on' },
      { from: 'c3', to: 'c4', type: 'depends_on' },
    ]);
    expect(detectProductiveStressTest(g)).toHaveLength(0);
  });
});

// ── Bright: grounded premise adopted ────────────────────────────────────────

describe('detectGroundedPremiseAdopted', () => {
  it('fires on user research/empirical claim with ≥2 assistant supports', () => {
    const g = withFiller([
      { id: 'u1', basis: 'empirical', speaker: 'user', text: 'p99 is 240ms measured in prod' },
      { id: 'a1', basis: 'deduction', speaker: 'assistant' },
      { id: 'a2', basis: 'deduction', speaker: 'assistant' },
    ], [
      { from: 'a1', to: 'u1', type: 'supports' },
      { from: 'a2', to: 'u1', type: 'depends_on' },
    ]);
    const findings = detectGroundedPremiseAdopted(g);
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor_claim_id).toBe('u1');
  });

  it('does not fire on user assumption claim even with supports', () => {
    const g = withFiller([
      { id: 'u1', basis: 'assumption', speaker: 'user' },
      { id: 'a1', basis: 'deduction', speaker: 'assistant' },
      { id: 'a2', basis: 'deduction', speaker: 'assistant' },
    ], [
      { from: 'a1', to: 'u1', type: 'supports' },
      { from: 'a2', to: 'u1', type: 'supports' },
    ]);
    expect(detectGroundedPremiseAdopted(g)).toHaveLength(0);
  });
});

// ── Cold-start gate ─────────────────────────────────────────────────────────

describe('runAllDetectors cold-start gate', () => {
  it('returns empty when graph is under COLD_START_MIN_CLAIMS', () => {
    // 3 claims total — below cold-start threshold regardless of detector shape
    const g = buildGraph([
      { id: 'v1', basis: 'vibes' },
      { id: 'd1', basis: 'deduction' },
      { id: 'd2', basis: 'deduction' },
    ], [
      { from: 'd1', to: 'v1', type: 'depends_on' },
      { from: 'd2', to: 'v1', type: 'depends_on' },
    ]);
    expect(runAllDetectors(g)).toEqual([]);
  });

  it('fires once graph crosses cold-start threshold', () => {
    const claims: FixtureClaim[] = [{ id: 'v1', basis: 'vibes' }];
    const edges: FixtureEdge[] = [];
    for (let i = 0; i < 3; i++) {
      claims.push({ id: `d${i}`, basis: 'deduction' });
      edges.push({ from: `d${i}`, to: 'v1', type: 'depends_on' });
    }
    // pad to exactly the cold-start min
    while (claims.length < REASONING_CONFIG.COLD_START_MIN_CLAIMS) {
      claims.push({ id: `f${claims.length}`, basis: 'definition' });
    }
    const g = buildGraph(claims, edges);
    const findings = runAllDetectors(g);
    expect(findings.length).toBeGreaterThan(0);
  });
});
