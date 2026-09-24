// Headless full race through Race.ts: lights, laps, finish, classification.
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { Race } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { planWeather } from '../src/world/Weather.ts';
const track = new Track(CIRCUITS[0]);
const entries = allEntries();
const LAPS = Number(process.argv[2] ?? 3);
const WX = process.argv[3] ?? 'clear';
const race = new Race(track, { mode: 'race', laps: LAPS, difficulty: 0.97, playerEntry: entries[4], playerGrid: 9, entries, weather: planWeather(WX, 'afternoon', LAPS * 85, Number(process.env.SEED ?? 3)) });
console.log('weather', WX, JSON.stringify(race.weather.plan.keys.slice(0, 3)), 'changeAt', race.weather.plan.changeAt);
const auto = new AIDriver(0.985, 0.6);
auto.startFrom(race.player.car, track);
race.startLights();
const dt = 1 / 60;
let t = 0, contacts = 0;
const kinds = {};
let lastKind = '';
while (t < LAPS * 110 + 60) {
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
  Object.assign(race.playerInput, auto.input);
  race.update(dt);
  for (const e of race.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const w = race.weatherState;
  if (w.kind !== lastKind) { lastKind = w.kind; console.log(`  t=${t.toFixed(0)} weather ${w.kind} rain ${w.rain.toFixed(2)} wet ${w.wetness.toFixed(2)}`); }
  if (Math.round(t * 60) % (60 * 30) === 0) console.log(`  t=${t.toFixed(0)} wet ${w.wetness.toFixed(2)} dry ${w.dryLine.toFixed(2)} tyres ${race.cars.map((c) => c.compound[0]).join('')}`);
  t += dt;
  if (race.cars.every((c) => c.finished)) break;
}
console.log('sim', t.toFixed(1), 's; events', JSON.stringify(kinds));
for (const r of race.classification()) console.log(String(r.pos).padStart(2), r.entry.driver.code, r.isPlayer ? '*' : ' ', 'laps', r.laps, 'time', isFinite(r.time) ? r.time.toFixed(2) : '-', 'gap', typeof r.gap === 'number' ? r.gap.toFixed(3) : r.gap, 'best', r.best.toFixed(3), 'stops', race.cars.find((c) => c.entry === r.entry).stops, race.cars.find((c) => c.entry === r.entry).compoundsUsed.join('>'));
let dmg = 0; for (const c of race.cars) dmg += c.car.damage; console.log('total wall damage', dmg.toFixed(0));
