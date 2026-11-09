// Bluebird: the resort's clock, money, visitors, weather, the snow on every trail and the things that
// go wrong (lift breakdowns, hurt skiers). The 3D side reads this; the jobs you do write to it.
import { Mountain, RUNS, LIFTS, SN, SC, HALF, RUN_BY, LIFT_BY, type RunDef } from './mountain.ts';
import { UP_BY, UPGRADES, WEATHER, type Weather, liftCapacity, PARKING, LODGE_SEATS, HOTEL_ROOMS, GUNS_PER_LV, OPEN, CLOSE, NIGHT_CLOSE, DAY_NAMES } from './data.ts';

export const SEC_PER_HOUR = 36; // real seconds per game hour at 1x

export interface Incident { id: number; run: string; x: number; z: number; t0: number; carried: boolean }
export interface Gun { id: string; run: string; k: number; x: number; z: number; dx: number; dz: number }

export interface DayStats {
  visitors: number; night: number;
  tickets: number; lodge: number; rental: number; school: number; hotel: number; tips: number;
  wages: number; ops: number; snowmaking: number; fuel: number; upgrades: number;
  rescues: number; repairs: number; groomed: number; starsStart: number;
}
const emptyDay = (stars: number): DayStats => ({ visitors: 0, night: 0, tickets: 0, lodge: 0, rental: 0, school: 0, hotel: 0, tips: 0, wages: 0, ops: 0, snowmaking: 0, fuel: 0, upgrades: 0, rescues: 0, repairs: 0, groomed: 0, starsStart: stars });

export interface SaveState {
  v: 1;
  name: string;
  cash: number;
  t: number; // game hours since day 1 00:00
  stars: number;
  buzz: number;
  price: number;
  lv: Record<string, number>;
  weather: Weather[]; // [today, tomorrow, +2, +3]
  powderDay: boolean;
  snow: string; // packed run cells
  offDepth: number;
  medals: Record<string, number>;
  best: Record<string, number>;
  history: { day: number; visitors: number; profit: number; stars: number }[];
  today: DayStats;
  lastSeen: number;
  tut: number;
  totalVisitors: number;
  guns: string[]; // ids switched on
}

export const money = (n: number, cents = false) => {
  const s = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e6) return `${s}$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 2)}M`;
  if (n >= 1e4 && !cents) return `${s}$${Math.round(n).toLocaleString()}`;
  return `${s}$${n.toLocaleString(undefined, { maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: 0 })}`;
};

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function cellHash(k: number) { let h = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }

function rollWeather(day: number, prev: Weather): Weather {
  const r = Math.random();
  if (day <= 2) return day === 1 ? 'bluebird' : 'cloudy';
  if (prev === 'storm') return r < 0.75 ? 'bluebird' : 'cloudy';
  if (r < 0.3) return 'bluebird';
  if (r < 0.5) return 'cloudy';
  if (r < 0.66) return 'flurries';
  if (r < 0.8) return 'snow';
  if (r < 0.88) return 'storm';
  return 'warm';
}

export type SimEvent =
  | { k: 'toast'; text: string; tone?: 'good' | 'bad' | 'info' }
  | { k: 'cash'; amount: number; x: number; z: number }
  | { k: 'summary'; day: number; stats: DayStats; stars: number; profit: number }
  | { k: 'newday'; day: number }
  | { k: 'broken'; lift: string }
  | { k: 'hurt'; inc: Incident }
  | { k: 'level'; id: string };

export class Sim {
  s: SaveState;
  m: Mountain;
  groom = new Float32Array(SN * SN);
  powder = new Float32Array(SN * SN);
  depth = new Float32Array(SN * SN);
  dirA = new Float32Array(SN * SN); // cos 2a
  dirB = new Float32Array(SN * SN); // sin 2a
  dirty = true;
  speed = 1;
  paused = false;
  guns: Gun[] = [];
  gunOn = new Set<string>();
  incidents: Incident[] = [];
  broken: Record<string, number> = {}; // lift id -> game time it broke
  runQ: Record<string, number> = {};
  runDepth: Record<string, number> = {};
  runGroom: Record<string, number> = {};
  onRun: Record<string, number> = {}; // skiers on each run (aggregate)
  onMountain = 0;
  waitMin = 0;
  starTarget = 3;
  demand = 0; // today's expected visitors
  nightDemand = 0;
  events: SimEvent[] = [];
  private nextId = 1;
  private acc = 0;
  private lastClosedSummary = -1;
  catHours = 0; // snowcat driving this tick (for fuel)
  playerBuzz = 0;

