// src/lib/reasoning/pipeline.ts
//
// Self-contained max-mode pipeline. Accepts a DB handle and the raw inputs
// from buddy_observe; returns the finding to inject (or null) + an
// extraction instruction to append to the observer prompt.
//
// Extracted from the observe handler so the full flow is unit-testable
// without spinning up the MCP server — and so the "detector budget
// exceeded" and "malformed input" paths have a seam we can target in
// tests, not just integration.

import type Database from 'better-sqlite3';
import { deriveSessionId } from './session.js';
import { writeClaims, loadRecentClaims, type WriteResult } from './writer.js';
import { loadSessionGraphCached } from './graph-cache.js';
import { runAllDetectors } from './detectors.js';
import { selectFinding, logFinding } from './findings.js';
import { buildExtractionInstruction } from './extract-prompt.js';
import { getAndBumpObserveSeq } from './observe-seq.js';
import { REASONING_CONFIG } from './config.js';
import type { Finding, StoredClaim } from './types.js';
import { resolveProjectRoot, type ResolvedRoot } from './project-root.js';
import * as telemetry from './telemetry.js';

export type PipelineInputs = {
  companionId: string;
  /** cwd hint from the tool caller. Optional — resolveProjectRoot will
   *  try env vars and project-marker walk-up before falling back. */
  cwd?: string | null;
  claims: unknown;
  edges: unknown;
};

export type PipelineOutputs = {
  sessionId: string;
  resolvedRoot: ResolvedRoot;
  writeResult: WriteResult;
  finding: Finding | null;
  extractionInstruction: string;
  detectorMs: number;
  budgetExceeded: boolean;
  recentClaims: StoredClaim[];
};

/**
 * Options are test hooks. In production they are all defaulted — the
 * server handler does not need to pass anything beyond the required
 * inputs. Marked @internal so IDEs dim these for normal callers.
 */
export type PipelineOptions = {
  /** @internal — override budget for tests. */
  detectorBudgetMs?: number;
  /** @internal — override now-getter for deterministic tests. */
  now?: () => number;
  /** @internal — override the elapsed-time measurer — tests can force
   *  "slow" detectors by returning a large `ms` value. */
  measureDetectorMs?: <T>(fn: () => T) => { value: T; ms: number };
};

function defaultMeasure<T>(fn: () => T): { value: T; ms: number } {
  // Use performance.now() instead of Date.now() — the latter has ~15ms
  // resolution on Windows, borderline against a 30ms detector budget.
  // performance.now() is sub-ms-resolution and monotonic.
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

export function runMaxModePipeline(
  db: Database.Database,
  inputs: PipelineInputs,
  options: PipelineOptions = {},
): PipelineOutputs {
  const budget = options.detectorBudgetMs ?? REASONING_CONFIG.DETECTOR_BUDGET_MS;
  const measure = options.measureDetectorMs ?? defaultMeasure;

  // Resolve project root from (hint → env vars → marker walk → cwd).
  // If resolution lands on `homedir` or `cwd` without a project marker,
  // telemetry records the source so the doctor can surface "workspace
  // isolation is probably wrong" to the user.
  const resolvedRoot = resolveProjectRoot(inputs.cwd);
  telemetry.recordRootResolution(resolvedRoot.source);

  const sessionId = deriveSessionId(resolvedRoot.path, options.now?.() ?? Date.now());

  const incomingClaimsCount = Array.isArray(inputs.claims) ? inputs.claims.length : 0;
  const incomingEdgesCount = Array.isArray(inputs.edges) ? inputs.edges.length : 0;

  const writeResult = writeClaims(db, sessionId, inputs.claims, inputs.edges);
  telemetry.recordClaimWrites(
    { claims: incomingClaimsCount, edges: incomingEdgesCount },
    writeResult,
  );
  // Basis distribution is captured per-claim for the quality monitor.
  if (Array.isArray(inputs.claims)) {
    for (const c of inputs.claims as any[]) {
      if (c && typeof c === 'object' && typeof c.basis === 'string') {
        telemetry.recordBasis(c.basis);
      }
    }
  }

  // Note: getAndBumpObserveSeq runs AFTER writeClaims. If the bump throws
  // (e.g. transient DB lock) the caller's outer try/catch swallows the
  // whole pipeline failure and observe falls through to a finding-less
  // reaction. The seq stays at its previous value; the next observe
  // increments by 1 rather than 2. This means the cooldown window for
  // that one skipped observe is slightly shorter than intended. That
  // drift is bounded (skipped observes don't compound) and self-heals
  // on every successful bump.
  const seqInfo = getAndBumpObserveSeq(db, inputs.companionId, incomingClaimsCount > 0);

  const graph = loadSessionGraphCached(db, sessionId);
  const measured = measure(() => runAllDetectors(graph));
  const budgetExceeded = measured.ms > budget;
  telemetry.recordDetectorLatency(measured.ms, budgetExceeded);

  let finding: Finding | null = null;
  if (!budgetExceeded) {
    finding = selectFinding(db, inputs.companionId, seqInfo.seq, measured.value);
    if (finding) {
      logFinding(db, inputs.companionId, sessionId, finding, seqInfo.seq);
      telemetry.recordFinding(finding.type);
    }
  }

  const recentClaims = loadRecentClaims(db, sessionId, REASONING_CONFIG.RECENT_CLAIMS_CONTEXT);
  const extractionInstruction = buildExtractionInstruction(recentClaims);

  return {
    sessionId,
    resolvedRoot,
    writeResult,
    finding,
    extractionInstruction,
    detectorMs: measured.ms,
    budgetExceeded,
    recentClaims,
  };
}
