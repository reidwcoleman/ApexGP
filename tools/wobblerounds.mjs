// Wobble Mania: plays rounds under their real rules with bots (and the autopilot as you) and reports
// how long each lasted, who was left, and whether its twist fired. Page errors fail the run.
//   node tools/wobblerounds.mjs [--port 5197] [--rounds 2,4,19] [--runs 2] [--cut 0]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const rounds = opt('rounds', '2,4,6,16,19,21,26,27,28,29,30,35,36,37').split(',').map(Number);
const runs = Number(opt('runs', 2));
const cut = opt('cut', '0');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let bad = 0;
async function one(round) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load') && errs.push(m.text()));
  await page.goto(`http://localhost:${port}/marbles.html?round=${round}&auto=1&go=1&cut=${cut}&nohud=1&settle=100`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const r = await page.evaluate(() => {
    const g = window.__marbles;
    g.paused = true;
    const c = g.course;
    const start = g.racers.length;
    let holders = new Set(), lastH = -2, changes = 0, sprung = 0, bonk = 0;
    const t0 = performance.now();
    let t = 0;
    for (; t < 260 && (g.state === 'play' || g.state === 'countdown' || g.state === 'intro'); t += 0.25) {
      g.ff(0.25);
      if (c.keep) {
        if (c.keep.holder !== lastH) { lastH = c.keep.holder; changes++; if (lastH >= 0) holders.add(lastH); }
      }
      for (const r of g.racers) { if (r.m.sprung) { sprung++; r.m.sprung = false; } if (r.m.bonked) { bonk++; r.m.bonked = false; } }
    }
    return {
      id: c.id, state: g.state, playT: +g.playT.toFixed(1), start,
      alive: g.racers.filter((r) => !r.out).length, slots: g.slots, fin: g.racers.filter((r) => r.fin).length,
      keep: c.keep ? { changes, holders: holders.size, top: g.keepP?.ranking().slice(0, 3).map((r) => +(g.keepP.held.get(r.m.id) ?? 0).toFixed(1)) } : undefined,
      pops: g.bounce ? g.bounce.ranking().slice(0, 3).map((r) => g.bounce.score.get(r.m.id) ?? 0) : undefined,
      cup: g.cupP ? g.cupP.score.join('-') : undefined,
      book: g.bumpP ? g.bumpP.ranking().map((r) => g.bumpP.of(r.m.id)).filter((_, i, l) => i < 3 || i === l.length - 1) : undefined,
      sprung, bonk, wall: +((performance.now() - t0) / 1000).toFixed(1),
    };
  });
  await page.close();
  r.errs = errs.slice(0, 2);
  if (errs.length || r.state === 'play') bad++;
  return r;
}
const queue = rounds.flatMap((n) => Array(runs).fill(n));
const out = [];
await Promise.all([0, 1, 2].map(async () => { while (queue.length) { const n = queue.shift(); out.push([n, await one(n)]); } }));
out.sort((a, b) => a[0] - b[0]);
for (const [n, r] of out) {
  const extra = [r.keep && `crown changes ${r.keep.changes} by ${r.keep.holders}, top ${r.keep.top}`, r.cup && `goals ${r.cup}`, r.pops && `pops ${r.pops}`, r.book && `scores ${r.book}`, r.sprung && `springs ${r.sprung}`, r.bonk && `bonks ${r.bonk}`].filter(Boolean).join(' · ');
  console.log(`${String(n).padStart(2)} ${r.id.padEnd(14)} ${String(r.playT).padStart(6)}s  left ${String(r.alive).padStart(2)}/${r.start} slots ${String(r.slots).padStart(2)} fin ${String(r.fin).padStart(2)} ${r.state.padEnd(8)} ${extra} ${r.errs.length ? 'ERR ' + r.errs.join(' | ') : ''}`);
}
await browser.close();
console.log(bad ? `FAIL ${bad}` : 'PASS');
process.exit(bad ? 1 : 0);
