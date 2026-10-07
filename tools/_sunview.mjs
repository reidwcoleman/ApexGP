// Per weather: a frame toward the sun (sky, shafts, glare) and away from it, with the race running.
//   node tools/_sunview.mjs <out> <track> <time> <weather,...>
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track = 'spa', time = 'afternoon', list = 'clear'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
for (const wx of list.split(',')) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&cam=chase&skip=40&weather=${wx}&time=${time}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
  await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); });
  for (const [name, sgn] of [['into', 1], ['away', -1]]) {
    await page.evaluate((sgn) => {
      const g = window.__game; const L = g.track.length;
      const s = (g.track.startS + 900) % L;
      const p = g.trackPoint(s, 0, 2.2);
      const sp = g.env.sun.position; const h = Math.hypot(sp.x, sp.z) || 1;
      g.freeCam = { pos: p, look: [p[0] + (sgn * sp.x / h) * 100, p[1] + 9, p[2] + (sgn * sp.z / h) * 100], fov: 62 };
    }, sgn);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${out}/${wx}_${name}.jpg`, quality: 85 });
  }
  await page.close();
}
await browser.close();
console.log('done');
