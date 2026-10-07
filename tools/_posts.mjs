// Close views of the first few marshal posts + the start gantry. node tools/_posts.mjs <out> <track>
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&skip=20&weather=${process.env.WX ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}&settle=500`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
const n = await page.evaluate(() => {
  document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none'));
  const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1);
  let m = null; g.scene.traverse((o) => { if (o.userData?.marshals) m = o.userData.marshals; });
  window.__posts = (m ?? []).filter((x) => x.lead);
  return window.__posts.length;
});
console.log('posts', n);
for (let k = 0; k < Math.min(3, n); k++) {
  await page.evaluate((k) => {
    const g = window.__game; const p = window.__posts[k * 3];
    // 7 m from the post toward the track and 5 m back up the road, eye height
    const c = g.trackPoint(p.s - 5, 0, 0);
    const dx = c[0] - p.pos.x, dz = c[2] - p.pos.z, d = Math.hypot(dx, dz) || 1;
    const back = g.trackPoint(p.s - 10, 0, 0);
    const bx = back[0] - c[0], bz = back[2] - c[2], bd = Math.hypot(bx, bz) || 1;
    const a = [p.pos.x + (dx / d) * 7 + (bx / bd) * 4, p.pos.y + 1.7, p.pos.z + (dz / d) * 7 + (bz / bd) * 4];
    g.freeCam = { pos: a, look: [p.pos.x, p.pos.y + 1.3, p.pos.z], fov: 55 };
  }, k);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${track}_post${k}.jpg`, quality: 88 });
}
await page.evaluate(() => { const g = window.__game; const st = g.track.startS; g.freeCam = { pos: g.trackPoint(st - 25, -3, 2), look: g.trackPoint(st + 6, 0, 7), fov: 55 }; });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/${track}_gantryclose.jpg`, quality: 88 });
await browser.close();
