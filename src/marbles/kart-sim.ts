import * as THREE from 'three';
import { SURF, probe, type KartTrack, type Probe } from './kart-track.ts';

/**
 * A kart, simulated properly. The chassis is a rigid body (position, orientation, velocity, spin,
 * a real inertia tensor) and everything it does comes from forces at the four contact patches:
 *
 *  - suspension: a spring, a damper and a bump stop per corner, so braking pitches it, cornering
 *    rolls it, and load moves between the tyres by itself (nothing about weight transfer is scripted)
 *  - tyres: a Pacejka-shaped curve on combined slip. Longitudinal and lateral slip share one budget
 *    (the friction circle), so power or brakes take away cornering grip; grip falls as load rises
 *    (load sensitivity) and past the peak the tyre slides, which is what makes a drift a drift. The
 *    slip angle lags (relaxation length), and tyres warm up and go off
 *  - driveline: a torque curve, five gears, a clutch, and a solid rear axle: a kart has no
 *    differential, so both rear wheels turn at one speed and the inside one scrubs
 *  - steering: Ackermann angles on the fronts, castor pulling them toward the way the kart is going
 *  - air: drag, a little downforce, and a slipstream behind other karts
 *
 * Bots run exactly this with the same four inputs a player has. Nothing here knows who's driving.
 *
 * Three things stand in for what a keyboard can't do, for bots and people alike: the throttle and
 * brake ease off past the peak of the tyre (a foot would), a drift's hands set the angle you want
 * and the fronts countersteer to hold it, and past 40 degrees a drift is gathered up. The slide
 * itself is still the tyres: the same forces, the same loss of speed, the same way of going wrong.
 */

/** this world's gravity: a touch over real, for a planted toy-scale kart */
export const G = 12;

export const KART = {
  mass: 185,
  /** moments of inertia: pitch (about left), yaw (about up), roll (about forward) */
  Ip: 88,
  Iy: 104,
  Ir: 44,
  /** centre of mass above the road, and how far it sits from each axle */
  hcg: 0.36,
  a: 1.12,
  b: 0.86,
  trackF: 1.5,
  trackR: 1.62,
  rF: 0.26,
  rR: 0.29,
  /** suspension: free travel, spring, damper, stiffer stop near full compression */
  rest: 0.13,
  k: 16500,
  c: 1000,
  stopAt: 0.105,
  stopK: 95000,
  /** one bar per axle resisting roll */
  arb: 5000,
  /**
   * castor jacking: a kart has a solid axle and no differential, so to get round a bend it steers
   * its inside rear wheel off the road. Turning the fronts rolls the chassis diagonally: load comes
   * off the inside rear and goes onto the inside front (N per radian of steering)
   */
  jack: 1500,
  /** tyres: peak grip at rated load (the rears are wider), how fast it falls with load, the slip at the peak */
  mu: 1.38,
  muR: 1.14,
  loadK: 0.09,
  Fz0: 545,
  alphaF: 0.135,
  alphaR: 0.105,
  kappa: 0.11,
  /** shape: the peak sits at slip 1 and a sliding tyre keeps about 80% */
  C: 1.42,
  B: 2.02,
  relax: 0.28,
  /** engine: Nm at each 1000 rpm from 0 */
  torque: [8, 10, 12, 14, 15.5, 17, 18.5, 20, 21.5, 23, 24, 24.6, 24.2, 22.5, 12, 0],
  limit: 14000,
  idle: 2600,
  Ie: 0.012,
  gears: [27.5, 20.4, 16, 13.2, 11.3],
  reverse: -24,
  shiftT: 0.07,
  clutchCap: 46,
  Ia: 0.34,
  Iw: 0.05,
  brakeT: 1050,
  brakeF: 0.42,
  /** air */
  drag: 0.56,
  lift: 0.12,
  roll: 26,
  /** steering: full lock (rad), how fast the wheel turns (per second), how much the castor helps */
  lock: 0.46,
  steerRate: 3.6,
  castor: 0.78,
  /** the drift: rear grip while held, handbrake kick, seconds for each level of boost */
  driftGrip: 0.84,
  driftLock: 0.34,
  /** the angle a drift settles at (rad): hands neutral, hands full in; and how hard the fronts work to hold it */
  driftAngle: [0.26, 0.5],
  driftP: 1.1,
  driftD: 0.14,
  kick: 300,
  kickT: 0.12,
  charge: [0.75, 1.6],
  boostT: [0.55, 1.05],
  boostK: 1.5,
};

