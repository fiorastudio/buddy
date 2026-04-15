#!/usr/bin/env node
// render-onboarding-gif.mjs — Generates two authentic onboarding demo GIFs:
//   1. buddy-rescue.gif   — rescue existing buddy path
//   2. buddy-hatch.gif    — hatch new buddy path
//
// Both share the observer (backseat + skillcoach) and pet scenes.
// Run from buddy-source/: node demo/render-onboarding-gif.mjs

import puppeteer from 'puppeteer';
import GIFEncoder from 'gif-encoder-2';
import { PNG } from 'pngjs';
import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Config ---
const W = 720, H = 480;
const FRAME_MS = 80;
const TYPE_MS = 40;
const LINE_MS = 60;
const HOLD_MS = 1200;
const SHORT_HOLD = 500;
const TRANSITION_MS = 300;

// --- Catppuccin Mocha palette ---
const C = {
  bg: '#1e1e2e', text: '#cdd6f4', green: '#a6e3a1', yellow: '#f9e2af',
  cyan: '#94e2d5', magenta: '#f5c2e7', dim: '#6c7086', red: '#f38ba8',
  surface: '#313244',
};

// --- Real Nuzzlecap data ---
const MUSHROOM_SPRITE = [
  ' .-o-OO-o-. ',
  '(__________)',
  '   |×  ×|   ',
  '   |____|   ',
];

const STATS = { DEBUGGING: 27, PATIENCE: 8, CHAOS: 30, WISDOM: 68, SNARK: 35 };

function statBar(name, value) {
  const totalBlocks = 8;
  const filled = (value / 100) * totalBlocks;
  const fullBlocks = Math.floor(filled);
  const remainder = filled - fullBlocks;
  const hasPartial = remainder >= 0.25 && fullBlocks < totalBlocks;
  const emptyBlocks = totalBlocks - fullBlocks - (hasPartial ? 1 : 0);
  const bar = '\u2588'.repeat(fullBlocks) + (hasPartial ? '\u2593' : '') + '\u2591'.repeat(emptyBlocks);
  return `${name.padEnd(10)} ${bar}   ${String(value).padStart(2)}`;
}

