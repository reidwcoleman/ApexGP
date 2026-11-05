// Pine & Dandy: the whole game state and its rules. No DOM, no drawing: the renderer and audio read
// `fx` events, and tools/pinebot.mjs plays decades of it in Node to check the economy.
import { SPECIES, NS, NZ, MONTHS, MONTH_SEC, XMAS_DAY, SIZE_PRICE, SIZE_MIN, SIZE_NAME, SIZE_DEMAND, MIN_CUT, sizeIdx, GRADES, gradeOf, VEHICLES, CREW, CREW_NAMES, BUILDINGS, TIERS, RIVALS, PERKS, BUYERS, HERO_BUYERS, GOALS } from './data.ts';

export const MW = 256, MH = 160, PS = 16, PW = MW / PS, PH = MH / PS, CH = 32;
export const CW = MW / CH, CHH = MH / CH;
export const T_GRASS = 0, T_ROAD = 1, T_WATER = 2, T_ROCK = 3, T_WILD = 4, T_BRIDGE = 5;
export const F_PEST = 1, F_IMMUNE = 2, F_SHEARED = 4, F_THIRST = 8, F_GOLD = 16, F_WATERED = 32, F_DEAD = 64, F_STUMP = 128;
export const TOOL_SAW = 0, TOOL_PLANT = 1, TOOL_SHEAR = 2, TOOL_TANK = 3;
export const TOOL_NAMES = ['Saw', 'Planter', 'Shears', 'Tank'];

export interface Hopper { n: number; c: number[]; q: number[] }
export interface Ticket { id: number; buyer: string; sp: number; minZ: number; qty: number; filled: number; days: number; total: number; pay: number; hero: boolean; age: number }
export interface Strip { b: number; job: Job; y: number; rows: number; x: number; end: number; dir: number }
export type Job = 'cut' | 'plant' | 'shear';
export interface Agent { id: number; name: string; rank: number; x: number; y: number; dir: number; mode: 'idle' | 'work' | 'unload' | 'goal'; hop: Hopper; strip: Strip | null; gx: number; gy: number; gk: number; last: number; think: number; moving: boolean }
export interface Block { id: number; name: string; x: number; y: number; w: number; h: number; sp: number; cut: number; replant: boolean; shear: boolean; passJob: string; passNext: number }
export interface Critter { k: 'deer' | 'thief' | 'dog'; x: number; y: number; vx: number; vy: number; t: number; n: number; flee: boolean; tx: number; ty: number }
export interface Bld { k: string; x: number; y: number }
export interface YearStats { sold: number; revenue: number; retail: number; retailN: number; orders: number; ordersN: number; wholesale: number; wholesaleN: number; missed: number; wages: number; seeds: number; bills: number; planted: number; lost: number; lostSales: number; bestStreak: number; bonus: number }
export interface Report { year: number; y: YearStats; rivals: { name: string; sold: number; me?: boolean }[]; rank: number; letter: string; net: number; standing: number; tierUp: string | null }

export interface State {
  v: number; seed: number; year: number; month: number; day: number; dayF: number;
  money: number; debt: number; lifeSold: number; rep: number; streak: number; shield: number;
  p: { x: number; y: number; vx: number; vy: number; dir: number; hop: Hopper; tool: number; sel: number; cd: number; acting: boolean; moving: boolean; cutAt: number };
  veh: number; owned: number[]; unlocked: boolean[]; stock: number[]; stockQ: number[]; stockN: number;
  blds: Bld[]; blocks: Block[]; crew: Agent[]; nextId: number; critters: Critter[]; tickets: Ticket[]; priority: number;
  mkt: number[][]; perks: Record<string, number>; goal: number; goalsDone: number; stats: Record<string, number>;
  yr: YearStats; history: { year: number; sold: number; revenue: number; net: number }[]; rivals: number[];
  drought: number; blizzard: number; tv: number; gold: number; goldDays: number; thieves: number; ticketT: number; phase: 'play' | 'eve' | 'report'; tut: boolean; seen: Record<string, boolean>; rushBest: number;
}

export type Fx =
  | { k: 'chop'; x: number; y: number; sp: number; h: number; mine: boolean }
  | { k: 'plant' | 'shear' | 'spray' | 'clear' | 'dead'; x: number; y: number; mine: boolean }
  | { k: 'cash'; x: number; y: number; n: number }
  | { k: 'toast'; t: string; c?: string }
  | { k: 'big'; t: string; s?: string; c?: string }
  | { k: 'unload'; x: number; y: number; n: number }
  | { k: 'cust'; happy: boolean; n: number }
  | { k: 'order'; ok: boolean; t: Ticket; paid: number }
  | { k: 'newticket'; t: Ticket }
  | { k: 'goal'; t: string; cash: number }
  | { k: 'alarm'; t: string; x: number; y: number }
  | { k: 'ram'; x: number; y: number; t: string }
  | { k: 'full' } | { k: 'month' } | { k: 'season' } | { k: 'build' } | { k: 'buy' } | { k: 'deny' } | { k: 'saved' };

