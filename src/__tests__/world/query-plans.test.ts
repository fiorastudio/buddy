// B13: the queries that read world_events and daily_rollups must use an index
// as those tables grow. Captures the SQL D1WorldStore actually sends and asks
// SQLite (D1's engine) how it would run it.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { D1WorldStore, type D1Like } from '../../lib/world/d1-store.js';
import { sqliteAsD1 } from './d1-shim.js';
import { totalXpForLevel } from '../../lib/leveling.js';
import type { WorldSnapshot } from '../../lib/world/validate.js';

const T0 = 1_800_000_000_000;
const DAY = 86_400_000;

const snap: WorldSnapshot = {
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
  avatar: 'chibi-1',
};

// Record every bound statement (SQL + args) the store sends.
function capturing(inner: D1Like): { db: D1Like; seen: Array<{ sql: string; args: unknown[] }> } {
  const seen: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    exec: (sql: string) => inner.exec(sql),
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        seen.push({ sql, args });
        return inner.prepare(sql).bind(...args);
      },
    }),
    batch: (stmts: unknown[]) => (inner as unknown as { batch(s: unknown[]): Promise<unknown[]> }).batch(stmts),
  } as unknown as D1Like;
  return { db, seen };
}

async function setup() {
  const raw = new Database(':memory:');
  const { db, seen } = capturing(sqliteAsD1(raw));
  const store = await D1WorldStore.create(db);
  await store.teleport('tokenhash-1', snap, T0);
  const plan = (match: RegExp): string => {
    const stmt = seen.find((s) => match.test(s.sql));
    if (!stmt) throw new Error(`no statement matched ${match}`);
    return (raw.prepare(`EXPLAIN QUERY PLAN ${stmt.sql}`).all(...(stmt.args as never[])) as Array<{ detail: string }>)
      .map((r) => r.detail)
      .join('\n');
  };
  return { store, seen, plan };
}

describe('hot world queries use an index (B13)', () => {
  it('announcements read only the announce types in the window (type, ts)', async () => {
    const { store, plan } = await setup();
    await store.announcements(30, T0 - DAY, T0);
    expect(plan(/ROW_NUMBER/)).toMatch(/USING INDEX idx_events_type_ts \(type=\? AND ts>\? AND ts<\?\)/);
  });

  it('a purge deletes rollups by citizen without scanning the table', async () => {
    const { store, plan } = await setup();
    await store.recall('tokenhash-1', true);
    const p = plan(/DELETE FROM daily_rollups/);
    expect(p).toMatch(/idx_rollups_citizen/);
    expect(p).not.toMatch(/^SCAN daily_rollups/m);
  });

  it('the town roster and capacity count use the (district, last_seen_at) index', async () => {
    const { store, plan } = await setup();
    await store.district('plaza-1', T0 - DAY, T0);
    await store.districtCounts(T0 - DAY);
    expect(plan(/FROM citizens WHERE district = \?/)).toMatch(/idx_citizens_district_seen/);
    expect(plan(/GROUP BY district/)).toMatch(/idx_citizens_district_seen/);
  });

  it('the district event window and the daily rollup read by index, not a table scan', async () => {
    const { store, plan } = await setup();
    await store.district('plaza-1', T0 - DAY, T0);
    await store.rollup(new Date(T0).toISOString().slice(0, 10));
    for (const p of [plan(/FROM world_events e JOIN citizens c ON c.id = e.citizen_id\s+WHERE c.district/), plan(/GROUP BY citizen_id, type/)]) {
      expect(p).toMatch(/USING (COVERING )?INDEX/);
      expect(p).not.toMatch(/^SCAN world_events/m);
    }
  });
});
