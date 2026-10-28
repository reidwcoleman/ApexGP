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

export type WeatherKind =
  | 'clear'
  | 'haze'
  | 'heatwave'
  | 'windy'
  | 'sandstorm'
  | 'cloudy'
  | 'overcast'
  | 'mist'
  | 'fog'
  | 'frost'
  | 'drying'
  | 'sunshower'
  | 'drizzle'
  | 'rain'
  | 'storm'
  | 'thunderstorm'
  | 'hail'
  | 'sleet'
  | 'flurries'
  | 'snow'
  | 'blizzard';
export type TimeOfDay = 'dawn' | 'morning' | 'midday' | 'afternoon' | 'golden' | 'sunset' | 'dusk' | 'night';
export type WeatherChoice = 'random' | 'changeable' | WeatherKind;
export type TimeChoice = 'random' | TimeOfDay;

export const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  haze: 'Hazy sun',
  windy: 'Windy',
  cloudy: 'Light cloud',
  overcast: 'Overcast',
  mist: 'Morning mist',
  fog: 'Fog',
  drying: 'Drying track',
  sunshower: 'Sunny showers',
  drizzle: 'Drizzle',
  rain: 'Rain',
  storm: 'Heavy rain',
  thunderstorm: 'Thunderstorm',
  heatwave: 'Heatwave',
  sandstorm: 'Sandstorm',
  frost: 'Frosty morning',
  hail: 'Hailstorm',
  sleet: 'Sleet',
  flurries: 'Snow flurries',
  snow: 'Snow',
  blizzard: 'Blizzard',
};

export const TIME_LABEL: Record<TimeOfDay, string> = {
  dawn: 'Dawn',
  morning: 'Morning',
  midday: 'Midday',
  afternoon: 'Afternoon',
  golden: 'Golden hour',
  sunset: 'Sunset',
  dusk: 'Twilight',
  night: 'Night',
};

/** the sun is low and warm: long shadows, orange light, pink cloud undersides */
export const isLowSun = (t: TimeOfDay) => t === 'golden' || t === 'sunset' || t === 'dawn' || t === 'dusk';

/** how far the circuit floodlights are up: 0 daylight, ~0.75 at twilight, 1 for a night race */
export const floodlit = (t: TimeOfDay) => (t === 'night' ? 1 : t === 'dusk' ? 0.75 : 0);

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
  /** strikes so far this session (a change = a new strike), how far away the last one was (km), and
   *  whether it came to ground (1: a visible channel) or stayed in the cloud (0: sheet lightning) */
  strike?: number;
  strikeKm?: number;
  strikeBolt?: number;
  /** °C */
  airTemp: number;
  trackTemp: number;
  /** seconds of weather simulated (animation clock) */
  t: number;
  /** heat haze over hot asphalt 0 … 1 (shimmer, mirages) */
  heat?: number;
  /** convective towering (cumulonimbus, anvils) 0 … 1 */
  conv?: number;
  /** snowfall rate 0 … 1 (flurries ~0.3, steady snow ~0.7, a blizzard 1) */
  snow?: number;
  /** snow (or frost) lying on the grass, the run-off and the roofs 0 … 1 */
  snowCover?: number;
  /** 0 … 1 of the falling precipitation that is hail (white pellets, bouncing) */
  hail?: number;
  /** blowing sand and dust 0 … 1 (a sandstorm) */
  dust?: number;
  /** the air mass's own temperature offset (°C): a cold snap, a heatwave */
  chill?: number;
}

