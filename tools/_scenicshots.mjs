// Scenic circuits: a chase frame plus aerial and trackside views (freeCam) of each.
//   node tools/_scenicshots.mjs <out> <tracks> [time=afternoon] [quality=high] [views=all]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, list, time = 'afternoon', q = 'high', only = ''] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
// [name, s fraction, lateral (× side: + right), height, look s fraction offset, look lateral, look height, fov]
const VIEWS = [
  ['aerial', 0.02, -220, 160, 0.3, 0, 0, 60],
  ['high', 0.5, 300, 120, 0.1, 0, 0, 60],
  ['side', 0.35, 14, 2.2, 0.02, -2, 1, 55],
  ['out', 0.15, -10, 6, 0.0, -400, 10, 60],
  ['back', 0.7, -16, 4, 0.03, 0, 1, 55],
  ['seaL', 0.2, -480, 30, 0.0, 0, 5, 55],
  ['seaR', 0.1, 480, 30, 0.0, 0, 5, 55],
];
// hand-placed views per circuit, world coordinates: [name, px, py, pz, lx, ly, lz, fov]
const HERO = {
  serena: [['cliff', 420, -26, 260, -300, -10, 300, 55], ['lighthouse', 'riviera_lantern', -18, 70, 40, 0, -14, 50], ['switch', -760, 95, -760, 100, -10, 500, 60]],
  bergsee: [['lake', -60, 8, 120, -900, 80, 1100, 60], ['fromlake', -800, 20, 0, 600, 60, 0, 60], ['valley', 600, 220, 1700, 600, 300, -4000, 60], ['chapel', 'alpine_chapel', 40, 12, 30, 0, 8, 55]],
  redmesa: [['butte', -380, 8, -380, -760, 70, -1180, 55], ['wash', -1150, -12, 700, -480, -8, 1250, 60], ['plain', 0, 45, 1300, 2200, 90, -700, 60]],
};
for (const track of list.split(',')) {
  const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
  page.on('pageerror', (e) => console.log('[pageerror]', track, e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[error]', track, m.text().slice(0, 300)); });
  await page.goto(`http://localhost:${process.env.PORT ?? 5191}/?track=${track}&demo=race&cam=chase&skip=25&weather=${process.env.WX ?? 'clear'}&time=${time}&quality=${q}`, { timeout: 300000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready === true && !!window.__park, null, { timeout: 600000 });
  await page.evaluate((q) => { document.getElementById('ui').style.visibility = 'hidden'; const g = window.__game; g.adaptQuality = () => {}; if (g.gfx.qualityLevel !== q) g.gfx.setQuality(q); g.gfx.setDynamicScale(1); }, q);
  await page.waitForTimeout(3000);
  if (!only || only.includes('chase')) await page.screenshot({ path: `${out}/${track}_chase.jpg`, quality: 85 });
  for (const [k, f, lat, h, lf, llat, lh, fov] of VIEWS) {
    if (only && !only.includes(k)) continue;
    await page.evaluate(({ f, lat, h, lf, llat, lh, fov }) => {
      const g = window.__game, t = g.track, L = t.length;
      const s0 = (t.startS + L * f) % L;
      const p = g.trackPoint(s0, lat, h), l = g.trackPoint((s0 + L * lf) % L, llat, lh);
      g.freeCam = { pos: p, look: l, fov };
    }, { f, lat, h, lf, llat, lh, fov });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${track}_${k}.jpg`, quality: 85 });
  }
  for (const [k, px, py, pz, lx, ly, lz, fov] of HERO[track] ?? []) {
    if (only && !only.includes(k)) continue;
    await page.evaluate(({ px, py, pz, lx, ly, lz, fov }) => {
      const g = window.__game, m = window.__park.map;
      if (typeof px === 'string') {
        // an object by name: the camera offset (py, pz, lx) from it, looking at it (+ ly, lz)
        const o = g.scene.getObjectByName(px);
        if (!o) return;
        const c = { x: 0, y: 0, z: 0 };
        if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; c.x = (b.min.x + b.max.x) / 2; c.y = b.min.y; c.z = (b.min.z + b.max.z) / 2; }
        const wp = o.getWorldPosition ? o.position : { x: 0, y: 0, z: 0 };
        const X = px === 'riviera_lantern' ? o.position.x : c.x, Y = px === 'riviera_lantern' ? o.position.y : c.y, Z = px === 'riviera_lantern' ? o.position.z : c.z;
        g.freeCam = { pos: [X + py, Y + pz, Z + lx], look: [X, Y + ly, Z], fov };
        return;
      }
      const P = [px, py < 0 ? py : Math.max(m.height(px, pz), 0) + Math.max(py, 2), pz];
      const L = [lx, m.height(lx, lz) + ly, lz];
      g.freeCam = { pos: P, look: L, fov };
    }, { px, py, pz, lx, ly, lz, fov });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/${track}_${k}.jpg`, quality: 85 });
  }
  await page.close();
  console.log('done', track);
}
await browser.close();
