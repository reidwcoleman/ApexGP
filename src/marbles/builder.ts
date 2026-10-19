import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Kin, Mat, World, RADIUS, type Shape } from './physics.ts';
import { paintMaterial, Pattern, SPECIES, woodAttr, woodMaterial, type PaintSpec, type WoodSpecies } from './shaders.ts';

/**
 * Builds a course: a path laid down like a turtle (straights and arcs, each with its slope, width,
 * walls and banking, all eased so the chute bends smoothly), swept into a bent-plank chute — maple
 * boards running along the floor and curving up the walls on fillets, walnut rails, a solid
 * underside, cut ends where there's a gap to jump — on wooden trestles down into the paint lake.
 * The same triangles are the physics. Obstacles are painted wood on analytic colliders.
 */

export interface Sect {
  /** floor width between the walls (m) */
  w: number;
  /** wall height left / right (0: an open edge) */
  wallL: number;
  wallR: number;
  /** banking (rad, + lifts the left side: for a right-hand turn) */
  bank: number;
  floor: boolean;
  /** false: the walls and fillets stay but the flat of the floor is left out (a roller bed fills it) */
  deck: boolean;
}

export interface Cmd {
  len: number;
  /** total heading change (deg, + turns right) */
  turn?: number;
  /** slope (deg, + downhill) */
  slope?: number;
  w?: number;
  wall?: number;
  wallL?: number;
  wallR?: number;
  /** bank (deg); default: from the turn */
  bank?: number;
  floor?: boolean;
  /** false: no flat floor between the fillets (rollers or a machine bed go there) */
  deck?: boolean;
  /** metres over which the width eases to its new value */
  easeW?: number;
  /** metres over which the slope eases to its new value (default 5; small: a sharp step down) */
  easeS?: number;
  /** metres over which the turn rate eases (default 3) */
  easeT?: number;
  /** a tag at this command's start (obstacles are placed from them) */
  tag?: string;
}

const DS = 0.25;

export class Path {
  readonly P: THREE.Vector3[] = [];
  readonly T: THREE.Vector3[] = [];
  readonly U: THREE.Vector3[] = [];
  readonly Rt: THREE.Vector3[] = [];
  readonly sec: Sect[] = [];
  readonly tags = new Map<string, [number, number]>();
  length = 0;

  constructor(start: THREE.Vector3, heading: number, cmds: Cmd[]) {
    const p = start.clone();
    let h = heading;
    let slope = THREE.MathUtils.degToRad(cmds[0].slope ?? 0);
    let rate = 0;
    let bank = 0;
    let w = cmds[0].w ?? 10;
    let wl = cmds[0].wallL ?? cmds[0].wall ?? 1.4;
    let wr = cmds[0].wallR ?? cmds[0].wall ?? 1.4;
    let s = 0;
    let last: Required<Pick<Cmd, 'w'>> & { wl: number; wr: number } = { w, wl, wr };
    for (const c of cmds) {
      const s0 = s;
      const tSlope = THREE.MathUtils.degToRad(c.slope ?? 0);
      const tRate = -THREE.MathUtils.degToRad(c.turn ?? 0) / c.len;
      const tW = c.w ?? last.w;
      const tWl = c.wallL ?? c.wall ?? last.wl;
      const tWr = c.wallR ?? c.wall ?? last.wr;
      last = { w: tW, wl: tWl, wr: tWr };
      const autoBank = THREE.MathUtils.clamp(-tRate * 14, -0.42, 0.42);
      const tBank = c.bank !== undefined ? THREE.MathUtils.degToRad(c.bank) : autoBank;
      const easeW = c.easeW ?? 3, easeS = c.easeS ?? 5, easeT = c.easeT ?? 3;
      const n = Math.max(1, Math.round(c.len / DS));
      for (let i = 0; i < n; i++) {
        slope += (tSlope - slope) * Math.min(1, DS / easeS);
        rate += (tRate - rate) * Math.min(1, DS / easeT);
        bank += (tBank - bank) * Math.min(1, DS / 5);
        w += (tW - w) * Math.min(1, DS / easeW);
        wl += (tWl - wl) * Math.min(1, DS / 1.5);
        wr += (tWr - wr) * Math.min(1, DS / 1.5);
        this.push(p, h, slope, bank, { w, wallL: wl, wallR: wr, bank, floor: c.floor !== false, deck: c.deck !== false });
        h += rate * DS;
        p.x += Math.sin(h) * Math.cos(slope) * DS;
        p.z += Math.cos(h) * Math.cos(slope) * DS;
        p.y -= Math.sin(slope) * DS;
        s += DS;
      }
      if (c.tag) this.tags.set(c.tag, [s0, s]);
    }
    const lastSec = this.sec[this.sec.length - 1];
    this.push(p, h, slope, bank, { ...lastSec });
    this.length = (this.P.length - 1) * DS;
  }

