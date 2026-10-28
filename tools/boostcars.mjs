// Car against car: a bump, a supersonic demo, overlap separation, head-on.   node --experimental-transform-types --no-warnings tools/boostcars.mjs
import { World, TICK } from '../src/boost/sim/world.ts';
import { noInput } from '../src/boost/sim/car.ts';
import { loadRocketSim } from '../src/boost/sim/rocketsim.ts';
await loadRocketSim();
const mk = (teamB = 1) => { const w = new World(); w.addCar({ name: 'a', team: 0, bot: false, skill: 1, color: 0, owner: 'l' }); w.addCar({ name: 'b', team: teamB, bot: false, skill: 1, color: 0, owner: 'l' }); w.start({ freeplay: true }); w.phase = 'play'; w.ball.pos.set(-3000, 4000, 93); return { w, a: w.cars[0], b: w.cars[1] }; };
{ // a at 1400 into stationary b's side (T-bone)
  const { w, a, b } = mk(0); a.place(0, -400, Math.PI / 2); b.place(0, 0, 0); a.vel.set(0, 1400, 0);
  let ev = []; for (let i = 0; i < 60; i++) { w.step([{ ...noInput(), throttle: 1 }, noInput()]); ev.push(...w.events.filter((e) => e.t === 'bump')); w.events = []; }
  console.log('bump at 1400: events', ev.length, 'victim vel', b.vel.x.toFixed(0), b.vel.y.toFixed(0), b.vel.z.toFixed(0), 'hitter vy', a.vel.y.toFixed(0));
}
{ // supersonic into opponent
  const { w, a, b } = mk(1); a.place(0, -400, Math.PI / 2); b.place(0, 0, 0); a.vel.set(0, 2250, 0); a.supersonic = true;
  let demo = false; for (let i = 0; i < 40; i++) { w.step([{ ...noInput(), boost: true }, noInput()]); if (w.events.some((e) => e.t === 'demo')) demo = true; w.events = []; }
  console.log('supersonic hit: demo', demo, 'victim alive', b.alive);
}
{ // side by side resting, overlapping slightly: should separate calmly
  const { w, a, b } = mk(0); a.place(0, 0, 0); b.place(0, 80, 0);
  for (let i = 0; i < 120; i++) w.step([noInput(), noInput()]);
  console.log('overlap start 80 apart (boxes 86.7 wide): now', (b.pos.y - a.pos.y).toFixed(1), 'speeds', a.vel.len().toFixed(1), b.vel.len().toFixed(1), 'up', a.rot.u.z.toFixed(2), b.rot.u.z.toFixed(2));
}
{ // head on, 1000 each, same team (no demo): rebound small (e 0.1)
  const { w, a, b } = mk(0); a.place(0, -300, Math.PI / 2); b.place(0, 300, -Math.PI / 2); a.vel.set(0, 1000, 0); b.vel.set(0, -1000, 0);
  for (let i = 0; i < 40; i++) w.step([noInput(), noInput()]);
  console.log('head-on 1000 each: after', a.vel.y.toFixed(0), b.vel.y.toFixed(0), '(bumps both ways apply on top)');
}
