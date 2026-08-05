import { describe, it, expect, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The lost-update race in #161 only manifests across *real* concurrent
 * connections — several Claude Code sessions, each its own MCP server process,
 * all writing the same ~/.buddy/buddy.db. The in-memory tests in
 * xp-atomicity.test.ts simulate the interleaving on one connection; this one
 * reproduces the genuine article with worker threads, each opening its own
 * better-sqlite3 connection to a shared WAL file and hammering the exact
 * strategy the fix landed: one IMMEDIATE transaction per award with a
 * self-referential `UPDATE ... SET xp = xp + ?, zeny = zeny + ?`.
 *
 * The invariant `companions.xp == sum(xp_events.xp_gained)` must hold no matter
 * how the writers interleave. Under the old read-modify-write it would not.
 */

const REWARD = 5;
const ZENY_PER = 1;
const WORKERS = 8;
const AWARDS_PER_WORKER = 40;
const CID = 'parallel-companion';

// Mirrors the server award: WAL + busy_timeout=5000, then each award is its own
// BEGIN IMMEDIATE transaction so contending writers serialize on the write lock
// rather than losing an update or deadlocking on a lock upgrade.
const workerSource = `
const { workerData, parentPort } = require('node:worker_threads');
const Database = require('better-sqlite3');
const db = new Database(workerData.file);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
const insert = db.prepare("INSERT INTO xp_events (id, companion_id, event_type, xp_gained) VALUES (?, ?, 'observe', ?)");
const bump = db.prepare('UPDATE companions SET xp = xp + ?, zeny = zeny + ? WHERE id = ?');
const award = db.transaction((seq) => {
  insert.run(workerData.wid + '-' + seq, workerData.cid, ${REWARD});
  bump.run(${REWARD}, ${ZENY_PER}, workerData.cid);
});
try {
  for (let i = 0; i < workerData.n; i++) award.immediate(i);
  db.close();
  parentPort.postMessage({ ok: true });
} catch (err) {
  db.close();
  parentPort.postMessage({ ok: false, error: String(err) });
}
`;

function runWorker(file: string, wid: number, n: number): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerSource, { eval: true, workerData: { file, wid, cid: CID, n } });
    w.on('message', resolve);
    w.on('error', reject);
    w.on('exit', (code) => { if (code !== 0) reject(new Error(`worker exited with ${code}`)); });
  });
}

const dir = mkdtempSync(join(tmpdir(), 'buddy-xp-parallel-'));
const file = join(dir, 'buddy.db');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('XP award atomicity under real parallel connections', () => {
  it('keeps companions.xp == sum(xp_events) after parallel interleaved awards', async () => {
    const setup = new Database(file);
    setup.pragma('journal_mode = WAL');
    setup.exec(`
      CREATE TABLE companions (
        id TEXT PRIMARY KEY, name TEXT, species TEXT,
        level INTEGER DEFAULT 1, xp INTEGER DEFAULT 0, zeny INTEGER DEFAULT 0, mood TEXT
      );
      CREATE TABLE xp_events (
        id TEXT PRIMARY KEY, companion_id TEXT, event_type TEXT, xp_gained INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    setup.prepare("INSERT INTO companions (id, name, species) VALUES (?, 'Racer', 'Owl')").run(CID);
    setup.close();

    const results = await Promise.all(
      Array.from({ length: WORKERS }, (_, wid) => runWorker(file, wid, AWARDS_PER_WORKER)),
    );
    for (const r of results) expect(r).toEqual({ ok: true });

    const read = new Database(file, { readonly: true });
    const total = WORKERS * AWARDS_PER_WORKER;
    const xp = (read.prepare('SELECT xp FROM companions WHERE id = ?').get(CID) as { xp: number }).xp;
    const zeny = (read.prepare('SELECT zeny FROM companions WHERE id = ?').get(CID) as { zeny: number }).zeny;
    const sum = (read.prepare('SELECT COALESCE(sum(xp_gained), 0) AS s FROM xp_events WHERE companion_id = ?').get(CID) as { s: number }).s;
    const events = (read.prepare('SELECT count(*) AS n FROM xp_events WHERE companion_id = ?').get(CID) as { n: number }).n;
    read.close();

    // Every append-only ledger row landed — no INSERT was lost.
    expect(events).toBe(total);
    // No award was clobbered: the denormalized column equals the ledger sum...
    expect(xp).toBe(sum);
    // ...and both equal the expected grand total.
    expect(xp).toBe(total * REWARD);
    // zeny is bumped in the same atomic statement, so it can't drift either.
    expect(zeny).toBe(total * ZENY_PER);
  });
});