interface Key {
  t: number;
  cloud: number;
  rain: number;
  fog: number;
  heat: number;
  conv: number;
  snow: number;
  hail: number;
  dust: number;
  chill: number;
  /** the regime this key was rolled from */
  k: WeatherKind;
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

/**
 * heat: shimmer over the asphalt (scaled by the sun at draw time); conv: towering convective cloud;
 * snow / hail / dust: what falls or blows (default 0); chill: the air mass's temperature offset (°C)
 */
type Regime = { cloud: number; rain: number; fog: number; heat: number; conv: number; snow?: number; hail?: number; dust?: number; chill?: number };
const REGIME: Record<WeatherKind, Regime> = {
  clear: { cloud: 0.1, rain: 0, fog: 0, heat: 0.35, conv: 0 },
  haze: { cloud: 0.12, rain: 0, fog: 0.5, heat: 1, conv: 0 },
  // (a blustery day: fast, ragged broken cumulus — more of the sky than fair-weather cloud covers)
  windy: { cloud: 0.54, rain: 0, fog: 0.02, heat: 0, conv: 0.1 },
  // (morning mist is radiation fog: it forms under a clear night sky and lies under a blue morning one)
  mist: { cloud: 0.3, rain: 0, fog: 0.9, heat: 0, conv: 0 },
  drying: { cloud: 0.35, rain: 0, fog: 0.15, heat: 0, conv: 0.2 },
  cloudy: { cloud: 0.52, rain: 0, fog: 0.05, heat: 0.15, conv: 0.25 },
  overcast: { cloud: 0.86, rain: 0, fog: 0.18, heat: 0, conv: 0 },
  // (fog under a broken deck: the sun still lights the top of the layer, the murk glows round it)
  fog: { cloud: 0.6, rain: 0, fog: 1, heat: 0, conv: 0 },
  sunshower: { cloud: 0.44, rain: 0.36, fog: 0.08, heat: 0, conv: 0.55 },
  drizzle: { cloud: 0.93, rain: 0.22, fog: 0.35, heat: 0, conv: 0 },
  rain: { cloud: 0.97, rain: 0.62, fog: 0.5, heat: 0, conv: 0.15 },
  storm: { cloud: 1, rain: 1, fog: 0.7, heat: 0, conv: 0.45 },
  thunderstorm: { cloud: 0.96, rain: 0.9, fog: 0.55, heat: 0, conv: 1 },
  // (a heatwave is clear, still and scorching: hardly any haze, the asphalt boiling with mirages)
  heatwave: { cloud: 0.04, rain: 0, fog: 0.22, heat: 1.5, conv: 0, chill: 10 },
  // (a haboob: a wall of sand on a gale, the sun a pale disc in an orange-brown murk)
  sandstorm: { cloud: 0.32, rain: 0, fog: 0.55, heat: 0, conv: 0.1, dust: 1, chill: 4 },
  // (a clear, still night left a hoar frost on the grass: it glitters, then melts as the sun gets up)
  // (with a thin mist lying in the low ground, burning off with the frost)
  frost: { cloud: 0.06, rain: 0, fog: 0.42, heat: 0, conv: 0, chill: -16 },
  // (hail falls out of a big convective cell: a short, violent battering of ice, the track turned white)
  hail: { cloud: 0.92, rain: 0.5, fog: 0.4, heat: 0, conv: 0.9, hail: 1, chill: -8 },
  // (rain and wet snow together, just above freezing: grey, raw, a slushy track)
  sleet: { cloud: 0.95, rain: 0.34, fog: 0.42, heat: 0, conv: 0, snow: 0.45, chill: -14 },
  flurries: { cloud: 0.66, rain: 0, fog: 0.2, heat: 0, conv: 0.1, snow: 0.3, chill: -22 },
  snow: { cloud: 0.93, rain: 0, fog: 0.45, heat: 0, conv: 0, snow: 0.72, chill: -25 },
  blizzard: { cloud: 1, rain: 0, fog: 0.82, heat: 0, conv: 0, snow: 1, chill: -29 },
};

/** regimes that can't be told apart from cloud + rain alone */
const NAMED: Partial<Record<WeatherKind, true>> = {
  haze: true,
  windy: true,
  mist: true,
  fog: true,
  drying: true,
  sunshower: true,
  thunderstorm: true,
  heatwave: true,
  sandstorm: true,
  frost: true,
  hail: true,
  sleet: true,
  flurries: true,
  snow: true,
  blizzard: true,
};
const WET: WeatherKind[] = ['sunshower', 'drizzle', 'rain', 'storm', 'thunderstorm', 'hail', 'sleet', 'snow', 'blizzard'];
export const isWetKind = (k: WeatherKind) => WET.includes(k);
const WINTRY: WeatherKind[] = ['frost', 'sleet', 'flurries', 'snow', 'blizzard'];
/** a cold-weather sky: snow or frost lies on the ground */
export const isWintryKind = (k: WeatherKind) => WINTRY.includes(k);
/** something falls that isn't rain (snow, sleet, hail): the forecast and the engineer name it */
export const isSnowKind = (k: WeatherKind) => k === 'sleet' || k === 'flurries' || k === 'snow' || k === 'blizzard';

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
      ['clear', 20],
      ['haze', 7],
      ['windy', 6],
      ['mist', 5],
      ['drying', 6],
      ['cloudy', 18],
      ['overcast', 10],
      ['fog', 5],
      ['sunshower', 5],
      ['drizzle', 8],
      ['rain', 8],
      ['storm', 3],
      ['thunderstorm', 5],
      ['heatwave', 3],
      ['sandstorm', 2],
      ['frost', 2],
      ['hail', 2],
      ['sleet', 2],
      ['flurries', 2],
      ['snow', 2],
      ['blizzard', 1],
      ['changeable', 12],
    ]);
  }
  const RAMP = 110;
  let start: WeatherKind;
  let end: WeatherKind;
  let changeAt = Infinity;
  if (resolved === 'changeable') {
    // rain arriving is more fun (and more common) than rain stopping
    const roll = r();
    if (roll < 0.6) {
      // the rain arrives: a hot hazy day that breaks into a thunderstorm, or cloud thickening into rain
      start = pick<WeatherKind>(r, [['cloudy', 4], ['overcast', 4], ['haze', 2], ['windy', 1]]);
      end = pick<WeatherKind>(r, [['drizzle', 4], ['rain', 4], ['storm', 1], ['thunderstorm', start === 'haze' ? 5 : 2], ['sunshower', 1]]);
    } else if (roll < 0.9) {
      // the rain moves through and the sun comes out
      start = pick<WeatherKind>(r, [['drizzle', 3], ['rain', 2], ['thunderstorm', 1]]);
      end = pick<WeatherKind>(r, [['cloudy', 3], ['overcast', 2], ['sunshower', 2], ['clear', 1]]);
    } else if (roll < 0.95) {
      // morning fog that burns off into a bright day
      start = 'fog';
      end = pick<WeatherKind>(r, [['clear', 2], ['cloudy', 2], ['haze', 1]]);
    } else {
      // a cold front: grey skies turning to snow, or the snow easing off
      start = pick<WeatherKind>(r, [['overcast', 3], ['sleet', 2], ['flurries', 2]]);
      end = start === 'overcast' ? pick<WeatherKind>(r, [['flurries', 2], ['snow', 2], ['sleet', 1]]) : pick<WeatherKind>(r, [['snow', 2], ['overcast', 1], ['blizzard', 1]]);
    }
    changeAt = Math.max(45, duration * (0.28 + r() * 0.34));
  } else {
    start = end = resolved as WeatherKind;
  }
  const time: TimeOfDay =
    timeChoice !== 'random'
      ? timeChoice
      : start === 'frost'
        ? // (a frost is the morning after a clear, cold night)
          pick<TimeOfDay>(r, [['dawn', 2], ['morning', 3]])
        : start === 'heatwave'
          ? pick<TimeOfDay>(r, [['midday', 3], ['afternoon', 3], ['golden', 1]])
          : pick<TimeOfDay>(r, [
          ['dawn', 8],
          ['morning', 18],
          ['midday', 16],
          ['afternoon', 30],
          ['golden', 18],
          ['sunset', 10],
          ['dusk', 8],
          ['night', 11],
        ]);

  // keyframes: gentle wobble around the regime, plus the change if any
  const keys: Key[] = [];
  const span = Math.max(duration * 1.6, 600);
  const wob = (k: WeatherKind) => {
    const g = REGIME[k];
    return {
      cloud: Math.min(1, Math.max(0, g.cloud + (r() - 0.5) * (k === 'cloudy' ? 0.16 : 0.08))),
      rain: g.rain > 0 ? Math.max(0.12, g.rain * (0.8 + r() * 0.4)) : 0,
      fog: Math.min(1, Math.max(0, g.fog + (r() - 0.5) * 0.1)),
      heat: g.heat,
      conv: Math.min(1, Math.max(0, g.conv + (g.conv > 0 ? (r() - 0.5) * 0.2 : 0))),
      snow: g.snow ? Math.min(1, Math.max(0.12, g.snow * (0.85 + r() * 0.3))) : 0,
      hail: g.hail ?? 0,
      dust: g.dust ? Math.min(1, g.dust * (0.8 + r() * 0.2)) : 0,
      chill: g.chill ?? 0,
      k,
    };
  };
  let showerI = 0;
  // a storm on its way: for the last few minutes before it breaks, towering cumulus and
  // cumulonimbus build and anvil out while the sun is still shining
  const stormEnd = isFinite(changeAt) && (end === 'thunderstorm' || end === 'storm') && start !== 'rain' && start !== 'drizzle';
  const BUILD = 330;
  const building = (key: Key) => {
    if (!stormEnd || key.t >= changeAt || key.t < changeAt - BUILD) return;
    const f = 1 - (changeAt - key.t) / BUILD;
    key.conv = Math.max(key.conv, 0.5 + 0.45 * f);
    key.cloud = Math.min(0.6, Math.max(key.cloud, 0.4 + 0.16 * f));
  };
  for (let t = 0; t <= span; t += 90) {
    let k = start;
    if (t >= changeAt + RAMP) k = end;
    else if (t > changeAt) {
      // push a key exactly at the change and one at its end, so the ramp is ~2 min
      k = end;
    }
    const key = { t, ...wob(k) };
    // morning mist burns off over the session (a lighter veil lingers in the hollows)
    if (k === 'mist' || k === 'frost') key.fog *= Math.max(0.18, 1 - t / Math.max(360, duration * 0.85));
    // scattered showers: bursts of rain from towering cumulus, with sunny spells between
    // (the first key rains, so the session starts under a shower with the sun out)
    if (k === 'sunshower') {
      if (showerI++ > 0 && r() < 0.45) {
        key.rain = 0;
        key.cloud = Math.max(0.2, key.cloud - 0.14);
      } else key.rain = Math.max(0.22, key.rain);
    }
    building(key);
    keys.push(key);
  }
  if (isFinite(changeAt)) {
    const a = { t: changeAt, ...wob(start) };
    const b = wob(end);
    if (stormEnd) {
      a.conv = 0.95;
      a.cloud = Math.min(0.62, Math.max(a.cloud, 0.56));
      if (changeAt > BUILD * 0.5 + 20) keys.push({ ...a, t: changeAt - BUILD * 0.5, conv: 0.8, cloud: Math.min(0.6, Math.max(a.cloud - 0.06, 0.48)) });
    }
    keys.push(a, { t: changeAt + RAMP, ...b });
    keys.sort((x, y) => x.t - y.t);
    // drop grid keys that fall inside the ramp
    for (let i = keys.length - 1; i >= 0; i--) if (keys[i].t > changeAt && keys[i].t < changeAt + RAMP) keys.splice(i, 1);
    // (a grid key sitting right next to the inserted build-up key would make a kink)
    for (let i = keys.length - 2; i >= 0; i--) if (Math.abs(keys[i + 1].t - keys[i].t) < 20) keys.splice(keys[i].k === start && keys[i].conv < keys[i + 1].conv ? i : i + 1, 1);
  }

  const windDir = r() * Math.PI * 2;
  const stormy = (k: WeatherKind) => k === 'storm' || k === 'thunderstorm';
  const gale = (k: WeatherKind) => k === 'blizzard' || k === 'sandstorm';
  const still = (k: WeatherKind) => k === 'fog' || k === 'mist' || k === 'haze' || k === 'frost' || k === 'heatwave';
  const windSpeed =
    gale(start) || gale(end)
      ? 12 + r() * 6
      : stormy(end) || stormy(start) || start === 'hail'
        ? 7 + r() * 6
        : start === 'windy'
          ? 10 + r() * 5
          : still(start)
            ? 0.3 + r() * 1.2
            : 1 + r() * 4.5;
  return { choice, start, end, changeAt, time, keys, windX: Math.sin(windDir) * windSpeed, windZ: Math.cos(windDir) * windSpeed, seed };
}

