// Wobble Mania: out of the show, the ghost, the stars and the revive. Plays a show of the rounds
// given with you knocked out in the first one (a survival round), then reports every round: were
// you a ghost, how many stars it picked up, was the revive taken, were you back in.
//   node tools/wobbleghost.mjs [--show jumpclub,spothogs,beanbaygp,hopscotch,gatecrashers] [--stars 0] [--measure 1] [--out dir]
//   --stars N: the stars you have when you're knocked out (50 or more: saved on the spot)
//   --measure 1: the revive is priced out of reach, so every round is flown as a ghost (how many stars does each give?)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const show = opt('show', 'jumpclub,spothogs,beanbaygp,hopscotch,gatecrashers');
const stars = Number(opt('stars', 0));
const measure = opt('measure', '') === '1';
const out = opt('out', '');
if (out) fs.mkdirSync(out, { recursive: true });
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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const said = [];
page.on('pageerror', (e) => said.push(`PAGEERROR ${e.message}`));
page.on('crash', () => said.push('THE PAGE CRASHED'));
browser.on('disconnected', () => said.push('THE BROWSER WENT AWAY'));
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load') && said.push(`ERROR ${m.text().slice(0, 300)}`));
await page.goto(`http://localhost:${port}/marbles.html?lineup=${show}&settle=100`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.evaluate(({ stars, measure }) => {
  const g = window.__marbles;
  g.autopilot = true;
  g.newShow();
  window.__gh = { stars, measure, done: false, rows: [], last: -1 };
}, { stars, measure });
const ids = show.split(',');
let lost = false, shot = -1, lastRows = [];
for (let k = 0; k < 700; k++) {
  const s = await page.waitForTimeout(700).then(() => page.evaluate(() => {
    const g = window.__marbles, T = window.__gh;
    const me = g.roster.find((x) => x.player);
    if (g.state === 'play') {
      // the first round: knocked out a few seconds in, with the stars asked for
      if (g.roundIdx === 0 && !T.done && g.playT > 3) {
        T.done = true;
        g.starCount = T.stars;
        const r = g.racers.find((q) => q.c.player);
        g.eliminate(r);
      }
      if (T.measure) g.reviveN = 60;
      if (T.last !== g.roundIdx) {
        T.last = g.roundIdx;
        T.rows.push({ i: g.roundIdx, id: g.course.id, ghost: !!g.ghostsI?.me, inRound: g.racers.some((q) => q.c.player), stars0: g.starCount, field: g.racers.length });
      }
      if (g.playT > 4) for (let i = 0; i < 30 && g.state === 'play'; i++) g.ff(1);
    }
    const row = T.rows[T.rows.length - 1];
    if (row && row.i === g.roundIdx) {
      row.stars1 = g.starCount;
      row.asked = row.asked || g.reviveAsked;
      row.out = !!me?.out;
      row.t = +g.playT.toFixed(0);
    }
    window.__ghRows = T.rows;
    return { i: g.roundIdx, state: g.state, ghost: !!g.ghostsI?.me, t: g.playT, rows: T.rows };
  })).catch((e) => (said.push(`LOST IT at step ${k}: ${String(e.message).slice(0, 400)}`), null));
  if (!s) { lost = true; break; }
  lastRows = s.rows;
  if (out && s.state === 'play' && s.ghost && shot !== s.i && s.t > 2) { shot = s.i; await page.screenshot({ path: `${out}/ghost-${s.i}.png` }); }
  if (out && s.state === 'results' && shot !== 100 + s.i) { shot = 100 + s.i; await page.screenshot({ path: `${out}/results-${s.i}.png` }); }
  if (s.state === 'champion') break;
}
const rows = lastRows;
for (const r of rows) console.log(`${r.i} ${String(r.id).padEnd(14)} ${r.ghost ? 'GHOST   ' : r.inRound ? 'in round' : 'watching'} field ${String(r.field).padStart(2)} stars ${r.stars0} -> ${r.stars1}${r.asked ? '  REVIVE TAKEN' : ''} (${r.t}s)`);
let bad = said.length || lost ? 1 : 0;
if (!measure && !lost) {
  // out in round 0; a ghost until the stars are there; then in again
  const took = rows.findIndex((r) => r.asked);
  if (took < 0) { console.log('BAD: the revive was never taken'); bad = 1; }
  else if (rows[took + 1] && !rows[took + 1].inRound) { console.log('BAD: revived, but not in the next round'); bad = 1; }
  if (stars < 50 && took !== 0 && rows[1] && !rows[1].ghost) { console.log('BAD: out, but no ghost in the next round'); bad = 1; }
}
if (lost) console.log('LOST THE PAGE');
console.log(said.length ? `SAID: ${[...new Set(said)].join(' | ')}` : 'CONSOLE CLEAN');
console.log(bad ? 'FAIL' : 'PASS');
await browser.close().catch(() => undefined);
process.exit(bad);
