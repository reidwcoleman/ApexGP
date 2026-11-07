// Round the block, first person, nobody about:  node tools/lastframe/tour.mjs PORT OUT
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(1300);
const stops = [
  ['street_w', 20, 0, -5, -1.2, 0.02], ['street_e', 75, 0, -5, 1.3, 0.04], ['shops', 28, 0, -3, 2.8, 0.1], ['tenement', 18, 0, -9, 0.2, 0.25], ['alley', 41, 0, -16, 0, 0.12], ['alley2', 42, 0, -36, 3.14, 0.1],
  ['yard', 20, 0, -44, 1.0, 0.05], ['ware1', 70, 0, -18, 1.2, 0.2], ['ware2', 56, 3.2, -36, -1.57, -0.1], ['corridor', 8, 0, -23.1, -1.57, 0], ['flat', 8, 3.2, -18, -1.2, 0], ['bar', 30, 0, -16, 3.14, -0.02],
  ['south', 30, 0, -2, 2.9, 0.12], ['diner', 37, 0.1, 6, 3.14, -0.02], ['barber', 70, 0.1, 6, 3.14, -0.02], ['passage', 45, 0.1, 10.5, -1.57, 0], ['tunnel', 40, -3.4, -31.2, -1.57, 0], ['pump', 40, -3.4, -34, 0, 0], ['roof', 33.5, 7.2, -18, 0.8, -0.05],
];
for (const [n, x, y, z, yaw, pitch] of stops) {
  await p.evaluate(([x, y, z, yaw, pitch]) => { const g = __lf.g; Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [x, y, z, yaw, pitch]);
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/${n}.png` });
}
await b.close();
