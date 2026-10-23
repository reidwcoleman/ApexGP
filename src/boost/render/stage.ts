import * as THREE from 'three';
import { BloomEffect, Effect, EffectComposer, EffectPass, FXAAEffect, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { GradeEffect } from '../../marbles/post-grade.ts';

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
  private skyU = { uTime: { value: 0 }, uDay: { value: 1 }, uSun: { value: KEY_DIR.clone() } };
  private envDay: THREE.Texture;
  private envNight: THREE.Texture;
  day = true;
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

    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 2000);
    const sc = this.scene;
    sc.fog = new THREE.FogExp2(0x0a1430, 0.0026);
    this.envNight = this.envMap(false);
    this.envDay = this.envMap(true);
    sc.environment = this.envDay;
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
    this.bloom = new BloomEffect({ intensity: 1.15, luminanceThreshold: 0.78, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72, levels: this.quality === 2 ? 8 : 5 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const grade = new GradeEffect({ vibrance: 0.22, contrast: 0.12, lift: 0.01 });
    const vig = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
    // SMAA (three passes) on real GPUs, FXAA (one) on integrated ones
    const aa = this.quality === 2 ? new SMAAEffect({ preset: SMAAPreset.HIGH }) : new FXAAEffect();
    comp.addPass(new EffectPass(this.camera, new SanitizeEffect()));
    // the AA samples its input, so it leads the merged pass
    comp.addPass(new EffectPass(this.camera, aa, this.bloom, tone, grade, vig));
    this.setDay(true);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** a sunny afternoon or a floodlit night */
  setDay(day: boolean): void {
    this.day = day;
    const sc = this.scene;
    this.skyU.uDay.value = day ? 1 : 0;
    sc.environment = day ? this.envDay : this.envNight;
    sc.environmentIntensity = day ? 0.6 : 0.75;
    const fog = sc.fog as THREE.FogExp2;
    fog.color.set(day ? 0xa8c2de : 0x0a1430);
    fog.density = day ? 0.0007 : 0.0026;
    this.hemi.color.set(day ? 0xd2e4ff : 0x8fb4ff);
    this.hemi.groundColor.set(day ? 0x56703a : 0x1d3a16);
    this.hemi.intensity = day ? 0.55 : 0.55;
    this.key.color.set(day ? 0xfff0dc : 0xf2f5ff);
    this.key.intensity = day ? 2.7 : 2.6;
    this.fill.color.set(day ? 0xbcd2ff : 0xffe2c4);
    this.fill.intensity = day ? 0.55 : 0.7;
    this.bloom.intensity = day ? 0.55 : 1.15;
    this.bloom.luminanceMaterial.threshold = day ? 0.92 : 0.78;
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
    if (!this.autoQuality) return;
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

  /** the image light: a sky with banks of floodlights all round and a green floor */
  private envMap(day: boolean): THREE.Texture {
    const es = new THREE.Scene();
    const skyM = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { uSun: { value: KEY_DIR } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: day
        ? `uniform vec3 uSun; varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y;
        vec3 c = mix(vec3(0.62,0.74,0.9), vec3(0.18,0.38,0.78), smoothstep(0.0, 0.7, h));
        c = mix(vec3(0.16,0.22,0.12), c, smoothstep(-0.25, 0.02, h));
        float s = max(dot(d, uSun), 0.0);
        c += vec3(1.0,0.9,0.75) * (pow(s, 600.0) * 60.0 + pow(s, 8.0) * 0.5);
        gl_FragColor = vec4(c, 1.); }`
        : `varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y;
        vec3 c = mix(vec3(0.05,0.09,0.06), vec3(0.03,0.05,0.12), smoothstep(-0.2, 0.05, h));
        c = mix(c, vec3(0.012,0.02,0.06), smoothstep(0.1, 0.8, h));
        c += vec3(0.12,0.1,0.16) * exp(-abs(h - 0.08) * 18.0);
        gl_FragColor = vec4(c, 1.); }`,
    });
    es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyM));
    if (day) {
      // the stands as a grey band round the horizon, the pitch below
      const band = new THREE.Mesh(new THREE.CylinderGeometry(44, 44, 18, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0x3c3a3e, side: THREE.BackSide }));
      band.position.y = 6;
      es.add(band);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: 0x2e5a1c }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -4;
      es.add(floor);
      const pm = new THREE.PMREMGenerator(this.renderer);
      const rt = pm.fromScene(es, 0.02);
      pm.dispose();
      return rt.texture;
    }
    const lamp = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6, 6.4) });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), lamp);
      m.position.set(Math.cos(a) * 40, 22, Math.sin(a) * 40);
      m.lookAt(0, 0, 0);
      es.add(m);
    }
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.5, 1.8) });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(42, 0.6, 6, 64), strip);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 30;
    es.add(ring);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: 0x0f2a12 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -4;
    es.add(floor);
    const pm = new THREE.PMREMGenerator(this.renderer);
    const rt = pm.fromScene(es, 0.02);
    pm.dispose();
    return rt.texture;
  }

  /** a night sky: deep blue, a glow over the stadium lights, stars */
  private sky(): THREE.Mesh {
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyU,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }',
      fragmentShader: `uniform float uTime; uniform float uDay; uniform vec3 uSun; varying vec3 vP;
        float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
        float n2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
          return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
        float fbm(vec2 p){ float a = 0.5, v = 0.0; for (int k = 0; k < 5; k++){ v += a*n2(p); p = p*2.03 + 7.1; a *= 0.5; } return v; }
        void main(){ vec3 d = normalize(vP); float h = d.y;
          // night: deep blue, a glow over the lights, stars
          vec3 cn = mix(vec3(0.07,0.11,0.24), vec3(0.008,0.014,0.045), smoothstep(0.0, 0.55, h));
          cn += vec3(0.25,0.22,0.35) * exp(-max(h,0.)*9.0) * 0.6;
          cn = mix(cn, vec3(0.02,0.03,0.05), smoothstep(0.0,-0.15,h));
          vec2 sp = vec2(atan(d.z,d.x)*120., h*240.);
          vec2 id = floor(sp); vec2 f = fract(sp)-0.5;
          float s = h21(id); float star = step(0.985, s) * (1.0 - smoothstep(0.0, 0.2, length(f))) * smoothstep(0.05,0.4,h);
          cn += vec3(0.9,0.95,1.0) * star * (0.4 + 0.6*h21(id+3.1));
          // day: a blue dome paling to the haze, the sun, drifting cumulus
          vec3 cd = mix(vec3(0.66,0.78,0.92), vec3(0.16,0.36,0.78), smoothstep(0.0, 0.65, h));
          float sd = max(dot(d, uSun), 0.0);
          vec2 cp = d.xz / max(h + 0.12, 0.05) * 1.6 + vec2(uTime * 0.006, uTime * 0.002);
          float cl = smoothstep(0.52, 0.78, fbm(cp)) * smoothstep(0.02, 0.22, h);
          float shade = fbm(cp + vec2(0.35, 0.2));
          vec3 cloudC = mix(vec3(0.62,0.66,0.74), vec3(1.05,1.04,1.0), smoothstep(0.35, 0.75, shade)) * (1.0 + pow(sd, 6.0) * 0.6);
          cd = mix(cd, cloudC, cl * 0.92);
          cd += vec3(1.0,0.92,0.78) * (pow(sd, 900.0) * 40.0 + pow(sd, 12.0) * 0.35) * (1.0 - cl * 0.8);
          cd = mix(cd, vec3(0.3,0.33,0.36), smoothstep(0.0,-0.15,h));
          gl_FragColor = vec4(mix(cn, cd, uDay), 1.); }`,
    });
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
