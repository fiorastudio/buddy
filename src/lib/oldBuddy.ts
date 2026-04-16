// src/lib/oldBuddy.ts — pure parser for legacy buddy data from ~/.claude.json,
// plus the species-resolution ladder used when rescuing a buddy with missing fields.
// Kept separate from the I/O-heavy onboarding CLI so it's trivially unit-testable.

import { SPECIES_LIST } from './species.js';
import { seededIndex } from './rng.js';

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

  const buddy = data.buddy || data.companion || data.buddyCompanion;
  if (buddy && buddy.name) {
    return {
      name: buddy.name,
      species: buddy.species,
      personality: buddy.personality,
      hatchedAt: buddy.hatchedAt,
      accountUuid: data.oauthAccount?.accountUuid,
      userId: buddy.userId || buddy.user_id,
    };
  }

  if (data.buddyName) {
    return {
      name: data.buddyName,
      species: data.buddySpecies,
      accountUuid: data.oauthAccount?.accountUuid,
      userId: data.userId || data.user_id,
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
