// Wobble Mania: plays one round in real time, drawing every frame, and reports everything the
// console said (warnings as well as errors) with a picture every few seconds.
//   node tools/wobblewatch.mjs --round beancup [--secs 40] [--every 8] [--out /tmp/shots] [--port 5197] [--me 1]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const lineup = opt('round', 'beancup');
const secs = Number(opt('secs', 40));
const every = Number(opt('every', 8));
const out = opt('out', '');
const w = Number(opt('w', 960)), h = Number(opt('h', 540));
if (out) fs.mkdirSync(out, { recursive: true });
let browser;
for (let tries = 0; tries < 6 && !browser; tries++) {
  try {
    browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
    const p = await browser.newPage();
    await p.close();
  } catch {
    await browser?.close().catch(() => undefined);
    browser = undefined;
    await new Promise((r) => setTimeout(r, 4000));
  }
}
if (!browser) { console.log('FAIL: the browser would not start'); process.exit(1); }
const page = await browser.newPage({ viewport: { width: w, height: h } });
const said = new Map();
const note = (k) => said.set(k, (said.get(k) ?? 0) + 1);
page.on('pageerror', (e) => note(`PAGEERROR ${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && note(`${m.type().toUpperCase()} ${m.text().slice(0, 400)}`));
// --show a,b,c: a whole show of those rounds from the menu, the way it's played: the wheel, the
// cards, the results and the next round built behind them all happen in real time (that's where a
// GL error would be), and the middle of each round is run ahead
const show = opt('show', '');
if (show) {
  await page.goto(`http://localhost:${port}/marbles.html?lineup=${show}&settle=100`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.evaluate(() => { const g = window.__marbles; g.autopilot = true; g.newShow(); });
  const ids = show.split(',');
  const log = [];
  let stuck = 0, lastKey = '';
  page.on('crash', () => log.push('THE PAGE CRASHED'));
  browser.on('disconnected', () => log.push('THE BROWSER WENT AWAY'));
  for (let k = 0; k < 900; k++) {
    const s = await page.waitForTimeout(1000).then(() => page.evaluate(() => {
      const g = window.__marbles;
      // (out of the show: watch the rest; the results wait for nobody)
      if ((g.state === 'results' || g.state === 'champion') && !g.resultsNext) [...document.querySelectorAll('button')].find((b) => /WATCH THE REST/i.test(b.textContent) && b.offsetParent !== null)?.click();
      if (g.state === 'play' && g.playT > 5) for (let i = 0; i < 40 && g.state === 'play'; i++) g.ff(1);
      return { i: g.roundIdx, id: g.course?.id, state: g.state, t: +g.playT.toFixed(0), alive: g.roster.filter((x) => !x.out).length };
    })).catch((e) => (log.push(`LOST IT: ${String(e.message).slice(0, 90)}`), null));
    if (!s) break;
    const key = `${s.i}:${s.state}`;
    if (key !== lastKey) { log.push(`${s.i} ${s.id} ${s.state} (${s.alive} in)`); lastKey = key; stuck = 0; } else stuck++;
    if (out && s.state === 'play' && stuck === 3) await page.screenshot({ path: `${out}/show-${s.i}-${s.id}.png` });
    if (s.state === 'champion' || (s.i >= ids.length - 1 && s.state === 'results') || stuck > 90) break;
  }
  console.log(log.join('\n'));
  console.log(said.size ? `SAID (${said.size}):` : 'CONSOLE CLEAN');
  for (const [k, c] of said) console.log(`  x${c} ${k}`);
  await browser.close().catch(() => undefined);
  process.exit(said.size || log.some((l) => /CRASHED|WENT AWAY|LOST IT/.test(l)) ? 1 : 0);
}
await page.goto(`http://localhost:${port}/marbles.html?round=${lineup}&auto=${opt('me', '1')}&go=1&settle=100`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const t0 = Date.now();
let n = 0;
const rows = [];
while ((Date.now() - t0) / 1000 < secs) {
  await page.waitForTimeout(every * 1000);
  const s = await page.evaluate(() => {
    const g = window.__marbles;
    return { id: g.course?.id, state: g.state, t: +g.playT.toFixed(1), alive: g.racers.filter((r) => !r.out).length, cup: g.cupP ? g.cupP.score.join('-') : undefined, fps: Math.round(1 / Math.max(1e-3, g.fpsAcc / Math.max(1, g.fpsN))) };
  });
  rows.push(s);
  if (out) await page.screenshot({ path: `${out}/${lineup.split(',')[0]}-${String(n++).padStart(2, '0')}.png` });
  if (s.state !== 'play' && s.state !== 'countdown' && s.state !== 'intro') break;
}
for (const r of rows) console.log(JSON.stringify(r));
console.log(said.size ? `SAID (${said.size}):` : 'CONSOLE CLEAN');
for (const [k, c] of said) console.log(`  x${c} ${k}`);
await browser.close();
process.exit(said.size ? 1 : 0);
