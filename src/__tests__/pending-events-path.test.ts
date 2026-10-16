import { describe, it, expect, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The PostToolUse hook queues ground-truth events (commit / tests_passed /
 * deploy) in pending-events.jsonl. Its default path used to be built from the
 * home dir alone, ignoring BUDDY_DB_PATH, so a test that ran the hook handler
 * on a successful commit appended to the developer's real
 * ~/.buddy/pending-events.jsonl, and their next buddy_observe paid it out.
 */

const realQueue = join(homedir(), '.buddy', 'pending-events.jsonl');
const saved = { db: process.env.BUDDY_DB_PATH, queue: process.env.BUDDY_PENDING_EVENTS_PATH };
const dirs: string[] = [];

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnv('BUDDY_DB_PATH', saved.db);
  restoreEnv('BUDDY_PENDING_EVENTS_PATH', saved.queue);
  vi.resetModules();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Re-evaluate constants.ts / pending-events.ts under the current env. */
async function freshPaths() {
  vi.resetModules();
  const constants = await import('../lib/constants.js');
  const pending = await import('../lib/pending-events.js');
  return { constants, pending };
}

describe('pending-events queue path', () => {
  it('is isolated from the real ~/.buddy under vitest', async () => {
    const { pending } = await freshPaths();
    expect(process.env.BUDDY_PENDING_EVENTS_PATH).toBeTruthy();
    expect(resolve(pending.DEFAULT_PENDING_EVENTS_PATH)).toBe(resolve(process.env.BUDDY_PENDING_EVENTS_PATH!));
    expect(resolve(pending.DEFAULT_PENDING_EVENTS_PATH)).not.toBe(resolve(realQueue));
  });

  it('follows a BUDDY_DB_PATH override when no explicit queue path is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'buddy-queue-'));
    dirs.push(dir);
    process.env.BUDDY_DB_PATH = join(dir, 'custom.db');
    delete process.env.BUDDY_PENDING_EVENTS_PATH;
    const { constants, pending } = await freshPaths();
    expect(constants.BUDDY_DB_PATH).toBe(join(dir, 'custom.db'));
    expect(pending.DEFAULT_PENDING_EVENTS_PATH).toBe(join(dir, 'pending-events.jsonl'));
  });

  it('BUDDY_PENDING_EVENTS_PATH wins over the DB directory', async () => {
    process.env.BUDDY_DB_PATH = join(tmpdir(), 'somewhere', 'buddy.db');
    process.env.BUDDY_PENDING_EVENTS_PATH = join(tmpdir(), 'elsewhere', 'queue.jsonl');
    const { pending } = await freshPaths();
    expect(pending.DEFAULT_PENDING_EVENTS_PATH).toBe(join(tmpdir(), 'elsewhere', 'queue.jsonl'));
  });

  it('defaults to ~/.buddy when neither override is set', async () => {
    delete process.env.BUDDY_DB_PATH;
    delete process.env.BUDDY_PENDING_EVENTS_PATH;
    const { constants, pending } = await freshPaths();
    expect(constants.BUDDY_DB_PATH).toBe(join(homedir(), '.buddy', 'buddy.db'));
    expect(pending.DEFAULT_PENDING_EVENTS_PATH).toBe(realQueue);
  });

  it('handlePostToolUse on a successful commit queues to the override, not the real file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'buddy-queue-'));
    dirs.push(dir);
    const queue = join(dir, 'pending-events.jsonl');
    process.env.BUDDY_PENDING_EVENTS_PATH = queue;
    const realBefore = existsSync(realQueue) ? statSync(realQueue).size : -1;

    vi.resetModules();
    const { handlePostToolUse } = await import('../hooks/post-tool-handler.js');
    handlePostToolUse(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "add parser"' },
        tool_response: { type: 'text', text: '[main 1a2b3c4] add parser\n 1 file changed, 10 insertions(+)' },
      } as any,
      join(dir, 'buddy-status.json'),
    );

    const lines = readFileSync(queue, 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.map((e) => e.type)).toEqual(['commit']);
    expect(existsSync(realQueue) ? statSync(realQueue).size : -1).toBe(realBefore);
  });
});
