// src/lib/reasoning/telemetry.ts
//
// Lightweight in-process counters. Doctor reads these to report guard-mode
// health. Not persisted; resets on restart.

import type { FindingType, Basis } from './types.js';
import type { RootSource } from './project-root.js';

type Counters = {
  observes_total: number;
  observes_guard_mode: number;
  claims_received_total: number;
  edges_received_total: number;
  claims_written: number;
  edges_written: number;
  claims_dropped: number;
  edges_dropped: number;
  findings_surfaced_total: number;
  findings_by_type: Record<FindingType, number>;
  detector_latency_ms_sum: number;
  detector_latency_ms_count: number;
  detector_latency_ms_max: number;
  budget_exceeded_total: number;
  pipeline_failures_total: number;
  last_claims_received_at: number | null;
  last_observe_at: number | null;
  // Basis-distribution quality monitor: counts per basis in a rolling
  // window (last 50 claims). Doctor flags degenerate distributions.
  basis_window: Basis[];
  // Project-root resolution sources seen this run. Doctor surfaces
  // "workspace-isolation-probably-wrong" when homedir or plain cwd
  // resolution dominates.
  root_source_counts: Record<RootSource, number>;
};

const BASIS_WINDOW_SIZE = 50;

function zero(): Counters {
  return {
    observes_total: 0,
    observes_guard_mode: 0,
    claims_received_total: 0,
    edges_received_total: 0,
    claims_written: 0,
    edges_written: 0,
    claims_dropped: 0,
    edges_dropped: 0,
    findings_surfaced_total: 0,
    findings_by_type: {
      load_bearing_vibes: 0,
      unchallenged_chain: 0,
      echo_chamber: 0,
      well_sourced_load_bearer: 0,
      productive_stress_test: 0,
      grounded_premise_adopted: 0,
    },
    detector_latency_ms_sum: 0,
    detector_latency_ms_count: 0,
    detector_latency_ms_max: 0,
    budget_exceeded_total: 0,
    pipeline_failures_total: 0,
    last_claims_received_at: null,
    last_observe_at: null,
    basis_window: [],
    root_source_counts: { hint: 0, env: 0, marker: 0, cwd: 0, homedir: 0 },
  };
}

let counters: Counters = zero();

export function incObserve(guardMode: boolean): void {
  counters.observes_total++;
  if (guardMode) counters.observes_guard_mode++;
  counters.last_observe_at = Date.now();
}

export function recordClaimWrites(received: { claims: number; edges: number }, written: { claimsWritten: number; edgesWritten: number; claimsDropped: number; edgesDropped: number }): void {
  counters.claims_received_total += received.claims;
  counters.edges_received_total += received.edges;
  counters.claims_written += written.claimsWritten;
  counters.edges_written += written.edgesWritten;
  counters.claims_dropped += written.claimsDropped;
  counters.edges_dropped += written.edgesDropped;
  if (received.claims > 0) counters.last_claims_received_at = Date.now();
}

export function recordFinding(type: FindingType): void {
  counters.findings_surfaced_total++;
  counters.findings_by_type[type]++;
}

export function recordDetectorLatency(ms: number, budgetExceeded: boolean): void {
  // Round at the telemetry boundary so the stored aggregates are integer
  // milliseconds. performance.now() returns sub-ms floats; those are useful
  // for the budget comparison (caller keeps the precise value) but noisy
  // in long-running sum/max accumulators.
  const rounded = Math.round(ms);
  counters.detector_latency_ms_sum += rounded;
  counters.detector_latency_ms_count++;
  if (rounded > counters.detector_latency_ms_max) counters.detector_latency_ms_max = rounded;
  if (budgetExceeded) counters.budget_exceeded_total++;
}

export function recordPipelineFailure(): void {
  counters.pipeline_failures_total++;
}

export function recordBasis(basis: Basis): void {
  counters.basis_window.push(basis);
  if (counters.basis_window.length > BASIS_WINDOW_SIZE) counters.basis_window.shift();
}

export function recordRootResolution(source: RootSource): void {
  counters.root_source_counts[source]++;
}

/** Analyze the basis window for degenerate distribution. Returns null if
 *  the sample is too small to draw conclusions (<20 claims), or an object
 *  describing the degenerate state. "Degenerate" = one basis > 80% of
 *  the window, signaling the host isn't classifying thoughtfully. */
export function basisDistributionHealth(): { degenerate: boolean; dominantBasis?: Basis; pct?: number; sample: number } {
  const w = counters.basis_window;
  if (w.length < 20) return { degenerate: false, sample: w.length };
  const tally: Partial<Record<Basis, number>> = {};
  for (const b of w) tally[b] = (tally[b] ?? 0) + 1;
  let dom: Basis | undefined; let domN = 0;
  for (const [k, n] of Object.entries(tally)) {
    if ((n ?? 0) > domN) { domN = n as number; dom = k as Basis; }
  }
  const pct = domN / w.length;
  if (pct > 0.8 && dom) return { degenerate: true, dominantBasis: dom, pct, sample: w.length };
  return { degenerate: false, dominantBasis: dom, pct, sample: w.length };
}

export function snapshot(): Counters {
  return {
    ...counters,
    findings_by_type: { ...counters.findings_by_type },
    basis_window: [...counters.basis_window],
    root_source_counts: { ...counters.root_source_counts },
  };
}

export function reset(): void {
  counters = zero();
}
