import { F1_SPEC, type CarSpec } from '../sim/CarPhysics.ts';
import { POINTS } from '../race/Race.ts';
import { CIRCUITS } from '../world/Circuits.ts';
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

export type Finish = 'gloss' | 'satin' | 'matte' | 'metallic';
export const FINISHES: { id: Finish; name: string }[] = [
  { id: 'gloss', name: 'Gloss' },
  { id: 'satin', name: 'Satin' },
  { id: 'matte', name: 'Matte' },
  { id: 'metallic', name: 'Metallic' },
];

export interface Paint {
  primary: string;
  secondary: string;
  accent: string;
  pattern: LiveryPattern;
  finish: Finish;
}

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
}

export interface RaceReward {
  points: number;
  credits: number;
  breakdown: { label: string; credits: number }[];
  /** circuit id unlocked by this result */
  unlocked: string | null;
  bestBefore: number | null;
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
  isUnlocked(id: string): boolean {
    const i = CIRCUITS.findIndex((c) => c.id === id);
    if (i <= 0) return true;
    const prev = this.data.best[CIRCUITS[i - 1].id];
    return prev !== undefined && prev <= UNLOCK_POS;
  }
  unlockedCircuits() {
    return CIRCUITS.filter((c) => this.isUnlocked(c.id));
  }

  // ------------------------------------------------------------------ results
  /** record a finished race; returns what it earned */
  recordRace(track: string, pos: number, dnf: boolean, fastest: boolean, team: number, field: number): RaceReward {
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
      d.best[track] = Math.min(d.best[track] ?? 99, pos);
    }
    d.history.unshift({ track, pos, dnf, points, credits, team, date: Date.now() });
    d.history.length = Math.min(d.history.length, 40);
    const unlocked = this.unlockedCircuits().find((c) => !wasUnlocked.has(c.id))?.id ?? null;
    this.save();
    return { points, credits, breakdown, unlocked, bestBefore };
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
    const key = `${p.primary}${p.secondary}${p.accent}${p.pattern}${p.finish}`.replace(/#/g, '');
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    };
    return {
      ...team,
      id: `custom-${team.id}-${key}`,
      primary: p.primary,
      secondary: p.secondary,
      accent: p.accent,
      ink: lum(p.primary) > 0.6 ? '#111214' : '#ffffff',
      pattern: p.pattern,
      matte: p.finish === 'matte' ? 1 : p.finish === 'satin' ? 0.5 : 0,
      metallic: p.finish === 'metallic' ? 0.65 : undefined,
    };
  }

  reset() {
    this.data = fresh();
    this.save();
  }
}
