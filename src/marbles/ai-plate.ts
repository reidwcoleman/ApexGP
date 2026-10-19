import * as THREE from 'three';
import { hzAxis, hzDist, makeHz, type Hz } from './ai-course.ts';
import type { Style } from './ai-style.ts';
import type { Course } from './courses.ts';
import { GRAVITY, JUMP_V, RADIUS, type Marble } from './physics.ts';

/**
 * Survival on the plate. A bot keeps to its own spot (a ring out where the bars come through fast,
 * so they pass under it quickly; away from the hub, the edge and the others) and holds still when
 * a bar is near. Every frame it asks each bar where it will be over the next 1.6 s and, for "don't
 * jump" and every take-off time up to 0.9 s ahead, checks the arc of its hop (and the bounce after)
 * against them: it jumps when the take-off with the most room is now. So it clears the low bar and
 * never hops into the high one, and the rising bar too. Its mistakes are a misjudged clock (a
 * steady error per hop, tiny for the best, plus the odd lapse) and a slow recovery when it's been
 * knocked. An aggressive one now and then shoves a neighbour who's nearer the edge than it is.
 */

const SLOT = 1 / 40;
const K = 64;
/** a hop's arc (height of the centre above resting, s after take-off), the bounce after it included */
const AIR = (2 * JUMP_V) / GRAVITY;
const BOUNCE_V = JUMP_V * 0.42;
const AIR2 = (2 * BOUNCE_V) / GRAVITY;
function hop(tau: number) {
  if (tau < 0) return 0;
  if (tau < AIR) return JUMP_V * tau - (GRAVITY / 2) * tau * tau;
  const t2 = tau - AIR;
  if (t2 < AIR2) return BOUNCE_V * t2 - (GRAVITY / 2) * t2 * t2;
  return 0;
}

const BARS = new WeakMap<Course, Hz[]>();
function barsOf(c: Course) {
  let b = BARS.get(c);
  if (!b) BARS.set(c, (b = c.plate!.bars.map((x) => makeHz(x.kin))));
  return b;
}

const AX = { ax: 0, ay: 1, az: 0, x: 0, y: 0, z: 0 };
const IV_LO = new Float32Array(K * 4);
const IV_HI = new Float32Array(K * 4);
const IV_N = new Uint8Array(K);
const TMP = new THREE.Vector3();
const TAN = new THREE.Vector3();

