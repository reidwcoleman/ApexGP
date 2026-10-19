import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, type Cmd } from './builder.ts';
import { arch, bumper, bunting, frameQuat, kicker, peg, startGate, sweeper } from './obstacles.ts';
import { Pattern } from './shaders.ts';
import { rollers, turnstile, windmill } from './obs-spin.ts';
import { logRoll } from './obs-move.ts';
import { floorBand } from './obs-kit.ts';
import { checkpoints, endWall, finishDressing, lakeBelow, raceRecord, split, tag, turntableGap } from './course-kit.ts';
import type { Course } from './courses.ts';

/**
 * Round 1, Timber Tumble: the warm-up that teaches everything. A fast swooping descent, the peg
 * forest, logs rolling across an open bridge, the big jump, the sweeper meadow and its turnstile,
 * the split (a bare beam straight through, or the long way round the bumpers), the windmills, the
 * switchbacks, the spinning floor, a cascade of drops, a booster bed and the great spiral down to
 * the line.
 */
export function timber(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const cmds: Cmd[] = [
    { len: 24, slope: 1.5, w: 17, wall: 1.6, tag: 'start' },
    { len: 18, slope: 7, w: 11, easeW: 8 },
    // the swoop: fast banked esses
    { len: 34, turn: -55, slope: 8, w: 11, wall: 1.8 },
    { len: 36, turn: 70, slope: 8, w: 11 },
    { len: 22, slope: 5, w: 12, tag: 'pre-pegs' },
    { len: 64, slope: 6, w: 13, tag: 'pegs' },
    { len: 30, turn: 85, slope: 5, w: 10.5, wall: 2.0 },
    // the log bridge: the walls drop away
    { len: 16, slope: 2, w: 11, wall: 1.6, tag: 'pre-logs' },
    { len: 22, slope: 1.5, w: 11, wall: 0, tag: 'logs' },
    { len: 12, slope: 2, w: 11, wall: 1.6 },
    { len: 34, turn: 95, slope: 6, w: 10.5, wall: 2.0 },
    // the big jump
    { len: 22, slope: 5, w: 11, wall: 1.6, tag: 'kick' },
    { len: 7, slope: 12, floor: false, tag: 'gap' },
    { len: 14, slope: 4, w: 15, tag: 'land' },
    { len: 60, slope: 2.5, w: 15, tag: 'sweep' },
    { len: 28, turn: 80, slope: 5, w: 12, wall: 1.9 },
    // the split
    { len: 14, slope: 3, w: 18, wall: 1.6, easeW: 5, tag: 'pre-split' },
    { len: 52, slope: 3, w: 18, floor: false, tag: 'split' },
    { len: 10, slope: 3, w: 12, easeW: 5 },
    { len: 32, turn: 90, slope: 5, w: 11, wall: 1.9 },
    { len: 46, slope: 3, w: 11, wall: 1.8, tag: 'mills' },
    // the switchbacks: two hairpins
    { len: 8, slope: 4, w: 10, wall: 2.4, tag: 'switch' },
    { len: 42, turn: -180, slope: 5, w: 10, wall: 2.4 },
    { len: 10, slope: 4 },
    { len: 42, turn: 180, slope: 5 },
    { len: 10, slope: 3, w: 12, wall: 1.8, tag: 'switch-end' },
    // the spinning floor
    { len: 5, slope: 1, w: 17.4, easeW: 2 },
    { len: 17, slope: 0, w: 17.4, floor: false, tag: 'spin' },
    { len: 5, slope: 2, w: 13, easeW: 3 },
    // the cascade: three sharp steps down
    { len: 14, slope: 3, w: 13, wall: 1.6, easeW: 4, tag: 'cascade' },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 9, slope: 3, easeS: 0.4 },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 9, slope: 3, easeS: 0.4 },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 12, slope: 3, easeS: 0.4, tag: 'cascade-end' },
    { len: 30, turn: 90, slope: 5, w: 10.5, wall: 2.0 },
    { len: 12, slope: 2, w: 10, wall: 1.8, bank: 0 },
    { len: 26, slope: 1, w: 10, wall: 1.8, bank: 0, deck: false, tag: 'rollers' },
    { len: 10, slope: 5, w: 9.5, easeW: 5, wall: 2.4 },
    { len: 230, turn: 780, slope: 6.5, w: 9.5, wall: 2.4, bank: 22, tag: 'helix' },
    { len: 34, slope: 3, w: 12, wall: 1.8, tag: 'finish' },
    { len: 20, slope: -7, w: 16, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 190, 0), 0, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  const state = { go: 1e9 };
  const [st0] = tag(path, 'start');
  const gateS = st0 + 17;
  startGate(b, path, gateS, state);
  arch(b, path, gateS + 2.5, info.name.toUpperCase(), { color: PAINT.blue, text2: 'Round 1 · Race' });
  const warn = b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 1.2, wear: 0.05 });

  // the peg forest: staggered rows, a few bumpers in the thick of it
  const [p0, p1] = tag(path, 'pegs');
  let row = 0;
  for (let s = p0 + 5; s < p1 - 4; s += 3.5, row++) {
    for (let k = -2; k <= 2; k++) {
      const lat = k * 3 + (row % 2 ? 1.5 : 0);
      if (Math.abs(lat) > 5.4) continue;
      if (row % 4 === 2 && k === 0) {
        bumper(b, path, s, lat, { color: PAINT.teal, r: 0.7 });
        continue;
      }
      peg(b, path, s, lat, { paint: { a: row % 3 === 0 ? PAINT.red : row % 3 === 1 ? PAINT.blue : PAINT.green, b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } });
    }
  }

  // the log bridge
  const [l0, l1] = tag(path, 'logs');
  floorBand(b, path, l0 - 1, 0.8, warn);
  logRoll(b, path, (l0 + l1) / 2 - 2, { side: 1, logs: 3, speed: 3.3, r: 0.5, len: 4.6, color: PAINT.red });
  logRoll(b, path, (l0 + l1) / 2 + 5.5, { side: -1, logs: 3, speed: 2.9, r: 0.5, len: 4.6, phase: 1.3, color: PAINT.blue });

  // the kicker and the big jump
  const [, k1] = tag(path, 'kick');
  kicker(b, path, k1, { len: 5, h: 1.05 });
  const [g0, g1] = tag(path, 'gap');

  // the sweeper meadow: two big sweepers and a turnstile between
  const [w0] = tag(path, 'sweep');
  for (const [ds, om, col] of [
    [14, 1.3, PAINT.yellow],
    [46, -1.5, PAINT.orange],
  ] as const) {
    const s = w0 + ds;
    const i = path.index(s);
    sweeper(b, path.P[i].clone(), frameQuat(path, s), { len: 14.4, angle: (t) => om * t + ds, paint: { a: col, b: PAINT.black, pattern: Pattern.Rings, scale: 1.3 } });
  }
  turnstile(b, path, w0 + 30, { arms: 4, omega: 0.8, height: 0.9, color: PAINT.green });

  // the split: the bare beam on the left, the bumper lane on the right
  const [sp0, sp1] = tag(path, 'split');
  const lanes = split(b, path, sp0, sp1, { fastLat: -5.0, fastW: 4.0, safeLat: 3.8, safeW: 7.6, safeWall: 2.0 });
  {
    const sl = lanes.safe;
    const L = sp1 - sp0;
    // zig-zag bumpers and pegs down the safe lane
    for (let k = 0; k < 6; k++) {
      const s = 6 + k * ((L - 16) / 5);
      if (k % 2 === 0) {
        bumper(b, sl, s, -1.8, { color: [PAINT.pink, PAINT.purple, PAINT.yellow][k % 3] });
        peg(b, sl, s + 2.5, 2.3, { r: 0.3, paint: { a: PAINT.purple, b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } });
      } else {
        bumper(b, sl, s, 1.8, { color: [PAINT.pink, PAINT.purple, PAINT.yellow][k % 3] });
        peg(b, sl, s + 2.5, -2.3, { r: 0.3, paint: { a: PAINT.purple, b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } });
      }
    }
  }

  // the windmills
  const [m0] = tag(path, 'mills');
  windmill(b, path, m0 + 14, { blades: 3, omega: 0.8, height: 5.4, paint: { a: PAINT.red, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6 } });
  windmill(b, path, m0 + 34, { blades: 3, omega: -0.9, phase: 1.1, height: 5.4, paint: { a: PAINT.blue, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6 }, hubColor: PAINT.red });

  // the spinning floor
  const [tt0, tt1] = tag(path, 'spin');
  turntableGap(b, path, tt0, tt1, { omega: 0.7, fins: 2 });

  // the booster bed
  const [r0, r1] = tag(path, 'rollers');
  rollers(b, path, r0 - 0.3, r1 + 0.3, { speed: 10, colors: [PAINT.green, PAINT.white] });
  floorBand(b, path, r0 - 1.3, 0.8, warn);

  const [f0] = tag(path, 'finish');
  const fs = f0 + 20;
  finishDressing(b, path, fs);
  const [, c1] = tag(path, 'catch');
  bunting(b, path, 0, 110);
  bunting(b, path, f0 - 10, c1);
  endWall(b, path, c1 - 0.5);
  b.finish();

  const [c0] = tag(path, 'cascade');
  const [ce] = tag(path, 'cascade-end');
  const [pl] = tag(path, 'pre-logs');
  const [pp] = tag(path, 'pre-pegs');
  const [ps] = tag(path, 'pre-split');
  const [h0] = tag(path, 'helix');
  const [sw0] = tag(path, 'switch');
  const [swe] = tag(path, 'switch-end');
  return raceRecord(b, path, {
    id: 'timber',
    name: info.name,
    kind: 'race',
    blurb: info.blurb,
    gateS,
    finishS: fs,
    gaps: [[g0, g1]],
    checkpoints: checkpoints(gateS, [gateS + 60, pp + 4, p1 + 18, pl + 4, l1 + 16, g1 + 6, w0 + 57, ps + 2, sp1 + 14, m0 + 4, sw0 + 2, swe + 2, tt1 + 4, c0 + 2, ce + 4, r0 - 6, h0 + 60, h0 + 130, h0 + 195]),
    state,
  });
}
