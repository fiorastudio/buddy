// src/lib/color.ts — buddy color progression (species × rarity × XP → ANSI escape)
//
// See docs/superpowers/specs/2026-05-12-buddy-color-progression-design.md for the design.

import type { Rarity } from './types.js';
import { levelProgress } from './leveling.js';

export type RGB = readonly [number, number, number];

export interface TerminalCapabilities {
  truecolor: boolean;
  ansi256: boolean;
  ansi16: boolean;
  noColor: boolean;
}

export const NEUTRAL_GRAY: RGB = [128, 128, 128];

// 21 species × 4 RGB anchors. First-cut shades from the design spec — tunable.
// Anchor 0 sits at Lv 1 (p=0.0), Anchor 3 sits at Lv 30 (p=0.6). Between
// Lv 30 and Lv 40 the color bridges into the rarity's first metal anchor.
export const SPECIES_PALETTES: Record<string, readonly [RGB, RGB, RGB, RGB]> = {
  'Void Cat':     [[0x1a, 0x1a, 0x2a], [0x4a, 0x3a, 0x6e], [0xc3, 0x3a, 0x8e], [0xd6, 0xd6, 0xf0]],
  'Rust Hound':   [[0xa0, 0x4a, 0x2a], [0xd4, 0x4a, 0x2e], [0xd6, 0x8a, 0x3e], [0xb8, 0x7a, 0x4a]],
  'Data Drake':   [[0x5f, 0xbb, 0x33], [0x4a, 0xd6, 0xc2], [0xe8, 0x3a, 0x9c], [0x9c, 0x3a, 0xff]],
  'Log Golem':    [[0x5e, 0x48, 0x36], [0x5a, 0x7a, 0x3a], [0x7a, 0x7a, 0x7a], [0x8a, 0x9a, 0x6e]],
  'Cache Crow':   [[0x2a, 0x2a, 0x2a], [0x6a, 0x6a, 0x76], [0x4a, 0x5a, 0xa8], [0xd6, 0xd6, 0xe6]],
  'Shell Turtle': [[0x6e, 0x52, 0x36], [0x5a, 0x7a, 0x3a], [0x2e, 0x7a, 0x5a], [0xd6, 0x8a, 0x3e]],
  'Duck':         [[0x5a, 0x7a, 0x4a], [0x4a, 0x8a, 0x9a], [0xd6, 0x8a, 0x3a], [0xf4, 0xc9, 0x48]],
  'Goose':        [[0xaa, 0xa9, 0xa3], [0x6a, 0x8a, 0xa8], [0x4a, 0x8a, 0x99], [0x7e, 0xc9, 0xc6]],
  'Blob':         [[0x5f, 0xbb, 0x33], [0xf4, 0xc9, 0x48], [0xe8, 0x3a, 0x9c], [0x9c, 0x3a, 0xff]],
  'Octopus':      [[0x3d, 0x2a, 0x5a], [0x5d, 0x4c, 0xad], [0x3d, 0x8a, 0xd6], [0x3e, 0xd6, 0xc2]],
  'Owl':          [[0x5d, 0x4c, 0xad], [0x2a, 0x3a, 0x6e], [0xd6, 0xd4, 0xa6], [0xe8, 0xb0, 0x4a]],
  'Penguin':      [[0xd4, 0xe4, 0xeb], [0x5d, 0x9c, 0xd6], [0x4e, 0xc5, 0xb9], [0x6c, 0xd9, 0x9a]],
  'Snail':        [[0xaa, 0xa9, 0xa3], [0x5a, 0x7a, 0x4a], [0xd4, 0xa6, 0xb9], [0xcf, 0xd9, 0xd4]],
  'Ghost':        [[0xaa, 0xa9, 0xa3], [0x6a, 0x8a, 0xa8], [0xc4, 0xe4, 0xe6], [0xf0, 0xf0, 0xf0]],
  'Axolotl':      [[0xd6, 0x8a, 0x8a], [0xe9, 0x6a, 0x5a], [0xf4, 0xb6, 0xc2], [0xb6, 0xe4, 0xc2]],
  'Capybara':     [[0x8a, 0x6a, 0x4a], [0xd6, 0x8a, 0x4a], [0xe8, 0xc4, 0x6a], [0x8a, 0xa6, 0x6e]],
  'Cactus':       [[0x9b, 0x87, 0x57], [0x5a, 0x8a, 0x3a], [0xc7, 0x5d, 0x8a], [0xe8, 0xb0, 0x4a]],
  'Robot':        [[0x5a, 0x5a, 0x66], [0x3a, 0x8a, 0xa4], [0x5f, 0xbb, 0x33], [0xe8, 0x44, 0x3e]],
  'Rabbit':       [[0xf4, 0xb6, 0xc2], [0xf4, 0xe6, 0xc4], [0xe8, 0xb0, 0x6f], [0xf6, 0xf6, 0xf4]],
  'Mushroom':     [[0x5e, 0x48, 0x36], [0x8b, 0x6d, 0x4b], [0xc3, 0x3a, 0x2e], [0xe8, 0xb0, 0x6f]],
  'Chonk':        [[0xe6, 0xd6, 0xb4], [0xd6, 0x8a, 0x4a], [0xc4, 0x84, 0x3e], [0x6e, 0x4a, 0x2a]],
};

