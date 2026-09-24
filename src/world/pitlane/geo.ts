import * as THREE from 'three';
import type { Track } from '../Track.ts';

/**
 * Geometry builder for the pit complex. Every vertex carries
 *   position, normal, color (linear, may exceed 1 for lights), uv,
 *   aPbr = (roughness, metalness, emissive gain, rain exposure 0 … 1).
 * so one material can draw concrete, painted steel, rubber, glowing light
 * panels and screens in a single draw call.
 *
 * Faces are given as 4 corners in order around the face; the winding is fixed
 * up automatically so the normal points away from `inside` (a point inside
 * the solid), which keeps everything correct for either pit side.
 */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Vector3();

export type UVRect = [number, number, number, number];

export function lin(hex: string | number, mul = 1): THREE.Color {
  const c = new THREE.Color(hex as THREE.ColorRepresentation);
  return c.multiplyScalar(mul);
}

export class Geo {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  pbr: number[] = [];
  idx: number[] = [];
  private c = [0.8, 0.8, 0.8];
  private m = [0.7, 0, 0, 1];

  get vertexCount() {
    return this.pos.length / 3;
  }

  color(c: THREE.Color | string | number, mul = 1): this {
    const k = c instanceof THREE.Color ? c : new THREE.Color(c as THREE.ColorRepresentation);
    this.c[0] = k.r * mul;
    this.c[1] = k.g * mul;
    this.c[2] = k.b * mul;
    return this;
  }
  rgb(r: number, g: number, b: number): this {
    this.c[0] = r;
    this.c[1] = g;
    this.c[2] = b;
    return this;
  }
  /** roughness, metalness, emissive gain (× colour), rain exposure */
  mat(rough: number, metal = 0, emit = 0, wet = 1): this {
    this.m[0] = rough;
    this.m[1] = metal;
    this.m[2] = emit;
    this.m[3] = wet;
    return this;
  }

  vert(p: THREE.Vector3, n: THREE.Vector3, u = 0, v = 0): number {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(this.c[0], this.c[1], this.c[2]);
    this.uv.push(u, v);
    this.pbr.push(this.m[0], this.m[1], this.m[2], this.m[3]);
    return i;
  }

