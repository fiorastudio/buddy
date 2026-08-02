import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORLD_SCHEMA_SQL } from '../../lib/world/schema-sql.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('D1 migration drift guard', () => {
  it('migrations/0001_init.sql matches WORLD_SCHEMA_SQL exactly', () => {
    const migration = readFileSync(join(repoRoot, 'world', 'migrations', '0001_init.sql'), 'utf8');
    // Ignore the generated-file banner comment, compare the SQL itself.
    const body = migration.replace(/^--.*\n/gm, '').trim();
    expect(body).toBe(WORLD_SCHEMA_SQL.trim());
  });
});
