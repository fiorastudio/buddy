import { describe, it, expect } from 'vitest';
import {
  RoomCore,
  isFreshSeq,
  diffActors,
  planSnapshot,
  type RoomPort,
  type ServerMsg,
  type ActorState,
  type AuthResult,
  type WarpOutcome,
} from '../../lib/world/room-core.js';

// A fake socket is just a string id; a fake port records everything the core
// tries to send so tests can assert on the wire protocol without a real WS.
type Sock = string;

interface Recorder {
  port: RoomPort<Sock>;
  sent: Array<{ socket: Sock; msg: ServerMsg }>;
  broadcasts: Array<{ msg: ServerMsg; except?: Sock }>;
  warps: Array<{ controlToken: string; to: string }>;
}

function makePort(
  opts: {
    verify?: (t: string) => AuthResult | null;
    warp?: (controlToken: string, to: string) => WarpOutcome | null;
    now?: number;
  } = {}
): Recorder {
  const sent: Recorder['sent'] = [];
  const broadcasts: Recorder['broadcasts'] = [];
  const warps: Recorder['warps'] = [];
  const port: RoomPort<Sock> = {
    now: () => opts.now ?? 1000,
    send: (socket, msg) => sent.push({ socket, msg }),
    broadcast: (msg, except) => broadcasts.push({ msg, except }),
    verify: async (t) => (opts.verify ? opts.verify(t) : null),
    warp: async (controlToken, to) => {
      warps.push({ controlToken, to });
      return opts.warp
        ? opts.warp(controlToken, to)
        : { ok: true, district: to, url: `/?district=${to}`, spawn: { x: 0.5, y: 0.2 } };
    },
  };
  return { port, sent, broadcasts, warps };
}

const DISTRICT = 'plaza-1';

function actor(slug: string, over: Partial<ActorState> = {}): ActorState {
  return { slug, x: 0.5, y: 0.5, seq: 0, ...over };
}

describe('room-core hello authentication', () => {
  it('a valid control token joins: newcomer is welcomed and peers get a join', async () => {
    const rec = makePort({ verify: (t) => (t === 'good-control-token' ? { slug: 'shadowpaw-ab12', district: DISTRICT } : null) });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);

    const peers = [{ socket: 'peerA', state: actor('mistcoil-99') }];
    const res = await core.onMessage('me', null, JSON.stringify({ type: 'hello', controlToken: 'good-control-token' }), peers);

    // Attaches the authenticated identity to the socket.
    expect(res.attach?.slug).toBe('shadowpaw-ab12');
    expect(res.close).toBeUndefined();

    // Newcomer receives a welcome carrying the existing roster.
    const welcome = rec.sent.find((s) => s.socket === 'me')!.msg as Extract<ServerMsg, { type: 'welcome' }>;
    expect(welcome.type).toBe('welcome');
    expect(welcome.self).toBe('shadowpaw-ab12');
    expect(welcome.district).toBe(DISTRICT);
    expect(welcome.actors.map((a) => a.slug)).toEqual(['mistcoil-99']);

    // Everyone else is told someone joined (never echoed to the newcomer).
    const join = rec.broadcasts.find((b) => b.msg.type === 'join')!;
    expect((join.msg as Extract<ServerMsg, { type: 'join' }>).actor.slug).toBe('shadowpaw-ab12');
    expect(join.except).toBe('me');
  });

  it('an invalid control token is refused and the socket is closed', async () => {
    const rec = makePort({ verify: () => null });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', null, JSON.stringify({ type: 'hello', controlToken: 'nope' }), []);

    expect(res.attach).toBeUndefined();
    expect(res.close?.code).toBe(1008);
    expect(rec.sent.some((s) => s.msg.type === 'error')).toBe(true);
    expect(rec.broadcasts).toHaveLength(0); // nobody hears about a failed join
  });

  it('a non-hello first message is rejected before authentication', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', null, JSON.stringify({ type: 'ping' }), []);
    expect(res.close?.code).toBe(1008);
    expect(rec.sent.some((s) => s.msg.type === 'error')).toBe(true);
  });

  it('a token valid for a DIFFERENT town cannot join this room', async () => {
    const rec = makePort({ verify: () => ({ slug: 'shadowpaw-ab12', district: 'plaza-3' }) });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', null, JSON.stringify({ type: 'hello', controlToken: 'good-control-token' }), []);
    expect(res.attach).toBeUndefined();
    expect(res.close?.code).toBe(1008);
  });

  it('malformed JSON is rejected without throwing', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', null, '{not json', []);
    expect(res.attach).toBeUndefined();
    expect(rec.sent.some((s) => s.msg.type === 'error')).toBe(true);
  });
});

