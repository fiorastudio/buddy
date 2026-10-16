import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildWorldSnapshot,
  generateToken,
  loadWorldConfig,
  saveWorldConfig,
  deleteWorldConfig,
  isWorldBlessed,
  WorldSync,
  MAX_QUEUED_EVENTS,
} from '../../lib/world/client.js';
import { MAX_EVENT_BATCH } from '../../lib/world/schema-sql.js';
import { validateSnapshot } from '../../lib/world/validate.js';
import { createWorldFetchHandler } from '../../world/worker-core.js';
import { sqliteAsD1 } from './d1-shim.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import type { Companion } from '../../lib/types.js';

const T0 = 1_800_000_000_000;

function companion(): Companion {
  return {
    name: 'Shadowpaw',
    personalityBio: 'A judgmental shadow.',
    rarity: 'rare',
    species: 'Void Cat',
    eye: '·',
    hat: 'none',
    shiny: false,
    stats: { DEBUGGING: 60, PATIENCE: 40, CHAOS: 80, WISDOM: 30, SNARK: 70 },
    level: 5,
    xp: totalXpForLevel(5) + 3,
    mood: 'happy',
    availablePoints: 0,
    hatchedAt: T0 - 1_000_000,
  };
}

describe('buildWorldSnapshot', () => {
  it('maps a Companion to a snapshot that passes validation', () => {
    const snap = buildWorldSnapshot(companion(), 'chibi-2');
    expect(validateSnapshot(snap)).toEqual({ ok: true, snapshot: snap });
    expect(snap.stats.debugging).toBe(60);
    expect(snap.avatar).toBe('chibi-2');
  });
});

describe('world config persistence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buddy-world-'));
  const file = join(dir, 'world.json');

  it('saves, loads, and deletes the config file', () => {
    expect(loadWorldConfig(file)).toBeNull();
    saveWorldConfig({ token: generateToken(), apiUrl: 'https://api.example.com' }, file);
    const loaded = loadWorldConfig(file);
    expect(loaded?.token).toHaveLength(32);
    deleteWorldConfig(file);
    expect(loadWorldConfig(file)).toBeNull();
  });

  it('invalidates the blessing cache immediately when deleted', () => {
    saveWorldConfig({ token: generateToken(), apiUrl: 'https://api.example.com' }, file);
    expect(isWorldBlessed(file)).toBe(true);
    deleteWorldConfig(file);
    expect(isWorldBlessed(file)).toBe(false);
  });
});

describe('WorldSync against a real handler (end to end)', () => {
  let fetchHandler: (req: Request) => Promise<Response>;
  let clock: { now: number };
  let sync: WorldSync;

  beforeEach(() => {
    clock = { now: T0 };
    fetchHandler = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      now: () => clock.now,
    });
    const fetchFn = (url: string, init?: RequestInit) =>
      fetchHandler(new Request(url, init));
    sync = new WorldSync(
      { token: generateToken(), apiUrl: 'https://world.example.com' },
      { fetchFn, now: () => clock.now }
    );
  });

  it('teleport registers the citizen and returns the share url', async () => {
    const res = await sync.teleport(buildWorldSnapshot(companion(), 'chibi-1'));
    expect(res.url).toMatch(/^https:\/\/world\.example\.com\/\?district=plaza-\d+/);

    const world = await fetchHandler(new Request(`https://world.example.com/v1/world/${res.district}`));
    const body = (await world.json()) as { citizens: unknown[] };
    expect(body.citizens).toHaveLength(1);
  });

  it('queued events flush after the debounce window, not before', async () => {
    const res = await sync.teleport(buildWorldSnapshot(companion()));

    sync.queue('commit');
    await sync.maybeFlush(); // immediately after teleport: inside debounce window
    clock.now = T0 + 61_000;
    await sync.maybeFlush(); // window elapsed: should POST

    const world = await fetchHandler(new Request(`https://world.example.com/v1/world/${res.district}`));
    const body = (await world.json()) as { events: Array<{ type: string }> };
    expect(body.events.some((e) => e.type === 'commit')).toBe(true);
  });

  it('never throws when the network is down', async () => {
    const deadSync = new WorldSync(
      { token: generateToken(), apiUrl: 'https://world.example.com' },
      { fetchFn: () => Promise.reject(new Error('ECONNREFUSED')), now: () => clock.now }
    );
    deadSync.queue('commit');
    await expect(deadSync.flush()).resolves.toBe(false);
  });

  it('recall removes the citizen from the world', async () => {
    const res = await sync.teleport(buildWorldSnapshot(companion()));
    await sync.recall(true);
    const world = await fetchHandler(new Request(`https://world.example.com/v1/world/${res.district}`));
    const body = (await world.json()) as { citizens: unknown[] };
    expect(body.citizens).toHaveLength(0);
  });
});

