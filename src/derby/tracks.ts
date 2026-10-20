import * as THREE from 'three';
import { CourseBuilder, Path, PAINT, type Cmd } from '../marbles/builder.ts';
import { arch, bumper, doorWall, frameQuat, hammer, kicker, peg, startGate, sweeper } from '../marbles/obstacles.ts';
import { flippers, rollers, turnstile } from '../marbles/obs-spin.ts';
import { wreckingBall } from '../marbles/obs-swing.ts';
import { checkpoints, endWall, lakeBelow, raceRecord, split, tag, turntableGap } from '../marbles/course-kit.ts';
import { floorStripe } from '../marbles/obstacles.ts';
import { Pattern, woodMaterial, type WoodSpecies } from '../marbles/shaders.ts';
import type { Course } from '../marbles/courses.ts';

/**
 * The derby's three tracks. Same machinery as Marble Mania (the turtle path swept into a chute, the
 * same obstacles, the same physics), dressed for the night: boards of red mahogany under a deep
 * lacquer, black ebony rails and posts, and running along the top of every rail a strip of marquee
 * bulbs in neon colours that chase down the course. A grandstand full of people (and their phone
 * flashes) faces the finish straight, with the big screen above it. Short races (about a minute)
 * with plenty of luck in them: peg fields, door walls, a spinning floor, a shortcut to gamble on.
 */

const MAHOGANY: WoodSpecies = { light: 0xb0482a, dark: 0x4a130a, plankW: 0.34, plankL: 2.8, rings: 36, fig: 1.1, curl: 1 };
const EBONY: WoodSpecies = { light: 0x3a2a26, dark: 0x0d0807, plankW: 99, plankL: 99, rings: 40, fig: 0.8, curl: 0.5 };
const DARK: WoodSpecies = { light: 0x2a201c, dark: 0x0a0605, plankW: 99, plankL: 99, rings: 18, fig: 1, curl: 0.2 };

class DerbyBuilder extends CourseBuilder {
  override readonly floorWood = woodMaterial(MAHOGANY, 1);
  override readonly railWood = woodMaterial(EBONY, 1);
  override readonly postWood = woodMaterial(DARK, 0.4);
  override readonly darkWood = woodMaterial(EBONY, 0.9);
}

// ------------------------------------------------------------------------------------------ neon
/** the rails' neon: one colour per 40 m section, cycling through three */
export const NEON = [new THREE.Color(1.0, 0.12, 0.62), new THREE.Color(0.1, 0.78, 1.0), new THREE.Color(1.0, 0.62, 0.1)];
export function neonAt(s: number) {
  return NEON[((Math.floor(s / 40) % 3) + 3) % 3];
}

const NEON_V = /* glsl */ `
attribute float aS;
attribute float aB;
varying float vS;
varying float vB;
#include <fog_pars_vertex>
void main(){
  vS = aS;
  vB = aB;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const NEON_F = /* glsl */ `
