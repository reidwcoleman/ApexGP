import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Mat } from './physics.ts';
import { dressArena } from './course-dress.ts';
import type { Course } from './courses.ts';
import { addStrikes, type Hit3, type Strikes } from './course-strikes.ts';

/**
 * Cookie Crumble: four floors of round cookie tiles stacked in the sky, each a little wider than
 * the one above. Step on a tile and it shakes, flashes and drops a moment later; so keep moving,
 * and when your floor runs out you land on the next one down. Fall past the bottom floor and you
 * are out: the last ones standing go through. Who touched which tile is decided by the host (or
 * solo, this browser) and sent to everyone as the time it drops.
 */

export const CRUMBLE = {
  /** seconds from a touch to the drop */
  delay: 0.55,
  layers: 6,
  gap: 6.5,
  r0: 18,
  dr: 1.7,
  /** tile radius and spacing (hex-packed) */
  tile: 0.98,
  sp: 2.06,
  hh: 0.3,
};

const UND: number[] = [];
/** Meltdown: the floe's melt (m/s in from the edge, down to minR) and a hole every `hole` s */
export const MELT = { r0: 15, rate: 0.2, minR: 3.2, hole: 1, grip: 0.6 };
/** a spring cookie: one tile in this many, and how hard it throws you (enough to reach the floor above) */
export const SPRING = { every: 16, up: 18.6 };

export interface CrumbleTile {
  x: number;
  y: number;
  z: number;
  L: number;
}

