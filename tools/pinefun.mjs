// The arcade layer with real input: combo, Jolly Mode, a gift, a whole bell trail per vehicle, the July sale,
// the album, and an old save with no fun data in it.  node tools/pinefun.mjs <outdir> [port]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [dir, port = '5311'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message + (e.stack ?? '').split('\n')[1])); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(`http://localhost:${port}/pine.html?skip&seed=7`); await page.waitForFunction(() => window.__ready === true); await page.waitForTimeout(500);
const fun = () => page.evaluate(() => { const a = __pine, s = a.sim.s, f = s.fun; return { combo: f.combo, tier: f.tier, best: f.best, jolly: +f.jolly.toFixed(2), frenzy: +f.frenzy.toFixed(1), hop: s.p.hop.n, stock: s.stockN, money: Math.round(s.money), gifts: f.gifts.length, opens: f.opens, orn: f.orn.filter(Boolean).length, trails: f.trails, m: s.month, d: s.day }; });
const shot = (n) => page.screenshot({ path: `${dir}/${n}.png` });
// steer with real keys towards a point until there, or give up
async function driveTo(x, y, ms = 4000) {
  const end = Date.now() + ms; let held = [];
  for (;;) {
    const p = await page.evaluate(() => [__pine.sim.s.p.x, __pine.sim.s.p.y]), dx = x - p[0], dy = y - p[1], d = Math.hypot(dx, dy);
    const want = []; if (dx > 0.4) want.push('KeyD'); if (dx < -0.4) want.push('KeyA'); if (dy > 0.4) want.push('KeyS'); if (dy < -0.4) want.push('KeyW');
    for (const k of held) if (!want.includes(k)) await page.keyboard.up(k); for (const k of want) if (!held.includes(k)) await page.keyboard.down(k); held = want;
    if (d < 1.2 || Date.now() > end) break; await page.waitForTimeout(25);
  }
  for (const k of held) await page.keyboard.up(k); return true;
}
await page.evaluate(() => { const a = __pine, s = a.sim.s; s.tut = false; s.goal = 3; s.month = 10; s.day = 2; s.fun.giftT = 999; s.fun.trailT = 999; s.p.x = 129; s.p.y = 66.5; s.p.tool = 0; });
await page.keyboard.down('Space'); await page.keyboard.down('KeyD'); await page.waitForTimeout(420); await shot('f_combo'); await page.waitForTimeout(250); await page.keyboard.up('KeyD'); await page.keyboard.up('Space');
console.log('combo     ', JSON.stringify(await fun()));
await page.evaluate(() => { __pine.sim.addJolly(1); const s = __pine.sim.s; s.p.x = 129; s.p.y = 70.5; });
await page.waitForTimeout(120); await shot('f_ready');
const before = await fun(); await page.keyboard.press('KeyJ'); await page.waitForTimeout(100);
await page.keyboard.down('Space'); await page.keyboard.down('KeyD'); await page.waitForTimeout(750); await shot('f_jolly'); await page.keyboard.up('KeyD'); await page.keyboard.down('KeyS'); await page.waitForTimeout(500); await page.keyboard.up('KeyS'); await page.keyboard.up('Space'); await page.waitForTimeout(600);
const after = await fun(); console.log('jolly     ', JSON.stringify(after), `stock ${before.stock} -> ${after.stock}`, after.stock > before.stock + 6 ? 'HAULED PAST THE HOPPER' : 'NOT HAULED');
await page.evaluate(() => { const a = __pine, s = a.sim.s; s.fun.frenzy = 0.01; s.p.x = 124; s.p.y = 77; s.fun.gifts = []; a.sim.dropGift(s.p.x + 7, s.p.y); a.sim.dropGift(s.p.x + 34, s.p.y - 9); }); await page.waitForTimeout(650); await shot('f_gift');
await page.waitForTimeout(1200); await driveTo(131, 77, 2500); await page.waitForTimeout(300); await shot('f_open'); console.log('gift      ', JSON.stringify(await fun()));
await page.evaluate(() => { __pine.sim.s.fun.gifts = []; }); await page.keyboard.press('KeyO'); await page.waitForTimeout(250);
await page.evaluate(() => { const f = __pine.sim.s.fun; for (const i of [0, 1, 2, 5, 7, 9, 13, 14, 20, 23]) f.orn[i] = true; f.rows[0] = false; }); await page.waitForTimeout(200); await shot('f_album'); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
// a bell trail on every machine, driven with real keys
for (const veh of [0, 1, 2, 3, 4]) {
  await page.evaluate((v) => { const a = __pine, s = a.sim.s; s.veh = v; s.month = 4; s.day = 2; s.p.x = 128; s.p.y = 74; s.p.vx = s.p.vy = 0; s.fun.trail = null; s.fun.trailT = 0.01; s.fun.giftT = 999; a.r.free = false; }, veh);
  await page.waitForFunction(() => !!__pine.sim.s.fun.trail, null, { timeout: 4000 });
  if (veh === 1) { await page.waitForTimeout(400); await shot('f_trail'); }
  const t0 = Date.now(); let last = -1, stuck = 0;
  for (;;) {
    const t = await page.evaluate(() => { const q = __pine.sim.s.fun.trail; return q ? [q.pts[q.i * 2], q.pts[q.i * 2 + 1], q.i, q.pts.length / 2] : null; });
    if (!t) break; await driveTo(t[0], t[1], 700); if (t[2] === last && ++stuck > 12) break; if (t[2] !== last) stuck = 0; last = t[2];
  }
  const f = await fun(); console.log(`trail v${veh}  `, f.trails, `reached bell ${last + 1}`, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
// christmas in july
await page.evaluate(() => { const a = __pine, s = a.sim.s; s.veh = 1; s.year = 2; s.month = 5; s.day = 30; s.dayF = 0.99; s.tickets = []; a.sim.speed = 1; a.r.free = false; s.p.x = 128.5; s.p.y = 70.5; for (let y = 65; y < 77; y++) for (let x = 129; x < 143; x++) { const i = a.sim.idx(x, y); a.sim.sp[i] = 2; a.sim.h[i] = 6; a.sim.flag[i] = 0; } a.sim.touchAll(); a.sim.recount(); a.sim.refreshCensus(); });
await page.waitForTimeout(1600); await shot('f_july');
const j0 = await fun(); await page.keyboard.down('Space'); await page.keyboard.down('KeyD'); await page.waitForTimeout(900); await page.keyboard.up('KeyD'); await page.keyboard.up('Space');
console.log('july      ', JSON.stringify(await page.evaluate(() => ({ tickets: __pine.sim.s.tickets.map((t) => t.buyer + ' ' + t.days + 'd'), m: __pine.sim.s.month, hop: __pine.sim.s.p.hop.n }))), 'hop before', j0.hop);
// old save: no fun block at all
const r = await page.evaluate(() => { const a = __pine, d = JSON.parse(a.sim.serialize()); delete d.s.fun; a.sim.deserialize(JSON.stringify(d)); return { jolly: a.sim.s.fun.jolly, orn: a.sim.s.fun.orn.length, gifts: a.sim.s.fun.gifts.length }; });
console.log('old save  ', JSON.stringify(r)); await page.waitForTimeout(300);
console.log(errs.slice(0, 8).join('\n') || 'no errors'); await browser.close();
