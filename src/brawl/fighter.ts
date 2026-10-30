import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { R, GRAVITY, STEP, fighterGroups, rv, vec, quat, rq, type PartRef } from './phys.ts';

/**
 * A fighter: an active ragdoll of eleven rigid bodies. Nothing is animated: every joint is pulled
 * toward a pose by a spring-damper torque that pushes back on its parent just as hard, the chest
 * and pelvis are held upright by a balance torque, and a spring under the pelvis carries the weight
 * (the legs only walk for show and to kick). Hands are steered to targets in the world by forces
 * that push back on the chest, so lifting someone heavy really does drag you down; a grab is a
 * joint made at runtime where the hand touches something (another fighter, a prop, a ledge).
 * Hits build up a daze meter; when it fills you go limp for a few seconds.
 */

export const PEL = 0, CHE = 1, HEAD = 2, UAL = 3, FAL = 4, UAR = 5, FAR = 6, THL = 7, SHL = 8, THR = 9, SHR = 10;
export const NPART = 11;
export const PART_NAMES = ['pelvis', 'chest', 'head', 'upperarm.L', 'forearm.L', 'upperarm.R', 'forearm.R', 'thigh.L', 'shin.L', 'thigh.R', 'shin.R'];

/** the rest pose, facing +z, feet on y = 0 (left is +x). The Blender model is built on the same numbers. */
export const BODY = {
  pelvis: { c: [0, 0.8, 0], cap: [0.09, 0.19] },
  chest: { c: [0, 1.12, 0], ball: 0.27 },
  head: { c: [0, 1.6, 0], ball: 0.28 },
  upperarm: { c: [0.37, 1.16, 0], cap: [0.09, 0.08] },
  forearm: { c: [0.39, 0.9, 0], cap: [0.075, 0.075] },
  hand: { off: [0, -0.17, 0.0], r: 0.105 },
  thigh: { c: [0.12, 0.56, 0], cap: [0.08, 0.095] },
  shin: { c: [0.12, 0.26, 0], cap: [0.07, 0.088] },
  foot: { off: [0, -0.19, 0.045], half: [0.085, 0.05, 0.13] },
  joints: {
    spine: [0, 0.96, 0],
    neck: [0, 1.37, 0],
    shoulder: [0.31, 1.3, 0],
    elbow: [0.38, 1.03, 0],
    hip: [0.12, 0.7, 0],
    knee: [0.12, 0.41, 0],
  },
};
const MASS = [10, 14, 5, 1.6, 1.6, 1.6, 1.6, 3.4, 3, 3.4, 3];
const STAND_H = 0.8;
const KO_TIME = 4.2;

export interface Intent {
  /** wanted direction on the ground, world space, length 0..1 */
  mx: number;
  mz: number;
  run: boolean;
  jump: boolean;
  punch: boolean;
  kick: boolean;
  grabL: boolean;
  grabR: boolean;
  lift: boolean;
  /** any button mashed this frame (to wake up or wriggle free) */
  mash: boolean;
}
export const emptyIntent = (): Intent => ({ mx: 0, mz: 0, run: false, jump: false, punch: false, kick: false, grabL: false, grabR: false, lift: false, mash: false });

export interface FighterHooks {
  parts: Map<number, PartRef>;
  hit(by: Fighter | null, who: Fighter, dmg: number, at: THREE.Vector3, part: number, kind: 'punch' | 'kick' | 'slam'): void;
  ko(f: Fighter): void;
  grab(f: Fighter, other: Fighter | null): void;
  jump(f: Fighter): void;
  thrown(by: Fighter, who: Fighter): void;
  prop(by: Fighter, body: RAPIER.RigidBody, at: THREE.Vector3, speed: number): void;
}

interface Joint {
  p: number;
  c: number;
  kp: number;
  kd: number;
  /** wanted rotation of the child relative to the parent (identity = rest pose) */
  t: THREE.Quaternion;
  ired: number;
}

interface Hand {
  part: number;
  col: RAPIER.Collider;
  joint: RAPIER.ImpulseJoint | null;
  held: RAPIER.RigidBody | null;
  heldFighter: Fighter | null;
  punch: number;
  punchDir: THREE.Vector3;
  hitSet: Set<Fighter | RAPIER.RigidBody>;
  cd: number;
  side: number;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _eu = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

function rotVec(q: THREE.Quaternion, out: THREE.Vector3) {
  // shortest-arc rotation vector (axis * angle) of q
  let { x, y, z, w } = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.sqrt(x * x + y * y + z * z);
  if (s < 1e-6) return out.set(x * 2, y * 2, z * 2);
  const ang = 2 * Math.atan2(s, w);
  return out.set((x / s) * ang, (y / s) * ang, (z / s) * ang);
}

const eq = (x: number, y: number, z: number) => _q3.setFromEuler(_eu.set(x, y, z, 'XZY'));

export class Fighter {
  readonly groups: number;
  readonly queryGroups: number;
  bodies: RAPIER.RigidBody[] = [];
  cols: RAPIER.Collider[] = [];
  hands: Hand[] = [];
  feet: RAPIER.Collider[] = [];
  joints: Joint[] = [];
  /** world transforms read back each step (render + logic use these) */
  pos = Array.from({ length: NPART }, () => new THREE.Vector3());
  rot = Array.from({ length: NPART }, () => new THREE.Quaternion());
  vel = Array.from({ length: NPART }, () => new THREE.Vector3());
  ang = Array.from({ length: NPART }, () => new THREE.Vector3());
  private prevV = Array.from({ length: NPART }, () => new THREE.Vector3());
  private inert: number[] = [];
  mass = 0;

