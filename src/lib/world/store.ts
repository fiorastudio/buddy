// src/lib/world/store.ts
// Persistence for Buddy World. The interface is async so handlers can run
// against this better-sqlite3 implementation (tests, self-hosting) or a
// Cloudflare D1 implementation (deploy) interchangeably.

import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { WORLD_SCHEMA_SQL, WORLD_EVENT_TYPES, type WorldEventType } from './schema-sql.js';
import { makeSlug } from './identity.js';
import { pickDistrict } from './districts.js';
import type { WorldSnapshot } from './validate.js';

export interface CitizenRow {
  id: string;
  slug: string;
  name: string;
  species: string;
  level: number;
  xp: number;
  mood: string;
  stats: WorldSnapshot['stats'];
  rarity: string;
  shiny: boolean;
  hat: string;
  eye: string;
  anon: boolean;
  skin: string;
  avatar: string | null;
  district: string;
  hidden: boolean;
  flagged: boolean;
  xp_bucket: number;
  created_at: number;
  last_seen_at: number;
}

export interface WorldEvent {
  citizen_slug: string;
  type: WorldEventType;
  ts: number;
}

export interface TeleportResult {
  created: boolean;
  slug: string;
  district: string;
}

export interface DistrictView {
  citizens: Array<Omit<CitizenRow, 'id'>>;
  events: WorldEvent[];
}

export interface WorldStore {
  teleport(tokenHash: string, snap: WorldSnapshot, nowMs: number): Promise<TeleportResult>;
  findByTokenHash(tokenHash: string): Promise<CitizenRow | null>;
  updateSnapshot(citizenId: string, snap: WorldSnapshot, nowMs: number, xpBucket?: number): Promise<void>;
  recordEvents(citizenId: string, events: Array<{ type: string; ts: number }>): Promise<number>;
  recall(tokenHash: string, purge: boolean): Promise<boolean>;
  district(name: string, sinceMs: number): Promise<DistrictView>;
  districtCounts(): Promise<Record<string, number>>;
  rollup(date: string): Promise<number>;
  getRollups(date: string): Promise<Array<{ citizen_id: string; event_counts: Record<string, number>; xp_gained: number }>>;
  setAnon(tokenHash: string, anon: boolean): Promise<boolean>;
  markFlagged(citizenId: string): Promise<void>;
}

function rowToCitizen(row: Record<string, unknown>): CitizenRow {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    species: row.species as string,
    level: row.level as number,
    xp: row.xp as number,
    mood: row.mood as string,
    stats: JSON.parse(row.stats as string),
    rarity: row.rarity as string,
    shiny: !!row.shiny,
    hat: row.hat as string,
    eye: row.eye as string,
    anon: !!row.anon,
    skin: row.skin as string,
    avatar: (row.avatar as string) ?? null,
    district: row.district as string,
    hidden: !!row.hidden,
    flagged: !!row.flagged,
    xp_bucket: row.xp_bucket as number,
    created_at: row.created_at as number,
    last_seen_at: row.last_seen_at as number,
  };
}

export class SqliteWorldStore implements WorldStore {
  constructor(private db: Database) {
    db.exec(WORLD_SCHEMA_SQL);
  }

  async teleport(tokenHash: string, snap: WorldSnapshot, nowMs: number): Promise<TeleportResult> {
    const existing = this.db.prepare('SELECT * FROM citizens WHERE token_hash = ?').get(tokenHash) as
      | Record<string, unknown>
      | undefined;

    if (existing) {
      // Snapshot fields are NOT written here: re-teleport must go through
      // the handler's clamped update path, never around it.
      this.db
        .prepare('UPDATE citizens SET hidden = 0, avatar = COALESCE(?, avatar) WHERE id = ?')
        .run(snap.avatar ?? null, existing.id);
      return { created: false, slug: existing.slug as string, district: existing.district as string };
    }

    const district = pickDistrict(await this.districtCounts());
    const id = randomUUID();
    let slug = makeSlug(snap.name);
    // Regenerate on the (rare) suffix collision rather than failing the insert.
    while (this.db.prepare('SELECT 1 FROM citizens WHERE slug = ?').get(slug)) {
      slug = makeSlug(snap.name);
    }
    this.db
      .prepare(
        `INSERT INTO citizens (id, slug, token_hash, name, species, level, xp, mood, stats, rarity,
          shiny, hat, eye, avatar, district, created_at, last_seen_at, xp_bucket)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 60)`
      )
      .run(
        id,
        slug,
        tokenHash,
        snap.name,
        snap.species,
        snap.level,
        snap.xp,
        snap.mood,
        JSON.stringify(snap.stats),
        snap.rarity,
        snap.shiny ? 1 : 0,
        snap.hat,
        snap.eye,
        snap.avatar ?? null,
        district,
        nowMs,
        nowMs
      );
    return { created: true, slug, district };
  }

  async findByTokenHash(tokenHash: string): Promise<CitizenRow | null> {
    const row = this.db.prepare('SELECT * FROM citizens WHERE token_hash = ?').get(tokenHash) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToCitizen(row) : null;
  }

