// People from outside, with a held camera:  node tools/lastframe/body.mjs PORT OUT
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
p.on('console', (m) => m.type() === 'error' && !/GPU stall/.test(m.text()) && console.log('err', m.text().slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 2, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); });
await p.waitForTimeout(1500);
// bots stand on the lit pavement outside the tenement door, one of each team, one aiming
await p.evaluate(() => {
  const g = __lf.g;
  let i = 0;
  for (const [s, bt] of g.match.bots) {
    bt.update = () => {};
    Object.assign(bt.m, { x: 60 + i * 1.5, y: 0, z: -6 });
    bt.yaw = 0;
    bt.pitch = 0;
    bt.ads = i === 1;
    i++;
  }
  Object.assign(g.me.m, { x: 30, y: 0, z: -3, vx: 0, vz: 0 });
});
await p.waitForTimeout(400);
const views = [['front', 61.5, 1.25, -2.6, 0, -0.03], ['side', 56.6, 1.25, -6, -1.57, -0.02], ['back', 61.5, 1.45, -9.4, 3.14, -0.05], ['close', 60, 1.62, -4.7, 0, -0.03]];
for (const [n, x, y, z, yaw, pitch] of views) {
  await p.evaluate((v) => { __lf.g.camHold = v; __lf.post.cutExposure = true; }, [x, y, z, yaw, pitch]);
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/${n}.png` });
}
await b.close();
