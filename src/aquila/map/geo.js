// Builds the campaign world from Natural Earth coastlines: land mask, provinces
// (grown over land from each city), adjacency, heights and the painted terrain.
import { feature } from 'topojson-client';
import landTopo from 'world-atlas/land-50m.json';
import { CITIES, RIVERS, SEA_LANES } from '../data/cities.js';
import { noise2, fbm, ridged, smooth, clamp, lerp } from '../util/noise.js';

export const LON0 = -12, LON1 = 76, LAT0 = 13, LAT1 = 62;
export const KX = Math.cos((38 * Math.PI) / 180);
export const WORLD_W = (LON1 - LON0) * KX;
export const WORLD_H = LAT1 - LAT0;
export const GW = 1800;
export const GH = Math.round((GW * WORLD_H) / WORLD_W);
export const PX_PER_DEG = GH / WORLD_H; // grid pixels per degree of latitude
export const HW = 960;
export const HH = Math.round((HW * GH) / GW);

export function toWorld(lon, lat) {
  return { x: (lon - LON0) * KX - WORLD_W / 2, z: -(lat - LAT0 - WORLD_H / 2) };
}
export function worldToLonLat(x, z) {
  return { lon: (x + WORLD_W / 2) / KX + LON0, lat: -z + WORLD_H / 2 + LAT0 };
}
export function lonLatToGrid(lon, lat) {
  return { gx: ((lon - LON0) / (LON1 - LON0)) * GW, gy: ((LAT1 - lat) / (LAT1 - LAT0)) * GH };
}
export function gridToLonLat(gx, gy) {
  return { lon: LON0 + (gx / GW) * (LON1 - LON0), lat: LAT1 - (gy / GH) * (LAT1 - LAT0) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

function rasterLand() {
  const cv = document.createElement('canvas');
  cv.width = GW; cv.height = GH;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, GW, GH);
  ctx.fillStyle = '#fff';
  const land = feature(landTopo, landTopo.objects.land);
  const geoms = land.type === 'FeatureCollection' ? land.features.map((f) => f.geometry) : [land.geometry];
  const sx = GW / (LON1 - LON0), sy = GH / (LAT1 - LAT0);
  for (const g of geoms) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      let minL = 999, maxL = -999, minB = 999, maxB = -999;
      for (const [lo, la] of poly[0]) { if (lo < minL) minL = lo; if (lo > maxL) maxL = lo; if (la < minB) minB = la; if (la > maxB) maxB = la; }
      if (maxL < LON0 - 5 || minL > LON1 + 5 || maxB < LAT0 - 5 || minB > LAT1 + 5) continue;
      const shift = minL < -150 && maxL > 100; // Eurasia wraps the antimeridian
      ctx.beginPath();
      for (const ring of poly) {
        ring.forEach(([lo, la], i) => {
          if (shift && lo < -150) lo += 360;
          const x = (lo - LON0) * sx, y = (LAT1 - la) * sy;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }
  const img = ctx.getImageData(0, 0, GW, GH).data;
  const mask = new Uint8Array(GW * GH);
  for (let i = 0; i < mask.length; i++) mask[i] = img[i * 4] > 127 ? 1 : 0;
  return mask;
}

// Chamfer distance (3-4) to the nearest cell where `target` differs from `inside`
function chamfer(mask, inside) {
  const N = GW * GH, INF = 1e9;
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = mask[i] === inside ? INF : 0;
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x; let v = d[i]; if (v === 0) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + 3);
    if (y > 0) { v = Math.min(v, d[i - GW] + 3); if (x > 0) v = Math.min(v, d[i - GW - 1] + 4); if (x < GW - 1) v = Math.min(v, d[i - GW + 1] + 4); }
    d[i] = v;
  }
  for (let y = GH - 1; y >= 0; y--) for (let x = GW - 1; x >= 0; x--) {
    const i = y * GW + x; let v = d[i]; if (v === 0) continue;
    if (x < GW - 1) v = Math.min(v, d[i + 1] + 3);
    if (y < GH - 1) { v = Math.min(v, d[i + GW] + 3); if (x < GW - 1) v = Math.min(v, d[i + GW + 1] + 4); if (x > 0) v = Math.min(v, d[i + GW - 1] + 4); }
    d[i] = v;
  }
  for (let i = 0; i < N; i++) d[i] = Math.min(d[i], 3e5) / 3;
  return d;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1e-9;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px, ey = ay + dy * t - py;
  return Math.sqrt(ex * ex + ey * ey);
}

function sampleGrid(arr, gx, gy) {
  gx = clamp(gx - 0.5, 0, GW - 1.001); gy = clamp(gy - 0.5, 0, GH - 1.001);
  const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0, i = y0 * GW + x0;
  return (arr[i] * (1 - fx) + arr[i + 1] * fx) * (1 - fy) + (arr[i + GW] * (1 - fx) + arr[i + GW + 1] * fx) * fy;
}

export function sampleHeight(heights, lon, lat) {
  let hx = ((lon - LON0) / (LON1 - LON0)) * (HW - 1), hy = ((LAT1 - lat) / (LAT1 - LAT0)) * (HH - 1);
  hx = clamp(hx, 0, HW - 1.001); hy = clamp(hy, 0, HH - 1.001);
  const x0 = hx | 0, y0 = hy | 0, fx = hx - x0, fy = hy - y0, i = y0 * HW + x0;
  return (heights[i] * (1 - fx) + heights[i + 1] * fx) * (1 - fy) + (heights[i + HW] * (1 - fx) + heights[i + HW + 1] * fx) * fy;
}

// Aridity / biome fields, all smooth so the painted map blends naturally
const RIVER_SEGS = [];
for (const r of RIVERS) for (let i = 0; i < r.length - 1; i++) RIVER_SEGS.push([r[i][0] * KX, r[i][1], r[i + 1][0] * KX, r[i + 1][1]]);
export function riverDist(lon, lat) {
  let m = 9;
  const px = lon * KX;
  for (const s of RIVER_SEGS) {
    if (px < Math.min(s[0], s[2]) - 0.6 || px > Math.max(s[0], s[2]) + 0.6 || lat < Math.min(s[1], s[3]) - 0.6 || lat > Math.max(s[1], s[3]) + 0.6) continue;
    const d = segDist(px, lat, s[0], s[1], s[2], s[3]);
    if (d < m) m = d;
  }
  return m;
}

export function climate(lon, lat, coast, rdist) {
  // desert belt: Sahara + Arabia
  let arid = smooth(33.0, 29.0, lat) * smooth(-14, -9, lon) * smooth(62, 56, lon);
  arid *= 1 - 0.55 * smooth(0.9, 0.15, coast) * smooth(29.5, 31.5, lat);
  // Levant, Mesopotamia, Persia, Central Asia
  arid = Math.max(arid, 0.8 * smooth(36.2, 33.5, lat) * smooth(36.6, 38.5, lon) * smooth(66, 62, lon));
  arid = Math.max(arid, 0.75 * smooth(36.4, 34.0, lat) * smooth(50, 53, lon) * smooth(64, 61, lon));
  arid = Math.max(arid, 0.85 * smooth(37.3, 39, lat) * smooth(46.5, 44, lat) * smooth(52, 55, lon) * smooth(68, 65, lon));
  arid = Math.max(arid, 0.55 * smooth(31.5, 28, lat) * smooth(60, 64, lon) * smooth(72, 69, lon));
  // a dry interior in Iberia, Anatolia and the Levant coast
  arid = Math.max(arid, 0.28 * smooth(41.5, 39.5, lat) * smooth(-7, -5, lon) * smooth(0, -2, lon));
  arid = Math.max(arid, 0.3 * smooth(40.5, 39.0, lat) * smooth(31, 33, lon) * smooth(37, 35, lon));
  // rivers green the desert (Nile, Euphrates, Tigris, Oxus, Indus)
  arid *= 1 - 0.92 * smooth(0.32, 0.08, rdist);
  // steppe belt north of the Black Sea and Caspian
  const steppe = smooth(43.5, 45.5, lat) * smooth(52.5, 50.5, lat) * smooth(27, 31, lon) * smooth(66, 60, lon) + 0.6 * smooth(44, 46, lat) * smooth(53, 49, lat) * smooth(18, 20, lon) * smooth(23, 21, lon);
  const med = smooth(45.0, 42.5, lat) * smooth(31, 35, lat);
  const north = smooth(55.5, 59.5, lat);
  return { arid: clamp(arid, 0, 1), steppe: clamp(steppe, 0, 1), med, north };
}

function hex(c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }
const C = {
  sand: hex('#d6b277'), sand2: hex('#c79a5c'), dune: hex('#e0be82'), rockDesert: hex('#a98a64'),
  steppe: hex('#a59c66'), steppe2: hex('#b3a673'), med: hex('#878a55'), med2: hex('#9b9466'),
  temperate: hex('#64803f'), temperate2: hex('#738a4a'), forest: hex('#3c5a2c'), boreal: hex('#3d5238'),
  rock: hex('#8a7e6e'), rock2: hex('#6e665c'), snow: hex('#eef1f4'), beach: hex('#dccb9b'),
  shallow: hex('#b9a77c'), deep: hex('#3b4f57'), river: hex('#3c7391'),
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// real elevation in metres, bilinear; grid 881 x 491 at 0.1°, row 0 = 62°N, col 0 = 12°W
async function loadElevation() {
  const buf = await (await fetch(new URL('../data/elevation.bin', import.meta.url))).arrayBuffer();
  const E = new Int16Array(buf), W = 881, H = 491;
  return (lon, lat) => {
    const fx = clamp((lon + 12) * 10, 0, W - 1.001), fy = clamp((62 - lat) * 10, 0, H - 1.001);
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, k = y0 * W + x0;
    return (E[k] * (1 - tx) + E[k + 1] * tx) * (1 - ty) + (E[k + W] * (1 - tx) + E[k + W + 1] * tx) * ty;
  };
}

export async function buildWorld(progress = () => {}) {
  progress(0.02, 'Charting the coasts');
  await tick();
  const land = rasterLand();
  progress(0.1, 'Measuring the seas');
  await tick();
  const dLand = chamfer(land, 1); // px to water, on land
  const dSea = chamfer(land, 0); // px to land, at sea
  const sdist = new Float32Array(GW * GH);
  for (let i = 0; i < sdist.length; i++) sdist[i] = land[i] ? dLand[i] : -dSea[i];

  progress(0.2, 'Raising the mountains');
  await tick();
  // ---- heights on the mesh grid: real ETOPO1 elevation (0.1°, NOAA), exaggerated for the map ----
  const heights = new Float32Array(HW * HH);
  const elev = await loadElevation();
  for (let j = 0; j < HH; j++) {
    const lat = LAT1 - (j / (HH - 1)) * (LAT1 - LAT0);
    const gy = (j / (HH - 1)) * GH;
    for (let i = 0; i < HW; i++) {
      const lon = LON0 + (i / (HW - 1)) * (LON1 - LON0);
      const gx = (i / (HW - 1)) * GW;
      const d = sampleGrid(sdist, gx, gy) / PX_PER_DEG; // degrees, + on land
      const m = elev(lon, lat);
      let e;
      if (d > 0) {
        const ee = Math.pow(Math.max(0, m) / 4500, 0.7) * 0.6;
        const crag = ee > 0.05 ? ee * 0.22 * (ridged(lon * 3.1, lat * 3.1, 4, 11) - 0.45) : 0;
        const hills = (fbm(lon * 1.6, lat * 1.6, 3, 3) * 0.5 + 0.5) * 0.012;
        e = Math.min(d * 0.12, 0.012) + 0.006 + ee + crag + hills * smooth(0, 0.3, d);
      } else {
        const depth = Math.max(0, -m);
        e = Math.max(d * 0.25, -0.02 - 0.25 * smooth(20, 3000, depth)) + fbm(lon * 0.6, lat * 0.6, 3, 5) * 0.006;
      }
      heights[idx(i, j)] = e;
    }
  }
  function idx(i, j) { return j * HW + i; }

  progress(0.38, 'Founding the provinces');
  await tick();
  // ---- provinces: Dial's shortest-path flood over land from every city ----
  const N = GW * GH;
  const cost = new Uint8Array(N);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x;
    if (!land[i]) continue;
    const { lon, lat } = gridToLonLat(x + 0.5, y + 0.5);
    const h = sampleHeight(heights, lon, lat);
    const n = noise2(x * 0.035, y * 0.035, 21) * 0.6 + noise2(x * 0.11, y * 0.11, 22) * 0.4;
    cost[i] = clamp(Math.round(4 + n * 4 + Math.max(0, h - 0.08) * 60), 0, 40);
  }
  const provinces = CITIES.map(([name, lon, lat, owner, pop, culture, region], id) => ({ id, name, lon, lat, owner, pop: pop * 1000, culture, region }));
  const dist = new Int32Array(N).fill(0x7fffffff);
  const own = new Int16Array(N).fill(-1);
  const B = 128;
  const buckets = Array.from({ length: B }, () => []);
  const maxD = new Int32Array(provinces.length);
  for (const p of provinces) {
    let { gx, gy } = lonLatToGrid(p.lon, p.lat);
    gx = Math.round(gx); gy = Math.round(gy);
    let best = -1, bd = 1e9;
    for (let r = 0; r <= 20 && best < 0; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = gx + dx, y = gy + dy; if (x < 0 || y < 0 || x >= GW || y >= GH) continue;
      const i = y * GW + x; if (!land[i]) continue;
      const dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = i; }
    }
    if (best < 0) best = gy * GW + gx;
    p.gx = best % GW; p.gy = (best / GW) | 0;
    const ll = gridToLonLat(p.gx + 0.5, p.gy + 0.5);
    p.lon = ll.lon; p.lat = ll.lat;
    dist[best] = 0; own[best] = p.id; buckets[0].push(best);
    maxD[p.id] = Math.round(4.6 * PX_PER_DEG * 9.5);
  }
  let pending = provinces.length, cur = 0;
  const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1], DC = [10, 10, 10, 10, 14, 14, 14, 14];
  while (pending > 0) {
    const b = buckets[cur % B];
    while (b.length) {
      const i = b.pop(); pending--;
      if (dist[i] !== cur) continue;
      const o = own[i], x = i % GW, y = (i / GW) | 0;
      for (let k = 0; k < 8; k++) {
        const nx = x + DX[k], ny = y + DY[k];
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const j = ny * GW + nx;
        if (!land[j]) continue;
        const nd = cur + DC[k] * 0.5 + cost[j];
        if (nd < dist[j] && nd <= maxD[o]) { dist[j] = nd; own[j] = o; buckets[nd % B].push(j); pending++; }
      }
    }
    cur++;
    if (cur > 5e6) break;
  }

  progress(0.5, 'Surveying the borders');
  await tick();
  // ---- stats + adjacency ----
  const P = provinces.length;
  const cnt = new Float64Array(P), sx = new Float64Array(P), sy = new Float64Array(P);
  const coastal = new Uint8Array(P);
  const pair = new Map();
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const i = y * GW + x, a = own[i];
    if (a < 0) continue;
    cnt[a]++; sx[a] += x; sy[a] += y;
    if (x < GW - 1) { const b = own[i + 1]; if (b >= 0 && b !== a) { const k = Math.min(a, b) * 4096 + Math.max(a, b); pair.set(k, (pair.get(k) || 0) + 1); } else if (!land[i + 1]) coastal[a] = 1; }
    if (y < GH - 1) { const b = own[i + GW]; if (b >= 0 && b !== a) { const k = Math.min(a, b) * 4096 + Math.max(a, b); pair.set(k, (pair.get(k) || 0) + 1); } else if (!land[i + GW]) coastal[a] = 1; }
    if (x > 0 && !land[i - 1]) coastal[a] = 1;
    if (y > 0 && !land[i - GW]) coastal[a] = 1;
  }
  for (const p of provinces) {
    p.neighbors = []; p.sea = [];
    p.area = cnt[p.id];
    p.coastal = !!coastal[p.id];
    const c = gridToLonLat(sx[p.id] / Math.max(1, cnt[p.id]) + 0.5, sy[p.id] / Math.max(1, cnt[p.id]) + 0.5);
    p.clon = c.lon; p.clat = c.lat;
  }
  for (const [k, n] of pair) {
    if (n < 4) continue;
    const a = Math.floor(k / 4096), b = k % 4096;
    provinces[a].neighbors.push(b); provinces[b].neighbors.push(a);
  }
  // straits: rays from coastal cells across short stretches of sea
  const R = Math.round(0.95 * PX_PER_DEG);
  const seaPair = new Set();
  const DIRS = Array.from({ length: 16 }, (_, k) => [Math.cos((k / 16) * Math.PI * 2), Math.sin((k / 16) * Math.PI * 2)]);
  for (let y = 1; y < GH - 1; y += 2) for (let x = 1; x < GW - 1; x += 2) {
    const i = y * GW + x, a = own[i];
    if (a < 0) continue;
    if (land[i + 1] && land[i - 1] && land[i + GW] && land[i - GW]) continue;
    for (const [dx, dy] of DIRS) {
      let wet = false;
      for (let s = 1; s <= R; s++) {
        const nx = Math.round(x + dx * s), ny = Math.round(y + dy * s);
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) break;
        const j = ny * GW + nx;
        if (!land[j]) { wet = true; continue; }
        if (!wet) break;
        const b = own[j];
        if (b >= 0 && b !== a) seaPair.add(Math.min(a, b) * 4096 + Math.max(a, b));
        break;
      }
    }
  }
  const byName = new Map(provinces.map((p) => [p.name, p]));
  for (const [an, bn] of SEA_LANES) {
    const a = byName.get(an), b = byName.get(bn);
    if (a && b) seaPair.add(Math.min(a.id, b.id) * 4096 + Math.max(a.id, b.id));
  }
  for (const k of seaPair) {
    const a = Math.floor(k / 4096), b = k % 4096;
    if (provinces[a].neighbors.includes(b)) continue;
    provinces[a].sea.push(b); provinces[b].sea.push(a);
  }

  // ---- smooth borders: distance (px) to the nearest other province, and who is across ----
  const bdist = new Float32Array(N).fill(99);
  const other = new Uint8Array(N); // id+1 of the province across the border, 0 = wilderness
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) {
    const i = y * GW + x;
    if (!land[i]) continue;
    const a = own[i];
    for (const j of [i - 1, i + 1, i - GW, i + GW]) {
      if (!land[j] || own[j] === a) continue;
      bdist[i] = 0.5; other[i] = own[j] + 1; break;
    }
  }
  const relax = (i, n, w) => { if (land[n] && own[n] === own[i] && bdist[n] + w < bdist[i]) { bdist[i] = bdist[n] + w; other[i] = other[n]; } };
  for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) { const i = y * GW + x; if (!land[i]) continue; relax(i, i - 1, 1); relax(i, i - GW, 1); relax(i, i - GW - 1, 1.414); relax(i, i - GW + 1, 1.414); }
  for (let y = GH - 2; y > 0; y--) for (let x = GW - 2; x > 0; x--) { const i = y * GW + x; if (!land[i]) continue; relax(i, i + 1, 1); relax(i, i + GW, 1); relax(i, i + GW + 1, 1.414); relax(i, i + GW - 1, 1.414); }

  progress(0.6, 'Painting the lands');
  await tick();
  // ---- painted terrain colour ----
  const cv = document.createElement('canvas');
  cv.width = GW; cv.height = GH;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(GW, GH);
  const px = img.data;
  const forest = new Uint8Array(N);
  const RDIST_STEP = 6; // river distance on a coarse grid, then sampled
  const rw = Math.ceil(GW / RDIST_STEP) + 1, rh = Math.ceil(GH / RDIST_STEP) + 1;
  const rd = new Float32Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const { lon, lat } = gridToLonLat(x * RDIST_STEP, y * RDIST_STEP);
    rd[y * rw + x] = riverDist(lon, lat);
  }
  const sampleRd = (gx, gy) => {
    const fx = gx / RDIST_STEP, fy = gy / RDIST_STEP, x0 = Math.min(rw - 2, fx | 0), y0 = Math.min(rh - 2, fy | 0), tx = fx - x0, ty = fy - y0, i = y0 * rw + x0;
    return (rd[i] * (1 - tx) + rd[i + 1] * tx) * (1 - ty) + (rd[i + rw] * (1 - tx) + rd[i + rw + 1] * tx) * ty;
  };
  for (let y = 0; y < GH; y++) {
    if (y % 200 === 0) { progress(0.6 + (y / GH) * 0.3, 'Painting the lands'); await tick(); }
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const { lon, lat } = gridToLonLat(x + 0.5, y + 0.5);
      const h = sampleHeight(heights, lon, lat);
      const n1 = noise2(x * 0.02, y * 0.02, 41), n2 = noise2(x * 0.09, y * 0.09, 42), n3 = noise2(x * 0.35, y * 0.35, 43);
      let c;
      if (land[i]) {
        const coast = sdist[i] / PX_PER_DEG;
        const rdist = sampleRd(Math.max(0, x + n2 * 5 + n3 * 1.5), Math.max(0, y + n1 * 5 - n3 * 1.5));
        const k = climate(lon + n1 * 0.6, lat + n2 * 0.4, coast, rdist);
        let green = mix3(C.temperate, C.temperate2, smooth(-0.4, 0.6, n1));
        const fo = smooth(0.05, 0.35, n1 * 0.7 + n2 * 0.5 + (lat > 47 ? 0.25 : 0) - k.med * 0.4);
        if (fo > 0.5 && k.arid < 0.15 && h < 0.3) forest[i] = 1;
        green = mix3(green, C.forest, fo * 0.85);
        green = mix3(green, C.boreal, k.north);
        const medc = mix3(C.med, C.med2, smooth(-0.5, 0.5, n2));
        c = mix3(green, medc, k.med * (1 - fo * 0.6));
        c = mix3(c, mix3(C.steppe, C.steppe2, smooth(-0.5, 0.5, n1)), k.steppe);
        const des = mix3(mix3(C.sand, C.sand2, smooth(-0.6, 0.6, n1)), C.dune, smooth(0.2, 0.7, n2) * 0.6);
        c = mix3(c, mix3(des, C.rockDesert, smooth(0.08, 0.25, h)), smooth(0.15, 0.75, k.arid));
        if (coast < 0.05 && (k.arid > 0.25 || n2 > 0.35)) c = mix3(c, C.beach, 0.7);
        const slope = Math.abs(sampleHeight(heights, lon + 0.09, lat) - sampleHeight(heights, lon - 0.09, lat)) + Math.abs(sampleHeight(heights, lon, lat + 0.09) - sampleHeight(heights, lon, lat - 0.09));
        const rockT = Math.max(smooth(0.3, 0.46, h + n2 * 0.04), smooth(0.05, 0.13, slope + n2 * 0.015) * smooth(0.06, 0.16, h));
        c = mix3(c, mix3(C.rock, C.rock2, smooth(-0.3, 0.5, n3)), rockT);
        const snowLine = 0.43 + (45 - lat) * 0.006;
        c = mix3(c, C.snow, smooth(snowLine, snowLine + 0.08, h + n3 * 0.05));
        if (rdist < 0.032 + 0.018 * smooth(30, 20, lat)) c = mix3(c, C.river, 0.85);
        // hillshade from the real relief, lit from the north-west
        const hxs = sampleHeight(heights, lon + 0.09, lat) - sampleHeight(heights, lon - 0.09, lat);
        const hys = sampleHeight(heights, lon, lat + 0.09) - sampleHeight(heights, lon, lat - 0.09);
        const v = (1 + n3 * 0.05) * (1 + clamp((hxs - hys) * 2.4, -0.32, 0.26));
        c = [c[0] * v, c[1] * v, c[2] * v];
      } else {
        const dd = -sdist[i] / PX_PER_DEG;
        c = mix3(C.shallow, C.deep, smooth(0.02, 0.9, dd));
      }
      px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // biome per province (for battle maps)
  for (const p of provinces) {
    const k = climate(p.lon, p.lat, sdist[p.gy * GW + p.gx] / PX_PER_DEG, riverDist(p.lon, p.lat));
    const h = sampleHeight(heights, p.lon, p.lat);
    p.height = h;
    p.biome = k.arid > 0.6 ? 'desert' : k.arid > 0.3 ? 'arid' : k.steppe > 0.5 ? 'steppe' : k.north > 0.5 ? 'boreal' : k.med > 0.5 ? 'med' : 'temperate';
    if (k.arid > 0.5 && riverDist(p.lon, p.lat) < 0.3) p.biome = 'arid';
    const w = toWorld(p.lon, p.lat);
    p.x = w.x; p.z = w.z;
  }

  progress(0.95, 'Raising the standards');
  await tick();
  return { land, own, sdist, heights, forest, colorCanvas: cv, provinces, bdist, other, elev };
}

