// B11: the world schema's DDL must not run on every Durable Object wake or
// request. These tests count the statements each path prepares against D1.
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { D1WorldStore } from '../../lib/world/d1-store.js';
import { WORLD_SCHEMA_SQL } from '../../lib/world/schema-sql.js';
import { createWorldFetchHandler } from '../../world/worker-core.js';
import { sqliteAsD1 } from './d1-shim.js';
import type { D1Like } from '../../lib/world/d1-store.js';

const DDL = /^\s*CREATE\s/i;
const DDL_STATEMENTS = WORLD_SCHEMA_SQL.split(';').filter((s) => s.trim()).length;

// Wrap a D1 binding and record the SQL of every statement it prepares.
function counting(inner: D1Like, opts: { failNext?: boolean } = {}): D1Like & { sql: string[]; ddl(): number } {
  const sql: string[] = [];
  const wrapped = {
    sql,
    ddl: () => sql.filter((s) => DDL.test(s)).length,
    exec: (s: string) => {
      sql.push(s);
      return inner.exec(s);
    },
    prepare: (s: string) => {
      sql.push(s);
      if (opts.failNext) {
        opts.failNext = false;
        throw new Error('D1 unavailable');
      }
      return inner.prepare(s);
    },
    batch: (stmts: unknown[]) => (inner as unknown as { batch(s: unknown[]): Promise<unknown[]> }).batch(stmts),
  };
  return wrapped as unknown as D1Like & { sql: string[]; ddl(): number };
}

describe('world schema runs at most once per binding (B11)', () => {
  it('a fresh database gets the full schema once; a second store on the same binding prepares nothing', async () => {
    const db = counting(sqliteAsD1(new Database(':memory:')));
    await D1WorldStore.create(db);
    expect(db.ddl()).toBe(DDL_STATEMENTS);

    const before = db.sql.length;
    await D1WorldStore.create(db);
    await D1WorldStore.create(db);
    expect(db.sql.length).toBe(before);
  });

  it('a new binding over an already-migrated database (a DO wake) costs one read and no DDL', async () => {
    const raw = new Database(':memory:');
    await D1WorldStore.create(sqliteAsD1(raw)); // "the migration"

    const wake = counting(sqliteAsD1(raw));
    const store = await D1WorldStore.create(wake);
    expect(wake.ddl()).toBe(0);
    expect(wake.sql).toHaveLength(1);
    expect(wake.sql[0]).toMatch(/sqlite_master/);
    // ...and the store works.
    expect(await store.findByTokenHash('nope')).toBeNull();
  });

  it('a database missing one schema object gets the (idempotent) DDL again', async () => {
    const raw = new Database(':memory:');
    await D1WorldStore.create(sqliteAsD1(raw));
    raw.exec('DROP INDEX idx_events_ts');

    const db = counting(sqliteAsD1(raw));
    await D1WorldStore.create(db);
    expect(db.ddl()).toBe(DDL_STATEMENTS);
    expect(raw.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'idx_events_ts'`).get()).toBeTruthy();
  });

  it('a failed check is retried by the next caller, not cached', async () => {
    const opts = { failNext: true };
    const db = counting(sqliteAsD1(new Database(':memory:')), opts);
    await expect(D1WorldStore.create(db)).rejects.toThrow(/D1 unavailable/);
    await D1WorldStore.create(db);
    expect(db.ddl()).toBe(DDL_STATEMENTS);
  });

  it('the worker runs the schema once across many requests, and a new isolate only re-checks it', async () => {
    const raw = new Database(':memory:');
    const first = counting(sqliteAsD1(raw));
    const handler = createWorldFetchHandler({ db: first, baseUrl: 'https://world.example.com' });
    for (let i = 0; i < 5; i++) {
      const res = await handler(new Request('https://world.example.com/v1/world/plaza-1'));
      expect(res.status).toBe(200);
    }
    expect(first.ddl()).toBe(DDL_STATEMENTS);

    const second = counting(sqliteAsD1(raw));
    const next = createWorldFetchHandler({ db: second, baseUrl: 'https://world.example.com' });
    for (let i = 0; i < 5; i++) await next(new Request('https://world.example.com/v1/world/plaza-1'));
    expect(second.ddl()).toBe(0);
    expect(second.sql.filter((s) => /sqlite_master/.test(s))).toHaveLength(1);
  });
});