  input: Intent = emptyIntent();
  private pend = { jump: false, punch: false, kick: false, mash: 0 };

  alive = false;
  out = false;
  yaw = 0;
  daze = 0;
  ko = 0;
  stagger = 0;
  sinceHit = 99;
  getup = 0;
  fallenT = 0;
  grounded = false;
  groundN = new THREE.Vector3(0, 1, 0);
  groundV = new THREE.Vector3();
  groundBody: RAPIER.RigidBody | null = null;
  airT = 0;
  jumpCd = 0;
  noHover = 0;
  gait = 0;
  speed = 0;
  kickT = 0;
  kickLeg = 0;
  kickHit = new Set<Fighter | RAPIER.RigidBody>();
  kickCd = 0;
  nextHand = 0;
  struggle = 0;
  grabbedBy = new Set<Fighter>();
  liftT = 0;
  lastHitBy: Fighter | null = null;
  lastHitT = 0;
  koCount = 0;
  wins = 0;
  /** seconds since the hands last let go of a lifted fighter (for the throw) */
  private liftedHold = 0;

  constructor(
    readonly world: RAPIER.World,
    readonly slot: number,
    readonly hooks: FighterHooks,
    public name: string,
    public color: number,
    readonly cpu: boolean,
  ) {
    this.groups = fighterGroups(slot);
    this.queryGroups = ((0xffff << 16) | (0xffff & ~(1 << slot))) >>> 0;
  }

  // ---------------------------------------------------------------- lifecycle

