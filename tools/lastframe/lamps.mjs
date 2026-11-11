// Shoots a lamp out and checks the room goes dark with it:  node tools/lastframe/lamps.mjs PORT OUTDIR [map]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, map = 'ward'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.autoInput = true; g.startSolo({ mode: 'tdm', bots: 0, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); g.match.bots.clear(); });
await p.waitForTimeout(6500);
// the brightest steady lamp indoors that has floor under it: stand south of it, look up at it
const lamp = await p.evaluate(() => {
  const g = __lf.g;
  const f = g.L.flicks.filter((q) => !q.l.flicker && q.l.kind !== 'spot' && q.l.power > 3 && g.zone(q.l.pos[0], q.l.pos[1], q.l.pos[2]) !== 'street').sort((a, b) => b.l.power - a.l.power)[0];
  const [x, y, z] = f.l.pos;
  const fy = g.L.world.floorAt(x, y - 0.3, z + 1.6, 0.2, 0.05);
  Object.assign(g.me.m, { x, y: fy, z: z + 1.6, vx: 0, vy: 0, vz: 0 });
  g.me.light = false;
  g.me.freeAim = false;
  g.me.yaw = 0;
  g.me.pitch = Math.atan2(y - (fy + 1.4), 1.6);
  g.post.cutExposure = true;
  return { pos: f.l.pos, kind: f.l.kind, power: f.l.power, i: g.L.flicks.indexOf(f) };
});
console.log('lamp', JSON.stringify(lamp));
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/lamp_on.png` });
await p.evaluate(() => { const g = __lf.g; g.input.fire = true; g.input.firePressed = true; });
await p.waitForTimeout(450);
await p.evaluate(() => { const g = __lf.g; g.input.fire = false; g.me.pitch = 0.1; });
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/lamp_out.png` });
console.log('after', await p.evaluate((i) => { const g = __lf.g; return JSON.stringify({ dead: g.L.flicks[i].dead, deadAll: g.L.flicks.filter((q) => q.dead).length, pools: g.match.pools.length }); }, lamp.i));
await b.close();
