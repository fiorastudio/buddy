// BUDDY_DEBUG=1 surfaces per-claim and per-edge drop reasons so hosts
// debugging a "0 claims written" symptom can see which field failed
// validation. Without this they're squinting at result counts.
//
// Also verifies the redaction defense — if a user's transcript contains
// a key string in a claim text, the drop log must NOT echo it back to
// stderr.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { writeClaims } from '../../lib/reasoning/writer.js';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  return db;
}

describe('writeClaims BUDDY_DEBUG diagnostics', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let captured: string[];
  const originalDebug = process.env.BUDDY_DEBUG;

  beforeEach(() => {
    captured = [];
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(((...args: any[]) => {
      captured.push(args.map(String).join(' '));
    }) as any);
    process.env.BUDDY_DEBUG = '1';
  });
  afterEach(() => {
    stderrSpy.mockRestore();
    if (originalDebug === undefined) delete process.env.BUDDY_DEBUG;
    else process.env.BUDDY_DEBUG = originalDebug;
  });

  it('logs the per-field reason when a claim has invalid basis', () => {
    const db = memDb();
    writeClaims(db, 's1', [
      { text: 'a claim', basis: 'made_up', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    const log = captured.join('\n');
    expect(log).toMatch(/invalid basis/);
    expect(log).toMatch(/made_up/);
  });

  it('logs missing external_id with a helpful hint', () => {
    const db = memDb();
    writeClaims(db, 's1', [
      { text: 'orphan', basis: 'vibes', speaker: 'user', confidence: 'low' },
    ], []);
    const log = captured.join('\n');
    expect(log).toMatch(/missing external_id/);
  });

  it('logs unresolved edge endpoints', () => {
    const db = memDb();
    writeClaims(db, 's1', [], [
      { from: 'no-such', to: 'also-missing', type: 'depends_on' },
    ]);
    const log = captured.join('\n');
    expect(log).toMatch(/dropped edge/);
    expect(log).toMatch(/unresolved/);
  });

  it('redacts sk-ant- keys that appear in dropped claim text', () => {
    const db = memDb();
    writeClaims(db, 's1', [
      // user pasted a curl example into chat; assistant claim text quoted it.
      // Invalid basis triggers the drop, payload includes the key.
      { text: 'curl -H "x-api-key: sk-ant-key1234567890abcdef1234567890abcdef" ...', basis: 'made_up', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    const log = captured.join('\n');
    expect(log).not.toMatch(/sk-ant-key1234567890abcdef/);
    expect(log).toContain('REDACTED');
  });

  it('does not log anything when BUDDY_DEBUG is unset', () => {
    delete process.env.BUDDY_DEBUG;
    const db = memDb();
    writeClaims(db, 's1', [
      { text: 'a claim', basis: 'made_up', speaker: 'user', confidence: 'low', external_id: 'c1' },
    ], []);
    expect(captured.join('')).toBe('');
  });
});
