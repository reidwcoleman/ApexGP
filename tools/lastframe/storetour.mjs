// Round Halden's Hypermarket, first person, nobody about:  node tools/lastframe/storetour.mjs PORT OUT [stop names]
// Stops are in game axes: x east, y up, z = -north. LIGHT=0 turns the weapon light off for the round
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, ...only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=store`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(1500);
if (process.env.LIGHT === '0') await p.evaluate(() => { __lf.g.me.light = false; });
console.log('nav', await p.evaluate(() => { const n = __lf.g.nav.nodes; return JSON.stringify({ all: n.length, under: n.filter((q) => q.y < -3).length, ground: n.filter((q) => Math.abs(q.y) < 0.3).length, up: n.filter((q) => Math.abs(q.y - 3.6) < 0.3).length, lamps: __lf.g.L.flicks.length }); }));
const stops = [
  ['front', 30, 0, -1.5, 0, 0.05], ['tills', 14.8, 0, -9.2, -1.57, 0], ['aisle', 22, 0, -10.4, 0, 0.05], ['aisle_e', 38, 0, -10.4, 0, 0.05], ['cross', 15, 0, -18.2, -1.57, 0], ['ring', 30, 0, -17.6, 0, 0],
  ['shelf', 21.4, 0, -15.5, 1.57, 0], ['shelf2', 34.6, 0, -13, -1.57, 0], ['shelf_far', 18, 0, -11.5, 0.15, 0],
  ['ring_n', 34.6, 0, -26.6, 2.5, 0], ['produce', 8, 0, -9.4, 0.2, 0], ['frozen', 54.2, 0, -10.2, 0, 0], ['frozen_lit', 57.7, 0, -19.4, -0.3, 0], ['counters', 14, 0, -26.9, -1.57, 0], ['meatsign', 26.5, 0, -25.9, 0, 0.1],
  ['catwalk', 1, 3.6, -10, 0, -0.2], ['catwalk_view', 1, 3.6, -17, -1.3, -0.3], ['office', 9, 3.6, -4, 0.5, 0], ['office_win', 8, 3.6, -6.6, -0.6, -0.3], ['pharm', 9, 0, -4.6, 1.0, 0], ['cafe', 50, 0, -5.5, -0.6, 0],
  ['backcor', 2, 0, -31.3, -1.57, 0], ['kitchen', 5, 0, -34, 0.3, 0], ['meat', 15, 0, -33.6, 0, 0], ['meat_in', 19.6, 0, -40, 1.2, 0], ['freezer', 25.6, 0, -33.6, 0, 0], ['stock', 32, 0, -31.5, -0.9, 0.1],
  ['stock_aisle', 33, 0, -37, -1.57, 0.1], ['dock', 47, 0, -41, -1.2, 0], ['loft', 3, 3.6, -32, -1.0, 0], ['loft_bed', 19, 3.6, -38, -1.4, -0.1], ['gantry', 29, 3.6, -36, -1.57, -0.3],
];
for (const [n, x, y, z, yaw, pitch] of stops) {
  if (only.length && !only.includes(n)) continue;
  await p.evaluate(([x, y, z, yaw, pitch]) => { const g = __lf.g; Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [x, y, z, yaw, pitch]);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${n}.png` });
}
console.log(await p.evaluate(() => JSON.stringify({ ms: __lf.g.frameMs ?? null })));
await b.close();
