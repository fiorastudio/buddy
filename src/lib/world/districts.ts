// src/lib/world/districts.ts
// Per-town population cap (RO channel style). Used by the teleport/warp handler
// to reject moving into a full town (409 town_full). Capacity SHARDING is
// intentionally gone — everyone lands together in Prontera and moves by `warp`;
// see towns.ts / src/lib/world/handlers.ts.

export const DISTRICT_CAPACITY = 80;
