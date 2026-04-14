// src/lib/companion.ts — extracted creation logic (pure functions + DB)

import { db } from '../db/schema.js';
import { roll } from './rng.js';
import { SPECIES_LIST, generateName, renderSprite } from './species.js';
import { generateBio } from './personality.js';
import { sanitizeName } from './sanitize.js';
import { type Companion, RARITY_STARS } from './types.js';
import { levelFromXp } from './leveling.js';
import { randomUUID } from 'crypto';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { BUDDY_STATUS_PATH } from './constants.js';
let statusDirEnsured = false;

/**
 * Check if a companion already exists in the DB.
 * Returns the row if found, null otherwise.
 */
export function companionExists(): any | null {
  return db.prepare('SELECT * FROM companions LIMIT 1').get() || null;
}

/**
 * Load a Companion from a DB row + deterministic bones.
 * Note: when species was overridden at hatch time, bones (rarity, stats, eye, hat)
 * still come from the deterministic roll. Only species name comes from DB.
 * This is intentional -- bones are tied to the userId hash, not the species.
 */
export function loadCompanion(row: any, userIdOverride?: string): Companion | null {
  if (!row) return null;
  const userId = userIdOverride || row.user_id || 'anon';
  const { bones } = roll(userId, SPECIES_LIST);
  const xp = row.xp || 0;
  const derivedLevel = levelFromXp(xp);

  // Self-healing: if DB level drifted from XP-derived level, fix it
  if (row.id && row.level !== derivedLevel) {
    db.prepare('UPDATE companions SET level = ? WHERE id = ?').run(derivedLevel, row.id);
  }

  return {
    ...bones,
    species: row.species,
    name: row.name,
    personalityBio: row.personality_bio || '',
    level: derivedLevel,
    xp,
    mood: row.mood,
    hatchedAt: new Date(row.created_at).getTime(),
  };
}

/**
 * Write buddy status JSON for the statusline wrapper.
 */
export function writeBuddyStatus(companion: Companion, reaction?: { state: string; text: string; expires: number; eyeOverride?: string; indicator?: string; bubbleLines?: string[] }) {
  try {
    if (!statusDirEnsured) {
      mkdirSync(dirname(BUDDY_STATUS_PATH), { recursive: true });
      statusDirEnsured = true;
    }
    writeFileSync(BUDDY_STATUS_PATH, JSON.stringify({
      name: companion.name,
      species: companion.species,
      level: companion.level,
      xp: companion.xp,
      mood: companion.mood,
      rarity: companion.rarity,
      is_shiny: companion.shiny,
      eye: companion.eye,
      hat: companion.hat,
      stats: companion.stats,
      rarity_stars: RARITY_STARS[companion.rarity],
      personality_bio: companion.personalityBio,
      ...(reaction ? {
        reaction: reaction.state,
        reaction_text: reaction.text,
        reaction_expires: reaction.expires,
        reaction_eye: reaction.eyeOverride || '',
        reaction_indicator: reaction.indicator || '',
        ...(reaction.bubbleLines ? { bubble_lines: reaction.bubbleLines } : {}),
      } : {}),
    }));
  } catch { /* non-fatal */ }
}

/**
 * Create a new companion from scratch.
 */
export function createCompanion(opts: {
  userId?: string;
  name?: string;
  species?: string;
} = {}): { companion: Companion; id: string } {
  const userId = opts.userId || 'anon-' + randomUUID();
  const { bones } = roll(userId, SPECIES_LIST);

  const finalSpecies = opts.species && SPECIES_LIST.includes(opts.species as any)
    ? opts.species
    : bones.species;

  const finalName = sanitizeName(opts.name) || generateName(finalSpecies);
  const id = randomUUID();

  // Use finalSpecies for bio (bones.species may differ if user overrode species)
  const bio = generateBio({ ...bones, species: finalSpecies });

  db.prepare(
    'INSERT INTO companions (id, name, species, user_id, personality_bio) VALUES (?, ?, ?, ?, ?)'
  ).run(id, finalName, finalSpecies, userId, bio);

  const companion: Companion = {
    ...bones,
    species: finalSpecies,
    name: finalName,
    personalityBio: bio,
    level: 1,
    xp: 0,
    mood: 'happy',
    hatchedAt: Date.now(),
  };

  writeBuddyStatus(companion);

  return { companion, id };
}

/**
 * Rescue an old buddy from imported data (e.g. ~/.claude.json).
 * The importResult should have at least { name, species }.
 */
export function rescueCompanion(importResult: {
  name: string;
  species: string;
  userId?: string;
  user_id?: string;
}, opts: { userId?: string } = {}): { companion: Companion; id: string } {
  const userId = opts.userId
    || importResult.userId
    || importResult.user_id
    || `imported-${importResult.name}`;

  const { bones } = roll(userId, SPECIES_LIST);

  const finalSpecies = SPECIES_LIST.includes(importResult.species as any)
    ? importResult.species
    : bones.species;

  const finalName = sanitizeName(importResult.name) || generateName(finalSpecies);
  const id = randomUUID();

  const bio = generateBio({ ...bones, species: finalSpecies });

  db.prepare(
    'INSERT INTO companions (id, name, species, user_id, personality_bio) VALUES (?, ?, ?, ?, ?)'
  ).run(id, finalName, finalSpecies, userId, bio);

  const companion: Companion = {
    ...bones,
    species: finalSpecies,
    name: finalName,
    personalityBio: bio,
    level: 1,
    xp: 0,
    mood: 'happy',
    hatchedAt: Date.now(),
  };

  writeBuddyStatus(companion);

  return { companion, id };
}
