import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_SCHEMA_SQL, WORLD_MIGRATIONS } from '../../lib/world/schema-sql.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('D1 migration drift guard', () => {
  it('migrations/0001_init.sql matches WORLD_SCHEMA_SQL exactly', () => {
    const migration = readFileSync(join(repoRoot, 'world', 'migrations', '0001_init.sql'), 'utf8');
    // Ignore the generated-file banner comment, compare the SQL itself.
    const body = migration.replace(/^--.*\n/gm, '').trim();
    // 0001 is the first entry of WORLD_SCHEMA_SQL; later migrations follow it.
    expect(body).toBe(WORLD_MIGRATIONS[0].sql.trim());
  });

  it('every file in world/migrations is mirrored in WORLD_MIGRATIONS, in order', () => {
    const dir = join(repoRoot, 'world', 'migrations');
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    expect(files).toEqual(WORLD_MIGRATIONS.map((m) => m.file));
    for (const m of WORLD_MIGRATIONS) {
      // Normalise CRLF (a Windows checkout with core.autocrlf), drop the banner.
      const body = readFileSync(join(dir, m.file), 'utf8')
        .replace(/\r\n/g, '\n')
        .replace(/^--.*\n/gm, '')
        .trim();
      expect(body, m.file).toBe(m.sql.trim());
    }
  });

  it('WORLD_SCHEMA_SQL is every migration, in order', () => {
    expect(WORLD_SCHEMA_SQL.trim()).toBe(WORLD_MIGRATIONS.map((m) => m.sql.trim()).join('\n\n'));
  });
});
