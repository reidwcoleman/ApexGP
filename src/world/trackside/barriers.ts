import * as THREE from 'three';
import { Frame3, box, beam, cylinder, prism, type GeoBuilder } from './builder.ts';
import type { Ctx, SidePlan } from './context.ts';
import { hash2 } from './noise.ts';
import { BELTS, SPONSORS, type PrintAtlas, type UVRect } from './atlas.ts';

/**
 * Barriers along barrierL/barrierR: armco double rails on posts, concrete walls
 * with painted sponsor panels, tyre walls with conveyor-belt covers, TecPro
 * blocks, the pit wall; debris fences with posts and overhang; fence banners.
 *
 * The barrier FACE is always at the physics barrier distance. Walls are
 * vertical (world up) and follow the barrier line, whose tangent is measured on
 * the line itself so walls stay parallel to it where the barrier moves in/out.
 */

interface BarrierPath {
  bx: Float32Array;
  by: Float32Array;
  bz: Float32Array;
  ox: Float32Array;
  oz: Float32Array;
  len: Float64Array;
}

const TECPRO_PAL: [number, number][] = [
  [0xc8201e, 0xe8e8e4],
  [0x1f4fa8, 0xe8e8e4],
  [0xc8201e, 0x1f4fa8],
  [0xf2c200, 0x1f4fa8],
  [0xe8e8e4, 0x222222],
];
const BELT_PAL: string[][] = [
  ['belt_red', 'belt_white', 'belt_red', 'belt_logo0'],
  ['belt_blue', 'belt_white', 'belt_blue', 'belt_logo2'],
  ['belt_redwhite', 'belt_logo1'],
  ['belt_yellow', 'belt_black'],
  ['belt_red', 'belt_logo0', 'belt_white', 'belt_blue'],
];

const V = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const FR = new Frame3();

export function buildBarriers(ctx: Ctx, atlas: PrintAtlas) {
  for (const P of [ctx.L, ctx.R]) buildSide(ctx, atlas, P);
}

function makePath(ctx: Ctx, P: SidePlan): BarrierPath {
  const t = ctx.track;
  const n = ctx.n;
  const bx = new Float32Array(n + 1), by = new Float32Array(n + 1), bz = new Float32Array(n + 1);
  const ox = new Float32Array(n + 1), oz = new Float32Array(n + 1);
  const len = new Float64Array(n + 1);
  const p = new THREE.Vector3();
  for (let r = 0; r <= n; r++) {
    const k = r % n;
    t.point(k, P.side * P.bar[k], 0, p);
    bx[r] = p.x; by[r] = p.y; bz[r] = p.z;
  }
  for (let r = 0; r <= n; r++) {
    const a = r === 0 ? n - 1 : r - 1;
    const b = r === n ? 1 : r + 1;
    let tx = bx[b] - bx[a], tz = bz[b] - bz[a];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    // right of the line's tangent = (−tz, tx); outward = side × right
    ox[r] = -tz * P.side;
    oz[r] = tx * P.side;
    if (r > 0) len[r] = len[r - 1] + Math.hypot(bx[r] - bx[r - 1], bz[r] - bz[r - 1]);
  }
  return { bx, by, bz, ox, oz, len };
}

