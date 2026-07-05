// src/lib/leveling.ts

export const MAX_LEVEL = 50;

// Rewards boosted 2026-07: commit/bug_fix/deploy were defined but never
// fired (no classification existed), leaving everyone at flat 5 XP —
// level 50 (104,925 XP) needed ~21k observes. With two-channel event
// classification these fire for real, and skilled events pay properly.
// NOTE: the curve itself must NOT change — the world server validates
// level === levelFromXp(xp), so a curve change breaks old clients.
export const XP_REWARDS: Record<string, number> = {
  observe: 8,
  commit: 25,
  tests_passed: 20,
  bug_fix: 35,
  deploy: 60,
  session: 5,
};

// Buddy World blessing: teleported buddies earn +10%.
export function applyBlessing(xp: number, blessed: boolean): number {
  return blessed ? Math.round(xp * 1.1) : xp;
}

// Exponential curve: fast early, smooth mid, grindy late
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.floor(5 * Math.pow(level, 1.8));
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
