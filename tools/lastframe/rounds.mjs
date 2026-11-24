// A whole match of rounds, stepped by hand so every beat of one can be looked at: the briefing, the wait, the count, the
// word, a side down to one, the clock running out, how it ended, the next one, match point, the last round, the report.
//   node tools/lastframe/rounds.mjs PORT OUT [map]     (MODE=siege|rounds, TIER, default 1)
// The bots are held still and people are put down by hand, so the same things happen every time.
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from '../chrome.mjs';
import fs from 'node:fs';
const [port, out, map = 'store'] = process.argv.slice(2);
const mode = process.env.MODE ?? 'siege';
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--autoplay-policy=no-user-gesture-required'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let errs = 0;
p.on('pageerror', (e) => { errs++; console.log('pageerror', e.message); });
await p.goto(`http://localhost:${port}/lastframe.html?dev=1&map=${map}`);
await p.waitForFunction(() => window.__lf, null, { timeout: 400000 });
await p.evaluate(([tier, mode]) => {
  const g = __lf.g;
  g.autoInput = true;
  g.gfx = tier; g.setTier(tier);
  g.startSolo({ mode, bots: 5, skill: 0.5, time: 8, limit: 4, seed: 7 }, 'Tester', 0, 'carbine');
  g.halt = true;
  const m = g.match;
  for (const bt of m.bots.values()) { bt.update = () => {}; bt.crawl = () => {}; }
  window.__run = (sec) => { for (let k = 0; k < Math.round(sec * 30); k++) { g.time += 1 / 30; g.tick(1 / 30, 1 / 30); } };
  window.__team = (t) => m.players.filter((q) => q.team === t && q.alive).map((q) => q.slot);
  window.__kill = (by, to, zone = 0) => { const a = m.bodies[by], c = m.bodies[to]; m.damage(by, to, 999, zone, 0, [c.x - a.x || 1, 0, c.z - a.z], Math.hypot(c.x - a.x, c.z - a.z)); };
  window.__clock = (s) => { m.clock = s; g.clock = s; };
  // on to the next phase, whatever the clock says
  window.__until = (ph) => { for (let k = 0; k < 30 * 60 && m.phase !== ph; k++) { if (m.clock > 0.4) window.__clock(0.3); window.__run(1 / 30); } return m.phase; };
}, [+(process.env.TIER ?? 1), mode]);
const run = (s) => p.evaluate((x) => window.__run(x), s);
let n = 0;
const shot = async (name, wait = 1500) => {
  await p.waitForTimeout(wait);
  await p.screenshot({ path: `${out}/${String(++n).padStart(2, '0')}_${name}.png` });
};
const st = () => p.evaluate(() => { const m = __lf.g.match; return `${m.phase} r${m.round} ${m.score.join(':')} atk ${m.atk}`; });

await run(1.2);
await shot('intro');
if (mode === 'siege') {
  // the briefing is where the kit is chosen: the third of the three, and what it puts in my hands
  console.log('kit:', await p.evaluate(() => {
    const g = __lf.g, was = g.myKit();
    g.input.pressed.add('Digit3'); window.__run(1 / 30);
    const m = g.match.players.find((q) => q.slot === g.mySlot);
    return `${was} -> ${g.myKit()} (host has ${m.kits}); frags ${g.me.nades.frag}, flashes ${g.me.nades.flash}`;
  }));
  await shot('intro_kit_changed', 300);
}
if (mode === 'siege') {
  await p.evaluate(() => window.__until('prep'));
  await run(0.8);
  await shot('prep_attack', 900);
  // the attackers' few steps: pushed well past the edge of them, and where that leaves me
  console.log('staging leash:', await p.evaluate(() => {
    const g = __lf.g, x0 = g.me.m.x, z0 = g.me.m.z;
    g.me.m.x += 15; window.__run(0.2);
    const d = Math.hypot(g.me.m.x - x0, g.me.m.z - z0);
    g.me.m.x = x0; g.me.m.z = z0;
    return `${d.toFixed(2)} m from the start after a 15 m push (limit 7), gun safe ${g.me.safe}`;
  }));
  await p.evaluate(() => window.__clock(3.0));
} else await p.evaluate(() => window.__clock(3.0));
await run(0.25);
await shot('count', 180);
await p.evaluate(() => window.__until('live'));
await run(0.3);
await shot('go', 500);
console.log('safe once live:', await p.evaluate(() => __lf.g.me.safe));

