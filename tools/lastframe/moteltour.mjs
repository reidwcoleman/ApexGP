// Round the Pinewood Motor Inn, first person, nobody about:  node tools/lastframe/moteltour.mjs PORT OUT [stop names]
// Stops are in game axes: x east, y up, z = -north
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, ...only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=motel`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(1500);
const stops = [
  ['lot', 10, 0, -12, 0, 0.05], ['sign', 30, 0, -2, 3.14, 0.15], ['walkway', 8, 0, -35, -1.57, 0], ['balcony', 50, 3.0, -35, 1.57, 0], ['room', 27, 0, -37, 0, -0.1],
  ['room_up', 15, 3.0, -37, 0, -0.1], ['broken', 37, 0, -39.5, -1.57, 0], ['pool', 41, -1.9, -11, 0, 0.1], ['pool_edge', 33, 0, -5, -0.7, -0.15], ['diner', 62, 0, -3, -1.4, 0],
  ['diner2', 74, 0, -4, 1.57, 0], ['kitchen', 62, 0, -12, -1.57, 0], ['office', 3, 0, -40, 1.57, 0], ['alley', 10, 0, -50, -1.57, 0], ['trees', -15, 0, 10, -0.6, 0.05],
];
for (const [n, x, y, z, yaw, pitch] of stops) {
  if (only.length && !only.includes(n)) continue;
  await p.evaluate(([x, y, z, yaw, pitch]) => { const g = __lf.g; Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [x, y, z, yaw, pitch]);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${n}.png` });
}
console.log(await p.evaluate(() => JSON.stringify({ ms: __lf.g.frameMs ?? null })));
await b.close();
