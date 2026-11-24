import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { U } from './materials.ts';

/**
 * Light: the same Poly Haven sky the bake used (Qwantani, late afternoon), as background and as the
 * image-based light, and its sun as one directional light with the energy measured off the HDRI
 * (the sun disc integrated: E ≈ 9.2 / 7.4 / 5.2 W/m²) so the real-time sun and the baked bounce
 * agree. Shadows: three cascades (CSM) out to 320 m, every lit material registered with them.
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';

// sun direction in three's frame: toward the sun (x east-ish over the sea, y up, z = -north)
const SUN_AZ = THREE.MathUtils.degToRad(-36);
const SUN_EL = THREE.MathUtils.degToRad(19.07);
export const SUN_E: [number, number, number] = [9.18, 7.38, 5.23];

export class Env {
  readonly toSun = new THREE.Vector3(Math.cos(SUN_AZ) * Math.cos(SUN_EL), Math.sin(SUN_EL), -Math.sin(SUN_AZ) * Math.cos(SUN_EL));
  csm!: CSM;
  hdr: THREE.DataTexture | null = null;
  envMap: THREE.Texture | null = null;
  private readonly prepped = new WeakSet<THREE.Material>();
  readonly fog: THREE.FogExp2;

  constructor(readonly renderer: THREE.WebGLRenderer, readonly scene: THREE.Scene, readonly camera: THREE.PerspectiveCamera) {
    U.uSunDir.value.copy(this.toSun);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const mx = Math.max(...SUN_E);
    this.csm = new CSM({
      maxFar: 320,
      cascades: 3,
      mode: 'practical',
      parent: scene,
      shadowMapSize: 2048,
      lightDirection: this.toSun.clone().negate(),
      lightIntensity: mx,
      lightNear: 1,
      lightFar: 900,
      lightMargin: 120,
      camera,
    });
    for (const l of this.csm.lights) {
      l.color.setRGB(SUN_E[0] / mx, SUN_E[1] / mx, SUN_E[2] / mx);
      l.shadow.bias = -0.00012;
      l.shadow.normalBias = 0.035;
      l.shadow.radius = 2;
    }
    this.csm.fade = true;
    // haze: the Atlantic air at 5 pm, a little milky
    this.fog = new THREE.FogExp2(0xb9c6d2, 0.0011);
    scene.fog = this.fog;
  }

  private skies = new Map<string, { hdr: THREE.DataTexture; env: THREE.Texture }>();
  private dusk = false;

  /** day (late afternoon sun) or dusk (blue hour, sun down, the neon on) */
  async setDusk(on: boolean) {
    this.dusk = on;
    const file = on ? 'sky/qwantani_dusk_2_puresky.hdr' : 'sky/qwantani_late_afternoon_puresky.hdr';
    let s = this.skies.get(file);
    if (!s) {
      const hdr = await new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(BASE + file);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      const pm = new THREE.PMREMGenerator(this.renderer);
      const env = pm.fromEquirectangular(clampSun(hdr, 20)).texture;
      pm.dispose();
      this.skies.set(file, (s = { hdr, env }));
    }
    if (on !== this.dusk) return;
    this.hdr = s.hdr;
    this.scene.background = s.hdr;
    this.scene.environment = s.env;
    // the dusk sky file is brighter than a real blue hour: bring it down to one
    this.scene.backgroundIntensity = on ? 0.13 : 1;
    this.scene.environmentIntensity = on ? 0.09 : 1;
    for (const l of this.csm.lights) l.intensity = on ? 0 : Math.max(...SUN_E);
    U.uNight.value = on ? 1 : 0;
    U.uLmTint.value.set(...((on ? [0.065, 0.06, 0.095] : [1, 1, 1]) as [number, number, number]));
    this.fog.color.set(on ? 0x2a2a44 : 0xb9c6d2);
  }

  async loadSky(file: string) {
    const hdr = await new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(BASE + file);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    this.hdr = hdr;
    const pm = new THREE.PMREMGenerator(this.renderer);
    // the IBL without the sun disc (the directional light carries it)
    this.envMap = pm.fromEquirectangular(clampSun(hdr, 20)).texture;
    pm.dispose();
    this.scene.background = hdr;
    this.scene.environment = this.envMap;
    this.skies.set(file, { hdr, env: this.envMap });
    this.scene.backgroundIntensity = 1;
    this.scene.environmentIntensity = 1;
  }

  /** register a material with the shadow cascades (keeps its own onBeforeCompile) */
  prep(m: THREE.Material) {
    if (this.prepped.has(m)) return;
    this.prepped.add(m);
    if (!(m instanceof THREE.MeshStandardMaterial) && !(m instanceof THREE.MeshLambertMaterial) && !(m instanceof THREE.MeshPhongMaterial)) return;
    const own = m.onBeforeCompile;
    this.csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = function (sh, r) {
      own.call(this, sh, r);
      csmHook.call(this, sh, r);
    };
    m.needsUpdate = true;
  }

  prepObject(o: THREE.Object3D, cast = true, receive = true) {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = cast;
      m.receiveShadow = receive;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const x of mats) this.prep(x);
    });
  }

  update() {
    this.camera.updateMatrixWorld();
    this.csm.update();
  }

  resize() {
    this.csm.updateFrustums();
  }
}

/** a copy of the sky with the sun disc clamped out (for the PMREM) */
function clampSun(hdr: THREE.DataTexture, max: number): THREE.DataTexture {
  const img = hdr.image as { data: Uint16Array; width: number; height: number };
  const src = img.data;
  const out = new Uint16Array(src.length);
  const maxH = THREE.DataUtils.toHalfFloat(max);
  for (let i = 0; i < src.length; i++) {
    // half floats: positive values order like their bit patterns
    out[i] = (i & 3) === 3 ? src[i] : src[i] > maxH ? maxH : src[i];
  }
  // a "pure sky" has a bright haze where the ground would be: below the horizon, light that bounced
  // off sand, asphalt and lawn instead (about a fifth of it), so nothing is lit brightly from below
  const w = img.width, h = img.height;
  for (let y = 0; y < h; y++) {
    // an .hdr stores its top row first (flipY puts it at v = 1): v here is the height from the nadir
    const v = 1 - (y + 0.5) / h;
    if (v >= 0.5) continue;
    const k = 0.22 + 0.78 * Math.max(0, (v - 0.47) / 0.03);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = THREE.DataUtils.toHalfFloat(THREE.DataUtils.fromHalfFloat(out[o + c]) * k * (c === 0 ? 1.05 : c === 2 ? 0.85 : 1));
    }
  }
  const t = new THREE.DataTexture(out, img.width, img.height, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = hdr.colorSpace;
  t.needsUpdate = true;
  return t;
}