  spawn(at: THREE.Vector3, yaw: number) {
    this.despawn();
    const qy = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    const W = this.world;
    const place = (c: number[] | THREE.Vector3) => (Array.isArray(c) ? _a.set(c[0], c[1], c[2]) : _a.copy(c)).applyQuaternion(qy).add(at);
    const mk = (i: number, c: number[], mirror = false) => {
      const p = place(mirror ? [-c[0], c[1], c[2]] : c);
      const d = R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation(rq(qy)).setLinearDamping(0.05).setAngularDamping(0.8).setCanSleep(false);
      if (i === FAL || i === FAR || i === HEAD || i === SHL || i === SHR) d.setCcdEnabled(true);
      const b = W.createRigidBody(d);
      this.bodies[i] = b;
      return b;
    };
    const B = BODY;
    const capX = (hh: number, r: number) => R.ColliderDesc.capsule(hh, r).setRotation(rq(_q.setFromAxisAngle(_b.set(0, 0, 1), Math.PI / 2)));
    const add = (i: number, desc: RAPIER.ColliderDesc, ref: PartRef, friction = 0.6) => {
      const m = MASS[i];
      desc.setFriction(friction).setRestitution(0.02).setCollisionGroups(this.groups).setActiveEvents(R.ActiveEvents.NONE);
      const col = this.world.createCollider(desc, this.bodies[i]);
      this.hooks.parts.set(col.handle, ref);
      return { col, m };
    };
    mk(PEL, B.pelvis.c);
    mk(CHE, B.chest.c);
    mk(HEAD, B.head.c);
    mk(UAL, B.upperarm.c);
    mk(FAL, B.forearm.c);
    mk(UAR, B.upperarm.c, true);
    mk(FAR, B.forearm.c, true);
    mk(THL, B.thigh.c);
    mk(SHL, B.shin.c);
    mk(THR, B.thigh.c, true);
    mk(SHR, B.shin.c, true);
    this.cols = [];
    const ref = (part: number, extra: Partial<PartRef> = {}): PartRef => ({ fighter: this, part, ...extra });
    this.cols[PEL] = add(PEL, capX(B.pelvis.cap[0], B.pelvis.cap[1]), ref(PEL)).col;
    this.cols[CHE] = add(CHE, R.ColliderDesc.ball(B.chest.ball), ref(CHE)).col;
    this.cols[HEAD] = add(HEAD, R.ColliderDesc.ball(B.head.ball), ref(HEAD)).col;
    for (const [u, f, s] of [[UAL, FAL, 1], [UAR, FAR, -1]] as const) {
      this.cols[u] = add(u, R.ColliderDesc.capsule(B.upperarm.cap[0], B.upperarm.cap[1]), ref(u)).col;
      this.cols[f] = add(f, R.ColliderDesc.capsule(B.forearm.cap[0], B.forearm.cap[1]), ref(f)).col;
      const hand = add(f, R.ColliderDesc.ball(B.hand.r).setTranslation(B.hand.off[0], B.hand.off[1], B.hand.off[2]), ref(f, { hand: s > 0 ? 0 : 1 }), 1.2).col;
      this.hands[s > 0 ? 0 : 1] = { part: f, col: hand, joint: null, held: null, heldFighter: null, punch: 0, punchDir: new THREE.Vector3(), hitSet: new Set(), cd: 0, side: s };
    }
    for (const [t, sh, s] of [[THL, SHL, 0], [THR, SHR, 1]] as const) {
      this.cols[t] = add(t, R.ColliderDesc.capsule(B.thigh.cap[0], B.thigh.cap[1]), ref(t)).col;
      this.cols[sh] = add(sh, R.ColliderDesc.capsule(B.shin.cap[0], B.shin.cap[1]), ref(sh)).col;
      this.feet[s] = add(sh, R.ColliderDesc.cuboid(B.foot.half[0], B.foot.half[1], B.foot.half[2]).setTranslation(B.foot.off[0], B.foot.off[1], B.foot.off[2]), ref(sh, { foot: s }), 0.35).col;
    }
    // masses: set each body's total mass (all colliders of a body share it by volume)
    for (let i = 0; i < NPART; i++) {
      const b = this.bodies[i];
      const cs: RAPIER.Collider[] = [];
      for (let k = 0; k < b.numColliders(); k++) cs.push(b.collider(k));
      const vol = cs.reduce((s, c) => s + c.volume(), 0);
      for (const c of cs) c.setDensity(MASS[i] / vol);
      b.recomputeMassPropertiesFromColliders();
    }
    this.mass = MASS.reduce((a, b) => a + b, 0);
    for (let i = 0; i < NPART; i++) {
      const pi = this.bodies[i].principalInertia();
      this.inert[i] = (pi.x + pi.y + pi.z) / 3;
    }
    // joints
    this.joints = [];
    const J = B.joints;
    const joint = (p: number, c: number, anchor: number[], kp: number, kd: number, mirror = false) => {
      const wp = place(mirror ? [-anchor[0], anchor[1], anchor[2]] : anchor).clone();
      const bp = this.bodies[p], bc = this.bodies[c];
      const a1 = this.toLocal(bp, wp, _b), a2 = this.toLocal(bc, wp, _c);
      W.createImpulseJoint(R.JointData.spherical(rv(a1), rv(a2)), bp, bc, true);
      const ired = (this.inert[p] * this.inert[c]) / (this.inert[p] + this.inert[c]);
      this.joints.push({ p, c, kp, kd, t: new THREE.Quaternion(), ired });
    };
    joint(PEL, CHE, J.spine, 520, 42);
    joint(CHE, HEAD, J.neck, 420, 32);
    joint(CHE, UAL, J.shoulder, 160, 14);
    joint(UAL, FAL, J.elbow, 160, 12);
    joint(CHE, UAR, J.shoulder, 160, 14, true);
    joint(UAR, FAR, J.elbow, 160, 12, true);
    joint(PEL, THL, J.hip, 650, 46);
    joint(THL, SHL, J.knee, 650, 46);
    joint(PEL, THR, J.hip, 650, 46, true);
    joint(THR, SHR, J.knee, 650, 46, true);

    this.alive = true;
    this.out = false;
    this.yaw = yaw;
    this.daze = 0;
    this.ko = 0;
    this.stagger = 0;
    this.getup = 0;
    this.fallenT = 0;
    this.sinceHit = 99;
    this.grabbedBy.clear();
    this.lastHitBy = null;
    this.struggle = 0;
    this.noHover = 0;
    this.read();
    for (let i = 0; i < NPART; i++) this.prevV[i].copy(this.vel[i]);
  }

  despawn() {
    if (!this.bodies.length) return;
    this.releaseAll();
    for (const f of [...this.grabbedBy]) f.releaseFighter(this);
    for (const c of this.cols) if (c) this.hooks.parts.delete(c.handle);
    for (const h of this.hands) this.hooks.parts.delete(h.col.handle);
    for (const c of this.feet) this.hooks.parts.delete(c.handle);
    for (const b of this.bodies) this.world.removeRigidBody(b);
    this.bodies = [];
    this.hands = [];
    this.feet = [];
    this.alive = false;
  }

  private toLocal(b: RAPIER.RigidBody, wp: THREE.Vector3, out: THREE.Vector3) {
    const t = b.translation(), r = b.rotation();
    return out.copy(wp).sub(_d.set(t.x, t.y, t.z)).applyQuaternion(_q2.set(r.x, r.y, r.z, r.w).invert());
  }

  // ---------------------------------------------------------------- state

  isKO() {
    return this.ko > 0;
  }
  standing() {
    return this.alive && !this.out && this.ko <= 0;
  }
  holding() {
    return this.hands.some((h) => h.heldFighter);
  }
  hanging() {
    return !this.grounded && this.hands.some((h) => h.joint && !h.heldFighter && h.held && h.held.isFixed());
  }
  center(out = new THREE.Vector3()) {
    return out.copy(this.pos[CHE]);
  }
  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  handPos(h: number, out = new THREE.Vector3()) {
    const t = this.hands[h].col.translation();
    return out.set(t.x, t.y, t.z);
  }
  footPos(s: number, out = new THREE.Vector3()) {
    const t = this.feet[s].translation();
    return out.set(t.x, t.y, t.z);
  }

