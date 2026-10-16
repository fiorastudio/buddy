// src/lib/world/districts.ts
// Per-town population cap (RO channel style). Used by the teleport/warp handler
// to reject moving into a full town (409 town_full). Capacity SHARDING is
// intentionally gone — everyone lands together in Prontera and moves by `warp`;
// see towns.ts / src/lib/world/handlers.ts.

export const DISTRICT_CAPACITY = 80;

// Prontera, the capital. Every new citizen lands here and every satellite's
// only portal leads back here, so the hub is UNCAPPED: a full hub would strand
// buddies in satellites (their one way home 409s) and turn away newcomers.
// Only the satellites are capacity-gated.
export const HUB_DISTRICT = 'plaza-1';

export function isCapacityGated(district: string): boolean {
  return district !== HUB_DISTRICT;
}

// Who counts as a town's resident — both for the capacity gate and for the
// `/v1/world` listing (so the gate matches what the plaza renders). A citizen is
// a resident while its owner has synced (teleport, events, snapshot) within this
// window; anyone quieter has wandered off and frees their slot. Without it,
// every citizen EVER created counted forever, so towns filled up for good and
// one IP could lock every town by minting tokens (release audit B2).
//
// 72h: long enough to keep weekend/part-time coders on the map, and to keep the
// plaza's own tiers meaningful (15 min "active" glow, 3h+ idle buddies sit) —
// sitting buddies are the 3h–72h band. Short enough that abandoned or
// bulk-minted citizens age out in days, not never.
export const RESIDENT_WINDOW_MS = 72 * 3_600_000;

// Hard cap on citizens one `/v1/world` poll returns (most recently seen first).
// Satellites are gated at DISTRICT_CAPACITY but residents already inside can
// return past it, and the hub is uncapped — 2x keeps a busy town rendering
// everyone plausible without letting the 10s poll ship an unbounded roster.
export const WORLD_CITIZEN_LIMIT = 2 * DISTRICT_CAPACITY;
