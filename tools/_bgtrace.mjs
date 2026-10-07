// The circuit growing behind the garage, frame by frame (cold profile): every long frame after the
// garage is up, with the WebGL calls that took its time (uploads, links, sync reads) and the world
// progress it ran at. PORT=5411 [TRACK=monza] [MIN=80] node tools/_bgtrace.mjs
import { chromium } from 'playwright-core';
import { CHROME, ANGLE } from './chrome.mjs';
const port = process.env.PORT ?? 5218;
const MIN = Number(process.env.MIN ?? 80);
const b = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => (m.type() === 'error' || m.text().includes('[world]') || m.text().includes('[prep')) && console.log('[console]', m.text().slice(0, 300)));
await p.addInitScript(() => {
  window.__frames = [];
  window.__lt = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
  } catch {}
  let cur = {};
  const P = WebGL2RenderingContext.prototype;
  for (const k of ['texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'generateMipmap', 'bufferData', 'bufferSubData', 'linkProgram', 'compileShader', 'getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'readPixels', 'getError', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'clientWaitSync', 'getParameter', 'getUniformLocation', 'getActiveUniform', 'getActiveAttrib', 'compressedTexImage2D', 'copyTexSubImage2D', 'blitFramebuffer', 'clear', 'getExtension', 'getSupportedExtensions']) {
    const f = P[k];
    if (!f) continue;
    P[k] = function (...a) {
      const t = performance.now();
      const r = f.apply(this, a);
      const d = performance.now() - t;
      const kk = k === 'getProgramParameter' ? k + (a[1] === 0x91b1 ? ':status' : a[1] === 0x8b86 ? ':uniforms' : a[1] === 0x8b89 ? ':attribs' : ':' + a[1]) : k;
      const e = (cur[kk] ??= [0, 0]);
      e[0] += d;
      e[1]++;
      if ((k === 'texImage2D' || k === 'texSubImage2D') && d > 20) {
        const src = a[a.length - 1];
        const w = src?.width ?? a[3], h = src?.height ?? a[4];
        (cur.big ??= []).push(`${k} ${w}x${h} ${src?.constructor?.name ?? ''} ${Math.round(d)}ms`);
      }
      return r;
    };
  }
  let last = performance.now();
  const f = (t) => {
    const g = window.__game;
    window.__frames.push([Math.round(t), Math.round(t - last), g ? +g.worldProgress.toFixed(3) : -1, g?.gfx?.renderer?.info?.programs?.length ?? 0, cur]);
    cur = {};
    last = t;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
const T0 = Date.now();
await p.goto(`http://localhost:${port}/?track=${process.env.TRACK ?? 'monza'}&settle=0${process.env.Q ?? ''}`);
await p.waitForFunction(() => performance.getEntriesByName('apex:world').length > 0, null, { timeout: 600000, polling: 250 });
await p.waitForTimeout(500);
const r = await p.evaluate(() => ({
  frames: window.__frames,
  garage: performance.getEntriesByName('apex:garage')[0]?.startTime,
  world: performance.getEntriesByName('apex:world')[0]?.startTime,
  wt: window.__game.worldTimes,
  warm: window.__game.warmTimes,
  lt: window.__lt,
  sc: JSON.stringify({ t: window.__game.env.stats.scenery?.timings, map: window.__game.env.stats.scenery?.map, adopt: window.__game.env.stats.timings?.adopt, steps: window.__game.env.stats.adoptSteps }),
}));
console.log(`garage ${Math.round(r.garage)} world ${Math.round(r.world)} (behind the garage ${Math.round(r.world - r.garage)} ms)`);
let n = 0, sum = 0, max = 0, prevProg = 0;
for (const [t, dt, wp, progs, gl] of r.frames) {
  const after = t > r.garage && t <= r.world + 50;
  if (after && dt > 50) { n++; sum += dt; max = Math.max(max, dt); }
  if (after && dt >= MIN) {
    const top = Object.entries(gl).filter(([k]) => k !== 'big').sort((a, b) => b[1][0] - a[1][0]).slice(0, 5).map(([k, [ms, c]]) => `${k} ${Math.round(ms)}ms/${c}`).join(', ');
    console.log(`t=${t} dt=${dt} world=${wp} programs=${progs} (+${progs - prevProg}) | ${top}${gl.big ? '\n      ' + gl.big.slice(0, 6).join('\n      ') : ''}`);
  }
  prevProg = progs;
}
console.log(`frames >50ms behind the garage: ${n}, sum ${sum} ms, max ${max} ms`);
const lt = r.lt.filter(([s]) => s > r.garage && s <= r.world);
const lts = lt.map(([, d]) => d).sort((a, b) => b - a);
// (each long one with the world progress of the frame it ended in)
for (const [s, d] of lt) if (d > 200) console.log(`  long task t=${s} ${d} ms world=${(r.frames.find(([t]) => t >= s + d) ?? [])[2]}`);
console.log(`long tasks behind the garage: ${lt.length}, >100ms ${lts.filter((d) => d > 100).length}, >250ms ${lts.filter((d) => d > 250).length}, sum ${lts.reduce((a, d) => a + d, 0)} ms, worst ${lts.slice(0, 8).join(' ')}`);
console.log(JSON.stringify(r.wt));
console.log('warmTimes', JSON.stringify(r.warm), 'wall', Date.now() - T0);
console.log('scenery', r.sc);
await b.close();