export interface KartInput {
  /** -1 left .. 1 right */
  steer: number;
  throttle: number;
  brake: number;
  drift: boolean;
}

interface Wheel {
  /** attachment, kart frame (x left, y up, z forward) */
  x: number;
  y: number;
  z: number;
  r: number;
  front: boolean;
  side: number;
  /** spin (rad/s), angle (for the drawing), suspension compression, last load */
  w: number;
  spin: number;
  comp: number;
  Fz: number;
  on: boolean;
  /** the lagged lateral slip, this frame's slips, how much it's sliding (0..) */
  la: number;
  kap: number;
  slide: number;
  temp: number;
  mat: number;
  /** the contact point */
  cx: number;
  cy: number;
  cz: number;
  q: Probe;
}

const wheel = (x: number, y: number, z: number, r: number, front: boolean, side: number): Wheel => ({ x, y, z, r, front, side, w: 0, spin: 0, comp: 0, Fz: 0, on: false, la: 0, kap: 0, slide: 0, temp: 0.25, mat: 0, cx: 0, cy: 0, cz: 0, q: probe() });

/** torque at rpm with the throttle open */
function curve(rpm: number) {
  const T = KART.torque, u = Math.min(T.length - 1.001, Math.max(0, rpm / 1000)), i = Math.floor(u);
  return T[i] + (T[i + 1] - T[i]) * (u - i);
}

const up = new THREE.Vector3(0, 1, 0);
const Qd = new THREE.Quaternion();

export class Kart {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** spin, world frame */
  readonly ang = new THREE.Vector3();
  readonly quat = new THREE.Quaternion();
  readonly wheels: Wheel[];
  /** where it is on the ribbon */
  readonly q = probe();
  private qc = probe();
  hint = 0;
  /** the wheel angle (rad, + left), and the driver's hands (-1..1, + right) */
  delta = 0;
  hands = 0;
  rpm = KART.idle;
  gear = 1;
  shift = 0;
  /** the rear axle is on the clutch with this much slip */
  clutchSlip = 0;
  /** forward, sideways speed; slip angle of the kart */
  vf = 0;
  vl = 0;
  beta = 0;
  /** airborne for this long */
  air = 0;
  /** behind someone (0..1): less drag */
  draft = 0;
  /** grip left in the rears, how long the drift's been held, the charge it's built, boost left */
  rearGrip = 1;
  driftT = 0;
  drifting = false;
  level = 0;
  boost = 0;
  private kick = 0;
  private held = false;
  private betaLast = 0;
  private betaRate = 0;
  private driftDir = 0;
  /** the driver's right foot and left: eased off when the tyres start to go */
  private tc = 1;
  private abs = 1;
  /** a boost was just fired (the game's sound and the flame) */
  fired = 0;
  /** this frame: the hardest wall and floor hits (m/s), and which way the wall was */
  wallHit = 0;
  scrape = 0;
  landed = 0;
  wx = 0;
  wy = 0;
  wz = 0;
  /** the frame: left, up, forward */
  readonly ax = new THREE.Vector3();
  readonly ay = new THREE.Vector3();
  readonly az = new THREE.Vector3();
  /** a stop on a bank holds, and the throttle's what you've actually got on */
  throttle = 0;
  brake = 0;
  private fxs = 0;
  private fys = 0;
  private fzs = 0;
  private txs = 0;
  private tys = 0;
  private tzs = 0;

  constructor() {
    const K = KART, ya = -K.hcg + K.rF + K.rest - 0.05, yb = -K.hcg + K.rR + K.rest - 0.05;
    this.wheels = [wheel(K.trackF / 2, ya, K.a, K.rF, true, 1), wheel(-K.trackF / 2, ya, K.a, K.rF, true, -1), wheel(K.trackR / 2, yb, -K.b, K.rR, false, 1), wheel(-K.trackR / 2, yb, -K.b, K.rR, false, -1)];
  }

