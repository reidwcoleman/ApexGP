/**
 * Small mutable vector / rotation helpers for the simulation. The field frame: x across the pitch
 * (blue's right), y down the pitch toward the orange goal, z up; units are centimetres ("uu"). A
 * car's orientation is a rotation matrix kept as three column vectors: forward, left, up.
 */

export class V3 {
  constructor(
    public x = 0,
    public y = 0,
    public z = 0,
  ) {}
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v: V3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  clone(): V3 {
    return new V3(this.x, this.y, this.z);
  }
  add(v: V3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  sub(v: V3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  addScaled(v: V3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  dot(v: V3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  len(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  len2(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  norm(): this {
    const l = this.len();
    if (l > 1e-9) this.scale(1 / l);
    return this;
  }
  crossVectors(a: V3, b: V3): this {
    const x = a.y * b.z - a.z * b.y;
    const y = a.z * b.x - a.x * b.z;
    const z = a.x * b.y - a.y * b.x;
    return this.set(x, y, z);
  }
  subVectors(a: V3, b: V3): this {
    return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  dist(v: V3): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  clampLen(max: number): this {
    const l = this.len();
    if (l > max) this.scale(max / l);
    return this;
  }
}

/** Orientation: columns forward (f), left (l), up (u). */
export class Basis {
  f = new V3(1, 0, 0);
  l = new V3(0, 1, 0);
  u = new V3(0, 0, 1);
  copy(b: Basis): this {
    this.f.copy(b.f);
    this.l.copy(b.l);
    this.u.copy(b.u);
    return this;
  }
  /** world → local */
  toLocal(v: V3, out: V3): V3 {
    return out.set(v.dot(this.f), v.dot(this.l), v.dot(this.u));
  }
  /** local → world */
  toWorld(x: number, y: number, z: number, out: V3): V3 {
    return out.set(this.f.x * x + this.l.x * y + this.u.x * z, this.f.y * x + this.l.y * y + this.u.y * z, this.f.z * x + this.l.z * y + this.u.z * z);
  }
  /** rotate by the world-space angular velocity w over dt (Rodrigues), then re-orthonormalise */
  integrate(w: V3, dt: number): void {
    const a = w.len() * dt;
    if (a < 1e-9) return;
    const kx = w.x / w.len();
    const ky = w.y / w.len();
    const kz = w.z / w.len();
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const v of [this.f, this.l, this.u]) {
      const d = kx * v.x + ky * v.y + kz * v.z;
      const cx = ky * v.z - kz * v.y;
      const cy = kz * v.x - kx * v.z;
      const cz = kx * v.y - ky * v.x;
      v.set(v.x * c + cx * s + kx * d * (1 - c), v.y * c + cy * s + ky * d * (1 - c), v.z * c + cz * s + kz * d * (1 - c));
    }
    this.ortho();
  }
  ortho(): void {
    this.f.norm();
    this.u.addScaled(this.f, -this.u.dot(this.f)).norm();
    this.l.crossVectors(this.u, this.f);
  }
  /** from yaw (around z), pitch and roll, RL's convention-ish */
  fromEuler(yaw: number, pitch = 0, roll = 0): this {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    this.f.set(cp * cy, cp * sy, sp);
    this.l.set(cy * sp * sr - cr * sy, sy * sp * sr + cr * cy, -cp * sr);
    this.u.set(-cr * cy * sp - sr * sy, -cr * sy * sp + sr * cy, cp * cr);
    return this;
  }
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** piecewise-linear table lookup: pts = [[x, y], ...] sorted by x */
export function curve(pts: readonly (readonly [number, number])[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/** deterministic little PRNG (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
