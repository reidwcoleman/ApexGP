// Frozen material close-ups in a live race (paused: no motion blur, no particles moving).
//   node tools/_matshots.mjs <outdir> <track> <weather> <time> [set=all]
// Views: the player's car and the car ahead from a few angles (car-local offsets), and the road
// (track points: racing line, kerb, verge, run-off) at near and broadcast distance. PORT env = dev server.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [out, track = 'monza', weather = 'clear', time = 'afternoon', set = 'all'] = process.argv.slice(2);
const CAR = [
  // name, [x right, y up, z forward] camera offset in car space, look offset, fov
  ['car34', [2.6, 0.9, 3.4], [0, 0.35, 0.4], 34],
  ['carRear', [-1.9, 1.0, -4.2], [0, 0.45, -0.6], 34],
  ['carSide', [3.2, 0.55, 0.2], [0, 0.4, 0.1], 40],
  ['tyre', [1.6, 0.42, 2.6], [0.75, 0.33, 1.75], 26],
  ['halo', [0.9, 1.35, 0.6], [0, 0.85, -0.2], 50],
  ['carTV', [16, 4.5, 26], [0, 0.4, 0], 9],
];
const ROAD = [
  // name, s, lat, h, lookS, lookLat, lookH, fov
  ['roadNear', 'start+120', 1.5, 1.4, 'start+128', 0.5, 0, 55],
  ['roadEdge', 'start+300', 3.5, 1.6, 'start+312', 6.5, 0, 55],
  ['roadLong', 'start+400', 0, 1.2, 'start+520', 0, 0, 40],
  ['roadBroad', 'start+600', -22, 9, 'start+640', 0, 0, 28],
];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('403')) console.log('[err]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5191}/?track=${track}&demo=race&cam=chase&skip=${process.env.SKIP ?? 40}&weather=${weather}&time=${time}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.waitForTimeout(2500);
await page.evaluate(() => { document.querySelectorAll('#ui, #menu, .hud').forEach((e) => (e.style.display = 'none')); const g = window.__game; g.adaptQuality = () => {}; g.gfx.setDynamicScale(1); g.pause(); document.querySelectorAll('#ui, #menu, .hud, .menu').forEach((e) => (e.style.display = 'none')); });
// WXSET='{"wetness":0.6,"rain":0,"dryLine":0.7}' overrides the (paused, frozen) weather state
if (process.env.WXSET) await page.evaluate((o) => Object.assign(window.__game.race.weatherState, o), JSON.parse(process.env.WXSET));
const wait = Number(process.env.WAIT ?? 1200);
if (set === 'all' || set === 'car') {
  for (const [name, off, look, fov] of CAR) {
    await page.evaluate(([off, look, fov]) => {
      const g = window.__game;
      const rig = g.rigs.get(g.race.player.entry);
      const r = rig.root;
      r.updateMatrixWorld(true);
      const p = r.localToWorld(r.position.clone().set(off[0], off[1], off[2]));
      const l = r.localToWorld(r.position.clone().set(look[0], look[1], look[2]));
      g.freeCam = { pos: [p.x, p.y, p.z], look: [l.x, l.y, l.z], fov };
    }, [off, look, fov]);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/${track}_${weather}_${time}_${name}.jpg`, quality: 90 });
  }
}
if (set === 'all' || set === 'road') {
  for (const [name, s, lat, h, ls, ll, lh, fov] of ROAD) {
    await page.evaluate(([s, lat, h, ls, ll, lh, fov]) => {
      const g = window.__game; const st = g.track.startS; const L = g.track.length;
      const S = (v) => { const x = typeof v === 'string' ? st + Number(v.replace('start', '') || 0) : v; return ((x % L) + L) % L; };
      g.freeCam = { pos: g.trackPoint(S(s), lat, h), look: g.trackPoint(S(ls), ll, lh), fov };
    }, [s, lat, h, ls, ll, lh, fov]);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/${track}_${weather}_${time}_${name}.jpg`, quality: 90 });
  }
}
if (set === 'all' || set === 'road' || set === 'glare') {
  // the road toward the sun (backlit glare) and away from it, from 1.3 m, the same spot every run
  for (const [name, sgn, fov] of [['glareInto', 1, 50], ['glareAway', -1, 50]]) {
    await page.evaluate(([sgn, fov]) => {
      const g = window.__game; const st = g.track.startS; const L = g.track.length;
      const p = g.trackPoint((st + 250) % L, 0, 1.3);
      const sp = g.env.sun.position; const h = Math.hypot(sp.x, sp.z) || 1;
      const ground = g.trackPoint((st + 250) % L, 0, 0)[1];
      g.freeCam = { pos: p, look: [p[0] + (sgn * sp.x / h) * 14, ground, p[2] + (sgn * sp.z / h) * 14], fov };
    }, [sgn, fov]);
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${out}/${track}_${weather}_${time}_${name}.jpg`, quality: 90 });
  }
}
console.log('done', track, weather, time);
await browser.close();
