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
});