  /** latch this frame's button presses so the first physics step sees them */
  feed(i: Intent) {
    this.input = i;
    if (i.jump) this.pend.jump = true;
    if (i.punch) this.pend.punch = true;
    if (i.kick) this.pend.kick = true;
    if (i.mash) this.pend.mash++;
  }

  private read() {
    for (let i = 0; i < NPART; i++) {
      const b = this.bodies[i];
      vec(b.translation(), this.pos[i]);
      quat(b.rotation(), this.rot[i]);
      vec(b.linvel(), this.vel[i]);
      vec(b.angvel(), this.ang[i]);
    }
  }

  // ---------------------------------------------------------------- the step

  step(dt: number, time: number) {
    if (!this.alive) return;
    this.read();
    const inp = this.input;
    const ko = this.ko > 0;

    // timers
    this.sinceHit += dt;
    this.jumpCd -= dt;
    this.kickCd -= dt;
    this.noHover -= dt;
    this.stagger = Math.max(0, this.stagger - dt);
    if (this.sinceHit > 1.5) this.daze = Math.max(0, this.daze - 11 * dt);
    this.struggle = Math.max(0, this.struggle - 1.5 * dt);
    if (this.getup > 0) this.getup -= dt;
    this.liftedHold += dt;

    // knocked out: mash to wake sooner
    if (ko) {
      if (this.pend.mash) this.ko -= 0.12 * this.pend.mash;
      this.ko -= dt;
      if (this.ko <= 0) {
        this.ko = 0;
        this.daze = 35;
        this.getup = 1.1;
      }
    } else if (this.grabbedBy.size && this.pend.mash) {
      this.struggle += this.pend.mash;
      if (this.struggle > 7) {
        this.struggle = 0;
        for (const g of [...this.grabbedBy]) g.releaseFighter(this, true);
      }
    }
    this.pend.mash = 0;

    // impacts: a sudden change of speed in the head or chest (slammed into a wall, landed on your head)
    for (const i of [HEAD, CHE]) {
      const dv = _a.copy(this.vel[i]).sub(this.prevV[i]);
      dv.y += GRAVITY * dt;
      const m = dv.length();
      if (m > 8.5 && time > 0.5) this.takeDaze((m - 8.5) * 5, null, this.pos[i], i, 'slam');
    }

    const str = ko ? 0.03 : 1;
    const bal = ko ? 0 : Math.max(0.15, (1 - this.daze / 170) * (this.stagger > 0 ? 0.35 : 1));

    // facing
    const mv = Math.min(1, Math.hypot(inp.mx, inp.mz));
    if (!ko && mv > 0.2) this.yaw = Math.atan2(inp.mx, inp.mz);
    const fwd = this.forward(this._fwd);

    // fallen over (not knocked out): give it a moment, then the get-up boost
    const chestUp = _a.set(0, 1, 0).applyQuaternion(this.rot[CHE]).y;
    if (!ko && chestUp < 0.35) {
      this.fallenT += dt;
      if (this.fallenT > 0.5 && this.getup <= 0) this.getup = 0.9;
    } else this.fallenT = 0;

    // ---- ground
    this.probeGround();
    if (this.grounded) this.airT = 0;
    else this.airT += dt;

    // ---- pose
    const vRel = this._vrel.copy(this.vel[PEL]).sub(this.groundV);
    vRel.y = 0;
    this.speed = vRel.length();
    const stride = Math.min(1, this.speed / 3.2);
    this.gait += dt * (this.grounded ? Math.min(20, this.speed * 5.4) : 0);
    const amp = stride * 0.8;
    const ph = this.gait;
    const air = !this.grounded && this.airT > 0.12;
    for (const j of this.joints) j.t.identity();
    const J = this.joints;
    // legs: J[6..9] = hipL, kneeL, hipR, kneeR
    if (air) {
      J[6].t.copy(eq(-0.55, 0, 0));
      J[7].t.copy(eq(0.9, 0, 0));
      J[8].t.copy(eq(-0.35, 0, 0));
      J[9].t.copy(eq(0.7, 0, 0));
    } else {
      J[6].t.copy(eq(-Math.sin(ph) * amp, 0, 0));
      J[7].t.copy(eq(Math.max(0, Math.cos(ph)) * amp * 1.4, 0, 0));
      J[8].t.copy(eq(Math.sin(ph) * amp, 0, 0));
      J[9].t.copy(eq(Math.max(0, -Math.cos(ph)) * amp * 1.4, 0, 0));
    }
    // kick: one leg swings up hard
    if (this.kickT > 0) {
      this.kickT -= dt;
      const k = this.kickLeg;
      const swing = this.kickT > 0.12 ? -1.55 : -0.6;
      J[6 + k * 2].t.copy(eq(swing, 0, 0));
      J[7 + k * 2].t.copy(eq(0.05, 0, 0));
    }
    // arms hang and swing
    J[2].t.copy(eq(Math.sin(ph) * amp * 0.7, 0, 0.12));
    J[3].t.copy(eq(-0.35, 0, 0));
    J[4].t.copy(eq(-Math.sin(ph) * amp * 0.7, 0, -0.12));
    J[5].t.copy(eq(-0.35, 0, 0));
    // head looks a little down when dazed
    if (this.daze > 40 && !ko) J[1].t.copy(eq(Math.sin(time * 5) * 0.2, 0, Math.cos(time * 4) * 0.25));

    // ---- joint springs
    for (const j of this.joints) {
      let s = str;
      if (j.c === UAL || j.c === FAL || j.c === UAR || j.c === FAR) {
        const h = this.hands[j.c === UAL || j.c === FAL ? 0 : 1];
        if (this.handActive(h)) s *= 0.12;
      }
      this.jointTorque(j, s, dt);
    }

    // ---- balance: chest and pelvis upright, facing yaw; leaning into a run or a punch
    if (!ko) {
      const lean = (this.input.run ? 0.22 : 0.12) * stride + (this.hands.some((h) => h.punch > 0) ? 0.25 : 0);
      const want = _q.setFromAxisAngle(UP, this.yaw).multiply(_q2.setFromAxisAngle(_c.set(1, 0, 0), lean));
      const k = bal * (this.getup > 0 ? 1.6 : 1);
      this.uprightTorque(CHE, want, 2400 * k, 70, dt);
      this.uprightTorque(PEL, _q.setFromAxisAngle(UP, this.yaw), 2000 * k, 60, dt);
    }

    // ---- support + walking
    const M = this.mass;
    const pel = this.bodies[PEL];
    if (!ko && this.grounded && this.noHover <= 0) {
      const h = this.pos[PEL].y - this.groundY;
      const ramp = this.getup > 0 ? Math.min(1, (1.1 - this.getup) / 0.5 + 0.25) : 1;
      const comp = Math.min(0.35, STAND_H - h);
      const vy = this.vel[PEL].y - this.groundV.y;
      let fy = M * (GRAVITY * 0.92 + 200 * comp - 24 * vy) * ramp * Math.max(0.55, bal);
      fy = THREE.MathUtils.clamp(fy, 0, 3.6 * M * GRAVITY);
      pel.applyImpulse({ x: 0, y: fy * dt, z: 0 }, true);
      // the ground gets pushed back
      if (this.groundBody && this.groundBody.isDynamic()) this.groundBody.applyImpulseAtPoint({ x: 0, y: -fy * dt * 0.5, z: 0 }, rv(this.groundP), true);
      // slopes pull you downhill a little (a lot on slick stuff)
      const slip = 0.12 + this.groundSlick * 0.9;
      const gx = this.groundN.x * GRAVITY * slip, gz = this.groundN.z * GRAVITY * slip;
      pel.applyImpulse({ x: M * gx * dt, y: 0, z: M * gz * dt }, true);
    }
    if (!ko) {
      const grip = this.grounded ? 1 - this.groundSlick * 0.85 : 0.22;
      let top = inp.run ? 5.6 : 3.4;
      if (this.holding()) top *= 0.65;
      top *= 1 - Math.min(0.5, this.daze / 200);
      if (this.getup > 0 || this.hanging()) top = 0;
      const wx = inp.mx * top, wz = inp.mz * top;
      let ax = (wx - vRel.x) * 9, az = (wz - vRel.z) * 9;
      const amax = 30 * grip;
      const al = Math.hypot(ax, az);
      if (al > amax) { ax *= amax / al; az *= amax / al; }
      if (!this.grounded && mv < 0.1) { ax = 0; az = 0; }
      const fx = M * ax * dt, fz = M * az * dt;
      pel.applyImpulse({ x: fx * 0.55, y: 0, z: fz * 0.55 }, true);
      this.bodies[CHE].applyImpulse({ x: fx * 0.45, y: 0, z: fz * 0.45 }, true);
    }

    // ---- jump / climb
    if (this.pend.jump) {
      this.pend.jump = false;
      if (!ko && this.jumpCd <= 0 && this.getup <= 0) {
        const hang = this.hanging();
        if (this.grounded || hang) {
          const up = hang ? 6.6 : 5.4, fw = hang ? 2.4 : mv * 1.6;
          for (let i = 0; i < NPART; i++) {
            const b = this.bodies[i], m = b.mass();
            b.applyImpulse({ x: (fwd.x * fw) * m, y: up * m, z: (fwd.z * fw) * m }, true);
          }
          if (hang) for (const h of this.hands) this.release(h);
          this.jumpCd = 0.4;
          this.noHover = 0.22;
          this.hooks.jump(this);
        }
      }
    }

    // ---- hands
    this.handsStep(dt, fwd, ko);

    // ---- kick
    if (this.pend.kick) {
      this.pend.kick = false;
      if (!ko && this.kickCd <= 0 && this.getup <= 0) {
        this.kickT = 0.3;
        this.kickCd = 0.6;
        this.kickLeg = 1 - this.kickLeg;
        this.kickHit.clear();
        // a hop into it
        this.bodies[PEL].applyImpulse(rv(_a.copy(fwd).multiplyScalar(M * 1.3)), true);
      }
    }
    if (this.kickT > 0.05) {
      const s = this.kickLeg;
      const sh = this.bodies[s ? SHR : SHL];
      // the foot is thrown forward and up
      const tgt = _a.copy(this.pos[PEL]).addScaledVector(fwd, 0.75).add(_b.set(0, -0.15, 0));
      const fp = this.footPos(s, _c);
      const f = _d.copy(tgt).sub(fp).multiplyScalar(900).clampLength(0, 1300).multiplyScalar(dt);
      sh.applyImpulseAtPoint(rv(f), rv(fp), true);
      this.bodies[PEL].applyImpulse(rv(f.multiplyScalar(-0.6)), true);
      this.strike(this.feet[s], fp, this.kickHit, fwd, 'kick');
    }
    this.pend.punch = false;

    for (let i = 0; i < NPART; i++) this.prevV[i].copy(this.vel[i]);
  }

