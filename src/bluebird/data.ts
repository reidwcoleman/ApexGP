// Bluebird Peak: everything you can buy. Every item levels up with a growing price; hitting a milestone
// level (10, 25, 50, 100) doubles what it does. The resort runs itself; your job is to spend well.
import { LIFTS, RUNS, LIFT_BY, RUN_BY } from './mountain.ts';

export type Cat = 'lifts' | 'trails' | 'village' | 'fun' | 'snow' | 'crew';

export const MILESTONES = [10, 25, 50, 100, 150, 200];
export const mult = (lv: number) => { let m = 1; for (const s of MILESTONES) if (lv >= s) m *= 2; return m; };
export const nextMilestone = (lv: number) => MILESTONES.find((s) => s > lv) ?? 0;
export const prevMilestone = (lv: number) => [...MILESTONES].reverse().find((s) => s <= lv) ?? 0;

export interface Item {
  id: string;
  cat: Cat;
  name: string;
  icon: string;
  max: number;
  build: number; // price of level 1 (0 = you own it from the start)
  base: number; // price of level 2
  growth: number;
  /** resort level needed to build */
  needLv?: number;
  /** another item that must exist first */
  needs?: string;
  /** one line: what a level gives */
  unit: string;
  color: string;
}

export const CHAIR_TIERS = ['', 'Fixed double', 'Fixed triple', 'Fixed quad', 'Detachable quad', 'High-speed six'];
export const GONDOLA_TIERS = ['', '8-seat cabins', 'Faster haul rope', '10-seat cabins'];
export const CARPET_TIERS = ['', 'Rubber belt', 'Covered carpet', 'Twin carpet'];
/** visual tier from a level: 1 below 10, 2 from 10, 3 from 25, 4 from 50, 5 from 100 */
export const tierOf = (lv: number, max = 5) => (lv <= 0 ? 0 : Math.min(max, 1 + MILESTONES.filter((m) => m <= lv).length));

const LIFT_CAP: Record<string, number> = { carpet: 500, meadow: 900, summit: 1300, ridge: 1300, gondola: 2600 };
const LIFT_LV: Record<string, number> = { carpet: 1, meadow: 2, summit: 5, ridge: 10, gondola: 14 };
const LIFT_BUILD: Record<string, number> = { carpet: 0, meadow: 2500, summit: 60000, ridge: 1500000, gondola: 12000000 };
const RUN_APPEAL: Record<string, number> = { green: 30, blue: 48, black: 44, double: 52, park: 62 };
const RUN_BUILD: Record<string, number> = { bunny: 0, meadowlark: 1500, fox: 4000, park: 40000, bowl: 80000, widow: 150000, longhaul: 400000, glade: 2000000, chutes: 3000000 };
const RUN_LV: Record<string, number> = { fox: 3, park: 6, widow: 6, longhaul: 8, glade: 10, chutes: 11 };

