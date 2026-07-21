// src/lib/oldBuddy.ts — pure parser for legacy buddy data from ~/.claude.json,
// plus the species-resolution ladder used when rescuing a buddy with missing fields.
// Kept separate from the I/O-heavy onboarding CLI so it's trivially unit-testable.

import { SPECIES_LIST } from './species.js';
import { seededIndex } from './rng.js';
import {
  type CompanionBones,
  type Rarity,
  type StatName,
  RARITIES,
  RARITY_WEIGHTS,
  RARITY_FLOOR,
  STAT_NAMES,
} from './types.js';
import { spawnSync } from 'child_process';

// Namespace passed to seededIndex when deriving species from accountUuid.
// Semantic name (not the internal rng SALT) so the two constants don't drift.
const ACCOUNT_UUID_SPECIES_NAMESPACE = 'species:import';

export interface OldBuddy {
  name: string;
  species?: string;
  personality?: string;
  hatchedAt?: number;
  accountUuid?: string;
  userId?: string;
  user_id?: string;
}

/**
 * Extract an OldBuddy record from a parsed ~/.claude.json object.
 * Returns null if no recognizable buddy data is found.
 *
 * Claude Code stored buddy data under a few different shapes over time:
 *   - Nested: data.companion / data.buddy / data.buddyCompanion with { name, species?, personality?, hatchedAt? }
 *   - Flat:   data.buddyName / data.buddySpecies
 * The `accountUuid` is pulled from data.oauthAccount.accountUuid when available,
 * giving us a stable seed to derive missing fields deterministically.
 */
export function parseOldBuddy(data: any): OldBuddy | null {
  if (!data || typeof data !== 'object') return null;

  // Claude Code stored the userID at the top level of .claude.json, not inside
  // the companion sub-object. Check all known locations for a stable userId seed.
  const topLevelUserId = data.userID || data.userId || data.user_id;

  const buddy = data.buddy || data.companion || data.buddyCompanion;
  if (buddy && buddy.name) {
    return {
      name: buddy.name,
      species: buddy.species,
      personality: buddy.personality,
      hatchedAt: buddy.hatchedAt,
      accountUuid: data.oauthAccount?.accountUuid,
      userId: buddy.userId || buddy.user_id || topLevelUserId,
    };
  }

  if (data.buddyName) {
    return {
      name: data.buddyName,
      species: data.buddySpecies,
      accountUuid: data.oauthAccount?.accountUuid,
      userId: data.userId || data.user_id || topLevelUserId,
    };
  }

  return null;
}

// ── Species inference from free-text personality ──────────────────────────

/**
 * Keywords used to infer a species from a free-text personality description.
 * The default bio templates in personality.ts always name the species directly
 * ("void cat", "rust hound", "shell turtle"); when Claude Code wrote a custom
 * bio, the animal noun typically still appears ("turtle" in Fernsquire's bio
 * from issue #60). We match those words with case-insensitive word boundaries,
 * weighting multi-word matches over single-word ones so "shell turtle" beats
 * a lone "turtle" when both appear.
 *
 * Exported for test visibility and so future species additions can't silently
 * miss their keyword list.
 */
export const SPECIES_KEYWORDS: Record<string, string[]> = {
  'Void Cat':     ['void cat', 'cat', 'kitten', 'feline'],
  'Rust Hound':   ['rust hound', 'hound', 'dog', 'puppy', 'canine'],
  'Data Drake':   ['data drake', 'drake', 'dragon'],
  'Log Golem':    ['log golem', 'golem'],
  'Cache Crow':   ['cache crow', 'crow', 'raven'],
  'Shell Turtle': ['shell turtle', 'turtle', 'tortoise'],
  'Duck':         ['duck', 'duckling', 'mallard'],
  'Goose':        ['goose', 'gander'],
  'Blob':         ['blob', 'slime'],
  'Octopus':      ['octopus', 'cephalopod'],
  'Owl':          ['owl', 'owlet'],
  'Penguin':      ['penguin'],
  'Snail':        ['snail', 'mollusk'],
  'Ghost':        ['ghost', 'phantom', 'specter', 'spectre', 'wraith', 'spirit', 'apparition'],
  'Axolotl':      ['axolotl'],
  'Capybara':     ['capybara'],
  'Cactus':       ['cactus', 'cacti', 'succulent'],
  'Robot':        ['robot', 'android'],
  'Rabbit':       ['rabbit', 'bunny', 'hare', 'leveret'],
  'Mushroom':     ['mushroom', 'fungus', 'fungi', 'shroom', 'mycelium', 'mycelial'],
  'Chonk':        ['chonk'],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scan a personality string for species keywords and return the best match.
 * Multi-word keywords (like "shell turtle") outrank single-word ones so the
 * compound species wins when its full name appears in the text. Returns null
 * when no keyword matches.
 */
export function inferSpeciesFromPersonality(text: string | undefined | null): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  let best: { species: string; score: number } | null = null;

  for (const [species, keywords] of Object.entries(SPECIES_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      const pattern = new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'g');
      const matches = lower.match(pattern);
      if (!matches) continue;
      // Multi-word keys ("shell turtle") are ~100x more informative than
      // single-word keys; the 100 factor ensures they dominate even when a
      // bio repeats the generic noun several times.
      score += matches.length * (kw.includes(' ') ? 100 : 1);
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { species, score };
    }
  }

  return best?.species ?? null;
}

