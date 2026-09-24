// Self-intersections of the barrier lines (centre + right·side·barrier).  node tools/barriercheck.mjs
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
const t = new Track(CIRCUITS[0]);
const n = t.n;
for (const side of [-1, 1]) {
  const arr = side < 0 ? t.barrierL : t.barrierR;
  const P = [];
  for (let i = 0; i < n; i++) {
    const rl = Math.hypot(t.rx[i], t.rz[i]);
    P.push([t.px[i] + (t.rx[i] / rl) * side * arr[i], t.pz[i] + (t.rz[i] / rl) * side * arr[i]]);
  }
  const hits = [];
  const cross = (a, b, c, d) => {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < i + 300; j++) {
      const a = P[i], b = P[(i + 1) % n], c = P[j % n], d = P[(j + 1) % n];
      if (cross(a, b, c, d)) { hits.push([i, j % n]); break; }
    }
  }
  // merge runs
  const runs = [];
  for (const [i, j] of hits) { const r = runs[runs.length - 1]; if (r && i - r[1] < 5) r[1] = i; else runs.push([i, i, j]); }
  console.log(side < 0 ? 'LEFT ' : 'RIGHT', runs.length ? runs.map((r) => `${r[0]}-${r[1]}→${r[2]}`).join('  ') : 'clean');
}