export const ITEMS: Item[] = [];
for (const l of LIFTS) {
  const b = LIFT_BUILD[l.id];
  ITEMS.push({ id: 'lift.' + l.id, cat: 'lifts', name: l.name, icon: l.kind === 'chair' ? 'chair' : l.kind, max: 200, build: b, base: Math.max(300, b * 0.15), growth: 1.17, needLv: LIFT_LV[l.id], needs: l.id === 'summit' ? 'lift.meadow' : l.id === 'ridge' || l.id === 'gondola' ? 'lift.summit' : undefined, unit: 'riders an hour', color: { carpet: '#2f7fe0', meadow: '#2f7fe0', summit: '#d2453a', ridge: '#e0a63a', gondola: '#2fb65a' }[l.id]! });
}
for (const r of RUNS) {
  const b = RUN_BUILD[r.id];
  ITEMS.push({ id: 'run.' + r.id, cat: 'trails', name: r.name, icon: r.diff, max: 200, build: b, base: Math.max(150, b * 0.15), growth: 1.17, needLv: RUN_LV[r.id], needs: 'lift.' + r.needs, unit: 'appeal', color: { green: '#2fb65a', blue: '#2f7fe0', black: '#1d1d22', double: '#1d1d22', park: '#f08a24' }[r.diff] });
}
ITEMS.push(
  { id: 'lodge', cat: 'village', name: 'Base lodge', icon: 'lodge', max: 200, build: 0, base: 250, growth: 1.17, unit: 'spent per visitor', color: '#8a5a3b' },
  { id: 'parking', cat: 'village', name: 'Parking', icon: 'car', max: 200, build: 0, base: 200, growth: 1.17, unit: 'visitors a day', color: '#55606e' },
  { id: 'rental', cat: 'village', name: 'Rental shop', icon: 'ski', max: 200, build: 1200, base: 400, growth: 1.18, needLv: 2, unit: 'per visitor', color: '#9a3f32' },
  { id: 'school', cat: 'village', name: 'Ski school', icon: 'school', max: 200, build: 15000, base: 3000, growth: 1.2, needLv: 5, unit: 'more visitors', color: '#e0a63a' },
  { id: 'hotel', cat: 'village', name: 'Slopeside hotel', icon: 'hotel', max: 200, build: 500000, base: 40000, growth: 1.2, needLv: 9, unit: 'a night', color: '#3d4f66' },
  { id: 'lights', cat: 'village', name: 'Night skiing', icon: 'lamp', max: 1, build: 80000, base: 0, growth: 1, needLv: 7, needs: 'lift.meadow', unit: '', color: '#f2b33d' },
  { id: 'tubing', cat: 'fun', name: 'Tubing hill', icon: 'tube', max: 200, build: 120000, base: 16000, growth: 1.19, needLv: 6, unit: 'per guest', color: '#e0457b' },
  { id: 'rink', cat: 'fun', name: 'Ice rink', icon: 'skate', max: 200, build: 300000, base: 32000, growth: 1.19, needLv: 7, unit: 'per guest', color: '#3fb7c9' },
  { id: 'summithut', cat: 'fun', name: 'Summit restaurant', icon: 'cup', max: 200, build: 900000, base: 90000, growth: 1.2, needLv: 9, needs: 'lift.summit', unit: 'per guest', color: '#8a5a3b' },
  { id: 'spa', cat: 'fun', name: 'Hot springs spa', icon: 'spa', max: 200, build: 4000000, base: 380000, growth: 1.2, needLv: 11, needs: 'hotel', unit: 'per guest', color: '#6a4cc2' },
  { id: 'heli', cat: 'fun', name: 'Heli-skiing', icon: 'heli', max: 200, build: 15000000, base: 1400000, growth: 1.21, needLv: 13, unit: 'flights a day', color: '#23262b' },
  { id: 'fleet', cat: 'snow', name: 'Snowcat fleet', icon: 'cat', max: 8, build: 0, base: 4000, growth: 4, unit: 'snowcats', color: '#d2453a' },
  { id: 'catpower', cat: 'snow', name: 'Grooming crews', icon: 'cat', max: 200, build: 0, base: 200, growth: 1.18, unit: 'groomed a night', color: '#d2453a' },
  { id: 'snowmaking', cat: 'snow', name: 'Snowmaking', icon: 'gun', max: 40, build: 3000, base: 2000, growth: 1.25, needLv: 3, unit: 'snow guns', color: '#3fb7c9' },
  { id: 'mechanic', cat: 'crew', name: 'Lift mechanics', icon: 'wrench', max: 200, build: 800, base: 600, growth: 1.2, needLv: 2, unit: 'breakdowns', color: '#55606e' },
  { id: 'marketing', cat: 'crew', name: 'Marketing', icon: 'mega', max: 200, build: 2500, base: 1500, growth: 1.2, needLv: 3, unit: 'more visitors', color: '#8b2f56' },
  { id: 'service', cat: 'crew', name: 'Guest services', icon: 'star', max: 200, build: 8000, base: 5000, growth: 1.25, needLv: 5, unit: 'rating', color: '#f2b33d' },
);
export const ITEM_BY: Record<string, Item> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

