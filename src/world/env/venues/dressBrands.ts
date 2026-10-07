import type { Brand } from '../../brands.ts';

/**
 * The brands on the venue dressing (dressKit.ts): all fictional, each in the colour block of the
 * kind of board that really fills that spot on the broadcast — the green-and-gold watch board at
 * the line, the yellow express-freight board, the green lager board, the yellow-and-black tyre
 * board, the navy cruise line, the burgundy airline, the energy drink's navy and silver — plus
 * the hosts' own (a Québec cooperative bank, a Styrian tourism board, a Dutch bank in orange, a
 * Texas truck maker, a Paulista bank). Names, marks and taglines are made up; only the colour
 * blocks and the rhythm echo the real boards.
 */

export const DB: Record<string, Brand> = {
  // ---- the series' global partners (every venue)
  watch: { name: 'VALCOURT', tag: 'HORLOGER · GENÈVE', bg: '#00573a', fg: '#f4efe2', accent: '#c9a45c', mark: 'none', weight: 300, track: 0.26 },
  freight: { name: 'SWIFTLINE', tag: 'EXPRESS', bg: '#ffcc00', fg: '#d40511', accent: '#d40511', mark: 'bars', weight: 900, italic: true, sx: 1.14 },
  lager: { name: 'BRANDT', tag: 'PREMIUM LAGER · 0.0', bg: '#0b5a32', fg: '#ffffff', accent: '#e4002b', mark: 'dot', weight: 900, track: 0.04 },
  tyres: { name: 'VALLARDI', tag: 'P-SERIES', bg: '#fcd000', fg: '#111111', accent: '#e30613', mark: 'none', weight: 900, italic: true, sx: 1.3 },
  tyresDark: { name: 'VALLARDI', tag: 'P-SERIES', bg: '#121212', fg: '#fcd000', accent: '#e30613', mark: 'none', weight: 900, italic: true, sx: 1.3 },
  cruise: { name: 'MERIDIA', tag: 'CRUISES', bg: '#0a2240', fg: '#e6c27a', accent: '#e6c27a', mark: 'wave', weight: 600, track: 0.18 },
  airline: { name: 'CORVINA AIR', tag: 'GOING PLACES TOGETHER', bg: '#5c0632', fg: '#ffffff', accent: '#c7a26b', mark: 'wing', weight: 600, track: 0.06 },
  crypto: { name: 'NOVACHAIN', tag: 'DIGITAL ASSETS', bg: '#0b1a33', fg: '#ffffff', accent: '#7fb2ff', mark: 'shield', weight: 700, track: 0.08 },
  cloud: { name: 'stratus', tag: 'CLOUD SERVICES', bg: '#232f3e', fg: '#ffffff', accent: '#ff9900', mark: 'wave', weight: 700, lower: true },
  laptop: { name: 'Tessara', tag: 'SMARTER TECH', bg: '#e2231a', fg: '#ffffff', accent: '#ffffff', mark: 'none', weight: 600, lower: true, track: 0.02 },
  energy: { name: 'PETRANOVA', tag: 'ENERGY', bg: '#ffffff', fg: '#00843d', accent: '#00a3e0', mark: 'wave', weight: 700, track: 0.06 },
  crm: { name: 'CUMULO', tag: 'CRM PLATFORM', bg: '#00a1e0', fg: '#ffffff', accent: '#ffffff', mark: 'ring', weight: 700, lower: false },
  bank: { name: 'REDWOOD', tag: 'BANKING', bg: '#ec0000', fg: '#ffffff', accent: '#ffffff', mark: 'dot', weight: 700 },
  // ---- the energy drink that owns a circuit (navy and silver, a red accent)
  bull: { name: 'TAURO', tag: 'ENERGY DRINK', bg: '#1b2b5a', fg: '#e8ecf2', accent: '#db0a40', mark: 'ring', weight: 900, italic: true, sx: 1.08 },
  bullSilver: { name: 'TAURO', tag: 'GIVES YOU GRIP', bg: '#dfe3e8', fg: '#1b2b5a', accent: '#db0a40', mark: 'ring', weight: 900, italic: true, sx: 1.08 },
  bullMobile: { name: 'TAURO MOBILE', tag: 'NETZ', bg: '#db0a40', fg: '#ffffff', accent: '#ffcc00', mark: 'ring', weight: 900, italic: true },
  // ---- Montréal
  caisse: { name: 'CAISSE LAURENTIDE', tag: 'COOPÉRATIVE', bg: '#00874e', fg: '#ffffff', accent: '#ffffff', mark: 'shield', weight: 700, track: 0.04 },
  cafe: { name: 'BÉLANGER', tag: 'CAFÉ · DEPUIS 1964', bg: '#b0102a', fg: '#ffffff', accent: '#f2d8a7', mark: 'ring', weight: 700, italic: true },
  boreal: { name: 'BORÉAL AIR', tag: 'CANADA', bg: '#141414', fg: '#ffffff', accent: '#d52b1e', mark: 'wing', weight: 700, track: 0.06 },
  loto: { name: 'LOTO-NORD', tag: 'JOUEZ RESPONSABLEMENT', bg: '#1b3f94', fg: '#ffffff', accent: '#ffd400', mark: 'diamond', weight: 900, italic: true },
  // ---- Spielberg
  styria: { name: 'STEIERMARK', tag: 'DAS GRÜNE HERZ', bg: '#2f8c3c', fg: '#ffffff', accent: '#ffffff', mark: 'wave', weight: 700, track: 0.1 },
  alpbank: { name: 'ALPENBANK', tag: 'MEINE BANK', bg: '#ffe600', fg: '#1a1a1a', accent: '#1a1a1a', mark: 'diamond', weight: 900 },
  alpcom: { name: 'ALPCOM', tag: 'GIGABIT', bg: '#e20074', fg: '#ffffff', accent: '#ffffff', mark: 'dot', weight: 700, lower: false },
  // ---- Zandvoort
  oranje: { name: 'DUINBANK', tag: 'ZANDVOORT PARTNER', bg: '#ff6200', fg: '#ffffff', accent: '#00205b', mark: 'shield', weight: 900 },
  grootmarkt: { name: 'GROOTMARKT', tag: 'SUPERMARKTEN', bg: '#ffd600', fg: '#1a1a1a', accent: '#1a1a1a', mark: 'bars', weight: 900, italic: true },
  noordzee: { name: 'NOORDZEE', tag: 'ROYAL AIRLINES', bg: '#00a1de', fg: '#ffffff', accent: '#ffffff', mark: 'wing', weight: 600, track: 0.12 },
  // ---- Austin
  lonestar: { name: 'LONGHORN TRUCKS', tag: 'BUILT IN TEXAS', bg: '#0b2a5c', fg: '#ffffff', accent: '#bf5700', mark: 'shield', weight: 900, italic: true },
  stream: { name: 'SKYREACH+', tag: 'STREAMING', bg: '#0064ff', fg: '#ffffff', accent: '#ffffff', mark: 'diamond', weight: 700, lower: false },
  // ---- Interlagos
  itapua: { name: 'BANCO ARAPUÃ', tag: 'FEITO PARA VOCÊ', bg: '#ec7000', fg: '#ffffff', accent: '#003399', mark: 'shield', weight: 900 },
  petrosul: { name: 'PETROSUL', tag: 'ENERGIA DO BRASIL', bg: '#008542', fg: '#ffdf00', accent: '#ffdf00', mark: 'diamond', weight: 900, italic: true },
};
