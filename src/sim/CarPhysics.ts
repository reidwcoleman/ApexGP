import { SURF, type Track } from '../world/Track.ts';
import type { Weather } from '../world/Weather.ts';

/**
 * Vehicle dynamics — a four-wheel model in the style of modern F1 games.
 *
 *  - Four tyres, each with its own vertical load: static weight, aerodynamic
 *    load (split by a pitch-sensitive aero balance), longitudinal load transfer
 *    and lateral load transfer split front/rear by roll-stiffness distribution.
 *  - Combined-slip tyre model: slip angle and slip ratio are normalised by their
 *    peaks and share one friction curve, so braking or power while turning eats
 *    lateral grip the way a real tyre does. Load sensitivity per tyre.
 *  - Wheel spin dynamics (implicit, so it is stable at 300 Hz): wheelspin and
 *    lock-ups emerge from torque vs grip instead of being scripted.
 *  - Drivetrain: power curve, 8-speed seamless box, launch clutch, engine
 *    braking, ERS overtake deploy/harvest, limited-slip differential.
 *  - Aero: downforce + drag, DRS, slipstream tow and dirty air (set by the race).
 *  - Assists as the F1 games have them: traction control off/medium/full (slip
 *    control), ABS, stability (countersteer + yaw damping), automatic gears.
 *  - Surfaces per wheel (kerb chatter, grass, gravel), gravity on slopes and
 *    banking, impulse-based barrier contact with friction and yaw.
 *  - Weather: water under each tyre (with a drier racing line once it stops
 *    raining) sets grip by tyre type — slicks, intermediates, full wets — plus
 *    aquaplaning on standing water; painted kerbs and grass get treacherous.
 *  - Tyre temperatures: sliding and rolling heat them, speed and water cool
 *    them; grip peaks in each compound's working window, wear rises when hot.
 *  - Fuel: the car carries and burns it, so it gets lighter through a race.
 *
 * Body frame: vx forward, vy LEFT, r = yaw rate (+ turns left, same as heading).
 * World: heading θ → forward (sin θ, cos θ) in XZ; yaw is rotation about +Y.
 */

export type TCMode = 'off' | 'medium' | 'full';

export interface Assists {
  traction: TCMode;
  abs: boolean;
  stability: boolean;
  autoGear: boolean;
}

export interface CarSpec {
  mass: number;
  iz: number;
  /** CG → front axle, CG → rear axle (m) */
  a: number;
  b: number;
  cgH: number;
  trackF: number;
  trackR: number;
  wheelR: number;
  wheelI: number;
  clA: number;
  cdA: number;
  aeroFront: number;
  drsDrag: number;
  drsLift: number;
  /** aero balance moves forward this much per m/s² of deceleration (dive) */
  pitchAero: number;
  mu: number;
  loadSens: number;
  slipAnglePeak: number;
  /** wider, stiffer rears: smaller peak slip angle and more grip than the fronts */
  slipAnglePeakRear: number;
  muRear: number;
  slipRatioPeak: number;
  /** Pacejka C: 1.3–1.4 keeps ~85% grip past the peak (forgiving, like a racing slick) */
  tyreShape: number;
  /** front share of lateral load transfer (more = more understeer) */
  rollFront: number;
  power: number;
  ersBoost: number;
  rpmIdle: number;
  rpmPeak: number;
  rpmLimit: number;
  gears: number[];
  brakeTorque: number;
  brakeBias: number;
  maxSteer: number;
  halfLength: number;
  halfWidth: number;
}

export const F1_SPEC: CarSpec = {
  mass: 800,
  iz: 1150,
  a: 1.87,
  b: 1.53,
  cgH: 0.28,
  trackF: 1.6,
  trackR: 1.55,
  wheelR: 0.36,
  wheelI: 1.1,
  clA: 4.9,
  cdA: 1.1,
  aeroFront: 0.415,
  drsDrag: 0.24,
  drsLift: 0.34,
  pitchAero: 0.0015,
  mu: 1.95,
  loadSens: 0.075,
  slipAnglePeak: 0.1,
  slipAnglePeakRear: 0.082,
  muRear: 1.06,
  slipRatioPeak: 0.09,
  tyreShape: 1.28,
  rollFront: 0.56,
  power: 735_000,
  ersBoost: 90_000,
  rpmIdle: 4200,
  rpmPeak: 11200,
  rpmLimit: 12400,
  gears: [17.2, 14.0, 11.6, 9.75, 8.25, 7.0, 5.9, 4.86],
  brakeTorque: 17500,
  brakeBias: 0.57,
  maxSteer: 0.38,
  halfLength: 2.7,
  halfWidth: 0.95,
};

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

export interface Contact {
  /** impact speed into the barrier (m/s) */
  wallHit: number;
  wallSide: number;
}

const G = 9.81;
const RHO = 1.225;
const V_MIN = 2.5;

