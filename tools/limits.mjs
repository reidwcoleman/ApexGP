// Where do AI cars break track limits in a race?  node tools/limits.mjs [laps] [weather]
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { Race } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { planWeather } from '../src/world/Weather.ts';
const track = new Track(CIRCUITS[0]);
const entries = allEntries();
const LAPS = Number(process.argv[2] ?? 2);
const race = new Race(track, { mode: 'race', laps: LAPS, difficulty: 0.97, playerEntry: entries[4], playerGrid: 9, entries, weather: planWeather(process.argv[3] ?? 'clear', 'afternoon', 600, 3) });
const auto = new AIDriver(0.985, 0.6);
auto.startFrom(race.player.car, track);
race.startLights();
const corner = (s) => { let b = track.corners[0], bd = 1e9; for (const c of track.corners) { const d = Math.abs(track.delta(c.sApex, s)); if (d < bd) { bd = d; b = c; } } return `${b.name}${track.delta(b.sApex, s) >= 0 ? '+' : ''}${Math.round(track.delta(b.sApex, s))}`; };
const where = {};
const prev = race.cars.map(() => false);
const dt = 1 / 60;
let t = 0;
while (t < LAPS * 110 + 60) {
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
  Object.assign(race.playerInput, auto.input);
  race.update(dt);
  race.cars.forEach((c, i) => {
    const off = c.car.offTrack;
    if (off && !prev[i] && race.phase === 'racing') { const k = corner(c.car.s).replace(/[+-]\d+$/, ''); where[k] = (where[k] ?? 0) + 1; if (process.env.V) console.log(t.toFixed(1), c.entry.driver.code, corner(c.car.s), 'lat', c.car.lateral.toFixed(1), 'v', (c.car.vx * 3.6).toFixed(0), 'dirty', c.car.dirty.toFixed(2), 'off', c.ai?.offset.toFixed(2), 'tgt', c.ai?.targetOffset.toFixed(2), 'line', track.racingLineAt(c.car.s).toFixed(1), 'slipR', c.car.slipRear.toFixed(2), 'slipF', c.car.slipFront.toFixed(2), 'grip', c.car.gripFactor.toFixed(3)); }
    prev[i] = off;
  });
  t += dt;
  if (race.cars.every((c) => c.finished)) break;
}
console.log('off-track entries by corner:', JSON.stringify(where));
