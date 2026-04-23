#!/usr/bin/env node
// Generate animated GIFs for each species' sprite frames
// Run from buddy-source: node ../buddyReborn/sprites/generate-gifs.mjs

import puppeteer from 'puppeteer';
import GIFEncoder from 'gif-encoder-2';
import { PNG } from 'pngjs';
import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SPRITE_BODIES } from './dist/lib/species.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'buddyReborn', 'sprites');

const DEFAULT_EYE = '°';
const FRAME_DELAY = 500;

async function generateSpeciesGif(browser, species, frames) {
  const page = await browser.newPage();

  const renderedFrames = frames.map(frame =>
    frame.map(line => line.replace(/\{E\}/g, DEFAULT_EYE))
  );

  const maxLines = Math.max(...renderedFrames.map(f => f.length));
  const maxWidth = Math.max(...renderedFrames.flat().map(l => l.length));

  const charWidth = 10;
  const lineHeight = 22;
  const padding = 24;
  const vpWidth = Math.ceil(maxWidth * charWidth + padding * 2);
  const vpHeight = Math.ceil(maxLines * lineHeight + padding * 2);

  await page.setViewport({ width: vpWidth, height: vpHeight, deviceScaleFactor: 1 });

  const encoder = new GIFEncoder(vpWidth, vpHeight);
  encoder.setDelay(FRAME_DELAY);
  encoder.setRepeat(0);
  encoder.setQuality(10);

  const outputPath = join(OUTPUT_DIR, `${species.toLowerCase().replace(/ /g, '-')}.gif`);
  const stream = createWriteStream(outputPath);
  encoder.createReadStream().pipe(stream);
  encoder.start();

  for (const frame of renderedFrames) {
    const escapedFrame = frame.map(l =>
      l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    ).join('\n');

    const html = `<html><body style="margin:0;padding:${padding}px;background:#1a1a2e;display:flex;align-items:center;justify-content:center;min-height:${vpHeight - padding}px;">
      <pre style="font-family:'Cascadia Code','Fira Code','Consolas',monospace;font-size:16px;line-height:${lineHeight}px;color:#e0aaff;letter-spacing:1px;margin:0;white-space:pre;">${escapedFrame}</pre>
    </body></html>`;

    await page.setContent(html);
    await page.waitForSelector('pre');
    const screenshot = await page.screenshot({ type: 'png' });
    const png = PNG.sync.read(screenshot);
    encoder.addFrame(png.data);
  }

  encoder.finish();
  await page.close();

  await new Promise(resolve => stream.on('finish', resolve));
  console.log(`  ✓ ${species} (${frames.length} frames)`);
}

async function main() {
  console.log('Generating species GIFs...\n');

  const browser = await puppeteer.launch({ headless: true });
  const species = Object.keys(SPRITE_BODIES);

  for (const s of species) {
    await generateSpeciesGif(browser, s, SPRITE_BODIES[s]);
  }

  await browser.close();
  console.log(`\nDone! ${species.length} GIFs in ${OUTPUT_DIR}`);
}

main().catch(console.error);
