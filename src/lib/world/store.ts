// src/lib/world/store.ts
// Persistence for Buddy World. The interface is async so handlers can run
// against this better-sqlite3 implementation (tests, self-hosting) or a
// Cloudflare D1 implementation (deploy) interchangeably.

import { randomUUID } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import { WORLD_SCHEMA_SQL, WORLD_EVENT_TYPES, ANNOUNCE_EVENT_TYPES, type WorldEventType } from './schema-sql.js';
import { makeSlug } from './identity.js';
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
  country: string | null;
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

// One row of the GLOBAL celebration feed (M6). Carries the raw citizen identity
// (slug/name/species/anon) so the HANDLER can apply anon masking exactly like
// handleWorld — the store stays masking-agnostic, mirroring district().
export interface AnnouncementRow {
  // The world_events row id — a STABLE per-event key. Two celebrations of the
  // same type in the same millisecond share slug/type/ts but never an id, so
  // the client de-dupes on this and never drops the second one.
  id: number;
  slug: string;
  name: string;
  species: string;
  anon: boolean;
  level: number;
  district: string;
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
  teleport(tokenHash: string, snap: WorldSnapshot, nowMs: number, desiredDistrict?: string, country?: string | null): Promise<TeleportResult>;
  findByTokenHash(tokenHash: string): Promise<CitizenRow | null>;
  updateSnapshot(citizenId: string, snap: WorldSnapshot, nowMs: number, xpBucket?: number): Promise<void>;
  recordEvents(citizenId: string, events: Array<{ type: string; ts: number }>): Promise<number>;
  recall(tokenHash: string, purge: boolean): Promise<boolean>;
  district(name: string, sinceMs: number): Promise<DistrictView>;
  // GLOBAL celebration feed (M6): the most recent celebration-class events
  // (ANNOUNCE_EVENT_TYPES) across ALL districts, newest first, from visible
  // citizens only. Returns raw identity; the handler masks anon buddies.
  announcements(limit: number): Promise<AnnouncementRow[]>;
  // Live per-town population, counting ONLY visible (hidden=0) citizens so the
  // capacity gate matches what district()/handleWorld actually render.
  districtCounts(): Promise<Record<string, number>>;
  // Move a citizen's town. District-ONLY: never touches xp/level/etc. This is
  // the write the scoped portal-warp path uses (it must not write XP).
  setDistrict(citizenId: string, district: string): Promise<void>;
  rollup(date: string): Promise<number>;
  getRollups(date: string): Promise<Array<{ citizen_id: string; event_counts: Record<string, number>; xp_gained: number }>>;
  setAnon(tokenHash: string, anon: boolean): Promise<boolean>;
  markFlagged(citizenId: string): Promise<void>;
  // Browser identity (M1): one-time link codes → scoped control tokens.
  createLinkCode(citizenId: string, codeHash: string, expiresAt: number): Promise<void>;
  // Single-use: returns the citizen id and deletes the row in one atomic step,
  // or null if the code is unknown/already-used/expired at `nowMs`.
  consumeLinkCode(codeHash: string, nowMs: number): Promise<string | null>;
  createBrowserSession(citizenId: string, tokenHash: string, scope: string, expiresAt: number): Promise<void>;
  // Resolves a live (unexpired at `nowMs`) control token to its owner + scope.
  findCitizenByBrowserToken(tokenHash: string, nowMs: number): Promise<{ citizen: CitizenRow; scope: string } | null>;
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
    country: (row.country as string) ?? null,
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

