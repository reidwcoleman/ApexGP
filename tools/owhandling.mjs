// Miami handling bench: CarBody on a flat plane, no walls. Prints launch / braking / skidpad / stability numbers.
//   node --experimental-transform-types --no-warnings tools/owhandling.mjs [super|muscle|sedan|suv|van|coupe|...]
const { CarBody } = await import('../src/openworld/sim/car.ts');
const { carSpecOf } = await import('../src/openworld/ai/traffic.ts');
const { MODELS } = await import('../src/openworld/vehicles/fleet.ts');
const which = process.argv[2] ?? 'super';
const BIKE = { tumble: false, mass: 290, a: 0.72, b: 0.72, cgH: 0.62, izK: 0.9, power: 150000, maxForce: 4800, frontDrive: 0, mu: 1.25, cornerB: 8, cdA: 0.32, clA: 0.01, fan: 0, maxSteer: 0.42, brakeG: 1.15, hl: 1.05, hw: 0.38, height: 1.2, wheelR: 0.31, vmax: 83, vrev: 2 };
const spec = which === 'bike' ? BIKE : carSpecOf(MODELS[which]);
const net = {
  edges: [],
  surface(x, z, y, o) {
    o.y = 0; o.edge = -1; o.water = false; o.sidewalk = false; o.grass = !!globalThis.GRASS; o.sand = false;
    return o;
  },
};
const world = { boxContacts: () => [] };
const DT = 1 / 60;
const inp = (o = {}) => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, thrust: 0, ...o });
const fresh = (v = 0) => {
  const b = new CarBody(spec);
  b.place(0, 0, 0, 0);
  b.vz = v;
  for (let i = 0; i < 4; i++) b.wSpin[i] = v / spec.wheelR;
  for (let i = 0; i < 120; i++) b.step(DT, inp(), net, world);
  b.vx = 0; b.vz = v; b.yawRate = 0; b.yaw = 0;
  return b;
};
const f2 = (x) => (Math.round(x * 100) / 100).toString();
// settle
{
  const b = new CarBody(spec);
  b.place(0, 0, 0, 0);
  let maxV = 0;
  for (let i = 0; i < 180; i++) { b.step(DT, inp(), net, world); if (i > 60) maxV = Math.max(maxV, b.speed); }
  const sum = b.wLoad.reduce((a, c) => a + c, 0);
  console.log(`settle: loads ${b.wLoad.map((x) => Math.round(x)).join('/')} sum/mg ${f2(sum / (spec.mass * 9.81))} heave ${f2(b.heave)} pitch ${f2(b.pitch)} creep ${maxV.toFixed(4)}`);
}
// launch
{
  const b = fresh();
  let t = 0, t100 = 0, t200 = 0, gears = [];
  while (t < 40) {
    b.step(DT, inp({ throttle: 1 }), net, world);
    t += DT;
    const kmh = b.speed * 3.6;
    if (!t100 && kmh >= 100) t100 = t;
    if (!t200 && kmh >= 200) t200 = t;
    if (gears[gears.length - 1]?.[0] !== b.gear) gears.push([b.gear, Math.round(kmh)]);
    if (t > 0.5 && t < 0.52) console.log(`  t0.5 pitch ${f2(b.pitch * 57.3)}° slip ${b.wSlip.map(f2).join('/')} spin ${b.wSpin.map((w) => f2(w * spec.wheelR)).join('/')} v ${f2(b.speed)}`);
  }
  console.log(`launch: 0-100 ${f2(t100)} s, 0-200 ${t200 ? f2(t200) : '-'} s, v40s ${Math.round(b.speed * 3.6)} km/h, shifts ${gears.map((g) => g.join('@')).join(' ')}, rpm ${Math.round(b.rpm)} drift ${f2(b.pos.x)}`);
}
// braking 100-0
{
  const b = fresh(100 / 3.6);
  let d = 0, t = 0, pmax = 0;
  while (b.speed > 0.05 && !b.reverse && t < 15) { b.step(DT, inp({ brake: 1 }), net, world); d += b.speed * DT; t += DT; pmax = Math.max(pmax, b.pitch); }
  console.log(`brake 100-0: ${f2(d)} m, ${f2(t)} s, dive ${f2(pmax * 57.3)}°, yaw ${f2(b.yaw * 57.3)}°`);
}
// skidpad: constant speed (throttle PI), ramp steer
for (const v of [15, 30]) {
  const b = fresh(v);
  let best = 0, roll = 0, beta = 0;
  for (let i = 0; i < 60 * 8; i++) {
    const st = Math.min(1, i / (60 * 6));
    const err = v - b.vLong;
    b.step(DT, inp({ throttle: Math.max(0, Math.min(1, err * 0.5)), brake: err < -1 ? 0.2 : 0, steer: st * 0.6 }), net, world);
    const lat = Math.abs(b.ay) / 9.81;
    if (lat > best) { best = lat; roll = b.roll; beta = Math.atan2(b.vx * Math.cos(b.yaw) - b.vz * Math.sin(b.yaw), b.vLong); }
  }
  console.log(`skidpad ${v} m/s: max lat ${f2(best)} g, roll ${f2(roll * 57.3)}°, sideslip ${f2(beta * 57.3)}°, end yawrate ${f2(b.yawRate)} free ${b.free} loads ${b.wLoad.map((x) => Math.round(x)).join('/')}`);
}
// step steer at 30 m/s (full lock): spins?
for (const stab of [1, 0]) {
  const b = fresh(30);
  b.stability = stab;
  let maxYaw = 0;
  for (let i = 0; i < 60 * 3; i++) { b.step(DT, inp({ steer: 1 }), net, world); maxYaw = Math.max(maxYaw, Math.abs(b.yawRate)); }
  const beta = Math.atan2(b.vx * Math.cos(b.yaw) - b.vz * Math.sin(b.yaw), Math.abs(b.vLong) + 1e-3);
  console.log(`step steer 30 m/s stab ${stab}: max yawrate ${f2(maxYaw)}, after 3 s v ${f2(b.speed)} sideslip ${f2(beta * 57.3)}° free ${b.free}`);
}
// handbrake turn at 18 m/s
{
  const b = fresh(18);
  for (let i = 0; i < 60 * 1.2; i++) b.step(DT, inp({ steer: 0.7, handbrake: i < 40 }), net, world);
  console.log(`handbrake 18 m/s: turned ${f2(b.yaw * 57.3)}°, v ${f2(b.speed)} slip ${f2(b.slip)}`);
}
// lift-off oversteer: at the limit, throttle off
{
  const b = fresh(25);
  for (let i = 0; i < 60 * 3; i++) b.step(DT, inp({ steer: 0.35, throttle: i < 120 ? 0.6 : 0 }), net, world);
  console.log(`lift-off: yaw ${f2(b.yaw * 57.3)}° yawrate ${f2(b.yawRate)} v ${f2(b.speed)}`);
}
// parking: full lock at walking pace, jitter
{
  const b = fresh(0);
  let jit = 0, lastYr = 0;
  for (let i = 0; i < 60 * 4; i++) {
    b.step(DT, inp({ steer: 1, throttle: 0.15 }), net, world);
    if (i > 60) jit = Math.max(jit, Math.abs(b.yawRate - lastYr));
    lastYr = b.yawRate;
  }
  console.log(`parking: v ${f2(b.speed)} yawrate ${f2(b.yawRate)} jitter ${f2(jit)} slip ${f2(b.slip)}`);
}
// stop & hold
{
  const b = fresh(5);
  for (let i = 0; i < 60 * 3; i++) b.step(DT, inp({ brake: 0.5 }), net, world);
  const x0 = b.pos.z;
  for (let i = 0; i < 60 * 2; i++) b.step(DT, inp({ brake: 0.5 }), net, world);
  console.log(`stop+hold: v ${b.speed.toFixed(4)} moved ${(b.pos.z - x0).toFixed(4)} reverse ${b.reverse}`);
}
// reverse
{
  const b = fresh(0);
  for (let i = 0; i < 60 * 3; i++) b.step(DT, inp({ brake: 1 }), net, world);
  console.log(`reverse 3 s: vLong ${f2(b.vLong)} gear ${b.gear}`);
}
