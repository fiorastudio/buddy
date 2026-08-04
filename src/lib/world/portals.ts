// src/lib/world/portals.ts
// The town portal graph (M4). Portals replace the old camera-only warp button:
// you WALK your controlled sprite into a portal tile and travel. The topology
// is hub-and-spoke with Prontera (plaza-1) at the center — every satellite is
// one hop from the capital, matching the RO overworld feel.
//
// This is the SHARED shape between client render (world/public/plaza.js draws a
// blue gate per portal `rect`) and server validation (handlePortalWarp resolves
// the `to` district). The (id, from, to) topology is drift-guarded against the
// inlined PORTALS array in plaza.js by portals-drift.test.ts, exactly like the
// TOWN_NAMES ↔ TOWNS[] guard. `from`/`to` are `plaza-N` districts and MUST stay
// aligned with the six-town validator in towns.ts (districtForTown).

// A rectangle on the courtyard floor, in fractional [0,1] map coordinates — the
// same unit square the room speaks (plaza.js maps it to pixels via toPixel). A
// sprite whose fractional position falls inside this rect has entered the gate.
export interface PortalRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Where the buddy arrives in the DESTINATION town (fractional). Kept clear of
// that town's own portal rects so arrival never instantly re-triggers a warp.
export interface PortalSpawn {
  x: number;
  y: number;
}

export interface Portal {
  id: string;
  from: string; // plaza-N you walk out of
  to: string; // plaza-N you arrive in
  rect: PortalRect; // gate footprint in `from`, fractional
  spawn: PortalSpawn; // arrival point in `to`, fractional
}

// Satellites arrive top-center; the return gate sits bottom-center, so you land
// well clear of it.
const SATELLITE_SPAWN: PortalSpawn = { x: 0.5, y: 0.2 };
// Arrivals into Prontera land at the fountain-center, clear of the edge gates.
const HUB_SPAWN: PortalSpawn = { x: 0.5, y: 0.5 };

// Prontera's five outgoing gates, spaced around the courtyard edge. Index i maps
// to satellite plaza-(i+2). Rects are deliberately roomy (~10% of the floor) so
// a walking sprite reliably lands inside one.
const HUB_GATE_RECTS: PortalRect[] = [
  { x: 0.08, y: 0.1, w: 0.1, h: 0.12 }, // top-left    → Payon   (plaza-2)
  { x: 0.82, y: 0.1, w: 0.1, h: 0.12 }, // top-right   → Geffen  (plaza-3)
  { x: 0.05, y: 0.44, w: 0.1, h: 0.12 }, // mid-left    → Alberta (plaza-4)
  { x: 0.85, y: 0.44, w: 0.1, h: 0.12 }, // mid-right   → Morroc  (plaza-5)
  { x: 0.45, y: 0.84, w: 0.1, h: 0.12 }, // bottom-cent → Comodo  (plaza-6)
];
// Every satellite's single gate home to Prontera sits bottom-center.
const RETURN_GATE_RECT: PortalRect = { x: 0.45, y: 0.84, w: 0.1, h: 0.12 };

// The full graph: 5 hub→satellite gates + 5 satellite→hub gates. Written out as
// a literal so the drift guard can compare it field-for-field with plaza.js.
export const PORTALS: Portal[] = [
  { id: 'prontera-payon', from: 'plaza-1', to: 'plaza-2', rect: HUB_GATE_RECTS[0], spawn: SATELLITE_SPAWN },
  { id: 'prontera-geffen', from: 'plaza-1', to: 'plaza-3', rect: HUB_GATE_RECTS[1], spawn: SATELLITE_SPAWN },
  { id: 'prontera-alberta', from: 'plaza-1', to: 'plaza-4', rect: HUB_GATE_RECTS[2], spawn: SATELLITE_SPAWN },
  { id: 'prontera-morroc', from: 'plaza-1', to: 'plaza-5', rect: HUB_GATE_RECTS[3], spawn: SATELLITE_SPAWN },
  { id: 'prontera-comodo', from: 'plaza-1', to: 'plaza-6', rect: HUB_GATE_RECTS[4], spawn: SATELLITE_SPAWN },
  { id: 'payon-prontera', from: 'plaza-2', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
  { id: 'geffen-prontera', from: 'plaza-3', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
  { id: 'alberta-prontera', from: 'plaza-4', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
  { id: 'morroc-prontera', from: 'plaza-5', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
  { id: 'comodo-prontera', from: 'plaza-6', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
];

// The gates rendered/walkable in a given town.
export function portalsFrom(district: string): Portal[] {
  return PORTALS.filter((p) => p.from === district);
}

// The specific gate connecting two towns, or null if they aren't linked (e.g.
// satellite→satellite, which the hub-and-spoke graph never offers directly).
export function portalBetween(from: string, to: string): Portal | null {
  return PORTALS.find((p) => p.from === from && p.to === to) ?? null;
}

// Where a buddy should appear when it lands in `to` having come from `from`.
// Falls back to the hub-center default for pairs without a direct gate (e.g.
// the idempotent already-there case, where from === to).
export function spawnInto(from: string, to: string): PortalSpawn {
  return portalBetween(from, to)?.spawn ?? HUB_SPAWN;
}