describe('WorldSync batching and failure handling (B3: sync must never wedge)', () => {
  const API = 'https://world.example.com';
  let fetchHandler: (req: Request) => Promise<Response>;
  let clock: { now: number };
  let sent: Array<{ events: unknown[]; snapshot?: unknown; status: number }>;
  let cfg: { token: string; apiUrl: string };
  let sync: WorldSync;

  // Real handler + sqlite D1, with every /v1/events POST recorded.
  const recordingFetch = async (url: string, init?: RequestInit) => {
    const res = await fetchHandler(new Request(url, init));
    if (url.endsWith('/v1/events')) {
      const body = JSON.parse(String(init?.body)) as { events: unknown[]; snapshot?: unknown };
      sent.push({ events: body.events, snapshot: body.snapshot, status: res.status });
    }
    return res;
  };

  async function commitsInWorld(district: string): Promise<number> {
    const res = await fetchHandler(new Request(`${API}/v1/world/${district}`));
    const body = (await res.json()) as { events: Array<{ type: string }> };
    return body.events.filter((e) => e.type === 'commit').length;
  }

  beforeEach(() => {
    clock = { now: T0 };
    sent = [];
    fetchHandler = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: API,
      now: () => clock.now,
    });
    cfg = { token: generateToken(), apiUrl: API };
    sync = new WorldSync(cfg, { fetchFn: recordingFetch, now: () => clock.now });
  });

  it('drains a backlog larger than MAX_EVENT_BATCH in server-sized chunks', async () => {
    const tp = await sync.teleport(buildWorldSnapshot(companion()));
    for (let i = 0; i < 120; i++) sync.queue('commit'); // a long offline stretch

    expect(await sync.flush(buildWorldSnapshot(companion()))).toBe(true);
    expect(sent[0].events).toHaveLength(MAX_EVENT_BATCH);
    expect(sync.pending).toBe(120 - MAX_EVENT_BATCH);

    for (let i = 0; i < 10 && sync.pending > 0; i++) expect(await sync.flush()).toBe(true);
    expect(sync.pending).toBe(0);
    expect(sent.every((r) => r.status === 200 && r.events.length <= MAX_EVENT_BATCH)).toBe(true);
    expect(await commitsInWorld(tp.district)).toBe(120);
  });

  it('caps the offline queue, dropping the oldest events', async () => {
    const offline = new WorldSync(
      { token: generateToken(), apiUrl: API },
      { fetchFn: () => Promise.reject(new Error('ECONNREFUSED')), now: () => clock.now }
    );
    for (let i = 0; i < MAX_QUEUED_EVENTS + 250; i++) offline.queue('commit');
    expect(offline.pending).toBe(MAX_QUEUED_EVENTS);
    expect(await offline.flush()).toBe(false); // network failure: requeued, still capped
    expect(offline.pending).toBe(MAX_QUEUED_EVENTS);
  });

  it('keeps events queued across a 5xx and delivers them once the server recovers', async () => {
    const tp = await sync.teleport(buildWorldSnapshot(companion()));
    let down = true;
    const flaky = new WorldSync(cfg, {
      fetchFn: (url, init) =>
        down
          ? Promise.resolve(new Response('{"error":"internal error"}', { status: 500 }))
          : recordingFetch(url, init),
      now: () => clock.now,
    });
    flaky.queue('commit');
    flaky.queue('commit');
    expect(await flaky.flush()).toBe(false);
    expect(flaky.pending).toBe(2);
    down = false;
    expect(await flaky.flush()).toBe(true);
    expect(flaky.pending).toBe(0);
    expect(await commitsInWorld(tp.district)).toBe(2);
  });

  it('a rejected snapshot does not wedge the queue: events land exactly once, without it', async () => {
    const tp = await sync.teleport(buildWorldSnapshot(companion()));
    const bad = buildWorldSnapshot({ ...companion(), name: "O'Malley" }); // validator rejects quotes
    expect(validateSnapshot(bad).ok).toBe(false);

    sync.queue('commit');
    sync.queue('commit');
    await sync.flush(bad);
    expect(sync.pending).toBe(0);
    await sync.flush(bad); // the same bad snapshot again must not re-deliver anything
    expect(sync.pending).toBe(0);
    expect(await commitsInWorld(tp.district)).toBe(2);
  });

  it('drops a batch the server will never accept (4xx) instead of retrying forever', async () => {
    // Never teleported: the token is unknown, so every POST is a 401.
    sync.queue('commit');
    expect(await sync.flush()).toBe(false);
    expect(sync.pending).toBe(0);
    for (let i = 0; i < 5; i++) {
      sync.queue('commit');
      await sync.flush();
    }
    expect(sync.pending).toBe(0);
    expect(sent.every((r) => r.status === 401 && r.events.length === 1)).toBe(true); // nothing piled up
  });

  it('stops for good once the server says the buddy was recalled (409): drops the queue, sends nothing more', async () => {
    await sync.teleport(buildWorldSnapshot(companion()));
    // Recalled elsewhere (the CLI, another process): this sync never heard.
    expect(await new WorldSync(cfg, { fetchFn: recordingFetch }).recall(false)).toBe(true);

    for (let i = 0; i < 3; i++) sync.queue('commit');
    expect(await sync.flush(buildWorldSnapshot(companion()))).toBe(false);
    expect(sent.map((r) => r.status)).toEqual([409]); // one refused POST, no 400 retry
    expect(sync.recalled).toBe(true);
    expect(sync.pending).toBe(0);

    sync.queue('commit');
    expect(sync.pending).toBe(0); // ignored, not requeued
    clock.now += 120_000;
    expect(await sync.flush()).toBe(false);
    await sync.maybeFlush();
    expect(sent).toHaveLength(1); // no further network calls
  });

  it('a 409 for any other reason is an ordinary rejected batch, not a recall', async () => {
    const other = new WorldSync(cfg, {
      fetchFn: async () => new Response('{"error":"town_full"}', { status: 409 }),
      now: () => clock.now,
    });
    other.queue('commit');
    expect(await other.flush()).toBe(false);
    expect(other.recalled).toBe(false);
    other.queue('commit');
    expect(other.pending).toBe(1);
  });
});

