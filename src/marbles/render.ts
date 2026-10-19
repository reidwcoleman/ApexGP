import * as THREE from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, EdgeDetectionMode, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { environment, giants, lake, skyDome } from './env.ts';
import { installAir } from './env-air.ts';
import { Clouds } from './env-clouds.ts';
import { Mirror } from './env-mirror.ts';
import { Props } from './env-props.ts';
import { makeSun } from './env-sun.ts';
import { GradeEffect } from './post-grade.ts';
import { TAAPass } from './post-taa.ts';
import { DESIGNS, marbleMaterial, paintMaterial, Pattern } from './shaders.ts';

/**
 * The stage everything plays on: the light (the sun with its two shadow cascades, the sky light,
 * the image light), the sky, the air, the paint sea and its mirror, the backdrop far out (pegs,
 * clouds, floating toys), and the post-processing chain (ambient occlusion, temporal anti-aliasing,
 * bloom, the tone curve, the grade). The game tells it where the course is (setCourse), the size,
 * and the time. URL switches: ?aa=smaa (the edge filter instead of TAA), ?gfx=high|medium|low (pins
 * the quality; otherwise it steps down by itself if the frames run long), ?tm=agx|aces.
 */

export const SUN = new THREE.Vector3(-0.45, 0.8, 0.38).normalize();

