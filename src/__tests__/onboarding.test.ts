import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { importOldBuddy } from '../lib/import.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// importOldBuddy
// ---------------------------------------------------------------------------

describe('importOldBuddy', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `buddy-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  it('returns { found: false } when no file exists', () => {
    const result = importOldBuddy(join(tempDir, 'nonexistent.json'));
    expect(result).toEqual({ found: false });
  });

  it('returns parsed buddy info with valid data', () => {
    const filePath = join(tempDir, 'claude.json');
    writeFileSync(filePath, JSON.stringify({
      companion: {
        name: 'Gritblob',
        personality: 'A patient troubleshooter who gets weirdly protective of debugging sessions.',
        hatchedAt: 1775047109797,
      },
      companionMuted: false,
    }));

    const result = importOldBuddy(filePath);
    expect(result.found).toBe(true);
    expect(result.name).toBe('Gritblob');
    expect(result.bio).toBe('A patient troubleshooter who gets weirdly protective of debugging sessions.');
    expect(result.species).toBeUndefined(); // Old format doesn't store species
  });

  it('returns { found: false } with invalid JSON', () => {
    const filePath = join(tempDir, 'bad.json');
    writeFileSync(filePath, 'this is not json {{{{');

    const result = importOldBuddy(filePath);
    expect(result).toEqual({ found: false });
  });

  it('returns { found: false } when companion field is missing', () => {
    const filePath = join(tempDir, 'empty.json');
    writeFileSync(filePath, JSON.stringify({
      someOtherField: 'hello',
      companionMuted: false,
    }));

    const result = importOldBuddy(filePath);
    expect(result).toEqual({ found: false });
  });

  it('returns { found: false } when companion has no name', () => {
    const filePath = join(tempDir, 'noname.json');
    writeFileSync(filePath, JSON.stringify({
      companion: {
        personality: 'Some personality text',
        hatchedAt: 12345,
      },
    }));

    const result = importOldBuddy(filePath);
    expect(result).toEqual({ found: false });
  });

  it('returns { found: false } when companion name is empty string', () => {
    const filePath = join(tempDir, 'blank.json');
    writeFileSync(filePath, JSON.stringify({
      companion: {
        name: '   ',
        personality: 'Some personality text',
      },
    }));

    const result = importOldBuddy(filePath);
    expect(result).toEqual({ found: false });
  });

  it('handles companion data with species field', () => {
    const filePath = join(tempDir, 'with-species.json');
    writeFileSync(filePath, JSON.stringify({
      companion: {
        name: 'Sparkles',
        species: 'Mushroom',
        personality: 'A fungi friend.',
      },
    }));

    const result = importOldBuddy(filePath);
    expect(result.found).toBe(true);
    expect(result.name).toBe('Sparkles');
    expect(result.species).toBe('Mushroom');
    expect(result.bio).toBe('A fungi friend.');
  });

  it('ignores unrecognized species', () => {
    const filePath = join(tempDir, 'bad-species.json');
    writeFileSync(filePath, JSON.stringify({
      companion: {
        name: 'Blobber',
        species: 'NonexistentCreature',
        personality: 'A weird one.',
      },
    }));

    const result = importOldBuddy(filePath);
    expect(result.found).toBe(true);
    expect(result.name).toBe('Blobber');
    expect(result.species).toBeUndefined(); // Unrecognized species ignored
    expect(result.bio).toBe('A weird one.');
  });

  it('handles name with only personality (no bio)', () => {
    const filePath = join(tempDir, 'name-only.json');
    writeFileSync(filePath, JSON.stringify({
      companion: {
        name: 'Nibbles',
      },
    }));

    const result = importOldBuddy(filePath);
    expect(result.found).toBe(true);
    expect(result.name).toBe('Nibbles');
    expect(result.bio).toBeUndefined();
    expect(result.species).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buddy_onboard "hatch" path (integration-style via DB)
// ---------------------------------------------------------------------------

describe('buddy_onboard hatch path', () => {
  // We test that the DB schema supports the imported column
  // and that the basic roll + insert works for the hatch path
  it('roll + species list produces valid companion bones', async () => {
    const { roll } = await import('../lib/rng.js');
    const { SPECIES_LIST } = await import('../lib/species.js');

    const userId = 'test-onboard-hatch-' + randomUUID();
    const { bones } = roll(userId, SPECIES_LIST);

    expect(bones).toBeDefined();
    expect(bones.species).toBeDefined();
    expect(SPECIES_LIST).toContain(bones.species);
    expect(bones.rarity).toBeDefined();
    expect(bones.stats).toBeDefined();
    expect(Object.keys(bones.stats)).toHaveLength(5);
  });

  it('generateBio works with rolled bones', async () => {
    const { roll } = await import('../lib/rng.js');
    const { SPECIES_LIST } = await import('../lib/species.js');
    const { generateBio } = await import('../lib/personality.js');

    const userId = 'test-onboard-bio-' + randomUUID();
    const { bones } = roll(userId, SPECIES_LIST);
    const bio = generateBio(bones);

    expect(typeof bio).toBe('string');
    expect(bio.length).toBeGreaterThan(10);
  });
});
