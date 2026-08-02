import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worldCommand, type WorldCliDeps } from '../../cli/world-cli.js';
import { createWorldFetchHandler } from '../../world/worker-core.js';
import { sqliteAsD1 } from './d1-shim.js';
import { loadWorldConfig } from '../../lib/world/client.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import type { Companion } from '../../lib/types.js';

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
    hatchedAt: 0,
  };
}

describe('worldCommand', () => {
  let deps: WorldCliDeps;
  let configPath: string;

  beforeEach(() => {
    configPath = join(mkdtempSync(join(tmpdir(), 'buddy-world-cli-')), 'world.json');
    const fetchHandler = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
    });
    deps = {
      loadCompanion: () => companion(),
      fetchFn: (url, init) => fetchHandler(new Request(url, init)),
      configPath,
      apiUrl: 'https://world.example.com',
      confirm: async () => true,
    };
  });

  it('teleport opts in, saves config, and prints the share url', async () => {
    const out = await worldCommand(['teleport', '--avatar', 'chibi-4'], deps);
    expect(out.join('\n')).toMatch(/world\.example\.com\/b\/shadowpaw-/);
    const cfg = loadWorldConfig(configPath);
    expect(cfg?.slug).toMatch(/^shadowpaw-/);
    expect(cfg?.avatar).toBe('chibi-4');
  });

  it('teleport aborts when the privacy note is declined', async () => {
    deps.confirm = async () => false;
    const out = await worldCommand(['teleport'], deps);
    expect(out.join('\n')).toMatch(/cancelled/i);
    expect(loadWorldConfig(configPath)).toBeNull();
  });

  it('status reports not-teleported before opt-in and the url after', async () => {
    expect((await worldCommand(['status'], deps)).join('\n')).toMatch(/not in the world/i);
    await worldCommand(['teleport'], deps);
    expect((await worldCommand(['status'], deps)).join('\n')).toMatch(/world\.example\.com\/b\//);
  });

  it('recall --purge removes config and citizen', async () => {
    await worldCommand(['teleport'], deps);
    const out = await worldCommand(['recall', '--purge'], deps);
    expect(out.join('\n')).toMatch(/recalled/i);
    expect(loadWorldConfig(configPath)).toBeNull();
  });

  it('recall keeps the local token when the server call fails', async () => {
    await worldCommand(['teleport'], deps);
    const offlineDeps = { ...deps, fetchFn: () => Promise.reject(new Error('ECONNREFUSED')) };
    const out = await worldCommand(['recall', '--purge'], offlineDeps);
    expect(out.join('\n')).toMatch(/could not reach|failed|try again/i);
    expect(loadWorldConfig(configPath)).not.toBeNull(); // token preserved for retry
  });

  it('anon on toggles anonymous mode via the API', async () => {
    await worldCommand(['teleport'], deps);
    const out = await worldCommand(['anon', 'on'], deps);
    expect(out.join('\n')).toMatch(/anonymous mode on/i);
  });

  it('unknown subcommand prints usage', async () => {
    const out = await worldCommand(['dance'], deps);
    expect(out.join('\n')).toMatch(/usage/i);
  });
});
