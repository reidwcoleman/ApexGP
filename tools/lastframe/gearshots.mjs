// Pictures of the wall, steel, camera, wire and downed states of the attack-and-defend game.  node tools/lastframe/gearshots.mjs PORT map OUTDIR [room]
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
const info = await p.evaluate((room) => {
  const g = __lf.g;
  g.kits = ['breacher', 'trapper'];
  g.startSolo({ mode: 'siege', bots: 5, skill: 0.5, time: 8, limit: 4, seed: 4 }, 'Tester', 1, 'carbine');
  const m = g.match;
  const orig = m.siegeRooms.bind(m);
  m.siegeRooms = () => { const all = orig(); const one = all.filter((r) => r.name === room); return one.length ? one : all; };
  m.round = 1; m.newRound(true);
  g.halt = true;
  const T = m.tactics;
  let sites = [];
  for (let k = 0; k < 30 * 60 && !(m.phase === 'prep' && m.clock < 6); k++) {
    m.update(1 / 30);
    // the bots leave the walls alone, so there are some left for the pictures
    if (T.sites.length) { sites = T.sites; T.sites = []; }
  }
  window.__sites = sites;
  window.__at = (s, side, back, lat = 0, pitch = 0) => {
    const u = (s.u0 + s.u1) / 2 + lat;
    const x = s.ax ? u : s.c + side * back, z = s.ax ? s.c + side * back : u;
    Object.assign(g.me.m, { x, y: s.y0, z, vx: 0, vy: 0, vz: 0 });
    const tx = s.ax ? (s.u0 + s.u1) / 2 : s.c, tz = s.ax ? s.c : (s.u0 + s.u1) / 2;
    g.me.yaw = Math.atan2(-(tx - x), -(tz - z));
    g.me.pitch = pitch;
  };
  window.__in = (s) => T.siteIn(s);
  g.halt = false;
  return { room: m.obj.name, sites: sites.length, free: sites.length, cams: m.cams.length, sheets: m.sheets.length, doors: m.obj.doors.length };
}, room);
console.log(JSON.stringify(info));
const shot = async (name, ms = 900) => { await p.waitForTimeout(ms); await p.screenshot({ path: `${out}/${map}_${name}.png` }); };
if (info.free) {
  await p.evaluate(() => { const s = window.__sites[0]; window.__at(s, window.__in(s), 1.7, 0.3); });
  await shot('w1_wall_before', 1200);
  console.log('prompt:', await p.evaluate(() => document.querySelector('.prompt')?.textContent));
  await p.evaluate(() => { const g = __lf.g, m = g.match, s = window.__sites[0]; console.log(m.reinforce(g.mySlot, [s.ax, s.c, s.u0, s.u1, s.y0, s.y1, s.t], window.__in(s))); });
  await shot('w2_steel', 900);
}
// the wire, across the first doorway of the room
await p.evaluate(() => { const g = __lf.g, m = g.match; const o = m.openings[m.obj.doors.find((d) => !m.trips.has(d)) ?? m.obj.doors[0]]; const inw = Math.sign((o.alongX ? (m.obj.box[2] + m.obj.box[5]) / 2 - o.z : (m.obj.box[0] + m.obj.box[3]) / 2 - o.x)) || 1; Object.assign(g.me.m, { x: o.x + (o.alongX ? 0.3 : inw * 1.9), y: o.y, z: o.z + (o.alongX ? inw * 1.9 : 0.3), vx: 0, vz: 0 }); g.me.yaw = Math.atan2(-(o.x - g.me.m.x), -(o.z - g.me.m.z)); g.me.pitch = -0.45; window.__door = o.i; });
await p.waitForTimeout(400);
await p.evaluate(() => { const g = __lf.g, m = g.match; Object.assign(m.bodies[g.mySlot], { x: g.me.m.x, y: g.me.m.y, z: g.me.m.z }); window.__r = m.trip(g.mySlot, window.__door); });
await shot('t1_wire', 1100);
console.log('wire set:', await p.evaluate(() => window.__r));
// through a camera
await p.evaluate(() => { const g = __lf.g; g.camView = 0; });
await shot('c1_camera_view', 1200);
await p.evaluate(() => { const g = __lf.g, m = g.match; g.camView = -1; const c = m.cams[0]; if (c) { const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw); Object.assign(g.me.m, { x: c.x + fx * 1.6, y: c.y - 2.35, z: c.z + fz * 1.6, vx: 0, vz: 0 }); g.me.yaw = c.yaw + Math.PI; g.me.pitch = 0.75; } });
await shot('c2_camera_on_wall', 1200);
// the round is on: a charge on a wall from outside, seen from inside; then the hole from both sides
const hole = await p.evaluate(() => {
  const g = __lf.g, m = g.match;
  g.halt = true;
  for (let k = 0; k < 30 * 12 && m.phase !== 'live'; k++) m.update(1 / 30);
  const s = window.__sites.find((q) => !m.sheeted(q));
  window.__allSites = window.__sites.map((q) => [q.ax, q.c, q.u0, m.sheeted(q)]);
  if (!s) { g.halt = false; return null; }
  const inw = window.__in(s);
  const a = m.players.find((q) => q.team === m.atk && q.bot);
  const bt = m.bots.get(a.slot);
  const u = (s.u0 + s.u1) / 2;
  Object.assign(bt.m, { x: s.ax ? u : s.c - inw * 1.2, y: s.y0, z: s.ax ? s.c - inw * 1.2 : u });
  Object.assign(m.bodies[a.slot], { x: bt.m.x, y: bt.m.y, z: bt.m.z });
  const ok = m.wallCharge(a.slot, [s.ax, s.c, s.u0, s.u1, s.y0, s.y1, s.t], -inw);
  window.__hole = s;
  window.__at(s, inw, 3.2, 0.9);
  g.halt = false;
  return { ok, site: [s.ax, s.c, s.u0, s.u1, s.y0, s.y1, s.t] };
});
console.log('wall charge:', JSON.stringify(hole));
if (hole?.ok) {
  await shot('w3_blown', 3600);
  await p.evaluate(() => { const g = __lf.g; g.me.hp = 100; window.__at(window.__hole, window.__in(window.__hole), 2.6, -0.5); });
  await shot('w4_hole_inside', 1500);
  await p.evaluate(() => { window.__at(window.__hole, -window.__in(window.__hole), 2.8, 0.6); });
  await shot('w5_hole_outside', 1200);
  await p.evaluate(() => { window.__at(window.__hole, -window.__in(window.__hole), 1.3, 0.2, -0.5); });
  await shot('w6_hole_floor', 1000);
  console.log('walk through:', await p.evaluate(async () => {
    const g = __lf.g, s = window.__hole, inw = window.__in(s);
    window.__at(s, -inw, 1.5, 0);
    g.input.keys.add('KeyW');
    await new Promise((r) => setTimeout(r, 2200));
    g.input.keys.delete('KeyW');
    const side = Math.sign((s.ax ? g.me.m.z : g.me.m.x) - s.c);
    return side === inw ? 'through to the inside' : 'stopped outside at ' + [g.me.m.x.toFixed(2), g.me.m.z.toFixed(2)];
  }));
}
// someone of mine on the floor, then me
await p.evaluate(() => {
  const g = __lf.g, m = g.match;
  const mate = m.players.find((q) => q.bot && q.alive && q.team === m.players.find((x) => x.slot === g.mySlot).team);
  const foe = m.players.find((q) => q.team === m.atk && q.bot && q.alive);
  if (!mate || !foe) return;
  const b = m.bodies[mate.slot];
  m.damage(foe.slot, mate.slot, 500, 1, 0, [0, 0, 1], 5);
  const n = m.nav.nodes.filter((q) => Math.abs(q.y - b.y) < 0.5 && Math.hypot(q.x - b.x, q.z - b.z) > 2 && Math.hypot(q.x - b.x, q.z - b.z) < 3.4 && m.world.sees({ x: q.x, y: q.y + 1.5, z: q.z }, { x: b.x, y: b.y + 0.3, z: b.z }))[0] ?? { x: b.x + 2, z: b.z + 1.5 };
  Object.assign(g.me.m, { x: n.x, y: b.y, z: n.z, vx: 0, vz: 0 });
  g.me.yaw = Math.atan2(-(b.x - g.me.m.x), -(b.z - g.me.m.z));
  g.me.pitch = -Math.atan2(1.25, Math.hypot(b.x - g.me.m.x, b.z - g.me.m.z));
  g.me.light = true;
  window.__look = () => { const q = m.bodies[mate.slot]; g.me.yaw = Math.atan2(-(q.x - g.me.m.x), -(q.z - g.me.m.z)); g.me.pitch = -Math.atan2(1.25, Math.hypot(q.x - g.me.m.x, q.z - g.me.m.z)); };
  window.__mate = mate.slot;
});
await p.waitForTimeout(1500);
await p.evaluate(() => window.__look?.());
await shot('d1_mate_down', 500);
console.log('prompt:', await p.evaluate(() => document.querySelector('.prompt')?.textContent));
await p.evaluate(() => { const g = __lf.g, m = g.match; const foe = m.players.find((q) => q.team === m.atk && q.bot && q.alive); if (foe) m.damage(foe.slot, g.mySlot, 500, 1, 0, [0, 0, 1], 5); });
await shot('d2_me_down', 1500);
console.log('state:', await p.evaluate(() => { const g = __lf.g; return JSON.stringify({ meDown: g.me.down, phase: g.phase, prompt: document.querySelector('.prompt')?.textContent }); }));
console.log('page errors:', errs);
await b.close();
