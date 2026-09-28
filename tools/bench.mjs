// Throughput GPU benchmark: the game loop is paused, then N frames are rendered back to back
// and synced (readPixels), per configuration. Much steadier than timer queries on Apple GPUs.
//   node tools/bench.mjs [track=monza] [scale=1] [cam=chase] [w=1440] [h=900]
import { chromium } from 'playwright-core';
const [track = 'monza', scale = '1', cam = 'chase', W = '1440', H = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
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
  const passes = g.gfx.composer.passes;
  const relink = () => { passes.forEach((x) => (x.renderToScreen = false)); passes.filter((x) => x.enabled).pop().renderToScreen = true; };
  m('noPost', () => passes.forEach((p, i) => { p._w = p.enabled; if (i > 0) p.enabled = false; relink(); }), () => { passes.forEach((p) => (p.enabled = p._w)); relink(); });
  for (const p of passes.slice(1)) {
    if (!p.enabled) continue;
    m('-' + (p.effects ? p.effects.map((e) => e.name.replace('Effect', '')).join(',') : p.name), () => { p.enabled = false; relink(); }, () => { p.enabled = true; relink(); });
  }
  const sm = g.gfx.renderer.shadowMap;
  m('noShadowUpdate', () => (sm.autoUpdate = false), () => (sm.autoUpdate = true));
  const hide = (o) => [() => (o.visible = false), () => (o.visible = true)];
  const scen = g.env.group.children.find((c) => c.name === 'Scenery');
  if (scen) for (const c of scen.children) m('-' + c.name, ...hide(c));
  for (const c of g.env.group.children) if (c !== scen) m('-env:' + (c.name || c.type), ...hide(c));
  m('-trackside', ...hide(g.trackside.group));
  m('-pits', ...hide(g.pits.group));
  m('-cars', ...hide(g.carsGroup));
  for (const s of [0.7, 1.25]) { g.gfx.setDynamicScale(s); out['scale' + s] = bench(); }
  g.worldBusy = false;
  return out;
}, Number(scale));
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(52), v);
await browser.close();
