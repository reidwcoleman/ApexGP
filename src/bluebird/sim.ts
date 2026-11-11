// Bluebird Peak: the resort runs itself. Clock, weather, visitors and money; a snowcat fleet that grooms
// trails worst-first every night; snow guns that switch on when it's cold; mechanics who fix lifts. You
// decide what to buy. The snow state (groom/powder/depth per 3 m cell) drives the terrain shader.
import { Mountain, RUNS, LIFTS, SN, SC, HALF, RUN_BY, LIFT_BY } from './mountain.ts';
import {
  ITEM_BY, ITEMS, priceOf, bulk, WEATHER, type Weather, OPEN, CLOSE, NIGHT_CLOSE, DAY_NAMES, liftCap, runAppeal, lodgeSpend, lodgeSeats, parkingCap,
  rentalSpend, schoolBoost, hotelRooms, marketingBoost, serviceStars, catRate, gunsOf, breakChance, fixMinutes, tierOf, levelFromXp, levelReward, xpFor, GOALS, type GoalCtx,
  FUN_SHARE, funSpend, heliFlights, HELI_FARE, EVENTS, EVENT_BY, type EventDef, legendFor, legendMul, LEGEND_LV,
  RIVALS, rivalGuests, SPONSORS, type Contract,
  shuttleCap, daycareBoost, meltK, avalancheBoost, patrolStars, socialBuzz, promoK, BOOSTS, TROPHIES, type TrophyCtx,
} from './data.ts';

export interface Gun { id: string; run: string; k: number; x: number; z: number; dx: number; dz: number }
export interface DayStats { visitors: number; night: number; tickets: number; lodge: number; rental: number; school: number; hotel: number; fun: number; heli: number; events: number; bonus: number; starsStart: number }
const emptyDay = (stars: number): DayStats => ({ visitors: 0, night: 0, tickets: 0, lodge: 0, rental: 0, school: 0, hotel: 0, fun: 0, heli: 0, events: 0, bonus: 0, starsStart: stars });
export const INCOME_KEYS: [keyof DayStats, string, string][] = [
  ['tickets', 'Lift tickets', '#2f7fe0'], ['lodge', 'Food & drink', '#e0a63a'], ['rental', 'Rentals', '#9a3f32'], ['school', 'Ski school', '#f2b33d'],
  ['hotel', 'Hotel', '#3d4f66'], ['fun', 'Shops & attractions', '#e0457b'], ['heli', 'Heli-skiing', '#23262b'], ['events', 'Events', '#6a4cc2'], ['bonus', 'Bonuses', '#2fb65a'],
];
export interface GenGoal { id: string; kind: 'income' | 'guests' | 'runs' | 'events' | 'stars'; target: number; text: string }
export interface LiveEvent { id: string; day: number; state: 'booked' | 'live'; cost: number }

export interface SaveState {
  v: 2;
  name: string;
  cash: number;
  t: number;
  stars: number;
  buzz: number;
  price: number;
  autoPrice: boolean;
  lv: Record<string, number>;
  weather: Weather[];
  powderDay: boolean;
  snow: string;
  offDepth: number;
  history: { day: number; visitors: number; income: number; stars: number; parts?: Record<string, number> }[];
  today: DayStats;
  lastSeen: number;
  tut: number;
  lifetime: number;
  earned: number;
  resortLv: number;
  claimed: string[];
  best: number;
  rate: number; // smoothed income per real second (offline earnings, ETAs)
  event: LiveEvent | null;
  evReady: Record<string, number>; // day an event can run again
  evCount: number;
  legend: number;
  seasons: number;
  gen: GenGoal[];
  genN: number;
  bestIncome: number;
  passed: number; // rivals overtaken in the league
  deal: Contract | null; // a sponsor offer or a contract being worked on
  deals: number; // contracts completed
  trophies: string[];
  vips: number;
  boostsUsed: number;
  boostCd: Record<string, number>; // real seconds until each boost is ready again
  promoDay: number; // the day the radio promo runs
  happyUntil: number; // game time the happy hour ends
  sawPowder: boolean;
}
const FRESH_EXTRA = { event: null, evReady: {}, evCount: 0, legend: 0, seasons: 0, gen: [], genN: 0, bestIncome: 0, passed: 0, deal: null, deals: 0, trophies: [] as string[], vips: 0, boostsUsed: 0, boostCd: {} as Record<string, number>, promoDay: 0, happyUntil: 0, sawPowder: false };

