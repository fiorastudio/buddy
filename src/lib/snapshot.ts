import puppeteer from 'puppeteer';
import { type Companion } from './types.js';
import { renderShareHtml, type ShareDelta } from './share.js';
import { renderSprite } from './species.js';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function captureSnapshot(companion: Companion, outPath: string, message?: string, delta?: ShareDelta) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 600, height: 900, deviceScaleFactor: 2 });

    let html = renderShareHtml(companion, message, delta);

    const spriteLines = renderSprite(companion);
    const spriteHtml = escapeHtml(spriteLines.join('\n'));
    html = html.replace('RENDER_SPRITE_HERE', spriteHtml);

    await page.setContent(html);
    await page.evaluateHandle(() => document.fonts.ready);

    await page.screenshot({ path: outPath, fullPage: false });
  } finally {
    await browser.close();
  }
}
