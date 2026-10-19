/**
 * The light and the sky: a photographed HDR sky per time of day (Poly Haven, CC0) for the
 * background and the image-based light, turned so its sun stands where the theme wants it;
 * the sun itself as a shadow-casting directional light that follows the mower; haze to match.
 */
import * as THREE from 'three';
import { horizonColour, loadHdri, sunOf } from './assets.ts';
import type { Theme } from './levels.ts';

interface SkyEntry {
  hdr: THREE.DataTexture;
  env: THREE.Texture;
  /** the HDR's own sun: bearing (atan2(z, x)) and elevation */
  az: number;
  el: number;
  horizon: THREE.Color;
}

export class Environment {
  readonly sun = new THREE.DirectionalLight('#fff3df', 4);
  readonly hemi = new THREE.HemisphereLight('#cfe2ff', '#6f7f4a', 0.35);
  private pmrem: THREE.PMREMGenerator;
  private cache = new Map<string, Promise<SkyEntry>>();
  /** unit vector toward the sun */
  readonly sunDir = new THREE.Vector3(0.3, 0.8, -0.5);
  private shadowSize = 4096;
  private extent = 18;
  theme: Theme | null = null;
  readonly fog = new THREE.FogExp2('#cfe2f3', 0.006);

  constructor(readonly scene: THREE.Scene, readonly renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
    const s = this.sun;
    s.castShadow = true;
    s.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    const c = s.shadow.camera;
    c.left = c.bottom = -this.extent;
    c.right = c.top = this.extent;
    c.near = 1;
    c.far = 160;
    s.shadow.bias = -0.00025;
    s.shadow.normalBias = 0.025;
    s.shadow.radius = 2.5;
  }

  setShadowQuality(size: number, extent = this.extent) {
    this.extent = extent;
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -extent;
    c.right = c.top = extent;
    c.updateProjectionMatrix();
    if (size !== this.shadowSize) {
      this.shadowSize = size;
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(size, size);
    }
  }

  private sky(theme: Theme): Promise<SkyEntry> {
    let p = this.cache.get(theme.hdri);
    if (!p) {
      p = loadHdri(theme.hdri).then((hdr) => {
        const { az, el } = sunOf(hdr);
        const env = this.pmrem.fromEquirectangular(hdr).texture;
        return { hdr, env, az, el, horizon: horizonColour(hdr) };
      });
      this.cache.set(theme.hdri, p);
    }
    return p;
  }

  /** Switch to a time of day (loads its sky first). */
  async setTheme(theme: Theme) {
    const sky = await this.sky(theme);
    this.theme = theme;
    const sc = this.scene;
    sc.environment = sky.env;
    sc.environmentIntensity = theme.envIntensity;
    sc.background = sky.hdr;
    sc.backgroundIntensity = 1;
    sc.backgroundBlurriness = 0.015;
    // turn the sky so its sun lands on the theme's bearing
    const turn = sky.az - theme.sunAz;
    sc.environmentRotation.set(0, turn, 0);
    sc.backgroundRotation.set(0, turn, 0);
    const el = Math.max(0.05, Math.abs(sky.el));
    this.sunDir.set(Math.cos(el) * Math.cos(theme.sunAz), Math.sin(el), Math.cos(el) * Math.sin(theme.sunAz)).normalize();
    this.sun.color.set(theme.sunColor);
    this.sun.intensity = theme.sunIntensity;
    this.hemi.intensity = 0.28;
    this.hemi.color.set('#cfe2ff').lerp(sky.horizon.clone().multiplyScalar(0.8), 0.5);
    this.hemi.groundColor.set('#586a3a');
    // haze: the theme's colour pulled toward the sky's own horizon
    const hz = sky.horizon.clone();
    const m = Math.max(hz.r, hz.g, hz.b, 1e-3);
    hz.multiplyScalar(1 / m);
    this.fog.color.set(theme.fogColor).lerp(hz.multiplyScalar(0.9), 0.35);
    this.fog.density = theme.fogDensity;
  }

  /** Keep the sun's shadow window on the mower, snapped to the shadow map's texels so edges don't crawl. */
  follow(x: number, z: number) {
    const L = this.sunDir;
    const d = 70;
    const sun = this.sun;
    const texel = (this.extent * 2) / this.shadowSize;
    // snap in the light's own frame
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), L).normalize();
    const up = new THREE.Vector3().crossVectors(L, right).normalize();
    const p = new THREE.Vector3(x, 0, z);
    const a = Math.round(p.dot(right) / texel) * texel;
    const b = Math.round(p.dot(up) / texel) * texel;
    const c = p.dot(L);
    p.copy(right).multiplyScalar(a).addScaledVector(up, b).addScaledVector(L, c);
    sun.target.position.copy(p);
    sun.position.copy(p).addScaledVector(L, d);
    sun.target.updateMatrixWorld();
  }

  dispose() {
    this.pmrem.dispose();
  }
}
