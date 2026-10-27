import { everUnlocked, unlockForever } from './Unlocks.ts';
import { F1_SPEC, type CarSpec } from '../sim/CarPhysics.ts';
import { POINTS, AI_SKILL } from '../race/Race.ts';
import { ALL_CIRCUITS, CIRCUITS, isScenic } from '../world/Circuits.ts';
import type { LiveryPattern, Team } from '../race/Teams.ts';

/**
 * The player's career: every race result, the prize money it earns, the circuits it
 * unlocks (a top-five finish at a circuit opens the next one on the calendar), the
 * car's development (five areas, five steps each) and the player's own paint scheme.
 * Stored in localStorage; nothing here touches the scene.
 */

export const UNLOCK_POS = 5;

export type UpgradeId = 'engine' | 'aero' | 'brakes' | 'chassis' | 'ers';
export const MAX_LEVEL = 5;

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** what one step does, for the card */
  step: string;
  /** the stat it moves, 0..1 bar per level */
  stat: string;
  apply(spec: CarSpec, level: number): void;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'engine', name: 'Power unit', step: '+1.5% power', stat: 'Power', apply: (s, n) => (s.power *= 1 + 0.015 * n) },
  { id: 'aero', name: 'Aerodynamics', step: '+2.5% downforce', stat: 'Downforce', apply: (s, n) => (s.clA *= 1 + 0.025 * n) },
  { id: 'chassis', name: 'Suspension', step: '+1% mechanical grip', stat: 'Grip', apply: (s, n) => (s.mu *= 1 + 0.01 * n) },
  { id: 'brakes', name: 'Brakes', step: '+4% stopping power', stat: 'Braking', apply: (s, n) => (s.brakeTorque *= 1 + 0.04 * n) },
  { id: 'ers', name: 'Energy recovery', step: '+8% deployment', stat: 'ERS', apply: (s, n) => (s.ersBoost *= 1 + 0.08 * n) },
];

/** price of the next step from `level` */
export function upgradeCost(level: number): number {
  return Math.round((12000 * (level + 1) ** 1.6) / 500) * 500;
}

// ------------------------------------------------------------------ set-up
export type SetupId = 'frontWing' | 'rearWing' | 'brakeBias' | 'suspension' | 'rideHeight' | 'pressure';
export type SetupPart = 'frontWing' | 'rearWing' | 'brakes' | 'suspension' | 'floor' | 'tyres';

export interface SetupDef {
  id: SetupId;
  name: string;
  /** which part of the car the garage camera looks at */
  part: SetupPart;
  min: number;
  max: number;
  def: number;
  lo: string;
  hi: string;
  fmt(v: number): string;
  apply(s: CarSpec, v: number): void;
}

export const SETUP: SetupDef[] = [
  { id: 'frontWing', name: 'Front wing', part: 'frontWing', min: 1, max: 11, def: 6, lo: 'Less front grip', hi: 'Sharper turn-in', fmt: (v) => `${v}`,
    apply: (s, v) => { s.aeroFront += (v - 6) * 0.007; s.clA *= 1 + (v - 6) * 0.004; } },
  { id: 'rearWing', name: 'Rear wing', part: 'rearWing', min: 1, max: 11, def: 6, lo: 'Low drag · faster on straights', hi: 'High downforce · faster in corners', fmt: (v) => `${v}`,
    apply: (s, v) => { s.clA *= 1 + (v - 6) * 0.02; s.cdA *= 1 + (v - 6) * 0.024; s.aeroFront -= (v - 6) * 0.004; } },
  { id: 'brakeBias', name: 'Brake bias', part: 'brakes', min: 52, max: 62, def: 57, lo: 'Rearward · rotates on entry', hi: 'Forward · stable, locks fronts', fmt: (v) => `${v}% front`,
    apply: (s, v) => { s.brakeBias = v / 100; } },
  { id: 'suspension', name: 'Anti-roll balance', part: 'suspension', min: 1, max: 11, def: 6, lo: 'Soft front · more front grip', hi: 'Stiff front · stable rear', fmt: (v) => `${v}`,
    apply: (s, v) => { s.rollFront = 0.56 + (v - 6) * 0.014; } },
  { id: 'rideHeight', name: 'Ride height', part: 'floor', min: 1, max: 11, def: 6, lo: 'Low · more downforce', hi: 'High · less drag, rides kerbs', fmt: (v) => `${v}`,
    apply: (s, v) => { s.clA *= 1 - (v - 6) * 0.012; s.cdA *= 1 - (v - 6) * 0.005; } },
  { id: 'pressure', name: 'Tyre pressures', part: 'tyres', min: 1, max: 11, def: 6, lo: 'Low · grip, slower response', hi: 'High · sharp, less grip', fmt: (v) => `${(19.5 + v * 0.4).toFixed(1)} psi`,
    apply: (s, v) => { s.mu *= 1 - Math.abs(v - 5) * 0.004; s.slipAnglePeak *= 1 - (v - 6) * 0.02; s.slipAnglePeakRear *= 1 - (v - 6) * 0.02; } },
];

