import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, cylAttr, type Cmd } from './builder.ts';
import { arch, bumper, bunting, doorWall, frameQuat, hammer, kicker, peg, slider, startGate, sweeper } from './obstacles.ts';
import { foamTheme, Pattern, zonedFloor } from './shaders.ts';
import { flippers, rollers, turnstile, windmill } from './obs-spin.ts';
import { logRoll, seesaw, slideBridge, trampoline, wobblePlank } from './obs-move.ts';
import { axe, wreckingBall } from './obs-swing.ts';
import { floorBand } from './obs-kit.ts';
import { gates, puncher, rollDown } from './obs-new.ts';
import { dressCourse, type DressTurn } from './course-dress.ts';
import { checkpoints, endWall, finishDressing, lakeBelow, makeCrown, raceRecord, tag, turntableGap } from './course-kit.ts';
import type { Course } from './courses.ts';
import { biome, BIOMES } from './biome.ts';
import { lake, paintLakeFor } from './env.ts';

/**
 * Platform courses: wide padded decks floating in the sky with open edges (fall off and it's back
 * to the last checkpoint), flat or climbing, joined by turns, ramps and little hops between
 * islands. Each course is a list of obstacle zones from the kit below, so there can be lots of
 * them; every zone sets out its own floor (cmds), puts its obstacles on it (place), and says where
 * a respawn is safe and which gaps the bots must jump.
 */

const COLS = [PAINT.red, PAINT.blue, PAINT.green, PAINT.orange, PAINT.purple, PAINT.pink, PAINT.teal, PAINT.yellow];
const col = (k: number) => COLS[((k % COLS.length) + COLS.length) % COLS.length];

interface Ctx {
  b: CourseBuilder;
  path: Path;
  t: (name: string) => [number, number];
  warn: ReturnType<CourseBuilder['paint']>;
  /** a per-zone number (varies the beats and colours) */
  n: number;
}
interface Zone {
  cmds: Cmd[];
  place(c: Ctx): void;
  /** safe respawn spots */
  cps(c: Ctx): number[];
  gaps?(c: Ctx): [number, number][];
}

const W = 14;
/** every zone's floor is flat-banked; an open edge unless it says otherwise */
const flat = (c: Cmd): Cmd => ({ bank: 0, slope: 0, wall: 0, ...c });

