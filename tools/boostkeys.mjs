// node tools/boostkeys.mjs [port=5195] — real key / mouse presses in free play; what the car does (screen right = +x, car faces +y)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const port = process.argv[2] ?? '5195';
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(`http://localhost:${port}/boost.html?time=day`, { waitUntil: 'domcontentloaded' });
await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
await p.evaluate(() => { const g = window.__boost; g.freeplay(); g.ui.tip?.(''); });
await p.waitForTimeout(800);
await p.mouse.move(640, 400);
const st = () => p.evaluate(() => { const g = window.__boost, c = g.world.cars[0]; const r = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  return { pos: [c.pos.x | 0, c.pos.y | 0, c.pos.z | 0], vel: [c.vel.x | 0, c.vel.y | 0, c.vel.z | 0], f: r(c.rot.f), u: r(c.rot.u), boost: c.boost | 0, ground: c.onGround, inp: c.input, ballCam: g.cam.ballCam, behind: g.cam.behind, paused: g.paused, ball: [g.world.ball.pos.x | 0, g.world.ball.pos.y | 0] }; });
const reset = (z = 0) => p.evaluate((z) => { const w = window.__boost.world, c = w.cars[0]; c.place(0, 0, Math.PI / 2); if (z) { c.pos.z = z; } c.vel.set(0, 0, 0); c.w.set(0, 0, 0); w.ball.pos.set(2500, 3000, 93); w.ball.vel.set(0, 0, 0); }, z);
const hold = async (keys, mouse, ms) => {
  for (const k of keys) await p.keyboard.down(k);
  for (const m of mouse) await p.mouse.down({ button: m });
  await p.waitForTimeout(ms);
  const s = await st();
  for (const m of mouse) await p.mouse.up({ button: m });
  for (const k of keys) await p.keyboard.up(k);
  return s;
};
const out = [];
const test = async (name, z, keys, mouse, ms, check) => {
  await reset(z); await p.waitForTimeout(250); if (z) await reset(z);
  const s = await hold(keys, mouse, ms);
  const ok = check(s);
  out.push(`${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(34)} input ${JSON.stringify(s.inp)} | f ${s.f} u ${s.u} vel ${s.vel} z ${s.pos[2]}`);
};
await test('W: drive forward', 0, ['w'], [], 600, (s) => s.vel[1] > 300);
await test('S: reverse', 0, ['s'], [], 600, (s) => s.vel[1] < -200);
await test('W+D: steer right (screen right)', 0, ['w', 'd'], [], 700, (s) => s.f[0] > 0.2);
await test('W+A: steer left', 0, ['w', 'a'], [], 700, (s) => s.f[0] < -0.2);
await test('Right mouse: jump', 0, [], ['right'], 200, (s) => s.pos[2] > 40);
await test('Left mouse: boost', 0, [], ['left'], 600, (s) => s.vel[1] > 500);
await test('Shift+W+D: powerslide', 0, ['w', 'Shift', 'd'], [], 500, (s) => s.inp.handbrake === true);
await test('air W: nose down', 1200, ['w'], [], 300, (s) => s.f[2] < -0.2);
await test('air S: nose up', 1200, ['s'], [], 300, (s) => s.f[2] > 0.2);
await test('air D: yaw right', 1200, ['d'], [], 300, (s) => s.f[0] > 0.2 && Math.abs(s.u[0]) < 0.25);
await test('air A: yaw left', 1200, ['a'], [], 300, (s) => s.f[0] < -0.2);
await test('air E: roll right (roof to the right)', 1200, ['e'], [], 300, (s) => s.u[0] > 0.3);
await test('air Q: roll left', 1200, ['q'], [], 300, (s) => s.u[0] < -0.3);
await test('air Shift+D: air roll right', 1200, ['Shift', 'd'], [], 300, (s) => s.u[0] > 0.3 && Math.abs(s.f[0]) < 0.15);
await test('air Shift+A: air roll left', 1200, ['Shift', 'a'], [], 300, (s) => s.u[0] < -0.3);
await test('air Left mouse: boost forward', 1200, [], ['left'], 300, (s) => s.vel[1] > 250);
// front flip: jump, release, jump again with W held
{
  await reset(); await p.waitForTimeout(250);
  await p.mouse.down({ button: 'right' }); await p.waitForTimeout(90); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(60);
  await p.keyboard.down('w'); await p.mouse.down({ button: 'right' }); await p.waitForTimeout(250);
  const s = await st(); await p.mouse.up({ button: 'right' }); await p.keyboard.up('w');
  out.push(`${s.f[2] < -0.3 && s.vel[1] > 450 ? 'OK  ' : 'FAIL'} ${'jump, W + jump: front flip'.padEnd(34)} f ${s.f} vel ${s.vel}`);
}
{
  await reset(); await p.waitForTimeout(250);
  await p.mouse.down({ button: 'right' }); await p.waitForTimeout(90); await p.mouse.up({ button: 'right' }); await p.waitForTimeout(60);
  await p.keyboard.down('d'); await p.mouse.down({ button: 'right' }); await p.waitForTimeout(250);
  const s = await st(); await p.mouse.up({ button: 'right' }); await p.keyboard.up('d');
  out.push(`${s.vel[0] > 400 ? 'OK  ' : 'FAIL'} ${'jump, D + jump: side flip right'.padEnd(34)} u ${s.u} vel ${s.vel}`);
}
// toggles
let s0 = await st(); await p.keyboard.press('Space'); let s1 = await st();
out.push(`${s0.ballCam !== s1.ballCam ? 'OK  ' : 'FAIL'} Space: ball cam toggles (${s0.ballCam} -> ${s1.ballCam})`);
await p.keyboard.press('Space');
await p.mouse.down({ button: 'middle' }); await p.waitForTimeout(100); s1 = await st(); await p.mouse.up({ button: 'middle' }); await p.waitForTimeout(100); const s2 = await st();
out.push(`${s1.behind && !s2.behind ? 'OK  ' : 'FAIL'} Middle mouse: rear view while held (${s1.behind} -> ${s2.behind})`);
await p.keyboard.down('Tab'); await p.waitForTimeout(100); const tab = await p.evaluate(() => [...document.querySelectorAll('[id*=board],[class*=board]')].some((e) => e.offsetParent !== null && getComputedStyle(e).display !== 'none' && !e.hidden)); await p.keyboard.up('Tab');
out.push(`${tab ? 'OK  ' : 'FAIL'} Tab: scoreboard while held`);
await p.evaluate(() => { window.__boost.world.ball.pos.set(1000, 1000, 93); });
await p.keyboard.press('Backspace'); await p.waitForTimeout(100); const bs = await st();
out.push(`${bs.ball[0] === 0 && bs.ball[1] === 0 ? 'OK  ' : 'FAIL'} Backspace: reset ball (free play) ${bs.ball}`);
await p.keyboard.press('Escape'); await p.waitForTimeout(100); const pe = await st();
out.push(`${pe.paused ? 'OK  ' : 'FAIL'} Esc: pause`);
console.log(out.join('\n'));
await b.close();
