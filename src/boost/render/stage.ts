import * as THREE from 'three';
import { BloomEffect, ChromaticAberrationEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { GradeEffect } from '../../marbles/post-grade.ts';

/**
 * The renderer and the night: a floodlit stadium under a deep sky. One key light (high, from the
 * light rings, the only shadow caster so the ball's shadow sits straight under it like the real
 * game's), sky and pitch bounce, an image light baked from a little scene of the floodlight banks so
 * the paint and the ball pick up long highlights, then bloom, a filmic curve, the grade.
 *
 * Quality: ?gfx=high|medium|low pins it; otherwise the resolution scale follows the frame rate.
 */

export const S = 0.01; // cm → m
export const KEY_DIR = new THREE.Vector3(0.25, 1, 0.35).normalize();

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly key: THREE.DirectionalLight;
  readonly bloom: BloomEffect;
  readonly chroma: ChromaticAberrationEffect;
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
    const q = new URLSearchParams(location.search).get('gfx');
    if (q === 'low' || q === 'medium' || q === 'high') {
      this.quality = q === 'low' ? 0 : q === 'medium' ? 1 : 2;
      this.autoQuality = false;
    }

    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 2000);
    const sc = this.scene;
    sc.fog = new THREE.FogExp2(0x0a1430, 0.0026);
    sc.environment = this.envMap();
    sc.environmentIntensity = 0.75;

    sc.add(new THREE.HemisphereLight(0x8fb4ff, 0x1d3a16, 0.55));
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
    const fill = new THREE.DirectionalLight(0xffe2c4, 0.7);
    fill.position.set(-30, 60, -50);
    sc.add(fill);
    // the goal flash
    this.flash = new THREE.PointLight(0xffffff, 0, 60, 1.6);
    sc.add(this.flash);

    sc.add(this.sky());

    const comp = (this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    comp.addPass(new RenderPass(sc, this.camera));
    this.bloom = new BloomEffect({ intensity: 1.15, luminanceThreshold: 0.78, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
    this.chroma = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0, 0), radialModulation: true, modulationOffset: 0.3 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const grade = new GradeEffect({ vibrance: 0.22, contrast: 0.12, lift: 0.01 });
    const vig = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
    const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    comp.addPass(new EffectPass(this.camera, this.bloom, this.chroma));
    comp.addPass(new EffectPass(this.camera, tone, grade, vig, smaa));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio, 2) * this.scale * (this.quality === 0 ? 0.7 : 1);
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
    this.composer.render(dt);
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

  /** the image light: a sky with banks of floodlights all round and a green floor */
  private envMap(): THREE.Texture {
    const es = new THREE.Scene();
    const skyM = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `varying vec3 vP; void main(){ vec3 d = normalize(vP); float h = d.y;
        vec3 c = mix(vec3(0.05,0.09,0.06), vec3(0.03,0.05,0.12), smoothstep(-0.2, 0.05, h));
        c = mix(c, vec3(0.012,0.02,0.06), smoothstep(0.1, 0.8, h));
        c += vec3(0.12,0.1,0.16) * exp(-abs(h - 0.08) * 18.0);
        gl_FragColor = vec4(c, 1.); }`,
    });
    es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyM));
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
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position = p.xyww; }',
      fragmentShader: `varying vec3 vP;
        float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
        void main(){ vec3 d = normalize(vP); float h = d.y;
          vec3 c = mix(vec3(0.07,0.11,0.24), vec3(0.008,0.014,0.045), smoothstep(0.0, 0.55, h));
          c += vec3(0.25,0.22,0.35) * exp(-max(h,0.)*9.0) * 0.6;
          c = mix(c, vec3(0.02,0.03,0.05), smoothstep(0.0,-0.15,h));
          vec2 sp = vec2(atan(d.z,d.x)*120., h*240.);
          vec2 id = floor(sp); vec2 f = fract(sp)-0.5;
          float s = h21(id); float star = step(0.985, s) * smoothstep(0.2, 0.0, length(f)) * smoothstep(0.05,0.4,h);
          c += vec3(0.9,0.95,1.0) * star * (0.4 + 0.6*h21(id+3.1));
          gl_FragColor = vec4(c,1.); }`,
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
