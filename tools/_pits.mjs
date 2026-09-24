// 12-lap race with pit stops: check AI strategy, pit timing, compounds, classification.
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { planWeather } from '../src/world/Weather.ts';
import { Race } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
const track = new Track(CIRCUITS[0]);
const entries = allEntries();
const race = new Race(track, { mode: 'race', laps: 12, difficulty: 0.97, playerEntry: entries[4], playerGrid: 9, entries, playerCompound: 'soft', weather: planWeather('clear', 'afternoon', 1000, 1) });
const auto = new AIDriver(0.985, 0.6); auto.startFrom(race.player.car, track);
race.startLights();
const kinds = {};
let pitLog = [];
const inPit = new Map();
for (let t = 0; t < 12 * 80 + 60; t += 1 / 60) {
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  if (race.player.pit.phase === 'none') { auto.update(1 / 60, race.player.car, track, race.profile, race.phase !== 'grid' && race.phase !== 'lights', neigh, race.player.id); Object.assign(race.playerInput, auto.input); }
  if (race.player.laps === 5 && !race.player.stops) race.playerPitRequest = true;
  race.update(1 / 60);
  for (const e of race.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  for (const c of race.cars) {
    const was = inPit.get(c.id);
    const now = c.pit.phase !== 'none';
    if (now && !was) inPit.set(c.id, race.raceTime);
    if (!now && was) { pitLog.push(`${c.entry.driver.code} lap ${c.laps} ${(race.raceTime - was).toFixed(1)}s → ${c.compound}`); inPit.set(c.id, 0); }
  }
  if (race.cars.every((c) => c.finished)) break;
}
console.log('events', JSON.stringify(kinds));
console.log('pit stops (time in pit lane):', pitLog.slice(0, 8).join(' | '), pitLog.length, 'total');
for (const r of race.classification().slice(0, 8)) console.log(String(r.pos).padStart(2), r.entry.driver.code, r.isPlayer ? '*' : ' ', 'time', isFinite(r.time) ? r.time.toFixed(1) : '-', 'pen', r.penalty, 'stops', race.cars.find((c) => c.entry === r.entry).stops, race.cars.find((c) => c.entry === r.entry).compoundsUsed.join('>'));
const p = race.player; console.log('player wear end', p.car.wear.map((w) => (w * 100).toFixed(0)).join('/'));
