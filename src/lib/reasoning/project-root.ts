// src/lib/reasoning/project-root.ts
//
// Close the "cwd reliance" hole. Instead of trusting the host or
// collapsing to process.cwd() blindly, try a prioritized resolution:
//
//   1. explicit hint (what the tool caller passed, if valid)
//   2. common host-set env vars (editor/CLI conventions)
//   3. walk up from process.cwd() looking for project markers
//      (.git, package.json, pyproject.toml, Cargo.toml, go.mod, etc.)
//   4. fall back to process.cwd() only if nothing better found
//
// Returns both the resolved path AND the source — so the doctor can
// flag when we're on the last-resort fallback and the user is
// probably getting mixed workspaces.

import { existsSync, statSync } from 'fs';
import { dirname, resolve, isAbsolute } from 'path';
import { homedir } from 'os';

export type RootSource =
  | 'hint'              // explicit argument from the tool caller
  | 'env'               // picked up from a recognized env var
  | 'marker'            // walked up and found a project marker
  | 'cwd'               // plain process.cwd(), nothing better
  | 'homedir';          // fallback when even cwd is homedir (flagged)

export type ResolvedRoot = {
  path: string;
  source: RootSource;
  envVar?: string;      // which env var supplied it, if source==='env'
  markerFound?: string; // which marker stopped the walk, if source==='marker'
};

// Env vars worth checking, in priority order. Roughly: editor-specific,
// then Claude-specific, then generic.
const ENV_CANDIDATES = [
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_CWD',
  'BUDDY_PROJECT_ROOT',
  'VSCODE_CWD',
  'WORKSPACE_FOLDER',
  'PROJECT_ROOT',
  'INIT_CWD',          // npm sets this to the directory `npm` was invoked in
];

// Files/dirs that mark a project root, in priority order. Presence of
// any one stops the upward walk.
const MARKERS = [
  '.git',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Gemfile',
  'composer.json',
  'mix.exs',
  'pubspec.yaml',
  '.project',
  'buddy.config.json',
];

function isDir(p: string): boolean {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function isValidAbsolutePath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && isAbsolute(p) && isDir(p);
}

function findMarker(start: string): { root: string; marker: string } | null {
  let dir = resolve(start);
  const visited = new Set<string>();
  while (dir && !visited.has(dir)) {
    visited.add(dir);
    for (const m of MARKERS) {
      if (existsSync(resolve(dir, m))) return { root: dir, marker: m };
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

// Per-process memo. The hot-path resolver is called on every buddy_observe
// when insight mode is on, and in the common case the answer doesn't change
// between calls (same cwd, same env, same marker tree). The memo is keyed
// by the inputs that would change an answer; any mismatch falls through
// to fresh resolution.
type MemoEntry = { hint: string | null | undefined; cwd: string; env: string; result: ResolvedRoot };
let memo: MemoEntry | null = null;

function envFingerprint(): string {
  return ENV_CANDIDATES.map(k => `${k}=${process.env[k] ?? ''}`).join('|');
}

export function resolveProjectRoot(hint?: string | null): ResolvedRoot {
  const cwd = process.cwd();
  const env = envFingerprint();
  if (memo && memo.hint === hint && memo.cwd === cwd && memo.env === env) {
    return memo.result;
  }
  const result = resolveProjectRootUncached(hint, cwd);
  memo = { hint, cwd, env, result };
  return result;
}

/** Test helper. */
export function resetProjectRootMemo(): void {
  memo = null;
}

function resolveProjectRootUncached(hint: string | null | undefined, cwd: string): ResolvedRoot {
  // 1. Explicit hint. We trust an absolute-path string even if the dir
  //    doesn't exist on disk — session_id is a hash, it doesn't need a
  //    real dir, and callers who typed a path deserve to be believed.
  //    Relative/empty/non-string hints are ignored and we fall through.
  if (typeof hint === 'string' && hint.length > 0 && isAbsolute(hint)) {
    return { path: hint, source: 'hint' };
  }

  // 2. Env vars.
  for (const envVar of ENV_CANDIDATES) {
    const v = process.env[envVar];
    if (isValidAbsolutePath(v)) {
      return { path: v, source: 'env', envVar };
    }
  }

  // 3. Walk up from cwd looking for a project marker.
  const found = findMarker(cwd);
  if (found) {
    return { path: found.root, source: 'marker', markerFound: found.marker };
  }

  // 4. Last-resort fallback. Flag it explicitly when cwd is the homedir
  // (a common bad state when the server was launched from `~`).
  const home = homedir();
  if (cwd === home) {
    return { path: cwd, source: 'homedir' };
  }
  return { path: cwd, source: 'cwd' };
}
