import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteWorldStore } from '../../lib/world/store.js';
import {
  handleTeleport,
  handleEvents,
  handleRecall,
  handleWorld,
  handleAnnouncements,
  handleBrowserLink,
  handleBrowserSession,
  handleRevokeBrowserSessions,
  handleMe,
  handlePortalWarp,
  handleAnon,
  hashToken,
  publicSlug,
  coarseLastSeen,
  RateLimiter,
  MAX_EVENT_AGE_MS,
  type RoomNotice,
} from '../../lib/world/handlers.js';
import { ANNOUNCE_MAX_PER_CITIZEN } from '../../lib/world/schema-sql.js';
import { DISTRICT_CAPACITY, RESIDENT_WINDOW_MS, WORLD_CITIZEN_LIMIT } from '../../lib/world/districts.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import type { WorldSnapshot } from '../../lib/world/validate.js';

const T0 = 1_800_000_000_000;
const OPTS = { now: T0, baseUrl: 'https://world.example.com' };
// Server clock a little after the T0+N events the announcement tests seed.
const LATER = { ...OPTS, now: T0 + 10_000 };

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

describe('world handlers', () => {
  let store: SqliteWorldStore;

  beforeEach(() => {
    store = new SqliteWorldStore(new Database(':memory:'));
  });

  it('teleport returns slug, url, district and stores only the token hash', async () => {
    const res = await handleTeleport({ token: 'secret-token', snapshot: snap() }, store, OPTS);
    expect(res.status).toBe(200);
    const body = res.body as { slug: string; url: string; district: string };
    expect(body.url).toBe(`https://world.example.com/?district=${body.district}`);
    expect(body.district).toBe('plaza-1');

    expect(await store.findByTokenHash('secret-token')).toBeNull();
    expect(await store.findByTokenHash(hashToken('secret-token'))).not.toBeNull();
  });

  it('teleport to a named town lands there, and re-teleporting moves the buddy', async () => {
    // Choose a town by name on first teleport → its district.
    const first = await handleTeleport({ token: 'secret-token', snapshot: snap(), district: 'Payon' }, store, OPTS);
    expect(first.status).toBe(200);
    expect((first.body as { district: string }).district).toBe('plaza-2');

    // Re-teleport to a different town → same buddy MOVES (not a duplicate).
    const move = await handleTeleport({ token: 'secret-token', snapshot: snap(), district: 'Geffen' }, store, OPTS);
    expect(move.status).toBe(200);
    const body = move.body as { district: string; created: boolean };
    expect(body.created).toBe(false); // existing citizen, moved
    expect(body.district).toBe('plaza-3');
    const citizen = await store.findByTokenHash(hashToken('secret-token'));
    expect(citizen?.district).toBe('plaza-3');

    // Unknown town → 400.
    const bad = await handleTeleport({ token: 'secret-token', snapshot: snap(), district: 'Atlantis' }, store, OPTS);
    expect(bad.status).toBe(400);
  });

  it('teleport rejects an invalid snapshot with 400', async () => {
    const res = await handleTeleport({ token: 'tttttttt', snapshot: snap({ level: 50, xp: 10 }) }, store, OPTS);
    expect(res.status).toBe(400);
  });

  it('teleport rejects profane names with 400', async () => {
    const res = await handleTeleport({ token: 'tttttttt', snapshot: snap({ name: 'Sh1tLord' }) }, store, OPTS);
    expect(res.status).toBe(400);
  });

  it('events with an unknown token returns 401', async () => {
    const res = await handleEvents({ token: 'nope', events: [{ type: 'commit', ts: T0 }] }, store, OPTS);
    expect(res.status).toBe(401);
  });

  it('events accepts a batch and reports accepted count', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const res = await handleEvents(
      { token: 'tok-0123456789abcdef', events: [{ type: 'commit', ts: T0 + 1 }, { type: 'nonsense', ts: T0 + 2 }] },
      store,
      OPTS
    );
    expect(res.status).toBe(200);
    expect((res.body as { accepted: number }).accepted).toBe(1);
  });

  it('events clamps impossible xp jumps in the attached snapshot', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const cheat = snap({ level: 50, xp: totalXpForLevel(50) });
    const res = await handleEvents(
      { token: 'tok-0123456789abcdef', events: [], snapshot: cheat },
      store,
      { ...OPTS, now: T0 + 60_000 } // one minute later
    );
    expect(res.status).toBe(200);
    const citizen = await store.findByTokenHash(hashToken('tok-0123456789abcdef'));
    expect(citizen!.xp).toBeLessThan(totalXpForLevel(50));
    expect(citizen!.level).toBeLessThan(50);
    expect(citizen!.flagged).toBe(true);
  });

  it('re-teleport cannot bypass the XP clamp (level 1 to 50 in one call)', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const cheat = snap({ level: 50, xp: totalXpForLevel(50) });
    const res = await handleTeleport(
      { token: 'tok-0123456789abcdef', snapshot: cheat },
      store,
      { ...OPTS, now: T0 + 1 }
    );
    expect(res.status).toBe(200);
    const citizen = await store.findByTokenHash(hashToken('tok-0123456789abcdef'));
    expect(citizen!.level).toBeLessThan(50);
    expect(citizen!.flagged).toBe(true);
  });

  it('re-teleport still updates benign fields like mood', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    await handleTeleport(
      { token: 'tok-0123456789abcdef', snapshot: snap({ mood: 'grumpy' }) },
      store,
      { ...OPTS, now: T0 + 1000 }
    );
    const citizen = await store.findByTokenHash(hashToken('tok-0123456789abcdef'));
    expect(citizen!.mood).toBe('grumpy');
  });

  it('rejects oversized event batches with 400', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const events = Array.from({ length: 51 }, (_, i) => ({ type: 'commit', ts: T0 + i }));
    const res = await handleEvents({ token: 'tok-0123456789abcdef', events }, store, OPTS);
    expect(res.status).toBe(400);
  });

  it('a rejected snapshot writes nothing, so a client retry cannot duplicate events', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const payload = {
      token: 'tok-0123456789abcdef',
      events: [{ type: 'commit', ts: T0 + 1 }],
      snapshot: snap({ name: "O'Malley", mood: 'grumpy' }), // validator rejects quotes
    };
    for (let i = 0; i < 3; i++) {
      expect((await handleEvents(payload, store, OPTS)).status).toBe(400);
    }
    expect((await store.district('plaza-1', 0, Number.MAX_SAFE_INTEGER)).events).toHaveLength(0);
    expect((await store.findByTokenHash(hashToken('tok-0123456789abcdef')))!.mood).toBe('happy');
  });

  it('strips internal flags from the public world view', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const res = await handleWorld('plaza-1', store, OPTS);
    const body = res.body as { citizens: Array<Record<string, unknown>> };
    expect(body.citizens[0]).not.toHaveProperty('flagged');
    expect(body.citizens[0]).not.toHaveProperty('hidden');
    expect(body.citizens[0]).not.toHaveProperty('xp_bucket');
  });

  it('world view lists only recent residents, not every citizen ever (B2)', async () => {
    const stale = T0 - RESIDENT_WINDOW_MS - 1;
    await handleTeleport({ token: 'old-timer-0123456789', snapshot: snap({ name: 'Oldtimer' }) }, store, { ...OPTS, now: stale });
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    // An idle-but-recent buddy (2 days quiet) is still a resident (the plaza
    // draws it sitting), so the window must comfortably exceed the 3h idle tier.
    await handleTeleport({ token: 'idle-one-0123456789', snapshot: snap({ name: 'Idler' }) }, store, { ...OPTS, now: T0 - 2 * 86_400_000 });
    const res = await handleWorld('plaza-1', store, OPTS);
    const names = (res.body as { citizens: Array<{ name: string }> }).citizens.map((c) => c.name).sort();
    expect(names).toEqual(['Idler', 'Shadowpaw']);
  });

  it('world view is bounded to the most recently seen residents', async () => {
    const total = WORLD_CITIZEN_LIMIT + 5;
    for (let i = 0; i < total; i++) {
      // Citizen i was last seen at T0 - (total - i) ms: higher i = more recent.
      await handleTeleport({ token: `crowd-${i}-0123456789`, snapshot: snap({ name: `Crowd${i}` }) }, store, {
        ...OPTS,
        now: T0 - (total - i),
      });
    }
    const res = await handleWorld('plaza-1', store, OPTS);
    const names = new Set((res.body as { citizens: Array<{ name: string }> }).citizens.map((c) => c.name));
    expect(names.size).toBe(WORLD_CITIZEN_LIMIT);
    for (let i = 0; i < 5; i++) expect(names.has(`Crowd${i}`)).toBe(false); // the 5 least-recent drop off
    expect(names.has(`Crowd${total - 1}`)).toBe(true);
  });

  it('recall hides the citizen and purge removes it', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const res = await handleRecall({ token: 'tok-0123456789abcdef', purge: false }, store);
    expect(res.status).toBe(200);
    const world = await handleWorld('plaza-1', store, OPTS);
    expect((world.body as { citizens: unknown[] }).citizens).toHaveLength(0);
  });

  it('world view masks anon citizens', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    await store.setAnon(hashToken('tok-0123456789abcdef'), true);
    const res = await handleWorld('plaza-1', store, OPTS);
    const body = res.body as { citizens: Array<{ name: string; slug: string }> };
    expect(body.citizens[0].name).toBe('a wild Void Cat');
    expect(body.citizens[0].slug).not.toMatch(/shadowpaw/);
  });

  it('teleport stores the request-origin country and the world view returns it', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, { ...OPTS, country: 'JP' });
    const res = await handleWorld('plaza-1', store, OPTS);
    const body = res.body as { citizens: Array<{ country: string | null }> };
    expect(body.citizens[0].country).toBe('JP');
  });

  it('normalizes the origin country (lowercase → upper; junk/sentinels → no flag)', async () => {
    // lowercase from the header path is accepted and upper-cased
    await handleTeleport({ token: 'tok-lower-000000', snapshot: snap({ name: 'Lower' }) }, store, { ...OPTS, country: 'us' });
    // CF unknown sentinel is dropped (no bogus "XX" flag)
    await handleTeleport({ token: 'tok-xx-0000000000', snapshot: snap({ name: 'Sentinel' }) }, store, { ...OPTS, country: 'XX' });
    // malformed is dropped
    await handleTeleport({ token: 'tok-junk-0000000', snapshot: snap({ name: 'Junk' }) }, store, { ...OPTS, country: 'U1!' });
    const body = (await handleWorld('plaza-1', store, OPTS)).body as { citizens: Array<{ name: string; country: string | null }> };
    const by = (n: string) => body.citizens.find((c) => c.name === n)!;
    expect(by('Lower').country).toBe('US');
    expect(by('Sentinel').country).toBeNull();
    expect(by('Junk').country).toBeNull();
  });

  it('re-teleport without a country keeps the previously stored flag', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, { ...OPTS, country: 'DE' });
    // A later sync/teleport with no country (e.g. off-Cloudflare) must not wipe it.
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const body = (await handleWorld('plaza-1', store, OPTS)).body as { citizens: Array<{ country: string | null }> };
    expect(body.citizens[0].country).toBe('DE');
  });

  it('anon mode hides the country flag in the world view', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, { ...OPTS, country: 'FR' });
    await store.setAnon(hashToken('tok-0123456789abcdef'), true);
    const res = await handleWorld('plaza-1', store, OPTS);
    const body = res.body as { citizens: Array<{ name: string; country: string | null }> };
    expect(body.citizens[0].name).toBe('a wild Void Cat');
    expect(body.citizens[0].country).toBeNull();
  });

  it('announcements returns recent celebrations across ALL districts (town + name + type + ts)', async () => {
    await handleTeleport({ token: 'tok-alice-000000', snapshot: snap({ name: 'Alice' }), district: 'Payon' }, store, OPTS);
    await handleTeleport({ token: 'tok-bob-00000000', snapshot: snap({ name: 'Bob' }), district: 'Prontera' }, store, OPTS);
    const alice = (await store.findByTokenHash(hashToken('tok-alice-000000')))!;
    const bob = (await store.findByTokenHash(hashToken('tok-bob-00000000')))!;
    await store.recordEvents(alice.id, [
      { type: 'level_up', ts: T0 + 1000 },
      { type: 'commit', ts: T0 + 1500 }, // routine — must not be broadcast
    ]);
    await store.recordEvents(bob.id, [{ type: 'deploy', ts: T0 + 2000 }]);

    const res = await handleAnnouncements(store, LATER);
    expect(res.status).toBe(200);
    const body = res.body as {
      announcements: Array<{ name: string; slug: string; type: string; ts: number; town: string }>;
    };
    // Newest first; the routine commit is excluded from the celebration feed.
    expect(body.announcements.map((a) => a.type)).toEqual(['deploy', 'level_up']);
    expect(body.announcements[0].name).toBe('Bob');
    expect(body.announcements[0].town).toBe('Prontera'); // plaza-1 → RO town name
    expect(body.announcements[0].ts).toBe(T0 + 2000);
    expect(body.announcements[1].name).toBe('Alice');
    expect(body.announcements[1].town).toBe('Payon'); // plaza-2, a DIFFERENT district
  });

  it('announcements includes only celebration-class types and honors the limit', async () => {
    await handleTeleport({ token: 'tok-x-000000000', snapshot: snap() }, store, OPTS);
    const c = (await store.findByTokenHash(hashToken('tok-x-000000000')))!;
    await store.recordEvents(c.id, [
      { type: 'observe', ts: T0 + 1 },
      { type: 'commit', ts: T0 + 2 },
      { type: 'tests_passed', ts: T0 + 3 },
      { type: 'bug_fix', ts: T0 + 4 },
      { type: 'streak_7', ts: T0 + 5 },
      { type: 'deploy', ts: T0 + 6 },
      { type: 'level_up', ts: T0 + 7 },
    ]);
    const all = (await handleAnnouncements(store, LATER)).body as { announcements: Array<{ type: string }> };
    // Only the three celebration-class types survive, newest first.
    expect(all.announcements.map((a) => a.type)).toEqual(['level_up', 'deploy', 'streak_7']);
    const limited = (await handleAnnouncements(store, LATER, 2)).body as { announcements: unknown[] };
    expect(limited.announcements).toHaveLength(2);
  });

  it('announcements masks anon buddies: "a wild <species>", masked slug, real identity never leaks', async () => {
    await handleTeleport({ token: 'tok-anon-0000000', snapshot: snap({ name: 'Shadowpaw' }) }, store, OPTS);
    await store.setAnon(hashToken('tok-anon-0000000'), true);
    const c = (await store.findByTokenHash(hashToken('tok-anon-0000000')))!;
    await store.recordEvents(c.id, [{ type: 'level_up', ts: T0 + 1000 }]);

    const res = await handleAnnouncements(store, LATER);
    const body = res.body as { announcements: Array<{ name: string; slug: string }> };
    expect(body.announcements).toHaveLength(1);
    expect(body.announcements[0].name).toBe('a wild Void Cat');
    expect(body.announcements[0].slug).toMatch(/^anon-/);
    // The real name AND the real slug must be absent from the entire payload.
    expect(JSON.stringify(body.announcements)).not.toContain('Shadowpaw');
    expect(JSON.stringify(body.announcements)).not.toContain(c.slug);
  });

  // B1 (release/2.0 audit): a self-minted token could POST 30 `deploy` events
  // at ts 8.6e15 and pin the global banner + /v1/world feeds forever.
  it('future-dated event floods cannot pin the banner, the world feed, or last_seen_at', async () => {
    await handleTeleport({ token: 'tok-attacker-000', snapshot: snap({ name: 'Mallory' }) }, store, OPTS);
    await handleTeleport({ token: 'tok-victim-00000', snapshot: snap({ name: 'Victor' }) }, store, OPTS);
    const flood = Array.from({ length: 30 }, () => ({ type: 'deploy', ts: 8.6e15 }));
    const res = await handleEvents({ token: 'tok-attacker-000', events: flood }, store, OPTS);
    expect(res.status).toBe(200);

    // The attacker's last_seen_at is the server clock, not 8.6e15.
    const attacker = (await store.findByTokenHash(hashToken('tok-attacker-000')))!;
    expect(attacker.last_seen_at).toBe(T0);

    // A legitimate celebration a few seconds later still reaches the top.
    const later = { ...OPTS, now: T0 + 5_000 };
    await handleEvents({ token: 'tok-victim-00000', events: [{ type: 'deploy', ts: T0 + 5_000 }] }, store, later);

    const feed = (await handleAnnouncements(store, later)).body as {
      announcements: Array<{ name: string; ts: number }>;
    };
    expect(feed.announcements[0].name).toBe('Victor');
    expect(feed.announcements.every((a) => a.ts <= later.now)).toBe(true);
    // ...and one citizen can never occupy more than a few banner slots.
    expect(feed.announcements.filter((a) => a.name === 'Mallory')).toHaveLength(ANNOUNCE_MAX_PER_CITIZEN);

    const world = (await handleWorld('plaza-1', store, later)).body as { events: Array<{ ts: number }> };
    expect(world.events[0].ts).toBe(T0 + 5_000);
    expect(world.events.every((e) => e.ts <= later.now)).toBe(true);
  });

  it('clamps client event timestamps into [now - MAX_EVENT_AGE_MS, now] and skips malformed entries', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const res = await handleEvents(
      {
        token: 'tok-0123456789abcdef',
        events: [
          { type: 'commit', ts: 0 }, // ancient → now - MAX_EVENT_AGE_MS
          { type: 'commit', ts: 1e16 }, // future → now
          null,
          'deploy',
          { type: 'deploy' }, // no ts
          { type: 'deploy', ts: '1e16' }, // non-numeric ts
        ],
      },
      store,
      OPTS
    );
    expect(res.status).toBe(200);
    expect((res.body as { accepted: number }).accepted).toBe(2);
    const view = await store.district('plaza-1', 0, Number.MAX_SAFE_INTEGER);
    expect(view.events.map((e) => e.ts)).toEqual([T0, T0 - MAX_EVENT_AGE_MS]);
  });

  it('ignores client-claimed level_up; the banner only shows a level-up the server saw in the snapshot', async () => {
    // Level 4, a few XP short of level 5.
    const lvl4 = snap({ level: 4, xp: totalXpForLevel(5) - 1 });
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: lvl4 }, store, OPTS);

    const forged = await handleEvents(
      { token: 'tok-0123456789abcdef', events: [{ type: 'level_up', ts: T0 }] },
      store,
      OPTS
    );
    expect((forged.body as { accepted: number }).accepted).toBe(0);
    let feed = (await handleAnnouncements(store, OPTS)).body as { announcements: Array<{ type: string }> };
    expect(feed.announcements).toHaveLength(0);

    // A real level-up (snapshot crosses into level 5) is derived server-side.
    const later = { ...OPTS, now: T0 + 60_000 };
    await handleEvents({ token: 'tok-0123456789abcdef', events: [], snapshot: snap() }, store, later);
    feed = (await handleAnnouncements(store, later)).body as { announcements: Array<{ type: string; ts: number }> };
    expect(feed.announcements).toEqual([expect.objectContaining({ type: 'level_up', ts: later.now })]);
  });

  it('rate limiter rejects after the per-minute budget', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.allow('k', T0)).toBe(true);
    expect(limiter.allow('k', T0 + 1)).toBe(true);
    expect(limiter.allow('k', T0 + 2)).toBe(true);
    expect(limiter.allow('k', T0 + 3)).toBe(false);
    expect(limiter.allow('k', T0 + 61_000)).toBe(true); // window rolls
    expect(limiter.allow('other', T0 + 4)).toBe(true); // independent keys
  });

  it('returns 400, not a crash, for null/primitive snapshots', async () => {
    for (const snapshot of [null, 42, 'hi', []]) {
      const res = await handleTeleport({ token: 'tttttttt', snapshot }, store, OPTS);
      expect(res.status).toBe(400);
    }
  });

  it('fresh citizens start with a near-empty XP budget', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const citizen = await store.findByTokenHash(hashToken('tok-0123456789abcdef'));
    expect(citizen!.xp_bucket).toBeLessThanOrEqual(60);
  });
});

