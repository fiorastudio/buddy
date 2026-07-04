// src/lib/world/antiabuse.ts
// XP-rate clamping for Buddy World syncs. Max plausible legitimate rate:
// ~20 XP-earning events/hour at the richest reward (deploy = 25 XP).

export const XP_PER_HOUR_CAP = 500;

// Small grace so a first sync right after a deploy isn't flagged.
const GRACE_XP = 25;

export interface ClampResult {
  xp: number;
  flagged: boolean;
}

export function clampXpDelta(prevXp: number, newXp: number, elapsedMs: number): ClampResult {
  if (newXp < prevXp) {
    // XP never decreases; keep the previous value and flag.
    return { xp: prevXp, flagged: true };
  }
  const elapsedHours = Math.max(0, elapsedMs) / 3_600_000;
  const allowance = Math.ceil(elapsedHours * XP_PER_HOUR_CAP) + GRACE_XP;
  const delta = newXp - prevXp;
  if (delta > allowance) {
    return { xp: prevXp + allowance, flagged: true };
  }
  return { xp: newXp, flagged: false };
}
