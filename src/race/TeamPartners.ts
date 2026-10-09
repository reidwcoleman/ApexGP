/**
 * Who pays for each car, and where they go on it — fictional partners, structured the way the real
 * teams sell their cars (docs/F1_LIVERIES.md):
 *
 *   title       the name in the team's own title (`Team.sponsor`): the sidepods, the rear wing
 *   principal   two big contracts: the engine cover (the side-on TV shot's biggest space) and the
 *               nose and rear wing's underside
 *   fuel        the fuel and lubricants partner: the front wing's flap and the engine cover's tail
 *   engine      the power unit's maker (a works team builds its own; the customers buy one)
 *   tech        eight technical and official partners, the small decals over the chassis flanks,
 *               sidepods and cover, each in its own brand colour (a white or black tile, or plain)
 *
 * Some partners are also the series' or a circuit's partners (the energy drink that owns two teams,
 * the energy company behind the green team, the home car maker building a power unit), as on the
 * real grid.
 */

export interface PartnerMark {
  name: string;
  /** the brand's colour (its word on a tile, or the ink when it reads on the paint) */
  color: string;
}

export interface TeamPartners {
  principal: [PartnerMark, PartnerMark];
  fuel: PartnerMark;
  engine: string;
  tech: PartnerMark[];
}

const m = (name: string, color: string): PartnerMark => ({ name, color });

