// World drawing. Four zoom levels from 16 px a tile to 2: near is live sprites with wind in the rows,
// far is cached chunks, so a 30,000-tree farm costs no more than a small one.
import { C, canvas, hash, mix, hex } from './pal';
import { Sim, MW, MH, CH, CW, CHH, PS, PW, PH, T_WATER, T_WILD, T_GRASS, T_ROAD, T_BRIDGE, F_DEAD, F_GOLD, F_PEST, F_THIRST, F_STUMP, stageOf, TOOL_SAW, TOOL_PLANT, TOOL_SHEAR, TOOL_TANK, type Block } from './sim.ts';
import { SPECIES, BUILDINGS, VEHICLES, CREW, gradeOf, SIZE_MIN, ELF_LINES, FAMILY_LINES } from './data.ts';
import { treeSprite, wildSprite, buildingSprite, person, machine, deerSprite, dogSprite, carSprite, thiefSprite, treeShadow, shadowBlob, mound, stump, snowman, candyCane, lampPost, giftPile, fence, glint, glow, santaSleigh, buildingLights, half, giftBox, parachute, bellSprite, STAGE_PX, BLD_TOP, PX_AX, PX_AY, VEH_TINT, type Look, gateArch } from './art';
import { Ground, type GroundEnv } from './ground';
import { text, center, rimmed, textW } from './font';

interface Base { c: HTMLCanvasElement; g: CanvasRenderingContext2D; key: string; tv: number; snap: Uint8Array }
interface Chunk { c: HTMLCanvasElement; g: CanvasRenderingContext2D; ver: number; key: string; terr: number }
interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; col: string; s: number; grav: number; }
interface Floater { x: number; y: number; t: string; col: string; life: number; big?: boolean }
interface Fall { x: number; y: number; img: HTMLCanvasElement; t: number; dir: number }
interface Car { x: number; y: number; st: number; t: number; col: string; tree: boolean; dir: number; stop: number; fam: number; px: number; py: number; look: Look }

export const PLAYER_LOOK: Look = { hat: C.red, coat: '#1f7a4a', skin: '#f6cca4', pants: C.dusk, kind: 'santa', scarf: C.gold };
const SKINS = ['#f6cca4', '#d2a074', '#8e5c3e'];
// the crew are elves, and nobody at the farm finds this strange
const CREW_LOOKS: Look[] = Array.from({ length: 6 }, (_, i) => ({ hat: i % 2 ? C.red : C.leaf, coat: i % 2 ? C.leaf : C.red, skin: SKINS[i % 3], pants: i % 2 ? C.red : C.leaf, kind: 'elf' as const, trim: i % 3 === 2 ? C.gold : C.white }));
const CREW_TINT = ['', C.teal, C.orange, C.purple];
const CAROL: Look[] = [{ hat: C.red, coat: C.dusk, skin: SKINS[0], pants: C.ink, kind: 'beanie', scarf: C.gold }, { hat: C.leaf, coat: C.dred, skin: SKINS[2], pants: C.ink, kind: 'beanie', scarf: C.white }, { hat: C.gold, coat: C.teal, skin: SKINS[1], pants: C.ink, kind: 'beanie', scarf: C.red }];
const CAR_COLS = [C.red, C.blue, C.gold, C.teal, C.white, C.purple, C.orange];
const SNOW_BY_MONTH = [3, 3, 2, 2, 1, 1, 0, 0, 1, 1, 2, 3], FLURRY = [1, 1, 0.75, 0.5, 0.35, 0.22, 0.16, 0.16, 0.28, 0.5, 0.85, 1];
const NIGHT = '#5a66d0', SUNSET = '#ffdfc8';
const LIGHT_COLS = [C.red, C.gold, '#46b0ff', '#ff6ac8', C.white, C.lime];

export class Renderer {
  W = 480; H = 300; z = 16; cx = 125; cy = 72; free = false; shake = 0; t = 0;
  private chunks = new Map<string, Chunk>(); private bases = new Map<number, Base>(); private ground: Ground;
  parts: Part[] = []; floats: Floater[] = []; falls: Fall[] = []; cars: Car[] = [];
  flakes: { x: number; y: number; s: number }[] = [];
  overlay = 0; ticketHi: { sp: number; minZ: number } | null = null; focusBlock: Block | null = null; landMode = false;
  ghost: { k: string; x: number; y: number; ok: boolean } | null = null; drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  pings: { x: number; y: number; t: number; col: string }[] = [];
  sleigh: { x: number; y: number; t: number } | null = null; sleighWait = 30; onSleigh: (() => void) | null = null;
  tracks: { x: number; y: number; t: number; d: number; w: number }[] = []; private tx = 0; private ty = 0; private tn = 0;
  says: { x: number; y: number; t: string; life: number }[] = []; private chatT = 5; private spray = 0; private carolT = 0;
  private lamps: { x: number; y: number }[] = []; private smokeT = 0; private nightMul = '';
  constructor(public sim: Sim) { this.ground = new Ground(sim); for (let i = 0; i < 240; i++) this.flakes.push({ x: Math.random(), y: Math.random(), s: 0.4 + Math.random() }); }

  screenToTile(sx: number, sy: number) { return { x: (sx + this.camX()) / this.z, y: (sy + this.camY()) / this.z }; }
  camX() { return Math.round(this.cx * this.z - this.W / 2); }
  camY() { return Math.round(this.cy * this.z - this.H / 2); }
  clampCam() { const hw = this.W / 2 / this.z, hh = this.H / 2 / this.z; this.cx = hw * 2 >= MW ? MW / 2 : Math.max(hw, Math.min(MW - hw, this.cx)); this.cy = hh * 2 >= MH ? MH / 2 : Math.max(hh, Math.min(MH - hh, this.cy)); }

  /** snow never quite leaves Mabel's farm */
  snowVis() { return Math.max(SNOW_BY_MONTH[this.sim.s.month], this.sim.snowLevel()); }
  treeSnow(v: number) { return v >= 3 ? 2 : v >= 1 ? 1 : 0; }
  env(): GroundEnv { return { snow: this.snowVis(), dry: this.sim.s.drought > 0 }; }
  envKey(e: GroundEnv = this.env()) { return `${e.snow}.${e.dry ? 1 : 0}`; }
  /** slow evening light that comes round all year; December's own dusk rides on top of it */
  light() { const c = Math.sin(this.t * Math.PI * 2 / 150 - 1.1), n = Math.max(0, Math.min(1, (c - 0.1) / 0.75)); return Math.max(this.sim.dusk(), n * n * (3 - 2 * n) * 0.62); }

