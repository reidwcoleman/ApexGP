// Headless checks of the Boostball physics against the real game's known numbers.
//   node --experimental-transform-types --no-warnings tools/boostphys.mjs
import { World, TICK } from '../src/boost/sim/world.ts';
import { noInput } from '../src/boost/sim/car.ts';
import { sdf } from '../src/boost/sim/arena.ts';
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
{
  const { w, c } = mk();
  run(w, 240, () => noInput());
  console.log('rest z', c.pos.z.toFixed(2), 'up', c.rot.u.z.toFixed(4), 'onGround', c.onGround);
}
{
  const { w, c } = mk();
  let t14 = -1;
  run(w, 600, (t) => { if (t14 < 0 && c.vel.len() > 1400) t14 = t; return { ...noInput(), throttle: 1 }; });
  console.log('throttle only: top', c.vel.len().toFixed(0), 't>1400', t14.toFixed(2));
}
{
  const { w, c } = mk();
  let ts = -1;
  run(w, 600, (t) => { if (ts < 0 && c.vel.len() > 2200) ts = t; return { ...noInput(), throttle: 1, boost: true }; });
  console.log('boost: top', c.vel.len().toFixed(0), 't supersonic', ts.toFixed(2), 'boost left', c.boost.toFixed(1));
}
{
  const { w, c } = mk();
  let mz = 0;
  run(w, 240, (t) => { mz = Math.max(mz, c.pos.z); return { ...noInput(), jump: t < 0.25 }; });
  console.log('full jump apex', (mz - 17).toFixed(0), '(RL ~ 225)');
}
{
  const { w, c } = mk();
  let mz = 0;
  run(w, 300, (t) => { mz = Math.max(mz, c.pos.z); return { ...noInput(), jump: t < 0.2 || (t > 0.3 && t < 0.35) }; });
  console.log('double jump apex', (mz - 17).toFixed(0), '(RL ~ 500)');
}
{
  const { w, c } = mk();
  let t0 = 0;
  run(w, 240, (t) => ({ ...noInput(), throttle: 1 }));
  const v0 = c.vel.len();
  run(w, 60, (t) => ({ ...noInput(), throttle: 1, jump: t < 0.05 || (t > 0.1 && t < 0.15), pitch: t > 0.1 ? -1 : 0 }));
  console.log('front flip: speed', v0.toFixed(0), '->', c.vel.len().toFixed(0), 'w', c.w.len().toFixed(2));
}
{
  const { w, c } = mk();
  c.place(3000, 0, 0); // facing +x, toward the side wall
  let maxz = 0;
  run(w, 400, () => { maxz = Math.max(maxz, c.pos.z); return { ...noInput(), throttle: 1, boost: true }; });
  console.log('drive at side wall: max z', maxz.toFixed(0), 'pos', c.pos.x.toFixed(0), c.pos.z.toFixed(0), 'up', c.rot.u.x.toFixed(2), c.rot.u.z.toFixed(2), 'ground', c.onGround);
}
{
  const { w, c } = mk();
  w.ball.pos.set(0, 0, 1000); w.ball.vel.set(500, 0, 0);
  const zs = [];
  let prev = 0;
  run(w, 600, () => { if (prev < -150 && w.ball.vel.z > 0) zs.push(Math.round(w.ball.vel.z)); prev = w.ball.vel.z; return noInput(); });
  console.log('ball bounces (up speeds)', zs.slice(0, 6).join(','), 'spin', w.ball.w.len().toFixed(2), 'vx', w.ball.vel.x.toFixed(0));
}
{
  const { w, c } = mk();
  c.place(0, -1500, Math.PI / 2);
  w.ball.pos.set(0, 0, 93);
  run(w, 240, () => ({ ...noInput(), throttle: 1, boost: true }));
  console.log('car hits ball: ball speed', w.ball.vel.len().toFixed(0), 'dir', w.ball.vel.y.toFixed(0), w.ball.vel.z.toFixed(0), 'touches', w.stats[0].touches);
}
console.log('sdf floor', sdf(0, 0, 50).toFixed(1), 'corner', sdf(3500, 4500, 50).toFixed(1), 'goal', sdf(0, 5500, 100).toFixed(1), 'post', sdf(893 + 50, 5100, 300).toFixed(1));
{
  // flip reset: a car that has used its flip lands wheels-first on a ball in the air
  const { w, c } = mk();
  w.ball.pos.set(0, 0, 900);
  w.ball.vel.set(0, 0, 0);
  c.pos.set(0, 0, 900 + 92 + 40);
  c.vel.set(0, 0, -300);
  c.rot.fromEuler(0);
  c.onGround = false;
  c.jumped = c.flipped = true;
  c.airTimeSinceJump = 3;
  let got = -1;
  for (let i = 0; i < 60 && got < 0; i++) {
    w.step([noInput()]);
    if (w.events.some((e) => e.t === 'reset')) got = i;
  }
  console.log('flip reset on the ball: tick', got, 'flip available', !c.flipped && !c.jumped);
}
