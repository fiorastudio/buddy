import puppeteer from 'puppeteer';
import { type Companion } from '../lib/types.js';
import { renderShareHtml, escapeHtml, SPRITE_PLACEHOLDER } from '../lib/share.js';
import { renderSprite } from '../lib/species.js';

export async function captureSnapshot(companion: Companion, outPath: string) {
  const isRoot = process.getuid?.() === 0;
  const args = isRoot ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];

  const browser = await puppeteer.launch({ 
    headless: true,
    args
  });
  
  try {
    const page = await browser.newPage();
    
    // Set viewport to card size plus padding
    await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 2 });

    let html = renderShareHtml(companion);
    
    // Inject the actual sprite
    const spriteLines = renderSprite(companion);
    const spriteHtml = escapeHtml(spriteLines.join('\n'));
      
    html = html.replace(SPRITE_PLACEHOLDER, spriteHtml);

    // Add timeouts to prevent hanging
    await page.setContent(html, { timeout: 8000 });
    
    // Wait for font/styles to settle
    await new Promise(r => setTimeout(r, 100));

    const cardElement = await page.$('.card');
    if (cardElement) {
      await cardElement.screenshot({ path: outPath });
    } else {
      await page.screenshot({ path: outPath });
    }
  } finally {
    await browser.close();
  }
}
