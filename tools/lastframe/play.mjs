// Plays a solo match headless:  node tools/lastframe/play.mjs PORT OUTDIR [seconds] [mode]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, secs = '30', mode = 'tdm'] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') { if (!/GPU stall|GL Driver|THREE.Clock|AudioContext/.test(m.text())) { if (errs++ < 12) console.log(m.type(), m.text().slice(0, 500)); } } });
p.on('pageerror', (e) => { if (errs++ < 12) console.log('pageerror', e.message, (e.stack ?? '').slice(0, 400)); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1${process.env.MAP ? "&map=" + process.env.MAP : ""}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
console.log('loaded', await p.evaluate(() => { const g = __lf.g; return { nav: g.nav.nodes.length, tris: __lf.r.info.render.triangles, calls: __lf.r.info.render.calls }; }));
await p.screenshot({ path: `${out}/menu.png` });
await p.evaluate((mode) => {
  const g = __lf.g;
  g.startSolo({ mode, bots: 4, skill: 0.5, time: 8, limit: 40, seed: 3 }, 'Tester', 0, 'carbine');
}, mode);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/spawn.png` });
if (process.env.AUTO) await p.evaluate(() => {
  // a crude player: walks toward the nearest enemy along the nav, shoots what it sees
  const g = __lf.g;
  let path = [], at = 0, next = 0;
  setInterval(() => {
    const m = g.me.m, me = g.me;
    if (!me.alive) { g.input.fire = false; return; }
    const foes = [...g.actors.values()].filter((a) => a.info.alive && a.info.team !== 0);
    foes.sort((a, b) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(b.x - m.x, b.z - m.z));
    const t = foes[0];
    if (!t) return;
    const seen = g.L.world.sees({ x: m.x, y: m.y + 1.6, z: m.z }, { x: t.x, y: t.y + 1.2, z: t.z });
    if (seen) {
      const dx = t.x - m.x, dz = t.z - m.z, d = Math.hypot(dx, dz);
      me.yaw = Math.atan2(-dx, -dz);
      me.pitch = Math.atan2(t.y + 1.2 - (m.y + 1.6), d);
      g.input.ads = d > 8;
      g.input.fire = true;
      g.input.firePressed = true;
      g.input.keys.delete('KeyW');
      if (me.ammo.get(me.weapon).mag === 0) g.input.pressed.add('KeyR');
    } else {
      g.input.fire = false;
      g.input.ads = false;
      const now = performance.now();
      if (now > next) {
        next = now + 1500;
        const a = g.nav.nearest(m.x, m.y, m.z), b = g.nav.nearest(t.x, t.y, t.z);
        if (a && b) { path = g.nav.path(a, b); at = 1; }
      }
      if (path[at]) {
        const n = path[at], dx = n.x - m.x, dz = n.z - m.z;
        if (Math.hypot(dx, dz) < 0.6) at++;
        me.yaw = Math.atan2(-dx, -dz);
        me.pitch = 0;
        g.input.keys.add('KeyW');
        g.match.openDoorsNear(m.x, m.y, m.z, dx, dz);
      }
    }
  }, 50);
});
const t0 = Date.now();
let n = 0;
while (Date.now() - t0 < Number(secs) * 1000) {
  await p.waitForTimeout(5000);
  const s = await p.evaluate(() => {
    const g = __lf.g, m = g.match;
    return { phase: g.phase, clock: Math.round(g.clock), score: g.score, kills: m.players.map((q) => `${q.name[0]}${q.kills}/${q.deaths}${q.alive ? '' : 'x'}`).join(' '), meHp: g.player(g.mySlot)?.hp, pos: [g.me.m.x, g.me.m.y, g.me.m.z].map((v) => +v.toFixed(1)), bots: [...m.bots.values()].slice(0, 3).map((q) => [q.m.x, q.m.z].map((v) => +v.toFixed(0)).join(',')).join(' ') };
  });
  console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(s));
  await p.screenshot({ path: `${out}/t${n++}.png` });
}
await b.close();
console.log('errors', errs);
