// Trace the racecraft state of whichever quicker car has been stuck behind a slower one for > 20 s.
//   TRACK=silverstone SEED=1 npx tsx tools/_trace_pair.mjs
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { Race, mulberry32 } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { planWeather } from '../src/world/Weather.ts';
const track = new Track(CIRCUITS.find((c) => c.id === (process.env.TRACK ?? 'silverstone')));
const entries = allEntries();
const LAPS = 6, SEED = Number(process.env.SEED ?? 1);
const race = new Race(track, { mode: 'race', laps: LAPS, difficulty: 0.97, playerEntry: entries[4], playerGrid: 10, entries, weather: planWeather('clear', 'afternoon', LAPS * 85, SEED), seed: SEED });
const auto = new AIDriver(0.97, 0.6, mulberry32((race.seed ^ 0x5eed) >>> 0));
auto.startFrom(race.player.car, track);
race.adoptPlayerAI?.(auto);
race.playerDrsAuto = true;
race.startLights();
const dt = 1 / 60; let t = 0, acc = 0, n = 0;
// real pace: the car's best lap so far (laps 2+), as speed
const paceOf = (c) => (c.laps >= 2 && isFinite(c.bestLap) && c.bestLap > 0 ? 1 / c.bestLap : 0);
const streak = new Map();
let focus = null;
while (t < 900 && n < 140) {
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
  Object.assign(race.playerInput, auto.input);
  race.update(dt); t += dt;
  if (race.phase !== 'racing' || race.raceTime < 40) continue;
  acc += dt; if (acc < 0.5) continue; acc = 0;
  const run = race.cars.filter((c) => !c.retired && !c.finished && c.pit.phase === 'none').sort((a, b) => b.raceDist - a.raceDist);
  for (let i = 1; i < run.length; i++) {
    const c = run[i], a = run[i - 1];
    const gap = (a.raceDist - c.raceDist) / Math.max(20, c.car.vx);
    const ok = gap < 1.2 && paceOf(a) > 0 && paceOf(c) > paceOf(a) * 1.008;
    streak.set(c, ok ? (streak.get(c) ?? 0) + 0.5 : 0);
    if (!focus && streak.get(c) > 20) focus = [c, a];
  }
  if (!focus) continue;
  const [ca, cb] = focus;
  const ds = track.delta(ca.car.s, cb.car.s);
  if (ds < -10 || ds > 80) { console.log('-- pair split', ds.toFixed(0)); focus = null; continue; }
  const ai = ca.ai ?? auto, bi = cb.ai;
  n++;
  console.log(`${ca.entry.driver.code}>${cb.entry.driver.code} ${(100 * (paceOf(ca) / paceOf(cb) - 1)).toFixed(1)}% t${race.raceTime.toFixed(1)} s${Math.round(ca.car.s)} ds${ds.toFixed(1)} dl${(cb.car.lateral - ca.car.lateral).toFixed(1)} v${ca.car.vx.toFixed(0)}/${cb.car.vx.toFixed(0)} att${ai.attack} pt${ai.passTimer.toFixed(1)} ps${ai.passSide} off${ai.offset.toFixed(1)}/${ai.targetOffset.toFixed(1)} brk${Math.round(ai.brakeIn)} stk${ai.stuckBehind.toFixed(0)} ers${ca.car.ers.toFixed(2)}/${cb.car.ers.toFixed(2)} dep${+ca.car.ersDeploying}${+cb.car.ersDeploying} drs${+ca.car.drsOpen}${+cb.car.drsOpen} ot${ca.car.overtake} bdef${bi?.defendSide ?? '-'} dirty${ca.car.dirty.toFixed(2)}`);
}
