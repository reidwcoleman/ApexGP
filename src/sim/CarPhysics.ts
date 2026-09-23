import { SURF, type Track } from '../world/Track.ts';

/**
 * Vehicle dynamics: a planar bicycle model with
 *  - Pacejka-style lateral tyre curves and load sensitivity,
 *  - aerodynamic downforce (split front/rear) and drag, DRS,
 *  - a friction circle per axle (throttle/brake eat lateral grip),
 *  - longitudinal load transfer, slope gravity,
 *  - power curve + 8-speed seamless gearbox, ERS deploy/harvest,
 *  - traction control / ABS / stability assists,
 *  - surface grip + drag (kerb, grass, gravel), barrier collisions.
 *
 * Height and orientation come from the track surface; the dynamics are 2-D in XZ.
 * Body frame: vx forward, vy LEFT, r = yaw rate (+ turns left, same as heading).
 */

export interface CarSpec {
  mass: number;
  iz: number;
  /** CG → front axle, CG → rear axle (m) */
  a: number;
  b: number;
  cgH: number;
  clA: number;
  cdA: number;
  aeroFront: number;
  drsDrag: number;
  drsLift: number;
  mu: number;
  pacB: number;
  /** rear/front cornering-stiffness ratio (>1 = stable, understeery at speed) */
  rearStiff: number;
  /** rear/front peak-grip ratio (wider rear tyres) */
  rearGrip: number;
  pacC: number;
  loadSens: number;
  /** combined ICE + ERS power (W) at peak */
  power: number;
  /** extra power in overtake mode (W) */
  ersBoost: number;
  rpmIdle: number;
  rpmPeak: number;
  rpmLimit: number;
  /** overall ratios (gearbox × final drive) */
  gears: number[];
  wheelR: number;
  brakeBias: number;
  halfLength: number;
  halfWidth: number;
}

export const F1_SPEC: CarSpec = {
  mass: 800,
  iz: 1250,
  a: 1.87,
  b: 1.53,
  cgH: 0.27,
  clA: 4.6,
  cdA: 1.22,
  aeroFront: 0.43,
  drsDrag: 0.2,
  drsLift: 0.38,
  mu: 1.78,
  pacB: 15,
  rearStiff: 1.3,
  rearGrip: 1.07,
  pacC: 1.45,
  loadSens: 0.07,
  power: 735_000,
  ersBoost: 90_000,
  rpmIdle: 4200,
  rpmPeak: 11200,
  rpmLimit: 12400,
  gears: [17.2, 14.0, 11.6, 9.75, 8.25, 7.0, 5.95, 5.02],
  wheelR: 0.36,
  brakeBias: 0.58,
  halfLength: 2.7,
  halfWidth: 0.95,
};

export interface Assists {
  traction: boolean;
  abs: boolean;
  stability: boolean;
  autoGear: boolean;
}

export interface DriveInput {
  throttle: number;
  brake: number;
  /** road-wheel angle (rad, + = left) */
  steer: number;
  ers: boolean;
  shiftUp: boolean;
  shiftDown: boolean;
  /** held stationary (grid, lights): no motion, no reverse */
  hold?: boolean;
}

const G = 9.81;
const RHO = 1.225;

const SURF_GRIP = [1.0, 0.94, 0.96, 0.58, 0.46];
const SURF_DRAG = [0, 0, 0.004, 0.09, 0.3]; // × m·g, rolling resistance-ish
const SURF_DRAG_V = [0, 0, 0, 0.0018, 0.0065]; // × m·g per m/s

export interface Contact {
  /** impact speed into the barrier (m/s) */
  wallHit: number;
  wallSide: number;
}

export class CarPhysics {
  readonly spec: CarSpec;
  assists: Assists = { traction: true, abs: true, stability: true, autoGear: true };

  // pose
  x = 0;
  z = 0;
  y = 0;
  yaw = 0;
  // body-frame velocity
  vx = 0;
  vy = 0;
  r = 0;

  // track-relative
  s = 0;
  lateral = 0;
  hint = -1;
  /** heading relative to the track tangent (rad, + = pointing left of tangent) */
  relYaw = 0;

