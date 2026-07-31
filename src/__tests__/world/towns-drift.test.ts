import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOWN_NAMES } from '../../lib/world/towns.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The server-side town registry (towns.ts) and the client's rich TOWNS[] in
// plaza.js must agree on names AND order — order is what maps a town to its
// plaza-N. This guards against the two drifting silently.
describe('world/public/plaza.js TOWNS drift guard', () => {
  it('plaza.js town names/order match TOWN_NAMES', () => {
    const src = readFileSync(join(repoRoot, 'world', 'public', 'plaza.js'), 'utf8');
    const start = src.indexOf('const TOWNS = [');
    expect(start, 'TOWNS array not found in plaza.js').toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf('];', start));
    const names = [...block.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(names).toEqual([...TOWN_NAMES]);
  });
});
