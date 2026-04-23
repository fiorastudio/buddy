import { describe, it, expect } from 'vitest';
import type { SessionGraph, Node, Edge } from '../../lib/reasoning/graph.js';
import type { Basis, EdgeType, Speaker } from '../../lib/reasoning/types.js';
import {
  detectUnchallengedChain,
  detectProductiveStressTest,
} from '../../lib/reasoning/detectors.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';

// Anchor regression guard: chain detectors anchor on the HEAD of the chain
// (the premise / actionable target), not the TAIL (the conclusion). If a
// future change flips this back, these tests catch it.

type FC = { id: string; speaker?: Speaker; text?: string; basis: Basis };
type FE = { from: string; to: string; type: EdgeType };

function buildGraph(claims: FC[], edges: FE[]): SessionGraph {
  const nodes = new Map<string, Node>();
  for (const c of claims) {
    nodes.set(c.id, {
      id: c.id, session_id: 'f', speaker: c.speaker ?? 'assistant',
      text: c.text ?? c.id, basis: c.basis, confidence: 'medium', created_at: 0,
    });
  }
  const edgesById = new Map<string, Edge>();
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  let i = 0;
  for (const e of edges) {
    const edge: Edge = { id: `e${i++}`, session_id: 'f', from_claim: e.from, to_claim: e.to, type: e.type, created_at: 0 };
    edgesById.set(edge.id, edge);
    const o = outgoing.get(edge.from_claim) ?? []; o.push(edge); outgoing.set(edge.from_claim, o);
    const n = incoming.get(edge.to_claim) ?? []; n.push(edge); incoming.set(edge.to_claim, n);
  }
  return { sessionId: 'f', nodes, edgesById, outgoing, incoming };
}

function withFiller(claims: FC[], edges: FE[], padTo = REASONING_CONFIG.COLD_START_MIN_CLAIMS): SessionGraph {
  const pad: FC[] = [];
  for (let i = claims.length; i < padTo; i++) pad.push({ id: `f${i}`, basis: 'definition' });
  return buildGraph([...claims, ...pad], edges);
}

describe('chain detectors anchor on HEAD (the premise), not TAIL', () => {
  it('unchallenged_chain anchors on the head of the chain', () => {
    // head → a → b → tail (4-node chain, length 4)
    const g = withFiller([
      { id: 'head', basis: 'assumption', text: 'HEAD_CLAIM' },
      { id: 'a', basis: 'deduction', text: 'A_CLAIM' },
      { id: 'b', basis: 'deduction', text: 'B_CLAIM' },
      { id: 'tail', basis: 'deduction', text: 'TAIL_CLAIM' },
    ], [
      { from: 'head', to: 'a', type: 'depends_on' },
      { from: 'a', to: 'b', type: 'depends_on' },
      { from: 'b', to: 'tail', type: 'depends_on' },
    ]);
    const findings = detectUnchallengedChain(g);
    expect(findings.length).toBeGreaterThan(0);
    const topFinding = findings[0];
    expect(topFinding.anchor_claim_id).toBe('head');
    expect(topFinding.claim_text).toBe('HEAD_CLAIM');
    // Explicit: it is NOT the tail.
    expect(topFinding.anchor_claim_id).not.toBe('tail');
  });

  it('productive_stress_test also anchors on head', () => {
    const g = withFiller([
      { id: 'head', basis: 'assumption', text: 'HEAD_CLAIM' },
      { id: 'a', basis: 'deduction', text: 'A_CLAIM' },
      { id: 'b', basis: 'deduction', text: 'B_CLAIM' },
      { id: 'tail', basis: 'deduction', text: 'TAIL_CLAIM' },
    ], [
      { from: 'head', to: 'a', type: 'depends_on' },
      { from: 'a', to: 'b', type: 'depends_on' },
      { from: 'b', to: 'tail', type: 'depends_on' },
      // mid-chain challenge
      { from: 'b', to: 'a', type: 'questions' },
    ]);
    const findings = detectProductiveStressTest(g);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].anchor_claim_id).toBe('head');
    expect(findings[0].claim_text).toBe('HEAD_CLAIM');
  });
});
