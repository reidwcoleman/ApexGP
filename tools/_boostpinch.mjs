// Pinch checks: a ball squeezed between a car and a wall or the floor leaves fast (RL: wall pinches
// ~3000-4500 uu/s, ground pinches up to the 6000 cap).
//   node --experimental-transform-types --no-warnings tools/_boostpinch.mjs [simDir]
const dir = process.argv[2] ?? '../src/boost/sim';
const { World, TICK } = await import(`${dir}/world.ts`);
await (await import(`${dir}/rocketsim.ts`)).loadRocketSim();
const { noInput } = await import(`${dir}/car.ts`);
const mk = () => {
  const w = new World();
  w.addCar({ name: 'a', team: 0, bot: false, skill: 1, color: 0, owner: 'local' });
  w.start({ freeplay: true });
  w.phase = 'play';
  return { w, c: w.cars[0], b: w.ball };
};
const run = (w, n, f, each) => { for (let i = 0; i < n; i++) { w.step([f(i * TICK)]); each?.(i); } };
// the ball's speed once it's clear of the car (centres 190 apart) after touching it
const report = (name, w, b, n, f) => {
  const c = w.cars[0];
  let top = 0;
  let at = null;
  let touched = false;
  run(w, n, f, () => {
    const d = c.pos.dist(b.pos);
    if (d < 200) touched = true;
    if (touched && d > 260) { const s = b.vel.len(); if (s > top) { top = s; at = b.vel.clone(); } }
  });
  console.log(name.padEnd(34), 'ball out at', top.toFixed(0).padStart(5), at ? `dir ${(at.x / top).toFixed(2)} ${(at.y / top).toFixed(2)} ${(at.z / top).toFixed(2)}` : '', ' car', c.vel.len().toFixed(0));
};
// A: flying into the side wall, the ball against the wall a little above the nose
for (const dz of [10, 25, 40]) {
  const { w, c, b } = mk();
  c.place(3700, 0, 0);
  c.pos.z = 500;
  c.vel.set(2000, 0, 0);
  c.onGround = false;
  b.pos.set(4096 - 91.5, 0, 500 + 20 + dz);
  report(`wall pinch, ball ${dz} above nose`, w, b, 90, () => ({ ...noInput(), boost: true }));
}
// A2: same with the car driving up the wall's ramp along the floor, the ball sitting on the ramp
{
  const { w, c, b } = mk();
  c.place(3000, 0, 0);
  c.vel.set(2200, 0, 0);
  b.pos.set(3980, 0, 160);
  report('drive into ball on the ramp', w, b, 120, () => ({ ...noInput(), throttle: 1, boost: true }));
}
// B: ground pinch: nose down onto the top front of a ball on the floor
for (const pitch of [0.3, 0.5]) {
  const { w, c, b } = mk();
  c.place(0, 0, 0);
  // pitch the nose down
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  c.rot.f.set(cp, 0, -sp);
  c.rot.u.set(sp, 0, cp);
  c.rot.l.set(0, 1, 0);
  c.pos.set(-60, 0, 230);
  c.vel.set(1500, 0, -600);
  c.onGround = false;
  b.pos.set(100, 0, 92.75);
  report(`ground pinch, nose down ${pitch}`, w, b, 90, () => noInput());
}
// D: glancing wall pinch: flying along the wall and into it, the ball against the wall ahead
for (const into of [500, 900, 1300]) {
  const { w, c, b } = mk();
  const vy = Math.sqrt(2000 * 2000 - into * into);
  const yaw = Math.atan2(vy, into);
  c.place(4096 - 260, -400, yaw);
  c.pos.z = 700;
  c.vel.set(into, vy, 0);
  c.onGround = false;
  b.pos.set(4096 - 92, -400 + 205, 720);
  report(`glancing wall pinch, ${into} into wall`, w, b, 90, () => ({ ...noInput(), boost: true }));
}
// E: kickoff 50/50, both cars at 1400
{
  const w = new World();
  for (const t of [0, 1]) w.addCar({ name: 'a', team: t, bot: false, skill: 1, color: 0, owner: 'local' });
  w.start({ freeplay: true });
  w.phase = 'play';
  const [a, c2] = w.cars;
  a.place(0, -400, Math.PI / 2);
  a.vel.set(0, 1400, 0);
  c2.place(8, 400, -Math.PI / 2);
  c2.vel.set(0, -1400, 0);
  report('kickoff 50/50 at 1400', w, w.ball, 90, () => ({ ...noInput(), throttle: 1 }));
}
// C: plain hit for reference
{
  const { w, c, b } = mk();
  c.place(-600, 0, 0);
  c.vel.set(2000, 0, 0);
  b.pos.set(0, 0, 92.75);
  report('plain hit at 2000', w, b, 90, () => ({ ...noInput(), throttle: 1 }));
}
