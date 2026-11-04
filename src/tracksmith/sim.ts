import RAPIER from '@dimforge/rapier3d-compat';
import { PIECES, inGate, onBoost, spawnPose, worldFrames, type Frame, type Placed, type Vec3 } from './pieces.ts';
import { trackMesh, type TrackData } from './track.ts';

/**
 * The race: a Rapier rigid body for the car with hand-made raycast wheels (suspension, tyres, engine,
 * brakes, air control) at 120 Hz, the track as one triangle mesh, a flat drivable ground. No three.js
 * here: the headless tools drive the same code.
 */
export const HZ = 120;
export const DT = 1 / HZ;
export const GRAVITY = 15;

export interface Input { throttle: number; brake: number; steer: number; hand: boolean }
export const NO_INPUT: Input = { throttle: 0, brake: 0, steer: 0, hand: false };

const MASS = 1100;
const WHEELS = [
  { x: 0.84, z: 1.32, front: true },
  { x: -0.84, z: 1.32, front: true },
  { x: 0.84, z: -1.22, front: false },
  { x: -0.84, z: -1.22, front: false },
];
const MOUNT_Y = 0.05;
const REST = 0.42;
export const WHEEL_R = 0.37;
const K_SPRING = 34000;
const C_COMP = 4000;
const C_REB = 5000;
const ANTI_ROLL = 9000;
const MU = 2.2;
const ENGINE_F = 17500;
const POWER = 400000;
const DRAG = 0.95;
const DOWNFORCE = 7;
const BRAKE_F = 24000;
const REVERSE_MAX = 16;
export const STEER_LOCK = 0.72;
export const STEER_FADE = 30;
const BOOST_A = 20;
const BOOST_T = 0.9;
/** a slide held through a corner pays out when you let go: how long it takes to fill, what it gives */
const DRIFT_MIN = 0.3;
const DRIFT_FULL = 1.2;
const DRIFT_A = 13;
/** how fast the nose swings, how fast the velocity follows it (rad/s), what the slide costs (share of the speed a second) */
const DRIFT_YAW = 2.3;
const DRIFT_TURN = 1.75;
const DRIFT_COST = 0.11;
/** landing square on all four wheels */
const CLEAN_T = 0.4;

export interface WheelState { hit: boolean; comp: number; spin: number; steer: number; slip: number }
export interface CarState { p: Vec3; q: [number, number, number, number]; v: Vec3; w: Vec3 }

type Ev = { type: 'check'; i: number; n: number; ticks: number } | { type: 'finish'; ticks: number } | { type: 'boost' } | { type: 'land'; speed: number; clean: boolean } | { type: 'drift'; k: number } | { type: 'respawn' } | { type: 'start' };

let ready: Promise<void> | null = null;
export const initPhysics = () => (ready ??= RAPIER.init());

