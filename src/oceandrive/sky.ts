import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { U, LAMPS } from './materials.ts';
import { SEA } from './water.ts';
import type { Env } from './env.ts';

/**
 * Time of day and weather. Four times (afternoon, golden-hour sunset, blue hour, night) and three
 * weathers (clear, clouds, rain) make twelve looks, each built from a real sky photo (Poly Haven,
 * CC0) plus what's drawn over it: a cloud layer lit by the sun, stars, rain, lightning.
 *
 * Every sky photo is measured when it loads: where its sun is (the photo is turned so that sun sits
 * where the game's sun is, and the sun's height is taken from it), how much light the sun disc
 * carries (its irradiance, integrated over the disc), how much the rest of the sky gives, and the
 * colour of the horizon haze (the fog takes it). So the light on the street, the reflections, the
 * fog and the backdrop all come from the same sky.
 *
 * Switching blends every number over a few seconds; the photo itself swaps at once.
 */

const BASE = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'oceandrive/';

export type TimeOfDay = 'day' | 'sunset' | 'dusk' | 'night';
export type Weather = 'clear' | 'clouds' | 'rain';
export const TIMES: TimeOfDay[] = ['day', 'sunset', 'dusk', 'night'];
export const WEATHERS: Weather[] = ['clear', 'clouds', 'rain'];
export const TIME_LABEL: Record<TimeOfDay, string> = { day: 'Afternoon', sunset: 'Golden hour', dusk: 'Blue hour', night: 'Night' };
export const WEATHER_LABEL: Record<Weather, string> = { clear: 'Clear', clouds: 'Clouds', rain: 'Storm' };

const SKY = {
  afternoon: 'qwantani_late_afternoon_puresky',
  sunset: 'qwantani_sunset_puresky',
  dusk: 'qwantani_dusk_2_puresky',
  cloudy: 'kloofendal_48d_partly_cloudy_puresky',
  overcast: 'kloofendal_overcast_puresky',
};

export interface SkyInfo {
  name: string;
  hdr: THREE.DataTexture;
  env: THREE.Texture;
  /** the sun's height in the photo (rad); its irradiance (0 if there's no disc) */
  sunEl: number;
  sunE: THREE.Vector3;
  /** irradiance from the rest of the sky on a level surface, and the horizon colour */
  skyE: THREE.Vector3;
  horizon: THREE.Vector3;
}

/** the numbers a look is made of */
interface Look {
  sky: keyof typeof SKY;
  k: number; // photo level (relative to its own measured sky)
  sun: number; // sun on (× the photo's own disc)
  sunTint: [number, number, number]; // drawn disc colour
  lm: [number, number, number]; // baked light
  env: number;
  night: number;
  exposure: number;
  clouds: number;
  cloudLit: [number, number, number];
  cloudAmb: [number, number, number];
  stars: number;
  wet: number;
  rain: number;
  sea: number;
  grey: number;
  fog: number;
  haze: number;
  lamps: number;
  wind: number;
  lightning: number;
  moon: number; // night: the moon carries the directional light
}

const L = (o: Partial<Look> & Pick<Look, 'sky'>): Look => ({
  k: 1, sun: 1, sunTint: [1, 0.86, 0.66], lm: [1.55, 1.52, 1.5], env: 1, night: 0, exposure: 1, clouds: 0,
  cloudLit: [1.6, 1.5, 1.4], cloudAmb: [0.7, 0.75, 0.85], stars: 0, wet: 0, rain: 0, sea: 1, grey: 0, fog: 0.0009,
  haze: 0, lamps: 0, wind: 0.3, lightning: 0, moon: 0, ...o,
});

