import { planWeather, Weather, type TimeOfDay, type WeatherChoice, type WeatherKind } from '../world/Weather.ts';

/**
 * The race briefing's window onto race day: the grid seen from just behind the player's car, painted live
 * in the chosen weather and time — the sky and its clouds, the mountains fading into the haze, the
 * grandstand and its crowd, the pit building, the start gantry, the track running away round a long right
 * and the car on its slot. Rain darkens and mirrors the asphalt (the rain light blinks), snow whitens the
 * verges and the stand roof and leaves slush with two dark tyre tracks, hail bounces, sand streams across,
 * heat shimmers over the far straight, the floodlights come on at night. Every change eases across, so
 * picking a sky shows the weather rolling in.
 *
 * Canvas 2D in a simple pinhole projection (metres: x right, y up, z ahead); clouds go to a third-size
 * layer and are scaled up for their soft edges. It stops itself once it leaves the page.
 */

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixC = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mulC = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
/** an albedo (0 … 255) under a light (0 … ~1.2 per channel) */
const litC = (a: RGB, l: RGB): RGB => [a[0] * l[0], a[1] * l[1], a[2] * l[2]];
const css = (c: RGB, a = 1) => `rgba(${Math.max(0, Math.min(255, c[0])) | 0},${Math.max(0, Math.min(255, c[1])) | 0},${Math.max(0, Math.min(255, c[2])) | 0},${a})`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** the clear sky of each time: zenith, middle, horizon, the light it throws, the sun's place (0 … 1 across, 0 top … 1 horizon) */
const TIME_SKY: Record<TimeOfDay, { top: string; mid: string; hor: string; light: RGB; lum: number; x: number; y: number; night?: number }> = {
  dawn: { top: '#26325c', mid: '#76668e', hor: '#f2a47c', light: [1, 0.76, 0.62], lum: 0.58, x: 0.14, y: 0.9 },
  morning: { top: '#3570bd', mid: '#76a6da', hor: '#d6e6f2', light: [1, 0.97, 0.91], lum: 0.88, x: 0.24, y: 0.5 },
  midday: { top: '#2563c0', mid: '#5b95d8', hor: '#c4dcf0', light: [1, 1, 1], lum: 1, x: 0.5, y: 0.12 },
  afternoon: { top: '#2f6ebf', mid: '#689fd8', hor: '#d2e2ee', light: [1, 0.96, 0.88], lum: 0.96, x: 0.7, y: 0.3 },
  golden: { top: '#43649c', mid: '#a6a6b6', hor: '#f6c27e', light: [1, 0.82, 0.58], lum: 0.8, x: 0.8, y: 0.7 },
  sunset: { top: '#29376c', mid: '#9c6480', hor: '#f78a58', light: [1, 0.64, 0.46], lum: 0.62, x: 0.86, y: 0.92 },
  dusk: { top: '#111936', mid: '#3c3a64', hor: '#8a6283', light: [0.52, 0.52, 0.74], lum: 0.34, x: 0.94, y: 1.2, night: 0.55 },
  night: { top: '#03050c', mid: '#070b18', hor: '#151d32', light: [0.3, 0.36, 0.55], lum: 0.2, x: 0.64, y: 0.2, night: 1 },
};
/** the arc's stops, in order (also the briefing's time ruler) */
export const SKY_TIMES: TimeOfDay[] = ['dawn', 'morning', 'midday', 'afternoon', 'golden', 'sunset', 'dusk', 'night'];

interface Sky {
  top: RGB;
  mid: RGB;
  hor: RGB;
  /** the light on things (colour × level) */
  light: RGB;
  /** the sun's (or moon's) colour */
  sunC: RGB;
  /** the clouds' lit tops and shaded bellies */
  cLit: RGB;
  cShade: RGB;
  /** the distance colour: haze, fog, blown sand */
  fogC: RGB;
  sunX: number;
  sunY: number;
  sun: number;
  night: number;
  cloud: number;
  dark: number;
  rain: number;
  snow: number;
  hail: number;
  dust: number;
  /** how thick the distance is 0 … 1 */
  murk: number;
  heat: number;
  cover: number;
  wet: number;
  frost: number;
  /** a desert's ochre ground and dunes 0 … 1 */
  sand: number;
  wind: number;
  bolt: number;
  rainbow: number;
  /** the circuit's floodlights 0 … 1 */
  lamps: number;
}
const COLOURS = ['top', 'mid', 'hor', 'light', 'sunC', 'cLit', 'cShade', 'fogC'] as const;
const NUMBERS = ['sunX', 'sunY', 'sun', 'night', 'cloud', 'dark', 'rain', 'snow', 'hail', 'dust', 'murk', 'heat', 'cover', 'wet', 'frost', 'sand', 'wind', 'bolt', 'rainbow', 'lamps'] as const;

const dark0 = (wetFall: number, hail: number, conv: number) => clamp01(wetFall * 0.8 + hail * 0.5 + conv * 0.3);