describe('room-core presence and liveness', () => {
  it('closing an authenticated socket broadcasts a leave', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    core.onClose(actor('shadowpaw-ab12'));
    const leave = rec.broadcasts.find((b) => b.msg.type === 'leave')!;
    expect((leave.msg as Extract<ServerMsg, { type: 'leave' }>).slug).toBe('shadowpaw-ab12');
  });

  it('closing an unauthenticated socket tells no one', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    core.onClose(null);
    expect(rec.broadcasts).toHaveLength(0);
  });

  it('an authenticated ping is answered with a timestamped pong', async () => {
    const rec = makePort({ now: 4242 });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', actor('shadowpaw-ab12'), JSON.stringify({ type: 'ping' }), []);
    expect(res.attach).toBeUndefined(); // no identity change
    const pong = rec.sent.find((s) => s.msg.type === 'pong')!.msg as Extract<ServerMsg, { type: 'pong' }>;
    expect(pong.serverTs).toBe(4242);
  });

  it('a duplicate hello on an already-authenticated socket is ignored', async () => {
    const rec = makePort({ verify: () => ({ slug: 'x', district: DISTRICT }) });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', actor('shadowpaw-ab12'), JSON.stringify({ type: 'hello', controlToken: 'good-control-token' }), []);
    expect(res.attach).toBeUndefined();
    expect(rec.broadcasts).toHaveLength(0);
  });
});

describe('room-core movement (move_to)', () => {
  it('an authenticated move_to updates the position and requests a batched flush', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage(
      'me',
      actor('shadowpaw-ab12', { seq: 0 }),
      JSON.stringify({ type: 'move_to', seq: 1, x: 0.3, y: 0.7, clientTs: 111 }),
      []
    );
    expect(res.attach).toEqual({ slug: 'shadowpaw-ab12', x: 0.3, y: 0.7, seq: 1 });
    expect(res.flush).toBe(true);
    // move_to is coalesced into the batched snapshot, never broadcast inline.
    expect(rec.broadcasts).toHaveLength(0);
  });

  it('drops a stale / non-increasing move_to seq', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage(
      'me',
      actor('x', { seq: 5, x: 0.1, y: 0.1 }),
      JSON.stringify({ type: 'move_to', seq: 5, x: 0.9, y: 0.9 }),
      []
    );
    expect(res.attach).toBeUndefined();
    expect(res.flush).toBeFalsy();
  });

  it('ignores out-of-range or non-finite coordinates', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    for (const bad of [
      { x: 1.5, y: 0.5 },
      { x: 0.5, y: -0.1 },
      { x: Number.NaN, y: 0.5 },
      { x: 0.5, y: 'nope' as unknown as number },
    ]) {
      const res = await core.onMessage(
        'me',
        actor('x', { seq: 0 }),
        JSON.stringify({ type: 'move_to', seq: 1, ...bad }),
        []
      );
      expect(res.attach).toBeUndefined();
    }
  });

  it('a move_to before authentication is refused (hello still required first)', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', null, JSON.stringify({ type: 'move_to', seq: 1, x: 0.2, y: 0.2 }), []);
    expect(res.close?.code).toBe(1008);
  });
});

