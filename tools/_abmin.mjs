// ab.mjs with more alternations (PAIRS, default 16) and the minimum per side too: on a GPU shared with other work the
// fastest run of each side is the least contended one. Δ is B (on) minus A (off).
//   node tools/_abmin.mjs <track> "<js that turns B on>" "<js that turns B off>" [cam=chase] [dpr=2] [scale=1]   (env PORT, WEATHER, TIME, W, H, PAIRS)
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const [track = 'monza', onJs = '', offJs = '', cam = 'chase', dpr = '2', scale = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) }, deviceScaleFactor: Number(dpr) });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${process.env.PORT ?? 5191}/?track=${track}&demo=race&cam=${cam}&skip=30&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.waitForTimeout(2500);
const r = await page.evaluate(async ([onJs, offJs, scale, N]) => {
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
  for (let k = 0; k < Number(N); k++) {
    off(g); A.push(run());
    on(g); B.push(run());
  }
  off(g);
  const med = (x) => x.slice().sort((a, b) => a - b)[x.length >> 1];
  const info = g.gfx.renderer.info;
  g.worldBusy = false;
  return { A: +med(A).toFixed(2), B: +med(B).toFixed(2), spreadA: +(Math.max(...A) - Math.min(...A)).toFixed(1), minA: +Math.min(...A).toFixed(2), minB: +Math.min(...B).toFixed(2) };
}, [onJs, offJs, Number(scale), Number(process.env.PAIRS ?? 16)]);
console.log(`median A ${r.A} B ${r.B} Δ ${(r.B - r.A).toFixed(2)} ms | min A ${r.minA} B ${r.minB} Δ ${(r.minB - r.minA).toFixed(2)} ms (A spread ${r.spreadA})`);
await browser.close();
