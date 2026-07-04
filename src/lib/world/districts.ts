// src/lib/world/districts.ts
// District sharding: plazas cap at 80 citizens (RO channel style).

export const DISTRICT_CAPACITY = 80;

export function pickDistrict(counts: Record<string, number>): string {
  for (let i = 1; i <= Object.keys(counts).length + 1; i++) {
    const name = `plaza-${i}`;
    if ((counts[name] ?? 0) < DISTRICT_CAPACITY) return name;
  }
  // Unreachable: the loop always finds a district within counts.length + 1.
  return `plaza-${Object.keys(counts).length + 1}`;
}
