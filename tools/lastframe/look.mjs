// Looks at the people and the rooms:  node tools/lastframe/look.mjs PORT OUT
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 2, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); });
await p.waitForTimeout(1500);
// freeze the bots in front of the camera
const stand = async (name, x, z, yaw, list) => {
  await p.evaluate(([x, z, yaw, list]) => {
    const g = __lf.g;
    Object.assign(g.me.m, { x, y: 0, z, vx: 0, vz: 0 });
    g.me.yaw = yaw;
    g.me.pitch = -0.03;
    g.me.light = true;
    let i = 0;
    for (const [s, bt] of g.match.bots) {
      bt.update = () => {};
      const q = list[i++ % list.length];
      Object.assign(bt.m, { x: x + q[0], y: 0, z: z + q[1] });
      bt.yaw = q[2];
      bt.ads = i % 2 === 0;
    }
    g.post.cutExposure = true;
  }, [x, z, yaw, list]);
  await p.waitForTimeout(1000);
  await p.screenshot({ path: `${out}/${name}.png` });
};
await stand('p_street', 30, -6, -1.57, [[3, 0.5, 1.57], [4.2, -1, 2.2], [5, 1, 0.9]]);
await stand('p_room', 10, -23.1, -1.57, [[3, -0.3, 1.57], [4.5, 0.4, 1.3]]);
await stand('warehouse', 62, -17, 0, [[1, -7, 3.14], [-3, -12, 3.0]]);
await stand('flat', 24, -15, 3.1, [[1, 3, 0], [-1, 5, 0]]);
await p.evaluate(() => { const g = __lf.g; g.me.m.y = 3.2; });
await p.waitForTimeout(600);
await p.screenshot({ path: `${out}/flat2.png` });
await stand('shop', 14, -20, 3.1, [[-2, 3, 0], [1, 4.5, 0]]);
await b.close();