describe('room-core portal warp (portal_enter → room_redirect)', () => {
  const HELLO_SEQ = { seq: 1, to: 'plaza-2', controlToken: 'good-control-token' };

  it('a portal_enter warps: broadcasts leave and redirects the owner', async () => {
    const rec = makePort({
      warp: () => ({ ok: true, district: 'plaza-2', url: 'https://x/?district=plaza-2', spawn: { x: 0.5, y: 0.2 } }),
    });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage(
      'me',
      actor('shadowpaw-ab12', { seq: 0 }),
      JSON.stringify({ type: 'portal_enter', portal: 'prontera-payon', ...HELLO_SEQ }),
      []
    );

    // The warp ran against the token + target the client sent.
    expect(rec.warps).toEqual([{ controlToken: 'good-control-token', to: 'plaza-2' }]);
    // The actor is detached (cleared from presence) and the old socket closed
    // (normal closure) so a client that ignores the redirect can't keep moving
    // in the town it just left, nor linger in its roster/snapshots.
    expect(res.detach).toBe(true);
    expect(res.close?.code).toBe(1000);
    // The room is told I left this town...
    const leave = rec.broadcasts.find((b) => b.msg.type === 'leave')!;
    expect((leave.msg as Extract<ServerMsg, { type: 'leave' }>).slug).toBe('shadowpaw-ab12');
    // ...and I get a redirect to the new one, carrying the arrival spawn.
    const redirect = rec.sent.find((s) => s.msg.type === 'room_redirect')!;
    const rmsg = redirect.msg as Extract<ServerMsg, { type: 'room_redirect' }>;
    expect(rmsg.district).toBe('plaza-2');
    expect(rmsg.url).toContain('district=plaza-2');
    expect(rmsg.spawn).toEqual({ x: 0.5, y: 0.2 });
  });

  it('a warp fires exactly once — a duplicate frame racing the close is refused', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const first = await core.onMessage(
      'me',
      actor('x', { seq: 0 }),
      JSON.stringify({ type: 'portal_enter', ...HELLO_SEQ }),
      []
    );
    expect(first.detach).toBe(true);
    expect(rec.warps).toHaveLength(1);
    expect(rec.sent.filter((s) => s.msg.type === 'room_redirect')).toHaveLength(1);
    expect(rec.broadcasts.filter((b) => b.msg.type === 'leave')).toHaveLength(1);
    // The DO persists actor:null (detached), so a duplicate portal_enter that
    // races the close arrives UNAUTHENTICATED and is refused — no second warp,
    // no second redirect. Also covers a stale same-seq frame before the detach:
    // isFreshSeq drops it against the last honored seq.
    expect(isFreshSeq(1, 1)).toBe(false);
    const dup = await core.onMessage(
      'me',
      null,
      JSON.stringify({ type: 'portal_enter', seq: 2, to: 'plaza-2', controlToken: 'good-control-token' }),
      []
    );
    expect(dup.close?.code).toBe(1008);
    expect(rec.warps).toHaveLength(1);
    expect(rec.sent.filter((s) => s.msg.type === 'room_redirect')).toHaveLength(1);
  });

  it('a failed warp (town full) consumes the seq but neither redirects nor leaves', async () => {
    const rec = makePort({ warp: () => ({ ok: false, error: 'town_full' }) });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage(
      'me',
      actor('x', { seq: 0 }),
      JSON.stringify({ type: 'portal_enter', ...HELLO_SEQ }),
      []
    );
    expect(res.attach?.seq).toBe(1); // consumed, so a replay can't retry
    expect(res.close).toBeUndefined(); // warp failed → stay put; socket kept open
    expect(rec.sent.some((s) => s.msg.type === 'room_redirect')).toBe(false);
    expect(rec.broadcasts.some((b) => b.msg.type === 'leave')).toBe(false);
  });

  it('a portal_enter without a control token is ignored (no warp attempted)', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage(
      'me',
      actor('x', { seq: 0 }),
      JSON.stringify({ type: 'portal_enter', seq: 1, to: 'plaza-2' }),
      []
    );
    expect(res.attach?.seq).toBe(1); // seq still consumed
    expect(rec.warps).toHaveLength(0);
  });

  it('drops a stale / non-increasing portal_enter seq', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage(
      'me',
      actor('x', { seq: 5 }),
      JSON.stringify({ type: 'portal_enter', seq: 5, to: 'plaza-2', controlToken: 'good-control-token' }),
      []
    );
    expect(res.attach).toBeUndefined();
    expect(rec.warps).toHaveLength(0);
  });

  it('a portal_enter before authentication is refused (hello still required first)', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', null, JSON.stringify({ type: 'portal_enter', ...HELLO_SEQ }), []);
    expect(res.close?.code).toBe(1008);
    expect(rec.warps).toHaveLength(0);
  });
});