  // drivetrain
  gear = 1;
  rpm = 4200;
  shiftCut = 0;
  lastShift = 0; // +1 up, -1 down, 0 none — consumed by audio
  limiter = false;
  ers = 1; // battery 0..1
  ersDeploying = false;
  drsOpen = false;
  drsAnim = 0;
  reverse = false;
  /** the player can back out of trouble; AI cars never select reverse */
  allowReverse = true;
  private reverseTimer = 0;
  private prevFyr = 0;

  // outputs
  throttle = 0;
  brake = 0;
  steer = 0;
  ax = 0; // longitudinal accel (m/s²), + forward
  ay = 0; // lateral accel, + left
  slipFront = 0;
  slipRear = 0;
  wheelspin = 0;
  lockup = 0;
  surfaceFL: number = SURF.ROAD;
  surfaceFR: number = SURF.ROAD;
  surfaceRL: number = SURF.ROAD;
  surfaceRR: number = SURF.ROAD;
  onKerb = false;
  offTrack = false;
  wheelAngleF = 0;
  wheelAngleR = 0;
  brakeHeat = 0;
  /** visual suspension (rad / m) */
  pitch = 0;
  roll = 0;
  heave = 0;
  private pitchV = 0;
  private rollV = 0;
  private heaveV = 0;
  kerbPhase = 0;
  contact: Contact = { wallHit: 0, wallSide: 0 };
  /** accumulated so the race can apply penalties/effects */
  damage = 0;

  constructor(spec: CarSpec = F1_SPEC) {
    this.spec = spec;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  get kmh(): number {
    return this.vx * 3.6;
  }

  /** place at (s, lateral) facing along the track */
  placeOnTrack(track: Track, s: number, lateral: number) {
    const f = track.frame(s);
    const p = track.point(s, lateral);
    this.x = p.x;
    this.z = p.z;
    this.y = p.y;
    this.yaw = f.heading;
    this.vx = this.vy = this.r = 0;
    this.s = f.s;
    this.lateral = lateral;
    this.hint = Math.floor(f.s);
    this.gear = 1;
    this.rpm = this.spec.rpmIdle;
    this.reverse = false;
  }

  worldVelocity(): [number, number] {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // forward (sy, cy), left (cy, -sy)
    return [this.vx * sy + this.vy * cy, this.vx * cy - this.vy * sy];
  }

  setWorldVelocity(wx: number, wz: number) {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    this.vx = wx * sy + wz * cy;
    this.vy = wx * cy - wz * sy;
  }

  overallRatio(g = this.gear): number {
    return this.spec.gears[Math.max(0, Math.min(this.spec.gears.length - 1, g - 1))];
  }

  private powerAt(rpm: number): number {
    const sp = this.spec;
    const x = (rpm - sp.rpmIdle) / (sp.rpmPeak - sp.rpmIdle);
    let shape: number;
    if (x < 1) shape = 0.42 + 0.58 * Math.sin(Math.max(0, x) * Math.PI * 0.5);
    else shape = 1 - 0.35 * Math.pow((rpm - sp.rpmPeak) / (sp.rpmLimit - sp.rpmPeak + 1), 2);
    return sp.power * Math.max(0.3, shape);
  }

  step(dt: number, input: DriveInput, track: Track, drsAllowed: boolean) {
    const sp = this.spec;
    const m = sp.mass;
    const L = sp.a + sp.b;
    this.lastShift = 0;
    this.contact.wallHit = 0;

    // ---- inputs
    let throttle = Math.max(0, Math.min(1, input.throttle));
    let brake = Math.max(0, Math.min(1, input.brake));
    this.steer = input.steer;
    const delta = input.steer;

    if (input.hold) {
      this.vx = this.vy = this.r = 0;
      this.reverse = false;
      this.reverseTimer = 0;
      this.throttle = throttle;
      this.brake = 1;
      this.steer = input.steer;
      this.wheelspin = this.lockup = 0;
      this.ax = this.ay = 0;
      const target = this.spec.rpmIdle + throttle * 7200;
      this.rpm += (target - this.rpm) * Math.min(1, dt * 10);
      this.limiter = false;
      return;
    }

    // reverse: hold brake while stopped
    if (this.allowReverse && !this.reverse && Math.abs(this.vx) < 0.6 && brake > 0.6 && throttle < 0.05) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.45) this.reverse = true;
    } else if (!this.reverse) this.reverseTimer = 0;
    if (this.reverse && (throttle > 0.1 || this.vx > 1)) {
      this.reverse = false;
      this.reverseTimer = 0;
    }

