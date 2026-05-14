// Renders the same buddy card under each of the four terminal capability tiers
// so reviewers can eyeball the actual output before merge. Pairs with the
// end-to-end assertions in src/__tests__/card-color.test.ts.
//
// Usage:  npm run build && node scripts/verify-color-tiers.mjs

import { renderCard } from '../dist/lib/card.js';
import { totalXpForLevel } from '../dist/lib/leveling.js';

const TIERS = [
  { name: 'NO_COLOR',  caps: { truecolor: false, ansi256: false, ansi16: false, noColor: true  } },
  { name: 'ANSI-16',   caps: { truecolor: false, ansi256: false, ansi16: true,  noColor: false } },
  { name: 'ANSI-256',  caps: { truecolor: false, ansi256: true,  ansi16: false, noColor: false } },
  { name: 'truecolor', caps: { truecolor: true,  ansi256: false, ansi16: false, noColor: false } },
];

const companion = {
  name: 'Steven',
  personalityBio: 'a sample buddy used to verify each color tier.',
  rarity: 'rare',
  species: 'Cactus',
  eye: '·',
  hat: 'none',
  shiny: false,
  stats: { DEBUGGING: 50, PATIENCE: 40, CHAOS: 30, WISDOM: 20, SNARK: 10 },
  level: 25,
  xp: totalXpForLevel(25),
  mood: 'neutral',
  availablePoints: 0,
  hatchedAt: Date.now(),
};

const ESC = /\x1b\[[^m]*m/g;

function describe(card) {
  const escapes = card.match(ESC) ?? [];
  const has24bit = card.includes('\x1b[38;2;');
  const has256 = card.includes('\x1b[38;5;');
  const has16 = /\x1b\[3[0-7]m/.test(card);
  return {
    escapeCount: escapes.length,
    has24bit,
    has256,
    has16,
  };
}

for (const { name, caps } of TIERS) {
  const card = renderCard(companion, caps);
  const stats = describe(card);
  console.log('='.repeat(60));
  console.log(`tier: ${name}`);
  console.log(`escapes emitted: ${stats.escapeCount}` +
    `  | 24-bit: ${stats.has24bit}  | 256-color: ${stats.has256}  | 16-color: ${stats.has16}`);
  console.log('-'.repeat(60));
  console.log(card);
  console.log();
}
