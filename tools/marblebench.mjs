// Marble Mania: the bots' report card. Loads each round headless with the autopilot driving you,
// fast-forwards it to the end (every contestant to the line, or the plate to its last marble) and
// prints per round: the leader's time, the last qualifier's, falls, stuck time, DNFs, how well the
// results follow the bots' skill (Spearman), how the autopilot did, and the AI's cost per frame.
//
//   node tools/marblebench.mjs [--port 5214] [--rounds 0,1,2,3,4,5] [--runs 3] [--par 2] [--cut 0 | --show 1] [--human 1] [--diff easy|normal|hard|insane] [--json out.json]
//
// (the round runs past its normal end — races until everyone is home or 150 s, the plate until
// one is left or 110 s — so the whole field is ranked; the qualifying cut is the game's own)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt('port', '5214');
const rounds = opt('rounds', '0,1,2,3,4,5').split(',').map(Number);
const runs = Number(opt('runs', 3));
const par = Number(opt('par', 2));
// (--show: each round with the field the show would have left by then: 24, 16, 10, 5)
const cuts = opt('show', null) ? [0, 5, 10, 14, 16, 19] : null;
const cut = (round) => (cuts ? cuts[round] ?? 0 : Number(opt('cut', 0)));
const jsonOut = opt('json', null);
const human = opt('human', null) === '1';
const diff = opt('diff', 'normal');
const NAMES = ['Timber Tumble', 'Paint Mill', 'Jump Club', 'Rickety Ridge', 'Tip Top', 'Crown Summit'];

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

