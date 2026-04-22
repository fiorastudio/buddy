import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, db } from '../db/schema.js';
import {
  companionExists,
  createCompanion,
  rescueCompanion,
  loadCompanion,
} from '../lib/companion.js';
import { SPECIES_LIST } from '../lib/species.js';

// Initialize a fresh DB before each test
beforeEach(() => {
  initDb();
  // Clear child tables first (FK constraints), then companions
  db.prepare('DELETE FROM xp_events').run();
  db.prepare('DELETE FROM memories').run();
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM evolution_history').run();
  db.prepare('DELETE FROM companions').run();
});

describe('companionExists', () => {
  it('returns null when no companion exists', () => {
    expect(companionExists()).toBeNull();
  });

  it('returns a row when a companion exists', () => {
    createCompanion({ userId: 'test-user-1' });
    const row = companionExists();
    expect(row).not.toBeNull();
    expect(row.name).toBeTruthy();
    expect(row.species).toBeTruthy();
  });
});

describe('createCompanion', () => {
  it('creates a companion with default params', () => {
    const { companion, id } = createCompanion();
    expect(id).toBeTruthy();
    expect(companion.name).toBeTruthy();
    expect(companion.species).toBeTruthy();
    expect(companion.level).toBe(1);
    expect(companion.xp).toBe(0);
    expect(companion.mood).toBe('happy');
    expect(companion.personalityBio).toBeTruthy();
  });

  it('creates a companion with a specific name', () => {
    const { companion } = createCompanion({ name: 'TestBuddy' });
    expect(companion.name).toBe('TestBuddy');
  });

  it('creates a companion with a specific species', () => {
    const { companion } = createCompanion({ species: 'Mushroom' });
    expect(companion.species).toBe('Mushroom');
  });

  it('falls back to rolled species if invalid species given', () => {
    const { companion } = createCompanion({ species: 'InvalidSpecies', userId: 'species-test' });
    expect(SPECIES_LIST).toContain(companion.species);
    expect(companion.species).not.toBe('InvalidSpecies');
  });

  it('creates a companion with a specific userId for deterministic bones', () => {
    const { companion: c1 } = createCompanion({ userId: 'deterministic-test' });
    // Clean up for second creation
    db.prepare('DELETE FROM companions').run();
    const { companion: c2 } = createCompanion({ userId: 'deterministic-test' });
    // Same userId produces same bones (rarity, eye, stats)
    expect(c1.rarity).toBe(c2.rarity);
    expect(c1.eye).toBe(c2.eye);
    expect(c1.stats).toEqual(c2.stats);
  });

  it('sanitizes the name', () => {
    const { companion } = createCompanion({ name: '  Test${name}  ' });
    expect(companion.name).toBe('Testname');
  });

  it('persists to database', () => {
    createCompanion({ userId: 'persist-test', name: 'Persisto' });
    const row = db.prepare('SELECT * FROM companions LIMIT 1').get() as any;
    expect(row).toBeTruthy();
    expect(row.name).toBe('Persisto');
  });
});

