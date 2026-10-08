import type { Brand } from './brands.ts';

/**
 * Who advertises at each Grand Prix — every brand fictional, combined the way the real ones are
 * (docs/F1_ADVERTISING.md):
 *
 *   series partners   sold by the championship itself and so at every race (§1): a timekeeper, the
 *                     tyre supplier, logistics, a 0.0 lager, champagne, an energy drink, an airline,
 *                     a bank, cloud, an energy company, a luxury house, a crypto exchange, a cruise
 *                     line, a laptop maker — 14 of them, each in the colour block of the kind of
 *                     board that really holds that contract (freight yellow, lager green, tyre
 *                     yellow-and-black, airline burgundy…), never a real name or mark
 *   local partners    sold by the race promoter (§1): the host's bank, telecom, beer, airline,
 *                     tourism board, car maker — 6 per circuit, so every circuit carries 20 brands
 *   the title partner the brand that names the race, "<partner> <race name>" (§2), mostly a series
 *                     partner (the 2026 calendar's pattern: the tyre maker at Monza and Silverstone,
 *                     the laptop maker at Montréal and Spielberg, the cruise line at Austin and São
 *                     Paulo…), the host's own airline in the Gulf, nobody in Mexico City (the city
 *                     itself, "presented by" the lager)
 *
 * `setRoster` (from event.ts's setEvent, once per world build) picks the circuit's 20; everything
 * that paints a board reads them through `roster()` (the trackside atlas, the
 * fascias, the pit building, the venue dressings).
 */

// ---------------------------------------------------------------- the series' partners

export type SeriesKey =
  | 'timing' | 'tyres' | 'logistics' | 'lager' | 'champagne' | 'energyDrink' | 'airline'
  | 'bank' | 'cloud' | 'energy' | 'luxury' | 'crypto' | 'cruise' | 'tech';

export const SERIES: Record<SeriesKey, Brand> = {
  // the official timekeeper: black and silver with an emerald rule (the timing contract moved to a
  // black-board watch house in 2025)
  timing: { name: 'VALCOURT', tag: 'HORLOGER · GENÈVE', cat: 'timing', bg: '#0c0d0e', fg: '#e9e5da', accent: '#1f9e6e', mark: 'none', weight: 300, track: 0.28 },
  // the tyre supplier (the game's own, on every car): yellow and black, a wide italic
  tyres: { name: 'VELTRA', tag: 'MOTORSPORT TYRES', cat: 'tyres', bg: '#fcd000', fg: '#111111', accent: '#d7141a', mark: 'chevron', weight: 900, italic: true, sx: 1.28 },
  // logistics: the express-freight yellow with a red italic
  logistics: { name: 'SWIFTLINE', tag: 'EXPRESS', cat: 'logistics', bg: '#ffcc00', fg: '#d40511', accent: '#d40511', mark: 'bars', weight: 900, italic: true, sx: 1.14 },
  // the 0.0 lager: green, gold crest — the drink-responsibly line as its tag (§4)
  lager: { name: 'BRANDT 0.0', tag: 'WHEN YOU DRIVE, ZERO', cat: 'lager', bg: '#0b5a32', fg: '#ffffff', accent: '#d9b44a', mark: 'ring', weight: 900, track: 0.04 },
  // the podium's champagne: bottle green and cream
  champagne: { name: 'MAISON DUVAL', tag: 'CHAMPAGNE · REIMS', cat: 'champagne', bg: '#0e2a1f', fg: '#e8d6a8', accent: '#c9a45c', mark: 'none', weight: 300, track: 0.22 },
  // the energy drink: navy and silver, a red accent
  energyDrink: { name: 'TAURO', tag: 'ENERGY DRINK', cat: 'energy drink', bg: '#1b2b5a', fg: '#e8ecf2', accent: '#db0a40', mark: 'ring', weight: 900, italic: true, sx: 1.08 },
  // the airline: burgundy and old gold
  airline: { name: 'CORVINA AIR', tag: 'GOING PLACES TOGETHER', cat: 'airline', bg: '#5c0632', fg: '#ffffff', accent: '#c7a26b', mark: 'wing', weight: 600, track: 0.06 },
  // the retail bank: red, a white dot
  bank: { name: 'REDWOOD', tag: 'BANKING · PAYMENTS', cat: 'bank', bg: '#ec0000', fg: '#ffffff', accent: '#ffffff', mark: 'dot', weight: 700 },
  // cloud: dark slate, orange wave, lower case
  cloud: { name: 'stratus', tag: 'CLOUD SERVICES', cat: 'cloud', bg: '#232f3e', fg: '#ffffff', accent: '#ff9900', mark: 'wave', weight: 700, lower: true },
  // the energy company: white, green and sea blue
  energy: { name: 'PETRANOVA', tag: 'ENERGY · LOW-CARBON FUELS', cat: 'energy', bg: '#ffffff', fg: '#00843d', accent: '#00a3e0', mark: 'sun', weight: 700, track: 0.06 },
  // the luxury house: brown and sand, a monogram
  luxury: { name: 'MAISON VERNET', tag: 'PARIS · DEPUIS 1854', cat: 'luxury', bg: '#4b3527', fg: '#e8d6ad', accent: '#c9a45c', mark: 'monogram', weight: 300, track: 0.3 },
  // the crypto exchange: midnight blue
  crypto: { name: 'NOVACHAIN', tag: 'DIGITAL ASSETS', cat: 'crypto', bg: '#0b1a33', fg: '#ffffff', accent: '#7fb2ff', mark: 'shield', weight: 700, track: 0.08 },
  // the cruise line: navy and gold
  cruise: { name: 'MERIDIA CRUISES', tag: 'SEE THE WORLD', cat: 'cruise', bg: '#0a2240', fg: '#e6c27a', accent: '#e6c27a', mark: 'globe', weight: 600, track: 0.12 },
  // the laptop maker: red, lower case
  tech: { name: 'Tessara', tag: 'SMARTER TECH', cat: 'tech', bg: '#e2231a', fg: '#ffffff', accent: '#ffffff', mark: 'none', weight: 600, lower: true, track: 0.02 },
};

