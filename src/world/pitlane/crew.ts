import * as THREE from 'three';
import { TEAMS, type Team } from '../../race/Teams.ts';
import { Frame, TrackSpace, rng } from './geo.ts';
import { GARAGE_W, L, type PitPlan } from './layout.ts';
import { Person, peopleKit, printTexture, rigid, type Look, type PeopleKit, type BodyAsset } from '../../people/Humans.ts';
import { createWheelProp, type WheelProp, type Compound } from '../../car/CarModel.ts';
import { WHEELBASE, TRACK_F, TRACK_R, WHEEL_R } from '../../car/carLayout.ts';
import { STOP, newStopPose, stopPose, type StopPose } from '../../race/Pit.ts';
import type { BoxState } from '../PitComplex.ts';

/**
 * Pit crews on the real human models (people/Humans.ts): eighteen per team in
 * fireproof overalls and helmets — four wheel guns, four tyre-off and four
 * tyre-on men, the front and rear jacks, two stabilisers, the release man and
 * the front-wing man. A stop is choreographed from the stop's own clock
 * (race/Pit.ts STOP): the crew jogs out as their car comes down the lane, the
 * jacks lift the car, the guns go on, the old wheels come off and are carried
 * away (the car's own wheel meshes, in the old compound), the new set goes on,
 * the gunners' hands go up, the car drops and is released, and the crew walks
 * back into the garage with the old tyres.
 *
 * Cost: every person is a skinned mesh + a helmet (2 draws), so only what
 * matters is drawn — a team's full crew while its stop is near the camera,
 * otherwise four people waiting at the front of each garage close to the camera
 * (frustum-culled, shadows only up close); nobody far away. People are built a
 * few per frame in the background (and on demand for an incoming car), then
 * reused for the whole session.
 */

// ------------------------------------------------------------------------------------ the stop, as the crew sees it

export interface CrewStop {
  /** 'in': the car is coming down the lane (dist = metres to the box); 'stop': stationary; 'out': leaving */
  phase: 'in' | 'stop' | 'out';
  dist: number;
  /** seconds stationary and the planned stop time */
  t: number;
  T: number;
  slow: number;
  held: boolean;
  green: boolean;
  /** compounds coming off and going on */
  old: Compound;
  fresh: Compound;
}

type Role = 'gun' | 'off' | 'on' | 'jackF' | 'jackR' | 'stab' | 'lolli' | 'wing';
const ROLES: Role[] = ['gun', 'gun', 'gun', 'gun', 'off', 'off', 'off', 'off', 'on', 'on', 'on', 'on', 'jackF', 'jackR', 'stab', 'stab', 'lolli', 'wing'];
/** who waits at the front of the garage when no car is due */
const IDLE_SET = [12, 16, 1, 6];
/** car in the box frame (x forward along the lane, z toward the garage) */
const NOSE = 3.05;
const TAIL = -2.45;
const AX = WHEELBASE / 2;
/** jack lift (m) at full stroke — CarView lifts the car the same */
const LIFT_H = 0.09;
/** metres a wheel slides out along the axle before it is off the hub (CarModel.setWheelOff) */
const WHEEL_SLIDE = 0.42;

// distances (m) from the camera
const FULL_DIST = 190;
const IDLE_DIST = 80;
const SHADOW_DIST = 42;

const sm = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** what one crew member is doing: where (box frame), facing what, which clip, what the arms do */
interface Act {
  x: number;
  z: number;
  /** a point to face (box frame) */
  fx: number;
  fz: number;
  clip: string;
  arms: 'none' | 'gun' | 'gunUp' | 'grab' | 'carry' | 'push' | 'jack' | 'stab' | 'raise' | 'point';
  /** jog/walk speed to get there */
  speed: number;
}
const act: Act = { x: 0, z: 0, fx: 0, fz: 0, clip: 'Idle_Loop', arms: 'none', speed: 3 };
function A(x: number, z: number, fx: number, fz: number, clip: string, arms: Act['arms'] = 'none', speed = 3.6): Act {
  act.x = x;
  act.z = z;
  act.fx = fx;
  act.fz = fz;
  act.clip = clip;
  act.arms = arms;
  act.speed = speed;
  return act;
}

interface Member {
  i: number;
  role: Role;
  wheel: number;
  look: Look;
  p: Person | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  clip: string;
  /** home in the garage (garage frame: x along the lane from the garage centre, z into the garage) */
  hx: number;
  hz: number;
  shown: boolean;
  /** 0 fps skip accumulator for far people */
  acc: number;
  shadow: boolean;
}

interface Crew {
  k: number;
  team: Team;
  box: Frame;
  gar: Frame;
  center: THREE.Vector3;
  members: Member[];
  /** stop state from the race (null: no car due) */
  stop: CrewStop | null;
  /** the crew is out in the lane (or walking back) */
  out: boolean;
  /** seconds since the car left */
  gone: number;
  /** last stationary time seen (for the stop pose after the car left) */
  lastT: number;
  lastTT: number;
  lastSlow: number;
  pose: StopPose;
  props: Props | null;
  helmetMat: THREE.MeshStandardMaterial;
  logo: THREE.Texture | null;
  /** 0 off, 1 red, 2 green */
  light: number;
  lightT: number;
  compound: Compound;
  old: Compound;
  /** distance from the camera (m) */
  dist: number;
  vis: boolean;
}

interface Props {
  group: THREE.Group;
  oldW: WheelProp[];
  newW: WheelProp[];
  guns: THREE.Mesh[];
  jackF: JackProp;
  jackR: JackProp;
}

interface JackProp {
  root: THREE.Group;
  handle: THREE.Mesh;
  head: THREE.Mesh;
}

// ------------------------------------------------------------------------------------ shared props

