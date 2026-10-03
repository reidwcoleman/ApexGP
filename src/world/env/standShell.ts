import * as THREE from 'three';
import { MeshBuilder, srgb } from './geom.ts';
import type { GrandstandSpec } from './layout.ts';
import { STAND_ROW_DEPTH, STAND_ROW_RISE } from './layout.ts';
import type { Venue } from './worldmap.ts';
import { ARCH, member, tagClass } from './archMaterial.ts';

/**
 * One grandstand segment, built in its own frame (x along the stand, y up, local −z toward the
 * track, the front wall at z = 0), the way the real ones are put together:
 *
 *   bowl        front wall with a steel balustrade, raked concrete terraces, moulded seat rows
 *               (ARCH.SEAT: individual seats in the shader), aisles every ~26 m with two steps
 *               per row, yellow nosings and a centre handrail
 *   centrale    the main stand: a glazed hospitality level between the tiers (interior-mapped
 *               glass, the same as the pit building's), a slab with a printed band
 *   roof        profiled-sheet deck (ARCH.CLAD ribs) or a PVC membrane, carried on cantilever
 *               trusses (top + bottom chord, zig-zag web) from back columns with kicker braces,
 *               purlins and plan bracing under the deck, a fascia girder with the sponsor band,
 *               speaker / floodlight clusters along the front
 *   back        concrete back wall with a steel frame, profiled cladding above the top ledge,
 *               open steel stair towers, entrances; open stands are temporary scaffold structures
 *               (standards, ledgers, X-braced bays, a scrim) instead
 *   venue       the main stand's roof has the venue's character: Spa's and Yas Marina's bowed white
 *               roofs, Silverstone's and Sakhir's tensioned membranes, Suzuka's deep front girder
 *
 * Everything is tagged by ARCH class (archMaterial) and merged per circuit into two meshes: the
 * structure (casts shadows) and the slender parts (seats, rails, truss webs, bracing, stairs: no
 * shadow, dropped in the vertex stage beyond ~180 m). Two draw calls for every stand on the lap.
 */

export interface Person { m: THREE.Matrix4; c: THREE.Color; shade: number; s?: number }
export interface Flag { m: THREE.Matrix4; design: number; big: number; s?: number }

/** a glazed band in the stand's frame (corners bottom-left, bottom-right, top-right, top-left, facing −z) */
export interface StandGlass {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  d: THREE.Vector3;
  x0: number;
  x1: number;
  floor: number;
  ceil: number;
  depth: number;
}

export interface StandCtx {
  venue: Venue;
  r: () => number;
  fanColor: () => THREE.Color;
  flagDesign: () => number;
  sponsor: () => [number, number, number, number];
  seats: number[][];
}

interface Builders {
  /** where geometry goes right now (set by `as`) */
  cur: MeshBuilder;
  mb: MeshBuilder;
  fine: MeshBuilder;
  as: (cls: number, fn: () => void, slim?: boolean) => void;
}

export interface StandShell {
  arch: MeshBuilder;
  /** slender parts: drawn, but cast no shadow */
  fine: MeshBuilder;
  boards: MeshBuilder;
  glass: StandGlass[];
  people: Person[];
  flags: Flag[];
  depth: number;
}

const CONCRETE = srgb(0xb9b4aa);
const CONCRETE_TREAD = srgb(0xc4c0b8);
const CONCRETE_DARK = srgb(0x8f8b84);
const STEEL = srgb(0xe6e7e8);
const STEEL_MID = srgb(0x9a9ea4);
const STEEL_DARK = srgb(0x4a4e55);
const CLAD = srgb(0xb4b8bc);
const ROOF_DECK = srgb(0xd8dadb);
const MEMBRANE = srgb(0xf1f0eb);
const SCRIM = srgb(0x2b2f35);
const NOSING = srgb(0xe8c21a);
const VOID = srgb(0x15171a);
const LAMP = srgb(0x2a2c30);

type RoofKind = 'truss' | 'bowed' | 'membrane' | 'girder';

