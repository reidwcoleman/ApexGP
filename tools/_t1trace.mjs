import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { Race, mulberry32 } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { planWeather } from '../src/world/Weather.ts';
const track = new Track(CIRCUITS.find((c) => c.id === (process.env.TRACK ?? 'monza')));
const entries = allEntries(); const seed = Number(process.env.SEED ?? 2);
const race = new Race(track, { mode: 'race', laps: 3, difficulty: 0.96, playerEntry: entries[4], playerGrid: 9, entries, weather: planWeather('clear', 'afternoon', 300, seed), seed });
const fp = race.cars.filter((c) => c.ai).reduce((a, c) => a + c.ai.pace, 0) / (race.cars.length - 1);
const auto = new AIDriver(fp, 1, mulberry32((race.seed ^ 0x5eed) >>> 0)); auto.bold = true;
auto.startFrom(race.player.car, track); race.adoptPlayerAI(auto); auto.reaction = 0.2; auto.bog = 0; race.playerDrsAuto = true; race.startLights();
const dt = 1 / 60; let t = 0, acc = 0;
while (t < 60) {
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
  Object.assign(race.playerInput, auto.input);
  race.update(dt); t += dt;
  if (race.phase !== 'racing') continue;
  acc += dt; if (acc < 0.5) continue; acc = 0;
  const p = race.player; const c = p.car;
  if (race.raceTime > 25) break;
  if (process.env.FIELD_AT && Math.abs(race.raceTime - Number(process.env.FIELD_AT)) < 0.26) for (const o of race.cars.slice().sort((a, b) => a.position - b.position)) { const ai = o.ai ?? auto; console.log(`   P${o.position} ${o.entry.driver.code} s${Math.round(o.car.s)} lat${o.car.lateral.toFixed(1)} v${o.car.vx.toFixed(0)} prof${race.profile.at(o.car.s).toFixed(0)} off${+o.car.offTrack} brk${Math.round(ai.brakeIn)} offs${ai.offset.toFixed(1)} | vt${ai.dbg.vt.toFixed(0)} ref${ai.dbg.vRef.toFixed(0)} pK${ai.dbg.pathK.toFixed(2)} oL${ai.dbg.offLoss.toFixed(2)} fol${ai.dbg.follow === Infinity ? '-' : ai.dbg.follow.toFixed(0)} late${ai.dbg.late.toFixed(0)} cap${ai.capL > -1e9 ? ai.capL.toFixed(1) : '-'}/${ai.capR < 1e9 ? ai.capR.toFixed(1) : '-'} tgt${ai.targetOffset.toFixed(1)}`); }
  const offs = race.cars.filter((o) => o.car.offTrack).length;
  console.log(`t${race.raceTime.toFixed(1)} pos${p.position} s${Math.round(c.s)} lat${c.lateral.toFixed(1)} v${c.vx.toFixed(0)} off${+c.offTrack} hw${track.halfWidthAt(c.s).toFixed(1)} brk${Math.round(auto.brakeIn)} fieldOff${offs} pen${p.penalties?.length ?? '-'} warn${p.warnings ?? '-'}`);
}
