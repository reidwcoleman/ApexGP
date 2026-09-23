import * as THREE from 'three';
import { SURF, VERGE, type Track } from '../Track.ts';
import type { ChunkSet, GeoBuilder } from './builder.ts';

/**
 * Per-sample analysis shared by every trackside builder: surface wear
 * (rubber, skids, marbles), paint flags, how far the ground mesh reaches
 * behind each barrier, and fast frame helpers.
 */

export type BarrierKind = 'armco' | 'concrete' | 'pitwall';
export type FrontKind = 'none' | 'tyres' | 'tecpro';

export interface SidePlan {
  side: -1 | 1;
  bar: Float32Array;
  kerb: Float32Array;
  runoff: Uint8Array;
  /** outer reach of the ground mesh (|lateral|) */
  ext: Float32Array;
  /** 1 where tarmac runoff gets painted bands */
  paint: Uint8Array;
  /** 1 on the pit side around the pit lane (unpainted, pit-style tarmac) */
  pitZone: Uint8Array;
  kind: BarrierKind[];
  front: FrontKind[];
  /** index into palettes for tyre belts / tecpro colours (per corner) */
  palette: Int16Array;
  fence: Uint8Array;
  /** backing wall offset behind the barrier face (front layer depth, smoothed) */
  backOff: Float32Array;
  /** 1 in braking zones / corner outsides where fence banners go */
  banners: Uint8Array;
}

export class Ctx {
  readonly track: Track;
  readonly n: number;
  readonly vScale: number;
  readonly cs: ChunkSet;
  readonly rubber: Float32Array;
  readonly skid: Float32Array;
  readonly marbles: Float32Array;
  readonly clear: Float32Array;
  readonly L: SidePlan;
  readonly R: SidePlan;

  constructor(track: Track, cs: ChunkSet) {
    this.track = track;
    this.cs = cs;
    const n = (this.n = track.n);
    this.vScale = (Math.max(1, Math.round(n / 96)) * 96) / n;
    this.rubber = new Float32Array(n);
    this.skid = new Float32Array(n);
    this.marbles = new Float32Array(n);
    this.clear = new Float32Array(n);
    this.analyseWear();
    this.computeClearance();
    this.L = this.makeSide(-1);
    this.R = this.makeSide(1);
  }

  side(s: number): SidePlan {
    return s < 0 ? this.L : this.R;
  }

  wrap(i: number): number {
    const n = this.n;
    return ((i % n) + n) % n;
  }

  forRange(a: number, b: number, fn: (i: number, s: number) => void) {
    for (let s = Math.floor(a); s <= Math.ceil(b); s++) fn(this.wrap(s), s);
  }

  /** Is sample i inside [a, b] (lap-wrapped, a may be > b)? */
  inRange(i: number, a: number, b: number): boolean {
    const n = this.n;
    const w = this.wrap(i);
    const A = this.wrap(a), B = this.wrap(b);
    return A <= B ? w >= A && w <= B : w >= A || w <= B;
  }

  // ---------------------------------------------------------------- frames

  /** world point at integer row `i` (may be ≥ n), lateral `lat`, lift `h` along the frame up. */
  P(i: number, lat: number, h: number, out: THREE.Vector3): THREE.Vector3 {
    const t = this.track;
    const k = this.wrap(i);
    return out.set(
      t.px[k] + t.rx[k] * lat + t.ux[k] * h,
      t.py[k] + t.ry[k] * lat + t.uy[k] * h,
      t.pz[k] + t.rz[k] * lat + t.uz[k] * h,
    );
  }

  /** vertex on the (banked) road plane with the frame-up normal and track uv */
  gv(b: GeoBuilder, i: number, lat: number, h: number, vRow = i): number {
    const t = this.track;
    const k = this.wrap(i);
    return b.v(
      t.px[k] + t.rx[k] * lat + t.ux[k] * h,
      t.py[k] + t.ry[k] * lat + t.uy[k] * h,
      t.pz[k] + t.rz[k] * lat + t.uz[k] * h,
      t.ux[k], t.uy[k], t.uz[k],
      lat,
      vRow * this.vScale,
    );
  }

