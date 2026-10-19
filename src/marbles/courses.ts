import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, cylAttr, flatAttr, type Cmd } from './builder.ts';
import { arch, bumper, bunting, doorWall, floorStripe, frameQuat, hammer, kicker, peg, signTexture, slider, startGate, sweeper, turntable } from './obstacles.ts';
import { Kin, Mat } from './physics.ts';
import { Pattern, woodAttr } from './shaders.ts';

/**
 * The show's rounds. Races are one long downhill chute with its obstacles; the survival round is a
 * painted plate with two turning bars (jump the low one, don't jump into the high one).
 */

export type RoundKind = 'race' | 'survival' | 'final';

export interface Course {
  id: string;
  name: string;
  kind: RoundKind;
  blurb: string;
  b: CourseBuilder;
  path: Path | null;
  finishS: number;
  /** jumps the AI has to make: [takeoff s, landing s] */
  gaps: [number, number][];
  checkpoints: number[];
  /** below this a marble is out (a fall) */
  killY: number;
  lakeY: number;
  state: { go: number };
  grid(n: number): { pos: THREE.Vector3; yaw: number }[];
  /** the survival plate */
  plate?: { center: THREE.Vector3; radius: number; bars: { angle: (t: number) => number; height: number; kin: Kin; on: (t: number) => boolean }[] };
  /** the crown on its pedestal (the final) */
  crown?: THREE.Object3D;
  /** for the flyover */
  intro: THREE.Vector3[];
}

const ROUNDS = ['timber', 'paintmill', 'jumpclub', 'summit'] as const;
export type RoundId = (typeof ROUNDS)[number];
export const SHOW: { id: RoundId; name: string; kind: RoundKind; blurb: string }[] = [
  { id: 'timber', name: 'Timber Tumble', kind: 'race', blurb: 'Pegs, sweepers, one big jump and a spiral to the line' },
  { id: 'paintmill', name: 'Paint Mill', kind: 'race', blurb: 'Hammers, bumpers, a turntable and the door wall' },
  { id: 'jumpclub', name: 'Jump Club', kind: 'survival', blurb: 'Jump the low bar. Never jump into the high one.' },
  { id: 'summit', name: 'Crown Summit', kind: 'final', blurb: 'First across the line takes the crown' },
];

function raceGrid(path: Path, gateS: number) {
  return (n: number) => {
    const out: { pos: THREE.Vector3; yaw: number }[] = [];
    const across = 7, dl = 1.55, dr = 1.6;
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / across), col = k % across;
      const lat = (col - (across - 1) / 2) * dr + (row % 2 ? 0.4 : -0.4);
      const s = gateS - 1.1 - row * dr;
      const i = path.index(s);
      out.push({ pos: path.at(s, lat, 0.52), yaw: Math.atan2(path.T[i].x, path.T[i].z) });
      void dl;
    }
    return out;
  };
}

function finishDressing(b: CourseBuilder, path: Path, fs: number, name: string) {
  floorStripe(b, path, fs, 1.4, { a: PAINT.white, b: PAINT.black, pattern: Pattern.Checks, scale: 1.4, wear: 0.03 });
  arch(b, path, fs, 'FINISH', { color: PAINT.red });
  void name;
}

function lakeBelow(path: Path) {
  let lo = Infinity;
  for (const p of path.P) lo = Math.min(lo, p.y);
  return lo - 30;
}

function introOf(path: Path) {
  const pts: THREE.Vector3[] = [];
  for (let s = 0; s < path.length; s += 6) pts.push(path.at(s, 0, 0));
  return pts;
}

function tag(path: Path, t: string) {
  const r = path.tags.get(t);
  if (!r) throw new Error('no tag ' + t);
  return r;
}