let gunGeo: THREE.BufferGeometry | null = null;
let gunMat: THREE.MeshStandardMaterial | null = null;
function gunMesh(): THREE.Mesh {
  if (!gunGeo) {
    // a wheel gun: body along +z (barrel forward), a pistol grip, the hose stub; team paint on the body
    const parts: THREE.BufferGeometry[] = [];
    const body = new THREE.CylinderGeometry(0.052, 0.058, 0.26, 12);
    body.rotateX(Math.PI / 2);
    body.translate(0, 0, 0.08);
    parts.push(body);
    const nose = new THREE.CylinderGeometry(0.034, 0.034, 0.1, 10);
    nose.rotateX(Math.PI / 2);
    nose.translate(0, 0, 0.26);
    parts.push(nose);
    const grip = new THREE.BoxGeometry(0.045, 0.13, 0.05);
    grip.rotateX(0.25);
    grip.translate(0, -0.08, -0.01);
    parts.push(grip);
    const hose = new THREE.CylinderGeometry(0.016, 0.016, 0.5, 6);
    hose.rotateX(1.2);
    hose.translate(0, -0.12, -0.26);
    parts.push(hose);
    const cols: number[] = [];
    const pos: number[] = [];
    const nor: number[] = [];
    const tint = [[0.62, 0.63, 0.66], [0.2, 0.2, 0.22], [0.05, 0.05, 0.05], [0.03, 0.03, 0.03]];
    parts.forEach((g, gi) => {
      const ng = g.index ? g.toNonIndexed() : g;
      ng.computeVertexNormals();
      const pa = ng.getAttribute('position'), na = ng.getAttribute('normal');
      for (let v = 0; v < pa.count; v++) {
        pos.push(pa.getX(v), pa.getY(v), pa.getZ(v));
        nor.push(na.getX(v), na.getY(v), na.getZ(v));
        cols.push(...tint[gi]);
      }
    });
    gunGeo = new THREE.BufferGeometry();
    gunGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gunGeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    gunGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    gunMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7, name: 'pit-gun' });
  }
  const m = new THREE.Mesh(gunGeo, gunMat!);
  m.castShadow = true;
  m.name = 'wheel-gun';
  return m;
}

const jackMats = new Map<number, THREE.MeshStandardMaterial>();
function jackProp(color: THREE.ColorRepresentation, front: boolean): JackProp {
  const c = new THREE.Color(color);
  const key = c.getHex();
  let mat = jackMats.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.4, name: 'pit-jack' });
    jackMats.set(key, mat);
  }
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.6, metalness: 0.5 });
  const root = new THREE.Group();
  root.name = front ? 'front-jack' : 'rear-jack';
  // the trolley: a low frame on four small wheels, local +x toward the car
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.07, front ? 0.46 : 0.34), mat);
  base.position.set(-0.15, 0.09, 0);
  root.add(base);
  for (const [x, z] of [[-0.4, 0.17], [-0.4, -0.17], [0.1, 0.17], [0.1, -0.17]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), dark);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, 0.05, z * (front ? 1 : 0.75));
    root.add(w);
  }
  // the lifting head under the nose / crash structure (moves with the lift)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, front ? 0.42 : 0.24), dark);
  head.position.set(0.22, 0.2, 0);
  root.add(head);
  // the handle: a unit cylinder along +y, stretched between the pivot and the hands every frame
  const hg = new THREE.CylinderGeometry(0.022, 0.022, 1, 8);
  hg.translate(0, 0.5, 0);
  const handle = new THREE.Mesh(hg, mat);
  root.add(handle);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return { root, handle, head };
}

/** helmet in bind space (skull landmarks): shell + dark visor as vertex colours, one draw */
const helmetGeos = new WeakMap<BodyAsset, THREE.BufferGeometry>();
function helmetGeometry(asset: BodyAsset): THREE.BufferGeometry {
  const hit = helmetGeos.get(asset);
  if (hit) return hit;
  const lm = asset.lm;
  const c = lm.skull, r = lm.skullR;
  // a full-face helmet a couple of centimetres off the head: crown (headTop) to below the chin
  const top = lm.headTop + 0.02, bottom = lm.neckY - 0.035;
  const cy = (top + bottom) / 2, hy = (top - bottom) / 2;
  const hx = r.x + 0.028, hz = r.z + 0.028;
  const g = new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.9);
  // the chin bar and the neck opening: narrower at the bottom than an egg
  {
    const pa = g.getAttribute('position');
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      if (y < 0) {
        const k = 1 + y * 0.18;
        pa.setX(i, pa.getX(i) * k);
        pa.setZ(i, pa.getZ(i) * (1 + y * 0.08));
      }
    }
  }
  g.scale(hx, hy, hz);
  g.translate(c.x, cy, c.z + 0.012);
  const pa = g.getAttribute('position');
  const col = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    const y = (pa.getY(i) - cy) / hy, z = (pa.getZ(i) - c.z) / hz, x = (pa.getX(i) - c.x) / hx;
    // the visor: a dark band across the face
    const visor = z > 0.45 && y > -0.12 && y < 0.36 && Math.abs(x) < 0.82 ? 1 : 0;
    const v = visor ? 0.04 : 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const out = rigid(g, lm.joint.Head);
  helmetGeos.set(asset, out);
  return out;
}

// ------------------------------------------------------------------------------------ the system

export interface Seat {
  team: number;
  pos: THREE.Vector3;
  heading: number;
}

export class CrewSystem {
  readonly group = new THREE.Group();
  private readonly crews: Crew[] = [];
  private readonly ts: TrackSpace;
  private readonly side: number;
  private readonly cam = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
  private time = 0;
  private kit: PeopleKit | null = null;
  private culled: THREE.Object3D[] = [];
  /** people drawn last frame */
  drawn = 0;
  /** a sight line kept free of people (the garage camera → the car): segment a→b in xz, radius r */
  clear: { ax: number; az: number; bx: number; bz: number; r: number } | null = null;
  /** a team whose crew is not drawn (the menu garage has its own people) */
  hideTeam = -1;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly gv = new THREE.Vector3();
  private readonly q1 = new THREE.Quaternion();
  private readonly m1 = new THREE.Matrix4();