  private push(p: THREE.Vector3, h: number, slope: number, bank: number, sec: Sect) {
    const t = new THREE.Vector3(Math.sin(h) * Math.cos(slope), -Math.sin(slope), Math.cos(h) * Math.cos(slope));
    const r = new THREE.Vector3().crossVectors(t, UP).normalize();
    const u = new THREE.Vector3().crossVectors(r, t).normalize();
    // bank: + lifts the left side (rotate about the tangent)
    if (bank !== 0) {
      const q = new THREE.Quaternion().setFromAxisAngle(t, bank);
      r.applyQuaternion(q);
      u.applyQuaternion(q);
    }
    this.P.push(p.clone());
    this.T.push(t);
    this.U.push(u);
    this.Rt.push(r);
    this.sec.push(sec);
  }

  get count() {
    return this.P.length;
  }

  /**
   * A lane alongside another path between s0 and s1, `lat` m right of its centre line, sharing its
   * frames (so it bends and banks with it): the two sides of a split. `sect` shapes it along the way.
   */
  static lane(main: Path, s0: number, s1: number, lat: (s: number) => number, sect: (s: number) => Partial<Sect>) {
    const p = new Path(main.P[0].clone(), 0, [{ len: DS }]);
    for (const a of [p.P, p.T, p.U, p.Rt, p.sec]) a.length = 0;
    const i0 = main.index(s0), i1 = main.index(s1);
    for (let i = i0; i <= i1; i++) {
      const s = i * DS;
      const l = lat(s);
      // (a lane that moves sideways leans its tangent with it)
      const dl = (lat(s + DS) - lat(s - DS)) / (2 * DS);
      const T = main.T[i].clone().addScaledVector(main.Rt[i], dl).normalize();
      const Rt = new THREE.Vector3().crossVectors(T, main.U[i]).normalize();
      p.P.push(main.P[i].clone().addScaledVector(main.Rt[i], l));
      p.T.push(T);
      p.U.push(main.U[i].clone());
      p.Rt.push(Rt);
      p.sec.push({ w: 4, wallL: 1, wallR: 1, bank: main.sec[i].bank, floor: true, deck: true, ...sect(s) });
    }
    p.length = (p.P.length - 1) * DS;
    return p;
  }
  index(s: number) {
    return THREE.MathUtils.clamp(Math.round(s / DS), 0, this.P.length - 1);
  }
  /** the point at s, `lat` m right of the centre, `up` above the floor */
  at(s: number, lat: number, up: number, out = new THREE.Vector3()) {
    const i = this.index(s);
    return out.copy(this.P[i]).addScaledVector(this.Rt[i], lat).addScaledVector(this.U[i], up);
  }
  /** nearest sample to p, searched around `hint` (helices stack: a local search keeps to the right loop) */
  project(p: THREE.Vector3, hint: number, span = 60): { i: number; s: number; lat: number; h: number; d: number } {
    let best = hint, bd = Infinity;
    const lo = Math.max(0, hint - span), hi = Math.min(this.P.length - 1, hint + span);
    for (let i = lo; i <= hi; i++) {
      const d = this.P[i].distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const P = this.P[best];
    const dx = p.x - P.x, dy = p.y - P.y, dz = p.z - P.z;
    const r = this.Rt[best], u = this.U[best], t = this.T[best];
    return { i: best, s: best * DS + (dx * t.x + dy * t.y + dz * t.z), lat: dx * r.x + dy * r.y + dz * r.z, h: dx * u.x + dy * u.y + dz * u.z, d: Math.sqrt(bd) };
  }
  /** a global search (a respawn, a spawn) */
  projectAll(p: THREE.Vector3) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.P.length; i += 2) {
      const d = this.P[i].distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return this.project(p, best, 4);
  }
}
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Collects meshes by material and by where they are (cells of CELL m), then merges each lot: a few
 * draw calls, and the parts of a long course out of view (or out of the sun's shadow box) are culled.
 */
const CELL = 64;
class Batch {
  readonly parts = new Map<THREE.Material, Map<string, THREE.BufferGeometry[]>>();
  add(m: THREE.Material, g: THREE.BufferGeometry) {
    let cells = this.parts.get(m);
    if (!cells) this.parts.set(m, (cells = new Map()));
    // (its cell: where its first and last vertices are, which is near enough)
    const p = g.getAttribute('position');
    const x = (p.getX(0) + p.getX(p.count - 1)) / 2, z = (p.getZ(0) + p.getZ(p.count - 1)) / 2;
    const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let l = cells.get(k);
    if (!l) cells.set(k, (l = []));
    l.push(g);
  }
  flush(group: THREE.Group, cast = true) {
    for (const [m, cells] of this.parts) {
      for (const gs of cells.values()) {
        const merged = mergeAll(gs);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, m);
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    }
    this.parts.clear();
  }
}

/**
 * Merges geometries that may differ in attributes and indexing: keeps position, normal and aWood
 * (filling what's missing) and indexes the unindexed ones (cheaper than un-indexing the rest).
 */
export function mergeAll(gs: THREE.BufferGeometry[]) {
  if (!gs.length) return null;
  for (const g of gs) {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'aWood') g.deleteAttribute(k);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    if (!g.getAttribute('aWood')) g.setAttribute('aWood', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    if (!g.index) {
      const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
      for (let i = 0; i < n; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
  }
  return mergeGeometries(gs, false);
}

export interface Obstacle {
  kin: Kin;
  vis: THREE.Object3D;
}

export class CourseBuilder {
  readonly group = new THREE.Group();
  readonly world = new World();
  readonly obstacles: Obstacle[] = [];
  /** shapes the AI steers round */
  readonly hazards: Kin[] = [];
  /** the forks (path s range, and the laterals of the shortcut and the safe way) for the AI */
  readonly splits: { s0: number; s1: number; fast: number; safe: number }[] = [];
  readonly batch = new Batch();
  readonly floorWood = woodMaterial(SPECIES.maple, 0.75);
  readonly railWood = woodMaterial(SPECIES.walnut, 0.8);
  readonly postWood = woodMaterial(SPECIES.pine, 0.2);
  readonly darkWood = woodMaterial(SPECIES.cherry, 0.8);
  /** the hardware: brass bolts and caps, blued steel axles and chains */
  readonly brass = new THREE.MeshPhysicalMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.2 });
  readonly steel = new THREE.MeshPhysicalMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.38 });
  /** AI-only hazards (not in the world): places not to be at a time — beside a moving bridge, between two lanes */
  readonly ghosts: Kin[] = [];
  /** called every frame with the physics time (instanced parts, signs that turn) */
  readonly animators: ((t: number) => void)[] = [];
  private paints = new Map<string, THREE.MeshPhysicalMaterial>();

  paint(p: PaintSpec, wood?: WoodSpecies) {
    const k = JSON.stringify(p);
    let m = this.paints.get(k);
    if (!m) this.paints.set(k, (m = paintMaterial(p, wood)));
    return m;
  }

  /** the chute along a path */
  chute(path: Path, opts: { floorMat?: THREE.Material; railMat?: THREE.Material; trestles?: boolean } = {}) {
    const floorMat = opts.floorMat ?? this.floorWood;
    const railMat = opts.railMat ?? this.railWood;
    const RAIL = 0.32, DEPTH = 0.42, ARC = 5;
    const n = path.count;
    // the profile at a sample: strips of (x, y, nx, ny, u)
    type Pt = [number, number, number, number, number];
    const profile = (sec: Sect): Pt[][] => {
      const hw = sec.w / 2;
      const fl = Math.min(0.85, sec.wallL), fr = Math.min(0.85, sec.wallR);
      const inner: Pt[] = [];
      // left wall top down, the fillet, the floor, the fillet, the right wall up
      inner.push([-hw, sec.wallL, 1, 0, 0]);
      for (let k = 0; k <= ARC; k++) {
        const a = Math.PI + (k / ARC) * (Math.PI / 2);
        // centre (-hw + fl, fl), from the wall (angle π) to the floor (3π/2)
        inner.push([-hw + fl + Math.cos(a) * fl, fl + Math.sin(a) * fl, -Math.cos(a), -Math.sin(a), 0]);
      }
      for (let k = 0; k <= ARC; k++) {
        const a = -Math.PI / 2 + (k / ARC) * (Math.PI / 2);
        inner.push([hw - fr + Math.cos(a) * fr, fr + Math.sin(a) * fr, -Math.cos(a), -Math.sin(a), 0]);
      }
      inner.push([hw, sec.wallR, -1, 0, 0]);
      // (normals of a collapsed fillet: the floor's)
      for (const q of inner) if (Math.abs(q[2]) + Math.abs(q[3]) < 0.5 || !isFinite(q[2])) [q[2], q[3]] = [0, 1];
      if (fl < 1e-3) for (let k = 1; k <= ARC + 1; k++) [inner[k][2], inner[k][3]] = [0, 1];
      if (fr < 1e-3) for (let k = ARC + 2; k <= 2 * ARC + 2; k++) [inner[k][2], inner[k][3]] = [0, 1];
      // arc length across: the boards' coordinate (0 at the centre line)
      let acc = 0;
      for (let k = 0; k < inner.length; k++) {
        if (k > 0) acc += Math.hypot(inner[k][0] - inner[k - 1][0], inner[k][1] - inner[k - 1][1]);
        inner[k][4] = acc;
      }
      const mid = acc / 2;
      for (const q of inner) q[4] -= mid;
      const topL: Pt[] = [[-hw - RAIL, sec.wallL, 0, 1, 10], [-hw, sec.wallL, 0, 1, 10 + RAIL]];
      const topR: Pt[] = [[hw, sec.wallR, 0, 1, 20], [hw + RAIL, sec.wallR, 0, 1, 20 + RAIL]];
      const outR: Pt[] = [[hw + RAIL, sec.wallR, 1, 0, 30], [hw + RAIL, -DEPTH, 1, 0, 30 + sec.wallR + DEPTH]];
      const bottom: Pt[] = [[hw + RAIL, -DEPTH, 0, -1, 40], [-hw - RAIL, -DEPTH, 0, -1, 40 + sec.w + 2 * RAIL]];
      const outL: Pt[] = [[-hw - RAIL, -DEPTH, -1, 0, 60], [-hw - RAIL, sec.wallL, -1, 0, 60 + sec.wallL + DEPTH]];
      return [inner, topL, topR, outR, bottom, outL];
    };
    // (eased sections settle to the same shape: share the profiles of identical ones)
    const cache = new Map<string, Pt[][]>();
    const profs = path.sec.map((sec) => {
      const key = `${sec.w.toFixed(3)},${sec.wallL.toFixed(3)},${sec.wallR.toFixed(3)}`;
      let pr = cache.get(key);
      if (!pr) cache.set(key, (pr = profile(sec)));
      return pr;
    });
    const mats = [floorMat, railMat, railMat, railMat, railMat, railMat];
    const collide = [true, true, true, true, false, true];
    // in pieces of CHUNK samples (each its own lot in the batch, so it culls)
    const CHUNK = 200;
    for (let c0 = 0; c0 < n - 1; c0 += CHUNK) {
      const c1 = Math.min(n - 1, c0 + CHUNK);
      for (let k = 0; k < 6; k++) {
        const pos: number[] = [], nor: number[] = [], wood: number[] = [], idx: number[] = [];
        const m = profs[0][k].length;
        for (let i = c0; i <= c1; i++) {
          const P = path.P[i], R = path.Rt[i], U = path.U[i];
          const s = i * DS;
          for (const q of profs[i][k]) {
            pos.push(P.x + R.x * q[0] + U.x * q[1], P.y + R.y * q[0] + U.y * q[1], P.z + R.z * q[0] + U.z * q[1]);
            nor.push(R.x * q[2] + U.x * q[3], R.y * q[2] + U.y * q[3], R.z * q[2] + U.z * q[3]);
            wood.push(s, q[4], k === 0 ? 0 : q[0] * 0.3);
          }
        }
        // quads between rings a and b (b > a: the collision skips every other ring)
        const quads = (out: number[], a0: number, b0: number) => {
          for (let i = a0; i < b0; i++) if (!path.sec[i].floor || !path.sec[i + 1].floor) return;
          let deck = true;
          for (let i = a0; i <= b0; i++) deck = deck && path.sec[i].deck;
          const ra = (a0 - c0) * m, rb = (b0 - c0) * m;
          for (let j = 0; j < m - 1; j++) {
            // (an open deck: the flat between the fillets left out)
            if (k === 0 && !deck && j === ARC + 1) continue;
            const a = ra + j, b = a + 1, c = rb + j, d = c + 1;
            out.push(a, b, c, b, d, c);
          }
        };
        for (let i = c0; i < c1; i++) quads(idx, i, i + 1);
        if (!idx.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('aWood', new THREE.Float32BufferAttribute(wood, 3));
        g.setIndex(idx);
        this.batch.add(mats[k], g);
        if (collide[k]) {
          // the physics takes every other ring (the chord error is millimetres), keeping each
          // ring where the floor starts or stops, or the slope or deck changes sharply
          const cidx: number[] = [];
          const keep = (i: number) => {
            if (i === c0 || i === c1 || (i - c0) % 2 === 0) return true;
            const a = path.sec[i - 1], b = path.sec[i], c = path.sec[i + 1];
            if (a.floor !== b.floor || b.floor !== c.floor || a.deck !== b.deck || b.deck !== c.deck) return true;
            return path.T[i - 1].dot(path.T[i + 1]) < 0.9995;
          };
          let prev = c0;
          for (let i = c0 + 1; i <= c1; i++) {
            if (!keep(i)) continue;
            quads(cidx, prev, i);
            prev = i;
          }
          this.world.statics.add(pos, cidx, Mat.Wood);
        }
      }
    }
    // the cut ends: the start, the finish, each side of a gap
    for (let i = 0; i < n; i++) {
      const on = path.sec[i].floor;
      const prev = i > 0 && path.sec[i - 1].floor, next = i < n - 1 && path.sec[i + 1].floor;
      if (!on || (prev && next)) continue;
      const dir = !prev ? -1 : 1;
      const pr = profs[i];
      const loop: THREE.Vector2[] = [];
      for (const q of pr[0]) loop.push(new THREE.Vector2(q[0], q[1]));
      loop.push(new THREE.Vector2(pr[2][1][0], pr[2][1][1]), new THREE.Vector2(pr[3][1][0], pr[3][1][1]), new THREE.Vector2(pr[5][0][0], pr[5][0][1]), new THREE.Vector2(pr[1][0][0], pr[1][0][1]));
      // (dedupe collapsed points: the triangulator dislikes them)
      const clean = loop.filter((v, k) => k === 0 || v.distanceTo(loop[k - 1]) > 1e-4);
      const tris = THREE.ShapeUtils.triangulateShape(clean, []);
      const P = path.P[i], R = path.Rt[i], U = path.U[i], Tn = path.T[i];
      const pos: number[] = [], nor: number[] = [], wood: number[] = [];
      for (const t of tris) {
        const order = dir > 0 ? [t[0], t[1], t[2]] : [t[0], t[2], t[1]];
        for (const v of order) {
          const q = clean[v];
          pos.push(P.x + R.x * q.x + U.x * q.y, P.y + R.y * q.x + U.y * q.y, P.z + R.z * q.x + U.z * q.y);
          nor.push(Tn.x * dir, Tn.y * dir, Tn.z * dir);
          wood.push(q.y * 3 + 50, q.x, i * DS * 0.01);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('aWood', new THREE.Float32BufferAttribute(wood, 3));
      // (winding by the normal, whichever way the triangulator went)
      fixWinding(g);
      this.batch.add(railMat, g);
      this.world.statics.addGeometry(g, Mat.Wood);
    }
    if (opts.trestles !== false) this.trestlePaths.push(path);
  }
  private trestlePaths: Path[] = [];

  /** the posts under the chute, down to the lake (none where another part of the course is below) */
  private trestles(path: Path) {
    const parts: THREE.BufferGeometry[] = [];
    const step = 13;
    for (let s = 4; s < path.length - 2; s += step) {
      const i = path.index(s);
      if (!path.sec[i].floor) continue;
      const P = path.P[i], R = path.Rt[i], Tn = path.T[i], U = path.U[i];
      const hw = path.sec[i].w / 2 + 0.16;
      const yaw = Math.atan2(Tn.x, Tn.z);
      const tops: THREE.Vector3[] = [];
      for (const side of [-1, 1]) tops.push(P.clone().addScaledVector(R, side * hw).addScaledVector(U, -0.5));
      // (something below: the post would go through it — the course, or a machine)
      const blocked = tops.some((t) => this.world.statics.floorBelow(t.x, t.y - 1.5, t.z, 400) > -Infinity || this.world.kins.some((k) => k.pos.y < t.y - 1 && Math.hypot(k.pos.x - t.x, k.pos.z - t.z) < k.bound + 0.6));
      if (blocked) continue;
      const bottom = this.lakeY - 2;
      for (const t of tops) {
        const len = t.y - bottom;
        if (len < 1) continue;
        const g = new THREE.BoxGeometry(0.36, len, 0.36);
        woodAttr(g, 'y', s * 0.1 + t.x);
        g.translate(t.x, bottom + len / 2, t.z);
        rotateAbout(g, yaw, t.x, t.z);
        parts.push(g);
      }
      // a cross beam under the chute, and a brace every other bent
      // the cross beam: square under the (banked) floor
      const mid = P.clone().addScaledVector(U, -0.6);
      const beam = new THREE.BoxGeometry(hw * 2 + 0.6, 0.3, 0.3);
      woodAttr(beam, 'x', s);
      beam.applyMatrix4(new THREE.Matrix4().makeBasis(R, U, Tn.clone().negate()));
      beam.translate(mid.x, mid.y, mid.z);
      parts.push(beam);
      const drop = Math.min(10, tops[0].y - bottom - 2);
      if (drop > 3) {
        const b2 = beam.clone();
        b2.translate(0, -drop, 0);
        parts.push(b2);
      }
    }
    if (parts.length) {
      const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
      if (g) this.batch.add(this.postWood, g);
    }
  }

  lakeY = 0;

  /** a static flat piece (a platform, a wedge) from a geometry already in world space */
  solid(g: THREE.BufferGeometry, mat: THREE.Material, phys = Mat.Wood) {
    this.batch.add(mat, g);
    this.world.statics.addGeometry(g, phys);
  }

  /** a kinematic (or fixed) obstacle with its painted visual, modelled in the collider's frame */
  obstacle(kin: Kin, vis: THREE.Object3D, hazard = true) {
    this.world.addKin(kin);
    vis.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    vis.position.copy(kin.pos);
    vis.quaternion.copy(kin.quat);
    this.group.add(vis);
    this.obstacles.push({ kin, vis });
    if (hazard) this.hazards.push(kin);
    return kin;
  }

  /** a hazard only the AI sees: a static spot (pos/quat) or a moving one (pose) */
  ghost(shape: Shape, pose: ((t: number, pos: THREE.Vector3, quat: THREE.Quaternion) => void) | null, pos?: THREE.Vector3, quat?: THREE.Quaternion) {
    const k = new Kin(shape, Mat.Wood, pose);
    if (pos) k.pos.copy(pos);
    if (quat) k.quat.copy(quat);
    k.set(this.world.time);
    this.hazards.push(k);
    if (pose) this.ghosts.push(k);
    return k;
  }

  /** a fixed obstacle: its collider in the world, its visual merged into the batch (no draw call of its own) */
  fixed(kin: Kin, parts: { toBatch(b: CourseBuilder, m: THREE.Matrix4): void }, hazard = true) {
    this.world.addKin(kin);
    parts.toBatch(this, new THREE.Matrix4().compose(kin.pos, kin.quat, new THREE.Vector3(1, 1, 1)));
    if (hazard) this.hazards.push(kin);
    return kin;
  }

  /** syncs the visuals to their colliders (and lets the bumpers glow after a hit) */
  sync(t: number) {
    for (const g of this.ghosts) g.set(t);
    for (const f of this.animators) f(t);
    for (const o of this.obstacles) {
      o.vis.position.copy(o.kin.pos);
      o.vis.quaternion.copy(o.kin.quat);
      const f = o.vis.userData.flash as { value: number } | undefined;
      if (f) f.value = Math.max(0, 1 - (t - o.kin.lastHit) * 3);
      const sq = o.vis.userData.squash as THREE.Object3D | undefined;
      if (sq) {
        const k = Math.max(0, 1 - (t - o.kin.lastHit) * 5);
        sq.scale.set(1 + 0.12 * k, 1 - 0.18 * k, 1 + 0.12 * k);
      }
    }
  }

  finish() {
    this.world.statics.build();
    for (const p of this.trestlePaths) this.trestles(p);
    this.batch.flush(this.group);
  }
}

export function fixWinding(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), nr = g.getAttribute('normal');
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    n.fromBufferAttribute(nr, i);
    const f = b.clone().sub(a).cross(c.clone().sub(a));
    if (f.dot(n) < 0) {
      for (const at of Object.values(g.attributes)) {
        const s = at.itemSize;
        for (let k = 0; k < s; k++) {
          const t = at.array[(i + 1) * s + k];
          (at.array as Float32Array)[(i + 1) * s + k] = at.array[(i + 2) * s + k];
          (at.array as Float32Array)[(i + 2) * s + k] = t;
        }
      }
    }
  }
}

