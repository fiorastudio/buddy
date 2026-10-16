// src/lib/world/d1-store.ts
// WorldStore over Cloudflare D1. D1Like is structural so this compiles
// without Cloudflare type packages and is testable against a SQLite shim.
// SQL here MUST stay semantically identical to SqliteWorldStore.

import { randomUUID } from 'node:crypto';
import {
  WORLD_SCHEMA_SQL,
  WORLD_EVENT_TYPES,
  ANNOUNCE_EVENT_TYPES,
  ANNOUNCE_MAX_PER_CITIZEN,
  type WorldEventType,
} from './schema-sql.js';
import { makeSlug } from './identity.js';
import { HUB_DISTRICT, WORLD_CITIZEN_LIMIT } from './districts.js';
import { pickStats, pickAvatar, type WorldSnapshot } from './validate.js';
import type {
  WorldStore,
  CitizenRow,
  TeleportResult,
  DistrictView,
  WorldEvent,
  AnnouncementRow,
} from './store.js';

export interface D1BoundStatement {
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}

export interface D1Like {
  exec(sql: string): Promise<unknown>;
  prepare(sql: string): {
    bind(...args: unknown[]): D1BoundStatement;
  };
  // D1 runs a batch as one implicit transaction: all statements land or none do.
  batch(statements: D1BoundStatement[]): Promise<unknown[]>;
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
    stats: pickStats(JSON.parse(row.stats as string)),
    rarity: row.rarity as string,
    shiny: !!row.shiny,
    hat: row.hat as string,
    eye: row.eye as string,
    anon: !!row.anon,
    skin: row.skin as string,
    avatar: pickAvatar(row.avatar),
    country: (row.country as string) ?? null,
    district: row.district as string,
    hidden: !!row.hidden,
    flagged: !!row.flagged,
    xp_bucket: row.xp_bucket as number,
    created_at: row.created_at as number,
    last_seen_at: row.last_seen_at as number,
  };
}

export class D1WorldStore implements WorldStore {
  private constructor(private db: D1Like) {}

  // D1 migrations normally apply the schema at deploy time; exec here makes
  // the store self-sufficient for tests and fresh databases (IF NOT EXISTS).
  static async create(db: D1Like): Promise<D1WorldStore> {
    // Use prepare().run(), NOT exec(): D1's exec() splits input on newlines and
    // treats each line as its own statement, so a multi-line CREATE TABLE fails
    // with "incomplete input". prepare() runs the whole statement as one unit.
    for (const stmt of WORLD_SCHEMA_SQL.split(';')) {
      const sql = stmt.trim();
      if (sql) await db.prepare(sql).bind().run();
    }
    return new D1WorldStore(db);
  }

  async teleport(tokenHash: string, snap: WorldSnapshot, nowMs: number, desiredDistrict?: string, country?: string | null): Promise<TeleportResult> {
    const existing = await this.db
      .prepare('SELECT * FROM citizens WHERE token_hash = ?')
      .bind(tokenHash)
      .first<Record<string, unknown>>();

    if (existing) {
      // Snapshot fields are NOT written here: re-teleport must go through
      // the handler's clamped update path, never around it. The movable
      // fields are `district` (owner asks to move towns) and `country`
      // (refreshed from the request origin; COALESCE keeps the old flag if
      // this request had no country).
      const district = desiredDistrict ?? (existing.district as string);
      await this.db
        .prepare('UPDATE citizens SET hidden = 0, avatar = COALESCE(?, avatar), district = ?, country = COALESCE(?, country) WHERE id = ?')
        .bind(pickAvatar(snap.avatar), district, country ?? null, existing.id)
        .run();
      return { created: false, slug: existing.slug as string, district };
    }

    // Everyone lands in the same place (Prontera) — from there they can `warp`.
    const district = desiredDistrict ?? HUB_DISTRICT;
    const id = randomUUID();
    let slug = makeSlug(snap.name);
    while (await this.db.prepare('SELECT 1 FROM citizens WHERE slug = ?').bind(slug).first()) {
      slug = makeSlug(snap.name);
    }
    await this.db
      .prepare(
        `INSERT INTO citizens (id, slug, token_hash, name, species, level, xp, mood, stats, rarity,
          shiny, hat, eye, avatar, country, district, created_at, last_seen_at, xp_bucket)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 60)`
      )
      .bind(
        id,
        slug,
        tokenHash,
        snap.name,
        snap.species,
        snap.level,
        snap.xp,
        snap.mood,
        JSON.stringify(pickStats(snap.stats)),
        snap.rarity,
        snap.shiny ? 1 : 0,
        snap.hat,
        snap.eye,
        pickAvatar(snap.avatar),
        country ?? null,
        district,
        nowMs,
        nowMs
      )
      .run();
    return { created: true, slug, district };
  }