  constructor(plan: PitPlan, ts: TrackSpace, seats: Seat[]) {
    this.ts = ts;
    this.side = plan.side;
    void seats;
    this.group.name = 'pit_crews';
    TEAMS.forEach((team, k) => {
      const box = new Frame().at(ts, plan.boxS(k), L.box, 0);
      const g0 = plan.teamS0 + k * GARAGE_W;
      const gar = new Frame().at(ts, g0 + GARAGE_W / 2, L.front, 0.06);
      const r = rng(900 + k * 31);
      const prim = new THREE.Color(team.primary), sec = new THREE.Color(team.secondary);
      const dark = prim.r + prim.g + prim.b < 0.12;
      const helmetCol = prim.r + prim.g + prim.b > 0.35 ? prim.clone() : new THREE.Color(0xe8e9ea);
      const members: Member[] = ROLES.map((role, i) => {
        const female = r() < 0.14;
        const look: Look = {
          female,
          tone: Math.pow(r(), 1.3),
          hair: 'none',
          hairColor: 0x2b1d14,
          top: 'suit',
          topColor: dark ? prim.clone().lerp(sec, 0.12).multiplyScalar(1.5) : team.primary,
          top2: team.secondary,
          accent: team.accent,
          bottom: 'suit',
          bottomColor: dark ? prim.clone().lerp(sec, 0.12).multiplyScalar(1.5) : team.primary,
          shoeColor: 0x141416,
          gloves: 0x18191c,
          cap: null,
          height: female ? 0.95 + r() * 0.05 : 0.97 + r() * 0.06,
          build: 1.0 + r() * 0.08,
        };
        // homes: a loose group at the front of the garage (idle set nearest the door)
        const idleSlot = IDLE_SET.indexOf(i);
        const hx = idleSlot >= 0 ? [-5.8, -2.4, 2.2, 5.9][idleSlot] + (r() - 0.5) * 0.4 : (r() - 0.5) * 11;
        const hz = idleSlot >= 0 ? [1.6, 1.3, 1.5, 1.9][idleSlot] : 4.5 + r() * 3.5;
        return { i, role, wheel: role === 'gun' || role === 'off' || role === 'on' ? i % 4 : -1, look, p: null, x: 0, y: 0, z: 0, yaw: 0, clip: '', hx, hz, shown: false, acc: 0, shadow: true };
      });
      const center = box.o.clone();
      this.crews.push({
        k, team, box, gar, center, members, stop: null, out: false, gone: 99, lastT: 0, lastTT: 2.4, lastSlow: -1, pose: newStopPose(), props: null,
        helmetMat: new THREE.MeshStandardMaterial({ color: helmetCol, vertexColors: true, roughness: 0.22, metalness: 0.15, name: 'crew-helmet' }),
        logo: null, light: 0, lightT: 0, compound: 'medium', old: 'medium', dist: 1e9, vis: false,
      });
      for (const m of members) this.home(this.crews[k], m);
    });
  }

  // ---------------------------------------------------------------- public API (PitComplex)

  /** legacy dev hook: a box state + progress through the stop */
  setBox(team: number, state: BoxState, progress: number) {
    const C = this.crews[team];
    if (!C) return;
    if (state === 'idle') C.stop = null;
    else if (state === 'ready') C.stop = { phase: 'in', dist: 40, t: 0, T: 2.4, slow: -1, held: false, green: false, old: C.old, fresh: C.compound };
    else if (state === 'service') C.stop = { phase: 'stop', dist: 0, t: progress * 2.4, T: 2.4, slow: -1, held: false, green: progress > 0.95, old: C.old, fresh: C.compound };
    else C.stop = { phase: 'out', dist: 0, t: 2.4, T: 2.4, slow: -1, held: false, green: true, old: C.old, fresh: C.compound };
  }

  setStop(team: number, st: CrewStop | null) {
    const C = this.crews[team];
    if (!C) return;
    if (st) {
      C.compound = st.fresh;
      C.old = st.old;
    }
    C.stop = st;
  }

  setCompound(team: number, compound: string) {
    const C = this.crews[team];
    if (C) C.compound = compound as Compound;
  }

  /** release light for the team's box: 0 off, 1 red, 2 green */
  signal(team: number): number {
    return this.crews[team]?.light ?? 0;
  }

  /**
   * Build every crew member and prop now (while loading): nothing is constructed mid-race.
   * Without the people kit yet, they are built on demand instead.
   */
  prebuild(): boolean {
    if (!this.kit) this.kit = peopleKit();
    if (!this.kit) return false;
    for (const C of this.crews) {
      for (const m of C.members) if (!m.p) this.build(C, m);
      this.props(C);
    }
    return true;
  }

  /** show every person and prop (at home) for a shader / upload warm-up render (true), then back to normal (false) */
  warm(on: boolean) {
    // drawn once whatever the camera sees, so every buffer and bone texture is uploaded too
    if (on) {
      this.culled.length = 0;
      this.group.traverse((o) => {
        if (o.frustumCulled) {
          o.frustumCulled = false;
          this.culled.push(o);
        }
      });
    } else {
      for (const o of this.culled) o.frustumCulled = true;
      this.culled.length = 0;
    }
    for (const C of this.crews) {
      for (const m of C.members) {
        const p = m.p;
        if (!p) continue;
        p.root.visible = on;
        m.shown = on;
        if (on) {
          p.root.position.set(m.x, m.y, m.z);
          p.root.rotation.set(0, m.yaw, 0);
          p.play('Idle_Loop', { fade: 0 });
          m.clip = 'Idle_Loop';
          p.update(0);
        }
      }
      const pr = C.props;
      if (!pr) continue;
      pr.group.visible = on;
      pr.group.traverse((o) => {
        if (o !== pr.group && o.parent === pr.group) o.visible = on;
      });
      if (on) {
        // somewhere near home, just so they're drawn once
        const w = C.gar.p(0, 0, 2, this.v1);
        pr.group.children.forEach((o, i) => o.position.set(w.x + (i % 4) * 0.8, w.y + 0.4, w.z + Math.floor(i / 4) * 0.8));
      }
    }
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number, camera: THREE.Camera) {
    this.time += dt;
    if (!this.kit) this.kit = peopleKit();
    camera.getWorldPosition(this.cam);
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    this.drawn = 0;
    let built = 0;
    // most important first: crews with a car due, then the nearest
    const order = this.crews.slice().sort((a, b) => (a.stop ? 0 : 1) - (b.stop ? 0 : 1) || a.center.distanceToSquared(this.cam) - b.center.distanceToSquared(this.cam));
    for (const C of order) {
      C.dist = C.center.distanceTo(this.cam);
      this.stepCrew(C, dt);
      const hidden = C.k === this.hideTeam;
      const full = C.out && C.dist < FULL_DIST;
      const idle = !C.out && C.dist < IDLE_DIST;
      C.vis = !hidden && (full || idle);
      // build people: on demand for a crew in view, a couple per frame at most
      if (this.kit && built < (C.stop ? 3 : 2)) {
        for (const m of C.members) {
          if (m.p || !(C.out || C.stop || IDLE_SET.includes(m.i) || built === 0)) continue;
          if (!C.vis && !C.stop && built > 0) break;
          this.build(C, m);
          built++;
          if (built >= (C.stop ? 3 : 2)) break;
        }
      }
      this.drawCrew(C, dt, full, idle && !hidden, hidden);
    }
    this.lights(dt);
  }

