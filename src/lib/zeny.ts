// src/lib/zeny.ts
// Zeny — RO's currency. Buddies earn it alongside XP from coding events;
// the amounts are deliberately larger than XP so the numbers feel RO-big
// (you watch your Zeny climb into the thousands, the classic RO dopamine).

const ZENY_REWARDS: Record<string, number> = {
  observe: 12,
  session: 8,
  tests_passed: 40,
  commit: 55,
  bug_fix: 90,
  deploy: 150,
  streak_7: 500, // milestone bonus
  level_up: 0,
};

export function zenyForEvent(eventType: string): number {
  return ZENY_REWARDS[eventType] ?? 5;
}

export function formatZeny(z: number): string {
  return `${Math.round(z).toLocaleString('en-US')}z`;
}
