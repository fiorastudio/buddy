import { describe, it, expect } from 'vitest';
import type { SessionGraph, Node, Edge } from '../../lib/reasoning/graph.js';
import type { Basis, Confidence, EdgeType, Speaker } from '../../lib/reasoning/types.js';
import { detectUnverifiedHedge } from '../../lib/reasoning/detectors.js';

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
      id: `e${i++}`,
      session_id: 'fixture',
      from_claim: e.from,
      to_claim: e.to,
      type: e.type,
      created_at: 0,
    };
    edgesById.set(edge.id, edge);
    const o = outgoing.get(edge.from_claim) ?? [];
    o.push(edge);
    outgoing.set(edge.from_claim, o);
    const incomingEdges = incoming.get(edge.to_claim) ?? [];
    incomingEdges.push(edge);
    incoming.set(edge.to_claim, incomingEdges);
  }
  return { sessionId: 'fixture', nodes, edgesById, outgoing, incoming };
}

describe('detectUnverifiedHedge', () => {
  it('fires on strong hedge words for grounded assistant claims', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'empirical', text: 'this likely works because bun handles sqlite natively', confidence: 'high' },
      { id: 'c2', basis: 'deduction', text: 'presumably the cache is warm', confidence: 'medium' },
    ]);
    const findings = detectUnverifiedHedge(graph);
    expect(findings).toHaveLength(2);
    expect(findings.map(f => f.anchor_claim_id).sort()).toEqual(['c1', 'c2']);
  });

  it('does NOT fire when basis is assumption or vibes', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'assumption', text: 'this likely works because of caching', confidence: 'high' },
      { id: 'c2', basis: 'vibes', text: 'probably a stale cache', confidence: 'medium' },
    ]);
    expect(detectUnverifiedHedge(graph)).toHaveLength(0);
  });

  it('does NOT fire when confidence is low or claim is from user', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'empirical', text: 'this probably works', confidence: 'low' },
      { id: 'c2', basis: 'empirical', text: 'i suspect the API returns JSON', speaker: 'user', confidence: 'high' },
    ]);
    expect(detectUnverifiedHedge(graph)).toHaveLength(0);
  });

  it('does NOT fire on soft conversational hedges anymore', () => {
    const patterns = [
      'i think the timeout is sufficient',
      'i believe this is correct',
      'this should work with the new API',
      'i guess the buffer is large enough',
      'seems like the right approach',
      'appears to handle nulls correctly',
    ];
    for (const text of patterns) {
      const graph = buildGraph([{ id: 'c1', basis: 'empirical', text, confidence: 'high' }]);
      expect(detectUnverifiedHedge(graph)).toHaveLength(0);
    }
  });

  it('still catches most likely and i suspect', () => {
    const graph = buildGraph([
      { id: 'c1', basis: 'empirical', text: 'most likely the root cause', confidence: 'high' },
      { id: 'c2', basis: 'deduction', text: 'i suspect the race condition is fixed', confidence: 'high' },
    ]);
    const findings = detectUnverifiedHedge(graph);
    expect(findings).toHaveLength(2);
  });
});
