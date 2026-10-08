import type { TimeChoice, WeatherChoice } from '../world/Weather.ts';

/**
 * The career season as a map: where each round is in the world, the weather it tends to have,
 * and a low-detail world outline to draw the calendar on. Pure data, no scene.
 */

/** latitude, longitude of each circuit */
export const GEO: Record<string, [number, number]> = {
  monza: [45.62, 9.28],
  spa: [50.44, 5.97],
  silverstone: [52.07, -1.02],
  suzuka: [34.84, 136.54],
  interlagos: [-23.7, -46.7],
  spielberg: [47.22, 14.76],
  zandvoort: [52.39, 4.54],
  austin: [30.13, -97.64],
  montreal: [45.5, -73.52],
  melbourne: [-37.85, 144.97],
  sakhir: [26.03, 50.51],
  yasmarina: [24.47, 54.6],
  mexico: [19.4, -99.09],
  hungaroring: [47.58, 19.25],
};

/**
 * Where a round's pin sits relative to its circuit (map units): the European rounds are a few
 * hundred kilometres apart, so their pins fan out round the continent on short leaders.
 */
export const PIN_OFFSET: Record<string, [number, number]> = {
  silverstone: [-38, -26],
  zandvoort: [-6, -44],
  spa: [-44, 8],
  monza: [-22, 40],
  spielberg: [26, -42],
  hungaroring: [40, 6],
  sakhir: [-16, 26],
  yasmarina: [22, 20],
  austin: [-4, 26],
  mexico: [-26, 22],
  montreal: [16, -20],
};

// map frame: an equirectangular crop of the world that holds every round
export const MAP = { lon0: -128, lon1: 162, lat0: 64, lat1: -48, w: 1000 };
export const MAP_H = Math.round((MAP.w * (MAP.lat0 - MAP.lat1)) / (MAP.lon1 - MAP.lon0));

export function project(lat: number, lon: number): [number, number] {
  return [((lon - MAP.lon0) / (MAP.lon1 - MAP.lon0)) * MAP.w, ((MAP.lat0 - lat) / (MAP.lat0 - MAP.lat1)) * MAP_H];
}