const smooth = (x: number) => x * x * (3 - 2 * x);

export class Weather {
  readonly plan: WeatherPlan;
  readonly state: WeatherState;
  private nextFlash = 6;
  private flashT = 1e3;
  /** the current strike: start time, peak pairs */
  private readonly strokes: number[] = [];

  /** brightness of the current strike `f` seconds after it began */
  private flashLevel(f: number): number {
    const S = this.strokes;
    if (!S.length || f > 2) return 0;
    let v = 0;
    const last = S[S.length - 2];
    for (let i = 0; i < S.length; i += 2) {
      const d = f - S[i];
      if (d < 0) break;
      // each stroke: a hard 50 ms peak, then the channel glows on between restrikes
      const p = S[i + 1];
      v = Math.max(v, d < 0.05 ? p : d < 0.11 ? p * (1 - (d - 0.05) / 0.06 * 0.62) : 0);
    }
    const glow = f < last + 0.11 ? (f > 0.05 ? 0.36 * S[1] : 0) : Math.max(0, 0.36 * S[1] * (1 - (f - last - 0.11) / 0.45));
    return Math.max(v, glow);
  }

  constructor(plan: WeatherPlan) {
    this.plan = plan;
    const k0 = this.sample(0);
    // a drying track: the rain has just passed, the surface is still wet
    const wet0 = isWetKind(plan.start) ? this.wetTarget(this.liquid(k0)) : plan.start === 'drying' ? 0.7 : 0;
    // (it has been snowing for a while: the verges are already white; a frost lies on the grass at dawn)
    const cover0 = plan.start === 'frost' ? 0.5 : k0.snow > 0 ? Math.min(1, 0.25 + k0.snow * 0.75) : k0.hail > 0 ? 0.35 : 0;
    this.state = {
      kind: plan.start,
      time: plan.time,
      cloud: k0.cloud,
      rain: k0.rain,
      wetness: wet0,
      // (and the support race and the laps to the grid have already begun to clear a line)
      dryLine: plan.start === 'drying' ? 0.3 : 0,
      fog: k0.fog,
      windX: plan.windX,
      windZ: plan.windZ,
      lightning: 0,
      strike: 0,
      strikeKm: 3,
      strikeBolt: 0,
      airTemp: 0,
      trackTemp: 0,
      t: 0,
      heat: k0.heat,
      conv: k0.conv,
      snow: k0.snow,
      snowCover: cover0,
      hail: k0.hail,
      dust: k0.dust,
      chill: k0.chill,
    };
    this.temps();
  }