// per surface code: grip multiplier, rolling resistance coefficient, speed-dependent drag (per m/s), lateral bog
const SURF_GRIP = [1.0, 0.93, 0.95, 0.56, 0.5];
const SURF_RR = [0.012, 0.015, 0.016, 0.07, 0.2];
const SURF_RR_V = [0, 0, 0, 0.0012, 0.006];
const SURF_BOG = [0, 0, 0, 0.3, 1.6];

/**
 * Grip on a wet track by tyre type (0 slick, 1 inter, 2 wet), tabulated over
 * the water level under the tyre. Crossovers: slick/inter ≈ 0.2, inter/wet ≈ 0.72.
 * Inters and wets on a dry track are slower and overheat (see the temperature model).
 */
const WET_X = [0, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0];
const WET_GRIP = [
  [1.0, 0.93, 0.8, 0.66, 0.57, 0.52, 0.48],
  [0.9, 0.88, 0.84, 0.79, 0.74, 0.69, 0.64],
  [0.85, 0.83, 0.8, 0.77, 0.745, 0.73, 0.72],
];
/** aquaplaning sensitivity by tyre type */
const AQUA = [0.34, 0.14, 0.04];

export function wetGrip(type: number, wet: number): number {
  const t = WET_GRIP[type] ?? WET_GRIP[0];
  if (wet <= 0) return t[0];
  if (wet >= 1) return t[6];
  let i = 0;
  while (WET_X[i + 1] < wet) i++;
  const f = (wet - WET_X[i]) / (WET_X[i + 1] - WET_X[i]);
  return t[i] + (t[i + 1] - t[i]) * f;
}

/** grip multiplier from tyre temperature: peaks in the working window */
export function tempGrip(T: number, opt: number): number {
  const x = (T - opt) / (T < opt ? 40 : 30);
  return Math.max(0.8, 1 - 0.09 * x * x);
}

/**
 * Tyre thermal model (K/s). Heat: sliding power (lateral fully, longitudinal
 * at 30% — wheelspin heats the surface less than cornering scrub) plus a
 * little rolling hysteresis; cooling: air (∝ speed) and water. The wider rears
 * shed heat 25% faster. Calibrated so a hard-pushed lap at Monza sits in the
 * window (~100 °C) and the tyres cool on the long straights.
 */
const TYRE_HEAT_SLIP = 0.000515;
const TYRE_HEAT_ROLL = 0.000002;
const TYRE_COOL_0 = 0.012;
const TYRE_COOL_V = 0.00042;
const TYRE_COOL_WET = 0.05;

/** fuel burn at full throttle (kg/s): ~100 kg/h, the regulation flow limit */
export const FUEL_FLOW = 0.0275;

// wheel order: 0 FL, 1 FR, 2 RL, 3 RR
const FRONT = [true, true, false, false];

export class CarPhysics {
  readonly spec: CarSpec;
  assists: Assists = { traction: 'full', abs: true, stability: true, autoGear: true };

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
  relYaw = 0;

  // drivetrain
  gear = 1;
  rpm = 4200;
  shiftCut = 0;
  lastShift = 0;
  limiter = false;
  ers = 1;
  ersDeploying = false;
  drsOpen = false;
  drsAnim = 0;
  reverse = false;
  allowReverse = true;
  private reverseTimer = 0;

  /** set by the race each step: slipstream (0..1) and dirty air (0..1) from the car ahead */
  tow = 0;
  dirty = 0;
  /** 0..1 aero damage (front wing), reduces front downforce */
  wingDamage = 0;
  /** tyre wear per wheel 0..1 and the compound's grip / wear multipliers */
  readonly wear = [0, 0, 0, 0];
  compoundGrip = 1;
  compoundWear = 1;
  /** 0 slick, 1 intermediate, 2 full wet */
  tyreType = 0;
  /** centre of the compound's working window (°C) */
  tyreOpt = 100;
  /** tyre surface/carcass temperature per wheel (°C) */
  readonly tyreTemp = [80, 80, 80, 80];
  /** water under each tyre, 0 … 1 */
  readonly wetW = [0, 0, 0, 0];
  /** sliding power per tyre right now (W): longitudinal and lateral */
  readonly slipPowL = [0, 0, 0, 0];
  readonly slipPowT = [0, 0, 0, 0];
  /** fuel on board (kg) and whether it burns */
  fuel = 0;
  burnFuel = true;
  /** the session's weather (null = dry, 25 °C) */
  weather: Weather | null = null;
  /**
   * Mean grip of the four tyres relative to new, warm slicks on a dry track
   * (weather × temperature × wear × compound; not the surface). The steering
   * limit and the AI use it to drive to the conditions.
   */
  gripFactor = 1;

  // wheels
  readonly omega = [0, 0, 0, 0];
  readonly load = [0, 0, 0, 0];
  readonly slipRatio = [0, 0, 0, 0];
  readonly slipAngle = [0, 0, 0, 0];
  readonly surface = [0, 0, 0, 0];
  private readonly kerbPhase = [0, 0, 0, 0];
  private readonly wx: number[];
  private readonly wy: number[];