describe('room-core snapshot planning (dirty-only, masked)', () => {
  it('includes only actors that changed, preserving (already-masked) slugs', () => {
    const prev = new Map<string, ActorState>([['a', actor('a', { x: 0.1, y: 0.1, seq: 1 })]]);
    const next = new Map<string, ActorState>([
      ['a', actor('a', { x: 0.1, y: 0.1, seq: 1 })], // unchanged
      ['anon-abc123', actor('anon-abc123', { x: 0.5, y: 0.5, seq: 2 })], // moved; masked slug
    ]);
    const snap = planSnapshot(DISTRICT, 999, prev, next);
    expect(snap).not.toBeNull();
    expect(snap!.type).toBe('snapshot');
    expect(snap!.district).toBe(DISTRICT);
    expect(snap!.serverTs).toBe(999);
    expect(snap!.actors.map((a) => a.slug)).toEqual(['anon-abc123']); // real anon slug never appears
  });

  it('returns null when nothing is dirty (no idle snapshot spam)', () => {
    const m = new Map<string, ActorState>([['a', actor('a')]]);
    expect(planSnapshot(DISTRICT, 1, m, m)).toBeNull();
  });
});

describe('room-core pure helpers', () => {
  it('isFreshSeq accepts strictly-increasing seq only', () => {
    expect(isFreshSeq(5, 6)).toBe(true);
    expect(isFreshSeq(5, 5)).toBe(false);
    expect(isFreshSeq(5, 4)).toBe(false);
    expect(isFreshSeq(0, Number.NaN)).toBe(false);
  });

  it('diffActors returns only new or changed actors (dirty-only)', () => {
    const prev = new Map<string, ActorState>([
      ['a', actor('a', { x: 0.1, y: 0.1, seq: 1 })],
      ['b', actor('b', { x: 0.2, y: 0.2, seq: 1 })],
    ]);
    const next = new Map<string, ActorState>([
      ['a', actor('a', { x: 0.1, y: 0.1, seq: 1 })], // unchanged
      ['b', actor('b', { x: 0.9, y: 0.2, seq: 2 })], // moved
      ['c', actor('c', { x: 0.3, y: 0.3, seq: 1 })], // new
    ]);
    const dirty = diffActors(prev, next).map((a) => a.slug).sort();
    expect(dirty).toEqual(['b', 'c']);
  });
});

