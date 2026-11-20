// The attack-and-defend game with only bots, run as fast as the machine will: who wins, how, and how long a round takes.
//   node tools/lastframe/siegesim.mjs PORT [map] [rounds]   (SEED=n, BOTS=n team size, SKILL=0..1)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, map = 'ward', rounds = '12'] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 320, height: 180 } })).newPage();
let errs = 0;
p.on('pageerror', (e) => { errs++; console.log('pageerror', e.message); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 400000 });
await p.evaluate(([seed, bots, skill]) => {
  const g = __lf.g;
  g.autoInput = true;
  g.startSolo({ mode: 'siege', bots, skill, time: 8, limit: 99, seed }, 'Tester', 0, 'carbine');
  g.halt = true;
  window.__ev = [];
  const ph = g.hud.phase.bind(g.hud);
  g.hud.phase = (e) => { window.__ev.push(e); try { ph(e); } catch {} };
}, [+(process.env.SEED ?? 5), +(process.env.BOTS ?? 5), +(process.env.SKILL ?? 0.5)]);
const res = [];
for (let r = 0; r < +rounds; r++) {
  const out = await p.evaluate(() => {
    const g = __lf.g, m = g.match;
    const dt = 1 / 30;
    const stall = new Map();
    const st = { stalls: [], built: 0, maxBars: 0, firstContact: -1, breachAt: -1, enterAt: -1, charges: 0, kicks: 0, live: 0, prepKick: 0 };
    let guard = 0, seenLive = false, barsBefore = 0;
    const alive = (t) => m.players.filter((q) => q.alive && q.team === t).length;
    for (;;) {
      if (++guard > 30 * 400) break;
      const me = m.players.find((q) => !q.bot);
      if (me?.alive && (m.phase === 'prep' || m.phase === 'live')) m.damage(me.slot, me.slot, 999, 1, 0, [0, 0, 1], 0);
      const ph0 = m.phase;
      m.update(dt);
      const objBars = m.obj ? m.obj.doors.filter((d) => m.bars[d]).length : 0;
      if (m.phase === 'prep') {
        if (objBars < barsBefore) st.prepKick++;
        st.maxBars = Math.max(st.maxBars, objBars);
      }
      barsBefore = objBars;
      if (m.phase === 'live') {
        seenLive = true;
        st.live += dt;
        const A = m.players.filter((q) => q.team === m.atk), D = m.players.filter((q) => q.team !== m.atk);
        if (st.firstContact < 0 && (A.some((q) => q.bot && !q.alive) || D.some((q) => q.bot && !q.alive))) st.firstContact = st.live;
        if (st.enterAt < 0 && m.secureN[0] > 0) st.enterAt = st.live;
        if (st.breachAt < 0 && m.obj.doors.some((d) => m.chargeOn(d))) st.breachAt = st.live;
      }
      // anyone who means to walk somewhere and has not moved for 15 s
      if (m.phase === 'live') for (const q of m.players) {
        if (!q.bot || !q.alive) { stall.delete(q.slot); continue; }
        const bt = m.bots.get(q.slot), bd = m.bodies[q.slot];
        const k = stall.get(q.slot);
        const wants = bt.path.length > 0 && bt.pi < bt.path.length && bt.target < 0;
        if (!k || !wants || Math.hypot(k.x - bd.x, k.z - bd.z, k.y - bd.y) > 0.6) stall.set(q.slot, { x: bd.x, y: bd.y, z: bd.z, t: st.live });
        else if (st.live - k.t > 15 && !k.told) { k.told = true; st.stalls.push(`${m.tactics.orderFor(q.slot)?.kind} at ${bd.x.toFixed(1)},${bd.y.toFixed(1)},${bd.z.toFixed(1)}`); }
      }
      if (ph0 === 'live' && m.phase === 'between') break;
      if (ph0 === 'prep' && m.phase === 'between') break;
    }
    const e = window.__ev.filter((x) => x.phase === 'between').pop();
    window.__ev.length = 0;
    return { ...st, round: m.round, room: m.obj?.name, doors: m.obj?.doors.length, winner: e?.winner, atk: m.atk, why: e?.msg, a: alive(m.atk), d: alive(1 - m.atk), prog: +m.secureProg.toFixed(2), guard };
  });
  res.push(out);
  console.log(`round ${String(out.round).padStart(2)} ${String(out.room).padEnd(10)} doors ${out.doors} boarded ${out.maxBars}${out.prepKick ? ' (own boards lost ' + out.prepKick + ')' : ''} | ${out.winner === out.atk ? 'ATTACK' : 'DEFEND'} wins: ${out.why} after ${out.live.toFixed(0)}s, left ${out.a} v ${out.d} | first blood ${out.firstContact.toFixed(0)}s charge ${out.breachAt.toFixed(0)}s in room ${out.enterAt.toFixed(0)}s${out.stalls.length ? ' | STALLED: ' + out.stalls.join('; ') : ''}`);
}
const aw = res.filter((r) => r.winner === r.atk).length;
const why = {};
for (const r of res) why[r.why] = (why[r.why] ?? 0) + 1;
console.log(`attackers won ${aw} of ${res.length}; mean round ${(res.reduce((s, r) => s + r.live, 0) / res.length).toFixed(0)}s; how: ${JSON.stringify(why)}; rounds with a charge ${res.filter((r) => r.breachAt >= 0).length}, with attackers in the room ${res.filter((r) => r.enterAt >= 0).length}`);
console.log('page errors:', errs);
await b.close();
