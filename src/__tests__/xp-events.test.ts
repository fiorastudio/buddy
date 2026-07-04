import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifySummary, detectCommandEvent } from '../lib/xp-classify.js';
import { appendPendingEvent, consumePendingEvents } from '../lib/pending-events.js';
import { XP_REWARDS, applyBlessing } from '../lib/leveling.js';
import { currentStreakDays } from '../lib/streaks.js';

describe('classifySummary (self-report channel)', () => {
  it('classifies deploys, bug fixes, commits, and test wins', () => {
    expect(classifySummary('deployed the new API to production')).toBe('deploy');
    expect(classifySummary('shipped v1.2 to prod')).toBe('deploy');
    expect(classifySummary('fixed a null pointer bug in the parser')).toBe('bug_fix');
    expect(classifySummary('squashed the race condition crash')).toBe('bug_fix');
    expect(classifySummary('committed the parser refactor')).toBe('commit');
    expect(classifySummary('all tests passing after the refactor')).toBe('tests_passed');
  });

  it('falls back to observe for ordinary work', () => {
    expect(classifySummary('wrote a CSV parser')).toBe('observe');
    expect(classifySummary('refactored the config loader')).toBe('observe');
    expect(classifySummary('')).toBe('observe');
  });

  it('prefers the richest event when several match', () => {
    // deploy (60) > bug_fix (35) > tests_passed (20) > commit (25)? No —
    // priority is by reward: deploy > bug_fix > commit > tests_passed.
    expect(classifySummary('fixed the bug, committed, and deployed to prod')).toBe('deploy');
    expect(classifySummary('fixed the flaky test and committed')).toBe('bug_fix');
  });
});

describe('detectCommandEvent (ground-truth channel)', () => {
  it('detects successful git commits', () => {
    expect(detectCommandEvent('Bash', 'git commit -m "fix parser"', '', 0)).toBe('commit');
    expect(detectCommandEvent('Bash', 'git add -A && git commit -m x', '', 0)).toBe('commit');
  });

  it('ignores failed commands', () => {
    expect(detectCommandEvent('Bash', 'git commit -m x', 'nothing to commit', 1)).toBeNull();
  });

  it('detects deploy commands', () => {
    for (const cmd of ['npm publish', 'wrangler deploy', 'vercel --prod', 'gh release create v1.0', 'flyctl deploy']) {
      expect(detectCommandEvent('Bash', cmd, '', 0), cmd).toBe('deploy');
    }
  });

  it('detects passing test runs from runner output', () => {
    expect(detectCommandEvent('Bash', 'npx vitest run', 'Tests  12 passed (12)', 0)).toBe('tests_passed');
    expect(detectCommandEvent('Bash', 'npm test', '24 passing', 0)).toBe('tests_passed');
    expect(detectCommandEvent('Bash', 'pytest', '5 passed in 1.2s', 0)).toBe('tests_passed');
  });

  it('does not fire tests_passed when tests fail even with exit 0 wrappers', () => {
    expect(detectCommandEvent('Bash', 'npx vitest run', '2 failed | 10 passed', 0)).toBeNull();
  });

  it('returns null for non-Bash tools and ordinary commands', () => {
    expect(detectCommandEvent('Read', 'whatever', '', 0)).toBeNull();
    expect(detectCommandEvent('Bash', 'ls -la', '', 0)).toBeNull();
    expect(detectCommandEvent('Bash', 'git status', '', 0)).toBeNull();
  });
});

describe('pending events file (hook → server handoff)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buddy-pending-'));
  const file = join(dir, 'pending-events.jsonl');

  it('appends and consumes events, clearing the file', () => {
    appendPendingEvent(file, { type: 'commit', ts: 1000 });
    appendPendingEvent(file, { type: 'deploy', ts: 2000 });
    const events = consumePendingEvents(file);
    expect(events).toEqual([
      { type: 'commit', ts: 1000 },
      { type: 'deploy', ts: 2000 },
    ]);
    expect(consumePendingEvents(file)).toEqual([]); // consumed
  });

  it('tolerates corrupt lines and missing files', () => {
    expect(consumePendingEvents(join(dir, 'nope.jsonl'))).toEqual([]);
    appendPendingEvent(file, { type: 'commit', ts: 3000 });
    require('node:fs').appendFileSync(file, 'not json\n');
    expect(consumePendingEvents(file)).toEqual([{ type: 'commit', ts: 3000 }]);
  });
});

