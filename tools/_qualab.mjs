// The same paused moment at two quality levels (and the frame time of each). node tools/_qualab.mjs <out> <track> [time] [cam] [a=ultra] [b=tuned]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track, time = 'afternoon', cam = 'chase', A = 'ultra', B = 'tuned'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&cam=${cam}&skip=25&weather=clear&time=${time}`, { timeout: 300000, waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 600000 });
await page.evaluate(() => { document.getElementById('ui').style.visibility = 'hidden'; window.__game.adaptQuality = () => {}; });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  // (a fixed lens over the first corner: the scenery the same in both shots, whatever the cars do)
  const g = window.__game, t = g.track, s0 = (t.startS + 260) % t.length;
  const p = g.trackPoint(s0, -2, 1.6), l = g.trackPoint((s0 + 120) % t.length, 3, 0.8);
  g.freeCam = { pos: p, look: l, fov: 50 };
});
for (const q of [A, B]) {
  await page.evaluate((q) => { const g = window.__game; g.gfx.setQuality(q); g.gfx.setDynamicScale(1); }, q);
  await page.waitForTimeout(4000);
  const ms = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => (++n < 60 ? requestAnimationFrame(f) : res((performance.now() - t0) / 60)); requestAnimationFrame(f); }));
  console.log(q, 'frame ms', ms.toFixed(1), 'scale', await page.evaluate(() => window.__game.gfx.renderScale));
  await page.screenshot({ path: `${out}/${q}.png` });
}
await browser.close();
