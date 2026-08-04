/// <reference types="@cloudflare/vitest-pool-workers" />
// Real-runtime integration test (workerd via @cloudflare/vitest-pool-workers).
// Everything else runs in the node pool; this file alone exercises a genuine
// WebSocketPair, the DO Hibernation API (state.acceptWebSocket), and a real
// eviction → rehydration cycle. Excluded from the node run in vitest.config.ts.
import { describe, it, expect } from 'vitest';
import { SELF, env, runInDurableObject, evictDurableObject } from 'cloudflare:test';
import { totalXpForLevel } from '../../lib/leveling.js';

// env bindings provided by vitest.workers.config.ts' miniflare block.
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    ROOM: DurableObjectNamespace;
    DB: D1Database;
  }
}

const BASE = 'https://world.example.com';

function snap(over: Record<string, unknown> = {}) {
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
    ...over,
  };
}

function post(path: string, body: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Run the real M1 flow to get a scoped control token for a fresh citizen.
async function mintControlToken(worldToken: string): Promise<string> {
  await post('/v1/teleport', { token: worldToken, snapshot: snap() });
  const link = (await (await post('/v1/browser-link', { token: worldToken })).json()) as { code: string };
  const sess = (await (await post('/v1/browser-session', { code: link.code })).json()) as { controlToken: string };
  return sess.controlToken;
}

interface Client {
  send(msg: unknown): void;
  next(): Promise<any>;
  close(): void;
}

async function connect(district: string): Promise<Client> {
  const res = await SELF.fetch(`${BASE}/v1/live/${district}`, { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();

  const queue: any[] = [];
  const waiters: Array<(m: any) => void> = [];
  ws.addEventListener('message', (e: MessageEvent) => {
    const msg = JSON.parse(e.data as string);
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  });

  return {
    send: (msg) => ws.send(JSON.stringify(msg)),
    next: () =>
      new Promise((resolve) => {
        const m = queue.shift();
        if (m) resolve(m);
        else waiters.push(resolve);
      }),
    close: () => ws.close(),
  };
}

describe('WorldRoom (real WebSocket + hibernation)', () => {
  it('returns a real 101 and authenticates a hello over the socket', async () => {
    const controlToken = await mintControlToken('ws-real-token-solo');
    const c = await connect('plaza-1');
    c.send({ type: 'hello', controlToken });
    const welcome = await c.next();
    expect(welcome.type).toBe('welcome');
    expect(welcome.district).toBe('plaza-1');
    expect(welcome.self).toMatch(/^shadowpaw-/);
    c.close();
  });

  it('an invalid control token is rejected and the socket closed', async () => {
    const c = await connect('plaza-1');
    c.send({ type: 'hello', controlToken: 'totally-bogus-token' });
    const err = await c.next();
    expect(err.type).toBe('error');
    c.close();
  });

  it('a socket that never authenticates is not broadcast to', async () => {
    // Lurker connects but sends no hello — it must not learn who joins.
    const lurker = await connect('plaza-1');
    let lurkerHeard: unknown = null;
    lurker.next().then((m) => (lurkerHeard = m));

    const ct = await mintControlToken('ws-lurk-token-xyz');
    const joiner = await connect('plaza-1');
    joiner.send({ type: 'hello', controlToken: ct });
    const welcome = await joiner.next();
    expect(welcome.type).toBe('welcome');
    // The unauthenticated lurker is NOT counted as a present actor...
    expect(welcome.actors.length).toBe(0);

    // ...and received no join broadcast for the newcomer.
    await new Promise((r) => setTimeout(r, 50));
    expect(lurkerHeard).toBeNull();

    lurker.close();
    joiner.close();
  });

  it('broadcasts presence: a peer sees join then leave', async () => {
    const ctA = await mintControlToken('ws-pres-token-aaa');
    const ctB = await mintControlToken('ws-pres-token-bbb');

    const a = await connect('plaza-1');
    a.send({ type: 'hello', controlToken: ctA });
    await a.next(); // A's welcome

    const b = await connect('plaza-1');
    b.send({ type: 'hello', controlToken: ctB });
    await b.next(); // B's welcome (already lists A)

    const join = await a.next(); // A hears B arrive
    expect(join.type).toBe('join');
    expect(join.actor.slug).toMatch(/^shadowpaw-/);

    b.close();
    const leave = await a.next(); // A hears B leave
    expect(leave.type).toBe('leave');
    a.close();
  });

  it('an owner move_to reaches a peer as a batched snapshot', async () => {
    const ctA = await mintControlToken('ws-move-token-aaa');
    const ctB = await mintControlToken('ws-move-token-bbb');

    const a = await connect('plaza-1');
    a.send({ type: 'hello', controlToken: ctA });
    const welcomeA = await a.next();
    const selfA = welcomeA.self as string;

    const b = await connect('plaza-1');
    b.send({ type: 'hello', controlToken: ctB });
    await b.next(); // B welcome
    await a.next(); // A hears B join

    // A drives its sprite; B should see a coalesced snapshot with A's new spot.
    a.send({ type: 'move_to', seq: 1, x: 0.42, y: 0.66, clientTs: 1 });

    let snap: any;
    for (let i = 0; i < 5; i++) {
      const m = await b.next();
      if (m.type === 'snapshot') {
        snap = m;
        break;
      }
    }
    expect(snap).toBeTruthy();
    const moved = snap.actors.find((x: any) => x.slug === selfA);
    expect(moved).toMatchObject({ x: 0.42, y: 0.66, seq: 1 });

    a.close();
    b.close();
  });

  it('rebuilds presence from socket attachments after eviction (hibernation)', async () => {
    const ctA = await mintControlToken('ws-hib-token-aaa');
    const ctB = await mintControlToken('ws-hib-token-bbb');

    const a = await connect('plaza-1');
    a.send({ type: 'hello', controlToken: ctA });
    await a.next();
    const b = await connect('plaza-1');
    b.send({ type: 'hello', controlToken: ctB });
    await b.next();
    await a.next(); // A hears B join — both are now present

    // Evict the room: its in-memory instance is dropped, hibernatable sockets
    // are kept. A fresh instance must rebuild state from attachments on wake.
    const stub = env.ROOM.get(env.ROOM.idFromName('plaza-1'));
    await evictDurableObject(stub); // defaults to webSockets: "hibernate"

    // The identities live on the sockets, not in the (now-gone) memory.
    const survivors: Array<string | undefined> = await runInDurableObject(stub, (_instance, state) =>
      state.getWebSockets().map((ws) => (ws.deserializeAttachment() as { actor?: { slug?: string } })?.actor?.slug)
    );
    expect(survivors.filter(Boolean).length).toBe(2);

    // And presence still works post-wake: a new joiner's welcome roster is
    // reconstructed from those attachments, listing BOTH prior occupants.
    const ctC = await mintControlToken('ws-hib-token-ccc');
    const c = await connect('plaza-1');
    c.send({ type: 'hello', controlToken: ctC });
    const welcomeC = await c.next();
    expect(welcomeC.type).toBe('welcome');
    expect(welcomeC.actors.length).toBe(2);

    a.close();
    b.close();
    c.close();
  });

  // Runs last: it warps its citizen out of plaza-1, so it must not perturb the
  // shared plaza-1 room state the presence/hibernation tests above assert on.
  it('a portal_enter warps the buddy in D1 and redirects the owner (walk-to-warp)', async () => {
    const controlToken = await mintControlToken('ws-portal-token-aaa'); // citizen in plaza-1

    const c = await connect('plaza-1');
    c.send({ type: 'hello', controlToken });
    await c.next(); // welcome

    // Walk into the Prontera→Payon gate: validate + move server-side, redirect me.
    c.send({ type: 'portal_enter', seq: 1, portal: 'prontera-payon', to: 'plaza-2', controlToken });
    const redirect = await c.next();
    expect(redirect.type).toBe('room_redirect');
    expect(redirect.district).toBe('plaza-2');
    expect(redirect.url).toContain('district=plaza-2');

    // The move is durable in D1: /v1/me now reports the new town.
    const me = (await (
      await SELF.fetch(`${BASE}/v1/me`, { headers: { authorization: `Bearer ${controlToken}` } })
    ).json()) as { district: string };
    expect(me.district).toBe('plaza-2');

    c.close();
  });
});