  // ---------------------------------------------------------------- crew state

  private stepCrew(C: Crew, dt: number) {
    const st = C.stop;
    if (st) {
      const due = st.phase !== 'in' || st.dist < 330;
      if (due && !C.out) {
        C.out = true;
        C.gone = -1;
      }
      if (st.phase === 'stop') {
        C.lastT = st.t;
        C.lastTT = st.T;
        C.lastSlow = st.slow;
        C.gone = -1;
      } else if (st.phase === 'out') C.gone = Math.max(0, C.gone) + dt;
      else C.gone = -1;
    } else if (C.out) {
      C.gone = Math.max(0, C.gone) + dt;
      // everyone home (or long enough): back to idle
      if (C.gone > 12 || C.members.every((m) => this.atHome(C, m))) {
        C.out = false;
        C.gone = 99;
      }
    }
    const t = st?.phase === 'stop' ? st.t : C.gone >= 0 ? C.lastTT + 0.5 : 0;
    stopPose(t, st?.phase === 'stop' ? st.T : C.lastTT, st?.phase === 'stop' ? st.slow : C.lastSlow, C.pose);
  }

  private atHome(C: Crew, m: Member): boolean {
    const w = C.gar.p(m.hx, 0, m.hz, this.v1);
    return Math.hypot(w.x - m.x, w.z - m.z) < 0.6;
  }

  private home(C: Crew, m: Member) {
    const w = C.gar.p(m.hx, 0, m.hz, this.v1);
    m.x = w.x;
    m.y = w.y;
    m.z = w.z;
    const d = C.gar.dir(-m.hx * 0.15, 0, -1, this.v2);
    m.yaw = Math.atan2(d.x, d.z);
  }

  /** the choreography: what member m does now (box frame), or null = go home */
  private plan(C: Crew, m: Member): Act | null {
    const st = C.stop;
    const P = C.pose;
    const side = this.side;
    const w = m.wheel;
    const front = w >= 0 ? w < 2 : true;
    const xw = w >= 0 ? (front ? AX : -AX) : 0;
    // car-left wheels (FL, RL) are on the frame's −side side
    const zw = w >= 0 ? -side * (w % 2 === 0 ? 1 : -1) * (front ? TRACK_F : TRACK_R) / 2 : 0;
    const o = Math.sign(zw) || 1;
    const f = front ? 1 : -1;
    const inStop = st?.phase === 'stop';
    const t = inStop ? st!.t : 99;
    const T = inStop ? Math.max(STOP.min, st!.T) : C.lastTT;
    const leaving = !inStop && C.gone >= 0;
    // after the car has gone: hold a moment (the next car may be behind), then home
    if (!st && C.out && C.gone > (m.role === 'off' ? 0.6 : 1.2)) return null;
    if (st?.phase === 'out' && C.gone > 1.6) return null;
    const off = w >= 0 ? P.wheel[w] : 0;
    switch (m.role) {
      case 'gun': {
        if (!inStop && !leaving) return A(xw - f * 0.12, zw + o * 1.25, xw, zw, 'Crouch_Idle_Loop', 'none');
        if (leaving) return A(xw - f * 0.2, zw + o * 1.9, xw, zw, 'Idle_Loop', 'none', 2);
        const done = P.tight[w] && t > STOP.tight;
        return A(xw - f * 0.12, zw + o * (0.98 + off * 0.1), xw, zw, 'Fixing_Kneeling', done ? 'gunUp' : 'gun');
      }
      case 'off': {
        if (!inStop && !leaving) return A(xw + f * 0.62, zw + o * 1.05, xw, zw, 'Crouch_Idle_Loop', 'none');
        const tOff = STOP.off[1] + [0, 0.05, 0.03, 0.07][w];
        if (inStop && t < tOff) {
          // hands on the tyre, pulling it out along the axle
          return A(xw + f * 0.5, zw + o * (0.98 + off * WHEEL_SLIDE), xw, zw + o * off * WHEEL_SLIDE, 'Crouch_Idle_Loop', 'grab', 1.5);
        }
        // away with the old wheel: behind the crew, out of the way
        // (frame −z is the fast-lane side: stay clear of the passing cars)
        const reach = o < 0 ? 1.9 : 2.7;
        return A(xw + f * 1.6, zw + o * reach, xw + f * 1.6, zw + o * (reach + 1), 'Idle_Loop', 'carry', 3.2);
      }
      case 'on': {
        const lag = [0, 0.05, 0.03, 0.07][w];
        if (!inStop && !leaving) return A(xw - f * 0.78, zw + o * 1.45, xw - f * 0.78, zw, 'Crouch_Idle_Loop', 'carry');
        if (inStop && t < STOP.on[0] + lag) {
          // step in behind the tyre-off man as the old wheel clears
          const k = sm(STOP.off[0] + lag, STOP.on[0] + lag, t);
          return A(xw - f * (0.78 - k * 0.66), zw + o * (1.45 - k * 0.1), xw, zw, 'Crouch_Idle_Loop', 'carry', 3);
        }
        if (inStop && t < STOP.on[1] + lag + 0.15) return A(xw - f * 0.12, zw + o * (1.02 + off * WHEEL_SLIDE), xw, zw, 'Crouch_Idle_Loop', 'push', 2);
        return A(xw - f * 0.9, zw + o * 1.75, xw, zw, 'Idle_Loop', 'none', 2);
      }
      case 'jackF': {
        // in front of the box, jack under the nose; out of the way to the garage side before the release
        const away = inStop ? sm(T + STOP.dropF[1] - 0.05, T - 0.05, t) : leaving ? 1 : 0;
        return A(NOSE + 1.45, away * 2.3, NOSE, away * 2.3, away > 0.5 ? 'Idle_Loop' : 'Push_Loop', 'jack', 4.5);
      }
      case 'jackR': {
        // waits beside the box until the car is past, then in behind it
        const behind = inStop || leaving || (st?.phase === 'in' && st.dist < 7);
        if (!behind) return A(TAIL - 1.1, 2.2, TAIL, 0, 'Idle_Loop', 'none');
        return A(TAIL - 1.35, 0, TAIL, 0, 'Push_Loop', 'jack', 5);
      }
      case 'stab': {
        const s = m.i === 14 ? -1 : 1;
        if (leaving) return A(0.35, s * 2.2, 0.3, 0, 'Idle_Loop', 'none', 2);
        return A(0.3, s * 1.32, 0.3, 0, 'Crouch_Idle_Loop', inStop ? 'stab' : 'none');
      }
      case 'lolli': {
        // at the front corner on the garage side: arm up while the car is serviced, points it out on the release
        const go = inStop && st!.green;
        return A(NOSE + 0.9, 1.75, 0, 0.2, 'Idle_Loop', go || leaving ? 'point' : inStop || st?.phase === 'in' ? 'raise' : 'none');
      }
      case 'wing':
      default: {
        // the front-wing man kneels at the nose on the lane side
        if (leaving) return A(NOSE - 0.2, -1.9, NOSE - 0.2, 0, 'Idle_Loop', 'none', 2);
        return A(NOSE - 0.35, -1.25, NOSE - 0.35, 0, inStop ? 'Fixing_Kneeling' : 'Crouch_Idle_Loop', 'none');
      }
    }
  }

