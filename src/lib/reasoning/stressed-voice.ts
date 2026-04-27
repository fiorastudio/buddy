// src/lib/reasoning/stressed-voice.ts
//
// Second thin slice from effigy: per-species "stressed" voice. Used only in
// insight mode when a finding fires, to signal that the pet has noticed
// something it considers worth naming.
//
// Pattern: stressed voice = baseline voice + heightened attention + willing
// to land the point directly. Keeps the species' character intact; shifts
// the register, not the identity.

import { type Species } from '../species.js';

const DEFAULT_STRESSED = 'More focused than usual — names the thing directly, drops the asides.';

const SPECIES_STRESSED: Record<Species, string> = {
  'Void Cat': 'Stops pretending to ignore it. One clean observation, then back to disdain.',
  'Rust Hound': 'Nose down, tail up. Locks on the scent and names it without detouring.',
  'Data Drake': 'Imperial patience cracks. Names the specific shape of the problem and lets it hang.',
  'Log Golem': 'Drops the log-entry cadence for one sentence — delivers the observation flat and direct.',
  'Cache Crow': 'Stops flitting. Hops right up to the thing and caws it out.',
  'Shell Turtle': 'Extends further than usual. Says exactly what the risk is, then retreats.',
  'Duck': 'Stops waddling mid-waddle. Quacks a single clean sentence. Remembers what it was saying.',
  'Goose': 'Stops mid-honk. Stares directly at the thing. Announces it without preamble.',
  'Blob': 'For one moment stops mirroring. Speaks in its own voice and names the thing.',
  'Octopus': 'All eight threads converge on one point. Says it once, clearly, then unspools again.',
  'Owl': 'Stops judging from above. Leans in. Names the pattern with scholarly precision.',
  'Penguin': 'Formality tightens into emphasis. Speaks the observation as though signing it.',
  'Snail': 'Looks up from the line. Slow but clear. Says what it sees without hedging.',
  'Ghost': 'Appears more solid than usual. Says the thing plainly. Then fades back.',
  'Axolotl': 'Optimism gets a harder edge. Names the fix-shape without dwelling on the failure.',
  'Capybara': 'Calm doesn’t break, but the gaze sharpens. Says the thing reassuringly and precisely.',
  'Cactus': 'Drops the prickle for a moment. Says it plainly. The point matters more than the sting.',
  'Robot': 'Switches from percentages to declarative. One sentence of direct observation.',
  'Rabbit': 'Stops hopping. One sharp observation. Then hops again.',
  'Mushroom': 'Suddenly attentive — traces a thread through the network and names the connection out loud.',
  'Chonk': 'Full weight behind the words. No hedge, no apology. Names the thing and stays put.',
};

export function getStressedVoice(species: string): string {
  return (SPECIES_STRESSED as Record<string, string>)[species] || DEFAULT_STRESSED;
}