/** simplified land outlines, [lon, lat] */
const LAND: [number, number][][] = [
  // North America
  [[-168, 65], [-160, 70], [-140, 70], [-125, 70], [-110, 73], [-95, 72], [-82, 69], [-78, 63], [-94, 59], [-88, 55], [-80, 52], [-78, 58], [-70, 60], [-62, 56], [-56, 51], [-60, 46], [-66, 44], [-70, 42], [-74, 40], [-76, 35], [-81, 31], [-80, 26], [-82, 29], [-86, 30], [-90, 29], [-95, 29], [-97, 26], [-97, 22], [-94, 18], [-90, 21], [-87, 21], [-88, 16], [-84, 15], [-83, 10], [-79, 9], [-81, 8], [-86, 12], [-92, 15], [-98, 16], [-105, 20], [-106, 23], [-110, 27], [-113, 31], [-111, 25], [-110, 23], [-115, 29], [-118, 34], [-121, 36], [-124, 41], [-124, 47], [-123, 49], [-128, 51], [-133, 55], [-137, 58], [-143, 60], [-150, 60], [-153, 57], [-160, 56], [-164, 59], [-166, 62]],
  // Greenland
  [[-52, 60], [-44, 60], [-40, 65], [-22, 70], [-20, 76], [-28, 82], [-50, 82], [-60, 78], [-68, 76], [-58, 72], [-54, 67]],
  // South America
  [[-79, 9], [-72, 12], [-62, 11], [-58, 7], [-52, 5], [-50, 0], [-44, -2], [-35, -6], [-35, -9], [-39, -15], [-40, -22], [-48, -26], [-53, -33], [-58, -35], [-57, -38], [-62, -40], [-65, -45], [-67, -50], [-69, -53], [-72, -52], [-75, -47], [-73, -40], [-72, -30], [-71, -20], [-76, -14], [-80, -8], [-81, -3], [-80, 1], [-78, 5]],
  // Europe (with Scandinavia)
  [[-9, 37], [-9, 43], [-2, 44], [-1, 46], [-5, 48], [-1, 49], [2, 51], [4, 52], [7, 54], [8, 57], [10, 55], [12, 54], [14, 55], [18, 55], [21, 57], [24, 60], [22, 63], [25, 65], [22, 66], [18, 63], [17, 61], [18, 59], [16, 56], [12, 56], [11, 59], [8, 58], [5, 59], [5, 62], [9, 64], [14, 67], [19, 70], [26, 71], [31, 70], [40, 68], [44, 66], [44, 60], [40, 57], [38, 52], [40, 48], [38, 47], [34, 45], [30, 45], [29, 41], [26, 40], [23, 38], [22, 40], [19, 42], [16, 43], [13, 45], [12, 44], [15, 41], [16, 38], [18, 40], [16, 41], [12, 42], [10, 44], [7, 44], [3, 43], [0, 41], [-1, 38], [-5, 36]],
  // Great Britain + Ireland
  [[-5, 50], [1, 51], [2, 53], [0, 54], [-2, 56], [-2, 58], [-5, 58.5], [-6, 57], [-5, 55], [-3, 54.5], [-4, 53], [-5, 52], [-3, 51.5]],
  [[-10, 52], [-6, 52], [-6, 54], [-8, 55], [-10, 54]],
  // Africa
  [[-17, 21], [-16, 28], [-10, 30], [-6, 35], [3, 37], [10, 37], [11, 33], [20, 31], [25, 32], [32, 31], [35, 28], [39, 22], [43, 13], [51, 12], [51, 10], [46, 2], [41, -2], [40, -10], [36, -18], [35, -24], [32, -28], [27, -34], [20, -35], [18, -32], [15, -27], [12, -18], [13, -12], [9, -2], [9, 4], [5, 6], [-2, 5], [-8, 4], [-13, 8], [-17, 14]],
  // Madagascar
  [[44, -25], [47, -25], [50, -15], [49, -12], [44, -17]],
  // Asia (Middle East to the Pacific)
  [[26, 40], [30, 41], [36, 41], [42, 42], [41, 37], [36, 36], [35, 33], [34, 28], [39, 22], [43, 13], [45, 13], [52, 16], [57, 19], [59, 22], [56, 26], [51, 24], [50, 26], [48, 30], [50, 30], [56, 27], [62, 25], [67, 24], [70, 21], [73, 16], [77, 8], [80, 13], [80, 16], [87, 21], [91, 22], [94, 18], [98, 16], [98, 8], [101, 3], [104, 1], [103, 5], [101, 7], [100, 13], [105, 9], [109, 12], [108, 17], [106, 20], [110, 21], [117, 23], [120, 27], [122, 31], [120, 35], [122, 37], [118, 38], [121, 40], [126, 39], [129, 35], [129, 42], [135, 43], [140, 48], [141, 53], [137, 54], [142, 59], [150, 59], [156, 61], [163, 60], [170, 66], [180, 68], [180, 72], [140, 73], [113, 74], [100, 78], [80, 74], [68, 70], [60, 70], [50, 68], [44, 66], [40, 68], [40, 57], [38, 52], [40, 48], [38, 47], [34, 45], [30, 45], [29, 41]],
  // Arabian peninsula fill (the Gulf coast)
  [[36, 29], [39, 22], [43, 13], [45, 13], [52, 16], [57, 19], [59, 22], [56, 26], [51, 24], [50, 26], [48, 30], [44, 30], [39, 31]],
  // Japan
  [[130, 31], [132, 34], [135, 34], [137, 35], [140, 35.5], [141, 38], [142, 41], [140, 41], [139, 38], [136, 37], [133, 36], [130, 34]],
  [[140, 42], [145, 43], [145, 45], [142, 45.5], [140, 43.5]],
  // South-east Asian islands
  [[95, 5], [103, -3], [106, -6], [104, -6], [100, -1], [95, 3]],
  [[105, -7], [115, -8], [115, -9], [105, -8]],
  [[109, 1], [113, 4], [117, 7], [119, 4], [117, -1], [114, -3], [110, -2]],
  [[119, 0], [125, 1], [122, -5], [120, -5]],
  [[131, -1], [141, -3], [150, -6], [147, -9], [141, -9], [137, -5]],
  [[120, 18], [122, 18], [124, 12], [126, 7], [122, 7], [120, 14]],
  // Australia
  [[114, -22], [114, -26], [115, -34], [118, -35], [124, -34], [129, -32], [135, -34], [138, -35], [140, -38], [146, -39], [150, -37], [153, -32], [153, -25], [146, -19], [145, -15], [142, -11], [141, -17], [136, -12], [131, -11], [126, -14], [122, -18]],
  [[145, -41], [148, -41], [148, -43], [146, -43.5]],
  // New Zealand
  [[172, -34], [175, -37], [178, -38], [175, -41], [173, -41], [174, -39]],
  [[172, -41], [174, -42], [171, -45], [167, -46], [169, -44]],
];

