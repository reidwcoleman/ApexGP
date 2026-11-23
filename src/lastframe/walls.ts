import * as THREE from 'three';
import type { Box, World } from './collide.ts';
import type { Nav, Node } from './nav.ts';

/**
 * Walls that can be gone through. The partitions inside these buildings are studs and plasterboard (the `wall_int` boxes,
 * 14 cm thick): a charge takes a doorway-sized piece out of one anywhere there is room to stand on both sides, and a steel
 * sheet bolted on from the inside stops that.
 *
 * A site is a rectangle of wall: the wall's axis (1: it runs along x, its plane is z = c; 0: it runs along z, plane x = c),
 * the span along it (u0..u1), the height (y0..y1) and how thick the wall is. As six numbers it goes over the wire.
 *
 * Nothing here was baked for it. The hole is cut out of the building's own meshes when it happens: every triangle of the
 * shell, the joinery and the copies the shadows and the depth pass use that lies in the wall's thickness is clipped
 * against the rectangle, and what is left of it is drawn from a small patch beside the original, so the skirting stops at
 * the hole and the lightmap on what remains is the one it always had. The collider is split the same way.
 */
export interface Site {
  ax: 0 | 1;
  c: number;
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  t: number;
}

export const HOLE_W = 1.4, HOLE_H = 2.0;
const r2 = (v: number) => Math.round(v * 100) / 100;

