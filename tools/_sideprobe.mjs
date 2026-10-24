// Who drives into whom side by side? Logs both cars' racecraft state at each new contact.
//   TRACK=spielberg SEED=1 npx tsx tools/_sideprobe.mjs [laps=3]
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { Race, mulberry32 } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
import { planWeather } from '../src/world/Weather.ts';
const track = new Track(CIRCUITS.find((c) => c.id === (process.env.TRACK ?? 'spielberg')));
const entries = allEntries();
const LAPS = Number(process.argv[2] ?? 3), SEED = Number(process.env.SEED ?? 1);
const race = new Race(track, { mode: 'race', laps: LAPS, difficulty: 0.97, playerEntry: entries[4], playerGrid: 10, entries, weather: planWeather('clear', 'afternoon', LAPS * 85, SEED), seed: SEED });
const auto = new AIDriver(0.975, 0.6, mulberry32((race.seed ^ 0x5eed) >>> 0));
auto.startFrom(race.player.car, track);
race.adoptPlayerAI?.(auto);
race.playerDrsAuto = true;
race.startLights();
const pm = race.pairContact;
const orig = pm.set.bind(pm);
const hist = new Map();
const st = (c) => {
  const ai = c.ai ?? auto;
  return { code: c.entry.driver.code, lat: +c.car.lateral.toFixed(2), v: +c.car.vx.toFixed(1), capL: ai.capL > -1e9 ? +ai.capL.toFixed(2) : null, capR: ai.capR < 1e9 ? +ai.capR.toFixed(2) : null, off: +ai.offset.toFixed(2), inside: ai.inside, vt: +(ai.dbg?.vt ?? 0).toFixed(1), follow: isFinite(ai.dbg?.follow) ? +ai.dbg.follow.toFixed(1) : null, steer: +ai.input.steer.toFixed(3), brake: +ai.input.brake.toFixed(2) };
};
pm.set = (k, v) => {
  if (race.raceTime - (pm.get(k) ?? -9) > 1.5) {
    const i = Math.floor(k / 64), j = k % 64;
    const A = race.cars[i], B = race.cars[j];
    const ds = track.delta(A.car.s, B.car.s);
    const [f, r] = ds > 0 ? [A, B] : [B, A];
    const hf = hist.get(f.id) ?? [], hr = hist.get(r.id) ?? [];
    console.log(JSON.stringify({ t: +race.raceTime.toFixed(1), s: Math.round(A.car.s), ds: +Math.abs(ds).toFixed(2), hw: +track.halfWidthAt(A.car.s).toFixed(1), line: +(track.racingLineAt(A.car.s) * 0.9).toFixed(1) }));
    console.log('  front', JSON.stringify(st(f)), ' lat-0.5s', hf[0]?.lat, 'caps', hf[0]?.capL, hf[0]?.capR);
    console.log('  rear ', JSON.stringify(st(r)), ' lat-0.5s', hr[0]?.lat, 'caps', hr[0]?.capL, hr[0]?.capR);
  }
  return orig(k, v);
};
const dt = 1 / 60;
let t = 0;
while (t < LAPS * 90) {
  const neigh = race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
  auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
  Object.assign(race.playerInput, auto.input);
  race.update(dt);
  t += dt;
  for (const c of race.cars) {
    const h = hist.get(c.id) ?? [];
    h.push(st(c));
    if (h.length > 30) h.shift();
    hist.set(c.id, h);
  }
}