export type Finish = 'gloss' | 'satin' | 'matte' | 'metallic' | 'pearl' | 'chrome';
export const FINISHES: { id: Finish; name: string }[] = [
  { id: 'gloss', name: 'Gloss' },
  { id: 'satin', name: 'Satin' },
  { id: 'matte', name: 'Matte' },
  { id: 'metallic', name: 'Metallic' },
  { id: 'pearl', name: 'Pearl' },
  { id: 'chrome', name: 'Chrome' },
];

export interface Paint {
  primary: string;
  secondary: string;
  accent: string;
  pattern: LiveryPattern;
  finish: Finish;
  /** the details (absent: the team's own) */
  carbon?: CarbonLevel;
  halo?: PartPaint;
  wing?: PartPaint;
  /** the wheel covers' ring: a colour, 'team' or 'none' */
  rim?: string;
  /** the race number on the nose and fin, 1–99 */
  number?: number;
  /** the title sponsor's name on the sidepods, wings and halo */
  sponsor?: string;
  /** the helmet's two colours */
  helmet?: [string, string];
}

export type CarbonLevel = 'none' | 'some' | 'lots';
export const CARBON: { id: CarbonLevel; name: string; amt: number }[] = [
  { id: 'none', name: 'Fully painted', amt: 0 },
  { id: 'some', name: 'Some', amt: 0.3 },
  { id: 'lots', name: 'Lots', amt: 0.62 },
];
/** a part painted in one of the livery's colours or left in carbon */
export type PartPaint = 'team' | 'primary' | 'secondary' | 'accent' | 'carbon';
export const PART_PAINTS: { id: PartPaint; name: string }[] = [
  { id: 'team', name: 'Livery' },
  { id: 'primary', name: 'Base' },
  { id: 'secondary', name: 'Secondary' },
  { id: 'accent', name: 'Accent' },
  { id: 'carbon', name: 'Carbon' },
];
export const RIMS: { id: string; name: string }[] = [
  { id: 'team', name: 'Livery' },
  { id: 'accent', name: 'Accent' },
  { id: '#ffffff', name: 'White' },
  { id: '#d6b25e', name: 'Gold' },
  { id: '#c9ccd1', name: 'Silver' },
  { id: 'none', name: 'None' },
];
/** sponsor names the shop suggests (fictional) */
export const SPONSORS = ['VELOCE', 'ORBIS', 'NOVAQ', 'HALCYON', 'ZEPHYR', 'KRONOS', 'APEX', 'LUMEN', 'TITAN', 'AURORA'];

