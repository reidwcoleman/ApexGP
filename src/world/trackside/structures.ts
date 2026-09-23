import * as THREE from 'three';
import { VERGE } from '../Track.ts';
import { Frame3, beam, box, cylinder, disc, printQuadX, printQuadZ, type GeoBuilder } from './builder.ts';
import type { Ctx } from './context.ts';
import { SPONSORS, type PrintAtlas } from './atlas.ts';

/**
 * Bigger trackside structures: the start gantry with its five light columns,
 * advertising bridges, marshal posts, TV camera platforms, braking distance
 * boards, DRS signs and a few sausage kerbs.
 */

const F = new Frame3();
const A = new THREE.Vector3(), B = new THREE.Vector3();

function frameAt(ctx: Ctx, s: number, lat: number, f = F): Frame3 {
  const t = ctx.track;
  const fr = t.frame(s);
  const o = t.point(s, lat, 0, new THREE.Vector3());
  return f.setHorizontal(o, fr.tangent.x, fr.tangent.z);
}

/** lattice column from y0 to y1 with a square footprint `w` */
function latticeColumn(b: GeoBuilder, f: Frame3, x: number, z: number, w: number, y0: number, y1: number, tube = 0.1) {
  const h = w / 2;
  const corners: [number, number][] = [[-h, -h], [h, -h], [h, h], [-h, h]];
  for (const [cx, cz] of corners) box(b, f, x + cx, (y0 + y1) / 2, z + cz, tube, y1 - y0, tube, 0b110111);
  const step = 1.0;
  for (let y = y0 + 0.4; y < y1 - 0.2; y += step) {
    for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k];
      const [bx, bz] = corners[(k + 1) % 4];
      f.p(x + ax, y, z + az, A);
      f.p(x + bx, y + step * 0.9, z + bz, B);
      beam(b, A, B, tube * 0.5, tube * 0.5);
    }
  }
}

/** horizontal box truss along local x from x0 to x1, bottom y0, height h, depth d (z −d/2..d/2) */
function truss(b: GeoBuilder, f: Frame3, x0: number, x1: number, y0: number, h: number, d: number, tube = 0.13) {
  const L = x1 - x0;
  const cx = (x0 + x1) / 2;
  for (const y of [y0, y0 + h]) for (const z of [-d / 2, d / 2]) box(b, f, cx, y, z, L, tube, tube, 0b111111);
  const n = Math.max(2, Math.round(L / 1.5));
  for (let k = 0; k <= n; k++) {
    const x = x0 + (L * k) / n;
    for (const z of [-d / 2, d / 2]) box(b, f, x, y0 + h / 2, z, tube * 0.6, h, tube * 0.6, 0b110011);
    box(b, f, x, y0 + h, 0, tube * 0.6, tube * 0.6, d, 0b111100);
    if (k < n) {
      const xn = x0 + (L * (k + 1)) / n;
      for (const z of [-d / 2, d / 2]) {
        f.p(x, k % 2 ? y0 : y0 + h, z, A);
        f.p(xn, k % 2 ? y0 + h : y0, z, B);
        beam(b, A, B, tube * 0.45, tube * 0.45);
      }
    }
  }
}

export function buildStructures(ctx: Ctx, atlas: PrintAtlas) {
  buildGantry(ctx, atlas);
  const t = ctx.track;
  const seg = t.data.segStart;
  if (seg[10] !== undefined) buildBridge(ctx, atlas, seg[10] + 200, 0);
  if (seg[20] !== undefined) buildBridge(ctx, atlas, seg[20] + 110, 1);
  buildMarshalPosts(ctx);
  buildCameras(ctx);
  buildBoards(ctx, atlas);
  buildSausages(ctx);
}

// ------------------------------------------------------------------ start gantry

