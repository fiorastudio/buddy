// src/lib/leveling.ts

export const MAX_LEVEL = 50;

export const XP_REWARDS: Record<string, number> = {
  observe: 2,
  commit: 5,
  bug_fix: 8,
  deploy: 15,
  session: 1,
};

// Exponential curve: easy early, hard late
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(10 * Math.pow(level, 2.2));
}

// Total XP needed to reach a level from level 1
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 2; i <= level; i++) {
    total += xpForLevel(i);
  }
  return total;
}

// Given current total XP, what level are we?
export function levelFromXp(totalXp: number): number {
  let level = 1;
  let accumulated = 0;
  while (level < MAX_LEVEL) {
    const needed = xpForLevel(level + 1);
    if (accumulated + needed > totalXp) break;
    accumulated += needed;
    level++;
  }
  return level;
}

// XP progress within current level (0.0 to 1.0)
export function levelProgress(totalXp: number): { level: number; currentXp: number; neededXp: number; progress: number } {
  const level = levelFromXp(totalXp);
  if (level >= MAX_LEVEL) return { level, currentXp: 0, neededXp: 0, progress: 1.0 };

  const xpAtCurrentLevel = totalXpForLevel(level);
  const currentXp = totalXp - xpAtCurrentLevel;
  const neededXp = xpForLevel(level + 1);
  const progress = neededXp > 0 ? currentXp / neededXp : 1.0;

  return { level, currentXp, neededXp, progress };
}

// Format level progress as a bar
export function levelBar(totalXp: number): string {
  const { level, currentXp, neededXp, progress } = levelProgress(totalXp);
  if (level >= MAX_LEVEL) return `Lv.${MAX_LEVEL} MAX`;

  const barWidth = 10;
  const filled = Math.floor(progress * barWidth);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  return `Lv.${level} [${bar}] ${currentXp}/${neededXp} XP`;
}
