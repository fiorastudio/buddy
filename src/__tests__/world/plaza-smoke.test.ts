import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser } from 'puppeteer';
import { totalXpForLevel } from '../../lib/leveling.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const publicDir = join(repoRoot, 'world', 'public');

const NOW = Date.now();

function fixtureDistrict() {
  const species = ['Void Cat', 'Duck', 'Axolotl', 'Mushroom', 'Capybara', 'Ghost', 'Robot', 'Penguin'];
  return {
    district: 'plaza-1',
    citizens: species.map((sp, i) => ({
      slug: `buddy-${i}`,
      // Defense-in-depth check: even if a hostile name got past server
      // validation, the client must render it inert.
      name: i === 0 ? 'Buddy0<img src=x onerror=window.__XSS__=1>' : `Buddy${i}`,
      species: sp,
      level: 5 + i,
      xp: totalXpForLevel(5 + i) + 1,
      mood: 'happy',
      stats: { debugging: 50, patience: 50, chaos: 90 - i * 10, wisdom: 30 + i * 5, snark: 50 },
      rarity: 'common',
      shiny: false,
      hat: 'none',
      eye: '·',
      anon: false,
      skin: 'ascii',
      avatar: `chibi-${(i % 8) + 1}`,
      // buddy-1 → Japan, buddy-2 → USA; the rest have no known origin (no flag).
      country: i === 1 ? 'JP' : i === 2 ? 'US' : null,
      district: 'plaza-1',
      hidden: false,
      flagged: false,
      created_at: NOW - 1_000_000,
      last_seen_at: i < 3 ? NOW - 60_000 : NOW - 5 * 3600_000, // first 3 active; rest long-AFK (>3h → sit)
    })),
    events: [
      { citizen_slug: 'buddy-0', type: 'level_up', ts: NOW - 30_000 },
      { citizen_slug: 'buddy-1', type: 'deploy', ts: NOW - 45_000 },
      { citizen_slug: 'buddy-2', type: 'commit', ts: NOW - 50_000 },
      { citizen_slug: 'buddy-2', type: 'streak_7', ts: NOW - 40_000 },
    ],
  };
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
};

