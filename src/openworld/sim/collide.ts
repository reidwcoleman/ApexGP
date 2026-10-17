import type { P2 } from '../geo.ts';

/**
 * Static collision: every building part as a convex footprint with a height range, street
 * furniture (lamp posts, palms, signal poles) as circles. A uniform grid answers "what is near";
 * the narrow phase is SAT between a vehicle's oriented box and a convex polygon, or box vs circle.
 */

export interface Solid {
  poly: P2[];
  y0: number;
  y1: number;
  cx: number;
  cz: number;
  r: number;
  /** a circle (props) when poly is empty */
  circle?: number;
  /** what it is (sound / damage) */
  kind?: 'building' | 'pole' | 'palm' | 'barrier';
  /** a prop that can be knocked over (index into the props list) */
  prop?: number;
}

export interface Contact {
  /** push-out direction (unit, xz) and depth */
  nx: number;
  nz: number;
  depth: number;
  /** contact point (world) */
  px: number;
  pz: number;
  solid: Solid;
}

export class CollisionWorld {
  readonly cell = 48;
  private grid = new Map<number, Solid[]>();
  readonly solids: Solid[] = [];

  add(s: Solid) {
    this.solids.push(s);
    const C = this.cell;
    const i0 = Math.floor((s.cx - s.r) / C), i1 = Math.floor((s.cx + s.r) / C);
    const j0 = Math.floor((s.cz - s.r) / C), j1 = Math.floor((s.cz + s.r) / C);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const k = i * 73856093 ^ j * 19349663;
        let l = this.grid.get(k);
        if (!l) this.grid.set(k, (l = []));
        l.push(s);
      }
  }

  remove(s: Solid) {
    const C = this.cell;
    const i0 = Math.floor((s.cx - s.r) / C), i1 = Math.floor((s.cx + s.r) / C);
    const j0 = Math.floor((s.cz - s.r) / C), j1 = Math.floor((s.cz + s.r) / C);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const l = this.grid.get(i * 73856093 ^ j * 19349663);
        if (!l) continue;
        const at = l.indexOf(s);
        if (at >= 0) l.splice(at, 1);
      }
  }

  /** solids whose cells overlap a circle */
  query(x: number, z: number, r: number, out: Solid[]): Solid[] {
    out.length = 0;
    const C = this.cell;
    const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C);
    const j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const l = this.grid.get(i * 73856093 ^ j * 19349663);
        if (!l) continue;
        for (const s of l) if (!out.includes(s) && Math.hypot(s.cx - x, s.cz - z) < s.r + r) out.push(s);
      }
    return out;
  }

  private near: Solid[] = [];
  private box: P2[] = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];

  /**
   * Contacts of an oriented box (centre x, z; heading yaw: forward = (sin, cos); half length hl,
   * half width hw; spanning heights y0..y1) with the static world.
   */
  boxContacts(x: number, z: number, yaw: number, hl: number, hw: number, y0: number, y1: number, out: Contact[]): Contact[] {
    out.length = 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const lx = fz, lz = -fx;
    const B = this.box;
    B[0].x = x + fx * hl + lx * hw;
    B[0].z = z + fz * hl + lz * hw;
    B[1].x = x + fx * hl - lx * hw;
    B[1].z = z + fz * hl - lz * hw;
    B[2].x = x - fx * hl - lx * hw;
    B[2].z = z - fz * hl - lz * hw;
    B[3].x = x - fx * hl + lx * hw;
    B[3].z = z - fz * hl + lz * hw;
    const R = Math.hypot(hl, hw);
    for (const s of this.query(x, z, R + 2, this.near)) {
      if (y1 < s.y0 || y0 > s.y1) continue;
      if (s.circle !== undefined) {
        // box vs circle: closest point on the box to the centre
        const dx = s.cx - x, dz = s.cz - z;
        const lf = dx * fx + dz * fz, ll = dx * lx + dz * lz;
        const cf = Math.max(-hl, Math.min(hl, lf)), cl = Math.max(-hw, Math.min(hw, ll));
        const qx = x + fx * cf + lx * cl, qz = z + fz * cf + lz * cl;
        let nx = qx - s.cx, nz = qz - s.cz;
        const d = Math.hypot(nx, nz);
        if (d >= s.circle) continue;
        if (d < 1e-4) {
          nx = -dx;
          nz = -dz;
        }
        const l = Math.hypot(nx, nz) || 1;
        out.push({ nx: nx / l, nz: nz / l, depth: s.circle - d, px: qx, pz: qz, solid: s });
        continue;
      }
      const c = satBoxPoly(B, s.poly);
      if (c) out.push({ ...c, solid: s });
    }
    return out;
  }

  /** a point/sphere test (people, the camera): push-out for a circle of radius r at height y */
  circleContacts(x: number, z: number, r: number, y: number, out: Contact[]): Contact[] {
    out.length = 0;
    for (const s of this.query(x, z, r + 1, this.near)) {
      if (y < s.y0 - 0.1 || y > s.y1) continue;
      if (s.circle !== undefined) {
        const dx = x - s.cx, dz = z - s.cz;
        const d = Math.hypot(dx, dz);
        if (d >= s.circle + r) continue;
        out.push({ nx: dx / (d || 1), nz: dz / (d || 1), depth: s.circle + r - d, px: x, pz: z, solid: s });
        continue;
      }
      // circle vs convex polygon: inside test + nearest edge
      const P = s.poly;
      let inside = true;
      let best = Infinity, bnx = 0, bnz = 0;
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        const ex = b.x - a.x, ez = b.z - a.z;
        const el = Math.hypot(ex, ez) || 1;
        // outward normal for a convex hull from the monotone chain (counter-clockwise in x/z)
        const nx = ez / el, nz = -ex / el;
        const dist = (x - a.x) * nx + (z - a.z) * nz;
        if (dist > r) {
          inside = false;
          break;
        }
        const pen = r - dist;
        if (pen < best) {
          best = pen;
          bnx = nx;
          bnz = nz;
        }
      }
      if (inside && best < Infinity) out.push({ nx: bnx, nz: bnz, depth: best, px: x, pz: z, solid: s });
    }
    return out;
  }

  /** does the segment a→b (at height y) pass through a solid? (line of sight, camera) */
  segmentHits(ax: number, az: number, bx: number, bz: number, y: number): number {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    const r = Math.hypot(bx - ax, bz - az) / 2;
    let tMin = 1;
    for (const s of this.query(mx, mz, r + 1, this.near)) {
      if (y < s.y0 || y > s.y1) continue;
      if (s.circle !== undefined) continue;
      const t = segPoly(ax, az, bx, bz, s.poly);
      if (t < tMin) tMin = t;
    }
    return tMin;
  }
}