export class PlateBrain {
  private ring: number;
  private ang = NaN;
  private nextThink = 0;
  private err = 0;
  private pushCD = 0;
  /** a bar due over my spot within this long (s) */
  private due = 99;
  private tx = 0;
  private tz = 0;
  /** knocked: a moment before it gathers itself */
  private dazed = 0;
  private lastV = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    private aggr: number,
    private style: Style,
    private boost: number,
  ) {
    // out where the bars pass fast (a short window to clear), but not near the edge (a daredevil
    // stands further out, a steady one further in)
    this.ring = 7.4 + 1.9 * skill + style.ring + (rnd() - 0.5) * 1.2;
    this.newErr();
  }

  private newErr() {
    const r = this.rnd;
    const g = (r() + r() + r() - 1.5) * 1.15;
    this.err = g * (0.008 + 0.3 * Math.pow(1 - this.skill, 1.6)) * (1 - 0.5 * this.boost);
    // a lapse: late (or early) by a beat
    if (r() < 0.8 * (1 - this.skill) ** 2 * this.style.lapse) this.err += (r() < 0.7 ? 1 : -1) * (0.14 + r() * 0.22);
  }

  update(dt: number, t: number, c: Course, all: Marble[]) {
    const m = this.m;
    const P = c.plate!;
    const cx = P.center.x, cz = P.center.z;
    const dx = m.pos.x - cx, dz = m.pos.z - cz;
    const rad = Math.hypot(dx, dz);
    const ux = rad > 1e-3 ? dx / rad : 1, uz = rad > 1e-3 ? dz / rad : 0;
    if (Number.isNaN(this.ang)) this.ang = Math.atan2(dz, dx);
    const ring = Math.min(this.ring, P.radius - 3.6);
    if (t >= this.nextThink) {
      this.nextThink = t + 0.2 + this.rnd() * 0.1;
      // spread out: drift round and in or out, away from the neighbours (two hopping side by side collide)
      let push = 0, pr = 0;
      for (const o of all) {
        if (o === m || !o.active) continue;
        const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z;
        const d = Math.hypot(ox, oz);
        if (d > 5 || d < 1e-3) continue;
        const w = ((5 - d) / 5) ** 2 * 2;
        push -= ((ox * -uz + oz * ux) / d) * w;
        pr -= ((ox * ux + oz * uz) / d) * w;
      }
      this.ang += THREE.MathUtils.clamp(push * 0.9, -0.8, 0.8) / Math.max(rad, 3);
      const want = THREE.MathUtils.clamp(ring + THREE.MathUtils.clamp(pr * 0.6, -1.2, 1.2), 5.5, P.radius - 3.2);
      this.tx = cx + Math.cos(this.ang) * want;
      this.tz = cz + Math.sin(this.ang) * want;
    }
    const goT = c.state.go;
    const v = Math.hypot(m.vel.x, m.vel.z);
    // (knocked: a weaker one takes a moment to gather itself)
    if (v - this.lastV > 3 && t > this.dazed) this.dazed = t + (1 - this.skill) * (0.4 + this.rnd() * 0.8);
    this.lastV = v;
    // the bars: hop or not
    if (m.grounded && t > goT) this.timing(t, c);
    // the spot: a velocity held near zero, gently toward it; still when a bar is near
    const ex = this.tx - m.pos.x, ez = this.tz - m.pos.z;
    const k = this.due < 0.5 ? 0.25 : 1;
    const vx = THREE.MathUtils.clamp(ex * 1.1, -2.4, 2.4) * k, vz = THREE.MathUtils.clamp(ez * 1.1, -2.4, 2.4) * k;
    let ix = (vx - m.vel.x) * 0.5, iz = (vz - m.vel.z) * 0.5;
    if (!m.grounded) (ix *= 0.6), (iz *= 0.6);
    // too near the edge: back in, whatever else
    if (rad > P.radius - 2.4) {
      const f = (rad - (P.radius - 2.4)) * 0.8 + 0.5;
      ix -= ux * f;
      iz -= uz * f;
    }
    TMP.set(ix, 0, iz);
    if (TMP.lengthSq() > 1) TMP.normalize();
    if (t < this.dazed) TMP.multiplyScalar(0.15);
    m.input.copy(TMP);
    if (t > goT + 1) this.shove(t, c, all, rad, ux, uz);
    void dt;
  }

  /** the hop: the take-off (from now to 0.9 s ahead) that leaves the most room to every bar */
  private timing(t: number, c: Course) {
    const m = this.m;
    const bars = barsOf(c);
    const plateY = c.plate!.center.y;
    const b0 = Math.round((t + this.err) / SLOT);
    let any = false;
    this.due = 99;
    for (let k = 0; k < K; k++) {
      IV_N[k] = 0;
      const tau = k * SLOT;
      // (where I'll be: about here, the drift dying away)
      const f = Math.min(tau, 0.35);
      const px = m.pos.x + m.vel.x * f, pz = m.pos.z + m.vel.z * f;
      for (const h of bars) {
        const shape = h.k.shape;
        hzAxis(h, (b0 + k) * SLOT, AX);
        const al = Math.hypot(AX.ax, AX.az);
        if (shape.type !== 'cyl' || al < 0.5) {
          // (some other shape: probe the column at a few heights for the blocked stretch)
          let z0 = 9, z1 = -9;
          for (let z = RADIUS; z < 3; z += 0.5) if (hzDist(h, (b0 + k) * SLOT, px, plateY + z, pz) < RADIUS + 0.04) (z0 = Math.min(z0, z)), (z1 = Math.max(z1, z));
          if (z1 < z0 || IV_N[k] >= 4) continue;
          const n = IV_N[k]++;
          IV_LO[k * 4 + n] = z0 - 0.3;
          IV_HI[k * 4 + n] = z1 + 0.3;
          any = true;
          if (z0 < RADIUS + 0.3) this.due = Math.min(this.due, tau);
          continue;
        }
        const ax = AX.ax / al, az = AX.az / al;
        const rx = px - AX.x, rz = pz - AX.z;
        const along = rx * ax + rz * az;
        if (Math.abs(along) > shape.hh + RADIUS) continue;
        const perp = Math.abs(rx * az - rz * ax);
        const R = shape.r + RADIUS + 0.06;
        if (perp >= R) continue;
        const allow = Math.sqrt(R * R - perp * perp);
        const by = AX.y - plateY;
        if (by + allow < RADIUS - 0.2 || IV_N[k] >= 4) continue;
        const n = IV_N[k]++;
        IV_LO[k * 4 + n] = by - allow;
        IV_HI[k * 4 + n] = by + allow;
        any = true;
        if (by - allow < RADIUS + 0.3) this.due = Math.min(this.due, tau);
      }
    }
    if (!any) return;
    // room left by a hop taking off j slots from now (−1: stay down)
    const room = (j: number) => {
      let worst = 9;
      for (let k = 0; k < K; k++) {
        const n = IV_N[k];
        if (!n) continue;
        const z = RADIUS + (j < 0 ? 0 : hop((k - j) * SLOT));
        for (let q = 0; q < n; q++) {
          const lo = IV_LO[k * 4 + q], hi = IV_HI[k * 4 + q];
          const r = z < lo ? lo - z : z > hi ? z - hi : -Math.min(z - lo, hi - z);
          if (r < worst) worst = r;
        }
      }
      return worst;
    };
    if (room(-1) > 0.05) return;
    let best = 0, bestR = -Infinity;
    for (let j = 0; j <= 36; j++) {
      const r = room(j);
      if (r > bestR + 0.03) {
        bestR = r;
        best = j;
      }
    }
    if (best === 0) {
      m.jump = true;
      this.newErr();
    }
  }

  /** a shove: a neighbour nearer the edge, nothing coming, and me safely inside */
  private shove(t: number, c: Course, all: Marble[], rad: number, ux: number, uz: number) {
    const m = this.m;
    if (t < this.pushCD || m.dashCD > 0 || this.due < 1.0 || !m.grounded) return;
    if (this.aggr * this.skill * this.style.shove < 0.25 || rad > c.plate!.radius - 4.2) return;
    if (this.rnd() > 0.04 * this.aggr * this.style.shove) return;
    const P = c.plate!;
    for (const o of all) {
      if (o === m || !o.active || o.groundT > 0.1) continue;
      const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z;
      const d = Math.hypot(ox, oz);
      if (d > 2.6 || d < 1.05) continue;
      const or = Math.hypot(o.pos.x - P.center.x, o.pos.z - P.center.z);
      if (or < rad + 0.5 || or < P.radius - 5.5) continue;
      // (mostly outward, or it just pushes them round)
      if ((ox * ux + oz * uz) / d < 0.55) continue;
      TAN.set(ox / d, 0, oz / d);
      m.input.copy(TAN);
      m.dash = true;
      this.pushCD = t + (5 + this.rnd() * 5) / Math.max(1, this.style.shove * 0.7);
      return;
    }
  }
}