/** price of the level after `lv` */
export function priceOf(it: Item, lv: number) {
  if (lv === 0) return it.build;
  return Math.round(it.base * Math.pow(it.growth, lv - 1));
}
/** total price and count for buying `want` levels (or as many as cash allows when want = Infinity) */
export function bulk(it: Item, lv: number, want: number, cash: number) {
  let n = 0, total = 0;
  while (n < want && lv + n < it.max) {
    const p = priceOf(it, lv + n);
    if (want === Infinity && total + p > cash) break;
    total += p; n++;
  }
  return { n, total };
}

// ------------------------------------------------------------------ what each item does
export function liftCap(id: string, lv: number) { return lv <= 0 ? 0 : Math.round(LIFT_CAP[id] * (1 + 0.1 * (lv - 1)) * mult(lv)); }
export function runAppeal(id: string, lv: number) { return lv <= 0 ? 0 : RUN_APPEAL[RUN_BY[id].diff] * (1 + 0.1 * (lv - 1)) * mult(lv); }
export const lodgeSpend = (lv: number) => 3 + 0.45 * lv;
export const lodgeSeats = (lv: number) => (30 + 18 * lv) * mult(lv);
export const parkingCap = (lv: number) => Math.round((70 + 30 * (lv - 1)) * mult(lv));
export const rentalSpend = (lv: number) => (lv <= 0 ? 0 : 4 + 0.6 * lv);
export const schoolBoost = (lv: number) => (lv <= 0 ? 0 : 0.05 + 0.025 * lv);
export const hotelRooms = (lv: number) => (lv <= 0 ? 0 : Math.round(10 * lv * mult(lv)));
export const marketingBoost = (lv: number) => (lv <= 0 ? 0 : 0.04 * lv);
export const serviceStars = (lv: number) => (lv <= 0 ? 0 : Math.min(0.6, 0.04 * lv));
export const catRate = (lv: number) => 7000 * (1 + 0.08 * Math.max(0, lv - 1)) * mult(Math.max(1, lv)); // m² an hour per cat
export const gunsOf = (lv: number) => lv * 2;
export const breakChance = (mech: number) => 0.035 * Math.pow(0.94, mech);
export const fixMinutes = (mech: number) => Math.max(6, 60 * Math.pow(0.93, mech));
/** attractions: extra spend per visit, and the share of guests who go */
export const FUN_SPEND: Record<string, [number, number]> = { tubing: [6, 0.9], rink: [7, 1.0], summithut: [12, 1.6], spa: [22, 2.6] };
export const FUN_SHARE: Record<string, number> = { tubing: 0.3, rink: 0.35, summithut: 0.45, spa: 0.2 };
export const funSpend = (id: string, lv: number) => (lv <= 0 ? 0 : (FUN_SPEND[id][0] + FUN_SPEND[id][1] * (lv - 1)) * mult(lv));
export const heliFlights = (lv: number) => (lv <= 0 ? 0 : Math.round((6 + 2 * (lv - 1)) * mult(lv)));
export const HELI_FARE = 1400;

