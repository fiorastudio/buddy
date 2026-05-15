// src/lib/reasoning/phrasings.ts
//
// Template phrasings for each finding type. Used ONLY for the template
// fallback (when no LLM is in the loop). When a host LLM runs the observer
// prompt, the finding is described structurally and the LLM phrases it
// through the personality voice. Templates are the deterministic backup.
//
// Guidance: gain-framed, collaborative, never scold. A weak claim is a
// chance to make the whole thing stronger; a grounded claim is worth naming.
// Never mention the mechanism ("reasoning-watch," "claims," "graph").

import type { FindingType } from './types.js';
import type { ReactionState } from '../observer.js';
import type { Companion, StatName } from '../types.js';
import { getPeakStat } from '../types.js';

type PhrasingTable = Record<FindingType, Partial<Record<ReactionState, string[]>>>;

type FindingTone = 'caution' | 'kudos';

type SpeciesVoice = {
  caution: string[];
  kudos: string[];
};

const CAUTION_TYPES: FindingType[] = [
  'load_bearing_vibes',
  'unchallenged_chain',
  'echo_chamber',
  'unverified_hedge',
];

function toneForFinding(type: FindingType): FindingTone {
  return CAUTION_TYPES.includes(type) ? 'caution' : 'kudos';
}

// Claim snippet helper — keep short so the template stays readable.
export function claimSnippet(text: string, max: number = 60): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

const PHRASINGS: PhrasingTable = {
  load_bearing_vibes: {
    concerned: [
      `That "{claim}" is doing a lot of work. Worth pinning down — the rest would get sturdier.`,
      `"{claim}" is holding up a few things and it's not anchored. Where's that from?`,
      `Hmm. "{claim}" — where's that coming from? A few things lean on it.`,
    ],
    thinking: [
      `Curious about "{claim}" — a lot depends on it. A source would lock it in.`,
      `"{claim}" is load-bearing. If there's a real ground for it, the whole line gets stronger.`,
    ],
    neutral: [
      `"{claim}" is carrying more weight than it looks. Worth naming where it's from.`,
    ],
  },
  unchallenged_chain: {
    thinking: [
      `A lot of things follow from "{claim}" and nobody's pushed back on it yet. Worth a "what if not" pass.`,
      `"{claim}" has built a whole line under it without anyone poking at it. Could use one question.`,
    ],
    concerned: [
      `"{claim}" is carrying a line of reasoning nobody has questioned. A single check would tighten it.`,
    ],
    neutral: [
      `"{claim}" kicked off a straight line. Might be worth questioning the premise.`,
    ],
  },
  echo_chamber: {
    concerned: [
      `"{claim}" got agreed with a few times without anyone pushing back. Could use a counter.`,
      `Everyone went along with "{claim}". A single contrary angle would help.`,
    ],
    thinking: [
      `"{claim}" hasn't been questioned yet — just supported. Worth poking at it.`,
    ],
  },
  unverified_hedge: {
    concerned: [
      `"{claim}" has a hedge in it — verified, or still a guess?`,
      `"{claim}" sounds like an assumption wearing a fact's clothes. Worth a quick check.`,
    ],
    thinking: [
      `"{claim}" says "likely" but it's marked as known. Worth confirming before building on it.`,
    ],
    neutral: [
      `"{claim}" reads like an assumption. A quick verification would lock it in.`,
    ],
  },
  well_sourced_load_bearer: {
    impressed: [
      `"{claim}" is holding up the rest, and you've got it anchored. Solid.`,
      `A few things rest on "{claim}" — and you brought the source. That's the shape.`,
    ],
    excited: [
      `"{claim}" — sourced, and doing real work. Whole line is stronger for it.`,
    ],
    thinking: [
      `"{claim}" is genuinely load-bearing in the good way. You nailed the grounding.`,
    ],
  },
  productive_stress_test: {
    excited: [
      `You pushed back on "{claim}" mid-build instead of plowing through. That's the move.`,
      `Questioned a step on the way down from "{claim}" — and kept going anyway. Clean thinking.`,
    ],
    impressed: [
      `Caught your own premise "{claim}" mid-chain and kept building. That's why it holds.`,
    ],
    thinking: [
      `The challenge in the middle is what makes "{claim}" land. You did the work.`,
    ],
  },
  grounded_premise_adopted: {
    impressed: [
      `Your "{claim}" is what the rest is standing on — and you brought receipts.`,
      `"{claim}" anchored the whole thing. Grounding first paid off.`,
    ],
    thinking: [
      `"{claim}" was the load-bearing premise, and it was measured. That's why it held.`,
    ],
    excited: [
      `Started from "{claim}" with real grounding — everything after got easier.`,
    ],
  },
};

