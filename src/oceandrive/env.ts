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
  /** the backdrop: the sky photo with its highlights rolled off, and a drawn sun */
  readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;

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
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: { tSky: { value: null }, uSun: { value: this.toSun }, uK: { value: 1 }, uSunK: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize( ( modelMatrix * vec4( position, 0.0 ) ).xyz );
          vec4 p = projectionMatrix * viewMatrix * vec4( cameraPosition + vDir * 4000.0, 1.0 );
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSky;
        uniform vec3 uSun;
        uniform float uK;
        uniform float uSunK;
        varying vec3 vDir;
        #include <common>
        vec3 photo( vec3 d ) {
          vec2 uv = vec2( atan( d.z, d.x ) * RECIPROCAL_PI2 + 0.5, asin( clamp( d.y, -1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5 );
          vec3 c = texture2D( tSky, uv ).rgb * uK;
          float m = max( c.r, max( c.g, c.b ) );
          if ( m > 2.5 ) c *= ( 2.5 + log( 1.0 + ( m - 2.5 ) ) * 0.6 ) / m;
          return c;
        }
        void main() {
          vec3 d = normalize( vDir );
          vec3 c = photo( d );
          float cs = dot( d, uSun );
          // the photo's own sun (with its lens starburst) is replaced by the sky from just outside it,
          // carried inward; a clean disc and glow are drawn over that
          if ( cs > 0.97 ) {
            vec3 t1 = normalize( cross( uSun, vec3( 0.0, 1.0, 0.0 ) ) ), t2 = cross( t1, uSun );
            vec3 avg = vec3( 0.0 );
            for ( int i = 0; i < 12; i ++ ) {
              float a = float( i ) * 0.5236;
              avg += photo( normalize( uSun * 0.978 + ( t1 * cos( a ) + t2 * sin( a ) ) * 0.2085 ) );
            }
            c = mix( c, avg / 12.0, smoothstep( 0.975, 0.992, cs ) );
          }
          float disc = smoothstep( 0.99996, 0.99998, cs );
          vec3 sunC = vec3( 1.0, 0.86, 0.66 );
          c += sunC * ( disc * 40.0 + pow( max( cs, 0.0 ), 3000.0 ) * 4.0 + pow( max( cs, 0.0 ), 400.0 ) * 0.9 + pow( max( cs, 0.0 ), 50.0 ) * 0.3 ) * uSunK;
          gl_FragColor = vec4( c, 1.0 );
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(10, 256, 128), this.domeMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);
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
    this.scene.background = null;
    this.domeMat.uniforms.tSky.value = s.hdr;
    this.domeMat.uniforms.uK.value = on ? 0.13 : 1;
    this.domeMat.uniforms.uSunK.value = on ? 0 : 1;
    this.scene.environment = s.env;
    // the dusk sky file is brighter than a real blue hour: bring it down to one
    this.scene.backgroundIntensity = on ? 0.13 : 1;
    this.scene.environmentIntensity = on ? 0.09 : 1;
    for (const l of this.csm.lights) l.intensity = on ? 0 : Math.max(...SUN_E);
    U.uNight.value = on ? 1 : 0;
    U.uLmTint.value.set(...((on ? [0.24, 0.22, 0.36] : [1.55, 1.52, 1.5]) as [number, number, number]));
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
    this.scene.background = null;
    this.domeMat.uniforms.tSky.value = hdr;
    this.scene.environment = this.envMap;
    this.skies.set(file, { hdr, env: this.envMap });
    this.scene.backgroundIntensity = 1;
    this.scene.environmentIntensity = 1;
  }

  /** reflection probes: the street as seen from a few points, filtered for glossy reflections */
  readonly probes: { pos: THREE.Vector3; tex: THREE.Texture }[] = [];
  bakeProbes(points: THREE.Vector3[], hide: THREE.Object3D[]) {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const rt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.3, 2500, rt);
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    for (const p of points) {
      cam.position.copy(p);
      cam.update(this.renderer, this.scene);
      this.probes.push({ pos: p.clone(), tex: pm.fromCubemap(rt.texture).texture });
    }
    hide.forEach((o, i) => (o.visible = vis[i]));
    rt.dispose();
    pm.dispose();
  }

  /** the probe nearest a point */
  probeAt(x: number, z: number): THREE.Texture | null {
    let best: THREE.Texture | null = null, bd = Infinity;
    for (const p of this.probes) {
      const d = (p.pos.x - x) ** 2 + (p.pos.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p.tex;
      }
    }
    return best;
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