function buildGantry(ctx: Ctx, atlas: PrintAtlas) {
  const t = ctx.track;
  const s = t.startS + 12;
  const cs = ctx.cs;
  const props = cs.get(s, 'props');
  const print = cs.get(s, 'print');
  const lamps = cs.get(s, 'lamp');
  const i = ctx.wrap(Math.floor(s));
  const pit = t.pit;
  const Lp = ctx.side(-pit.side), Rp = ctx.side(pit.side);
  // leg positions (local x = right of travel)
  const farX = -pit.side * (Lp.bar[i] + Lp.backOff[i] + 1.4);
  const wallX = pit.side * (pit.wallOffset + 0.3);
  void Rp;
  const x0 = Math.min(farX, wallX), x1 = Math.max(farX, wallX);
  frameAt(ctx, s, 0);
  const ground = (x: number) => t.point(s, x, 0, A).y - F.o.y;
  const TOP = 8.4, BOT = 7.1;

  props.color(0x1d1f23).mat(0.45, 0.75, 0);
  latticeColumn(props, F, farX, 0, 0.8, ground(farX), TOP + 0.1, 0.12);
  latticeColumn(props, F, wallX, 0, 0.5, ground(wallX) + 1.1, TOP + 0.1, 0.1);
  // base plates
  props.color(0x6d6f72).mat(0.8, 0.2, 0);
  box(props, F, farX, ground(farX) + 0.15, 0, 1.2, 0.3, 1.2);
  truss(props, F, x0 - 0.3, x1 + 0.3, BOT, TOP - BOT, 1.0, 0.14);

  // sponsor banner across the truss, both faces
  const cell = atlas.cell('gantry');
  print.rgb(1, 1, 1).mat(0.5, 0, 0.35);
  const w = 4.8;
  const nb = Math.floor((x1 - x0 - 0.8) / w);
  const bx0 = (x0 + x1) / 2 - (nb * w) / 2;
  for (let k = 0; k < nb; k++) {
    const x = bx0 + k * w;
    const c = k % 2 === 0 ? cell : atlas.cell('ad' + [6, 0, 14, 10, 2][((k - 1) / 2) % 5]);
    printQuadZ(print, F, -0.56, x, x + w, BOT + 0.02, TOP - 0.02, -1, c);
    printQuadZ(print, F, 0.56, x, x + w, BOT + 0.02, TOP - 0.02, 1, c);
  }
  // timing screen above the centre
  props.color(0x15171a).mat(0.5, 0.5, 0);
  box(props, F, 0, TOP + 1.25, 0.12, 7.6, 2.1, 0.3, 0b111111);
  for (const x of [-3.2, 3.2]) box(props, F, x, TOP + 0.1, 0.12, 0.15, 0.4, 0.15);
  print.rgb(1, 1, 1).mat(0.3, 0, 1.6);
  printQuadZ(print, F, -0.04, -3.6, 3.6, TOP + 0.3, TOP + 2.2, -1, atlas.cell('screen'));
  print.mat(0.5, 0, 0.3);
  printQuadZ(print, F, 0.28, -3.6, 3.6, TOP + 0.3, TOP + 2.2, 1, atlas.cell('gantry'));

  // five light columns hanging under the truss, facing the grid (−z)
  const cols = [-2.4, -1.2, 0, 1.2, 2.4];
  cols.forEach((cx, c) => {
    props.color(0x0b0b0c).mat(0.4, 0.3, 0);
    box(props, F, cx, BOT - 1.05, -0.35, 0.62, 2.0, 0.34, 0b111111);
    box(props, F, cx, BOT - 0.02, -0.35, 0.12, 0.08, 0.12);
    for (let r = 0; r < 4; r++) {
      const y = BOT - 0.35 - r * 0.45;
      // visor
      props.color(0x050505).mat(0.5, 0.2, 0);
      box(props, F, cx, y + 0.2, -0.62, 0.42, 0.03, 0.22, 0b111111);
      // lamp: the top two are the red pair driven by StartLights; the rest stay dark
      lamps.s0[0] = r < 2 ? c : 9;
      disc(lamps, F, cx, y, -0.525, 0.15, 14, -1);
    }
  });
}

// ------------------------------------------------------------------ advertising bridges

