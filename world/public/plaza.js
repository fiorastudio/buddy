// Buddy World plaza renderer. Vanilla Canvas 2D — the citizens are ASCII
// sprites, so fillText IS the sprite engine. All animation is client-side
// and deterministic per (slug, utc-date) so every viewer sees a similar
// plaza without any server compute.
(() => {
  'use strict';

  const canvas = document.getElementById('plaza');
  const ctx = canvas.getContext('2d');
  const tickerEl = document.getElementById('ticker');
  const srListEl = document.getElementById('sr-citizens');

  const params = new URLSearchParams(location.search);
  const district = params.get('district') || 'plaza-1';
  const API_BASE = params.get('api') || '';

  const REDUCED_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
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
    const n = parseInt(String(districtName).replace(/\D/g, ''), 10) || 1;
    return TOWNS[(n - 1) % TOWNS.length];
  }
  const TOWN = townFor(district);

  // RO emote bubbles: recent activity pops the classic overhead marks.
  const EVENT_EMOTES = {
    commit: '!', deploy: '!!', bug_fix: '?!', tests_passed: '♪', streak_7: '★',
    observe: '!', session: '♥',
  };
  const BUBBLE_TTL_MS = 90_000;

  // Client-side mirror of XP_REWARDS for the floating damage numbers.
  const XP_VALUES = { observe: 8, session: 5, commit: 25, tests_passed: 20, bug_fix: 35, deploy: 60, level_up: 0, streak_7: 0 };

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
    sfxEnabled: false, spawnXpPopup: null, // bound in the popups section
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
  // Worst-case (brightest) plaza tile: daytime light tile.
  const TILE_BG = [93, 81, 128]; // #5d5180
  const AA_RATIO = 4.5;

  // Lift a color toward white until it clears WCAG AA against the tiles.
  function ensureContrast(rgb) {
    let out = rgb.slice();
    for (let step = 0; step < 20 && contrastRatio(out, TILE_BG) < AA_RATIO; step++) {
      out = out.map((c) => Math.min(255, Math.round(c + (255 - c) * 0.15)));
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

  function plazaBounds() {
    return {
      cx: canvas.width / 2,
      cy: canvas.height / 2 + 20,
      rx: Math.min(canvas.width * 0.4, 560),
      ry: Math.min(canvas.height * 0.32, 300),
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

  // ── drawing ────────────────────────────────────────────────────────────
  function drawGround() {
    const b = plazaBounds();
    const hour = new Date().getHours();
    const night = hour < 6 || hour >= 20;
    const skyTop = night ? '#0d0a20' : TOWN.sky[0];
    const skyBottom = night ? '#151030' : TOWN.sky[1];
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, skyTop);
    sky.addColorStop(1, skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // isometric diamond tiles
    const tileW = 52, tileH = 26, cols = Math.ceil(b.rx * 2 / tileW) + 2, rows = Math.ceil(b.ry * 2 / tileH) + 2;
    for (let row = -rows; row <= rows; row++) {
      for (let col = -cols; col <= cols; col++) {
        const x = b.cx + ((col - row) * tileW) / 2;
        const y = b.cy + ((col + row) * tileH) / 2;
        const dx = (x - b.cx) / b.rx, dy = (y - b.cy) / b.ry;
        if (dx * dx + dy * dy > 1) continue;
        ctx.beginPath();
        ctx.moveTo(x, y - tileH / 2);
        ctx.lineTo(x + tileW / 2, y);
        ctx.lineTo(x, y + tileH / 2);
        ctx.lineTo(x - tileW / 2, y);
        ctx.closePath();
        ctx.fillStyle = (col + row) % 2 ? (night ? '#4a4066' : TOWN.tiles[0]) : (night ? '#443a60' : TOWN.tiles[1]);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.stroke();
      }
    }

    // fountain
    ctx.font = '34px serif';
    ctx.textAlign = 'center';
    ctx.fillText('⛲', b.cx, b.cy + 10);
  }

  function drawCitizen(c, actor, now) {
    const spriteFrames = (state.sprites && state.sprites[c.species]) || [['(?)']];
    const frames = spriteFrames.length;
    const lines = spriteFrames[actor.frame % frames].map((l) => l.replaceAll('{E}', c.eye || '·'));
    const [r, g, b2] = speciesColor(c.species, c.level);
    state.spriteColors[c.slug] = contrastRatio([r, g, b2], TILE_BG);
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
    // variable line counts can never bob the sprite.
    let lastLineY = actor.y;
    lines.forEach((line, i) => {
      const y = actor.y + (i - lines.length) * SPRITE_LINE_H;
      ctx.fillText(line, actor.x - w / 2, y);
      lastLineY = y;
    });
    ctx.restore();

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

    // name tag, RO style: white with dark outline
    const label = `${c.name} · L${c.level}${c.shiny ? ' ✨' : ''}${flameSlugs.has(c.slug) ? ' 🔥' : ''}`;
    ctx.font = 'bold 11px Menlo, Consolas, monospace';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(label, actor.x, actor.y + 15);
    ctx.fillStyle = active ? '#ffffff' : '#cfcbe2';
    ctx.fillText(label, actor.x, actor.y + 15);

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
      // RO: idle owners' buddies sit (Insert-to-sit); active ones walk.
      const idle = now - c.last_seen_at > ACTIVE_WINDOW_MS;
      actor.sitting = idle;
      if (idle) sitting++;
      if (!REDUCED_MOTION) {
        // Idle buddies sit (no walking) but keep their sprite's idle cadence.
        if (!idle) {
          const speed = BEHAVIORS[actor.behavior].speed * 0.35;
          const dx = actor.tx - actor.x, dy = actor.ty - actor.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 3) {
            if (actor.rng() < 0.005) pickWaypoint(actor);
          } else {
            actor.x += (dx / dist) * speed;
            actor.y += (dy / dist) * speed;
          }
        }
        actor.frame = Math.floor((performance.now() + actor.phaseMs) / 450);
      }
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
  function spawnXpPopup(slug, type) {
    const xp = XP_VALUES[type] ?? 0;
    const text = xp > 0 ? `+${xp} XP` : (type === 'level_up' ? 'LEVEL UP!' : '');
    if (!text) return;
    state.xpPopups.push({ slug, text, born: Date.now() });
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
