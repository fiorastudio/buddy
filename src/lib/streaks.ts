// src/lib/streaks.ts
// Daily streaks. A streak survives until a full UTC day passes with no
// events — today counts once played, and a streak ending yesterday still
// shows (grace) so owners aren't punished at 00:01.

export function currentStreakFromDays(activityDays: Iterable<string>, today: string): number {
  const days = new Set(activityDays);
  if (days.size === 0) return 0;

  const dayMs = 86_400_000;
  const todayMs = Date.parse(`${today}T00:00:00.000Z`);
  const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  let startMs: number;
  if (days.has(today)) startMs = todayMs;
  else if (days.has(dayStr(todayMs - dayMs))) startMs = todayMs - dayMs;
  else return 0;

  let streak = 0;
  for (let ms = startMs; days.has(dayStr(ms)); ms -= dayMs) streak++;
  return streak;
}

// Minimal structural slice of better-sqlite3 so this module owns its own
// queries without importing the driver.
interface DbLike {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
  };
}

/**
 * True when the events just awarded are the first of a new UTC day AND the
 * resulting streak lands on a 7-day milestone. Owns both queries so the
 * server chokepoint stays a one-line call.
 */
export function checkStreakMilestone(db: DbLike, companionId: string, eventsJustAwarded: number): boolean {
  const todayRow = db
    .prepare("SELECT COUNT(*) AS n FROM xp_events WHERE companion_id = ? AND date(created_at) = date('now')")
    .get(companionId) as { n?: number } | undefined;
  if ((todayRow?.n ?? 0) > eventsJustAwarded) return false; // not the first award of the day

  const dayRows = db
    .prepare(
      "SELECT DISTINCT date(created_at) AS d FROM xp_events WHERE companion_id = ? AND created_at > datetime('now', '-400 days')"
    )
    .all(companionId) as Array<{ d: string }>;
  const streak = currentStreakFromDays(
    dayRows.map((r) => r.d),
    new Date().toISOString().slice(0, 10)
  );
  return streak > 0 && streak % 7 === 0;
}