// small vector helpers on plain objects
type V = { x: number; y: number; z: number };
const v3 = (x = 0, y = 0, z = 0): V => ({ x, y, z });
const dotv = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const crossv = (a: V, b: V): V => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const scale = (a: V, s: number): V => v3(a.x * s, a.y * s, a.z * s);
const addv = (a: V, b: V): V => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const subv = (a: V, b: V): V => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const len = (a: V) => Math.hypot(a.x, a.y, a.z);
const normv = (a: V): V => { const l = len(a) || 1; return v3(a.x / l, a.y / l, a.z / l); };
function rotate(q: { x: number; y: number; z: number; w: number }, v: V): V {
  // v + w t + q x t, t = 2 q x v
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return v3(v.x + q.w * tx + (q.y * tz - q.z * ty), v.y + q.w * ty + (q.z * tx - q.x * tz), v.z + q.w * tz + (q.x * ty - q.y * tx));
}
function quatFromBasis(f: Vec3): [number, number, number, number] {
  // yaw-only rotation taking local +z to f (flattened)
  const yaw = Math.atan2(f[0], f[2]);
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

export class Sim {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  chassis: RAPIER.Collider;
  track: TrackData;
  wheels: WheelState[] = WHEELS.map(() => ({ hit: false, comp: 0, spin: 0, steer: 0, slip: 0 }));
  private prevComp = [0, 0, 0, 0];
  private steerNow = 0;

  ticks = 0;
  started = false;
  finished = false;
  passed = new Set<number>();
  checks: number[] = [];
  finishes: number[] = [];
  boosts: number[] = [];
  boostT = 0;
  /** the slide being held (seconds), and the payout running */
  driftT = 0;
  driftBoost = 0;
  private driftV = 0;
  private wasHand = false;
  airT = 0;
  grounded = 0;
  speed = 0;
  events: Ev[] = [];
  private spawn!: CarState;
  private save!: CarState;
  private inGateNow = new Set<number>();
  /** world frames of every loop piece: the guide keeps the car pointed along them */
  private loops: Frame[][] = [];

  constructor(track: TrackData) {
    this.track = track;
    const w = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    w.timestep = DT;
    w.numSolverIterations = 4;
    this.world = w;

    // ground
    const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(RAPIER.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.8), g);

    // track
    const m = trackMesh(track.pieces);
    if (m.idx.length) {
      const tb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      const desc = RAPIER.ColliderDesc.trimesh(new Float32Array(m.pos), new Uint32Array(m.idx), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.35);
      w.createCollider(desc, tb);
    }

    // car
    const bd = RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setAngularDamping(0.15).setLinearDamping(0);
    this.body = w.createRigidBody(bd);
    this.chassis = w.createCollider(RAPIER.ColliderDesc.roundCuboid(0.78, 0.26, 1.8, 0.16).setTranslation(0, 0.12, 0.05).setDensity(0).setFriction(0.25).setRestitution(0.05), this.body);
    const Ix = (MASS / 12) * (0.9 ** 2 + 4.2 ** 2), Iy = (MASS / 12) * (1.9 ** 2 + 4.2 ** 2), Iz = (MASS / 12) * (1.9 ** 2 + 0.9 ** 2);
    this.body.setAdditionalMassProperties(MASS, { x: 0, y: 0, z: 0 }, { x: Ix, y: Iy, z: Iz }, { x: 0, y: 0, z: 0, w: 1 }, true);

    track.pieces.forEach((p, i) => {
      const f = PIECES[p.t].feature;
      if (f === 'check') this.checks.push(i);
      if (f === 'finish') this.finishes.push(i);
      if (f === 'boost') this.boosts.push(i);
      if (f === 'loop') this.loops.push(worldFrames(p, 96));
    });
    this.reset();
  }

  free() {
    this.world.free();
  }

  get startPiece(): Placed | undefined {
    return this.track.pieces.find((p) => PIECES[p.t].feature === 'start');
  }

  /** back to the start line, settled on the suspension, clock stopped until the first input */
  reset() {
    const st = this.startPiece;
    const pose = st ? spawnPose(st) : { p: [0, 1, 0] as Vec3, f: [0, 0, 1] as Vec3 };
    this.setState({ p: pose.p, q: quatFromBasis(pose.f), v: [0, 0, 0], w: [0, 0, 0] });
    for (let i = 0; i < 90; i++) this.physics(NO_INPUT);
    this.spawn = this.getState();
    this.setState(this.spawn);
    this.save = this.spawn;
    this.ticks = 0;
    this.started = false;
    this.finished = false;
    this.passed.clear();
    this.inGateNow.clear();
    this.boostT = 0;
    this.driftT = this.driftBoost = this.driftV = 0;
    this.wasHand = false;
    this.airT = 0;
    this.steerNow = 0;
    this.events.length = 0;
  }

  /** back to the last checkpoint with the speed you crossed it at */
  respawn() {
    this.setState(this.save);
    this.boostT = 0;
    this.driftT = this.driftBoost = 0;
    this.steerNow = 0;
    this.events.push({ type: 'respawn' });
  }

  getState(): CarState {
    const t = this.body.translation(), r = this.body.rotation(), v = this.body.linvel(), w = this.body.angvel();
    return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z] };
  }

  setState(s: CarState) {
    const b = this.body;
    b.setTranslation({ x: s.p[0], y: s.p[1], z: s.p[2] }, true);
    b.setRotation({ x: s.q[0], y: s.q[1], z: s.q[2], w: s.q[3] }, true);
    b.setLinvel({ x: s.v[0], y: s.v[1], z: s.v[2] }, true);
    b.setAngvel({ x: s.w[0], y: s.w[1], z: s.w[2] }, true);
    this.prevComp = [0, 0, 0, 0];
  }

  /** one 120 Hz tick */
  step(inp: Input) {
    if (this.finished) {
      this.physics({ throttle: 0, brake: 0.4, steer: 0, hand: false });
      return;
    }
    if (!this.started) {
      if (inp.throttle > 0 || inp.brake > 0 || Math.abs(inp.steer) > 0.2) {
        this.started = true;
        this.events.push({ type: 'start' });
      } else return;
    }
    this.ticks++;
    this.physics(inp);
    this.triggers();
  }

  private triggers() {
    const t = this.body.translation();
    const p: Vec3 = [t.x, t.y, t.z];
    const pieces = this.track.pieces;
    for (const i of this.checks) {
      const inside = inGate(pieces[i], p);
      if (inside && !this.inGateNow.has(i)) {
        if (!this.passed.has(i)) {
          this.passed.add(i);
          this.save = this.getState();
          this.events.push({ type: 'check', i, n: this.passed.size, ticks: this.ticks });
        }
      }
      if (inside) this.inGateNow.add(i);
      else this.inGateNow.delete(i);
    }
    if (this.passed.size >= this.checks.length) {
      for (const i of this.finishes) {
        if (inGate(pieces[i], p)) {
          this.finished = true;
          this.events.push({ type: 'finish', ticks: this.ticks });
          break;
        }
      }
    }
    for (const i of this.boosts) {
      if (onBoost(pieces[i], p)) {
        if (this.boostT < BOOST_T - 0.15) this.events.push({ type: 'boost' });
        this.boostT = BOOST_T;
      }
    }
    if (t.y < -40) this.respawn();
  }

  private physics(inp: Input) {
    const b = this.body;
    const q = b.rotation();
    const pos = b.translation();
    const lv = b.linvel();
    const av = b.angvel();
    const vel = v3(lv.x, lv.y, lv.z);
    const ang = v3(av.x, av.y, av.z);
    const up = rotate(q, v3(0, 1, 0));
    const fwd = rotate(q, v3(0, 0, 1));
    const right = rotate(q, v3(-1, 0, 0));
    const com = v3(pos.x, pos.y, pos.z);
    const speed = len(vel);
    const vFwd = dotv(vel, fwd);
    this.speed = speed;

    // steering: smoothed, less lock at speed
    const lock = STEER_LOCK / (1 + Math.max(0, vFwd) / STEER_FADE);
    const target = inp.steer * lock;
    const rate = (Math.abs(target) < Math.abs(this.steerNow) ? 16 : 9.5) * DT;
    this.steerNow += Math.max(-rate, Math.min(rate, target - this.steerNow));

    // engine and brakes
    const reversing = inp.brake > 0 && vFwd < 1.5 && inp.throttle === 0;
    let drive = 0;
    if (inp.throttle > 0) drive = inp.throttle * Math.min(ENGINE_F, POWER / Math.max(Math.abs(vFwd), 1));
    if (reversing) drive = vFwd > -REVERSE_MAX ? -inp.brake * ENGINE_F * 0.5 : 0;
    const braking = inp.brake > 0 && !reversing ? inp.brake * BRAKE_F : 0;

    const sliding = inp.hand && this.grounded >= 2 && vFwd > 9;
    const comps = [0, 0, 0, 0];
    const hits: (RAPIER.RayColliderIntersection | null)[] = [];
    const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: -up.x, y: -up.y, z: -up.z });
    const maxLen = REST + WHEEL_R;
    let grounded = 0;
    for (let i = 0; i < 4; i++) {
      const W = WHEELS[i];
      const mount = addv(com, rotate(q, v3(W.x, MOUNT_Y, W.z)));
      ray.origin = { x: mount.x, y: mount.y, z: mount.z };
      const h = this.world.castRayAndGetNormal(ray, maxLen, true, undefined, undefined, undefined, b);
      hits.push(h);
      if (h && h.normal.x * up.x + h.normal.y * up.y + h.normal.z * up.z > 0.35) {
        comps[i] = maxLen - h.timeOfImpact;
        grounded++;
      } else hits[i] = null;
    }
    // land event
    if (grounded > 0 && this.grounded === 0 && this.airT > 0.35) {
      // nose along the flight path and wheels down: it keeps the car flowing, with a kick
      const hs = Math.hypot(vel.x, vel.z) || 1;
      const clean = this.airT > 0.5 && up.y > 0.8 && (fwd.x * vel.x + fwd.z * vel.z) / (Math.hypot(fwd.x, fwd.z) * hs) > 0.985;
      if (clean) this.boostT = Math.max(this.boostT, CLEAN_T);
      this.events.push({ type: 'land', speed: Math.abs(dotv(vel, up)), clean });
    }
    this.grounded = grounded;
    this.airT = grounded ? 0 : this.airT + DT;

    const imp = (f: V, at: V) => b.applyImpulseAtPoint({ x: f.x * DT, y: f.y * DT, z: f.z * DT }, { x: at.x, y: at.y, z: at.z }, true);

    for (let i = 0; i < 4; i++) {
      const W = WHEELS[i];
      const ws = this.wheels[i];
      ws.steer = W.front ? this.steerNow : 0;
      const h = hits[i];
      const comp = comps[i];
      const cvel = (comp - this.prevComp[i]) / DT;
      this.prevComp[i] = comp;
      ws.hit = !!h;
      ws.comp = comp;
      if (!h) {
        ws.slip = 0;
        ws.spin += (vFwd / WHEEL_R) * DT * (inp.throttle > 0 ? 1.4 : 1);
        continue;
      }
      // suspension + anti-roll
      const other = comps[i ^ 1];
      let N = K_SPRING * comp + (cvel > 0 ? C_COMP : C_REB) * cvel + ANTI_ROLL * (comp - other);
      if (comp > REST * 0.75) N += 260000 * (comp - REST * 0.75) + Math.max(0, cvel) * 9000; // bump stop, damped
      N = Math.max(0, Math.min(N, MASS * GRAVITY * 12));
      const mount = addv(com, rotate(q, v3(W.x, MOUNT_Y, W.z)));
      const cp = v3(mount.x - up.x * (maxLen - comp), mount.y - up.y * (maxLen - comp), mount.z - up.z * (maxLen - comp));
      imp(scale(up, N), cp);

      // tyre
      const n = v3(h.normal.x, h.normal.y, h.normal.z);
      const sd = Math.sin(ws.steer), cd = Math.cos(ws.steer);
      let wf = addv(scale(fwd, cd), scale(right, sd));
      wf = normv(subv(wf, scale(n, dotv(wf, n))));
      const ws_ = normv(crossv(n, wf)); // points to the car's left
      const r = subv(cp, com);
      const pv = addv(vel, crossv(ang, r));
      const vLong = dotv(pv, wf);
      const vLat = dotv(pv, ws_);
      const rear = !W.front;
      const mu = MU;
      // lateral: kill sideways speed of this corner's share of the car (a drift steers the car itself, below)
      let fLat = (-vLat * (MASS / 4) * 0.55) / DT * (sliding ? 0.12 : 1);
      let fLong = 0;
      const share = W.front ? 0.42 : 0.58;
      fLong += (drive * share) / 2;
      if (braking > 0) fLong -= Math.sign(vLong) * Math.min(braking / 4, (Math.abs(vLong) * MASS) / 4 / DT);
      fLong -= vLong * 7; // rolling resistance
      if (inp.throttle === 0 && inp.brake === 0) fLong -= Math.sign(vLong) * Math.min(260, Math.abs(vLong) * 400); // engine braking / hold still
      const max = mu * N;
      const mag = Math.hypot(fLat, fLong);
      let slip = 0;
      if (mag > max) {
        const s = max / mag;
        slip = 1 - s;
        // sliding: lateral grip falls off a little more than drive
        fLat *= s * 0.92;
        fLong *= s;
      }
      ws.slip = Math.min(1, slip + Math.abs(vLat) / 18);
      const at = addv(cp, scale(up, 0.55 * (maxLen - comp + 0.25)));
      imp(addv(scale(wf, fLong), scale(ws_, fLat)), at);
      ws.spin += (vLong / WHEEL_R) * DT;
    }

    if (grounded >= 2) this.loopGuide(com, fwd, up, ang);
    // stability assist: pull the slip angle back (no assist on the handbrake, so drifts still work)
    if (grounded >= 3 && !inp.hand && speed > 8) {
      const left = scale(right, -1);
      const vLatC = dotv(vel, left), vFwdC = dotv(vel, fwd);
      const beta = Math.atan2(vLatC, Math.abs(vFwdC));
      if (Math.abs(beta) > 0.08 && vFwdC > 0) {
        const Iy = (MASS / 12) * (1.9 ** 2 + 4.2 ** 2);
        const excess = beta - Math.sign(beta) * 0.08;
        // turn the nose toward the direction of travel (positive yaw about up turns +z toward +x = left)
        const tq = excess * 7 * Iy;
        b.applyTorqueImpulse({ x: up.x * tq * DT, y: up.y * tq * DT, z: up.z * tq * DT }, true);
      }
    }
    // a drift: the nose swings in by the steering, the speed follows it round, and a little of it
    // is paid for the angle. Tyres would scrub it all away, so here the car is steered directly
    if (sliding && grounded >= 2) {
      this.driftV = this.driftV > 0 ? this.driftV * (1 - DRIFT_COST * DT) : speed;
      const Iy = (MASS / 12) * (1.9 ** 2 + 4.2 ** 2);
      const tq = (-inp.steer * DRIFT_YAW - dotv(ang, up)) * 14 * Iy;
      b.applyTorqueImpulse({ x: up.x * tq * DT, y: up.y * tq * DT, z: up.z * tq * DT }, true);
      // the velocity turns toward the nose, on the plane of the road
      const vUp = scale(up, dotv(vel, up));
      const hv = subv(vel, vUp);
      const hs = len(hv);
      if (hs > 1) {
        const f = normv(subv(fwd, scale(up, dotv(fwd, up))));
        const d = scale(hv, 1 / hs);
        const a = Math.atan2(dotv(crossv(d, f), up), dotv(d, f));
        const turn = Math.max(-DRIFT_TURN * DT, Math.min(DRIFT_TURN * DT, a));
        const s = Math.sin(turn), c = Math.cos(turn);
        const nd = addv(scale(d, c), scale(crossv(up, d), s));
        const want = addv(scale(nd, Math.max(this.driftV, 1)), vUp);
        const dv = subv(want, vel);
        b.applyImpulse({ x: dv.x * MASS, y: dv.y * MASS, z: dv.z * MASS }, true);
      }
    } else this.driftV = 0;
    // the slide: held through a corner it fills up, let go and it pays out
    if (sliding && grounded >= 2 && Math.abs(inp.steer) > 0.2) this.driftT = Math.min(DRIFT_FULL, this.driftT + DT);
    if (!inp.hand && this.wasHand) {
      // straightening up: the spin stops and the speed goes where the nose points, none of it lost
      if (grounded >= 2 && speed > 9) {
        const yaw = dotv(ang, up);
        b.setAngvel({ x: ang.x - up.x * yaw * 0.8, y: ang.y - up.y * yaw * 0.8, z: ang.z - up.z * yaw * 0.8 }, true);
        const vUp = scale(up, dotv(vel, up));
        const hv = subv(vel, vUp);
        const hs = len(hv);
        const f = normv(subv(fwd, scale(up, dotv(fwd, up))));
        const nd = normv(addv(scale(hv, 0.2 / (hs || 1)), scale(f, 0.8)));
        const dv = subv(addv(scale(nd, hs), vUp), vel);
        b.applyImpulse({ x: dv.x * MASS, y: dv.y * MASS, z: dv.z * MASS }, true);
      }
      if (this.driftT >= DRIFT_MIN) {
        const k = this.driftT / DRIFT_FULL;
        this.driftBoost = 0.25 + 0.65 * k;
        this.events.push({ type: 'drift', k });
      }
      this.driftT = 0;
    }
    if (this.grounded === 0) this.driftT = Math.max(0, this.driftT - DT * 2);
    this.wasHand = inp.hand;
    if (grounded > 0) {
      // aero downforce
      const df = DOWNFORCE * vFwd * vFwd * (grounded / 4);
      imp(scale(up, -df), com);
    } else if (this.airT > 0.08) {
      // gentle air control: yaw with steering; the nose weathervanes into the flight path so jumps land
      const I = MASS * 1.6;
      let t = scale(up, -inp.steer * 2.4 * I);
      if (speed > 8) {
        const vd = scale(vel, 1 / speed);
        const ax = crossv(fwd, vd);
        // only the pitch part (about the car's right axis)
        // spring toward the flight path plus pitch-rate damping (about 0.8 of critical), or it overshoots into a nose-dive
        // (the brake lifts the nose, the handbrake pushes it down: the car lands where you put it)
        const aim = inp.brake > 0 ? 0.32 : inp.hand ? -0.32 : 0;
        t = addv(t, scale(right, ((dotv(ax, right) - aim) * 5 - dotv(ang, right) * 3.6) * I));
      }
      // level the wings: roll the car so its right side is horizontal (about its own forward axis)
      const rollErr = dotv(right, v3(0, 1, 0));
      const rollRate = dotv(ang, fwd);
      if (up.y > 0.2) t = addv(t, scale(fwd, (rollErr * 9 - rollRate * 2.2) * I * 0.6));
      // damp first: setAngvel after the impulse would throw the impulse away
      const k = 1 - 1.2 * DT;
      b.setAngvel({ x: ang.x * k, y: ang.y * k, z: ang.z * k }, true);
      b.applyTorqueImpulse({ x: t.x * DT, y: t.y * DT, z: t.z * DT }, true);
    }
    // aerodynamic drag
    imp(scale(vel, -DRAG * speed), com);
    // boost
    if (this.boostT > 0) {
      this.boostT -= DT;
      imp(scale(fwd, BOOST_A * MASS), com);
    }
    if (this.driftBoost > 0) {
      this.driftBoost -= DT;
      imp(scale(fwd, DRIFT_A * MASS), com);
    }
    this.world.step();
  }

  /** on a loop, turn the car about its own up axis to follow the road's sideways drift */
  private loopGuide(com: V, fwd: V, up: V, ang: V) {
    let best: Frame | null = null, bd = 36;
    for (const F of this.loops) for (const f of F) {
      const d = (f.p[0] - com.x) ** 2 + (f.p[1] - com.y) ** 2 + (f.p[2] - com.z) ** 2;
      if (d < bd) { bd = d; best = f; }
    }
    if (!best || best.u[1] > 0.97) return;
    const tf = v3(best.f[0], best.f[1], best.f[2]);
    // angle between car forward and road tangent, about the car's up
    const err = dotv(crossv(fwd, tf), up);
    const yawRate = dotv(ang, up);
    const Iy = (MASS / 12) * (1.9 ** 2 + 4.2 ** 2);
    const tq = (err * 40 - yawRate * 6) * Iy;
    this.body.applyTorqueImpulse({ x: up.x * tq * DT, y: up.y * tq * DT, z: up.z * tq * DT }, true);
  }

  /** km/h along the car */
  get kmh() {
    return this.speed * 3.6;
  }
}
