// Studio shots of a car from several angles (src/dev/car.html). node tools/carshots.mjs [team=rossa] [outdir=shots/car]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [team = 'rossa', out = 'shots/car'] = process.argv.slice(2);
const views = {
  front34: ['4.2,1.3,4.6', '0,0.45,0.3'],
  rear34: ['-4.2,1.5,-4.8', '0,0.5,-0.4'],
  side: ['6.2,0.8,0', '0,0.45,0'],
  top: ['2.2,5.5,1.2', '0,0.3,0'],
  low: ['2.6,0.35,3.6', '0,0.5,0.6'],
  nose: ['1.2,0.9,4.2', '0,0.35,1.8'],
};
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const [name, [cam, look]] of Object.entries(views)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:5191/src/dev/car.html?team=${team}&cam=${cam}&look=${look}&fov=35${process.env.Q ?? ""}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${team}_${name}.png` });
  await page.close();
}
await browser.close();
