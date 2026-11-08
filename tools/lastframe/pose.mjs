// First-person stills from a scripted pose:  node tools/lastframe/pose.mjs PORT OUT "name:x,y,z,yaw,pitch[,ads[,weapon]]" ...
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, ...views] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1${process.env.MAP ? "&map=" + process.env.MAP : ""}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(1500);
for (const v of views) {
  const [name, c] = v.split(':');
  const n = c.split(',');
  await p.evaluate((n) => {
    const g = __lf.g;
    const [x, y, z, yaw, pitch] = n.slice(0, 5).map(Number);
    Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0 });
    g.me.yaw = yaw;
    g.me.pitch = pitch;
    g.input.ads = n[5] === '1';
    if (n[6]) { g.me.slots[0] = n[6]; g.me.ammo.set(n[6], { mag: 5, res: 5 }); g.me.cur = 0; }
    g.me.light = n[7] === '1';
    g.post.cutExposure = true;
  }, n);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${name}.png` });
}
await b.close();
