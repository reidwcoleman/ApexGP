import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { ringGrid, title } from './course-modes.ts';
import { addStrikes, type Hit3, type Strikes } from './course-strikes.ts';

/**
 * Sticky Picnic: everyone rides a ball of jam across a giant picnic table. Anything smaller than
 * your ball sticks to it and makes it bigger, so what was a wall a minute ago is lunch now. Touch a
 * much bigger ball and it picks you up; DIVE into one and you knock bits off it instead. More food
 * lands all round, tomatoes come down on the table, and the biggest balls go through.
 *
 * The food and the tomatoes come from the round's key and the clock, the same in every browser.
 * Each browser rolls its own beans and eats for them, says what it ate, and the size of every ball
 * rides along in its bean's state, so there's no score to keep in step.
 */
export const PICNIC = {
  T: 90,
  R: 46,
  /** the last seconds, when everything counts double */
  feast: 15,
  /** you can eat what's up to this share of your size */
  eat: 0.85,
  /** what an item adds to the ball: its size to this power, times this (big food is worth less than its bulk, or the balls outgrow the table) */
  gain: 0.9,
  power: 2.4,
  /** the further behind the biggest ball you are, the more your food is worth (at none of its size: this much more) */
  catchUp: 1.6,
  /** a ball this many times bigger picks you up */
  gulp: 1.6,
  /** how long you're stuck to it, what it takes off you, and how long after that no one can touch you */
  stuck: 1.3,
  gulpTake: 0.25,
  ghost: 3,
  /** the rolling: how fast, how fast a big one, and how quickly it gets there */
  top: 11.5,
  topR: 0.3,
  hold: 2.8,
  holdR: 0.09,
  boost: 15,
  cd: 2,
  /** how long a boost counts as one */
  fast: 0.7,
  /** a knock: how lively, how hard it has to be to shake bits off, and how much it can */
  e: 0.7,
  shake: 6.5,
  shakeMax: 0.12,
  /** off the table: this far down it's a fall, and this share of you stays down there */
  fall: 13,
  fallTake: 0.25,
  credit: 6,
  back: 15,
  backGhost: 2.6,
  /** a tomato on your head */
  splat: 0.14,
  /** the biggest a ball ever gets */
  max: 10,
};

/** the food: it rains down steadily up to each of these times, this much of each size (tiny, small, mid, big, large, huge) */
const WAVES: [number, number, number, number, number, number, number][] = [
  [0, 260, 140, 46, 16, 7, 3],
  [25, 120, 110, 50, 12, 3, 0],
  [45, 90, 90, 56, 22, 7, 1],
  [65, 60, 70, 56, 28, 12, 3],
  [86, 40, 50, 46, 28, 14, 5],
];
const SIZES: [number, number][] = [[0.36, 0.5], [0.6, 0.85], [0.95, 1.4], [1.8, 2.5], [3, 3.8], [4.4, 5.4]];
/** what each size of food is called, for the moment you can eat it */
export const UNLOCK: [number, string][] = [[1.4, 'CUPCAKES'], [2.5, 'SANDWICHES'], [3.8, 'WATERMELONS'], [5.4, 'WHOLE CAKES'], [6, 'THE TEAPOT']];

export const enum Food { Berry, Sweet, Cookie, Donut, Cupcake, Apple, Sandwich, Juice, Melon, Basket, Cake, Teapot }
const TIERS: Food[][] = [[Food.Berry, Food.Sweet], [Food.Cookie, Food.Donut], [Food.Cupcake, Food.Apple], [Food.Sandwich, Food.Juice], [Food.Melon, Food.Basket], [Food.Cake], [Food.Teapot]];
const FOODS = 12;
/** how high its middle sits, for its size */
const REST = [0.95, 0.6, 0.2, 0.34, 0.5, 0.9, 0.4, 0.86, 0.8, 0.55, 0.62, 0.8];
const TINTS: number[][] = [
  [0xff3a5a, 0x4a5aff, 0xb040e0, 0xff5a8a],
  [0xff6ab0, 0x5ad0ff, 0xffd23a, 0x7ee06a, 0xff8a3a],
  [0xffffff],
  [0xff9ac0, 0xffe0a0, 0x7a4a2a, 0x8ad8ff],
  [0xff9ad0, 0xfff0c0, 0xb08aff, 0x9ae8c0],
  [0xff3a3a, 0x8fe04a, 0xffc23a],
  [0xffffff],
  [0xff8a3a, 0x5ac8ff, 0xb06aff, 0xffd23a],
  [0xffffff],
  [0xffffff],
  [0xffffff, 0xffc0e0, 0xc0e8ff],
  [0xffffff],
];

