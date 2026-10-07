// Boot + circuit-switch timings (ms, per step). node tools/loadtime.mjs [track] [to,to2...]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', to = 'spa'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
if (process.env.LOG) page.on('console', (m) => { const t = m.text(); if (t.includes(process.env.LOG)) console.log(t.slice(0, 3000)); });
const t0 = Date.now();
await page.goto(`http://localhost:5191/?track=${track}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
console.log('page→ready', Date.now() - t0, 'ms');
console.log('boot', JSON.stringify(await page.evaluate(() => ({ total: window.__game.bootMs, steps: window.__game.bootSteps, world: window.__game.worldTimes, warm: window.__game.warmTimes }))));
for (const id of to.split(',')) {
  const r = await page.evaluate(async (id) => { const t = performance.now(); await window.__game.travelAsync(id); return { wall: Math.round(performance.now() - t), travel: window.__game.travelMs, world: window.__game.worldTimes }; }, id);
  console.log('travel', id, JSON.stringify(r));
}
await browser.close();