function roofKindOf(g: GrandstandSpec, venue: Venue): RoofKind {
  const main = g.style === 'centrale';
  if (venue === 'airfield' || venue === 'sakhir') return 'membrane';
  if (main && (venue === 'ardennes' || venue === 'yasmarina')) return 'bowed';
  if (main && venue === 'suzuka') return 'girder';
  return 'truss';
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function buildStandShell(g: GrandstandSpec, k: StandCtx): StandShell {
  const r = k.r;
  const L = g.length;
  const rows = g.rows;
  const D = STAND_ROW_DEPTH, R = STAND_ROW_RISE;
  const z0 = 0.4;
  const yBase = 1.9;
  const centrale = g.style === 'centrale';
  const open = !g.roof;
  const scheme = k.seats[g.group % k.seats.length].map((h) => srgb(h));
  const lowerRows = centrale ? Math.round(rows * 0.45) : rows;
  const bandH = centrale ? 3.6 : 0;
  const bandD = centrale ? 2.2 : 0;
  const rowY = (i: number) => yBase + i * R + (i >= lowerRows ? bandH : 0);
  const rowZ = (i: number) => z0 + i * D + (i >= lowerRows ? bandD : 0);
  const depth = rowZ(rows - 1) + D + 0.8;
  const top = rowY(rows - 1) + R;

  const mb = new MeshBuilder();
  // slender parts (seats, rails, webs, bracing, stairs) go in their own mesh that casts no shadow
  const fine = new MeshBuilder();
  const B: Builders = { cur: mb, mb, fine, as: () => {} };
  const boards = new MeshBuilder();
  const glass: StandGlass[] = [];
  const people: Person[] = [];
  const flags: Flag[] = [];
  /** build with `fn`, then tag what it added as class `cls` */
  const as = (cls: number, fn: () => void, slim = false) => {
    const prev = B.cur;
    B.cur = slim ? fine : mb;
    const v0 = B.cur.vertexCount;
    fn();
    tagClass(B.cur, v0, cls);
    B.cur = prev;
  };
  B.as = as;
  const box = (x0: number, y0: number, za: number, x1: number, y1: number, zb: number, c: THREE.Color, o: { skipBottom?: boolean; skipTop?: boolean } = {}) =>
    B.cur.aabb(x0, y0, za, x1, y1, zb, c, o);
  const bar = (a: THREE.Vector3, b: THREE.Vector3, w: number, c: THREE.Color, t = w) => member(B.cur, a, b, w, t, c);

  // ---------------------------------------------------------------- bowl
  as(ARCH.CONCRETE, () => {
    box(-L / 2, -3, 0, L / 2, yBase + 0.1, z0, CONCRETE);
    // a darker plinth where the wall meets the ground (splash, tyre-dust)
    box(-L / 2 - 0.01, -3, -0.01, L / 2 + 0.01, 0.35, z0, CONCRETE_DARK, { skipTop: true });
    for (let i = 0; i < rows; i++) {
      const y = rowY(i), za = rowZ(i);
      box(-L / 2, y - R - (i === lowerRows ? bandH : 0) - 0.25, za, L / 2, y, za + D, i % 2 ? CONCRETE : CONCRETE_TREAD, { skipBottom: true });
    }
  });
  // balustrade on the front wall: posts, top rail, mid rail
  as(ARCH.STEEL, () => {
    const yr = yBase + 0.1;
    for (let x = -L / 2 + 0.6; x <= L / 2 - 0.5; x += 2.4) box(x - 0.03, yr, 0.12, x + 0.03, yr + 1.0, 0.18, STEEL_MID);
    box(-L / 2, yr + 0.97, 0.1, L / 2, yr + 1.03, 0.2, STEEL_MID);
    box(-L / 2, yr + 0.5, 0.13, L / 2, yr + 0.53, 0.17, STEEL_MID, { skipBottom: true });
  }, true);

  if (centrale) {
    // hospitality band: interior-mapped glass set back under the upper tier, a slab above
    const zb = rowZ(lowerRows - 1) + D;
    const yb = rowY(lowerRows - 1);
    const n = Math.max(1, Math.ceil(L / 6));
    for (let q = 0; q < n; q++) {
      const xa = -L / 2 + (q * L) / n, xb = -L / 2 + ((q + 1) * L) / n;
      // (wound so the face looks toward the track, −z)
      glass.push({ a: V(xb, yb + 0.2, zb + 0.9), b: V(xa, yb + 0.2, zb + 0.9), c: V(xa, yb + bandH - 0.3, zb + 0.9), d: V(xb, yb + bandH - 0.3, zb + 0.9), x0: xb, x1: xa, floor: yb + 0.2, ceil: yb + bandH - 0.3, depth: 9 });
    }
    as(ARCH.CONCRETE, () => {
      box(-L / 2, yb + bandH - 0.35, zb - 0.2, L / 2, yb + bandH + 0.05, zb + bandD, CONCRETE);
      box(-L / 2, yb, zb, L / 2, yb + 0.2, zb + 1.2, CONCRETE_DARK);
    });
    as(ARCH.STEEL, () => {
      for (let x = -L / 2; x <= L / 2; x += 1.5) box(x - 0.04, yb + 0.2, zb + 0.82, x + 0.04, yb + bandH - 0.3, zb + 0.95, STEEL_DARK);
      box(-L / 2, yb + 1.0, zb - 0.05, L / 2, yb + 1.08, zb + 0.05, STEEL);
      for (let x = -L / 2 + 0.75; x < L / 2; x += 1.5) box(x - 0.02, yb + 0.2, zb - 0.03, x + 0.02, yb + 1.0, zb + 0.03, STEEL);
    }, true);
    // sponsor band on the slab edge
    // (each sponsor's stretch repeats its logo at the board's own 8:1 proportions, as a printed
    // band does, instead of one logo stretched seven times too wide)
    const nB = Math.max(1, Math.round(L / 20));
    for (let q = 0; q < nB; q++) {
      const xa = -L / 2 + (q * L) / nB + 0.2, xb = xa + L / nB - 0.4;
      const uvB = k.sponsor();
      const reps = Math.max(1, Math.round((xb - xa) / (0.36 * 8)));
      for (let rr = 0; rr < reps; rr++) {
        const x0 = xa + ((xb - xa) * rr) / reps, x1 = xa + ((xb - xa) * (rr + 1)) / reps;
        boards.quad4(V(x1, yb + bandH - 0.33, zb - 0.22), V(x0, yb + bandH - 0.33, zb - 0.22), V(x0, yb + bandH + 0.03, zb - 0.22), V(x1, yb + bandH + 0.03, zb - 0.22), new THREE.Color(1, 1, 1), uvB);
      }
    }
  }

  // ---------------------------------------------------------------- side walls (the raked ends)
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -L / 2 - (open ? 0.12 : 0.4) : L / 2;
    const x1 = x0 + (open ? 0.12 : 0.4);
    as(open ? ARCH.FABRIC : ARCH.CONCRETE, () => B.cur.prismX([[-0.05, -3], [depth + 0.05, -3], [depth + 0.05, top + 1.4], [-0.05, yBase + 0.9]], x0, x1, open ? SCRIM : CONCRETE));
    // raking handrail along the top of the end wall, on posts
    const xr = sx * (L / 2 + (open ? 0.06 : 0.2));
    as(ARCH.STEEL, () => {
      bar(V(xr, yBase + 1.9, -0.05), V(xr, top + 2.4, depth + 0.05), 0.06, STEEL_MID);
      for (let q = 0; q <= 4; q++) {
        const t = q / 4;
        const z = -0.05 + t * (depth + 0.1);
        const y = yBase + 0.9 + t * (top + 0.5 - yBase);
        box(xr - 0.03, y, z - 0.03, xr + 0.03, y + 1.0, z + 0.03, STEEL_MID);
      }
      if (open) {
        // scaffold standards and a brace on the outside of the scrim
        const xo = sx * (L / 2 + 0.2);
        const nS = Math.max(2, Math.ceil(depth / 2.5));
        for (let q = 0; q <= nS; q++) {
          const z = (q / nS) * depth;
          const yTop = yBase + 0.9 + (z / depth) * (top + 0.5 - yBase);
          box(xo - 0.035, -1, z - 0.035, xo + 0.035, yTop, z + 0.035, STEEL_MID);
          if (q < nS) {
            const zn = ((q + 1) / nS) * depth;
            bar(V(xo, 0.1, z), V(xo, Math.min(yTop, yBase + 0.9 + (zn / depth) * (top + 0.5 - yBase)) - 0.2, zn), 0.05, STEEL_MID);
          }
        }
      }
    }, true);
  }

  // ---------------------------------------------------------------- seats, aisles, crowd, flags
  const blocks = Math.max(1, Math.round(L / 26));
  const bw = L / blocks;
  const occ = centrale ? 0.94 : g.style === 'covered' ? 0.9 : 0.86;
  for (let b = 0; b < blocks; b++) {
    const xa = -L / 2 + b * bw + 0.7;
    const xb = -L / 2 + (b + 1) * bw - 0.7;
    for (let i = 0; i < rows; i++) {
      const y = rowY(i), za = rowZ(i);
      const c = scheme[(b + (i > rows * 0.6 ? 1 : 0) + (i >= lowerRows ? 2 : 0)) % scheme.length];
      // seat row: backs (tall, thin) and the pans in front of them
      as(ARCH.SEAT, () => {
        box(xa, y, za + D * 0.6, xb, y + 0.46, za + D * 0.7, c, { skipBottom: true });
        box(xa, y + 0.22, za + D * 0.3, xb, y + 0.3, za + D * 0.6, c, { skipBottom: true });
      }, true);
      for (let x = xa + 0.3; x < xb - 0.3; x += 0.6) {
        if (r() > occ) continue;
        const m = new THREE.Matrix4().makeTranslation(x + (r() - 0.5) * 0.12, y + 0.02, za + D * 0.42);
        const covered = g.roof && i > 2 ? 0.6 + 0.1 * r() : 1;
        people.push({ m, c: k.fanColor(), shade: covered });
        if (r() < 0.016) flags.push({ m: new THREE.Matrix4().makeTranslation(x, y + 1.9, za + D * 0.3), design: k.flagDesign(), big: 0 });
      }
    }
    if (b > 0) {
      // aisle: two steps per row, yellow nosings, a handrail up the middle
      const xa2 = -L / 2 + b * bw - 0.7, xc = xa2 + 0.7;
      // (top and front faces only: an aisle is a few hundred rows across a circuit)
      const top4 = (x0: number, x1: number, y: number, za: number, zb: number, c: THREE.Color) => B.cur.quad4(V(x0, y, zb), V(x1, y, zb), V(x1, y, za), V(x0, y, za), c);
      const front4 = (x0: number, x1: number, y0: number, y1: number, z: number, c: THREE.Color) => B.cur.quad4(V(x1, y0, z), V(x0, y0, z), V(x0, y1, z), V(x1, y1, z), c);
      as(ARCH.CONCRETE, () => {
        for (let i = 0; i < rows; i++) {
          const y = rowY(i), za = rowZ(i);
          top4(xa2, xa2 + 1.4, y + 0.01, za, za + D * 0.5, CONCRETE_TREAD);
          if (i < rows - 1 && i !== lowerRows - 1) {
            front4(xa2 + 0.02, xa2 + 1.38, y, y + R * 0.5, za + D * 0.5, CONCRETE_TREAD);
            top4(xa2 + 0.02, xa2 + 1.38, y + R * 0.5, za + D * 0.5, za + D, CONCRETE_TREAD);
          } else top4(xa2, xa2 + 1.4, y + 0.01, za + D * 0.5, za + D, CONCRETE_TREAD);
        }
      }, true);
      as(ARCH.PLAIN, () => {
        for (let i = 0; i < rows; i++) {
          const y = rowY(i), za = rowZ(i);
          top4(xa2, xa2 + 1.4, y + 0.015, za, za + 0.07, NOSING);
          if (i < rows - 1 && i !== lowerRows - 1) top4(xa2 + 0.02, xa2 + 1.38, y + R * 0.5 + 0.005, za + D * 0.5, za + D * 0.5 + 0.07, NOSING);
        }
      }, true);
      as(ARCH.STEEL, () => {
        const runs: [number, number][] = centrale ? [[0, lowerRows - 1], [lowerRows, rows - 1]] : [[0, rows - 1]];
        for (const [i0, i1] of runs) {
          if (i1 - i0 < 2) continue;
          bar(V(xc, rowY(i0) + 0.95, rowZ(i0) + 0.2), V(xc, rowY(i1) + 0.95, rowZ(i1) + 0.2), 0.05, STEEL_MID);
          for (let i = i0; i <= i1; i += 3) box(xc - 0.025, rowY(i), rowZ(i) + 0.18, xc + 0.025, rowY(i) + 0.95, rowZ(i) + 0.23, STEEL_MID);
        }
      }, true);
    }
  }
  // fan banners hung on the front wall
  {
    const nB = Math.max(1, Math.round(L / 16));
    const w = L / nB;
    for (let q = 0; q < nB; q++) {
      const xa = -L / 2 + q * w + 0.15, xb = xa + w - 0.3;
      boards.quad4(V(xb, 0.4, -0.02), V(xa, 0.4, -0.02), V(xa, 1.6, -0.02), V(xb, 1.6, -0.02), new THREE.Color(1, 1, 1), k.sponsor());
    }
  }

  // ---------------------------------------------------------------- back
  const zo = depth;
  as(open ? ARCH.FABRIC : ARCH.CONCRETE, () => box(-L / 2, -3, depth - 0.45, L / 2, top + 1.3, depth, open ? SCRIM : CONCRETE_DARK));
  if (open) {
    // temporary stand: a scaffold frame on the back (standards, ledgers, X-braced bays)
    as(ARCH.STEEL, () => {
      const n = Math.max(2, Math.round(L / 2.5));
      const ledgers: number[] = [];
      for (let y = 0.2; y < top + 1.2; y += 2.0) ledgers.push(y);
      for (let q = 0; q <= n; q++) {
        const x = -L / 2 + (q * L) / n;
        box(x - 0.04, -1.5, zo + 0.25, x + 0.04, top + 1.3, zo + 0.33, STEEL_MID);
        if (q < n && q % 2 === 0) {
          const xn = -L / 2 + ((q + 1) * L) / n;
          for (let j = 0; j < ledgers.length - 1; j++) {
            bar(V(x, ledgers[j], zo + 0.29), V(xn, ledgers[j + 1], zo + 0.29), 0.05, STEEL_MID, 0.05);
            bar(V(xn, ledgers[j], zo + 0.31), V(x, ledgers[j + 1], zo + 0.31), 0.05, STEEL_MID, 0.05);
          }
        }
      }
      for (const y of ledgers) box(-L / 2, y - 0.035, zo + 0.21, L / 2, y + 0.035, zo + 0.37, STEEL_MID);
      // top rail along the back row, on posts
      box(-L / 2, top + 0.95, depth - 0.42, L / 2, top + 1.02, depth - 0.34, STEEL_MID);
    }, true);
  } else {
    // permanent stand: a steel frame on the concrete, floor ledges, entrances, cladding above
    const nCol = Math.max(2, Math.round(L / 7) + 1);
    as(ARCH.STEEL, () => {
      for (let q = 0; q < nCol; q++) {
        const x = -L / 2 + (q * L) / (nCol - 1);
        box(x - 0.22, -3, zo, x + 0.22, top + 1.3, zo + 0.12, STEEL_DARK);
        box(x - 0.05, -3, zo + 0.12, x + 0.05, top + 1.3, zo + 0.32, STEEL_DARK);
        box(x - 0.22, -3, zo + 0.32, x + 0.22, top + 1.3, zo + 0.42, STEEL_DARK);
      }
    });
    const ledge0 = yBase + 0.2, ledge1 = top * 0.55;
    as(ARCH.CONCRETE, () => {
      for (const yl of [ledge0, ledge1]) box(-L / 2, yl, zo, L / 2, yl + 0.35, zo + 0.45, CONCRETE);
      box(-L / 2, top + 1.0, zo, L / 2, top + 1.45, zo + 0.5, CONCRETE);
    });
    // profiled cladding between the upper ledge and the parapet
    as(ARCH.CLAD, () => {
      for (let q = 0; q < nCol - 1; q++) {
        const xa = -L / 2 + (q * L) / (nCol - 1) + 0.22, xb = -L / 2 + ((q + 1) * L) / (nCol - 1) - 0.22;
        B.cur.quad4(V(xa, ledge1 + 0.35, zo + 0.06), V(xb, ledge1 + 0.35, zo + 0.06), V(xb, top + 1.0, zo + 0.06), V(xa, top + 1.0, zo + 0.06), CLAD);
      }
    });
    // windows of the concourse level: dark glazing bands between the ledges
    as(ARCH.PLAIN, () => {
      for (let q = 0; q < nCol - 1; q++) {
        if (q % 3 === 1) continue;
        const xa = -L / 2 + (q * L) / (nCol - 1) + 0.9, xb = -L / 2 + ((q + 1) * L) / (nCol - 1) - 0.9;
        const ya = ledge0 + 1.2, yb2 = Math.min(ledge1 - 0.6, ya + 1.6);
        if (yb2 - ya > 0.6) B.cur.quad4(V(xa, ya, zo + 0.03), V(xb, ya, zo + 0.03), V(xb, yb2, zo + 0.03), V(xa, yb2, zo + 0.03), VOID);
      }
    }, true);
    // entrances at the foot, under canopies
    const nDoor = Math.max(1, Math.round(L / 26));
    for (let q = 0; q < nDoor; q++) {
      const x = -L / 2 + ((q + 0.5) * L) / nDoor;
      as(ARCH.PLAIN, () => box(x - 1.6, 0, zo + 0.01, x + 1.6, 2.6, zo + 0.06, VOID));
      as(ARCH.STEEL, () => box(x - 1.8, 2.6, zo, x + 1.8, 2.85, zo + 0.9, STEEL));
    }
  }
  // open steel stair towers at the ends: corner posts, landings, flights, guard rails
  for (const sx of [-1, 1]) {
    const xs = sx * (L / 2 - 2.2);
    const z1 = zo + 0.4, z2 = zo + 3.2;
    as(ARCH.STEEL, () => {
      for (const px of [xs - 1.6, xs + 1.6]) for (const pz of [z1, z2]) box(px - 0.08, -3, pz - 0.08, px + 0.08, top + 1.2, pz + 0.08, STEEL_DARK);
      let flip = false;
      for (let y = 0; y < top; y += 2.6) {
        const yn = Math.min(top + 1.0, y + 2.6);
        // landing at each level, flight up to the next
        box(xs - 1.6, yn - 0.12, z1, xs + 1.6, yn, z1 + 1.1, STEEL_MID);
        const xA = flip ? xs + 1.5 : xs - 1.5, xB = flip ? xs - 1.5 : xs + 1.5;
        bar(V(xA, y, z1 + 1.8), V(xB, yn - 0.1, z1 + 1.8), 0.9, STEEL_MID, 0.14);
        bar(V(xA, y + 0.95, z2 - 0.05), V(xB, yn + 0.85, z2 - 0.05), 0.04, STEEL);
        box(xs - 1.65, yn + 0.95, z1 - 0.02, xs + 1.65, yn + 1.0, z1 + 0.02, STEEL);
        flip = !flip;
      }
    }, true);
  }
  // sponsor boards on the upper back, facing out
  if (top > 6) {
    const nB = Math.max(1, Math.round(L / 24));
    const w = L / nB;
    const y0 = top * 0.55 + 1.0, y1 = Math.min(top + 0.6, y0 + 3.2);
    for (let q = 0; q < nB; q++) {
      const xa = -L / 2 + q * w + 1.2, xb = xa + w - 2.4;
      if (xb - xa < 4) continue;
      boards.quad4(V(xa, y0, zo + 0.45), V(xb, y0, zo + 0.45), V(xb, y1, zo + 0.45), V(xa, y1, zo + 0.45), new THREE.Color(1, 1, 1), k.sponsor());
    }
  }

  // ---------------------------------------------------------------- roof
  if (g.roof) buildRoof(B, boards, k, L, top, depth, centrale, roofKindOf(g, k.venue));

  return { arch: mb, fine, boards, glass, people, flags, depth };
}

