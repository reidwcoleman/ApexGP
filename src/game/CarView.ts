import * as THREE from 'three';
import { newTyreLook, type CarRig, type TyreLook } from '../car/CarModel.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import { SURF, type Track } from '../world/Track.ts';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Copies a CarPhysics state onto a CarRig: pose on the track surface,
 * chassis pitch/roll/heave, wheels, steering, brakes, DRS, LOD by distance.
 */
export class CarView {
  readonly rig: CarRig;
  private readonly up = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private smoothedUp = new THREE.Vector3(0, 1, 0);
  private detail: 0 | 1 | 2 = 0;
  private first = true;
  /** pit stop: the jacks' lift at the front and rear (0 … 1), applied on the next sync */
  private liftF = 0;
  private liftR = 0;
  private readonly qLift = new THREE.Quaternion();
  private static readonly X = new THREE.Vector3(1, 0, 0);
  /** tyre condition per corner (FL FR RL RR) and what builds it up; the car the state belongs to */
  private readonly tyres: TyreLook[] = [newTyreLook(), newTyreLook(), newTyreLook(), newTyreLook()];
  private readonly coldGrain = [0, 0, 0, 0];
  private readonly lastWear = [0, 0, 0, 0];
  private live: CarPhysics | null = null;
  /** bodywork grime: road film, rubber flecks, off-track dirt */
  private readonly grime = [0, 0, 0];
  private tyreT = 0;

  constructor(rig: CarRig) {
    this.rig = rig;
  }

  /**
   * `live` false: a replay ghost (its tyre state isn't recorded) — the car keeps the condition
   * it had when the replay started.
   */
  sync(car: CarPhysics, track: Track, dt: number, camPos: THREE.Vector3, isPlayer: boolean, rainLight: boolean, live = true) {
    const rig = this.rig;
    const f = track.frame(car.s);
    // road plane height under the car
    track.point(car.s, car.lateral, 0, this.pos);
    this.pos.x = car.x;
    this.pos.z = car.z;
    this.up.copy(f.up);
    if (this.first) {
      this.smoothedUp.copy(this.up);
      this.first = false;
    } else this.smoothedUp.lerp(this.up, Math.min(1, dt * 12)).normalize();

    this.fwd.set(Math.sin(car.yaw), 0, Math.cos(car.yaw));
    this.fwd.addScaledVector(this.smoothedUp, -this.fwd.dot(this.smoothedUp)).normalize();
    this.left.crossVectors(this.smoothedUp, this.fwd).normalize();
    this.m.makeBasis(this.left, this.smoothedUp, this.fwd);
    this.q.setFromRotationMatrix(this.m);
    rig.root.position.copy(this.pos);
    rig.root.quaternion.copy(this.q);
    if (this.liftF > 0 || this.liftR > 0) {
      // on the jacks: the whole car (wheels hanging) rises ~9 cm at each end
      const H = 0.09;
      rig.root.position.addScaledVector(this.smoothedUp, ((this.liftF + this.liftR) / 2) * H);
      this.qLift.setFromAxisAngle(CarView.X, -Math.atan2((this.liftF - this.liftR) * H, rig.dims.wheelbase));
      rig.root.quaternion.multiply(this.qLift);
    }

    rig.body.rotation.x = car.pitch;
    rig.body.rotation.z = -car.roll;
    rig.body.position.y = car.heave;

    rig.setSteer(car.steer);
    rig.setG(car.ay, car.ax, car.steer);
    rig.setWheelSpin(car.wheelAngleF, car.wheelAngleR);
    rig.setWheelSpeed(Math.abs(car.vx));
    rig.setBrakeGlow(car.brakeHeat);
    rig.setDrs(car.drsAnim);
    rig.setRainLight(rainLight);
    if (live) this.wearAndTear(car, dt);

    const d = camPos.distanceTo(this.pos);
    const want: 0 | 1 | 2 = isPlayer || d < 28 ? 0 : d < 90 ? 1 : 2;
    if (want !== this.detail) {
      this.detail = want;
      rig.setDetail(want);
    }
    rig.update(dt);
  }