// The real place a battle is fought: how rugged it is, where the sea and rivers lie,
// and the horizon seen from the field (sampled from ETOPO out to 60 km).
export function battleGeo(world, id) {
  const p = world.provinces[id], E = world.elev;
  if (!E) return null;
  const kmLon = 111 * Math.cos((p.lat * Math.PI) / 180), kmLat = 111;
  const at = (dxKm, dyKm) => E(p.lon + dxKm / kmLon, p.lat + dyKm / kmLat);
  const e0 = Math.max(0, at(0, 0));
  let s1 = 0, s2 = 0, n = 0;
  for (let dx = -15; dx <= 15; dx += 5) for (let dy = -15; dy <= 15; dy += 5) { const v = Math.max(0, at(dx, dy)); s1 += v; s2 += v * v; n++; }
  const rough = Math.sqrt(Math.max(0, s2 / n - (s1 / n) ** 2));
  const isSea = (lon, lat) => { const { gx, gy } = lonLatToGrid(lon, lat); const x = Math.round(gx), y = Math.round(gy); if (x < 0 || y < 0 || x >= GW || y >= GH) return true; return !world.land[y * GW + x]; };
  let sea = null;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2;
    for (let d = 1; d <= 24; d += 1) {
      if (isSea(p.lon + (Math.sin(a) * d) / kmLon, p.lat + (Math.cos(a) * d) / kmLat)) { if (!sea || d < sea.dist) sea = { az: a, dist: d }; break; }
    }
  }
  const rd = riverDist(p.lon, p.lat);
  const AZ = 128, R = [4, 8, 14, 22, 34, 50, 70];
  const h = new Float32Array(AZ * R.length);
  for (let k = 0; k < AZ; k++) {
    const a = (k / AZ) * Math.PI * 2;
    for (let r = 0; r < R.length; r++) {
      const lon = p.lon + (Math.sin(a) * R[r]) / kmLon, lat = p.lat + (Math.cos(a) * R[r]) / kmLat;
      h[k * R.length + r] = isSea(lon, lat) ? -50 : Math.max(0, E(lon, lat));
    }
  }
  return { rough, e0, sea, river: rd < 0.14, lat: p.lat, hz: { AZ, R, h } };
}