describe('snapshot bounds (release audit B4)', () => {
  let store: SqliteWorldStore;
  beforeEach(() => {
    store = new SqliteWorldStore(new Database(':memory:'));
  });

  const padded = () =>
    ({
      ...snap(),
      bio: 'x'.repeat(5000),
      stats: { ...snap().stats, essay: 'y'.repeat(5000) },
    }) as unknown as WorldSnapshot;

  it('teleport stores and serves only the five stats and known fields', async () => {
    expect((await handleTeleport({ token: 'secret-token', snapshot: padded() }, store, OPTS)).status).toBe(200);
    const res = await handleWorld('plaza-1', store, OPTS);
    const [c] = (res.body as { citizens: Array<Record<string, unknown>> }).citizens;
    expect(Object.keys(c.stats as object).sort()).toEqual(['chaos', 'debugging', 'patience', 'snark', 'wisdom']);
    expect(c).not.toHaveProperty('bio');
    expect(JSON.stringify(res.body)).not.toMatch(/xxxxx|yyyyy/);
  });

  it('events snapshot stores only the five stats', async () => {
    await handleTeleport({ token: 'secret-token', snapshot: snap() }, store, OPTS);
    const res = await handleEvents({ token: 'secret-token', events: [], snapshot: padded() }, store, LATER);
    expect(res.status).toBe(200);
    const row = await store.findByTokenHash(hashToken('secret-token'));
    expect(Object.keys(row!.stats).sort()).toEqual(['chaos', 'debugging', 'patience', 'snark', 'wisdom']);
  });

  // An unknown avatar is dropped, not a 400: a 400 on /v1/events would make the
  // client drop the snapshot, silently stopping level/XP sync for anyone whose
  // world.json holds a bad avatar.
  it('drops an unknown avatar on teleport and on events; the rest still syncs', async () => {
    const bad = snap({ avatar: '<svg onload=alert(1)>' + 'z'.repeat(5000) });
    const tp = await handleTeleport({ token: 'secret-token', snapshot: bad }, store, OPTS);
    expect(tp.status).toBe(200);
    expect((await store.findByTokenHash(hashToken('secret-token')))!.avatar).toBeNull();
    const served = await handleWorld('plaza-1', store, OPTS);
    expect((served.body as { citizens: Array<{ avatar: unknown }> }).citizens[0].avatar).toBeNull();
    expect(JSON.stringify(served.body)).not.toMatch(/svg|zzzzz/);

    // Re-teleport with a valid avatar sets it; a later bad one keeps it.
    await handleTeleport({ token: 'secret-token', snapshot: snap() }, store, OPTS);
    expect((await store.findByTokenHash(hashToken('secret-token')))!.avatar).toBe('chibi-3');
    await handleTeleport({ token: 'secret-token', snapshot: bad }, store, OPTS);
    expect((await store.findByTokenHash(hashToken('secret-token')))!.avatar).toBe('chibi-3');

    const ev = await handleEvents(
      {
        token: 'secret-token',
        events: [{ type: 'commit', ts: T0 }],
        snapshot: { ...bad, mood: 'grumpy' },
      },
      store,
      LATER
    );
    expect(ev).toMatchObject({ status: 200, body: { accepted: 1 } });
    const row = (await store.findByTokenHash(hashToken('secret-token')))!;
    expect(row.mood).toBe('grumpy'); // the snapshot was applied
    expect(row.avatar).toBe('chibi-3');
  });
});