  // ---------------------------------------------------------------- people

  private build(C: Crew, m: Member) {
    const kit = this.kit!;
    if (!C.logo) C.logo = printTexture({ text: C.team.sponsor, color: C.team.ink, sub: C.team.short }, { text: C.team.short.toUpperCase(), color: C.team.ink });
    m.look.logo = C.logo;
    const p = new Person(kit, m.look);
    p.lively = true;
    // helmet on: no eyes, brows or hair showing
    p.root.traverse((o) => {
      const s = o as THREE.SkinnedMesh;
      if (s.isSkinnedMesh && s !== p.body) s.visible = false;
    });
    const h = new THREE.SkinnedMesh(helmetGeometry(p.asset), C.helmetMat);
    h.bind(p.skeleton, p.body.bindMatrix);
    h.castShadow = true;
    h.receiveShadow = true;
    h.frustumCulled = false;
    h.name = 'crew-helmet';
    p.body.parent!.add(h);
    p.root.visible = false;
    p.root.matrixAutoUpdate = true;
    this.group.add(p.root);
    m.p = p;
    m.clip = '';
    m.acc = Math.random();
  }

  private props(C: Crew): Props {
    if (C.props) return C.props;
    const group = new THREE.Group();
    group.name = `pit-props-${C.team.id}`;
    const oldW: WheelProp[] = [], newW: WheelProp[] = [];
    for (let w = 0; w < 4; w++) {
      // (the old set comes off used: dull, grained, marbles and brake dust)
      const a = createWheelProp(w < 2, C.old, 0.6);
      const b = createWheelProp(w < 2, C.compound);
      a.root.visible = b.root.visible = false;
      group.add(a.root, b.root);
      oldW.push(a);
      newW.push(b);
    }
    const guns: THREE.Mesh[] = [];
    for (let w = 0; w < 4; w++) {
      const g = gunMesh();
      g.visible = false;
      group.add(g);
      guns.push(g);
    }
    const jc = new THREE.Color(C.team.primary);
    const jackCol = jc.r + jc.g + jc.b < 0.15 ? C.team.accent : C.team.primary;
    const jackF = jackProp(jackCol, true), jackR = jackProp(jackCol, false);
    jackF.root.visible = jackR.root.visible = false;
    group.add(jackF.root, jackR.root);
    this.group.add(group);
    return (C.props = { group, oldW, newW, guns, jackF, jackR });
  }

