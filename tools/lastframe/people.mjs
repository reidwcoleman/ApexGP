// The people from outside, stood in a lit room, at a forced tier: a line-up, each side close, one aiming, from behind.
//   node tools/lastframe/people.mjs PORT OUT [map]       (TIER, default 2; AT=x,y,z,yaw of the middle of the line)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, map = 'ward'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
const at = (process.env.AT ?? (map === 'ward' ? '33,0,-5,1.5' : '22,0,-10.4,0')).split(',').map(Number);
await p.evaluate(([tier]) => {
  localStorage.setItem('lastframe.played', '9');
  const g = __lf.g; g.gfx = tier; g.setTier(tier);
  g.startSolo({ mode: 'tdm', bots: 5, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine');
}, [+(process.env.TIER ?? 2)]);
// nobody fights: every bot stands still from the first frame
await p.evaluate(() => { for (const bt of __lf.g.match.bots.values()) bt.update = () => {}; });
await p.waitForTimeout(9000);
// three of each side in a row across the room, facing the lens; the wearer out of the way behind it
const info = await p.evaluate((at) => {
  const g = __lf.g, M = g.match;
  const [x, y, z, yaw] = at;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const guns = ['carbine', 'shotgun', 'rifle', 'pistol', 'carbine', 'shotgun'];
  const who = [];
  const list = [...M.bots.values()].map((bt) => [bt, M.players.find((q) => q.slot === bt.slot)]).filter((e) => e[1]);
  const pick = [...list.filter((e) => e[1].team === 0).slice(0, 3), ...list.filter((e) => e[1].team === 1).slice(0, 3)];
  for (const [bt, pl] of list) {
    const i = pick.findIndex((e) => e[0] === bt);
    bt.update = () => {};
    pl.alive = true; pl.hp = 100; pl.down = false;
    if (i < 0) { Object.assign(bt.m, { x: 0, y: -40, z: 0, vx: 0, vy: 0, vz: 0 }); continue; }
    const k = i - 2.5;
    Object.assign(bt.m, { x: x + fx * 3.2 + rx * k * 0.95, y, z: z + fz * 3.2 + rz * k * 0.95, vx: 0, vy: 0, vz: 0 });
    bt.yaw = yaw + Math.PI; bt.pitch = 0; bt.ads = i === 1 || i === 4; bt.crouch = false; bt.lean = 0; bt.reload = 0;
    bt.weapon = guns[i];
    who.push([bt.slot, pl.team, guns[i]]);
  }
  Object.assign(g.me.m, { x: x - fx * 6, y, z: z - fz * 6, vx: 0, vz: 0 });
  g.me.light = false;
  document.querySelector('.banner')?.remove();
  return who;
}, at);
console.log('bots', JSON.stringify(info));
await p.waitForTimeout(800);
const [x, y, z, yaw] = at;
const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
const cam = (name, fwd, side, h, dyaw = 0, pitch = -0.04) => [name, x + fx * fwd + rx * side, y + h, z + fz * fwd + rz * side, yaw + dyaw, pitch];
const views = [cam('line', -0.9, 0, 1.4), cam('a', 1.5, -1.45, 1.4, 0, -0.06), cam('b', 1.5, 1.45, 1.4, 0, -0.06),
  cam('face', 2.5, -1.42, 1.62, 0, 0), cam('face2', 2.5, 1.42, 1.62, 0, 0), cam('back', 5.4, 0, 1.45, Math.PI, -0.04), cam('side', 3.0, -4.4, 1.4, -Math.PI / 2, -0.03)];
for (const [n, cx, cy, cz, cyaw, pitch] of views) {
  // (who is drawn goes by what the wearer could see: they stand just behind the lens, looking the same way)
  await p.evaluate(([v, y0]) => { const g = __lf.g; g.camHold = v; __lf.post.cutExposure = true; Object.assign(g.me.m, { x: v[0] + Math.sin(v[3]) * 1.5, y: y0, z: v[2] + Math.cos(v[3]) * 1.5, vx: 0, vy: 0, vz: 0 }); g.me.yaw = v[3]; g.me.pitch = 0.9; }, [[cx, cy, cz, cyaw, pitch], y]);
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/${n}.png` });
}
await b.close();