describe('one snapshot gate for every path (release audit B14)', () => {
  let store: SqliteWorldStore;
  beforeEach(() => {
    store = new SqliteWorldStore(new Database(':memory:'));
  });

  it('teleport and warp (re-teleport) reject a profane name', async () => {
    const tp = await handleTeleport({ token: 'secret-token', snapshot: snap({ name: 'fuckface' }) }, store, OPTS);
    expect(tp).toMatchObject({ status: 400, body: { error: 'name rejected by filter' } });
    await handleTeleport({ token: 'secret-token', snapshot: snap() }, store, OPTS);
    const warp = await handleTeleport(
      { token: 'secret-token', snapshot: snap({ name: 'fuckface' }), district: 'Payon' },
      store,
      OPTS
    );
    expect(warp.status).toBe(400);
    expect((await store.findByTokenHash(hashToken('secret-token')))!.name).toBe('Shadowpaw');
  });

  it('/v1/events rejects a rename to a profane name and writes nothing', async () => {
    await handleTeleport({ token: 'secret-token', snapshot: snap() }, store, OPTS);
    const res = await handleEvents(
      { token: 'secret-token', events: [{ type: 'commit', ts: T0 }], snapshot: snap({ name: 'b1tch' }) },
      store,
      LATER
    );
    expect(res).toMatchObject({ status: 400, body: { error: 'name rejected by filter' } });
    expect((await store.findByTokenHash(hashToken('secret-token')))!.name).toBe('Shadowpaw');
    expect((await store.district('plaza-1', 0, Number.MAX_SAFE_INTEGER)).events).toHaveLength(0);
  });

  it('teleport and /v1/events store names with bidi/control characters stripped', async () => {
    await handleTeleport({ token: 'secret-token', snapshot: snap({ name: '‮Shadowpaw' }) }, store, OPTS);
    expect((await store.findByTokenHash(hashToken('secret-token')))!.name).toBe('Shadowpaw');
    const res = await handleEvents(
      { token: 'secret-token', events: [], snapshot: snap({ name: 'Night⁦paw\u0007' }) },
      store,
      LATER
    );
    expect(res.status).toBe(200);
    expect((await store.findByTokenHash(hashToken('secret-token')))!.name).toBe('Nightpaw');
  });
});

