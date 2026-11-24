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
// FIRE=1: one of them fires a string of shots, seen from the side, a picture every frame (the game stopped and stepped by hand)
if (process.env.FIRE) {
  const shots = [];
  await p.evaluate(([v, y0, slot]) => {
    const g = __lf.g; g.camHold = v; Object.assign(g.me.m, { x: v[0] + Math.sin(v[3]) * 1.5, y: y0, z: v[2] + Math.cos(v[3]) * 1.5 }); g.me.yaw = v[3];
    g.halt = true;
    window.__n = 0;
    window.__step = () => {
      const a = g.actors.get(slot), sol = a?.soldier;
      if (sol && window.__n % 5 === 0 && window.__n < 20) {
        const muz = sol.gun.group.localToWorld(new (sol.root.position.constructor)(0, 0.043, 0.695));
        const dir = sol.gun.group.getWorldDirection(new (sol.root.position.constructor)());
        sol.muzzle(muz); sol.kick = 1; g.fx.muzzle(muz, dir, 1); g.muzzleLight(muz, 3, dir);
      }
      window.__n++;
      g.time += 1 / 60; g.tick(1 / 60, 1 / 60);
    };
    for (let k = 0; k < 30; k++) { window.__n = 99; window.__step(); }
    window.__n = 0;
  }, [cam('fire', 2.0, -3.7, 1.32, -0.84, -0.02).slice(1), y, info[0][0]]);
  for (let k = 0; k < 12; k++) {
    await p.evaluate(() => window.__step());
    await p.waitForTimeout(60);
    shots.push(await p.screenshot({ clip: { x: 380, y: 130, width: 840, height: 600 } }));
  }
  const sheet = await p.evaluate(async (list) => {
    const ims = await Promise.all(list.map((d) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + d; })));
    const cols = 4, rows = Math.ceil(ims.length / cols), w = 490, h = 350;
    const c = document.createElement('canvas'); c.width = cols * w; c.height = rows * h;
    const x = c.getContext('2d');
    ims.forEach((im, i) => x.drawImage(im, (i % cols) * w, Math.floor(i / cols) * h, w, h));
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  }, shots.map((s) => s.toString('base64')));
  fs.writeFileSync(`${out}/fire.jpg`, Buffer.from(sheet, 'base64'));
}
await b.close();
