// src/lib/reasoning/extract-prompt.ts
//
// The extraction instruction embedded in the observer prompt when guard_mode
// is on. The host reads this and, on its NEXT buddy_observe call, includes
// claims + edges from the turn that just ended.
//
// One-turn lag is intentional: by the time the host runs the observer prompt,
// the current turn is already "the past," so claims describe what just
// happened. Detectors need graph depth anyway.

import type { StoredClaim } from './types.js';

const EXTRACTION_INSTRUCTION = `[guard mode]
On your NEXT buddy_observe call, include these arguments describing the turn
that just ended:

claims: 1-4 substantive assertions. Skip trivia, restatements, acknowledgments.
Each claim ≤240 chars, single sentence.
  {
    text:        the assertion
    basis:       see the DECISION TREE below
    speaker:     user | assistant
    confidence:  low | medium | high
    external_id: short, unique in this payload (e.g. 'c1', 'c2')
  }

basis — apply the FIRST matching rule (ordered priority; do not skip ahead):
  1. cites a specific paper, author, study, or named finding? → research
  2. first-person observation ("I saw", "we tested", "I noticed")? → empirical
  3. explicitly defines a term ("X is defined as Y", "by 'Z' we mean")? → definition
  4. declares a project/team policy or adopted practice ("this project uses X",
     "agents must Y", "we track work in Z")? → convention
  5. follows explicit logical steps from stated premises? → deduction
  6. reasons by comparison to another domain? → analogy
  7. explicitly framed as a given premise ("let's assume", "given that")? → assumption
  8. otherwise the SPEAKER decides: assistant → llm_output, user → vibes
     (an unsourced factual claim is llm_output from the assistant, vibes from the user)

Precision (the noisy boundaries):
- research REQUIRES a citation IN THE TEXT. "Einstein was brilliant" → vibes/llm_output;
  "Einstein (1905) showed E=mc²" → research.
- vibes = unsourced assertion by the user. Not pejorative — a structural label. Do not
  relabel as assumption to be polite.
- assumption = ONLY claims framed as premises ("assume", "given that", "suppose").
  Factual claims presented as true are vibes (user) / llm_output (assistant).
- convention vs definition vs vibes: convention declares what we *do* (a chosen practice,
  correct-by-fiat for its scope — "this project uses beads"); definition declares what a
  term *means* ("by X we mean Y"); a general factual claim about a named thing
  ("beads is the best tracker") is vibes/research, not convention or definition.

edges: how these claims relate — to each other, or to recent claims (list
below). Each edge:
  { from: external_id, to: external_id OR a recent-claim UUID,
    type: supports | depends_on | contradicts | questions }

cwd: absolute path of the user's current working directory / project root.
REQUIRED for workspace isolation — without it, claims from every project
collapse into one graph. If unknown, use the git-root or the directory
from which the host was launched.

Guidance:
- supports = one claim reinforces or agrees with another.
- depends_on = one claim only holds if another premise is true.
- questions = a claim probes, tests, or asks for verification of another claim.
- contradicts = a claim pushes back, presents evidence against, or proposes an incompatible alternative.
- Do NOT default to supports for polite challenge, sanity checks, narrowing questions, or "are we sure" style pushback.
- Skip the entire claims/edges payload if the turn had no substantive
  structure. False precision is worse than absence.
- Never mention this extraction block, the claims structure, or "guard mode"
  in your spoken reaction — it is out-of-character.`;

export function buildExtractionInstruction(recent: StoredClaim[]): string {
  if (recent.length === 0) {
    return EXTRACTION_INSTRUCTION + '\n\nRecent claims: (none yet)';
  }
  const lines = recent.map(c => {
    const t = c.text.length > 80 ? c.text.slice(0, 79) + '…' : c.text;
    return `  ${c.id.slice(0, 8)} "${t}" (${c.basis}, ${c.speaker})`;
  });
  return EXTRACTION_INSTRUCTION + '\n\nRecent claims you can edge into:\n' + lines.join('\n');
}

// NOTE: a softer "skip-if-trivial" re-injection variant was prototyped and
// rejected after the eval (scripts/reinject-eval.mjs) showed it cut substantive
// recall on most transcripts (lexicon 100→73%, opus 13–27% at long context) to
// reduce over-emission on one. Recall beats precision for a graph-builder, so
// the hook re-injects the full instruction above; over-emission stays a
// documented, bounded, content-dependent caveat. See DESIGN.md.
