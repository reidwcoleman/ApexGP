import * as THREE from 'three';

/**
 * Geometry accumulation helpers for the trackside.
 *
 * `GeoBuilder` collects vertices for ONE material; `ChunkSet` keeps one builder
 * per (chunk, material) so the lap can be cut into ~240 m pieces that frustum
 * cull independently while everything inside a piece merges into one draw per
 * material.
 */

export interface BuilderSpec {
  uv?: boolean;
  color?: boolean;
  /** vec4 custom attribute `aA0` */
  a0?: boolean;
  /** vec4 custom attribute `aA1` */
  a1?: boolean;
  /** vec3 custom attribute `aPBR` (roughness, metalness, emissive) */
  pbr?: boolean;
}

class FloatList {
  a: Float32Array;
  n = 0;
  constructor(cap = 1024) {
    this.a = new Float32Array(cap);
  }
  push3(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) this.grow();
    const a = this.a;
    a[this.n] = x; a[this.n + 1] = y; a[this.n + 2] = z;
    this.n += 3;
  }
  push2(x: number, y: number) {
    if (this.n + 2 > this.a.length) this.grow();
    this.a[this.n] = x; this.a[this.n + 1] = y;
    this.n += 2;
  }
  push4(x: number, y: number, z: number, w: number) {
    if (this.n + 4 > this.a.length) this.grow();
    const a = this.a;
    a[this.n] = x; a[this.n + 1] = y; a[this.n + 2] = z; a[this.n + 3] = w;
    this.n += 4;
  }
  private grow() {
    const b = new Float32Array(this.a.length * 2);
    b.set(this.a);
    this.a = b;
  }
  view() {
    return this.a.slice(0, this.n);
  }
}

class IndexList {
  a: Uint32Array;
  n = 0;
  constructor(cap = 1024) {
    this.a = new Uint32Array(cap);
  }
  push3(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x; this.a[this.n++] = y; this.a[this.n++] = z;
  }
}

export class GeoBuilder {
  readonly spec: BuilderSpec;
  private pos = new FloatList();
  private nor = new FloatList();
  private uvs: FloatList | null;
  private col: FloatList | null;
  private a0: FloatList | null;
  private a1: FloatList | null;
  private pbr: FloatList | null;
  private idx = new IndexList();
  count = 0;

  // current "pen" state applied to every new vertex
  cr = 1; cg = 1; cb = 1;
  s0 = [0, 0, 0, 0];
  s1 = [0, 0, 0, 0];
  rough = 0.6; metal = 0; emit = 0;

  constructor(spec: BuilderSpec) {
    this.spec = spec;
    this.uvs = spec.uv ? new FloatList() : null;
    this.col = spec.color ? new FloatList() : null;
    this.a0 = spec.a0 ? new FloatList() : null;
    this.a1 = spec.a1 ? new FloatList() : null;
    this.pbr = spec.pbr ? new FloatList() : null;
  }