uniform float uTime;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform float uHot;
varying float vS;
varying float vB;
#include <fog_pars_fragment>
void main(){
  float sec = mod(floor(vS / 40.0), 3.0);
  vec3 c = sec < 0.5 ? uA : sec < 1.5 ? uB : uC;
  // marquee bulbs every 0.5 m: each a bright round dot on a dimmer tube
  float f = fract(vS * 2.0) - 0.5;
  float fw = fwidth(vS * 2.0);
  float bulb = smoothstep(0.32 + fw, 0.32 - fw, abs(f)) * (1.0 - smoothstep(0.3, 0.9, fw));
  // the chase: pulses running down the course (faster when the race is on)
  float ph = fract(vS / 7.0 - uTime * (0.6 + uHot * 1.4));
  float pulse = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.06, 0.45, ph));
  float k = mix(0.9, 1.0 + bulb * 1.6, vB) + pulse * (1.4 + bulb * 2.0);
  gl_FragColor = vec4(c * k * 1.6, 1.0);
  #include <fog_fragment>
}
`;

export function neonMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: NEON_V,
    fragmentShader: NEON_F,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uHot: { value: 0 }, uA: { value: NEON[0] }, uB: { value: NEON[1] }, uC: { value: NEON[2] } }]),
    fog: true,
  });
}

/** a strip of bulbs along the top of each rail (wherever there is a rail) */
function neonRails(b: CourseBuilder, path: Path, mat: THREE.ShaderMaterial, s0 = 0, s1 = Infinity) {
  const RAIL = 0.32;
  const pos: number[] = [], sv: number[] = [], bv: number[] = [], idx: number[] = [];
  for (const side of [-1, 1]) {
    let prev = -1;
    for (let i = 0; i < path.count; i += 2) {
      const s = i * 0.25;
      const sec = path.sec[i];
      const wall = side < 0 ? sec.wallL : sec.wallR;
      if (!sec.floor || wall < 0.4 || s < s0 || s > s1) {
        prev = -1;
        continue;
      }
      const P = path.P[i], R = path.Rt[i], U = path.U[i];
      const x = side * (sec.w / 2 + RAIL / 2);
      // a small box section: 4 corners (top/bottom × in/out)
      const base = pos.length / 3;
      for (const [dx, dy] of [
        [-0.06, 0.0],
        [0.06, 0.0],
        [0.06, 0.08],
        [-0.06, 0.08],
      ]) {
        pos.push(P.x + R.x * (x + dx) + U.x * (wall + dy), P.y + R.y * (x + dx) + U.y * (wall + dy), P.z + R.z * (x + dx) + U.z * (wall + dy));
        sv.push(s);
        bv.push(dy > 0 ? 1 : 0.5);
      }
      if (prev >= 0) for (let k = 0; k < 4; k++) {
        const a = prev + k, c = prev + ((k + 1) % 4), d = base + k, e = base + ((k + 1) % 4);
        idx.push(a, d, c, c, d, e);
      }
      prev = base;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(sv, 1));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(bv, 1));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  m.material.side = THREE.DoubleSide;
  b.group.add(m);
}

// ------------------------------------------------------------------------------------------ the stand
const CROWD_V = /* glsl */ `
uniform float uTime;
uniform float uHype;
attribute vec3 aCol;
attribute float aSeed;
varying vec3 vCol;
varying float vFlash;
varying vec3 vN;
#include <fog_pars_vertex>
float h1(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
void main(){
  vec3 p = position;
  // on their feet when it's close: a bounce, out of step with each other
  float bounce = max(0.0, sin(uTime * (7.0 + aSeed * 4.0) + aSeed * 40.0)) * 0.12 * uHype;
  p.y += bounce * (position.y + 0.5);
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vCol = aCol;
  vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
  // a phone flash now and then (more of them when it's close)
  float slot = floor(uTime * 9.0);
  vFlash = step(1.0 - (0.004 + 0.02 * uHype), h1(aSeed * 911.0 + slot * 3.7));
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;
const CROWD_F = /* glsl */ `
varying vec3 vCol;
varying float vFlash;
varying vec3 vN;
#include <fog_pars_fragment>
void main(){
  // lit from the floods above and the track's glow in front
  float l = 0.18 + 0.5 * max(vN.y, 0.0) + 0.2 * max(-vN.z, 0.0);
  vec3 c = vCol * l + vec3(6.0, 6.0, 5.6) * vFlash;
  gl_FragColor = vec4(c, 1.0);
  #include <fog_fragment>
}
`;

export interface Stand {
  group: THREE.Group;
  crowd: THREE.ShaderMaterial;
  screen: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture };
  /** a good spot for the camera to look at it from, and its screen */
  look: THREE.Vector3;
}

/** tiers of seats beside the finish straight on `side`, a crowd in them, the big screen above */
function stand(b: CourseBuilder, path: Path, s0: number, s1: number, side: 1 | -1): Stand {
  const g = new THREE.Group();
  const sm = (s0 + s1) / 2;
  const i = path.index(sm);
  const T = path.T[i].clone().setY(0).normalize();
  const R = new THREE.Vector3().crossVectors(T, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(-1);
  // (R: the path's right, flattened; check its sign against the path's own)
  if (R.dot(path.Rt[i]) < 0) R.negate();
  const S = R.clone().multiplyScalar(side);
  const len = s1 - s0;
  const P0 = path.at(sm, 0, 0);
  const hw = path.sec[i].w / 2;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x23202a, roughness: 0.85 });
  const seatM = new THREE.MeshStandardMaterial({ color: 0x3a1020, roughness: 0.6 });
  const rows = 9;
  const yaw = Math.atan2(T.x, T.z);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const rowD = 1.25, rowH = 0.62, gap = hw + 2.6;
  for (let k = 0; k < rows; k++) {
    const tier = new THREE.Mesh(new THREE.BoxGeometry(len, rowH, rowD), k % 2 ? concrete : seatM);
    tier.position.copy(P0).addScaledVector(S, gap + k * rowD).add(new THREE.Vector3(0, -2.2 + k * rowH, 0));
    tier.quaternion.copy(q);
    tier.receiveShadow = true;
    g.add(tier);
  }
  // under it: a solid block down to the water, and a back wall up behind
  const backH = rows * rowH + 3.5;
  const back = new THREE.Mesh(new THREE.BoxGeometry(len + 1, backH, 0.6), concrete);
  back.position.copy(P0).addScaledVector(S, gap + rows * rowD + 0.3).add(new THREE.Vector3(0, -2.5 + backH / 2, 0));
  back.quaternion.copy(q);
  g.add(back);
  const depth = P0.y - 2.5 - b.lakeY;
  const pier = new THREE.Mesh(new THREE.BoxGeometry(len, depth, rows * rowD), concrete);
  pier.position.copy(P0).addScaledVector(S, gap + (rows * rowD) / 2).add(new THREE.Vector3(0, -2.5 - depth / 2, 0));
  pier.quaternion.copy(q);
  g.add(pier);
  // the crowd: one figure per seat (most of them), in their own colours
  const per = Math.floor(len / 0.62);
  const N = per * rows;
  const body = new THREE.CapsuleGeometry(0.2, 0.42, 3, 6).translate(0, 0.42, 0);
  const crowd = new THREE.ShaderMaterial({ vertexShader: CROWD_V, fragmentShader: CROWD_F, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uHype: { value: 0 } }]), fog: true });
  const mesh = new THREE.InstancedMesh(body, crowd, N);
  const col = new Float32Array(N * 3), seed = new Float32Array(N);
  const pal = [0xe8322f, 0x2f74ff, 0xffcf2a, 0x37c25a, 0xffffff, 0x8a4bff, 0xff8a1f, 0x1fc8c0, 0x222222, 0xff5fa8];
  const m = new THREE.Matrix4(), c = new THREE.Color();
  let n = 0;
  for (let k = 0; k < rows; k++)
    for (let j = 0; j < per; j++) {
      if (Math.random() < 0.08) continue;
      const along = -len / 2 + 0.31 + j * 0.62 + (Math.random() - 0.5) * 0.12;
      const p = P0.clone().addScaledVector(T, along).addScaledVector(S, gap + k * rowD + 0.1).add(new THREE.Vector3(0, -2.2 + k * rowH + rowH / 2, 0));
      m.compose(p, q, new THREE.Vector3(1, 0.9 + Math.random() * 0.25, 1));
      mesh.setMatrixAt(n, m);
      c.set(pal[Math.floor(Math.random() * pal.length)]);
      col.set([c.r, c.g, c.b], n * 3);
      seed[n] = Math.random();
      n++;
    }
  mesh.count = n;
  body.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  body.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  mesh.frustumCulled = false;
  g.add(mesh);
  // the big screen: up on the back wall, tilted down at the track
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sw = Math.min(len * 0.6, 22), sh = sw / 2;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5) }));
  const frame = new THREE.Mesh(new THREE.BoxGeometry(sw + 1, sh + 1, 0.5), new THREE.MeshStandardMaterial({ color: 0x0c0c12, metalness: 0.6, roughness: 0.4 }));
  const sg = new THREE.Group();
  sg.add(frame, screen);
  screen.position.z = 0.27;
  sg.position.copy(P0).addScaledVector(S, gap + rows * rowD + 0.6).add(new THREE.Vector3(0, -2.5 + backH + sh / 2 + 0.8, 0));
  sg.lookAt(P0.clone().addScaledVector(S, -6).add(new THREE.Vector3(0, -4, 0)));
  g.add(sg);
  // legs for it
  for (const e of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, sh + 1.5, 0.5), frame.material);
    leg.position.copy(sg.position).addScaledVector(T, e * sw * 0.35).add(new THREE.Vector3(0, -sh / 2 - 0.4, 0)).addScaledVector(S, 0.4);
    g.add(leg);
  }
  g.traverse((o) => ((o as THREE.Mesh).isMesh && o !== mesh ? (o.receiveShadow = true) : null));
  b.group.add(g);
  return { group: g, crowd, screen: { canvas, ctx, tex }, look: sg.position.clone() };
}

