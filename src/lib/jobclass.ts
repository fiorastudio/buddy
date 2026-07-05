// src/lib/jobclass.ts
// RO-style job/class titles derived from a buddy's peak stat + level.
// Pure function, no storage — the class IS the stat×level, RO-flavored.
//
// Tiers mirror RO's progression: Novice (1-9) → first job (10-24) →
// second job (25-44) → transcendent (45-50). Each stat maps to a class
// line the way RO stats gate classes (STR→Swordman, INT→Mage, ...).

export type StatName = 'DEBUGGING' | 'PATIENCE' | 'CHAOS' | 'WISDOM' | 'SNARK';

// [novice, first job, second job, transcendent] per stat line.
export const JOB_LINES: Record<string, [string, string, string, string]> = {
  DEBUGGING: ['Novice', 'Swordman', 'Knight', 'Lord Knight'],
  WISDOM: ['Novice', 'Mage', 'Wizard', 'High Wizard'],
  CHAOS: ['Novice', 'Thief', 'Assassin', 'Assassin Cross'],
  PATIENCE: ['Novice', 'Acolyte', 'Priest', 'High Priest'],
  SNARK: ['Novice', 'Bard', 'Clown', 'Maestro'],
};

export interface JobResult {
  title: string;
  tier: number; // 0 novice, 1 first, 2 second, 3 transcendent
  line: string; // the peak stat driving the class
}

function tierForLevel(level: number): number {
  if (level >= 45) return 3;
  if (level >= 25) return 2;
  if (level >= 10) return 1;
  return 0;
}

export function jobClass(peakStat: string, level: number): JobResult {
  const line = JOB_LINES[peakStat] ? peakStat : 'DEBUGGING';
  const tier = tierForLevel(level);
  return { title: JOB_LINES[line][tier], tier, line };
}
