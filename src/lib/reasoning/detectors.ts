// src/lib/reasoning/detectors.ts
//
// Six detectors: three dark (load-bearing vibes, unchallenged chain,
// echo chamber) and three bright (well-sourced load-bearer, productive
// stress-test, grounded premise adopted).
//
// All detectors are pure functions over a SessionGraph. No DB access,
// no side effects. They return an array of candidate findings (usually
// empty or single-element); the selection layer picks one.
//
// Chain-walking detectors share a single `ChainScratch` across their
// per-node iteration so overlapping subtrees aren't re-walked.

import type { Finding } from './types.js';
import { REASONING_CONFIG } from './config.js';
import {
  type SessionGraph,
  type ChainScratch,
  makeChainScratch,
  downstreamCount,
  nodesByBasis,
  longestChainNodesFrom,
  chainHasChallenge,
  chainHasMidChainChallenge,
} from './graph.js';

// Dark: claims with basis ∈ {vibes, assumption} holding up N+ downstream.
export function detectLoadBearingVibes(graph: SessionGraph): Finding[] {
  const out: Finding[] = [];
  for (const node of nodesByBasis(graph, ['vibes', 'assumption'])) {
    const n = downstreamCount(graph, node.id);
    if (n >= REASONING_CONFIG.LOAD_BEARING_MIN_DOWNSTREAM) {
      out.push({
        type: 'load_bearing_vibes',
        anchor_claim_id: node.id,
        claim_text: node.text,
        downstream_count: n,
      });
    }
  }
  out.sort((a, b) => (b.downstream_count ?? 0) - (a.downstream_count ?? 0));
  return out;
}

// Dark: chain of N+ sequential supports/depends_on with NO challenge.
// Anchors on the HEAD of the chain — the premise — because that's the
// actionable target ("stress-test this assumption"). Dedupe by head so
// multiple chains rooted at the same claim collapse to one finding.
export function detectUnchallengedChain(graph: SessionGraph, scratch: ChainScratch = makeChainScratch()): Finding[] {
  const out: Finding[] = [];
  const minLen = REASONING_CONFIG.UNCHALLENGED_CHAIN_MIN_LENGTH;
  for (const node of graph.nodes.values()) {
    const chain = longestChainNodesFrom(graph, node.id, ['supports', 'depends_on'], scratch);
    if (chain.length < minLen) continue;
    if (chainHasChallenge(graph, chain)) continue;
    const headId = chain[0];
    const headNode = graph.nodes.get(headId)!;
    out.push({
      type: 'unchallenged_chain',
      anchor_claim_id: headId,
      claim_text: headNode.text,
      chain_length: chain.length,
    });
  }
  const byAnchor = new Map<string, Finding>();
  for (const f of out) {
    const prev = byAnchor.get(f.anchor_claim_id);
    if (!prev || (f.chain_length ?? 0) > (prev.chain_length ?? 0)) {
      byAnchor.set(f.anchor_claim_id, f);
    }
  }
  return [...byAnchor.values()].sort((a, b) => (b.chain_length ?? 0) - (a.chain_length ?? 0));
}

// Dark: user claim with basis ∈ {vibes, assumption} has N+ assistant
// supports and zero assistant questions edges against it.
export function detectEchoChamber(graph: SessionGraph): Finding[] {
  const out: Finding[] = [];
  for (const node of graph.nodes.values()) {
    if (node.speaker !== 'user') continue;
    if (node.basis !== 'vibes' && node.basis !== 'assumption') continue;

    const incoming = graph.incoming.get(node.id) ?? [];
    let assistantSupports = 0;
    let assistantQuestions = 0;
    for (const e of incoming) {
      const from = graph.nodes.get(e.from_claim);
      if (!from || from.speaker !== 'assistant') continue;
      if (e.type === 'supports' || e.type === 'depends_on') assistantSupports++;
      if (e.type === 'questions' || e.type === 'contradicts') assistantQuestions++;
    }
    if (assistantQuestions > 0) continue;
    if (assistantSupports >= REASONING_CONFIG.ECHO_CHAMBER_MIN_SUPPORTS) {
      out.push({
        type: 'echo_chamber',
        anchor_claim_id: node.id,
        claim_text: node.text,
        downstream_count: assistantSupports,
      });
    }
  }
  out.sort((a, b) => (b.downstream_count ?? 0) - (a.downstream_count ?? 0));
  return out;
}