  private drawCrew(C: Crew, dt: number, full: boolean, idle: boolean, hidden: boolean) {
    const box = C.box;
    const cx = this.cam.x, cz = this.cam.z;
    const active = C.out;
    for (const m of C.members) {
      const p = m.p;
      // where to be
      let a: Act | null = null;
      if (active) a = this.plan(C, m);
      let tx: number, tz: number, ty: number;
      let clip: string;
      let speed: number;
      if (a) {
        const wp = box.p(a.x, 0, a.z, this.v1);
        tx = wp.x;
        tz = wp.z;
        ty = wp.y;
        clip = a.clip;
        speed = a.speed;
      } else {
        const wp = C.gar.p(m.hx, 0, m.hz, this.v1);
        tx = wp.x;
        tz = wp.z;
        ty = wp.y;
        clip = IDLE_SET.indexOf(m.i) % 2 ? 'Idle_Talking_Loop' : 'Idle_Loop';
        speed = active ? 3.2 : 1.6;
      }
      const dx = tx - m.x, dz = tz - m.z;
      const d = Math.hypot(dx, dz);
      let moving = false;
      if (d > 0.01) {
        // the car's arriving: nobody walks through it; small adjustments slide, longer moves walk / jog
        const step = Math.min(d, speed * dt * (d > 0.9 ? 1 : 0.5 + 0.5 * d));
        m.x += (dx / d) * step;
        m.z += (dz / d) * step;
        moving = d > 0.45;
      }
      m.y += (ty - m.y) * Math.min(1, dt * 10);
      // facing
      let yawT: number;
      if (moving && d > 0.9) yawT = Math.atan2(dx, dz);
      else if (a) {
        const fp = box.p(a.fx, 0, a.fz, this.v2);
        yawT = Math.abs(fp.x - m.x) + Math.abs(fp.z - m.z) > 0.05 ? Math.atan2(fp.x - m.x, fp.z - m.z) : m.yaw;
      } else {
        const fp = C.gar.p(m.hx * 0.3, 0, -3, this.v2);
        yawT = Math.atan2(fp.x - m.x, fp.z - m.z);
      }
      let dy = yawT - m.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      m.yaw += dy * Math.min(1, dt * (moving ? 8 : 10));
      const loco = moving && d > 0.9 ? (speed > 2.6 ? 'Jog_Fwd_Loop' : 'Walk_Loop') : clip;
      // shown?
      const home = !a && this.atHome(C, m);
      let show = !hidden && (full || idle) && (a !== null || (idle && IDLE_SET.includes(m.i)) || (active && !home));
      if (show && this.clear) {
        const cl = this.clear;
        const ux = cl.bx - cl.ax, uz = cl.bz - cl.az;
        const tt = Math.max(0, Math.min(1, ((m.x - cl.ax) * ux + (m.z - cl.az) * uz) / (ux * ux + uz * uz || 1)));
        const ex = cl.ax + ux * tt - m.x, ez = cl.az + uz * tt - m.z;
        if (ex * ex + ez * ez < cl.r * cl.r) show = false;
      }
      const camD = Math.hypot(m.x - cx, m.z - cz);
      if (show && camD < 1.0 && Math.abs(m.y + 1 - this.cam.y) < 1.2) show = false;
      if (show) {
        this.sphere.center.set(m.x, m.y + 0.9, m.z);
        if (!this.frustum.intersectsSphere(this.sphere)) show = false;
      }
      if (!p) continue;
      if (p.root.visible !== show) p.root.visible = show;
      m.shown = show;
      if (!show) continue;
      this.drawn++;
      if (loco !== m.clip) {
        p.play(loco, { fade: m.clip ? 0.3 : 0, offset: (m.i * 0.137) % 1 });
        m.clip = loco;
      }
      p.root.position.set(m.x, m.y, m.z);
      p.root.rotation.set(0, m.yaw, 0);
      // far people animate at a lower rate
      m.acc += dt;
      const every = camD > 70 ? 1 / 15 : camD > 35 ? 1 / 30 : 0;
      if (m.acc >= every) {
        // hands: a firm grip on a gun, a tyre or a jack handle; otherwise the clip's own (relaxed by the life layer)
        const grip = a !== null && a.arms !== 'none' && a.arms !== 'raise' && a.arms !== 'point' && a.arms !== 'stab';
        p.handPose = grip ? 1 : null;
        p.update(m.acc);
        m.acc = 0;
        if (a) this.arms(C, m, p, a);
      }
      const shadow = camD < SHADOW_DIST;
      if (shadow !== m.shadow) {
        m.shadow = shadow;
        p.root.traverse((o) => {
          const s = o as THREE.SkinnedMesh;
          if (s.isSkinnedMesh && s.visible) s.castShadow = shadow;
        });
      }
    }
    this.drawProps(C, full && !hidden && C.out);
  }

