import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { initDb } from '../db/schema.js';
import { SELF_REPORT_DAILY_CAP } from '../lib/xp-classify.js';

/**
 * X5(b): the award gates (daily self-report cap, cross-session hook dedupe,
 * 7-day streak milestone) are only safe because the whole award runs in one
 * BEGIN IMMEDIATE transaction. Two Claude Code sessions are two MCP server
 * PROCESSES on one buddy.db, so this spawns real Node processes that run the
 * real awardWithGates() against one temp WAL file, released together, and
 * checks nothing is paid twice.
 *
 * Child processes can't load TypeScript on every supported Node (20 has no
 * type stripping), so the test transpiles lib/award.ts and its relative
 * imports with the TypeScript compiler into a scratch dir under
 * node_modules/.cache (so `better-sqlite3` resolves from the repo).
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(SRC, '..');
const PROCS = 4;

let work: string;   // transpiled modules + child script
let dbDir: string;  // temp DB files
let child: string;

/** Transpile `entry` and every module it imports relatively into `outDir`, mirroring src/. */
function transpileClosure(entry: string, outDir: string): void {
  const seen = new Set<string>();
  const queue = [entry];
  const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)\.js['"]|import\(\s*['"](\.{1,2}\/[^'"]+)\.js['"]\s*\)/g;
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf-8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
    });
    const out = join(outDir, relative(SRC, file)).replace(/\.ts$/, '.js');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, outputText);
    for (const m of source.matchAll(IMPORT)) {
      const dep = resolve(dirname(file), `${m[1] ?? m[2]}.ts`);
      if (existsSync(dep)) queue.push(dep);
    }
  }
}

// The child: open the shared DB like the server does, report ready, wait for
// "go" on stdin so every process starts its awards together, then award.
const CHILD = `
import Database from 'better-sqlite3';
import { awardWithGates } from './lib/award.js';
const [file, companionId, selfType, rounds] = process.argv.slice(2);
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');
process.stdout.write('ready\\n');
process.stdin.once('data', () => {
  const results = [];
  try {
    for (let i = 0; i < Number(rounds); i++) {
      results.push(awardWithGates(db, companionId, selfType, []).worldEvents);
    }
    process.stdout.write(JSON.stringify({ ok: true, results }) + '\\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(err && err.stack || err) }) + '\\n');
  }
  db.close();
  process.exit(0);
});
`;

beforeAll(() => {
  const cacheRoot = join(REPO, 'node_modules', '.cache');
  mkdirSync(cacheRoot, { recursive: true });
  work = mkdtempSync(join(cacheRoot, 'buddy-award-race-'));
  // Emitted .js files are ES modules.
  writeFileSync(join(work, 'package.json'), JSON.stringify({ type: 'module' }));
  transpileClosure(join(SRC, 'lib', 'award.ts'), work);
  child = join(work, 'award-child.js');
  writeFileSync(child, CHILD);
  dbDir = mkdtempSync(join(tmpdir(), 'buddy-award-race-'));
}, 60_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
  if (dbDir) rmSync(dbDir, { recursive: true, force: true });
});

type ChildResult = { ok: boolean; results?: string[][]; error?: string };

