/**
 * Weather: a forecast rolled once per session, then simulated through it.
 *
 * The plan is a handful of keyframes (cloud cover, rain rate, mist) over the
 * session's expected length; `update` interpolates them and integrates what
 * the cars actually feel — how much water is on the track, and how far a dry
 * line has been cleared by traffic once the rain stops.
 *
 * Plain numbers only in `state`, so flashbacks can snapshot it. No three.js
 * imports: the physics tools run this under plain Node.
 */

export type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'drizzle' | 'rain' | 'storm';
export type TimeOfDay = 'morning' | 'afternoon' | 'golden';
export type WeatherChoice = 'random' | 'changeable' | WeatherKind;
export type TimeChoice = 'random' | TimeOfDay;

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  cloudy: 'Light cloud',
  overcast: 'Overcast',
  drizzle: 'Light rain',
  rain: 'Rain',
  storm: 'Heavy rain',
};

export const TIME_LABEL: Record<TimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  golden: 'Golden hour',
};

export interface WeatherState {
  /** what it looks like right now (derived from cloud + rain) */
  kind: WeatherKind;
  time: TimeOfDay;
  /** 0 blue sky … 0.5 broken cumulus … 1 solid grey */
  cloud: number;
  /** rain rate: 0 dry, ~0.25 drizzle, ~0.6 rain, 1 downpour */
  rain: number;
  /** standing water on the track: 0 dry, 0.3 damp, 0.6 wet, 1 flooded */
  wetness: number;
  /** 0 … 1: how much drier the racing line is than the rest of the track */
  dryLine: number;
  /** extra mist/haze 0 … 1 */
  fog: number;
  /** wind (m/s, world axes) — slants the rain, drifts spray */
  windX: number;
  windZ: number;
  /** lightning flash brightness this frame, 0 … 1 */
  lightning: number;
  /** °C */
  airTemp: number;
  trackTemp: number;
  /** seconds of weather simulated (animation clock) */
  t: number;
}

interface Key {
  t: number;
  cloud: number;
  rain: number;
  fog: number;
}

export interface WeatherPlan {
  choice: WeatherChoice;
  /** the regime the session starts in and (if changeable) turns into */
  start: WeatherKind;
  end: WeatherKind;
  /** when the change arrives (s), Infinity if it never does */
  changeAt: number;
  time: TimeOfDay;
  keys: Key[];
  windX: number;
  windZ: number;
  seed: number;
}

const REGIME: Record<WeatherKind, { cloud: number; rain: number; fog: number }> = {
  clear: { cloud: 0.06, rain: 0, fog: 0 },
  cloudy: { cloud: 0.45, rain: 0, fog: 0.05 },
  overcast: { cloud: 0.86, rain: 0, fog: 0.18 },
  drizzle: { cloud: 0.93, rain: 0.26, fog: 0.35 },
  rain: { cloud: 0.97, rain: 0.62, fog: 0.5 },
  storm: { cloud: 1, rain: 1, fog: 0.7 },
};

const WET: WeatherKind[] = ['drizzle', 'rain', 'storm'];
export const isWetKind = (k: WeatherKind) => WET.includes(k);

/** tiny deterministic RNG so a plan can be replayed from its seed */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x <= 0) return v;
  }
  return items[items.length - 1][0];
}

/**
 * Roll a forecast. `duration` is the expected session length in seconds; a
 * changeable forecast puts its change somewhere in the middle of it.
 */
