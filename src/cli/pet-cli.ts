#!/usr/bin/env node
// src/cli/pet-cli.ts — Pet your buddy and watch them react!

import { db, initDb } from '../db/schema.js';
import { companionExists, loadCompanion, writeBuddyStatus } from '../lib/companion.js';
import { renderSprite, getReaction, spriteFrameCount } from '../lib/species.js';
import type { Companion } from '../lib/types.js';

const HEARTS = ['💕', '💖', '💗', '💓', '💞', '✨', '🌟'];
const PET_RESPONSES: Record<string, string[]> = {
  'Void Cat': ['*purrs loudly*', '*kneads the air*', '*slow blink of trust*', '*headbutts your hand*'],
  'Rust Hound': ['*tail wagging intensifies*', '*happy panting*', '*rolls over for belly rubs*', 'Woof!'],
  'Data Drake': ['*happy chirps*', '*nuzzles warmly*', '*scales shimmer with joy*', '*smoke rings of happiness*'],
  'Log Golem': ['*rumbles contentedly*', '*glows a bit brighter*', '*solid appreciation*', '...thank you.'],
  'Cache Crow': ['*happy caw!*', '*fluffs feathers*', '*brings you a shiny gift*', 'Caw caw!'],
  'Shell Turtle': ['*slowly blinks in appreciation*', '*retreats happily into shell*', '*warm and cozy*', '...nice.'],
  'Duck': ['*happy quacking*', '*waddles closer*', '*splashes joyfully*', 'Quack quack!'],
  'Goose': ['*surprisingly gentle honk*', '*tolerates the pets... for now*', '*actually enjoys this*', 'HONK! (affectionately)'],
  'Blob': ['*jiggles happily*', '*wobbles with joy*', '*expands warmly*', '*squishy contentment*'],
  'Octopus': ['*all arms hug back*', '*ink blush*', '*tentacle wave*', '*very soft squeeze*'],
  'Owl': ['*soft hoot*', '*ruffles feathers*', '*wise contentment*', '*closes eyes peacefully*'],
  'Penguin': ['*happy flipper wave*', '*slides closer*', '*warm despite the cold*', '*happy waddle*'],
  'Snail': ['*retreats then peeks out happily*', '*leaves a sparkly trail*', '*slow but genuine appreciation*', '*antennae wiggle*'],
  'Ghost': ['*pleased "OooOOooh"*', '*floats closer*', '*feels more solid*', '*happy haunting noises*'],
  'Axolotl': ['*gill flutter*', '*happy bubbles*', '*smiles wider*', '*splish splash*'],
  'Capybara': ['*maximum chill*', '*absolutely content*', '*closes eyes in bliss*', '*peak relaxation achieved*'],
  'Cactus': ['*blooms a tiny flower*', '*carefully accepts pets*', '*prickles soften*', '*desert vibes*'],
  'Robot': ['AFFECTION RECEIVED. PROCESSING...', 'HAPPINESS SUBROUTINE ACTIVATED', '*happy beeping*', 'THANK YOU, HUMAN.'],
  'Rabbit': ['*nose twitches happily*', '*ears perk up*', '*does a binky*', '*happy thump*'],
  'Mushroom': ['*cap wobbles happily*', '*releases happy spores*', '*growing stronger*', '*fungi joy*'],
  'Chonk': ['*maximum purr mode*', '*luxuriates in pets*', '*absolute bliss*', '*so round, so happy*'],
};

function getPetResponse(species: string): string {
  const responses = PET_RESPONSES[species] || ['*happy noises*', '*appreciates the pets*', '*wiggles joyfully*'];
  return responses[Math.floor(Math.random() * responses.length)]!;
}

function getRandomHeart(): string {
  return HEARTS[Math.floor(Math.random() * HEARTS.length)]!;
}

function renderPetAnimation(companion: Companion): void {
  const frameCount = spriteFrameCount(companion.species);
  const lines = renderSprite(companion, Math.floor(Math.random() * frameCount));

  const heart1 = getRandomHeart();
  const heart2 = getRandomHeart();
  const heart3 = getRandomHeart();

  console.log();
  console.log(`  ${heart1}  ${heart2}  ${heart3}`);
  console.log();
  lines.forEach(line => console.log(`  ${line}`));
  console.log();
}

async function main() {
  try {
    initDb();
  } catch (e: any) {
    console.error('Could not initialize database:', e?.message);
    process.exit(1);
  }

  const row = companionExists();
  if (!row) {
    console.log('\n  No buddy found! Run `buddy onboard` to hatch one first.\n');
    process.exit(0);
  }

  const companion = loadCompanion(row);
  if (!companion) {
    console.error('Could not load companion data.');
    process.exit(1);
  }

  renderPetAnimation(companion);

  const response = getPetResponse(companion.species);
  console.log(`  ${companion.name} ${response}`);
  console.log();

  // Grant a small XP bonus for petting
  const xpGain = 1;
  const newXp = companion.xp + xpGain;
  db.prepare('UPDATE companions SET xp = ? WHERE id = ?').run(newXp, row.id);

  // Update status with pet reaction
  writeBuddyStatus(
    { ...companion, xp: newXp },
    {
      state: 'pet',
      text: response,
      expires: Date.now() + 5000,
      eyeOverride: '^',
      petActiveUntil: Date.now() + 5000,
    }
  );

  console.log(`  +${xpGain} XP ${getRandomHeart()}`);
  console.log();
}

main().catch(e => {
  console.error('Error:', e);
  process.exit(1);
});
