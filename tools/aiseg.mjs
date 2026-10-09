// Where does a solo AI lose time to its own speed profile? Second flying lap, per 100 m:
// profile time, AI time, the AI's min speed vs the profile's, its worst distance off the line.
//   node tools/aiseg.mjs [track=suzuka] [pace=1.0]
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { CarPhysics, F1_SPEC } from '../src/sim/CarPhysics.ts';
import { RacingProfile } from '../src/sim/RacingProfile.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
const [tid = 'suzuka', ps = '1.0'] = process.argv.slice(2);
const track = new Track(CIRCUITS.find((c) => c.id === tid));
const profile = RacingProfile.for(track, F1_SPEC);
const car = new CarPhysics(F1_SPEC);
car.placeOnTrack(track, track.startS ?? 0, 0);
car.fuel = 20;
const ai = new AIDriver(Number(ps), 0.5, () => 0.5);
ai.startFrom(car, track);
const dt = 1 / 120, L = track.length, SEG = 100, nseg = Math.ceil(L / SEG);
const segT = new Float64Array(nseg), vmin = new Float64Array(nseg).fill(1e9), pmin = new Float64Array(nseg).fill(1e9), offl = new Float64Array(nseg), lift = new Float64Array(nseg);
let t = 0, dist = 0, prevS = car.s;
const s0 = car.s;
while (dist < L * 3 && t < 600) {
  ai.update(dt, car, track, profile, true, [], 0);
  car.step(dt, ai.input, track, false);
  t += dt;
  const ds = track.delta(prevS, car.s); prevS = car.s; if (ds > -5 && ds < 50) dist += ds;
  if (dist > L * 2 && dist <= L * 3) {
    const k = Math.min(nseg - 1, Math.floor(track.wrap(car.s - s0) / SEG));
    segT[k] += dt;
    vmin[k] = Math.min(vmin[k], car.vx);
    pmin[k] = Math.min(pmin[k], profile.at(car.s) * Number(ps));
    offl[k] = Math.max(offl[k], Math.abs(car.lateral - track.racingLineAt(car.s) * 0.9));
    if (ai.input.throttle < 0.95 && ai.input.brake === 0) lift[k] += dt;
  }
}
let tot = 0, ptot = 0;
const rows = [];
for (let k = 0; k < nseg; k++) {
  let pt = 0;
  for (let m = 0; m < SEG && k * SEG + m < L; m++) pt += 1 / Math.max(1, profile.at(s0 + k * SEG + m) * Number(ps));
  tot += segT[k]; ptot += pt;
  rows.push({ k, s: Math.round(track.wrap(s0 + k * SEG)), loss: segT[k] - pt, vmin: vmin[k] * 3.6, pmin: pmin[k] * 3.6, off: offl[k], lift: lift[k] });
}
console.log(`${tid} pace ${ps}: AI ${tot.toFixed(2)} s vs profile ${ptot.toFixed(2)} s (+${(tot - ptot).toFixed(2)})`);
rows.sort((a, b) => b.loss - a.loss);
for (const r of rows.slice(0, 14)) console.log(`s ${String(r.s).padStart(5)} loss ${r.loss.toFixed(3)}  vmin ${r.vmin.toFixed(0)}/${r.pmin.toFixed(0)} km/h  off-line ${r.off.toFixed(2)} m  lift ${r.lift.toFixed(2)} s`);