  constructor(m: Mountain, save: SaveState | null) {
    this.m = m;
    this.buildGuns();
    if (save && save.v === 1) {
      this.s = save;
      this.unpackSnow(save.snow);
      for (const g of save.guns ?? []) this.gunOn.add(g);
    } else {
      this.s = {
        v: 1, name: 'Bluebird Peak', cash: 12000, t: 7.75, stars: 2.6, buzz: 0, price: 39,
        lv: { 'lift.carpet': 1, lodge: 1, parking: 1, snowcat: 1, sled: 1 },
        weather: ['bluebird', 'cloudy', 'bluebird', 'flurries'], powderDay: false,
        snow: '', offDepth: 80, medals: {}, best: {}, history: [], today: emptyDay(2.6), lastSeen: Date.now(), tut: 0, totalVisitors: 0, guns: [],
      };
      this.freshSnow();
    }
    this.planDay();
    this.measureRuns();
  }

  // ------------------------------------------------------------------ helpers
  lv(id: string) { return this.s.lv[id] ?? 0; }
  get day() { return Math.floor(this.s.t / 24) + 1; }
  get hour() { return this.s.t - Math.floor(this.s.t / 24) * 24; }
  get dow() { return (this.day - 1) % 7; }
  get dayName() { return DAY_NAMES[this.dow]; }
  get weather(): Weather { return this.s.weather[0]; }
  get closedToday() { return this.weather === 'storm' || (this.dow === 1 && this.day > 2); }
  get closedReason() { return this.weather === 'storm' ? 'Storm day: lifts on wind hold' : this.dow === 1 && this.day > 2 ? 'Staff day: the mountain is yours' : ''; }
  get phase(): 'prep' | 'open' | 'evening' | 'night' {
    const h = this.hour;
    if (h >= 6 && h < OPEN) return 'prep';
    if (h >= OPEN && h < CLOSE) return 'open';
    if (h >= CLOSE && h < NIGHT_CLOSE && this.lv('lights')) return 'evening';
    return 'night';
  }
  get isOpen() { const p = this.phase; return !this.closedToday && (p === 'open' || p === 'evening'); }
  /** temperature now, °C */
  get temp() {
    const w = WEATHER[this.weather];
    const h = this.hour;
    const dayK = 0.5 - 0.5 * Math.cos(((h - 3) / 24) * Math.PI * 2); // 0 at 3 am, 1 at 3 pm
    return w.temp[0] - 5 + (w.temp[1] + 1 - (w.temp[0] - 5)) * dayK;
  }
  get daylight() { const h = this.hour; return smooth(6.2, 8, h) * (1 - smooth(16.4, 18, h)); }

  runBuilt(id: string) { const r = RUN_BY[id]; return (r.cost === 0 || this.lv('run.' + id) > 0) && this.lv('lift.' + r.needs) > 0; }
  liftBuilt(id: string) { return this.lv('lift.' + id) > 0; }
  runOpen(id: string) {
    if (!this.runBuilt(id)) return false;
    if ((this.runDepth[id] ?? 0) < 22) return false;
    if (this.phase === 'evening') return !!RUN_BY[id].lit;
    return true;
  }
  liftRunning(id: string) { return this.liftBuilt(id) && !this.broken[id]; }

  can(n: number) { return this.s.cash >= n; }
  spend(n: number, what: keyof DayStats = 'upgrades') { this.s.cash -= n; (this.s.today as any)[what] += n; }
  earn(n: number, what: keyof DayStats, x?: number, z?: number) {
    this.s.cash += n; (this.s.today as any)[what] += n;
    if (x !== undefined && z !== undefined) this.events.push({ k: 'cash', amount: n, x, z });
  }

  upgradeState(id: string) {
    const u = UP_BY[id];
    const lv = this.lv(id);
    const lock = u.needs ? u.needs((q) => this.lv(q)) : null;
    const cost = lv >= u.max ? 0 : u.cost(lv);
    return { u, lv, lock, cost, maxed: lv >= u.max, afford: this.can(cost) };
  }
  buy(id: string) {
    const st = this.upgradeState(id);
    if (st.maxed || st.lock || !st.afford) return false;
    this.spend(st.cost);
    this.s.lv[id] = st.lv + 1;
    // a new lift with nothing to ski from its top gets its easiest trail cut for free
    if (id.startsWith('lift.') && st.lv === 0) {
      const l = LIFT_BY[id.slice(5)];
      const from = RUNS.filter((r) => r.from === l.to);
      if (from.length && !from.some((r) => this.runBuilt(r.id))) {
        const cheap = [...from].sort((a, b) => a.cost - b.cost)[0];
        if (cheap.cost) { this.s.lv['run.' + cheap.id] = 1; this.freshTrail(cheap.id); this.events.push({ k: 'toast', text: `${cheap.name} was cut with the lift, on the house`, tone: 'good' }); }
      }
    }
    if (id.startsWith('run.')) this.freshTrail(id.slice(4));
    this.measureRuns();
    this.planDayKeep();
    this.events.push({ k: 'level', id });
    return true;
  }
  private freshTrail(rid: string) {
    {
      // a fresh trail: deep snow but rough until someone grooms it
      const ri = RUNS.findIndex((r) => r.id === rid);
      for (const k of this.m.cellsOf[ri]) { this.groom[k] = 0.15; this.powder[k] = 0.6; this.depth[k] = Math.max(this.depth[k], 55); }
      this.dirty = true;
    }
  }

