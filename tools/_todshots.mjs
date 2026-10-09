// One frame per time of day (chase + a wide TV angle). node tools/_todshots.mjs <out> <track> [times] [quality=ultra]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track, times = 'dawn,morning,midday,afternoon,golden,sunset,dusk,night', q = 'ultra'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
await Promise.all(times.split(',').map(async (time) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', time, e.message));
  await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&cam=chase&skip=${process.env.SKIP ?? 30}&weather=${process.env.WX ?? 'clear'}&time=${time}&quality=${q}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.evaluate((q) => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; if (g.gfx.qualityLevel !== q) g.gfx.setQuality(q); g.gfx.setDynamicScale(1); }, q);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/${time}_chase.jpg`, quality: 85 });
  await page.evaluate(() => window.__game.cams.set('tv'));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${time}_tv.jpg`, quality: 85 });
  await page.close();
}));
await browser.close();
console.log('done');