  private _fwd = new THREE.Vector3();
  private _vrel = new THREE.Vector3();
  private _side = new THREE.Vector3();
  private _hp = new THREE.Vector3();
  private groundY = 0;
  private groundP = new THREE.Vector3();
  groundSlick = 0;

  private probeGround() {
    const p = this.pos[PEL];
    this.grounded = false;
    this.groundBody = null;
    this.groundV.set(0, 0, 0);
    this.groundSlick = 0;
    if (this.ko > 0) return;
    // five rays under the pelvis (the middle and a little to each side): the highest floor wins,
    // so you can stand on a beam or teeter on an edge
    let best: RAPIER.RayColliderIntersection | null = null, by = -1e9, bx = 0, bz = 0;
    const max = STAND_H + 0.42;
    for (let k = 0; k < 5; k++) {
      const ox = k === 1 ? 0.13 : k === 2 ? -0.13 : 0, oz = k === 3 ? 0.13 : k === 4 ? -0.13 : 0;
      const ray = new R.Ray({ x: p.x + ox, y: p.y, z: p.z + oz }, { x: 0, y: -1, z: 0 });
      const hit = this.world.castRayAndGetNormal(ray, max, true, undefined, this.queryGroups);
      if (!hit || hit.normal.y < 0.45) continue;
      const y = p.y - hit.timeOfImpact;
      if (y > by) {
        by = y;
        best = hit;
        bx = p.x + ox;
        bz = p.z + oz;
      }
    }
    if (!best) return;
    const col = best.collider;
    const body = col.parent();
    this.groundP.set(bx, by, bz);
    this.groundN.set(best.normal.x, best.normal.y, best.normal.z);
    this.grounded = true;
    this.groundY = by;
    this.groundBody = body;
    if (body && !body.isFixed()) vec(body.velocityAtPoint(rv(this.groundP)), this.groundV);
    const ref = this.hooks.parts.get(col.handle);
    if (ref?.belt) this.groundV.add(ref.belt(this.groundP, _b));
    if (ref?.slick) this.groundSlick = ref.slick;
    if (ref?.fighter) this.groundSlick = 0.6; // standing on someone is wobbly
  }

