import * as THREE from 'three';
import type { CarRig } from '../car/CarModel.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import type { Track } from '../world/Track.ts';

export type CameraMode =
  // the cameras the player can race with
  | 'chase' | 'far' | 'tcam' | 'cockpit' | 'nose' | 'wheel' | 'heli' | 'tv'
  // more onboards
  | 'tcamrev' | 'sidepod' | 'fwing' | 'rwing' | 'wheelr'
  // trackside
  | 'tower' | 'longlens' | 'kerb' | 'pitwall' | 'grandstand' | 'gantry'
  // aerial and cinematic
  | 'drone' | 'cine' | 'blimp' | 'topdown';

/** the in-race cycle (C key) and the settings choice: cameras you can drive with */
export const CAMERA_ORDER: CameraMode[] = ['chase', 'far', 'tcam', 'cockpit', 'nose', 'wheel', 'heli', 'tv'];

export type CameraGroup = 'onboard' | 'chase' | 'trackside' | 'aerial';

/** every camera, for spectating and replays (grouped: onboard, chase, trackside, aerial) */
export const ALL_CAMERAS: CameraMode[] = [
  'tcam', 'cockpit', 'nose', 'fwing', 'sidepod', 'wheel', 'wheelr', 'tcamrev', 'rwing',
  'chase', 'far', 'drone', 'cine',
  'tv', 'tower', 'longlens', 'kerb', 'pitwall', 'grandstand', 'gantry',
  'heli', 'blimp', 'topdown',
];

export const CAMERA_LABEL: Record<CameraMode, string> = {
  chase: 'Chase',
  far: 'Chase far',
  tcam: 'T-cam',
  cockpit: 'Halo POV',
  nose: 'Nose',
  wheel: 'Front wheel',
  heli: 'Helicopter',
  tv: 'Trackside',
  tcamrev: 'Rear-facing',
  sidepod: 'Sidepod',
  fwing: 'Front wing',
  rwing: 'Rear wing',
  wheelr: 'Rear wheel',
  tower: 'Corner tower',
  longlens: 'Long lens',
  kerb: 'Kerb cam',
  pitwall: 'Pit wall',
  grandstand: 'Grandstand',
  gantry: 'Start gantry',
  drone: 'Chase drone',
  cine: 'Cinematic orbit',
  blimp: 'Blimp',
  topdown: 'Tactical',
};

export const CAMERA_GROUP: Record<CameraMode, CameraGroup> = {
  tcam: 'onboard', cockpit: 'onboard', nose: 'onboard', wheel: 'onboard', tcamrev: 'onboard', sidepod: 'onboard', fwing: 'onboard', rwing: 'onboard', wheelr: 'onboard',
  chase: 'chase', far: 'chase', drone: 'chase', cine: 'chase',
  tv: 'trackside', tower: 'trackside', longlens: 'trackside', kerb: 'trackside', pitwall: 'trackside', grandstand: 'trackside', gantry: 'trackside',
  heli: 'aerial', blimp: 'aerial', topdown: 'aerial',
};

/** cameras mounted on the car (audio hears the car from inside, the lens gets wet) */
export const ONBOARD: Partial<Record<CameraMode, true>> = { tcam: true, cockpit: true, nose: true, wheel: true, tcamrev: true, sidepod: true, fwing: true, rwing: true, wheelr: true };

/** cameras away from the car: audio hears it from where the camera is */
export function isRemoteCam(m: CameraMode): boolean {
  const g = CAMERA_GROUP[m];
  return g === 'trackside' || g === 'aerial';
}

/**
 * Car-mounted cameras that aren't on a model anchor: position and look direction
 * in the car's frame (+x left, +y up, +z forward), on the sprung body unless
 * `root` (wheel cams ride on the unsprung corner brackets).
 */
interface Mount {
  pos: [number, number, number];
  dir: [number, number, number];
  fov: number;
  root?: boolean;
  shake: number;
}
const MOUNTS: Partial<Record<CameraMode, Mount>> = {
  wheel: { pos: [0.66, 0.64, -0.1], dir: [-0.12, -0.03, 1], fov: 78, root: true, shake: 0.8 },
  tcamrev: { pos: [0, 1.1, -0.34], dir: [0, -0.2, -1], fov: 66, shake: 0.4 },
  sidepod: { pos: [0.72, 0.9, -0.8], dir: [0.06, -0.1, 1], fov: 70, shake: 0.5 },
  fwing: { pos: [0.3, 0.52, 3.05], dir: [-0.08, -0.02, -1], fov: 62, shake: 0.7 },
  // above the rear wing, looking forward over the whole car
  rwing: { pos: [0, 1.28, -2.62], dir: [0, -0.13, 1], fov: 60, shake: 0.5 },
  wheelr: { pos: [0.74, 0.62, -0.5], dir: [0.1, -0.26, -1], fov: 74, root: true, shake: 0.8 },
};