  private sample(t: number): Key {
    const K = this.plan.keys;
    if (t <= K[0].t) return K[0];
    for (let i = 0; i < K.length - 1; i++) {
      const a = K[i], b = K[i + 1];
      if (t <= b.t) {
        const f = smooth((t - a.t) / Math.max(1e-6, b.t - a.t));
        const m = (x: number, y: number) => x + (y - x) * f;
        return {
          t,
          cloud: m(a.cloud, b.cloud),
          rain: m(a.rain, b.rain),
          fog: m(a.fog, b.fog),
          heat: m(a.heat, b.heat),
          conv: m(a.conv, b.conv),
          snow: m(a.snow, b.snow),
          hail: m(a.hail, b.hail),
          dust: m(a.dust, b.dust),
          chill: m(a.chill, b.chill),
          k: f < 0.5 ? a.k : b.k,
        };
      }
    }
    return K[K.length - 1];
  }

  /** what a sample looks like: the named regime if it is one, else read off cloud + rain */
  private kindOf(k: Key): WeatherKind {
    if (NAMED[k.k]) return k.k;
    return k.rain > 0.8 ? 'storm' : k.rain > 0.42 ? 'rain' : k.rain > 0.06 ? 'drizzle' : k.cloud > 0.72 ? 'overcast' : k.cloud > 0.28 ? 'cloudy' : 'clear';
  }

