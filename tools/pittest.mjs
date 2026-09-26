// Headless pit-stop check: a full race with every car on AI (the player on autopilot, boxing on a lap),
// then: did every AI stop, how long were the stops, and were they clean (no car overlapping another in the
// pit lane, no contacts at the entry / exit).
//   node tools/pittest.mjs [track=monza] [laps=10] [weather=clear] [playerPitLap=4]
import { Track } from '../src/world/Track.ts';
import { CIRCUITS } from '../src/world/Circuits.ts';
import { planWeather } from '../src/world/Weather.ts';
import { Race } from '../src/race/Race.ts';
import { allEntries } from '../src/race/Teams.ts';
import { AIDriver } from '../src/sim/AIDriver.ts';
// reproducible runs (stop times, sticky nuts, AI randomness): SEED=n
{
  let a = Number(process.env.SEED ?? 3) * 2654435761 >>> 0;
  Math.random = function mulberry() { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const [trackId = 'monza', lapsArg = '10', wx = 'clear', ppl = '4'] = process.argv.slice(2);
const LAPS = Number(lapsArg);
const track = new Track(CIRCUITS.find((c) => c.id === trackId) ?? CIRCUITS[0]);
const entries = allEntries();
const race = new Race(track, { mode: 'race', laps: LAPS, difficulty: 0.97, playerEntry: entries[4], playerGrid: 9, entries, weather: planWeather(wx, 'afternoon', LAPS * 90, Number(process.env.SEED ?? 3)) });
const auto = new AIDriver(0.985, 0.6);
auto.startFrom(race.player.car, track);
race.startLights();
const pit = race.pitLane;
const p = track.pit;
const dt = 1 / 60;
const stats = new Map();
for (const c of race.cars) stats.set(c.id, { stops: [], lane: [], inAt: -1, stopT: 0, maxDecel: 0, entryV: 0 });
let laneOverlaps = 0, ghostOverlaps = 0, pitContacts = 0, contactsAll = 0;
const contactLog = [];
const laneLog = [];
const ghostSeen = new Set();
const near = (a, b) => {
  // overlap of two car footprints (5.5 × 1.9 m) by separating axes on their headings
  const dx = b.x - a.x, dz = b.z - a.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > 36) return false;
  const fa = [Math.sin(a.yaw), Math.cos(a.yaw)], fb = [Math.sin(b.yaw), Math.cos(b.yaw)];
  const axes = [fa, [fa[1], -fa[0]], fb, [fb[1], -fb[0]]];
  const half = (f, ax) => 2.75 * Math.abs(f[0] * ax[0] + f[1] * ax[1]) + 0.95 * Math.abs(f[1] * ax[0] - f[0] * ax[1]);
  for (const ax of axes) {
    const dist = Math.abs(dx * ax[0] + dz * ax[1]);
    if (dist > half(fa, ax) + half(fb, ax)) return false;
  }
  return true;
};
const lastPit = new Map();
let t = 0;
const tEnd = LAPS * 140 + 120;
while (t < tEnd) {
  if (race.player.pit.phase === 'none') {
    // (the race's own neighbour list: pit-exit / pit-entry flags included, as the AI cars see them)
    const neigh = race.neighbours?.length ? race.neighbours : race.cars.map((c) => ({ id: c.id, s: c.car.s, lateral: c.car.lateral, speed: c.car.vx }));
    auto.update(dt, race.player.car, track, race.profile, race.phase === 'racing' || race.phase === 'finished', neigh, race.player.id);
    Object.assign(race.playerInput, auto.input);
  }
  if (race.player.pit.phase !== 'none') auto.startFrom(race.player.car, track);
  if (Number(ppl) > 0 && race.player.laps + 1 === Number(ppl) && race.player.stops === 0) race.playerPitRequest = true;
  for (const c of race.cars) c.contactTimer = 0;
  const wasPh = race.cars.map((c) => c.pit.phase);
  race.update(dt);
  t += dt;
  for (const c of race.cars) {
    const st = stats.get(c.id);
    const ph = c.pit.phase;
    if (ph !== 'none') lastPit.set(c.id, t);
    if (wasPh[c.id] === 'none' && ph === 'in') { st.inAt = t; st.entryV = c.car.vx * 3.6; }
    if (wasPh[c.id] === 'stop' && ph === 'out') st.stops.push(c.pit.timer);
    if (wasPh[c.id] !== 'none' && ph === 'none') st.lane.push(t - st.inAt);
    if (ph === 'in') st.maxDecel = Math.max(st.maxDecel, -c.pit.a);
    if (c.contactTimer > 0) {
      contactsAll++;
      const recent = (lastPit.has(c.id) && t - lastPit.get(c.id) < 8) || c.pitApproach;
      if (recent) {
        pitContacts++;
        if (contactLog.length < 16) contactLog.push(`t=${t.toFixed(1)} ${c.entry.driver.code} with ${(() => { let b = null, bd = 1e9; for (const o of race.cars) { if (o === c) continue; const d = Math.hypot(o.car.x - c.car.x, o.car.z - c.car.z); if (d < bd) { bd = d; b = o; } } return b ? `${b.entry.driver.code}(s${b.car.s.toFixed(0)} l${b.car.lateral.toFixed(1)} v${(b.car.vx * 3.6).toFixed(0)} ph=${b.pit.phase} ghost=${b.pitGhost.toFixed(1)} tgt=${b.ai?.targetOffset.toFixed(1)} off=${b.ai?.offset.toFixed(1)})` : '-'; })()} self(tgt=${c.ai?.targetOffset.toFixed(1)} off=${c.ai?.offset.toFixed(1)} yield=${c.ai?.yieldSide}) s=${c.car.s.toFixed(0)} lat=${c.car.lateral.toFixed(1)} v=${(c.car.vx*3.6).toFixed(0)} ph=${ph} ghost=${c.pitGhost.toFixed(1)} approach=${c.pitApproach} sinceRelease=${lastPit.has(c.id) ? (t - lastPit.get(c.id)).toFixed(1) : '-'}`);
      }
    }
  }
  // overlaps: pit lane (both scripted) and ghost pass-throughs (one scripted/ghost, one racing)
  const cs = race.cars.filter((c) => !c.removed);
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const A = cs[i], B = cs[j];
      const aPit = A.pit.phase !== 'none', bPit = B.pit.phase !== 'none';
      const aG = aPit || A.pitGhost > 0 || A.pitApproach, bG = bPit || B.pitGhost > 0 || B.pitApproach;
      if (!aG && !bG) continue;
      if (!near(A.car, B.car)) continue;
      if (aPit && bPit) {
        laneOverlaps++;
        if (laneLog.length < 10 && (laneLog.length === 0 || !laneLog[laneLog.length - 1].includes(A.entry.driver.code))) laneLog.push(`LANE t=${t.toFixed(1)} ${A.entry.driver.code}(${A.pit.phase} s${A.pit.s.toFixed(0)} l${A.pit.lat.toFixed(1)}) ${B.entry.driver.code}(${B.pit.phase} s${B.pit.s.toFixed(0)} l${B.pit.lat.toFixed(1)})`);
      } else {
        ghostOverlaps++;
        const G = aG ? A : B, R = aG ? B : A;
        const key = G.entry.driver.code + R.entry.driver.code;
        if (!ghostSeen.has(key) && ghostSeen.size < 14) {
          ghostSeen.add(key);
          contactLog.push(`GHOST t=${t.toFixed(1)} ${G.entry.driver.code}(${G.pit.phase} s${G.car.s.toFixed(0)} l${G.car.lateral.toFixed(1)} v${(G.car.vx * 3.6).toFixed(0)} ghost${G.pitGhost.toFixed(1)} appr${G.pitApproach}) vs ${R.entry.driver.code}(s${R.car.s.toFixed(0)} l${R.car.lateral.toFixed(1)} v${(R.car.vx * 3.6).toFixed(0)})`);
        }
      }
    }
  if (race.cars.every((c) => c.finished || c.retired)) break;
}
console.log(`${trackId} ${LAPS} laps ${wx}: sim ${t.toFixed(0)} s, takeover ${pit.takeoverS.toFixed(0)} pit ${p.sStart}-${p.sEnd} release ${pit.releaseS.toFixed(0)}`);
let noStop = 0;
for (const c of race.cars) {
  const st = stats.get(c.id);
  if (!c.isPlayer && c.stops === 0 && !c.retired) noStop++;
  console.log(`${c.entry.driver.code}${c.isPlayer ? '*' : ' '} P${String(c.position).padStart(2)} stops ${c.stops} plan[${c.pitPlan.join(',')}] ${c.compoundsUsed.join('>')} stationary ${st.stops.map((x) => x.toFixed(2)).join(' ')} lane ${st.lane.map((x) => x.toFixed(1)).join(' ')} entry ${st.entryV.toFixed(0)}km/h maxDecel ${st.maxDecel.toFixed(1)} wear ${Math.round((1 - race.wearOf(c)) * 100)}%${c.retired ? ' RET' : ''} pen ${c.penalty}`);
}
console.log(`AI without a stop: ${noStop}; pit-lane overlaps (frames): ${laneOverlaps}; ghost pass-through frames: ${ghostOverlaps}; contacts near a stop: ${pitContacts} (all contacts ${contactsAll})`);
for (const l of contactLog) console.log('  ', l);
for (const l of laneLog) console.log('  ', l);