  private propAt(X: number, Y: number, i: number) {
    const sim = this.sim; if (sim.terr[i] !== T_GRASS || sim.sp[i] || sim.bld[i] || sim.flag[i] & F_STUMP) return 0;
    const road = (j: number) => sim.terr[j] === T_ROAD;
    if (X > 0 && Y > 0 && X < MW - 1 && Y < MH - 1 && (road(i - 1) || road(i + 1) || road(i - MW) || road(i + MW))) return (X + Y) % 16 === 0 ? 2 : (X + Y) % 8 === 4 ? 1 : 0;
    const h = hash(X, Y, 77); return h > 0.9962 ? 3 : sim.secretAt(i) ? 4 : 0;
  }
  private propImg(k: number, X: number, Y: number, on: boolean) { return k === 1 ? candyCane() : k === 2 ? lampPost(on) : k === 3 ? snowman((hash(X, Y, 6) * 4) | 0) : giftPile((hash(X, Y, 7) * 4) | 0); }

  private baseLayer(z: number, ci: number, budget: { n: number }, env: GroundEnv, key: string) {
    const sim = this.sim, id = z * 1000 + ci, x0 = (ci % CW) * CH, y0 = ((ci / CW) | 0) * CH, P = 2, SW = CH + P * 2; let b = this.bases.get(id);
    if (!b) { const r = canvas(CH * z, CH * z); b = { c: r.c, g: r.g, key: '', tv: -1, snap: new Uint8Array(SW * SW) }; this.bases.set(id, b); }
    const sample = (i: number, j: number) => { const X = x0 + i - P, Y = y0 + j - P; if (X < 0 || Y < 0 || X >= MW || Y >= MH) return 255; return sim.terr[Y * MW + X] | (sim.ownedAt(X, Y) ? 8 : 0); };
    if (b.key !== key) {
      if (b.key && budget.n <= 0) return b; budget.n--;
      this.ground.paint(b.g, x0, y0, 0, 0, CH, CH, z, env); b.key = key; b.tv = sim.terrVer;
      for (let j = 0; j < SW; j++) for (let i = 0; i < SW; i++) b.snap[j * SW + i] = sample(i, j);
    } else if (b.tv !== sim.terrVer) {
      let a = 99, c = 99, d = -1, e = -1;
      for (let j = 0; j < SW; j++) for (let i = 0; i < SW; i++) { const v = sample(i, j); if (v !== b.snap[j * SW + i]) { b.snap[j * SW + i] = v; a = Math.min(a, i); c = Math.min(c, j); d = Math.max(d, i); e = Math.max(e, j); } }
      b.tv = sim.terrVer;
      if (d >= 0) this.ground.paint(b.g, x0, y0, Math.max(0, a - P * 2), Math.max(0, c - P * 2), Math.min(CH, d + 1), Math.min(CH, e + 1), z, env);
    }
    return b;
  }

  private buildChunk(z: number, ci: number, ch: Chunk, base: Base, snowV: number) {
    const sim = this.sim, g = ch.g, x0 = (ci % CW) * CH, y0 = ((ci / CW) | 0) * CH, top = this.chunkTop(z), snowq = this.treeSnow(snowV), sc = z / 16;
    g.clearRect(0, 0, ch.c.width, ch.c.height); g.drawImage(base.c, 0, top);
    const list: { y: number; f: () => void }[] = [];
    for (const b of sim.s.blds) {
      const d = BUILDINGS[b.k]; if (b.x + d.w <= x0 || b.x >= x0 + CH || b.y + d.h <= y0 || b.y >= y0 + CH) continue;
      const big = buildingSprite(b.k, true, false), img = z < 16 ? half(big) : big, w = big.width * sc, h = big.height * sc;
      list.push({ y: b.y + d.h - 1, f: () => g.drawImage(img, (b.x - x0) * z, (b.y - y0) * z + top - BLD_TOP * sc, w, h) });
    }
    list.sort((a, b) => a.y - b.y); let li = 0;
    for (let y = 0; y < CH; y++) {
      while (li < list.length && list[li].y <= y0 + y) list[li++].f();
      for (let x = 0; x < CH; x++) {
        const X = x0 + x, Y = y0 + y, i = sim.idx(X, Y), sp = sim.sp[i], px = x * z, py = y * z + top;
        if (sim.terr[i] === T_WILD) {
          if (z <= 2) { const v = hash(X, Y); g.fillStyle = v > 0.66 ? '#dbe6f8' : v > 0.3 ? '#2f6e6c' : '#1c5056'; g.fillRect(px, py, z, z); }
          else { const v = (hash(X, Y, 5) * 6) | 0, im = wildSprite(Math.max(4, ((32 + hash(X, Y, 8) * 9) * sc) | 0), snowV, v); g.drawImage(im, px + z / 2 - (im.width >> 1), py + z - im.height + 2); }
        } else if (sp) {
          const fl = sim.flag[i], st = stageOf(sim.h[i]), hh = sim.h[i], shape = Math.min(2, gradeOf(sim.shape[i]));
          if (z <= 2) {
            const r = SPECIES[sp - 1].ramp, v = hash(X, Y, 3); let c = fl & F_DEAD ? C.brown : fl & F_PEST ? C.gold : r[st >= 5 ? 1 : st >= 3 ? 2 : 3];
            if (hh >= 6 && !(fl & F_DEAD) && v > 0.62) c = v > 0.88 ? C.red : v > 0.76 ? C.gold : C.white; else if (snowq && st >= 3 && (X + Y) % 2) c = mix(c, C.white, 0.55);
            g.fillStyle = c; g.fillRect(px, py + (st < 3 ? 0 : -1), z, st < 3 ? z : z + 1);
          } else {
            if (z >= 8 && st >= 1) { const sh = treeShadow(st), w = sh.width * sc, h = sh.height * sc; g.drawImage(sh, px + z / 2 - w / 2 + 2 * sc, py + z - h * 0.7, w, h); }
            const px2 = Math.max(2, Math.round(STAGE_PX[st] * sc)), kind = fl & F_DEAD ? 1 : fl & F_GOLD ? 2 : fl & F_PEST ? 3 : 0;
            const deco = hh >= 8 ? 2 : hh >= 6 ? 1 : 0;
            const im = treeSprite(sp - 1, px2, shape, snowq, 0, kind, (hash(X, Y) * 3) | 0, deco, z >= 8 && deco > 0 && shape === 2);
            g.drawImage(im, px + z / 2 - (im.width >> 1) + (z >= 8 ? jx(X, Y) >> 1 : 0), py + z - im.height + 2 + (z >= 8 ? jy(X, Y) >> 1 : 0));
          }
        } else if (sim.flag[i] & F_STUMP) { if (z >= 8) { const s2 = stump(snowq > 0); g.drawImage(s2, px, py + z - s2.height * sc, s2.width * sc, s2.height * sc); } }
        else if (z >= 8) { const k = this.propAt(X, Y, i); if (k) { const im = half(this.propImg(k, X, Y, false)); g.drawImage(im, px + z / 2 - (im.width >> 1), py + z - im.height); } }
      }
    }
    while (li < list.length) list[li++].f();
  }
  private chunkTop(z: number) { return 4 * z; }