  // ------------------------------------------------------------------ snow
  private freshSnow() {
    const m = this.m;
    for (let k = 0; k < SN * SN; k++) {
      const h = cellHash(k);
      this.depth[k] = 80 + h * 10;
      this.powder[k] = 0.75;
      this.groom[k] = 0;
      this.dirA[k] = 1; this.dirB[k] = 0;
      const r = m.runCell[k];
      if (r && this.runBuilt(RUNS[r - 1].id)) {
        this.depth[k] = 62 + h * 12;
        this.groom[k] = 0.22 + h * 0.2;
        this.powder[k] = 0.05;
      }
    }
    // the bunny slope you'll groom first: half done, so the stripes show what's coming
    const bi = RUNS.findIndex((r) => r.id === 'bunny');
    for (const k of m.cellsOf[bi]) {
      const ci = k % SN;
      const x = (ci + 0.5) * SC - HALF;
      if (x < -132) { this.groom[k] = 1; this.dirA[k] = Math.cos(Math.PI); this.dirB[k] = Math.sin(Math.PI); }
    }
  }

  private packSnow() {
    const cells: number[] = [];
    for (const list of this.m.cellsOf) for (const k of list) cells.push(k);
    const b = new Uint8Array(cells.length * 4);
    cells.forEach((k, i) => {
      b[i * 4] = Math.round(this.groom[k] * 255);
      b[i * 4 + 1] = Math.round(this.powder[k] * 255);
      b[i * 4 + 2] = Math.min(255, Math.round(this.depth[k]));
      const a = Math.atan2(this.dirB[k], this.dirA[k]); // 2*angle
      b[i * 4 + 3] = Math.round(((a + Math.PI) / (Math.PI * 2)) * 255);
    });
    let s = '';
    for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
    return btoa(s);
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

  /** the snowcat's tiller: groom a strip `w` wide behind (x,z) heading (hx,hz) */
  groomStrip(x: number, z: number, hx: number, hz: number, w: number, len = 3.5) {
    const a2 = Math.atan2(hz, hx) * 2;
    const ca = Math.cos(a2), sa = Math.sin(a2);
    const r = Math.hypot(w / 2, len / 2) + SC;
    const ci0 = Math.floor((x - r + HALF) / SC), ci1 = Math.ceil((x + r + HALF) / SC);
    const cj0 = Math.floor((z - r + HALF) / SC), cj1 = Math.ceil((z + r + HALF) / SC);
    let gained = 0;
    for (let cj = Math.max(0, cj0); cj <= Math.min(SN - 1, cj1); cj++)
      for (let ci = Math.max(0, ci0); ci <= Math.min(SN - 1, ci1); ci++) {
        const px = (ci + 0.5) * SC - HALF - x, pz = (cj + 0.5) * SC - HALF - z;
        const along = px * hx + pz * hz, side = -px * hz + pz * hx;
        if (Math.abs(along) > len / 2 + SC * 0.5 || Math.abs(side) > w / 2) continue;
        const k = cj * SN + ci;
        if (this.groom[k] < 0.97) { gained += (1 - this.groom[k]) * (this.m.runCell[k] ? 1 : 0); }
        this.groom[k] = 1;
        this.powder[k] = 0;
        this.dirA[k] = ca; this.dirB[k] = sa;
        // spread the machine-snow whales a little
        if (this.depth[k] > 120) this.depth[k] -= 4;
      }
    this.dirty = true;
    this.s.today.groomed += gained * SC * SC;
    return gained;
  }

  /** a skier passing through: carves the corduroy / tracks the powder */
  track(x: number, z: number, amt: number) {
    const k = this.m.cellAt(x, z);
    if (k < 0) return;
    if (this.powder[k] > 0.05) { this.powder[k] = Math.max(0, this.powder[k] - amt * 2.2); this.dirty = true; }
    if (this.groom[k] > 0) this.groom[k] = Math.max(0, this.groom[k] - amt * 0.25);
  }

  private buildGuns() {
    for (const p of this.m.runs) {
      const n = 3 * GUNS_PER_LV;
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.6) / (n + 0.2)) * p.len;
        const i = this.m.idxAt(p, s);
        const side = k % 2 ? 1 : -1;
        const off = p.def.w / 2 + 2;
        this.guns.push({ id: `${p.def.id}:${k}`, run: p.def.id, k, x: p.x[i] - p.tz[i] * off * side, z: p.z[i] + p.tx[i] * off * side, dx: p.tz[i] * side, dz: -p.tx[i] * side });
      }
    }
  }
  gunBuilt(g: Gun) { return this.runBuilt(g.run) && g.k < this.lv('guns.' + g.run) * GUNS_PER_LV; }
  builtGuns() { return this.guns.filter((g) => this.gunBuilt(g)); }
  get canMakeSnow() { return this.temp <= -2; }
  toggleGun(g: Gun) {
    if (this.gunOn.has(g.id)) this.gunOn.delete(g.id); else this.gunOn.add(g.id);
    return this.gunOn.has(g.id);
  }

  measureRuns() {
    RUNS.forEach((r, ri) => {
      const cells = this.m.cellsOf[ri];
      let q = 0, d = 0, g = 0;
      for (const k of cells) {
        const dep = this.depth[k];
        d += dep;
        g += this.groom[k];
        q += smooth(12, 45, dep) * (0.28 + 0.72 * Math.max(this.groom[k], this.powder[k] * 1.05));
      }
      const n = cells.length || 1;
      this.runQ[r.id] = Math.min(1, q / n);
      this.runDepth[r.id] = d / n;
      this.runGroom[r.id] = g / n;
    });
  }

  // ------------------------------------------------------------------ the day
  /** expected visitors today, the formula the whole game turns on */
  planDay() {
    const s = this.s;
    const w = WEATHER[this.weather];
    const open = RUNS.filter((r) => this.runBuilt(r.id));
    // trails draw people in proportion to how good their snow is; the rating multiplies it
    let trails = 20;
    for (const r of open) trails += { green: 26, blue: 46, black: 40, double: 44, park: 60 }[r.diff] * (0.25 + 0.75 * (this.runQ[r.id] ?? 0.5));
    let appeal = trails * (0.4 + 0.25 * s.stars);
    appeal += this.lv('lodge') * 24 + this.lv('rental') * 20 + this.lv('school') * 34 + this.lv('hotel') * 80;
    if (this.liftBuilt('gondola')) appeal += 160;
    const fair = 26 + s.stars * 15 + this.lv('lodge') * 3 + (this.liftBuilt('gondola') ? 20 : 0);
    const priceMul = Math.min(1.6, Math.max(0.12, Math.pow(fair / s.price, 1.6)));
    const weekend = this.dow >= 5 ? 1.55 : this.dow === 4 ? 1.15 : 1;
    const mkt = 1 + this.lv('marketing') * 0.12;
    const powder = s.powderDay ? 1.5 : 1;
    let v = appeal * w.demand * weekend * priceMul * mkt * powder * (1 + s.buzz);
    v = Math.min(v, PARKING[this.lv('parking')] + HOTEL_ROOMS[this.lv('hotel')] * 2);
    this.demand = this.closedToday ? 0 : Math.round(v);
    this.nightDemand = this.lv('lights') && !this.closedToday ? Math.round(this.demand * 0.32) : 0;
    this.fair = fair;
  }
  fair = 60;

  /** what the UI shows for a price before you commit to it */
  previewDemand(price: number) {
    const keep = [this.demand, this.nightDemand, this.fair, this.s.price];
    this.s.price = price; this.planDay(); const d = this.demand;
    [this.demand, this.nightDemand, this.fair, this.s.price] = keep;
    return d;
  }
  /** a price change before the lifts open counts today; after that, from tomorrow */
  planDayKeep() { if (this.hour < OPEN && this.hour >= 6) this.planDay(); }

  private arrivedFrac(h: number) { return smooth(8.2, 12.2, h); }
  private leftFrac(h: number) { return smooth(13.4, 16.0, h); }
  private nArr(h: number) { return smooth(16, 17.6, h); }
  private nLeft(h: number) { return smooth(19.4, 21, h); }

  update(dtReal: number) {
    if (this.paused) return;
    const dh = (dtReal * this.speed) / SEC_PER_HOUR;
    this.acc += dh;
    // step in quarter-minute slices so day boundaries land exactly
    while (this.acc > 0) {
      const step = Math.min(this.acc, 1 / 60);
      this.acc -= step;
      this.tick(step);
    }
  }

  private tick(dh: number) {
    const s = this.s;
    const h0 = this.hour;
    s.t += dh;
    const h1 = this.hour;
    const wrapped = h1 < h0;
    const crossed = (x: number) => (wrapped ? h0 < x || h1 >= x : h0 < x && h1 >= x);
    if (crossed(6)) this.newDay();
    if (crossed(CLOSE) && !this.lv('lights')) this.closeDay();
    if (crossed(NIGHT_CLOSE) && this.lv('lights')) this.closeDay();
    if (crossed(NIGHT_CLOSE)) this.hotelNight();
    if (crossed(OPEN) && !this.closedToday) this.events.push({ k: 'toast', text: `Lifts are spinning: ${this.demand.toLocaleString()} skiers expected today`, tone: 'good' });
    if (crossed(OPEN)) for (const g of [...this.gunOn]) this.gunOn.delete(g);
    if (crossed(CLOSE) && this.lv('lights') && !this.closedToday) this.events.push({ k: 'toast', text: 'The floodlights are on: night skiing until 9 pm', tone: 'info' });
    if (crossed(22) && this.lv('snowmakers') && this.canMakeSnow) { let n = 0; for (const g of this.builtGuns()) if (!this.gunOn.has(g.id)) { this.gunOn.add(g.id); n++; } if (n) this.events.push({ k: 'toast', text: `Snowmaking crew switched on ${n} guns`, tone: 'info' }); }

    const h = this.hour;
    // visitors
    let on = 0;
    if (!this.closedToday) {
      const V = this.demand;
      const dA = this.arrivedFrac(h) - this.arrivedFrac(h0 > h ? 0 : h0);
      if (dA > 0 && h < CLOSE) {
        const n = V * dA;
        s.today.visitors += n; s.totalVisitors += n;
        this.earn(n * s.price, 'tickets');
        const rl = this.lv('rental'); if (rl) this.earn(n * [0, 0.18, 0.26, 0.34, 0.42][rl] * [0, 28, 34, 42, 52][rl], 'rental');
        const sl = this.lv('school'); if (sl) this.earn(n * [0, 0.08, 0.13, 0.18][sl] * 65, 'school');
      }
      on = V * Math.max(0, this.arrivedFrac(h) - this.leftFrac(h));
      if (this.nightDemand) {
        const dN = this.nArr(h) - this.nArr(h0 > h ? 0 : h0);
        if (dN > 0) { const n = this.nightDemand * dN; s.today.night += n; s.totalVisitors += n; this.earn(n * s.price * 0.6, 'tickets'); }
        on += this.nightDemand * Math.max(0, this.nArr(h) - this.nLeft(h));
      }
    }
    this.onMountain = on;
    if (on > 0) {
      const lunch = Math.exp(-(((h - 12.4) / 1.2) ** 2));
      const seats = LODGE_SEATS[this.lv('lodge')];
      const want = on * (2.2 + 9 * lunch) * dh;
      const capped = Math.min(want, seats * 2.6 * 13 * dh);
      this.earn(capped, 'lodge');
    }
    // running costs
    if (this.isOpen) {
      for (const l of LIFTS) if (this.liftRunning(l.id)) this.spend(dh * (20 + 26 * this.lv('lift.' + l.id)) * (l.kind === 'gondola' ? 3 : 1), 'ops');
    }
    const gunsOn = this.gunOn.size;
    if (gunsOn) this.spend(dh * gunsOn * 24, 'snowmaking');

    this.snowTick(dh, on);
    this.eventsTick(dh, on);

    // stars drift toward how good today actually is
    if (this.isOpen) {
      s.stars += (this.starTarget - s.stars) * Math.min(1, dh * 0.16);
    }
    s.buzz = Math.max(0, s.buzz - dh * 0.004);
  }

  private snowT = 0;
  private snowTick(dh: number, on: number) {
    this.snowT += dh;
    if (this.snowT < 0.1) return;
    const dt = this.snowT;
    this.snowT = 0;
    const w = WEATHER[this.weather];
    const T = this.temp;
    const m = this.m;
    const fall = w.snow * dt * (0.6 + 0.4 * Math.sin(this.s.t * 1.3) ** 2);
    const melt = T > 0 ? T * 0.45 * dt * (0.4 + 0.6 * this.daylight) : 0;
    // skiers per run (by their lift's share)
    const open = RUNS.filter((r) => this.runOpen(r.id));
    const wsum = open.reduce((a, r) => a + r.w * 0.1 + 1, 0) || 1;
    for (const r of RUNS) this.onRun[r.id] = 0;
    for (const r of open) this.onRun[r.id] = (on * (r.w * 0.1 + 1)) / wsum;

    if (fall > 0 || melt > 0) {
      const pAdd = fall / 12;
      for (let k = 0; k < SN * SN; k++) {
        this.depth[k] = Math.max(0, this.depth[k] + fall - melt * (0.7 + 0.6 * cellHash(k)));
        if (fall > 0) { this.powder[k] = Math.min(1, this.powder[k] + pAdd); this.groom[k] *= 1 - Math.min(1, pAdd * 0.9); }
        if (melt > 0) { this.powder[k] = Math.max(0, this.powder[k] - melt * 0.04); }
      }
      this.s.offDepth = Math.max(10, this.s.offDepth + fall - melt);
      this.dirty = true;
    }
    // wear
    RUNS.forEach((r, ri) => {
      const n = this.onRun[r.id];
      if (!n) return;
      const cells = m.cellsOf[ri];
      const area = cells.length * SC * SC;
      const wear = Math.min(0.6, (n / area) * 900 * dt * (r.diff === 'green' ? 0.75 : r.diff === 'park' ? 1.2 : 1));
      for (const k of cells) {
        const f = 0.45 + cellHash(k * 7 + 3) * 1.1;
        this.groom[k] = Math.max(0, this.groom[k] - wear * f * 0.55);
        this.powder[k] = Math.max(0, this.powder[k] - wear * f * 1.4);
      }
      this.dirty = true;
    });
    // snow guns
    if (this.gunOn.size && this.canMakeSnow) {
      for (const g of this.guns) {
        if (!this.gunOn.has(g.id)) continue;
        const cx = g.x + g.dx * 14, cz = g.z + g.dz * 14;
        const R = 17;
        const ci0 = Math.floor((cx - R + HALF) / SC), ci1 = Math.ceil((cx + R + HALF) / SC);
        const cj0 = Math.floor((cz - R + HALF) / SC), cj1 = Math.ceil((cz + R + HALF) / SC);
        for (let cj = Math.max(0, cj0); cj <= Math.min(SN - 1, cj1); cj++)
          for (let ci = Math.max(0, ci0); ci <= Math.min(SN - 1, ci1); ci++) {
            const d = Math.hypot((ci + 0.5) * SC - HALF - cx, (cj + 0.5) * SC - HALF - cz);
            if (d > R) continue;
            const k = cj * SN + ci;
            const f = 1 - d / R;
            this.depth[k] = Math.min(240, this.depth[k] + 9 * f * dt);
            this.groom[k] = Math.min(this.groom[k], 0.62 - 0.4 * f);
            this.powder[k] = Math.min(this.powder[k], 0.1);
          }
      }
      this.dirty = true;
    }
    this.measureRuns();
    this.computeStars();
  }

  private computeStars() {
    const open = RUNS.filter((r) => this.runBuilt(r.id));
    if (!open.length) { this.starTarget = 1; return; }
    let q = 0, wsum = 0;
    for (const r of open) { const w = r.w * (this.m.runOf[r.id].len / 400); q += (this.runOpen(r.id) ? this.runQ[r.id] : 0) * w; wsum += w; }
    q /= wsum;
    const kinds = new Set(open.map((r) => (r.diff === 'double' ? 'black' : r.diff)));
    const variety = Math.min(1, (kinds.size - 1) / 3 + open.length / 18);
    let cap = 0;
    for (const l of LIFTS) if (this.liftRunning(l.id)) cap += liftCapacity(l.kind, this.lv('lift.' + l.id));
    const load = (this.onMountain * 2.4) / Math.max(1, cap);
    this.waitMin = Math.max(0, (load - 0.6) * 22);
    const lifts = 1 - Math.min(1, Math.max(0, load - 0.6) / 1.6);
    const amen = Math.min(1, (this.lv('lodge') * 0.16 + this.lv('rental') * 0.08 + this.lv('school') * 0.08 + this.lv('hotel') * 0.1 + (this.onMountain < LODGE_SEATS[this.lv('lodge')] * 1.6 ? 0.12 : 0)));
    const hurt = this.incidents.filter((i) => !i.carried).length;
    const brokenN = Object.keys(this.broken).length;
    this.starTarget = Math.max(0.5, Math.min(5, 0.3 + q * 2.2 + variety * 1.0 + lifts * 0.8 + amen * 0.7 - hurt * 0.25 - brokenN * 0.35 + this.lv('marketing') * 0.05));
  }

  private eventsTick(dh: number, on: number) {
    if (!this.isOpen) return;
    // breakdowns
    const mech = this.lv('mechanic');
    for (const l of LIFTS) {
      if (!this.liftBuilt(l.id) || this.broken[l.id] !== undefined || l.kind === 'carpet') continue;
      const p = dh * 0.075 * (1 - mech * 0.18) * (0.6 + Math.min(1, on / 400));
      if (Math.random() < p) {
        this.broken[l.id] = this.s.t;
        this.events.push({ k: 'broken', lift: l.id });
        this.events.push({ k: 'toast', text: `${l.name} has stopped: drive up and fix it`, tone: 'bad' });
      }
    }
    for (const [id, t0] of Object.entries(this.broken)) {
      const fixAfter = [0, 50, 30, 15][mech] / 60;
      if (mech && this.s.t - t0 > fixAfter) { delete this.broken[id]; this.events.push({ k: 'toast', text: `Mechanics got ${LIFT_BY[id].name} going again`, tone: 'info' }); }
    }
    // hurt skiers
    if (this.incidents.length < 3 && on > 20) {
      const p = dh * Math.min(0.5, on / 900) * 0.55;
      if (Math.random() < p) {
        const open = RUNS.filter((r) => this.runOpen(r.id) && !this.incidents.some((i) => i.run === r.id));
        if (open.length) {
          const weights = open.map((r) => ({ green: 1, blue: 1.4, black: 2, double: 2.6, park: 2.2 })[r.diff]);
          let pick = Math.random() * weights.reduce((a, b) => a + b, 0), r = open[0];
          for (let i = 0; i < open.length; i++) { pick -= weights[i]; if (pick <= 0) { r = open[i]; break; } }
          const p2 = this.m.runOf[r.id];
          const i = this.m.idxAt(p2, p2.len * (0.2 + Math.random() * 0.6));
          const lat = (Math.random() - 0.5) * r.w * 0.6;
          const inc: Incident = { id: this.nextId++, run: r.id, x: p2.x[i] - p2.tz[i] * lat, z: p2.z[i] + p2.tx[i] * lat, t0: this.s.t, carried: false };
          this.incidents.push(inc);
          this.events.push({ k: 'hurt', inc });
          this.events.push({ k: 'toast', text: `Skier down on ${r.name}: grab the snowmobile`, tone: 'bad' });
        }
      }
    }
    const pat = this.lv('patrol');
    for (const inc of [...this.incidents]) {
      const age = this.s.t - inc.t0;
      const auto = [0, 45, 25, 12][pat] / 60;
      if (!inc.carried && pat && age > auto) { this.resolve(inc, false); this.events.push({ k: 'toast', text: `Ski patrol brought the skier off ${RUN_BY[inc.run].name}`, tone: 'info' }); }
      else if (!inc.carried && age > 1.5) { this.resolve(inc, false); this.s.stars = Math.max(0.5, this.s.stars - 0.15); this.events.push({ k: 'toast', text: `A skier waited too long on ${RUN_BY[inc.run].name}. Reviews took a hit`, tone: 'bad' }); }
    }
  }

  resolve(inc: Incident, byYou: boolean) {
    this.incidents = this.incidents.filter((i) => i !== inc);
    if (byYou) {
      const age = this.s.t - inc.t0;
      const tip = Math.round(150 + 600 * Math.max(0, 1 - age / 0.8) + this.s.stars * 60);
      this.earn(tip, 'tips');
      this.s.today.rescues++;
      this.s.stars = Math.min(5, this.s.stars + 0.05);
      this.events.push({ k: 'toast', text: `Rescue done in ${Math.round(age * 60)} min. Their family tipped ${money(tip)}`, tone: 'good' });
    }
  }

  fixLift(id: string) {
    if (this.broken[id] === undefined) return;
    const age = this.s.t - this.broken[id];
    delete this.broken[id];
    this.s.today.repairs++;
    const bonus = Math.round(200 + 500 * Math.max(0, 1 - age / 0.6));
    this.earn(bonus, 'tips');
    this.events.push({ k: 'toast', text: `${LIFT_BY[id].name} is back up after ${Math.round(age * 60)} min. Lift line cheered (+${money(bonus)})`, tone: 'good' });
  }

  private newDay() {
    const s = this.s;
    const prevW = s.weather[0];
    s.weather.shift();
    while (s.weather.length < 4) s.weather.push(rollWeather(this.day + s.weather.length, s.weather[s.weather.length - 1] ?? prevW));
    s.powderDay = (prevW === 'snow' || prevW === 'storm') && s.weather[0] !== 'storm';
    // wages
    const wages = this.lv('groomers') * 220 + this.lv('mechanic') * 160 + this.lv('patrol') * 150 + this.lv('snowmakers') * 180 + this.lv('marketing') * 260 + 120;
    s.today = emptyDay(s.stars);
    this.spend(wages, 'wages');
    // the night crew's grooming
    const g = this.lv('groomers');
    if (g) {
      const order = RUNS.filter((r) => this.runBuilt(r.id)).sort((a, b) => this.runGroom[a.id] - this.runGroom[b.id]);
      for (const r of order.slice(0, g)) this.autoGroom(r);
      if (order.length) this.events.push({ k: 'toast', text: `Night crew groomed ${order.slice(0, g).map((r) => r.name).join(', ')}`, tone: 'info' });
    }
    this.incidents = [];
    this.broken = {};
    this.planDay();
    this.events.push({ k: 'newday', day: this.day });
    if (s.powderDay) this.events.push({ k: 'toast', text: `Powder day! ${Math.round(this.s.offDepth)} cm base and fresh snow on everything`, tone: 'good' });
    if (this.closedToday) this.events.push({ k: 'toast', text: this.closedReason, tone: 'info' });
  }

  private autoGroom(r: RunDef) {
    const p = this.m.runOf[r.id];
    const ri = RUNS.indexOf(r);
    for (const k of this.m.cellsOf[ri]) {
      if (Math.random() < 0.85) {
        this.groom[k] = Math.max(this.groom[k], 0.88);
        this.powder[k] = 0;
        const ci = k % SN, cj = (k / SN) | 0;
        const n = this.m.nearestOn(p, (ci + 0.5) * SC - HALF, (cj + 0.5) * SC - HALF);
        const a2 = Math.atan2(p.tz[n.i], p.tx[n.i]) * 2;
        this.dirA[k] = Math.cos(a2); this.dirB[k] = Math.sin(a2);
      }
    }
    this.dirty = true;
  }

  private closeDay() {
    if (this.lastClosedSummary === this.day) return;
    this.lastClosedSummary = this.day;
    const t = this.s.today;
    const income = t.tickets + t.lodge + t.rental + t.school + t.hotel + t.tips;
    const cost = t.wages + t.ops + t.snowmaking + t.fuel;
    const profit = income - cost;
    this.s.history.push({ day: this.day, visitors: Math.round(t.visitors + t.night), profit, stars: this.s.stars });
    if (this.s.history.length > 30) this.s.history.shift();
    this.events.push({ k: 'summary', day: this.day, stats: { ...t }, stars: this.s.stars, profit });
  }

  private hotelNight() {
    const rooms = HOTEL_ROOMS[this.lv('hotel')];
    if (!rooms) return;
    const occ = Math.min(1, 0.35 + this.s.stars * 0.13);
    const rate = 120 + this.s.stars * 30;
    this.earn(Math.round(rooms * occ * rate), 'hotel');
  }

  /** skip to the next morning's opening, nobody waiting */
  skipToMorning() {
    const target = Math.floor(this.s.t / 24) * 24 + (this.hour >= OPEN ? 24 + OPEN : OPEN);
    // run the clock in big steps (snow guns / crew still work)
    let guard = 0;
    while (this.s.t < target - 1e-6 && guard++ < 5000) this.tick(Math.min(0.1, target - this.s.t));
  }

  offline(): number {
    const away = (Date.now() - (this.s.lastSeen || Date.now())) / 1000;
    if (away < 180) return 0;
    const recent = this.s.history.slice(-3);
    const avg = recent.length ? recent.reduce((a, b) => a + b.profit, 0) / recent.length : 2000;
    const hrs = Math.min(8, away / 3600);
    const earned = Math.max(0, Math.round(avg * 0.16 * hrs));
    if (earned > 0) { this.s.cash += earned; }
    return earned;
  }

  save() {
    this.s.snow = this.packSnow();
    this.s.guns = [...this.gunOn];
    this.s.lastSeen = Date.now();
    return JSON.stringify(this.s);
  }

  /** run medals: par times per trail (seconds) */
  par(id: string) {
    const p = this.m.runOf[id];
    const v = { green: 10, blue: 14, black: 15, double: 14, park: 12 }[p.def.diff];
    const gold = p.len / v;
    return [gold * 1.6, gold * 1.25, gold];
  }
  finishRun(id: string, sec: number) {
    const [b, s, g] = this.par(id);
    const medal = sec <= g ? 3 : sec <= s ? 2 : sec <= b ? 1 : 0;
    const prev = this.s.medals[id] ?? 0;
    const prize = [0, 400, 1200, 3000];
    let paid = 0;
    for (let m = prev + 1; m <= medal; m++) paid += prize[m] * (1 + RUNS.findIndex((r) => r.id === id) * 0.35);
    if (medal > prev) this.s.medals[id] = medal;
    if (!this.s.best[id] || sec < this.s.best[id]) this.s.best[id] = sec;
    if (paid) this.earn(Math.round(paid), 'tips');
    return { medal, paid: Math.round(paid), best: this.s.best[id], par: [b, s, g] };
  }

  addBuzz(n: number) {
    this.s.buzz = Math.min(0.6, this.s.buzz + n);
  }
}

export { UPGRADES };