function buildSide(ctx: Ctx, atlas: PrintAtlas, P: SidePlan) {
  const n = ctx.n;
  const cs = ctx.cs;
  const path = makePath(ctx, P);
  const sd = P.side;
  const W = (r: number) => ctx.wrap(r);

  /** world point: row r (0..n), offset x (m, away from the track from the barrier face), height y */
  const at = (r: number, x: number, y: number, out: THREE.Vector3) =>
    out.set(path.bx[r] + path.ox[r] * x, path.by[r] + y, path.bz[r] + path.oz[r] * x);
  /** interpolated at fractional row */
  const atF = (rf: number, x: number, y: number, out: THREE.Vector3) => {
    const r = Math.min(n - 1, Math.max(0, Math.floor(rf)));
    const f = rf - r;
    const ox = path.ox[r] * (1 - f) + path.ox[r + 1] * f;
    const oz = path.oz[r] * (1 - f) + path.oz[r + 1] * f;
    const l = Math.hypot(ox, oz) || 1;
    return out.set(
      path.bx[r] * (1 - f) + path.bx[r + 1] * f + (ox / l) * x,
      path.by[r] * (1 - f) + path.by[r + 1] * f + y,
      path.bz[r] * (1 - f) + path.bz[r + 1] * f + (oz / l) * x,
    );
  };
  /** fractional row at path length p */
  const rowAt = (p: number): number => {
    let lo = 0, hi = n;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (path.len[m] <= p) lo = m;
      else hi = m;
    }
    const seg = path.len[lo + 1] - path.len[lo];
    return lo + (seg > 1e-6 ? (p - path.len[lo]) / seg : 0);
  };

  /**
   * One segment (row rA → rB) of a profile edge (x0,y0)→(x1,y1) (x relative to the
   * barrier face + xOff). Normal given in (outward, up) components.
   * With `panel` the u coordinate is path length mapped into atlas cells of panelLen metres.
   */
  const strip = (
    b: GeoBuilder, rA: number, rB: number, x0: number, y0: number, x1: number, y1: number, no: number, nu: number,
    xOff0: number, xOff1: number,
    panel?: { len: number; cell: (k: number) => UVRect | null; vy0: number; vy1: number },
  ) => {
    const oxA = path.ox[rA], ozA = path.oz[rA], oxB = path.ox[rB], ozB = path.oz[rB];
    if (!panel) {
      const nx0 = oxA * no, nz0 = ozA * no, nx1 = oxB * no, nz1 = ozB * no;
      at(rA, x0 + xOff0, y0, V[0]);
      at(rA, x1 + xOff0, y1, V[1]);
      at(rB, x1 + xOff1, y1, V[2]);
      at(rB, x0 + xOff1, y0, V[3]);
      const a = b.v(V[0].x, V[0].y, V[0].z, nx0, nu, nz0, 0, 0);
      const c = b.v(V[1].x, V[1].y, V[1].z, nx0, nu, nz0, 0, 1);
      const d = b.v(V[2].x, V[2].y, V[2].z, nx1, nu, nz1, 1, 1);
      const e = b.v(V[3].x, V[3].y, V[3].z, nx1, nu, nz1, 1, 0);
      b.quadN(a, c, d, e, nx0 + nx1, nu * 2, nz0 + nz1);
      return;
    }
    const p0 = path.len[rA], p1 = path.len[rB];
    if (p1 - p0 < 1e-5) return;
    let pa = p0;
    while (pa < p1 - 1e-5) {
      const k = Math.floor(pa / panel.len + 1e-7);
      const pb = Math.min(p1, (k + 1) * panel.len);
      const c0 = panel.cell(k);
      // printed faces read left→right for someone looking at them (mirror u where the path runs "backwards")
      const cell = c0 && no * sd < 0 ? { u0: c0.u1, u1: c0.u0, v0: c0.v0, v1: c0.v1 } : c0;
      if (cell) {
        const fa = (pa - p0) / (p1 - p0), fb = (pb - p0) / (p1 - p0);
        const ua = cell.u0 + ((pa - k * panel.len) / panel.len) * (cell.u1 - cell.u0);
        const ub = cell.u0 + ((pb - k * panel.len) / panel.len) * (cell.u1 - cell.u0);
        const va = cell.v0 + panel.vy0 * (cell.v1 - cell.v0);
        const vb = cell.v0 + panel.vy1 * (cell.v1 - cell.v0);
        const xa = xOff0 + (xOff1 - xOff0) * fa, xb = xOff0 + (xOff1 - xOff0) * fb;
        const ra = rowAt(pa), rb = rowAt(pb);
        atF(ra, x0 + xa, y0, V[0]);
        atF(ra, x1 + xa, y1, V[1]);
        atF(rb, x1 + xb, y1, V[2]);
        atF(rb, x0 + xb, y0, V[3]);
        const nx = (oxA * (1 - fa) + oxB * fa) * no, nz = (ozA * (1 - fa) + ozB * fa) * no;
        const a = b.v(V[0].x, V[0].y, V[0].z, nx, nu, nz, ua, va);
        const c = b.v(V[1].x, V[1].y, V[1].z, nx, nu, nz, ua, vb);
        const d = b.v(V[2].x, V[2].y, V[2].z, nx, nu, nz, ub, vb);
        const e = b.v(V[3].x, V[3].y, V[3].z, nx, nu, nz, ub, va);
        b.quadN(a, c, d, e, nx, nu, nz);
      }
      pa = pb;
    }
  };

  /** vertical end cap in the plane of row r, spanning x0..x1 (plus xOff), y0..y1, facing ±along the line */
  const cap = (b: GeoBuilder, r: number, x0: number, x1: number, y0: number, y1: number, dir: number, uv?: UVRect) => {
    at(r, x0, y0, V[0]); at(r, x1, y0, V[1]); at(r, x1, y1, V[2]); at(r, x0, y1, V[3]);
    // along-line direction
    const tx = path.oz[r] * sd, tz = -path.ox[r] * sd;
    const nx = tx * dir, nz = tz * dir;
    const u = uv ?? { u0: 0, u1: 1, v0: 0, v1: 1 };
    const a = b.v(V[0].x, V[0].y, V[0].z, nx, 0, nz, u.u0, u.v0);
    const c = b.v(V[1].x, V[1].y, V[1].z, nx, 0, nz, u.u1, u.v0);
    const d = b.v(V[2].x, V[2].y, V[2].z, nx, 0, nz, u.u1, u.v1);
    const e = b.v(V[3].x, V[3].y, V[3].z, nx, 0, nz, u.u0, u.v1);
    b.quadN(a, c, d, e, nx, 0, nz);
  };

  const adCell = (k: number, salt: number) => {
    const group = Math.floor(k / 3);
    const idx = Math.floor(hash2(group, salt, 17) * SPONSORS.length);
    return atlas.cell('ad' + idx);
  };

  // segments where the barrier distance jumps (pit wall ends) are left open
  const jump = (r: number) => Math.abs(P.bar[W(r + 1)] - P.bar[W(r)]) > 1.2;
  const isWallK = (k: string) => k === 'concrete' || k === 'pitwall';

  // ------------------------------------------------------------------ segments: merge rows while nothing changes
  const same = (a: number, b: number) =>
    P.kind[a] === P.kind[b] && P.front[a] === P.front[b] && P.fence[a] === P.fence[b] && P.gate[a] === P.gate[b] && P.palette[a] === P.palette[b] &&
    P.art[a] === P.art[b] && P.boards[a] === P.boards[b] && Math.abs(P.backOff[a] - P.backOff[b]) < 0.02;
  const segs: [number, number][] = [];
  for (let r = 0; r < n; ) {
    if (jump(r)) {
      segs.push([r, -1]);
      r++;
      continue;
    }
    let e = r + 1;
    while (e < n && e - r < 4 && same(r, e) && !jump(e)) {
      const dot = path.ox[r] * path.ox[e + 1] + path.oz[r] * path.oz[e + 1];
      if (dot < 0.99965) break; // ~1.5° of turn per segment at most
      e++;
    }
    segs.push([r, e]);
    r = e;
  }

  for (let si = 0; si < segs.length; si++) {
    const [rA, rB] = segs[si];
    if (rB < 0) continue;
    const i = rA;
    const iB = W(rB);
    const prevOk = segs[(si - 1 + segs.length) % segs.length][1] >= 0;
    const nextOk = segs[(si + 1) % segs.length][1] >= 0;
    const kind = P.kind[i];
    if (kind === 'none') continue;
    const front = P.front[i];
    const gate = P.gate[i] === 1;
    const xb0 = P.backOff[i], xb1 = P.backOff[iB];
    const props = cs.get(i, 'props');
    const print = cs.get(i, 'print');

    // ---------------- front layer
    if (front === 'tyres') {
      const pal = BELT_PAL[Math.max(0, P.palette[i]) % BELT_PAL.length];
      print.rgb(1, 1, 1).mat(0.82, 0, 0);
      const D = 1.3, H = 1.0;
      strip(print, rA, rB, 0, 0.0, 0, H, -1, 0, 0, 0, { len: 4, cell: (k) => atlas.cell(pal[((k % pal.length) + pal.length) % pal.length]), vy0: 0, vy1: 1 });
      print.mat(0.9, 0, 0);
      strip(print, rA, rB, 0, H, D, H, 0, 1, 0, 0, { len: 4, cell: () => atlas.cell('tyre_top'), vy0: 0.05, vy1: 0.95 });
      strip(print, rA, rB, D, H, D, 0, 1, 0, 0, 0, { len: 4, cell: () => atlas.cell('tyre_side'), vy0: 1, vy1: 0 });
      if (P.front[W(rA - 1)] !== 'tyres' || !prevOk) cap(print, rA, 0, D, 0, H, -1, atlas.sub('tyre_side', 0, 0.35, 0, 1));
      if (P.front[iB] !== 'tyres' || !nextOk) cap(print, rB, 0, D, 0, H, 1, atlas.sub('tyre_side', 0, 0.35, 0, 1));
    }

    // ---------------- backing wall
    if (isWallK(kind)) {
      const H = kind === 'pitwall' ? 1.1 : 1.05;
      const T = kind === 'pitwall' ? 0.6 : 0.45;
      print.rgb(1, 1, 1).mat(0.7, 0, 0);
      const plainWall = kind === 'concrete' && front !== 'none';
      const art = P.art[i];
      const wallCell = (k: number) => {
        if (kind === 'pitwall') return k % 4 === 0 ? atlas.cell('pitwall') : adCell(k, sd * 13 + 5);
        if (plainWall || art === 1) return atlas.cell('concrete_paint');
        if (art === 2) return atlas.cell('wall_stripes');
        if (art === 3) return ((k % 3) + 3) % 3 === 1 ? atlas.cell('wall_champions') : atlas.cell('concrete_paint');
        return adCell(k, sd * 13);
      };
      strip(print, rA, rB, 0, 0, 0, H, -1, 0, xb0, xb1, { len: 4, cell: wallCell, vy0: 0, vy1: 1 });
      props.color(0xa9a7a0).mat(0.88, 0, 0);
      strip(props, rA, rB, 0, H, T, H, 0, 1, xb0, xb1);
      print.rgb(0.95, 0.95, 0.95).mat(0.9, 0, 0);
      strip(print, rA, rB, T, H, T, 0, 1, 0, xb0, xb1, { len: 4, cell: () => atlas.cell('concrete'), vy0: 1, vy1: 0 });
      const chev = atlas.sub('chevron', 0, 0.3, 0, 1);
      const capB = kind === 'pitwall' ? print : props;
      if (!isWallK(P.kind[W(rA - 1)]) || !prevOk) cap(capB, rA, xb0, xb0 + T, 0, H, -1, kind === 'pitwall' ? chev : undefined);
      if (!isWallK(P.kind[iB]) || !nextOk) cap(capB, rB, xb1, xb1 + T, 0, H, 1, kind === 'pitwall' ? chev : undefined);
    } else if (!gate) {
      // armco: two W-beam rails (galvanised steel)
      props.color(0xaeb2b6).mat(0.36, 0.85, 0);
      for (const y0 of [0.46, 0.83]) armcoRail(props, rA, rB, y0, xb0, xb1);
      // sponsor boards bolted over the rails
      if (P.boards[i]) {
        print.rgb(1, 1, 1).mat(0.5, 0, 0.04);
        strip(print, rA, rB, -0.02, 0.44, -0.02, 1.15, -1, 0, xb0, xb1, { len: 4, cell: (k) => adCell(k, sd * 41 + 3), vy0: 0.02, vy1: 0.98 });
      }
    }

    // ---------------- fence (behind the backing wall)
    if (P.fence[i] && !gate) {
      const fx0 = xb0 + 0.62, fx1 = xb1 + 0.62;
      const fb = cs.get(i, 'fence');
      const pl0 = path.len[rA], pl1 = path.len[rB];
      const tall = P.fence[i] === 2;
      const HV = tall ? 5.2 : 3.6, OH = tall ? 0.9 : 0.75, OT = tall ? 6.05 : 4.35;
      at(rA, fx0, 0, V[0]); at(rB, fx1, 0, V[1]); at(rB, fx1, HV, V[2]); at(rA, fx0, HV, V[3]);
      const u0 = pl0 / 0.5, u1 = pl1 / 0.5;
      const nx = -path.ox[rA], nz = -path.oz[rA];
      let a = fb.v(V[0].x, V[0].y, V[0].z, nx, 0, nz, u0, 0);
      let c = fb.v(V[1].x, V[1].y, V[1].z, nx, 0, nz, u1, 0);
      let d = fb.v(V[2].x, V[2].y, V[2].z, nx, 0, nz, u1, HV / 4);
      let e = fb.v(V[3].x, V[3].y, V[3].z, nx, 0, nz, u0, HV / 4);
      fb.quadN(a, c, d, e, nx, 0, nz);
      // overhang leaning toward the track
      at(rA, fx0 - OH, OT, V[0]); at(rB, fx1 - OH, OT, V[1]);
      a = fb.v(V[3].x, V[3].y, V[3].z, nx * 0.7, 0.7, nz * 0.7, u0, HV / 4);
      c = fb.v(V[2].x, V[2].y, V[2].z, nx * 0.7, 0.7, nz * 0.7, u1, HV / 4);
      d = fb.v(V[1].x, V[1].y, V[1].z, nx * 0.7, 0.7, nz * 0.7, u1, 1.0);
      e = fb.v(V[0].x, V[0].y, V[0].z, nx * 0.7, 0.7, nz * 0.7, u0, 1.0);
      fb.quadN(a, c, d, e, nx, 0.7, nz);
    }
  }

  // ------------------------------------------------------------------ posts & blocks (by path length)
  const total = path.len[n];
  // armco posts every 2 m
  for (let p = 1; p < total; p += 2.5) {
    const rf = rowAt(p);
    const i = W(Math.floor(rf));
    if (P.kind[i] !== 'armco' || P.gate[i]) continue;
    const props = cs.get(i, 'props');
    // galvanised I-post (dull, weathered: brighter only where the rails are)
    props.color(0x6c7176).mat(0.62, 0.55, 0);
    frameAt(rf, P.backOff[i] + 0.2, 0);
    box(props, FR, 0, 0.58, 0, 0.1, 1.16, 0.14, 0b110111);
    // spacer block behind the rails
    props.color(0x7c8085);
    box(props, FR, -0.09 * sd, 0.82, 0, 0.09, 0.62, 0.08, 0b110011);
  }
  // fence posts every 4 m (+ overhang arm)
  for (let p = 2; p < total; p += 4) {
    const rf = rowAt(p);
    const i = W(Math.floor(rf));
    if (!P.fence[i]) continue;
    if (P.gate[i]) continue;
    const props = cs.get(i, 'props');
    props.color(0x4a4e52).mat(0.5, 0.7, 0);
    const x = P.backOff[i] + 0.66;
    const tall = P.fence[i] === 2;
    atF(rf, x, 0, V[0]);
    atF(rf, x, tall ? 5.22 : 3.62, V[1]);
    atF(rf, x - (tall ? 0.93 : 0.78), tall ? 6.1 : 4.4, V[2]);
    beam(props, V[0], V[1], 0.11, 0.11);
    beam(props, V[1], V[2], 0.08, 0.08);
  }
  // marshal gates: heavy posts either side, a closed mesh gate set back, and an overlapping rail behind the opening
  for (let r = 0; r < n; r++) {
    if (!P.gate[r] || P.gate[W(r - 1)]) continue;
    let e = r;
    while (P.gate[W(e + 1)] && e - r < 10) e++;
    const rEnd = Math.min(n, e + 1);
    const i = W(r);
    const props = cs.get(i, 'props');
    const fb = cs.get(i, 'fence');
    const x = P.backOff[i] + 0.66;
    props.color(0x3c4044).mat(0.5, 0.7, 0);
    for (const rr of [r, rEnd]) {
      atF(rr, x, 0, V[0]);
      atF(rr, x, 3.9, V[1]);
      beam(props, V[0], V[1], 0.16, 0.16);
    }
    // gate leaf: frame + mesh, set 0.9 m back from the fence line
    const gx = x + 0.9;
    props.color(0x6a6e72).mat(0.45, 0.75, 0);
    for (const y of [0.1, 2.3]) {
      atF(r, gx, y, V[0]);
      atF(rEnd, gx, y, V[1]);
      beam(props, V[0], V[1], 0.06, 0.06);
    }
    for (const rr of [r, rEnd]) {
      atF(rr, gx, 0.05, V[0]);
      atF(rr, gx, 2.35, V[1]);
      beam(props, V[0], V[1], 0.06, 0.06);
    }
    atF(r, gx, 0.1, V[0]); atF(rEnd, gx, 0.1, V[1]); atF(rEnd, gx, 2.3, V[2]); atF(r, gx, 2.3, V[3]);
    const nx = -path.ox[r], nz = -path.oz[r];
    const u0 = path.len[r] / 0.5, u1 = path.len[rEnd] / 0.5;
    const a = fb.v(V[0].x, V[0].y, V[0].z, nx, 0, nz, u0, 0.03);
    const c = fb.v(V[1].x, V[1].y, V[1].z, nx, 0, nz, u1, 0.03);
    const d = fb.v(V[2].x, V[2].y, V[2].z, nx, 0, nz, u1, 0.58);
    const f = fb.v(V[3].x, V[3].y, V[3].z, nx, 0, nz, u0, 0.58);
    fb.quadN(a, c, d, f, nx, 0, nz);
    // overlapping armco section behind the gap (the classic staggered opening)
    if (P.kind[i] === 'armco') {
      const r0 = Math.max(0, r - 3), r1 = Math.min(n, rEnd + 3);
      props.color(0xaeb2b6).mat(0.36, 0.85, 0);
      for (let q = r0; q < r1; q++) for (const y0 of [0.46, 0.83]) armcoRail(props, q, q + 1, y0, P.backOff[W(q)] + 2.2, P.backOff[W(q + 1)] + 2.2);
    }
  }

  // TecPro blocks every 1.5 m
  let blockIdx = 0;
  for (let p = 0.75; p < total; p += 1.5) {
    const rf = rowAt(p);
    const i = W(Math.floor(rf));
    if (P.front[i] !== 'tecpro') {
      blockIdx = 0;
      continue;
    }
    const pal = TECPRO_PAL[Math.max(0, P.palette[i]) % TECPRO_PAL.length];
    const props = cs.get(i, 'props');
    props.color(pal[blockIdx++ % 2]).mat(0.55, 0, 0);
    frameAt(rf, 0.48, 0);
    FR.yaw((hash2(Math.floor(p * 10), sd, 3) - 0.5) * 0.03);
    const hl = 0.7, hd = 0.47, c = 0.12;
    prism(props, FR, [
      [-hd + c, -hl], [hd - c, -hl], [hd, -hl + c], [hd, hl - c], [hd - c, hl], [-hd + c, hl], [-hd, hl - c], [-hd, -hl + c],
    ], 0, 1.1);
    // lashing straps
    props.color(0x1c1c1c).mat(0.7, 0, 0);
    box(props, FR, 0, 0.32, 0, hd * 2 + 0.01, 0.05, hl * 2 + 0.01, 0b110011);
    box(props, FR, 0, 0.82, 0, hd * 2 + 0.01, 0.05, hl * 2 + 0.01, 0b110011);
  }
  // fence banners (sponsor wraps) in braking zones / corner outsides: 4.8 m every 6 m
  for (let k = 0; k * 6 + 5 < total; k++) {
    const p0 = k * 6 + 0.6, p1 = p0 + 4.8;
    const r0 = rowAt(p0), r1 = rowAt(p1);
    const i = W(Math.floor(r0));
    const iEnd = W(Math.floor(r1));
    if (!P.banners[i] || !P.fence[i] || !P.fence[iEnd]) continue;
    const print = cs.get(i, 'print');
    print.rgb(1, 1, 1).mat(0.6, 0, 0);
    const c0 = adCell(k * 3, sd * 29 + 7);
    // read left→right for someone on the track: their right is +tangent on the left side, −tangent on the right.
    // (Measured on the actual banner ends, so it stays right where the barrier line folds back around a tight apex.)
    atF(r0, 0, 0, V[0]);
    atF(r1, 0, 0, V[1]);
    const tk = W(Math.floor(r0));
    const along = (V[1].x - V[0].x) * ctx.track.tx[tk] + (V[1].z - V[0].z) * ctx.track.tz[tk];
    // skip where the barrier line folds round a tight apex (it no longer runs alongside the track)
    if (Math.abs(along) < 0.8 * Math.hypot(V[1].x - V[0].x, V[1].z - V[0].z)) continue;
    const flip = along * -sd < 0;
    const cell = flip ? { u0: c0.u1, u1: c0.u0, v0: c0.v0, v1: c0.v1 } : c0;
    const pieces = 3;
    for (let q = 0; q < pieces; q++) {
      const fa = q / pieces, fb = (q + 1) / pieces;
      const ra = r0 + (r1 - r0) * fa, rb = r0 + (r1 - r0) * fb;
      const xa = P.backOff[W(Math.floor(ra))] + 0.58, xb = P.backOff[W(Math.floor(rb))] + 0.58;
      atF(ra, xa, 1.25, V[0]); atF(rb, xb, 1.25, V[1]); atF(rb, xb, 2.45, V[2]); atF(ra, xa, 2.45, V[3]);
      const ua = cell.u0 + (cell.u1 - cell.u0) * fa, ub = cell.u0 + (cell.u1 - cell.u0) * fb;
      const rr = W(Math.floor(ra));
      // face the track (its centreline), whatever the barrier line is doing
      const nx = -ctx.track.rx[rr] * sd, nz = -ctx.track.rz[rr] * sd;
      const a = print.v(V[0].x, V[0].y, V[0].z, nx, 0, nz, ua, cell.v0);
      const c = print.v(V[1].x, V[1].y, V[1].z, nx, 0, nz, ub, cell.v0);
      const d = print.v(V[2].x, V[2].y, V[2].z, nx, 0, nz, ub, cell.v1);
      const e = print.v(V[3].x, V[3].y, V[3].z, nx, 0, nz, ua, cell.v1);
      print.quadN(a, c, d, e, nx, 0, nz);
    }
  }

  function frameAt(rf: number, x: number, y: number) {
    const r = Math.min(n - 1, Math.max(0, Math.floor(rf)));
    atF(rf, x, y, FR.o);
    // along-line direction (for side +1 the outward is the right of travel)
    const ox = path.ox[r], oz = path.oz[r];
    const fx = oz * sd, fz = -ox * sd;
    FR.z.set(fx, 0, fz).normalize();
    FR.y.set(0, 1, 0);
    FR.x.crossVectors(FR.z, FR.y).normalize();
  }

  function armcoRail(b: GeoBuilder, rA: number, rB: number, y0: number, xo0: number, xo1: number) {
    // W-beam: depth x (0 = track face) vs height — two ridges and a valley
    const X = [0.06, 0.0, 0.05, 0.0, 0.06];
    const Y = [0, 0.07, 0.155, 0.24, 0.31];
    for (let j = 0; j < X.length - 1; j++) {
      const dx = X[j + 1] - X[j], dy = Y[j + 1] - Y[j];
      const l = Math.hypot(dx, dy) || 1;
      strip(b, rA, rB, X[j], y0 + Y[j], X[j + 1], y0 + Y[j + 1], -dy / l, dx / l, xo0, xo1);
    }
    // back plate
    strip(b, rA, rB, 0.075, y0 + 0.31, 0.075, y0, 1, 0, xo0, xo1);
  }
}

