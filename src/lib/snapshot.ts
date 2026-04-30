import puppeteer from 'puppeteer';
import { type Companion, RARITY_STARS } from '../lib/types.js';
import { renderShareHtml } from '../lib/share.js';
import { renderSprite } from '../lib/species.js';
import { join } from 'path';
import { writeFileSync } from 'fs';

export async function captureSnapshot(companion: Companion, outPath: string) {
  const browser = await puppeteer.launch({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  // Set viewport to card size plus padding
  await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 2 });

  let html = renderShareHtml(companion);
  
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
    await cardElement.screenshot({ path: outPath });
  } else {
    await page.screenshot({ path: outPath });
  }

  await browser.close();
}
