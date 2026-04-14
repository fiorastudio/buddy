// src/lib/rng.ts

import {
  type CompanionBones,
  type Eye,
  type Hat,
  type Rarity,
  type StatName,
  EYES,
  HATS,
  RARITIES,
  RARITY_WEIGHTS,
  RARITY_FLOOR,
  STAT_NAMES,
} from './types.js';

const SALT = 'friend-2026-401';

// Mulberry32 — tiny seeded PRNG
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a hash
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic index selection from a seed string + namespace.
 * Keeps hashString/mulberry32 private — this is the public API.
 */
export function seededIndex(seed: string, namespace: string, length: number): number {
  if (length <= 0) return 0;
  const hash = hashString(seed + ':' + namespace);
  const rng = mulberry32(hash);
  return Math.floor(rng() * length);
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function rollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll < 0) return rarity;
  }
  return 'common';
}

function rollStats(rng: () => number, rarity: Rarity): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity];
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);
  while (dump === peak) dump = pick(rng, STAT_NAMES);

  const stats = {} as Record<StatName, number>;
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
    } else if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
    } else {
      stats[name] = floor + Math.floor(rng() * 40);
    }
  }
  return stats;
}

export type Roll = {
  bones: CompanionBones;
  inspirationSeed: number;
};

const HATS_WITH_HAT = HATS.filter(h => h !== 'none');

function rollFrom(rng: () => number, speciesList: readonly string[]): Roll {
  const rarity = rollRarity(rng);
  const bones: CompanionBones = {
    rarity,
    species: pick(rng, speciesList),
    eye: pick(rng, EYES),
    hat: rarity === 'common' ? 'none' : pick(rng, HATS_WITH_HAT),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  };
  return { bones, inspirationSeed: Math.floor(rng() * 1e9) };
}

// Cached roll — same userId always produces same bones
let rollCache: { key: string; value: Roll } | undefined;

export function roll(userId: string, speciesList: readonly string[]): Roll {
  const key = userId + SALT;
  if (rollCache?.key === key) return rollCache.value;
  const value = rollFrom(mulberry32(hashString(key)), speciesList);
  rollCache = { key, value };
  return value;
}

export function rollWithSeed(seed: string, speciesList: readonly string[]): Roll {
  return rollFrom(mulberry32(hashString(seed)), speciesList);
}

export function statBar(name: string, value: number): string {
  const totalBlocks = 8;
  const filled = (value / 100) * totalBlocks;
  const fullBlocks = Math.floor(filled);
  const remainder = filled - fullBlocks;
  const hasPartial = remainder >= 0.25 && fullBlocks < totalBlocks;
  const emptyBlocks = totalBlocks - fullBlocks - (hasPartial ? 1 : 0);
  const bar = '█'.repeat(fullBlocks) + (hasPartial ? '▓' : '') + '░'.repeat(emptyBlocks);
  return `${name.padEnd(10)} ${bar}   ${String(value).padStart(2)}`;
}
