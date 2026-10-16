// Test shim: presents better-sqlite3 through the D1Like interface so the
// D1WorldStore's SQL is exercised by the same suite as the local store.
import type { Database } from 'better-sqlite3';
import type { D1Like, D1BoundStatement } from '../../lib/world/d1-store.js';

export function sqliteAsD1(db: Database): D1Like {
  // batch() needs the SQL + args behind each bound statement so it can run
  // them synchronously inside one better-sqlite3 transaction.
  const bound = new WeakMap<D1BoundStatement, { sql: string; args: unknown[] }>();
  return {
    async exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const stmt: D1BoundStatement = {
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
          bound.set(stmt, { sql, args });
          return stmt;
        },
      };
    },
    // Like D1: every statement in one transaction; any failure rolls back all.
    async batch(statements: D1BoundStatement[]) {
      const runAll = db.transaction(() =>
        statements.map((s) => {
          const entry = bound.get(s);
          if (!entry) throw new Error('batch(): statement was not prepared by this shim');
          const prepared = db.prepare(entry.sql);
          return prepared.reader
            ? { results: prepared.all(...(entry.args as never[])) }
            : prepared.run(...(entry.args as never[]));
        })
      );
      return runAll();
    },
  };
}
