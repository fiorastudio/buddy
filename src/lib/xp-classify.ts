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

// The self-report channel is honor-system (summaries are model/user
// controlled), so its elevated awards are capped per day. Ground-truth
// hook events are never dampened. 8/day covers honest heavy use; a
// summary-spam loop degrades to plain observes after that.
export const SELF_REPORT_DAILY_CAP = 8;

export function shouldDampenSelfReport(elevatedEventsToday: number): boolean {
  return elevatedEventsToday >= SELF_REPORT_DAILY_CAP;
}

// All command detection is ANCHORED to the executed program at the start
// of a shell segment — `echo git commit` and output containing "12 passed"
// must never award (Codex round-2: substring matching was farmable).
// PREFIX allows env assignments / sudo / package-runner shims before the
// real program name.
const PREFIX = String.raw`^(?:\S+=\S+\s+)*(?:sudo\s+)?(?:npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+|bunx?\s+)?`;

const COMMIT_COMMAND = new RegExp(PREFIX + String.raw`git\s+(?:-\S+\s+)*commit\b`);

const DEPLOY_COMMANDS = [
  new RegExp(PREFIX + String.raw`npm\s+publish\b`),
  new RegExp(PREFIX + String.raw`wrangler\s+(deploy|publish)\b`),
  new RegExp(PREFIX + String.raw`vercel\b.*(--prod|\bdeploy\b)`),
  new RegExp(PREFIX + String.raw`gh\s+release\s+create\b`),
  new RegExp(PREFIX + String.raw`(flyctl|fly)\s+deploy\b`),
  new RegExp(PREFIX + String.raw`firebase\s+deploy\b`),
  new RegExp(PREFIX + String.raw`cdk\s+deploy\b`),
  new RegExp(PREFIX + String.raw`kubectl\s+(apply|rollout)\b`),
];

// tests_passed needs BOTH a recognized runner command AND passing output.
const TEST_RUNNER_COMMAND = new RegExp(
  PREFIX + String.raw`(vitest|jest|mocha|pytest|tox|go\s+test|cargo\s+test|npm\s+(t|test)\b|bun\s+test|rspec|phpunit)`
);
const TEST_PASS_OUTPUT = /(\d+)\s+pass(ed|ing)/i;
const TEST_FAIL_OUTPUT = /(\d+)\s+fail(ed|ing)|\bFAILED\b/i;

function shellSegments(cmd: string): string[] {
  return cmd
    .split(/&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detectCommandEvent(
  toolName: string,
  command: string,
  output: string,
  exitCode: number
): XpEventType | null {
  if (toolName !== 'Bash' || exitCode !== 0) return null;
  const segments = shellSegments(command || '');
  const out = output || '';

  if (segments.some((s) => COMMIT_COMMAND.test(s))) return 'commit';
  if (segments.some((s) => DEPLOY_COMMANDS.some((re) => re.test(s)))) return 'deploy';
  if (
    segments.some((s) => TEST_RUNNER_COMMAND.test(s)) &&
    TEST_PASS_OUTPUT.test(out) &&
    !TEST_FAIL_OUTPUT.test(out)
  ) {
    return 'tests_passed';
  }
  return null;
}
