import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, cylAttr, type Cmd } from './builder.ts';
import { arch, bumper, bunting, doorWall, frameQuat, hammer, kicker, slider, startGate, sweeper } from './obstacles.ts';
import { Kin, Mat } from './physics.ts';
import { Pattern } from './shaders.ts';
import { flippers, rollers, turnstile, windmill } from './obs-spin.ts';
import { axe, wreckingBall } from './obs-swing.ts';
import { logRoll, slideBridge } from './obs-move.ts';
import { Parts, band, boltRing, floorBand, mat } from './obs-kit.ts';
import { checkpoints, endWall, finishDressing, lakeBelow, makeCrown, raceRecord, split, tag, turntableGap } from './course-kit.ts';
import type { Course } from './courses.ts';

/**
 * The final, Crown Summit: everything at once, and first over the line takes the crown. The bare
 * beam, the spinner between bumpers, hammer alley, the log bridge, the jump, the windmills, the
 * switchbacks, a sliding bridge, the pinball table and its flippers, the conveyor, the axes, the
 * sliders, the big turntable, the wrecking balls, the split (the bare beam again, or round the
 * turnstile), the door wall, the cascade, and the longest spiral of the show.
 */
export function summit(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const cmds: Cmd[] = [
    { len: 24, slope: 1.5, w: 17, wall: 1.6, tag: 'start' },
    { len: 20, slope: 8, w: 10, easeW: 8 },
    { len: 8, slope: 2, w: 14, wall: 1.4, easeW: 3 },
    { len: 36, slope: 2, w: 15, tag: 'spin' },
    { len: 30, turn: 90, slope: 7, w: 9, wall: 2.0 },
    { len: 50, slope: 3.5, w: 10.5, wall: 1.5, tag: 'hammers' },
    // the bare beam (once the pack has strung out)
    { len: 10, slope: 3, w: 4.2, wall: 1.3, easeW: 3 },
    { len: 32, slope: 3, w: 6, wall: 0, easeW: 2, tag: 'beam' },
    { len: 8, slope: 2, w: 11, wall: 1.6, easeW: 3 },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    { len: 16, slope: 2, w: 11, wall: 1.6, tag: 'pre-logs' },
    { len: 22, slope: 1.5, w: 11, wall: 0, tag: 'logs' },
    { len: 12, slope: 2, w: 11, wall: 1.6 },
    { len: 18, slope: 3, w: 10, wall: 1.8, tag: 'kick' },
    { len: 7, slope: 8, floor: false, tag: 'gap' },
    { len: 16, slope: 2, w: 14, tag: 'land' },
    { len: 30, turn: 90, slope: 6, w: 10, wall: 1.8 },
    { len: 44, slope: 3, w: 11, wall: 1.8, tag: 'mills' },
    // the switchbacks
    { len: 8, slope: 4, w: 10, wall: 2.4, tag: 'switch' },
    { len: 42, turn: -180, slope: 5, w: 10, wall: 2.4 },
    { len: 10, slope: 4 },
    { len: 42, turn: 180, slope: 5 },
    { len: 8, slope: 3, w: 11, wall: 1.8, tag: 'switch-end' },
    { len: 6, slope: 2, w: 11.5, wall: 1.6, bank: 0, tag: 'pre-slide' },
    { len: 8, slope: 1.5, w: 4, wall: 1.4, bank: 0, easeW: 2 },
    { len: 12, slope: 1, w: 11.5, bank: 0, easeW: 0.25, floor: false, tag: 'slide' },
    { len: 10, slope: 3, w: 12, wall: 1.6 },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    { len: 10, slope: 4, w: 16, wall: 2.2, easeW: 5, tag: 'pre-pin' },
    { len: 30, slope: 5, w: 16, tag: 'pinball' },
    { len: 12, slope: 3, w: 9.5, easeW: 6, wall: 1.8, tag: 'neck' },
    { len: 10, slope: 3, w: 11, easeW: 3 },
    { len: 6, slope: 0, w: 10, wall: 1.8, bank: 0, tag: 'pre-conveyor' },
    { len: 22, slope: -2, w: 10, wall: 1.8, bank: 0, deck: false, tag: 'conveyor' },
    { len: 8, slope: 2, w: 11 },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    { len: 48, slope: 3, w: 11, wall: 1.6, tag: 'axes' },
    { len: 30, slope: 1.5, w: 12, tag: 'sliders' },
    { len: 5, slope: 1, w: 17.4, easeW: 2 },
    { len: 17, slope: 0, w: 17.4, floor: false, tag: 'spinner' },
    { len: 5, slope: 2, w: 12, easeW: 3 },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    { len: 46, slope: 3, w: 12, wall: 1.8, tag: 'wreck' },
    { len: 30, turn: 100, slope: 4, w: 11, wall: 1.9 },
    // the split: the bare beam, or round the turnstile
    { len: 14, slope: 2.5, w: 18, wall: 1.6, easeW: 5, bank: 0, tag: 'pre-split' },
    { len: 44, slope: 2, w: 18, floor: false, bank: 0, tag: 'split' },
    { len: 10, slope: 3, w: 13, easeW: 5 },
    { len: 22, slope: 1, w: 14, easeW: 4, tag: 'doors' },
    { len: 12, slope: 3, w: 13, wall: 1.6, easeW: 4, tag: 'cascade' },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 9, slope: 3, easeS: 0.4 },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 12, slope: 3, easeS: 0.4, tag: 'cascade-end' },
    { len: 10, slope: 5, w: 9.5, easeW: 5, wall: 2.4 },
    { len: 225, turn: 740, slope: 6.5, w: 9.5, wall: 2.4, bank: 22, tag: 'helix' },
    { len: 24, slope: -2, w: 12, wall: 1.8, tag: 'finish' },
    { len: 16, slope: -7, w: 16, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 200, 0), -0.6, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  const state = { go: 1e9 };
  const [st0] = tag(path, 'start');
  const gateS = st0 + 17;
  startGate(b, path, gateS, state);
  arch(b, path, gateS + 2.5, info.name.toUpperCase(), { color: PAINT.yellow, text2: 'Final · First takes the crown' });
  const warn = b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 1.2, wear: 0.05 });

  // the spinner between bumpers
  const [sp0] = tag(path, 'spin');
  {
    const s = sp0 + 17;
    const i = path.index(s);
    sweeper(b, path.P[i].clone(), frameQuat(path, s), { len: 14.6, angle: (t) => -1.9 * t, paint: { a: PAINT.purple, b: PAINT.yellow, pattern: Pattern.Rings, scale: 1.3 } });
    for (const lat of [-5.6, 5.6]) {
      bumper(b, path, sp0 + 5, lat, { color: PAINT.teal });
      bumper(b, path, sp0 + 29, lat, { color: PAINT.pink });
    }
  }
  const [h0] = tag(path, 'hammers');
  [9, 21, 33, 45].forEach((ds, k) => hammer(b, path, h0 + ds, { amp: 1.08, period: 2.2 + (k % 3) * 0.2, phase: k * 2.1, color: [PAINT.blue, PAINT.red, PAINT.green, PAINT.orange][k] }));
  const [l0, l1] = tag(path, 'logs');
  floorBand(b, path, l0 - 1, 0.8, warn);
  logRoll(b, path, (l0 + l1) / 2 - 2.5, { side: -1, logs: 3, speed: 3.5, r: 0.5, len: 4.6, color: PAINT.purple });
  logRoll(b, path, (l0 + l1) / 2 + 5, { side: 1, logs: 3, speed: 3.1, r: 0.5, len: 4.6, phase: 0.8, color: PAINT.green });
  const [, k1] = tag(path, 'kick');
  kicker(b, path, k1, { len: 4.5, h: 0.9 });
  const [g0, g1] = tag(path, 'gap');
  const [m0] = tag(path, 'mills');
  windmill(b, path, m0 + 12, { blades: 4, omega: 0.75, height: 5.4, paint: { a: PAINT.yellow, b: PAINT.red, pattern: Pattern.Stripes, scale: 1.6 } });
  windmill(b, path, m0 + 32, { blades: 3, omega: -0.95, phase: 0.7, height: 5.4, paint: { a: PAINT.purple, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6 }, hubColor: PAINT.green });
  const [sl0, sl1] = tag(path, 'slide');
  slideBridge(b, path, sl0, sl1, { w: 7, period: 5.8, color: PAINT.red });
  const [pn0] = tag(path, 'pinball');
  const rows: number[][] = [[-4.5, 0, 4.5], [-6.2, -2.25, 2.25, 6.2], [-2.25, 2.25]];
  rows.forEach((r, k) => r.forEach((lat) => bumper(b, path, pn0 + 6 + k * 9, lat, { color: [PAINT.yellow, PAINT.purple, PAINT.teal][k] })));
  const [n0, n1] = tag(path, 'neck');
  flippers(b, path, n1 - 1.5, { period: 2.2 });
  const [cv0, cv1] = tag(path, 'conveyor');
  rollers(b, path, cv0 - 0.3, cv1 + 0.3, { speed: -4, colors: [PAINT.blue, PAINT.white] });
  floorBand(b, path, cv0 - 1.3, 0.8, warn);
  const [a0] = tag(path, 'axes');
  [9, 20, 31, 42].forEach((ds, k) => axe(b, path, a0 + ds, { amp: 0.92, period: 2.5 + (k % 2) * 0.4, phase: k * 1.9, color: [PAINT.orange, PAINT.purple, PAINT.red, PAINT.teal][k] }));
  const [sd0] = tag(path, 'sliders');
  [7, 15, 23].forEach((ds, k) => slider(b, path, sd0 + ds, { period: 2.4 + k * 0.35, phase: k * 2.3, size: 2.8, color: [PAINT.red, PAINT.yellow, PAINT.blue][k] }));
  const [tt0, tt1] = tag(path, 'spinner');
  turntableGap(b, path, tt0, tt1, { omega: 1.0, fins: 2 });
  const [wr0] = tag(path, 'wreck');
  [[10, 2.4], [22, -2.4], [34, 0.6]].forEach(([ds, lat], k) => wreckingBall(b, path, wr0 + ds, { lat, period: 3.0 + k * 0.3, phase: k * 1.4, color: [PAINT.red, PAINT.blue, PAINT.yellow][k] }));
  const [spl0, spl1] = tag(path, 'split');
  const lanes = split(b, path, spl0, spl1, { fastLat: -5.0, fastW: 4.0, safeLat: 3.8, safeW: 7.6, safeWall: 1.8 });
  turnstile(b, lanes.safe, 16, { arms: 4, omega: 0.9, height: 0.95, color: PAINT.green, reach: 3.5 });
  bumper(b, lanes.safe, 31, -1.7, { color: PAINT.yellow });
  bumper(b, lanes.safe, 31, 1.7, { color: PAINT.purple });
  const [d0, d1] = tag(path, 'doors');
  doorWall(b, path, (d0 + d1) / 2, { doors: 5, seed: 11 });

  const [f0] = tag(path, 'finish');
  const fs = f0 + 13;
  finishDressing(b, path, fs);
  // the crown on its pedestal past the line
  const crown = makeCrown();
  crown.position.copy(path.at(fs + 6, 0, 3.1));
  b.group.add(crown);
  const pk = new Kin({ type: 'cyl', r: 1.0, hh: 1.1 }, Mat.Paint);
  pk.pos.copy(path.at(fs + 6, 0, 1.1));
  const pp = new Parts();
  pp.add(b.paint({ a: PAINT.purple, b: PAINT.yellow, pattern: Pattern.Stripes, scale: 1.6 }), cylAttr(new THREE.CylinderGeometry(0.9, 1.1, 2.2, 32)));
  pp.add(b.brass, band(0.95, 0.07, 32), mat(0, 1.0, 0));
  boltRing(pp, b, mat(0, 1.1, 0), 0.6, 8, 0.05);
  b.fixed(pk, pp, false);
  const [, c1] = tag(path, 'catch');
  bunting(b, path, 0, 50);
  bunting(b, path, f0 - 10, c1);
  endWall(b, path, c1 - 0.5);
  b.finish();

  const [bm0, bm1] = tag(path, 'beam');
  const [pl] = tag(path, 'pre-logs');
  const [ps] = tag(path, 'pre-slide');
  const [pp0] = tag(path, 'pre-pin');
  const [pc] = tag(path, 'pre-conveyor');
  const [cs] = tag(path, 'cascade');
  const [swb] = tag(path, 'switch');
  const [swe] = tag(path, 'switch-end');
  const [psp] = tag(path, 'pre-split');
  const [ce] = tag(path, 'cascade-end');
  const [hx] = tag(path, 'helix');
  return raceRecord(b, path, {
    id: 'summit',
    name: info.name,
    kind: 'final',
    blurb: info.blurb,
    gateS,
    finishS: fs,
    gaps: [[g0, g1]],
    checkpoints: checkpoints(gateS, [sp0 + 36, h0 + 2, bm0 - 6, bm1 + 6, pl + 3, l1 + 8, g1 + 5, m0 + 2, swb + 2, swe + 2, ps + 3, sl1 + 6, pp0 + 2, n0 + 18, pc + 2, cv1 + 5, a0 + 1, sd0 + 28, tt1 + 4, psp + 2, spl1 + 6, cs + 2, ce + 4, hx + 70, hx + 140]),
    state,
    crown,
  });
}
