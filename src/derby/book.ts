import type { StyleId } from '../marbles/ai-style.ts';

/**
 * The book: the stable of runners, your purse (saved in this browser), and the odds.
 *
 * Each runner has a hidden ability and a racing style; on the night it runs a little above or below
 * that (form on the day), and the course does the rest. The prices come from a Plackett–Luce model:
 * a runner's strength is exp(β · ability), and the chance it wins is its share of the field's
 * strength; the chance it finishes in the first three is that worked through every order of the
 * places above it. β was fitted to races run headless on each track (tools/derbysim.mjs), so a
 * price of 4.0× means it really does win about one race in four and a half, before the house
 * takes its cut.
 */

export interface Runner {
  id: number;
  name: string;
  design: number;
  skill: number;
  style: StyleId;
}

export const STABLE: Runner[] = [
  { id: 1, name: 'Glass Slipper', design: 9, skill: 0.95, style: 'racer' },
  { id: 2, name: 'Rolling Thunder', design: 6, skill: 0.92, style: 'bruiser' },
  { id: 3, name: 'Velvet Comet', design: 2, skill: 0.9, style: 'closer' },
  { id: 4, name: 'Neon Duchess', design: 3, skill: 0.88, style: 'daredevil' },
  { id: 5, name: 'Quicksilver', design: 17, skill: 0.86, style: 'racer' },
  { id: 6, name: 'Moonbeam', design: 14, skill: 0.84, style: 'steady' },
  { id: 7, name: 'Copper Penny', design: 16, skill: 0.82, style: 'closer' },
  { id: 8, name: 'Royal Flush', design: 0, skill: 0.8, style: 'bruiser' },
  { id: 9, name: 'Lucky Agate', design: 10, skill: 0.78, style: 'racer' },
  { id: 10, name: 'Sir Spinsalot', design: 8, skill: 0.76, style: 'daredevil' },
  { id: 11, name: 'Midnight Clatter', design: 12, skill: 0.74, style: 'steady' },
  { id: 12, name: 'Tumbleweed', design: 4, skill: 0.72, style: 'racer' },
  { id: 13, name: 'Big Shooter', design: 7, skill: 0.7, style: 'bruiser' },
  { id: 14, name: 'Cat’s Pyjamas', design: 1, skill: 0.68, style: 'daredevil' },
  { id: 15, name: 'Dizzy Dot', design: 11, skill: 0.66, style: 'closer' },
  { id: 16, name: 'Last Orders', design: 5, skill: 0.62, style: 'steady' },
];

/** a field's runners per race */
export const FIELD = 8;

/** β for each track: fitted to 150 races (49–50 a track) by tools/derbysim.mjs, 2026-10-19 */
export const BETA: Record<string, number> = { mile: 6.5, spiral: 6, cascade: 9 };
/** the house's cut: prices pay this share of fair odds */
export const MARGIN = 0.88;

export interface Probs {
  win: number[];
  top3: number[];
}

/** Plackett–Luce: the chance of winning, and of a top-three finish, for each runner */
export function probs(skills: number[], beta: number): Probs {
  const n = skills.length;
  const mean = skills.reduce((a, b) => a + b, 0) / n;
  const w = skills.map((s) => Math.exp(beta * (s - mean)));
  const W = w.reduce((a, b) => a + b, 0);
  const win = w.map((x) => x / W);
  const top3 = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let p = win[i];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const pj = win[j];
      const W1 = W - w[j];
      p += pj * (w[i] / W1);
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const pk = w[k] / W1;
        p += pj * pk * (w[i] / (W1 - w[k]));
      }
    }
    top3[i] = Math.min(1, p);
  }
  return { win, top3 };
}

/** a price (decimal: what a coin returns, the coin included), on a ladder of nice numbers */
export function price(p: number) {
  const fair = MARGIN / Math.max(p, 1e-4);
  const x = Math.max(1.05, fair);
  if (x < 2) return Math.round(x * 20) / 20;
  if (x < 5) return Math.round(x * 10) / 10;
  if (x < 10) return Math.round(x * 4) / 4;
  if (x < 30) return Math.round(x);
  return Math.round(x / 5) * 5;
}

export function fmtPrice(x: number) {
  return (x < 10 ? x.toFixed(x < 2 ? 2 : 1).replace(/0$/, '').replace(/\.$/, '') : String(Math.round(x))) + '×';
}

// ------------------------------------------------------------------------------------------ the purse
export interface Record_ {
  races: number;
  wins: number;
  top3: number;
  /** last five finishing places, newest last */
  form: number[];
}

export interface Purse {
  coins: number;
  race: number;
  /** biggest single return, the total won and staked */
  best: number;
  won: number;
  staked: number;
  bailouts: number;
  rec: Record<number, Record_>;
}

const KEY = 'derby.v1';
export const START_COINS = 1000;
export const BAILOUT = 250;

export function loadPurse(): Purse {
  const fresh: Purse = { coins: START_COINS, race: 0, best: 0, won: 0, staked: 0, bailouts: 0, rec: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as Partial<Purse>;
    return { ...fresh, ...p, rec: p.rec ?? {} };
  } catch {
    return fresh;
  }
}

export function savePurse(p: Purse) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* (a private window: not kept) */
  }
}

export function recOf(p: Purse, id: number): Record_ {
  return (p.rec[id] ??= { races: 0, wins: 0, top3: 0, form: [] });
}

/** a 1–5 rating from ability, for the race card */
export function stars(skill: number) {
  return Math.max(1, Math.min(5, Math.round((skill - 0.58) / 0.08)));
}
