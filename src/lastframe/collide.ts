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
/** the tags of what is built: walls, floors and roofs */
const WALLS = new Set(['ext', 'int', 'floor', 'wall', 'under', 'roof', 'ground']);

/** ground that isn't boxes: heights on a grid. z runs north-negative, so rows go with -z */
export interface Terrain {
  x0: number;
  y0: number;
  step: number;
  nx: number;
  ny: number;
  h: Float32Array;
}

const TERRAIN_BOX: Box = { min: [-1e5, -1e5, -1e5], max: [1e5, 1e5, 1e5], pen: false, tag: 'terrain', mat: 'ter_rock' };

export class World {
  terrain: Terrain | null = null;
  /** how far a body may go: [x0, z0, x1, z1], and water deeper than this stops it */
  limit: [number, number, number, number] | null = null;
  deep = -1.05;
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

  /** the ground's height under (x, z), or -1e9 with no terrain */
  ground(x: number, z: number): number {
    const t = this.terrain;
    if (!t) return -1e9;
    const u = (x - t.x0) / t.step, v = (-z - t.y0) / t.step;
    const i = Math.floor(u), j = Math.floor(v);
    if (i < 0 || j < 0 || i >= t.nx - 1 || j >= t.ny - 1) return -1e9;
    const fu = u - i, fv = v - j, a = j * t.nx + i;
    const h = t.h;
    return (h[a] * (1 - fu) + h[a + 1] * fu) * (1 - fv) + (h[a + t.nx] * (1 - fu) + h[a + t.nx + 1] * fu) * fv;
  }

  /** too steep to climb, walking this way, or past the edge of the map */
  barred(x: number, z: number, dx: number, dz: number): boolean {
    const l = this.limit;
    if (l && (x < l[0] || z < l[1] || x > l[2] || z > l[3])) return true;
    if (!this.terrain) return false;
    const g = this.ground(x, z);
    if (g < this.deep) return true;
    const d = Math.hypot(dx, dz) || 1;
    const rise = this.ground(x + (dx / d) * 0.5, z + (dz / d) * 0.5) - g;
    return rise > 0.62;
  }

  /** would a body of half-width r from foot y to y+h at (x,z) touch anything */
  blocked(x: number, y: number, z: number, r: number, h: number): boolean {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const c = this.grid.get(i * 4096 + j);
      if (c) for (const b of c) if (hitsBody(b, x, y, z, r, h)) return true;
    }
    for (const b of this.dyn) if (hitsBody(b, x, y, z, r, h)) return true;
    return this.ground(x, z) > y + 0.01;
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
  /** real: only what you can see (no invisible blockers, no bounding boxes round props), for blood and marks */
  floorAt(x: number, y: number, z: number, r: number, reach = 0.05, real = false): number {
    let best = -1e9;
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const c = this.grid.get(i * 4096 + j);
      if (!c) continue;
      for (const b of c) {
        if (b.off || x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) continue;
        if (real && (b.tag === 'inv' || b.tag === 'prop')) continue;
        const top = b.max[1];
        if (top <= y + reach && top > best) best = top;
      }
    }
    const g = this.ground(x, z);
    if (g <= y + reach && g > best) best = g;
    return best;
  }

  /** nearest hit along a ray; `skipPen` sees through what a bullet would */
  ray(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, skipPen = false, real = false): Hit | null {
    let best: Hit | null = null, bt = max;
    const ix = 1 / (dx || 1e-9), iy = 1 / (dy || 1e-9), iz = 1 / (dz || 1e-9);
    const test = (b: Box) => {
      if (b.off || (skipPen && b.pen) || (real && (b.tag === 'inv' || b.tag === 'prop'))) return;
      if (this.wallsOnly && !WALLS.has(b.tag)) return;
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
    if (!real) for (const b of this.dyn) test(b);
    if (this.terrain) {
      // march over the heights, and pin the crossing down by halves
      const lim = bt;
      let t0 = 0, above = oy - this.ground(ox, oz) >= 0;
      if (above) for (let t = 0.6; t0 < lim; t += 0.6) {
        const tt = Math.min(t, lim);
        const py = oy + dy * tt, g = this.ground(ox + dx * tt, oz + dz * tt);
        if (py < g) {
          let a = t0, b = tt;
          for (let k = 0; k < 6; k++) {
            const m = (a + b) / 2;
            if (oy + dy * m < this.ground(ox + dx * m, oz + dz * m)) b = m;
            else a = m;
          }
          const hx = ox + dx * b, hz = oz + dz * b, e = 0.5;
          const gx = this.ground(hx + e, hz) - this.ground(hx - e, hz), gz = this.ground(hx, hz + e) - this.ground(hx, hz - e);
          const l = Math.hypot(gx, 2 * e, gz);
          bt = b;
          best = { t: b, nx: -gx / l, ny: (2 * e) / l, nz: -gz / l, box: TERRAIN_BOX };
          break;
        }
        t0 = tt;
        if (tt >= lim) break;
      }
    }
    return best;
  }

  /** only the building itself: what the eye cannot see through, whatever else stands in the room */
  private wallsOnly = false;

  /** nothing of the building between two points. Shelving, counters and glass do not count: they are not walls, and a
   *  body half seen through one must still be drawn */
  open(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz) || 1;
    this.wallsOnly = true;
    const h = this.ray(ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, false, true);
    this.wallsOnly = false;
    return !h;
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
  if ((w.terrain || w.limit) && w.barred(nx, nz, dx, dz)) {
    if (dx) m.vx *= 0.3;
    if (dz) m.vz *= 0.3;
    return;
  }
  if (!w.blocked(nx, m.y + 0.02, nz, R, m.height - 0.04)) {
    m.x = nx;
    m.z = nz;
    return;
  }
  // a step: the headroom is checked from the step's top, not from a full step up, or a low sill under a door head
  // (a 12 cm threshold under a 2.08 m lintel) stops you dead
  if (m.grounded) {
    // the floor under the whole of what bumped: probed a hair wider than the body, or a riser it touches is no floor
    const f = w.floorAt(nx, m.y + STEP, nz, R + 0.01);
    // the headroom from knee height up: on a flight the next riser is already under the body's front edge (treads
    // are shallower than a body is wide), and only what's higher than half a step stops you
    const knee = STEP * 0.6;
    if (f > m.y && f - m.y <= STEP && !w.blocked(nx, f + knee, nz, R, m.height - knee - 0.04)) {
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
