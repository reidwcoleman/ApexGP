// Plot the circuit to an SVG (and PNG via qlmanage) for quick layout checks.
// node tools/trackplot.mjs
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { generateCircuit } from '../src/world/CircuitGen.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';

for (const def of CIRCUITS) {
  const c = generateCircuit(def);
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < c.n; i++) {
    minx = Math.min(minx, c.x[i]); maxx = Math.max(maxx, c.x[i]);
    minz = Math.min(minz, c.z[i]); maxz = Math.max(maxz, c.z[i]);
  }
  const pad = 80;
  const W = maxx - minx + pad * 2, H = maxz - minz + pad * 2;
  const sx = (x) => (x - minx + pad).toFixed(1); // top-down view from +Y
  const sz = (z) => (z - minz + pad).toFixed(1);
  let d = '';
  for (let i = 0; i < c.n; i += 3) d += (i ? 'L' : 'M') + sx(c.x[i]) + ' ' + sz(c.z[i]);
  d += 'Z';
  let marks = '';
  for (const k of c.corners) {
    const i = k.sApex;
    marks += `<circle cx="${sx(c.x[i])}" cy="${sz(c.z[i])}" r="6" fill="red"/><text x="${sx(c.x[i])}" y="${sz(c.z[i]) - 12}" font-size="22" fill="#333">${k.name} R${k.radius}</text>`;
  }
  const s0 = def.startOffset;
  marks += `<circle cx="${sx(c.x[s0])}" cy="${sz(c.z[s0])}" r="10" fill="green"/>`;
  const M = Math.max(W, H);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1400" viewBox="${(W - M) / 2} ${(H - M) / 2} ${M} ${M}"><rect width="100%" height="100%" fill="white"/><path d="${d}" fill="none" stroke="#222" stroke-width="15"/>${marks}</svg>`;
  const out = `shots/track_${def.id}.svg`;
  execSync('mkdir -p shots');
  writeFileSync(out, svg);
  console.log(def.name, 'length', c.length, 'm', 'segLens', c.segLen.join(','));
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < c.n; i++) { ymin = Math.min(ymin, c.y[i]); ymax = Math.max(ymax, c.y[i]); }
  console.log('extent', (maxx - minx).toFixed(0), 'x', (maxz - minz).toFixed(0), 'elev', ymin.toFixed(1), ymax.toFixed(1));
  try { execSync(`qlmanage -t -s 1400 -o shots ${out} >/dev/null 2>&1`); } catch {}
}