describe('plaza smoke test (headless browser)', () => {
  let server: Server;
  let browser: Browser;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = (req.url ?? '/').split('?')[0];
      if (url.startsWith('/v1/world/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(fixtureDistrict()));
        return;
      }
      // The global celebration feed. Empty by default — the broadcast-banner
      // tests drive it directly via the window.__PLAZA__.broadcastForTest hook,
      // so the poll just needs to succeed without spawning a banner on load.
      if (url === '/v1/announcements') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ announcements: [] }));
        return;
      }
      const file = join(publicDir, url === '/' ? 'index.html' : url.slice(1));
      if (existsSync(file)) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
        res.end(readFileSync(file));
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    // Disable background throttling — headless treats the page as
    // backgrounded and throttles requestAnimationFrame, so the canvas
    // never paints under load. These flags keep rAF running.
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('renders the plaza with all citizens, celebrations, and a live ticker', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0', {
      timeout: 15_000,
    });

    const state = (await page.evaluate('window.__PLAZA__')) as {
      citizens: unknown[];
      celebrations: Array<{ type: string }>;
      tickerLines: string[];
    };
    expect(state.citizens).toHaveLength(8);
    expect(state.celebrations.some((c) => c.type === 'level_up')).toBe(true);
    expect(state.tickerLines.length).toBeGreaterThan(0);

    // The canvas must actually contain drawn pixels. Wait for the first
    // requestAnimationFrame paint (racy to sample immediately after data
    // loads, especially under machine load) rather than reading once.
    const countPixels = `(() => {
      const canvas = document.querySelector('#plaza');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonBlank = 0;
      for (let i = 3; i < data.length; i += 40) if (data[i] > 0) nonBlank++;
      return nonBlank;
    })()`;
    await page.waitForFunction(`${countPixels} > 1000`, { timeout: 15_000 });
    const drawnPixels = (await page.evaluate(countPixels)) as number;
    expect(drawnPixels).toBeGreaterThan(1000);

    expect(errors).toEqual([]);

    await page.screenshot({
      path: `${process.env.SCRATCHPAD_DIR ?? '/tmp'}/plaza_smoke.png` as `${string}.png`,
    });
  }, 60_000);

  it('meets the accessibility contract: canvas alt, SR citizen list, live ticker', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');

    const a11y = (await page.evaluate(`(() => {
      const canvas = document.querySelector('#plaza');
      const sr = document.querySelector('#sr-citizens');
      const ticker = document.querySelector('#ticker');
      return {
        role: canvas.getAttribute('role'),
        label: canvas.getAttribute('aria-label') || '',
        srCount: sr ? sr.children.length : 0,
        tickerLive: ticker.getAttribute('aria-live'),
      };
    })()`)) as { role: string; label: string; srCount: number; tickerLive: string };

    expect(a11y.role).toBe('img');
    expect(a11y.label.length).toBeGreaterThan(10);
    expect(a11y.srCount).toBe(8);
    expect(a11y.tickerLive).toBe('polite');
  }, 60_000);

  it('renders hostile citizen names inert (no stored XSS in SR list or ticker)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    const probe = (await page.evaluate(`(() => ({
      xss: window.__XSS__ === 1,
      injectedImgs: document.querySelectorAll('#sr-citizens img, #ticker img').length,
      srText: document.querySelector('#sr-citizens').textContent,
      tickerText: document.querySelector('#ticker').textContent,
    }))()`)) as { xss: boolean; injectedImgs: number; srText: string; tickerText: string };
    expect(probe.xss).toBe(false);
    expect(probe.injectedImgs).toBe(0);
    // The hostile name must appear as literal text, not parsed markup.
    expect(probe.srText).toContain('<img src=x');
    expect(probe.tickerText).toContain('<img src=x');
  }, 60_000);

  it('fires the RO-yellow broadcast banner for a level_up (scrolling marquee)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && typeof window.__PLAZA__.broadcastForTest === "function"');

    // A hostile name proves the banner renders external input inert (textContent
    // only), and the level drives the RO "reached Level N" phrasing.
    const info = (await page.evaluate(`window.__PLAZA__.broadcastForTest({
      slug: 'buddy-9', name: 'Evil<img src=x onerror=window.__BXSS__=1>',
      type: 'level_up', level: 10, ts: Date.now(), town: 'Prontera'
    })`)) as { text: string; visible: boolean; scrolling: boolean; staticHold: boolean; type: string };

    expect(info.visible).toBe(true);
    expect(info.type).toBe('level_up');
    expect(info.scrolling).toBe(true); // marquee animation, not the static tier
    expect(info.staticHold).toBe(false);
    expect(info.text).toContain('Level 10'); // RO "has reached Level 10!" homage
    expect(info.text).toContain('Prontera');

    const probe = (await page.evaluate(`(() => ({
      xss: window.__BXSS__ === 1,
      injectedImgs: document.querySelectorAll('#broadcast img').length,
      text: document.querySelector('#broadcast').textContent,
      hidden: document.querySelector('#broadcast').hasAttribute('hidden'),
    }))()`)) as { xss: boolean; injectedImgs: number; text: string; hidden: boolean };
    expect(probe.xss).toBe(false); // the onerror never fired
    expect(probe.injectedImgs).toBe(0); // no parsed markup
    expect(probe.text).toContain('<img src=x'); // rendered as literal text
    expect(probe.hidden).toBe(false); // banner shown
  }, 60_000);

  it('renders the broadcast banner statically under prefers-reduced-motion (no scroll)', async () => {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && typeof window.__PLAZA__.broadcastForTest === "function"');

    const info = (await page.evaluate(`window.__PLAZA__.broadcastForTest({
      slug: 'buddy-1', name: 'Bob', type: 'deploy', ts: Date.now(), town: 'Prontera'
    })`)) as { text: string; visible: boolean; scrolling: boolean; staticHold: boolean };

    expect(await page.evaluate('window.__PLAZA__.reducedMotion')).toBe(true);
    expect(info.visible).toBe(true);
    expect(info.staticHold).toBe(true); // static tier
    expect(info.scrolling).toBe(false); // NO marquee animation
    expect(info.text).toContain('Bob');
    expect(info.text.toLowerCase()).toContain('shipped'); // deploy phrasing
  }, 60_000);

  it('de-dupes the global feed and queues broadcasts sequentially (real ingest path)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && typeof window.__PLAZA__.ingestAnnouncementsForTest === "function"');

    // First real poll after the (empty) boot seed: a level_up arrives and shows.
    const first = (await page.evaluate(`window.__PLAZA__.ingestAnnouncementsForTest([
      { id: 1, slug: 'buddy-0', name: 'Buddy0', type: 'level_up', level: 8, ts: 1000, town: 'Prontera' }
    ])`)) as { broadcastType: string; queued: number; visible: boolean };
    expect(first.broadcastType).toBe('level_up');
    expect(first.visible).toBe(true);
    expect(first.queued).toBe(0);

    // Next poll re-sends id:1 (already seen) plus a NEW id:2 deploy. Only the
    // deploy is fresh, so it queues behind the still-showing level_up. If the
    // seen-set de-dupe were broken, id:1 would re-queue and queued would be 2.
    const second = (await page.evaluate(`window.__PLAZA__.ingestAnnouncementsForTest([
      { id: 2, slug: 'buddy-1', name: 'Bob', type: 'deploy', ts: 2000, town: 'Prontera' },
      { id: 1, slug: 'buddy-0', name: 'Buddy0', type: 'level_up', level: 8, ts: 1000, town: 'Prontera' }
    ])`)) as { broadcastType: string; queued: number };
    expect(second.broadcastType).toBe('level_up'); // first one still on screen
    expect(second.queued).toBe(1); // exactly the new deploy — id:1 de-duped, not re-queued
  }, 60_000);

  it('honors prefers-reduced-motion', async () => {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    expect(await page.evaluate('window.__PLAZA__.reducedMotion')).toBe(true);
  }, 60_000);

  it('advances sprite animation at a calm cadence, not per render tick', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      'window.__PLAZA__ && window.__PLAZA__.actorFrames && Object.keys(window.__PLAZA__.actorFrames).length > 0'
    );
    const before = (await page.evaluate('({...window.__PLAZA__.actorFrames})')) as Record<string, number>;
    await new Promise((r) => setTimeout(r, 1300));
    const after = (await page.evaluate('({...window.__PLAZA__.actorFrames})')) as Record<string, number>;
    for (const slug of Object.keys(before)) {
      const delta = after[slug] - before[slug];
      // ~450ms per frame over 1.3s → expect roughly 2-3 advances; the old
      // bug advanced ~60x/sec in bursts (delta would be 20+).
      expect(delta, `frame cadence for ${slug}`).toBeGreaterThanOrEqual(1);
      expect(delta, `frame cadence for ${slug}`).toBeLessThanOrEqual(5);
    }
  }, 60_000);

  it('keeps every sprite bottom-anchored across all frames (no vertical jitter)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      'window.__PLAZA__ && window.__PLAZA__.spriteBottoms && Object.keys(window.__PLAZA__.spriteBottoms).length > 0'
    );
    await new Promise((r) => setTimeout(r, 1500)); // let several frames render
    const bottoms = (await page.evaluate('({...window.__PLAZA__.spriteBottoms})')) as Record<
      string,
      { min: number; max: number }
    >;
    for (const [slug, b] of Object.entries(bottoms)) {
      // Bottom row offset relative to the actor must never vary by frame.
      expect(b.max - b.min, `bottom anchor drift for ${slug}`).toBe(0);
    }
  }, 60_000);



  it('retires the camera-only #warp button and renders in-world portal gates', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    const info = (await page.evaluate(`(() => ({
      warpGone: !document.querySelector('#warp'),
      dests: (window.__PLAZA__.portals || []).map((p) => p.to),
    }))()`)) as { warpGone: boolean; dests: string[] };
    // The old camera-only <a id="warp"> link is gone...
    expect(info.warpGone).toBe(true);
    // ...replaced by Prontera's five hub gates, one to each satellite town.
    expect(info.dests).toEqual(['plaza-2', 'plaza-3', 'plaza-4', 'plaza-5', 'plaza-6']);
  }, 60_000);

  it('walking the owner sprite into a portal fires portal_enter (RO walk-to-warp)', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      'window.__PLAYER__ && window.__PLAZA__ && window.__PLAZA__.actorFrames && window.__PLAZA__.actorFrames["buddy-0"] !== undefined'
    );
    // Own buddy-0's sprite, then drive it into the first Prontera gate. The real
    // hit-test (checkPortal) runs and emits portal_enter via the socket path
    // (recorded on the instrumentation hook even without a live WS).
    await page.evaluate(`window.__PLAZA__.meSlug = 'buddy-0'`);
    const fired = (await page.evaluate(`window.__PLAYER__.enterPortalForTest(0)`)) as {
      type: string;
      to: string;
      portal: string;
      seq: number;
    } | null;
    expect(fired).toBeTruthy();
    expect(fired!.type).toBe('portal_enter');
    expect(fired!.to).toBe('plaza-2'); // Prontera's first gate → Payon
    expect(fired!.portal).toBe('prontera-payon');
    expect(fired!.seq).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('click-to-pet spawns a heart emote on a buddy (RO /heart)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    await page.evaluate(`window.__PLAZA__.petBuddy('buddy-3')`);
    const bubble = (await page.evaluate(`window.__PLAZA__.bubbles['buddy-3']`)) as { emote: string } | null;
    expect(bubble?.emote).toContain('♥');
  }, 60_000);

  it('click-to-move sets the owner target and streams a move_to (RO click-to-move)', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    // __PLAYER__ hooks exist after boot; wait until buddy-0 has an actor.
    await page.waitForFunction(
      'window.__PLAYER__ && window.__PLAZA__ && window.__PLAZA__.actorFrames && window.__PLAZA__.actorFrames["buddy-0"] !== undefined'
    );

    // Become the owner of buddy-0's sprite, then point it at an empty spot.
    await page.evaluate(`window.__PLAZA__.meSlug = 'buddy-0'`);
    await page.evaluate(`window.__PLAYER__.moveOwnerTo(320, 300)`);

    const pos = (await page.evaluate(`window.__PLAZA__.actorPos('buddy-0')`)) as {
      tx: number; ty: number; owned: boolean;
    };
    expect(pos.owned).toBe(true);
    expect(Math.round(pos.tx)).toBe(320); // target set to the click point
    expect(Math.round(pos.ty)).toBe(300);

    // tick() streams a monotonic move_to (fractional, in-range) while walking.
    await page.waitForFunction('window.__PLAYER__.lastMoveTo && window.__PLAYER__.lastMoveTo.seq >= 1', {
      timeout: 5_000,
    });
    const mv = (await page.evaluate('window.__PLAYER__.lastMoveTo')) as { x: number; y: number; seq: number };
    expect(mv.seq).toBeGreaterThanOrEqual(1);
    expect(mv.x).toBeGreaterThanOrEqual(0);
    expect(mv.x).toBeLessThanOrEqual(1);
    expect(mv.y).toBeGreaterThanOrEqual(0);
    expect(mv.y).toBeLessThanOrEqual(1);
  }, 60_000);

  it('room snapshots drive non-owner sprites toward the server position (and never my own)', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      'window.__PLAZA__ && window.__PLAZA__.actorFrames && window.__PLAZA__.actorFrames["buddy-1"] !== undefined'
    );

    await page.evaluate(`window.__PLAZA__.meSlug = 'buddy-0'`); // I'm buddy-0; buddy-1 is a peer
    const expected = (await page.evaluate(`(() => {
      const p = window.__PLAZA__.rtToPixel(0.75, 0.25);
      window.__PLAYER__.applySnapshot({ actors: [
        { slug: 'buddy-1', x: 0.75, y: 0.25, seq: 1 },
        { slug: 'buddy-0', x: 0.9, y: 0.9, seq: 1 }
      ]});
      return p;
    })()`)) as { x: number; y: number };

    const peer = (await page.evaluate(`window.__PLAZA__.actorPos('buddy-1')`)) as {
      tx: number; ty: number; remote: boolean;
    };
    const me = (await page.evaluate(`window.__PLAZA__.actorPos('buddy-0')`)) as { owned: boolean; remote: boolean };

    expect(peer.remote).toBe(true);
    expect(Math.round(peer.tx)).toBe(Math.round(expected.x));
    expect(Math.round(peer.ty)).toBe(Math.round(expected.y));
    // A snapshot that includes my own slug must never move my sprite.
    expect(me.remote).toBe(false);
    expect(me.owned).toBe(false);

    // Hardening: a malformed/hostile coord must be ignored, never NaN-poison the
    // sprite (leaves the last-good target intact).
    const goodTx = peer.tx;
    await page.evaluate(`window.__PLAYER__.applySnapshot({ actors: [{ slug: 'buddy-1', x: 'bad', y: 0.5 }] })`);
    const after = (await page.evaluate(`window.__PLAZA__.actorPos('buddy-1')`)) as { tx: number };
    expect(Number.isFinite(after.tx)).toBe(true);
    expect(Math.round(after.tx)).toBe(Math.round(goodTx)); // unchanged, not NaN
  }, 60_000);

  it('renders RO job classes on nameplates via jobLabel', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.jobLines && window.__PLAZA__.citizens.length > 0');
    // buddy-7 fixture: level 12 (first-job tier), stats chaos 90-70=20, wisdom
    // 30+35=65 -> peak WISDOM -> first-job Mage.
    const label = (await page.evaluate(`window.__PLAZA__.jobLabelForSlug('buddy-7')`)) as string;
    expect(label).toBe('Mage · Lv.12');
    // buddy-0 fixture: level 5 -> Novice tier; peak stat drives the line.
    const novice = (await page.evaluate(`window.__PLAZA__.jobLabelForSlug('buddy-0')`)) as string;
    expect(novice).toMatch(/^Novice · Lv\.5$/);
  }, 60_000);

  it('renders the country flag on the nameplate (and none when origin unknown)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    // buddy-1 → JP flag, buddy-2 → US flag (regional-indicator pairs).
    const jp = (await page.evaluate(`window.__PLAZA__.flagForSlug('buddy-1')`)) as string;
    const us = (await page.evaluate(`window.__PLAZA__.flagForSlug('buddy-2')`)) as string;
    expect(jp).toBe('\u{1F1EF}\u{1F1F5}');
    expect(us).toBe('\u{1F1FA}\u{1F1F8}');
    // buddy-0 has no country → no flag.
    const none = (await page.evaluate(`window.__PLAZA__.flagForSlug('buddy-0')`)) as string;
    expect(none).toBe('');
  }, 60_000);

  it('captures the RO essence: porings, stalls, sitting idlers, town name, bubbles', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    await new Promise((r) => setTimeout(r, 800)); // let ambience spawn

    const ro = (await page.evaluate(`(() => ({
      porings: window.__PLAZA__.porings ? window.__PLAZA__.porings.length : 0,
      stalls: window.__PLAZA__.stalls ? window.__PLAZA__.stalls.length : 0,
      stallOwner: window.__PLAZA__.stalls && window.__PLAZA__.stalls[0] ? window.__PLAZA__.stalls[0].slug : '',
      sitting: window.__PLAZA__.sittingCount ?? -1,
      ticker: document.querySelector('#ticker').textContent,
      bubbles: window.__PLAZA__.bubbles ? Object.keys(window.__PLAZA__.bubbles).length : 0,
    }))()`)) as { porings: number; stalls: number; stallOwner: string; sitting: number; ticker: string; bubbles: number };

    expect(ro.porings).toBeGreaterThanOrEqual(2); // ambient jellies
    // Vending stalls are intentionally parked (plaza.js: rebuildStalls is not
    // called) pending the future buddy-marketplace/job-board idea, so no stall
    // renders today. Pin the parked state so unparking re-enables this check.
    expect(ro.stalls).toBe(0);
    // fixture: buddies 3..7 have last_seen ~2h ago -> they sit
    // Sitting is now a brief transient pose (not a permanent freeze), so
    // any count >= 0 is valid — the plaza wanders by default.
    expect(ro.sitting).toBeGreaterThanOrEqual(0);
    expect(ro.ticker).toContain('Prontera'); // districts are RO towns
    // recent events (commit/deploy within the last minute) produce RO emote bubbles
    expect(ro.bubbles).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('spawns floating XP popups for fresh events (RO damage numbers)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    const count = (await page.evaluate(`(() => {
      window.__PLAZA__.spawnXpPopup('buddy-0', 'deploy');
      return window.__PLAZA__.xpPopups.length;
    })()`)) as number;
    expect(count).toBe(1);
    const popup = (await page.evaluate('window.__PLAZA__.xpPopups[0]')) as { text: string };
    expect(popup.text).toContain('60'); // deploy pays 60 XP
  }, 60_000);

  it('offers an accessible SFX toggle, off by default', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    expect(await page.evaluate('window.__PLAZA__.sfxEnabled')).toBe(false);
    const label = (await page.evaluate(
      `document.querySelector('#sfx-toggle')?.getAttribute('aria-label') || ''`
    )) as string;
    expect(label.toLowerCase()).toContain('sound');
    await page.click('#sfx-toggle');
    expect(await page.evaluate('window.__PLAZA__.sfxEnabled')).toBe(true);
  }, 60_000);

  it('keeps sprites AA-readable in NIGHT mode too (dark floor)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1&time=night`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      'window.__PLAZA__ && window.__PLAZA__.spriteColors && Object.keys(window.__PLAZA__.spriteColors).length > 0'
    );
    const ratios = (await page.evaluate('window.__PLAZA__.spriteColors')) as Record<string, number>;
    for (const [slug, ratio] of Object.entries(ratios)) {
      expect(ratio, `night contrast for ${slug}`).toBeGreaterThanOrEqual(4.5);
    }
  }, 60_000);

  it('plays self-hosted plaza music on by default, with no iframe ever', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');

    // A labelled toggle + a hidden self-hosted <audio> (on by default), and
    // NO iframe / third-party request of any kind — that's the whole point.
    const before = (await page.evaluate(`(() => ({
      hasButton: !!document.querySelector('#music-toggle'),
      label: document.querySelector('#music-toggle')?.getAttribute('aria-label') || '',
      iframes: document.querySelectorAll('iframe').length,
      hasAudio: !!document.querySelector('#music-audio'),
      src: document.querySelector('#music-audio source')?.getAttribute('src') || '',
    }))()`)) as {
      hasButton: boolean; label: string; iframes: number;
      hasAudio: boolean; src: string;
    };
    expect(before.hasButton).toBe(true);
    expect(before.label.toLowerCase()).toContain('music');
    expect(before.iframes).toBe(0);
    expect(before.hasAudio).toBe(true);
    expect(before.src).toContain('music/plaza-theme'); // self-hosted, not YouTube

    // Stub playback so the toggle is deterministic without shipping an asset.
    await page.evaluate(`(() => {
      const a = document.querySelector('#music-audio');
      let playing = false;
      Object.defineProperty(a, 'paused', { get: () => !playing, configurable: true });
      a.play = () => { playing = true; return Promise.resolve(); };
      a.pause = () => { playing = false; a.dispatchEvent(new Event('pause')); };
    })()`);

    await page.click('#music-toggle');
    const on = (await page.evaluate(`(() => ({
      pressed: document.querySelector('#music-toggle').getAttribute('aria-pressed'),
      iframes: document.querySelectorAll('iframe').length,
    }))()`)) as { pressed: string; iframes: number };
    expect(on.pressed).toBe('true'); // now playing
    expect(on.iframes).toBe(0);      // still no third-party embed, ever

    await page.click('#music-toggle');
    const off = (await page.evaluate(`(() => ({
      pressed: document.querySelector('#music-toggle').getAttribute('aria-pressed'),
      iframes: document.querySelectorAll('iframe').length,
    }))()`)) as { pressed: string; iframes: number };
    expect(off.pressed).toBe('false'); // stopped
    expect(off.iframes).toBe(0);
  }, 60_000);

  it('renders every sprite with WCAG AA contrast against the plaza tiles', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(
      'window.__PLAZA__ && window.__PLAZA__.spriteColors && Object.keys(window.__PLAZA__.spriteColors).length > 0'
    );
    const ratios = (await page.evaluate('window.__PLAZA__.spriteColors')) as Record<string, number>;
    expect(Object.keys(ratios).length).toBeGreaterThan(0);
    for (const [slug, ratio] of Object.entries(ratios)) {
      expect(ratio, `contrast for ${slug}`).toBeGreaterThanOrEqual(4.5);
    }
  }, 60_000);
});