// -------------------------------------------------------------------------------------------
function timber(): Course {
  const b = new CourseBuilder();
  const cmds: Cmd[] = [
    { len: 24, slope: 1.5, w: 17, wall: 1.6, tag: 'start' },
    { len: 18, slope: 7, w: 10, easeW: 8, tag: 'funnel' },
    { len: 30, turn: -45, slope: 8, w: 10 },
    { len: 44, slope: 8, w: 12, tag: 'pegs' },
    { len: 30, turn: 75, slope: 6, w: 8.5, wall: 2.0, tag: 's1' },
    { len: 30, turn: -85, slope: 6, w: 8.5, wall: 2.0 },
    { len: 18, slope: 3, w: 10, wall: 1.6, tag: 'kick' },
    { len: 5.5, slope: 8, floor: false, tag: 'gap' },
    { len: 14, slope: 2, w: 14, tag: 'land' },
    { len: 52, slope: 3, w: 15, tag: 'sweep' },
    { len: 8, slope: 5, w: 9.5, easeW: 5, wall: 2.4 },
    { len: 160, turn: 540, slope: 6, w: 9.5, wall: 2.4, bank: 22, tag: 'helix' },
    { len: 32, slope: 3, w: 12, wall: 1.8, tag: 'finish' },
    { len: 20, slope: -7, w: 16, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 160, 0), 0, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  const state = { go: 1e9 };
  const [st0] = tag(path, 'start');
  const gateS = st0 + 17;
  startGate(b, path, gateS, state);
  arch(b, path, gateS + 2.5, 'TIMBER TUMBLE', { color: PAINT.blue, text2: 'Round 1 · Race' });
  // the peg field: staggered rows of candy pegs
  const [p0, p1] = tag(path, 'pegs');
  let row = 0;
  for (let s = p0 + 6; s < p1 - 5; s += 3.6, row++) {
    for (let k = -2; k <= 2; k++) {
      const lat = k * 3 + (row % 2 ? 1.5 : 0);
      if (Math.abs(lat) > 5.2) continue;
      peg(b, path, s, lat, { paint: { a: row % 3 === 0 ? PAINT.red : row % 3 === 1 ? PAINT.blue : PAINT.green, b: PAINT.white, pattern: Pattern.Stripes, scale: 2.4 } });
    }
  }
  // the kicker and its gap
  const [, k1] = tag(path, 'kick');
  kicker(b, path, k1, { len: 4.5, h: 0.9 });
  const [g0, g1] = tag(path, 'gap');
  // sweepers
  const [w0] = tag(path, 'sweep');
  for (const [ds, om, col] of [
    [15, 1.35, PAINT.yellow],
    [38, -1.6, PAINT.orange],
  ] as const) {
    const s = w0 + ds;
    const i = path.index(s);
    sweeper(b, path.P[i].clone(), frameQuat(path, s), { len: 14.4, angle: (t) => om * t + ds, paint: { a: col, b: PAINT.black, pattern: Pattern.Rings, scale: 1.3 } });
  }
  const [f0] = tag(path, 'finish');
  const fs = f0 + 18;
  finishDressing(b, path, fs, 'Timber Tumble');
  const [c0, c1] = tag(path, 'catch');
  bunting(b, path, 0, 120);
  bunting(b, path, f0 - 10, c1);
  endWall(b, path, c1 - 0.5);
  void c0;
  b.finish();
  return {
    id: 'timber',
    name: 'Timber Tumble',
    kind: 'race',
    blurb: SHOW[0].blurb,
    b,
    path,
    finishS: fs,
    gaps: [[g0, g1]],
    checkpoints: checkpointsOf(path, gateS, fs, [[g0 - 18, g1 + 2]]),
    killY: b.lakeY + 4,
    lakeY: b.lakeY,
    state,
    grid: raceGrid(path, gateS),
    intro: introOf(path),
  };
}

// -------------------------------------------------------------------------------------------
function paintmill(): Course {
  const b = new CourseBuilder();
  const cmds: Cmd[] = [
    { len: 24, slope: 1.5, w: 17, wall: 1.6, tag: 'start' },
    { len: 14, slope: 6, w: 11, easeW: 7 },
    { len: 52, slope: 3.5, w: 11, wall: 1.5, tag: 'hammers' },
    { len: 26, turn: 90, slope: 5, w: 10, wall: 1.9 },
    { len: 40, slope: 5, w: 16, easeW: 5, wall: 1.6, tag: 'bumpers' },
    { len: 5, slope: 1, w: 17.4, easeW: 2 },
    { len: 17, slope: 0, w: 17.4, floor: false, tag: 'turntable' },
    { len: 5, slope: 2, w: 13, easeW: 3 },
    { len: 30, turn: -70, slope: 5, w: 12 },
    { len: 44, slope: 3, w: 12, tag: 'sliders' },
    { len: 22, slope: 1, w: 14, easeW: 4, tag: 'doors' },
    { len: 40, turn: 40, slope: 9, w: 10, tag: 'drop' },
    { len: 30, slope: 2, w: 12, tag: 'finish' },
    { len: 18, slope: -7, w: 16, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 150, 0), 0.4, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  const state = { go: 1e9 };
  const [st0] = tag(path, 'start');
  const gateS = st0 + 17;
  startGate(b, path, gateS, state);
  arch(b, path, gateS + 2.5, 'PAINT MILL', { color: PAINT.purple, text2: 'Round 2 · Race' });
  const [h0] = tag(path, 'hammers');
  const cols = [PAINT.red, PAINT.blue, PAINT.green, PAINT.orange];
  [9, 20, 31, 42].forEach((ds, k) => hammer(b, path, h0 + ds, { amp: 1.05, period: 2.5 + k * 0.25, phase: k * 1.7, color: cols[k] }));
  const [bm0] = tag(path, 'bumpers');
  const rows: number[][] = [[-4.5, 0, 4.5], [-6.2, -2.25, 2.25, 6.2], [-4.5, 0, 4.5], [-2.25, 2.25]];
  const bcol = [PAINT.pink, PAINT.teal, PAINT.yellow, PAINT.purple];
  rows.forEach((r, k) => r.forEach((lat) => bumper(b, path, bm0 + 8 + k * 8, lat, { color: bcol[k] })));
  // the turntable fills the gap; guard walls along its sides
  const [t0, t1] = tag(path, 'turntable');
  const tc = (t0 + t1) / 2;
  const ti = path.index(tc);
  const tq = frameQuat(path, tc);
  turntable(b, path.P[ti].clone(), tq, { r: 8.35, omega: 0.75, fins: 2 });
  for (const side of [-1, 1]) {
    const k = new Kin({ type: 'box', hx: 0.18, hy: 0.8, hz: (t1 - t0) / 2 + 0.3 }, Mat.Wood);
    k.pos.copy(path.at(tc, side * 8.9, 0.5));
    k.quat.copy(tq);
    b.world.addKin(k);
    const g = woodAttr(new THREE.BoxGeometry(0.36, 1.6, t1 - t0 + 0.6), 'z', side);
    const mesh = new THREE.Mesh(g, b.railWood);
    mesh.position.copy(k.pos);
    mesh.quaternion.copy(tq);
    mesh.castShadow = mesh.receiveShadow = true;
    b.group.add(mesh);
  }
  const [sl0] = tag(path, 'sliders');
  [8, 17, 26, 35].forEach((ds, k) => slider(b, path, sl0 + ds, { period: 2.8 + k * 0.3, phase: k * 1.9, color: [PAINT.orange, PAINT.green, PAINT.blue, PAINT.red][k] }));
  const [d0, d1] = tag(path, 'doors');
  doorWall(b, path, (d0 + d1) / 2, { doors: 5, seed: 7 });
  const [f0] = tag(path, 'finish');
  const fs = f0 + 18;
  finishDressing(b, path, fs, 'Paint Mill');
  const [, c1] = tag(path, 'catch');
  bunting(b, path, 0, 90);
  bunting(b, path, f0 - 10, c1);
  endWall(b, path, c1 - 0.5);
  b.finish();
  return {
    id: 'paintmill',
    name: 'Paint Mill',
    kind: 'race',
    blurb: SHOW[1].blurb,
    b,
    path,
    finishS: fs,
    gaps: [],
    checkpoints: checkpointsOf(path, gateS, fs, [[t0 - 4, t1 + 3]]),
    killY: b.lakeY + 4,
    lakeY: b.lakeY,
    state,
    grid: raceGrid(path, gateS),
    intro: introOf(path),
  };
}

// -------------------------------------------------------------------------------------------
function jumpclub(): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 120, 0);
  const RAD = 13;
  b.lakeY = center.y - 34;
  const state = { go: 1e9 };
  // the plate: a painted top on a thick wooden drum
  const TH = 1.0;
  const top = flatAttr(new THREE.CircleGeometry(RAD, 96).rotateX(-Math.PI / 2));
  top.translate(center.x, center.y, center.z);
  b.solid(top, b.paint({ a: PAINT.yellow, b: PAINT.orange, pattern: Pattern.Spiral, scale: 0.36, wear: 0.08 }), Mat.Paint);
  const side = woodAttr(new THREE.CylinderGeometry(RAD, RAD * 0.96, TH, 96, 1, true), 'y');
  side.translate(center.x, center.y - TH / 2, center.z);
  b.solid(side, b.railWood, Mat.Wood);
  const under = flatAttr(new THREE.CircleGeometry(RAD * 0.96, 64).rotateX(Math.PI / 2));
  under.translate(center.x, center.y - TH, center.z);
  b.batch.add(b.railWood, under);
  // a ring of white paint at the edge (the danger line)
  const ring = flatAttr(new THREE.RingGeometry(RAD - 0.7, RAD - 0.35, 96).rotateX(-Math.PI / 2));
  ring.translate(center.x, center.y + 0.01, center.z);
  const rm = b.paint({ a: PAINT.white, b: PAINT.white, pattern: Pattern.Solid, wear: 0.05 });
  const rmesh = new THREE.Mesh(ring, rm);
  rmesh.receiveShadow = true;
  b.group.add(rmesh);
  // the pedestal under it, down into the lake
  const ped = woodAttr(new THREE.CylinderGeometry(3.2, 4.5, center.y - b.lakeY, 24, 1, true), 'y');
  ped.translate(center.x, (center.y + b.lakeY) / 2 - TH, center.z);
  b.batch.add(b.postWood, ped);
  // the hub and the two bars
  const hubH = 1.6;
  const hub = new Kin({ type: 'cyl', r: 1.15, hh: hubH / 2 }, Mat.Paint);
  hub.pos.copy(center).add(new THREE.Vector3(0, hubH / 2, 0));
  const hg = new THREE.Group();
  hg.add(new THREE.Mesh(cylAttr(new THREE.CylinderGeometry(1.15, 1.25, hubH, 40)), b.paint({ a: PAINT.red, b: PAINT.white, pattern: Pattern.Stripes, scale: 1.8 })));
  const dome = new THREE.Mesh(cylAttr(new THREE.SphereGeometry(1.15, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2)), b.paint({ a: PAINT.yellow, b: PAINT.yellow, pattern: Pattern.Solid }));
  dome.position.y = hubH / 2;
  hg.add(dome);
  b.obstacle(hub, hg, false);
  // the bars speed up: ω = 0.55 + 0.012·τ rad/s (a full turn every 11 s at the start, every 4 s by the minute)
  const ang = (off: number, dir: number) => (t: number) => {
    const tau = Math.max(0, t - state.go);
    return off + dir * (0.55 * tau + 0.006 * tau * tau);
  };
  const lowA = ang(0, 1), highA = ang(Math.PI / 2, 1);
  // the high bar rises out of the plate 15 s in
  const HIGH_AT = 15;
  const highH = (t: number) => {
    const k = THREE.MathUtils.clamp((t - state.go - HIGH_AT) / 2.5, 0, 1);
    return -2.6 + (2.05 + 2.6) * k * k * (3 - 2 * k);
  };
  const low = sweeper(b, center.clone(), new THREE.Quaternion(), { len: RAD * 2 + 1.6, r: 0.36, height: 0.56, angle: lowA, paint: { a: PAINT.blue, b: PAINT.white, pattern: Pattern.Rings, scale: 1.2 }, hub: 0.01 });
  const high = sweeper(b, center.clone(), new THREE.Quaternion(), { len: RAD * 2 + 1.6, r: 0.36, height: 2.05, heightAt: highH, angle: highA, paint: { a: PAINT.red, b: PAINT.white, pattern: Pattern.Rings, scale: 1.2 }, hub: 0.01 });
  // (the sweepers' own posts are hidden inside the hub)
  // bunting poles round the edge
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshPhysicalMaterial({ map: signTexture('JUMP CLUB', 'Round 3 · Survival', PAINT.blue), roughness: 0.4, clearcoat: 0.8 }));
  sign.position.set(center.x, center.y + 7.5, center.z - RAD - 3);
  b.group.add(sign);
  const signBoard = new THREE.Mesh(woodAttr(new THREE.BoxGeometry(9.4, 2.0, 0.3), 'x'), b.railWood);
  signBoard.position.copy(sign.position).add(new THREE.Vector3(0, 0, -0.18));
  b.group.add(signBoard);
  for (const sx of [-4.2, 4.2]) {
    const post = new THREE.Mesh(woodAttr(new THREE.BoxGeometry(0.4, 12, 0.4), 'y'), b.railWood);
    post.position.set(center.x + sx, center.y + 1.5, center.z - RAD - 3.3);
    b.group.add(post);
  }
  b.finish();
  return {
    id: 'jumpclub',
    name: 'Jump Club',
    kind: 'survival',
    blurb: SHOW[2].blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: center.y - 5,
    lakeY: b.lakeY,
    state,
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + 0.3;
        const r = 7.5 + (k % 2) * 2.2;
        const pos = new THREE.Vector3(center.x + Math.cos(a) * r, center.y + 0.52, center.z + Math.sin(a) * r);
        out.push({ pos, yaw: Math.atan2(center.x - pos.x, center.z - pos.z) });
      }
      return out;
    },
    plate: {
      center,
      radius: RAD,
      bars: [
        { angle: lowA, height: 0.56, kin: low, on: () => true },
        { angle: highA, height: 2.05, kin: high, on: (t: number) => highH(t) > 1.6 },
      ],
    },
    intro: [],
  };
}