// Bright: high-quality basis claim holding up N+ downstream.
export function detectWellSourcedLoadBearer(graph: SessionGraph): Finding[] {
  const out: Finding[] = [];
  for (const node of nodesByBasis(graph, ['research', 'empirical', 'deduction'])) {
    const n = downstreamCount(graph, node.id);
    if (n >= REASONING_CONFIG.WELL_SOURCED_MIN_DOWNSTREAM) {
      out.push({
        type: 'well_sourced_load_bearer',
        anchor_claim_id: node.id,
        claim_text: node.text,
        downstream_count: n,
      });
    }
  }
  out.sort((a, b) => (b.downstream_count ?? 0) - (a.downstream_count ?? 0));
  return out;
}

// Bright: chain of N+ edges WITH a mid-chain challenge where the chain
// continued after. Anchors on HEAD for symmetry with unchallenged_chain.
export function detectProductiveStressTest(graph: SessionGraph, scratch: ChainScratch = makeChainScratch()): Finding[] {
  const out: Finding[] = [];
  const minLen = REASONING_CONFIG.PRODUCTIVE_STRESS_MIN_CHAIN;
  for (const node of graph.nodes.values()) {
    const chain = longestChainNodesFrom(graph, node.id, ['supports', 'depends_on'], scratch);
    if (chain.length < minLen) continue;
    if (!chainHasMidChainChallenge(graph, chain)) continue;
    const headId = chain[0];
    const headNode = graph.nodes.get(headId)!;
    out.push({
      type: 'productive_stress_test',
      anchor_claim_id: headId,
      claim_text: headNode.text,
      chain_length: chain.length,
    });
  }
  const byAnchor = new Map<string, Finding>();
  for (const f of out) {
    const prev = byAnchor.get(f.anchor_claim_id);
    if (!prev || (f.chain_length ?? 0) > (prev.chain_length ?? 0)) {
      byAnchor.set(f.anchor_claim_id, f);
    }
  }
  return [...byAnchor.values()].sort((a, b) => (b.chain_length ?? 0) - (a.chain_length ?? 0));
}

// Bright: user claim with basis ∈ {research, empirical} has N+ assistant
// supports downstream.
export function detectGroundedPremiseAdopted(graph: SessionGraph): Finding[] {
  const out: Finding[] = [];
  for (const node of graph.nodes.values()) {
    if (node.speaker !== 'user') continue;
    if (node.basis !== 'research' && node.basis !== 'empirical') continue;

    const incoming = graph.incoming.get(node.id) ?? [];
    let assistantSupports = 0;
    for (const e of incoming) {
      const from = graph.nodes.get(e.from_claim);
      if (!from || from.speaker !== 'assistant') continue;
      if (e.type === 'supports' || e.type === 'depends_on') assistantSupports++;
    }
    if (assistantSupports >= REASONING_CONFIG.GROUNDED_PREMISE_MIN_SUPPORTS) {
      out.push({
        type: 'grounded_premise_adopted',
        anchor_claim_id: node.id,
        claim_text: node.text,
        downstream_count: assistantSupports,
      });
    }
  }
  out.sort((a, b) => (b.downstream_count ?? 0) - (a.downstream_count ?? 0));
  return out;
}

export function runAllDetectors(graph: SessionGraph): Finding[] {
  if (graph.nodes.size < REASONING_CONFIG.COLD_START_MIN_CLAIMS) return [];
  // One scratch shared between the two chain-walking detectors.
  const scratch = makeChainScratch();
  return [
    ...detectLoadBearingVibes(graph),
    ...detectUnchallengedChain(graph, scratch),
    ...detectEchoChamber(graph),
    ...detectWellSourcedLoadBearer(graph),
    ...detectProductiveStressTest(graph, scratch),
    ...detectGroundedPremiseAdopted(graph),
  ];
}