// ------------------------------------------------------------------------------------- the zones
export const ZONES: Record<string, (k: string) => Zone> = {
  /** staggered pins with a bumper here and there */
  pins: (k) => ({
    cmds: [flat({ len: 8, w: 15, tag: k + 'pre' }), flat({ len: 40, w: 15, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0, z1] = t(k + 'z');
      let row = 0;
      for (let s = z0 + 4; s < z1 - 3; s += 3.1, row++) {
        for (let q = -2; q <= 2; q++) {
          const lat = q * 3 + (row % 2 ? 1.5 : 0);
          if (Math.abs(lat) > 6) continue;
          if ((row % 2 === 1 && q === 0) || (row % 4 === 2 && Math.abs(q) === 2)) bumper(b, path, s, lat, { color: col(n + row), r: 0.85 });
          else peg(b, path, s, lat, { r: 0.36, h: 1.6, paint: { a: col(n + row), b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } });
        }
      }
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** two low bars sweeping round: hop them */
  sweep: (k) => ({
    cmds: [flat({ len: 8, w: 15, tag: k + 'pre' }), flat({ len: 40, w: 15, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [8, 20, 32].forEach((ds, q) => {
        const s = z0 + ds;
        const om = (q % 2 ? -1 : 1) * (1.45 + 0.15 * (n % 3) + 0.1 * q);
        sweeper(b, path.P[path.index(s)].clone(), frameQuat(path, s), { len: 14.6, angle: (tt) => om * tt + ds + n, paint: { a: col(n + q * 3), b: PAINT.white, pattern: Pattern.Rings, scale: 1.3 } });
      });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** hammers swinging across from gantries, low padded rims */
  hammers: (k) => ({
    cmds: [flat({ len: 8, w: 12, wall: 1.3, tag: k + 'pre' }), flat({ len: 48, w: 12, wall: 1.3, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [6, 15, 24, 33, 42].forEach((ds, q) => hammer(b, path, z0 + ds, { amp: 1.2, period: 2.1 + (q % 3) * 0.2, phase: q * 1.7 + n, color: col(n + q) }));
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** walls of doors: some lift, some don't */
  doors: (k) => ({
    cmds: [flat({ len: 8, w: 14, wall: 1.2, tag: k + 'pre' }), flat({ len: 32, w: 14, wall: 1.2, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      doorWall(b, path, z0 + 6, { doors: 5, seed: 3 + n });
      doorWall(b, path, z0 + 16, { doors: 6, seed: 9 + n });
      doorWall(b, path, z0 + 26, { doors: 4, seed: 17 + n });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'z')[0] + 11],
  }),
  /** logs rolling across an open bridge */
  logs: (k) => ({
    cmds: [flat({ len: 8, w: 10, tag: k + 'pre' }), flat({ len: 30, w: 10, tag: k + 'z' }), flat({ len: 6, w: W })],
    place: ({ b, path, t, n, warn }) => {
      const [z0, z1] = t(k + 'z');
      const m = (z0 + z1) / 2;
      floorBand(b, path, z0 - 1, 0.8, warn);
      logRoll(b, path, m - 8, { side: 1, logs: 4, speed: 4.1, r: 0.5, len: 4.6, color: col(n) });
      logRoll(b, path, m, { side: -1, logs: 4, speed: 3.7, r: 0.5, len: 4.6, phase: 1.3, color: col(n + 2) });
      logRoll(b, path, m + 8, { side: 1, logs: 4, speed: 4.4, r: 0.5, len: 4.6, phase: 0.6, color: col(n + 4) });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** three seesaws in a row */
  saws: (k) => ({
    cmds: [
      flat({ len: 8, w: 10, wall: 0.6, tag: k + 'pre' }),
      flat({ len: 9, w: 10, floor: false, tag: k + 's0' }),
      flat({ len: 4, w: 10 }),
      flat({ len: 9, w: 10, floor: false, tag: k + 's1' }),
      flat({ len: 4, w: 10 }),
      flat({ len: 9, w: 10, floor: false, tag: k + 's2' }),
      flat({ len: 8, w: W, easeW: 4, tag: k + 'post' }),
    ],
    place: ({ b, path, t, n }) => {
      for (let q = 0; q < 3; q++) {
        const [a, c] = t(k + 's' + q);
        seesaw(b, path, a, c, { amp: 0.1, period: 2.8 + (q % 3) * 0.4, phase: q * 2.1 + n, color: col(n + q) });
      }
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 3],
  }),
  /** bridges that slide side to side, a neck lining you up for each */
  slides: (k) => ({
    cmds: [
      flat({ len: 6, w: 11.5, wall: 0.6, tag: k + 'pre' }),
      flat({ len: 8, w: 4, wall: 1.2, easeW: 2 }),
      flat({ len: 12, w: 11.5, easeW: 0.25, floor: false, tag: k + 's1' }),
      flat({ len: 4, w: 11.5, wall: 1.0 }),
      flat({ len: 5, w: 4, wall: 1.2, easeW: 1.2 }),
      flat({ len: 12, w: 11.5, easeW: 0.25, floor: false, tag: k + 's2' }),
      flat({ len: 8, w: W, easeW: 3, tag: k + 'post' }),
    ],
    place: ({ b, path, t, n }) => {
      const [a, c] = t(k + 's1');
      const [d, e] = t(k + 's2');
      slideBridge(b, path, a, c, { w: 5.6, period: 4.6, phase: n, color: col(n) });
      slideBridge(b, path, d, e, { w: 5.2, period: 4.1, phase: 1.7 + n, color: col(n + 3) });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 3],
  }),
  /** a spinning disk in a gap, fins sweeping across it */
  spinner: (k) => ({
    cmds: [flat({ len: 8, w: W, tag: k + 'pre' }), flat({ len: 5, w: 17.4, easeW: 2 }), flat({ len: 17, w: 17.4, floor: false, tag: k + 'z' }), flat({ len: 6, w: W, easeW: 3, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0, z1] = t(k + 'z');
      turntableGap(b, path, z0, z1, { omega: (n % 2 ? -1 : 1) * (0.95 + 0.1 * (n % 3)), fins: 3 + (n % 2) });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 3],
  }),
  /** an uphill conveyor running back at you */
  conveyor: (k) => ({
    cmds: [flat({ len: 8, w: 10, wall: 1.2, tag: k + 'pre' }), flat({ len: 26, slope: -3, w: 10, wall: 1.2, deck: false, tag: k + 'z' }), flat({ len: 8, w: W, easeW: 3 })],
    place: ({ b, path, t, n, warn }) => {
      const [z0, z1] = t(k + 'z');
      rollers(b, path, z0 - 0.3, z1 + 0.3, { speed: -5.4, r: 0.5, pitch: 0.56, colors: [col(n), PAINT.white] });
      floorBand(b, path, z0 - 1.3, 0.8, warn);
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** wrecking balls swinging through an open deck */
  wreck: (k) => ({
    cmds: [flat({ len: 8, w: 12, tag: k + 'pre' }), flat({ len: 50, w: 12, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [[8, -2.6], [17, 2.6], [26, -0.4], [35, -2.4], [44, 2.4]].forEach(([ds, lat], q) => wreckingBall(b, path, z0 + ds, { lat, amp: 0.85, period: 2.7 + (q % 2) * 0.4, phase: q * 1.6 + n, color: col(n + q) }));
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** big axes swinging along the way */
  axes: (k) => ({
    cmds: [flat({ len: 8, w: 11, wall: 0.7, tag: k + 'pre' }), flat({ len: 50, w: 11, wall: 0.7, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [7, 16, 25, 34, 43].forEach((ds, q) => axe(b, path, z0 + ds, { amp: 1.0, period: 2.2 + (q % 2) * 0.3, phase: q * 2.2 + n, color: col(n + q) }));
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** a kicker and a long jump down to the next deck */
  jump: (k) => ({
    cmds: [flat({ len: 6, w: 12, tag: k + 'pre' }), flat({ len: 14, w: 12, wall: 0.8, tag: k + 'kick' }), { len: 8, slope: 10, bank: 0, floor: false, tag: k + 'gap' }, flat({ len: 12, w: 15, tag: k + 'land' })],
    place: ({ b, path, t }) => {
      const [, k1] = t(k + 'kick');
      kicker(b, path, k1, { len: 5, h: 1.0 });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'land')[0] + 6],
    gaps: ({ t }) => [t(k + 'gap')],
  }),
  /** a trampoline pit under an open stretch */
  bounce: (k) => ({
    cmds: [flat({ len: 8, w: 11, wall: 0.7, tag: k + 'pre' }), flat({ len: 9, w: 11, floor: false, tag: k + 'z' }), flat({ len: 10, w: 11, wall: 0.7, tag: k + 'post' })],
    place: ({ b, path, t, n, warn }) => {
      const [z0, z1] = t(k + 'z');
      trampoline(b, path, z0, z1, { depth: 2.2, kick: 4.5, color: col(n) });
      floorBand(b, path, z0 - 1, 0.8, warn);
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 4],
  }),
  /** three rocking planks with little pads between */
  planks: (k) => ({
    cmds: [
      flat({ len: 8, w: 10, tag: k + 'pre' }),
      flat({ len: 8, w: 10, floor: false, tag: k + 'p0' }),
      flat({ len: 3, w: 10 }),
      flat({ len: 8, w: 10, floor: false, tag: k + 'p1' }),
      flat({ len: 3, w: 10 }),
      flat({ len: 8, w: 10, floor: false, tag: k + 'p2' }),
      flat({ len: 8, w: W, easeW: 3, tag: k + 'post' }),
    ],
    place: ({ b, path, t, n }) => {
      for (let q = 0; q < 3; q++) {
        const [a, c] = t(k + 'p' + q);
        wobblePlank(b, path, a, c, { amp: 0.09, period: 2.5 + q * 0.3, phase: q * 1.9 + n, color: col(n + q * 2) });
      }
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 3],
  }),
  /** windmills turning over the deck */
  mills: (k) => ({
    cmds: [flat({ len: 8, w: 12, wall: 0.7, tag: k + 'pre' }), flat({ len: 46, w: 12, wall: 0.7, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      windmill(b, path, z0 + 9, { blades: 3, omega: 1.1, height: 5.4, phase: n, paint: { a: col(n), b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6 } });
      windmill(b, path, z0 + 23, { blades: 4, omega: -1.0, height: 5.4, phase: 0.4 + n, paint: { a: col(n + 5), b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6 }, hubColor: col(n + 2) });
      windmill(b, path, z0 + 37, { blades: 4, omega: -1.0, phase: 1.1 + n, height: 5.4, paint: { a: col(n + 3), b: PAINT.white, pattern: Pattern.Stripes, scale: 1.6 }, hubColor: col(n + 1) });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** blocks shoving across the deck */
  sliders: (k) => ({
    cmds: [flat({ len: 8, w: 12, wall: 1.0, tag: k + 'pre' }), flat({ len: 42, w: 12, wall: 1.0, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [6, 13.5, 21, 28.5, 36].forEach((ds, q) => slider(b, path, z0 + ds, { period: 2.3 + (q % 3) * 0.25, phase: q * 1.9 + n, color: col(n + q) }));
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** turnstiles to push through, pins between */
  turnstiles: (k) => ({
    cmds: [flat({ len: 8, w: 13, tag: k + 'pre' }), flat({ len: 48, w: 13, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      turnstile(b, path, z0 + 7, { arms: 4, omega: 1.15, height: 0.95, color: col(n) });
      turnstile(b, path, z0 + 24, { arms: 3, omega: -1.3, height: 0.95, color: col(n + 2), phase: 0.6 });
      turnstile(b, path, z0 + 41, { arms: 4, omega: 1.25, height: 0.95, color: col(n + 5), phase: 0.3 });
      for (const ds of [15.5, 32.5]) for (const lat of [-4.2, 0, 4.2]) peg(b, path, z0 + ds, lat, { paint: { a: col(n + 4), b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** a field of bumpers, then a neck through flippers */
  bumpers: (k) => ({
    cmds: [flat({ len: 8, w: 16, tag: k + 'pre' }), flat({ len: 36, w: 16, tag: k + 'z' }), flat({ len: 12, w: 9.5, easeW: 6, wall: 1.2, tag: k + 'neck' }), flat({ len: 8, w: W, easeW: 3 })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      const rows: number[][] = [[-4.5, 0, 4.5], [-6.2, -2.25, 2.25, 6.2], [-4.5, 0, 4.5], [-6.2, -2.25, 2.25, 6.2], [-3.4, 0, 3.4]];
      rows.forEach((r, q) => r.forEach((lat) => bumper(b, path, z0 + 4 + q * 7, lat, { color: col(n + q) })));
      const [, n1] = t(k + 'neck');
      flippers(b, path, n1 - 1.5, { period: 1.9 });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** island hopping: small decks with gaps between, a jump each */
  hop: (k) => ({
    cmds: [
      flat({ len: 6, w: 12, tag: k + 'pre' }),
      // (each island long enough to land, settle from the bounce and run up to the next lip)
      flat({ len: 3.6, w: 9, floor: false, tag: k + 'g0' }),
      flat({ len: 5, w: 10 }),
      flat({ len: 4, w: 10, turn: 10 }),
      flat({ len: 4, w: 10 }),
      flat({ len: 3.6, w: 9, floor: false, tag: k + 'g1' }),
      flat({ len: 5, w: 10 }),
      flat({ len: 4, w: 10, turn: -14 }),
      flat({ len: 4, w: 10 }),
      flat({ len: 3.6, w: 9, floor: false, tag: k + 'g2' }),
      flat({ len: 8, w: W, easeW: 3, tag: k + 'post' }),
    ],
    place: () => undefined,
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 4],
    gaps: ({ t }) => [t(k + 'g0'), t(k + 'g1'), t(k + 'g2')],
  }),
  /** fists punching out across an open deck from boxes on both sides, in a wave down the line */
  punch: (k) => ({
    cmds: [flat({ len: 8, w: 13, tag: k + 'pre' }), flat({ len: 42, w: 13, tag: k + 'z' }), flat({ len: 6, w: 13, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [4, 9.5, 15, 20.5, 26, 31.5, 37].forEach((ds, q) => {
        const side = q % 2 ? 1 : -1;
        puncher(b, path, z0 + ds, side, { period: 2.2 + (q % 3) * 0.2, phase: q * 0.55 + n * 0.3, color: col(n + q) });
        // (every other, one from the other side too, a beat later)
        if (q % 2 === 1) puncher(b, path, z0 + ds + 0.01, -side, { period: 2.2, phase: q * 0.55 + n * 0.3 + 1.3, color: col(n + q + 1) });
      });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 2],
  }),
  /** an uphill run with balls dropping out of hoppers at the top and rolling down at you */
  rolldown: (k) => ({
    cmds: [flat({ len: 8, w: 14, tag: k + 'pre' }), flat({ len: 40, slope: -7, w: 14, easeS: 3, tag: k + 'z' }), flat({ len: 8, w: 14, easeS: 2, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0, z1] = t(k + 'z');
      rollDown(b, path, z0, z1, { lanes: [-4.8, -1.6, 1.6, 4.8], period: 3.0 + (n % 3) * 0.25, speed: 8.6, phase: n, colors: [col(n), col(n + 2), col(n + 5), col(n + 3)] });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 3],
  }),
  /** padded gates hinged on the walls, swinging shut across the way */
  gates: (k) => ({
    cmds: [flat({ len: 8, w: 14, wall: 1.0, tag: k + 'pre' }), flat({ len: 44, w: 14, wall: 1.0, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [6, 16, 26, 36].forEach((ds, q) => gates(b, path, z0 + ds, { period: 2.7 + q * 0.2, phase: q * 1.4 + n, color: col(n + q * 2) }));
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** an uphill climb, pins to weave through */
  climb: (k) => ({
    cmds: [flat({ len: 6, w: 13, tag: k + 'pre' }), flat({ len: 30, slope: -8, w: 13, easeS: 3, tag: k + 'z' }), flat({ len: 16, w: W, easeS: 2, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [[6, 0], [10, -3.5], [10, 3.5], [15, -1.5], [15, 4.5], [20, 1.5], [20, -4.5], [25, -3], [25, 3]].forEach(([ds, lat], q) => peg(b, path, z0 + ds, lat, { r: 0.4, paint: { a: col(n + q), b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } }));
      const [, z1] = t(k + 'z');
      const ss = z1 + 8.5;
      sweeper(b, path.P[path.index(ss)].clone(), frameQuat(path, ss), { len: 12.4, angle: (tt) => (n % 2 ? -1 : 1) * 1.3 * tt + n, paint: { a: col(n + 1), b: PAINT.white, pattern: Pattern.Rings, scale: 1.3 } });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 1],
  }),
};

/** the links between zones: a turn (L/R + degrees), a straight, a ramp up, a ramp down, a hop */
function link(tok: string, k: string): { cmds: Cmd[]; gaps?: string[] } {
  if (tok[0] === 'L' || tok[0] === 'R') {
    const deg = Number(tok.slice(1)) || 60;
    return { cmds: [flat({ len: Math.max(14, deg * 0.38), turn: tok[0] === 'L' ? -deg : deg, w: W })] };
  }
  if (tok === 'up') return { cmds: [flat({ len: 16, slope: -8, w: W, easeS: 3 }), flat({ len: 4, w: W, easeS: 2 })] };
  if (tok === 'down') return { cmds: [flat({ len: 12, slope: 14, w: W, easeS: 2 }), flat({ len: 4, w: W, easeS: 2 })] };
  if (tok === 'gap') return { cmds: [flat({ len: 3.4, w: W, floor: false, tag: k + 'lg' }), flat({ len: 6, w: W })], gaps: [k + 'lg'] };
  return { cmds: [flat({ len: Number(tok.slice(1)) || 10, w: W })] };
}

export interface GenSpec {
  id: string;
  /** zone names and links in order: 'pins', 'L60', 'R45', 'S12', 'up', 'down', 'gap' */
  steps: string[];
  heading: number;
  arch: number;
  final?: boolean;
  /** Lava Rush: the lava floods up the course behind the field (it reaches the line after this many seconds) */
  lava?: number;
}

export function genCourse(spec: GenSpec, info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const cmds: Cmd[] = [flat({ len: 26, w: 17, wall: 1.2, tag: 'start' }), flat({ len: 8, w: W, easeW: 5 })];
  const zones: { z: Zone; k: string; n: number; s0: number; s1: number; kind: string }[] = [];
  const linkGaps: string[] = [];
  const turns: DressTurn[] = [];
  const sum = () => cmds.reduce((a, c) => a + c.len, 0);
  spec.steps.forEach((st, i) => {
    const k = `${i}:`;
    const make = ZONES[st];
    if (make) {
      const z = make(k);
      // (into a walled or narrower zone: the floor narrows first, then the walls rise — never a
      // wall's end standing across the way where the deck was wider)
      const c0 = z.cmds[0];
      const prevW = cmds[cmds.length - 1].w ?? W;
      if ((c0.wall ?? 0) > 0.05 && (c0.w ?? W) < prevW - 0.5) cmds.push(flat({ len: 7, w: c0.w, easeW: 1.8 }));
      const s0 = sum();
      cmds.push(...z.cmds);
      zones.push({ z, k, n: i * 3 + spec.id.length, s0, s1: sum(), kind: st });
    } else {
      const l = link(st, k);
      const s0 = sum();
      cmds.push(...l.cmds);
      if (st[0] === 'L' || st[0] === 'R') turns.push({ s0, s1: sum(), dir: st[0] === 'R' ? 1 : -1 });
      if (l.gaps) linkGaps.push(...l.gaps);
    }
  });
  cmds.push(flat({ len: 10, w: W }), flat({ len: 28, w: 15, wall: 1.2, easeW: 4, tag: 'finish' }), { len: 18, slope: -7, w: 16, wall: 1.2, bank: 0, tag: 'catch' });
  const path = new Path(new THREE.Vector3(0, 160, 0), spec.heading, cmds);
  // (high in the sky over the paint)
  b.lakeY = lakeBelow(path) - 25;
  // every zone its own floor: tile colours and a pattern of its own, a striped band where it starts
  const floorMat = zonedFloor(
    path.length,
    zones.flatMap(({ s0, s1 }, q) => {
      const tiles = biome().deck.tiles;
      const [a, bb] = tiles[(q * 3 + spec.id.length) % tiles.length];
      const pat = (q + spec.id.length) % 4;
      const th = foamTheme();
      return [
        { s0, s1, a, b: bb, pat },
        { s0, s1: s0 + 1.5, a: th.rail, b: 0xffffff, pat: 0, band: true },
      ];
    }),
  );
  b.chute(path, { depth: 1.8, trestles: false, floorMat });
  const state = { go: 1e9 };
  const [st0] = tag(path, 'start');
  const gateS = st0 + 18;
  startGate(b, path, gateS, state);
  arch(b, path, gateS + 2.5, info.name.toUpperCase(), { color: spec.arch, text2: spec.final ? 'The Final · First takes the crown' : 'Race' });
  const warn = b.paint({ a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Stripes, scale: 1.2 });
  const t = (name: string) => tag(path, name);
  const cps: number[] = [];
  const gaps: [number, number][] = [];
  for (const { z, n } of zones) {
    const ctx: Ctx = { b, path, t, warn, n };
    z.place(ctx);
    cps.push(...z.cps(ctx));
    if (z.gaps) gaps.push(...z.gaps(ctx));
  }
  for (const g of linkGaps) gaps.push(t(g));
  // checkpoint flags: a striped pole each side and a flag in the course's colour, waving
  {
    const th = foamTheme();
    const poleM = b.paint({ a: PAINT.white, b: th.post, pattern: Pattern.Stripes, scale: 2.4 });
    const flagM = new THREE.MeshStandardMaterial({ color: th.rail, roughness: 0.6, side: THREE.DoubleSide });
    const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.95, -0.32), new THREE.Vector2(0, -0.64)]);
    const flagG = new THREE.ShapeGeometry(tri);
    cps.filter((s) => s > gateS + 2).forEach((s, k) => {
      const i = path.index(s);
      const hw = path.sec[i].w / 2;
      for (const side of [-1, 1]) {
        const base = path.at(s, side * (hw - 0.15), 0);
        const pole = new THREE.Mesh(cylAttr(new THREE.CylinderGeometry(0.07, 0.09, 2.7, 12)), poleM);
        pole.position.copy(base).add(new THREE.Vector3(0, 1.35, 0));
        pole.castShadow = true;
        b.group.add(pole);
        const flag = new THREE.Mesh(flagG, flagM);
        flag.position.copy(base).add(new THREE.Vector3(0, 2.65, 0));
        flag.rotation.y = Math.atan2(path.T[i].x, path.T[i].z) + Math.PI / 2 + (side < 0 ? Math.PI : 0);
        const y0 = flag.rotation.y;
        b.animators.push((tt) => (flag.rotation.y = y0 + Math.sin(tt * 3.1 + k + side) * 0.3));
        flag.castShadow = true;
        b.group.add(flag);
      }
    });
  }
  const [f0] = t('finish');
  const fs = f0 + 14;
  finishDressing(b, path, fs);
  let crown: THREE.Object3D | undefined;
  if (spec.final) {
    crown = makeCrown();
    crown.position.copy(path.at(fs + 6, 0, 3.1));
    b.group.add(crown);
  }
  dressCourse(b, path, {
    zones: zones.map(({ s0, s1 }, q) => ({ s0, s1, color: biome().deck.arch[(q * 3 + spec.id.length) % biome().deck.arch.length] })),
    turns,
    gateS,
    finishS: fs,
    seed: spec.id.length * 7 + spec.steps.length,
  });
  const [, c1] = t('catch');
  bunting(b, path, 0, 60);
  bunting(b, path, f0 - 10, c1);
  endWall(b, path, c1 - 0.5);
  b.finish();
  let lavaOf: Course['lava'];
  if (spec.lava) {
    // the lava: a sea of it, risen to the deck's height where its front has got to along the course
    // (the highest the course has been up to there, a hand under it), never going back down
    const DELAY = 7;
    const V = fs / spec.lava;
    const hmax = new Float32Array(path.count);
    let h = -Infinity;
    for (let i = 0; i < path.count; i++) hmax[i] = h = Math.max(h, path.P[i].y);
    const y0 = path.P[0].y - 14;
    const sAt = (t: number) => (t < state.go + DELAY ? -60 : (t - state.go - DELAY) * V - 4);
    const yAt = (t: number) => {
      const sl = sAt(t);
      if (sl <= 0) return y0 + Math.max(0, Math.min(1, (t - state.go) / DELAY)) * (path.P[0].y - 0.6 - y0) * (t > state.go ? 1 : 0);
      return Math.max(path.P[0].y - 0.6, hmax[path.index(Math.min(sl, fs))] - 0.35);
    };
    const lm = lake(y0);
    paintLakeFor(lm, BIOMES.volcano);
    lm.receiveShadow = false;
    b.group.add(lm);
    const lu = lm.userData.u as { uTime: { value: number } };
    b.animators.push((tt) => {
      lu.uTime.value = tt;
      lm.position.y = yAt(tt);
    });
    lavaOf = { y: yAt, s: sAt };
  }
  return raceRecord(b, path, {
    lava: lavaOf,
    id: spec.id,
    name: info.name,
    kind: spec.final ? 'final' : 'race',
    blurb: info.blurb,
    gateS,
    finishS: fs,
    gaps,
    checkpoints: checkpoints(gateS, cps.filter((s) => s > gateS + 2)),
    state,
    crown,
  });
}

/** the platform courses */
export const GEN: Record<string, GenSpec> = {
  hopscotch: { id: 'hopscotch', heading: 0, arch: PAINT.pink, steps: ['pins', 'R50', 'hop', 'S8', 'sweep', 'L70', 'planks', 'gap', 'jump', 'R45', 'turnstiles', 'up', 'mills', 'L40', 'bumpers'] },
  bonkbay: { id: 'bonkbay', heading: 0.6, arch: PAINT.teal, steps: ['bumpers', 'L60', 'wreck', 'S6', 'spinner', 'R80', 'hammers', 'gap', 'pins', 'L45', 'bounce', 'mills', 'R50', 'logs', 'sweep'] },
  knockknock: { id: 'knockknock', heading: -0.4, arch: PAINT.orange, steps: ['doors', 'R60', 'sliders', 'up', 'conveyor', 'L70', 'sweep', 'gap', 'doors', 'R45', 'logs', 'pins', 'L50', 'turnstiles'] },
  whirligig: { id: 'whirligig', heading: 1.2, arch: PAINT.purple, steps: ['turnstiles', 'L50', 'spinner', 'S8', 'mills', 'R70', 'sweep', 'hop', 'spinner', 'L60', 'bumpers', 'up', 'turnstiles'] },
  bonkalley: { id: 'bonkalley', heading: 0.2, arch: PAINT.red, steps: ['hammers', 'R60', 'logs', 'down', 'axes', 'L60', 'bounce', 'gap', 'wreck', 'R50', 'punch', 'jump', 'sliders', 'L45', 'mills'] },
  wobblewalk: { id: 'wobblewalk', heading: -1, arch: PAINT.green, steps: ['saws', 'L45', 'slides', 'R60', 'planks', 'hop', 'pins', 'L70', 'saws', 'gap', 'logs', 'R40', 'bounce', 'up', 'sweep'] },
  skystairs: { id: 'skystairs', heading: 0.9, arch: PAINT.blue, steps: ['climb', 'R50', 'conveyor', 'up', 'pins', 'L60', 'jump', 'climb', 'R70', 'sweep', 'up', 'hop', 'mills'] },
  jellyjunction: { id: 'jellyjunction', heading: -0.7, arch: PAINT.yellow, steps: ['logs', 'R45', 'sweep', 'gap', 'doors', 'L70', 'spinner', 'S6', 'gates', 'R60', 'saws', 'up', 'bumpers', 'L50', 'hammers'] },
  crownpeak: { id: 'crownpeak', heading: 0.3, arch: PAINT.yellow, final: true, steps: ['pins', 'R45', 'hammers', 'gap', 'slides', 'L60', 'punch', 'spinner', 'up', 'doors', 'R60', 'axes', 'hop', 'rolldown', 'L50', 'wreck', 'gates', 'sweep'] },
  punchline: { id: 'punchline', heading: -0.2, arch: PAINT.red, steps: ['punch', 'R50', 'gates', 'up', 'pins', 'L60', 'sweep', 'gap', 'punch', 'R45', 'spinner', 'hop', 'rolldown', 'L50', 'gates'] },
  lavarush: { id: 'lavarush', heading: 0.5, arch: PAINT.orange, lava: 118, steps: ['climb', 'up', 'rolldown', 'R50', 'gates', 'up', 'conveyor', 'up', 'hop', 'up', 'punch', 'L50', 'climb', 'up', 'rolldown'] },
  rumblehill: { id: 'rumblehill', heading: 0.8, arch: PAINT.teal, steps: ['rolldown', 'L45', 'pins', 'gates', 'R70', 'wreck', 'gap', 'rolldown', 'L50', 'punch', 'S6', 'bumpers', 'R45', 'mills'] },
};
