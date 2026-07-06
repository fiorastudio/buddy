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



  it('has a warp portal to the next RO town (RO navigation)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    const warp = (await page.evaluate(`(() => {
      const el = document.querySelector('#warp');
      return { exists: !!el, label: el?.getAttribute('aria-label') || '', href: el?.getAttribute('href') || el?.dataset.district || '' };
    })()`)) as { exists: boolean; label: string; href: string };
    expect(warp.exists).toBe(true);
    expect(warp.label.toLowerCase()).toMatch(/warp|travel|payon/);
    expect(warp.href).toContain('plaza-2'); // next district
  }, 60_000);

  it('click-to-pet spawns a heart emote on a buddy (RO /heart)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');
    await page.evaluate(`window.__PLAZA__.petBuddy('buddy-3')`);
    const bubble = (await page.evaluate(`window.__PLAZA__.bubbles['buddy-3']`)) as { emote: string } | null;
    expect(bubble?.emote).toContain('♥');
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
    expect(ro.stalls).toBeGreaterThanOrEqual(1); // achievement vendor
    expect(ro.stallOwner).toBeTruthy();
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

  it('plays the RO OST only after explicit opt-in (no YouTube request before click)', async () => {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/?district=plaza-1`, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__PLAZA__ && window.__PLAZA__.citizens.length > 0');

    // Before opt-in: a labelled toggle exists, and NO YouTube iframe/request.
    const before = (await page.evaluate(`(() => ({
      hasButton: !!document.querySelector('#music-toggle'),
      label: document.querySelector('#music-toggle')?.getAttribute('aria-label') || '',
      iframes: document.querySelectorAll('iframe').length,
    }))()`)) as { hasButton: boolean; label: string; iframes: number };
    expect(before.hasButton).toBe(true);
    // Label names this town's RO theme (per-town music); still no iframe yet.
    expect(before.label.toLowerCase()).toContain('theme');
    expect(before.iframes).toBe(0);

    await page.click('#music-toggle');
    await page.waitForSelector('#music-player iframe', { timeout: 5000 });
    const opened = (await page.evaluate(`(() => {
      const p = document.getElementById('music-player');
      return {
        src: p.querySelector('iframe').getAttribute('src'),
        // ToS: the player must stay >=200x200 and visible while playing.
        visible: !p.hidden,
        w: p.querySelector('iframe').width,
        h: p.querySelector('iframe').height,
        // RO-blue jukebox chrome: a titled bar naming this town + a close (x).
        hasBar: !!p.querySelector('.jukebox-bar'),
        title: (p.querySelector('.jukebox-title')?.textContent || '').toLowerCase(),
        hasClose: !!document.getElementById('music-close'),
      };
    })()`)) as { src: string; visible: boolean; w: string; h: string; hasBar: boolean; title: string; hasClose: boolean };
    expect(opened.src).toContain('youtube-nocookie.com/embed');
    // Per-town single-video loop: THIS town's verified RO city theme id.
    expect(opened.src).toMatch(/embed\/[\w-]{6,}\?/);
    expect(opened.visible).toBe(true);
    expect(Number(opened.w)).toBeGreaterThanOrEqual(200);
    expect(Number(opened.h)).toBeGreaterThanOrEqual(200);
    expect(opened.hasBar).toBe(true);
    expect(opened.title).toContain('prontera');
    expect(opened.hasClose).toBe(true);

    // The panel's x button is the "put it away" gesture: collapse AND stop.
    await page.click('#music-close');
    const afterClose = (await page.evaluate(`document.querySelectorAll('iframe').length`)) as number;
    expect(afterClose).toBe(0);

    // Re-opening then clicking the toggle again also stops it.
    await page.click('#music-toggle');
    await page.waitForSelector('#music-player iframe', { timeout: 5000 });
    await page.click('#music-toggle');
    const afterToggle = (await page.evaluate(`document.querySelectorAll('iframe').length`)) as number;
    expect(afterToggle).toBe(0);
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
