// Frame-time suite: CPU (frame()), GPU (timer query around frame()), rAF interval,
// hitches, draw calls and triangles in the main game states.
//
//   node tools/perfsuite.mjs [--track monza] [--dpr 2] [--q high] [--frames 180] [--adapt 0] [--only menu,grid,chase,tv,podium,replay]
//
// --adapt 1 keeps the adaptive resolution running (otherwise it is frozen at 1.0).
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const track = opt('track', 'monza');
const dpr = Number(opt('dpr', 2));
const q = opt('q', 'high');
const N = Number(opt('frames', 180));
const adapt = opt('adapt', '0') === '1';
// --legacy 1: switch this session's perf work back off at runtime for an A/B in the same build
// (car shadow proxies off, SMAA High, High's old 1.25 pixel ratio on Retina, podium crowd shadows)
const legacy = opt('legacy', '0') === '1';
const scale = opt('scale', null);
const only = opt('only', 'menu,grid,chase,tv,podium,replay').split(',');
const W = Number(opt('w', 1600));
const H = Number(opt('h', 900));

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
await page.addInitScript(([q]) => {
  // other people edit files while this runs: keep Vite's HMR socket from reloading the page mid-measurement
  const RealWS = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (String(proto).includes('vite') || String(url).includes('token=')) {
      return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} };
    }
    return new RealWS(url, proto);
  };
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: q, camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
}, [q]);
const t0 = Date.now();
await page.goto(`http://localhost:5191/?track=${track}&settle=500`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const bootMs = Date.now() - t0;
const bootInfo = await page.evaluate(() => (window.__bootMs ? window.__bootMs : null));

await page.evaluate(([adapt, q, legacy, scale]) => {
  const g = window.__game;
  if (g.menu.settings.quality !== q) {
    g.menu.settings.quality = q;
    g.applySettings(g.menu.settings);
  }
  g.menu.settings.autoQuality = false;
  if (!adapt) {
    g.adaptQuality = () => {};
    g.gfx.setDynamicScale(1);
  }
  if (scale) g.gfx.setDynamicScale(Number(scale));
  if (legacy) {
    for (const rig of g.rigs.values()) rig.shadowPass = undefined;
    g.gfx.smaa.applyPreset(2);
    g.gfx.updateScene = () => (g.scene.matrixWorldAutoUpdate = true);
    g.celebrationLegacy = true;
    if (!adapt) {
      g.gfx.maxDynamic = Math.max(g.gfx.maxDynamic, 1.25);
      g.gfx.setDynamicScale(Math.min(window.devicePixelRatio, 1.25));
    }
    window.__legacy = true;
  }
  const P = (window.__perf = { cpu: [], gpu: [], raf: [], calls: [], tris: [], last: 0, on: false });
  // GPU time comes from the game's own frame timer query (Renderer.gpuFrameBegin/End)
  g.gfx.onGpuTime = (ms) => {
    if (P.on) P.gpu.push(ms);
  };
  const fr = g.frame.bind(g);
  g.frame = (dt) => {
    const t = performance.now();
    fr(dt);
    const c = performance.now() - t;
    if (P.on) {
      P.cpu.push(c);
      const now = performance.now();
      if (P.last) P.raf.push(now - P.last);
      P.last = now;
      const info = g.gfx.renderer.info;
      P.calls.push(info.render.calls);
      P.tris.push(info.render.triangles);
    }
  };
}, [adapt, q, legacy, scale]);

const fixScale = () =>
  page.evaluate(([legacy, scale, adapt]) => {
    const g = window.__game;
    if (adapt) return;
    const want = scale ? Number(scale) : legacy ? Math.min(window.devicePixelRatio, 1.25) : 1;
    g.gfx.maxDynamic = Math.max(g.gfx.maxDynamic, want);
    g.gfx.setDynamicScale(want);
  }, [legacy, scale, adapt]);
const measure = async (name) => {
  await fixScale();
  return measure0(name);
};
const measure0 = (name) =>
  page.evaluate(
    ([N, name]) =>
      new Promise((res) => {
        const P = window.__perf;
        const g = window.__game;
        P.cpu = [];
        P.gpu = [];
        P.raf = [];
        P.calls = [];
        P.tris = [];
        P.last = 0;
        P.on = true;
        let k = 0;
        const f = () => {
          if (++k < N) return requestAnimationFrame(f);
          P.on = false;
          setTimeout(() => {
            const st = (a) => {
              if (!a.length) return null;
              const s = a.slice().sort((x, y) => x - y);
              const avg = s.reduce((x, y) => x + y, 0) / s.length;
              return { avg: +avg.toFixed(2), p50: +s[Math.floor(s.length / 2)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(1) };
            };
            const info = g.gfx.renderer.info;
            res({
              name,
              state: g.state,
              cam: g.cams?.mode,
              cpu: st(P.cpu),
              gpu: st(P.gpu),
              raf: st(P.raf),
              hitches: P.raf.filter((x) => x > 25).length,
              calls: Math.round(P.calls.reduce((a, b) => a + b, 0) / Math.max(1, P.calls.length)),
              ktris: Math.round(P.tris.reduce((a, b) => a + b, 0) / Math.max(1, P.tris.length) / 1000),
              scale: g.gfx.dynamicScale,
              geos: info.memory.geometries,
              tex: info.memory.textures,
              progs: info.programs?.length,
            });
          }, 300);
        };
        requestAnimationFrame(f);
      }),
    [N, name],
  );
const wait = (ms) => page.waitForTimeout(ms);
const results = [];
const log = (r) => {
  results.push(r);
  console.log(JSON.stringify(r));
};

if (only.includes('menu')) {
  await wait(1500);
  log(await measure('menu'));
}
if (only.includes('grid')) {
  await page.evaluate(() => window.__game.debugStart({ autopilot: true, camera: 'chase' }));
  log(await measure('grid'));
}
await page.evaluate(() => window.__game.debugStart({ autopilot: true, skip: 20, camera: 'chase' }));
if (only.includes('chase')) {
  await wait(500);
  log(await measure('chase'));
}
if (only.includes('tv')) {
  await page.evaluate(() => window.__game.cams.set('tv'));
  await wait(500);
  log(await measure('tv'));
}
if (only.includes('replay')) {
  await wait(3000);
  await page.evaluate(() => {
    const g = window.__game;
    g.showResults();
    g.startReplay();
  });
  await wait(300);
  log(await measure('replay'));
}
if (only.includes('podium')) {
  await page.evaluate(() => {
    const g = window.__game;
    g.startCelebration();
    if (window.__legacy) g.celebration.group.getObjectByName('fan-crowd')?.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  });
  await wait(300);
  log(await measure('podium'));
}
console.log('bootMs', bootMs, bootInfo ? JSON.stringify(bootInfo) : '');
for (const e of errors.slice(0, 15)) console.log(e);
await browser.close();
