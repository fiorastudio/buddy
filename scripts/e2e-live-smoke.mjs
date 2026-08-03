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

// Safety: this mutates a live Worker + D1. The preview default is safe (a
// synthetic buddy that purges itself), but never touch a production world by
// accident — refuse known prod hosts unless explicitly allowed.
if (/buddy-mcp\.com/i.test(API) && process.env.BUDDY_WORLD_ALLOW_PROD !== '1') {
  console.error(`Refusing to run the live smoke against a production host (${API}).`);
  console.error('Point BUDDY_WORLD_API at a preview, or set BUDDY_WORLD_ALLOW_PROD=1 to override.');
  process.exit(2);
}

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

let teleported = false; // set once the synthetic citizen exists, for cleanup

async function main() {
  console.log(`Buddy World live smoke — ${API}\n`);

  // Pre-flight: the snapshot we send must itself be valid.
  const v = validateSnapshot(snapshot);
  ok('synthetic snapshot passes client validation', v.ok, v.ok ? '' : v.reason);
  if (!v.ok) return;

  try {
    // 1. Teleport
    const tRes = await post('/v1/teleport', { token, snapshot });
    const tBody = await tRes.json().catch(() => ({}));
    ok('teleport returns 200 with slug + district', tRes.status === 200 && !!tBody.slug && !!tBody.district,
      `status=${tRes.status} body=${JSON.stringify(tBody)}`);
    const { slug, district } = tBody;
    if (!slug || !district) { console.log('\n  aborting: no slug/district'); failed++; return; }
    teleported = true;

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

    // 5. Recall + purge (also verifies recall works)
    const rRes = await post('/v1/recall', { token, purge: true });
    const recalled = rRes.status === 200;
    ok('recall --purge returns 200', recalled, `status=${rRes.status}`);
    // Only mark clean if the purge actually happened — otherwise leave
    // `teleported` set so the finally block retries the cleanup.
    if (recalled) teleported = false;

    // 6. Gone after purge
    const w3 = await getWorld(district);
    ok('buddy removed from /v1/world after purge', Array.isArray(w3.citizens) && !w3.citizens.some((c) => c.slug === slug));
  } finally {
    // Safety net: if we teleported but never reached the clean recall (a
    // mid-test failure), best-effort purge so no synthetic citizen is left.
    if (teleported) {
      await post('/v1/recall', { token, purge: true }).catch(() => {});
      console.log('  (cleaned up synthetic citizen after an early exit)');
    }
  }
}

function report() {
  console.log(`\n${failed === 0 ? '✅ PASS' : '❌ FAIL'} — ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().then(report).catch((err) => { console.error('smoke crashed:', err); failed++; report(); });