describe('rescueCompanion', () => {
  it('rescues a companion with name and species', () => {
    const { companion, id } = rescueCompanion({
      name: 'Nuzzlecap',
      species: 'Mushroom',
    });
    expect(id).toBeTruthy();
    expect(companion.name).toBe('Nuzzlecap');
    expect(companion.species).toBe('Mushroom');
    expect(companion.level).toBe(1);
    expect(companion.xp).toBe(0);
  });

  it('uses imported userId for deterministic bones', () => {
    const { companion: c1 } = rescueCompanion({
      name: 'Rex',
      species: 'Rust Hound',
      userId: 'rescue-uid-test',
    });
    db.prepare('DELETE FROM companions').run();
    const { companion: c2 } = rescueCompanion({
      name: 'Rex',
      species: 'Rust Hound',
      userId: 'rescue-uid-test',
    });
    expect(c1.rarity).toBe(c2.rarity);
    expect(c1.eye).toBe(c2.eye);
    expect(c1.stats).toEqual(c2.stats);
  });

  it('falls back to stable userId when none provided', () => {
    const { companion } = rescueCompanion({
      name: 'Ghosty',
      species: 'Ghost',
    });
    // Should still work
    expect(companion.name).toBe('Ghosty');
    expect(companion.species).toBe('Ghost');

    // Verify the DB row has the fallback userId
    const row = db.prepare('SELECT user_id FROM companions LIMIT 1').get() as any;
    expect(row.user_id).toBe('imported-Ghosty');
  });

  it('falls back to rolled species if invalid species given', () => {
    const { companion } = rescueCompanion({
      name: 'Test',
      species: 'NotASpecies',
    });
    expect(SPECIES_LIST).toContain(companion.species);
  });

  it('persists to database', () => {
    rescueCompanion({ name: 'SavedBuddy', species: 'Owl' });
    const row = db.prepare('SELECT * FROM companions LIMIT 1').get() as any;
    expect(row).toBeTruthy();
    expect(row.name).toBe('SavedBuddy');
    expect(row.species).toBe('Owl');
  });

  it('preserves imported personality when provided (issue #60 — Fernsquire)', () => {
    const personality =
      'A philosophically unflappable turtle who responds to your bugs with measured skepticism...';
    const { companion } = rescueCompanion({
      name: 'Fernsquire',
      species: 'Shell Turtle',
      personality,
    });
    expect(companion.personalityBio).toBe(personality);
    const row = db.prepare('SELECT personality_bio FROM companions LIMIT 1').get() as any;
    expect(row.personality_bio).toBe(personality);
  });

  it('generates a fresh bio when no personality is imported', () => {
    const { companion } = rescueCompanion({ name: 'NoBio', species: 'Owl' });
    expect(companion.personalityBio).toBeTruthy();
    expect(companion.personalityBio.length).toBeGreaterThan(0);
  });

  it('preserves imported hatchedAt (issue #60 — original hatch date survives rescue)', () => {
    const originalHatchedAt = 1775074927992; // from issue #60 sample
    const { companion, id } = rescueCompanion({
      name: 'Fernsquire',
      species: 'Shell Turtle',
      hatchedAt: originalHatchedAt,
    });
    expect(companion.hatchedAt).toBe(originalHatchedAt);
    // Round-trips cleanly through loadCompanion via ISO 8601 serialization.
    const row = db.prepare('SELECT * FROM companions WHERE id = ?').get(id) as any;
    const reloaded = loadCompanion(row);
    expect(reloaded!.hatchedAt).toBe(originalHatchedAt);
  });

  it('defaults hatchedAt to now when not imported', () => {
    const before = Date.now();
    const { companion } = rescueCompanion({ name: 'Fresh', species: 'Duck' });
    const after = Date.now();
    expect(companion.hatchedAt).toBeGreaterThanOrEqual(before);
    expect(companion.hatchedAt).toBeLessThanOrEqual(after);
  });

  it('uses accountUuid as userId fallback when no explicit userId is provided', () => {
    rescueCompanion({
      name: 'UuidBuddy',
      species: 'Ghost',
      accountUuid: 'user-uuid-abc-123',
    });
    const row = db.prepare('SELECT user_id FROM companions LIMIT 1').get() as any;
    expect(row.user_id).toBe('user-uuid-abc-123');
  });

  it('prefers explicit opts.userId over accountUuid', () => {
    rescueCompanion(
      { name: 'Override', species: 'Ghost', accountUuid: 'uuid-lose' },
      { userId: 'override-win' }
    );
    const row = db.prepare('SELECT user_id FROM companions LIMIT 1').get() as any;
    expect(row.user_id).toBe('override-win');
  });

  it('prefers accountUuid over importResult.userId when both are present', () => {
    rescueCompanion({
      name: 'Dual',
      species: 'Axolotl',
      accountUuid: 'account-wins',
      userId: 'userid-loses',
    });
    const row = db.prepare('SELECT user_id FROM companions LIMIT 1').get() as any;
    expect(row.user_id).toBe('account-wins');
  });

  it('sets cc_rescue when only accountUuid is present', () => {
    rescueCompanion({
      name: 'UuidOnly',
      species: 'Ghost',
      accountUuid: 'uuid-cc-origin',
    });
    const row = db.prepare('SELECT cc_rescue FROM companions LIMIT 1').get() as any;
    expect(row.cc_rescue).toBe(1);
  });

  it('rescues a buddy with no species (rolls one from bones)', () => {
    const { companion } = rescueCompanion({ name: 'Speciesless' });
    expect(SPECIES_LIST).toContain(companion.species);
  });

  it('produces deterministic species across rescues for the same accountUuid', () => {
    const { companion: c1 } = rescueCompanion({
      name: 'Det1',
      accountUuid: 'same-uuid',
    });
    db.prepare('DELETE FROM companions').run();
    const { companion: c2 } = rescueCompanion({
      name: 'Det1',
      accountUuid: 'same-uuid',
    });
    expect(c1.species).toBe(c2.species);
    expect(c1.rarity).toBe(c2.rarity);
    expect(c1.stats).toEqual(c2.stats);
  });

  it('normalizes legacy short species names ("turtle" → "Shell Turtle")', () => {
    // The legacy Claude Code config stored bare animal nouns. If a user has
    // that in ~/.claude.json, the rescue path should write the canonical name
    // to the DB rather than the short form.
    const { companion } = rescueCompanion({
      name: 'Fern',
      species: 'turtle',
      accountUuid: 'legacy-short-uuid',
    });
    expect(companion.species).toBe('Shell Turtle');
    const row = db.prepare('SELECT species FROM companions LIMIT 1').get() as any;
    expect(row.species).toBe('Shell Turtle');
  });

  it('infers species from personality when none is given (Fernsquire → Shell Turtle)', () => {
    // End-to-end: this is exactly the shape Josh (issue #60) has in ~/.claude.json.
    const { companion } = rescueCompanion({
      name: 'Fernsquire',
      personality:
        'A philosophically unflappable turtle who responds to your bugs with measured skepticism and the occasional cutting remark about your variable names, as if waiting 80 years to hatch has given them an exceptionally low tolerance for sloppy thinking.',
      hatchedAt: 1775074927992,
      accountUuid: 'josh-account-uuid',
    });
    expect(companion.species).toBe('Shell Turtle');
    expect(companion.name).toBe('Fernsquire');
    expect(companion.hatchedAt).toBe(1775074927992);
    expect(companion.personalityBio).toMatch(/turtle/i);
  });
});

describe('loadCompanion', () => {
  it('returns null for null row', () => {
    expect(loadCompanion(null)).toBeNull();
  });

  it('loads a companion from a DB row', () => {
    const { id } = createCompanion({ userId: 'load-test', name: 'Loader' });
    const row = db.prepare('SELECT * FROM companions WHERE id = ?').get(id) as any;
    const companion = loadCompanion(row);
    expect(companion).not.toBeNull();
    expect(companion!.name).toBe('Loader');
    expect(companion!.level).toBe(1);
    expect(companion!.xp).toBe(0);
  });

  it('self-heals level if DB level drifts', () => {
    const { id } = createCompanion({ userId: 'heal-test', name: 'Healer' });
    // Manually drift the level
    db.prepare('UPDATE companions SET level = 99 WHERE id = ?').run(id);
    const row = db.prepare('SELECT * FROM companions WHERE id = ?').get(id) as any;
    expect(row.level).toBe(99);

    const companion = loadCompanion(row);
    expect(companion!.level).toBe(1); // Should be corrected back

    // Verify DB was also fixed
    const fixedRow = db.prepare('SELECT level FROM companions WHERE id = ?').get(id) as any;
    expect(fixedRow.level).toBe(1);
  });
});
