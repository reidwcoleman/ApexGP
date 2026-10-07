// 4 views (N/E/S/W) from a raised point over the circuit centre-ish. node tools/_ring.mjs <out> <track> [h] [fov]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track, h = '18', fov = '45'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5196/?track=${track}&demo=race&skip=20&weather=clear&time=afternoon&settle=500`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.evaluate(() => { document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none')); const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); });
for (const [k, [dx, dz]] of Object.entries({ n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] })) {
  await page.evaluate(([dx, dz, h, fov]) => { const g = window.__game; const p = g.trackPoint(g.track.startS + 300, 0, h); g.freeCam = { pos: p, look: [p[0] + dx * 1000, p[1] + 10, p[2] + dz * 1000], fov }; }, [dx, dz, Number(h), Number(fov)]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${track}_${k}.jpg`, quality: 85 });
}
await browser.close();
console.log('done', track);
