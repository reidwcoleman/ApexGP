// Careful GPU ablation at a fixed render scale (median of many frames, each toggle measured twice).
//   node tools/ablate2.mjs [track=monza] [scale=1] [cam=chase]
import { chromium } from 'playwright-core';
const [track = 'monza', scale = '1', cam = 'chase'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:5191/?track=${track}&demo=race&cam=${cam}&skip=30&weather=clear&time=afternoon`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const r = await page.evaluate(async (scale) => {
  const g = window.__game;
  g.adaptQuality = () => {};
  g.gfx.setDynamicScale(scale);
  const frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : res()); requestAnimationFrame(f); });
  const med = async (n = 80) => { g.gfx.takeGpuSamples(); await frames(n); const s = g.gfx.takeGpuSamples().slice().sort((a, b) => a - b); return s.length ? +s[Math.floor(s.length / 2)].toFixed(1) : -1; };
  await frames(90);
  const out = {};
  const measure = async (name, on, off) => { const v = []; for (let k = 0; k < 2; k++) { on(); await frames(8); v.push(await med()); off(); await frames(8); v.push(-(await med())); } out[name] = [v[0], v[2]].map(Math.abs).join('/') + ' vs base ' + [v[1], v[3]].map(Math.abs).join('/'); };
  const hide = (o) => [() => (o.visible = false), () => (o.visible = true)];
  const scen = g.env.group.children.find((c) => c.name === 'Scenery');
  out.base = await med(120);
  const passes = g.gfx.composer.passes;
  // post off: only the render pass, to screen
  await measure('noPost', () => { passes.forEach((p, i) => { p._was = p.enabled; p._rts = p.renderToScreen; if (i > 0) p.enabled = false; p.renderToScreen = i === 0; }); }, () => passes.forEach((p) => { p.enabled = p._was; p.renderToScreen = p._rts; }));
  const sm = g.gfx.renderer.shadowMap;
  await measure('noShadowUpdate', () => (sm.autoUpdate = false), () => (sm.autoUpdate = true));
  await measure('shadowsOff', () => (sm.enabled = false), () => { sm.enabled = true; sm.needsUpdate = true; });
  if (scen) for (const c of scen.children) await measure('-' + c.name, ...hide(c));
  for (const c of g.env.group.children) if (c !== scen) await measure('-env:' + (c.name || c.type), ...hide(c));
  await measure('-trackside', ...hide(g.trackside.group));
  await measure('-pits', ...hide(g.pits.group));
  await measure('-cars', ...hide(g.carsGroup));
  out.calls = g.gfx.renderer.info.render.calls; out.ktris = Math.round(g.gfx.renderer.info.render.triangles / 1000);
  return out;
}, Number(scale));
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(28), v);
await browser.close();