/**
 * Resolve a species for a rescued buddy. Tries in order:
 *   1. importResult.species, if it's a canonical SPECIES_LIST entry.
 *   2. importResult.species, loose-matched — the legacy Claude Code config
 *      stored short names like "turtle" or "cat" where the current list has
 *      "Shell Turtle" / "Void Cat". The same keyword scanner we use for
 *      personality inference handles these short names too.
 *   3. Inference from importResult.personality text.
 *   4. Deterministic derivation from importResult.accountUuid.
 * Returns null if none apply — callers are expected to fall back to their
 * own last resort (typically bones.species from a userId-seeded roll).
 *
 * This is the single source of truth for species resolution on the rescue
 * path: both the onboarding CLI (for menu labels) and rescueCompanion (for
 * the actual DB write) call this so they can't disagree.
 */
export function deriveSpecies(importResult: {
  name?: string;
  species?: string;
  personality?: string;
  accountUuid?: string;
}): string | null {
  if (
    importResult.species &&
    (SPECIES_LIST as readonly string[]).includes(importResult.species)
  ) {
    return importResult.species;
  }
  // Loose match for legacy short names. inferSpeciesFromPersonality works on
  // any text via keyword scanning, so passing a bare species token like
  // "turtle" or "Cat" resolves correctly (case-insensitive, word-boundary).
  if (importResult.species) {
    const loose = inferSpeciesFromPersonality(importResult.species);
    if (loose) return loose;
  }
  // Check the companion name for species keywords as substrings (e.g., "Gritblob" → Blob).
  // CC-generated names embed the species as a suffix or substring without word boundaries.
  // Use case-insensitive substring matching, not word-boundary regex.
  if (importResult.name) {
    const nameLower = importResult.name.toLowerCase();
    let bestMatch: { species: string; len: number } | null = null;
    for (const [species, keywords] of Object.entries(SPECIES_KEYWORDS)) {
      for (const kw of keywords) {
        if (nameLower.includes(kw) && (!bestMatch || kw.length > bestMatch.len)) {
          bestMatch = { species, len: kw.length };
        }
      }
    }
    if (bestMatch) return bestMatch.species;
  }
  if (importResult.personality) {
    const inferred = inferSpeciesFromPersonality(importResult.personality);
    if (inferred) return inferred;
  }
  if (importResult.accountUuid) {
    const idx = seededIndex(
      importResult.accountUuid,
      ACCOUNT_UUID_SPECIES_NAMESPACE,
      SPECIES_LIST.length
    );
    return SPECIES_LIST[idx];
  }
  return null;
}

// ── CC-compatible roll ──────────────────────────────────────────────────
// Claude Code's original buddy used different species/eyes lists and ordering.
// To reproduce exact stats for rescued buddies, we replay the CC roll algorithm
// with CC's exact constants. Same Mulberry32 + FNV-1a + salt as our roll(),
// but different pick arrays change the RNG consumption pattern.

// CC's original species list (18 species, different order from ours)
const CC_SPECIES = [
  'duck', 'goose', 'blob', 'cat', 'dragon', 'octopus', 'owl', 'penguin',
  'turtle', 'snail', 'ghost', 'axolotl', 'capybara', 'cactus', 'robot',
  'rabbit', 'mushroom', 'chonk',
] as const;

