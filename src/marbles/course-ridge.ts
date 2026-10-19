import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, type Cmd } from './builder.ts';
import { arch, bumper, bunting, kicker, startGate } from './obstacles.ts';
import { Pattern } from './shaders.ts';
import { turnstile } from './obs-spin.ts';
import { wreckingBall } from './obs-swing.ts';
import { boulderRun, seesaw, slideBridge, trampoline, wobblePlank } from './obs-move.ts';
import { floorBand } from './obs-kit.ts';
import { checkpoints, endWall, finishDressing, lakeBelow, raceRecord, split, tag } from './course-kit.ts';
import type { Course } from './courses.ts';

/**
 * Round 4, Rickety Ridge: nothing here holds still. Five seesaws over the gaps, the boulder run
 * (they roll in off a ramp and bowl down the straight), two bridges sliding from side to side (a
 * neck lines you up for each), the wrecking balls, the switchbacks, the split (a kerbed plank that
 * rocks, or the long way round a turnstile), the big jump, the wobble steps, the trampoline pit,
 * more switchbacks, the rocking bridge, the cascade and the spiral to the line.
 */
export function ridge(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const cmds: Cmd[] = [
    { len: 24, slope: 1.5, w: 17, wall: 1.6, tag: 'start' },
    { len: 16, slope: 7, w: 11, easeW: 8 },
    { len: 34, turn: 60, slope: 8, w: 11, wall: 1.8 },
    { len: 30, turn: -45, slope: 7, w: 11 },
    // the seesaws
    { len: 16, slope: 0.5, w: 10, wall: 1.6, bank: 0, tag: 'pre-saw' },
    { len: 9, slope: 0, w: 10, bank: 0, floor: false, tag: 'saw0' },
    { len: 4, slope: 0, bank: 0 },
    { len: 9, slope: 0, bank: 0, floor: false, tag: 'saw1' },
    { len: 4, slope: 0, bank: 0 },
    { len: 9, slope: 0, bank: 0, floor: false, tag: 'saw2' },
    { len: 4, slope: 0, bank: 0 },
    { len: 9, slope: 0, bank: 0, floor: false, tag: 'saw3' },
    { len: 4, slope: 0, bank: 0 },
    { len: 9, slope: 0, bank: 0, floor: false, tag: 'saw4' },
    { len: 10, slope: 3, w: 11 },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    // the boulder run: the left wall opens where they roll in, the right where they leave
    { len: 14, slope: 4, w: 12, wall: 1.9, bank: 0, tag: 'pre-boulder' },
    { len: 8, slope: 5, w: 12, wallL: 0, wallR: 1.9, bank: 0, tag: 'boulder' },
    { len: 70, slope: 5, w: 12, wallL: 1.9, wallR: 1.9, bank: 0 },
    { len: 12, slope: 5, w: 12, wallL: 1.9, wallR: 0, bank: 0, tag: 'boulder-exit' },
    { len: 12, slope: 4, w: 12, wall: 1.9 },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    // the sliding bridges
    // (a neck before each bridge: single file onto it)
    { len: 6, slope: 1.5, w: 11.5, wall: 1.6, bank: 0, tag: 'pre-slide' },
    { len: 8, slope: 1.5, w: 4, wall: 1.4, bank: 0, easeW: 2 },
    { len: 12, slope: 1, w: 11.5, bank: 0, easeW: 0.25, floor: false, tag: 'slide1' },
    { len: 4, slope: 1, w: 11.5, wall: 1.0, bank: 0 },
    { len: 5, slope: 1, w: 4, wall: 1.4, bank: 0, easeW: 1.2 },
    { len: 12, slope: 1, w: 11.5, bank: 0, easeW: 0.25, floor: false, tag: 'slide2' },
    { len: 10, slope: 3, w: 12, wall: 1.6 },
    // the wrecking balls
    { len: 54, slope: 3, w: 12, wall: 1.8, tag: 'wreck' },
    // the switchbacks
    { len: 8, slope: 4, w: 10, wall: 2.4, tag: 'switch' },
    { len: 42, turn: 180, slope: 5, w: 10, wall: 2.4 },
    { len: 10, slope: 4 },
    { len: 42, turn: -180, slope: 5 },
    { len: 8, slope: 3, w: 11, wall: 1.8, tag: 'switch-end' },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    // the split
    { len: 14, slope: 2, w: 18, wall: 1.6, easeW: 5, bank: 0, tag: 'pre-split' },
    { len: 40, slope: 1.5, w: 18, floor: false, bank: 0, tag: 'split' },
    { len: 10, slope: 3, w: 12, easeW: 5 },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    // the big jump
    { len: 24, slope: 5, w: 11, wall: 1.6, tag: 'kick' },
    { len: 10, slope: 14, floor: false, tag: 'gap' },
    { len: 16, slope: 4, w: 15, tag: 'land' },
    // the wobble steps: three rocking decks
    { len: 10, slope: 2, w: 10, wall: 1.6, bank: 0, easeW: 5, tag: 'pre-steps' },
    { len: 8, slope: 0.5, w: 10, wall: 0, bank: 0, floor: false, tag: 'step0' },
    { len: 3, slope: 0.5, wall: 1.2, bank: 0 },
    { len: 8, slope: 0.5, wall: 0, bank: 0, floor: false, tag: 'step1' },
    { len: 3, slope: 0.5, wall: 1.2, bank: 0 },
    { len: 8, slope: 0.5, wall: 0, bank: 0, floor: false, tag: 'step2' },
    { len: 10, slope: 3, w: 11, wall: 1.8 },
    // the bounce pit: a trampoline below an open stretch
    { len: 8, slope: 2, w: 11, wall: 1.8, bank: 0, tag: 'pre-bounce' },
    { len: 9, slope: 0, w: 11, bank: 0, floor: false, tag: 'bounce' },
    { len: 10, slope: 2, w: 11, wall: 1.8, bank: 0 },
    // the lower switchbacks
    { len: 8, slope: 4, w: 10, wall: 2.4 },
    { len: 42, turn: -180, slope: 4.5, w: 10, wall: 2.4 },
    { len: 10, slope: 4 },
    { len: 42, turn: 180, slope: 4.5 },
    { len: 10, slope: 3, w: 11, wall: 1.8, tag: 'switch2-end' },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 1.9 },
    { len: 10, slope: 2, w: 10, wall: 1.6, bank: 0, easeW: 5 },
    // the rocking bridge
    { len: 20, slope: 1, w: 10, wall: 0, bank: 0, floor: false, tag: 'rock' },
    { len: 10, slope: 3, w: 10, wall: 1.8 },
    // the cascade
    { len: 12, slope: 3, w: 12, wall: 1.6, easeW: 4, tag: 'cascade' },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 9, slope: 3, easeS: 0.4 },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 12, slope: 3, easeS: 0.4, tag: 'cascade-end' },
    { len: 10, slope: 5, w: 9.5, easeW: 5, wall: 2.4 },
    { len: 210, turn: 700, slope: 6.5, w: 9.5, wall: 2.4, bank: 22, tag: 'helix' },
    { len: 30, slope: 2, w: 12, wall: 1.8, tag: 'finish' },
    { len: 18, slope: -7, w: 16, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 185, 0), -0.8, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  const state = { go: 1e9 };
  const [st0] = tag(path, 'start');
  const gateS = st0 + 17;
  startGate(b, path, gateS, state);
  arch(b, path, gateS + 2.5, info.name.toUpperCase(), { color: PAINT.green, text2: 'Round 4 · Race' });
  const warn = b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 1.2, wear: 0.05 });

  // the seesaws, each on its own beat
  ['saw0', 'saw1', 'saw2', 'saw3', 'saw4'].forEach((t, k) => {
    const [a, c] = tag(path, t);
    seesaw(b, path, a, c, { amp: 0.07, period: 3.4 + (k % 3) * 0.5, phase: k * 2.1, color: [PAINT.blue, PAINT.red, PAINT.green, PAINT.purple, PAINT.orange][k] });
  });

  // the boulders
  const [bo0] = tag(path, 'boulder');
  const [, bx1] = tag(path, 'boulder-exit');
  boulderRun(b, path, bo0 + 1, bx1 - 2, { count: 3, speed: 15, r: 1.3, lanes: [-2.6, 2.4, -0.2] });
  floorBand(b, path, bo0 - 2, 0.8, warn);

  // the sliding bridges
  const [s10, s11] = tag(path, 'slide1');
  const [s20, s21] = tag(path, 'slide2');
  slideBridge(b, path, s10, s11, { w: 7, period: 6.4, color: PAINT.green });
  slideBridge(b, path, s20, s21, { w: 7, period: 5.6, phase: 1.7, color: PAINT.orange });

  // the wrecking balls
  const [wr0] = tag(path, 'wreck');
  [[10, -2.6], [22, 2.6], [34, -0.4], [46, 2.4]].forEach(([ds, lat], k) => wreckingBall(b, path, wr0 + ds, { lat, period: 3.2 + (k % 2) * 0.5, phase: k * 1.6, color: [PAINT.purple, PAINT.red, PAINT.blue, PAINT.orange][k] }));

  // the split: a rocking plank straight through, or the walled lane round a turnstile
  const [sp0, sp1] = tag(path, 'split');
  const lanes = split(b, path, sp0, sp1, { fastLat: -5.0, fastW: 4.2, safeLat: 4.0, safeW: 7.2, safeWall: 2.0, fastChute: false });
  wobblePlank(b, path, sp0, sp1, { lat: -5.0, w: 4.2, amp: 0.07, period: 4.0, color: PAINT.orange, kerb: 0.22 });
  turnstile(b, lanes.safe, 18, { arms: 3, omega: 0.8, height: 0.95, color: PAINT.purple, reach: 3.5 });
  bumper(b, lanes.safe, 30, -1.6, { color: PAINT.teal });
  bumper(b, lanes.safe, 30, 1.6, { color: PAINT.pink });

  // the big jump
  const [, k1] = tag(path, 'kick');
  kicker(b, path, k1, { len: 5, h: 1.1 });
  const [g0, g1] = tag(path, 'gap');

  // the wobble steps
  ['step0', 'step1', 'step2'].forEach((t, k) => {
    const [a, c] = tag(path, t);
    wobblePlank(b, path, a, c, { amp: 0.06, period: 3.0 + k * 0.4, phase: k * 1.9, color: [PAINT.teal, PAINT.pink, PAINT.yellow][k] });
  });

  // the bounce pit
  const [bp0, bp1] = tag(path, 'bounce');
  trampoline(b, path, bp0, bp1, { depth: 2.2, kick: 4.5, color: PAINT.red });
  floorBand(b, path, bp0 - 1, 0.8, warn);

  // the rocking bridge
  const [r0, r1] = tag(path, 'rock');
  wobblePlank(b, path, r0, r1, { amp: 0.075, period: 4.2, color: PAINT.blue });

  const [f0] = tag(path, 'finish');
  const fs = f0 + 17;
  finishDressing(b, path, fs);
  const [, c1] = tag(path, 'catch');
  bunting(b, path, 0, 100);
  bunting(b, path, f0 - 10, c1);
  endWall(b, path, c1 - 0.5);
  b.finish();

  const [ps] = tag(path, 'pre-saw');
  const [, sw2] = tag(path, 'saw4');
  const [swb] = tag(path, 'switch');
  const [swe] = tag(path, 'switch-end');
  const [pst] = tag(path, 'pre-steps');
  const [, st2] = tag(path, 'step2');
  const [cs] = tag(path, 'cascade');
  const [s2e] = tag(path, 'switch2-end');
  const [pbo] = tag(path, 'pre-bounce');
  const [ce] = tag(path, 'cascade-end');
  const [pb] = tag(path, 'pre-boulder');
  const [psl] = tag(path, 'pre-slide');
  const [psp] = tag(path, 'pre-split');
  const [ld] = tag(path, 'land');
  const [hx] = tag(path, 'helix');
  return raceRecord(b, path, {
    id: 'ridge',
    name: info.name,
    kind: 'race',
    blurb: info.blurb,
    gateS,
    finishS: fs,
    gaps: [[g0, g1]],
    checkpoints: checkpoints(gateS, [gateS + 60, ps + 3, sw2 + 6, pb + 4, bx1 + 8, psl + 3, s21 + 6, swb + 2, swe + 2, psp + 3, sp1 + 6, ld + 8, pst + 3, st2 + 6, pbo + 2, bp1 + 6, s2e + 2, cs + 2, ce + 4, hx + 70, hx + 140]),
    state,
  });
}
