/** Persistent progress (coins, upgrades, mowers, the next lawn) in localStorage. */

const KEY = 'apexlawn.save.v1';

export type UpgradeId = 'speed' | 'width' | 'magnet' | 'value';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  max: number;
  base: number;
  grow: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'speed', name: 'Engine', desc: 'Mow faster', max: 8, base: 40, grow: 1.5 },
  { id: 'width', name: 'Wide deck', desc: 'Cut a wider stripe', max: 8, base: 55, grow: 1.55 },
  { id: 'magnet', name: 'Coin magnet', desc: 'Coins swoon from further away', max: 6, base: 30, grow: 1.5 },
  { id: 'value', name: 'Golden coins', desc: 'Every coin is worth more', max: 8, base: 70, grow: 1.6 },
];

export const upgradeCost = (u: UpgradeDef, level: number) => Math.round((u.base * Math.pow(u.grow, level)) / 5) * 5;

export interface MowerDef {
  id: string;
  name: string;
  tagline: string;
  price: number;
  kind: 'push' | 'rider';
  body: string;
  trim: string;
  speed: number;
  width: number;
  radius: number;
}

export const MOWERS: MowerDef[] = [
  { id: 'classic', name: 'Classic', tagline: 'Reliable and red', price: 0, kind: 'push', body: '#d92b1d', trim: '#22252b', speed: 3.0, width: 0.56, radius: 0.32 },
  { id: 'sprout', name: 'Sprout', tagline: 'Wider cut, mint green', price: 260, kind: 'push', body: '#2fbf8a', trim: '#e9ece6', speed: 3.5, width: 0.66, radius: 0.34 },
  { id: 'breeze', name: 'Breeze', tagline: 'Quick and sky blue', price: 800, kind: 'push', body: '#2f7fe0', trim: '#f4f6fa', speed: 4.2, width: 0.76, radius: 0.34 },
  { id: 'sunny', name: 'Sunny rider', tagline: 'Sit down, mow wide', price: 1800, kind: 'rider', body: '#f2b300', trim: '#22252b', speed: 4.8, width: 1.05, radius: 0.55 },
  { id: 'royal', name: 'Royal rider', tagline: 'Fit for a very big lawn', price: 4200, kind: 'rider', body: '#6d3fd6', trim: '#d9b24a', speed: 6.2, width: 1.4, radius: 0.62 },
];

export interface SaveData {
  coins: number;
  lawn: number;
  best: number;
  flowers: number;
  upgrades: Record<UpgradeId, number>;
  owned: string[];
  mower: string;
  sound: boolean;
  music: boolean;
  tutorial: boolean;
}

const fresh = (): SaveData => ({
  coins: 0,
  lawn: 1,
  best: 0,
  flowers: 0,
  upgrades: { speed: 0, width: 0, magnet: 0, value: 0 },
  owned: ['classic'],
  mower: 'classic',
  sound: true,
  music: true,
  tutorial: false,
});

export function loadSave(): SaveData {
  const s = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<SaveData>;
      Object.assign(s, j);
      s.upgrades = { ...fresh().upgrades, ...(j.upgrades ?? {}) };
      if (!s.owned.includes('classic')) s.owned.push('classic');
      if (!MOWERS.some((m) => m.id === s.mower)) s.mower = 'classic';
    }
  } catch {
    /* private window: play without saving */
  }
  return s;
}

export function writeSave(s: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* nothing to do */
  }
}

export const mowerDef = (id: string) => MOWERS.find((m) => m.id === id) ?? MOWERS[0];

/** What the current mower + upgrades actually do. */
export function stats(s: SaveData) {
  const m = mowerDef(s.mower);
  return {
    mower: m,
    speed: m.speed * (1 + 0.075 * s.upgrades.speed),
    width: m.width * (1 + 0.065 * s.upgrades.width),
    magnet: 1.5 + 0.8 * s.upgrades.magnet,
    coinValue: Math.round(5 * (1 + 0.3 * s.upgrades.value)),
  };
}
