// Two browsers play the attack-and-defend game: one hosts, one joins. Does the guest get the room, the boards, the cameras,
// a hole in a wall it asked for, and being put on the floor?   node tools/lastframe/netsiege.mjs PORT [map]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const port = process.argv[2] ?? '5281';
const map = process.argv[3] ?? 'ward';
const base = `http://localhost:${port}/lastframe.html`;
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const ctx = () => b.newContext({ viewport: { width: 640, height: 360 } });
const A = await (await ctx()).newPage(), B = await (await ctx()).newPage();
let errs = 0;
for (const [n, p] of [['host', A], ['guest', B]]) {
  p.on('pageerror', (e) => { errs++; console.log(`[${n}] pageerror`, e.message, (e.stack ?? '').slice(0, 300)); });
}
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const ok = (name, v, extra = '') => console.log(`${v ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
await A.goto(`${base}?dev=1&map=${map}`);
await A.waitForFunction(() => window.__lf, null, { timeout: 300000 });
await A.evaluate(() => { const h = __lf.g.hud; h.name = 'Hosty'; h.mode = 'siege'; h.bots = 4; h.skill = 1; h.openRoom(); });
await A.waitForFunction(() => __lf.g.hud.host?.peer.open, null, { timeout: 40000 });
const code = await A.evaluate(() => __lf.g.hud.code);
log('room', code);
await B.goto(`${base}?dev=1&map=${map}&join=${code}`);
await B.waitForFunction(() => window.__lf, null, { timeout: 300000 });
await A.waitForFunction(() => __lf.g.hud.lobbyPlayers.length === 2, null, { timeout: 60000 });
log('guest in lobby', JSON.stringify(await A.evaluate(() => __lf.g.hud.lobbyPlayers.map((p) => [p.name, p.team]))));
await B.evaluate(() => { __lf.g.kits = ['scout', 'medic']; });
await A.evaluate(() => __lf.g.hud.startHosted());
await B.waitForFunction(() => __lf.g.inMatch && __lf.g.mySlot >= 0, null, { timeout: 40000 });
log('both in match');
// the preparation, as each sees it
await A.waitForFunction(() => __lf.g.match.phase === 'prep' && __lf.g.match.clock < 8, null, { timeout: 60000 });
await B.waitForTimeout(500);
const hs = await A.evaluate(() => { const m = __lf.g.match; return { room: m.objName(), atk: m.atk, bars: m.bars.map((x, i) => x ? i + ':' + x : '').filter(Boolean).join(','), cams: m.cams.length, sheets: m.sheets.length, trips: m.trips.size, kits: m.players.filter((q) => !q.bot).map((q) => q.kits) }; });
const gs = await B.evaluate(() => { const g = __lf.g; return { phase: g.phase, room: g.objName, atk: g.siegeAtk, bars: g.forts.map((f, i) => f.boards ? i + ':' + f.boards : '').filter(Boolean).join(','), cams: g.gear.cams.length, sheets: g.walls.sheets.length, trips: g.gear.trips.size, team: g.player(g.mySlot)?.team }; });
log('host', JSON.stringify(hs));
log('guest', JSON.stringify(gs));
ok('guest is in the preparation', gs.phase === 'prep');
ok('same room on both', hs.room === gs.room, hs.room);
ok('same boards on both', hs.bars === gs.bars && hs.bars.length > 0, hs.bars);
ok('same cameras on both', hs.cams === gs.cams && hs.cams > 0, String(hs.cams));
ok('same steel sheets on both', hs.sheets === gs.sheets, String(hs.sheets));
ok('same tripwires on both', hs.trips === gs.trips, String(hs.trips));
ok("the guest's kits reached the host", JSON.stringify(hs.kits).includes('scout'), JSON.stringify(hs.kits));
// the round is on. The guest asks for a hole in a wall of the room (as an attacker would), standing at it
await A.waitForFunction(() => __lf.g.match.phase === 'live', null, { timeout: 30000 });
const site = await A.evaluate(() => { const m = __lf.g.match; m.tactics.sites = m.tactics.sites.length ? m.tactics.sites : []; const s = m.tactics.sites.find((q) => !m.sheeted(q)) ?? null; return s ? { arr: [s.ax, s.c, s.u0, s.u1, s.y0, s.y1, s.t], inw: m.tactics.siteIn(s) } : null; });
if (site) {
  const guestAttacks = gs.team === hs.atk;
  // whoever of the two people is attacking does it
  const P = guestAttacks ? B : A;
  await P.evaluate((s) => { const g = __lf.g, a = s.arr; const u = (a[2] + a[3]) / 2; Object.assign(g.me.m, { x: a[0] ? u : a[1] - s.inw * 1.1, y: a[4], z: a[0] ? a[1] - s.inw * 1.1 : u, vx: 0, vz: 0 }); }, site);
  await P.waitForTimeout(700);
  await P.evaluate((s) => __lf.g.req({ t: 'wcharge', site: s.arr, side: -s.inw }), site);
  await A.waitForTimeout(4200);
  const [ha, hb] = [await A.evaluate(() => [__lf.g.match.holes.length, __lf.g.walls.holes.length]), await B.evaluate(() => [__lf.g.walls.holes.length])];
  ok(`a wall charge set by the ${guestAttacks ? 'guest' : 'host'} blew a hole on both`, ha[0] === 1 && ha[1] === 1 && hb[0] === 1, `host ${ha} guest ${hb}`);
} else log('this room has no wall a hole could go in: skipped');
// the guest is shot down, not dead
const down = await A.evaluate(() => { const g = __lf.g, m = g.match; const guest = m.players.find((q) => !q.bot && q.slot !== g.mySlot); const foe = m.players.find((q) => q.bot && q.alive && q.team !== guest.team); if (!guest?.alive || !foe) return null; guest.hp = 100; m.damage(foe.slot, guest.slot, 500, 1, 0, [0, 0, 1], 5); return { down: !!guest.down, alive: guest.alive }; });
await B.waitForTimeout(800);
const gd = await B.evaluate(() => ({ down: __lf.g.me.down, alive: __lf.g.me.alive, prompt: document.querySelector('.prompt')?.textContent }));
log('host says', JSON.stringify(down), 'guest says', JSON.stringify(gd));
if (down) ok('the guest is on the floor on both', down.down && gd.down && gd.alive);
// and got up again by the host's word
const up = await A.evaluate(() => { const g = __lf.g, m = g.match; const guest = m.players.find((q) => !q.bot && q.slot !== g.mySlot); if (!guest?.down) return null; const mate = m.players.find((q) => q.alive && !q.down && q.team === guest.team && q.slot !== guest.slot); if (!mate) return null; const gb = m.bodies[guest.slot]; if (mate.bot) Object.assign(m.bots.get(mate.slot).m, { x: gb.x + 0.8, y: gb.y, z: gb.z }); Object.assign(m.bodies[mate.slot], { x: gb.x + 0.8, y: gb.y, z: gb.z }); return m.revive(mate.slot, guest.slot); });
await B.waitForTimeout(800);
if (up !== null) ok('a teammate got the guest up', up === true && !(await B.evaluate(() => __lf.g.me.down)));
await A.waitForTimeout(6000);
ok('no page errors on either', errs === 0, String(errs));
await b.close();