  /** two-bone reach of one arm to a world point, elbow toward `pole` */
  private reach(p: Person, s: 'l' | 'r', target: THREE.Vector3, pole: THREE.Vector3, w = 1) {
    const sh = p.worldOf(`upperarm_${s}`, this.v3);
    const el0 = p.worldOf(`lowerarm_${s}`, this.v4);
    const a = el0.distanceTo(sh);
    const hand = p.bones[`hand_${s}`];
    if (!hand) return;
    const b = hand.getWorldPosition(new THREE.Vector3()).distanceTo(el0);
    const u = target.clone().sub(sh);
    const dist = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.005, u.length()));
    u.normalize();
    const v = pole.clone().addScaledVector(u, -pole.dot(u));
    if (v.lengthSq() < 1e-6) v.set(0, -1, 0);
    v.normalize();
    const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const elbow = sh.clone().addScaledVector(u, a * cosA).addScaledVector(v, a * sinA);
    p.aim(`upperarm_${s}`, `lowerarm_${s}`, elbow.clone().sub(sh), w);
    const elNow = p.worldOf(`lowerarm_${s}`, new THREE.Vector3());
    const tgt = sh.clone().addScaledVector(u, dist);
    p.aim(`lowerarm_${s}`, `hand_${s}`, tgt.sub(elNow), w);
  }

  /** the arms for an act, after the clip */
  private arms(C: Crew, m: Member, p: Person, a: Act) {
    const box = C.box;
    const P = C.pose;
    const lift = (P.liftF + P.liftR) / 2;
    const w = m.wheel;
    const down = this.v1.set(0, -1, 0);
    const out = p.dir(0, 0, 1, new THREE.Vector3());
    const leftV = p.dir(1, 0, 0, new THREE.Vector3());
    const pole = (s: number) => down.clone().multiplyScalar(0.7).addScaledVector(leftV, 0.6 * s).addScaledVector(out, -0.2);
    const hub = (k: number, extra = 0) => {
      const front = k < 2;
      const zw = -this.side * (k % 2 === 0 ? 1 : -1) * (front ? TRACK_F : TRACK_R) / 2;
      const o = Math.sign(zw);
      return box.p(front ? AX : -AX, WHEEL_R + lift * LIFT_H, zw + o * (0.26 + P.wheel[k] * WHEEL_SLIDE + extra), new THREE.Vector3());
    };
    switch (a.arms) {
      case 'gun':
      case 'gunUp': {
        const nut = hub(w, 0.12);
        this.reach(p, 'r', nut, pole(-1));
        if (a.arms === 'gunUp') this.reach(p, 'l', p.worldOf('Head', new THREE.Vector3()).addScaledVector(leftV, 0.35).add(new THREE.Vector3(0, 0.55, 0)), leftV.clone());
        else this.reach(p, 'l', nut.clone().addScaledVector(out, -0.2).add(new THREE.Vector3(0, 0.06, 0)), pole(1));
        break;
      }
      case 'grab':
      case 'push': {
        const c = a.arms === 'grab' ? hub(w, 0.1) : hub(w, 0.12);
        const along = box.dir(1, 0, 0, new THREE.Vector3());
        this.reach(p, 'l', c.clone().addScaledVector(along, 0.3 * Math.sign(along.dot(leftV) || 1)), pole(1));
        this.reach(p, 'r', c.clone().addScaledVector(along, -0.3 * Math.sign(along.dot(leftV) || 1)), pole(-1));
        break;
      }
      case 'carry': {
        const c = p.root.position.clone().addScaledVector(out, 0.42).add(new THREE.Vector3(0, a.clip === 'Crouch_Idle_Loop' ? 0.55 : 0.92, 0));
        this.reach(p, 'l', c.clone().addScaledVector(leftV, 0.3), pole(1));
        this.reach(p, 'r', c.clone().addScaledVector(leftV, -0.3), pole(-1));
        break;
      }
      case 'jack': {
        const grip = this.jackGrip(C, m.role === 'jackF', p, new THREE.Vector3());
        this.reach(p, 'l', grip.clone().addScaledVector(leftV, 0.14), pole(1));
        this.reach(p, 'r', grip.clone().addScaledVector(leftV, -0.14), pole(-1));
        break;
      }
      case 'stab': {
        const s = m.i === 14 ? -1 : 1;
        const c = box.p(0.1, 0.62 + lift * LIFT_H, s * 0.72, new THREE.Vector3());
        this.reach(p, 'l', c.clone().addScaledVector(leftV, 0.22), pole(1));
        this.reach(p, 'r', c.clone().addScaledVector(leftV, -0.22), pole(-1));
        break;
      }
      case 'raise': {
        const hd = p.worldOf('Head', new THREE.Vector3());
        this.reach(p, 'r', hd.addScaledVector(leftV, -0.28).add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(out, 0.1), leftV.clone().negate());
        break;
      }
      case 'point': {
        const sh = p.worldOf('upperarm_r', new THREE.Vector3());
        const dir = box.dir(1, 0.1, -0.35, new THREE.Vector3()).normalize();
        this.reach(p, 'r', sh.addScaledVector(dir, 0.75), down.clone());
        break;
      }
      default:
        break;
    }
  }

  /** where the jack man holds the handle (world) */
  private jackGrip(C: Crew, front: boolean, p: Person, out: THREE.Vector3): THREE.Vector3 {
    const lift = front ? C.pose.liftF : C.pose.liftR;
    const f = front ? 1 : -1;
    // the handle end: ~0.95 m up, pulled down to ~0.6 m as the car goes up
    const pos = p.root.position;
    const toward = C.box.dir(-f, 0, 0, this.gv);
    out.copy(pos).addScaledVector(toward, 0.52);
    out.y += 0.95 - lift * 0.32;
    return out;
  }

  // ---------------------------------------------------------------- props

  private drawProps(C: Crew, on: boolean) {
    if (!on) {
      if (C.props) C.props.group.visible = false;
      return;
    }
    const pr = this.props(C);
    pr.group.visible = true;
    const box = C.box;
    const P = C.pose;
    const st = C.stop;
    const inStop = st?.phase === 'stop';
    const t = inStop ? st!.t : 99;
    const lift = (P.liftF + P.liftR) / 2;
    const up = this.v4.set(0, 1, 0);
    for (let w = 0; w < 4; w++) {
      const front = w < 2;
      const zw = -this.side * (w % 2 === 0 ? 1 : -1) * (front ? TRACK_F : TRACK_R) / 2;
      const o = Math.sign(zw);
      const axle = box.dir(0, 0, o, new THREE.Vector3());
      const lag = [0, 0.05, 0.03, 0.07][w];
      // old wheel: off the car once the car's own wheel is gone, then in the tyre-off man's hands
      const oldW = pr.oldW[w];
      oldW.setCompound(C.old);
      const offM = C.members[4 + w];
      const oldShown = (inStop && t >= STOP.off[1] + lag) || (!inStop && C.gone >= 0 && C.gone < 12 && !this.atHome(C, offM));
      oldW.root.visible = oldShown && offM.shown;
      if (oldW.root.visible) {
        const handoff = inStop ? sm(STOP.off[1] + lag, STOP.off[1] + lag + 0.25, t) : 1;
        const hubP = box.p(front ? AX : -AX, WHEEL_R + lift * LIFT_H, zw + o * (0.26 + WHEEL_SLIDE), this.v1);
        const carry = this.carryPoint(offM, this.v2);
        oldW.root.position.copy(hubP).lerp(carry, handoff);
        const fwd = this.v3.set(Math.sin(offM.yaw), 0, Math.cos(offM.yaw));
        this.orient(oldW.root, axle.clone().lerp(fwd, handoff).normalize(), up);
      }
      // new wheel: in the tyre-on man's hands until it goes onto the hub (then it's the car's)
      const newW = pr.newW[w];
      newW.setCompound(C.compound);
      const onM = C.members[8 + w];
      const newShown = st !== null && (!inStop || t < STOP.on[0] + lag) && !(C.gone >= 0 && !inStop);
      newW.root.visible = newShown && onM.shown;
      if (newW.root.visible) {
        const k = inStop ? sm(STOP.on[0] + lag - 0.2, STOP.on[0] + lag, t) : 0;
        const hubP = box.p(front ? AX : -AX, WHEEL_R + lift * LIFT_H, zw + o * (0.26 + WHEEL_SLIDE), this.v1);
        const carry = this.carryPoint(onM, this.v2, onM.clip === 'Crouch_Idle_Loop');
        newW.root.position.copy(carry).lerp(hubP, k);
        const fwd = this.v3.set(Math.sin(onM.yaw), 0, Math.cos(onM.yaw));
        this.orient(newW.root, fwd.clone().lerp(axle, k).normalize(), up);
      }
      // wheel gun in the gunner's right hand, pointing at the nut while at work
      const g = pr.guns[w];
      const gm = C.members[w];
      g.visible = gm.shown && !!gm.p;
      if (g.visible) {
        const hand = gm.p!.worldOf('hand_r', this.v1);
        const nut = box.p(front ? AX : -AX, WHEEL_R + lift * LIFT_H, zw + o * (0.26 + P.wheel[w] * WHEEL_SLIDE + 0.12), this.v2);
        const working = inStop && !(P.tight[w] && t > STOP.tight + 0.3);
        g.position.copy(hand);
        if (working) g.lookAt(nut);
        else {
          const dn = this.v3.set(Math.sin(gm.yaw), -1.3, Math.cos(gm.yaw)).normalize();
          g.lookAt(this.v2.copy(hand).add(dn));
        }
        g.position.addScaledVector(g.getWorldDirection(this.v3), 0.02);
      }
    }
    // jacks
    for (const front of [true, false]) {
      const J = front ? pr.jackF : pr.jackR;
      const M = C.members[front ? 12 : 13];
      J.root.visible = M.shown && !!M.p;
      if (!J.root.visible) continue;
      const lift1 = front ? P.liftF : P.liftR;
      const f = front ? 1 : -1;
      const endX = front ? NOSE : TAIL;
      // the jack stays under the car while it's up; otherwise it goes where its man goes
      const manF = this.toFrame(C, M.x, M.z);
      const engaged = inStop && lift1 > 0.001;
      const px = engaged ? endX + f * 0.28 : manF.x - f * 1.0;
      const pz = engaged ? 0 : manF.z;
      const base = box.p(px, 0, pz, this.v1);
      J.root.position.copy(base);
      const fdir = box.dir(-f, 0, 0, this.v2);
      J.root.rotation.set(0, Math.atan2(fdir.x, fdir.z) - Math.PI / 2, 0);
      J.head.position.y = 0.2 + lift1 * LIFT_H * 1.3;
      J.root.updateMatrixWorld();
      // handle from the pivot to the man's hands
      const pivot = J.root.localToWorld(new THREE.Vector3(-0.4, 0.14, 0));
      const grip = M.p ? this.jackGrip(C, front, M.p, new THREE.Vector3()) : pivot.clone();
      const dir = grip.clone().sub(pivot);
      const len = Math.max(0.3, dir.length());
      J.handle.position.copy(J.root.worldToLocal(pivot.clone()));
      J.handle.scale.set(1, len, 1);
      const localDir = dir.clone().applyQuaternion(J.root.getWorldQuaternion(this.q1).invert()).normalize();
      J.handle.quaternion.setFromUnitVectors(this.v2.set(0, 1, 0), localDir);
    }
  }

  private carryPoint(m: Member, out: THREE.Vector3, low = false): THREE.Vector3 {
    return out.set(m.x + Math.sin(m.yaw) * 0.46, m.y + (low ? 0.5 : 0.9), m.z + Math.cos(m.yaw) * 0.46);
  }

  /** a wheel prop: local +x (the axle) along `axle`, up kept up */
  private orient(o: THREE.Object3D, axle: THREE.Vector3, up: THREE.Vector3) {
    const x = axle.clone().setY(0).normalize();
    const z = x.clone().cross(up).normalize();
    this.m1.makeBasis(x, up, z);
    o.quaternion.setFromRotationMatrix(this.m1);
  }

  /** a world point in a crew's box frame (x along the lane, z toward the garage) */
  private toFrame(C: Crew, x: number, z: number): { x: number; z: number } {
    const f = C.box;
    const dx = x - f.o.x, dz = z - f.o.z;
    return { x: dx * f.x.x + dz * f.x.z, z: dx * f.z.x + dz * f.z.z };
  }

  // ---------------------------------------------------------------- release lights

  private lights(dt: number) {
    for (const C of this.crews) {
      const st = C.stop;
      let want = 0;
      if (st?.phase === 'in' && C.out) want = 1;
      else if (st?.phase === 'stop') want = st.green ? 2 : 1;
      else if (C.gone >= 0 && C.gone < 1.4) want = 2;
      C.light = want;
      C.lightT += dt;
    }
  }

  dispose() {
    for (const C of this.crews) {
      for (const m of C.members) {
        if (!m.p) continue;
        m.p.root.removeFromParent();
        m.p.dispose();
        m.p = null;
      }
      if (C.props) {
        for (const w of [...C.props.oldW, ...C.props.newW]) w.dispose();
        // the jacks' own meshes (the shared gun / jack paint are freed below)
        for (const J of [C.props.jackF, C.props.jackR])
          J.root.traverse((o) => {
            const me = o as THREE.Mesh;
            if (!me.isMesh) return;
            me.geometry.dispose();
            const mat = me.material as THREE.Material;
            if (mat.name !== 'pit-jack') mat.dispose();
          });
        C.props.group.removeFromParent();
        C.props = null;
      }
      C.helmetMat.dispose();
      C.logo?.dispose();
      C.logo = null;
    }
    this.crews.length = 0;
    // module-level caches: the next world makes fresh ones
    gunGeo?.dispose();
    gunMat?.dispose();
    gunGeo = gunMat = null;
    for (const m of jackMats.values()) m.dispose();
    jackMats.clear();
  }
}