  color(c: THREE.Color | number, mul = 1): this {
    if (typeof c === 'number') {
      const t = TMP_C.setHex(c);
      this.cr = t.r * mul; this.cg = t.g * mul; this.cb = t.b * mul;
    } else {
      this.cr = c.r * mul; this.cg = c.g * mul; this.cb = c.b * mul;
    }
    return this;
  }
  rgb(r: number, g: number, b: number): this {
    this.cr = r; this.cg = g; this.cb = b;
    return this;
  }
  mat(rough: number, metal = 0, emit = 0): this {
    this.rough = rough; this.metal = metal; this.emit = emit;
    return this;
  }

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, w = 0): number {
    this.pos.push3(x, y, z);
    this.nor.push3(nx, ny, nz);
    if (this.uvs) this.uvs.push2(u, w);
    if (this.col) this.col.push3(this.cr, this.cg, this.cb);
    if (this.a0) this.a0.push4(this.s0[0], this.s0[1], this.s0[2], this.s0[3]);
    if (this.a1) this.a1.push4(this.s1[0], this.s1[1], this.s1[2], this.s1[3]);
    if (this.pbr) this.pbr.push3(this.rough, this.metal, this.emit);
    return this.count++;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push3(a, b, c);
  }
  /** a,b,c,d counter-clockwise seen from the front */
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push3(a, b, c);
    this.idx.push3(a, c, d);
  }

  /** Quad whose winding is chosen so its geometric normal agrees with (nx, ny, nz). */
  quadN(a: number, b: number, c: number, d: number, nx: number, ny: number, nz: number) {
    const p = this.pos.a;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * nx + cy * ny + cz * nz >= 0) this.quad(a, b, c, d);
    else this.quad(a, d, c, b);
  }
  triN(a: number, b: number, c: number, nx: number, ny: number, nz: number) {
    const p = this.pos.a;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
    if (cx * nx + cy * ny + cz * nz >= 0) this.tri(a, b, c);
    else this.tri(a, c, b);
  }

  /** Flat quad from 4 world points (CCW from the front), normal computed. UVs optional (4 pairs). */
  quadP(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, uv?: number[]) {
    E1.subVectors(p1, p0);
    E2.subVectors(p3, p0);
    N.crossVectors(E1, E2);
    if (N.lengthSq() < 1e-12) {
      E1.subVectors(p2, p1);
      E2.subVectors(p0, p1);
      N.crossVectors(E2, E1);
    }
    N.normalize();
    const u = uv ?? [0, 0, 1, 0, 1, 1, 0, 1];
    const a = this.v(p0.x, p0.y, p0.z, N.x, N.y, N.z, u[0], u[1]);
    const b = this.v(p1.x, p1.y, p1.z, N.x, N.y, N.z, u[2], u[3]);
    const c = this.v(p2.x, p2.y, p2.z, N.x, N.y, N.z, u[4], u[5]);
    const d = this.v(p3.x, p3.y, p3.z, N.x, N.y, N.z, u[6], u[7]);
    this.quad(a, b, c, d);
    return a;
  }

  get empty() {
    return this.idx.n === 0;
  }
  get triangles() {
    return this.idx.n / 3;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.view(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.view(), 3));
    if (this.uvs) g.setAttribute('uv', new THREE.BufferAttribute(this.uvs.view(), 2));
    if (this.col) g.setAttribute('color', new THREE.BufferAttribute(this.col.view(), 3));
    if (this.a0) g.setAttribute('aA0', new THREE.BufferAttribute(this.a0.view(), 4));
    if (this.a1) g.setAttribute('aA1', new THREE.BufferAttribute(this.a1.view(), 4));
    if (this.pbr) g.setAttribute('aPBR', new THREE.BufferAttribute(this.pbr.view(), 3));
    const n = this.idx.n;
    const index = this.count > 65535 ? this.idx.a.slice(0, n) : Uint16Array.from(this.idx.a.subarray(0, n));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const TMP_C = new THREE.Color();
const E1 = new THREE.Vector3();
const E2 = new THREE.Vector3();
const N = new THREE.Vector3();

export interface MatDef {
  material: THREE.Material;
  spec: BuilderSpec;
  cast: boolean;
  receive: boolean;
  renderOrder?: number;
}

export class ChunkSet {
  readonly count: number;
  readonly size: number;
  private readonly lap: number;
  private readonly defs: Map<string, MatDef>;
  private readonly chunks: Map<string, GeoBuilder>[];

  constructor(lap: number, targetSize: number, defs: Record<string, MatDef>) {
    this.lap = lap;
    this.count = Math.max(1, Math.round(lap / targetSize));
    this.size = lap / this.count;
    this.defs = new Map(Object.entries(defs));
    this.chunks = [];
    for (let i = 0; i < this.count; i++) this.chunks.push(new Map());
  }

  chunkOf(s: number): number {
    const w = ((s % this.lap) + this.lap) % this.lap;
    return Math.min(this.count - 1, Math.floor(w / this.size));
  }

  get(s: number, key: string): GeoBuilder {
    const c = this.chunks[this.chunkOf(s)];
    let b = c.get(key);
    if (!b) {
      const def = this.defs.get(key);
      if (!def) throw new Error('unknown material key ' + key);
      b = new GeoBuilder(def.spec);
      c.set(key, b);
    }
    return b;
  }

