import * as THREE from 'three';
import { BloomEffect, Effect, EffectComposer, EffectPass, FXAAEffect, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { GradeEffect } from '../../marbles/post-grade.ts';
import { MAPS, TIMES, type MapLook, type TimeLook } from './looks.ts';

/**
 * The renderer and the night: a floodlit stadium under a deep sky. One key light (high, from the
 * light rings, the only shadow caster so the ball's shadow sits straight under it like the real
 * game's), sky and pitch bounce, an image light baked from a little scene of the floodlight banks so
 * the paint and the ball pick up long highlights, then bloom, a filmic curve, the grade.
 *
 * Quality: ?gfx=high|medium|low pins it; integrated GPUs start on medium; otherwise the resolution
 * scale follows the frame rate.
 *
 * Safety: the first pass clamps the scene to finite values (Direct3D turns pow() of a hair-negative
 * base into NaN, and bloom smears one NaN pixel over the whole screen), a lost context is waited out,
 * and a watchdog that finds the frame pure black falls back to a plain render without post.
 */

/** max/min return the other operand for NaN on D3D11 and desktop GL, so this flushes NaN and inf */
class SanitizeEffect extends Effect {
  constructor() {
    super('SanitizeEffect', 'void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){ outputColor = vec4(min(max(inputColor.rgb, vec3(0.0)), vec3(64.0)), clamp(inputColor.a, 0.0, 1.0)); }');
  }
}

export const S = 0.01; // cm → m
export const KEY_DIR = new THREE.Vector3(0.25, 1, 0.35).normalize();

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly key: THREE.DirectionalLight;
  readonly bloom: BloomEffect;
  ao: N8AOPostPass | null = null;
  readonly gpu: string;
  /** the context is gone (driver reset); nothing renders until it's back */
  lost = false;
  onRestored: (() => void) | null = null;
  /** post disabled after the watchdog saw a black frame */
  safe = false;
  /** the game says the camera should be looking at something lit */
  expectLit = false;
  private blackRuns = 0;
  private hemi: THREE.HemisphereLight;
  private fill: THREE.DirectionalLight;
  private skyU = {
    uTime: { value: 0 },
    uSun: { value: KEY_DIR.clone() },
    uZen: { value: new THREE.Color() },
    uHor: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uSunCol: { value: new THREE.Color() },
    uDisc: { value: 1 },
    uCloud: { value: 0.5 },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uStars: { value: 0 },
    /** a dome of light over a city (night) */
    uCity: { value: 0 },
  };
  private skyMat!: THREE.ShaderMaterial;
  private envCache = new Map<string, THREE.Texture>();
  day = true;
  look: TimeLook = TIMES.day;
  map: MapLook = MAPS.apex;
  private checkT = 0;
  readonly flash: THREE.PointLight;
  quality: 0 | 1 | 2 = 2;
  autoQuality = true;
  scale = 1;
  private slow = 0;
  private fast = 0;
  private frameAvg = 16;

  constructor(readonly canvas: HTMLCanvasElement) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    const gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/intel|mali|adreno|powervr|swiftshader|llvmpipe|microsoft basic/i.test(this.gpu)) this.quality = 1;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      console.warn('[boost] WebGL context lost');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      console.warn('[boost] WebGL context restored');
      this.resize();
      this.onRestored?.();
    });
    const q = new URLSearchParams(location.search).get('gfx');
    if (q === 'low' || q === 'medium' || q === 'high') {
      this.quality = q === 'low' ? 0 : q === 'medium' ? 1 : 2;
      this.autoQuality = false;
    }

    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 5000);
    const sc = this.scene;
    sc.fog = new THREE.FogExp2(0x0a1430, 0.0026);
    sc.environmentIntensity = 0.75;

    this.hemi = new THREE.HemisphereLight(0x8fb4ff, 0x1d3a16, 0.55);
    sc.add(this.hemi);
    const key = (this.key = new THREE.DirectionalLight(0xf2f5ff, 2.6));
    key.position.copy(KEY_DIR).multiplyScalar(120);
    key.target.position.set(0, 0, 0);
    key.castShadow = true;
    const sz = this.quality === 2 ? 4096 : 2048;
    key.shadow.mapSize.set(sz, sz);
    const cam = key.shadow.camera;
    cam.left = -48;
    cam.right = 48;
    cam.top = 64;
    cam.bottom = -64;
    cam.near = 60;
    cam.far = 200;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 2.5;
    sc.add(key, key.target);
    // a warm fill from the opposite light ring (no shadows)
    const fill = (this.fill = new THREE.DirectionalLight(0xffe2c4, 0.7));
    fill.position.set(-30, 60, -50);
    sc.add(fill);
    // the goal flash
    this.flash = new THREE.PointLight(0xffffff, 0, 60, 1.6);
    sc.add(this.flash);

    sc.add(this.sky());

    const comp = (this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    comp.addPass(new RenderPass(sc, this.camera));
    // ambient occlusion: the car's arches and underside, the seams of the stands, contact with the pitch
    if (this.quality > 0) {
      const ao = (this.ao = new N8AOPostPass(sc, this.camera, 1, 1));
      ao.configuration.aoRadius = 0.9;
      ao.configuration.distanceFalloff = 0.6;
      ao.configuration.intensity = 2.2;
      ao.configuration.gammaCorrection = false;
      ao.configuration.halfRes = this.quality < 2;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.color = new THREE.Color(0x05070c);
      ao.setQualityMode(this.quality === 2 ? 'Medium' : 'Performance');
      // (the particles, glass and nets are far from any crease)
      (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
      ao.configuration.transparencyAware = false;
      comp.addPass(ao);
    }
    this.bloom = new BloomEffect({ intensity: 1.15, luminanceThreshold: 0.78, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72, levels: this.quality === 2 ? 8 : 5 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const grade = new GradeEffect({ vibrance: 0.22, contrast: 0.12, lift: 0.01 });
    const vig = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
    // SMAA (three passes) on real GPUs, FXAA (one) on integrated ones
    const aa = this.quality === 2 ? new SMAAEffect({ preset: SMAAPreset.HIGH }) : new FXAAEffect();
    comp.addPass(new EffectPass(this.camera, new SanitizeEffect()));
    // the AA samples its input, so it leads the merged pass
    comp.addPass(new EffectPass(this.camera, aa, this.bloom, tone, grade, vig));
    this.setLook(TIMES.day, MAPS.apex);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** a time of day (and the arena, for the image light and the city glow) */
  setLook(t: TimeLook, map: MapLook = this.map): void {
    this.look = t;
    this.map = map;
    this.day = t.day > 0.5;
    const sc = this.scene;
    const u = this.skyU;
    u.uSun.value.set(...t.keyDir);
    u.uZen.value.setRGB(...t.zenith);
    u.uHor.value.setRGB(...t.horizon);
    u.uGlow.value.setRGB(...t.glow);
    u.uSunCol.value.setRGB(...t.sunCol);
    u.uDisc.value = t.disc;
    u.uCloud.value = t.cloud;
    u.uCloudLit.value.setRGB(...t.cloudLit);
    u.uCloudShade.value.setRGB(...t.cloudShade);
    u.uStars.value = t.stars * (map.surround === 'city' ? 0.35 : 1);
    u.uCity.value = map.surround === 'city' ? 1 - t.day : 0;
    const fog = sc.fog as THREE.FogExp2;
    fog.color.setRGB(...t.fog);
    fog.density = t.fogDensity;
    this.hemi.color.setRGB(...t.hemiSky);
    this.hemi.groundColor.setRGB(...t.hemiGround);
    this.hemi.intensity = t.hemiI;
    this.key.color.setRGB(...t.keyCol);
    this.key.intensity = t.keyI;
    // the shadow camera stays on the pitch whichever way the light comes from
    this.key.position.set(...t.keyDir).multiplyScalar(150);
    this.key.shadow.camera.near = 40;
    this.key.shadow.camera.far = 320;
    const r = Math.max(64, 64 / Math.max(0.35, t.keyDir[1]));
    this.key.shadow.camera.top = r;
    this.key.shadow.camera.bottom = -r;
    this.key.shadow.camera.left = -r;
    this.key.shadow.camera.right = r;
    this.key.shadow.camera.updateProjectionMatrix();
    this.fill.color.setRGB(...t.fillCol);
    this.fill.intensity = t.fillI;
    this.bloom.intensity = t.bloom;
    this.bloom.luminanceMaterial.threshold = t.bloomThreshold;
    sc.environment = this.envFor(t, map);
    sc.environmentIntensity = t.envI;
  }

  /** the old two-way switch */
  setDay(day: boolean): void {
    this.setLook(day ? TIMES.day : TIMES.night);
  }

  private envFor(t: TimeLook, map: MapLook): THREE.Texture {
    const k = t.id + '/' + map.id;
    let e = this.envCache.get(k);
    if (!e) {
      e = this.envMap(t, map);
      this.envCache.set(k, e);
    }
    return e;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, this.quality === 2 ? 2 : 1) * this.scale * (this.quality === 0 ? 0.7 : 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** horizontal field of view in degrees (the real game's camera setting is horizontal) */
  setHFov(deg: number): void {
    const a = this.camera.aspect;
    const v = 2 * Math.atan(Math.tan((deg * Math.PI) / 360) / a);
    this.camera.fov = Math.max(50, Math.min(100, (v * 180) / Math.PI));
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    if (this.lost) return;
    this.skyU.uTime.value += dt;
    if (this.safe) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.render(this.scene, this.camera);
    } else this.composer.render(dt);
    this.watch(dt);
    // (a frame over 100 ms is a hitch or a throttled background window, not the GPU's pace)
    if (!this.autoQuality || dt > 0.1) return;
    this.frameAvg += (dt * 1000 - this.frameAvg) * 0.05;
    if (this.frameAvg > 21) {
      this.slow += dt;
      this.fast = 0;
    } else if (this.frameAvg < 15) {
      this.fast += dt;
      this.slow = 0;
    }
    if (this.slow > 1.5 && this.scale > 0.55) {
      this.scale = Math.max(0.55, this.scale - 0.1);
      this.slow = 0;
      this.resize();
    } else if (this.fast > 4 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.fast = 0;
      this.resize();
    }
  }

  /** once a second read three pixels of the finished frame; pure black three times running = broken post */
  private watch(dt: number): void {
    this.checkT += dt;
    if (this.safe || this.checkT < 1) return;
    this.checkT = 0;
    if (!this.expectLit) {
      this.blackRuns = 0;
      return;
    }
    const gl = this.renderer.getContext();
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const px = new Uint8Array(4);
    let sum = 0;
    for (const [fx, fy] of [[0.5, 0.3], [0.2, 0.25], [0.8, 0.25]]) {
      gl.readPixels(Math.floor(w * fx), Math.floor(h * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      sum += px[0] + px[1] + px[2];
    }
    this.blackRuns = sum < 4 ? this.blackRuns + 1 : 0;
    if (this.blackRuns >= 3) {
      this.safe = true;
      console.warn('[boost] black frames from the post chain; falling back to a plain render');
    }
  }

  /** the image light: this sky, the stands as a band round the horizon, floodlights when on, the pitch */
  private envMap(t: TimeLook, map: MapLook): THREE.Texture {
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.skyMat));
    const dk = t.day;
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(44, 44, map.tiers === 2 ? 18 : 8, 32, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.014, 0.02).lerp(new THREE.Color(map.snow ? 0x8c9096 : 0x3c3a3e), dk), side: THREE.BackSide }),
    );
    band.position.y = map.tiers === 2 ? 6 : 1;
    es.add(band);
    // the stands' two halves in team colour, and the LED ribbons along the fascia and the roof edge:
    // long bright lines that the clear coat catches as crisp highlight bands
    for (const [col, a0] of [
      [new THREE.Color(0.05, 0.12, 0.42), -Math.PI / 2],
      [new THREE.Color(0.45, 0.16, 0.03), Math.PI / 2],
    ] as [THREE.Color, number][]) {
      const half = new THREE.Mesh(
        new THREE.CylinderGeometry(43.5, 43.5, map.tiers === 2 ? 10 : 5, 24, 1, true, a0, Math.PI),
        new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.35 + 0.65 * dk), side: THREE.BackSide }),
      );
      half.position.y = map.tiers === 2 ? 4 : 1;
      es.add(half);
    }
    const led = (y: number, h: number, c: THREE.Color) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(42.5, 42.5, h, 48, 1, true), new THREE.MeshBasicMaterial({ color: c, side: THREE.BackSide }));
      m.position.y = y;
      es.add(m);
    };
    led(-1.2, 0.5, new THREE.Color(2.2, 2.4, 3.0));
    if (map.tiers === 2) led(map.roof ? 15.5 : 14, 0.7, new THREE.Color(3.2, 3.3, 3.6));
    // big soft panels high up (the roof's underside lit, or the open sky's brightest part)
    const soft = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.65, 1.8).multiplyScalar(0.6 + 0.6 * dk), side: THREE.DoubleSide });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(16, 3), soft);
      m.position.set(Math.cos(a) * 30, 30, Math.sin(a) * 30);
      m.lookAt(0, 0, 0);
      es.add(m);
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x0f2a12).lerp(new THREE.Color(0x2e5a1c), dk) }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -4;
    es.add(floor);
    if (t.floods) {
      const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6.4).multiplyScalar(1 - 0.6 * dk) });
      const n = map.lights === 'masts' ? 4 : 12;
      for (let i = 0; i < n; i++) {
        const a = ((i + (n === 4 ? 0.5 : 0)) / n) * Math.PI * 2;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(n === 4 ? 14 : 9, n === 4 ? 6 : 2.2), lamp);
        m.position.set(Math.cos(a) * 40, n === 4 ? 30 : 22, Math.sin(a) * 40);
        m.lookAt(0, 0, 0);
        es.add(m);
      }
      if (map.lights === 'ring') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(42, 0.6, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.5, 1.8).multiplyScalar(1 - 0.6 * dk) }));
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 30;
        es.add(ring);
      }
    }
    const pm = new THREE.PMREMGenerator(this.renderer);
    const rt = pm.fromScene(es, 0.02);
    pm.dispose();
    return rt.texture;
  }

  /** the sky for any time: a gradient dome with a horizon glow, the sun, drifting cumulus, stars */
  private sky(): THREE.Mesh {
    const m = (this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyU,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }',
      fragmentShader: `uniform float uTime; uniform vec3 uSun; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uGlow; uniform vec3 uSunCol;
        uniform float uDisc; uniform float uCloud; uniform vec3 uCloudLit; uniform vec3 uCloudShade; uniform float uStars; uniform float uCity;
        varying vec3 vP;
        float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float a = 0.5, v = 0.0; for (int k = 0; k < 5; k++){ v += a*n2(p); p = p*2.03 + 7.1; a *= 0.5; } return v; }
        void main(){ vec3 d = normalize(vP); float h = d.y;
          float hp = max(h, 0.0);
          float sd = max(dot(d, uSun), 0.0);
          // the dome: zenith to horizon, the glow lying on the horizon (strongest toward the sun)
          vec3 c = mix(uHor, uZen, smoothstep(0.0, 0.6, pow(hp, 0.8)));
          float toward = pow(max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-4), normalize(vec3(uSun.x, 0.0, uSun.z) + 1e-4)), 0.0), 3.0);
          c += uGlow * exp(-hp * 7.0) * (0.25 + 0.75 * toward) * 0.55;
          // a city's light dome
          c += vec3(0.32, 0.2, 0.3) * exp(-hp * 5.0) * uCity * 0.5;
          // the sun's halo and disc
          c += uSunCol * (pow(sd, 8.0) * 0.45 + pow(sd, 64.0) * 0.5);
          // stars
          vec2 sp = vec2(atan(d.z,d.x)*120., h*240.);
          vec2 id = floor(sp); vec2 f = fract(sp)-0.5;
          float st = step(0.985, h21(id)) * (1.0 - smoothstep(0.0, 0.2, length(f))) * smoothstep(0.05,0.4,h);
          c += vec3(0.9,0.95,1.0) * st * (0.4 + 0.6*h21(id+3.1)) * uStars;
          // cumulus, drifting: lit toward the sun, shaded underneath
          vec2 cp = d.xz / max(h + 0.12, 0.05) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
          float thr = mix(0.78, 0.42, uCloud);
          float cl = smoothstep(thr, thr + 0.24, fbm(cp)) * smoothstep(0.01, 0.2, h);
          float shade = fbm(cp + vec2(0.35, 0.2));
          vec3 cloudC = mix(uCloudShade, uCloudLit, smoothstep(0.3, 0.75, shade)) * (1.0 + pow(sd, 5.0) * 0.8);
          // (edges near the sun glow with it)
          cloudC += uSunCol * pow(sd, 14.0) * (1.0 - cl) * 1.5;
          c = mix(c, cloudC, cl * 0.92);
          c += uSunCol * pow(sd, 1600.0) * uDisc * (1.0 - cl * 0.85);
          // below the horizon: the ground's shade
          c = mix(c, uHor * 0.35, smoothstep(0.0, -0.15, h));
          gl_FragColor = vec4(c, 1.); }`,
    }));
    const s = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), m);
    s.renderOrder = -10;
    s.frustumCulled = false;
    return s;
  }
}

/** sim (cm, z up) → three (m, y up) */
export function toThree(x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(x * S, z * S, -y * S);
}
