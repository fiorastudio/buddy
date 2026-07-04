// src/lib/streaks.ts
// Daily streak from activity timestamps. A streak survives until a full
// UTC day passes with no events — today counts once played, and a streak
// ending yesterday still shows (grace) so owners aren't punished at 00:01.

const DAY_MS = 86_400_000;

export function currentStreakDays(activityTimestamps: number[], nowMs: number): number {
  if (activityTimestamps.length === 0) return 0;
  const days = new Set(activityTimestamps.map((ts) => Math.floor(ts / DAY_MS)));
  const today = Math.floor(nowMs / DAY_MS);

  let start: number;
  if (days.has(today)) start = today;
  else if (days.has(today - 1)) start = today - 1;
  else return 0;

  let streak = 0;
  for (let d = start; days.has(d); d--) streak++;
  return streak;
}
