// Pictures of the attack-and-defend game: a boarded doorway, boards shot out, a charge on it, the room marked.  node tools/lastframe/siegeshots.mjs PORT map OUTDIR
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, map = 'ward', out = '.'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
let errs = 0;
p.on('pageerror', (e) => { errs++; console.log('pageerror', e.message); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 400000 });
// the person defends the first round (side 1), and stands in the room looking at a doorway
const info = await p.evaluate(() => {
  const g = __lf.g;
  g.startSolo({ mode: 'siege', bots: 5, skill: 0.5, time: 8, limit: 4, seed: 4 }, 'Tester', 1, 'carbine');
  const m = g.match;
  g.halt = true;
  for (let k = 0; k < 30 * 60 && !(m.phase === 'prep' && m.clock < 3); k++) m.update(1 / 30);
  const o = m.openings[m.obj.doors[0]];
  const inw = Math.sign((o.alongX ? (m.obj.box[2] + m.obj.box[5]) / 2 - o.z : (m.obj.box[0] + m.obj.box[3]) / 2 - o.x)) || 1;
  const at = (back, side = 0) => [o.x + (o.alongX ? side : inw * back), o.y, o.z + (o.alongX ? inw * back : side)];
  window.__look = (back, side = 0, pitch = 0) => {
    const [x, y, z] = at(back, side);
    Object.assign(g.me.m, { x, y, z, vx: 0, vy: 0, vz: 0 });
    g.me.yaw = Math.atan2(-(o.x - x), -(o.z - z));
    g.me.pitch = pitch;
  };
  window.__door = o;
  window.__look(2.6, 0.5);
  g.halt = false;
  return { room: m.obj.name, bars: m.obj.doors.map((d) => m.bars[d].toString(2)), door: [o.x, o.y, o.z, o.w, o.alongX] };
});
console.log(JSON.stringify(info));
const shot = async (name, ms = 900) => { await p.waitForTimeout(ms); await p.evaluate(() => window.__look && 0); await p.screenshot({ path: `${out}/${map}_${name}.png` }); };
await shot('1_boarded', 1400);
await p.evaluate(() => { const g = __lf.g, m = g.match, i = window.__door.i; m.barHit([i * 8 + 3, i * 8 + 3, i * 8 + 4, i * 8 + 4], 1, g.mySlot); window.__look(2.2, 0.3); });
await shot('2_holes', 1200);
// the round is on; a charge from the far side
await p.evaluate(() => { const g = __lf.g, m = g.match; g.halt = true; for (let k = 0; k < 30 * 8 && m.phase !== 'live'; k++) m.update(1 / 30); const a = m.players.find((q) => q.team === m.atk && q.bot); m.setCharge(a.slot, window.__door.i, -1); window.__look(3.4, 0.9); g.halt = false; });
await shot('3_charge_set', 700);
await shot('4_blown', 2600);
// one of them in the room: the bar that says so
await p.evaluate(() => { const g = __lf.g, m = g.match; for (const q of m.players) if (q.bot && q.alive && q.team !== m.atk) m.damage(q.slot, q.slot, 999, 1, 0, [0, 0, 1], 0); const a = m.players.find((q) => q.team === m.atk && q.bot && q.alive); const bt = m.bots.get(a.slot); Object.assign(bt.m, { x: m.obj.c.x, y: m.obj.c.y, z: m.obj.c.z }); g.me.hp = 100; window.__look(1.2, -0.6); g.me.yaw += Math.PI; });
await shot('5_in_the_room', 2500);
console.log('page errors:', errs);
await b.close();