// k: the photo's level as stored (each photo was exposed differently)
const LOOKS: Record<TimeOfDay, Record<Weather, Look>> = {
  day: {
    clear: L({ sky: 'afternoon' }),
    clouds: L({ sky: 'cloudy', k: 1.0, sun: 0.8, lm: [1.45, 1.45, 1.47], clouds: 0.12, cloudLit: [1.8, 1.75, 1.7], cloudAmb: [0.9, 0.95, 1.05], fog: 0.0012, wind: 0.6 }),
    rain: L({ sky: 'overcast', k: 0.3, sun: 0, lm: [1.15, 1.18, 1.24], env: 1, exposure: 1.6, wet: 1, rain: 1, sea: 2.3, grey: 1, fog: 0.0065, haze: 0.55, lamps: 0.12, wind: 1.3, lightning: 0.4 }),
  },
  sunset: {
    clear: L({ sky: 'sunset', k: 0.55, sun: 1, sunTint: [1, 0.62, 0.32], lm: [1.5, 1.3, 1.22], env: 1, exposure: 1.4, night: 0.2, fog: 0.0012, lamps: 0.35 }),
    clouds: L({ sky: 'sunset', k: 0.52, sun: 0.85, sunTint: [1, 0.6, 0.3], lm: [1.42, 1.22, 1.16], env: 1, exposure: 1.45, night: 0.25, clouds: 0.55, cloudLit: [2.2, 1.0, 0.5], cloudAmb: [0.45, 0.36, 0.5], fog: 0.0014, lamps: 0.45, wind: 0.6 }),
    rain: L({ sky: 'overcast', k: 0.16, sun: 0, lm: [0.42, 0.38, 0.38], env: 1, exposure: 2.2, night: 0.6, wet: 1, rain: 1, sea: 2.3, grey: 1, fog: 0.0065, haze: 0.55, lamps: 0.85, wind: 1.3, lightning: 0.7 }),
  },
  dusk: {
    clear: L({ sky: 'dusk', k: 0.13, sun: 0, lm: [0.24, 0.22, 0.36], env: 0.7, night: 1, exposure: 2.6, fog: 0.0011, lamps: 1 }),
    clouds: L({ sky: 'dusk', k: 0.12, sun: 0, lm: [0.22, 0.2, 0.33], env: 0.7, night: 1, exposure: 2.6, clouds: 0.5, cloudLit: [0.05, 0.03, 0.045], cloudAmb: [0.035, 0.035, 0.055], fog: 0.0013, lamps: 1, wind: 0.6 }),
    rain: L({ sky: 'overcast', k: 0.035, sun: 0, lm: [0.14, 0.14, 0.2], env: 1, night: 1, exposure: 2.9, wet: 1, rain: 1, sea: 2.3, grey: 1, fog: 0.006, haze: 0.5, lamps: 1.1, wind: 1.3, lightning: 1 }),
  },
  night: {
    clear: L({ sky: 'dusk', k: 0.022, sun: 0, moon: 1, lm: [0.055, 0.055, 0.095], env: 0.8, night: 1, exposure: 3.6, stars: 1, fog: 0.0009, lamps: 1.35, wet: 0.5 }),
    clouds: L({ sky: 'dusk', k: 0.02, sun: 0, moon: 0.6, lm: [0.05, 0.05, 0.085], env: 0.8, night: 1, exposure: 3.6, stars: 0.35, clouds: 0.55, cloudLit: [0, 0, 0], cloudAmb: [0.014, 0.011, 0.012], fog: 0.0011, lamps: 1.35, wind: 0.6, wet: 0.3 }),
    rain: L({ sky: 'overcast', k: 0.022, sun: 0, lm: [0.05, 0.05, 0.075], env: 0.9, night: 1, exposure: 3.8, wet: 1, rain: 1, sea: 2.3, grey: 1, fog: 0.0055, haze: 0.5, lamps: 1.4, wind: 1.3, lightning: 1 }),
  },
};

/** numbers that blend (everything but the photo) */
const KEYS = ['k', 'sun', 'moon', 'env', 'night', 'exposure', 'clouds', 'stars', 'wet', 'rain', 'sea', 'grey', 'fog', 'haze', 'lamps', 'wind', 'lightning'] as const;
const VKEYS = ['sunTint', 'lm', 'cloudLit', 'cloudAmb'] as const;