/** critically damped spring toward a target, per axis, sub-stepped so it stays stable at any dt */
function spring(x: THREE.Vector3, v: THREE.Vector3, t: THREE.Vector3, w: number, wy: number, dt: number) {
  const n = Math.min(12, Math.ceil(dt * 60 - 1e-6));
  if (n <= 0) return;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v.x += (w * w * (t.x - x.x) - 2 * w * v.x) * h;
    v.z += (w * w * (t.z - x.z) - 2 * w * v.z) * h;
    v.y += (wy * wy * (t.y - x.y) - 2 * wy * v.y) * h;
    x.addScaledVector(v, h);
  }
}

/**
 * A broadcast camera position: a tower on the outside of a braking zone (sees the
 * car arrive, brake and turn in), a low apex camera on the inside kerb (the car
 * sweeps past close), an exit camera, a panning camera on a straight, a long lens
 * at the end of a straight looking back up it, the pit wall, a grandstand, or the
 * gantry over the start line.
 */
type ShotKind = 'tower' | 'apex' | 'exit' | 'pan' | 'long' | 'pitwall' | 'stand' | 'gantry';
interface TvCam {
  s: number;
  pos: THREE.Vector3;
  kind: ShotKind;
  /** track distance this camera covers (s, wrapped: from → to) */
  from: number;
  to: number;
  /** metres of scene the operator frames around the car (the zoom; 0 = fixed wide lens) */
  frame: number;
  /** where it is, for the broadcast caption */
  where: string;
}

