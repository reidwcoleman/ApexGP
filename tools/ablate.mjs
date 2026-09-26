// GPU ablation: median GPU ms of one frame with individual features switched off.
//   node tools/ablate.mjs [--scene menu|chase|tv|podium] [--dpr 1] [--q high] [--track monza]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const scene = opt('scene', 'chase');
const dpr = Number(opt('dpr', 1));
const q = opt('q', 'high');
const track = opt('track', 'monza');

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
await page.addInitScript(([q]) => {
  const RealWS = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (String(proto).includes('vite') || String(url).includes('token=')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} };
    return new RealWS(url, proto);
  };
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: q, camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
}, [q]);
await page.goto(`http://localhost:5191/?track=${track}&settle=500`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const out = await page.evaluate(async (scene) => {
  const g = window.__game;
  g.adaptQuality = () => {};
  g.gfx.setDynamicScale(1);
  if (scene !== 'menu') g.debugStart({ autopilot: true, skip: 20, camera: 'chase' });
  if (scene === 'tv') g.cams.set('tv');
  if (scene === 'podium') g.startCelebration();
  let samples = [];
  g.gfx.onGpuTime = (ms) => samples.push(ms);
  const frames = (n) => new Promise((r) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); });
  const med = async (n = 50) => { await frames(8); samples = []; await frames(n); const s = samples.slice().sort((a, b) => a - b); return s.length ? +s[Math.floor(s.length * 0.1)].toFixed(1) : -1; };
  const res = {};
  const base = [];
  const tog = async (name, off, on) => {
    base.push(await med(40));
    off();
    res[name] = await med();
    on();
  };
  await frames(30);
  const vis = (o) => [() => o && (o.visible = false), () => o && (o.visible = true)];
  const passes = g.gfx.composer.passes;
  const post = passes.slice(1).filter((p) => p.enabled);
  await tog('noPost', () => { post.forEach((p) => (p.enabled = false)); passes[0].renderToScreen = true; }, () => { passes[0].renderToScreen = false; post.forEach((p) => (p.enabled = true)); post[post.length - 1].renderToScreen = true; });
  for (const p of post) {
    const nm = p.name + ':' + (p.effects ? p.effects.map((e) => e.name).join('+') : '');
    await tog('-' + nm, () => { p.enabled = false; passes.forEach((x) => (x.renderToScreen = false)); passes.filter((x) => x.enabled).pop().renderToScreen = true; }, () => { p.enabled = true; passes.forEach((x) => (x.renderToScreen = false)); passes.filter((x) => x.enabled).pop().renderToScreen = true; });
  }
  const sm = g.gfx.renderer.shadowMap;
  await tog('-shadowUpdate', () => (sm.autoUpdate = false), () => (sm.autoUpdate = true));
  await tog('-env', ...vis(g.env.group));
  const scen = g.env.group.children.find((c) => c.name === 'Scenery');
  if (scen) for (const c of scen.children) await tog('-scen:' + (c.name || c.type), ...vis(c));
  for (const c of g.env.group.children) if (c !== scen) await tog('-env:' + (c.name || c.type), ...vis(c));
  await tog('-trackside', ...vis(g.trackside.group));
  await tog('-pits', ...vis(g.pits.group));
  await tog('-cars', ...vis(g.carsGroup));
  await tog('-particles', ...vis(g.particles.group));
  if (g.garage) await tog('-garage', ...vis(g.garage.group));
  await tog('-garageLights', ...vis(g.garageLights));
  if (g.celebration) await tog('-celebration', ...vis(g.celebration.group));
  const s0 = g.gfx.dynamicScale;
  await tog('scale0.7', () => g.gfx.setDynamicScale(0.7), () => g.gfx.setDynamicScale(s0));
  base.push(await med(40));
  res.base = base;
  res.calls = g.gfx.renderer.info.render.calls;
  res.ktris = Math.round(g.gfx.renderer.info.render.triangles / 1000);
  return res;
}, scene);
console.log(scene, JSON.stringify(out, null, 0).replace(/,"/g, ',\n"'));
await browser.close();
