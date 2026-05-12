// src/lib/reasoning/pipeline.ts
//
// Self-contained guard-mode pipeline. Accepts a DB handle and the raw inputs
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
import { selectFindingDetailed, logFinding } from './findings.js';
import { buildExtractionInstruction } from './extract-prompt.js';
import { getAndBumpObserveSeq } from './observe-seq.js';
import { REASONING_CONFIG } from './config.js';
import type { Finding, StoredClaim } from './types.js';
import { resolveProjectRoot, type ResolvedRoot } from './project-root.js';
import * as telemetry from './telemetry.js';

export type PipelineInputs = {
  companionId: string;
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

export type PipelineOptions = {
  detectorBudgetMs?: number;
  now?: () => number;
  measureDetectorMs?: <T>(fn: () => T) => { value: T; ms: number };
};

function defaultMeasure<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

export function runGuardPipeline(
  db: Database.Database,
  inputs: PipelineInputs,
  options: PipelineOptions = {},
): PipelineOutputs {
  const budget = options.detectorBudgetMs ?? REASONING_CONFIG.DETECTOR_BUDGET_MS;
  const measure = options.measureDetectorMs ?? defaultMeasure;

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

  if (Array.isArray(inputs.claims)) {
    for (const c of inputs.claims as any[]) {
      if (c && typeof c === 'object' && typeof c.basis === 'string') {
        telemetry.recordBasis(c.basis);
      }
    }
  }
  if (Array.isArray(inputs.edges)) {
    for (const e of inputs.edges as any[]) {
      if (e && typeof e === 'object' && typeof e.type === 'string') {
        telemetry.recordEdgeType(e.type);
      }
    }
  }

  const seqInfo = getAndBumpObserveSeq(db, inputs.companionId, incomingClaimsCount > 0);

  const graph = loadSessionGraphCached(db, sessionId);
  const measured = measure(() => runAllDetectors(graph));
  const budgetExceeded = measured.ms > budget;
  telemetry.recordDetectorLatency(measured.ms, budgetExceeded);
  telemetry.recordDetectedFindings(measured.value.map(f => f.type));

  let finding: Finding | null = null;
  if (budgetExceeded) {
    telemetry.recordSuppressedFinding('budget');
  } else {
    const selection = selectFindingDetailed(db, inputs.companionId, seqInfo.seq, measured.value);
    finding = selection.finding;
    if (selection.suppression) telemetry.recordSuppressedFinding(selection.suppression);
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