describe('browser identity handlers', () => {
  let store: SqliteWorldStore;
  const TOKEN = 'real-world-token-abcdef';

  beforeEach(async () => {
    store = new SqliteWorldStore(new Database(':memory:'));
    await handleTeleport({ token: TOKEN, snapshot: snap() }, store, OPTS);
  });

  // Drives the full link → session → me exchange and returns the pieces.
  async function link(now = T0) {
    const linkRes = await handleBrowserLink({ token: TOKEN }, store, { ...OPTS, now });
    expect(linkRes.status).toBe(200);
    const code = (linkRes.body as { code: string }).code;
    const sessRes = await handleBrowserSession({ code }, store, { ...OPTS, now });
    expect(sessRes.status).toBe(200);
    const controlToken = (sessRes.body as { controlToken: string }).controlToken;
    return { code, controlToken, linkRes, sessRes };
  }

  it('link → session → me returns the owner slug, district, capabilities', async () => {
    const { controlToken } = await link();
    const meRes = await handleMe(controlToken, store, OPTS);
    expect(meRes.status).toBe(200);
    const body = meRes.body as { slug: string; district: string; capabilities: string[] };
    expect(body.slug).toMatch(/^shadowpaw-/);
    expect(body.district).toBe('plaza-1');
    expect(body.capabilities).toContain('move');
    expect(body.capabilities).toContain('portal_warp');
  });

  it('browser-link with an unknown world token is rejected 401', async () => {
    const res = await handleBrowserLink({ token: 'not-a-real-token' }, store, OPTS);
    expect(res.status).toBe(401);
  });

  it('a one-time code is single-use: the second exchange fails', async () => {
    const linkRes = await handleBrowserLink({ token: TOKEN }, store, OPTS);
    const code = (linkRes.body as { code: string }).code;
    const first = await handleBrowserSession({ code }, store, OPTS);
    expect(first.status).toBe(200);
    const second = await handleBrowserSession({ code }, store, OPTS);
    expect(second.status).toBe(401);
  });

  it('an expired link code cannot be exchanged', async () => {
    const linkRes = await handleBrowserLink({ token: TOKEN }, store, { ...OPTS, now: T0 });
    const code = (linkRes.body as { code: string }).code;
    // Well past any sane short TTL.
    const res = await handleBrowserSession({ code }, store, { ...OPTS, now: T0 + 3_600_000 });
    expect(res.status).toBe(401);
  });

  it('/v1/me on an anon buddy returns the REAL slug, not the masked one', async () => {
    await store.setAnon(hashToken(TOKEN), true);
    const realSlug = (await store.findByTokenHash(hashToken(TOKEN)))!.slug;
    const { controlToken } = await link();
    const meRes = await handleMe(controlToken, store, OPTS);
    const body = meRes.body as { slug: string };
    expect(body.slug).toBe(realSlug);
    expect(body.slug).not.toMatch(/^anon-/);
  });

  it('/v1/me rejects a missing or bogus control token', async () => {
    expect((await handleMe(undefined, store, OPTS)).status).toBe(401);
    expect((await handleMe('garbage', store, OPTS)).status).toBe(401);
  });

  it('an expired control token is rejected by /v1/me', async () => {
    const { controlToken } = await link(T0);
    const res = await handleMe(controlToken, store, { ...OPTS, now: T0 + 400 * 86_400_000 });
    expect(res.status).toBe(401);
  });

  it('the scoped control token cannot recall, write XP, or move the owner citizen', async () => {
    const { controlToken } = await link();
    const before = (await store.findByTokenHash(hashToken(TOKEN)))!;

    // recall/events authenticate against citizens.token_hash — a control token
    // is a different secret in a different table, so both 401 and the owner is safe.
    expect((await handleRecall({ token: controlToken, purge: true }, store)).status).toBe(401);
    expect(
      (await handleEvents({ token: controlToken, events: [{ type: 'commit', ts: T0 }] }, store, OPTS)).status
    ).toBe(401);

    // Even posting it to /v1/teleport (which auto-creates for any token) cannot
    // mutate the OWNER's real citizen — the control token isn't its world token.
    await handleTeleport(
      { token: controlToken, snapshot: snap({ level: 9, xp: totalXpForLevel(9) }), district: 'Geffen' },
      store,
      OPTS
    );
    const after = (await store.findByTokenHash(hashToken(TOKEN)))!;
    expect(after.district).toBe(before.district);
    expect(after.level).toBe(before.level);
    expect(after.xp).toBe(before.xp);
  });

  // Fill a town to a given visible population using ordinary teleports, all
  // last seen at `now` (default T0 = "just now" for the tests below).
  async function fill(district: string, n: number, now = T0) {
    for (let i = 0; i < n; i++) {
      const res = await handleTeleport(
        { token: `filler-${district}-${now}-${i}-000000`, snapshot: snap({ name: `Fill${i}` }), district },
        store,
        { ...OPTS, now }
      );
      expect(res.status).toBe(200);
    }
  }

  it('portal-warp moves district ONLY — the scoped token never writes xp/level', async () => {
    const { controlToken } = await link();
    const before = (await store.findByTokenHash(hashToken(TOKEN)))!;
    const res = await handlePortalWarp({ controlToken, to: 'Geffen' }, store, OPTS);
    expect(res.status).toBe(200);
    const body = res.body as { district: string; url: string; spawn: { x: number; y: number } };
    expect(body.district).toBe('plaza-3');
    expect(body.url).toContain('district=plaza-3');
    const after = (await store.findByTokenHash(hashToken(TOKEN)))!;
    expect(after.district).toBe('plaza-3'); // moved
    expect(after.xp).toBe(before.xp); // ...but xp/level/bucket untouched
    expect(after.level).toBe(before.level);
    expect(after.xp_bucket).toBe(before.xp_bucket);
  });

  it('portal-warp is idempotent: warping into your CURRENT town returns success', async () => {
    const { controlToken } = await link(); // owner is in plaza-1
    const res = await handlePortalWarp({ controlToken, to: 'plaza-1' }, store, OPTS);
    expect(res.status).toBe(200);
    expect((res.body as { district: string }).district).toBe('plaza-1');
  });

  it('portal-warp returns 409 when the destination town is full', async () => {
    const { controlToken } = await link(); // owner in plaza-1
    await fill('plaza-2', DISTRICT_CAPACITY);
    const res = await handlePortalWarp({ controlToken, to: 'Payon' }, store, OPTS);
    expect(res.status).toBe(409);
    // ...and the owner did NOT move.
    expect((await store.findByTokenHash(hashToken(TOKEN)))!.district).toBe('plaza-1');
  });

  it('portal-warp never bounces someone ALREADY in a full destination (idempotent)', async () => {
    const { controlToken } = await link();
    // Owner walks into plaza-2 first (room has space), then it fills to the cap
    // (owner is one of the 80). A repeat warp into their own full town succeeds.
    expect((await handlePortalWarp({ controlToken, to: 'plaza-2' }, store, OPTS)).status).toBe(200);
    await fill('plaza-2', DISTRICT_CAPACITY - 1);
    const again = await handlePortalWarp({ controlToken, to: 'plaza-2' }, store, OPTS);
    expect(again.status).toBe(200);
  });

  it('portal-warp is scoped-token-only: a world token cannot use it (401)', async () => {
    await link();
    // TOKEN is the real world token, not a browser control token — rejected.
    expect((await handlePortalWarp({ controlToken: TOKEN, to: 'plaza-2' }, store, OPTS)).status).toBe(401);
    expect((await handlePortalWarp({ to: 'plaza-2' }, store, OPTS)).status).toBe(401);
    expect((await handlePortalWarp({ controlToken: 'x', to: 'plaza-2' }, store, OPTS)).status).toBe(401);
  });

  it('portal-warp rejects an unknown destination town (400)', async () => {
    const { controlToken } = await link();
    expect((await handlePortalWarp({ controlToken, to: 'Atlantis' }, store, OPTS)).status).toBe(400);
    expect((await handlePortalWarp({ controlToken, to: 42 as unknown as string }, store, OPTS)).status).toBe(400);
  });

  it('portal-warp enforces hub-and-spoke: a satellite cannot warp straight to another satellite', async () => {
    const { controlToken } = await link(); // owner in plaza-1 (hub)
    // Legit: hub → satellite plaza-2.
    expect((await handlePortalWarp({ controlToken, to: 'plaza-2' }, store, OPTS)).status).toBe(200);
    // Forged frame: from plaza-2, ask for plaza-3 directly. The map has no such
    // edge (satellites only link through Prontera), so the server refuses even
    // though plaza-3 is a real town — `from` is server-derived, not spoofable.
    const res = await handlePortalWarp({ controlToken, to: 'plaza-3' }, store, OPTS);
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('no_portal');
    // ...and the owner stayed in plaza-2.
    expect((await store.findByTokenHash(hashToken(TOKEN)))!.district).toBe('plaza-2');
    // Returning to the hub IS a valid edge.
    expect((await handlePortalWarp({ controlToken, to: 'plaza-1' }, store, OPTS)).status).toBe(200);
  });

  it('portal-warp capacity counts only VISIBLE citizens (a recalled buddy frees a slot)', async () => {
    const { controlToken } = await link(); // owner in plaza-1
    await fill('plaza-2', DISTRICT_CAPACITY); // town is full of visible buddies
    expect((await handlePortalWarp({ controlToken, to: 'plaza-2' }, store, OPTS)).status).toBe(409);
    // Recall (hide) one occupant — capacity must now reflect the visible count.
    await handleRecall({ token: `filler-plaza-2-${T0}-0-000000`, purge: false }, store);
    const res = await handlePortalWarp({ controlToken, to: 'plaza-2' }, store, OPTS);
    expect(res.status).toBe(200); // the hidden buddy no longer occupies a slot
  });

  // Release audit B2: capacity used to count every citizen EVER created, so a
  // town filled up for good and stayed full.
  it('capacity counts only RECENT residents: long-gone citizens free their slots', async () => {
    const { controlToken } = await link(); // owner in plaza-1
    // 80 buddies moved into Payon once, then their owners went quiet for longer
    // than the resident window. They no longer occupy the town.
    await fill('plaza-2', DISTRICT_CAPACITY, T0 - RESIDENT_WINDOW_MS - 1);
    expect((await handlePortalWarp({ controlToken, to: 'Payon' }, store, OPTS)).status).toBe(200);
    expect((await store.findByTokenHash(hashToken(TOKEN)))!.district).toBe('plaza-2');
    // A named teleport into the same town is admitted too.
    const tp = await handleTeleport({ token: 'newcomer-0123456789', snapshot: snap(), district: 'Payon' }, store, OPTS);
    expect(tp.status).toBe(200);
  });

  it('a long-gone citizen who syncs again counts toward capacity again', async () => {
    const { controlToken } = await link();
    await fill('plaza-2', DISTRICT_CAPACITY - 1); // 79 recent
    await fill('plaza-2', 1, T0 - RESIDENT_WINDOW_MS - 1); // +1 stale: still room for one
    // The stale owner comes back and syncs (events bump last_seen_at).
    const stale = `filler-plaza-2-${T0 - RESIDENT_WINDOW_MS - 1}-0-000000`;
    expect((await handleEvents({ token: stale, events: [{ type: 'commit', ts: T0 }] }, store, OPTS)).status).toBe(200);
    // Now 80 residents: full.
    expect((await handlePortalWarp({ controlToken, to: 'Payon' }, store, OPTS)).status).toBe(409);
  });

  it('the hub is never full: newcomers always land and satellites can always portal home', async () => {
    const { controlToken } = await link();
    // Owner walks out to Payon while Prontera is quiet.
    expect((await handlePortalWarp({ controlToken, to: 'Payon' }, store, OPTS)).status).toBe(200);
    // Prontera packs past the satellite cap (fill() asserts each named
    // teleport into the hub succeeds: the hub is not capacity-gated).
    await fill('plaza-1', DISTRICT_CAPACITY + 5);
    // A brand-new buddy still lands in the hub...
    const fresh = await handleTeleport({ token: 'latecomer-0123456789', snapshot: snap() }, store, OPTS);
    expect(fresh.status).toBe(200);
    expect((fresh.body as { district: string }).district).toBe('plaza-1');
    // ...and the satellite resident's one portal home never 409s.
    const home = await handlePortalWarp({ controlToken, to: 'Prontera' }, store, OPTS);
    expect(home.status).toBe(200);
    expect((await store.findByTokenHash(hashToken(TOKEN)))!.district).toBe('plaza-1');
  });

  it('teleport refuses a NEW citizen when the per-network throttle says no (429); nothing is created', async () => {
    let calls = 0;
    const throttled = { ...OPTS, allowNewCitizen: () => ++calls <= 2 };
    expect((await handleTeleport({ token: 'minted-0-0123456789', snapshot: snap() }, store, throttled)).status).toBe(200);
    expect((await handleTeleport({ token: 'minted-1-0123456789', snapshot: snap() }, store, throttled)).status).toBe(200);
    const third = await handleTeleport({ token: 'minted-2-0123456789', snapshot: snap(), district: 'Payon' }, store, throttled);
    expect(third.status).toBe(429);
    expect(await store.findByTokenHash(hashToken('minted-2-0123456789'))).toBeNull();
    // Existing citizens are never throttled: a re-teleport/warp still works and
    // doesn't consult the new-citizen budget.
    const again = await handleTeleport({ token: TOKEN, snapshot: snap(), district: 'Payon' }, store, throttled);
    expect(again.status).toBe(200);
    expect(calls).toBe(3); // only the three NEW attempts consulted it
  });

  it('an expired control token cannot portal-warp', async () => {
    const { controlToken } = await link(T0);
    const res = await handlePortalWarp({ controlToken, to: 'plaza-2' }, store, { ...OPTS, now: T0 + 400 * 86_400_000 });
    expect(res.status).toBe(401);
  });

  it('recall --purge deletes the citizen link codes and browser sessions', async () => {
    const { code, controlToken } = await link();
    // Mint a second, still-unused code to prove codes are purged too.
    const spare = (await handleBrowserLink({ token: TOKEN }, store, OPTS).then((r) => r.body)) as { code: string };

    const recall = await handleRecall({ token: TOKEN, purge: true }, store);
    expect(recall.status).toBe(200);

    // The live control token no longer resolves to a citizen.
    expect((await handleMe(controlToken, store, OPTS)).status).toBe(401);
    // Neither code can be exchanged anymore.
    expect((await handleBrowserSession({ code }, store, OPTS)).status).toBe(401);
    expect((await handleBrowserSession({ code: spare.code }, store, OPTS)).status).toBe(401);
    expect(await store.findCitizenByBrowserToken(hashToken(controlToken), T0)).toBeNull();
  });
});

