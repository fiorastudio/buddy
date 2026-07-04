// src/lib/world/antiabuse.ts
// XP-rate enforcement via a persisted token bucket. Max plausible
// legitimate rate: ~20 XP-earning events/hour at the richest reward
// (deploy = 25 XP) → 500/hr refill. The stored budget lets honest bursts
// (a deploy right after idle) through while bounding EVERY request
// pattern to cap*elapsed + burst — per-request grace amplified to 4x the
// cap and is gone (Codex review finding, PR #143).

export const XP_PER_HOUR_CAP = 500;
export const XP_BURST_CAP = 200;

export interface SpendResult {
  /** XP actually granted (≤ requested). */
  granted: number;
  /** New budget to persist on the citizen row. */
  budget: number;
  flagged: boolean;
}

export function spendXpBudget(budget: number, elapsedMs: number, requested: number): SpendResult {
  if (requested <= 0) {
    // No gain (or a decrease, handled by the caller as its own flag).
    const refilled = Math.min(XP_BURST_CAP, budget + (Math.max(0, elapsedMs) / 3_600_000) * XP_PER_HOUR_CAP);
    return { granted: 0, budget: refilled, flagged: false };
  }
  const refilled = Math.min(XP_BURST_CAP, budget + (Math.max(0, elapsedMs) / 3_600_000) * XP_PER_HOUR_CAP);
  if (requested <= refilled) {
    return { granted: requested, budget: refilled - requested, flagged: false };
  }
  const granted = Math.floor(refilled);
  return { granted, budget: refilled - granted, flagged: true };
}