  upOf(i: number, out: THREE.Vector3) {
    const t = this.track;
    const k = this.wrap(i);
    return out.set(t.ux[k], t.uy[k], t.uz[k]);
  }

  /** horizontal unit vector pointing away from the track on `side` at row i */
  outward(i: number, side: number, out: THREE.Vector3) {
    const t = this.track;
    const k = this.wrap(i);
    return out.set(t.rx[k] * side, 0, t.rz[k] * side).normalize();
  }

  // ---------------------------------------------------------------- analysis

  private analyseWear() {
    const t = this.track;
    const n = this.n;
    this.rubber.fill(0.6);
    for (const c of t.corners) {
      const st = c.sStart;
      const ap = st + t.delta(st, c.sApex);
      const en = st + t.delta(st, c.sEnd);
      const sk = Math.max(0, Math.min(1, (140 - c.radius) / 110));
      const Lb = 30 + 110 * sk;
      // more rubber through corners (lateral load) and in braking zones
      this.forRange(st - Lb, en + 40, (i, s) => {
        const a = Math.min(1, (s - (st - Lb)) / 30, (en + 40 - s) / 40);
        this.rubber[i] = Math.max(this.rubber[i], 0.6 + 0.4 * a);
      });
      if (sk > 0.05) {
        this.forRange(st - Lb - 25, ap, (i, s) => {
          let v: number;
          if (s < st - Lb) v = (s - (st - Lb - 25)) / 25; // first big stop
          else if (s < st - 12) v = 0.55 + 0.45 * ((s - (st - Lb)) / Math.max(1, Lb - 12)); // building to turn-in
          else v = 1 - (s - (st - 12)) / Math.max(1, ap - (st - 12)); // fade to the apex
          this.skid[i] = Math.max(this.skid[i], Math.max(0, Math.min(1, v)) * (0.35 + 0.65 * sk));
        });
      }
      const mb = 0.45 + 0.55 * Math.max(0, Math.min(1, (160 - c.radius) / 140));
      this.forRange(st, en + 70, (i, s) => {
        const a = Math.min(1, (s - st) / 25, (en + 70 - s) / 40);
        this.marbles[i] = Math.max(this.marbles[i], Math.max(0, a) * mb);
      });
    }
    // grid: launches rubber the whole start area
    this.forRange(t.startS - 170, t.startS + 60, (i) => {
      this.rubber[i] = Math.max(this.rubber[i], 0.6);
    });
    void n;
  }

  private computeClearance() {
    const t = this.track;
    const n = this.n;
    const step = 3;
    for (let i = 0; i < n; i += step) this.clear[i] = t.distanceToOther(t.px[i], t.pz[i], i);
    for (let i = 0; i < n; i++) {
      if (i % step === 0) continue;
      const a = i - (i % step);
      const b = (a + step) % n;
      const f = (i - a) / step;
      this.clear[i] = this.clear[a] * (1 - f) + this.clear[b] * f;
    }
  }