/** what a weather + time looks like in the window (the fixed-seed roll the briefing quotes) */
function skyFor(kind: WeatherChoice, time: TimeOfDay): Sky {
  const T = TIME_SKY[time];
  const ws = kind === 'random' ? null : new Weather(planWeather(kind, time, 600, 7)).state;
  const k: WeatherKind = ws?.kind ?? 'cloudy';
  const cloud = ws?.cloud ?? 0.5;
  const rain = ws?.rain ?? 0;
  const snow = ws?.snow ?? 0;
  const hail = ws?.hail ?? 0;
  const dust = ws?.dust ?? 0;
  const fog = ws?.fog ?? 0;
  const cover = ws?.snowCover ?? 0;
  const night = T.night ?? 0;
  const ov = clamp01((cloud - 0.55) / 0.4);
  const wetFall = clamp01(rain * 1.6 + snow);
  let top = hex(T.top);
  let mid = hex(T.mid);
  let hor = hex(T.hor);
  // a deck greys the sky out (lighter under snow, darker under rain, green-grey in a hail cell)
  const lum = (0.3 + 0.7 * T.lum) * (1 - 0.45 * wetFall) * (1 + 0.25 * snow);
  const grey = (v: number): RGB => [v * lum, v * lum * 1.02, v * lum * 1.07];
  top = mixC(top, grey(132), ov * 0.92);
  mid = mixC(mid, grey(160), ov * 0.9);
  hor = mixC(hor, grey(186), ov * 0.88);
  if (hail > 0) {
    top = mixC(top, [44, 58, 54], 0.8 * hail);
    mid = mixC(mid, [70, 88, 80], 0.75 * hail);
    hor = mixC(hor, [104, 122, 110], 0.7 * hail);
  }
  if (dust > 0) {
    const dk = 0.4 + 0.6 * T.lum;
    top = mixC(top, mulC([104, 60, 30], dk), 0.92 * dust);
    mid = mixC(mid, mulC([170, 102, 52], dk), 0.92 * dust);
    hor = mixC(hor, mulC([206, 140, 78], dk), 0.92 * dust);
  }
  const hazeK = k === 'heatwave' ? 0.4 : k === 'haze' ? 0.55 : clamp01((fog - 0.3) / 0.6);
  if (hazeK > 0) {
    const pale = mulC([236, 232, 222], 0.35 + 0.65 * T.lum);
    hor = mixC(hor, mixC(hor, pale, 0.8), hazeK);
    mid = mixC(mid, hor, hazeK * 0.5);
    top = mixC(top, hor, hazeK * 0.3);
  }
  // the light on the ground: the time's colour, flattened and dimmed under cloud, rain and sand
  let lc = T.light;
  lc = mixC(lc, [0.86, 0.88, 0.93], ov * 0.85);
  if (hail > 0) lc = mixC(lc, [0.72, 0.84, 0.78], hail * 0.7);
  if (dust > 0) lc = mixC(lc, [1, 0.72, 0.46], dust * 0.85);
  const level = T.lum * (1 - 0.32 * ov - 0.22 * wetFall - 0.18 * hail - 0.3 * dust) * (1 + 0.2 * clamp01(cover));
  // (after dark the circuit's floodlights take over: a warm white, bright enough to race under)
  const lamps = clamp01(night * 1.6 + (T.lum < 0.7 ? dark0(wetFall, hail, ws?.conv ?? 0) * 0.6 : 0));
  const light = mixC(mulC(lc, Math.max(0.12, level) * 1.08), mulC([0.82, 0.78, 0.7], 1 - 0.3 * wetFall), lamps * 0.7 * clamp01(night * 1.4));
  const sunVis = (1 - ov) * (1 - 0.85 * dust) * (1 - clamp01(fog - 0.6) * 1.6) * (T.y > 1.1 ? 0 : 1);
  const moon = night > 0.6;
  const sunC: RGB = moon ? [214, 224, 255] : T.y > 0.62 ? [255, 186, 118] : [255, 246, 222];
  // clouds: lit tops warm with the low sun, bellies the horizon's colour, both dropping to slate in a storm
  const lit = 0.18 + 0.82 * (1 - night) * (0.4 + 0.6 * T.lum);
  const dark = dark0(wetFall, hail, ws?.conv ?? 0);
  let cLit = mulC(mixC([255, 255, 255], mulC(T.light, 255), 0.55), lit);
  let cShade = mixC(mulC(hor, 0.78), mulC([150, 156, 168], lit), 0.45);
  cLit = mixC(cLit, mulC([132, 138, 148], lit), dark * 0.85);
  cShade = mixC(cShade, mulC([50, 56, 64], lit), dark);
  if (dust > 0) {
    cLit = mixC(cLit, mulC([196, 128, 70], lit), dust);
    cShade = mixC(cShade, mulC([120, 70, 36], lit), dust);
  }
  if (hail > 0) cShade = mixC(cShade, mulC([46, 62, 56], lit), hail * 0.8);
  const fogC = mixC(hor, mid, 0.15);
  const murk = clamp01(Math.max(0, fog - 0.15) * 1.25 + dust * 0.95 + snow * 0.45 + rain * 0.3 + hazeK * 0.3);
  return {
    top,
    mid,
    hor,
    light,
    sunC,
    cLit,
    cShade,
    fogC,
    sunX: T.x,
    sunY: T.y,
    sun: kind === 'random' ? 0.3 : clamp01(sunVis),
    night,
    cloud: kind === 'random' ? 0.5 : cloud,
    dark,
    rain: k === 'sleet' ? rain * 0.6 : rain * (1 - hail),
    snow,
    hail,
    dust,
    murk,
    heat: clamp01(((ws?.heat ?? 0) - 0.5) / 1),
    cover,
    wet: clamp01(Math.max(ws?.wetness ?? 0, rain * 1.4, k === 'drying' ? 0.45 : 0)),
    frost: k === 'frost' ? 1 : 0,
    sand: dust > 0.3 ? 1 : k === 'heatwave' ? 0.45 : 0,
    wind: (ws ? Math.hypot(ws.windX, ws.windZ) : 3) * (ws && ws.windX < 0 ? -1 : 1),
    bolt: k === 'thunderstorm' || k === 'hail' ? 1 : k === 'storm' ? 0.4 : 0,
    rainbow: k === 'sunshower' && T.y < 0.95 && !moon ? 1 : 0,
    lamps,
  };
}
const copySky = (s: Sky): Sky => {
  const c = { ...s };
  for (const key of COLOURS) c[key] = [...s[key]] as RGB;
  return c;
};

/** a seeded random (the scenery stays put between frames and reloads) */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** a ridge line: midpoint displacement, n + 1 heights 0 … 1 */
function ridge(n: number, rough: number, R: () => number): number[] {
  const a = new Array(n + 1).fill(0);
  a[0] = R();
  a[n] = R();
  for (let step = n; step > 1; step >>= 1) {
    const amp = rough * (step / n);
    for (let i = step >> 1; i < n; i += step) a[i] = (a[i - (step >> 1)] + a[i + (step >> 1)]) / 2 + (R() - 0.5) * amp * 2;
  }
  const lo = Math.min(...a);
  const hi = Math.max(...a);
  return a.map((v) => (v - lo) / (hi - lo || 1));
}

interface P {
  x: number;
  y: number;
  /** depth 0 far … 1 near */
  d: number;
  v: number;
  ph: number;
  vy: number;
}

export interface SkyStage {
  readonly el: HTMLCanvasElement;
  set(kind: WeatherChoice, time: TimeOfDay): void;
  /** the player's team colour (the car on the grid) */
  tint(color: string): void;
}

// the circuit, in metres
const TW = 6.6; // half the track's width
const KERB = 1.1;
const RUNOFF = 6;
const Z_NEAR = 4.6; // the ground at the window's foot
const Z_CAR = 7.8;
const Z_GANTRY = 25;
/** the track's centre line: straight past the gantry, then a long right into the distance */
const curve = (z: number) => {
  const u = Math.max(0, z - 26);
  return u * u * 0.0105;
};

