import puppeteer from 'puppeteer';
import { type Companion, RARITY_STARS } from '../lib/types.js';
import { renderShareHtml, type ShareDelta } from '../lib/share.js';
import { renderSprite } from '../lib/species.js';
import { join } from 'path';
import { writeFileSync } from 'fs';

export async function captureSnapshot(companion: Companion, outPath: string, message?: string, delta?: ShareDelta) {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // Set viewport to card size plus padding (increased height to ensure bottom isn't cut)
  await page.setViewport({ width: 600, height: 900, deviceScaleFactor: 2 });

  let html = renderShareHtml(companion, message, delta);
  
  // Inject the actual sprite
  const spriteLines = renderSprite(companion);
  const spriteHtml = spriteLines.join('\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
    
  html = html.replace('RENDER_SPRITE_HERE', spriteHtml);

  await page.setContent(html);
  
  // Wait for font/styles to settle
  await new Promise(r => setTimeout(r, 100));

  const cardElement = await page.$('.card');
  if (cardElement) {
    // If bubble is present, we need a larger bounding box or just screenshot the page
    const bubble = await page.$('.bubble-container');
    if (bubble) {
      await page.screenshot({ path: outPath, fullPage: false });
    } else {
      await cardElement.screenshot({ path: outPath });
    }
  } else {
    await page.screenshot({ path: outPath });
  }

  await browser.close();
}

