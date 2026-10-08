import * as THREE from 'three';
import { Cameras, CAMERA_GROUP, DEFAULT_CAM, INSIDE_CAR, type CameraMode } from './Cameras.ts';
import { Director, type FieldCar } from './Director.ts';
import type { ReplayEvent } from './Replay.ts';
import type { Renderer } from '../core/Renderer.ts';
import type { Race } from '../race/Race.ts';
import type { CarPhysics } from '../sim/CarPhysics.ts';
import type { CarRig } from '../car/CarModel.ts';
import type { Track } from '../world/Track.ts';
import type { Environment } from '../world/Environment.ts';
import { aerialLens } from '../world/env/fog.ts';
import { bigScreenTarget, bigScreenUniforms, screenSites, LED_W, LED_H } from '../world/env/bigScreens.ts';
import { weatherUniforms } from '../world/weatherUniforms.ts';
import { EVENT } from '../world/event.ts';

/**
 * The circuit's big screens show the world feed: the TV director's live broadcast with its
 * graphics (the timing tower and lap count, the driver's name as a shot opens on him, speed and
 * gear on the onboards), as the giant screens at a Grand Prix carry what the viewers at home see.
 *
 * A second lens films the live race (its own Cameras — sharing the main set's placed trackside
 * cameras — and its own Director, cutting a little quicker than the calm spectating edit) into
 * one small HDR target, a few times a second rather than every frame, only while some screen
 * is in view and big enough to matter, and with none of the main view's extras: no post chain,
 * no shadow maps drawn again (the main frame's are reused), the trees as impostors, no grass
 * blades, rain streaks or particles. A resolve pass exposes it with the main view's own exposure
 * and tone curve, burns the graphics in at the LED wall's resolution and writes the one shared
 * picture every screen shows (bigScreens.ts draws it as an LED wall). On Low quality the
 * screens keep a holding graphic of the event under the same live timing graphics.
 */

/** the feed's own render (a quarter of a 1536-wide broadcast frame: plenty on a screen 40 m away) */
const FEED_W = 384;
const FEED_H = 216;
/** feed frames per second by quality (real screens show 50 Hz, but a 12 Hz picture reads as live video
 *  from the stands; Low only refreshes the graphics) */
const RATE = { low: 2, medium: 8, high: 12, ultra: 15 } as const;
/** a car in the feed's 216-line picture is ~4× smaller than in a 1080p main view: its LOD distances stretch by that */
const FEED_LOD = 4;
/** cars nearest the feed's lens that may have more than the far silhouette */
const DETAILED = 4;
/**
 * below this many pixels tall on the main view no screen is worth a feed frame (an 8 m screen
 * ~1 km off at 1080p: the picture holds), and below SMALL_PX it is refreshed at half the rate
 */
const MIN_PX = 8;
const SMALL_PX = 60;
const FONT = '"Titillium Web", system-ui, sans-serif';
const ACCENT = '#e10600';
const GLASS = 'rgba(12, 14, 19, 0.86)';

/** what the feed films this frame (built by the game; null holds the last picture) */
export interface FeedSource {
  race: Race;
  track: Track;
  env: Environment;
  field: FieldCar[];
  /** each car's state (live physics, or the replay's ghost) and model */
  car(id: number): CarPhysics | undefined;
  rig(id: number): CarRig | undefined;
  events: readonly ReplayEvent[];
  /** session time and race clock (s) */
  t: number;
  raceTime: number;
  /** the replay knows what's coming: the director gets there this early (s) */
  lookahead: number;
  /** seconds of race this frame, and sim seconds per real second */
  simDt: number;
  timeScale: number;
  /** cars whose driver the main view hides (its onboard eye): the feed shows him */
  hidden: readonly (CarRig | null | undefined)[];
  /** the main view's own objects the feed leaves out (particles, the racing line, blowing leaves) */
  skip: readonly (THREE.Object3D | null | undefined)[];
}

