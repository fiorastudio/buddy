// src/lib/import.ts — Import old buddy data from Claude Code's ~/.claude.json

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { SPECIES_LIST } from './species.js';

export type ImportResult = {
  found: boolean;
  name?: string;
  species?: string;
  bio?: string;
  userId?: string;
};

/**
 * Attempt to read old Claude Code companion data from ~/.claude.json (primary)
 * or ~/.claude/claude.json (fallback).
 *
 * The old CC format stores companion data at the top level:
 * {
 *   "companion": {
 *     "name": "Gritblob",
 *     "personality": "A patient troubleshooter who...",
 *     "hatchedAt": 1775047109797
 *   },
 *   "companionMuted": false
 * }
 *
 * The old format did NOT store species, so we can only recover name + personality.
 */
export function importOldBuddy(overridePath?: string): ImportResult {
  const paths = overridePath
    ? [overridePath]
    : [
        join(homedir(), '.claude.json'),
        join(homedir(), '.claude', 'claude.json'),
      ];

  for (const filePath of paths) {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);

      // The old CC format nests under "companion"
      const companion = data?.companion;
      if (!companion || typeof companion !== 'object') continue;

      const name = typeof companion.name === 'string' && companion.name.trim()
        ? companion.name.trim()
        : undefined;

      if (!name) continue; // No name means no real buddy data

      // Old format stored "personality" as a free-text bio string
      const bio = typeof companion.personality === 'string' && companion.personality.trim()
        ? companion.personality.trim()
        : undefined;

      // Old format did not store species — check if it happens to be there
      let species: string | undefined;
      if (typeof companion.species === 'string') {
        const match = SPECIES_LIST.find(
          s => s.toLowerCase() === companion.species.toLowerCase()
        );
        if (match) species = match;
      }

      // Extract userID — the account UUID that CC used for deterministic generation.
      // With this, roll(userId) reproduces the exact same species, stats, eye, hat, rarity.
      const userId = typeof data.userID === 'string' && data.userID.trim()
        ? data.userID.trim()
        : undefined;

      return { found: true, name, species, bio, userId };
    } catch {
      // File not found, invalid JSON, etc. — try next path
      continue;
    }
  }

  return { found: false };
}
