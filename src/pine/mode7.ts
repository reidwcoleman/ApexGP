// Christmas Eve: the camera lifts off and flies your actual farm in SNES-style Mode 7, every tree
// you left standing twinkling below. The bigger the farm, the better this looks. That's the point.
import { C, hex, hash, bayer, u32 } from './pal';
import { moonSprite, sleighBack, glow } from './art';
import { MW, MH, F_DEAD } from './sim.ts';
import type { Sim } from './sim.ts';

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
    for (let i = 0; i < sim.N; i++) if (sim.sp[i] && !(sim.flag[i] & F_DEAD) && sim.h[i] >= 2 && sim.ownedTile(i)) this.lit.push(((((i / MW) | 0) * 2) * w) + (i % MW) * 2);
    for (let i = 0; i < 180; i++) this.stars.push({ x: Math.random(), y: Math.random() * Math.random(), b: Math.random() });
    // a wrap-around sky, banded and dithered, with the aurora already in it
    const SK = ['#0a0a30', '#10104a', '#181a64', '#23247e', '#352f96', '#5240a8'].map(u32), AU = [u32('#2fae90'), u32('#58e0b0'), u32('#7ad0ff'), u32('#c870e8')];
    this.sky = new Uint32Array(SW * SH);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const k = Math.pow(y / SH, 1.2) * 5 + (bayer(x, y) - 0.5) * 0.6; this.sky[y * SW + x] = SK[Math.max(0, Math.min(5, Math.round(k)))]; }
    for (let x = 0; x < SW; x++) { const u = x / SW * 6.2832, yc = SH * (0.46 + Math.sin(u * 2) * 0.1 + Math.sin(u * 5 + 1) * 0.05), L = SH * (0.24 + 0.14 * Math.sin(u * 3 + 2) ** 2), st = 0.5 + 0.5 * Math.sin(u * 19) * Math.sin(u * 7); for (let y = 0; y < L; y++) { const a = (1 - y / L) * (0.4 + st * 0.6) + (bayer(x, y) - 0.5) * 0.12; if (a < 0.08) continue; const i = Math.max(0, (yc - y) | 0) * SW + x, c = AU[y < L * 0.3 ? 1 : y < L * 0.6 ? 0 : hash(x >> 3, 1) > 0.5 ? 2 : 3], k = a > 0.62 ? 0.5 : a > 0.36 ? 0.3 : 0.14, o = this.sky[i]; this.sky[i] = (0xff000000 | ((((o >> 16) & 255) * (1 - k) + ((c >> 16) & 255) * k) << 16) | ((((o >> 8) & 255) * (1 - k) + ((c >> 8) & 255) * k) << 8) | ((o & 255) * (1 - k) + (c & 255) * k)) >>> 0; } }
  }
  sky: Uint32Array;
  draw(g: CanvasRenderingContext2D, W: number, H: number, dt: number) {
    this.t += dt;
    if (!this.img || this.img.width !== W || this.img.height !== H) { this.img = g.createImageData(W, H); this.buf = new Uint32Array(this.img.data.buffer); }
    const buf = this.buf!, tex = this.tex, tw = this.tw, th = this.th;
    // twinkle: a slice of the lights change each frame
    const L = [C.red, C.gold, C.aqua, C.pink, C.white, C.lime].map((c) => { const [r, gg, b] = hex(c); return 0xff000000 | (b << 16) | (gg << 8) | r; });
    const n = this.lit.length, flips = Math.min(n, 2500);
    for (let k = 0; k < flips; k++) { const p = this.lit[(Math.random() * n) | 0]; tex[p] = Math.random() < 0.72 ? L[(Math.random() * 6) | 0] : this.base[p]; }
    const horizon = Math.round(H * 0.34), t = this.t;
    // a slow arc round the home place, then out across the whole county
    const s = this.sim.s, cxT = (s.p.x * 0.3 + 128 * 0.7), cyT = (s.p.y * 0.3 + 80 * 0.7), ang = 0.6 + t * 0.075, rad = 90 - t * 2.2;
    const camX = (cxT + Math.cos(ang) * rad) * 2, camY = (cyT + Math.sin(ang) * rad) * 2, dir = ang + Math.PI + 0.25, ca = Math.cos(dir), sa = Math.sin(dir);
    const alt = 34 + Math.min(1, t / 12) * 40 + Math.sin(t * 0.3) * 4, fov = 1.05;
    const so = ((ang * 160) | 0) & (SW - 1), sky = this.sky;
    for (let y = 0; y < horizon; y++) { const sy = ((y / horizon) * SH) | 0, o = y * W, r = sy * SW; for (let x = 0; x < W; x++) buf[o + x] = sky[r + ((x + so) & (SW - 1))]; }
    for (let y = horizon; y < H; y++) {
      const dy = y - horizon + 1, dist = alt * H * 0.5 / dy, o = y * W, fog = Math.min(1, dist / 760);
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
    const mx = ((0.72 + ang * 0.25) % 1 + 1) % 1 * W, my = horizon * 0.34;
    g.globalCompositeOperation = 'lighter'; g.drawImage(glow(64, '#8080e0'), (mx | 0) - 64, (my | 0) - 64); g.globalCompositeOperation = 'source-over'; g.drawImage(moonSprite(18), (mx | 0) - 19, (my | 0) - 19);
    // you are riding in it
    const fr = ((t * 5) | 0) % 2, im = sleighBack(fr), bank = Math.sin(t * 0.5) * 8, sx = Math.round(W / 2 - im.width / 2 + bank), sy = Math.round(H - im.height - 3 + Math.sin(t * 2.1) * 2.5);
    g.drawImage(im, sx, sy);
    g.globalCompositeOperation = 'lighter'; g.drawImage(glow(32, '#ff4040'), sx + (im.width >> 1) - 16, sy - 14); g.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 24; k++) { const q = ((t * 1.8 + hash(k, 1) * 3) % 3) / 3; g.fillStyle = k % 3 ? C.white : C.lemon; g.fillRect((W / 2 + (hash(k, 2) - 0.5) * W * 1.1 * (q + 0.1)) | 0, (H * 0.4 + q * q * H * 0.7) | 0, q > 0.6 ? 2 : 1, q > 0.6 ? 2 : 1); }
    void MH;
  }
}
