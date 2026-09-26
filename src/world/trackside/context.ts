import * as THREE from 'three';
import { SURF, VERGE, type Track } from '../Track.ts';
import type { CornerInfo, ImpactLayer, TracksideDef, WallArt } from '../CircuitGen.ts';
import type { ChunkSet, GeoBuilder } from './builder.ts';

/**
 * Per-sample analysis shared by every trackside builder: surface wear
 * (rubber, skids, marbles), kerb styles, paint flags, barrier/fence plan,
 * how far the ground mesh reaches behind each barrier, and fast frame helpers.
 *
 * Everything is keyed by corner NAME or s value (never by segment index), so
 * it follows the real Monza layout in Circuits.ts.
 */

export type BarrierKind = 'armco' | 'concrete' | 'pitwall' | 'none';
export type FrontKind = ImpactLayer;

/**
 * The pit complex module owns the pit side of the main straight: pit wall,
 * pit lane, entry/exit spur lanes and the ground between them and the road.
 * On `pit.side`, for s in [pit.sStart − before, pit.sEnd + after], the
 * trackside builds ONLY the main road (lat ≤ halfWidth) and its markings.
 */
export const PIT_HANDOFF = { before: 110, after: 140 };

/** Resolved dressing of one corner (CornerDef fields over derived defaults). `brake` = braking-zone strength. */
export interface CornerStyle {
  front: FrontKind;
  /** chicane: raised sausage kerbs behind the apex kerb */
  chicane?: boolean;
  /** braking zone 0..1 (skid marks) and its length (m) */
  brake?: number;
  brakeLen?: number;
  /** 150/100/50 boards before this corner */
  boards?: boolean;
  /** wide exit kerb with an outer green band */
  wideExit?: boolean;
}

export const WALL_ART: Record<WallArt, number> = { ads: 0, plain: 1, stripes: 2, champions: 3 };

let styles = new Map<string, CornerStyle>();
/** style of a corner of the circuit being built (by name) */
export const styleOf = (name: string): CornerStyle => styles.get(name) ?? { front: 'tyres' };

/**
 * Derive every corner's dressing: explicit CornerDef fields win; otherwise slow corners at the
 * end of a straight get braking boards and a braking zone, tight ones with tarmac run-off get
 * TecPro, the rest tyre walls; a tight left–right (or right–left) pair within 60 m is a chicane.
 */
function resolveStyles(t: Track): Map<string, CornerStyle> {
  const out = new Map<string, CornerStyle>();
  const defs = new Map((t.def.corners ?? []).map((c) => [c.name, c]));
  const straightBefore = (c: CornerInfo) => {
    let s = c.sStart - 1, run = 0;
    while (run < 800 && Math.abs(t.kappaAt(s)) < 1 / 400) { s--; run++; }
    return run;
  };
  const cs = t.corners;
  cs.forEach((c, k) => {
    const d = defs.get(c.name);
    const run = straightBefore(c);
    const slow = c.radius < 120;
    const brake = slow && run > 180 ? Math.min(1, 0.35 + run / 900) * (c.radius < 60 ? 1 : 0.7) : run > 120 && c.radius < 200 ? 0.3 : 0;
    const prev = cs[(k - 1 + cs.length) % cs.length], next = cs[(k + 1) % cs.length];
    const pairs = (o: CornerInfo) => o !== c && o.dir !== c.dir && o.radius < 70 && Math.abs(t.delta(c.sApex, o.sApex)) < 60;
    const chicane = c.radius < 70 && (pairs(prev) || pairs(next));
    out.set(c.name, {
      front: d?.front ?? (c.radius < 70 && c.runoff === 'asphalt' ? 'tecpro' : 'tyres'),
      chicane: d?.chicane ?? chicane,
      brake: d?.brake ?? (brake > 0.05 ? brake : undefined),
      brakeLen: d?.brakeLen ?? Math.round(Math.min(160, 40 + run * 0.15)),
      boards: d?.boards ?? (c.radius < 110 && run > 220),
      wideExit: d?.wideExit ?? (c.radius < 90 && c.runoff === 'asphalt' && chicane && !pairs(next)),
    });
  });
  return out;
}

/** does lap position i fall inside [from, to] (wrapping)? */
function inRun(i: number, from: number, to: number, n: number) {
  const a = ((from % n) + n) % n, b = ((to % n) + n) % n;
  return a <= b ? i >= a && i <= b : i >= a || i <= b;
}