// --- HTML rendering ---
const STYLE = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:${C.bg}; font-family:'Cascadia Code','Fira Code','Courier New',monospace;
    font-size:13px; line-height:1.5; color:${C.text}; width:${W}px; height:${H}px; overflow:hidden; }
  .chrome { background:${C.surface}; height:32px; display:flex; align-items:center; padding:0 12px; gap:8px; }
  .dot { width:12px; height:12px; border-radius:50%; }
  .dot-r { background:#f38ba8; } .dot-y { background:#f9e2af; } .dot-g { background:#a6e3a1; }
  .title { color:${C.dim}; font-size:12px; margin-left:8px; }
  .terminal { padding:16px 20px; height:${H - 32}px; overflow:hidden; }
  pre { white-space:pre; margin:0; line-height:1.45; }
  .g { color:${C.green}; } .y { color:${C.yellow}; } .c { color:${C.cyan}; }
  .m { color:${C.magenta}; } .d { color:${C.dim}; } .r { color:${C.red}; }
  .t { color:${C.text}; } .b { font-weight:bold; }
  .cursor { background:${C.text}; color:${C.bg}; }
  .sel { color:${C.cyan}; font-weight:bold; } .unsel { color:${C.dim}; }
`;

function htmlPage(content) {
  return `<!DOCTYPE html><html><head><style>${STYLE}</style></head><body>
<div class="chrome"><div class="dot dot-r"></div><div class="dot dot-y"></div><div class="dot dot-g"></div>
<span class="title">Terminal \u2014 buddy</span></div>
<div class="terminal"><pre>${content}</pre></div></body></html>`;
}

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function span(cls, text) { return `<span class="${cls}">${esc(text)}</span>`; }

// --- Frame builder class ---
class FrameBuilder {
  constructor() { this.frames = []; }
  add(html, delay = FRAME_MS) { this.frames.push({ html, delay }); }
  hold(html, ms) { const n = Math.max(1, Math.round(ms / FRAME_MS)); for (let i = 0; i < n; i++) this.frames.push({ html, delay: FRAME_MS }); }
  blank(ms = TRANSITION_MS) { this.hold('', ms); }

  typing(prefix, cmd, before = '') {
    for (let i = 0; i <= cmd.length; i++) {
      const typed = esc(cmd.slice(0, i));
      const cursor = i < cmd.length ? '' : '<span class="cursor"> </span>';
      this.add(`${before}${prefix}${typed}${cursor}`, TYPE_MS);
    }
  }

  reveal(lines, before = '', delay = LINE_MS) {
    for (let i = 0; i < lines.length; i++) {
      this.add(before + lines.slice(0, i + 1).join('\n'), delay);
    }
  }
}

const prompt = span('g', '$ ');

// --- Shared scene builders ---

function buildCard() {
  const statBarLines = Object.entries(STATS).map(([n, v]) => statBar(n, v));
  const w = 44, inner = w - 4;
  const top = '.' + '_'.repeat(w - 2) + '.';
  const bot = "'" + '_'.repeat(w - 2) + "'";
  const empty = '| ' + ' '.repeat(inner) + ' |';
  const ln = (t) => '| ' + t.padEnd(inner) + ' |';

  const hLeft = '\u2605 COMMON', hRight = 'MUSHROOM';
  const header = ln(hLeft + ' '.repeat(Math.max(1, inner - hLeft.length - hRight.length)) + hRight);

  const bio = '"A thoughtful mushroom with deep architectural insight who decomposes complex problems into their constituent nutrients, despite the patience of a caffeinated squirrel."';
  const bioLines = [];
  let cur = '';
  for (const word of bio.split(' ')) {
    if (cur.length + word.length + 1 > inner - 2 && cur) { bioLines.push(ln(' ' + cur)); cur = word; }
    else { cur = cur ? `${cur} ${word}` : word; }
  }
  if (cur) bioLines.push(ln(' ' + cur));

  return [top, header, empty, ...MUSHROOM_SPRITE.map(l => ln(l)), empty, ln('Nuzzlecap'), empty,
    ...bioLines, empty, ...statBarLines.map(l => ln(l)), empty, ln('Lv.4 \u00b7 69/90 XP to next'), bot];
}

function buildBubbleMerged(bubbleText, eyeOverride) {
  const bW = 34, bInner = bW - 4;
  const bTop = '.' + '_'.repeat(bW - 2) + '.';
  const bBot = "'" + '_'.repeat(bW - 2) + "'";
  const bLn = (t) => '| ' + t.padEnd(bInner) + ' |';

  // Wrap text to bubble width
  const wrapped = [];
  let cur = '';
  for (const word of bubbleText.split(' ')) {
    if (cur.length + word.length + 1 > bInner && cur) { wrapped.push(bLn(cur)); cur = word; }
    else { cur = cur ? `${cur} ${word}` : word; }
  }
  if (cur) wrapped.push(bLn(cur));

  const bubble = [bTop, ...wrapped, bBot];
  const sprite = [' .-o-OO-o-. ', '(__________)', `   |${eyeOverride}  ${eyeOverride}|   `, '   |____|   '];

  const artStart = Math.max(0, Math.floor(bubble.length / 2) - Math.floor(sprite.length / 2));
  const total = Math.max(bubble.length, artStart + sprite.length + 1);
  const merged = [];

  for (let i = 0; i < total; i++) {
    const bp = i < bubble.length ? bubble[i].padEnd(bW) : ' '.repeat(bW);
    const ai = i - artStart;
    if (ai >= 0 && ai < sprite.length) {
      const sep = ai === 0 ? '  -  ' : '     ';
      merged.push(span('t', bp) + span('d', sep) + span('m', esc(sprite[ai])));
    } else if (ai === sprite.length) {
      merged.push(span('t', bp) + '       ' + span('c', 'Nuzzlecap'));
    } else {
      merged.push(span('t', bp));
    }
  }
  return merged;
}

function addObserverScenes(fb) {
  // --- Backseat ---
  fb.blank();
  const bCmd = 'buddy_observe "refactored the auth module" --mode backseat';
  fb.typing(prompt, bCmd);
  fb.hold(prompt + span('g', esc(bCmd)), SHORT_HOLD);

  const backseatMerged = buildBubbleMerged('*Nuzzlecap stares into the void*', '\u00b7');
  const bFull = prompt + span('g', esc(bCmd)) + '\n\n';
  fb.reveal(backseatMerged, bFull, LINE_MS);
  const bXp = '\n' + span('d', '   +5 XP \u00b7 Lv.4 [\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2591] 74/90 XP');
  const bDone = bFull + backseatMerged.join('\n') + bXp;
  fb.add(bDone, LINE_MS);
  fb.hold(bDone, HOLD_MS + 200);

  // --- Skillcoach ---
  fb.blank();
  const sCmd = 'buddy_observe "fixed a null pointer bug" --mode skillcoach';
  fb.typing(prompt, sCmd);
  fb.hold(prompt + span('g', esc(sCmd)), SHORT_HOLD);

  const skillMerged = buildBubbleMerged('Missing error handling there.', '\u00d7');
  const sFull = prompt + span('g', esc(sCmd)) + '\n\n';
  fb.reveal(skillMerged, sFull, LINE_MS);
  const sXp = '\n' + span('d', '   +5 XP \u00b7 Lv.4 [\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2591\u2591] 79/90 XP');
  const sDone = sFull + skillMerged.join('\n') + sXp;
  fb.add(sDone, LINE_MS);
  fb.hold(sDone, HOLD_MS + 200);
}

function addPetScene(fb) {
  fb.blank();
  const cmd = 'buddy_pet';
  fb.typing(prompt, cmd);
  fb.hold(prompt + span('g', esc(cmd)), SHORT_HOLD);

  const output = [
    span('r', '   \u2665    \u2665   '), span('r', '  \u2665  \u2665   \u2665  '), span('r', ' \u2665   \u2665  \u2665   '),
    ...MUSHROOM_SPRITE.map(l => span('m', esc(l))),
    '', span('c', 'Nuzzlecap: ') + span('d', '*spores of contentment*'),
  ];
  const full = prompt + span('g', esc(cmd)) + '\n\n';
  fb.reveal(output, full, LINE_MS);
  fb.hold(full + output.join('\n'), HOLD_MS + 200);
}

function addTagline(fb) {
  fb.blank();
  const lines = [
    span('g', '  Your buddy is persistent. Always here.'), '',
    ...MUSHROOM_SPRITE.map(l => span('m', '     ' + esc(l))), '',
    span('c', '     Nuzzlecap'), span('d', '   \u00b7 spreading spores'), '', '',
    span('t', '   Close the terminal. Restart.'), span('t', '   Update your CLI.'), '',
    span('g', '   Your buddy is still here. \uD83D\uDC3E'), '', '',
    span('d', '   Works with: Claude Code \u00b7 Cursor \u00b7 Windsurf'),
    span('d', '   Codex CLI \u00b7 Gemini CLI \u00b7 any MCP client'), '',
    span('y', '   curl -fsSL https://raw.githubusercontent.com/'),
    span('y', '     fiorastudio/buddy/master/install.sh | bash'),
  ];
  fb.reveal(lines, '', 80);
  fb.hold(lines.join('\n'), HOLD_MS + 400);
}

function addInstaller(fb) {
  const installCmd = 'curl -fsSL https://raw.githubusercontent.com/fiorastudio/buddy/master/install.sh | bash';
  fb.typing(prompt, installCmd);
  fb.hold(prompt + span('g', esc(installCmd)), SHORT_HOLD);

  const lines = [
    '', span('c', '  \uD83E\uDD5A Buddy MCP Server Installer'),
    span('c', '  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500'), '',
    span('d', '  Checking prerequisites...'),
    span('g', '  \u2713 Node.js v22.14.0'), span('g', '  \u2713 npm 10.9.2'), '',
    span('d', '  Installing @fiorastudio/buddy...'),
    span('g', '  \u2713 Installed to ~/.buddy/server'), '',
    span('d', '  Configuring MCP for detected CLIs...'),
    span('g', '  \u2713 Claude Code  ~/.claude.json'),
    span('g', '  \u2713 Cursor       ~/.cursor/mcp.json'), '',
  ];
  const after = prompt + span('g', esc(installCmd)) + '\n';
  fb.reveal(lines, after, LINE_MS);
  return after + lines.join('\n');
}

function addCardReveal(fb) {
  const cardLines = buildCard();
  fb.reveal(cardLines.map(l => span('t', l)), '', 60);
  const cardHtml = cardLines.map(l => span('t', l)).join('\n');
  fb.hold(cardHtml, HOLD_MS + 200);

  const footer = ['', span('c', 'Nuzzlecap is here \u00b7 it\'ll chime in as you code'),
    span('d', 'say its name to get its take \u00b7 /buddy pet \u00b7 /buddy off')];
  fb.reveal(footer, cardHtml + '\n', LINE_MS);
  fb.hold(cardHtml + '\n' + footer.join('\n'), HOLD_MS);
}

// =====================================================================
// GIF 1: HATCH PATH
// =====================================================================
function buildHatchFrames() {
  const fb = new FrameBuilder();
  const installed = addInstaller(fb);
  fb.hold(installed, SHORT_HOLD);

  // Wizard menu — no old buddy found
  const wiz = span('y', '  What would you like to do?');
  const menus = [
    [span('sel', '  > ') + span('b', 'Hatch new buddy'), span('unsel', '    Skip')],
    [span('unsel', '    Hatch new buddy'), span('sel', '  > ') + span('b', 'Skip')],
    [span('sel', '  > ') + span('b', 'Hatch new buddy'), span('unsel', '    Skip')],
  ];
  for (const m of menus) fb.hold(installed + '\n' + wiz + '\n\n' + m.join('\n'), 600);
  fb.hold(installed + '\n' + wiz + '\n\n' + menus[2].join('\n'), SHORT_HOLD);

  // Egg sequence
  fb.blank();
  const egg1 = [span('y', '\uD83E\uDD5A An egg appears...'), '',
    span('t', '       .--. '), span('t', '      /    \\'), span('t', '     |  ??  |'),
    span('t', '      \\    /'), span('t', "       '--' ")];
  fb.reveal(egg1, '', LINE_MS);
  fb.hold(egg1.join('\n'), SHORT_HOLD);

  const egg2extra = ['', span('y', '...something is moving!'), '',
    span('t', '        *   '), span('t', '       .--. '), span('t', '      / *  \\'),
    span('t', '     | \\??/ |'), span('t', '      \\  * /'), span('t', "       '--' ")];
  fb.reveal(egg2extra, egg1.join('\n') + '\n', LINE_MS);
  fb.hold(egg1.join('\n') + '\n' + egg2extra.join('\n'), SHORT_HOLD);

  fb.blank();
  const egg3 = [span('m', "...it's hatching!!"), '',
    span('t', '  * . * '), span('t', '   ,--. '), span('t', '  / /\\ \\'),
    span('t', ' | |??| |'), span('t', '  \\ \\/ /'), span('t', "   `--\u00b4 ")];
  fb.reveal(egg3, '', LINE_MS);
  fb.hold(egg3.join('\n'), SHORT_HOLD);

  fb.blank();
  const sparkle = [span('y', '\u2728 \u2728 \u2728'), '',
    span('y', '  \u00b7  \u2726  \u00b7 '), span('y', ' \u2726 \u00b7  \u00b7 \u2726 '),
    span('m', ' .-o-OO-o-. '), span('m', '(__________)'),
    span('m', '   |\u00d7  \u00d7|   '), span('m', '   |____|   '),
    span('y', ' \u2726 \u00b7  \u00b7 \u2726 '), span('y', '  \u00b7  \u2726  \u00b7 ')];
  fb.reveal(sparkle, '', 100);
  fb.hold(sparkle.join('\n'), HOLD_MS);
  fb.blank();

  addCardReveal(fb);
  addObserverScenes(fb);
  addPetScene(fb);
  addTagline(fb);
  return fb.frames;
}