/** Spawn PROCS children, release them together, collect their results. */
async function race(file: string, companionId: string, selfType: string, rounds: number): Promise<ChildResult[]> {
  const procs = Array.from({ length: PROCS }, () =>
    spawn(process.execPath, [child, file, companionId, selfType, String(rounds)], {
      cwd: work,
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
  const outputs = procs.map((p) => {
    let out = '';
    let err = '';
    p.stdout.setEncoding('utf-8').on('data', (d: string) => { out += d; });
    p.stderr.setEncoding('utf-8').on('data', (d: string) => { err += d; });
    const ready = new Promise<void>((res, rej) => {
      const check = () => { if (out.includes('ready\n')) res(); };
      p.stdout.on('data', check);
      p.on('exit', (code) => rej(new Error(`child exited ${code} before ready: ${err}`)));
    });
    const done = new Promise<ChildResult>((res, rej) => {
      p.on('exit', () => {
        const line = out.split('\n').find((l) => l.startsWith('{'));
        if (line) res(JSON.parse(line));
        else rej(new Error(`child produced no result: ${err}`));
      });
    });
    return { ready, done };
  });
  await Promise.all(outputs.map((o) => o.ready));
  for (const p of procs) p.stdin.end('go\n');
  return Promise.all(outputs.map((o) => o.done));
}

function freshDb(name: string, seed: (conn: Database.Database) => void): string {
  const file = join(dbDir, `${name}.db`);
  const conn = new Database(file);
  conn.pragma('journal_mode = WAL');
  initDb(conn);
  conn.prepare("INSERT INTO companions (id, name, species) VALUES ('c', 'Racer', 'Duck')").run();
  seed(conn);
  conn.close();
  return file;
}

function ledgerInvariant(file: string) {
  const conn = new Database(file, { readonly: true });
  try {
    const xp = (conn.prepare("SELECT xp FROM companions WHERE id = 'c'").get() as { xp: number }).xp;
    const sum = (conn.prepare("SELECT COALESCE(SUM(xp_gained), 0) AS s FROM xp_events WHERE companion_id = 'c'").get() as { s: number }).s;
    return { xp, sum };
  } finally {
    conn.close();
  }
}

function query<T>(file: string, sql: string): T {
  const conn = new Database(file, { readonly: true });
  try { return conn.prepare(sql).get() as T; } finally { conn.close(); }
}

describe('award gates hold across real concurrent processes (X5)', () => {
  it('pays the 7-day streak milestone exactly once', async () => {
    // Activity on each of the previous 6 UTC days, none today: the first
    // award today makes a 7-day streak. Every process races to be "first".
    const file = freshDb('streak', (conn) => {
      const ins = conn.prepare(
        "INSERT INTO xp_events (id, companion_id, event_type, xp_gained, created_at) VALUES (?, 'c', 'observe', 0, datetime('now', 'start of day', ?, '+12 hours'))"
      );
      for (let d = 1; d <= 6; d++) ins.run(`past-${d}`, `-${d} days`);
    });

    const results = await race(file, 'c', 'observe', 3);
    for (const r of results) expect(r.ok, r.error).toBe(true);

    const streaks = results.flatMap((r) => r.results!).filter((ev) => ev.includes('streak_7'));
    expect(streaks).toHaveLength(1);
    expect(query<{ n: number }>(file, "SELECT COUNT(*) AS n FROM xp_events WHERE event_type = 'streak_7'").n).toBe(1);
    const { xp, sum } = ledgerInvariant(file);
    expect(xp).toBe(sum);
  }, 60_000);

  it('folds a self-report into one hook-verified event only once', async () => {
    // Another session's observe already consumed (and paid) one real commit.
    // Every process now self-reports "commit": exactly one may be folded
    // into that hook row; the rest are ordinary self-reports.
    const file = freshDb('dedupe', (conn) => {
      conn.prepare(
        "INSERT INTO xp_events (id, companion_id, event_type, xp_gained, source) VALUES ('hook-1', 'c', 'commit', 0, 'hook')"
      ).run();
    });

    const results = await race(file, 'c', 'commit', 1);
    for (const r of results) expect(r.ok, r.error).toBe(true);

    expect(query<{ n: number }>(file, "SELECT COUNT(*) AS n FROM xp_events WHERE dedupe_of = 'hook-1'").n).toBe(1);
    const { xp, sum } = ledgerInvariant(file);
    expect(xp).toBe(sum);
  }, 60_000);

  it('never lets concurrent self-reports exceed the daily cap', async () => {
    const file = freshDb('cap', () => {});
    const rounds = SELF_REPORT_DAILY_CAP; // PROCS x cap attempts, cap allowed
    const results = await race(file, 'c', 'bug_fix', rounds);
    for (const r of results) expect(r.ok, r.error).toBe(true);

    const elevated = query<{ n: number }>(file,
      "SELECT COUNT(*) AS n FROM xp_events WHERE event_type = 'bug_fix' AND source = 'self'").n;
    expect(elevated).toBe(SELF_REPORT_DAILY_CAP);
    const total = query<{ n: number }>(file, "SELECT COUNT(*) AS n FROM xp_events WHERE source = 'self'").n;
    expect(total).toBe(PROCS * rounds);
    const { xp, sum } = ledgerInvariant(file);
    expect(xp).toBe(sum);
  }, 60_000);
});
