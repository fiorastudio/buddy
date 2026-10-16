import { describe, it, expect } from 'vitest';
import { validateSnapshot } from '../../lib/world/validate.js';
import { totalXpForLevel } from '../../lib/leveling.js';

function validSnapshot() {
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
    avatar: 'chibi-3',
  };
}

describe('validateSnapshot', () => {
  it('accepts a valid snapshot', () => {
    const result = validateSnapshot(validSnapshot());
    expect(result.ok).toBe(true);
  });

  it('rejects level inconsistent with xp curve', () => {
    const snap = { ...validSnapshot(), level: 50, xp: 200 };
    const result = validateSnapshot(snap);
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/level/i) });
  });

  it('rejects unknown species', () => {
    const snap = { ...validSnapshot(), species: 'Dragonlord Supreme' };
    const result = validateSnapshot(snap);
    expect(result).toMatchObject({ ok: false, reason: expect.stringMatching(/species/i) });
  });

  it('rejects empty or overlong names', () => {
    expect(validateSnapshot({ ...validSnapshot(), name: '' }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), name: 'x'.repeat(33) }).ok).toBe(false);
  });

  it('rejects names containing HTML-dangerous characters', () => {
    for (const name of ['<img src=x onerror=alert(1)>', 'a<b>b', 'x&y', 'q"q', "p'p", 'tick`tick']) {
      expect(validateSnapshot({ ...validSnapshot(), name }).ok, name).toBe(false);
    }
    expect(validateSnapshot({ ...validSnapshot(), name: 'Sir Quacks-a-lot III.' }).ok).toBe(true);
  });

  it('rejects stats outside 0-100', () => {
    const snap = validSnapshot();
    snap.stats.chaos = 150;
    expect(validateSnapshot(snap).ok).toBe(false);
  });

  it('rejects unknown mood, rarity, hat, and eye values', () => {
    expect(validateSnapshot({ ...validSnapshot(), mood: 'euphoric' }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), rarity: 'mythic' }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), hat: 'fedora' }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), eye: '$' }).ok).toBe(false);
  });

  it('tolerates xp slightly above the current level threshold but below next', () => {
    // level 5 spans [totalXpForLevel(5), totalXpForLevel(6))
    const snap = { ...validSnapshot(), xp: totalXpForLevel(6) - 1, level: 5 };
    expect(validateSnapshot(snap).ok).toBe(true);
  });

  // Release audit B4: whatever passes validation is stored and served to every
  // viewer, so the result must be rebuilt from known fields only.
  it('returns a canonical snapshot: unknown top-level and stat keys are dropped', () => {
    const input = {
      ...validSnapshot(),
      bio: 'x'.repeat(10_000),
      stats: { ...validSnapshot().stats, junk: 'y'.repeat(10_000), nested: { a: 1 } },
    };
    const result = validateSnapshot(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.snapshot).sort()).toEqual(
      ['avatar', 'eye', 'hat', 'level', 'mood', 'name', 'rarity', 'shiny', 'species', 'stats', 'xp'].sort()
    );
    expect(result.snapshot.stats).toEqual(validSnapshot().stats);
    expect(result.snapshot).not.toBe(input);
  });

  it('rejects a non-object or missing stats block and non-numeric stats', () => {
    expect(validateSnapshot({ ...validSnapshot(), stats: undefined }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), stats: [60, 40, 80, 30, 70] }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), stats: { ...validSnapshot().stats, snark: '70' } }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), stats: { ...validSnapshot().stats, wisdom: -1 } }).ok).toBe(false);
  });

  it('keeps chibi-1..chibi-8 avatars and drops anything else (never a 400)', () => {
    for (let i = 1; i <= 8; i++) {
      expect(validateSnapshot({ ...validSnapshot(), avatar: `chibi-${i}` }).ok).toBe(true);
    }
    const none = validateSnapshot({ ...validSnapshot(), avatar: undefined });
    expect(none.ok && none.snapshot.avatar).toBe(undefined);
    expect(validateSnapshot({ ...validSnapshot(), avatar: null }).ok).toBe(true);
    for (const avatar of ['chibi-0', 'chibi-9', 'chibi-10', 'chibi-1 ', 'x'.repeat(5000), 3, { a: 1 }, '']) {
      const r = validateSnapshot({ ...validSnapshot(), avatar });
      expect(r.ok, String(avatar).slice(0, 20)).toBe(true);
      expect(r.ok && 'avatar' in r.snapshot, String(avatar).slice(0, 20)).toBe(false);
    }
  });

  it('rejects non-string enum fields, a non-boolean shiny, and a non-safe-integer xp', () => {
    expect(validateSnapshot({ ...validSnapshot(), hat: ['none'] }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), species: { toString: () => 'Void Cat' } }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), shiny: 'yes' }).ok).toBe(false);
    expect(validateSnapshot({ ...validSnapshot(), xp: 1e300, level: 50 }).ok).toBe(false);
  });

  // Release audit B14: name hygiene lives in the shared gate so every path
  // (teleport, warp, /v1/events) applies it.
  it('rejects profane names', () => {
    expect(validateSnapshot({ ...validSnapshot(), name: 'sh1tlord' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/filter/),
    });
  });

  it('strips control and bidi characters from names', () => {
    const name = '‮Sh\u0000adow⁦paw⁩‏\u0085\u001b[31m';
    const result = validateSnapshot({ ...validSnapshot(), name });
    expect(result.ok && result.snapshot.name).toBe('Shadowpaw[31m');
    for (const ch of ['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '؜', '‎', '\u007f', '\u009f', '\t', '\n']) {
      const r = validateSnapshot({ ...validSnapshot(), name: `Sh${ch}adowpaw` });
      expect(r.ok && r.snapshot.name, JSON.stringify(ch)).toBe('Shadowpaw');
    }
    // Emoji sequences (ZWJ) are not bidi/control and survive.
    const emoji = validateSnapshot({ ...validSnapshot(), name: 'Pixel 🧑‍💻' });
    expect(emoji.ok && emoji.snapshot.name).toBe('Pixel 🧑‍💻');
  });

  it('rejects a name that is only invisible characters', () => {
    expect(validateSnapshot({ ...validSnapshot(), name: '‮⁦\u0000 ' }).ok).toBe(false);
  });
});

