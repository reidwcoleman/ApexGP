// Bluebird: every upgrade, its price curve and what it does.
import { LIFTS, RUNS, LIFT_BY, RUN_BY } from './mountain.ts';

export type Cat = 'lifts' | 'runs' | 'base' | 'fleet' | 'staff';

export interface Upgrade {
  id: string;
  cat: Cat;
  name: string;
  max: number; // highest level
  /** price to go from lv to lv + 1 */
  cost: (lv: number) => number;
  /** what the next level does (or what it does now when maxed) */
  blurb: (lv: number) => string;
  /** names of each level, index = level */
  levels?: string[];
  needs?: (lv: (id: string) => number) => string | null; // reason it's locked
  icon: string;
}

export interface ChairSpec { seats: number; speed: number; spacing: number; name: string }

/** chairlift levels (1 = bought) */
export const CHAIR: ChairSpec[] = [
  { seats: 0, speed: 0, spacing: 14, name: 'Not built' },
  { seats: 2, speed: 2.2, spacing: 14, name: 'Fixed double' },
  { seats: 3, speed: 2.4, spacing: 14, name: 'Fixed triple' },
  { seats: 4, speed: 2.6, spacing: 14, name: 'Fixed quad' },
  { seats: 4, speed: 4.6, spacing: 16, name: 'Detachable quad' },
  { seats: 6, speed: 5.0, spacing: 17, name: 'High-speed six' },
];
export const GONDOLA: ChairSpec[] = [
  { seats: 0, speed: 0, spacing: 40, name: 'Not built' },
  { seats: 8, speed: 5.0, spacing: 44, name: '8-seat cabins' },
  { seats: 8, speed: 6.0, spacing: 38, name: 'Faster haul rope' },
  { seats: 10, speed: 6.0, spacing: 34, name: '10-seat cabins' },
];
export const CARPET: ChairSpec[] = [
  { seats: 0, speed: 0, spacing: 3, name: 'Not built' },
  { seats: 1, speed: 0.9, spacing: 3.2, name: 'Rubber belt' },
  { seats: 1, speed: 1.2, spacing: 2.6, name: 'Covered carpet' },
  { seats: 2, speed: 1.4, spacing: 2.6, name: 'Twin carpet' },
];
export const liftSpecs = (kind: string) => (kind === 'gondola' ? GONDOLA : kind === 'carpet' ? CARPET : CHAIR);

/** visual/time compression for the lifts: they run this many times faster than their real speed */
export const LIFT_RUSH = 3;

export function liftCapacity(kind: string, lv: number) {
  const s = liftSpecs(kind)[lv];
  if (!s || !s.seats) return 0;
  return (s.seats * s.speed * 3600) / s.spacing; // skiers per hour (real speed)
}

const k = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n)));

export const PARKING = [0, 140, 380, 860, 1800, 3800];
export const LODGE_SEATS = [0, 60, 180, 420, 900, 1800];
export const HOTEL_ROOMS = [0, 40, 120, 300];
export const SNOWCAT = [
  { w: 0, speed: 0, name: '' },
  { w: 6.5, speed: 9, name: 'Second-hand groomer' },
  { w: 8, speed: 11, name: 'Winch-cat' },
  { w: 9.5, speed: 13, name: 'Twin-tiller' },
  { w: 11.5, speed: 15, name: 'Alpine flagship' },
];
export const SLED = [{ speed: 0, name: '' }, { speed: 21, name: 'Trail sled' }, { speed: 27, name: 'Mountain sled' }, { speed: 33, name: 'Race sled' }];
export const GUNS_PER_LV = 3;

export const UPGRADES: Upgrade[] = [];
const add = (u: Upgrade) => UPGRADES.push(u);

