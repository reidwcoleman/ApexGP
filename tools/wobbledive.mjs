// Wobble Mania: how fast each way of moving really is, on a long flat floor (m/s over 40 s).
// The rule: jump + dive stays the quickest move, but only a bit quicker than hopping.
//   node --experimental-transform-types --no-warnings tools/wobbledive.mjs
import * as THREE from 'three';
import { World, Marble, Mat, Mode } from '../src/marbles/physics.ts';

function run(policy) {
  const w = new World();
  const g = new THREE.PlaneGeometry(6000, 60, 1, 1).rotateX(-Math.PI / 2);
  w.statics.addGeometry(g, Mat.Paint);
  w.statics.build?.();
  const m = new Marble(1);
  m.pos.set(-2900, 0.6, 0);
  w.marbles.push(m);
  const dt = 1 / 60;
  let t = 0, x0 = 0, airT = 0;
  const T0 = 4, T1 = 44;
  while (t < T1) {
    m.input.set(1, 0, 0);
    policy(m, t, dt);
    w.step(dt);
    t += dt;
    if (t < T0) x0 = m.pos.x;
  }
  return (m.pos.x - x0) / (T1 - T0);
}
const onFeet = (m) => m.mode === Mode.Run && m.grounded;
const P = {
  run: () => {},
  jump: (m) => { if (onFeet(m)) m.jump = true; },
  dive: (m) => { if (onFeet(m)) m.dash = true; },
  // jump, dive at the top of the hop, get up, again
  'jump+dive': (m) => {
    if (onFeet(m)) m.jump = true;
    else if (m.mode === Mode.Run && !m.grounded && m.vel.y < 2) m.dash = true;
  },
  // the same, but popping straight out of each slide with a jump
  chained: (m) => {
    if (m.mode === Mode.Dive && m.grounded) m.jump = true;
    else if (onFeet(m)) m.jump = true;
    else if (m.mode === Mode.Run && !m.grounded && m.vel.y < 2) m.dash = true;
  },
};
const out = {};
for (const k in P) out[k] = run(P[k]);
for (const k in out) console.log(k.padEnd(10), out[k].toFixed(2), `${(((out[k] / out.jump) - 1) * 100).toFixed(1).padStart(6)}% vs jump`);
