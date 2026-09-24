import type { Track } from '../Track.ts';

/**
 * The 1955 high-speed oval ("Sopraelevata") as a path, before any geometry.
 *
 * The real oval shares the main straight with the road course, turns right
 * into the north banking inside the Curva Grande, runs south along its east
 * straight (crossing OVER the Serraglio on a bridge), and wraps round the
 * Parabolica through the south banking back onto the main straight. Its two
 * links to the main straight are long gone here (they'd cut through the T1
 * run-off and the Parabolica gravel), so both banked curves end in abandoned,
 * overgrown stubs in the woods.
 *
 * Frame: `d` = direction of the main straight (north-ish), `e` = its right
 * normal (east-ish). Arcs are parametrised by φ around their centres:
 * p(φ) = C + R (e cos φ + d sin φ) → φ = 0 east, 90° north, 180° west, 270° south.
 * Travel is clockwise (like the circuit): north arc φ: φN0 → 0, straight south,
 * south arc φ: 0 → −φS1.
 */

export interface OvalPath {
  /** samples every STEP metres, in travel order */
  n: number;
  x: Float32Array;
  z: Float32Array;
  /** unit tangent (travel direction) */
  tx: Float32Array;
  tz: Float32Array;
  /** signed curvature (+ = right-hander, i.e. centre on the right) */
  k: Float32Array;
  /** banking amount 0 (flat) … 1 (full 80 % wall) */
  bank: Float32Array;
  /** height of the running surface's inner edge (absolute, m) */
  base: Float32Array;
  /** 0 … 1 decay at the abandoned ends (1 = intact) */
  intact: Float32Array;
  /** embankment height above the natural ground (0 away from the bridge ramps) */
  emb: Float32Array;
  /** sample index of the bridge over the circuit and the track s it crosses */
  bridgeU: number;
  bridgeS: number;
  /** road height under the bridge, deck bottom height */
  roadY: number;
  deckBottom: number;
  /** width of the running surface */
  width: number;
  /** the right-hand side (+1) is the inside of both curves */
  cN: { x: number; z: number; r: number };
  cS: { x: number; z: number; r: number };
  /** lateral positions of the two bridge abutments relative to the circuit centreline */
  abutLat: [number, number];
  /** crossing angle between the oval and the circuit (rad, 0 = parallel) */
  crossAngle: number;
}

export const OVAL_STEP = 2;
export const OVAL_WIDTH = 12;
/** height of the outer edge above the inner edge on a fully banked section */
export const BANK_RISE = 5.4;

/** track s at which the east straight passes over the Serraglio */
export const OVAL_CROSS_S = 3700;