  /**
   * Flat quad. Corners in order around the face; `outDir` (optional) is a
   * direction the normal must agree with. uv maps a→(u0,v0) b→(u1,v0) c→(u1,v1) d→(u0,v1).
   */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, outDir?: THREE.Vector3, uv?: UVRect) {
    _a.subVectors(c, a);
    _b.subVectors(d, b);
    _n.crossVectors(_a, _b);
    const len = _n.length();
    if (len < 1e-9) return;
    _n.multiplyScalar(1 / len);
    let flip = false;
    if (outDir && _n.dot(outDir) < 0) {
      _n.negate();
      flip = true;
    }
    const [u0, v0, u1, v1] = uv ?? [0, 0, 1, 1];
    const i0 = this.vert(a, _n, u0, v0);
    const i1 = this.vert(b, _n, u1, v0);
    const i2 = this.vert(c, _n, u1, v1);
    const i3 = this.vert(d, _n, u0, v1);
    if (flip) this.idx.push(i0, i2, i1, i0, i3, i2);
    else this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /** quad whose normal points away from `inside` */
  face(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, inside: THREE.Vector3, uv?: UVRect) {
    _c.copy(a).add(b).add(c).add(d).multiplyScalar(0.25).sub(inside);
    this.quad(a, b, c, d, _c, uv);
  }

  /** smooth-shaded triangle list from explicit normals (used for rounded shapes) */
  tri(p: THREE.Vector3[], n: THREE.Vector3[]) {
    const i0 = this.vert(p[0], n[0]);
    const i1 = this.vert(p[1], n[1]);
    const i2 = this.vert(p[2], n[2]);
    this.idx.push(i0, i1, i2);
  }

  append(g: Geo) {
    const off = this.vertexCount;
    this.pos.push(...g.pos);
    this.nor.push(...g.nor);
    this.col.push(...g.col);
    this.uv.push(...g.uv);
    this.pbr.push(...g.pbr);
    for (const i of g.idx) this.idx.push(i + off);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aPbr', new THREE.Float32BufferAttribute(this.pbr, 4));
    const n = this.vertexCount;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Track-space mapping: (s, l, h) → world, where l is |lateral| toward the pit
 * side and h is metres above the road plane (vertical, not along the bank).
 */
export class TrackSpace {
  readonly track: Track;
  readonly side: number;
  constructor(track: Track, side: number) {
    this.track = track;
    this.side = side;
  }
  P(s: number, l: number, h = 0, out = new THREE.Vector3()): THREE.Vector3 {
    this.track.point(s, this.side * l, 0, out);
    out.y += h;
    return out;
  }

  /**
   * Box spanning [s0,s1]×[l0,l1]×[h0,h1] in track space (corners follow the
   * straight's plan and profile). Long boxes are cut into ≤ seg-metre pieces.
   * mask bits: 1 s0-end, 2 s1-end, 4 bottom, 8 top, 16 front (−l), 32 back (+l).
   */
  box(g: Geo, s0: number, s1: number, l0: number, l1: number, h0: number, h1: number, mask = 63, seg = 8) {
    const n = Math.max(1, Math.ceil((s1 - s0) / seg));
    const c: THREE.Vector3[] = [];
    for (let k = 0; k < 8; k++) c.push(new THREE.Vector3());
    const inside = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const sa = s0 + ((s1 - s0) * k) / n;
      const sb = s0 + ((s1 - s0) * (k + 1)) / n;
      // c[i]: bit0 = s, bit1 = l, bit2 = h
      for (let i = 0; i < 8; i++) this.P(i & 1 ? sb : sa, i & 2 ? l1 : l0, i & 4 ? h1 : h0, c[i]);
      inside.set(0, 0, 0);
      for (const v of c) inside.add(v);
      inside.multiplyScalar(1 / 8);
      if (mask & 1 && k === 0) g.face(c[0], c[2], c[6], c[4], inside);
      if (mask & 2 && k === n - 1) g.face(c[1], c[3], c[7], c[5], inside);
      if (mask & 4) g.face(c[0], c[1], c[3], c[2], inside);
      if (mask & 8) g.face(c[4], c[5], c[7], c[6], inside);
      if (mask & 16) g.face(c[0], c[1], c[5], c[4], inside);
      if (mask & 32) g.face(c[2], c[3], c[7], c[6], inside);
    }
  }

  /**
   * Vertical quad at lateral l facing the lane (dir = −1, toward the track) or
   * away (dir = +1). With a uv rect the image reads left→right in the viewing
   * direction. Split every `seg` m unless textured.
   */
  wallQuad(g: Geo, s0: number, s1: number, l: number, h0: number, h1: number, dir: -1 | 1, uv?: UVRect, seg = 8) {
    const n = uv ? 1 : Math.max(1, Math.ceil((s1 - s0) / seg));
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
    const out = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const sa = s0 + ((s1 - s0) * k) / n;
      const sb = s0 + ((s1 - s0) * (k + 1)) / n;
      // the viewer's right is dir·side·tangent: +s reads left→right iff dir·side > 0
      const right = dir * this.side > 0;
      const sL = right ? sa : sb;
      const sR = right ? sb : sa;
      this.P(sL, l, h0, a);
      this.P(sR, l, h0, b);
      this.P(sR, l, h1, c);
      this.P(sL, l, h1, d);
      this.P((sa + sb) / 2, l + dir, (h0 + h1) / 2, out).sub(this.P((sa + sb) / 2, l, (h0 + h1) / 2));
      g.quad(a, b, c, d, out, uv);
    }
  }

  /** horizontal quad (facing up, or down with dir = −1) */
  flat(g: Geo, s0: number, s1: number, l0: number, l1: number, h: number, dir: 1 | -1 = 1, seg = 8, uv?: UVRect) {
    const n = uv ? 1 : Math.max(1, Math.ceil((s1 - s0) / seg));
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
    const up = new THREE.Vector3(0, dir, 0);
    for (let k = 0; k < n; k++) {
      const sa = s0 + ((s1 - s0) * k) / n;
      const sb = s0 + ((s1 - s0) * (k + 1)) / n;
      this.P(sa, l0, h, a);
      this.P(sb, l0, h, b);
      this.P(sb, l1, h, c);
      this.P(sa, l1, h, d);
      g.quad(a, b, c, d, up, uv);
    }
  }
}

/**
 * Local frame for props: origin on the road plane at (s, l), axes
 *   x = along the track (+s), y = up, z = toward the pit side (+l), optionally yawed.
 */
export class Frame {
  o = new THREE.Vector3();
  x = new THREE.Vector3();
  y = new THREE.Vector3(0, 1, 0);
  z = new THREE.Vector3();
  private t = new THREE.Vector3();