/** one round, start to finish, in one synchronous run inside the page */
async function runOnce(round, k) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errs.push(m.text()));
  await page.goto(`http://localhost:${port}/marbles.html?round=${round}&auto=1&go=1&cut=${cut(round)}&nohud=1&settle=100&diff=${diff}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const res = await page.evaluate((human) => {
    const g = window.__marbles;
    g.paused = true;
    // (--human 1: "you" are a stand-in for a decent human instead: flat out down the middle,
    // dash whenever it's ready, hop at the lip of a gap; the plate keeps the autopilot)
    const me = g.racers.find((r) => r.c.player);
    if (human && me && g.course.path) {
      const P = g.course.path;
      let hint = 0;
      me.bot = {
        reset: (i) => (hint = i),
        update: (dt, t, c, all) => {
          const m = me.m;
          m.input.set(0, 0, 0);
          if (!m.active || m.frozen) return;
          const pr = P.project(m.pos, hint, 40);
          hint = pr.i;
          const T = P.T[P.index(pr.s + 4)], R = P.Rt[pr.i];
          const vl = m.vel.x * R.x + m.vel.z * R.z;
          const k = Math.max(-1, Math.min(1, (-pr.lat * 1.5 - vl) * 0.35));
          m.input.set(T.x + R.x * k, 0, T.z + R.z * k).normalize();
          if (m.grounded && m.dashCD <= 0) m.dash = true;
          for (const [g0] of c.gaps) if (pr.s > g0 - 0.6 && pr.s < g0 + 0.4) m.jump = true;
        },
      };
    }
    const c = g.course;
    const dt = 1 / 60;
    const realSlots = g.slots;
    const kind = c.kind;
    // run the whole field home: a final ends at its first finisher, so it's timed as a race
    if (kind === 'final') c.kind = 'race';
    g.slots = c.plate ? 0 : g.racers.length;
    const maxT = c.plate ? 110 : 180;
    const R = g.racers;
    const st = new Map(R.map((r) => [r, { id: r.c.id, skill: r.c.player ? 0.9 : r.c.skill, player: r.c.player, falls: 0, stuck: 0, finT: 0, fin: 0, outT: 0, dash: 0, hop: 0 }]));
    const drop = g.drop;
    const where = [];
    g.drop = function (r) {
      st.get(r).falls++;
      if (c.path) where.push(Math.round(r.s));
      return drop.call(this, r);
    };
    // the course's tags, to name the spots where they fall
    const tags = c.path ? [...c.path.tags.entries()].map(([k, v]) => [k, v[0], v[1]]) : [];
    let botMs = 0, frames = 0, worst = 0;
    for (const r of R) {
      if (!r.bot) continue;
      const u = r.bot.update.bind(r.bot);
      r.bot.update = (...a) => {
        const t0 = performance.now();
        u(...a);
        botMs += performance.now() - t0;
      };
    }
    let guard = 0;
    while (g.state !== 'play' && guard++ < 900) g.ff(dt);
    const t0 = performance.now();
    let halfT = 0;
    while (g.state === 'play' && g.playT < maxT) {
      const b0 = botMs;
      g.ff(dt);
      frames++;
      worst = Math.max(worst, botMs - b0);
      for (const r of R) {
        const s = st.get(r);
        if (r.fin && !s.fin) {
          s.fin = r.fin;
          s.finT = g.playT;
        }
        if (c.plate && r.out && !s.outT) s.outT = g.playT;
        const m = r.m;
        if (m.dashed) s.dash++;
        if (m.hopped) s.hop++;
        if (!c.plate && !r.out && !r.fin && !r.fell && !m.frozen && m.active && g.playT > 3 && m.vel.length() < 0.5) s.stuck += dt;
      }
      if (c.plate && !halfT && R.filter((r) => !r.out).length <= realSlots) halfT = g.playT;
    }
    return {
      kind,
      realSlots,
      endT: g.playT,
      halfT,
      wall: performance.now() - t0,
      botMs: botMs / Math.max(1, frames),
      worst,
      bots: R.filter((r) => r.bot).length,
      field: [...st.values()],
      human: !!(human && me && c.path),
      where,
      tags,
    };
  }, human);
  res.errs = errs;
  await page.close();
  process.stderr.write(`  round ${round} run ${k + 1}: ${(res.wall / 1000).toFixed(1)} s wall\n`);
  return res;
}

function spearman(xs, ys) {
  const rank = (v) => {
    const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(v.length);
    for (let i = 0; i < idx.length; ) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const a = rank(xs), b = rank(ys), n = xs.length;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

const mean = (v) => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN);
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');

const all = {};
for (const round of rounds) {
  const jobs = [...Array(runs).keys()];
  const out = [];
  while (jobs.length) {
    const batch = jobs.splice(0, par);
    out.push(...(await Promise.all(batch.map((k) => runOnce(round, k)))));
  }
  all[round] = out;
  const plate = out[0].kind === 'survival';
  const lines = [];
  const rhos = [], falls = [], stuck = [], lead = [], lastQ = [], dnf = [], auto = [], cost = [], worst = [], halfT = [], left = [];
  const tiers = { lo: [], mid: [], hi: [] };
  const tierN = { lo: [], mid: [], hi: [] };
  const spots = new Map();
  for (const r of out) {
    const bots = r.field.filter((x) => !x.player);
    const score = (x) => (plate ? x.outT || r.endT + 1 : x.finT || 999);
    rhos.push(spearman(bots.map((x) => x.skill), bots.map((x) => (plate ? score(x) : -score(x)))));
    falls.push(r.field.reduce((s, x) => s + x.falls, 0));
    stuck.push(r.field.reduce((s, x) => s + x.stuck, 0) / r.field.length);
    cost.push(r.botMs);
    worst.push(r.worst);
    for (const x of bots) {
      const k = x.skill < 0.6 ? 'lo' : x.skill < 0.8 ? 'mid' : 'hi';
      tiers[k].push(plate ? score(x) : x.finT || NaN);
      tierN[k].push(x);
    }
    const me = r.field.find((x) => x.player);
    if (plate) {
      halfT.push(r.halfT || NaN);
      left.push(r.field.filter((x) => !x.outT).length);
      if (me) auto.push(me.outT ? `out ${f1(me.outT)}s` : 'survived');
    } else {
      const fins = r.field.filter((x) => x.fin).sort((a, b) => a.fin - b.fin);
      lead.push(fins[0]?.finT ?? NaN);
      lastQ.push(fins[r.realSlots - 1]?.finT ?? NaN);
      dnf.push(r.field.length - fins.length);
      if (me) auto.push(me.fin ? `${me.fin}/${r.field.length} ${f1(me.finT)}s${me.falls ? ` (${me.falls} falls)` : ''}` : 'DNF');
    }
    for (const w of r.where) {
      const t = r.tags.filter(([, a]) => a <= w).pop();
      const k = t ? `${t[0]}+${Math.floor((w - t[1]) / 5) * 5}` : String(w);
      spots.set(k, (spots.get(k) ?? 0) + 1);
    }
    if (r.errs.length) lines.push(`    errors: ${r.errs.slice(0, 3).join(' | ')}`);
  }
  console.log(`\n${NAMES[round] ?? 'Round ' + round} (round ${round}, ${out[0].field.length} marbles, ${runs} runs)`);
  if (plate) {
    console.log(`  cut reached (half out) at  ${halfT.map(f1).join(' / ')} s   (mean ${f1(mean(halfT))})`);
    console.log(`  still on at the end (${f1(out[0].endT)} s)  ${left.join(' / ')}`);
    console.log(`  survival time by skill  <0.6: ${f1(mean(tiers.lo))}  0.6-0.8: ${f1(mean(tiers.mid))}  ≥0.8: ${f1(mean(tiers.hi))} s`);
  } else {
    console.log(`  leader        ${lead.map(f1).join(' / ')} s   (mean ${f1(mean(lead))})`);
    console.log(`  last qualifier ${lastQ.map(f1).join(' / ')} s   (mean ${f1(mean(lastQ))}, slot ${out[0].realSlots})`);
    console.log(`  DNF (150 s)   ${dnf.join(' / ')}`);
    console.log(`  finish time by skill  <0.6: ${f1(mean(tiers.lo.filter(Number.isFinite)))}  0.6-0.8: ${f1(mean(tiers.mid.filter(Number.isFinite)))}  ≥0.8: ${f1(mean(tiers.hi.filter(Number.isFinite)))} s`);
  }
  console.log(`  falls         ${falls.join(' / ')}   (mean ${f1(mean(falls))} per round)`);
  const per = (k, f) => f2(mean(tierN[k].map(f)));
  console.log(`  per bot by skill (<0.6 / 0.6-0.8 / ≥0.8)  falls ${per('lo', (x) => x.falls)} / ${per('mid', (x) => x.falls)} / ${per('hi', (x) => x.falls)}   dashes ${per('lo', (x) => x.dash)} / ${per('mid', (x) => x.dash)} / ${per('hi', (x) => x.dash)}   hops ${per('lo', (x) => x.hop)} / ${per('mid', (x) => x.hop)} / ${per('hi', (x) => x.hop)}`);
  if (!plate) console.log(`  stuck         ${stuck.map(f2).join(' / ')} s per marble`);
  console.log(`  skill↔result  ρ ${rhos.map(f2).join(' / ')}   (mean ${f2(mean(rhos))})`);
  console.log(`  ${out[0].human ? 'human stand-in' : 'autopilot    '} ${auto.join(' / ')}`);
  console.log(`  AI cost       ${cost.map((x) => x.toFixed(3)).join(' / ')} ms/frame for ${out[0].bots} bots (worst frame ${f2(Math.max(...worst))} ms)`);
  if (spots.size) console.log(`  fall spots    ${[...spots].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}m:${n}`).join('  ')}`);
  for (const l of lines) console.log(l);
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(all, null, 1));
await browser.close();