// CC had ✦ at index 1 where we have '.'
const CC_EYES = ['·', '✦', '×', '◉', '@', '°'] as const;

// CC hats included 'none' in the pick array for non-common
const CC_HATS = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck'] as const;

const CC_SALT = 'friend-2026-401';

function ccMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cache Bun availability so we only check once per process
let bunAvailable: boolean | undefined;

/**
 * Hash matching Claude Code's runtime behavior:
 * - CC runs on Bun → uses Bun.hash() (wyhash), truncated to 32 bits
 * - CC on Node fallback → FNV-1a
 * We shell out to Bun to match the wyhash path. Falls back to FNV-1a if Bun
 * is not installed (stats will differ, but rescue still works).
 */
function ccHashString(s: string): { hash: number; engine: 'bun' | 'fnv1a' } {
  if (bunAvailable === undefined) {
    try {
      const check = spawnSync('bun', ['--version'], { timeout: 5000, stdio: 'pipe' });
      bunAvailable = check.status === 0;
    } catch {
      bunAvailable = false;
    }
  }

  if (bunAvailable) {
    try {
      // Input goes through the environment, not argv and not string
      // interpolation: `bun -e <script> <arg>` does NOT forward trailing
      // arguments — process.argv is ['bun', '<cwd>/[eval]'] and nothing else,
      // so process.argv[1] was a constant. Every userId hashed to the same
      // value, and every rescued companion came out with identical rarity,
      // species, eye and stats. Env keeps the no-interpolation property that
      // made argv attractive in the first place.
      const result = spawnSync('bun', [
        '-e',
        'console.log(Number(BigInt(Bun.hash(process.env.BUDDY_CC_HASH_INPUT ?? "")) & 0xffffffffn))',
      ], {
        timeout: 5000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, BUDDY_CC_HASH_INPUT: s },
      });
      const hash = parseInt((result.stdout || '').trim(), 10);
      if (!isNaN(hash)) return { hash, engine: 'bun' };
    } catch { /* fall through */ }
  }

  // FNV-1a fallback (matches CC's Node.js path)
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return { hash: h >>> 0, engine: 'fnv1a' };
}

function ccPick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function ccRollRarity(rng: () => number): Rarity {
  const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll < 0) return rarity;
  }
  return 'common';
}

function ccRollStats(rng: () => number, rarity: Rarity): Record<StatName, number> {
  const floor = RARITY_FLOOR[rarity];
  const peak = ccPick(rng, STAT_NAMES);
  let dump = ccPick(rng, STAT_NAMES);
  while (dump === peak) dump = ccPick(rng, STAT_NAMES);

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

/**
 * Replay Claude Code's original roll algorithm to get exact stats/rarity/eye
 * for a rescued buddy. Uses CC's species/eyes/hats lists and ordering so the
 * RNG consumption pattern matches exactly.
 *
 * Shells out to Bun for hash (CC runs on Bun → wyhash). Falls back to FNV-1a
 * if Bun is not installed (stats will differ but rescue still works).
 *
 * Returns the CC-derived bones + engine used. Callers should override `species`
 * with `deriveSpecies()` result (mapped to our canonical names) since CC used
 * short names like 'blob' not 'Blob'.
 */
export function rollWithCCCompat(userId: string): { bones: CompanionBones; engine: 'bun' | 'fnv1a' } {
  const key = userId + CC_SALT;
  const { hash, engine } = ccHashString(key);
  const rng = ccMulberry32(hash);

  const rarity = ccRollRarity(rng);
  const ccSpecies = ccPick(rng, CC_SPECIES);
  const ccEye = ccPick(rng, CC_EYES);
  const ccHat = rarity === 'common' ? 'none' : ccPick(rng, CC_HATS);
  const shiny = rng() < 0.01;
  const stats = ccRollStats(rng, rarity);

  // Map CC eye '✦' to our '.' (sparkle eye is reserved in our system)
  const eye = ccEye === '✦' ? '·' : ccEye;

  return {
    bones: {
      rarity,
      species: ccSpecies,  // CC short name — caller maps to canonical
      eye,
      hat: ccHat as any,
      shiny,
      stats,
    },
    engine,
  };
}