const CLR = new THREE.Color();
function paint(g: THREE.BufferGeometry, c: number) {
  const q = g.index ? g.toNonIndexed() : g;
  const n = q.getAttribute('position').count, a = new Float32Array(n * 3);
  CLR.set(c);
  for (let i = 0; i < n; i++) a.set([CLR.r, CLR.g, CLR.b], i * 3);
  q.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return q;
}
const join = (...g: THREE.BufferGeometry[]) => mergeGeometries(g, false)!;
const sph = (r: number, x = 0, y = 0, z = 0, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h).translate(x, y, z);

/** everything on the table, each about a metre from its middle to its edge */
function foodGeo(): THREE.BufferGeometry[] {
  let s = 4242;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const chips = (n: number, r: number, y: number, c: number[]) => {
    const l: THREE.BufferGeometry[] = [];
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.28, d = Math.sqrt(rnd()) * 0.84;
      l.push(paint(sph(r, Math.cos(a) * d, y, Math.sin(a) * d, 6, 4), c[k % c.length]));
    }
    return l;
  };
  const berry = join(paint(sph(0.92, 0, 0, 0, 14, 10), 0xffffff), paint(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 6).translate(0, 1.05, 0), 0x4a8a3a), paint(sph(0.24, 0.2, 0.86, 0, 6, 4).scale(1.5, 0.4, 0.9), 0x6ac04a));
  const sweet = join(
    paint(sph(0.62, 0, 0, 0, 14, 10).scale(1.2, 0.9, 0.9), 0xffffff),
    paint(new THREE.ConeGeometry(0.36, 0.5, 8).rotateZ(Math.PI / 2).translate(-0.86, 0, 0), 0xfff6e8),
    paint(new THREE.ConeGeometry(0.36, 0.5, 8).rotateZ(-Math.PI / 2).translate(0.86, 0, 0), 0xfff6e8),
  );
  const cookie = join(paint(new THREE.CylinderGeometry(0.98, 0.94, 0.36, 22), 0xd8a058), ...chips(11, 0.15, 0.17, [0x4a2a18, 0x5a3420]));
  const donut = join(
    paint(new THREE.TorusGeometry(0.66, 0.33, 10, 22).rotateX(Math.PI / 2), 0xe0a860),
    paint(new THREE.TorusGeometry(0.66, 0.3, 8, 22).rotateX(Math.PI / 2).scale(1, 0.74, 1).translate(0, 0.13, 0), 0xffffff),
    ...chips(10, 0.06, 0.34, [0xff3a5a, 0x3ac0ff, 0xffe04a, 0x6ae05a]),
  );
  const cupcake = join(
    paint(new THREE.CylinderGeometry(0.62, 0.44, 0.74, 14, 1, true).translate(0, -0.26, 0), 0xff6a8a),
    paint(new THREE.CircleGeometry(0.44, 14).rotateX(Math.PI / 2).translate(0, -0.63, 0), 0xff6a8a),
    paint(sph(0.68, 0, 0.26, 0, 14, 9).scale(1, 0.72, 1), 0xffffff),
    paint(sph(0.42, 0, 0.56, 0, 12, 8).scale(1, 0.8, 1), 0xffffff),
    paint(sph(0.17, 0, 0.88, 0, 10, 7), 0xe0243a),
  );
  const apple = join(
    paint(sph(0.9, 0, 0, 0, 16, 12).scale(1, 0.92, 1), 0xffffff),
    paint(new THREE.CylinderGeometry(0.05, 0.07, 0.42, 6).rotateZ(0.2).translate(0.04, 0.96, 0), 0x6a4a2a),
    paint(sph(0.26, 0.28, 0.98, 0, 7, 5).scale(1.3, 0.3, 0.7), 0x4ac04a),
  );
  const sandwich = join(
    paint(new THREE.BoxGeometry(1.7, 0.24, 1.24).translate(0, -0.27, 0), 0xf0c888),
    paint(new THREE.BoxGeometry(1.84, 0.08, 1.38).translate(0, -0.11, 0), 0x5ac84a),
    paint(new THREE.BoxGeometry(1.72, 0.1, 1.28).translate(0, -0.01, 0), 0xff9aa8),
    paint(new THREE.BoxGeometry(1.8, 0.05, 1.34).translate(0, 0.07, 0), 0xffd23a),
    paint(new THREE.BoxGeometry(1.7, 0.26, 1.24).translate(0, 0.23, 0), 0xf0c888),
    paint(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 5).translate(0, 0.52, 0), 0xe8d8b8),
    paint(sph(0.09, 0, 0.78, 0, 7, 5), 0xff3a5a),
  );
  const juice = join(
    paint(new THREE.BoxGeometry(0.98, 1.56, 0.64), 0xffffff),
    paint(new THREE.BoxGeometry(1.0, 0.5, 0.66).translate(0, -0.12, 0), 0xfff4d8),
    paint(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6).rotateZ(-0.3).translate(0.2, 1.02, 0), 0xffffff),
  );
  const melon = (() => {
    const g = paint(new THREE.SphereGeometry(1, 28, 16).scale(1, 0.82, 0.82), 0x2f9a4a);
    const p = g.getAttribute('position') as THREE.BufferAttribute, c = g.getAttribute('color') as THREE.BufferAttribute;
    const lo = new THREE.Color(0x1f6a30), hi = new THREE.Color(0x7ad86a);
    for (let k = 0; k < p.count; k++) {
      const a = Math.atan2(p.getY(k), p.getZ(k));
      const col = Math.sin(a * 7) > 0.15 ? lo : hi;
      c.setXYZ(k, col.r, col.g, col.b);
    }
    return g;
  })();
  const wicker = (() => {
    const g = paint(new THREE.BoxGeometry(1.7, 0.92, 1.16, 10, 5, 6), 0xc89a58);
    const p = g.getAttribute('position') as THREE.BufferAttribute, c = g.getAttribute('color') as THREE.BufferAttribute;
    const lo = new THREE.Color(0xa87a3e), hi = new THREE.Color(0xe0b878);
    for (let k = 0; k < p.count; k++) {
      const col = (Math.floor((p.getX(k) + p.getZ(k) + 3) * 4) + Math.floor((p.getY(k) + 3) * 4)) % 2 ? lo : hi;
      c.setXYZ(k, col.r, col.g, col.b);
    }
    return g;
  })();
  const basket = join(
    wicker,
    paint(new THREE.TorusGeometry(0.72, 0.07, 7, 18, Math.PI).translate(0, 0.42, 0), 0x8a5a2a),
    paint(new THREE.BoxGeometry(1.74, 0.09, 1.2).translate(0, 0.45, 0), 0xe0243a),
  );
  const cake = join(
    paint(new THREE.CylinderGeometry(1, 1, 0.72, 32).translate(0, -0.24, 0), 0xfff0d8),
    paint(new THREE.TorusGeometry(0.98, 0.1, 7, 32).rotateX(Math.PI / 2).translate(0, 0.1, 0), 0xff7ab0),
    paint(new THREE.CylinderGeometry(0.66, 0.66, 0.5, 28).translate(0, 0.36, 0), 0xffffff),
    paint(new THREE.TorusGeometry(0.65, 0.08, 7, 28).rotateX(Math.PI / 2).translate(0, 0.6, 0), 0xff7ab0),
    ...[0, 1, 2, 3, 4].flatMap((k) => {
      const a = (k / 5) * 6.28, x = Math.cos(a) * 0.4, z = Math.sin(a) * 0.4;
      return [paint(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6).translate(x, 0.76, z), 0xff3a5a), paint(sph(0.07, x, 0.96, z, 6, 5).scale(1, 1, 1), 0xffc23a)];
    }),
  );
  const teapot = join(
    paint(sph(0.76, 0, -0.08, 0, 26, 18).scale(1.04, 0.86, 1.04), 0xf8f4ff),
    paint(new THREE.CylinderGeometry(0.08, 0.18, 0.74, 12).rotateZ(-0.9).translate(0.92, 0.04, 0), 0xf8f4ff),
    paint(new THREE.TorusGeometry(0.34, 0.06, 8, 18, Math.PI).rotateZ(Math.PI / 2).translate(-0.74, 0, 0), 0xf8f4ff),
    paint(sph(0.44, 0, 0.46, 0, 16, 8).scale(1, 0.3, 1), 0x4a7aff),
    paint(sph(0.11, 0, 0.66, 0, 10, 7), 0xffc23a),
    paint(new THREE.TorusGeometry(0.75, 0.04, 6, 30).rotateX(Math.PI / 2).translate(0, -0.08, 0), 0x4a7aff),
  );
  return [berry, sweet, cookie, donut, cupcake, apple, sandwich, juice, melon, basket, cake, teapot];
}