export function planWeather(choice: WeatherChoice, timeChoice: TimeChoice, duration: number, seed = (Math.random() * 2 ** 31) | 0): WeatherPlan {
  const r = mulberry(seed);
  // anything unrecognised (old saves, bad URL params) rolls the dice
  if (!(choice === 'random' || choice === 'changeable' || choice in REGIME)) choice = 'random';
  if (!(timeChoice === 'random' || timeChoice in TIME_LABEL)) timeChoice = 'random';
  let resolved: WeatherChoice = choice;
  if (resolved === 'random') {
    resolved = pick<WeatherChoice>(r, [
      ['clear', 26],
      ['cloudy', 24],
      ['overcast', 13],
      ['drizzle', 10],
      ['rain', 10],
      ['storm', 4],
      ['changeable', 13],
    ]);
  }
  let start: WeatherKind;
  let end: WeatherKind;
  let changeAt = Infinity;
  if (resolved === 'changeable') {
    // rain arriving is more fun (and more common) than rain stopping
    if (r() < 0.65) {
      start = r() < 0.5 ? 'cloudy' : 'overcast';
      end = pick<WeatherKind>(r, [['drizzle', 4], ['rain', 4], ['storm', 1]]);
    } else {
      start = r() < 0.6 ? 'drizzle' : 'rain';
      end = r() < 0.5 ? 'cloudy' : 'overcast';
    }
    changeAt = Math.max(45, duration * (0.28 + r() * 0.34));
  } else {
    start = end = resolved as WeatherKind;
  }
  const time: TimeOfDay =
    timeChoice !== 'random'
      ? timeChoice
      : pick<TimeOfDay>(r, [
          ['morning', 25],
          ['afternoon', 50],
          ['golden', 25],
        ]);

  // keyframes: gentle wobble around the regime, plus the change if any
  const keys: Key[] = [];
  const span = Math.max(duration * 1.6, 600);
  const wob = (k: WeatherKind) => {
    const g = REGIME[k];
    return {
      cloud: Math.min(1, Math.max(0, g.cloud + (r() - 0.5) * (k === 'cloudy' ? 0.25 : 0.08))),
      rain: g.rain > 0 ? Math.max(0.12, g.rain * (0.8 + r() * 0.4)) : 0,
      fog: Math.max(0, g.fog + (r() - 0.5) * 0.1),
    };
  };
  for (let t = 0; t <= span; t += 90) {
    let k = start;
    if (t >= changeAt + 75) k = end;
    else if (t > changeAt) {
      // push a key exactly at the change and one at its end, so the ramp is ~75 s
      k = end;
    }
    keys.push({ t, ...wob(k) });
  }
  if (isFinite(changeAt)) {
    const a = wob(start);
    const b = wob(end);
    keys.push({ t: changeAt, ...a }, { t: changeAt + 75, ...b });
    keys.sort((x, y) => x.t - y.t);
    // drop grid keys that fall inside the ramp
    for (let i = keys.length - 1; i >= 0; i--) if (keys[i].t > changeAt && keys[i].t < changeAt + 75) keys.splice(i, 1);
  }

  const windDir = r() * Math.PI * 2;
  const windSpeed = end === 'storm' || start === 'storm' ? 7 + r() * 5 : 1 + r() * 4.5;
  return { choice, start, end, changeAt, time, keys, windX: Math.sin(windDir) * windSpeed, windZ: Math.cos(windDir) * windSpeed, seed };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

export class Weather {
  readonly plan: WeatherPlan;
  readonly state: WeatherState;
  private nextFlash = 6;
  private flashT = 1;

  constructor(plan: WeatherPlan) {
    this.plan = plan;
    const k0 = this.sample(0);
    const wet0 = isWetKind(plan.start) ? this.wetTarget(k0.rain) : 0;
    this.state = {
      kind: plan.start,
      time: plan.time,
      cloud: k0.cloud,
      rain: k0.rain,
      wetness: wet0,
      dryLine: 0,
      fog: k0.fog,
      windX: plan.windX,
      windZ: plan.windZ,
      lightning: 0,
      airTemp: 0,
      trackTemp: 0,
      t: 0,
    };
    this.temps();
  }

  private sample(t: number): { cloud: number; rain: number; fog: number } {
    const K = this.plan.keys;
    if (t <= K[0].t) return K[0];
    for (let i = 0; i < K.length - 1; i++) {
      const a = K[i], b = K[i + 1];
      if (t <= b.t) {
        const f = smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
        return { cloud: a.cloud + (b.cloud - a.cloud) * f, rain: a.rain + (b.rain - a.rain) * f, fog: a.fog + (b.fog - a.fog) * f };
      }
    }
    return K[K.length - 1];
  }

  /** water level the track settles at for a given rain rate */
  private wetTarget(rain: number) {
    return rain > 0.02 ? Math.min(1, 0.12 + rain * 1.02) : 0;
  }

  private temps() {
    const s = this.state;
    const base = s.time === 'afternoon' ? 27 : s.time === 'golden' ? 23 : 19;
    const sun = Math.max(0, 1 - s.cloud * 1.05);
    s.airTemp = base - s.cloud * 4 - s.rain * 5;
    s.trackTemp = s.airTemp + (s.time === 'golden' ? 7 : 17) * sun + 3 * (1 - s.wetness) - s.wetness * 4;
  }

  /** advance by dt seconds; `traffic` 0 … 1 is how many cars are running (dries the line) */
  update(dt: number, traffic = 1) {
    const s = this.state;
    s.t += dt;
    const k = this.sample(s.t);
    s.cloud = k.cloud;
    s.rain = k.rain;
    s.fog = k.fog;

    const target = this.wetTarget(s.rain);
    if (target > s.wetness) {
      s.wetness += (target - s.wetness) * Math.min(1, dt / 40) + 0.003 * s.rain * dt;
      s.wetness = Math.min(s.wetness, 1);
    } else {
      const sun = Math.max(0, 1 - s.cloud * 0.85);
      const rate = (1 / 250) * (0.45 + 0.55 * sun) * (s.rain > 0.02 ? 0.25 : 1) * (0.7 + 0.3 * traffic);
      s.wetness = Math.max(target, s.wetness - rate * dt);
    }
    // traffic clears a line once the rain eases
    if (s.wetness > 0.03 && s.rain < 0.18) s.dryLine = Math.min(1, s.dryLine + (dt / 110) * (1 - s.rain / 0.18) * (0.4 + 0.6 * traffic));
    else if (s.rain > 0.3) s.dryLine = Math.max(0, s.dryLine - dt / 25);
    if (s.wetness <= 0.03) s.dryLine = 0;

    s.kind = s.rain > 0.8 ? 'storm' : s.rain > 0.42 ? 'rain' : s.rain > 0.06 ? 'drizzle' : s.cloud > 0.72 ? 'overcast' : s.cloud > 0.28 ? 'cloudy' : 'clear';

    // lightning in heavy rain: a bright double flicker every 10–30 s
    this.flashT += dt;
    if (s.rain > 0.78) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flashT = 0;
        this.nextFlash = 10 + Math.random() * 20;
      }
    }
    const f = this.flashT;
    s.lightning = f < 0.08 ? 1 : f < 0.16 ? 0.25 : f < 0.24 ? 0.8 : f < 0.6 ? Math.max(0, 0.3 * (1 - (f - 0.24) / 0.36)) : 0;
    this.temps();
  }

  /**
   * Water under a tyre at `lateral` when the racing line runs at `lineLat`:
   * the dry line is ~4 m wide and never quite bone dry while the rest is wet.
   */
  wetnessAt(lateral: number, lineLat: number): number {
    const s = this.state;
    if (s.wetness <= 0) return 0;
    const d = (lateral - lineLat) / 2.3;
    return s.wetness * (1 - 0.85 * s.dryLine * Math.exp(-d * d));
  }

  /** the regime expected `ahead` seconds from now (for the engineer and HUD) */
  forecast(ahead: number): WeatherKind {
    const k = this.sample(this.state.t + ahead);
    return k.rain > 0.8 ? 'storm' : k.rain > 0.42 ? 'rain' : k.rain > 0.06 ? 'drizzle' : k.cloud > 0.72 ? 'overcast' : k.cloud > 0.28 ? 'cloudy' : 'clear';
  }
}