export function itemEffect(it: Item, lv: number): string {
  const id = it.id;
  const n = (v: number) => (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e4 ? Math.round(v / 1e3) + 'k' : Math.round(v).toLocaleString());
  if (id.startsWith('lift.')) return `${n(liftCap(id.slice(5), lv))} riders/h`;
  if (id.startsWith('run.')) return `${n(runAppeal(id.slice(4), lv))} appeal`;
  switch (id) {
    case 'lodge': return `$${lodgeSpend(lv).toFixed(1)} per guest · ${n(lodgeSeats(lv))} seats`;
    case 'parking': return `${n(parkingCap(lv))} cars a day`;
    case 'rental': return `$${rentalSpend(lv).toFixed(1)} per guest`;
    case 'school': return `+${Math.round(schoolBoost(lv) * 100)}% visitors`;
    case 'hotel': return `${n(hotelRooms(lv))} rooms`;
    case 'lights': return lv ? 'Open until 9 pm' : 'Open until 9 pm (+30% guests)';
    case 'fleet': return `${Math.max(1, lv)} snowcat${Math.max(1, lv) > 1 ? 's' : ''}`;
    case 'catpower': return `${n(catRate(lv) / 1000)}k m²/h per cat`;
    case 'snowmaking': return `${gunsOf(lv)} snow guns`;
    case 'mechanic': return `fixes in ${Math.round(fixMinutes(lv))} min`;
    case 'marketing': return `+${Math.round(marketingBoost(lv) * 100)}% visitors`;
    case 'service': return `+${serviceStars(lv).toFixed(2)} stars`;
    case 'tubing': case 'rink': case 'summithut': case 'spa': return `$${n(funSpend(id, lv))} a visit`;
    case 'heli': return `${heliFlights(lv)} flights a day`;
  }
  return '';
}

// ------------------------------------------------------------------ resort levels (from lifetime guests)
export const xpFor = (lv: number) => Math.round((80 * (Math.pow(1.38, lv - 1) - 1)) / 0.38);
export function levelFromXp(xp: number) { let lv = 1; while (xpFor(lv + 1) <= xp) lv++; return lv; }
export const levelReward = (lv: number) => 150 * lv;

// ------------------------------------------------------------------ goals
export interface Goal { id: string; text: string; reward: number; check: (g: GoalCtx) => number /* progress 0..1 */ }
export interface GoalCtx { lv: (id: string) => number; day: number; best: number; stars: number; resortLv: number; cash: number; runs: number; lifts: number; lifetime: number; events: number; bestIncome: number; minRunLv: number }
const lvGoal = (id: string, n: number, reward: number, text?: string): Goal => ({ id: `${id}@${n}`, text: text ?? `${ITEM_BY[id].name} to level ${n}`, reward, check: (g) => g.lv(id) / n });
const build = (id: string, reward: number): Goal => ({ id: 'build:' + id, text: `Build ${ITEM_BY[id].name}`, reward, check: (g) => (g.lv(id) > 0 ? 1 : 0) });
export const GOALS: Goal[] = [
  lvGoal('run.bunny', 5, 150, 'Polish Sprout Slope to level 5'),
  lvGoal('parking', 5, 200),
  build('lift.meadow', 500),
  lvGoal('lodge', 10, 600, 'Lodge level 10 (doubles spending)'),
  { id: 'best@150', text: 'Host 150 skiers in a day', reward: 800, check: (g) => g.best / 150 },
  build('rental', 600),
  lvGoal('run.meadowlark', 10, 900),
  build('run.fox', 1000),
  { id: 'stars@3', text: 'Reach a 3-star rating', reward: 1200, check: (g) => g.stars / 3 },
  build('snowmaking', 1500),
  build('fleet', 2500),
  build('lift.summit', 6000),
  build('run.bowl', 8000),
  lvGoal('lift.meadow', 25, 8000, 'Meadow Chair to 25 (quad chair)'),
  { id: 'best@600', text: 'Host 600 skiers in a day', reward: 10000, check: (g) => g.best / 600 },
  build('lights', 12000),
  build('school', 12000),
  build('run.park', 15000),
  { id: 'stars@4', text: 'Reach a 4-star rating', reward: 25000, check: (g) => g.stars / 4 },
  build('run.longhaul', 40000),
  build('hotel', 60000),
  { id: 'best@1500', text: 'Host 1,500 skiers in a day', reward: 80000, check: (g) => g.best / 1500 },
  build('lift.ridge', 150000),
  lvGoal('lodge', 50, 150000, 'Lodge level 50'),
  build('lift.gondola', 600000),
  { id: 'stars@4.8', text: 'Reach a 4.8-star rating', reward: 800000, check: (g) => g.stars / 4.8 },
  { id: 'best@5000', text: 'Host 5,000 skiers in a day', reward: 1000000, check: (g) => g.best / 5000 },
  lvGoal('lift.gondola', 50, 2500000),
  { id: 'best@15000', text: 'Host 15,000 skiers in a day', reward: 6000000, check: (g) => g.best / 15000 },
];
GOALS.splice(9, 0, { id: 'ev@1', text: 'Host your first event', reward: 1500, check: (g) => g.events });
GOALS.splice(18, 0, build('tubing', 20000));
GOALS.splice(23, 0, build('rink', 40000), { id: 'ev@10', text: 'Host 10 events', reward: 60000, check: (g) => g.events / 10 });
GOALS.splice(29, 0, build('summithut', 120000));
GOALS.push(build('spa', 900000), build('heli', 3000000));

