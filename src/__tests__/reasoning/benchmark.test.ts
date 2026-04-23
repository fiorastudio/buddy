import { describe, it, expect } from 'vitest';
import type { SessionGraph, Node, Edge } from '../../lib/reasoning/graph.js';
import { runAllDetectors } from '../../lib/reasoning/detectors.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';

// Worst-case smoke benchmark. Not a strict SLO; a canary. Build a synthetic
// graph at the session cap (200 claims) with dense edges and long chains,
// measure how long all 6 detectors take. Assert it lands under 3× the
// configured budget (so a reasonable CI machine passes with slack but a
// regression of ~5× fails).

function buildDenseGraph(n: number): SessionGraph {
  const nodes = new Map<string, Node>();
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  const edgesById = new Map<string, Edge>();

  // First claim is vibes (load-bearing candidate), rest are deduction.
  for (let i = 0; i < n; i++) {
    const id = `n${i}`;
    nodes.set(id, {
      id, session_id: 'bench',
      speaker: i % 3 === 0 ? 'user' : 'assistant',
      text: `claim ${i}`,
      basis: i === 0 ? 'vibes' : (i % 5 === 0 ? 'assumption' : 'deduction'),
      confidence: 'medium',
      created_at: i,
    });
  }

  // Chain: n0 → n1 → n2 → ... → n{n-1} (depends_on).
  // Plus cross-edges so downstream counts are high for n0.
  let edgeId = 0;
  const addEdge = (from: string, to: string, type: Edge['type']) => {
    const e: Edge = { id: `e${edgeId++}`, session_id: 'bench', from_claim: from, to_claim: to, type, created_at: 0 };
    edgesById.set(e.id, e);
    const o = outgoing.get(from) ?? []; o.push(e); outgoing.set(from, o);
    const ins = incoming.get(to) ?? []; ins.push(e); incoming.set(to, ins);
  };

  for (let i = 0; i < n - 1; i++) {
    addEdge(`n${i}`, `n${i + 1}`, 'depends_on');
  }
  // Every node > 0 also depends_on n0 (makes n0 a mega load-bearer).
  for (let i = 1; i < Math.min(n, 20); i++) {
    addEdge(`n${i}`, 'n0', 'depends_on');
  }
  // Sprinkle a few questions/contradicts so productive_stress_test has work.
  for (let i = 5; i < n - 5; i += 10) {
    addEdge(`n${i + 2}`, `n${i}`, 'questions');
  }

  return { sessionId: 'bench', nodes, edgesById, outgoing, incoming };
}

describe('detector perf benchmark (smoke)', () => {
  it('runs all detectors under 3× budget on a capped worst-case graph', () => {
    const g = buildDenseGraph(REASONING_CONFIG.MAX_CLAIMS_PER_SESSION);
    // Warm JIT with one run whose cost we discard.
    runAllDetectors(g);
    const start = Date.now();
    const findings = runAllDetectors(g);
    const ms = Date.now() - start;

    expect(findings.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(REASONING_CONFIG.DETECTOR_BUDGET_MS * 3);
  });
});
