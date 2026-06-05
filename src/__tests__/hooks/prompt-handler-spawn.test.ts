// Integration test: spawn the COMPILED hook as a real process. The in-process
// tests inject db/emit; this one exercises the real process boundary — stdin
// parse, env-derived paths, the dynamic imports resolving in dist/, native
// sqlite load, and the never-crash / never-block invariant (hooks must always
// exit 0). Requires `npm run build` (dist/) first.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const HOOK = join(process.cwd(), 'dist', 'hooks', 'prompt-handler.js');

type Run = { code: number; out: string };
function run(home: string, stdin: string): Run {
  try {
    const out = execFileSync('node', [HOOK], {
      input: stdin,
      env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude') },
      encoding: 'utf-8',
      timeout: 10_000,
    });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: e.stdout ?? '' };
  }
}

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'buddy-hook-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.buddy'), { recursive: true });
  return home;
}

describe('prompt-handler hook (spawned compiled process)', () => {
  const built = existsSync(HOOK);

  it.runIf(built)('never crashes on garbage stdin (exit 0)', () => {
    const home = freshHome();
    try {
      expect(run(home, 'definitely not json').code).toBe(0);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it.runIf(built)('emits nothing when guard mode is off (status pre-check, no DB)', () => {
    const home = freshHome();
    writeFileSync(join(home, '.claude', 'buddy-status.json'),
      JSON.stringify({ name: 'b', guard_mode: 0, mood: 'happy' }));
    try {
      const r = run(home, JSON.stringify({ prompt: 'hi', cwd: home }));
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe('');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  it.runIf(built)('guard on but no companion: opens DB, resolves imports, exits 0 with no emit', () => {
    // Exercises the real dynamic imports (db/schema + reasoning/index), initDb,
    // and native sqlite load — the seams the in-process tests can't reach.
    const home = freshHome();
    writeFileSync(join(home, '.claude', 'buddy-status.json'),
      JSON.stringify({ name: 'b', guard_mode: 1, mood: 'happy' }));
    try {
      const r = run(home, JSON.stringify({ prompt: 'hi', cwd: home }));
      expect(r.code).toBe(0);
      expect(r.out.trim()).toBe('');
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  if (!built) {
    it('dist not built — run `npm run build` to enable spawn tests', () => {
      expect(built).toBe(false); // visible skip marker
    });
  }
});