  /** what reaches the asphalt as water: rain, plus snow melting into slush under the tyres */
  private liquid(k: { rain: number; snow: number }) {
    return Math.min(1, k.rain + k.snow * 0.5);
  }

  /** water level the track settles at for a given rain rate */
  private wetTarget(rain: number) {
    return rain > 0.02 ? Math.min(1, 0.12 + rain * 1.02) : 0;
  }

  private temps() {
    const s = this.state;
    const base = { dawn: 15, morning: 19, midday: 28, afternoon: 27, golden: 23, sunset: 21, dusk: 22, night: 20 }[s.time] ?? 24;
    const sun = Math.max(0, 1 - s.cloud * 1.05);
    // (clouds keep the day's warmth in at night)
    s.airTemp = base - s.cloud * (s.time === 'night' ? 0 : 4) - s.rain * 5 + (s.heat ?? 0) * 4 + (s.chill ?? 0);
    // no sun on the asphalt after dark: the track runs only a little warmer than the air
    const solar = s.time === 'night' ? 0 : s.time === 'dusk' ? 2.5 : isLowSun(s.time) ? 7 : s.time === 'midday' ? 21 : 17;
    s.trackTemp = s.airTemp + solar * sun * (1 - 0.5 * (s.snowCover ?? 0)) + (s.time === 'night' ? 1.5 : 3) * (1 - s.wetness) - s.wetness * 4;
  }