export function planOval(track: Track, ground: (x: number, z: number) => number): OvalPath {
  // main straight direction (from the Parabolica exit towards T1)
  const a = track.point(40, 0), b = track.point(1000, 0);
  let dx = b.x - a.x, dz = b.z - a.z;
  const L = Math.hypot(dx, dz);
  dx /= L; dz /= L;
  // right normal of travel (right = forward × up = (−fz, 0, fx))
  const ex = -dz, ez = dx;

  const X0 = track.point(OVAL_CROSS_S, 0);
  const RN = 262, RS = 300;
  const aN = 70; // east tangent point of the north arc, metres north of the crossing
  const aS = 1540; // east tangent point of the south arc, metres south of the crossing
  const ENx = X0.x + dx * aN, ENz = X0.z + dz * aN;
  const ESx = X0.x - dx * aS, ESz = X0.z - dz * aS;
  const cN = { x: ENx - ex * RN, z: ENz - ez * RN, r: RN };
  const cS = { x: ESx - ex * RS, z: ESz - ez * RS, r: RS };
  const phiN0 = (208 * Math.PI) / 180; // abandoned end of the north arc (south-west of its centre)
  const phiS1 = (132 * Math.PI) / 180; // abandoned end of the south arc

  const px: number[] = [], pz: number[] = [], kk: number[] = [];
  const arc = (C: { x: number; z: number; r: number }, f0: number, f1: number) => {
    const len = Math.abs(f1 - f0) * C.r;
    const m = Math.max(2, Math.round(len / OVAL_STEP));
    for (let i = 0; i < m; i++) {
      const f = f0 + ((f1 - f0) * i) / m;
      px.push(C.x + C.r * (ex * Math.cos(f) + dx * Math.sin(f)));
      pz.push(C.z + C.r * (ez * Math.cos(f) + dz * Math.sin(f)));
      kk.push(1 / C.r);
    }
  };
  arc(cN, phiN0, 0);
  {
    const len = aN + aS;
    const m = Math.round(len / OVAL_STEP);
    for (let i = 0; i < m; i++) {
      const t = (i / m) * len;
      px.push(ENx - dx * t);
      pz.push(ENz - dz * t);
      kk.push(0);
    }
  }
  arc(cS, 0, -phiS1);
  const n = px.length;
  const x = Float32Array.from(px), z = Float32Array.from(pz);
  const tx = new Float32Array(n), tz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    const vx = x[i1] - x[i0], vz = z[i1] - z[i0];
    const l = Math.hypot(vx, vz) || 1;
    tx[i] = vx / l;
    tz[i] = vz / l;
  }
  const k = Float32Array.from(kk);

  // banking follows curvature, eased in over ~150 m (spiral-like)
  const bank = new Float32Array(n);
  {
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = k[i] > 0 ? 1 : 0;
    const r = Math.round(75 / OVAL_STEP);
    for (let i = 0; i < n; i++) {
      let acc = 0, w = 0;
      for (let j = -r; j <= r; j++) {
        const q = Math.min(n - 1, Math.max(0, i + j));
        acc += raw[q];
        w++;
      }
      const v = acc / w;
      bank[i] = v * v * (3 - 2 * v);
    }
  }

  // bridge: find the sample closest to the crossing point
  let bridgeU = 0, best = Infinity;
  for (let i = 0; i < n; i++) {
    const d = (x[i] - X0.x) ** 2 + (z[i] - X0.z) ** 2;
    if (d < best) { best = d; bridgeU = i; }
  }
  const pr = track.project(x[bridgeU], z[bridgeU], Math.round(OVAL_CROSS_S));
  const bridgeS = pr.s;
  const roadY = track.heightAt(bridgeS);
  const deckBottom = roadY + 6.6;
  const DECK = 2.0; // deck depth (box girder + slab)
  const deckTop = deckBottom + DECK;
  // crossing angle
  const f = track.frame(bridgeS);
  const cosA = Math.abs(f.tangent.x * tx[bridgeU] + f.tangent.z * tz[bridgeU]);
  const crossAngle = Math.acos(Math.min(1, cosA));
  const abutLat: [number, number] = [-(track.barrierAt(bridgeS, -1) + 4.5), track.barrierAt(bridgeS, 1) + 4.5];

  // base height: sits on the ground, ramps up to the bridge deck on an embankment
  const base = new Float32Array(n);
  const emb = new Float32Array(n);
  const RAMP = 0.045; // grade of the approach ramps
  const flat = 36; // half-length of the level deck (m)
  for (let i = 0; i < n; i++) {
    const g = ground(x[i], z[i]) + 0.35;
    const du = Math.abs(i - bridgeU) * OVAL_STEP;
    const target = deckTop - Math.max(0, du - flat) * RAMP;
    // smooth max: the ramp eases onto the ground instead of kinking
    const k = 1.6;
    const hDiff = target - g;
    const h = hDiff > k ? target : hDiff < -k ? g : g + ((hDiff + k) * (hDiff + k)) / (4 * k);
    base[i] = h;
    emb[i] = Math.max(0, h - g);
  }

  // abandoned ends: the last ~110 m crumble away
  const intact = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a0 = (i * OVAL_STEP) / 110, a1 = ((n - 1 - i) * OVAL_STEP) / 110;
    intact[i] = Math.min(1, a0, a1);
  }

  return {
    n, x, z, tx, tz, k, bank, base, intact, emb, bridgeU, bridgeS, roadY, deckBottom,
    width: OVAL_WIDTH, cN, cS, abutLat, crossAngle,
  };
}

/** height of the running surface at signed offset w from the inner edge (0 … width) */
export function bankProfile(w: number, width: number, bank: number): number {
  const t = Math.max(0, Math.min(1, w / width));
  // slope 0.08 at the inner edge, 0.84 at the top (the famous 80 %)
  return bank * width * (0.08 * t + 0.38 * t * t) * (BANK_RISE / (width * 0.46));
}