/** paint colours offered in the shop (sRGB): reds, oranges, yellows, greens, blues, purples, pinks, neutrals */
export const PALETTE = [
  '#dc0000', '#ff2b3f', '#a3001b', '#ff6a00', '#ff8700', '#ffc400', '#d4ff00', '#00c853',
  '#00574b', '#00d2be', '#00a3e0', '#0a5cc2', '#1b2552', '#1434cb', '#6a1b9a', '#ff4fa3',
  '#ffffff', '#c0c4c8', '#6b7078', '#2a2d33', '#111214', '#b8975a',
];
export const PATTERNS: { id: LiveryPattern; name: string }[] = [
  { id: 'sweep', name: 'Sweep' },
  { id: 'split', name: 'Split' },
  { id: 'fade', name: 'Fade' },
  { id: 'stripe', name: 'Stripe' },
  { id: 'block', name: 'Block' },
  { id: 'arrow', name: 'Arrow' },
  { id: 'twotone', name: 'Two-tone' },
  { id: 'chevron', name: 'Chevrons' },
  { id: 'pinstripe', name: 'Pinstripe' },
  { id: 'checker', name: 'Chequered' },
  { id: 'bolt', name: 'Lightning' },
  { id: 'camo', name: 'Camo' },
];
/** the grid's own layouts, offered in the shop under their teams' names */
export const TEAM_PATTERNS: { id: LiveryPattern; name: string }[] = [
  { id: 'ferrari', name: 'Rossa' },
  { id: 'mercedes', name: 'Stellar' },
  { id: 'redbull', name: 'Taurus' },
  { id: 'mclaren', name: 'Solis' },
  { id: 'aston', name: 'Verdant' },
  { id: 'alpine', name: 'Azure' },
  { id: 'williams', name: 'Kestrel' },
  { id: 'haas', name: 'Forge' },
  { id: 'racingbulls', name: 'Nova' },
  { id: 'audi', name: 'Vektor' },
  { id: 'cadillac', name: 'Liberty' },
];

export interface RaceRecord {
  track: string;
  pos: number;
  dnf: boolean;
  points: number;
  credits: number;
  /** team index raced for */
  team: number;
  date: number;
}

export interface CareerData {
  v: 1;
  credits: number;
  races: number;
  wins: number;
  podiums: number;
  points: number;
  dnfs: number;
  /** best finish per circuit id */
  best: Record<string, number>;
  upgrades: Record<UpgradeId, number>;
  /** per team index: the player's paint (absent = the team's own livery) */
  paint: Record<number, Paint>;
  history: RaceRecord[];
  setup: Record<SetupId, number>;
  /** Dynamic difficulty: the AI pace (fraction of the limit) that matches the player, updated after every race */
  aiSkill?: number;
  /** 2: the AI rating was lifted once when the field got quicker off the line and in traffic (2026-10-23) */
  aiSkillV?: number;
  /** the World Tour's race distance (5, or 10 with the mandatory stop) */
  tourLaps?: number;
}

export interface RaceReward {
  points: number;
  credits: number;
  breakdown: { label: string; credits: number }[];
  /** circuit id unlocked by this result */
  unlocked: string | null;
  bestBefore: number | null;
  /** a career round */
  career?: boolean;
}

const KEY = 'apexgp.career';
const THREE_CLAMP = (x: number) => Math.max(0, Math.min(1, x));

function fresh(): CareerData {
  return {
    v: 1,
    credits: 25000,
    races: 0,
    wins: 0,
    podiums: 0,
    points: 0,
    dnfs: 0,
    best: {},
    upgrades: { engine: 0, aero: 0, brakes: 0, chassis: 0, ers: 0 },
    paint: {},
    history: [],
    setup: Object.fromEntries(SETUP.map((d) => [d.id, d.def])) as Record<SetupId, number>,
  };
}

/** every circuit unlocked without winning your way through the calendar (off: the unlock chain is back) */
export const UNLOCK_ALL = false;

