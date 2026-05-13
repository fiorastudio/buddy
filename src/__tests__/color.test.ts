import { describe, it, expect } from 'vitest';
import type { RGB, TerminalCapabilities } from '../lib/color.js';
import { NEUTRAL_GRAY } from '../lib/color.js';
import { SPECIES_PALETTES, FALLBACK_SPECIES_PALETTE } from '../lib/color.js';
import { SPECIES_LIST } from '../lib/species.js';

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