function buildBridge(ctx: Ctx, atlas: PrintAtlas, s: number, salt: number) {
  const t = ctx.track;
  const i = ctx.wrap(Math.floor(s));
  const props = ctx.cs.get(s, 'props');
  const print = ctx.cs.get(s, 'print');
  const L = ctx.L, R = ctx.R;
  const xl = -(L.bar[i] + L.backOff[i] + 1.6);
  const xr = R.bar[i] + R.backOff[i] + 1.6;
  frameAt(ctx, s, 0);
  const ground = (x: number) => t.point(s, x, 0, A).y - F.o.y;
  const Y0 = 6.1, H = 1.3, D = 1.8;
  props.color(0xe6e6e2).mat(0.5, 0.3, 0);
  for (const x of [xl, xr]) {
    for (const z of [-0.7, 0.7]) box(props, F, x, (ground(x) + Y0 + H) / 2, z, 0.45, Y0 + H - ground(x), 0.45, 0b110111);
    box(props, F, x, Y0 - 0.9, 0, 0.3, 0.3, 1.8);
    props.color(0x8a8c8e).mat(0.8, 0.1, 0);
    box(props, F, x, ground(x) + 0.2, 0, 1.4, 0.4, 2.4);
    props.color(0xe6e6e2).mat(0.5, 0.3, 0);
  }
  // deck: a box girder
  props.color(0x2b2e33).mat(0.55, 0.4, 0);
  box(props, F, (xl + xr) / 2, Y0 + H / 2, 0, xr - xl + 0.6, H, D, 0b111111);
  // printed faces
  const w = 5.2;
  const count = Math.floor((xr - xl - 0.8) / w);
  const start = (xl + xr) / 2 - (count * w) / 2;
  print.rgb(1, 1, 1).mat(0.55, 0, 0.25);
  for (let k = 0; k < count; k++) {
    const cellA = atlas.cell('ad' + ((k + salt * 5) % SPONSORS.length));
    const cellB = atlas.cell('ad' + ((k * 7 + 3 + salt * 3) % SPONSORS.length));
    printQuadZ(print, F, -D / 2 - 0.02, start + k * w + 0.05, start + (k + 1) * w - 0.05, Y0 + 0.05, Y0 + H - 0.05, -1, cellA);
    printQuadZ(print, F, D / 2 + 0.02, start + k * w + 0.05, start + (k + 1) * w - 0.05, Y0 + 0.05, Y0 + H - 0.05, 1, cellB);
  }
  // railings on top
  props.color(0xc9cbcd).mat(0.4, 0.7, 0);
  for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) {
    box(props, F, (xl + xr) / 2, Y0 + H + 1.0, z, xr - xl, 0.05, 0.05, 0b111111);
    for (let x = xl; x <= xr; x += 2) box(props, F, x, Y0 + H + 0.5, z, 0.05, 1.0, 0.05, 0b110011);
  }
}

// ------------------------------------------------------------------ marshal posts

function buildMarshalPosts(ctx: Ctx) {
  const t = ctx.track;
  const n = ctx.n;
  let side = -1;
  let post = 0;
  for (let s = 180; s < n - 100; s += 350) {
    side = -side;
    let P = ctx.side(side);
    let i = ctx.wrap(s);
    if (P.kind[i] === 'pitwall' || P.pitZone[i]) {
      side = -side;
      P = ctx.side(side);
    }
    i = ctx.wrap(s);
    if (ctx.clear[i] < P.bar[i] + 8) continue;
    const off = P.bar[i] + P.backOff[i] + 2.0;
    const props = ctx.cs.get(s, 'props');
    frameAt(ctx, s, side * off);
    const X = (v: number) => -side * v; // v > 0 → toward the track
    // slab (reaching down so it sits on terrain that may be lower than the run-off)
    props.color(0x9a9892).mat(0.9, 0, 0);
    box(props, F, 0, -0.62, 0, 2.2, 1.56, 2.8, 0b111111);
    // cabin
    props.color(0xe9e7e1).mat(0.6, 0, 0);
    box(props, F, X(-0.2), 1.25, 0, 1.5, 2.2, 2.2);
    props.color(0xe8641c).mat(0.55, 0, 0);
    box(props, F, X(-0.2), 1.9, 0, 1.52, 0.18, 2.22, 0b110011);
    // window band facing the track
    props.color(0x1a232c).mat(0.1, 0.1, 0);
    box(props, F, X(0.56), 1.55, 0, 0.04, 0.6, 1.9, 0b110011);
    // roof
    props.color(0xe8641c).mat(0.6, 0.1, 0);
    box(props, F, X(-0.1), 2.42, 0, 2.0, 0.12, 2.7, 0b111111);
    // flag-light panel on a pole at the barrier, facing oncoming cars
    const pole = P.backOff[i] + 0.35;
    frameAt(ctx, s + 1, side * (P.bar[ctx.wrap(s + 1)] + pole));
    props.color(0x2d2f33).mat(0.5, 0.6, 0);
    box(props, F, 0, 1.4, 0, 0.1, 2.8, 0.1);
    props.color(0x111111).mat(0.5, 0.2, 0);
    box(props, F, X(0.25), 2.8, -0.02, 1.0, 0.7, 0.12, 0b111111);
    props.color(0x19ff4a).mat(0.4, 0, 3.2);
    box(props, F, X(0.25), 2.8, -0.085, 0.86, 0.56, 0.02, 0b100000);
    // post number
    post++;
  }
}

