import * as THREE from 'three';
import type { CarRig } from '../car/CarModel.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import type { Track } from '../world/Track.ts';
import type { Sightlines } from './Sightlines.ts';

export type CameraMode =
  // the cameras the player can race with
  | 'chase' | 'far' | 'tcam' | 'cockpit' | 'helmet' | 'nose' | 'wheel' | 'heli' | 'tv'
  // more onboards
  | 'tcamrev' | 'sidepod' | 'fwing' | 'rwing' | 'wheelr'
  // trackside
  | 'tower' | 'longlens' | 'kerb' | 'pitwall' | 'grandstand' | 'gantry'
  // aerial and cinematic
  | 'drone' | 'cine' | 'blimp' | 'topdown';

/** the in-race cycle (C key) and the settings choice: cameras you can drive with */
export const CAMERA_ORDER: CameraMode[] = ['chase', 'far', 'tcam', 'cockpit', 'helmet', 'nose', 'wheel', 'heli', 'tv'];

/** player camera tuning: offsets on top of each camera's own framing */
export interface CamPrefs {
  /** field of view offset (degrees) */
  fov: number;
  /** chase cameras: extra distance (m) and height (m) */
  dist: number;
  height: number;
  /** vibration and kerb shake, 0 … 1.5 */
  shake: number;
  /** how far the view turns into the corners, 0 … 1.5 */
  apex: number;
  /** onboards: how level the horizon is held, 0 (rolls with the car) … 1 (dead level) */
  horizon: number;
  /** field of view widens with speed */
  dynFov: boolean;
}
export const DEFAULT_CAM: CamPrefs = { fov: 0, dist: 0, height: 0, shake: 1, apex: 1, horizon: 0.7, dynFov: true };

export type CameraGroup = 'onboard' | 'chase' | 'trackside' | 'aerial';

/** every camera, for spectating and replays (grouped: onboard, chase, trackside, aerial) */
export const ALL_CAMERAS: CameraMode[] = [
  'tcam', 'cockpit', 'helmet', 'nose', 'fwing', 'sidepod', 'wheel', 'wheelr', 'tcamrev', 'rwing',
  'chase', 'far', 'drone', 'cine',
  'tv', 'tower', 'longlens', 'kerb', 'pitwall', 'grandstand', 'gantry',
  'heli', 'blimp', 'topdown',
];

export const CAMERA_LABEL: Record<CameraMode, string> = {
  chase: 'Chase',
  far: 'Chase far',
  tcam: 'T-cam',
  cockpit: 'Halo POV',
  helmet: 'Helmet cam',
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
  tcam: 'onboard', cockpit: 'onboard', helmet: 'onboard', nose: 'onboard', wheel: 'onboard', tcamrev: 'onboard', sidepod: 'onboard', fwing: 'onboard', rwing: 'onboard', wheelr: 'onboard',
  chase: 'chase', far: 'chase', drone: 'chase', cine: 'chase',
  tv: 'trackside', tower: 'trackside', longlens: 'trackside', kerb: 'trackside', pitwall: 'trackside', grandstand: 'trackside', gantry: 'trackside',
  heli: 'aerial', blimp: 'aerial', topdown: 'aerial',
};

/** cameras mounted on the car (audio hears the car from inside, the lens gets wet) */
export const ONBOARD: Partial<Record<CameraMode, true>> = { tcam: true, cockpit: true, helmet: true, nose: true, wheel: true, tcamrev: true, sidepod: true, fwing: true, rwing: true, wheelr: true };

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

/** frame-rate independent smoothing factor: the share of the gap closed in dt at rate k (1/s) */
const ease = (dt: number, k: number) => 1 - Math.exp(-k * dt);

/** speed-dependent widening of the lens, 0 … 1: little below ~120 km/h, most of it from 150 to 320 */
const dynFov = (kmh: number) => {
  const x = THREE.MathUtils.clamp((kmh - 60) / 270, 0, 1);
  return x * x * (3 - 2 * x);
};

/**
 * Vertical FOV for a lens specified as its vertical FOV on a 16:9 screen: wider screens see more at
 * the sides (Hor+, like the F1 games on ultrawides); narrower ones keep the 16:9 horizontal view
 * rather than losing the sides of the track.
 */
/** cockpit eye offset from the cockpit anchor (m, in the car's frame) */
// (low and back in the tub, like the onboard footage: the halo's hoop rides the top edge, the
// chassis sides fill the bottom 40 % and the front tyres sit half hidden behind them)
const COCKPIT_EYE_UP = -0.05;
const COCKPIT_EYE_FWD = 0.0;
const COCKPIT_FOV = 53;
const COCKPIT_LIFT = 0.5;

function fovFor(v169: number, aspect: number): number {
  const A = 16 / 9;
  if (!(aspect > 0) || aspect >= A) return v169;
  const h = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(v169) / 2) * A);
  return Math.min(80, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(h / 2) / aspect)));
}

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

interface CamSpec {
  s: number;
  side: number;
  lat: number;
  h: number;
  kind: ShotKind;
  from: number;
  to: number;
  frame: number;
  where: string;
  free: boolean;
}
/** catch fences count as blocking this close to the lens (further off you look through them) */
const FENCE_NEAR = 14;

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
 * How a lens riding with the car vibrates, per camera: two resonant bands — the mount or the
 * driver's head on the seat (low: bumps, kerbs, the car hopping) and the structure's buzz (high:
 * speed, the engine, the road's texture) — and how strongly each is rung (rad RMS per unit of
 * excitation), with the weight of pitch / yaw / roll. Measured against onboard footage (the
 * reference clips' cockpits move ~0.8 % of the frame height per 30 fps frame on a bumpy circuit,
 * with 3–5 % jolts on kerbs): here a smooth straight at 300 km/h moves the cockpit view ≈0.4 %,
 * braking zones and the bumpy circuits more, kerbs ≈1–2 % with sharper strike jolts
 * (`node tools/camshake.mjs` measures it).
 */
