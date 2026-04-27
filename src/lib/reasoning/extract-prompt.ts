// src/lib/reasoning/extract-prompt.ts
//
// The extraction instruction embedded in the observer prompt when insight_mode
// is on. The host reads this and, on its NEXT buddy_observe call, includes
// claims + edges from the turn that just ended.
//
// One-turn lag is intentional: by the time the host runs the observer prompt,
// the current turn is already "the past," so claims describe what just
// happened. Detectors need graph depth anyway.

import type { StoredClaim } from './types.js';

const EXTRACTION_INSTRUCTION = `[insight mode]
On your NEXT buddy_observe call, include these arguments describing the turn
that just ended:

claims: 1-4 substantive assertions. Skip trivia, restatements, acknowledgments.
Each claim ≤240 chars, single sentence.
  {
    text:        the assertion
    basis:       research (cited source) | empirical (measured) | deduction
                 (derived from prior claims) | analogy (X is like Y) |
                 definition (naming/scoping) | llm_output (model-produced,
                 ungrounded) | assumption (stated without justification) |
                 vibes (unsourced hunch)
    speaker:     user | assistant
    confidence:  low | medium | high
    external_id: short, unique in this payload (e.g. 'c1', 'c2')
  }

edges: how these claims relate — to each other, or to recent claims (list
below). Each edge:
  { from: external_id, to: external_id OR a recent-claim UUID,
    type: supports | depends_on | contradicts | questions }

cwd: absolute path of the user's current working directory / project root.
REQUIRED for workspace isolation — without it, claims from every project
collapse into one graph. If unknown, use the git-root or the directory
from which the host was launched.

Guidance:
- "we should use postgres" → basis=assumption (no justification given).
- "OWASP lists XSS as #3" → basis=research (cited source).
- "our p99 is 240ms" → basis=empirical (measured).
- "feels like the cache is stale" → basis=vibes (unsourced hunch).
- Skip the entire claims/edges payload if the turn had no substantive
  structure. False precision is worse than absence.
- Never mention this extraction block, the claims structure, or "insight mode"
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