/** a round's medal from the best career finish there */
export type Medal = 'gold' | 'silver' | 'bronze' | null;
export function medalFor(best: number | undefined): Medal {
  return best === undefined ? null : best === 1 ? 'gold' : best <= 3 ? 'silver' : best <= UNLOCK_POS ? 'bronze' : null;
}
/** stars a medal is worth on the World Tour */
export const STARS: Record<Exclude<Medal, null>, number> = { gold: 3, silver: 2, bronze: 1 };
/** the scenic road courses are the tour's bonus circuits: opened by stars, not by the chain */
export const SCENIC_STARS: Record<string, number> = { serena: 5, bergsee: 12, redmesa: 20 };
/** the World Tour's race distances */
export const TOUR_LAPS = [5, 10] as const;

export class Career {
  data: CareerData;
  private listeners: (() => void)[] = [];

  constructor() {
    this.data = fresh();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<CareerData>;
        this.data = { ...fresh(), ...d, upgrades: { ...fresh().upgrades, ...(d.upgrades ?? {}) }, best: { ...(d.best ?? {}) }, paint: { ...(d.paint ?? {}) }, history: d.history ?? [], setup: { ...fresh().setup, ...(d.setup ?? {}) } };
      }
    } catch {
      /* a broken save starts a new career */
    }
    // the AI used to idle away the opening seconds and sat far down the scale: lift old ratings once
    if (this.data.aiSkillV !== 2) {
      if (typeof this.data.aiSkill === 'number') this.data.aiSkill = Math.max(this.data.aiSkill, 0.955);
      this.data.aiSkillV = 2;
    }
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable: the career lasts this session */
    }
    for (const f of this.listeners) f();
  }

  // ------------------------------------------------------------------ circuits
  /** circuits are unlocked in calendar order: the first always, then one per top-five finish at the one before */
  /** circuits opened another way (the driver career: every circuit its seasons have reached) */
  static extraUnlocked: ((id: string) => boolean) | null = null;
  isUnlocked(id: string): boolean {
    // (once opened, open for good: a new season or a new career never locks it again)
    // (the scenic road courses are outside the calendar: always open)
    if (UNLOCK_ALL || everUnlocked(id)) return true;
    if (isScenic(id)) {
      const open = this.stars() >= (SCENIC_STARS[id] ?? 0);
      if (open) unlockForever(id);
      return open;
    }
    let open = !!Career.extraUnlocked?.(id);
    if (!open) {
      const i = CIRCUITS.findIndex((c) => c.id === id);
      if (i <= 0) open = true;
      else {
        const prev = this.data.best[CIRCUITS[i - 1].id];
        open = prev !== undefined && prev <= UNLOCK_POS;
      }
    }
    if (open) unlockForever(id);
    return open;
  }
  unlockedCircuits() {
    return CIRCUITS.filter((c) => this.isUnlocked(c.id));
  }

  // ------------------------------------------------------------------ results
  /** the next round the career is working on: the last unlocked one without a medal (null = season complete) */
  nextRound(): string | null {
    for (const c of CIRCUITS) {
      if (!this.isUnlocked(c.id)) return null;
      if (medalFor(this.data.best[c.id]) === null) return c.id;
    }
    return null;
  }
  /** stars won on the World Tour (every circuit's best medal: win 3, podium 2, top five 1) */
  stars(): number {
    let n = 0;
    for (const c of ALL_CIRCUITS) {
      const k = medalFor(this.data.best[c.id]);
      if (k) n += STARS[k];
    }
    return n;
  }
  get tourLaps(): number {
    return TOUR_LAPS.includes(this.data.tourLaps as 5 | 10) ? this.data.tourLaps! : TOUR_LAPS[0];
  }
  setTourLaps(n: number) {
    this.data.tourLaps = n;
    this.save();
  }
  /** medals won so far */
  medals() {
    const m = { gold: 0, silver: 0, bronze: 0 };
    for (const c of ALL_CIRCUITS) {
      const k = medalFor(this.data.best[c.id]);
      if (k) m[k]++;
    }
    return m;
  }
  /** the season score: championship points of the best finish at every round */
  seasonPoints(): number {
    let n = 0;
    for (const c of CIRCUITS) {
      const b = this.data.best[c.id];
      if (b !== undefined && b <= 10) n += POINTS[b - 1];
    }
    return n;
  }

  /**
   * The rivals' car: they develop through the season too — three quarters of what the player has
   * bought, plus a steady step for every round unlocked — so upgrades are an edge, never a walkover.
   */
  rivalSpec(): CarSpec {
    const s: CarSpec = { ...F1_SPEC, gears: F1_SPEC.gears.slice() };
    const season = Math.max(0, this.unlockedCircuits().length - 1) / Math.max(1, CIRCUITS.length - 1);
    for (const u of UPGRADES) u.apply(s, Math.min(MAX_LEVEL, this.level(u.id) * 0.75 + season * 1.5));
    return s;
  }

  /** record a finished race; returns what it earned. `career`: a career round (counts for the medals and the unlocks) */
  recordRace(track: string, pos: number, dnf: boolean, fastest: boolean, team: number, field: number, career = true): RaceReward {
    const d = this.data;
    const scored = !dnf && pos <= 10;
    const points = scored ? POINTS[pos - 1] + (fastest ? 1 : 0) : 0;
    const breakdown: { label: string; credits: number }[] = [];
    breakdown.push({ label: 'Start money', credits: 5000 });
    if (points) breakdown.push({ label: `${points} championship point${points === 1 ? '' : 's'}`, credits: points * 2000 });
    if (!dnf && pos === 1) breakdown.push({ label: 'Race win bonus', credits: 20000 });
    else if (!dnf && pos <= 3) breakdown.push({ label: 'Podium bonus', credits: 8000 });
    if (!dnf && pos > 10) breakdown.push({ label: `Beat ${field - pos} cars`, credits: Math.max(0, field - pos) * 300 });
    const credits = breakdown.reduce((a, b) => a + b.credits, 0);
    const wasUnlocked = new Set(this.unlockedCircuits().map((c) => c.id));
    const bestBefore = d.best[track] ?? null;
    d.races++;
    d.points += points;
    d.credits += credits;
    if (dnf) d.dnfs++;
    else {
      if (pos === 1) d.wins++;
      if (pos <= 3) d.podiums++;
      if (career) d.best[track] = Math.min(d.best[track] ?? 99, pos);
    }
    d.history.unshift({ track, pos, dnf, points, credits, team, date: Date.now() });
    d.history.length = Math.min(d.history.length, 40);
    const unlocked = this.unlockedCircuits().find((c) => !wasUnlocked.has(c.id))?.id ?? null;
    this.save();
    return { points, credits, breakdown, unlocked, bestBefore, career };
  }

  // ------------------------------------------------------------------ dynamic difficulty
  /** the AI level Dynamic difficulty races at (≈0.72 … 1.03) */
  get aiSkill(): number {
    const v = this.data.aiSkill;
    return typeof v === 'number' && isFinite(v) ? Math.max(AI_SKILL.min, Math.min(AI_SKILL.max, v)) : AI_SKILL.start;
  }
  setAiSkill(v: number) {
    if (!isFinite(v)) return;
    this.data.aiSkill = Math.max(AI_SKILL.min, Math.min(AI_SKILL.max, v));
    this.save();
  }

  // ------------------------------------------------------------------ car development
  level(id: UpgradeId) {
    return this.data.upgrades[id] ?? 0;
  }
  canBuy(id: UpgradeId) {
    const n = this.level(id);
    return n < MAX_LEVEL && this.data.credits >= upgradeCost(n);
  }
  buy(id: UpgradeId): boolean {
    if (!this.canBuy(id)) return false;
    const n = this.level(id);
    this.data.credits -= upgradeCost(n);
    this.data.upgrades[id] = n + 1;
    this.save();
    return true;
  }
  /** the player's car: the base spec with every bought upgrade and the set-up */
  spec(): CarSpec {
    const s: CarSpec = { ...F1_SPEC, gears: F1_SPEC.gears.slice() };
    for (const u of UPGRADES) u.apply(s, this.level(u.id));
    for (const d of SETUP) d.apply(s, this.data.setup[d.id] ?? d.def);
    return s;
  }

  /** the car with only the set-up applied (a driver career's car: the team's level and R&D come on top) */
  setupSpec(): CarSpec {
    const s: CarSpec = { ...F1_SPEC, gears: F1_SPEC.gears.slice() };
    for (const d of SETUP) d.apply(s, this.data.setup[d.id] ?? d.def);
    return s;
  }

  setSetup(id: SetupId, v: number) {
    const d = SETUP.find((x) => x.id === id)!;
    this.data.setup[id] = Math.max(d.min, Math.min(d.max, Math.round(v)));
    this.save();
  }

  resetSetup() {
    this.data.setup = fresh().setup;
    this.save();
  }

  /** set-up read-outs for the garage: downforce, drag, balance (0..1 bars) and an estimated top speed */
  setupSummary() {
    const s = this.spec();
    const b = F1_SPEC;
    const vmax = Math.cbrt((2 * (s.power + s.ersBoost * 0.6)) / (1.2 * s.cdA)) * 3.6 * 0.92;
    return {
      downforce: THREE_CLAMP(0.5 + (s.clA / b.clA - 1) * 2.5),
      drag: THREE_CLAMP(0.5 + (s.cdA / b.cdA - 1) * 2.5),
      balance: s.aeroFront,
      topSpeed: Math.round(vmax),
    };
  }
  /** total development 0..1 (for the overall car rating) */
  development(): number {
    return UPGRADES.reduce((a, u) => a + this.level(u.id), 0) / (UPGRADES.length * MAX_LEVEL);
  }

  // ------------------------------------------------------------------ paint
  paintFor(team: number): Paint | null {
    return this.data.paint[team] ?? null;
  }
  setPaint(team: number, p: Paint | null) {
    if (p) this.data.paint[team] = { ...p };
    else delete this.data.paint[team];
    this.save();
  }

  /** the team as the player's car wears it (a derived Team with its own livery cache id) */
  static painted(team: Team, p: Paint | null): Team {
    if (!p) return team;
    const key = JSON.stringify([p.primary, p.secondary, p.accent, p.pattern, p.finish, p.carbon, p.halo, p.wing, p.rim, p.number, p.sponsor, p.helmet])
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase();
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    };
    const part = (v: PartPaint | undefined) =>
      !v || v === 'team' ? undefined : v === 'carbon' ? '#1b1c1f' : v === 'primary' ? p.primary : v === 'secondary' ? p.secondary : p.accent;
    return {
      ...team,
      id: `custom-${team.id}-${key}`,
      primary: p.primary,
      secondary: p.secondary,
      accent: p.accent,
      ink: lum(p.primary) > 0.6 ? '#111214' : '#ffffff',
      pattern: p.pattern,
      matte: p.finish === 'matte' ? 1 : p.finish === 'satin' ? 0.5 : p.finish === 'pearl' ? 0.25 : 0,
      metallic: p.finish === 'metallic' ? 0.65 : p.finish === 'pearl' ? 0.35 : p.finish === 'chrome' ? 1 : undefined,
      carbon: p.carbon ? CARBON.find((c) => c.id === p.carbon)!.amt : team.carbon,
      halo: part(p.halo),
      wing: part(p.wing),
      rim: !p.rim || p.rim === 'team' ? undefined : p.rim === 'accent' ? p.accent : p.rim,
      sponsor: p.sponsor?.trim() ? p.sponsor.trim().toUpperCase().slice(0, 10) : team.sponsor,
      ownSponsor: !!p.sponsor?.trim(),
    };
  }

  reset() {
    this.data = fresh();
    this.save();
  }
}