// ------------------------------------------------------------------ events you can host
export interface EventDef {
  id: string; name: string; icon: string; blurb: string;
  needLv: number; needs?: string;
  /** entry fee and prize, in seconds of current income (with a floor for the fee) */
  costSec: number; rewardSec: number; floor: number;
  guestMul: number; buzz: number; cooldown: number;
  /** how it shows on the mountain */
  fx: 'banner' | 'jam' | 'race' | 'torch' | 'fireworks';
  run?: string; night?: boolean;
}
export const EVENTS: EventDef[] = [
  { id: 'retro', name: 'Retro Ski Day', icon: 'ski', blurb: 'Neon onesies and 80s music. The locals love it.', needLv: 2, costSec: 50, rewardSec: 170, floor: 300, guestMul: 1.3, buzz: 0.03, cooldown: 2, fx: 'banner' },
  { id: 'railjam', name: 'Rail Jam', icon: 'park', blurb: 'Riders battle on Kicker Alley in front of a crowd.', needLv: 5, needs: 'run.park', costSec: 90, rewardSec: 330, floor: 2500, guestMul: 1.35, buzz: 0.08, cooldown: 3, fx: 'jam', run: 'park' },
  { id: 'slalom', name: 'Slalom Cup', icon: 'flag', blurb: 'Gates down Widowmaker, racers from three states.', needLv: 6, needs: 'run.widow', costSec: 140, rewardSec: 520, floor: 6000, guestMul: 1.4, buzz: 0.1, cooldown: 3, fx: 'race', run: 'widow' },
  { id: 'torch', name: 'Torchlight Parade', icon: 'flame', blurb: 'Instructors ski Meadowlark at dusk with flares.', needLv: 7, needs: 'lights', costSec: 130, rewardSec: 480, floor: 9000, guestMul: 1.5, buzz: 0.1, cooldown: 3, fx: 'torch', run: 'meadowlark', night: true },
  { id: 'fireworks', name: 'Fireworks Night', icon: 'spark', blurb: 'A show over the village after the lifts close.', needLv: 8, costSec: 200, rewardSec: 700, floor: 15000, guestMul: 1.45, buzz: 0.15, cooldown: 4, fx: 'fireworks', night: true },
  { id: 'freeride', name: 'Freeride Tour', icon: 'double', blurb: 'The pros drop into Eagle Chutes, live on TV.', needLv: 10, needs: 'run.chutes', costSec: 320, rewardSec: 1300, floor: 120000, guestMul: 1.55, buzz: 0.2, cooldown: 5, fx: 'race', run: 'chutes' },
  { id: 'festival', name: 'Winter Festival', icon: 'spark', blurb: 'Bands on the plaza, food trucks, fireworks at night.', needLv: 11, needs: 'hotel', costSec: 500, rewardSec: 2100, floor: 400000, guestMul: 1.8, buzz: 0.2, cooldown: 6, fx: 'fireworks', night: true },
  { id: 'worldcup', name: 'World Cup Downhill', icon: 'trophy', blurb: 'The world tour comes to Long Haul. TV rights pay big.', needLv: 14, needs: 'lift.gondola', costSec: 1000, rewardSec: 4600, floor: 3000000, guestMul: 2.2, buzz: 0.3, cooldown: 7, fx: 'race', run: 'longhaul' },
];
export const EVENT_BY: Record<string, EventDef> = Object.fromEntries(EVENTS.map((e) => [e.id, e]));

