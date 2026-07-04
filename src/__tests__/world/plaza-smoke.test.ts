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
      name: `Buddy${i}`,
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
      last_seen_at: i < 3 ? NOW - 60_000 : NOW - 7_200_000, // first 3 recently active
    })),
    events: [
      { citizen_slug: 'buddy-0', type: 'level_up', ts: NOW - 30_000 },
      { citizen_slug: 'buddy-1', type: 'deploy', ts: NOW - 45_000 },
      { citizen_slug: 'buddy-2', type: 'commit', ts: NOW - 50_000 },
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
    browser = await puppeteer.launch({ headless: true });
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

    // The canvas must actually contain drawn pixels, not just exist.
    const drawnPixels = await page.evaluate(`(() => {
      const canvas = document.querySelector('#plaza');
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonBlank = 0;
      for (let i = 3; i < data.length; i += 40) if (data[i] > 0) nonBlank++;
      return nonBlank;
    })()`);
    expect(drawnPixels as number).toBeGreaterThan(1000);

    expect(errors).toEqual([]);

    await page.screenshot({
      path: `${process.env.SCRATCHPAD_DIR ?? '/tmp'}/plaza_smoke.png` as `${string}.png`,
    });
  }, 60_000);
});