  /** Builds all meshes into `group`. Returns triangle count. */
  finish(group: THREE.Group): { meshes: number; triangles: number; byKey: Record<string, number> } {
    let meshes = 0;
    let triangles = 0;
    const byKey: Record<string, number> = {};
    this.chunks.forEach((c, ci) => {
      for (const [key, b] of c) {
        if (b.empty) continue;
        const def = this.defs.get(key)!;
        const mesh = new THREE.Mesh(b.build(), def.material);
        mesh.name = `ts_${key}_${ci}`;
        mesh.castShadow = def.cast;
        mesh.receiveShadow = def.receive;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        if (def.renderOrder !== undefined) mesh.renderOrder = def.renderOrder;
        group.add(mesh);
        meshes++;
        triangles += b.triangles;
        byKey[key] = (byKey[key] ?? 0) + b.triangles;
      }
    });
    return { meshes, triangles, byKey };
  }
}

/** Orthonormal local frame used to place props: x = right, y = up, z = forward. */
export class Frame3 {
  o = new THREE.Vector3();
  x = new THREE.Vector3(1, 0, 0);
  y = new THREE.Vector3(0, 1, 0);
  z = new THREE.Vector3(0, 0, 1);

  /** world point from local coords */
  p(lx: number, ly: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.o).addScaledVector(this.x, lx).addScaledVector(this.y, ly).addScaledVector(this.z, lz);
  }
  /** world direction from local direction */
  d(lx: number, ly: number, lz: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 0, 0).addScaledVector(this.x, lx).addScaledVector(this.y, ly).addScaledVector(this.z, lz);
  }
  /** Horizontal frame: forward = (fx, 0, fz) normalised, up = world Y. */
  setHorizontal(o: THREE.Vector3, fx: number, fz: number): this {
    this.o.copy(o);
    const l = Math.hypot(fx, fz) || 1;
    this.z.set(fx / l, 0, fz / l);
    this.y.set(0, 1, 0);
    // right = forward × up (track convention; the frame is left-handed, winding is auto-fixed)
    this.x.crossVectors(this.z, this.y).normalize();
    return this;
  }
  copy(f: Frame3): this {
    this.o.copy(f.o); this.x.copy(f.x); this.y.copy(f.y); this.z.copy(f.z);
    return this;
  }
  /** rotate around local y by `a` radians (+ turns z toward -x ... i.e. left) */
  yaw(a: number): this {
    const c = Math.cos(a), s = Math.sin(a);
    const z = this.z.clone();
    const x = this.x.clone();
    this.z.copy(z).multiplyScalar(c).addScaledVector(x, -s);
    this.x.copy(x).multiplyScalar(c).addScaledVector(z, s);
    return this;
  }
}

const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const DN = new THREE.Vector3();

/**
 * Axis-aligned (in `f`) box centred at local (cx, cy, cz) with size (sx, sy, sz).
 * `faces` bitmask: 1 +x, 2 −x, 4 +y, 8 −y, 16 +z, 32 −z (default all but bottom).
 * `uvMode` 'metres' writes u/v in metres of the face (for tiling textures), else 0..1.
 */
export function box(b: GeoBuilder, f: Frame3, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, faces = 0b110111, uvRect?: { u0: number; v0: number; u1: number; v1: number }) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const c = (i: number, x: number, y: number, z: number) => f.p(cx + x, cy + y, cz + z, P[i]);
  c(0, -hx, -hy, -hz); c(1, hx, -hy, -hz); c(2, hx, hy, -hz); c(3, -hx, hy, -hz);
  c(4, -hx, -hy, hz); c(5, hx, -hy, hz); c(6, hx, hy, hz); c(7, -hx, hy, hz);
  const uv = uvRect ? [uvRect.u0, uvRect.v0, uvRect.u1, uvRect.v0, uvRect.u1, uvRect.v1, uvRect.u0, uvRect.v1] : undefined;
  const face = (a: number, bb: number, cc: number, d: number, nx: number, ny: number, nz: number) => {
    f.d(nx, ny, nz, DN);
    const i0 = b.v(P[a].x, P[a].y, P[a].z, DN.x, DN.y, DN.z, uv ? uv[0] : 0, uv ? uv[1] : 0);
    const i1 = b.v(P[bb].x, P[bb].y, P[bb].z, DN.x, DN.y, DN.z, uv ? uv[2] : 1, uv ? uv[3] : 0);
    const i2 = b.v(P[cc].x, P[cc].y, P[cc].z, DN.x, DN.y, DN.z, uv ? uv[4] : 1, uv ? uv[5] : 1);
    const i3 = b.v(P[d].x, P[d].y, P[d].z, DN.x, DN.y, DN.z, uv ? uv[6] : 0, uv ? uv[7] : 1);
    b.quadN(i0, i1, i2, i3, DN.x, DN.y, DN.z);
  };
  if (faces & 1) face(5, 1, 2, 6, 1, 0, 0);
  if (faces & 2) face(0, 4, 7, 3, -1, 0, 0);
  if (faces & 4) face(7, 6, 2, 3, 0, 1, 0);
  if (faces & 8) face(0, 1, 5, 4, 0, -1, 0);
  if (faces & 16) face(4, 5, 6, 7, 0, 0, 1);
  if (faces & 32) face(1, 0, 3, 2, 0, 0, -1);
}

