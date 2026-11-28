import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { clamp, lerp, smoothstep } from '../core/math';

/**
 * The sky: real sky photos (Poly Haven HDRIs, CC0) for afternoon, golden hour and dusk, blended by
 * the sun's height as the clock runs, with the photo's own sun clamped out and the game's sun drawn
 * where the shadows say it is. The same photo lights the world (image-based light, reflections in
 * glass, paint and water); its measured horizon colour feeds the fog and the sea. At night the dusk
 * photo is dimmed to near black and stars and a moon come out.
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'palmera/sky/';
const PHOTOS = ['kloofendal_48d_partly_cloudy_puresky', 'qwantani_late_afternoon_puresky', 'qwantani_sunset_puresky', 'qwantani_dusk_2_puresky'] as const;

interface Photo {
  tex: THREE.DataTexture;
  env: THREE.Texture;
  /** what shiny things (car paint, glass) see: the photo's sky, a skyline of buildings, a crisp horizon over dark ground */
  refl: THREE.Texture;
  /** the photo's own sun azimuth (rad, in the equirect's frame) */
  sunAz: number;
  /** the photo's own sun's height above the horizon (radians) */
  sunEl: number;
  /** mean luminance of the upper hemisphere (sun clamped) — photos are levelled by it */
  lum: number;
  horizon: THREE.Color;
  zenith: THREE.Color;
}

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uRotA;
uniform float uRotB;
uniform vec3 uPSunA;
uniform vec3 uPSunB;
uniform float uMix;
uniform float uLevel;
uniform float uHasPhoto;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uSunColor;
uniform float uSunI;
uniform float uNight;
uniform float uTime;
uniform float uGrey;
varying vec3 vDir;
float h3(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
vec3 photo(sampler2D t, vec3 d, float rot) {
  float az = atan(d.z, d.x) + rot;
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 uv = vec2(fract(az / 6.2831853 + 0.5), 0.5 + el / 3.14159265);
  return min(texture2D(t, uv).rgb, vec3(8.0));
}
// the photo with its own sun taken out: round the photographed sun, the sky beside it at the same height
// (the game draws its sun where the shadows come from; the photo's sat above or below it as a second one)
vec3 photoS(sampler2D t, vec3 d, float rot, vec3 ps) {
  vec3 c = photo(t, d, rot);
  float k = dot(d, ps);
  if (k > 0.94) {
    vec3 side = normalize(cross(ps, vec3(0.0, 1.0, 0.0)));
    vec3 ref = 0.5 * (photo(t, normalize(ps + side * 0.45), rot) + photo(t, normalize(ps - side * 0.45), rot));
    c = mix(c, min(c, ref * 1.15), smoothstep(0.94, 0.985, k));
  }
  return c;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 dd = vec3(d.x, max(d.y, 0.004), d.z);
  vec3 col;
  if (uHasPhoto > 0.5) {
    col = mix(photoS(tA, dd, uRotA, uPSunA), photoS(tB, dd, uRotB, uPSunB), uMix) * uLevel;
  } else {
    col = mix(uHorizon, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.42));
  }
  // a rain sky: the photo drained to grey and darker
  float gl = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(col, vec3(gl) * vec3(0.86, 0.88, 0.91) * 0.9, uGrey);
  // below the horizon: the sea's haze
  if (d.y < 0.0) col = mix(col, uHorizon * 0.8, clamp(-d.y * 6.0, 0.0, 1.0));
  // the game's sun: a disc and its glow, where the shadows are cast from
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 900.0) * 0.6 + pow(sd, 60.0) * 0.12) * uSunI;
  col += uSunColor * smoothstep(0.99962, 0.9998, sd) * 60.0 * uSunI;
  // night: never quite black — a navy dome and the city's orange glow low over the horizon
  col += vec3(0.006, 0.011, 0.026) * uNight * (1.0 - uGrey * 0.5);
  col += vec3(0.11, 0.06, 0.035) * uNight * exp(-max(d.y, 0.0) * 9.0) * (1.0 + uGrey);
  // moon
  float md = dot(d, uMoonDir);
  // (behind cloud when it rains)
  float clear = 1.0 - smoothstep(0.15, 0.6, uGrey);
  // a crisp disc about a degree across (it was a soft blob four times the size), with darker seas, a
  // little limb darkening and a warm cast low over the horizon; faint by day, as a daytime moon is
  if (md > 0.999) {
    float R = 0.0088;
    vec3 mu = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 mv = cross(mu, uMoonDir);
    vec2 mp = vec2(dot(d, mu), dot(d, mv)) / R;
    float mr = length(mp);
    float disc = 1.0 - smoothstep(0.86, 1.0, mr);
    float seas = smoothstep(0.35, 0.0, length(mp - vec2(-0.25, 0.3))) * 0.45 + smoothstep(0.3, 0.0, length(mp - vec2(0.2, 0.05))) * 0.3
      + smoothstep(0.22, 0.0, length(mp - vec2(-0.05, -0.35))) * 0.25 + (h3(vec3(floor(mp * 9.0), 1.0)) - 0.5) * 0.12;
    vec3 mc = vec3(0.92, 0.93, 0.97) * (1.0 - seas) * (1.0 - 0.25 * mr * mr);
    mc *= mix(vec3(1.0, 0.72, 0.45), vec3(1.0), smoothstep(0.02, 0.18, uMoonDir.y));
    col += mc * disc * (0.32 + 1.2 * uNight) * clear;
  }
  col += vec3(0.3, 0.4, 0.7) * pow(max(md, 0.0), 900.0) * 0.05 * uNight * clear;
  // stars
  vec3 sp = d * 300.0;
  vec3 cell = floor(sp);
  float r = h3(cell);
  float star = step(0.9968, r) * smoothstep(0.45, 0.0, length(fract(sp) - 0.5));
  star *= 0.6 + 0.4 * sin(uTime * 3.0 + r * 100.0);
  col += vec3(star) * uNight * smoothstep(0.02, 0.25, d.y) * 0.5 * clear;
  gl_FragColor = vec4(col, 1.0);
}`;

function lum(c: THREE.Color) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

async function loadPhoto(renderer: THREE.WebGLRenderer, name: string): Promise<Photo> {
  const loader = new HDRLoader();
  loader.setDataType(THREE.HalfFloatType);
  const tex = await loader.loadAsync(BASE + name + '.hdr');
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const img = tex.image as { data: Uint16Array; width: number; height: number };
  const { data, width: w, height: h } = img;
  const half = THREE.DataUtils.fromHalfFloat;
  // the photo's sun: the brightest pixel of the upper half
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < h / 2; y += 2)
    for (let x = 0; x < w; x += 2) {
      const o = (y * w + x) * 4;
      const v = half(data[o + 1]);
      if (v > best) { best = v; bx = x; by = y; }
    }
  // texture u = az/2π + 0.5 (see photo() in the shader), so the sun sits at az = (u - 0.5)·2π
  const sunAz = ((bx + 0.5) / w - 0.5) * Math.PI * 2;
  const sunEl = (0.5 - (by + 0.5) / h) * Math.PI;
  // levels and colours (sun clamped)
  const hor = new THREE.Color(0, 0, 0), zen = new THREE.Color(0, 0, 0), all = new THREE.Color(0, 0, 0);
  let nh = 0, nz = 0, na = 0;
  for (let y = 0; y < h / 2; y += 2) {
    const el = (0.5 - (y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x += 4) {
      const o = (y * w + x) * 4;
      const r = Math.min(8, half(data[o])), g = Math.min(8, half(data[o + 1])), b = Math.min(8, half(data[o + 2]));
      all.r += r; all.g += g; all.b += b; na++;
      if (el > 0.02 && el < 0.09) { hor.r += r; hor.g += g; hor.b += b; nh++; }
      if (el > 1.1) { zen.r += r; zen.g += g; zen.b += b; nz++; }
    }
  }
  hor.multiplyScalar(1 / Math.max(1, nh));
  zen.multiplyScalar(1 / Math.max(1, nz));
  all.multiplyScalar(1 / Math.max(1, na));
  // the IBL: the same photo with its sun clamped (the sun is the directional light's job) and the
  // lower half turned into warm ground bounce
  const out = new Uint16Array(data.length);
  const toH = THREE.DataUtils.toHalfFloat;
  // and the low sky is mostly city, not open air: from the horizon to ~35 degrees it fades to a warm
  // neutral of the same brightness (sunlit walls bouncing light), and the whole dome keeps only 40% of
  // its saturation (the late-day photos' deep blue zenith turned roads in shade navy) - shade under a blue sky photo was going navy blue (roads, pavements, white walls)
  const city = 35 * (Math.PI / 180);
  // the sunset and dusk skies are the bluest of all (the sun's gone, it's all zenith): least colour kept
  const sat = /sunset|dusk/.test(name) ? 0.22 : 0.4;
  for (let y = 0; y < h; y++) {
    const lower = y >= h / 2;
    const el = (0.5 - (y + 0.5) / h) * Math.PI;
    const wall = lower ? 0 : 0.7 * (1 - Math.min(1, el / city)) ** 1.3;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (lower) {
        for (let c = 0; c < 3; c++) out[o + c] = toH([hor.r, hor.g, hor.b][c] * 0.35 * (c === 0 ? 1.1 : c === 2 ? 0.8 : 1));
      } else {
        const r = Math.min(6, half(data[o])), g = Math.min(6, half(data[o + 1])), b = Math.min(6, half(data[o + 2]));
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const rgb = [r, g, b].map((v) => L + (v - L) * sat);
        const warm = [L * 1.06, L * 1.0, L * 0.9];
        for (let c = 0; c < 3; c++) out[o + c] = toH(rgb[c] + (warm[c] - rgb[c]) * wall);
      }
      out[o + 3] = toH(1);
    }
  }
  const ibl = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  ibl.mapping = THREE.EquirectangularReflectionMapping;
  ibl.colorSpace = tex.colorSpace;
  ibl.flipY = tex.flipY;
  ibl.needsUpdate = true;
  // the reflection map: the sky as photographed (more of its colour), over a skyline of building
  // blocks up to ~20 degrees - lighter or darker faces, rows of windows (lit after dark) - and below the
  // horizon dark ground, a little lighter toward it. Without these a car's flank mirrored one even
  // haze and read as matte plastic
  const night = /dusk/.test(name);
  const rout = new Uint16Array(data.length);
  const skyline = new Float32Array(w), shade = new Float32Array(w), seedA = new Float32Array(w);
  {
    let x = 0, k = 0;
    while (x < w) {
      const bw = Math.max(3, Math.floor(w * (0.006 + 0.028 * frac(k * 0.618 + 0.13))));
      const top = (2 + 18 * frac(k * 0.4142 + 0.7) ** 1.6) * (Math.PI / 180) * (frac(k * 0.271) < 0.12 ? 0.25 : 1);
      const sh = 0.5 + 0.35 * frac(k * 0.7321 + 0.29);
      for (let i = x; i < Math.min(w, x + bw); i++) {
        skyline[i] = top;
        shade[i] = sh;
        seedA[i] = k;
      }
      x += bw;
      k++;
    }
  }
  for (let y = 0; y < h; y++) {
    const el = (0.5 - (y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let rgb: number[];
      if (el < 0) {
        // ground: dark, a little lighter and warmer toward the horizon
        const t = Math.min(1, -el / 0.5);
        const g = (0.16 - 0.08 * t) * (night ? 0.5 : 1);
        rgb = [hor.r * g * 1.05, hor.g * g, hor.b * g * 0.92];
      } else if (el < skyline[x]) {
        // a building: its face shade, floors and windows
        const L = 0.2126 * hor.r + 0.7152 * hor.g + 0.0722 * hor.b;
        const fl = Math.floor(el / 0.012), col = Math.floor(x / 2);
        const win = (fl % 2 === 0 ? 1 : 0) * (col % 3 !== 0 ? 1 : 0);
        const lit = night && win && frac(Math.sin(fl * 12.9898 + col * 78.233 + seedA[x]) * 43758.5453) < 0.3;
        const f = shade[x] * (win ? 0.75 : 1);
        rgb = lit ? [L * 3.2, L * 2.5, L * 1.6] : [L * f * 1.04, L * f, L * f * 0.95];
      } else {
        const r = Math.min(6, half(data[o])), g = Math.min(6, half(data[o + 1])), b = Math.min(6, half(data[o + 2]));
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        rgb = [r, g, b].map((v) => L + (v - L) * 0.75);
      }
      for (let c = 0; c < 3; c++) rout[o + c] = toH(rgb[c]);
      rout[o + 3] = toH(1);
    }
  }
  const rt = new THREE.DataTexture(rout, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  rt.mapping = THREE.EquirectangularReflectionMapping;
  rt.colorSpace = tex.colorSpace;
  rt.flipY = tex.flipY;
  rt.needsUpdate = true;
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(ibl).texture;
  const refl = pm.fromEquirectangular(rt).texture;
  pm.dispose();
  ibl.dispose();
  rt.dispose();
  return { tex, env, refl, sunAz, sunEl, lum: lum(all), horizon: hor, zenith: zen };
}

function frac(v: number) {
  return v - Math.floor(v);
}

export class SkySystem {
  /** the reflection map for shiny things (see loadPhoto) and how bright to take it: scene.environmentIntensity, read after update */
  refl: THREE.Texture | null = null;
  time = 10.5;
  /** game hours advanced per real second */
  rate = 1 / 45;
  readonly sunDir = new THREE.Vector3();
  readonly moonDir = new THREE.Vector3();
  readonly zenith = new THREE.Color();
  readonly horizon = new THREE.Color();
  readonly sunColor = new THREE.Color();
  night = 0;
  day = 1;
  sunset = 0;
  /** what the post chain multiplies the frame by */
  exposure = 1;
  /** weather: 0 clear .. 1 a downpour, easing toward rainTarget; showers come and go by themselves */
  rain = 0;
  rainTarget = 0;
  private weatherT = 90 + Math.random() * 120;
  forceWeather: 'rain' | 'clear' | 'storm' | null = null;
  /** a thunderstorm: the heaviest showers bring lightning */
  storm = false;
  /** lightning flash, 0..1 (decays fast, flickers) */
  flash = 0;
  /** called on each strike with the distance to it (thunder follows at the speed of sound) */
  onStrike: ((dist: number) => void) | null = null;
  private strikeT = 4;
  private flicker = 0;
  private bolt: THREE.Mesh | null = null;
  private readonly boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.4, 4.2), transparent: true, fog: false, depthWrite: false });
  light: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  ready: Promise<void>;
  private photos: Photo[] = [];
  private shadowSize = 70;
  private curEnv: THREE.Texture | null = null;

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.uniforms = {
      tA: { value: null },
      tB: { value: null },
      uRotA: { value: 0 },
      uRotB: { value: 0 },
      uPSunA: { value: new THREE.Vector3(0, 1, 0) },
      uPSunB: { value: new THREE.Vector3(0, 1, 0) },
      uMix: { value: 0 },
      uLevel: { value: 1 },
      uHasPhoto: { value: 0 },
      uZenith: { value: this.zenith },
      uHorizon: { value: this.horizon },
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uSunColor: { value: this.sunColor },
      uSunI: { value: 1 },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uGrey: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.mesh.scale.setScalar(2000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    this.light = new THREE.DirectionalLight(0xffffff, 3);
    this.light.castShadow = true;
    const s = this.light.shadow;
    s.mapSize.set(4096, 4096);
    s.camera.left = -this.shadowSize;
    s.camera.right = this.shadowSize;
    s.camera.top = this.shadowSize;
    s.camera.bottom = -this.shadowSize;
    s.camera.near = 1;
    s.camera.far = 500;
    // layer 1 holds the cheap shadow stand-ins (world/city.ts chunked shadowGeo); the main camera enables
    // it too (three tests casters against it) and their material draws nothing on screen
    s.camera.layers.enable(1);
    s.bias = -0.0003;
    s.normalBias = 0.03;
    s.radius = 2.5;
    scene.add(this.light);
    scene.add(this.light.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a7a60, 0.0);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xcfe0ea, 0.0011);
    this.compute();
    this.ready = Promise.all(PHOTOS.map((n) => loadPhoto(renderer, n)))
      .then((p) => {
        this.photos = p;
        this.uniforms.uHasPhoto.value = 1;
        this.compute();
      })
      .catch((e) => console.warn('palmera: sky photos failed, using the drawn sky', e));
  }

  setTime(h: number) {
    this.time = ((h % 24) + 24) % 24;
    this.compute();
  }

  /** the sun's azimuth in the photo frame (matches photo() in the shader) */
  private sunAz() {
    return Math.atan2(this.sunDir.z, this.sunDir.x);
  }

  private compute() {
    const a = ((this.time - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.93, 0.36).normalize();
    this.moonDir.set(-Math.cos(a) * 0.9, -Math.sin(a) * 0.85 + 0.15, -0.3).normalize();
    const e = this.sunDir.y;
    this.day = smoothstep(-0.06, 0.2, e);
    this.night = 1 - smoothstep(-0.14, 0.04, e);
    this.sunset = 1 - smoothstep(0.02, 0.38, Math.abs(e - 0.04));
    this.sunColor.setRGB(1.0, lerp(0.88, 0.55, this.sunset), lerp(0.74, 0.3, this.sunset));

    // which photos, how much of each, and how bright
    const u = this.uniforms;
    let ia = 0, ib = 0, m = 0;
    if (e > 0.45) { ia = ib = 0; }
    else if (e > 0.25) { ia = 0; ib = 1; m = smoothstep(0.45, 0.25, e); }
    else if (e > 0.08) { ia = 1; ib = 2; m = smoothstep(0.25, 0.08, e); }
    else if (e > -0.06) { ia = 2; ib = 3; m = smoothstep(0.08, -0.06, e); }
    else { ia = ib = 3; }
    // level: the afternoon photo as it is; the others brought to a target brightness that falls
    // through dusk to night
    const target = lerp(0.006, 1, smoothstep(-0.2, 0.25, e)) * lerp(1, 0.75, this.sunset);
    if (this.photos.length === PHOTOS.length) {
      const pa = this.photos[ia], pb = this.photos[ib];
      const base = this.photos[0].lum;
      const pl = lerp(pa.lum, pb.lum, m) / base;
      u.tA.value = pa.tex;
      u.tB.value = pb.tex;
      const az = this.sunAz();
      u.uRotA.value = pa.sunAz - az;
      u.uRotB.value = pb.sunAz - az;
      // where each photo's own sun lands in the game's sky: the game sun's bearing, the photo's height
      (u.uPSunA.value as THREE.Vector3).set(Math.cos(pa.sunEl) * Math.cos(az), Math.sin(pa.sunEl), Math.cos(pa.sunEl) * Math.sin(az));
      (u.uPSunB.value as THREE.Vector3).set(Math.cos(pb.sunEl) * Math.cos(az), Math.sin(pb.sunEl), Math.cos(pb.sunEl) * Math.sin(az));
      u.uMix.value = m;
      u.uLevel.value = target / Math.max(1e-4, pl);
      const k = u.uLevel.value as number;
      this.horizon.copy(pa.horizon).lerp(pb.horizon, m).multiplyScalar(k);
      this.zenith.copy(pa.zenith).lerp(pb.zenith, m).multiplyScalar(k);
      const env = m < 0.5 ? pa.env : pb.env;
      if (env !== this.curEnv) {
        this.curEnv = env;
        this.scene.environment = env;
      }
      // never fully dark: the city's glow and the moon keep a little light in the reflections
      this.scene.environmentIntensity = Math.max(target / Math.max(1e-4, (m < 0.5 ? pa.lum : pb.lum) / base), 0.08 * this.night);
      this.refl = m < 0.5 ? pa.refl : pb.refl;
    } else {
      const dayZ = new THREE.Color(0.1, 0.32, 0.78), dayH = new THREE.Color(0.6, 0.76, 0.9);
      this.zenith.copy(dayZ).multiplyScalar(target);
      this.horizon.copy(dayH).multiplyScalar(target);
    }
  }

  /** morning mist: how thick it is on this day (0 on clear mornings), and how much is out now */
  mistDay = 0;
  mist = 0;
  forceMist = false;

  update(dt: number, focus: THREE.Vector3, camPos: THREE.Vector3, _renderer: THREE.WebGLRenderer, elapsed: number) {
    const before = this.time;
    this.time = (this.time + dt * this.rate) % 24;
    // a new day: some mornings come up misty
    if (this.time < before) this.mistDay = Math.random() < 0.45 ? 0.55 + Math.random() * 0.45 : 0;
    if (this.forceMist) this.mistDay = 1;
    // it rises before dawn, lies thickest from 6 to 7:30 and burns off by about 9
    this.mist = (this.mistDay * smoothstep(4.8, 6.0, this.time) * (1 - smoothstep(7.4, 9.2, this.time)));
    this.compute();
    const u = this.uniforms;
    u.uNight.value = this.night;
    u.uTime.value = elapsed;
    u.uSunI.value = this.day;
    this.mesh.position.copy(camPos);

    const useSun = this.sunDir.y > -0.03;
    const dir = useSun ? this.sunDir : this.moonDir;
    const L = this.light;
    if (useSun) {
      L.color.copy(this.sunColor);
      L.intensity = 8.5 * smoothstep(-0.03, 0.12, this.sunDir.y) * lerp(1, 0.7, this.sunset) + 0.02;
    } else {
      L.color.setRGB(0.55, 0.65, 1.0);
      L.intensity = 0.05 * this.night;
    }
    // snap the shadow frustum to texels to stop shimmering
    const texel = (this.shadowSize * 2) / this.light.shadow.mapSize.x;
    const fwd = dir.clone().negate();
    const up = Math.abs(fwd.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const up2 = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const pr = Math.round(focus.dot(right) / texel) * texel;
    const pu = Math.round(focus.dot(up2) / texel) * texel;
    const pf = focus.dot(fwd);
    const snapped = right.multiplyScalar(pr).add(up2.multiplyScalar(pu)).add(fwd.clone().multiplyScalar(pf));
    L.target.position.copy(snapped);
    L.position.copy(snapped).addScaledVector(dir, 220);
    L.target.updateMatrixWorld();

    // a little fill under the IBL at night (the dusk photo dimmed to black leaves nothing)
    this.hemi.color.setRGB(0.3, 0.38, 0.65);
    this.hemi.groundColor.setRGB(0.12, 0.1, 0.08);
    this.hemi.intensity = 0.2 * this.night;

    // weather
    this.weatherT -= dt;
    if (this.forceWeather) {
      this.rainTarget = this.forceWeather === 'clear' ? 0 : 1;
      this.storm = this.forceWeather === 'storm';
    } else if (this.weatherT <= 0) {
      const raining = this.rainTarget > 0;
      this.rainTarget = raining ? 0 : Math.random() < 0.45 ? 0.6 + Math.random() * 0.4 : 0;
      // about a third of the heavy showers are thunderstorms
      this.storm = this.rainTarget > 0.85 && Math.random() < 0.6;
      this.weatherT = raining ? 150 + Math.random() * 240 : this.rainTarget > 0 ? 60 + Math.random() * 90 : 120 + Math.random() * 200;
    }
    this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.08);
    const rn = this.rain;
    this.lightning(dt, camPos);
    u.uGrey.value = rn;
    u.uLevel.value = (u.uLevel.value as number) * lerp(1, 0.66, rn);
    this.horizon.multiplyScalar(lerp(1, 0.7, rn));
    this.zenith.multiplyScalar(lerp(1, 0.45, rn));
    L.intensity *= 1 - 0.85 * rn;
    u.uSunI.value = (u.uSunI.value as number) * (1 - rn);
    this.scene.environmentIntensity *= lerp(1, 0.7, rn);
    this.hemi.intensity += 0.25 * rn * this.day;
    const fog = this.scene.fog as THREE.FogExp2;
    // haze: the horizon's colour pulled toward the sky's blue (a white fog bleaches the skyline)
    fog.color.copy(this.horizon).lerp(this.zenith, 0.45).multiplyScalar(0.85);
    fog.density = lerp(0.00032, 0.0008, this.night) + this.sunset * 0.00012 + rn * 0.0032;
    // haze sits low: from a rooftop or a helicopter you see through more of it
    fog.density /= 1 + Math.max(0, camPos.y - 25) / 85;
    fog.color.lerp(new THREE.Color(0.5, 0.53, 0.57).multiplyScalar(0.15 + 0.85 * this.day), rn * 0.8);
    // morning mist: a pale, sun-warmed haze lying low over the streets and the water (thinning with height as above)
    if (this.mist > 0.001) {
      const m = this.mist * (1 - rn);
      fog.density += m * 0.011 / (1 + Math.max(0, camPos.y - 12) / 30);
      // and the sky goes milky toward the horizon
      u.uGrey.value = Math.max(u.uGrey.value as number, m * 0.3);
      fog.color.lerp(new THREE.Color(0.9, 0.84, 0.76).multiplyScalar(0.55 + 0.45 * this.day), m * 0.75);
    }
    // exposure: keep the frame bright as the light falls (eyes adapt), but let night be night
    const e = this.sunDir.y;
    this.exposure = lerp(1, 1.5, 1 - smoothstep(-0.18, 0.2, e)) * lerp(1, 1.12, this.sunset);
    // a strike lights up everything for a moment (more so at night)
    if (this.flash > 0.001) {
      const f = this.flash * (0.6 + this.night * 0.8);
      this.hemi.color.lerp(new THREE.Color(0.75, 0.82, 1), Math.min(1, f));
      this.hemi.intensity += f * 1.1;
      this.scene.environmentIntensity += f * 0.6;
      u.uLevel.value = (u.uLevel.value as number) + f * 0.9;
      fog.color.lerp(new THREE.Color(0.5, 0.54, 0.66), Math.min(0.45, f * 0.6));
    }
  }

  /** storms: every 5-18 s a bolt somewhere out over the city or the sea, with a double flash */
  private lightning(dt: number, cam: THREE.Vector3) {
    this.flicker -= dt;
    if (this.flicker <= 0 && this.flash > 0.5) this.flash *= Math.exp(-dt * 14);
    else this.flash *= Math.exp(-dt * 7);
    if (this.flicker > -0.12 && this.flicker < -0.05 && this.flash < 0.4 && this.bolt?.visible) this.flash = 0.8; // the restrike
    if (this.bolt) {
      this.boltMat.opacity = Math.min(1, this.flash * 1.6);
      this.bolt.visible = this.flash > 0.08;
    }
    if (!this.storm || this.rain < 0.7) return;
    this.strikeT -= dt;
    if (this.strikeT > 0) return;
    this.strikeT = 5 + Math.random() * 13;
    const a = Math.random() * Math.PI * 2, d = 260 + Math.random() * 700;
    const bx = cam.x + Math.sin(a) * d, bz = cam.z + Math.cos(a) * d;
    // a jagged channel from the cloud base down, with a couple of forks
    const pts: THREE.Vector3[] = [];
    let x = bx, z = bz;
    for (let y = 420; y > 0; y -= 18 + Math.random() * 22) {
      pts.push(new THREE.Vector3(x, y, z));
      x += (Math.random() - 0.5) * 34;
      z += (Math.random() - 0.5) * 34;
    }
    pts.push(new THREE.Vector3(x, 0, z));
    const geos: THREE.BufferGeometry[] = [];
    const tube = (p: THREE.Vector3[], r: number) => {
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 0; i < p.length - 1; i++) path.add(new THREE.LineCurve3(p[i], p[i + 1]));
      geos.push(new THREE.TubeGeometry(path, p.length * 2, r, 3, false));
    };
    tube(pts, 4);
    for (let k = 0; k < 2; k++) {
      const i = 2 + Math.floor(Math.random() * (pts.length - 4));
      const fork = [pts[i].clone()];
      for (let j = 0; j < 4; j++) {
        const q = fork[fork.length - 1];
        fork.push(new THREE.Vector3(q.x + (Math.random() - 0.5) * 50, q.y - 20 - Math.random() * 25, q.z + (Math.random() - 0.5) * 50));
      }
      tube(fork, 2.2);
    }
    if (this.bolt) {
      this.scene.remove(this.bolt);
      this.bolt.geometry.dispose();
    }
    this.bolt = new THREE.Mesh(mergeGeometries(geos), this.boltMat);
    for (const g of geos) g.dispose();
    this.bolt.frustumCulled = false;
    this.bolt.renderOrder = 2;
    this.scene.add(this.bolt);
    this.flash = 1;
    this.flicker = 0.1;
    this.onStrike?.(d);
  }

  clockString(): string {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    const ap = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${m.toString().padStart(2, '0')} ${ap}`;
  }
}
