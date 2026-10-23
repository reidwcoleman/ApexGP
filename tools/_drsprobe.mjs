// How often do the cars get DRS? TRACK=suzuka npx tsx tools/_drsprobe.mjs
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { Race, mulberry32 } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { planWeather } from '../src/world/Weather.ts';
const track = new Track(CIRCUITS.find((c) => c.id === (process.env.TRACK ?? 'suzuka')));
console.log('drs zones', JSON.stringify(track.drs), 'len', track.length.toFixed(0));
const entries = allEntries();
const race = new Race(track, { mode: 'race', laps: 5, difficulty: 0.97, playerEntry: entries[4], playerGrid: 10, entries, weather: planWeather('clear', 'afternoon', 400, 1), seed: 1 });
const auto = new AIDriver(0.97, 0.6, mulberry32((race.seed ^ 0x5eed) >>> 0));
auto.startFrom(race.player.car, track);
race.adoptPlayerAI?.(auto);
race.startLights();
const dt = 1 / 60;
let t = 0, elig = 0, open = 0, samples = 0;
while (t < 500) {
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
  Object.assign(race.playerInput, auto.input);
  race.update(dt);
  t += dt;
  if (race.phase !== 'racing') continue;
  for (const c of race.cars) {
    samples++;
    if (c.drsEligible) elig++;
    if (c.car.drsOpen) open++;
  }
}
console.log('eligible share', (elig / samples).toFixed(3), 'open share', (open / samples).toFixed(3));
