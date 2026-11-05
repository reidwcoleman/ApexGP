// Buck's race on every vehicle with real keys: a pilot who steers wins, nobody at the wheel loses, walking away
// costs nothing.  node tools/pinerun.mjs <outdir> [port]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [dir, port = '5311'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message + (e.stack ?? '').split('\n')[1])); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://localhost:${port}/pine.html?skip&seed=7`); await page.waitForFunction(() => window.__ready === true); await page.waitForTimeout(500);
const held = new Set(), set = async (k, on) => { if (on && !held.has(k)) { held.add(k); await page.keyboard.down(k); } if (!on && held.has(k)) { held.delete(k); await page.keyboard.up(k); } }, off = async () => { for (const k of [...held]) await set(k, false); };
const steer = async (dx, dy) => { await set('KeyD', dx > 0.5); await set('KeyA', dx < -0.5); await set('KeyS', dy > 0.5); await set('KeyW', dy < -0.5); };
const offer = (veh, wins) => page.evaluate(([veh, wins]) => { const a = __pine, s = a.sim.s; s.tut = false; s.goal = 3; s.year = 3; s.month = 3; s.day = 2; s.veh = veh; s.p.x = 125.5; s.p.y = 73.5; s.fun.trail = null; s.fun.trailT = 999; s.fun.giftT = 999; s.fun.duel = null; s.fun.duelT = 0; s.fun.buckW = wins; s.fun.frenzy = 0; s.fun.jolly = 0; a.big = null; }, [veh, wins]);
const read = () => page.evaluate(() => { const s = __pine.sim.s, d = s.fun.duel, p = s.p; return { px: p.x, py: p.y, on: d?.on, i: d?.i, bi: d?.bi, n: d ? d.pts.length / 2 : 0, gx: d ? (d.on ? d.pts[d.i * 2] : d.x) : 0, gy: d ? (d.on ? d.pts[d.i * 2 + 1] : d.y) : 0, has: !!d, w: s.fun.buckW, l: s.fun.buckL, m: Math.round(s.money), buck: s.rivals[s.rivals.length - 1] }; });
const names = ['Boots', 'Quad', 'Tractor', 'Big Jolly', 'Skycrane'];
for (let v = 0; v < 5; v++) for (const wins of [0, 4]) {
  await offer(v, wins); await page.waitForTimeout(80); const b4 = await read(); const t0 = Date.now(); let shot = false;
  for (;;) { const r = await read(); if (!r.has || Date.now() - t0 > 45000) break; await steer(r.gx - r.px, r.gy - r.py); if (!shot && r.on && r.i >= 2) { shot = true; if (v === 1 && !wins) await page.screenshot({ path: `${dir}/d_race.png` }); } await page.waitForTimeout(25); }
  await off(); const a = await read();
  console.log(names[v].padEnd(10), `Buck has ${wins} losses`.padEnd(18), a.w > b4.w ? 'WON ' : a.l > b4.l ? 'LOST' : 'NONE', `${((Date.now() - t0) / 1000).toFixed(1)}s`, `pot +$${a.m - b4.m}`, `Buck ${b4.buck} -> ${a.buck}`);
}
// nobody at the wheel: enter the arch, then stop
await offer(1, 0); await page.waitForTimeout(80); await page.screenshot({ path: `${dir}/d_offer.png` });
for (let i = 0; i < 400; i++) { const r = await read(); if (r.on) break; await steer(r.gx - r.px, r.gy - r.py); await page.waitForTimeout(25); } await off();
const w0 = await read(); await page.waitForFunction(() => !__pine.sim.s.fun.duel, null, { timeout: 40000 }); const w1 = await read(); console.log('idle after the arch', w1.l > w0.l ? 'BUCK WINS, money change ' + (w1.m - w0.m) : 'unexpected');
await page.evaluate(() => { const s = __pine.sim.s; s.fun.duel = null; s.fun.duelT = 0; }); await page.waitForTimeout(100); const q0 = await read(); await page.evaluate(() => { __pine.sim.s.fun.duel.t = 0.1; }); await page.waitForTimeout(300); const q1 = await read(); console.log('ignored the offer', !q1.has ? 'gone, money change ' + (q1.m - q0.m) : 'still there');
await page.evaluate(() => { const a = __pine, s = a.sim.s; s.fun.duel = null; s.fun.duelT = 0; }); await page.waitForTimeout(100); await page.evaluate(() => __pine.save()); await page.reload(); await page.waitForTimeout(800); await page.keyboard.press('Enter'); await page.waitForTimeout(900);
console.log('save mid offer', JSON.stringify(await page.evaluate(() => ({ mode: __pine.mode, duel: !!__pine.sim.s.fun.duel }))));
console.log(errs.slice(0, 8).join('\n') || 'no errors'); await browser.close();
