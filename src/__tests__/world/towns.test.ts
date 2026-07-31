import { describe, it, expect } from 'vitest';
import { TOWN_NAMES, TOWN_BLURB, districtForTown, townForDistrict } from '../../lib/world/towns.js';

describe('town registry', () => {
  it('maps town name → plaza-N by order', () => {
    expect(districtForTown('Prontera')).toBe('plaza-1');
    expect(districtForTown('Geffen')).toBe('plaza-3');
    expect(districtForTown('Lutie')).toBe('plaza-6');
  });

  it('resolves town names case-insensitively and trimmed', () => {
    expect(districtForTown('geffen')).toBe('plaza-3');
    expect(districtForTown('  MORROC ')).toBe('plaza-5');
  });

  it('returns null for an unknown town', () => {
    expect(districtForTown('Gondor')).toBeNull();
    expect(districtForTown('')).toBeNull();
  });

  it('accepts a raw plaza-N as its own district', () => {
    expect(districtForTown('plaza-4')).toBe('plaza-4');
  });

  it('maps plaza-N → town name (wrapping like the plaza)', () => {
    expect(townForDistrict('plaza-1')).toBe('Prontera');
    expect(townForDistrict('plaza-3')).toBe('Geffen');
    expect(townForDistrict('plaza-7')).toBe('Prontera'); // wraps mod 6
    expect(townForDistrict('plaza-12')).toBe('Lutie');
  });

  it('returns null for a non-district string', () => {
    expect(townForDistrict('downtown')).toBeNull();
    expect(townForDistrict('plaza-0')).toBeNull();
  });

  it('has a blurb for every town', () => {
    for (const name of TOWN_NAMES) {
      expect(TOWN_BLURB[name], `blurb for ${name}`).toBeTruthy();
    }
  });
});