/** SAT: box corners B (4) vs convex polygon P; the minimum push for the box */
function satBoxPoly(B: P2[], P: P2[]): { nx: number; nz: number; depth: number; px: number; pz: number } | null {
  let best = Infinity, bx = 0, bz = 0;
  const test = (ax: number, az: number): boolean => {
    const l = Math.hypot(ax, az);
    if (l < 1e-9) return true;
    ax /= l;
    az /= l;
    let bmin = Infinity, bmax = -Infinity, pmin = Infinity, pmax = -Infinity;
    for (const q of B) {
      const d = q.x * ax + q.z * az;
      if (d < bmin) bmin = d;
      if (d > bmax) bmax = d;
    }
    for (const q of P) {
      const d = q.x * ax + q.z * az;
      if (d < pmin) pmin = d;
      if (d > pmax) pmax = d;
    }
    const o = Math.min(bmax - pmin, pmax - bmin);
    if (o <= 0) return false;
    if (o < best) {
      best = o;
      // push the box away from the polygon along this axis
      const bc = (bmin + bmax) / 2, pc = (pmin + pmax) / 2;
      const s = bc >= pc ? 1 : -1;
      bx = ax * s;
      bz = az * s;
    }
    return true;
  };
  if (!test(B[1].x - B[0].x, B[1].z - B[0].z)) return null;
  if (!test(B[2].x - B[1].x, B[2].z - B[1].z)) return null;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if (!test(-(b.z - a.z), b.x - a.x)) return null;
  }
  // contact point: the box corner deepest along -n
  let px = B[0].x, pz = B[0].z, dmin = Infinity;
  for (const q of B) {
    const d = q.x * bx + q.z * bz;
    if (d < dmin) {
      dmin = d;
      px = q.x;
      pz = q.z;
    }
  }
  return { nx: bx, nz: bz, depth: best, px, pz };
}

/** first hit parameter (0..1) of segment a→b with a convex polygon, 1 if none */
function segPoly(ax: number, az: number, bx: number, bz: number, P: P2[]): number {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const ex = b.x - a.x, ez = b.z - a.z;
    // outward normal (counter-clockwise hull)
    const nx = ez, nz = -ex;
    const num = (a.x - ax) * nx + (a.z - az) * nz;
    const den = dx * nx + dz * nz;
    if (Math.abs(den) < 1e-9) {
      if (num < 0) return 1;
      continue;
    }
    const t = num / den;
    if (den < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return 1;
  }
  return t0;
}
