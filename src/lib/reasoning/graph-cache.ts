// src/lib/reasoning/graph-cache.ts
//
// Close #4 (graph-rebuilt-each-observe). Cache the SessionGraph keyed by
// (session_id, generation) where generation bumps whenever we write to
// the session's claims/edges. writeClaims bumps; loadSessionGraphCached
// checks the generation before returning a cached graph.
//
// Simple bounded LRU (~20 entries) — guard mode across many workspaces in
// one long-lived server is uncommon, and a cache miss is just the old
// non-cached behavior. No correctness risk.

import type Database from 'better-sqlite3';
import { type SessionGraph, loadSessionGraph } from './graph.js';

const MAX_ENTRIES = 32;

type Entry = { generation: number; graph: SessionGraph };

const cache = new Map<string, Entry>();
const generations = new Map<string, number>();

export function bumpGeneration(sessionId: string): void {
  generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
}

export function currentGeneration(sessionId: string): number {
  return generations.get(sessionId) ?? 0;
}

export function loadSessionGraphCached(db: Database.Database, sessionId: string): SessionGraph {
  const gen = currentGeneration(sessionId);
  const hit = cache.get(sessionId);
  if (hit && hit.generation === gen) {
    // LRU touch.
    cache.delete(sessionId);
    cache.set(sessionId, hit);
    return hit.graph;
  }
  const graph = loadSessionGraph(db, sessionId);
  cache.set(sessionId, { generation: gen, graph });
  // Evict oldest if over cap.
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
  return graph;
}

/** Test hook. */
export function resetGraphCache(): void {
  cache.clear();
  generations.clear();
}

/** Test/introspection. */
export function cacheStats(): { size: number; sessions: string[] } {
  return { size: cache.size, sessions: [...cache.keys()] };
}
