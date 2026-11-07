import { Kart, type KartInput } from './kart-sim.ts';
import type { KartTrack } from './kart-track.ts';

/**
 * The race itself, with no drawing in it: every kart, kart on kart, the slipstream, how far round
 * each one is, and getting anyone who's truly stuck back on the road. Each browser steps its own
 * karts and sees the rest as the network reports them, so a hit moves only the karts it owns.
 */

export const RACE = {
  laps: 2,
  /** where the line is, and the grid behind it */
  start: 64,
  row: 4.4,
  /** a body in plan: two circles, nose and tail */
  r: 0.74,
  nose: 0.72,
  tail: -0.62,
  /** how lively karts are on each other */
  e: 0.3,
  /** seconds on its side or back before the marshals right it, and how long it can't be touched after */
  flipT: 1.3,
  ghost: 2.2,
  /** the wake: how far back, how wide */
  wake: 22,
  wakeW: 2.2,
  sub: 1 / 240,
  /** stopped this long with the wheels turning: it's beached */
  stuckT: 7,
};

export interface KartHit {
  x: number;
  y: number;
  z: number;
  power: number;
  a: number;
  b: number;
}

export class Racer {
  readonly kart = new Kart();
  /** distance from the line (m): negative on the grid, past laps × length at the flag */
  prog = 0;
  private prevS = 0;
  input: KartInput = { steer: 0, throttle: 0, brake: 0, drift: false };
  /** this browser drives it */
  local = true;
  held = true;
  done = false;
  ghost = 0;
  private flip = 0;
  private stuck = 0;
  /** going the wrong way for this long */
  wrong = 0;
  /** when it crossed the line each lap (seconds after the off) */
  readonly laps: number[] = [];
  bestLap = 0;
  constructor(readonly id: number) {}
  get lap() {
    return Math.max(0, Math.floor(this.prog / this.L));
  }
  L = 1;
  /** starts on the grid */
  grid(tr: KartTrack, slot: number) {
    this.L = tr.length;
    const row = Math.floor(slot / 2), side = slot % 2 ? -1 : 1;
    const s = RACE.start - 6 - row * RACE.row - (slot % 2) * (RACE.row / 2);
    this.kart.place(tr, s, side * 3);
    this.prevS = s;
    this.prog = s - RACE.start;
  }
  /** how far it's come since last time */
  track(tr: KartTrack, x: number) {
    const k = this.kart, n = tr.length;
    let d = k.q.s - this.prevS;
    if (d > n / 2) d -= n;
    else if (d < -n / 2) d += n;
    this.prevS = k.q.s;
    const was = this.lap;
    this.prog += d;
    if (this.prog > 0 && this.lap > was && this.lap > this.laps.length) {
      const prev = this.laps[this.laps.length - 1] ?? 0;
      this.laps.push(x);
      if (this.laps.length && (!this.bestLap || x - prev < this.bestLap)) this.bestLap = x - prev;
    }
  }
  /** right way up, back on the road (the marshals, or a respawn) */
  rescue(tr: KartTrack, t: number) {
    const k = this.kart, s = k.q.s, hw = tr.hw[k.q.i] - 1.5;
    k.place(tr, s, Math.max(-hw, Math.min(hw, k.q.lat)), 3);
    this.ghost = t + RACE.ghost;
    this.flip = this.stuck = 0;
    this.prevS = k.q.s;
  }
  watch(tr: KartTrack, dt: number, t: number) {
    const k = this.kart, n = k.q;
    if (Number.isNaN(k.pos.x + k.vel.x + k.quat.w) || n.h > 40 || n.h < -8) {
      // (it should never come to this: the road is always there to go back to)
      k.pos.set(tr.P[n.i * 3], tr.P[n.i * 3 + 1] + 1, tr.P[n.i * 3 + 2]);
      k.vel.set(0, 0, 0);
      this.rescue(tr, t);
      return true;
    }
    const upright = k.ay.x * n.nx + k.ay.y * n.ny + k.ay.z * n.nz;
    this.flip = upright < 0.25 ? this.flip + dt : 0;
    const v = k.vel.length();
    this.stuck = v < 1 && (this.input.throttle > 0.5 || this.input.brake > 0.5) ? this.stuck + dt : Math.max(0, this.stuck - dt * 2);
    // (facing back up the road and moving that way)
    const o = k.q.i * 3, along = k.vel.x * tr.T[o] + k.vel.y * tr.T[o + 1] + k.vel.z * tr.T[o + 2];
    this.wrong = along < -3 ? this.wrong + dt : 0;
    if (this.flip > RACE.flipT || this.stuck > RACE.stuckT) {
      this.rescue(tr, t);
      return true;
    }
    return false;
  }
}