// =====================================================================
// GIF 2: RESCUE PATH
// =====================================================================
function buildRescueFrames() {
  const fb = new FrameBuilder();
  const installed = addInstaller(fb);

  // Scanning for old buddy
  const scanLines = ['', span('y', '  Scanning for existing companions...'),
    span('g', '  \u2713 Found Nuzzlecap the Mushroom in ~/.claude.json'), ''];
  fb.reveal(scanLines, installed + '\n', LINE_MS);
  const afterScan = installed + '\n' + scanLines.join('\n');
  fb.hold(afterScan, SHORT_HOLD);

  // Wizard menu — old buddy found, rescue option first
  const wiz = span('y', '  What would you like to do?');
  const menus = [
    [span('sel', '  > ') + span('b', 'Rescue Nuzzlecap the Mushroom'), span('unsel', '    Hatch new buddy'), span('unsel', '    Skip')],
    [span('unsel', '    Rescue Nuzzlecap the Mushroom'), span('sel', '  > ') + span('b', 'Hatch new buddy'), span('unsel', '    Skip')],
    [span('sel', '  > ') + span('b', 'Rescue Nuzzlecap the Mushroom'), span('unsel', '    Hatch new buddy'), span('unsel', '    Skip')],
  ];
  for (const m of menus) fb.hold(afterScan + '\n' + wiz + '\n\n' + m.join('\n'), 600);
  fb.hold(afterScan + '\n' + wiz + '\n\n' + menus[2].join('\n'), SHORT_HOLD);

  // Rescue signal animation (from rescueAnimation in card.ts)
  fb.blank();
  const sig1 = [span('y', '\uD83D\uDCE1 Scanning for lost companions...'), '',
    span('t', '      .'), span('t', '    . | .'), span('t', '      |'),
    span('t', '   [SIGNAL]'), span('t', '      |'), span('d', '   ...scanning...')];
  fb.reveal(sig1, '', LINE_MS);
  fb.hold(sig1.join('\n'), HOLD_MS);

  const sig2 = [span('y', '...signal detected!'), '',
    span('t', '   )) . (('), span('t', '    ).|.(  '), span('t', '     |||   '),
    span('g', '  [FOUND!] '), span('t', '     |||   '), span('d', '  ...locked on...')];
  fb.blank(200);
  fb.reveal(sig2, '', LINE_MS);
  fb.hold(sig2.join('\n'), HOLD_MS);

  // Sparkle reveal
  fb.blank();
  const sparkle = [span('y', '\u2728 \u2728 \u2728'), '',
    span('y', '  \u00b7  \u2726  \u00b7 '), span('y', ' \u2726 \u00b7  \u00b7 \u2726 '),
    span('m', ' .-o-OO-o-. '), span('m', '(__________)'),
    span('m', '   |\u00d7  \u00d7|   '), span('m', '   |____|   '),
    span('y', ' \u2726 \u00b7  \u00b7 \u2726 '), span('y', '  \u00b7  \u2726  \u00b7 ')];
  fb.reveal(sparkle, '', 100);
  fb.hold(sparkle.join('\n'), HOLD_MS);
  fb.blank();

  addCardReveal(fb);

  // Rescue-specific footer before observer scenes
  fb.blank();
  const rescueMsg = [
    span('g', '  Nuzzlecap has been rescued! Welcome home.'),
    span('d', '  it\'ll chime in as you code'),
    span('d', '  say its name to get its take \u00b7 /buddy pet \u00b7 /buddy off'),
  ];
  fb.reveal(rescueMsg, '', LINE_MS);
  fb.hold(rescueMsg.join('\n'), HOLD_MS);

  addObserverScenes(fb);
  addPetScene(fb);
  addTagline(fb);
  return fb.frames;
}

