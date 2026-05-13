import { describe, it, expect } from 'vitest';
import type { RGB, TerminalCapabilities } from '../lib/color.js';
import { NEUTRAL_GRAY } from '../lib/color.js';
import { SPECIES_PALETTES, FALLBACK_SPECIES_PALETTE } from '../lib/color.js';
import { RARITY_METALS, RARITY_SATURATION } from '../lib/color.js';
import { clamp, lerpRGB } from '../lib/color.js';
import { rampPosition } from '../lib/color.js';
import { interpolateAnchors } from '../lib/color.js';
import { applySaturationTint } from '../lib/color.js';
import { SPECIES_LIST } from '../lib/species.js';
import { RARITIES } from '../lib/types.js';
import { totalXpForLevel } from '../lib/leveling.js';

describe('color module — types and constants', () => {
  it('exports NEUTRAL_GRAY as RGB [128, 128, 128]', () => {
    expect(NEUTRAL_GRAY).toEqual([128, 128, 128]);
  });

  it('RGB type accepts a 3-tuple of numbers', () => {
    const sample: RGB = [10, 20, 30];
    expect(sample).toHaveLength(3);
  });

  it('TerminalCapabilities type has the four boolean flags', () => {
    const caps: TerminalCapabilities = {
      truecolor: true,
      ansi256: false,
      ansi16: false,
      noColor: false,
    };
    expect(caps.truecolor).toBe(true);
  });
});

describe('SPECIES_PALETTES', () => {
  it('has an entry for every species in SPECIES_LIST', () => {
    for (const species of SPECIES_LIST) {
      expect(SPECIES_PALETTES[species], `missing palette for ${species}`).toBeDefined();
    }
  });

  it('has 21 entries total', () => {
    expect(Object.keys(SPECIES_PALETTES)).toHaveLength(21);
  });

  it('every palette has exactly 4 RGB anchors with values in [0, 255]', () => {
    for (const [species, anchors] of Object.entries(SPECIES_PALETTES)) {
      expect(anchors, `${species} should have 4 anchors`).toHaveLength(4);
      for (const [r, g, b] of anchors) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(255);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(255);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(255);
      }
    }
  });

  it('FALLBACK_SPECIES_PALETTE has 4 RGB anchors', () => {
    expect(FALLBACK_SPECIES_PALETTE).toHaveLength(4);
  });
});

describe('RARITY_METALS and RARITY_SATURATION', () => {
  it('RARITY_METALS has an entry for every rarity', () => {
    for (const rarity of RARITIES) {
      expect(RARITY_METALS[rarity], `missing metals for ${rarity}`).toBeDefined();
    }
  });

  it('every rarity has exactly 2 metal anchors', () => {
    for (const rarity of RARITIES) {
      expect(RARITY_METALS[rarity]).toHaveLength(2);
    }
  });

  it('RARITY_SATURATION values match the spec table', () => {
    expect(RARITY_SATURATION.common).toBe(0.85);
    expect(RARITY_SATURATION.uncommon).toBe(1.00);
    expect(RARITY_SATURATION.rare).toBe(1.05);
    expect(RARITY_SATURATION.epic).toBe(1.12);
    expect(RARITY_SATURATION.legendary).toBe(1.20);
  });
});

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });
  it('returns min when below', () => {
    expect(clamp(-10, 0, 100)).toBe(0);
  });
  it('returns max when above', () => {
    expect(clamp(200, 0, 100)).toBe(100);
  });
});

describe('lerpRGB', () => {
  it('returns a at t=0', () => {
    expect(lerpRGB([10, 20, 30], [100, 200, 250], 0)).toEqual([10, 20, 30]);
  });
  it('returns b at t=1', () => {
    expect(lerpRGB([10, 20, 30], [100, 200, 250], 1)).toEqual([100, 200, 250]);
  });
  it('returns midpoint at t=0.5', () => {
    expect(lerpRGB([0, 0, 0], [200, 200, 200], 0.5)).toEqual([100, 100, 100]);
  });
  it('rounds to integer channels', () => {
    const result = lerpRGB([0, 0, 0], [3, 3, 3], 0.5);
    expect(result[0]).toBe(2); // 1.5 rounds to 2
    expect(Number.isInteger(result[0])).toBe(true);
  });
});

describe('rampPosition', () => {
  it('returns 0 at totalXp=0 (Lv 1, no progress)', () => {
    expect(rampPosition(0)).toBe(0);
  });

  it('returns 1.0 at total XP for Lv 50', () => {
    expect(rampPosition(totalXpForLevel(50))).toBe(1.0);
  });

  it('returns 1.0 for XP beyond max level', () => {
    expect(rampPosition(totalXpForLevel(50) + 10000)).toBe(1.0);
  });

  it('returns ~0.6 at Lv 30 with zero progress (species → metal bridge entry)', () => {
    const result = rampPosition(totalXpForLevel(30));
    // (30 - 1 + 0) / 49 = 0.5918...
    expect(result).toBeCloseTo(29 / 49, 3);
  });

  it('is monotonically increasing across the level range', () => {
    let prev = -1;
    for (let lvl = 1; lvl <= 50; lvl++) {
      const p = rampPosition(totalXpForLevel(lvl));
      expect(p, `p at Lv ${lvl}`).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

describe('interpolateAnchors', () => {
  const anchors: RGB[] = [
    [0, 0, 0],
    [50, 100, 150],
    [100, 200, 250],
    [255, 255, 255],
  ];
  const breakpoints = [0, 0.3, 0.7, 1.0];

  it('returns first anchor at p=0', () => {
    expect(interpolateAnchors(anchors, breakpoints, 0)).toEqual([0, 0, 0]);
  });

  it('returns exact anchor at internal breakpoint', () => {
    expect(interpolateAnchors(anchors, breakpoints, 0.3)).toEqual([50, 100, 150]);
  });

  it('returns last anchor at p=1', () => {
    expect(interpolateAnchors(anchors, breakpoints, 1.0)).toEqual([255, 255, 255]);
  });

  it('interpolates linearly within a segment (p=0.5 between breakpoints 0.3 and 0.7)', () => {
    // local t = (0.5 - 0.3) / (0.7 - 0.3) = 0.5; midway between [50,100,150] and [100,200,250]
    expect(interpolateAnchors(anchors, breakpoints, 0.5)).toEqual([75, 150, 200]);
  });
});

describe('applySaturationTint', () => {
  it('factor=1.0 is identity', () => {
    expect(applySaturationTint([200, 50, 100], 1.0)).toEqual([200, 50, 100]);
  });

  it('factor=0 collapses to neutral gray', () => {
    expect(applySaturationTint([200, 50, 100], 0)).toEqual([128, 128, 128]);
  });

  it('factor=0.85 (common) moves toward gray', () => {
    // r: 128 + (200-128)*0.85 = 128 + 61.2 → 189
    expect(applySaturationTint([200, 200, 200], 0.85)).toEqual([189, 189, 189]);
  });

  it('factor=1.2 extrapolates away from gray and clamps to [0, 255]', () => {
    // r: 128 + (250-128)*1.2 = 128 + 146.4 → 274 → clamped to 255
    const result = applySaturationTint([250, 250, 250], 1.2);
    expect(result[0]).toBe(255);
    expect(result[1]).toBe(255);
    expect(result[2]).toBe(255);
  });

  it('factor=1.2 clamps to 0 when extrapolating dark', () => {
    // r: 128 + (10-128)*1.2 = 128 - 141.6 = -13.6 → clamped to 0
    const result = applySaturationTint([10, 10, 10], 1.2);
    expect(result).toEqual([0, 0, 0]);
  });
});
