// World drawing. Four zoom levels from 16 px a tile to 2: near is live sprites with wind in the rows,
// far is cached chunks, so a 30,000-tree farm costs no more than a small one.
import { C, canvas, hash, mix } from './pal';
import { Sim, MW, MH, CH, CW, CHH, PS, PW, PH, T_WATER, T_WILD, T_GRASS, F_DEAD, F_GOLD, F_PEST, F_THIRST, F_STUMP, stageOf, TOOL_SAW, TOOL_PLANT, TOOL_SHEAR, TOOL_TANK, type Block } from './sim.ts';
import { SPECIES, BUILDINGS, VEHICLES, CREW, gradeOf, SIZE_MIN } from './data.ts';
import { treeSprite, wildSprite, groundPal, groundTile, buildingSprite, person, machine, deerSprite, dogSprite, carSprite, thiefSprite, STAGE_PX, BLD_TOP, type GroundPal, type Look } from './art';
import { text, center, textW } from './font';

interface Chunk { c: HTMLCanvasElement; g: CanvasRenderingContext2D; ver: number; key: string; terr: number }
interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; s: number; grav: number; }
interface Floater { x: number; y: number; t: string; col: string; life: number; big?: boolean }
interface Fall { x: number; y: number; img: HTMLCanvasElement; t: number; dir: number }
interface Car { x: number; y: number; st: number; t: number; col: string; tree: boolean; dir: number; stop: number; fam: number; px: number; py: number; look: Look }

export const PLAYER_LOOK: Look = { hat: C.red, coat: C.pine, skin: '#f0c8a0', pants: C.dusk };
const VEH_TINT = ['', C.blue, C.red, C.leaf, C.orange];
const CREW_LOOKS: Look[] = [C.gold, C.blue, C.aqua, C.pink, C.white, C.orange].map((hat, i) => ({ hat, coat: [C.brown, C.dred, C.dusk, C.teal, C.purple, C.bark][i], skin: ['#f0c8a0', '#c8966a', '#8a5a3c'][i % 3], pants: C.dusk }));
const CREW_TINT = ['', C.teal, C.orange, C.purple];
const CAR_COLS = [C.red, C.blue, C.gold, C.teal, C.white, C.purple, C.orange];

export class Renderer {
  W = 480; H = 300; z = 16; cx = 125; cy = 72; free = false; shake = 0; t = 0;
  private chunks = new Map<string, Chunk>();
  parts: Part[] = []; floats: Floater[] = []; falls: Fall[] = []; cars: Car[] = [];
  flakes: { x: number; y: number; s: number }[] = [];
  overlay = 0; ticketHi: { sp: number; minZ: number } | null = null; focusBlock: Block | null = null; landMode = false;
  ghost: { k: string; x: number; y: number; ok: boolean } | null = null; drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  pings: { x: number; y: number; t: number; col: string }[] = [];
  constructor(public sim: Sim) { for (let i = 0; i < 160; i++) this.flakes.push({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() }); }

  screenToTile(sx: number, sy: number) { return { x: (sx + this.camX()) / this.z, y: (sy + this.camY()) / this.z }; }
  camX() { return Math.round(this.cx * this.z - this.W / 2); }
  camY() { return Math.round(this.cy * this.z - this.H / 2); }
  clampCam() { const hw = this.W / 2 / this.z, hh = this.H / 2 / this.z; this.cx = hw * 2 >= MW ? MW / 2 : Math.max(hw, Math.min(MW - hw, this.cx)); this.cy = hh * 2 >= MH ? MH / 2 : Math.max(hh, Math.min(MH - hh, this.cy)); }

  envKey() { const s = this.sim; return `${s.season()}.${s.snowLevel()}.${s.s.drought > 0 ? 1 : 0}`; }