// ------------------------------------------------------------------------------------------ the tracks
export interface Track {
  id: 'mile' | 'spiral' | 'cascade';
  name: string;
  blurb: string;
}
export const TRACKS: Track[] = [
  { id: 'mile', name: 'The Neon Mile', blurb: 'A plunge, the peg garden, a shortcut over the drop, the spinning floor, the jump and the long spiral home' },
  { id: 'spiral', name: 'Moonlight Spiral', blurb: 'Hammers under the moon, the sweepers, two hairpins, the lucky doors and a great descending spiral' },
  { id: 'cascade', name: 'Casino Cascade', blurb: 'Pinball flippers, the cascade, the roulette wheel, wrecking balls and the booster run to the line' },
];

export interface Built {
  course: Course;
  stand: Stand;
  neon: THREE.ShaderMaterial;
  center: THREE.Vector3;
  radius: number;
  /** which side of the finish straight the stand is on (+1: the path's right) */
  standSide: 1 | -1;
}

/** the parts every derby track shares */
function common(b: DerbyBuilder, path: Path, name: string, sub: string, fs: number, standSide: 1 | -1) {
  const state = { go: 1e9 };
  const [st0] = tag(path, 'start');
  const gateS = st0 + 12;
  startGate(b, path, gateS, state);
  arch(b, path, gateS + 2.5, name.toUpperCase(), { color: PAINT.purple, text2: sub });
  floorStripe(b, path, fs, 1.4, { a: PAINT.white, b: PAINT.black, pattern: Pattern.Checks, scale: 1.4, wear: 0.02 });
  arch(b, path, fs, 'FINISH', { color: PAINT.pink });
  const [, c1] = tag(path, 'catch');
  endWall(b, path, c1 - 0.5);
  const neon = neonMaterial();
  neonRails(b, path, neon);
  const st = stand(b, path, fs - 34, fs + 6, standSide);
  return { state, gateS, neon, stand: st };
}

