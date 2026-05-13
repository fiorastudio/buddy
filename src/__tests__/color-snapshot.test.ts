import { describe, it, expect } from 'vitest';
import { colorFor, type TerminalCapabilities } from '../lib/color.js';
import { totalXpForLevel } from '../lib/leveling.js';

const TRUECOLOR: TerminalCapabilities = {
  truecolor: true, ansi256: false, ansi16: false, noColor: false,
};

interface Fixture {
  species: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  level: number;
  label: string;
}

const FIXTURES: Fixture[] = [
  { species: 'Cactus',   rarity: 'common',    level: 1,  label: 'common-cactus-lv1' },
  { species: 'Cactus',   rarity: 'uncommon',  level: 1,  label: 'uncommon-cactus-lv1' },
  { species: 'Cactus',   rarity: 'rare',      level: 1,  label: 'rare-cactus-lv1' },
  { species: 'Cactus',   rarity: 'epic',      level: 1,  label: 'epic-cactus-lv1' },
  { species: 'Cactus',   rarity: 'legendary', level: 1,  label: 'legendary-cactus-lv1' },

  { species: 'Octopus',  rarity: 'uncommon',  level: 10, label: 'uncommon-octopus-lv10' },
  { species: 'Octopus',  rarity: 'uncommon',  level: 20, label: 'uncommon-octopus-lv20' },
  { species: 'Octopus',  rarity: 'uncommon',  level: 30, label: 'uncommon-octopus-lv30' },

  { species: 'Penguin',  rarity: 'rare',      level: 35, label: 'rare-penguin-lv35-bridge' },

  { species: 'Robot',    rarity: 'common',    level: 50, label: 'common-robot-lv50-iron' },
  { species: 'Robot',    rarity: 'uncommon',  level: 50, label: 'uncommon-robot-lv50-copper' },
  { species: 'Robot',    rarity: 'rare',      level: 50, label: 'rare-robot-lv50-gold' },
  { species: 'Robot',    rarity: 'epic',      level: 50, label: 'epic-robot-lv50-diamond' },
  { species: 'Robot',    rarity: 'legendary', level: 50, label: 'legendary-robot-lv50-aurum' },

  { species: 'Pegasus',  rarity: 'uncommon',  level: 1,  label: 'fallback-pegasus' },
];

describe('color fixtures (snapshot contract)', () => {
  for (const fx of FIXTURES) {
    it(`${fx.label} renders to a stable ANSI string`, () => {
      const xp = fx.level === 1 ? 0 : totalXpForLevel(fx.level);
      const escape = colorFor(fx.species, fx.rarity, xp, TRUECOLOR);
      expect(escape).toMatchSnapshot();
    });
  }
});
