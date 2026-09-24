import { Track } from '../src/world/Track.ts';
import { MONZA } from '../src/world/Circuits.ts';
import { planOval } from '../src/world/env/ovalpath.ts';
const t = new Track(MONZA);
const o = planOval(t, () => 0);
console.log('n', o.n, 'len', o.n * 2, 'bridgeU', o.bridgeU, 'bridgeS', o.bridgeS.toFixed(1), 'roadY', o.roadY.toFixed(2), 'deckBottom', o.deckBottom.toFixed(2), 'angle', (o.crossAngle*180/Math.PI).toFixed(1), 'abut', o.abutLat);
console.log('cN', o.cN, 'cS', o.cS);
let worst = [];
for (let i = 0; i < o.n; i += 5) {
  if (Math.abs(i - o.bridgeU) < 60) continue;
  const pr = t.project(o.x[i], o.z[i]);
  const side = pr.lateral < 0 ? -1 : 1;
  const bar = t.barrierAt(pr.s, side);
  const clear = Math.abs(pr.lateral) - bar - 6 - 5.4*o.bank[i];
  worst.push([clear, i, pr.s, pr.lateral]);
}
worst.sort((a,b)=>a[0]-b[0]);
for (const w of worst.slice(0, 12)) console.log('clear', w[0].toFixed(1), 'u', w[1], 's', w[2].toFixed(0), 'lat', w[3].toFixed(1));
for (let i = 0; i < o.n; i += 100) console.log(i, o.x[i].toFixed(0), o.z[i].toFixed(0), 'bank', o.bank[i].toFixed(2), 'base', o.base[i].toFixed(1));
