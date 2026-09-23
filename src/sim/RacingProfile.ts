import type { Track } from '../world/Track.ts';
import { smoothCircular } from '../world/Track.ts';
import type { CarSpec } from './CarPhysics.ts';

/**
 * Speed profile along the racing line for a given car spec:
 *  1. curvature of the line itself (not the centreline),
 *  2. corner speed from μ(g + downforce/m)·κ⁻¹,
 *  3. backward pass (braking limit) and forward pass (traction/power limit).
 * `vmax[i]` is the target speed at s = i metres.
 */
export class RacingProfile {
  readonly n: number;
  readonly lineK: Float32Array;
  readonly vmax: Float32Array;
  readonly lapTime: number;

  constructor(track: Track, spec: CarSpec, grip = 0.94, brakeGrip = 0.8) {
    const n = (this.n = track.n);
    const lx = new Float32Array(n);
    const lz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const o = track.racingLine[i];
      lx[i] = track.px[i] + track.rx[i] * o;
      lz[i] = track.pz[i] + track.rz[i] * o;
    }
    // curvature from the heading change over ±3 m
    const k = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = (i - 3 + n) % n;
      const b = (i + 3) % n;
      const h1 = Math.atan2(lx[i] - lx[a], lz[i] - lz[a]);
      const h2 = Math.atan2(lx[b] - lx[i], lz[b] - lz[i]);
      let dh = h2 - h1;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      const ds = Math.hypot(lx[b] - lx[a], lz[b] - lz[a]) * 0.5 || 1;
      k[i] = dh / ds;
    }
    this.lineK = smoothCircular(k, 4, 2);

    const m = spec.mass;
    const g = 9.81;
    const kA = 0.5 * 1.225 * spec.clA;
    const kD = 0.5 * 1.225 * spec.cdA;
    const tyreRef = (m * g) / 4;
    const muAt = (Fz: number) => spec.mu * Math.max(0.6, 1 - spec.loadSens * (Fz / 4 / tyreRef - 1));
    // the front axle limits steady cornering (the rear has more grip)
    const vTop = 100;

    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const kk = Math.abs(this.lineK[i]);
      let vv = vTop;
      if (kk > 1e-5) {
        // fixed-point iterate for load-sensitive μ
        vv = 40;
        for (let it = 0; it < 6; it++) {
          const Fz = m * g + kA * vv * vv;
          const mu = muAt(Fz) * grip;
          const den = m * kk - mu * kA;
          vv = den <= 0 ? vTop : Math.min(vTop, Math.sqrt((mu * m * g) / den));
        }
      }
      v[i] = vv;
    }
    // backward (braking) pass, twice around for wrap
    for (let pass = 0; pass < 2; pass++) {
      for (let j = n - 1; j >= 0; j--) {
        const i = j;
        const nx = (i + 1) % n;
        const vn = v[nx];
        const Fz = m * g + kA * vn * vn;
        const aBrake = (muAt(Fz) * brakeGrip * Fz + kD * vn * vn) / m;
        const lim = Math.sqrt(vn * vn + 2 * aBrake);
        if (v[i] > lim) v[i] = lim;
      }
    }
    // forward (acceleration) pass
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const pv = (i - 1 + n) % n;
        const vp = Math.max(1, v[pv]);
        const Fz = m * g * (spec.a / (spec.a + spec.b)) + kA * vp * vp * (1 - spec.aeroFront);
        const aTrac = (muAt(Fz * 2) * Fz * 0.9) / m;
        const aPow = spec.power / (m * vp);
        const a = Math.min(aTrac, aPow) - (kD * vp * vp) / m;
        const lim = Math.sqrt(vp * vp + 2 * Math.max(0, a));
        if (v[i] > lim) v[i] = lim;
      }
    }
    this.vmax = v;
    let t = 0;
    for (let i = 0; i < n; i++) t += 1 / Math.max(1, v[i]);
    this.lapTime = t;
  }

  at(s: number): number {
    const n = this.n;
    const w = ((s % n) + n) % n;
    const i = Math.floor(w);
    const f = w - i;
    return this.vmax[i] * (1 - f) + this.vmax[(i + 1) % n] * f;
  }
}
