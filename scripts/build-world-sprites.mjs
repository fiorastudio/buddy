#!/usr/bin/env node
// Generates world/public/{sprites,jobs}.json from the canonical dist/
// sources. Run after changing species art OR job classes:
//   npm run build && node scripts/build-world-sprites.mjs
// The sprites-drift and jobs-drift tests fail if these go stale.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { SPECIES_LIST, spriteFrameCount, renderSprite, SPRITE_BODIES } = await import(
  pathToFileURL(join(repoRoot, 'dist', 'lib', 'species.js')).href
);
const { SPECIES_PALETTES } = await import(pathToFileURL(join(repoRoot, 'dist', 'lib', 'color.js')).href);
const { JOB_LINES } = await import(pathToFileURL(join(repoRoot, 'dist', 'lib', 'jobclass.js')).href);

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

const jobsOut = join(repoRoot, 'world', 'public', 'jobs.json');
writeFileSync(jobsOut, JSON.stringify(JOB_LINES));
console.log(`wrote ${jobsOut}: ${Object.keys(JOB_LINES).length} job lines`);
