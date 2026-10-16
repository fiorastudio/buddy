// Node-pool tests for the WorldRoom ADAPTER (src/world/room.ts): the parts
// that only show up when frames genuinely interleave. A Durable Object's input
// gate does not hold across D1 I/O, so while one frame awaits D1 the runtime
// delivers the next. Here a D1 that yields a macrotask per query plays the
// real D1, and frames are delivered WITHOUT awaiting the previous one — the
// sequential room-core tests can't see these races.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { WorldRoom, AUTH_DEADLINE_MS } from '../../world/room.js';
import { createWorldFetchHandler } from '../../world/worker-core.js';
import { sqliteAsD1 } from './d1-shim.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import type { D1Like } from '../../lib/world/d1-store.js';
import type { CfWebSocket, DurableObjectStateLike } from '../../world/runtime.js';

// Every query resolves only after a macrotask, like a real D1 round-trip — the
// window in which another socket event can run. `queries` counts round-trips;
// `queries.fail` makes every query reject, like a D1 outage.
function yieldingD1(inner: D1Like, queries: { n: number; fail?: boolean } = { n: 0 }): D1Like {
  const tick = async () => {
    await new Promise((r) => setTimeout(r, 0));
    if (queries.fail) throw new Error('D1 unavailable');
  };
  return {
    async exec(sql) {
      await tick();
      return inner.exec(sql);
    },
    prepare(sql) {
      return {
        bind(...args: unknown[]) {
          const stmt = inner.prepare(sql).bind(...args);
          queries.n++;
          return {
            run: async () => (await tick(), stmt.run()),
            all: async <T>() => (await tick(), stmt.all<T>()),
            first: async <T>() => (await tick(), stmt.first<T>()),
          };
        },
      };
    },
  } as D1Like;
}

