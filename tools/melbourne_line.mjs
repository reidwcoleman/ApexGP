// Convert the TUMFTM Melbourne CSV into src/world/circuits/melbourneLine.ts
//   node tools/melbourne_line.mjs [startIndex] [--analyse]   (the committed file uses START below)
// x = east, z = −y (south), centred on the bounding box, index rotated so s = 0 is
// on the run from Turn 13 to Turn 14 (Prost), just before the pit entry, so the pit lane
// along the start/finish straight never wraps. The data is already in racing order (clockwise).
import fs from 'node:fs';

// raw CSV index of s = 0 (on the run from Turn 12 to Turn 13, before the pit entry)
const START = 920;
// the survey is the pre-2022 layout: the slow Turn 9/10 chicane (right-left) is replaced by the
// 2022 flat-out sweep, a smooth Hermite blend between these raw indices (pass --old to keep it)
const CHICANE = [476, 548];
const src = fs.readFileSync(new URL('../assets-src/Melbourne.csv', import.meta.url), 'utf8');
const rows = src.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split(',').map(Number));
let pts = rows.map(([x, y, wr, wl]) => ({ x, z: -y, wr, wl }));
const arg = process.argv[2];
let start = arg !== undefined && !arg.startsWith('--') ? Number(arg) : START;
// the 2022 works widened and re-profiled Turn 6 (Marina) and Turn 11 (the old Turn 13): open the survey's
// tight apexes up with a local Gaussian blur of the points (raw index centre, half-window, sigma in points)
const REPROFILE = [[378, 14, 3.2], [834, 10, 2.2]];
if (!process.argv.includes('--old')) {
  for (const [c, h, sig] of REPROFILE) {
    const src = pts.map((q) => ({ ...q }));
    const n = src.length;
    for (let i = c - h; i <= c + h; i++) {
      let sx = 0, sz = 0, sw = 0;
      for (let d = -Math.ceil(sig * 3); d <= Math.ceil(sig * 3); d++) {
        const w = Math.exp(-(d * d) / (2 * sig * sig));
        const q = src[(i + d + n) % n];
        sx += q.x * w; sz += q.z * w; sw += w;
      }
      const win = 0.5 * (1 + Math.cos((Math.PI * (i - c)) / h));
      const q = pts[(i + n) % n];
      q.x += (sx / sw - q.x) * win;
      q.z += (sz / sw - q.z) * win;
    }
  }
}
if (!process.argv.includes('--old')) {
  const [a, b] = CHICANE;
  const P0 = pts[a], P1 = pts[b];
  const d0 = { x: pts[a].x - pts[a - 2].x, z: pts[a].z - pts[a - 2].z };
  const d1 = { x: pts[b + 2].x - pts[b].x, z: pts[b + 2].z - pts[b].z };
  const n0 = Math.hypot(d0.x, d0.z), n1 = Math.hypot(d1.x, d1.z);
  const L = Math.hypot(P1.x - P0.x, P1.z - P0.z);
  const T0 = { x: (d0.x / n0) * L, z: (d0.z / n0) * L }, T1 = { x: (d1.x / n1) * L, z: (d1.z / n1) * L };
  const herm = (t) => {
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    return { x: h00 * P0.x + h10 * T0.x + h01 * P1.x + h11 * T1.x, z: h00 * P0.z + h10 * T0.z + h01 * P1.z + h11 * T1.z };
  };
  // arc length, then resample every ~5 m
  let arc = 0, prev = herm(0);
  for (let i = 1; i <= 400; i++) { const q = herm(i / 400); arc += Math.hypot(q.x - prev.x, q.z - prev.z); prev = q; }
  const m = Math.max(2, Math.round(arc / 5));
  const mid = [];
  for (let j = 1; j < m; j++) {
    const t = j / m, q = herm(t);
    mid.push({ x: q.x, z: q.z, wr: P0.wr + (P1.wr - P0.wr) * t, wl: P0.wl + (P1.wl - P0.wl) * t });
  }
  pts = [...pts.slice(0, a + 1), ...mid, ...pts.slice(b)];
  if (start > b) start += mid.length - (b - a - 1);
}
pts = [...pts.slice(start), ...pts.slice(0, start)];
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
for (const p of pts) { p.x -= cx; p.z -= cz; }

if (process.argv.includes('--analyse')) {
  // cumulative s, heading, curvature (smoothed) and a list of corners
  const n = pts.length;
  const s = [0];
  for (let i = 1; i <= n; i++) s.push(s[i - 1] + Math.hypot(pts[i % n].x - pts[i - 1].x, pts[i % n].z - pts[i - 1].z));
  const th = pts.map((p, i) => { const q = pts[(i + 1) % n]; return Math.atan2(q.x - p.x, q.z - p.z); });
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const k = th.map((t, i) => wrap(t - th[(i - 1 + n) % n]) / 5);
  const ks = k.map((_, i) => { let a = 0; for (let d = -3; d <= 3; d++) a += k[(i + d + n) % n]; return a / 7; });
  let tot = 0; for (const v of k) tot += v * 5;
  let area = 0; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; area += p.x * q.z - q.x * p.z; }
  console.log('points', n, 'length', s[n].toFixed(1), 'total turn deg', (tot * 180 / Math.PI).toFixed(1), 'bbox', (x1 - x0).toFixed(0), (z1 - z0).toFixed(0), 'signed area (x,z)', (area / 2).toFixed(0));
  for (let i = 0; i < n; i += 4) {
    const bar = '#'.repeat(Math.min(60, Math.round(Math.abs(ks[i]) * 2000)));
    console.log(String(Math.round(s[i])).padStart(5), pts[i].x.toFixed(0).padStart(5), pts[i].z.toFixed(0).padStart(5), (th[i] * 180 / Math.PI).toFixed(0).padStart(5), (ks[i] > 0 ? '+' : '-'), bar, 'w', pts[i].wr.toFixed(1), pts[i].wl.toFixed(1));
  }
  process.exit(0);
}

const lines = [];
for (let i = 0; i < pts.length; i += 8) lines.push('  ' + pts.slice(i, i + 8).map((p) => `${p.x.toFixed(2)}, ${p.z.toFixed(2)}`).join(', ') + ',');
const out = `/**
 * Albert Park, Melbourne — surveyed centreline (the 2022+ Grand Prix layout).
 *
 * Derived from the TUMFTM racetrack-database (github.com/TUMFTM/racetrack-database,
 * LGPL-3.0), which traces the circuit from satellite imagery. Points are ~5 m
 * apart, in driving order (clockwise), world metres: x = east, z = south,
 * centred on the circuit's bounding box. Index 0 sits on the run from Turn 13 to
 * Turn 14, just before the pit entry, so the pit lane never wraps.
 * Generated by tools/melbourne_line.mjs.
 */
// prettier-ignore
export const MELBOURNE_LINE: number[] = [
${lines.join('\n')}
];
`;
fs.writeFileSync(new URL('../src/world/circuits/melbourneLine.ts', import.meta.url), out);
console.log('wrote', pts.length, 'points');
