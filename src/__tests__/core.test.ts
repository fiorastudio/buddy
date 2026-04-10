import { describe, it, expect } from 'vitest';
import {
  STAT_NAMES,
  RARITIES,
  EYES,
  HATS,
  RARITY_WEIGHTS,
  getPeakStat,
  getDumpStat,
} from '../lib/types.js';
import { roll, rollWithSeed, statBar } from '../lib/rng.js';
import {
  xpForLevel,
  levelFromXp,
  levelProgress,
  MAX_LEVEL,
} from '../lib/leveling.js';

// ---------------------------------------------------------------------------
// RNG Determinism
// ---------------------------------------------------------------------------

const SPECIES = ['Void Cat', 'Rust Hound', 'Data Drake', 'Log Golem', 'Cache Crow'] as const;

describe('RNG Determinism', () => {
  it('same userId + same species list → same bones every time', () => {
    const a = roll('user-abc', SPECIES);
    const b = roll('user-abc', SPECIES);
    expect(a.bones).toEqual(b.bones);
  });

  it('different userId → different bones (species or stats differ)', () => {
    const a = roll('user-alpha', SPECIES);
    const b = roll('user-beta', SPECIES);
    // At least one property should differ
    const same =
      a.bones.species === b.bones.species &&
      a.bones.rarity === b.bones.rarity &&
      a.bones.eye === b.bones.eye &&
      a.bones.hat === b.bones.hat &&
      a.bones.shiny === b.bones.shiny;
    expect(same).toBe(false);
  });

  it('roll() cache works — same key returns cached value (same object reference)', () => {
    const a = roll('cached-user', SPECIES);
    const b = roll('cached-user', SPECIES);
    // The cache returns the exact same Roll object
    expect(a).toBe(b);
  });

  it('rollStats produces valid stats — all 5 present, values in 0-100 range', () => {
    const { bones } = rollWithSeed('stats-test', SPECIES);
    expect(Object.keys(bones.stats)).toHaveLength(5);
    for (const name of STAT_NAMES) {
      expect(bones.stats[name]).toBeGreaterThanOrEqual(0);
      expect(bones.stats[name]).toBeLessThanOrEqual(100);
    }
  });

  it('peak stat is the highest stat', () => {
    // Test across several seeds to be thorough
    for (let i = 0; i < 10; i++) {
      const { bones } = rollWithSeed(`peak-test-${i}`, SPECIES);
      const peak = getPeakStat(bones.stats);
      const peakValue = bones.stats[peak];
      for (const name of STAT_NAMES) {
        expect(bones.stats[name]).toBeLessThanOrEqual(peakValue);
      }
    }
  });

  it('dump stat is the lowest stat', () => {
    for (let i = 0; i < 10; i++) {
      const { bones } = rollWithSeed(`dump-test-${i}`, SPECIES);
      const dump = getDumpStat(bones.stats);
      const dumpValue = bones.stats[dump];
      for (const name of STAT_NAMES) {
        expect(bones.stats[name]).toBeGreaterThanOrEqual(dumpValue);
      }
    }
  });

  it('rarity weights: common is most frequent over 1000 rolls', () => {
    const counts: Record<string, number> = {
      common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0,
    };
    for (let i = 0; i < 1000; i++) {
      const { bones } = rollWithSeed(`rarity-freq-${i}`, SPECIES);
      counts[bones.rarity]++;
    }
    expect(counts.common).toBeGreaterThan(counts.uncommon);
    expect(counts.uncommon).toBeGreaterThan(counts.rare);
    expect(counts.rare).toBeGreaterThan(counts.epic);
    expect(counts.epic).toBeGreaterThan(counts.legendary);
  });

  it('shiny chance is ~1% over 1000 rolls (between 0.3% and 3%)', () => {
    let shinyCount = 0;
    for (let i = 0; i < 1000; i++) {
      const { bones } = rollWithSeed(`shiny-test-${i}`, SPECIES);
      if (bones.shiny) shinyCount++;
    }
    expect(shinyCount).toBeGreaterThan(3);   // >0.3%
    expect(shinyCount).toBeLessThan(30);     // <3%
  });

  it('non-common rarities always get a hat (hat !== "none")', () => {
    const nonCommonRarities = ['uncommon', 'rare', 'epic', 'legendary'] as const;
    // Generate enough rolls to encounter each rarity
    let checked = 0;
    for (let i = 0; i < 5000; i++) {
      const { bones } = rollWithSeed(`hat-test-${i}`, SPECIES);
      if (nonCommonRarities.includes(bones.rarity as any)) {
        expect(bones.hat).not.toBe('none');
        checked++;
        if (checked >= 50) break; // Enough samples
      }
    }
  });

  it('common rarity always gets hat === "none"', () => {
    let checked = 0;
    for (let i = 0; i < 5000; i++) {
      const { bones } = rollWithSeed(`common-hat-${i}`, SPECIES);
      if (bones.rarity === 'common') {
        expect(bones.hat).toBe('none');
        checked++;
        if (checked >= 50) break;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Stat Bar
// ---------------------------------------------------------------------------

describe('Stat Bar', () => {
  it('statBar(name, 0) → all empty (no filled blocks)', () => {
    const bar = statBar('DEBUGGING', 0);
    expect(bar).toContain('░░░░░░░░');
    expect(bar).not.toContain('█');
    expect(bar).not.toContain('▓');
  });

  it('statBar(name, 100) → all full (8 full blocks)', () => {
    const bar = statBar('DEBUGGING', 100);
    expect(bar).toContain('████████');
    expect(bar).not.toContain('░');
    expect(bar).not.toContain('▓');
  });

  it('statBar(name, 50) → half filled (4 full blocks)', () => {
    const bar = statBar('DEBUGGING', 50);
    // 50% of 8 = 4 full blocks, 4 empty
    expect(bar).toContain('████░░░░');
  });

  it('statBar has ▓ partial fill for fractional values (e.g. 36 → ██▓░░░░░)', () => {
    // 36/100 * 8 = 2.88 → 2 full + partial + 5 empty
    const bar = statBar('DEBUGGING', 36);
    expect(bar).toContain('██▓░░░░░');
  });

  it('bar segment is exactly 8 chars wide', () => {
    for (const value of [0, 1, 25, 36, 50, 75, 99, 100]) {
      const bar = statBar('TEST', value);
      // Count all block characters in the full output — always 8 total
      const blockChars = (bar.match(/[█▓░]/g) ?? []).length;
      expect(blockChars).toBe(8);
    }
  });

  it('value is right-aligned (padded to 2 digits)', () => {
    const bar1 = statBar('SNARK', 5);
    const bar9 = statBar('SNARK', 99);
    const bar100 = statBar('SNARK', 100);
    // Single digit values should be padded
    expect(bar1).toContain(' 5');
    expect(bar9).toContain('99');
    expect(bar100).toContain('100');
  });
});

// ---------------------------------------------------------------------------
// Leveling
// ---------------------------------------------------------------------------

describe('Leveling', () => {
  it('xpForLevel(1) → 0', () => {
    expect(xpForLevel(1)).toBe(0);
  });

  it('xpForLevel(2) → 45', () => {
    // floor(10 * 2^2.2) = floor(10 * 4.5948...) = floor(45.948) = 45
    expect(xpForLevel(2)).toBe(45);
  });

  it('xpForLevel(50) → large number', () => {
    expect(xpForLevel(50)).toBeGreaterThan(10000);
  });

  it('levelFromXp(0) → 1', () => {
    expect(levelFromXp(0)).toBe(1);
  });

  it('levelFromXp(45) → 2', () => {
    expect(levelFromXp(45)).toBe(2);
  });

  it('levelFromXp(44) → 1 (not enough for level 2)', () => {
    expect(levelFromXp(44)).toBe(1);
  });

  it('levelFromXp(999999) → 50 (capped at MAX_LEVEL)', () => {
    expect(levelFromXp(999999)).toBe(50);
    expect(levelFromXp(999999)).toBe(MAX_LEVEL);
  });

  it('levelProgress returns correct currentXp and neededXp', () => {
    // At exactly 45 XP we are level 2, currentXp = 0 within that level
    const progress = levelProgress(45);
    expect(progress.level).toBe(2);
    expect(progress.currentXp).toBe(0);
    expect(progress.neededXp).toBe(xpForLevel(3));

    // At 45 + 10 XP within level 2
    const progress2 = levelProgress(55);
    expect(progress2.level).toBe(2);
    expect(progress2.currentXp).toBe(10);
  });

  it('exponential curve: each level requires more XP than the previous', () => {
    for (let lvl = 2; lvl < MAX_LEVEL; lvl++) {
      expect(xpForLevel(lvl + 1)).toBeGreaterThan(xpForLevel(lvl));
    }
  });
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

describe('Types', () => {
  it('STAT_NAMES has exactly 5 entries', () => {
    expect(STAT_NAMES).toHaveLength(5);
  });

  it('RARITIES has exactly 5 entries', () => {
    expect(RARITIES).toHaveLength(5);
  });

  it('EYES has exactly 6 entries (no ✦)', () => {
    expect(EYES).toHaveLength(6);
    expect(EYES).not.toContain('✦');
  });

  it('HATS has exactly 8 entries', () => {
    expect(HATS).toHaveLength(8);
  });

  it('getPeakStat returns the stat with the highest value', () => {
    const stats = {
      DEBUGGING: 10,
      PATIENCE: 20,
      CHAOS: 80,
      WISDOM: 50,
      SNARK: 30,
    };
    expect(getPeakStat(stats)).toBe('CHAOS');
  });

  it('getDumpStat returns the stat with the lowest value', () => {
    const stats = {
      DEBUGGING: 10,
      PATIENCE: 20,
      CHAOS: 80,
      WISDOM: 50,
      SNARK: 30,
    };
    expect(getDumpStat(stats)).toBe('DEBUGGING');
  });

  it('RARITY_WEIGHTS sum to 100', () => {
    const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });
});
