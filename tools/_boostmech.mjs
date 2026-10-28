// Checks of the RocketSim-matched mechanics: node --experimental-transform-types --no-warnings tools/_boostmech.mjs
import { World, TICK } from '../src/boost/sim/world.ts';
import { noInput } from '../src/boost/sim/car.ts';
import { loadRocketSim } from '../src/boost/sim/rocketsim.ts';
await loadRocketSim();
const mk = () => {
  const w = new World();
  w.addCar({ name: 'a', team: 0, bot: false, skill: 1, color: 0, owner: 'local' });
  w.start({ freeplay: true });
  w.phase = 'play';
  const c = w.cars[0];
  c.place(0, -2000, Math.PI / 2);
  w.ball.pos.set(3000, 3000, 93);
  return { w, c };
};
const run = (w, n, f) => { for (let i = 0; i < n; i++) w.step([f(i * TICK)]); };
{ // turtle: flip the car onto its roof, settle, press jump
  const { w, c } = mk();
  c.rot.fromEuler(Math.PI / 2, 0, Math.PI); c.pos.z = 40;
  run(w, 120, () => noInput());
  const u0 = c.rot.u.z;
  let t = -1;
  run(w, 240, (tt) => { if (t < 0 && c.rot.u.z > 0.9 && c.onGround) t = tt; return { ...noInput(), jump: tt < 0.05 }; });
  console.log('turtle: up.z', u0.toFixed(2), '-> wheels down after', t.toFixed(2), 's (RL ~0.5-0.8)');
}
{ // up the side wall, then let go of the throttle
  const { w, c } = mk();
  c.place(3000, 0, 0);
  let onWall = -1;
  run(w, 300, (t) => { if (onWall < 0 && c.onGround && Math.abs(c.rot.u.x) > 0.9) onWall = t; return { ...noInput(), throttle: onWall >= 0 && t > onWall + 0.3 ? 0 : 1 }; });
  console.log('wall: reached', onWall.toFixed(2), 's; after coasting z', c.pos.z.toFixed(0), 'onGround', c.onGround, 'up.x', c.rot.u.x.toFixed(2));
}
{ // half flip: back flip, cancel, then roll
  const { w, c } = mk();
  run(w, 60, () => noInput());
  run(w, 150, (t) => ({ ...noInput(), jump: t < 0.05 || (t > 0.1 && t < 0.15), pitch: t > 0.1 && t < 0.2 ? 1 : t >= 0.2 ? -1 : 0, roll: t > 0.3 ? 1 : 0 }));
  console.log('half flip: vel', c.vel.x.toFixed(0), c.vel.y.toFixed(0), 'facing', c.rot.f.x.toFixed(2), c.rot.f.y.toFixed(2));
}
{ // air roll rate
  const { w, c } = mk();
  run(w, 60, () => noInput());
  run(w, 70, (t) => ({ ...noInput(), jump: t < 0.2, roll: t > 0.2 ? 1 : 0 }));
  console.log('air roll w', c.w.len().toFixed(2), '(cap 5.5)');
}
