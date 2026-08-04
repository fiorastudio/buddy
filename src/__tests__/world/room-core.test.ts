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
    // seq is consumed so a duplicate frame is dropped (dedupe).
    expect(res.attach?.seq).toBe(1);
    // The old socket is neutralized server-side (normal closure) so a client
    // that ignores the redirect can't keep moving in the town it just left.
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

  it('dedupes a duplicate portal_enter by seq (only one warp + one redirect)', async () => {
    const rec = makePort();
    const core = new RoomCore<Sock>(DISTRICT, rec.port);
    const first = await core.onMessage(
      'me',
      actor('x', { seq: 0 }),
      JSON.stringify({ type: 'portal_enter', ...HELLO_SEQ }),
      []
    );
    expect(first.attach?.seq).toBe(1);
    // The DO persists the bumped seq; a re-delivered frame with the SAME seq
    // must be dropped — no second warp, no second redirect.
    const dup = await core.onMessage(
      'me',
      first.attach!,
      JSON.stringify({ type: 'portal_enter', ...HELLO_SEQ }),
      []
    );
    expect(dup.attach).toBeUndefined();
    expect(rec.warps).toHaveLength(1);
    expect(rec.sent.filter((s) => s.msg.type === 'room_redirect')).toHaveLength(1);
    expect(rec.broadcasts.filter((b) => b.msg.type === 'leave')).toHaveLength(1);
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