/** Box between two world points (a beam/tube) with square section `w`×`h` (h along `upHint`). */
export function beam(b: GeoBuilder, a: THREE.Vector3, c: THREE.Vector3, w: number, h = w, upHint = UP) {
  const f = BEAM_F;
  f.o.addVectors(a, c).multiplyScalar(0.5);
  f.z.subVectors(c, a);
  const len = f.z.length();
  if (len < 1e-5) return;
  f.z.divideScalar(len);
  f.x.crossVectors(upHint, f.z);
  if (f.x.lengthSq() < 1e-6) f.x.crossVectors(ALT_UP, f.z);
  f.x.normalize();
  f.y.crossVectors(f.z, f.x).normalize();
  box(b, f, 0, 0, 0, w, h, len, 0b001111);
}
const BEAM_F = new Frame3();
const UP = new THREE.Vector3(0, 1, 0);
const ALT_UP = new THREE.Vector3(1, 0, 0);

/** Vertical cylinder (local y axis of `f`), centred at local (cx, cz), from y0 to y1. */
export function cylinder(b: GeoBuilder, f: Frame3, cx: number, y0: number, cz: number, r: number, y1: number, segs = 8, caps = true) {
  const base = b.count;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    f.p(cx + ca * r, y0, cz + sa * r, P[0]);
    f.p(cx + ca * r, y1, cz + sa * r, P[1]);
    f.d(ca, 0, sa, DN);
    b.v(P[0].x, P[0].y, P[0].z, DN.x, DN.y, DN.z, i / segs, 0);
    b.v(P[1].x, P[1].y, P[1].z, DN.x, DN.y, DN.z, i / segs, 1);
  }
  for (let i = 0; i < segs; i++) {
    const a = base + i * 2;
    const am = (((i + 0.5) / segs) * Math.PI * 2);
    f.d(Math.cos(am), 0, Math.sin(am), DN);
    b.quadN(a, a + 2, a + 3, a + 1, DN.x, DN.y, DN.z);
  }
  if (caps) {
    f.d(0, 1, 0, DN);
    const c0 = f.p(cx, y1, cz, P[2]);
    const ci = b.v(c0.x, c0.y, c0.z, DN.x, DN.y, DN.z, 0.5, 0.5);
    const rim = b.count;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      f.p(cx + Math.cos(a) * r, y1, cz + Math.sin(a) * r, P[0]);
      b.v(P[0].x, P[0].y, P[0].z, DN.x, DN.y, DN.z, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
    }
    f.d(0, 1, 0, DN);
    for (let i = 0; i < segs; i++) b.triN(ci, rim + i + 1, rim + i, DN.x, DN.y, DN.z);
  }
}

/** Disc facing local −z (toward the viewer standing at −z), centred at local (cx, cy, cz). */
export function disc(b: GeoBuilder, f: Frame3, cx: number, cy: number, cz: number, r: number, segs = 12, facing = -1) {
  f.d(0, 0, facing, DN);
  const c0 = f.p(cx, cy, cz, P[2]);
  const ci = b.v(c0.x, c0.y, c0.z, DN.x, DN.y, DN.z, 0.5, 0.5);
  const rim = b.count;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    f.p(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz, P[0]);
    b.v(P[0].x, P[0].y, P[0].z, DN.x, DN.y, DN.z, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
  }
  for (let i = 0; i < segs; i++) b.triN(ci, rim + i, rim + i + 1, DN.x, DN.y, DN.z);
}

