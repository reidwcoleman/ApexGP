import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { signTexture } from './obstacles.ts';
import { glowMat } from './obs-world.ts';
import { addStrikes, type Hit3, type Strikes } from './course-strikes.ts';

/**
 * The rounds that aren't races or plain survivals, each its own game:
 *
 *  Colour Call (disco): a dance floor of colour. A colour is called, every other tile drops.
 *  Hot Spud (circus): a ring, a few spuds with a lit fuse. Touch someone to pass yours on; whoever
 *    holds one when it goes off is out.
 *
 * What happens in Colour Call is a pure function of the round's clock (seeded), so
 * every browser sees the same thing; the spuds are the host's (modes.ts).
 */

const seeded = (s: number) => {
  let sd = (s % 2147483646) + 1;
  return () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
};
const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const M = new THREE.Matrix4(), V = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), CL = new THREE.Color();

export function title(b: CourseBuilder, info: { name: string }, tag: string, color: number, at: THREE.Vector3) {
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshBasicMaterial({ map: signTexture(info.name.toUpperCase(), tag, color, 9 / 1.7), transparent: true }));
  sign.position.copy(at);
  b.group.add(sign);
}

export function ringGrid(center: THREE.Vector3, n: number, r0: number, dr: number, per: number) {
  const out: { pos: THREE.Vector3; yaw: number }[] = [];
  for (let k = 0; k < n; k++) {
    const ring = Math.floor(k / per), inRing = Math.min(per, n - ring * per), kk = k - ring * per;
    const a = (kk / inRing) * Math.PI * 2 + ring * 0.5, r = r0 + ring * dr;
    const p = new THREE.Vector3(center.x + Math.cos(a) * r, center.y + 0.55, center.z + Math.sin(a) * r);
    out.push({ pos: p, yaw: Math.atan2(center.x - p.x, center.z - p.z) });
  }
  return out;
}

// ------------------------------------------------------------------------------------ Colour Call
export const CALL = { n: 8, tile: 3.6, colors: [0xff3a8a, 0xffd21f, 0x2fe06a, 0x2fa8ff, 0xff8a1f, 0xb05aff], names: ['PINK', 'YELLOW', 'GREEN', 'BLUE', 'ORANGE', 'PURPLE'], gone: 1.6, rest: 1.5 };

export interface Call {
  i: number;
  /** when the call is made, when the rest drops, when it's back (seconds after the off) */
  t0: number;
  drop: number;
  back: number;
  /** the colour that's safe when the floor goes (an index into CALL.colors) */
  c: number;
  /** a double call: a second safe colour (-1: none) */
  c2: number;
  /** a switch: the colour called first, and when the call changes to the real one (-1: no switch) */
  fake: number;
  swap: number;
  /** each tile's colour for this call */
  tiles: Uint8Array;
  safe: number[];
  /** a switch: the tiles of the colour called first */
  decoy: number[];
}
/** the colour showing at x (a switch shows its decoy until it changes) */
export const shownColour = (c: Call, x: number) => (c.fake >= 0 && x < c.swap ? c.fake : c.c);
/** the tiles worth running to at x */
export const shownTiles = (c: Call, x: number) => (c.fake >= 0 && x < c.swap ? c.decoy : c.safe);
export interface CallArena {
  center: THREE.Vector3;
  half: number;
  /** the call at x seconds after the off */
  at(x: number): Call;
  xz(k: number): [number, number];
  /** a new order of calls (the same number gives the same calls in every browser) */
  deal(seed: number): void;
}

/** a tile's top: a raised, rounded panel in a darker frame */
function tileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#8a8a96';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.roundRect(7, 7, 114, 114, 16);
  x.fill();
  const g = x.createRadialGradient(64, 64, 8, 64, 64, 84);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(120,120,140,0.3)');
  x.fillStyle = g;
  x.beginPath();
  x.roundRect(7, 7, 114, 114, 16);
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The calls for one round. The colours come out of a shuffled bag, so all six get called before any
 * comes round again and none is called twice running. Later on some calls are doubles (two colours
 * are safe) and some are switches (the call changes at the last moment).
 */