    // ---- surfaces under each wheel
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const fwdAlong = Math.cos(this.relYaw);
    const fwdLat = -Math.sin(this.relYaw); // + = right
    const wheelSurf = (along: number, side: number) => {
      // side: +1 left wheel, −1 right wheel; car-local left maps to track −lateral
      const lat = this.lateral + fwdLat * along - side * 0.8 * fwdAlong;
      return track.surfaceAt(this.s + fwdAlong * along, lat);
    };
    this.surfaceFL = wheelSurf(sp.a, 1);
    this.surfaceFR = wheelSurf(sp.a, -1);
    this.surfaceRL = wheelSurf(-sp.b, 1);
    this.surfaceRR = wheelSurf(-sp.b, -1);
    const gripF = (SURF_GRIP[this.surfaceFL] + SURF_GRIP[this.surfaceFR]) * 0.5;
    const gripR = (SURF_GRIP[this.surfaceRL] + SURF_GRIP[this.surfaceRR]) * 0.5;
    const surfs = [this.surfaceFL, this.surfaceFR, this.surfaceRL, this.surfaceRR];
    let dragSurf = 0;
    for (const sc of surfs) dragSurf += (SURF_DRAG[sc] + SURF_DRAG_V[sc] * Math.abs(this.vx)) * 0.25;
    this.onKerb = surfs.some((sc) => sc === SURF.KERB);
    this.offTrack = surfs.every((sc) => sc === SURF.GRASS || sc === SURF.GRAVEL || sc === SURF.ASPHALT);

    // ---- aero
    const v = Math.max(0, this.vx);
    const q = 0.5 * RHO * v * v;
    this.drsOpen = drsAllowed && this.drsOpen && brake < 0.05;
    this.drsAnim += ((this.drsOpen ? 1 : 0) - this.drsAnim) * Math.min(1, dt * 14);
    const clA = sp.clA - sp.drsLift * this.drsAnim;
    const cdA = sp.cdA - sp.drsDrag * this.drsAnim;
    // ride height: off track the floor loses a chunk of its load
    const floorFactor = this.offTrack ? 0.7 : 1;
    const down = q * clA * floorFactor;
    const drag = q * cdA;
    const downF = down * sp.aeroFront;
    const downR = down - downF;

    // ---- loads (with longitudinal transfer from the previous step's accel)
    const slopeY = this.slopeAlongHeading(track);
    const wF = (m * G * sp.b) / L + downF - (m * this.ax * sp.cgH) / L;
    const wR = (m * G * sp.a) / L + downR + (m * this.ax * sp.cgH) / L;
    const FzF = Math.max(300, wF);
    const FzR = Math.max(300, wR);
    const tyreRef = (m * G) / 4;
    const muAt = (Fz: number) => sp.mu * Math.max(0.6, 1 - sp.loadSens * (Fz / 2 / tyreRef - 1));
    const capF = muAt(FzF) * FzF * gripF;
    const capR = muAt(FzR) * FzR * gripR * sp.rearGrip;

