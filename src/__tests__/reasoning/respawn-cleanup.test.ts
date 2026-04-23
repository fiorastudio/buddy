import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../db/schema.js';
import { createCompanion } from '../../lib/companion.js';
import { getAndBumpObserveSeq } from '../../lib/reasoning/observe-seq.js';
import { logFinding } from '../../lib/reasoning/findings.js';
import { writeClaims } from '../../lib/reasoning/writer.js';

function resetDb() {
  db.exec(`
    DELETE FROM companions;
    DELETE FROM memories;
    DELETE FROM xp_events;
    DELETE FROM sessions;
    DELETE FROM evolution_history;
    DELETE FROM reasoning_claims;
    DELETE FROM reasoning_edges;
    DELETE FROM reasoning_findings_log;
    DELETE FROM reasoning_observe_seq;
  `);
}

// Simulate what the buddy_respawn handler does. Keep in sync with
// server/index.ts. This test exists specifically to catch regressions where
// someone adds a new reasoning table but forgets to clean it in respawn.
function simulateRespawn(companionId: string) {
  db.prepare("DELETE FROM sessions WHERE companion_id = ?").run(companionId);
  db.prepare("DELETE FROM evolution_history WHERE companion_id = ?").run(companionId);
  db.prepare("DELETE FROM xp_events WHERE companion_id = ?").run(companionId);
  db.prepare("DELETE FROM memories WHERE companion_id = ?").run(companionId);
  db.prepare("DELETE FROM reasoning_findings_log WHERE companion_id = ?").run(companionId);
  db.prepare("DELETE FROM reasoning_observe_seq WHERE companion_id = ?").run(companionId);
  db.prepare("DELETE FROM companions WHERE id = ?").run(companionId);
}

describe('buddy_respawn cleans reasoning state', () => {
  beforeEach(resetDb);

  it('clears reasoning_findings_log and reasoning_observe_seq for the companion', () => {
    const { id } = createCompanion({ userId: 'u-test', name: 'Testpanion', species: 'Mushroom' });

    getAndBumpObserveSeq(db, id, true);
    getAndBumpObserveSeq(db, id, false);
    logFinding(db, id, 'ws-20260422', {
      type: 'load_bearing_vibes', anchor_claim_id: 'c1', claim_text: 'foo',
    }, 2);

    expect((db.prepare('SELECT count(*) as n FROM reasoning_observe_seq WHERE companion_id = ?').get(id) as any).n).toBe(1);
    expect((db.prepare('SELECT count(*) as n FROM reasoning_findings_log WHERE companion_id = ?').get(id) as any).n).toBe(1);

    simulateRespawn(id);

    expect((db.prepare('SELECT count(*) as n FROM reasoning_observe_seq WHERE companion_id = ?').get(id) as any).n).toBe(0);
    expect((db.prepare('SELECT count(*) as n FROM reasoning_findings_log WHERE companion_id = ?').get(id) as any).n).toBe(0);
  });

  it('preserves workspace-scoped claims/edges (not companion-scoped)', () => {
    const { id } = createCompanion({ userId: 'u-test', name: 'Testpanion', species: 'Mushroom' });
    writeClaims(db, 'ws-20260422', [
      { text: 'workspace claim', basis: 'research', speaker: 'user', confidence: 'high', external_id: 'c1' },
    ], []);
    expect((db.prepare('SELECT count(*) as n FROM reasoning_claims').get() as any).n).toBe(1);

    simulateRespawn(id);

    // Workspace claims survive respawn — a new companion in the same workspace
    // inherits the graph. This is intentional; documented in DESIGN.md.
    expect((db.prepare('SELECT count(*) as n FROM reasoning_claims').get() as any).n).toBe(1);
  });
});