const RESOLVE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const RESOLVE_FRAG = /* glsl */ `
uniform sampler2D uFeed;
uniform sampler2D uStill;
uniform sampler2D uOv;
uniform float uLive;
uniform float uExposure;
uniform float uSat;
uniform vec2 uTexel;
varying vec2 vUv;
// Khronos PBR Neutral, the main view's own tone curve (Renderer: ToneMappingMode.NEUTRAL)
vec3 neutral(vec3 c) {
  float x = min(c.r, min(c.g, c.b));
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= off;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < 0.76) return c;
  float d = 0.24;
  float np = 1.0 - d * d / (peak + d - 0.76);
  c *= np / peak;
  float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);
  return mix(c, vec3(np), g);
}
vec3 grade(vec3 c) {
  // (the scene pass can leave a stray NaN / inf where a shader divides by ~0: the main chain scrubs them too)
  if (c.r != c.r || c.g != c.g || c.b != c.b) c = vec3(0.0);
  c = min(max(c, 0.0), vec3(64.0)) * uExposure;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return clamp(neutral(mix(vec3(l), c, uSat)), 0.0, 1.0);
}
void main() {
  vec3 c;
  if (uLive > 0.5) {
    // upscaled to the wall's LEDs through a small tent filter: the scene's dithered fades and hashed
    // alpha (resolved over time by the main view's TAA) would otherwise show as a screen-door pattern
    vec2 h = 0.5 * uTexel;
    c = 0.25 * (grade(texture2D(uFeed, vUv + vec2(-h.x, -h.y)).rgb) + grade(texture2D(uFeed, vUv + vec2(h.x, -h.y)).rgb)
      + grade(texture2D(uFeed, vUv + vec2(-h.x, h.y)).rgb) + grade(texture2D(uFeed, vUv + vec2(h.x, h.y)).rgb));
    c = pow(c, vec3(1.0 / 2.2));
  } else c = texture2D(uStill, vUv).rgb;
  vec4 o = texture2D(uOv, vUv);
  gl_FragColor = vec4(mix(c, o.rgb, o.a), 1.0);
}`;

const baseUpdate = THREE.Object3D.prototype.updateMatrixWorld;
/**
 * World matrices for what is shown under `o` (Renderer.updateScene skips hidden subtrees, so a car's
 * other level of detail, or a driver the onboard eye hid, still has wherever it was last drawn)
 */
function refreshShown(o: THREE.Object3D) {
  if (o.updateMatrixWorld !== baseUpdate) {
    o.updateMatrixWorld(true);
    return;
  }
  if (o.matrixAutoUpdate) o.updateMatrix();
  if (o.parent) o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
  else o.matrixWorld.copy(o.matrix);
  o.matrixWorldNeedsUpdate = false;
  const kids = o.children;
  for (let i = 0; i < kids.length; i++) if (kids[i].visible) refreshShown(kids[i]);
}

interface TowerRow {
  pos: number;
  code: string;
  color: string;
  gap: string;
  focus: boolean;
}

