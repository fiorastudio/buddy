// Buddy World plaza renderer. Vanilla Canvas 2D — the citizens are ASCII
// sprites, so fillText IS the sprite engine. All animation is client-side
// and deterministic per (slug, utc-date) so every viewer sees a similar
// plaza without any server compute.
(() => {
  'use strict';

  const canvas = document.getElementById('plaza');
  // willReadFrequently keeps a CPU-readable backing store — steadier under
  // GPU-accelerated headless (where getImageData can otherwise read empty)
  // and fine for our draw pattern.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tickerEl = document.getElementById('ticker');
  const broadcastEl = document.getElementById('broadcast');
  const srListEl = document.getElementById('sr-citizens');

  const params = new URLSearchParams(location.search);
  const district = params.get('district') || 'plaza-1';
  const API_BASE = params.get('api') || '';

  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ACTIVE_WINDOW_MS = 15 * 60 * 1000;   // recently-active glow + energized walk
  const IDLE_SIT_MS = 3 * 60 * 60 * 1000;    // only long-AFK buddies sit (RO vendor vibe)
  const CELEBRATION_WINDOW_MS = 60 * 60 * 1000;
  const AVATARS = ['🧍', '🧍‍♀️', '🚶', '🧍', '🧑‍💻', '🚶‍♀️', '🧍', '🧙'];

  // Districts are RO towns. plaza-1 is always Prontera; the rest cycle
  // through the classics, each with its own sky/tile mood.
  const TOWNS = [
    { name: 'Prontera', sky: ['#2a2150', '#3a2f6b'], tiles: ['#5d5180', '#564a78'] },
    { name: 'Payon', sky: ['#3a2a1a', '#4d3a24'], tiles: ['#7a5c3a', '#6d5233'] },
    { name: 'Geffen', sky: ['#1a1040', '#2a1a5e'], tiles: ['#4a3a7e', '#413470'] },
    { name: 'Alberta', sky: ['#1a2a3a', '#24455e'], tiles: ['#4a6a7e', '#416070'] },
    { name: 'Morroc', sky: ['#3a241a', '#5e3a24'], tiles: ['#8a6a4a', '#7e6042'] },
    { name: 'Comodo', sky: ['#1a3a3a', '#245e50'], tiles: ['#4a8a6a', '#428060'] },
  ];
  function townFor(districtName) {
    let n = parseInt(String(districtName).replace(/\D/g, ''), 10);
    if (!Number.isFinite(n) || n < 1) n = 1; // crafted huge/NaN district → Prontera
    n = Math.min(n, 9999);
    return TOWNS[(n - 1) % TOWNS.length];
  }
  const TOWN = townFor(district);

  // Portal graph (M4). RO-style blue gates you WALK into to travel — the old
  // camera-only #warp button is retired. Hub-and-spoke with Prontera (plaza-1)
  // at the center. This MUST mirror src/lib/world/portals.ts by (id, from, to)
  // — drift-guarded by portals-drift.test.ts, exactly like TOWNS ↔ TOWN_NAMES.
  // rect = fractional [0,1] gate footprint on the floor (mapped to pixels via
  // RT.toPixel); spawn = fractional arrival point in the destination town.
  // Gates hug the courtyard perimeter (corners/edges) and are kept small so they
  // stay out of the central walking area — unobtrusive, RO-overworld-edge feel.
  const HUB_GATE_RECTS = [
    { x: 0.03, y: 0.05, w: 0.07, h: 0.08 }, // top-left    → Payon   (plaza-2)
    { x: 0.90, y: 0.05, w: 0.07, h: 0.08 }, // top-right   → Geffen  (plaza-3)
    { x: 0.02, y: 0.46, w: 0.07, h: 0.08 }, // mid-left    → Alberta (plaza-4)
    { x: 0.91, y: 0.46, w: 0.07, h: 0.08 }, // mid-right   → Morroc  (plaza-5)
    { x: 0.465, y: 0.90, w: 0.07, h: 0.08 }, // bottom-cent → Comodo  (plaza-6)
  ];
  const RETURN_GATE_RECT = { x: 0.465, y: 0.90, w: 0.07, h: 0.08 };
  const SATELLITE_SPAWN = { x: 0.5, y: 0.2 };
  const HUB_SPAWN = { x: 0.5, y: 0.5 };
  const PORTALS = [
    { id: 'prontera-payon', from: 'plaza-1', to: 'plaza-2', rect: HUB_GATE_RECTS[0], spawn: SATELLITE_SPAWN },
    { id: 'prontera-geffen', from: 'plaza-1', to: 'plaza-3', rect: HUB_GATE_RECTS[1], spawn: SATELLITE_SPAWN },
    { id: 'prontera-alberta', from: 'plaza-1', to: 'plaza-4', rect: HUB_GATE_RECTS[2], spawn: SATELLITE_SPAWN },
    { id: 'prontera-morroc', from: 'plaza-1', to: 'plaza-5', rect: HUB_GATE_RECTS[3], spawn: SATELLITE_SPAWN },
    { id: 'prontera-comodo', from: 'plaza-1', to: 'plaza-6', rect: HUB_GATE_RECTS[4], spawn: SATELLITE_SPAWN },
    { id: 'payon-prontera', from: 'plaza-2', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
    { id: 'geffen-prontera', from: 'plaza-3', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
    { id: 'alberta-prontera', from: 'plaza-4', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
    { id: 'morroc-prontera', from: 'plaza-5', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
    { id: 'comodo-prontera', from: 'plaza-6', to: 'plaza-1', rect: RETURN_GATE_RECT, spawn: HUB_SPAWN },
  ];
  const portalsHere = PORTALS.filter((p) => p.from === district);

  // RO emote bubbles: recent activity pops the classic overhead marks.
  const EVENT_EMOTES = {
    commit: '!', deploy: '!!', bug_fix: '?!', tests_passed: '♪', streak_7: '★',
    observe: '!', session: '♥',
  };
  const BUBBLE_TTL_MS = 90_000;

  // Client-side mirror of XP_REWARDS for the floating damage numbers.
  const XP_VALUES = { observe: 8, session: 5, commit: 25, tests_passed: 20, bug_fix: 35, deploy: 60, level_up: 0, streak_7: 0 };

  // RO job class from peak stat + level (JOB_LINES loaded from jobs.json,
  // generated from src/lib/jobclass.ts — drift-guarded).
  const STAT_KEYS = ['debugging', 'patience', 'chaos', 'wisdom', 'snark'];
  const STAT_UP = { debugging: 'DEBUGGING', patience: 'PATIENCE', chaos: 'CHAOS', wisdom: 'WISDOM', snark: 'SNARK' };
  function jobTier(level) { return level >= 45 ? 3 : level >= 25 ? 2 : level >= 10 ? 1 : 0; }
  // Kept but no longer rendered on the nameplate (superseded by the country
  // flag). Still exercised by test instrumentation + ready to revive.
  function jobLabel(c) {
    if (!state.jobLines) return `Lv.${c.level}`;
    const stats = c.stats || {};
    let peak = 'debugging', val = -1;
    for (const k of STAT_KEYS) if ((stats[k] ?? 0) > val) { val = stats[k]; peak = k; }
    const line = state.jobLines[STAT_UP[peak]] || state.jobLines.DEBUGGING;
    return `${line[jobTier(c.level)]} · Lv.${c.level}`;
  }

  // ISO 3166-1 alpha-2 → flag emoji via regional-indicator codepoints.
  // Returns '' for anything that isn't two ASCII letters (missing/unknown).
  function flagEmoji(cc) {
    if (typeof cc !== 'string' || !/^[A-Za-z]{2}$/.test(cc)) return '';
    const A = 0x1f1e6, base = 65; // 'A'
    const up = cc.toUpperCase();
    return String.fromCodePoint(A + up.charCodeAt(0) - base, A + up.charCodeAt(1) - base);
  }
  // The nameplate's second line: country flag (if known) + level. The flag is
  // hidden in anon mode (server already nulls country for anon, belt-and-braces
  // here too). Job class is retired to jobLabel() above, dormant.
  function nameplateSub(c) {
    const flag = !c.anon && c.country ? flagEmoji(c.country) : '';
    return `${flag ? flag + ' ' : ''}Lv.${c.level}`;
  }

  const SPRITE_FONT = '13px Menlo, Consolas, monospace';
  const SPRITE_LINE_H = 13;

  // ── deterministic rng ──────────────────────────────────────────────────
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── world state ────────────────────────────────────────────────────────
  const state = {
    citizens: [], events: [], celebrations: [], tickerLines: [],
    announcements: [], broadcast: null, // global celebration feed + current RO banner
    sprites: null, palettes: null, spriteColors: {}, reducedMotion: REDUCED_MOTION,
    actorFrames: {}, spriteBottoms: {},
    porings: [], stalls: [], bubbles: {}, xpPopups: [], sittingCount: 0,
    sfxEnabled: false, spawnXpPopup: null, petBuddy: null, // bound below
  };
  // Test instrumentation: resolve the rendered nameplate job label by slug.
  // (Assigned after `state` exists — jobLabel is hoisted so it's safe here.)
  state.jobLabelForSlug = (slug) => {
    const c = state.citizens.find((x) => x.slug === slug);
    return c ? jobLabel(c) : null;
  };
  // Test instrumentation: the flag emoji rendered on a slug's nameplate ('' if
  // none / anon). Mirrors nameplateSub's flag logic.
  state.flagForSlug = (slug) => {
    const c = state.citizens.find((x) => x.slug === slug);
    return c && !c.anon && c.country ? flagEmoji(c.country) : '';
  };
  // Test instrumentation: force one global celebration onto the RO-yellow
  // broadcast banner (bypassing the poll/seen gate) and report what rendered —
  // the rendered text, whether it scrolls or holds static (reduced-motion), and
  // visibility. Mirrors the jobLabelForSlug/flagForSlug test hooks above.
  state.broadcastForTest = (announcement) => {
    showBroadcast(announcement);
    return {
      text: broadcastEl.textContent,
      visible: !broadcastEl.hidden,
      scrolling: broadcastEl.classList.contains('scroll'),
      staticHold: broadcastEl.classList.contains('static'),
      type: broadcastEl.getAttribute('data-type'),
    };
  };
  // Test instrumentation: drive the REAL poll-ingest path (seen-set de-dupe,
  // first-load seeding, oldest-first enqueue, and the sequential timer queue)
  // that broadcastForTest bypasses. Reports what's on screen vs. still queued.
  state.ingestAnnouncementsForTest = (list) => {
    ingestAnnouncements(list);
    return {
      broadcastType: state.broadcast ? state.broadcast.type : null,
      queued: broadcastQueue.length,
      visible: !broadcastEl.hidden,
      text: broadcastEl.textContent,
    };
  };
  const actors = new Map(); // slug -> {x, y, tx, ty, rng, frame, behavior}
  const metricsBySpecies = new Map(); // species -> {cols, rows} max across ALL frames
  let charW = 8; // measured once per font in tick()

  function lerp(a, b, t) { return a + (b - a) * t; }

  // ── WCAG AA contrast ───────────────────────────────────────────────────
  function channelLum(c) {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  function relLuminance([r, g, b]) {
    return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
  }
  function contrastRatio(fg, bg) {
    const l1 = relLuminance(fg);
    const l2 = relLuminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  // Pavement contrast baselines — must track the ACTUAL floor per lighting
  // (day = light flagstone, night = dark slate), or night sprites go
  // invisible. Chosen at draw time via activeTileBg().
  const DAY_TILE_BG = [207, 196, 168];  // #cfc4a8 bright flagstone
  const NIGHT_TILE_BG = [59, 53, 80];   // #3b3550
  const AA_RATIO = 4.5;
  function activeTileBg() { return isNight() ? NIGHT_TILE_BG : DAY_TILE_BG; }

  // Push a color toward whichever of black/white gives more contrast with
  // the current pavement, until it clears WCAG AA. Bidirectional so both a
  // light day floor and a dark night floor keep sprites readable.
  function ensureContrast(rgb) {
    const bg = activeTileBg();
    const target = relLuminance(bg) > 0.35 ? 0 : 255; // dark text on light stone, light on dark
    let out = rgb.slice();
    for (let step = 0; step < 24 && contrastRatio(out, bg) < AA_RATIO; step++) {
      out = out.map((c) => Math.round(c + (target - c) * 0.13));
    }
    return out;
  }

  function speciesColor(species, level) {
    const pal = (state.palettes && state.palettes[species]) || [[180, 160, 255], [180, 160, 255], [180, 160, 255], [180, 160, 255]];
    const t = Math.min(1, Math.max(0, (level - 1) / 49)) * (pal.length - 1);
    const i = Math.min(pal.length - 2, Math.floor(t));
    const f = t - i;
    return ensureContrast([0, 1, 2].map((c) => Math.round(lerp(pal[i][c], pal[i + 1][c], f))));
  }

  // Stable per-species sprite box: max cols/rows across ALL frames, so a
  // frame that renders narrower/wider (looking at you, Penguin) cannot
  // shift the centering anchor and make the sprite jitter.
  function spriteMetrics(species) {
    if (metricsBySpecies.has(species)) return metricsBySpecies.get(species);
    const frames = (state.sprites && state.sprites[species]) || [['(?)']];
    let cols = 1, rows = 1;
    for (const frame of frames) {
      rows = Math.max(rows, frame.length);
      for (const line of frame) cols = Math.max(cols, line.replaceAll('{E}', '·').replace(/\s+$/, '').length);
    }
    const m = { cols, rows };
    metricsBySpecies.set(species, m);
    return m;
  }

  const BEHAVIORS = {
    chaos: { emote: '💥', speed: 2.2 },
    wisdom: { emote: '📖', speed: 0.5 },
    snark: { emote: '🙄', speed: 0.9 },
    patience: { emote: '🎣', speed: 0.4 },
    debugging: { emote: '🔍', speed: 1.1 },
  };
  function dominantStat(stats) {
    let best = 'debugging';
    for (const k of Object.keys(BEHAVIORS)) if ((stats[k] || 0) > (stats[best] || 0)) best = k;
    return best;
  }

  // ── layout ─────────────────────────────────────────────────────────────
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // The walkable courtyard grows with population — a busier town is a
  // bigger town (up to the viewport). Below the building line at the top.
  function plazaBounds() {
    const pop = state.citizens.length || 6;
    // Near-fill the viewport so the courtyard edge ≈ the screen edge — this is
    // what lets the perimeter portal gates actually sit AT the edges (not adrift
    // in a small central band) while sprites can still walk out to them.
    const grow = Math.min(1, 0.95 + pop / 50);
    const skyline = Math.min(180, canvas.height * 0.24); // building band up top
    return {
      cx: canvas.width / 2,
      cy: skyline + (canvas.height - skyline) / 2 + 10,
      rx: Math.min(canvas.width * 0.46 * grow, canvas.width * 0.46),
      ry: Math.min((canvas.height - skyline) * 0.40 * grow, (canvas.height - skyline) * 0.42),
      skyline,
    };
  }

  function ensureActor(c) {
    if (actors.has(c.slug)) return actors.get(c.slug);
    const utcDate = new Date().toISOString().slice(0, 10);
    const rng = mulberry32(hashStr(c.slug + utcDate));
    const b = plazaBounds();
    const angle = rng() * Math.PI * 2;
    const r = 0.35 + rng() * 0.6;
    const actor = {
      x: b.cx + Math.cos(angle) * b.rx * r,
      y: b.cy + Math.sin(angle) * b.ry * r,
      tx: 0, ty: 0, rng,
      frame: Math.floor(rng() * 4),
      phaseMs: rng() * 1800, // desync frame flips between citizens
      behavior: dominantStat(c.stats || {}),
      emoteAt: rng() * 8000,
    };
    pickWaypoint(actor);
    actors.set(c.slug, actor);
    return actor;
  }

  function pickWaypoint(actor) {
    const b = plazaBounds();
    const angle = actor.rng() * Math.PI * 2;
    const r = 0.3 + actor.rng() * 0.65;
    actor.tx = b.cx + Math.cos(angle) * b.rx * r;
    actor.ty = b.cy + Math.sin(angle) * b.ry * r;
  }

  // ── environment (pre-rendered offscreen, blitted each frame) ──────────
  // A walled RO town square: cobblestone pavement filling the view,
  // half-timbered buildings + market awnings framing the top, hanging
  // banners, greenery, a fountain. Static → render once per (size, town,
  // day/night, population-bucket) and cache; tick() just blits it.
  let envBuf = null, envSig = '';

  // Bright RO daytime is the default look. Night is opt-in via ?time=night
  // (or late clock hours only if ?time=auto is set), so visitors land in
  // sunny Prontera, matching the reference art.
  const TIME_OVERRIDE = params.get('time');
  function isNight() {
    if (TIME_OVERRIDE === 'day') return false;
    if (TIME_OVERRIDE === 'night') return true;
    if (TIME_OVERRIDE === 'auto') { const h = new Date().getHours(); return h < 6 || h >= 20; }
    return false; // default: bright daytime
  }

  function buildEnvironment() {
    const night = isNight();
    const popBucket = Math.floor((state.citizens.length || 6) / 8);
    const sig = `${canvas.width}x${canvas.height}|${TOWN.name}|${night}|${popBucket}`;
    if (sig === envSig && envBuf) return;
    envSig = sig;
    envBuf = document.createElement('canvas');
    envBuf.width = canvas.width;
    envBuf.height = canvas.height;
    const g = envBuf.getContext('2d');
    const b = plazaBounds();

    // backdrop sky — bright RO blue by day (with a soft sun), dark at night.
    const sky = g.createLinearGradient(0, 0, 0, b.skyline + 60);
    if (night) { sky.addColorStop(0, '#0b0820'); sky.addColorStop(1, '#141030'); }
    else { sky.addColorStop(0, '#8fc9ec'); sky.addColorStop(1, '#d6ecf7'); }
    g.fillStyle = sky;
    g.fillRect(0, 0, canvas.width, b.skyline + 60);
    if (!night) {
      // soft sun glow + a couple of clouds
      const sun = g.createRadialGradient(canvas.width * 0.8, 30, 4, canvas.width * 0.8, 30, 60);
      sun.addColorStop(0, 'rgba(255,250,220,0.9)'); sun.addColorStop(1, 'rgba(255,250,220,0)');
      g.fillStyle = sun; g.beginPath(); g.arc(canvas.width * 0.8, 30, 60, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (const [cx, cy, r] of [[canvas.width * 0.2, 26, 16], [canvas.width * 0.28, 30, 20], [canvas.width * 0.5, 20, 14]]) {
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      }
    }

    drawPavement(g, b, night);
    drawBuildings(g, b, night);
    drawCastle(g, b, night);
    drawSignposts(g, b, night);
    drawGreenery(g, b, night);
    drawBanners(g, b, night);
    drawFountain(g, b);
    drawStreetLamps(g, b, night);
  }

  // Grand central building — the Prontera-castle silhouette at the back.
  function drawCastle(g, b, night) {
    const cx = b.cx, base = b.skyline - 6, w = 150, h = 96;
    const wall = night ? '#413a5e' : '#f2ead4';
    const roof = night ? '#2a2140' : '#2f8f8a';
    const cxs = [cx - w / 2, cx + w / 2 - 26]; // two side towers
    // main keep
    g.fillStyle = wall; g.fillRect(cx - w / 2, base - h, w, h);
    // crenellations
    g.fillStyle = night ? '#2a2444' : '#e0d6ba';
    for (let x = cx - w / 2; x < cx + w / 2; x += 16) g.fillRect(x, base - h - 6, 9, 8);
    // big central roof + spire
    g.fillStyle = roof;
    g.beginPath(); g.moveTo(cx - 34, base - h + 4); g.lineTo(cx, base - h - 44); g.lineTo(cx + 34, base - h + 4); g.closePath(); g.fill();
    g.strokeStyle = night ? '#5a4a2a' : '#8a6a3a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, base - h - 44); g.lineTo(cx, base - h - 60); g.stroke();
    g.fillStyle = '#b23a48'; // pennant
    g.beginPath(); g.moveTo(cx, base - h - 60); g.lineTo(cx + 16, base - h - 55); g.lineTo(cx, base - h - 50); g.closePath(); g.fill();
    // side towers with conical roofs
    for (const tx of cxs) {
      g.fillStyle = wall; g.fillRect(tx, base - h - 14, 26, h + 14);
      g.fillStyle = roof;
      g.beginPath(); g.moveTo(tx - 4, base - h - 12); g.lineTo(tx + 13, base - h - 40); g.lineTo(tx + 30, base - h - 12); g.closePath(); g.fill();
    }
    // arched gate + windows
    g.fillStyle = night ? '#ffd27a' : '#6a86a8';
    g.beginPath();
    g.moveTo(cx - 12, base); g.lineTo(cx - 12, base - 26); g.arc(cx, base - 26, 12, Math.PI, 0); g.lineTo(cx + 12, base); g.closePath(); g.fill();
  }

  // RO NPC shop signposts around the square.
  function drawSignposts(g, b, night) {
    const signs = [
      [b.cx - b.rx * 0.85, b.skyline + 54, 'Tool Shop', '#c98a3a'],
      [b.cx + b.rx * 0.8, b.skyline + 48, 'Weapons', '#b8563f'],
      [b.cx - b.rx * 0.35, b.skyline + 70, 'Inn', '#2f8f8a'],
    ];
    for (const [sx, sy, label, color] of signs) {
      g.strokeStyle = night ? '#3a2a1a' : '#6b4a2a'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy + 30); g.stroke();
      g.fillStyle = night ? shadeColor(color, 0.5) : color;
      const w = label.length * 6 + 10;
      roundRectPath(g, sx - w / 2, sy - 4, w, 15, 3); g.fill();
      g.fillStyle = '#fff8 e6'.replace(' ', ''); g.fillStyle = '#fff8e6';
      g.font = 'bold 9px Menlo, Consolas, monospace'; g.textAlign = 'center';
      g.fillText(label, sx, sy + 7);
    }
  }

  // RO street lamps ringing the square — warm glow at night.
  function drawStreetLamps(g, b, night) {
    const spots = [
      [b.cx - b.rx * 0.7, b.cy - b.ry * 0.5], [b.cx + b.rx * 0.7, b.cy - b.ry * 0.5],
      [b.cx - b.rx * 0.7, b.cy + b.ry * 0.6], [b.cx + b.rx * 0.7, b.cy + b.ry * 0.6],
    ];
    for (const [lx, ly] of spots) {
      g.strokeStyle = night ? '#4a4030' : '#5a4a3a';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx, ly + 44); g.stroke();
      if (night) {
        const glow = g.createRadialGradient(lx, ly, 2, lx, ly, 34);
        glow.addColorStop(0, 'rgba(255,214,120,0.85)');
        glow.addColorStop(1, 'rgba(255,214,120,0)');
        g.fillStyle = glow;
        g.beginPath(); g.arc(lx, ly, 34, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = night ? '#ffe082' : '#c9b98a';
      g.beginPath(); g.arc(lx, ly, 5, 0, Math.PI * 2); g.fill();
    }
  }

  // Cobblestone floor drawn in 3/4 PERSPECTIVE so it reads as receding
  // GROUND (RO tilted top-down), not a flat wall. Tiles shrink toward the
  // horizon at the building line; the row cadence tightens as it recedes.
  function drawPavement(g, b, night) {
    const top = b.skyline;          // horizon: floor meets the buildings
    const floorH = canvas.height - top;
    const base = night ? '#3b3550' : '#cfc4a8';
    // a slight gradient: cooler/darker near the horizon, warmer near camera
    const grad = g.createLinearGradient(0, top, 0, canvas.height);
    grad.addColorStop(0, shadeColor(base, night ? 0.78 : 0.86));
    grad.addColorStop(1, shadeColor(base, night ? 1.0 : 1.08));
    g.fillStyle = grad;
    g.fillRect(0, top, canvas.width, floorH);

    // Isometric DIAMOND flagstones (top-down tilted squares) — the RO
    // ground look. Diamonds tile edge-to-edge; rows advance by half-height
    // and alternate a half-width stagger. Perspective: diamonds shrink
    // toward the horizon so the plane recedes.
    const BASE_TW = 46, BASE_TH = 24; // finer flagstones
    const grout = night ? 'rgba(0,0,0,0.32)' : 'rgba(92,70,44,0.28)';
    let y = top + 4;
    let row = 0;
    while (y < canvas.height + 30) {
      const f = (y - top) / floorH;
      const scale = 0.4 + f * 1.05;
      const tw = BASE_TW * scale, th = BASE_TH * scale;
      const offset = row % 2 ? tw / 2 : 0;
      for (let cx = -tw + offset; cx < canvas.width + tw; cx += tw) {
        const seed = hashStr(`${row}:${Math.round(cx)}:${TOWN.name}`) / 4294967296;
        const shade = 0.84 + seed * 0.26;
        g.fillStyle = shadeColor(base, shade);
        g.beginPath();
        g.moveTo(cx, y - th / 2);
        g.lineTo(cx + tw / 2, y);
        g.lineTo(cx, y + th / 2);
        g.lineTo(cx - tw / 2, y);
        g.closePath();
        g.fill();
        g.strokeStyle = grout; g.lineWidth = 1; g.stroke();
        // top-facet highlight sells the tilt
        g.strokeStyle = night ? 'rgba(255,255,255,0.05)' : 'rgba(255,250,235,0.35)';
        g.beginPath(); g.moveTo(cx - tw / 2, y); g.lineTo(cx, y - th / 2); g.lineTo(cx + tw / 2, y); g.stroke();
      }
      y += th / 2;
      row++;
    }
    // soft shading at the far edge so the horizon reads as depth, not a cut
    const haze = g.createLinearGradient(0, top, 0, top + 60);
    haze.addColorStop(0, night ? 'rgba(20,16,40,0.5)' : 'rgba(120,110,90,0.35)');
    haze.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = haze;
    g.fillRect(0, top, canvas.width, 60);
  }

  // Prontera skyline: varied buildings with the iconic RO steep roofs in
  // teal / terracotta / slate, cream walls, tidy shuttered windows.
  const ROOF_DAY = ['#2f8f8a', '#b8563f', '#5f6f96', '#c98a3a']; // teal, terracotta, slate, ochre
  function drawBuildings(g, b, night) {
    const y0 = b.skyline;
    const wall = night ? '#3a3352' : '#efe6cf';
    const wallShade = night ? '#312a48' : '#ddceac';
    let x = -24;
    let i = 0;
    while (x < canvas.width + 24) {
      const seed = hashStr('bld' + i + TOWN.name);
      const bw = 84 + (seed % 60);
      const bh = 54 + ((seed >> 3) % 66);
      const bx = x, by = y0 - bh;
      const roof = night ? '#2a2140' : ROOF_DAY[(seed >> 5) % ROOF_DAY.length];

      // wall (with a subtle right-side shade for depth)
      g.fillStyle = wall; g.fillRect(bx, by + 10, bw, bh);
      g.fillStyle = wallShade; g.fillRect(bx + bw - 10, by + 10, 10, bh);

      // steep RO roof with an eave overhang + a lighter ridge highlight
      g.fillStyle = roof;
      g.beginPath();
      g.moveTo(bx - 6, by + 16); g.lineTo(bx + bw / 2, by - 20);
      g.lineTo(bx + bw + 6, by + 16); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(bx + bw / 2, by - 20); g.lineTo(bx + bw + 6, by + 16); g.stroke();
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(bx - 6, by + 14, bw + 12, 4); // eave line

      // occasional spire (Prontera towers)
      if ((seed >> 7) % 3 === 0) {
        g.fillStyle = roof;
        g.beginPath();
        g.moveTo(bx + bw / 2 - 6, by - 18); g.lineTo(bx + bw / 2, by - 40);
        g.lineTo(bx + bw / 2 + 6, by - 18); g.closePath(); g.fill();
      }

      // tidy shuttered windows in a row
      const winY = by + 22, winW = 11, winH = 15, cols = Math.max(2, Math.floor(bw / 34));
      for (let c = 0; c < cols; c++) {
        const wx = bx + 12 + c * ((bw - 24) / Math.max(1, cols - 1)) - winW / 2;
        g.fillStyle = night ? '#ffd27a' : '#7fa8c4';
        g.fillRect(wx, winY, winW, winH);
        g.strokeStyle = night ? '#7a5a2a' : '#8a6a44'; g.lineWidth = 1.5;
        g.strokeRect(wx, winY, winW, winH);
        g.beginPath(); g.moveTo(wx + winW / 2, winY); g.lineTo(wx + winW / 2, winY + winH); g.stroke();
      }
      // a door
      g.fillStyle = night ? '#241d38' : '#8a6a44';
      g.fillRect(bx + bw / 2 - 7, by + bh - 16, 14, 16);

      x += bw + 8;
      i++;
    }
    // striped market awnings jutting into the square (RO vending stalls)
    drawAwning(g, 40, y0 + 34, night ? '#4a3a6a' : '#4f9bd6');
    drawAwning(g, canvas.width - 150, y0 + 34, night ? '#5a3a4a' : '#d06a8a');
    drawAwning(g, canvas.width / 2 - 46, y0 + 20, night ? '#3a4a5a' : '#e0a83a');
  }

  function drawAwning(g, x, y, color) {
    const w = 92, h = 16;
    g.fillStyle = '#6b4a2a';
    g.fillRect(x + 6, y + h, w - 12, 26); // stall counter
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y + h); g.lineTo(x, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h);
    g.closePath(); g.fill();
    // scalloped stripe edge
    g.fillStyle = '#f5f0e6';
    for (let s = 0; s < w; s += 16) {
      g.beginPath();
      g.moveTo(x + s, y + h); g.lineTo(x + s + 8, y + h);
      g.lineTo(x + s + 4, y + h + 7); g.closePath(); g.fill();
    }
  }

  function drawGreenery(g, b, night) {
    const green = night ? '#1e3a24' : '#4e8f4a';
    const beds = [[30, canvas.height - 70], [canvas.width - 80, canvas.height - 60], [b.cx - 200, b.skyline + 24]];
    for (const [gx, gy] of beds) {
      g.fillStyle = green;
      roundRectPath(g, gx, gy, 54, 26, 8); g.fill();
      // little flowers
      for (let f = 0; f < 5; f++) {
        const fx = gx + 8 + (hashStr('fx' + f + gx) % 40);
        const fy = gy + 6 + (hashStr('fy' + f + gy) % 14);
        g.fillStyle = ['#ffd54f', '#ff8fa3', '#e1bee7'][f % 3];
        g.beginPath(); g.arc(fx, fy, 2.5, 0, Math.PI * 2); g.fill();
      }
    }
    // RO-style leafy trees around the square edges
    const trees = [[70, b.skyline + 70], [canvas.width - 70, b.skyline + 60],
      [110, canvas.height - 90], [canvas.width - 120, canvas.height - 80]];
    for (const [tx, ty] of trees) drawTree(g, tx, ty, night);
  }

  function drawTree(g, x, y, night) {
    // trunk
    g.fillStyle = night ? '#3a2a1a' : '#7a5230';
    g.fillRect(x - 4, y, 8, 22);
    // layered canopy blobs
    const canopy = night ? ['#1e3a24', '#254a2c'] : ['#4e8f4a', '#5fa858'];
    for (const [dx, dy, r, ci] of [[-10, -6, 15, 0], [10, -6, 15, 0], [0, -16, 18, 1], [0, -2, 16, 1]]) {
      g.fillStyle = canopy[ci];
      g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill();
    }
    // highlight
    g.fillStyle = night ? 'rgba(120,180,120,0.15)' : 'rgba(255,255,255,0.2)';
    g.beginPath(); g.arc(x - 4, y - 20, 7, 0, Math.PI * 2); g.fill();
  }

  function drawBanners(g, b, night) {
    const spots = [b.cx - b.rx * 0.6, b.cx + b.rx * 0.6];
    for (const bx of spots) {
      const by = b.skyline + 20;
      g.strokeStyle = night ? '#5a4a2a' : '#8a6a3a';
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx, by + 90); g.stroke();
      // triangular hanging banner (RO guild banner)
      g.fillStyle = night ? '#3a2a5a' : '#b23a48';
      g.beginPath();
      g.moveTo(bx, by + 6); g.lineTo(bx + 30, by + 6);
      g.lineTo(bx + 30, by + 44); g.lineTo(bx + 15, by + 56);
      g.lineTo(bx, by + 44); g.closePath(); g.fill();
      g.fillStyle = '#ffd700';
      g.font = 'bold 13px serif'; g.textAlign = 'center';
      g.fillText('⚜', bx + 15, by + 32);
    }
  }

  function drawFountain(g, b) {
    g.save();
    g.translate(b.cx, b.cy);
    g.fillStyle = 'rgba(0,0,0,0.2)';
    g.beginPath(); g.ellipse(0, 8, 40, 14, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8a9db0';
    g.beginPath(); g.ellipse(0, 4, 38, 13, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#bcd9f0';
    g.beginPath(); g.ellipse(0, 2, 30, 10, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9aa8c0';
    g.fillRect(-5, -22, 10, 24);
    g.font = '18px serif'; g.textAlign = 'center'; g.fillStyle = '#dff0ff';
    g.fillText('⛲', 0, -6);
    g.restore();
  }

  // ── small color + path helpers ────────────────────────────────────────
  function roundRectPath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function shadeColor(hex, mul) {
    const [r, gg, bb] = hexToRgb(hex);
    return `rgb(${Math.min(255, r * mul | 0)},${Math.min(255, gg * mul | 0)},${Math.min(255, bb * mul | 0)})`;
  }
  function hexMix(a, bHex, t) {
    const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(bHex);
    const m = (x, y) => Math.round(x + (y - x) * t);
    return `#${((1 << 24) + (m(r1, r2) << 16) + (m(g1, g2) << 8) + m(b1, b2)).toString(16).slice(1)}`;
  }

  function drawGround() {
    buildEnvironment();
    if (envBuf) ctx.drawImage(envBuf, 0, 0);
  }

  function drawCitizen(c, actor, now) {
    const spriteFrames = (state.sprites && state.sprites[c.species]) || [['(?)']];
    const frames = spriteFrames.length;
    const lines = spriteFrames[actor.frame % frames].map((l) => l.replaceAll('{E}', c.eye || '·'));
    const [r, g, b2] = speciesColor(c.species, c.level);
    state.spriteColors[c.slug] = contrastRatio([r, g, b2], activeTileBg());
    const active = now - c.last_seen_at < ACTIVE_WINDOW_MS;
    const m = spriteMetrics(c.species);
    const w = m.cols * charW;
    const h = m.rows * SPRITE_LINE_H;

    // soft ground shadow anchors the sprite to the plaza. Sit halfway between
    // the sprite's bottom line (actor.y - SPRITE_LINE_H) and the old drop
    // (actor.y + 4) so the gap under the feet is ~50% smaller.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(actor.x, actor.y - 4.5, w * 0.38, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Peco Peco mount — transcendent (L45+) buddies ride the RO bird.
    if (c.level >= 45) {
      ctx.save();
      ctx.font = '15px serif';
      ctx.textAlign = 'center';
      ctx.fillText('🐤', actor.x, actor.y + 2);
      ctx.restore();
    }

    ctx.save();
    ctx.font = SPRITE_FONT;
    ctx.textAlign = 'left';
    // dark halo behind glyphs for separation from the checkered tiles
    ctx.shadowColor = active ? `rgb(${r},${g},${b2})` : 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = active ? 14 : 3;
    ctx.fillStyle = `rgb(${r},${g},${b2})`;
    // Horizontal: center on the stable per-species box (immune to frames
    // that render narrower). Vertical: bottom-anchor THIS frame's lines so
    // variable line counts can never bob the sprite. Sitting buddies drop a
    // few px (RO seated posture) and get a little cushion.
    const sitDrop = actor.sitting ? 6 : 0;
    let lastLineY = actor.y;
    lines.forEach((line, i) => {
      const y = actor.y + (i - lines.length) * SPRITE_LINE_H + sitDrop;
      ctx.fillText(line, actor.x - w / 2, y);
      lastLineY = y;
    });
    ctx.restore();
    if (actor.sitting) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(actor.x, actor.y + sitDrop + 2, w * 0.3, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // test instrumentation: bottom row must sit at a constant offset.
    // Exclude the intentional seated drop (sitDrop) — that's a deliberate
    // posture change, not the variable-line-count jitter this guards against.
    const bottomOffset = Math.round(lastLineY - actor.y - sitDrop);
    const rec = state.spriteBottoms[c.slug] || { min: bottomOffset, max: bottomOffset };
    rec.min = Math.min(rec.min, bottomOffset);
    rec.max = Math.max(rec.max, bottomOffset);
    state.spriteBottoms[c.slug] = rec;

    // owner avatar walks beside the buddy
    ctx.font = '15px serif';
    ctx.textAlign = 'center';
    const avatarIdx = (parseInt(String(c.avatar || 'chibi-1').replace(/\D/g, ''), 10) || 1) - 1;
    ctx.fillText(AVATARS[avatarIdx % AVATARS.length], actor.x + w / 2 + 12, actor.y - 4);

    // name tag, RO style: white with dark outline. Second line shows the
    // owner's country flag (from the teleport origin) + level.
    const label = `${c.name}${c.shiny ? ' ✨' : ''}${flameSlugs.has(c.slug) ? ' 🔥' : ''}`;
    const sub = nameplateSub(c);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.font = 'bold 11px Menlo, Consolas, monospace';
    ctx.strokeText(label, actor.x, actor.y + 15);
    ctx.fillStyle = active ? '#ffffff' : '#cfcbe2';
    ctx.fillText(label, actor.x, actor.y + 15);
    ctx.font = '10px Menlo, Consolas, monospace';
    ctx.strokeText(sub, actor.x, actor.y + 26);
    ctx.fillStyle = active ? '#ffe082' : '#b0a4c8';
    ctx.fillText(sub, actor.x, actor.y + 26);

    // occasional behavior emote (static under reduced motion)
    const emoteVisible = REDUCED_MOTION || (performance.now() + actor.emoteAt) % 9000 < 1400;
    if (emoteVisible && !REDUCED_MOTION) {
      ctx.font = '12px serif';
      ctx.fillText(BEHAVIORS[actor.behavior].emote, actor.x, actor.y - h - 16);
    }

    // RO overhead chat bubble for recent activity
    const bubble = state.bubbles[c.slug];
    if (bubble) {
      drawChatBubble(actor.x, actor.y - h - 30, bubble.emote);
    }
  }

  // RO-style rounded speech bubble with a little tail.
  function drawChatBubble(cx, cy, text) {
    ctx.font = 'bold 13px Menlo, Consolas, monospace';
    const w = Math.max(22, ctx.measureText(text).width + 14);
    const hh = 20;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeStyle = 'rgba(40,30,70,0.9)';
    ctx.lineWidth = 1.5;
    roundRect(cx - w / 2, cy - hh, w, hh, 6);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath(); // tail
    ctx.moveTo(cx - 4, cy);
    ctx.lineTo(cx + 4, cy);
    ctx.lineTo(cx, cy + 6);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.fill();
    ctx.fillStyle = '#2a1e46';
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, cy - 6);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Data-driven celebration rendering: a new event type is one line here.
  // level_up keeps its bespoke branch (gold text + glow + bob) — the one
  // genuine outlier.
  const CELEBRATION_SPEC = {
    deploy: { frames: ['🎆', '🎇', '✨'], font: '15px serif', dx: 18, dy: -66 },
    commit: { frames: ['✨'], font: '12px serif', dx: -16, dy: -60 },
    streak_7: { frames: ['🎊'], font: '14px serif', dx: 0, dy: -66 },
    tests_passed: { frames: ['✅'], font: '13px serif', dx: -18, dy: -62 },
  };

  function drawCelebrations(now) {
    for (const cel of state.celebrations) {
      const actor = actors.get(cel.citizen_slug);
      if (!actor) continue;
      ctx.textAlign = 'center';
      if (cel.type === 'level_up') {
        const age = (now - cel.ts) / 1000;
        // RO golden light pillar shooting up from the buddy
        const pillarAge = Math.min(1, age / 1.2);
        const pw = 26 * (1 - pillarAge * 0.3);
        const pgrad = ctx.createLinearGradient(actor.x, actor.y, actor.x, actor.y - 130);
        pgrad.addColorStop(0, `rgba(255,224,120,${0.55 * (1 - pillarAge)})`);
        pgrad.addColorStop(1, 'rgba(255,224,120,0)');
        ctx.fillStyle = pgrad;
        ctx.fillRect(actor.x - pw / 2, actor.y - 130, pw, 130);
        // rising sparkles
        if (!REDUCED_MOTION) {
          ctx.fillStyle = '#fff6c8';
          for (let s = 0; s < 4; s++) {
            const sp = (age * 0.6 + s * 0.25) % 1;
            ctx.globalAlpha = 1 - sp;
            ctx.beginPath();
            ctx.arc(actor.x + Math.sin(sp * 10 + s) * 10, actor.y - sp * 110, 2, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        ctx.font = 'bold 13px Menlo, Consolas, monospace';
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ff8c00';
        ctx.shadowBlur = 10;
        const bob = REDUCED_MOTION ? 0 : (age % 3) * 4;
        ctx.fillText('✧ LEVEL UP! ✧', actor.x, actor.y - 74 - bob);
        ctx.font = '16px serif';
        ctx.fillText('🪽', actor.x, actor.y - 56);
        ctx.shadowBlur = 0;
        continue;
      }
      const spec = CELEBRATION_SPEC[cel.type];
      if (!spec) continue;
      ctx.font = spec.font;
      const frame = REDUCED_MOTION ? 0 : Math.floor(performance.now() / 400) % spec.frames.length;
      ctx.fillText(spec.frames[frame], actor.x + spec.dx, actor.y + spec.dy);
    }
  }

  // Streak flames (🔥 by the name tag): recomputed once per frame for all
  // citizens — O(events), not O(citizens × events) inside drawCitizen.
  let flameSlugs = new Set();
  function computeFlameSlugs(now) {
    return new Set(
      state.events
        .filter((e) => e.type === 'streak_7' && now - e.ts < 7 * 86_400_000)
        .map((e) => e.citizen_slug)
    );
  }

  function tick() {
    const now = Date.now();
    drawGround();
    flameSlugs = computeFlameSlugs(now);
    updatePorings(now);
    ctx.font = SPRITE_FONT;
    charW = ctx.measureText('M').width;
    drawPorings();
    drawPortals(now);
    // Vending stalls parked for now — see the future "buddy marketplace /
    // job board" idea (owners sell services or post for help).
    let sitting = 0;
    const sorted = [...state.citizens].sort((a, b3) => (actors.get(a.slug)?.y ?? 0) - (actors.get(b3.slug)?.y ?? 0));
    for (const c of sorted) {
      const actor = ensureActor(c);
      // The plaza is ALWAYS alive: every buddy wanders. Long-idle owners'
      // buddies just stroll calmer, and any buddy occasionally takes a
      // brief RO-vendor sit-break, then gets up and moves again — so the
      // square never freezes even when synced data is stale.
      const calm = now - c.last_seen_at >= IDLE_SIT_MS; // owner long-AFK → calmer
      if (!REDUCED_MOTION) {
        // Transient sit-break: start occasionally, last ~4-8s, then resume.
        if (!actor.sitUntil && actor.rng() < (calm ? 0.004 : 0.0015)) {
          actor.sitUntil = performance.now() + 4000 + actor.rng() * 4000;
        }
        actor.sitting = actor.sitUntil ? performance.now() < actor.sitUntil : false;
        if (actor.sitting && performance.now() >= actor.sitUntil) { actor.sitUntil = 0; actor.sitting = false; }

        if (!actor.sitting) {
          const owner = c.slug === state.meSlug && actor.owned;
          const speed = BEHAVIORS[actor.behavior].speed * (calm ? 0.22 : 0.35);
          const dx = actor.tx - actor.x, dy = actor.ty - actor.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 3) {
            // Owner sprites hold where you clicked; room-driven peers hold where
            // the server put them. Only autonomous NPCs pick a new waypoint.
            if (!actor.owned && !actor.remote && actor.rng() < 0.01) pickWaypoint(actor);
          } else {
            actor.x += (dx / dist) * speed;
            actor.y += (dy / dist) * speed;
          }
          // Stream my own position to the room at ~8 Hz while walking (not per
          // frame), plus one final frame when I stop, so peers see me arrive.
          if (owner) {
            const moving = dist >= 3;
            const nowMs = performance.now();
            if ((moving || actor.wasMoving) && nowMs - (actor.lastMoveSentAt || 0) >= 120) {
              const f = RT.toFraction(actor.x, actor.y);
              RT.sendMoveTo(f.x, f.y);
              actor.lastMoveSentAt = nowMs;
              actor.wasMoving = moving;
            }
            checkPortal(actor); // walked into a gate? → portal_enter + redirect
          }
        }
        actor.frame = Math.floor((performance.now() + actor.phaseMs) / 450);
      }
      if (actor.sitting) sitting++;
      state.actorFrames[c.slug] = actor.frame;
      drawCitizen(c, actor, now);
    }
    state.sittingCount = sitting;
    drawButterflies(now);
    drawKafra(now);
    drawClickMarkers(now);
    drawCelebrations(now);
    drawXpPopups(now);
    if (state.citizens.length === 0) drawQuietTown();
    drawMinimap();
    requestAnimationFrame(tick);
  }

  // ── Poring: RO's mascot jelly, ambient plaza life ─────────────────────
  const PORING_FRAMES = ['(◕ᴗ◕)', '(◕‿◕)'];
  function ensurePorings() {
    if (state.porings.length) return;
    const seed = mulberry32(hashStr('porings-' + district + new Date().toISOString().slice(0, 10)));
    const count = 3 + Math.floor(seed() * 3);
    const b = plazaBounds();
    for (let i = 0; i < count; i++) {
      state.porings.push({
        x: b.cx + (seed() - 0.5) * b.rx * 1.4,
        y: b.cy + (seed() - 0.5) * b.ry * 1.4,
        tx: 0, ty: 0, rng: mulberry32(hashStr('poring-' + i + district)), bob: seed() * 6,
      });
    }
    state.porings.forEach(hopPoring);
  }
  function hopPoring(p) {
    const b = plazaBounds();
    p.tx = b.cx + (p.rng() - 0.5) * b.rx * 1.5;
    p.ty = b.cy + (p.rng() - 0.5) * b.ry * 1.5;
  }
  function updatePorings(now) {
    ensurePorings();
    if (REDUCED_MOTION) return;
    for (const p of state.porings) {
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) { if (p.rng() < 0.01) hopPoring(p); }
      else { p.x += (dx / dist) * 0.6; p.y += (dy / dist) * 0.6; }
    }
  }
  function drawPorings() {
    ctx.font = '12px Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    for (const p of state.porings) {
      const hop = REDUCED_MOTION ? 0 : Math.abs(Math.sin(performance.now() / 300 + p.bob)) * 5;
      const frame = REDUCED_MOTION ? 0 : Math.floor(performance.now() / 500) % PORING_FRAMES.length;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 4, 10, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff9ec7';
      ctx.strokeStyle = 'rgba(60,20,40,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeText(PORING_FRAMES[frame], p.x, p.y - hop);
      ctx.fillText(PORING_FRAMES[frame], p.x, p.y - hop);
      ctx.restore();
    }
  }

  // ── Portal gates: RO blue warp tiles you walk into to travel ──────────
  // One glowing gate per outgoing portal in this town, labelled with its
  // destination. Purely a ground feature; the actual travel is driven by the
  // owner sprite's hit-test (checkPortal) → portal_enter → room_redirect.
  function drawPortals(now) {
    if (!portalsHere.length) return;
    ctx.textAlign = 'center';
    for (const p of portalsHere) {
      const tl = RT.toPixel(p.rect.x, p.rect.y);
      const br = RT.toPixel(p.rect.x + p.rect.w, p.rect.y + p.rect.h);
      const w = br.x - tl.x, h = br.y - tl.y;
      const cx = tl.x + w / 2, cy = tl.y + h / 2;
      const pulse = REDUCED_MOTION ? 0.7 : 0.5 + 0.35 * Math.abs(Math.sin(now / 400));
      ctx.save();
      // outer glow
      const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, Math.max(w, h) * 0.75);
      glow.addColorStop(0, `rgba(120,170,255,${0.5 * pulse})`);
      glow.addColorStop(1, 'rgba(120,170,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.7, h * 0.72, 0, 0, Math.PI * 2); ctx.fill();
      // swirling gate oval (RO warp portal)
      ctx.fillStyle = `rgba(90,140,255,${0.35 + 0.25 * pulse})`;
      ctx.strokeStyle = 'rgba(190,215,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.42, h * 0.46, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // destination label above the gate
      const dest = townFor(p.to).name;
      ctx.font = 'bold 10px Menlo, Consolas, monospace';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(`🌀 ${dest}`, cx, tl.y - 4);
      ctx.fillStyle = '#cfe0ff';
      ctx.fillText(`🌀 ${dest}`, cx, tl.y - 4);
      ctx.restore();
    }
  }

  // ── Vending stalls: RO merchant flex boards ───────────────────────────
  function drawStalls() {
    for (const stall of state.stalls) {
      const actor = actors.get(stall.slug);
      if (!actor) continue;
      const sx = actor.x, sy = actor.y - 40;
      ctx.save();
      ctx.font = 'bold 10px Menlo, Consolas, monospace';
      const w = Math.max(60, ctx.measureText(stall.text).width + 16);
      ctx.fillStyle = 'rgba(255, 214, 90, 0.95)';
      ctx.strokeStyle = 'rgba(90, 60, 10, 0.9)';
      ctx.lineWidth = 1.5;
      roundRect(sx - w / 2, sy - 16, w, 18, 4);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#4a3400';
      ctx.textAlign = 'center';
      ctx.fillText(stall.text, sx, sy - 3);
      ctx.restore();
    }
  }

  // ── Floating XP popups: RO damage numbers ─────────────────────────────
  // Click-to-pet: RO /heart. Anyone can pet any buddy (pure delight);
  // a temporary ♥ bubble appears over the head.
  function petBuddy(slug) {
    if (!actors.has(slug)) return;
    state.bubbles[slug] = { emote: '♥', ts: Date.now() };
    playSfx('session');
  }
  state.petBuddy = petBuddy;

  // ── real-time control (M3): drive your own sprite; see peers move live ──
  // The browser holds only a SCOPED control token (minted in M1), never the
  // world token. With one, we connect a live socket to the town's Durable
  // Object room, stream our own move_to intents, and drive peer sprites from
  // the room's snapshots. Spectators (no token) keep the old poll-only plaza.
  const RT = (() => {
    const LS_KEY = 'buddyControlToken';
    let socket = null;
    let seq = 0;
    let backoff = 1000;
    let stopped = false; // a fatal auth close (1008) parks reconnection
    let currentToken = null; // the control token this socket authenticated with

    function storedToken() {
      try { return localStorage.getItem(LS_KEY); } catch { return null; }
    }
    // A personal plaza link carries a one-time #code=… ; exchange it once for a
    // control token, persist it, then scrub the fragment so the single-use code
    // never lingers in the URL or history.
    async function redeemCodeFromFragment() {
      const m = location.hash.match(/(?:^#|&)code=([0-9a-fA-F]+)/);
      if (!m) return;
      let redeemed = false;
      try {
        const res = await fetch(`${API_BASE}/v1/browser-session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: m[1] }),
        });
        if (res.ok) {
          const { controlToken } = await res.json();
          if (controlToken) { try { localStorage.setItem(LS_KEY, controlToken); } catch {} redeemed = true; }
        }
      } catch { /* offline: leave the code so a reload can retry */ }
      // Only scrub the one-time code once it's actually been consumed — a
      // failed/offline attempt keeps it so reopening the tab can retry.
      if (redeemed) history.replaceState(null, '', location.pathname + location.search);
    }

    async function fetchMe(token) {
      try {
        const res = await fetch(`${API_BASE}/v1/me`, { headers: { authorization: `Bearer ${token}` } });
        return res.ok ? await res.json() : null;
      } catch { return null; }
    }

    // Map fractional [0,1] room coords ↔ plaza pixels within the courtyard, so
    // the shared server truth renders consistently across differently-sized
    // viewers. The room only ever speaks fractions.
    function toPixel(fx, fy) {
      const b = plazaBounds();
      return { x: b.cx + (fx - 0.5) * 2 * b.rx, y: b.cy + (fy - 0.5) * 2 * b.ry };
    }
    function toFraction(px, py) {
      const b = plazaBounds();
      const clamp = (n) => Math.min(1, Math.max(0, n));
      return { x: clamp((px - b.cx) / (2 * b.rx) + 0.5), y: clamp((py - b.cy) / (2 * b.ry) + 0.5) };
    }

    // Drive peers from a snapshot. Never touch my own sprite (I drive it
    // locally). Under reduced motion, SNAP to the server position rather than
    // animate — this runs OUTSIDE tick()'s reduced-motion freeze on purpose.
    function applySnapshot(list) {
      for (const a of list || []) {
        if (!a || a.slug === state.meSlug) continue;
        // Harden the render against a malformed/hostile frame: reject non-finite
        // coords (never NaN-poison a sprite's position/minimap) and clamp to the
        // unit square before mapping to pixels.
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
        const actor = actors.get(a.slug);
        if (!actor) continue; // not rendered yet — arrives via the /v1/world poll
        const p = toPixel(Math.min(1, Math.max(0, a.x)), Math.min(1, Math.max(0, a.y)));
        actor.tx = p.x; actor.ty = p.y;
        actor.remote = true; // a room-driven peer: suppress autonomous wander
        if (REDUCED_MOTION) { actor.x = p.x; actor.y = p.y; }
      }
    }

    function handleServerMsg(msg) {
      switch (msg && msg.type) {
        case 'welcome':
          // The room's public id for me (anon-masked, matching the plaza's own
          // key) is the sprite I control — not necessarily /v1/me's real slug.
          if (msg.self) state.meSlug = msg.self;
          applySnapshot(msg.actors);
          break;
        case 'join': applySnapshot([msg.actor]); break;
        case 'snapshot': applySnapshot(msg.actors); break;
        case 'leave': { const a = actors.get(msg.slug); if (a) a.remote = false; break; }
        case 'room_redirect': doRedirect(msg); break;
      }
    }

    // Portal warp landed server-side: my buddy now lives in msg.district. A DO
    // can't hand a socket to another DO, so we close this one, navigate to the
    // new town, and the fresh page reconnects to /v1/live/<new>. Full reload is
    // the MVP; an in-place town-swap is a later optimization.
    function doRedirect(msg) {
      if (!msg || typeof msg.district !== 'string') return;
      stopped = true; // don't reconnect to the OLD room after we close it
      try { if (socket) socket.close(1000, 'portal'); } catch {}
      socket = null;
      state.lastRedirect = msg; // test hook
      const url = new URL(location.href);
      url.searchParams.set('district', msg.district);
      location.assign(url.toString());
    }

    function wsUrl() {
      const base = API_BASE
        ? API_BASE.replace(/^http/i, 'ws')
        : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
      return `${base}/v1/live/${district}`;
    }

    function connect(token) {
      if (stopped) return;
      currentToken = token; // remembered so portal_enter can re-assert scope
      let ws;
      try { ws = new WebSocket(wsUrl()); } catch { scheduleReconnect(token); return; }
      socket = ws;
      ws.addEventListener('open', () => {
        backoff = 1000;
        ws.send(JSON.stringify({ type: 'hello', controlToken: token, slug: state.meSlug || undefined, lastSeq: seq }));
      });
      ws.addEventListener('message', (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        handleServerMsg(msg);
      });
      ws.addEventListener('close', (ev) => {
        socket = null;
        // 1008 = policy/auth violation (bad/expired token, wrong room): the
        // token won't get better on retry, so stop hammering the room.
        if (ev && ev.code === 1008) { stopped = true; return; }
        scheduleReconnect(token);
      });
      ws.addEventListener('error', () => { try { ws.close(); } catch {} });
    }
    function scheduleReconnect(token) {
      if (stopped) return;
      setTimeout(() => connect(token), backoff);
      backoff = Math.min(backoff * 2, 30_000); // capped exponential backoff
    }

    // Emit an owner move intent. seq is monotonic so the room drops stale/out-of
    // -order frames. Fire-and-forget: if the socket is down, the local sprite
    // still walks; peers catch up on the next connected frame.
    function sendMoveTo(fx, fy) {
      seq += 1;
      const msg = { type: 'move_to', seq, x: fx, y: fy, clientTs: Date.now() };
      state.lastMoveTo = msg; // test hook
      if (socket && socket.readyState === 1) { try { socket.send(JSON.stringify(msg)); } catch {} }
    }

    // Emit a portal-enter intent when the owner sprite walks into a gate. Reuses
    // the monotonic seq (shared with move_to) so the room drops a duplicate
    // portal_enter. Carries the control token so the room can validate the move
    // against my own citizen (and only mine). Fire-and-forget like move_to.
    function sendPortalEnter(portal) {
      seq += 1;
      const msg = { type: 'portal_enter', seq, portal: portal.id, to: portal.to, controlToken: currentToken || undefined };
      state.lastPortalEnter = msg; // test hook
      if (socket && socket.readyState === 1) { try { socket.send(JSON.stringify(msg)); } catch {} }
    }

    return { storedToken, redeemCodeFromFragment, fetchMe, connect, toPixel, toFraction, applySnapshot, handleServerMsg, sendMoveTo, sendPortalEnter };
  })();

  // The sprite I control, if any (keyed by the plaza's public slug).
  function ownerActor() {
    return state.meSlug ? actors.get(state.meSlug) : null;
  }
  // Click-to-move: point my sprite at a spot in the courtyard. tick() walks it
  // there and streams move_to while moving; under reduced motion we snap.
  function moveOwnerTo(px, py) {
    const actor = ownerActor();
    if (!actor) return false;
    const b = plazaBounds();
    const tx = Math.max(b.cx - b.rx, Math.min(b.cx + b.rx, px));
    const ty = Math.max(b.cy - b.ry, Math.min(b.cy + b.ry, py));
    actor.tx = tx; actor.ty = ty; actor.owned = true;
    state.clickMarkers.push({ x: tx, y: ty, born: performance.now() }); // RO destination ring
    if (REDUCED_MOTION) {
      actor.x = tx; actor.y = ty;
      const f = RT.toFraction(tx, ty);
      RT.sendMoveTo(f.x, f.y);
    }
    checkPortal(actor); // a reduced-motion snap may land straight in a gate
    return true;
  }

  // Hit-test the owner sprite against the town's portal gates each frame. Only a
  // DRIVEN owner (owned === true, i.e. you've clicked at least once) can warp,
  // so a fresh spawn that happens to sit on a gate never auto-travels. Firing is
  // EDGE-triggered: portal_enter goes out once on entry, not every resident
  // frame; leaving the rect re-arms it.
  function checkPortal(actor) {
    if (!actor || !actor.owned || !portalsHere.length) return;
    const f = RT.toFraction(actor.x, actor.y);
    let inside = null;
    for (const p of portalsHere) {
      if (f.x >= p.rect.x && f.x <= p.rect.x + p.rect.w && f.y >= p.rect.y && f.y <= p.rect.y + p.rect.h) {
        inside = p;
        break;
      }
    }
    if (inside) {
      if (actor.inPortal !== inside.id) { actor.inPortal = inside.id; RT.sendPortalEnter(inside); }
    } else {
      actor.inPortal = null;
    }
  }

  // Test/instrumentation hooks (read by plaza-smoke.test.ts).
  state.moveOwnerTo = moveOwnerTo;
  state.applySnapshot = (msg) => RT.applySnapshot(msg && msg.actors);
  state.rtToPixel = RT.toPixel;
  state.rtToFraction = RT.toFraction;
  state.portals = portalsHere;
  state.actorPos = (slug) => {
    const a = actors.get(slug);
    return a ? { x: a.x, y: a.y, tx: a.tx, ty: a.ty, owned: !!a.owned, remote: !!a.remote } : null;
  };
  // Drive the owner sprite into a gate and run the real hit-test — the portal
  // warp then fires through sendPortalEnter (recorded on state.lastPortalEnter)
  // whether or not a live socket is attached.
  state.enterPortalForTest = (i = 0) => {
    const actor = ownerActor();
    if (!actor || !portalsHere.length) return null;
    const p = portalsHere[i % portalsHere.length];
    const c = RT.toPixel(p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h / 2);
    actor.x = c.x; actor.y = c.y; actor.owned = true; actor.inPortal = null;
    checkPortal(actor);
    return state.lastPortalEnter || null;
  };

  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    let best = null, bestD = 42; // click radius
    for (const c of state.citizens) {
      const a = actors.get(c.slug);
      if (!a) continue;
      const d = Math.hypot(a.x - mx, a.y - my);
      if (d < bestD) { bestD = d; best = c.slug; }
    }
    if (best) petBuddy(best);
    else if (ownerActor()) moveOwnerTo(mx, my); // I drive my own sprite
    else state.clickMarkers.push({ x: mx, y: my, born: performance.now() }); // spectator RO move-marker
  });

  // RO green destination ring — the classic click-to-move marker.
  state.clickMarkers = [];
  function drawClickMarkers() {
    const LIFE = 700;
    const t = performance.now();
    state.clickMarkers = state.clickMarkers.filter((m) => t - m.born < LIFE);
    for (const m of state.clickMarkers) {
      const p = (t - m.born) / LIFE;
      ctx.save();
      ctx.strokeStyle = `rgba(90, 255, 120, ${1 - p})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, 6 + p * 16, (6 + p * 16) * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Ambient butterflies — a few drift across the square (RO town life).
  const butterflies = [];
  function drawButterflies(now) {
    if (!butterflies.length) {
      const seed = mulberry32(hashStr('bf' + district));
      for (let i = 0; i < 4; i++) butterflies.push({ p: seed(), sp: 0.06 + seed() * 0.06, y: 100 + seed() * 300, amp: 20 + seed() * 30, hue: ['#ffd54f', '#ff8fa3', '#b388ff', '#8fd3f0'][i % 4] });
    }
    if (REDUCED_MOTION) return;
    for (const bf of butterflies) {
      bf.p = (bf.p + bf.sp / 100) % 1;
      const x = bf.p * (canvas.width + 40) - 20;
      const y = bf.y + Math.sin(bf.p * Math.PI * 8) * bf.amp;
      const flap = Math.sin(now / 90 + bf.p * 20) > 0 ? 1 : 0.4;
      ctx.save();
      ctx.fillStyle = bf.hue;
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.ellipse(x - 3, y, 3, 3 * flap, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 3, y, 3, 3 * flap, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // RO minimap radar — a corner panel with buddy dots.
  function drawMinimap() {
    const mw = 120, mh = 84, mx = canvas.width - mw - 14, my = 46;
    ctx.save();
    ctx.fillStyle = 'rgba(15,12,41,0.85)';
    ctx.strokeStyle = '#7c4dff';
    ctx.lineWidth = 1.5;
    roundRect(mx, my, mw, mh, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#b39ddb';
    ctx.font = 'bold 9px Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${TOWN.name} · ${state.citizens.length}`, mx + 8, my + 13);
    const b = plazaBounds();
    for (const c of state.citizens) {
      const a = actors.get(c.slug);
      if (!a) continue;
      const nx = mx + 8 + ((a.x - (b.cx - b.rx)) / (b.rx * 2)) * (mw - 16);
      const ny = my + 20 + ((a.y - b.skyline) / (canvas.height - b.skyline)) * (mh - 28);
      const active = Date.now() - c.last_seen_at < ACTIVE_WINDOW_MS;
      ctx.fillStyle = active ? '#ffe082' : '#8f7fc0';
      ctx.beginPath(); ctx.arc(Math.max(mx + 6, Math.min(mx + mw - 6, nx)), Math.max(my + 22, Math.min(my + mh - 6, ny)), 2, 0, Math.PI * 2); ctx.fill();
    }
    // Kafra dot (pink)
    ctx.fillStyle = '#ffd0f0';
    ctx.beginPath(); ctx.arc(mx + mw / 2 + 12, my + mh / 2 + 4, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Kafra — RO's save-point NPC. Stationary by the fountain, gives every
  // town (even an empty one) a friendly landmark of life.
  function drawKafra(now) {
    const b = plazaBounds();
    const kx = b.cx + 70, ky = b.cy - 6;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(kx, ky + 8, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.font = '20px serif';
    ctx.fillText('💁‍♀️', kx, ky + 4); // Kafra employee
    // occasional greeting bubble
    if ((now / 1000 | 0) % 12 < 3) drawChatBubble(kx, ky - 26, 'Welcome~');
    ctx.font = 'bold 9px Menlo, Consolas, monospace';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText('Kafra', kx, ky + 22);
    ctx.fillStyle = '#ffd0f0';
    ctx.fillText('Kafra', kx, ky + 22);
    ctx.restore();
  }

  // Friendly hint when a district has no buddies yet (post-warp empty town).
  function drawQuietTown() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px Menlo, Consolas, monospace';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    const msg = `🦗 ${TOWN.name} is quiet right now`;
    ctx.strokeText(msg, canvas.width / 2, 120);
    ctx.fillStyle = '#ffe082';
    ctx.fillText(msg, canvas.width / 2, 120);
    ctx.font = '13px Menlo, Consolas, monospace';
    ctx.fillStyle = '#e1bee7';
    ctx.fillText('🌀 warp to another town, or wait for buddies to arrive', canvas.width / 2, 144);
    ctx.restore();
  }

  const MAX_XP_POPUPS = 40;
  function spawnXpPopup(slug, type) {
    const xp = XP_VALUES[type] ?? 0;
    const text = xp > 0 ? `+${xp} XP` : (type === 'level_up' ? 'LEVEL UP!' : '');
    if (!text) return;
    state.xpPopups.push({ slug, text, born: Date.now() });
    // Hard cap so a burst (or refreshes without an active tick) can't grow
    // the array unbounded; keep the newest.
    if (state.xpPopups.length > MAX_XP_POPUPS) {
      state.xpPopups = state.xpPopups.slice(-MAX_XP_POPUPS);
    }
  }
  state.spawnXpPopup = spawnXpPopup;
  function drawXpPopups(now) {
    const LIFE = 1600;
    state.xpPopups = state.xpPopups.filter((p) => now - p.born < LIFE);
    ctx.font = 'bold 12px Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    for (const p of state.xpPopups) {
      const actor = actors.get(p.slug);
      if (!actor) continue;
      const t = (now - p.born) / LIFE;
      const rise = REDUCED_MOTION ? 20 : t * 34;
      ctx.save();
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = '#ffe082';
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(p.text, actor.x + 18, actor.y - 30 - rise);
      ctx.fillText(p.text, actor.x + 18, actor.y - 30 - rise);
      ctx.restore();
    }
  }

  // ── data ───────────────────────────────────────────────────────────────
  const EVENT_LABEL = {
    level_up: 'leveled up! 🎉',
    deploy: 'deployed to prod 🚀',
    commit: 'shipped a commit',
    tests_passed: 'got the tests green ✅',
    bug_fix: 'squashed a bug 🔧',
    streak_7: 'is on a streak 🔥',
    observe: 'is coding',
    session: 'got pets',
  };

  function updateTicker() {
    const nameBySlug = Object.fromEntries(state.citizens.map((c) => [c.slug, c.name]));
    state.tickerLines = state.events
      .slice(0, 6)
      .map((e) => `${nameBySlug[e.citizen_slug] || e.citizen_slug} ${EVENT_LABEL[e.type] || e.type}`);
    // textContent-only construction: citizen names are external input and
    // must never reach an HTML parser (stored-XSS defense in depth).
    tickerEl.replaceChildren();
    const brand = document.createElement('span');
    brand.className = 'brand';
    brand.textContent = `⛲ BUDDY WORLD · ${TOWN.name}`;
    tickerEl.appendChild(brand);
    for (const l of state.tickerLines) {
      const span = document.createElement('span');
      span.className = 'line';
      span.textContent = l;
      tickerEl.appendChild(span);
    }
  }

  // ── RO world-broadcast banner (M6) ───────────────────────────────────────
  // The global celebration feed (/v1/announcements) drives a distinct yellow
  // marquee for BIG moments — level-ups and ships — visible in EVERY town.
  // Routine commits/observe stay in the quiet #ticker above; this is the RO
  // "yellow world-broadcast" homage. Tiering is done server-side: the feed only
  // ever contains celebration-class events, so anything that arrives here is
  // broadcast-worthy.
  const BROADCAST_ICON = '📢';
  function broadcastPhrase(a) {
    const name = a.name || a.slug || 'A buddy';
    if (a.type === 'level_up') return a.level ? `${name} has reached Level ${a.level}!` : `${name} leveled up!`;
    if (a.type === 'deploy') return `${name} shipped to production!`;
    if (a.type === 'streak_7') return `${name} is on a 7-day streak!`;
    return `${name} ${EVENT_LABEL[a.type] || a.type}`;
  }
  function broadcastText(a) {
    const town = a.town ? ` — in ${a.town}` : '';
    return `${BROADCAST_ICON} ${broadcastPhrase(a)}${town}`;
  }

  // Render one celebration on the banner NOW. textContent-only (citizen names
  // are external input — never let them reach an HTML parser; the same
  // stored-XSS defense updateTicker uses). Restarts the marquee, or holds
  // static under prefers-reduced-motion.
  function showBroadcast(a) {
    state.broadcast = { type: a.type, name: a.name || a.slug, text: broadcastText(a) };
    broadcastEl.replaceChildren();
    const span = document.createElement('span');
    span.className = 'broadcast-msg';
    span.textContent = state.broadcast.text;
    broadcastEl.appendChild(span);
    broadcastEl.hidden = false;
    broadcastEl.setAttribute('data-type', a.type);
    if (REDUCED_MOTION) {
      broadcastEl.classList.add('static');
      broadcastEl.classList.remove('scroll');
    } else {
      broadcastEl.classList.remove('static', 'scroll');
      void broadcastEl.offsetWidth; // reflow so the marquee restarts each time
      broadcastEl.classList.add('scroll');
    }
    playSfx('level_up'); // the RO "ding" doubles as the broadcast chime (opt-in)
  }

  function hideBroadcast() {
    state.broadcast = null;
    broadcastEl.hidden = true;
    broadcastEl.replaceChildren();
    broadcastEl.classList.remove('scroll', 'static');
    broadcastEl.removeAttribute('data-type');
  }

  // Sequential queue: one broadcast at a time, each held for its scroll (or a
  // static beat under reduced motion) before the next plays.
  const broadcastQueue = [];
  let broadcastTimer = null;
  function pumpBroadcasts() {
    if (broadcastTimer) return; // one is already on screen
    const a = broadcastQueue.shift();
    if (!a) { hideBroadcast(); return; }
    showBroadcast(a);
    const hold = REDUCED_MOTION ? 4500 : 9500; // ~marquee duration (index.html: 9s)
    broadcastTimer = setTimeout(() => { broadcastTimer = null; pumpBroadcasts(); }, hold);
  }

  let seenAnnounceKeys = new Set();
  let firstAnnounceLoad = true;
  // Fold the newest-first feed into the banner. The FIRST poll only seeds the
  // seen-set (a fresh viewer doesn't get a burst of the last hour of history);
  // after that, unseen celebrations enqueue oldest-first so they play in order.
  function ingestAnnouncements(list) {
    state.announcements = list;
    const fresh = [];
    for (const a of list) {
      // Prefer the stable world_events id (distinct even for two same-ms
      // same-type events); fall back to the composite only if a feed row
      // somehow lacks an id, so nothing silently re-broadcasts.
      const key = a.id != null ? `e${a.id}` : `${a.slug}:${a.type}:${a.ts}`;
      if (seenAnnounceKeys.has(key)) continue;
      seenAnnounceKeys.add(key);
      fresh.push(a);
    }
    if (firstAnnounceLoad) { firstAnnounceLoad = false; return; }
    for (const a of fresh.reverse()) broadcastQueue.push(a);
    pumpBroadcasts();
  }

  async function refreshAnnouncements() {
    let res;
    try {
      res = await fetch(`${API_BASE}/v1/announcements`);
    } catch {
      return; // offline/refused: keep the last banner state
    }
    if (!res.ok) return;
    const data = await res.json();
    ingestAnnouncements(Array.isArray(data.announcements) ? data.announcements : []);
  }

  function updateAccessibility() {
    canvas.setAttribute(
      'aria-label',
      `Buddy World ${district}: ${state.citizens.length} buddies wandering an isometric plaza. ` +
        (state.tickerLines[0] ? `Latest: ${state.tickerLines.join('; ')}.` : '')
    );
    if (srListEl) {
      srListEl.replaceChildren();
      for (const c of state.citizens) {
        const li = document.createElement('li');
        li.textContent = `${c.name}, level ${c.level} ${c.species}, feeling ${c.mood}`;
        srListEl.appendChild(li);
      }
    }
  }

  async function refresh() {
    let res;
    try {
      res = await fetch(`${API_BASE}/v1/world/${district}`);
    } catch {
      return; // offline/refused: keep rendering the last known state
    }
    if (!res.ok) return;
    const data = await res.json();
    const prevSeen = seenEventKeys;
    state.citizens = data.citizens || [];
    state.events = data.events || [];
    const now = Date.now();
    state.celebrations = state.events.filter(
      (e) => now - e.ts < CELEBRATION_WINDOW_MS && e.type !== 'observe' && e.type !== 'session'
    );
    rebuildBubbles(now);
    // Newly-arrived events (not seen last poll) spawn a floating XP popup + SFX.
    // The first load only seeds the seen-set — no burst of popups for the
    // last hour of history when you open the page.
    seenEventKeys = new Set(state.events.map((e) => `${e.citizen_slug}:${e.type}:${e.ts}`));
    if (!firstLoad) {
      for (const e of state.events) {
        const key = `${e.citizen_slug}:${e.type}:${e.ts}`;
        if (!prevSeen.has(key) && now - e.ts < CELEBRATION_WINDOW_MS) {
          spawnXpPopup(e.citizen_slug, e.type);
          playSfx(e.type);
        }
      }
    }
    firstLoad = false;
    updateTicker();
    updateAccessibility();
    window.__PLAZA__ = state;
  }

  let seenEventKeys = new Set();
  let firstLoad = true;

  // Overhead RO emote bubbles for activity in the last 90s.
  function rebuildBubbles(now) {
    state.bubbles = {};
    for (const e of state.events) {
      if (now - e.ts > BUBBLE_TTL_MS) continue;
      const emote = EVENT_EMOTES[e.type];
      if (!emote) continue;
      const existing = state.bubbles[e.citizen_slug];
      if (!existing || e.ts > existing.ts) state.bubbles[e.citizen_slug] = { emote, ts: e.ts };
    }
  }

  // Vending stalls: the highest-level active citizens flex a WTS-style board.
  function rebuildStalls() {
    const ranked = [...state.citizens]
      .filter((c) => !c.anon)
      .sort((a, b) => b.level - a.level)
      .slice(0, 3);
    state.stalls = ranked.map((c) => {
      const peak = topStat(c.stats);
      return { slug: c.slug, text: `WTS ${peak.name} ${peak.val}` };
    });
  }
  function topStat(stats) {
    let name = 'DEBUG', val = 0;
    const labels = { debugging: 'DEBUG', patience: 'PATIENCE', chaos: 'CHAOS', wisdom: 'WISDOM', snark: 'SNARK' };
    for (const k of Object.keys(labels)) {
      if ((stats[k] ?? 0) > val) { val = stats[k]; name = labels[k]; }
    }
    return { name, val };
  }

  // ── SFX: synthesized RO-flavored chimes (no audio assets) ─────────────
  // Opt-in like the music; WebAudio only, created on first enable so no
  // AudioContext exists until the user asks for sound.
  let audioCtx = null;
  const SFX = {
    level_up: [523, 659, 784, 1047], // C-E-G-C arpeggio (the RO "ding")
    deploy: [392, 523, 659],
    commit: [659],
    tests_passed: [784, 988],
    bug_fix: [440, 330],
    streak_7: [523, 659, 784],
  };
  function playSfx(type) {
    if (!state.sfxEnabled || !audioCtx) return;
    const notes = SFX[type];
    if (!notes) return;
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      const start = audioCtx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
    });
  }
  const sfxToggle = document.getElementById('sfx-toggle');
  if (sfxToggle) {
    sfxToggle.addEventListener('click', () => {
      state.sfxEnabled = !state.sfxEnabled;
      if (state.sfxEnabled && !audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      sfxToggle.textContent = state.sfxEnabled ? '🔕 sfx' : '🔔 sfx';
      sfxToggle.setAttribute('aria-pressed', String(state.sfxEnabled));
      sfxToggle.setAttribute('aria-label', state.sfxEnabled ? 'Disable sound effects' : 'Enable sound effects (level-up chimes, deploy fireworks)');
      if (state.sfxEnabled) playSfx('level_up'); // confirmation chime
    });
  }

  async function boot() {
    try {
      const res = await fetch('sprites.json');
      const data = await res.json();
      state.sprites = data.sprites;
      state.palettes = data.palettes;
    } catch {
      state.sprites = {};
      state.palettes = {};
    }
    try {
      state.jobLines = await (await fetch('jobs.json')).json();
    } catch {
      state.jobLines = null;
    }
    await refresh();
    setInterval(refresh, 10_000);
    // Global celebration feed → RO-yellow broadcast banner. Its own light poll
    // (same cadence) so a per-town world fetch failing never stalls the banner,
    // and every town shows the same cross-town celebrations.
    await refreshAnnouncements();
    setInterval(refreshAnnouncements, 10_000);
    requestAnimationFrame(tick);

    // Real-time control bootstrap (M3). Best-effort and fully optional: any
    // failure just leaves you as a spectator on the /v1/world poll.
    try {
      await RT.redeemCodeFromFragment();
      const token = RT.storedToken();
      if (token) {
        const me = await RT.fetchMe(token);
        if (me && me.slug) {
          state.me = me;
          state.meSlug = me.slug; // welcome.self refines this (anon-safe) once connected
          // Only join the room whose town this page is showing; a buddy in
          // another town can't be driven from here (the room would reject it).
          if (!me.district || me.district === district) RT.connect(token);
        }
      }
    } catch { /* never let control setup break the plaza */ }
    // Expose the player hooks whether or not we have a token (tests drive them).
    window.__PLAYER__ = {
      get meSlug() { return state.meSlug; },
      get lastMoveTo() { return state.lastMoveTo; },
      get lastPortalEnter() { return state.lastPortalEnter; },
      get lastRedirect() { return state.lastRedirect; },
      get me() { return state.me; },
      moveOwnerTo,
      applySnapshot: state.applySnapshot,
      enterPortalForTest: (i) => state.enterPortalForTest(i),
    };
  }

  // ── plaza music (self-hosted, original, no third-party embed) ─────────
  // ON BY DEFAULT: a hidden <audio> plays original royalty-free ambience
  // (Suno-generated, world/public/music/) — no YouTube iframe, no visible
  // player, no third party, nothing copyrighted. Browsers block audible
  // autoplay until a user gesture, so we attempt to start immediately and,
  // if blocked, kick off on the visitor's first interaction. The 🎵 button
  // still toggles it off/on.
  const musicToggle = document.getElementById('music-toggle');
  const musicAudio = document.getElementById('music-audio');

  // Per-town music: each town has its own Suno-generated theme in
  // world/public/music/. Point the <audio> at the CURRENT town's track
  // (derived from the district) before playing; fall back to plaza-theme.
  const TOWN_TRACK = {
    Prontera: 'plaza-theme', Payon: 'payon', Geffen: 'geffen',
    Alberta: 'alberta', Morroc: 'morroc', Comodo: 'comodo',
  };
  if (musicAudio) {
    const track = TOWN_TRACK[TOWN.name] || 'plaza-theme';
    // Prontera keeps the static <source>s already in index.html (plaza-theme);
    // only rebuild + load() for other towns. Calling load() unconditionally
    // kicks off a media fetch that stalls headless networkidle0 on the landing.
    if (track !== 'plaza-theme') {
      musicAudio.replaceChildren();
      for (const [ext, type] of [['ogg', 'audio/ogg'], ['mp3', 'audio/mpeg']]) {
        const s = document.createElement('source');
        s.src = `music/${track}.${ext}`;
        s.type = type;
        musicAudio.appendChild(s);
      }
      musicAudio.load();
    }
  }

  if (musicToggle && musicAudio) {
    const setIdle = () => {
      musicToggle.textContent = '🎵 music';
      musicToggle.setAttribute('aria-pressed', 'false');
      musicToggle.setAttribute('aria-label', 'Play plaza music');
    };
    const setPlaying = () => {
      musicToggle.textContent = '🔇 stop music';
      musicToggle.setAttribute('aria-pressed', 'true');
      musicToggle.setAttribute('aria-label', 'Stop plaza music');
    };
    const start = async () => {
      try { await musicAudio.play(); setPlaying(); return true; }
      catch { return false; }
    };
    musicToggle.addEventListener('click', async () => {
      if (!musicAudio.paused) { musicAudio.pause(); setIdle(); return; }
      await start();
    });
    // Keep the button honest if playback stops for any reason.
    musicAudio.addEventListener('pause', setIdle);
    musicAudio.addEventListener('ended', setIdle);

    // On by default: try to autoplay now; if the browser blocks it, start on
    // the first user gesture (a one-shot listener that then removes itself).
    (async () => {
      if (await start()) return;
      const kickstart = (e) => {
        window.removeEventListener('pointerdown', kickstart);
        window.removeEventListener('keydown', kickstart);
        // If the first gesture was the music button itself, let its own click
        // handler run (don't start-then-toggle-off on the same click).
        if (e && e.target && e.target.closest && e.target.closest('#music-toggle')) return;
        if (musicAudio.paused) start();
      };
      window.addEventListener('pointerdown', kickstart);
      window.addEventListener('keydown', kickstart);
    })();
  }

  boot();
})();
