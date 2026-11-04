import type { Frame } from './pieces.ts';
import { STEER_FADE, STEER_LOCK, type Input } from './sim.ts';

/**
 * A pure-pursuit driver along a built-in track's centre line with curvature-based braking.
 * Used to time the tracks (medals) and to prove every jump and loop can be made.
 */
export class Autopilot {
  line: Frame[];
  cum: number[] = [];
  private idx = 0;
  aLat: number;
  aBrake: number;

  constructor(line: Frame[], aLat = 29, aBrake = 18) {
    this.line = line;
    this.aLat = aLat;
    this.aBrake = aBrake;
    let s = 0;
    line.forEach((f, i) => {
      if (i) s += Math.hypot(f.p[0] - line[i - 1].p[0], f.p[1] - line[i - 1].p[1], f.p[2] - line[i - 1].p[2]);
      this.cum.push(s);
    });
  }

  /** where on the line the car is (index) */
  locate(p: number[]) {
    let best = this.idx, bd = Infinity;
    const lo = Math.max(0, this.idx - 5), hi = Math.min(this.line.length - 1, this.idx + 60);
    for (let i = lo; i <= hi; i++) {
      const q = this.line[i].p;
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 * 0.3 + (q[2] - p[2]) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    this.idx = best;
    return { i: best, d: Math.sqrt(bd) };
  }

  reset() { this.idx = 0; }

  private at(s: number) {
    let i = this.idx;
    while (i < this.line.length - 1 && this.cum[i + 1] < s) i++;
    return this.line[i];
  }

  /** horizontal curvature at index i */
  private curv(i: number) {
    const a = this.line[Math.max(0, i - 1)], b = this.line[Math.min(this.line.length - 1, i + 1)];
    if (Math.abs(a.u[1]) < 0.9 || Math.abs(b.u[1]) < 0.9) return 0; // loops: vertical
    const ha = Math.atan2(a.f[0], a.f[2]), hb = Math.atan2(b.f[0], b.f[2]);
    let dh = hb - ha;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    const ds = Math.max(0.01, this.cum[Math.min(this.line.length - 1, i + 1)] - this.cum[Math.max(0, i - 1)]);
    return Math.abs(dh) / ds;
  }

  drive(p: number[], q: number[], v: number[], grounded: boolean): Input {
    const { i } = this.locate(p);
    const speed = Math.hypot(v[0], v[1], v[2]);
    // the target in the car's own frame (works upside down in a loop)
    const [x, y, z, w] = q;
    const fwd = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    const left = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)];
    const Ld = 4 + speed * 0.34;
    const tgt = this.at(this.cum[i] + Ld).p;
    const d = [tgt[0] - p[0], tgt[1] - p[1], tgt[2] - p[2]];
    const lx = d[0] * left[0] + d[1] * left[1] + d[2] * left[2];
    const lz = d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2];
    // aim relative to where the car is going, not just where it points (damps the wobble after landings)
    const vl = v[0] * left[0] + v[1] * left[1] + v[2] * left[2];
    const vf = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2];
    const slip = speed > 8 ? Math.atan2(vl, Math.max(1, vf)) : 0;
    const ang = Math.atan2(lx, Math.max(0.5, lz)) - slip * 0.8;
    // positive ang = target to the car's left -> steer left (negative)
    const lock = STEER_LOCK / (1 + Math.max(0, speed) / STEER_FADE);
    const delta = Math.atan2(2 * 2.55 * Math.sin(ang), Ld);
    const steer = Math.max(-1, Math.min(1, -delta / lock));

    // speed plan: the slowest corner within braking distance
    let brake = false;
    const look = speed * speed / (2 * this.aBrake) + 8;
    for (let j = i; j < this.line.length && this.cum[j] - this.cum[i] < look; j++) {
      const k = this.curv(j);
      if (k < 1e-3) continue;
      const vmax = Math.sqrt(this.aLat / Math.max(1e-3, k - 0.012));
      const dist = this.cum[j] - this.cum[i];
      if (speed > vmax && speed * speed - vmax * vmax > 2 * this.aBrake * Math.max(0, dist - 2)) { brake = true; break; }
    }
    if (!grounded) return { throttle: 1, brake: 0, steer: 0, hand: false };
    return { throttle: brake ? 0 : 1, brake: brake ? 1 : 0, steer, hand: false };
  }

  progress() { return this.cum[this.idx] / (this.cum[this.cum.length - 1] || 1); }
}