  private jointTorque(j: Joint, s: number, dt: number) {
    const qp = this.rot[j.p], qc = this.rot[j.c];
    // error: wanted child rotation (parent * target) relative to the current one, in world space
    _q.copy(qp).multiply(j.t).multiply(_q2.copy(qc).invert());
    const e = rotVec(_q, _a);
    const w = _b.copy(this.ang[j.c]).sub(this.ang[j.p]);
    const tau = e.multiplyScalar(j.kp).sub(w.multiplyScalar(j.kd)).multiplyScalar(j.ired * s * dt);
    this.bodies[j.c].applyTorqueImpulse(rv(tau), true);
    this.bodies[j.p].applyTorqueImpulse({ x: -tau.x, y: -tau.y, z: -tau.z }, true);
  }

  /** implicit spring-damper toward an orientation (stable at any gain): the body's own inertia, gains in 1/s^2 and 1/s */
  private uprightTorque(i: number, want: THREE.Quaternion, kp: number, kd: number, dt: number) {
    _q2.copy(want).multiply(_q3.copy(this.rot[i]).invert());
    const e = rotVec(_q2, _a);
    const w = this.ang[i];
    const den = 1 + dt * kd + dt * dt * kp;
    const I = this.inert[i];
    const k = (dt / den) * I;
    this.bodies[i].applyTorqueImpulse({ x: (kp * e.x - kd * w.x) * k, y: (kp * e.y - kd * w.y) * k, z: (kp * e.z - kd * w.z) * k }, true);
  }

  // ---------------------------------------------------------------- hands

  private handActive(h: Hand) {
    const i = this.input;
    return h.punch > -0.18 || (h.side > 0 ? i.grabL : i.grabR) || !!h.joint;
  }