export const siteArr = (s: Site) => [s.ax, s.c, s.u0, s.u1, s.y0, s.y1, s.t];
export function siteOf(a: number[]): Site | null {
  if (!Array.isArray(a) || a.length < 7 || a.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  return { ax: a[0] ? 1 : 0, c: a[1], u0: a[2], u1: a[3], y0: a[4], y1: a[5], t: a[6] };
}
export const siteMid = (s: Site, out = { x: 0, y: 0, z: 0 }) => {
  const u = (s.u0 + s.u1) / 2;
  out.x = s.ax ? u : s.c;
  out.z = s.ax ? s.c : u;
  out.y = s.y0;
  return out;
};
/** a point this far out from the wall on one side of it (+1 / -1 along the wall's normal) */
export const siteOut = (s: Site, side: number, d: number, out = { x: 0, y: 0, z: 0 }) => {
  siteMid(s, out);
  if (s.ax) out.z += side * (s.t / 2 + d);
  else out.x += side * (s.t / 2 + d);
  return out;
};
export const sitesTouch = (a: Site, b: Site, gap = 0.15) => a.ax === b.ax && Math.abs(a.c - b.c) < 0.3 && a.u0 < b.u1 + gap && b.u0 < a.u1 + gap && a.y0 < b.y1 && b.y0 < a.y1;

/** a partition: thin, tall, and the kind a round goes through */
export function soft(b: Box) {
  if (b.off || b.slab || b.tag !== 'int' || b.mat !== 'wall_int' || !b.pen) return false;
  const dx = b.max[0] - b.min[0], dz = b.max[2] - b.min[2];
  return Math.min(dx, dz) <= 0.3 && Math.max(dx, dz) >= HOLE_W + 0.2 && b.max[1] - b.min[1] >= 2.3;
}

function make(b: Box, uc: number, y0: number): Site | null {
  const ax: 0 | 1 = b.max[0] - b.min[0] > b.max[2] - b.min[2] ? 1 : 0;
  const lo = ax ? b.min[0] : b.min[2], hi = ax ? b.max[0] : b.max[2];
  if (hi - lo < HOLE_W + 0.2 || b.min[1] > y0 + 0.06 || b.max[1] < y0 + HOLE_H + 0.05) return null;
  const u = r2(Math.min(hi - HOLE_W / 2 - 0.1, Math.max(lo + HOLE_W / 2 + 0.1, uc)));
  const c = ax ? (b.min[2] + b.max[2]) / 2 : (b.min[0] + b.max[0]) / 2;
  const t = ax ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
  return { ax, c: r2(c), u0: r2(u - HOLE_W / 2), u1: r2(u + HOLE_W / 2), y0: r2(y0), y1: r2(y0 + HOLE_H), t: r2(t) };
}

/** room to stand on both sides of it, on a floor at its foot, and wall all the way across it */
export function siteValid(w: World, s: Site): boolean {
  if (s.u1 - s.u0 < 1 || s.u1 - s.u0 > 2 || s.y1 - s.y0 < 1.5 || s.y1 - s.y0 > 2.4 || s.t > 0.32) return false;
  const p = { x: 0, y: 0, z: 0 };
  for (const side of [-1, 1]) {
    siteOut(s, side, 0.42, p);
    if (w.blocked(p.x, s.y0 + 0.12, p.z, 0.3, 1.6)) return false;
    const f = w.floorAt(p.x, s.y0 + 0.4, p.z, 0.2, 0.05, true);
    if (Math.abs(f - s.y0) > 0.25) return false;
  }
  // wall there: three rays through it find the partition each time
  siteOut(s, -1, 0.3, p);
  const dx = s.ax ? 0 : 1, dz = s.ax ? 1 : 0;
  for (const k of [0.15, 0.5, 0.85]) {
    const u = s.u0 + (s.u1 - s.u0) * k;
    const h = w.ray(s.ax ? u : p.x, s.y0 + 1.1, s.ax ? p.z : u, dx, 0, dz, 0.5, false, true);
    if (!h || !soft(h.box)) return false;
  }
  return true;
}

/** the piece of wall someone is looking at from where they stand (feet at fy), if a hole would go there */
export function siteAt(w: World, ex: number, ey: number, ez: number, dx: number, dy: number, dz: number, fy: number, taken: Site[]): Site | null {
  const h = w.ray(ex, ey, ez, dx, dy, dz, 2.3, false, true);
  if (!h || !soft(h.box) || Math.abs(h.ny) > 0.3) return null;
  const b = h.box;
  const alongX = b.max[0] - b.min[0] > b.max[2] - b.min[2];
  const s = make(b, alongX ? ex + dx * h.t : ez + dz * h.t, fy);
  if (!s || taken.some((q) => sitesTouch(q, s)) || !siteValid(w, s)) return null;
  return s;
}

/** places in a room's walls a hole could go: for those who plan (the bots) */
export function sitesAround(w: World, box: number[], doors: { x: number; z: number }[], max = 8): Site[] {
  const out: Site[] = [];
  const y0 = box[1];
  for (const b of w.boxes) {
    if (!soft(b)) continue;
    const alongX = b.max[0] - b.min[0] > b.max[2] - b.min[2];
    const c = alongX ? (b.min[2] + b.max[2]) / 2 : (b.min[0] + b.max[0]) / 2;
    // one of the room's four walls
    const edge = alongX ? (Math.abs(c - box[2]) < 0.45 || Math.abs(c - box[5]) < 0.45) : (Math.abs(c - box[0]) < 0.45 || Math.abs(c - box[3]) < 0.45);
    if (!edge) continue;
    const lo = Math.max(alongX ? b.min[0] : b.min[2], alongX ? box[0] : box[2]) + 0.25, hi = Math.min(alongX ? b.max[0] : b.max[2], alongX ? box[3] : box[5]) - 0.25;
    for (let u = lo + HOLE_W / 2; u <= hi - HOLE_W / 2; u += 0.5) {
      const s = make(b, u, y0);
      if (!s || out.some((q) => sitesTouch(q, s, 2.2))) continue;
      const m = siteMid(s);
      if (doors.some((d) => Math.hypot(d.x - m.x, d.z - m.z) < 2.4) || !siteValid(w, s)) continue;
      out.push(s);
      if (out.length >= max) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- cutting

interface Region { ax: 0 | 1; c0: number; c1: number; u0: number; u1: number; y0: number; y1: number }
interface Cut { geo: THREE.BufferGeometry; saved: number[]; patch: THREE.Mesh | null; indexed: boolean }

const IDENT = new THREE.Matrix4();

/** take the region out of one mesh: its triangles in the wall's thickness are clipped to what lies outside the rectangle */
function cutMesh(mesh: THREE.Mesh, R: Region): Cut | null {
  const geo = mesh.geometry, pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || (pos as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return null;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const wLo = R.ax ? bb.min.z : bb.min.x, wHi = R.ax ? bb.max.z : bb.max.x, uLo = R.ax ? bb.min.x : bb.min.z, uHi = R.ax ? bb.max.x : bb.max.z;
  if (wHi < R.c0 || wLo > R.c1 || uHi < R.u0 || uLo > R.u1 || bb.max.y < R.y0 || bb.min.y > R.y1) return null;
  const names = Object.keys(geo.attributes).filter((n) => !(geo.attributes[n] as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute);
  const attrs = names.map((n) => geo.attributes[n] as THREE.BufferAttribute);
  const sizes = attrs.map((a) => a.itemSize);
  const width = sizes.reduce((a, b) => a + b, 0);
  const pOff = sizes.slice(0, names.indexOf('position')).reduce((a, b) => a + b, 0);
  const iw = pOff + (R.ax ? 2 : 0), iu = pOff + (R.ax ? 0 : 2), iy = pOff + 1;
  const index = geo.index;
  const n = index ? index.count / 3 : pos.count / 3;
  const P = pos.array as ArrayLike<number>;
  const saved: number[] = [];
  const out: number[][] = [];
  const read = (v: number): number[] => {
    const r = new Array<number>(width);
    let o = 0;
    for (let a = 0; a < attrs.length; a++) {
      const arr = attrs[a].array as ArrayLike<number>, sz = sizes[a];
      for (let k = 0; k < sz; k++) r[o++] = arr[v * sz + k];
    }
    return r;
  };
  /** the part of a polygon where coordinate i is on the keep side of v */
  const clip = (poly: number[][], i: number, v: number, keepLess: boolean): number[][] => {
    const res: number[][] = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      const ia = keepLess ? a[i] <= v : a[i] >= v, ib = keepLess ? b[i] <= v : b[i] >= v;
      if (ia) res.push(a);
      if (ia !== ib) {
        const f = (v - a[i]) / (b[i] - a[i]);
        res.push(a.map((x, q) => x + (b[q] - x) * f));
      }
    }
    return res;
  };
  for (let t = 0; t < n; t++) {
    const a = index ? index.getX(t * 3) : t * 3, b = index ? index.getX(t * 3 + 1) : t * 3 + 1, c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    if (a === b && b === c) continue;
    const wi = R.ax ? 2 : 0, ui = R.ax ? 0 : 2;
    const aw = P[a * 3 + wi], bw = P[b * 3 + wi], cw = P[c * 3 + wi];
    if (aw < R.c0 || aw > R.c1 || bw < R.c0 || bw > R.c1 || cw < R.c0 || cw > R.c1) continue;
    const au = P[a * 3 + ui], bu = P[b * 3 + ui], cu = P[c * 3 + ui];
    if (Math.max(au, bu, cu) <= R.u0 || Math.min(au, bu, cu) >= R.u1) continue;
    const ay = P[a * 3 + 1], by = P[b * 3 + 1], cy = P[c * 3 + 1];
    if (Math.max(ay, by, cy) <= R.y0 || Math.min(ay, by, cy) >= R.y1) continue;
    // this one goes; what is left of it comes back as pieces
    if (index) {
      saved.push(t, a, b, c);
      index.setX(t * 3 + 1, a);
      index.setX(t * 3 + 2, a);
    } else {
      saved.push(t, P[a * 3], P[a * 3 + 1], P[a * 3 + 2], P[b * 3], P[b * 3 + 1], P[b * 3 + 2], P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
      pos.setXYZ(b, P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
      pos.setXYZ(c, P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
    }
    let rest = [read(a), read(b), read(c)];
    if (!index) {
      // (read after the write above would be wrong for a bare triangle: put the corners back in the copy)
      const s = saved.slice(-9);
      rest[1][pOff] = s[3]; rest[1][pOff + 1] = s[4]; rest[1][pOff + 2] = s[5];
      rest[2][pOff] = s[6]; rest[2][pOff + 1] = s[7]; rest[2][pOff + 2] = s[8];
    }
    const pieces: number[][][] = [];
    pieces.push(clip(rest, iu, R.u0, true));
    rest = clip(rest, iu, R.u0, false);
    pieces.push(clip(rest, iu, R.u1, false));
    rest = clip(rest, iu, R.u1, true);
    pieces.push(clip(rest, iy, R.y1, false));
    rest = clip(rest, iy, R.y1, true);
    pieces.push(clip(rest, iy, R.y0, true));
    void iw;
    for (const poly of pieces) for (let k = 1; k + 1 < poly.length; k++) {
      const [p0, p1, p2] = [poly[0], poly[k], poly[k + 1]];
      const ex = p1[pOff] - p0[pOff], ey = p1[pOff + 1] - p0[pOff + 1], ez = p1[pOff + 2] - p0[pOff + 2];
      const fx = p2[pOff] - p0[pOff], fy = p2[pOff + 1] - p0[pOff + 1], fz = p2[pOff + 2] - p0[pOff + 2];
      if (Math.hypot(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx) < 1e-7) continue;
      out.push(p0, p1, p2);
    }
  }
  if (!saved.length) return null;
  if (index) index.needsUpdate = true;
  else pos.needsUpdate = true;
  let patch: THREE.Mesh | null = null;
  if (out.length) {
    const g = new THREE.BufferGeometry();
    let o = 0;
    for (let a = 0; a < attrs.length; a++) {
      const src = attrs[a], sz = sizes[a];
      const Ctor = (src.array as unknown as { constructor: new (n: number) => THREE.TypedArray }).constructor;
      const arr = new Ctor(out.length * sz);
      const whole = !(arr instanceof Float32Array);
      for (let v = 0; v < out.length; v++) for (let k = 0; k < sz; k++) arr[v * sz + k] = whole ? Math.round(out[v][o + k]) : out[v][o + k];
      g.setAttribute(names[a], new THREE.BufferAttribute(arr, sz, src.normalized));
      o += sz;
    }
    g.computeBoundingSphere();
    g.computeBoundingBox();
    patch = new THREE.Mesh(g, mesh.material);
    patch.name = mesh.name;
    patch.userData = { ...mesh.userData, patch: true };
    patch.layers.mask = mesh.layers.mask;
    patch.castShadow = mesh.castShadow;
    patch.receiveShadow = mesh.receiveShadow;
    patch.renderOrder = mesh.renderOrder;
    patch.frustumCulled = false;
    patch.matrixAutoUpdate = false;
    (mesh.parent ?? mesh).add(patch);
  }
  return { geo, saved, patch, indexed: !!index };
}

function undo(c: Cut) {
  const s = c.saved;
  if (c.indexed) {
    const ix = c.geo.index!;
    for (let k = 0; k < s.length; k += 4) {
      ix.setX(s[k] * 3 + 1, s[k + 2]);
      ix.setX(s[k] * 3 + 2, s[k + 3]);
    }
    ix.needsUpdate = true;
  } else {
    const p = c.geo.getAttribute('position') as THREE.BufferAttribute;
    for (let k = 0; k < s.length; k += 10) {
      p.setXYZ(s[k] * 3 + 1, s[k + 4], s[k + 5], s[k + 6]);
      p.setXYZ(s[k] * 3 + 2, s[k + 7], s[k + 8], s[k + 9]);
    }
    p.needsUpdate = true;
  }
  if (c.patch) {
    c.patch.parent?.remove(c.patch);
    c.patch.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------------------------------- what it looks like

const rnd = (seed: number) => {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

function boxAt(list: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  list.push(g);
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of list) n += g.index ? g.index.count : g.getAttribute('position').count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of list) {
    const p = g.getAttribute('position'), nn = g.getAttribute('normal'), u = g.getAttribute('uv'), ix = g.index;
    const cnt = ix ? ix.count : p.count;
    for (let i = 0; i < cnt; i++) {
      const v = ix ? ix.getX(i) : i;
      pos[o * 3] = p.getX(v); pos[o * 3 + 1] = p.getY(v); pos[o * 3 + 2] = p.getZ(v);
      nor[o * 3] = nn.getX(v); nor[o * 3 + 1] = nn.getY(v); nor[o * 3 + 2] = nn.getZ(v);
      if (u) { uv[o * 2] = u.getX(v); uv[o * 2 + 1] = u.getY(v); }
      o++;
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

export interface WallMats { plaster: THREE.Material; timber: THREE.Material; steel: THREE.Material; rail: THREE.Material }

/** the hole dressed: the studs it was cut between, the torn edge of the board on both faces, and what fell out of it */
function holeModel(s: Site, dir: number, mats: WallMats): THREE.Group {
  const g = new THREE.Group();
  const R = rnd(Math.round(s.c * 31 + s.u0 * 17 + s.y0 * 7));
  const W = s.u1 - s.u0, H = s.y1 - s.y0, T = s.t;
  // built with the wall along x and its normal along z, then turned
  const timber: THREE.BufferGeometry[] = [], board: THREE.BufferGeometry[] = [];
  const depth = T - 0.03;
  boxAt(timber, 0.045, H, depth, -W / 2 + 0.0225, H / 2, 0);
  boxAt(timber, 0.045, H, depth, W / 2 - 0.0225, H / 2, 0);
  boxAt(timber, W, 0.045, depth, 0, H - 0.0225, 0);
  boxAt(timber, W - 0.09, 0.035, depth, 0, 0.0175, 0);
  // the stud that stood in the middle: its foot still nailed to the plate, its top hanging, the rest across the floor
  const mx = (R() - 0.5) * 0.3;
  boxAt(timber, 0.045, 0.22 + R() * 0.2, depth * 0.9, mx, 0.14, 0, 0, 0, (R() - 0.5) * 0.5);
  boxAt(timber, 0.045, 0.3 + R() * 0.25, depth * 0.9, mx + 0.04, H - 0.2, dir * 0.03, dir * 0.25, 0, (R() - 0.5) * 0.4);
  boxAt(timber, 0.045, 0.045, 0.7 + R() * 0.4, mx + (R() - 0.5) * 0.5, 0.03, dir * (0.55 + R() * 0.4), 0, (R() - 0.5) * 1.2, 0);
  // the board's edge, torn: a ragged band of it left standing in from the cut on both faces, a few flaps hanging further
  const band = (face: number, ax: number, ay: number, bx: number, by: number, inx: number, iny: number) => {
    const len = Math.hypot(bx - ax, by - ay), z = face * (T / 2 - 0.006);
    const pts: number[][] = [];
    let d = 0.015 + R() * 0.03;
    for (let t = 0; t < len;) {
      // mostly a centimetre or three of broken edge; now and then a tongue of board that held
      d = Math.max(0.006, Math.min(0.075, d + (R() - 0.5) * 0.045));
      const tongue = R() < 0.1 ? 0.09 + R() * 0.2 : 0;
      const k = t / len;
      pts.push([ax + (bx - ax) * k, ay + (by - ay) * k, d + tongue, tongue ? face * (R() - 0.35) * 0.07 * (dir * face > 0 ? 1.5 : 0.5) : 0]);
      t += 0.035 + R() * 0.075;
    }
    pts.push([bx, by, 0.01, 0]);
    const pos: number[] = [], nor: number[] = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const [x0, y0, d0, b0] = pts[k], [x1, y1, d1, b1] = pts[k + 1];
      const q = [[x0, y0, z], [x1, y1, z], [x1 + inx * d1, y1 + iny * d1, z + b1], [x0 + inx * d0, y0 + iny * d0, z + b0]];
      for (const t of [0, 1, 2, 0, 2, 3]) pos.push(q[t][0], q[t][1], q[t][2]);
      for (const t of [0, 2, 1, 0, 3, 2]) pos.push(q[t][0], q[t][1], q[t][2] - face * 0.0125);
      for (let n = 0; n < 6; n++) nor.push(0, 0, face);
      for (let n = 0; n < 6; n++) nor.push(0, 0, -face);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    gg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
    gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    board.push(gg);
  };
  for (const face of [-1, 1]) {
    band(face, -W / 2, 0, -W / 2, H, 1, 0);
    band(face, W / 2, H, W / 2, 0, -1, 0);
    band(face, -W / 2, H, W / 2, H, 0, -1);
  }
  // on the floor: most of it went the way the blast did
  for (let k = 0; k < 34; k++) {
    const far = R() < 0.75 ? dir : -dir, out = 0.15 + R() * R() * 1.9;
    const flat = R() < 0.6;
    const a = flat ? 0.1 + R() * 0.26 : 0.03 + R() * 0.07, b = flat ? 0.0125 : 0.03 + R() * 0.05, c = flat ? 0.07 + R() * 0.2 : 0.03 + R() * 0.07;
    boxAt(board, a, b, c, (R() - 0.5) * (W + out * 0.8), b / 2 + 0.002 + (flat && R() < 0.3 ? 0.012 : 0), far * out, flat ? (R() - 0.5) * 0.12 : R() * 3, R() * 6.28, flat ? (R() - 0.5) * 0.12 : R() * 3);
  }
  const tm = new THREE.Mesh(merge(timber), mats.timber), bm = new THREE.Mesh(merge(board), mats.plaster);
  for (const m of [tm, bm]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  const mid = siteMid(s);
  g.position.set(mid.x, s.y0, mid.z);
  if (!s.ax) g.rotation.y = -Math.PI / 2;
  g.updateMatrixWorld(true);
  return g;
}

/** two steel sheets in a frame of box section, braced corner to corner and bolted across the wall from one side */
function sheetModel(s: Site, side: number, mat: THREE.Material, railMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const W = s.u1 - s.u0 + 0.3, H = s.y1 - s.y0 + 0.12;
  const list: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
  const z = side * (s.t / 2 + 0.03);
  boxAt(list, W / 2 - 0.008, H, 0.012, -W / 4, H / 2, z);
  boxAt(list, W / 2 - 0.008, H, 0.012, W / 4, H / 2, z);
  // the frame: three rails across, a post at each edge and one over the join
  for (const y of [0.16, H * 0.5, H - 0.16]) boxAt(rails, W + 0.08, 0.06, 0.05, 0, y, z + side * 0.031);
  for (const x of [-W / 2 + 0.03, 0, W / 2 - 0.03]) boxAt(rails, 0.06, H, 0.04, x, H / 2, z + side * 0.026);
  // a brace across each sheet, bottom outside corner to top middle
  const bl = Math.hypot(W / 2 - 0.1, H - 0.4), ba = Math.atan2(W / 2 - 0.1, H - 0.4);
  boxAt(rails, 0.045, bl, 0.03, -W / 4, H / 2, z + side * 0.02, 0, 0, -ba);
  boxAt(rails, 0.045, bl, 0.03, W / 4, H / 2, z + side * 0.02, 0, 0, ba);
  // feet out on the floor, a strut from each up to the middle rail, and the bolt heads
  for (const x of [-W / 2 + 0.12, W / 2 - 0.12]) {
    boxAt(rails, 0.1, 0.025, 0.42, x, 0.0125, z + side * 0.24);
    const sl = Math.hypot(0.4, H * 0.5);
    boxAt(rails, 0.035, sl, 0.035, x, H * 0.25, z + side * 0.23, side * Math.atan2(0.4, H * 0.5), 0, 0);
  }
  for (const y of [0.16, H * 0.5, H - 0.16]) for (const x of [-W / 2 + 0.03, -W / 4, 0, W / 4, W / 2 - 0.03]) boxAt(list, 0.032, 0.032, 0.016, x, y, z + side * 0.062, 0, 0, 0.785);
  const rm = new THREE.Mesh(merge(rails), railMat);
  rm.castShadow = true;
  rm.receiveShadow = true;
  const m = new THREE.Mesh(merge(list), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  // it is walked up from leaning: the mesh turns about the foot of the wall
  const hold = new THREE.Group();
  hold.add(m, rm);
  hold.rotation.x = side * 0.75;
  hold.userData.swing = side * 0.75;
  g.add(hold);
  const mid = siteMid(s);
  g.position.set(mid.x, s.y0, mid.z);
  if (!s.ax) g.rotation.y = -Math.PI / 2;
  g.updateMatrixWorld(true);
  return g;
}

const CH_BODY = new THREE.MeshStandardMaterial({ color: 0x2a2d24, roughness: 0.75 });
const CH_TAPE = new THREE.MeshStandardMaterial({ color: 0x8a8a84, roughness: 0.6 });
const CH_LED = new THREE.MeshBasicMaterial({ color: 0xff3020 });

/** a breaching charge: a frame of cutting strip taped flat, the firing box in the middle of it with its light on.
 *  Built facing +z, standing with its foot at y = 0 */
export function chargeMesh(w = 0.5, h = 0.72): THREE.Group {
  const g = new THREE.Group();
  const list: THREE.BufferGeometry[] = [], tape: THREE.BufferGeometry[] = [];
  boxAt(list, w, 0.045, 0.022, 0, h, 0);
  boxAt(list, w, 0.045, 0.022, 0, 0, 0);
  boxAt(list, 0.045, h, 0.022, -w / 2, h / 2, 0);
  boxAt(list, 0.045, h, 0.022, w / 2, h / 2, 0);
  boxAt(list, 0.03, Math.hypot(w, h), 0.016, 0, h / 2, 0, 0, 0, Math.atan2(w, h));
  boxAt(list, 0.11, 0.075, 0.04, 0, h / 2, 0.02);
  for (const [x, y] of [[-w / 2, h * 0.25], [w / 2, h * 0.75], [-w * 0.2, h], [w * 0.2, 0]]) boxAt(tape, 0.09, 0.05, 0.004, x, y, 0.013, 0, 0, (x + y) * 3);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 6), CH_LED);
  led.position.set(0.035, h / 2 + 0.02, 0.042);
  g.add(new THREE.Mesh(merge(list), CH_BODY), new THREE.Mesh(merge(tape), CH_TAPE), led);
  return g;
}

/** a charge taped to a wall */
export function chargeModel(s: Site, side: number): THREE.Group {
  const m = chargeMesh();
  const p = siteOut(s, side, 0.012);
  m.position.set(p.x, s.y0 + 0.75, p.z);
  m.rotation.y = s.ax ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
  return m;
}

// ---------------------------------------------------------------------------------------------------- the walls of one building

interface Hole { s: Site; cuts: Cut[]; off: Box[]; added: Box[]; model: THREE.Group; link: [Node, Node] | null }

export class Walls {
  readonly holes: Hole[] = [];
  readonly sheets: { s: Site; side: number; model: THREE.Group; box: Box }[] = [];

  constructor(private world: World, private nav: Nav, private roots: THREE.Object3D[], private scene: THREE.Object3D, readonly mats: WallMats) {}

  /** every hole and every sheet, as sites: what a new one must keep clear of */
  taken(): Site[] {
    return [...this.holes.map((h) => h.s), ...this.sheets.map((h) => h.s)];
  }

  /** blow it out. dir: the side the blast went to (+1 / -1 along the wall's normal) */
  hole(s: Site, dir: number) {
    if (this.holes.some((h) => sitesTouch(h.s, s, -0.05))) return;
    const w = this.world;
    // ---- what stops a body
    const off: Box[] = [], added: Box[] = [];
    const wi = s.ax ? 2 : 0, ui = s.ax ? 0 : 2;
    for (const b of [...w.boxes]) {
      if (b.off || b.slab || (b.tag !== 'int' && b.tag !== 'reinf')) continue;
      if (b.max[wi] < s.c - s.t / 2 - 0.02 || b.min[wi] > s.c + s.t / 2 + 0.02 || b.max[ui] <= s.u0 || b.min[ui] >= s.u1 || b.max[1] <= s.y0 || b.min[1] >= s.y1) continue;
      if (b.max[wi] - b.min[wi] > 0.34) continue;
      b.off = true;
      off.push(b);
      const piece = (u0: number, u1: number, y0: number, y1: number) => {
        if (u1 - u0 < 0.02 || y1 - y0 < 0.02) return;
        const q: Box = { ...b, min: [...b.min] as [number, number, number], max: [...b.max] as [number, number, number], off: false };
        q.min[ui] = u0; q.max[ui] = u1; q.min[1] = y0; q.max[1] = y1;
        w.add(q);
        added.push(q);
      };
      piece(b.min[ui], Math.min(b.max[ui], s.u0), b.min[1], b.max[1]);
      piece(Math.max(b.min[ui], s.u1), b.max[ui], b.min[1], b.max[1]);
      const m0 = Math.max(b.min[ui], s.u0), m1 = Math.min(b.max[ui], s.u1);
      piece(m0, m1, Math.max(b.min[1], s.y1), b.max[1]);
      piece(m0, m1, b.min[1], Math.min(b.max[1], s.y0));
    }
    // ---- what is drawn, and what the shadows and the depth pass are drawn from
    const R: Region = { ax: s.ax, c0: s.c - s.t / 2 - 0.1, c1: s.c + s.t / 2 + 0.1, u0: s.u0, u1: s.u1, y0: s.y0 - 0.02, y1: s.y1 };
    const cuts: Cut[] = [];
    const todo: THREE.Mesh[] = [];
    for (const root of this.roots) root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh || (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh || m.userData.patch) return;
      if (!(m.userData.arch || m.userData.small || root.name === 'casters')) return;
      if (!m.matrixWorld.equals(IDENT)) return;
      todo.push(m);
    });
    for (const m of todo) {
      const c = cutMesh(m, R);
      if (c) cuts.push(c);
    }
    const model = holeModel(s, dir, this.mats);
    this.scene.add(model);
    // ---- and a way through for those who walk by the map
    const a = siteOut(s, -1, 0.6), b = siteOut(s, 1, 0.6);
    const na = this.nav.nearest(a.x, s.y0, a.z), nb = this.nav.nearest(b.x, s.y0, b.z);
    let link: [Node, Node] | null = null;
    const sideOf = (n: Node) => Math.sign((s.ax ? n.z : n.x) - s.c);
    if (na && nb && na !== nb && sideOf(na) < 0 && sideOf(nb) > 0 && Math.hypot(na.x - a.x, na.z - a.z) < 1.5 && Math.hypot(nb.x - b.x, nb.z - b.z) < 1.5 && Math.abs(na.y - s.y0) < 0.6 && Math.abs(nb.y - s.y0) < 0.6) {
      if (!na.next.includes(nb.i)) na.next.push(nb.i);
      if (!nb.next.includes(na.i)) nb.next.push(na.i);
      link = [na, nb];
    }
    this.holes.push({ s, cuts, off, added, model, link });
    // a sheet over the same piece of wall goes with it
    for (let k = this.sheets.length - 1; k >= 0; k--) if (sitesTouch(this.sheets[k].s, s, -0.05)) this.dropSheet(k);
  }

  reinforce(s: Site, side: number) {
    if (this.sheets.some((h) => sitesTouch(h.s, s, -0.05)) || this.holes.some((h) => sitesTouch(h.s, s, -0.05))) return;
    const model = sheetModel(s, side, this.mats.steel, this.mats.rail);
    this.scene.add(model);
    const z0 = s.c + side * (s.t / 2 + 0.005), z1 = s.c + side * (s.t / 2 + 0.05);
    const lo = Math.min(z0, z1), hi = Math.max(z0, z1);
    const box: Box = s.ax
      ? { min: [s.u0 - 0.15, s.y0, lo], max: [s.u1 + 0.15, s.y1 + 0.12, hi], pen: false, tag: 'reinf', mat: 'steel' }
      : { min: [lo, s.y0, s.u0 - 0.15], max: [hi, s.y1 + 0.12, s.u1 + 0.15], pen: false, tag: 'reinf', mat: 'steel' };
    this.world.add(box);
    this.sheets.push({ s, side, model, box });
  }

  sheeted(s: Site) {
    return this.sheets.some((h) => sitesTouch(h.s, s, 0));
  }

  /** sheets still being stood up */
  update(dt: number) {
    for (const h of this.sheets) {
      const m = h.model.children[0];
      const a = m.userData.swing as number;
      if (!a) continue;
      const n = Math.abs(a) < 0.01 ? 0 : a * Math.max(0, 1 - dt * 9);
      m.userData.swing = n;
      m.rotation.x = n;
    }
  }

  private dropSheet(k: number) {
    const h = this.sheets[k];
    h.box.off = true;
    this.scene.remove(h.model);
    h.model.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.sheets.splice(k, 1);
  }

  /** the building as it was */
  reset() {
    for (const h of this.holes) {
      for (const c of h.cuts) undo(c);
      for (const b of h.added) b.off = true;
      for (const b of h.off) b.off = false;
      this.scene.remove(h.model);
      h.model.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      if (h.link) {
        const [a, b] = h.link;
        a.next = a.next.filter((k) => k !== b.i);
        b.next = b.next.filter((k) => k !== a.i);
      }
    }
    this.holes.length = 0;
    while (this.sheets.length) this.dropSheet(this.sheets.length - 1);
  }
}
