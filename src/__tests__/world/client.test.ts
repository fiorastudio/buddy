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
} from '../../lib/world/client.js';
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
    expect(validateSnapshot(snap)).toEqual({ ok: true });
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
    expect(res.url).toMatch(/^https:\/\/world\.example\.com\/b\/shadowpaw-/);

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
