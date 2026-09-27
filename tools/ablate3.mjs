// Careful GPU ablation at a fixed render scale (median of many frames, each toggle measured twice).
//   node tools/ablate2.mjs [track=monza] [scale=1] [cam=chase]
import { chromium } from 'playwright-core';
const [track = 'monza', scale = '1', cam = 'chase', out = ''] = process.argv.slice(2);
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
  out.enabled = passes.map((p) => (p.enabled ? 1 : 0) + ':' + (p.name || p.constructor.name) + (p.effects ? '[' + p.effects.map((e) => e.name).join(',') + ']' : '')).join(' | ');
  const relink = () => { passes.forEach((x) => (x.renderToScreen = false)); passes.filter((x) => x.enabled).pop().renderToScreen = true; };
  for (const p of passes.slice(1)) {
    if (!p.enabled) continue;
    await measure('-' + (p.name || p.constructor.name) + (p.effects ? '[' + p.effects.map((e) => e.name).join(',') + ']' : ''), () => { p.enabled = false; relink(); }, () => { p.enabled = true; relink(); });
  }
  const bl = g.gfx.bloom;
  await measure('bloomOff', () => (bl.blendMode.opacity.value = 0, bl.disabled = true, bl.intensity = 0), () => (bl.blendMode.opacity.value = 1, bl.intensity = 0.9));
  out.calls = g.gfx.renderer.info.render.calls; out.ktris = Math.round(g.gfx.renderer.info.render.triangles / 1000);
  return out;
}, Number(scale));
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(28), v);
await browser.close();
