import { planWeather, Weather, type TimeOfDay, type WeatherChoice, type WeatherKind } from '../world/Weather.ts';

/**
 * The race briefing's sky: a small painted window onto the chosen weather and time of day — the sky's
 * colours, the sun (or moon) on its arc, the clouds drifting with the wind, and whatever falls or blows
 * (rain slanting, snow fluttering, hail bouncing, sand streaming, lightning) over a strip of ground that
 * goes white under snow and ochre in a sandstorm. Every change eases across, so picking a sky shows the
 * weather rolling in. Canvas 2D, a few hundred particles; it stops itself once it leaves the page.
 */

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixC = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** the clear sky of each time: zenith, horizon, the sun's place on the arc (0 … 1 across, 0 top … 1 horizon) */
const TIME_SKY: Record<TimeOfDay, { top: string; hor: string; x: number; y: number; light: number; night?: number }> = {
  dawn: { top: '#2b3a66', hor: '#efa07c', x: 0.1, y: 0.86, light: 0.55 },
  morning: { top: '#3f78c2', hor: '#c9def0', x: 0.24, y: 0.5, light: 0.85 },
  midday: { top: '#2f6fc8', hor: '#b7d4ee', x: 0.5, y: 0.14, light: 1 },
  afternoon: { top: '#3a77c4', hor: '#c4daee', x: 0.68, y: 0.34, light: 0.95 },
  golden: { top: '#4e6fa6', hor: '#f2c286', x: 0.8, y: 0.66, light: 0.78 },
  sunset: { top: '#33437a', hor: '#f3946a', x: 0.9, y: 0.88, light: 0.6 },
  dusk: { top: '#151d3c', hor: '#6e5e86', x: 0.96, y: 1.08, light: 0.3, night: 0.5 },
  night: { top: '#04060d', hor: '#121a2c', x: 0.3, y: 0.24, light: 0.12, night: 1 },
};
/** the arc's stops, in order (also the briefing's time ruler) */
export const SKY_TIMES: TimeOfDay[] = ['dawn', 'morning', 'midday', 'afternoon', 'golden', 'sunset', 'dusk', 'night'];

interface Sky {
  top: RGB;
  hor: RGB;
  ground: RGB;
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
  fog: number;
  heat: number;
  cover: number;
  wind: number;
  bolt: number;
}

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
  const wet = clamp01(rain * 1.6 + snow);
  let top = hex(T.top);
  let hor = hex(T.hor);
  // a deck greys the sky out (lighter under snow, darker under rain, green-grey in a hail cell)
  const lum = (0.3 + 0.7 * T.light) * (1 - 0.45 * wet) * (1 + 0.25 * snow);
  const grey = (v: number): RGB => [v * lum, v * lum * 1.02, v * lum * 1.07];
  top = mixC(top, grey(150), ov * 0.92);
  hor = mixC(hor, grey(190), ov * 0.9);
  if (hail > 0) {
    top = mixC(top, [52, 66, 60], 0.75 * hail);
    hor = mixC(hor, [92, 108, 98], 0.7 * hail);
  }
  if (dust > 0) {
    top = mixC(top, [110, 66, 34].map((c) => c * (0.4 + 0.6 * T.light)) as RGB, 0.9 * dust);
    hor = mixC(hor, [196, 128, 70].map((c) => c * (0.4 + 0.6 * T.light)) as RGB, 0.92 * dust);
  }
  if (fog > 0.3 || k === 'haze' || k === 'heatwave') {
    const f = k === 'heatwave' ? 0.35 : k === 'haze' ? 0.5 : clamp01((fog - 0.3) / 0.6);
    hor = mixC(hor, mixC(hor, [235, 232, 222].map((c) => c * (0.35 + 0.65 * T.light)) as RGB, 0.8), f);
    top = mixC(top, hor, f * 0.45);
  }
  let ground: RGB = mixC([46, 74, 38], [30, 44, 30], wet * 0.5);
  if (k === 'heatwave' || k === 'sandstorm') ground = [120, 98, 58];
  ground = mixC(ground, [214, 220, 230], clamp01(cover * 1.3));
  ground = mixC(ground, [150, 102, 56], dust * 0.6);
  ground = ground.map((c) => c * (0.25 + 0.75 * T.light)) as RGB;
  const sun = (1 - ov) * (1 - 0.85 * dust) * (1 - clamp01(fog - 0.6) * 1.6) * (T.y > 1 ? 0 : 1);
  return {
    top,
    hor,
    ground,
    sunX: T.x,
    sunY: T.y,
    sun: kind === 'random' ? 0.3 : clamp01(sun),
    night,
    cloud: kind === 'random' ? 0.5 : cloud,
    dark: clamp01(wet * 0.8 + hail * 0.5 + (ws?.conv ?? 0) * 0.3),
    rain: k === 'sleet' ? rain * 0.6 : rain * (1 - hail),
    snow,
    hail,
    dust,
    fog,
    heat: clamp01(((ws?.heat ?? 0) - 0.5) / 1),
    cover,
    wind: (ws ? Math.hypot(ws.windX, ws.windZ) : 3) * (ws && ws.windX < 0 ? -1 : 1),
    bolt: k === 'thunderstorm' || k === 'hail' ? 1 : k === 'storm' ? 0.4 : 0,
  };
}

