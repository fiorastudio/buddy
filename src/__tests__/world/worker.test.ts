import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createWorldFetchHandler } from '../../world/worker-core.js';
import { sqliteAsD1 } from './d1-shim.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import type { WorldSnapshot } from '../../lib/world/validate.js';

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
    avatar: 'chibi-1',
    ...overrides,
  };
}

const TOKEN = 'tok-0123456789abcdef';

describe('world worker fetch handler', () => {
  let fetchHandler: (req: Request) => Promise<Response>;

  beforeEach(() => {
    fetchHandler = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      ratePerMinute: 60,
    });
  });

  async function post(path: string, body: unknown): Promise<Response> {
    return fetchHandler(
      new Request(`https://world.example.com${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
  }

  it('teleport then world roundtrip works over HTTP', async () => {
    const tp = await post('/v1/teleport', { token: TOKEN, snapshot: snap() });
    expect(tp.status).toBe(200);
    const tpBody = (await tp.json()) as { slug: string; district: string };

    const world = await fetchHandler(new Request(`https://world.example.com/v1/world/${tpBody.district}`));
    expect(world.status).toBe(200);
    const worldBody = (await world.json()) as { citizens: Array<{ slug: string }> };
    expect(worldBody.citizens.map((c) => c.slug)).toContain(tpBody.slug);
  });

  it('GET /v1/announcements returns the global celebration feed with CORS', async () => {
    await post('/v1/teleport', { token: TOKEN, snapshot: snap() });
    await post('/v1/events', { token: TOKEN, events: [{ type: 'level_up', ts: 1_800_000_100_000 }] });

    const res = await fetchHandler(new Request('https://world.example.com/v1/announcements'));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { announcements: Array<{ type: string; town: string; name: string }> };
    expect(body.announcements.some((a) => a.type === 'level_up')).toBe(true);
    expect(body.announcements[0].town).toBe('Prontera');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetchHandler(new Request('https://world.example.com/v1/nonsense'));
    expect(res.status).toBe(404);
  });

  it('returns 400 on malformed JSON', async () => {
    const res = await fetchHandler(
      new Request('https://world.example.com/v1/teleport', { method: 'POST', body: '{not json' })
    );
    expect(res.status).toBe(400);
  });

  it('rate limits abusive clients by token', async () => {
    const tight = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      ratePerMinute: 2,
    });
    const req = () =>
      tight(
        new Request('https://world.example.com/v1/events', {
          method: 'POST',
          body: JSON.stringify({ token: TOKEN, events: [] }),
        })
      );
    await req();
    await req();
    const third = await req();
    expect(third.status).toBe(429);
  });

  it('rotating bogus tokens cannot evade the per-IP rate limit', async () => {
    const tight = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      ratePerMinute: 2,
    });
    const req = (i: number) =>
      tight(
        new Request('https://world.example.com/v1/events', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '203.0.113.7' },
          body: JSON.stringify({ token: `rotating-token-${i}-0123456789abcdef`, events: [] }),
        })
      );
    await req(0);
    await req(1);
    const third = await req(2); // fresh token every time, same IP
    expect(third.status).toBe(429);
  });

  it('sets CORS headers so the plaza page can fetch world state', async () => {
    const res = await fetchHandler(new Request('https://world.example.com/v1/world/plaza-1'));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('browser-link → browser-session → me works end-to-end over HTTP', async () => {
    await post('/v1/teleport', { token: TOKEN, snapshot: snap() });

    const link = await post('/v1/browser-link', { token: TOKEN });
    expect(link.status).toBe(200);
    const { code } = (await link.json()) as { code: string };

    const session = await post('/v1/browser-session', { code });
    expect(session.status).toBe(200);
    const { controlToken } = (await session.json()) as { controlToken: string };

    const me = await fetchHandler(
      new Request('https://world.example.com/v1/me', {
        headers: { authorization: `Bearer ${controlToken}` },
      })
    );
    expect(me.status).toBe(200);
    const body = (await me.json()) as { slug: string; district: string; capabilities: string[] };
    expect(body.slug).toMatch(/^shadowpaw-/);
    expect(body.district).toBe('plaza-1');
    expect(body.capabilities).toEqual(['move', 'portal_warp']);
  });

  it('GET /v1/me without a Bearer control token is 401', async () => {
    const res = await fetchHandler(new Request('https://world.example.com/v1/me'));
    expect(res.status).toBe(401);
  });
});

describe('world worker live (WS upgrade) routing', () => {
  // Fake DO namespace: records the resolved district and returns a raw 101 so we
  // can assert the worker forwards the upgrade untouched (no json()/CORS wrap).
  function makeHandlerWithRoom() {
    const seen: { district?: string; url?: string } = {};
    const roomNamespace = {
      idFromName(name: string) {
        seen.district = name;
        return { toString: () => name };
      },
      get(_id: unknown) {
        return {
          async fetch(req: Request) {
            seen.url = req.url;
            // Node's Response can't hold status 101 (that's asserted in the
            // workerd integration test); use a marker header to prove the worker
            // forwards the DO's response RAW, unwrapped by json()/CORS.
            return new Response(null, { status: 200, headers: { 'x-room-forwarded': '1' } });
          },
        };
      },
    };
    const handler = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      roomNamespace,
    });
    return { handler, seen };
  }

  const upgrade = (path: string) =>
    new Request(`https://world.example.com${path}`, { headers: { Upgrade: 'websocket' } });

  it('a websocket upgrade to a valid town is forwarded RAW to the room', async () => {
    const { handler, seen } = makeHandlerWithRoom();
    const res = await handler(upgrade('/v1/live/plaza-1'));
    expect(seen.district).toBe('plaza-1'); // keyed by the validated district
    expect(seen.url).toContain('district=plaza-1'); // district forwarded to the DO
    expect(res.headers.get('x-room-forwarded')).toBe('1'); // DO response passed through
    expect(res.headers.get('access-control-allow-origin')).toBeNull(); // NOT json()/CORS-wrapped
  });

  it('accepts a town by name and resolves it to a district', async () => {
    const { handler, seen } = makeHandlerWithRoom();
    const res = await handler(upgrade('/v1/live/payon'));
    expect(seen.district).toBe('plaza-2');
    expect(res.headers.get('x-room-forwarded')).toBe('1');
  });

  it('an unknown town is 404, never forwarded', async () => {
    const { handler, seen } = makeHandlerWithRoom();
    const res = await handler(upgrade('/v1/live/atlantis'));
    expect(res.status).toBe(404);
    expect(seen.district).toBeUndefined();
  });

  it('reports 503 when no room namespace is bound', async () => {
    const handler = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
    });
    const res = await handler(upgrade('/v1/live/plaza-1'));
    expect(res.status).toBe(503);
  });

  it('a GET without the Upgrade header does not hijack the live path', async () => {
    const { handler } = makeHandlerWithRoom();
    const res = await handler(new Request('https://world.example.com/v1/live/plaza-1'));
    expect(res.status).toBe(404); // falls through to not-found, not a 101
  });
});
