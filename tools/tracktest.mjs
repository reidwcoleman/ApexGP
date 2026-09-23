import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
for (const def of CIRCUITS) {
  const t0 = performance.now();
  const t = new Track(def);
  console.log(def.name, 'built in', (performance.now() - t0).toFixed(0), 'ms; length', t.length);
  let minB = 1e9, maxB = 0, rlMin = 0, rlMax = 0;
  for (let i = 0; i < t.n; i++) { minB = Math.min(minB, t.barrierL[i], t.barrierR[i]); maxB = Math.max(maxB, t.barrierL[i], t.barrierR[i]); rlMin = Math.min(rlMin, t.racingLine[i]); rlMax = Math.max(rlMax, t.racingLine[i]); }
  console.log('barrier', minB.toFixed(1), maxB.toFixed(1), 'racing line', rlMin.toFixed(2), rlMax.toFixed(2));
  console.log('startS', t.startS, 'sectors', t.sectorS.map(v=>v.toFixed(0)), 'drs', JSON.stringify(t.drs.map(z=>[z.detect,z.start,z.end].map(v=>Math.round(v)))), 'pit', JSON.stringify(t.pit));
  // plot
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < t.n; i++) { minx = Math.min(minx, t.px[i]); maxx = Math.max(maxx, t.px[i]); minz = Math.min(minz, t.pz[i]); maxz = Math.max(maxz, t.pz[i]); }
  const pad = 90; const W = maxx - minx + pad * 2, H = maxz - minz + pad * 2; const M = Math.max(W, H);
  const X = (x) => (x - minx + pad).toFixed(1), Z = (z) => (z - minz + pad).toFixed(1);
  const path = (fn, step = 2) => { let d = ''; for (let i = 0; i <= t.n; i += step) { const j = i % t.n; const [x, z] = fn(j); d += (i ? 'L' : 'M') + X(x) + ' ' + Z(z); } return d; };
  const off = (j, o) => [t.px[j] + t.rx[j] * o, t.pz[j] + t.rz[j] * o];
  const zone = t.buildDistanceField(8, 300, 200);
  const rects = [];
  const surfColor = ['#444', '#d33', '#777', '#6a4', '#cb9'];
  let dots = '';
  for (let i = 0; i < t.n; i += 3) {
    for (const side of [-1, 1]) {
      const bar = side < 0 ? t.barrierL[i] : t.barrierR[i];
      for (let o = t.halfWidth[i] + 0.5; o < bar; o += 3) {
        const code = t.surfaceAt(i, o * side);
        const [x, z] = off(i, o * side);
        dots += `<circle cx="${X(x)}" cy="${Z(z)}" r="1.6" fill="${surfColor[code]}"/>`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1600" viewBox="${(W - M) / 2} ${(H - M) / 2} ${M} ${M}"><rect x="-5000" y="-5000" width="20000" height="20000" fill="#fff"/>${dots}
  <path d="${path((j) => off(j, -t.halfWidth[j]))}" fill="none" stroke="#000" stroke-width="1"/>
  <path d="${path((j) => off(j, t.halfWidth[j]))}" fill="none" stroke="#000" stroke-width="1"/>
  <path d="${path((j) => off(j, -t.barrierL[j]))}" fill="none" stroke="#00f" stroke-width="1.5"/>
  <path d="${path((j) => off(j, t.barrierR[j]))}" fill="none" stroke="#00f" stroke-width="1.5"/>
  <path d="${path((j) => off(j, t.racingLine[j]), 1)}" fill="none" stroke="#f0f" stroke-width="1.2"/>
  </svg>`;
  writeFileSync(`shots/layout_${def.id}.svg`, svg);
  execSync(`qlmanage -t -s 1600 -o shots shots/layout_${def.id}.svg >/dev/null 2>&1`);
}
