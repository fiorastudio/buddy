import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createWorldFetchHandler, MAX_BODY_BYTES } from '../../world/worker-core.js';
import { MAX_EVENT_BATCH, WORLD_EVENT_TYPES } from '../../lib/world/schema-sql.js';
import { EYES, HATS } from '../../lib/types.js';
import { SPECIES_LIST } from '../../lib/species.js';
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
    // level_up is server-derived only, so a client-reported deploy drives the feed.
    await post('/v1/events', { token: TOKEN, events: [{ type: 'deploy', ts: Date.now() }] });

    const res = await fetchHandler(new Request('https://world.example.com/v1/announcements'));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { announcements: Array<{ type: string; town: string; name: string }> };
    expect(body.announcements.some((a) => a.type === 'deploy')).toBe(true);
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

  it('throttles NEW citizens per IP so one network cannot mint a town-filling crowd (B2)', async () => {
    const tight = createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      ratePerMinute: 60,
      newCitizensPerDay: 2,
    });
    const teleport = (token: string, ip = '203.0.113.9') =>
      tight(
        new Request('https://world.example.com/v1/teleport', {
          method: 'POST',
          headers: { 'cf-connecting-ip': ip },
          body: JSON.stringify({ token, snapshot: snap() }),
        })
      );
    expect((await teleport('minted-0-0123456789abcdef')).status).toBe(200);
    expect((await teleport('minted-1-0123456789abcdef')).status).toBe(200);
    expect((await teleport('minted-2-0123456789abcdef')).status).toBe(429); // 3rd new citizen, same IP
    // Re-teleporting an EXISTING citizen is never throttled.
    expect((await teleport('minted-0-0123456789abcdef')).status).toBe(200);
    // Another network has its own budget.
    expect((await teleport('minted-3-0123456789abcdef', '198.51.100.4')).status).toBe(200);
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

// Release audit B16: rate limit before parsing, bounded body, object-only JSON.
describe('world worker request bodies', () => {
  const URL_EVENTS = 'https://world.example.com/v1/events';
  const longest = (xs: readonly string[]) => xs.reduce((a, b) => (Buffer.byteLength(b) > Buffer.byteLength(a) ? b : a));

  function handler(ratePerMinute = 1000) {
    return createWorldFetchHandler({
      db: sqliteAsD1(new Database(':memory:')),
      baseUrl: 'https://world.example.com',
      ratePerMinute,
    });
  }

  it('the largest legitimate request fits well inside the cap', async () => {
    const h = handler();
    const token = 'f'.repeat(32); // generateToken(): 32 hex chars
    expect((await h(new Request('https://world.example.com/v1/teleport', {
      method: 'POST',
      body: JSON.stringify({ token, snapshot: snap() }),
    }))).status).toBe(200);
    // Worst case: a full batch of the longest event type, a max-length name of
    // 3-byte characters, and the longest species/hat/eye.
    const body = JSON.stringify({
      token,
      events: Array.from({ length: MAX_EVENT_BATCH }, () => ({
        type: longest(WORLD_EVENT_TYPES),
        ts: Number.MAX_SAFE_INTEGER,
      })),
      snapshot: snap({ name: '鬼'.repeat(32), species: longest(SPECIES_LIST), hat: longest(HATS), eye: longest(EYES) }),
    });
    expect(Buffer.byteLength(body)).toBeLessThan(MAX_BODY_BYTES / 4);
    const res = await h(new Request(URL_EVENTS, { method: 'POST', body }));
    expect(res.status).toBe(200);
  });

  it('rejects a body over the cap with 413 (no content-length needed)', async () => {
    const body = JSON.stringify({ token: TOKEN, events: [], pad: 'x'.repeat(MAX_BODY_BYTES) });
    const res = await handler()(new Request(URL_EVENTS, { method: 'POST', body }));
    expect(res.status).toBe(413);
  });

  it('rejects a declared content-length over the cap without reading the body', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new TextEncoder().encode('{}'));
        controller.close();
      },
    }, { highWaterMark: 0 }); // no eager pull: only a real read pulls
    const req = new Request(URL_EVENTS, {
      method: 'POST',
      headers: { 'content-length': String(MAX_BODY_BYTES + 1) },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    const res = await handler()(req);
    expect(res.status).toBe(413);
    expect(pulled).toBe(0); // never read: the header check rejects first
  });

  it('stops reading an endless chunked body as soon as it passes the cap', async () => {
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = new Uint8Array(1024).fill(0x20); // whitespace: valid JSON padding
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request(URL_EVENTS, { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    const res = await handler()(req);
    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(MAX_BODY_BYTES * 2);
  });

  it('a lying (too small) content-length does not lift the cap', async () => {
    const body = JSON.stringify({ token: TOKEN, events: [], pad: 'x'.repeat(MAX_BODY_BYTES) });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const req = new Request(URL_EVENTS, {
      method: 'POST',
      headers: { 'content-length': '10' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect((await handler()(req)).status).toBe(413);
  });

  it('rejects JSON that is not an object with 400', async () => {
    const h = handler();
    for (const body of ['[]', '"token"', 'null', '42', 'true', '[{"token":"x"}]']) {
      const res = await h(new Request(URL_EVENTS, { method: 'POST', body }));
      expect(res.status, body).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/object/);
    }
  });

  it('rejects an empty body with 400', async () => {
    const res = await handler()(new Request(URL_EVENTS, { method: 'POST' }));
    expect(res.status).toBe(400);
  });

  it('applies the IP rate limit before reading or parsing the body', async () => {
    const h = handler(2);
    const ok = () =>
      h(new Request(URL_EVENTS, { method: 'POST', body: JSON.stringify({ token: TOKEN, events: [] }) }));
    await ok();
    await ok();
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.enqueue(new TextEncoder().encode('{not json'));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const limited = await h(new Request(URL_EVENTS, { method: 'POST', body: stream, duplex: 'half' } as RequestInit));
    expect(limited.status).toBe(429);
    expect(pulled).toBe(false);
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
