import { TEAMS, type Driver, type DriverLook, type Team } from '../race/Teams.ts';

/**
 * Which championship the grid is: Formula 1 (the eleven teams as shipped) or Formula 2 (the feeder
 * series a created driver starts in: eleven junior teams in generic liveries, near-equal cars, young
 * drivers). The grid is switched by rewriting the shared Team and Driver objects in place — every
 * Entry, rig and menu already holds references to them — and the player's own driver takes their
 * seat the same way. `F1_GRID` keeps the originals to restore.
 */

export type SeriesId = 'f1' | 'f2';

type TeamData = Omit<Team, 'drivers'>;
type DriverData = Driver;

const cloneDriver = (d: Driver): DriverData => ({ ...d, helmet: [d.helmet[0], d.helmet[1]], look: { ...d.look, face: d.look.face ? { ...d.look.face } : undefined } });
/** the F1 grid as shipped (deep copies) */
const F1_GRID: { team: TeamData; drivers: [DriverData, DriverData] }[] = TEAMS.map((t) => {
  const { drivers, ...team } = t;
  return { team: { ...team }, drivers: [cloneDriver(drivers[0]), cloneDriver(drivers[1])] };
});

export function f1Original(teamIndex: number) {
  return F1_GRID[teamIndex];
}

const look = (skin: number, hair: number, style: DriverLook['style'], extra: Partial<DriverLook> = {}): DriverLook => ({ skin, hair, style, ...extra });

const F2_DRIVERS: DriverData[] = f2Drivers();

/** the Formula 2 field: junior teams (fictional), generic liveries, a spec car (near-equal pace) */
const F2_TEAMS: { team: TeamData; drivers: [DriverData, DriverData] }[] = [
  ['f2-prema', 'Primo Racing', 'PRIMO', '#d6001c', '#111214', '#ffffff', 'split', 'ARGENTO', 0.997],
  ['f2-artgp', 'Arte Grand Prix', 'ARTE', '#101010', '#d4af37', '#ffffff', 'sweep', 'ORBIT', 0.996],
  ['f2-hitech', 'Hightek Pulse', 'HIGHTEK', '#e8e9eb', '#d20a2e', '#111214', 'arrow', 'PULSE', 0.995],
  ['f2-campos', 'Campello Racing', 'CAMPELLO', '#f4c300', '#0b2a5b', '#ffffff', 'block', 'SOLANO', 0.994],
  ['f2-mp', 'MV Motorsport', 'MV', '#ff6a00', '#14161a', '#ffffff', 'fade', 'NORDLICHT', 0.994],
  ['f2-dams', 'Dames Racing', 'DAMES', '#0a5cc2', '#ffffff', '#ffc400', 'stripe', 'LUMEN', 0.993],
  ['f2-rodin', 'Rodan Motorsport', 'RODAN', '#1b1d22', '#00d2be', '#ffffff', 'sweep', 'KIWI AIR', 0.992],
  ['f2-invicta', 'Invictus Racing', 'INVICTUS', '#b8975a', '#111214', '#ffffff', 'split', 'AURUM', 0.992],
  ['f2-trident', 'Tridente', 'TRIDENTE', '#0b1e3f', '#c0c4c8', '#ff2b3f', 'arrow', 'MARE', 0.991],
  ['f2-van', 'Van Amstel Racing', 'AMSTEL', '#00a3e0', '#111214', '#ffffff', 'block', 'POLDER', 0.99],
  ['f2-aix', 'Axis Racing', 'AXIS', '#6a1b9a', '#ff4fa3', '#ffffff', 'fade', 'NOVA', 0.99],
].map(([id, name, short, primary, secondary, accent, pattern, sponsor, pace], i) => ({
  team: { id, name, short, primary, secondary, accent, ink: '#ffffff', pattern, carbon: 0.3, matte: 0.2, sponsor, pace } as TeamData,
  drivers: F2_DRIVERS.slice(i * 2, i * 2 + 2) as [DriverData, DriverData],
}));