function buildRoof(
  B: Builders,
  boards: MeshBuilder,
  k: StandCtx,
  L: number,
  top: number,
  depth: number,
  centrale: boolean,
  kind: RoofKind,
) {
  const as = B.as;
  const bar = (a: THREE.Vector3, b: THREE.Vector3, w: number, c: THREE.Color, t = w) => member(B.cur, a, b, w, t, c);
  const yBack = top + (centrale ? 4.2 : 3.4);
  const yFront = top + (centrale ? 6.6 : 5.4);
  const zFront = centrale ? -4.5 : -2.2;
  const zBack = depth + 0.6;
  const thick = 0.22;
  const bow = kind === 'bowed' ? (centrale ? 2.6 : 1.6) : 0;
  const nCol = Math.max(2, Math.round(L / (kind === 'membrane' ? 12 : 14)) + 1);
  const colX = (q: number) => -L / 2 + (q * L) / (nCol - 1);
  const sag = kind === 'membrane' ? 1.1 : 0;
  /** underside of the deck at (x, z) */
  const roofY = (x: number, z: number) => {
    const t = (z - zFront) / (zBack - zFront);
    let y = yFront + (yBack - yFront) * t + bow * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
    if (sag) {
      // the membrane dips between the trusses (a tensioned saddle), least at the edges
      const bay = (L / (nCol - 1));
      const u = ((x + L / 2) / bay) % 1;
      y -= sag * Math.sin(Math.PI * u) * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))));
    }
    return y;
  };

  // ---- deck: top skin + underside, subdivided where it curves
  const nz = bow || sag ? 8 : 1;
  const nx = sag ? (nCol - 1) * 6 : 1;
  const x0 = -L / 2 - 1, x1 = L / 2 + 1;
  as(kind === 'membrane' ? ARCH.FABRIC : ARCH.CLAD, () => {
    const col = kind === 'membrane' ? MEMBRANE : ROOF_DECK;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const xa = x0 + ((x1 - x0) * i) / nx, xb = x0 + ((x1 - x0) * (i + 1)) / nx;
        const za = zFront + ((zBack - zFront) * j) / nz, zb = zFront + ((zBack - zFront) * (j + 1)) / nz;
        const P = (x: number, z: number, dy: number) => V(x, roofY(Math.min(Math.max(x, -L / 2), L / 2), z) + dy, z);
        // top (faces up): p0 (xa, zb), p1 (xb, zb), p2 (xb, za), p3 (xa, za)
        B.cur.quad4(P(xa, zb, thick), P(xb, zb, thick), P(xb, za, thick), P(xa, za, thick), col);
        // underside (faces down)
        B.cur.quad4(P(xa, za, 0), P(xb, za, 0), P(xb, zb, 0), P(xa, zb, 0), col.clone().multiplyScalar(0.92));
      }
    // the side edges of the deck
    for (const [xe, d] of [[x0, -1], [x1, 1]] as [number, number][])
      for (let j = 0; j < nz; j++) {
        const za = zFront + ((zBack - zFront) * j) / nz, zb = zFront + ((zBack - zFront) * (j + 1)) / nz;
        const ya = roofY(Math.min(Math.max(xe, -L / 2), L / 2), za), yb = roofY(Math.min(Math.max(xe, -L / 2), L / 2), zb);
        if (d > 0) B.cur.quad4(V(xe, ya, za), V(xe, yb, zb), V(xe, yb + thick, zb), V(xe, ya + thick, za), col);
        else B.cur.quad4(V(xe, yb, zb), V(xe, ya, za), V(xe, ya + thick, za), V(xe, yb + thick, zb), col);
      }
  });

  // ---- cantilever trusses on the column lines
  as(ARCH.STEEL, () => {
    const chord = centrale ? 0.24 : 0.18;
    const web = chord * 0.55;
    const deep = (z: number) => {
      // truss depth: deepest over the back column, tapering to the tip
      const t = (z - zFront) / (zBack - zFront);
      return (centrale ? 0.45 : 0.3) + (centrale ? 2.0 : 1.4) * Math.pow(Math.max(0, t), 0.8);
    };
    for (let q = 0; q < nCol; q++) {
      const x = colX(q);
      const yTopAt = (z: number) => roofY(x, z) - 0.02 - chord / 2;
      const N = Math.max(4, Math.round((zBack - zFront) / 2.2));
      const zs: number[] = [];
      for (let j = 0; j <= N; j++) zs.push(zFront + 0.35 + ((zBack - 0.25 - zFront - 0.35) * j) / N);
      for (let j = 0; j < N; j++) {
        const za = zs[j], zb = zs[j + 1];
        // chords (segmented, so they follow a bowed deck)
        bar(V(x, yTopAt(za), za), V(x, yTopAt(zb), zb), chord, STEEL);
        bar(V(x, yTopAt(za) - deep(za), za), V(x, yTopAt(zb) - deep(zb), zb), chord, STEEL);
        // web: a vertical at each node, a diagonal across each panel
        as(ARCH.STEEL, () => {
          bar(V(x, yTopAt(za) - deep(za), za), V(x, yTopAt(za), za), web, STEEL);
          if (j % 2 === 0) bar(V(x, yTopAt(za) - deep(za), za), V(x, yTopAt(zb), zb), web, STEEL);
          else bar(V(x, yTopAt(za), za), V(x, yTopAt(zb) - deep(zb), zb), web, STEEL);
        }, true);
      }
      const zl = zs[N];
      bar(V(x, yTopAt(zl) - deep(zl), zl), V(x, yTopAt(zl), zl), web, STEEL);
      // the back column: an I-section from the ground behind the stand to the truss heel
      const yHeel = yTopAt(zBack - 0.25) - deep(zBack - 0.25);
      box3(B.cur, x - 0.3, -3, depth - 0.35, x + 0.3, yHeel, depth - 0.25, STEEL_DARK);
      box3(B.cur, x - 0.06, -3, depth - 0.25, x + 0.06, yHeel, depth + 0.15, STEEL_DARK);
      box3(B.cur, x - 0.3, -3, depth + 0.15, x + 0.3, yHeel, depth + 0.25, STEEL_DARK);
      // kicker brace from the column, over the back rows, to the truss bottom chord
      // (kept above the top row: nothing stands up through the crowd)
      const zk = depth * 0.72;
      bar(V(x, top + 1.3, depth - 0.3), V(x, yTopAt(zk) - deep(zk), zk), 0.16, STEEL_DARK);
    }
    // purlins across the trusses (under a sheet deck; a membrane hangs from ridge cables)
    as(ARCH.STEEL, () => {
    if (kind !== 'membrane') {
      const nP = Math.max(3, Math.round((zBack - zFront) / 1.8));
      for (let j = 0; j <= nP; j++) {
        const z = zFront + 0.3 + ((zBack - zFront - 0.6) * j) / nP;
        const y = roofY(0, z);
        box3(B.cur, -L / 2 - 0.8, y - 0.2, z - 0.05, L / 2 + 0.8, y - 0.01, z + 0.05, STEEL_MID);
      }
      // plan bracing in the end bays and every third bay: X in the plane of the bottom of the deck
      for (let q = 0; q < nCol - 1; q++) {
        if (!(q === 0 || q === nCol - 2 || q % 3 === 1)) continue;
        const xa = colX(q), xb = colX(q + 1);
        const za = zFront + 0.5, zb = zBack - 0.5;
        bar(V(xa, roofY(xa, za) - 0.24, za), V(xb, roofY(xb, zb) - 0.24, zb), 0.05, STEEL_MID, 0.05);
        bar(V(xb, roofY(xb, za) - 0.24, za), V(xa, roofY(xa, zb) - 0.24, zb), 0.05, STEEL_MID, 0.05);
      }
    } else {
      // ridge cables over the trusses and edge cables along the front of each bay
      for (let q = 0; q < nCol - 1; q++) {
        const xa = colX(q), xb = colX(q + 1);
        for (let s = 0; s < 6; s++) {
          const u0 = s / 6, u1 = (s + 1) / 6;
          const xs0 = xa + (xb - xa) * u0, xs1 = xa + (xb - xa) * u1;
          const z = zFront + 0.05;
          bar(V(xs0, roofY(xs0, z) - 0.02, z), V(xs1, roofY(xs1, z) - 0.02, z), 0.04, STEEL_MID, 0.04);
        }
      }
    }
    }, true);
  });

  // ---- fascia girder at the front with the sponsor band
  const fh = centrale ? 2.6 : 1.9;
  const yF = roofY(0, zFront);
  const girder = kind === 'girder';
  as(ARCH.STEEL, () => {
    box3(B.cur, -L / 2 - 1, yF - fh - 0.05, zFront - 0.02, L / 2 + 1, yF + 0.2 + thick, zFront + 0.3, STEEL_DARK);
    // gutter lip over the band
    box3(B.cur, -L / 2 - 1, yF + thick + 0.12, zFront - 0.12, L / 2 + 1, yF + thick + 0.3, zFront + 0.1, STEEL);
    if (girder) as(ARCH.STEEL, () => {
      // Suzuka: a deep open front girder hanging below the band (chords, verticals, diagonals)
      const yb = yF - fh - 2.3, yt = yF - fh - 0.1;
      box3(B.cur, -L / 2 - 1, yb - 0.12, zFront + 0.02, L / 2 + 1, yb + 0.12, zFront + 0.3, STEEL);
      const n = Math.max(4, Math.round((L + 2) / 3));
      for (let q = 0; q <= n; q++) {
        const x = -L / 2 - 1 + ((L + 2) * q) / n;
        box3(B.cur, x - 0.07, yb, zFront + 0.08, x + 0.07, yt, zFront + 0.24, STEEL);
        if (q < n) {
          const xn = -L / 2 - 1 + ((L + 2) * (q + 1)) / n;
          member(B.cur, V(x, q % 2 ? yb : yt, zFront + 0.16), V(xn, q % 2 ? yt : yb, zFront + 0.16), 0.12, 0.1, STEEL, new THREE.Vector3(0, 0, 1));
        }
      }
    }, true);
  });
  {
    const nB = Math.max(1, Math.round(L / 22));
    const w = (L + 2) / nB;
    for (let q = 0; q < nB; q++) {
      const xa = -L / 2 - 1 + q * w, xb = xa + w;
      boards.quad4(V(xb, yF - fh, zFront - 0.05), V(xa, yF - fh, zFront - 0.05), V(xa, yF + 0.15, zFront - 0.05), V(xb, yF + 0.15, zFront - 0.05), new THREE.Color(1, 1, 1), k.sponsor());
    }
  }
  // ---- speaker stacks and floodlight bars under the front edge
  as(ARCH.STEEL, () => {
    const yH = yF - fh - (girder ? 2.4 : 0.1);
    for (let x = -L / 2 + 6; x < L / 2 - 3; x += 12) {
      box3(B.cur, x - 0.02, yH - 0.9, zFront + 0.6, x + 0.02, yH, zFront + 0.64, STEEL_DARK);
      box3(B.cur, x - 0.35, yH - 1.6, zFront + 0.4, x + 0.35, yH - 0.9, zFront + 0.95, LAMP);
      box3(B.cur, x + 2.2, yH - 0.35, zFront + 0.5, x + 3.6, yH - 0.1, zFront + 0.8, LAMP);
    }
  }, true);
}

function box3(mb: MeshBuilder, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color) {
  if (y1 <= y0) return;
  mb.aabb(x0, y0, z0, x1, y1, z1, c);
}
