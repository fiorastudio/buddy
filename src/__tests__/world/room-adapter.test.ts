// Node-pool tests for the WorldRoom ADAPTER (src/world/room.ts): the parts
// that only show up when frames genuinely interleave. A Durable Object's input
// gate does not hold across D1 I/O, so while one frame awaits D1 the runtime
// delivers the next. Here a D1 that yields a macrotask per query plays the
// real D1, and frames are delivered WITHOUT awaiting the previous one — the
// sequential room-core tests can't see these races.
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { WorldRoom } from '../../world/room.js';
import { createWorldFetchHandler } from '../../world/worker-core.js';
import { sqliteAsD1 } from './d1-shim.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import type { D1Like } from '../../lib/world/d1-store.js';
import type { CfWebSocket, DurableObjectStateLike } from '../../world/runtime.js';

// Every query resolves only after a macrotask, like a real D1 round-trip — the
// window in which another socket event can run.
function yieldingD1(inner: D1Like): D1Like {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    async exec(sql) {
      await tick();
      return inner.exec(sql);
    },
    prepare(sql) {
      return {
        bind(...args: unknown[]) {
          const stmt = inner.prepare(sql).bind(...args);
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

describe('WorldRoom adapter under interleaved frames (B5)', () => {
  let http: (req: Request) => Promise<Response>;
  let room: WorldRoom;
  let sockets: FakeWs[];

  beforeEach(() => {
    const db = new Database(':memory:');
    http = createWorldFetchHandler({ db: sqliteAsD1(db), baseUrl: 'https://w.example', ratePerMinute: 1000 });
    sockets = [];
    const state: DurableObjectStateLike = {
      acceptWebSocket: (ws) => void sockets.push(ws as FakeWs),
      getWebSockets: () => sockets.filter((s) => !s.closedWith),
    };
    room = new WorldRoom(state, { DB: yieldingD1(sqliteAsD1(db)), BASE_URL: 'https://w.example' });
  });

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
  function connect(district = 'plaza-1'): FakeWs {
    const ws = new FakeWs();
    sockets.push(ws);
    ws.serializeAttachment({ district, actor: null });
    return ws;
  }

  const frame = (m: unknown) => JSON.stringify(m);

  async function joined(ct: string): Promise<FakeWs> {
    const ws = connect();
    await room.webSocketMessage(ws, frame({ type: 'hello', controlToken: ct }));
    expect(ws.of('welcome')).toHaveLength(1);
    return ws;
  }

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