  private buildChunk(z: number, ci: number, ch: Chunk, pal: GroundPal, snow: number, season: number) {
    const sim = this.sim, g = ch.g, x0 = (ci % CW) * CH, y0 = ((ci / CW) | 0) * CH, top = this.chunkTop(z);
    const trees = z < 16, snowq = snow >= 3 ? 2 : snow >= 2 ? 1 : 0;
    g.clearRect(0, 0, ch.c.width, ch.c.height);
    const n = (x: number, y: number) => (dx: number, dy: number) => { const X = x + dx, Y = y + dy; return sim.inMap(X, Y) ? sim.terr[sim.idx(X, Y)] : 2; };
    for (let y = 0; y < CH; y++) for (let x = 0; x < CH; x++) {
      const X = x0 + x, Y = y0 + y, i = sim.idx(X, Y), t = sim.terr[i], px = x * z, py = y * z + top;
      groundTile(g, pal, t === T_WILD ? 0 : t, X, Y, px, py, z, sim.sp[i] > 0, n(X, Y));
      if (sim.flag[i] & F_STUMP && !sim.sp[i]) {
        if (z >= 16) { g.fillStyle = C.bark; g.fillRect(px + 6, py + 9, 5, 4); g.fillStyle = C.tan; g.fillRect(px + 6, py + 9, 5, 2); g.fillStyle = C.brown; g.fillRect(px + 8, py + 9, 1, 1); }
        else if (z >= 4) { g.fillStyle = C.tan; g.fillRect(px + (z >> 2), py + (z >> 1), Math.max(1, z >> 1), Math.max(1, z >> 2)); }
        else { g.fillStyle = pal.soil; g.fillRect(px, py, z, z); }
      }
      if (!sim.ownedAt(X, Y) && t !== T_WATER) { g.fillStyle = 'rgba(18,18,40,.14)'; g.fillRect(px, py, z, z); }
      else if (z >= 8 && t !== T_WATER) {
        g.fillStyle = C.bark;
        if (!sim.ownedAt(X, Y - 1)) { g.fillRect(px, py, z, 1); if (z >= 16) g.fillRect(px + 2, py - 3, 1, 4), g.fillRect(px + 10, py - 3, 1, 4); }
        if (!sim.ownedAt(X, Y + 1)) g.fillRect(px, py + z - 1, z, 1);
        if (!sim.ownedAt(X - 1, Y)) g.fillRect(px, py, 1, z);
        if (!sim.ownedAt(X + 1, Y)) g.fillRect(px + z - 1, py, 1, z);
      }
    }
    if (!trees) return;
    // buildings first: tree rows in front of them sit on top
    const list: { y: number; f: () => void }[] = [];
    for (const b of sim.s.blds) {
      const d = BUILDINGS[b.k]; if (b.x + d.w <= x0 || b.x >= x0 + CH || b.y + d.h <= y0 || b.y >= y0 + CH) continue;
      const img = buildingSprite(b.k, snow >= 2, false), sc = z / 16;
      list.push({ y: b.y + d.h - 1, f: () => g.drawImage(img, (b.x - x0) * z, (b.y - y0) * z + top - BLD_TOP * sc, img.width * sc, img.height * sc) });
    }
    list.sort((a, b) => a.y - b.y); let li = 0;
    for (let y = 0; y < CH; y++) {
      while (li < list.length && list[li].y <= y0 + y) list[li++].f();
      for (let x = 0; x < CH; x++) {
        const X = x0 + x, Y = y0 + y, i = sim.idx(X, Y), sp = sim.sp[i], px = x * z, py = y * z + top;
        if (sim.terr[i] === T_WILD) {
          if (z <= 2) { g.fillStyle = season === 3 && hash(X, Y) > 0.7 ? C.orange : snow >= 2 ? '#7f9ab0' : C.forest; g.fillRect(px, py, z, z); }
          else { const v = (hash(X, Y, 5) * 6) | 0, im = wildSprite(Math.max(4, ((30 + hash(X, Y, 8) * 9) * z / 16) | 0), season, snow, v); g.drawImage(im, px + z / 2 - (im.width >> 1), py + z - im.height); }
        } else if (sp) {
          const fl = sim.flag[i], st = stageOf(sim.h[i]);
          if (z <= 2) { const c = fl & F_DEAD ? C.brown : fl & F_PEST ? C.gold : SPECIES[sp - 1].ramp[st >= 5 ? 1 : st >= 3 ? 2 : 3]; g.fillStyle = snow >= 3 && st >= 3 && (X + Y) % 2 ? mix(c, C.white, 0.5) : c; g.fillRect(px, py + (st < 3 ? 0 : -1), z, st < 3 ? z : z + 1); }
          else {
            const px2 = Math.max(2, Math.round(STAGE_PX[st] * z / 16)), kind = fl & F_DEAD ? 1 : fl & F_GOLD ? 2 : fl & F_PEST ? 3 : 0;
            const im = treeSprite(sp - 1, px2, Math.min(2, gradeOf(sim.shape[i])), snowq, 0, kind, (hash(X, Y) * 3) | 0);
            g.drawImage(im, px + z / 2 - (im.width >> 1), py + z - im.height + 1);
          }
        }
      }
    }
    while (li < list.length) list[li++].f();
  }
  private chunkTop(z: number) { return z < 16 ? 4 * z : 4; }

  private chunk(z: number, ci: number, budget: { n: number }, pal: GroundPal, snow: number, season: number, env: string) {
    const key = z * 1000 + ci; let ch = this.chunks.get(String(key));
    const stale = !ch || ch.ver !== this.sim.ver[ci] || ch.key !== env || ch.terr !== this.sim.terrVer;
    if (!ch) { const r = canvas(CH * z, CH * z + this.chunkTop(z)); ch = { c: r.c, g: r.g, ver: -1, key: '', terr: -1 }; this.chunks.set(String(key), ch); }
    if (stale && (ch.ver < 0 || budget.n > 0)) { budget.n--; this.buildChunk(z, ci, ch, pal, snow, season); ch.ver = this.sim.ver[ci]; ch.key = env; ch.terr = this.sim.terrVer; }
    return ch;
  }
  /** the whole farm as an image, for the Christmas Eve flight */
  farmImage() {
    const r = canvas(MW * 2, MH * 2), pal = groundPal(0, 3, false);
    for (let ci = 0; ci < CW * CHH; ci++) { const ch = this.chunk(2, ci, { n: 1 }, pal, 3, 0, this.envKey()); r.g.drawImage(ch.c, (ci % CW) * CH * 2, ((ci / CW) | 0) * CH * 2 - this.chunkTop(2)); }
    return r;
  }

