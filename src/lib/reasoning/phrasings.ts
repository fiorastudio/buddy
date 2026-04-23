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

type PhrasingTable = Record<FindingType, Partial<Record<ReactionState, string[]>>>;

// Claim snippet helper — keep short so the template stays readable.
export function claimSnippet(text: string, max: number = 60): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

const PHRASINGS: PhrasingTable = {
  // ── Dark ────────────────────────────────────────────────────────────────
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

  // ── Bright ──────────────────────────────────────────────────────────────
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

// Fallback phrasing if the (type, state) pair has no entry. Every finding
// type has at least one phrasing somewhere so we can always produce a
// template — we pick the first available state's first phrasing.
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
