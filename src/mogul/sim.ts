// Mogul's economy: carts, shops, property, facilities, quarries, the truck network, the Exchange,
// rival companies, city events, goals, the monthly race and saving. Pure logic, no three.js.
import {
  GOODS, GOOD_IDS, MENU_BY, SHOP_BY, FAC_BY, ORES, ORE_BY, RIVALS, QUESTS, peakMul,
  SEC_PER_HOUR, DAYS_PER_MONTH, START_CASH, CART_COST, TRUCK_COST, SURVEY_COST, CART_UP, SHOP_UP, FAC_UP, TRUCK_CAP, COURIER_FEE,
  type GoodId, type MenuItem,
} from './data.ts';
import type { City, Building } from './city.ts';

export type Store = Partial<Record<GoodId, number>>;

export interface Cart { id: number; x: number; z: number; menu: string[]; prices: Record<string, number>; lv: { speed: number; sign: number; style: number }; stock: Store; served: number; sales: number; today: number; rival: number; name: string; auto: boolean }
export interface Shop { id: number; b: number; type: string; prices: Record<string, number>; lv: { crew: number; decor: number; ads: number }; stock: Store; served: number; sales: number; today: number; rent: number; auto: boolean }
export interface Fac { b: number; type: string; lv: number; build: number; buildT: number; store: Store; autoSell: boolean; auto: boolean; made: number }
export interface Deposit { id: number; x: number; z: number; ore: GoodId; amount: number; left: number; found: boolean; claimed: boolean }
export interface Quarry { id: number; dep: number; x: number; z: number; lv: number; store: Store; autoSell: boolean; mined: number }
export interface Rival { name: string; color: string; nw: number; start: number; target: number; trophies: number[] }
export interface Vehicle { id: number; own: boolean; path: number[]; seg: number; s: number; x: number; z: number; dir: number; good: GoodId | null; n: number; from: string; to: string; phase: 'idle' | 'pick' | 'drop' | 'leave'; wait: number; node: number; speed: number }
export interface Tick { t: number; text: string; kind: 'me' | 'rival' | 'market' | 'city' }
export interface Event { kind: 'festival' | 'heat' | 'rain' | 'boom'; edge?: number; good?: GoodId; day: number; text: string }

export interface SaveState {
  v: number; city: string; company: string; cash: number; t: number;
  carts: Cart[]; shops: Shop[]; owned: number[]; facs: Fac[]; deposits: Deposit[]; quarries: Quarry[];
  trucks: number; mult: Record<string, number>; hist: Record<string, number[]>;
  rivals: Rival[]; rivalOwn: Record<string, number>; forSale: number[];
  quest: number; stats: { served: number; sales: number; sold: number; surveys: number; monthStart: number; bestRank: number; lastGrowth: number };
  trophies: number[]; ids: number; savedAt: number; events: Event[]; seed: number; propVal: number;
}