  // outputs (read by audio, fx, HUD, camera)
  throttle = 0;
  brake = 0;
  steer = 0;
  ax = 0;
  ay = 0;
  slipFront = 0;
  slipRear = 0;
  wheelspin = 0;
  lockup = 0;
  tcActive = false;
  absActive = false;
  surfaceFL: number = SURF.ROAD;
  surfaceFR: number = SURF.ROAD;
  surfaceRL: number = SURF.ROAD;
  surfaceRR: number = SURF.ROAD;
  onKerb = false;
  offTrack = false;
  wheelAngleF = 0;
  wheelAngleR = 0;
  brakeHeat = 0;
  pitch = 0;
  roll = 0;
  heave = 0;
  private pitchV = 0;
  private rollV = 0;
  private heaveV = 0;
  kerbPhaseVis = 0;
  contact: Contact = { wallHit: 0, wallSide: 0 };
  damage = 0;

  // tyre curve constants
  private readonly tyreB: number;
  private readonly tyreC: number;
  private readonly tyreBC: number;

  constructor(spec: CarSpec = F1_SPEC) {
    this.spec = spec;
    this.tyreC = spec.tyreShape;
    this.tyreB = Math.tan(Math.PI / (2 * spec.tyreShape));
    this.tyreBC = this.tyreB * this.tyreC;
    this.wx = [spec.a, spec.a, -spec.b, -spec.b];
    this.wy = [spec.trackF / 2, -spec.trackF / 2, spec.trackR / 2, -spec.trackR / 2];
  }