export class CrumbleArena {
  readonly tiles: CrumbleTile[] = [];
  /** world time each tile drops (Infinity: not touched yet) */
  readonly drop: Float64Array;
  /** per layer: its top's height, radius, and its tiles' index range */
  readonly layers: { top: number; r: number; i0: number; i1: number }[] = [];
  /** newly touched since the last call to `fresh` (the host sends these) */
  private news: number[] = [];
  /** 'step': a tile goes when stood on (Cookie Crumble); 'melt': the floe melts in from the edge
   * and holes open in it, and standing is fine (Meltdown) */
  readonly mode: 'step' | 'melt';
  /** Meltdown: how far out the floe still reaches */
  rNow = Infinity;
  /** the spring cookies (not on the top floor: there's nowhere up to go) */
  readonly springs = new Set<number>();
  /** Meltdown's snowballs */
  shots: Strikes | null = null;
  /** the camera's floor: the floors above it fade away so they don't block the view (set by the builder) */
  view: (L: number, dt: number) => void = () => undefined;
  private holeK = 0;
  constructor(
    readonly center: THREE.Vector3,
    o: { layers?: number; gap?: number; r0?: number; dr?: number; mode?: 'step' | 'melt' } = {},
  ) {
    const C = { ...CRUMBLE, ...o };
    this.mode = o.mode ?? 'step';
    const rowH = (C.sp * Math.sqrt(3)) / 2;
    for (let L = 0; L < C.layers; L++) {
      const y = center.y - L * C.gap;
      const r = C.r0 + L * C.dr;
      const i0 = this.tiles.length;
      const nj = Math.ceil(r / rowH) + 1;
      for (let j = -nj; j <= nj; j++) {
        const ni = Math.ceil(r / C.sp) + 1;
        for (let i = -ni; i <= ni; i++) {
          const x = i * C.sp + (Math.abs(j) % 2 ? C.sp / 2 : 0);
          const z = j * rowH;
          if (Math.hypot(x, z) > r - C.tile * 0.4) continue;
          this.tiles.push({ x: center.x + x, y, z: center.z + z, L });
        }
      }
      this.layers.push({ top: y + C.hh, r, i0, i1: this.tiles.length });
    }
    this.drop = new Float64Array(this.tiles.length).fill(Infinity);
    if (this.mode === 'step') this.tiles.forEach((t, i) => t.L > 0 && Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1 < 1 / SPRING.every && this.springs.add(i));
    this.tiles.forEach((t, i) => {
      const k = this.key(Math.floor(t.x / CRUMBLE.sp), Math.floor(t.z / CRUMBLE.sp));
      let a = this.cells.get(k);
      if (!a) this.cells.set(k, (a = []));
      a.push(i);
    });
  }
  /** the tiles by area (every layer in one grid) */
  private cells = new Map<number, number[]>();
  private key(ix: number, iz: number) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }
  /** the tiles (any layer) in the cells within `rad` of x, z */
  around(x: number, z: number, rad: number, out: number[]) {
    const sp = CRUMBLE.sp;
    const n = Math.ceil(rad / sp);
    const cx = Math.floor(x / sp), cz = Math.floor(z / sp);
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++) {
        const a = this.cells.get(this.key(cx + i, cz + j));
        if (a) for (const k of a) out.push(k);
      }
    return out;
  }
  /** the tile under a bean's feet (its feet sphere's centre), or -1 */
  under(p: THREE.Vector3) {
    const feet = p.y - 0.5;
    let best = -1, bd = CRUMBLE.tile + 0.15;
    UND.length = 0;
    for (const i of this.around(p.x, p.z, 1, UND)) {
      const t = this.tiles[i];
      const dy = feet - (t.y + CRUMBLE.hh);
      if (dy < -0.3 || dy > 0.45) continue;
      const d = Math.hypot(p.x - t.x, p.z - t.z);
      if (d < bd) (bd = d), (best = i);
    }
    return best;
  }
  /** still there (not shaking or gone) at t */
  intact(i: number) {
    return this.drop[i] === Infinity;
  }
  /** solid at t (shaking still counts) */
  solid(i: number, t: number) {
    return t < this.drop[i];
  }
  /** a touch at t: the tile drops after the delay (only the first touch counts) */
  touch(i: number, t: number) {
    if (i < 0 || this.drop[i] !== Infinity) return false;
    this.drop[i] = t + CRUMBLE.delay;
    this.news.push(i);
    return true;
  }
  /** someone else's word (the host's): this one drops at `at` */
  set(i: number, at: number) {
    if (i >= 0 && i < this.drop.length && at < this.drop[i]) this.drop[i] = at;
  }
  /** Meltdown, at t (the same on every screen): the edge melts in, and a hole opens every so often */
  meltTick(t: number, go: number) {
    const ly = this.layers[0];
    const R0 = ly.r;
    this.rNow = t < go + 4 ? R0 : Math.max(MELT.minR, R0 - (t - go - 4) * MELT.rate);
    for (let i = ly.i0; i < ly.i1; i++) {
      if (this.drop[i] !== Infinity) continue;
      const tl = this.tiles[i];
      if (Math.hypot(tl.x - this.center.x, tl.z - this.center.z) > this.rNow) this.touch(i, t);
    }
    // the holes: a tile and its two nearest, picked by a hash of the count (the same everywhere)
    while (t > go + 6 + this.holeK * MELT.hole) {
      const k = this.holeK++;
      const h = Math.abs(Math.sin(k * 12.9898 + 4.1) * 43758.5453) % 1;
      const i = ly.i0 + Math.floor(h * (ly.i1 - ly.i0));
      const tl = this.tiles[i];
      // (never the very middle: there has to be somewhere to stand at the end)
      if (Math.hypot(tl.x - this.center.x, tl.z - this.center.z) < MELT.minR) continue;
      const near: number[] = [];
      this.around(tl.x, tl.z, CRUMBLE.sp * 1.2, near);
      near.sort((a, b) => Math.hypot(this.tiles[a].x - tl.x, this.tiles[a].z - tl.z) - Math.hypot(this.tiles[b].x - tl.x, this.tiles[b].z - tl.z));
      for (const j of near.slice(0, 3)) if (this.tiles[j].L === 0) this.touch(j, Math.max(t, go + 6 + k * MELT.hole));
    }
  }
  fresh() {
    const n = this.news;
    this.news = [];
    return n;
  }
  /** the layer a height is at or above (the one a bean stands on, or will land on) */
  layerAt(y: number) {
    for (let L = 0; L < this.layers.length; L++) if (y > this.layers[L].top - 1) return L;
    return -1;
  }
  /** how many tiles are left on a layer */
  left(L: number) {
    let n = 0;
    const ly = this.layers[L];
    for (let i = ly.i0; i < ly.i1; i++) if (this.drop[i] === Infinity) n++;
    return n;
  }
}