  /** puts it on the ribbon, stopped, facing up the road */
  place(tr: KartTrack, s: number, lat: number, speed = 0) {
    const i = tr.idx(Math.round(s));
    this.hint = i;
    tr.point(s, lat, KART.hcg + 0.02, this.pos);
    const o = i * 3;
    this.az.set(tr.T[o], tr.T[o + 1], tr.T[o + 2]);
    this.ay.set(tr.U[o], tr.U[o + 1], tr.U[o + 2]);
    this.ax.crossVectors(this.ay, this.az).normalize();
    this.ay.crossVectors(this.az, this.ax).normalize();
    M.makeBasis(this.ax, this.ay, this.az);
    this.quat.setFromRotationMatrix(M);
    this.vel.copy(this.az).multiplyScalar(speed);
    this.ang.set(0, 0, 0);
    this.rearGrip = 1;
    this.drifting = false;
    this.driftT = this.level = this.boost = this.kick = 0;
    this.gear = 1;
    this.rpm = KART.idle;
    for (const w of this.wheels) {
      w.w = speed / w.r;
      w.la = w.kap = w.slide = 0;
      w.comp = 0.05;
      w.Fz = KART.Fz0;
    }
    this.delta = this.hands = 0;
    tr.at(this.pos.x, this.pos.y, this.pos.z, i, this.q);
  }

  /** a hit at a point (world): impulse (j) on a body with this inertia */
  impulse(px: number, py: number, pz: number, jx: number, jy: number, jz: number) {
    const K = KART, p = this.pos;
    this.vel.x += jx / K.mass;
    this.vel.y += jy / K.mass;
    this.vel.z += jz / K.mass;
    const rx = px - p.x, ry = py - p.y, rz = pz - p.z;
    const tx = ry * jz - rz * jy, ty = rz * jx - rx * jz, tz = rx * jy - ry * jx;
    this.spinBy(tx, ty, tz);
  }
  /** an angular impulse through the inverse inertia, which lives in the kart's frame */
  private spinBy(tx: number, ty: number, tz: number) {
    const { ax, ay, az, ang } = this, K = KART;
    const a = (tx * ax.x + ty * ax.y + tz * ax.z) / K.Ip, b = (tx * ay.x + ty * ay.y + tz * ay.z) / K.Iy, c = (tx * az.x + ty * az.y + tz * az.z) / K.Ir;
    ang.x += ax.x * a + ay.x * b + az.x * c;
    ang.y += ax.y * a + ay.y * b + az.y * c;
    ang.z += ax.z * a + ay.z * b + az.z * c;
  }
  /** how hard a point resists a push along a direction (1 / effective mass) */
  invMass(px: number, py: number, pz: number, nx: number, ny: number, nz: number) {
    const K = KART, p = this.pos, { ax, ay, az } = this;
    const rx = px - p.x, ry = py - p.y, rz = pz - p.z;
    const cx = ry * nz - rz * ny, cy = rz * nx - rx * nz, cz = rx * ny - ry * nx;
    const a = cx * ax.x + cy * ax.y + cz * ax.z, b = cx * ay.x + cy * ay.y + cz * ay.z, c = cx * az.x + cy * az.y + cz * az.z;
    return 1 / K.mass + (a * a) / K.Ip + (b * b) / K.Iy + (c * c) / K.Ir;
  }