export class Sky {
  time: TimeOfDay = 'day';
  weather: Weather = 'clear';
  private infos = new Map<string, Promise<SkyInfo>>();
  private cur: Look = LOOKS.day.clear;
  private from: Look = LOOKS.day.clear;
  private to: Look = LOOKS.day.clear;
  private t = 1;
  private info: SkyInfo | null = null;
  private norm = 1; // the afternoon sky's luminance (levels are relative to it)
  /** lightning: the flash now, and when the next one comes */
  flash = 0;
  private nextBolt = 8;
  private boltT = -1;
  /** called with the thunder's delay (s) when a bolt strikes */
  onThunder: ((delay: number, loud: number) => void) | null = null;
  /** what the rest of the game reads each frame */
  readonly out = { exposure: 1, fogDensity: 0.0009, fogColor: new THREE.Vector3(0.7, 0.75, 0.8), sunScatter: new THREE.Vector3(), rain: 0, wet: 0, lamps: 0, night: 0, lightsOn: false };

  /** light thrown back up off the sunlit pavement and sand: what fills the undersides (awnings, cars, palm crowns) */
  readonly bounce = new THREE.HemisphereLight(0x000000, 0xb59a7a, 0);
  constructor(readonly env: Env, readonly renderer: THREE.WebGLRenderer) {
    env.scene.add(this.bounce);
  }

  private load(key: keyof typeof SKY): Promise<SkyInfo> {
    const name = SKY[key];
    let p = this.infos.get(name);
    if (!p) {
      p = loadSkyInfo(this.renderer, name);
      this.infos.set(name, p);
    }
    return p;
  }

  async init(time: TimeOfDay, weather: Weather) {
    const a = await this.load('afternoon');
    this.norm = lum(a.skyE);
    this.time = time;
    this.weather = weather;
    const look = LOOKS[time][weather];
    const info = await this.load(look.sky);
    this.from = this.to = this.cur = look;
    this.t = 1;
    this.swap(info);
    this.applyLook(look);
    // the others load in the background
    for (const k of Object.keys(SKY) as (keyof typeof SKY)[]) void this.load(k);
  }

  async set(time: TimeOfDay, weather: Weather) {
    this.time = time;
    this.weather = weather;
    const look = LOOKS[time][weather];
    const info = await this.load(look.sky);
    if (this.time !== time || this.weather !== weather) return;
    this.from = { ...this.cur };
    this.to = look;
    this.t = 0;
    // a new photo: its level relative to the old one is carried by k (blend from where it looked the same)
    if (info !== this.info) {
      const old = this.info ? lum(this.info.skyE) * this.from.k : 1;
      this.swap(info);
      this.from.k = old / Math.max(1e-4, lum(info.skyE));
    }
  }

  /** the photo's sky level in units of the afternoon's */
  private skyLum(i: SkyInfo) {
    return lum(i.skyE) / this.norm;
  }