  at(ts: TrackSpace, s: number, l: number, h = 0, yaw = 0): this {
    ts.P(s, l, h, this.o);
    const f = ts.track.frame(s);
    this.x.set(f.tangent.x, 0, f.tangent.z).normalize();
    this.z.set(f.right.x, 0, f.right.z).normalize().multiplyScalar(ts.side);
    if (yaw !== 0) {
      const c = Math.cos(yaw), sn = Math.sin(yaw);
      const x = this.x.clone(), z = this.z.clone();
      this.x.copy(x).multiplyScalar(c).addScaledVector(z, sn);
      this.z.copy(z).multiplyScalar(c).addScaledVector(x, -sn);
    }
    return this;
  }
  copy(f: Frame): this {
    this.o.copy(f.o);
    this.x.copy(f.x);
    this.y.copy(f.y);
    this.z.copy(f.z);
    return this;
  }
  p(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.o).addScaledVector(this.x, x).addScaledVector(this.y, y).addScaledVector(this.z, z);
  }
  dir(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(0, 0, 0).addScaledVector(this.x, x).addScaledVector(this.y, y).addScaledVector(this.z, z);
  }
  /** heading θ (forward = (sin θ, 0, cos θ)) of the local +x axis */
  heading(): number {
    return Math.atan2(this.x.x, this.x.z);
  }

  /** axis-aligned box in the frame, centre (cx,cy,cz), size (sx,sy,sz); mask as TrackSpace.box */
  box(g: Geo, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mask = 63, uvFront?: UVRect) {
    const c: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) c.push(this.p(cx + (i & 1 ? sx : -sx) / 2, cy + (i & 4 ? sy : -sy) / 2, cz + (i & 2 ? sz : -sz) / 2));
    const inside = this.p(cx, cy, cz);
    if (mask & 1) g.face(c[0], c[2], c[6], c[4], inside);
    if (mask & 2) g.face(c[1], c[3], c[7], c[5], inside);
    if (mask & 4) g.face(c[0], c[1], c[3], c[2], inside);
    if (mask & 8) g.face(c[4], c[5], c[7], c[6], inside);
    if (mask & 16) {
      // front (−z) face; textured so the image reads left→right for a viewer facing it
      const hand = new THREE.Vector3().crossVectors(this.x, this.y).dot(this.z) > 0;
      if (hand) g.face(c[1], c[0], c[4], c[5], inside, uvFront);
      else g.face(c[0], c[1], c[5], c[4], inside, uvFront);
    }
    if (mask & 32) g.face(c[2], c[3], c[7], c[6], inside);
  }

  /**
   * Textured/flat panel centred at local (cx,cy,cz) facing local normal (nx,ny,nz),
   * size w × h (w along the viewer's right, h along up — or along −x/… for flat ones).
   */
  panel(g: Geo, cx: number, cy: number, cz: number, nx: number, ny: number, nz: number, w: number, h: number, uv?: UVRect) {
    const C = this.p(cx, cy, cz);
    const N = this.dir(nx, ny, nz).normalize();
    panelWorld(g, C, N, w, h, uv);
  }

  /** beam (square section w×w) between two local points */
  beam(g: Geo, a: THREE.Vector3, b: THREE.Vector3, w: number, h = w) {
    const A = this.p(a.x, a.y, a.z);
    const B = this.p(b.x, b.y, b.z);
    beamWorld(g, A, B, w, h);
  }

  /** cylinder along local axis ('x'|'y'|'z') */
  cyl(g: Geo, cx: number, cy: number, cz: number, axis: 'x' | 'y' | 'z', r: number, len: number, segs = 10, caps = true) {
    const ax = axis === 'x' ? this.x : axis === 'y' ? this.y : this.z;
    const u = axis === 'y' ? this.x : this.y;
    const v = this.t.crossVectors(ax, u).normalize().clone();
    const c = this.p(cx, cy, cz);
    cylWorld(g, c, ax, u, v, r, len, segs, caps);
  }
}

const _p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

/**
 * Quad centred at C with normal N; for vertical panels the image's right is the
 * viewer's right ((−N) × up) and its up is world up. For horizontal panels pass `R`.
 */