  /** mass including fuel (kg) */
  get mass(): number {
    return this.spec.mass + this.fuel;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vy);
  }

  get kmh(): number {
    return this.vx * 3.6;
  }

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
    this.relYaw = 0;
    this.gear = 1;
    this.rpm = this.spec.rpmIdle;
    this.reverse = false;
    for (let i = 0; i < 4; i++) this.omega[i] = 0;
  }

  /** give the car a speed along its heading with wheels spinning to match */
  setSpeed(v: number) {
    this.vx = v;
    this.vy = 0;
    this.r = 0;
    for (let i = 0; i < 4; i++) this.omega[i] = v / this.spec.wheelR;
  }

  worldVelocity(): [number, number] {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    return [this.vx * sy + this.vy * cy, this.vx * cy - this.vy * sy];
  }

  setWorldVelocity(wx: number, wz: number) {
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const oldVx = this.vx;
    this.vx = wx * sy + wz * cy;
    this.vy = wx * cy - wz * sy;
    // wheels follow the new road speed (they'd skid briefly in reality)
    if (oldVx !== 0) {
      const k = this.vx / oldVx;
      if (isFinite(k) && k > 0) for (let i = 0; i < 4; i++) this.omega[i] *= k;
      else for (let i = 0; i < 4; i++) this.omega[i] = this.vx / this.spec.wheelR;
    }
  }

  /** world-space impulse (N·s) at world point (px, pz) */
  applyImpulse(px: number, pz: number, jx: number, jz: number) {
    const [wx, wz] = this.worldVelocity();
    const nvx = wx + jx / this.mass;
    const nvz = wz + jz / this.mass;
    const rcx = px - this.x;
    const rcz = pz - this.z;
    this.r += (rcz * jx - rcx * jz) / this.spec.iz;
    this.setWorldVelocity(nvx, nvz);
  }

  /** velocity of a world point on the car body */
  pointVelocity(px: number, pz: number): [number, number] {
    const [wx, wz] = this.worldVelocity();
    const rcx = px - this.x;
    const rcz = pz - this.z;
    return [wx + this.r * rcz, wz - this.r * rcx];
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

  /**
   * The steering angle at which the front tyres reach peak grip at speed v —
   * what a full steering input should map to (F1 games do the same for pads).
   */
  gripSteerLimit(v: number): number {
    const sp = this.spec;
    const vv = Math.max(4, v);
    const L = sp.a + sp.b;
    const kin = Math.atan((L * this.lateralGrip(vv)) / (vv * vv));
    // + the understeer angle the car needs at the limit (measured: ~0.05 rad)
    return Math.min(sp.maxSteer, kin + 0.05);
  }

  /** approximate peak steady-state lateral acceleration at speed v (m/s²), fitted to the sim */
  lateralGrip(v: number): number {
    const sp = this.spec;
    const q = 0.5 * RHO * v * v;
    return sp.mu * 0.87 * this.gripFactor * (G + (0.73 * q * sp.clA) / this.mass);
  }

  /**
   * Combined-slip tyre: normalised longitudinal (sx) and lateral (sy) slip
   * share one curve. Returns [Fl, Ft] in the wheel frame for peak force Fmax.
   */
  private tyre(sx: number, sy: number, Fmax: number, out: number[]) {
    const s = Math.hypot(sx, sy);
    let k: number;
    if (s < 1e-4) k = Fmax * this.tyreBC;
    else k = (Fmax * Math.sin(this.tyreC * Math.atan(this.tyreB * s))) / s;
    out[0] = k * sx;
    out[1] = -k * sy;
  }

  step(dt: number, input: DriveInput, track: Track, drsAllowed: boolean) {
    const sp = this.spec;
    const m = this.mass;
    const L = sp.a + sp.b;
    this.lastShift = 0;
    this.contact.wallHit = 0;
    this.tcActive = false;
    this.absActive = false;

    const throttle = Math.max(0, Math.min(1, input.throttle));
    const brake = Math.max(0, Math.min(1, input.brake));

    if (input.hold) {
      this.vx = this.vy = this.r = 0;
      for (let i = 0; i < 4; i++) this.omega[i] = 0;
      this.reverse = false;
      this.reverseTimer = 0;
      this.throttle = throttle;
      this.brake = 1;
      this.steer = input.steer;
      this.wheelspin = this.lockup = 0;
      this.ax = this.ay = 0;
      const target = sp.rpmIdle + throttle * 7200;
      this.rpm += (target - this.rpm) * Math.min(1, dt * 10);
      this.limiter = false;
      return;
    }

    // reverse: hold the brake while stopped
    if (this.allowReverse && !this.reverse && Math.abs(this.vx) < 0.6 && brake > 0.6 && throttle < 0.05) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.5) this.reverse = true;
    } else if (!this.reverse) this.reverseTimer = 0;
    if (this.reverse && (throttle > 0.1 || this.vx > 1)) {
      this.reverse = false;
      this.reverseTimer = 0;
    }

    // ---- stability assist (steering side): automatic countersteer when the rear steps out
    let delta = Math.max(-sp.maxSteer, Math.min(sp.maxSteer, input.steer));
    const vabs = Math.abs(this.vx);
    const beta = Math.atan2(this.vy, Math.max(vabs, V_MIN));
    if (this.assists.stability && vabs > 6) {
      const over = Math.abs(beta) - 0.035;
      if (over > 0) delta += Math.sign(beta) * over * 0.85;
      delta = Math.max(-sp.maxSteer, Math.min(sp.maxSteer, delta));
    }
    this.steer = delta;

    // ---- surfaces
    const fwdAlong = Math.cos(this.relYaw);
    const fwdLat = -Math.sin(this.relYaw);
    let onKerb = false;
    let allOff = true;
    for (let i = 0; i < 4; i++) {
      const along = this.wx[i];
      const side = this.wy[i]; // + left
      const lat = this.lateral + fwdLat * along - side * fwdAlong;
      const sw = this.s + fwdAlong * along - Math.sin(this.relYaw) * side;
      const sc = track.surfaceAt(sw, lat);
      this.surface[i] = sc;
      this.wetW[i] = this.weather ? this.weather.wetnessAt(lat, track.racingLineAt(sw)) : 0;
      if (sc === SURF.KERB) onKerb = true;
      if (!(sc === SURF.GRASS || sc === SURF.GRAVEL || sc === SURF.ASPHALT)) allOff = false;
    }
    this.surfaceFL = this.surface[0];
    this.surfaceFR = this.surface[1];
    this.surfaceRL = this.surface[2];
    this.surfaceRR = this.surface[3];
    this.onKerb = onKerb;
    this.offTrack = allOff;

    // ---- aero
    const v = Math.max(0, this.vx);
    const q = 0.5 * RHO * v * v;
    this.drsOpen = drsAllowed && this.drsOpen && brake < 0.05;
    this.drsAnim += ((this.drsOpen ? 1 : 0) - this.drsAnim) * Math.min(1, dt * 12);
    const floorFactor = this.offTrack ? 0.72 : 1;
    const clA = (sp.clA - sp.drsLift * this.drsAnim) * (1 - 0.16 * this.dirty) * floorFactor;
    const cdA = (sp.cdA - sp.drsDrag * this.drsAnim) * (1 - 0.28 * this.tow);
    const down = q * clA;
    const drag = q * cdA;
    const balance = Math.max(0.36, Math.min(0.5, sp.aeroFront + Math.max(-0.015, Math.min(0.022, -this.ax * sp.pitchAero))));
    const downF = down * balance * (1 - 0.35 * this.wingDamage);
    const downR = down * (1 - balance);

    // ---- loads
    const Fz0 = (sp.mass * G) / 4;
    const axleF = (m * G * sp.b) / L + downF - (m * this.ax * sp.cgH) / L;
    const axleR = (m * G * sp.a) / L + downR + (m * this.ax * sp.cgH) / L;
    const latT = (m * this.ay * sp.cgH) / ((sp.trackF + sp.trackR) / 2);
    const dF = latT * sp.rollFront;
    const dR = latT * (1 - sp.rollFront);
    // ay > 0 (turning left) moves load onto the right-hand (outside) wheels
    this.load[0] = axleF / 2 - dF / 2;
    this.load[1] = axleF / 2 + dF / 2;
    this.load[2] = axleR / 2 - dR / 2;
    this.load[3] = axleR / 2 + dR / 2;
    for (let i = 0; i < 4; i++) {
      if (this.surface[i] === SURF.KERB && v > 3) {
        this.kerbPhase[i] += (v * dt * Math.PI * 2) / 1.05;
        this.load[i] *= 1 + 0.32 * Math.sin(this.kerbPhase[i]);
      }
      if (this.load[i] < 40) this.load[i] = 40;
    }

    // ---- drivetrain
    const wheelCirc = 2 * Math.PI * sp.wheelR;
    this.shiftCut = Math.max(0, this.shiftCut - dt);
    const rearOmega = (this.omega[2] + this.omega[3]) / 2;
    if (this.assists.autoGear && !this.reverse) {
      const rpmNow = (Math.abs(rearOmega) * 60 * this.overallRatio()) / (2 * Math.PI);
      if (rpmNow > sp.rpmLimit - 350 && this.gear < sp.gears.length && throttle > 0.1) this.shift(1);
      else if (this.gear > 1) {
        const rpmDown = (Math.abs(this.vx) / wheelCirc) * 60 * this.overallRatio(this.gear - 1);
        const downAt = brake > 0.1 ? sp.rpmLimit - 1300 : sp.rpmLimit - 2500;
        if (rpmDown < downAt) this.shift(-1);
      }
    } else if (!this.reverse) {
      if (input.shiftUp && this.gear < sp.gears.length) this.shift(1);
      if (input.shiftDown && this.gear > 1) {
        const rpmDown = (Math.abs(this.vx) / wheelCirc) * 60 * this.overallRatio(this.gear - 1);
        if (rpmDown < sp.rpmLimit + 300) this.shift(-1);
      }
    }
    const ratio = this.reverse ? -14 : this.overallRatio();
    const rpmWheels = (Math.abs(rearOmega) * 60 * Math.abs(ratio)) / (2 * Math.PI);
    // launch clutch: slips to hold revs in first gear
    const launch = !this.reverse && this.gear === 1 && rpmWheels < sp.rpmIdle + 5000;
    let engRpm = launch ? Math.max(rpmWheels, sp.rpmIdle + throttle * 5400) : rpmWheels;
    engRpm = Math.max(sp.rpmIdle, engRpm);
    this.limiter = engRpm >= sp.rpmLimit - 10 && throttle > 0.5;
    if (engRpm > sp.rpmLimit) engRpm = sp.rpmLimit;

    this.ersDeploying = input.ers && this.ers > 0.001 && throttle > 0.5 && !this.reverse;
    let power = this.powerAt(engRpm);
    if (this.ersDeploying) {
      power += sp.ersBoost;
      this.ers = Math.max(0, this.ers - dt / 22);
    }
    if (brake > 0.2 && v > 10) this.ers = Math.min(1, this.ers + (brake * dt) / 30);
    else if (throttle < 0.05 && v > 20) this.ers = Math.min(1, this.ers + dt / 140);

    const engTorque = power / ((engRpm * 2 * Math.PI) / 60);
    let axleTorque = throttle * engTorque * Math.abs(ratio);
    if (this.limiter) axleTorque *= 0.2;
    if (this.shiftCut > 0) axleTorque *= 0.3;
    if (this.reverse) axleTorque = brake * 2600;
    // overrun: engine braking + MGU-K harvest
    if (!this.reverse && throttle < 0.05 && v > 3) axleTorque = -(0.035 + 0.11 * (engRpm / sp.rpmLimit) ** 2) * m * G * sp.wheelR;

    // limited-slip differential: equal split plus a coupling toward equal wheel speeds
    const lsd = Math.max(-500, Math.min(500, (this.omega[2] - this.omega[3]) * 120));
    const Tdrive = [0, 0, axleTorque / 2 - lsd, axleTorque / 2 + lsd];
    if (this.reverse) {
      Tdrive[2] = -axleTorque / 2;
      Tdrive[3] = -axleTorque / 2;
    }

    // ---- brakes
    const Tb = [0, 0, 0, 0];
    if (!this.reverse && brake > 0) {
      const tf = brake * sp.brakeTorque * sp.brakeBias * 0.5;
      const tr = brake * sp.brakeTorque * (1 - sp.brakeBias) * 0.5;
      Tb[0] = Tb[1] = tf;
      Tb[2] = Tb[3] = tr;
    }

    // ---- per-wheel tyre forces with implicit wheel spin
    const R = sp.wheelR;
    const I = sp.wheelI;
    const tmp = [0, 0];
    const tmp2 = [0, 0];
    let Fxb = 0;
    let Fyb = 0;
    let Mz = 0;
    let slipF = 0;
    let slipR = 0;
    let spin = 0;
    let lock = 0;
    let gripSum = 0;
    const kp = sp.slipRatioPeak;
    const ap = sp.slipAnglePeak;
    const apR = sp.slipAnglePeakRear;
    // TC keeps the rear tyre's combined slip under a target: full never lets it
    // pass the peak (so power can't spin the car), medium allows a slide
    const tcCombined = this.assists.traction === 'full' ? 0.92 : this.assists.traction === 'medium' ? 1.3 : Infinity;
    const tcMinSlip = this.assists.traction === 'full' ? 0.12 : 0.75;
    const cd = Math.cos(delta);
    const sd = Math.sin(delta);
    const tAmb = this.weather ? 0.35 * this.weather.state.airTemp + 0.65 * this.weather.state.trackTemp : 36;
    for (let i = 0; i < 4; i++) {
      const front = FRONT[i];
      const c = front ? cd : 1;
      const s = front ? sd : 0;
      const vxw = this.vx - this.r * this.wy[i];
      const vyw = this.vy + this.r * this.wx[i];
      const vl = vxw * c + vyw * s;
      const vt = -vxw * s + vyw * c;
      const vref = Math.max(Math.abs(vl), V_MIN);
      const sy = vt / vref / (front ? ap : apR);
      const sc = this.surface[i];
      const Fz = this.load[i];
      const wearGrip = 1 - 0.14 * Math.pow(this.wear[i], 1.6);
      // weather: water level under this tyre → grip for this tyre type, aquaplaning on standing water
      const wet = this.wetW[i];
      let weatherGrip = wetGrip(this.tyreType, wet);
      if (wet > 0.45 && v > 45) weatherGrip *= 1 - AQUA[this.tyreType] * Math.min(1, (wet - 0.45) / 0.55) * Math.min(1, (v - 45) / 35);
      // wet paint and wet grass are far worse than wet asphalt
      const surfGrip = SURF_GRIP[sc] * (sc === SURF.KERB ? 1 - 0.3 * wet : sc === SURF.GRASS ? 1 - 0.4 * wet : 1);
      const tGrip = tempGrip(this.tyreTemp[i], this.tyreOpt);
      const cond = weatherGrip * tGrip * wearGrip * this.compoundGrip;
      gripSum += cond;
      const muI = sp.mu * (front ? 1 : sp.muRear) * Math.max(0.55, 1 - sp.loadSens * (Fz / Fz0 - 1)) * surfGrip * cond;
      const Fmax = muI * Fz;

      let td = Tdrive[i];
      let tb = Tb[i];
      // traction control: never ask for more than the grip at the target slip
      if (!front && td > 0 && tcCombined < Infinity) {
        const sxT = Math.max(tcMinSlip, Math.sqrt(Math.max(0, tcCombined * tcCombined - sy * sy)));
        this.tyre(sxT, sy, Fmax, tmp2);
        const tMax = tmp2[0] * R * 1.02 + (I * Math.max(0, vl / R - this.omega[i])) / dt * 0.2;
        if (td > tMax) {
          td = Math.max(0, tMax);
          this.tcActive = true;
        }
      }
      // ABS: brake torque capped at what the tyre can take near peak slip
      if (this.assists.abs && tb > 0 && vl > 3) {
        this.tyre(-0.92, sy, Fmax, tmp2);
        const tMax = -tmp2[0] * R * 1.03;
        if (tb > tMax) {
          tb = tMax;
          this.absActive = true;
        }
      }

      // implicit wheel update: linearise Fl around the current omega
      const w0 = this.omega[i];
      const k0 = (w0 * R - vl) / vref;
      this.tyre(k0 / kp, sy, Fmax, tmp);
      const Fl0 = tmp[0];
      const eps = 0.002;
      this.tyre((k0 + eps) / kp, sy, Fmax, tmp2);
      const dFdk = Math.max(0, (tmp2[0] - Fl0) / eps);
      const K = (dFdk * R) / vref; // dFl/dω
      const denom = 1 + (dt * R * K) / I;
      let w1 = w0 + ((dt / I) * (td - R * Fl0)) / denom;
      const bstep = (dt * tb) / (I * denom);
      if (Math.abs(w1) <= bstep) w1 = 0;
      else w1 -= Math.sign(w1) * bstep;
      // ideal ABS / TC: hold slip just under the peak rather than oscillating across it.
      // ABS is combined-slip aware — braking in a turn keeps enough lateral grip
      // (more on the rear) that trail-braking rotates the car without spinning it
      if (this.assists.abs && tb > 0 && vl > 2) {
        const cap = front ? 0.95 : 0.85;
        const sxAbs = Math.max(0.3, Math.min(0.85, Math.sqrt(Math.max(0, cap * cap - sy * sy))));
        const wMin = (vl - sxAbs * kp * vref) / R;
        if (w1 < wMin) {
          w1 = wMin;
          this.absActive = true;
        }
      }
      if (!front && td > 0 && tcCombined < Infinity) {
        const sxT = Math.max(tcMinSlip, Math.sqrt(Math.max(0, tcCombined * tcCombined - sy * sy)));
        const wMax = (vl + sxT * kp * vref) / R;
        if (w1 > wMax) {
          w1 = wMax;
          this.tcActive = true;
        }
      }
      this.omega[i] = w1;

      const k1 = (w1 * R - vl) / vref;
      this.slipRatio[i] = k1;
      this.slipAngle[i] = Math.atan2(vt, vref);
      this.tyre(k1 / kp, sy, Fmax, tmp);
      let Fl = tmp[0];
      let Ft = tmp[1];
      // rolling resistance and bogging in gravel/grass
      Fl -= Math.sign(vl) * Fz * (SURF_RR[sc] + SURF_RR_V[sc] * Math.abs(vl));
      Ft -= vt * SURF_BOG[sc] * Fz * 0.01;

      const fbx = Fl * c - Ft * s;
      const fby = Fl * s + Ft * c;
      Fxb += fbx;
      Fyb += fby;
      Mz += this.wx[i] * fby - this.wy[i] * fbx;

      const sn = Math.hypot(k1 / kp, sy);
      if (front) slipF = Math.max(slipF, sn);
      else slipR = Math.max(slipR, sn);
      if (!front && k1 > kp * 1.4) spin = Math.max(spin, Math.min(1, (k1 - kp * 1.4) / (kp * 4)));
      if (k1 < -kp * 1.6 && vl > 3) lock = Math.max(lock, Math.min(1, (-k1 - kp * 1.6) / (kp * 5)));

      // tyre wear from sliding energy, faster when overheating
      const pL = Math.abs(Fl * (w1 * R - vl));
      const pT = Math.abs(Ft * vt);
      this.slipPowL[i] = pL;
      this.slipPowT[i] = pT;
      const slipPower = pL + pT;
      const T = this.tyreTemp[i];
      const hot = Math.min(2, Math.max(0, T - this.tyreOpt - 15) / 25);
      this.wear[i] = Math.min(1, this.wear[i] + slipPower * dt * 8.5e-8 * this.compoundWear * (1 + hot));
      // temperature: sliding + rolling heat in; air (speed) and water carry it away
      // treaded inters/wets build more heat (and overheat on a dry track)
      const heat = ((0.3 * pL + pT) * TYRE_HEAT_SLIP + Fz * Math.abs(vl) * TYRE_HEAT_ROLL) * (1 + 0.15 * this.tyreType);
      const cool = ((TYRE_COOL_0 + TYRE_COOL_V * Math.abs(vl)) * (T - tAmb) + TYRE_COOL_WET * wet * (T - tAmb * 0.8)) * (front ? 1 : 1.25);
      this.tyreTemp[i] = T + (heat - cool) * dt;
    }
    this.gripFactor = gripSum / 4;
    if (this.burnFuel && this.fuel > 0) this.fuel = Math.max(0, this.fuel - FUEL_FLOW * throttle * (this.ersDeploying ? 1 : 0.97) * dt);
    this.slipFront = slipF;
    this.slipRear = slipR;
    this.wheelspin = spin;
    this.lockup = lock;

    // stability assist (yaw side): ESC-style moment when the car rotates faster
    // than the path it is actually following (ay / v) — i.e. oversteer
    if (this.assists.stability && vabs > 8) {
      const pathRate = this.ay / this.vx;
      const err = this.r - pathRate;
      if (Math.sign(err) === Math.sign(this.r) && Math.abs(err) > 0.07) {
        Mz -= Math.sign(err) * Math.min(7000, (Math.abs(err) - 0.07) * 26000);
      }
    }

    // ---- gravity on slopes and banking (in-plane component of g)
    const ti = Math.floor(track.wrap(this.s));
    const ux = track.ux[ti];
    const uy = track.uy[ti];
    const uz = track.uz[ti];
    const syaw = Math.sin(this.yaw);
    const cyaw = Math.cos(this.yaw);
    const gAlong = G * uy * (ux * syaw + uz * cyaw);
    const gSide = G * uy * (ux * cyaw - uz * syaw);

    // ---- equations of motion
    const sgn = this.vx >= 0 ? 1 : -1;
    const Fx = Fxb - drag * sgn;
    const axBody = Fx / m + gAlong;
    const ayBody = Fyb / m + gSide;
    this.vx += (axBody + this.vy * this.r) * dt;
    this.vy += (ayBody - this.vx * this.r) * dt;
    this.r += (Mz / sp.iz) * dt;

    // settle at a standstill instead of creeping
    if (Math.abs(this.vx) < 0.4 && throttle < 0.05 && !this.reverse) {
      this.vx *= 0.9;
      this.vy *= 0.9;
      this.r *= 0.9;
    }

    this.ax += (axBody - this.ax) * Math.min(1, dt * 16);
    this.ay += (ayBody - this.ay) * Math.min(1, dt * 16);

    // ---- integrate pose
    this.yaw += this.r * dt;
    const syn = Math.sin(this.yaw);
    const cyn = Math.cos(this.yaw);
    this.x += (this.vx * syn + this.vy * cyn) * dt;
    this.z += (this.vx * cyn - this.vy * syn) * dt;

    // ---- track-relative
    const pr = track.project(this.x, this.z, this.hint);
    this.hint = pr.index;
    this.s = pr.s;
    this.lateral = pr.lateral;
    let ry = this.yaw - track.frame(this.s).heading;
    while (ry > Math.PI) ry -= Math.PI * 2;
    while (ry < -Math.PI) ry += Math.PI * 2;
    this.relYaw = ry;

    this.collideBarriers(track);

    // ---- readouts
    const rpmOut = this.reverse ? sp.rpmIdle + Math.abs(this.vx) * 220 : engRpm;
    this.rpm += (Math.min(sp.rpmLimit + 150, rpmOut) - this.rpm) * Math.min(1, dt * 30);
    if (this.limiter) this.rpm = sp.rpmLimit - 180 + Math.random() * 280;
    this.throttle = throttle;
    this.brake = brake;
    this.wheelAngleF += ((this.omega[0] + this.omega[1]) / 2) * dt;
    this.wheelAngleR += rearOmega * dt;
    const heatIn = brake * Math.max(0, v - 15) * 0.012;
    this.brakeHeat = Math.min(1, Math.max(0, this.brakeHeat + (heatIn - this.brakeHeat * 0.9) * dt * 1.6));

    // ---- suspension (visual springs)
    const kerbBump = this.onKerb ? Math.sin((this.kerbPhaseVis += v * dt * 6)) * 0.007 * Math.min(1, v / 20) : 0;
    const offBump = this.offTrack ? (Math.random() - 0.5) * 0.02 * Math.min(1, v / 15) : 0;
    const pitchT = -this.ax * 0.0024;
    const rollT = -this.ay * 0.0017;
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
    this.shiftCut = dir > 0 ? 0.04 : 0.03;
    this.lastShift = dir;
  }

  /**
   * Barriers: test the chassis corners against the walls; resolve with an
   * impulse at the contact point (restitution + wall friction), so glancing
   * blows scrub speed and square hits spin the car the physical way.
   */
  private collideBarriers(track: Track) {
    const sp = this.spec;
    const ca = Math.cos(this.relYaw);
    const sa = Math.sin(this.relYaw);
    let worst = 0;
    let wAlong = 0;
    let wSide = 0;
    let wSign = 0;
    const pts: [number, number][] = [
      [sp.halfLength * 0.95, sp.halfWidth],
      [sp.halfLength * 0.95, -sp.halfWidth],
      [-sp.halfLength * 0.85, sp.halfWidth],
      [-sp.halfLength * 0.85, -sp.halfWidth],
      [0, sp.halfWidth],
      [0, -sp.halfWidth],
    ];
    for (const [along, side] of pts) {
      const latOff = -sa * along - ca * side;
      const sOff = ca * along - sa * side;
      const lat = this.lateral + latOff;
      const sideSign = lat >= 0 ? 1 : -1;
      const bar = track.barrierAt(this.s + sOff, sideSign);
      const pen = Math.abs(lat) - bar;
      if (pen > worst) {
        worst = pen;
        wAlong = along;
        wSide = side;
        wSign = sideSign;
      }
    }
    if (worst <= 0) return;
    const i = Math.floor(track.wrap(this.s));
    const rl = Math.hypot(track.rx[i], track.rz[i]);
    // outward normal toward the wall
    const nx = (track.rx[i] / rl) * wSign;
    const nz = (track.rz[i] / rl) * wSign;
    // push out
    this.x -= nx * worst;
    this.z -= nz * worst;
    this.lateral -= wSign * worst;
    // contact point (world)
    const syaw = Math.sin(this.yaw);
    const cyaw = Math.cos(this.yaw);
    const px = this.x + syaw * wAlong + cyaw * wSide;
    const pz = this.z + cyaw * wAlong - syaw * wSide;
    const [pvx, pvz] = this.pointVelocity(px, pz);
    const vn = pvx * nx + pvz * nz;
    if (vn <= 0) return;
    const rcx = px - this.x;
    const rcz = pz - this.z;
    const m = this.mass;
    const Iz = sp.iz;
    // impulse along −n
    const rn = rcz * -nx - rcx * -nz;
    const e = vn > 8 ? 0.12 : 0.25;
    const jn = ((1 + e) * vn) / (1 / m + (rn * rn) / Iz);
    // tangential friction impulse (wall scrape)
    let tx = pvx - vn * nx;
    let tz = pvz - vn * nz;
    const vt = Math.hypot(tx, tz);
    let jt = 0;
    if (vt > 1e-3) {
      tx /= vt;
      tz /= vt;
      const rt = rcz * -tx - rcx * -tz;
      const jtMax = vt / (1 / m + (rt * rt) / Iz);
      jt = Math.min(0.45 * jn, jtMax);
    }
    this.applyImpulse(px, pz, -nx * jn - tx * jt, -nz * jn - tz * jt);
    this.contact.wallHit = vn;
    this.contact.wallSide = wSign;
    this.damage += vn;
    if (wAlong > 0 && vn > 4) this.wingDamage = Math.min(1, this.wingDamage + vn * 0.025);
  }
}