export const money = (n: number, cents = false) => {
  const s = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e12) return `${s}$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${s}$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${s}$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e5) return `${s}$${(n / 1e3).toFixed(1)}k`;
  return `${s}$${n.toLocaleString(undefined, { maximumFractionDigits: cents ? 2 : 0 })}`;
};

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function cellHash(k: number) { let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }

function rollWeather(day: number, prev: Weather): Weather {
  const r = Math.random();
  if (day <= 3) return (['bluebird', 'bluebird', 'cloudy', 'bluebird'] as Weather[])[day] ?? 'bluebird';
  if (prev === 'storm') return r < 0.75 ? 'bluebird' : 'cloudy';
  if (r < 0.32) return 'bluebird';
  if (r < 0.52) return 'cloudy';
  if (r < 0.68) return 'flurries';
  if (r < 0.82) return 'snow';
  if (r < 0.88) return 'storm';
  return 'warm';
}

export type SimEvent =
  | { k: 'toast'; text: string; tone?: 'good' | 'bad' | 'info' }
  | { k: 'dayend'; day: number; visitors: number; income: number; stars: number; best: boolean }
  | { k: 'levelup'; lv: number; reward: number }
  | { k: 'bought'; id: string; lv: number; milestone: boolean }
  | { k: 'broken'; lift: string }
  | { k: 'event'; id: string; phase: 'live' | 'done'; payout?: number }
  | { k: 'league'; rival: string; rank: number; reward: number }
  | { k: 'deal'; phase: 'offer' | 'won' | 'lost'; text: string; reward: number }
  | { k: 'trophy'; id: string; name: string; reward: number };

/** a snowcat out on the snow at night */
export interface CatState { run: number; ptr: number; x: number; z: number; yaw: number; on: boolean }

export class Sim {
  s: SaveState;
  m: Mountain;
  groom = new Float32Array(SN * SN);
  powder = new Float32Array(SN * SN);
  depth = new Float32Array(SN * SN);
  dirA = new Float32Array(SN * SN);
  dirB = new Float32Array(SN * SN);
  dirty = true;
  speed = 1;
  paused = false;
  guns: Gun[] = [];
  gunOn = new Set<string>();
  broken: Record<string, number> = {};
  runQ: Record<string, number> = {};
  runDepth: Record<string, number> = {};
  runGroom: Record<string, number> = {};
  onRun: Record<string, number> = {};
  onMountain = 0;
  events: SimEvent[] = [];
  plan = { demand: 0, visitors: 0, parking: 0, lifts: 0, night: 0, price: 0, fair: 0, perGuest: 0, limit: 'demand' as 'demand' | 'parking' | 'lifts' };
  /** how busy each lift is: wanted rides / capacity */
  liftLoad: Record<string, number> = {};
  starParts = { base: 0.6, snow: 0, lifts: 0, food: 0, variety: 0, service: 0 };
  starTarget = 2.5;
  cats: CatState[] = [];
  private order: { cells: Uint32Array; a: Float32Array; b: Float32Array }[] = [];
  private snowT = 0;
  private lunchRush = 0;
  incomeLog: number[] = [];
  private secAcc = 0;
  private secEarn = 0;

  constructor(m: Mountain, save: SaveState | null) {
    this.m = m;
    this.buildGuns();
    this.buildOrder();
    if (save && save.v === 2) {
      this.s = { ...FRESH_EXTRA, ...save, today: { ...emptyDay(save.stars), ...save.today } };
      this.unpackSnow(save.snow);
    } else {
      this.s = Sim.freshState(0, 0);
      this.freshSnow();
    }
    this.measureRuns();
    this.planDay();
    if (this.grooming) this.startNight();
  }

  static freshState(legend: number, seasons: number): SaveState {
    return {
      v: 2, name: 'Bluebird Peak', cash: 1500 * (1 + legend), t: 7.8, stars: 2.6, buzz: 0, price: 30, autoPrice: true,
      lv: { 'lift.carpet': 1, 'run.bunny': 1, lodge: 1, parking: 1, fleet: 1, catpower: 1 },
      weather: ['bluebird', 'bluebird', 'cloudy', 'bluebird'], powderDay: false, snow: '', offDepth: 80,
      history: [], today: emptyDay(2.6), lastSeen: Date.now(), tut: seasons ? 9 : 0, lifetime: 0, earned: 0, resortLv: 1, claimed: [], best: 0, rate: 0,
      ...FRESH_EXTRA, legend, seasons,
    };
  }

  // ------------------------------------------------------------------ basics
  lv(id: string) { return this.s.lv[id] ?? 0; }
  vis(id: string, max = 5) { return tierOf(this.lv(id), max); }
  get day() { return Math.floor(this.s.t / 24) + 1; }
  get hour() { return this.s.t - Math.floor(this.s.t / 24) * 24; }
  get dow() { return (this.day - 1) % 7; }
  get dayName() { return DAY_NAMES[this.dow]; }
  get weather(): Weather { return this.s.weather[0]; }
  get closeHour() { return this.lv('lights') ? NIGHT_CLOSE : CLOSE; }
  get phase(): 'prep' | 'open' | 'evening' | 'night' {
    const h = this.hour;
    if (h >= 6 && h < OPEN) return 'prep';
    if (h >= OPEN && h < CLOSE) return 'open';
    if (h >= CLOSE && h < NIGHT_CLOSE && this.lv('lights')) return 'evening';
    return 'night';
  }
  get isOpen() { const p = this.phase; return p === 'open' || p === 'evening'; }
  get temp() {
    const w = WEATHER[this.weather];
    const dayK = 0.5 - 0.5 * Math.cos(((this.hour - 3) / 24) * Math.PI * 2);
    return w.temp[0] - 5 + (w.temp[1] + 1 - (w.temp[0] - 5)) * dayK;
  }
  get canMakeSnow() { return this.temp <= -2; }
  get grooming() { const h = this.hour; return h >= this.closeHour || h < 7; }
  /** real seconds per game hour: days play out, nights fly by */
  secPerHour() { const h = this.hour; return h >= 6.5 && h < this.closeHour + 0.5 ? 7 : 2.2; }

  runBuilt(id: string) { return this.lv('run.' + id) > 0 && this.lv('lift.' + RUN_BY[id].needs) > 0; }
  liftBuilt(id: string) { return this.lv('lift.' + id) > 0; }
  runOpen(id: string) {
    if (!this.runBuilt(id) || (this.runDepth[id] ?? 0) < 20) return false;
    if (this.phase === 'evening') return !!RUN_BY[id].lit;
    return true;
  }
  liftRunning(id: string) { return this.liftBuilt(id) && this.broken[id] === undefined; }

  get legendMul() { return legendMul(this.s.legend); }
  earn(n: number, what: keyof DayStats) {
    if (!(n > 0)) return;
    if (what !== 'bonus' && what !== 'events') n *= this.legendMul;
    this.s.cash += n; this.s.earned += n; (this.s.today as any)[what] += n;
    // one-off windfalls don't count toward the income rate (rewards scale off it)
    if (what !== 'bonus' && what !== 'events') this.secEarn += n;
  }

  // ------------------------------------------------------------------ the shop
  lockReason(id: string): string | null {
    const it = ITEM_BY[id];
    if (this.lv(id) > 0) return null;
    if (it.needs && !this.lv(it.needs)) return `Needs ${ITEM_BY[it.needs].name}`;
    if (it.needLv && this.s.resortLv < it.needLv) return `Resort level ${it.needLv}`;
    return null;
  }
  quote(id: string, want: number) {
    const it = ITEM_BY[id];
    const lv = this.lv(id);
    const b = bulk(it, lv, want, this.s.cash);
    if (want === Infinity && b.n === 0) return { n: lv < it.max ? 1 : 0, total: lv < it.max ? priceOf(it, lv) : 0, lv };
    return { ...b, lv };
  }
  buy(id: string, want = 1) {
    if (this.lockReason(id)) return false;
    const it = ITEM_BY[id];
    const q = this.quote(id, want);
    if (q.n <= 0 || q.lv >= it.max || q.total > this.s.cash) return false;
    this.s.cash -= q.total;
    const before = this.lv(id);
    this.s.lv[id] = before + q.n;
    if (id.startsWith('run.') && before === 0) this.freshTrail(id.slice(4));
    if (id.startsWith('lift.') && before === 0) {
      const l = LIFT_BY[id.slice(5)];
      const from = RUNS.filter((r) => r.from === l.to);
      if (from.length && !from.some((r) => this.lv('run.' + r.id))) {
        const cheap = [...from].sort((a, b) => ITEM_BY['run.' + a.id].build - ITEM_BY['run.' + b.id].build)[0];
        this.s.lv['run.' + cheap.id] = 1; this.freshTrail(cheap.id);
        this.events.push({ k: 'toast', text: `${cheap.name} was cut with the lift, on the house`, tone: 'good' });
      }
    }
    const after = this.lv(id);
    const milestone = before > 0 && tierOf(after, 9) > tierOf(before, 9);
    this.measureRuns();
    this.computeStars();
    this.planDay(true);
    this.events.push({ k: 'bought', id, lv: after, milestone });
    return true;
  }

  // ------------------------------------------------------------------ demand, capacity, price
  private forecast(price: number) {
    const s = this.s;
    let appeal = 12;
    for (const r of RUNS) if (this.runBuilt(r.id)) appeal += runAppeal(r.id, this.lv('run.' + r.id)) * ((this.runDepth[r.id] ?? 50) >= 20 ? 0.4 + 0.6 * (this.runQ[r.id] ?? 0.5) : 0.1);
    const runs = RUNS.filter((r) => this.runBuilt(r.id)).length;
    const fair = 16 + s.stars * 9 + runs * 2.5 + (this.liftBuilt('gondola') ? 10 : 0);
    // cheap tickets help a little; overpricing empties the car park fast
    const priceMul = price <= fair ? Math.min(1.45, Math.pow(fair / price, 1.1)) : Math.pow(fair / price, 4);
    const weekday = this.dow >= 5 ? 1.4 : this.dow === 4 ? 1.15 : 1;
    const w = WEATHER[this.weather];
    for (const id of Object.keys(FUN_SHARE)) if (this.lv(id)) appeal += 20 + this.lv(id) * 0.6;
    if (this.lv('heli')) appeal += 60 + this.lv('heli') * 1.5;
    const ev = this.eventToday;
    const demand = appeal * (0.45 + 0.22 * s.stars) * (1 + marketingBoost(this.lv('marketing')) + schoolBoost(this.lv('school')) + daycareBoost(this.lv('daycare'))) * w.demand * weekday * (s.powderDay ? 1.45 : 1) * (1 + s.buzz + socialBuzz(this.lv('social'))) * priceMul * (s.promoDay === this.day ? 1.35 : 1) * (w.snow > 0 ? 1 + avalancheBoost(this.lv('avalanche')) : 1) * (ev ? ev.guestMul : 1);
    const parking = parkingCap(this.lv('parking')) + hotelRooms(this.lv('hotel')) * 1.6 + shuttleCap(this.lv('shuttle'));
    let liftH = 0;
    for (const l of LIFTS) liftH += liftCap(l.id, this.lv('lift.' + l.id));
    const lifts = (liftH * 6.5) / 4;
    const visitors = Math.max(0, Math.min(demand, parking, lifts));
    const limit: 'demand' | 'parking' | 'lifts' = visitors >= demand - 0.5 ? 'demand' : parking <= lifts ? 'parking' : 'lifts';
    const perGuest = lodgeSpend(this.lv('lodge')) * Math.min(1, (lodgeSeats(this.lv('lodge')) * 4) / Math.max(1, visitors)) * 0.62 + rentalSpend(this.lv('rental')) * 0.35 + (this.lv('school') ? 6 * 0.12 : 0) + this.funPerGuest;
    return { demand, parking, lifts, visitors, fair, perGuest, limit };
  }
  planDay(keepToday = false) {
    const s = this.s;
    if (s.autoPrice && (!keepToday || this.hour < OPEN || this.hour >= this.closeHour)) {
      let best = s.price, bestRev = -1;
      for (let p = 5; p <= 2000; p *= 1.03) {
        const f = this.forecast(p);
        const rev = f.visitors * (p + f.perGuest);
        if (rev > bestRev) { bestRev = rev; best = Math.round(p); }
      }
      s.price = best;
    }
    const f = this.forecast(s.price);
    const night = this.lv('lights') ? f.visitors * 0.3 : 0;
    // once the gates are open the crowd is what it is (a price change today only shows in the forecast)
    const keepV = keepToday && this.hour >= OPEN && this.hour < this.closeHour;
    // once the gates are open, an upgrade can still pull a bigger crowd for the rest of the day
    const grow = keepV && s.price === this.plan.price ? Math.max(this.plan.visitors, f.visitors) : keepV ? this.plan.visitors : f.visitors;
    this.plan = { demand: f.demand, visitors: grow, parking: f.parking, lifts: f.lifts, night: keepV ? this.plan.night : night, price: s.price, fair: f.fair, perGuest: f.perGuest, limit: f.limit };
    this.forecastV = f.visitors + night;
  }
  forecastV = 0;
  get funPerGuest() { let v = 0; for (const [id, sh] of Object.entries(FUN_SHARE)) v += funSpend(id, this.lv(id)) * sh; return v; }
  /** the event running (or booked) for today */
  get eventToday(): EventDef | null { const e = this.s.event; return e && e.day === this.day ? EVENT_BY[e.id] : null; }
  previewPrice(p: number) { return this.forecast(p); }

  // ------------------------------------------------------------------ the clock
  update(dtReal: number) {
    this.secAcc += dtReal;
    if (this.secAcc >= 1) {
      this.incomeLog.push(this.secEarn / this.secAcc);
      if (this.incomeLog.length > 90) this.incomeLog.shift();
      this.secAcc = 0; this.secEarn = 0;
      const avg = this.incomeLog.reduce((a, b) => a + b, 0) / this.incomeLog.length;
      if (this.incomeLog.length > 20) this.s.rate = this.s.rate ? this.s.rate * 0.99 + avg * 0.01 : avg;
    }
    for (const k of Object.keys(this.s.boostCd)) this.s.boostCd[k] = Math.max(0, this.s.boostCd[k] - dtReal);
    this.trophyT -= dtReal;
    if (this.trophyT <= 0) { this.trophyT = 1; this.checkTrophies(); }
    if (this.paused) return;
    let left = dtReal * this.speed;
    let guard = 0;
    while (left > 1e-6 && guard++ < 600) {
      const sph = this.secPerHour();
      const dh = Math.min(left / sph, 1 / 60);
      left -= dh * sph;
      this.tick(dh);
    }
  }
  get perMinute() { if (!this.incomeLog.length) return 0; return (this.incomeLog.reduce((a, b) => a + b, 0) / this.incomeLog.length) * 60; }

  private arrived(h: number) { return smooth(8.2, 12.2, h); }
  private left(h: number) { return smooth(13.4, 16.0, h); }
  private nArr(h: number) { return smooth(16, 17.6, h); }
  private nLeft(h: number) { return smooth(19.4, 21, h); }

  /** advance game time quickly (used by tests and offline catch-up) */
  advance(hours: number) { let left = hours; while (left > 1e-6) { const d = Math.min(1 / 30, left); this.tick(d); left -= d; } }

  private tick(dh: number) {
    const s = this.s;
    const h0 = this.hour;
    s.t += dh;
    const h1 = this.hour;
    const wrapped = h1 < h0;
    const crossed = (x: number) => (wrapped ? h0 < x || h1 >= x : h0 < x && h1 >= x);
    if (crossed(6)) this.newDay();
    if (crossed(this.closeHour)) { this.endDay(); this.startNight(); }
    if (crossed(NIGHT_CLOSE)) this.hotelNight();
    if (crossed(7)) { this.cats.forEach((c) => (c.on = false)); this.gunOn.clear(); }
    if (crossed(OPEN) && this.s.event?.day === this.day && this.s.event.state === 'booked') { this.s.event.state = 'live'; this.events.push({ k: 'event', id: this.s.event.id, phase: 'live' }); }
    if (this.s.event && this.s.event.day === this.day && crossed(this.eventEnd(EVENT_BY[this.s.event.id]))) this.finishEvent();
    if (crossed(7.5)) this.offerDeal();
    if (Math.floor(h0 * 4) !== Math.floor(h1 * 4)) { this.checkDeal(false); this.checkLeague(); }

    const h = this.hour;
    const P = this.plan;
    const dA = this.arrived(h) - this.arrived(wrapped ? 0 : h0);
    if (dA > 0 && h < CLOSE) {
      const n = P.visitors * dA;
      s.today.visitors += n; this.gainXp(n);
      this.earn(n * P.price, 'tickets');
      this.earn(n * rentalSpend(this.lv('rental')) * 0.35, 'rental');
      if (this.lv('school')) this.earn(n * 0.12 * 6, 'school');
      this.earn(n * this.funPerGuest * (this.happy ? 2 : 1), 'fun');
      if (this.lv('heli')) this.earn(heliFlights(this.lv('heli')) * dA * HELI_FARE * (0.6 + this.s.stars * 0.1), 'heli');
    }
    let on = P.visitors * Math.max(0, this.arrived(h) - this.left(h));
    if (P.night) {
      const dN = this.nArr(h) - this.nArr(wrapped ? 0 : h0);
      if (dN > 0) { const n = P.night * dN; s.today.night += n; this.gainXp(n); this.earn(n * P.price * 0.5, 'tickets'); }
      on += P.night * Math.max(0, this.nArr(h) - this.nLeft(h));
    }
    this.onMountain = on;
    if (on > 0) {
      const lunch = Math.exp(-(((h - 12.4) / 1.3) ** 2));
      const seatK = Math.min(1, (lodgeSeats(this.lv('lodge')) * 4) / Math.max(1, P.visitors));
      this.earn(on * lodgeSpend(this.lv('lodge')) * seatK * (0.12 + 0.55 * lunch) * dh * (this.lunchRush > 0 || this.happy ? 2 : 1), 'lodge');
    }
    this.lunchRush = Math.max(0, this.lunchRush - dh);
    s.buzz = Math.max(0, s.buzz - dh * 0.01);

    this.groomTick(dh);
    this.snowTick(dh, on);
    this.liftTick(dh, on);
    if (this.isOpen || this.phase === 'prep') s.stars += (this.starTarget - s.stars) * Math.min(1, dh * 0.22);
  }

  private gainXp(n: number) {
    const s = this.s;
    s.lifetime += n;
    const lv = levelFromXp(s.lifetime);
    while (s.resortLv < lv) {
      s.resortLv++;
      const r = Math.round(Math.max(levelReward(s.resortLv), s.rate * 40));
      s.cash += r; s.earned += r;
      this.events.push({ k: 'levelup', lv: s.resortLv, reward: r });
    }
  }
  get xpProgress() { const a = xpFor(this.s.resortLv), b = xpFor(this.s.resortLv + 1); return { cur: this.s.lifetime - a, need: b - a, frac: Math.min(1, (this.s.lifetime - a) / (b - a)) }; }

  /** a bonus you clicked: `seconds` of income, with a floor so it matters early on */
  bonus(seconds: number) {
    const amt = Math.round(Math.max(80 + this.s.resortLv * 60, (this.perMinute / 60) * seconds, this.s.rate * seconds));
    this.earn(amt, 'bonus');
    return amt;
  }
  addBuzz(n: number) { this.s.buzz = Math.min(0.8, this.s.buzz + n); }
  lunchBoost(hours: number) { this.lunchRush = hours; }
  get lunchRushLeft() { return this.lunchRush; }

  // ------------------------------------------------------------------ lifts break; mechanics fix them
  private liftTick(dh: number, on: number) {
    const mech = this.lv('mechanic');
    for (const l of LIFTS) {
      const cap = this.liftRunning(l.id) ? liftCap(l.id, this.lv('lift.' + l.id)) : 0;
      let ride = 0;
      for (const r of RUNS) if (r.from === l.to) ride += (this.onRun[r.id] ?? 0) * 3;
      if (l.id === 'gondola' || l.id === 'summit') ride *= 0.5;
      this.liftLoad[l.id] = cap ? ride / cap : 0;
    }
    if (this.isOpen) {
      for (const l of LIFTS) {
        if (!this.liftBuilt(l.id) || this.broken[l.id] !== undefined || l.kind === 'carpet') continue;
        if (Math.random() < dh * breakChance(mech) * (0.5 + Math.min(1, on / 500))) {
          this.broken[l.id] = this.s.t;
          this.events.push({ k: 'broken', lift: l.id });
          if (this.s.deal?.state === 'active' && this.s.deal.kind === 'nobreak') this.dealDone(false);
        }
      }
    }
    for (const [id, t0] of Object.entries(this.broken)) {
      if (this.s.t - t0 > fixMinutes(mech) / 60) { delete this.broken[id]; this.events.push({ k: 'toast', text: `Mechanics have ${LIFT_BY[id].name} spinning again`, tone: 'info' }); }
    }
  }
  fixLeft(id: string) { const t0 = this.broken[id]; return t0 === undefined ? 0 : Math.max(0, fixMinutes(this.lv('mechanic')) - (this.s.t - t0) * 60); }
  rushCost() { return Math.max(100, Math.round(this.s.rate * 20)); }
  rushFix(id: string) {
    const c = this.rushCost();
    if (this.s.cash < c || this.broken[id] === undefined) return false;
    this.s.cash -= c; delete this.broken[id];
    return true;
  }

  // ------------------------------------------------------------------ the night shift
  private buildOrder() {
    const m = this.m;
    RUNS.forEach((r, ri) => {
      const p = m.runOf[r.id];
      const cells = m.cellsOf[ri];
      const key = new Float64Array(cells.length), a = new Float32Array(cells.length), b = new Float32Array(cells.length);
      cells.forEach((k, j) => {
        const x = ((k % SN) + 0.5) * SC - HALF, z = (((k / SN) | 0) + 0.5) * SC - HALF;
        const n = m.nearestOn(p, x, z);
        const band = Math.floor(p.s[n.i] / 9);
        key[j] = band * 1000 + (band % 2 ? -n.lat : n.lat);
        const a2 = Math.atan2(p.tz[n.i], p.tx[n.i]) * 2;
        a[j] = Math.cos(a2); b[j] = Math.sin(a2);
      });
      const idx = Array.from(cells.keys()).sort((i, j) => key[i] - key[j]);
      this.order.push({ cells: Uint32Array.from(idx.map((i) => cells[i])), a: Float32Array.from(idx.map((i) => a[i])), b: Float32Array.from(idx.map((i) => b[i])) });
    });
  }
  private startNight() {
    const n = Math.max(1, this.lv('fleet'));
    this.cats = [];
    const busy = new Set<number>();
    for (let i = 0; i < n; i++) {
      const run = this.pickRun(busy);
      if (run < 0) break;
      busy.add(run);
      this.cats.push({ run, ptr: 0, x: 0, z: 0, yaw: 0, on: true });
    }
    this.gunOn.clear();
    for (const g of this.builtGuns()) this.gunOn.add(g.id);
  }
  private pickRun(busy: Set<number>) {
    let best = -1, bg = 0.93;
    RUNS.forEach((r, ri) => { if (!busy.has(ri) && this.runBuilt(r.id) && (this.runGroom[r.id] ?? 0) < bg) { bg = this.runGroom[r.id]; best = ri; } });
    return best;
  }
  private groomTick(dh: number) {
    if (!this.grooming || !this.cats.length) return;
    const cellsPer = (catRate(this.lv('catpower')) * dh) / (SC * SC);
    const busy = new Set(this.cats.filter((c) => c.on).map((c) => c.run));
    for (const c of this.cats) {
      if (!c.on) continue;
      const o = this.order[c.run];
      let budget = cellsPer;
      while (budget > 0) {
        if (c.ptr >= o.cells.length) {
          busy.delete(c.run);
          let next = this.pickRun(busy);
          if (next < 0) {
            // everything is groomed: keep polishing a trail nobody else is on until morning
            const free = RUNS.map((r, ri) => ri).filter((ri) => this.runBuilt(RUNS[ri].id) && !busy.has(ri));
            if (!free.length) { c.on = false; break; }
            next = free[(Math.random() * free.length) | 0];
            budget = Math.min(budget, 1);
          }
          c.run = next; c.ptr = 0; busy.add(next);
          continue;
        }
        const k = o.cells[c.ptr];
        this.groom[k] = 1; this.powder[k] = 0; this.dirA[k] = o.a[c.ptr]; this.dirB[k] = o.b[c.ptr];
        if (this.depth[k] > 120) this.depth[k] -= 2;
        c.ptr++; budget--;
      }
      if (c.on && c.ptr > 0) {
        const k = o.cells[Math.min(o.cells.length - 1, c.ptr - 1)];
        const x = ((k % SN) + 0.5) * SC - HALF, z = (((k / SN) | 0) + 0.5) * SC - HALF;
        if (c.x || c.z) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz > 0.5) c.yaw = Math.atan2(dx, dz); }
        c.x = x; c.z = z;
      }
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------ snow
  private freshSnow() {
    for (let k = 0; k < SN * SN; k++) {
      const h = cellHash(k);
      this.depth[k] = 80 + h * 10;
      this.powder[k] = 0.75;
      this.groom[k] = 0;
      this.dirA[k] = 1; this.dirB[k] = 0;
    }
    this.freshTrail('bunny');
  }
  private freshTrail(rid: string) {
    const ri = RUNS.findIndex((r) => r.id === rid);
    const o = this.order[ri];
    o.cells.forEach((k, j) => { this.groom[k] = 0.95; this.powder[k] = 0; this.dirA[k] = o.a[j]; this.dirB[k] = o.b[j]; this.depth[k] = Math.max(this.depth[k], 60); });
    this.dirty = true;
  }
  private packSnow() {
    const cells: number[] = [];
    for (const list of this.m.cellsOf) for (const k of list) cells.push(k);
    const b = new Uint8Array(cells.length * 4);
    cells.forEach((k, i) => {
      b[i * 4] = Math.round(this.groom[k] * 255);
      b[i * 4 + 1] = Math.round(this.powder[k] * 255);
      b[i * 4 + 2] = Math.min(255, Math.round(this.depth[k]));
      b[i * 4 + 3] = Math.round(((Math.atan2(this.dirB[k], this.dirA[k]) + Math.PI) / (Math.PI * 2)) * 255);
    });
    let str = '';
    for (let i = 0; i < b.length; i += 8192) str += String.fromCharCode(...b.subarray(i, i + 8192));
    return btoa(str);
  }
  private unpackSnow(str: string) {
    for (let k = 0; k < SN * SN; k++) { this.depth[k] = this.s.offDepth + cellHash(k) * 10; this.powder[k] = 0.75; this.groom[k] = 0; this.dirA[k] = 1; this.dirB[k] = 0; }
    try {
      const bin = atob(str);
      let i = 0;
      for (const list of this.m.cellsOf) for (const k of list) {
        if (i * 4 + 3 >= bin.length) return;
        this.groom[k] = bin.charCodeAt(i * 4) / 255;
        this.powder[k] = bin.charCodeAt(i * 4 + 1) / 255;
        this.depth[k] = bin.charCodeAt(i * 4 + 2);
        const a = (bin.charCodeAt(i * 4 + 3) / 255) * Math.PI * 2 - Math.PI;
        this.dirA[k] = Math.cos(a); this.dirB[k] = Math.sin(a);
        i++;
      }
    } catch { this.freshSnow(); }
  }
  track(x: number, z: number, amt: number) {
    const k = this.m.cellAt(x, z);
    if (k < 0) return;
    if (this.powder[k] > 0.05) { this.powder[k] = Math.max(0, this.powder[k] - amt * 2.2); this.dirty = true; }
    if (this.groom[k] > 0) this.groom[k] = Math.max(0, this.groom[k] - amt * 0.25);
  }

  private buildGuns() {
    for (const p of this.m.runs) {
      const n = 9;
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.6) / (n + 0.2)) * p.len;
        const i = this.m.idxAt(p, s);
        const side = k % 2 ? 1 : -1;
        const off = p.def.w / 2 + 2;
        this.guns.push({ id: `${p.def.id}:${k}`, run: p.def.id, k, x: p.x[i] - p.tz[i] * off * side, z: p.z[i] + p.tx[i] * off * side, dx: p.tz[i] * side, dz: -p.tx[i] * side });
      }
    }
  }
  /** guns go up trail by trail, two per level */
  builtGuns(): Gun[] {
    let n = gunsOf(this.lv('snowmaking'));
    const out: Gun[] = [];
    const runs = RUNS.filter((r) => this.runBuilt(r.id));
    for (let k = 0; k < 9 && n > 0; k++) for (const r of runs) { if (n <= 0) break; const g = this.guns.find((q) => q.run === r.id && q.k === k); if (g) { out.push(g); n--; } }
    return out;
  }

  measureRuns() {
    RUNS.forEach((r, ri) => {
      const cells = this.m.cellsOf[ri];
      let q = 0, d = 0, g = 0;
      for (const k of cells) {
        const dep = this.depth[k];
        d += dep; g += this.groom[k];
        q += smooth(12, 45, dep) * (0.28 + 0.72 * Math.max(this.groom[k], this.powder[k] * 1.05));
      }
      const n = cells.length || 1;
      this.runQ[r.id] = Math.min(1, q / n);
      this.runDepth[r.id] = d / n;
      this.runGroom[r.id] = g / n;
    });
  }

  private snowTick(dh: number, on: number) {
    this.snowT += dh;
    if (this.snowT < 0.1) return;
    const dt = this.snowT;
    this.snowT = 0;
    const w = WEATHER[this.weather];
    const T = this.temp;
    const fall = w.snow * dt * (0.6 + 0.4 * Math.sin(this.s.t * 1.3) ** 2);
    const melt = T > 0 ? meltK(this.lv('snowfarm')) * T * 0.45 * dt * (0.4 + 0.6 * smooth(7, 9, this.hour) * (1 - smooth(16, 18, this.hour))) : 0;
    const open = RUNS.filter((r) => this.runOpen(r.id));
    const wsum = open.reduce((a, r) => a + r.w * 0.1 + 1, 0) || 1;
    for (const r of RUNS) this.onRun[r.id] = 0;
    for (const r of open) this.onRun[r.id] = (on * (r.w * 0.1 + 1)) / wsum;
    if (fall > 0 || melt > 0) {
      const pAdd = fall / 12;
      for (let k = 0; k < SN * SN; k++) {
        this.depth[k] = Math.max(0, this.depth[k] + fall - melt * (0.7 + 0.6 * cellHash(k)));
        if (fall > 0) { this.powder[k] = Math.min(1, this.powder[k] + pAdd); this.groom[k] *= 1 - Math.min(1, pAdd * 0.9); }
        if (melt > 0) this.powder[k] = Math.max(0, this.powder[k] - melt * 0.04);
      }
      this.s.offDepth = Math.max(10, this.s.offDepth + fall - melt);
      this.dirty = true;
    }
    RUNS.forEach((r, ri) => {
      const n = this.onRun[r.id];
      if (!n) return;
      const cells = this.m.cellsOf[ri];
      const area = cells.length * SC * SC;
      const wear = Math.min(0.35, (n / area) * 30 * dt * (r.diff === 'green' ? 0.75 : r.diff === 'park' ? 1.2 : 1));
      for (const k of cells) {
        const f = 0.45 + cellHash(k * 7 + 3) * 1.1;
        this.groom[k] = Math.max(0, this.groom[k] - wear * f * 0.55);
        this.powder[k] = Math.max(0, this.powder[k] - wear * f * 1.4);
      }
      this.dirty = true;
    });
    if (this.gunOn.size && this.canMakeSnow) {
      for (const g of this.guns) {
        if (!this.gunOn.has(g.id)) continue;
        const cx = g.x + g.dx * 14, cz = g.z + g.dz * 14, R = 17;
        const ci0 = Math.floor((cx - R + HALF) / SC), ci1 = Math.ceil((cx + R + HALF) / SC);
        const cj0 = Math.floor((cz - R + HALF) / SC), cj1 = Math.ceil((cz + R + HALF) / SC);
        for (let cj = Math.max(0, cj0); cj <= Math.min(SN - 1, cj1); cj++)
          for (let ci = Math.max(0, ci0); ci <= Math.min(SN - 1, ci1); ci++) {
            const d = Math.hypot((ci + 0.5) * SC - HALF - cx, (cj + 0.5) * SC - HALF - cz);
            if (d > R) continue;
            const k = cj * SN + ci;
            this.depth[k] = Math.min(240, this.depth[k] + 9 * (1 - d / R) * dt);
          }
      }
      this.dirty = true;
    }
    this.measureRuns();
    this.computeStars();
  }

  computeStars() {
    const built = RUNS.filter((r) => this.runBuilt(r.id));
    let q = 0, wsum = 0;
    for (const r of built) { const w = r.w * this.m.runOf[r.id].len; q += (this.runDepth[r.id] >= 20 ? this.runQ[r.id] : 0) * w; wsum += w; }
    q = wsum ? q / wsum : 0;
    const kinds = new Set(built.map((r) => (r.diff === 'double' ? 'black' : r.diff)));
    const P = this.plan;
    let cap = 0;
    for (const l of LIFTS) if (this.liftRunning(l.id)) cap += liftCap(l.id, this.lv('lift.' + l.id));
    const wantRides = Math.max(1, (Math.max(this.forecastV, P.visitors) / 6.5) * 4 * 0.9);
    const liftScore = Math.min(1, cap / wantRides);
    const food = Math.min(1, (lodgeSeats(this.lv('lodge')) * 4) / Math.max(1, Math.max(this.forecastV, P.visitors)));
    const parts = { base: 0.6, snow: 1.7 * q, lifts: 1.0 * liftScore, food: 0.6 * food, variety: 0.55 * Math.min(1, (kinds.size + built.length / 4) / 6), service: serviceStars(this.lv('service')) + patrolStars(this.lv('patrol')) };
    this.starParts = parts;
    this.starTarget = Math.max(0.5, Math.min(5, parts.base + parts.snow + parts.lifts + parts.food + parts.variety + parts.service - Object.keys(this.broken).length * 0.2));
  }

  // ------------------------------------------------------------------ days
  private newDay() {
    const s = this.s;
    const prevW = s.weather[0];
    s.weather.shift();
    while (s.weather.length < 4) s.weather.push(rollWeather(this.day + s.weather.length, s.weather[s.weather.length - 1] ?? prevW));
    s.powderDay = (prevW === 'snow' || prevW === 'storm') && s.weather[0] !== 'storm';
    // the hotel and evening events pay after the lifts close: fold them into yesterday's record
    const last = s.history[s.history.length - 1];
    if (last && last.day === this.day - 1) {
      last.income = this.todayIncome;
      for (const [k] of INCOME_KEYS) (last.parts ??= {})[k] = Math.round(s.today[k] as number);
      s.bestIncome = Math.max(s.bestIncome, last.income);
    }
    if (s.event && s.event.day < this.day) s.event = null;
    s.today = emptyDay(s.stars);
    this.broken = {};
    this.planDay();
    if (s.powderDay) this.events.push({ k: 'toast', text: 'Powder day! Fresh snow everywhere brings 45% more skiers', tone: 'good' });
    if (s.weather[0] === 'storm') this.events.push({ k: 'toast', text: 'Storm day: only the hardy few will come up', tone: 'info' });
  }
  private endDay() {
    const t = this.s.today;
    const income = this.todayIncome;
    const visitors = Math.round(t.visitors + t.night);
    const best = visitors > this.s.best;
    if (best) this.s.best = visitors;
    this.s.bestIncome = Math.max(this.s.bestIncome, income);
    const parts: Record<string, number> = {};
    for (const [k] of INCOME_KEYS) parts[k] = Math.round(t[k] as number);
    this.s.history.push({ day: this.day, visitors, income, stars: this.s.stars, parts });
    if (this.s.history.length > 30) this.s.history.shift();
    this.events.push({ k: 'dayend', day: this.day, visitors, income, stars: this.s.stars, best });
  }
  private hotelNight() {
    const rooms = hotelRooms(this.lv('hotel'));
    if (rooms) this.earn(Math.round(rooms * Math.min(1, 0.4 + this.s.stars * 0.12) * (60 + this.s.stars * 25)), 'hotel');
  }

  // ------------------------------------------------------------------ goals
  goalCtx(): GoalCtx {
    const built = RUNS.filter((r) => this.runBuilt(r.id));
    return {
      lv: (id) => this.lv(id), day: this.day, best: Math.max(this.s.best, Math.round(this.s.today.visitors + this.s.today.night)), stars: this.s.stars, resortLv: this.s.resortLv, cash: this.s.cash,
      runs: built.length, lifts: LIFTS.filter((l) => this.liftBuilt(l.id)).length, lifetime: this.s.lifetime, events: this.s.evCount, bestIncome: Math.max(this.s.bestIncome, this.todayIncome),
      minRunLv: built.length ? Math.min(...built.map((r) => this.lv('run.' + r.id))) : 0,
    };
  }
  get todayIncome() { const t = this.s.today; return t.tickets + t.lodge + t.rental + t.school + t.hotel + t.fun + t.heli + t.events + t.bonus; }
  private genCheck(g: GenGoal, c: GoalCtx) {
    switch (g.kind) {
      case 'income': return c.bestIncome / g.target;
      case 'guests': return c.best / g.target;
      case 'runs': return c.runs >= RUNS.length ? c.minRunLv / g.target : 0;
      case 'events': return c.events / g.target;
      case 'stars': return c.stars / g.target;
    }
  }
  /** once the hand-made goals run out, new ones keep coming, each a step past your records */
  private makeGoal(): GenGoal {
    const s = this.s, c = this.goalCtx();
    const nice = (v: number) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, v)))); return Math.ceil(v / p / 0.5) * 0.5 * p; };
    const kinds: GenGoal['kind'][] = ['income', 'guests', 'runs', 'events', 'income', 'guests'];
    let kind = kinds[s.genN % kinds.length];
    if (kind === 'runs' && c.runs < RUNS.length) kind = 'events';
    const id = 'gen:' + s.genN++;
    if (kind === 'income') { const t = nice(Math.max(c.bestIncome, 1000) * 1.6); return { id, kind, target: t, text: `Earn ${money(t)} in one day` }; }
    if (kind === 'guests') { const t = nice(Math.max(c.best, 100) * 1.4); return { id, kind, target: t, text: `Host ${t.toLocaleString()} skiers in a day` }; }
    if (kind === 'runs') { const t = Math.ceil((c.minRunLv + 1) / 25) * 25; return { id, kind, target: t, text: `Every trail to level ${t}` }; }
    const t = c.events + 3; return { id, kind: 'events', target: t, text: `Host ${t} events in total` };
  }
  activeGoals(n = 3) {
    const out: { g: { id: string; text: string; reward: number }; p: number }[] = [];
    const ctx = this.goalCtx();
    for (const g of GOALS) { if (this.s.claimed.includes(g.id)) continue; out.push({ g, p: Math.max(0, Math.min(1, g.check(ctx))) }); if (out.length >= n) return out; }
    while (this.s.gen.length < n - out.length) this.s.gen.push(this.makeGoal());
    for (const g of this.s.gen) { if (out.length >= n) break; out.push({ g: { id: g.id, text: g.text, reward: 0 }, p: Math.max(0, Math.min(1, this.genCheck(g, ctx))) }); }
    return out;
  }
  claim(id: string) {
    const ctx = this.goalCtx();
    let r = 0;
    const g = GOALS.find((q) => q.id === id);
    if (g) {
      if (this.s.claimed.includes(id) || g.check(ctx) < 1) return 0;
      this.s.claimed.push(id);
      r = this.goalReward(g.reward);
    } else {
      const gg = this.s.gen.find((q) => q.id === id);
      if (!gg || this.genCheck(gg, ctx) < 1) return 0;
      this.s.gen = this.s.gen.filter((q) => q !== gg);
      r = this.goalReward(0, 150);
    }
    this.s.cash += r; this.s.earned += r;
    return r;
  }
  /** goals pay at least a minute and a bit of current income */
  goalReward(base: number, sec = 75) { return Math.round(Math.max(base, this.s.rate * sec, base ? 0 : 1000)); }


  // ------------------------------------------------------------------ events
  eventLock(e: EventDef): string | null {
    if (this.s.resortLv < e.needLv) return `Resort level ${e.needLv}`;
    if (e.needs && !this.lv(e.needs)) return `Needs ${ITEM_BY[e.needs].name}`;
    if (this.s.event) return this.s.event.id === e.id ? (this.s.event.state === 'live' ? 'On now' : 'Booked') : 'One event at a time';
    const ready = this.s.evReady[e.id] ?? 0;
    if (this.day < ready) return `Ready on day ${ready}`;
    return null;
  }
  private incomeSec() { return Math.max(this.s.rate, this.perMinute / 60, 1); }
  eventCost(e: EventDef) { return Math.round(Math.max(e.floor, this.incomeSec() * e.costSec)); }
  eventPrize(e: EventDef) { return Math.round(Math.max(e.floor * 3.4, this.incomeSec() * e.rewardSec)); }
  eventEnd(e: EventDef) { return e.night ? Math.max(this.closeHour, 19.5) : this.closeHour; }
  /** today if there's still time, otherwise tomorrow */
  eventDay(e: EventDef) { return this.hour < Math.min(13, this.eventEnd(e) - 2) ? this.day : this.day + 1; }
  hostEvent(id: string) {
    const e = EVENT_BY[id];
    if (!e || this.eventLock(e)) return false;
    const cost = this.eventCost(e);
    if (this.s.cash < cost) return false;
    this.s.cash -= cost;
    const day = this.eventDay(e);
    const live = day === this.day && this.hour >= OPEN;
    this.s.event = { id, day, state: live ? 'live' : 'booked', cost };
    if (live) {
      // the crowd shows up for the rest of today
      const keep = this.plan.visitors;
      this.planDay(false);
      this.plan.visitors = Math.max(keep, this.plan.visitors);
      this.events.push({ k: 'event', id, phase: 'live' });
    } else this.planDay(true);
    return true;
  }
  private finishEvent() {
    const ev = this.s.event!;
    const e = EVENT_BY[ev.id];
    this.s.event = null;
    if (ev.state !== 'live') return;
    const prize = this.eventPrize(e);
    this.earn(prize, 'events');
    this.addBuzz(e.buzz);
    this.s.evCount++;
    this.s.evReady[e.id] = this.day + e.cooldown;
    this.events.push({ k: 'event', id: e.id, phase: 'done', payout: prize });
    this.planDay(true);
  }

  // ------------------------------------------------------------------ boosts
  get happy() { return this.s.happyUntil > this.s.t; }
  boostLeft(id: string) { return this.s.boostCd[id] ?? 0; }
  boostMax(id: string) { return (BOOSTS.find((b) => b.id === id)?.cooldown ?? 60) * promoK(this.lv('promo')); }
  /** fire a boost; returns a line for the toast, or null if it isn't ready */
  useBoost(id: string): string | null {
    if (this.boostLeft(id) > 0) return null;
    const s = this.s;
    if (id === 'promo') {
      if (s.promoDay >= this.day && this.hour < this.closeHour) return null;
      s.promoDay = this.hour < this.closeHour - 1 ? this.day : this.day + 1;
      this.planDay(true);
    } else if (id === 'happy') {
      s.happyUntil = s.t + 2;
    } else if (id === 'blitz') {
      const built = RUNS.map((r, ri) => ({ r, ri })).filter(({ r }) => this.runBuilt(r.id)).sort((a, b) => (this.runQ[a.r.id] ?? 0) - (this.runQ[b.r.id] ?? 0)).slice(0, 3);
      if (!built.length) return null;
      for (const { r, ri } of built) {
        const o = this.order[ri];
        o.cells.forEach((k, j) => { this.groom[k] = 1; this.powder[k] = 0; this.dirA[k] = o.a[j]; this.dirB[k] = o.b[j]; this.depth[k] = Math.max(this.depth[k], 45); });
        void r;
      }
      this.dirty = true;
      this.measureRuns();
      this.computeStars();
      s.boostCd[id] = this.boostMax(id); s.boostsUsed++;
      return `Fresh corduroy on ${built.map((b) => b.r.name).join(', ')}`;
    } else return null;
    s.boostCd[id] = this.boostMax(id);
    s.boostsUsed++;
    return id === 'promo' ? (s.promoDay === this.day ? 'Radio promo is on air: +35% guests today' : 'Radio promo booked for tomorrow') : 'Happy hour! Food, drinks and shops sell double for two hours';
  }

  // ------------------------------------------------------------------ trophies
  private trophyT = 1;
  trophyCtx(): TrophyCtx {
    const c = this.goalCtx();
    return {
      ...c, allRuns: RUNS.every((r) => this.runBuilt(r.id)), allLifts: LIFTS.every((l) => this.liftBuilt(l.id)), rank: this.rank, deals: this.s.deals, vips: this.s.vips,
      boosts: this.s.boostsUsed, seasons: this.s.seasons, powder: this.s.sawPowder, maxLv: Math.max(0, ...Object.values(this.s.lv)), earned: this.s.earned,
    };
  }
  private checkTrophies() {
    if (this.s.powderDay && this.isOpen) this.s.sawPowder = true;
    const c = this.trophyCtx();
    TROPHIES.forEach((t, i) => {
      if (this.s.trophies.includes(t.id) || !t.check(c)) return;
      this.s.trophies.push(t.id);
      const reward = Math.round(Math.max(300 * (i + 1), this.s.rate * 90));
      this.earn(reward, 'bonus');
      this.events.push({ k: 'trophy', id: t.id, name: t.name, reward });
    });
  }

  // ------------------------------------------------------------------ the league
  /** your league score: the best day in the last three, or today if it's already better */
  get leagueScore() {
    const recent = this.s.history.slice(-3).map((h) => h.visitors);
    return Math.max(Math.round(this.s.today.visitors + this.s.today.night), ...recent, 0);
  }
  standings() {
    const rows = RIVALS.map((r) => ({ name: r.name, guests: rivalGuests(r, this.day), you: false, color: r.color }));
    rows.push({ name: this.s.name, guests: this.leagueScore, you: true, color: '#f6bd47' });
    return rows.sort((a, b) => b.guests - a.guests);
  }
  get rank() { return this.standings().findIndex((r) => r.you) + 1; }
  /** the next rival above you */
  get nextRival() { const st = this.standings(); const i = st.findIndex((r) => r.you); return i > 0 ? st[i - 1] : null; }
  leagueReward(k: number) { return Math.round(Math.max(250 * (k + 1) * (k + 1), this.s.rate * 120)); }
  private checkLeague() {
    const score = this.leagueScore;
    while (this.s.passed < RIVALS.length && score > rivalGuests(RIVALS[this.s.passed], this.day)) {
      const r = RIVALS[this.s.passed];
      const reward = this.leagueReward(this.s.passed);
      this.s.passed++;
      this.earn(reward, 'bonus');
      this.addBuzz(0.05);
      this.events.push({ k: 'league', rival: r.name, rank: this.rank, reward });
    }
  }

  // ------------------------------------------------------------------ sponsor contracts
  private offerDeal() {
    const s = this.s;
    if (s.deal && s.deal.day >= this.day) return;
    s.deal = null;
    if (this.s.resortLv < 2) return;
    const built = RUNS.filter((r) => this.runBuilt(r.id));
    const kinds: Contract['kind'][] = ['guests', 'food', 'snow', 'nobreak', 'stars'].filter((k) => k !== 'nobreak' || LIFTS.some((l) => l.kind !== 'carpet' && this.liftBuilt(l.id))) as Contract['kind'][];
    const kind = kinds[(Math.random() * kinds.length) | 0];
    const sponsor = SPONSORS[(Math.random() * SPONSORS.length) | 0];
    const pay = (sec: number, floor: number) => Math.round(Math.max(floor, Math.max(this.s.rate, this.perMinute / 60) * sec));
    const nice = (v: number) => { const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(Math.max(1, v))) - 1)); return Math.ceil(v / p) * p; };
    let d: Contract;
    if (kind === 'guests') {
      const t = nice(Math.max(20, this.forecastV * 1.12));
      d = { sponsor, kind, text: `Host ${t.toLocaleString()} guests today`, target: t, day: this.day, until: this.closeHour, reward: pay(200, 600), state: 'offer' };
    } else if (kind === 'food') {
      const exp = this.plan.visitors * lodgeSpend(this.lv('lodge')) * 0.62 * Math.min(1, (lodgeSeats(this.lv('lodge')) * 4) / Math.max(1, this.plan.visitors));
      const t = nice(Math.max(100, exp * 1.2));
      d = { sponsor, kind, text: `Sell ${money(t)} of food and drink today`, target: t, day: this.day, until: this.closeHour, reward: pay(180, 500), state: 'offer' };
    } else if (kind === 'snow' && built.length) {
      const r = built.sort((a, b) => (this.runQ[a.id] ?? 0) - (this.runQ[b.id] ?? 0))[Math.min(built.length - 1, 1)];
      const t = Math.min(0.85, Math.max(0.5, Math.round(((this.runQ[r.id] ?? 0.6) - 0.08) * 20) / 20));
      d = { sponsor, kind, text: `Keep ${r.name} above ${Math.round(t * 100)}% snow until 3 pm`, target: t, run: r.id, day: this.day, until: 15, reward: pay(170, 500), state: 'offer' };
    } else if (kind === 'stars') {
      const t = Math.min(5, Math.round((this.s.stars + 0.15) * 10) / 10);
      d = { sponsor, kind, text: `Finish the day at ${t.toFixed(1)} stars or better`, target: t, day: this.day, until: this.closeHour, reward: pay(220, 700), state: 'offer' };
    } else {
      d = { sponsor, kind: 'nobreak', text: 'No lift breakdowns today', target: 0, day: this.day, until: this.closeHour, reward: pay(160, 500), state: 'offer' };
    }
    s.deal = d;
    this.events.push({ k: 'deal', phase: 'offer', text: `${d.sponsor} has a deal for you: ${d.text}`, reward: d.reward });
  }
  acceptDeal() { const d = this.s.deal; if (!d || d.state !== 'offer' || d.day !== this.day || this.hour >= Math.min(13, d.until - 1)) return false; d.state = 'active'; this.checkDeal(false); return true; }
  declineDeal() { if (this.s.deal?.state === 'offer') this.s.deal = null; }
  /** how far along the active contract is, 0..1 */
  dealProgress(): number {
    const d = this.s.deal, t = this.s.today;
    if (!d) return 0;
    switch (d.kind) {
      case 'guests': return (t.visitors + t.night) / d.target;
      case 'food': return t.lodge / d.target;
      case 'snow': return Math.min(1, Math.max(0, (this.hour - OPEN) / (d.until - OPEN)));
      case 'stars': return this.s.stars / d.target;
      case 'nobreak': return Math.min(1, Math.max(0, (this.hour - OPEN) / (d.until - OPEN)));
    }
  }
  private checkDeal(_force: boolean) {
    const d = this.s.deal;
    if (!d) return;
    if (d.state === 'offer') { if (d.day < this.day || this.hour >= 13) this.s.deal = null; return; }
    const t = this.s.today;
    const over = d.day < this.day || this.hour >= d.until;
    if (d.kind === 'guests' && t.visitors + t.night >= d.target) return this.dealDone(true);
    if (d.kind === 'food' && t.lodge >= d.target) return this.dealDone(true);
    if (d.kind === 'snow' && this.isOpen && (this.runQ[d.run!] ?? 0) < d.target) return this.dealDone(false);
    if (!over) return;
    if (d.kind === 'stars') return this.dealDone(this.s.stars >= d.target);
    this.dealDone(d.kind === 'snow' || d.kind === 'nobreak');
  }
  private dealDone(won: boolean) {
    const d = this.s.deal!;
    this.s.deal = null;
    if (won) { this.earn(d.reward, 'bonus'); this.s.deals++; this.addBuzz(0.03); }
    this.events.push({ k: 'deal', phase: won ? 'won' : 'lost', text: `${d.sponsor}: ${d.text}`, reward: won ? d.reward : 0 });
  }

  // ------------------------------------------------------------------ Legend
  get legendGain() { return Math.max(0, legendFor(this.s.earned) - 0); }
  get legendReady() { return this.s.resortLv >= LEGEND_LV && this.legendGain > 0; }
  /** start a new season: everything resets but Legend stars multiply all income for good */
  newSeason() {
    if (!this.legendReady) return false;
    const legend = this.s.legend + this.legendGain;
    const name = this.s.name;
    const keep = { trophies: this.s.trophies, vips: this.s.vips, boostsUsed: this.s.boostsUsed, deals: this.s.deals };
    this.s = Sim.freshState(legend, this.s.seasons + 1);
    Object.assign(this.s, keep);
    this.s.name = name;
    this.broken = {}; this.cats = []; this.gunOn.clear(); this.incomeLog = [];
    this.freshSnow();
    this.measureRuns();
    this.computeStars();
    this.planDay();
    return true;
  }

  offline(): number {
    const away = (Date.now() - (this.s.lastSeen || Date.now())) / 1000;
    if (away < 120 || !this.s.rate) return 0;
    const earned = Math.round(this.s.rate * Math.min(away, 3 * 3600) * 0.5);
    this.s.cash += earned; this.s.earned += earned;
    return earned;
  }

  save() {
    this.s.snow = this.packSnow();
    this.s.lastSeen = Date.now();
    return JSON.stringify(this.s);
  }
}

export { ITEMS };