  /** advance by dt seconds; `traffic` 0 … 1 is how many cars are running (dries the line) */
  update(dt: number, traffic = 1) {
    const s = this.state;
    s.t += dt;
    const k = this.sample(s.t);
    s.cloud = k.cloud;
    s.rain = k.rain;
    s.fog = k.fog;
    s.heat = k.heat;
    s.conv = k.conv;
    s.snow = k.snow;
    s.hail = k.hail;
    s.dust = k.dust;
    s.chill = k.chill;
    // snow settles on the grass in a few minutes of steady snowfall; it (and a frost) melts away in
    // sunshine and above freezing, slowly under cloud
    {
      const cover = s.snowCover ?? 0;
      // (hail lies too, briefly: a white crust that the rain after it washes away)
      const ice = k.snow + k.hail * k.rain * 0.8;
      if (ice > 0.02) s.snowCover = Math.min(1, cover + (dt / 150) * ice * (1.05 - cover));
      else if (cover > 0) {
        const sun = Math.max(0, 1 - s.cloud * 0.9) * (s.time === 'night' ? 0 : 1);
        const thaw = Math.max(0, s.airTemp + 1) / 10 + sun * 0.8 + s.rain * 1.5;
        s.snowCover = Math.max(0, cover - (dt / 900) * thaw);
      }
    }
    // gusts: the wind breathes (strongest on a windy day and under a storm)
    const P = this.plan;
    const gustK = s.kind === 'windy' || s.kind === 'blizzard' || s.kind === 'sandstorm' ? 1 : s.rain > 0.7 || (s.conv ?? 0) > 0.6 ? 0.7 : 0.25;
    const gust = 1 + gustK * (0.28 * Math.sin(s.t * 0.37 + P.seed) + 0.17 * Math.sin(s.t * 1.13 + 1.7) + 0.08 * Math.sin(s.t * 2.9));
    const veer = gustK * 0.18 * Math.sin(s.t * 0.21 + 0.6);
    const cv = Math.cos(veer), sv = Math.sin(veer);
    s.windX = (P.windX * cv - P.windZ * sv) * gust;
    s.windZ = (P.windX * sv + P.windZ * cv) * gust;

    const target = this.wetTarget(this.liquid(k));
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

    s.kind = this.kindOf(k);
    // once the track is dry it's just a sunny day (and the frost has gone with the sun)
    if (s.kind === 'drying' && s.wetness < 0.04) s.kind = s.cloud > 0.28 ? 'cloudy' : 'clear';
    if (s.kind === 'frost' && (s.snowCover ?? 0) < 0.04) s.kind = 'clear';

    // lightning every 10–30 s in heavy rain, every 3–10 s in a thunderstorm: a cloud-to-ground
    // strike is a leader flash then 1–3 return strokes down the same channel (the flicker you
    // see), about a third are sheet lightning — the clouds light up but no bolt shows
    this.flashT += dt;
    // (a hailstorm is a thunderstorm's core: the hail and the lightning come out of the same cell)
    const thunder = s.kind === 'thunderstorm' || s.kind === 'hail';
    if (s.rain > 0.78 || thunder) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flashT = 0;
        this.nextFlash = thunder ? 3 + Math.random() * 7 : 10 + Math.random() * 20;
        const sheet = Math.random() < 0.35;
        // how far off: ground strikes anywhere from the next field to the far side of the storm cell
        // (0.5 … 6 km, more of them close); sheet lightning flickers deeper in the cell (3 … 14 km).
        // The thunder arrives at the speed of sound — ~3 s a kilometre (Audio)
        s.strike = (s.strike ?? 0) + 1;
        s.strikeKm = sheet ? 3 + Math.random() * 11 : 0.5 * Math.pow(12, Math.random());
        s.strikeBolt = sheet ? 0 : 1;
        this.strokes.length = 0;
        let t0 = 0;
        const n = sheet ? 1 + ((Math.random() * 2) | 0) : 2 + ((Math.random() * 3) | 0);
        for (let i = 0; i < n; i++) {
          this.strokes.push(t0, sheet ? 0.3 + Math.random() * 0.15 : i === 0 ? 1 : 0.65 + Math.random() * 0.35);
          t0 += 0.06 + Math.random() * 0.12;
        }
      }
    }
    s.lightning = this.flashLevel(this.flashT);
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
    return this.kindOf(this.sample(this.state.t + ahead));
  }
}