  /** the frame from the orientation (for a kart the network moved) */
  refresh() {
    this.frame();
  }
  private frame() {
    const q = this.quat, x = q.x, y = q.y, z = q.z, w = q.w;
    this.ax.set(1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w));
    this.ay.set(2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w));
    this.az.set(2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y));
  }

  private force(px: number, py: number, pz: number, fx: number, fy: number, fz: number) {
    const p = this.pos, rx = px - p.x, ry = py - p.y, rz = pz - p.z;
    this.fxs += fx;
    this.fys += fy;
    this.fzs += fz;
    this.txs += ry * fz - rz * fy;
    this.tys += rz * fx - rx * fz;
    this.tzs += rx * fy - ry * fx;
  }

  /** the gear for the road speed (by the kart's speed, not the wheels': a drift mustn't change up) */
  private gearbox(h: number) {
    const K = KART;
    this.shift = Math.max(0, this.shift - h);
    if (this.gear <= 0 || this.shift > 0) return;
    const road = (Math.max(this.vel.length() * Math.sign(this.vf + 0.01), 0) / K.rR) * (30 / Math.PI);
    const now = road * K.gears[this.gear - 1];
    if (now > 13300 && this.gear < 5) {
      this.gear++;
      this.shift = K.shiftT;
    } else if (this.gear > 1 && road * K.gears[this.gear - 2] < 11200) {
      this.gear--;
      this.shift = K.shiftT;
    }
  }

  step(h: number, inp: KartInput, tr: KartTrack) {
    const K = KART, W = this.wheels, { pos, vel, ang, ax, ay, az } = this;
    this.frame();
    tr.at(pos.x, pos.y, pos.z, this.hint, this.q);
    this.hint = this.q.i;
    this.vf = vel.dot(az);
    this.vl = vel.dot(ax);
    const v = Math.hypot(this.vf, this.vl);
    this.beta = v > 2 ? Math.atan2(this.vl, Math.max(Math.abs(this.vf), 0.5)) : 0;
    // ---- the steering wheel: rate-limited, and the lock narrows with speed so a full turn of the
    // wheel is what the fronts can actually use (past that a tyre only scrubs)
    const handsTo = THREE.MathUtils.clamp(inp.steer, -1, 1);
    // (a tap is a nudge, a hold is full lock; back to the middle is always quick)
    const rate = K.steerRate * (Math.abs(handsTo) < Math.abs(this.hands) || Math.sign(handsTo) !== Math.sign(this.hands) ? 1.8 : 1);
    this.hands += THREE.MathUtils.clamp(handsTo - this.hands, -rate * h, rate * h);
    const grounded = W[0].on || W[1].on;
    const reach = Math.atan(((K.a + K.b) * K.mu * G * 0.74) / Math.max(v * v, 1)) + K.alphaF * 0.62;
    // (in a drift the fronts have nothing to scrub: all the lock you want)
    const lock = Math.min(K.lock, Math.max(0.09, reach, this.rearGrip < 0.95 ? K.driftLock : 0));
    // castor: left alone the fronts swing toward the way the kart's actually going
    const trail = v > 5 ? THREE.MathUtils.clamp(this.beta, -0.7, 0.7) * K.castor * Math.min(1, (v - 5) / 4) : 0;
    let want = THREE.MathUtils.clamp(-this.hands * lock + (this.vf > 0 ? trail : 0), -K.lock - 0.1, K.lock + 0.1);
    // a keyboard can't catch a slide by feel, so in a drift the hands set the ANGLE you want and the
    // fronts are worked to hold it: countersteer toward the slide, damped by how fast it's changing
    const db = (this.beta - this.betaLast) / h;
    this.betaLast = this.beta;
    this.betaRate += (db - this.betaRate) * Math.min(1, h * 30);
    if (this.rearGrip < 0.965 && v > 5 && this.vf > 0) {
      if (!this.driftDir) this.driftDir = Math.sign(this.hands || this.beta) || 1;
      const inward = THREE.MathUtils.clamp(this.hands * this.driftDir, -1, 1);
      const target = this.driftDir * (K.driftAngle[0] + (K.driftAngle[1] - K.driftAngle[0]) * Math.max(0, inward)) * (inward < -0.3 ? 0.4 : 1);
      want = this.beta * 0.92 + (this.beta - target) * K.driftP + this.betaRate * K.driftD;
      want = THREE.MathUtils.clamp(want, -K.lock - 0.15, K.lock + 0.15);
    } else this.driftDir = 0;
    this.delta += (want - this.delta) * Math.min(1, h * 30);
    // Ackermann: the inside front turns tighter than the outside one
    const L = K.a + K.b, tn = Math.tan(this.delta), half = (K.trackF / 2) * tn;
    const dL = Math.atan2(L * tn, L - half), dR = Math.atan2(L * tn, L + half);
    // ---- the driver's feet, and the drift
    let thr = THREE.MathUtils.clamp(inp.throttle, 0, 1);
    let brk = THREE.MathUtils.clamp(inp.brake, 0, 1);
    this.throttle = thr;
    this.brake = brk;
    // (nobody holds a keyboard key at 70%. Wheelspin past the peak, or a locking brake, and the foot
    // comes up by itself, the way a driver's would. Holding DRIFT asks for the slide: it stays out of it)
    const spinUp = Math.max(W[2].on ? W[2].kap : 0, W[3].on ? W[3].kap : 0);
    const lockUp = Math.min(W[0].on ? W[0].kap : 0, W[1].on ? W[1].kap : 0, W[2].on ? W[2].kap : 0, W[3].on ? W[3].kap : 0);
    // (by slip speed too: on full lock at a crawl the solid axle always looks like wheelspin)
    const spinning = spinUp > K.kappa * 1.2 && W[2].w * W[2].r - this.vf > 1.1 && v > 3.5;
    this.tc = THREE.MathUtils.clamp(this.tc + (spinning ? -h * 14 : h * 7), 0.3, 1);
    this.abs = THREE.MathUtils.clamp(this.abs + (lockUp < -K.kappa * 1.35 ? -h * 16 : h * 9), 0.3, 1);
    if (!inp.drift) thr *= this.tc;
    brk *= this.abs;
    const start = inp.drift && !this.held && v > 7 && !!(W[2].on || W[3].on);
    if (start) this.kick = K.kickT;
    const wasDrift = this.drifting;
    if (inp.drift && v > 6) this.drifting = true;
    if (!inp.drift || v < 4) this.drifting = false;
    this.held = inp.drift;
    this.kick = Math.max(0, this.kick - h);
    this.rearGrip += ((this.drifting ? K.driftGrip : 1) - this.rearGrip) * Math.min(1, h * (this.drifting ? 11 : 5));
    if (this.drifting && Math.abs(this.beta) > 0.14 && this.air < 0.1) {
      this.driftT += h;
      this.level = this.driftT > K.charge[1] ? 2 : this.driftT > K.charge[0] ? 1 : 0;
    } else if (!this.drifting) {
      if (wasDrift && this.level > 0) {
        this.boost = K.boostT[this.level - 1];
        this.fired = this.level;
      }
      this.driftT = 0;
      this.level = 0;
    }
    this.boost = Math.max(0, this.boost - h);
    // ---- the gearbox and the reverse: the brake held at a standstill backs you up
    this.gearbox(h);
    let rev = false;
    if (brk > 0.3 && thr < 0.1 && this.vf < 0.6 && this.gear >= 0) {
      this.gear = 0;
    } else if (this.gear === 0 && (thr > 0.1 || brk < 0.1 || this.vf < -8)) {
      if (thr > 0.1 || brk < 0.1) this.gear = 1;
    }
    if (this.gear === 0) {
      rev = true;
      thr = this.vf > -7 ? inp.brake : 0;
    }
    const ratio = rev ? K.reverse : K.gears[this.gear - 1];
    // ---- the corners
    this.fxs = this.fys = this.fzs = this.txs = this.tys = this.tzs = 0;
    let rearT = 0, rearK = 0, airborne = true;
    const jack = THREE.MathUtils.clamp(this.delta, -0.22, 0.22) * K.jack;
    const wasAir = this.air;
    for (let k = 0; k < 4; k++) {
      const w = W[k];
      const px = pos.x + ax.x * w.x + ay.x * w.y + az.x * w.z;
      const py = pos.y + ax.y * w.x + ay.y * w.y + az.y * w.z;
      const pz = pos.z + ax.z * w.x + ay.z * w.y + az.z * w.z;
      const q = tr.at(px, py, pz, this.hint, w.q);
      const nx = q.nx, ny = q.ny, nz = q.nz;
      const nu = nx * ay.x + ny * ay.y + nz * ay.z;
      // (spring length: from the attachment to the wheel's centre with the tyre on the road)
      const len = (q.h - w.r) / Math.max(nu, 0.35);
      const x = K.rest - len;
      w.mat = q.mat;
      if (x <= 0 || nu < 0.3) {
        w.on = false;
        w.comp = 0;
        w.Fz = 0;
        w.slide = 0;
        continue;
      }
      airborne = false;
      w.on = true;
      w.comp = x;
      // contact point and its velocity
      const cx = px - nx * q.h, cy = py - ny * q.h, cz = pz - nz * q.h;
      w.cx = cx;
      w.cy = cy;
      w.cz = cz;
      const rx = cx - pos.x, ry = cy - pos.y, rz = cz - pos.z;
      const vx = vel.x + ang.y * rz - ang.z * ry, vy = vel.y + ang.z * rx - ang.x * rz, vz = vel.z + ang.x * ry - ang.y * rx;
      const vn = vx * nx + vy * ny + vz * nz;
      let Fz = K.k * x - K.c * vn;
      if (x > K.stopAt) Fz += K.stopK * (x - K.stopAt);
      // (the diagonal: inside rear lighter, inside front heavier, outside the other way)
      Fz += jack * w.side * (w.front ? 1 : -1);
      if (Fz < 0) Fz = 0;
      w.Fz = Fz;
      if (wasAir > 0.12 && -vn > this.landed) this.landed = -vn;
      // the tyre's own directions on the road
      const d = w.front ? (w.side > 0 ? dL : dR) : 0, cd = Math.cos(d), sd = Math.sin(d);
      let fx = az.x * cd + ax.x * sd, fy = az.y * cd + ax.y * sd, fz = az.z * cd + ax.z * sd;
      const dn = fx * nx + fy * ny + fz * nz;
      fx -= nx * dn;
      fy -= ny * dn;
      fz -= nz * dn;
      const fl = 1 / Math.hypot(fx, fy, fz);
      fx *= fl;
      fy *= fl;
      fz *= fl;
      const lx = ny * fz - nz * fy, ly = nz * fx - nx * fz, lz = nx * fy - ny * fx;
      const vxw = vx * fx + vy * fy + vz * fz, vyw = vx * lx + vy * ly + vz * lz;
      // slip: lateral through its relaxation length, longitudinal from the wheel
      const vref = Math.max(Math.abs(vxw), 3);
      const sl = vyw / vref;
      w.la += (sl - w.la) * Math.min(1, h * (Math.abs(vxw) / K.relax + 40));
      const wr = w.w * w.r;
      const kap = (wr - vxw) / Math.max(Math.abs(vxw), Math.abs(wr) * 0.5, 3);
      w.kap = kap;
      const sx = kap / K.kappa, sy = w.la / (w.front ? K.alphaF : K.alphaR);
      const rho = Math.hypot(sx, sy);
      // grip: rated, falling with load, the surface, the tyre's heat, the drift
      const load = Fz / K.Fz0;
      const heat = 0.93 + 0.07 * Math.min(1, w.temp / 0.55) - 0.05 * Math.max(0, w.temp - 1);
      const mu = K.mu * (1 - K.loadK * (load - 1)) * SURF[q.mat].mu * heat * (w.front ? 1 : K.muR * this.rearGrip);
      const D = mu * Fz;
      let Fx = 0, Fy = 0, f = 0;
      if (rho > 1e-5) {
        f = Math.sin(K.C * Math.atan(K.B * rho));
        Fx = (D * f * sx) / rho;
        Fy = (-D * f * sy) / rho;
      }
      w.slide = Math.max(0, rho - 1);
      w.temp += h * (Math.min(rho, 3) * Math.min(Math.abs(vxw), 25) * 0.0042 * load - (w.temp - 0.2) * 0.05);
      // rolling drag, and the drag of whatever it's sunk in
      const res = (K.roll * load * 0.25 + SURF[q.mat].drag * Fz * Math.abs(vxw) * 0.5) * Math.sign(vxw);
      this.force(cx, cy, cz, nx * Fz + fx * (Fx - res) + lx * Fy, ny * Fz + fy * (Fx - res) + ly * Fy, nz * Fz + fz * (Fx - res) + lz * Fy);
      // the wheels: an implicit step, because a tyre on the road is far stiffer than the wheel is heavy
      const stiff = (D * K.C * K.B * Math.max(0.15, 1 - rho * 0.6)) / (K.kappa * Math.max(Math.abs(vxw), 3)) * w.r;
      if (w.front) {
        const I = K.Iw, Tb = brk * K.brakeT * K.brakeF * 0.5;
        const dw = (h * (-Fx * w.r)) / (I + h * w.r * stiff);
        w.w += dw;
        const lockd = Math.min(Math.abs(w.w), (h * Tb) / (I + h * w.r * stiff));
        w.w -= Math.sign(w.w) * lockd;
      } else {
        rearT += -Fx * w.r;
        rearK += w.r * stiff;
      }
    }
    // (both rear wheels are one solid axle)
    // the wheels that left the road spin down on their own
    for (let k = 0; k < 2; k++) if (!W[k].on) W[k].w *= 1 - h * 0.4;
    // ---- engine, clutch, axle
    const axle = W[2].w;
    const Te0 = curve(this.rpm), we = (this.rpm * Math.PI) / 30;
    const cut = this.shift > 0 ? 0.1 : 1;
    const lim = this.rpm > K.limit ? 0 : 1;
    const boost = this.boost > 0 ? K.boostK : 1;
    const Te = Te0 * thr * cut * lim * boost - (1 - thr) * (1.2 + this.rpm / 2200);
    const wa = axle * ratio;
    // the clutch bites as the revs rise and on a held gear stays shut
    const cap = K.clutchCap * THREE.MathUtils.clamp((this.rpm - 6200) / 3000, 0, 1) * (this.shift > 0 ? 0.25 : 1);
    const dwc = we - wa;
    let Tc: number;
    const lockDrive = Math.abs(dwc) < 40 && cap > 20;
    const Ia = K.Ia;
    let wAxle: number;
    if (lockDrive) {
      // (locked together: one body, with the engine's inertia through the gears)
      const Ieff = Ia + K.Ie * ratio * ratio;
      const Tb = brk * (rev ? 0 : 1) * K.brakeT * (1 - K.brakeF) + (this.kick > 0 ? K.kick : 0);
      const dT = Te * ratio + rearT;
      wAxle = axle + (h * dT) / (Ieff + h * rearK);
      const stop = Math.min(Math.abs(wAxle), (h * Tb) / (Ieff + h * rearK));
      wAxle -= Math.sign(wAxle) * stop;
      this.rpm += (Math.abs(wAxle * ratio) * (30 / Math.PI) - this.rpm) * Math.min(1, h * 70);
      Tc = 0;
    } else {
      Tc = THREE.MathUtils.clamp(dwc * 0.6, -cap, cap);
      const Tb = brk * (rev ? 0 : 1) * K.brakeT * (1 - K.brakeF) + (this.kick > 0 ? K.kick : 0);
      this.rpm += ((Te - Tc) / K.Ie) * (30 / Math.PI) * h;
      wAxle = axle + (h * (Tc * ratio + rearT)) / (Ia + h * rearK);
      const stop = Math.min(Math.abs(wAxle), (h * Tb) / (Ia + h * rearK));
      wAxle -= Math.sign(wAxle) * stop;
    }
    this.clutchSlip = lockDrive ? 0 : Math.abs(dwc);
    this.rpm = THREE.MathUtils.clamp(this.rpm, K.idle, K.limit + 400);
    W[2].w = W[3].w = wAxle;
    for (const w of W) w.spin += w.w * h;
    // ---- air, and anti-roll
    const sp = vel.length();
    const dragK = K.drag * (1 - 0.42 * this.draft);
    if (sp > 0.1) {
      this.fxs -= vel.x * sp * dragK;
      this.fys -= vel.y * sp * dragK;
      this.fzs -= vel.z * sp * dragK;
    }
    const down = K.lift * sp * sp;
    this.fxs -= ay.x * down;
    this.fys -= ay.y * down;
    this.fzs -= ay.z * down;
    for (let a = 0; a < 4; a += 2) {
      const l = W[a], r = W[a + 1];
      if (!l.on || !r.on) continue;
      const F = (l.comp - r.comp) * K.arb;
      const nx = l.q.nx, ny = l.q.ny, nz = l.q.nz;
      this.force(l.cx, l.cy, l.cz, nx * F, ny * F, nz * F);
      this.force(r.cx, r.cy, r.cz, -nx * F, -ny * F, -nz * F);
    }
    // ---- a drift held too far: the driver gathers it (this is the one helping hand, past 45 degrees)
    if (this.drifting && !airborne) {
      const over = Math.abs(this.beta) - 0.68;
      if (over > 0) {
        const t = Math.sign(this.beta) * over * 3200;
        this.txs += ay.x * t;
        this.tys += ay.y * t;
        this.tzs += ay.z * t;
      }
    }
    // ---- integrate
    this.fys -= K.mass * G;
    vel.x += (this.fxs / K.mass) * h;
    vel.y += (this.fys / K.mass) * h;
    vel.z += (this.fzs / K.mass) * h;
    // spin: in the kart's frame, where the inertia's diagonal, with the gyroscopic term
    const bx = ang.dot(ax), by = ang.dot(ay), bz = ang.dot(az);
    const tx = this.txs * ax.x + this.tys * ax.y + this.tzs * ax.z;
    const ty = this.txs * ay.x + this.tys * ay.y + this.tzs * ay.z;
    const tz = this.txs * az.x + this.tys * az.y + this.tzs * az.z;
    let ox = bx + (h * (tx - (K.Ir - K.Iy) * by * bz)) / K.Ip;
    let oy = by + (h * (ty - (K.Ip - K.Ir) * bz * bx)) / K.Iy;
    let oz = bz + (h * (tz - (K.Iy - K.Ip) * bx * by)) / K.Ir;
    // (in the air it keeps itself nearly level: the driver's weight, the gyroscope of the wheels)
    if (airborne) {
      const n = this.q;
      const ex = ay.y * n.nz - ay.z * n.ny, ey = ay.z * n.nx - ay.x * n.nz, ez = ay.x * n.ny - ay.y * n.nx;
      ox += h * (ex * ax.x + ey * ax.y + ez * ax.z) * 7 - ox * h * 2;
      oz += h * (ex * az.x + ey * az.y + ez * az.z) * 7 - oz * h * 2;
    }
    ang.set(ax.x * ox + ay.x * oy + az.x * oz, ax.y * ox + ay.y * oy + az.y * oz, ax.z * ox + ay.z * oy + az.z * oz);
    pos.x += vel.x * h;
    pos.y += vel.y * h;
    pos.z += vel.z * h;
    const q = this.quat, sx = ang.x * h * 0.5, sy = ang.y * h * 0.5, sz = ang.z * h * 0.5;
    Qd.set(sx, sy, sz, 0).multiply(q);
    q.set(q.x + Qd.x, q.y + Qd.y, q.z + Qd.z, q.w + Qd.w).normalize();
    this.air = airborne ? this.air + h : 0;
    // (stopped, with nothing pressed: tyres don't creep)
    if (v < 0.35 && thr < 0.02 && brk < 0.02 && !airborne) {
      vel.multiplyScalar(1 - Math.min(1, h * 12));
      ang.multiplyScalar(1 - Math.min(1, h * 12));
    }
    this.walls(tr);
  }

  /** the barriers, and the floor of the chassis on the road, by the kart's corners */
  private walls(tr: KartTrack) {
    const { pos, vel, ang, ax, ay, az, qc } = this;
    for (let k = 0; k < 6; k++) {
      const lx = k < 4 ? (k & 1 ? -0.82 : 0.82) : 0, lz = k < 4 ? (k < 2 ? 1.34 : -1.16) : k === 4 ? 0 : 0, ly = k === 5 ? 1.15 : -0.2;
      const px = pos.x + ax.x * lx + ay.x * ly + az.x * lz, py = pos.y + ax.y * lx + ay.y * ly + az.y * lz, pz = pos.z + ax.z * lx + ay.z * ly + az.z * lz;
      tr.at(px, py, pz, this.hint, qc);
      const wall = qc.lat > 0 ? qc.wl : qc.wr;
      const over = Math.abs(qc.lat) - wall;
      if (over > 0) {
        const s = qc.lat > 0 ? -1 : 1, nx = qc.lx * s, ny = qc.ly * s, nz = qc.lz * s;
        pos.x += nx * over;
        pos.y += ny * over;
        pos.z += nz * over;
        const rx = px - pos.x, ry = py - pos.y, rz = pz - pos.z;
        const vx = vel.x + ang.y * rz - ang.z * ry, vy = vel.y + ang.z * rx - ang.x * rz, vz = vel.z + ang.x * ry - ang.y * rx;
        const vn = vx * nx + vy * ny + vz * nz;
        if (vn < 0) {
          const j = (-(1 + 0.32) * vn) / this.invMass(px, py, pz, nx, ny, nz);
          let tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn;
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl;
          ty /= tl;
          tz /= tl;
          const jt = Math.min(j * 0.22, tl / this.invMass(px, py, pz, tx, ty, tz));
          this.impulse(px, py, pz, nx * j - tx * jt, ny * j - ty * jt, nz * j - tz * jt);
          if (-vn > this.wallHit) {
            this.wallHit = -vn;
            this.wx = px;
            this.wy = py;
            this.wz = pz;
          }
        }
      }
      // the floor pan (and the roll hoop, if it's gone over)
      if (qc.h < 0.03) {
        const nx = qc.nx, ny = qc.ny, nz = qc.nz, pen = 0.03 - qc.h;
        pos.x += nx * pen * 0.6;
        pos.y += ny * pen * 0.6;
        pos.z += nz * pen * 0.6;
        const rx = px - pos.x, ry = py - pos.y, rz = pz - pos.z;
        const vx = vel.x + ang.y * rz - ang.z * ry, vy = vel.y + ang.z * rx - ang.x * rz, vz = vel.z + ang.x * ry - ang.y * rx;
        const vn = vx * nx + vy * ny + vz * nz;
        if (vn < 0) {
          const j = (-1.1 * vn) / this.invMass(px, py, pz, nx, ny, nz);
          let tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn;
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl;
          ty /= tl;
          tz /= tl;
          const jt = Math.min(j * 0.3, tl / this.invMass(px, py, pz, tx, ty, tz));
          this.impulse(px, py, pz, nx * j - tx * jt, ny * j - ty * jt, nz * j - tz * jt);
          if (Math.hypot(vel.x, vel.z) > 6) {
            this.scrape = Math.max(this.scrape, -vn + 1);
            this.wx = px;
            this.wy = py;
            this.wz = pz;
          }
        }
      }
    }
  }

  /** upside down, or near enough */
  get flipped() {
    return this.ay.dot(up) < 0.15;
  }
}
const M = new THREE.Matrix4();
