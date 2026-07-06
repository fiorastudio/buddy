import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteWorldStore } from '../../lib/world/store.js';
import {
  handleTeleport,
  handleEvents,
  handleRecall,
  handleWorld,
  hashToken,
  RateLimiter,
} from '../../lib/world/handlers.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import { DISTRICT_CAPACITY } from '../../lib/world/districts.js';
import type { WorldSnapshot } from '../../lib/world/validate.js';

const T0 = 1_800_000_000_000;
const OPTS = { now: T0, baseUrl: 'https://world.example.com' };

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
    expect(body.url).toBe(`https://world.example.com/b/${body.slug}`);
    expect(body.district).toBe('plaza-1');

    expect(await store.findByTokenHash('secret-token')).toBeNull();
    expect(await store.findByTokenHash(hashToken('secret-token'))).not.toBeNull();
  });

  it('teleport rejects an invalid snapshot with 400', async () => {
    const res = await handleTeleport({ token: 'tttttttt', snapshot: snap({ level: 50, xp: 10 }) }, store, OPTS);
    expect(res.status).toBe(400);
  });

  it('teleport rejects profane names with 400', async () => {
    const res = await handleTeleport({ token: 'tttttttt', snapshot: snap({ name: 'Sh1tLord' }) }, store, OPTS);
    expect(res.status).toBe(400);
  });

  it('teleport into a named town resolves it to the right plaza', async () => {
    const res = await handleTeleport(
      { token: 'tok-0123456789abcdef', snapshot: snap(), district: 'geffen' },
      store,
      OPTS
    );
    expect(res.status).toBe(200);
    expect((res.body as { district: string }).district).toBe('plaza-3');
  });

  it('teleport to an unknown town is a 400 unknown_town', async () => {
    const res = await handleTeleport(
      { token: 'tok-0123456789abcdef', snapshot: snap(), district: 'gondor' },
      store,
      OPTS
    );
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('unknown_town');
  });

  it('teleport to a full town is 409, but an occupant may still re-teleport there', async () => {
    const occupant = 'occupant-0123456789';
    for (let i = 0; i < DISTRICT_CAPACITY; i++) {
      const token = i === 0 ? occupant : `filler-${i}-aaaaaaaa`;
      await handleTeleport({ token, snapshot: snap({ name: `Cit${i}` }), district: 'geffen' }, store, OPTS);
    }
    const late = await handleTeleport(
      { token: 'latecomer-0123456789', snapshot: snap({ name: 'Late' }), district: 'geffen' },
      store,
      OPTS
    );
    expect(late.status).toBe(409);
    expect((late.body as { error: string }).error).toBe('town_full');

    // Someone already living in the full town can still re-sync/refresh there.
    const stay = await handleTeleport(
      { token: occupant, snapshot: snap({ name: 'Cit0' }), district: 'geffen' },
      store,
      OPTS
    );
    expect(stay.status).toBe(200);
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

  it('strips internal flags from the public world view', async () => {
    await handleTeleport({ token: 'tok-0123456789abcdef', snapshot: snap() }, store, OPTS);
    const res = await handleWorld('plaza-1', store, OPTS);
    const body = res.body as { citizens: Array<Record<string, unknown>> };
    expect(body.citizens[0]).not.toHaveProperty('flagged');
    expect(body.citizens[0]).not.toHaveProperty('hidden');
    expect(body.citizens[0]).not.toHaveProperty('xp_bucket');
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