  draw(g: CanvasRenderingContext2D, dt: number) {
    const sim = this.sim, s = sim.s, z = this.z, W = this.W, H = this.H; this.t += dt;
    const p = s.p;
    if (!this.free) { const k = Math.min(1, dt * 6); this.cx += (p.x - this.cx) * k; this.cy += (p.y - this.cy) * k; }
    this.clampCam();
    const sk = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0, sk2 = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0; this.shake *= Math.exp(-dt * 9);
    const camX = this.camX() + Math.round(sk), camY = this.camY() + Math.round(sk2);
    const season = sim.season(), snow = sim.snowLevel(), dry = s.drought > 0, pal = groundPal(season, snow, dry), env = this.envKey();
    g.fillStyle = season === 0 ? '#c8d8e4' : C.forest; g.fillRect(0, 0, W, H);
    const c0 = Math.max(0, Math.floor(camX / z / CH)), c1 = Math.min(CW - 1, Math.floor((camX + W) / z / CH)), r0 = Math.max(0, Math.floor(camY / z / CH)), r1 = Math.min(CHH - 1, Math.floor((camY + H + 64) / z / CH));
    const budget = { n: 3 }, top = this.chunkTop(z);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const ch = this.chunk(z, r * CW + c, budget, pal, snow, season, env); g.drawImage(ch.c, c * CH * z - camX, r * CH * z - camY - top); }
    if (z === 16) this.drawNear(g, camX, camY, season, snow);
    else this.drawFar(g, camX, camY);
    this.drawOverlays(g, camX, camY);
    this.drawFx(g, camX, camY, dt);
    this.drawEnv(g, camX, camY, dt, snow);
  }

  private drawNear(g: CanvasRenderingContext2D, camX: number, camY: number, season: number, snow: number) {
    const sim = this.sim, s = sim.s, W = this.W, H = this.H, z = 16, t = this.t, snowq = snow >= 3 ? 2 : snow >= 2 ? 1 : 0;
    const x0 = Math.max(0, Math.floor(camX / z) - 1), x1 = Math.min(MW - 1, Math.ceil((camX + W) / z) + 1), y0 = Math.max(0, Math.floor(camY / z)), y1 = Math.min(MH - 1, Math.ceil((camY + H) / z) + 4);
    // water sparkle
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (sim.terr[sim.idx(x, y)] === T_WATER) { const f = (t * 1.6 + hash(x, y) * 8) % 8; if (f < 2) { g.fillStyle = snow >= 2 ? C.white : C.ice; g.fillRect(x * z - camX + ((hash(x, y, 2) * 12) | 0), y * z - camY + ((hash(x, y, 3) * 14) | 0), 3 - (f | 0), 1); } }
    const ents: { y: number; f: () => void }[] = [];
    const lit = sim.dusk() > 0.35;
    for (const b of s.blds) {
      const d = BUILDINGS[b.k]; if (b.x + d.w < x0 || b.x > x1 || b.y + d.h < y0 - 3 || b.y > y1) continue;
      ents.push({ y: b.y + d.h - 0.5, f: () => g.drawImage(buildingSprite(b.k, snow >= 2, lit), b.x * z - camX, b.y * z - camY - BLD_TOP) });
    }
    for (const c of this.cars) ents.push({ y: c.y, f: () => { const im = carSprite(c.col, c.tree, c.dir); g.drawImage(im, Math.round(c.x * z - camX - 15), Math.round(c.y * z - camY - 14)); if (c.st === 2 || c.st === 3) { const im2 = person(c.look, c.st === 2 ? 0 : 2, ((this.t * 8) | 0) % 4, c.st === 3); g.drawImage(im2, Math.round(c.px * z - camX - 5), Math.round(c.py * z - camY - 14)); } } });
    this.entities(ents, camX, camY, z);
    ents.sort((a, b) => a.y - b.y); let ei = 0;
    for (let y = y0; y <= y1; y++) {
      while (ei < ents.length && ents[ei].y < y) ents[ei++].f();
      for (let x = x0; x <= x1; x++) {
        const i = sim.idx(x, y), sp = sim.sp[i], px = x * z - camX, py = y * z - camY;
        if (sim.terr[i] === T_WILD) { const v = (hash(x, y, 5) * 6) | 0, im = wildSprite((30 + hash(x, y, 8) * 9) | 0, season, snow, v); g.drawImage(im, px + 8 - (im.width >> 1), py + 16 - im.height); continue; }
        if (!sp) continue;
        const fl = sim.flag[i], st = stageOf(sim.h[i]), kind = fl & F_DEAD ? 1 : fl & F_GOLD ? 2 : fl & F_PEST ? 3 : 0;
        const wind = Math.sin(t * 1.7 + x * 0.42 + y * 0.31 + Math.sin(t * 0.3 + y * 0.1) * 2), sway = wind > 0.45 && !kind ? 1 : wind < -0.75 && !kind ? -1 : 0;
        const im = treeSprite(sp - 1, STAGE_PX[st], Math.min(2, gradeOf(sim.shape[i])), snowq, sway, kind as 0, (hash(x, y) * 3) | 0);
        const bump = this.bumps(x, y);
        g.drawImage(im, px + 8 - (im.width >> 1) + bump, py + 17 - im.height);
        if (fl & F_THIRST) { g.fillStyle = C.sky; g.fillRect(px + 8, py - 3 + (((t * 2) | 0) % 2), 2, 2); }
        if (fl & F_GOLD) { const k = ((t * 6) | 0) % 4; g.fillStyle = C.white; g.fillRect(px + 2 + k * 3, py + 6 - STAGE_PX[st] + k * 5, 1, 3); g.fillRect(px + 1 + k * 3, py + 7 - STAGE_PX[st] + k * 5, 3, 1); }
      }
    }
    while (ei < ents.length) ents[ei++].f();
    // the player is always readable through a wall of firs
    const p = s.p, pi = sim.idx(Math.floor(p.x), Math.min(MH - 1, Math.floor(p.y) + 1));
    if (sim.sp[pi] && sim.h[pi] > 3) { g.globalAlpha = 0.45; this.drawPlayer(g, camX, camY, z); g.globalAlpha = 1; }
  }
  private bumps(x: number, y: number) { const p = this.sim.s.p; if (!p.moving) return 0; const d = Math.abs(p.x - x - 0.5) + Math.abs(p.y - y - 0.5); return d < 1.2 ? (((this.t * 22) | 0) % 2 ? 1 : -1) : 0; }

  private entities(ents: { y: number; f: () => void }[], camX: number, camY: number, z: number) {
    const s = this.sim.s, fr = ((this.t * 8) | 0) % 4;
    ents.push({ y: s.p.y, f: () => this.drawPlayer(g2(this), camX, camY, z) });
    for (const a of s.crew) ents.push({
      y: a.y, f: () => {
        const g = g2(this);
        if (a.rank === 0) { const im = person(CREW_LOOKS[a.id % CREW_LOOKS.length], a.dir, a.moving ? fr : 0, a.hop.n > 0); g.drawImage(im, Math.round(a.x * z - camX - 5), Math.round(a.y * z - camY - 14)); }
        else { const load = Math.round(a.hop.n / CREW[a.rank].cap * 6), im = machine(a.rank, a.dir, a.moving ? fr % 2 : 0, CREW_TINT[a.rank], load); g.drawImage(im, Math.round(a.x * z - camX - im.width / 2), Math.round(a.y * z - camY - im.height + 4)); }
      },
    });
    for (const c of s.critters) ents.push({
      y: c.y, f: () => {
        const g = g2(this), d = c.vx >= 0 ? 1 : 3, f2 = fr % 2;
        const im = c.k === 'deer' ? deerSprite(d, f2) : c.k === 'dog' ? dogSprite(d, Math.hypot(c.vx, c.vy) > 0.5 ? f2 : 0) : thiefSprite(fr);
        g.drawImage(im, Math.round(c.x * z - camX - im.width / 2), Math.round(c.y * z - camY - im.height + 2));
      },
    });
  }
  private cachedG!: CanvasRenderingContext2D;
  setG(g: CanvasRenderingContext2D) { this.cachedG = g; }
  getG() { return this.cachedG; }

  private drawPlayer(g: CanvasRenderingContext2D, camX: number, camY: number, z: number) {
    const s = this.sim.s, p = s.p, fr = ((this.t * 9) | 0) % 4, x = Math.round(p.x * z - camX), y = Math.round(p.y * z - camY);
    if (s.veh === 0) { const im = person(PLAYER_LOOK, p.dir, p.moving ? fr : 0, p.hop.n > 0); g.drawImage(im, x - 5, y - 14); }
    else {
      const load = Math.round(p.hop.n / this.sim.hopCap() * 8), air = VEHICLES[s.veh].air;
      const im = machine(s.veh, p.dir, (p.moving || air ? fr % 2 : 0), VEH_TINT[s.veh], load);
      if (air) { g.fillStyle = 'rgba(18,18,28,.28)'; g.fillRect(x - 28, y + 6, 56, 6); g.drawImage(im, x - (im.width >> 1), y - im.height - 8 + Math.sin(this.t * 3) * 2); }
      else g.drawImage(im, x - (im.width >> 1), y - im.height + 5);
    }
  }

  private drawFar(g: CanvasRenderingContext2D, camX: number, camY: number) {
    const sim = this.sim, s = sim.s, z = this.z, fr = ((this.t * 8) | 0) % 4;
    if (z === 8) {
      for (const c of this.cars) { const im = carSprite(c.col, c.tree, c.dir); g.drawImage(im, Math.round(c.x * z - camX - 8), Math.round(c.y * z - camY - 7), 15, 9); }
      for (const a of s.crew) {
        const x = Math.round(a.x * z - camX), y = Math.round(a.y * z - camY);
        if (a.rank === 0) { const im = person(CREW_LOOKS[a.id % CREW_LOOKS.length], a.dir, a.moving ? fr : 0, false); g.drawImage(im, x - 3, y - 8, 6, 8); }
        else { const im = machine(a.rank, a.dir, fr % 2, CREW_TINT[a.rank], 0), w = im.width / 2, h = im.height / 2; g.drawImage(im, x - w / 2, y - h + 2, w, h); }
      }
      for (const c of s.critters) { const im = c.k === 'deer' ? deerSprite(c.vx >= 0 ? 1 : 3, fr % 2) : c.k === 'dog' ? dogSprite(c.vx >= 0 ? 1 : 3, fr % 2) : thiefSprite(fr); g.drawImage(im, Math.round(c.x * z - camX - im.width / 4), Math.round(c.y * z - camY - im.height / 2), im.width / 2, im.height / 2); }
      const p = s.p, x = Math.round(p.x * z - camX), y = Math.round(p.y * z - camY);
      if (s.veh === 0) g.drawImage(person(PLAYER_LOOK, p.dir, p.moving ? fr : 0, false), x - 3, y - 8, 6, 8);
      else { const im = machine(s.veh, p.dir, fr % 2, VEH_TINT[s.veh], 0), w = im.width / 2, h = im.height / 2; g.drawImage(im, x - w / 2, y - h + 2, w, h); }
      return;
    }
    for (const a of s.crew) { g.fillStyle = a.rank ? CREW_TINT[a.rank] : CREW_LOOKS[a.id % CREW_LOOKS.length].hat; g.fillRect(Math.round(a.x * z - camX), Math.round(a.y * z - camY), Math.max(2, z / 2 + a.rank), Math.max(2, z / 2 + a.rank)); }
    for (const c of s.critters) if (c.k !== 'dog') { g.fillStyle = c.k === 'deer' ? C.tan : C.purple; g.fillRect(Math.round(c.x * z - camX), Math.round(c.y * z - camY), 2, 2); }
    const p = s.p, x = Math.round(p.x * z - camX), y = Math.round(p.y * z - camY), bl = ((this.t * 3) | 0) % 2;
    g.fillStyle = bl ? C.white : C.red; g.fillRect(x - 2, y - 2, 4, 4); g.strokeStyle = C.white; g.lineWidth = 1;
    g.strokeRect(x - 5.5, y - 5.5, 11, 11);
  }

  private drawOverlays(g: CanvasRenderingContext2D, camX: number, camY: number) {
    const sim = this.sim, s = sim.s, z = this.z, W = this.W, H = this.H, t = this.t;
    const x0 = Math.max(0, Math.floor(camX / z)), x1 = Math.min(MW - 1, Math.ceil((camX + W) / z)), y0 = Math.max(0, Math.floor(camY / z)), y1 = Math.min(MH - 1, Math.ceil((camY + H) / z));
    // blocks
    for (const b of s.blocks) {
      const sel = b === this.focusBlock, col = sel ? C.white : SPECIES[b.sp].ramp[3];
      dashRect(g, b.x * z - camX, b.y * z - camY, b.w * z, b.h * z, col, t, sel);
      if (z >= 4) { const lx = b.x * z - camX + 2, ly = b.y * z - camY + 2; g.fillStyle = 'rgba(18,18,28,.72)'; g.fillRect(lx, ly, textW(b.name) + 4, 10); text(g, b.name, lx + 2, ly + 1, col); }
    }
    if (this.drag) { const d = this.drag, x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0) + 1, h = Math.abs(d.y1 - d.y0) + 1; g.fillStyle = 'rgba(244,197,66,.2)'; g.fillRect(x * z - camX, y * z - camY, w * z, h * z); dashRect(g, x * z - camX, y * z - camY, w * z, h * z, C.gold, t, true); center(g, `${w} x ${h}`, (x + w / 2) * z - camX, y * z - camY - 11, C.white, 1, C.ink); }
    if (this.ticketHi || this.overlay) {
      const hi = this.ticketHi, blink = ((t * 3) | 0) % 2, step = z <= 2 ? 1 : 1;
      for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
        const i = sim.idx(x, y), sp = sim.sp[i]; if (!sp || sim.flag[i] & F_DEAD || !sim.ownedTile(i)) continue;
        if (hi) { if ((hi.sp < 0 || sp - 1 === hi.sp) && sim.h[i] >= SIZE_MIN[hi.minZ]) { g.fillStyle = blink ? 'rgba(244,197,66,.75)' : 'rgba(244,197,66,.4)'; g.fillRect(x * z - camX, y * z - camY, z, z); } continue; }
        if (this.overlay === 1) { const h = sim.h[i]; g.fillStyle = h >= 7 ? 'rgba(244,197,66,.6)' : h >= 5 ? 'rgba(180,212,90,.5)' : h >= 3 ? 'rgba(98,199,176,.45)' : 'rgba(127,183,224,.4)'; g.fillRect(x * z - camX, y * z - camY, z, z); }
        else if (this.overlay === 2) { g.fillStyle = SPECIES[sp - 1].ramp[3]; g.globalAlpha = 0.75; g.fillRect(x * z - camX, y * z - camY, z, z); g.globalAlpha = 1; }
      }
    }
    if (sim.infected.length && z <= 8 && ((t * 3) | 0) % 2) { g.fillStyle = C.red; for (const i of sim.infected) { const x = i % MW, y = (i / MW) | 0; g.fillRect(x * z - camX, y * z - camY, z, z); } }
    if (this.landMode) {
      for (let py = 0; py < PH; py++) for (let px = 0; px < PW; px++) {
        const sx = px * PS * z - camX, sy = py * PS * z - camY, sz = PS * z, own = s.owned[py * PW + px], can = sim.canBuyParcel(px, py);
        if (sx > W || sy > H || sx + sz < 0 || sy + sz < 0) continue;
        if (!own && !can) { g.fillStyle = 'rgba(18,18,40,.32)'; g.fillRect(sx, sy, sz, sz); }
        if (can) { g.fillStyle = 'rgba(244,197,66,.16)'; g.fillRect(sx, sy, sz, sz); }
        g.strokeStyle = own ? 'rgba(247,245,234,.5)' : can ? C.gold : 'rgba(247,245,234,.15)'; g.lineWidth = 1; g.strokeRect(sx + 0.5, sy + 0.5, sz - 1, sz - 1);
      }
    }
    if (this.ghost) {
      const k = this.ghost, d = BUILDINGS[k.k];
      if (d) { g.globalAlpha = 0.7; const img = buildingSprite(k.k, false, false), sc = z / 16; g.drawImage(img, k.x * z - camX, k.y * z - camY - BLD_TOP * sc, img.width * sc, img.height * sc); g.globalAlpha = 1; }
      g.strokeStyle = k.ok ? C.lime : C.red; g.lineWidth = 1; g.strokeRect(k.x * z - camX + 0.5, k.y * z - camY + 0.5, (d?.w ?? 1) * z - 1, (d?.h ?? 1) * z - 1);
    }
    // the tool's swath, the promise of what holding the button will do
    const p = s.p, v = VEHICLES[s.veh], sw = sim.swathOf(p.x, p.y, v.w);
    const tc = [C.gold, C.lime, C.aqua, C.sky][p.tool];
    g.strokeStyle = tc; g.globalAlpha = p.acting ? 0.9 : 0.4; g.lineWidth = 1;
    g.strokeRect(sw.x0 * z - camX + 0.5, sw.y0 * z - camY + 0.5, (sw.x1 - sw.x0 + 1) * z - 1, (sw.y1 - sw.y0 + 1) * z - 1); g.globalAlpha = 1;
    for (const q of this.pings) { const r = (1 - q.t) * 26; g.strokeStyle = q.col; g.lineWidth = 1; g.strokeRect(q.x * z - camX - r, q.y * z - camY - r, r * 2, r * 2); }
  }

  private drawFx(g: CanvasRenderingContext2D, camX: number, camY: number, dt: number) {
    const z = this.z;
    for (let i = this.falls.length - 1; i >= 0; i--) {
      const f = this.falls[i]; f.t += dt * 3.2; if (f.t > 1.4) { this.falls.splice(i, 1); continue; }
      const a = Math.min(1, f.t) ** 2 * 1.5 * f.dir, sc = z / 16;
      g.save(); g.translate(f.x * z - camX, f.y * z - camY); g.rotate(a); g.globalAlpha = f.t > 1 ? 1.4 - f.t : 1; g.drawImage(f.img, -f.img.width / 2 * sc, -f.img.height * sc, f.img.width * sc, f.img.height * sc); g.restore();
    }
    g.globalAlpha = 1;
    let w = 0;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]; p.life -= dt; if (p.life <= 0) continue;
      p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; this.parts[w++] = p;
      g.fillStyle = p.col; const s = z >= 8 ? p.s : 1; g.fillRect(Math.round(p.x * z - camX), Math.round(p.y * z - camY), s, s);
    }
    this.parts.length = w; w = 0;
    for (let i = 0; i < this.floats.length; i++) {
      const f = this.floats[i]; f.life -= dt; if (f.life <= 0) continue; this.floats[w++] = f; f.y -= dt * (22 / z);
      center(g, f.t, f.x * z - camX, f.y * z - camY, f.col, f.big ? 2 : 1, C.ink);
    }
    this.floats.length = w; w = 0;
    for (let i = 0; i < this.pings.length; i++) { const q = this.pings[i]; q.t -= dt * 0.8; if (q.t > 0) this.pings[w++] = q; }
    this.pings.length = w;
  }

  private drawEnv(g: CanvasRenderingContext2D, camX: number, camY: number, dt: number, snow: number) {
    const sim = this.sim, s = sim.s, W = this.W, H = this.H, z = this.z, d = sim.dusk();
    if (d > 0.02) {
      g.globalCompositeOperation = 'multiply'; g.fillStyle = mix('#ffffff', '#2c3a9e', Math.min(1, d)); g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
      if (d > 0.25) this.lights(g, camX, camY, d);
    }
    // blizzard, snowfall, summer haze
    const falling = s.blizzard > 0 ? 2 : (s.month === 11 || s.month === 0 || s.month === 1) ? 1 : 0, rain = !falling && (s.month >= 2 && s.month <= 4) && Math.sin(s.month * 5 + s.day / 4) > 0.55;
    if (falling) {
      const wind = falling === 2 ? 2.2 : 0.3;
      for (const f of this.flakes) {
        f.y += dt * f.s * 0.26 * falling; f.x += dt * (wind * 0.1 + Math.sin(this.t + f.s * 9) * 0.02); if (f.y > 1) f.y -= 1; if (f.x > 1) f.x -= 1; if (f.x < 0) f.x += 1;
        g.fillStyle = f.s > 1 ? C.white : C.ice; const sz = f.s > 1.1 ? 2 : 1; g.fillRect((f.x * W) | 0, (f.y * H) | 0, sz, sz);
      }
      if (falling === 2) { g.fillStyle = 'rgba(201,232,242,.2)'; g.fillRect(0, 0, W, H); }
    } else if (rain) {
      g.fillStyle = 'rgba(201,232,242,.55)';
      for (const f of this.flakes) { f.y += dt * f.s * 1.5; if (f.y > 1) f.y -= 1; g.fillRect((f.x * W) | 0, (f.y * H) | 0, 1, 4); }
    } else if (s.month === 8 || s.month === 9) {
      for (let i = 0; i < 14; i++) { const f = this.flakes[i]; f.y += dt * 0.05 * f.s; f.x += dt * 0.04; if (f.y > 1) f.y -= 1; if (f.x > 1) f.x -= 1; g.fillStyle = i % 2 ? C.orange : C.gold; g.fillRect((f.x * W) | 0, (f.y * H) | 0, 2, 1); }
    }
    void snow; void z;
  }
  private lights(g: CanvasRenderingContext2D, camX: number, camY: number, d: number) {
    const sim = this.sim, z = this.z, W = this.W, H = this.H, t = this.t;
    const x0 = Math.max(0, Math.floor(camX / z)), x1 = Math.min(MW - 1, Math.ceil((camX + W) / z)), y0 = Math.max(0, Math.floor(camY / z)), y1 = Math.min(MH - 1, Math.ceil((camY + H) / z) + 2);
    const cols = [C.red, C.gold, C.aqua, C.pink, C.white, C.lime], a = Math.min(1, (d - 0.25) * 2.2);
    g.globalAlpha = a;
    // the lot and the barn throw warm light on the snow
    g.globalCompositeOperation = 'lighter';
    for (const b of sim.s.blds) {
      const dd = BUILDINGS[b.k]; if (b.k !== 'lot' && b.k !== 'house' && b.k !== 'barn' && b.k !== 'cocoa' && b.k !== 'santa') continue;
      const cx = (b.x + dd.w / 2) * z - camX, cy = (b.y + dd.h) * z - camY, r = dd.w * z * 0.9;
      if (cx < -r || cx > W + r || cy < -r || cy > H + r) continue;
      const gr = g.createRadialGradient(cx, cy, 2, cx, cy, r); gr.addColorStop(0, 'rgba(244,197,66,.3)'); gr.addColorStop(1, 'rgba(244,197,66,0)'); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
    const dens = z >= 8 ? 1 : z === 4 ? 0.6 : 0.3, s2 = z >= 16 ? 2 : 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = sim.idx(x, y); if (!sim.sp[i] || sim.h[i] < 3.5 || sim.flag[i] & F_DEAD) continue;
      const n = z >= 16 ? 4 : 1, st = STAGE_PX[stageOf(sim.h[i])] * z / 16;
      for (let k = 0; k < n; k++) {
        const h1 = hash(x, y, k + 40); if (h1 > dens) continue;
        const on = Math.sin(t * (1.4 + h1 * 2) + h1 * 40) > -0.2; if (!on) continue;
        const v = hash(x, y, k + 70), hw = st * 0.26 * v;
        g.fillStyle = cols[(h1 * 977 | 0) % cols.length];
        g.fillRect(Math.round((x + 0.5) * z - camX + (hash(x, y, k + 90) - 0.5) * 2 * hw), Math.round((y + 1) * z - camY - st * (1 - v * 0.92)), s2, s2);
      }
    }
    g.globalAlpha = 1;
  }

  // ---- reacting to the sim -------------------------------------------------------------------------------
  burst(x: number, y: number, n: number, cols: string[], up = 3) {
    if (this.parts.length > 500) return;
    for (let i = 0; i < n; i++) this.parts.push({ x, y, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * up - 0.5, life: 0.3 + Math.random() * 0.45, max: 1, col: cols[(Math.random() * cols.length) | 0], s: Math.random() > 0.6 ? 2 : 1, grav: 12 });
  }
  chop(x: number, y: number, sp: number, h: number, mine: boolean) {
    const S = SPECIES[sp]; const near = this.z >= 8;
    this.burst(x + 0.5, y + 0.3, near ? 8 : 2, [S.ramp[1], S.ramp[2], S.ramp[3], C.tan], 4);
    if (near && this.falls.length < 40) this.falls.push({ x: x + 0.5, y: y + 1, img: treeSprite(sp, STAGE_PX[stageOf(h)], 1, 0, 0, 0, 0), t: 0, dir: Math.random() > 0.5 ? 1 : -1 });
    if (mine) this.shake = Math.min(3, this.shake + 0.7);
  }
  float(x: number, y: number, t: string, col: string = C.gold, big = false) { if (this.floats.length < 40) this.floats.push({ x, y, t, col, life: 1.1, big }); }
  ping(x: number, y: number, col: string = C.red) { this.pings.push({ x, y, t: 1, col }); }
  spawnFamily() {
    if (this.cars.length >= 12) return;
    const l = this.sim.s.blds.find((b) => b.k === 'lot')!, dir = Math.random() > 0.5 ? 1 : 3;
    const hats = [C.red, C.blue, C.gold, C.white, C.pink], coats = [C.dusk, C.purple, C.teal, C.brown, C.dred], k = (Math.random() * 5) | 0;
    this.cars.push({ x: dir === 1 ? l.x - 34 : l.x + 44, y: dir === 1 ? 79.9 : 78.9, st: 0, t: 0, col: CAR_COLS[(Math.random() * CAR_COLS.length) | 0], tree: false, dir, stop: l.x - 3 + Math.random() * 12, fam: 0, px: 0, py: 0, look: { hat: hats[k], coat: coats[(k + 2) % 5], skin: ['#f0c8a0', '#c8966a', '#8a5a3c'][k % 3], pants: C.ink } });
  }
  stepCars(dt: number) {
    const l = this.sim.s.blds.find((b) => b.k === 'lot'); if (!l) return;
    for (const c of this.cars) {
      const v = c.dir === 1 ? 1 : -1;
      if (c.st === 0) { c.x += v * 9 * dt; if ((v > 0 && c.x >= c.stop) || (v < 0 && c.x <= c.stop)) { c.st = 1; c.t = 0.2; c.px = c.x; c.py = c.y - 0.6; } }
      else if (c.st === 1) { c.t -= dt; if (c.t < 0) c.st = 2; }
      else if (c.st === 2) { const tx = l.x + 3, ty = l.y + 4.5, dx = tx - c.px, dy = ty - c.py, d = Math.hypot(dx, dy); if (d < 0.3) c.st = 3; else { c.px += dx / d * 4.5 * dt; c.py += dy / d * 4.5 * dt; } }
      else if (c.st === 3) { const dx = c.x - c.px, dy = c.y - 0.6 - c.py, d = Math.hypot(dx, dy); if (d < 0.3) { c.st = 4; c.tree = true; } else { c.px += dx / d * 4 * dt; c.py += dy / d * 4 * dt; } }
      else { c.x += v * 11 * dt; }
    }
    this.cars = this.cars.filter((c) => c.x > l.x - 40 && c.x < l.x + 50);
  }
}
function g2(r: Renderer) { return r.getG(); }
function dashRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, t: number, live: boolean) {
  g.fillStyle = col; const o = live ? ((t * 10) | 0) % 6 : 0;
  for (let i = -o; i < w; i += 6) { const a = Math.max(0, i), b = Math.min(w, i + 3); if (b > a) { g.fillRect(x + a, y, b - a, 1); g.fillRect(x + a, y + h - 1, b - a, 1); } }
  for (let i = -o; i < h; i += 6) { const a = Math.max(0, i), b = Math.min(h, i + 3); if (b > a) { g.fillRect(x, y + a, 1, b - a); g.fillRect(x + w - 1, y + a, 1, b - a); } }
}
void TOOL_SAW; void TOOL_PLANT; void TOOL_SHEAR; void TOOL_TANK; void T_GRASS;
