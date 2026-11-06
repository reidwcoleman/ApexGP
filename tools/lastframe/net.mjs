// Two browsers play: one hosts, one joins by link, both see each other, one shoots the other.
//   node tools/lastframe/net.mjs PORT
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const port = process.argv[2] ?? '5281';
const base = `http://localhost:${port}/lastframe.html`;
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const ctx = () => b.newContext({ viewport: { width: 960, height: 540 } });
const A = await (await ctx()).newPage(), B = await (await ctx()).newPage();
for (const [n, p] of [['host', A], ['guest', B]]) {
  p.on('console', (m) => (m.type() === 'error' || /\[net\]/.test(m.text())) && !/GPU stall/.test(m.text()) && console.log(`[${n}]`, m.type(), m.text().slice(0, 300)));
  p.on('pageerror', (e) => console.log(`[${n}] pageerror`, e.message, (e.stack ?? '').slice(0, 300)));
}
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
await A.goto(base + '?dev=1');
await A.waitForFunction(() => window.__lf, null, { timeout: 180000 });
log('host loaded');
await A.evaluate(() => { const h = __lf.g.hud; h.name = 'Hosty'; h.mode = 'tdm'; h.bots = 2; h.skill = 1; h.openRoom(); });
await A.waitForFunction(() => __lf.g.hud.host?.peer.open, null, { timeout: 30000 });
const code = await A.evaluate(() => __lf.g.hud.code);
log('room', code);
await B.goto(`${base}?dev=1&join=${code}`);
await B.waitForFunction(() => window.__lf, null, { timeout: 180000 });
log('guest loaded');
await A.waitForFunction(() => __lf.g.hud.lobbyPlayers.length === 2, null, { timeout: 40000 });
log('guest in lobby', await A.evaluate(() => __lf.g.hud.lobbyPlayers.map((p) => [p.name, p.team])));
await A.evaluate(() => __lf.g.hud.startHosted());
await B.waitForFunction(() => __lf.g.inMatch && __lf.g.mySlot >= 0, null, { timeout: 20000 });
log('both in match');
await A.waitForFunction(() => __lf.g.me.alive, null, { timeout: 20000 });
await B.waitForFunction(() => __lf.g.me.alive, null, { timeout: 20000 });
await A.waitForTimeout(6500);
// stop the bots shooting, stand them face to face
await A.evaluate(() => { const g = __lf.g; for (const [s, bt] of g.match.bots) { bt.update = () => {}; } });
const pos = await A.evaluate(() => { const g = __lf.g; Object.assign(g.me.m, { x: 40, y: 0, z: -40, vx: 0, vz: 0 }); g.me.yaw = 0; return g.mySlot; });
await B.evaluate(() => { const g = __lf.g; Object.assign(g.me.m, { x: 40, y: 0, z: -52, vx: 0, vz: 0 }); g.me.yaw = Math.PI; });
await A.waitForTimeout(1200);
const seen = await B.evaluate((s) => { const a = __lf.g.actors.get(s); return [a.x, a.y, a.z].map((v) => +v.toFixed(2)); }, pos);
const seenB = await A.evaluate(() => { const g = __lf.g; const b = [...g.actors.values()].find((a) => !a.info.bot && a.info.slot !== g.mySlot); return [b.x, b.y, b.z].map((v) => +v.toFixed(2)); });
log('guest sees host at', seen, '; host sees guest at', seenB);
const hp0 = await A.evaluate(() => __lf.g.player(__lf.g.mySlot).hp);
// the guest shoots the host: aim and hold the trigger
await B.evaluate((s) => {
  const g = __lf.g, a = g.actors.get(s), m = g.me.m;
  const t = setInterval(() => {
    const dx = a.x - m.x, dz = a.z - m.z;
    g.me.yaw = Math.atan2(-dx, -dz);
    g.me.pitch = Math.atan2(a.y + 1.15 - (m.y + 1.63), Math.hypot(dx, dz));
    g.input.ads = true;
    g.input.fire = true;
  }, 30);
  setTimeout(() => { clearInterval(t); g.input.fire = false; }, 2600);
}, pos);
await A.waitForTimeout(3200);
const r = await A.evaluate(() => { const g = __lf.g, me = g.player(g.mySlot); return { hp: me.hp, alive: me.alive, deaths: me.deaths, kills: g.match.players.map((p) => `${p.name}:${p.kills}/${p.deaths}`) }; });
log('host hp before', hp0, 'after', r);
const r2 = await B.evaluate(() => { const g = __lf.g; return { score: g.score, ammo: g.me.ammo.get(g.me.weapon), roster: [...g.actors.values()].map((a) => `${a.info.name}:${a.info.kills}`) }; });
log('guest view', r2);
// a door opened by the guest shows on the host
await B.evaluate(() => { const g = __lf.g; g.ctx.send.door(3, [g.me.m.x, 0, g.me.m.z]); });
await A.waitForTimeout(800);
log('door', await A.evaluate(() => __lf.g.L.doors[3].want), await B.evaluate(() => __lf.g.L.doors[3].want));
await b.close();
