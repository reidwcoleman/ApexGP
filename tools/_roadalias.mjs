// How much the road and the trackside alias (shimmer / sparkle in motion), measured, not eyeballed.
//   node tools/_roadalias.mjs <outdir> [track=monza] [views=chase,cockpit,edge,kerb,tv,glare] (env PORT, WEATHER, TIME, W, H, WXSET)
// The race is frozen (paused) and the camera parked on fixed spots by the road. Each view is rendered
//   A   at the normal 1 px per CSS pixel, four times, the camera turned by a quarter pixel each time;
//   R   at 2× the pixels (renderScale 2, the screenshot is the browser's 2:1 box downsample): the reference.
// Printed per view, over the road band of the frame (luminance, 0..255):
//   alias    mean |A − R|               — what the 1× image gets wrong against a 4-sample-per-pixel image
//   aliasPct the same, % of the band's mean brightness
//   flickA   mean |A(k+1) − A(k)|       — how much a quarter-pixel camera turn changes the 1× image
//   flickR   the same at 2×               (flickA ≫ flickR: the change is aliasing, not real motion)
//   shimmer  flickA / (¼ × mean horizontal gradient of A): ~1 for a properly band-limited image (a quarter-pixel
//            turn moves it a quarter of its gradient), > 1 where detail flips instead of sliding (aliasing).
//            Unlike alias it does not count real, filtered detail against a build, so it is the shimmer number.
//   detail   mean |R − blur(R)|         — the reference's fine detail (a fix must not just blur it away)
//   detailA  the same for A
// SAVEALL=1 keeps every turned 1× frame too. STILL=1 renders the same pose four times: the noise floor of flickA / flickR.
// Compare two builds by running it against both servers; the numbers are steady to ~1 % run to run (the
// shimmer column is the one to read for crawl in motion; alias also grows with real detail the 2× resolves).
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CHROME, ANGLE } from './chrome.mjs';
const [out = 'shots/alias', track = 'monza', viewsArg = 'chase,cockpit,edge,kerb,tv,glare'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 720);
// name: [s, lat, h, lookS, lookLat, lookH, fov, band top (fraction of the frame height)]
const VIEWS = {
  // chase-cam height over the racing line down the straight
  chase: ['start+400', 0.3, 1.15, 'start+425', 0, 0.2, 62, 0.5],
  // the cockpit eye: low, looking far down the road (grazing)
  cockpit: ['start+400', 0.3, 0.82, 'start+470', 0, 0.55, 74, 0.52],
  // along the edge line and the run-off from the edge
  edge: ['start+300', 3.5, 1.3, 'start+318', 7.0, 0, 55, 0.45],
  // the broadcast tower down onto the first chicane (the band starts below the trees: they sway between frames)
  tv: ['start+600', -22, 9, 'start+640', 0, 0, 28, 0.46],
};
// (and some found in the page: 'kerb', the first kerb 450 m on from the start seen from the road beside
// it, 'kerbNear' the same kerb from 2 m, 'line' the edge line from 0.75 m, 'glare' the road into the sun)
const TOP = { kerb: 0.45, kerbNear: 0.3, line: 0.3, glare: 0.42 };
const views = viewsArg.split(',');
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [ANGLE, '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
// (the same sky every run: every session rolls its own clouds, and their shadows cross the road)
await page.addInitScript(() => {
  let a = 0x9e3779b9;
  Math.random = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('403')) console.log('[err]', m.text().slice(0, 300)); });