    // ---- drivetrain
    const wheelCirc = 2 * Math.PI * sp.wheelR;
    this.shiftCut = Math.max(0, this.shiftCut - dt);
    if (this.assists.autoGear && !this.reverse) {
      const rpmNow = (Math.abs(this.vx) / wheelCirc) * 60 * this.overallRatio();
      if (rpmNow > sp.rpmLimit - 350 && this.gear < sp.gears.length && throttle > 0.1) this.shift(1);
      else if (this.gear > 1) {
        const rpmDown = (Math.abs(this.vx) / wheelCirc) * 60 * this.overallRatio(this.gear - 1);
        const downAt = brake > 0.1 ? sp.rpmLimit - 1500 : sp.rpmLimit - 2600;
        if (rpmDown < downAt) this.shift(-1);
      }
    } else if (!this.reverse) {
      if (input.shiftUp && this.gear < sp.gears.length) this.shift(1);
      if (input.shiftDown && this.gear > 1) {
        const rpmDown = (Math.abs(this.vx) / wheelCirc) * 60 * this.overallRatio(this.gear - 1);
        if (rpmDown < sp.rpmLimit + 200) this.shift(-1);
      }
    }
    const ratio = this.overallRatio();
    const rpmWheel = (Math.abs(this.vx) / wheelCirc) * 60 * ratio;
    // launch: clutch slip holds revs up in first gear
    const launchRpm = sp.rpmIdle + throttle * 5200;
    let rpm = this.gear === 1 && rpmWheel < launchRpm ? Math.max(rpmWheel, launchRpm * (1 - Math.min(1, this.vx / 18)) + rpmWheel * Math.min(1, this.vx / 18)) : rpmWheel;
    rpm = Math.max(sp.rpmIdle, rpm);
    this.limiter = rpm >= sp.rpmLimit - 10 && throttle > 0.5;
    if (rpm > sp.rpmLimit) rpm = sp.rpmLimit;

    // ERS: deploy in overtake mode (held), harvest under braking.
    this.ersDeploying = input.ers && this.ers > 0.001 && throttle > 0.5 && !this.reverse;
    let power = this.powerAt(rpm);
    if (this.ersDeploying) {
      power += sp.ersBoost;
      this.ers = Math.max(0, this.ers - dt / 22);
    }
    if (brake > 0.2 && v > 10) this.ers = Math.min(1, this.ers + brake * dt / 30);
    else if (throttle < 0.05 && v > 20) this.ers = Math.min(1, this.ers + dt / 140);

    // engine force at the rear wheels
    const torqueLimited = ((power / ((rpm * 2 * Math.PI) / 60)) * ratio) / sp.wheelR;
    let Fdrive = throttle * Math.min(torqueLimited, power / Math.max(v, 2));
    if (this.limiter) Fdrive *= 0.25;
    if (this.shiftCut > 0) Fdrive *= 0.35;
    if (this.reverse) Fdrive = -brake * 5200 * (this.vx > -6 ? 1 : 0);
    // engine braking
    const engineBrake = !this.reverse && throttle < 0.05 && v > 3 ? (0.05 + 0.18 * (rpm / sp.rpmLimit) ** 2) * m * G : 0;

    // traction: rear longitudinal capacity
    let Fxr = Fdrive;
    this.wheelspin = 0;
    // TC leaves the rear enough grip for the cornering load it carried last step
    const tcLimit = this.assists.traction
      ? Math.max(capR * 0.3, Math.sqrt(Math.max(0, capR * capR - (this.prevFyr * 1.12) ** 2))) * 0.96
      : capR;
    if (Fxr > tcLimit) {
      if (this.assists.traction) Fxr = tcLimit;
      else {
        this.wheelspin = Math.min(1, (Fxr - capR) / capR + 0.25);
        Fxr = capR * 0.82;
      }
    }

    // brakes
    let Fbf = 0;
    let Fbr = 0;
    this.lockup = 0;
    if (!this.reverse && brake > 0 && Math.abs(this.vx) > 0.2) {
      const demand = brake * (capF + capR) * 1.15;
      Fbf = demand * sp.brakeBias;
      Fbr = demand * (1 - sp.brakeBias);
      if (this.assists.abs) {
        Fbf = Math.min(Fbf, capF * 0.97);
        Fbr = Math.min(Fbr, capR * 0.97);
      } else {
        if (Fbf > capF) {
          this.lockup = Math.max(this.lockup, Math.min(1, (Fbf - capF) / capF + 0.3));
          Fbf = capF * 0.85;
        }
        if (Fbr > capR) {
          this.lockup = Math.max(this.lockup, Math.min(1, (Fbr - capR) / capR + 0.3));
          Fbr = capR * 0.85;
        }
      }
    }
    const sgn = Math.sign(this.vx) || 1;
    const Fxf = -Fbf * sgn;
    Fxr = Fxr - Fbr * sgn - engineBrake * sgn;

