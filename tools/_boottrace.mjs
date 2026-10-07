// Where a cold boot blocks the main thread, up to the interactive garage (apex:garage): every WebGL
// call is timed, and the ones that wait on the GPU process (a program's link status read back, a draw
// that has to finish linking its program first, a readPixels…) are listed with the frame they fell in.
// Also the long frames before the garage, programs linked per frame and the boot's own step times.
//   PORT=5410 node tools/_boottrace.mjs [--warm]      (a fresh profile: cold HTTP, IndexedDB and GPU caches;
//   --warm visits once first and traces the second visit in the same profile)
// A program first used with a wait is named (SHADER_NAME, else the first comment of its fragment shader,
// and its length) with how long after its link it was used: "linked 0 ms before" = built on first use.
//   ALL=1    every slow call before the garage         KEYS=1  how such a program's key differs from its siblings'
//   USED=1   programs built by the garage but not drawn in its first seconds (FAMILY=<prefix>|all: their keys)
//   AFTER=1  the long frames and slow calls behind the garage, while the rest of the circuit is built
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHROME, ANGLE } from './chrome.mjs';
const port = process.env.PORT ?? 5410;
const warm = process.argv.includes('--warm');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apexboot-'));
const ctx = await chromium.launchPersistentContext(dir, {
  executablePath: CHROME,
  headless: true,
  viewport: { width: 1280, height: 720 },
  args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'],
});
const init = () => {
  window.__gl = { calls: {}, slow: [], links: [], frames: [] };
  let frame = 0;
  const G = window.__gl;
  const P = WebGL2RenderingContext.prototype;
  // each program's name (SHADER_NAME, else the first comment / custom uniform of its fragment shader)
  // and link time: a slow first use of a program says which one, and how long after its link
  const src = new WeakMap();
  const prog = new WeakMap();
  const ss = P.shaderSource;
  P.shaderSource = function (sh, s) {
    src.set(sh, s);
    return ss.call(this, sh, s);
  };
  const att = P.attachShader;
  P.attachShader = function (pr, sh) {
    const s = src.get(sh) ?? '';
    if (/gl_FragColor|pc_fragColor|out highp vec4|layout/.test(s) && s.includes('void main')) {
      const name = (s.match(/#define SHADER_NAME (.*)/) ?? [])[1];
      const body = s.slice(s.indexOf('void main'));
      const tag = (body.match(/\/\/ ?([^\n]{8,60})/) ?? [])[1] ?? (s.match(/uniform \w+ (u[A-Z]\w+|c[A-Z]\w+)/) ?? [])[1] ?? '';
      prog.set(pr, { name: (name ?? '') + ' ' + tag.trim() + ' #' + s.length, t: 0 });
    }
    return att.call(this, pr, sh);
  };
  window.__progName = (pr) => prog.get(pr);
  for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k);
    if (!d || typeof d.value !== 'function' || k === 'shaderSource' || k === 'attachShader') continue;
    const f = d.value;
    P[k] = function (...a) {
      const t = performance.now();
      const r = f.apply(this, a);
      const dt = performance.now() - t;
      const c = (G.calls[k] ??= [0, 0]);
      c[0]++;
      c[1] += dt;
      if (k === 'useProgram' && a[0]) (G.used ??= new Set()).add(a[0]);
      if (k === 'linkProgram') {
        G.links.push([frame, Math.round(t)]);
        const e = prog.get(a[0]);
        if (e) e.t = t;
      }
      if (dt > 8) {
        const e = k === 'getProgramParameter' || k === 'useProgram' ? prog.get(a[0]) : null;
        // (an upload: what of — a canvas, an image, raw pixels — and how big)
        const src = k.startsWith('tex') ? a.find((x) => x && typeof x === 'object' && 'width' in x) : null;
        const up = k.startsWith('tex') ? (src ? `${src.constructor.name} ${src.width}×${src.height}` : `${a[4]}×${a[5]} ${a[a.length - 1]?.constructor?.name ?? ''}`) : '';
        G.slow.push([frame, Math.round(t), k, Math.round(dt), e ? `${e.name} (linked ${Math.round(t - e.t)} ms before)` : up]);
        if (e) (G.slowProgs ??= []).push([a[0], Math.round(t)]);
      }
      return r;
    };
  }
  let last = performance.now();
  const tick = (t) => {
    G.frames.push([frame, Math.round(t), Math.round(t - last), window.__game ? +window.__game.worldProgress.toFixed(2) : -1]);
    frame++;
    last = t;
    if (!performance.getEntriesByName('apex:world').length) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__lt = [];
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: 'longtask', buffered: true });
  } catch {}
};
await ctx.addInitScript(init);
const url = `http://localhost:${port}/?track=${process.env.TRACK ?? 'monza'}&settle=0${process.env.FAMILY ? '&family=' + process.env.FAMILY : ''}`;
if (warm) {
  const p0 = await ctx.newPage();
  await p0.goto(url);
  await p0.waitForFunction(() => performance.getEntriesByName('apex:world').length > 0, null, { timeout: 600000, polling: 250 });
  await p0.waitForTimeout(12000);
  await p0.close();
}
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => m.type() === 'error' && console.log('[console.error]', m.text().slice(0, 300)));
await p.goto(url);
await p.waitForFunction(() => performance.getEntriesByName('apex:garage').length > 0, null, { timeout: 600000, polling: 50 });
const r = await p.evaluate(() => {
  const m = (k) => Math.round(performance.getEntriesByName(k)[0]?.startTime ?? -1);
  const G = window.__gl;
  const garage = m('apex:garage');
  return {
    marks: { fcp: Math.round(performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? -1), main: m('apex:main'), paint: m('apex:paint'), garage },
    steps: window.__game.bootSteps,
    times: window.__game.worldTimes,
    programs: window.__game.gfx.renderer.info.programs.length,
    links: G.links.filter((l) => l[1] <= garage).length,
    longFrames: G.frames.filter((f) => f[1] <= garage + 50 && f[2] > 100),
    longTasks: window.__lt.filter(([s]) => s <= garage),
    slow: G.slow.filter((s) => s[1] <= garage),
    top: Object.entries(G.calls).sort((a, b) => b[1][1] - a[1][1]).slice(0, 12).map(([k, [n, t]]) => `${k} ${n}× ${Math.round(t)} ms`),
  };
});
console.log(JSON.stringify(r.marks), 'programs', r.programs, 'links≤garage', r.links);
console.log('steps', JSON.stringify(r.steps));
console.log('times', JSON.stringify(r.times));
console.log('long frames (frame, t, dt)', JSON.stringify(r.longFrames));
console.log('long tasks ≤ garage', JSON.stringify(r.longTasks), 'sum', r.longTasks.reduce((a, [, d]) => a + d, 0));
console.log('GL time by call ≤ garage+', r.top.join(' | '));
const byK = {};
for (const [, , k, dt] of r.slow) (byK[k] ??= [0, 0]), byK[k][0]++, (byK[k][1] += dt);
console.log('slow GL calls (>8 ms) ≤ garage:', JSON.stringify(byK));
if (process.env.ALL) for (const s of r.slow) console.log('   ', JSON.stringify(s));
// KEYS=1: for each program first used with a wait, three's program key against the other programs of
// the same material (a key that differs from one compiled ahead = a variant the warm-up missed)
if (process.env.KEYS) {
  const k = await p.evaluate(() => {
    const progs = window.__game.gfx.renderer.info.programs;
    const garage = performance.getEntriesByName('apex:garage')[0].startTime;
    const out = [];
    for (const [gp, t] of window.__gl.slowProgs ?? []) {
      if (t > garage) continue;
      const pr = progs.find((q) => q.program === gp);
      if (!pr) continue;
      const parts = pr.cacheKey.split(',');
      const sib = progs.filter((q) => q !== pr && q.name === pr.name && q.cacheKey.split(',')[0] === parts[0]);
      const diffs = sib.map((q) => {
        const b = q.cacheKey.split(',');
        const d = [];
        for (let i = 0; i < Math.max(parts.length, b.length); i++) if (parts[i] !== b[i]) d.push(`${i}:${String(parts[i]).slice(0, 30)}≠${String(b[i]).slice(0, 30)}`);
        return d.slice(0, 8).join(' ');
      });
      out.push(`${t} ${pr.name} id${pr.id} siblings ${sib.length}: ${diffs.join(' || ')}`);
    }
    return out;
  });
  console.log(k.join('\n'));
}
// USED=1: the programs built by the garage that its first ~2 s of frames never drew with (compiled on
// the critical path for nothing — or for later)
if (process.env.USED) {
  const u = await p.evaluate(async () => {
    const R = window.__game.gfx.renderer;
    const atGarage = R.info.programs.slice();
    await new Promise((r) => setTimeout(r, 2500));
    const used = window.__gl.used;
    const unused = atGarage.filter((q) => !used.has(q.program));
    // (FAMILY=<name prefix>: every program of those materials, its key's tail, drawn or not)
    const fam = new URLSearchParams(location.search).get('family');
    const g = performance.getEntriesByName('apex:garage')[0].startTime;
    return {
      // (built after the garage was up and drawn with in its first seconds; and the waits on programs then)
      later: R.info.programs.filter((q) => !atGarage.includes(q) && used.has(q.program)).map((q) => `${q.id} ${q.name} ${window.__progName(q.program)?.name ?? ''} …${q.cacheKey.slice(-110)}`),
      slowLater: window.__gl.slow.filter((s) => s[1] > g && s[1] < g + 2500).map((s) => JSON.stringify(s)),
      total: atGarage.length,
      unused: unused.map((q) => `${q.id} ${q.name} ${window.__progName(q.program)?.name ?? ''}`),
      fam: fam ? atGarage.filter((q) => fam === 'all' || q.name.startsWith(fam)).map((q) => `${q.id} ${q.name} used=${used.has(q.program)} ${window.__progName(q.program)?.name ?? ''} …${q.cacheKey.slice(-110)}`) : [],
    };
  });
  console.log(`programs at the garage ${u.total}, never drawn with in its first frames ${u.unused.length}:`);
  for (const s of u.unused) console.log('   ', s);
  for (const s of u.fam) console.log('  F', s);
  console.log(`built after the garage and drawn in its first 2.5 s: ${u.later.length}`);
  for (const s of u.later) console.log('  L', s);
  for (const s of u.slowLater) console.log('  S', s);
}
// keep going to the complete circuit: the long frames behind the garage
await p.waitForFunction(() => performance.getEntriesByName('apex:world').length > 0, null, { timeout: 600000, polling: 250 });
const w = await p.evaluate(() => {
  const g = performance.getEntriesByName('apex:garage')[0].startTime;
  const wd = performance.getEntriesByName('apex:world')[0].startTime;
  const G = window.__gl;
  const lt = window.__lt.filter(([s]) => s > g);
  return { world: Math.round(wd), ltMax: lt.reduce((a, [, d]) => Math.max(a, d), 0), ltSum: lt.reduce((a, [, d]) => a + d, 0), slowAfter: G.slow.filter((s) => s[1] > g).length, slowAfterMs: G.slow.filter((s) => s[1] > g).reduce((a, s) => a + s[3], 0), programs: window.__game.gfx.renderer.info.programs.length };
});
console.log('after garage', JSON.stringify(w));
// AFTER=1: behind the garage — the long frames (with the world build's progress) and the slow GL calls
if (process.env.AFTER) {
  const a = await p.evaluate(() => {
    const g = performance.getEntriesByName('apex:garage')[0].startTime;
    const G = window.__gl;
    return { frames: G.frames.filter((f) => f[1] > g && f[2] > 250), slow: G.slow.filter((s) => s[1] > g && s[3] > 40), lt: window.__lt.filter(([s]) => s > g && s > 0) };
  });
  console.log('long frames behind the garage', JSON.stringify(a.frames));
  console.log('long tasks behind the garage', JSON.stringify(a.lt));
  for (const s of a.slow) console.log('  A', JSON.stringify(s));
}
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
