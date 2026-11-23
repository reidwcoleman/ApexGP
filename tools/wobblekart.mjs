// Wobble Mania's go-karts: a race with the bots while a heavy-handed keyboard driver takes your
// kart (flat out, full lock one way or the other, never a lift), counting how often anyone spins.
// A spin is the kart more than 50 degrees off the way it's going at speed, with no drift held.
//   node tools/wobblekart.mjs [--port 5197] [--round beanbaygp] [--runs 2] [--secs 100] [--style ham|tap|drift]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const round = opt('round', 'beanbaygp');
const runs = Number(opt('runs', 2));
const secs = Number(opt('secs', 100));
const styles = opt('style', 'ham,tap,drift').split(',');
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
async function one(style) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load') && errs.push(m.text()));
  await page.goto(`http://localhost:${port}/marbles.html?round=${round}&go=1&nohud=1&settle=100`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const r = await page.evaluate(({ secs, style }) => {
    const g = window.__marbles;
    g.paused = true;
    const P = g.kartP, tr = g.course.kart.track;
    const me = g.racers.find((r) => r.c.player);
    const mine = P.byId.get(me.m.id);
    const out = { style, spins: 0, botSpins: 0, rescues: 0, botRescues: 0, walls: 0, back: 0, maxBeta: 0, top: 0, errs: 0 };
    const spun = new Map(), ghost = new Map();
    let n = 0;
    for (let t = 0; t < secs + 6 && (g.state === 'play' || g.state === 'countdown' || g.state === 'intro'); t += 1 / 60) {
      // the driver: the gas is never off; the wheel is all the way one way or the other
      const k = mine.kart, v = k.vel.length();
      const s = k.q.s + 10 + v * 0.45;
      const i = tr.idx(Math.round(s)) * 3;
      const dx = tr.P[i] - k.pos.x, dz = tr.P[i + 2] - k.pos.z;
      const left = dx * k.ax.x + dz * k.ax.z, fwd = dx * k.az.x + dz * k.az.z;
      const err = Math.atan2(left, Math.max(0.1, fwd));
      g.keys.add('KeyW');
      g.keys.delete('KeyA'); g.keys.delete('KeyD'); g.keys.delete('KeyS'); g.keys.delete('Space');
      const dead = style === 'ham' ? 0.03 : 0.07;
      if (err > dead) g.keys.add('KeyA'); else if (err < -dead) g.keys.add('KeyD');
      // (tap: a dab of brake into anything sharp; drift: the drift key held through every bend)
      if (style === 'tap' && Math.abs(err) > 0.5 && v > 16) { g.keys.delete('KeyW'); g.keys.add('KeyS'); }
      if (style === 'drift' && Math.abs(err) > 0.22 && v > 9) g.keys.add('Space');
      g.ff(1 / 60);
      if (g.state !== 'play') continue;
      n++;
      for (const sim of P.sims) {
        const q = sim.kart, sp = q.vel.length(), isMe = sim === mine;
        const sliding = Math.abs(q.beta) > 0.87 && sp > 5 && !q.drifting && q.air < 0.05;
        const backwards = sp > 5 && q.vf < -2;
        const now = sliding || backwards;
        if (now && !spun.get(sim.id)) { if (isMe) out.spins++; else out.botSpins++; }
        spun.set(sim.id, now ? 60 : Math.max(0, (spun.get(sim.id) ?? 0) - 1));
        if (sim.ghost > (ghost.get(sim.id) ?? 0)) { ghost.set(sim.id, sim.ghost); if (isMe) out.rescues++; else out.botRescues++; }
        if (isMe) {
          if (!q.drifting && sp > 5) out.maxBeta = Math.max(out.maxBeta, +Math.abs(q.beta).toFixed(2));
          out.top = Math.max(out.top, +sp.toFixed(1));
          if (q.wallHit > 5) out.walls++;
          if (backwards) out.back++;
        }
      }
    }
    out.playT = +g.playT.toFixed(1);
    out.lap = +(mine.prog / tr.length).toFixed(2);
    out.done = mine.prog >= 2 * tr.length;
    out.bots = P.sims.length - 1;
    out.botsDone = P.sims.filter((s) => s !== mine && s.prog >= 2 * tr.length).length;
    out.best = +(mine.bestLap || 0).toFixed(1);
    out.place = g.ranked().indexOf(me) + 1;
    return out;
  }, { secs, style });
  await page.close();
  r.errs = errs.slice(0, 2);
  return r;
}
const queue = styles.flatMap((s) => Array(runs).fill(s));
const res = [];
await Promise.all([0, 1, 2].map(async () => { while (queue.length) res.push(await one(queue.shift())); }));
res.sort((a, b) => a.style.localeCompare(b.style));
let spins = 0;
for (const r of res) {
  spins += r.spins;
  console.log(`${r.style.padEnd(6)} ${String(r.playT).padStart(6)}s laps ${r.lap} ${r.done ? 'FINISHED' : 'not done'} place ${r.place} best lap ${r.best}s · YOU spins ${r.spins} rescues ${r.rescues} wall bangs ${r.walls} backwards ${r.back} ticks, worst slide ${r.maxBeta} rad, top ${r.top} m/s · BOTS (${r.bots}) spins ${r.botSpins} rescues ${r.botRescues} finished ${r.botsDone}${r.errs.length ? ' ERR ' + r.errs.join(' | ') : ''}`);
}
await browser.close();
console.log(`player spins in all: ${spins}`);