// B9: an HTTP-side recall/purge/anon change must take effect on a socket that
// is ALREADY live — it never re-authenticates on its own.
describe('room-core server-initiated identity changes (recall / anon)', () => {
  it('a successful hello surfaces the owner id for the adapter, but never on the wire', async () => {
    const rec = makePort({ verify: () => ({ slug: 'anon-1a2b3c', district: DISTRICT, citizenId: 'cit-123' }) });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', null, JSON.stringify({ type: 'hello', controlToken: 'good-control-token' }), []);
    expect(res.citizenId).toBe('cit-123');
    expect(res.attach).toEqual({ slug: 'anon-1a2b3c', x: 0.5, y: 0.5, seq: 0 }); // no citizenId in ActorState
    const wire = JSON.stringify([...rec.sent.map((s) => s.msg), ...rec.broadcasts.map((b) => b.msg)]);
    expect(wire).not.toContain('cit-123');
  });

  it('evict: peers hear one leave, the socket is detached and closed 1008 (no reconnect)', () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = core.evict('me', actor('shadowpaw-ab12', { x: 0.3, y: 0.4, seq: 7 }));
    expect(res.detach).toBe(true);
    expect(res.attach).toBeUndefined();
    expect(res.close?.code).toBe(1008);
    expect(rec.broadcasts).toEqual([{ msg: { type: 'leave', slug: 'shadowpaw-ab12' }, except: 'me' }]);
    expect(rec.sent).toEqual([{ socket: 'me', msg: { type: 'error', error: 'recalled' } }]);
  });

  it('relabel (anon on): peers see the real slug leave and the masked one join; owner is re-welcomed', () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const peers = [{ socket: 'peerA', state: actor('mistcoil-99') }];
    const res = core.relabel('me', actor('shadowpaw-ab12', { x: 0.3, y: 0.4, seq: 7 }), 'anon-1a2b3c', peers);

    // Position and seq carry over; only the public id changes.
    expect(res.attach).toEqual({ slug: 'anon-1a2b3c', x: 0.3, y: 0.4, seq: 7 });
    expect(res.close).toBeUndefined();
    expect(rec.broadcasts.map((b) => [b.msg.type, b.except])).toEqual([
      ['leave', 'me'],
      ['join', 'me'],
    ]);
    expect((rec.broadcasts[0].msg as Extract<ServerMsg, { type: 'leave' }>).slug).toBe('shadowpaw-ab12');
    expect((rec.broadcasts[1].msg as Extract<ServerMsg, { type: 'join' }>).actor.slug).toBe('anon-1a2b3c');
    const welcome = rec.sent.find((s) => s.socket === 'me')!.msg as Extract<ServerMsg, { type: 'welcome' }>;
    expect(welcome).toEqual({ type: 'welcome', district: DISTRICT, self: 'anon-1a2b3c', actors: [actor('mistcoil-99')] });
    // Nothing that follows the swap carries the real slug.
    expect(JSON.stringify([welcome, rec.broadcasts[1].msg])).not.toContain('shadowpaw');
  });

  it('relabel to the same slug is a no-op (no churn, nothing sent)', () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = core.relabel('me', actor('shadowpaw-ab12'), 'shadowpaw-ab12', []);
    expect(res).toEqual({});
    expect(rec.sent).toHaveLength(0);
    expect(rec.broadcasts).toHaveLength(0);
  });
});

// B6: one live socket per buddy. A second tab (or a reconnect that beats the
// old socket's close) takes over; the old socket is retired without a `leave`.
describe('room-core one socket per buddy (newest wins)', () => {
  const HELLO = JSON.stringify({ type: 'hello', controlToken: 'good-control-token' });

  it('a second hello for the same owner takes over the older socket', async () => {
    const rec = makePort({ verify: () => ({ slug: 'shadowpaw-ab12', district: DISTRICT, citizenId: 'cit-1' }) });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const peers = [
      { socket: 'oldTab', state: actor('shadowpaw-ab12', { x: 0.2, y: 0.3, seq: 9 }), citizenId: 'cit-1' },
      { socket: 'peerA', state: actor('mistcoil-99'), citizenId: 'cit-2' },
    ];
    const res = await core.onMessage('newTab', null, HELLO, peers);

    expect(res.attach).toEqual({ slug: 'shadowpaw-ab12', x: 0.5, y: 0.5, seq: 0 });
    expect(res.takeover).toEqual(['oldTab']);
    // The old tab is told why before the adapter closes it.
    expect(rec.sent).toContainEqual({ socket: 'oldTab', msg: { type: 'error', error: 'taken over' } });
    // The newcomer's roster never lists itself (the old socket's actor).
    const welcome = rec.sent.find((s) => s.socket === 'newTab')!.msg as Extract<ServerMsg, { type: 'welcome' }>;
    expect(welcome.actors.map((a) => a.slug)).toEqual(['mistcoil-99']);
    // Peers hear no leave — the buddy never left — only the join at spawn.
    expect(rec.broadcasts.map((b) => b.msg.type)).toEqual(['join']);
    // The owner id stays server-side.
    expect(JSON.stringify([...rec.sent, ...rec.broadcasts])).not.toContain('cit-');
  });

  it('matches by public slug when an older socket carries no owner id', async () => {
    const rec = makePort({ verify: () => ({ slug: 'anon-1a2b3c', district: DISTRICT, citizenId: 'cit-1' }) });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('newTab', null, HELLO, [{ socket: 'oldTab', state: actor('anon-1a2b3c') }]);
    expect(res.takeover).toEqual(['oldTab']);
  });

  it('a different buddy is never taken over', async () => {
    const rec = makePort({ verify: () => ({ slug: 'shadowpaw-ab12', district: DISTRICT, citizenId: 'cit-1' }) });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', null, HELLO, [
      { socket: 'peerA', state: actor('mistcoil-99'), citizenId: 'cit-2' },
    ]);
    expect(res.takeover).toBeUndefined();
    expect(rec.sent.filter((s) => s.socket === 'peerA')).toHaveLength(0);
  });

  it('a failed hello never takes over anyone', async () => {
    const rec = makePort({ verify: () => null });
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const res = await core.onMessage('me', null, HELLO, [
      { socket: 'oldTab', state: actor('shadowpaw-ab12'), citizenId: 'cit-1' },
    ]);
    expect(res.takeover).toBeUndefined();
    expect(rec.sent.filter((s) => s.socket === 'oldTab')).toHaveLength(0);
  });
});