function clothArt() {
  const S = 2048, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff7ec';
  x.fillRect(0, 0, S, S);
  const n = 28, w = S / n;
  x.fillStyle = 'rgba(232, 60, 66, 0.5)';
  for (let i = 0; i < n; i += 2) x.fillRect(i * w, 0, w, S);
  for (let j = 0; j < n; j += 2) x.fillRect(0, j * w, S, w);
  // (a soft stain or two, and a hem running round the outside)
  x.strokeStyle = '#d8363e';
  x.lineWidth = 16;
  x.beginPath();
  x.arc(S / 2, S / 2, S / 2 - 26, 0, 7);
  x.stroke();
  x.strokeStyle = '#fff7ec';
  x.lineWidth = 6;
  x.setLineDash([26, 20]);
  x.beginPath();
  x.arc(S / 2, S / 2, S / 2 - 52, 0, 7);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export interface Item {
  k: number;
  food: Food;
  /** where it's kept in that food's mesh */
  slot: number;
  r: number;
  x: number;
  y: number;
  z: number;
  /** how it's turned, and its colour */
  a: number;
  col: number;
  /** lands at (seconds after the off) */
  at: number;
  gone: boolean;
}

export interface Ball {
  /** what's on it, besides the ball you started with */
  mass: number;
  /** the size you see (it catches up) */
  vis: number;
  quat: THREE.Quaternion;
  /** a squash, 0..1, going down */
  pulse: number;
  cd: number;
  /** boosting until (world time) */
  fast: number;
  /** no one can touch you until */
  ghost: number;
  /** stuck to someone until, and who */
  stuck: number;
  by: number;
  /** it just boosted */
  fired: boolean;
  air: boolean;
}

export interface PicnicArena {
  center: THREE.Vector3;
  R: number;
  items: Item[];
  /** the shapes of the food and what they're made of (the balls wear them too) */
  geo: THREE.BufferGeometry[];
  mat: THREE.Material;
  strikes: Strikes;
  ball(id: number): Ball;
  /** how big a ball that heavy is */
  size(mass: number): number;
  /** lay the table: the same key and field give the same table in every browser */
  deal(key: number, field: number): void;
  /** the food a ball this size can eat dims nothing; the rest goes dark */
  tint(limit: number): void;
  /** take it off the table */
  eaten(k: number): void;
  /** anything big between the lens and you dissolves */
  view(cam: THREE.Vector3, at: THREE.Vector3, dt: number): void;
  /** the list of what's within `r` of (x, z) */
  near(x: number, z: number, r: number, f: (q: Item) => void): void;
  feast(x: number): boolean;
  respawn(m: Marble, t: number): void;
}

export function stickyPicnic(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 120, 0);
  const y0 = center.y, cx = center.x, cz = center.z;
  const { R } = PICNIC;
  const state = { go: 1e9 };
  b.lakeY = y0 - 34;
  // ---- the table: a round top on four fat legs, with a checked cloth hanging over the edge
  b.world.addKin(new Kin({ type: 'cyl', r: R, hh: 1 }, Mat.Wood, (_, p) => p.set(cx, y0 - 1, cz)));
  {
    const top = new THREE.Mesh(new THREE.CircleGeometry(R, 128).rotateX(-Math.PI / 2).translate(cx, y0, cz), new THREE.MeshStandardMaterial({ map: clothArt(), roughness: 0.86 }));
    top.receiveShadow = true;
    b.group.add(top);
    // (the cloth's skirt, in scallops)
    const n = 96, seg = 4;
    const pos: number[] = [], idx: number[] = [];
    for (let i = 0; i <= n * seg; i++) {
      const a = (i / (n * seg)) * Math.PI * 2;
      const dip = 3 + Math.abs(Math.sin((i / seg) * Math.PI)) * 1.3;
      pos.push(cx + Math.cos(a) * R, y0, cz + Math.sin(a) * R, cx + Math.cos(a) * (R + 0.5), y0 - dip, cz + Math.sin(a) * (R + 0.5));
      if (i < n * seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    b.group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xe8484e, roughness: 0.9, side: THREE.DoubleSide })));
    const wood = new THREE.MeshStandardMaterial({ color: 0xb07a44, roughness: 0.7 });
    const under = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.6, R - 3, 2.6, 64).translate(cx, y0 - 1.4, cz), wood);
    b.group.add(under);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.78, x = cx + Math.cos(a) * R * 0.62, z = cz + Math.sin(a) * R * 0.62;
      b.group.add(new THREE.Mesh(new THREE.CylinderGeometry(4.4, 2.8, 70, 20).translate(x, y0 - 37, z), wood));
    }
  }
  // ---- the food
  const geo = foodGeo();
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.4 });
  const room = new Array(FOODS).fill(0);
  TIERS.forEach((fs, i) => {
    const total = i < 6 ? WAVES.reduce((s, w) => s + w[i + 1], 0) : 1;
    for (const f of fs) room[f] = total;
  });
  // (food big enough to hide you dissolves when it's in the way: a screen door of pixels, so there's nothing to sort)
  const see = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.4 });
  see.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFade;').replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFade < 0.99 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > vFade) discard;');
  };
  see.customProgramCacheKey = () => 'mm-picnic-see';
  const fades: (THREE.InstancedBufferAttribute | null)[] = [];
  const meshes = geo.map((g, f) => {
    const tall = f >= Food.Sandwich;
    const fade = tall ? new THREE.InstancedBufferAttribute(new Float32Array(room[f]).fill(1), 1) : null;
    fades.push(fade);
    if (fade) fade.setUsage(THREE.DynamicDrawUsage);
    const gg = tall ? g.clone() : g;
    if (fade) gg.setAttribute('aFade', fade);
    const q = new THREE.InstancedMesh(gg, tall ? see : mat, room[f]);
    q.frustumCulled = false;
    q.castShadow = f >= Food.Cupcake;
    q.receiveShadow = f >= Food.Sandwich;
    q.count = 0;
    b.group.add(q);
    return q;
  });
  const items: Item[] = [];
  const CELL = 8, N = Math.ceil((R * 2) / CELL) + 1;
  const cells: number[][] = Array.from({ length: N * N }, () => []);
  const cellOf = (v: number) => Math.max(0, Math.min(N - 1, Math.floor((v + R) / CELL)));
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), C = new THREE.Color();
  const place = (q: Item, drop: number) => {
    P.set(q.x, q.y + drop, q.z);
    Q.setFromAxisAngle(UP, q.a);
    S.setScalar(q.gone ? 0.0001 : q.r);
    meshes[q.food].setMatrixAt(q.slot, M.compose(P, Q, S));
  };
  let limit = -1;
  const shade = (q: Item) => {
    C.set(q.col);
    // (out of reach: darker and greyer, so what you can eat stands out)
    if (q.r > limit) C.lerp(CLR.set(0x4a4656), 0.62);
    meshes[q.food].setColorAt(q.slot, C);
  };
  const tint = (lim: number) => {
    limit = lim;
    for (const q of items) shade(q);
    for (const m of meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };
  const deal = (key: number, field: number) => {
    let s = (key * 9301 + 49297) % 2147483647 || 1;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 8; k++) rnd();
    items.length = 0;
    for (const c of cells) c.length = 0;
    const used = new Array(FOODS).fill(0);
    // (a small field has a small appetite: less food, or the balls outgrow the table)
    const share = THREE.MathUtils.clamp(0.42 + (field / 24) * 0.58, 0.42, 1);
    const put = (tier: number, x: number, z: number, at: number, r?: number) => {
      const fs = TIERS[tier], food = fs[Math.floor(rnd() * fs.length)], size = SIZES[tier] ?? [7, 7];
      const rr = r ?? size[0] + rnd() * (size[1] - size[0]), t = TINTS[food];
      const q: Item = { k: items.length, food, slot: used[food]++, r: rr, x, y: y0 + rr * REST[food], z, a: rnd() * 6.28, col: t[Math.floor(rnd() * t.length)], at, gone: false };
      items.push(q);
      // (it's listed in every cell its edge reaches, so a look round a ball never misses it)
      const c0 = cellOf(x - cx - rr), c1 = cellOf(x - cx + rr), d0 = cellOf(z - cz - rr), d1 = cellOf(z - cz + rr);
      for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) cells[i + j * N].push(q.k);
      return q;
    };
    /** clear of the pot, the start ring and anything else big */
    const free = (x: number, z: number, r: number, start: boolean) => {
      const d = Math.hypot(x - cx, z - cz);
      if (d < 6.6 + r || d > R - r - 0.6) return false;
      if (start && Math.abs(d - 20) < r + 2.2) return false;
      if (r < 1.6) return true;
      // (never touching another big thing, whichever delivery it came in: two together make a pocket a ball can't get out of)
      for (const q of items) if (q.r >= 1.6 && Math.hypot(q.x - x, q.z - z) < q.r + r + 0.8) return false;
      return true;
    };
    const spot = (r: number, start: boolean): [number, number] | null => {
      for (let k = 0; k < 60; k++) {
        const a = rnd() * 6.28, d = R * Math.sqrt(rnd());
        const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (free(x, z, r, start)) return [x, z];
      }
      return null;
    };
    put(6, cx, cz, -1, 6);
    WAVES.forEach((w, wi) => {
      const list: Item[] = [];
      // (spread over the time since the last lot; nearly half of the last lot lands all at once, for the feast)
      const from = wi ? Math.max(5, WAVES[wi - 1][0]) : 0, last = wi === WAVES.length - 1;
      const at = () => (!wi ? 0 : last && rnd() < 0.45 ? PICNIC.T - PICNIC.feast + rnd() * 1.6 : from + rnd() * (w[0] - from));
      for (let tier = 5; tier >= 0; tier--) {
        let n = Math.round(w[tier + 1] * (tier < 2 && wi === 0 ? 1 : share));
        const top = SIZES[tier][1];
        // the small stuff comes in spills: runs of sweets to roll along
        if (tier === 0) {
          while (n > 0) {
            const at0 = spot(0.5, false);
            if (!at0) break;
            const run = Math.min(n, 7 + Math.floor(rnd() * 8));
            let a = rnd() * 6.28, [x, z] = at0;
            for (let k = 0; k < run; k++) {
              a += (rnd() - 0.5) * 0.9;
              x += Math.cos(a) * 1.5;
              z += Math.sin(a) * 1.5;
              if (Math.hypot(x - cx, z - cz) > R - 1.2 || Math.hypot(x - cx, z - cz) < 8) a += 2.2;
              else list.push(put(tier, x, z, at()));
            }
            n -= run;
          }
          continue;
        }
        for (let k = 0; k < n; k++) {
          const p = spot(top, wi === 0);
          if (p) list.push(put(tier, p[0], p[1], at()));
        }
      }
    });
    meshes.forEach((m, f) => (m.count = used[f]));
    for (const q of items) place(q, q.at > 0 ? 1e4 : 0);
    limit = PICNIC.eat;
    tint(limit);
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  };
  // the food coming down: only what's in the air needs moving
  const clock = (t: number) => (state.go > 1e8 ? -1 : t - state.go);
  b.animators.push((t) => {
    const x = clock(t);
    let moved = false;
    for (const q of items) {
      if (q.at <= 0 || q.gone || x < q.at - 1.2 || x > q.at + 0.15) continue;
      place(q, Math.max(0, q.at - x) ** 2 * 28);
      moved = true;
    }
    if (moved) for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  });
  // ---- the tomatoes: a ring closes on a spot of table, then one lands on it
  const hits: Hit3[] = [];
  {
    let s = 57013;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let t = 10; t < PICNIC.T - 1; t += 5.5) {
      const n = t < 35 ? 1 : t < 65 ? 2 : 3;
      for (let k = 0; k < n; k++) {
        const a = rnd() * 6.28, d = 12 + (R - 18) * Math.sqrt(rnd());
        hits.push({ t: t + k * 0.7, x: cx + Math.cos(a) * d, y: y0, z: cz + Math.sin(a) * d, r: 7 });
      }
    }
  }
  const balls = new Map<number, Ball>();
  const ball = (id: number) => {
    let q = balls.get(id);
    if (!q) balls.set(id, (q = { mass: 0, vis: 1, quat: new THREE.Quaternion(), pulse: 0, cd: 0, fast: 0, ghost: 0, stuck: 0, by: -1, fired: false, air: false }));
    return q;
  };
  const size = (mass: number) => Math.min(PICNIC.max, Math.cbrt(1 + mass));
  // ---- how a ball rolls. The bean's own running is switched off (grip 0): this is all of it
  const roll = (m: Marble, t: number, dt: number) => {
    const q = ball(m.id);
    m.noFace = true;
    m.guardT = 1;
    const x = t - state.go, inp = m.input, r = size(q.mass);
    q.cd = Math.max(0, q.cd - dt);
    const il = Math.min(1, Math.hypot(inp.x, inp.z));
    if (q.stuck > t) {
      m.dash = false;
      m.jump = false;
      inp.set(0, 0, 0);
      return;
    }
    const dx = il > 0.1 ? inp.x / Math.max(il, 0.001) : Math.sin(m.yaw), dz = il > 0.1 ? inp.z / Math.max(il, 0.001) : Math.cos(m.yaw);
    if (m.dash) {
      m.dash = false;
      if (q.cd <= 0) {
        m.vel.x += dx * PICNIC.boost;
        m.vel.z += dz * PICNIC.boost;
        if (m.groundT > 0.12) m.vel.y = Math.max(m.vel.y, 6);
        q.cd = PICNIC.cd;
        q.fast = t + PICNIC.fast;
        q.fired = true;
      }
    }
    if (m.groundT < 0.1) {
      const top = (PICNIC.top + r * PICNIC.topR) * il;
      // (a big ball takes longer to turn: that's most of what being big feels like)
      const k = 1 - Math.exp(-(PICNIC.hold / (1 + r * PICNIC.holdR)) * dt * (q.fast > t ? 0.3 : 1));
      m.vel.x += (dx * top - m.vel.x) * k;
      m.vel.z += (dz * top - m.vel.z) * k;
    } else if (il > 0.1) {
      m.vel.x += inp.x * 6 * dt;
      m.vel.z += inp.z * 6 * dt;
    }
    // (over the edge: it tips away, faster the bigger it is)
    const ex = m.pos.x - cx, ez = m.pos.z - cz, ed = Math.hypot(ex, ez) || 1;
    if (ed > R) {
      m.vel.x += (ex / ed) * (6 + r * 3) * dt;
      m.vel.z += (ez / ed) * (6 + r * 3) * dt;
    }
    const hs = Math.hypot(m.vel.x, m.vel.z);
    if (hs > 34) {
      m.vel.x *= 34 / hs;
      m.vel.z *= 34 / hs;
    }
    if (hs > 0.8 && x >= 0) {
      const want = Math.atan2(m.vel.x, m.vel.z);
      m.yaw += Math.atan2(Math.sin(want - m.yaw), Math.cos(want - m.yaw)) * Math.min(1, dt * 9);
    }
    inp.set(0, 0, 0);
  };
  b.world.fields.push({
    min: new THREE.Vector3(cx - 200, y0 - 80, cz - 200),
    max: new THREE.Vector3(cx + 200, y0 + 60, cz + 200),
    grip: 0,
    jump: 0.95,
    act: roll,
  });
  const strikes = addStrikes(b, {
    list: hits,
    warn: 2.1,
    state,
    ring: 0xff3a2a,
    ball: { color: 0xe0281e, r: 3.4 },
    box: [new THREE.Vector3(cx - R - 2, y0 - 3, cz - R - 2), new THREE.Vector3(cx + R + 2, y0 + 24, cz + R + 2)],
    out: 15,
    up: 9,
    onHit: (m) => {
      const q = ball(m.id);
      if (q.ghost > b.world.time || q.stuck > b.world.time) return;
      q.mass *= 1 - PICNIC.splat;
      q.pulse = 1;
    },
  });
  title(b, info, 'Roll over anything smaller · Biggest balls go through', 0xe8484e, new THREE.Vector3(cx, y0 + 16, cz - R - 9));
  dressArena(b, new THREE.Vector3(cx, y0 - 6, cz), R + 12, 91);
  b.finish();
  let sd = 77541;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  return {
    id: 'stickypicnic',
    name: info.name,
    kind: 'score',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 60,
    lakeY: b.lakeY,
    state,
    grid: (n) => ringGrid(center, n, 20, 4.4, 14).map((g) => ({ ...g, pos: g.pos.clone().setY(y0 + 0.55) })),
    plate: { center, radius: R, bars: [] },
    picnic: {
      center,
      R,
      items,
      geo,
      mat,
      strikes,
      ball,
      size,
      deal,
      tint,
      eaten(k) {
        const q = items[k];
        if (!q || q.gone) return;
        q.gone = true;
        place(q, 0);
        meshes[q.food].instanceMatrix.needsUpdate = true;
      },
      view(cam, at, dt) {
        const dx = at.x - cam.x, dz = at.z - cam.z, l2 = dx * dx + dz * dz || 1, k = Math.min(1, dt * 9), x = clock(b.world.time);
        for (const q of items) {
          const fade = fades[q.food];
          if (!fade) continue;
          let want = 1;
          if (!q.gone && q.at <= x) {
            const u = THREE.MathUtils.clamp(((q.x - cam.x) * dx + (q.z - cam.z) * dz) / l2, 0, 1);
            const e = Math.hypot(cam.x + dx * u - q.x, cam.z + dz * u - q.z), y = cam.y + (at.y - cam.y) * u;
            if (u < 0.98 && e < q.r * 1.05 + 0.6 && y < q.y + q.r * 1.1) want = 0.16;
          }
          const was = fade.getX(q.slot);
          if (Math.abs(was - want) > 0.004) {
            fade.setX(q.slot, was + (want - was) * k);
            fade.needsUpdate = true;
          }
        }
      },
      near(x, z, r, f) {
        const c0 = cellOf(x - cx - r), c1 = cellOf(x - cx + r), d0 = cellOf(z - cz - r), d1 = cellOf(z - cz + r);
        for (let i = c0; i <= c1; i++)
          for (let j = d0; j <= d1; j++)
            for (const k of cells[i + j * N]) f(items[k]);
      },
      feast: (x) => x > PICNIC.T - PICNIC.feast,
      respawn(m, t) {
        const q = ball(m.id), r = size(q.mass);
        let a = 0, d = 0;
        for (let k = 0; k < 10; k++) {
          a = rnd() * 6.28;
          d = 12 + (R - 16 - r) * Math.sqrt(rnd());
          const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
          if (!items.some((o) => !o.gone && o.at <= clock(t) && o.r > r * PICNIC.eat && Math.hypot(o.x - x, o.z - z) < o.r + r + 1)) break;
        }
        m.pos.set(cx + Math.cos(a) * d, y0 + PICNIC.back, cz + Math.sin(a) * d);
        m.vel.set(0, 0, 0);
        m.hitBy = -1;
        m.yaw = Math.atan2(cx - m.pos.x, cz - m.pos.z);
        q.cd = 0;
        q.stuck = 0;
        q.by = -1;
        q.ghost = t + PICNIC.backGhost;
      },
    },
    intro: [],
  };
}
