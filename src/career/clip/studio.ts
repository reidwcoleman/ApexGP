import * as THREE from 'three';
import { BloomEffect, DepthOfFieldEffect, EffectComposer, EffectPass, Pass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { GradeEffect, type Renderer } from '../../core/Renderer.ts';
import { Cameras, CAMERA_GROUP, CAMERA_LABEL, type CameraMode } from '../../game/Cameras.ts';
import { CarView } from '../../game/CarView.ts';
import { Director, type FieldCar } from '../../game/Director.ts';
import { RF } from '../../game/Replay.ts';
import type { CarRig } from '../../car/CarModel.ts';
import type { Entry } from '../../race/Teams.ts';
import type { Track } from '../../world/Track.ts';
import type { Environment } from '../../world/Environment.ts';
import type { Trackside } from '../../world/TrackMesh.ts';
import type { PitComplex } from '../../world/PitComplex.ts';
import { suppressFloods } from '../../world/weatherUniforms.ts';
import { drawOverlay, overlayKey, type OverlayState } from './graphics.ts';
import type { RaceInfo, ShotPlan } from './moments.ts';

/**
 * The highlights' TV studio: renders frames of a recorded race offscreen, into a fixed-size
 * target, through the game's own look (bloom, the weather grade, AgX tone mapping, vignette, a
 * long lens's depth of field) with 4× MSAA, then burns in the broadcast graphics and the replay
 * wipe, and reads the picture back asynchronously (pixel-pack buffers + fences: no stall).
 *
 * The recording is played through a second set of car models (the live ones, the garage, the
 * podium, the particles and the racing line are hidden for the few milliseconds a studio frame
 * takes and shown again straight after), with its own cameras and TV director. Everything the
 * live frame sets up every frame (the sky and scenery around the camera, the shadow focus, the
 * start lights, the flood lights) it sets up again before its next render.
 */

export interface StudioWorld {
  track: Track;
  env: Environment;
  trackside: Trackside;
  pits: PitComplex;
}

export interface StudioHost {
  gfx: Renderer;
  scene: THREE.Scene;
  /** the current circuit's world (null while one is being built) */
  world(): StudioWorld | null;
  /** live objects hidden while a studio frame renders (cars, garage, podium, particles…) */
  liveObjects(): (THREE.Object3D | null | undefined)[];
  /** a car model for this entry, in the paint the game's own car wears */
  makeRig(entry: Entry): CarRig;
  /** changes when that paint changes */
  rigKey(entry: Entry): string;
}

export interface Readback {
  kind: 'frame' | 'poster';
  index: number;
  w: number;
  h: number;
  /** who asked for it ('clip' production, 'live' capture) */
  tag: string;
}

const OUT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

const OUT_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform sampler2D uOv;
uniform float uOvOn;
uniform float uEncode;
uniform float uWipe;
uniform float uFade;
uniform float uBox;
uniform vec2 uTexel;
uniform vec3 uAccent;
varying vec2 vUv;
vec3 srgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 src(vec2 uv) {
  vec3 c;
  if (uBox > 0.5) {
    c = 0.25 * (texture2D(uSrc, uv + vec2(-0.5, -0.5) * uTexel).rgb + texture2D(uSrc, uv + vec2(0.5, -0.5) * uTexel).rgb
      + texture2D(uSrc, uv + vec2(-0.5, 0.5) * uTexel).rgb + texture2D(uSrc, uv + vec2(0.5, 0.5) * uTexel).rgb);
  } else c = texture2D(uSrc, uv).rgb;
  return uEncode > 0.5 ? srgb(c) : c;
}
void main() {
  // written upside down: the first row read back is the top of the picture
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 c = src(uv);
  if (uOvOn > 0.5) {
    vec4 o = texture2D(uOv, uv);
    c = mix(c, o.rgb, o.a);
  }
  if (uWipe >= 0.0) {
    // the replay wipe: a leaning band sweeps across; the cut happens while it covers the frame
    float x = uv.x + (uv.y - 0.5) * 0.28;
    float d = (-0.25 + uWipe * 3.1) - x;
    if (d > 0.0 && d < 1.6) {
      vec3 dark = mix(vec3(0.045, 0.052, 0.07), vec3(0.075, 0.082, 0.105), d / 1.6);
      vec3 b = d < 0.045 ? uAccent : d < 0.052 ? vec3(0.92) : d < 1.56 ? dark : uAccent;
      float a = smoothstep(0.0, 0.003, d) * (1.0 - smoothstep(1.597, 1.6, d));
      c = mix(c, b, a);
    }
  }
  // a whisper of noise so the encoder doesn't band the sky
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c = c * uFade + n / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

/** the last pass: into the 8-bit output (and the poster), upside down for the read-back */
class OutPass extends Pass {
  poster = false;
  constructor(
    readonly mat: THREE.ShaderMaterial,
    readonly out: THREE.WebGLRenderTarget,
    readonly posterRT: THREE.WebGLRenderTarget,
  ) {
    super('HighlightOut');
    this.fullscreenMaterial = mat;
    this.needsSwap = false;
  }
  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget | null) {
    if (inputBuffer) this.draw(renderer, inputBuffer.texture, true);
  }
  draw(renderer: THREE.WebGLRenderer, tex: THREE.Texture, linear: boolean) {
    const u = this.mat.uniforms;
    u.uSrc.value = tex;
    u.uEncode.value = linear ? 1 : 0;
    u.uBox.value = 0;
    renderer.setRenderTarget(this.out);
    renderer.render(this.scene, this.camera);
    if (this.poster) {
      // a clean still (no graphics, no wipe), box-filtered to half size
      const ov = u.uOvOn.value, wipe = u.uWipe.value, fade = u.uFade.value;
      u.uOvOn.value = 0;
      u.uWipe.value = -1;
      u.uFade.value = 1;
      u.uBox.value = 1;
      (u.uTexel.value as THREE.Vector2).set(1 / this.out.width, 1 / this.out.height);
      renderer.setRenderTarget(this.posterRT);
      renderer.render(this.scene, this.camera);
      u.uOvOn.value = ov;
      u.uWipe.value = wipe;
      u.uFade.value = fade;
      u.uBox.value = 0;
    }
  }
}

interface StudioCar {
  rig: CarRig;
  view: CarView;
  key: string;
  destroyed: boolean;
  compound: string;
}

interface Slot {
  pbo: WebGLBuffer;
  bytes: number;
  fence: WebGLSync | null;
  meta: Readback | null;
  buf: Uint8Array;
}

export class Studio {
  readonly W: number;
  readonly H: number;
  readonly fps: number;
  /** the studio's own cars (shown only while a studio frame renders) */
  readonly group = new THREE.Group();
  private readonly host: StudioHost;
  private readonly cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 30000);
  private composer: EffectComposer | null = null;
  private out!: OutPass;
  private dof!: DepthOfFieldEffect;
  private dofPass!: EffectPass;
  private grade!: GradeEffect;
  private outRT!: THREE.WebGLRenderTarget;
  private posterRT!: THREE.WebGLRenderTarget;
  private captureRT!: THREE.WebGLRenderTarget;
  private cams: Cameras | null = null;
  private camsTrack: Track | null = null;
  private readonly director = new Director();
  private readonly cars = new Map<Entry, StudioCar>();
  private readonly ovCanvas: HTMLCanvasElement;
  private readonly ovCtx: CanvasRenderingContext2D;
  private readonly ovTex: THREE.CanvasTexture;
  private ovKey = '';
  private readonly slots: Slot[] = [];
  private readonly queue: Slot[] = [];
  private posterSlot: Slot | null = null;
  private field: FieldCar[] = [];
  private pov: CarRig | null = null;
  private focus = 0;
  private rendering = false;
  private readonly tmp = new THREE.Vector3();
  /** ms the last studio frame took on the CPU */
  lastMs = 0;
  /** dev: where a studio frame's CPU time goes (ms, smoothed) and read-back counts */
  readonly prof: Record<string, number> = { cars: 0, world: 0, render: 0, read: 0, reads: 0, writes: 0, failed: 0 };
  private lap(k: string, t: number): number {
    const n = performance.now();
    this.prof[k] = this.prof[k] * 0.9 + (n - t) * 0.1;
    return n;
  }

  constructor(host: StudioHost, W = 1280, H = 720, fps = 30) {
    this.host = host;
    this.W = W;
    this.H = H;
    this.fps = fps;
    this.group.name = 'highlight-studio';
    this.group.visible = false;
    this.ovCanvas = document.createElement('canvas');
    this.ovCanvas.width = W;
    this.ovCanvas.height = H;
    this.ovCtx = this.ovCanvas.getContext('2d')!;
    this.ovTex = new THREE.CanvasTexture(this.ovCanvas);
    this.ovTex.colorSpace = THREE.NoColorSpace;
    this.ovTex.minFilter = THREE.LinearFilter;
    this.ovTex.generateMipmaps = false;
    // the studio cars cast their cheap far-LOD shadow unless close, like the live ones
    host.gfx.onShadowPass((on) => {
      if (!this.rendering) return;
      for (const c of this.cars.values()) c.rig.shadowPass?.(on, c.rig === this.focusRig);
    });
  }
  private focusRig: CarRig | null = null;
  private sunsOf: Environment | null = null;
  private sunList: THREE.DirectionalLight[] = [];

  /** the post chain and targets, made on first use */
  private ensure() {
    if (this.composer) return;
    const r = this.host.gfx.renderer;
    const { W, H } = this;
    if (!this.group.parent) this.host.scene.add(this.group);
    const rtOpts = { depthBuffer: false, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false } as const;
    this.outRT = new THREE.WebGLRenderTarget(W, H, rtOpts);
    this.posterRT = new THREE.WebGLRenderTarget(W / 2, H / 2, rtOpts);
    this.captureRT = new THREE.WebGLRenderTarget(W, H, rtOpts);
    const composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 4 });
    composer.autoRenderToScreen = false;
    composer.addPass(new RenderPass(this.host.scene, this.cam));
    this.dof = new DepthOfFieldEffect(this.cam, { focusDistance: 8, focusRange: 5, bokehScale: 2.5, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(this.cam, this.dof);
    this.dofPass.enabled = false;
    composer.addPass(this.dofPass);
    this.grade = new GradeEffect();
    const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.1, luminanceSmoothing: 0.35, intensity: 0.9, radius: 0.72 });
    composer.addPass(new EffectPass(this.cam, bloom, this.grade, new ToneMappingEffect({ mode: ToneMappingMode.AGX }), new VignetteEffect({ darkness: 0.38, offset: 0.3 })));
    const mat = new THREE.ShaderMaterial({
      vertexShader: OUT_VERT,
      fragmentShader: OUT_FRAG,
      uniforms: {
        uSrc: { value: null },
        uOv: { value: this.ovTex },
        uOvOn: { value: 0 },
        uEncode: { value: 1 },
        uWipe: { value: -1 },
        uFade: { value: 1 },
        uBox: { value: 0 },
        uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
        uAccent: { value: new THREE.Color(1.0, 0.169, 0.247) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.out = new OutPass(mat, this.outRT, this.posterRT);
    composer.addPass(this.out);
    // sized to the clip, not the canvas (EffectComposer.setSize would resize the canvas)
    composer.inputBuffer.setSize(W, H);
    composer.outputBuffer.setSize(W, H);
    (composer as unknown as { depthRenderTarget: THREE.WebGLRenderTarget | null }).depthRenderTarget?.setSize(W, H);
    for (const p of composer.passes) p.setSize(W, H);
    this.composer = composer;
    this.cam.aspect = W / H;
    this.cam.updateProjectionMatrix();
    const gl = r.getContext() as WebGL2RenderingContext;
    for (let i = 0; i < 4; i++) this.slots.push(this.slot(gl, W, H));
    this.posterSlot = this.slot(gl, W / 2, H / 2);
  }

  private slot(gl: WebGL2RenderingContext, w: number, h: number): Slot {
    const pbo = gl.createBuffer()!;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return { pbo, bytes: w * h * 4, fence: null, meta: null, buf: new Uint8Array(w * h * 4) };
  }

  /** a read-back slot is free for another frame */
  get canRender(): boolean {
    return !this.composer || this.slots.some((s) => !s.meta);
  }

  get freeSlots(): number {
    return this.composer ? this.slots.filter((s) => !s.meta).length : 4;
  }

  get busy(): boolean {
    return this.queue.length > 0;
  }

  /** make (or re-paint) the studio cars for a race; a couple per call. true when all are ready */
  prepare(info: RaceInfo, perCall = 2): boolean {
    this.ensure();
    let made = 0;
    const env = this.host.scene.environment;
    for (const c of info.cars) {
      const key = this.host.rigKey(c.entry);
      const have = this.cars.get(c.entry);
      if (have && have.key === key) continue;
      if (made >= perCall) return false;
      if (have) {
        have.rig.root.removeFromParent();
        have.rig.dispose();
      }
      const rig = this.host.makeRig(c.entry);
      rig.setEnvMap?.(env);
      this.group.add(rig.root);
      this.cars.set(c.entry, { rig, view: new CarView(rig), key, destroyed: false, compound: '' });
      made++;
    }
    return true;
  }

  private carOf(info: RaceInfo, id: number): StudioCar | undefined {
    const c = info.cars[id];
    return c ? this.cars.get(c.entry) : undefined;
  }

  private fieldAt(info: RaceInfo): FieldCar[] {
    const R = info.replay;
    const n = info.cars.length;
    while (this.field.length < n) this.field.push({ id: this.field.length, s: 0, speed: 0, position: 1, pit: false, out: false, finished: false });
    this.field.length = n;
    for (let k = 0; k < n; k++) {
      const o = this.field[k];
      const fl = R.flags[k];
      o.id = k;
      o.s = R.ghosts[k].s;
      o.speed = Math.max(0, R.ghosts[k].vx);
      o.position = R.pos[k] || k + 1;
      o.pit = (fl & RF.pit) !== 0;
      o.out = (fl & (RF.retired | RF.removed)) !== 0;
      o.finished = (fl & RF.finished) !== 0;
    }
    return this.field;
  }

  private camerasFor(track: Track): Cameras {
    if (!this.cams || this.camsTrack !== track) {
      this.cams = new Cameras(this.cam, track);
      this.camsTrack = track;
    }
    return this.cams;
  }

  /**
   * Start a shot: the camera the director would use for it (a fixed one if the plan names a
   * trackside camera that covers the car there). Returns the car and camera chosen.
   */
  beginShot(info: RaceInfo, shot: ShotPlan): { focus: number; mode: CameraMode } {
    const w = this.host.world();
    if (!w) return { focus: shot.focus, mode: 'tv' };
    const cams = this.camerasFor(w.track);
    const R = info.replay;
    R.apply(shot.t0, w.track.length);
    const field = this.fieldAt(info);
    let mode: CameraMode | null = null;
    let focus = shot.focus;
    const s = R.ghosts[focus]?.s ?? 0;
    if (shot.mode) {
      const g = CAMERA_GROUP[shot.mode];
      if (g !== 'trackside' || cams.covers(shot.mode, s)) mode = shot.mode;
    }
    if (!mode) {
      mode = this.director.pickShot(focus, shot.ctx, field, cams, w.track, R.raceTime, shot.groups ?? ['trackside']);
      focus = this.director.focus;
    }
    cams.set(mode);
    cams.cut();
    // the halo POV hides the driver whose helmet the lens is in
    if (this.pov) this.pov.setDriverVisible(true);
    this.pov = null;
    if (mode === 'cockpit') {
      const c = this.carOf(info, focus);
      if (c) {
        c.rig.setDriverVisible(false);
        this.pov = c.rig;
      }
    }
    this.focus = focus;
    return { focus, mode };
  }

  /** the camera caption for the graphics */
  caption(mode: CameraMode, info: RaceInfo, focus: number): { camera: string; sub: string } {
    const where = this.cams?.where ?? '';
    const code = info.cars[focus]?.code ?? '';
    return { camera: CAMERA_LABEL[mode], sub: CAMERA_GROUP[mode] === 'trackside' && where ? where : code };
  }

  /**
   * Render the recording at time t (seconds of session; dt = replay time since the last frame)
   * with the given graphics, and queue the picture for read-back. False if it couldn't render.
   */
  renderFrame(info: RaceInfo, t: number, dt: number, meta: Readback, overlay: (() => OverlayState | null) | null, wipe: number, fade: number, poster: boolean): boolean {
    const w = this.host.world();
    if (!w || !this.composer) return false;
    const slot = this.slots.find((s) => !s.meta);
    if (!slot) return false;
    const t0 = performance.now();
    const gfx = this.host.gfx;
    const r = gfx.renderer;
    const R = info.replay;
    const track = w.track;
    const cams = this.camerasFor(track);
    let tl = t0;
    R.apply(t, track.length);

    // the cars, from the recording
    const rain = info.weather.wetness > 0.22 || info.weather.rain > 0.08 || info.weather.fog > 0.85 || info.weather.time === 'night';
    const focusCar = this.carOf(info, this.focus);
    this.focusRig = focusCar?.rig ?? null;
    for (const c of info.cars) {
      const sc = this.cars.get(c.entry);
      if (!sc) continue;
      const fl = R.flags[c.id];
      const vis = (fl & RF.removed) === 0;
      sc.rig.root.visible = vis;
      if (!vis) continue;
      if (sc.compound !== c.compound) {
        sc.compound = c.compound;
        (sc.rig as CarRig & { setCompound?: (x: string) => void }).setCompound?.(c.compound);
      }
      const wreck = (fl & RF.destroyed) !== 0;
      if (wreck !== sc.destroyed) {
        sc.destroyed = wreck;
        sc.rig.setDamage(wreck ? { fwL: 1, fwR: 1, rw: 1 } : { fwL: 0, fwR: 0, rw: 0 }, wreck ? [0.6, 0.6, 0.6, 0.6] : [0, 0, 0, 0], wreck ? 0.85 : 0);
      }
      sc.view.sync(R.ghosts[c.id], track, dt, this.cam.position, c.id === this.focus, rain);
    }
    if (focusCar) cams.update(dt, R.ghosts[this.focus], focusCar.rig, track);
    tl = this.lap('cars', tl);

    // the graphics (redrawn and re-uploaded only when they change)
    const ov = overlay ? overlay() : null;
    const u = this.out.mat.uniforms;
    u.uOvOn.value = ov ? 1 : 0;
    if (ov) this.setOverlay(ov);
    u.uWipe.value = wipe;
    u.uFade.value = fade;
    this.out.poster = poster;

    // the world around this camera (the live frame puts it back before its own render)
    const hidden: THREE.Object3D[] = [];
    for (const o of this.host.liveObjects()) {
      if (o && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    }
    this.group.visible = true;
    suppressFloods(false);
    w.trackside.startLights.set(R.phase === 1 ? R.lightsLit : 0);
    w.env.update(dt, this.cam);
    const fp = focusCar ? focusCar.rig.root.getWorldPosition(this.tmp) : this.cam.position;
    w.env.focusShadow(fp);
    w.trackside.update(0, this.cam);
    w.pits.update(0, this.cam);
    if (this.sunsOf !== w.env) {
      this.sunsOf = w.env;
      this.sunList = [];
      this.host.scene.traverse((o) => {
        const l = o as THREE.DirectionalLight;
        if (l.isDirectionalLight && l.castShadow) this.sunList.push(l);
      });
    }
    // (the garage freezes the sun's shadow map; this camera needs its own)
    const suns = this.sunList.filter((l) => !l.shadow.autoUpdate);
    for (const l of suns) l.shadow.needsUpdate = true;
    // the look: the weather grade from the live chain; a long lens's focus pull
    const gu = this.grade.uniforms, lu = gfx.grade.uniforms;
    for (const k of ['lookExposure', 'lookSaturation', 'lookContrast', 'flash']) gu.get(k)!.value = lu.get(k)!.value;
    (gu.get('lookTint')!.value as THREE.Vector3).copy(lu.get('lookTint')!.value as THREE.Vector3);
    (gu.get('lookShadowTint')!.value as THREE.Vector3).copy(lu.get('lookShadowTint')!.value as THREE.Vector3);
    const lens = cams.lensDof;
    this.dofPass.enabled = lens;
    if (lens) {
      this.dof.target = cams.tvFocus;
      (this.dof.cocMaterial as unknown as { focusRange: number }).focusRange = cams.tvRange;
      this.dof.bokehScale = cams.tvDof;
    }

    tl = this.lap('world', tl);
    this.rendering = true;
    try {
      const upd = (gfx as unknown as { updateScene?: () => void }).updateScene;
      if (upd) upd.call(gfx);
      else this.host.scene.updateMatrixWorld();
      this.cam.updateMatrixWorld();
      this.composer.render(Math.max(1e-4, dt));
      tl = this.lap('render', tl);
      this.read(slot, this.outRT, meta);
      tl = this.lap('read', tl);
      if (poster && this.posterSlot && !this.posterSlot.meta) this.read(this.posterSlot, this.posterRT, { kind: 'poster', index: meta.index, w: this.W / 2, h: this.H / 2, tag: meta.tag });
    } finally {
      this.rendering = false;
      this.out.poster = false;
      for (const o of hidden) o.visible = true;
      this.group.visible = false;
      // the menu's sun shadow is frozen: it must be drawn again for the live view
      for (const l of suns) l.shadow.needsUpdate = true;
      r.setRenderTarget(null);
    }
    this.lastMs = performance.now() - t0;
    return true;
  }

  /**
   * Capture the frame the game just drew on its canvas (the podium), cover-cropped to 16:9,
   * with the given graphics. False if no read-back slot is free.
   */
  captureCanvas(meta: Readback, ov: OverlayState | null, fade: number): boolean {
    this.ensure();
    const slot = this.slots.find((s) => !s.meta);
    if (!slot) return false;
    const r = this.host.gfx.renderer;
    const gl = r.getContext() as WebGL2RenderingContext;
    const cw = gl.drawingBufferWidth, ch = gl.drawingBufferHeight;
    const ar = this.W / this.H;
    let sw = cw, sh = ch, sx = 0, sy = 0;
    if (cw / ch > ar) {
      sw = Math.round(ch * ar);
      sx = Math.round((cw - sw) / 2);
    } else {
      sh = Math.round(cw / ar);
      sy = Math.round((ch - sh) / 2);
    }
    r.setRenderTarget(this.captureRT);
    const fb = (r.properties.get(this.captureRT) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer;
    if (!fb) {
      r.setRenderTarget(null);
      return false;
    }
    r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
    gl.blitFramebuffer(sx, sy, sx + sw, sy + sh, 0, 0, this.W, this.H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    r.state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    r.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    const u = this.out.mat.uniforms;
    u.uOvOn.value = ov ? 1 : 0;
    if (ov) this.setOverlay(ov);
    u.uWipe.value = -1;
    u.uFade.value = fade;
    this.out.poster = false;
    this.out.draw(r, this.captureRT.texture, false);
    this.read(slot, this.outRT, meta);
    r.setRenderTarget(null);
    return true;
  }

  /** also read a poster still with the next captured frame */
  capturePoster(meta: Readback, fade: number): boolean {
    if (!this.posterSlot || this.posterSlot.meta) return false;
    const r = this.host.gfx.renderer;
    const u = this.out.mat.uniforms;
    u.uFade.value = fade;
    this.out.poster = true;
    this.out.draw(r, this.captureRT.texture, false);
    this.out.poster = false;
    this.read(this.posterSlot, this.posterRT, meta);
    r.setRenderTarget(null);
    return true;
  }

  private setOverlay(ov: OverlayState) {
    const key = overlayKey(ov);
    if (key === this.ovKey) return;
    this.ovKey = key;
    drawOverlay(this.ovCtx, this.W, this.H, ov);
    this.ovTex.needsUpdate = true;
  }

  private read(slot: Slot, rt: THREE.WebGLRenderTarget, meta: Readback) {
    const r = this.host.gfx.renderer;
    const gl = r.getContext() as WebGL2RenderingContext;
    r.setRenderTarget(rt);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, slot.pbo);
    gl.readPixels(0, 0, rt.width, rt.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    slot.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    slot.meta = meta;
    this.prof.writes++;
    this.queue.push(slot);
  }

  /** hand over every read-back that has arrived, in order (the pixels are only valid during the call) */
  poll(cb: (px: Uint8Array, meta: Readback) => void) {
    if (!this.queue.length) return;
    const gl = this.host.gfx.renderer.getContext() as WebGL2RenderingContext;
    while (this.queue.length) {
      const s = this.queue[0];
      if (!s.fence) {
        this.queue.shift();
        continue;
      }
      const st = gl.clientWaitSync(s.fence, 0, 0);
      if (st === gl.TIMEOUT_EXPIRED) break;
      gl.deleteSync(s.fence);
      s.fence = null;
      this.queue.shift();
      const meta = s.meta!;
      s.meta = null;
      if (st === gl.WAIT_FAILED) {
        this.prof.failed++;
        continue;
      }
      this.prof.reads++;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, s.pbo);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, s.buf);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      cb(s.buf, meta);
    }
  }

  /** the shot is over: give the halo-POV driver his helmet back */
  endShots() {
    this.pov?.setDriverVisible(true);
    this.pov = null;
  }

  dispose() {
    this.endShots();
    const gl = this.host.gfx.renderer.getContext() as WebGL2RenderingContext;
    for (const s of [...this.slots, ...(this.posterSlot ? [this.posterSlot] : [])]) {
      if (s.fence) gl.deleteSync(s.fence);
      gl.deleteBuffer(s.pbo);
    }
    this.slots.length = 0;
    this.queue.length = 0;
    this.posterSlot = null;
    this.composer?.dispose();
    this.composer = null;
    this.outRT?.dispose();
    this.posterRT?.dispose();
    this.captureRT?.dispose();
    this.ovTex.dispose();
    for (const c of this.cars.values()) {
      c.rig.root.removeFromParent();
      c.rig.dispose();
    }
    this.cars.clear();
    this.group.removeFromParent();
  }
}