  private chunk(z: number, ci: number, budget: { n: number }, snowV: number, env: GroundEnv, key: string) {
    const id = String(z * 1000 + ci); let ch = this.chunks.get(id);
    const base = this.baseLayer(z, ci, budget, env, key);
    const stale = !ch || ch.ver !== this.sim.ver[ci] || ch.key !== key || ch.terr !== this.sim.terrVer;
    if (!ch) { const r = canvas(CH * z, CH * z + this.chunkTop(z)); ch = { c: r.c, g: r.g, ver: -1, key: '', terr: -1 }; this.chunks.set(id, ch); }
    if (stale && (ch.ver < 0 || budget.n > 0)) { budget.n--; this.buildChunk(z, ci, ch, base, snowV); ch.ver = this.sim.ver[ci]; ch.key = key; ch.terr = this.sim.terrVer; }
    return ch;
  }
  /** the whole farm as an image, for the Christmas Eve flight */
  farmImage(z = 2) {
    const r = canvas(MW * z, MH * z), env = { snow: 3, dry: false }, key = this.envKey(env);
    for (let ci = 0; ci < CW * CHH; ci++) { const ch = this.chunk(z, ci, { n: 2 }, 3, env, key); r.g.drawImage(ch.c, (ci % CW) * CH * z, ((ci / CW) | 0) * CH * z - this.chunkTop(z)); }
    return r;
  }