  /**
   * Tyre condition and race grime from the physics: wear, graining (cold sliding and mid-stint),
   * pick-up, blisters (running over the window), brake dust, grass and dirt from offs, flat spots
   * from lock-ups. A new set (wear drops, e.g. a pit stop) starts clean; a new race starts everything clean.
   */
  private wearAndTear(car: CarPhysics, dt: number) {
    if (car !== this.live) {
      if (this.live) {
        for (let i = 0; i < 4; i++) this.freshTyre(i);
        this.grime.fill(0);
      }
      this.live = car;
    }
    if (!(dt > 0)) {
      this.push();
      return;
    }
    const v = Math.abs(car.vx);
    const opt = car.tyreOpt;
    for (let i = 0; i < 4; i++) {
      const L = this.tyres[i];
      const w = car.wear[i];
      if (w < this.lastWear[i] - 0.02) this.freshTyre(i);
      this.lastWear[i] = w;
      L.wear = w;
      const T = car.tyreTemp[i];
      L.heat = smooth(opt - 4, opt + 26, T);
      // blisters: sustained running well above the working window
      if (T > opt + 16) L.blister = Math.min(1, L.blister + dt * ((T - opt - 16) / 20) * 0.02);
      // graining: sliding while the rubber is cold tears the surface; it also comes in mid-stint
      const slide = car.slipPowL[i] + car.slipPowT[i];
      if (T < opt - 10 && v > 8) this.coldGrain[i] = Math.min(0.6, this.coldGrain[i] + dt * slide * 1.5e-7 * smooth(opt - 10, opt - 35, T));
      L.graining = clamp01(0.85 * smooth(0.1, 0.5, w) + this.coldGrain[i]);
      // marbles picked up on the shoulders
      L.pickup = clamp01(0.9 * smooth(0.03, 0.45, w) + 0.25 * L.blister);
      // brake dust settles on the rims and the lower sidewall
      if (v > 1) L.dust = Math.min(1, L.dust + dt * (0.0012 + 0.006 * car.brakeHeat * car.brakeHeat) * (i < 2 ? 1.25 : 1));
      // off the track: grass / gravel dust on the tread (scrubs off within a few hundred metres) and the sidewalls
      const sf = car.surface[i];
      if ((sf === SURF.GRASS || sf === SURF.GRAVEL) && v > 2) {
        L.dirt = Math.min(1, L.dirt + dt * 2.2);
        L.grass = Math.min(1, L.grass + dt * 0.5);
      } else {
        L.dirt = Math.max(0, L.dirt - (dt * v) / 180);
        L.grass = Math.max(0.0, L.grass - dt * 0.004);
      }
      // flat spot: a locked front wheel scrubs one place on the tread (the wheel angle stays put while locked)
      if (i < 2 && car.lockup > 0.45 && v > 12) {
        if (L.flat < 0.12) {
          const theta = i === 0 ? car.wheelAngleF : -car.wheelAngleF;
          const a = Math.PI - theta;
          L.flatU = (((1 - a / (Math.PI * 2)) % 1) + 1) % 1;
        }
        L.flat = Math.min(1, L.flat + dt * car.lockup * 0.8);
      }
    }
    // bodywork: film and rubber build with distance (a full race distance ≈ fully grimy), dirt after offs
    const km = (v * dt) / 1000;
    this.grime[0] = Math.min(1, this.grime[0] + km / 140);
    this.grime[1] = Math.min(1, this.grime[1] + km / 110);
    if (car.offTrack && v > 3) this.grime[2] = Math.min(1, this.grime[2] + dt * 0.25);
    else this.grime[2] = Math.max(0, this.grime[2] - dt * 0.001);
    // (uniform pushes are cheap, but there's no need for 60 Hz)
    this.tyreT += dt;
    if (this.tyreT >= 0.1) this.push();
  }
  private push() {
    this.tyreT = 0;
    this.rig.setTyres?.(this.tyres);
    this.rig.setGrime?.(this.grime[0], this.grime[1], this.grime[2]);
  }
  private freshTyre(i: number) {
    const L = this.tyres[i];
    Object.assign(L, newTyreLook());
    this.coldGrain[i] = 0;
    this.lastWear[i] = 0;
  }

  /** pit stop pose: jack lift front / rear (0 … 1) and each wheel's travel off its hub (FL FR RL RR, 0 … 1) */
  setPit(liftF: number, liftR: number, wheels: readonly number[] | null) {
    this.liftF = liftF;
    this.liftR = liftR;
    const r = this.rig;
    r.setWheelOff('wFL', wheels ? wheels[0] : 0);
    r.setWheelOff('wFR', wheels ? wheels[1] : 0);
    r.setWheelOff('wRL', wheels ? wheels[2] : 0);
    r.setWheelOff('wRR', wheels ? wheels[3] : 0);
  }
}
