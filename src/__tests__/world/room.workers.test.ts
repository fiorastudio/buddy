/// <reference types="@cloudflare/vitest-pool-workers" />
// Real-runtime integration test (workerd via @cloudflare/vitest-pool-workers).
// Everything else runs in the node pool; this file alone exercises a genuine
// WebSocketPair, the DO Hibernation API (state.acceptWebSocket), and a real
// eviction → rehydration cycle. Excluded from the node run in vitest.config.ts.
import { describe, it, expect } from 'vitest';
import { SELF, env, runInDurableObject, evictDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
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

// Every test shares ONE worker isolate, so its per-IP rate limiter. Give each
// request its own client IP so the suite's volume (it grows with every test)
// never trips the 60/min budget meant for a single real client.
let clientIp = 0;
function nextIp(): string {
  clientIp++;
  return `10.0.${clientIp >> 8}.${clientIp & 255}`;
}

function post(path: string, body: unknown) {
  return SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': nextIp() },
    body: JSON.stringify(body),
  });
}

// Run the real M1 flow to get a scoped control token for a fresh citizen.
async function mintControlToken(worldToken: string, district?: string): Promise<string> {
  await post('/v1/teleport', { token: worldToken, snapshot: snap(), ...(district ? { district } : {}) });
  const link = (await (await post('/v1/browser-link', { token: worldToken })).json()) as { code: string };
  const sess = (await (await post('/v1/browser-session', { code: link.code })).json()) as { controlToken: string };
  return sess.controlToken;
}

interface Client {
  send(msg: unknown): void;
  next(): Promise<any>;
  close(): void;
  closed: Promise<{ code: number; reason: string }>;
}

