// Wobble Mania online: can everyone see the ball? A host and a guest play a ball game side by
// side; every few seconds the host's ball is dropped through a hoop or into a goal (so the round
// has its restarts in it). Fails if the guest's ball is ever not drawn, not a real position, or
// not where the host's is while the host's is in play.
//   node tools/wobbleball.mjs [--port 5197] [--round beanhoops] [--secs 60] [--out dir]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const round = opt('round', 'beanhoops');
const secs = Number(opt('secs', 60));
const out = opt('out', '');
if (out) fs.mkdirSync(out, { recursive: true });
const base = `http://localhost:${port}/marbles.html`;
let browser;
for (let tries = 0; tries < 6 && !browser; tries++) {
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    await (await browser.newPage()).close();
  } catch {
    await browser?.close().catch(() => undefined);
    browser = undefined;
    await new Promise((r) => setTimeout(r, 4000));
  }
}
if (!browser) { console.log('FAIL: the browser would not start'); process.exit(1); }
const errs = [];
const page = async (name) => {
  const p = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
  p.on('pageerror', (e) => errs.push(`${name}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !/Failed to load|WebSocket|ERR_/.test(m.text()) && errs.push(`${name}: ${m.text().slice(0, 160)}`));
  return p;
};
const A = await page('host'), B = await page('guest');
await A.goto(`${base}?lineup=${round},gatecrashers&auto=1&settle=100`);
await A.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await A.evaluate(() => window.__marbles.hostParty());
await A.waitForFunction(() => window.__marbles.host?.code && window.__marbles.host.peer.open, null, { timeout: 30000 });
const code = await A.evaluate(() => window.__marbles.host.code);
await B.goto(`${base}?join=${code}&auto=1&settle=100`);
await B.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await A.waitForFunction(() => window.__marbles.members.length === 2, null, { timeout: 40000 });
await A.waitForTimeout(1500);
await Promise.all([A, B].map((p) => p.evaluate(() => (window.__marbles.autopilot = true))));
await A.evaluate(() => [...document.querySelectorAll('button')].find((b) => /start/i.test(b.textContent))?.click());
await Promise.all([A, B].map((p) => p.waitForFunction(() => window.__marbles.state === 'play', null, { timeout: 90000 })));
const snap = () => {
  const g = window.__marbles, P = g.cupP;
  if (!P) return null;
  const cam = g.camera;
  cam.updateMatrixWorld();
  return P.arena.balls.map((b, i) => {
    const m = P.meshes[i];
    const v = m.position.clone().project(cam);
    return { live: b.live, back: !!b.backAt, p: b.pos.toArray().map((q) => +q.toFixed(1)), mesh: m.position.toArray().map((q) => +q.toFixed(1)), vis: m.visible, inScene: !!m.parent, scale: +m.scale.x.toFixed(2), screen: [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(3)], score: P.score.join('-'), state: g.state, t: +g.playT.toFixed(1) };
  });
};
const rows = [];
let n = 0, baskets = 0;
const t0 = Date.now();
while ((Date.now() - t0) / 1000 < secs) {
  await A.waitForTimeout(1000);
  const [a, b] = await Promise.all([A.evaluate(snap), B.evaluate(snap)]);
  if (!a || !b || a[0].state !== 'play' || b[0].state !== 'play') break;
  rows.push({ a: a[0], b: b[0] });
  if (out && n % 6 === 3) await Promise.all([A.screenshot({ path: `${out}/${round}-${n}-host.png` }), B.screenshot({ path: `${out}/${round}-${n}-guest.png` })]);
  // every eight seconds the host's ball goes in: down through a hoop, or over a goal line
  if (++n % 8 === 0) {
    baskets++;
    await A.evaluate((k) => {
      const g = window.__marbles, P = g.cupP, Ar = P.arena, b = Ar.balls[0], C = P.cfg;
      if (!b.live) return;
      if (Ar.hoops?.length) {
        const H = Ar.hoops[k % 2];
        b.pos.set(H.x, H.y + 1.6, H.z);
        b.vel.set(0, -3, 0);
        b.py = b.pos.y;
      } else if (C.goalHalf > 0) {
        b.pos.set(Ar.center.x, Ar.center.y + C.R, Ar.center.z + (k % 2 ? -1 : 1) * (C.HL - 0.5));
        b.vel.set(0, 0, (k % 2 ? -1 : 1) * 14);
      }
    }, baskets);
  }
}
let bad = 0;
const fin = (p) => p.every((v) => Number.isFinite(v));
let hidden = 0, nan = 0, apart = 0, off = 0, both = 0;
for (const { a, b } of rows) {
  if (!b.vis || !b.inScene || b.scale < 0.5) hidden++;
  if (!fin(b.p) || !fin(b.mesh)) nan++;
  if (a.live && b.live) {
    both++;
    const d = Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1], a.p[2] - b.p[2]);
    if (!(d < 4)) apart++;
  }
  if (a.live && !b.live) off++;
}
console.log(`${round}: ${rows.length} looks, ${baskets} forced in, final score host ${rows.at(-1)?.a.score} guest ${rows.at(-1)?.b.score}`);
console.log(`guest's ball: not drawn ${hidden}, not a number ${nan}, away from the host's ${apart} of ${both}, dead while the host's was in play ${off}`);
for (const { a, b } of rows.filter((r, k) => k % 5 === 0 || !fin(r.b.p)).slice(0, 14)) console.log(`  t ${a.t} host ${a.live ? 'live' : 'dead'} ${a.p.join(',')} | guest ${b.live ? 'live' : 'dead'} ${b.p.join(',')} mesh ${b.mesh.join(',')} vis ${b.vis} screen ${b.screen.join(',')}`);
if (hidden || nan || apart > 1 || off > 2 || rows.length < 10 || errs.length) bad = 1;
if (errs.length) console.log('errors:', [...new Set(errs)].slice(0, 3).join(' | '));
console.log(bad ? 'FAIL' : 'PASS');
await browser.close().catch(() => undefined);
process.exit(bad);
