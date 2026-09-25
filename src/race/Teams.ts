/**
 * The grid: the eleven 2026 teams (real names and colours, no logos), two invented drivers each.
 * Colours are sRGB hex. `pace` scales AI speed (1 = the best car).
 */

export type LiveryPattern =
  | 'sweep' | 'split' | 'fade' | 'stripe' | 'block' | 'arrow'
  | 'ferrari' | 'mercedes' | 'redbull' | 'mclaren' | 'aston' | 'alpine' | 'williams' | 'haas' | 'racingbulls' | 'audi' | 'cadillac';

export interface Team {
  id: string;
  name: string;
  short: string;
  primary: string;
  secondary: string;
  accent: string;
  /** colour for numbers/logos on the primary colour */
  ink: string;
  pattern: LiveryPattern;
  /** carbon left bare on the car (0 = fully painted, 1 = lots of exposed carbon) */
  carbon: number;
  /** paint finish: 0 gloss … 1 matte */
  matte: number;
  sponsor: string;
  pace: number;
  drivers: [Driver, Driver];
}

export interface Driver {
  first: string;
  last: string;
  code: string;
  number: number;
  /** helmet colours */
  helmet: [string, string];
  /** AI racecraft 0.9–1.0 */
  skill: number;
  aggression: number;
}

