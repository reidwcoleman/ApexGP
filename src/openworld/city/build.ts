import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A growable mesh: positions, normals, optional uv and any number of float attributes, with an
 * index. Quads and strips are the common case; computeNormals() when the caller doesn't supply them.
 */
export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  readonly attrs = new Map<string, { size: number; data: number[] }>();
  private cur = new Map<string, number[]>();
  hasUv = false;

  /** declare a custom attribute; set its value for the next vertices with set() */
  attr(name: string, size: number, init?: number[]) {
    this.attrs.set(name, { size, data: [] });
    this.cur.set(name, init ?? new Array(size).fill(0));
    return this;
  }
  set(name: string, ...v: number[]) {
    this.cur.set(name, v);
    return this;
  }

  get count() {
    return this.pos.length / 3;
  }

  /** add a vertex, returns its index */
  v(x: number, y: number, z: number, nx = 0, ny = 1, nz = 0, u = 0, w = 0): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, w);
    for (const [k, a] of this.attrs) {
      const c = this.cur.get(k)!;
      for (let i = 0; i < a.size; i++) a.data.push(c[i] ?? 0);
    }
    return this.count - 1;
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  /** a, b, c, d counter-clockwise seen from the front */
  quad(a: number, b: number, c: number, d: number) {
    this.idx.push(a, b, c, a, c, d);
  }

  /** a flat quad from four points (computes its normal) */
  face(p: number[][], uvs?: number[][]) {
    const [a, b, c] = p;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const ids = p.map((q, i) => this.v(q[0], q[1], q[2], nx, ny, nz, uvs?.[i]?.[0] ?? 0, uvs?.[i]?.[1] ?? 0));
    if (ids.length === 4) this.quad(ids[0], ids[1], ids[2], ids[3]);
    else for (let i = 1; i + 1 < ids.length; i++) this.tri(ids[0], ids[i], ids[i + 1]);
  }

  /** an axis-aligned-ish box given its 8 corners via centre, half sizes and a yaw (rad) */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw = 0, faces = 0b111111) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, y: number, z: number) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const p = [
      P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(-hx, hy, -hz),
      P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz),
    ];
    if (faces & 1) this.face([p[4], p[5], p[6], p[7]]); // +z
    if (faces & 2) this.face([p[1], p[0], p[3], p[2]]); // -z
    if (faces & 4) this.face([p[5], p[1], p[2], p[6]]); // +x
    if (faces & 8) this.face([p[0], p[4], p[7], p[3]]); // -x
    if (faces & 16) this.face([p[3], p[7], p[6], p[2]]); // +y
    if (faces & 32) this.face([p[0], p[1], p[5], p[4]]); // -y
  }

  /** a vertical cylinder (open ends unless capped) */
  cylinder(cx: number, y0: number, cz: number, r0: number, r1: number, h: number, seg = 10, cap = false) {
    const base = this.count;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a), z = Math.sin(a);
      this.v(cx + x * r0, y0, cz + z * r0, x, 0, z, i / seg, 0);
      this.v(cx + x * r1, y0 + h, cz + z * r1, x, 0, z, i / seg, 1);
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 2;
      this.quad(a, a + 1, a + 3, a + 2);
    }
    if (cap) {
      const c = this.v(cx, y0 + h, cz, 0, 1, 0);
      const ring: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(this.v(cx + Math.cos(a) * r1, y0 + h, cz + Math.sin(a) * r1, 0, 1, 0));
      }
      for (let i = 0; i < seg; i++) this.tri(c, ring[i + 1], ring[i]);
    }
  }

  build(computeNormals = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.hasUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const [k, a] of this.attrs) g.setAttribute(k, new THREE.Float32BufferAttribute(a.data, a.size));
    const n = this.count;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    if (computeNormals) g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** split a builder's triangles into spatial chunks (each its own geometry, so far chunks frustum-cull) */
export function chunked(b: MeshBuilder, size: number): THREE.BufferGeometry[] {
  const buckets = new Map<string, number[]>();
  for (let t = 0; t < b.idx.length; t += 3) {
    const a = b.idx[t];
    const cx = Math.floor(b.pos[a * 3] / size), cz = Math.floor(b.pos[a * 3 + 2] / size);
    const k = cx + ',' + cz;
    let l = buckets.get(k);
    if (!l) buckets.set(k, (l = []));
    l.push(b.idx[t], b.idx[t + 1], b.idx[t + 2]);
  }
  const out: THREE.BufferGeometry[] = [];
  for (const tris of buckets.values()) {
    const map = new Map<number, number>();
    const sub = new MeshBuilder();
    sub.hasUv = b.hasUv;
    for (const [k, a] of b.attrs) sub.attrs.set(k, { size: a.size, data: [] });
    const remap = (i: number) => {
      let j = map.get(i);
      if (j !== undefined) return j;
      j = sub.count;
      map.set(i, j);
      sub.pos.push(b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]);
      sub.nor.push(b.nor[i * 3], b.nor[i * 3 + 1], b.nor[i * 3 + 2]);
      sub.uv.push(b.uv[i * 2], b.uv[i * 2 + 1]);
      for (const [k, a] of b.attrs) {
        const d = sub.attrs.get(k)!.data;
        for (let c = 0; c < a.size; c++) d.push(a.data[i * a.size + c]);
      }
      return j;
    };
    for (let t = 0; t < tris.length; t++) sub.idx.push(remap(tris[t]));
    out.push(sub.build());
  }
  return out;
}

/** meshes from chunked geometries under one group */
export function chunkMeshes(b: MeshBuilder, size: number, mat: THREE.Material, opts: { cast?: boolean; receive?: boolean; name?: string } = {}): THREE.Group {
  const g = new THREE.Group();
  g.name = opts.name ?? 'chunks';
  for (const geo of chunked(b, size)) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = opts.cast ?? false;
    m.receiveShadow = opts.receive ?? true;
    g.add(m);
  }
  return g;
}

/** seeded random */
export function rng(seed: number) {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** convex hull (monotone chain) of 2D points */
export function hull(pts: { x: number; z: number }[]): { x: number; z: number }[] {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cross = (o: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo: typeof p = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: typeof p = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}

/** merge the static single-material meshes under `root` (in root's space), one mesh per material */
export function mergeStatic(root: THREE.Object3D, keep: Set<THREE.Object3D>) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const done: THREE.Mesh[] = [];
  let cast = false;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || Array.isArray(m.material)) return;
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (keep.has(p)) return;
    let g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (g.index) g = g.toNonIndexed();
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    g.morphAttributes = {};
    let l = byMat.get(m.material);
    if (!l) byMat.set(m.material, (l = []));
    l.push(g);
    done.push(m);
    cast ||= m.castShadow;
  });
  for (const m of done) m.removeFromParent();
  for (const [mat, list] of byMat) {
    const merged = mergeGeometries(list);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
}