async function connect(district: string): Promise<Client> {
  const res = await SELF.fetch(`${BASE}/v1/live/${district}`, {
    headers: { Upgrade: 'websocket', 'cf-connecting-ip': nextIp() },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener('close', (e: CloseEvent) => resolve({ code: e.code, reason: e.reason }))
  );

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
    closed,
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

  // B9: HTTP privacy changes reach sockets that are ALREADY live. Own towns
  // (plaza-3/plaza-4) so plaza-1's shared roster is untouched.
  it('anon on relabels a live buddy in place: peers see real leave + masked join, owner is re-welcomed', async () => {
    const ctA = await mintControlToken('ws-anon-token-aaa', 'plaza-3');
    const ctB = await mintControlToken('ws-anon-token-bbb', 'plaza-3');

    const a = await connect('plaza-3');
    a.send({ type: 'hello', controlToken: ctA });
    const welcomeA = await a.next();
    const realSlug = welcomeA.self as string;
    expect(realSlug).toMatch(/^shadowpaw-/);

    const b = await connect('plaza-3');
    b.send({ type: 'hello', controlToken: ctB });
    await b.next(); // B welcome
    await a.next(); // A hears B join

    expect((await post('/v1/anon', { token: 'ws-anon-token-aaa', anon: true })).status).toBe(200);

    // The masked id is exactly the one the plaza (/v1/world) renders.
    const world = (await (await SELF.fetch(`${BASE}/v1/world/plaza-3`)).json()) as {
      citizens: Array<{ slug: string; name: string }>;
    };
    const masked = world.citizens.find((c) => c.slug.startsWith('anon-'))!.slug;

    const rewelcome = await a.next();
    expect(rewelcome).toMatchObject({ type: 'welcome', district: 'plaza-3', self: masked });

    const leave = await b.next();
    expect(leave).toEqual({ type: 'leave', slug: realSlug });
    const join = await b.next();
    expect(join.type).toBe('join');
    expect(join.actor.slug).toBe(masked);

    // From now on the real slug never reaches peers: A's next move is masked.
    a.send({ type: 'move_to', seq: 1, x: 0.2, y: 0.8, clientTs: 1 });
    let snap: any;
    for (let i = 0; i < 5 && !snap; i++) {
      const m = await b.next();
      if (m.type === 'snapshot') snap = m;
    }
    expect(snap.actors.map((x: any) => x.slug)).toContain(masked);
    expect(JSON.stringify(snap)).not.toContain(realSlug);

    a.close();
    b.close();
  });

  it('recall evicts a live socket (even across hibernation) and its control token can no longer join', async () => {
    const ctA = await mintControlToken('ws-recall-token-aaa', 'plaza-4');
    const ctB = await mintControlToken('ws-recall-token-bbb', 'plaza-4');

    const a = await connect('plaza-4');
    a.send({ type: 'hello', controlToken: ctA });
    const slugA = (await a.next()).self as string;
    const b = await connect('plaza-4');
    b.send({ type: 'hello', controlToken: ctB });
    await b.next();
    await a.next(); // A hears B join

    // The owner id must survive on the socket attachment through hibernation.
    // (Also proves the HTTP notice leaves no open subrequest behind: an undrained
    // DO response made this eviction hang.)
    const stub = env.ROOM.get(env.ROOM.idFromName('plaza-4'));
    await evictDurableObject(stub);

    expect((await post('/v1/recall', { token: 'ws-recall-token-aaa', purge: false })).status).toBe(200);

    expect(await a.next()).toEqual({ type: 'error', error: 'recalled' });
    expect((await a.closed).code).toBe(1008); // client parks reconnection on 1008
    expect(await b.next()).toEqual({ type: 'leave', slug: slugA });

    // A reconnect with the revoked control token is refused...
    const again = await connect('plaza-4');
    again.send({ type: 'hello', controlToken: ctA });
    expect(await again.next()).toEqual({ type: 'error', error: 'invalid control token' });

    // ...and a fresh joiner's roster no longer lists the recalled buddy.
    const ctC = await mintControlToken('ws-recall-token-ccc', 'plaza-4');
    const c = await connect('plaza-4');
    c.send({ type: 'hello', controlToken: ctC });
    const welcomeC = await c.next();
    expect(welcomeC.actors.map((x: any) => x.slug)).not.toContain(slugA);

    again.close();
    b.close();
    c.close();
  });

  // B6: a second tab for the same buddy takes over; the old one is retired
  // quietly (1008 so the plaza doesn't reconnect and steal it back).
  it('a second socket for the same buddy takes over: one roster entry, no leave until the live tab closes', async () => {
    const ctA = await mintControlToken('ws-dupe-token-aaa', 'plaza-5');
    const ctB = await mintControlToken('ws-dupe-token-bbb', 'plaza-5');

    const b = await connect('plaza-5'); // an observer
    b.send({ type: 'hello', controlToken: ctB });
    await b.next();

    const tab1 = await connect('plaza-5');
    tab1.send({ type: 'hello', controlToken: ctA });
    const slugA = (await tab1.next()).self as string;
    expect((await b.next()).type).toBe('join');

    const tab2 = await connect('plaza-5');
    tab2.send({ type: 'hello', controlToken: ctA });
    const welcome2 = await tab2.next();
    expect(welcome2).toMatchObject({ type: 'welcome', self: slugA });
    expect(welcome2.actors.map((x: any) => x.slug)).not.toContain(slugA);

    expect(await tab1.next()).toEqual({ type: 'error', error: 'taken over' });
    expect(await tab1.closed).toEqual({ code: 1008, reason: 'taken over' });

    // The observer hears the buddy re-join at spawn — and no leave for the old tab.
    const rejoin = await b.next();
    expect(rejoin).toMatchObject({ type: 'join', actor: { slug: slugA } });

    // A fresh joiner sees the buddy exactly once.
    const ctC = await mintControlToken('ws-dupe-token-ccc', 'plaza-5');
    const c = await connect('plaza-5');
    c.send({ type: 'hello', controlToken: ctC });
    const welcomeC = await c.next();
    expect(welcomeC.actors.filter((x: any) => x.slug === slugA)).toHaveLength(1);
    expect((await b.next()).type).toBe('join'); // observer hears C

    // Only the live tab moves the buddy, and closing it is the one leave.
    tab2.send({ type: 'move_to', seq: 1, x: 0.25, y: 0.75, clientTs: 1 });
    let snap: any;
    for (let i = 0; i < 5 && !snap; i++) {
      const m = await b.next();
      expect(m.type, 'no leave while the buddy is still live').not.toBe('leave');
      if (m.type === 'snapshot') snap = m;
    }
    expect(snap.actors.find((x: any) => x.slug === slugA)).toMatchObject({ x: 0.25, y: 0.75 });

    tab2.close();
    expect(await b.next()).toEqual({ type: 'leave', slug: slugA });

    b.close();
    c.close();
  });

  // B7: a socket that never says hello is closed by the room's alarm (which,
  // unlike a timer, lets the room hibernate in the meantime).
  it('an upgrade arms the hello-deadline alarm, which closes a socket that never authenticated', async () => {
    const stub = env.ROOM.get(env.ROOM.idFromName('plaza-6'));
    const ctA = await mintControlToken('ws-deadline-token-aaa', 'plaza-6');
    const member = await connect('plaza-6');
    member.send({ type: 'hello', controlToken: ctA });
    await member.next(); // welcome

    const lurker = await connect('plaza-6');
    const armed = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(armed).not.toBeNull();

    // Fast-forward: hibernate the room, then backdate the lurker's connect
    // time past the deadline, as if 10s had passed with no hello.
    await evictDurableObject(stub);
    await runInDurableObject(stub, (_i, state) => {
      for (const ws of state.getWebSockets()) {
        const att = ws.deserializeAttachment() as { actor: unknown; connectedAt?: number };
        if (!att.actor) ws.serializeAttachment({ ...att, connectedAt: 0 });
      }
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect(await lurker.next()).toEqual({ type: 'error', error: 'hello timeout' });
    expect(await lurker.closed).toEqual({ code: 1008, reason: 'hello timeout' });

    // The authenticated member is untouched and still served.
    member.send({ type: 'ping' });
    expect((await member.next()).type).toBe('pong');
    member.close();
  });

  // Runs last: it warps its citizen out of plaza-1, so it must not perturb the
  // shared plaza-1 room state the presence/hibernation tests above assert on.
  it('a portal_enter warps the buddy in D1, redirects the owner, and peers see exactly one leave', async () => {
    const ctB = await mintControlToken('ws-portal-token-bbb'); // a peer who stays behind
    const b = await connect('plaza-1');
    b.send({ type: 'hello', controlToken: ctB });
    await b.next(); // B welcome

    const controlToken = await mintControlToken('ws-portal-token-aaa'); // warper, in plaza-1
    const c = await connect('plaza-1');
    c.send({ type: 'hello', controlToken });
    await c.next(); // welcome
    const join = await b.next(); // B hears the warper join
    expect(join.type).toBe('join');

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

    // The peer hears the warper leave — exactly ONCE. The server-initiated close
    // that neutralizes the old socket must not double-announce the departure.
    const leave = await b.next();
    expect(leave.type).toBe('leave');
    const warperSlug = (leave as { slug: string }).slug;
    let extra: unknown = null;
    await Promise.race([b.next().then((m) => (extra = m)), new Promise((r) => setTimeout(r, 200))]);
    expect(extra, 'a second leave means the redirect close double-announced').toBeNull();

    // And the departed socket is fully out of presence: a fresh joiner's welcome
    // roster lists the peer who stayed but NOT the warper (its actor is detached,
    // so it can't ghost into rosters/snapshots even before the close completes).
    const ctD = await mintControlToken('ws-portal-token-ddd');
    const d = await connect('plaza-1');
    d.send({ type: 'hello', controlToken: ctD });
    const welcomeD = (await d.next()) as { type: string; actors: Array<{ slug: string }> };
    expect(welcomeD.type).toBe('welcome');
    const rosterSlugs = welcomeD.actors.map((a) => a.slug);
    expect(rosterSlugs).not.toContain(warperSlug);

    b.close();
    c.close();
    d.close();
  });
});
