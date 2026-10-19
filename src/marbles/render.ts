import * as THREE from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { clouds, environment, giants, lake, skyDome } from './env.ts';
import { DESIGNS, marbleMaterial, paintMaterial, Pattern } from './shaders.ts';

/**
 * The stage everything plays on: the light (sun with its shadow, sky light, the image light),
 * the sky, the paint lake and the backdrop far out, and the post-processing chain. The game
 * tells it where the course is (setCourse), what the camera is looking at (render) and the time.
 */

export const SUN = new THREE.Vector3(-0.45, 0.8, 0.38).normalize();

export class Stage {
  readonly composer: EffectComposer;
  readonly sun: THREE.DirectionalLight;
  readonly lake: THREE.Mesh;
  readonly backdrop = new THREE.Group();
  readonly ao: N8AOPostPass;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly scene: THREE.Scene,
    readonly camera: THREE.PerspectiveCamera,
  ) {
    const r = renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    scene.environment = environment(r, SUN);
    scene.environmentIntensity = 0.85;
    scene.add(skyDome(SUN));
    scene.fog = new THREE.Fog(0xd8e4ff, 260, 1500);
    scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x9a6a40, 0.55));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff1dc, 3.1));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -34;
    sc.right = sc.top = 34;
    sc.near = 1;
    sc.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    scene.add(sun, sun.target);
    this.lake = lake(0);
    scene.add(this.lake);
    scene.add(this.backdrop);
    this.backdrop.add(clouds(new THREE.Vector3(), 0));
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
    ao.configuration.aoRadius = 0.9;
    ao.configuration.distanceFalloff = 1.0;
    ao.configuration.intensity = 2.2;
    ao.configuration.gammaCorrection = false;
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.color = new THREE.Color(0x1a0e08);
    ao.setQualityMode('Medium');
    c.addPass(ao);
    const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.4, intensity: 0.75, radius: 0.7 });
    const tmq = new URLSearchParams(location.search).get('tm');
    const tm = new ToneMappingEffect({ mode: tmq === 'agx' ? ToneMappingMode.AGX : tmq === 'aces' ? ToneMappingMode.ACES_FILMIC : ToneMappingMode.NEUTRAL });
    c.addPass(new EffectPass(camera, bloom, tm, new VignetteEffect({ darkness: 0.32, offset: 0.32 })));
    c.addPass(new EffectPass(camera, new SMAAEffect()));
  }

  /** a new course: the lake under it, the backdrop round it */
  setCourse(lakeY: number, center: THREE.Vector3) {
    this.lake.position.y = lakeY;
    this.backdrop.position.set(center.x, lakeY, center.z);
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  update(dt: number, t: number) {
    (this.lake.userData.u as { uTime: { value: number } }).uTime.value = t;
    this.backdrop.traverse((o) => {
      if (o.userData.giant) o.rotation.y += dt * 0.05;
    });
  }

  /** draws the frame; the shadow follows `focus` (what the camera is looking at) */
  render(focus: THREE.Vector3) {
    this.sun.position.copy(focus).addScaledVector(SUN, 80);
    this.sun.target.position.copy(focus);
    this.composer.render();
  }
}
