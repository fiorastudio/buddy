import { describe, it, expect } from 'vitest';
import { generateName, SPECIES_LIST } from '../lib/species.js';
import { seededIndex } from '../lib/rng.js';

describe('seededIndex', () => {
  it('returns deterministic index for same seed+namespace', () => {
    const a = seededIndex('user1', 'name:first', 10);
    const b = seededIndex('user1', 'name:first', 10);
    expect(a).toBe(b);
  });

  it('returns different index for different seed', () => {
    const a = seededIndex('user1', 'name:first', 100);
    const b = seededIndex('user2', 'name:first', 100);
    expect(a).not.toBe(b);
  });

  it('returns different index for different namespace', () => {
    const a = seededIndex('user1', 'name:first', 100);
    const b = seededIndex('user1', 'name:second', 100);
    expect(a).not.toBe(b);
  });

  it('returns 0 for length <= 0', () => {
    expect(seededIndex('user1', 'ns', 0)).toBe(0);
    expect(seededIndex('user1', 'ns', -5)).toBe(0);
  });

  it('returns index within bounds', () => {
    for (let i = 0; i < 50; i++) {
      const idx = seededIndex(`user-${i}`, 'test', 10);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(10);
    }
  });
});

describe('generateName', () => {
  it('returns deterministic name for same userId + species', () => {
    const a = generateName('Mushroom', 'user-abc');
    const b = generateName('Mushroom', 'user-abc');
    expect(a).toBe(b);
  });

  it('returns different name for different userId', () => {
    const a = generateName('Mushroom', 'user-alpha');
    const b = generateName('Mushroom', 'user-beta');
    // Could collide rarely, but with 100 combos it's unlikely for 2 specific users
    expect(a).not.toBe(b);
  });

  it('different species can produce different names for same user', () => {
    const a = generateName('Void Cat', 'user-test');
    const b = generateName('Robot', 'user-test');
    expect(a).not.toBe(b);
  });

  it('returns non-empty name', () => {
    for (const species of SPECIES_LIST) {
      const name = generateName(species, 'test-user');
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it('returns name within reasonable length (3-16 chars)', () => {
    for (const species of SPECIES_LIST) {
      for (let i = 0; i < 10; i++) {
        const name = generateName(species, `user-${i}`);
        expect(name.length).toBeGreaterThanOrEqual(3);
        expect(name.length).toBeLessThanOrEqual(16);
      }
    }
  });

  it('unknown species uses fallback pools', () => {
    const name = generateName('Unknown Species', 'user-test');
    expect(name.length).toBeGreaterThan(0);
  });

  it('works without userId (random fallback)', () => {
    const name = generateName('Duck');
    expect(name.length).toBeGreaterThan(0);
  });

  it('every species has a name pool', () => {
    for (const species of SPECIES_LIST) {
      const name = generateName(species, 'verify-pool');
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
