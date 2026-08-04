import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteWorldStore } from '../../lib/world/store.js';
import {
  handleTeleport,
  handleEvents,
  handleRecall,
  handleWorld,
  handleBrowserLink,
  handleBrowserSession,
  handleMe,
  handlePortalWarp,
  hashToken,
  RateLimiter,
} from '../../lib/world/handlers.js';
import { DISTRICT_CAPACITY } from '../../lib/world/districts.js';
import { totalXpForLevel } from '../../lib/leveling.js';
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

  // Fill a town to a given visible population using ordinary teleports.
  async function fill(district: string, n: number) {
    for (let i = 0; i < n; i++) {
      await handleTeleport(
        { token: `filler-${district}-${i}-000000`, snapshot: snap({ name: `Fill${i}` }), district },
        store,
        OPTS
      );
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
    await handleRecall({ token: 'filler-plaza-2-0-000000', purge: false }, store);
    const res = await handlePortalWarp({ controlToken, to: 'plaza-2' }, store, OPTS);
    expect(res.status).toBe(200); // the hidden buddy no longer occupies a slot
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