/**
 * Light poles (CircuitDef.trackside.lights): a 12 m galvanised mast behind the barrier with an
 * arm reaching over the fence and a floodlight head angled down at the track.
 */
export function buildLightPoles(ctx: Ctx) {
  const t = ctx.track;
  const n = ctx.n;
  for (const run of ctx.dress.lights ?? []) {
    const P = ctx.side(run.side);
    const len = ((run.to - run.from) % n + n) % n;
    const step = Math.max(20, run.spacing ?? 50);
    for (let d = step / 2; d < len; d += step) {
      const s = run.from + d;
      const i = ctx.wrap(Math.floor(s));
      if (P.kind[i] === 'none' || P.gate[i]) continue;
      const x = P.bar[i] + P.backOff[i] + (P.fence[i] ? 1.6 : 1.0);
      if (ctx.clear[i] < x + 3) continue;
      const props = ctx.cs.get(s, 'props');
      const fr = t.frame(s);
      t.point(s, run.side * x, 0, FR.o);
      FR.setHorizontal(FR.o, fr.tangent.x, fr.tangent.z);
      const X = (v: number) => -run.side * v; // v > 0 → toward the track
      const H = 12;
      props.color(0x9da2a7).mat(0.42, 0.8, 0);
      cylinder(props, FR, 0, -0.6, 0, 0.16, H * 0.55, 8, false);
      cylinder(props, FR, 0, H * 0.55, 0, 0.11, H, 8, true);
      props.color(0x7d8186).mat(0.6, 0.3, 0);
      cylinder(props, FR, 0, -0.6, 0, 0.3, 0.25, 8, true);
      // arm and head
      props.color(0x9da2a7).mat(0.42, 0.8, 0);
      FR.p(0, H - 0.2, 0, V[0]);
      FR.p(X(2.2), H + 0.25, 0, V[1]);
      beam(props, V[0], V[1], 0.09, 0.09);
      props.color(0x2a2d31).mat(0.45, 0.5, 0);
      box(props, FR, X(2.45), H + 0.12, 0, 0.9, 0.22, 0.5, 0b111111);
      props.color(0xe8ecef).mat(0.2, 0, 0.35);
      box(props, FR, X(2.45), H - 0.005, 0, 0.78, 0.02, 0.4, 0b001000);
    }
  }
}

export { BELTS };
