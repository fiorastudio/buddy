// src/lib/types.ts

export const STAT_NAMES = ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK'] as const;
export type StatName = (typeof STAT_NAMES)[number];

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

// ✦ (star) reserved for level-up sparkle effect, not in default pool
export const EYES = ['·', '.', '×', '◉', '@', '°'] as const;
export const SPARKLE_EYE = '✦';
export type Eye = (typeof EYES)[number];

export const HATS = ['none', 'crown', 'tophat', 'propeller', 'halo', 'wizard', 'beanie', 'tinyduck'] as const;
export type Hat = (typeof HATS)[number];

export type CompanionBones = {
  rarity: Rarity;
  species: string;
  eye: Eye;
  hat: Hat;
  shiny: boolean;
  stats: Record<StatName, number>;
};

export type CompanionSoul = {
  name: string;
  personalityBio: string;
};

export type Companion = CompanionBones & CompanionSoul & {
  level: number;
  xp: number;
  mood: string;
  hatchedAt: number;
};

export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 10,
  epic: 4,
  legendary: 1,
};

export const RARITY_FLOOR: Record<Rarity, number> = {
  common: 5,
  uncommon: 15,
  rare: 25,
  epic: 35,
  legendary: 50,
};

export const RARITY_STARS: Record<Rarity, string> = {
  common: '★',
  uncommon: '★★',
  rare: '★★★',
  epic: '★★★★',
  legendary: '★★★★★',
};

export const RARITY_ANSI: Record<Rarity, string> = {
  common: '\x1b[2m',       // dim
  uncommon: '\x1b[32m',    // green
  rare: '\x1b[36m',        // cyan
  epic: '\x1b[35m',        // magenta
  legendary: '\x1b[33m',   // yellow
};

export const HAT_LINES: Record<Hat, string> = {
  none: '',
  crown: '   \\^^^/    ',
  tophat: '   [___]    ',
  propeller: '    -+-     ',
  halo: '   (   )    ',
  wizard: '    /^\\     ',
  beanie: '   (___)    ',
  tinyduck: '    ,>      ',
};

export function getPeakStat(stats: Record<StatName, number>): StatName {
  let peak: StatName = STAT_NAMES[0];
  let max = 0;
  for (const name of STAT_NAMES) {
    if (stats[name] > max) { max = stats[name]; peak = name; }
  }
  return peak;
}

export function getDumpStat(stats: Record<StatName, number>): StatName {
  let dump: StatName = STAT_NAMES[0];
  let min = 101;
  for (const name of STAT_NAMES) {
    if (stats[name] < min) { min = stats[name]; dump = name; }
  }
  return dump;
}