function callList(seed: number) {
  const out: Call[] = [];
  const N = CALL.n * CALL.n;
  // (a small seed's first number is always tiny: that's how every call came out pink. Hash it, and warm it up)
  const rnd = seeded(Math.floor(hash(seed, 7001) * 2147483000) + 1);
  for (let k = 0; k < 8; k++) rnd();
  const shuffled = (a: number[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  let bag: number[] = [];
  /** the next colour out of the bag that isn't one of `not` (a new shuffle goes in under what's left) */
  const draw = (not: number[]) => {
    if (!bag.some((x) => !not.includes(x))) bag = [...shuffled([0, 1, 2, 3, 4, 5]), ...bag];
    for (let k = bag.length - 1; k >= 0; k--) if (!not.includes(bag[k])) return bag.splice(k, 1)[0];
    return 0;
  };
  /** what the last call left safe: the next one never opens on it */
  let prev: number[] = [];
  let t = 2.2;
  for (let i = 0; i < 80; i++) {
    const warn = Math.max(2.3, 4 - 0.1 * i);
    const c = draw(prev);
    // (from the sixth call on, every third is a switch; from the fifth, every fifth a double)
    const fake = i >= 5 && i % 3 === 2 ? draw([...prev, c]) : -1;
    const c2 = fake < 0 && i >= 4 && i % 5 === 4 ? draw([...prev, c]) : -1;
    prev = c2 >= 0 ? [c, c2] : [c];
    const swap = fake >= 0 ? t + warn - Math.max(1.8, warn * 0.6) : t;
    const kinds = Math.min(6, 3 + Math.floor(i / 2));
    const others = [0, 1, 2, 3, 4, 5].filter((x) => x !== c && x !== c2 && x !== fake);
    const rest = shuffled(others).slice(0, Math.max(1, kinds - 1));
    // (fewer safe tiles as it goes on, spread over the floor)
    const nSafe = Math.max(6, 20 - Math.floor(i * 0.8)) + (fake >= 0 ? 3 : 0);
    const order = shuffled(Array.from({ length: N }, (_, k) => k));
    const safe = order.slice(0, nSafe);
    const decoy = fake >= 0 ? order.slice(nSafe, nSafe * 2 + 2) : [];
    const also = c2 >= 0 ? order.slice(nSafe, nSafe * 2) : [];
    const tiles = new Uint8Array(N);
    for (let k = 0; k < N; k++) tiles[k] = rest[Math.floor(rnd() * rest.length)];
    for (const k of safe) tiles[k] = c;
    for (const k of decoy) tiles[k] = fake;
    for (const k of also) tiles[k] = c2;
    out.push({ i, t0: t, drop: t + warn, back: t + warn + CALL.gone, c, c2, fake, swap, tiles, safe: c2 >= 0 ? [...safe, ...also] : safe, decoy });
    t += warn + CALL.gone + CALL.rest;
  }
  return out;
}

export function colourCall(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 120, 0);
  const state = { go: 1e9 };
  const { n, tile } = CALL;
  const half = (n * tile) / 2;
  b.lakeY = center.y - 16;
  let list = callList(1);
  const at = (x: number) => {
    let lo = 0, hi = list.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (list[m].t0 <= x) lo = m;
      else hi = m - 1;
    }
    return list[lo];
  };
  const xz = (k: number): [number, number] => [center.x - half + ((k % n) + 0.5) * tile, center.z - half + (Math.floor(k / n) + 0.5) * tile];
  const safeOn = (c: Call, k: number) => c.tiles[k] === c.c || c.tiles[k] === c.c2;
  // the tiles: solid until they drop (down out of the way, back when the call is over)
  const down = (k: number, x: number) => {
    const c = at(x);
    return x >= c.drop && x < c.back && !safeOn(c, k);
  };
  const N = n * n;
  const hx = tile / 2 - 0.05;
  for (let k = 0; k < N; k++) {
    const [px, pz] = xz(k);
    const kin = new Kin({ type: 'box', hx, hy: 0.3, hz: hx }, Mat.Paint, (t, pos, quat) => {
      pos.set(px, center.y - 0.3, pz);
      if (down(k, t - state.go)) pos.y -= 60;
      quat.identity();
    });
    b.world.addKin(kin);
  }
  // what you see: one instanced floor, lit from inside
  const floorM = new THREE.MeshStandardMaterial({ roughness: 0.28, metalness: 0.1, map: tileTexture() });
  floorM.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.62;');
  };
  floorM.customProgramCacheKey = () => 'mm-call-floor';
  const floor = new THREE.InstancedMesh(new THREE.BoxGeometry(tile - 0.1, 0.6, tile - 0.1), floorM, N);
  floor.frustumCulled = false;
  floor.receiveShadow = true;
  for (let k = 0; k < N; k++) floor.setColorAt(k, CL.set(0xffffff));
  b.group.add(floor);
  const pal = CALL.colors.map((c) => new THREE.Color(c));
  // the safe tiles throw a column of light up, so you can see them from anywhere on the floor
  const fade = document.createElement('canvas');
  fade.width = 4;
  fade.height = 64;
  {
    const x = fade.getContext('2d')!;
    const gr = x.createLinearGradient(0, 0, 0, 64);
    gr.addColorStop(0, '#000');
    gr.addColorStop(1, '#fff');
    x.fillStyle = gr;
    x.fillRect(0, 0, 4, 64);
  }
  const pillarM = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: new THREE.CanvasTexture(fade), transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending });
  const pillars = new THREE.InstancedMesh(new THREE.CylinderGeometry(tile * 0.68, tile * 0.68, 7, 4, 1, true).rotateY(Math.PI / 4).translate(0, 3.5, 0), pillarM, 24);
  pillars.frustumCulled = false;
  b.group.add(pillars);
  // the frame under it (so the floor has an edge), and the big cube overhead that shows the colour
  {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 1.2, 0.5, half * 2 + 1.2).translate(center.x, center.y - 1.1, center.z), new THREE.MeshStandardMaterial({ color: 0x1a1030, roughness: 0.4, metalness: 0.6 }));
    b.group.add(fr);
  }
  const cubeM = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), cubeM);
  cube.position.set(center.x, center.y + 15, center.z);
  b.group.add(cube);
  // a mirror ball over it, and beams of light turning
  const ballG = new THREE.IcosahedronGeometry(2.6, 2);
  const ball = new THREE.Mesh(ballG, new THREE.MeshStandardMaterial({ color: 0xe8e8f4, roughness: 0.08, metalness: 1, flatShading: true }));
  ball.position.set(center.x, center.y + 21.5, center.z);
  b.group.add(ball);
  const beams: THREE.Mesh[] = [];
  for (let k = 0; k < 6; k++) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(2.6, 34, 16, 1, true).translate(0, -17, 0), new THREE.MeshBasicMaterial({ color: CALL.colors[k], transparent: true, opacity: 0.045, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.position.copy(ball.position);
    beams.push(m);
    b.group.add(m);
  }
  b.animators.push((t) => {
    const x = t - state.go;
    const c = at(Math.max(0, x));
    const live = x >= c.t0;
    for (let k = 0; k < N; k++) {
      const [px, pz] = xz(k);
      let y = center.y - 0.3;
      let dx = 0;
      const safe = safeOn(c, k);
      // (what you can see: before a switch the decoy looks like the safe colour)
      const lit = x < c.swap ? c.tiles[k] === c.fake : safe;
      if (live && !safe) {
        const toDrop = c.drop - x;
        // (shaking as it's about to go, then down)
        if (toDrop > 0 && toDrop < 0.7) dx = Math.sin(x * 60 + k) * 0.05;
        else if (x >= c.drop && x < c.back) y -= Math.min(40, (x - c.drop) * (x - c.drop) * 42 + 0.5);
        else if (x >= c.back) y -= Math.max(0, (c.back + 0.35 - x) / 0.35) * 8;
      }
      floor.setMatrixAt(k, M.compose(V.set(px + dx, y, pz), Q.identity(), S));
      CL.copy(pal[c.tiles[k]]);
      if (x < 0) CL.multiplyScalar(0.7);
      else if (lit && x < c.drop) CL.lerp(pal[c.tiles[k]].clone().addScalar(0.45), 0.35 + 0.35 * Math.sin(x * 9));
      else if (!lit && x < c.drop) CL.multiplyScalar(0.55);
      floor.setColorAt(k, CL);
    }
    floor.instanceMatrix.needsUpdate = true;
    floor.instanceColor!.needsUpdate = true;
    // (the light columns, while there's still time)
    const shine = live && x < c.drop;
    const lights = shownTiles(c, x);
    const now = shownColour(c, x);
    pillars.count = shine ? Math.min(24, lights.length) : 0;
    if (shine) {
      pillarM.color.copy(pal[now]);
      pillarM.opacity = 0.2 + 0.08 * Math.sin(x * 9);
      for (let i = 0; i < pillars.count; i++) {
        const [px, pz] = xz(lights[i]);
        pillars.setMatrixAt(i, M.compose(V.set(px, center.y, pz), Q.identity(), S));
      }
      pillars.instanceMatrix.needsUpdate = true;
    }
    // (a double call flicks between its two colours)
    cubeM.color.copy(pal[c.c2 >= 0 && Math.sin(x * 7) > 0 ? c.c2 : now]).multiplyScalar(live && x < c.drop ? 1.25 + 0.5 * Math.sin(x * 10) : 0.5);
    cube.rotation.y = t * 0.5;
    ball.rotation.y = t * 0.3;
    beams.forEach((m, k) => {
      const a = t * 0.5 + (k / 6) * Math.PI * 2;
      m.rotation.set(0.55 * Math.cos(a), 0, 0.55 * Math.sin(a));
    });
  });
  title(b, info, 'Survival · Stand on the colour', 0xff3a8a, new THREE.Vector3(center.x, center.y + 8, center.z - half - 9));
  dressArena(b, new THREE.Vector3(center.x, center.y - 2, center.z), half + 6, 31);
  b.finish();
  return {
    id: 'colourcall',
    name: info.name,
    kind: 'survival',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: center.y - 6,
    lakeY: b.lakeY,
    state,
    grid: (nn) => ringGrid(center, nn, 3.4, 3.6, 8),
    plate: { center, radius: half + 2, bars: [] },
    call: { center, half, at, xz, deal: (seed) => (list = callList(seed)) },
    intro: [],
  };
}

