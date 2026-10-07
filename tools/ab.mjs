// Steady A/B GPU timing of one runtime toggle: the loop paused, frames rendered back to back and synced,
// A and B alternated several times (drift cancels), medians reported.
//   node tools/ab.mjs <track> "<js that turns B on>" "<js that turns B off>" [cam=chase] [dpr=2] [scale=1]
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', onJs = '', offJs = '', cam = 'chase', dpr = '2', scale = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(dpr) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}&demo=race&cam=${cam}&skip=30&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.waitForTimeout(2500);
const r = await page.evaluate(async ([onJs, offJs, scale]) => {
  const g = window.__game;
  g.adaptQuality = () => {};
  g.gfx.setDynamicScale(scale);
  await new Promise((r) => setTimeout(r, 300));
  // one real frame with the views synced, then pause
  g.worldBusy = true;
  const gl = g.gfx.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const on = new Function('g', onJs);
  const off = new Function('g', offJs);
  const run = (n = 30) => {
    g.gfx.render(0.016); sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) g.gfx.render(0.016);
    sync();
    return (performance.now() - t0) / n;
  };
  const A = [], B = [];
  for (let k = 0; k < 6; k++) {
    off(g); A.push(run());
    on(g); B.push(run());
  }
  off(g);
  const med = (x) => x.slice().sort((a, b) => a - b)[x.length >> 1];
  const info = g.gfx.renderer.info;
  g.worldBusy = false;
  return { A: +med(A).toFixed(2), B: +med(B).toFixed(2), spreadA: +(Math.max(...A) - Math.min(...A)).toFixed(1) };
}, [onJs, offJs, Number(scale)]);
console.log(`A ${r.A} ms   B ${r.B} ms   Δ ${(r.A - r.B).toFixed(2)} ms  (A spread ${r.spreadA})`);
await browser.close();
