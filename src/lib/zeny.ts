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
  // Milestone bonus. streak_7 is deliberately absent from XP_REWARDS: the
  // milestone is a world celebration + this Zeny bonus, and its xp_events row
  // pays only the 1-XP fallback. No spec ever set an XP amount; adding one is
  // a product decision (and the hook filter in award.ts would then need to
  // stop accepting streak_7 from the pending-events queue).
  streak_7: 500,
  level_up: 0,
};

export function zenyForEvent(eventType: string): number {
  // Object.hasOwn so a prototype key ('toString') can't return a function.
  return Object.hasOwn(ZENY_REWARDS, eventType) ? ZENY_REWARDS[eventType] : 5;
}

export function formatZeny(z: number): string {
  return `${Math.round(z).toLocaleString('en-US')}z`;
}