// round 1: my side loses four, then theirs loses four, then I take the last of them
await p.evaluate(() => { const g = __lf.g, foes = window.__team(1); for (const s of window.__team(0)) if (s !== g.mySlot) window.__kill(foes[0], s); });
await run(0.6);
await shot('alone', 700);
await p.evaluate(() => { const g = __lf.g, foes = window.__team(1); for (const s of foes.slice(1)) window.__kill(g.mySlot, s); });
await run(0.6);
await shot('one_on_one', 700);
// the last of them, and the picture left to run by itself: how fast does it go while it is slow
const slow = await p.evaluate(async () => {
  const g = __lf.g;
  window.__kill(g.mySlot, window.__team(1)[0]);
  g.last = performance.now(); g.halt = false;
  const t0 = g.time, w0 = performance.now();
  await new Promise((r) => setTimeout(r, 900));
  const k = (g.time - t0) / ((performance.now() - w0) / 1000);
  await new Promise((r) => setTimeout(r, 1300));
  const t1 = g.time, w1 = performance.now();
  await new Promise((r) => setTimeout(r, 600));
  const k2 = (g.time - t1) / ((performance.now() - w1) / 1000);
  g.halt = true;
  return `picture at ${k.toFixed(2)}x for the first 0.9 s, ${k2.toFixed(2)}x after 2.2 s`;
});
console.log('round 1:', await st(), '|', slow);
await shot('end_won_clutch', 400);
await p.evaluate(() => window.__until('warmup'));
await run(0.6);
await shot('intro_round2_cut', 120);
await shot('intro_round2', 1400);

// round 2: the clock, then one of theirs takes all five
await p.evaluate(() => { window.__until('live'); window.__clock(60.4); });
await run(0.7);
await shot('one_minute', 600);
await p.evaluate(() => window.__clock(10.4));
await run(0.7);
await shot('ten_seconds', 600);
await p.evaluate(() => { const f = window.__team(1)[0]; for (const s of window.__team(0)) window.__kill(f, s); });
await run(1.0);
console.log('round 2:', await st());
await shot('end_lost_ace', 1600);

// round 3: I am out early, and the round is settled while my camera is dead and I am looking through somebody else's
await p.evaluate(() => { window.__until('warmup'); window.__until('live'); const g = __lf.g; window.__kill(window.__team(1)[0], g.mySlot); });
await run(7);
await shot('out_watching', 900);
await p.evaluate(() => { const f = window.__team(1); window.__team(0).forEach((s, i) => window.__kill(f[i % f.length], s)); });
await run(0.8);
console.log('round 3:', await st());
await shot('end_lost_while_out', 1600);
// round 4 to them, 5 and 6 to us: match point, then the last round
for (const r of [4]) {
  await p.evaluate(() => { window.__until('warmup'); window.__until('live'); const f = window.__team(1); window.__team(0).forEach((s, i) => window.__kill(f[i % f.length], s, i === 0 ? 1 : 0)); });
  await run(0.5);
  console.log(`round ${r}:`, await st());
}
await p.evaluate(() => window.__until('warmup'));
await run(0.8);
await shot('intro_their_match_point');
await p.evaluate(() => { window.__until('live'); const f = window.__team(0); window.__team(1).forEach((s, i) => window.__kill(f[i % f.length], s)); });
await run(0.8);
console.log('round 5:', await st());
await shot('end_won_flawless', 1600);
await p.evaluate(() => { window.__until('warmup'); window.__until('live'); const f = window.__team(0); window.__team(1).forEach((s, i) => window.__kill(f[(i + 1) % f.length], s, 1)); });
await run(0.8);
console.log('round 6:', await st());
await shot('end_won_downs', 1600);
await p.evaluate(() => window.__until('warmup'));
await run(0.8);
await shot('intro_last_round');
// overtime, as the screen shows it: the match held still on the frame the clock ran out
if (mode === 'siege') {
  await p.evaluate(() => { window.__until('live'); const g = __lf.g, m = g.match, up = m.update; m.update = () => {}; g.clock = -0.5; window.__run(0.5); m.update = up; });
  await shot('overtime', 600);
}
await p.evaluate(() => { window.__until('live'); const g = __lf.g; for (const s of window.__team(1)) window.__kill(g.mySlot, s); });
await run(1.2);
console.log('match:', await st());
await shot('final', 1200);
console.log('page errors:', errs);
await b.close();
