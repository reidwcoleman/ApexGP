// Pit building / main straight views relative to the pit side (PORT, TIME, WX, SUF env). node tools/_bldg.mjs <out> <track> [views,comma]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track, which] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5191}/?track=${track}&demo=race&skip=20&weather=${process.env.WX ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}&settle=500`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.evaluate(() => { document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none')); const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); });
// [name, ds, lat(+ = pit side), h, lookDs, lookLat, lookH, fov]
const V = {
  straight: [-160, -3, 1.1, 40, 30, 7, 58],
  across: [20, -28, 7, 20, 36, 9, 55],
  tvlong: [-420, -14, 10, 40, 30, 9, 22],
  stand: [30, 32, 13, 30, -45, 7, 58],
  standlong: [-200, 20, 8, 30, -40, 6, 35],
  pitlane: [-120, 15, 1.4, 60, 24, 4, 60],
  tower: [120, -30, 6, 220, 35, 18, 55],
  paddock: [-60, 56, 2, 40, 60, 5, 62],
  exit: [380, -4, 1.2, 150, 25, 7, 55],
  // anchored to the pit plan: 9th element = tower | b0 | b1 | mid
  towerclose: [-45, -12, 22, 0, 25, 24, 45, 'tower'],
  end0: [-70, 4, 9, 0, 30, 10, 50, 'b0'],
  end1: [70, 4, 9, 0, 30, 10, 50, 'b1'],
  paddockhi: [-120, 160, 40, 0, 70, 2, 50, 'mid'],
  roofhi: [-140, -80, 45, 0, 40, 8, 45, 'mid'],
  rear: [-50, 56, 2.5, 10, 47, 9, 62, 'mid'],
};
const names = which ? which.split(',') : Object.keys(V);
for (const name of names) {
  const v = V[name];
  await page.evaluate(([ds, lat, h, lds, ll, lh, fov, anchor]) => {
    const g = window.__game; const side = g.track.pit.side; const L = g.track.length;
    const pit = g.track.pit, bld = pit.building;
    const mid = bld ? bld[0] + ((bld[1] - bld[0]) * 240) / 498 : (pit.sStart + pit.sEnd) / 2;
    const A = { tower: bld ? bld[1] - 52 : mid + 206, b0: bld ? bld[0] : mid - 240, b1: bld ? bld[1] : mid + 258, mid };
    const st = anchor ? A[anchor] : g.track.startS;
    const S = (d) => (((st + d) % L) + L) % L;
    g.freeCam = { pos: g.trackPoint(S(ds), lat * side, h), look: g.trackPoint(S(lds), ll * side, lh), fov };
  }, v);
  await page.waitForTimeout(Number(process.env.WAIT ?? 1800));
  await page.screenshot({ path: `${out}/${track}_${name}${process.env.SUF ?? ''}.jpg`, quality: 88 });
}
console.log('done', track);
await browser.close();
