// How many places can a human gain on the opening lap? The player's car on a bold autopilot (no start
// caution, brakes at the limit, never concedes a corner: the stand-in for a player chasing places)
// from a grid slot; prints places gained by the end of lap 1 and of lap 2, averaged over seeds.
//   TRACK=monza DIFF=0.96 GRID=9 SEEDS=6 npx tsx tools/startbench.mjs
// JSON=1: one machine-readable line.
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { Race, mulberry32 } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { planWeather } from '../src/world/Weather.ts';

const track = new Track(CIRCUITS.find((c) => c.id === (process.env.TRACK ?? 'monza')));
const entries = allEntries();
const GRID = Number(process.env.GRID ?? 9);
const SEEDS = Number(process.env.SEEDS ?? 6);
const PACE = Number(process.env.PACE ?? 0.99); // FIELD=1: the field's own average pace
const res = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const race = new Race(track, { mode: 'race', laps: 3, difficulty: Number(process.env.DIFF ?? 0.96), playerEntry: entries[4], playerGrid: GRID, entries, weather: planWeather('clear', 'afternoon', 300, seed), seed });
  const fp = race.cars.filter((c) => c.ai).reduce((a, c) => a + c.ai.pace, 0) / (race.cars.length - 1);
  const auto = new AIDriver(process.env.FIELD ? fp : PACE, 1, mulberry32((race.seed ^ 0x5eed) >>> 0));
  auto.bold = true;
  auto.startFrom(race.player.car, track);
  race.adoptPlayerAI?.(auto);
  auto.reaction = 0.2; // a sharp human reaction, no bogged launch
  auto.bog = 0;
  race.playerDrsAuto = true;
  // ARCADE=1: the player's car on the Arcade assist (the Standard preset's default)
  if (process.env.ARCADE) race.player.car.assists = { ...race.player.car.assists, arcade: true };
  race.startLights();
  const start = race.player.position;
  const dt = 1 / 60;
  let t = 0, p1 = 0, p2 = 0, t1Pos = 0, t5Pos = 0;
  const fieldPace = race.cars.filter((c) => c.ai).reduce((a, c) => a + c.ai.pace, 0) / (race.cars.length - 1);
  while (t < 400) {
    const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
    auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
    Object.assign(race.playerInput, auto.input);
    race.update(dt);
    t += dt;
    if (race.phase === 'racing' && !t5Pos && race.raceTime > 5) t5Pos = race.player.position;
    if (race.phase === 'racing' && !t1Pos && race.raceTime > 20) t1Pos = race.player.position;
    if (race.player.laps >= 1 && !p1) p1 = race.player.position;
    if (race.player.laps >= 2 && !p2) { p2 = race.player.position; break; }
  }
  res.push({ seed, start, fieldPace, t5: start - t5Pos, t20: start - t1Pos, lap1: start - p1, lap2: start - p2 });
}
const avg = (k) => +(res.reduce((a, r) => a + r[k], 0) / res.length).toFixed(2);
const out = { track: track.def.id, grid: GRID + 1, fieldPace: avg('fieldPace'), gain5s: avg('t5'), gain20s: avg('t20'), gainLap1: avg('lap1'), gainLap2: avg('lap2'), runs: res.map((r) => `${r.t20}/${r.lap1}/${r.lap2}`).join(' ') };
console.log(process.env.JSON ? 'JSON ' + JSON.stringify(out) : out);
