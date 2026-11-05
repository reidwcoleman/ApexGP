// Christmas Eve: the camera lifts off and flies your actual farm in SNES-style Mode 7, every tree
// you left standing twinkling below. The bigger the farm, the better this looks. That's the point.
import { C, hex } from './pal';
import { MW, MH, F_DEAD } from './sim.ts';
import type { Sim } from './sim.ts';

export class Flyover {
  tex: Uint32Array; tw: number; th: number; img: ImageData | null = null; buf: Uint32Array | null = null;
  lit: number[] = []; t = 0; base: Uint32Array;
  stars: { x: number; y: number; b: number }[] = [];
  constructor(src: HTMLCanvasElement, private sim: Sim) {
    const w = src.width, h = src.height, d = src.getContext('2d')!.getImageData(0, 0, w, h).data;
    this.tw = w; this.th = h; this.tex = new Uint32Array(w * h); this.base = new Uint32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      // moonlit: pull the farm into blue
      const r = d[i * 4] * 0.34, g = d[i * 4 + 1] * 0.42, b = d[i * 4 + 2] * 0.62 + 18;
      this.base[i] = this.tex[i] = 0xff000000 | (b << 16) | (g << 8) | r;
    }
    for (let i = 0; i < sim.N; i++) if (sim.sp[i] && !(sim.flag[i] & F_DEAD) && sim.h[i] >= 2 && sim.ownedTile(i)) this.lit.push(((((i / MW) | 0) * 2) * w) + (i % MW) * 2);
    for (let i = 0; i < 140; i++) this.stars.push({ x: Math.random(), y: Math.random() * Math.random(), b: Math.random() });
  }
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
    for (let y = 0; y < horizon; y++) {
      const k = y / horizon, r = 10 + 30 * k, gg = 14 + 42 * k, b = 42 + 72 * k, c = 0xff000000 | (b << 16) | (gg << 8) | r, o = y * W;
      for (let x = 0; x < W; x++) buf[o + x] = c;
    }
    for (let y = horizon; y < H; y++) {
      const dy = y - horizon + 1, dist = alt * H * 0.5 / dy, o = y * W, fog = Math.min(1, dist / 760);
      const rx = -sa * dist * fov / W * 2, ry = ca * dist * fov / W * 2;
      let wx = camX + ca * dist - rx * W / 2, wy = camY + sa * dist - ry * W / 2;
      const fr = 22, fg = 34, fb = 86;
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
    // moon, and a sleigh that may or may not be there
    const mx = ((0.72 + ang * 0.25) % 1 + 1) % 1 * W, my = horizon * 0.34;
    g.fillStyle = C.lemon; g.beginPath(); g.arc(mx | 0, my | 0, 14, 0, 7); g.fill(); g.fillStyle = '#f0d878'; g.fillRect((mx | 0) - 5, (my | 0) - 4, 4, 3); g.fillRect((mx | 0) + 3, (my | 0) + 3, 5, 3);
    const sx = ((t * 34) % (W + 120)) - 60, sy = horizon * 0.5 + Math.sin(t) * 4;
    g.fillStyle = C.ink;
    g.fillRect(sx, sy, 15, 4); g.fillRect(sx - 2, sy + 5, 19, 1); g.fillRect(sx + 12, sy - 3, 3, 3);
    for (let i = 0; i < 4; i++) { const q = sx + 20 + i * 9, b2 = Math.sin(t * 8 + i) > 0 ? 1 : 0; g.fillRect(q, sy - 1 + b2, 6, 2); g.fillRect(q + 5, sy - 3 + b2, 2, 2); g.fillRect(q + 1, sy + 1 + b2, 1, 2); g.fillRect(q + 4, sy + 1 + b2, 1, 2); }
    void MH;
  }
}
