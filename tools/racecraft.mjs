// How close and how busy is the racing? A headless race through Race.ts (the player's car on an
// autopilot) measuring the things you see on a broadcast: on-track overtakes (by lap, on/by the player),
// the gaps in the pack, side-by-side time, contacts and damage, mistakes, off-tracks and the lap-time spread.
//   TRACK=spa SEED=3 node tools/racecraft.mjs [laps=5] [weather=clear] [grid=9]
// JSON=1 prints one machine-readable line at the end (for averaging over seeds/tracks).
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { Race, mulberry32 } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { planWeather } from '../src/world/Weather.ts';

const track = new Track(CIRCUITS.find((c) => c.id === (process.env.TRACK ?? 'monza')));
const entries = allEntries();
const LAPS = Number(process.argv[2] ?? 5);
const WX = process.argv[3] ?? 'clear';
const GRID = Number(process.argv[4] ?? 9);
const SEED = Number(process.env.SEED ?? 1);
const race = new Race(track, { mode: 'race', laps: LAPS, difficulty: Number(process.env.DIFF ?? 0.97), playerEntry: entries[4], playerGrid: GRID, entries, weather: planWeather(WX, 'afternoon', LAPS * 85, SEED), seed: SEED });
const auto = new AIDriver(0.975, 0.6, mulberry32((race.seed ^ 0x5eed) >>> 0));
auto.startFrom(race.player.car, track);
race.adoptPlayerAI?.(auto);
race.startLights();
const contactLog = [];
if (process.env.DIAG) {
  const pm = race.pairContact;
  const orig = pm.set.bind(pm);
  pm.set = (k, v) => {
    if (race.raceTime - (pm.get(k) ?? -9) > 1.5) {
      const i = Math.floor(k / 64), j = k % 64;
      const A = race.cars[i], B = race.cars[j];
      const ds = track.delta(A.car.s, B.car.s);
      const [f, r] = ds > 0 ? [A, B] : [B, A];
      contactLog.push({ t: +race.raceTime.toFixed(1), lap: Math.max(A.laps, B.laps), s: Math.round(A.car.s), ds: +Math.abs(ds).toFixed(1), dl: +(A.car.lateral - B.car.lateral).toFixed(2), dv: +(r.car.vx - f.car.vx).toFixed(1), front: f.entry.driver.code, rear: r.entry.driver.code, fErr: f.ai?.err ?? -1, frontSteer: +(f.ai?.offset ?? 0).toFixed(1) });
    }
    return orig(k, v);
  };
}
const L = track.length;
const dt = 1 / 60;
let t = 0;
const onTrack = (c) => !c.retired && !c.finished && c.pit.phase === 'none' && c.pitGhost <= 0 && !c.pitApproach && c.resetGhost <= 0;
// ---- overtakes: a pair of racing cars within 150 m swapping order on the road
const prevAhead = new Map(); // key i*64+j → whether i is ahead of j
let overtakes = 0, otLap1 = 0, otByPlayer = 0, otOnPlayer = 0, otAfterMistake = 0;
const otLap = [];
// ---- gaps
const gaps = [];
let sideBySide = 0, sbsSamples = 0, nose2tail = 0;
let offs = 0;
const hist = [];
let traced = 0;
const prevOff = race.cars.map(() => false);
const lastErr = race.cars.map(() => -99);
let sample = 0;
const pending = [], recent = [];
while (t < LAPS * 160 + 120) {
  {
    const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
    auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
    Object.assign(race.playerInput, auto.input);
  }
  race.update(dt);
  t += dt;
  if (race.phase !== 'racing' && race.phase !== 'finished') continue;
  const cars = race.cars;
  cars.forEach((c, i) => {
    const ai = c.ai ?? (c.isPlayer ? auto : null);
    if (ai && ai.err !== 0 && ai.errOn === 1) lastErr[i] = race.raceTime;
    if (process.env.TRACE) {
      const h = (hist[i] ??= []);
      h.push([+race.raceTime.toFixed(2), Math.round(c.car.s), +c.car.lateral.toFixed(1), +(c.car.vx * 3.6).toFixed(0), +(ai?.input.brake ?? 0).toFixed(2), +(ai?.input.throttle ?? 0).toFixed(2), +(ai?.input.steer ?? 0).toFixed(2), +(ai?.offset ?? 0).toFixed(1), +c.car.dirty.toFixed(2), +(race.profile.at(c.car.s) * 3.6).toFixed(0), +(track.racingLineAt(c.car.s) * 0.9).toFixed(1)]);
      if (h.length > 90) h.shift();
    }
    if (c.car.offTrack && !prevOff[i] && c.car.speed > 15) {
      offs++;
      if (process.env.TRACE && traced < 3 && race.raceTime > 100 && !c.isPlayer) {
        traced++;
        console.log('TRACE', c.entry.driver.code, 'hw', track.halfWidthAt(c.car.s).toFixed(1), '[t, s, lat, kmh, brake, thr, steer, offset, dirty, profileKmh, line]');
        for (const r of hist[i].filter((_, k) => k % 6 === 0)) console.log('  ', JSON.stringify(r));
      }
      if (process.env.DIAG) console.log('O', JSON.stringify({ t: +race.raceTime.toFixed(1), lap: c.laps, s: Math.round(c.car.s), lat: +c.car.lateral.toFixed(1), v: Math.round(c.car.vx), code: c.entry.driver.code, err: ai?.err ?? -1, off: +(ai?.offset ?? 0).toFixed(1), near: race.cars.filter((o) => o !== c && Math.abs(track.delta(c.car.s, o.car.s)) < 12).length }));
    }
    prevOff[i] = c.car.offTrack;
  });
  if (++sample % 6 !== 0) continue; // 10 Hz
  const leaderLap = race.leaderLaps;
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (!onTrack(a)) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      const key = i * 64 + j;
      if (!onTrack(b) || Math.abs(a.raceDist - b.raceDist) > 150) { prevAhead.delete(key); continue; }
      const ahead = a.raceDist > b.raceDist;
      const was = prevAhead.get(key);
      prevAhead.set(key, ahead);
      if (was === undefined || was === ahead || race.raceTime < 1) continue;
      // a swap: who passed whom
      const passer = ahead ? a : b, passed = ahead ? b : a;
      // (a tiny back-and-forth while two cars run side by side counts once: require the pass to stick 1.5 s)
      pending.push({ passer, passed, at: race.raceTime, lap: Math.max(0, passed.laps + 1) });
    }
  }
  for (let k = pending.length - 1; k >= 0; k--) {
    const p = pending[k];
    if (race.raceTime - p.at < 1.5) continue;
    pending.splice(k, 1);
    if (!onTrack(p.passer) || !onTrack(p.passed) || p.passer.raceDist <= p.passed.raceDist) continue;
    // the same pair swapped back and forth inside the window: count once
    const dupe = recent.find((r) => r.a === p.passer.id && r.b === p.passed.id && p.at - r.at < 4);
    if (dupe) continue;
    recent.push({ a: p.passer.id, b: p.passed.id, at: p.at });
    overtakes++;
    otLap[p.lap] = (otLap[p.lap] ?? 0) + 1;
    if (p.lap <= 1) otLap1++;
    if (p.passer.isPlayer) otByPlayer++;
    if (p.passed.isPlayer) otOnPlayer++;
    if (p.at - lastErr[p.passed.id] < 6) otAfterMistake++;
  }
  // gaps & side by side, once the field has done a lap (the start compresses everything)
  if (leaderLap >= 1 && sample % 60 === 0) {
    const run = cars.filter(onTrack).sort((x, y) => y.raceDist - x.raceDist);
    for (let k = 1; k < run.length; k++) {
      const c = run[k];
      const d = run[k - 1].raceDist - c.raceDist;
      if (d > L * 0.5) continue;
      const g = d / Math.max(20, c.car.vx);
      gaps.push(g);
      if (d < 12) nose2tail++;
    }
    for (let k = 1; k < run.length; k++) {
      sbsSamples++;
      const a = run[k - 1], b = run[k];
      if (Math.abs(track.delta(b.car.s, a.car.s)) < 5 && Math.abs(a.car.lateral - b.car.lateral) < 3.2) sideBySide++;
    }
  }
  if (race.cars.every((c) => c.finished || c.retired)) break;
}
const sorted = gaps.slice().sort((a, b) => a - b);
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? NaN;
const share = (x) => gaps.filter((g) => g < x).length / Math.max(1, gaps.length);
// lap-time spread: each car's median clean lap (no lap 1, nothing 7% off its best: no stops, no big moments)
const meds = [];
for (const c of race.cars) {
  const laps = c.lapTimes.slice(1);
  if (!laps.length || c.retired) continue;
  const best = Math.min(...laps);
  const clean = laps.filter((x) => x < best * 1.07).sort((a, b) => a - b);
  meds.push(clean[clean.length >> 1]);
}
meds.sort((a, b) => a - b);
const fin = race.cars.filter((c) => c.finished).map((c) => c.finishTime).sort((a, b) => a - b);
let dmg = 0;
for (const c of race.cars) dmg += 1 - c.car.integrity;
const inc = race.incidents;
const out = {
  track: track.def.id, seed: SEED, laps: LAPS, wx: WX,
  overtakes, otLap1, otByPlayer, otOnPlayer, otAfterMistake,
  otPerLap: otLap.map((x) => x ?? 0),
  gapMed: +q(0.5).toFixed(2), gapP25: +q(0.25).toFixed(2), under1s: +share(1).toFixed(2), under05s: +share(0.5).toFixed(2), under2s: +share(2).toFixed(2),
  nose2tail: +(nose2tail / Math.max(1, gaps.length)).toFixed(3), sideBySide: +(sideBySide / Math.max(1, sbsSamples)).toFixed(3),
  contacts: inc.contacts ?? NaN, hardContacts: inc.hardContacts ?? NaN, damage: +dmg.toFixed(2),
  retired: race.cars.filter((c) => c.retired).length, mistakes: inc.mistakes, spins: inc.spins, offs,
  lapBest: +meds[0].toFixed(2), lapSpread: +(meds[meds.length - 1] - meds[0]).toFixed(2), lapSpreadP80: +(meds[Math.floor(meds.length * 0.8)] - meds[0]).toFixed(2),
  finishSpread: +(fin[fin.length - 1] - fin[0]).toFixed(1), winner: race.classification()[0].entry.driver.code, player: race.player.position,
};
if (process.env.DIAG) for (const x of contactLog) console.log('C', JSON.stringify(x));
if (process.env.DIAG) for (const c of race.cars) {
  const laps = c.lapTimes.map((x) => x.toFixed(1)).join(' ');
  console.log(c.entry.driver.code.padEnd(4), (c.ai ? c.ai.pace : 0).toFixed(4), 'int', c.car.integrity.toFixed(2), 'pos', c.position, 'laps', laps, c.isPlayer ? '(player)' : '');
}
if (process.env.JSON) console.log('JSON ' + JSON.stringify(out));
else for (const [k, v] of Object.entries(out)) console.log(k.padEnd(14), Array.isArray(v) ? v.join(' ') : v);
