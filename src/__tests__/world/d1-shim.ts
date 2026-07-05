// Test shim: presents better-sqlite3 through the D1Like interface so the
// D1WorldStore's SQL is exercised by the same suite as the local store.
import type { Database } from 'better-sqlite3';
import type { D1Like } from '../../lib/world/d1-store.js';

export function sqliteAsD1(db: Database): D1Like {
  return {
    async exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              db.prepare(sql).run(...(args as never[]));
            },
            async all<T>() {
              return { results: db.prepare(sql).all(...(args as never[])) as T[] };
            },
            async first<T>() {
              return (db.prepare(sql).get(...(args as never[])) as T) ?? null;
            },
          };
        },
      };
    },
  };
}