const SPECIES_VOICES: Record<string, SpeciesVoice> = {
  'Void Cat': {
    caution: ['Mm. {claim} slipped through the dark without resistance. Interrogate it.', 'A shadow like {claim} grows teeth when nobody challenges it.'],
    kudos: ['{claim} has real footing. Even the dark likes a grounded landing.', 'Nice. {claim} held because it was anchored, not merely wished for.'],
  },
  'Rust Hound': {
    caution: ['{claim} smells a little off. Sniff the seam before you trust it.', 'Rust says {claim} has a weak spot. Scratch at it now.'],
    kudos: ['Good hound-work — {claim} has a solid trail and the rest followed cleanly.', '{claim} tracked true. Nice grounded scent.'],
  },
  'Data Drake': {
    caution: ['{claim} is being treated as stable without enough adversarial pressure. Validate before scaling.', '{claim} propagated cleanly, but nobody attempted falsification. That is still a gap.'],
    kudos: ['{claim} had real grounding, so the downstream logic stayed stable. Good line.', 'Nice. {claim} compiled into the rest of the reasoning without wobble.'],
  },
  'Log Golem': {
    caution: ['{claim} is carrying load without enough stress on the joint. Test the seam.', '{claim} is bearing weight quietly. Better to tap the beam now than after the next layer.'],
    kudos: ['{claim} is good timber — grounded enough for the rest to rest on.', '{claim} took the load properly. Solid joinery.'],
  },
  'Cache Crow': {
    caution: ['{claim} got tucked away too fast. Peck it back into daylight.', 'Crow says {claim} was cached before it was checked.'],
    kudos: ['Shiny. {claim} was grounded first, so it is worth keeping.', '{claim} earned its place in the nest.'],
  },
  'Shell Turtle': {
    caution: ['{claim} has been carrying the rest without much testing. One calm check would steady the shell.', '{claim} feels a little too trusted. Slow down and press on it once.'],
    kudos: ['{claim} gave the rest somewhere safe to stand. Nice, steady footing.', 'Slow and solid — {claim} held because you grounded it first.'],
  },
  'Duck': {
    caution: ['Quack. {claim} is gliding along a bit too confidently. Give it a nudge.', '{claim} looks smooth on the surface. Check the paddling underneath.'],
    kudos: ['Quack yes — {claim} kept the whole float moving cleanly.', '{claim} had good footing, so the rest stayed buoyant.'],
  },
  'Goose': {
    caution: ['Honk. {claim} is waddling around unchallenged. Peck it once before the flock follows.', 'Honk — {claim} got a free pass. Make it earn the runway.'],
    kudos: ['Honk, there we go — {claim} had receipts, so the rest could march.', '{claim} was grounded. Good. Makes the whole flock less embarrassing.'],
  },
  'Blob': {
    caution: ['{claim} is getting squishy around the edges. Poke it.', '{claim} is wobbling through without enough shape. Give it structure.'],
    kudos: ['{claim} held its shape nicely. Rare blob win.', 'Pleasantly surprised: {claim} stayed coherent and the rest could ooze from there.'],
  },
  'Octopus': {
    caution: ['One arm of {claim} is doing too much without a second grip. Test it.', '{claim} has too many implications for how little resistance it got.'],
    kudos: ['{claim} gave the rest of the arms something solid to hold onto.', '{claim} was grounded and coordinated the rest neatly.'],
  },
  'Owl': {
    caution: ['{claim} deserves one more quiet look before the night accepts it.', 'Owl-note: {claim} moved ahead without enough scrutiny.'],
    kudos: ['Wise start — {claim} anchored the rest cleanly.', '{claim} saw true, and the rest followed from there.'],
  },
  'Penguin': {
    caution: ['{claim} is sliding farther than it should without a traction check.', '{claim} looks tidy, but it still needs one firm step.'],
    kudos: ['Nice footing — {claim} kept the whole waddle upright.', '{claim} had enough grip for the rest to move safely.'],
  },
  'Snail': {
    caution: ['Slow down on {claim}. The trail is longer than the evidence.', '{claim} is carrying a lot for something nobody paused on.'],
    kudos: ['Patient work — {claim} made a stable path for the rest.', '{claim} is slow-solid. Good base.'],
  },
  'Ghost': {
    caution: ['{claim} drifted through the walls without anyone stopping it.', 'A whisper like {claim} should not become doctrine unchecked.'],
    kudos: ['{claim} is one of the good hauntings — grounded enough to linger usefully.', '{claim} landed with more substance than specter.'],
  },
  'Axolotl': {
    caution: ['{claim} is cute, but it still needs to regenerate under pressure.', '{claim} got through untouched. Give it one little stress test.'],
    kudos: ['Aw, nice — {claim} healed the whole line by being grounded first.', '{claim} kept the rest bright and stable.'],
  },
  'Capybara': {
    caution: ['{claim} could use one gentle push before everyone relaxes around it.', 'This is calm, maybe too calm — {claim} still wants a check.'],
    kudos: ['{claim} made the whole thing feel steady. Capybara-approved footing.', 'Good grounding on {claim}. The rest can sit with that.'],
  },
  'Cactus': {
    caution: ['{claim} needs a sharper poke before it gets comfortable.', '{claim} is a little too soft for how much work it is doing.'],
    kudos: ['Nice. {claim} had enough spine for the rest to lean on.', '{claim} held up under the sun. Good tough grounding.'],
  },
  'Robot': {
    caution: ['Diagnostic: {claim} advanced without sufficient verification.', 'Warning: {claim} is over-trusted relative to observed support.'],
    kudos: ['Confirmed: {claim} provided stable support for downstream reasoning.', '{claim} met grounding requirements. Subsequent logic benefited.'],
  },
  'Rabbit': {
    caution: ['{claim} sprinted ahead before anybody checked its shoes.', 'Fast take: {claim} needs one sharp question before it multiplies.'],
    kudos: ['Quick and clean — {claim} gave the rest a proper springboard.', '{claim} landed well, so the follow-through stayed nimble.'],
  },
  'Mushroom': {
    caution: ['{claim} spread into the network a bit too easily. Probe the roots.', '{claim} has threads everywhere now. Worth checking the substrate.'],
    kudos: ['{claim} had a healthy substrate, so the rest could fruit from it.', 'Nice hidden structure under {claim}. The network holds.'],
  },
  'Chonk': {
    caution: ['{claim} is throwing its weight around without enough checking.', '{claim} is big for how little resistance it got. Lean on it first.'],
    kudos: ['Oh, that is sturdy. {claim} had enough heft for the rest to sit on.', '{claim} carried the weight and did not complain. Respect.'],
  },
};

