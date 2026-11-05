import * as THREE from 'three';
import { Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { PIN } from './course-pinball.ts';
import { SHOT } from './course-bigshot.ts';
import { ROCKET } from './course-rocket.ts';

/** The bots for Pinball Panic, Big Shot and Rocket Rumble. */

/**
 * Pinball Panic: it rolls at something worth hitting while it's high on the table, and as it comes
 * down it lines up on a flipper and fires as it gets there. A nudge when it's heading for the drain.
 */
export class PinBrain {
  private tu = 0;
  private tv = 0;
  private next = 0;
  private flipAt = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
  ) {}
  update(_dt: number, t: number, c: Course, ease: number) {
    const m = this.m, A = c.pin!;
    const [u, v] = A.uv(m.pos);
    const x = t - c.state.go;
    // (in the plunger lane there's nothing to steer)
    if (u > PIN.lane) return;
    if (t > this.next) {
      this.next = t + 2 + this.rnd() * 3;
      const b = A.bumpers[Math.floor(this.rnd() * A.bumpers.length)];
      this.tu = b.u;
      this.tv = b.v;
    }
    let gu = this.tu, gv = this.tv;
    if (A.jackLit(x) && this.rnd() < 0.5 * this.skill) (gu = A.jack.u), (gv = A.jack.v);
    // (low on the table: anywhere but the middle)
    if (v > 16) {
      gu = u < PIN.mid ? PIN.mid - 4.2 : PIN.mid + 4.2;
      gv = v + 2;
    }
    const dx = gu - u, dz = gv - v, d = Math.hypot(dx, dz);
    if (d > 0.3) m.input.set(dx / d, 0, dz / d);
    // a flip: on a flipper, on the way down, and quick enough for what it is
    for (const f of A.flippers) {
      const low = f.v > 15;
      const tipU = f.u + f.dir * (low ? 2.6 : 2);
      const du = Math.abs(u - tipU), dv = f.v + 0.6 - v;
      if (du < (low ? 3 : 2.2) && dv > -1.2 && dv < 1.5 && t > this.flipAt) {
        this.flipAt = t + 0.5 + (1 - this.skill) * 0.6 + ease * 0.5 + this.rnd() * 0.3;
        if (this.rnd() < 0.5 + 0.5 * this.skill) A.flip(t, true);
      }
    }
    // the last-moment nudge away from the drain
    if (v > 22 && Math.abs(u - PIN.mid) < 1.6 && this.rnd() < 0.08 * this.skill) {
      m.input.set(u < PIN.mid ? -1 : 1, 0, -0.4).normalize();
      m.dash = true;
    }
  }
}

const B = new THREE.Vector3();

/**
 * Big Shot: the shot itself is in ShotPlay. In the air it steers for the bull and slams if the
 * crowd's under it; on the ice it fights for the middle, shoves whoever's on it, hops the bar.
 */
export class ShotBrain {
  private shove = 0;
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    private aggr: number,
  ) {}
  update(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.shot!;
    const x = t - c.state.go;
    const n = Math.floor(x / SHOT.V);
    A.bull(n, B);
    const dx = B.x - m.pos.x, dz = B.z - m.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.4) m.input.set(dx / d, 0, dz / d).multiplyScalar(Math.min(1, d / 2.2 + 0.25));
    const air = m.groundT > 0.1;
    if (air) {
      if (m.vel.y < -4 && m.pos.y < A.center.y + 9 && d < 7 && this.rnd() < 0.05 * this.aggr * (1 - 0.5 * ease)) m.dash = true;
      return;
    }
    // the bar: a hop as it comes round
    if (A.barOn(x)) {
      const a = A.barAngle(x), rx = m.pos.x - A.center.x, rz = m.pos.z - A.center.z;
      const perp = Math.abs(rx * Math.cos(a) - rz * Math.sin(a));
      if (perp < 1.5 && this.rnd() < 0.12 + 0.3 * this.skill) m.jump = true;
    }
    if (t < this.shove) return;
    for (const o of all) {
      if (o === m || !o.active || o.frozen) continue;
      const ox = o.pos.x - m.pos.x, oz = o.pos.z - m.pos.z, od = Math.hypot(ox, oz);
      if (od > 3.4 || Math.abs(o.pos.y - m.pos.y) > 1.2) continue;
      // (someone nearer the bull: get them out of it)
      if (Math.hypot(o.pos.x - B.x, o.pos.z - B.z) < d + 0.5 && this.rnd() < 0.5 * this.aggr) {
        this.shove = t + 1.4 + this.rnd();
        m.input.set(ox / od, 0, oz / od);
        m.dash = true;
        return;
      }
    }
  }
}

/**
 * Rocket Rumble: it keeps an eye on the tank. Plenty in it, it goes hunting for a ring or a bean to
 * ram; low, it goes for the nearest pad or ring it can reach. It only burns when it has to.
 */