  async updateSnapshot(citizenId: string, snap: WorldSnapshot, nowMs: number, xpBucket?: number): Promise<void> {
    const prev = this.db.prepare('SELECT level, xp_bucket FROM citizens WHERE id = ?').get(citizenId) as
      | { level: number; xp_bucket: number }
      | undefined;
    if (!prev) return;

    this.db
      .prepare(
        `UPDATE citizens SET name = ?, species = ?, level = ?, xp = ?, mood = ?, stats = ?,
          rarity = ?, shiny = ?, hat = ?, eye = ?, last_seen_at = ?, xp_bucket = ? WHERE id = ?`
      )
      .run(
        snap.name,
        snap.species,
        snap.level,
        snap.xp,
        snap.mood,
        JSON.stringify(snap.stats),
        snap.rarity,
        snap.shiny ? 1 : 0,
        snap.hat,
        snap.eye,
        nowMs,
        xpBucket ?? prev.xp_bucket,
        citizenId
      );

    if (snap.level > prev.level) {
      this.db
        .prepare('INSERT INTO world_events (citizen_id, type, ts) VALUES (?, ?, ?)')
        .run(citizenId, 'level_up', nowMs);
    }
  }

  async recordEvents(citizenId: string, events: Array<{ type: string; ts: number }>): Promise<number> {
    const insert = this.db.prepare('INSERT INTO world_events (citizen_id, type, ts) VALUES (?, ?, ?)');
    let accepted = 0;
    let maxTs = 0;
    for (const ev of events) {
      if (!(WORLD_EVENT_TYPES as readonly string[]).includes(ev.type)) continue;
      if (!Number.isFinite(ev.ts)) continue;
      insert.run(citizenId, ev.type, ev.ts);
      accepted++;
      maxTs = Math.max(maxTs, ev.ts);
    }
    if (maxTs > 0) {
      this.db
        .prepare('UPDATE citizens SET last_seen_at = MAX(last_seen_at, ?) WHERE id = ?')
        .run(maxTs, citizenId);
    }
    return accepted;
  }

  async recall(tokenHash: string, purge: boolean): Promise<boolean> {
    const citizen = await this.findByTokenHash(tokenHash);
    if (!citizen) return false;
    if (purge) {
      this.db.prepare('DELETE FROM world_events WHERE citizen_id = ?').run(citizen.id);
      this.db.prepare('DELETE FROM daily_rollups WHERE citizen_id = ?').run(citizen.id);
      this.db.prepare('DELETE FROM citizens WHERE id = ?').run(citizen.id);
    } else {
      this.db.prepare('UPDATE citizens SET hidden = 1 WHERE id = ?').run(citizen.id);
    }
    return true;
  }

  async district(name: string, sinceMs: number): Promise<DistrictView> {
    const citizenRows = this.db
      .prepare('SELECT * FROM citizens WHERE district = ? AND hidden = 0 ORDER BY created_at')
      .all(name) as Array<Record<string, unknown>>;

    const eventRows = this.db
      .prepare(
        `SELECT c.slug AS citizen_slug, e.type, e.ts
         FROM world_events e JOIN citizens c ON c.id = e.citizen_id
         WHERE c.district = ? AND c.hidden = 0 AND e.ts >= ?
         ORDER BY e.ts DESC LIMIT 200`
      )
      .all(name, sinceMs) as Array<Record<string, unknown>>;

    return {
      citizens: citizenRows.map((row) => {
        const { id: _id, ...publicCitizen } = rowToCitizen(row);
        return publicCitizen;
      }),
      events: eventRows.map((row) => ({
        citizen_slug: row.citizen_slug as string,
        type: row.type as WorldEventType,
        ts: row.ts as number,
      })),
    };
  }

  async districtCounts(): Promise<Record<string, number>> {
    const rows = this.db
      .prepare('SELECT district, COUNT(*) AS n FROM citizens GROUP BY district')
      .all() as Array<{ district: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.district, r.n]));
  }

  async rollup(date: string): Promise<number> {
    const dayStart = Date.parse(`${date}T00:00:00.000Z`);
    const dayEnd = dayStart + 86_400_000;
    const rows = this.db
      .prepare(
        `SELECT citizen_id, type, COUNT(*) AS n FROM world_events
         WHERE ts >= ? AND ts < ? GROUP BY citizen_id, type`
      )
      .all(dayStart, dayEnd) as Array<{ citizen_id: string; type: string; n: number }>;

    const byCitizen = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const counts = byCitizen.get(row.citizen_id) ?? {};
      counts[row.type] = row.n;
      byCitizen.set(row.citizen_id, counts);
    }

    const upsert = this.db.prepare(
      `INSERT INTO daily_rollups (date, citizen_id, event_counts, xp_gained) VALUES (?, ?, ?, 0)
       ON CONFLICT(date, citizen_id) DO UPDATE SET event_counts = excluded.event_counts`
    );
    for (const [citizenId, counts] of byCitizen) {
      upsert.run(date, citizenId, JSON.stringify(counts));
    }
    return byCitizen.size;
  }

  async getRollups(date: string) {
    const rows = this.db
      .prepare('SELECT citizen_id, event_counts, xp_gained FROM daily_rollups WHERE date = ?')
      .all(date) as Array<{ citizen_id: string; event_counts: string; xp_gained: number }>;
    return rows.map((r) => ({
      citizen_id: r.citizen_id,
      event_counts: JSON.parse(r.event_counts) as Record<string, number>,
      xp_gained: r.xp_gained,
    }));
  }

  async markFlagged(citizenId: string): Promise<void> {
    this.db.prepare('UPDATE citizens SET flagged = 1 WHERE id = ?').run(citizenId);
  }

  async setAnon(tokenHash: string, anon: boolean): Promise<boolean> {
    const res = this.db
      .prepare('UPDATE citizens SET anon = ? WHERE token_hash = ?')
      .run(anon ? 1 : 0, tokenHash);
    return res.changes > 0;
  }
}
