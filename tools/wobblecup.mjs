// Wobble Mania's ball games, checked tick by tick: plays each one with bots and counts what a
// player would call a mistake: a ball that jumps without being hit, a ball lying dead where nobody
// can get it, a ball or a bean outside the pitch, a goal straight from the drop, an own goal
// given to the wrong bean, beans stood in a ball.
//   node tools/wobblecup.mjs [--port 5197] [--rounds beancup,bigpush,overfence] [--runs 2]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const rounds = opt('rounds', 'beancup,bigpush,overfence,volleyfolly,beanhoops,beanbowl').split(',');
const runs = Number(opt('runs', 2));
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
async function one(id) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load') && errs.push(m.text()));
  await page.goto(`http://localhost:${port}/marbles.html?round=${id}&auto=1&go=1&nohud=1&settle=100`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const r = await page.evaluate(() => {
    const g = window.__marbles;
    g.paused = true;
    const c = g.course, A = c.cup, C = A.cfg, P = g.cupP;
    const y0 = A.center.y;
    const out = { id: c.id, jumps: 0, jumpMax: 0, dead: 0, deadAt: [], ballOut: 0, beanOut: 0, inBall: 0, quick: 0, goals: [], maxSpeed: 0, tumble: 0, ticks: 0, idle: 0, far: 0 };
    const prev = A.balls.map((b) => b.pos.clone());
    const still = A.balls.map(() => 0);
    const was = A.balls.map(() => 0);
    let lastScore = 0, lastGoalT = 0, dropT = 0, wasLive = A.balls.map(() => false);
    const heldWas = A.balls.map(() => -1);
    let phaseWas = 'set';
    // (the game's own goal calls, as it makes them)
    const calls = [];
    const shout = g.ui.shout.bind(g.ui);
    g.ui.shout = (a, b, ms) => { calls.push([+g.playT.toFixed(1), a, b]); shout(a, b, ms); };
    // (Bean Hoops: every shot, how far out it was taken from, and where the ball spends its time)
    out.shots = []; out.zSum = 0; out.high = 0;
    if (P.shoot) {
      const shoot = P.shoot.bind(P);
      P.shoot = (b, i, r, tt, ev, dx, dz, h) => {
        const k0 = b.kickT;
        shoot(b, i, r, tt, ev, dx, dz, h);
        if (b.kickT !== k0) { const H = A.hoops[P.teamOf(r.c.id)]; out.shots.push(+Math.hypot(H.x - b.pos.x, H.z - b.pos.z).toFixed(0) * (b.vel.y > 8.5 ? 1 : -1)); }
      };
    }
    for (let t = 0; t < 270 && (g.state === 'play' || g.state === 'countdown' || g.state === 'intro'); t += 1 / 60) {
      g.ff(1 / 60);
      if (g.state !== 'play') continue;
      out.ticks++;
      A.balls.forEach((b, i) => {
        if (!b.live) { wasLive[i] = false; still[i] = 0; return; }
        if (!wasLive[i]) { wasLive[i] = true; prev[i].copy(b.pos); dropT = g.playT; }
        const step = b.pos.distanceTo(prev[i]);
        const fair = Math.max(b.vel.length(), was[i]) / 60 * 1.6 + 0.35;
        was[i] = b.vel.length();
        // (Bean Bowl: picked up, a ball goes to its bean's hands, and out of them when it's thrown or dropped)
        // (Bean Bowl: the ball's carried, and put down on the line of scrimmage between plays)
        const hand = C.rule === 'bowl' && (b.held >= 0 || heldWas[i] >= 0 || P.drive.phase !== 'live' || phaseWas !== 'live');
        if (C.rule === 'bowl') { heldWas[i] = b.held; phaseWas = P.drive.phase; }
        if (step > fair && !hand) { out.jumps++; out.jumpMax = Math.max(out.jumpMax, +step.toFixed(2)); }
        prev[i].copy(b.pos);
        out.maxSpeed = Math.max(out.maxSpeed, +b.vel.length().toFixed(1));
        out.zSum += Math.abs(b.pos.z - A.center.z); if (b.pos.y > y0 + C.R + 2) out.high++;
        const dx = Math.abs(b.pos.x - A.center.x), dz = Math.abs(b.pos.z - A.center.z);
        if (dx > C.HW + 0.05 || dz > C.HL + C.goalD + 0.05 || b.pos.y < y0 + C.R - 0.05 || b.pos.y > y0 + C.ceil + 0.5) out.ballOut++;
        // lying dead: slow, with nobody near it
        let near = Infinity;
        for (const r of g.racers) near = Math.min(near, Math.hypot(r.m.pos.x - b.pos.x, r.m.pos.z - b.pos.z));
        if (b.vel.length() < 0.4 && near > C.R + 3) still[i] += 1 / 60; else still[i] = 0;
        if (still[i] > 6 && still[i] < 6 + 1 / 59) { out.dead++; out.deadAt.push([+(b.pos.x - A.center.x).toFixed(1), +(b.pos.z - A.center.z).toFixed(1), +g.playT.toFixed(0)]); }
        if (near > 14) out.far++;
        if (!hand) for (const r of g.racers) if (Math.hypot(r.m.pos.x - b.pos.x, r.m.pos.y + 0.55 - b.pos.y, r.m.pos.z - b.pos.z) < C.R + 0.3) out.inBall++;
      });
      for (const r of g.racers) {
        const dx = Math.abs(r.m.pos.x - A.center.x), dz = Math.abs(r.m.pos.z - A.center.z);
        if (dx > C.HW + 0.6 || dz > C.HL + C.goalD + 0.6 || r.m.pos.y < y0 - 0.5) out.beanOut++;
        if (r.m.mode === 3 || r.m.mode === 'tumble') out.tumble++;
        if (r.m.input.lengthSq() < 0.01 && r.m.vel.lengthSq() < 0.05) out.idle++;
      }
      const s = P.score[0] + P.score[1];
      if (C.rule !== 'fence' && s !== lastScore) {
        const since = g.playT - Math.max(dropT, 0);
        out.goals.push([+g.playT.toFixed(1), P.score.join('-'), +since.toFixed(1)]);
        if (since < 4 && (C.rule === 'cup' || C.rule === 'push')) out.quick++;
        lastScore = s;
        lastGoalT = g.playT;
      }
    }
    out.state = g.state;
    out.playT = +g.playT.toFixed(1);
    out.score = P.score.join('-');
    if (C.rule === 'bowl') out.bowl = { ...P.stats, yards: P.stats.yards.join('/') };
    out.calls = calls.filter((x) => /GOAL|SCORED|LINE/.test(x[1])).map((x) => `${x[0]} ${x[1]}`);
    out.beans = g.racers.length;
    return out;
  });
  await page.close();
  r.errs = errs.slice(0, 3);
  return r;
}
const queue = rounds.flatMap((n) => Array(runs).fill(n));
const res = [];
await Promise.all([0, 1, 2].map(async () => { while (queue.length) res.push(await one(queue.shift())); }));
res.sort((a, b) => a.id.localeCompare(b.id));
let bad = 0;
for (const r of res) {
  const n = r.ticks * r.beans || 1;
  const wrong = r.errs.length || r.state === 'play' || r.jumps > 0 || r.dead > 0 || r.ballOut > 0 || r.beanOut > 0 || r.quick > 0;
  if (wrong) bad++;
  if (r.bowl) console.log(`        football: ${JSON.stringify(r.bowl)}`);
  console.log(`${wrong ? 'BAD ' : 'ok  '}${r.id.padEnd(10)} ${String(r.playT).padStart(6)}s ${r.score.padEnd(5)} jumps ${r.jumps} (max ${r.jumpMax} m) dead ${r.dead} ${JSON.stringify(r.deadAt)} ballOut ${r.ballOut} beanOut ${r.beanOut} inBall ${r.inBall} quickGoals ${r.quick} top ${r.maxSpeed} m/s down ${(100 * r.tumble / n).toFixed(1)}% idle ${(100 * r.idle / n).toFixed(1)}% ballAlone ${(100 * r.far / Math.max(1, r.ticks)).toFixed(0)}%`);
  if (r.shots.length) console.log(`      shots (m from the hoop; minus: a clearance) ${r.shots.join(' ')} · ball's mean distance from halfway ${(r.zSum / Math.max(1, r.ticks)).toFixed(1)} m, in the air ${(100 * r.high / Math.max(1, r.ticks)).toFixed(0)}%`);
  if (r.goals.length) console.log(`      goals ${r.goals.map((g) => `${g[0]}s ${g[1]} (+${g[2]}s)`).join(', ')}`);
  if (r.calls.length) console.log(`      calls ${r.calls.join(' | ')}`);
  if (r.errs.length) console.log(`      ERR ${r.errs.join(' | ')}`);
}
await browser.close();
console.log(bad ? `FAIL ${bad}` : 'PASS');
process.exit(bad ? 1 : 0);
