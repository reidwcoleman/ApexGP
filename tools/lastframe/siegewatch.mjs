// Bots only, the attack-and-defend game: do rounds play out?  node tools/lastframe/siegewatch.mjs PORT [map] [seconds] [shotdir]   (SEED=n, BOTS=n)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
const [port, map = 'ward', secs = '240', shots = ''] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: shots ? 1280 : 640, height: shots ? 720 : 360 } })).newPage();
let errs = 0;
p.on('pageerror', (e) => { errs++; console.log('pageerror', e.message); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 180000 });
await p.evaluate(([seed, bots]) => {
  const g = __lf.g;
  g.autoInput = true;
  g.startSolo({ mode: 'siege', bots, skill: 0.5, time: 8, limit: 9, seed }, 'Tester', 0, 'carbine');
  window.__log = [];
  const ph = g.hud.phase.bind(g.hud);
  g.hud.phase = (e) => { window.__log.push({ t: performance.now() / 1000, phase: e.phase, round: e.round, score: e.score, msg: e.msg, winner: e.winner, atk: e.atk, obj: e.objName }); ph(e); };
}, [+(process.env.SEED ?? 5), +(process.env.BOTS ?? 5)]);
let last = 0, lastPhase = '';
const state = () => p.evaluate(() => {
  const g = __lf.g, m = g.match;
  // the person is not playing: out of it at the start of every round
  const me = m.players.find((q) => !q.bot);
  if (me?.alive && (m.phase === 'prep' || m.phase === 'live')) m.damage(me.slot, me.slot, 999, 1, 0, [0, 0, 1], 0);
  const side = (t) => m.players.filter((q) => q.bot && q.team === t);
  const A = side(m.atk), D = side(1 - m.atk);
  const inObj = (q) => { const b = m.bodies[q.slot]; return m.inObj(b.x, b.y, b.z); };
  const ord = (q) => m.tactics.orderFor(q.slot)?.kind ?? '-';
  return {
    phase: m.phase, clock: +m.clock.toFixed(0), round: m.round, obj: m.obj?.name, doors: m.obj?.doors.length,
    bars: m.bars.filter((x) => x).length, objBars: m.obj ? m.obj.doors.filter((d) => m.bars[d]).length : 0,
    atk: A.filter((q) => q.alive).length, def: D.filter((q) => q.alive).length,
    atkIn: A.filter((q) => q.alive && inObj(q)).length, defIn: D.filter((q) => q.alive && inObj(q)).length,
    aOrd: A.filter((q) => q.alive).map(ord).join(','), dOrd: D.filter((q) => q.alive).map(ord).join(','),
    prog: +m.secureProg.toFixed(2),
    dist: m.obj ? A.filter((q) => q.alive).map((q) => Math.round(Math.hypot(m.bodies[q.slot].x - m.obj.c.x, m.bodies[q.slot].z - m.obj.c.z))).join(',') : '',
    log: window.__log.splice(0),
  };
});
let n = 0;
for (let t = 0; t < +secs; t += 3) {
  await p.waitForTimeout(3000);
  const s = await state();
  for (const e of s.log) console.log(`  == ${e.phase} round ${e.round} score ${e.score}${e.msg ? ' why: ' + e.msg : ''}${e.winner !== undefined ? ' winner ' + e.winner + (e.winner === e.atk ? ' (attackers)' : ' (defenders)') : ''}${e.phase === 'warmup' ? ' room: ' + e.obj : ''}`);
  if (s.phase === 'prep' || s.phase === 'live') {
    console.log(`${s.phase} ${String(s.clock).padStart(3)}s ${s.obj} bars ${s.objBars}/${s.doors} (${s.bars} all) | atk ${s.atk} (${s.atkIn} in) [${s.aOrd}] d=${s.dist} | def ${s.def} (${s.defIn} in) [${s.dOrd}] | secure ${s.prog}`);
    if (shots && (s.phase !== lastPhase || t - last >= 24)) { last = t; await p.screenshot({ path: `${shots}/siege_${map}_${String(n++).padStart(2, '0')}_${s.phase}.png` }); }
  }
  lastPhase = s.phase;
}
console.log('page errors:', errs);
await b.close();