// B5: the core decides on state re-read AFTER each await (port.current/peers),
// because other events run while D1 answers. Adapter-level interleaving is in
// room-adapter.test.ts.
describe('room-core re-reads state after an await', () => {
  const HELLO = JSON.stringify({ type: 'hello', controlToken: 'good-control-token' });
  const ENTER = JSON.stringify({ type: 'portal_enter', seq: 3, to: 'plaza-2', controlToken: 'good-control-token' });

  it('a hello whose socket closed during verify welcomes and announces nothing', async () => {
    const rec = makePort({ verify: () => ({ slug: 'shadowpaw-ab12', district: DISTRICT }) });
    rec.port.current = () => ({ gone: true, actor: null });
    const res = await new RoomCore<Sock>(DISTRICT, rec.port).onMessage('me', null, HELLO, []);
    expect(res).toEqual({});
    expect(rec.sent).toHaveLength(0);
    expect(rec.broadcasts).toHaveLength(0);
  });

  it('a hello builds its roster (and takeover) from peers read after verify', async () => {
    const rec = makePort({ verify: () => ({ slug: 'shadowpaw-ab12', district: DISTRICT, citizenId: 'cit-1' }) });
    rec.port.current = () => ({ gone: false, actor: null });
    rec.port.peers = () => [{ socket: 'otherTab', state: actor('shadowpaw-ab12'), citizenId: 'cit-1' }];
    const res = await new RoomCore<Sock>(DISTRICT, rec.port).onMessage('me', null, HELLO, []);
    expect(res.takeover).toEqual(['otherTab']);
  });

  it('a warp whose socket was evicted or replaced meanwhile says nothing more', async () => {
    const rec = makePort();
    rec.port.current = () => ({ gone: true, actor: null });
    const res = await new RoomCore<Sock>(DISTRICT, rec.port).onMessage('me', actor('x'), ENTER, []);
    expect(res).toEqual({});
    expect(rec.broadcasts).toHaveLength(0);
    expect(rec.sent).toHaveLength(0);
  });

  it('a failed warp writes back the CURRENT actor (relabeled meanwhile), not the pre-await copy', async () => {
    const rec = makePort({ warp: () => ({ ok: false, error: 'town_full' }) });
    rec.port.current = () => ({ gone: false, actor: actor('anon-1a2b3c', { x: 0.7, y: 0.2, seq: 1 }) });
    const res = await new RoomCore<Sock>(DISTRICT, rec.port).onMessage('me', actor('shadowpaw-ab12'), ENTER, []);
    expect(res.attach).toEqual({ slug: 'anon-1a2b3c', x: 0.7, y: 0.2, seq: 3 });
  });

  it('a successful warp announces the leave under the CURRENT slug', async () => {
    const rec = makePort();
    rec.port.current = () => ({ gone: false, actor: actor('anon-1a2b3c') });
    const res = await new RoomCore<Sock>(DISTRICT, rec.port).onMessage('me', actor('shadowpaw-ab12'), ENTER, []);
    expect(res.detach).toBe(true);
    expect(rec.broadcasts).toEqual([{ msg: { type: 'leave', slug: 'anon-1a2b3c' }, except: 'me' }]);
  });
});
