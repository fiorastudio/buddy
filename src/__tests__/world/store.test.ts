import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteWorldStore, type WorldStore } from '../../lib/world/store.js';
import { D1WorldStore } from '../../lib/world/d1-store.js';
import { sqliteAsD1 } from './d1-shim.js';
import { ANNOUNCE_MAX_PER_CITIZEN } from '../../lib/world/schema-sql.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import type { WorldSnapshot } from '../../lib/world/validate.js';

const T0 = 1_800_000_000_000; // fixed epoch ms for determinism
const DAY = 86_400_000;
// [sinceMs, untilMs] window comfortably around T0 for district/announcement reads.
const SINCE = T0 - DAY;
const UNTIL = T0 + DAY;

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
    const world = await store.district('plaza-1', T0, UNTIL);
    expect(world.events.some((e) => e.type === 'level_up')).toBe(true);
  });

  it('recall hides a citizen from district listings; purge deletes rows', async () => {
    await store.teleport('tokenhash-1', snap(), T0);
    await store.teleport('tokenhash-2', snap({ name: 'Quackers', species: 'Duck' }), T0);

    await store.recall('tokenhash-1', false);
    let world = await store.district('plaza-1', 0, UNTIL);
    expect(world.citizens).toHaveLength(1);

    await store.recall('tokenhash-2', true);
    expect(await store.findByTokenHash('tokenhash-2')).toBeNull();
  });

  it('district listing excludes token hashes', async () => {
    await store.teleport('tokenhash-1', snap(), T0);
    const world = await store.district('plaza-1', 0, UNTIL);
    expect(JSON.stringify(world)).not.toContain('tokenhash');
  });

  it('districtCounts counts only visible citizens seen since the cutoff', async () => {
    await store.teleport('fresh-1', snap({ name: 'Fresh' }), T0, 'plaza-2');
    await store.teleport('fresh-2', snap({ name: 'Fresher' }), T0 + 10, 'plaza-2');
    await store.teleport('stale-1', snap({ name: 'Stale' }), T0 - 1, 'plaza-2');
    await store.teleport('hidden-1', snap({ name: 'Hidden' }), T0, 'plaza-2');
    await store.recall('hidden-1', false);
    expect((await store.districtCounts(T0))['plaza-2']).toBe(2); // stale + hidden excluded
    expect((await store.districtCounts(T0 - 1))['plaza-2']).toBe(3); // cutoff is inclusive
    // A stale citizen who syncs again (events bump last_seen_at) counts again.
    const stale = (await store.findByTokenHash('stale-1'))!;
    await store.recordEvents(stale.id, [{ type: 'commit', ts: T0 + 20 }]);
    expect((await store.districtCounts(T0))['plaza-2']).toBe(3);
  });

  it('district() returns residents seen since the cutoff, capped at the most recent, in arrival order', async () => {
    await store.teleport('a', snap({ name: 'Alpha' }), T0 - 100); // stale at cutoff T0 - 50
    await store.teleport('b', snap({ name: 'Bravo' }), T0);
    await store.teleport('c', snap({ name: 'Charlie' }), T0 + 1);
    await store.teleport('d', snap({ name: 'Delta' }), T0 + 2);
    const all = await store.district('plaza-1', 0, T0 + 10, T0 - 50);
    expect(all.citizens.map((c) => c.name)).toEqual(['Bravo', 'Charlie', 'Delta']);
    // Limit keeps the MOST RECENTLY SEEN, but still returns them in created order.
    const capped = await store.district('plaza-1', 0, T0 + 10, T0 - 50, 2);
    expect(capped.citizens.map((c) => c.name)).toEqual(['Charlie', 'Delta']);
    // Bravo syncs again and becomes the most recently seen.
    const bravo = (await store.findByTokenHash('b'))!;
    await store.recordEvents(bravo.id, [{ type: 'commit', ts: T0 + 3 }]);
    const after = await store.district('plaza-1', 0, T0 + 10, T0 - 50, 2);
    expect(after.citizens.map((c) => c.name)).toEqual(['Bravo', 'Delta']);
  });

  it('everyone lands in the same place (Prontera) — no capacity sharding', async () => {
    // Districts are named towns now, not overflow shards, so all teleports land
    // together in plaza-1 (Prontera); moving elsewhere is an explicit `warp`.
    for (let i = 0; i < 80; i++) {
      await store.teleport(`tok-${i}`, snap({ name: `Buddy${i}` }), T0);
    }
    const res = await store.teleport('tok-last', snap({ name: 'Latecomer' }), T0);
    expect(res.district).toBe('plaza-1');
  });

  it('announcements returns celebration events across ALL districts, newest first, routine excluded', async () => {
    await store.teleport('tok-a', snap({ name: 'Alice' }), T0, 'plaza-1');
    await store.teleport('tok-b', snap({ name: 'Bob' }), T0, 'plaza-2');
    const a = (await store.findByTokenHash('tok-a'))!;
    const b = (await store.findByTokenHash('tok-b'))!;
    await store.recordEvents(a.id, [
      { type: 'commit', ts: T0 + 1000 }, // routine — must NOT appear
      { type: 'level_up', ts: T0 + 2000 },
    ]);
    await store.recordEvents(b.id, [{ type: 'deploy', ts: T0 + 3000 }]); // newest, other town

    const feed = await store.announcements(10, SINCE, UNTIL);
    expect(feed.map((r) => r.type)).toEqual(['deploy', 'level_up']); // newest first, commit excluded
    // Cross-town: the feed spans districts, carrying each buddy's own town.
    expect(feed[0].district).toBe('plaza-2');
    expect(feed[0].name).toBe('Bob');
    expect(feed[1].district).toBe('plaza-1');
    expect(feed[1].name).toBe('Alice');
  });

  it('announcements excludes hidden citizens and honors the limit', async () => {
    await store.teleport('tok-a', snap({ name: 'Alice' }), T0);
    const a = (await store.findByTokenHash('tok-a'))!;
    await store.recordEvents(a.id, [
      { type: 'level_up', ts: T0 + 1000 },
      { type: 'deploy', ts: T0 + 2000 },
      { type: 'streak_7', ts: T0 + 3000 },
    ]);
    expect(await store.announcements(2, SINCE, UNTIL)).toHaveLength(2); // limit respected

    await store.recall('tok-a', false); // hide the only citizen
    expect(await store.announcements(10, SINCE, UNTIL)).toHaveLength(0); // hidden → no broadcast
  });

  it('announcements gives every event a distinct id, even two of the same type at the same ms', async () => {
    await store.teleport('tok-a', snap({ name: 'Alice' }), T0);
    const a = (await store.findByTokenHash('tok-a'))!;
    await store.recordEvents(a.id, [
      { type: 'level_up', ts: T0 + 1000 },
      { type: 'level_up', ts: T0 + 1000 }, // same type, same millisecond
    ]);
    const feed = await store.announcements(10, SINCE, UNTIL);
    expect(feed).toHaveLength(2); // both surface — not collapsed
    const ids = feed.map((r) => r.id);
    expect(new Set(ids).size).toBe(2); // distinct, stable keys for the client
  });

  it('announcements carries the anon flag + species so the handler can mask', async () => {
    await store.teleport('tok-a', snap({ name: 'Alice', species: 'Duck' }), T0);
    await store.setAnon('tok-a', true);
    const a = (await store.findByTokenHash('tok-a'))!;
    await store.recordEvents(a.id, [{ type: 'level_up', ts: T0 + 1000 }]);
    const feed = await store.announcements(10, SINCE, UNTIL);
    expect(feed[0].anon).toBe(true);
    expect(feed[0].species).toBe('Duck');
  });

  it('announcements and district events ignore rows outside [sinceMs, untilMs] (future rows cannot pin)', async () => {
    await store.teleport('tok-a', snap({ name: 'Alice' }), T0);
    await store.teleport('tok-b', snap({ name: 'Bob' }), T0);
    const a = (await store.findByTokenHash('tok-a'))!;
    const b = (await store.findByTokenHash('tok-b'))!;
    // A legacy/forged row dated far in the future, plus one too old for the window.
    await store.recordEvents(a.id, [
      { type: 'deploy', ts: 8.6e15 },
      { type: 'deploy', ts: T0 - 2 * DAY },
    ]);
    await store.recordEvents(b.id, [{ type: 'deploy', ts: T0 - 1000 }]);

    const feed = await store.announcements(10, T0 - DAY, T0);
    expect(feed.map((r) => r.name)).toEqual(['Bob']);
    const world = await store.district('plaza-1', T0 - DAY, T0);
    expect(world.events.map((e) => e.ts)).toEqual([T0 - 1000]);
  });

  it('announcements caps each citizen at ANNOUNCE_MAX_PER_CITIZEN so one buddy cannot fill the banner', async () => {
    await store.teleport('tok-a', snap({ name: 'Spammer' }), T0);
    await store.teleport('tok-b', snap({ name: 'Bob' }), T0);
    const a = (await store.findByTokenHash('tok-a'))!;
    const b = (await store.findByTokenHash('tok-b'))!;
    await store.recordEvents(b.id, [{ type: 'deploy', ts: T0 + 1 }]);
    await store.recordEvents(
      a.id,
      Array.from({ length: 30 }, (_, i) => ({ type: 'deploy', ts: T0 + 100 + i }))
    );

    const feed = await store.announcements(30, SINCE, UNTIL);
    const spam = feed.filter((r) => r.name === 'Spammer');
    expect(spam).toHaveLength(ANNOUNCE_MAX_PER_CITIZEN);
    // The cap keeps the spammer's NEWEST rows, still newest-first overall.
    expect(spam.map((r) => r.ts)).toEqual(Array.from({ length: ANNOUNCE_MAX_PER_CITIZEN }, (_, i) => T0 + 129 - i));
    expect(feed.map((r) => r.name)).toContain('Bob');
    expect(feed[feed.length - 1].name).toBe('Bob');
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

describe('D1WorldStore.recordEvents atomicity', () => {
  it('writes a batch all-or-nothing, so a failed request leaves nothing for a retry to duplicate', async () => {
    const raw = new Database(':memory:');
    const store = await D1WorldStore.create(sqliteAsD1(raw));
    await store.teleport('tokenhash-1', snap(), T0);
    const citizen = (await store.findByTokenHash('tokenhash-1'))!;
    // Fail the SECOND insert of the batch, after the first has run.
    raw.exec(
      `CREATE TRIGGER boom BEFORE INSERT ON world_events WHEN NEW.ts = ${T0 + 2}
       BEGIN SELECT RAISE(ABORT, 'boom'); END`
    );
    await expect(
      store.recordEvents(citizen.id, [
        { type: 'commit', ts: T0 + 1 },
        { type: 'commit', ts: T0 + 2 },
      ])
    ).rejects.toThrow(/boom/);
    expect((await store.district('plaza-1', 0)).events).toHaveLength(0);
    expect((await store.findByTokenHash('tokenhash-1'))!.last_seen_at).toBe(T0);
  });
});
