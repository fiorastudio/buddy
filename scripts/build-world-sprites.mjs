#!/usr/bin/env node
// Generates world/public/sprites.json from the canonical sprite/palette
// sources (via the built dist/). Run after changing species art:
//   npm run build && node scripts/build-world-sprites.mjs
// The sprites-drift test fails if this file goes stale.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { SPECIES_LIST, spriteFrameCount, renderSprite, SPRITE_BODIES } = await import(
  pathToFileURL(join(repoRoot, 'dist', 'lib', 'species.js')).href
);
const { SPECIES_PALETTES } = await import(pathToFileURL(join(repoRoot, 'dist', 'lib', 'color.js')).href);

const sprites = {};
for (const species of Object.keys(SPRITE_BODIES)) {
  const frames = spriteFrameCount(species);
  sprites[species] = [];
  for (let f = 0; f < frames; f++) {
    sprites[species].push(
      renderSprite({ species, eye: '{E}', hat: 'none', shiny: false, rarity: 'common', stats: {} }, f)
    );
  }
}

const palettes = {};
for (const species of SPECIES_LIST) {
  palettes[species] = SPECIES_PALETTES[species];
}

const out = join(repoRoot, 'world', 'public', 'sprites.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ sprites, palettes }));
console.log(`wrote ${out}: ${Object.keys(sprites).length} species`);
