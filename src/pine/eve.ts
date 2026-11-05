// Christmas Eve, the playable part: a sleigh run on rails over your own farm. Pure logic, so
// tools/pinebot-style checks can fly it in Node. Distances are in farm-texture pixels (2 per tile).
//   s runs along the route, u is left/right of it, h is height above the snow.
export const EVE_U = 54, EVE_LOW = 24, EVE_HIGH = 82, RING_R = 13, CLOUD_R = 15, HOME_GOOD = 21, HOME_PERFECT = 9;
const TOSS = 1.55, GRAV = 75, RUN_SEC = 60, LEAD = 520;

// The play itself is a straight corridor. Underneath it the farm sweeps past on this wide loop, so the ground can
// bank and turn without anything you are aiming at swinging away. Texture pixels, 4 to a tile: straights and half circles.
const CX = 512, CY = 320, BEND = 240, HALF = 200, ARC = Math.PI * BEND;
export const ROUTE_LEN = 4 * HALF + 2 * ARC;
/** where the farm is under you at s, and which way it runs */
export function route(s: number) {
  let d = ((s % ROUTE_LEN) + ROUTE_LEN) % ROUTE_LEN;
  if (d < 2 * HALF) return { x: CX - HALF + d, y: CY - BEND, tx: 1, ty: 0 };
  d -= 2 * HALF;
  if (d < ARC) { const a = d / BEND; return { x: CX + HALF + Math.sin(a) * BEND, y: CY - Math.cos(a) * BEND, tx: Math.cos(a), ty: Math.sin(a) }; }
  d -= ARC;
  if (d < 2 * HALF) return { x: CX + HALF - d, y: CY + BEND, tx: -1, ty: 0 };
  d -= 2 * HALF; const a = d / BEND;
  return { x: CX - HALF - Math.sin(a) * BEND, y: CY + Math.cos(a) * BEND, tx: -Math.cos(a), ty: -Math.sin(a) };
}

export type EveKind = 'ring' | 'home' | 'cloud';
export interface EveObj { k: EveKind; s: number; u: number; h: number; v: number; st: 0 | 1 | 2 }
export interface EveGift { s: number; u: number; h: number; vh: number; v: number }
export type EveFx =
  | { k: 'ring'; o: EveObj; pts: number; mult: number; chain: number }
  | { k: 'home'; o: EveObj; pts: number; mult: number; perfect: boolean }
  | { k: 'lost'; o: EveObj } | { k: 'thud'; o: EveObj } | { k: 'snowbank'; s: number; u: number } | { k: 'toss' } | { k: 'mult'; mult: number };

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

