// Consecutive frames while driving, on a fixed 60 Hz clock: the page's requestAnimationFrame is
// held between shots and stepped one frame at a time, so frame k and k+1 are exactly 1/60 s of
// game time apart however slow the screenshots are — what a player would see pop in, one frame to
// the next (tree LOD / impostor swaps, culling at the frame's edge).
//   node tools/treeseq.mjs <outdir> [track=monza] [cam=chase] [shots=6] [every=1] [lead=0]
//   (env PORT, W, H, WEATHER, TIME, SKIP, Q = quality level; lead: seconds of game time run on the
//   fixed clock before the first shot. Also prints the tree stats: window.__park.veg)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
const [out = 'shots/treeseq', track = 'monza', cam = 'chase', shotsArg = '6', everyArg = '1', leadArg = '0'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1280), height: Number(process.env.H ?? 720) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 300)); });
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const vf = { hold: false, queue: [], t: 0 };
  window.__vf = vf;
  window.requestAnimationFrame = (cb) => {
    if (!vf.hold) return raf((t) => { vf.t = t; cb(t); });
    vf.queue.push(cb);
    return vf.queue.length;
  };
  // one 60 Hz frame of the held callbacks, inside a real frame (so the canvas is presented)
  window.__step = (n = 1) => new Promise((res) => {
    const one = () => raf(() => {
      vf.t += 1000 / 60;
      for (const cb of vf.queue.splice(0)) cb(vf.t);
      if (--n > 0) one(); else raf(() => res());
    });
    one();
  });
});
const t0 = Date.now();
await page.goto(`http://localhost:${process.env.PORT ?? 5805}/?track=${track}&demo=race&cam=${cam}&skip=${process.env.SKIP ?? 30}&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
console.log('ready in', Date.now() - t0, 'ms');
await page.evaluate((q) => {
  document.getElementById('ui').style.visibility = 'hidden';
  const g = window.__game;
  g.adaptQuality = () => {};
  if (q) g.gfx.setQuality?.(q);
  g.gfx.setDynamicScale(1);
}, process.env.Q ?? '');
await page.waitForTimeout(1500);
await page.evaluate(() => (window.__vf.hold = true));
await page.evaluate((n) => window.__step(n), Math.max(1, Math.round(Number(leadArg) * 60)));
const every = Number(everyArg);
for (let i = 0; i < Number(shotsArg); i++) {
  await page.evaluate((n) => window.__step(n), every);
  await page.screenshot({ path: `${out}/${track}_${cam}_${String(i).padStart(2, '0')}.png` });
}
console.log(JSON.stringify(await page.evaluate(() => { const v = window.__park?.veg; return v ? { trees: v.count, near: v.near, timings: v.timings } : null; })));
await browser.close();
