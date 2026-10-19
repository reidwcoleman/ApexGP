import * as THREE from 'three';
import type { Course } from './courses.ts';
import { kinDistanceAt, type Marble } from './physics.ts';

/**
 * The other contestants. A bot reads the course a little ahead of itself, asks every obstacle
 * there where it will be by the time it arrives, and picks the clearest line (a skilled bot also
 * takes the inside of a bend and gets out of a crowd); it times jumps over gaps, waits for a hammer
 * that's about to swing through, and now and then barges a neighbour with a dash. Its reactions
 * and judgement have errors that shrink with skill — so some fall, some get flattened.
 * In Jump Club it hops the low bar by its timing and holds off when the high one is coming.
 */

const TMP = new THREE.Vector3();
const TGT = new THREE.Vector3();

export class Bot {
  hint = 0;
  private latT = 0;
  private pref: number;
  private nextThink = 0;
  private wait = 0;
  private jumpErr = 0;
  private stuckT = 0;
  private rnd: () => number;
  /** this bot's radius of comfort on the plate */
  private ring: number;
  private orbit = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    seed: number,
  ) {
    let s = seed * 9301 + 49297;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    this.pref = (this.rnd() - 0.5) * 3;
    this.ring = 5 + this.rnd() * 4;
    this.orbit = this.rnd() < 0.5 ? -1 : 1;
    this.newJumpErr();
  }

  private newJumpErr() {
    this.jumpErr = (this.rnd() - 0.5) * 2 * (1 - this.skill) * 0.32 + (this.rnd() < (1 - this.skill) * 0.12 ? (this.rnd() - 0.5) * 0.7 : 0);
  }

  reset(hint: number) {
    this.hint = hint;
    this.latT = this.pref;
    this.nextThink = 0;
    this.stuckT = 0;
  }

  update(dt: number, t: number, c: Course, all: Marble[]) {
    const m = this.m;
    m.input.set(0, 0, 0);
    if (!m.active || m.frozen) return;
    if (c.plate) return this.plate(dt, t, c, all);
    const path = c.path!;
    const pr = path.project(m.pos, this.hint, 40);
    this.hint = pr.i;
    const speed = m.vel.length();
    const look = THREE.MathUtils.clamp(5 + speed * 0.42, 6, 15);
    const sAhead = pr.s + look;
    const sec = path.sec[path.index(sAhead)];
    const walls = Math.min(sec.wallL, sec.wallR) > 0.5;
    const half = Math.max(0.3, sec.w / 2 - (walls ? 0.9 : 1.4));
    if (t >= this.nextThink) {
      this.nextThink = t + 0.1 + (1 - this.skill) * 0.25 + this.rnd() * 0.06;
      this.think(t, c, pr.s, look, half, speed, all);
    }
    const tgt = path.at(sAhead, this.latT, 0.5, TGT);
    TMP.subVectors(tgt, m.pos);
    TMP.y = 0;
    const dl = TMP.length();
    if (dl > 1e-3) TMP.divideScalar(dl);
    // the drive: flat out up to this bot's pace, steering toward the line; a gentle hold for a hammer
    const pace = 9.5 + this.skill * 6;
    let k = speed < pace ? 1 : 0.35;
    if (this.wait > t) {
      // ease off: roll against the motion a little
      const fw = path.T[pr.i];
      const vAlong = m.vel.x * fw.x + m.vel.z * fw.z;
      if (vAlong > 3) {
        TMP.set(-fw.x, 0, -fw.z).normalize().multiplyScalar(0.6).addScaledVector(TMP, 0.4);
        k = 1;
      } else k = 0.2;
    }
    // off a beam's edge: back to the middle, hard
    if (!walls && Math.abs(pr.lat) > half) {
      const r = path.Rt[pr.i];
      TMP.addScaledVector(r, -Math.sign(pr.lat) * 1.2).normalize();
    }
    m.input.copy(TMP).multiplyScalar(k);
    // gaps: jump at the lip (by its own judgement)
    for (const [g0] of c.gaps) {
      const lead = 0.5 + speed * 0.045 + this.jumpErr * 2;
      if (pr.s > g0 - lead - 0.4 && pr.s < g0 + 0.3 && m.grounded) {
        m.jump = true;
        this.newJumpErr();
      }
      // flat out into a gap
      if (pr.s > g0 - 22 && pr.s < g0) {
        const fw = path.T[pr.i];
        m.input.set(fw.x, 0, fw.z).normalize().lerp(TMP, 0.4).normalize();
      }
    }
    // stuck against something: hop and dash
    if (speed < 0.8 && t > c.state.go + 2) this.stuckT += dt;
    else this.stuckT = 0;
    if (this.stuckT > 1.2) {
      m.jump = true;
      m.dash = true;
      this.stuckT = 0;
    }
    // a barge: someone just ahead and to the side
    if (m.dashCD <= 0 && this.rnd() < dt * 0.4 * this.skill) {
      for (const o of all) {
        if (o === m || !o.active) continue;
        const d = o.pos.distanceTo(m.pos);
        if (d < 2.4 && d > 1.05) {
          TMP.subVectors(o.pos, m.pos).setY(0).normalize();
          m.input.lerp(TMP, 0.6);
          m.dash = true;
          break;
        }
      }
    }
  }

  private think(t: number, c: Course, s: number, look: number, half: number, speed: number, all: Marble[]) {
    const path = c.path!;
    const m = this.m;
    const N = 9;
    let best = this.latT, bestC = Infinity, worst = 0;
    const eta = look / Math.max(speed, 5);
    // a bend ahead: the inside is shorter (a skilled bot uses it)
    const i0 = path.index(s), i1 = path.index(s + look * 1.6);
    const t0 = path.T[i0], t1 = path.T[i1];
    const turn = t0.x * t1.z - t0.z * t1.x;
    const inside = -Math.sign(turn) * Math.min(1, Math.abs(turn) * 3) * half * 0.6 * this.skill;
    for (let k = 0; k < N; k++) {
      const lat = -half + (2 * half * k) / (N - 1);
      let cost = 0.03 * (lat - this.pref - inside) ** 2 + 0.05 * (lat - this.latT) ** 2;
      // the obstacles, where they'll be when this bot gets there (judged with this bot's error)
      for (const f of [0.55, 1]) {
        const p = path.at(s + look * f, lat, 0.5, TGT);
        const tt = t + eta * f + (this.rnd() - 0.5) * (1 - this.skill) * 0.5;
        for (const h of c.b.hazards) {
          if (h.pos.distanceToSquared(p) > (h.bound + 2) ** 2) continue;
          const d = kinDistanceAt(h, tt, p);
          if (d < 1.3) cost += (1.3 - d) * 7;
        }
      }
      // a crowd
      const p = path.at(s + look * 0.6, lat, 0.5, TGT);
      for (const o of all) {
        if (o === m || !o.active) continue;
        const d2 = o.pos.distanceToSquared(p);
        if (d2 < 2.5) cost += (2.5 - d2) * 0.35;
      }
      if (cost < bestC) {
        bestC = cost;
        best = lat;
      }
      worst = Math.max(worst, cost);
    }
    this.latT = THREE.MathUtils.clamp(best + (this.rnd() - 0.5) * (1 - this.skill) * 1.6, -half, half);
    // everything blocked (a hammer coming through): wait a moment, if this bot is patient enough
    if (bestC > 4 && this.rnd() < 0.3 + this.skill * 0.6) this.wait = t + 0.25;
  }

  // ---------------------------------------------------------------- Jump Club
  private plate(dt: number, t: number, c: Course, all: Marble[]) {
    const m = this.m;
    const P = c.plate!;
    const dx = m.pos.x - P.center.x, dz = m.pos.z - P.center.z;
    const rad = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    // the wanted spot: this bot's ring, drifting round, away from the edge
    const want = this.ring + Math.sin(t * 0.3 + this.pref) * 1.2;
    const radial = TMP.set(dx, 0, dz).normalize();
    const tang = new THREE.Vector3(-radial.z, 0, radial.x).multiplyScalar(this.orbit);
    const input = new THREE.Vector3().addScaledVector(radial, THREE.MathUtils.clamp((want - rad) * 0.5, -1, 1)).addScaledVector(tang, 0.15);
    // others too close: away
    for (const o of all) {
      if (o === m || !o.active) continue;
      const ox = m.pos.x - o.pos.x, oz = m.pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 4 && d2 > 1e-4) input.x += (ox / d2) * 0.6, (input.z += (oz / d2) * 0.6);
    }
    // keep the speed down: a marble with momentum leaves the plate
    input.addScaledVector(m.vel, -0.12);
    if (rad > P.radius - 2.5) input.addScaledVector(radial, -1.5);
    if (input.lengthSq() > 1) input.normalize();
    m.input.copy(input);
    if (!m.grounded || t < c.state.go) return;
    // the bars: when does each reach me (they sweep both halves: mod π)
    const when = (b: { angle: (t: number) => number }) => {
      const a0 = b.angle(t), a1 = b.angle(t + 0.05);
      const w = (a1 - a0) / 0.05;
      if (Math.abs(w) < 1e-3) return 99;
      let d = (ang - a0) * Math.sign(w);
      d = ((d % Math.PI) + Math.PI) % Math.PI;
      return d / Math.abs(w);
    };
    const low = when(P.bars[0]);
    const high = P.bars[1] && P.bars[1].on(t + 0.5) ? when(P.bars[1]) : 99;
    // the low bar's arrival at this radius: hop ~0.2 s before it gets here (with this bot's error)
    const lead = 0.17 + this.jumpErr * 0.6 + 0.6 / Math.max(rad, 2);
    const highDanger = high > 0.04 && high < 0.66;
    if (low < lead && low > 0.02) {
      // the high one would catch me in the air: a good bot waits for it to pass (it ducks... it can't),
      // so it jumps late and low instead — or gambles
      if (!highDanger || this.rnd() > 0.35 + this.skill * 0.5) {
        m.jump = true;
        this.newJumpErr();
      }
    }
    void dt;
  }
}
