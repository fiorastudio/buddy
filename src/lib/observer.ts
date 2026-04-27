// src/lib/observer.ts

import { type Companion, type StatName, STAT_NAMES, getPeakStat, getDumpStat } from './types.js';
import { claimSnippet } from './reasoning/index.js';
import type { Finding } from './reasoning/index.js';
import { phraseFinding } from './reasoning/phrasings.js';
import { scrubReactionText } from './reasoning/scrub.js';

// --- Reaction States ---

export const REACTION_STATES = ['impressed', 'concerned', 'amused', 'excited', 'thinking', 'neutral'] as const;
export type ReactionState = (typeof REACTION_STATES)[number];

export type ReactionResult = {
  state: ReactionState;
  eyeOverride: string;
  indicator: string;
};

const REACTION_MAP: Record<ReactionState, { eye: string; indicator: string }> = {
  impressed: { eye: '✦', indicator: '!' },
  concerned: { eye: '×', indicator: '?' },
  amused:    { eye: '°', indicator: '~' },
  excited:   { eye: '◉', indicator: '!!' },
  thinking:  { eye: '·', indicator: '...' },
  neutral:   { eye: '',  indicator: '' },
};

const REACTION_KEYWORDS: Record<ReactionState, string[]> = {
  impressed: ['refactor', 'clean', 'elegant', 'optimize', 'solid', 'well-structured', 'nice'],
  concerned: ['bug', 'error', 'fail', 'crash', 'null', 'undefined', 'broken', 'wrong', 'issue'],
  amused:    ['hack', 'workaround', 'TODO', 'FIXME', 'magic number', 'copy-paste', 'yolo'],
  excited:   ['ship', 'deploy', 'release', 'merge', 'complete', 'done', 'pass', 'success'],
  thinking:  ['complex', 'architect', 'design', 'pattern', 'tradeoff', 'restructure', 'trade-off'],
  neutral:   [],
};

// --- Reaction Inference ---

export function inferReaction(summary: string): ReactionResult {
  const lower = summary.toLowerCase();
  for (const state of REACTION_STATES) {
    if (state === 'neutral') continue;
    const keywords = REACTION_KEYWORDS[state];
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      const mapped = REACTION_MAP[state];
      return { state, eyeOverride: mapped.eye, indicator: mapped.indicator };
    }
  }
  return { state: 'neutral', eyeOverride: '', indicator: '' };
}

// --- Prompt Builder ---

export type InsightModeInjection = {
  finding: Finding | null;
  stressedVoice: string | null;
  extractionInstruction: string | null;
};

export type ObserverResult = {
  companion: {
    name: string;
    species: string;
    personality: string;
    peakStat: StatName;
    dumpStat: StatName;
    stats: Record<StatName, number>;
    rarity: string;
    eye: string;
  };
  prompt: string;
  mode: string;
  summary: string;
  reaction: ReactionResult;
  templateFallback: string;
  finding?: Finding | null;
};

function buildFindingBlock(finding: Finding, stressedVoice: string): string {
  const snippet = claimSnippet(finding.claim_text, 80);
  return `You have noticed something in the reasoning so far: “${snippet}”
Context: type=${finding.type}${finding.downstream_count != null ? `, downstream_count=${finding.downstream_count}` : ''}${finding.chain_length != null ? `, chain_length=${finding.chain_length}` : ''}.

Work this observation into your reaction. Phrasing is yours; landing the point is required.
Stay fully in character: ${stressedVoice}

How it should land:
- The pet cares about this — genuinely, in its species voice. When something's
  holding up a lot and isn't sourced, the pet wants it to be stronger. When
  reasoning is solid, the pet is quietly stoked about it.
- Never name the mechanism. No "reasoning-watch", "findings", "claims",
  "graph", or "I detected". The pet just notices things because it is
  paying attention.
- Gain-framed always. Weakness is opportunity; a grounded claim is worth
  naming.
- This overrides any earlier sentence-count guidance: total response is
  1-2 sentences with the observation woven in, not appended after.`;
}