for (const l of LIFTS) {
  const specs = liftSpecs(l.kind);
  const max = specs.length - 1;
  add({
    id: 'lift.' + l.id, cat: 'lifts', name: l.name, max, icon: l.kind,
    levels: specs.map((s) => s.name),
    cost: (lv) => (lv === 0 ? l.cost : Math.round((l.cost || 6000) * [0, 0.7, 1.4, 2.6, 4.6][lv])),
    blurb: (lv) => {
      const nxt = specs[Math.min(max, lv + 1)];
      const cap = Math.round(liftCapacity(l.kind, Math.min(max, lv + 1)));
      return lv === 0 ? `Build it: ${nxt.name}, ${cap.toLocaleString()} riders an hour` : lv >= max ? `${specs[lv].name}, ${Math.round(liftCapacity(l.kind, lv)).toLocaleString()} riders an hour` : `${nxt.name}: ${cap.toLocaleString()} riders an hour (now ${Math.round(liftCapacity(l.kind, lv)).toLocaleString()})`;
    },
    needs: (lv) => {
      if (l.id === 'summit' && !lv('lift.meadow')) return 'Build Meadow Chair first';
      if (l.id === 'ridge' && !lv('lift.summit')) return 'Build Summit Express first';
      if (l.id === 'gondola' && !lv('lift.summit')) return 'Build Summit Express first';
      return null;
    },
  });
}

for (const r of RUNS) {
  if (r.cost === 0) continue;
  add({
    id: 'run.' + r.id, cat: 'runs', name: r.name, max: 1, icon: r.diff,
    cost: () => r.cost,
    blurb: () => `Cut and open a ${r.diff === 'park' ? 'terrain park with five tabletops' : r.diff === 'double' ? 'double-black chute line' : r.diff + ' trail'}${r.glade ? ' through the trees' : ''}`,
    needs: (lv) => (lv('lift.' + r.needs) ? null : `Needs ${LIFT_BY[r.needs].name}`),
  });
}
for (const r of RUNS) {
  add({
    id: 'guns.' + r.id, cat: 'runs', name: `${r.name} snow guns`, max: 3, icon: 'gun',
    cost: (lv) => Math.round((3500 + r.w * 60) * [1, 2.2, 4.5][lv]),
    blurb: (lv) => `${(Math.min(3, lv + 1)) * GUNS_PER_LV} fan guns along the trail (now ${lv * GUNS_PER_LV})`,
    needs: (lv) => (r.cost === 0 || lv('run.' + r.id) ? null : `Open ${r.name} first`),
  });
}

add({ id: 'lodge', cat: 'base', name: 'Base lodge', max: 5, icon: 'lodge',
  levels: ['None', 'Warming hut', 'Cafeteria', 'Timber lodge', 'Grand lodge', 'Alpine hall'],
  cost: (lv) => [0, 14000, 55000, 180000, 640000][lv] ?? 0,
  blurb: (lv) => `${LODGE_SEATS[Math.min(5, lv + 1)]} seats for lunch, hot cocoa and chili (now ${LODGE_SEATS[lv]})` });
add({ id: 'parking', cat: 'base', name: 'Parking', max: 5, icon: 'car',
  levels: ['', 'Gravel lot', 'Paved lot', 'Second lot', 'Parking deck', 'Shuttle network'],
  cost: (lv) => [0, 9000, 32000, 120000, 420000][lv] ?? 0,
  blurb: (lv) => `Room for ${PARKING[Math.min(5, lv + 1)].toLocaleString()} visitors a day (now ${PARKING[lv].toLocaleString()})` });
add({ id: 'rental', cat: 'base', name: 'Rental shop', max: 4, icon: 'ski',
  cost: (lv) => [8000, 26000, 90000, 300000][lv] ?? 0,
  blurb: (lv) => `${[0, 18, 26, 34, 42][Math.min(4, lv + 1)]}% of visitors rent skis at $${[0, 28, 34, 42, 52][Math.min(4, lv + 1)]}` });
add({ id: 'school', cat: 'base', name: 'Ski school', max: 3, icon: 'school',
  cost: (lv) => [16000, 70000, 260000][lv] ?? 0,
  blurb: (lv) => `Lessons for ${[0, 8, 13, 18][Math.min(3, lv + 1)]}% of visitors and more beginners come back` ,
  needs: (lv) => (lv('lodge') ? null : 'Build a lodge first') });
add({ id: 'hotel', cat: 'base', name: 'Slopeside hotel', max: 3, icon: 'hotel',
  cost: (lv) => [240000, 700000, 2000000][lv] ?? 0,
  blurb: (lv) => `${HOTEL_ROOMS[Math.min(3, lv + 1)]} rooms: guests every night, skip the parking` ,
  needs: (lv) => (lv('lodge') >= 3 ? null : 'Needs a Timber lodge') });