/**
 * Vertical prism from a CCW polygon in the local xz plane, y from y0 to y1 (top cap only).
 */
export function prism(b: GeoBuilder, f: Frame3, poly: [number, number][], y0: number, y1: number, top = true) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    // outward normal of edge (for CCW seen from +y, outward = (dz, -dx))
    let nx = bz - az, nz = -(bx - ax);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    f.d(nx, 0, nz, DN);
    const p0 = f.p(ax, y0, az, P[0]);
    const p1 = f.p(bx, y0, bz, P[1]);
    const p2 = f.p(bx, y1, bz, P[2]);
    const p3 = f.p(ax, y1, az, P[3]);
    const i0 = b.v(p0.x, p0.y, p0.z, DN.x, DN.y, DN.z, 0, 0);
    const i1 = b.v(p1.x, p1.y, p1.z, DN.x, DN.y, DN.z, 1, 0);
    const i2 = b.v(p2.x, p2.y, p2.z, DN.x, DN.y, DN.z, 1, 1);
    const i3 = b.v(p3.x, p3.y, p3.z, DN.x, DN.y, DN.z, 0, 1);
    b.quadN(i0, i1, i2, i3, DN.x, DN.y, DN.z);
  }
  if (top) {
    f.d(0, 1, 0, DN);
    const base = b.count;
    for (const [x, z] of poly) {
      const p = f.p(x, y1, z, P[0]);
      b.v(p.x, p.y, p.z, DN.x, DN.y, DN.z, 0, 0);
    }
    for (let i = 1; i < n - 1; i++) b.triN(base, base + i + 1, base + i, DN.x, DN.y, DN.z);
  }
}

const QA = new THREE.Vector3(), QB = new THREE.Vector3(), QC = new THREE.Vector3(), QD = new THREE.Vector3();

function emitFacing(b: GeoBuilder, a: THREE.Vector3, bb: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, n: THREE.Vector3, uv: { u0: number; v0: number; u1: number; v1: number }) {
  const i0 = b.v(a.x, a.y, a.z, n.x, n.y, n.z, uv.u0, uv.v0);
  const i1 = b.v(bb.x, bb.y, bb.z, n.x, n.y, n.z, uv.u1, uv.v0);
  const i2 = b.v(c.x, c.y, c.z, n.x, n.y, n.z, uv.u1, uv.v1);
  const i3 = b.v(d.x, d.y, d.z, n.x, n.y, n.z, uv.u0, uv.v1);
  b.quadN(i0, i1, i2, i3, n.x, n.y, n.z);
}

/**
 * Printed vertical quad in the local plane x = `x`, spanning z0..z1 × y0..y1, facing
 * local ±x (`nSign`), with the image upright and readable for a viewer in front of it.
 * (Frame3 is x = right, y = up, z = forward in the track's convention.)
 */
export function printQuadX(b: GeoBuilder, f: Frame3, x: number, z0: number, z1: number, y0: number, y1: number, nSign: number, uv: { u0: number; v0: number; u1: number; v1: number }) {
  const zl = nSign > 0 ? z0 : z1, zr = nSign > 0 ? z1 : z0;
  f.p(x, y0, zl, QA); f.p(x, y0, zr, QB); f.p(x, y1, zr, QC); f.p(x, y1, zl, QD);
  emitFacing(b, QA, QB, QC, QD, f.d(nSign, 0, 0, DN), uv);
}

/** Printed vertical quad in the local plane z = `z`, spanning x0..x1 × y0..y1, facing local ±z. */
export function printQuadZ(b: GeoBuilder, f: Frame3, z: number, x0: number, x1: number, y0: number, y1: number, nSign: number, uv: { u0: number; v0: number; u1: number; v1: number }) {
  // viewer looking along −nSign·z has their right along −nSign·x … i.e. facing −z → text runs −x → +x
  const xl = nSign < 0 ? x0 : x1, xr = nSign < 0 ? x1 : x0;
  f.p(xl, y0, z, QA); f.p(xr, y0, z, QB); f.p(xr, y1, z, QC); f.p(xl, y1, z, QD);
  emitFacing(b, QA, QB, QC, QD, f.d(0, 0, nSign, DN), uv);
}
