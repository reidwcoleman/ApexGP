// Does it all move?  node tools/lastframe/physics.mjs PORT OUT
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 400)));
p.on('console', (m) => m.type() === 'error' && !/GPU stall/.test(m.text()) && console.log('err', m.text().slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 3, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); for (const b of g.match.bots.values()) b.update = () => {}; g.phase = 'live'; g.match.phase = 'live'; g.match.clock = 400; });
await p.waitForTimeout(600);
const at = (x, y, z, yaw, pitch = 0) => p.evaluate(([x, y, z, yaw, pitch]) => { const g = __lf.g; Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0, vy: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [x, y, z, yaw, pitch]);
const shot = (n) => p.screenshot({ path: `${out}/${n}.png` });
const key = (c, ms = 60) => p.evaluate(([c, ms]) => { const g = __lf.g; g.input.pressed.add(c); g.input.keys.add(c); setTimeout(() => g.input.keys.delete(c), ms); }, [c, ms]);
const hold = (c, on) => p.evaluate(([c, on]) => { const k = __lf.g.input.keys; on ? k.add(c) : k.delete(c); }, [c, on]);
const foes = () => p.evaluate(() => { const g = __lf.g; return [...g.match.bots.keys()].filter((k) => g.match.foes(g.mySlot, k)); });
const put = (s, x, z) => p.evaluate(([s, x, z]) => { const g = __lf.g; const b = g.match.bots.get(s); Object.assign(b.m, { x, y: 0, z }); g.match.bodies[s].x = x; g.match.bodies[s].z = z; }, [s, x, z]);
const log = async (l, f) => console.log(l, JSON.stringify(await p.evaluate(f)));

// ---- a chair and a barrel are real
await at(69.5, 0, -13.8, 0, -0.32);
await p.waitForTimeout(500);
await log('loose', () => { const g = __lf.g; const ph = g.phys; return { n: ph.loose.length, sleeping: ph.loose.filter((l) => l.body.isSleeping()).length }; });
await shot('barrels');
const before = await p.evaluate(() => __lf.g.phys.loose.map((l) => { const t = l.body.translation(); return [t.x, t.y, t.z]; }));
await p.evaluate(() => { const g = __lf.g; g.input.fire = true; setTimeout(() => (g.input.fire = false), 900); });
await p.waitForTimeout(300);
await shot('barrels_firing');
await p.waitForTimeout(1500);
await shot('barrels_after');
const after = await p.evaluate(() => __lf.g.phys.loose.map((l) => { const t = l.body.translation(); return [t.x, t.y, t.z]; }));
console.log('props moved by bullets', after.filter((a, i) => Math.hypot(a[0] - before[i][0], a[1] - before[i][1], a[2] - before[i][2]) > 0.05).length);

// ---- bodies
const [f1, f2] = await foes();
await put(f1, 39, -6.5);
await at(39, 0, -3.4, 0, -0.02);
await p.waitForTimeout(400);
await shot('pre_kill');
await p.evaluate((s) => { const g = __lf.g; g.match.damage(g.mySlot, s, 200, 1, 0, [0, 0.05, -1], 3); }, f1);
for (const [n, t] of [['kill1', 120], ['kill2', 250], ['kill3', 500], ['kill4', 1200]]) { await p.waitForTimeout(t); await shot(n); }
await log('rag head', () => { const g = __lf.g; const a = [...g.actors.values()].find((q) => q.deadAt >= 0); return a?.soldier.head; });

// ---- the door
await at(19.5, 0, -23.1, Math.PI / 2);
await p.evaluate(() => { const g = __lf.g; g.me.light = true; });
await p.waitForTimeout(400);
await at(11.5, 0, -23.1, Math.PI);
await p.waitForTimeout(300);
await log('doors', () => { const g = __lf.g; return g.L.doors.slice(0, 4).map((d) => [d.ang, d.moving]); });
await key('KeyF');
const ang = [];
for (let i = 0; i < 8; i++) { await p.waitForTimeout(120); ang.push(await p.evaluate(() => { const g = __lf.g; return g.L.doors.map((d) => +d.ang.toFixed(2)).filter((a) => a).join(','); })); }
console.log('door swing', ang.join(' | '));
await shot('door_open');

// ---- glass
await at(12, 0, -8.5, 0, 0.1);
await p.waitForTimeout(300);
await shot('window_before');
await p.evaluate(() => { const g = __lf.g; g.input.fire = true; setTimeout(() => (g.input.fire = false), 160); });
await p.waitForTimeout(260);
await shot('window_break');
await p.waitForTimeout(700);
await shot('window_after');
await log('panes', () => __lf.g.L.panes.filter((q) => q.broken).length);

// ---- grenade in a room of things
await at(21, 0, -17.5, -1.57, 0.05);
await p.evaluate(() => { const g = __lf.g; g.match.players.find((q) => q.slot === g.mySlot).hp = 1e5; });
await key('KeyG');
await p.waitForTimeout(2300);
await shot('frag0');
await p.waitForTimeout(130);
await shot('frag1');
await p.waitForTimeout(350);
await shot('frag2');
await p.waitForTimeout(1200);
await shot('frag3');
await log('frag', () => { const g = __lf.g; return { open: g.L.doors.filter((d) => d.want > 0).length, moved: g.phys.loose.filter((l) => l.moved).length, panes: g.L.panes.filter((q) => q.broken).length }; });

// ---- a climb
await at(12.5, 0, -22.6, 3.14159);
const near = await p.evaluate(() => { const g = __lf.g; Object.assign(g.me.m, { x: 39.1, y: 0, z: -29.4 }); g.me.yaw = -1.57; return g.me.m; });
await p.evaluate(() => { const g = __lf.g; Object.assign(g.me.m, { x: 41.55, y: 0, z: -30.5 }); g.me.yaw = -1.57; });
await p.waitForTimeout(200);
const y0 = await p.evaluate(() => __lf.g.me.m.y);
await hold('KeyW', true);
await key('Space', 120);
await p.waitForTimeout(700);
await hold('KeyW', false);
console.log('mantle y', y0, await p.evaluate(() => [__lf.g.me.m.x, __lf.g.me.m.y, __lf.g.me.m.z]));
await shot('mantle');

// ---- reload drops a mag
await key('KeyR');
await p.waitForTimeout(1200);
await shot('reload');
await log('frame', () => __lf.g.hud ? { frames: window.__frames } : 0);
await b.close();