export interface SidePlan {
  side: -1 | 1;
  bar: Float32Array;
  kerb: Float32Array;
  runoff: Uint8Array;
  /** outer reach of the ground mesh (|lateral|) */
  ext: Float32Array;
  /** 1 where tarmac runoff gets painted bands */
  paint: Uint8Array;
  /** 1 where the verge is painted green */
  vergePaint: Uint8Array;
  /** kerb style per row: 0 none, 1 flat, 2 chicane, 3 wide exit */
  kerbStyle: Uint8Array;
  /** 1 where the pit module owns everything beyond the road edge */
  pitZone: Uint8Array;
  kind: BarrierKind[];
  front: FrontKind[];
  /** index into palettes for tyre belts / tecpro colours (per corner) */
  palette: Int16Array;
  /** 0 none, 1 standard 4 m debris fence, 2 tall 6 m grandstand fence */
  fence: Uint8Array;
  /** 1 on the rows of a marshal gate (fence + barrier opening) */
  gate: Uint8Array;
  /** backing wall offset behind the barrier face (front layer depth, smoothed) */
  backOff: Float32Array;
  /** 1 in braking zones / corner outsides where fence banners go */
  banners: Uint8Array;
  /** concrete wall art per row (WALL_ART: 0 ads, 1 plain, 2 stripes, 3 champions) */
  art: Uint8Array;
  /** 1 where sponsor boards are bolted to the armco */
  boards: Uint8Array;
}

export interface MarshalPost {
  s: number;
  side: -1 | 1;
  num: number;
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
  readonly posts: MarshalPost[] = [];

  /** the circuit's dressing (CircuitDef.trackside, may be empty) */
  readonly dress: TracksideDef;

  constructor(track: Track, cs: ChunkSet) {
    this.track = track;
    this.cs = cs;
    this.dress = track.def.trackside ?? {};
    styles = resolveStyles(track);
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
    this.planPosts();
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
    const w = this.wrap(i);
    const A = this.wrap(a), B = this.wrap(b);
    return A <= B ? w >= A && w <= B : w >= A || w <= B;
  }

  /** true where the pit module owns the ground on this side */
  pitOwned(i: number, side: number): boolean {
    return side === this.track.pit.side && this.side(side).pitZone[this.wrap(i)] === 1;
  }