function bounds(path: Path) {
  const box = new THREE.Box3();
  for (const p of path.P) box.expandByPoint(p);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  return { center, radius: Math.max(size.x, size.z) / 2 };
}

export function buildTrack(id: Track['id']): Built {
  const info = TRACKS.find((t) => t.id === id)!;
  if (id === 'spiral') return spiral(info);
  if (id === 'cascade') return cascade(info);
  return mile(info);
}

function finish(b: DerbyBuilder, path: Path, info: Track, o: { fs: number; gaps: [number, number][]; cps: number[]; side: 1 | -1 }): Built {
  const c = common(b, path, info.name, 'Marble Derby', o.fs, o.side);
  b.finish();
  const course = raceRecord(b, path, { id: info.id, name: info.name, kind: 'race', blurb: info.blurb, gateS: c.gateS, finishS: o.fs, gaps: o.gaps, checkpoints: checkpoints(c.gateS, o.cps), state: c.state });
  const { center, radius } = bounds(path);
  return { course, stand: c.stand, neon: c.neon, center, radius, standSide: o.side };
}

const pegPaint = (k: number) => ({ a: [PAINT.pink, PAINT.teal, PAINT.yellow][k % 3], b: PAINT.black, pattern: Pattern.Stripes, scale: 2.4 });

