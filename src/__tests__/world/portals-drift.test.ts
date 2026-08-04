import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORTALS } from '../../lib/world/portals.js';

// Guards the invariant portals.ts documents: the PORTALS topology (id, from, to)
// MUST match the PORTALS array inlined in world/public/plaza.js. The client
// renders/hit-tests gates from its copy; the server validates the target from
// this one. If the two drift, a gate labelled "Payon" could warp you somewhere
// else — the same failure mode the TOWN_NAMES ↔ TOWNS[] guard prevents.
describe('portal graph drift guard', () => {
  it('PORTALS (id, from, to) matches the PORTALS array in world/public/plaza.js', () => {
    const plaza = readFileSync(join(process.cwd(), 'world/public/plaza.js'), 'utf8');
    const start = plaza.indexOf('const PORTALS = [');
    expect(start).toBeGreaterThan(-1);
    const block = plaza.slice(start, plaza.indexOf('];', start));
    const triples = [...block.matchAll(/id:\s*'([^']+)',\s*from:\s*'([^']+)',\s*to:\s*'([^']+)'/g)].map((m) => ({
      id: m[1],
      from: m[2],
      to: m[3],
    }));
    expect(triples).toEqual(PORTALS.map((p) => ({ id: p.id, from: p.from, to: p.to })));
  });

  it('is a valid hub-and-spoke: every satellite links to Prontera and back', () => {
    const hub = 'plaza-1';
    const satellites = ['plaza-2', 'plaza-3', 'plaza-4', 'plaza-5', 'plaza-6'];
    for (const s of satellites) {
      expect(PORTALS.some((p) => p.from === hub && p.to === s), `hub → ${s}`).toBe(true);
      expect(PORTALS.some((p) => p.from === s && p.to === hub), `${s} → hub`).toBe(true);
    }
    // No satellite-to-satellite shortcuts — travel always routes through the hub.
    const satToSat = PORTALS.filter((p) => p.from !== hub && p.to !== hub);
    expect(satToSat).toHaveLength(0);
  });
});