/** the land as one SVG path in map units */
export function landPath(): string {
  let d = '';
  for (const poly of LAND) {
    poly.forEach(([lon, lat], i) => {
      const [x, y] = project(lat, lon);
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    d += 'Z';
  }
  return d;
}

// ------------------------------------------------------------------ climate
type W = Exclude<WeatherChoice, 'random'>;
type T = Exclude<TimeChoice, 'random'>;
interface Climate {
  weather: [W, number][];
  time: [T, number][];
}
/** what each round's weekend tends to look like (weights) */
const CLIMATE: Record<string, Climate> = {
  monza: { weather: [['clear', 4], ['haze', 2], ['cloudy', 2], ['changeable', 1], ['rain', 1]], time: [['afternoon', 3], ['golden', 2], ['midday', 1], ['morning', 1]] },
  spa: { weather: [['cloudy', 2], ['overcast', 2], ['changeable', 3], ['drizzle', 2], ['rain', 2], ['mist', 1], ['clear', 1]], time: [['afternoon', 3], ['morning', 1], ['golden', 1]] },
  silverstone: { weather: [['cloudy', 3], ['overcast', 2], ['windy', 2], ['changeable', 2], ['drizzle', 1], ['clear', 2]], time: [['afternoon', 3], ['midday', 1], ['golden', 1]] },
  suzuka: { weather: [['clear', 2], ['cloudy', 2], ['changeable', 2], ['rain', 1], ['sunshower', 1]], time: [['afternoon', 2], ['golden', 2], ['sunset', 1]] },
  interlagos: { weather: [['changeable', 3], ['storm', 1], ['thunderstorm', 1], ['rain', 1], ['cloudy', 2], ['clear', 1]], time: [['afternoon', 3], ['golden', 1]] },
  spielberg: { weather: [['clear', 3], ['cloudy', 2], ['changeable', 2], ['thunderstorm', 1]], time: [['afternoon', 3], ['golden', 1], ['morning', 1]] },
  zandvoort: { weather: [['windy', 3], ['cloudy', 2], ['clear', 2], ['changeable', 1], ['drizzle', 1]], time: [['afternoon', 3], ['golden', 1]] },
  austin: { weather: [['clear', 4], ['haze', 1], ['windy', 1], ['cloudy', 1]], time: [['afternoon', 2], ['golden', 2], ['sunset', 2]] },
  montreal: { weather: [['clear', 2], ['cloudy', 2], ['changeable', 2], ['rain', 1], ['sunshower', 1]], time: [['afternoon', 3], ['golden', 1]] },
  melbourne: { weather: [['clear', 3], ['windy', 1], ['cloudy', 2], ['changeable', 1]], time: [['afternoon', 2], ['golden', 1], ['sunset', 1]] },
  sakhir: { weather: [['clear', 3], ['haze', 2]], time: [['dusk', 1], ['night', 4], ['sunset', 1]] },
  yasmarina: { weather: [['clear', 3], ['haze', 2]], time: [['sunset', 2], ['dusk', 2], ['night', 2]] },
  mexico: { weather: [['clear', 2], ['haze', 3], ['cloudy', 1]], time: [['afternoon', 3], ['midday', 1], ['golden', 1]] },
  hungaroring: { weather: [['clear', 4], ['haze', 2], ['thunderstorm', 1]], time: [['afternoon', 3], ['midday', 1], ['golden', 1]] },
};
const FALLBACK: Climate = { weather: [['clear', 3], ['cloudy', 2], ['changeable', 1]], time: [['afternoon', 2], ['golden', 1]] };

export interface Forecast {
  weather: W;
  time: T;
}

function pick<K>(list: [K, number][], r: number): K {
  const total = list.reduce((a, b) => a + b[1], 0);
  let x = r * total;
  for (const [k, w] of list) if ((x -= w) <= 0) return k;
  return list[list.length - 1][0];
}

/** a weekend's weather and light at this circuit, from its climate; `avoid` = the last one there (roll something else) */
export function rollForecast(circuit: string, avoid?: Forecast | null): Forecast {
  const c = CLIMATE[circuit] ?? FALLBACK;
  let f: Forecast = { weather: pick(c.weather, Math.random()), time: pick(c.time, Math.random()) };
  for (let i = 0; i < 6 && avoid && f.weather === avoid.weather && f.time === avoid.time; i++) f = { weather: pick(c.weather, Math.random()), time: pick(c.time, Math.random()) };
  return f;
}

/** a career round's distance when there's no driver career to say otherwise (the driver career's own: DriverCareer.laps) */
export const CAREER_LAPS = 5;