  private makeSide(side: -1 | 1): SidePlan {
    const t = this.track;
    const n = this.n;
    const bar = side < 0 ? t.barrierL : t.barrierR;
    const kerb = side < 0 ? t.kerbL : t.kerbR;
    const runoff = side < 0 ? t.runoffL : t.runoffR;
    const plan: SidePlan = {
      side,
      bar,
      kerb,
      runoff,
      ext: new Float32Array(n),
      paint: new Uint8Array(n),
      pitZone: new Uint8Array(n),
      kind: new Array<BarrierKind>(n).fill('armco'),
      front: new Array<FrontKind>(n).fill('none'),
      palette: new Int16Array(n).fill(-1),
      fence: new Uint8Array(n).fill(1),
      backOff: new Float32Array(n),
      banners: new Uint8Array(n),
    };
    const seg = t.data.segStart;
    const segLen = t.data.segLen;
    const pit = t.pit;
    const pitSide = pit.side === side;

    // --- barrier kinds
    // pit straight + the short straight before it: concrete with sponsor boards
    const mainA = seg[26] ?? n - 120;
    const mainB = seg[1] ?? 960;
    this.forRange(mainA, n + mainB, (i) => (plan.kind[i] = 'concrete'));
    // the Paseo (seafront promenade): concrete too
    if (seg[10] !== undefined) this.forRange(seg[10] + 10, seg[10] + segLen[10] - 10, (i) => (plan.kind[i] = 'concrete'));

    t.corners.forEach((c, ci) => {
      const st = c.sStart;
      const en = st + t.delta(st, c.sEnd);
      const outside = c.dir;
      if (outside === side) {
        const fr: FrontKind = c.radius < 80 ? 'tyres' : 'tecpro';
        this.forRange(st - 40, en + 80, (i) => {
          if (plan.front[i] === 'tyres') return;
          plan.front[i] = fr;
          plan.palette[i] = ci;
        });
        const heavy = c.radius < 90;
        this.forRange(st - (heavy ? 160 : 90), en, (i) => (plan.banners[i] = 1));
      } else {
        this.forRange(st, en, (i) => {
          if (plan.kind[i] === 'armco') plan.fence[i] = 0;
        });
        if (c.radius < 45) {
          this.forRange(st + 4, en - 4, (i) => {
            if (plan.front[i] === 'none') {
              plan.front[i] = 'tyres';
              plan.palette[i] = ci;
            }
          });
        }
      }
      // painted tarmac runoff where this corner made it asphalt
      this.forRange(st - 25, en + 70, (i) => {
        if (runoff[i] === SURF.ASPHALT && (outside === side || c.radius < 45)) plan.paint[i] = 1;
      });
    });

    if (pitSide) {
      this.forRange(pit.sStart - 110, pit.sEnd + 110, (i) => {
        plan.pitZone[i] = 1;
        plan.paint[i] = 0;
      });
      this.forRange(pit.sStart, pit.sEnd, (i) => {
        plan.kind[i] = 'pitwall';
        plan.front[i] = 'none';
        plan.fence[i] = 0; // the pit wall carries its own fence
      });
    }

    // --- backing wall offset: front layer depth, dilated then smoothed so the wall steps out gently
    const depth = new Float32Array(n);
    for (let i = 0; i < n; i++) depth[i] = plan.front[i] === 'tyres' ? 1.3 : plan.front[i] === 'tecpro' ? 1.0 : 0;
    const dil = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let k = -5; k <= 5; k++) m = Math.max(m, depth[this.wrap(i + k)]);
      dil[i] = m;
    }
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let k = -4; k <= 4; k++) a += dil[this.wrap(i + k)];
      plan.backOff[i] = Math.max(depth[i], a / 9);
    }

    // --- ground reach behind the barrier
    for (let i = 0; i < n; i++) {
      let e = bar[i] + Math.max(3, plan.backOff[i] + 2.6);
      const k = t.kappa[i];
      if (Math.sign(k) === -side && Math.abs(k) > 1e-5) e = Math.min(e, 0.93 / Math.abs(k));
      // stop at the Voronoi line between this and any other section of the lap
      if (this.clear[i] < e * 2 + 6) {
        const rx = t.rx[i] * side, rz = t.rz[i] * side;
        for (let q = bar[i]; q <= e; q += 0.5) {
          const other = t.distanceToOther(t.px[i] + rx * q, t.pz[i] + rz * q, i);
          if (other < q + 0.4) {
            e = Math.max(bar[i] + 0.2, q - 0.4);
            break;
          }
        }
      }
      plan.ext[i] = Math.max(e, t.halfWidth[i] + kerb[i] + VERGE + 0.2);
    }
    // don't let single samples spike out
    const ext2 = Float32Array.from(plan.ext);
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      for (let k = -2; k <= 2; k++) m = Math.min(m, ext2[this.wrap(i + k)]);
      plan.ext[i] = Math.min(ext2[i], m + 1.0);
    }
    return plan;
  }
}