/** a cookie: a fat rounded disc, a domed top of icing with a darker rim of baked dough */
function cookieGeo(side = 0xf0c088) {
  const C = CRUMBLE;
  const R = C.tile, h = C.hh;
  const pts: [number, number][] = [[0, -h], [R * 0.9, -h], [R, -h * 0.55], [R, h * 0.35], [R * 0.93, h * 0.85], [R * 0.82, h], [R * 0.4, h * 1.12], [0, h * 1.15]];
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(0.001, x), y)), 18);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    // (the icing on top takes the tile's colour; the dough round the side stays warm)
    if (p.getY(i) > h * 0.8) c.setRGB(1, 1, 1);
    else c.set(side);
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function crumble(info: { name: string; blurb: string }, kind: 'cookie' | 'melt' = 'cookie'): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 140, 0);
  const melt = kind === 'melt';
  const A = melt ? new CrumbleArena(center, { layers: 1, r0: MELT.r0, mode: 'melt' }) : new CrumbleArena(center);
  const C = { ...CRUMBLE, layers: A.layers.length, r0: A.layers[0].r };
  const bottom = center.y - (C.layers - 1) * C.gap;
  b.lakeY = bottom - 34;
  const state = { go: 1e9 };
  // the tiles: a collider each (still until it drops, then falling and gone), drawn per layer
  const G = 20;
  const pos = (i: number, t: number, out: THREE.Vector3) => {
    const tl = A.tiles[i];
    const d = t - A.drop[i];
    out.set(tl.x, tl.y, tl.z);
    if (d > 0) out.y -= d > 1.5 ? 400 : 0.5 * G * d * d;
    return out;
  };
  // (the tiles are pads: fixed until they drop, and then not there at all)
  b.world.pads = {
    shape: { type: 'cyl', r: C.tile, hh: C.hh },
    bound: Math.hypot(C.tile, C.hh),
    mat: Mat.Felt,
    near: (x, z, out) => void A.around(x, z, 1, out),
    at: (i, o) => o.set(A.tiles[i].x, A.tiles[i].y, A.tiles[i].z),
    on: (i, t) => t < A.drop[i],
  };
  const LAYER_C = melt ? [0xe8f6ff] : [0xff9cc8, 0xffc070, 0xc8a0ff, 0x8ae0c8, 0xfff08a, 0x9ad0ff];
  const geo = cookieGeo(melt ? 0x9fd6f2 : 0xf0c088);
  const meshes = A.layers.map((ly, L) => {
    const m = new THREE.InstancedMesh(geo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color(0xffffff) }), ly.i1 - ly.i0);
    m.castShadow = m.receiveShadow = true;
    m.frustumCulled = false;
    b.group.add(m);
    return m;
  });
  // the floors above the one the camera is watching fade out (they'd only show their undersides)
  const alpha = A.layers.map(() => 1);
  A.view = (Lv, dt) => {
    meshes.forEach((m, L) => {
      const want = L < Lv ? 0 : 1;
      const a = (alpha[L] += (want - alpha[L]) * Math.min(1, dt * 7));
      const mat = m.material as THREE.MeshPhysicalMaterial;
      const solid = a > 0.985;
      if (mat.transparent === solid) {
        mat.transparent = !solid;
        mat.depthWrite = solid;
        mat.needsUpdate = true;
      }
      mat.opacity = solid ? 1 : a;
      m.visible = a > 0.02;
      m.castShadow = a > 0.5;
    });
  };
  const base = A.layers.map((_, L) => new THREE.Color(LAYER_C[L % LAYER_C.length]));
  const springC = new THREE.Color(0x30ff90);
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), Z = new THREE.Vector3(0, 0, 0);
  const hot = new THREE.Color(0xff3a4a), white = new THREE.Color(0xffffff), col = new THREE.Color();
  const shown = new Uint8Array(A.tiles.length);
  const draw = (t: number, all: boolean) => {
    A.layers.forEach((ly, L) => {
      const m = meshes[L];
      let dirty = false;
      for (let i = ly.i0; i < ly.i1; i++) {
        const d = t - A.drop[i];
        const k = i - ly.i0;
        if (!all && A.drop[i] === Infinity) continue;
        if (d > 1.5) {
          if (shown[i] !== 2) {
            m.setMatrixAt(k, M.compose(V.set(0, -1000, 0), Q.identity(), Z));
            shown[i] = 2;
            dirty = true;
          }
          continue;
        }
        pos(i, t, V);
        if (d < 0 && A.drop[i] !== Infinity) {
          // the warning: a shiver, a flash, then red
          const w = 1 + d / C.delay;
          V.x += Math.sin(t * 61 + i) * 0.05 * w;
          V.z += Math.cos(t * 53 + i) * 0.05 * w;
          col.copy(base[L]).lerp(w < 0.5 ? white : hot, w < 0.5 ? Math.abs(Math.sin(t * 30)) * 0.8 : 0.85);
          m.setColorAt(k, col);
        } else if (d >= 0) {
          Q.setFromEuler(new THREE.Euler(d * (1.5 + (i % 3)), 0, d * (1 + (i % 2))));
          m.setColorAt(k, col.copy(base[L]).lerp(hot, 0.6));
        } else m.setColorAt(k, A.springs.has(i) ? springC : base[L]);
        m.setMatrixAt(k, M.compose(V, d >= 0 ? Q : Q.identity(), S));
        Q.identity();
        dirty = true;
      }
      if (dirty) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    });
  };
  draw(0, true);
  b.animators.push((t) => draw(t, false));
  // Meltdown: the floe is slippery, and snowballs come over from the shore
  if (melt) {
    const R = MELT.r0 + 2;
    const box: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(center.x - R, center.y - 2, center.z - R), new THREE.Vector3(center.x + R, center.y + 5, center.z + R)];
    b.world.fields.push({ min: box[0], max: box[1], grip: MELT.grip });
    let sd = 58211;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 8; k++) rnd();
    const list: Hit3[] = [];
    for (let t = 7; t < 120; t += Math.max(1.1, 3 - t * 0.03) * (0.8 + rnd() * 0.4)) {
      const a = rnd() * Math.PI * 2, r = Math.max(MELT.minR, (MELT.r0 - 2 - t * MELT.rate * 0.8)) * Math.sqrt(rnd());
      list.push({ t, x: center.x + Math.cos(a) * r, y: center.y + C.hh, z: center.z + Math.sin(a) * r, r: 2 });
    }
    A.shots = addStrikes(b, { list, warn: 1.5, state, ring: 0x60c8ff, ball: { color: 0xf4fbff, r: 0.8 }, box, out: 8, up: 6 });
  }
  dressArena(b, new THREE.Vector3(center.x, center.y - 2, center.z), C.r0 + (C.layers - 1) * C.dr + 6, 9);
  b.finish();
  // a rough cut for the bots' and the camera's sake
  const plate = { center, radius: C.r0 + (C.layers - 1) * C.dr, bars: [] };
  return {
    id: melt ? 'meltdown' : 'crumble',
    name: info.name,
    kind: 'survival',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: bottom - 6,
    lakeY: b.lakeY,
    state,
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const ring = k < 6 ? 4.5 : k < 14 ? 9 : 13.5;
        const inRing = k < 6 ? 6 : k < 14 ? 8 : Math.max(1, n - 14);
        const kk = k < 6 ? k : k < 14 ? k - 6 : k - 14;
        const a = (kk / inRing) * Math.PI * 2 + ring;
        const p = new THREE.Vector3(center.x + Math.cos(a) * ring, center.y + C.hh + 0.55, center.z + Math.sin(a) * ring);
        out.push({ pos: p, yaw: Math.atan2(center.x - p.x, center.z - p.z) });
      }
      return out;
    },
    plate,
    crumble: A,
    intro: [],
  };
}