export class Stage {
  readonly composer: EffectComposer;
  readonly sun: ReturnType<typeof makeSun>;
  readonly lake: THREE.Mesh;
  readonly backdrop = new THREE.Group();
  readonly ao: N8AOPostPass;
  readonly sky: THREE.Mesh;
  readonly clouds: Clouds;
  readonly mirror = new Mirror();
  readonly props = new Props();
  readonly aa: 'taa' | 'smaa';
  readonly taa: TAAPass | null = null;
  private balls: THREE.Mesh[] = [];
  private size = new THREE.Vector2();
  /** 2: everything; 1: no mirror in the paint; 0: no ambient occlusion either, smaller shadow maps */
  quality = 2;
  /** false when ?gfx= pinned the quality */
  autoQuality = true;
  private frameT = 0;
  private slowT = 0;
  private settleT = 0;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
  ) {
    const r = renderer;
    // (before any material compiles: every fog in the scene becomes the sky-coloured air)
    installAir(SUN);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    scene.environment = environment(r, SUN);
    scene.environmentIntensity = 0.9;
    scene.add((this.sky = skyDome(SUN)));
    // (white: the air takes the sky's own colour; the density sets how far before it is all sky)
    scene.fog = new THREE.FogExp2(0xffffff, 1 / 1800);
    // sky light from above, the paint's pink-and-gold glow from below
    scene.add(new THREE.HemisphereLight(0xc4dcff, 0xe0a49a, 0.6));
    const sun = (this.sun = makeSun(SUN, 0xfff0da, 3.2));
    scene.add(sun);
    this.lake = lake(0, this.mirror);
    scene.add(this.lake);
    scene.add(this.backdrop);
    this.clouds = new Clouds(SUN);
    this.backdrop.add(this.clouds.mesh, this.props.group);
    this.backdrop.add(
      giants(
        new THREE.Vector3(),
        0,
        (a, b) => paintMaterial({ a, b, pattern: Pattern.Stripes, scale: 1, wear: 0.02 }),
        (i) => marbleMaterial(DESIGNS[i % DESIGNS.length], i),
      ),
    );

    const c = (this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    c.addPass(new RenderPass(scene, camera));
    const ao = (this.ao = new N8AOPostPass(scene, camera, 1, 1));
    ao.configuration.aoRadius = 1.1;
    ao.configuration.distanceFalloff = 0.8;
    ao.configuration.intensity = 2.4;
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.color = new THREE.Color(0x1c0f14);
    // (few samples: the temporal AA averages the AO's noise away over the frames)
    ao.setQualityMode(this.aaMode() === 'taa' ? 'Performance' : 'Medium');
    // (N8AO would re-render every transparent thing twice a frame to keep AO off it: the clouds
    // and the confetti are far from any crease, and the AO under them is nil anyway)
    (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
    ao.configuration.transparencyAware = false;
    c.addPass(ao);
    // anti-aliasing: temporal by default (?aa=smaa for the edge filter instead)
    this.aa = this.aaMode();
    if (this.aa === 'taa') c.addPass((this.taa = new TAAPass()));
    const bloom = new BloomEffect({ mipmapBlur: true, levels: 5, luminanceThreshold: 1.0, luminanceSmoothing: 0.35, intensity: 0.6, radius: 0.65 });
    const tmq = new URLSearchParams(location.search).get('tm');
    const tm = new ToneMappingEffect({ mode: tmq === 'agx' ? ToneMappingMode.AGX : tmq === 'aces' ? ToneMappingMode.ACES_FILMIC : ToneMappingMode.NEUTRAL });
    c.addPass(new EffectPass(camera, bloom, tm, new GradeEffect(), new VignetteEffect({ darkness: 0.28, offset: 0.35 })));
    if (this.aa === 'smaa') c.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.ULTRA, edgeDetectionMode: EdgeDetectionMode.COLOR })));
    const gfx = new URLSearchParams(location.search).get('gfx');
    if (gfx) {
      this.autoQuality = false;
      this.setQuality(gfx === 'low' ? 0 : gfx === 'medium' ? 1 : 2);
    }
  }

  /** the quality level (see `quality`); the stage also steps down on its own when frames run long */
  setQuality(q: number) {
    q = THREE.MathUtils.clamp(Math.round(q), 0, 2);
    if (q === this.quality) return;
    this.quality = q;
    this.mirror.enabled = q >= 2;
    (this.lake.userData.u as { uReflOn: { value: number } }).uReflOn.value = q >= 2 ? 1 : 0;
    this.ao.enabled = q >= 1;
    const size = q >= 1 ? 2048 : 1024;
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== size) {
      sh.mapSize.set(size, size);
      sh.map?.dispose();
      sh.map = null;
    }
  }

  /** frames running long (under ~49 fps for a few seconds, past the settling after a new course): a step down */
  private watch() {
    const now = performance.now();
    const dt = this.frameT ? now - this.frameT : 16;
    this.frameT = now;
    if (!this.autoQuality || this.quality === 0 || dt > 100) return;
    if (this.settleT > 0) {
      this.settleT -= dt;
      return;
    }
    this.slowT = dt > 20.5 ? this.slowT + dt : Math.max(0, this.slowT - dt * 1.5);
    if (this.slowT > 3000) {
      this.setQuality(this.quality - 1);
      this.slowT = 0;
      this.settleT = 3000;
    }
  }

  private aaMode() {
    return new URLSearchParams(location.search).get('aa') === 'smaa' ? 'smaa' : 'taa';
  }

  /** a new course: the lake under it, the backdrop round it */
  setCourse(lakeY: number, center: THREE.Vector3) {
    this.taa?.reset();
    this.settleT = 4000;
    this.lake.position.set(center.x, lakeY, center.z);
    this.backdrop.position.set(center.x, lakeY, center.z);
    // the toys keep clear of the course: how far out it reaches (a sample of its vertices)
    let reach = 60;
    const v = new THREE.Vector3();
    for (const o of this.scene.children) {
      if (o === this.lake || o === this.backdrop || o === this.sky || o === this.sun) continue;
      o.updateMatrixWorld(true);
      o.traverse((m) => {
        const g = (m as THREE.Mesh).geometry;
        if (!(m as THREE.Mesh).isMesh || (m as THREE.InstancedMesh).isInstancedMesh || !g?.attributes.position) return;
        const p = g.attributes.position;
        const step = Math.max(1, Math.floor(p.count / 64));
        for (let i = 0; i < p.count; i += step) {
          v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
          reach = Math.max(reach, Math.hypot(v.x - center.x, v.z - center.z));
        }
      });
    }
    // (never close in, even round a small course: they are scenery, not set dressing)
    this.props.layout(THREE.MathUtils.clamp(reach, 150, 400));
    // (where the pegs stand in the paint, for its swirls and menisci)
    const pegs = (this.lake.userData.u as { uPegs: { value: THREE.Vector3[] } }).uPegs.value;
    let k = 0;
    this.backdrop.traverse((o) => {
      if (o.userData.peg && k < pegs.length) pegs[k++].set(o.position.x + center.x, o.position.z + center.z, o.userData.peg as number);
    });
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
    this.taa?.reset();
    const d = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.mirror.setSize(d.x, d.y);
  }

  update(dt: number, t: number) {
    (this.lake.userData.u as { uTime: { value: number } }).uTime.value = t;
    (this.sky.userData.u as { uTime: { value: number } }).uTime.value = t;
    this.clouds.update(t, this.camera);
    this.props.update(t);
    this.backdrop.traverse((o) => {
      if (o.userData.giant) o.rotation.y += dt * 0.05;
    });
  }

  /**
   * draws the frame. (`focus`, what the camera is looking at, is no longer needed: the shadow's
   * cascades are fitted to the view itself. Kept so the game's call stands.)
   */
  render(focus: THREE.Vector3) {
    this.watch();
    // (not before the sun's shadow map exists: the mirror doesn't draw it, and three has no stand-in)
    if (this.sun.shadow.map) this.mirror.render(this.renderer, this.scene, this.camera, this.lake.position.y, [this.lake]);
    const taa = this.taa;
    if (taa) {
      // (the glass marbles: the spheres standing in the scene itself, not the backdrop's giants)
      this.balls.length = 0;
      for (const o of this.scene.children) {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.visible && m.geometry.type === 'SphereGeometry') this.balls.push(m);
      }
      this.renderer.getDrawingBufferSize(this.size);
      taa.begin(this.camera, this.size.x, this.size.y, this.balls);
    }
    this.composer.render();
    taa?.end(this.camera);
  }
}