const SERIES_ORDER: SeriesKey[] = ['timing', 'tyres', 'logistics', 'lager', 'energy', 'airline', 'cruise', 'cloud', 'tech', 'luxury', 'champagne', 'crypto', 'bank', 'energyDrink'];

/**
 * Contract weight in the paddock-wide board runs (how many contracts of boards a brand holds per
 * one of a minor partner's): the title partner most (§2: its branding "throughout"), then the
 * big series contracts that own the camera positions — timing, tyres, freight, the lager, energy.
 */
const WEIGHT: Partial<Record<SeriesKey, number>> = { timing: 2, tyres: 2, logistics: 2, lager: 2, energy: 2 };
const TITLE_WEIGHT = 5;
const PRESENTING_WEIGHT = 3;

// ---------------------------------------------------------------- the circuits' own

interface VenueSet {
  /** the title partner: a series key, a local key, or none */
  title: SeriesKey | string | null;
  /** "presented by" (a race without a title) */
  presenting?: SeriesKey;
  /** six local partners, keyed (the venue dressings name them) */
  local: Record<string, Brand>;
}

const VENUES: Record<string, VenueSet> = {
  // Monza: the tyre maker's Gran Premio (2025 and 2026); a Lombard bank, insurer, espresso,
  // water, telecom and a carrozzeria from up the road
  monza: {
    title: 'tyres',
    local: {
      brianza: { name: 'BRIANZA BANCA', tag: 'DAL 1896', cat: 'bank', bg: '#f4efe4', fg: '#1f3a5a', accent: '#c8102e', mark: 'shield', weight: 600, track: 0.08 },
      leonida: { name: 'LEONIDA', tag: 'ASSICURAZIONI', cat: 'insurance', bg: '#a6192e', fg: '#ffffff', accent: '#f2c75c', mark: 'star', weight: 700, italic: true, track: 0.04 },
      aurelia: { name: 'Aurelia', tag: 'ESPRESSO ITALIANO', cat: 'coffee', bg: '#3b1f14', fg: '#f5e6c8', accent: '#d9a441', mark: 'ring', weight: 600, italic: true, lower: true },
      fontalba: { name: 'FONTALBA', tag: 'ACQUA MINERALE · VALTELLINA', cat: 'water', bg: '#e9f2fa', fg: '#0a4c8c', accent: '#d7141a', mark: 'wave', weight: 700, track: 0.1 },
      telvia: { name: 'TELVIA', tag: 'FIBRA · 5G', cat: 'telecom', bg: '#00205b', fg: '#ffffff', accent: '#00b5e2', mark: 'dot', weight: 900, italic: true },
      ardenza: { name: 'ARDENZA', tag: 'AUTOMOBILI · MILANO', cat: 'car maker', bg: '#141414', fg: '#e6e6e6', accent: '#c8102e', mark: 'diamond', weight: 300, track: 0.32 },
    },
  },
  // Spa: the champagne's Belgian GP (2025, 2026); Ardennes water, an abbey beer, a Liège bank,
  // a Walloon telecom, a Brussels airline, a chocolatier
  spa: {
    title: 'champagne',
    local: {
      valdor: { name: 'VALDOR', tag: 'EAU MINÉRALE DES ARDENNES', cat: 'water', bg: '#e9f3fb', fg: '#c8102e', accent: '#0a4c8c', mark: 'ring', weight: 700, track: 0.1 },
      abbaye: { name: 'ABBAYE DE STER', tag: 'BIÈRE BELGE · TRIPLE', cat: 'beer', bg: '#7a1e12', fg: '#f3d48a', accent: '#f3d48a', mark: 'shield', weight: 600, track: 0.08 },
      banque: { name: 'BANQUE MEUSE', tag: 'LIÈGE · BRUXELLES', cat: 'bank', bg: '#003d7c', fg: '#ffffff', accent: '#ffd200', mark: 'bars', weight: 700 },
      ardennet: { name: 'ARDENNET', tag: 'MOBILE · FIBRE', cat: 'telecom', bg: '#5c2d91', fg: '#ffffff', accent: '#00c389', mark: 'wave', weight: 700, lower: false },
      skybel: { name: 'SKYBEL', tag: 'BRUSSELS AIRWAYS', cat: 'airline', bg: '#ffffff', fg: '#002f6c', accent: '#e4002b', mark: 'wing', weight: 900, italic: true },
      mercx: { name: 'MERCX', tag: 'CHOCOLATIER · DEPUIS 1921', cat: 'chocolate', bg: '#2b1a12', fg: '#e3c08d', accent: '#e3c08d', mark: 'leaf', weight: 400, track: 0.24 },
    },
  },
  // Silverstone: the tyre maker's British GP (2026); a telecom, a Savile Row tailor, a British
  // sports-car maker, a City bank, a gin from the county, an ale
  silverstone: {
    title: 'tyres',
    local: {
      norvik: { name: 'NORVIK', tag: 'TELECOM · 5G', cat: 'telecom', bg: '#5a1e8c', fg: '#ffffff', accent: '#ff6fb5', mark: 'wave', weight: 700 },
      parrish: { name: 'PARRISH & VALE', tag: 'LONDON', cat: 'fashion', bg: '#1c1c1c', fg: '#f1ede4', accent: '#8a1c2b', mark: 'none', weight: 400, track: 0.18 },
      harcourt: { name: 'HARCOURT', tag: 'MOTOR CARS · ENGLAND', cat: 'car maker', bg: '#0f3d2e', fg: '#ffffff', accent: '#c9cdd2', mark: 'wing', weight: 300, track: 0.3 },
      aldwych: { name: 'ALDWYCH BANK', tag: 'SINCE 1790', cat: 'bank', bg: '#00395d', fg: '#ffffff', accent: '#00aeef', mark: 'shield', weight: 600, track: 0.06 },
      woodcote: { name: 'WOODCOTE', tag: 'LONDON DRY GIN', cat: 'spirits', bg: '#e8efe9', fg: '#1d3b2a', accent: '#b88b2e', mark: 'leaf', weight: 600, track: 0.2 },
      albion: { name: 'ALBION ALES', tag: 'NORTHAMPTONSHIRE', cat: 'beer', bg: '#b5121b', fg: '#ffffff', accent: '#f2c75c', mark: 'star', weight: 900, italic: true },
    },
  },
  // Suzuka: the energy company's Japanese GP (2026); the home car maker that owns the circuit (red),
  // an electronics firm, an airline, a bank, a beer, a telecom
  suzuka: {
    title: 'energy',
    local: {
      hayate: { name: 'HAYATE', tag: 'MOTOR COMPANY', cat: 'car maker', bg: '#e60012', fg: '#ffffff', accent: '#ffffff', mark: 'wing', weight: 900, italic: true, sx: 1.1 },
      kosei: { name: 'KOSEI', tag: 'ELECTRONICS', cat: 'electronics', bg: '#0050b5', fg: '#ffffff', accent: '#ffffff', mark: 'globe', weight: 700, italic: true },
      tsubame: { name: 'TSUBAME AIRWAYS', tag: 'FLY JAPAN', cat: 'airline', bg: '#ffffff', fg: '#1d2088', accent: '#e60012', mark: 'wing', weight: 600, track: 0.06 },
      kaido: { name: 'KAIDO BANK', tag: 'FINANCIAL GROUP', cat: 'bank', bg: '#1a237e', fg: '#ffffff', accent: '#c5a14e', mark: 'diamond', weight: 700 },
      iseya: { name: 'ISEYA', tag: 'DRY BEER', cat: 'beer', bg: '#c9ccd1', fg: '#111111', accent: '#d7141a', mark: 'sun', weight: 900, italic: true, sx: 1.15 },
      mobira: { name: 'MOBIRA', tag: '5G · ALL OF JAPAN', cat: 'telecom', bg: '#ff6a00', fg: '#ffffff', accent: '#ffffff', mark: 'dot', weight: 900, lower: false },
    },
  },
  // Interlagos: the cruise line's Grande Prêmio (2025, 2026); a Paulista bank, an energy company,
  // a guaraná, a beer, an airline, a telecom
  interlagos: {
    title: 'cruise',
    local: {
      banco: { name: 'BANCO ARAPUÃ', tag: 'FEITO PARA VOCÊ', cat: 'bank', bg: '#ec7000', fg: '#ffffff', accent: '#003399', mark: 'shield', weight: 900 },
      tupa: { name: 'TUPÃ ENERGIA', tag: 'ENERGIA DO BRASIL', cat: 'energy', bg: '#00539b', fg: '#ffffff', accent: '#7ac143', mark: 'sun', weight: 900, italic: true },
      guarana: { name: 'GUARANÁ VIVA', tag: 'O SABOR DO BRASIL', cat: 'soft drink', bg: '#00843d', fg: '#ffffff', accent: '#e4002b', mark: 'leaf', weight: 900, italic: true },
      paulistania: { name: 'PAULISTÂNIA', tag: 'CERVEJA PURO MALTE', cat: 'beer', bg: '#ffd400', fg: '#a6192e', accent: '#a6192e', mark: 'star', weight: 900, sx: 1.06 },
      arara: { name: 'ARARA', tag: 'LINHAS AÉREAS', cat: 'airline', bg: '#0b2265', fg: '#ffffff', accent: '#00b2e3', mark: 'wing', weight: 700, italic: true },
      telesul: { name: 'TELESUL', tag: 'INTERNET · 5G', cat: 'telecom', bg: '#660099', fg: '#ffffff', accent: '#ffffff', mark: 'wave', weight: 700, lower: false },
    },
  },
  // Spielberg: the laptop maker's Austrian GP (2026) at a circuit an energy drink owns and dresses
  // (its own mobile brand too); the Styrian tourist board, a bank, a telecom, a brewery, spring water
  spielberg: {
    title: 'tech',
    local: {
      tauro: { name: 'TAURO MOBILE', tag: 'NETZ', cat: 'telecom', bg: '#db0a40', fg: '#ffffff', accent: '#ffcc00', mark: 'ring', weight: 900, italic: true },
      steiermark: { name: 'STEIERMARK', tag: 'DAS GRÜNE HERZ', cat: 'tourism', bg: '#2f8c3c', fg: '#ffffff', accent: '#ffffff', mark: 'leaf', weight: 700, track: 0.1 },
      alpenbank: { name: 'ALPENBANK', tag: 'MEINE BANK', cat: 'bank', bg: '#ffe600', fg: '#1a1a1a', accent: '#1a1a1a', mark: 'diamond', weight: 900 },
      alpcom: { name: 'ALPCOM', tag: 'GIGABIT', cat: 'telecom', bg: '#e20074', fg: '#ffffff', accent: '#ffffff', mark: 'dot', weight: 700 },
      murtaler: { name: 'MURTALER BRÄU', tag: 'SEIT 1857', cat: 'beer', bg: '#ffffff', fg: '#a6192e', accent: '#0b5a32', mark: 'shield', weight: 700, italic: true },
      almquell: { name: 'ALMQUELL', tag: 'ALPINES QUELLWASSER', cat: 'water', bg: '#d8ecf6', fg: '#005b9a', accent: '#5bb4e5', mark: 'wave', weight: 600, track: 0.12 },
    },
  },
  // Austin: the cruise line's United States GP (2025, 2026); a Texas truck maker, the streaming
  // service that holds the US rights (2026), a bank, a lager, a wireless carrier, the Hill Country
  austin: {
    title: 'cruise',
    local: {
      longhorn: { name: 'LONGHORN TRUCKS', tag: 'BUILT IN TEXAS', cat: 'car maker', bg: '#0b2a5c', fg: '#ffffff', accent: '#bf5700', mark: 'shield', weight: 900, italic: true },
      skyreach: { name: 'SKYREACH+', tag: 'EVERY RACE LIVE', cat: 'streaming', bg: '#0064ff', fg: '#ffffff', accent: '#ffffff', mark: 'diamond', weight: 700 },
      pecos: { name: 'PECOS NATIONAL', tag: 'BANK OF TEXAS', cat: 'bank', bg: '#ffffff', fg: '#7a1f1f', accent: '#1f3a68', mark: 'star', weight: 700, track: 0.04 },
      bluebonnet: { name: 'BLUEBONNET', tag: 'TEXAS LAGER', cat: 'beer', bg: '#2b4c9b', fg: '#ffffff', accent: '#f2c75c', mark: 'leaf', weight: 900, italic: true },
      mesa: { name: 'MESA WIRELESS', tag: '5G ACROSS AMERICA', cat: 'telecom', bg: '#e20074', fg: '#ffffff', accent: '#ffffff', mark: 'wave', weight: 900 },
      hill: { name: 'HILL COUNTRY', tag: 'TEXAS TOURISM', cat: 'tourism', bg: '#c96b1f', fg: '#ffffff', accent: '#3c2414', mark: 'sun', weight: 700, track: 0.08 },
    },
  },
  // Zandvoort: the lager's Dutch GP (2025, 2026) in orange; a Dutch bank, a supermarket, the
  // royal airline's sky blue, a telecom, a cheese farm, the coast's tourist board
  zandvoort: {
    title: 'lager',
    local: {
      duinbank: { name: 'DUINBANK', tag: 'ZANDVOORT PARTNER', cat: 'bank', bg: '#ff6200', fg: '#ffffff', accent: '#00205b', mark: 'shield', weight: 900 },
      grootmarkt: { name: 'GROOTMARKT', tag: 'SUPERMARKTEN', cat: 'supermarket', bg: '#ffd600', fg: '#1a1a1a', accent: '#1a1a1a', mark: 'bars', weight: 900, italic: true },
      noordzee: { name: 'NOORDZEE', tag: 'NEDERLANDSE LUCHTVAART', cat: 'airline', bg: '#00a1de', fg: '#ffffff', accent: '#ffffff', mark: 'wing', weight: 600, track: 0.12 },
      oranjenet: { name: 'ORANJENET', tag: 'MOBIEL · GLASVEZEL', cat: 'telecom', bg: '#00a650', fg: '#ffffff', accent: '#ffffff', mark: 'dot', weight: 700, lower: false },
      kaashoeve: { name: 'KAASHOEVE', tag: 'BOERENKAAS SINDS 1903', cat: 'food', bg: '#f6c900', fg: '#7a1e12', accent: '#7a1e12', mark: 'sun', weight: 900, italic: true },
      kuststreek: { name: 'KUSTSTREEK', tag: 'BEZOEK NOORD-HOLLAND', cat: 'tourism', bg: '#21468b', fg: '#ffffff', accent: '#ff7b00', mark: 'wave', weight: 700, track: 0.1 },
    },
  },
  // Montréal: the laptop maker's Grand Prix du Canada (2026); a Québec cooperative bank, a café,
  // a national airline, the provincial lottery, a brasserie, the cable company
  montreal: {
    title: 'tech',
    local: {
      caisse: { name: 'CAISSE LAURENTIDE', tag: 'COOPÉRATIVE', cat: 'bank', bg: '#00874e', fg: '#ffffff', accent: '#ffffff', mark: 'shield', weight: 700, track: 0.04 },
      belanger: { name: 'BÉLANGER', tag: 'CAFÉ · DEPUIS 1964', cat: 'coffee', bg: '#b0102a', fg: '#ffffff', accent: '#f2d8a7', mark: 'ring', weight: 700, italic: true },
      boreal: { name: 'BORÉAL AIR', tag: 'CANADA', cat: 'airline', bg: '#141414', fg: '#ffffff', accent: '#d52b1e', mark: 'leaf', weight: 700, track: 0.06 },
      loto: { name: 'LOTO-NORD', tag: 'JOUEZ RESPONSABLEMENT', cat: 'lottery', bg: '#1b3f94', fg: '#ffffff', accent: '#ffd400', mark: 'diamond', weight: 900, italic: true },
      saint: { name: 'SAINT-LAURENT', tag: 'BRASSERIE · MONTRÉAL', cat: 'beer', bg: '#f2eadb', fg: '#0d2c54', accent: '#c8102e', mark: 'star', weight: 900, track: 0.04 },
      videofil: { name: 'VIDÉOFIL', tag: 'TÉLÉ · INTERNET · MOBILE', cat: 'telecom', bg: '#ffd200', fg: '#111111', accent: '#111111', mark: 'chevron', weight: 900, italic: true },
    },
  },
  // Albert Park: the airline's Australian GP (2026); the harbour lager, a mutual insurer, a
  // laneway roaster, a payments start-up, a regional airline, the state's tourist board
  melbourne: {
    title: 'airline',
    local: {
      harbour: { name: 'HARBOUR LAGER', tag: 'BREWED IN MELBOURNE', cat: 'beer', bg: '#0b6b35', fg: '#ffffff', accent: '#ffcd00', mark: 'sun', weight: 900, italic: true },
      tasman: { name: 'TASMAN MUTUAL', tag: 'INSURANCE · SINCE 1911', cat: 'insurance', bg: '#ffffff', fg: '#00205b', accent: '#ffcd00', mark: 'shield', weight: 700 },
      laneway: { name: 'LANEWAY ROASTERS', tag: 'SPECIALTY COFFEE', cat: 'coffee', bg: '#1d1a17', fg: '#f2e6d0', accent: '#c46a2b', mark: 'ring', weight: 400, track: 0.12 },
      nebulix: { name: 'nebulix', tag: 'THE FUTURE OF PAYMENTS', cat: 'payments', bg: '#002d74', fg: '#ffffff', accent: '#59c3ff', mark: 'diamond', weight: 600, lower: true },
      wattle: { name: 'WATTLE AIR', tag: 'FLY AUSTRALIAN', cat: 'airline', bg: '#e8a317', fg: '#1b1b1b', accent: '#1b1b1b', mark: 'wing', weight: 900, italic: true },
      yarra: { name: 'YARRA STATE', tag: 'VISIT VICTORIA', cat: 'tourism', bg: '#00205b', fg: '#ffffff', accent: '#00b2a9', mark: 'star', weight: 700, track: 0.12 },
    },
  },
  // Mexico City: no title partner — the city's own Gran Premio, "presented by" the lager; the
  // promoter's telecom, beer, bank, the city, spring water, a mezcal
  mexico: {
    title: null,
    presenting: 'lager',
    local: {
      cellia: { name: 'CELLIA', tag: 'RED 5G · TODO MÉXICO', cat: 'telecom', bg: '#0057b8', fg: '#ffffff', accent: '#00c1f3', mark: 'wave', weight: 900, italic: true },
      palmera: { name: 'PALMERA', tag: 'CERVEZA · DESDE 1925', cat: 'beer', bg: '#0f3b26', fg: '#f2d16b', accent: '#c8102e', mark: 'ring', weight: 900 },
      banco: { name: 'BANCO ALTIPLANO', tag: 'EL BANCO FUERTE DE MÉXICO', cat: 'bank', bg: '#e30613', fg: '#ffffff', accent: '#ffffff', mark: 'bars', weight: 700 },
      tonalli: { name: 'TONALLI', tag: 'VIVE LA CIUDAD', cat: 'tourism', bg: '#00a19a', fg: '#ffffff', accent: '#e6007e', mark: 'sun', weight: 700, track: 0.06 },
      aguaviva: { name: 'AGUAVIVA', tag: 'AGUA DE MANANTIAL', cat: 'water', bg: '#e8f4fb', fg: '#004a98', accent: '#47a9e0', mark: 'wave', weight: 600 },
      nube: { name: 'NUBE ALTA', tag: 'MEZCAL ARTESANAL · OAXACA', cat: 'spirits', bg: '#111111', fg: '#d4b06a', accent: '#d4b06a', mark: 'none', weight: 300, track: 0.26 },
    },
  },
  // the Hungaroring: the cloud company's Hungarian GP (2026); a Budapest bank, a Balaton beer,
  // a telecom, an airline, a Tokaj wine house, a spa town
  hungaroring: {
    title: 'cloud',
    local: {
      tisza: { name: 'TISZA BANK', tag: 'MAGYAR · SINCE 1912', cat: 'bank', bg: '#00205b', fg: '#ffffff', accent: '#ce2939', mark: 'shield', weight: 700, track: 0.05 },
      balaton: { name: 'BALATON SÖR', tag: 'PRÉMIUM LÁGER', cat: 'beer', bg: '#0b5a8c', fg: '#ffffff', accent: '#f2c75c', mark: 'wave', weight: 900, italic: true },
      pannontel: { name: 'PANNONTEL', tag: 'MOBIL · NET · TV', cat: 'telecom', bg: '#e20074', fg: '#ffffff', accent: '#ffffff', mark: 'dot', weight: 700 },
      duna: { name: 'DUNA AIRWAYS', tag: 'FROM BUDAPEST', cat: 'airline', bg: '#ffffff', fg: '#477050', accent: '#ce2939', mark: 'wing', weight: 600, track: 0.08 },
      aranyhegy: { name: 'ARANYHEGY', tag: 'TOKAJI BOROK', cat: 'wine', bg: '#4a1022', fg: '#f0d48a', accent: '#f0d48a', mark: 'leaf', weight: 300, track: 0.22 },
      heviz: { name: 'HÉVÍZ', tag: 'THERMAL LAKE · SPA', cat: 'tourism', bg: '#e6f2ef', fg: '#00665e', accent: '#ce2939', mark: 'sun', weight: 700, track: 0.12 },
    },
  },
  // Sakhir: the national airline's Bahrain GP (navy and gold); a telecom, the state energy company,
  // a bank, the aluminium smelter, a resort
  sakhir: {
    title: 'awal',
    local: {
      awal: { name: 'AWAL AIRWAYS', tag: 'THE PEARL OF THE GULF', cat: 'airline', bg: '#0c1f4a', fg: '#efe0b4', accent: '#c9a227', mark: 'wing', weight: 600, track: 0.06 },
      najma: { name: 'NAJMA', tag: 'TELECOM · 5G', cat: 'telecom', bg: '#e4002b', fg: '#ffffff', accent: '#ffffff', mark: 'star', weight: 900 },
      sitra: { name: 'SITRA ENERGIES', tag: 'POWERING THE KINGDOM', cat: 'energy', bg: '#ffffff', fg: '#00754a', accent: '#00a3e0', mark: 'wave', weight: 700 },
      dilmun: { name: 'DILMUN BANK', tag: 'PRIVATE · CORPORATE', cat: 'bank', bg: '#1d1d1b', fg: '#d6b46a', accent: '#d6b46a', mark: 'shield', weight: 300, track: 0.2 },
      aluminia: { name: 'ALUMINIA', tag: 'BAHRAIN ALUMINIUM', cat: 'industry', bg: '#d9dde1', fg: '#1b365d', accent: '#1b365d', mark: 'bars', weight: 900, sx: 1.1 },
      alqamar: { name: 'AL QAMAR', tag: 'RESORTS · MANAMA', cat: 'hospitality', bg: '#8a1538', fg: '#f3e3c3', accent: '#d9b46a', mark: 'sun', weight: 400, track: 0.16 },
    },
  },
  // Yas Marina: the national airline's Abu Dhabi GP (champagne and gold on stone); the state energy
  // company's blue, a developer, a payments app, hotels, a telecom
  yasmarina: {
    title: 'yasmeen',
    local: {
      yasmeen: { name: 'YASMEEN AIRWAYS', tag: 'FROM ABU DHABI TO THE WORLD', cat: 'airline', bg: '#efe9df', fg: '#8a6a2c', accent: '#bd8b13', mark: 'wing', weight: 600, track: 0.08 },
      khaleej: { name: 'KHALEEJ', tag: 'ENERGY · SINCE 1971', cat: 'energy', bg: '#0047ba', fg: '#ffffff', accent: '#00b2e3', mark: 'diamond', weight: 900, italic: true },
      saadiyat: { name: 'SAADIYAT & CO', tag: 'COMMUNITIES · RESORTS', cat: 'property', bg: '#ffffff', fg: '#002f6c', accent: '#00a0df', mark: 'none', weight: 300, track: 0.24 },
      falcon: { name: 'FALCON PAY', tag: 'TAP · PAY · GO', cat: 'payments', bg: '#111111', fg: '#ffffff', accent: '#00c08b', mark: 'ring', weight: 700 },
      qasr: { name: 'QASR HOTELS', tag: 'ARABIAN HOSPITALITY', cat: 'hospitality', bg: '#7a1f2b', fg: '#f3e3c3', accent: '#d9b46a', mark: 'shield', weight: 400, track: 0.14 },
      durrah: { name: 'DURRAH', tag: 'TELECOM · 5G', cat: 'telecom', bg: '#6c2b8f', fg: '#ffffff', accent: '#f2c75c', mark: 'globe', weight: 700 },
    },
  },
};

