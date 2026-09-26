// Headless physics/AI test: N AI cars race K laps; prints lap times, incidents, off-tracks.
// node tools/simtest.mjs [cars] [laps]
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { CarPhysics, F1_SPEC } from '../src/sim/CarPhysics.ts';
import { RacingProfile } from '../src/sim/RacingProfile.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';

const N = Number(process.argv[2] ?? 1);
const LAPS = Number(process.argv[3] ?? 2);
const track = new Track(CIRCUITS[0]);
const profile = new RacingProfile(track, F1_SPEC);
console.log('profile theoretical lap', profile.lapTime.toFixed(2), 's; vmax min', Math.min(...profile.vmax).toFixed(1), 'max', Math.max(...profile.vmax).toFixed(1));
for (const c of track.corners) console.log(`  ${c.name.padEnd(22)} R${String(c.radius).padStart(3)} apex v=${(profile.at(c.sApex) * 3.6).toFixed(0)} km/h`);

const cars = [];
for (let i = 0; i < N; i++) {
  const car = new CarPhysics(F1_SPEC);
  const g = track.gridSlot(i);
  car.placeOnTrack(track, g.s, g.lateral);
  const ai = new AIDriver(0.985 - i * 0.004, 0.5);
  ai.startFrom(car, track);
  cars.push({ car, ai, laps: -1, lastCross: 0, lapStart: 0, times: [], resets: 0, wallHits: 0, offs: 0, prevOff: false, prevLapDist: track.lapDistance(g.s) });
}
const dt = 1 / 240;
let t = 0;
const maxT = LAPS * 140 + 30;
let maxLat = 0;
while (t < maxT) {
  const neigh = cars.map((c, id) => ({ id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  for (let id = 0; id < cars.length; id++) {
    const c = cars[id];
    const reset = c.ai.update(dt, c.car, track, profile, t > 1, neigh, id);
    if (reset) {
      c.resets++;
      c.car.placeOnTrack(track, c.car.s - 20, track.racingLineAt(c.car.s - 20));
    }
    c.car.step(dt, c.ai.input, track, false);
    if (c.car.contact.wallHit > 0.5) c.wallHits++;
    if (c.car.offTrack && !c.prevOff) c.offs++;
    c.prevOff = c.car.offTrack;
    maxLat = Math.max(maxLat, Math.abs(c.car.lateral - track.racingLineAt(c.car.s)));
    const ld = track.lapDistance(c.car.s);
    if (ld < 100 && c.prevLapDist > track.length - 100) {
      c.laps++;
      if (c.laps >= 1) c.times.push(t - c.lapStart);
      c.lapStart = t;
    }
    c.prevLapDist = ld;
  }
  t += dt;
  if (cars.every((c) => c.laps >= LAPS)) break;
}
for (const [i, c] of cars.entries()) {
  console.log(`car ${i}: laps ${c.laps} times ${c.times.map((x) => x.toFixed(2)).join(' ')} resets ${c.resets} wallHits ${c.wallHits} offTrack ${c.offs} integ ${c.car.integrity.toFixed(2)}`);
}
console.log('max deviation from line', maxLat.toFixed(2), 'm; sim time', t.toFixed(1));
