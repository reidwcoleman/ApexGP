/** The world as axis-aligned boxes: what stops you and what stops a bullet. */
export interface Box {
  min: [number, number, number];
  max: [number, number, number];
  /** a bullet goes through (drywall, doors, cartons) */
  pen: boolean;
  tag: string;
  mat: string;
  /** a door or pane can switch itself off */
  off?: boolean;
  id?: number;
  /** a slab turning about a hinge: from (x, z) along (ux, uz) for len, half thick t. min/max stay its bounds */
  slab?: { x: number; z: number; ux: number; uz: number; len: number; t: number };
  /** someone walked into it at this speed */
  bump?: (px: number, pz: number, vx: number, vz: number) => void;
}

export interface Hit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  box: Box;
}

const CELL = 3;

export class World {
  boxes: Box[] = [];
  private grid = new Map<number, Box[]>();
  /** moving things (doors) */
  dyn: Box[] = [];
  private stamp = 0;
  private seen = new Map<Box, number>();

  add(b: Box) {
    this.boxes.push(b);
    const x0 = Math.floor(b.min[0] / CELL), x1 = Math.floor(b.max[0] / CELL), z0 = Math.floor(b.min[2] / CELL), z1 = Math.floor(b.max[2] / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 4096 + j;
      let c = this.grid.get(k);
      if (!c) this.grid.set(k, (c = []));
      c.push(b);
    }
  }

  /** would a body of half-width r from foot y to y+h at (x,z) touch anything */
  blocked(x: number, y: number, z: number, r: number, h: number): boolean {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const c = this.grid.get(i * 4096 + j);
      if (c) for (const b of c) if (hitsBody(b, x, y, z, r, h)) return true;
    }
    for (const b of this.dyn) if (hitsBody(b, x, y, z, r, h)) return true;
    return false;
  }

  /** the same, without what moves */
  blockedStatic(x: number, y: number, z: number, r: number, h: number): boolean {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const c = this.grid.get(i * 4096 + j);
      if (c) for (const b of c) if (hitsBody(b, x, y, z, r, h)) return true;
    }
    return false;
  }

  /** the highest surface at or under y+reach beneath (x,z) */
  floorAt(x: number, y: number, z: number, r: number, reach = 0.05): number {
    let best = -1e9;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const c = this.grid.get(i * 4096 + j);
      if (!c) continue;
      for (const b of c) {
        if (b.off || x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) continue;
        const top = b.max[1];
        if (top <= y + reach && top > best) best = top;
      }
    }
    return best;
  }

  /** nearest hit along a ray; `skipPen` sees through what a bullet would */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, skipPen = false): Hit | null {
    let best: Hit | null = null, bt = max;
    const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
    const test = (b: Box) => {
      if (b.off || (skipPen && b.pen)) return;
      if (b.slab) {
        const h = raySlab(b, ox, oy, oz, dx, dy, dz, bt);
        if (h) {
          bt = h.t;
          best = h;
        }
        return;
      }
      let t0 = (b.min[0] - ox) * ix, t1 = (b.max[0] - ox) * ix, ax = 0;
      if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
      let tn = t0, tf = t1;
      let u0 = (b.min[1] - oy) * iy, u1 = (b.max[1] - oy) * iy;
      if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }
      if (u0 > tn) { tn = u0; ax = 1; }
      if (u1 < tf) tf = u1;
      let v0 = (b.min[2] - oz) * iz, v1 = (b.max[2] - oz) * iz;
      if (v0 > v1) { const s = v0; v0 = v1; v1 = s; }
      if (v0 > tn) { tn = v0; ax = 2; }
      if (v1 < tf) tf = v1;
      if (tn > tf || tf < 0 || tn < 0 || tn >= bt) return;
      bt = tn;
      best = { t: tn, nx: ax === 0 ? -Math.sign(dx) : 0, ny: ax === 1 ? -Math.sign(dy) : 0, nz: ax === 2 ? -Math.sign(dz) : 0, box: b };
    };
    // walk the grid along the ray, nearest cells first, and stop once a hit is nearer than the next cell
    const stamp = ++this.stamp;
    const seen = this.seen;
    let cx = Math.floor(ox / CELL), cz = Math.floor(oz / CELL);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(CELL / (dx || 1e-9)), tdz = Math.abs(CELL / (dz || 1e-9));
    let tx = dx ? ((cx + (dx > 0 ? 1 : 0)) * CELL - ox) / dx : 1e9, tz = dz ? ((cz + (dz > 0 ? 1 : 0)) * CELL - oz) / dz : 1e9;
    for (let n = 0; n < 200; n++) {
      const c = this.grid.get(cx * 4096 + cz);
      if (c) for (const b of c) {
        if (seen.get(b) === stamp) continue;
        seen.set(b, stamp);
        test(b);
      }
      const next = Math.min(tx, tz);
      if (next > bt) break;
      if (tx < tz) {
        cx += sx;
        tx += tdx;
      } else {
        cz += sz;
        tz += tdz;
      }
    }
    for (const b of this.dyn) test(b);
    return best;
  }

  /** clear line between two points */
  sees(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    return !this.ray(a.x, a.y, a.z, dx / d, dy / d, dz / d, d - 0.05);
  }
}