// ------------------------------------------------------------------ Legend: start a new season with a permanent boost
/** Legend stars earned by everything this resort has made */
export const legendFor = (earned: number) => Math.floor(Math.sqrt(Math.max(0, earned) / 4e6));
export const legendMul = (stars: number) => 1 + 0.25 * stars;
export const LEGEND_LV = 12;

export type Weather = 'bluebird' | 'cloudy' | 'flurries' | 'snow' | 'storm' | 'warm';
export const WEATHER: Record<Weather, { name: string; icon: string; snow: number; demand: number; temp: [number, number]; cloud: number; wind: number }> = {
  bluebird: { name: 'Bluebird', icon: 'sun', snow: 0, demand: 1.25, temp: [-6, -1], cloud: 0, wind: 0.1 },
  cloudy: { name: 'Overcast', icon: 'cloud', snow: 0, demand: 1, temp: [-7, -3], cloud: 0.8, wind: 0.25 },
  flurries: { name: 'Flurries', icon: 'flake', snow: 1.2, demand: 0.95, temp: [-9, -5], cloud: 0.75, wind: 0.3 },
  snow: { name: 'Snowing', icon: 'snow', snow: 3.2, demand: 0.85, temp: [-10, -6], cloud: 0.95, wind: 0.45 },
  storm: { name: 'Storm', icon: 'storm', snow: 6, demand: 0.45, temp: [-14, -9], cloud: 1, wind: 1 },
  warm: { name: 'Spring sun', icon: 'sun', snow: 0, demand: 1.15, temp: [-2, 6], cloud: 0.1, wind: 0.05 },
};

export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const OPEN = 8.5, CLOSE = 16, NIGHT_CLOSE = 21;

/** chairlift visuals still used by the 3D lifts */
export interface ChairSpec { seats: number; speed: number; spacing: number; name: string }
export const CHAIR: ChairSpec[] = [
  { seats: 0, speed: 0, spacing: 14, name: '' },
  { seats: 2, speed: 2.2, spacing: 14, name: 'Fixed double' },
  { seats: 3, speed: 2.4, spacing: 14, name: 'Fixed triple' },
  { seats: 4, speed: 2.6, spacing: 14, name: 'Fixed quad' },
  { seats: 4, speed: 4.6, spacing: 16, name: 'Detachable quad' },
  { seats: 6, speed: 5.0, spacing: 17, name: 'High-speed six' },
];
export const GONDOLA: ChairSpec[] = [
  { seats: 0, speed: 0, spacing: 40, name: '' },
  { seats: 8, speed: 5.0, spacing: 44, name: '8-seat cabins' },
  { seats: 8, speed: 6.0, spacing: 38, name: 'Faster haul rope' },
  { seats: 10, speed: 6.0, spacing: 34, name: '10-seat cabins' },
];
export const CARPET: ChairSpec[] = [
  { seats: 0, speed: 0, spacing: 3, name: '' },
  { seats: 1, speed: 0.9, spacing: 3.2, name: 'Rubber belt' },
  { seats: 1, speed: 1.2, spacing: 2.6, name: 'Covered carpet' },
  { seats: 2, speed: 1.4, spacing: 2.6, name: 'Twin carpet' },
];
export const liftSpecs = (kind: string) => (kind === 'gondola' ? GONDOLA : kind === 'carpet' ? CARPET : CHAIR);
export const LIFT_RUSH = 3;
export const PARKING = [0, 140, 380, 860, 1800, 3800];
export const SNOWCAT_LOOK = [{ w: 0 }, { w: 6.5 }, { w: 8 }, { w: 9.5 }, { w: 11.5 }];

export { RUN_BY, LIFT_BY };