describe('autoSyncWorld (MCP server glue)', () => {
  it('is a silent no-op when the user never opted in', async () => {
    const { autoSyncWorld } = await import('../../lib/world/client.js');
    await expect(
      autoSyncWorld(companion(), 'observe', { configPath: '/nonexistent/world.json' })
    ).resolves.toBeUndefined();
  });

  it('syncs events through to the world once opted in', async () => {
    const { autoSyncWorld, saveWorldConfig, generateToken } = await import('../../lib/world/client.js');
    const { mkdtempSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'buddy-autosync-'));
    const file = join(dir, 'world.json');

    const clock = { now: T0 };
    const fetchHandler = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      now: () => clock.now,
    });
    const fetchFn = (url: string, init?: RequestInit) => fetchHandler(new Request(url, init));

    const cfg = { token: generateToken(), apiUrl: 'https://world.example.com' };
    saveWorldConfig(cfg, file);
    // Register the citizen first (teleport), as the CLI would.
    const sync = new WorldSync(cfg, { fetchFn, now: () => clock.now });
    const tp = await sync.teleport(buildWorldSnapshot(companion()));

    clock.now = T0 + 120_000; // beyond debounce
    await autoSyncWorld(companion(), 'commit', { configPath: file, fetchFn, now: () => clock.now });

    const world = await fetchHandler(new Request(`https://world.example.com/v1/world/${tp.district}`));
    const body = (await world.json()) as { events: Array<{ type: string }> };
    expect(body.events.some((e) => e.type === 'commit')).toBe(true);
  });
});

