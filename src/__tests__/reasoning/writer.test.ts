import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initReasoningSchema } from '../../lib/reasoning/schema.js';
import { writeClaims, countClaims, loadRecentClaims } from '../../lib/reasoning/writer.js';
import { REASONING_CONFIG } from '../../lib/reasoning/config.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  // Create the minimal companions table the reasoning schema expects for its ALTER.
  db.exec(`CREATE TABLE companions (id TEXT PRIMARY KEY, name TEXT);`);
  initReasoningSchema(db);
  return db;
}

const SID = 'fixture-20260422';

describe('writeClaims — happy path', () => {
  it('writes well-formed claims and resolves edges by external_id', () => {
    const db = freshDb();
    const res = writeClaims(db, SID,
      [
        { text: 'we should use postgres', basis: 'assumption', speaker: 'user', confidence: 'medium', external_id: 'c1' },
        { text: 'postgres handles our scale', basis: 'deduction', speaker: 'assistant', confidence: 'high', external_id: 'c2' },
      ],
      [
        { from: 'c2', to: 'c1', type: 'depends_on' },
      ],
    );
    expect(res.claimsWritten).toBe(2);
    expect(res.claimsDropped).toBe(0);
    expect(res.edgesWritten).toBe(1);
    expect(countClaims(db, SID)).toBe(2);
  });

  it('resolves edges referencing prior-claim UUID prefixes', () => {
    const db = freshDb();
    writeClaims(db, SID,
      [{ text: 'prior claim', basis: 'research', speaker: 'user', confidence: 'high', external_id: 'p1' }],
      [],
    );
    const prior = loadRecentClaims(db, SID, 10);
    expect(prior).toHaveLength(1);
    const priorPrefix = prior[0].id.slice(0, 8);

    const res = writeClaims(db, SID,
      [{ text: 'new claim', basis: 'deduction', speaker: 'assistant', confidence: 'medium', external_id: 'n1' }],
      [{ from: 'n1', to: priorPrefix, type: 'supports' }],
    );
    expect(res.edgesWritten).toBe(1);
    expect(res.edgesDropped).toBe(0);
  });
});

describe('writeClaims — validation', () => {
  it('drops claims with invalid basis', () => {
    const db = freshDb();
    const res = writeClaims(db, SID,
      [{ text: 'bad', basis: 'not-a-basis' as any, speaker: 'user', confidence: 'low', external_id: 'c1' }],
      [],
    );
    expect(res.claimsWritten).toBe(0);
    expect(res.claimsDropped).toBe(1);
  });

  it('drops claims with empty text after sanitization', () => {
    const db = freshDb();
    const res = writeClaims(db, SID,
      [{ text: '   \n\t  ', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' }],
      [],
    );
    expect(res.claimsWritten).toBe(0);
    expect(res.claimsDropped).toBe(1);
  });

  it('drops edges referencing unknown external_ids', () => {
    const db = freshDb();
    const res = writeClaims(db, SID, [], [{ from: 'unknown', to: 'also-unknown', type: 'supports' }]);
    expect(res.edgesDropped).toBe(1);
  });

  it('drops malformed edges (missing type, self-loops)', () => {
    const db = freshDb();
    writeClaims(db, SID,
      [{ text: 'a', basis: 'vibes', speaker: 'user', confidence: 'low', external_id: 'c1' }],
      [],
    );
    const res = writeClaims(db, SID, [],
      [{ from: 'c1', to: 'c1', type: 'supports' } as any],
    );
    // Self-loops dropped (though c1 isn't resolvable here anyway since it's from a prior payload);
    // the point is no throw and no write.
    expect(res.edgesWritten).toBe(0);
  });

  it('ignores undefined claims/edges without throwing', () => {
    const db = freshDb();
    const res = writeClaims(db, SID, undefined, undefined);
    expect(res.claimsWritten).toBe(0);
    expect(res.edgesWritten).toBe(0);
  });
});

describe('writeClaims — cap enforcement', () => {
  it('prunes oldest when session exceeds MAX_CLAIMS_PER_SESSION', () => {
    const db = freshDb();
    const over = REASONING_CONFIG.MAX_CLAIMS_PER_SESSION + 5;
    const claims = Array.from({ length: over }, (_, i) => ({
      text: `claim ${i}`,
      basis: 'deduction' as const,
      speaker: 'assistant' as const,
      confidence: 'medium' as const,
      external_id: `c${i}`,
    }));
    writeClaims(db, SID, claims, []);
    const count = countClaims(db, SID);
    expect(count).toBeLessThanOrEqual(REASONING_CONFIG.MAX_CLAIMS_PER_SESSION);
  });
});