    // ---- lateral tyre forces (friction circle)
    const capFy = Math.sqrt(Math.max(0, capF * capF - Fxf * Fxf)) * (this.lockup > 0 && Fbf >= capF * 0.84 ? 0.35 : 1);
    const capRy = Math.sqrt(Math.max(0, capR * capR - Fxr * Fxr)) * (1 - this.wheelspin * 0.55);
    const vxa = Math.max(Math.abs(this.vx), 1.5);
    const alphaF = Math.atan2(this.vy + sp.a * this.r, vxa) - delta * sgn;
    const alphaR = Math.atan2(this.vy - sp.b * this.r, vxa);
    const pacF = (al: number) => Math.sin(sp.pacC * Math.atan(sp.pacB * al));
    const pacR = (al: number) => Math.sin(sp.pacC * Math.atan(sp.pacB * sp.rearStiff * al));
    const Fyf = -capFy * pacF(alphaF);
    const Fyr = -capRy * pacR(alphaR);
    this.prevFyr = Math.abs(capR * pacR(alphaR));
    const peakAlpha = Math.tan(Math.PI / (2 * sp.pacC)) / sp.pacB;
    this.slipFront = Math.abs(alphaF) / peakAlpha;
    this.slipRear = (Math.abs(alphaR) * sp.rearStiff) / peakAlpha;

    // ---- stability assist: gently trims yaw rate toward the kinematic ideal
    if (this.assists.stability && v > 8) {
      const rIdeal = (this.vx * Math.tan(delta)) / L;
      const err = this.r - rIdeal;
      const beta = Math.atan2(this.vy, vxa);
      this.r -= err * Math.min(1, dt * 2.2) * Math.min(1, Math.abs(beta) * 6);
    }

    // ---- equations of motion
    const cd = Math.cos(delta);
    const sd = Math.sin(delta);
    const Fx = Fxr + Fxf * cd - Fyf * sd - drag * sgn - dragSurf * m * G * sgn - m * G * slopeY;
    const Fy = Fyr + Fyf * cd + Fxf * sd;
    const Mz = sp.a * (Fyf * cd + Fxf * sd) - sp.b * Fyr;

    const axBody = Fx / m;
    const ayBody = Fy / m;
    this.vx += (axBody + this.vy * this.r) * dt;
    this.vy += (ayBody - this.vx * this.r) * dt;
    this.r += (Mz / sp.iz) * dt;

    // don't let brakes/drag push the car backward
    if (!this.reverse && this.vx < 0 && throttle < 0.05 && Fdrive >= 0) {
      if (this.vx > -0.5) this.vx = 0;
    }

    // low-speed blend to kinematic steering
    const lowW = Math.max(0, 1 - Math.abs(this.vx) / 4);
    if (lowW > 0) {
      const rk = (this.vx * Math.tan(delta)) / L;
      this.r = this.r * (1 - lowW) + rk * lowW;
      this.vy *= 1 - Math.min(1, lowW * dt * 12);
    }

    this.ax = this.ax + (axBody - this.ax) * Math.min(1, dt * 20);
    this.ay = this.ay + (ayBody - this.ay) * Math.min(1, dt * 20);

    // ---- integrate pose
    this.yaw += this.r * dt;
    const syn = Math.sin(this.yaw);
    const cyn = Math.cos(this.yaw);
    const wx = this.vx * syn + this.vy * cyn;
    const wz = this.vx * cyn - this.vy * syn;
    this.x += wx * dt;
    this.z += wz * dt;
    void sy;
    void cy;

    // ---- track-relative
    const pr = track.project(this.x, this.z, this.hint);
    this.hint = pr.index;
    this.s = pr.s;
    this.lateral = pr.lateral;
    const th = track.frame(this.s).heading;
    let ry = this.yaw - th;
    while (ry > Math.PI) ry -= Math.PI * 2;
    while (ry < -Math.PI) ry += Math.PI * 2;
    this.relYaw = ry;

    this.collideBarriers(track);

    // ---- drivetrain readouts
    const rpmOut = this.reverse ? sp.rpmIdle + Math.abs(this.vx) * 200 : rpm + this.wheelspin * 2500;
    this.rpm += (Math.min(sp.rpmLimit + 150, rpmOut) - this.rpm) * Math.min(1, dt * 30);
    if (this.limiter) this.rpm = sp.rpmLimit - 180 + Math.random() * 280;
    this.throttle = throttle;
    this.brake = brake;

