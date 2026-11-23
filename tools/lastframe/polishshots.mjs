// Pictures of the screen furniture and the small animations of the attack-and-defend game.  node tools/lastframe/polishshots.mjs PORT map OUTDIR [room]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, map = 'ward', out = '.', room = map === 'ward' ? 'staff' : 'kitchen'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
let errs = 0;
p.on('pageerror', (e) => { errs++; console.log('pageerror', e.message, (e.stack ?? '').split('\n').slice(0, 3).join(' | ')); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 400000 });
const shot = async (name, ms = 900) => { await p.waitForTimeout(ms); await p.screenshot({ path: `${out}/${map}_${name}.png` }); };
const start = (team, kits) => p.evaluate(([team, kits, room]) => {
  const g = __lf.g;
  g.kits = kits;
  g.startSolo({ mode: 'siege', bots: 5, skill: 0.5, time: 8, limit: 4, seed: 4 }, 'Tester', team, 'carbine');
  const m = g.match;
  const orig = m.siegeRooms.bind(m);
  m.siegeRooms = () => { const all = orig(); const one = all.filter((r) => r.name === room); return one.length ? one : all; };
  m.round = 1; m.newRound(true);
  g.halt = true;
  const T = m.tactics;
  window.__sites = [];
  for (let k = 0; k < 30 * 60 && !(m.phase === 'prep' && m.clock < 20); k++) { m.update(1 / 30); if (T.sites.length) { window.__sites = T.sites; T.sites = []; } }
  g.halt = false;
  window.__in = (s) => T.siteIn(s);
  window.__put = (x, y, z, tx, tz, pitch = 0) => { Object.assign(g.me.m, { x, y, z, vx: 0, vy: 0, vz: 0 }); g.me.yaw = Math.atan2(-(tx - x), -(tz - z)); g.me.pitch = pitch; Object.assign(m.bodies[g.mySlot], { x, y, z }); };
  return { room: m.obj.name, atk: m.atk, sites: window.__sites.length };
}, [team, kits, room]);
// ---- attacking: the wait before the round, with the plan up
console.log('attack', JSON.stringify(await start(0, ['scout', 'medic'])));
await shot('p1_attacker_briefing', 1800);
// ---- defending
console.log('defend', JSON.stringify(await start(1, ['breacher', 'trapper'])));
await p.evaluate(() => { __lf.g.me.light = true; });
// a doorway with no boards: the prompt, then the bar while the key is held
const door = await p.evaluate(() => {
  const g = __lf.g, m = g.match;
  const d = m.obj.doors[0];
  m.setBar?.(d, 0);
  const o = m.openings[d];
  const inw = Math.sign((o.alongX ? (m.obj.box[2] + m.obj.box[5]) / 2 - o.z : (m.obj.box[0] + m.obj.box[3]) / 2 - o.x)) || 1;
  window.__door = { o, inw };
  window.__put(o.x + (o.alongX ? 0.15 : inw * 1.5), o.y, o.z + (o.alongX ? inw * 1.5 : 0.15), o.x, o.z, -0.05);
  return { boards: m.bars[d], i: d };
});
await shot('p2_prompt', 900);
console.log('prompt at doorway:', JSON.stringify(await p.evaluate(() => document.querySelector('.prompt .acts')?.textContent)), JSON.stringify(door));
await p.evaluate(() => __lf.g.input.keys.add(document.querySelector('.prompt .acts')?.textContent.includes('Barricade') ? 'KeyF' : 'KeyX'));
await shot('p3_prompt_working', 700);
await p.waitForTimeout(1400);
await p.evaluate(() => { __lf.g.input.keys.delete('KeyF'); __lf.g.input.keys.delete('KeyX'); });
await shot('p4_boards_up', 900);
// the wire, close and lit
await p.evaluate(() => { const g = __lf.g, m = g.match, { o, inw } = window.__door; window.__put(o.x + (o.alongX ? 0.2 : inw * 1.3), o.y, o.z + (o.alongX ? inw * 1.3 : 0.2), o.x, o.z, -0.7); m.trip(g.mySlot, o.i); });
await shot('p5_wire', 1000);
// boards kicked out from the far side: the halves on the floor
await p.evaluate(() => { const g = __lf.g, m = g.match, { o, inw } = window.__door; window.__put(o.x + (o.alongX ? 0.9 : inw * 2.6), o.y, o.z + (o.alongX ? inw * 2.6 : 0.9), o.x, o.z, -0.25); const a = m.players.find((q) => q.team === m.atk && q.bot); Object.assign(m.bodies[a.slot], { x: o.x - (o.alongX ? 0 : inw), z: o.z - (o.alongX ? inw : 0) }); m.barKick(a.slot, o.i); });
await shot('p6_boards_kicked', 900);
// steel on a wall, close and lit
const st = await p.evaluate(() => {
  const g = __lf.g, m = g.match, s = window.__sites[0];
  if (!s) return null;
  const inw = window.__in(s), u = (s.u0 + s.u1) / 2;
  window.__put(s.ax ? u + 0.9 : s.c + inw * 2.1, s.y0, s.ax ? s.c + inw * 2.1 : u + 0.9, s.ax ? u : s.c, s.ax ? s.c : u, -0.1);
  return m.reinforce(g.mySlot, [s.ax, s.c, s.u0, s.u1, s.y0, s.y1, s.t], inw);
});
console.log('steel:', st);
await shot('p7_steel', 1500);
// the plan, as the defenders have it
await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })));
await shot('p8_plan_defender', 700);
await p.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' })));
// on the floor, with someone coming
await p.evaluate(() => { const g = __lf.g, m = g.match; g.halt = true; for (let k = 0; k < 30 * 30 && m.phase !== 'live'; k++) m.update(1 / 30); g.halt = false; const foe = m.players.find((q) => q.team === m.atk && q.bot && q.alive); m.damage(foe.slot, g.mySlot, 500, 1, 0, [0, 0, 1], 5); const mate = m.players.find((q) => q.bot && q.alive && !q.down && q.team !== m.atk); if (mate) m.lift(mate.slot, g.mySlot, true); });
await shot('p9_down', 1500);
console.log('page errors:', errs);
await b.close();
