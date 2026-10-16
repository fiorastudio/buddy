import { describe, it, expect, beforeEach, vi } from 'vitest';

// X13: loadCompanion() re-rolls a rescued buddy's bones on every observe, pet
// and status call, and every roll spawned a `bun` process to hash the userId.
// The Bun hash is now cached per input. A fake `bun` stands in so the test
// runs the same with or without Bun installed.
const calls = vi.hoisted(() => ({ hash: 0, version: 0, stdout: '123456789' as string }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn((cmd: string, args: string[]) => {
      if (cmd !== 'bun') return actual.spawnSync(cmd, args);
      if (args[0] === '--version') {
        calls.version++;
        return { status: 0, stdout: '1.1.0', stderr: '' };
      }
      calls.hash++;
      return { status: 0, stdout: `${calls.stdout}\n`, stderr: '' };
    }),
  };
});

const { rollWithCCCompat, _resetCcHashCacheForTests } = await import('../lib/oldBuddy.js');

beforeEach(() => {
  _resetCcHashCacheForTests();
  calls.hash = 0;
  calls.version = 0;
  calls.stdout = '123456789';
});

describe('rollWithCCCompat Bun-hash cache (X13)', () => {
  it('spawns bun once per userId, not once per roll', () => {
    const a = rollWithCCCompat('cached-user');
    const b = rollWithCCCompat('cached-user');
    const c = rollWithCCCompat('cached-user');
    expect(a.engine).toBe('bun');
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(calls.version).toBe(1);
    expect(calls.hash).toBe(1);

    rollWithCCCompat('other-user');
    expect(calls.hash).toBe(2);
  });

  it('returns independent objects, so a caller mutating bones cannot poison the cache', () => {
    const a = rollWithCCCompat('mutating-user');
    a.bones.species = 'mutated';
    a.bones.stats.WISDOM = -1;
    const b = rollWithCCCompat('mutating-user');
    expect(b.bones.species).not.toBe('mutated');
    expect(b.bones.stats.WISDOM).not.toBe(-1);
  });

  it('does not cache a failed Bun hash; the next roll retries Bun', () => {
    calls.stdout = '';
    expect(rollWithCCCompat('flaky-user').engine).toBe('fnv1a');
    calls.stdout = '987654321';
    expect(rollWithCCCompat('flaky-user').engine).toBe('bun');
    expect(calls.hash).toBe(2);
  });
});
