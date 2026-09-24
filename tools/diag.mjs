// Diagnose one AI car on the circuit: where it leaves the road, tyre temps, grip.
// node tools/diag.mjs [laps] [weather] [compound]
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { CarPhysics, F1_SPEC } from '../src/sim/CarPhysics.ts';
import { RacingProfile } from '../src/sim/RacingProfile.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { Weather, planWeather } from '../src/world/Weather.ts';
import { fitTyres } from '../src/race/Pit.ts';

const LAPS = Number(process.argv[2] ?? 2);
const wk = process.argv[3] ?? 'clear';
const comp = process.argv[4] ?? 'soft';
const pace = Number(process.env.PACE ?? 0.985);
const track = new Track(CIRCUITS[0]);
const profile = new RacingProfile(track, F1_SPEC);
const weather = new Weather(planWeather(wk, 'afternoon', 600, 7));
const car = new CarPhysics(F1_SPEC);
car.weather = weather;
car.fuel = Number(process.env.FUEL ?? 10);
fitTyres(car, comp);
const g = track.gridSlot(0);
car.placeOnTrack(track, g.s, g.lateral);
const ai = new AIDriver(pace, 0.5);
ai.startFrom(car, track);
const dt = 1 / 240;
let t = 0, laps = -1, lapStart = 0, prevLd = track.lapDistance(g.s), prevOff = false;
const corner = (s) => { let b = track.corners[0], bd = 1e9; for (const c of track.corners) { const d = Math.abs(track.delta(c.sApex, s)); if (d < bd) { bd = d; b = c; } } return `${b.name}${track.delta(b.sApex, s) >= 0 ? '+' : ''}${Math.round(track.delta(b.sApex, s))}`; };
let tSum = [0, 0, 0, 0], tN = 0, tMax = 0, tMin = 999, pl = [0, 0, 0, 0], pt = [0, 0, 0, 0], fzv = [0, 0, 0, 0];
console.log(`weather ${wk}: wet ${weather.state.wetness.toFixed(2)} air ${weather.state.airTemp.toFixed(0)} track ${weather.state.trackTemp.toFixed(0)}  tyre ${comp}`);
while (laps < LAPS && t < LAPS * 160 + 30) {
  weather.update(dt, 1);
  const reset = ai.update(dt, car, track, profile, t > 1, [{ id: 0, s: car.s, lateral: car.lateral, speed: car.vx }], 0);
  if (reset) { console.log(`  t=${t.toFixed(1)} RESET at ${corner(car.s)}`); car.placeOnTrack(track, car.s - 20, track.racingLineAt(car.s - 20)); }
  car.step(dt, ai.input, track, false);
  if (car.offTrack && !prevOff) console.log(`  t=${t.toFixed(1)} off at ${corner(car.s)} v=${(car.vx * 3.6).toFixed(0)} lat=${car.lateral.toFixed(1)} line=${track.racingLineAt(car.s).toFixed(1)} slipR=${car.slipRear.toFixed(2)} slipF=${car.slipFront.toFixed(2)}`);
  if (car.contact.wallHit > 0.5) console.log(`  t=${t.toFixed(1)} WALL at ${corner(car.s)} ${car.contact.wallHit.toFixed(1)} m/s`);
  prevOff = car.offTrack;
  if (laps >= 0) { for (let i = 0; i < 4; i++) { tSum[i] += car.tyreTemp[i]; pl[i] += car.slipPowL[i]; pt[i] += car.slipPowT[i]; fzv[i] += car.load[i] * car.vx; } tN++; tMax = Math.max(tMax, ...car.tyreTemp); tMin = Math.min(tMin, ...car.tyreTemp); }
  const ld = track.lapDistance(car.s);
  if (ld < 100 && prevLd > track.length - 100) {
    laps++;
    if (laps >= 1) console.log(`lap ${laps}: ${(t - lapStart).toFixed(2)} s  tyres avg ${tSum.map((x) => (x / tN).toFixed(0)).join('/')} min ${tMin.toFixed(0)} max ${tMax.toFixed(0)}  grip ${car.gripFactor.toFixed(3)} wear ${car.wear.map((w) => (w * 100).toFixed(1)).join('/')}% fuel ${car.fuel.toFixed(1)}`);
    if (process.env.HEAT) console.log('   mean slip kW long', pl.map((x) => (x / tN / 1000).toFixed(1)).join('/'), 'lat', pt.map((x) => (x / tN / 1000).toFixed(1)).join('/'), 'Fz·v MW', fzv.map((x) => (x / tN / 1e6).toFixed(2)).join('/'));
    pl = [0, 0, 0, 0]; pt = [0, 0, 0, 0]; fzv = [0, 0, 0, 0];
    lapStart = t; tSum = [0, 0, 0, 0]; tN = 0; tMax = 0; tMin = 999;
  }
  prevLd = ld;
  t += dt;
}