/** kart on kart: two circles a side, with a proper impulse at the point of contact */
export function collide(a: Racer, b: Racer, t: number, hit: (h: KartHit) => void) {
  const A = a.kart, B = b.kart;
  const dx = B.pos.x - A.pos.x, dy = B.pos.y - A.pos.y, dz = B.pos.z - A.pos.z;
  if (dx * dx + dz * dz > 16 || Math.abs(dy) > 1.5 || a.ghost > t || b.ghost > t) return;
  const D = RACE.r * 2;
  for (let i = 0; i < 2; i++) {
    const za = i ? RACE.tail : RACE.nose;
    const ax = A.pos.x + A.az.x * za, az = A.pos.z + A.az.z * za;
    for (let j = 0; j < 2; j++) {
      const zb = j ? RACE.tail : RACE.nose;
      const bx = B.pos.x + B.az.x * zb, bz = B.pos.z + B.az.z * zb;
      const ex = bx - ax, ez = bz - az, d2 = ex * ex + ez * ez;
      if (d2 >= D * D) continue;
      const d = Math.sqrt(d2) || 0.01, nx = ex / d, nz = ez / d, pen = D - d;
      const wa = a.local ? (b.local ? 0.5 : 1) : 0, wb = b.local ? (a.local ? 0.5 : 1) : 0;
      A.pos.x -= nx * pen * wa;
      A.pos.z -= nz * pen * wa;
      B.pos.x += nx * pen * wb;
      B.pos.z += nz * pen * wb;
      const px = ax + nx * RACE.r, pz = az + nz * RACE.r, py = A.pos.y + 0.05;
      const rax = px - A.pos.x, raz = pz - A.pos.z, rbx = px - B.pos.x, rbz = pz - B.pos.z;
      const vax = A.vel.x - A.ang.y * -raz, vaz = A.vel.z - A.ang.y * rax;
      const vbx = B.vel.x - B.ang.y * -rbz, vbz = B.vel.z - B.ang.y * rbx;
      const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
      if (vn <= 0) continue;
      const ia = A.invMass(px, py, pz, nx, 0, nz), ib = B.invMass(px, py, pz, nx, 0, nz);
      const J = ((1 + RACE.e) * vn) / (ia + ib);
      if (a.local) A.impulse(px, py, pz, -nx * J, 0, -nz * J);
      if (b.local) B.impulse(px, py, pz, nx * J, 0, nz * J);
      if (vn > 1.5) hit({ x: px, y: py + 0.2, z: pz, power: vn, a: a.id, b: b.id });
    }
  }
}

/** the wake: drag falls when another kart is punching the air just ahead */
export function slipstream(all: Racer[]) {
  for (const a of all) {
    const k = a.kart;
    let d = 0;
    const sp = k.vel.length();
    if (sp > 12) {
      for (const b of all) {
        if (a === b) continue;
        const o = b.kart, dx = o.pos.x - k.pos.x, dy = o.pos.y - k.pos.y, dz = o.pos.z - k.pos.z;
        const ahead = (dx * k.vel.x + dz * k.vel.z) / sp;
        if (ahead < 1.5 || ahead > RACE.wake || Math.abs(dy) > 2) continue;
        const side = Math.abs((dx * k.vel.z - dz * k.vel.x) / sp);
        if (side > RACE.wakeW) continue;
        d = Math.max(d, (1 - ahead / RACE.wake) * (1 - side / RACE.wakeW));
      }
    }
    k.draft += (Math.min(1, d * 1.6) - k.draft) * 0.08;
  }
}

/** one step of everything this browser owns; `hit` hears the bangs */
export function stepRace(all: Racer[], dt: number, tr: KartTrack, t: number, hit: (h: KartHit) => void) {
  const n = Math.max(1, Math.ceil(dt / RACE.sub - 1e-6)), h = dt / n;
  for (let k = 0; k < n; k++) {
    for (const r of all) if (r.local && !r.held) r.kart.step(h, r.input, tr);
    // (kart on kart at half the rate: nothing gets through anything at 120 Hz)
    if (k & 1 || n === 1) {
      for (let i = 0; i < all.length; i++) {
        const a = all[i];
        if (a.held) continue;
        for (let j = i + 1; j < all.length; j++) if (!all[j].held) collide(a, all[j], t, hit);
      }
    }
  }
  slipstream(all);
}