interface P {
  x: number;
  y: number;
  v: number;
  s: number;
  ph: number;
}

export interface SkyStage {
  readonly el: HTMLCanvasElement;
  set(kind: WeatherChoice, time: TimeOfDay): void;
}

export function createSkyStage(): SkyStage {
  const cv = document.createElement('canvas');
  cv.className = 'sky-stage';
  const g = cv.getContext('2d')!;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let cur: Sky | null = null;
  let to: Sky | null = null;
  let randomT = 0;
  let randomI = 0;
  let wantTime: TimeOfDay = 'afternoon';
  let wantKind: WeatherChoice = 'clear';
  const RANDOM_CYCLE: WeatherKind[] = ['clear', 'rain', 'snow', 'fog', 'thunderstorm', 'sandstorm', 'cloudy', 'hail'];
  const parts: P[] = Array.from({ length: 320 }, () => ({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.8, s: Math.random(), ph: Math.random() * 6.28 }));
  const clouds = Array.from({ length: 9 }, (_, i) => ({ x: Math.random() * 1.4 - 0.2, y: 0.08 + (i % 3) * 0.12 + Math.random() * 0.08, w: 0.22 + Math.random() * 0.26, h: 0.08 + Math.random() * 0.07 }));
  const hills = Array.from({ length: 40 }, (_, i) => 0.5 + 0.5 * Math.sin(i * 0.9 + 1.3) * Math.cos(i * 0.37));
  const stars = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random() * 0.6, a: 0.3 + Math.random() * 0.7 }));
  let flash = 0;
  let nextBolt = 2;
  let boltX = 0.5;
  let last = performance.now();
  let raf = 0;
  let w = 0;
  let h = 0;

  const ease = (a: number, b: number, k: number) => a + (b - a) * k;
  const step = (k: number) => {
    if (!cur || !to) return;
    const c = cur;
    const t = to;
    c.top = mixC(c.top, t.top, k);
    c.hor = mixC(c.hor, t.hor, k);
    c.ground = mixC(c.ground, t.ground, k);
    for (const key of ['sunX', 'sunY', 'sun', 'night', 'cloud', 'dark', 'rain', 'snow', 'hail', 'dust', 'fog', 'heat', 'cover', 'wind', 'bolt'] as const) c[key] = ease(c[key], t[key], k);
  };

  const draw = (dt: number, time: number) => {
    const s = cur!;
    const r = devicePixelRatio || 1;
    const cw = Math.round(cv.clientWidth * r);
    const ch = Math.round(cv.clientHeight * r);
    if (cw !== w || ch !== h) {
      w = cv.width = cw;
      h = cv.height = ch;
    }
    if (!w || !h) return;
    const gy = h * 0.8;
    // sky
    const sky = g.createLinearGradient(0, 0, 0, gy);
    sky.addColorStop(0, css(s.top));
    sky.addColorStop(1, css(s.hor));
    g.fillStyle = sky;
    g.fillRect(0, 0, w, gy + 1);
    // stars, then the sun or the moon on its arc
    const clearK = 1 - Math.min(1, s.cloud * 1.3);
    if (s.night > 0.05 && clearK > 0.02) {
      for (const st of stars) {
        g.fillStyle = `rgba(255,255,255,${st.a * s.night * clearK * (0.75 + 0.25 * Math.sin(time * 2 + st.x * 40))})`;
        g.fillRect(st.x * w, st.y * gy, r * 1.2, r * 1.2);
      }
    }
    const sx = s.sunX * w;
    const sy = s.sunY * gy;
    if (s.sun > 0.01) {
      const moon = s.night > 0.6;
      const rad = (moon ? 9 : 11 + 5 * s.heat) * r;
      const glow = g.createRadialGradient(sx, sy, 0, sx, sy, rad * (moon ? 5 : 9));
      const gc: RGB = moon ? [200, 214, 255] : s.sunY > 0.6 ? [255, 190, 120] : [255, 244, 214];
      glow.addColorStop(0, css(gc, 0.55 * s.sun));
      glow.addColorStop(1, css(gc, 0));
      g.fillStyle = glow;
      g.fillRect(0, 0, w, gy);
      g.fillStyle = css(moon ? [236, 240, 255] : mixC(gc, [255, 255, 255], 0.6), Math.min(1, s.sun * 1.2));
      g.beginPath();
      g.arc(sx, sy, rad, 0, Math.PI * 2);
      g.fill();
    }
    // clouds: soft heaps drifting with the wind, merging into a deck as it closes
    const lit = 0.25 + 0.75 * (1 - s.night);
    const cc: RGB = mixC([250, 250, 252].map((c) => c * lit) as RGB, [70, 76, 84].map((c) => c * lit) as RGB, s.dark);
    const cloudA = Math.min(1, s.cloud * 1.15);
    if (cloudA > 0.02) {
      for (const c of clouds) {
        c.x += (dt * (0.006 + Math.abs(s.wind) * 0.0016) * Math.sign(s.wind || 1)) / (0.6 + c.y);
        if (c.x > 1.25) c.x -= 1.5;
        if (c.x < -0.25) c.x += 1.5;
        const cx = c.x * w;
        const cy = c.y * gy;
        const rx = c.w * w * (0.6 + s.cloud * 0.8);
        const ry = c.h * gy * (0.7 + s.cloud * 0.7);
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
        gr.addColorStop(0, css(cc, 0.62 * cloudA));
        gr.addColorStop(0.55, css(cc, 0.32 * cloudA));
        gr.addColorStop(1, css(cc, 0));
        g.save();
        g.translate(cx, cy);
        g.scale(1, ry / rx);
        g.translate(-cx, -cy);
        g.fillStyle = gr;
        g.fillRect(cx - rx, cy - rx, rx * 2, rx * 2);
        g.restore();
      }
      if (s.cloud > 0.75) {
        g.fillStyle = css(cc, (s.cloud - 0.75) * 2.2 * 0.6);
        g.fillRect(0, 0, w, gy * 0.55);
      }
    }
    // lightning: a flicker of the whole sky and now and then a bolt
    if (s.bolt > 0.3 && !reduce) {
      nextBolt -= dt;
      if (nextBolt <= 0) {
        flash = 1;
        boltX = 0.15 + Math.random() * 0.7;
        nextBolt = 2.5 + Math.random() * 4 / s.bolt;
      }
    }
    if (flash > 0.01) {
      g.fillStyle = `rgba(230,236,255,${0.45 * flash})`;
      g.fillRect(0, 0, w, gy);
      if (flash > 0.55) {
        g.strokeStyle = `rgba(255,255,255,${flash})`;
        g.lineWidth = 2 * r;
        g.beginPath();
        let bx = boltX * w;
        let by = gy * 0.12;
        g.moveTo(bx, by);
        while (by < gy * 0.9) {
          by += gy * 0.12;
          bx += (Math.sin(by * 13.1 + boltX * 50) * 0.5) * w * 0.04;
          g.lineTo(bx, by);
        }
        g.stroke();
      }
      flash *= Math.exp(-dt * 7);
    }
    // the far hills and trees, then the ground (white under snow, ochre in sand)
    const hillC = mixC(s.ground.map((c) => c * 0.75) as RGB, s.hor, 0.55 + 0.35 * Math.min(1, s.fog + s.dust + s.snow * 0.6));
    g.fillStyle = css(hillC);
    g.beginPath();
    g.moveTo(0, gy);
    for (let i = 0; i < hills.length; i++) g.lineTo((i / (hills.length - 1)) * w, gy - (8 + hills[i] * 14) * r);
    g.lineTo(w, gy);
    g.fill();
    const gg = g.createLinearGradient(0, gy, 0, h);
    gg.addColorStop(0, css(mixC(s.ground, s.hor, 0.35)));
    gg.addColorStop(1, css(s.ground.map((c) => c * 0.7) as RGB));
    g.fillStyle = gg;
    g.fillRect(0, gy, w, h - gy);
    // a strip of track across it, slush-grey or wet-black
    g.fillStyle = css(mixC([44, 46, 50].map((c) => c * (0.35 + 0.65 * (1 - s.night))) as RGB, [24, 26, 30], Math.min(1, s.rain * 1.5 + s.snow)));
    g.fillRect(0, gy + (h - gy) * 0.42, w, (h - gy) * 0.3);
    // heat shimmer over the ground
    if (s.heat > 0.05) {
      g.strokeStyle = `rgba(255,236,200,${0.18 * s.heat})`;
      g.lineWidth = r;
      for (let k = 0; k < 3; k++) {
        g.beginPath();
        const yy = gy - (3 + k * 4) * r;
        for (let x = 0; x <= w; x += 6 * r) g.lineTo(x, yy + Math.sin(x * 0.05 / r + time * 6 + k) * 1.5 * r);
        g.stroke();
      }
    }
    // fog and blown sand: bands of murk drifting across
    const murk = Math.min(1, Math.max(0, s.fog - 0.25) * 1.2 + s.dust * 0.7 + s.snow * 0.25);
    if (murk > 0.02) {
      const mc = mixC(s.hor, [230, 226, 218].map((c) => c * (0.3 + 0.7 * (1 - s.night))) as RGB, 0.3 * (1 - s.dust));
      const fg = g.createLinearGradient(0, gy * 0.35, 0, h);
      fg.addColorStop(0, css(mc, 0));
      fg.addColorStop(0.55, css(mc, 0.75 * murk));
      fg.addColorStop(1, css(mc, 0.4 * murk));
      g.fillStyle = fg;
      g.fillRect(0, 0, w, h);
      for (let k = 0; k < 3; k++) {
        const y0 = gy * (0.6 + k * 0.14);
        const off = ((time * (0.02 + Math.abs(s.wind) * 0.004) * (k + 1)) % 1) * w;
        g.fillStyle = css(mc, 0.12 * murk);
        g.fillRect(-off, y0, w * 2, 6 * r);
      }
    }
    // what falls: rain slanting with the wind, snow fluttering, hail bouncing, sand streaming
    const n = Math.round(parts.length * Math.min(1, Math.max(s.rain * 1.1, s.snow, s.hail * 0.8, s.dust * 0.9)));
    const slant = s.wind * 0.06;
    for (let i = 0; i < n; i++) {
      const p = parts[i];
      const isSnow = i / parts.length < s.snow / Math.max(0.001, s.snow + s.rain + s.hail);
      const isHail = !isSnow && s.hail > 0.3;
      const isDust = s.dust > 0.3;
      const near = 0.4 + 0.6 * p.s;
      if (!reduce) {
        if (isDust) {
          p.x += dt * (0.5 + Math.abs(s.wind) * 0.05) * near * Math.sign(s.wind || 1);
          p.y += dt * Math.sin(time * 2 + p.ph) * 0.05;
        } else if (isSnow) {
          p.y += dt * 0.09 * p.v * (0.6 + near);
          p.x += dt * (slant * 0.6 + Math.sin(time * 1.4 + p.ph) * 0.03) * near;
        } else {
          p.y += dt * (isHail ? 1.6 : 1.25) * p.v * near;
          p.x += dt * slant * near;
        }
        if (p.y > 1) {
          p.y -= 1;
          p.x = Math.random();
        }
        if (p.x > 1.05) p.x -= 1.1;
        if (p.x < -0.05) p.x += 1.1;
      }
      const px = p.x * w;
      const py = p.y * h;
      if (isDust) {
        g.fillStyle = `rgba(214,160,100,${0.45 * near * s.dust})`;
        g.fillRect(px, py, (6 + 10 * near) * r, r * near * 1.4);
      } else if (isSnow) {
        g.fillStyle = `rgba(255,255,255,${0.55 + 0.45 * near})`;
        g.beginPath();
        g.arc(px, py, (0.8 + 1.9 * near * near) * r, 0, Math.PI * 2);
        g.fill();
      } else if (isHail) {
        g.fillStyle = `rgba(240,246,255,${0.6 + 0.4 * near})`;
        g.beginPath();
        g.arc(px, py, (1 + 1.2 * near) * r, 0, Math.PI * 2);
        g.fill();
      } else {
        g.strokeStyle = `rgba(210,222,240,${0.22 + 0.4 * near})`;
        g.lineWidth = (0.6 + 0.8 * near) * r;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(px - slant * 14 * r * near, py - (9 + 9 * near) * r);
        g.stroke();
      }
    }
    // a vignette to seat it in the card
    const vg = g.createLinearGradient(0, 0, w, 0);
    vg.addColorStop(0, 'rgba(8,10,14,0.72)');
    vg.addColorStop(0.55, 'rgba(8,10,14,0.12)');
    vg.addColorStop(1, 'rgba(8,10,14,0)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
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
        randomT = 1.4;
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
      if (!cur) cur = { ...to, top: [...to.top] as RGB, hor: [...to.hor] as RGB, ground: [...to.ground] as RGB };
      kick();
    },
  };
}
