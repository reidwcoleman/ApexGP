import * as THREE from 'three';
import { CourseBuilder, Path, cylAttr, flatAttr, mergeAll, roundBox } from './builder.ts';
import { woodAttr } from './shaders.ts';

/**
 * The obstacle workshop: the parts every machine on the course is made from, in one toy style —
 * bevelled painted timber, walnut posts on bolted feet, brass hex bolts and domed caps, steel axles.
 * `Parts` collects pieces by material in an obstacle's own frame and merges them, so a whole windmill
 * is a handful of draw calls; `toBatch` sends a static piece (a gantry, a tower) into the course batch.
 */

const Y = new THREE.Vector3(0, 1, 0);

export class Parts {
  readonly lots = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(m: THREE.Material, g: THREE.BufferGeometry, at?: THREE.Matrix4) {
    if (at) g.applyMatrix4(at);
    let l = this.lots.get(m);
    if (!l) this.lots.set(m, (l = []));
    l.push(g);
    return this;
  }
  /** one mesh per material */
  group(cast = true) {
    const grp = new THREE.Group();
    for (const [m, gs] of this.lots) {
      const g = merge(gs);
      if (!g) continue;
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      grp.add(mesh);
    }
    this.lots.clear();
    return grp;
  }
  /** static: into the course's merged batch, placed by `world` */
  toBatch(b: CourseBuilder, world: THREE.Matrix4) {
    for (const [m, gs] of this.lots) for (const g of gs) b.batch.add(m, g.applyMatrix4(world));
    this.lots.clear();
  }
}

/** merges geometries that may differ in attributes (keeps position, normal, aWood) */
export const merge = mergeAll;

/** a matrix from a position, an optional quaternion and an optional uniform/axis scale */
export function mat(x = 0, y = 0, z = 0, q?: THREE.Quaternion, sc?: THREE.Vector3) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q ?? new THREE.Quaternion(), sc ?? new THREE.Vector3(1, 1, 1));
}
export const rotX = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
export const rotY = (a: number) => new THREE.Quaternion().setFromAxisAngle(Y, a);
export const rotZ = (a: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);

// ------------------------------------------------------------------------------------- pieces

/** a cylinder along local y with painted coordinates round it */
export function rod(r: number, h: number, seg = 24, cap = true) {
  return cylAttr(new THREE.CylinderGeometry(r, r, h, seg, Math.max(1, Math.round(h / 0.6)), !cap));
}
/** a domed cap (the top half of a sphere), on local y */
export function dome(r: number, flat = 1, seg = 20) {
  return cylAttr(new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 2), 0, Math.PI * 2, 0, Math.PI / 2).scale(1, flat, 1));
}
/** a painted ring round local y */
export function band(r: number, tube: number, seg = 32) {
  return cylAttr(new THREE.TorusGeometry(r, tube, 8, seg).rotateX(Math.PI / 2));
}
/** a rounded timber with its grain along `axis` */
export function plank(w: number, h: number, d: number, r = 0.06, axis: 'x' | 'y' | 'z' = 'x', seed = 0) {
  return woodAttr(roundBox(w, h, d, r), axis, seed);
}
/** a disk face (painted polar coordinates), facing local +y */
export function disk(r: number, seg = 40) {
  return flatAttr(new THREE.CircleGeometry(r, seg).rotateX(-Math.PI / 2));
}

/** a disk face whose paint runs in rings (radius first: Pattern.Rings draws growth rings, a target) */
export function ringDisk(r: number, seg = 40) {
  const g = new THREE.CircleGeometry(r, seg, 0, Math.PI * 2).rotateX(-Math.PI / 2);
  const p = g.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const rr = Math.hypot(x, z);
    a[i * 3] = rr;
    a[i * 3 + 1] = Math.atan2(z, x) * rr;
  }
  g.setAttribute('aWood', new THREE.BufferAttribute(a, 3));
  return g;
}

/** a brass hex bolt head (and its washer) facing local +y of `at` */
export function bolt(p: Parts, b: CourseBuilder, at: THREE.Matrix4, r = 0.07) {
  // (one template per size: a course has hundreds of bolts)
  let t = BOLTS.get(r);
  if (!t) {
    const g = new THREE.CylinderGeometry(r, r, r * 0.8, 6, 1);
    g.translate(0, r * 0.4, 0);
    const w = new THREE.CylinderGeometry(r * 1.45, r * 1.45, r * 0.25, 12, 1, true);
    w.translate(0, r * 0.12, 0);
    t = mergeAll([g, w])!;
    BOLTS.set(r, t);
  }
  p.add(b.brass, t.clone(), at);
}
const BOLTS = new Map<number, THREE.BufferGeometry>();

/** n bolts round a circle of radius R on a face (the face's normal is local +y of `at`) */
export function boltRing(p: Parts, b: CourseBuilder, at: THREE.Matrix4, R: number, n: number, r = 0.06) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.3;
    bolt(p, b, at.clone().multiply(mat(Math.cos(a) * R, 0, Math.sin(a) * R)), r);
  }
}

