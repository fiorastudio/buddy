import { describe, it, expect } from 'vitest';
import type { RGB, TerminalCapabilities } from '../lib/color.js';
import { NEUTRAL_GRAY } from '../lib/color.js';
import { SPECIES_PALETTES, FALLBACK_SPECIES_PALETTE } from '../lib/color.js';
import { RARITY_METALS, RARITY_SATURATION } from '../lib/color.js';
import { clamp, lerpRGB } from '../lib/color.js';
import { rampPosition } from '../lib/color.js';
import { interpolateAnchors } from '../lib/color.js';
import { applySaturationTint } from '../lib/color.js';
import { computeRGB } from '../lib/color.js';
import { detectCapabilities } from '../lib/color.js';
import { rgbTo256 } from '../lib/color.js';
import { rgbToAnsi16 } from '../lib/color.js';
import { colorFor } from '../lib/color.js';
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

describe('computeRGB', () => {
  it('returns the first species anchor (tinted) at Lv 1 totalXp=0', () => {
    // Cactus anchor 0 = [0x9b, 0x87, 0x57] = [155, 135, 87]. Uncommon factor = 1.0 (identity).
    expect(computeRGB('Cactus', 'uncommon', 0)).toEqual([155, 135, 87]);
  });

  it('common rarity mutes the species color', () => {
    // Cactus anchor 0 tinted by 0.85: each channel pulled toward 128.
    // r: 128 + (155-128)*0.85 = 128 + 22.95 → 151
    // g: 128 + (135-128)*0.85 = 128 + 5.95 → 134
    // b: 128 + (87-128)*0.85 = 128 + -34.85 → 93
    expect(computeRGB('Cactus', 'common', 0)).toEqual([151, 134, 93]);
  });

  it('legendary rarity boosts saturation', () => {
    // Cactus anchor 0 tinted by 1.2:
    // r: 128 + (155-128)*1.2 = 128 + 32.4 → 160
    // g: 128 + (135-128)*1.2 = 128 + 8.4 → 136
    // b: 128 + (87-128)*1.2 = 128 + -49.2 → 79
    expect(computeRGB('Cactus', 'legendary', 0)).toEqual([160, 136, 79]);
  });

  it('falls back to FALLBACK_SPECIES_PALETTE for unknown species', () => {
    const result = computeRGB('Pegasus', 'uncommon', 0); // not a real species
    expect(result).toEqual([0x66, 0x66, 0x66]); // fallback anchor 0
  });

  it('produces the rarity metal 1 color (tinted) at Lv 40', () => {
    // p = (40-1)/49 = 0.7959, which falls in the species4→metal1 bridge segment [0.6, 0.8].
    // At p=0.7959, localT = (0.7959-0.6) / (0.8-0.6) = 0.9796 — very close to metal1.
    // For rare Cactus: species[3]=[0xe8,0xb0,0x4a]=[232,176,74], metal1=[0xc8,0x9a,0x2e]=[200,154,46]
    // lerp at t=0.9796: r=232+(200-232)*0.9796≈201, g=176+(154-176)*0.9796≈155, b=74+(46-74)*0.9796≈47
    // Then tint by rare (1.05): r=128+(201-128)*1.05=204.65→205, g=128+(155-128)*1.05=156.35→156, b=128+(47-128)*1.05=43.05→43
    expect(computeRGB('Cactus', 'rare', totalXpForLevel(40))).toEqual([205, 155, 43]);
  });

  it('returns the final metal anchor (tinted) at Lv 50', () => {
    // p = 1.0 (level >= 50 short-circuit). interpolateAnchors returns last anchor = metal2.
    // For rare Cactus: metal2 = [0xf4, 0xc9, 0x48] = [244, 201, 72]. Tint by rare (1.05):
    // r: 128 + (244-128)*1.05 = 128 + 121.8 → 250
    // g: 128 + (201-128)*1.05 = 128 + 76.65 → 205
    // b: 128 + (72-128)*1.05 = 128 - 58.8 → 69
    expect(computeRGB('Cactus', 'rare', totalXpForLevel(50))).toEqual([250, 205, 69]);
  });
});

describe('detectCapabilities', () => {
  // Each test passes an explicit env to avoid global mutation.
  it('NO_COLOR defined → noColor true (highest priority)', () => {
    const caps = detectCapabilities({ NO_COLOR: '1', COLORTERM: 'truecolor' });
    expect(caps.noColor).toBe(true);
    expect(caps.truecolor).toBe(false);
  });

  it('NO_COLOR empty string still triggers no-color (per spec convention)', () => {
    const caps = detectCapabilities({ NO_COLOR: '' });
    expect(caps.noColor).toBe(true);
  });

  it('COLORTERM=truecolor → truecolor', () => {
    const caps = detectCapabilities({ COLORTERM: 'truecolor' });
    expect(caps.truecolor).toBe(true);
  });

  it('COLORTERM=24bit → truecolor', () => {
    const caps = detectCapabilities({ COLORTERM: '24bit' });
    expect(caps.truecolor).toBe(true);
  });

  it('WT_SESSION set → truecolor (Windows Terminal)', () => {
    const caps = detectCapabilities({ WT_SESSION: 'some-guid' });
    expect(caps.truecolor).toBe(true);
  });

  it("TERM_PROGRAM=iTerm.app → truecolor", () => {
    const caps = detectCapabilities({ TERM_PROGRAM: 'iTerm.app' });
    expect(caps.truecolor).toBe(true);
  });

  it("TERM_PROGRAM=vscode → truecolor", () => {
    const caps = detectCapabilities({ TERM_PROGRAM: 'vscode' });
    expect(caps.truecolor).toBe(true);
  });

  it('TERM ending in -truecolor → truecolor', () => {
    const caps = detectCapabilities({ TERM: 'xterm-truecolor' });
    expect(caps.truecolor).toBe(true);
  });

  it('TERM ending in -direct → truecolor', () => {
    const caps = detectCapabilities({ TERM: 'xterm-direct' });
    expect(caps.truecolor).toBe(true);
  });

  it('TERM ending in -256color → ansi256', () => {
    const caps = detectCapabilities({ TERM: 'xterm-256color' });
    expect(caps.ansi256).toBe(true);
    expect(caps.truecolor).toBe(false);
  });

  it('plain TERM=xterm → ansi16', () => {
    const caps = detectCapabilities({ TERM: 'xterm' });
    expect(caps.ansi16).toBe(true);
  });

  it('empty env → ansi16 fallback', () => {
    const caps = detectCapabilities({});
    expect(caps.ansi16).toBe(true);
  });
});

