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
  racingLineAt: () => 0,
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
  for (const [abs, arcade] of [[true, false], [false, false], [true, true]]) {
    const c = newCar({ abs, arcade });
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
    console.log(`brake   ${from}→${to} km/h  abs=${abs ? 'on ' : 'off'}${arcade ? ' arcade' : '       '}  ${dist.toFixed(0)} m  ${t.toFixed(2)} s  peak ${peak.toFixed(1)} g  lockup ${c.lockup.toFixed(2)}`);
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

// 7. the game's Standard handling (assisted: TC medium, ABS, stability, arcade) vs the bare simulation
const STD = { traction: 'medium', abs: true, stability: true, arcade: true };
const SIM = { traction: 'off', abs: false, stability: false };
for (const [name, a] of [['sim', SIM], ['standard', STD]]) {
  // trail-braking: turn in at 200 km/h while still on the brakes (60 % pedal, easing off): how much the
  // car rotates past what the wheels alone ask for (yaw rate / kinematic yaw rate) and the rear's slide
  for (const brk of [0.6, 0]) {
    const c = newCar(a);
    c.setSpeed(200 / 3.6);
    c.gear = 6;
    let t = 0, maxGain = 0, maxBeta = 0, rotT = 0;
    const d = c.gripSteerLimit(c.vx) * 0.75;
    while (t < 1.4) {
      const br = Math.max(0, brk - t * 0.4);
      c.step(DT, inp({ steer: t > 0.15 ? d : 0, brake: br }), flat, false);
      t += DT;
      if (t > 0.3) {
        const kin = (c.vx * Math.tan(d)) / (F1_SPEC.a + F1_SPEC.b);
        maxGain = Math.max(maxGain, c.r / kin);
        const b = Math.abs(Math.atan2(c.vy - F1_SPEC.b * c.r, c.vx));
        if (b > maxBeta) { maxBeta = b; rotT = t; }
      }
    }
    console.log(`trail   ${name.padEnd(8)} 200 km/h, ${brk ? '60%→0 brake' : 'coasting   '} into the turn  rotation ${maxGain.toFixed(2)}× the wheels' path  rear slip ${(maxBeta * 57.3).toFixed(1)}° at ${rotT.toFixed(2)} s  ${maxBeta > 0.6 ? 'SPUN' : ''}`);
  }
  // exit: 2nd gear at the apex, then full throttle with the wheel still turned
  {
    const c = newCar(a);
    c.setSpeed(85 / 3.6);
    c.gear = 2;
    let t = 0, maxBeta = 0;
    while (t < 2.5) {
      c.step(DT, inp({ steer: c.gripSteerLimit(c.vx) * 0.85, throttle: t < 0.6 ? 0.3 : 1 }), flat, false);
      t += DT;
      if (t > 0.6) maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(c.vy - F1_SPEC.b * c.r, Math.max(1, c.vx))));
    }
    console.log(`exit    ${name.padEnd(8)} 85 km/h 2nd, full throttle at the apex  max rear slip ${(maxBeta * 57.3).toFixed(1)}°  ${maxBeta > 0.6 ? 'SPUN' : maxBeta > 0.12 ? 'steps out' : 'grips'}`);
  }
  // kerb: 200 km/h straight, the left wheels ride a 25 m kerb (a strike on, ridges, a strike off)
  {
    const kerb = { ...flat, surfaceAt: (s, lat) => (s > 500040 && s < 500065 && lat < -0.3 ? 1 : 0) };
    const c = newCar(a);
    c.setSpeed(200 / 3.6);
    c.gear = 6;
    c.lateral = 0;
    let t = 0, maxR = 0, maxH = 0, maxP = 0;
    while (t < 1.5) {
      c.step(DT, inp({ throttle: 0.5 }), kerb, false);
      t += DT;
      maxR = Math.max(maxR, Math.abs(c.r));
      maxH = Math.max(maxH, Math.abs(c.heave + 0.0));
      maxP = Math.max(maxP, Math.abs(c.roll));
    }
    console.log(`kerb    ${name.padEnd(8)} left wheels over a kerb at 200 km/h  yaw kick ${(maxR * 57.3).toFixed(1)}°/s  heading ${(c.yaw * 57.3).toFixed(1)}°  body roll ${(maxP * 57.3).toFixed(2)}°`);
  }
}
// 8. wet: steady cornering grip at 150 km/h by tyre type and water (fraction of dry slicks)
{
  const lat = (type, wet, a = { stability: false }) => {
    const c = newCar(a);
    c.weather = { wetnessAt: () => wet, state: { airTemp: 18, trackTemp: 20 } };
    c.tyreType = type;
    // the compound's working window as Pit.ts fits it (slick ~100 °C, inter 80, wet 65)
    c.tyreOpt = [100, 80, 65][type];
    c.tyreTemp.fill(type ? 70 : 95);
    c.setSpeed(150 / 3.6);
    c.gear = 5;
    let t = 0, best = 0;
    while (t < 3) {
      const thr = 0.3 + (150 / 3.6 - c.vx) * 0.4;
      c.step(DT, inp({ steer: c.gripSteerLimit(c.vx), throttle: Math.max(0, Math.min(1, thr)) }), flat, false);
      t += DT;
      if (t > 1) best = Math.max(best, c.vx * c.r);
    }
    return best;
  };
  const dry = lat(0, 0);
  const row = (n, ty) => [0.3, 0.6, 1].map((w) => `${(lat(ty, w) / dry * 100).toFixed(0)}%`).join(' / ');
  console.log(`wet     150 km/h cornering vs dry slicks at water 0.3 / 0.6 / 1.0:  slick ${row('s', 0)}  inter ${row('i', 1)}  wet ${row('w', 2)}   (dry ${(dry / 9.81).toFixed(2)} g)`);
}
// 9. Standard handling: step steer and full lock (what a keyboard / pad at full input does)
for (const v of [100, 200, 280]) {
  const c = newCar(STD);
  c.setSpeed(v / 3.6);
  c.gear = v < 150 ? 4 : v < 250 ? 6 : 8;
  let t = 0, maxBeta = 0;
  while (t < 2.5) {
    c.step(DT, inp({ steer: Math.min(F1_SPEC.maxSteer, c.gripSteerLimit(c.vx) * 1.75), throttle: 0.4 }), flat, false);
    maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(c.vy, Math.max(1, c.vx))));
    t += DT;
  }
  console.log(`stdlock ${v} km/h full pad lock  lat ${((c.vx * c.r) / 9.81).toFixed(2)} g  max β ${(maxBeta * 57.3).toFixed(1)}°  end ${kmh(c.vx).toFixed(0)} km/h  ${maxBeta > 0.5 ? 'SPUN' : 'ok'}`);
}
// 10. abuse on Standard: full lock and full throttle out of a slow corner — dry, dry over a kerb, slicks on a wet track
for (const [what, wet, kerb] of [['dry', 0, false], ['dry kerb', 0, true], ['wet slicks', 0.5, false]]) {
  const c = newCar(STD);
  const tr = kerb ? { ...flat, surfaceAt: (s, lat) => (Math.floor(s) % 9 < 5 ? 1 : 0) } : flat;
  if (wet) c.weather = { wetnessAt: () => wet, state: { airTemp: 18, trackTemp: 20 } };
  c.setSpeed(75 / 3.6);
  c.gear = 2;
  let t = 0, maxBeta = 0;
  while (t < 2.5) {
    c.step(DT, inp({ steer: Math.min(F1_SPEC.maxSteer, c.gripSteerLimit(c.vx) * 1.75), throttle: t < 0.4 ? 0.3 : 1 }), tr, false);
    t += DT;
    maxBeta = Math.max(maxBeta, Math.abs(Math.atan2(c.vy - F1_SPEC.b * c.r, Math.max(1, c.vx))));
  }
  console.log(`abuse   standard ${what.padEnd(10)} full lock + full throttle at 75 km/h  max rear slip ${(maxBeta * 57.3).toFixed(1)}°  ${maxBeta > 0.6 ? 'SPUN' : maxBeta > 0.12 ? 'slides, caught' : 'grips'}`);
}
// 11. kerbs mid-corner: a steady corner near the limit, then the wheels ride a 15 m kerb — the inside
// wheels at the apex (off throttle) and the outside wheels on the exit (on the power). How much the
// car is upset: the biggest change in rear slip angle and yaw rate against the steady corner.
for (const [name, a] of [['sim', SIM], ['standard', STD]]) {
  for (const [where, kmhV, inside, thrK] of [['apex', 150, true, 0], ['exit', 200, false, 1]]) {
    const c = newCar(a);
    let kerbOn = false;
    // the frame follows the car so the wheels' "lateral" stays left/right of it through the turn
    const tr = { ...flat, frame: () => ({ heading: c.yaw }), surfaceAt: (s, lat) => (kerbOn && (inside ? lat < c.lateral - 0.3 : lat > c.lateral + 0.3) ? 1 : 0) };
    c.setSpeed(kmhV / 3.6);
    c.gear = kmhV < 170 ? 5 : 6;
    let t = 0, r0 = 0, b0 = 0, dR = 0, dB = 0, spun = false;
    const d = c.gripSteerLimit(c.vx) * 0.8;
    const tOn = 2.0, tOff = 2.0 + 15 / (kmhV / 3.6);
    while (t < 3.5) {
      kerbOn = t > tOn && t < tOff;
      let thr = 0.35 + (kmhV / 3.6 - c.vx) * 0.4;
      if (kerbOn && thrK) thr = 1;
      c.step(DT, inp({ steer: d, throttle: Math.max(0, Math.min(1, thr)) }), tr, false);
      t += DT;
      const b = Math.atan2(c.vy - F1_SPEC.b * c.r, Math.max(1, c.vx));
      if (t < tOn) { r0 = c.r; b0 = b; }
      else { dR = Math.max(dR, Math.abs(c.r - r0)); dB = Math.max(dB, Math.abs(b - b0)); if (Math.abs(b) > 0.6) spun = true; }
    }
    console.log(`kerbcnr ${name.padEnd(8)} ${where} kerb at ${kmhV} km/h (80% lock${thrK ? ', full throttle' : ''})  yaw-rate upset ${(dR * 57.3).toFixed(1)}°/s  rear slip upset ${(dB * 57.3).toFixed(1)}°  ${spun ? 'SPUN' : 'held'}`);
  }
}
// 12. tyres out of the blankets (80 °C, softs): a lap-like cycle (3 s of a 200 km/h corner at 50 %
// lock, ~3.3 g; 6 s of straight at 250) — tread and carcass temperature, hot pressure and grip as they
// come up to the window (outside front / outside rear)
{
  const c = newCar({ stability: false });
  c.tyreOpt = 98;
  c.setSpeed(200 / 3.6);
  c.gear = 6;
  let t = 0;
  const marks = [0.01, 20, 60, 120];
  const row = [];
  while (t < 121) {
    const corner = t % 9 < 3;
    const vT = (corner ? 200 : 250) / 3.6;
    const thr = 0.35 + (vT - c.vx) * 0.4;
    c.step(DT, inp({ steer: corner ? c.gripSteerLimit(c.vx) * 0.5 : 0, throttle: Math.max(0, Math.min(1, thr)), brake: c.vx > vT + 3 ? 0.6 : 0 }), flat, false);
    t += DT;
    for (const m of marks) if (t >= m && t - DT < m) {
      const p = c.tyrePress ? `${c.tyrePress[1].toFixed(1)}/${c.tyrePress[3].toFixed(1)} psi` : '-';
      const core = c.tyreCore ? `${c.tyreCore[1].toFixed(0)}/${c.tyreCore[3].toFixed(0)}` : '-';
      row.push(`${m.toFixed(0).padStart(3)} s: tread ${c.tyreTemp[1].toFixed(0)}/${c.tyreTemp[3].toFixed(0)} °C  carcass ${core} °C  ${p}  grip ${(c.gripFactor * 100).toFixed(1)}%`);
    }
  }
  console.log(`warmup  softs from the blankets: 3 s of a 200 km/h corner, 6 s of straight, repeated (outside front / rear)\n        ${row.join('\n        ')}`);
}
