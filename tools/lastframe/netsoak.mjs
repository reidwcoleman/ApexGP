// Playing with friends, on purpose on bad lines: one browser hosts, two join with lag, wobble and lost packets, everyone
// walks about and shoots. Measured: how far what a guest is shown is from where people really were, whether anyone jumps or
// stalls on screen, whether every browser agrees on the round, the clock, the score and who is alive; then a guest drops
// out, another arrives in the middle, the host's tab goes unseen, the host starts a rematch, and the host leaves.
//   node tools/lastframe/netsoak.mjs PORT [map] [mode]        NET1=60,40,0.05 NET2=140,70,0.1 to change the guests' lines
//   (lag, wobble in ms, share of position packets lost), NET0 the same for everything the host sends
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const port = process.argv[2] ?? '5281';
const map = process.argv[3] ?? 'ward';
const mode = process.argv[4] ?? 'tdm';
const NET1 = process.env.NET1 ?? '60,40,0.05', NET2 = process.env.NET2 ?? '140,70,0.1';
const base = `http://localhost:${port}/lastframe.html`;
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const page = async (name) => {
  const p = await (await b.newContext({ viewport: { width: 480, height: 270 } })).newPage();
  p.on('pageerror', (e) => { errs.push(`[${name}] ${e.message} ${(e.stack ?? '').slice(0, 300)}`); });
  p.on('console', (m) => { if (/\[net\]/.test(m.text())) console.log(`   [${name}] ${m.text().slice(0, 200)}`); if (m.type() === 'error' && !/GPU stall|GL Driver|AudioContext|net::ERR|Failed to load resource/.test(m.text())) errs.push(`[${name}] console: ${m.text().slice(0, 300)}`); });
  return p;
};
const errs = [];
let fails = 0;
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const ok = (name, v, extra = '') => { if (!v) fails++; console.log(`${v ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a crude player for whoever sits at this browser: walks the building, shoots what it sees
const AUTO = () => {
  const g = __lf.g;
  let path = [], at = 0, next = 0;
  window.__auto = setInterval(() => {
    const m = g.me.m, me = g.me;
    if (!g.inMatch || !me.alive || me.down) { g.input.fire = false; g.input.keys.delete('KeyW'); return; }
    const mine = g.actors.get(g.mySlot)?.info.team;
    const foes = [...g.actors.values()].filter((a) => a.info.alive && (a.info.team !== mine || mine === 2) && a.info.slot !== g.mySlot && a.y > -20);
    foes.sort((a, c) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(c.x - m.x, c.z - m.z));
    const t = foes[0];
    const seen = t && g.L.world.sees({ x: m.x, y: m.y + 1.6, z: m.z }, { x: t.x, y: t.y + 1.2, z: t.z });
    if (seen && g.phase === 'live') {
      const dx = t.x - m.x, dz = t.z - m.z, d = Math.hypot(dx, dz);
      me.yaw = Math.atan2(-dx, -dz);
      me.pitch = Math.atan2(t.y + 1.2 - (m.y + 1.6), d);
      g.input.fire = true;
      g.input.firePressed = true;
      g.input.keys.delete('KeyW');
      if (me.ammo.get(me.weapon)?.mag === 0) g.input.pressed.add('KeyR');
      return;
    }
    g.input.fire = false;
    const now = performance.now();
    if (now > next || !path[at]) {
      next = now + 4000;
      const a = g.nav.nearest(m.x, m.y, m.z);
      const c = t && Math.random() < 0.6 ? g.nav.nearest(t.x, t.y, t.z) : g.nav.nodes[Math.floor(Math.random() * g.nav.nodes.length)];
      if (a && c) { path = g.nav.path(a, c); at = 1; }
    }
    if (path[at]) {
      const n = path[at], dx = n.x - m.x, dz = n.z - m.z;
      if (Math.hypot(dx, dz) < 0.6) at++;
      me.yaw = Math.atan2(-dx, -dz);
      me.pitch = 0;
      g.input.keys.add('KeyW');
      if (Math.hypot(m.vx, m.vz) < 0.3 && g.forts?.some((f) => f.boards && Math.hypot(f.o.x - m.x, f.o.z - m.z) < 1.8)) g.input.pressed.add('KeyZ');
    }
  }, 50);
};

// every frame: where this browser draws everyone, and where it is itself
const SAMPLE = () => {
  const g = __lf.g;
  window.__samples = [];
  window.__jumps = [];
  const prev = new Map();
  const f = () => {
    if (!window.__samples) return;
    const t = performance.timeOrigin + performance.now();
    const row = { t, me: g.me.alive ? [g.mySlot, g.me.m.x, g.me.m.z] : null, a: [] };
    for (const [s, a] of g.actors) {
      if (s === g.mySlot || a.y < -20) continue;
      const alive = a.info.alive && !a.info.down;
      row.a.push([s, a.x, a.z, alive ? 1 : 0]);
      const p = prev.get(s);
      // someone alive on both frames who moved further than a sprint covers in that time
      if (p && alive && p.alive && !a.spawnAt) {
        const d = Math.hypot(a.x - p.x, a.z - p.z), dt = (t - p.t) / 1000;
        if (d > 0.5 && d > 9 * dt + 0.25) window.__jumps.push({ s, d: +d.toFixed(2), dt: +dt.toFixed(3), bot: a.info.bot });
      }
      prev.set(s, { x: a.x, z: a.z, t, alive: alive && performance.now() / 1000 - a.spawnT > 2 });
    }
    // and on the host, where the bots really are
    if (g.match) row.truth = g.match.players.filter((p) => p.bot && p.alive).map((p) => [p.slot, g.match.bodies[p.slot].x, g.match.bodies[p.slot].z]);
    window.__samples.push(row);
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
};
const take = (p) => p.evaluate(() => { const s = window.__samples, j = window.__jumps; window.__samples = null; return { s, j }; });

/** how far what `shown` drew is from where `truth` says it was, once the constant delay is taken out */
function compare(truth, shown) {
  // truth: [{t, x, z}] in time order; shown the same
  if (truth.length < 30 || shown.length < 30) return null;
  const at = (arr, t) => {
    let lo = 0, hi = arr.length - 1;
    if (t <= arr[0].t || t >= arr[hi].t) return null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m].t <= t) lo = m; else hi = m; }
    const a = arr[lo], c = arr[hi];
    if (c.t - a.t > 120) return null;
    const k = (t - a.t) / (c.t - a.t || 1);
    return { x: a.x + (c.x - a.x) * k, z: a.z + (c.z - a.z) * k };
  };
  let best = null;
  for (let lag = 0; lag <= 700; lag += 10) {
    const e = [];
    for (const q of shown) {
      const p = at(truth, q.t - lag);
      if (p) e.push(Math.hypot(p.x - q.x, p.z - q.z));
    }
    if (e.length < 30) continue;
    const mean = e.reduce((a, c) => a + c, 0) / e.length;
    if (!best || mean < best.mean) {
      e.sort((a, c) => a - c);
      best = { lag, mean, p95: e[Math.floor(e.length * 0.95)], max: e[e.length - 1], n: e.length };
    }
  }
  return best;
}

const state = (p) => p.evaluate(() => {
  const g = __lf.g;
  const list = (g.match ? g.match.players : [...g.actors.values()].map((a) => a.info)).map((q) => `${q.slot}:${q.team}:${q.bot ? 'b' : 'h'}:${q.alive ? 1 : 0}${q.down ? 'd' : ''}:${q.kills}/${q.deaths}:${q.name}`).sort().join(' ');
  return { in: g.inMatch, phase: g.phase, round: g.round, clock: +g.clock.toFixed(2), score: g.score.join('-'), list, slot: g.mySlot, alive: g.me.alive, role: g.role };
});
const agree = async (name, pages) => {
  // a moment for what is on the wire to land
  let ss = [];
  for (let k = 0; k < 8; k++) {
    ss = await Promise.all(pages.map((p) => state(p)));
    if (ss.every((s) => s.list === ss[0].list && s.phase === ss[0].phase && s.score === ss[0].score)) break;
    await sleep(350);
  }
  const same = (f) => ss.every((s) => f(s) === f(ss[0]));
  ok(`${name}: same phase and round on all`, same((s) => s.phase + s.round), ss.map((s) => s.phase + s.round).join(' | '));
  ok(`${name}: same score on all`, same((s) => s.score), ss.map((s) => s.score).join(' | '));
  ok(`${name}: same roster (teams, alive, kills) on all`, same((s) => s.list), same((s) => s.list) ? `${ss[0].list.split(' ').length} players` : '\n   ' + ss.map((s) => s.list).join('\n   '));
  const spread = Math.max(...ss.map((s) => s.clock)) - Math.min(...ss.map((s) => s.clock));
  ok(`${name}: clocks within half a second`, spread < 0.5, spread.toFixed(2) + ' s apart');
  return ss;
};

// ------------------------------------------------------------------ the room
const H = await page('host');
await H.goto(`${base}?dev=1&nodraw=1&map=${map}${process.env.NET0 ? '&net=' + process.env.NET0 : ''}`);
await H.waitForFunction(() => window.__lf, null, { timeout: 300000 });
await H.evaluate((mode) => { const h = __lf.g.hud; h.name = 'Hosty'; h.mode = mode; h.bots = 4; h.skill = 0.6; h.openRoom(); }, mode);
await H.waitForFunction(() => __lf.g.hud.host?.peer.open, null, { timeout: 40000 });
const code = await H.evaluate(() => __lf.g.hud.code);
log('room', code, 'mode', mode, 'lines', NET1, '/', NET2);
const G1 = await page('guest1'), G2 = await page('guest2');
await Promise.all([G1.goto(`${base}?dev=1&nodraw=1&map=${map}&join=${code}&net=${NET1}`), G2.goto(`${base}?dev=1&nodraw=1&map=${map}&join=${code}&net=${NET2}`)]);
await Promise.all([G1, G2].map((p) => p.waitForFunction(() => window.__lf, null, { timeout: 300000 })));
await H.waitForFunction(() => __lf.g.hud.lobbyPlayers.length === 3, null, { timeout: 60000 });
ok('both guests reached the lobby', true, JSON.stringify(await H.evaluate(() => __lf.g.hud.lobbyPlayers.map((p) => [p.name, p.team]))));
await H.evaluate(() => __lf.g.hud.startHosted());
await Promise.all([G1, G2].map((p) => p.waitForFunction(() => __lf.g.inMatch && __lf.g.mySlot >= 0, null, { timeout: 40000 })));
await H.waitForFunction(() => __lf.g.match.phase === 'live', null, { timeout: 90000 });
await Promise.all([G1, G2].map((p) => p.waitForFunction(() => __lf.g.phase === 'live' && __lf.g.me.alive, null, { timeout: 20000 })));
log('all three in a live match');
for (const p of [H, G1, G2]) await p.evaluate(AUTO);
await sleep(4000);
await agree('start', [H, G1, G2]);

// ------------------------------------------------------------------ how true the picture is
for (const p of [H, G1, G2]) await p.evaluate(SAMPLE);
await sleep(25000);
const [sh, s1, s2] = await Promise.all([H, G1, G2].map(take));
const fps = (s) => (s.s.length / ((s.s[s.s.length - 1].t - s.s[0].t) / 1000)).toFixed(0);
log(`frames a second: host ${fps(sh)}, guest1 ${fps(s1)}, guest2 ${fps(s2)}`);
const series = (rows, pick) => { const m = new Map(); for (const r of rows) for (const e of pick(r)) { if (!m.has(e[0])) m.set(e[0], []); m.get(e[0]).push({ t: r.t, x: e[1], z: e[2], on: e[3] ?? 1 }); } return m; };
const truthBots = series(sh.s, (r) => r.truth ?? []);
const truthOf = new Map(truthBots);
for (const [s, rows] of [[sh, sh.s], [s1, s1.s], [s2, s2.s]]) {
  void s;
  const mine = rows.filter((r) => r.me);
  if (mine.length) truthOf.set(mine[0].me[0], mine.map((r) => ({ t: r.t, x: r.me[1], z: r.me[2] })));
}
const report = (name, shown, slots, limit) => {
  const out = [];
  for (const s of slots) {
    const tr = truthOf.get(s), sw = (shown.get(s) ?? []).filter((q) => q.on);
    if (!tr || !sw.length) continue;
    const c = compare(tr, sw);
    if (c) out.push({ s, ...c });
  }
  if (!out.length) return log(name, 'nothing to compare');
  const worst = out.reduce((a, c) => (c.p95 > a.p95 ? c : a));
  const mean = out.reduce((a, c) => a + c.mean, 0) / out.length;
  const lag = out.reduce((a, c) => a + c.lag, 0) / out.length;
  ok(`${name}: drawn where they were`, mean < limit && worst.p95 < limit * 3.2, `${out.length} players, behind by ${lag.toFixed(0)} ms, off by ${(mean * 100).toFixed(1)} cm on average, worst player's 95th percentile ${(worst.p95 * 100).toFixed(0)} cm`);
};
const botSlots = [...truthBots.keys()];
const people = await H.evaluate(() => __lf.g.match.players.filter((p) => !p.bot).map((p) => p.slot));
const [hs, g1s, g2s] = await Promise.all([H, G1, G2].map((p) => p.evaluate(() => __lf.g.mySlot)));
report('guest 1 (bad line) sees the bots', series(s1.s, (r) => r.a), botSlots, 0.12);
report('guest 2 (worse line) sees the bots', series(s2.s, (r) => r.a), botSlots, 0.16);
report('guest 1 sees the host', series(s1.s, (r) => r.a), [hs], 0.12);
report('the host sees guest 1', series(sh.s, (r) => r.a), [g1s], 0.12);
report('the host sees guest 2', series(sh.s, (r) => r.a), [g2s], 0.2);
report('guest 1 sees guest 2 (through the host)', series(s1.s, (r) => r.a), [g2s], 0.24);
report('guest 2 sees guest 1 (through the host)', series(s2.s, (r) => r.a), [g1s], 0.24);
void people;
for (const [n, s] of [['host', sh], ['guest 1', s1], ['guest 2', s2]]) {
  ok(`${n}: nobody jumps on screen`, s.j.length <= 1, s.j.length ? JSON.stringify(s.j.slice(0, 6)) : 'no jumps in 25 s');
}
await agree('after 30 s of fighting', [H, G1, G2]);

// ------------------------------------------------------------------ the host's tab goes unseen
const before = await Promise.all([state(H), state(G1)]);
const botAt = () => G1.evaluate(() => [...__lf.g.actors.values()].filter((a) => a.info.bot && a.info.alive).map((a) => [a.info.slot, a.x, a.z]));
const b0 = await botAt();
await H.evaluate(() => { window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; });
await sleep(8000);
const b1 = await botAt();
const mid = await state(G1);
const moved = b0.filter(([s, x, z]) => { const q = b1.find((e) => e[0] === s); return q && Math.hypot(q[1] - x, q[2] - z) > 1; }).length;
ok("host's tab unseen for 8 s: the bots keep moving for the guests", moved >= (mode === 'siege' ? 1 : 2), `${moved} of ${b0.length} bots moved more than a metre`);
ok("host's tab unseen: the guests' clock keeps running", Math.abs(before[1].clock - mid.clock - 8) < 1.5 || mid.phase !== before[1].phase, `${before[1].clock} -> ${mid.clock}`);
ok("host's tab unseen: the guests stay connected", mid.in);
await H.evaluate(() => { window.requestAnimationFrame = window.__raf; window.requestAnimationFrame(__lf.g.loop); });
await sleep(1500);
await agree('host back', [H, G1, G2]);

// ------------------------------------------------------------------ a guest drops out
const g2slot = g2s;
await G2.context().close();
await H.waitForFunction((s) => __lf.g.match.players.find((p) => p.slot === s)?.bot === true, g2slot, { timeout: 25000 }).catch(() => {});
const after = await H.evaluate((s) => { const m = __lf.g.match, p = m.players.find((q) => q.slot === s); return p ? { bot: p.bot, name: p.name, alive: p.alive, hasBot: m.bots.has(s), n: m.players.length } : null; }, g2slot);
ok('guest 2 closed the tab: a bot has their place', !!after && after.bot && after.hasBot, JSON.stringify(after));
await sleep(6000);
const walks = await H.evaluate((s) => { const m = __lf.g.match, p = m.players.find((q) => q.slot === s), bt = m.bots.get(s); return { alive: p.alive, x: bt?.m.x, z: bt?.m.z }; }, g2slot);
await sleep(4000);
const walks2 = await H.evaluate((s) => { const m = __lf.g.match, p = m.players.find((q) => q.slot === s), bt = m.bots.get(s); return { alive: p.alive, x: bt?.m.x, z: bt?.m.z }; }, g2slot);
// with one life a round, someone who had already fallen when they left stays fallen: their bot is in from the next round
if (mode === 'siege' || mode === 'rounds') ok('that bot plays on (or waits for the next round, if they had already fallen)', (!walks.alive && !walks2.alive) || Math.hypot(walks2.x - walks.x, walks2.z - walks.z) > 0.2 || walks.alive, JSON.stringify([walks, walks2]));
else ok('that bot plays on (alive or back in, and moving)', (walks.alive || walks2.alive) && Math.hypot(walks2.x - walks.x, walks2.z - walks.z) > 0.5, JSON.stringify([walks, walks2]));
await agree('after the drop', [H, G1]);

// ------------------------------------------------------------------ someone arrives in the middle
const G3 = await page('guest3');
await G3.goto(`${base}?dev=1&nodraw=1&map=${map}&join=${code}&net=${NET1}`);
await G3.waitForFunction(() => window.__lf?.g.inMatch && __lf.g.mySlot >= 0, null, { timeout: 300000 });
await G3.evaluate(AUTO);
await sleep(2500);
const j = await state(G3);
log('late joiner', JSON.stringify({ phase: j.phase, slot: j.slot, alive: j.alive, clock: j.clock }));
ok('late joiner is in the match with a slot of their own', j.in && j.slot >= 0 && j.phase !== 'warmup');
if (mode === 'tdm' || mode === 'ffa' || mode === 'gun') {
  await G3.waitForFunction(() => __lf.g.me.alive, null, { timeout: 15000 }).catch(() => {});
  ok('late joiner is on their feet', await G3.evaluate(() => __lf.g.me.alive));
}
const seat = await H.evaluate((s) => { const m = __lf.g.match, p = m.players.find((q) => q.slot === s); return { bot: p.bot, hasBot: m.bots.has(s), n: m.players.length, people: m.players.filter((q) => !q.bot).length }; }, j.slot);
ok('they took a bot\'s place (no extra player, no bot left driving their slot)', !seat.bot && !seat.hasBot && seat.n === after.n, JSON.stringify(seat));
await sleep(5000);
await agree('after the late join', [H, G1, G3]);
const seesThem = await G1.evaluate((s) => { const a = __lf.g.actors.get(s); return a ? { alive: a.info.alive, y: a.y, bot: a.info.bot } : null; }, j.slot);
ok('guest 1 sees the late joiner as a person', !!seesThem && !seesThem.bot, JSON.stringify(seesThem));

// ------------------------------------------------------------------ again
await H.evaluate(() => __lf.g.rematch());
await Promise.all([G1, G3].map((p) => p.waitForFunction(() => __lf.g.phase === 'live' && __lf.g.me.alive, null, { timeout: 90000 }).catch(() => {})));
await sleep(3000);
const rm = await agree('rematch', [H, G1, G3]);
ok('rematch: everyone playing, score from nothing', rm.every((s) => s.in && s.alive !== undefined) && /^[0-3]-[0-3]$/.test(rm[0].score), rm[0].score);
for (const p of [H, G1, G3]) await p.evaluate(SAMPLE);
await sleep(8000);
const again = await Promise.all([H, G1, G3].map(take));
ok('rematch: nobody jumps on screen', again.every((s) => s.j.length <= 1), again.map((s) => s.j.length).join(' '));

// ------------------------------------------------------------------ the host leaves
await H.context().close();
const gone = await G1.waitForFunction(() => !__lf.g.inMatch, null, { timeout: 25000 }).then(() => true).catch(() => false);
const toast = await G1.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
ok('the host closed the tab: guests are back at the menu, told why', gone, `"${toast}"`);
ok('no page errors anywhere', errs.length === 0, errs.slice(0, 8).join('\n   '));
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fails ? 1 : 0);
