// The hero of the cartridge. A tree is stacked skirts of boughs: each skirt has a dark throat under the one
// above it, needle clumps that follow the bough, a bright fringe, then snow pillows on top of all that.
import { C, Buf, hash, mix } from './pal';
import { SPECIES } from './data.ts';

export const STAGE_PX = [6, 9, 12, 16, 20, 25, 31, 40, 54];
export interface TreeOpts { sp: number; px: number; shape: number; snow: number; sway: number; ramp?: readonly string[]; dead?: boolean; gold?: boolean; sick?: boolean; seed?: number; deco?: number; star?: boolean }
const DEAD = [C.dbrown, C.bark, C.brown, C.tan], SICK = ['#54401a', '#866428', '#b8903a', '#e2c866'], GOLD = ['#a8660c', '#e8a41c', '#ffd84e', '#fff8c8'];
const BALLS = [[C.red, '#ff8078', C.dred], [C.gold, C.lemon, '#c07a10'], ['#2f7ae0', '#a4dcff', '#1c3e9c'], [C.white, C.white, C.sn3], ['#e0309a', '#ffa0d8', '#8a1a68']];

export function paintTreeBuf(b: Buf, cx: number, base: number, o: TreeOpts) {
  const S = SPECIES[o.sp]; let ramp: readonly string[] = o.ramp ?? S.ramp; const H = o.px, seed = o.seed ?? 1, sn = o.snow;
  if (o.dead) ramp = DEAD; if (o.sick) ramp = SICK; if (o.gold) ramp = GOLD;
  const pine = S.style === 'pine', noble = S.style === 'noble', spruce = S.style === 'spruce';
  if (H < 8) { // a seedling: three brave needles
    const c = o.dead ? DEAD[1] : ramp[2]; b.px(cx, base, C.bark); b.px(cx, base - 1, ramp[1]);
    for (let y = 2; y < H; y++) { const w = y > H - 2 ? 0 : 1 + (H - y > 3 ? 1 : 0); for (let x = -w; x <= w; x++) b.px(cx + x, base - y, x < 0 ? ramp[2] : ramp[1]); b.px(cx - w, base - y, ramp[3]); }
    b.px(cx, base - H + 1, c); if (sn) { b.px(cx, base - H + 1, C.white); b.px(cx - 1, base - H + 2, C.white); }
    return;
  }
  const trunk = Math.max(1, Math.round(H * 0.11)), crown = H - trunk, top = base - H + 1, half = H * (pine ? 0.42 : spruce ? 0.385 : noble ? 0.36 : 0.37) * (0.88 + o.shape * 0.06);
  const tw = H > 70 ? 10 : H > 34 ? 4 : H > 16 ? 2 : 1, tx = cx - (tw >> 1);
  b.rect(tx, base - trunk, tw, trunk + 1, C.bark); b.rect(tx, base - trunk, 1, trunk + 1, C.brown);
  const n = Math.max(2, Math.min(H > 70 ? 15 : 7, Math.round(crown / (H > 70 ? 13 : noble ? 8.5 : pine ? 8 : 6.6))));
  const cl = H > 70 ? 4 : 3, rough = (2 - o.shape) * 0.9 + (pine ? 0.7 : 0.1);
  for (let i = n - 1; i >= 0; i--) {
    const f1 = Math.pow((i + 1) / n, 0.92), f0 = i === 0 ? 0 : Math.pow(i / n, 0.92) - (noble ? 0.1 : 0.16) / (i + 1) - 0.05;
    const yT = top + Math.round(crown * Math.max(0, f0)), yB = top + Math.round(crown * f1) - 1, wB = Math.max(2, half * Math.pow((i + 1) / n, 0.86)), sway = o.sway * (n - i) / n;
    const per = Math.max(3, Math.min(11, Math.round(wB / (pine ? 1.7 : 2.3)))), toothH = Math.max(1, Math.round((yB - yT) * 0.2));
    const span = Math.ceil(wB + 1), under = i < n - 1;
    for (let dx = -span; dx <= span; dx++) {
      const a = Math.abs(dx) / wB; if (a > 1.02) continue;
      const jag = (hash(dx >> 1, i, seed + 3) - 0.5) * rough * 2;
      const colTop = yT + (yB - yT) * Math.pow(a, 1.25) * 0.92 + jag * 0.5;
      const ph = ((dx + i * 2 + seed * 3 + 64) % per) / per, tooth = Math.abs(ph - 0.5) * 2;
      const colBot = yB - Math.round(tooth * toothH) + Math.round(jag * 0.4) - (a > 0.8 ? Math.round((a - 0.8) * 3) : 0);
      const X = Math.round(cx + dx + sway * (1 - a * 0.3));
      for (let y = Math.round(colTop); y <= colBot; y++) {
        const rel = (y - colTop) / Math.max(1, colBot - colTop), sgn = dx < 0 ? -1 : 1;
        // clumps follow the bough down and out, so hash on slanted cells
        const clump = hash(Math.floor((dx * sgn + y * 0.9) / cl), Math.floor((y - dx * sgn * 0.45) / cl) + i * 7, seed + (sgn > 0 ? 31 : 0)) - 0.5;
        const v = 0.3 + rel * 0.62 - dx / wB * 0.27 + clump * (pine ? 0.42 : 0.3);
        b.px(X, y, v < 0.28 ? ramp[0] : v < 0.58 ? ramp[1] : v < 0.86 ? ramp[2] : ramp[3]);
      }
      // the fringe catches the light
      if (tooth < 0.35 && !o.dead) b.px(X, colBot, dx < wB * 0.35 ? ramp[3] : ramp[2]);
      if (dx > wB * 0.45 && under) b.over(X, colBot, ramp[1]);
    }
    // the shadow this skirt drops on the one below
    if (under) for (let dx = -span; dx <= span; dx++) { const a = Math.abs(dx) / wB; if (a > 0.98) continue; const ph = ((dx + i * 2 + seed * 3 + 64) % per) / per, tooth = Math.abs(ph - 0.5) * 2, y = yB - Math.round(tooth * toothH) + 1, X = Math.round(cx + dx + sway); b.over(X, y, ramp[0]); if (dx > 0) b.over(X, y + 1, ramp[0]); }
    // snow lies on the boughs in pillows
    if (sn > 0 && !o.dead && !o.gold) {
      const deep = sn >= 2 ? 1 : 0.55, ht = (yB - yT);
      for (let dx = -span; dx <= span; dx++) {
        const a = Math.abs(dx) / wB; if (a > 0.97) continue;
        const lump = Math.sin(dx * (1.1 + (i % 3) * 0.17) + i * 2 + seed) * 0.5 + 0.5;
        if (sn < 2 && lump < 0.3) continue;
        const X = Math.round(cx + dx + sway), y0 = Math.round(yT + ht * Math.pow(a, 1.25) * 0.92), thick = Math.max(1, Math.round((0.7 + lump * 1.9) * deep * Math.min(H > 70 ? 3 : 1.6, 0.75 + H / 34)));
        // snow starts a little under the skirt above, so a dark throat still reads
        const start = i === 0 ? y0 : Math.max(y0, yT + Math.round(ht * 0.34 * (1 - a)));
        for (let k = 0; k < thick; k++) { const y = start + k; if (!b.get(X, y)) continue; b.px(X, y, k === thick - 1 ? C.sn3 : dx > wB * 0.4 ? C.sn2 : k === 0 ? C.sn0 : C.sn1); }
      }
    }
  }
  if (o.gold) for (let k = 0; k < 7; k++) { const y = top + 2 + hash(k, 3, seed) * (crown - 3), w = half * (y - top) / crown * 0.8; b.over(cx + (hash(k, 4, seed) - 0.5) * 2 * w, y, C.white); }
  // ornaments: this tree is ready to sell, and it says so
  if (o.deco && !o.dead && !o.sick) {
    const big = H >= 20, count = Math.round(H * (o.deco > 1 ? 0.46 : 0.34));
    for (let k = 0; k < count; k++) {
      const v = (k + 0.7) / count, y = Math.round(top + 3 + v * (crown - 5)), w = half * Math.pow((y - top) / crown, 0.9) * 0.8, x = Math.round(cx + (hash(k, y, seed + 13) - 0.5) * 2 * w);
      const q = BALLS[(hash(k, 2, seed + o.sp) * BALLS.length) | 0];
      if (!b.get(x, y) || !b.get(x, y + 1)) continue;
      if (big) { b.px(x, y, q[0]); b.px(x + 1, y, q[0]); b.px(x, y + 1, q[2]); b.px(x + 1, y + 1, q[2]); b.px(x, y, q[1]); } else b.px(x, y, q[0]);
    }
    if (H >= 25) for (let i = 1; i < n; i++) { // tinsel swag on the big ones
      const yy = top + Math.round(crown * Math.pow(i / n, 0.92)) - 2, w = half * Math.pow(i / n, 0.86) * 0.82;
      for (let x = -w; x <= w; x++) { const u = x / w, y = yy + Math.round((1 - u * u) * 2.2 + u * 1.5); if ((Math.round(x) + i) % 3 !== 0) b.over(cx + x, y, (i % 2 ? C.gold : C.lemon)); }
    }
  }
  if (o.star && !o.dead && !o.sick) { // grade-one shape wears the star
    const y = top; b.px(cx, y - 3, C.white); b.rect(cx - 1, y - 2, 3, 1, C.gold); b.rect(cx - 2, y - 1, 5, 1, C.lemon); b.rect(cx - 1, y, 3, 1, C.gold); b.px(cx, y + 1, C.gold); b.px(cx - 1, y + 1, '#c07a10'); b.px(cx + 1, y + 1, '#c07a10'); b.px(cx, y - 1, C.white);
  }
}

const rimOf = (ramp: readonly string[]) => mix(ramp[0], C.ink, 0.62);
const SNOWY = new Set(['#ffffff', C.sn1, C.sn2, C.sn3].map((c) => { const v = parseInt(c.slice(1), 16); return (0xff000000 | ((v & 255) << 16) | (v & 0xff00) | (v >> 16)) >>> 0; }));
export function treeBuf(o: TreeOpts) {
  const pad = 5, w = Math.ceil(o.px * 0.92) + pad * 2 + 2, h = o.px + pad + 3, b = new Buf(w, h);
  paintTreeBuf(b, w >> 1, h - 2, o);
  const ramp = o.dead ? DEAD : o.sick ? SICK : o.gold ? GOLD : o.ramp ?? SPECIES[o.sp].ramp, rim = rimOf(ramp), snowRim = mix(C.sn5, C.ink, 0.45);
  if (o.px >= 8) b.outline((t) => (SNOWY.has(t) ? snowRim : rim));
  return b;
}
