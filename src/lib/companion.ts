// src/lib/companion.ts — extracted creation logic (pure functions + DB)

import { db } from '../db/schema.js';
import { roll } from './rng.js';
import { SPECIES_LIST, generateName, renderSprite } from './species.js';
import { generateBio } from './personality.js';
import { sanitizeName } from './sanitize.js';
import { type Companion, RARITY_STARS } from './types.js';
import { levelFromXp } from './leveling.js';
import { deriveSpecies, rollWithCCCompat } from './oldBuddy.js';
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
  // CC-rescued buddies need Bun's wyhash to reproduce original stats.
  // The cc_rescue flag is set during rescueCompanion when importing from CC.
  const bones = row.cc_rescue
    ? rollWithCCCompat(userId).bones
    : roll(userId, SPECIES_LIST).bones;
  const xp = row.xp || 0;
  const derivedLevel = levelFromXp(xp);

  // Stats priority: DB values > bones fallback
  const stats = {
    DEBUGGING: row.stat_debugging ?? bones.stats.DEBUGGING,
    PATIENCE: row.stat_patience ?? bones.stats.PATIENCE,
    CHAOS: row.stat_chaos ?? bones.stats.CHAOS,
    WISDOM: row.stat_wisdom ?? bones.stats.WISDOM,
    SNARK: row.stat_snark ?? bones.stats.SNARK,
  };

  // Self-healing: if DB level drifted from XP-derived level, fix it
  if (row.id && row.level !== derivedLevel) {
    db.prepare('UPDATE companions SET level = ? WHERE id = ?').run(derivedLevel, row.id);
  }

  return {
    ...bones,
    stats,
    species: row.species,
    name: row.name,
    personalityBio: row.personality_bio || '',
    level: derivedLevel,
    xp,
    mood: row.mood,
    availablePoints: row.stat_points_available || 0,
    hatchedAt: new Date(row.created_at).getTime(),
  };
}

/**
 * Write buddy status JSON for the statusline wrapper.
 */
export function writeBuddyStatus(companion: Companion, reaction?: { state: string; text: string; expires: number; eyeOverride?: string; indicator?: string; bubbleLines?: string[]; petActiveUntil?: number }) {
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
      available_points: companion.availablePoints,
      rarity_stars: RARITY_STARS[companion.rarity],
      personality_bio: companion.personalityBio,
      ...(reaction ? {
        reaction: reaction.state,
        reaction_text: reaction.text,
        reaction_expires: reaction.expires,
        reaction_eye: reaction.eyeOverride || '',
        reaction_indicator: reaction.indicator || '',
        ...(reaction.bubbleLines ? { bubble_lines: reaction.bubbleLines } : {}),
        ...(reaction.petActiveUntil ? { pet_active_until: reaction.petActiveUntil } : {}),
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

  const finalName = sanitizeName(opts.name) || generateName(finalSpecies, userId);
  const id = randomUUID();

  // Use finalSpecies for bio (bones.species may differ if user overrode species)
  const bio = generateBio({ ...bones, species: finalSpecies });

  db.prepare(
    `INSERT INTO companions (
      id, name, species, user_id, personality_bio,
      stat_debugging, stat_patience, stat_chaos, stat_wisdom, stat_snark
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, finalName, finalSpecies, userId, bio,
    bones.stats.DEBUGGING, bones.stats.PATIENCE, bones.stats.CHAOS, bones.stats.WISDOM, bones.stats.SNARK
  );

  const companion: Companion = {
    ...bones,
    species: finalSpecies,
    name: finalName,
    personalityBio: bio,
    level: 1,
    xp: 0,
    mood: 'happy',
    availablePoints: 0,
    hatchedAt: Date.now(),
  };

  writeBuddyStatus(companion);

  return { companion, id };
}

/**
 * Rescue an old buddy from imported data (e.g. ~/.claude.json).
 * The importResult should have at least { name }.
 *
 * A "rescue" is a continuation, not a rebirth: if the imported record carries
 * a hand-written personality or an original hatchedAt timestamp, we preserve
 * them so the user doesn't lose the character they've already bonded with.
 */
export function rescueCompanion(importResult: {
  name: string;
  species?: string;
  personality?: string;
  hatchedAt?: number;
  accountUuid?: string;
  userId?: string;
  user_id?: string;
}, opts: { userId?: string } = {}): { companion: Companion; id: string } {
  const userId = opts.userId
    || importResult.accountUuid
    || importResult.userId
    || importResult.user_id
    || `imported-${importResult.name}`;

  const hasCCUserId = !!(
    importResult.accountUuid || importResult.userId || importResult.user_id
  );
  const ccResult = hasCCUserId ? rollWithCCCompat(userId) : null;
  const bones = ccResult ? ccResult.bones : roll(userId, SPECIES_LIST).bones;

  // Resolve species via the shared ladder (explicit → name → personality →
  // accountUuid-derived). bones.species is the last-resort fallback.
  const finalSpecies = deriveSpecies(importResult) ?? bones.species;

  const finalName = sanitizeName(importResult.name) || generateName(finalSpecies, userId);
  const id = randomUUID();

  // Preserve the imported personality if the user had one; otherwise generate fresh.
  const bio = importResult.personality || generateBio({ ...bones, species: finalSpecies });

  // Preserve the imported hatchedAt if present — rescuing is continuation, not rebirth.
  const hatchedAt = importResult.hatchedAt ?? Date.now();

  const ccRescue = hasCCUserId ? 1 : 0;

  if (importResult.hatchedAt !== undefined) {
    // ISO 8601 'Z' round-trips cleanly through loadCompanion's new Date(row.created_at).getTime().
    const createdAt = new Date(importResult.hatchedAt).toISOString();
    db.prepare(
      'INSERT INTO companions (id, name, species, user_id, personality_bio, created_at, cc_rescue) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, finalName, finalSpecies, userId, bio, createdAt, ccRescue);
  } else {
    db.prepare(
      'INSERT INTO companions (id, name, species, user_id, personality_bio, cc_rescue) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, finalName, finalSpecies, userId, bio, ccRescue);
  }

  const companion: Companion = {
    ...bones,
    species: finalSpecies,
    name: finalName,
    personalityBio: bio,
    level: 1,
    xp: 0,
    mood: 'happy',
    availablePoints: 0,
    hatchedAt,
  };

  writeBuddyStatus(companion);

  return { companion, id };
}
