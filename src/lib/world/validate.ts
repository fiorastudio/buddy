// src/lib/world/validate.ts
// Snapshot validation for Buddy World teleport/sync payloads.
// Ground truth for level/xp consistency is the real leveling curve.

import { levelFromXp } from '../leveling.js';
import { RARITIES, EYES, HATS } from '../types.js';
import { SPECIES_LIST } from '../species.js';

export const WORLD_MOODS = ['happy', 'content', 'neutral', 'curious', 'grumpy', 'exhausted'] as const;

export const MAX_NAME_LENGTH = 32;

export interface WorldSnapshot {
  name: string;
  species: string;
  level: number;
  xp: number;
  mood: string;
  stats: { debugging: number; patience: number; chaos: number; wisdom: number; snark: number };
  rarity: string;
  shiny: boolean;
  hat: string;
  eye: string;
  avatar?: string;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

const STAT_KEYS = ['debugging', 'patience', 'chaos', 'wisdom', 'snark'] as const;

export function validateSnapshot(input: unknown): ValidationResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'snapshot must be an object' };
  }
  const snap = input as WorldSnapshot;
  if (typeof snap.name !== 'string' || snap.name.trim().length === 0) {
    return { ok: false, reason: 'name must be a non-empty string' };
  }
  if (snap.name.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `name exceeds ${MAX_NAME_LENGTH} characters` };
  }
  // Names render in web viewers; ban HTML-metacharacters outright rather
  // than trusting every render site to escape (defense in depth with the
  // client's textContent-only construction).
  if (/[<>&"'`]/.test(snap.name)) {
    return { ok: false, reason: 'name contains disallowed characters' };
  }
  if (!SPECIES_LIST.includes(snap.species as (typeof SPECIES_LIST)[number])) {
    return { ok: false, reason: `unknown species: ${snap.species}` };
  }
  if (!Number.isInteger(snap.xp) || snap.xp < 0) {
    return { ok: false, reason: 'xp must be a non-negative integer' };
  }
  if (levelFromXp(snap.xp) !== snap.level) {
    return { ok: false, reason: `level ${snap.level} does not match xp ${snap.xp}` };
  }
  for (const key of STAT_KEYS) {
    const v = snap.stats?.[key];
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, reason: `stat ${key} out of range` };
    }
  }
  if (!(WORLD_MOODS as readonly string[]).includes(snap.mood)) {
    return { ok: false, reason: `unknown mood: ${snap.mood}` };
  }
  if (!(RARITIES as readonly string[]).includes(snap.rarity)) {
    return { ok: false, reason: `unknown rarity: ${snap.rarity}` };
  }
  if (!(HATS as readonly string[]).includes(snap.hat)) {
    return { ok: false, reason: `unknown hat: ${snap.hat}` };
  }
  if (!(EYES as readonly string[]).includes(snap.eye)) {
    return { ok: false, reason: `unknown eye: ${snap.eye}` };
  }
  return { ok: true };
}