export class EveRun {
  s = 0; u = 0; a = 48; vu = 0; va = 0; t = 0; speed: number; end: number; phase: 'run' | 'climb' | 'done' = 'run';
  objs: EveObj[] = []; gifts: EveGift[] = []; fx: EveFx[] = []; cd = 0; next = 0;
  score = 0; chain = 0; bestChain = 0; max = 0; homes = 0; delivered = 0; perfect = 0; rings = 0; ringsHit = 0; bumps = 0;
  constructor(seed: number, public year: number, public sold: number) {
    this.speed = 100 + Math.min(26, (year - 1) * 2.5); this.end = this.speed * RUN_SEC; this.build(rng(seed * 31 + year * 977));
  }
  get mult() { return Math.min(8, 1 + Math.floor(this.chain / 4)); }
  /** what a run is worth with every ring and a bullseye on every chimney */
  private tally() { let c = 0, m = 0; for (const o of this.objs.slice().sort((a, b) => a.s - b.s)) { if (o.k === 'cloud') continue; m += (o.k === 'ring' ? 100 : 500) * Math.min(8, 1 + Math.floor(c / 4)); c++; } this.max = m; }
  private build(r: () => number) {
    const v = this.speed / 100, sp = (x: number) => x * v;
    // the more families bought a tree, the more windows are lit tonight
    const perRow = this.sold > 120 ? 4 : 3, rows = this.sold > 300 ? 4 : this.sold > 40 ? 3 : 2;
    const plan: string[] = []; for (let i = 0; i < rows; i++) plan.push('homes');
    const fill = ['slalom', 'clouds', 'ladder', 'slalom', 'clouds', 'arc', 'ladder'];
    for (let i = 0; plan.length < 8; i++) plan.splice(1 + (i * 2) % (plan.length + 1), 0, fill[i % fill.length]);
    let s = sp(LEAD);
    const ring = (s: number, u: number, h: number) => { this.objs.push({ k: 'ring', s, u, h, v: 0, st: 0 }); this.rings++; };
    for (const p of plan) {
      if (p === 'slalom') { const A = 22 + r() * 18, ph = r() * 6, h0 = 40 + r() * 18; for (let i = 0; i < 6; i++) ring(s + i * sp(112), Math.sin(ph + i * 1.05) * A, h0 + Math.sin(ph * 2 + i * 0.8) * 10); s += sp(112 * 6); }
      else if (p === 'ladder') { const up = r() < 0.5, u0 = (r() - 0.5) * 50; for (let i = 0; i < 5; i++) ring(s + i * sp(116), u0 + (r() - 0.5) * 16, up ? 34 + i * 9 : 72 - i * 9); s += sp(116 * 5); }
      else if (p === 'arc') { const d = r() < 0.5 ? 1 : -1; for (let i = 0; i < 6; i++) { const q = i / 5 * Math.PI; ring(s + i * sp(104), d * Math.cos(q) * 38, 42 + Math.sin(q) * 26); } s += sp(104 * 6); }
      else if (p === 'clouds') {
        // walls of storm cloud with one way through, and a ring in the gap for anyone brave
        for (let w = 0; w < 3; w++) { const gap = Math.floor(r() * 3), ws = s + w * sp(210); for (let c = 0; c < 3; c++) { const u = (c - 1) * 37; if (c === gap) { ring(ws, u, 50); continue; } for (const h of [36, 62]) this.objs.push({ k: 'cloud', s: ws, u, h, v: r(), st: 0 }); } }
        s += sp(210 * 3);
      } else {
        for (let i = 0; i < perRow; i++) { const u = (i % 2 ? 1 : -1) * (12 + r() * 30); this.objs.push({ k: 'home', s: s + sp(40) + i * sp(190), u, h: 0, v: r(), st: 0 }); this.homes++; }
        s += sp(190 * perRow + 60);
      }
      s += sp(150);
    }
    this.end = Math.max(this.end, s + sp(180)); this.objs.sort((a, b) => a.s - b.s); this.tally();
  }
  /** the spot a gift dropped now would hit */
  landing() { const t = Math.sqrt(2 * this.a / GRAV); return { s: this.s + this.speed * TOSS * t, u: this.u }; }
  /** 0..1 of the best possible run */
  get pct() { return this.max ? this.score / this.max : 0; }
  get stars() { const p = this.pct; return p >= 0.72 ? 3 : p >= 0.45 ? 2 : p >= 0.2 ? 1 : 0; }
  private award(base: number) { const m = this.mult, pts = base * m; this.score += pts; this.chain++; this.bestChain = Math.max(this.bestChain, this.chain); if (this.mult > m) this.fx.push({ k: 'mult', mult: this.mult }); return { pts, m }; }
  private drop() { this.chain = this.chain >> 1; }
  step(dt: number, ix: number, iy: number, toss: boolean) {
    this.t += dt; this.cd -= dt;
    if (this.phase === 'done') { this.s += this.speed * dt; this.a += (60 - this.a) * dt; this.u *= 1 - dt; return; }
    if (this.phase === 'climb') { this.s += this.speed * dt; this.a += 34 * dt; this.u *= 1 - dt * 2; if (this.a > 150) this.phase = 'done'; this.stepGifts(dt); return; }
    const k = Math.min(1, dt * 9); this.vu += (ix * 96 - this.vu) * k; this.va += (-iy * 70 - this.va) * k;
    this.u += this.vu * dt; this.a += this.va * dt;
    if (Math.abs(this.u) > EVE_U) { this.u = Math.sign(this.u) * EVE_U; this.vu = 0; }
    if (this.a < EVE_LOW) { this.a = EVE_LOW; this.va = 0; } if (this.a > EVE_HIGH) { this.a = EVE_HIGH; this.va = 0; }
    const was = this.s; this.s += this.speed * dt;
    while (this.next < this.objs.length && this.objs[this.next].s <= (this.objs[this.next].k === 'home' ? this.s - this.speed * 1.6 : this.s)) {
      const o = this.objs[this.next++]; if (o.st) continue;
      if (o.k === 'home') { o.st = 2; this.drop(); this.fx.push({ k: 'lost', o }); continue; }
      const d = Math.hypot(o.u - this.u, o.h - this.a);
      if (o.k === 'ring') { if (d < RING_R + 2) { o.st = 1; this.ringsHit++; const { pts, m } = this.award(100); this.fx.push({ k: 'ring', o, pts, mult: m, chain: this.chain }); } else { o.st = 2; this.drop(); } }
      else if (d < CLOUD_R) { o.st = 1; this.chain = 0; this.bumps++; this.fx.push({ k: 'thud', o }); }
    }
    void was;
    if (toss && this.cd <= 0 && this.s > this.speed * 2) { this.cd = 0.3; this.gifts.push({ s: this.s, u: this.u, h: this.a, vh: 0, v: this.speed * TOSS }); this.fx.push({ k: 'toss' }); }
    this.stepGifts(dt);
    if (this.s >= this.end) this.phase = 'climb';
  }
  private stepGifts(dt: number) {
    for (const g of this.gifts) {
      g.s += g.v * dt; g.vh += GRAV * dt; g.h -= g.vh * dt; if (g.h > 0) continue;
      let best: EveObj | null = null, bd = 1e9;
      for (const o of this.objs) { if (o.k !== 'home' || o.st) continue; const d = Math.hypot(o.s - g.s, o.u - g.u); if (d < bd) { bd = d; best = o; } }
      if (best && bd < HOME_GOOD) {
        best.st = 1; this.delivered++; const perfect = bd < HOME_PERFECT; if (perfect) this.perfect++;
        const { pts, m } = this.award(perfect ? 500 : 250); this.fx.push({ k: 'home', o: best, pts, mult: m, perfect });
      } else { this.drop(); this.fx.push({ k: 'snowbank', s: g.s, u: g.u }); }
    }
    if (this.gifts.some((g) => g.h <= 0)) this.gifts = this.gifts.filter((g) => g.h > 0);
  }
}