  private handsStep(dt: number, fwd: THREE.Vector3, ko: boolean) {
    const inp = this.input;
    if (ko) {
      this.releaseAll();
      return;
    }
    // punch: alternate hands, prefer one that isn't holding anything
    if (this.pend.punch && this.getup <= 0) {
      let h = this.hands[this.nextHand];
      if (h.joint || h.cd > 0) h = this.hands[1 - this.nextHand];
      if (!h.joint && h.cd <= 0) {
        h.punch = 0.15;
        h.cd = 0.3;
        h.hitSet.clear();
        this.nextHand = 1 - this.hands.indexOf(h);
        // aim at the nearest head in front
        h.punchDir.copy(fwd).add(_a.set(0, 0.08, 0)).normalize();
        const tgt = this.aimTarget?.(this, fwd);
        if (tgt) {
          const sh = this.shoulder(h, _b);
          _c.copy(tgt).sub(sh);
          if (_c.lengthSq() > 0.01) h.punchDir.copy(_c.normalize());
        }
        this.bodies[CHE].applyImpulse(rv(_a.copy(fwd).multiplyScalar(this.mass * 0.6)), true);
      }
    }
    const lift = inp.lift;
    if (lift && this.holding()) this.liftT += dt;
    else this.liftT = 0;
    const chest = this.pos[CHE];
    const side = this._side.set(fwd.z, 0, -fwd.x); // left
    for (const h of this.hands) {
      h.cd -= dt;
      h.punch -= dt;
      const want = h.side > 0 ? inp.grabL : inp.grabR;
      const hp = this.handPos(this.hands.indexOf(h), this._hp);
      let tgt: THREE.Vector3 | null = null;
      let kp = 260, fmax = 420;
      if (h.punch > 0) {
        const sh = this.shoulder(h, _b);
        tgt = _c.copy(sh).addScaledVector(h.punchDir, 0.95);
        kp = 1400;
        fmax = 1500;
      } else if (want) {
        tgt = _c.copy(chest).addScaledVector(fwd, 0.52).addScaledVector(side, h.side * 0.17);
        if (lift) {
          tgt.copy(chest).addScaledVector(fwd, 0.12).addScaledVector(side, h.side * 0.16);
          tgt.y += 0.95;
          fmax = 900;
          kp = 320;
        } else tgt.y += 0.1;
      }
      if (tgt) {
        const hb = this.bodies[h.part];
        const hv = vec(hb.velocityAtPoint(rv(hp)), _e);
        const f = _b.copy(tgt).sub(hp).multiplyScalar(kp).sub(hv.sub(this.vel[CHE]).multiplyScalar(h.punch > 0 ? 20 : 26));
        f.multiplyScalar(3.2).clampLength(0, fmax).multiplyScalar(dt);
        hb.applyImpulseAtPoint(rv(f), rv(hp), true);
        const sh = this.shoulder(h, _c);
        this.bodies[CHE].applyImpulseAtPoint({ x: -f.x, y: -f.y, z: -f.z }, rv(sh), true);
      }
      if (h.punch > 0) this.strike(h.col, hp, h.hitSet, h.punchDir, 'punch');
      // grabbing
      if (want && !h.joint && h.punch <= 0) this.tryGrab(h, hp);
      if (!want && h.joint) {
        const thrown = h.heldFighter && this.liftT > 0.25;
        const victim = h.heldFighter;
        this.release(h);
        if (thrown && victim && !this.holding()) this.throwFighter(victim, fwd);
      }
    }
    if (this.holding()) this.liftedHold = 0;
  }

  /** set by the game: where to aim a punch (nearest opponent's head in front) */
  aimTarget?: (f: Fighter, fwd: THREE.Vector3) => THREE.Vector3 | null;

  private shoulder(h: Hand, out: THREE.Vector3) {
    const J = BODY.joints.shoulder;
    return out.set(J[0] * h.side, J[1] - BODY.chest.c[1], J[2]).applyQuaternion(this.rot[CHE]).add(this.pos[CHE]);
  }

  private tryGrab(h: Hand, hp: THREE.Vector3) {
    let found: RAPIER.Collider | null = null;
    this.world.intersectionsWithShape(rv(hp), { x: 0, y: 0, z: 0, w: 1 }, new R.Ball(BODY.hand.r + 0.07), (c) => {
      if (c.isSensor()) return true;
      const ref = this.hooks.parts.get(c.handle);
      if (ref?.fighter === this) return true;
      found = c;
      return false;
    }, undefined, this.queryGroups);
    if (!found) return;
    const col = found as RAPIER.Collider;
    const other = col.parent();
    if (!other) return;
    const hb = this.bodies[h.part];
    const a1 = BODY.hand.off;
    const a2 = this.toLocal(other, hp, _b);
    h.joint = this.world.createImpulseJoint(R.JointData.spherical({ x: a1[0], y: a1[1], z: a1[2] }, rv(a2)), hb, other, true);
    h.held = other;
    const ref = this.hooks.parts.get(col.handle);
    h.heldFighter = ref?.fighter ?? null;
    if (h.heldFighter) h.heldFighter.grabbedBy.add(this);
    this.hooks.grab(this, h.heldFighter);
  }