describe('reward table and blessing', () => {
  it('boosts skilled events so level 50 is reachable', () => {
    expect(XP_REWARDS.observe).toBe(8);
    expect(XP_REWARDS.session).toBe(5);
    expect(XP_REWARDS.commit).toBe(25);
    expect(XP_REWARDS.tests_passed).toBe(20);
    expect(XP_REWARDS.bug_fix).toBe(35);
    expect(XP_REWARDS.deploy).toBe(60);
  });

  it('applyBlessing grants +10% rounded, only when blessed', () => {
    expect(applyBlessing(60, true)).toBe(66);
    expect(applyBlessing(8, true)).toBe(9);
    expect(applyBlessing(60, false)).toBe(60);
  });
});

describe('currentStreakDays', () => {
  const DAY = 86_400_000;
  const now = 1_800_000_000_000;

  it('counts consecutive days with activity ending today', () => {
    const days = [now, now - DAY, now - 2 * DAY];
    expect(currentStreakDays(days, now)).toBe(3);
  });

  it('breaks on a gap', () => {
    const days = [now, now - DAY, now - 3 * DAY];
    expect(currentStreakDays(days, now)).toBe(2);
  });

  it('counts yesterday-ending streaks (grace until today is played)', () => {
    const days = [now - DAY, now - 2 * DAY];
    expect(currentStreakDays(days, now)).toBe(2);
  });

  it('returns 0 for stale activity', () => {
    expect(currentStreakDays([now - 3 * DAY], now)).toBe(0);
    expect(currentStreakDays([], now)).toBe(0);
  });
});

describe('hook ground-truth recording', () => {
  it('queues a pending commit event from a real PostToolUse payload', async () => {
    const { recordGroundTruthEvent } = await import('../hooks/post-tool-handler.js');
    const dir = mkdtempSync(join(tmpdir(), 'buddy-hook-'));
    const file = join(dir, 'pending.jsonl');
    const event = recordGroundTruthEvent(
      { tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: x"' }, tool_response: '1 file changed' },
      file
    );
    expect(event).toBe('commit');
    const queued = consumePendingEvents(file);
    expect(queued).toHaveLength(1);
    expect(queued[0].type).toBe('commit');
  });

  it('records nothing for failing or mundane commands', async () => {
    const { recordGroundTruthEvent } = await import('../hooks/post-tool-handler.js');
    const dir = mkdtempSync(join(tmpdir(), 'buddy-hook2-'));
    const file = join(dir, 'pending.jsonl');
    expect(
      recordGroundTruthEvent(
        { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, tool_response: 'Error: nothing to commit' },
        file
      )
    ).toBeNull();
    expect(recordGroundTruthEvent({ tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: '' }, file)).toBeNull();
    expect(consumePendingEvents(file)).toEqual([]);
  });
});

describe('hook payloads matching the DOCUMENTED Claude Code schema', () => {
  // Verified against https://code.claude.com/docs/en/hooks.md:
  // tool_response is an OBJECT ({type, text} on success; {type:'error',
  // error, stdout, stderr} on failure), and NO exit-code field exists.
  it('extracts output from the object-shaped tool_response', async () => {
    const { recordGroundTruthEvent } = await import('../hooks/post-tool-handler.js');
    const dir = mkdtempSync(join(tmpdir(), 'buddy-hook3-'));
    const file = join(dir, 'pending.jsonl');
    const event = recordGroundTruthEvent(
      {
        tool_name: 'Bash',
        tool_input: { command: 'npx vitest run' },
        tool_response: { type: 'text', text: 'Tests  12 passed (12)' },
      } as never,
      file
    );
    expect(event).toBe('tests_passed');
  });

  it('suppresses awards when the object response carries an error', async () => {
    const { recordGroundTruthEvent } = await import('../hooks/post-tool-handler.js');
    const dir = mkdtempSync(join(tmpdir(), 'buddy-hook4-'));
    const file = join(dir, 'pending.jsonl');
    const event = recordGroundTruthEvent(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m x' },
        tool_response: { type: 'error', error: 'Command failed with exit code 1', stderr: 'nothing to commit' },
      } as never,
      file
    );
    expect(event).toBeNull();
    expect(consumePendingEvents(file)).toEqual([]);
  });
});
