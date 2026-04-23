import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveProjectRoot, resetProjectRootMemo } from '../../lib/reasoning/project-root.js';

// Work in an isolated tmp tree per test so we can stage marker files
// without touching anything real.

let tmpRoot: string;
const ENV_VARS_TO_CLEAR = [
  'CLAUDE_PROJECT_DIR', 'CLAUDE_CWD', 'BUDDY_PROJECT_ROOT',
  'VSCODE_CWD', 'WORKSPACE_FOLDER', 'PROJECT_ROOT', 'INIT_CWD',
];
const savedEnv: Record<string, string | undefined> = {};
let savedCwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'buddy-project-root-'));
  savedCwd = process.cwd();
  for (const v of ENV_VARS_TO_CLEAR) {
    savedEnv[v] = process.env[v];
    delete process.env[v];
  }
  resetProjectRootMemo();
});

afterEach(() => {
  process.chdir(savedCwd);
  for (const v of ENV_VARS_TO_CLEAR) {
    if (savedEnv[v] === undefined) delete process.env[v];
    else process.env[v] = savedEnv[v];
  }
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('resolveProjectRoot', () => {
  it('prefers an explicit hint when the path is an absolute, existing dir', () => {
    const r = resolveProjectRoot(tmpRoot);
    expect(r.source).toBe('hint');
    expect(r.path).toBe(tmpRoot);
  });

  it('ignores a hint that is not an absolute path', () => {
    process.chdir(tmpRoot);
    const r = resolveProjectRoot('relative/path');
    expect(r.source).not.toBe('hint');
  });

  it('trusts an absolute-path hint even if the dir does not exist', () => {
    // A hint is an explicit caller signal — we use it for session-id
    // hashing regardless of whether the dir is live. (Validating it
    // would mean silently ignoring the caller's intent on test setups
    // and any ephemeral workspace.)
    const r = resolveProjectRoot('/no/such/path/hopefully');
    expect(r.source).toBe('hint');
    expect(r.path).toBe('/no/such/path/hopefully');
  });

  it('picks up CLAUDE_PROJECT_DIR when no hint', () => {
    process.env.CLAUDE_PROJECT_DIR = tmpRoot;
    const r = resolveProjectRoot(undefined);
    expect(r.source).toBe('env');
    expect(r.envVar).toBe('CLAUDE_PROJECT_DIR');
    expect(r.path).toBe(tmpRoot);
  });

  it('CLAUDE_PROJECT_DIR beats VSCODE_CWD in priority order', () => {
    const a = mkdtempSync(join(tmpdir(), 'proj-a-'));
    const b = mkdtempSync(join(tmpdir(), 'proj-b-'));
    try {
      process.env.CLAUDE_PROJECT_DIR = a;
      process.env.VSCODE_CWD = b;
      const r = resolveProjectRoot(undefined);
      expect(r.envVar).toBe('CLAUDE_PROJECT_DIR');
      expect(r.path).toBe(a);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  it('walks up from cwd and stops at the first marker', () => {
    // tmpRoot/proj/.git, tmpRoot/proj/src/deep/here
    const proj = join(tmpRoot, 'proj');
    const deep = join(proj, 'src', 'deep', 'here');
    mkdirSync(deep, { recursive: true });
    mkdirSync(join(proj, '.git'));
    process.chdir(deep);
    const r = resolveProjectRoot(undefined);
    expect(r.source).toBe('marker');
    expect(r.markerFound).toBe('.git');
    expect(r.path).toBe(proj);
  });

  it('finds package.json as a marker when there is no .git', () => {
    const proj = join(tmpRoot, 'proj2');
    const deep = join(proj, 'lib');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(proj, 'package.json'), '{}');
    process.chdir(deep);
    const r = resolveProjectRoot(undefined);
    expect(r.source).toBe('marker');
    expect(r.markerFound).toBe('package.json');
    expect(r.path).toBe(proj);
  });

  it('.git beats package.json (priority order in the marker list)', () => {
    const proj = join(tmpRoot, 'proj3');
    mkdirSync(proj);
    mkdirSync(join(proj, '.git'));
    writeFileSync(join(proj, 'package.json'), '{}');
    process.chdir(proj);
    const r = resolveProjectRoot(undefined);
    expect(r.markerFound).toBe('.git');
  });

  it('ignores an invalid env var path and keeps looking', () => {
    process.env.CLAUDE_PROJECT_DIR = '/no/such/dir';
    const proj = join(tmpRoot, 'proj-fallback');
    mkdirSync(proj);
    writeFileSync(join(proj, 'package.json'), '{}');
    process.chdir(proj);
    const r = resolveProjectRoot(undefined);
    expect(r.source).toBe('marker');
  });

  it('falls back to cwd when no hint, env, or marker found', () => {
    // An isolated dir with no markers anywhere in the tree (tmpdir usually
    // doesn't have ancestor markers, but to be safe we cd somewhere with
    // a known null chain).
    process.chdir(tmpRoot);
    const r = resolveProjectRoot(undefined);
    // Could resolve to 'marker' if tmpdir happens to be inside a git tree,
    // or 'cwd'/'homedir' otherwise. Either way it's NOT 'hint' or 'env'.
    expect(['marker', 'cwd', 'homedir']).toContain(r.source);
  });
});