export const TEAMS: Team[] = [
  {
    id: 'rossa', name: 'Scuderia Ferrari', short: 'FERRARI',
    primary: '#dc0000', secondary: '#141414', accent: '#ffffff', ink: '#ffffff',
    pattern: 'ferrari', carbon: 0.25, matte: 0.0, sponsor: 'VELOCE', pace: 0.992,
    drivers: [
      { first: 'Luca', last: 'Moretti', code: 'MOR', number: 16, helmet: ['#c8102e', '#ffd400'], skill: 0.985, aggression: 0.6 },
      { first: 'Sebastián', last: 'Ruiz', code: 'RUI', number: 55, helmet: ['#1f4fd1', '#ffffff'], skill: 0.975, aggression: 0.5 },
    ],
  },
  {
    id: 'stellar', name: 'Mercedes', short: 'MERCEDES',
    primary: '#c4c8cc', secondary: '#0d0f12', accent: '#00d7b6', ink: '#0d0f12',
    pattern: 'mercedes', carbon: 0.45, matte: 0.1, sponsor: 'QUANTA', pace: 0.99,
    drivers: [
      { first: 'Erik', last: 'Hansen', code: 'HAN', number: 44, helmet: ['#8a2be2', '#ffd400'], skill: 0.99, aggression: 0.55 },
      { first: 'Tobi', last: 'Okafor', code: 'OKA', number: 63, helmet: ['#00d2be', '#111111'], skill: 0.97, aggression: 0.45 },
    ],
  },
  {
    id: 'taurus', name: 'Red Bull Racing', short: 'RED BULL',
    primary: '#1e2856', secondary: '#e3001b', accent: '#ffc906', ink: '#ffffff',
    pattern: 'redbull', carbon: 0.2, matte: 0.85, sponsor: 'KRAFT ENERGY', pace: 1.0,
    drivers: [
      { first: 'Max', last: 'Vogel', code: 'VOG', number: 1, helmet: ['#1b2552', '#ff6a00'], skill: 1.0, aggression: 0.8 },
      { first: 'Diego', last: 'Pérez', code: 'PER', number: 11, helmet: ['#ffffff', '#1b2552'], skill: 0.955, aggression: 0.5 },
    ],
  },
  {
    id: 'solis', name: 'McLaren', short: 'MCLAREN',
    primary: '#ff8000', secondary: '#141414', accent: '#ffffff', ink: '#141414',
    pattern: 'mclaren', carbon: 0.3, matte: 0.2, sponsor: 'ORBIT', pace: 0.998,
    drivers: [
      { first: 'Lando', last: 'Nolan', code: 'NOL', number: 4, helmet: ['#d4ff00', '#101216'], skill: 0.99, aggression: 0.6 },
      { first: 'Oscar', last: 'Pierce', code: 'PIE', number: 81, helmet: ['#ff7a00', '#ffffff'], skill: 0.988, aggression: 0.5 },
    ],
  },
  {
    id: 'verdant', name: 'Aston Martin', short: 'ASTON MARTIN',
    primary: '#00594f', secondary: '#0b1411', accent: '#cedc00', ink: '#cedc00',
    pattern: 'aston', carbon: 0.35, matte: 0.6, sponsor: 'ARBOR', pace: 0.975,
    drivers: [
      { first: 'Fernando', last: 'Alves', code: 'ALV', number: 14, helmet: ['#00574b', '#ffe600'], skill: 0.975, aggression: 0.7 },
      { first: 'Kit', last: 'Strand', code: 'STR', number: 18, helmet: ['#ffffff', '#00574b'], skill: 0.95, aggression: 0.4 },
    ],
  },
  {
    id: 'azure', name: 'Alpine', short: 'ALPINE',
    primary: '#0078c1', secondary: '#fd4bc7', accent: '#ffffff', ink: '#ffffff',
    pattern: 'alpine', carbon: 0.3, matte: 0.1, sponsor: 'CIELO', pace: 0.965,
    drivers: [
      { first: 'Pierre', last: 'Garnier', code: 'GAR', number: 10, helmet: ['#0a5cc2', '#ffffff'], skill: 0.965, aggression: 0.55 },
      { first: 'Jack', last: 'Doherty', code: 'DOH', number: 7, helmet: ['#ff4fa3', '#0a5cc2'], skill: 0.955, aggression: 0.6 },
    ],
  },
  {
    id: 'kestrel', name: 'Williams', short: 'WILLIAMS',
    primary: '#041e42', secondary: '#1a8fe0', accent: '#ffffff', ink: '#ffffff',
    pattern: 'williams', carbon: 0.35, matte: 0.3, sponsor: 'NORTHWIND', pace: 0.97,
    drivers: [
      { first: 'Alex', last: 'Albers', code: 'ALB', number: 23, helmet: ['#00a3e0', '#061a40'], skill: 0.97, aggression: 0.45 },
      { first: 'Carlos', last: 'Serra', code: 'SER', number: 12, helmet: ['#e10600', '#ffd400'], skill: 0.975, aggression: 0.55 },
    ],
  },
  {
    id: 'forge', name: 'Haas F1 Team', short: 'HAAS',
    primary: '#f4f4f4', secondary: '#141414', accent: '#e6002b', ink: '#141414',
    pattern: 'haas', carbon: 0.5, matte: 0.4, sponsor: 'IRONCLAD', pace: 0.955,
    drivers: [
      { first: 'Nico', last: 'Hartmann', code: 'HAR', number: 27, helmet: ['#f2f2f2', '#d40f1c'], skill: 0.955, aggression: 0.65 },
      { first: 'Oliver', last: 'Bearing', code: 'BEA', number: 87, helmet: ['#141414', '#f2f2f2'], skill: 0.955, aggression: 0.6 },
    ],
  },
  {
    id: 'nova', name: 'Racing Bulls', short: 'RACING BULLS',
    primary: '#f7f8fb', secondary: '#1534cc', accent: '#ff1e3c', ink: '#1534cc',
    pattern: 'racingbulls', carbon: 0.25, matte: 0.1, sponsor: 'PULSAR', pace: 0.96,
    drivers: [
      { first: 'Kenji', last: 'Tanaka', code: 'TAN', number: 22, helmet: ['#ffffff', '#ff1e3c'], skill: 0.96, aggression: 0.7 },
      { first: 'Liam', last: 'Lawton', code: 'LAW', number: 30, helmet: ['#1434cb', '#ffffff'], skill: 0.955, aggression: 0.75 },
    ],
  },
  {
    id: 'vektor', name: 'Audi', short: 'AUDI',
    primary: '#a4a8ad', secondary: '#0a0a0a', accent: '#f50537', ink: '#0a0a0a',
    pattern: 'audi', carbon: 0.55, matte: 0.7, sponsor: 'AXIOM', pace: 0.95,
    drivers: [
      { first: 'Gabriel', last: 'Borges', code: 'BOR', number: 5, helmet: ['#ffe600', '#0a8f3c'], skill: 0.955, aggression: 0.55 },
      { first: 'Nils', last: 'Hulme', code: 'HUL', number: 9, helmet: ['#ffffff', '#0a0a0a'], skill: 0.96, aggression: 0.5 },
    ],
  },
  {
    id: 'cadillac', name: 'Cadillac', short: 'CADILLAC',
    primary: '#111214', secondary: '#e9eaec', accent: '#b8975a', ink: '#e9eaec',
    pattern: 'cadillac', carbon: 0.45, matte: 0.5, sponsor: 'MERIDIAN', pace: 0.945,
    drivers: [
      { first: 'Jordan', last: 'Pike', code: 'PIK', number: 38, helmet: ['#111214', '#e9eaec'], skill: 0.955, aggression: 0.55 },
      { first: 'Marco', last: 'Bellini', code: 'BEL', number: 19, helmet: ['#b8975a', '#111214'], skill: 0.95, aggression: 0.5 },
    ],
  },
];

export interface Entry {
  team: Team;
  driver: Driver;
  /** 0 = lead driver (black T-cam), 1 = second driver (yellow T-cam) */
  seat: 0 | 1;
}

export function allEntries(): Entry[] {
  const out: Entry[] = [];
  for (const team of TEAMS) {
    out.push({ team, driver: team.drivers[0], seat: 0 });
    out.push({ team, driver: team.drivers[1], seat: 1 });
  }
  return out;
}

/** a team colour that stays readable on the dark UI (very dark primaries fall back to the secondary) */
export function uiColor(team: Team): string {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const x = v / 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  if (lum(team.primary) > 0.05) return team.primary;
  return lum(team.secondary) > 0.05 ? team.secondary : team.accent;
}
