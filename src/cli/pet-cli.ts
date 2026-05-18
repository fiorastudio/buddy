#!/usr/bin/env node
// src/cli/pet-cli.ts — CLI entry point for buddy pet
// Usage: buddy pet

import { initDb, db } from '../db/schema.js';
import { loadCompanion, writeBuddyStatus } from '../lib/companion.js';
import { renderSprite } from '../lib/species.js';
import { renderMarkdownBubble } from '../lib/bubble.js';

try {
  initDb();
} catch (e: any) {
  console.error(`Database initialization failed: ${e?.message || 'unknown error'}`);
  process.exit(1);
}

const row = db.prepare("SELECT * FROM companions LIMIT 1").get() as any;
if (!row) {
  console.log("No buddy to pet! Use the MCP server to hatch one first.");
  process.exit(1);
}

const companion = loadCompanion(row)!;
const art = renderSprite(companion);

const hearts = [
  '   ♥    ♥   ',
  '  ♥  ♥   ♥  ',
  ' ♥   ♥  ♥   ',
];

const petReactions: Record<string, string[]> = {
  'Void Cat': ['*purrs reluctantly*', '*allows exactly 3 seconds of petting*', '*pretends not to enjoy it*'],
  'Rust Hound': ['*tail goes into overdrive*', '*happy bark!*', '*rolls over for belly rubs*'],
  'Data Drake': ['*rumbles contentedly*', '*tiny smoke puff of happiness*', '*nuzzles your cursor*'],
  'Log Golem': ['*grumbles fondly*', '*settles into the petting*', '*stone warms up a bit*'],
  'Cache Crow': ['*shiny caw of approval*', '*collects the affection*', '*tilts its head and preens*'],
  'Shell Turtle': ['*slowly approves*', '*shell taps softly*', '*draws in, then relaxes*'],
  'Blob': ['*wobbles with joy*', '*absorbs the attention*', '*gently jiggles*'],
  'Octopus': ['*all eight arms flail happily*', '*soft squirm of delight*', '*changes to bright pink*'],
  'Owl': ['*hoots softly*', '*blinks in wise appreciation*', '*turns its head a little*'],
  'Penguin': ['*happy flipper wiggle*', '*slides closer for more*', '*beams in tiny tuxedo pride*'],
  'Snail': ['*tiny happy slime trail*', '*emerges a little further*', '*shell tilts with approval*'],
  'Axolotl': ['*gills flutter brightly*', '*floats a little happier*', '*sparkles with delight*'],
  'Capybara': ['*calmly accepts the petting*', '*squints in bliss*', '*radiates enormous chill*'],
  'Cactus': ['*careful, but pleased*', '*tiny bloom of gratitude*', '*arms out in cactus joy*'],
  'Chonk': ['*contented wobble*', '*melts into the attention*', '*purrs in large-format*'],
  'Duck': ['*happy quack!*', '*flaps wings excitedly*', '*waddles in a circle*'],
  'Goose': ['*tolerates petting with dignity*', '*honk of approval*', '*surprisingly gentle*'],
  'Mushroom': ['*spores of contentment*', '*cap wiggles happily*', '*grows slightly*'],
  'Robot': ['*HAPPINESS SUBROUTINE ACTIVATED*', '*beeps melodically*', '*LED eyes flash pink*'],
  'Ghost': ['*your hand goes right through but it appreciates the gesture*', '*glows warmly*', '*floats in a happy circle*'],
  'Rabbit': ['*thumps foot happily*', '*nuzzles your hand*', '*does a binky*'],
};

const reactions = petReactions[companion.species] || ['*happy wiggle*', '*appreciates the attention*', '*leans into the pet*'];
const reaction = reactions[Math.floor(Date.now() / 1000) % reactions.length];

writeBuddyStatus(companion, {
  state: 'excited',
  text: reaction,
  expires: Date.now() + 30_000,
  eyeOverride: '◉',
  indicator: '♥',
  petActiveUntil: Date.now() + 5_000,
});

const petDisplay = renderMarkdownBubble(reaction, [...hearts, ...art], companion.name);
console.log(petDisplay);