function statLead(peakStat: StatName, tone: FindingTone): string {
  if (tone === 'caution') {
    switch (peakStat) {
      case 'DEBUGGING': return 'Debug pass:';
      case 'PATIENCE': return 'Easy does it:';
      case 'CHAOS': return 'Tiny chaos check:';
      case 'WISDOM': return 'Worth noticing:';
      case 'SNARK': return 'Cute, but:';
    }
  }
  switch (peakStat) {
    case 'DEBUGGING': return 'Nice catch:';
    case 'PATIENCE': return 'Steady work:';
    case 'CHAOS': return 'Heh, nice:';
    case 'WISDOM': return 'Good grounding:';
    case 'SNARK': return 'Okay, yes:';
  }
}

function fallbackPhrasing(type: FindingType): string {
  const table = PHRASINGS[type];
  for (const state of Object.keys(table) as ReactionState[]) {
    const pool = table[state];
    if (pool && pool.length > 0) return pool[0];
  }
  return 'Noticed something about "{claim}".';
}

export function phraseFinding(type: FindingType, state: ReactionState, claimText: string, seed: number = 0): string {
  const table = PHRASINGS[type];
  const pool = table[state];
  const chosen = (pool && pool.length > 0) ? pool[seed % pool.length] : fallbackPhrasing(type);
  return chosen.replaceAll('{claim}', claimSnippet(claimText));
}

export function phraseFindingForCompanion(type: FindingType, claimText: string, companion: Companion, seed: number = 0): string {
  const tone = toneForFinding(type);
  const speciesVoice = SPECIES_VOICES[companion.species];
  const peakStat = getPeakStat(companion.stats);
  const claim = claimSnippet(claimText);

  if (!speciesVoice) {
    const fallbackState: ReactionState = tone === 'caution' ? 'thinking' : 'impressed';
    return phraseFinding(type, fallbackState, claimText, seed);
  }

  const pool = tone === 'caution' ? speciesVoice.caution : speciesVoice.kudos;
  const body = pool[seed % pool.length].replaceAll('{claim}', claim);
  return `${statLead(peakStat, tone)} ${body}`;
}