export class RocketBrain {
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private next = 0;
  private ram = 0;
  private rest = 0;
  private P = new THREE.Vector3();
  constructor(
    readonly m: Marble,
    readonly skill: number,
    private rnd: () => number,
    private aggr: number,
  ) {}
  update(_dt: number, t: number, c: Course, all: Marble[], ease: number) {
    const m = this.m, A = c.rocket!;
    const x = t - c.state.go;
    const tank = (A.fuel.get(m.id) ?? ROCKET.fuel) / ROCKET.fuel;
    const air = m.groundT > 0.1;
    m.jet = false;
    // (the pad under it is shaking: time to go, whatever's in the tank)
    let doomed = false;
    if (!air)
      for (const p of A.pads)
        if (x > p.out - ROCKET.warn && Math.hypot(A.center.x + p.x - m.pos.x, A.center.z + p.z - m.pos.z) < p.r + 0.6) doomed = true;
    if (doomed) this.rest = 0;
    if (t > this.next) {
      this.next = t + 0.35 + (1 - this.skill) * 0.5 + ease * 0.4;
      // somewhere to land that isn't about to go
      let bd = Infinity;
      let px = A.center.x, py = A.center.y, pz = A.center.z;
      for (const p of A.pads) {
        if (x > p.out - ROCKET.warn - 1.5) continue;
        const y = A.padY(p, x);
        if (y === null) continue;
        const wx = A.center.x + p.x, wz = A.center.z + p.z;
        const d = Math.hypot(wx - m.pos.x, wz - m.pos.z);
        if (d < bd) (bd = d), (px = wx), (py = y), (pz = wz);
      }
      // the nearest ring
      let rd = Infinity;
      for (let i = 0; i < A.rings.length; i++) {
        if (x >= A.rings[i].out) continue;
        A.ringAt(i, x + 0.5, this.P);
        const d = this.P.distanceTo(m.pos);
        if (d < rd) {
          rd = d;
          if (tank < 0.6 || (t > this.rest && tank > 0.5)) (this.tx = this.P.x), (this.ty = this.P.y), (this.tz = this.P.z);
        }
      }
      const home = tank < 0.55 ? bd < rd * 1.3 : t < this.rest;
      if (home || rd === Infinity) (this.tx = px), (this.ty = py + 0.6), (this.tz = pz);
      // a rest on a pad before the next trip
      if (!air && tank < 0.8 && t > this.rest) this.rest = t + 1.6 + this.rnd() * 1.8;
      if (!air && tank > 0.9) this.rest = 0;
    }
    const dx = this.tx - m.pos.x, dz = this.tz - m.pos.z, d = Math.hypot(dx, dz);
    if (d > 0.5) m.input.set(dx / d, 0, dz / d).multiplyScalar(Math.min(1, d / 2 + 0.2));
    // (under a pad it can only bang its head: out past the rim first, then up and over)
    for (const p of A.pads) {
      const py = A.padY(p, x);
      if (py === null || m.pos.y > py - 0.1 || m.pos.y < py - 6) continue;
      const ox = m.pos.x - A.center.x - p.x, oz = m.pos.z - A.center.z - p.z, od = Math.hypot(ox, oz) || 1;
      if (od < p.r + 1.3) {
        m.input.set(ox / od, 0, oz / od);
        break;
      }
    }
    // round the mines
    for (const k of A.mines) {
      const ox = m.pos.x - k.pos.x, oy = m.pos.y - k.pos.y, oz = m.pos.z - k.pos.z;
      const od = Math.hypot(ox, oy, oz);
      if (od < 3.6 && this.rnd() < 0.3 + 0.6 * this.skill) m.input.x += (ox / od) * 1.4, (m.input.z += (oz / od) * 1.4);
    }
    if (m.input.lengthSq() > 1) m.input.normalize();
    if (m.mode === Mode.Tumble) return;
    // burn: to get off a pad, to get up to what it's after, and to stop a fall
    const fall = m.vel.y < -5;
    const below = m.pos.y + m.vel.y * 0.3 < this.ty + 0.8;
    if (!air) {
      if (t > this.rest && d > 2.5 && (tank > 0.25 || doomed)) {
        m.jump = true;
        m.jet = true;
      }
    } else if (below || fall) m.jet = true;
    // the ram: someone close by in the open air
    // (not in the opening stretch: everyone's still finding their feet)
    if (air && x > 12 && t > this.ram && m.dashCD <= 0 && tank > 0.25) {
      for (const o of all) {
        if (o === m || !o.active) continue;
        const ox = o.pos.x - m.pos.x, oy = o.pos.y - m.pos.y, oz = o.pos.z - m.pos.z, od = Math.hypot(ox, oz);
        if (od < 1 || od > 6 || Math.abs(oy) > 2.2) continue;
        this.ram = t + 2.6 + this.rnd() * 3.4;
        if (this.rnd() < this.aggr * (0.35 + 0.5 * this.skill) * (1 - 0.5 * ease)) {
          m.input.set(ox / od, 0, oz / od);
          m.dash = true;
        }
        break;
      }
    }
  }
}
