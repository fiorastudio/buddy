// src/lib/color.ts — buddy color progression (species × rarity × XP → ANSI escape)
//
// See docs/superpowers/specs/2026-05-12-buddy-color-progression-design.md for the design.

export type RGB = readonly [number, number, number];

export interface TerminalCapabilities {
  truecolor: boolean;
  ansi256: boolean;
  ansi16: boolean;
  noColor: boolean;
}

export const NEUTRAL_GRAY: RGB = [128, 128, 128];