interface ShakeCfg {
  /** resonances (Hz) and damping ratios of the low and the high band */
  fl: number;
  fh: number;
  zl: number;
  zh: number;
  /** strength of each band */
  low: number;
  high: number;
  /** pitch / yaw / roll weights */
  ax: [number, number, number];
  /** vertical travel of the lens per rad of low-band pitch (m/rad: a head bobs, a bracket barely moves) */
  heave: number;
}
const SHAKE: Record<string, ShakeCfg> = {
  // the driver's eyes: the head on the seat sways with the bumps; the neck soaks up some of the buzz
  cockpit: { fl: 5.2, fh: 15, zl: 0.32, zh: 0.25, low: 1, high: 0.6, ax: [1, 0.45, 0.75], heave: 0.35 },
  helmet: { fl: 4.2, fh: 13, zl: 0.3, zh: 0.25, low: 1.3, high: 0.8, ax: [1, 0.6, 0.85], heave: 0.45 },
  // the T-cam pod and the nose: stiff brackets in the airflow — less sway, more buzz
  tcam: { fl: 8.5, fh: 19, zl: 0.25, zh: 0.2, low: 0.6, high: 1.1, ax: [1, 0.4, 0.7], heave: 0.05 },
  nose: { fl: 11, fh: 22, zl: 0.22, zh: 0.18, low: 0.7, high: 1.35, ax: [1, 0.35, 0.8], heave: 0.03 },
  mount: { fl: 10, fh: 21, zl: 0.22, zh: 0.18, low: 0.75, high: 1.2, ax: [1, 0.35, 0.8], heave: 0.03 },
  // the chase cameras hang off a virtual arm: a soft sway with the bumps, a fine shiver at speed
  chase: { fl: 4.2, fh: 11, zl: 0.38, zh: 0.3, low: 0.5, high: 0.35, ax: [1, 0.5, 0.7], heave: 0.6 },
  far: { fl: 3.6, fh: 10, zl: 0.4, zh: 0.3, low: 0.38, high: 0.25, ax: [1, 0.5, 0.7], heave: 0.6 },
};
/** base strengths (rad RMS) of the speed buzz, the road and the kicks for a band strength of 1 */
const SHAKE_SPEED_HI = 0.0016;
const SHAKE_SPEED_LO = 0.0011;
const SHAKE_ROAD_HI = 0.0009;
const SHAKE_ROAD_LO = 0.0018;
const SHAKE_KICK = 0.016;
/** the integration step of the resonators (s): the high band rings at up to ~22 Hz */
const SHAKE_H = 1 / 600;

/** noise-rung resonators for one lens: [pitch, yaw, roll] × [low, high] */
class CamShake {
  private readonly x = new Float64Array(6);
  private readonly v = new Float64Array(6);
  /** this frame's output (rad, rad, rad, m) */
  pitch = 0;
  yaw = 0;
  roll = 0;
  heave = 0;
  private seed = 0x9e3779b9;

  reset() {
    this.x.fill(0);
    this.v.fill(0);
    this.pitch = this.yaw = this.roll = this.heave = 0;
  }

  /** a roughly gaussian unit sample (sum of uniforms from a fast LCG) */
  private gauss(): number {
    let u = 0;
    for (let i = 0; i < 4; i++) {
      this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
      u += this.seed / 4294967296;
    }
    return (u - 2) * 1.732;
  }

  /**
   * Advance by dt with band amplitudes lo / hi (rad RMS) and a kick (rad, low band; its sign is
   * random per axis, mostly up in pitch: a kerb throws the car up).
   */
  step(dt: number, c: ShakeCfg, lo: number, hi: number, kick: number) {
    const wl = 2 * Math.PI * c.fl;
    const wh = 2 * Math.PI * c.fh;
    if (kick > 0) {
      for (let a = 0; a < 3; a++) {
        const sgn = a === 0 ? -0.6 - 0.4 * Math.abs(this.gauss()) : this.gauss() * 0.6;
        this.v[a] += kick * c.ax[a] * sgn * wl;
      }
    }
    const n = Math.min(60, Math.ceil(dt / SHAKE_H - 1e-6));
    if (n <= 0) return;
    const h = dt / n;
    // white noise of RMS A through a resonator x'' + 2ζωx' + ω²x = ω²w comes out at RMS A when w has
    // spectral strength 4ζA²/ω (so each band's amplitude is set directly in radians)
    const gl = lo * Math.sqrt((4 * c.zl) / (wl * h));
    const gh = hi * Math.sqrt((4 * c.zh) / (wh * h));
    for (let k = 0; k < n; k++) {
      for (let a = 0; a < 3; a++) {
        const wa = c.ax[a];
        const il = a;
        const ih = a + 3;
        this.v[il] += (wl * wl * (gl * wa * this.gauss() - this.x[il]) - 2 * c.zl * wl * this.v[il]) * h;
        this.x[il] += this.v[il] * h;
        this.v[ih] += (wh * wh * (gh * wa * this.gauss() - this.x[ih]) - 2 * c.zh * wh * this.v[ih]) * h;
        this.x[ih] += this.v[ih] * h;
      }
    }
    this.pitch = this.x[0] + this.x[3];
    this.yaw = this.x[1] + this.x[4];
    this.roll = this.x[2] + this.x[5];
    this.heave = this.x[0] * c.heave;
  }
}