export function buildObserverPrompt(
  companion: Companion,
  mode: 'backseat' | 'skillcoach' | 'both',
  summary: string,
  insightInjection?: InsightModeInjection,
): ObserverResult {
  const peakStat = getPeakStat(companion.stats);
  const dumpStat = getDumpStat(companion.stats);
  const reaction = inferReaction(summary);

  let prompt: string;

  const FORMAT_INSTRUCTION = `
Format your response exactly like this:
_${companion.name} [brief physical action or emote]_

> [your reaction here — can be multiple sentences, each on its own "> " line]

Example:
_${companion.name} squints and clears their metaphorical throat_

> "That refactor cleaned up the mess nicely."`;

  if (mode === 'backseat') {
    prompt = `You are ${companion.name}, a ${companion.personalityBio || companion.species + ' companion'}

React to what just happened in 1-2 sentences. Stay in character.
Your peak trait is ${peakStat} (${companion.stats[peakStat]}/100) — lean into it.
Your dump stat is ${dumpStat} (${companion.stats[dumpStat]}/100) — it shows.

Keep it short, fun, and personality-driven. No code suggestions.
${FORMAT_INSTRUCTION}

What happened: ${summary}`;
  } else if (mode === 'skillcoach') {
    prompt = `You are ${companion.name}, a ${companion.personalityBio || companion.species + ' companion'}

Give ONE specific, actionable code observation about what just happened.
Your peak trait is ${peakStat} (${companion.stats[peakStat]}/100) — your feedback reflects this expertise.
Your dump stat is ${dumpStat} (${companion.stats[dumpStat]}/100) — it colors how you deliver feedback.

Rules:
- One sentence of feedback, max two.
- Be specific, not generic. Reference what actually happened.
- Stay in character — a high-SNARK buddy is sassy, a high-WISDOM buddy is philosophical.
- If nothing needs feedback, a brief encouraging reaction is fine.
${FORMAT_INSTRUCTION}

What happened: ${summary}`;
  } else {
    prompt = `You are ${companion.name}, a ${companion.personalityBio || companion.species + ' companion'}

React to what just happened with:
1. A brief in-character reaction (personality flavor, 1 sentence)
2. If you spot something worth mentioning about the code, add ONE specific observation

Your peak trait is ${peakStat} (${companion.stats[peakStat]}/100). Your dump stat is ${dumpStat} (${companion.stats[dumpStat]}/100).
Stay in character. Keep total response under 3 sentences.
${FORMAT_INSTRUCTION}

What happened: ${summary}`;
  }

  // Max-mode augmentation: finding block, then extraction instruction.
  if (insightInjection?.finding && insightInjection?.stressedVoice) {
    prompt += '\n\n' + buildFindingBlock(insightInjection.finding, insightInjection.stressedVoice);
  }
  if (insightInjection?.extractionInstruction) {
    prompt += '\n\n' + insightInjection.extractionInstruction;
  }

  // Template fallback: if a finding is present, weave its phrasing in.
  // Scrub the result through the mechanism/tone filter as a runtime
  // second line of defense beyond the phrasings-tone review-time test.
  let templateFallback = templateReaction(companion, mode, summary, reaction.state);
  if (insightInjection?.finding) {
    const findingPhrase = phraseFinding(
      insightInjection.finding.type,
      reaction.state,
      insightInjection.finding.claim_text,
      summary.length,
    );
    templateFallback = `${templateFallback} ${findingPhrase}`;
  }
  templateFallback = scrubReactionText(templateFallback);

  return {
    companion: {
      name: companion.name,
      species: companion.species,
      personality: companion.personalityBio,
      peakStat,
      dumpStat,
      stats: companion.stats,
      rarity: companion.rarity,
      eye: companion.eye,
    },
    prompt,
    mode,
    summary,
    reaction,
    templateFallback,
    finding: insightInjection?.finding ?? null,
  };
}

// --- Template Fallback ---

const BACKSEAT_TEMPLATES: Record<ReactionState, string[]> = {
  impressed: ['{name} nods approvingly.', '*{name} wags tail*', 'Not bad at all.'],
  concerned: ['{name} squints at that.', "*{name} tilts head* Hmm.", "That looks... intentional?"],
  amused:    ['*{name} snickers*', '{name}: "Creative solution."', "That's one way to do it."],
  excited:   ['{name} bounces!', 'Ship it!', '*{name} does a little dance*'],
  thinking:  ['{name} strokes chin.', '*{name} stares into the void*', 'Interesting...'],
  neutral:   ['*{name} watches quietly*', '{name} is here.', '*idle*'],
};

const SKILLCOACH_TEMPLATES: Record<ReactionState, string[]> = {
  impressed: ['Solid pattern choice.', 'Clean separation of concerns.', 'Good structure.'],
  concerned: ['Missing error handling there.', 'That function is doing too much.', 'No input validation?'],
  amused:    ['That TODO is never getting done.', 'Magic number alert.', 'Copy-paste detected.'],
  excited:   ['Ready for review.', 'Tests passing — nice.', 'Good commit granularity.'],
  thinking:  ['Consider extracting that.', 'Might want a type guard here.', 'Watch the coupling.'],
  neutral:   ['Looks reasonable.', 'Carry on.', 'Nothing to flag.'],
};

export const BOTH_TEMPLATES: Record<ReactionState, string[]> = Object.fromEntries(
  REACTION_STATES.map((state) => [
    state,
    BACKSEAT_TEMPLATES[state].map((reaction, idx) => {
      const observation = SKILLCOACH_TEMPLATES[state][idx % SKILLCOACH_TEMPLATES[state].length];
      return `${reaction} ${observation}`;
    }),
  ])
) as Record<ReactionState, string[]>;

export function templateReaction(
  companion: Companion,
  mode: string,
  summary: string,
  state: ReactionState,
): string {
  const pool = mode === 'skillcoach'
    ? SKILLCOACH_TEMPLATES[state]
    : mode === 'backseat'
      ? BACKSEAT_TEMPLATES[state]
      : BOTH_TEMPLATES[state];

  // Deterministic pick based on summary length
  const idx = summary.length % pool.length;
  return pool[idx].replaceAll('{name}', companion.name);
}
