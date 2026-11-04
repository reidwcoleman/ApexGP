import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { signTexture } from './obstacles.ts';
import { glowMat } from './obs-world.ts';

/**
 * The four rounds that aren't races or plain survivals, each its own game:
 *
 *  Colour Call (disco): a dance floor of colour. A colour is called, every other tile drops.
 *  Hot Spud (circus): a ring, a few spuds with a lit fuse. Touch someone to pass yours on; whoever
 *    holds one when it goes off is out.
 *  Gold Rush (pirate): a chest on an island spits gold. Grab it, knock it out of the others, keep
 *    out of the sea. The ones with the least go home.
 *  Belt Rush (toybox): a huge belt carrying toy blocks at you, faster and faster. Dodge them, hop
 *    the low ones and stay on: off the back and you're out.
 *
 * What happens in Colour Call and Belt Rush is a pure function of the round's clock (seeded), so
 * every browser sees the same thing; the spuds and the gold are the host's (modes.ts).
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

function title(b: CourseBuilder, info: { name: string }, tag: string, color: number, at: THREE.Vector3) {
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshBasicMaterial({ map: signTexture(info.name.toUpperCase(), tag, color, 9 / 1.7), transparent: true }));
  sign.position.copy(at);
  b.group.add(sign);
}

function ringGrid(center: THREE.Vector3, n: number, r0: number, dr: number, per: number) {
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
export const CALL = { n: 8, tile: 3.6, colors: [0xff3a8a, 0xffd21f, 0x2fe06a, 0x2fa8ff, 0xff8a1f, 0xb05aff], names: ['PINK', 'YELLOW', 'GREEN', 'BLUE', 'ORANGE', 'PURPLE'], gone: 1.6, rest: 0.9 };

export interface Call {
  i: number;
  /** when the call is made, when the rest drops, when it's back (seconds after the off) */
  t0: number;
  drop: number;
  back: number;
  /** the colour called (an index into CALL.colors) */
  c: number;
  /** each tile's colour for this call */
  tiles: Uint8Array;
  safe: number[];
}
export interface CallArena {
  center: THREE.Vector3;
  half: number;
  /** the call at x seconds after the off */
  at(x: number): Call;
  xz(k: number): [number, number];
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

function callList() {
  const out: Call[] = [];
  const N = CALL.n * CALL.n;
  let t = 2.5;
  for (let i = 0; i < 80; i++) {
    const rnd = seeded(7001 + i * 131);
    const warn = Math.max(1.7, 4.2 - 0.3 * i);
    const kinds = Math.min(6, 3 + Math.floor(i / 2));
    const c = Math.floor(rnd() * 6);
    const others = [0, 1, 2, 3, 4, 5].filter((x) => x !== c).sort(() => rnd() - 0.5).slice(0, kinds - 1);
    // (fewer safe tiles as it goes on, spread over the floor)
    const nSafe = Math.max(2, 11 - i * 2);
    const order = Array.from({ length: N }, (_, k) => k).sort(() => rnd() - 0.5);
    const safe = order.slice(0, nSafe);
    const tiles = new Uint8Array(N);
    for (let k = 0; k < N; k++) tiles[k] = others[Math.floor(rnd() * others.length)];
    for (const k of safe) tiles[k] = c;
    out.push({ i, t0: t, drop: t + warn, back: t + warn + CALL.gone, c, tiles, safe });
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
  const list = callList();
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
  // the tiles: solid until they drop (down out of the way, back when the call is over)
  const down = (k: number, x: number) => {
    const c = at(x);
    return x >= c.drop && x < c.back && c.tiles[k] !== c.c;
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
  const pillars = new THREE.InstancedMesh(new THREE.CylinderGeometry(tile * 0.68, tile * 0.68, 7, 4, 1, true).rotateY(Math.PI / 4).translate(0, 3.5, 0), pillarM, 12);
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
      const safe = c.tiles[k] === c.c;
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
      else if (safe && x < c.drop) CL.lerp(pal[c.c].clone().addScalar(0.45), 0.35 + 0.35 * Math.sin(x * 9));
      else if (!safe && x < c.drop) CL.multiplyScalar(0.55);
      floor.setColorAt(k, CL);
    }
    floor.instanceMatrix.needsUpdate = true;
    floor.instanceColor!.needsUpdate = true;
    // (the light columns, while there's still time)
    const shine = live && x < c.drop;
    pillars.count = shine ? Math.min(12, c.safe.length) : 0;
    if (shine) {
      pillarM.color.copy(pal[c.c]);
      pillarM.opacity = 0.2 + 0.08 * Math.sin(x * 9);
      for (let i = 0; i < pillars.count; i++) {
        const [px, pz] = xz(c.safe[i]);
        pillars.setMatrixAt(i, M.compose(V.set(px, center.y, pz), Q.identity(), S));
      }
      pillars.instanceMatrix.needsUpdate = true;
    }
    cubeM.color.copy(pal[c.c]).multiplyScalar(live && x < c.drop ? 1.25 + 0.5 * Math.sin(x * 10) : 0.5);
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
    call: { center, half, at, xz },
    intro: [],
  };
}

// ----------------------------------------------------------------------------------------- Hot Spud
export const SPUD = { R: 17, fuse: 12.5, gap: 1.6, pass: 1.45, wait: 0.8 };

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

// ----------------------------------------------------------------------------------------- Gold Rush
export const GOLD = { R: 15.5, T: 55, fly: 0.85, life: 11, take: 1.25, chest: 1.9, frenzy: 12 };

export interface Coin {
  k: number;
  t: number;
  x: number;
  z: number;
  v: number;
}
export interface GoldArena {
  center: THREE.Vector3;
  R: number;
  /** the chest's coins, in the order they fly (seconds after the off) */
  coins: Coin[];
}

export function goldRush(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 116, 0);
  const R = GOLD.R;
  const state = { go: 1e9 };
  // (an island in the sea, not over it: fall in and you're in the surf)
  b.lakeY = center.y - 2.6;
  // the coins: every one from the chest, seeded
  const coins: Coin[] = [];
  {
    const rnd = seeded(2207);
    let t = 0.6, k = 0;
    while (t < GOLD.T + 2) {
      const a = rnd() * Math.PI * 2, r = GOLD.chest + 1 + (R - GOLD.chest - 2.2) * Math.sqrt(rnd());
      // (the last stretch is a frenzy: twice the coins, far more big ones)
      const mad = t > GOLD.T - GOLD.frenzy;
      coins.push({ k: k++, t, x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, v: k % (mad ? 4 : 11) === 0 ? 5 : 1 });
      t += Math.max(0.1, 0.2 - t * 0.0016) * (0.7 + rnd() * 0.6) * (mad ? 0.55 : 1);
    }
  }
  // the island: a sandy round with a rocky rim, no rail: the sea is right there
  {
    const top = new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2).translate(center.x, center.y, center.z);
    b.world.statics.addGeometry(top, Mat.Paint);
    const sand = document.createElement('canvas');
    sand.width = sand.height = 512;
    const x = sand.getContext('2d')!;
    const gr = x.createRadialGradient(256, 256, 40, 256, 256, 256);
    gr.addColorStop(0, '#f6dca0');
    gr.addColorStop(0.82, '#f0cc88');
    gr.addColorStop(0.93, '#e0b070');
    gr.addColorStop(1, '#6ad0c8');
    x.fillStyle = gr;
    x.fillRect(0, 0, 512, 512);
    const rnd = seeded(77);
    for (let k = 0; k < 2600; k++) {
      x.fillStyle = `rgba(${rnd() < 0.5 ? '120,80,40' : '255,240,200'},${0.05 + rnd() * 0.15})`;
      x.fillRect(rnd() * 512, rnd() * 512, 2, 2);
    }
    // an X marks the spot
    x.strokeStyle = 'rgba(190,50,40,0.75)';
    x.lineWidth = 11;
    x.lineCap = 'round';
    for (const [a, c] of [[120, 392], [392, 120]]) {
      x.beginPath();
      x.moveTo(a, 120);
      x.lineTo(c, 392);
      x.stroke();
    }
    const tx = new THREE.CanvasTexture(sand);
    tx.colorSpace = THREE.SRGBColorSpace;
    const tm = new THREE.Mesh(top, new THREE.MeshStandardMaterial({ map: tx, roughness: 0.92 }));
    tm.receiveShadow = true;
    b.group.add(tm);
    const under = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.2, R * 0.55, 14, 28, 2).translate(center.x, center.y - 7.04, center.z), new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.95, flatShading: true }));
    b.group.add(under);
  }
  // the chest in the middle (solid: you run round it), its lid thrown back and gold heaped inside
  {
    const c = GOLD.chest;
    const body = new THREE.BoxGeometry(c * 1.7, 1.3, c * 1.25).translate(center.x, center.y + 0.65, center.z);
    b.world.statics.addGeometry(body, Mat.Paint);
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a24, roughness: 0.7 });
    const iron = new THREE.MeshStandardMaterial({ color: 0xd8a830, roughness: 0.3, metalness: 0.8 });
    const m = new THREE.Mesh(body, wood);
    m.castShadow = m.receiveShadow = true;
    b.group.add(m);
    for (const e of [-1, 1]) b.group.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.36, c * 1.3).translate(center.x + e * c * 0.55, center.y + 0.65, center.z), iron));
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(c * 0.62, c * 0.62, c * 1.72, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(center.x, center.y + 1.8, center.z - c * 0.72), wood);
    b.group.add(lid);
    const heap = new THREE.Mesh(new THREE.SphereGeometry(c * 0.7, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.15, 0.42, 0.8).translate(center.x, center.y + 1.28, center.z), new THREE.MeshStandardMaterial({ color: 0xffc830, roughness: 0.25, metalness: 0.9, emissive: 0x8a5a00, emissiveIntensity: 0.5 }));
    b.group.add(heap);
    // (it rattles as it spits, harder in the frenzy)
    b.animators.push((t) => {
      const x = t - state.go;
      const k = x < 0 || x > GOLD.T ? 0 : x > GOLD.T - GOLD.frenzy ? 1 : 0.4;
      lid.position.y = Math.abs(Math.sin(t * 13)) * 0.16 * k;
      lid.rotation.z = Math.sin(t * 21) * 0.006 * k;
      heap.scale.y = 1 + 0.1 * k * Math.sin(t * 17);
    });
  }
  // the surf round the island
  {
    const foam = new THREE.Mesh(new THREE.RingGeometry(R - 1.2, R + 3.2, 96, 1).rotateX(-Math.PI / 2).translate(center.x, b.lakeY + 0.06, center.z), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
    const foam2 = new THREE.Mesh(new THREE.RingGeometry(R + 3.6, R + 4.3, 96, 1).rotateX(-Math.PI / 2).translate(center.x, b.lakeY + 0.06, center.z), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    b.group.add(foam, foam2);
    b.animators.push((t) => {
      const s = 1 + 0.018 * Math.sin(t * 1.1);
      foam.scale.set(s, 1, s);
      foam.position.x = center.x * (1 - s);
      foam.position.z = center.z * (1 - s);
      foam2.scale.set(2 - s, 1, 2 - s);
      (foam2.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.18 * Math.sin(t * 1.1 + 1);
    });
  }
  // palms and barrels at the edge (you can use them to hide; a knock into the sea is still a knock)
  {
    const trunk = new THREE.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.8 });
    const leaf = new THREE.MeshStandardMaterial({ color: 0x2fa84a, roughness: 0.7, side: THREE.DoubleSide });
    for (let k = 0; k < 3; k++) {
      const a = 0.5 + (k / 3) * Math.PI * 2, r = R - 3.6;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const g = new THREE.CylinderGeometry(0.3, 0.46, 7, 10).translate(x, center.y + 3.5, z);
      b.world.statics.addGeometry(new THREE.CylinderGeometry(0.46, 0.46, 3, 10).translate(x, center.y + 1.5, z), Mat.Paint);
      const m = new THREE.Mesh(g, trunk);
      m.castShadow = true;
      b.group.add(m);
      for (let q = 0; q < 7; q++) {
        const fa = (q / 7) * Math.PI * 2;
        const l = new THREE.Mesh(new THREE.ConeGeometry(0.75, 3.8, 4).scale(1, 1, 0.2).translate(0, 1.9, 0), leaf);
        l.position.set(x, center.y + 7, z);
        l.rotation.set(0, -fa, 1.95);
        l.castShadow = true;
        b.group.add(l);
      }
    }
  }
  title(b, info, 'Most gold wins · Least goes home', 0xffb020, new THREE.Vector3(center.x, center.y + 8, center.z - R - 6));
  dressArena(b, new THREE.Vector3(center.x, center.y - 2, center.z), R + 6, 41);
  b.finish();
  return {
    id: 'goldrush',
    name: info.name,
    kind: 'score',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: center.y - 2.2,
    lakeY: b.lakeY,
    state,
    grid: (n) => ringGrid(center, n, 4.2, 3.2, 9),
    plate: { center, radius: R, bars: [] },
    gold: { center, R, coins },
    intro: [],
  };
}