describe('autoSyncWorld after a server-side recall', () => {
  it('goes quiet (no sync, no blessing) until world.json is re-read, and resumes after a teleport back', async () => {
    const { autoSyncWorld, saveWorldConfig, generateToken, isWorldBlessed } = await import('../../lib/world/client.js');
    const dir = mkdtempSync(join(tmpdir(), 'buddy-recalled-'));
    const file = join(dir, 'world.json');

    // Date.now() drives isWorldBlessed's cache, so keep this clock near it.
    const clock = { now: Date.now() };
    const fetchHandler = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      now: () => clock.now,
    });
    const posts: number[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      const res = await fetchHandler(new Request(url, init));
      if (url.endsWith('/v1/events')) posts.push(res.status);
      return res;
    };

    const cfg = { token: generateToken(), apiUrl: 'https://world.example.com' };
    saveWorldConfig(cfg, file); // world.json says "in the world" throughout
    const cli = new WorldSync(cfg, { fetchFn, now: () => clock.now });
    await cli.teleport(buildWorldSnapshot(companion()));
    const deps = { configPath: file, fetchFn, now: () => clock.now, instant: true };

    await autoSyncWorld(companion(), 'commit', deps);
    expect(posts).toEqual([200]);
    expect(isWorldBlessed(file)).toBe(true);

    expect(await cli.recall(false)).toBe(true); // e.g. a script, or another machine
    await autoSyncWorld(companion(), 'commit', deps);
    expect(posts).toEqual([200, 409]);
    expect(isWorldBlessed(file)).toBe(false); // out of the world now, despite world.json

    await autoSyncWorld(companion(), 'commit', deps);
    expect(posts).toEqual([200, 409]); // quiet: no POST for a buddy known to be recalled

    // Owner teleports back; once the config cache expires, sync resumes.
    await cli.teleport(buildWorldSnapshot(companion()));
    clock.now += 31_000;
    await autoSyncWorld(companion(), 'commit', deps);
    expect(posts).toEqual([200, 409, 200]);
  });
});

describe('autoSyncWorld instant flag', () => {
  it('flushes immediately when the award caused a level-up, even inside the debounce window', async () => {
    const { autoSyncWorld, saveWorldConfig, generateToken } = await import('../../lib/world/client.js');
    const dir = mkdtempSync(join(tmpdir(), 'buddy-instant-'));
    const file = join(dir, 'world.json');

    const clock = { now: T0 };
    const fetchHandler = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      now: () => clock.now,
    });
    const fetchFn = (url: string, init?: RequestInit) => fetchHandler(new Request(url, init));

    const cfg = { token: generateToken(), apiUrl: 'https://world.example.com' };
    saveWorldConfig(cfg, file);
    const sync = new WorldSync(cfg, { fetchFn, now: () => clock.now });
    const tp = await sync.teleport(buildWorldSnapshot(companion()));

    clock.now = T0 + 5_000; // well inside the 60s debounce
    await autoSyncWorld(companion(), 'commit', { configPath: file, fetchFn, now: () => clock.now, instant: true });

    const world = await fetchHandler(new Request(`https://world.example.com/v1/world/${tp.district}`));
    const body = (await world.json()) as { events: Array<{ type: string }> };
    expect(body.events.some((e) => e.type === 'commit')).toBe(true); // flushed despite debounce
  });
});
