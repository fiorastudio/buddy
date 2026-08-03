import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOWN_NAMES } from '../../lib/world/towns.js';

// Guards the invariant towns.ts documents: TOWN_NAMES order MUST match the
// TOWNS[] array in world/public/plaza.js. The server maps a town name to
// plaza-N by index; the client renders plaza-N -> town by the same index, so
// if these drift, a buddy warped to "Payon" would render as a different town.
describe('town order drift guard', () => {
  it('TOWN_NAMES matches the TOWNS[] order in world/public/plaza.js', () => {
    const plaza = readFileSync(join(process.cwd(), 'world/public/plaza.js'), 'utf8');
    const start = plaza.indexOf('const TOWNS');
    expect(start).toBeGreaterThan(-1);
    const block = plaza.slice(start, plaza.indexOf('];', start));
    const names = [...block.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(names).toEqual([...TOWN_NAMES]);
  });
});