/** a hub: a painted boss with a brass cap and a ring of bolts, its axis local y */
export function hub(p: Parts, b: CourseBuilder, at: THREE.Matrix4, r: number, len: number, paint: THREE.Material) {
  p.add(paint, rod(r, len, 28), at);
  for (const e of [-1, 1]) {
    const q = e > 0 ? new THREE.Quaternion() : rotX(Math.PI);
    const face = at.clone().multiply(mat(0, (e * len) / 2, 0, q));
    p.add(b.brass, dome(r * 0.55, 0.55, 20), face.clone());
    boltRing(p, b, face, r * 0.78, 6, Math.min(0.08, r * 0.12));
  }
}

/** a post standing on local y: a bevelled walnut square, a brass-bolted foot plate, a cap */
export function post(p: Parts, b: CourseBuilder, at: THREE.Matrix4, h: number, o: { w?: number; paint?: THREE.Material; capPaint?: THREE.Material } = {}) {
  const w = o.w ?? 0.42;
  p.add(o.paint ?? b.railWood, plank(w, h, w, 0.06, 'y', h), at.clone().multiply(mat(0, h / 2, 0)));
  // the foot: a plate and four bolts
  p.add(b.darkWood, plank(w * 2, 0.12, w * 2, 0.04, 'x', 3), at.clone().multiply(mat(0, 0.06, 0)));
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bolt(p, b, at.clone().multiply(mat(dx * w * 0.72, 0.12, dz * w * 0.72)), 0.05);
  // the cap
  p.add(o.capPaint ?? b.brass, dome(w * 0.62, 0.7, 16), at.clone().multiply(mat(0, h, 0)));
}

/** a beam between two points (local frame), square section, bevelled */
export function beam(p: Parts, m: THREE.Material, a: THREE.Vector3, c: THREE.Vector3, w = 0.36, seed = 0) {
  const d = c.clone().sub(a);
  const len = d.length();
  const g = plank(w, len, w, 0.05, 'y', seed);
  const q = new THREE.Quaternion().setFromUnitVectors(Y, d.normalize());
  p.add(m, g, mat((a.x + c.x) / 2, (a.y + c.y) / 2, (a.z + c.z) / 2, q));
}

/** the frame at a point of a path: local x = the track's left (−right), y = up, z = along */
export function frameAt(path: Path, s: number, lat = 0, up = 0) {
  const i = path.index(s);
  const R = path.Rt[i], U = path.U[i], T = path.T[i];
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(R.clone().negate(), U, T));
  const pos = path.at(s, lat, up);
  return { pos, q, R: R.clone(), U: U.clone(), T: T.clone(), sec: path.sec[i], m: new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)) };
}

/**
 * A gantry over the track at s: two posts on footings just outside the rails, a crossbeam at
 * `h` above the floor with knee braces and bolted plates. Static, into the batch. Returns the
 * beam's centre (world).
 */
export function gantry(b: CourseBuilder, path: Path, s: number, h: number, o: { span?: number; paint?: THREE.Material; plate?: THREE.Material } = {}) {
  const f = frameAt(path, s);
  const hw = (o.span ?? f.sec.w) / 2 + 0.75;
  const p = new Parts();
  const pm = o.paint ?? b.railWood;
  for (const side of [-1, 1]) {
    const x = side * hw;
    post(p, b, mat(x, -0.45, 0), h + 0.95, { paint: pm, capPaint: b.brass });
    // knee braces
    beam(p, b.darkWood, new THREE.Vector3(x, h - 1.3, 0), new THREE.Vector3(x - side * 1.1, h + 0.05, 0), 0.2, side);
  }
  // the beam, its end plates and bolts
  p.add(pm, plank(hw * 2 + 0.9, 0.5, 0.55, 0.07, 'x', s), mat(0, h + 0.25, 0));
  for (const side of [-1, 1]) {
    p.add(o.plate ?? b.darkWood, plank(0.9, 0.62, 0.08, 0.03, 'x', 2), mat(side * hw, h + 0.25, 0.3));
    for (const [dx, dy] of [[-0.28, -0.18], [0.28, -0.18], [-0.28, 0.18], [0.28, 0.18]]) bolt(p, b, mat(side * hw + dx, h + 0.25 + dy, 0.34, rotX(Math.PI / 2)), 0.05);
  }
  p.toBatch(b, f.m);
  return path.at(s, 0, h + 0.25);
}

/** a painted warning stripe band (yellow/black chevrons) laid on the floor across the track at s */
export function floorBand(b: CourseBuilder, path: Path, s: number, depth: number, paint: THREE.Material) {
  const f = frameAt(path, s, 0, 0.015);
  const g = new THREE.PlaneGeometry(f.sec.w - 0.6, depth, 1, 1).rotateX(-Math.PI / 2);
  const a = new Float32Array(g.getAttribute('position').count * 3);
  const pp = g.getAttribute('position');
  for (let k = 0; k < pp.count; k++) {
    a[k * 3] = pp.getX(k);
    a[k * 3 + 1] = pp.getZ(k);
  }
  g.setAttribute('aWood', new THREE.BufferAttribute(a, 3));
  const mesh = new THREE.Mesh(g, paint);
  mesh.position.copy(f.pos);
  mesh.quaternion.copy(f.q);
  mesh.receiveShadow = true;
  b.group.add(mesh);
}
