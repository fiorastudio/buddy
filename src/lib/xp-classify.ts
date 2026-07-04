// src/lib/xp-classify.ts
// Two-channel XP event classification.
//
// Ground truth: detectCommandEvent inspects the literal tool call the
// PostToolUse hook saw (command string + output + exit code).
// Self-report: classifySummary keyword-matches the buddy_observe summary,
// covering events with no command signature (bug_fix) and hosts without
// hooks. resolveEventType arbitrates when both channels fire.

import { XP_REWARDS } from './leveling.js';

export type XpEventType = 'observe' | 'session' | 'commit' | 'tests_passed' | 'bug_fix' | 'deploy';

const SUMMARY_CLASSIFIERS: Array<[XpEventType, RegExp]> = [
  ['deploy', /\b(deploy(ed|ing|s)?|ship(ped|ping)?( .*)?to prod|released?|publish(ed)? .*(npm|package|release))\b/i],
  ['bug_fix', /\b(fix(ed|ing)?|squash(ed)?|resolv(ed|ing)|patch(ed)?)\b.*\b(bug|crash|race|leak|regression|error|issue|flaky|null pointer|exception)\b|\b(bug|crash|regression)\b.*\bfix/i],
  ['commit', /\bcommit(ted|ting)?\b/i],
  ['tests_passed', /\btests?\b.*\b(pass(ing|ed)?|green)\b|\ball (tests? )?(pass(ing|ed)?|green)\b/i],
];

// "The richest genuine claim wins" — enforced mechanically, not by comment:
// evaluation order derives from XP_REWARDS at module load, so a reward
// rebalance can never silently invert classification priority.
const ORDERED_CLASSIFIERS = [...SUMMARY_CLASSIFIERS].sort(
  (a, b) => (XP_REWARDS[b[0]] ?? 0) - (XP_REWARDS[a[0]] ?? 0)
);

export function classifySummary(summary: string): XpEventType {
  const s = summary || '';
  for (const [type, re] of ORDERED_CLASSIFIERS) {
    if (re.test(s)) return type;
  }
  return 'observe';
}

/**
 * Arbitrate the two channels: when the hook already recorded an event of
 * the same type this window, the self-report demotes to a plain observe
 * so one real-world action never awards twice.
 */
export function resolveEventType(selfReported: XpEventType, pendingTypes: ReadonlySet<string>): XpEventType {
  return pendingTypes.has(selfReported) ? 'observe' : selfReported;
}

const DEPLOY_COMMANDS = [
  /\bnpm publish\b/,
  /\bwrangler (deploy|publish)\b/,
  /\bvercel\b.*(--prod|deploy)/,
  /\bgh release create\b/,
  /\b(flyctl|fly) deploy\b/,
  /\bfirebase deploy\b/,
  /\bcdk deploy\b/,
  /\bkubectl (apply|rollout)\b/,
];

const TEST_PASS_OUTPUT = /(\d+)\s+pass(ed|ing)/i;
const TEST_FAIL_OUTPUT = /(\d+)\s+fail(ed|ing)|\bFAILED\b/i;

export function detectCommandEvent(
  toolName: string,
  command: string,
  output: string,
  exitCode: number
): XpEventType | null {
  if (toolName !== 'Bash' || exitCode !== 0) return null;
  const cmd = command || '';
  const out = output || '';

  if (/\bgit commit\b/.test(cmd)) return 'commit';
  if (DEPLOY_COMMANDS.some((re) => re.test(cmd))) return 'deploy';
  if (TEST_PASS_OUTPUT.test(out) && !TEST_FAIL_OUTPUT.test(out)) return 'tests_passed';
  return null;
}
