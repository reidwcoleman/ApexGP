import type { Particles } from './Particles.ts';

/**
 * Rain spray recipes for one car, emitted by distance travelled (so the plume is
 * continuous at any speed and frame rate) with sub-frame placement + pre-ageing.
 *
 *   plume   the rooster tail: big soft puffs from behind both rear tyres and the
 *           diffuser, thrown back/up, rising 2–4 m, widening, hanging 1–3 s and
 *           drifting with the wind
 *   sheet   the water flung off the rear tread: short, bright, velocity-stretched
 *   front   fine side/forward spray off the front tyres
 *   mist    very large faint puffs that linger over the track after the car
 *
 * LOD by camera distance: near = everything, mid = plume + mist (bigger, fewer),
 * far = a thin plume only, beyond 420 m nothing (the aerial fog has it).
 */

export interface SprayInput {
  /** world position of the car origin (ground level, mid wheelbase) */
  x: number;
  y: number;
  z: number;
  /** heading (forward = (sin, 0, cos)) */
  yaw: number;
  /** world velocity (m/s) */
  vx: number;
  vz: number;
  speed: number;
  /** water under the car 0 … 1 (dry line + surface already applied) */
  wet: number;
  /** distance from the camera (m) */
  camDist: number;
  wheelbase: number;
  trackF: number;
  trackR: number;
  /** the camera's own car (chase / T-cam): its spray is thinned so it never hides the car */
  self?: boolean;
}

interface CarState {
  lx: number;
  lz: number;
  acc: Float32Array; // per emitter distance accumulator
  seen: number;
}

