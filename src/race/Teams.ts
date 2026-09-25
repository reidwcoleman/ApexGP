/**
 * The grid: the eleven 2026 teams (real names and colours, no logos), two drivers each —
 * sound-alike names on the real 2026 seats and numbers (not the real people).
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
  /** metal-flake paint 0..1 (default: automatic for silvers) */
  metallic?: number;
  sponsor: string;
  pace: number;
  drivers: [Driver, Driver];
}

export interface DriverLook {
  skin: number;
  hair: number;
  style: 'short' | 'buzz' | 'wavy' | 'curly' | 'braids' | 'long';
  beard?: boolean;
  stubble?: number;
  face?: { width?: number; jaw?: number; nose?: number; length?: number };
}

export interface Driver {
  first: string;
  last: string;
  code: string;
  number: number;
  /** helmet colours */
  helmet: [string, string];
  /** what they look like out of the car (podium): skin, hair colour and style, beard, face shape */
  look: DriverLook;
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
      { first: 'Carlo', last: 'Leclair', code: 'LCL', number: 16, helmet: ['#c8102e', '#ffd400'], look: { skin: 0xf0cdb0, hair: 0x3a2a1e, style: 'wavy', stubble: 0.15, face: { width: 0.97, length: 1.04 } }, skill: 0.985, aggression: 0.6 },
      { first: 'Lewis', last: 'Hamford', code: 'HMF', number: 44, helmet: ['#1f4fd1', '#ffffff'], look: { skin: 0x9c6b4a, hair: 0x16110e, style: 'braids', beard: true, face: { width: 1.0, jaw: 1.05 } }, skill: 0.975, aggression: 0.5 },
    ],
  },
  {
    id: 'stellar', name: 'Mercedes', short: 'MERCEDES',
    primary: '#c4c8cc', secondary: '#0d0f12', accent: '#00d7b6', ink: '#0d0f12',
    pattern: 'mercedes', carbon: 0.45, matte: 0.1, sponsor: 'QUANTA', pace: 0.99,
    drivers: [
      { first: 'George', last: 'Rushworth', code: 'RSW', number: 63, helmet: ['#8a2be2', '#ffd400'], look: { skin: 0xf2d2b8, hair: 0x5a3f28, style: 'short', face: { width: 0.96, length: 1.06, nose: 1.05 } }, skill: 0.99, aggression: 0.55 },
      { first: 'Kimi', last: 'Antonetti', code: 'ATN', number: 12, helmet: ['#00d2be', '#111111'], look: { skin: 0xe9c3a2, hair: 0x241a14, style: 'short', face: { width: 0.97, jaw: 1.05 } }, skill: 0.97, aggression: 0.45 },
    ],
  },
  {
    id: 'taurus', name: 'Red Bull Racing', short: 'RED BULL',
    primary: '#1e2856', secondary: '#e3001b', accent: '#ffc906', ink: '#ffffff',
    pattern: 'redbull', carbon: 0.2, matte: 0.85, sponsor: 'KRAFT ENERGY', pace: 1.0,
    drivers: [
      { first: 'Max', last: 'Verhoeven', code: 'VHN', number: 1, helmet: ['#1b2552', '#ff6a00'], look: { skin: 0xf0cbad, hair: 0x6b4c30, style: 'short', stubble: 0.35, face: { width: 1.02, jaw: 1.08 } }, skill: 1.0, aggression: 0.8 },
      { first: 'Isaac', last: 'Hadari', code: 'HDR', number: 6, helmet: ['#ffffff', '#1b2552'], look: { skin: 0xc99772, hair: 0x14100d, style: 'curly', stubble: 0.2, face: { width: 0.98 } }, skill: 0.955, aggression: 0.5 },
    ],
  },
  {
    id: 'solis', name: 'McLaren', short: 'MCLAREN',
    primary: '#ff8000', secondary: '#141414', accent: '#ffffff', ink: '#141414',
    pattern: 'mclaren', carbon: 0.3, matte: 0.2, sponsor: 'ORBIT', pace: 0.998,
    drivers: [
      { first: 'Lando', last: 'Morris', code: 'MRS', number: 4, helmet: ['#d4ff00', '#101216'], look: { skin: 0xf2cfb4, hair: 0x5c4028, style: 'wavy', stubble: 0.1, face: { width: 1.0, nose: 0.95 } }, skill: 0.99, aggression: 0.6 },
      { first: 'Oscar', last: 'Piastro', code: 'PST', number: 81, helmet: ['#ff7a00', '#ffffff'], look: { skin: 0xf0cdb2, hair: 0x2e2118, style: 'short', face: { width: 0.95, length: 1.05 } }, skill: 0.988, aggression: 0.5 },
    ],
  },
  {
    id: 'verdant', name: 'Aston Martin', short: 'ASTON MARTIN',
    primary: '#00594f', secondary: '#0b1411', accent: '#cedc00', ink: '#cedc00',
    pattern: 'aston', carbon: 0.35, matte: 0.6, sponsor: 'ARBOR', pace: 0.975,
    drivers: [
      { first: 'Fernando', last: 'Alvero', code: 'AVR', number: 14, helmet: ['#00574b', '#ffe600'], look: { skin: 0xd9aa84, hair: 0x1c1512, style: 'short', stubble: 0.55, face: { width: 1.0, nose: 1.12, length: 1.05 } }, skill: 0.975, aggression: 0.7 },
      { first: 'Lance', last: 'Stroud', code: 'STD', number: 18, helmet: ['#ffffff', '#00574b'], look: { skin: 0xf1d0b6, hair: 0x2a1e17, style: 'short', face: { width: 1.0, jaw: 1.06 } }, skill: 0.95, aggression: 0.4 },
    ],
  },
  {
    id: 'azure', name: 'Alpine', short: 'ALPINE',
    primary: '#0078c1', secondary: '#fd4bc7', accent: '#ffffff', ink: '#ffffff',
    pattern: 'alpine', carbon: 0.3, matte: 0.1, sponsor: 'CIELO', pace: 0.965,
    drivers: [
      { first: 'Pierre', last: 'Gaslin', code: 'GSN', number: 10, helmet: ['#0a5cc2', '#ffffff'], look: { skin: 0xeccaaa, hair: 0x1e1612, style: 'short', stubble: 0.4, face: { width: 0.98, nose: 1.05 } }, skill: 0.965, aggression: 0.55 },
      { first: 'Franco', last: 'Colapietro', code: 'CPT', number: 43, helmet: ['#ff4fa3', '#0a5cc2'], look: { skin: 0xe2b996, hair: 0x2a1c14, style: 'wavy', face: { width: 0.97 } }, skill: 0.955, aggression: 0.6 },
    ],
  },
  {
    id: 'kestrel', name: 'Williams', short: 'WILLIAMS',
    primary: '#041e42', secondary: '#1a8fe0', accent: '#ffffff', ink: '#ffffff',
    pattern: 'williams', carbon: 0.35, matte: 0.3, sponsor: 'NORTHWIND', pace: 0.97,
    drivers: [
      { first: 'Alex', last: 'Albury', code: 'ABY', number: 23, helmet: ['#00a3e0', '#061a40'], look: { skin: 0xd8ae88, hair: 0x100c0a, style: 'short', face: { width: 1.03, nose: 0.95 } }, skill: 0.97, aggression: 0.45 },
      { first: 'Carlos', last: 'Sainte', code: 'SNE', number: 55, helmet: ['#e10600', '#ffd400'], look: { skin: 0xdcb08c, hair: 0x1a130f, style: 'short', stubble: 0.3, face: { width: 0.97, length: 1.06, nose: 1.08 } }, skill: 0.975, aggression: 0.55 },
    ],
  },
  {
    id: 'forge', name: 'Haas F1 Team', short: 'HAAS',
    primary: '#f4f4f4', secondary: '#141414', accent: '#e6002b', ink: '#141414',
    pattern: 'haas', carbon: 0.5, matte: 0.4, sponsor: 'IRONCLAD', pace: 0.955,
    drivers: [
      { first: 'Esteban', last: 'Ocampo', code: 'OCP', number: 31, helmet: ['#f2f2f2', '#d40f1c'], look: { skin: 0xefcaad, hair: 0x2a1d15, style: 'buzz', face: { width: 0.95, length: 1.08 } }, skill: 0.955, aggression: 0.65 },
      { first: 'Ollie', last: 'Bearing', code: 'BRG', number: 87, helmet: ['#141414', '#f2f2f2'], look: { skin: 0xf3d4bb, hair: 0x7a5534, style: 'wavy', face: { width: 1.0 } }, skill: 0.955, aggression: 0.6 },
    ],
  },
  {
    id: 'nova', name: 'Racing Bulls', short: 'RACING BULLS',
    primary: '#f7f8fb', secondary: '#1534cc', accent: '#ff1e3c', ink: '#1534cc',
    pattern: 'racingbulls', carbon: 0.25, matte: 0.1, sponsor: 'PULSAR', pace: 0.96,
    drivers: [
      { first: 'Liam', last: 'Lawton', code: 'LWT', number: 30, helmet: ['#ffffff', '#ff1e3c'], look: { skin: 0xefcbae, hair: 0x4a3322, style: 'short', stubble: 0.2, face: { width: 1.0 } }, skill: 0.96, aggression: 0.7 },
      { first: 'Arvid', last: 'Lindqvist', code: 'LDQ', number: 41, helmet: ['#1434cb', '#ffffff'], look: { skin: 0xf4d6be, hair: 0xc9a468, style: 'wavy', face: { width: 0.96, length: 1.05 } }, skill: 0.955, aggression: 0.75 },
    ],
  },
  {
    id: 'vektor', name: 'Audi', short: 'AUDI',
    primary: '#a4a8ad', secondary: '#0a0a0a', accent: '#f50537', ink: '#0a0a0a',
    pattern: 'audi', carbon: 0.55, matte: 0.7, sponsor: 'AXIOM', pace: 0.95,
    drivers: [
      { first: 'Gabriel', last: 'Bortello', code: 'BTL', number: 5, helmet: ['#ffe600', '#0a8f3c'], look: { skin: 0xdcb08e, hair: 0x2a1c13, style: 'wavy', face: { width: 0.97 } }, skill: 0.955, aggression: 0.55 },
      { first: 'Nico', last: 'Hulkenburg', code: 'HLB', number: 27, helmet: ['#ffffff', '#0a0a0a'], look: { skin: 0xf0cfb6, hair: 0xb9955c, style: 'short', stubble: 0.35, face: { width: 1.0, length: 1.06 } }, skill: 0.96, aggression: 0.5 },
    ],
  },
  {
    id: 'cadillac', name: 'Cadillac', short: 'CADILLAC',
    primary: '#111214', secondary: '#e9eaec', accent: '#b8975a', ink: '#e9eaec',
    pattern: 'cadillac', carbon: 0.45, matte: 0.5, sponsor: 'MERIDIAN', pace: 0.945,
    drivers: [
      { first: 'Sergio', last: 'Peralta', code: 'PRT', number: 11, helmet: ['#111214', '#e9eaec'], look: { skin: 0xc79871, hair: 0x120e0c, style: 'short', stubble: 0.45, face: { width: 1.05, jaw: 1.05 } }, skill: 0.955, aggression: 0.55 },
      { first: 'Valtteri', last: 'Botta', code: 'BTA', number: 77, helmet: ['#b8975a', '#111214'], look: { skin: 0xf3d5bf, hair: 0xa88452, style: 'short', beard: true, face: { width: 0.97, length: 1.05 } }, skill: 0.95, aggression: 0.5 },
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