  async findByTokenHash(tokenHash: string): Promise<CitizenRow | null> {
    const row = await this.db
      .prepare('SELECT * FROM citizens WHERE token_hash = ?')
      .bind(tokenHash)
      .first<Record<string, unknown>>();
    return row ? rowToCitizen(row) : null;
  }

  async updateSnapshot(citizenId: string, snap: WorldSnapshot, nowMs: number, xpBucket?: number): Promise<void> {
    const prev = await this.db
      .prepare('SELECT level, xp_bucket FROM citizens WHERE id = ?')
      .bind(citizenId)
      .first<{ level: number; xp_bucket: number }>();
    if (!prev) return;

    await this.db
      .prepare(
        `UPDATE citizens SET name = ?, species = ?, level = ?, xp = ?, mood = ?, stats = ?,
          rarity = ?, shiny = ?, hat = ?, eye = ?, last_seen_at = ?, xp_bucket = ? WHERE id = ?`
      )
      .bind(
        snap.name,
        snap.species,
        snap.level,
        snap.xp,
        snap.mood,
        JSON.stringify(pickStats(snap.stats)),
        snap.rarity,
        snap.shiny ? 1 : 0,
        snap.hat,
        snap.eye,
        nowMs,
        xpBucket ?? prev.xp_bucket,
        citizenId
      )
      .run();

    if (snap.level > prev.level) {
      await this.db
        .prepare('INSERT INTO world_events (citizen_id, type, ts) VALUES (?, ?, ?)')
        .bind(citizenId, 'level_up', nowMs)
        .run();
    }
  }

  async recordEvents(citizenId: string, events: Array<{ type: string; ts: number }>): Promise<number> {
    // Collected and sent as ONE db.batch() (a transaction): a failure part-way
    // through writes nothing, so the client's retry cannot insert duplicates.
    const writes: D1BoundStatement[] = [];
    let accepted = 0;
    let maxTs = 0;
    for (const ev of events) {
      if (!(WORLD_EVENT_TYPES as readonly string[]).includes(ev.type)) continue;
      if (!Number.isFinite(ev.ts)) continue;
      writes.push(this.db
        .prepare('INSERT INTO world_events (citizen_id, type, ts) VALUES (?, ?, ?)')
        .bind(citizenId, ev.type, ev.ts));
      accepted++;
      maxTs = Math.max(maxTs, ev.ts);
    }
    if (maxTs > 0) {
      writes.push(this.db
        .prepare('UPDATE citizens SET last_seen_at = MAX(last_seen_at, ?) WHERE id = ?')
        .bind(maxTs, citizenId));
    }
    if (writes.length > 0) await this.db.batch(writes);
    return accepted;
  }

  async recall(tokenHash: string, purge: boolean): Promise<boolean> {
    const citizen = await this.findByTokenHash(tokenHash);
    if (!citizen) return false;
    if (purge) {
      await this.db.prepare('DELETE FROM world_events WHERE citizen_id = ?').bind(citizen.id).run();
      await this.db.prepare('DELETE FROM daily_rollups WHERE citizen_id = ?').bind(citizen.id).run();
      await this.db.prepare('DELETE FROM link_codes WHERE citizen_id = ?').bind(citizen.id).run();
      await this.db.prepare('DELETE FROM browser_sessions WHERE citizen_id = ?').bind(citizen.id).run();
      await this.db.prepare('DELETE FROM citizens WHERE id = ?').bind(citizen.id).run();
    } else {
      // Recall = leave the world: revoke every browser credential too, so a
      // stale control token can't rejoin a live room or read /v1/me. A later
      // re-teleport un-hides the citizen; the owner mints a fresh link then.
      await this.db.prepare('DELETE FROM link_codes WHERE citizen_id = ?').bind(citizen.id).run();
      await this.db.prepare('DELETE FROM browser_sessions WHERE citizen_id = ?').bind(citizen.id).run();
      await this.db.prepare('UPDATE citizens SET hidden = 1 WHERE id = ?').bind(citizen.id).run();
    }
    return true;
  }