/**
 * Race cameras. All of them read the car's rendered pose (rig.root) so they
 * never disagree with what's on screen. Switching the followed car (a new rig)
 * is a cut: the camera re-frames from scratch.
 */
export class Cameras {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'chase';
  lookBack = false;
  /** the player's camera tuning (Settings → Camera tuning) */
  prefs: CamPrefs = { ...DEFAULT_CAM };
  /** extra shake requested by the game (contacts) */
  impulse = 0;
  /** simulation seconds per real second (a sped-up simulated race / replay): shot timings stay in real time */
  timeScale = 1;

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
  /** the cockpit eye: the driver's head thrown about by the G (lateral, vertical, fore-aft m; nod rad), its velocities and target */
  private readonly head = new Float64Array(4);
  private readonly headV = new Float64Array(4);
  private readonly headT = new Float64Array(4);
  private headRoll = 0;
  /** the lens' vibration (see ringShake) */
  private readonly shake = new CamShake();
  /** cockpit: eased look into the corner (rad) */
  private headLook = 0;
  private lead = 0;
  private camVel = new THREE.Vector3();
  private lookQ = new THREE.Quaternion();
  private orbitT = 0;
  private readonly chaseLook = new THREE.Vector3();
  /** chase cam: the corner look-in, the eased acceleration surge, and which way it looked last frame */
  private chaseLead = 0;
  private surge = 0;
  private chaseBack = false;
  private lastRig: CarRig | null = null;
  private topYaw = 0;
  private blimpPos = new THREE.Vector3();
  private blimpInit = false;
  private readonly track: Track;

  /** what the cameras can see (null: only the barrier heuristic) */
  readonly sight: Sightlines | null;

  constructor(camera: THREE.PerspectiveCamera, track: Track, sight: Sightlines | null = null) {
    this.camera = camera;
    this.track = track;
    this.sight = sight;
    const t0 = performance.now();
    this.buildTv(track);
    this.placeMs = Math.round(performance.now() - t0);
  }
  /** how long placing the trackside cameras took (ms) */
  readonly placeMs: number;
  get tvCount(): number {
    return this.tv.length;
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
      const c = this.place({ s, side, lat, h, kind, from: track.wrap(from), to: track.wrap(to), frame, where, free });
      if (c) this.tv.push(c);
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
    this.tv.sort((a, b) => a.s - b.s);
  }

  private readonly pv = new THREE.Vector3();
  private readonly pt = new THREE.Vector3();

  /** a camera position for this spec: the variant (height, set-back, along the track) that sees the most of its stretch */
  private place(sp: CamSpec): TvCam | null {
    const track = this.track;
    const exempt = sp.kind === 'apex' || sp.kind === 'pitwall' || sp.kind === 'gantry';
    const variants: [number, number, number][] = exempt
      ? sp.kind === 'apex'
        ? [[0, 0, 0], [0, 0.7, 0], [1.8, 0.4, 0], [0, 0, -10], [0, 0, 10]]
        : [[0, 0, 0], [0, 2, 0], [0, 4, 0], [0, 0, -15]]
      : [[0, 0, 0], [0, 3, 0], [-4, 0, 0], [-4, 3, 0], [4, 1, 0], [0, 7, 0], [0, 0, -20], [0, 0, 20], [-6, 6, 0], [0, 12, 0]];
    const span0 = track.delta(sp.from, sp.to);
    const len = span0 > 0 ? span0 : span0 + track.length;
    let best: TvCam | null = null;
    let bestRun = 0;
    for (const [dl, dh, ds] of variants) {
      const s = track.wrap(sp.s + ds);
      let l = sp.lat + dl;
      if (!sp.free) {
        const hw = track.halfWidthAt(s);
        const bar = track.barrierAt(s, sp.side);
        l = Math.max(hw + 1.6, Math.min(bar - 2, l));
      }
      const pos = track.point(s, sp.side * l, sp.h + dh);
      // never inside anything (a tree, a stand, a fence right at the lens)
      if (this.sight && this.embedded(pos)) continue;
      const cam: TvCam = { s, pos, kind: sp.kind, from: sp.from, to: sp.to, frame: sp.frame, where: sp.where };
      let run = 0, runFrom = 0, bRun = 0, bFrom = 0;
      const STEP = 8;
      for (let d = 0; d <= len; d += STEP) {
        if (this.seesTrack(cam, track.wrap(sp.from + d), exempt)) {
          if (run === 0) runFrom = d;
          run += STEP;
          if (run > bRun) {
            bRun = run;
            bFrom = runFrom;
          }
        } else run = 0;
      }
      if (bRun > bestRun) {
        bestRun = bRun;
        cam.from = track.wrap(sp.from + bFrom);
        cam.to = track.wrap(sp.from + bFrom + bRun - STEP);
        best = cam;
      }
      if (bRun >= len * 0.9) break;
    }
    const need = sp.kind === 'apex' ? 30 : exempt ? 60 : 80;
    return best && bestRun >= need ? best : null;
  }

