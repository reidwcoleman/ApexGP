// Frozen free-camera views. node tools/_spots.mjs <out> <track> '<json [[name, s, lat, h, lookS, lookLat, lookH, fov]]>'  (s may be "start+N")
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track, json] = process.argv.slice(2);
const views = JSON.parse(json);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5196}/?track=${track}&demo=race&skip=20&weather=${process.env.WX ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}&settle=500`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.evaluate(() => { document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none')); const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); });
for (const [name, s, lat, h, ls, ll, lh, fov = 60] of views) {
  await page.evaluate(([s, lat, h, ls, ll, lh, fov]) => {
    const g = window.__game; const st = g.track.startS; const L = g.track.length;
    const S = (v) => { const x = typeof v === 'string' ? st + Number(v.replace('start', '') || 0) : v; return ((x % L) + L) % L; };
    // a look of [x, y, z] (world) instead of a track point: pass ls as an array
    g.freeCam = { pos: Array.isArray(s) ? s : g.trackPoint(S(s), lat, h), look: Array.isArray(ls) ? ls : g.trackPoint(S(ls), ll, lh), fov };
  }, [s, lat, h, ls, ll, lh, fov]);
  await page.waitForTimeout(Number(process.env.WAIT ?? 1800));
  await page.screenshot({ path: `${out}/${track}_${name}.jpg`, quality: 88 });
}
console.log('done', track);
await browser.close();
