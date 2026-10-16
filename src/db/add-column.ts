// src/db/add-column.ts
//
// The one ADD COLUMN migration helper. Lives in its own side-effect-free module
// (schema.ts opens the DB on import) so every schema initializer — initDb() and
// the per-table ones it calls, such as initXpEventsSchema() — can share it
// without an import cycle through schema.ts.

import type Database from 'better-sqlite3';

/** True for SQLite's "duplicate column name: x" — the column is already there. */
export function isDuplicateColumnError(err: unknown): boolean {
  return err instanceof Error && /duplicate column name/i.test(err.message);
}

/**
 * `ALTER TABLE <table> ADD COLUMN <columnDef>`, tolerating only the column
 * already existing. Anything else — SQLITE_BUSY past busy_timeout, a read-only
 * or corrupt DB file, a full disk — is rethrown (X11). The old bare
 * `catch {}` swallowed those too, so initDb() reported success with the column
 * missing and the first query that used it failed somewhere far away.
 */
export function addColumnIfMissing(conn: Database.Database, table: string, columnDef: string): void {
  try {
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    if (!isDuplicateColumnError(err)) throw err;
  }
}