// B9: privacy changes made over HTTP (recall, purge, anon) must reach the live
// room — the control token stops authenticating and the room is notified.
describe('recall / anon reach live rooms', () => {
  let db: Database.Database;
  let store: SqliteWorldStore;
  let notices: RoomNotice[];
  const notify = async (n: RoomNotice) => {
    notices.push(n);
  };
  const TOKEN = 'live-room-token-abcdef';

  beforeEach(async () => {
    db = new Database(':memory:');
    store = new SqliteWorldStore(db);
    notices = [];
    await handleTeleport({ token: TOKEN, snapshot: snap() }, store, OPTS);
  });

  async function controlToken(): Promise<string> {
    const code = ((await handleBrowserLink({ token: TOKEN }, store, OPTS)).body as { code: string }).code;
    return ((await handleBrowserSession({ code }, store, OPTS)).body as { controlToken: string }).controlToken;
  }
  const citizenId = async () => (await store.findByTokenHash(hashToken(TOKEN)))!.id;

  it('recall (no purge) revokes control tokens: /v1/me, portal-warp and the room hello all fail', async () => {
    const ct = await controlToken();
    expect((await handleMe(ct, store, OPTS)).status).toBe(200);
    expect((await handleRecall({ token: TOKEN, purge: false }, store)).status).toBe(200);
    expect(await store.findCitizenByBrowserToken(hashToken(ct), T0)).toBeNull();
    expect((await handleMe(ct, store, OPTS)).status).toBe(401);
    expect((await handlePortalWarp({ controlToken: ct, to: 'plaza-2' }, store, OPTS)).status).toBe(401);
  });

  it('a hidden citizen never authenticates by control token, even if a session row survived', async () => {
    const ct = await controlToken();
    db.prepare('UPDATE citizens SET hidden = 1').run(); // hidden, session untouched
    expect(await store.findCitizenByBrowserToken(hashToken(ct), T0)).toBeNull();
    expect((await handleMe(ct, store, OPTS)).status).toBe(401);
  });

  it('re-teleporting after a recall does not resurrect the old control token', async () => {
    const ct = await controlToken();
    await handleRecall({ token: TOKEN, purge: false }, store);
    await handleTeleport({ token: TOKEN, snapshot: snap() }, store, OPTS);
    expect((await handleMe(ct, store, OPTS)).status).toBe(401);
    expect((await handleMe(await controlToken(), store, OPTS)).status).toBe(200); // a fresh link works
  });

  it('recall and purge tell the rooms to evict the citizen', async () => {
    const id = await citizenId();
    await handleRecall({ token: TOKEN, purge: false }, store, notify);
    expect(notices).toEqual([{ kind: 'evict', citizenId: id }]);

    notices = [];
    await handleRecall({ token: TOKEN, purge: true }, store, notify);
    expect(notices).toEqual([{ kind: 'evict', citizenId: id }]);
  });

  it('an unknown token notifies no room', async () => {
    expect((await handleRecall({ token: 'nobody-0000000000', purge: true }, store, notify)).status).toBe(401);
    expect((await handleAnon({ token: 'nobody-0000000000', anon: true }, store, notify)).status).toBe(401);
    expect(notices).toEqual([]);
  });

  // B18: the owner can sign every browser out without leaving the world.
  it('revoke ends every control token and unused link code, and tells the rooms to evict', async () => {
    const ct1 = await controlToken();
    const ct2 = await controlToken();
    const unused = ((await handleBrowserLink({ token: TOKEN }, store, OPTS)).body as { code: string }).code;

    const res = await handleRevokeBrowserSessions({ token: TOKEN }, store, notify);
    expect(res).toEqual({ status: 200, body: { revoked: 2 } });
    expect((await handleMe(ct1, store, OPTS)).status).toBe(401);
    expect((await handleMe(ct2, store, OPTS)).status).toBe(401);
    expect((await handlePortalWarp({ controlToken: ct1, to: 'plaza-2' }, store, OPTS)).status).toBe(401);
    expect((await handleBrowserSession({ code: unused }, store, OPTS)).status).toBe(401);
    expect(notices).toEqual([{ kind: 'evict', citizenId: await citizenId(), reason: 'revoked' }]);

    // The buddy stays in the world, and the owner can link a browser again.
    expect((await store.findByTokenHash(hashToken(TOKEN)))!.hidden).toBe(false);
    expect((await handleMe(await controlToken(), store, OPTS)).status).toBe(200);
  });

  it('revoke needs the world token: a control token or unknown token is refused, and no room is told', async () => {
    const ct = await controlToken();
    expect((await handleRevokeBrowserSessions({ token: ct }, store, notify)).status).toBe(401);
    expect((await handleRevokeBrowserSessions({ token: 'nobody-0000000000' }, store, notify)).status).toBe(401);
    expect((await handleRevokeBrowserSessions({}, store, notify)).status).toBe(400);
    expect(notices).toEqual([]);
    expect((await handleMe(ct, store, OPTS)).status).toBe(200); // untouched
  });

  it('anon on relabels the live actor with EXACTLY the /v1/world masked slug; anon off restores it', async () => {
    const id = await citizenId();
    const real = (await store.findByTokenHash(hashToken(TOKEN)))!.slug;

    await handleAnon({ token: TOKEN, anon: true }, store, notify);
    const world = (await handleWorld('plaza-1', store, OPTS)).body as { citizens: Array<{ slug: string }> };
    expect(notices).toEqual([{ kind: 'relabel', citizenId: id, slug: world.citizens[0].slug }]);
    expect(world.citizens[0].slug).toBe(publicSlug({ slug: real, anon: true }));
    expect(world.citizens[0].slug).not.toBe(real);

    notices = [];
    await handleAnon({ token: TOKEN, anon: false }, store, notify);
    expect(notices).toEqual([{ kind: 'relabel', citizenId: id, slug: real }]);
  });
});