  release(h: Hand) {
    if (h.joint) {
      if (this.world.getImpulseJoint(h.joint.handle)) this.world.removeImpulseJoint(h.joint, true);
    }
    const f = h.heldFighter;
    h.joint = null;
    h.held = null;
    h.heldFighter = null;
    if (f && !this.hands.some((o) => o.heldFighter === f)) f.grabbedBy.delete(this);
  }

  releaseAll() {
    for (const h of this.hands) this.release(h);
  }

  /** let go of one fighter (they wriggled free: the hands get knocked back) */
  releaseFighter(f: Fighter, shaken = false) {
    for (const h of this.hands) {
      if (h.heldFighter !== f) continue;
      this.release(h);
      if (shaken) {
        h.cd = 0.6;
        this.stagger = 0.4;
      }
    }
    f.grabbedBy.delete(this);
  }

  private throwFighter(v: Fighter, fwd: THREE.Vector3) {
    if (!v.alive) return;
    for (let i = 0; i < NPART; i++) {
      const b = v.bodies[i], m = b.mass();
      b.applyImpulse({ x: fwd.x * 7.5 * m, y: 4.2 * m, z: fwd.z * 7.5 * m }, true);
    }
    v.noHover = 0.6;
    v.stagger = 0.8;
    v.lastHitBy = this;
    v.lastHitT = 0;
    this.hooks.thrown(this, v);
  }

  /** a punching hand or kicking foot sweeps through whatever it touches (bodies are only touched
   *  after the query: Rapier can't be changed from inside its own callback) */
  private strike(col: RAPIER.Collider, at: THREE.Vector3, seen: Set<Fighter | RAPIER.RigidBody>, dir: THREE.Vector3, kind: 'punch' | 'kick') {
    const body = col.parent()!;
    const pv = vec(body.velocityAtPoint(rv(at)), new THREE.Vector3());
    const found: RAPIER.Collider[] = [];
    this.world.intersectionsWithShape(rv(at), { x: 0, y: 0, z: 0, w: 1 }, new R.Ball(kind === 'punch' ? 0.17 : 0.18), (c) => {
      found.push(c);
      return true;
    }, undefined, this.queryGroups);
    for (const c of found) {
      const ref = this.hooks.parts.get(c.handle);
      const ob = c.parent();
      if (!ob || ref?.fighter === this) continue;
      if (ref?.fighter) {
        const f = ref.fighter;
        if (seen.has(f) || !f.alive) continue;
        const rel = _c.copy(pv).sub(vec(ob.linvel(), _d)).dot(dir);
        if (rel < 1.5) continue;
        seen.add(f);
        const part = ref.part ?? CHE;
        const mult = part === HEAD ? 1.55 : part === CHE || part === PEL ? 1 : 0.6;
        const dmg = THREE.MathUtils.clamp((rel - 1) * (kind === 'kick' ? 2.2 : 1.6), 4, 26) * mult;
        const push = Math.min(9, 2.6 + rel * 0.35) * (kind === 'kick' ? 1.35 : 1);
        ob.applyImpulse(rv(_d.copy(dir).multiplyScalar(push * ob.mass() * 1.2)), true);
        f.bodies[CHE].applyImpulse(rv(_d.copy(dir).multiplyScalar(push * 6)), true);
        f.takeDaze(dmg, this, at, part, kind);
      } else if (ob.isDynamic() && !seen.has(ob)) {
        seen.add(ob);
        const rel = _c.copy(pv).sub(vec(ob.linvel(), _d)).length();
        ob.applyImpulseAtPoint(rv(_d.copy(dir).multiplyScalar(Math.min(ob.mass(), 30) * (2 + rel * 0.4))), rv(at), true);
        this.hooks.prop(this, ob, at, rel);
      }
    }
  }

  takeDaze(dmg: number, by: Fighter | null, at: THREE.Vector3, part: number, kind: 'punch' | 'kick' | 'slam') {
    if (!this.alive || this.out) return;
    if (by) {
      this.lastHitBy = by;
      this.lastHitT = 0;
    }
    this.sinceHit = 0;
    this.stagger = Math.max(this.stagger, Math.min(0.45, dmg / 40));
    this.hooks.hit(by, this, dmg, at, part, kind);
    if (this.ko > 0) {
      this.ko = Math.min(KO_TIME + 1.5, this.ko + dmg * 0.02);
      return;
    }
    this.daze += dmg;
    if (this.daze >= 100) {
      this.ko = KO_TIME;
      this.daze = 100;
      this.koCount++;
      this.releaseAll();
      this.hooks.ko(this);
    }
  }

  /** everything at once (respawns, tests): move the whole body, keep its pose */
  teleport(dx: number, dy: number, dz: number) {
    for (const b of this.bodies) {
      const t = b.translation();
      b.setTranslation({ x: t.x + dx, y: t.y + dy, z: t.z + dz }, true);
    }
  }
}
