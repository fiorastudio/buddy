// src/lib/xp-classify.ts
// Two-channel XP event classification.
//
// Ground truth: detectCommandEvent inspects the literal tool call the
// PostToolUse hook saw (command string + output + exit code).
// Self-report: classifySummary keyword-matches the buddy_observe summary,
// covering events with no command signature (bug_fix) and hosts without
// hooks. When both channels fire, the server dedupes by type + window.

export type XpEventType = 'observe' | 'session' | 'commit' | 'tests_passed' | 'bug_fix' | 'deploy';

const DEPLOY_WORDS = /\b(deploy(ed|ing|s)?|ship(ped|ping)?( .*)?to prod|released?|publish(ed)? .*(npm|package|release))\b/i;
const BUGFIX_WORDS = /\b(fix(ed|ing)?|squash(ed)?|resolv(ed|ing)|patch(ed)?)\b.*\b(bug|crash|race|leak|regression|error|issue|flaky|null pointer|exception)\b|\b(bug|crash|regression)\b.*\bfix/i;
const COMMIT_WORDS = /\bcommit(ted|ting)?\b/i;
const TESTS_WORDS = /\btests?\b.*\b(pass(ing|ed)?|green)\b|\ball (tests? )?(pass(ing|ed)?|green)\b/i;

export function classifySummary(summary: string): XpEventType {
  const s = summary || '';
  // Priority by reward value — the richest genuine claim wins.
  if (DEPLOY_WORDS.test(s)) return 'deploy';
  if (BUGFIX_WORDS.test(s)) return 'bug_fix';
  if (COMMIT_WORDS.test(s)) return 'commit';
  if (TESTS_WORDS.test(s)) return 'tests_passed';
  return 'observe';
}

const DEPLOY_COMMANDS = [
  /\bnpm publish\b/,
  /\bwrangler (deploy|publish)\b/,
  /\bvercel\b.*(--prod|deploy)|\bvercel --prod\b/,
  /\bgh release create\b/,
  /\bflyctl deploy\b|\bfly deploy\b/,
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
