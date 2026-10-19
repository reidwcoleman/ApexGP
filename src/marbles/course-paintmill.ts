import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, type Cmd } from './builder.ts';
import { arch, bumper, bunting, doorWall, hammer, kicker, peg, slider, startGate } from './obstacles.ts';
import { Pattern } from './shaders.ts';
import { flippers, rollers, turnstile } from './obs-spin.ts';
import { axe } from './obs-swing.ts';
import { floorBand } from './obs-kit.ts';
import { checkpoints, endWall, finishDressing, lakeBelow, raceRecord, split, tag, turntableGap } from './course-kit.ts';
import type { Course } from './courses.ts';

/**
 * Round 2, Paint Mill: the machine room. Hammer alley, a pinball table that drains through a pair
 * of flippers, the paint turntable, a conveyor that runs back up at you, the sliders, the split (a
 * narrow lane of booster rollers with a slider to time, or the door lane), the turnstile pair, the
 * big spinner, the door wall, a jump over the paint vat, the switchbacks, the drop and the axes,
 * and a spiral down to the line. Right-hand corners coil it round on itself.
 */
export function paintmill(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const cmds: Cmd[] = [
    { len: 24, slope: 1.5, w: 17, wall: 1.6, tag: 'start' },
    { len: 14, slope: 6, w: 11, easeW: 7 },
    { len: 62, slope: 3.5, w: 11, wall: 1.5, tag: 'hammers' },
    { len: 28, turn: 90, slope: 5, w: 10, wall: 1.9 },
    { len: 10, slope: 4, w: 16, easeW: 5, wall: 2.2, tag: 'pre-bumpers' },
    { len: 40, slope: 5, w: 16, tag: 'bumpers' },
    { len: 12, slope: 3, w: 9.5, easeW: 6, wall: 1.8, tag: 'neck' },
    { len: 14, slope: 3, w: 11, easeW: 3 },
    { len: 5, slope: 1, w: 17.4, easeW: 2 },
    { len: 17, slope: 0, w: 17.4, floor: false, tag: 'turntable' },
    { len: 5, slope: 2, w: 12, easeW: 3 },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    { len: 8, slope: 0, w: 10, wall: 1.8, bank: 0, tag: 'pre-conveyor' },
    { len: 26, slope: -2.5, w: 10, wall: 1.8, bank: 0, deck: false, tag: 'conveyor' },
    { len: 8, slope: 2, w: 12 },
    { len: 50, slope: 3, w: 12, tag: 'sliders' },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    // the split: the roller beam (fast, bare) or the door lane
    { len: 14, slope: 2.5, w: 18, wall: 1.6, easeW: 5, bank: 0, tag: 'pre-split' },
    { len: 48, slope: 2, w: 18, floor: false, bank: 0, tag: 'split' },
    { len: 10, slope: 3, w: 12, easeW: 5 },
    { len: 26, turn: 45, slope: 4, w: 11, wall: 1.9 },
    { len: 44, slope: 3, w: 12, tag: 'turnstiles' },
    { len: 5, slope: 1, w: 17.4, easeW: 2 },
    { len: 17, slope: 0, w: 17.4, floor: false, tag: 'spinner' },
    { len: 5, slope: 2, w: 13, easeW: 3 },
    { len: 24, slope: 1, w: 14, easeW: 4, tag: 'doors' },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    { len: 22, slope: 3, w: 11, tag: 'kick' },
    { len: 8, slope: 10, floor: false, tag: 'gap' },
    { len: 14, slope: 4, w: 14, tag: 'land' },
    // the switchbacks
    { len: 8, slope: 4, w: 10, wall: 2.4, tag: 'switch' },
    { len: 42, turn: 180, slope: 5, w: 10, wall: 2.4 },
    { len: 10, slope: 4 },
    { len: 42, turn: -180, slope: 5 },
    { len: 8, slope: 3, w: 11, wall: 1.8, tag: 'switch-end' },
    { len: 26, slope: 16, w: 10, wall: 2.0, tag: 'drop' },
    { len: 12, slope: 2, w: 11, wall: 1.6 },
    { len: 52, slope: 3, w: 11, wall: 1.6, tag: 'axes' },
    { len: 10, slope: 5, w: 9.5, easeW: 5, wall: 2.4 },
    { len: 200, turn: 660, slope: 6, w: 9.5, wall: 2.4, bank: 22, tag: 'helix' },
    { len: 30, slope: 2, w: 12, wall: 1.8, tag: 'finish' },
    { len: 18, slope: -7, w: 16, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 175, 0), 0.4, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  const state = { go: 1e9 };
  const [st0] = tag(path, 'start');
  const gateS = st0 + 17;
  startGate(b, path, gateS, state);
  arch(b, path, gateS + 2.5, info.name.toUpperCase(), { color: PAINT.purple, text2: 'Round 2 · Race' });
  const warn = b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 1.2, wear: 0.05 });

  // hammer alley
  const [h0] = tag(path, 'hammers');
  const hc = [PAINT.red, PAINT.blue, PAINT.green, PAINT.orange, PAINT.purple];
  [9, 20, 31, 42, 53].forEach((ds, k) => hammer(b, path, h0 + ds, { amp: 1.05, period: 2.5 + (k % 3) * 0.25, phase: k * 1.7, color: hc[k] }));

  // the pinball table: rows of bumpers, draining through the flippers
  const [bm0] = tag(path, 'bumpers');
  const rows: number[][] = [[-4.5, 0, 4.5], [-6.2, -2.25, 2.25, 6.2], [-4.5, 0, 4.5], [-2.25, 2.25]];
  const bcol = [PAINT.pink, PAINT.teal, PAINT.yellow, PAINT.purple];
  rows.forEach((r, k) => r.forEach((lat) => bumper(b, path, bm0 + 6 + k * 8.5, lat, { color: bcol[k] })));
  const [n0, n1] = tag(path, 'neck');
  flippers(b, path, n1 - 1.5, { period: 2.4 });

  // the paint turntable fills its gap
  const [t0, t1] = tag(path, 'turntable');
  turntableGap(b, path, t0, t1, { omega: 0.75, fins: 2 });

  // the conveyor: rollers running back up the slope at you
  const [cv0, cv1] = tag(path, 'conveyor');
  rollers(b, path, cv0 - 0.3, cv1 + 0.3, { speed: -4.5, colors: [PAINT.red, PAINT.white] });
  floorBand(b, path, cv0 - 1.3, 0.8, warn);

  // the sliders
  const [sl0] = tag(path, 'sliders');
  [8, 17, 26, 35, 44].forEach((ds, k) => slider(b, path, sl0 + ds, { period: 2.8 + (k % 3) * 0.3, phase: k * 1.9, color: [PAINT.orange, PAINT.green, PAINT.blue, PAINT.red, PAINT.yellow][k] }));

  // the split: a narrow lane of booster rollers (and a slider to time at the end of it), or the
  // wide lane through a door wall
  const [spl0, spl1] = tag(path, 'split');
  const L = spl1 - spl0;
  const lanes = split(b, path, spl0, spl1, { fastLat: -5.0, fastW: 4.4, safeLat: 3.6, safeW: 8.0, safeWall: 1.6, fastSect: (s) => ({ wallL: 2.8, wallR: 2.8, deck: s < 8 || s > L - 14 }) });
  rollers(b, lanes.fast, 7.7, L - 13.7, { speed: 12, colors: [PAINT.yellow, PAINT.red] });
  slider(b, lanes.fast, L - 7, { period: 2.2, size: 1.8, color: PAINT.purple });
  doorWall(b, lanes.safe, 22, { doors: 3, seed: 5 });
  for (const lat of [-2, 2]) peg(b, lanes.safe, 36, lat, { paint: { a: PAINT.orange, b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } });

  // the turnstile pair, turning opposite ways, with pegs between
  const [ts0] = tag(path, 'turnstiles');
  turnstile(b, path, ts0 + 11, { arms: 4, omega: 0.85, height: 0.95, color: PAINT.teal });
  turnstile(b, path, ts0 + 32, { arms: 3, omega: -1.0, height: 0.95, color: PAINT.pink, phase: 0.6 });
  for (const lat of [-4.2, 0, 4.2]) peg(b, path, ts0 + 21.5, lat, { paint: { a: PAINT.yellow, b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } });

  // the big spinner: three fins, the other way round
  const [sp0, sp1] = tag(path, 'spinner');
  turntableGap(b, path, sp0, sp1, { omega: -0.95, fins: 3 });

  const [d0, d1] = tag(path, 'doors');
  doorWall(b, path, (d0 + d1) / 2, { doors: 5, seed: 7 });

  // the jump over the vat
  const [, k1] = tag(path, 'kick');
  kicker(b, path, k1, { len: 5, h: 1.0 });
  const [g0, g1] = tag(path, 'gap');

  // the axes after the drop
  const [a0] = tag(path, 'axes');
  [10, 22, 34, 46].forEach((ds, k) => axe(b, path, a0 + ds, { amp: 0.9, period: 2.6 + (k % 2) * 0.35, phase: k * 2.2, color: [PAINT.red, PAINT.blue, PAINT.green, PAINT.orange][k] }));

  const [f0] = tag(path, 'finish');
  const fs = f0 + 17;
  finishDressing(b, path, fs);
  const [, c1] = tag(path, 'catch');
  bunting(b, path, 0, 90);
  bunting(b, path, f0 - 10, c1);
  endWall(b, path, c1 - 0.5);
  b.finish();

  const [pb] = tag(path, 'pre-bumpers');
  const [pc] = tag(path, 'pre-conveyor');
  const [dr0] = tag(path, 'drop');
  const [psp] = tag(path, 'pre-split');
  const [sw0] = tag(path, 'switch');
  const [swe] = tag(path, 'switch-end');
  const [hx0] = tag(path, 'helix');
  return raceRecord(b, path, {
    id: 'paintmill',
    name: info.name,
    kind: 'race',
    blurb: info.blurb,
    gateS,
    finishS: fs,
    gaps: [[g0, g1]],
    checkpoints: checkpoints(gateS, [h0 + 2, h0 + 66, pb + 3, n0 + 22, t1 + 8, pc + 3, cv1 + 6, sl0 + 52, psp + 3, spl1 + 6, ts0 + 2, sp1 + 4, d1 + 10, sw0 - 4, swe + 2, dr0 + 32, a0 + 54, hx0 + 70, hx0 + 140]),
    state,
  });
}
