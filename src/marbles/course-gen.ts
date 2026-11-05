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
import { ballLook, cannon, crystal, fanGust, floatRock, geysers, ghostPads, iceSheet, jellyCube, jellyDeck, laserGate, moonField, quicksand, rapids, stamper } from './obs-world.ts';
import { gantry } from './obs-kit.ts';
import { lake, paintLakeFor } from './env.ts';
import { boostStrip, castleGate, slickField, springStrip } from './obs-fun.ts';

/**
 * Platform courses: wide padded decks floating in the sky with open edges (fall off and it's back
 * to the last checkpoint), flat or climbing, joined by turns, ramps and little hops between
 * islands. Each course is a list of obstacle zones from the kit below, so there can be lots of
 * them; every zone sets out its own floor (cmds), puts its obstacles on it (place), and says where
 * a respawn is safe and which gaps the bots must jump.
 */

const COLS = [PAINT.red, PAINT.blue, PAINT.green, PAINT.orange, PAINT.purple, PAINT.pink, PAINT.teal, PAINT.yellow];
/** an obstacle's colour: the world's own (its arches' colours), else the toy box's */
const col = (k: number) => {
  const a = biome().id === 'candy' ? COLS : biome().deck.arch;
  return a[((k % a.length) + a.length) % a.length];
};

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
/** the course's own gravity (Moon Run's is low all over: a moon zone keeps to its own) */
let GRAV = 1;
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
  /** the spring strip: the whole deck throws the field across a chasm, through the hoops */
  launch: (k) => ({
    cmds: [flat({ len: 12, w: 15, tag: k + 'pre' }), flat({ len: 7, w: 15, tag: k + 'pad' }), flat({ len: 2.5, w: 15 }), { len: 26, slope: 3, w: 15, bank: 0, wall: 0, floor: false, tag: k + 'gap' }, flat({ len: 22, w: 17, tag: k + 'land' })],
    place: ({ b, path, t }) => {
      const [p0, p1] = t(k + 'pad');
      const [l0] = t(k + 'land');
      springStrip(b, path, p0, p1, 15, { landS: l0 + 8, T: 1.6, grav: GRAV });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'land')[0] + 12],
    gaps: ({ t }) => [t(k + 'gap')],
  }),
  /** the big slide: slick and walled, a boost at the top, an S down the hill */
  slide: (k) => ({
    cmds: [flat({ len: 8, w: 12, wall: 1.5, tag: k + 'pre' }), flat({ len: 22, slope: 10, turn: 28, w: 12, wall: 1.7, easeS: 4, tag: k + 'a' }), flat({ len: 26, slope: 10, turn: -46, w: 12, wall: 1.7, tag: k + 'b' }), flat({ len: 12, slope: 7, turn: 18, w: 13, wall: 1.5, tag: k + 'c' }), flat({ len: 10, w: 14, wall: 0.8, easeS: 3, tag: k + 'post' })],
    place: ({ b, path, t }) => {
      const [p0] = t(k + 'pre');
      const [a0] = t(k + 'a');
      const [, c1] = t(k + 'c');
      boostStrip(b, path, p0 + 1.5, 11);
      slickField(b, path, a0, c1, { grip: 0.32, run: 1.32 });
      // (stars down the racing line, swinging from wall to wall)
      for (let s = a0 + 5, q = 0; s < c1 - 3; s += 3.4, q++) b.starSpots.push(path.at(s, Math.sin(q * 0.55) * 3.8, 1));
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 5],
  }),
  /** the last climb of the final: a great ramp up to the castle gate, gold balls rolling down it */
  peak: (k) => ({
    cmds: [flat({ len: 8, w: 18, tag: k + 'pre' }), flat({ len: 52, slope: -11, w: 18, wall: 1.3, easeS: 4, tag: k + 'z' }), flat({ len: 10, w: 18, wall: 1.3, easeS: 3, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0, z1] = t(k + 'z');
      rollDown(b, path, z0, z1, { lanes: [-6.8, -3.4, 0, 3.4, 6.8], period: 2.5, speed: 9.2, phase: n, colors: [PAINT.yellow, col(n), PAINT.yellow, col(n + 2), PAINT.yellow] });
      boostStrip(b, path, t(k + 'pre')[0] + 1, 16);
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 3],
  }),
  /** an uphill run with balls dropping out of hoppers at the top and rolling down at you */
  rolldown: (k) => ({
    cmds: [flat({ len: 8, w: 14, tag: k + 'pre' }), flat({ len: 40, slope: -7, w: 14, easeS: 3, tag: k + 'z' }), flat({ len: 8, w: 14, easeS: 2, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0, z1] = t(k + 'z');
      const look = ({ autumn: 'pumpkin', arctic: 'snow', desert: 'rock', volcano: 'rock' } as const)[biome().id as 'autumn'];
      rollDown(b, path, z0, z1, { lanes: [-4.8, -1.6, 1.6, 4.8], period: 3.0 + (n % 3) * 0.25, speed: 8.6, phase: n, colors: [col(n), col(n + 2), col(n + 5), col(n + 3)], ball: look ? (R, q) => ballLook(b, R, look, q) : undefined });
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
  // ---------------------------------------------------------------- the worlds' own (obs-world.ts)
  /** arctic: an ice rink, a little downhill, crystals to slide round and a sweeper on the ice */
  ice: (k) => ({
    cmds: [flat({ len: 8, w: 13, wall: 0.8, tag: k + 'pre' }), flat({ len: 44, slope: 2.5, w: 13, wall: 0.8, easeS: 3, tag: k + 'z' }), flat({ len: 6, w: 13, wall: 0.8, easeS: 3, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0, z1] = t(k + 'z');
      iceSheet(b, path, z0 - 1, z1 + 2);
      [[6, -3], [6, 3], [12, 0], [12, -5], [12, 5], [30, -2.5], [30, 2.5], [36, 0], [36, -5], [36, 5]].forEach(([ds, lat]) => crystal(b, path, z0 + ds, lat));
      const ss = z0 + 21;
      sweeper(b, path.P[path.index(ss)].clone(), frameQuat(path, ss), { len: 12, angle: (tt) => (n % 2 ? -1 : 1) * 1.2 * tt + n, paint: { a: 0x7ac8ff, b: PAINT.white, pattern: Pattern.Rings, scale: 1.3 } });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 2],
  }),
  /** beach, blossom: fans off the open edges blowing across in gusts */
  gusts: (k) => ({
    cmds: [flat({ len: 8, w: 12, tag: k + 'pre' }), flat({ len: 42, w: 11.5, easeW: 2, tag: k + 'z' }), flat({ len: 6, w: 12, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      const petals = biome().id === 'blossom';
      [7, 18, 29, 38].forEach((ds, q) => fanGust(b, path, z0 + ds, q % 2 ? -1 : 1, { phase: q * 1.7 + n, color: col(n + q * 2), petals, reach: q === 3 ? 2.6 : 3.8 }));
      for (const [ds, lat] of [[12.5, -2.5], [12.5, 2.5], [23.5, 0], [33.5, -3], [33.5, 3]]) peg(b, path, z0 + ds, lat, { r: 0.42, paint: { a: col(n + 3), b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 2],
  }),
  /** neon: laser gates, bobbing and rocking: hop the low ones, run under the high */
  lasers: (k) => ({
    cmds: [flat({ len: 8, w: 13, wall: 1.0, tag: k + 'pre' }), flat({ len: 46, w: 13, wall: 1.0, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      const cols = [0xff3aa0, 0x30e0ff, 0xffd040, 0x9a5bff, 0x40ff90];
      [6, 14, 22, 30, 38].forEach((ds, q) => laserGate(b, path, z0 + ds, { kind: q % 2 ? 'rock' : 'bob', period: 3.6 + (q % 3) * 0.3, phase: q * 1.1 + n * 0.4, color: cols[(q + n) % cols.length] }));
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** spooky: ghost platforms fading in and out over a drop */
  ghosts: (k) => ({
    cmds: [flat({ len: 8, w: 11, wall: 0.6, tag: k + 'pre' }), flat({ len: 23, w: 11, floor: false, tag: k + 'z' }), flat({ len: 8, w: W, easeW: 3, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0, z1] = t(k + 'z');
      ghostPads(b, path, z0, z1, { phase: n * 0.7 });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 3],
  }),
  /** volcano: lava vents that blow */
  geysers: (k) => ({
    cmds: [flat({ len: 8, w: 13, wall: 0.8, tag: k + 'pre' }), flat({ len: 40, slope: -3, w: 13, wall: 0.8, easeS: 3, tag: k + 'z' }), flat({ len: 6, w: 13, wall: 0.8, easeS: 3, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      geysers(b, path, z0, z0 + 40, { phase: n, spots: [[5, -3.4], [5, 3.4], [11, 0], [17, -4.2], [17, 4.2], [17, 0], [24, -2], [24, 2.6], [31, -4.2], [31, 0.8], [36, 3.8], [36, -1.6]] });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 2],
  }),
  /** desert: quicksand pits between cacti */
  quicksand: (k) => ({
    cmds: [flat({ len: 8, w: 15, tag: k + 'pre' }), flat({ len: 40, w: 15, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      quicksand(b, path, z0, [[5, -3.5, 2.6], [6, 3.8, 2.3], [13, 0, 2.8], [20, -4.4, 2.5], [21, 3.2, 2.7], [28, -0.6, 2.9], [35, 4.2, 2.4], [35.5, -4, 2.4]]);
      for (const [ds, lat] of [[9.5, -0.2], [16.5, -4.6], [16.5, 4.6], [24.5, 1.6], [31.5, -3.2], [31.5, 4.5]]) peg(b, path, z0 + ds, lat, { r: 0.4, h: 1.9, paint: { a: 0x3a9a4a, b: 0x2a7a3a, pattern: Pattern.Stripes, scale: 3.4 } });
      void n;
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** jungle: streams rushing across toward the open side */
  rapids: (k) => ({
    cmds: [flat({ len: 8, w: 13, wall: 1.0, tag: k + 'pre' }), flat({ len: 36, w: 13, wallL: 1.2, wallR: 0, tag: k + 'z' }), flat({ len: 6, w: 13, wall: 1.0, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      rapids(b, path, z0 + 6, 4.2, { force: 28 + (n % 3) * 2 });
      rapids(b, path, z0 + 17, 5.4, { force: 32 });
      rapids(b, path, z0 + 29, 4.6, { force: 30 });
      for (const [ds, lat] of [[11.5, -3], [11.5, 2.5], [23, 0], [23, -4.5]]) bumper(b, path, z0 + ds, lat, { color: col(n + Math.round(ds)) });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 2],
  }),
  /** royal: cannons each side firing balls across the deck */
  cannons: (k) => ({
    cmds: [flat({ len: 8, w: 13, tag: k + 'pre' }), flat({ len: 44, w: 13, tag: k + 'z' }), flat({ len: 6, w: 13, tag: k + 'post' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [5, 11.5, 18, 24.5, 31, 37.5].forEach((ds, q) => cannon(b, path, z0 + ds, q % 2 ? 1 : -1, { period: 2.8 + (q % 3) * 0.3, phase: q * 0.9 + n * 0.5, color: col(n + q) }));
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'post')[0] + 2],
  }),
  /** clockwork: pistons slamming down from gantries */
  stampers: (k) => ({
    cmds: [flat({ len: 8, w: 13, wall: 1.0, tag: k + 'pre' }), flat({ len: 42, w: 13, wall: 1.0, tag: k + 'z' })],
    place: ({ b, path, t, n }) => {
      const [z0] = t(k + 'z');
      [6, 16, 26, 36].forEach((ds, q) => {
        gantry(b, path, z0 + ds, 6.2, { paint: b.paint({ a: col(n + q), b: PAINT.black, pattern: Pattern.Stripes, scale: 1.2 }) });
        [-4.1, 0, 4.1].forEach((lat, l) => stamper(b, path, z0 + ds, lat, { period: 2.6 + (q % 2) * 0.3, phase: l * 0.85 + q * 0.4 + n, color: col(n + q + l) }));
      });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1],
  }),
  /** candy, sunset: jelly decks that bounce you, with gaps you need the bounce for */
  jelly: (k) => ({
    cmds: [
      flat({ len: 8, w: 12, tag: k + 'pre' }),
      flat({ len: 9, w: 12, tag: k + 'j0' }),
      flat({ len: 6.0, w: 12, floor: false, tag: k + 'g0' }),
      flat({ len: 10, w: 12, tag: k + 'j1' }),
      flat({ len: 6.0, w: 12, floor: false, tag: k + 'g1' }),
      flat({ len: 9, w: 12, tag: k + 'j2' }),
      flat({ len: 6, w: W, easeW: 2, tag: k + 'post' }),
    ],
    place: ({ b, path, t, n }) => {
      const jc = biome().id === 'sunset' ? 0xffa060 : 0xff6ab0;
      for (const j of ['j0', 'j1', 'j2']) {
        const [a, c] = t(k + j);
        jellyDeck(b, path, j === 'j0' ? a - 2 : a, c, { color: jc });
      }
      const [a1] = t(k + 'j1');
      jellyCube(b, path, a1 + 5, -3.2, { color: col(n) });
      jellyCube(b, path, a1 + 5, 3.2, { color: col(n + 2) });
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'j1')[0] + 4, t(k + 'post')[0] + 3],
    gaps: ({ t }) => [t(k + 'g0'), t(k + 'g1')],
  }),
  /** space: low gravity, islands with huge gaps between */
  moon: (k) => ({
    cmds: [
      flat({ len: 8, w: 12, tag: k + 'pre' }),
      flat({ len: 6, w: 12, tag: k + 'm0' }),
      flat({ len: 9, w: 11, floor: false, tag: k + 'g0' }),
      flat({ len: 13, w: 10 }),
      flat({ len: 10, w: 10, floor: false, tag: k + 'g1' }),
      flat({ len: 13, w: 10, tag: k + 'mid' }),
      flat({ len: 10, w: 10, floor: false, tag: k + 'g2' }),
      flat({ len: 8, w: W, easeW: 3, tag: k + 'post' }),
    ],
    place: ({ b, path, t, n }) => {
      const [m0] = t(k + 'm0');
      const [, p1] = t(k + 'post');
      moonField(b, path, m0 - 2, p1 - 2, 0.42 / GRAV);
      arch(b, path, m0 + 1, 'LOW GRAVITY', { color: 0x9a7aff, text2: 'Big jumps' });
      for (const g of ['g0', 'g1', 'g2']) {
        const [a, c] = t(k + g);
        const m = (a + c) / 2;
        for (const side of [-1, 1]) floatRock(b, path.at(m, side * (8 + (n % 3)), -2.5 + side), 1.6 + ((n + side) % 2) * 0.6, n + side * 3 + a);
      }
    },
    cps: ({ t }) => [t(k + 'pre')[0] + 1, t(k + 'mid')[0] + 3, t(k + 'post')[0] + 3],
    gaps: ({ t }) => [t(k + 'g0'), t(k + 'g1'), t(k + 'g2')],
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
  /** the whole course: gravity's scale (Moon Run), the feet's grip (Slip Rink) */
  grav?: number;
  grip?: number;
  /** under the name on the start arch */
  tag?: string;
}

export function genCourse(spec: GenSpec, info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  GRAV = spec.grav ?? 1;
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
  arch(b, path, gateS + 2.5, info.name.toUpperCase(), { color: spec.arch, text2: spec.final ? 'The Final · First takes the crown' : spec.tag ?? 'Race' });
  if (spec.grav || spec.grip) {
    // the whole course's own rules: a box round all of it
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of path.P) min.min(p), max.max(p);
    min.addScalar(-30);
    max.addScalar(30);
    b.world.fields.push({ min, max, g: spec.grav, grip: spec.grip });
    // (Slip Rink: ice laid over every floor)
    if (spec.grip) {
      let a = -1;
      for (let i = 0; i < path.count; i++) {
        const on = path.sec[i].floor && i * 0.25 > gateS + 3;
        if (on && a < 0) a = i;
        if ((!on || i === path.count - 1) && a >= 0) {
          if ((i - a) * 0.25 > 2) iceSheet(b, path, a * 0.25, (i - 1) * 0.25, { field: false });
          a = -1;
        }
      }
    }
  }
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
  // (a boost out of every other corner: the racing line pays)
  turns.forEach((u, q) => {
    if (q % 2 === 0 && path.sec[path.index(u.s1 + 3)].floor) boostStrip(b, path, u.s1 + 0.5, 7);
  });
  let crown: THREE.Object3D | undefined;
  if (spec.final) {
    crown = makeCrown();
    crown.position.copy(path.at(fs + 6, 0, 3.1));
    b.group.add(crown);
    castleGate(b, path, fs + 1.5, 15);
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
  hopscotch: { id: 'hopscotch', heading: 0, arch: PAINT.pink, steps: ['pins', 'R50', 'hop', 'S8', 'sweep', 'L70', 'launch', 'planks', 'gap', 'jump', 'R45', 'jelly', 'up', 'mills', 'L40', 'bumpers'] },
  bonkbay: { id: 'bonkbay', heading: 0.6, arch: PAINT.teal, steps: ['bumpers', 'L60', 'wreck', 'S6', 'spinner', 'R80', 'slide', 'hammers', 'gap', 'pins', 'L45', 'bounce', 'mills', 'R50', 'gusts', 'sweep'] },
  knockknock: { id: 'knockknock', heading: -0.4, arch: PAINT.orange, steps: ['doors', 'R60', 'sliders', 'up', 'conveyor', 'launch', 'L70', 'ghosts', 'doors', 'R45', 'logs', 'pins', 'L50', 'turnstiles'] },
  whirligig: { id: 'whirligig', heading: 1.2, arch: PAINT.purple, steps: ['turnstiles', 'L50', 'spinner', 'S8', 'slide', 'mills', 'R70', 'sweep', 'moon', 'spinner', 'L60', 'bumpers', 'up', 'turnstiles'] },
  bonkalley: { id: 'bonkalley', heading: 0.2, arch: PAINT.red, steps: ['hammers', 'R60', 'rolldown', 'launch', 'axes', 'L60', 'bounce', 'gap', 'wreck', 'R50', 'punch', 'jump', 'sliders', 'L45', 'mills'] },
  wobblewalk: { id: 'wobblewalk', heading: -1, arch: PAINT.green, steps: ['saws', 'L45', 'slides', 'R60', 'planks', 'hop', 'slide', 'pins', 'L70', 'saws', 'gap', 'rapids', 'R40', 'bounce', 'up', 'sweep'] },
  skystairs: { id: 'skystairs', heading: 0.9, arch: PAINT.blue, steps: ['climb', 'R50', 'conveyor', 'up', 'ice', 'L60', 'launch', 'jump', 'climb', 'R70', 'sweep', 'up', 'hop', 'mills'] },
  jellyjunction: { id: 'jellyjunction', heading: -0.7, arch: PAINT.yellow, steps: ['logs', 'R45', 'sweep', 'gap', 'doors', 'L70', 'launch', 'spinner', 'S6', 'jelly', 'R60', 'saws', 'up', 'bumpers', 'L50', 'hammers'] },
  crownpeak: { id: 'crownpeak', heading: 0.3, arch: PAINT.yellow, final: true, steps: ['pins', 'up', 'R45', 'hammers', 'climb', 'launch', 'L60', 'punch', 'spinner', 'up', 'doors', 'R60', 'axes', 'rolldown', 'hop', 'up', 'L50', 'wreck', 'climb', 'cannons', 'launch', 'R45', 'sweep', 'peak'] },
  punchline: { id: 'punchline', heading: -0.2, arch: PAINT.red, steps: ['punch', 'R50', 'gates', 'up', 'slide', 'lasers', 'L60', 'sweep', 'gap', 'punch', 'R45', 'spinner', 'hop', 'rolldown', 'L50', 'gates'] },
  lavarush: { id: 'lavarush', heading: 0.5, arch: PAINT.orange, lava: 122, steps: ['climb', 'up', 'rolldown', 'R50', 'geysers', 'up', 'conveyor', 'up', 'hop', 'up', 'punch', 'L50', 'climb', 'up', 'rolldown'] },
  rumblehill: { id: 'rumblehill', heading: 0.8, arch: PAINT.teal, steps: ['rolldown', 'L45', 'quicksand', 'gates', 'slide', 'R70', 'wreck', 'gap', 'rolldown', 'L50', 'punch', 'S6', 'bumpers', 'R45', 'mills'] },
  // the new worlds and the new modes
  petalpass: { id: 'petalpass', heading: 0.4, arch: PAINT.pink, tag: 'Race · Mind the wind', steps: ['pins', 'L50', 'gusts', 'up', 'slides', 'launch', 'R60', 'jelly', 'gap', 'gusts', 'L45', 'planks', 'hop', 'sweep'] },
  ticktock: { id: 'ticktock', heading: -0.9, arch: PAINT.orange, tag: 'Race · Clockwork', steps: ['stampers', 'R50', 'conveyor', 'up', 'launch', 'spinner', 'L60', 'sliders', 'gap', 'stampers', 'R45', 'gates', 'hop', 'turnstiles', 'L40', 'stampers'] },
  moonrun: { id: 'moonrun', heading: 1.6, arch: PAINT.purple, grav: 0.62, tag: 'Race · Low gravity all the way', steps: ['moon', 'R45', 'turnstiles', 'lasers', 'launch', 'L60', 'moon', 'up', 'spinner', 'R50', 'moon'] },
  discodash: { id: 'discodash', heading: 0.2, arch: PAINT.pink, tag: 'Race · On the beat', steps: ['lasers', 'R50', 'spinner', 'S6', 'slide', 'sweep', 'L60', 'turnstiles', 'up', 'lasers', 'R45', 'hop', 'mills'] },
  bigtop: { id: 'bigtop', heading: -0.6, arch: PAINT.orange, tag: 'Race · Roll up, roll up', steps: ['bounce', 'L50', 'hammers', 'S6', 'launch', 'planks', 'R60', 'wreck', 'gap', 'bumpers', 'L45', 'jelly', 'sweep'] },
  treasuretrail: { id: 'treasuretrail', heading: 1.1, arch: PAINT.teal, tag: 'Race · Mind the cannons', steps: ['cannons', 'R50', 'planks', 'hop', 'launch', 'rapids', 'L60', 'gusts', 'up', 'cannons', 'R45', 'sliders', 'gap'] },
  blockparty: { id: 'blockparty', heading: -1.0, arch: PAINT.blue, tag: 'Race · Through the toy box', steps: ['stampers', 'L50', 'rolldown', 'R60', 'slide', 'jelly', 'sliders', 'up', 'doors', 'L45', 'stampers', 'mills'] },
  sliprink: { id: 'sliprink', heading: -1.3, arch: PAINT.blue, grip: 0.3, tag: 'Race · Everything is ice', steps: ['pins', 'R50', 'rolldown', 'L60', 'launch', 'doors', 'up', 'mills', 'R45', 'turnstiles', 'S6', 'hammers'] },
};