export const newHopper = (): Hopper => ({ n: 0, c: new Array(NS * NZ).fill(0), q: new Array(NS * NZ).fill(0) });
export const stageOf = (h: number) => h < 1.2 ? 0 : h < 2.5 ? 1 : h < 4 ? 2 : h < 5.5 ? 3 : h < 7 ? 4 : h < 9 ? 5 : h < 12 ? 6 : h < 18 ? 7 : 8;
const yrZero = (): YearStats => ({ sold: 0, revenue: 0, retail: 0, retailN: 0, orders: 0, ordersN: 0, wholesale: 0, wholesaleN: 0, missed: 0, wages: 0, seeds: 0, bills: 0, planted: 0, lost: 0, lostSales: 0, bestStreak: 0, bonus: 0 });
export const money = (n: number) => { const a = Math.abs(Math.round(n)); return (n < 0 ? '-$' : '$') + a.toLocaleString('en-US'); };
export const short = (n: number) => { const a = Math.abs(n); return a >= 1e6 ? (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M' : a >= 1e4 ? Math.round(n / 1e3) + 'k' : Math.round(n).toLocaleString('en-US'); };

function hash2(x: number, y: number, s = 0) { let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x: number, y: number, s: number) => vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 2) * 0.15;

export class Sim {
  N = MW * MH;
  terr = new Uint8Array(this.N); sp = new Uint8Array(this.N); h = new Float32Array(this.N); shape = new Uint8Array(this.N);
  flag = new Uint8Array(this.N); pest = new Uint8Array(this.N); fert = new Uint8Array(this.N); bld = new Int16Array(this.N); wet = new Uint8Array(this.N);
  ver = new Uint32Array(CW * CHH); terrVer = 0;
  infected: number[] = [];
  fx: Fx[] = [];
  s!: State;
  speed = 1; rs = 1; standing = 0; census = new Array(NS * NZ).fill(0);
  private claimRow = 0;

  rnd() { this.rs = (this.rs + 0x6d2b79f5) | 0; let t = Math.imul(this.rs ^ (this.rs >>> 15), 1 | this.rs); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  pick<T>(a: T[]) { return a[Math.floor(this.rnd() * a.length)]; }
  idx(x: number, y: number) { return y * MW + x; }
  inMap(x: number, y: number) { return x >= 0 && y >= 0 && x < MW && y < MH; }
  touch(i: number) { const x = i % MW, y = (i / MW) | 0; this.ver[((y / CH) | 0) * CW + ((x / CH) | 0)]++; }
  touchAll() { for (let i = 0; i < this.ver.length; i++) this.ver[i]++; }
  ownedAt(x: number, y: number) { if (!this.inMap(x, y)) return false; return !!this.s.owned[((y / PS) | 0) * PW + ((x / PS) | 0)]; }
  pk(id: string) { return this.s.perks[id] ?? 0; }
  emit(f: Fx) { if (this.fx.length < 500) this.fx.push(f); }
  toast(t: string, c?: string) { this.emit({ k: 'toast', t, c }); }
  once(key: string, t: string) { if (this.s.seen[key]) return; this.s.seen[key] = true; this.toast(t); }

  // ---- new game ---------------------------------------------------------------------------------------
  newGame(seed = (Math.random() * 1e9) | 0) {
    this.rs = seed;
    this.terr.fill(0); this.sp.fill(0); this.h.fill(0); this.shape.fill(0); this.flag.fill(0); this.pest.fill(0); this.bld.fill(0); this.wet.fill(0);
    this.infected = [];
    this.generate(seed);
    const mkt: number[][] = SPECIES.map(() => [1]);
    this.s = {
      v: 1, seed, year: 1, month: 10, day: 1, dayF: 0, money: 400, debt: 0, lifeSold: 0, rep: 50, streak: 0, shield: 0,
      p: { x: 125.5, y: 73.5, vx: 0, vy: 0, dir: 0, hop: newHopper(), tool: TOOL_SAW, sel: 1, cd: 0, acting: false, moving: false, cutAt: 4 },
      veh: 0, owned: new Array(PW * PH).fill(0), unlocked: SPECIES.map((s) => s.unlock === 0), stock: new Array(NS * NZ).fill(0), stockQ: new Array(NS * NZ).fill(0), stockN: 0,
      blds: [], blocks: [], crew: [], nextId: 1, critters: [], tickets: [], priority: -1, mkt, perks: {}, goal: 0, goalsDone: 0,
      stats: { cut: 0, unloaded: 0, tickets: 0, sold: 0, planted: 0, sheared: 0, outbreaks: 0 }, yr: yrZero(), history: [], rivals: RIVALS.map((r) => r.start),
      drought: 0, blizzard: 0, tv: 0, gold: -1, goldDays: 0, thieves: 0, ticketT: 2, phase: 'play', tut: true, seen: {}, rushBest: 0,
    };
    for (let i = 0; i < NS; i++) this.extendMarket(i, 8);
    this.s.owned[4 * PW + 7] = 1; this.s.owned[4 * PW + 8] = 1;
    this.place('house', 113, 66); this.place('barn', 120, 68); this.place('lot', 113, 73);
    // Mabel's grove: one block ready to cut, the rest coming along behind it
    for (let y = 65; y <= 76; y++) for (let x = 129; x <= 142; x++) {
      const i = this.idx(x, y), col = x - 129;
      this.sp[i] = 2; this.shape[i] = 50 + ((this.rnd() * 32) | 0);
      this.h[i] = col < 5 ? 5.6 + this.rnd() * 2.2 : col < 8 ? 4.4 + this.rnd() * 0.8 : col < 11 ? 2.8 + this.rnd() * 0.7 : 1.2 + this.rnd() * 0.7;
    }
    this.recount(); this.refreshCensus(); this.touchAll(); this.terrVer++;
    this.addTicket({ buyer: 'The Hendersons', sp: 1, minZ: 1, qty: 3, days: 26, pay: this.priceOf(1, 2, 70) * 1.6 });
  }

  private generate(seed: number) {
    const hx = 124, hy = 72;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = this.idx(x, y);
      this.fert[i] = Math.max(80, Math.min(190, 128 + (fbm(x / 26, y / 26, seed + 7) - 0.5) * 190 | 0));
      const d = Math.hypot(x - hx, (y - hy) * 1.1);
      const f = fbm(x / 21, y / 21, seed + 11), r = fbm(x / 9, y / 9, seed + 19);
      if (d > 30 && f > 0.585) this.terr[i] = T_WILD;
      else if (d > 26 && r > 0.72) this.terr[i] = T_ROCK;
      const edge = Math.min(x, y, MW - 1 - x, MH - 1 - y);
      if (edge < 3 + vnoise(x / 6, y / 6, seed) * 5) this.terr[i] = T_WILD;
    }
    // lakes
    for (let k = 0; k < 3; k++) {
      const cx = [50, 214, 70][k], cy = [36, 126, 124][k], r = [15, 12, 9][k];
      for (let y = cy - r * 2; y < cy + r * 2; y++) for (let x = cx - r * 2; x < cx + r * 2; x++) if (this.inMap(x, y)) {
        const d = Math.hypot(x - cx, (y - cy) * 1.3) / r + (vnoise(x / 5, y / 5, seed + k) - 0.5) * 0.7;
        if (d < 1) this.terr[this.idx(x, y)] = T_WATER;
      }
    }
    // the river, north to south
    for (let y = 0; y < MH; y++) {
      const rx = 178 + 15 * Math.sin(y / 22 + seed % 7) + 7 * Math.sin(y / 8.3 + 1), w = 2 + Math.floor(1.5 + Math.sin(y / 13));
      for (let x = Math.floor(rx - w); x <= rx + w; x++) if (this.inMap(x, y)) this.terr[this.idx(x, y)] = T_WATER;
    }
    // county road east-west, side road north-south, with bridges where they cross water
    for (let x = 0; x < MW; x++) for (const y of [78, 79]) { const i = this.idx(x, y); this.terr[i] = this.terr[i] === T_WATER ? T_BRIDGE : T_ROAD; }
    for (let y = 0; y < MH; y++) for (const x of [126, 127]) { const i = this.idx(x, y); this.terr[i] = this.terr[i] === T_WATER ? T_BRIDGE : T_ROAD; }
  }

  extendMarket(sp: number, upto: number) {
    const a = this.s.mkt[sp], v = SPECIES[sp].vol;
    while (a.length <= upto) {
      const g = (this.rnd() + this.rnd() + this.rnd() - 1.5) * 1.6;
      a.push(Math.max(0.55, Math.min(1.95, 1 + (a[a.length - 1] - 1) * 0.55 + g * v)));
    }
  }
  market(sp: number, yearsAhead = 0) { const y = this.s.year - 1 + yearsAhead; this.extendMarket(sp, y + 1); return this.s.mkt[sp][y]; }
  forecast(sp: number, k: number) {
    if (k <= 0) return this.market(sp, 0);
    const err = (hash2(sp, this.s.year + k, this.s.seed) - 0.5) * 0.34 * k * Math.pow(0.6, this.pk('crystal'));
    return Math.max(0.4, this.market(sp, k) + err);
  }

  // ---- derived ----------------------------------------------------------------------------------------
  get tier() { let t = 0; for (let i = 0; i < TIERS.length; i++) if (this.s.lifeSold >= TIERS[i].sold) t = i; return t; }
  bcount(k: string) { let n = 0; for (const b of this.s.blds) if (b.k === k) n++; return n; }
  get capacity() { let c = 0; for (const b of this.s.blds) c += BUILDINGS[b.k].store ?? 0; return c; }
  get lotCap() { let c = 0; for (const b of this.s.blds) c += BUILDINGS[b.k].lot ?? 0; return c; }
  get parcels() { let c = 0; for (const o of this.s.owned) c += o; return c; }
  get pull() { let c = 1; for (const b of this.s.blds) c += BUILDINGS[b.k].pull ?? 0; return c * (1 + 0.15 * this.pk('cocoa')); }
  get cheer() { return 1 + Math.min(this.s.streak, 25) * (0.08 + 0.015 * this.pk('cheer')); }
  growMult() { return (1 + 0.1 * this.pk('grow')) * (1 + Math.min(4, this.bcount('greenhouse')) * 0.06); }
  seedPrice(sp: number) { return SPECIES[sp].seed * Math.pow(0.75, this.pk('bulk')) * (this.bcount('greenhouse') ? 0.85 : 1); }
  hopCap() { return Math.round(VEHICLES[this.s.veh].cap * (1 + 0.4 * this.pk('hopper'))); }
  wage(a: Agent) { return CREW[a.rank].wage * Math.pow(0.85, this.pk('wages')); }
  landPrice(px: number, py: number) {
    const n = this.parcels, base = 350 + 70 * Math.pow(n, 1.42);
    return Math.round(base * (0.7 + this.parcelFert(px, py) * 0.5) * this.parcelClear(px, py) * Math.pow(0.88, this.pk('land')) / 10) * 10;
  }
  parcelFert(px: number, py: number) { let f = 0; for (let y = 0; y < PS; y += 2) for (let x = 0; x < PS; x += 2) f += this.fert[this.idx(px * PS + x, py * PS + y)]; return f / 64 / 128; }
  /** fraction of the parcel that can take a tree */
  parcelClear(px: number, py: number) { let f = 0; for (let y = 0; y < PS; y++) for (let x = 0; x < PS; x++) { const t = this.terr[this.idx(px * PS + x, py * PS + y)]; if (t === T_GRASS || t === T_WILD) f++; } return f / 256; }
  canBuyParcel(px: number, py: number) {
    if (px < 0 || py < 0 || px >= PW || py >= PH || this.s.owned[py * PW + px]) return false;
    return !!((px > 0 && this.s.owned[py * PW + px - 1]) || (px < PW - 1 && this.s.owned[py * PW + px + 1]) || (py > 0 && this.s.owned[(py - 1) * PW + px]) || (py < PH - 1 && this.s.owned[(py + 1) * PW + px]));
  }
  priceOf(sp: number, z: number, q: number) {
    let p = SPECIES[sp].base * SIZE_PRICE[z] * GRADES[gradeOf(q)].m * this.market(sp);
    if (z >= 3) p *= 1 + 0.2 * this.pk('tall');
    if (z <= 1) p *= 1 + 0.4 * this.pk('table');
    return p;
  }
  treeValue(i: number) { const s = this.sp[i]; if (!s || this.flag[i] & F_DEAD) return 0; return this.priceOf(s - 1, sizeIdx(this.h[i]), this.shape[i]); }
  net() { return this.s.money - this.s.debt; }
  loanLimit() { return Math.round((1500 + this.parcels * 900 + this.s.yr.revenue * 0.5 + this.s.lifeSold * 8) / 100) * 100; }
  harvestOpen() { const m = this.s.month; return m === 11 || m === 10 || (m === 9 && this.s.day >= 15); }
  retailOpen() { const s = this.s; return s.month === 11 || (s.month === 10 && s.day >= 22); }
  season() { const m = this.s.month; return m === 11 || m < 2 ? 0 : m < 5 ? 1 : m < 8 ? 2 : 3; }
  daysToXmas() { const s = this.s; if (s.month === 11) return XMAS_DAY - s.day; if (s.month === 10) return 30 - s.day + XMAS_DAY; return -1; }
  /** 0..1, how far the December dusk has come down */
  dusk() { const s = this.s; if (s.month !== 11) return s.month === 10 ? Math.max(0, (s.day - 20) / 10) * 0.15 : 0; return 0.14 + Math.pow(Math.min(1, (s.day + s.dayF) / XMAS_DAY), 1.8) * 0.66; }
  snowLevel() { const s = this.s; if (s.month === 11) return s.day < 4 ? 1 : s.day < 12 ? 2 : 3; if (s.month === 10) return s.day > 18 ? 1 : 0; if (s.month === 0) return 3; if (s.month === 1) return 2; if (s.month === 2) return s.day < 10 ? 1 : 0; return 0; }
  dateText() { const s = this.s; return `${MONTHS[s.month]} ${s.day}`; }

  recount() {
    let n = 0; this.infected = [];
    for (let i = 0; i < this.N; i++) if (this.sp[i] && !(this.flag[i] & F_DEAD)) { n++; if (this.flag[i] & F_PEST) this.infected.push(i); }
    this.standing = n;
  }
  refreshCensus() {
    this.census.fill(0);
    for (let i = 0; i < this.N; i++) { const s = this.sp[i]; if (s && !(this.flag[i] & F_DEAD) && this.ownedTile(i) && this.h[i] >= MIN_CUT) this.census[(s - 1) * NZ + sizeIdx(this.h[i])]++; }
    for (let i = 0; i < NS * NZ; i++) this.census[i] += this.s.stock[i];
  }
  ownedTile(i: number) { const x = i % MW, y = (i / MW) | 0; return !!this.s.owned[((y / PS) | 0) * PW + ((x / PS) | 0)]; }

  // ---- buildings and land -----------------------------------------------------------------------------
  place(k: string, x: number, y: number) {
    const d = BUILDINGS[k], id = this.s.blds.length;
    this.s.blds.push({ k, x, y });
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) { const t = this.idx(x + i, y + j); this.bld[t] = id + 1; if (this.terr[t] === T_WILD) this.terr[t] = T_GRASS; this.sp[t] = 0; this.touch(t); }
    if (d.radius) this.rebuildWet();
    this.terrVer++;
  }
  canBuild(k: string, x: number, y: number) {
    const d = BUILDINGS[k];
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
      const X = x + i, Y = y + j;
      if (!this.ownedAt(X, Y)) return false;
      const t = this.idx(X, Y), tr = this.terr[t];
      if (this.bld[t] || (tr !== T_GRASS && tr !== T_WILD) || (this.sp[t] && !(this.flag[t] & F_DEAD))) return false;
    }
    return true;
  }
  build(k: string, x: number, y: number) {
    const d = BUILDINGS[k];
    if (this.s.money < d.price) { this.emit({ k: 'deny' }); this.toast('Not enough money.'); return false; }
    if (!this.canBuild(k, x, y)) { this.emit({ k: 'deny' }); return false; }
    this.s.money -= d.price; this.s.yr.bills += d.price; this.place(k, x, y); this.emit({ k: 'build' });
    if (k === 'kennel') this.s.critters.push({ k: 'dog', x: x + 1, y: y + 2, vx: 0, vy: 0, t: 0, n: 0, flee: false, tx: x, ty: y });
    return true;
  }
  layRoad(x: number, y: number) {
    if (!this.ownedAt(x, y)) return false;
    const i = this.idx(x, y), t = this.terr[i];
    if (this.bld[i] || (t !== T_GRASS && t !== T_WILD) || this.s.money < 6) return false;
    this.s.money -= 6; this.terr[i] = T_ROAD; this.sp[i] = 0; this.flag[i] = 0; this.touch(i); this.recountLater = true; this.terrVer++; return true;
  }
  recountLater = false;
  rebuildWet() {
    this.wet.fill(0);
    for (const b of this.s.blds) { const r = BUILDINGS[b.k].radius; if (!r) continue; for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r && this.inMap(b.x + x, b.y + y)) this.wet[this.idx(b.x + x, b.y + y)] = 1; }
  }
  buyParcel(px: number, py: number) {
    if (!this.canBuyParcel(px, py)) return false;
    const c = this.landPrice(px, py);
    if (this.s.money < c) { this.emit({ k: 'deny' }); this.toast('Not enough money. Try the bank.'); return false; }
    this.s.money -= c; this.s.yr.bills += c; this.s.owned[py * PW + px] = 1; this.emit({ k: 'buy' }); this.terrVer++;
    for (let y = 0; y < PS; y += CH / 2) for (let x = 0; x < PS; x += CH / 2) this.touch(this.idx(px * PS + x, py * PS + y));
    return true;
  }
  unlockSpecies(sp: number) {
    const c = SPECIES[sp].unlock;
    if (this.s.unlocked[sp] || this.tier < SPECIES[sp].tier) return false;
    if (this.s.money < c) { this.emit({ k: 'deny' }); return false; }
    this.s.money -= c; this.s.unlocked[sp] = true; this.emit({ k: 'buy' }); this.toast(`${SPECIES[sp].name} seedlings are in stock.`); return true;
  }
  buyVehicle(v: number) {
    const d = VEHICLES[v];
    if (v <= this.s.veh || this.tier < d.tier) return false;
    if (this.s.money < d.price) { this.emit({ k: 'deny' }); return false; }
    this.s.money -= d.price; this.s.yr.bills += d.price; this.s.veh = v; this.emit({ k: 'big', t: d.name.toUpperCase(), s: d.blurb, c: 'gold' }); return true;
  }
  hire(rank: number) {
    const d = CREW[rank];
    if (this.tier < d.tier) return false;
    if (this.s.money < d.hire) { this.emit({ k: 'deny' }); return false; }
    this.s.money -= d.hire; this.s.yr.bills += d.hire;
    const id = this.s.nextId++, bn = this.s.blds.find((b) => b.k === 'barn')!;
    this.s.crew.push({ id, name: CREW_NAMES[(id * 7) % CREW_NAMES.length], rank, x: bn.x + 2, y: bn.y + 5, dir: 0, mode: 'idle', hop: newHopper(), strip: null, gx: 0, gy: 0, gk: 0, last: -1, think: 0, moving: false });
    this.emit({ k: 'buy' }); return true;
  }
  fire(id: number) { const a = this.s.crew.find((c) => c.id === id); if (a) { this.stockHopper(a.hop); this.s.crew = this.s.crew.filter((c) => c !== a); } }
  promote(id: number) {
    const a = this.s.crew.find((c) => c.id === id); if (!a) return false;
    const n = a.rank + 1; if (n >= CREW.length || this.tier < CREW[n].tier) return false;
    if (this.s.money < CREW[n].hire) { this.emit({ k: 'deny' }); return false; }
    this.s.money -= CREW[n].hire; this.s.yr.bills += CREW[n].hire; a.rank = n; this.emit({ k: 'buy' }); return true;
  }
  addBlock(x: number, y: number, w: number, h: number) {
    const id = this.s.nextId++, letter = this.s.blocks.length;
    const name = 'Block ' + (letter < 26 ? String.fromCharCode(65 + letter) : letter + 1);
    let sp = this.s.p.sel; const cnt = new Array(NS).fill(0);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const s = this.sp[this.idx(x + i, y + j)]; if (s) cnt[s - 1]++; }
    let best = 0; for (let i = 0; i < NS; i++) if (cnt[i] > best) { best = cnt[i]; sp = i; }
    const b: Block = { id, name, x, y, w, h, sp, cut: 7, replant: true, shear: true, passJob: '', passNext: 0 };
    this.s.blocks.push(b); return b;
  }
  borrow(n: number) { const room = this.loanLimit() - this.s.debt; n = Math.min(n, room); if (n <= 0) { this.emit({ k: 'deny' }); return; } this.s.debt += n; this.s.money += n; this.emit({ k: 'buy' }); }
  repay(n: number) { n = Math.min(n, this.s.debt, this.s.money); if (n <= 0) { this.emit({ k: 'deny' }); return; } this.s.debt -= n; this.s.money -= n; this.emit({ k: 'buy' }); }
  wholesaleRate() { return 0.58 * (1 + 0.15 * this.pk('dump')); }
  sellSurplus(frac = 1) {
    const s = this.s; let total = 0, n = 0;
    for (let i = 0; i < NS * NZ; i++) {
      const c = Math.floor(s.stock[i] * frac); if (!c) continue;
      const sp = (i / NZ) | 0, z = i % NZ, q = s.stockQ[i] / s.stock[i], p = this.priceOf(sp, z, q) * this.wholesaleRate();
      const depth = 90 + 260 * this.tier, already = s.yr.wholesaleN + n;
      total += p * c / (1 + (already + c * 0.5) / depth); n += c;
      s.stockQ[i] -= q * c; s.stock[i] -= c; s.stockN -= c;
    }
    if (!n) return 0;
    s.money += total; s.yr.wholesale += total; s.yr.wholesaleN += n; s.yr.revenue += total; s.yr.sold += n; s.lifeSold += n; s.stats.sold += n;
    this.emit({ k: 'toast', t: `Wholesale took ${n} trees for ${money(total)}.`, c: 'gold' });
    return total;
  }

  // ---- working trees ----------------------------------------------------------------------------------
  private hopAdd(h: Hopper, sp: number, z: number, q: number) { const b = sp * NZ + z; h.c[b]++; h.q[b] += q; h.n++; }
  /** one tool on one tile; returns true when something happened */
  apply(tool: number, x: number, y: number, mine: boolean, hop: Hopper, cap: number, b?: Block | null): boolean {
    if (!this.inMap(x, y)) return false;
    const i = this.idx(x, y), s = this.s, sp = this.sp[i], fl = this.flag[i], tr = this.terr[i], own = this.ownedAt(x, y);
    if (!own) return false;
    if (tool === TOOL_SAW) {
      if (tr === T_WILD) { this.terr[i] = T_GRASS; s.money += 3; this.touch(i); this.terrVer++; this.emit({ k: 'clear', x, y, mine }); return true; }
      if (!sp) return false;
      if (fl & F_DEAD) { this.clearTree(i); this.emit({ k: 'clear', x, y, mine }); return true; }
      if (this.h[i] < (mine ? s.p.cutAt : MIN_CUT)) return false;
      if (!this.harvestOpen()) { if (mine) this.once('early' + s.year, "Too early to cut. Customers want them fresh: wait for mid October."); return false; }
      if (hop.n >= cap) { if (mine) this.emit({ k: 'full' }); return false; }
      const h = this.h[i], z = sizeIdx(h);
      this.hopAdd(hop, sp - 1, z, this.shape[i]);
      if (fl & F_GOLD) this.takeGold(x, y);
      this.clearTree(i); this.flag[i] = F_STUMP; s.stats.cut++;
      this.emit({ k: 'chop', x, y, sp: sp - 1, h, mine });
      return true;
    }
    if (tool === TOOL_PLANT) {
      if (this.bld[i]) return false;
      if (tr !== T_GRASS && tr !== T_WILD) return false;
      if (sp && !(fl & F_DEAD)) return false;
      const spc = b ? b.sp : s.p.sel, cost = this.seedPrice(spc) + (tr === T_WILD ? 2 : 0);
      if (s.money < cost) { if (mine) this.once('broke' + s.year + s.month, 'Out of money for seedlings.'); return false; }
      if (!s.unlocked[spc]) return false;
      s.money -= cost; s.yr.seeds += cost; if (tr === T_WILD) { this.terr[i] = T_GRASS; this.terrVer++; }
      this.sp[i] = spc + 1; this.h[i] = 0.45 + this.rnd() * 0.25; this.shape[i] = 42 + ((this.rnd() * 22) | 0); this.flag[i] = 0; this.pest[i] = 0;
      this.standing++; s.stats.planted++; s.yr.planted++; this.touch(i);
      this.emit({ k: 'plant', x, y, mine });
      return true;
    }
    if (tool === TOOL_SHEAR) {
      if (!sp || fl & (F_DEAD | F_SHEARED) || this.h[i] < 1.5) return false;
      if (s.month < 5 || s.month > 8) { if (mine) this.once('shear' + s.year + s.month, 'Shearing only takes June to September.'); return false; }
      this.shape[i] = Math.min(100, this.shape[i] + 20 * (1 + 0.4 * this.pk('blade')));
      this.flag[i] |= F_SHEARED; s.stats.sheared++; this.touch(i); this.emit({ k: 'shear', x, y, mine }); return true;
    }
    if (tool === TOOL_TANK) {
      if (!sp || fl & F_DEAD) return false;
      if (fl & F_PEST) {
        this.flag[i] = (fl & ~F_PEST) | F_IMMUNE; this.pest[i] = 0; s.money -= 1; this.touch(i); s.stats.cured = (s.stats.cured ?? 0) + 1;
        this.emit({ k: 'spray', x, y, mine }); return true;
      }
      if (s.drought > 0 && !(fl & F_WATERED)) { this.flag[i] = (fl | F_WATERED) & ~F_THIRST; this.touch(i); this.emit({ k: 'spray', x, y, mine }); return true; }
      if (!(fl & F_IMMUNE) && this.infected.length) { this.flag[i] |= F_IMMUNE; return true; }
      return false;
    }
    return false;
  }
  private clearTree(i: number) {
    if (this.sp[i] && !(this.flag[i] & F_DEAD)) this.standing--;
    this.sp[i] = 0; this.h[i] = 0; this.shape[i] = 0; this.flag[i] = 0; this.pest[i] = 0; this.touch(i);
  }
  private takeGold(x: number, y: number) {
    const s = this.s, cash = Math.round(Math.max(250, s.yr.revenue * 0.05));
    s.money += cash; s.yr.bonus += cash; s.gold = -1; s.streak += 2; s.yr.bestStreak = Math.max(s.yr.bestStreak, s.streak);
    this.emit({ k: 'big', t: 'GOLDEN TREE!', s: `+${money(cash)} and +2 Cheer`, c: 'gold' }); this.emit({ k: 'cash', x, y, n: cash });
  }
  stockHopper(h: Hopper): number {
    const s = this.s; let moved = 0; const room = this.capacity - s.stockN;
    for (let b = 0; b < h.c.length && moved < room; b++) {
      const n = Math.min(h.c[b], room - moved); if (!n) continue;
      const q = h.q[b] / h.c[b] * n;
      s.stock[b] += n; s.stockQ[b] += q; h.c[b] -= n; h.q[b] -= q; h.n -= n; moved += n; s.stockN += n;
    }
    if (moved) { s.stats.unloaded += moved; this.fillTickets(); }
    return moved;
  }
  /** the tiles a vehicle's tool covers */
  swathOf(x: number, y: number, w: number) { const hw = (w - 1) / 2, cx = Math.floor(x), cy = Math.floor(y); return { x0: cx - Math.floor(hw), y0: cy - Math.floor(hw), x1: cx + Math.ceil(hw), y1: cy + Math.ceil(hw) }; }
  solid(x: number, y: number) {
    const X = Math.floor(x), Y = Math.floor(y); if (!this.inMap(X, Y)) return true;
    const i = this.idx(X, Y), t = this.terr[i]; return t === T_WATER || t === T_ROCK || this.bld[i] > 0;
  }
  nearUnload(x: number, y: number, air: boolean): Bld | null {
    for (const b of this.s.blds) {
      const d = BUILDINGS[b.k]; if (!d.unload) continue;
      if (x >= b.x - 2.2 && x <= b.x + d.w + 2.2 && y >= b.y - 2.2 && y <= b.y + d.h + 2.2 && (!air || b.k === 'helipad' || true)) return b;
    }
    return null;
  }
  nearestUnload(x: number, y: number) {
    let best: Bld | null = null, bd = 1e9;
    for (const b of this.s.blds) { const d = BUILDINGS[b.k]; if (!d.unload) continue; const q = Math.hypot(b.x + d.w / 2 - x, b.y + d.h / 2 - y); if (q < bd) { bd = q; best = b; } }
    return best!;
  }

  stepPlayer(dt: number, ix: number, iy: number, act: boolean) {
    const s = this.s, p = s.p, v = VEHICLES[s.veh];
    const len = Math.hypot(ix, iy); if (len > 1) { ix /= len; iy /= len; }
    const ti = this.inMap(p.x | 0, p.y | 0) ? this.idx(p.x | 0, p.y | 0) : 0;
    const onRoad = this.terr[ti] === T_ROAD || this.terr[ti] === T_BRIDGE;
    let top = v.speed * (1 + 0.12 * this.pk('diesel')) * (onRoad && !v.air ? 1.3 : 1) * (s.blizzard > 0 ? 0.72 : 1);
    if (!v.air && this.sp[ti] && !act) top *= 0.82;
    const acc = v.air ? 5 : 14, k = Math.min(1, acc * dt);
    p.vx += (ix * top - p.vx) * k; p.vy += (iy * top - p.vy) * k;
    const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
    if (v.air || !this.solid(nx, p.y)) p.x = nx; else p.vx = 0;
    if (v.air || !this.solid(p.x, ny)) p.y = ny; else p.vy = 0;
    p.x = Math.max(1, Math.min(MW - 1, p.x)); p.y = Math.max(1, Math.min(MH - 1, p.y));
    p.moving = Math.hypot(p.vx, p.vy) > 0.4;
    if (len > 0.1) { if (Math.abs(ix) > Math.abs(iy)) p.dir = ix > 0 ? 1 : 3; else p.dir = iy > 0 ? 2 : 0; }
    p.acting = act; p.cd -= dt;
    if (act && p.cd <= 0) {
      const sw = this.swathOf(p.x, p.y, v.w); let did = 0; const cap = this.hopCap();
      for (let y = sw.y0; y <= sw.y1; y++) for (let x = sw.x0; x <= sw.x1; x++) if (this.apply(p.tool, x, y, true, p.hop, cap)) did++;
      if (s.veh === 0) p.cd = did ? 0.09 : 0;
    }
    if (p.hop.n > 0 && this.nearUnload(p.x, p.y, !!v.air)) {
      const n = this.stockHopper(p.hop); if (n) this.emit({ k: 'unload', x: p.x, y: p.y, n });
      else if (this.s.stockN >= this.capacity) this.once('barnfull' + s.year + s.month, 'The barn is full! Sell stock or build storage.');
    }
    // ramming things off the farm is half the job
    for (const c of s.critters) if (c.k !== 'dog' && Math.hypot(c.x - p.x, c.y - p.y) < Math.max(3.2, v.w * 0.6)) this.scare(c, true);
  }
  private scare(c: Critter, byPlayer: boolean) {
    const s = this.s;
    if (c.k === 'deer' && !c.flee) { c.flee = true; if (byPlayer) this.emit({ k: 'ram', x: c.x, y: c.y, t: 'SHOO!' }); }
    if (c.k === 'thief' && !c.flee && byPlayer) {
      c.flee = true; c.t = 99;
      const bonus = Math.round(c.n * 45); s.money += bonus; s.yr.bonus += bonus;
      this.emit({ k: 'ram', x: c.x, y: c.y, t: 'GOTCHA!' }); this.emit({ k: 'cash', x: c.x, y: c.y, n: bonus });
      this.toast(`You caught Needles! ${c.n} trees' worth recovered.`, 'gold');
    }
  }

  // ---- crews ------------------------------------------------------------------------------------------
  private jobOf(b: Block): Job | null {
    const m = this.s.month;
    if (this.harvestOpen() && b.cut > 0) return 'cut';
    if (m >= 2 && m <= 4 && b.replant) return 'plant';
    if (m >= 5 && m <= 8 && b.shear) return 'shear';
    return null;
  }
  private need(i: number, job: Job, b: Block) {
    if (!this.ownedTile(i)) return false; // a block may be drawn across land you don't own yet
    const sp = this.sp[i], fl = this.flag[i];
    if (job === 'cut') return sp > 0 && !(fl & F_DEAD) && this.h[i] >= b.cut;
    if (job === 'shear') return sp > 0 && !(fl & (F_DEAD | F_SHEARED)) && this.h[i] >= 1.5;
    if (this.bld[i]) return false;
    const t = this.terr[i]; return (t === T_GRASS || t === T_WILD) && (!sp || !!(fl & F_DEAD));
  }
  private rowWork(b: Block, row: number, rows: number, job: Job) {
    for (let y = row; y < Math.min(b.h, row + rows); y++) for (let x = 0; x < b.w; x++) if (this.need(this.idx(b.x + x, b.y + y), job, b)) return true;
    return false;
  }
  private claim(a: Agent): boolean {
    const w = CREW[a.rank].w; let best: Block | null = null, bd = 1e9, bj: Job = 'cut';
    for (const b of this.s.blocks) {
      const job = this.jobOf(b); if (!job) continue;
      if (job === 'plant' && this.s.money < this.seedPrice(b.sp) * 4) continue;
      if (job === 'cut' && this.s.stockN >= this.capacity) continue;
      if (b.passJob !== job) { b.passJob = job; b.passNext = 0; }
      while (b.passNext < b.h && !this.rowWork(b, b.passNext, w, job)) b.passNext += w;
      if (b.passNext >= b.h) continue;
      const d = Math.hypot(b.x - a.x, b.y + b.passNext - a.y);
      if (d < bd) { bd = d; best = b; bj = job; }
    }
    if (!best) return false;
    const y = best.y + best.passNext, rows = Math.min(w, best.h - best.passNext);
    best.passNext += rows;
    const left = Math.abs(a.x - best.x) < Math.abs(a.x - (best.x + best.w - 1));
    a.strip = { b: best.id, job: bj, y, rows, x: left ? best.x : best.x + best.w - 1, end: left ? best.x + best.w - 1 : best.x, dir: left ? 1 : -1 };
    return true;
  }
  private walk(a: Agent, tx: number, ty: number, speed: number, dt: number) {
    const dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy); a.moving = d > 0.05;
    if (d <= speed * dt) { a.x = tx; a.y = ty; return true; }
    a.x += dx / d * speed * dt; a.y += dy / d * speed * dt;
    a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    return false;
  }
  private findTicketTree(a: Agent, t: Ticket): number {
    const cx = a.x | 0, cy = a.y | 0;
    for (let r = 0; r < 70; r += 1) for (let j = -r; j <= r; j++) {
      const opts = Math.abs(j) === r ? 2 * r + 1 : 2;
      for (let k = 0; k < opts; k++) {
        const i2 = Math.abs(j) === r ? k - r : (k ? r : -r), x = cx + i2, y = cy + j;
        if (!this.inMap(x, y)) continue; const i = this.idx(x, y), s = this.sp[i];
        if (s && !(this.flag[i] & F_DEAD) && (t.sp < 0 || s - 1 === t.sp) && this.h[i] >= SIZE_MIN[t.minZ] && this.ownedAt(x, y)) return i;
      }
    }
    return -1;
  }
  private stepAgent(a: Agent, dt: number) {
    const R = CREW[a.rank], s = this.s, speed = R.speed * (1 + 0.12 * this.pk('crew')) * (s.blizzard > 0 ? 0.72 : 1);
    a.moving = false;
    if (a.mode === 'unload') {
      const b = this.nearestUnload(a.x, a.y), d = BUILDINGS[b.k];
      if (this.walk(a, b.x + d.w / 2, b.y + d.h + 1, speed, dt)) {
        this.stockHopper(a.hop);
        if (a.hop.n === 0) a.mode = 'idle'; else a.think = 1;
      }
      return;
    }
    if (a.mode === 'goal') {
      if (this.walk(a, a.gx + 0.5, a.gy + 0.5, speed, dt)) {
        const sw = this.swathOf(a.x, a.y, R.w);
        for (let y = sw.y0; y <= sw.y1; y++) for (let x = sw.x0; x <= sw.x1; x++) {
          if (!this.inMap(x, y)) continue; const i = this.idx(x, y);
          if (a.gk === 1) { if (this.flag[i] & F_PEST) this.apply(TOOL_TANK, x, y, false, a.hop, R.cap); }
          else { const t = s.tickets.find((q) => q.id === s.priority); if (t && this.sp[i] && (t.sp < 0 || this.sp[i] - 1 === t.sp) && this.h[i] >= SIZE_MIN[t.minZ]) this.apply(TOOL_SAW, x, y, false, a.hop, R.cap); }
        }
        a.mode = 'idle';
      }
      return;
    }
    if (a.hop.n >= R.cap) { a.mode = 'unload'; a.strip = null; return; }
    if (a.strip) {
      const st = a.strip, b = s.blocks.find((q) => q.id === st.b);
      if (!b || !this.valid(st.job, b)) { a.strip = null; return; }
      const atY = st.y + st.rows / 2;
      if (Math.abs(a.y - atY) > 0.2 || (a.mode !== 'work' && Math.abs(a.x - st.x - 0.5) > 0.3)) { a.mode = 'idle'; if (this.walk(a, st.x + 0.5, atY, speed, dt)) a.mode = 'work'; return; }
      a.mode = 'work';
      const nx = a.x + st.dir * speed * dt; a.x = nx; a.moving = true; a.dir = st.dir > 0 ? 1 : 3;
      const col = Math.floor(a.x);
      if (col !== a.last) {
        a.last = col;
        for (let r = 0; r < st.rows; r++) { const y = st.y + r, i = this.idx(col, y); if (col < b.x || col >= b.x + b.w) continue; if (this.need(i, st.job, b)) { if (st.job === 'cut') this.apply(TOOL_SAW, col, y, false, a.hop, R.cap); else if (st.job === 'shear') this.apply(TOOL_SHEAR, col, y, false, a.hop, R.cap); else this.apply(TOOL_PLANT, col, y, false, a.hop, R.cap, b); } }
      }
      if ((st.dir > 0 && a.x >= st.end + 1) || (st.dir < 0 && a.x <= st.end)) { a.strip = null; a.mode = 'idle'; a.last = -1; }
      return;
    }
    a.think -= dt; if (a.think > 0) { return; }
    // nothing on: pests first, then the order you flagged, then the job board
    if (this.infected.length && a.id % 2 === 0) {
      let bd = 1e9, bi = -1;
      for (let k = 0; k < Math.min(40, this.infected.length); k++) { const i = this.infected[(Math.random() * this.infected.length) | 0]; if (!(this.flag[i] & F_PEST)) continue; const d = Math.hypot(i % MW - a.x, ((i / MW) | 0) - a.y); if (d < bd) { bd = d; bi = i; } }
      if (bi >= 0) { a.gx = bi % MW; a.gy = (bi / MW) | 0; a.gk = 1; a.mode = 'goal'; return; }
    }
    if (s.priority >= 0 && this.harvestOpen()) {
      const t = s.tickets.find((q) => q.id === s.priority);
      if (t && t.filled < t.qty) { const i = this.findTicketTree(a, t); if (i >= 0) { a.gx = i % MW; a.gy = (i / MW) | 0; a.gk = 2; a.mode = 'goal'; return; } }
      else s.priority = -1;
    }
    if (this.claim(a)) return;
    if (a.hop.n > 0) { a.mode = 'unload'; return; }
    a.think = 0.6 + Math.random();
    const bn = this.nearestUnload(a.x, a.y), d = BUILDINGS[bn.k];
    if (Math.hypot(bn.x + d.w / 2 - a.x, bn.y + d.h + 1 - a.y) > 6) { a.gx = bn.x + (a.id % 6); a.gy = bn.y + d.h + 1 + (a.id % 3); a.gk = 0; a.mode = 'goal'; }
  }
  private valid(job: Job, b: Block) { return this.jobOf(b) === job; }

  // ---- orders -----------------------------------------------------------------------------------------
  addTicket(o: { buyer: string; sp: number; minZ: number; qty: number; days: number; pay: number; hero?: boolean }) {
    const t: Ticket = { id: this.s.nextId++, buyer: o.buyer, sp: o.sp, minZ: o.minZ, qty: o.qty, filled: 0, days: o.days, total: o.days, pay: o.pay, hero: !!o.hero, age: 0 };
    this.s.tickets.push(t); this.emit({ k: 'newticket', t }); return t;
  }
  private harvestRate() { const s = this.s; let r = 5 + VEHICLES[s.veh].w * 3; for (const c of s.crew) r += 2 + CREW[c.rank].w * 2; return r; }
  private spawnTicket() {
    const s = this.s, daysLeft = this.daysToXmas(); if (daysLeft < 3) return;
    const reserved = new Array(NS * NZ).fill(0);
    for (const t of s.tickets) for (let z = t.minZ; z < NZ; z++) if (t.sp >= 0) { reserved[t.sp * NZ + z] += t.qty - t.filled; break; }
    const pool: { b: number; n: number }[] = []; let tot = 0;
    for (let b = 0; b < NS * NZ; b++) { if (b % NZ === 0) continue; const n = this.census[b] - reserved[b]; if (n >= 1) { pool.push({ b, n }); tot += Math.sqrt(n); } }
    if (!pool.length) return;
    let r = this.rnd() * tot, c = pool[0]; for (const p of pool) { r -= Math.sqrt(p.n); if (r <= 0) { c = p; break; } }
    const sp = (c.b / NZ) | 0, z = c.b % NZ, tier = this.tier;
    const hero = z >= 4 && this.rnd() < 0.3;
    const capQ = [7, 20, 60, 180, 500, 1400][tier];
    const qty = hero ? 1 + (this.rnd() * 2 | 0) : Math.max(1, Math.min(capQ, Math.round(c.n * (0.1 + this.rnd() * 0.24))));
    const days = Math.min(daysLeft, Math.max(6, Math.round((5 + qty / this.harvestRate() * 2.2 + this.rnd() * 5) * (1 + 0.25 * this.pk('early')))));
    let buyer = BUYERS[0][1][0]; for (const [m, l] of BUYERS) if (qty >= m) buyer = this.pick(l);
    if (hero) buyer = this.pick(HERO_BUYERS);
    const mult = hero ? 4 + this.rnd() * 2 : 1.3 + this.rnd() * 0.45;
    this.addTicket({ buyer, sp, minZ: z, qty, days, pay: this.priceOf(sp, z, 70) * mult, hero });
  }
  fillTickets() {
    const s = this.s;
    const list = s.tickets.slice().sort((a, b) => a.days - b.days);
    for (const t of list) {
      for (let z = NZ - 1; z >= 0 && t.filled < t.qty; z--) {
        if (z < t.minZ) break;
        for (let sp = 0; sp < NS && t.filled < t.qty; sp++) {
          if (t.sp >= 0 && t.sp !== sp) continue;
          const b = sp * NZ + z, n = Math.min(s.stock[b], t.qty - t.filled); if (!n) continue;
          const q = s.stockQ[b] / s.stock[b] * n; s.stock[b] -= n; s.stockQ[b] -= q; s.stockN -= n; t.filled += n;
        }
      }
      if (t.filled >= t.qty) this.finishTicket(t, true);
    }
  }
  private finishTicket(t: Ticket, ok: boolean) {
    const s = this.s; s.tickets = s.tickets.filter((q) => q !== t);
    if (s.priority === t.id) s.priority = -1;
    let paid = 0;
    if (ok) {
      paid = t.pay * t.qty * this.cheer; s.streak++; s.yr.bestStreak = Math.max(s.yr.bestStreak, s.streak); s.rep = Math.min(100, s.rep + 1.5);
      s.stats.tickets++; s.yr.orders += paid; s.yr.ordersN++; s.yr.sold += t.qty; s.lifeSold += t.qty; s.stats.sold += t.qty; s.yr.revenue += paid; s.money += paid;
    } else {
      s.yr.missed++; s.rep = Math.max(0, s.rep - 2.5);
      if (t.filled) { paid = t.pay * t.filled * 0.5; s.money += paid; s.yr.orders += paid; s.yr.sold += t.filled; s.lifeSold += t.filled; s.yr.revenue += paid; s.stats.sold += t.filled; }
      if (s.shield > 0) s.shield--; else s.streak = 0;
    }
    this.emit({ k: 'order', ok, t, paid });
  }
  setPriority(id: number) { this.s.priority = this.s.priority === id ? -1 : id; for (const a of this.s.crew) if (a.mode === 'goal' && a.gk === 2) a.mode = 'idle'; }

  // ---- the calendar -----------------------------------------------------------------------------------
  step(real: number, ix = 0, iy = 0, act = false) {
    const s = this.s;
    if (s.phase !== 'play') return;
    this.stepPlayer(real, ix, iy, act);
    const dt = real * this.speed;
    for (const a of s.crew) this.stepAgent(a, dt);
    this.stepCritters(dt);
    if (s.tut) { this.checkGoals(); if (s.goal >= 2) s.tut = false; else return; }
    const dayLen = MONTH_SEC[s.month] / 30;
    s.dayF += dt / dayLen;
    while (s.dayF >= 1 && s.phase === 'play') {
      s.dayF -= 1; s.day++;
      if (s.day > 30) { s.day = 1; s.month = (s.month + 1) % 12; this.onMonth(); }
      this.onDay();
      if (s.month === 11 && s.day >= XMAS_DAY) this.christmasEve();
    }
    this.checkGoals();
    if (this.recountLater) { this.recount(); this.recountLater = false; }
  }
  private onMonth() {
    const s = this.s, wage = s.crew.reduce((a, c) => a + this.wage(c), 0);
    s.money -= wage; s.yr.wages += wage;
    if (s.money < 0) {
      // income is all in December, so the bank carries payroll through the year; only past the limit do people walk
      const room = this.loanLimit() - s.debt, need = -s.money;
      if (room >= need) { s.debt += need; s.money = 0; this.once('overdraft' + s.year, `The bank covered payroll. You owe ${money(s.debt)}.`); }
      else if (s.crew.length) {
        const n = Math.max(1, Math.ceil(s.crew.length / 4)), by = s.crew.slice().sort((a, b) => b.rank - a.rank).slice(0, n);
        for (const a of by) this.fire(a.id);
        this.emit({ k: 'alarm', t: `Credit's gone. ${n} of the crew quit.`, x: s.p.x, y: s.p.y });
      }
    }
    for (const b of s.blocks) b.passNext = 0;
    this.emit({ k: 'month' });
    if (s.month === 2 || s.month === 5 || s.month === 8 || s.month === 11) this.emit({ k: 'season' });
    if (s.month === 2) this.once('spring' + Math.min(s.year, 3), s.year <= 3 ? 'Spring! Planting season: press 2 and put seedlings in the ground.' : 'Planting season.');
    if (s.month === 5) this.once('summer' + Math.min(s.year, 3), s.year <= 3 ? 'Summer: press 3 and shear. Shape is what earns an S grade.' : 'Shearing season.');
    if (s.month === 3) { for (let i = 0; i < this.N; i++) if (this.flag[i] & F_STUMP) { this.flag[i] = 0; } this.touchAll(); }
    if (s.month === 8) { for (let i = 0; i < this.N; i++) if (this.sp[i] && !(this.flag[i] & (F_SHEARED | F_DEAD)) && this.h[i] > 2) this.shape[i] = Math.max(20, this.shape[i] - 6); }
    if (s.month === 9) {
      // the magazines have decided what this Christmas looks like
      let best = -1, v = 1.12; for (let i = 0; i < NS; i++) if (s.unlocked[i] && this.market(i) > v) { v = this.market(i); best = i; }
      if (best >= 0) this.toast(`The magazines love ${SPECIES[best].name} this year: +${Math.round((v - 1) * 100)}%.`, 'gold');
    }
    if (s.month === 10) { s.ticketT = 1; this.refreshCensus(); this.emit({ k: 'big', t: 'HARVEST TIME', s: 'Orders are coming in', c: 'red' }); }
    if (s.month === 11) this.emit({ k: 'big', t: 'THE RUSH', s: '24 days to Christmas', c: 'red' });
    
    this.emit({ k: 'saved' });
  }
  private onDay() {
    const s = this.s, m = s.month;
    if (m >= 3 && m <= 8) this.grow();
    this.pestDay();
    if (s.drought > 0) this.droughtDay();
    if (s.blizzard > 0) s.blizzard--; if (s.tv > 0) s.tv--;
    if (s.gold >= 0 && --s.goldDays <= 0) { this.flag[s.gold] &= ~F_GOLD; this.touch(s.gold); s.gold = -1; this.toast('The golden tree lost its shine.'); }
    if (this.retailOpen()) this.retailDay();
    if (m === 10 || m === 11) {
      if (s.day % 6 === 0) this.refreshCensus();
      this.fillTickets();
      s.ticketT--;
      if (s.ticketT <= 0 && s.tickets.length < Math.min(6, 2 + this.tier)) { this.spawnTicket(); s.ticketT = (m === 11 ? 2.2 : 3.2) + this.rnd() * 2; }
      for (const t of s.tickets.slice()) { t.days--; t.age++; if (t.days <= 0) this.finishTicket(t, false); }
    }
    this.events();
  }
  private grow() {
    const g0 = this.growMult(), N = this.N, sp = this.sp, h = this.h, fl = this.flag, fe = this.fert;
    const per = g0 / 180 / 128;
    for (let i = 0; i < N; i++) {
      const s = sp[i]; if (!s) continue; const f = fl[i]; if (f & F_DEAD) continue;
      if (f & F_PEST) continue;
      let r = SPECIES[s - 1].rate * per * fe[i]; if (f & F_THIRST) r *= 0.25;
      const a = h[i], b = a + r * (a > 12 ? 0.55 : 1); h[i] = b;
      if (stageOf(a) !== stageOf(b)) this.touch(i);
    }
  }
  private pestDay() {
    if (!this.infected.length) return;
    const s = this.s, next: number[] = [], rate = Math.pow(0.65, this.pk('lady'));
    for (const i of this.infected) {
      if (!(this.flag[i] & F_PEST)) continue;
      this.pest[i]++;
      if (this.pest[i] >= 24) { this.flag[i] = F_DEAD; this.standing--; s.yr.lost++; this.touch(i); this.emit({ k: 'dead', x: i % MW, y: (i / MW) | 0, mine: false }); continue; }
      next.push(i);
      const x = i % MW, y = (i / MW) | 0, my = this.sp[i];
      for (let d = 0; d < 8; d++) {
        const X = x + [1, -1, 0, 0, 1, 1, -1, -1][d], Y = y + [0, 0, 1, -1, 1, -1, 1, -1][d]; if (!this.inMap(X, Y)) continue;
        const j = this.idx(X, Y), q = this.sp[j]; if (!q || this.flag[j] & (F_PEST | F_IMMUNE | F_DEAD)) continue;
        const pr = (q === my ? 0.055 : 0.006) * SPECIES[q - 1].pest * rate * (d < 4 ? 1 : 0.6);
        if (this.rnd() < pr) { this.flag[j] |= F_PEST; this.pest[j] = 0; next.push(j); this.touch(j); }
      }
    }
    this.infected = next;
    if (!next.length && s.seen.outbreak) { s.seen.outbreak = false; s.stats.outbreaks++; this.toast('Outbreak over.', 'gold'); }
  }
  private droughtDay() {
    const s = this.s; s.drought--;
    const hurt = 0.022 * Math.pow(0.5, this.pk('roots'));
    for (let i = 0; i < this.N; i++) {
      const sp = this.sp[i]; if (!sp || this.h[i] > 3 || this.flag[i] & (F_DEAD | F_WATERED) || this.wet[i]) continue;
      this.flag[i] |= F_THIRST;
      if (this.rnd() < hurt * SPECIES[sp - 1].drought) { this.flag[i] = F_DEAD; this.standing--; s.yr.lost++; this.touch(i); }
    }
    if (s.drought === 0) { for (let i = 0; i < this.N; i++) this.flag[i] &= ~(F_THIRST | F_WATERED); this.toast('The rain is back.'); }
  }
  private retailDay() {
    const s = this.s, t = TIERS[this.tier];
    const d = s.month === 10 ? (s.day - 21) / 12 : 0.75 + (s.day / XMAS_DAY) * 0.75, weekend = ((s.day + s.month) % 7 >= 5) ? 1.35 : 1;
    let n = t.demand * d * weekend * this.pull * (0.6 + s.rep / 100 * 0.8) * (1 + (this.cheer - 1) * 0.5);
    if (s.blizzard > 0) n *= 0.25; if (s.tv > 0) n *= 2.5;
    n = Math.min(n, this.lotCap);
    let c = Math.floor(n); if (this.rnd() < n - c) c++;
    let got = 0, cash = 0, sad = 0;
    for (let k = 0; k < c; k++) {
      let r = this.rnd(), z = 0; for (; z < NZ - 1; z++) { r -= SIZE_DEMAND[z]; if (r <= 0) break; }
      const b = this.pickStock(z);
      if (b < 0) { sad++; continue; }
      const q = s.stockQ[b] / s.stock[b], sp = (b / NZ) | 0;
      s.stock[b]--; s.stockQ[b] -= q; s.stockN--; got++;
      cash += this.priceOf(sp, b % NZ, q) * (1 + 0.08 * this.pk('tongue')) * (1 + (this.cheer - 1) * 0.35);
    }
    s.money += cash; s.yr.retail += cash; s.yr.retailN += got; s.yr.revenue += cash; s.yr.sold += got; s.lifeSold += got; s.stats.sold += got; s.yr.lostSales += sad;
    if (got) s.rep = Math.min(100, s.rep + got * 0.015); if (sad) s.rep = Math.max(0, s.rep - sad * 0.02);
    if (got) this.emit({ k: 'cust', happy: true, n: got }); if (sad) this.emit({ k: 'cust', happy: false, n: sad });
    if (cash) { const l = s.blds.find((b) => b.k === 'lot')!; this.emit({ k: 'cash', x: l.x + 3, y: l.y + 1, n: cash }); }
  }
  /** families settle for a size either side of what they came for; stock already spoken for by orders stays put */
  private pickStock(z: number) {
    const s = this.s;
    for (const dz of [0, 1, -1, 2, -2]) {
      const Z = z + dz; if (Z < 0 || Z >= NZ) continue;
      let best = -1, bn = 0;
      for (let sp = 0; sp < NS; sp++) { const b = sp * NZ + Z; if (s.stock[b] > bn) { bn = s.stock[b]; best = b; } }
      if (best >= 0) return best;
    }
    return -1;
  }
  private randomTree(minH: number) {
    for (let k = 0; k < 400; k++) {
      const i = (this.rnd() * this.N) | 0; if (!this.sp[i] || this.h[i] < minH || this.flag[i] & F_DEAD || !this.ownedTile(i)) continue; return i;
    }
    return -1;
  }
  private events() {
    const s = this.s, m = s.month, sc = Math.max(0.4, Math.min(2.2, this.standing / 1200));
    if (s.year >= 2 && m >= 3 && m <= 8 && this.rnd() < 0.012 * sc) {
      const i = this.randomTree(1);
      if (i >= 0 && !(this.flag[i] & F_IMMUNE)) {
        this.flag[i] |= F_PEST; this.infected.push(i); this.touch(i);
        const nm = SPECIES[this.sp[i] - 1].short; s.seen.outbreak = true;
        this.emit({ k: 'alarm', t: `Budworm in the ${nm}! Press 4, spray a ring around it.`, x: i % MW, y: (i / MW) | 0 });
      }
    }
    if (s.year >= 2 && m >= 5 && m <= 7 && s.drought === 0 && this.rnd() < 0.012) { s.drought = 22; this.emit({ k: 'alarm', t: 'Drought! Young trees are thirsty: spray them or build sprinklers.', x: s.p.x, y: s.p.y }); }
    if (s.year >= 2 && (m === 1 || m === 2 || m === 3) && this.rnd() < 0.03) this.spawnDeer();
    if (m === 11) {
      if (s.gold < 0 && s.day > 2 && s.day < 21 && this.rnd() < 0.05 * (1 + this.pk('gold'))) {
        const i = this.randomTree(4);
        if (i >= 0) { s.gold = i; s.goldDays = 7; this.flag[i] |= F_GOLD; this.touch(i); this.emit({ k: 'alarm', t: 'A golden tree! Cut it within 7 days for a big bonus.', x: i % MW, y: (i / MW) | 0 }); }
      }
      if (s.blizzard === 0 && s.day > 4 && this.rnd() < 0.03) { s.blizzard = 4; this.emit({ k: 'big', t: 'BLIZZARD', s: 'Roads are slow, the lot is quiet', c: 'ice' }); }
      if (s.tv === 0 && s.day > 4 && this.rnd() < 0.04) { s.tv = 3; this.emit({ k: 'big', t: 'TV CREW!', s: 'Channel 9 is here. Walk-ins x2.5 for 3 days', c: 'gold' }); }
      if (s.thieves < 2 && s.stockN > 8 && s.year >= 2 && this.rnd() < 0.05) this.spawnThief();
    }
  }
  private spawnDeer() {
    const s = this.s, n = Math.min(9, 1 + Math.floor(this.parcels / 8 + this.rnd() * 2));
    let ox = 0, oy = 0, tries = 0; do { const i = (this.rnd() * this.N) | 0; ox = i % MW; oy = (i / MW) | 0; tries++; } while (tries < 200 && (this.terr[this.idx(ox, oy)] !== T_WILD || this.ownedAt(ox, oy)));
    for (let k = 0; k < n; k++) s.critters.push({ k: 'deer', x: ox + this.rnd() * 3, y: oy + this.rnd() * 3, vx: 0, vy: 0, t: 0, n: 0, flee: false, tx: -1, ty: -1 });
    if (this.bcount('kennel') === 0) this.emit({ k: 'alarm', t: `${n > 1 ? 'Deer are' : 'A deer is'} after your seedlings. Drive at them!`, x: ox, y: oy });
  }
  private spawnThief() {
    const s = this.s, l = s.blds.find((b) => b.k === 'lot')!, n = Math.max(3, Math.floor(s.stockN * 0.08));
    let took = 0; for (let b = 0; b < NS * NZ && took < n; b++) { const c = Math.min(s.stock[b], n - took); if (!c) continue; const q = s.stockQ[b] / s.stock[b] * c; s.stock[b] -= c; s.stockQ[b] -= q; s.stockN -= c; took += c; }
    s.thieves++;
    s.critters.push({ k: 'thief', x: l.x + 3, y: l.y + 2, vx: 0, vy: 0, t: 0, n: took, flee: false, tx: 2, ty: 78 });
    this.emit({ k: 'alarm', t: `Needles the Thief ran off with ${took} trees! Run him down!`, x: l.x, y: l.y });
  }
  private stepCritters(dt: number) {
    const s = this.s; let dead = false;
    for (const c of s.critters) {
      c.t += dt;
      if (c.k === 'dog') {
        const d = s.critters.find((q) => q.k === 'deer' && !q.flee);
        const tx = d ? d.x : c.tx + 1, ty = d ? d.y : c.ty + 2.5, dx = tx - c.x, dy = ty - c.y, l = Math.hypot(dx, dy) || 1, v = d ? 11 : 3;
        if (l > 0.6) { c.vx = dx / l * v; c.vy = dy / l * v; c.x += c.vx * dt; c.y += c.vy * dt; } else { c.vx = c.vy = 0; }
        if (d && l < 1.5) this.scare(d, false);
        continue;
      }
      if (c.k === 'deer') {
        if (c.flee) { const dx = c.x - s.p.x, dy = c.y - s.p.y, l = Math.hypot(dx, dy) || 1; c.vx = dx / l * 11; c.vy = dy / l * 11; c.x += c.vx * dt; c.y += c.vy * dt; c.n += dt; if (c.n > 3.2) { c.k = 'deer'; c.t = -1; dead = true; } continue; }
        if (c.tx < 0 || c.t > 9) {
          const i = this.randomYoung(); c.t = 0;
          if (i < 0) { c.flee = true; continue; }
          c.tx = i % MW; c.ty = (i / MW) | 0;
        }
        const dx = c.tx + 0.5 - c.x, dy = c.ty + 0.5 - c.y, l = Math.hypot(dx, dy);
        if (l > 0.5) { c.vx = dx / l * 5; c.vy = dy / l * 5; c.x += c.vx * dt; c.y += c.vy * dt; }
        else {
          const i = this.idx(c.tx, c.ty);
          if (this.sp[i] && this.h[i] < 4 && !(this.flag[i] & F_DEAD)) { this.flag[i] = F_DEAD; this.standing--; s.yr.lost++; this.touch(i); }
          c.tx = -1;
        }
      } else {
        if (c.flee) { c.x -= 0; c.t = -1; dead = true; continue; }
        const dx = c.tx - c.x, dy = c.ty + 0.5 - c.y, l = Math.hypot(dx, dy);
        if (Math.abs(c.y - 78.5) > 1 && c.x > 10) { c.vy = Math.sign(78.5 - c.y) * 6.5; c.vx = 0; c.y += c.vy * dt; }
        else if (l > 1) { c.vx = dx / l * 7.2; c.vy = dy / l * 7.2; c.x += c.vx * dt; c.y += c.vy * dt; }
        else { c.t = -1; dead = true; }
      }
    }
    if (dead) s.critters = s.critters.filter((c) => c.t >= 0);
  }
  private randomYoung() {
    for (let k = 0; k < 500; k++) { const i = (this.rnd() * this.N) | 0; if (this.sp[i] && this.h[i] < 4 && !(this.flag[i] & F_DEAD) && this.ownedTile(i)) return i; }
    return -1;
  }

  // ---- goals ------------------------------------------------------------------------------------------
  metric(k: string) {
    const s = this.s;
    switch (k) {
      case 'cut': case 'unloaded': case 'tickets': case 'sold': case 'planted': case 'sheared': return s.stats[k] ?? 0;
      case 'year': return s.year;
      case 'veh': return s.veh;
      case 'parcels': return this.parcels;
      case 'blocks': return s.blocks.length;
      case 'crew': return s.crew.length;
      case 'yrTickets': return s.yr.ordersN;
      case 'standing': return this.standing;
      case 'yrSold': return s.yr.sold;
      case 'species': return s.unlocked.filter(Boolean).length + (s.unlocked[3] ? 0 : -9);
      case 'bestStreak': return s.stats.bestStreak ?? 0;
      case 'rank': return -(s.stats.bestRank ?? 9);
    }
    return 0;
  }
  private checkGoals() {
    const s = this.s; if (s.goal >= GOALS.length) return;
    s.stats.bestStreak = Math.max(s.stats.bestStreak ?? 0, s.streak);
    const g = GOALS[s.goal], m = this.metric(g.check), ok = g.check === 'rank' ? m >= -g.n! : m >= g.n!;
    if (ok) { s.money += g.cash; s.goal++; s.goalsDone++; this.emit({ k: 'goal', t: g.text, cash: g.cash }); }
  }

  // ---- year end ---------------------------------------------------------------------------------------
  private christmasEve() {
    const s = this.s;
    // anything still in hand goes to the wholesaler for what it'll fetch
    this.stockHopper(s.p.hop);
    for (const t of s.tickets.slice()) this.finishTicket(t, false);
    s.phase = 'eve';
  }
  lastReport: Report | null = null;
  makeReport(): Report {
    const s = this.s;
    if (s.stockN > 0) this.sellSurplus(1);
    const old = this.tierAtYearStart;
    s.rivals = s.rivals.map((v, i) => Math.round(v + (RIVALS[i].cap - v) * RIVALS[i].grow * (0.7 + this.rnd() * 0.6)));
    const list = RIVALS.map((r, i) => ({ name: r.name, sold: s.rivals[i] } as { name: string; sold: number; me?: boolean })).concat([{ name: 'Pine & Dandy', sold: s.yr.sold, me: true }]).sort((a, b) => b.sold - a.sold);
    const rank = list.findIndex((r) => r.me) + 1;
    s.stats.bestRank = Math.min(s.stats.bestRank ?? 9, rank);
    s.history.push({ year: s.year, sold: s.yr.sold, revenue: s.yr.revenue, net: this.net() });
    s.rushBest = Math.max(s.rushBest, s.yr.revenue);
    const letter = rank === 1 && !s.seen.buck3 ? 'buck3' : rank <= 2 && !s.seen.buck2 ? 'buck2' : s.year === 1 ? 'buck0' : s.year === 3 ? 'buck1' : '';
    if (letter) s.seen[letter] = true;
    const tierUp = this.tier !== old ? TIERS[this.tier].name : null; this.tierAtYearStart = this.tier;
    this.lastReport = { year: s.year, y: { ...s.yr }, rivals: list, rank, letter, net: this.net(), standing: this.standing, tierUp };
    s.phase = 'report';
    return this.lastReport;
  }
  tierAtYearStart = 0;
  perkChoices(): typeof PERKS { const a = PERKS.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (this.rnd() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, 3); }
  startNewYear(perk: string | null) {
    const s = this.s;
    if (perk) s.perks[perk] = (s.perks[perk] ?? 0) + 1;
    const tax = this.parcels * 25, interest = Math.round(s.debt * 0.08);
    s.money -= tax + interest; s.yr = yrZero(); s.yr.bills = tax + interest;
    s.year++; s.month = 0; s.day = 1; s.dayF = 0; s.streak = 0; s.shield = this.pk('streak'); s.thieves = 0; s.gold = -1; s.priority = -1; s.tickets = []; s.blizzard = 0; s.tv = 0;
    for (let i = 0; i < NS; i++) this.extendMarket(i, s.year + 8);
    for (let i = 0; i < this.N; i++) this.flag[i] &= ~(F_SHEARED | F_IMMUNE | F_WATERED | F_GOLD);
    s.phase = 'play'; this.touchAll(); this.emit({ k: 'month' }); this.emit({ k: 'saved' });
  }

  // ---- save -------------------------------------------------------------------------------------------
  serialize() {
    const enc = (a: ArrayBufferView) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let t = ''; for (let i = 0; i < u.length; i += 8192) t += String.fromCharCode(...u.subarray(i, i + 8192)); return btoa(t); };
    return JSON.stringify({ s: this.s, rs: this.rs, tier0: this.tierAtYearStart, a: [this.terr, this.sp, this.h, this.shape, this.flag, this.pest, this.fert, this.bld].map(enc) });
  }
  deserialize(j: string) {
    const d = JSON.parse(j), keys = [this.terr, this.sp, this.h, this.shape, this.flag, this.pest, this.fert, this.bld];
    d.a.forEach((b: string, k: number) => { const t = atob(b), u = new Uint8Array(keys[k].buffer); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); });
    this.s = d.s; this.rs = d.rs; this.tierAtYearStart = d.tier0 ?? 0; this.rebuildWet(); this.recount(); this.refreshCensus(); this.touchAll(); this.terrVer++;
  }
}
void SIZE_NAME;