  async district(
    name: string,
    sinceMs: number,
    untilMs: number,
    residentSinceMs = 0,
    limit = WORLD_CITIZEN_LIMIT
  ): Promise<DistrictView> {
    // Most-recently-seen residents win the LIMIT; the outer ORDER BY keeps the
    // response in stable arrival order for the plaza.
    const citizenRows = await this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM citizens WHERE district = ? AND hidden = 0 AND last_seen_at >= ?
           ORDER BY MIN(last_seen_at, ?) DESC, created_at DESC LIMIT ?
         ) ORDER BY created_at`
      )
      .bind(name, residentSinceMs, untilMs, limit)
      .all<Record<string, unknown>>();

    const eventRows = await this.db
      .prepare(
        `SELECT c.slug AS citizen_slug, e.type, e.ts
         FROM world_events e JOIN citizens c ON c.id = e.citizen_id
         WHERE c.district = ? AND c.hidden = 0 AND e.ts >= ? AND e.ts <= ?
         ORDER BY e.ts DESC LIMIT 200`
      )
      .bind(name, sinceMs, untilMs)
      .all<Record<string, unknown>>();

    return {
      citizens: citizenRows.results.map((row) => {
        const { id: _id, ...publicCitizen } = rowToCitizen(row);
        return publicCitizen;
      }),
      events: eventRows.results.map(
        (row): WorldEvent => ({
          citizen_slug: row.citizen_slug as string,
          type: row.type as WorldEventType,
          ts: row.ts as number,
        })
      ),
    };
  }

  async announcements(limit: number, sinceMs: number, untilMs: number): Promise<AnnouncementRow[]> {
    const placeholders = ANNOUNCE_EVENT_TYPES.map(() => '?').join(', ');
    // ROW_NUMBER per citizen enforces ANNOUNCE_MAX_PER_CITIZEN.
    const rows = await this.db
      .prepare(
        `SELECT id, slug, name, species, anon, level, district, type, ts FROM (
           SELECT e.id, c.slug, c.name, c.species, c.anon, c.level, c.district, e.type, e.ts,
             ROW_NUMBER() OVER (PARTITION BY e.citizen_id ORDER BY e.ts DESC, e.id DESC) AS rn
           FROM world_events e JOIN citizens c ON c.id = e.citizen_id
           WHERE c.hidden = 0 AND e.type IN (${placeholders}) AND e.ts >= ? AND e.ts <= ?
         ) WHERE rn <= ?
         ORDER BY ts DESC, id DESC LIMIT ?`
      )
      .bind(...ANNOUNCE_EVENT_TYPES, sinceMs, untilMs, ANNOUNCE_MAX_PER_CITIZEN, limit)
      .all<Record<string, unknown>>();
    return rows.results.map(
      (row): AnnouncementRow => ({
        id: row.id as number,
        slug: row.slug as string,
        name: row.name as string,
        species: row.species as string,
        anon: !!row.anon,
        level: row.level as number,
        district: row.district as string,
        type: row.type as WorldEventType,
        ts: row.ts as number,
      })
    );
  }

  async districtCounts(sinceMs: number): Promise<Record<string, number>> {
    // hidden = 0 only: a recalled/hidden citizen isn't shown in the town, so it
    // must not count against the town's capacity either. Same for a citizen not
    // seen since `sinceMs` — it has wandered off and frees its slot.
    const rows = await this.db
      .prepare('SELECT district, COUNT(*) AS n FROM citizens WHERE hidden = 0 AND last_seen_at >= ? GROUP BY district')
      .bind(sinceMs)
      .all<{ district: string; n: number }>();
    return Object.fromEntries(rows.results.map((r) => [r.district, r.n]));
  }

  async setDistrict(citizenId: string, district: string): Promise<void> {
    await this.db.prepare('UPDATE citizens SET district = ? WHERE id = ?').bind(district, citizenId).run();
  }

  async rollup(date: string): Promise<number> {
    const dayStart = Date.parse(`${date}T00:00:00.000Z`);
    const dayEnd = dayStart + 86_400_000;
    const rows = await this.db
      .prepare(
        `SELECT citizen_id, type, COUNT(*) AS n FROM world_events
         WHERE ts >= ? AND ts < ? GROUP BY citizen_id, type`
      )
      .bind(dayStart, dayEnd)
      .all<{ citizen_id: string; type: string; n: number }>();

    const byCitizen = new Map<string, Record<string, number>>();
    for (const row of rows.results) {
      const counts = byCitizen.get(row.citizen_id) ?? {};
      counts[row.type] = row.n;
      byCitizen.set(row.citizen_id, counts);
    }

    for (const [citizenId, counts] of byCitizen) {
      await this.db
        .prepare(
          `INSERT INTO daily_rollups (date, citizen_id, event_counts, xp_gained) VALUES (?, ?, ?, 0)
           ON CONFLICT(date, citizen_id) DO UPDATE SET event_counts = excluded.event_counts`
        )
        .bind(date, citizenId, JSON.stringify(counts))
        .run();
    }
    return byCitizen.size;
  }

  async getRollups(date: string) {
    const rows = await this.db
      .prepare('SELECT citizen_id, event_counts, xp_gained FROM daily_rollups WHERE date = ?')
      .bind(date)
      .all<{ citizen_id: string; event_counts: string; xp_gained: number }>();
    return rows.results.map((r) => ({
      citizen_id: r.citizen_id,
      event_counts: JSON.parse(r.event_counts) as Record<string, number>,
      xp_gained: r.xp_gained,
    }));
  }

  async markFlagged(citizenId: string): Promise<void> {
    await this.db.prepare('UPDATE citizens SET flagged = 1 WHERE id = ?').bind(citizenId).run();
  }

  async setAnon(tokenHash: string, anon: boolean): Promise<boolean> {
    const citizen = await this.findByTokenHash(tokenHash);
    if (!citizen) return false;
    await this.db.prepare('UPDATE citizens SET anon = ? WHERE token_hash = ?').bind(anon ? 1 : 0, tokenHash).run();
    return true;
  }

  async createLinkCode(citizenId: string, codeHash: string, expiresAt: number): Promise<void> {
    await this.db
      .prepare('INSERT INTO link_codes (code_hash, citizen_id, expires_at) VALUES (?, ?, ?)')
      .bind(codeHash, citizenId, expiresAt)
      .run();
  }

  async consumeLinkCode(codeHash: string, nowMs: number): Promise<string | null> {
    // DELETE ... RETURNING makes consume atomic and single-use: the row is gone
    // the moment it's read, so a concurrent/replay exchange finds nothing.
    const row = await this.db
      .prepare('DELETE FROM link_codes WHERE code_hash = ? AND expires_at > ? RETURNING citizen_id')
      .bind(codeHash, nowMs)
      .first<{ citizen_id: string }>();
    return row?.citizen_id ?? null;
  }

  async createBrowserSession(citizenId: string, tokenHash: string, scope: string, expiresAt: number): Promise<void> {
    await this.db
      .prepare('INSERT INTO browser_sessions (token_hash, citizen_id, scope, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, citizenId, scope, expiresAt)
      .run();
  }

  async findCitizenByBrowserToken(
    tokenHash: string,
    nowMs: number
  ): Promise<{ citizen: CitizenRow; scope: string } | null> {
    const row = await this.db
      .prepare(
        `SELECT c.*, s.scope AS session_scope FROM browser_sessions s
         JOIN citizens c ON c.id = s.citizen_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND c.hidden = 0`
      )
      .bind(tokenHash, nowMs)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return { citizen: rowToCitizen(row), scope: row.session_scope as string };
  }
}