function rotateAbout(g: THREE.BufferGeometry, yaw: number, x: number, z: number) {
  g.translate(-x, 0, -z);
  g.rotateY(yaw);
  g.translate(x, 0, z);
}

// ---------------------------------------------------------------------------------------------
// painted parts

/** a cylinder's paint coordinates: along its axis, round its circumference, radius */
export function cylAttr(g: THREE.BufferGeometry, seed = 0) {
  const p = g.getAttribute('position');
  // the angle from the uv where there is one: atan2 wraps partway round and leaves a seam
  const uv = g.getAttribute('uv');
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    a[i * 3] = y + seed;
    a[i * 3 + 1] = (uv ? uv.getX(i) * Math.PI * 2 - Math.PI : Math.atan2(z, x)) * Math.max(r, 0.3);
    a[i * 3 + 2] = r;
  }
  g.setAttribute('aWood', new THREE.BufferAttribute(a, 3));
  return g;
}

/** a disk top's coordinates: polar-friendly x/z */
export function flatAttr(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    a[i * 3] = p.getX(i);
    a[i * 3 + 1] = p.getZ(i);
    a[i * 3 + 2] = p.getY(i);
  }
  g.setAttribute('aWood', new THREE.BufferAttribute(a, 3));
  return g;
}

/** a rounded box (bevelled) */
export function roundBox(w: number, h: number, d: number, r = 0.08) {
  // soften: pull a subdivided box's corners onto rounded edges
  const s = new THREE.BoxGeometry(w, h, d, Math.max(2, Math.round(w / 0.4)), Math.max(2, Math.round(h / 0.4)), Math.max(2, Math.round(d / 0.4)));
  const p = s.getAttribute('position'), nr = s.getAttribute('normal');
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -hx, hx), THREE.MathUtils.clamp(v.y, -hy, hy), THREE.MathUtils.clamp(v.z, -hz, hz));
    v.sub(c);
    if (v.lengthSq() < 1e-12) continue;
    v.normalize();
    nr.setXYZ(i, v.x, v.y, v.z);
    p.setXYZ(i, c.x + v.x * r, c.y + v.y * r, c.z + v.z * r);
  }
  return s;
}

export function paintedMesh(g: THREE.BufferGeometry, m: THREE.Material) {
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const PAINT = {
  red: 0xe8322f,
  orange: 0xff8a1f,
  yellow: 0xffcf2a,
  green: 0x37c25a,
  teal: 0x1fc8c0,
  blue: 0x2f74ff,
  purple: 0x8a4bff,
  pink: 0xff5fa8,
  white: 0xf3eee4,
  black: 0x1d1b22,
};

export { Pattern, RADIUS };