function f2Drivers(): DriverData[] {
  const d = (first: string, last: string, code: string, number: number, h: [string, string], l: DriverLook, skill: number, aggression: number): DriverData => ({ first, last, code, number, helmet: h, look: l, skill, aggression });
  return [
    d('Andrea', 'Kimani', 'KIM', 1, ['#d6001c', '#ffffff'], look(0x8a5a3c, 0x120e0c, 'curly'), 0.975, 0.55),
    d('Oliver', 'Bearden', 'BRD', 2, ['#111214', '#ffd400'], look(0xf2d2b8, 0x6b4c30, 'short'), 0.972, 0.6),
    d('Victor', 'Marten', 'MRT', 3, ['#d4af37', '#101010'], look(0xf0cbad, 0x3a2a1e, 'wavy'), 0.97, 0.5),
    d('Zane', 'Malloy', 'MLY', 4, ['#ffffff', '#0b2a5b'], look(0xe9c3a2, 0x241a14, 'short', { stubble: 0.2 }), 0.966, 0.55),
    d('Paul', 'Arend', 'ARE', 5, ['#d20a2e', '#e8e9eb'], look(0xf3d5bf, 0xa88452, 'short'), 0.968, 0.5),
    d('Luke', 'Brownlow', 'BRL', 6, ['#0a5cc2', '#ffffff'], look(0xf2d2b8, 0x5a3f28, 'buzz'), 0.962, 0.6),
    d('Gabriel', 'Bortolini', 'BRT', 7, ['#f4c300', '#00a651'], look(0xd9a883, 0x16110e, 'wavy'), 0.97, 0.5),
    d('Pepe', 'Martell', 'MTL', 8, ['#f4c300', '#d6001c'], look(0xe6bb96, 0x241a14, 'short'), 0.96, 0.65),
    d('Richard', 'Verschuren', 'VRS', 9, ['#ff6a00', '#14161a'], look(0xf0cdb0, 0x7a5a38, 'short', { stubble: 0.4 }), 0.958, 0.5),
    d('Kush', 'Mainey', 'MAI', 10, ['#ffffff', '#ff6a00'], look(0xb47a52, 0x120e0c, 'short'), 0.955, 0.55),
    d('Jak', 'Crawley', 'CRW', 11, ['#0a5cc2', '#d6001c'], look(0xf3d5bf, 0x8a6a48, 'short'), 0.963, 0.55),
    d('Arvid', 'Lindqvist', 'LDQ', 12, ['#ffc400', '#0a5cc2'], look(0xf4dccb, 0xc9a86c, 'short'), 0.957, 0.5),
    d('Dino', 'Begović', 'BEG', 14, ['#00d2be', '#1b1d22'], look(0xeec9ad, 0x2c2018, 'buzz'), 0.954, 0.6),
    d('Sami', 'Meguet', 'MEG', 15, ['#1b1d22', '#00d2be'], look(0xc99772, 0x14100d, 'curly'), 0.95, 0.55),
    d('Joshua', 'Dürr', 'DUR', 16, ['#b8975a', '#ffffff'], look(0xe9c3a2, 0x3a2a1e, 'short'), 0.958, 0.6),
    d('Roman', 'Stanik', 'STK', 17, ['#111214', '#b8975a'], look(0xf2d2b8, 0x5a3f28, 'short'), 0.95, 0.5),
    d('Max', 'Esterbrook', 'EST', 18, ['#c0c4c8', '#0b1e3f'], look(0xf0cbad, 0x6b4c30, 'wavy'), 0.948, 0.55),
    d('Leonardo', 'Fornari', 'FRN', 19, ['#0b1e3f', '#ff2b3f'], look(0xe6bb96, 0x241a14, 'short'), 0.962, 0.5),
    d('Rafael', 'Villalobos', 'VLL', 20, ['#00a3e0', '#ffffff'], look(0xd9a883, 0x16110e, 'short', { stubble: 0.3 }), 0.946, 0.55),
    d('Cian', 'Shiels', 'SHL', 21, ['#111214', '#00a3e0'], look(0xf4dccb, 0xb2552e, 'short'), 0.944, 0.5),
    d('Amaury', 'Cordier', 'CRD', 22, ['#6a1b9a', '#ffffff'], look(0xf2d2b8, 0x5a3f28, 'short'), 0.944, 0.6),
    d('Joshua', 'Mason', 'MSN', 23, ['#ff4fa3', '#6a1b9a'], look(0x9c6b4a, 0x120e0c, 'braids'), 0.942, 0.55),
  ];
}

/** the player's own driver, as the career stores it */
export interface PlayerDriver {
  first: string;
  last: string;
  code: string;
  number: number;
  nationality: string;
  helmet: [string, string];
  look: DriverLook;
  /** set when the career took over an existing F1 driver (their code) */
  from?: string;
}

let current: SeriesId = 'f1';
export function currentSeries(): SeriesId {
  return current;
}

/**
 * Rewrite the grid: `series`, with the player's driver (if any) in `teamIndex`/`seat`.
 * Returns true when anything visible (names, colours, helmets) changed.
 */
export function applyGrid(series: SeriesId, player: PlayerDriver | null, teamIndex: number, seat: 0 | 1): boolean {
  const src = series === 'f2' ? F2_TEAMS : F1_GRID;
  const before = JSON.stringify(TEAMS.map((t) => [t.id, t.drivers[0].code, t.drivers[1].code, t.drivers[0].helmet, t.drivers[1].helmet]));
  for (let i = 0; i < TEAMS.length; i++) {
    const s = src[i % src.length];
    Object.assign(TEAMS[i], s.team);
    for (const k of [0, 1] as const) Object.assign(TEAMS[i].drivers[k], cloneDriver(s.drivers[k]));
  }
  if (player?.from) {
    // a current F1 driver who moved: whoever they replaced takes the seat they left
    for (let i = 0; series === 'f1' && i < TEAMS.length; i++)
      for (const k of [0, 1] as const)
        if (TEAMS[i].drivers[k].code === player.from && !(i === teamIndex && k === seat)) Object.assign(TEAMS[i].drivers[k], cloneDriver(src[teamIndex].drivers[seat]));
  }
  if (player) {
    const d = TEAMS[teamIndex].drivers[seat];
    // a created driver races as well as the seat's best (the AI only drives this car in simulations)
    const skill = Math.max(d.skill, 0.975);
    Object.assign(d, { first: player.first, last: player.last, code: player.code, number: player.number, helmet: [player.helmet[0], player.helmet[1]], look: { ...player.look }, skill });
  }
  current = series;
  const after = JSON.stringify(TEAMS.map((t) => [t.id, t.drivers[0].code, t.drivers[1].code, t.drivers[0].helmet, t.drivers[1].helmet]));
  return before !== after;
}

/** junior teams' and F1 teams' rough level 0 (back) … 1 (front), from their pace */
export function teamLevel(t: Team): number {
  const paces = TEAMS.map((x) => x.pace).sort((a, b) => a - b);
  const i = paces.indexOf(t.pace);
  return paces.length > 1 ? i / (paces.length - 1) : 0.5;
}

/** the F1 team list as shipped (for offers while the grid shows F2) */
export function f1Teams(): TeamData[] {
  return F1_GRID.map((g) => g.team);
}
/** the F2 team list (for a created driver's first offers) */
export function f2Teams(): TeamData[] {
  return F2_TEAMS.map((g) => g.team);
}