export function createSkyStage(): SkyStage {
  const cv = document.createElement('canvas');
  cv.className = 'sky-stage';
  const g = cv.getContext('2d')!;
  const cloudCv = document.createElement('canvas');
  const cg = cloudCv.getContext('2d')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cur: Sky | null = null;
  let to: Sky | null = null;
  let randomT = 0;
  let randomI = 0;
  let wantTime: TimeOfDay = 'afternoon';
  let wantKind: WeatherChoice = 'clear';
  let carC: RGB = [226, 32, 48];
  const RANDOM_CYCLE: WeatherKind[] = ['clear', 'rain', 'snow', 'fog', 'thunderstorm', 'sandstorm', 'cloudy', 'hail'];
  const R = rng(1977);
  const parts: P[] = Array.from({ length: 900 }, () => ({ x: R(), y: R(), d: Math.pow(R(), 0.8), v: 0.7 + R() * 0.6, ph: R() * 6.28, vy: 0 }));
  const splash: { x: number; y: number; t: number; d: number }[] = [];
  // cumulus: heaps of blobs (offsets in cloud widths), at three heights; the far ones smaller and slower
  const clouds = Array.from({ length: 13 }, (_, i) => {
    const layer = i % 3;
    const n = 9 + Math.floor(R() * 8);
    const blobs = Array.from({ length: n }, (_, j) => {
      const u = j / (n - 1) - 0.5;
      return { x: u * 0.9 + (R() - 0.5) * 0.12, y: -(0.5 - Math.abs(u)) * (0.35 + R() * 0.5) + R() * 0.05, r: 0.12 + (0.5 - Math.abs(u)) * 0.34 * (0.6 + R() * 0.6) };
    });
    return { x: R() * 1.4 - 0.2, y: [0.48, 0.3, 0.12][layer] + R() * 0.1, w: [0.16, 0.24, 0.36][layer] * (0.7 + R() * 0.6), layer, blobs };
  });
  const deck = Array.from({ length: 26 }, (_, i) => ({ x: i / 25 + (R() - 0.5) * 0.03, y: 0.12 + R() * 0.16, r: 0.06 + R() * 0.06 }));
  const ridgeFar = ridge(64, 0.9, R);
  const ridgeNear = ridge(64, 0.7, R);
  const trees = Array.from({ length: 140 }, () => 0.35 + R() * 0.65);
  const stars = Array.from({ length: 110 }, () => ({ x: R(), y: R() * 0.8, a: 0.25 + R() * 0.75, s: R() < 0.12 ? 1.6 : 1 }));
  const crowdPal: RGB[] = [[226, 34, 52], [240, 240, 244], [250, 200, 40], [40, 96, 220], [246, 120, 30], [30, 32, 38], [180, 30, 40], [70, 170, 90]];
  const crowd = Array.from({ length: 700 }, () => ({ u: R(), v: R(), c: crowdPal[Math.floor(R() * crowdPal.length)], k: 0.55 + R() * 0.45 }));
  const sparkle = Array.from({ length: 70 }, () => ({ x: R(), y: R(), ph: R() * 6.28 }));
  // a film grain, laid over at a whisper so the painting isn't plastic-flat
  const grainCv = document.createElement('canvas');
  grainCv.width = grainCv.height = 128;
  {
    const gx = grainCv.getContext('2d')!;
    const im = gx.createImageData(128, 128);
    for (let i = 0; i < im.data.length; i += 4) {
      const v = 128 + (R() - 0.5) * 120;
      im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
      im.data[i + 3] = 255;
    }
    gx.putImageData(im, 0, 0);
  }
  const grain = g.createPattern(grainCv, 'repeat');
  let flash = 0;
  let nextBolt = 1.5;
  let boltX = 0.5;
  let boltSeed = 1;
  let last = performance.now();
  let raf = 0;
  let w = 0;
  let h = 0;
  let r = 1;

  const ease = (a: number, b: number, k: number) => a + (b - a) * k;
  const step = (k: number) => {
    if (!cur || !to) return;
    for (const key of COLOURS) cur[key] = mixC(cur[key], to[key], k);
    for (const key of NUMBERS) cur[key] = ease(cur[key], to[key], k);
  };

  const draw = (dt: number, time: number) => {
    const s = cur!;
    // (a big window at a high pixel ratio: cap the pixels, the painting is soft anyway)
    const cssW = cv.clientWidth;
    const cssH = cv.clientHeight;
    r = Math.min(devicePixelRatio || 1, Math.sqrt(2.6e6 / Math.max(1, cssW * cssH)), 2);
    const cw = Math.round(cssW * r);
    const ch = Math.round(cssH * r);
    if (cw !== w || ch !== h) {
      w = cv.width = cw;
      h = cv.height = ch;
      cloudCv.width = Math.max(1, Math.round(w / 3));
      cloudCv.height = Math.max(1, Math.round(h / 3));
    }
    if (!w || !h) return;
    const H0 = h * 0.53;
    const f = Math.min(w * 0.8, h * 1.3);
    const camH = ((h - H0) * Z_NEAR) / f;
    const cx = w * 0.5;
    const P = (x: number, y: number, z: number): [number, number] => [cx + (f * x) / z, H0 + (f * (camH - y)) / z];
    const groundY = (z: number) => H0 + (f * camH) / z;
    const L = s.light;
    const night = s.night;
    // the haze between the eye and a thing at distance z
    const haze = (z: number) => clamp01((1 - Math.exp(-z / 260)) * 0.55 + s.murk * smooth(4, 80, z) * 0.95);
    const shade = (alb: RGB, z: number, glow = 0): RGB => mixC(mixC(litC(alb, L), alb, glow), s.fogC, haze(z));
    const poly = (pts: [number, number][]) => {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
      g.closePath();
    };
    const quad = (a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number], fill: string | CanvasGradient) => {
      poly([P(...a), P(...b), P(...c), P(...d)]);
      g.fillStyle = fill;
      g.fill();
    };
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // ---- sky
    const sky = g.createLinearGradient(0, 0, 0, H0);
    sky.addColorStop(0, css(s.top));
    sky.addColorStop(0.55, css(s.mid));
    sky.addColorStop(1, css(s.hor));
    g.fillStyle = sky;
    g.fillRect(0, 0, w, H0 + 2);
    const clearK = 1 - Math.min(1, s.cloud * 1.25);
    if (night > 0.05 && clearK > 0.02) {
      for (const st of stars) {
        g.fillStyle = `rgba(255,255,255,${st.a * night * clearK * (0.7 + 0.3 * Math.sin(time * 2.3 + st.x * 50))})`;
        g.fillRect(st.x * w, st.y * H0, r * st.s, r * st.s);
      }
    }
    // the sun (a bloom, a halo, the disc) or the moon (a disc with its seas)
    const sx = s.sunX * w;
    const sy = s.sunY * H0;
    const moon = night > 0.6;
    if (s.sun > 0.01) {
      const rad = (moon ? 0.022 : 0.026 + 0.012 * s.heat) * h;
      const big = g.createRadialGradient(sx, sy, 0, sx, sy, rad * (moon ? 9 : 18));
      big.addColorStop(0, css(s.sunC, (moon ? 0.35 : 0.85) * s.sun));
      big.addColorStop(0.12, css(s.sunC, (moon ? 0.16 : 0.42) * s.sun));
      big.addColorStop(0.4, css(s.sunC, (moon ? 0.05 : 0.12) * s.sun));
      big.addColorStop(1, css(s.sunC, 0));
      g.fillStyle = big;
      g.fillRect(0, 0, w, H0);
      if (!moon) {
        const halo = g.createRadialGradient(sx, sy, rad * 0.8, sx, sy, rad * 2.6);
        halo.addColorStop(0, `rgba(255,255,250,${0.9 * s.sun})`);
        halo.addColorStop(1, 'rgba(255,255,250,0)');
        g.fillStyle = halo;
        g.fillRect(sx - rad * 3, sy - rad * 3, rad * 6, rad * 6);
      }
      g.fillStyle = css(moon ? [238, 242, 255] : mixC(s.sunC, [255, 255, 255], 0.85), Math.min(1, s.sun * 1.4));
      g.beginPath();
      g.arc(sx, sy, rad, 0, Math.PI * 2);
      g.fill();
      if (moon) {
        g.fillStyle = `rgba(150,160,190,${0.35 * s.sun})`;
        for (const [ox, oy, rr] of [[-0.3, -0.2, 0.28], [0.25, 0.1, 0.2], [-0.05, 0.35, 0.16], [0.35, -0.35, 0.12]]) {
          g.beginPath();
          g.arc(sx + ox * rad, sy + oy * rad, rr * rad, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    // ---- clouds: drawn opaque into a third-size layer (soft edges when scaled up), laid on at the cover's strength
    const cloudA = Math.min(1, s.cloud * 1.2);
    if (cloudA > 0.02) {
      const cwid = cloudCv.width;
      const chei = cloudCv.height;
      const cH0 = (H0 / h) * chei;
      cg.clearRect(0, 0, cwid, chei);
      const sc = 0.55 + s.cloud * 0.75;
      for (const c of clouds) {
        const speed = (0.004 + Math.abs(s.wind) * 0.0012) * [0.45, 0.7, 1][c.layer];
        if (!reduce) c.x += dt * speed * Math.sign(s.wind || 1);
        if (c.x > 1.3) c.x -= 1.6;
        if (c.x < -0.3) c.x += 1.6;
        const ccx = c.x * cwid;
        const ccy = c.y * cH0;
        const cw2 = c.w * cwid * sc;
        const grad = cg.createLinearGradient(0, ccy - cw2 * 0.45, 0, ccy + cw2 * 0.12);
        const far = [0.55, 0.3, 0.1][c.layer];
        grad.addColorStop(0, css(mixC(s.cLit, s.hor, far)));
        grad.addColorStop(1, css(mixC(s.cShade, s.hor, far * 0.8)));
        cg.fillStyle = grad;
        cg.beginPath();
        for (const b of c.blobs) {
          const bx = ccx + b.x * cw2;
          const by = ccy + b.y * cw2 * 0.55;
          cg.moveTo(bx + b.r * cw2, by);
          cg.arc(bx, by, b.r * cw2, 0, Math.PI * 2);
        }
        // (a flat base: cumulus sit on their condensation level)
        cg.rect(ccx - cw2 * 0.42, ccy - cw2 * 0.02, cw2 * 0.84, cw2 * 0.06);
        cg.fill();
      }
      // the deck: a ceiling with a lumpy belly, closing in as the cloud thickens
      const deckK = smooth(0.55, 0.95, s.cloud);
      if (deckK > 0.01) {
        cg.globalAlpha = deckK;
        const dgrad = cg.createLinearGradient(0, 0, 0, cH0 * 0.5);
        dgrad.addColorStop(0, css(mixC(s.cShade, [0, 0, 0], 0.15)));
        dgrad.addColorStop(1, css(mixC(s.cShade, s.cLit, 0.25)));
        cg.fillStyle = dgrad;
        cg.beginPath();
        cg.rect(0, 0, cwid, cH0 * 0.14);
        for (const d of deck) {
          const dx = (((d.x + time * 0.004 * Math.sign(s.wind || 1)) % 1) + 1) % 1;
          cg.moveTo(dx * cwid + d.r * cwid, d.y * cH0);
          cg.ellipse(dx * cwid, d.y * cH0, d.r * cwid * 1.6, d.r * cwid * 0.55, 0, 0, Math.PI * 2);
        }
        cg.fill();
        cg.globalAlpha = 1;
      }
      g.globalAlpha = cloudA;
      g.drawImage(cloudCv, 0, 0, w, h);
      g.globalAlpha = 1;
    }
    // a rainbow opposite the sun in a sunshower
    if (s.rainbow > 0.02) {
      const bx = (1 - s.sunX) * w;
      const by = H0 * 1.05;
      const br = h * 0.5;
      g.save();
      g.globalCompositeOperation = 'screen';
      const bands: RGB[] = [[150, 60, 200], [60, 90, 230], [60, 190, 120], [240, 220, 60], [250, 140, 40], [230, 50, 50]];
      bands.forEach((c, i) => {
        g.strokeStyle = css(c, 0.16 * s.rainbow);
        g.lineWidth = h * 0.012;
        g.beginPath();
        g.arc(bx, by, br + i * h * 0.011, Math.PI * 1.05, Math.PI * 1.95);
        g.stroke();
      });
      g.restore();
    }
    // crepuscular rays when the sun breaks through broken cloud
    const rayK = s.sun * smooth(0.12, 0.4, s.cloud) * (1 - smooth(0.6, 0.85, s.cloud)) * (moon ? 0 : 1);
    if (rayK > 0.02) {
      g.save();
      g.globalCompositeOperation = 'screen';
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.18 + i * 0.085) + Math.sin(time * 0.15 + i) * 0.02;
        const len = h * 1.2;
        const spread = 0.022 + (i % 3) * 0.012;
        const rg = g.createLinearGradient(sx, sy, sx + Math.cos(a) * len, sy + Math.sin(a) * len);
        rg.addColorStop(0, css(s.sunC, 0.12 * rayK));
        rg.addColorStop(1, css(s.sunC, 0));
        g.fillStyle = rg;
        g.beginPath();
        g.moveTo(sx, sy);
        g.lineTo(sx + Math.cos(a - spread) * len, sy + Math.sin(a - spread) * len);
        g.lineTo(sx + Math.cos(a + spread) * len, sy + Math.sin(a + spread) * len);
        g.fill();
      }
      g.restore();
    }
    // lightning: a forked channel down out of the cloud, behind the hills
    if (s.bolt > 0.3 && !reduce) {
      nextBolt -= dt;
      if (nextBolt <= 0) {
        flash = 1;
        boltX = 0.12 + Math.random() * 0.76;
        boltSeed = Math.random() * 1000;
        nextBolt = 2.2 + (Math.random() * 4) / s.bolt;
      }
    }
    if (flash > 0.5) {
      const BR = rng(boltSeed | 0);
      const fork = (x0: number, y0: number, y1: number, width: number, depth: number) => {
        let bx = x0;
        let by = y0;
        const pts: [number, number][] = [[bx, by]];
        while (by < y1) {
          by += h * (0.025 + BR() * 0.03);
          bx += (BR() - 0.5) * w * 0.04;
          pts.push([bx, by]);
          if (depth < 2 && BR() < 0.12) fork(bx, by, by + (y1 - by) * 0.5, width * 0.5, depth + 1);
        }
        for (const [lw, a] of [[width * 6, 0.12], [width, 1]] as const) {
          g.strokeStyle = `rgba(236,240,255,${a * flash})`;
          g.lineWidth = lw * r;
          g.beginPath();
          pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
          g.stroke();
        }
      };
      fork(boltX * w, H0 * 0.18, H0 * 0.98, 2.2, 0);
    }

    // ---- the mountains: two ranges paling into the distance, snow-capped when it's cold
    const capK = clamp01(0.3 + s.cover * 1.4 + s.snow * 1.2 + s.frost * 0.5) * (1 - s.sand);
    const range = (rg: number[], hgt: number, base: number, alb: RGB, fogK: number, phase: number) => {
      const pts: [number, number][] = [[0, H0 + 2]];
      const n = rg.length - 1;
      for (let i = 0; i <= n; i++) pts.push([(i / n) * w, H0 - base * h - rg[(i + phase) % (n + 1)] * hgt * h]);
      pts.push([w, H0 + 2]);
      const col = mixC(litC(mixC(alb, [196, 150, 100], s.sand), L), s.fogC, clamp01(fogK + s.murk * (1 - fogK) * 1.05));
      const mg = g.createLinearGradient(0, H0 - (base + hgt) * h, 0, H0);
      mg.addColorStop(0, css(col));
      mg.addColorStop(1, css(mixC(col, s.fogC, 0.45)));
      poly(pts);
      g.fillStyle = mg;
      g.fill();
      if (capK > 0.02) {
        g.save();
        poly(pts);
        g.clip();
        const snowC = mixC(litC([236, 240, 248], L), s.fogC, clamp01(fogK * 0.8 + s.murk * 0.8));
        const cap: [number, number][] = [];
        for (let i = 0; i <= n; i++) cap.push([(i / n) * w, H0 - base * h - (0.42 + 0.55 * (1 - capK) + Math.sin(i * 1.7) * 0.06) * hgt * h]);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(w, 0);
        for (let i = cap.length - 1; i >= 0; i--) g.lineTo(cap[i][0], cap[i][1]);
        g.closePath();
        g.fillStyle = css(snowC, 0.92);
        g.fill();
        g.restore();
      }
    };
    range(ridgeFar, 0.17, 0.035, [96, 112, 132], 0.62, 0);
    range(ridgeNear, 0.1, 0.012, [70, 88, 84], 0.44, 9);
    // the treeline (in a desert, low scrub and dunes)
    {
      const tz = 160;
      const tc = shade(mixC(mixC([34, 60, 36], [216, 222, 230], s.cover * 0.55), [170, 128, 80], s.sand), tz);
      g.fillStyle = css(tc);
      g.beginPath();
      g.moveTo(0, H0 + 2);
      const th = h * 0.022 * (1 - 0.7 * s.sand);
      for (let i = 0; i < trees.length; i++) {
        const x0 = (i / trees.length) * w;
        const x1 = ((i + 1) / trees.length) * w;
        g.quadraticCurveTo((x0 + x1) / 2, H0 - th * trees[i] * 2.1, x1, H0 - th * 0.35);
      }
      g.lineTo(w, H0 + 2);
      g.fill();
    }

    // ---- the ground: grass (or snow, sand, frost), mown in bands, paling into the distance
    let grassA: RGB = mixC([66, 104, 50], [48, 80, 40], s.wet * 0.6);
    grassA = mixC(grassA, [128, 116, 66], s.heat * 0.5);
    grassA = mixC(grassA, [196, 152, 98], s.sand);
    grassA = mixC(grassA, [178, 196, 200], s.frost * 0.8);
    grassA = mixC(grassA, [236, 240, 247], clamp01(s.cover * 1.3) * (1 - s.frost * 0.5));
    const gg = g.createLinearGradient(0, H0, 0, h);
    gg.addColorStop(0, css(shade(grassA, 200)));
    gg.addColorStop(0.12, css(shade(grassA, 60)));
    gg.addColorStop(1, css(shade(grassA, 5)));
    g.fillStyle = gg;
    g.fillRect(0, H0, w, h - H0);
    if (s.sand < 0.5) {
      g.fillStyle = `rgba(255,255,255,${0.035 * (1 - s.cover)})`;
      for (let z = Z_NEAR; z < 120; z *= 1.32) {
        const y0 = groundY(z * 1.15);
        const y1 = groundY(z);
        g.fillRect(0, y0, w, y1 - y0);
      }
    }

    // ---- the circuit: run-off, kerbs, the asphalt, its lines
    const zs: number[] = [];
    for (let z = Z_NEAR * 0.9; z < 420; z *= 1.045) zs.push(z);
    const edge = (off: number, from = 0, toI = zs.length): [number, number][] => zs.slice(from, toI).map((z) => P(curve(z) + off, 0, z));
    const strip = (a: number, b: number, fill: string | CanvasGradient) => {
      const pts = [...edge(a), ...edge(b).reverse()];
      poly(pts);
      g.fillStyle = fill;
      g.fill();
    };
    const runoffA = mixC(mixC([104, 106, 110], [200, 204, 214], s.cover * 0.8), [180, 140, 92], s.sand * 0.8);
    const roG = g.createLinearGradient(0, H0, 0, h);
    roG.addColorStop(0, css(shade(runoffA, 300)));
    roG.addColorStop(0.15, css(shade(runoffA, 50)));
    roG.addColorStop(1, css(shade(runoffA, 6)));
    strip(-(TW + KERB + RUNOFF), -(TW + KERB), roG);
    strip(TW + KERB, TW + KERB + RUNOFF * 0.7, roG);
    // the asphalt: grey dry, black wet, slush-white under snow, sand-blown in a sandstorm
    const slush = clamp01(s.cover * 1.2) * smooth(0.05, 0.4, s.snow + s.cover * 0.5) * (1 - s.frost);
    let asph: RGB = mixC([70, 72, 78], [34, 36, 40], s.wet);
    asph = mixC(asph, [196, 202, 212], slush * 0.85);
    asph = mixC(asph, [168, 130, 86], s.sand * s.dust * 0.5);
    const trackPts = [...edge(-TW), ...edge(TW).reverse()];
    const tg = g.createLinearGradient(0, H0, 0, h);
    tg.addColorStop(0, css(shade(asph, 320)));
    tg.addColorStop(0.1, css(shade(asph, 60)));
    tg.addColorStop(1, css(shade(asph, 6)));
    poly(trackPts);
    g.fillStyle = tg;
    g.fill();
    g.save();
    poly(trackPts);
    g.clip();
    // the line: a rubbered stripe when dry, two black tyre tracks through slush, a drying line in the wet
    const lineA: RGB = slush > 0.1 ? [40, 42, 48] : s.wet > 0.3 ? [62, 64, 70] : [46, 47, 52];
    const lineK = slush > 0.1 ? 0.85 * slush : s.wet > 0.3 ? 0.35 : 0.5;
    for (const off of slush > 0.1 ? [-0.8, 0.8, -2.6, -1.2] : [-0.4]) {
      const wd = slush > 0.1 ? 0.32 : 2.2;
      const a = [...zs.map((z) => P(curve(z) + off - wd / 2 + Math.min(0, -curve(z) * 0.12), 0, z)), ...zs.map((z) => P(curve(z) + off + wd / 2 + Math.min(0, -curve(z) * 0.12), 0, z)).reverse()];
      poly(a);
      g.fillStyle = css(shade(lineA, 20), lineK * (off < -1 ? 0.45 : 1));
      g.fill();
    }
    // a wet track mirrors the sky, the sun's streak and the floodlights
    if (s.wet > 0.05 || s.heat > 0.1) {
      const refl = g.createLinearGradient(0, H0, 0, h);
      refl.addColorStop(0, css(s.hor, 0.85));
      refl.addColorStop(0.25, css(s.mid, 0.5));
      refl.addColorStop(1, css(s.top, 0.25));
      g.globalAlpha = clamp01(s.wet * 0.62);
      g.fillStyle = refl;
      g.fillRect(0, H0, w, h - H0);
      // (heat: a mirage of the sky lying on the far straight)
      if (s.heat > 0.1) {
        const mg = g.createLinearGradient(0, H0, 0, H0 + h * 0.06);
        mg.addColorStop(0, css(s.hor, 0.85 * s.heat));
        mg.addColorStop(1, css(s.hor, 0));
        g.globalAlpha = 1;
        g.fillStyle = mg;
        g.fillRect(0, H0, w, h * 0.06);
      }
      if (s.sun > 0.05 && s.sunY < 1) {
        const streak = g.createRadialGradient(sx, H0 + (h - H0) * 0.3, 0, sx, H0 + (h - H0) * 0.3, h * 0.5);
        streak.addColorStop(0, css(s.sunC, 0.45 * s.sun * s.wet));
        streak.addColorStop(1, css(s.sunC, 0));
        g.globalAlpha = 1;
        g.save();
        g.translate(sx, H0);
        g.scale(0.16, 1);
        g.translate(-sx, -H0);
        g.fillStyle = streak;
        g.fillRect(sx - h * 0.5, H0, h, h);
        g.restore();
      }
      g.globalAlpha = 1;
    }
    // the start line under the gantry, and the grid slots
    g.fillStyle = css(shade(mixC([236, 236, 236], asph, slush * 0.7), Z_GANTRY), 0.85);
    poly([P(-TW, 0, Z_GANTRY - 0.4), P(TW, 0, Z_GANTRY - 0.4), P(TW, 0, Z_GANTRY + 0.4), P(-TW, 0, Z_GANTRY + 0.4)]);
    g.fill();
    // (the slots ahead, staggered: a short bar each)
    g.globalAlpha = 0.55;
    for (const [gx, gz] of [[-2.4, Z_GANTRY - 4], [2.4, Z_GANTRY - 10], [-2.4, Z_GANTRY - 16]]) {
      poly([P(gx - 1, 0, gz), P(gx + 1, 0, gz), P(gx + 1, 0, gz + 0.25), P(gx - 1, 0, gz + 0.25)]);
      g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
    // the white lines at the track's edges
    g.fillStyle = css(shade([232, 232, 232], 40), 0.9);
    for (const side of [-1, 1]) {
      poly([...edge(side * (TW - 0.05)), ...edge(side * (TW - 0.3)).reverse()]);
      g.fill();
    }
    // kerbs: red and white blocks, pink with distance; snow lies on them
    for (const side of [-1, 1]) {
      let i = 0;
      for (let z = Z_NEAR * 0.9; z < 160; z += 2.1, i++) {
        const z1 = z + 2.1;
        const a0 = curve(z) + side * TW;
        const a1 = curve(z) + side * (TW + KERB);
        const b0 = curve(z1) + side * TW;
        const b1 = curve(z1) + side * (TW + KERB);
        const base: RGB = i % 2 ? [236, 236, 238] : [214, 30, 40];
        poly([P(a0, 0, z), P(a1, 0, z), P(b1, 0, z1), P(b0, 0, z1)]);
        g.fillStyle = css(shade(mixC(base, [236, 240, 248], clamp01(s.cover * 1.4) * 0.8), z));
        g.fill();
      }
    }

    // ---- the floodlights' pools on the asphalt (night races)
    const MASTS = [17, 31, 50, 78, 120];
    if (s.lamps > 0.02) {
      g.save();
      g.globalCompositeOperation = 'screen';
      for (const z of MASTS) {
        const [px, py] = P(curve(z), 0, z);
        const rx = (f * 11) / z;
        const ry = (f * camH * 7) / (z * z);
        const pg = g.createRadialGradient(px, py, 0, px, py, rx);
        pg.addColorStop(0, `rgba(255,236,200,${0.32 * s.lamps * (1 - haze(z) * 0.7)})`);
        pg.addColorStop(1, 'rgba(255,236,200,0)');
        g.save();
        g.translate(px, py);
        g.scale(1, Math.max(0.05, ry / rx));
        g.translate(-px, -py);
        g.fillStyle = pg;
        g.fillRect(px - rx, py - rx, rx * 2, rx * 2);
        g.restore();
      }
      g.restore();
    }

    // ---- the pit building on the right: a facade of garages, glass above, the roof's edge
    {
      const x0 = 16;
      const zA = 10;
      const zB = 40;
      const wall = shade([198, 202, 210], 25);
      quad([x0, 0, zA], [x0, 0, zB], [x0, 7.2, zB], [x0, 7.2, zA], css(wall));
      // the glass band reflects the sky
      const gb = g.createLinearGradient(0, P(x0, 6, zA)[1], 0, P(x0, 4.4, zA)[1]);
      gb.addColorStop(0, css(mixC(s.mid, [20, 24, 30], 0.35)));
      gb.addColorStop(1, css(mixC(s.hor, [20, 24, 30], 0.5)));
      quad([x0 - 0.01, 4.4, zA], [x0 - 0.01, 4.4, zB], [x0 - 0.01, 6, zB], [x0 - 0.01, 6, zA], gb);
      // garages, warm-lit inside, a team stripe over each
      for (let z = zA + 0.8; z < zB - 2; z += 3.4) {
        const lamp = 0.35 + 0.65 * Math.max(s.lamps, 1 - L[1] / 0.8);
        const inside: RGB = mixC([22, 24, 28], [255, 222, 170], clamp01(lamp * 0.55));
        quad([x0 - 0.02, 0, z], [x0 - 0.02, 0, z + 2.6], [x0 - 0.02, 3.2, z + 2.6], [x0 - 0.02, 3.2, z], css(mixC(inside, s.fogC, haze(z))));
        quad([x0 - 0.03, 3.4, z], [x0 - 0.03, 3.4, z + 2.6], [x0 - 0.03, 3.8, z + 2.6], [x0 - 0.03, 3.8, z], css(shade(z % 6.8 < 3.4 ? carC : [30, 34, 44], z, 0.2)));
      }
      quad([x0 - 0.05, 6.8, zA], [x0 - 0.05, 6.8, zB], [x0 - 0.05, 7.4, zB], [x0 - 0.05, 7.4, zA], css(shade([40, 42, 48], 25)));
      if (s.cover > 0.05) quad([x0 - 0.06, 7.4, zA], [x0 - 0.06, 7.4, zB], [x0 - 0.06, 7.75, zB], [x0 - 0.06, 7.75, zA], css(shade([238, 242, 250], 25), clamp01(s.cover * 1.5)));
      // the pit wall and its fence
      quad([TW + KERB + RUNOFF * 0.7, 0, zA - 6], [TW + KERB + RUNOFF * 0.7, 0, zB + 30], [TW + KERB + RUNOFF * 0.7, 1.1, zB + 30], [TW + KERB + RUNOFF * 0.7, 1.1, zA - 6], css(shade([214, 216, 222], 30)));
    }

    // ---- the grandstand on the left: crowd on a raked tier under a cantilevered roof
    {
      const xi = -(TW + KERB + RUNOFF + 2.2);
      const zA = 17;
      const zB = 54;
      const back = shade([58, 62, 72], 22);
      quad([xi - 9, 9, zA], [xi - 9, 9, zB], [xi - 9, 13, zB], [xi - 9, 13, zA], css(back));
      quad([xi, 1.8, zA], [xi, 1.8, zB], [xi - 9, 9, zB], [xi - 9, 9, zA], css(shade([44, 48, 58], 22)));
      const lit = clamp01(s.lamps * 0.8);
      for (const c of crowd) {
        const z = zA + c.u * (zB - zA);
        const [px, py] = P(xi - 9 * c.v, 1.9 + 7 * c.v, z);
        if (px < -4 || px > w + 4) continue;
        const sz = Math.max(r, (0.3 * f) / z);
        g.fillStyle = css(shade(mulC(c.c, c.k), z, lit * 0.35));
        g.fillRect(px - sz / 2, py - sz, sz, sz * 1.1);
      }
      // the front wall with the sponsor band, the roof's underside and fascia, the pillars
      quad([xi, 0, zA], [xi, 0, zB], [xi, 1.9, zB], [xi, 1.9, zA], css(shade([226, 228, 232], 20)));
      quad([xi, 0.55, zA], [xi, 0.55, zB], [xi, 1.25, zB], [xi, 1.25, zA], css(shade(carC, 20, 0.15)));
      for (let z = zA + 2; z < zB; z += 6) quad([xi + 0.2, 1.9, z], [xi + 0.2, 1.9, z + 0.35], [xi + 0.2, 12.4, z + 0.35], [xi + 0.2, 12.4, z], css(shade([90, 94, 104], z)));
      quad([xi + 0.8, 12.4, zA], [xi + 0.8, 12.4, zB], [xi - 9.5, 13.4, zB], [xi - 9.5, 13.4, zA], css(shade([30, 32, 38], 22)));
      quad([xi + 0.8, 12.4, zA], [xi + 0.8, 12.4, zB], [xi + 0.8, 13.3, zB], [xi + 0.8, 13.3, zA], css(shade([232, 234, 238], 22)));
      if (s.cover > 0.05) quad([xi + 0.8, 13.3, zA], [xi + 0.8, 13.3, zB], [xi + 0.8, 13.75, zB], [xi + 0.8, 13.75, zA], css(shade([240, 244, 252], 22), clamp01(s.cover * 1.5)));
      // the barrier and its catch fence
      const bx = -(TW + KERB + RUNOFF);
      quad([bx, 0, zA - 5], [bx, 0, zB + 40], [bx, 1, zB + 40], [bx, 1, zA - 5], css(shade([196, 198, 204], 25)));
      g.strokeStyle = css(shade([150, 154, 162], 25), 0.5);
      g.lineWidth = r;
      for (let z = zA - 4; z < zB + 40; z += 4) {
        const [ax, ay] = P(bx, 1, z);
        const [, by] = P(bx, 4, z);
        g.beginPath();
        g.moveTo(ax, ay);
        g.lineTo(ax, by);
        g.stroke();
      }
      g.fillStyle = css(shade([170, 176, 186], 25), 0.12);
      poly([P(bx, 1, zA - 4), P(bx, 1, zB + 40), P(bx, 4, zB + 40), P(bx, 4, zA - 4)]);
      g.fill();
    }

    // ---- the floodlight masts (night) and the start gantry over the line
    if (s.lamps > 0.02) {
      for (const z of MASTS) {
        for (const side of [-1, 1]) {
          const x = curve(z) + side * (TW + KERB + RUNOFF - 0.5);
          const [ax, ay] = P(x, 0, z);
          const [, by] = P(x, 20, z);
          g.strokeStyle = css(shade([60, 64, 72], z), s.lamps);
          g.lineWidth = Math.max(r, (0.35 * f) / z);
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(ax, by);
          g.stroke();
          const hr = (f * 3) / z;
          const hg = g.createRadialGradient(ax, by, 0, ax, by, hr);
          hg.addColorStop(0, `rgba(255,244,220,${0.9 * s.lamps})`);
          hg.addColorStop(0.2, `rgba(255,236,200,${0.35 * s.lamps})`);
          hg.addColorStop(1, 'rgba(255,236,200,0)');
          g.fillStyle = hg;
          g.fillRect(ax - hr, by - hr, hr * 2, hr * 2);
        }
      }
    }
    {
      const z = Z_GANTRY;
      const gx = TW + 1.6;
      const steel = css(shade([52, 56, 64], z));
      for (const side of [-1, 1]) quad([side * gx - 0.25, 0, z], [side * gx + 0.25, 0, z], [side * gx + 0.25, 7.2, z], [side * gx - 0.25, 7.2, z], steel);
      quad([-gx - 0.3, 6.1, z], [gx + 0.3, 6.1, z], [gx + 0.3, 7.2, z], [-gx - 0.3, 7.2, z], steel);
      quad([-gx - 0.3, 6.5, z - 0.01], [gx + 0.3, 6.5, z - 0.01], [gx + 0.3, 6.8, z - 0.01], [-gx - 0.3, 6.8, z - 0.01], css(shade(carC, z, 0.1)));
      if (s.cover > 0.05) quad([-gx - 0.3, 7.2, z], [gx + 0.3, 7.2, z], [gx + 0.3, 7.45, z], [-gx - 0.3, 7.45, z], css(shade([240, 244, 252], z), clamp01(s.cover * 1.5)));
      // five light pods, dark until the start
      for (let i = 0; i < 5; i++) {
        const lx = -2.4 + i * 1.2;
        quad([lx - 0.4, 4.6, z - 0.02], [lx + 0.4, 4.6, z - 0.02], [lx + 0.4, 6.1, z - 0.02], [lx - 0.4, 6.1, z - 0.02], css(shade([18, 20, 24], z)));
        for (const ly of [5.0, 5.6]) {
          const [px, py] = P(lx, ly, z);
          g.fillStyle = css(shade([60, 14, 18], z, 0.3));
          g.beginPath();
          g.arc(px, py, (0.2 * f) / z, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    // ---- heat shimmer: the band over the far asphalt wobbles
    if (s.heat > 0.05 && !reduce) {
      const y0 = Math.round(H0 - h * 0.03);
      const y1 = Math.round(H0 + h * 0.07);
      const band = Math.max(1, Math.round(2 * r));
      for (let y = y0; y < y1; y += band) {
        const k = 1 - Math.abs((y - H0) / (h * 0.06));
        const off = Math.sin(y * 0.21 / r + time * 7) * s.heat * 2.2 * r * Math.max(0, k);
        g.drawImage(cv, 0, y, w, band, off, y, w, band);
      }
    }

    // ---- the car on its grid slot, from behind (and its reflection in a wet track)
    {
      const gy = groundY(Z_CAR);
      const sc = f / Z_CAR;
      const X = (x: number) => cx + x * sc;
      const Y = (y: number) => gy - y * sc;
      const body = shade(carC, Z_CAR, 0.08);
      const tyre = shade([22, 22, 25], Z_CAR);
      const dark = shade([16, 17, 20], Z_CAR);
      const rainOn = s.wet > 0.2 || s.rain > 0.1 || s.snow > 0.2 || s.murk > 0.6;
      const blink = rainOn && (reduce || Math.sin(time * 12.5) > -0.2);
      const rr = (x: number, y: number, ww: number, hh: number, rad: number, fill: string) => {
        g.beginPath();
        g.roundRect(X(x), Y(y + hh), ww * sc, hh * sc, rad * sc);
        g.fillStyle = fill;
        g.fill();
      };
      const car = (alpha: number) => {
        g.globalAlpha = alpha;
        // tyres, with a lit shoulder
        for (const side of [-1, 1]) {
          rr(side * 0.79 - 0.22, 0, 0.44, 0.72, 0.09, css(tyre));
          rr(side * 0.79 - 0.22, 0.52, 0.44, 0.12, 0.04, css(mixC(tyre, litC([180, 180, 186], L), 0.25)));
        }
        // suspension arms
        g.strokeStyle = css(dark);
        g.lineWidth = 0.035 * sc;
        g.beginPath();
        for (const side of [-1, 1]) {
          g.moveTo(X(side * 0.6), Y(0.5));
          g.lineTo(X(side * 0.22), Y(0.42));
          g.moveTo(X(side * 0.6), Y(0.3));
          g.lineTo(X(side * 0.22), Y(0.22));
        }
        g.stroke();
        // the body and engine cover, the fin
        g.beginPath();
        g.moveTo(X(-0.44), Y(0.12));
        g.lineTo(X(-0.36), Y(0.5));
        g.quadraticCurveTo(X(-0.24), Y(0.82), X(-0.08), Y(0.9));
        g.lineTo(X(0.08), Y(0.9));
        g.quadraticCurveTo(X(0.24), Y(0.82), X(0.36), Y(0.5));
        g.lineTo(X(0.44), Y(0.12));
        g.closePath();
        const bg = g.createLinearGradient(0, Y(0.9), 0, Y(0.12));
        bg.addColorStop(0, css(mixC(body, [255, 255, 255], 0.18)));
        bg.addColorStop(1, css(mulC(body, 0.55)));
        g.fillStyle = bg;
        g.fill();
        rr(-0.025, 0.85, 0.05, 0.2, 0.02, css(mulC(body, 0.8)));
        // diffuser with its strakes
        g.beginPath();
        g.moveTo(X(-0.5), Y(0.03));
        g.lineTo(X(0.5), Y(0.03));
        g.lineTo(X(0.4), Y(0.26));
        g.lineTo(X(-0.4), Y(0.26));
        g.closePath();
        g.fillStyle = css(dark);
        g.fill();
        g.strokeStyle = css(mixC(dark, litC([150, 150, 156], L), 0.3));
        g.lineWidth = Math.max(1, 0.012 * sc);
        g.beginPath();
        for (const x of [-0.3, -0.12, 0.12, 0.3]) {
          g.moveTo(X(x), Y(0.04));
          g.lineTo(X(x * 0.9), Y(0.24));
        }
        g.stroke();
        // the rear wing: endplates, the main plane, the flap in the team's colour, the pylon
        rr(-0.025, 0.5, 0.05, 0.36, 0.01, css(dark));
        for (const side of [-1, 1]) rr(side * 0.53 - 0.03, 0.42, 0.06, 0.58, 0.02, css(mixC(dark, body, 0.35)));
        rr(-0.52, 0.82, 1.04, 0.07, 0.02, css(dark));
        rr(-0.52, 0.91, 1.04, 0.07, 0.02, css(body));
        rr(-0.48, 0.36, 0.96, 0.05, 0.02, css(dark));
        // the rain light
        rr(-0.06, 0.28, 0.12, 0.06, 0.015, blink ? '#ff2a2a' : css(mixC([60, 10, 12], dark, 0.3)));
        g.globalAlpha = 1;
      };
      // contact shadow
      const shg = g.createRadialGradient(cx, gy, 0, cx, gy, 1.3 * sc);
      shg.addColorStop(0, `rgba(0,0,0,${0.55 * (1 - night * 0.3)})`);
      shg.addColorStop(1, 'rgba(0,0,0,0)');
      g.save();
      g.translate(cx, gy);
      g.scale(1, 0.14);
      g.translate(-cx, -gy);
      g.fillStyle = shg;
      g.fillRect(cx - 1.3 * sc, gy - 1.3 * sc, 2.6 * sc, 2.6 * sc);
      g.restore();
      if (s.wet > 0.12) {
        g.save();
        g.translate(0, gy * 2);
        g.scale(1, -1);
        car(0.32 * s.wet);
        g.restore();
      }
      car(1);
      if (blink) {
        const [lx, ly] = [X(0), Y(0.31)];
        const lg = g.createRadialGradient(lx, ly, 0, lx, ly, 0.9 * sc);
        lg.addColorStop(0, 'rgba(255,40,40,0.6)');
        lg.addColorStop(0.15, 'rgba(255,30,30,0.22)');
        lg.addColorStop(1, 'rgba(255,30,30,0)');
        g.save();
        g.globalCompositeOperation = 'screen';
        g.fillStyle = lg;
        g.fillRect(lx - sc, ly - sc, sc * 2, sc * 2);
        if (s.wet > 0.2) {
          g.translate(lx, gy + (gy - ly));
          g.scale(0.4, 1.6);
          g.fillStyle = lg;
          g.globalAlpha = 0.6 * s.wet;
          g.fillRect(-sc, -sc, sc * 2, sc * 2);
        }
        g.restore();
      }
    }

    // ---- frost glitter on the near verges
    if ((s.frost > 0.05 || s.cover > 0.3) && night < 0.8) {
      for (const sp of sparkle) {
        const tw = Math.sin(time * 3 + sp.ph * 7);
        if (tw < 0.6) continue;
        const px = sp.x * w;
        const py = H0 + (h - H0) * (0.3 + 0.7 * sp.y);
        g.fillStyle = `rgba(255,255,255,${(tw - 0.6) * 2.2 * Math.max(s.frost, s.cover * 0.6)})`;
        g.fillRect(px, py, 1.6 * r, 1.6 * r);
      }
    }

    // ---- the murk: height fog over the ground, drifting bands of mist or blown sand
    if (s.murk > 0.02) {
      const fg = g.createLinearGradient(0, H0 - h * 0.25, 0, h);
      fg.addColorStop(0, css(s.fogC, 0));
      fg.addColorStop(0.32, css(s.fogC, 0.55 * s.murk));
      fg.addColorStop(1, css(s.fogC, 0.18 * s.murk));
      g.fillStyle = fg;
      g.fillRect(0, 0, w, h);
      for (let k = 0; k < 4; k++) {
        const y0 = H0 - h * 0.06 + k * h * 0.07;
        const off = (((time * (0.012 + Math.abs(s.wind) * 0.004) * (k + 1)) % 1) + 1) % 1;
        const bg = g.createLinearGradient(0, y0 - h * 0.03, 0, y0 + h * 0.03);
        bg.addColorStop(0, css(s.fogC, 0));
        bg.addColorStop(0.5, css(s.fogC, 0.14 * s.murk));
        bg.addColorStop(1, css(s.fogC, 0));
        g.fillStyle = bg;
        for (const dx of [-1, 0]) g.fillRect((off + dx) * w * 1.5, y0 - h * 0.03, w * 1.2, h * 0.06);
      }
    }

    // ---- what falls: rain in three depths, snow fluttering, hail bouncing, sand streaming
    const fall = Math.min(1, Math.max(s.rain * 1.1, s.snow, s.hail * 0.9, s.dust));
    const n = Math.round(parts.length * fall);
    const slant = s.wind * 0.05;
    const share = s.snow / Math.max(0.001, s.snow + s.rain + s.hail);
    const landY = (d: number) => H0 / h + (1 - H0 / h) * (0.04 + 0.96 * d * d);
    const streaks: Path2D[] = [new Path2D(), new Path2D(), new Path2D()];
    const flakes: Path2D[] = [new Path2D(), new Path2D(), new Path2D()];
    const stones = new Path2D();
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      const isSnow = i / parts.length < share;
      const isHail = !isSnow && s.hail > 0.3;
      const isDust = s.dust > 0.3;
      const d = p.d;
      const band = d < 0.4 ? 0 : d < 0.75 ? 1 : 2;
      if (!reduce) {
        if (isDust) {
          p.x += dt * (0.35 + Math.abs(s.wind) * 0.05) * (0.3 + d) * Math.sign(s.wind || 1);
          p.y += dt * Math.sin(time * 2 + p.ph) * 0.04;
        } else if (isSnow) {
          p.y += dt * 0.08 * p.v * (0.4 + d);
          p.x += dt * (slant * 0.5 + Math.sin(time * 1.3 + p.ph) * 0.03) * (0.4 + d);
        } else if (isHail) {
          p.vy = (p.vy || 1.4 * p.v * (0.5 + d)) + dt * 3;
          p.y += dt * p.vy;
          p.x += dt * slant * 0.5 * d;
        } else {
          p.y += dt * 1.3 * p.v * (0.45 + d);
          p.x += dt * slant * (0.45 + d);
        }
        const ly = landY(d);
        if (!isDust && p.y > ly) {
          if (isHail && p.vy > 0.6) {
            p.y = ly;
            p.vy = -p.vy * 0.32;
          } else {
            if (!isSnow && !isHail && splash.length < 120 && d > 0.25) splash.push({ x: p.x, y: ly, t: 0, d });
            p.y = -0.02 - Math.random() * 0.1;
            p.x = Math.random() * 1.1 - 0.05;
            p.vy = 0;
          }
        }
        if (p.y > 1.02) p.y -= 1.04;
        if (p.x > 1.05) p.x -= 1.1;
        if (p.x < -0.05) p.x += 1.1;
      }
      const px = p.x * w;
      const py = p.y * h;
      if (isDust) {
        g.fillStyle = css(mixC(s.fogC, [230, 170, 104], 0.5), 0.35 * (0.3 + d) * s.dust);
        g.fillRect(px, py, (8 + 26 * d) * r, Math.max(r, 1.3 * d * r));
      } else if (isSnow) {
        const sz = (0.7 + 3.2 * d * d) * r;
        flakes[band].moveTo(px + sz, py);
        flakes[band].arc(px, py, sz, 0, Math.PI * 2);
      } else if (isHail) {
        const sz = (0.9 + 1.9 * d) * r;
        stones.moveTo(px + sz, py);
        stones.arc(px, py, sz, 0, Math.PI * 2);
      } else {
        const len = (10 + 34 * d) * r;
        streaks[band].moveTo(px, py);
        streaks[band].lineTo(px - slant * 0.3 * len, py - len);
      }
    }
    const rainC = mixC([200, 214, 236], mulC(s.hor, 1.1), 0.4);
    streaks.forEach((pth, b) => {
      g.strokeStyle = css(rainC, [0.16, 0.26, 0.38][b]);
      g.lineWidth = [0.6, 0.9, 1.4][b] * r;
      g.stroke(pth);
    });
    flakes.forEach((pth, b) => {
      g.fillStyle = css(mixC([255, 255, 255], s.fogC, 0.25 * (2 - b)), [0.55, 0.78, 0.95][b]);
      g.fill(pth);
    });
    g.fillStyle = 'rgba(236,244,255,0.92)';
    g.fill(stones);
    // splashes: little crowns on the asphalt, flattened by perspective
    if (splash.length) {
      g.strokeStyle = css(rainC, 0.45);
      g.lineWidth = r;
      g.beginPath();
      for (let i = splash.length - 1; i >= 0; i--) {
        const sp = splash[i];
        sp.t += dt;
        if (sp.t > 0.3) {
          splash.splice(i, 1);
          continue;
        }
        const rad = (1.5 + 7 * sp.d) * r * (0.3 + sp.t * 3);
        g.moveTo(sp.x * w + rad, sp.y * h);
        g.ellipse(sp.x * w, sp.y * h, rad, rad * 0.28, 0, 0, Math.PI * 2);
      }
      g.stroke();
    }

    // ---- the lightning's flash lights everything
    if (flash > 0.01) {
      g.fillStyle = `rgba(222,230,255,${0.4 * flash})`;
      g.fillRect(0, 0, w, h);
      flash *= Math.exp(-dt * 6.5);
    }
    // ---- a low sun flares the lens
    if (s.sun > 0.3 && !moon && s.sunY < 0.95 && s.murk < 0.6) {
      g.save();
      g.globalCompositeOperation = 'screen';
      const vx = cx - sx;
      const vy = h * 0.5 - sy;
      for (const [t, rad, a] of [[0.45, 0.02, 0.1], [0.8, 0.045, 0.06], [1.25, 0.03, 0.08], [1.6, 0.08, 0.04]] as const) {
        const fx = sx + vx * t;
        const fy = sy + vy * t;
        const fr = rad * h;
        const fl = g.createRadialGradient(fx, fy, 0, fx, fy, fr);
        fl.addColorStop(0, css(s.sunC, a * s.sun));
        fl.addColorStop(0.7, css(s.sunC, a * 0.6 * s.sun));
        fl.addColorStop(1, css(s.sunC, 0));
        g.fillStyle = fl;
        g.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
      }
      g.restore();
    }
    // ---- seat it: a vignette, a scrim behind the words at the top left, the grain
    const vg = g.createRadialGradient(cx, h * 0.55, h * 0.35, cx, h * 0.55, Math.hypot(w, h) * 0.62);
    vg.addColorStop(0, 'rgba(6,8,12,0)');
    vg.addColorStop(1, 'rgba(6,8,12,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
    const tl = g.createLinearGradient(0, 0, w * 0.55, h * 0.4);
    tl.addColorStop(0, 'rgba(6,8,12,0.5)');
    tl.addColorStop(1, 'rgba(6,8,12,0)');
    g.fillStyle = tl;
    g.fillRect(0, 0, w, h);
    if (grain) {
      g.globalAlpha = 0.07;
      g.globalCompositeOperation = 'overlay';
      g.fillStyle = grain;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
  };

  let seen = false;
  const frame = (now: number) => {
    raf = 0;
    // (wait to be put on the page; stop for good once taken off it)
    if (!cv.isConnected) {
      if (!seen) raf = requestAnimationFrame(frame);
      return;
    }
    seen = true;
    if (cv.offsetParent === null) {
      last = now;
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (wantKind === 'random') {
      randomT -= dt;
      if (randomT <= 0) {
        randomT = 1.6;
        randomI = (randomI + 1) % RANDOM_CYCLE.length;
        to = skyFor(RANDOM_CYCLE[randomI], wantTime);
      }
    }
    step(1 - Math.exp(-dt * 3.2));
    draw(dt, now / 1000);
    if (!reduce || Math.abs(cur!.sunX - to!.sunX) > 0.002) raf = requestAnimationFrame(frame);
  };
  const kick = () => {
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };

  return {
    el: cv,
    set(kind, time) {
      wantKind = kind;
      wantTime = time;
      randomT = 0;
      to = skyFor(kind === 'random' ? RANDOM_CYCLE[randomI] : kind, time);
      if (!cur) cur = copySky(to);
      kick();
    },
    tint(color) {
      carC = hex(color.length === 4 ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}` : color);
      kick();
    },
  };
}
