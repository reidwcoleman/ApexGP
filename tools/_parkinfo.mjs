import { Track } from '../src/world/Track.ts';
import { MONZA } from '../src/world/Circuits.ts';
const t = new Track(MONZA);
let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
for (let i = 0; i < t.n; i++) { minx = Math.min(minx, t.px[i]); maxx = Math.max(maxx, t.px[i]); minz = Math.min(minz, t.pz[i]); maxz = Math.max(maxz, t.pz[i]); }
console.log('n', t.n, 'bbox x', minx.toFixed(0), maxx.toFixed(0), 'z', minz.toFixed(0), maxz.toFixed(0));
for (const c of t.corners) console.log(c.name, 'dir', c.dir, 'R', c.radius.toFixed(0), 's', c.sStart.toFixed(0), c.sApex.toFixed(0), c.sEnd.toFixed(0), 'apex', t.px[Math.round(c.sApex)%t.n].toFixed(0), t.pz[Math.round(c.sApex)%t.n].toFixed(0));
for (let s = 0; s < t.n; s += 100) {
  const i = s;
  console.log('s', s, 'x', t.px[i].toFixed(0), 'y', t.py[i].toFixed(1), 'z', t.pz[i].toFixed(0), 'hdg', (t.heading[i]*180/Math.PI).toFixed(0), 'barL', t.barrierL[i].toFixed(1), 'barR', t.barrierR[i].toFixed(1), 'roL', t.runoffL[i], 'roR', t.runoffR[i]);
}
console.log('pit', JSON.stringify(t.pit));
