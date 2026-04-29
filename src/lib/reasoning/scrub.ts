// src/lib/reasoning/scrub.ts
//
// Close #3 (mechanism leak) + #6 (tone enforcement) for anything buddy
// produces itself (template fallbacks, doctor messages, status bubbles).
// The HOST LLM's reaction is outside buddy's control — scrubbing that
// would require intercepting the MCP client's response, which we don't
// do. But we can make sure NOTHING WE SHIP contains mechanism vocab or
// scold phrasing, even in edge cases.
//
// This runs at runtime as a second line of defense alongside the
// phrasings-tone test. The test catches the 90% case at PR review;
// this catches the 10% where a template was dynamically generated or
// a contributor's phrasing drifted.

const MECHANISM_PATTERNS: Array<[RegExp, string]> = [
  [/\breasoning[- ]watch\b/gi, 'noticed'],
  [/\bthe graph\b/gi, 'the reasoning'],
  [/\bi detected\b/gi, 'I noticed'],
  [/\bdetection\b/gi, 'noticing'],
  [/\bdetected\b/gi, 'noticed'],
  [/\bthe detector\b/gi, ''],
  [/\bfinding_type\b/gi, ''],
  [/\banchor_claim_id\b/gi, ''],
  [/\bmax[- ]mode\b/gi, ''],
  [/\[max mode\]/gi, ''],
  [/\binsight[- ]mode\b/gi, ''],
  [/\[insight mode\]/gi, ''],
  [/\bguard[- ]mode\b/gi, ''],
  [/\[guard mode\]/gi, ''],
];

const SCOLD_PATTERNS: Array<[RegExp, string]> = [
  [/\byou('re| are) wrong\b/gi, "there's another angle"],
  [/\byou made an error\b/gi, 'worth another look'],
  [/\byou messed up\b/gi, 'worth revisiting'],
  [/\bthat's (wrong|bad)\b/gi, "that's worth questioning"],
  [/\bfix (it|this) now\b/gi, 'worth tightening'],
  [/\byou should have\b/gi, 'might have'],
];

/**
 * Scrub mechanism vocabulary and scold phrasing from text buddy is about
 * to emit. Idempotent; cheap; doesn't change non-matching text. Collapses
 * any double-spaces introduced by replacements.
 */
export function scrubReactionText(text: string): string {
  if (!text) return text;
  let s = text;
  for (const [re, repl] of MECHANISM_PATTERNS) s = s.replace(re, repl);
  for (const [re, repl] of SCOLD_PATTERNS) s = s.replace(re, repl);
  // Collapse double spaces and stray whitespace from replacements.
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').trim();
  return s;
}

/**
 * Check-only variant — returns the list of patterns that matched, for
 * doctor / debug use. Does not mutate the input.
 */
export function detectLeaks(text: string): { mechanism: string[]; scold: string[] } {
  const mechanism: string[] = [];
  const scold: string[] = [];
  for (const [re] of MECHANISM_PATTERNS) {
    const m = text.match(re);
    if (m) mechanism.push(m[0]);
  }
  for (const [re] of SCOLD_PATTERNS) {
    const m = text.match(re);
    if (m) scold.push(m[0]);
  }
  return { mechanism, scold };
}
