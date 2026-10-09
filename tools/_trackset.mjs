// Every circuit at one time of day: a chase frame and a low trackside frame from a fixed spot
// (scenery: trees, verges, the background). node tools/_trackset.mjs <out> <tracks> [time=afternoon] [quality=ultra]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, list, time = 'afternoon', q = 'ultra'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const track of list.split(',')) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('[pageerror]', track, e.message));
  await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&cam=chase&skip=25&weather=clear&time=${time}&quality=${q}`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
  await page.evaluate((q) => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; if (g.gfx.qualityLevel !== q) g.gfx.setQuality(q); g.gfx.setDynamicScale(1); }, q);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${track}_chase.jpg`, quality: 85 });
  for (const [k, f, lat, h, la] of [['side', 0.35, 1, 2.2, -1], ['high', 0.62, 1, 14, -1]]) {
    await page.evaluate(({ f, lat, h, la }) => {
      const g = window.__game, t = g.track, s0 = (t.startS + t.length * f) % t.length;
      const hw = t.halfWidthAt(s0);
      const p = g.trackPoint(s0, lat * (hw + 4), h), l = g.trackPoint((s0 + 90) % t.length, la * hw * 0.3, 1);
      g.freeCam = { pos: p, look: l, fov: 55 };
    }, { f, lat, h, la });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${track}_${k}.jpg`, quality: 85 });
  }
  await page.close();
  console.log('done', track);
}
await browser.close();