// ------------------------------------------------------------------ TV camera platforms

function buildCameras(ctx: Ctx) {
  const t = ctx.track;
  const names = ['Faro', 'Horquilla del Puerto', 'Lonja', 'Curva Grande', 'Bus Stop', 'Parabólica', 'Mirador'];
  for (const c of t.corners) {
    if (!names.includes(c.name)) continue;
    const side = c.dir;
    const s = c.sApex;
    const i = ctx.wrap(s);
    const P = ctx.side(side);
    const off = P.bar[i] + P.backOff[i] + 1.9;
    const props = ctx.cs.get(s, 'props');
    frameAt(ctx, s, side * off);
    const H = 3.6;
    props.color(0x9ea3a8).mat(0.45, 0.8, 0);
    for (const x of [-0.75, 0.75]) for (const z of [-0.75, 0.75]) box(props, F, x, (H + 1.1 - 1.5) / 2, z, 0.06, H + 1.1 + 1.5, 0.06, 0b110011);
    for (let y = 0.9; y < H; y += 0.9) {
      box(props, F, 0, y, -0.75, 1.5, 0.05, 0.05, 0b111111);
      box(props, F, 0, y, 0.75, 1.5, 0.05, 0.05, 0b111111);
      box(props, F, -0.75, y, 0, 0.05, 0.05, 1.5, 0b111111);
      box(props, F, 0.75, y, 0, 0.05, 0.05, 1.5, 0b111111);
    }
    props.color(0x6b5a44).mat(0.85, 0, 0);
    box(props, F, 0, H, 0, 1.7, 0.08, 1.7, 0b111111);
    props.color(0xd6d8da).mat(0.4, 0.7, 0);
    box(props, F, 0, H + 1.05, -0.8, 1.6, 0.05, 0.05, 0b111111);
    box(props, F, 0, H + 1.05, 0.8, 1.6, 0.05, 0.05, 0b111111);
    box(props, F, -0.8, H + 1.05, 0, 0.05, 0.05, 1.6, 0b111111);
    box(props, F, 0.8, H + 1.05, 0, 0.05, 0.05, 1.6, 0b111111);
    // tripod + camera pointing at the track
    const X = (v: number) => -side * v;
    props.color(0x1b1c1e).mat(0.5, 0.3, 0);
    box(props, F, X(0.1), H + 0.75, 0, 0.08, 1.4, 0.08);
    box(props, F, X(0.15), H + 1.55, 0, 0.55, 0.32, 0.26, 0b111111);
    const lensF = new Frame3().copy(F);
    // lens: short cylinder along the toward-track axis
    F.p(X(0.15), H + 1.55, 0, lensF.o);
    lensF.y.copy(F.x).multiplyScalar(-side);
    lensF.x.copy(F.y);
    cylinder(props, lensF, 0, 0.25, 0, 0.09, 0.62, 10);
    // operator: torso + head
    props.color(0xf2f2f2).mat(0.8, 0, 0);
    box(props, F, X(-0.45), H + 0.8, 0, 0.35, 0.75, 0.45);
    props.color(0xc58d6b).mat(0.7, 0, 0);
    box(props, F, X(-0.45), H + 1.35, 0, 0.22, 0.26, 0.22, 0b111111);
    // umbrella
    props.color(0x1d4f9c).mat(0.7, 0, 0);
    box(props, F, 0, H + 2.4, 0, 1.9, 0.05, 1.9, 0b111111);
    box(props, F, 0, H + 1.8, 0.7, 0.04, 1.3, 0.04);
  }
}

// ------------------------------------------------------------------ distance boards + DRS signs

