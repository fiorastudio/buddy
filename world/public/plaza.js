// Buddy World plaza renderer. Vanilla Canvas 2D — the citizens are ASCII
// sprites, so fillText IS the sprite engine. All animation is client-side
// and deterministic per (slug, utc-date) so every viewer sees a similar
// plaza without any server compute.
(() => {
  'use strict';

  const canvas = document.getElementById('plaza');
  const ctx = canvas.getContext('2d');
  const tickerEl = document.getElementById('ticker');

  const params = new URLSearchParams(location.search);
  const district = params.get('district') || 'plaza-1';
  const API_BASE = params.get('api') || '';

  const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
  const CELEBRATION_WINDOW_MS = 60 * 60 * 1000;
  const AVATARS = ['🧍', '🧍‍♀️', '🚶', '🧍', '🧑‍💻', '🚶‍♀️', '🧍', '🧙'];

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
  const state = { citizens: [], events: [], celebrations: [], tickerLines: [], sprites: null, palettes: null };
  const actors = new Map(); // slug -> {x, y, tx, ty, rng, frame, behavior}

  function lerp(a, b, t) { return a + (b - a) * t; }

  function speciesColor(species, level) {
    const pal = (state.palettes && state.palettes[species]) || [[180, 160, 255], [180, 160, 255], [180, 160, 255], [180, 160, 255]];
    const t = Math.min(1, Math.max(0, (level - 1) / 49)) * (pal.length - 1);
    const i = Math.min(pal.length - 2, Math.floor(t));
    const f = t - i;
    return [0, 1, 2].map((c) => Math.round(lerp(pal[i][c], pal[i + 1][c], f)));
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
    const skyTop = night ? '#0d0a20' : '#2a2150';
    const skyBottom = night ? '#151030' : '#3a2f6b';
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
        ctx.fillStyle = (col + row) % 2 ? (night ? '#4a4066' : '#5d5180') : (night ? '#443a60' : '#564a78');
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
    const active = now - c.last_seen_at < ACTIVE_WINDOW_MS;

    ctx.save();
    ctx.font = '11px Menlo, Consolas, monospace';
    ctx.textAlign = 'left';
    if (active) {
      ctx.shadowColor = `rgb(${r},${g},${b2})`;
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = `rgb(${r},${g},${b2})`;
    const w = Math.max(...lines.map((l) => l.length)) * 6.6;
    lines.forEach((line, i) => ctx.fillText(line, actor.x - w / 2, actor.y + i * 11 - lines.length * 11));
    ctx.restore();

    // owner avatar walks beside the buddy
    ctx.font = '14px serif';
    ctx.textAlign = 'center';
    const avatarIdx = (parseInt(String(c.avatar || 'chibi-1').replace(/\D/g, ''), 10) || 1) - 1;
    ctx.fillText(AVATARS[avatarIdx % AVATARS.length], actor.x + w / 2 + 12, actor.y - 4);

    // name tag, RO style: white with dark outline
    const label = `${c.name} · L${c.level}${c.shiny ? ' ✨' : ''}`;
    ctx.font = 'bold 10px Menlo, Consolas, monospace';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(label, actor.x, actor.y + 14);
    ctx.fillStyle = active ? '#ffffff' : '#a4a0b8';
    ctx.fillText(label, actor.x, actor.y + 14);

    // occasional behavior emote
    if ((performance.now() + actor.emoteAt) % 9000 < 1400) {
      ctx.font = '12px serif';
      ctx.fillText(BEHAVIORS[actor.behavior].emote, actor.x, actor.y - lines.length * 11 - 16);
    }
  }

  function drawCelebrations(now) {
    for (const cel of state.celebrations) {
      const actor = actors.get(cel.citizen_slug);
      if (!actor) continue;
      const age = (now - cel.ts) / 1000;
      ctx.textAlign = 'center';
      if (cel.type === 'level_up') {
        ctx.font = 'bold 13px Menlo, Consolas, monospace';
        ctx.fillStyle = '#ffd700';
        ctx.shadowColor = '#ff8c00';
        ctx.shadowBlur = 10;
        ctx.fillText('✧ LEVEL UP! ✧', actor.x, actor.y - 74 - (age % 3) * 4);
        ctx.font = '16px serif';
        ctx.fillText('🪽', actor.x, actor.y - 56);
        ctx.shadowBlur = 0;
      } else if (cel.type === 'deploy') {
        ctx.font = '15px serif';
        const burst = Math.floor(performance.now() / 400) % 3;
        ctx.fillText(['🎆', '🎇', '✨'][burst], actor.x + 18, actor.y - 66);
      } else if (cel.type === 'commit') {
        ctx.font = '12px serif';
        ctx.fillText('✨', actor.x - 16, actor.y - 60);
      } else if (cel.type === 'streak_7') {
        ctx.font = '14px serif';
        ctx.fillText('🎊', actor.x, actor.y - 66);
      }
    }
  }

  function tick() {
    const now = Date.now();
    drawGround();
    const sorted = [...state.citizens].sort((a, b3) => (actors.get(a.slug)?.y ?? 0) - (actors.get(b3.slug)?.y ?? 0));
    for (const c of sorted) {
      const actor = ensureActor(c);
      const speed = BEHAVIORS[actor.behavior].speed * 0.35;
      const dx = actor.tx - actor.x, dy = actor.ty - actor.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 3) {
        if (actor.rng() < 0.005) pickWaypoint(actor);
      } else {
        actor.x += (dx / dist) * speed;
        actor.y += (dy / dist) * speed;
      }
      if (Math.floor(performance.now() / 450) % 2 === 0) actor.frame++;
      drawCitizen(c, actor, now);
    }
    drawCelebrations(now);
    requestAnimationFrame(tick);
  }

  // ── data ───────────────────────────────────────────────────────────────
  const EVENT_LABEL = {
    level_up: 'leveled up! 🎉',
    deploy: 'deployed to prod 🚀',
    commit: 'shipped a commit',
    bug_fix: 'squashed a bug 🔧',
    streak_7: 'hit a 7-day streak 🎊',
    observe: 'is coding',
    session: 'got pets',
  };

  function updateTicker() {
    const nameBySlug = Object.fromEntries(state.citizens.map((c) => [c.slug, c.name]));
    state.tickerLines = state.events
      .slice(0, 6)
      .map((e) => `${nameBySlug[e.citizen_slug] || e.citizen_slug} ${EVENT_LABEL[e.type] || e.type}`);
    tickerEl.innerHTML =
      '<span class="brand">⛲ BUDDY WORLD · ' + district + '</span>' +
      state.tickerLines.map((l) => `<span class="line">${l}</span>`).join('');
  }

  async function refresh() {
    const res = await fetch(`${API_BASE}/v1/world/${district}`);
    if (!res.ok) return;
    const data = await res.json();
    state.citizens = data.citizens || [];
    state.events = data.events || [];
    const now = Date.now();
    state.celebrations = state.events.filter(
      (e) => now - e.ts < CELEBRATION_WINDOW_MS && e.type !== 'observe' && e.type !== 'session'
    );
    updateTicker();
    window.__PLAZA__ = state;
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

  boot();
})();
