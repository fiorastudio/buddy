import { describe, it, expect } from 'vitest';
import {
  RoomCore,
  isFreshSeq,
  diffActors,
  type RoomPort,
  type ServerMsg,
  type ActorState,
  type AuthResult,
} from '../../lib/world/room-core.js';

// A fake socket is just a string id; a fake port records everything the core
// tries to send so tests can assert on the wire protocol without a real WS.
type Sock = string;

interface Recorder {
  port: RoomPort<Sock>;
  sent: Array<{ socket: Sock; msg: ServerMsg }>;
  broadcasts: Array<{ msg: ServerMsg; except?: Sock }>;
}

function makePort(opts: { verify?: (t: string) => AuthResult | null; now?: number } = {}): Recorder {
  const sent: Recorder['sent'] = [];
  const broadcasts: Recorder['broadcasts'] = [];
  const port: RoomPort<Sock> = {
    now: () => opts.now ?? 1000,
    send: (socket, msg) => sent.push({ socket, msg }),
    broadcast: (msg, except) => broadcasts.push({ msg, except }),
    verify: async (t) => (opts.verify ? opts.verify(t) : null),
  };
  return { port, sent, broadcasts };
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