  async teleport(tokenHash: string, snap: WorldSnapshot, nowMs: number, desiredDistrict?: string, country?: string | null): Promise<TeleportResult> {
    const existing = this.db.prepare('SELECT * FROM citizens WHERE token_hash = ?').get(tokenHash) as
      | Record<string, unknown>
      | undefined;

    if (existing) {
      // Snapshot fields are NOT written here: re-teleport must go through
      // the handler's clamped update path, never around it. The movable
      // fields are `district` (owner asks to move towns) and `country`
      // (refreshed from the request origin; COALESCE keeps the old flag if
      // this request had no country).
      const district = desiredDistrict ?? (existing.district as string);
      this.db
        .prepare('UPDATE citizens SET hidden = 0, avatar = COALESCE(?, avatar), district = ?, country = COALESCE(?, country) WHERE id = ?')
        .run(snap.avatar ?? null, district, country ?? null, existing.id);
      return { created: false, slug: existing.slug as string, district };
    }

    // Everyone lands in the same place (Prontera) — from there they can `warp`.
    const district = desiredDistrict ?? 'plaza-1';
    const id = randomUUID();
    let slug = makeSlug(snap.name);
    // Regenerate on the (rare) suffix collision rather than failing the insert.
    while (this.db.prepare('SELECT 1 FROM citizens WHERE slug = ?').get(slug)) {
      slug = makeSlug(snap.name);
    }
    this.db
      .prepare(
        `INSERT INTO citizens (id, slug, token_hash, name, species, level, xp, mood, stats, rarity,
          shiny, hat, eye, avatar, country, district, created_at, last_seen_at, xp_bucket)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 60)`
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
        country ?? null,
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
      this.db.prepare('DELETE FROM link_codes WHERE citizen_id = ?').run(citizen.id);
      this.db.prepare('DELETE FROM browser_sessions WHERE citizen_id = ?').run(citizen.id);
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

  async announcements(limit: number): Promise<AnnouncementRow[]> {
    const placeholders = ANNOUNCE_EVENT_TYPES.map(() => '?').join(', ');
    const rows = this.db
      .prepare(
        `SELECT e.id, c.slug, c.name, c.species, c.anon, c.level, c.district, e.type, e.ts
         FROM world_events e JOIN citizens c ON c.id = e.citizen_id
         WHERE c.hidden = 0 AND e.type IN (${placeholders})
         ORDER BY e.ts DESC, e.id DESC LIMIT ?`
      )
      .all(...ANNOUNCE_EVENT_TYPES, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as number,
      slug: row.slug as string,
      name: row.name as string,
      species: row.species as string,
      anon: !!row.anon,
      level: row.level as number,
      district: row.district as string,
      type: row.type as WorldEventType,
      ts: row.ts as number,
    }));
  }

  async districtCounts(): Promise<Record<string, number>> {
    // hidden = 0 only: a recalled/hidden citizen isn't shown in the town, so it
    // must not count against the town's capacity either.
    const rows = this.db
      .prepare('SELECT district, COUNT(*) AS n FROM citizens WHERE hidden = 0 GROUP BY district')
      .all() as Array<{ district: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.district, r.n]));
  }

  async setDistrict(citizenId: string, district: string): Promise<void> {
    this.db.prepare('UPDATE citizens SET district = ? WHERE id = ?').run(district, citizenId);
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

  async createLinkCode(citizenId: string, codeHash: string, expiresAt: number): Promise<void> {
    this.db
      .prepare('INSERT INTO link_codes (code_hash, citizen_id, expires_at) VALUES (?, ?, ?)')
      .run(codeHash, citizenId, expiresAt);
  }

  async consumeLinkCode(codeHash: string, nowMs: number): Promise<string | null> {
    // DELETE ... RETURNING makes consume atomic and single-use: the row is gone
    // the moment it's read, so a concurrent/replay exchange finds nothing.
    const row = this.db
      .prepare('DELETE FROM link_codes WHERE code_hash = ? AND expires_at > ? RETURNING citizen_id')
      .get(codeHash, nowMs) as { citizen_id: string } | undefined;
    return row?.citizen_id ?? null;
  }

  async createBrowserSession(citizenId: string, tokenHash: string, scope: string, expiresAt: number): Promise<void> {
    this.db
      .prepare('INSERT INTO browser_sessions (token_hash, citizen_id, scope, expires_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, citizenId, scope, expiresAt);
  }

  async findCitizenByBrowserToken(
    tokenHash: string,
    nowMs: number
  ): Promise<{ citizen: CitizenRow; scope: string } | null> {
    const row = this.db
      .prepare(
        `SELECT c.*, s.scope AS session_scope FROM browser_sessions s
         JOIN citizens c ON c.id = s.citizen_id
         WHERE s.token_hash = ? AND s.expires_at > ?`
      )
      .get(tokenHash, nowMs) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { citizen: rowToCitizen(row), scope: row.session_scope as string };
  }
}
