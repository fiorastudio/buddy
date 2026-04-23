// src/lib/reasoning/graph.ts
//
// Lightweight graph adapter. Detectors load the session graph once per
// observe and run against the in-memory structure. Graphs are small
// (capped at 200 claims) so loading-everything is cheap and cycle-safe
// traversals are straightforward.

import type Database from 'better-sqlite3';
import type { StoredClaim, StoredEdge, EdgeType, Basis } from './types.js';

export type Node = StoredClaim;
export type Edge = StoredEdge;

export type SessionGraph = {
  sessionId: string;
  nodes: Map<string, Node>;
  edgesById: Map<string, Edge>;
  outgoing: Map<string, Edge[]>;   // from_claim → edges
  incoming: Map<string, Edge[]>;   // to_claim → edges
};

// Per-invocation scratch the detectors can share across their iteration
// loops. Keys are encoded with the edge-type set so concurrent detectors
// using different type filters (e.g. unchallenged-chain uses [supports,
// depends_on], future detectors may differ) don't collide.
export type ChainScratch = {
  longestFrom: Map<string, number>;        // nodeId:typesKey → longest path length
  longestNodesFrom: Map<string, string[]>; // nodeId:typesKey → longest path node list
};

export function makeChainScratch(): ChainScratch {
  return { longestFrom: new Map(), longestNodesFrom: new Map() };
}

function typesKey(types: EdgeType[]): string {
  return [...types].sort().join('|');
}

export function loadSessionGraph(db: Database.Database, sessionId: string): SessionGraph {
  const nodeRows = db.prepare(
    `SELECT id, session_id, speaker, text, basis, confidence, created_at
     FROM reasoning_claims WHERE session_id = ? ORDER BY created_at ASC`
  ).all(sessionId) as StoredClaim[];

  const edgeRows = db.prepare(
    `SELECT id, session_id, from_claim, to_claim, type, created_at
     FROM reasoning_edges WHERE session_id = ? ORDER BY created_at ASC`
  ).all(sessionId) as StoredEdge[];

  const nodes = new Map<string, Node>();
  for (const n of nodeRows) nodes.set(n.id, n);

  const edgesById = new Map<string, Edge>();
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();

  for (const e of edgeRows) {
    if (!nodes.has(e.from_claim) || !nodes.has(e.to_claim)) continue;
    edgesById.set(e.id, e);
    const outList = outgoing.get(e.from_claim) ?? [];
    outList.push(e);
    outgoing.set(e.from_claim, outList);
    const inList = incoming.get(e.to_claim) ?? [];
    inList.push(e);
    incoming.set(e.to_claim, inList);
  }

  return { sessionId, nodes, edgesById, outgoing, incoming };
}

export function downstreamCount(graph: SessionGraph, claimId: string, types: EdgeType[] = ['supports', 'depends_on']): number {
  const list = graph.incoming.get(claimId) ?? [];
  return list.filter(e => types.includes(e.type)).length;
}

export function outgoingOfType(graph: SessionGraph, claimId: string, types: EdgeType[]): Edge[] {
  const list = graph.outgoing.get(claimId) ?? [];
  return list.filter(e => types.includes(e.type));
}

export function nodesByBasis(graph: SessionGraph, bases: Basis[]): Node[] {
  const out: Node[] = [];
  for (const n of graph.nodes.values()) {
    if (bases.includes(n.basis)) out.push(n);
  }
  return out;
}

// Longest path (as node id list) starting from `start`, following only
// edges of the allowed types, with no node visited twice on a given path.
// DFS with a scratch cache keyed by (node, types). Shared scratch lets
// multiple starting-node queries reuse subtree answers.
export function longestChainNodesFrom(
  graph: SessionGraph,
  start: string,
  types: EdgeType[],
  scratch: ChainScratch = makeChainScratch(),
): string[] {
  const k = typesKey(types);
  const visiting = new Set<string>();

  function visit(node: string): string[] {
    const ck = `${node}:${k}`;
    const cached = scratch.longestNodesFrom.get(ck);
    if (cached) return cached;
    // Cycle break: return a minimal path and do NOT cache it. The cache
    // is keyed only on (node, types) — it has no slot for "depth at which
    // we hit a cycle back to this node." Caching `[node]` here would
    // poison later visits that reach `node` from a non-cyclic path and
    // are entitled to its full longest chain. Acceptable cost: cyclic
    // subgraphs re-walk on each entry. Bounded by the 200-claim session
    // cap, so worst-case pathological cycles are still cheap.
    if (visiting.has(node)) return [node];
    visiting.add(node);
    let bestPath: string[] = [node];
    const outs = graph.outgoing.get(node) ?? [];
    for (const e of outs) {
      if (!types.includes(e.type)) continue;
      const childPath = visit(e.to_claim);
      if (1 + childPath.length > bestPath.length) {
        bestPath = [node, ...childPath];
      }
    }
    visiting.delete(node);
    scratch.longestNodesFrom.set(ck, bestPath);
    scratch.longestFrom.set(ck, bestPath.length - 1);
    return bestPath;
  }

  return visit(start);
}

export function longestChainFrom(
  graph: SessionGraph,
  start: string,
  types: EdgeType[],
  scratch: ChainScratch = makeChainScratch(),
): number {
  const nodes = longestChainNodesFrom(graph, start, types, scratch);
  return nodes.length - 1;
}

// Does any edge in the graph of `contradicts` or `questions` type connect
// two nodes in the chain? Used by unchallenged-chain detector.
export function chainHasChallenge(graph: SessionGraph, chainNodes: string[]): boolean {
  const set = new Set(chainNodes);
  for (const n of chainNodes) {
    const outs = graph.outgoing.get(n) ?? [];
    for (const e of outs) {
      if ((e.type === 'contradicts' || e.type === 'questions') && set.has(e.to_claim)) return true;
    }
    const ins = graph.incoming.get(n) ?? [];
    for (const e of ins) {
      if ((e.type === 'contradicts' || e.type === 'questions') && set.has(e.from_claim)) return true;
    }
  }
  return false;
}

// Challenge on any node EXCEPT the very last one in the chain.
// The chain must continue past the challenge for it to count as
// "productive stress test."
export function chainHasMidChainChallenge(graph: SessionGraph, chainNodes: string[]): boolean {
  if (chainNodes.length < 3) return false;
  const middle = new Set(chainNodes.slice(0, -1));
  for (const n of chainNodes) {
    const outs = graph.outgoing.get(n) ?? [];
    for (const e of outs) {
      if ((e.type === 'contradicts' || e.type === 'questions') && middle.has(e.to_claim)) return true;
    }
    const ins = graph.incoming.get(n) ?? [];
    for (const e of ins) {
      if ((e.type === 'contradicts' || e.type === 'questions') && middle.has(e.from_claim)) return true;
    }
  }
  return false;
}
