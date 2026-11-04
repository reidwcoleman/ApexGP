// Tracksmith: the handling in numbers, on a long flat road. Run after any change to sim.ts.
//   node --experimental-transform-types --no-warnings tools/tsfeel.mjs
import { initPhysics, Sim, DT } from '../src/tracksmith/sim.ts';
import { buildDSL } from '../src/tracksmith/track.ts';

await initPhysics();
const flat = () => {
  const { pieces } = buildDSL('S340');
  return new Sim({ id: 'x', name: 'x', author: '', theme: 0, pieces });
};
const run = (f, secs = 30) => {
  const s = flat();
  let out = null;
  for (let i = 0; i < secs / DT && !out; i++) out = f(s, i * DT);
  s.free();
  return out;
};
const go = { throttle: 1, brake: 0, steer: 0, hand: false };
const at = (kmh) => run((s, t) => { s.step(go); return s.kmh >= kmh ? t.toFixed(2) + 's' : null; });
console.log('0-100', at(100), ' 0-200', at(200));
console.log('top speed', run((s, t) => { s.step(go); return t > 28 ? s.kmh.toFixed(0) + ' km/h' : null; }));
console.log('100-0', run((s, t) => { if (!s.m) { s.step(go); if (s.kmh >= 100) s.m = t; return null; } s.step({ throttle: 0, brake: 1, steer: 0, hand: false }); return s.speed < 0.5 ? (t - s.m).toFixed(2) + 's' : null; }));
// steering: 0.5 s after a full lock at 150 km/h, how far the heading has moved, and the grip
for (const kmh of [80, 150, 220]) {
  console.log(`steer @${kmh}`, run((s, t) => {
    if (!s.m) { s.step(go); if (s.kmh >= kmh) { s.m = t; s.y0 = Math.atan2(s.getState().v[0], s.getState().v[2]); } return null; }
    s.step({ throttle: 1, brake: 0, steer: 1, hand: false });
    if (t - s.m < 0.5) return null;
    const v = s.getState().v;
    return `heading ${(Math.abs(Math.atan2(v[0], v[2]) - s.y0) * 57.3).toFixed(0)} deg in 0.5 s, ${s.kmh.toFixed(0)} km/h`;
  }));
}
// the slide's worth: a 90 degree turn from the same speed, gripping and drifting, then one second on
for (const kmh of [120, 170]) {
  const turn = (drift) => {
    const s = flat();
    let phase = 0, y0 = 0, t0 = 0, p0 = null, paid = 0, res = '';
    for (let i = 0; i < 20 / DT; i++) {
      const st = s.getState(), t = i * DT;
      const head = Math.atan2(st.v[0], st.v[2]);
      if (phase === 0) { s.step({ throttle: 1, brake: 0, steer: 0, hand: false }); if (s.kmh >= kmh) { phase = 1; y0 = head; t0 = t; p0 = st.p; } continue; }
      if (phase === 1) {
        s.step({ throttle: 1, brake: 0, steer: 1, hand: drift });
        if (Math.abs(head - y0) >= Math.PI / 2) { phase = 2; t0 = t - t0; res = `90 deg in ${t0.toFixed(2)} s, wide ${Math.hypot(st.p[0] - p0[0], st.p[2] - p0[2]).toFixed(0)} m, leaves at ${s.kmh.toFixed(0)}`; p0 = t; }
        continue;
      }
      s.step({ throttle: 1, brake: 0, steer: 0, hand: false });
      for (const e of s.events) if (e.type === 'drift') paid = e.k;
      s.events.length = 0;
      if (t - p0 >= 1) { res += `, 1 s later ${s.kmh.toFixed(0)} km/h (payout ${paid.toFixed(2)})`; break; }
    }
    s.free();
    return res;
  };
  console.log(`@${kmh} grip :`, turn(false));
  console.log(`@${kmh} drift:`, turn(true));
}
