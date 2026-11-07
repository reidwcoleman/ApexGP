// Round the cove, first person:  node tools/lastframe/covetour.mjs PORT OUT
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
p.on('console', (m) => m.type() === 'error' && !/GPU stall/.test(m.text()) && console.log('err', m.text().slice(0, 240)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=cove`);
await p.waitForFunction(() => window.__lf, null, { timeout: 240000 });
await p.evaluate(() => { localStorage.setItem('lastframe.played', '9'); const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(1500);
// x, y-north, yaw, pitch; y-up comes from the ground
const stops = [
  ['beach', 16, 30, -0.1, 0.05], ['slip_up', 18, 46, -0.05, 0.08], ['square', 22, 50, 0.3, 0.05], ['pier', -15, 22, -1.0, 0.02], ['pier_view', -3, 9.5, -0.9, 0.1],
  ['lane1', 30, 86, -0.2, 0.05], ['lane2', 50, 130, -0.3, 0.05], ['lane_down', 60, 160, 2.8, -0.12], ['headland', -80, 30, -2.0, -0.08], ['hut', -55, 24, 1.5, -0.03], ['west_terrace', 18, 100, 0.0, 0.02], ['east_top', 120, 80, 1.8, -0.12],
];
for (const [n, x, yn, yaw, pitch] of stops) {
  await p.evaluate(([x, yn, yaw, pitch]) => { const g = __lf.g, w = g.L.world, z = -yn; let y = w.floorAt(x, 60, z, 0.2, 0); Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [x, yn, yaw, pitch]);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/${n}.png` });
}
await p.evaluate(() => { const g = __lf.g; g.camHold = [-50, 24, -6, -0.62, -0.1]; });
await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/aerial.png` });
await b.close();