const rnd = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export class Sim {
  city: City;
  s: SaveState;
  vehicles: Vehicle[] = [];
  ticker: Tick[] = [];
  terminal = 0;
  private incoming = new Map<string, number>(); // site|good → units en route
  private reserved = new Map<string, number>();
  private vid = 1;
  private netT = 0;
  private lastDay = -1;
  private lastHourInt = -1;
  onToast: (text: string, kind?: string) => void = () => {};
  onSale: (key: string, amount: number) => void = () => {};
  onQuest: (q: number) => void = () => {};
  onMonth: (rank: number, rows: { name: string; growth: number; me: boolean }[]) => void = () => {};
  onChange: () => void = () => {};
  dayLedger = { income: 0, expense: 0 };
  incomeRate = 0; // $ per real second, smoothed
  private incAcc = 0;
  private incT = 0;

  constructor(city: City, save: SaveState | null, company: string) {
    this.city = city;
    this.terminal = city.edgeNode();
    this.s = save ?? this.fresh(company);
    if (!save) this.seedRivals();
    this.lastDay = Math.floor(this.s.t / 24);
    this.lastHourInt = Math.floor(this.s.t);
    for (let i = 0; i < this.s.trucks; i++) this.addTruck(true);
  }

  private fresh(company: string): SaveState {
    const seed = (this.city.def.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0) || 1;
    const R = rnd(seed);
    const mult: Record<string, number> = {}, hist: Record<string, number[]> = {};
    for (const g of GOOD_IDS) { mult[g] = 0.9 + R() * 0.2; hist[g] = Array.from({ length: 24 }, () => mult[g] * (0.96 + R() * 0.08)); }
    // ore deposits in open ground: streets, plazas and parks, never inside a building
    const deposits: Deposit[] = [];
    const W = this.city.W, D = this.city.D;
    let guard = 0;
    while (deposits.length < 70 && guard++ < 5000) {
      const x = (R() - 0.5) * W * 0.95, z = (R() - 0.5) * D * 0.95;
      if (this.city.buildingAt(x, z)) continue;
      const q = this.city.nearestEdge(x, z, 30);
      if (q && q.d < this.city.edges[q.e].w / 2 + 1) continue; // not in the roadway itself
      if (deposits.some((d) => Math.hypot(d.x - x, d.z - z) < 45)) continue;
      let w = R() * ORES.reduce((a, o) => a + o.weight, 0);
      const ore = ORES.find((o) => (w -= o.weight) <= 0) ?? ORES[0];
      const amount = Math.round(ore.amount[0] + R() * (ore.amount[1] - ore.amount[0]));
      deposits.push({ id: deposits.length, x, z, ore: ore.id, amount, left: amount, found: false, claimed: false });
    }
    // a few buildings are on the market at a discount
    const forSale: number[] = [];
    for (const b of this.city.buildings) if (R() < 0.06) forSale.push(b.id);
    return {
      v: 1, city: this.city.def.id, company, cash: START_CASH, t: 9,
      carts: [], shops: [], owned: [], facs: [], deposits, quarries: [], trucks: 0, mult, hist,
      rivals: [], rivalOwn: {}, forSale, quest: 0,
      stats: { served: 0, sales: 0, sold: 0, surveys: 0, monthStart: START_CASH, bestRank: 99, lastGrowth: 0 },
      trophies: [], ids: 1, savedAt: Date.now(), events: [], seed, propVal: 1,
    };
  }

  private seedRivals() {
    const R = rnd(this.s.seed ^ 0x9e3779b9);
    this.s.rivals = RIVALS.map((r, i) => {
      const nw = Math.round(3000 + R() * 40000 * (1 + i * 0.3));
      return { name: r.name, color: r.color, nw, start: nw, target: 0, trophies: [0, 0, 0] };
    });
    this.planRivals();
    // rivals own some of the city already: the bigger the rival, the more they hold
    const bs = this.city.buildings.slice().sort((a, b) => b.value - a.value);
    for (const b of bs) {
      if (R() < 0.07) this.s.rivalOwn[b.id] = Math.floor(R() * this.s.rivals.length);
    }
    // rival carts on busy corners
    const busy = this.city.edges.map((e, i) => ({ i, f: e.foot })).filter((e) => this.city.edges[e.i].cls < 6).sort((a, b) => b.f - a.f);
    const items = Object.keys(MENU_BY);
    for (let k = 0; k < 7 && k < busy.length; k++) {
      const e = this.city.edges[busy[k * 3 + 2]?.i ?? busy[k].i];
      const t = 0.3 + R() * 0.4;
      const x = this.city.nx[e.a] + (this.city.nx[e.b] - this.city.nx[e.a]) * t, z = this.city.nz[e.a] + (this.city.nz[e.b] - this.city.nz[e.a]) * t;
      const it = items[Math.floor(R() * items.length)];
      const ri = Math.floor(R() * this.s.rivals.length);
      const sp = this.sidewalk(x, z);
      this.s.carts.push({ id: this.s.ids++, x: sp.x, z: sp.z, menu: [it], prices: { [it]: Math.round(MENU_BY[it].fair * (1 + R() * 0.3) * 4) / 4 }, lv: { speed: 1, sign: 0, style: 0 }, stock: {}, served: 0, sales: 0, today: 0, rival: ri, name: this.s.rivals[ri].name, auto: true });
    }
  }

  private planRivals() {
    const base = Math.max(this.month <= 1 ? 6000 : 15000, this.s.stats.lastGrowth * 1.15, this.netWorth() * 0.6);
    const R = rnd((this.s.seed + Math.floor(this.s.t)) >>> 0);
    for (const r of this.s.rivals) { r.start = r.nw; r.target = base * (0.25 + R() * 1.35); }
  }

  // ------------------------------------------------------------------ time
  get hour() { return this.s.t % 24; }
  get day() { return Math.floor(this.s.t / 24) + 1; }
  get month() { return Math.floor((this.day - 1) / DAYS_PER_MONTH) + 1; }
  get monthLeft() { return (this.month * DAYS_PER_MONTH * 24 - this.s.t) / 24; }

  crowdMul(): number {
    const h = this.hour;
    const base = 0.12 + 0.88 * Math.max(0, Math.min(1, Math.min((h - 5.5) / 3, (24.5 - h) / 3.5)));
    const rush = 1 + 0.35 * Math.exp(-((h - 8.5) ** 2) / 1.5) + 0.3 * Math.exp(-((h - 12.5) ** 2) / 1.5) + 0.35 * Math.exp(-((h - 18) ** 2) / 2);
    const rain = this.todayEvent('rain') ? 0.7 : 1;
    return base * rush * rain;
  }
  todayEvent(kind: Event['kind']): Event | undefined { return this.s.events.find((e) => e.kind === kind && e.day === this.day); }

  // ------------------------------------------------------------------ prices
  price(g: GoodId) { return GOODS[g].price * (this.s.mult[g] ?? 1); }
  buyPrice(g: GoodId) { return this.price(g) * 1.04; }
  sellPrice(g: GoodId) { return this.price(g) * 0.96; }

  priceF(price: number, fair: number) {
    const r = price / fair;
    return r <= 1 ? 1 + (1 - r) * 0.9 : Math.exp(-(r - 1) * 2.4);
  }

  // ------------------------------------------------------------------ sellers (what pedestrians shop at)
  menuOf(key: string): MenuItem[] {
    if (key[0] === 'c') { const c = this.cart(+key.slice(2)); return c ? c.menu.map((m) => MENU_BY[m]) : []; }
    const sh = this.shop(+key.slice(2));
    return sh ? SHOP_BY[sh.type].items : [];
  }
  cart(id: number) { return this.s.carts.find((c) => c.id === id); }
  shop(id: number) { return this.s.shops.find((c) => c.id === id); }
  fac(b: number) { return this.s.facs.find((f) => f.b === b); }

  /** Chance a passer-by buys, and what. */
  pitch(key: string): { p: number; radius: number } {
    const h = this.hour;
    const heat = this.todayEvent('heat'), rain = this.todayEvent('rain');
    const itemMul = (m: MenuItem) => (heat && (m.id === 'lemonade' || m.id === 'icecream') ? 2 : 1) * (rain && (m.id === 'coffee' || m.id === 'latte') ? 1.6 : 1) * (rain && (m.id === 'icecream' || m.id === 'lemonade') ? 0.5 : 1);
    if (key[0] === 'c') {
      const c = this.cart(+key.slice(2));
      if (!c) return { p: 0, radius: 0 };
      let best = 0;
      for (const id of c.menu) { const m = MENU_BY[id]; best = Math.max(best, peakMul(m.peak, h) * this.priceF(c.prices[id], m.fair) * itemMul(m) * (this.hasStock(c.stock, m) || c.rival >= 0 ? 1 : 0)); }
      const variety = 1 + 0.22 * (c.menu.length - 1);
      const appeal = 1 + 0.25 * c.lv.style;
      return { p: Math.min(0.9, 0.46 * best * variety * appeal * (c.rival >= 0 ? 0.85 : 1)), radius: 22 + 6 * c.lv.sign };
    }
    const sh = this.shop(+key.slice(2));
    if (!sh) return { p: 0, radius: 0 };
    const t = SHOP_BY[sh.type];
    let best = 0;
    for (const m of t.items) best = Math.max(best, peakMul(m.peak, h) * this.priceF(sh.prices[m.id], m.fair) * itemMul(m) * (this.hasStock(sh.stock, m) ? 1 : 0));
    const office = 1 + Math.min(1.2, this.city.buildings[sh.b].floors / 25); // people working upstairs come down for it
    return { p: Math.min(0.95, 0.6 * best * office * (1 + 0.1 * (t.items.length - 1)) * (1 + 0.25 * sh.lv.decor)), radius: 36 + 10 * sh.lv.ads };
  }
  private hasStock(st: Store, m: MenuItem) { return (st[m.good] ?? 0) >= m.use; }

  serviceTime(key: string): { t: number; par: number; cap: number } {
    if (key[0] === 'c') { const c = this.cart(+key.slice(2)); return { t: 2.6 / (1 + 0.45 * (c?.lv.speed ?? 0)), par: 1, cap: 6 }; }
    const sh = this.shop(+key.slice(2));
    const crew = sh?.lv.crew ?? 0;
    return { t: 4.5 / (1 + 0.25 * crew), par: 2 + crew, cap: 5 + crew };
  }

  /** A customer reached the counter: pick an item, take the money, use the stock. Returns the price paid (0 = walked off). */
  serve(key: string): number {
    const isCart = key[0] === 'c';
    const c = isCart ? this.cart(+key.slice(2)) : undefined;
    const sh = isCart ? undefined : this.shop(+key.slice(2));
    const o = c ?? sh;
    if (!o) return 0;
    const items = this.menuOf(key);
    const prices = o.prices;
    const st = o.stock;
    const h = this.hour;
    const w = items.map((m) => (c && c.rival >= 0 ? 1 : this.hasStock(st, m) ? 1 : 0) * peakMul(m.peak, h) * this.priceF(prices[m.id], m.fair));
    const tot = w.reduce((a, b) => a + b, 0);
    if (tot <= 0) return 0;
    let r = Math.random() * tot, i = 0;
    while (i < w.length - 1 && (r -= w[i]) > 0) i++;
    const m = items[i];
    // some people buy for friends too: 1–3 of the item, fewer when it's pricey
    const r2 = Math.random() * this.priceF(prices[m.id], m.fair);
    const qty = (r2 > 0.85 ? 3 : r2 > 0.45 ? 2 : 1) + (isCart ? 0 : Math.random() < 0.4 ? 1 : 0);
    const price = prices[m.id] * qty;
    if (c && c.rival >= 0) { c.served++; return price; }
    st[m.good] = Math.max(0, (st[m.good] ?? 0) - m.use * qty);
    const bonus = 1 + this.trophyBonus();
    const earned = price * bonus;
    this.s.cash += earned;
    o.served++; o.sales += earned; o.today += earned;
    this.s.stats.served++; this.s.stats.sales += earned;
    this.dayLedger.income += earned;
    this.incAcc += earned;
    this.onSale(key, earned);
    this.checkQuests();
    return earned;
  }

  trophyBonus() { return this.s.trophies.reduce((a, t) => a + (t === 1 ? 0.06 : t === 2 ? 0.04 : 0.02), 0); }

  // ------------------------------------------------------------------ actions
  can(cost: number) { return this.s.cash >= cost - 1e-6; }
  spend(cost: number, why: string): boolean {
    if (!this.can(cost)) { this.onToast(`Not enough cash for ${why}`, 'bad'); return false; }
    this.s.cash -= cost;
    this.dayLedger.expense += cost;
    return true;
  }
  myCarts() { return this.s.carts.filter((c) => c.rival < 0); }

  sidewalk(x: number, z: number): { x: number; z: number; ok: boolean } {
    const q = this.city.nearestEdge(x, z, 40);
    if (!q) return { x, z, ok: false };
    const e = this.city.edges[q.e];
    const dx = x - q.px, dz = z - q.pz, d = Math.hypot(dx, dz);
    const ux = d > 0.01 ? dx / d : -(this.city.nz[e.b] - this.city.nz[e.a]) / e.len, uz = d > 0.01 ? dz / d : (this.city.nx[e.b] - this.city.nx[e.a]) / e.len;
    // the kerb on the clicked side first, nearer the road if a building is in the way, then the other kerb
    const offs = e.cls >= 5 ? [Math.min(d, e.w / 2 - 0.8), 0] : [e.w / 2 + 1.6, e.w / 2 + 0.8, e.w / 2 + 0.1];
    for (const sd of [1, -1])
      for (const off of offs) {
        const px = q.px + ux * off * sd, pz = q.pz + uz * off * sd;
        if (!this.city.buildingAt(px, pz)) return { x: px, z: pz, ok: true };
      }
    return { x: q.px + ux * offs[0], z: q.pz + uz * offs[0], ok: false };
  }

  placeCart(x: number, z: number, item = 'hotdog'): Cart | null {
    const n = this.myCarts().length;
    const cost = CART_COST(n);
    const sp = this.sidewalk(x, z);
    if (!sp.ok) { this.onToast('Carts go on the sidewalk', 'bad'); return null; }
    if (this.s.carts.some((c) => Math.hypot(c.x - sp.x, c.z - sp.z) < 6)) { this.onToast('Too close to another cart', 'bad'); return null; }
    if (!this.spend(cost, 'a cart')) return null;
    const m = MENU_BY[item];
    const c: Cart = { id: this.s.ids++, x: sp.x, z: sp.z, menu: [item], prices: { [item]: m.fair }, lv: { speed: 0, sign: 0, style: 0 }, stock: { [m.good]: 4 }, served: 0, sales: 0, today: 0, rival: -1, name: `Cart #${n + 1}`, auto: true };
    this.s.carts.push(c);
    this.log(`${this.s.company} opened a ${m.name.toLowerCase()} cart on ${this.streetAt(sp.x, sp.z)}`, 'me');
    this.checkQuests();
    this.onChange();
    return c;
  }
  moveCart(c: Cart, x: number, z: number): boolean {
    const sp = this.sidewalk(x, z);
    if (!sp.ok || this.s.carts.some((o) => o !== c && Math.hypot(o.x - sp.x, o.z - sp.z) < 6)) { this.onToast('Can\'t park there', 'bad'); return false; }
    c.x = sp.x; c.z = sp.z;
    this.onChange();
    return true;
  }
  sellCart(c: Cart) {
    this.s.cash += Math.round(CART_COST(Math.max(1, this.myCarts().length - 1)) * 0.5);
    this.s.carts = this.s.carts.filter((o) => o !== c);
    this.onChange();
  }
  toggleMenu(c: Cart, item: string) {
    if (c.menu.includes(item)) { if (c.menu.length > 1) c.menu = c.menu.filter((m) => m !== item); }
    else if (c.menu.length < 3) { c.menu.push(item); c.prices[item] ??= MENU_BY[item].fair; c.stock[MENU_BY[item].good] ??= 0; }
    else { this.onToast('A cart fits 3 items. Remove one first.'); return; }
    this.checkQuests();
    this.onChange();
  }
  upgradeCart(c: Cart, k: 'speed' | 'sign' | 'style') {
    const lv = c.lv[k];
    const cost = CART_UP[k][lv + 1];
    if (cost === undefined) return;
    if (!this.spend(cost, 'the upgrade')) return;
    c.lv[k]++;
    this.s.stats.surveys += 0;
    this.upgraded = true;
    this.checkQuests();
    this.onChange();
  }
  upgraded = false;

  unitRent(b: Building) { return Math.max(30, Math.round((b.value * 0.0016) / b.units / 10) * 10); }
  shopsIn(b: number) { return this.s.shops.filter((s) => s.b === b); }
  openShop(b: Building, type: string): Shop | null {
    if (this.shopsIn(b.id).length >= b.units) { this.onToast('No rooms left in this building'); return null; }
    if (this.fac(b.id)) { this.onToast('This building is a facility now'); return null; }
    const t = SHOP_BY[type];
    const rent = this.isMine(b.id) ? 0 : this.unitRent(b);
    if (!this.spend(t.fitout + rent, 'the fit-out')) return null;
    const prices: Record<string, number> = {};
    const stock: Store = {};
    for (const m of t.items) { prices[m.id] = m.fair; stock[m.good] = (stock[m.good] ?? 0) + Math.ceil(m.use * 20); }
    const sh: Shop = { id: this.s.ids++, b: b.id, type, prices, lv: { crew: 0, decor: 0, ads: 0 }, stock, served: 0, sales: 0, today: 0, rent, auto: true };
    this.s.shops.push(sh);
    this.log(`${this.s.company} opened a ${t.name} at ${b.name || b.addr}`, 'me');
    this.checkQuests();
    this.onChange();
    return sh;
  }
  closeShop(sh: Shop) { this.s.shops = this.s.shops.filter((o) => o !== sh); this.onChange(); }
  upgradeShop(sh: Shop, k: 'crew' | 'decor' | 'ads') {
    const cost = SHOP_UP[k][sh.lv[k] + 1];
    if (cost === undefined || !this.spend(cost, 'the upgrade')) return;
    sh.lv[k]++;
    this.upgraded = true;
    this.checkQuests();
    this.onChange();
  }

  isMine(b: number) { return this.s.owned.includes(b); }
  ownerOf(b: number): number { if (this.isMine(b)) return -1; const r = this.s.rivalOwn[b]; return r === undefined ? -2 : r; }
  buildingPrice(b: Building): number {
    const base = b.value * this.s.propVal;
    const r = this.s.rivalOwn[b.id];
    if (r !== undefined) return Math.round(base * 1.6);
    if (this.s.forSale.includes(b.id)) return Math.round(base * 0.85);
    return Math.round(base * 1.1);
  }
  buyBuilding(b: Building): boolean {
    if (this.isMine(b.id)) return false;
    const price = this.buildingPrice(b);
    if (!this.spend(price, 'the building')) return false;
    const r = this.s.rivalOwn[b.id];
    if (r !== undefined) { delete this.s.rivalOwn[b.id]; this.s.rivals[r].nw += price * 0.3; }
    this.s.forSale = this.s.forSale.filter((x) => x !== b.id);
    this.s.owned.push(b.id);
    for (const sh of this.shopsIn(b.id)) sh.rent = 0;
    this.log(`${this.s.company} bought ${b.name || b.addr} for ${money(price)}`, 'me');
    this.checkQuests();
    this.onChange();
    return true;
  }
  sellBuilding(b: Building) {
    if (!this.isMine(b.id)) return;
    const f = this.fac(b.id);
    const val = Math.round(b.value * this.s.propVal * 0.9 + (f ? FAC_BY[f.type].cost * 0.5 : 0));
    this.s.cash += val;
    this.s.owned = this.s.owned.filter((x) => x !== b.id);
    this.s.facs = this.s.facs.filter((x) => x.b !== b.id);
    for (const sh of this.shopsIn(b.id)) sh.rent = this.unitRent(b);
    this.onChange();
  }
  tenantRent(b: Building): number {
    if (!this.isMine(b.id) || this.fac(b.id)) return 0;
    const free = b.units - this.shopsIn(b.id).length;
    // whole-building income: offices/flats above plus the free ground-floor rooms
    return Math.round(b.value * this.s.propVal * 0.028 * (0.6 + 0.4 * (free / b.units)));
  }

  missingMats(type: string): { g: GoodId; n: number; cost: number }[] {
    const f = FAC_BY[type];
    const out: { g: GoodId; n: number; cost: number }[] = [];
    for (const [g, n] of Object.entries(f.mats) as [GoodId, number][]) {
      const have = this.totalStock(g);
      if (have < n) out.push({ g, n: n - have, cost: (n - have) * this.buyPrice(g) });
    }
    return out;
  }
  totalStock(g: GoodId): number {
    let n = 0;
    for (const f of this.s.facs) n += f.store[g] ?? 0;
    for (const q of this.s.quarries) n += q.store[g] ?? 0;
    return n;
  }
  takeStock(g: GoodId, n: number) {
    for (const src of [...this.s.facs.map((f) => f.store), ...this.s.quarries.map((q) => q.store)]) {
      const k = Math.min(n, src[g] ?? 0);
      if (k > 0) { src[g] = (src[g] ?? 0) - k; n -= k; }
      if (n <= 0) return;
    }
  }
  develop(b: Building, type: string): boolean {
    if (!this.isMine(b.id)) return false;
    const f = FAC_BY[type];
    const miss = this.missingMats(type);
    const total = f.cost + miss.reduce((a, m) => a + m.cost, 0);
    if (!this.spend(total, f.name)) return false;
    for (const [g, n] of Object.entries(f.mats) as [GoodId, number][]) this.takeStock(g, Math.min(n, this.totalStock(g)));
    for (const sh of this.shopsIn(b.id)) this.closeShop(sh);
    this.s.facs = this.s.facs.filter((x) => x.b !== b.id);
    const buildT = Math.max(2, Math.min(12, f.cost / 8000));
    this.s.facs.push({ b: b.id, type, lv: 1, build: 0, buildT, store: {}, autoSell: true, auto: true, made: 0 });
    this.log(`${this.s.company} broke ground on a new ${f.name} at ${b.addr}`, 'me');
    this.checkQuests();
    this.onChange();
    return true;
  }
  upgradeFac(f: Fac) {
    const cost = Math.round(FAC_BY[f.type].cost * (FAC_UP[f.lv] ?? 99));
    if (f.lv >= 5 || !this.spend(cost, 'the upgrade')) return;
    f.lv++;
    this.upgraded = true;
    this.onChange();
  }
  facUpCost(f: Fac) { return f.lv >= 5 ? 0 : Math.round(FAC_BY[f.type].cost * FAC_UP[f.lv]); }
  facRate(f: Fac) { return 1 + 0.8 * (f.lv - 1); }

  survey(x: number, z: number): Deposit[] {
    const cost = SURVEY_COST(this.s.stats.surveys);
    if (!this.spend(cost, 'a survey')) return [];
    this.s.stats.surveys++;
    const found = this.s.deposits.filter((d) => !d.found && Math.hypot(d.x - x, d.z - z) < 140);
    for (const d of found) d.found = true;
    if (found.length) this.onToast(`Found ${found.length} deposit${found.length > 1 ? 's' : ''}: ${found.map((d) => ORE_BY[d.ore].name).join(', ')}`, 'good');
    else this.onToast('Nothing down there. Try another block.');
    this.checkQuests();
    this.onChange();
    return found;
  }
  claimCost(d: Deposit) { return ORE_BY[d.ore].claim; }
  stake(d: Deposit): Quarry | null {
    if (d.claimed) return null;
    if (!this.spend(this.claimCost(d), 'the claim')) return null;
    d.claimed = true;
    const q: Quarry = { id: this.s.ids++, dep: d.id, x: d.x, z: d.z, lv: 1, store: {}, autoSell: true, mined: 0 };
    this.s.quarries.push(q);
    const on = ORE_BY[d.ore].name.toLowerCase();
    this.log(`${this.s.company} staked ${/^[aeiou]/.test(on) ? 'an' : 'a'} ${on} quarry`, 'me');
    this.checkQuests();
    this.onChange();
    return q;
  }
  quarryUpCost(q: Quarry) { return q.lv >= 5 ? 0 : Math.round(this.claimCost(this.s.deposits[q.dep]) * FAC_UP[q.lv]); }
  upgradeQuarry(q: Quarry) {
    const c = this.quarryUpCost(q);
    if (!c || !this.spend(c, 'the upgrade')) return;
    q.lv++;
    this.upgraded = true;
    this.onChange();
  }

  truckCost() { return TRUCK_COST(this.s.trucks); }
  buyTruck() {
    if (!this.spend(this.truckCost(), 'a truck')) return;
    this.s.trucks++;
    this.addTruck(true);
    this.checkQuests();
    this.onChange();
  }
  private addTruck(own: boolean, node?: number): Vehicle {
    const n = node ?? this.homeNode();
    const v: Vehicle = { id: this.vid++, own, path: [n], seg: 0, s: 0, x: this.city.nx[n], z: this.city.nz[n], dir: 0, good: null, n: 0, from: '', to: '', phase: 'idle', wait: 0, node: n, speed: own ? 15 : 13 };
    this.vehicles.push(v);
    return v;
  }
  private homeNode() {
    const f = this.s.facs[0];
    if (f) { const b = this.city.buildings[f.b]; return this.city.nearestNode(b.door.x, b.door.z); }
    const c = this.myCarts()[0];
    if (c) return this.city.nearestNode(c.x, c.z);
    return this.terminal;
  }

  // ------------------------------------------------------------------ the Exchange
  stockByGood(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const src of [...this.s.facs.map((f) => f.store), ...this.s.quarries.map((q) => q.store)])
      for (const [g, n] of Object.entries(src)) out[g] = (out[g] ?? 0) + (n as number);
    return out;
  }
  sell(g: GoodId, n: number): number {
    n = Math.min(n, this.totalStock(g));
    if (n < 1) return 0;
    n = Math.floor(n);
    const got = this.marketSell(g, n);
    this.takeStock(g, n);
    this.s.stats.sold += n;
    this.checkQuests();
    this.onChange();
    return got;
  }
  private marketSell(g: GoodId, n: number): number {
    const got = n * this.sellPrice(g) * (1 + this.trophyBonus());
    this.s.cash += got;
    this.dayLedger.income += got;
    this.incAcc += got;
    this.s.mult[g] *= Math.exp(-n / (5000 / Math.sqrt(GOODS[g].price)));
    return got;
  }
  /** Buy on the Exchange: a courier brings it from the freight terminal to the site that needs it. */
  buy(g: GoodId, n: number, to: string): boolean {
    const cost = n * this.buyPrice(g) * (1 + COURIER_FEE);
    if (!this.spend(cost, `${n} ${GOODS[g].name}`)) return false;
    this.s.mult[g] *= Math.exp(n / (8000 / Math.sqrt(GOODS[g].price)));
    const v = this.addTruck(false, this.terminal);
    this.route(v, to, g, n);
    return true;
  }

  // ------------------------------------------------------------------ the truck network
  siteNode(key: string): number {
    const [k, idS] = key.split(':');
    const id = +idS;
    if (k === 'c') { const c = this.cart(id); return c ? this.city.nearestNode(c.x, c.z) : this.terminal; }
    if (k === 's') { const s = this.shop(id); if (!s) return this.terminal; const b = this.city.buildings[s.b]; return this.city.nearestNode(b.door.x, b.door.z); }
    if (k === 'f') { const b = this.city.buildings[id]; return this.city.nearestNode(b.door.x, b.door.z); }
    if (k === 'q') { const q = this.s.quarries.find((o) => o.id === id); return q ? this.city.nearestNode(q.x, q.z) : this.terminal; }
    return this.terminal;
  }
  siteStore(key: string): Store | null {
    const [k, idS] = key.split(':');
    const id = +idS;
    if (k === 'c') return this.cart(id)?.stock ?? null;
    if (k === 's') return this.shop(id)?.stock ?? null;
    if (k === 'f') return this.fac(id)?.store ?? null;
    if (k === 'q') return this.s.quarries.find((o) => o.id === id)?.store ?? null;
    return null;
  }
  private needs(): { key: string; g: GoodId; want: number; auto: boolean }[] {
    const out: { key: string; g: GoodId; want: number; auto: boolean }[] = [];
    for (const c of this.myCarts()) {
      const per = new Map<GoodId, number>();
      for (const id of c.menu) { const m = MENU_BY[id]; per.set(m.good, (per.get(m.good) ?? 0) + m.use * 40); }
      for (const [g, w] of per) out.push({ key: 'c:' + c.id, g, want: Math.max(2, Math.round(w)), auto: c.auto });
    }
    for (const s of this.s.shops) {
      const per = new Map<GoodId, number>();
      for (const m of SHOP_BY[s.type].items) per.set(m.good, (per.get(m.good) ?? 0) + m.use * (40 + 20 * s.lv.crew));
      for (const [g, w] of per) out.push({ key: 's:' + s.id, g, want: Math.round(w), auto: s.auto });
    }
    for (const f of this.s.facs) {
      const t = FAC_BY[f.type];
      if (f.build < 1 || !t.recipe) continue;
      for (const [g, n] of Object.entries(t.recipe.inp) as [GoodId, number][]) out.push({ key: 'f:' + f.b, g, want: Math.round(n * this.facRate(f) * 6), auto: f.auto });
    }
    return out;
  }
  private suppliers(g: GoodId): { key: string; avail: number; x: number; z: number }[] {
    const out: { key: string; avail: number; x: number; z: number }[] = [];
    for (const f of this.s.facs) {
      const t = FAC_BY[f.type];
      const makes = t.recipe?.out[g] !== undefined || t.id === 'warehouse';
      if (!makes) continue;
      const key = 'f:' + f.b;
      const avail = (f.store[g] ?? 0) - (this.reserved.get(key + '|' + g) ?? 0);
      const b = this.city.buildings[f.b];
      if (avail >= 1) out.push({ key, avail, x: b.door.x, z: b.door.z });
    }
    for (const q of this.s.quarries) {
      const key = 'q:' + q.id;
      const avail = (q.store[g] ?? 0) - (this.reserved.get(key + '|' + g) ?? 0);
      if (avail >= 1) out.push({ key, avail, x: q.x, z: q.z });
    }
    return out;
  }
  private network() {
    const needs = this.needs();
    const idle = this.vehicles.filter((v) => v.own && v.phase === 'idle');
    for (const nd of needs) {
      const st = this.siteStore(nd.key);
      if (!st) continue;
      const have = (st[nd.g] ?? 0) + (this.incoming.get(nd.key + '|' + nd.g) ?? 0);
      if (have >= nd.want * 0.5) continue;
      const deficit = nd.want - have;
      const sup = this.suppliers(nd.g);
      const nn = this.siteNode(nd.key);
      if (sup.length && idle.length) {
        const tx = this.city.nx[nn], tz = this.city.nz[nn];
        sup.sort((a, b) => Math.hypot(a.x - tx, a.z - tz) - Math.hypot(b.x - tx, b.z - tz));
        const s = sup[0];
        const n = Math.min(TRUCK_CAP, Math.ceil(deficit), Math.floor(s.avail));
        if (n < 1) continue;
        idle.sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
        const v = idle.shift()!;
        this.reserved.set(s.key + '|' + nd.g, (this.reserved.get(s.key + '|' + nd.g) ?? 0) + n);
        v.from = s.key;
        this.route(v, nd.key, nd.g, n);
        continue;
      }
      if (sup.length) continue; // our own stock exists: wait for a truck
      if (nd.auto) {
        const n = Math.max(1, Math.ceil(deficit));
        const cost = n * this.buyPrice(nd.g) * (1 + COURIER_FEE);
        if (this.s.cash > cost + 50) this.buy(nd.g, n, nd.key);
      }
    }
    // surplus with nowhere to go: sell it (auto-sell) or send it to a warehouse
    for (const f of this.s.facs) {
      const t = FAC_BY[f.type];
      if (!t.recipe || f.build < 1) continue;
      for (const g of Object.keys(t.recipe.out) as GoodId[]) {
        const n = f.store[g] ?? 0;
        const wanted = needs.some((nd) => nd.g === g);
        if (f.autoSell && n > t.cap * 0.35 && !wanted) this.marketSell(g, Math.floor(n * 0.6)), (f.store[g] = n - Math.floor(n * 0.6));
        else if (n > t.cap * 0.9 && f.autoSell) this.marketSell(g, Math.floor(n * 0.3)), (f.store[g] = n - Math.floor(n * 0.3));
      }
    }
    for (const q of this.s.quarries) {
      const d = this.s.deposits[q.dep];
      const n = q.store[d.ore] ?? 0;
      const wanted = needs.some((nd) => nd.g === d.ore);
      if (q.autoSell && n > (wanted ? 260 : 60)) { const k = Math.floor(n * 0.7); this.marketSell(d.ore, k); q.store[d.ore] = n - k; }
    }
  }
  private route(v: Vehicle, to: string, g: GoodId, n: number) {
    v.good = g; v.n = n; v.to = to;
    this.incoming.set(to + '|' + g, (this.incoming.get(to + '|' + g) ?? 0) + n);
    if (v.own && v.from) {
      v.phase = 'pick';
      this.setPath(v, this.siteNode(v.from));
    } else {
      v.phase = 'drop';
      this.setPath(v, this.siteNode(to));
    }
  }
  private setPath(v: Vehicle, node: number) {
    const p = this.city.path(v.node, node, true) ?? [v.node, node];
    v.path = p; v.seg = 0; v.s = 0;
  }
  private moveVehicles(dt: number) {
    const c = this.city;
    for (const v of this.vehicles) {
      if (v.phase === 'idle') continue;
      if (v.wait > 0) { v.wait -= dt; continue; }
      let move = v.speed * dt;
      while (move > 0 && v.seg < v.path.length - 1) {
        const a = v.path[v.seg], b = v.path[v.seg + 1];
        const L = Math.hypot(c.nx[b] - c.nx[a], c.nz[b] - c.nz[a]) || 0.01;
        const rem = L - v.s;
        if (move < rem) { v.s += move; move = 0; }
        else { move -= rem; v.seg++; v.s = 0; }
        v.node = v.path[Math.min(v.seg, v.path.length - 1)];
      }
      if (v.seg < v.path.length - 1) {
        const a = v.path[v.seg], b = v.path[v.seg + 1];
        const L = Math.hypot(c.nx[b] - c.nx[a], c.nz[b] - c.nz[a]) || 0.01;
        const ux = (c.nx[b] - c.nx[a]) / L, uz = (c.nz[b] - c.nz[a]) / L;
        v.x = c.nx[a] + ux * v.s - uz * 2.4; // keep right
        v.z = c.nz[a] + uz * v.s + ux * 2.4;
        v.dir = Math.atan2(ux, uz);
      } else this.arrive(v);
    }
    this.vehicles = this.vehicles.filter((v) => v.own || v.phase !== 'idle');
  }
  private arrive(v: Vehicle) {
    if (v.phase === 'pick') {
      const st = this.siteStore(v.from);
      const key = v.from + '|' + v.good;
      this.reserved.set(key, Math.max(0, (this.reserved.get(key) ?? 0) - v.n));
      if (st && v.good) { const k = Math.min(v.n, st[v.good] ?? 0); st[v.good] = (st[v.good] ?? 0) - k; const short = v.n - k; v.n = k; if (short > 0) this.incoming.set(v.to + '|' + v.good, Math.max(0, (this.incoming.get(v.to + '|' + v.good) ?? 0) - short)); }
      v.phase = 'drop';
      v.wait = 1.2;
      this.setPath(v, this.siteNode(v.to));
      return;
    }
    if (v.phase === 'drop') {
      const st = this.siteStore(v.to);
      if (st && v.good) st[v.good] = (st[v.good] ?? 0) + v.n;
      this.incoming.set(v.to + '|' + v.good, Math.max(0, (this.incoming.get(v.to + '|' + v.good) ?? 0) - v.n));
      v.good = null; v.n = 0; v.from = ''; v.to = '';
      if (v.own) { v.phase = 'idle'; v.wait = 0.8; }
      else { v.phase = 'leave'; this.setPath(v, this.terminal); }
      return;
    }
    if (v.phase === 'leave') v.phase = 'idle'; // couriers drop off the map
  }

  // ------------------------------------------------------------------ production + days
  private produce(hours: number) {
    for (const f of this.s.facs) {
      const t = FAC_BY[f.type];
      if (f.build < 1) { f.build = Math.min(1, f.build + hours / f.buildT); if (f.build >= 1) { this.onToast(`${t.name} is open for business`, 'good'); this.log(`${this.s.company}'s ${t.name} is open`, 'me'); this.onChange(); } continue; }
      if (!t.recipe) continue;
      const rate = this.facRate(f) * hours;
      let frac = 1;
      for (const [g, n] of Object.entries(t.recipe.inp) as [GoodId, number][]) frac = Math.min(frac, (f.store[g] ?? 0) / (n * rate));
      let outN = 0;
      for (const n of Object.values(t.recipe.out)) outN += n as number;
      const used = Object.values(f.store).reduce((a, b) => a + (b as number), 0);
      frac = Math.max(0, Math.min(frac, (t.cap - used) / Math.max(1e-6, outN * rate)));
      if (frac <= 0) continue;
      for (const [g, n] of Object.entries(t.recipe.inp) as [GoodId, number][]) f.store[g] = (f.store[g] ?? 0) - n * rate * frac;
      for (const [g, n] of Object.entries(t.recipe.out) as [GoodId, number][]) { f.store[g] = (f.store[g] ?? 0) + n * rate * frac; f.made += n * rate * frac; }
    }
    for (const q of this.s.quarries) {
      const d = this.s.deposits[q.dep];
      if (d.left <= 0) continue;
      const o = ORE_BY[d.ore];
      const n = Math.min(d.left, o.rate * (1 + 0.8 * (q.lv - 1)) * hours);
      const have = q.store[d.ore] ?? 0;
      const k = Math.min(n, 400 - have);
      if (k <= 0) continue;
      d.left -= k;
      q.store[d.ore] = have + k;
      q.mined += k;
      if (d.left <= 0) { this.onToast(`${o.name} quarry is dug out. Survey for more!`); this.log(`${this.s.company}'s ${o.name.toLowerCase()} quarry ran dry`, 'me'); }
    }
  }

  private newDay() {
    const s = this.s;
    let wages = 0, rent = 0, income = 0;
    for (const sh of s.shops) { rent += sh.rent; wages += 60 * (1 + sh.lv.crew); sh.today = 0; }
    for (const f of s.facs) wages += FAC_BY[f.type].wage * f.lv;
    for (const q of s.quarries) wages += 40 * q.lv;
    wages += s.trucks * 30;
    for (const c of this.myCarts()) { wages += 10; c.today = 0; }
    for (const id of s.owned) {
      const b = this.city.buildings[id];
      income += this.tenantRent(b);
      const f = this.fac(id);
      if (f && FAC_BY[f.type].rent && f.build >= 1) income += (FAC_BY[f.type].rent ?? 0) * f.lv;
    }
    income *= 1 + this.trophyBonus();
    s.cash += income - wages - rent;
    this.dayLedger.income += income;
    this.dayLedger.expense += wages + rent;
    this.incAcc += income;
    const L = this.dayLedger;
    this.onToast(`Day ${this.day}: +${money(L.income)} in, −${money(L.expense)} out`, L.income >= L.expense ? 'good' : 'bad');
    this.dayLedger = { income: 0, expense: 0 };
    // property market drifts up
    s.propVal *= 1 + 0.004 + (Math.random() - 0.45) * 0.006;
    this.rollEvent();
    // rivals act
    const R = Math.random;
    for (let i = 0; i < 2; i++) {
      const ri = Math.floor(R() * s.rivals.length);
      const r = s.rivals[ri];
      const b = this.city.buildings[Math.floor(R() * this.city.buildings.length)];
      if (!this.isMine(b.id) && s.rivalOwn[b.id] === undefined && R() < 0.6) {
        s.rivalOwn[b.id] = ri;
        this.log(`${r.name} bought ${b.name || b.addr} for ${money(b.value * s.propVal)}`, 'rival');
        this.onChange();
      } else {
        const g = GOOD_IDS[Math.floor(R() * GOOD_IDS.length)];
        const n = Math.round(50 + R() * 600);
        this.log(`${r.name} ${R() < 0.5 ? 'sold' : 'bought'} ${n} ${GOODS[g].name} @ ${money(this.price(g))}`, 'rival');
      }
    }
    if ((this.day - 1) % DAYS_PER_MONTH === 0 && this.day > 1) this.endMonth();
  }

  private rollEvent() {
    const R = Math.random;
    const r = R();
    const day = this.day;
    let ev: Event | null = null;
    if (r < 0.28) {
      const busy = this.city.edges.map((e, i) => ({ e, i })).filter((x) => x.e.name && x.e.cls >= 2);
      const pick = busy[Math.floor(R() * busy.length)];
      if (pick) ev = { kind: 'festival', edge: pick.i, day, text: `Street festival on ${pick.e.name} today: crowds everywhere` };
    } else if (r < 0.42) ev = { kind: 'heat', day, text: 'Heatwave! Lemonade and ice cream sell twice as fast' };
    else if (r < 0.56) ev = { kind: 'rain', day, text: 'Rainy day: fewer people out, coffee is flying' };
    else if (r < 0.8) {
      const g = GOOD_IDS[Math.floor(R() * GOOD_IDS.length)];
      const up = R() < 0.55;
      this.s.mult[g] *= up ? 1.25 + R() * 0.2 : 0.7 + R() * 0.1;
      ev = { kind: 'boom', good: g, day, text: `${GOODS[g].name} ${up ? 'soars' : 'slumps'} on the Exchange (${up ? '+' : '−'}${Math.round(Math.abs(this.s.mult[g] - 1) * 100)}%)` };
    }
    this.s.events = this.s.events.filter((e) => e.day >= day - 1);
    if (ev) { this.s.events.push(ev); this.log(ev.text, ev.kind === 'boom' ? 'market' : 'city'); this.onToast(ev.text, 'city'); }
  }

  festivalEdge(): number { const e = this.todayEvent('festival'); return e?.edge ?? -1; }

  private endMonth() {
    const rows = this.standings();
    const rank = rows.findIndex((r) => r.me) + 1;
    if (rank <= 3) this.s.trophies.push(rank);
    rows.forEach((r, i) => { if (!r.me && i < 3) { const rv = this.s.rivals.find((x) => x.name === r.name); if (rv) rv.trophies[i]++; } });
    this.s.stats.bestRank = Math.min(this.s.stats.bestRank, rank);
    this.s.stats.lastGrowth = Math.max(0, rows.find((r) => r.me)!.growth);
    this.onMonth(rank, rows);
    this.s.stats.monthStart = this.netWorth();
    this.planRivals();
    this.log(`Month ${this.month - 1} closed: ${rows[0].name} took gold`, 'city');
    this.checkQuests();
  }

  standings(): { name: string; growth: number; nw: number; me: boolean; color: string }[] {
    const nw = this.netWorth();
    const rows = this.s.rivals.map((r) => ({ name: r.name, growth: r.nw - r.start, nw: r.nw, me: false, color: r.color }));
    rows.push({ name: this.s.company, growth: nw - this.s.stats.monthStart, nw, me: true, color: '#ffc83d' });
    return rows.sort((a, b) => b.growth - a.growth);
  }

  // ------------------------------------------------------------------ worth
  netWorth(): number {
    const s = this.s;
    let nw = s.cash;
    for (const id of s.owned) nw += this.city.buildings[id].value * s.propVal;
    for (const f of s.facs) nw += FAC_BY[f.type].cost * (0.6 + 0.3 * (f.lv - 1)) * f.build;
    for (const c of this.myCarts()) nw += 150 + (c.lv.speed + c.lv.sign + c.lv.style) * 200;
    for (const sh of s.shops) nw += SHOP_BY[sh.type].fitout * 0.5 + (sh.lv.crew + sh.lv.decor + sh.lv.ads) * 600;
    for (const q of s.quarries) { const d = s.deposits[q.dep]; nw += d.left * this.price(d.ore) * 0.2 + this.claimCost(d) * 0.3; }
    const st = this.stockByGood();
    for (const [g, n] of Object.entries(st)) nw += n * this.sellPrice(g as GoodId);
    nw += s.trucks * 1500;
    return nw;
  }

  // ------------------------------------------------------------------ goals
  checkQuests() {
    const s = this.s;
    const q = QUESTS[s.quest];
    if (!q) return;
    const nw = this.netWorth();
    const done = ({
      cart1: () => this.myCarts().length >= 1,
      serve10: () => s.stats.served >= 10,
      menu2: () => this.myCarts().some((c) => c.menu.length >= 2),
      earn1k: () => s.stats.sales >= 1000,
      cart2: () => this.myCarts().length >= 2,
      upgrade: () => this.upgraded || this.myCarts().some((c) => c.lv.speed + c.lv.sign + c.lv.style > 0),
      shop: () => s.shops.length >= 1,
      survey: () => s.stats.surveys >= 1,
      quarry: () => s.quarries.length >= 1,
      sell100: () => s.stats.sold >= 100,
      building: () => s.owned.length >= 1,
      truck: () => s.trucks >= 1,
      facility: () => s.facs.length >= 1,
      nw100k: () => nw >= 1e5,
      top3: () => s.trophies.length >= 1,
      nw1m: () => nw >= 1e6,
      nw10m: () => nw >= 1e7,
    } as Record<string, () => boolean>)[q.id]?.();
    if (done) {
      s.cash += q.reward;
      s.quest++;
      this.onQuest(s.quest - 1);
      this.checkQuests();
    }
  }

  // ------------------------------------------------------------------ the clock
  step(dtReal: number, speed: number) {
    const dt = dtReal * speed;
    const hours = dt / SEC_PER_HOUR;
    this.s.t += hours;
    this.produce(hours);
    this.moveVehicles(dt);
    this.netT += dt;
    if (this.netT > 1) { this.netT = 0; this.network(); }
    const hi = Math.floor(this.s.t);
    if (hi !== this.lastHourInt) {
      this.lastHourInt = hi;
      // the market breathes every game hour, rivals grow toward this month's target
      for (const g of GOOD_IDS) {
        const m = this.s.mult[g];
        this.s.mult[g] = Math.max(0.35, Math.min(3, m + (1 - m) * 0.04 + (Math.random() - 0.5) * GOODS[g].vol * 0.6));
        const h = this.s.hist[g]; h.push(this.s.mult[g]); if (h.length > 48) h.shift();
      }
      const hr = hi % 24;
      const rush: Record<number, string> = { 8: 'Morning rush: coffee lines incoming', 12: 'Lunch rush: hot dogs, tacos and burgers fly out', 18: 'Evening rush: the streets are packed', 22: 'Night owls out: tacos sell best now' };
      if (rush[hr] && (this.myCarts().length || this.s.shops.length)) this.onToast(rush[hr], 'city');
      const per = 1 / (DAYS_PER_MONTH * 24);
      for (const r of this.s.rivals) r.nw += r.target * per * (0.5 + Math.random());
      this.checkQuests();
    }
    const d = Math.floor(this.s.t / 24);
    if (d !== this.lastDay) { this.lastDay = d; this.newDay(); }
    this.incT += dtReal;
    if (this.incT > 2) { this.incomeRate = this.incomeRate * 0.7 + (this.incAcc / this.incT) * 0.3; this.incAcc = 0; this.incT = 0; }
  }

  /** Offline: everything kept earning at a steadier, slower pace. Returns a summary. */
  catchUp(realSec: number): { sec: number; earned: number; mined: number; made: number } | null {
    const sec = Math.min(realSec, 6 * 3600);
    if (sec < 60) return null;
    const cash0 = this.s.cash;
    let mined = 0, made = 0;
    const m0 = this.s.quarries.reduce((a, q) => a + q.mined, 0), f0 = this.s.facs.reduce((a, f) => a + f.made, 0);
    // stores and carts: average takings per game hour from how they did, at 50%
    const gameHours = Math.min(sec / SEC_PER_HOUR, 24 * 3);
    const perHour = (o: { served: number; sales: number }) => (o.served > 3 ? o.sales / Math.max(1, this.s.t - 7.5) : 0);
    let take = 0;
    for (const c of this.myCarts()) take += perHour(c);
    for (const sh of this.s.shops) take += perHour(sh);
    take = Math.min(take, 20000) * gameHours * 0.5;
    this.s.cash += take;
    // production keeps running (auto-sold), in chunks so stores cycle
    const chunk = 2;
    for (let h = 0; h < gameHours; h += chunk) { this.produce(chunk); this.network(); for (const v of this.vehicles) if (v.phase !== 'idle') { v.path = [v.path[v.path.length - 1]]; this.arrive(v); if ((v.phase as string) !== 'idle') this.arrive(v); } }
    this.s.t += gameHours;
    this.lastDay = Math.floor(this.s.t / 24);
    this.lastHourInt = Math.floor(this.s.t);
    mined = this.s.quarries.reduce((a, q) => a + q.mined, 0) - m0;
    made = this.s.facs.reduce((a, f) => a + f.made, 0) - f0;
    return { sec, earned: this.s.cash - cash0, mined, made };
  }

  log(text: string, kind: Tick['kind']) {
    this.ticker.push({ t: this.s.t, text, kind });
    if (this.ticker.length > 40) this.ticker.shift();
  }
  streetAt(x: number, z: number): string {
    const q = this.city.nearestEdge(x, z, 60);
    return (q && this.city.edges[q.e].name) || 'a side street';
  }

  serialize(): string {
    // goods on the road are delivered on save, so nothing is ever lost
    const s = JSON.parse(JSON.stringify(this.s)) as SaveState;
    s.savedAt = Date.now();
    return JSON.stringify(s);
  }
}

export function money(n: number, dec = false): string {
  const neg = n < 0;
  n = Math.abs(n);
  let s: string;
  if (n >= 1e9) s = '$' + (n / 1e9).toFixed(2) + 'B';
  else if (n >= 1e6) s = '$' + (n / 1e6).toFixed(2) + 'M';
  else if (n >= 1e4) s = '$' + Math.round(n).toLocaleString('en-US');
  else s = '$' + (dec ? n.toFixed(2) : Math.round(n).toLocaleString('en-US'));
  return (neg ? '−' : '') + s;
}
export { SEC_PER_HOUR };