/** which trackside cameras each trackside mode may use */
const TV_KINDS: Partial<Record<CameraMode, ShotKind[]>> = {
  tv: ['tower', 'apex', 'exit', 'pan', 'long', 'pitwall', 'stand', 'gantry'],
  tower: ['tower', 'exit'],
  longlens: ['long', 'pan'],
  kerb: ['apex'],
  pitwall: ['pitwall'],
  grandstand: ['stand'],
  gantry: ['gantry'],
};
/** where along a sight line to test it (dense near the camera: a fence right beside the lens) */
const SIGHT_SAMPLES = [0.01, 0.025, 0.05, 0.08, 0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
/** fixed wide lenses (no zoom, they shake as the car passes) */
const WIDE: Partial<Record<ShotKind, number>> = { apex: 46, pitwall: 52 };

/**
 * Race cameras. All of them read the car's rendered pose (rig.root) so they
 * never disagree with what's on screen. Switching the followed car (a new rig)
 * is a cut: the camera re-frames from scratch.
 */
export class Cameras {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  lookBack = false;
  /** extra shake requested by the game (contacts) */
  impulse = 0;

  private camYaw = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private initialized = false;
  private fov = 60;
  private shakeT = 0;
  private tv: TvCam[] = [];
  private tvIndex = -1;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly v5 = new THREE.Vector3();
  private readonly upV = new THREE.Vector3();
  private readonly leftV = new THREE.Vector3();
  private readonly fV = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private headX = 0;
  private headY = 0;
  private headRoll = 0;
  private lead = 0;
  private camVel = new THREE.Vector3();
  private lookQ = new THREE.Quaternion();
  private orbitT = 0;
  private readonly chaseLook = new THREE.Vector3();
  private lastRig: CarRig | null = null;
  private topYaw = 0;
  private blimpPos = new THREE.Vector3();
  private blimpInit = false;
  private readonly track: Track;

  constructor(camera: THREE.PerspectiveCamera, track: Track) {
    this.camera = camera;
    this.track = track;
    this.buildTv(track);
  }

  /** place the broadcast cameras around the lap from the corners, then fill the straights */
  private buildTv(track: Track) {
    const L = track.length;
    const add = (s: number, side: number, lat: number, h: number, kind: ShotKind, from: number, to: number, frame: number, where: string, free = false) => {
      s = track.wrap(s);
      // never on the pit side of the pit straight or near the pit entry/exit roads, whose walls
      // and fences would stand between the lens and the track (except the pit-wall camera itself)
      const nearPit = track.delta(track.pit.sStart - 700, s) >= 0 && track.delta(s, track.pit.sEnd + 300) >= 0;
      if ((track.inPit(s) || nearPit) && kind !== 'pitwall' && kind !== 'gantry') side = -track.pit.side;
      let l = lat;
      if (!free) {
        const hw = track.halfWidthAt(s);
        const bar = track.barrierAt(s, side);
        l = Math.max(hw + 1.6, Math.min(bar - 2, lat));
      }
      const pos = track.point(s, side * l, h);
      this.tv.push({ s, pos, kind, from: track.wrap(from), to: track.wrap(to), frame, where });
    };
    const covered: [number, number][] = [];
    const corners = track.corners;
    corners.forEach((c, ci) => {
      const outside = -c.dir;
      const slow = c.radius < 90;
      // tower on the outside before the braking zone, looking back up the straight
      add(c.sStart - 55, outside, track.halfWidthAt(c.sStart) + 14, slow ? 9 : 7, 'tower', c.sStart - 230, c.sApex + 10, slow ? 10 : 12, c.name);
      // low camera on the inside at the apex (tight corners: the car sweeps right past)
      if (c.radius < 260) add(c.sApex, c.dir, track.halfWidthAt(c.sApex) + 2.6, 0.75, 'apex', c.sApex - 45, c.sApex + 28, 0, c.name);
      // exit: outside, a little up, watching it put the power down
      add(c.sEnd + 45, outside, track.halfWidthAt(c.sEnd) + 8, 3.6, 'exit', c.sApex + 10, c.sEnd + 150, 7.5, c.name);
      covered.push([c.sStart - 230, c.sEnd + 150]);
      // a long lens at the end of a real straight, looking back up it at the car coming head-on
      const prev = corners[(ci - 1 + corners.length) % corners.length];
      const straight = track.delta(prev.sEnd, c.sStart);
      const straightLen = straight > 0 ? straight : straight + L;
      if (straightLen > 320) add(c.sStart + 12, outside, track.halfWidthAt(c.sStart) + 2.5, 3, 'long', c.sStart - Math.min(520, straightLen - 60), c.sStart - 40, 4.2, `${c.name} braking zone`);
    });
    // straights the corner cameras don't reach: panning cameras every ~230 m
    const inCover = (s: number) => covered.some(([a, b]) => track.delta(a, s) >= 0 && track.delta(s, b) >= 0);
    let flip = 1;
    for (let s = 0; s < L; s += 230) {
      if (inCover(s + 60)) continue;
      add(s, flip, track.halfWidthAt(s) + 9, 3.2 + (flip > 0 ? 1.5 : 0), 'pan', s - 170, s + 150, 6.5, 'Straight');
      flip = -flip;
    }
    // the pit straight: a camera on the pit wall, the gantry over the line, the main grandstand opposite the pits
    const S = track.startS;
    const ps = track.pit.side;
    add(S + 30, ps, track.pit.wallOffset - 0.9, 1.3, 'pitwall', S - 230, S + 90, 0, 'Pit wall', true);
    // over the middle of the straight just before the line (clear of the start-light gantry), looking down it
    add(S - 25, 1, 0, 9, 'gantry', S - 420, S - 30, 9, 'Start / finish', true);
    // high up at the back of the run-off (never beyond the barrier: the trees are there)
    add(S - 120, -ps, track.halfWidthAt(S - 120) + 16, 16, 'stand', S - 480, S + 160, 30, 'Main grandstand');
    // grandstands at the three slowest corners (the big braking zones)
    const slowest = corners.slice().sort((a, b) => a.radius - b.radius).slice(0, 3);
    for (const c of slowest) add(c.sApex, -c.dir, track.halfWidthAt(c.sApex) + 16, 16, 'stand', c.sStart - 170, c.sEnd + 90, 30, `${c.name} grandstand`);
    this.trimToSight(track);
    this.tv.sort((a, b) => a.s - b.s);
  }

  /**
   * Cameras can't see through barriers, fences and the trees behind them: each
   * camera's coverage is cut to the longest stretch of track it has a clear line
   * to (the sight line stays inside the barriers), and a camera with too little is dropped.
   */
  private trimToSight(track: Track) {
    const p = new THREE.Vector3();
    const sees = (c: TvCam, s: number) => {
      track.point(s, 0, 0, p);
      for (const f of SIGHT_SAMPLES) {
        const x = c.pos.x + (p.x - c.pos.x) * f;
        const z = c.pos.z + (p.z - c.pos.z) * f;
        const pr = track.project(x, z, Math.floor(track.wrap(c.s + track.delta(c.s, s) * f)), 60);
        const side = pr.lateral < 0 ? -1 : 1;
        if (Math.abs(pr.lateral) > track.barrierAt(pr.s, side) + 0.3) return false;
      }
      return true;
    };
    const keep: TvCam[] = [];
    for (const c of this.tv) {
      if (c.kind === 'apex' || c.kind === 'pitwall' || c.kind === 'gantry') {
        keep.push(c);
        continue;
      }
      const span = track.delta(c.from, c.to);
      const len = span > 0 ? span : span + track.length;
      let best = 0, bestFrom = 0, run = 0, runFrom = 0;
      for (let d = 0; d <= len; d += 10) {
        if (sees(c, c.from + d)) {
          if (run === 0) runFrom = d;
          run += 10;
          if (run > best) {
            best = run;
            bestFrom = runFrom;
          }
        } else run = 0;
      }
      if (best < 80) continue;
      const from = c.from + bestFrom;
      c.to = track.wrap(from + best - 10);
      c.from = track.wrap(from);
      keep.push(c);
    }
    this.tv = keep;
  }

  next() {
    const i = CAMERA_ORDER.indexOf(this.mode);
    this.set(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length]);
  }

  set(mode: CameraMode) {
    this.mode = mode;
    this.initialized = false;
    this.tvIndex = -1;
    this.blimpInit = false;
  }

  /** force a fresh framing (a cut) on the next update */
  cut() {
    this.initialized = false;
    this.tvIndex = -1;
    this.blimpInit = false;
  }

  /** the lens has depth of field worth rendering (trackside long lenses) */
  get lensDof(): boolean {
    return CAMERA_GROUP[this.mode] === 'trackside';
  }

  /** does some camera of this trackside mode cover track position s (for the director) */
  covers(mode: CameraMode, s: number): boolean {
    const kinds = TV_KINDS[mode];
    if (!kinds) return true;
    const track = this.track;
    for (const c of this.tv) if (kinds.includes(c.kind) && track.delta(c.from, s) >= 0 && track.delta(s, c.to) >= 0) return true;
    return false;
  }

  /** where the current trackside camera is ("Turn 4", "Pit wall"…), '' for the others */
  get where(): string {
    if (!TV_KINDS[this.mode] || this.tvIndex < 0) return '';
    return this.tv[this.tvIndex]?.where ?? '';
  }

  /** cinematic orbit used by menus and the pre-race grid */
  orbit(dt: number, target: THREE.Vector3, radius = 7.5, height = 1.5, speed = 0.12) {
    this.orbitT += dt * speed;
    const a = this.orbitT;
    this.camera.position.set(target.x + Math.sin(a) * radius, target.y + height + Math.sin(a * 0.7) * 0.25, target.z + Math.cos(a) * radius);
    this.camera.lookAt(target.x, target.y + 0.45, target.z);
    this.setFov(34, dt, true);
    this.initialized = false;
  }

  update(dt: number, car: CarPhysics, rig: CarRig, track: Track) {
    const cam = this.camera;
    if (rig !== this.lastRig) {
      this.lastRig = rig;
      this.cut();
    }
    const root = rig.root;
    root.updateMatrixWorld();
    const carPos = root.getWorldPosition(this.v1);
    const speed = Math.max(0, car.vx);
    const kmh = speed * 3.6;

    // shake: speed buzz + kerbs + off-track + impacts
    this.shakeT += dt;
    this.impulse = Math.max(0, this.impulse - dt * 2.5);
    const shakeAmp =
      Math.min(1, kmh / 330) * 0.004 + (car.onKerb ? 0.018 * Math.min(1, speed / 25) : 0) + (car.offTrack ? 0.03 * Math.min(1, speed / 20) : 0) + this.impulse * 0.12;
    const sx = (Math.sin(this.shakeT * 41.3) + Math.sin(this.shakeT * 67.1) * 0.6) * shakeAmp;
    const sy = (Math.sin(this.shakeT * 53.7) + Math.sin(this.shakeT * 29.9) * 0.5) * shakeAmp;

    const fwdCar = this.v2.set(0, 0, 1).applyQuaternion(root.quaternion);
    cam.up.set(0, 1, 0);

    switch (this.mode) {
      case 'heli':
        return this.heliShot(dt, carPos, fwdCar, speed);
      case 'blimp':
        return this.blimpShot(dt, car, carPos, fwdCar, speed);
      case 'topdown':
        return this.topShot(dt, car, carPos);
      case 'drone':
        return this.droneShot(dt, car, carPos, fwdCar, speed, track);
      case 'cine':
        return this.cineShot(dt, car, carPos, track);
      case 'chase':
      case 'far':
        return this.chaseShot(dt, car, carPos, track, sx, sy, kmh, speed);
    }
    if (TV_KINDS[this.mode]) {
      this.tvShot(dt, car, carPos, fwdCar, speed, track, TV_KINDS[this.mode]!);
      return;
    }
    this.onboardShot(dt, car, rig, sx, sy, kmh);
  }

  private heliShot(dt: number, carPos: THREE.Vector3, fwdCar: THREE.Vector3, speed: number) {
    const cam = this.camera;
    // helicopter: high and off to one side, trailing the car on a long lens
    const side = this.v3.set(fwdCar.z, 0, -fwdCar.x);
    const want = this.v4.copy(carPos).addScaledVector(fwdCar, -30).addScaledVector(side, 9);
    want.y = carPos.y + 46;
    if (!this.initialized) {
      this.camPos.copy(want);
      this.camVel.set(0, 0, 0);
    }
    spring(this.camPos, this.camVel, want, 1.6, 1.2, dt);
    const look = this.v3.copy(carPos).addScaledVector(fwdCar, Math.min(10, speed * 0.12));
    if (!this.initialized) this.camLook.copy(look);
    this.camLook.lerp(look, Math.min(1, dt * 6));
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    const dist = cam.position.distanceTo(carPos);
    this.setFov(THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(11 / dist)), 12, 50), dt, !this.initialized);
    this.initialized = true;
  }

  /** the blimp: very high, drifting slowly after the action; a long lens holds a wide patch of track */
  private blimpShot(dt: number, car: CarPhysics, carPos: THREE.Vector3, fwdCar: THREE.Vector3, speed: number) {
    const cam = this.camera;
    const drift = this.shakeT * 0.02;
    const want = this.v4.set(carPos.x + Math.sin(drift) * 170, carPos.y + 240, carPos.z + Math.cos(drift) * 170);
    if (!this.blimpInit || this.blimpPos.distanceTo(want) > 900) {
      this.blimpPos.copy(want);
      this.blimpInit = true;
      this.initialized = false;
    }
    // an airship: at most ~45 m/s
    const d = this.v3.copy(want).sub(this.blimpPos);
    const len = d.length();
    const step = Math.min(len, 45 * dt + len * Math.min(1, dt * 0.08));
    if (len > 1e-3) this.blimpPos.addScaledVector(d, step / len);
    cam.position.copy(this.blimpPos);
    cam.position.y += Math.sin(this.shakeT * 0.3) * 0.8;
    const look = this.v3.copy(carPos).addScaledVector(fwdCar, Math.min(18, speed * 0.25));
    if (!this.initialized) {
      this.camLook.copy(look);
      this.camVel.set(0, 0, 0);
    }
    this.feedForward(look, car, 2 / 3);
    spring(this.camLook, this.camVel, look, 3, 3, dt);
    cam.lookAt(this.camLook);
    const dist = cam.position.distanceTo(carPos);
    this.setFov(THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(38 / dist)), 1.5, 40), dt, !this.initialized);
    this.initialized = true;
  }

  /** tactical: straight down from high above, heading-up, so the cars around are readable */
  private topShot(dt: number, car: CarPhysics, carPos: THREE.Vector3) {
    const cam = this.camera;
    if (!this.initialized) this.topYaw = car.yaw;
    let dy = car.yaw - this.topYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.topYaw += dy * Math.min(1, dt * 1.5);
    const fx = Math.sin(this.topYaw), fz = Math.cos(this.topYaw);
    // the car sits a little below centre: more road ahead
    const look = this.v3.set(carPos.x + fx * 14, carPos.y, carPos.z + fz * 14);
    if (!this.initialized) {
      this.camLook.copy(look);
      this.camVel.set(0, 0, 0);
    }
    this.feedForward(look, car, 2 / 5);
    spring(this.camLook, this.camVel, look, 5, 5, dt);
    cam.position.set(this.camLook.x, this.camLook.y + 150, this.camLook.z);
    cam.up.set(fx, 0, fz);
    cam.lookAt(this.camLook);
    cam.up.set(0, 1, 0);
    this.setFov(30, dt, !this.initialized);
    this.initialized = true;
  }

  /** a drone chasing the car: further back and higher than the chase cam, with a pilot's lag and bank */
  private droneShot(dt: number, car: CarPhysics, carPos: THREE.Vector3, fwdCar: THREE.Vector3, speed: number, track: Track) {
    const cam = this.camera;
    if (!this.initialized) this.camYaw = car.yaw;
    let dy = car.yaw - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.camYaw += dy * Math.min(1, dt * 2.2);
    const swing = Math.sin(this.shakeT * 0.23) * 4;
    const back = 12 + speed * 0.04;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const want = this.v4.set(-fx * back + fz * swing, 5.2 + Math.sin(this.shakeT * 0.31) * 0.8, -fz * back - fx * swing);
    if (!this.initialized) {
      this.camPos.copy(want);
      this.camVel.set(0, 0, 0);
    }
    spring(this.camPos, this.camVel, want, 3.2, 2.5, dt);
    const p = this.v5.copy(carPos).add(this.camPos);
    p.y = Math.max(p.y, track.point(car.s, car.lateral).y + 2.5);
    cam.position.copy(p);
    const look = this.v3.copy(carPos).addScaledVector(fwdCar, 5 + speed * 0.05);
    look.y += 0.4;
    cam.lookAt(look);
    // bank into the turn like a quadcopter
    const bank = THREE.MathUtils.clamp(-car.ay * 0.004, -0.12, 0.12);
    this.lead += (bank - this.lead) * Math.min(1, dt * 2);
    cam.rotateZ(this.lead);
    this.setFov(52, dt, !this.initialized);
    this.initialized = true;
  }

  /** a slow cinematic orbit around the moving car, low to the ground */
  private cineShot(dt: number, car: CarPhysics, carPos: THREE.Vector3, track: Track) {
    const cam = this.camera;
    this.orbitT += dt * 0.28;
    const a = car.yaw + Math.PI * 0.75 + this.orbitT;
    const r = 6.2 + Math.sin(this.orbitT * 0.9) * 1.4;
    const h = 0.75 + (Math.sin(this.orbitT * 0.6) + 1) * 0.55;
    cam.position.set(carPos.x + Math.sin(a) * r, carPos.y + h, carPos.z + Math.cos(a) * r);
    cam.position.y = Math.max(cam.position.y, track.point(car.s, car.lateral).y + 0.35);
    cam.lookAt(carPos.x, carPos.y + 0.55, carPos.z);
    this.setFov(36, dt, !this.initialized);
    this.initialized = true;
  }

  private chaseShot(dt: number, car: CarPhysics, carPos: THREE.Vector3, track: Track, sx: number, sy: number, kmh: number, speed: number) {
    const cam = this.camera;
    const far = this.mode === 'far';
    const [wx, wz] = car.worldVelocity();
    // F1-game chase cam: locked to the car's heading with a short lag, so a
    // slide shows as the car rotating in frame (only a hint of the travel direction)
    let target = car.yaw;
    if (speed > 6) {
      const velYaw = Math.atan2(wx, wz);
      let d = velYaw - car.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      target = car.yaw + d * 0.15;
    }
    if (this.lookBack) target += Math.PI;
    if (!this.initialized) this.camYaw = target;
    let dy = target - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.camYaw += dy * Math.min(1, dt * (far ? 7 : 10));

    // pulls back under acceleration, closes in under braking, stretches a little with speed
    const dist = (far ? 8.4 : 5.35) + Math.max(-0.5, Math.min(0.7, -car.ax * 0.028)) + speed * 0.003;
    const height = (far ? 2.5 : 1.42) + car.heave * 0.6;
    // spring the camera's offset from the car (not its world position): a world-space spring
    // trails a car at 300 km/h by ~2v/ω ≈ 12 m; the offset only lags the car's turns and surges
    const want = this.v3.set(-Math.sin(this.camYaw) * dist, height, -Math.cos(this.camYaw) * dist);
    if (!this.initialized) {
      this.camPos.copy(want);
      this.camVel.set(0, 0, 0);
    }
    spring(this.camPos, this.camVel, want, far ? 11 : 14, far ? 7 : 8.5, dt);
    this.v4.copy(carPos).add(this.camPos);
    // keep above the road surface
    const ground = track.point(car.s, car.lateral, 0, this.v5).y;
    this.v4.y = Math.max(this.v4.y, ground + 0.9);
    // look a touch into the corner (from the yaw rate), easing in and out
    const leadT = speed > 8 && !this.lookBack ? THREE.MathUtils.clamp(car.r * 0.16, -0.14, 0.14) : 0;
    this.lead += (leadT - this.lead) * Math.min(1, dt * 3);
    const ly = this.camYaw + this.lead;
    const look = this.v3.set(carPos.x + Math.sin(ly) * 3.4, carPos.y + (far ? 0.75 : 0.88), carPos.z + Math.cos(ly) * 3.4);
    if (this.lookBack) look.set(carPos.x + Math.sin(this.camYaw) * 3.0, carPos.y + 0.9, carPos.z + Math.cos(this.camYaw) * 3.0);
    // (also relative to the car, or it trails v/20 m behind at speed)
    look.sub(carPos);
    if (!this.initialized) this.chaseLook.copy(look);
    this.chaseLook.lerp(look, Math.min(1, dt * 20));
    this.camLook.copy(carPos).add(this.chaseLook);
    cam.position.copy(this.v4);
    cam.position.x += sx;
    cam.position.y += sy;
    cam.lookAt(this.camLook);
    this.setFov((far ? 54 : 56) + Math.min(1, kmh / 330) * 12, dt, !this.initialized);
    this.initialized = true;
  }

  private onboardShot(dt: number, car: CarPhysics, rig: CarRig, sx: number, sy: number, kmh: number) {
    const cam = this.camera;
    const root = rig.root;
    const mount = MOUNTS[this.mode];
    // onboard cameras ride on anchors, or on a mount on the body / a wheel bracket
    if (mount) {
      const holder = mount.root ? root : rig.body;
      holder.updateMatrixWorld();
      holder.getWorldQuaternion(this.q);
      this.v3.set(mount.pos[0], mount.pos[1], mount.pos[2]).applyMatrix4(holder.matrixWorld);
    } else {
      const anchor = this.mode === 'cockpit' ? rig.anchors.cockpit : this.mode === 'tcam' ? rig.anchors.tcam : rig.anchors.nose;
      anchor.updateMatrixWorld();
      anchor.getWorldPosition(this.v3);
      anchor.getWorldQuaternion(this.q);
    }
    // the T-cam housing flexes: its view trails the chassis by a few milliseconds
    if (this.mode === 'tcam' || this.mode === 'tcamrev') {
      if (!this.initialized) this.lookQ.copy(this.q);
      this.lookQ.slerp(this.q, Math.min(1, dt * 22));
      this.q.copy(this.lookQ);
    }
    const up = this.upV.set(0, 1, 0).applyQuaternion(this.q);
    const leftV = this.leftV.set(1, 0, 0).applyQuaternion(this.q);
    if (this.mode === 'cockpit') {
      // the head moves and tilts against the G-forces, and buzzes with the engine
      const hx = THREE.MathUtils.clamp(-car.ay * 0.0035, -0.06, 0.06);
      const hy = THREE.MathUtils.clamp(car.ax * 0.0018, -0.03, 0.03);
      const hr = THREE.MathUtils.clamp(-car.ay * 0.0028, -0.07, 0.07);
      this.headX += (hx - this.headX) * Math.min(1, dt * 8);
      this.headY += (hy - this.headY) * Math.min(1, dt * 8);
      this.headRoll += (hr - this.headRoll) * Math.min(1, dt * 6);
      const buzz = Math.sin(this.shakeT * car.rpm * 0.05) * 0.0006 * Math.min(1, car.rpm / 11000);
      this.v3.addScaledVector(leftV, this.headX).addScaledVector(up, this.headY + buzz);
      up.addScaledVector(leftV, this.headRoll).normalize();
    }
    if (this.mode === 'tcam') this.v3.addScaledVector(up, 0.14);
    const shakeK = mount ? mount.shake : 0.4;
    cam.position.copy(this.v3);
    cam.position.addScaledVector(up, sy * shakeK).addScaledVector(leftV, sx * shakeK);
    const f = this.fV;
    let lift: number;
    if (mount) {
      // the mount's look direction in the car's frame
      f.set(mount.dir[0], mount.dir[1], mount.dir[2]).normalize().applyQuaternion(this.q);
      lift = 0;
    } else {
      f.set(0, 0, 1).applyQuaternion(this.q);
      lift = this.mode === 'tcam' ? -0.9 : this.mode === 'nose' ? 0.2 : -0.35;
    }
    if (this.lookBack) f.negate();
    // look slightly into the corner in the cockpit
    if (this.mode === 'cockpit') f.addScaledVector(leftV, car.steer * 0.9).normalize();
    const look = this.v4.copy(this.v3).addScaledVector(f, 20).addScaledVector(up, lift);
    cam.up.copy(up);
    cam.lookAt(look);
    cam.up.set(0, 1, 0);
    const baseFov = mount ? mount.fov : this.mode === 'cockpit' ? 74 : this.mode === 'tcam' ? 70 : 72;
    this.setFov(baseFov + Math.min(1, kmh / 330) * 6, dt, !this.initialized);
    this.initialized = true;
  }

  /** TV director + operator: cut between the cameras that cover the car, frame and follow like a person on a long lens */
  private tvShot(dt: number, car: CarPhysics, carPos: THREE.Vector3, fwdCar: THREE.Vector3, speed: number, track: Track, kinds: ShotKind[]) {
    const cam = this.camera;
    this.tvAge += dt;
    const covers = (c: TvCam) => track.delta(c.from, car.s) >= 0 && track.delta(car.s, c.to) >= 0;
    let cur = this.tvIndex >= 0 ? this.tv[this.tvIndex] : null;
    if (cur && !kinds.includes(cur.kind)) cur = null;
    // hold a shot at least ~2.5 s; cut when the car leaves it, or to a fresher angle after a while
    let pick = cur ? this.tvIndex : -1;
    const stale = !cur || !covers(cur) || (this.tvAge > 7.5 && cur.kind !== 'apex' && cur.kind !== 'long');
    if (stale || this.tvAge > 2.5) {
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < this.tv.length; i++) {
        const c = this.tv[i];
        if (!kinds.includes(c.kind) || !covers(c)) continue;
        // the camera the car is heading toward (least of its coverage used), with a bonus for the dramatic ones
        const used = track.delta(c.from, car.s) / Math.max(1, track.delta(c.from, c.to));
        const dAhead = track.delta(car.s, c.s);
        let score = -used + (c.kind === 'apex' && dAhead > 8 && dAhead < 40 ? 0.6 : 0) + (c.kind === 'tower' ? 0.15 : 0) + (c.kind === 'long' && used < 0.5 ? 0.35 : 0);
        // the wide, set-piece cameras are rarer in the automatic mix
        if (kinds.length > 3 && (c.kind === 'stand' || c.kind === 'gantry' || c.kind === 'pitwall')) score -= 0.25;
        if (i === this.tvIndex) score += stale ? -5 : 0.35;
        const d = c.pos.distanceTo(carPos);
        if (d > 420 && c.kind !== 'long' && c.kind !== 'stand') score -= 2;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) {
        // nothing covers this bit: the nearest camera of the kind (a restricted mode), else the next one ahead
        let bd = Infinity;
        for (let i = 0; i < this.tv.length; i++) {
          const c = this.tv[i];
          if (!kinds.includes(c.kind)) continue;
          const dd = kinds.length > 3 ? track.delta(car.s, c.s) : c.pos.distanceTo(carPos);
          if ((kinds.length <= 3 || dd > -30) && dd < bd) {
            bd = dd;
            best = i;
          }
        }
      }
      if (best >= 0 && (stale || best !== this.tvIndex)) pick = best;
    }
    if (pick !== this.tvIndex) {
      this.tvIndex = pick;
      this.tvAge = 0;
      this.initialized = false;
    }
    if (this.tvIndex < 0) return;
    const tc = this.tv[this.tvIndex];
    const dist = tc.pos.distanceTo(carPos);
    const wide = WIDE[tc.kind];
    // the operator leads the car a little and trails its moves by a beat
    const look = this.v3.copy(carPos).addScaledVector(fwdCar, Math.min(wide ? 2 : tc.kind === 'long' ? 3 : 6, speed * 0.06));
    look.y += wide ? 0.45 : 0.55;
    const t = this.shakeT;
    const hand = wide ? 0 : dist * (tc.kind === 'long' ? 0.0009 : 0.0018);
    look.x += (Math.sin(t * 0.83) + Math.sin(t * 2.1) * 0.35) * hand;
    look.y += Math.sin(t * 1.27 + 1) * hand * 0.7;
    look.z += Math.sin(t * 0.61 + 2) * hand * 0.6;
    if (!this.initialized) {
      this.camLook.copy(look);
      this.tvLookV.set(0, 0, 0);
    }
    // a critically damped pan: smooth starts and stops, a slight lag on a fast car
    // (the operator anticipates: most of the spring's 2v/ω lag behind a moving car is fed forward)
    const w = wide ? 14 : 8.5;
    this.feedForward(look, car, 1.7 / w);
    spring(this.camLook, this.tvLookV, look, w, 8.5, dt);
    cam.position.copy(tc.pos);
    // the platform sways in the wind; the low cameras shake as the car thunders past
    const pass = wide ? Math.max(0, 1 - dist / 25) * Math.min(1, speed / 60) : 0;
    cam.position.x += Math.sin(t * 0.7) * 0.02 + Math.sin(t * 47) * 0.012 * pass;
    cam.position.y += Math.sin(t * 0.9 + 2) * 0.015 + Math.sin(t * 59) * 0.012 * pass;
    cam.lookAt(this.camLook);
    // zoom: hold the car at a set size in frame (fixed wide lenses don't zoom)
    const aspect = Math.max(0.5, cam.aspect);
    const fov = wide ?? THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(tc.frame / (2 * dist * aspect))), tc.kind === 'long' ? 0.9 : 2.2, tc.kind === 'stand' ? 60 : 50);
    this.setFov(fov, dt * 0.6, !this.initialized);
    this.initialized = true;
    // focus pull on the car; a long lens has a shallow depth of field
    this.tvFocus.copy(carPos);
    this.tvFocus.y += 0.5;
    this.tvDof = wide ? 0.5 : THREE.MathUtils.clamp((tc.kind === 'long' ? 14 : 8) / Math.max(tc.kind === 'long' ? 1.5 : 3, this.fov), 0.5, tc.kind === 'long' ? 3.4 : 2.4);
    this.tvRange = Math.max(4, dist * (tc.kind === 'long' ? 0.05 : 0.1));
  }
  private tvAge = 0;
  private readonly tvLookV = new THREE.Vector3();
  /** TV camera focus (for the game's depth of field) */
  readonly tvFocus = new THREE.Vector3();
  tvDof = 1;
  tvRange = 5;

  /** push a spring's target ahead along the car's velocity by k seconds (cancels the spring's lag) */
  private feedForward(target: THREE.Vector3, car: CarPhysics, k: number) {
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    target.x += (car.vx * sy + car.vy * cy) * k;
    target.z += (car.vx * cy - car.vy * sy) * k;
  }

  private setFov(target: number, dt: number, snap: boolean) {
    this.fov = snap ? target : this.fov + (target - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