// emitter slots
const E_PLUME_L = 0, E_PLUME_R = 1, E_PLUME_C = 2, E_SHEET_L = 3, E_SHEET_R = 4, E_FRONT_L = 5, E_FRONT_R = 6, E_MIST = 7, E_TREAD_L = 8, E_TREAD_R = 9;
const N_EMIT = 10;
/** 2026 tyre radius (m): 18-inch rims, ~720 mm tall wets */
const TYRE_R = 0.36;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class SprayEmitters {
  private cars = new Map<number, CarState>();
  private frame = 0;
  /** global density multiplier (quality setting) */
  quality = 1;

  /** spray intensity for a car: water × speed (0 … 1) */
  static intensity(wet: number, speed: number) {
    if (wet <= 0.01) return 0;
    // heavy already at 100 km/h, full from ~200 km/h; a damp drizzle track throws a fine mist, a
    // wet one the full plume
    const s = smooth(5, 56, speed);
    return Math.min(1, Math.pow(Math.min(1, wet * 1.3), 1.1) * Math.pow(s, 0.9));
  }

  /** emit this frame's spray for car `id`; returns its intensity */
  emit(p: Particles, id: number, c: SprayInput, dt: number): number {
    let st = this.cars.get(id);
    const I = SprayEmitters.intensity(c.wet, c.speed);
    if (!st) {
      st = { lx: c.x, lz: c.z, acc: new Float32Array(N_EMIT), seen: this.frame };
      this.cars.set(id, st);
    }
    const dx = c.x - st.lx;
    const dz = c.z - st.lz;
    let D = Math.hypot(dx, dz);
    const x0 = st.lx, z0 = st.lz;
    st.lx = c.x;
    st.lz = c.z;
    st.seen = this.frame;
    // teleports (flashback, reset, pit) or a paused frame: just resync
    if (D > 30 || dt <= 0 || I < 0.02 || c.camDist > 420) return I;
    if (D < 1e-4) return I;

    const lod = c.camDist < 80 ? 0 : c.camDist < 200 ? 1 : 2;
    const q = this.quality;
    const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
    // forward f = (sy, 0, cy); left l = (cy, 0, -sy)
    const halfR = c.trackR / 2, halfF = c.trackF / 2, zr = -c.wheelbase / 2, zf = c.wheelbase / 2;
    const g = c.y;
    const vx = c.vx, vz = c.vz;
    const rnd = Math.random;
    // spray albedo: fine water droplets scatter nearly all the light they get — a plume under a grey
    // sky is about as bright as the light falling on it, a little under the horizon sky behind it
    // (it never clips where the sky doesn't). At 0.54 a plume 150 m down the road read as dark
    // smoke against the wet haze, darker than the air it hung in.
    const bright = (0.7 + 0.06 * I) * p.mistGain;
    const selfK = c.self ? 0.4 : 1;
    // standing water, not just a wet surface: a storm's flooded track throws a taller, wider plume
    // that hangs longer (Spa 2021, Silverstone 2023: a wall of spray 4–6 m high behind every car)
    const deep = smooth(0.45, 1, c.wet);

    const run = (slot: number, spacing: number, fn: (px: number, pz: number, pre: number) => void) => {
      let a = st!.acc[slot] + D;
      if (a < spacing) {
        st!.acc[slot] = a;
        return;
      }
      // cap per frame so a hitch can't flood the pool
      let n = 0;
      while (a >= spacing && n < 6) {
        a -= spacing;
        const f = 1 - a / D; // where along this frame's path it happened
        fn(x0 + dx * f, z0 + dz * f, (1 - f) * dt);
        n++;
      }
      st!.acc[slot] = a % spacing;
    };

    // ---- plume (rooster tail)
    // fill rate is the budget (fill ∝ count × area, opacity ∝ alpha × count) — but too few, too
    // dense puffs read from above and from the long lenses as a string of cotton balls: a plume is a
    // continuous trail, so more of them, fainter, overlapping (and its opacity is the path through
    // it: tens of metres of trail from behind — a wall — but only its few metres of depth from the
    // helicopter, where the cars in it stay visible)
    const spP = (lod === 0 ? 2.6 : lod === 1 ? 4.4 : 8.0) / q / (0.55 + 0.45 * I);
    const sizeK = lod === 0 ? 1 : lod === 1 ? 1.25 : 1.6;
    const plume = (side: number) => (px: number, pz: number, pre: number) => {
      const r = rnd();
      const lx = side === 0 ? (rnd() - 0.5) * 0.5 : side * halfR;
      const lz = side === 0 ? zr - 0.75 : zr - 0.32;
      const ly = side === 0 ? 0.35 + rnd() * 0.3 : 0.22 + rnd() * 0.15;
      const wx = px + sy * lz + cy * lx;
      const wz = pz + cy * lz - sy * lx;
      const out = side === 0 ? (rnd() - 0.5) * 0.8 : side * (0.15 + rnd() * 0.8);
      const k = 0.55 + rnd() * 0.3;
      // thrown steeply up behind the tyres, then hanging: rises ~2–3.5 m within ~0.4 s
      const up = (3.8 + rnd() * 3.4) * (0.45 + 0.55 * I) * (side === 0 ? 1.15 : 1) * (1 + 0.55 * deep);
      p.puff(
        wx, g + ly, wz,
        vx * k + cy * out, up, vz * k - sy * out,
        (1.0 + 1.6 * r) * (0.55 + 0.45 * I) * (1 + 0.45 * deep), (0.45 + 0.25 * rnd()) * sizeK, (1.2 + 1.0 * r) * (0.6 + 0.4 * I) * sizeK * (1 + 0.4 * deep),
        Math.min(0.45, (0.25 + 0.16 * rnd()) * Math.pow(I, 0.75) * (lod === 2 ? 1.2 : 1) * (1 + 0.2 * deep)) * selfK, bright,
        // (born compact at the tyre and faded in over its first ~0.2 s: the footage's plume is
        // thin right at the diffuser and thickest a few metres back, so the car stays readable
        // inside it instead of drawing as a white ghost; eroded into wisps as it spreads)
        // (stretch −1: drawn as a trail when seen from above — Particles SOFT_VERT)
        1.1, -0.1, -1, g, 0.5, 0.08, 2.6, pre,
      );
    };
    run(E_PLUME_L, spP, plume(1));
    run(E_PLUME_R, spP, plume(-1));
    if (lod < 2) run(E_PLUME_C, spP * 1.6, plume(0));

    // ---- mist that lingers over the track
    if (lod < 2 || rnd() < 0.5) {
      run(E_MIST, (lod === 0 ? 15 : 22) / q, (px, pz, pre) => {
        const back = -2.5 - rnd() * 2;
        p.puff(
          px + sy * back + (rnd() - 0.5) * 1.5, g + 0.6 + rnd() * 0.8, pz + cy * back + (rnd() - 0.5) * 1.5,
          vx * 0.22, 0.25 + rnd() * 0.4, vz * 0.22,
          (2.2 + rnd() * 1.4) * (0.6 + 0.4 * I) * (1 + 0.6 * deep), 1.4 * sizeK, (3.6 + rnd() * 1.8) * sizeK * (1 + 0.3 * deep),
          (0.16 + 0.08 * deep) * Math.pow(I, 0.8) * selfK, bright, 0.9, 0, -1, g, 0.4, 0.12, 0.8, pre,
        );
      });
    }

    if (lod > 0) return I;

    // ---- sheets off the rear tread (velocity-stretched)
    const spS = 1.8 / q;
    const sheet = (side: number) => (px: number, pz: number, pre: number) => {
      const lx = side * (halfR + (rnd() - 0.5) * 0.25);
      const lz = zr - 0.3;
      const wx = px + sy * lz + cy * lx;
      const wz = pz + cy * lz - sy * lx;
      const out = side * (0.4 + rnd() * 1.8);
      const k = 0.5 + rnd() * 0.25;
      p.puff(
        wx, g + 0.3 + rnd() * 0.2, wz,
        vx * k + cy * out, (2.5 + rnd() * 3.5) * (0.5 + 0.5 * I), vz * k - sy * out,
        0.3 + rnd() * 0.25, 0.18, 0.7 + rnd() * 0.5,
        0.6 * I * (c.self ? 0.6 : 1), 0.8 * p.mistGain, 3.0, 2.5, 0.035, g, 0.25, 0.05, 3.0, pre,
      );
    };
    run(E_SHEET_L, spS, sheet(1));
    run(E_SHEET_R, spS, sheet(-1));

    // ---- front tyres: sideways fans
    const spF = 2.8 / q;
    const front = (side: number) => (px: number, pz: number, pre: number) => {
      const lx = side * (halfF + 0.12);
      const lz = zf - 0.2 - rnd() * 0.2;
      const wx = px + sy * lz + cy * lx;
      const wz = pz + cy * lz - sy * lx;
      const out = side * (1.6 + rnd() * 3.2);
      const k = 0.55 + rnd() * 0.2;
      p.puff(
        wx, g + 0.18 + rnd() * 0.15, wz,
        vx * k + cy * out, (0.7 + rnd() * 1.6) * (0.5 + 0.5 * I), vz * k - sy * out,
        0.35 + rnd() * 0.35, 0.16, 0.8 + rnd() * 0.5,
        0.32 * I * (c.self ? 0.6 : 1), 0.76 * p.mistGain, 2.6, 1.2, 0.012, g, 0.35, 0.06, 2.0, pre,
      );
    };
    run(E_FRONT_L, spF, front(1));
    run(E_FRONT_R, spF, front(-1));

    // ---- water flung off the front tyres' tread: what the grooves carry round comes off the top of the
    // tyre, moving forward at the tread's speed, and the air stops it dead within a few centimetres and
    // blows it back over the wheel — the fine, ragged fan of mist streaming off the top of the front
    // tyres in every wet onboard (wheel cam, T-cam); only the cameras close to it can see it
    if (c.camDist < 30) {
      const spT = 1.1 / q;
      const tread = (side: number) => (px: number, pz: number, pre: number) => {
        const lx = side * (halfF + (rnd() - 0.5) * 0.3);
        const lz = zf + TYRE_R * (rnd() * 0.5 - 0.3);
        const wx = px + sy * lz + cy * lx;
        const wz = pz + cy * lz - sy * lx;
        const k = 0.8 + rnd() * 0.18;
        const out = side * (rnd() - 0.3) * 1.5;
        p.puff(
          wx, g + TYRE_R * (1.75 + rnd() * 0.3), wz,
          vx * k + cy * out, (1.5 + rnd() * 2.5) * (0.5 + 0.5 * I), vz * k - sy * out,
          0.2 + rnd() * 0.2, 0.05, 0.25 + rnd() * 0.25,
          0.42 * I * (c.self ? 0.75 : 1), 0.82 * p.mistGain, 9.0, 2.0, 0.03, g, 0.45, 0.05, 4.0, pre,
        );
      };
      run(E_TREAD_L, spT, tread(1));
      run(E_TREAD_R, spT, tread(-1));
    }
    return I;
  }

  /** forget cars not seen for a while (call once per frame after all emits) */
  endFrame() {
    this.frame++;
    if (this.frame % 120 === 0) for (const [k, s] of this.cars) if (this.frame - s.seen > 60) this.cars.delete(k);
  }

  reset() {
    this.cars.clear();
  }
}
