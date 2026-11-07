// Every gun, from the hip and down the sights:  node tools/lastframe/sights.mjs PORT OUT
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
await p.evaluate(() => { localStorage.setItem('lastframe.played', '9'); const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(1500);
for (const w of ['carbine', 'shotgun', 'rifle', 'pistol']) {
  await p.evaluate((w) => { const g = __lf.g, m = g.me; m.slots = [w, 'pistol']; m.cur = 0; m.ammo.set(w, { mag: 5, res: 20 }); Object.assign(m.m, { x: 30, y: 0, z: -5, vx: 0, vz: 0 }); m.yaw = 1.5; m.pitch = 0.05; m.light = true; g.input.ads = false; }, w);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${w}_hip.png` });
  await p.evaluate(() => { __lf.g.input.ads = true; });
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/${w}_ads.png` });
}
await b.close();