// ---------------------------------------------------------------- the roster

export interface Roster {
  id: string;
  /** the race's title partner (null: the race has none) */
  title: Brand | null;
  /** "presented by" a race without a title */
  presenting: Brand | null;
  /** the circuit's 20 brands: the title partner first, the series partners, then the local ones */
  brands: Brand[];
  /** each brand's key ('timing', 'tyres'…, or the venue's own local key) */
  keys: string[];
  /** the local partners' keys */
  local: string[];
  /** brand indices weighted by contract (the paddock-wide board runs pick from these) */
  mix: number[];
  /** a brand by key (series or local; the title partner is also 'title') */
  b(key: string): Brand;
  /** index of a key in `brands` */
  index(key: string): number;
}

function build(id: string): Roster {
  const v = VENUES[id] ?? { title: null, local: {} };
  const keys: string[] = [];
  const brands: Brand[] = [];
  const add = (k: string, b: Brand) => {
    if (keys.includes(k)) return;
    keys.push(k);
    brands.push(b);
  };
  const lookup = (k: string): Brand | undefined => (SERIES as Record<string, Brand>)[k] ?? v.local[k];
  const title = v.title ? lookup(v.title) ?? null : null;
  if (title && v.title) add(v.title, title);
  for (const k of SERIES_ORDER) add(k, SERIES[k]);
  for (const [k, b] of Object.entries(v.local)) add(k, b);
  // (a local key shadowing a series key would silently drop the local partner)
  if (VENUES[id] && brands.length !== 20) console.warn(`[partners] ${id} has ${brands.length} brands, not 20`);
  const presenting = v.presenting ? SERIES[v.presenting] : null;
  const mix: number[] = [];
  keys.forEach((k, i) => {
    const w = k === v.title ? TITLE_WEIGHT : k === v.presenting ? PRESENTING_WEIGHT : (WEIGHT[k as SeriesKey] ?? 1);
    for (let n = 0; n < w; n++) mix.push(i);
  });
  return {
    id,
    title,
    presenting,
    brands,
    keys,
    local: Object.keys(v.local),
    mix,
    b(key: string) {
      if (key === 'title') return title ?? presenting ?? SERIES.timing;
      const i = keys.indexOf(key);
      if (i < 0) throw new Error(`no partner '${key}' at ${id}`);
      return brands[i];
    },
    index(key: string) {
      if (key === 'title') return title ? 0 : Math.max(0, keys.indexOf(v.presenting ?? 'timing'));
      return Math.max(0, keys.indexOf(key));
    },
  };
}

const cache = new Map<string, Roster>();
/** a circuit's roster (built once) */
export function rosterFor(id: string): Roster {
  let r = cache.get(id);
  if (!r) {
    r = build(id);
    cache.set(id, r);
  }
  return r;
}

let current: Roster = rosterFor('monza');
/** the circuit being built (event.ts setEvent) */
export function setRoster(id: string) {
  current = rosterFor(id);
}
/** the brands of the circuit being built */
export const roster = (): Roster => current;

/** every circuit with its own partner set (for checks: each must come to 20) */
export const ROSTER_IDS = Object.keys(VENUES);
