// Wobble Mania: the mystery boxes. In one round (run ahead, not drawn): are there boxes, do the
// beans pick them up, and do the three powers do what they say? ZOOM: a bean running flat out
// with it against one without. SUPER JUMP: the height of a hop with and without. IRON BEAN: a
// bean dived into with it on stays on its feet.
//   node tools/wobblepower.mjs [--round hopscotch] [--port 5197]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const port = opt('port', '5197');
const round = opt('round', 'spothogs');
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
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:${port}/marbles.html?round=${round}&auto=1&go=1&nohud=1&settle=100`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const g = window.__marbles;
  g.paused = true;
  const step = (s) => { for (let t = 0; t < s && g.state !== 'results'; t += 1 / 60) g.ff(1 / 60); };
  while (g.state !== 'play') g.ff(1 / 60);
  // 1. a stretch of the round as it's played: boxes there, boxes taken
  let grants = 0;
  const grant = g.grant.bind(g);
  g.grant = (a, b, c) => { grants++; return grant(a, b, c); };
  let most = 0;
  for (let t = 0; t < 40 && g.state === 'play'; t += 1 / 60) { g.ff(1 / 60); most = Math.max(most, g.boxes ? g.boxes.spots.filter((s) => s.on).length : 0); }
  const out = { state: g.state, boxesSeen: most, picked: grants };
  if (g.state !== 'play') return out;
  // 2. the powers, on the bots' own legs: everyone stood still on the floor first
  const w = g.course.b.world, A = g.racers.filter((x) => !x.out && x.m.active && !x.c.player && !x.fin);
  const [a, b] = A;
  const hold = (m) => { m.pw = 0; m.pwT = 0; m.zoomT = 0; };
  const speedOf = (r, pw) => {
    hold(r.m);
    if (pw) { r.m.pw = pw; r.m.pwT = w.time + 30; }
    const bot = r.bot; r.bot = null;
    let top = 0;
    // (there and back, so it isn't run into a wall)
    for (let t = 0; t < 1.5; t += 1 / 60) { r.m.input.set(pw ? -1 : 1, 0, 0); g.ff(1 / 60); top = Math.max(top, Math.hypot(r.m.vel.x, r.m.vel.z)); }
    r.bot = bot;
    return +top.toFixed(2);
  };
  const jumpOf = (r, pw) => {
    hold(r.m);
    if (pw) { r.m.pw = pw; r.m.pwT = w.time + 30; }
    const bot = r.bot; r.bot = null;
    r.m.input.set(0, 0, 0);
    for (let t = 0; t < 0.5; t += 1 / 60) g.ff(1 / 60);
    const y0 = r.m.pos.y;
    let top = 0;
    r.m.jump = true;
    for (let t = 0; t < 1.2; t += 1 / 60) { g.ff(1 / 60); top = Math.max(top, r.m.pos.y - y0); }
    r.bot = bot;
    return +top.toFixed(2);
  };
  out.run = speedOf(a, 0);
  out.runZoom = speedOf(a, 1);
  out.jump = jumpOf(a, 0);
  out.jumpSuper = jumpOf(a, 2);
  // 3. IRON: knocked with it off, not with it on
  const knock = (pw) => {
    hold(b.m);
    b.m.mode = 0; b.m.tumbleT = 0; b.m.guardT = 0;
    if (pw) { b.m.pw = pw; b.m.pwT = w.time + 30; }
    g.ff(1 / 60);
    b.m.knock(0.6);
    return b.m.mode === 2;
  };
  out.knockedPlain = knock(0);
  step(1.5);
  out.knockedIron = knock(3);
  return out;
});
await browser.close();
console.log(JSON.stringify(r));
const bad = [];
if (errs.length) bad.push('errors: ' + errs.slice(0, 2).join(' | '));
if (!(r.boxesSeen > 0)) bad.push('no boxes');
if (!(r.picked > 0)) bad.push('no box was picked up');
if (r.run && !(r.runZoom > r.run * 1.15)) bad.push('ZOOM is not faster');
if (r.jump && !(r.jumpSuper > r.jump * 1.4)) bad.push('SUPER JUMP is not higher');
if (r.knockedPlain === false || r.knockedIron === true) bad.push('IRON BEAN does not hold');
console.log(bad.length ? 'FAIL: ' + bad.join('; ') : 'PASS');
process.exit(bad.length ? 1 : 0);