// -------------------------------------------------------------------------------------------
function summit(): Course {
  const b = new CourseBuilder();
  const cmds: Cmd[] = [
    { len: 24, slope: 1.5, w: 17, wall: 1.6, tag: 'start' },
    { len: 20, slope: 8, w: 10, easeW: 8 },
    { len: 10, slope: 3, w: 6, wall: 0, easeW: 4 },
    { len: 34, slope: 3, w: 4.4, wall: 0, easeW: 3, tag: 'beam' },
    { len: 8, slope: 2, w: 14, wall: 1.4, easeW: 3 },
    { len: 34, slope: 2, w: 15, tag: 'spin' },
    { len: 30, turn: 120, slope: 7, w: 9, wall: 2.0 },
    { len: 44, slope: 3.5, w: 10.5, wall: 1.5, tag: 'hammers' },
    { len: 16, slope: 3, w: 10, tag: 'kick' },
    { len: 5.5, slope: 6, floor: false, tag: 'gap' },
    { len: 16, slope: 2, w: 14, tag: 'land' },
    { len: 30, turn: -60, slope: 6, w: 10, wall: 1.8 },
    { len: 30, slope: 1.5, w: 12, tag: 'sliders' },
    { len: 24, slope: -2, w: 12, tag: 'finish' },
    { len: 16, slope: -7, w: 16, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 150, 0), -0.6, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  const state = { go: 1e9 };
  const [st0] = tag(path, 'start');
  const gateS = st0 + 17;
  startGate(b, path, gateS, state);
  arch(b, path, gateS + 2.5, 'CROWN SUMMIT', { color: PAINT.yellow, text2: 'Final · First takes the crown' });
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
  [9, 21, 33].forEach((ds, k) => hammer(b, path, h0 + ds, { amp: 1.08, period: 2.2 + k * 0.2, phase: k * 2.1, color: [PAINT.blue, PAINT.red, PAINT.green][k] }));
  const [, k1] = tag(path, 'kick');
  kicker(b, path, k1, { len: 4.5, h: 0.9 });
  const [g0, g1] = tag(path, 'gap');
  const [sl0] = tag(path, 'sliders');
  [7, 15, 23].forEach((ds, k) => slider(b, path, sl0 + ds, { period: 2.4 + k * 0.35, phase: k * 2.3, size: 2.8, color: [PAINT.red, PAINT.yellow, PAINT.blue][k] }));
  const [f0] = tag(path, 'finish');
  const fs = f0 + 15;
  finishDressing(b, path, fs, 'Crown Summit');
  // the crown on its pedestal past the line
  const crown = makeCrown();
  crown.position.copy(path.at(fs + 6, 0, 3.1));
  b.group.add(crown);
  const ped = new THREE.Mesh(cylAttr(new THREE.CylinderGeometry(0.9, 1.1, 2.2, 32)), b.paint({ a: PAINT.purple, b: PAINT.yellow, pattern: Pattern.Stripes, scale: 1.6 }));
  ped.position.copy(path.at(fs + 6, 0, 1.1));
  ped.castShadow = ped.receiveShadow = true;
  b.group.add(ped);
  const pk = new Kin({ type: 'cyl', r: 1.0, hh: 1.1 }, Mat.Paint);
  pk.pos.copy(ped.position);
  b.world.addKin(pk);
  const [, c1] = tag(path, 'catch');
  bunting(b, path, 0, 50);
  bunting(b, path, f0 - 10, c1);
  endWall(b, path, c1 - 0.5);
  b.finish();
  const [bm0, bm1] = tag(path, 'beam');
  return {
    id: 'summit',
    name: 'Crown Summit',
    kind: 'final',
    blurb: SHOW[3].blurb,
    b,
    path,
    finishS: fs,
    gaps: [[g0, g1]],
    checkpoints: checkpointsOf(path, gateS, fs, [[g0 - 18, g1 + 2], [bm0 - 6, bm1 + 4]]),
    killY: b.lakeY + 4,
    lakeY: b.lakeY,
    state,
    grid: raceGrid(path, gateS),
    crown,
    intro: introOf(path),
  };
}

/** checkpoints every ~25 m (none inside a jump or on a beam: a respawn there would drop you in again) */
function checkpointsOf(path: Path, from: number, to: number, avoid: [number, number][]) {
  const out = [from - 3];
  for (let s = from + 20; s < to; s += 22) {
    if (avoid.some(([a, b]) => s > a && s < b)) continue;
    out.push(s);
  }
  void path;
  return out;
}

/** a padded wall at the end of the catch area */
function endWall(b: CourseBuilder, path: Path, s: number) {
  const i = path.index(s);
  const sec = path.sec[i];
  const q = frameQuat(path, s);
  const k = new Kin({ type: 'box', hx: sec.w / 2 + 0.3, hy: 1.2, hz: 0.3 }, Mat.Felt);
  k.pos.copy(path.at(s, 0, 1.0));
  k.quat.copy(q);
  b.world.addKin(k);
  const m = new THREE.Mesh(woodAttr(new THREE.BoxGeometry(sec.w + 0.6, 2.4, 0.6), 'x', 9), b.paint({ a: PAINT.blue, b: PAINT.white, pattern: Pattern.Dots, scale: 1.4 }));
  m.position.copy(k.pos);
  m.quaternion.copy(q);
  m.castShadow = m.receiveShadow = true;
  b.group.add(m);
}

export function makeCrown() {
  const g = new THREE.Group();
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xffc534, metalness: 1, roughness: 0.22, clearcoat: 0.6 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.75, 0.55, 40, 1, true), gold);
  band.material.side = THREE.DoubleSide;
  g.add(band);
  const gems = [0xff2244, 0x2266ff, 0x22cc66];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.62, 12), gold);
    spike.position.set(Math.cos(a) * 0.8, 0.55, Math.sin(a) * 0.8);
    g.add(spike);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), gold);
    ball.position.set(Math.cos(a) * 0.8, 0.9, Math.sin(a) * 0.8);
    g.add(ball);
    if (k % 2 === 0) {
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshPhysicalMaterial({ color: gems[(k / 2) % 3], roughness: 0.05, metalness: 0, transmission: 0, clearcoat: 1, emissive: gems[(k / 2) % 3], emissiveIntensity: 0.4 }));
      gem.position.set(Math.cos(a) * 0.84, 0.0, Math.sin(a) * 0.84);
      g.add(gem);
    }
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  g.userData.spin = true;
  return g;
}

export function buildRound(id: RoundId): Course {
  if (id === 'timber') return timber();
  if (id === 'paintmill') return paintmill();
  if (id === 'jumpclub') return jumpclub();
  return summit();
}
