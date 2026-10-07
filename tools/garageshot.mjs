// Garage close-ups: the overview and each car part. node tools/garageshot.mjs [track] [spots=car,wheel,rearWing] [outdir]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', spots = 'car,cockpit,frontWing,wheel,sidepod,rearWing,floor', out = 'shots/garage'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
await page.evaluate(() => window.__game.menu['setTab']('race'));
await page.waitForTimeout(1500);
for (const sp of spots.split(',')) {
  await page.evaluate((sp) => (sp === 'car' ? window.__game['tourExit']() : window.__game['tourGo'](sp)), sp);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/${track}_${sp}.png` });
  console.log('saved', sp);
}
await browser.close();
