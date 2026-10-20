// Marble Derby: runs races headless and fits the odds model to them.
//   node tools/derbysim.mjs [--port 5197] [--per 40] [--par 4] [--json out.json]
// Each race is a real one (the card for race number N, the bots, the physics), fast-forwarded. The
// finishing orders are fitted with a Plackett–Luce model, strength = exp(β · ability), per track,
// by maximum likelihood; it prints β and how well the fitted prices hold up (the favourite's
// predicted and actual win rate, and the log-loss against a coin flip among the field).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt('port', '5197');
const per = Number(opt('per', 40));
const par = Number(opt('par', 4));
const out = opt('json', null);
const from = Number(opt('from', 0));

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu'] });
const jobs = [];
for (let k = 0; k < per * 3; k++) jobs.push(from + k);
const results = [];
let done = 0;
await Promise.all(
  Array.from({ length: par }, async (_, w) => {
    for (let j = w; j < jobs.length; j += par) {
      const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
      try {
        await page.goto(`http://localhost:${port}/derby.html?race=${jobs[j]}&go=1&nohud=1&gfx=low&settle=30`);
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
        const r = await page.evaluate(() => {
          const g = window.__derby;
          for (let k = 0; k < 500 && g.state !== 'payout'; k++) g.ff(0.5);
          const order = [...g.field].sort((a, b) => a.fin - b.fin);
          return { track: g.built.course.id, skills: order.map((e) => e.r.skill), names: order.map((e) => e.r.name), t: order[0].finT };
        });
        results.push(r);
        done++;
        if (done % 10 === 0) console.log(`${done}/${jobs.length}`);
      } catch (e) {
        console.log('race', jobs[j], 'failed', String(e).slice(0, 120));
      }
      await page.close();
    }
  }),
);
await browser.close();
if (out) fs.writeFileSync(out, JSON.stringify(results));

// the fit: log-likelihood of the observed orders under PL with strength exp(β·s)
const ll = (races, beta) => {
  let L = 0;
  for (const r of races) {
    const w = r.skills.map((s) => Math.exp(beta * s));
    let W = w.reduce((a, b) => a + b, 0);
    for (let k = 0; k < w.length - 1; k++) {
      L += Math.log(w[k] / W);
      W -= w[k];
    }
  }
  return L;
};
for (const track of ['mile', 'spiral', 'cascade']) {
  const races = results.filter((r) => r.track === track);
  if (!races.length) continue;
  let best = 0, bestL = -Infinity;
  for (let b = 0; b <= 30; b += 0.25) {
    const L = ll(races, b);
    if (L > bestL) (bestL = L), (best = b);
  }
  const flat = ll(races, 0);
  // the favourite: how often the field's best won, against the model's own say
  let favWins = 0, favP = 0;
  for (const r of races) {
    const mx = Math.max(...r.skills);
    if (r.skills[0] === mx) favWins++;
    const w = r.skills.map((s) => Math.exp(best * s));
    favP += Math.exp(best * mx) / w.reduce((a, b) => a + b, 0);
  }
  const times = races.map((r) => r.t).sort((a, b) => a - b);
  console.log(`${track}: ${races.length} races  β = ${best}  (log-lik ${bestL.toFixed(1)} vs ${flat.toFixed(1)} flat)  favourite won ${((favWins / races.length) * 100).toFixed(0)}% (model ${((favP / races.length) * 100).toFixed(0)}%)  winning time ${times[0].toFixed(1)}–${times[times.length - 1].toFixed(1)} s`);
}
