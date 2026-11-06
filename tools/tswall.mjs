// Tracksmith: what a barrier does to the car (speed kept, whether it stays upright), and whether the
// autopilot can drive each special piece.
//   node --experimental-transform-types --no-warnings tools/tswall.mjs
import { initPhysics, Sim, DT } from '../src/tracksmith/sim.ts';
import { buildDSL, routeLine } from '../src/tracksmith/track.ts';
import { Autopilot } from '../src/tracksmith/autopilot.ts';

await initPhysics();
const track = (dsl, base = 0) => { const { pieces, route, overlaps } = buildDSL(dsl, base); return { td: { id: 't', name: 't', author: '', theme: 0, pieces, route }, overlaps }; };

console.log('angle  kmh  ->  1s later  upright  offRoad  hits');
for (const kmh of [120, 200]) for (const deg of [5, 15, 30, 50, 80]) {
  const { td } = track('S60 C S2 F');
  const sim = new Sim(td);
  const v = kmh / 3.6, a = (deg * Math.PI) / 180;
  // heading toward +x (left), nose and velocity together
  const q = [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
  sim.setState({ p: [2.5, 0.95, 40], q, v: [Math.sin(a) * v, 0, Math.cos(a) * v], w: [0, 0, 0] });
  sim.started = true;
  let hits = 0, up = 1;
  for (let i = 0; i < 120; i++) {
    sim.step({ throttle: 1, brake: 0, steer: 0, hand: false });
    for (const e of sim.events) if (e.type === 'wall') hits++;
    sim.events.length = 0;
    const s = sim.getState();
    const [x, y, z, w] = s.q;
    up = Math.min(up, 1 - 2 * (x * x + z * z));
  }
  const s = sim.getState();
  console.log(`${String(deg).padStart(4)}  ${kmh}  ->  ${sim.kmh.toFixed(0).padStart(4)} km/h  up ${up.toFixed(2)}  x ${s.p[0].toFixed(1)} y ${s.p[1].toFixed(2)}  hits ${hits} falls ${sim.falls}`);
  sim.free();
}

console.log('\npieces');
const tests = {
  sweepers: 'S3 L4 S3 R5 S3 C S F',
  bank5: 'S4 KL5 S3 KR5 S3 C S F',
  steep3: 'S4 XL3 S3 XR3 S3 C S F',
  steep5: 'S4 XL5 S3 XR5 S3 C S F',
  helixUp: 'S4 HL S6 C S3 F',
  helixUpR: 'S4 HR S6 C S3 F',
  helixDown: 'S3 UP S7 UP S7 DHL S6 C S3 F',
  helixDownR: 'S3 UP S7 UP S7 DHR S6 C S3 F',
  cork: 'S6 CL S4 C S2 F',
  corkR: 'S6 B S CR S4 C S2 F',
  shift: 'S4 SL S2 SR S2 C S F',
  crest: 'S6 Q S3 Q S4 C S F',
  drops: 'S3 UP S4 DN S4 C S F',
  tunnel: 'S3 T4 S3 C S F',
};
for (const [name, dsl] of Object.entries(tests)) {
  const { td, overlaps } = track(dsl, 4);
  const sim = new Sim(td);
  const ap = new Autopilot(routeLine(td));
  let hits = 0, top = 0, falls = 0;
  for (let t = 0; t < 60 / DT && !sim.finished; t++) {
    const s = sim.getState();
    sim.step(ap.drive(s.p, s.q, s.v, sim.grounded > 0));
    for (const e of sim.events) if (e.type === 'wall') hits++;
    sim.events.length = 0;
    top = Math.max(top, sim.kmh);
    if (sim.falls > falls) { falls = sim.falls; ap.relocate(sim.getState().p); }
  }
  console.log(`${name.padEnd(11)} ${sim.finished ? (sim.ticks * DT).toFixed(2) + 's' : 'DNF @' + (ap.progress() * 100).toFixed(0) + '%'}  falls ${falls} walls ${hits} top ${top.toFixed(0)}${overlaps.length ? ' OVERLAPS ' + overlaps.slice(0, 3).join('; ') : ''}`);
  sim.free();
}