  /** is the point inside (or within a metre of) something solid or a fence */
  private embedded(p: THREE.Vector3): boolean {
    const sg = this.sight!;
    if (sg.solidAt(p.x, p.y, p.z, true)) return true;
    for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) if (sg.solidAt(p.x + dx, p.y, p.z + dz, true)) return true;
    return p.y < sg.groundAt(p.x, p.z) + 0.4;
  }

  /** can this camera see a car at s (on the racing line, and on at least one other line across the road)? */
  private seesTrack(c: TvCam, s: number, exempt: boolean): boolean {
    const track = this.track;
    if (!exempt && !this.insideBarriers(c, s)) return false;
    const sg = this.sight;
    if (!sg) return true;
    const rl = track.racingLineAt(s);
    track.point(s, rl, 0.8, this.pt);
    if (!sg.clear(c.pos, this.pt, 6, FENCE_NEAR)) return false;
    track.point(s, 0, 0.8, this.pt);
    if (sg.clear(c.pos, this.pt, 6, FENCE_NEAR)) return true;
    track.point(s, rl > 0 ? rl - 4 : rl + 4, 0.8, this.pt);
    return sg.clear(c.pos, this.pt, 6, FENCE_NEAR);
  }

  /** the sight line stays inside the barriers (they carry the catch fences and the boards) */
  private insideBarriers(c: TvCam, s: number): boolean {
    const track = this.track;
    const p = track.point(s, 0, 0, this.pv);
    for (const f of SIGHT_SAMPLES) {
      const x = c.pos.x + (p.x - c.pos.x) * f;
      const z = c.pos.z + (p.z - c.pos.z) * f;
      const pr = track.project(x, z, Math.floor(track.wrap(c.s + track.delta(c.s, s) * f)), 60);
      const side = pr.lateral < 0 ? -1 : 1;
      if (Math.abs(pr.lateral) > track.barrierAt(pr.s, side) + 0.3) return false;
    }
    return true;
  }

  next() {
    const i = CAMERA_ORDER.indexOf(this.mode);
    this.set(CAMERA_ORDER[(i + 1) % CAMERA_ORDER.length]);
  }

  set(mode: CameraMode) {
    // chase ↔ chase far glides over a third of a second (every other change is a clean cut)
    if (this.initialized && mode !== this.mode && CAMERA_GROUP[mode] === 'chase' && CAMERA_GROUP[this.mode] === 'chase' && mode !== 'drone' && mode !== 'cine' && this.mode !== 'drone' && this.mode !== 'cine') {
      this.blendPos.copy(this.camera.position);
      this.blendQ.copy(this.camera.quaternion);
      this.blendFov = this.camera.fov;
      this.blendT = 0;
    } else this.blendT = 1;
    this.mode = mode;
    this.lost = false;
    this.lostPrev = false;
    this.initialized = false;
    this.tvIndex = -1;
    this.blimpInit = false;
    this.cuts++;
  }

  /** bumped on every cut (a new shot, a reset): frame-to-frame effects (motion blur) skip that frame */
  cuts = 0;
  /** force a fresh framing (a cut) on the next update */
  cut() {
    this.cuts++;
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

  private readonly blendPos = new THREE.Vector3();
  private readonly blendQ = new THREE.Quaternion();
  private blendFov = 50;
  private blendT = 1;

  update(dt: number, car: CarPhysics, rig: CarRig, track: Track) {
    this.frame(dt, car, rig, track);
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / 0.35);
      const k = this.blendT * this.blendT * (3 - 2 * this.blendT);
      const cam = this.camera;
      cam.position.lerpVectors(this.blendPos, cam.position, k);
      cam.quaternion.slerpQuaternions(this.blendQ, cam.quaternion, k);
      cam.fov = this.blendFov + (cam.fov - this.blendFov) * k;
      cam.updateProjectionMatrix();
    }
  }

  private frame(dt: number, car: CarPhysics, rig: CarRig, track: Track) {
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

    this.shakeT += dt;
    const impulseIn = this.impulse;
    this.impulse = Math.max(0, this.impulse - dt * 2.5);
    this.ringShake(dt, car, speed, impulseIn);

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
        return this.chaseShot(dt, car, carPos, track, kmh, speed);
    }
    if (TV_KINDS[this.mode]) {
      this.tvShot(dt, car, carPos, fwdCar, speed, track, TV_KINDS[this.mode]!);
      return;
    }
    this.onboardShot(dt, car, rig, kmh);
  }

  /** which vibration profile the current camera has (null: it doesn't ride with the car) */
  private shakeCfg(): ShakeCfg | null {
    const m = this.mode;
    if (m === 'chase' || m === 'far' || m === 'cockpit' || m === 'helmet' || m === 'tcam' || m === 'nose') return SHAKE[m];
    if (MOUNTS[m]) return SHAKE.mount;
    return null;
  }
  private lastImpulse = 0;
  private shakeCut = -1;

  /**
   * Ring the lens with what the car is going through: the speed's buzz, the road under the wheels
   * (CarPhysics.roadVel: the circuit's relief, braking ripples, kerb ridges, the grass), kerb strikes
   * (CarPhysics.strike) and contacts (impulse) as kicks. Scaled by Settings → Camera tuning → shake.
   */
  private ringShake(dt: number, car: CarPhysics, speed: number, impulse: number) {
    const c = this.shakeCfg();
    if (!c || dt <= 0) return;
    if (this.shakeCut !== this.cuts) {
      this.shakeCut = this.cuts;
      this.shake.reset();
      // (a strike the new car took before the cut is old news)
      car.strike = 0;
      this.lastImpulse = impulse;
    }
    // (a sped-up replay or simulated race shakes less: the lens can't follow it anyway)
    // (each car-mounted bracket has its own stiffness: Mount.shake, relative to a typical 0.65)
    const k = this.prefs.shake * (this.timeScale > 1 ? 1 / Math.sqrt(this.timeScale) : 1) * (MOUNTS[this.mode] ? MOUNTS[this.mode]!.shake / 0.65 : 1);
    const sp = Math.min(1.15, speed / 85);
    // the road: compressive (a kerb ridge shakes ~4× a rough braking zone, not 30×); a replay's
    // stand-in car carries no road signal, so its kerbs and the grass come from the surfaces
    const rv = car.roadVel || (car.onKerb ? 0.9 * Math.min(1, speed / 60) : 0) + (car.offTrack ? 2 * Math.min(1, speed / 30) : 0);
    const road = Math.min(7, Math.pow(rv / 0.08, 0.6)) * Math.min(1, speed / 12);
    const lo = (SHAKE_SPEED_LO * sp * sp + SHAKE_ROAD_LO * road) * c.low * k;
    const hi = (SHAKE_SPEED_HI * sp * sp + SHAKE_ROAD_HI * road) * c.high * k;
    // kicks: a wheel striking a kerb (taken from the car once), a contact (the rise of the impulse)
    let kick = 0;
    if (car.strike > 0) {
      kick += SHAKE_KICK * car.strike;
      car.strike = 0;
    }
    if (impulse > this.lastImpulse + 0.05) kick += SHAKE_KICK * 3 * (impulse - this.lastImpulse);
    this.lastImpulse = impulse;
    this.shake.step(dt, c, lo, hi, kick * c.low * k);
  }

  /** the lens' vibration as a rotation in its own frame (and a little travel along `up`) */
  private applyShake(up: THREE.Vector3) {
    const sh = this.shake;
    this.camera.position.addScaledVector(up, sh.heave);
    this.camera.rotateX(sh.pitch);
    this.camera.rotateY(sh.yaw);
    this.camera.rotateZ(sh.roll);
  }

  private heliShot(dt: number, carPos: THREE.Vector3, fwdCar: THREE.Vector3, speed: number, car?: CarPhysics) {
    const cam = this.camera;
    // helicopter: high and off to one side, trailing the car on a long lens;
    // the pilot climbs (and closes in over the top) when a hill or the trees get between
    if (this.sight && this.initialized) {
      this.aim.copy(carPos);
      this.aim.y += 0.7;
      const blocked = !this.sight.clear(this.camPos, this.aim, 5, 0);
      this.heliLift = Math.max(0, Math.min(1, this.heliLift + (blocked ? dt * 1.5 : -dt * 0.25)));
    } else if (!this.initialized) this.heliLift = 0;
    const side = this.v3.set(fwdCar.z, 0, -fwdCar.x);
    const back = 30 * (1 - this.heliLift * 0.6);
    const want = this.v4.copy(carPos).addScaledVector(fwdCar, -back).addScaledVector(side, 9 * (1 - this.heliLift * 0.6));
    want.y = carPos.y + 46 + this.heliLift * 40;
    if (car) this.feedForward(want, car, 0.6);
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
    this.pullIn(carPos, p, dt);
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
    this.pullIn(carPos, cam.position, dt);
    cam.lookAt(carPos.x, carPos.y + 0.55, carPos.z);
    this.setFov(36, dt, !this.initialized);
    this.initialized = true;
  }

  private chaseShot(dt: number, car: CarPhysics, carPos: THREE.Vector3, track: Track, kmh: number, speed: number) {
    const cam = this.camera;
    const far = this.mode === 'far';
    // looking back is a cut, not a 180° swing round the side of the car
    if (this.lookBack !== this.chaseBack) {
      this.chaseBack = this.lookBack;
      this.initialized = false;
    }
    const [wx, wz] = car.worldVelocity();
    // F1-game chase cam: follows the car's heading with a soft lag and a share of the direction
    // of travel, so a slide reads as the car rotating in frame (oversteer shows, understeer too)
    let target = car.yaw;
    if (speed > 6) {
      const velYaw = Math.atan2(wx, wz);
      let d = velYaw - car.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      target = car.yaw + THREE.MathUtils.clamp(d, -0.6, 0.6) * 0.32;
    }
    if (this.lookBack) target += Math.PI;
    if (!this.initialized) this.camYaw = target;
    let dy = target - this.camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.camYaw += dy * ease(dt, far ? 5.5 : 7);

    // the car surges away on the throttle and comes back toward the lens on the brakes (eased, so
    // a gear change or a kerb doesn't jolt the framing)
    const surgeT = speed > 3 ? THREE.MathUtils.clamp(car.ax * 0.022, -0.42, 0.4) : 0;
    this.surge = this.initialized ? this.surge + (surgeT - this.surge) * ease(dt, 3.2) : surgeT;
    // low and close behind the rear wing, the car in the lower third of the frame
    const P = this.prefs;
    const dist = (far ? 7.7 : 5.55) + P.dist + this.surge + speed * 0.0024;
    // (low, as the race footage frames it: the road rushing under the lens sells the speed)
    const height = (far ? 1.95 : 1.2) + P.height + car.heave * 0.5;
    // spring the camera's offset from the car (not its world position): a world-space spring
    // trails a car at 300 km/h by ~2v/ω ≈ 12 m; the offset only lags the car's turns and surges
    const want = this.v3.set(-Math.sin(this.camYaw) * dist, height, -Math.cos(this.camYaw) * dist);
    if (!this.initialized) {
      this.camPos.copy(want);
      this.camVel.set(0, 0, 0);
    }
    spring(this.camPos, this.camVel, want, far ? 10 : 12.5, far ? 6.5 : 8, dt);
    this.v4.copy(carPos).add(this.camPos);
    // keep above the road: under the car, and under the lens itself (the road behind the car is
    // higher than the car over a crest — without this the camera sinks into it going downhill)
    const ground = track.point(car.s, car.lateral, 0, this.v5).y;
    const behind = track.point(track.wrap(car.s - (this.lookBack ? -dist : dist)), car.lateral, 0, this.v5).y;
    this.v4.y = Math.max(this.v4.y, ground + 0.9, behind + height * 0.82);
    // look ahead down the road and into the corner (from the yaw rate), easing in and out
    const leadT = speed > 8 && !this.lookBack ? THREE.MathUtils.clamp(car.r * 0.22, -0.2, 0.2) * P.apex : 0;
    this.chaseLead += (leadT - this.chaseLead) * ease(dt, 2.6);
    const ly = this.camYaw + this.chaseLead;
    const ahead = far ? 16 : 13;
    const look = this.v3.set(carPos.x + Math.sin(ly) * ahead, carPos.y + (far ? 0.18 : 0.34), carPos.z + Math.cos(ly) * ahead);
    if (this.lookBack) look.set(carPos.x + Math.sin(this.camYaw) * 8, carPos.y + 0.5, carPos.z + Math.cos(this.camYaw) * 8);
    // (also relative to the car, or it trails v/20 m behind at speed)
    look.sub(carPos);
    if (!this.initialized) this.chaseLook.copy(look);
    this.chaseLook.lerp(look, ease(dt, 14));
    this.camLook.copy(carPos).add(this.chaseLook);
    // weight: the view dips under braking and lifts on the throttle, and leans a couple of degrees
    // with the lateral G (a camera on a car-mounted arm, not a drone)
    const pitchT = THREE.MathUtils.clamp(car.ax * 0.0032, -0.07, 0.05);
    const rollT = this.lookBack ? 0 : THREE.MathUtils.clamp(-car.ay * 0.0034, -0.06, 0.06);
    if (!this.initialized) {
      this.chasePitch = pitchT;
      this.chaseRoll = rollT;
    }
    this.chasePitch += (pitchT - this.chasePitch) * ease(dt, 5);
    this.chaseRoll += (rollT - this.chaseRoll) * ease(dt, 3.5);
    this.camLook.y += this.chasePitch * ahead;
    // road feel: the lens sways and shivers with the road (ringShake: speed, the relief under the
    // wheels, kerbs, the grass, contacts) as rotation — a few millimetres of travel is invisible 5 m
    // back; a fraction of a degree of pitch and roll is what kerbs and bumps look like
    cam.position.copy(this.v4);
    cam.lookAt(this.camLook);
    cam.rotateZ(this.chaseRoll);
    this.applyShake(this.upV.set(0, 1, 0));
    // (wider at speed for the rush — most of it above 150 km/h, where the speed has to be sold —
    // never a fisheye)
    this.setFov(fovFor(far ? 44 : 47, cam.aspect) + P.fov + (P.dynFov ? dynFov(kmh) * 10 : 0), dt, !this.initialized);
    this.initialized = true;
  }
  private chasePitch = 0;
  private chaseRoll = 0;

  private onboardShot(dt: number, car: CarPhysics, rig: CarRig, kmh: number) {
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
      const anchor = this.mode === 'cockpit' ? rig.anchors.cockpit : this.mode === 'helmet' ? (rig.anchors.eyes ?? rig.anchors.cockpit) : this.mode === 'tcam' ? rig.anchors.tcam : rig.anchors.nose;
      anchor.updateMatrixWorld();
      anchor.getWorldPosition(this.v3);
      anchor.getWorldQuaternion(this.q);
      if (this.mode === 'helmet') {
        // half of the head's own motion reaches the lens (all of it is seasick); the eye point
        // rides between the chassis and the head the same way
        rig.body.getWorldQuaternion(this.lookQ);
        this.q.slerp(this.lookQ, 0.5);
        rig.anchors.cockpit.getWorldPosition(this.v5);
        this.v3.lerp(this.v5, 0.4);
      }
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
      // the head is thrown about by the G on its neck (a spring with a little overshoot, so the
      // weight lands and settles): to the outside of the corner, forward and down on the brakes
      // with a nod, pressed back into the seat on the power
      const H = this.head, HV = this.headV, tgt = this.headT;
      tgt[0] = THREE.MathUtils.clamp(-car.ay * 0.0007, -0.032, 0.032);
      tgt[1] = THREE.MathUtils.clamp(car.ax * 0.00034, -0.018, 0.008);
      tgt[2] = THREE.MathUtils.clamp(-car.ax * 0.00062, -0.016, 0.034);
      tgt[3] = THREE.MathUtils.clamp(-car.ax * 0.00042, -0.012, 0.024);
      if (!this.initialized) for (let i = 0; i < 4; i++) (H[i] = tgt[i]), (HV[i] = 0);
      const w = 9.5;
      const n = Math.min(12, Math.ceil(dt * 240 - 1e-6));
      for (let k = 0; k < n; k++) {
        const h = dt / n;
        for (let i = 0; i < 4; i++) {
          HV[i] += (w * w * (tgt[i] - H[i]) - w * HV[i]) * h;
          H[i] += HV[i] * h;
        }
      }
      const hr = THREE.MathUtils.clamp(-car.ay * 0.0028, -0.07, 0.07);
      this.headRoll += (hr - this.headRoll) * ease(dt, 6);
      this.v3.addScaledVector(leftV, H[0]).addScaledVector(up, H[1]).addScaledVector(this.fV.set(0, 0, 1).applyQuaternion(this.q), H[2]);
      // the driver's neck holds the horizon: most of the chassis roll (and the banking) is taken
      // out, and only a hint of the head's own lean against the G is left in
      const worldUp = this.v5.set(0, 1, 0);
      up.lerp(worldUp, this.prefs.horizon).addScaledVector(leftV, this.headRoll * 0.25).normalize();
    }
    if (this.mode === 'helmet') {
      // the driver's own eyes: the camera rides the head (it leans against the G, nods under
      // braking and turns into the corners — see CarRig.setG), with the engine's buzz through the
      // seat and only a little of the chassis roll taken out by the neck
      up.lerp(this.v5.set(0, 1, 0), this.prefs.horizon * 0.45).normalize();
    }
    if (this.mode === 'tcam') this.v3.addScaledVector(up, 0.14);
    // the nose camera sits on the nose's crest half a metre back from the tip, so the tip, the
    // pitot and the front wing's flaps sit in the bottom of the picture with the road beyond
    if (this.mode === 'nose') this.v3.addScaledVector(up, 0.215).addScaledVector(this.fV.set(0, 0, 1).applyQuaternion(this.q), -0.5);
    // the driver's eyes sit high in the cockpit, looking over the wheel and the dash
    // the driver's eyes: low in the tub and forward against the headrest's front, so the halo's
    // hoop frames the top of the picture, the centre pillar splits it, the front tyres sit at the
    // sides and the wheel's screen and shift lights fill the bottom — the real onboard proportions
    if (this.mode === 'cockpit') this.v3.addScaledVector(up, COCKPIT_EYE_UP).addScaledVector(this.fV.set(0, 0, 1).applyQuaternion(this.q), COCKPIT_EYE_FWD);
    cam.position.copy(this.v3);
    const f = this.fV;
    let lift: number;
    if (mount) {
      // the mount's look direction in the car's frame
      f.set(mount.dir[0], mount.dir[1], mount.dir[2]).normalize().applyQuaternion(this.q);
      lift = 0;
    } else {
      f.set(0, 0, 1).applyQuaternion(this.q);
      lift = this.mode === 'tcam' ? -0.9 : this.mode === 'nose' ? -1.5 : this.mode === 'helmet' ? -1.6 : -1.0;
    }
    if (this.lookBack) f.negate();
    // look into the corner in the cockpit: eased, so a keyboard's full-lock taps don't jerk the view
    if (this.mode === 'cockpit') {
      const lookT = this.lookBack ? 0 : THREE.MathUtils.clamp(car.steer * 0.55, -0.16, 0.16) * this.prefs.apex;
      this.headLook = this.initialized ? this.headLook + (lookT - this.headLook) * ease(dt, 4.5) : lookT;
      f.addScaledVector(leftV, this.headLook).normalize();
    }
    // (the head's nod on the brakes tips the look down a touch)
    if (this.mode === 'cockpit') lift = COCKPIT_LIFT - this.head[3] * 20;
    const look = this.v4.copy(this.v3).addScaledVector(f, 20).addScaledVector(up, lift);
    cam.up.copy(up);
    cam.lookAt(look);
    cam.up.set(0, 1, 0);
    // riding with the car: the mount (or the head) sways and buzzes with the road (ringShake)
    this.applyShake(up);
    // (a touch narrower than before: the halo, the wheel and the T-cam's airbox read at their real
    // size instead of shrinking into a fisheye)
    const baseFov = mount ? mount.fov : this.mode === 'cockpit' ? COCKPIT_FOV : this.mode === 'helmet' ? 68 : this.mode === 'tcam' ? 60 : 64;
    this.setFov(fovFor(baseFov, cam.aspect) + this.prefs.fov + (this.prefs.dynFov ? dynFov(kmh) * 4.5 : 0), dt, !this.initialized);
    this.initialized = true;
  }

  /** TV director + operator: cut between the cameras that cover the car, frame and follow like a person on a long lens */
  private tvShot(dt: number, car: CarPhysics, carPos: THREE.Vector3, fwdCar: THREE.Vector3, speed: number, track: Track, kinds: ShotKind[]) {
    const cam = this.camera;
    // (timed in real seconds, however fast the simulation runs)
    const realDt = dt / Math.max(1, this.timeScale);
    this.tvAge += realDt;
    const covers = (c: TvCam) => track.delta(c.from, car.s) >= 0 && track.delta(car.s, c.to) >= 0;
    // where the car is (and will be in half a second): a camera must see both
    this.aim.copy(carPos);
    this.aim.y += 0.7;
    this.aimNext.copy(this.aim);
    this.feedForward(this.aimNext, car, 0.5);
    const sees = (c: TvCam) => !this.sight || (this.sight.clear(c.pos, this.aim, 6, FENCE_NEAR) && this.sight.clear(c.pos, this.aimNext, 6, FENCE_NEAR));
    let cur = this.tvIndex >= 0 ? this.tv[this.tvIndex] : null;
    if (cur && !kinds.includes(cur.kind)) cur = null;
    // the camera on air loses the car (something's about to come between them): cut now
    // (a lamp post or a tree flicking past the lens isn't worth a cut: only a car hidden for a beat is)
    if (cur && !sees(cur)) this.tvBlockT += realDt;
    else this.tvBlockT = Math.max(0, this.tvBlockT - realDt * 2);
    const blocked = this.tvBlockT > 0.45 || (cur !== null && this.tvBlockT > 0 && !this.initialized);
    // hold a shot at least ~6 s; cut when the car leaves it, or to a fresher angle after a long while
    let pick = cur && !blocked ? this.tvIndex : -1;
    // an operator keeps panning with a car that has run past the end of their stretch while they
    // can still see it and it isn't too far off (a shot that short would be a jump cut)
    const past = cur !== null && !covers(cur);
    const grace = past && this.tvAge < 4.5 && cur!.pos.distanceTo(carPos) < (cur!.kind === 'long' ? 520 : 300) * Math.min(3, Math.max(1, this.timeScale));
    const stale = !cur || blocked || (past && !grace) || (this.tvAge > 14 && cur.kind !== 'apex' && cur.kind !== 'long');
    if (stale || this.tvAge > 6) {
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < this.tv.length; i++) {
        const c = this.tv[i];
        if (!kinds.includes(c.kind) || !covers(c)) continue;
        if (i === this.tvIndex && blocked) continue;
        if (!sees(c)) continue;
        // the camera the car is heading toward (least of its coverage used), with a bonus for the dramatic ones
        const used = track.delta(c.from, car.s) / Math.max(1, track.delta(c.from, c.to));
        const dAhead = track.delta(car.s, c.s);
        // and a stretch long enough to make a proper shot of it
        const left = track.delta(car.s, c.to) / Math.max(20, speed);
        let score = -used + Math.min(left, 8) * 0.12 + (c.kind === 'apex' && dAhead > 8 && dAhead < 40 ? 0.6 : 0) + (c.kind === 'tower' ? 0.15 : 0) + (c.kind === 'long' && used < 0.5 ? 0.35 : 0);
        // the wide, set-piece cameras are rarer in the automatic mix
        if (kinds.length > 3 && (c.kind === 'stand' || c.kind === 'gantry' || c.kind === 'pitwall')) score -= 0.25;
        if (i === this.tvIndex) score += stale ? -5 : 0.8;
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
          if ((kinds.length <= 3 || dd > -30) && dd < bd && c.pos.distanceTo(carPos) < 600 && sees(c)) {
            bd = dd;
            best = i;
          }
        }
      }
      if (best >= 0 && (stale || best !== this.tvIndex)) pick = best;
    }
    if (pick !== this.tvIndex) {
      if (pick !== this.tvIndex) this.cuts++;
      this.tvIndex = pick;
      this.tvAge = 0;
      this.initialized = false;
    }
    // no trackside camera can see the car here: the helicopter covers it until one can
    this.lost = this.tvIndex < 0;
    if (this.lost) {
      if (!this.lostPrev) this.initialized = false;
      this.lostPrev = true;
      this.heliShot(dt, carPos, fwdCar, speed, car);
      this.tvFocus.copy(carPos);
      this.tvDof = 0.5;
      this.tvRange = 40;
      return;
    }
    if (this.lostPrev) {
      this.lostPrev = false;
      this.initialized = false;
    }
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
  /** real seconds the trackside angle on air has been up (the director doesn't cut a fresh angle away) */
  get angleAge(): number {
    return TV_KINDS[this.mode] ? this.tvAge : Infinity;
  }
  private tvBlockT = 0;
  private lostPrev = false;
  /** the trackside camera on air can't see the car (and no other covering one can): the helicopter is standing in */
  lost = false;
  private readonly aim = new THREE.Vector3();
  private readonly aimNext = new THREE.Vector3();
  private readonly tvLookV = new THREE.Vector3();
  /** TV camera focus (for the game's depth of field) */
  readonly tvFocus = new THREE.Vector3();
  tvDof = 1;
  tvRange = 5;

  private heliLift = 0;
  private pullD = 1;

  /** bring a camera near the car in front of anything between it and the car (a tree, a fence, a wall) */
  private pullIn(carPos: THREE.Vector3, p: THREE.Vector3, dt: number) {
    const sg = this.sight;
    if (!sg) return;
    this.aim.copy(carPos);
    this.aim.y += 0.7;
    const full = this.aim.distanceTo(p);
    const free = sg.clearDistance(this.aim, p, 2.5);
    const want = Math.min(1, free / Math.max(0.1, full));
    // in fast, out slowly
    this.pullD = !this.initialized || want < this.pullD ? want : this.pullD + (want - this.pullD) * Math.min(1, dt * 1.5);
    if (this.pullD < 0.999) p.lerpVectors(this.aim, p, this.pullD);
  }

  /** push a spring's target ahead along the car's velocity by k seconds (cancels the spring's lag) */
  private feedForward(target: THREE.Vector3, car: CarPhysics, k: number) {
    const sy = Math.sin(car.yaw), cy = Math.cos(car.yaw);
    target.x += (car.vx * sy + car.vy * cy) * k;
    target.z += (car.vx * cy - car.vy * sy) * k;
  }

  private setFov(target: number, dt: number, snap: boolean) {
    this.fov = snap ? target : this.fov + (target - this.fov) * ease(dt, 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
