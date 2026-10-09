// One race, a frame from each camera at the same moments. node tools/_camset.mjs <out> <track> cam1,cam2,... [times=2]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track, list, times = '2'] = process.argv.slice(2);
const cams = list.split(',');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&cam=${cams[0]}&skip=${process.env.SKIP ?? 15}&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.evaluate((pr) => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); if (pr) Object.assign(g.cams.prefs, JSON.parse(pr)); }, process.env.PREFS ?? '');
for (let t = 0; t < Number(times); t++) {
  await page.waitForTimeout(3000);
  for (const cam of cams) {
    await page.evaluate((cam) => { window.__game.paused = true; window.__game.cams.set(cam); window.__game.paused = false; }, cam);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${cam}_${t}.jpg`, quality: 80 });
  }
}
await browser.close();
console.log('done');
