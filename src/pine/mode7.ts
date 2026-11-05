// Christmas Eve: you fly your actual farm in SNES-style Mode 7, every tree you left standing twinkling
// below, and the trees, homes and hoops stand up out of the floor as scaled sprites. The bigger the farm,
// the better this looks. That's the point. The rules of the run are in eve.ts.
import { C, hex, hash, bayer, u32 } from './pal';
import { moonSprite, sleighBack, glow, eveRing, eveCloud, eveTree, buildingSprite, giftBox, glint } from './art';
import { MW, F_DEAD, T_WILD } from './sim.ts';
import type { Sim } from './sim.ts';
import { rimmed } from './font';
import { EveRun, route, ROUTE_LEN, HOME_GOOD, HOME_PERFECT, RING_R, CLOUD_R, type EveFx } from './eve';

const SW = 1024, SH = 128;
export class Flyover {
  tex: Uint32Array; tw: number; th: number; img: ImageData | null = null; buf: Uint32Array | null = null;
  lit: number[] = []; t = 0; base: Uint32Array;
  stars: { x: number; y: number; b: number }[] = [];
  constructor(src: HTMLCanvasElement, private sim: Sim) {
    const w = src.width, h = src.height, d = src.getContext('2d')!.getImageData(0, 0, w, h).data;
    this.tw = w; this.th = h; this.tex = new Uint32Array(w * h); this.base = new Uint32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      // moonlit: pull the farm into blue
      const r = d[i * 4] * 0.44 + 6, g = d[i * 4 + 1] * 0.52 + 10, b = d[i * 4 + 2] * 0.74 + 46;
      this.base[i] = this.tex[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
    // up close the wild forest's canopy is a checkerboard: flatten each tile, the standing trees carry the detail
    for (let i = 0; i < sim.N; i++) {
      if (sim.terr[i] !== T_WILD) continue;
      const o = ((i / MW) | 0) * 4 * w + (i % MW) * 4; let R = 0, G = 0, B = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const c = this.tex[o + y * w + x]; R += c & 255; G += (c >> 8) & 255; B += (c >> 16) & 255; }
      const k = (0.92 + hash(i, 5) * 0.08) / 16, c = 0xff000000 | (((B * k) | 0) << 16) | (((G * k) | 0) << 8) | ((R * k) | 0);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) this.base[o + y * w + x] = this.tex[o + y * w + x] = c;
    }
    for (let i = 0; i < sim.N; i++) if (sim.sp[i] && !(sim.flag[i] & F_DEAD) && sim.h[i] >= 2 && sim.ownedTile(i)) this.lit.push(((((i / MW) | 0) * 4 + 1) * w) + (i % MW) * 4 + 1);
    for (let i = 0; i < 180; i++) this.stars.push({ x: Math.random(), y: Math.random() * Math.random(), b: Math.random() });
    // a wrap-around sky, banded and dithered, with the aurora already in it
    const SK = ['#0a0a30', '#10104a', '#181a64', '#23247e', '#352f96', '#5240a8'].map(u32), AU = [u32('#2fae90'), u32('#58e0b0'), u32('#7ad0ff'), u32('#c870e8')];
    this.sky = new Uint32Array(SW * SH);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const k = Math.pow(y / SH, 1.2) * 5 + (bayer(x, y) - 0.5) * 0.6; this.sky[y * SW + x] = SK[Math.max(0, Math.min(5, Math.round(k)))]; }
    for (let x = 0; x < SW; x++) { const u = x / SW * 6.2832, yc = SH * (0.46 + Math.sin(u * 2) * 0.1 + Math.sin(u * 5 + 1) * 0.05), L = SH * (0.24 + 0.14 * Math.sin(u * 3 + 2) ** 2), st = 0.5 + 0.5 * Math.sin(u * 19) * Math.sin(u * 7); for (let y = 0; y < L; y++) { const a = (1 - y / L) * (0.4 + st * 0.6) + (bayer(x, y) - 0.5) * 0.12; if (a < 0.08) continue; const i = Math.max(0, (yc - y) | 0) * SW + x, c = AU[y < L * 0.3 ? 1 : y < L * 0.6 ? 0 : hash(x >> 3, 1) > 0.5 ? 2 : 3], k = a > 0.62 ? 0.5 : a > 0.36 ? 0.3 : 0.14, o = this.sky[i]; this.sky[i] = (0xff000000 | ((((o >> 16) & 255) * (1 - k) + ((c >> 16) & 255) * k) << 16) | ((((o >> 8) & 255) * (1 - k) + ((c >> 8) & 255) * k) << 8) | ((o & 255) * (1 - k) + (c & 255) * k)) >>> 0; } }
  }
  sky: Uint32Array;
  // the camera sits behind and above the sleigh and only part-follows it, so the sleigh moves on screen
  private camX = 0; private camY = 0; private ca = 1; private sa = 0; private alt = 60; private horizon = 90; private W = 480; private H = 300; private foc = 228;
  private proj(wx: number, wy: number, h: number) {
    const dx = wx - this.camX, dy = wy - this.camY, f = dx * this.ca + dy * this.sa, r = -dx * this.sa + dy * this.ca;
    if (f < 9) return null;
    return { x: this.W / 2 + r * this.foc / f, y: this.horizon + (this.alt - h) * this.foc * 0.658 / f, f, sc: this.foc / f };
  }
  private camS = 0; private camU = 0;
  /** the corridor is straight, whatever the ground is doing */
  private rail(s: number, u: number, h: number) {
    const f = s - this.camS; if (f < 9) return null;
    return { x: this.W / 2 + (u - this.camU) * this.foc / f, y: this.horizon + (this.alt - h) * this.foc * 0.658 / f, f, sc: this.foc / f };
  }
  private shake = 0; private flash = 0; private sparks: { x: number; y: number; vx: number; vy: number; l: number; c: string }[] = [];
  pops: { x: number; y: number; t: string; c: string; l: number; big: boolean }[] = [];
  /** something happened out there: draw it */
  react(f: EveFx) {
    const at = (s: number, u: number, h: number) => this.rail(s, u, h);
    const burst = (x: number, y: number, n: number, cols: string[], v: number) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, q = v * (0.4 + Math.random()); this.sparks.push({ x, y, vx: Math.cos(a) * q, vy: Math.sin(a) * q - 20, l: 0.5 + Math.random() * 0.5, c: cols[i % cols.length] }); } };
    if (f.k === 'ring') { const p = this.sleighAt; burst(p.x, p.y - 14, 18, [C.gold, C.lemon, C.white, C.red], 150); this.pops.push({ x: p.x, y: p.y - 44, t: `+${f.pts}`, c: C.lemon, l: 0.8, big: false }); }
    if (f.k === 'home') { const p = at(f.o.s, f.o.u, 8) ?? { x: this.W / 2, y: this.H / 2 }; burst(p.x, p.y, f.perfect ? 34 : 18, [C.gold, C.red, C.white, C.lime, C.aqua], 110); this.pops.push({ x: p.x, y: p.y - 18, t: f.perfect ? `BULLSEYE +${f.pts}` : `DELIVERED +${f.pts}`, c: f.perfect ? C.gold : C.lime, l: 1.1, big: f.perfect }); this.flash = f.perfect ? 0.4 : 0.15; }
    if (f.k === 'snowbank') { const p = at(f.s, f.u, 2); if (p) { burst(p.x, p.y, 10, [C.white, C.ice], 60); this.pops.push({ x: p.x, y: p.y - 10, t: 'SNOWBANK', c: C.ice, l: 0.7, big: false }); } }
    if (f.k === 'lost') { const p = at(f.o.s, f.o.u, 8); if (p) this.pops.push({ x: p.x, y: p.y - 14, t: 'MISSED', c: C.pink, l: 0.8, big: false }); }
    if (f.k === 'thud') { this.shake = 9; this.flash = 0.5; const p = this.sleighAt; burst(p.x, p.y - 14, 20, [C.lemon, '#7a6ad8', C.white], 170); this.pops.push({ x: p.x, y: p.y - 46, t: 'STORM! CHAIN LOST', c: C.pink, l: 1, big: false }); }
  }
  private sleighAt = { x: 240, y: 200 };
  private trees: { x: number; y: number; h: number; v: number; l: boolean }[] = [];
  private plant() {
    // real trees off your real map, wherever the route goes near them
    const sim = this.sim, near = new Uint8Array(64 * 40);
    for (let s = 0; s < ROUTE_LEN; s += 8) { const r = route(s); for (let j = -12; j <= 12; j++) for (let i = -12; i <= 12; i++) { const X = ((r.x / 16) | 0) + i, Y = ((r.y / 16) | 0) + j; if (X >= 0 && Y >= 0 && X < 64 && Y < 40) near[Y * 64 + X] = 1; } }
    const out: typeof this.trees = [];
    for (let k = 0; k < 90000 && out.length < 1100; k++) {
      const i = (hash(k, 11) * sim.N) | 0, x = i % MW, y = (i / MW) | 0; if (!near[((y >> 2) * 64) + (x >> 2)]) continue;
      const farm = sim.sp[i] > 0 && !(sim.flag[i] & F_DEAD) && sim.h[i] >= 2 && sim.ownedTile(i), wild = sim.terr[i] === T_WILD; if (!farm && !wild) continue;
      out.push({ x: x * 4 + 2, y: y * 4 + 2, h: farm ? Math.min(19, 7 + sim.h[i]) : 15 + hash(k, 12) * 7, v: (hash(k, 13) * 8) | 0, l: farm });
    }
    this.trees = out;
  }
  private ring(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, c: string, t = 0) {
    const n = Math.max(14, Math.min(40, (rx / 2) | 0)); g.fillStyle = c;
    for (let k = 0; k < n; k++) { if (k % 2) continue; const a = k / n * 6.2832 + t; g.fillRect((x + Math.cos(a) * rx) | 0, (y + Math.sin(a) * ry) | 0, 2, 1); }
  }
  draw(g: CanvasRenderingContext2D, W: number, H: number, dt: number, run: EveRun) {
    this.t += dt; if (!this.trees.length) this.plant();
    if (!this.img || this.img.width !== W || this.img.height !== H) { this.img = g.createImageData(W, H); this.buf = new Uint32Array(this.img.data.buffer); }
    const buf = this.buf!, tex = this.tex, tw = this.tw, th = this.th, t = this.t;
    // twinkle: a slice of the lights change each frame
    const L = [C.red, C.gold, C.aqua, C.pink, C.white, C.lime].map((c) => { const [r, gg, b] = hex(c); return 0xff000000 | (b << 16) | (gg << 8) | r; });
    const n = this.lit.length, flips = Math.min(n, 2500);
    for (let k = 0; k < flips; k++) { const p = this.lit[(Math.random() * n) | 0]; tex[p] = Math.random() < 0.72 ? L[(Math.random() * 6) | 0] : this.base[p]; }
    // the camera
    const fov = W / (2 * H * 0.76), foc = H * 0.76, D = 30, cs = route(run.s - D), h0 = route(run.s - 70), h1 = route(run.s + 70);
    const dir = Math.atan2(h1.y - h0.y, h1.x - h0.x), ca = Math.cos(dir), sa = Math.sin(dir), cu = run.u * 0.6, shx = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0, shy = this.shake > 0 ? (Math.random() - 0.5) * this.shake : 0;
    this.shake = Math.max(0, this.shake - dt * 22);
    const camX = cs.x - cs.ty * cu, camY = cs.y + cs.tx * cu, alt = run.a * 0.7 + 30 + (run.phase === 'run' ? 0 : -run.a * 0.3);
    const lift = run.phase === 'climb' ? Math.min(1, (run.a - 60) / 90) : run.phase === 'done' ? 1 : 0, horizon = Math.round(H * (0.3 + lift * 0.34) - run.va * 0.1 + shy);
    Object.assign(this, { camX, camY, ca, sa, alt, horizon, W, H, foc, camS: run.s - D, camU: cu });
    const ang = dir, so = ((ang * 160) | 0) & (SW - 1), sky = this.sky;
    for (let y = 0; y < horizon; y++) { const sy = Math.min(SH - 1, (((y + H * 0.3 - horizon) / (H * 0.3)) * SH) | 0), o = y * W, r = Math.max(0, sy) * SW; for (let x = 0; x < W; x++) buf[o + x] = sky[r + ((x + so) & (SW - 1))]; }
    for (let y = horizon; y < H; y++) {
      const dy = y - horizon + 1, dist = alt * H * 0.5 / dy, o = y * W, fog = Math.min(1, dist / 620);
      const rx = -sa * dist * fov / W * 2, ry = ca * dist * fov / W * 2;
      let wx = camX + ca * dist - rx * W / 2, wy = camY + sa * dist - ry * W / 2;
      const fr = 58, fg = 46, fb = 150;
      for (let x = 0; x < W; x++) {
        const ix = wx | 0, iy = wy | 0; let c: number;
        if (ix >= 0 && iy >= 0 && ix < tw && iy < th) {
          c = tex[iy * tw + ix];
          if (fog > 0.05) { const R = c & 255, G = (c >> 8) & 255, B = (c >> 16) & 255; c = 0xff000000 | ((B + (fb - B) * fog) << 16) | ((G + (fg - G) * fog) << 8) | (R + (fr - R) * fog); }
        } else c = 0xff000000 | (fb << 16) | (fg << 8) | fr;
        buf[o + x] = c; wx += rx; wy += ry;
      }
    }
    g.putImageData(this.img, 0, 0);
    for (const st of this.stars) { const yy = st.y * horizon * 0.95, tw2 = Math.sin(t * 2 + st.b * 30) > -0.4; if (tw2) { g.fillStyle = st.b > 0.7 ? C.white : C.sky; g.fillRect((((st.x + ang * 0.25) % 1 + 1) % 1 * W) | 0, yy | 0, 1, 1); } }
    const big = 18 + Math.round(lift * 44), mx = (((0.72 + ang * 0.25) % 1 + 1) % 1) * (1 - lift) * W + lift * W / 2, my = horizon * (0.34 + lift * 0.1);
    g.globalCompositeOperation = 'lighter'; g.drawImage(glow(64, '#8080e0'), (mx | 0) - 64 - big, (my | 0) - 64 - big, 128 + big * 2, 128 + big * 2); g.globalCompositeOperation = 'source-over'; g.drawImage(moonSprite(big), (mx | 0) - big - 1, (my | 0) - big - 1);
    // everything that stands up, far to near
    const list: { f: number; d: () => void }[] = [];
    const px = (im: HTMLCanvasElement, q: { x: number; y: number; sc: number }, w: number, h: number, ax = 0.5, ay = 1) => { const sw = Math.max(1, Math.round(w * q.sc)), sh = Math.max(1, Math.round(h * q.sc)); g.drawImage(im, Math.round(q.x - sw * ax), Math.round(q.y - sh * ay), sw, sh); };
    const sq = this.rail(run.s, run.u, run.a) ?? { x: W / 2, y: H * 0.7, f: D, sc: 7 };
    for (const tr of this.trees) { const dx = tr.x - camX, dy = tr.y - camY, f = dx * ca + dy * sa; if (f < 12 || f > 430) continue; const q = this.proj(tr.x, tr.y, 0)!; if (!q || q.x < -60 || q.x > W + 60 || (f < D + 8 && Math.abs(q.x - sq.x) < 110)) continue; const im = eveTree(tr.v, tr.l); list.push({ f, d: () => px(im, q, tr.h * 0.72, tr.h) }); }
    let hot = false; const homeAhead = run.objs.some((o) => o.k === 'home' && !o.st && o.s > run.s && o.s < run.s + 620);
    for (const o of run.objs) {
      if (o.s < run.s - 40 || o.s > run.s + 640) continue;
      const q = this.rail(o.s, o.u, o.h); if (!q) continue;
      if (o.k === 'ring') {
        if (o.st) continue; const isHot = !hot && o.s > run.s; if (isHot) hot = true;
        list.push({ f: q.f, d: () => { const d = RING_R * 2 * q.sc * 1.12; g.drawImage(eveRing(isHot), Math.round(q.x - d / 2), Math.round(q.y - d / 2), Math.round(d), Math.round(d)); } });
      } else if (o.k === 'cloud') {
        if (o.st) continue; const fl = Math.sin(t * 9 + o.v * 40) > 0.86;
        list.push({ f: q.f, d: () => { const im = eveCloud(Math.round(o.v * 3), fl), d = CLOUD_R * 2.5 * q.sc; g.drawImage(im, Math.round(q.x - d / 2), Math.round(q.y - d * 0.36), Math.round(d), Math.round(d * 0.72)); } });
      } else {
        const lit = o.st === 1, base = q;
        list.push({ f: q.f, d: () => {
          if (!o.st) { const beam = Math.max(2, Math.round(HOME_PERFECT * 1.1 * base.sc)), top = Math.max(-20, base.y - 96 * base.sc); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.16 + Math.sin(t * 6) * 0.05; g.fillStyle = '#ffc040'; g.fillRect(Math.round(base.x - beam / 2), Math.round(top), beam, Math.round(base.y - top)); g.globalAlpha = 0.14; g.fillRect(Math.round(base.x - beam / 5), Math.round(top), Math.max(1, Math.round(beam / 2.5)), Math.round(base.y - top)); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
          const ry = this.alt * foc * 0.658 / (base.f * base.f);
          if (!o.st) { this.ring(g, base.x, base.y, HOME_GOOD * base.sc, HOME_GOOD * ry, C.gold, t * 0.6); this.ring(g, base.x, base.y, HOME_PERFECT * base.sc, HOME_PERFECT * ry, C.white, -t); }
          const im = buildingSprite('house', true, true, ((t * 2) | 0) + (lit ? 1 : 0)); px(im, base, 24, 24 * im.height / im.width, 0.5, 0.82);
          if (lit && ((t * 3) | 0) % 2) { const gl = glint(2); g.drawImage(gl, Math.round(base.x + 6 * base.sc), Math.round(base.y - 14 * base.sc)); }
        } });
      }
    }
    for (let i = 0; i < run.gifts.length; i++) { const q0 = run.gifts[i], q = this.rail(q0.s, q0.u, q0.h); if (q) list.push({ f: q.f, d: () => px(giftBox(i), q, 7, 7, 0.5, 0.5) }); }
    // the sleigh, and Rudolph's nose out in front of it to aim by
    const fr = ((t * 5) | 0) % 2, im = sleighBack(fr), shrink = run.phase === 'run' ? 1 : Math.max(0.12, 1 - lift * 0.92);
    const sw = Math.round(im.width * 0.82 * shrink), shh = Math.round(im.height * 0.82 * shrink); this.sleighAt = { x: sq.x + shx, y: sq.y + shy };
    list.push({ f: D, d: () => {
      const sx = Math.round(sq.x - sw / 2 + shx), sy = Math.min(H - shh - 2, Math.round(sq.y - shh * 0.62 + shy + Math.sin(t * 2.1) * 1.5)); g.drawImage(im, sx, sy, sw, shh);
    } });
    list.sort((a, b) => b.f - a.f); for (const e of list) e.d();
    if (run.phase === 'run') {
      if (homeAhead) { const Ld = run.landing(), q = this.rail(Ld.s, Ld.u, 0); if (q) { const ry = this.alt * foc * 0.658 / (q.f * q.f), rr = 7; this.ring(g, q.x, q.y, rr * q.sc, rr * ry, run.cd > 0 ? C.pink : C.red, t * 2); g.fillStyle = C.white; g.fillRect((q.x | 0) - 3, q.y | 0, 7, 1); g.fillRect(q.x | 0, (q.y | 0) - 2, 1, 5); } }
      const nq = this.rail(run.s + 190, run.u, run.a);
      if (nq) { g.globalCompositeOperation = 'lighter'; g.drawImage(glow(32, '#ff3030'), Math.round(nq.x) - 13, Math.round(nq.y) - 13, 26, 26); g.globalCompositeOperation = 'source-over'; g.fillStyle = C.red; g.fillRect(Math.round(nq.x) - 2, Math.round(nq.y) - 2, 5, 5); g.fillStyle = C.pink; g.fillRect(Math.round(nq.x) - 1, Math.round(nq.y) - 1, 2, 2); }
    }
    for (let k = 0; k < 28; k++) { const q = ((t * 2.4 + hash(k, 1) * 3) % 3) / 3; g.fillStyle = k % 3 ? C.white : C.lemon; g.fillRect((W / 2 + (hash(k, 2) - 0.5) * W * 1.1 * (q + 0.1)) | 0, (horizon + q * q * (H - horizon) * 1.1) | 0, q > 0.6 ? 2 : 1, q > 0.6 ? 3 : 1); }
    for (const p of this.sparks) { p.l -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 160 * dt; g.fillStyle = p.c; g.fillRect(p.x | 0, p.y | 0, 2, 2); } this.sparks = this.sparks.filter((p) => p.l > 0);
    for (const p of this.pops) { p.l -= dt; p.y -= dt * 22; rimmed(g, p.t, Math.round(Math.max(40, Math.min(W - 40, p.x))), Math.round(p.y), p.c, C.ink); } this.pops = this.pops.filter((p) => p.l > 0);
    if (this.flash > 0) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(0.4, this.flash); g.fillStyle = '#6a5ac8'; g.fillRect(0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; this.flash = Math.max(0, this.flash - dt * 2.5); }
  }
}
