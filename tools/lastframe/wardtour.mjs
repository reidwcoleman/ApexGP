// Round Ashgrove Ward, first person, nobody about:  node tools/lastframe/wardtour.mjs PORT OUT [stop names]
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
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=ward`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(1500);
if (process.env.LIGHT === '0') await p.evaluate(() => { __lf.g.me.light = false; });
console.log('nav', await p.evaluate(() => { const n = __lf.g.nav.nodes; return JSON.stringify({ all: n.length, under: n.filter((q) => q.y < -3).length, ground: n.filter((q) => Math.abs(q.y) < 0.3).length, up: n.filter((q) => Math.abs(q.y - 3.6) < 0.3).length, lamps: __lf.g.L.flicks.length }); }));
const stops = [
  ['lobby', 26, 0, -4.9, 0, 0.05], ['lobby_in', 26, 0, -1.2, 0.5, 0.05], ['scor_e', 4, 0, -7.3, -1.57, 0], ['scor_w', 48, 0, -7.3, 1.57, 0], ['atrium_sw', 17.2, 0, -10.6, -0.95, 0.12],
  ['atrium_n', 23, 0, -22.2, 2.6, 0.15], ['atrium_e', 35.6, 0, -16, 1.57, 0.1], ['gallery_s', 22, 3.6, -9.4, -0.25, -0.2], ['gallery_ne', 35, 3.6, -23.8, 1.9, -0.15], ['ramp', 30, 0, -14.6, 0, 0.25],
  ['warda', 16.5, 0, -4.6, 1.4, 0], ['triage', 35.2, 0, -4.4, -1.4, 0], ['nurse', 11, 0, -14.6, 3.14, 0], ['exam', 3.6, 0, -9.6, 0, 0], ['staff', 3.6, 0, -22.4, 2.6, 0], ['xray', 13.8, 0, -17, 0.7, 0],
  ['pharm', 43, 0, -14.8, 2.4, 0], ['lab', 45.4, 0, -9.6, -0.8, 0], ['theatre', 38, 0, -22.4, -1.1, 0.05], ['scrub', 47, 0, -17, -0.9, 0], ['ncor_e', 4, 0, -24.7, -1.57, 0], ['ncor_w', 48, 0, -24.7, 1.57, 0],
  ['kitchen', 4.5, 0, -27, 0, 0], ['canteen', 14.5, 0, -27, 0, 0], ['chapel', 26, 0, -26.8, 0, 0.12], ['chapel_up', 22.5, 3.6, -25.4, -0.3, -0.35], ['morgue', 33.2, 0, -31, -1.3, 0], ['plant', 44, 0, -27.2, -0.7, 0],
  ['stair_w', 2.4, 0, -6.6, 2.9, 0.1], ['stair_e_up', 47.6, 3.6, -5.0, 3.6, -0.3], ['longward', 7.5, 3.6, -9.6, 0, 0], ['longward_n', 7.5, 3.6, -22.6, 3.14, 0], ['children', 38.6, 3.6, -9.6, -0.5, 0],
  ['iso', 43.6, 3.6, -17, 0.9, -0.1], ['records', 34.8, 3.6, -5, 1.4, 0], ['office', 25, 3.6, -5, 1.3, 0], ['dorm', 11, 3.6, -27, -0.4, 0], ['ward_n', 42, 3.6, -27, 0.9, 0],
  ['tunnel_e', 6, -3.4, -7.3, -1.57, 0], ['tunnel_w', 46, -3.4, -7.3, 1.57, 0], ['boiler', 13.6, -3.4, -9.6, 0.8, 0], ['cold', 28.6, -3.4, -9.6, 0.9, 0], ['flood', 39.6, -3.4, -9.4, -0.6, 0],
  ['branch', 35.7, -3.4, -10, 0, 0], ['furnace', 41.8, -3.4, -27.2, 0.9, 0], ['mstair', 36.8, 0, -31.2, -1.2, -0.4],
];
for (const [n, x, y, z, yaw, pitch] of stops) {
  if (only.length && !only.includes(n)) continue;
  await p.evaluate(([x, y, z, yaw, pitch]) => { const g = __lf.g; Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [x, y, z, yaw, pitch]);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${n}.png` });
}
console.log(await p.evaluate(() => JSON.stringify({ ms: __lf.g.frameMs ?? null })));
await b.close();