export class ScreenFeed {
  // (2.6 km deep, not the main view's 30: the feed is a small picture framed on a car. The sky dome is
  // drawn at the far plane and the horizon ring squeezed inside 2.5 km (horizon.ts), so only the far
  // landscape's own geometry is given up, and with it most of the circuit's distant draws)
  /** the feed's lens (tagged: per-camera LOD code leaves the main view's state alone for it) */
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 2600);
  /** dev: film even with no screen in view (cost measurements) / switch the feed off */
  force = false;
  enabled = true;
  /** dev readout: feed frames drawn, CPU ms of the last one (scene + resolve), its draw calls, screen px in view */
  readonly stats = { frames: 0, cpuMs: 0, calls: 0, px: 0, mode: '' as string, focus: -1 };
  private cams: Cameras | null = null;
  private camsTrack: Track | null = null;
  private readonly director = new Director();
  private readonly hdr: THREE.WebGLRenderTarget;
  private readonly mat: THREE.ShaderMaterial;
  private readonly quadScene = new THREE.Scene();
  private readonly quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly ov: CanvasRenderingContext2D;
  private readonly ovTex: THREE.CanvasTexture;
  private readonly still: CanvasRenderingContext2D;
  private readonly stillTex: THREE.CanvasTexture;
  private stillFor = '';
  private ovKey = '';
  private acc = 0;
  private ovAcc = 1;
  private clock = 0;
  /** the shot on air, and the car whose name graphic is up (since when) */
  private shot: CameraMode = 'tv';
  private named = -1;
  private namedAt = -99;
  private started = false;
  private idle = true;
  private ready = false;
  private live = false;
  private readonly frustum = new THREE.Frustum();
  private readonly pv = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly tmp = new THREE.Vector3();
  private readonly hiddenNow: THREE.Object3D[] = [];
  private readonly lodded: [CarRig, 0 | 1 | 2][] = [];
  private readonly dist: number[] = [];
  private readonly order: number[] = [];
  private readonly shown: CarRig[] = [];

  constructor(
    private readonly gfx: Renderer,
    private readonly scene: THREE.Scene,
    private readonly main: THREE.PerspectiveCamera,
  ) {
    this.camera.userData.screenFeed = true;
    this.director.pace = 0.6;
    this.hdr = new THREE.WebGLRenderTarget(FEED_W, FEED_H, { type: THREE.HalfFloatType, depthBuffer: true, samples: 4, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.hdr.texture.name = 'screen feed';
    const mk = (w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.NoColorSpace;
      t.minFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      return { g: c.getContext('2d')!, t };
    };
    const o = mk(LED_W, LED_H);
    this.ov = o.g;
    this.ovTex = o.t;
    this.ovTex.name = 'screen graphics';
    const s = mk(LED_W, LED_H);
    this.still = s.g;
    this.stillTex = s.t;
    this.stillTex.name = 'screen still';
    this.mat = new THREE.ShaderMaterial({
      vertexShader: RESOLVE_VERT,
      fragmentShader: RESOLVE_FRAG,
      uniforms: {
        uFeed: { value: this.hdr.texture },
        uStill: { value: this.stillTex },
        uOv: { value: this.ovTex },
        uLive: { value: 0 },
        uExposure: { value: 1 },
        uSat: { value: 1 },
        uTexel: { value: new THREE.Vector2(1 / FEED_W, 1 / FEED_H) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  /** GPU resources that outlive a circuit switch (kept out of the world's disposal) */
  resources(): object[] {
    const t = bigScreenTarget();
    return [t, t.texture, this.hdr, this.hdr.texture, this.ovTex, this.stillTex, this.mat];
  }

  /**
   * The resolve pass's program, on the driver's threads (KHR_parallel_shader_compile) with its
   * target bound so the program key matches the draw; then the holding graphic goes up.
   */
  compile(): Promise<unknown> {
    const r = this.gfx.renderer;
    const prev = r.getRenderTarget();
    const t = bigScreenTarget();
    r.initRenderTarget(t);
    r.initRenderTarget(this.hdr);
    r.setRenderTarget(t);
    let p: Promise<unknown>;
    try {
      p = r.compileAsync(this.quadScene, this.quadCam);
    } finally {
      r.setRenderTarget(prev);
    }
    return p.then(() => {
      this.ready = true;
      this.holdingPicture();
    });
  }

  /** the event's holding graphic on every screen until the feed has a picture of its own */
  private holdingPicture() {
    if (!this.ready) return;
    this.live = false;
    this.ovKey = '';
    this.ov.clearRect(0, 0, LED_W, LED_H);
    this.ovTex.needsUpdate = true;
    this.resolve();
  }

  /** the circuit's broadcast cameras were (re)placed: the feed's lens shares them */
  setCameras(main: Cameras, track: Track) {
    this.cams = new Cameras(this.camera, track, null, main);
    this.camsTrack = track;
    this.cams.prefs = { ...DEFAULT_CAM };
    this.started = false;
    this.director.reset(0);
    this.holdingPicture();
  }

  /** once per frame, after the main view has rendered */
  frame(dt: number, src: FeedSource | null) {
    this.updateGain();
    if (!src || !this.cams || !this.ready || !this.enabled || src.track !== this.camsTrack) return;
    // (the screens of the circuit on show: a list left from a world since torn down is not)
    let root = screenSites.root;
    while (root && root !== this.scene) root = root.parent;
    if (!root) return;
    this.clock += dt;
    const race = src.race;
    const n = src.field.length;
    if (n === 0) return;
    // the director (cheap: it rates the field twice a second)
    this.director.update(dt, src.t, src.raceTime, src.field, src.events, src.lookahead, this.cams, src.track, race.player.id);
    if (this.director.cutNow || !this.started) this.cut();
    const px = this.force ? 999 : this.screensInView();
    this.stats.px = Math.round(px);
    if (px < MIN_PX) {
      this.idle = true;
      return;
    }
    const id = Math.min(n - 1, this.director.focus);
    const car = src.car(id);
    const rig = src.rig(id);
    if (!car || !rig) return;
    // (back in view after a while: a fresh framing rather than a camera whip-panning to catch up)
    if (this.idle) {
      this.idle = false;
      this.cams.cut();
    }
    // the lens rides with its car every frame the screens are seen (cameras are springs: stepped smoothly);
    // a kerb strike rings the main view's lens once — the feed's must not use it up
    const strike = car.strike;
    this.cams.timeScale = src.timeScale;
    this.cams.update(src.simDt, car, rig, src.track);
    car.strike = strike;

    const q = this.gfx.qualityLevel;
    const hz = RATE[q] * (px < SMALL_PX ? 0.5 : 1);
    this.acc += dt;
    this.ovAcc += dt;
    if (this.acc >= 1 / hz) {
      this.acc = Math.min(this.acc - 1 / hz, 1 / hz);
      this.render(src, q !== 'low');
    } else if (this.ovAcc >= 0.25) {
      // (the graphics are redrawn and uploaded between feed frames: the work is spread out)
      this.ovAcc = 0;
      this.drawGraphics(src);
    }
  }

  /** the director cut: its shot, on the feed's lens (no shots from inside a helmet: the driver is shown) */
  private cut() {
    const cams = this.cams!;
    let mode: CameraMode = this.director.mode;
    if (INSIDE_CAR[mode]) mode = 'tcam';
    cams.set(mode);
    this.started = true;
    this.shot = mode;
    // (the name graphic goes up when the feed moves to another car, as the world feed's does)
    if (this.director.focus !== this.named) {
      this.named = this.director.focus;
      this.namedAt = this.clock;
    }
    this.stats.mode = mode;
    this.stats.focus = this.director.focus;
  }

  /** per screen: the last sight-line verdict and when it was taken (the clock) */
  private seen: { list: unknown; t: Float32Array; v: Uint8Array } = { list: null, t: new Float32Array(0), v: new Uint8Array(0) };
  private readonly probe = new THREE.Vector3();
  private readonly from = new THREE.Vector3();
  /**
   * Can the main view see any of the screen's face, or is it behind a stand, a building or a tree
   * line (the cameras' own sight-line grid: Sightlines)? Three points along its top, where the
   * picture shows over the fences and the crowd; re-asked four times a second.
   */
  private unblocked(i: number, s: (typeof screenSites.list)[number], eye: THREE.Vector3): boolean {
    const sight = this.cams?.sight;
    if (!sight) return true;
    const S = this.seen;
    if (S.list !== screenSites.list) {
      S.list = screenSites.list;
      S.t = new Float32Array(screenSites.list.length).fill(-1e9);
      S.v = new Uint8Array(screenSites.list.length);
    }
    if (this.clock - S.t[i] < 0.25) return S.v[i] === 1;
    S.t[i] = this.clock;
    let ok = false;
    for (const u of [0, -0.4, 0.4]) {
      // (just in front of the face: the screen's own frame is solid in the grid)
      this.probe.set(s.center.x + s.normal.x * 1.5 - s.normal.z * u * s.w, s.center.y + s.h * 0.3, s.center.z + s.normal.z * 1.5 + s.normal.x * u * s.w);
      // (the last few metres skipped: the grid's 3 m cells round the screen hold its own frame; and the
      // first ten, fences included: a lens low over a bank or behind the barrier shares its cell with
      // them — better a feed frame drawn for nothing than a frozen screen in plain view)
      const from = this.from.subVectors(this.probe, eye);
      const len = from.length();
      from.multiplyScalar(Math.min(10, len / 3) / Math.max(1e-3, len)).add(eye);
      if (sight.clear(from, this.probe, 4.5, 0)) {
        ok = true;
        break;
      }
    }
    S.v[i] = ok ? 1 : 0;
    return ok;
  }

  /** the tallest screen on the main view (px), 0 when none faces it inside its frustum in plain sight */
  private screensInView(): number {
    const cam = this.main;
    cam.updateMatrixWorld();
    this.pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pv);
    const eye = cam.getWorldPosition(this.tmp);
    const H = this.gfx.frameSize.h;
    const k = H / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    let best = 0;
    const list = screenSites.list;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      const dx = eye.x - s.center.x, dy = eye.y - s.center.y, dz = eye.z - s.center.z;
      // (seen edge-on a screen is a sliver, and the LEDs' viewing angle leaves it dark anyway)
      const facing = (dx * s.normal.x + dz * s.normal.z) / Math.max(1, Math.hypot(dx, dz));
      if (facing < 0.2) continue;
      this.sphere.center.copy(s.center);
      this.sphere.radius = Math.hypot(s.w, s.h) / 2;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const px = (s.h / d) * k * facing;
      if (px <= best || px < MIN_PX || !this.unblocked(i, s, eye)) continue;
      best = px;
    }
    return best;
  }

  /**
   * The LEDs' white, scene-linear: a 6 000-nit wall by day sits a little below sunlit white paint —
   * bright, readable, never a lamp; after dark the camera is wide open and the wall is a light source
   * that glows round its edge. Held against the grade's exposure so the picture keeps its level
   * as the light changes, as the walls' own light sensors and the broadcast camera's iris keep it.
   */
  private updateGain() {
    const g = this.gfx.grade;
    const look = g.uniforms.get('lookExposure')!.value as number;
    const exp = Math.max(0.05, g.exposure * look);
    const night = THREE.MathUtils.clamp((weatherUniforms.uSignGlow.value - 0.12) / 0.88, 0, 1);
    bigScreenUniforms.uScreenGain.value = (0.9 + 1.4 * night) / exp;
  }

  private render(src: FeedSource, live: boolean) {
    const t0 = performance.now();
    const r = this.gfx.renderer;
    const calls0 = r.info.render.calls;
    if (live) this.renderScene(src);
    this.live = live;
    this.drawGraphics(src);
    this.resolve();
    this.stats.frames++;
    this.stats.calls = r.info.render.calls - calls0;
    this.stats.cpuMs = performance.now() - t0;
  }

  /** the live race through the feed's lens, into the HDR target */
  private renderScene(src: FeedSource) {
    const r = this.gfx.renderer;
    const cam = this.camera;
    cam.updateMatrixWorld();
    // the camera-centred world round this lens (sky dome, trees as impostors, no grass, the horizon)
    src.env.feedView(cam);
    const hidden = this.hiddenNow;
    hidden.length = 0;
    for (const o of src.skip) {
      if (o && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    }
    for (const o of this.peopleSets()) {
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    }
    // the drivers the main view's onboard eye hides are in the feed's shots
    // (the main frame skipped their hidden parts' matrices: brought up to date first)
    const shown = this.shown;
    shown.length = 0;
    for (const rig of src.hidden) {
      if (!rig) continue;
      rig.setDriverVisible(true);
      refreshShown(rig.root);
      shown.push(rig);
    }
    // every car at the level of detail its size in the feed's picture calls for (CarView's distances,
    // scaled by how much smaller the feed's picture is than the main view's): a heli shot of the grid
    // must not draw twenty cockpits the chase camera happens to be among. Only the few nearest the lens
    // get more than the far silhouette (a long lens on the opening lap's pack frames a dozen cars, each
    // ~7 draws at the middle level, for a picture where the ones behind are a few pixels)
    const lodK = (FEED_LOD * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.tan(THREE.MathUtils.degToRad(25));
    const lodded = this.lodded;
    lodded.length = 0;
    const dist = this.dist;
    dist.length = 0;
    for (let id = 0; id < src.field.length; id++) {
      const rig = src.rig(id);
      dist.push(rig && rig.root.visible ? cam.position.distanceToSquared(rig.root.position) : Infinity);
    }
    const order = this.order;
    order.length = 0;
    for (let id = 0; id < dist.length; id++) order.push(id);
    order.sort((a, b) => dist[a] - dist[b]);
    for (let k = 0; k < order.length; k++) {
      const id = order[k];
      if (dist[id] === Infinity) break;
      const rig = src.rig(id)!;
      const d = Math.sqrt(dist[id]) * lodK;
      const want: 0 | 1 | 2 = k >= DETAILED ? 2 : d < 13 ? 0 : d < 75 ? 1 : 2;
      const cur = rig.detailLevel;
      if (want !== cur) {
        rig.setDetail(want);
        refreshShown(rig.root);
        lodded.push([rig, cur]);
      }
    }
    // a long lens thins the haze (as the main view's does: Game.frame)
    const lens = aerialLens.x;
    aerialLens.x = THREE.MathUtils.clamp(0.33 + (cam.fov - 3) * (0.67 / 25), 0.33, 1);
    const sm = r.shadowMap;
    const autoShadow = sm.autoUpdate, needShadow = sm.needsUpdate;
    sm.autoUpdate = false;
    sm.needsUpdate = false;
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(this.hdr);
      r.render(this.scene, cam);
    } finally {
      r.setRenderTarget(prev);
      sm.autoUpdate = autoShadow;
      sm.needsUpdate = needShadow;
      aerialLens.x = lens;
      for (const [rig, lv] of lodded) rig.setDetail(lv);
      for (const rig of shown) rig.setDriverVisible(false, true);
      for (const o of hidden) o.visible = true;
      src.env.feedView(null);
    }
  }

  private people: THREE.Object3D[] = [];
  private peopleAt = -1;
  /**
   * The people round the circuit at work (marshals, photographers, pit crews, concourse walkers:
   * people/Extras.ts) are written into their instance buffers for the main camera alone, near it:
   * what the feed would draw of them is the main view's neighbourhood (dozens of draws for specks
   * at the feed's size), so it leaves them out. Found by name, looked for again every few seconds
   * (they arrive late in a circuit's build).
   */
  private peopleSets(): THREE.Object3D[] {
    if (this.clock >= this.peopleAt) {
      this.peopleAt = this.clock + 4;
      // (a few levels down only: the scene's full tree is tens of thousands of objects)
      const out: THREE.Object3D[] = [];
      const walk = (o: THREE.Object3D, depth: number) => {
        if (o.name.endsWith('_extras')) return void out.push(o);
        if (depth < 4 && !(o as THREE.Mesh).isMesh) for (const c of o.children) walk(c, depth + 1);
      };
      walk(this.scene, 0);
      this.people = out;
    }
    return this.people;
  }

  /** expose, grade and burn in the graphics at the LEDs' resolution: the picture every screen shows */
  private resolve() {
    const r = this.gfx.renderer;
    const u = this.mat.uniforms;
    const g = this.gfx.grade.uniforms;
    u.uLive.value = this.live ? 1 : 0;
    u.uExposure.value = this.gfx.grade.exposure * (g.get('lookExposure')!.value as number) * (1 + (g.get('flash')!.value as number));
    u.uSat.value = (g.get('saturation')!.value as number) * (g.get('lookSaturation')!.value as number);
    if (!this.live && this.stillFor !== EVENT.gp) this.paintStill();
    const prev = r.getRenderTarget();
    try {
      r.setRenderTarget(bigScreenTarget());
      r.render(this.quadScene, this.quadCam);
    } finally {
      r.setRenderTarget(prev);
    }
  }

  // ------------------------------------------------------------------ graphics

  /** the holding graphic (Low quality): the event's name in its colours, the live timing over it */
  private paintStill() {
    this.stillFor = EVENT.gp;
    const g = this.still;
    const W = LED_W, H = LED_H;
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b0e16');
    bg.addColorStop(1, '#1a1f2c');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // the national colours as a band of slanted bars
    const [a, b, c] = EVENT.colours;
    [a, b, c].forEach((col, i) => {
      g.fillStyle = col;
      g.beginPath();
      const x = W * 0.42 + i * 34;
      g.moveTo(x, H);
      g.lineTo(x + 26, H);
      g.lineTo(x + 26 + H * 0.5, 0);
      g.lineTo(x + H * 0.5, 0);
      g.fill();
    });
    g.fillStyle = 'rgba(11, 14, 22, 0.55)';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff';
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.font = `italic 900 46px ${FONT}`;
    g.fillText(EVENT.place, W - 30, H - 92);
    g.font = `700 22px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.fillText(EVENT.gp, W - 30, H - 60);
    g.textAlign = 'left';
    this.stillTex.needsUpdate = true;
  }

  /** the broadcast graphics, redrawn (and uploaded) only when something on them changed */
  private drawGraphics(src: FeedSource) {
    const race = src.race;
    const focus = Math.min(src.field.length - 1, this.director.focus);
    const fc = race.cars[focus];
    if (!fc) return;
    const onboard = this.live && CAMERA_GROUP[this.shot] === 'onboard';
    const laps = race.opts.laps;
    const lap = race.phase === 'grid' || race.phase === 'lights' ? 1 : Math.max(1, Math.min(laps, race.leaderLaps + 1));
    // the tower: every car, intervals to the car ahead (to a tenth: the real tower updates at the loops)
    const rows: TowerRow[] = [];
    const byPos = race.cars.slice().sort((x, y) => x.position - y.position);
    for (const c of byPos) {
      let gap: string;
      if (c.retired) gap = 'OUT';
      else if (c.pit.phase !== 'none') gap = 'PIT';
      else if (c.position === 1) gap = race.phase === 'racing' || race.phase === 'finished' ? 'LEADER' : '';
      else if (c.gapLeader < 0) gap = `+${Math.round(-c.gapLeader)} LAP`;
      else gap = c.gapAhead > 0 ? `+${c.gapAhead.toFixed(1)}` : '';
      rows.push({ pos: c.position, code: c.entry.driver.code, color: c.entry.team.primary, gap, focus: c.id === focus });
    }
    // (over the holding graphic only the timing: no name or speed without the pictures they go with)
    const live = this.live;
    const nameOn = live && this.clock - this.namedAt < 5 && this.named === focus;
    const kmh = Math.round(Math.max(0, src.car(focus)?.vx ?? 0) * 3.6);
    const gear = src.car(focus)?.gear ?? 0;
    const caption = this.director.caption;
    const key = `${lap}/${laps}|${rows.map((r) => r.code + r.gap + (r.focus ? '*' : '')).join(',')}|${nameOn ? focus : -1}|${caption}|${onboard ? `${kmh}:${gear}` : ''}|${this.live ? 1 : 0}`;
    if (key === this.ovKey) return;
    this.ovKey = key;
    const g = this.ov;
    const W = LED_W, H = LED_H;
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'middle';
    // ---- the tower, top left: lap count, then the order
    const x0 = 16, y0 = 14, tw = 132, rh = 16.5;
    g.fillStyle = ACCENT;
    g.fillRect(x0, y0, tw, 24);
    g.fillStyle = '#ffffff';
    g.font = `700 14px ${FONT}`;
    g.textAlign = 'left';
    g.fillText('LAP', x0 + 8, y0 + 12.5);
    g.font = `900 16px ${FONT}`;
    g.textAlign = 'right';
    g.fillText(`${lap}/${laps}`, x0 + tw - 8, y0 + 12.5);
    const ty = y0 + 26;
    g.fillStyle = GLASS;
    g.fillRect(x0, ty, tw, rows.length * rh + 4);
    rows.forEach((r, i) => {
      const y = ty + 2 + i * rh;
      if (r.focus) {
        g.fillStyle = '#f2f2f2';
        g.fillRect(x0, y, tw, rh);
      }
      const ink = r.focus ? '#111318' : '#ffffff';
      g.fillStyle = r.focus ? '#111318' : 'rgba(255,255,255,0.7)';
      g.font = `700 12px ${FONT}`;
      g.textAlign = 'right';
      g.fillText(String(r.pos), x0 + 20, y + rh / 2 + 0.5);
      g.fillStyle = r.color;
      g.fillRect(x0 + 25, y + 3, 3, rh - 6);
      g.fillStyle = ink;
      g.font = `700 13px ${FONT}`;
      g.textAlign = 'left';
      g.fillText(r.code, x0 + 33, y + rh / 2 + 0.5);
      g.font = `600 11px ${FONT}`;
      g.textAlign = 'right';
      g.fillStyle = r.focus ? '#111318' : r.gap === 'PIT' ? '#ffd400' : r.gap === 'OUT' ? '#ff6b6b' : 'rgba(255,255,255,0.82)';
      g.fillText(r.gap, x0 + tw - 7, y + rh / 2 + 0.5);
    });
    // ---- LIVE, top right
    if (live) {
      g.font = `700 13px ${FONT}`;
      g.textAlign = 'left';
      const lw = 58;
      g.fillStyle = GLASS;
      g.fillRect(W - 16 - lw, 14, lw, 24);
      g.fillStyle = ACCENT;
      g.beginPath();
      g.arc(W - 16 - lw + 13, 26, 4, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.fillText('LIVE', W - 16 - lw + 22, 26.5);
    }
    // ---- the name graphic, bottom left of centre
    if (nameOn) {
      const d = fc.entry.driver;
      const bx = 172, by = H - 78, bw = 330, bh = 50;
      if (caption) {
        g.font = `700 12px ${FONT}`;
        const cw = g.measureText(caption.toUpperCase()).width + 18;
        g.fillStyle = ACCENT;
        g.fillRect(bx, by - 22, cw, 20);
        g.fillStyle = '#ffffff';
        g.fillText(caption.toUpperCase(), bx + 9, by - 11.5);
      }
      g.fillStyle = GLASS;
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = '#f2f2f2';
      g.fillRect(bx, by, 44, bh);
      g.fillStyle = '#111318';
      g.font = `900 22px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(String(fc.position), bx + 22, by + bh / 2 + 1);
      g.fillStyle = fc.entry.team.primary;
      g.fillRect(bx + 44, by, 5, bh);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.font = `400 17px ${FONT}`;
      g.fillText(d.first, bx + 60, by + 17);
      const fw = g.measureText(d.first + ' ').width;
      g.fillStyle = '#ffffff';
      g.font = `900 17px ${FONT}`;
      g.fillText(d.last.toUpperCase(), bx + 60 + fw, by + 17);
      g.fillStyle = 'rgba(255,255,255,0.62)';
      g.font = `600 12px ${FONT}`;
      g.fillText(fc.entry.team.name.toUpperCase(), bx + 60, by + 37);
      g.font = `900 20px ${FONT}`;
      g.textAlign = 'right';
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillText(String(d.number), bx + bw - 12, by + bh / 2 + 1);
    }
    // ---- the onboard: who, speed and gear, bottom right
    if (onboard) {
      const bw = 168, bh = 34, bx = W - 16 - bw, by = H - 16 - bh;
      g.fillStyle = GLASS;
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = fc.entry.team.primary;
      g.fillRect(bx, by, 4, bh);
      g.fillStyle = '#ffffff';
      g.textAlign = 'left';
      g.font = `700 14px ${FONT}`;
      g.fillText(fc.entry.driver.code, bx + 12, by + bh / 2 + 1);
      g.textAlign = 'right';
      g.font = `900 18px ${FONT}`;
      g.fillText(String(kmh), bx + 112, by + bh / 2 + 1);
      g.font = `600 10px ${FONT}`;
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.textAlign = 'left';
      g.fillText('KM/H', bx + 115, by + bh / 2 + 2);
      g.fillStyle = ACCENT;
      g.fillRect(bx + bw - 26, by + 5, 20, bh - 10);
      g.fillStyle = '#ffffff';
      g.font = `900 15px ${FONT}`;
      g.textAlign = 'center';
      g.fillText(gear <= 0 ? 'N' : String(gear), bx + bw - 16, by + bh / 2 + 1);
    }
    g.textAlign = 'left';
    this.ovTex.needsUpdate = true;
    // (uploaded now, on this frame, rather than inside the next feed frame's resolve)
    this.gfx.renderer.initTexture(this.ovTex);
  }
}
