// Solo AI laps at a list of pace levels: lap time, time off the road, spins. node tools/aipace.mjs [track] [paces]
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { CarPhysics, F1_SPEC } from '../src/sim/CarPhysics.ts';
import { RacingProfile } from '../src/sim/RacingProfile.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
const [tid = 'monza', paces = '0.92,0.97,1.0,1.03,1.06,1.09'] = process.argv.slice(2);
const track = new Track(CIRCUITS.find((c) => c.id === tid));
const profile = RacingProfile.for(track, F1_SPEC);
for (const p of paces.split(',').map(Number)) {
  const car = new CarPhysics(F1_SPEC);
  car.placeOnTrack(track, track.startS ?? 0, 0);
  car.fuel = 20;
  const ai = new AIDriver(p, 0.5, () => 0.5);
  ai.startFrom(car, track);
  const dt = 1 / 120;
  let t = 0, laps = [], lastLap = 0, off = 0, spins = 0, prevLaps = car.laps ?? 0, startS = car.s, dist = 0, prevS = car.s;
  while (t < 400 && laps.length < 3) {
    ai.update(dt, car, track, profile, true, [], 0);
    car.step(dt, ai.input, track, false);
    t += dt;
    const ds = track.delta(prevS, car.s); prevS = car.s; if (ds > 0 && ds < 50) dist += ds;
    if (Math.abs(car.lateral) > track.halfWidthAt(car.s) + 1.5) off += dt;
    if (Math.abs(car.relYaw ?? 0) > 1.2) spins += dt;
    if (dist >= track.length * (laps.length + 1)) { laps.push(t - lastLap); lastLap = t; }
  }
  console.log(`pace ${p.toFixed(3)} laps ${laps.map((x) => x.toFixed(2)).join(' ')} off ${off.toFixed(1)}s sideways ${spins.toFixed(1)}s`);
}
