import * as THREE from 'three';

/**
 * Minimal mesh builder with the attribute set every procedural prop here uses:
 * position, normal, color (linear), and two custom floats (aWind: sway weight,
 * aLeaf: foliage flag / free channel). Keeps everything mergeable.
 */
export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  wind: number[] = [];
  leaf: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  get vertexCount() {
    return this.pos.length / 3;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: THREE.Color, wind = 0, leaf = 0, u = 0, v = 0): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(c.r, c.g, c.b);
    this.wind.push(wind);
    this.leaf.push(leaf);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  /**
   * Planar quad from 4 corners (p0 bottom-left, p1 bottom-right, p2 top-right, p3 top-left
   * as seen from the front) with a UV rectangle [u0, v0, u1, v1].
   */
  quad4(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, c: THREE.Color, uvr: [number, number, number, number] = [0, 0, 1, 1], leaf = 0) {
    const n = new THREE.Vector3().subVectors(p1, p0).cross(new THREE.Vector3().subVectors(p3, p0)).normalize();
    const a = this.vertex(p0.x, p0.y, p0.z, n.x, n.y, n.z, c, 0, leaf, uvr[0], uvr[1]);
    const b = this.vertex(p1.x, p1.y, p1.z, n.x, n.y, n.z, c, 0, leaf, uvr[2], uvr[1]);
    const d = this.vertex(p2.x, p2.y, p2.z, n.x, n.y, n.z, c, 0, leaf, uvr[2], uvr[3]);
    const e = this.vertex(p3.x, p3.y, p3.z, n.x, n.y, n.z, c, 0, leaf, uvr[0], uvr[3]);
    this.idx.push(a, b, d, a, d, e);
  }

  /** axis-aligned box from min/max corners */
  aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color, opts: { skipBottom?: boolean; skipTop?: boolean; leaf?: number } = {}) {
    const m = new THREE.Matrix4().makeScale(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    m.setPosition((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    this.box(m, c, opts);
  }

  /**
   * Convex polygon in the (z, y) plane extruded along x from x0 to x1.
   * Polygon points counter-clockwise when looking from +x.
   */
  prismX(poly: [number, number][], x0: number, x1: number, c: THREE.Color, leaf = 0) {
    const n = poly.length;
    // caps
    for (const [x, sign] of [[x1, 1], [x0, -1]] as [number, number][]) {
      const ids = poly.map(([z, y]) => this.vertex(x, y, z, sign, 0, 0, c, 0, leaf));
      for (let i = 1; i < n - 1; i++) {
        if (sign > 0) this.idx.push(ids[0], ids[i + 1], ids[i]);
        else this.idx.push(ids[0], ids[i], ids[i + 1]);
      }
    }
    // sides
    for (let i = 0; i < n; i++) {
      const [za, ya] = poly[i];
      const [zb, yb] = poly[(i + 1) % n];
      let nz = yb - ya, ny = -(zb - za);
      const L = Math.hypot(nz, ny) || 1;
      nz /= L; ny /= L;
      const a = this.vertex(x0, ya, za, 0, ny, nz, c, 0, leaf);
      const b = this.vertex(x0, yb, zb, 0, ny, nz, c, 0, leaf);
      const d = this.vertex(x1, yb, zb, 0, ny, nz, c, 0, leaf);
      const e = this.vertex(x1, ya, za, 0, ny, nz, c, 0, leaf);
      this.idx.push(a, d, b, a, e, d);
    }
  }

  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number) {
    // a b
    // c d   (counter-clockwise when seen from the front)
    this.idx.push(a, c, b, b, c, d);
  }

  /** axis-aligned or transformed box (flat shaded) */
  box(m: THREE.Matrix4, c: THREE.Color, opts: { wind?: number; leaf?: number; skipBottom?: boolean; skipTop?: boolean } = {}) {
    const faces: [number[], number[]][] = [
      [[1, 0, 0], [1, -1, -1, 1, 1, -1, 1, -1, 1, 1, 1, 1]],
      [[-1, 0, 0], [-1, -1, 1, -1, 1, 1, -1, -1, -1, -1, 1, -1]],
      [[0, 1, 0], [-1, 1, -1, -1, 1, 1, 1, 1, -1, 1, 1, 1]],
      [[0, -1, 0], [-1, -1, 1, -1, -1, -1, 1, -1, 1, 1, -1, -1]],
      [[0, 0, 1], [1, -1, 1, 1, 1, 1, -1, -1, 1, -1, 1, 1]],
      [[0, 0, -1], [-1, -1, -1, -1, 1, -1, 1, -1, -1, 1, 1, -1]],
    ];
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let f = 0; f < 6; f++) {
      if (opts.skipTop && f === 2) continue;
      if (opts.skipBottom && f === 3) continue;
      const [fn, q] = faces[f];
      n.set(fn[0], fn[1], fn[2]).applyMatrix3(nm).normalize();
      const ids: number[] = [];
      for (let k = 0; k < 4; k++) {
        v.set(q[k * 3] * 0.5, q[k * 3 + 1] * 0.5, q[k * 3 + 2] * 0.5).applyMatrix4(m);
        ids.push(this.vertex(v.x, v.y, v.z, n.x, n.y, n.z, c, opts.wind ?? 0, opts.leaf ?? 0));
      }
      // quad order: 0 bottom-a, 1 top-a, 2 bottom-b, 3 top-b
      this.idx.push(ids[0], ids[1], ids[2], ids[1], ids[3], ids[2]);
    }
  }

  /**
   * Tapered tube through `path` ([x,y,z,radius] per ring). Smooth normals.
   */
  tube(path: number[][], sides: number, c: THREE.Color | ((t: number) => THREE.Color), windFn: (y: number) => number = () => 0, capTop = false) {
    const rings: number[][] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const t = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < path.length; i++) {
      const p = path[i];
      const pn = path[Math.min(path.length - 1, i + 1)];
      const pp = path[Math.max(0, i - 1)];
      t.set(pn[0] - pp[0], pn[1] - pp[1], pn[2] - pp[2]).normalize();
      a.crossVectors(Math.abs(t.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up, t).normalize();
      b.crossVectors(t, a).normalize();
      const ring: number[] = [];
      const col = typeof c === 'function' ? c(i / (path.length - 1)) : c;
      for (let s = 0; s <= sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const nx = a.x * ca + b.x * sa, ny = a.y * ca + b.y * sa, nz = a.z * ca + b.z * sa;
        const x = p[0] + nx * p[3], y = p[1] + ny * p[3], z = p[2] + nz * p[3];
        ring.push(this.vertex(x, y, z, nx, ny, nz, col, windFn(y), 0));
      }
      rings.push(ring);
    }
    for (let i = 0; i < rings.length - 1; i++)
      for (let s = 0; s < sides; s++) {
        const r0 = rings[i], r1 = rings[i + 1];
        this.idx.push(r0[s], r0[s + 1], r1[s], r0[s + 1], r1[s + 1], r1[s]);
      }
    if (capTop) {
      const p = path[path.length - 1];
      const col = typeof c === 'function' ? c(1) : c;
      const ci = this.vertex(p[0], p[1], p[2], 0, 1, 0, col, windFn(p[1]), 0);
      const r = rings[rings.length - 1];
      for (let s = 0; s < sides; s++) this.idx.push(r[s + 1], ci, r[s]);
    }
  }

  /**
   * Lumpy ellipsoid (lat-long). Normals point away from the centre (soft foliage
   * lighting). `shade(yNorm)` gives the vertical colour gradient (0 bottom … 1 top).
   */
  blob(
    cx: number, cy: number, cz: number,
    rx: number, ry: number, rz: number,
    lon: number, lat: number,
    c: THREE.Color,
    opts: { lumps?: number; seed?: number; wind?: (y: number) => number; leaf?: number; flatTop?: number; shade?: [number, number]; normalUp?: number } = {},
  ) {
    const lumps = opts.lumps ?? 0.18;
    const seed = opts.seed ?? 1;
    const [sBot, sTop] = opts.shade ?? [0.55, 1.12];
    const rowStart: number[] = [];
    const tmp = new THREE.Color();
    for (let j = 0; j <= lat; j++) {
      const v = j / lat;
      const phi = v * Math.PI; // 0 top → π bottom
      rowStart.push(this.vertexCount);
      for (let i = 0; i <= lon; i++) {
        const u = (i % lon) / lon;
        const th = u * Math.PI * 2;
        let dx = Math.sin(phi) * Math.cos(th);
        let dy = Math.cos(phi);
        let dz = Math.sin(phi) * Math.sin(th);
        const n = lumpNoise(dx * 2.3 + seed, dy * 2.3 - seed * 0.7, dz * 2.3 + seed * 1.3);
        let k = 1 + lumps * n;
        if (opts.flatTop && dy > 0) {
          dy *= 1 - opts.flatTop * dy;
        }
        const x = cx + dx * rx * k, y = cy + dy * ry * k, z = cz + dz * rz * k;
        // ellipsoid normal, nudged up so canopies read lit from the sky
        let nx = dx / rx, ny = dy / ry + (opts.normalUp ?? 0.25), nz = dz / rz;
        const L = Math.hypot(nx, ny, nz) || 1;
        nx /= L; ny /= L; nz /= L;
        const yn = 1 - v;
        const sh = sBot + (sTop - sBot) * Math.pow(yn, 0.8);
        tmp.copy(c).multiplyScalar(sh * (0.92 + 0.16 * (n * 0.5 + 0.5)));
        this.vertex(x, y, z, nx, ny, nz, tmp, opts.wind ? opts.wind(y) : 0, opts.leaf ?? 1);
      }
    }
    for (let j = 0; j < lat; j++)
      for (let i = 0; i < lon; i++) {
        const a = rowStart[j] + i, b = a + 1, c2 = rowStart[j + 1] + i, d = c2 + 1;
        this.idx.push(a, b, c2, b, d, c2);
      }
  }

  append(o: MeshBuilder) {
    const off = this.vertexCount;
    this.pos.push(...o.pos);
    this.nor.push(...o.nor);
    this.col.push(...o.col);
    this.wind.push(...o.wind);
    this.leaf.push(...o.leaf);
    this.uv.push(...o.uv);
    for (const i of o.idx) this.idx.push(i + off);
  }

  transform(m: THREE.Matrix4) {
    const v = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < this.pos.length; i += 3) {
      v.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]).applyMatrix4(m);
      this.pos[i] = v.x; this.pos[i + 1] = v.y; this.pos[i + 2] = v.z;
      v.set(this.nor[i], this.nor[i + 1], this.nor[i + 2]).applyMatrix3(nm).normalize();
      this.nor[i] = v.x; this.nor[i + 1] = v.y; this.nor[i + 2] = v.z;
    }
    return this;
  }

  geometry(withCustom = true): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (withCustom) {
      g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 1));
      g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(this.leaf, 1));
    }
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function lumpNoise(x: number, y: number, z: number): number {
  return (
    Math.sin(x * 1.7 + Math.sin(y * 2.3) * 1.1) * 0.5 +
    Math.sin(y * 2.9 + Math.sin(z * 1.9) * 1.3) * 0.3 +
    Math.sin(z * 2.1 + Math.sin(x * 2.7) * 0.9) * 0.4
  );
}

export function srgb(hex: number): THREE.Color {
  return new THREE.Color(hex);
}