// B10: an anon buddy must not be re-identifiable from public payloads.
describe('anon masking is keyed and anon payloads are minimal (B10)', () => {
  let store: SqliteWorldStore;
  const SECRET = 'test-anon-secret-0123456789';
  const WITH_SECRET = { ...OPTS, anonSecret: SECRET };

  beforeEach(() => {
    store = new SqliteWorldStore(new Database(':memory:'));
  });

  it('the mask is an HMAC under the server secret, not a hash anyone can recompute from the slug', () => {
    const c = { slug: 'shadowpaw-ab12', anon: true };
    const unkeyed = `anon-${hashToken(c.slug).slice(0, 6)}`; // the old, precomputable mask
    expect(publicSlug(c, SECRET)).toMatch(/^anon-[0-9a-f]{6}$/);
    expect(publicSlug(c, SECRET)).not.toBe(unkeyed);
    expect(publicSlug(c, SECRET)).toBe(publicSlug(c, SECRET)); // stable for the room <-> plaza match
    expect(publicSlug(c, SECRET)).not.toBe(publicSlug(c, 'another-secret'));
    expect(publicSlug(c)).not.toBe(unkeyed); // the dev fallback is keyed too
    expect(publicSlug({ ...c, anon: false }, SECRET)).toBe('shadowpaw-ab12'); // non-anon untouched
  });

  it('/v1/world, announcements and the live relabel all use the configured secret', async () => {
    const notices: RoomNotice[] = [];
    await handleTeleport({ token: 'tok-keyed-000000', snapshot: snap() }, store, OPTS);
    const real = (await store.findByTokenHash(hashToken('tok-keyed-000000')))!;
    await store.recordEvents(real.id, [{ type: 'level_up', ts: T0 - 1 }]);
    await handleAnon({ token: 'tok-keyed-000000', anon: true }, store, async (n) => void notices.push(n), {
      anonSecret: SECRET,
    });
    const expected = publicSlug({ slug: real.slug, anon: true }, SECRET);

    const world = (await handleWorld('plaza-1', store, WITH_SECRET)).body as { citizens: Array<{ slug: string }> };
    expect(world.citizens[0].slug).toBe(expected);
    const ann = (await handleAnnouncements(store, WITH_SECRET)).body as { announcements: Array<{ slug: string }> };
    expect(ann.announcements[0].slug).toBe(expected);
    expect(notices).toEqual([{ kind: 'relabel', citizenId: real.id, slug: expected }]);
  });

  it('an anon citizen carries only what the plaza renders, coarsened', async () => {
    await handleTeleport({ token: 'tok-minimal-0000', snapshot: snap({ hat: 'crown', eye: '◉' }) }, store, OPTS);
    await store.setAnon(hashToken('tok-minimal-0000'), true);
    const real = (await store.findByTokenHash(hashToken('tok-minimal-0000')))!;

    const body = (await handleWorld('plaza-1', store, { ...WITH_SECRET, now: T0 + 90_000 })).body as {
      citizens: Array<Record<string, unknown>>;
    };
    const c = body.citizens[0];
    expect(Object.keys(c).sort()).toEqual(
      ['anon', 'avatar', 'country', 'district', 'eye', 'last_seen_at', 'level', 'mood', 'name', 'shiny', 'slug', 'species', 'stats'].sort()
    );
    expect(c).toMatchObject({ name: 'a wild Void Cat', species: 'Void Cat', level: 5, country: null, anon: true, eye: '·' });
    // Only WHICH stat leads (chaos: 80 in snap()), not the five numbers.
    expect(c.stats).toEqual({ chaos: 1 });
    // No created_at / xp / hat / skin / rarity, and no millisecond activity.
    expect(c.last_seen_at).toBe(T0 + 60_000); // the minute, not T0 itself
    const wire = JSON.stringify(body);
    expect(wire).not.toContain(real.slug);
    expect(wire).not.toContain('Shadowpaw');
    expect(wire).not.toContain('crown');
    expect(wire).not.toContain('◉');
    expect(wire).not.toContain(String(real.created_at));
  });

  it('a non-anon citizen is unchanged', async () => {
    await handleTeleport({ token: 'tok-public-00000', snapshot: snap() }, store, OPTS);
    const body = (await handleWorld('plaza-1', store, WITH_SECRET)).body as { citizens: Array<Record<string, unknown>> };
    expect(body.citizens[0]).toMatchObject({
      name: 'Shadowpaw',
      xp: totalXpForLevel(5) + 3,
      stats: { debugging: 60, patience: 40, chaos: 80, wisdom: 30, snark: 70 },
      created_at: T0,
      last_seen_at: T0,
      hat: 'none',
      rarity: 'rare',
    });
  });

  it('coarse last_seen_at keeps the plaza states: active (<15m), idle, long-AFK (>=3h)', () => {
    const now = T0 + 12_345;
    const ACTIVE_WINDOW_MS = 15 * 60_000; // plaza.js
    const IDLE_SIT_MS = 3 * 60 * 60_000; // plaza.js
    const state = (ls: number, clientNow = now) => {
      const age = clientNow - ls;
      return age < ACTIVE_WINDOW_MS ? 'active' : age >= IDLE_SIT_MS ? 'sit' : 'idle';
    };
    for (const [ago, expected] of [
      [0, 'active'],
      [14 * 60_000, 'active'],
      [16 * 60_000, 'idle'],
      [2.9 * 3_600_000, 'idle'],
      [3.1 * 3_600_000, 'sit'],
      [30 * 86_400_000, 'sit'],
    ] as const) {
      const coarse = coarseLastSeen(now - ago, now);
      expect(coarse % 60_000).toBe(0); // minute grain, never the real ms
      expect(state(coarse), `${ago}ms ago`).toBe(expected);
      // A viewer whose clock is a few minutes off still sees the same state.
      expect(state(coarse, now + 5 * 60_000)).toBe(expected);
    }
  });
});