await page.goto(`http://localhost:${process.env.PORT ?? 5190}/?track=${track}&demo=race&cam=chase&skip=${process.env.SKIP ?? 40}&weather=${process.env.WEATHER ?? 'clear'}&time=${process.env.TIME ?? 'afternoon'}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 400000 });
await page.waitForTimeout(2500);
await page.evaluate(() => {
  document.querySelectorAll('#ui, #menu, .hud, .menu').forEach((e) => (e.style.display = 'none'));
  const g = window.__game;
  g.adaptQuality = () => {};
  g.gfx.setDynamicScale(1);
  g.pause();
  // (no sensor grain: it is new noise every frame and would swamp the comparison)
  g.gfx.grain.blendMode.opacity.value = 0;
  // (nor auto exposure: it drifts between the frames compared — the grade holds its last level)
  g.gfx.grade.setAutoExposure(0);
  // (nor the leaves and litter blowing across the track: they keep moving while the race is paused)
  if (g.debris?.group) g.debris.group.visible = false;
  document.querySelectorAll('#ui, #menu, .hud, .menu').forEach((e) => (e.style.display = 'none'));
});
// (and the same weather: the session's roll still depends on the boot's async order, so pin what shows
// in a frozen frame — a light-cloud sky, no haze, the clouds parked)
await page.evaluate(() => Object.assign(window.__game.race.weatherState, { cloud: 0.15, fog: 0, heat: 0, conv: 0, t: 100, windX: 0, windZ: 0 }));
if (process.env.WXSET) await page.evaluate((o) => Object.assign(window.__game.race.weatherState, o), JSON.parse(process.env.WXSET));
const wait = Number(process.env.WAIT ?? 900);

/** park the camera; `turn` = horizontal turn in pixels of the 1× frame */
async function park(v, turn) {
  await page.evaluate(([v, turn, H]) => {
    const g = window.__game; const st = g.track.startS; const L = g.track.length;
    const S = (x) => { const y = typeof x === 'string' ? st + Number(x.replace('start', '') || 0) : x; return ((y % L) + L) % L; };
    let pos, look;
    if (v === 'glare') {
      const p = g.trackPoint((st + 250) % L, 0, 1.3);
      const sp = g.env.sun.position; const h = Math.hypot(sp.x, sp.z) || 1;
      const ground = g.trackPoint((st + 250) % L, 0, 0)[1];
      pos = p; look = [p[0] + (sp.x / h) * 14, ground, p[2] + (sp.z / h) * 14];
      v = [0, 0, 0, 0, 0, 0, 50];
    } else if (v === 'line') {
      // the edge line from just above it, looking down the straight
      const t = g.track; const n = t.halfWidth.length; const ds = L / n;
      const si = (st + 300) % L; const hw = t.halfWidth[Math.floor(si / ds) % n];
      pos = g.trackPoint(si, hw - 1.1, 0.75);
      look = g.trackPoint((si + 3) % L, hw - 0.1, 0);
      v = [0, 0, 0, 0, 0, 0, 50];
    } else if (v === 'kerb' || v === 'kerbNear') {
      const t = g.track; const n = t.kerbL.length;
      const ds = L / n;
      let i = Math.floor((st + 450) / ds) % n, side = 0;
      for (let k = 0; k < n && !side; k++) {
        i = (i + 1) % n;
        const j = (i + Math.round(15 / ds)) % n;
        side = t.kerbR[i] > 0 && t.kerbR[j] > 0 ? 1 : t.kerbL[i] > 0 && t.kerbL[j] > 0 ? -1 : 0;
      }
      const hw = t.halfWidth[i], si = i * ds;
      const near = v === 'kerbNear';
      pos = g.trackPoint((si - (near ? 2.2 : 7) + L) % L, side * (hw - (near ? 0.7 : 1.6)), near ? 0.8 : 1.2);
      look = g.trackPoint((si + (near ? 1.2 : 5)) % L, side * (hw + (near ? 0.25 : 0.6)), 0);
      v = [0, 0, 0, 0, 0, 0, 55];
    } else {
      pos = g.trackPoint(S(v[0]), v[1], v[2]); look = g.trackPoint(S(v[3]), v[4], v[5]);
    }
    const fov = v[6];
    // a turn of `turn` pixels about the vertical: rotate the look point round the camera
    const a = (turn * (fov * Math.PI / 180)) / H;
    const dx = look[0] - pos[0], dz = look[2] - pos[2];
    const c = Math.cos(a), s = Math.sin(a);
    look = [pos[0] + dx * c - dz * s, look[1], pos[2] + dx * s + dz * c];
    g.freeCam = { pos, look, fov };
  }, [VIEWS[v] ?? v, turn, H]);
  await page.waitForTimeout(wait);
}
const setScale = (k) => page.evaluate((k) => { const g = window.__game; g.gfx.renderScale = k; g.gfx.resize(); }, k);
const shot = async (path) => {
  const buf = await page.screenshot({ path, type: 'png' });
  return buf.toString('base64');
};
// the statistics, in the page (decode the PNGs there: no image library needed here)
async function stats(aList, r, top) {
  return page.evaluate(async ([aList, r, top]) => {
    const lumOf = async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
      const L = new Float32Array(bmp.width * bmp.height);
      for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      return { L, w: bmp.width, h: bmp.height };
    };
    const A = await Promise.all(aList.map(lumOf));
    const R = await lumOf(r);
    const { w, h } = R;
    const y0 = Math.round(h * top) + 2;
    const blur = (L) => {
      const o = new Float32Array(L.length);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        let s = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += L[(y + j) * w + x + i];
        o[y * w + x] = s / 9;
      }
      return o;
    };
    const bR = blur(R.L), bA = blur(A[0].L);
    let n = 0, alias = 0, fA = 0, detR = 0, detA = 0, mean = 0, gx = 0;
    for (let y = y0; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      alias += Math.abs(A[0].L[i] - R.L[i]);
      for (let k = 0; k < A.length - 1; k++) gx += Math.abs(A[k].L[i + 1] - A[k].L[i - 1]) * 0.5 / (A.length - 1);
      detR += Math.abs(R.L[i] - bR[i]);
      detA += Math.abs(A[0].L[i] - bA[i]);
      for (let k = 1; k < A.length; k++) fA += Math.abs(A[k].L[i] - A[k - 1].L[i]) / (A.length - 1);
      mean += R.L[i];
      n++;
    }
    // (each step turns the camera a quarter pixel: an image the filters band-limited properly changes by about
    // a quarter of its horizontal gradient; aliased detail — sparkle, crawl — changes far more than that)
    const step = A.length > 1 ? 0.25 : 0;
    return { alias: alias / n, aliasPct: (100 * alias) / mean, shimmer: step ? fA / (gx * step) : 0, flickA: fA / n, detail: detR / n, detailA: detA / n, mean: mean / n };
  }, [aList, r, top]);
}
async function flickRef(rList, top) {
  return page.evaluate(async ([rList, top]) => {
    const lumOf = async (b64) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
      const L = new Float32Array(bmp.width * bmp.height);
      for (let i = 0; i < L.length; i++) L[i] = 0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2];
      return { L, w: bmp.width, h: bmp.height };
    };
    const R = await Promise.all(rList.map(lumOf));
    const { w, h } = R[0];
    const y0 = Math.round(h * top) + 2;
    let n = 0, f = 0;
    for (let y = y0; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      const i = y * w + x;
      for (let k = 1; k < R.length; k++) f += Math.abs(R[k].L[i] - R[k - 1].L[i]) / (R.length - 1);
      n++;
    }
    return f / n;
  }, [rList, top]);
}

const res = {};
for (const v of views) {
  const top = VIEWS[v]?.[7] ?? TOP[v];
  const turns = process.env.STILL ? [0, 0, 0, 0] : [0, 0.25, 0.5, 0.75];
  await setScale(2);
  const R = [];
  for (const t of turns) {
    await park(v, t);
    R.push(await shot(t === 0 ? `${out}/${track}_${v}_ref.png` : undefined));
  }
  await setScale(1);
  const A = [];
  for (const t of turns) {
    await park(v, t);
    A.push(await shot(t === 0 ? `${out}/${track}_${v}_1x.png` : process.env.SAVEALL ? `${out}/${track}_${v}_1x_${t}.png` : undefined));
  }
  const s = await stats(A, R[0], top);
  s.flickR = await flickRef(R, top);
  for (const k of Object.keys(s)) s[k] = +s[k].toFixed(2);
  res[v] = s;
  console.log(v.padEnd(8), JSON.stringify(s));
}
writeFileSync(`${out}/${track}_alias.json`, JSON.stringify(res, null, 1));
await browser.close();