add({ id: 'lights', cat: 'base', name: 'Night lighting', max: 1, icon: 'lamp',
  cost: () => 45000,
  blurb: () => 'Floodlights on the lower mountain: open 4 pm to 9 pm for night skiing',
  needs: (lv) => (lv('lift.meadow') ? null : 'Build Meadow Chair first') });

add({ id: 'snowcat', cat: 'fleet', name: 'Snowcat', max: 4, icon: 'cat',
  levels: SNOWCAT.map((s) => s.name),
  cost: (lv) => [0, 30000, 110000, 340000][lv] ?? 0,
  blurb: (lv) => { const s = SNOWCAT[Math.min(4, lv + 1)]; return `${s.name}: ${s.w} m tiller, ${Math.round(s.speed * 3.6)} km/h`; } });
add({ id: 'sled', cat: 'fleet', name: 'Snowmobile', max: 3, icon: 'sled',
  levels: SLED.map((s) => s.name),
  cost: (lv) => [0, 12000, 48000][lv] ?? 0,
  blurb: (lv) => { const s = SLED[Math.min(3, lv + 1)]; return `${s.name}: ${Math.round(s.speed * 3.6)} km/h top speed`; } });

add({ id: 'groomers', cat: 'staff', name: 'Night groomers', max: 4, icon: 'cat',
  cost: (lv) => [12000, 40000, 120000, 360000][lv] ?? 0,
  blurb: (lv) => `${Math.min(4, lv + 1)} driver${lv ? 's' : ''} groom the worst trail${lv ? 's' : ''} every night ($${(lv + 1) * 220}/day)` });
add({ id: 'mechanic', cat: 'staff', name: 'Lift mechanics', max: 3, icon: 'wrench',
  cost: (lv) => [9000, 36000, 110000][lv] ?? 0,
  blurb: (lv) => `Broken lifts fixed in ${[0, 50, 30, 15][Math.min(3, lv + 1)]} minutes without you, fewer breakdowns` });
add({ id: 'patrol', cat: 'staff', name: 'Ski patrol', max: 3, icon: 'cross',
  cost: (lv) => [8000, 30000, 95000][lv] ?? 0,
  blurb: (lv) => `Patrollers reach hurt skiers in ${[0, 45, 25, 12][Math.min(3, lv + 1)]} minutes when you can't` });
add({ id: 'snowmakers', cat: 'staff', name: 'Snowmaking crew', max: 1, icon: 'gun',
  cost: () => 26000,
  blurb: () => 'Every gun switches itself on when a night is cold enough' });
add({ id: 'marketing', cat: 'staff', name: 'Marketing', max: 3, icon: 'mega',
  cost: (lv) => [15000, 60000, 220000][lv] ?? 0,
  blurb: (lv) => `+${(Math.min(3, lv + 1)) * 12}% more visitors every day` });

export const UP_BY: Record<string, Upgrade> = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));
export { k as short };

export type Weather = 'bluebird' | 'cloudy' | 'flurries' | 'snow' | 'storm' | 'warm';
export const WEATHER: Record<Weather, { name: string; icon: string; snow: number; demand: number; temp: [number, number]; cloud: number; wind: number }> = {
  bluebird: { name: 'Bluebird', icon: 'sun', snow: 0, demand: 1.25, temp: [-6, -1], cloud: 0, wind: 0.1 },
  cloudy: { name: 'Overcast', icon: 'cloud', snow: 0, demand: 1, temp: [-7, -3], cloud: 0.8, wind: 0.25 },
  flurries: { name: 'Flurries', icon: 'flake', snow: 1.2, demand: 0.95, temp: [-9, -5], cloud: 0.75, wind: 0.3 },
  snow: { name: 'Snowing', icon: 'snow', snow: 3.2, demand: 0.85, temp: [-10, -6], cloud: 0.95, wind: 0.45 },
  storm: { name: 'Storm', icon: 'storm', snow: 6, demand: 0, temp: [-14, -9], cloud: 1, wind: 1 },
  warm: { name: 'Spring sun', icon: 'sun', snow: 0, demand: 1.15, temp: [-2, 6], cloud: 0.1, wind: 0.05 },
};

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const OPEN = 8.5, CLOSE = 16, NIGHT_CLOSE = 21;

export { RUN_BY, LIFT_BY };
