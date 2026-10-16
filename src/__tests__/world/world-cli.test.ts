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
    expect(out.join('\n')).toMatch(/world\.example\.com\/\?district=plaza-\d+/);
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

  it('teleport shows the privacy note inside the prompt, before asking and before any network call', async () => {
    const events: string[] = [];
    let prompt = '';
    const realFetch = deps.fetchFn!;
    deps.fetchFn = (url, init) => {
      events.push('fetch');
      return realFetch(url, init);
    };
    deps.confirm = async (p) => {
      events.push('confirm');
      prompt = p;
      return true;
    };
    await worldCommand(['teleport'], deps);
    expect(events[0]).toBe('confirm');
    expect(events).toContain('fetch');
    // The note is part of what the user sees when asked, ahead of the question.
    expect(prompt).toMatch(/GAME STATE ONLY[\s\S]*recall --purge[\s\S]*Teleport your buddy into Buddy World\?$/);
  });

  it('teleport declined sends nothing to the server', async () => {
    let fetched = false;
    deps.fetchFn = async () => {
      fetched = true;
      throw new Error('should not be called');
    };
    deps.confirm = async () => false;
    await worldCommand(['teleport'], deps);
    expect(fetched).toBe(false);
  });

  it('non-interactive first teleport without --yes shows the note and does not teleport', async () => {
    let fetched = false;
    deps.fetchFn = async () => {
      fetched = true;
      throw new Error('should not be called');
    };
    deps.confirm = undefined; // no TTY: nobody to ask
    const out = (await worldCommand(['teleport'], deps)).join('\n');
    expect(out).toMatch(/GAME STATE ONLY/);
    expect(out).toMatch(/buddy-world teleport --yes/);
    expect(fetched).toBe(false);
    expect(loadWorldConfig(configPath)).toBeNull();
  });

  it('non-interactive first teleport with --yes proceeds and still prints the note', async () => {
    deps.confirm = undefined;
    const out = (await worldCommand(['teleport', '--yes'], deps)).join('\n');
    expect(out).toMatch(/GAME STATE ONLY/);
    expect(out).toMatch(/teleported into Buddy World/);
    expect(loadWorldConfig(configPath)?.slug).toMatch(/^shadowpaw-/);
  });

  it('--yes skips the prompt even when interactive', async () => {
    let asked = false;
    deps.confirm = async () => {
      asked = true;
      return false;
    };
    await worldCommand(['teleport', '--yes', '--avatar', 'chibi-2'], deps);
    expect(asked).toBe(false);
    expect(loadWorldConfig(configPath)?.avatar).toBe('chibi-2');
  });

  it('re-teleport of an already opted-in buddy needs neither a prompt nor --yes', async () => {
    await worldCommand(['teleport'], deps);
    deps.confirm = undefined;
    const out = (await worldCommand(['teleport'], deps)).join('\n');
    expect(out).toMatch(/teleported into Buddy World/);
    expect(out).not.toMatch(/GAME STATE ONLY/);
  });

  it('status reports not-teleported before opt-in and the url after', async () => {
    expect((await worldCommand(['status'], deps)).join('\n')).toMatch(/not in the world/i);
    await worldCommand(['teleport'], deps);
    expect((await worldCommand(['status'], deps)).join('\n')).toMatch(/world\.example\.com\/\?district=plaza-/);
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

  it('teleport lands in Prontera; warp moves the buddy to a chosen town', async () => {
    await worldCommand(['teleport'], deps); // everyone lands in Prontera
    expect(loadWorldConfig(configPath)?.district).toBe('plaza-1');
    const out = await worldCommand(['warp', 'payon'], deps);
    expect(out.join('\n')).toMatch(/warped to Payon/i);
    expect(loadWorldConfig(configPath)?.district).toBe('plaza-2');
  });

  it('warp is refused before teleporting, and rejects an unknown town', async () => {
    expect((await worldCommand(['warp', 'payon'], deps)).join('\n')).toMatch(/not in the world/i);
    await worldCommand(['teleport'], deps);
    expect((await worldCommand(['warp', 'atlantis'], deps)).join('\n')).toMatch(/unknown town/i);
  });

  it('link prints a personal plaza URL carrying a one-time code', async () => {
    await worldCommand(['teleport'], deps);
    const out = (await worldCommand(['link'], deps)).join('\n');
    expect(out).toMatch(/world\.example\.com\/\?district=plaza-\d+#code=[0-9a-f]+/);
  });

  it('link is refused before teleporting', async () => {
    expect((await worldCommand(['link'], deps)).join('\n')).toMatch(/not in the world/i);
  });
});
