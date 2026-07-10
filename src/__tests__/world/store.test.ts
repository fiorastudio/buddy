import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteWorldStore, type WorldStore } from '../../lib/world/store.js';
import { D1WorldStore } from '../../lib/world/d1-store.js';
import { sqliteAsD1 } from './d1-shim.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import type { WorldSnapshot } from '../../lib/world/validate.js';

const T0 = 1_800_000_000_000; // fixed epoch ms for determinism

function snap(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    name: 'Shadowpaw',
    species: 'Void Cat',
    level: 5,
    xp: totalXpForLevel(5) + 3,
    mood: 'happy',
    stats: { debugging: 60, patience: 40, chaos: 80, wisdom: 30, snark: 70 },
    rarity: 'rare',
    shiny: false,
    hat: 'none',
    eye: '·',
    avatar: 'chibi-3',
    ...overrides,
  };
}

const IMPLS: Array<[string, () => Promise<WorldStore>]> = [
  ['SqliteWorldStore', async () => new SqliteWorldStore(new Database(':memory:'))],
  ['D1WorldStore', async () => D1WorldStore.create(sqliteAsD1(new Database(':memory:')))],
];

describe.each(IMPLS)('%s', (_name, makeStore) => {
  let store: WorldStore;

  beforeEach(async () => {
    store = await makeStore();
  });

  it('teleport creates a citizen with slug and district', async () => {
    const res = await store.teleport('tokenhash-1', snap(), T0);
    expect(res.created).toBe(true);
    expect(res.slug).toMatch(/^shadowpaw-[a-z0-9]{4}$/);
    expect(res.district).toBe('plaza-1');
  });

  it('re-teleport keeps the slug and does NOT write snapshot fields (clamping is the handler tier)', async () => {
    const first = await store.teleport('tokenhash-1', snap(), T0);
    const second = await store.teleport('tokenhash-1', snap({ mood: 'grumpy', xp: 999_999, level: 50 }), T0 + 1000);
    expect(second.created).toBe(false);
    expect(second.slug).toBe(first.slug);
    const citizen = await store.findByTokenHash('tokenhash-1');
    expect(citizen?.mood).toBe('happy'); // unchanged — store.teleport must not bypass the clamp
    expect(citizen?.level).toBe(5);
  });

  it('teleport into a chosen district places the citizen there', async () => {
    const res = await store.teleport('tokenhash-1', snap(), T0, 'plaza-3');
    expect(res.created).toBe(true);
    expect(res.district).toBe('plaza-3');
    const view = await store.district('plaza-3', 0);
    expect(view.citizens.map((c) => c.slug)).toContain(res.slug);
  });

  it('re-teleport with a new district MOVES the citizen', async () => {
    const first = await store.teleport('tokenhash-1', snap(), T0, 'plaza-1');
    const moved = await store.teleport('tokenhash-1', snap(), T0 + 1000, 'plaza-3');
    expect(moved.created).toBe(false);
    expect(moved.district).toBe('plaza-3');
    expect((await store.findByTokenHash('tokenhash-1'))?.district).toBe('plaza-3');
    expect((await store.district('plaza-1', 0)).citizens.map((c) => c.slug)).not.toContain(first.slug);
    expect((await store.district('plaza-3', 0)).citizens.map((c) => c.slug)).toContain(first.slug);
  });

  it('re-teleport without a district preserves the current one', async () => {
    await store.teleport('tokenhash-1', snap(), T0, 'plaza-5');
    const again = await store.teleport('tokenhash-1', snap(), T0 + 1000);
    expect(again.district).toBe('plaza-5');
    expect((await store.findByTokenHash('tokenhash-1'))?.district).toBe('plaza-5');
  });

  it('records events and bumps last_seen_at', async () => {
    await store.teleport('tokenhash-1', snap(), T0);
    const citizen = (await store.findByTokenHash('tokenhash-1'))!;
    const accepted = await store.recordEvents(citizen.id, [
      { type: 'commit', ts: T0 + 5000 },
      { type: 'deploy', ts: T0 + 6000 },
    ]);
    expect(accepted).toBe(2);
    const after = (await store.findByTokenHash('tokenhash-1'))!;
    expect(after.last_seen_at).toBe(T0 + 6000);
  });

  it('rejects unknown event types', async () => {
    await store.teleport('tokenhash-1', snap(), T0);
    const citizen = (await store.findByTokenHash('tokenhash-1'))!;
    const accepted = await store.recordEvents(citizen.id, [{ type: 'rm_rf', ts: T0 }]);
    expect(accepted).toBe(0);
  });

  it('derives a level_up event when a snapshot update raises level', async () => {
    await store.teleport('tokenhash-1', snap(), T0);
    const citizen = (await store.findByTokenHash('tokenhash-1'))!;
    await store.updateSnapshot(citizen.id, snap({ level: 6, xp: totalXpForLevel(6) + 1 }), T0 + 10_000);
    const world = await store.district('plaza-1', T0);
    expect(world.events.some((e) => e.type === 'level_up')).toBe(true);
  });

  it('recall hides a citizen from district listings; purge deletes rows', async () => {
    await store.teleport('tokenhash-1', snap(), T0);
    await store.teleport('tokenhash-2', snap({ name: 'Quackers', species: 'Duck' }), T0);

    await store.recall('tokenhash-1', false);
    let world = await store.district('plaza-1', 0);
    expect(world.citizens).toHaveLength(1);

    await store.recall('tokenhash-2', true);
    expect(await store.findByTokenHash('tokenhash-2')).toBeNull();
  });

  it('district listing excludes token hashes', async () => {
    await store.teleport('tokenhash-1', snap(), T0);
    const world = await store.district('plaza-1', 0);
    expect(JSON.stringify(world)).not.toContain('tokenhash');
  });

  it('districtCounts feeds sharding: 81st citizen lands in plaza-2', async () => {
    for (let i = 0; i < 80; i++) {
      await store.teleport(`tok-${i}`, snap({ name: `Buddy${i}` }), T0);
    }
    const res = await store.teleport('tok-last', snap({ name: 'Overflow' }), T0);
    expect(res.district).toBe('plaza-2');
  });

  it('rollup aggregates a day of events per citizen', async () => {
    await store.teleport('tokenhash-1', snap(), T0);
    const citizen = (await store.findByTokenHash('tokenhash-1'))!;
    await store.recordEvents(citizen.id, [
      { type: 'commit', ts: T0 },
      { type: 'commit', ts: T0 + 1000 },
      { type: 'deploy', ts: T0 + 2000 },
    ]);
    const date = new Date(T0).toISOString().slice(0, 10);
    const rows = await store.rollup(date);
    expect(rows).toBe(1);
    const rollups = await store.getRollups(date);
    expect(rollups[0].event_counts).toEqual({ commit: 2, deploy: 1 });
  });
});
