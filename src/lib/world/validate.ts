// src/lib/world/validate.ts
// Snapshot validation for Buddy World teleport/sync payloads.
// Ground truth for level/xp consistency is the real leveling curve.

import { levelFromXp } from '../leveling.js';
import { RARITIES, EYES, HATS } from '../types.js';
import { SPECIES_LIST } from '../species.js';

export const WORLD_MOODS = ['happy', 'content', 'neutral', 'curious', 'grumpy', 'exhausted'] as const;

export const MAX_NAME_LENGTH = 32;

// The owner avatars the plaza can draw (plaza.js AVATARS has 8 entries and the
// CLI documents `--avatar chibi-1..8`). Anything else is rejected rather than
// stored and shipped to every viewer.
export const AVATAR_RE = /^chibi-[1-8]$/;

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

// On success, `snapshot` is a fresh object rebuilt from the known fields only:
// callers must store THAT, never the raw input, so unknown keys (in the
// snapshot or in `stats`) can't ride along into the database and back out to
// every viewer of /v1/world (release audit B4).
export type ValidationResult = { ok: true; snapshot: WorldSnapshot } | { ok: false; reason: string };

export const STAT_KEYS = ['debugging', 'patience', 'chaos', 'wisdom', 'snark'] as const;

// Exactly the five stats, nothing else. Used on write (stores) and on read, so
// a row written before this was enforced is still served in canonical shape.
export function pickStats(stats: unknown): WorldSnapshot['stats'] {
  const src = (stats !== null && typeof stats === 'object' ? stats : {}) as Record<string, unknown>;
  const out = {} as WorldSnapshot['stats'];
  for (const key of STAT_KEYS) {
    const v = src[key];
    out[key] = typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
  }
  return out;
}

// A stored/served avatar is either a known one or nothing.
export function pickAvatar(avatar: unknown): string | null {
  return typeof avatar === 'string' && AVATAR_RE.test(avatar) ? avatar : null;
}

function oneOf(list: readonly string[], v: unknown): v is string {
  return typeof v === 'string' && list.includes(v);
}

export function validateSnapshot(input: unknown): ValidationResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'snapshot must be an object' };
  }
  const snap = input as Record<string, unknown>;
  const name = snap.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, reason: 'name must be a non-empty string' };
  }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `name exceeds ${MAX_NAME_LENGTH} characters` };
  }
  // Names render in web viewers; ban HTML-metacharacters outright rather
  // than trusting every render site to escape (defense in depth with the
  // client's textContent-only construction).
  if (/[<>&"'`]/.test(name)) {
    return { ok: false, reason: 'name contains disallowed characters' };
  }
  if (!oneOf(SPECIES_LIST, snap.species)) {
    return { ok: false, reason: `unknown species: ${String(snap.species).slice(0, 40)}` };
  }
  const xp = snap.xp;
  if (typeof xp !== 'number' || !Number.isSafeInteger(xp) || xp < 0) {
    return { ok: false, reason: 'xp must be a non-negative integer' };
  }
  if (levelFromXp(xp) !== snap.level) {
    return { ok: false, reason: `level ${String(snap.level).slice(0, 20)} does not match xp ${xp}` };
  }
  const rawStats = snap.stats;
  if (rawStats === null || typeof rawStats !== 'object' || Array.isArray(rawStats)) {
    return { ok: false, reason: 'stats must be an object' };
  }
  for (const key of STAT_KEYS) {
    const v = (rawStats as Record<string, unknown>)[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, reason: `stat ${key} out of range` };
    }
  }
  if (!oneOf(WORLD_MOODS, snap.mood)) {
    return { ok: false, reason: `unknown mood: ${String(snap.mood).slice(0, 40)}` };
  }
  if (!oneOf(RARITIES, snap.rarity)) {
    return { ok: false, reason: `unknown rarity: ${String(snap.rarity).slice(0, 40)}` };
  }
  if (!oneOf(HATS, snap.hat)) {
    return { ok: false, reason: `unknown hat: ${String(snap.hat).slice(0, 40)}` };
  }
  if (!oneOf(EYES, snap.eye)) {
    return { ok: false, reason: `unknown eye: ${String(snap.eye).slice(0, 40)}` };
  }
  if (snap.shiny !== undefined && typeof snap.shiny !== 'boolean') {
    return { ok: false, reason: 'shiny must be a boolean' };
  }
  // Optional: absent/null means "keep whatever is stored" (or none).
  if (snap.avatar !== undefined && snap.avatar !== null && pickAvatar(snap.avatar) === null) {
    return { ok: false, reason: 'unknown avatar (expected chibi-1..chibi-8)' };
  }

  const snapshot: WorldSnapshot = {
    name,
    species: snap.species as string,
    level: snap.level as number,
    xp,
    mood: snap.mood as string,
    stats: pickStats(rawStats),
    rarity: snap.rarity as string,
    shiny: snap.shiny === true,
    hat: snap.hat as string,
    eye: snap.eye as string,
  };
  const avatar = pickAvatar(snap.avatar);
  if (avatar) snapshot.avatar = avatar;
  return { ok: true, snapshot };
}
