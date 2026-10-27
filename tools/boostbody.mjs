// Car body against the arena: wall rebound, resting on the roof, side landing, roof-slide friction.
//   node --experimental-transform-types --no-warnings tools/boostbody.mjs
import { World, TICK } from '../src/boost/sim/world.ts';
import { noInput } from '../src/boost/sim/car.ts';
const mk = () => { const w = new World(); w.addCar({ name: 'a', team: 0, bot: false, skill: 1, color: 0, owner: 'l' }); w.start({ freeplay: true }); w.phase = 'play'; const c = w.cars[0]; w.ball.pos.set(-3000, 4000, 93); return { w, c }; };
{ // airborne into the side wall, nose first, 1500 uu/s
  const { w, c } = mk(); c.place(3600, 0, 0); c.pos.z = 600; c.vel.set(1500, 0, 0);
  let vx = 0; for (let i = 0; i < 60; i++) { w.step([noInput()]); if (c.vel.x < vx) vx = c.vel.x; }
  console.log('nose into wall at 1500: rebound vx', vx.toFixed(0), '(restitution 0.3 at the contact point; spin', c.w.len().toFixed(2) + ')');
}
{ // dropped on its roof from 200
  const { w, c } = mk(); c.place(0, 0, 0); c.rot.fromEuler(0, 0, Math.PI); c.pos.z = 200;
  let minZ = 999; for (let i = 0; i < 360; i++) { w.step([noInput()]); minZ = Math.min(minZ, c.pos.z); }
  const z0 = c.pos.z; let jitter = 0; for (let i = 0; i < 240; i++) { w.step([noInput()]); jitter = Math.max(jitter, Math.abs(c.pos.z - z0), c.vel.len()); }
  console.log('on its roof: rests at z', z0.toFixed(2), 'lowest', minZ.toFixed(2), 'jitter', jitter.toFixed(3), 'up.z', c.rot.u.z.toFixed(2));
}
{ // side landing from 300 with spin
  const { w, c } = mk(); c.place(0, 0, 0); c.rot.fromEuler(0, 0, Math.PI / 2); c.pos.z = 300; c.w.set(0, 2, 0);
  for (let i = 0; i < 480; i++) w.step([noInput()]);
  console.log('side drop: ends z', c.pos.z.toFixed(1), 'up.z', c.rot.u.z.toFixed(2), 'speed', c.vel.len().toFixed(2));
}
{ // sliding on the roof at 1000: friction 0.3 → decel ~ 0.3 g = 195
  const { w, c } = mk(); c.place(0, 0, 0); c.rot.fromEuler(0, 0, Math.PI); c.pos.z = 60;
  for (let i = 0; i < 120; i++) w.step([noInput()]);
  c.vel.set(0, 1000, 0); const v0 = 1000; for (let i = 0; i < 60; i++) w.step([noInput()]);
  console.log('roof slide decel', ((v0 - c.vel.len()) / 0.5).toFixed(0), 'uu/s² (μ 0.3 × 650 = 195)');
}
