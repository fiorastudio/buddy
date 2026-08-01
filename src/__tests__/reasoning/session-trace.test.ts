// These tests build a fixture home and point resolveSessionTrace at it.
//
// They used to run against the developer's real ~/.claude. That made the
// result a function of whose machine ran the suite: on a runner with no
// transcript history it passed in milliseconds, and on a working machine it
// read every transcript in full — 8.5 GB across 646 files here — blocking the
// vitest worker synchronously so the timeout could not even fire. The suite
// looked like it hung with no failing test to point at. A test that reads
// ambient state outside the repo can only ever be as trustworthy as the
// machine it ran on.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { deriveSessionId } from '../../lib/reasoning/session.js';
import { resolveSessionTrace } from '../../lib/reasoning/session-trace.js';

const CLAUDE_CWD = '/fixture/workspace/claude-project';
const CODEX_CWD = '/fixture/workspace/codex-project';

// Mirrors hashCwd in session-trace.ts. Duplicated on purpose: if the id
// derivation ever changes, this fixture should stop matching and fail loudly
// rather than silently follow the implementation.
const hashCwd = (cwd: string) => createHash('sha256').update(cwd).digest('hex').slice(0, 16);

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'buddy-trace-fixture-'));

  const projects = join(home, '.claude', 'projects', 'fixture-project');
  mkdirSync(projects, { recursive: true });
  writeFileSync(
    join(projects, 'session.jsonl'),
    [
      JSON.stringify({ cwd: CLAUDE_CWD, type: 'summary' }),
      JSON.stringify({ type: 'user', message: 'ignored — only the first record is read' }),
    ].join('\n') + '\n',
  );

  // Decoy: a transcript for a different cwd must not match.
  writeFileSync(
    join(projects, 'other.jsonl'),
    JSON.stringify({ cwd: '/fixture/workspace/somewhere-else' }) + '\n',
  );

  const codex = join(home, '.codex', 'sessions', '2026', '07', '20');
  mkdirSync(codex, { recursive: true });
  writeFileSync(
    join(codex, 'rollout.jsonl'),
    [
      JSON.stringify({ type: 'other', payload: { note: 'no cwd here' } }),
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-abc123', cwd: CODEX_CWD } }),
    ].join('\n') + '\n',
  );
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('resolveSessionTrace', () => {
  it('parses session id shape even when no metadata file is found', () => {
    const trace = resolveSessionTrace('0123456789abcdef-20260512', { home });
    expect(trace.sessionId).toBe('0123456789abcdef-20260512');
    expect(trace.cwdHash).toBe('0123456789abcdef');
    expect(trace.dateBucket).toBe('20260512');
    expect(trace.source).toBeUndefined();
    expect(trace.cwd).toBeUndefined();
  });

  it('returns empty hash and bucket for a malformed session id', () => {
    const trace = resolveSessionTrace('not-a-session-id', { home });
    expect(trace.cwdHash).toBe('');
    expect(trace.dateBucket).toBe('');
  });

  it('resolves a workspace from a Claude transcript', () => {
    const sessionId = deriveSessionId(CLAUDE_CWD, Date.UTC(2026, 4, 12, 12, 0, 0));
    const trace = resolveSessionTrace(sessionId, { home });

    expect(trace.cwdHash).toBe(hashCwd(CLAUDE_CWD));
    expect(trace.source).toBe('claude');
    expect(trace.cwd).toBe(CLAUDE_CWD);
    expect(trace.projectLabel).toBe('workspace/claude-project');
    expect(trace.claudeSessionFile).toContain('session.jsonl');
  });

  it('falls through to Codex metadata when no Claude transcript matches', () => {
    const sessionId = deriveSessionId(CODEX_CWD, Date.UTC(2026, 4, 12, 12, 0, 0));
    const trace = resolveSessionTrace(sessionId, { home });

    expect(trace.source).toBe('codex');
    expect(trace.cwd).toBe(CODEX_CWD);
    expect(trace.codexSessionId).toBe('codex-abc123');
    expect(trace.codexSessionFile).toContain('.codex/sessions');
  });

  it('does not match a transcript belonging to a different cwd', () => {
    const sessionId = deriveSessionId('/fixture/workspace/never-recorded', Date.UTC(2026, 4, 12));
    const trace = resolveSessionTrace(sessionId, { home });
    expect(trace.source).toBeUndefined();
    expect(trace.cwd).toBeUndefined();
  });

  it('matches on the first record without depending on the rest of the file', () => {
    // The tail is deliberately larger than the read bound and deliberately
    // unparseable. Resolution must still succeed from the first record, and
    // must not choke on content it never needed to look at.
    //
    // Note this asserts correctness under truncation, NOT that reads are
    // bounded — a few megabytes is cheap to read whole, so no timing
    // assertion here could tell the two implementations apart. The bound is
    // a performance property, and it is not honestly testable at a file size
    // that belongs in a unit test.
    const big = join(home, '.claude', 'projects', 'fixture-project', 'huge.jsonl');
    const bigCwd = '/fixture/workspace/big-transcript';
    writeFileSync(
      big,
      JSON.stringify({ cwd: bigCwd }) + '\n' + 'not json at all '.repeat(8 * 1024) + '\n',
    );

    const trace = resolveSessionTrace(deriveSessionId(bigCwd, Date.UTC(2026, 4, 12)), { home });
    expect(trace.cwd).toBe(bigCwd);
    expect(trace.source).toBe('claude');
    rmSync(big, { force: true });
  });
});