describe('rgbTo256', () => {
  it('maps pure black to 16 (start of 6×6×6 cube)', () => {
    expect(rgbTo256([0, 0, 0])).toBe(16);
  });

  it('maps pure white to 231 (end of 6×6×6 cube)', () => {
    expect(rgbTo256([255, 255, 255])).toBe(231);
  });

  it('maps pure red to 196 (16 + 36*5 + 0 + 0)', () => {
    expect(rgbTo256([255, 0, 0])).toBe(196);
  });

  it('maps pure green to 46 (16 + 0 + 6*5 + 0)', () => {
    expect(rgbTo256([0, 255, 0])).toBe(46);
  });

  it('maps pure blue to 21 (16 + 0 + 0 + 5)', () => {
    expect(rgbTo256([0, 0, 255])).toBe(21);
  });

  it('returns a value in [16, 231]', () => {
    for (const [r, g, b] of [[100, 50, 200], [10, 200, 30], [128, 128, 128]] as RGB[]) {
      const idx = rgbTo256([r, g, b]);
      expect(idx).toBeGreaterThanOrEqual(16);
      expect(idx).toBeLessThanOrEqual(231);
    }
  });
});

describe('rgbToAnsi16', () => {
  it('maps pure red to ANSI 31 (red)', () => {
    expect(rgbToAnsi16([255, 0, 0])).toBe('\x1b[31m');
  });
  it('maps pure green to ANSI 32 (green)', () => {
    expect(rgbToAnsi16([0, 255, 0])).toBe('\x1b[32m');
  });
  it('maps pure blue to ANSI 34 (blue)', () => {
    expect(rgbToAnsi16([0, 0, 255])).toBe('\x1b[34m');
  });
  it('maps pure yellow (R+G) to ANSI 33 (yellow)', () => {
    expect(rgbToAnsi16([255, 255, 0])).toBe('\x1b[33m');
  });
  it('maps pure cyan (G+B) to ANSI 36 (cyan)', () => {
    expect(rgbToAnsi16([0, 255, 255])).toBe('\x1b[36m');
  });
  it('maps pure magenta (R+B) to ANSI 35 (magenta)', () => {
    expect(rgbToAnsi16([255, 0, 255])).toBe('\x1b[35m');
  });
  it('maps near-white to ANSI 37 (white)', () => {
    expect(rgbToAnsi16([240, 240, 240])).toBe('\x1b[37m');
  });
  it('maps near-black to ANSI 30 (black)', () => {
    expect(rgbToAnsi16([10, 10, 10])).toBe('\x1b[30m');
  });
});

describe('colorFor (public API)', () => {
  const truecolor: TerminalCapabilities = { truecolor: true, ansi256: false, ansi16: false, noColor: false };
  const ansi256: TerminalCapabilities = { truecolor: false, ansi256: true, ansi16: false, noColor: false };
  const ansi16: TerminalCapabilities = { truecolor: false, ansi256: false, ansi16: true, noColor: false };
  const noColor: TerminalCapabilities = { truecolor: false, ansi256: false, ansi16: false, noColor: true };

  it('returns empty string when NO_COLOR', () => {
    expect(colorFor('Cactus', 'rare', 0, noColor)).toBe('');
  });

  it('emits truecolor escape when truecolor', () => {
    // Cactus uncommon Lv 1 = [155, 135, 87], no bold (uncommon).
    expect(colorFor('Cactus', 'uncommon', 0, truecolor)).toBe('\x1b[38;2;155;135;87m');
  });

  it('prepends bold escape for Rare buddies', () => {
    expect(colorFor('Cactus', 'rare', 0, truecolor)).toMatch(/^\x1b\[1m\x1b\[38;2;/);
  });

  it('prepends bold escape for Epic buddies', () => {
    expect(colorFor('Cactus', 'epic', 0, truecolor)).toMatch(/^\x1b\[1m/);
  });

  it('prepends bold escape for Legendary buddies', () => {
    expect(colorFor('Cactus', 'legendary', 0, truecolor)).toMatch(/^\x1b\[1m/);
  });

  it('does NOT prepend bold for Common', () => {
    expect(colorFor('Cactus', 'common', 0, truecolor).startsWith('\x1b[1m')).toBe(false);
  });

  it('does NOT prepend bold for Uncommon', () => {
    expect(colorFor('Cactus', 'uncommon', 0, truecolor).startsWith('\x1b[1m')).toBe(false);
  });

  it('emits 256-color escape when ansi256', () => {
    expect(colorFor('Cactus', 'uncommon', 0, ansi256)).toMatch(/^\x1b\[38;5;\d+m$/);
  });

  it('emits ANSI 16-color escape when ansi16', () => {
    expect(colorFor('Cactus', 'uncommon', 0, ansi16)).toMatch(/^\x1b\[3[0-7]m$/);
  });
});
