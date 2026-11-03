// Tracksmith headless autopilot: builds every built-in track, drives it with the autopilot and prints
// the time, falls/respawns and overlaps. Author medal times in src/tracksmith/builtin.ts come from here.
//   node --experimental-transform-types --no-warnings tools/tsbot.mjs [trackId] [--trace]
import { initPhysics, Sim, DT } from '../src/tracksmith/sim.ts';
import { builtinTracks, SPEC_LIST } from '../src/tracksmith/builtin.ts';
import { buildDSL, routeLine } from '../src/tracksmith/track.ts';
import { Autopilot } from '../src/tracksmith/autopilot.ts';

await initPhysics();
const want = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const trace = process.argv.includes('--trace');
const runs = process.argv.includes('--robust') ? 5 : 1;
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const td of builtinTracks()) for (let run = 0; run < runs; run++) {
  if (want && td.id !== want) continue;
  const spec = SPEC_LIST.find((s) => s.id === td.id);
  const { overlaps } = buildDSL(spec.dsl);
  const sim = new Sim(td);
  const line = routeLine(td);
  const ap = new Autopilot(line);
  let falls = 0, maxOff = 0, top = 0, stuck = 0, wasG = true, take = null;
  const jumps = [];
  const limit = 240 / DT;
  let t = 0;
  for (; t < limit && !sim.finished; t++) {
    const s = sim.getState();
    const inp = ap.drive(s.p, s.q, s.v, sim.grounded > 0);
    if (run > 0) { inp.steer = Math.max(-1, Math.min(1, inp.steer + (rnd() - 0.5) * 0.25)); if (rnd() < 0.01 * run) inp.throttle = 0; }
    sim.step(inp);
    const { d } = ap.locate(s.p);
    const g = sim.grounded > 0;
    if (wasG && !g) take = { p: s.p, kmh: sim.kmh };
    if (!wasG && g && take && sim.airT === 0) { const dist = Math.hypot(s.p[0] - take.p[0], s.p[2] - take.p[2]); if (dist > 12) jumps.push(`${take.kmh.toFixed(0)}km/h ${dist.toFixed(0)}m`); take = null; }
    wasG = g;
    maxOff = Math.max(maxOff, d);
    top = Math.max(top, sim.kmh);
    if (trace && t % (process.argv.includes('--fine') ? 12 : 60) === 0) console.log(`  t=${(t * DT).toFixed(1)} p=${s.p.map((x) => x.toFixed(1)).join(',')} kmh=${sim.kmh.toFixed(0)} off=${d.toFixed(1)} prog=${(ap.progress() * 100).toFixed(0)}% g=${sim.grounded}`);
    if (sim.started && ((sim.grounded > 0 && d > 7) || sim.airT > 5)) {
      falls++;
      sim.respawn();
      ap.reset();
      ap.locate(sim.getState().p);
    }
    if (sim.started && sim.speed < 1) { if (++stuck > 600) break; } else stuck = 0;
  }
  const time = sim.finished ? (sim.ticks * DT).toFixed(3) + 's' : 'DNF @' + (ap.progress() * 100).toFixed(0) + '%';
  if (process.argv.includes('--jumps') && jumps.length) console.log('   jumps: ' + jumps.join(' | '));
  console.log(`${td.id}${runs > 1 ? '#' + run : ''} ${td.name.padEnd(12)} ${time.padEnd(10)} cps ${sim.passed.size}/${sim.checks.length} falls ${falls} maxOff ${maxOff.toFixed(1)} top ${top.toFixed(0)} km/h pieces ${td.pieces.length}${overlaps.length ? ' OVERLAPS ' + overlaps.join('; ') : ''}`);
  sim.free();
}
