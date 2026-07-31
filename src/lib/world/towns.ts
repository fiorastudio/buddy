// src/lib/world/towns.ts
// Shared town identity for Buddy World. The server speaks generic `plaza-N`;
// this maps the RO city names owners actually type to those districts and back.
// Order MUST match `TOWNS[]` in world/public/plaza.js — guarded by
// src/__tests__/world/towns-drift.test.ts.

export const TOWN_NAMES = ['Prontera', 'Payon', 'Geffen', 'Alberta', 'Morroc', 'Lutie'] as const;
export type TownName = (typeof TOWN_NAMES)[number];

// One-line vibe used for CLI flavor ("warped to Geffen (mage city)").
export const TOWN_BLURB: Record<TownName, string> = {
  Prontera: 'the capital',
  Payon: 'wooden village',
  Geffen: 'mage city',
  Alberta: 'port town',
  Morroc: 'desert city',
  Lutie: 'snow city',
};

/**
 * Resolve what an owner types into a `plaza-N` district.
 * Accepts a town name (case-insensitive, trimmed) or a raw `plaza-N`.
 * Returns null for anything unrecognized.
 */
export function districtForTown(input: string): string | null {
  const s = input.trim();
  const plaza = s.match(/^plaza-(\d+)$/i);
  if (plaza && Number(plaza[1]) >= 1) return `plaza-${Number(plaza[1])}`;
  const idx = TOWN_NAMES.findIndex((t) => t.toLowerCase() === s.toLowerCase());
  return idx >= 0 ? `plaza-${idx + 1}` : null;
}

/**
 * Reverse a stored `plaza-N` back to a town name, wrapping the same way the
 * plaza's townFor() does (plaza-7 → Prontera). Null for non-district strings.
 */
export function townForDistrict(district: string): TownName | null {
  const m = district.match(/^plaza-(\d+)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1) return null;
  return TOWN_NAMES[(n - 1) % TOWN_NAMES.length];
}
