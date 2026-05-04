// src/lib/reasoning/graph-cache.ts
//
// Close #4 (graph-rebuilt-each-observe). Cache the SessionGraph keyed by
// (session_id, in-process generation, SQLite data_version) where:
//
//   - in-process generation: bumped by writeClaims in the same process,
//     fast same-process invalidation (no SQL query needed for a hit)
//   - data_version: SQLite PRAGMA, a database-file-wide counter that
//     increments on write commits from any connection. Catches the
//     cross-process case where the Stop hook process writes claims and
//     the long-lived MCP server's in-process counter never learned about
//     it. Without this, the MCP server would serve a stale cached graph
//     to detectors and miss newly-extracted load-bearing claims.
//
// Simple bounded LRU (~32 entries) — guard mode across many workspaces in
// one long-lived server is uncommon, and a cache miss is just the old
// non-cached behavior. No correctness risk.

import type Database from 'better-sqlite3';
import { type SessionGraph, loadSessionGraph } from './graph.js';

const MAX_ENTRIES = 32;

type Entry = { generation: number; dataVersion: number; graph: SessionGraph };

const cache = new Map<string, Entry>();
const generations = new Map<string, number>();

export function bumpGeneration(sessionId: string): void {
  generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1);
}

export function currentGeneration(sessionId: string): number {
  return generations.get(sessionId) ?? 0;
}

/**
 * SQLite data_version is a database-wide counter that increments on write
 * commits from any connection. Cheap to read (~5μs). Returns 0 on failure
 * so we always invalidate (safe-side) if the pragma somehow throws.
 */
function readDataVersion(db: Database.Database): number {
  try {
    const v = db.pragma('data_version', { simple: true });
    return typeof v === 'number' ? v : 0;
  } catch {
    return 0;
  }
}

export function loadSessionGraphCached(db: Database.Database, sessionId: string): SessionGraph {
  const gen = currentGeneration(sessionId);
  const dataVer = readDataVersion(db);
  const hit = cache.get(sessionId);
  if (hit && hit.generation === gen && hit.dataVersion === dataVer) {
    // LRU touch.
    cache.delete(sessionId);
    cache.set(sessionId, hit);
    return hit.graph;
  }
  const graph = loadSessionGraph(db, sessionId);
  cache.set(sessionId, { generation: gen, dataVersion: dataVer, graph });
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
