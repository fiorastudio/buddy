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

  // Warp portal → next district/town (RO blue gate). Wire the label + href
  // to whatever town comes next in the cycle.
  (() => {
    const warp = document.getElementById('warp');
    if (!warp) return;
    // Clamp to a sane integer so the href is always ?district=plaza-<int>
    // (huge inputs would otherwise stringify as exponent/Infinity).
    const cur = Math.min(9999, Math.max(1, parseInt(String(district).replace(/\D/g, ''), 10) || 1));
    const nextNum = cur + 1;
    const nextTown = townFor('plaza-' + nextNum);
    warp.setAttribute('href', `?district=plaza-${nextNum}`);
    warp.setAttribute('aria-label', `Warp to ${nextTown.name} (next town)`);
    warp.textContent = `🌀 warp to ${nextTown.name} →`;
  })();

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
  function jobLabel(c) {
    if (!state.jobLines) return `Lv.${c.level}`;
    const stats = c.stats || {};
    let peak = 'debugging', val = -1;
    for (const k of STAT_KEYS) if ((stats[k] ?? 0) > val) { val = stats[k]; peak = k; }
    const line = state.jobLines[STAT_UP[peak]] || state.jobLines.DEBUGGING;
    return `${line[jobTier(c.level)]} · Lv.${c.level}`;
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
  const DAY_TILE_BG = [176, 166, 150];  // #b0a696
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
    const grow = Math.min(1, 0.55 + pop / 60); // 6 buddies→~0.65, 60+→full
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

  // ?time=day|night forces the lighting (preview/testing); otherwise clock.
  const TIME_OVERRIDE = params.get('time');
  function isNight() {
    if (TIME_OVERRIDE === 'day') return false;
    if (TIME_OVERRIDE === 'night') return true;
    const h = new Date().getHours();
    return h < 6 || h >= 20;
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

    // backdrop sky (only shows above the rooftops)
    const sky = g.createLinearGradient(0, 0, 0, b.skyline + 40);
    sky.addColorStop(0, night ? '#0b0820' : TOWN.sky[0]);
    sky.addColorStop(1, night ? '#141030' : TOWN.sky[1]);
    g.fillStyle = sky;
    g.fillRect(0, 0, canvas.width, b.skyline + 40);

    drawPavement(g, b, night);
    drawBuildings(g, b, night);
    drawGreenery(g, b, night);
    drawBanners(g, b, night);
    drawFountain(g, b);
  }

  // Irregular cobblestone flagstones filling the whole floor (no shimmer:
  // per-tile shade is seeded deterministically).
  function drawPavement(g, b, night) {
    const top = b.skyline;
    // RO warm flagstone by day; a moody slate at night. Sprite AA is now
    // bidirectional, so a light floor is fine. TILE_BG matches the day base.
    const base = night ? '#3b3550' : '#b0a696';
    g.fillStyle = base;
    g.fillRect(0, top, canvas.width, canvas.height - top);
    const tw = 46, th = 30;
    for (let row = 0; row * th < canvas.height - top + th; row++) {
      const oy = top + row * th;
      const stagger = row % 2 ? tw / 2 : 0;
      for (let col = -1; col * tw < canvas.width + tw; col++) {
        const ox = col * tw + stagger;
        const seed = hashStr(`${col}:${row}:${TOWN.name}`) / 4294967296;
        const shade = 0.86 + seed * 0.22;
        g.fillStyle = shadeColor(base, shade);
        roundRectPath(g, ox + 2, oy + 2, tw - 4, th - 4, 5);
        g.fill();
        g.strokeStyle = night ? 'rgba(0,0,0,0.35)' : 'rgba(80,60,40,0.25)';
        g.lineWidth = 1;
        g.stroke();
      }
    }
    // soft vignette so edges read as enclosed, not cut off
    const vig = g.createRadialGradient(b.cx, b.cy, b.rx * 0.5, b.cx, b.cy, b.rx * 1.3);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, night ? 'rgba(0,0,0,0.5)' : 'rgba(20,10,30,0.35)');
    g.fillStyle = vig;
    g.fillRect(0, top, canvas.width, canvas.height - top);
  }

  // A skyline of RO half-timbered buildings + a couple of awning stalls.
  function drawBuildings(g, b, night) {
    const y0 = b.skyline;
    const wallLit = night ? '#3a3352' : '#e8dcc0';
    const timber = night ? '#241d38' : '#7a5230';
    const roof = night ? '#2a2140' : '#8a4a3a';
    let x = -20;
    let i = 0;
    while (x < canvas.width + 20) {
      const bw = 90 + (hashStr('bw' + i + TOWN.name) % 70);
      const bh = 60 + (hashStr('bh' + i + TOWN.name) % 50);
      const bx = x, by = y0 - bh;
      // roof
      g.fillStyle = roof;
      g.beginPath();
      g.moveTo(bx - 4, by + 14);
      g.lineTo(bx + bw / 2, by - 12);
      g.lineTo(bx + bw + 4, by + 14);
      g.closePath();
      g.fill();
      // wall
      g.fillStyle = wallLit;
      g.fillRect(bx, by + 12, bw, bh);
      // half-timber crossbeams
      g.strokeStyle = timber;
      g.lineWidth = 3;
      g.strokeRect(bx + 1, by + 13, bw - 2, bh - 2);
      g.beginPath();
      g.moveTo(bx + bw / 2, by + 13); g.lineTo(bx + bw / 2, by + bh + 10);
      g.moveTo(bx, by + 12 + bh / 2); g.lineTo(bx + bw, by + 12 + bh / 2);
      g.stroke();
      // arched windows (RO glow at night)
      g.fillStyle = night ? '#ffd27a' : '#4a3a6a';
      for (const wx of [bx + bw * 0.28, bx + bw * 0.72]) {
        g.beginPath();
        g.moveTo(wx - 7, by + bh - 2);
        g.lineTo(wx - 7, by + bh - 20);
        g.arc(wx, by + bh - 20, 7, Math.PI, 0);
        g.lineTo(wx + 7, by + bh - 2);
        g.closePath();
        g.fill();
      }
      x += bw + 6;
      i++;
    }
    // two striped market awnings jutting into the square (RO vending stalls)
    drawAwning(g, 40, y0 + 30, night ? '#4a3a6a' : '#5a8fd0');
    drawAwning(g, canvas.width - 130, y0 + 30, night ? '#5a3a4a' : '#c05a7a');
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

    // soft ground shadow anchors the sprite to the plaza
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(actor.x, actor.y + 4, w * 0.38, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

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

    // test instrumentation: bottom row must sit at a constant offset
    const bottomOffset = Math.round(lastLineY - actor.y);
    const rec = state.spriteBottoms[c.slug] || { min: bottomOffset, max: bottomOffset };
    rec.min = Math.min(rec.min, bottomOffset);
    rec.max = Math.max(rec.max, bottomOffset);
    state.spriteBottoms[c.slug] = rec;

    // owner avatar walks beside the buddy
    ctx.font = '15px serif';
    ctx.textAlign = 'center';
    const avatarIdx = (parseInt(String(c.avatar || 'chibi-1').replace(/\D/g, ''), 10) || 1) - 1;
    ctx.fillText(AVATARS[avatarIdx % AVATARS.length], actor.x + w / 2 + 12, actor.y - 4);

    // name tag, RO style: white with dark outline. RO nameplates show the
    // job class + level under the name.
    const label = `${c.name}${c.shiny ? ' ✨' : ''}${flameSlugs.has(c.slug) ? ' 🔥' : ''}`;
    const job = jobLabel(c);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.font = 'bold 11px Menlo, Consolas, monospace';
    ctx.strokeText(label, actor.x, actor.y + 15);
    ctx.fillStyle = active ? '#ffffff' : '#cfcbe2';
    ctx.fillText(label, actor.x, actor.y + 15);
    ctx.font = '9px Menlo, Consolas, monospace';
    ctx.strokeText(job, actor.x, actor.y + 26);
    ctx.fillStyle = active ? '#ffe082' : '#b0a4c8';
    ctx.fillText(job, actor.x, actor.y + 26);

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
    drawStalls();
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
          const speed = BEHAVIORS[actor.behavior].speed * (calm ? 0.22 : 0.35);
          const dx = actor.tx - actor.x, dy = actor.ty - actor.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 3) {
            if (actor.rng() < 0.01) pickWaypoint(actor);
          } else {
            actor.x += (dx / dist) * speed;
            actor.y += (dy / dist) * speed;
          }
        }
        actor.frame = Math.floor((performance.now() + actor.phaseMs) / 450);
      }
      if (actor.sitting) sitting++;
      state.actorFrames[c.slug] = actor.frame;
      drawCitizen(c, actor, now);
    }
    state.sittingCount = sitting;
    drawCelebrations(now);
    drawXpPopups(now);
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
  });

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
    rebuildStalls();
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
    requestAnimationFrame(tick);
  }

  // ── plaza music (Ragnarok Online OST) ─────────────────────────────────
  // Strictly opt-in: no YouTube iframe (and therefore no third-party
  // request) exists until the visitor clicks. Official embed only —
  // rights holders keep attribution/monetization. youtube-nocookie keeps
  // tracking to the minimum YouTube offers.
  const MUSIC_PLAYLIST = 'PLWa6qxs0LO-v6pR8B9vVmqN-asyi8Crpp';
  const musicToggle = document.getElementById('music-toggle');
  const musicPlayer = document.getElementById('music-player');

  if (musicToggle && musicPlayer) {
    musicToggle.addEventListener('click', () => {
      const playing = musicPlayer.querySelector('iframe');
      if (playing) {
        musicPlayer.replaceChildren(); // removes iframe → stops audio + network
        musicPlayer.hidden = true;
        musicToggle.textContent = '🎵 music';
        musicToggle.setAttribute('aria-pressed', 'false');
        musicToggle.setAttribute('aria-label', 'Play plaza music (Ragnarok Online OST via YouTube)');
        return;
      }
      const iframe = document.createElement('iframe');
      // YouTube ToS requires the embedded player be >=200x200 and visible
      // (Required Minimum Functionality). No smaller, no hiding.
      iframe.width = '300';
      iframe.height = '200';
      iframe.src =
        `https://www.youtube-nocookie.com/embed/videoseries?list=${MUSIC_PLAYLIST}` +
        '&autoplay=1&loop=1';
      iframe.title = 'Plaza music — Ragnarok Online OST (YouTube)';
      iframe.allow = 'autoplay; encrypted-media';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      musicPlayer.replaceChildren(iframe);
      musicPlayer.hidden = false;
      musicToggle.textContent = '🔇 stop music';
      musicToggle.setAttribute('aria-pressed', 'true');
      musicToggle.setAttribute('aria-label', 'Stop plaza music');
    });
  }

  boot();
})();