function buildBoards(ctx: Ctx, atlas: PrintAtlas) {
  const t = ctx.track;
  const board = (s: number, side: number, cellIdx: number, cellName: string, size: number, yBase: number) => {
    const i = ctx.wrap(Math.floor(s));
    const P = ctx.side(side);
    const x = P.bar[i] + P.backOff[i] + 0.32;
    const props = ctx.cs.get(s, 'props');
    const print = ctx.cs.get(s, 'print');
    frameAt(ctx, s, side * x);
    F.yaw(side * 0.26); // turn the face a little toward the track
    props.color(0x8d9196).mat(0.4, 0.8, 0);
    for (const px of [-size * 0.35, size * 0.35]) box(props, F, px, (yBase + 0.1) / 2, 0.06, 0.07, yBase + 0.1, 0.07);
    props.color(0x202020).mat(0.6, 0.2, 0);
    box(props, F, 0, yBase + size / 2, 0.035, size + 0.04, size + 0.04, 0.04, 0b111111);
    print.rgb(1, 1, 1).mat(0.5, 0, 0.15);
    printQuadZ(print, F, 0, -size / 2, size / 2, yBase, yBase + size, -1, atlas.sub(cellName, cellIdx * 0.25, cellIdx * 0.25 + 0.25, 0, 1));
  };
  const big = ['Faro', 'Horquilla del Puerto', 'Lonja', 'Bus Stop', 'Mirador', 'Parabólica'];
  t.corners.forEach((c, ci) => {
    if (!big.includes(c.name)) return;
    const ref = c.sStart + 12;
    const prev = t.corners[(ci - 1 + t.corners.length) % t.corners.length];
    const straight = t.delta(prev.sEnd, c.sStart); // length of the approach
    const side = c.dir; // outside of the corner = the side you brake on
    [[100, 0], [200, 1], [300, 2]].forEach(([d, k]) => {
      if (d + 30 < straight) board(ref - d, side, k, 'boards', 1.15, 1.35);
    });
    if ((c.name === 'Faro' || c.name === 'Bus Stop') && straight > 80) board(ref - 50, side, 3, 'boards', 1.0, 1.35);
  });
  for (const z of t.drs) {
    board(z.detect - 2, -1, 1, 'signs', 1.2, 2.0);
    board(z.start - 2, -1, 0, 'signs', 1.2, 2.0);
  }
}

// ------------------------------------------------------------------ sausage kerbs

function buildSausages(ctx: Ctx) {
  const t = ctx.track;
  for (const c of t.corners) {
    if (!c.name.startsWith('Bus Stop')) continue;
    const inside = -c.dir;
    const P = ctx.side(inside);
    for (const ds of [-4, 2.5]) {
      const s0 = c.sApex + ds;
      const i = ctx.wrap(Math.floor(s0));
      const lat = inside * (t.halfWidth[i] + P.kerb[i] + VERGE * 0.4);
      const props = ctx.cs.get(s0, 'props');
      props.color(0xf2c200).mat(0.55, 0, 0);
      // half-round profile swept along 2.4 m of track with tapered ends
      const N = 7;
      const segs = 6;
      const len = 2.4;
      const base = props.count;
      for (let r = 0; r <= segs; r++) {
        const f = r / segs;
        const s = s0 + f * len;
        const taper = Math.min(1, f / 0.2, (1 - f) / 0.2);
        const fr = t.frame(s);
        for (let k = 0; k <= N; k++) {
          const a = (k / N) * Math.PI;
          const lx = Math.cos(a) * 0.16;
          const ly = Math.sin(a) * 0.1 * taper;
          const p = t.point(s, lat + lx, ly, A);
          const nx = fr.right.x * Math.cos(a) + fr.up.x * Math.sin(a);
          const ny = fr.right.y * Math.cos(a) + fr.up.y * Math.sin(a);
          const nz = fr.right.z * Math.cos(a) + fr.up.z * Math.sin(a);
          props.v(p.x, p.y, p.z, nx, ny, nz);
        }
      }
      const up = t.frame(s0).up;
      for (let r = 0; r < segs; r++)
        for (let k = 0; k < N; k++) {
          const a = base + r * (N + 1) + k;
          props.quadN(a, a + 1, a + N + 2, a + N + 1, up.x, up.y, up.z);
        }
    }
  }
}

export { printQuadX };