/** The Neon Mile */
function mile(info: Track): Built {
  const b = new DerbyBuilder();
  const cmds: Cmd[] = [
    { len: 16, slope: 1.5, w: 13, wall: 1.6, tag: 'start' },
    { len: 26, slope: 11, w: 10, easeW: 8 },
    { len: 40, turn: -75, slope: 6, w: 10, wall: 1.8 },
    { len: 40, turn: 80, slope: 6, w: 10 },
    { len: 10, slope: 4, w: 12, easeW: 6, tag: 'pre-pegs' },
    { len: 56, slope: 5, w: 12, tag: 'pegs' },
    { len: 34, turn: 100, slope: 5, w: 10, wall: 2.0 },
    { len: 12, slope: 3, w: 16, wall: 1.6, easeW: 5, tag: 'pre-split' },
    { len: 40, slope: 3, w: 16, floor: false, tag: 'split' },
    { len: 10, slope: 3, w: 11, easeW: 5 },
    { len: 30, turn: -90, slope: 5, w: 10.5, wall: 2.0 },
    { len: 5, slope: 1, w: 17.4, easeW: 2 },
    { len: 17, slope: 0, w: 17.4, floor: false, tag: 'spin' },
    { len: 6, slope: 3, w: 11, easeW: 3 },
    { len: 18, slope: 5, w: 11, wall: 1.6, tag: 'kick' },
    { len: 6, slope: 12, floor: false, tag: 'gap' },
    { len: 14, slope: 4, w: 13, tag: 'land' },
    { len: 34, turn: -80, slope: 5, w: 11, wall: 1.8 },
    { len: 46, slope: 3, w: 13, wall: 1.6, tag: 'sweep' },
    { len: 10, slope: 5, w: 10, easeW: 5, wall: 2.4 },
    { len: 200, turn: 600, slope: 6, w: 10, wall: 2.4, bank: 20, tag: 'helix' },
    { len: 44, slope: 2.5, w: 12, wall: 1.8, bank: 0, tag: 'finish' },
    { len: 18, slope: -7, w: 14, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 150, 0), 0, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  // the peg garden: staggered rows, a bumper in the thick of it now and then
  const [p0, p1] = tag(path, 'pegs');
  let row = 0;
  for (let s = p0 + 4; s < p1 - 3; s += 3.4, row++) {
    for (let k = -2; k <= 2; k++) {
      const lat = k * 2.8 + (row % 2 ? 1.4 : 0);
      if (Math.abs(lat) > 4.6) continue;
      if (row % 3 === 1 && k === 0) bumper(b, path, s, lat, { color: PAINT.pink, r: 0.65 });
      else peg(b, path, s, lat, { paint: pegPaint(row) });
    }
  }
  // the split: a bare beam on the left, bumpers down the safe lane on the right
  const [sp0, sp1] = tag(path, 'split');
  const lanes = split(b, path, sp0, sp1, { fastLat: -4.6, fastW: 3.8, safeLat: 3.4, safeW: 7, safeWall: 2.0 });
  for (let k = 0; k < 4; k++) bumper(b, lanes.safe, 7 + k * 8, k % 2 ? 1.6 : -1.6, { color: [PAINT.teal, PAINT.purple][k % 2] });
  const [t0, t1] = tag(path, 'spin');
  turntableGap(b, path, t0, t1, { omega: 0.8, fins: 2 });
  const [, k1] = tag(path, 'kick');
  kicker(b, path, k1, { len: 5, h: 1.0 });
  const [g0, g1] = tag(path, 'gap');
  // the sweeper meadow: a long arm turning over the floor (hop it or time it), a turnstile after
  const [mw0] = tag(path, 'sweep');
  {
    const s = mw0 + 14;
    const i = path.index(s);
    sweeper(b, path.P[i].clone(), frameQuat(path, s), { len: 12, angle: (t) => -1.3 * t, paint: { a: PAINT.teal, b: PAINT.black, pattern: Pattern.Rings, scale: 1.3 } });
  }
  turnstile(b, path, mw0 + 32, { arms: 4, omega: 0.85, height: 0.9, color: PAINT.pink });
  // a few bumpers in the spiral's first turn
  const [h0] = tag(path, 'helix');
  for (const [ds, lat] of [
    [20, 2.2],
    [34, -2.4],
    [48, 1.8],
  ] as const)
    bumper(b, path, h0 + ds, lat, { color: PAINT.yellow, r: 0.6 });
  const [f0] = tag(path, 'finish');
  const fs = f0 + 30;
  const [pp] = tag(path, 'pre-pegs');
  const [ps] = tag(path, 'pre-split');
  const [l0] = tag(path, 'land');
  return finish(b, path, info, { fs, gaps: [[g0, g1]], cps: [pp + 2, p1 + 8, ps + 2, sp1 + 12, t1 + 4, l0 + 8, mw0 - 4, mw0 + 42, h0 + 50, h0 + 110, h0 + 170], side: -1 });
}

/** Moonlight Spiral */
function spiral(info: Track): Built {
  const b = new DerbyBuilder();
  const cmds: Cmd[] = [
    { len: 16, slope: 1.5, w: 13, wall: 1.6, tag: 'start' },
    { len: 24, slope: 10, w: 10, easeW: 8 },
    { len: 30, turn: 60, slope: 6, w: 10, wall: 1.8 },
    { len: 50, slope: 4, w: 11, wall: 1.8, tag: 'hammers' },
    { len: 32, turn: -110, slope: 5, w: 10, wall: 2.0 },
    { len: 40, slope: 3, w: 14, wall: 1.6, easeW: 5, tag: 'sweep' },
    { len: 30, turn: 90, slope: 5, w: 11, wall: 2.0 },
    { len: 12, slope: 3, w: 16, wall: 1.6, easeW: 5, tag: 'pre-split' },
    { len: 44, slope: 3, w: 16, floor: false, tag: 'split' },
    { len: 10, slope: 3, w: 11, easeW: 5 },
    { len: 10, slope: 4, w: 10, wall: 2.4, easeW: 5, tag: 'switch' },
    { len: 38, turn: 180, slope: 5, w: 10, wall: 2.4 },
    { len: 10, slope: 4 },
    { len: 38, turn: -180, slope: 5 },
    { len: 12, slope: 3, w: 12, wall: 1.8, easeW: 4, tag: 'doors' },
    { len: 8, slope: 3, w: 12, wall: 1.8 },
    { len: 10, slope: 5, w: 10, wall: 2.4, easeW: 4 },
    { len: 190, turn: -540, slope: 6.5, w: 10, wall: 2.4, bank: 22, tag: 'spiral' },
    { len: 44, slope: 2.5, w: 12, wall: 1.8, bank: 0, tag: 'finish' },
    { len: 18, slope: -7, w: 14, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 150, 0), 0, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  const [hm0] = tag(path, 'hammers');
  hammer(b, path, hm0 + 14, { period: 2.4, phase: 0, color: PAINT.pink });
  hammer(b, path, hm0 + 32, { period: 2.7, phase: 1.3, color: PAINT.teal });
  for (const lat of [-3.2, 3.2]) peg(b, path, hm0 + 23, lat, { paint: pegPaint(1) });
  const [w0] = tag(path, 'sweep');
  {
    const s = w0 + 16;
    const i = path.index(s);
    sweeper(b, path.P[i].clone(), frameQuat(path, s), { len: 12.6, angle: (t) => 1.25 * t, paint: { a: PAINT.yellow, b: PAINT.black, pattern: Pattern.Rings, scale: 1.3 } });
  }
  turnstile(b, path, w0 + 32, { arms: 3, omega: -0.9, height: 0.9, color: PAINT.purple });
  // the fork: a bare beam with a sweeping arm over it, or the safe way through the pegs
  const [ss0, ss1] = tag(path, 'split');
  const lanes = split(b, path, ss0, ss1, { fastLat: -4.6, fastW: 3.8, safeLat: 3.4, safeW: 7, safeWall: 2.0 });
  for (let k = 0; k < 5; k++) peg(b, lanes.safe, 6 + k * 7, k % 2 ? 1.5 : -1.5, { paint: pegPaint(k) });
  const [d0] = tag(path, 'doors');
  doorWall(b, path, d0 + 7, { doors: 4, seed: 11 });
  const [sp0] = tag(path, 'spiral');
  for (let k = 0; k < 6; k++) bumper(b, path, sp0 + 18 + k * 26, k % 2 ? 2.3 : -2.3, { color: [PAINT.pink, PAINT.teal, PAINT.yellow][k % 3], r: 0.6 });
  const [f0] = tag(path, 'finish');
  const fs = f0 + 30;
  const [sw] = tag(path, 'switch');
  return finish(b, path, info, { fs, gaps: [], cps: [hm0 - 4, hm0 + 46, w0 + 2, ss0 - 10, ss1 + 8, sw + 2, d0 - 2, d0 + 16, sp0 + 60, sp0 + 130], side: 1 });
}

/** Casino Cascade */
function cascade(info: Track): Built {
  const b = new DerbyBuilder();
  const cmds: Cmd[] = [
    { len: 16, slope: 1.5, w: 13, wall: 1.6, tag: 'start' },
    { len: 24, slope: 10, w: 10, easeW: 8 },
    { len: 36, turn: 70, slope: 5, w: 11, wall: 1.8 },
    { len: 18, slope: 2, w: 11, wall: 1.8, tag: 'flip' },
    { len: 30, turn: -80, slope: 5, w: 11 },
    { len: 16, slope: 3, w: 12, wall: 1.8, tag: 'doors' },
    { len: 30, turn: 85, slope: 5, w: 11, wall: 2.0 },
    { len: 12, slope: 3, w: 16, wall: 1.6, easeW: 5, tag: 'pre-split' },
    { len: 40, slope: 3, w: 16, floor: false, tag: 'split' },
    { len: 10, slope: 3, w: 12, easeW: 5 },
    { len: 26, turn: -80, slope: 5, w: 11, wall: 2.0 },
    { len: 12, slope: 3, w: 12, wall: 1.6, easeW: 4, tag: 'cascade' },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 9, slope: 3, easeS: 0.4 },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 9, slope: 3, easeS: 0.4 },
    { len: 2.5, slope: 48, floor: false, easeS: 0.4 },
    { len: 10, slope: 3, easeS: 0.4, tag: 'cascade-end' },
    { len: 30, turn: 90, slope: 5, w: 10.5, wall: 2.0 },
    { len: 5, slope: 1, w: 17.4, easeW: 2 },
    { len: 17, slope: 0, w: 17.4, floor: false, tag: 'spin' },
    { len: 6, slope: 2, w: 12, easeW: 3 },
    { len: 34, slope: 3, w: 12, wall: 1.8, tag: 'wreck' },
    { len: 28, turn: -70, slope: 5, w: 10.5, wall: 2.0 },
    { len: 12, slope: 2, w: 10, wall: 1.8, bank: 0 },
    { len: 24, slope: 1, w: 10, wall: 1.8, bank: 0, deck: false, tag: 'rollers' },
    { len: 10, slope: 5, w: 10, easeW: 5, wall: 2.4 },
    { len: 210, turn: 540, slope: 6, w: 10, wall: 2.4, bank: 20, tag: 'helix' },
    { len: 44, slope: 2.5, w: 12, wall: 1.8, bank: 0, tag: 'finish' },
    { len: 18, slope: -7, w: 14, tag: 'catch' },
  ];
  const path = new Path(new THREE.Vector3(0, 150, 0), 0, cmds);
  b.lakeY = lakeBelow(path);
  b.chute(path);
  const [fl0] = tag(path, 'flip');
  flippers(b, path, fl0 + 9, { period: 2.2 });
  const [dd0] = tag(path, 'doors');
  doorWall(b, path, dd0 + 8, { doors: 4, seed: 23 });
  // the fork: the bare beam (a wrecking ball swinging over its far end), or bumpers down the safe way
  const [cs0, cs1] = tag(path, 'split');
  const lanes = split(b, path, cs0, cs1, { fastLat: -4.6, fastW: 3.8, safeLat: 3.4, safeW: 7, safeWall: 2.0 });
  for (let k = 0; k < 4; k++) bumper(b, lanes.safe, 7 + k * 8, k % 2 ? -1.6 : 1.6, { color: [PAINT.yellow, PAINT.pink][k % 2] });
  const [c0] = tag(path, 'cascade');
  const [ce] = tag(path, 'cascade-end');
  for (const lat of [-2.6, 2.6]) peg(b, path, c0 + 6, lat, { paint: pegPaint(2) });
  const [t0, t1] = tag(path, 'spin');
  turntableGap(b, path, t0, t1, { omega: -1.0, fins: 3 });
  const [w0] = tag(path, 'wreck');
  wreckingBall(b, path, w0 + 10, { period: 3.2, color: PAINT.pink });
  wreckingBall(b, path, w0 + 24, { period: 3.6, phase: 1.7, color: PAINT.teal });
  const [r0, r1] = tag(path, 'rollers');
  rollers(b, path, r0 - 0.3, r1 + 0.3, { speed: 10, colors: [PAINT.pink, PAINT.black] });
  const [h0] = tag(path, 'helix');
  const [f0] = tag(path, 'finish');
  const fs = f0 + 30;
  return finish(b, path, info, { fs, gaps: [], cps: [fl0 - 4, fl0 + 20, dd0 - 2, dd0 + 18, cs0 - 10, cs1 + 8, c0 - 2, ce + 4, t1 + 4, w0 - 2, w0 + 38, r0 - 6, h0 + 40, h0 + 100, h0 + 160], side: 1 });
}