// ----------------------------------------------------------------------------------------- Belt Rush
export const BELT = { W: 18, near: 21, far: 25, lanes: 5, D: 8.2, v0: 3.6, a: 0.1, vMax: 8.2, tall: 0.8, low: 0.56 };

export interface BeltRow {
  n: number;
  z: number;
  /** a lane each: 0 free, 1 a low block (hop it), 2 a tall one */
  kinds: number[];
}
export interface BeltArena {
  center: THREE.Vector3;
  lane: number;
  /** how far the belt has run, and its speed, at x seconds after the off */
  run(x: number): number;
  speed(x: number): number;
  /** the rows on the belt at x, nearest the front (the back edge) first */
  rows(x: number, out: BeltRow[]): BeltRow[];
  laneX(l: number): number;
}

function stripes() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    x.fillStyle = i % 2 ? '#1d1b22' : '#ffcf2a';
    x.fillRect(0, i * 8, 128, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a row's blocks: more of them as the round goes on, always a way through */
function rowKinds(n: number) {
  const { lanes } = BELT;
  const hard = Math.min(1, n / 26);
  const free = hash(n, 1) < 0.55 - hard * 0.4 ? 2 : 1;
  const out = new Array<number>(lanes).fill(0);
  const gap = Math.floor(hash(n, 2) * lanes) % lanes;
  const open = new Set([gap]);
  if (free === 2) open.add((gap + 1 + Math.floor(hash(n, 3) * (lanes - 1))) % lanes);
  for (let l = 0; l < lanes; l++) {
    if (open.has(l)) continue;
    const r = hash(n, 10 + l);
    // (early rows are mostly gaps)
    if (r < 0.42 - hard * 0.36) continue;
    out[l] = hash(n, 20 + l) < 0.42 ? 1 : 2;
  }
  return out;
}

export function beltRush(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 112, 0);
  const state = { go: 1e9 };
  b.lakeY = center.y - 30;
  const { W, near, far, lanes, D, v0, a, vMax, tall, low } = BELT;
  const zFar = center.z - far, zBack = center.z + near, L = near + far;
  const lane = W / lanes;
  const x1 = (vMax - v0) / a;
  const speed = (x: number) => (x <= 0 ? 0 : Math.min(vMax, v0 + a * x));
  const run = (x: number) => (x <= 0 ? 0 : x < x1 ? v0 * x + (a * x * x) / 2 : v0 * x1 + (a * x1 * x1) / 2 + vMax * (x - x1));
  const laneX = (l: number) => center.x - W / 2 + (l + 0.5) * lane;
  const K = Math.ceil(L / D) + 1;
  const kinds = new Map<number, number[]>();
  const kindsOf = (n: number) => {
    let k = kinds.get(n);
    if (!k) {
      if (kinds.size > 200) kinds.clear();
      kinds.set(n, (k = rowKinds(n)));
    }
    return k;
  };
  /** the row in a slot now (each slot's row comes round again at the far end), or -1 */
  const slotRow = (j: number, s: number) => {
    const n = j + K * Math.ceil(((s - L) / D - j) / K);
    return n * D <= s ? n : -1;
  };
  const rowZ = (n: number, s: number) => zFar + (s - n * D);
  // the belt: the floor, with walls down both sides and a wall of toys at the far end
  {
    const floor = new THREE.PlaneGeometry(W + 0.02, L).rotateX(-Math.PI / 2).translate(center.x, center.y, (zFar + zBack) / 2);
    b.world.statics.addGeometry(floor, Mat.Paint);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const x = c.getContext('2d')!;
    x.fillStyle = '#3a4a6a';
    x.fillRect(0, 0, 256, 256);
    for (let l = 0; l < lanes; l++) {
      x.fillStyle = l % 2 ? '#40527a' : '#36466a';
      x.fillRect((l * 256) / lanes, 0, 256 / lanes, 256);
    }
    x.fillStyle = 'rgba(255,255,255,0.28)';
    for (let l = 0; l < lanes; l++) {
      x.beginPath();
      const cx = ((l + 0.5) * 256) / lanes;
      x.moveTo(cx - 16, 150);
      x.lineTo(cx, 110);
      x.lineTo(cx + 16, 150);
      x.lineTo(cx + 16, 170);
      x.lineTo(cx, 130);
      x.lineTo(cx - 16, 170);
      x.closePath();
      x.fill();
    }
    x.fillStyle = 'rgba(0,0,0,0.3)';
    x.fillRect(0, 0, 256, 5);
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.repeat.set(1, L / 8);
    tx.anisotropy = 8;
    const fm = new THREE.Mesh(floor, new THREE.MeshStandardMaterial({ map: tx, roughness: 0.55 }));
    fm.receiveShadow = true;
    b.group.add(fm);
    b.animators.push((t) => {
      tx.offset.y = run(t - state.go) / 8;
    });
    const under = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 1.6, L).translate(center.x, center.y - 0.82, (zFar + zBack) / 2), new THREE.MeshStandardMaterial({ color: 0xffc21f, roughness: 0.4 }));
    b.group.add(under);
    for (const e of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.8, 2.4, L + 1).translate(center.x + e * (W / 2 + 0.4), center.y + 1.2, (zFar + zBack) / 2);
      b.world.statics.addGeometry(g, Mat.Paint);
      const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: e < 0 ? 0xff4f6a : 0x2fa8ff, roughness: 0.35, clearcoat: 0.8 }));
      m.castShadow = m.receiveShadow = true;
      b.group.add(m);
    }
    const end = new THREE.BoxGeometry(W + 1.6, 7, 1).translate(center.x, center.y + 3.5, zFar - 0.5);
    b.world.statics.addGeometry(end, Mat.Paint);
    const em = new THREE.Mesh(end, new THREE.MeshPhysicalMaterial({ color: 0x9a5bff, roughness: 0.35, clearcoat: 0.7 }));
    em.castShadow = true;
    b.group.add(em);
    // the black mouth the blocks come out of, a hazard stripe along the back edge
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.2).translate(center.x, center.y + 1.1, zFar + 0.02), new THREE.MeshBasicMaterial({ color: 0x0a0a14 }));
    b.group.add(mouth);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.4).rotateX(-Math.PI / 2).translate(center.x, center.y + 0.02, zBack - 0.7), glowMat(0xff4030, 1.4));
    b.group.add(stripe);
  }
  // the blocks: a kin for each lane of each slot; low ones are sunk into the belt to hop height
  const pal = [0xff4f6a, 0xffc21f, 0x37c25a, 0x2fa8ff, 0xff8a1f, 0x9a5bff];
  const hy = tall;
  for (let j = 0; j < K; j++)
    for (let l = 0; l < lanes; l++) {
      const px = laneX(l);
      const kin = new Kin({ type: 'box', hx: lane / 2 - 0.1, hy, hz: 1.2 }, Mat.Paint, (t, pos, quat) => {
        const s = run(t - state.go);
        const n = slotRow(j, s);
        const k = n < 0 ? 0 : kindsOf(n)[l];
        if (!k) pos.set(px, center.y - 60, zFar + 2);
        else pos.set(px, center.y + (k === 1 ? low - hy : hy), rowZ(n, s));
        quat.identity();
      });
      b.world.addKin(kin);
    }
  const blockM = new THREE.MeshPhysicalMaterial({ roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(lane - 0.2, hy * 2, 2.4, 1, 1, 1), blockM, K * lanes);
  blocks.frustumCulled = false;
  blocks.castShadow = blocks.receiveShadow = true;
  for (let i = 0; i < K * lanes; i++) blocks.setColorAt(i, CL.set(0xffffff));
  b.group.add(blocks);
  // (a stud on each block's face, so they read as toys)
  const studs = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.2, 18), blockM, K * lanes * 2);
  studs.frustumCulled = false;
  studs.castShadow = true;
  for (let i = 0; i < K * lanes * 2; i++) studs.setColorAt(i, CL.set(0xffffff));
  b.group.add(studs);
  b.animators.push((t) => {
    const s = run(t - state.go);
    let i = 0;
    for (let j = 0; j < K; j++) {
      const n = slotRow(j, s);
      for (let l = 0; l < lanes; l++, i++) {
        const k = n < 0 ? 0 : kindsOf(n)[l];
        if (!k) {
          blocks.setMatrixAt(i, M.compose(V.set(0, -500, 0), Q.identity(), S));
          for (const q of [0, 1]) studs.setMatrixAt(i * 2 + q, M);
          continue;
        }
        const z = rowZ(n, s), y = center.y + (k === 1 ? low - hy : hy);
        blocks.setMatrixAt(i, M.compose(V.set(laneX(l), y, z), Q.identity(), S));
        CL.set(pal[Math.floor(hash(n, l) * pal.length) % pal.length]);
        blocks.setColorAt(i, CL);
        for (const q of [0, 1]) {
          studs.setMatrixAt(i * 2 + q, M.compose(V.set(laneX(l), y + hy + 0.08, z + (q ? 0.6 : -0.6)), Q, S));
          studs.setColorAt(i * 2 + q, CL);
        }
      }
    }
    blocks.instanceMatrix.needsUpdate = studs.instanceMatrix.needsUpdate = true;
    blocks.instanceColor!.needsUpdate = studs.instanceColor!.needsUpdate = true;
  });
  // the row coming next, shown in lamps over the mouth: green is clear, amber you hop, red you can't
  {
    const lanesM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, toneMapped: false, depthWrite: false });
    const strip = new THREE.InstancedMesh(new THREE.PlaneGeometry(lane - 0.7, 1.3), lanesM, lanes);
    strip.frustumCulled = false;
    for (let l = 0; l < lanes; l++) {
      strip.setMatrixAt(l, M.compose(V.set(laneX(l), center.y + 3.3, zFar + 0.03), Q.identity(), S));
      strip.setColorAt(l, CL.set(0xffffff));
    }
    b.group.add(strip);
    // bulbs racing down both walls, as fast as the belt runs
    const nB = 20;
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), nB * 2);
    bulbs.frustumCulled = false;
    b.group.add(bulbs);
    // the roller at the back edge, turning
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, W, 20, 1).rotateZ(Math.PI / 2).translate(0, 0, 0), new THREE.MeshPhysicalMaterial({ map: stripes(), roughness: 0.35, clearcoat: 0.6 }));
    roller.position.set(center.x, center.y - 0.62, zBack + 0.1);
    b.group.add(roller);
    b.animators.push((t) => {
      const x = t - state.go;
      const s = run(x);
      const n = Math.floor(s / D) + 1;
      const kk = kindsOf(n);
      for (let l = 0; l < lanes; l++) strip.setColorAt(l, CL.set(kk[l] === 0 ? 0x30f070 : kk[l] === 1 ? 0xffc21f : 0xff4040));
      strip.instanceColor!.needsUpdate = true;
      const gap = L / nB;
      for (let i = 0; i < nB; i++) {
        const z = zFar + ((((i * gap + s) % L) + L) % L);
        for (const e of [0, 1]) {
          bulbs.setMatrixAt(i * 2 + e, M.compose(V.set(center.x + (e ? 1 : -1) * (W / 2 - 0.02), center.y + 2.05, z), Q.identity(), S));
          bulbs.setColorAt(i * 2 + e, CL.set(pal[(i + (e ? 3 : 0)) % pal.length]).multiplyScalar(1.6));
        }
      }
      bulbs.instanceMatrix.needsUpdate = true;
      bulbs.instanceColor!.needsUpdate = true;
      roller.rotation.x = s / 0.62;
    });
  }
  // the belt carries whoever is standing on it (toward the back edge)
  b.world.fields.push({
    min: new THREE.Vector3(center.x - W / 2 - 1, center.y - 1, zFar - 1),
    max: new THREE.Vector3(center.x + W / 2 + 1, center.y + 1.6, zBack),
    act: (m, t, dt) => {
      if (m.groundT < 0.08) m.pos.z += speed(t - state.go) * dt;
    },
  });
  title(b, info, 'Survival · Stay on the belt', 0x2fa8ff, new THREE.Vector3(center.x, center.y + 10, zFar - 2));
  dressArena(b, new THREE.Vector3(center.x, center.y - 2, center.z), far + 8, 43);
  b.finish();
  const arena: BeltArena = {
    center,
    lane,
    run,
    speed,
    laneX,
    rows(x, out) {
      out.length = 0;
      const s = run(x);
      for (let j = 0; j < K; j++) {
        const n = slotRow(j, s);
        if (n >= 0) out.push({ n, z: rowZ(n, s), kinds: kindsOf(n) });
      }
      out.sort((p, q) => q.z - p.z);
      return out;
    },
  };
  return {
    id: 'beltrush',
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
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const row = Math.floor(k / 6), col = k % 6;
        const p = new THREE.Vector3(center.x - W / 2 + 1.5 + col * ((W - 3) / 5), center.y + 0.55, center.z + 1 + row * 2.6);
        out.push({ pos: p, yaw: Math.PI });
      }
      return out;
    },
    // (the plate's centre is far up the belt: the camera always looks up it, at what's coming)
    plate: { center: new THREE.Vector3(center.x, center.y, zFar - 34), radius: L, bars: [] },
    belt: arena,
    intro: [],
  };
}
