// Live end-to-end smoke test for Buddy World.
//
// Drives the REAL deployed stack over HTTP — teleport -> verify in /v1/world ->
// events -> verify still present -> recall --purge -> verify gone — with a
// synthetic buddy and a throwaway token, cleaning up after itself. This covers
// the CLI/client -> Worker -> D1 -> world API path that the fixture-based
// plaza-smoke tests don't.
//
// Usage:
//   node scripts/e2e-live-smoke.mjs
//   BUDDY_WORLD_API=https://your-world.workers.dev node scripts/e2e-live-smoke.mjs
//
// Requires a prior `npm run build` (imports from dist/). Exits non-zero on failure.

import { randomUUID } from 'node:crypto';
import { levelFromXp } from '../dist/lib/leveling.js';
import { SPECIES_LIST } from '../dist/lib/species.js';
import { RARITIES, EYES, HATS } from '../dist/lib/types.js';
import { validateSnapshot, WORLD_MOODS } from '../dist/lib/world/validate.js';

const API = (process.env.BUDDY_WORLD_API || 'https://buddy-world.fiorastudio-nj.workers.dev').replace(/\/$/, '');
const token = `e2e-smoke-${randomUUID()}`;

// A guaranteed-valid synthetic snapshot (built from the real enums + curve).
const snapshot = {
  name: 'e2e-smoketest',
  species: SPECIES_LIST[0],
  xp: 0,
  level: levelFromXp(0),
  mood: WORLD_MOODS.includes('content') ? 'content' : WORLD_MOODS[0],
  stats: { debugging: 10, patience: 10, chaos: 10, wisdom: 10, snark: 10 },
  rarity: RARITIES[0],
  shiny: false,
  hat: HATS[0],
  eye: EYES[0],
  avatar: 'chibi-1',
};

let passed = 0, failed = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); failed++; }
};
const post = (path, body) =>
  fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getWorld = async (district) => (await fetch(`${API}/v1/world/${district}`)).json();

async function main() {
  console.log(`Buddy World live smoke — ${API}\n`);

  // Pre-flight: the snapshot we send must itself be valid.
  const v = validateSnapshot(snapshot);
  ok('synthetic snapshot passes client validation', v.ok, v.ok ? '' : v.reason);
  if (!v.ok) return;

  // 1. Teleport
  const tRes = await post('/v1/teleport', { token, snapshot });
  const tBody = await tRes.json().catch(() => ({}));
  ok('teleport returns 200 with slug + district', tRes.status === 200 && !!tBody.slug && !!tBody.district,
    `status=${tRes.status} body=${JSON.stringify(tBody)}`);
  const { slug, district } = tBody;
  if (!slug || !district) { console.log('\n  aborting: no slug/district'); failed++; return report(); }

  // 2. Appears in the plaza (D1-backed world read)
  const w1 = await getWorld(district);
  ok('teleported buddy appears in /v1/world', Array.isArray(w1.citizens) && w1.citizens.some((c) => c.slug === slug));

  // 3. Fire ground-truth events
  const evRes = await post('/v1/events', {
    token,
    events: [{ type: 'commit', ts: Date.now() }, { type: 'deploy', ts: Date.now() }],
    snapshot,
  });
  ok('events accepted (200)', evRes.status === 200, `status=${evRes.status}`);

  // 4. Still present after event sync
  const w2 = await getWorld(district);
  ok('buddy still present after events', Array.isArray(w2.citizens) && w2.citizens.some((c) => c.slug === slug));

  // 5. Recall + purge (cleanup)
  const rRes = await post('/v1/recall', { token, purge: true });
  ok('recall --purge returns 200', rRes.status === 200, `status=${rRes.status}`);

  // 6. Gone after purge
  const w3 = await getWorld(district);
  ok('buddy removed from /v1/world after purge', Array.isArray(w3.citizens) && !w3.citizens.some((c) => c.slug === slug));

  report();
}

function report() {
  console.log(`\n${failed === 0 ? '✅ PASS' : '❌ FAIL'} — ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => { console.error('smoke crashed:', err); process.exit(1); });
