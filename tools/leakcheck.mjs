// GPU leak check for the in-process circuit switch: counts live WebGL textures/buffers/
// framebuffers (wrapping the GL context) across monza → A → monza and groups what survived by the
// stack that created it.
//   node tools/leakcheck.mjs [--via spa] [--rounds 1]
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const via = opt('via', 'spa').split(',');
const rounds = Number(opt('rounds', 1));

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[error] ' + m.text());
});
await page.addInitScript(() => {
  const live = { texture: new Map(), buffer: new Map(), framebuffer: new Map(), renderbuffer: new Map() };
  window.__glLive = live;
  window.__glTag = 0;
  const wrap = (proto) => {
    for (const kind of Object.keys(live)) {
      const C = 'create' + kind[0].toUpperCase() + kind.slice(1);
      const D = 'delete' + kind[0].toUpperCase() + kind.slice(1);
      const c0 = proto[C], d0 = proto[D];
      proto[C] = function (...a) {
        const o = c0.apply(this, a);
        if (o) live[kind].set(o, { tag: window.__glTag, stack: new Error().stack.split('\n').slice(2, 9).join(' | ') });
        return o;
      };
      proto[D] = function (o) {
        live[kind].delete(o);
        return d0.call(this, o);
      };
    }
  };
  wrap(WebGL2RenderingContext.prototype);
  try {
    localStorage.setItem('apexgp.settings', JSON.stringify({ v: 99, quality: 'high', camera: 'chase', volume: 0, autoQuality: false }));
  } catch {}
});
await page.goto('http://localhost:5191/?track=monza&settle=300', { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const out = await page.evaluate(
  async ([via, rounds]) => {
    const g = window.__game;
    const frames = (n) => new Promise((r) => { let k = 0; const f = () => (++k < n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); });
    await frames(30);
    const count = () => Object.fromEntries(Object.entries(window.__glLive).map(([k, m]) => [k, m.size]));
    const mem = () => ({ ...g.gfx.renderer.info.memory, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null });
    const res = { base: { gl: count(), three: mem() }, steps: [] };
    window.__glTag = 1;
    // three.js textures / geometries that get uploaded from now on (they register a 'dispose' listener)
    const ED = Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(g.scene)));
    const tracked = new Map();
    const add0 = ED.addEventListener, rem0 = ED.removeEventListener;
    ED.addEventListener = function (type, fn) {
      if (type === 'dispose' && (this.isTexture || this.isBufferGeometry)) tracked.set(this, new Error().stack.split('\n').slice(3, 12).join(' | '));
      return add0.call(this, type, fn);
    };
    ED.removeEventListener = function (type, fn) {
      if (type === 'dispose') tracked.delete(this);
      return rem0.call(this, type, fn);
    };
    window.__tracked = tracked;
    for (let r = 0; r < rounds; r++) {
      for (const id of [...via, 'monza']) {
        await g.travelAsync(id);
        await frames(30);
        res.steps.push({ id, ms: g.travelMs, gl: count(), three: mem(), times: g.worldTimes });
        if (id === 'monza') {
          const snap = {};
          for (const [o, st] of tracked) {
            const img = o.image ?? {};
            const k = (o.isTexture ? 'TEX ' + o.constructor.name + ' ' + (o.name || '') + ' ' + (img.width ?? '') + 'x' + (img.height ?? '') : 'GEO ' + (o.name || o.type)) + ' :: ' + st.split(' | ').filter((l) => l.includes('/src/')).slice(0, 4).join(' | ').replace(/https?:\/\/localhost:\d+/g, '').replace(/\?[^:]*:/g, ':');
            snap[k] = (snap[k] ?? 0) + 1;
          }
          for (const [kind, m] of Object.entries(window.__glLive)) {
            if (kind === 'buffer') continue;
            for (const v of m.values()) {
              const k = 'GL ' + kind + ' :: ' + v.stack.split(' | ').filter((l) => l.includes('/src/') || l.includes('postprocessing')).slice(0, 3).join(' | ').replace(/https?:\/\/localhost:\d+/g, '').replace(/\?[^:]*:/g, ':');
              snap[k] = (snap[k] ?? 0) + 1;
            }
          }
          (res.snaps ??= []).push(snap);
        }
      }
    }
    // what's still alive that was created after the first world
    const groups = {};
    for (const [kind, m] of Object.entries(window.__glLive)) {
      for (const v of m.values()) {
        if (v.tag !== 1) continue;
        const key = kind + ' :: ' + v.stack.replace(/https?:\/\/localhost:\d+/g, '').replace(/\?[^:]*:/g, ':');
        groups[key] = (groups[key] ?? 0) + 1;
      }
    }
    res.alive = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const tg = {};
    for (const [o, st] of tracked) {
      const inScene = (() => { let f = false; g.scene.traverse((x) => { if (x.geometry === o || (x.material && [].concat(x.material).some((m) => Object.values(m).includes(o) || Object.values(m.uniforms ?? {}).some((u) => u?.value === o)))) f = true; }); return f; })();
      const img = o.image ?? {};
      const key = (o.isTexture ? 'TEX ' + o.constructor.name + ' ' + (o.name || '') + ' ' + (img.width ?? '') + 'x' + (img.height ?? '') : 'GEO ' + (o.name || o.type)) + (inScene ? ' [in scene]' : ' [NOT in scene]') + ' :: ' + st.replace(/https?:\/\/localhost:\d+/g, '').replace(/\?[^:]*:/g, ':');
      tg[key] = (tg[key] ?? 0) + 1;
    }
    res.threeAlive = Object.entries(tg).sort((a, b) => b[1] - a[1]).slice(0, 40);
    if (res.snaps && res.snaps.length >= 2) {
      const [a, b] = res.snaps.slice(-2);
      res.growth = Object.keys(b).map((k) => [k, (b[k] ?? 0) - (a[k] ?? 0)]).filter((x) => x[1] !== 0).sort((x, y) => y[1] - x[1]);
    }
    return res;
  },
  [via, rounds],
);
console.log('base', JSON.stringify(out.base));
for (const s of out.steps) console.log(s.id, s.ms + 'ms', JSON.stringify(s.gl), JSON.stringify(s.three), JSON.stringify(s.times));
console.log('--- created during travel and still alive (by stack):');
for (const [k, n] of out.alive) console.log(String(n).padStart(4), k.slice(0, 600));
console.log('--- three textures/geometries uploaded during travel and not disposed:');
for (const [k, n] of out.threeAlive) console.log(String(n).padStart(4), k.slice(0, 700));
if (out.growth) {
  console.log('--- growth between the last two returns to monza (leaks):');
  for (const [k, n] of out.growth) console.log(String(n).padStart(4), k.slice(0, 500));
}
await browser.close();
