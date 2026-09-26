// Handling test bench: runs the real CarPhysics on an endless flat test pad and
// reports numbers to compare with a real F1 car / the F1 games.
//   node tools/handling.mjs
import { CarPhysics, F1_SPEC } from '../src/sim/CarPhysics.ts';

// Minimal flat "track" that satisfies what CarPhysics uses.
const N = 1_000_000;
const flat = {
  n: N,
  length: N,
  ux: { length: N, 0: 0 },
  uy: null,
  uz: null,
  rx: null,
  rz: null,
  wrap: (s) => ((s % N) + N) % N,
  surfaceAt: () => 0,
  project: (x, z) => ({ s: 500000 + z, lateral: -x, index: Math.floor(500000 + z) }),
  frame: () => ({ heading: 0 }),
  barrierAt: () => 1e9,
};
flat.ux = new Proxy({}, { get: () => 0 });
flat.uy = new Proxy({}, { get: () => 1 });
flat.uz = new Proxy({}, { get: () => 0 });
flat.banked = new Proxy({}, { get: () => 0 });

const DT = 1 / 300;
const kmh = (v) => v * 3.6;
const inp = (o = {}) => ({ throttle: 0, brake: 0, steer: 0, ers: false, shiftUp: false, shiftDown: false, ...o });

function newCar(assists = {}) {
  const c = new CarPhysics(F1_SPEC);
  c.x = 0; c.z = 0; c.yaw = 0; c.s = 500000; c.hint = 500000;
  c.assists = { traction: 'full', abs: true, stability: false, autoGear: true, ...assists };
  return c;
}

// 1. acceleration & top speed
{
  const c = newCar();
  const marks = [100, 200, 300];
  const got = {};
  let t = 0;
  while (t < 40) {
    c.step(DT, inp({ throttle: 1 }), flat, false);
    t += DT;
    for (const m of marks) if (!got[m] && kmh(c.vx) >= m) got[m] = t.toFixed(2);
  }
  console.log(`accel   0-100 ${got[100]}s  0-200 ${got[200]}s  0-300 ${got[300]}s  top ${kmh(c.vx).toFixed(0)} km/h (real F1: ~2.6 / ~4.8 / ~10.5 s, ~345)`);
  const d = newCar();
  d.setSpeed(c.vx);
  d.gear = 8;
  d.drsOpen = true;
  for (let t2 = 0; t2 < 30; t2 += DT) { d.drsOpen = true; d.step(DT, inp({ throttle: 1 }), flat, true); }
  console.log(`        top with DRS ${kmh(d.vx).toFixed(0)} km/h`);
}

// 2. braking
for (const [from, to] of [[300, 80], [200, 80], [120, 60]]) {
  for (const abs of [true, false]) {
    const c = newCar({ abs });
    c.setSpeed(from / 3.6);
    c.gear = 8;
    let dist = 0, t = 0, peak = 0;
    while (kmh(c.vx) > to && t < 20) {
      const v0 = c.vx;
      c.step(DT, inp({ brake: 1 }), flat, false);
      dist += c.vx * DT;
      peak = Math.max(peak, (v0 - c.vx) / DT / 9.81);
      t += DT;
    }
    console.log(`brake   ${from}→${to} km/h  abs=${abs ? 'on ' : 'off'}  ${dist.toFixed(0)} m  ${t.toFixed(2)} s  peak ${peak.toFixed(1)} g  lockup ${c.lockup.toFixed(2)}`);
  }
}

// 4. step steer: yaw-rate rise time and overshoot
for (const v of [100, 200, 280]) {
  const c = newCar({ stability: false });
  c.setSpeed(v / 3.6);
  c.gear = v < 150 ? 4 : v < 250 ? 6 : 8;
  const lim = c.gripSteerLimit(c.vx);
  const d = lim * 0.6;
  let t = 0, maxR = 0, rTimes = [];
  const rs = [];
  while (t < 3) {
    const thr = 0.35 + (v / 3.6 - c.vx) * 0.3;
    c.step(DT, inp({ steer: t > 0.1 ? d : 0, throttle: Math.max(0, Math.min(1, thr)) }), flat, false);
    rs.push(c.r);
    maxR = Math.max(maxR, c.r);
    t += DT;
  }
  const final = rs[rs.length - 1];
  const i90 = rs.findIndex((x) => x > final * 0.9);
  console.log(`step    ${v} km/h  δ=${d.toFixed(3)} (limit ${lim.toFixed(3)})  yaw 90% in ${((i90 * DT) - 0.1).toFixed(2)} s  overshoot ${(((maxR / final) - 1) * 100).toFixed(0)}%  lat ${((c.vx * final) / 9.81).toFixed(2)} g  β ${(Math.atan2(c.vy, c.vx) * 57.3).toFixed(1)}°`);
}

// 5. full lock at speed (what a pad at full stick does)
for (const v of [80, 160, 250]) {
  for (const stab of [false, true]) {
    const c = newCar({ stability: stab });
    c.setSpeed(v / 3.6);
    c.gear = v < 150 ? 3 : 6;
    let t = 0, maxBeta = 0;
    while (t < 2.5) {
      c.step(DT, inp({ steer: c.gripSteerLimit(c.vx), throttle: 0.4 }), flat, false);
      maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(c.vy, Math.max(1, c.vx))));
      t += DT;
    }
    console.log(`fullock ${v} km/h stab=${stab ? 'on ' : 'off'}  lat ${((c.vx * c.r) / 9.81).toFixed(2)} g  max β ${(maxBeta * 57.3).toFixed(1)}°  end ${kmh(c.vx).toFixed(0)} km/h  ${maxBeta > 0.5 ? 'SPUN' : 'ok'}`);
  }
}

// 6. power oversteer: mid-corner full throttle in 2nd gear, TC off vs medium vs full
for (const tc of ['off', 'medium', 'full']) {
  const c = newCar({ traction: tc, stability: false });
  c.setSpeed(70 / 3.6);
  c.gear = 2;
  let t = 0, maxBeta = 0;
  while (t < 3) {
    const thr = t < 1 ? 0.3 : 1;
    c.step(DT, inp({ steer: 0.12, throttle: thr }), flat, false);
    if (t > 1) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(c.vy, Math.max(1, c.vx))));
    t += DT;
  }
  console.log(`power   TC=${tc.padEnd(6)} max β ${(maxBeta * 57.3).toFixed(1)}°  wheelspin ${c.wheelspin.toFixed(2)}  ${maxBeta > 0.6 ? 'SPUN' : maxBeta > 0.15 ? 'slides' : 'grips'}`);
}