// =====================================================================
// RENDER ENGINE
// =====================================================================
async function renderGif(frames, outputName) {
  // Deduplicate consecutive identical frames
  const merged = [];
  for (const f of frames) {
    const last = merged[merged.length - 1];
    if (last && last.html === f.html) last.delay += f.delay;
    else merged.push({ ...f });
  }

  console.log(`\n  ${outputName}: ${frames.length} raw -> ${merged.length} unique frames`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });

  const outputPath = join(__dirname, outputName);
  const ws = createWriteStream(outputPath);
  const encoder = new GIFEncoder(W, H);
  encoder.createReadStream().pipe(ws);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setQuality(10);

  let totalMs = 0;
  for (let i = 0; i < merged.length; i++) {
    const { html, delay } = merged[i];
    encoder.setDelay(delay);
    await page.setContent(htmlPage(html), { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 50));
    const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
    encoder.addFrame(PNG.sync.read(shot).data);
    totalMs += delay;
    if (i % 25 === 0 || i === merged.length - 1) {
      process.stdout.write(`\r  Frame ${i + 1}/${merged.length} (${(totalMs / 1000).toFixed(1)}s)`);
    }
  }

  encoder.finish();
  await browser.close();
  await new Promise(r => ws.on('finish', r));

  const mb = (ws.bytesWritten / (1024 * 1024)).toFixed(2);
  console.log(`\n  \u2705 ${outputName}: ${merged.length} frames, ${(totalMs / 1000).toFixed(1)}s, ${mb} MB`);
}

// --- Main ---
async function main() {
  console.log('Generating onboarding demo GIFs...');

  const mode = process.argv[2]; // --hatch, --rescue, or omit for both
  if (!mode || mode === '--hatch') {
    await renderGif(buildHatchFrames(), 'buddy-hatch.gif');
  }
  if (!mode || mode === '--rescue') {
    await renderGif(buildRescueFrames(), 'buddy-rescue.gif');
  }

  console.log('\nDone!');
}

main().catch(console.error);
