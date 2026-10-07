import { profileAt } from '../src/car/hull.ts';
import { SUSP_LEGS } from '../src/car/carGeometry.ts';
// for each suspension inner pickup: hull half-width at the pickup's height and z
function hullXAt(z: number, y: number) {
  const pr = profileAt(z);
  let best = -1;
  for (let i = 0; i < pr.x.length - 1; i++) {
    const y0 = pr.y[i], y1 = pr.y[i + 1];
    if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) best = Math.max(best, pr.x[i] + (pr.x[i + 1] - pr.x[i]) * (y - y0) / (y1 - y0));
  }
  return best;
}
for (const l of SUSP_LEGS) {
  const [x, y, z] = l.inner;
  const pr = profileAt(z);
  console.log(l.front ? 'F' : 'R', l.inner.join(','), 'hullX@y=', hullXAt(z, y).toFixed(3), 'top=', pr.y[0].toFixed(3));
}
console.log('--- adjusted');
for (const l of SUSP_LEGS) {
  let [x, y, z] = l.inner;
  const top = profileAt(z).y[0];
  if (y > top - 0.04) y = +(top - 0.04).toFixed(3);
  const hx = hullXAt(z, y);
  if (hx > 0 && hx < x + 0.0) x = +(hx - 0.006).toFixed(3);
  console.log(l.front ? 'F' : 'R', [x, y, z].join(', '));
}
