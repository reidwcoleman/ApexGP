// Bluebird Peak: the resort runs itself. Clock, weather, visitors and money; a snowcat fleet that grooms
// trails worst-first every night; snow guns that switch on when it's cold; mechanics who fix lifts. You
// decide what to buy. The snow state (groom/powder/depth per 3 m cell) drives the terrain shader.
import { Mountain, RUNS, LIFTS, SN, SC, HALF, RUN_BY, LIFT_BY } from './mountain.ts';
import {
  ITEM_BY, ITEMS, priceOf, bulk, WEATHER, type Weather, OPEN, CLOSE, NIGHT_CLOSE, DAY_NAMES, liftCap, runAppeal, lodgeSpend, lodgeSeats, parkingCap,
  rentalSpend, schoolBoost, hotelRooms, marketingBoost, serviceStars, catRate, gunsOf, breakChance, fixMinutes, tierOf, levelFromXp, levelReward, xpFor, GOALS, type GoalCtx,
} from './data.ts';

export interface Gun { id: string; run: string; k: number; x: number; z: number; dx: number; dz: number }
export interface DayStats { visitors: number; night: number; tickets: number; lodge: number; rental: number; school: number; hotel: number; bonus: number; starsStart: number }
const emptyDay = (stars: number): DayStats => ({ visitors: 0, night: 0, tickets: 0, lodge: 0, rental: 0, school: 0, hotel: 0, bonus: 0, starsStart: stars });

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
  history: { day: number; visitors: number; income: number; stars: number }[];
  today: DayStats;
  lastSeen: number;
  tut: number;
  lifetime: number;
  earned: number;
  resortLv: number;
  claimed: string[];
  best: number;
  rate: number; // smoothed income per real second (offline earnings, ETAs)
}

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
  | { k: 'broken'; lift: string };

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
      this.s = save;
      this.unpackSnow(save.snow);
    } else {
      this.s = {
        v: 2, name: 'Bluebird Peak', cash: 1500, t: 7.8, stars: 2.6, buzz: 0, price: 30, autoPrice: true,
        lv: { 'lift.carpet': 1, 'run.bunny': 1, lodge: 1, parking: 1, fleet: 1, catpower: 1 },
        weather: ['bluebird', 'bluebird', 'cloudy', 'bluebird'], powderDay: false, snow: '', offDepth: 80,
        history: [], today: emptyDay(2.6), lastSeen: Date.now(), tut: 0, lifetime: 0, earned: 0, resortLv: 1, claimed: [], best: 0, rate: 0,
      };
      this.freshSnow();
    }
    this.measureRuns();
    this.planDay();
    if (this.grooming) this.startNight();
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

  earn(n: number, what: keyof DayStats) {
    if (!(n > 0)) return;
    this.s.cash += n; this.s.earned += n; (this.s.today as any)[what] += n;
    this.secEarn += n;
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
    const demand = appeal * (0.45 + 0.22 * s.stars) * (1 + marketingBoost(this.lv('marketing')) + schoolBoost(this.lv('school'))) * w.demand * weekday * (s.powderDay ? 1.45 : 1) * (1 + s.buzz) * priceMul;
    const parking = parkingCap(this.lv('parking')) + hotelRooms(this.lv('hotel')) * 1.6;
    let liftH = 0;
    for (const l of LIFTS) liftH += liftCap(l.id, this.lv('lift.' + l.id));
    const lifts = (liftH * 6.5) / 4;
    const visitors = Math.max(0, Math.min(demand, parking, lifts));
    const limit: 'demand' | 'parking' | 'lifts' = visitors >= demand - 0.5 ? 'demand' : parking <= lifts ? 'parking' : 'lifts';
    const perGuest = lodgeSpend(this.lv('lodge')) * Math.min(1, (lodgeSeats(this.lv('lodge')) * 4) / Math.max(1, visitors)) * 0.62 + rentalSpend(this.lv('rental')) * 0.35 + (this.lv('school') ? 6 * 0.12 : 0);
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
    this.plan = { demand: f.demand, visitors: keepV ? this.plan.visitors : f.visitors, parking: f.parking, lifts: f.lifts, night: keepV ? this.plan.night : night, price: s.price, fair: f.fair, perGuest: f.perGuest, limit: f.limit };
    this.forecastV = f.visitors + night;
  }
  forecastV = 0;
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

    const h = this.hour;
    const P = this.plan;
    const dA = this.arrived(h) - this.arrived(wrapped ? 0 : h0);
    if (dA > 0 && h < CLOSE) {
      const n = P.visitors * dA;
      s.today.visitors += n; this.gainXp(n);
      this.earn(n * P.price, 'tickets');
      this.earn(n * rentalSpend(this.lv('rental')) * 0.35, 'rental');
      if (this.lv('school')) this.earn(n * 0.12 * 6, 'school');
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
      this.earn(on * lodgeSpend(this.lv('lodge')) * seatK * (0.12 + 0.55 * lunch) * dh * (this.lunchRush > 0 ? 2 : 1), 'lodge');
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

  // ------------------------------------------------------------------ lifts break; mechanics fix them
  private liftTick(dh: number, on: number) {
    const mech = this.lv('mechanic');
    if (this.isOpen) {
      for (const l of LIFTS) {
        if (!this.liftBuilt(l.id) || this.broken[l.id] !== undefined || l.kind === 'carpet') continue;
        if (Math.random() < dh * breakChance(mech) * (0.5 + Math.min(1, on / 500))) {
          this.broken[l.id] = this.s.t;
          this.events.push({ k: 'broken', lift: l.id });
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
          const next = this.pickRun(busy);
          if (next < 0) { c.on = false; break; }
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
    const melt = T > 0 ? T * 0.45 * dt * (0.4 + 0.6 * smooth(7, 9, this.hour) * (1 - smooth(16, 18, this.hour))) : 0;
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
    const parts = { base: 0.6, snow: 1.7 * q, lifts: 1.0 * liftScore, food: 0.6 * food, variety: 0.55 * Math.min(1, (kinds.size + built.length / 4) / 6), service: serviceStars(this.lv('service')) };
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
    s.today = emptyDay(s.stars);
    this.broken = {};
    this.planDay();
    if (s.powderDay) this.events.push({ k: 'toast', text: 'Powder day! Fresh snow everywhere brings 45% more skiers', tone: 'good' });
    if (s.weather[0] === 'storm') this.events.push({ k: 'toast', text: 'Storm day: only the hardy few will come up', tone: 'info' });
  }
  private endDay() {
    const t = this.s.today;
    const income = t.tickets + t.lodge + t.rental + t.school + t.hotel + t.bonus;
    const visitors = Math.round(t.visitors + t.night);
    const best = visitors > this.s.best;
    if (best) this.s.best = visitors;
    this.s.history.push({ day: this.day, visitors, income, stars: this.s.stars });
    if (this.s.history.length > 30) this.s.history.shift();
    this.events.push({ k: 'dayend', day: this.day, visitors, income, stars: this.s.stars, best });
  }
  private hotelNight() {
    const rooms = hotelRooms(this.lv('hotel'));
    if (rooms) this.earn(Math.round(rooms * Math.min(1, 0.4 + this.s.stars * 0.12) * (60 + this.s.stars * 25)), 'hotel');
  }

  // ------------------------------------------------------------------ goals
  goalCtx(): GoalCtx {
    return { lv: (id) => this.lv(id), day: this.day, best: Math.max(this.s.best, Math.round(this.s.today.visitors + this.s.today.night)), stars: this.s.stars, resortLv: this.s.resortLv, cash: this.s.cash, runs: RUNS.filter((r) => this.runBuilt(r.id)).length, lifts: LIFTS.filter((l) => this.liftBuilt(l.id)).length, lifetime: this.s.lifetime };
  }
  activeGoals(n = 3) {
    const out: { g: (typeof GOALS)[number]; p: number }[] = [];
    const ctx = this.goalCtx();
    for (const g of GOALS) { if (this.s.claimed.includes(g.id)) continue; out.push({ g, p: Math.max(0, Math.min(1, g.check(ctx))) }); if (out.length >= n) break; }
    return out;
  }
  claim(id: string) {
    const g = GOALS.find((q) => q.id === id);
    if (!g || this.s.claimed.includes(id) || g.check(this.goalCtx()) < 1) return 0;
    this.s.claimed.push(id);
    const r = this.goalReward(g.reward);
    this.s.cash += r; this.s.earned += r;
    return r;
  }
  /** goals pay at least a minute and a bit of current income */
  goalReward(base: number) { return Math.round(Math.max(base, this.s.rate * 75)); }


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
