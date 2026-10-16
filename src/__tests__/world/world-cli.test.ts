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
  let fetchHandler: (req: Request) => Promise<Response>;

  beforeEach(() => {
    configPath = join(mkdtempSync(join(tmpdir(), 'buddy-world-cli-')), 'world.json');
    fetchHandler = createWorldFetchHandler({
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

  describe('plain recall keeps the token (server data is kept)', () => {
    async function plaza(district = 'plaza-1'): Promise<Array<{ slug: string }>> {
      const res = await fetchHandler(new Request(`https://world.example.com/v1/world/${district}`));
      return ((await res.json()) as { citizens: Array<{ slug: string }> }).citizens;
    }
    function countingFetch(): { calls: () => number } {
      let n = 0;
      const real = deps.fetchFn!;
      deps.fetchFn = (url, init) => {
        n++;
        return real(url, init);
      };
      return { calls: () => n };
    }

    it('hides the buddy, keeps the token, and clears the public location', async () => {
      await worldCommand(['teleport', '--avatar', 'chibi-3'], deps);
      const before = loadWorldConfig(configPath)!;
      expect(await plaza()).toHaveLength(1);

      const out = (await worldCommand(['recall'], deps)).join('\n');
      expect(out).toMatch(/recalled/i);
      expect(out).toMatch(/still kept on the server/i);
      expect(out).toMatch(/buddy-world recall --purge/);

      const after = loadWorldConfig(configPath);
      expect(after).not.toBeNull();
      expect(after?.token).toBe(before.token);
      expect(after?.recalled).toBe(true);
      expect(after?.slug).toBeUndefined();
      expect(after?.url).toBeUndefined();
      expect(after?.district).toBeUndefined();
      expect(after?.avatar).toBe('chibi-3');
      expect(await plaza()).toHaveLength(0); // hidden server-side
    });

    it('status, link, warp and anon treat a recalled buddy as not in the world, without calling the server', async () => {
      await worldCommand(['teleport'], deps);
      await worldCommand(['recall'], deps);
      const fetches = countingFetch();
      for (const argv of [['status'], ['link'], ['warp', 'payon'], ['anon', 'on']]) {
        const out = (await worldCommand(argv, deps)).join('\n');
        expect(out).toMatch(/not in the world \(recalled\)/i);
        expect(out).toMatch(/recall --purge/);
      }
      expect(fetches.calls()).toBe(0);
    });

    it('a second plain recall is a no-op that points at --purge', async () => {
      await worldCommand(['teleport'], deps);
      await worldCommand(['recall'], deps);
      const fetches = countingFetch();
      const out = (await worldCommand(['recall'], deps)).join('\n');
      expect(out).toMatch(/already recalled/i);
      expect(out).toMatch(/recall --purge/);
      expect(fetches.calls()).toBe(0);
      expect(loadWorldConfig(configPath)?.recalled).toBe(true);
    });

    it('teleport after recall asks again, reuses the token, and un-hides the same citizen', async () => {
      await worldCommand(['teleport'], deps);
      const first = loadWorldConfig(configPath)!;
      await worldCommand(['recall'], deps);

      let asked = 0;
      deps.confirm = async () => {
        asked++;
        return true;
      };
      const out = (await worldCommand(['teleport'], deps)).join('\n');
      expect(out).toMatch(/teleported into Buddy World/);
      expect(asked).toBe(1); // coming back is a fresh opt-in

      const back = loadWorldConfig(configPath)!;
      expect(back.token).toBe(first.token);
      expect(back.slug).toBe(first.slug);
      expect(back.recalled).toBeUndefined();
      expect((await plaza()).map((c) => c.slug)).toEqual([first.slug]);
      expect((await worldCommand(['status'], deps)).join('\n')).toMatch(/plaza-1/);
    });

    it('declining to come back leaves the recalled config untouched', async () => {
      await worldCommand(['teleport'], deps);
      await worldCommand(['recall'], deps);
      deps.confirm = async () => false;
      await worldCommand(['teleport'], deps);
      expect(loadWorldConfig(configPath)?.recalled).toBe(true);
      expect(await plaza()).toHaveLength(0);
    });

    it('recall --purge still works from a recalled config and then deletes world.json', async () => {
      await worldCommand(['teleport'], deps);
      const { token } = loadWorldConfig(configPath)!;
      await worldCommand(['recall'], deps);

      const out = (await worldCommand(['recall', '--purge'], deps)).join('\n');
      expect(out).toMatch(/purged/i);
      expect(loadWorldConfig(configPath)).toBeNull();
      // The server no longer knows the token: the citizen is gone, not hidden.
      const res = await fetchHandler(
        new Request('https://world.example.com/v1/recall', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, purge: true }),
        })
      );
      expect(res.status).toBe(401);
    });

    it('a failed purge from a recalled config keeps the token', async () => {
      await worldCommand(['teleport'], deps);
      await worldCommand(['recall'], deps);
      const offlineDeps = { ...deps, fetchFn: () => Promise.reject(new Error('ECONNREFUSED')) };
      const out = (await worldCommand(['recall', '--purge'], offlineDeps)).join('\n');
      expect(out).toMatch(/could not reach/i);
      expect(loadWorldConfig(configPath)?.recalled).toBe(true);
    });

    it('a failed plain recall leaves the config in the world', async () => {
      await worldCommand(['teleport'], deps);
      const offlineDeps = { ...deps, fetchFn: () => Promise.reject(new Error('ECONNREFUSED')) };
      await worldCommand(['recall'], offlineDeps);
      const cfg = loadWorldConfig(configPath);
      expect(cfg?.recalled).toBeUndefined();
      expect(cfg?.slug).toMatch(/^shadowpaw-/);
    });
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
