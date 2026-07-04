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
});
