// Throughput GPU benchmark: the game loop is paused, then N frames are rendered back to back
// and synced (readPixels), per configuration. Much steadier than timer queries on Apple GPUs.
//   node tools/bench.mjs [track=monza] [scale=1] [cam=chase] [w=1440] [h=900]
import { chromium } from 'playwright-core';
const [track = 'monza', scale = '1', cam = 'chase', W = '1440', H = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}&demo=race&cam=${cam}&skip=30&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.waitForTimeout(2500);
const r = await page.evaluate(async (scale) => {
  const g = window.__game;
  g.adaptQuality = () => {};
  g.gfx.setDynamicScale(scale);
  await new Promise((r) => setTimeout(r, 300));
  g.worldBusy = true; // pause the loop
  const gl = g.gfx.renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const bench = (n = 24) => {
    g.gfx.render(0.016); sync();
    const ts = [];
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) g.gfx.render(0.016);
      sync();
      ts.push((performance.now() - t0) / n);
    }
    ts.sort((a, b) => a - b);
    return +ts[1].toFixed(2);
  };
  const out = {};
  const m = (name, on, off) => { on(); const a = bench(); off(); const b = bench(); out[name] = `${a} (base ${b}, Δ ${(b - a).toFixed(1)})`; };
  out.base = bench();
  const ao = g.gfx.ao;
  const passes = g.gfx.composer.passes;
  const relink = () => { passes.forEach((x) => (x.renderToScreen = false)); passes.filter((x) => x.enabled).pop().renderToScreen = true; };
  const C = g.gfx.composer;
  m('+MSAA4', () => { C.multisampling = 4; }, () => { C.multisampling = 0; });
  m('+MSAA4 -SMAA', () => { C.multisampling = 4; passes.find((p) => p.effects && p.effects[0].name === 'SMAAEffect').enabled = false; relink(); }, () => { C.multisampling = 0; passes.find((p) => p.effects && p.effects[0].name === 'SMAAEffect').enabled = true; relink(); });
  m('+MSAA2', () => { C.multisampling = 2; }, () => { C.multisampling = 0; });
  for (const s of [0.7, 1.25]) { g.gfx.setDynamicScale(s); out['scale' + s] = bench(); }
  g.worldBusy = false;
  return out;
}, Number(scale));
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(52), v);
await browser.close();
