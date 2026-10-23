// Are quicker cars stuck behind slower ones? A headless race (the player's car on an autopilot):
// every second, a car within 1.2 s behind another whose own pace is at least THRESH (0.8%: best laps) higher counts a
// "stuck" second; prints stuck seconds per car per lap, the longest streak, and overtakes after lap 1.
//   TRACK=spa SEED=3 DIFF=0.97 npx tsx tools/trains.mjs [laps=6]
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { Race, mulberry32 } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { planWeather } from '../src/world/Weather.ts';

const track = new Track(CIRCUITS.find((c) => c.id === (process.env.TRACK ?? 'monza')));
const entries = allEntries();
const LAPS = Number(process.argv[2] ?? 6);
const SEED = Number(process.env.SEED ?? 1);
const race = new Race(track, { mode: 'race', laps: LAPS, difficulty: Number(process.env.DIFF ?? 0.97), playerEntry: entries[4], playerGrid: 10, entries, weather: planWeather('clear', 'afternoon', LAPS * 85, SEED), seed: SEED });
const auto = new AIDriver(0.97, 0.6, mulberry32((race.seed ^ 0x5eed) >>> 0));
auto.startFrom(race.player.car, track);
race.adoptPlayerAI?.(auto);
race.playerDrsAuto = true;
race.startLights();
const dt = 1 / 60;
let t = 0, acc = 0;
const stuck = new Map(), streak = new Map();
let longest = 0, longestWho = '';
// real pace: the car's best lap so far (laps 2+), as speed
const paceOf = (c) => (c.laps >= 2 && isFinite(c.bestLap) && c.bestLap > 0 ? 1 / c.bestLap : 0);
while (t < LAPS * 160 + 120 && race.phase !== 'done') {
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
  Object.assign(race.playerInput, auto.input);
  race.update(dt);
  t += dt;
  if (race.phase !== 'racing') continue;
  acc += dt;
  if (acc < 1) continue;
  acc = 0;
  if (race.raceTime < 40) continue;
  const run = race.cars.filter((c) => !c.retired && !c.finished && c.pit.phase === 'none').sort((a, b) => b.raceDist - a.raceDist);
  for (let i = 1; i < run.length; i++) {
    const c = run[i], a = run[i - 1];
    const gap = (a.raceDist - c.raceDist) / Math.max(20, c.car.vx);
    const k = c.entry.driver.code;
    if (gap < 1.2 && paceOf(a) > 0 && paceOf(c) > paceOf(a) * (1 + Number(process.env.THRESH ?? 0.008))) {
      stuck.set(k, (stuck.get(k) ?? 0) + 1);
      const s = (streak.get(k) ?? 0) + 1;
      streak.set(k, s);
      if (s > longest) { longest = s; longestWho = `${k} behind ${a.entry.driver.code} (${(100 * (paceOf(c) / paceOf(a) - 1)).toFixed(1)}% quicker)`; }
    } else streak.set(k, 0);
  }
}
const tot = [...stuck.values()].reduce((x, y) => x + y, 0);
const laps = Math.max(1, race.player.laps);
const out = { track: track.def.id, seed: SEED, stuckPerCarLap: +(tot / 20 / laps).toFixed(2), longest, longestWho };
console.log(process.env.JSON ? 'JSON ' + JSON.stringify(out) : out);