  private swap(info: SkyInfo) {
    this.info = info;
    const e = this.env;
    e.hdr = info.hdr;
    e.envMap = info.env;
    e.scene.environment = info.env;
    e.domeMat.uniforms.tSky.value = info.hdr;
    // the sun at the photo's own height (overcast photos keep the last one)
    if (info.sunE.length() > 0.5) {
      const el = Math.max(info.sunEl, THREE.MathUtils.degToRad(2.5));
      const az = THREE.MathUtils.degToRad(-36);
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el));
      // while the moon is up the sun's direction waits for it to set
      if (this.moonUp) this.sunDirSaved.copy(dir);
      else {
        e.toSun.copy(dir);
        U.uSunDir.value.copy(e.toSun);
        e.csm.lightDirection.copy(e.toSun).negate();
      }
    }
    this.listeners.forEach((f) => f(info));
  }

  private readonly listeners: ((i: SkyInfo) => void)[] = [];
  onSwap(f: (i: SkyInfo) => void) {
    this.listeners.push(f);
  }

  get hdr() {
    return this.info?.hdr ?? null;
  }

  private applyLook(l: Look) {
    const info = this.info!;
    const e = this.env;
    // k scales the photo as stored; its light in afternoon units is k × its measured level
    const k = l.k;
    const d = e.domeMat.uniforms;
    d.uK.value = k;
    d.uSunK.value = Math.min(1, l.sun) * (info.sunE.length() > 0.5 ? 1 : 0);
    d.uSunTint.value.set(...l.sunTint);
    d.uCloud.value = l.clouds;
    d.uCloudLit.value.set(...l.cloudLit);
    d.uCloudAmb.value.set(...l.cloudAmb);
    d.uStars.value = l.stars;
    d.uHaze.value = l.haze;
    d.uHazeCol.value.copy(info.horizon).multiplyScalar(k * 0.9);
    // the sun: the photo's disc, as the directional light
    const sunE = new THREE.Vector3().copy(info.sunE).multiplyScalar(l.sun * (k > 0 ? Math.min(1.6, k) : 0) * (1 - 0.5 * l.clouds));
    const mx = Math.max(sunE.x, sunE.y, sunE.z);
    for (const lt of e.csm.lights) {
      lt.intensity = mx;
      if (mx > 0) lt.color.setRGB(sunE.x / mx, sunE.y / mx, sunE.z / mx);
    }
    // moonlight: a cool, faint directional light from high in the south-east, with shadows
    if (l.moon > 0.01) {
      sunE.set(0.11, 0.13, 0.19).multiplyScalar(l.moon);
      const mm = Math.max(sunE.x, sunE.y, sunE.z);
      for (const lt of e.csm.lights) {
        lt.intensity = mm;
        lt.color.setRGB(sunE.x / mm, sunE.y / mm, sunE.z / mm);
      }
    }
    this.setMoon(l.moon > 0.5);
    d.uMoon.value = l.moon;
    d.uNightSky.value = this.time === 'night' ? Math.min(1, l.night) * 0.9 : 0;
    U.uSunCol.value.copy(sunE);
    // the image light is the same photo: it takes the photo's level too
    e.scene.environmentIntensity = l.env * k;
    // the ground's bounce: the sunlight's colour off warm pale stone, about a fifth of the direct light
    this.bounce.groundColor.setRGB(0.71 * sunE.x, 0.6 * sunE.y, 0.48 * sunE.z).multiplyScalar(0.32 / Math.max(1e-3, Math.max(sunE.x, sunE.y, sunE.z)));
    this.bounce.intensity = Math.max(sunE.x, sunE.y, sunE.z) * 0.9 + l.lamps * 0.05;
    U.uNight.value = l.night;
    U.uSkyK.value = k * this.skyLum(info);
    U.uLmTint.value.set(l.lm[0] + this.flash * 0.6, l.lm[1] + this.flash * 0.65, l.lm[2] + this.flash * 0.8);
    U.uWet.value = l.wet;
    U.uRain.value = l.rain;
    U.uWind.value = l.wind;
    U.uLampK.value = l.lamps;
    d.uFlash.value = this.flash * Math.max(0.02, k) * 3;
    SEA.uSeaState.value = l.sea;
    SEA.uGrey.value = l.grey;
    SEA.uSkyPhotoK.value = k;
    (SEA.uSkyE.value as THREE.Vector3).copy(info.skyE).multiplyScalar(k);
    const o = this.out;
    o.exposure = l.exposure;
    o.fogDensity = l.fog;
    o.fogColor.copy(info.horizon).multiplyScalar(k);
    o.sunScatter.copy(sunE).multiplyScalar(0.06);
    o.rain = l.rain;
    o.wet = l.wet;
    o.lamps = l.lamps;
    o.night = l.night;
    o.lightsOn = l.lamps > 0.3 || l.rain > 0.5;
  }

  update(dt: number) {
    if (!this.info) return;
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / 3);
      const s = this.t * this.t * (3 - 2 * this.t);
      const c = { ...this.to } as Look;
      for (const key of KEYS) c[key] = this.from[key] + (this.to[key] - this.from[key]) * s;
      for (const key of VKEYS) c[key] = this.from[key].map((v, i) => v + (this.to[key][i] - v) * s) as [number, number, number];
      this.cur = c;
    }
    // lightning in a storm: a bolt every 6–20 s, two or three pulses, thunder after
    const lt = this.cur.lightning;
    if (lt > 0.05) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.boltT = 0;
        this.nextBolt = 6 + Math.random() * 14;
        const dist = 0.5 + Math.random() * 3;
        this.onThunder?.(dist, lt * (1.3 - dist / 4));
      }
    }
    if (this.boltT >= 0) {
      this.boltT += dt;
      const b = this.boltT;
      this.flash = lt * (Math.exp(-((b - 0.05) ** 2) / 0.002) * 1 + Math.exp(-((b - 0.22) ** 2) / 0.001) * 0.6 + Math.exp(-((b - 0.4) ** 2) / 0.003) * 0.8);
      if (b > 0.8) {
        this.boltT = -1;
        this.flash = 0;
      }
    }
    this.applyLook(this.cur);
  }

  private moonUp = false;
  private sunDirSaved = new THREE.Vector3();
  /** at night the light (and the drawn disc) moves to the moon */
  private setMoon(on: boolean) {
    if (on === this.moonUp) return;
    this.moonUp = on;
    const e = this.env;
    if (on) {
      this.sunDirSaved.copy(e.toSun);
      const az = THREE.MathUtils.degToRad(-70), el = THREE.MathUtils.degToRad(38);
      e.toSun.set(Math.cos(az) * Math.cos(el), Math.sin(el), -Math.sin(az) * Math.cos(el));
    } else e.toSun.copy(this.sunDirSaved);
    U.uSunDir.value.copy(e.toSun);
    e.csm.lightDirection.copy(e.toSun).negate();
  }

  /** the lamps nearest the eye, into the shared uniform */
  setLamps(eye: THREE.Vector3, list: THREE.Vector4[]) {
    const arr = U.uLamps.value;
    if (this.out.lamps <= 0) return;
    list.sort((a, b) => (a.x - eye.x) ** 2 + (a.z - eye.z) ** 2 - ((b.x - eye.x) ** 2 + (b.z - eye.z) ** 2));
    for (let i = 0; i < LAMPS; i++) {
      const l = list[i];
      if (l) arr[i].copy(l);
      else arr[i].set(0, -100, 0, 0);
    }
  }
}