  corner(name: string) {
    return this.track.corners.find((c) => c.name === name);
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
    this.rubber.fill(0.55);
    for (const c of t.corners) {
      const st = c.sStart;
      const ap = st + t.delta(st, c.sApex);
      const en = st + t.delta(st, c.sEnd);
      const sty = styleOf(c.name);
      const sk = sty.brake ?? 0;
      const Lb = sty.brakeLen ?? 40;
      // more rubber through corners (lateral load) and in braking zones
      this.forRange(st - Lb, en + 40, (i, s) => {
        const a = Math.min(1, (s - (st - Lb)) / 30, (en + 40 - s) / 40);
        this.rubber[i] = Math.max(this.rubber[i], 0.55 + 0.45 * a);
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
      this.rubber[i] = Math.max(this.rubber[i], 0.65);
    });
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
      vergePaint: new Uint8Array(n),
      kerbStyle: new Uint8Array(n),
      pitZone: new Uint8Array(n),
      kind: new Array<BarrierKind>(n).fill(this.dress.barrier ?? 'armco'),
      front: new Array<FrontKind>(n).fill('none'),
      palette: new Int16Array(n).fill(-1),
      fence: new Uint8Array(n).fill(this.dress.fence ?? 1),
      gate: new Uint8Array(n),
      backOff: new Float32Array(n),
      banners: new Uint8Array(n),
      art: new Uint8Array(n).fill(WALL_ART[this.dress.art ?? 'ads']),
      boards: new Uint8Array(n),
    };
    const pit = t.pit;
    const pitSide = pit.side === side;
    const hwAll = t.def.halfWidth;

    // --- kerb styles
    for (let i = 0; i < n; i++) if (kerb[i] > 0) plan.kerbStyle[i] = 1;
    t.corners.forEach((c) => {
      const sty = styleOf(c.name);
      const st = c.sStart;
      const ap = st + t.delta(st, c.sApex);
      const en = st + t.delta(st, c.sEnd);
      const inside = -c.dir;
      if (sty.chicane && inside === side) this.forRange(st - 6, en + 6, (i) => kerb[i] > 0 && (plan.kerbStyle[i] = 2));
      if (sty.wideExit && c.dir === side) this.forRange(ap, en + 40, (i) => kerb[i] > 0 && (plan.kerbStyle[i] = 3));
    });

    // --- verge paint: green abrasive paint wherever there is a kerb or the corner has tarmac/gravel run-off
    for (let i = 0; i < n; i++) {
      if (kerb[i] > 0) plan.vergePaint[i] = 1;
    }
    t.corners.forEach((c) => {
      const st = c.sStart;
      const en = st + t.delta(st, c.sEnd);
      this.forRange(st - 30, en + 60, (i) => (plan.vergePaint[i] = 1));
    });

    // --- barrier kinds: the circuit's default (armco + debris fence unless trackside says otherwise)
    // walls that end up close to the road are concrete
    for (let i = 0; i < n; i++) if (bar[i] < hwAll + 5.5 && plan.kind[i] === 'armco') plan.kind[i] = 'concrete';

    t.corners.forEach((c, ci) => {
      const st = c.sStart;
      const en = st + t.delta(st, c.sEnd);
      const outside = c.dir;
      const sty = styleOf(c.name);
      if (outside === side) {
        this.forRange(st - 30, en + 70, (i) => {
          if (plan.front[i] === 'tyres' && sty.front !== 'tyres') return;
          plan.front[i] = sty.front;
          plan.palette[i] = ci;
        });
        this.forRange(st - (sty.boards ? 170 : 90), en, (i) => (plan.banners[i] = 1));
      } else if (c.radius < 45) {
        this.forRange(st + 2, en - 2, (i) => {
          if (plan.front[i] === 'none') {
            plan.front[i] = 'tecpro';
            plan.palette[i] = ci;
          }
        });
      }
      // painted tarmac runoff where this corner made it asphalt
      this.forRange(st - 25, en + 70, (i) => {
        if (runoff[i] === SURF.ASPHALT && (outside === side || c.radius < 45)) plan.paint[i] = 1;
      });
    });
    // main straight grandstand wall: printed sponsor panels, no front layer
    // (T1's escape road ends in a TecPro wall; that's handled by the corner loop above)

    // --- per-segment overrides from the circuit def (later runs win)
    for (const r of this.dress.runs ?? []) {
      if (r.side && r.side !== side) continue;
      for (let i = 0; i < n; i++) {
        if (!inRun(i, r.from, r.to, n)) continue;
        if (r.kind) plan.kind[i] = r.kind;
        if (r.front) plan.front[i] = r.front;
        if (r.fence !== undefined) plan.fence[i] = r.fence;
        if (r.art) plan.art[i] = WALL_ART[r.art];
        if (r.boards !== undefined) plan.boards[i] = r.boards ? 1 : 0;
      }
    }
    // sponsor boards on the armco along straights (away from corners, where the fence banners are)
    if (this.dress.armcoBoards) for (let i = 0; i < n; i++) if (plan.kind[i] === 'armco' && plan.front[i] === 'none' && !plan.banners[i]) plan.boards[i] = 1;
    for (let i = 0; i < n; i++) if (plan.kind[i] !== 'armco') plan.boards[i] = 0;

    // --- the pit module's side of the main straight
    if (pitSide) {
      this.forRange(pit.sStart - PIT_HANDOFF.before, pit.sEnd + PIT_HANDOFF.after, (i) => {
        plan.pitZone[i] = 1;
        plan.paint[i] = 0;
        plan.vergePaint[i] = 0;
        plan.kind[i] = 'none';
        plan.front[i] = 'none';
        plan.fence[i] = 0;
        plan.banners[i] = 0;
      });
    }

    // --- marshal gates: a 3 m opening every ~210 m on plain armco sections
    for (let s = 60; s < n - 10; s += 210) {
      const a = s + Math.round((this.hashS(s, side) - 0.5) * 60);
      let ok = true;
      for (let k = -6; k <= 6; k++) {
        const i = this.wrap(a + k);
        if (plan.kind[i] !== 'armco' || plan.front[i] !== 'none' || plan.fence[i] !== 1) ok = false;
      }
      if (!ok) continue;
      for (let k = 0; k < 3; k++) plan.gate[this.wrap(a + k)] = 1;
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
      let e = bar[i] + Math.max(3.5, plan.backOff[i] + 3.0);
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

  private hashS(s: number, side: number) {
    let h = Math.imul(s | 0, 0x27d4eb2d) ^ Math.imul(side + 7, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  }

  /** Marshal posts: every ~260 m, on the outside of the nearest corner, beside a gate when there is one. */
  private planPosts() {
    const t = this.track;
    const n = this.n;
    let num = 1;
    for (let s = 90; s < n - 60; s += 255) {
      // side: outside of the next corner within 300 m, else alternate
      let side: -1 | 1 = num % 2 ? -1 : 1;
      for (const c of t.corners) {
        const d = t.delta(s, c.sStart);
        if (d > -60 && d < 300) {
          side = c.dir as -1 | 1;
          break;
        }
      }
      let P = this.side(side);
      if (P.pitZone[this.wrap(s)] || P.kind[this.wrap(s)] === 'none') {
        side = -side as -1 | 1;
        P = this.side(side);
      }
      // snap to a nearby gate on that side
      let best = s;
      for (let k = -40; k <= 40; k++) if (P.gate[this.wrap(s + k)] && !P.gate[this.wrap(s + k - 1)]) { best = s + k + 5; break; }
      const i = this.wrap(best);
      // grandstand walls (tall fence) have no posts behind them: the stands are there
      if (P.kind[i] === 'none' || P.fence[i] === 2 || this.clear[i] < P.bar[i] + 9) continue;
      this.posts.push({ s: i, side, num: num++ });
    }
  }
}