export const TEAM_PARTNERS: Record<string, TeamPartners> = {
  // the red team: a computer maker's name in its title, a bank, an IT firm, the yellow-and-red fuel
  rossa: {
    principal: [m('UNIVERSA', '#c8102e'), m('ORBIS', '#0f62fe')],
    fuel: m('PETROLA', '#e8b100'),
    engine: 'ROSSA',
    tech: [m('SENTINEL', '#ed1c24'), m('LUXOR', '#111111'), m('PANTERA', '#111111'), m('HORLA', '#7a5c2e'), m('ALTEA', '#0057b8'), m('KAPPA ONE', '#e30613'), m('VIGIL', '#00a3e0'), m('RIVA', '#1d1d1b')],
  },
  // the silver team: the teal energy giant on the title, a software house, a chemicals group
  stellar: {
    principal: [m('NEXUS', '#00a4ef'), m('ADRIA', '#e2001a')],
    fuel: m('QUANTA FLUIDS', '#00a19c'),
    engine: 'STELLAR',
    tech: [m('CROWNE', '#00205b'), m('TELOS', '#5f259f'), m('ORIEL', '#111111'), m('MAREN', '#00843d'), m('BYTEWAVE', '#ff5f00'), m('SILEX', '#1d1d1b'), m('AUREUS', '#b8975a'), m('LYRA', '#0072ce')],
  },
  // the energy drink's own team: the drink, an exchange, a cloud database on the title
  taurus: {
    principal: [m('TAURO', '#db0a40'), m('BYBLOCK', '#f7a600')],
    fuel: m('AXION', '#0047bb'),
    engine: 'FORTIS',
    tech: [m('TALLIS', '#111111'), m('HYPERIA', '#e31837'), m('PULSE', '#ffcc00'), m('VERTA', '#00205b'), m('MOBIRA', '#ff6a00'), m('GRIDCORE', '#111111'), m('SOLUNA', '#00a3ad'), m('KESTON', '#e2001a')],
  },
  // papaya: a card network, a search giant, a spirits house, the old fuel brand in blue and orange
  solis: {
    principal: [m('PAYLINE', '#eb001b'), m('SEARCHLY', '#4285f4')],
    fuel: m('BAYOIL', '#003a70'),
    engine: 'STELLAR',
    tech: [m('ALLURA', '#111111'), m('DALLWAY', '#007db8'), m('JOHNSON & REID', '#111111'), m('OKTANE', '#00a3e0'), m('CLEARSKY', '#ff8000'), m('TEMPO', '#e4002b'), m('FIBRA', '#5f259f'), m('ARIA', '#111111')],
  },
  // British racing green: the energy company (also the series' partner), a cloud CRM
  verdant: {
    principal: [m('PETRANOVA', '#00843d'), m('COGNIS', '#00a1e0')],
    fuel: m('PETRANOVA', '#00843d'),
    engine: 'HAYATE',
    tech: [m('GLENROCK', '#111111'), m('CRYSTA', '#0050b5'), m('PROWL', '#111111'), m('NOVO', '#cedc00'), m('EPOCH', '#e2231a'), m('MAVEN', '#111111'), m('SKYLINE', '#00a3e0'), m('PEAK', '#00594f')],
  },
  // blue and pink: the water technology firm's pink, a marketplace, a printer maker
  azure: {
    principal: [m('AQUATEC', '#ec008c'), m('MERCADO', '#ffe600')],
    fuel: m('VERDA OIL', '#00a650'),
    engine: 'STELLAR',
    tech: [m('ZENKO', '#e4002b'), m('ATLAS FORGE', '#111111'), m('KINETIQ', '#0072ce'), m('NOMAD', '#111111'), m('BELLAIR', '#00a3e0'), m('PRISMA', '#ec008c'), m('ROVA', '#111111'), m('SUNLINE', '#ff8200')],
  },
  // navy and sky: the collaboration software on the title, an excavator maker, batteries
  kestrel: {
    principal: [m('KOMORI', '#003da5'), m('VOLTCELL', '#c47a00')],
    fuel: m('COASTAL', '#ff6600'),
    engine: 'STELLAR',
    tech: [m('BRADLEY', '#00aeef'), m('VELOX', '#111111'), m('ANCHOR', '#e4002b'), m('MOTIVE', '#00205b'), m('KRYO', '#00a3e0'), m('GRAFT', '#111111'), m('STONEHILL', '#7a5c2e'), m('BRIGHTPATH', '#ffcc00')],
  },
  // white and red: a carmaker's racing arm on the title, a money-transfer firm
  forge: {
    principal: [m('MONEYLINE', '#da291c'), m('TOMOE RACING', '#eb0a1e')],
    fuel: m('VALCO', '#00205b'),
    engine: 'ROSSA',
    tech: [m('HALVERN', '#e4002b'), m('MAXWELL', '#111111'), m('RAPTOR', '#111111'), m('HYTEK', '#0072ce'), m('OPENFIELD', '#00843d'), m('VENTURA', '#111111'), m('SAXON', '#e2001a'), m('KITE', '#00a3e0')],
  },
  // the second team of the energy drink's: a payments app on the title
  nova: {
    principal: [m('CASHLY', '#1a1f71'), m('TAURO', '#db0a40')],
    fuel: m('AXION', '#0047bb'),
    engine: 'FORTIS',
    tech: [m('WESTON', '#111111'), m('ORANGEBYTE', '#ff6a00'), m('PIXELL', '#1534cc'), m('FIZZ', '#e4002b'), m('ROAM', '#00a3e0'), m('LUMA', '#111111'), m('SPRINT', '#ffcc00'), m('VERSO', '#5f259f')],
  },
  // the German works team: a neobank on the title, a sportswear giant, the green fuel
  vektor: {
    principal: [m('REVELA', '#0666eb'), m('STRIDE', '#111111')],
    fuel: m('VERDA OIL', '#00a650'),
    engine: 'VEKTOR',
    tech: [m('NEXOR', '#f50537'), m('HALDEN', '#111111'), m('SIGMA', '#0072ce'), m('ALPENBLAU', '#00205b'), m('KRONE', '#e4002b'), m('OPTIKA', '#111111'), m('MAGNOR', '#c9cdd2'), m('TERRA', '#00843d')],
  },
  // the American newcomer: a tech firm on the title, a fashion house, an airline
  cadillac: {
    principal: [m('HARLOW', '#00205b'), m('CORE', '#b8975a')],
    fuel: m('PETROLA', '#e8b100'),
    engine: 'ROSSA',
    tech: [m('SKYREACH', '#0064ff'), m('LIBERTY AIR', '#00205b'), m('TITAN', '#111111'), m('RYDER', '#e4002b'), m('GREYSTONE', '#5b6770'), m('FALCO', '#111111'), m('NORTHSTAR', '#b8975a'), m('UNION', '#c8102e')],
  },
};

/** a team's partners (a fallback built from its name for a team without its own list) */
export function partnersOf(id: string): TeamPartners {
  return TEAM_PARTNERS[id] ?? TEAM_PARTNERS.rossa;
}