function lum(v: THREE.Vector3) {
  return 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
}

/** load a sky photo, turn it so its sun sits at the game's sun azimuth, and measure it */
async function loadSkyInfo(renderer: THREE.WebGLRenderer, name: string): Promise<SkyInfo> {
  const src = await new HDRLoader().setDataType(THREE.HalfFloatType).loadAsync(BASE + 'sky/' + name + '.hdr');
  const img = src.image as { data: Uint16Array; width: number; height: number };
  const { data, width: w, height: h } = img;
  const half = THREE.DataUtils.fromHalfFloat;
  // the sun: the brightest texel (positive halfs order like their bits)
  let best = 0, bi = 1;
  for (let i = 1; i < data.length; i += 4) if (data[i] > best) ((best = data[i]), (bi = i));
  const px = (bi - 1) >> 2;
  const sx = px % w, sy = Math.floor(px / w);
  // turn the photo: the sun's column to u = 0.6 (the game's sun azimuth in the shaders' mapping)
  const shift = (((Math.round(0.6 * w - (sx + 0.5)) % w) + w) % w);
  const rot = new Uint16Array(data.length);
  for (let y = 0; y < h; y++) {
    const r0 = y * w * 4;
    rot.set(data.subarray(r0, r0 + (w - shift) * 4), r0 + shift * 4);
    rot.set(data.subarray(r0 + (w - shift) * 4, r0 + w * 4), r0);
  }
  const hdr = new THREE.DataTexture(rot, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  hdr.flipY = src.flipY;
  hdr.minFilter = src.minFilter;
  hdr.magFilter = src.magFilter;
  hdr.generateMipmaps = src.generateMipmaps;
  hdr.colorSpace = src.colorSpace;
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  hdr.needsUpdate = true;
  src.dispose();
  const v = (y: number) => 1 - (y + 0.5) / h; // rows are stored top first
  const elOf = (y: number) => (v(y) - 0.5) * Math.PI;
  const dOm = (y: number) => ((2 * Math.PI) / w) * (Math.PI / h) * Math.cos(elOf(y));
  // the sun disc's irradiance: everything over the sky's level within ~3° of the peak
  const sunE = new THREE.Vector3();
  const cx = (sx + shift) % w;
  const rad = Math.ceil(w / 120);
  const peak = half(best);
  if (peak > 60) {
    for (let y = Math.max(0, sy - rad); y <= Math.min(h - 1, sy + rad); y++)
      for (let x = cx - rad; x <= cx + rad; x++) {
        const o = (y * w + ((x + w) % w)) * 4;
        const r = half(rot[o]), g = half(rot[o + 1]), b = half(rot[o + 2]);
        if (g < 30) continue;
        const k = dOm(y) * Math.max(0, Math.sin(elOf(y)) > -0.1 ? 1 : 0);
        sunE.x += (r - 20) * k;
        sunE.y += (g - 20) * k;
        sunE.z += (b - 20) * k;
      }
    // the irradiance on a surface facing the sun (not a level one)
  }
  // the rest of the sky on a level surface (sun clamped out), and the horizon's colour
  const skyE = new THREE.Vector3(), horizon = new THREE.Vector3();
  let hn = 0;
  for (let y = 0; y < h / 2; y += 2) {
    const el = elOf(y);
    const cz = Math.sin(el);
    const k = dOm(y) * cz * 4; // stride 2 × 2
    for (let x = 0; x < w; x += 2) {
      const o = (y * w + x) * 4;
      skyE.x += Math.min(20, half(rot[o])) * k;
      skyE.y += Math.min(20, half(rot[o + 1])) * k;
      skyE.z += Math.min(20, half(rot[o + 2])) * k;
    }
    if (el > 0.01 && el < 0.06) {
      for (let x = 0; x < w; x += 4) {
        const o = (y * w + x) * 4;
        horizon.x += Math.min(20, half(rot[o]));
        horizon.y += Math.min(20, half(rot[o + 1]));
        horizon.z += Math.min(20, half(rot[o + 2]));
        hn++;
      }
    }
  }
  horizon.multiplyScalar(1 / Math.max(1, hn));
  // the disc integration reads ~30 % low against the careful measurement the bake used for the
  // afternoon (9.18 / 7.38 / 5.23): scale the others alike; the afternoon gets the bake's own value
  if (name === 'qwantani_late_afternoon_puresky') sunE.set(9.18, 7.38, 5.23);
  else if (sunE.length() > 0) {
    sunE.multiplyScalar(1.425);
    sunE.z = Math.max(sunE.z, sunE.x * 0.12);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(clampForIBL(hdr, 20)).texture;
  pm.dispose();
  return { name, hdr, env, sunEl: elOf(sy), sunE, skyE, horizon };
}

/** a copy of the sky with the sun clamped out and the lower half dimmed to a ground's bounce (for the IBL) */
function clampForIBL(hdr: THREE.DataTexture, max: number): THREE.DataTexture {
  const img = hdr.image as { data: Uint16Array; width: number; height: number };
  const src = img.data;
  const out = new Uint16Array(src.length);
  const maxH = THREE.DataUtils.toHalfFloat(max);
  for (let i = 0; i < src.length; i++) out[i] = (i & 3) === 3 ? src[i] : src[i] > maxH ? maxH : src[i];
  const w = img.width, h = img.height;
  for (let y = 0; y < h; y++) {
    const v = 1 - (y + 0.5) / h;
    if (v >= 0.5) continue;
    const k = 0.22 + 0.78 * Math.max(0, (v - 0.47) / 0.03);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = THREE.DataUtils.toHalfFloat(THREE.DataUtils.fromHalfFloat(out[o + c]) * k * (c === 0 ? 1.05 : c === 2 ? 0.85 : 1));
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = hdr.colorSpace;
  t.flipY = hdr.flipY;
  t.needsUpdate = true;
  return t;
}
