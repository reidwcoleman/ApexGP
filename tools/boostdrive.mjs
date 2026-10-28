// Driving checks against Rocket League's measured numbers (RLBot): turn curvature by speed, coast,
// brake, boost from rest, landing.   node --experimental-transform-types --no-warnings tools/boostdrive.mjs
import { World, TICK } from '../src/boost/sim/world.ts';
import { noInput } from '../src/boost/sim/car.ts';
import { loadRocketSim } from '../src/boost/sim/rocketsim.ts';
await loadRocketSim();
const mk = () => { const w = new World(); w.addCar({ name: 'a', team: 0, bot: false, skill: 1, color: 0, owner: 'l' }); w.start({ freeplay: true, unlimitedBoost: true }); w.phase = 'play'; const c = w.cars[0]; c.place(0, -3000, Math.PI / 2); w.ball.pos.set(4000, 4000, 93); return { w, c }; };
// RLBot-measured max curvature by speed
const ref = [[0, 0.0069], [500, 0.00398], [1000, 0.00235], [1500, 0.001375], [1750, 0.0011], [2300, 0.00088]];
for (const [sp] of ref.slice(1)) {
  const { w, c } = mk();
  // accelerate to speed (boost if needed), then hold full steer at that speed with throttle bang-bang
  for (let i = 0; i < 600; i++) {
    const v = c.vel.dot(c.rot.f);
    const steer = i > 300 ? 1 : 0;
    w.step([{ ...noInput(), throttle: v < sp ? 1 : 0.0, boost: v < sp - 30 && sp > 1400, steer }]);
    c.pos.x = Math.max(-3000, Math.min(3000, c.pos.x)); // stay off walls (approx)
  }
  const v = c.vel.len();
  const k = Math.abs(c.w.dot(c.rot.u)) / Math.max(1, v);
  const want = ref.find((r) => r[0] === sp)[1];
  console.log(`speed ${v.toFixed(0)} curvature ${k.toFixed(5)}  RL ${want}  slip ${(c.vel.dot(c.rot.l) / v).toFixed(3)}`);
}
{ // coast and brake decel
  const { w, c } = mk();
  for (let i = 0; i < 240; i++) w.step([{ ...noInput(), throttle: 1 }]);
  const v0 = c.vel.len(); for (let i = 0; i < 60; i++) w.step([noInput()]);
  console.log('coast decel', ((v0 - c.vel.len()) / 0.5).toFixed(0), '(RL 525)');
  const v1 = c.vel.len(); for (let i = 0; i < 24; i++) w.step([{ ...noInput(), throttle: -1 }]);
  console.log('brake decel', ((v1 - c.vel.len()) / 0.2).toFixed(0), '(RL 3500)');
}
{ // boost from rest
  const { w, c } = mk(); let t1 = -1, t2 = -1;
  for (let i = 0; i < 600; i++) { w.step([{ ...noInput(), throttle: 1, boost: true }]); const v = c.vel.len(); if (t1 < 0 && v >= 1400) t1 = i * TICK; if (t2 < 0 && v >= 2200) t2 = i * TICK; }
  console.log('boost from rest: 1400 at', t1.toFixed(2), 's, supersonic at', t2.toFixed(2), 's');
}
{ // drop from 300, landing
  const { w, c } = mk(); c.pos.z = 300; c.onGround = false; let maxBounce = 0, landed = -1;
  for (let i = 0; i < 240; i++) { w.step([noInput()]); if (landed < 0 && c.onGround) landed = i; if (landed >= 0) maxBounce = Math.max(maxBounce, c.pos.z - 17); }
  console.log('drop 300: landed tick', landed, 'max rebound above rest', maxBounce.toFixed(1), 'final z', c.pos.z.toFixed(2));
}