class FakeWs implements CfWebSocket {
  sent: any[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  private att: unknown = null;
  send(data: string | ArrayBuffer): void {
    if (this.closedWith) throw new Error('send on a closed socket');
    this.sent.push(JSON.parse(String(data)));
  }
  close(code?: number, reason?: string): void {
    this.closedWith ??= { code, reason };
  }
  serializeAttachment(v: unknown): void {
    this.att = structuredClone(v);
  }
  deserializeAttachment(): unknown {
    return structuredClone(this.att);
  }
  of(type: string) {
    return this.sent.filter((m) => m.type === type);
  }
}

function snap(name: string) {
  return {
    name,
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
  };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

function setup() {
  const db = new Database(':memory:');
  const http = createWorldFetchHandler({ db: sqliteAsD1(db), baseUrl: 'https://w.example', ratePerMinute: 1000 });
  const sockets: FakeWs[] = [];
  const alarm = { at: null as number | null };
  const queries = { n: 0, fail: false };
  const state: DurableObjectStateLike = {
    acceptWebSocket: (ws) => void sockets.push(ws as FakeWs),
    getWebSockets: () => sockets.filter((s) => !s.closedWith),
    storage: {
      getAlarm: async () => alarm.at,
      setAlarm: async (t) => void (alarm.at = t),
    },
  };
  const room = new WorldRoom(state, { DB: yieldingD1(sqliteAsD1(db), queries), BASE_URL: 'https://w.example' });

  async function post(path: string, body: unknown): Promise<any> {
    const res = await http(
      new Request(`https://w.example${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
    return res.json();
  }

  async function controlToken(worldToken: string, name: string): Promise<string> {
    await post('/v1/teleport', { token: worldToken, snapshot: snap(name) });
    const { code } = await post('/v1/browser-link', { token: worldToken });
    return (await post('/v1/browser-session', { code })).controlToken;
  }

  // What room.fetch does for an upgrade, minus the WebSocketPair node lacks.
  function connect(district = 'plaza-1', connectedAt = Date.now()): FakeWs {
    const ws = new FakeWs();
    sockets.push(ws);
    ws.serializeAttachment({ district, actor: null, connectedAt });
    return ws;
  }

  async function joined(ct: string): Promise<FakeWs> {
    const ws = connect();
    await room.webSocketMessage(ws, frame({ type: 'hello', controlToken: ct }));
    expect(ws.of('welcome')).toHaveLength(1);
    return ws;
  }

  return { room, sockets, alarm, queries, controlToken, connect, joined };
}

const frame = (m: unknown) => JSON.stringify(m);

describe('WorldRoom adapter under interleaved frames (B5)', () => {
  let room: WorldRoom;
  let sockets: FakeWs[];
  let controlToken: (worldToken: string, name: string) => Promise<string>;
  let connect: (district?: string) => FakeWs;
  let joined: (ct: string) => Promise<FakeWs>;

  beforeEach(() => {
    ({ room, sockets, controlToken, connect, joined } = setup());
  });

  it('two portal_enter frames in flight together warp once: one redirect, one leave', async () => {
    const observer = await joined(await controlToken('tok-observer-0001', 'Mistcoil'));
    const ct = await controlToken('tok-warper-00001', 'Shadowpaw');
    const warper = await joined(ct);
    observer.sent.length = 0;

    const enter = (seq: number) =>
      room.webSocketMessage(warper, frame({ type: 'portal_enter', seq, to: 'plaza-2', portal: 'prontera-payon', controlToken: ct }));
    // Not awaited between: the second arrives while the first awaits D1.
    await Promise.all([enter(1), enter(2)]);

    expect(warper.of('room_redirect')).toHaveLength(1);
    expect(observer.of('leave')).toHaveLength(1);
    expect(warper.closedWith?.code).toBe(1000);
  });

  it('two hello frames in flight together join once: one welcome, one join', async () => {
    const observer = await joined(await controlToken('tok-observer-0002', 'Mistcoil'));
    const ct = await controlToken('tok-hello-000002', 'Shadowpaw');
    observer.sent.length = 0;

    const ws = connect();
    await Promise.all([
      room.webSocketMessage(ws, frame({ type: 'hello', controlToken: ct })),
      room.webSocketMessage(ws, frame({ type: 'hello', controlToken: ct })),
    ]);
    expect(ws.of('welcome')).toHaveLength(1);
    expect(observer.of('join')).toHaveLength(1);
    expect(ws.closedWith).toBeNull();
  });

  it('a move_to sent right behind the hello is applied, not refused as "expected hello"', async () => {
    const ct = await controlToken('tok-eager-000003', 'Shadowpaw');
    const ws = connect();
    await Promise.all([
      room.webSocketMessage(ws, frame({ type: 'hello', controlToken: ct })),
      room.webSocketMessage(ws, frame({ type: 'move_to', seq: 1, x: 0.3, y: 0.6 })),
    ]);
    expect(ws.closedWith).toBeNull();
    expect(ws.of('error')).toHaveLength(0);
    expect((ws.deserializeAttachment() as any).actor).toMatchObject({ x: 0.3, y: 0.6, seq: 1 });
  });

  it('two tabs whose hellos overlap end with ONE live socket (the later takes over)', async () => {
    const ct = await controlToken('tok-twotabs-0004', 'Shadowpaw');
    const tab1 = connect();
    const tab2 = connect();
    await Promise.all([
      room.webSocketMessage(tab1, frame({ type: 'hello', controlToken: ct })),
      room.webSocketMessage(tab2, frame({ type: 'hello', controlToken: ct })),
    ]);
    const live = sockets.filter((s) => (s.deserializeAttachment() as any).actor);
    expect(live).toHaveLength(1);
    const loser = live[0] === tab1 ? tab2 : tab1;
    expect(loser.closedWith).toEqual({ code: 1008, reason: 'taken over' });
  });

  it('an anon relabel that lands mid-warp is not overwritten by the (failed) warp', async () => {
    const ct = await controlToken('tok-relabel-0005', 'Shadowpaw');
    const ws = await joined(ct);
    const citizenId = ((ws.deserializeAttachment() as any).citizenId) as string;

    // An unknown town fails only after the D1 token lookup — so the relabel
    // notice runs while the warp is still waiting on D1.
    const warping = room.webSocketMessage(ws, frame({ type: 'portal_enter', seq: 4, to: 'nowhere', controlToken: ct }));
    const notice = room.fetch(
      new Request('https://room.internal/__internal/notice', {
        method: 'POST',
        body: JSON.stringify({ kind: 'relabel', citizenId, slug: 'anon-abc123' }),
      })
    );
    await Promise.all([warping, notice]);

    // The relabel stands and the warp's seq is still consumed.
    expect((ws.deserializeAttachment() as any).actor).toMatchObject({ slug: 'anon-abc123', seq: 4 });
  });

  it('a socket that closes while its hello is in flight is never announced', async () => {
    const observer = await joined(await controlToken('tok-observer-0006', 'Mistcoil'));
    const ct = await controlToken('tok-closer-00006', 'Shadowpaw');
    observer.sent.length = 0;

    const ws = connect();
    const hello = room.webSocketMessage(ws, frame({ type: 'hello', controlToken: ct }));
    ws.close(1001, 'gone');
    await room.webSocketClose(ws, 1001, 'gone', true);
    await hello;
    await flush();
    expect(observer.of('join')).toHaveLength(0);
    expect(observer.of('leave')).toHaveLength(0);
  });

  it('a recall that lands mid-warp suppresses the stale leave/redirect', async () => {
    const observer = await joined(await controlToken('tok-observer-0007', 'Mistcoil'));
    const ct = await controlToken('tok-recall-00007', 'Shadowpaw');
    const ws = await joined(ct);
    const citizenId = ((ws.deserializeAttachment() as any).citizenId) as string;
    observer.sent.length = 0;

    const warping = room.webSocketMessage(ws, frame({ type: 'portal_enter', seq: 1, to: 'plaza-2', controlToken: ct }));
    const notice = room.fetch(
      new Request('https://room.internal/__internal/notice', {
        method: 'POST',
        body: JSON.stringify({ kind: 'evict', citizenId }),
      })
    );
    await Promise.all([warping, notice]);

    expect(observer.of('leave')).toHaveLength(1); // the eviction's, only
    expect(ws.of('room_redirect')).toHaveLength(0);
    expect(ws.closedWith).toEqual({ code: 1008, reason: 'recalled' });
  });
});

describe('WorldRoom adapter limits (B7)', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the alarm closes sockets that never said hello in time, and re-arms for the rest', async () => {
    const member = await t.joined(await t.controlToken('tok-member-00001', 'Mistcoil'));
    const now = Date.now();
    const stale = t.connect('plaza-1', now - AUTH_DEADLINE_MS - 1);
    const fresh = t.connect('plaza-1', now - 1000);

    await t.room.alarm();

    expect(stale.closedWith).toEqual({ code: 1008, reason: 'hello timeout' });
    expect(stale.of('error')).toEqual([{ type: 'error', error: 'hello timeout' }]);
    expect(fresh.closedWith).toBeNull();
    expect(member.closedWith).toBeNull();
    // Re-armed for the fresh socket's own deadline.
    expect(t.alarm.at).toBe(now - 1000 + AUTH_DEADLINE_MS);
  });

  it('the alarm spares a socket whose hello is being verified right now', async () => {
    const ct = await t.controlToken('tok-slowhello-01', 'Shadowpaw');
    const ws = t.connect('plaza-1', Date.now() - AUTH_DEADLINE_MS - 1);
    const hello = t.room.webSocketMessage(ws, frame({ type: 'hello', controlToken: ct }));
    await t.room.alarm(); // runs while the hello awaits D1
    await hello;
    expect(ws.closedWith).toBeNull();
    expect(ws.of('welcome')).toHaveLength(1);
  });

  it('move_to is budgeted per socket: a flood is cut to the burst, then ~15 Hz', async () => {
    const ws = await t.joined(await t.controlToken('tok-flooder-0001', 'Shadowpaw'));
    let clock = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    for (let seq = 1; seq <= 40; seq++) {
      await t.room.webSocketMessage(ws, frame({ type: 'move_to', seq, x: 0.5, y: seq / 100 }));
    }
    expect((ws.deserializeAttachment() as any).actor.seq).toBe(15); // burst of 15, rest dropped
    clock += 1000; // a second later the budget has refilled
    await t.room.webSocketMessage(ws, frame({ type: 'move_to', seq: 41, x: 0.5, y: 0.41 }));
    expect((ws.deserializeAttachment() as any).actor.seq).toBe(41);
    expect(ws.closedWith).toBeNull(); // throttled, not disconnected
  });

  it('pings are budgeted too', async () => {
    const ws = await t.joined(await t.controlToken('tok-pinger-00001', 'Shadowpaw'));
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    for (let i = 0; i < 50; i++) await t.room.webSocketMessage(ws, frame({ type: 'ping' }));
    expect(ws.of('pong').length).toBeLessThanOrEqual(10);
    expect(ws.of('pong').length).toBeGreaterThan(0);
  });

  it('an oversized frame closes the socket (1009) without reaching the core', async () => {
    const ws = t.connect();
    const before = t.queries.n;
    await t.room.webSocketMessage(ws, frame({ type: 'hello', controlToken: 'x'.repeat(5000) }));
    expect(ws.closedWith?.code).toBe(1009);
    expect(t.queries.n).toBe(before);
  });

  it('a burst of bad hellos costs ONE D1 lookup (the socket is out after the first)', async () => {
    await t.joined(await t.controlToken('tok-warmup-00001', 'Mistcoil')); // room store bootstrapped
    const ws = t.connect();
    const before = t.queries.n;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        t.room.webSocketMessage(ws, frame({ type: 'hello', controlToken: 'bogus-control-token' }))
      )
    );
    expect(ws.closedWith?.code).toBe(1008);
    expect(ws.of('error')).toEqual([{ type: 'error', error: 'invalid control token' }]);
    expect(t.queries.n - before).toBe(1);
  });
});

describe('WorldRoom adapter error boundary (B17)', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a hello that hits a D1 failure resolves, tells the client, and closes 1011 (retryable)', async () => {
    const ct = await t.controlToken('tok-d1down-00001', 'Shadowpaw');
    t.queries.fail = true;
    const ws = t.connect();
    await expect(t.room.webSocketMessage(ws, frame({ type: 'hello', controlToken: ct }))).resolves.toBeUndefined();
    expect(ws.of('error')).toEqual([{ type: 'error', error: 'internal error' }]);
    expect(ws.closedWith).toEqual({ code: 1011, reason: 'internal error' });
    expect(console.error).toHaveBeenCalled();
  });

  it('a joined socket survives a frame that fails (portal_enter during a D1 outage)', async () => {
    const ct = await t.controlToken('tok-d1down-00002', 'Shadowpaw');
    const ws = await t.joined(ct);
    t.queries.fail = true;
    await expect(
      t.room.webSocketMessage(ws, frame({ type: 'portal_enter', seq: 1, to: 'plaza-2', controlToken: ct }))
    ).resolves.toBeUndefined();
    expect(ws.of('error')).toEqual([{ type: 'error', error: 'internal error' }]);
    expect(ws.closedWith).toBeNull();
    // Still served afterwards.
    await t.room.webSocketMessage(ws, frame({ type: 'ping' }));
    expect(ws.of('pong')).toHaveLength(1);
  });

  it('a send to a socket that closed mid-frame does not fail the frame', async () => {
    const ct = await t.controlToken('tok-racer-000003', 'Shadowpaw');
    const ws = t.connect();
    const hello = t.room.webSocketMessage(ws, frame({ type: 'hello', controlToken: ct }));
    ws.close(1001, 'tab closed'); // the close event hasn't reached the room yet
    await expect(hello).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled(); // not an error, just a race
  });
});
