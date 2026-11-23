// Wobble Mania: do the bots move about? Plays a round with the bots (run ahead, not drawn) and
// reports how fast they go on average, how much of the time each is standing still, how far each
// roams from where it started, and how the round came out.
//   node tools/wobblemove.mjs --rounds jumpclub,volleyfolly,overfence [--secs 70] [--port 5197]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const rounds = opt('rounds', 'jumpclub,volleyfolly,overfence').split(',');
const secs = Number(opt('secs', 70));
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
let bad = 0;
for (const id of rounds) {
  const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${port}/marbles.html?round=${id}&auto=1&go=1&nohud=1&settle=100`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const r = await page.evaluate((secs) => {
    const g = window.__marbles;
    g.paused = true;
    const S = new Map();
    let n = 0;
    const outAt = [];
    for (let t = 0; t < secs + 8 && g.state !== 'over' && g.state !== 'results' && g.state !== 'champion'; t += 1 / 60) {
      g.ff(1 / 60);
      if (g.state !== 'play') continue;
      n++;
      for (const r of g.racers) {
        let s = S.get(r.c.id);
        if (!s) S.set(r.c.id, (s = { x0: r.m.pos.x, z0: r.m.pos.z, sp: 0, still: 0, n: 0, far: 0, path: 0, out: false }));
        if (r.out) { if (!s.out) { s.out = true; outAt.push(+g.playT.toFixed(0)); } continue; }
        const v = Math.hypot(r.m.vel.x, r.m.vel.z);
        s.sp += v;
        s.path += v / 60;
        if (v < 0.6) s.still++;
        s.n++;
        s.far = Math.max(s.far, Math.hypot(r.m.pos.x - s.x0, r.m.pos.z - s.z0));
      }
    }
    const list = [...S.values()].filter((s) => s.n > 120);
    const avg = (f) => list.reduce((a, s) => a + f(s), 0) / Math.max(1, list.length);
    const still = list.map((s) => s.still / s.n).sort((a, b) => a - b);
    return {
      t: +g.playT.toFixed(0), state: g.state, alive: g.racers.filter((r) => !r.out).length, of: g.racers.length,
      speed: +avg((s) => s.sp / s.n).toFixed(2), still: Math.round(avg((s) => s.still / s.n) * 100), worstStill: Math.round(still[still.length - 1] * 100),
      roam: +avg((s) => s.far).toFixed(1), perMin: +avg((s) => (s.path / s.n) * 3600).toFixed(0),
      score: g.cupP ? g.cupP.score.join('-') : '', outAt: outAt.slice(0, 12).join(','),
    };
  }, secs);
  await page.close();
  if (errs.length) bad++;
  console.log(`${id.padEnd(12)} ${String(r.t).padStart(4)}s ${r.state.padEnd(5)} left ${r.alive}/${r.of}${r.score ? ' score ' + r.score : ''} · mean speed ${r.speed} m/s · standing still ${r.still}% of the time (the stillest bean ${r.worstStill}%) · roams ${r.roam} m from its start · ${r.perMin} m a minute${r.outAt ? ' · out at ' + r.outAt : ''}${errs.length ? ' ERR ' + errs[0] : ''}`);
}
await browser.close();
console.log(bad ? 'FAIL' : 'DONE');
process.exit(bad);