/** the ray against a turned slab: into the slab's own frame, then two slabs and the height */
function raySlab(b: Box, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): Hit | null {
  const s = b.slab!;
  const px = ox - s.x, pz = oz - s.z;
  const lu = px * s.ux + pz * s.uz, ln = -px * s.uz + pz * s.ux;
  const du = dx * s.ux + dz * s.uz, dn = -dx * s.uz + dz * s.ux;
  let t0 = 0, t1 = max, ax = -1;
  const clip = (o: number, d: number, lo: number, hi: number, a: number) => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let u = (lo - o) / d, v = (hi - o) / d;
    if (u > v) { const w = u; u = v; v = w; }
    if (u > t0) { t0 = u; ax = a; }
    if (v < t1) t1 = v;
    return t0 <= t1;
  };
  if (!clip(lu, du, 0, s.len, 0) || !clip(ln, dn, -s.t, s.t, 1) || !clip(oy, dy, b.min[1], b.max[1], 2)) return null;
  if (t0 <= 0 || t0 >= max) return null;
  const sg = ax === 0 ? -Math.sign(du) : -Math.sign(dn);
  const nx = ax === 0 ? s.ux * sg : ax === 1 ? -s.uz * sg : 0, nz = ax === 0 ? s.uz * sg : ax === 1 ? s.ux * sg : 0;
  return { t: t0, nx, ny: ax === 2 ? -Math.sign(dy) : 0, nz, box: b };
}

/** how far a point sits from a slab's face, and which way out (negative: inside the reach of r) */
export function slabGap(b: Box, x: number, z: number): { d: number; nx: number; nz: number } {
  const s = b.slab!;
  const px = x - s.x, pz = z - s.z;
  const u = THREE_clamp(px * s.ux + pz * s.uz, 0, s.len);
  const qx = px - s.ux * u, qz = pz - s.uz * u;
  const d = Math.hypot(qx, qz) || 1e-4;
  return { d: d - s.t, nx: qx / d, nz: qz / d };
}
const THREE_clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** the near side of a box a ray is inside of: how much material the round has to go through */
export function exitOf(b: Box, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
  if (b.slab) return b.slab.t * 2 / Math.max(0.2, Math.abs(-dx * b.slab.uz + dz * b.slab.ux));
  const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
  const a = Math.max((b.min[0] - ox) * ix, (b.max[0] - ox) * ix);
  const c = Math.max((b.min[1] - oy) * iy, (b.max[1] - oy) * iy);
  const e = Math.max((b.min[2] - oz) * iz, (b.max[2] - oz) * iz);
  return Math.max(0, Math.min(a, c, e));
}

function hitsBody(b: Box, x: number, y: number, z: number, r: number, h: number): boolean {
  if (b.slab) return !b.off && y + h > b.min[1] && y < b.max[1] && x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] && slabGap(b, x, z).d < r;
  return !b.off && x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] && y + h > b.min[1] && y < b.max[1];
}

/** one body walking: slides along walls, climbs steps, falls */
export interface Mover {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  height: number;
  /** eased stair lift for the eye */
  stepEase: number;
}

const R = 0.27, STEP = 0.46;

export function move(w: World, m: Mover, dt: number) {
  // a door swung into you moves you, it doesn't trap you
  for (const b of w.dyn) {
    if (!b.slab || b.off || m.y + m.height <= b.min[1] || m.y >= b.max[1]) continue;
    if (m.x + R + 0.1 < b.min[0] || m.x - R - 0.1 > b.max[0] || m.z + R + 0.1 < b.min[2] || m.z - R - 0.1 > b.max[2]) continue;
    const g = slabGap(b, m.x, m.z);
    if (g.d >= R) continue;
    const push = R - g.d + 0.002;
    const nx = m.x + g.nx * push, nz = m.z + g.nz * push;
    if (!w.blockedStatic(nx, m.y + 0.02, nz, R - 0.04, m.height - 0.04)) {
      m.x = nx;
      m.z = nz;
    }
  }
  const n = Math.max(1, Math.ceil(Math.hypot(m.vx, m.vz) * dt / 0.15));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    stepAxis(w, m, m.vx * h, 0);
    stepAxis(w, m, 0, m.vz * h);
  }
  m.vy -= 15 * dt;
  const ny = m.y + m.vy * dt;
  if (m.vy <= 0) {
    const f = w.floorAt(m.x, m.y, m.z, R - 0.02);
    if (ny <= f) {
      m.y = f;
      m.vy = 0;
      m.grounded = true;
    } else {
      // stick to stairs going down
      if (m.grounded && m.y - f < STEP + 0.02 && f > -50) {
        m.stepEase += m.y - f;
        m.y = f;
        m.vy = 0;
      } else {
        m.y = ny;
        m.grounded = false;
      }
    }
  } else if (w.blocked(m.x, ny, m.z, R - 0.02, m.height)) {
    m.vy = 0;
  } else {
    m.y = ny;
    m.grounded = false;
  }
  m.stepEase *= Math.exp(-dt * 11);
}

function stepAxis(w: World, m: Mover, dx: number, dz: number) {
  if (!dx && !dz) return;
  const nx = m.x + dx, nz = m.z + dz;
  if (!w.blocked(nx, m.y + 0.02, nz, R, m.height - 0.04)) {
    m.x = nx;
    m.z = nz;
    return;
  }
  // a step
  if (m.grounded && !w.blocked(nx, m.y + STEP, nz, R, m.height - 0.04)) {
    const f = w.floorAt(nx, m.y + STEP, nz, R - 0.02);
    if (f > m.y && f - m.y <= STEP && !w.blocked(nx, f + 0.01, nz, R, m.height - 0.04)) {
      m.stepEase -= f - m.y;
      m.y = f;
      m.x = nx;
      m.z = nz;
      return;
    }
  }
  for (const b of w.dyn) if (b.bump && !b.off && hitsBody(b, nx, m.y + 0.02, nz, R, m.height - 0.04)) b.bump(m.x, m.z, m.vx, m.vz);
  if (dx) m.vx *= 0.3;
  if (dz) m.vz *= 0.3;
}