export function panelWorld(g: Geo, C: THREE.Vector3, N: THREE.Vector3, w: number, h: number, uv?: UVRect, Rin?: THREE.Vector3) {
  const R = Rin ? Rin.clone() : new THREE.Vector3().crossVectors(N.clone().negate(), new THREE.Vector3(0, 1, 0));
  if (R.lengthSq() < 1e-8) R.set(1, 0, 0);
  R.normalize();
  const U = new THREE.Vector3().crossVectors(R, N.clone().negate()).normalize();
  // make U point "up" for vertical panels
  if (!Rin && U.y < 0) U.negate();
  const a = C.clone().addScaledVector(R, -w / 2).addScaledVector(U, -h / 2);
  const b = C.clone().addScaledVector(R, w / 2).addScaledVector(U, -h / 2);
  const c = C.clone().addScaledVector(R, w / 2).addScaledVector(U, h / 2);
  const d = C.clone().addScaledVector(R, -w / 2).addScaledVector(U, h / 2);
  g.quad(a, b, c, d, N, uv);
}

export function beamWorld(g: Geo, A: THREE.Vector3, B: THREE.Vector3, w: number, h = w) {
  const d = new THREE.Vector3().subVectors(B, A);
  const len = d.length();
  if (len < 1e-5) return;
  d.multiplyScalar(1 / len);
  const ref = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(d, ref).normalize();
  const v = new THREE.Vector3().crossVectors(u, d).normalize();
  const mid = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5);
  const corner = (P: THREE.Vector3, su: number, sv: number, out: THREE.Vector3) => out.copy(P).addScaledVector(u, (su * w) / 2).addScaledVector(v, (sv * h) / 2);
  const sgn = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 4; k++) {
    const [a0, b0] = sgn[k];
    const [a1, b1] = sgn[(k + 1) % 4];
    corner(A, a0, b0, _p[0]);
    corner(A, a1, b1, _p[1]);
    corner(B, a1, b1, _p[2]);
    corner(B, a0, b0, _p[3]);
    g.face(_p[0], _p[1], _p[2], _p[3], mid);
  }
}

/** open or capped cylinder with smooth sides; axis `ax`, radial basis u/v (unit, ⟂) */
export function cylWorld(g: Geo, c: THREE.Vector3, ax: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, r: number, len: number, segs = 10, caps = true) {
  const a = c.clone().addScaledVector(ax, -len / 2);
  const b = c.clone().addScaledVector(ax, len / 2);
  const ring: THREE.Vector3[] = [];
  for (let k = 0; k <= segs; k++) {
    const t = (k / segs) * Math.PI * 2;
    ring.push(new THREE.Vector3().addScaledVector(u, Math.cos(t)).addScaledVector(v, Math.sin(t)));
  }
  for (let k = 0; k < segs; k++) {
    const n0 = ring[k], n1 = ring[k + 1];
    const p0 = a.clone().addScaledVector(n0, r), p1 = a.clone().addScaledVector(n1, r);
    const p2 = b.clone().addScaledVector(n1, r), p3 = b.clone().addScaledVector(n0, r);
    const i0 = g.vert(p0, n0), i1 = g.vert(p1, n1), i2 = g.vert(p2, n1), i3 = g.vert(p3, n0);
    // winding: outward normal; check with first triangle
    const e1 = new THREE.Vector3().subVectors(p1, p0), e2 = new THREE.Vector3().subVectors(p2, p0);
    const fn = new THREE.Vector3().crossVectors(e1, e2);
    if (fn.dot(n0) >= 0) g.idx.push(i0, i1, i2, i0, i2, i3);
    else g.idx.push(i0, i2, i1, i0, i3, i2);
  }
  if (caps) {
    for (const [e, sgn] of [[a, -1], [b, 1]] as [THREE.Vector3, number][]) {
      const n = ax.clone().multiplyScalar(sgn);
      const ci = g.vert(e, n);
      const ids: number[] = [];
      for (let k = 0; k <= segs; k++) ids.push(g.vert(e.clone().addScaledVector(ring[k], r), n));
      for (let k = 0; k < segs; k++) {
        const p0 = e, p1 = new THREE.Vector3().fromArray(g.pos, ids[k] * 3), p2 = new THREE.Vector3().fromArray(g.pos, ids[k + 1] * 3);
        const fn = new THREE.Vector3().crossVectors(p1.clone().sub(p0), p2.clone().sub(p0));
        if (fn.dot(n) >= 0) g.idx.push(ci, ids[k], ids[k + 1]);
        else g.idx.push(ci, ids[k + 1], ids[k]);
      }
    }
  }
}

/** deterministic PRNG */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