// Defensive fallback when an unknown species is encountered (should not happen in
// practice — every Companion has a species from SPECIES_LIST — but avoids throws).
// Generic neutral ramp: gray → blue → green → amber.
export const FALLBACK_SPECIES_PALETTE: readonly [RGB, RGB, RGB, RGB] = [
  [0x66, 0x66, 0x66],
  [0x4a, 0x6a, 0xa8],
  [0x4a, 0xa8, 0x6a],
  [0xd6, 0xa8, 0x4a],
];

// Tier-break rarity ladder. Common/Uncommon get utilitarian metals (Iron, Copper);
// the visible break to precious materials happens at Rare ("rare should mean rare").
export const RARITY_METALS: Record<Rarity, readonly [RGB, RGB]> = {
  common:    [[0x6a, 0x6a, 0x6e], [0x8a, 0x8a, 0x8e]], // Iron → Polished Iron
  uncommon:  [[0xa8, 0x6a, 0x3a], [0xb8, 0x8a, 0x5e]], // Copper → Patina Copper
  rare:      [[0xc8, 0x9a, 0x2e], [0xf4, 0xc9, 0x48]], // Gold I → Gold II (the jump)
  epic:      [[0x8a, 0xcd, 0xd9], [0xdc, 0xee, 0xf4]], // Diamond → Iridescent
  legendary: [[0xca, 0xbc, 0x94], [0xf4, 0xee, 0xdc]], // Aurum → Aurum Sheen
};

// Applied uniformly across species AND metal segments. Common buddies render
// slightly muted, legendary buddies slightly extra-saturated — rarity is
// readable from Lv 1 through Lv 50.
export const RARITY_SATURATION: Record<Rarity, number> = {
  common:    0.85,
  uncommon:  1.00,
  rare:      1.05,
  epic:      1.12,
  legendary: 1.20,
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function rampPosition(totalXp: number): number {
  const { level, currentXp, neededXp } = levelProgress(totalXp);
  if (level >= 50) return 1.0;
  const progress = neededXp > 0 ? currentXp / neededXp : 0;
  return clamp((level - 1 + progress) / 49, 0, 1);
}

export function interpolateAnchors(
  anchors: readonly RGB[],
  breakpoints: readonly number[],
  p: number,
): RGB {
  for (let i = 1; i < breakpoints.length; i++) {
    if (p <= breakpoints[i]!) {
      const localT = (p - breakpoints[i - 1]!) / (breakpoints[i]! - breakpoints[i - 1]!);
      return lerpRGB(anchors[i - 1]!, anchors[i]!, localT);
    }
  }
  return anchors[anchors.length - 1]!;
}

export function applySaturationTint(rgb: RGB, factor: number): RGB {
  const [gr, gg, gb] = NEUTRAL_GRAY;
  return [
    clamp(Math.round(gr + (rgb[0] - gr) * factor), 0, 255),
    clamp(Math.round(gg + (rgb[1] - gg) * factor), 0, 255),
    clamp(Math.round(gb + (rgb[2] - gb) * factor), 0, 255),
  ];
}

const BREAKPOINTS = [0, 0.2, 0.4, 0.6, 0.8, 1.0] as const;

export function computeRGB(species: string, rarity: Rarity, totalXp: number): RGB {
  const p = rampPosition(totalXp);
  const speciesAnchors = SPECIES_PALETTES[species] ?? FALLBACK_SPECIES_PALETTE;
  const metalAnchors = RARITY_METALS[rarity];

  const anchors: RGB[] = [
    speciesAnchors[0], speciesAnchors[1], speciesAnchors[2], speciesAnchors[3],
    metalAnchors[0], metalAnchors[1],
  ];

  const interpolated = interpolateAnchors(anchors, [...BREAKPOINTS], p);
  return applySaturationTint(interpolated, RARITY_SATURATION[rarity]);
}

export function detectCapabilities(env: NodeJS.ProcessEnv = process.env): TerminalCapabilities {
  const caps: TerminalCapabilities = {
    truecolor: false, ansi256: false, ansi16: false, noColor: false,
  };

  // 1. NO_COLOR — highest priority, any value (including "") counts.
  if (env.NO_COLOR !== undefined) {
    caps.noColor = true;
    return caps;
  }

  // 2. COLORTERM explicit truecolor declaration.
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') {
    caps.truecolor = true;
    return caps;
  }

  // 3. Windows Terminal sets WT_SESSION; it supports truecolor.
  if (env.WT_SESSION) {
    caps.truecolor = true;
    return caps;
  }

  // 4. Well-known truecolor TERM_PROGRAMs.
  if (env.TERM_PROGRAM === 'iTerm.app' || env.TERM_PROGRAM === 'vscode') {
    caps.truecolor = true;
    return caps;
  }

  // 5. TERM suffix.
  const term = env.TERM ?? '';
  if (term.endsWith('-truecolor') || term.endsWith('-direct')) {
    caps.truecolor = true;
    return caps;
  }
  if (term.endsWith('-256color')) {
    caps.ansi256 = true;
    return caps;
  }

  // 6. Fallback.
  caps.ansi16 = true;
  return caps;
}

// Map a 24-bit RGB triple into the 256-color cube index (16-231 range).
// Uses the standard 6×6×6 cube formula. Grayscale ramp (232-255) is not used —
// the cube provides adequate fidelity and avoids hue distortion.
export function rgbTo256(rgb: RGB): number {
  const r6 = Math.round((rgb[0] / 255) * 5);
  const g6 = Math.round((rgb[1] / 255) * 5);
  const b6 = Math.round((rgb[2] / 255) * 5);
  return 16 + 36 * r6 + 6 * g6 + b6;
}