// ----------------------------------------------------------------------------------------- Hot Spud
export const SPUD = { R: 17, fuse: 15, gap: 1.2, pass: 1.45, dive: 2.6, wait: 0.8, blast: 5.5 };

export interface SpudArena {
  center: THREE.Vector3;
  R: number;
  /** the pillars in the ring */
  posts: { x: number; z: number; r: number }[];
  /** who has one now (bean ids), and the world time they go off */
  holders: Set<number>;
  end: number;
  /** who just got rid of one, and until when they have a burst of speed */
  free: Map<number, number>;
  /** the beans with people behind them (a bot with a spud would rather tag another bot) */
  people: Set<number>;
}

function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d')!;
  for (let k = 0; k < 24; k++) {
    x.beginPath();
    x.moveTo(512, 512);
    x.arc(512, 512, 520, (k / 24) * Math.PI * 2, ((k + 1) / 24) * Math.PI * 2);
    x.closePath();
    x.fillStyle = k % 2 ? '#e8d8b0' : '#d8c498';
    x.fill();
  }
  for (const [r, col] of [[500, '#d8283a'], [470, '#ffcf3a'], [160, '#d8283a'], [130, '#ffcf3a']] as const) {
    x.beginPath();
    x.arc(512, 512, r, 0, Math.PI * 2);
    x.lineWidth = 24;
    x.strokeStyle = col;
    x.stroke();
  }
  // a star in the middle
  x.save();
  x.translate(512, 512);
  x.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2, r = k % 2 ? 44 : 104;
    x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  x.closePath();
  x.fillStyle = '#d8283a';
  x.fill();
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function hotSpud(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 110, 0);
  const R = SPUD.R;
  const state = { go: 1e9 };
  // (the ring stands on the fairground, among the tents)
  b.lakeY = center.y - 1.4;
  const arena: SpudArena = { center, R, posts: [], holders: new Set(), end: 0, free: new Map(), people: new Set() };
  // the floor (a sawdust ring) and the padded kerb that keeps you in it
  {
    const top = new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2).translate(center.x, center.y, center.z);
    const tm = new THREE.Mesh(top, new THREE.MeshPhysicalMaterial({ map: ringTexture(), roughness: 0.6, clearcoat: 0.25 }));
    tm.receiveShadow = true;
    b.group.add(tm);
    b.world.statics.addGeometry(top, Mat.Paint);
    const under = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.8, R * 0.6, 8, 48, 1).translate(center.x, center.y - 4.05, center.z), new THREE.MeshStandardMaterial({ color: 0x8a2a3a, roughness: 0.6 }));
    b.group.add(under);
    // (taller than it looks: a blast never throws anyone out of the ring)
    const wall = new THREE.CylinderGeometry(R, R, 9, 72, 1, true).translate(center.x, center.y + 4.5, center.z);
    b.world.statics.addGeometry(wall, Mat.Paint);
    // (what you see of it: red and white pads)
    const gs: THREE.BufferGeometry[] = [];
    const n = 36;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const g = new THREE.BoxGeometry((R * Math.PI * 2) / n + 0.05, 1.5, 0.9).rotateY(Math.PI / 2 - a).translate(center.x + Math.cos(a) * (R + 0.42), center.y + 0.75, center.z + Math.sin(a) * (R + 0.42)).toNonIndexed();
      const cols = new Float32Array(g.getAttribute('position').count * 3);
      CL.set(k % 2 ? 0xffffff : 0xe8283a);
      for (let i = 0; i < cols.length; i += 3) CL.toArray(cols, i);
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      gs.push(g);
    }
    const pads = new THREE.Mesh(mergeGeometries(gs), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.6 }));
    pads.castShadow = pads.receiveShadow = true;
    b.group.add(pads);
  }
  // four drums to dodge round, and to hide behind
  const postM = new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.35, clearcoat: 0.8 });
  const bandM = new THREE.MeshPhysicalMaterial({ color: 0x2f6aff, roughness: 0.35, clearcoat: 0.8 });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4, r = 8.6, pr = 1.7;
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    arena.posts.push({ x, z, r: pr });
    const g = new THREE.CylinderGeometry(pr, pr * 1.08, 1.5, 28).translate(x, center.y + 0.75, z);
    b.world.statics.addGeometry(g, Mat.Paint);
    const m = new THREE.Mesh(g, postM);
    m.castShadow = m.receiveShadow = true;
    b.group.add(m);
    const t = new THREE.Mesh(new THREE.TorusGeometry(pr + 0.03, 0.1, 8, 28).rotateX(Math.PI / 2).translate(x, center.y + 1.4, z), bandM);
    b.group.add(t);
  }
  // the big top's frame over the ring: a pole, a crown of bunting
  {
    const flags: THREE.BufferGeometry[] = [];
    const cc = [0xe8283a, 0xffc21f, 0x2f8cff, 0x37c25a, 0xffffff];
    for (let s = 0; s < 8; s++) {
      const a = (s / 8) * Math.PI * 2;
      const ex = center.x + Math.cos(a) * (R + 14), ez = center.z + Math.sin(a) * (R + 14);
      for (let k = 1; k < 20; k++) {
        const u = k / 20;
        const fx = center.x + (ex - center.x) * u, fz = center.z + (ez - center.z) * u;
        const fy = center.y + 16 - 6 * u + Math.sin(u * Math.PI) * -1.2;
        const g = new THREE.ConeGeometry(0.42, 1, 3).rotateX(Math.PI).rotateY(a).scale(1, 1, 0.12).translate(fx, fy - 0.4, fz).toNonIndexed();
        const cols = new Float32Array(g.getAttribute('position').count * 3);
        CL.set(cc[(k + s) % cc.length]);
        for (let i = 0; i < cols.length; i += 3) CL.toArray(cols, i);
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        g.deleteAttribute('uv');
        flags.push(g);
      }
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 12, 10).translate(ex, center.y + 4.6, ez), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
      b.group.add(post);
    }
    b.group.add(new THREE.Mesh(mergeGeometries(flags), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide })));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 14), new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.25, metalness: 0.4 }));
    ball.position.set(center.x, center.y + 15.4, center.z);
    b.group.add(ball);
  }
  // (a spud holder runs a little faster: it has to catch you)
  b.world.fields.push({
    min: new THREE.Vector3(center.x - R - 3, center.y - 2, center.z - R - 3),
    max: new THREE.Vector3(center.x + R + 3, center.y + 6, center.z + R + 3),
    act: (m: Marble, t: number) => {
      if (arena.holders.has(m.id)) m.runK *= 1.12;
      else if ((arena.free.get(m.id) ?? 0) > t) m.runK *= 1.3;
      // (the drums are sprung: run into one and it throws you back out)
      for (const p of arena.posts) {
        const dx = m.pos.x - p.x, dz = m.pos.z - p.z, d = Math.hypot(dx, dz);
        if (d > p.r + 0.62 || d < 0.05 || m.pos.y > center.y + 2.2) continue;
        const out = m.vel.x * (dx / d) + m.vel.z * (dz / d);
        if (out > 6) continue;
        m.vel.x += (dx / d) * (11 - out);
        m.vel.z += (dz / d) * (11 - out);
        m.vel.y = Math.max(m.vel.y, 6);
        m.groundT = 1;
      }
    },
  });
  title(b, info, 'Survival · Pass it on', 0xe8283a, new THREE.Vector3(center.x, center.y + 7, center.z - R - 6));
  dressArena(b, new THREE.Vector3(center.x, center.y - 2, center.z), R + 6, 37);
  b.finish();
  return {
    id: 'hotspud',
    name: info.name,
    kind: 'survival',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: center.y - 8,
    lakeY: b.lakeY,
    state,
    grid: (n) => ringGrid(center, n, 5, 3.4, 9),
    plate: { center, radius: R, bars: [] },
    spud: arena,
    intro: [],
  };
}
