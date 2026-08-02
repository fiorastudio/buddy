import { describe, it, expect } from 'vitest';
import { jobClass, JOB_LINES } from '../lib/jobclass.js';

describe('jobClass — RO-style class from peak stat + level', () => {
  it('everyone starts as a Novice below level 10', () => {
    expect(jobClass('DEBUGGING', 1).title).toBe('Novice');
    expect(jobClass('CHAOS', 9).title).toBe('Novice');
    expect(jobClass('WISDOM', 5).tier).toBe(0);
  });

  it('first job at 10-24 follows the peak stat line', () => {
    expect(jobClass('DEBUGGING', 10).title).toBe('Swordman');
    expect(jobClass('WISDOM', 15).title).toBe('Mage');
    expect(jobClass('CHAOS', 20).title).toBe('Thief');
    expect(jobClass('PATIENCE', 12).title).toBe('Acolyte');
    expect(jobClass('SNARK', 24).title).toBe('Bard');
  });

  it('second job at 25-44', () => {
    expect(jobClass('DEBUGGING', 25).title).toBe('Knight');
    expect(jobClass('WISDOM', 30).title).toBe('Wizard');
    expect(jobClass('CHAOS', 40).title).toBe('Assassin');
    expect(jobClass('PATIENCE', 44).title).toBe('Priest');
  });

  it('transcendent at 45+ prefixes "High"/"Lord"', () => {
    expect(jobClass('DEBUGGING', 45).title).toBe('Lord Knight');
    expect(jobClass('WISDOM', 50).title).toBe('High Wizard');
    expect(jobClass('DEBUGGING', 50).tier).toBe(3);
  });

  it('exposes a stat→line map covering all five stats', () => {
    for (const stat of ['DEBUGGING', 'PATIENCE', 'CHAOS', 'WISDOM', 'SNARK']) {
      expect(JOB_LINES[stat]).toBeDefined();
      expect(JOB_LINES[stat]).toHaveLength(4); // novice + 3 tiers
    }
  });

  it('is deterministic and defined at every level 1-50', () => {
    for (let l = 1; l <= 50; l++) {
      const j = jobClass('WISDOM', l);
      expect(j.title).toBeTruthy();
      expect(j.tier).toBeGreaterThanOrEqual(0);
      expect(j.tier).toBeLessThanOrEqual(3);
    }
  });
});