    // ---- wheels & brakes (visual)
    this.wheelAngleF += (this.vx / sp.wheelR) * dt * (this.lockup > 0.5 ? 0.1 : 1);
    this.wheelAngleR += (this.vx / sp.wheelR) * dt * (1 + this.wheelspin * 1.5);
    const heatIn = brake * Math.max(0, v - 15) * 0.012;
    this.brakeHeat = Math.min(1, Math.max(0, this.brakeHeat + (heatIn - this.brakeHeat * 0.9) * dt * 1.6));

    // ---- suspension (visual springs)
    const kerbBump = this.onKerb ? Math.sin((this.kerbPhase += v * dt * 2.2)) * 0.006 * Math.min(1, v / 20) : 0;
    const offBump = this.offTrack ? (Math.random() - 0.5) * 0.02 * Math.min(1, v / 15) : 0;
    const pitchT = -this.ax * 0.0022;
    const rollT = -this.ay * 0.0016;
    const heaveT = -Math.min(0.03, down * 0.0000011) + kerbBump + offBump;
    this.pitchV += ((pitchT - this.pitch) * 180 - this.pitchV * 18) * dt;
    this.rollV += ((rollT - this.roll) * 200 - this.rollV * 20) * dt;
    this.heaveV += ((heaveT - this.heave) * 260 - this.heaveV * 22) * dt;
    this.pitch += this.pitchV * dt;
    this.roll += this.rollV * dt;
    this.heave += this.heaveV * dt;
  }

  shift(dir: number) {
    const n = this.spec.gears.length;
    const g = Math.max(1, Math.min(n, this.gear + dir));
    if (g === this.gear) return;
    this.gear = g;
    this.shiftCut = dir > 0 ? 0.045 : 0.03;
    this.lastShift = dir;
  }

  private slopeAlongHeading(track: Track): number {
    const i = Math.floor(track.wrap(this.s));
    const ty = track.ty[i];
    return ty * Math.cos(this.relYaw);
  }

  private collideBarriers(track: Track) {
    const sp = this.spec;
    // test the four corners of the chassis footprint
    const ca = Math.cos(this.relYaw);
    const sa = Math.sin(this.relYaw);
    let worst = 0;
    let worstSide = 0;
    for (const along of [sp.halfLength * 0.92, -sp.halfLength * 0.85]) {
      for (const side of [1, -1]) {
        // corner offset in track frame: along-track, lateral(+right)
        const latOff = -sa * along - ca * side * sp.halfWidth;
        const sOff = ca * along - sa * side * sp.halfWidth;
        const lat = this.lateral + latOff;
        const sideSign = lat >= 0 ? 1 : -1;
        const bar = track.barrierAt(this.s + sOff, sideSign);
        const pen = Math.abs(lat) - bar;
        if (pen > worst) {
          worst = pen;
          worstSide = sideSign;
        }
      }
    }
    if (worst <= 0) return;
    // push back along the track's right vector
    const i = Math.floor(track.wrap(this.s));
    const rx = track.rx[i];
    const rz = track.rz[i];
    const rl = Math.hypot(rx, rz);
    const nx = (rx / rl) * worstSide;
    const nz = (rz / rl) * worstSide;
    this.x -= nx * worst;
    this.z -= nz * worst;
    this.lateral -= worstSide * worst;
    const [wx, wz] = this.worldVelocity();
    const vn = wx * nx + wz * nz;
    if (vn > 0) {
      const restitution = 0.25;
      let nwx = wx - (1 + restitution) * vn * nx;
      let nwz = wz - (1 + restitution) * vn * nz;
      // scrape friction along the wall
      const fr = Math.min(0.5, 0.08 + vn * 0.02);
      nwx *= 1 - fr;
      nwz *= 1 - fr;
      this.setWorldVelocity(nwx, nwz);
      // rotate away from the wall
      this.r += -worstSide * Math.sign(this.vx) * Math.min(2.2, vn * 0.08) * (Math.random() * 0.6 + 0.7);
      this.contact.wallHit = vn;
      this.contact.wallSide = worstSide;
      this.damage += vn;
    }
  }
}
