// Every partner's creatives at a circuit on one sheet. node tools/_adsheet.mjs <out.png> [track=monza] [w=512] [h=128]
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track = 'monza', W = '512', H = '128'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE] });
const page = await browser.newPage();
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/tools/blank.html`).catch(() => {});
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/`, { waitUntil: 'domcontentloaded' });
const url = await page.evaluate(async ({ track, W, H }) => {
  const P = await import('/src/world/partners.ts');
  const C = await import('/src/world/adCreative.ts');
  const B = await import('/src/world/brands.ts');
  await Promise.all(B.BRAND_FONTS.map((f) => document.fonts.load(f)));
  const R = P.rosterFor(track);
  const w = +W, h = +H, gap = 8;
  const cv = document.createElement('canvas');
  cv.width = (w + gap) * 3;
  cv.height = (h + gap) * R.brands.length;
  const g = cv.getContext('2d');
  g.fillStyle = '#444';
  g.fillRect(0, 0, cv.width, cv.height);
  R.brands.forEach((b, i) => { for (let k = 0; k < 3; k++) C.drawCreative(g, k * (w + gap), i * (h + gap), w, h, b, k); });
  return cv.toDataURL('image/png');
}, { track, W, H });
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
console.log('done');
