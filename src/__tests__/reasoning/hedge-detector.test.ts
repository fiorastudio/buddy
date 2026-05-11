import { describe, it, expect } from 'vitest';
import type { SessionGraph, Node, Edge } from '../../lib/reasoning/graph.js';
import type { Basis, Confidence, EdgeType, Speaker } from '../../lib/reasoning/types.js';
import { detectUnverifiedHedge } from '../../lib/reasoning/detectors.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';

type FixtureClaim = {
  id: string;
  speaker?: Speaker;
  text?: string;
  basis: Basis;
  confidence?: Confidence;
};
type FixtureEdge = { from: string; to: string; type: EdgeType };

function buildGraph(claims: FixtureClaim[], edges: FixtureEdge[] = []): SessionGraph {
  const nodes = new Map<string, Node>();
  for (const c of claims) {
    nodes.set(c.id, {
      id: c.id,
      session_id: 'fixture',
      speaker: c.speaker ?? 'assistant',
      text: c.text ?? c.id,
      basis: c.basis,
      confidence: c.confidence ?? 'high',
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

describe('detectUnverifiedHedge', () => {
  it('fires on assistant claim with hedge word + non-assumption basis + high confidence', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'empirical', text: 'this likely works because bun handles sqlite natively', confidence: 'high' },
    ]);
    const findings = detectUnverifiedHedge(graph);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('unverified_hedge');
    expect(findings[0].anchor_claim_id).toBe('c1');
  });

  it('does NOT fire when basis is assumption', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'assumption', text: 'this likely works because of caching', confidence: 'high' },
    ]);
    expect(detectUnverifiedHedge(graph)).toHaveLength(0);
  });

  it('does NOT fire when basis is vibes', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'vibes', text: 'i think this probably handles it', confidence: 'medium' },
    ]);
    expect(detectUnverifiedHedge(graph)).toHaveLength(0);
  });

  it('does NOT fire when confidence is low', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'empirical', text: 'this probably works', confidence: 'low' },
    ]);
    expect(detectUnverifiedHedge(graph)).toHaveLength(0);
  });

  it('does NOT fire on user claims', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'empirical', text: 'i think the API likely returns JSON', speaker: 'user', confidence: 'high' },
    ]);
    expect(detectUnverifiedHedge(graph)).toHaveLength(0);
  });

  it('does NOT fire when no hedge words present', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'empirical', text: 'the function returns a promise that resolves to a buffer', confidence: 'high' },
    ]);
    expect(detectUnverifiedHedge(graph)).toHaveLength(0);
  });

  it('fires on medium confidence claims with hedge words', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'deduction', text: 'this should work with the existing interface', confidence: 'medium' },
    ]);
    const findings = detectUnverifiedHedge(graph);
    expect(findings).toHaveLength(1);
  });

  it('detects multiple hedge claims', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'empirical', text: 'this likely handles concurrent writes', confidence: 'high' },
      { id: 'c2', basis: 'deduction', text: 'i believe the cache invalidates correctly', confidence: 'high' },
      { id: 'c3', basis: 'empirical', text: 'the test passes reliably', confidence: 'high' },
    ]);
    const findings = detectUnverifiedHedge(graph);
    expect(findings).toHaveLength(2);
    expect(findings.map(f => f.anchor_claim_id).sort()).toEqual(['c1', 'c2']);
  });

  it('matches various hedge patterns', () => {
    const patterns = [
      'this likely works',
      'it probably handles the edge case',
      'should work with the new API',
      'i think the timeout is sufficient',
      'i believe this is correct',
      'presumably the cache is warm',
      'i assume the connection is stable',
      'i suspect the race condition is fixed',
      'i guess the buffer is large enough',
      'seems like the right approach',
      'appears to handle nulls correctly',
      'most likely the root cause',
    ];
    for (const text of patterns) {
      const graph = buildGraph([{ id: 'c1', basis: 'empirical', text, confidence: 'high' }]);
      const findings = detectUnverifiedHedge(graph);
      expect(findings.length).toBe(1);
    }
  });
});