  draw(g: CanvasRenderingContext2D, dt: number) {
    const sim = this.sim, s = sim.s, z = this.z, W = this.W, H = this.H; this.t += dt;
    const p = s.p;
    if (!this.free) { const k = Math.min(1, dt * 6); this.cx += (p.x - this.cx) * k; this.cy += (p.y - this.cy) * k; }
    this.clampCam();
    const sk = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0, sk2 = this.shake > 0.3 ? (Math.random() - 0.5) * this.shake : 0; this.shake *= Math.exp(-dt * 9);
    const camX = this.camX() + Math.round(sk), camY = this.camY() + Math.round(sk2);
    const snowV = this.snowVis(), env = this.env(), key = this.envKey(env);
    g.fillStyle = C.sn3; g.fillRect(0, 0, W, H);
    const c0 = Math.max(0, Math.floor(camX / z / CH)), c1 = Math.min(CW - 1, Math.floor((camX + W) / z / CH)), r0 = Math.max(0, Math.floor(camY / z / CH)), r1 = Math.min(CHH - 1, Math.floor((camY + H + 64) / z / CH));
    const budget = { n: z === 16 ? 1 : 3 };
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (z === 16) { const b = this.baseLayer(z, r * CW + c, budget, env, key); g.drawImage(b.c, c * CH * z - camX, r * CH * z - camY); }
      else { const ch = this.chunk(z, r * CW + c, budget, snowV, env, key); g.drawImage(ch.c, c * CH * z - camX, r * CH * z - camY - this.chunkTop(z)); }
    }
    if (z === 16) this.drawNear(g, camX, camY, snowV);
    else { this.lamps.length = 0; this.drawFar(g, camX, camY); }
    this.drawOverlays(g, camX, camY);
    this.drawLoot(g, camX, camY);
    this.drawFx(g, camX, camY, dt);
    this.drawEnv(g, camX, camY, dt);
  }

  private drawNear(g: CanvasRenderingContext2D, camX: number, camY: number, snowV: number) {
    const sim = this.sim, s = sim.s, W = this.W, H = this.H, z = 16, t = this.t, snowq = this.treeSnow(snowV);
    const x0 = Math.max(0, Math.floor(camX / z) - 2), x1 = Math.min(MW - 1, Math.ceil((camX + W) / z) + 2), y0 = Math.max(0, Math.floor(camY / z)), y1 = Math.min(MH - 1, Math.ceil((camY + H) / z) + 4);
    const light = this.light(), lit = light > 0.3, ph = (t * 2.2) | 0;
    // decals first: soil, stumps and the blue shadows on the snow
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = sim.idx(x, y), sp = sim.sp[i], px = x * z - camX, py = y * z - camY;
      if (sim.terr[i] === T_WATER) { if (!snowV) { const f = (t * 1.6 + hash(x, y) * 8) % 8; if (f < 2) { g.fillStyle = C.ice; g.fillRect(px + ((hash(x, y, 2) * 12) | 0), py + ((hash(x, y, 3) * 14) | 0), 3 - (f | 0), 1); } } continue; }
      if (sp) { const st = stageOf(sim.h[i]), sh = treeShadow(st); if (st < 4) g.drawImage(mound(), px + 2, py + 10); g.drawImage(sh, px + 8 - (sh.width >> 1) + 3 + jx(x, y), py + 15 - (sh.height >> 1) + jy(x, y)); }
    }
    this.drawTracks(g, camX, camY);
    const ents: { y: number; f: () => void }[] = [];
    this.carolers(ents, camX, camY);
    for (const b of s.blds) {
      const d = BUILDINGS[b.k]; if (b.x + d.w < x0 || b.x > x1 || b.y + d.h < y0 - 3 || b.y > y1) continue;
      ents.push({ y: b.y + d.h - 0.5, f: () => g.drawImage(buildingSprite(b.k, true, lit, ph), b.x * z - camX, b.y * z - camY - BLD_TOP) });
    }
    for (const c of this.cars) ents.push({ y: c.y, f: () => { const im = carSprite(c.col, c.tree, c.dir), x = Math.round(c.x * z - camX), y = Math.round(c.y * z - camY); g.drawImage(shadowBlob(32), x - 16, y + 2); g.drawImage(im, x - 18, y - 16); if (c.st === 2 || c.st === 3) { const im2 = person(c.look, c.st === 2 ? 0 : 2, ((this.t * 8) | 0) % 4, c.st === 3); g.drawImage(im2, Math.round(c.px * z - camX - PX_AX), Math.round(c.py * z - camY - PX_AY)); } } });
    this.entities(ents, camX, camY, z);
    ents.sort((a, b) => a.y - b.y); let ei = 0; this.lamps.length = 0;
    for (let y = y0; y <= y1; y++) {
      while (ei < ents.length && ents[ei].y < y) ents[ei++].f();
      for (let x = x0; x <= x1; x++) {
        const i = sim.idx(x, y), sp = sim.sp[i], px = x * z - camX, py = y * z - camY, tr = sim.terr[i];
        if (((x & 15) === 0 || (x & 15) === 15 || (y & 15) === 0 || (y & 15) === 15) && sim.ownedAt(x, y) && tr !== T_WATER && tr !== T_ROAD && tr !== T_BRIDGE) {
          const f0 = fence(0, ph), f1 = fence(1, ph);
          if (!sim.ownedAt(x, y - 1)) g.drawImage(f0, px, py - 10);
          if (!sim.ownedAt(x - 1, y) && !(y & 1)) g.drawImage(f1, px - 2, py - 3);
          if (!sim.ownedAt(x + 1, y) && !(y & 1)) g.drawImage(f1, px + 14, py - 3);
          if (!sim.ownedAt(x, y + 1)) g.drawImage(f0, px, py + 4);
        }
        if (tr === T_WILD) { const v = (hash(x, y, 5) * 6) | 0, im = wildSprite((32 + hash(x, y, 8) * 9) | 0, snowV, v); g.drawImage(im, px + 8 - (im.width >> 1), py + 18 - im.height); continue; }
        if (!sp) {
          if (sim.flag[i] & F_STUMP) { g.drawImage(stump(snowq > 0), px + 3, py + 7); continue; }
          const k = this.propAt(x, y, i); if (k) { const im = this.propImg(k, x, y, lit); g.drawImage(shadowBlob(k === 2 ? 10 : im.width), px + 8 - (im.width >> 1) + 2, py + 13); g.drawImage(im, px + 8 - (im.width >> 1), py + 16 - im.height); if (k === 2) this.lamps.push({ x: px + 8, y: py + 16 - im.height + 5 }); }
          continue;
        }
        const fl = sim.flag[i], st = stageOf(sim.h[i]), kind = fl & F_DEAD ? 1 : fl & F_GOLD ? 2 : fl & F_PEST ? 3 : 0, hh = sim.h[i], shape = Math.min(2, gradeOf(sim.shape[i]));
        const wind = Math.sin(t * 1.7 + x * 0.42 + y * 0.31 + Math.sin(t * 0.3 + y * 0.1) * 2), sway = wind > 0.45 && !kind ? 1 : wind < -0.75 && !kind ? -1 : 0, deco = hh >= 8 ? 2 : hh >= 6 ? 1 : 0;
        const im = treeSprite(sp - 1, STAGE_PX[st], shape, snowq, sway, kind as 0, (hash(x, y) * 3) | 0, deco, deco > 0 && shape === 2);
        const bump = this.bumps(x, y);
        g.drawImage(im, px + 8 - (im.width >> 1) + bump + jx(x, y), py + 18 - im.height + jy(x, y));
        if (fl & F_THIRST) { g.fillStyle = C.sky; g.fillRect(px + 8, py - 3 + (((t * 2) | 0) % 2), 2, 2); }
        if (fl & F_GOLD) { const k = ((t * 6) | 0) % 4; g.drawImage(glint(k), px + 1 + k * 3, py + 3 - STAGE_PX[st] + k * 5); }
        else if (deco && hash(x, y, 2) > 0.8) { const q = (t * 1.5 + hash(x, y) * 9) % 9; if (q < 1) g.drawImage(glint(q < 0.33 || q > 0.66 ? 1 : 2), px + 4 + ((hash(x, y, 6) * 8) | 0) - 3, py + 12 - STAGE_PX[st] * (0.3 + hash(x, y, 7) * 0.5)); }
      }
    }
    while (ei < ents.length) ents[ei++].f();
    // chimneys
    this.smokeT -= 1 / 60;
    if (this.smokeT <= 0) { this.smokeT = 0.22; for (const b of s.blds) if ((b.k === 'house' || b.k === 'santa') && b.x + 6 > x0 && b.x < x1 && b.y + 5 > y0 && b.y - 3 < y1) { const cx = b.k === 'house' ? b.x + 3.8 : b.x + 2.2, cy = b.y - 1.1 + (b.k === 'santa' ? 0.4 : 0); this.parts.push({ x: cx + (Math.random() - 0.5) * 0.2, y: cy, vx: 0.28 + Math.random() * 0.2, vy: -0.75 - Math.random() * 0.3, life: 2.2 + Math.random(), max: 3, col: Math.random() > 0.4 ? C.white : C.sn2, s: Math.random() > 0.5 ? 3 : 2, grav: -0.05 }); } }
    // the player is always readable through a wall of firs
    const p = s.p, pi = sim.idx(Math.floor(p.x), Math.min(MH - 1, Math.floor(p.y) + 1));
    if (sim.sp[pi] && sim.h[pi] > 3) { g.globalAlpha = 0.45; this.drawPlayer(g, camX, camY, z); g.globalAlpha = 1; }
  }
  private drawTracks(g: CanvasRenderingContext2D, camX: number, camY: number) {
    const W = this.W, H = this.H, now = this.t;
    for (const q of this.tracks) {
      const age = now - q.t; if (age > 34) continue; const x = Math.round(q.x * 16 - camX), y = Math.round(q.y * 16 - camY); if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      g.fillStyle = age < 20 ? 'rgba(112,124,206,.5)' : 'rgba(132,144,216,.28)';
      if (q.w === 0) { const o = q.d ? 2 : -2; if (q.d < 2) g.fillRect(x + o, y, 2, 2); else g.fillRect(x, y + o, 2, 2); }
      else { const hw = q.w; if (q.d === 1) { g.fillRect(x, y - hw, 7, 2); g.fillRect(x, y + hw - 2, 7, 2); } else { g.fillRect(x - hw, y, 2, 7); g.fillRect(x + hw - 2, y, 2, 7); } }
    }
  }
  /** carolers outside the lot, all through the Rush */
  private carolers(ents: { y: number; f: () => void }[], camX: number, camY: number) {
    const s = this.sim.s, l = s.blds.find((b) => b.k === 'lot'); if (!l || (s.month !== 11 && !this.sim.julySale())) return;
    const bx = l.x + 6.8, by = l.y + 4.2, sway = ((this.t * 2) | 0) % 2;
    CAROL.forEach((look, i) => ents.push({ y: by + (i % 2) * 0.2, f: () => { const g = g2(this), x = Math.round((bx + i * 0.9) * 16 - camX), y = Math.round((by + (i % 2) * 0.2) * 16 - camY) - ((sway + i) % 2); g.drawImage(shadowBlob(12), x - 6, y - 1); g.drawImage(person(look, 2, 0), x - PX_AX, y - PX_AY); } }));
    this.carolT -= 1 / 60; if (this.carolT <= 0 && this.z === 16) { this.carolT = 0.7; this.floats.push({ x: bx + Math.random() * 2.4, y: by - 1.5, t: '~', col: [C.gold, C.white, C.pink][(Math.random() * 3) | 0], life: 1.2 }); }
  }
  /** per-frame life that isn't sim: tracks, spray, elf chatter */
  stepLife(dt: number) {
    const s = this.sim.s, p = s.p, f = s.fun, v = VEHICLES[s.veh], d = Math.hypot(p.x - this.tx, p.y - this.ty);
    if (d > (s.veh ? 0.42 : 0.55)) {
      this.tx = p.x; this.ty = p.y; this.tn++;
      if (!v.air) { const side = p.dir === 1 || p.dir === 3; if (this.tracks.length > 520) this.tracks.shift(); this.tracks.push({ x: p.x, y: p.y + 0.1, t: this.t, d: s.veh ? (side ? 1 : 0) : (side ? (this.tn % 2 ? 2 : 3) : this.tn % 2), w: s.veh ? [0, 6, 9, 13, 0][s.veh] : 0 }); }
    }
    this.spray -= dt;
    if (this.spray <= 0 && p.moving && (s.veh > 0 || f.frenzy > 0 || f.boost > 0)) {
      this.spray = 0.05; const hot = f.frenzy > 0, n = v.air ? 0 : 2;
      for (let i = 0; i < n + (hot ? 2 : 0); i++) this.parts.push({ x: p.x + (Math.random() - 0.5) * (1 + v.w * 0.3), y: p.y + 0.2, vx: -p.vx * 0.2 + (Math.random() - 0.5) * 2, vy: -p.vy * 0.2 - Math.random() * 2, life: 0.35 + Math.random() * 0.3, max: 1, col: hot ? [C.gold, C.lemon, C.red, C.white][(Math.random() * 4) | 0] : Math.random() > 0.3 ? C.white : C.sn2, s: Math.random() > 0.5 ? 2 : 1, grav: 7 });
    }
    this.chatT -= dt;
    if (this.chatT <= 0) { this.chatT = 4 + Math.random() * 6; const a = s.crew.filter((c) => c.mode === 'work' || c.moving), q = a[(Math.random() * a.length) | 0]; if (q && Math.abs(q.x - this.cx) * this.z < this.W / 2 && Math.abs(q.y - this.cy) * this.z < this.H / 2) this.say(q.x, q.y - (q.rank ? 2.8 : 1.8), ELF_LINES[(Math.random() * ELF_LINES.length) | 0]); }
  }
  say(x: number, y: number, t: string) { if (this.says.length < 6 && this.z >= 8) this.says.push({ x, y, t, life: 2.6 }); }
  private drawLoot(g: CanvasRenderingContext2D, camX: number, camY: number) {
    const sim = this.sim, f = sim.s.fun, z = this.z, t = this.t, near = z >= 8;
    for (let i = 0; i < f.gifts.length; i++) {
      const q = f.gifts[i], x = Math.round(q.x * z - camX), y = Math.round(q.y * z - camY), im = giftBox(i + ((q.x * 7) | 0));
      if (q.fall > 0) { const up = Math.round(q.fall * 62), sw = Math.round(Math.sin(t * 4 + i) * 4); if (near) { g.drawImage(shadowBlob(12), x - 6, y - 2); g.drawImage(parachute(), x - 12 + sw, y - up - 28); } g.drawImage(im, x - 7 + sw, y - up - 13); continue; }
      if (q.t < 6 && ((t * 8) | 0) % 2) continue;
      const hop = Math.abs(Math.sin(t * 5 + i)) * 3 | 0; g.drawImage(shadowBlob(14), x - 7, y - 2); g.drawImage(im, x - 7, y - 14 - hop); if (((t * 3 + i) | 0) % 3 === 0) g.drawImage(glint(1 + (((t * 9) | 0) % 2)), x + 2, y - 18 - hop);
    }
    const du = f.duel;
    if (du) {
      const n = du.pts.length / 2, big = z >= 8, fr = ((t * 8) | 0) % 2, arch = (wx: number, wy: number, hot: boolean, last: boolean) => { const x = Math.round(wx * z - camX), y = Math.round(wy * z - camY); if (big) { const im = gateArch(hot, last), k = z >= 16 ? 1 : 0.7, w = Math.round(im.width * k), h = Math.round(im.height * k); g.drawImage(im, x - (w >> 1), y - h + 3, w, h); } else { g.fillStyle = hot ? C.gold : C.red; g.fillRect(x - 2, y - 2, 4, 4); } };
      if (!du.on) arch(du.x, du.y, ((t * 3) | 0) % 2 === 0, false);
      else for (let i = n - 1; i >= du.i; i--) { if (i > du.i + 2 && i !== n - 1) continue; arch(du.pts[i * 2], du.pts[i * 2 + 1], i === du.i, i === n - 1); }
      const bx = Math.round(du.bx * z - camX), by = Math.round(du.by * z - camY);
      if (big) { const im = carSprite('#23202e', false, du.dir === 3 ? 3 : 1), k = z >= 16 ? 1 : 0.6, w = Math.round(im.width * k), h = Math.round(im.height * k); g.drawImage(shadowBlob(w), bx - (w >> 1), by - 2); g.drawImage(im, bx - (w >> 1), by - h + 3 - (du.on ? fr : 0), w, h); g.fillStyle = C.red; g.fillRect(bx - 1, by - h - 2, 3, 3); }
      else { g.fillStyle = C.ink; g.fillRect(bx - 2, by - 2, 5, 5); g.fillStyle = C.red; g.fillRect(bx - 1, by - 1, 3, 3); }
    }
    const tr = f.trail; if (!tr) return;
    const n = tr.pts.length / 2;
    for (let i = n - 1; i >= tr.i; i--) {
      const x = Math.round(tr.pts[i * 2] * z - camX), y = Math.round(tr.pts[i * 2 + 1] * z - camY), next = i === tr.i, bob = Math.round(Math.sin(t * 4 + i * 0.7) * 2), im = bellSprite(((t * 5) | 0) + i);
      if (i > tr.i + 7) { g.fillStyle = C.gold; g.fillRect(x - 1, y - 6, 2, 2); continue; }
      g.drawImage(shadowBlob(10), x - 5, y - 1); g.drawImage(im, x - 6, y - 15 + bob);
      if (next) { const r = 7 + ((t * 18) % 8 | 0); g.strokeStyle = C.lemon; g.lineWidth = 1; g.strokeRect(x - r + 0.5, y - 8 - r + 0.5, r * 2, r * 2); }
    }
  }
  private bumps(x: number, y: number) { const p = this.sim.s.p; if (!p.moving) return 0; const d = Math.abs(p.x - x - 0.5) + Math.abs(p.y - y - 0.5); return d < 1.2 ? (((this.t * 22) | 0) % 2 ? 1 : -1) : 0; }

  private entities(ents: { y: number; f: () => void }[], camX: number, camY: number, z: number) {
    const s = this.sim.s, fr = ((this.t * 8) | 0) % 4;
    ents.push({ y: s.p.y, f: () => this.drawPlayer(g2(this), camX, camY, z) });
    for (const a of s.crew) ents.push({
      y: a.y, f: () => {
        const g = g2(this), x = Math.round(a.x * z - camX), y = Math.round(a.y * z - camY);
        if (a.rank === 0) { const im = person(CREW_LOOKS[a.id % CREW_LOOKS.length], a.dir, a.moving ? fr : 0, a.hop.n > 0); g.drawImage(shadowBlob(12), x - 6, y - 2); g.drawImage(im, x - PX_AX, y - PX_AY); }
        else { const load = Math.round(a.hop.n / CREW[a.rank].cap * 6), im = machine(a.rank, a.dir, a.moving ? fr % 2 : 0, CREW_TINT[a.rank], load), sw = Math.round(im.width * 0.8); g.drawImage(shadowBlob(sw), x - (sw >> 1), y); g.drawImage(im, x - (im.width >> 1), y - im.height + 5); }
      },
    });
    for (const c of s.critters) ents.push({
      y: c.y, f: () => {
        const g = g2(this), d = c.vx >= 0 ? 1 : 3, f2 = fr % 2, x = Math.round(c.x * z - camX), y = Math.round(c.y * z - camY);
        const im = c.k === 'deer' ? deerSprite(d, f2) : c.k === 'dog' ? dogSprite(d, Math.hypot(c.vx, c.vy) > 0.5 ? f2 : 0) : thiefSprite(fr);
        g.drawImage(shadowBlob(c.k === 'dog' ? 12 : 18), x - (c.k === 'dog' ? 6 : 9), y - 1); g.drawImage(im, x - (im.width >> 1), y - im.height + 2);
      },
    });
  }
  private cachedG!: CanvasRenderingContext2D;
  setG(g: CanvasRenderingContext2D) { this.cachedG = g; }
  getG() { return this.cachedG; }

  private drawPlayer(g: CanvasRenderingContext2D, camX: number, camY: number, z: number) {
    const s = this.sim.s, p = s.p, fr = ((this.t * 9) | 0) % 4, x = Math.round(p.x * z - camX), y = Math.round(p.y * z - camY);
    if (s.veh === 0) { const im = person(PLAYER_LOOK, p.dir, p.moving ? fr : 0, p.hop.n > 0); g.drawImage(shadowBlob(13), x - 6, y - 2); g.drawImage(im, x - PX_AX, y - PX_AY); }
    else {
      const load = Math.round(p.hop.n / this.sim.hopCap() * 8), air = VEHICLES[s.veh].air;
      const im = machine(s.veh, p.dir, (p.moving || air ? fr % 2 : 0), VEH_TINT[s.veh], load), sw = Math.round(im.width * 0.8);
      g.drawImage(shadowBlob(sw), x - (sw >> 1), y + (air ? 8 : 0));
      if (air) g.drawImage(im, x - (im.width >> 1), y - im.height - 8 + Math.sin(this.t * 3) * 2);
      else g.drawImage(im, x - (im.width >> 1), y - im.height + 5);
    }
  }

  private drawFar(g: CanvasRenderingContext2D, camX: number, camY: number) {
    const sim = this.sim, s = sim.s, z = this.z, fr = ((this.t * 8) | 0) % 4;
    if (z === 8) {
      for (const c of this.cars) { const im = carSprite(c.col, c.tree, c.dir); g.drawImage(im, Math.round(c.x * z - camX - 9), Math.round(c.y * z - camY - 8), 18, 11); }
      for (const a of s.crew) {
        const x = Math.round(a.x * z - camX), y = Math.round(a.y * z - camY);
        if (a.rank === 0) { const im = person(CREW_LOOKS[a.id % CREW_LOOKS.length], a.dir, a.moving ? fr : 0, false); g.drawImage(im, x - 4, y - 10, 9, 11); }
        else { const im = machine(a.rank, a.dir, fr % 2, CREW_TINT[a.rank], 0), w = im.width / 2, h = im.height / 2; g.drawImage(im, x - w / 2, y - h + 2, w, h); }
      }
      for (const c of s.critters) { const im = c.k === 'deer' ? deerSprite(c.vx >= 0 ? 1 : 3, fr % 2) : c.k === 'dog' ? dogSprite(c.vx >= 0 ? 1 : 3, fr % 2) : thiefSprite(fr); g.drawImage(im, Math.round(c.x * z - camX - im.width / 4), Math.round(c.y * z - camY - im.height / 2), im.width / 2, im.height / 2); }
      const p = s.p, x = Math.round(p.x * z - camX), y = Math.round(p.y * z - camY);
      if (s.veh === 0) g.drawImage(person(PLAYER_LOOK, p.dir, p.moving ? fr : 0, false), x - 4, y - 10, 9, 11);
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
      if (d) { g.globalAlpha = 0.7; const img = buildingSprite(k.k, true, false), sc = z / 16; g.drawImage(img, k.x * z - camX, k.y * z - camY - BLD_TOP * sc, img.width * sc, img.height * sc); g.globalAlpha = 1; }
      g.strokeStyle = k.ok ? C.lime : C.red; g.lineWidth = 1; g.strokeRect(k.x * z - camX + 0.5, k.y * z - camY + 0.5, (d?.w ?? 1) * z - 1, (d?.h ?? 1) * z - 1);
    }
    // the tool's swath, the promise of what holding the button will do
    const p = s.p, sw = sim.swathOf(p.x, p.y, sim.playerW());
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
      rimmed(g, f.t, f.x * z - camX, f.y * z - camY, f.col, C.ink, f.big ? 2 : 1);
    }
    this.floats.length = w; w = 0;
    for (let i = 0; i < this.pings.length; i++) { const q = this.pings[i]; q.t -= dt * 0.8; if (q.t > 0) this.pings[w++] = q; }
    this.pings.length = w; w = 0;
    for (let i = 0; i < this.says.length; i++) {
      const q = this.says[i]; q.life -= dt; if (q.life <= 0) continue; this.says[w++] = q;
      const bw = textW(q.t) + 8, x = Math.round(q.x * z - camX - bw / 2), y = Math.round(q.y * z - camY) - 12;
      g.fillStyle = C.ink; g.fillRect(x - 1, y, bw + 2, 12); g.fillRect(x, y - 1, bw, 14); g.fillStyle = C.white; g.fillRect(x, y, bw, 12); g.fillStyle = C.ink; g.fillRect(x + (bw >> 1) - 1, y + 13, 3, 1); g.fillRect(x + (bw >> 1), y + 14, 1, 2); g.fillStyle = C.white; g.fillRect(x + (bw >> 1), y + 12, 2, 1); text(g, q.t, x + 4, y + 2, C.ink);
    }
    this.says.length = w;
  }

  private drawEnv(g: CanvasRenderingContext2D, camX: number, camY: number, dt: number) {
    const sim = this.sim, s = sim.s, W = this.W, H = this.H, d = this.light();
    if (d > 0.02) {
      const tint = d < 0.28 ? mix('#ffffff', SUNSET, d / 0.28) : mix(SUNSET, NIGHT, Math.min(1, (d - 0.28) / 0.6));
      g.globalCompositeOperation = 'multiply'; g.fillStyle = tint; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over';
      if (d > 0.22) this.lights(g, camX, camY, d);
    }
    // it is always snowing a little here; a blizzard is just the same thing with opinions
    const bliz = s.blizzard > 0, amt = bliz || sim.julySale() ? 1 : FLURRY[s.month], n = Math.round(this.flakes.length * amt), wind = bliz ? 0.26 : 0.03;
    for (let i = 0; i < n; i++) {
      const f = this.flakes[i], fast = bliz ? 2.2 : 1;
      f.y += dt * f.s * 0.2 * fast; f.x += dt * (wind + Math.sin(this.t * 0.8 + f.s * 9) * 0.018); if (f.y > 1) f.y -= 1; if (f.x > 1) f.x -= 1; if (f.x < 0) f.x += 1;
      const X = (f.x * W) | 0, Y = (f.y * H) | 0;
      if (f.s > 1.25) { g.fillStyle = C.white; g.fillRect(X - 1, Y, 3, 1); g.fillRect(X, Y - 1, 1, 3); }
      else if (f.s > 0.85) { g.fillStyle = C.white; g.fillRect(X, Y, 2, 2); }
      else { g.fillStyle = C.ice; g.fillRect(X, Y, 1, 1); }
    }
    if (bliz) { g.fillStyle = 'rgba(214,230,250,.24)'; g.fillRect(0, 0, W, H); }
    // a certain sleigh, on December nights
    this.sleighWait -= dt;
    if (!this.sleigh && this.sleighWait < 0 && d > 0.26 && (s.month >= 10 || s.month === 0)) { this.sleigh = { x: -130, y: H * (0.14 + Math.random() * 0.28), t: 0 }; this.sleighWait = 70 + Math.random() * 50; this.onSleigh?.(); }
    if (this.sleigh) {
      const q = this.sleigh; q.t += dt; q.x += dt * 70;
      const fr = ((q.t * 6) | 0) % 2, y = Math.round(q.y + Math.sin(q.t * 1.4) * 5);
      g.drawImage(santaSleigh(fr), Math.round(q.x), y);
      if (((q.t * 20) | 0) % 2 === 0) { g.fillStyle = C.lemon; g.fillRect(Math.round(q.x) - 3 - ((q.t * 13) % 18 | 0), y + 22, 1, 1); g.fillStyle = C.white; g.fillRect(Math.round(q.x) - 6 - ((q.t * 31) % 26 | 0), y + 28, 1, 1); }
      if (q.x > W + 20) this.sleigh = null;
    }
  }
  private lights(g: CanvasRenderingContext2D, camX: number, camY: number, d: number) {
    const sim = this.sim, z = this.z, W = this.W, H = this.H, t = this.t;
    const x0 = Math.max(0, Math.floor(camX / z)), x1 = Math.min(MW - 1, Math.ceil((camX + W) / z)), y0 = Math.max(0, Math.floor(camY / z)), y1 = Math.min(MH - 1, Math.ceil((camY + H) / z) + 2);
    const a = Math.min(1, (d - 0.22) * 3);
    g.globalAlpha = a;
    // windows, lamps and the lot throw warm light on the snow
    g.globalCompositeOperation = 'lighter';
    for (const b of sim.s.blds) {
      const dd = BUILDINGS[b.k]; if (b.k === 'sprinkler' || b.k === 'helipad' || b.k === 'kennel') continue;
      const cx = (b.x + dd.w / 2) * z - camX, cy = (b.y + dd.h - 0.3) * z - camY, r = Math.round(dd.w * z * 0.74), im = glow(64, '#ffc860');
      if (cx < -r || cx > W + r || cy < -r || cy > H + r) continue;
      g.drawImage(im, cx - r, cy - r * 0.7, r * 2, r * 1.4);
    }
    for (const l of this.lamps) { g.drawImage(glow(32, '#ffd27a'), l.x - 32, l.y - 22); }
    g.globalCompositeOperation = 'source-over';
    if (z >= 8) { const ph = (t * 2.2) | 0, sc = z / 16; for (const b of sim.s.blds) { const dd = BUILDINGS[b.k]; if (b.x + dd.w < x0 - 1 || b.x > x1 + 1 || b.y + dd.h < y0 - 3 || b.y > y1) continue; const big = buildingLights(b.k, ph), im = z < 16 ? half(big) : big; g.drawImage(im, b.x * z - camX, b.y * z - camY - BLD_TOP * sc, big.width * sc, big.height * sc); } }
    for (const l of this.lamps) { g.fillStyle = C.lemon; g.fillRect(l.x - 2, l.y - 3, 5, 6); g.fillStyle = C.white; g.fillRect(l.x - 2, l.y - 3, 2, 6); }
    if (z <= 2) { // from the air the whole farm is one big string of lights
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = sim.idx(x, y); if (!sim.sp[i] || sim.h[i] < 3.5 || sim.flag[i] & F_DEAD) continue; const h1 = hash(x, y, 40); if (h1 > 0.45 || Math.sin(t * (1.4 + h1 * 2) + h1 * 40) < -0.2) continue; g.fillStyle = LIGHT_COLS[(h1 * 977 | 0) % 6]; g.fillRect(x * z - camX, y * z - camY - 1, 1, 1); }
      g.globalAlpha = 1; return;
    }
    const s2 = z >= 16 ? 2 : 1, dens = z >= 8 ? 1 : 0.7;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = sim.idx(x, y); if (!sim.sp[i] || sim.h[i] < 3 || sim.flag[i] & F_DEAD) continue;
      const st = STAGE_PX[stageOf(sim.h[i])] * z / 16, n = z >= 16 ? Math.min(8, 2 + (st / 6 | 0)) : z >= 8 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const h1 = hash(x, y, k + 40); if (h1 > dens) continue;
        if (Math.sin(t * (1.1 + h1 * 1.8) + h1 * 40) < -0.35) continue;
        const v = (k + 0.5 + hash(x, y, k + 70) * 0.5) / n, hw = st * 0.31 * v, px = Math.round((x + 0.5) * z - camX + (hash(x, y, k + 90) - 0.5) * 2 * hw), py = Math.round((y + 1) * z - camY - st * (1 - v * 0.86));
        g.fillStyle = LIGHT_COLS[(h1 * 977 | 0) % 6]; g.fillRect(px, py, s2, s2);
        if (z >= 16) { g.fillStyle = C.white; g.fillRect(px, py, 1, 1); }
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
    this.burst(x + 0.5, y + 0.3, near ? 12 : 2, [S.ramp[1], S.ramp[2], S.ramp[3], C.tan, C.white, C.white, C.sn2], 4);
    if (near && this.falls.length < 40) this.falls.push({ x: x + 0.5, y: y + 1, img: treeSprite(sp, STAGE_PX[stageOf(h)], 1, this.treeSnow(this.snowVis()), 0, 0, 0), t: 0, dir: Math.random() > 0.5 ? 1 : -1 });
    if (mine) this.shake = Math.min(3, this.shake + 0.7);
    if (mine && h >= 9 && this.floats.length < 12) this.float(x + 0.5, y - 1, 'TIMBER!', C.white);
  }
  float(x: number, y: number, t: string, col: string = C.gold, big = false) { if (this.floats.length < 40) this.floats.push({ x, y, t, col, life: 1.1, big }); }
  ping(x: number, y: number, col: string = C.red) { this.pings.push({ x, y, t: 1, col }); }
  spawnFamily() {
    if (this.cars.length >= 12) return;
    const l = this.sim.s.blds.find((b) => b.k === 'lot')!, dir = Math.random() > 0.5 ? 1 : 3;
    const hats = [C.red, C.blue, C.gold, C.leaf, C.pink], coats = [C.dusk, C.purple, C.teal, C.brown, C.dred], scarves = [C.gold, C.red, C.white, C.lime, C.aqua], k = (Math.random() * 5) | 0;
    this.cars.push({ x: dir === 1 ? l.x - 34 : l.x + 44, y: dir === 1 ? 79.9 : 78.9, st: 0, t: 0, col: CAR_COLS[(Math.random() * CAR_COLS.length) | 0], tree: false, dir, stop: l.x - 3 + Math.random() * 12, fam: 0, px: 0, py: 0, look: { hat: hats[k], coat: coats[(k + 2) % 5], skin: SKINS[k % 3], pants: C.ink, kind: 'beanie', scarf: scarves[(k + 1) % 5] } });
  }
  stepCars(dt: number) {
    const l = this.sim.s.blds.find((b) => b.k === 'lot'); if (!l) return;
    for (const c of this.cars) {
      const v = c.dir === 1 ? 1 : -1;
      if (c.st === 0) { c.x += v * 9 * dt; if ((v > 0 && c.x >= c.stop) || (v < 0 && c.x <= c.stop)) { c.st = 1; c.t = 0.2; c.px = c.x; c.py = c.y - 0.6; } }
      else if (c.st === 1) { c.t -= dt; if (c.t < 0) c.st = 2; }
      else if (c.st === 2) { const tx = l.x + 3, ty = l.y + 4.5, dx = tx - c.px, dy = ty - c.py, d = Math.hypot(dx, dy); if (d < 0.3) c.st = 3; else { c.px += dx / d * 4.5 * dt; c.py += dy / d * 4.5 * dt; } }
      else if (c.st === 3) { const dx = c.x - c.px, dy = c.y - 0.6 - c.py, d = Math.hypot(dx, dy); if (d < 0.3) { c.st = 4; c.tree = true; if (Math.random() < 0.6) this.say(c.px, c.py - 1.9, FAMILY_LINES[(Math.random() * FAMILY_LINES.length) | 0]); } else { c.px += dx / d * 4 * dt; c.py += dy / d * 4 * dt; } }
      else { c.x += v * 11 * dt; }
    }
    this.cars = this.cars.filter((c) => c.x > l.x - 40 && c.x < l.x + 50);
  }
}
function g2(r: Renderer) { return r.getG(); }
const jx = (x: number, y: number) => ((hash(x, y, 31) * 5) | 0) - 2, jy = (x: number, y: number) => ((hash(x, y, 32) * 4) | 0) - 2;
function dashRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, col: string, t: number, live: boolean) {
  g.fillStyle = col; const o = live ? ((t * 10) | 0) % 6 : 0;
  for (let i = -o; i < w; i += 6) { const a = Math.max(0, i), b = Math.min(w, i + 3); if (b > a) { g.fillRect(x + a, y, b - a, 1); g.fillRect(x + a, y + h - 1, b - a, 1); } }
  for (let i = -o; i < h; i += 6) { const a = Math.max(0, i), b = Math.min(h, i + 3); if (b > a) { g.fillRect(x, y + a, 1, b - a); g.fillRect(x + w - 1, y + a, 1, b - a); } }
}
void hex; void TOOL_SAW; void TOOL_PLANT; void TOOL_SHEAR; void TOOL_TANK; void T_GRASS;
