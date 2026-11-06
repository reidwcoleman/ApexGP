// A run of moments, each screenshotted:  node tools/lastframe/scene.mjs PORT OUT
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
p.on('pageerror', (e) => console.log('pageerror', e.message, (e.stack ?? '').slice(0, 300)));
p.on('console', (m) => m.type() === 'error' && !/GPU stall/.test(m.text()) && console.log('err', m.text().slice(0, 300)));
await p.goto(`http://localhost:${port}/lastframe.html?dev=1`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(() => { const g = __lf.g; g.startSolo({ mode: 'tdm', bots: 2, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine'); for (const b of g.match.bots.values()) b.update = () => {}; });
await p.waitForTimeout(5400);
const at = (x, y, z, yaw, pitch = 0) => p.evaluate(([x, y, z, yaw, pitch]) => { const g = __lf.g; Object.assign(g.me.m, { x, y, z, vx: 0, vz: 0 }); g.me.yaw = yaw; g.me.pitch = pitch; g.post.cutExposure = true; }, [x, y, z, yaw, pitch]);
const shot = (n) => p.screenshot({ path: `${out}/${n}.png` });
const key = (c) => p.evaluate((c) => { const g = __lf.g; g.input.pressed.add(c); g.input.keys.add(c); setTimeout(() => g.input.keys.delete(c), 60); }, c);
const hold = (c, on) => p.evaluate(([c, on]) => { const k = __lf.g.input.keys; on ? k.add(c) : k.delete(c); }, [c, on]);
await at(19.5, 0, -23.1, 0);   // facing a door along the corridor wall (south door at x 20)
await p.evaluate(() => { const g = __lf.g; g.me.yaw = Math.PI; g.me.light = true; });
await p.waitForTimeout(700);
await shot('door_closed');
await key('KeyF');
await p.waitForTimeout(900);
await shot('door_open');
await at(40, 0, -6, -1.57);
await p.waitForTimeout(500);
await key('KeyR');
await p.waitForTimeout(800);
await shot('reload');
await p.waitForTimeout(2200);
await hold('KeyQ', true);
await at(52, 0, -6, -1.57);
await p.waitForTimeout(500);
await shot('lean');
await hold('KeyQ', false);
await hold('KeyW', true); await hold('ShiftLeft', true);
await p.waitForTimeout(800);
await shot('sprint');
await hold('KeyW', false); await hold('ShiftLeft', false);
// shoot a shop window and a wall
await at(12, 0, -8, 3.14159);
await p.waitForTimeout(400);
await p.evaluate(() => { const g = __lf.g; g.input.fire = true; setTimeout(() => (g.input.fire = false), 400); });
await p.waitForTimeout(150);
await shot('firing');
await p.waitForTimeout(700);
await shot('after_fire');
// a flash and a frag
await at(46, 0, -40, 0);
await key('KeyV');
await p.waitForTimeout(1950);
await shot('flash');
await p.waitForTimeout(1600);
await key('KeyG');
await p.waitForTimeout(2650);
await shot('frag');
await p.waitForTimeout(1200);
// dying
await p.evaluate(() => { const g = __lf.g; const s = [...g.match.bots.keys()].find((k) => g.match.foes(g.mySlot, k)); g.match.damage(s, g.mySlot, 200, 1, 0, [0, 0, -1], 9); });
for (const [n, t] of [['die1', 450], ['die2', 900], ['die3', 1000], ['die4', 700]]) { await p.waitForTimeout(t); await shot(n); }
console.log(await p.evaluate(() => ({ hud: document.querySelector('.lost').className, frozen: __lf.g.frozen })));
await b.close();
