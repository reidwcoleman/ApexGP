// Interleaved A/B of this session's perf work in one page (so machine load cancels out):
// A = legacy (car shadow proxies off, whole-scene matrix update, SMAA High, podium crowd shadows,
// High's old 1.25 pixel ratio on Retina), B = current. Alternates A/B blocks per scene and reports
// medians of CPU frame time, GPU frame time, rAF interval, draw calls, triangles.
//   node tools/abtest.mjs [--dpr 2] [--scenes menu,grid,chase,tv,replay,podium] [--cycles 4] [--block 50] [--track monza]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const dpr = Number(opt('dpr', 2));
const scenes = opt('scenes', 'menu,grid,chase,tv,replay,podium').split(',');
const cycles = Number(opt('cycles', 4));
const block = Number(opt('block', 50));
const track = opt('track', 'monza');
// --sync 1: also time back-to-back renders (gl finished) — the render's full CPU+GPU cost, immune to vsync
const sync = opt('sync', '1') === '1';

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: dpr });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
await page.addInitScript(() => {
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: 'high', camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
});
await page.goto(`http://localhost:5191/?track=${track}&settle=300`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
await page.evaluate(() => {
  const g = window.__game;
  g.adaptQuality = () => {};
  const P = (window.__ab = { on: false, cpu: [], gpu: [], raf: [], calls: [], tris: [], last: 0 });
  g.gfx.onGpuTime = (ms) => P.on && P.gpu.push(ms);
  const fr = g.frame.bind(g);
  g.frame = (dt) => {
    const t = performance.now();
    fr(dt);
    if (!P.on) return;
    P.cpu.push(performance.now() - t);
    const now = performance.now();
    if (P.last) P.raf.push(now - P.last);
    P.last = now;
    P.calls.push(g.gfx.renderer.info.render.calls);
    P.tris.push(g.gfx.renderer.info.render.triangles);
  };
  const upd = g.gfx.updateScene.bind(g.gfx);
  const proxies = new Map();
  window.__setLegacy = (on) => {
    for (const rig of g.rigs.values()) {
      if (!proxies.has(rig)) proxies.set(rig, rig.shadowPass);
      rig.shadowPass = on ? undefined : proxies.get(rig);
    }
    g.gfx.smaa.applyPreset(on ? 2 : 1);
    g.gfx.updateScene = on ? () => (g.scene.matrixWorldAutoUpdate = true) : upd;
    const s = on ? Math.min(window.devicePixelRatio, 1.25) : 1;
    g.gfx.maxDynamic = Math.max(g.gfx.maxDynamic, s);
    // (the garage look keeps its own scale in the menu)
    if (g.state !== 'menu') g.gfx.setDynamicScale(s);
    const crowd = g.celebration?.group.getObjectByName('fan-crowd');
    crowd?.traverse((o) => { if (o.isMesh) o.castShadow = on; });
  };
});
const med = (a) => {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const run = (legacy) =>
  page.evaluate(
    ([legacy, block]) =>
      new Promise((res) => {
        window.__setLegacy(legacy);
        const P = window.__ab;
        let k = 0;
        const f = () => {
          if (++k === 12) {
            P.cpu = []; P.gpu = []; P.raf = []; P.calls = []; P.tris = []; P.last = 0; P.on = true;
          }
          if (k < 12 + block) return requestAnimationFrame(f);
          P.on = false;
          setTimeout(() => res({ cpu: P.cpu, gpu: P.gpu, raf: P.raf, calls: P.calls, tris: P.tris }), 150);
        };
        requestAnimationFrame(f);
      }),
    [legacy, block],
  );
const renderCost = (legacy) =>
  page.evaluate((legacy) => {
    window.__setLegacy(legacy);
    const g = window.__game;
    const gl = g.gfx.renderer.getContext();
    const px = new Uint8Array(4);
    const T = (n) => { const t = performance.now(); for (let i = 0; i < n; i++) g.gfx.render(0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t) / n; };
    T(3);
    return T(12);
  }, legacy);
const setup = {
  menu: async () => {},
  grid: () => page.evaluate(() => window.__game.debugStart({ autopilot: true, camera: 'chase' })),
  chase: () => page.evaluate(() => window.__game.debugStart({ autopilot: true, skip: 20, camera: 'chase' })),
  tv: () => page.evaluate(() => window.__game.cams.set('tv')),
  replay: () => page.evaluate(() => { const g = window.__game; g.showResults(); g.startReplay(); }),
  podium: async () => {
    await page.evaluate(() => window.__game.startCelebration());
    await page.waitForFunction(() => !!window.__game.celebration, null, { timeout: 30000 });
  },
};
const rows = [];
for (const sc of scenes) {
  if (sc === 'replay' && !scenes.includes('chase')) await setup.chase();
  await setup[sc]();
  await page.waitForTimeout(sc === 'grid' ? 200 : 800);
  const acc = { A: { cpu: [], gpu: [], raf: [], calls: [], tris: [] }, B: { cpu: [], gpu: [], raf: [], calls: [], tris: [] } };
  for (let c = 0; c < cycles; c++) {
    for (const [key, legacy] of c % 2 ? [['B', false], ['A', true]] : [['A', true], ['B', false]]) {
      const r = await run(legacy);
      for (const k of Object.keys(r)) acc[key][k].push(...r[k]);
    }
  }
  const sum = (x) => ({
    cpu: +med(x.cpu).toFixed(2),
    gpu: +med(x.gpu).toFixed(2),
    raf: +med(x.raf).toFixed(2),
    fps: +(1000 / med(x.raf)).toFixed(0),
    calls: Math.round(med(x.calls)),
    ktris: Math.round(med(x.tris) / 1000),
  });
  const row = { scene: sc, A: sum(acc.A), B: sum(acc.B) };
  if (sync) {
    const ra = [], rb = [];
    for (let c = 0; c < 3; c++) {
      ra.push(await renderCost(true));
      rb.push(await renderCost(false));
    }
    row.A.renderMs = +med(ra).toFixed(2);
    row.B.renderMs = +med(rb).toFixed(2);
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
await browser.close();
