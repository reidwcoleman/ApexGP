// Boot each circuit at High (ground cover, grass, haze on) and print shader / page errors.
//   node tools/_errsweep2.mjs [tracks]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import { ALL_CIRCUITS } from '../src/world/Circuits.ts';
const list = process.argv[2] ? process.argv[2].split(',') : ALL_CIRCUITS.map((c) => c.id);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
for (const t of list) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  let n = 0;
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) { n++; if (n < 4) console.log(`  [${t}]`, m.text().slice(0, 300)); } });
  page.on('pageerror', (e) => { n++; console.log(`  [${t} pageerror]`, e.message); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${process.env.PORT ?? 5191}/?track=${t}&demo=race&cam=chase&skip=20&quality=high`, { timeout: 300000 });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.waitForTimeout(2500);
  console.log(t, n ? `${n} errors` : 'ok', `${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.close();
}
await browser.close();
