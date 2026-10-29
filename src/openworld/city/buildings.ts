import * as THREE from 'three';
import { DISTRICTS, OCEAN_DRIVE, ll, type GridDistrict, type P2 } from '../geo.ts';
import { SPEC, halfWidth, type Network } from '../roads.ts';
import { MeshBuilder, chunkMeshes, rng } from './build.ts';
import { facadeMaterial, roofMaterial } from './facade.ts';
import { lotMaterial } from './materials.ts';
import { BEACH_W } from './ground.ts';

/**
 * Miami's buildings. Every block of every street grid is cut into lots and built up by where it
 * is: Brickell's and Downtown's glass condo towers on parking podiums (pools on the podium decks),
 * office towers in the core, the Park West / Edgewater bayfront, mid-rise and shops toward
 * Overtown, Little Havana's houses, South Beach's art deco. The tallest towers are the real ones,
 * at their real addresses and heights (named below); the rest follow a height profile fitted to
 * the real skyline.
 *
 * Output: the wall and roof meshes (chunked, one draw per chunk per material), the colliders
 * (convex footprints with a height), lots left open (plazas, parks) for the props.
 */

export interface Collider {
  /** convex footprint, world xz */
  poly: P2[];
  y0: number;
  y1: number;
  /** bounding circle for the broad phase */
  cx: number;
  cz: number;
  r: number;
}

export interface BuildingsBuild {
  group: THREE.Group;
  colliders: Collider[];
  /** open ground inside blocks (plazas, courtyards) where palms and people can go */
  open: { x: number; z: number; r: number }[];
  /** roof tops (for the props: AC units, water tanks) */
  roofs: { x: number; z: number; y: number; w: number; d: number; yaw: number }[];
  /** podium decks (amenity / parking) */
  decks: RoofDeck[];
  /** where the landmarks stand (their special parts are built in landmarks.ts) */
  landmarks: Landmarks;
  /** tower crowns (helipads, masts) */
  crowns: { x: number; z: number; y: number; w: number; d: number; yaw: number; tall: number }[];
  /** neon / sign anchor points on Ocean Drive's hotels */
  decoSigns: { x: number; y: number; z: number; yaw: number; name: string; color: number; h: number }[];
}

// ------------------------------------------------------------------------------- the skyline

const NAMED: { name: string; lat: number; lon: number; h: number; shape: Shape; style: number; wall: number; glass: number; w?: number; d?: number }[] = [
  // Brickell
  { name: 'Panorama Tower', lat: 25.7633, lon: -80.1918, h: 265, shape: 'round', style: 0, wall: 0, glass: 7, w: 62, d: 26 },
  { name: 'Cipriani Residences', lat: 25.7615, lon: -80.1905, h: 290, shape: 'ellipse', style: 0, wall: 9, glass: 1, w: 46, d: 34 },
  { name: 'Four Seasons Miami', lat: 25.7598, lon: -80.1928, h: 240, shape: 'rect', style: 2, wall: 4, glass: 4, w: 46, d: 30 },
  { name: '830 Brickell', lat: 25.7655, lon: -80.1912, h: 221, shape: 'round', style: 1, wall: 12, glass: 3, w: 50, d: 40 },
  { name: 'Brickell Flatiron', lat: 25.7667, lon: -80.1927, h: 213, shape: 'wedge', style: 0, wall: 0, glass: 1, w: 48, d: 34 },
  { name: 'Echo Brickell', lat: 25.7606, lon: -80.1915, h: 194, shape: 'round', style: 0, wall: 0, glass: 0, w: 40, d: 24 },
  { name: 'Infinity at Brickell', lat: 25.7641, lon: -80.1942, h: 192, shape: 'rect', style: 0, wall: 1, glass: 1, w: 44, d: 26 },
  { name: 'SLS Brickell', lat: 25.7686, lon: -80.1933, h: 183, shape: 'round', style: 0, wall: 0, glass: 2, w: 42, d: 24 },
  { name: 'Brickell City Centre Reach', lat: 25.7672, lon: -80.1936, h: 150, shape: 'rect', style: 6, wall: 0, glass: 0, w: 40, d: 24 },
  { name: 'Brickell City Centre Rise', lat: 25.7661, lon: -80.1942, h: 150, shape: 'rect', style: 6, wall: 0, glass: 0, w: 40, d: 24 },
  { name: 'Icon Brickell', lat: 25.7684, lon: -80.1893, h: 178, shape: 'round', style: 0, wall: 0, glass: 1, w: 46, d: 28 },
  { name: 'Una Residences', lat: 25.7562, lon: -80.1924, h: 187, shape: 'ellipse', style: 0, wall: 9, glass: 7, w: 44, d: 30 },
  { name: 'The Bond', lat: 25.7618, lon: -80.1938, h: 165, shape: 'rect', style: 1, wall: 12, glass: 2, w: 38, d: 26 },
  // Downtown
  { name: 'Southeast Financial Center', lat: 25.7721, lon: -80.1886, h: 233, shape: 'saw', style: 1, wall: 2, glass: 3, w: 58, d: 42 },
  { name: 'Wells Fargo Center', lat: 25.7713, lon: -80.1902, h: 200, shape: 'chamfer', style: 1, wall: 12, glass: 5, w: 48, d: 40 },
  { name: 'Aston Martin Residences', lat: 25.7714, lon: -80.1869, h: 250, shape: 'sail', style: 0, wall: 0, glass: 1, w: 56, d: 30 },
  { name: 'Mint at Riverfront', lat: 25.7708, lon: -80.1928, h: 192, shape: 'round', style: 0, wall: 1, glass: 0, w: 44, d: 26 },
  { name: 'Epic Residences', lat: 25.7709, lon: -80.1884, h: 183, shape: 'rect', style: 0, wall: 0, glass: 0, w: 44, d: 28 },
  { name: 'One Miami', lat: 25.7740, lon: -80.1872, h: 140, shape: 'rect', style: 0, wall: 1, glass: 2, w: 40, d: 28 },
  { name: 'Paramount Miami Worldcenter', lat: 25.7812, lon: -80.1902, h: 213, shape: 'ellipse', style: 0, wall: 9, glass: 0, w: 48, d: 30 },
  { name: 'E11even Residences', lat: 25.7823, lon: -80.1926, h: 213, shape: 'round', style: 0, wall: 0, glass: 1, w: 44, d: 28 },
  { name: 'Marquis', lat: 25.7840, lon: -80.1892, h: 214, shape: 'rect', style: 1, wall: 12, glass: 1, w: 44, d: 28 },
  { name: '900 Biscayne', lat: 25.7837, lon: -80.1876, h: 198, shape: 'round', style: 0, wall: 0, glass: 7, w: 44, d: 26 },
  { name: 'Marinablue', lat: 25.7862, lon: -80.1876, h: 187, shape: 'rect', style: 0, wall: 0, glass: 0, w: 44, d: 26 },
  { name: 'Miami-Dade Courthouse', lat: 25.7748, lon: -80.1952, h: 110, shape: 'ziggurat', style: 2, wall: 4, glass: 4, w: 40, d: 40 },
  // Edgewater (bay side of Biscayne Blvd)
  { name: 'Missoni Baia', lat: 25.7935, lon: -80.1866, h: 198, shape: 'ellipse', style: 0, wall: 9, glass: 7, w: 48, d: 28 },
  { name: 'Elysee', lat: 25.7958, lon: -80.1864, h: 196, shape: 'round', style: 0, wall: 0, glass: 1, w: 34, d: 30 },
  { name: 'Aria Reserve South', lat: 25.7995, lon: -80.1860, h: 194, shape: 'round', style: 0, wall: 9, glass: 0, w: 52, d: 26 },
  { name: 'Aria Reserve North', lat: 25.8012, lon: -80.1860, h: 194, shape: 'round', style: 0, wall: 9, glass: 0, w: 52, d: 26 },
  { name: 'One Paraiso', lat: 25.8040, lon: -80.1862, h: 183, shape: 'ellipse', style: 0, wall: 0, glass: 7, w: 46, d: 30 },
  { name: 'Biscayne Beach', lat: 25.8065, lon: -80.1863, h: 160, shape: 'rect', style: 0, wall: 0, glass: 0, w: 46, d: 26 },
  // Brickell Key
  { name: 'Mandarin Oriental', lat: 25.7671, lon: -80.1838, h: 100, shape: 'ellipse', style: 0, wall: 4, glass: 6, w: 90, d: 22 },
  { name: 'Asia', lat: 25.7690, lon: -80.1846, h: 140, shape: 'round', style: 0, wall: 0, glass: 0, w: 36, d: 26 },
  { name: 'Carbonell', lat: 25.7684, lon: -80.1825, h: 135, shape: 'rect', style: 0, wall: 0, glass: 1, w: 46, d: 24 },
  { name: 'Courts Brickell Key', lat: 25.7665, lon: -80.1826, h: 125, shape: 'round', style: 0, wall: 3, glass: 0, w: 44, d: 24 },
  // South Pointe
  { name: 'Continuum South', lat: 25.7667, lon: -80.1336, h: 130, shape: 'round', style: 0, wall: 0, glass: 7, w: 50, d: 22 },
  { name: 'Portofino Tower', lat: 25.7680, lon: -80.1388, h: 145, shape: 'chamfer', style: 2, wall: 4, glass: 6, w: 34, d: 34 },
  { name: 'Murano Grande', lat: 25.7695, lon: -80.1392, h: 115, shape: 'round', style: 0, wall: 0, glass: 7, w: 46, d: 24 },
];

type Shape = 'rect' | 'round' | 'ellipse' | 'chamfer' | 'wedge' | 'saw' | 'sail' | 'ziggurat' | 'L';

const cores: { p: P2; r: number; h: number; along?: number }[] = [
  { p: ll(25.7620, -80.1920), r: 700, h: 210, along: 33.7 },
  { p: ll(25.7718, -80.1895), r: 420, h: 200 },
  { p: ll(25.7830, -80.1890), r: 380, h: 190 },
  { p: ll(25.7960, -80.1880), r: 450, h: 160, along: 0 },
  { p: ll(25.7678, -80.1838), r: 260, h: 130 },
  { p: ll(25.7675, -80.1360), r: 280, h: 110 },
];

/** a plausible tower height at (x, z) for the surrounding skyline (m) */
export function skylineAt(x: number, z: number): number {
  let h = 0;
  for (const c of cores) {
    let dx = x - c.p.x, dz = z - c.p.z;
    if (c.along !== undefined) {
      // stretched along the avenue
      const a = (c.along * Math.PI) / 180;
      const along = dx * Math.sin(a) - dz * Math.cos(a);
      const across = dx * Math.cos(a) + dz * Math.sin(a);
      dx = across;
      dz = along * 0.45;
    }
    const d = Math.hypot(dx, dz) / c.r;
    h = Math.max(h, c.h * Math.exp(-d * d * 1.4));
  }
  return h;
}

// ------------------------------------------------------------------------------- shapes

function shapePoly(shape: Shape, cx: number, cz: number, w: number, d: number, yaw: number, R: () => number): P2[] {
  const pts: P2[] = [];
  const hw = w / 2, hd = d / 2;
  const push = (x: number, z: number) => pts.push({ x, z });
  switch (shape) {
    case 'rect':
      push(-hw, -hd), push(hw, -hd), push(hw, hd), push(-hw, hd);
      break;
    case 'round': {
      const r = Math.min(hw, hd) * (0.35 + R() * 0.4);
      const corners = [
        [hw - r, -hd + r, -Math.PI / 2],
        [hw - r, hd - r, 0],
        [-hw + r, hd - r, Math.PI / 2],
        [-hw + r, -hd + r, Math.PI],
      ];
      for (const [x, z, a0] of corners) for (let k = 0; k <= 5; k++) {
        const a = a0 + (k / 5) * (Math.PI / 2);
        push(x + Math.cos(a) * r, z + Math.sin(a) * r);
      }
      break;
    }
    case 'ellipse':
      for (let k = 0; k < 28; k++) {
        const a = (k / 28) * Math.PI * 2;
        push(Math.cos(a) * hw, Math.sin(a) * hd);
      }
      break;
    case 'chamfer': {
      const c = Math.min(hw, hd) * 0.3;
      push(-hw + c, -hd), push(hw - c, -hd), push(hw, -hd + c), push(hw, hd - c), push(hw - c, hd), push(-hw + c, hd), push(-hw, hd - c), push(-hw, -hd + c);
      break;
    }
    case 'wedge':
      // the flatiron: a long triangle with a rounded nose
      push(-hw, -hd), push(hw * 0.6, -hd), push(hw, -hd * 0.4), push(hw, -hd * 0.1), push(-hw, hd);
      break;
    case 'saw': {
      // Southeast Financial Center: serrated long faces
      const n = 5;
      for (let k = 0; k <= n; k++) push(-hw + (w * k) / n, -hd + (k % 2 ? 4 : 0));
      for (let k = n; k >= 0; k--) push(-hw + (w * k) / n, hd - (k % 2 ? 4 : 0));
      break;
    }
    case 'sail':
      // a curved sail: one convex face, one flat
      for (let k = 0; k <= 14; k++) {
        const t = k / 14;
        push(-hw + w * t, -hd + Math.sin(t * Math.PI) * d * 0.6 - d * 0.1);
      }
      push(hw * 0.9, hd), push(-hw * 0.9, hd);
      break;
    case 'ziggurat':
    case 'L':
      push(-hw, -hd), push(hw, -hd), push(hw, hd), push(-hw, hd);
      break;
  }
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return pts.map((p) => ({ x: cx + p.x * c - p.z * s, z: cz + p.x * s + p.z * c }));
}

/** a hash 0..1 */
function fh(x: number): number {
  const v = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// ------------------------------------------------------------------------------- builders

interface Fac {
  style: number;
  floorH: number;
  bayW: number;
  seed: number;
  wall: number;
  glass: number;
  groundH: number;
  /** the share of the wall's 22 m stretches painted with a mural (0..0.9; set by vivid()) */
  mural?: number;
}

/** pastel and bright walls (WALL_PAL indices) */
const PASTEL = [5, 6, 7, 8, 13, 14, 10, 16, 17, 19, 21, 22, 23, 18, 20];
const BRIGHT = [16, 17, 18, 19, 20, 21, 22, 23];

/**
 * Miami in colour: the plain walls painted (most of the low and mid-rise, some of the condos),
 * garages behind painted screens, and murals on the walls people walk and drive past. Keyed on the
 * building's seed, so a podium and its tower agree.
 */
function vivid(f: Fac, y0: number, topH: number): Fac & { mural: number } {
  const h = fh(f.seed * 13.7 + 0.31), h2 = fh(f.seed * 5.3 + 1.7), h3 = fh(f.seed * 2.9 + 7.1);
  let { style, wall } = f;
  let mural = 0;
  const low = topH < 40;
  if (style === 7) {
    // blank walls at street level are the murals' canvas
    if (y0 < 1 && topH > 4) mural = 0.85;
  } else if (style === 4) {
    if (h < 0.55) style = 9;
    else mural = 0.45;
    if (h2 < 0.6) wall = PASTEL[Math.floor(h3 * PASTEL.length)];
  } else if (style === 5) {
    if (h2 < 0.65) wall = PASTEL[Math.floor(h3 * PASTEL.length)];
  } else if (style === 2 || style === 8) {
    if (h2 < 0.85) wall = PASTEL[Math.floor(h3 * PASTEL.length)];
    if (low) mural = style === 8 ? 0.15 : 0.32;
  } else if (style === 3) {
    if (h2 < 0.45) wall = BRIGHT[Math.floor(h3 * BRIGHT.length)];
    mural = 0.08;
  } else if (style === 0 || style === 6) {
    if (h2 < 0.28) wall = [6, 5, 7, 8, 16, 17, 22, 21][Math.floor(h3 * 8)];
    if (low) mural = 0.25;
  } else if (style === 1 && low) mural = 0.2;
  return { ...f, style, wall, mural };
}

class Builder {
  walls = new MeshBuilder().attr('aFUV', 2).attr('aFac', 4).attr('aFPal', 4);
  roofs = new MeshBuilder().attr('aRoof', 1).attr('aRoofL', 4);
  pools = new MeshBuilder();
  lots = new MeshBuilder().attr('aLot', 3);
  colliders: Collider[] = [];
  roofTops: BuildingsBuild['roofs'] = [];
  decks: RoofDeck[] = [];
  crowns: BuildingsBuild['crowns'] = [];
  slabs = new MeshBuilder();
  rails = new MeshBuilder();
  canopies = new MeshBuilder().attr('color', 3);

  /**
   * Over the shop fronts: fabric awnings, one per shop bay (the facade shader's 6 m bays, so they sit
   * between its piers, under its sign band), sloping out over the sidewalk with a valance — or on a
   * plainer building a concrete canopy along the whole frontage.
   */
  private shopfront(a: P2, b: P2, nx: number, nz: number, u: number, len: number, f: Fac, edge: number) {
    const r = fh(f.seed * 7.3 + edge * 1.7);
    const kind = fh(f.seed * 3.1);
    if (kind > 0.8 || len < 5 || r < 0.25) return;
    const C = this.canopies;
    const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
    const at = (t: number, out: number, y: number): number[] => [a.x + dx * (t - u) + nx * out, y, a.z + dz * (t - u) + nz * out];
    const hT = f.groundH * 0.8;
    if (kind > 0.6) {
      // a concrete canopy: a slab the length of the wall
      C.set('color', 0.7, 0.69, 0.66);
      const t0 = u + 0.4, t1 = u + len - 0.4, D = 1.7, th = 0.2;
      C.face([at(t0, 0, hT), at(t0, D, hT), at(t1, D, hT), at(t1, 0, hT)]);
      C.face([at(t1, 0, hT - th), at(t1, D, hT - th), at(t0, D, hT - th), at(t0, 0, hT - th)]);
      C.face([at(t0, D, hT - th), at(t1, D, hT - th), at(t1, D, hT), at(t0, D, hT)]);
      return;
    }
    // fabric: Miami's awnings — candy stripes of a bright colour and white, or a solid colour
    const pal = [
      [0.85, 0.08, 0.3],
      [0.0, 0.5, 0.55],
      [0.95, 0.35, 0.03],
      [0.95, 0.72, 0.05],
      [0.22, 0.55, 0.08],
      [0.28, 0.1, 0.7],
      [0.04, 0.2, 0.7],
      [0.03, 0.12, 0.07],
      [0.025, 0.025, 0.028],
    ][Math.floor(fh(f.seed * 5.9) * 9)];
    const striped = fh(f.seed * 8.3) < 0.6;
    const D = 1.3, drop = 0.55, val = 0.24;
    for (let k = Math.ceil(u / 6); (k + 1) * 6 <= u + len + 0.01; k++) {
      if (fh(f.seed + k * 3.7 + edge) < 0.18) continue;
      const sh = 0.9 + 0.2 * fh(k * 1.3 + f.seed);
      const strips = striped ? 8 : 1;
      for (let j = 0; j < strips; j++) {
        const t0 = k * 6 + 0.4 + (5.2 * j) / strips, t1 = k * 6 + 0.4 + (5.2 * (j + 1)) / strips;
        if (striped && j % 2) C.set('color', 0.88, 0.87, 0.84);
        else C.set('color', pal[0] * sh, pal[1] * sh, pal[2] * sh);
        // the slope (both sides: seen from the street and from under it)
        const q = [at(t0, 0, hT), at(t0, D, hT - drop), at(t1, D, hT - drop), at(t1, 0, hT)];
        C.face(q);
        C.face([q[3], q[2], q[1], q[0]]);
        // the valance
        const v = [at(t0, D, hT - drop - val), at(t1, D, hT - drop - val), at(t1, D, hT - drop), at(t0, D, hT - drop)];
        C.face(v);
        C.face([v[1], v[0], v[3], v[2]]);
      }
      // the triangular ends
      C.set('color', pal[0] * sh, pal[1] * sh, pal[2] * sh);
      const t0 = k * 6 + 0.4, t1 = k * 6 + 5.6;
      C.face([at(t0, 0, hT), at(t0, D, hT - drop - val), at(t0, D, hT - drop)]);
      C.face([at(t1, 0, hT), at(t1, D, hT - drop), at(t1, D, hT - drop - val)]);
    }
  }

  /**
   * A condo tower's balconies: a concrete slab round the outline at every floor, projecting `out` m,
   * and a frosted glass rail along its edge — the deep horizontal bands of Miami's waterfront towers.
   */
  balconies(poly: P2[], y0: number, y1: number, floorH: number, out: number) {
    const n = poly.length;
    let area = 0;
    for (let i = 0; i < n; i++) area += poly[i].x * poly[(i + 1) % n].z - poly[(i + 1) % n].x * poly[i].z;
    const sgn = area > 0 ? -1 : 1;
    // outward offset of each vertex (the mitre of its two edges' normals)
    const en = poly.map((a, i) => {
      const b = poly[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      return { x: (-dz / l) * sgn, z: (dx / l) * sgn };
    });
    const o = poly.map((p, i) => {
      const a = en[(i - 1 + n) % n], b = en[i];
      let x = a.x + b.x, z = a.z + b.z;
      const l = Math.hypot(x, z) || 1;
      x /= l;
      z /= l;
      const k = out / Math.max(0.5, x * b.x + z * b.z);
      return { x: p.x + x * k, z: p.z + z * k, nx: x, nz: z };
    });
    const S = this.slabs, Rl = this.rails;
    const th = 0.22, railH = 1.05;
    for (let y = y0 + floorH; y < y1 - 0.5; y += floorH) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = poly[i], b = poly[j], A = o[i], B = o[j];
        const nx = en[i].x, nz = en[i].z;
        // top, bottom (between the wall and the outer edge), the edge
        const t0 = S.v(a.x, y, a.z, 0, 1, 0), t1 = S.v(b.x, y, b.z, 0, 1, 0), t2 = S.v(B.x, y, B.z, 0, 1, 0), t3 = S.v(A.x, y, A.z, 0, 1, 0);
        if (sgn > 0) S.quad(t0, t1, t2, t3);
        else S.quad(t1, t0, t3, t2);
        const b0 = S.v(a.x, y - th, a.z, 0, -1, 0), b1 = S.v(b.x, y - th, b.z, 0, -1, 0), b2 = S.v(B.x, y - th, B.z, 0, -1, 0), b3 = S.v(A.x, y - th, A.z, 0, -1, 0);
        if (sgn > 0) S.quad(b1, b0, b3, b2);
        else S.quad(b0, b1, b2, b3);
        const e0 = S.v(A.x, y - th, A.z, nx, 0, nz), e1 = S.v(B.x, y - th, B.z, nx, 0, nz), e2 = S.v(B.x, y, B.z, nx, 0, nz), e3 = S.v(A.x, y, A.z, nx, 0, nz);
        if (sgn > 0) S.quad(e0, e1, e2, e3);
        else S.quad(e1, e0, e3, e2);
        // the rail, a hand's width in from the edge
        const ix = -nx * 0.06, iz = -nz * 0.06;
        const r0 = Rl.v(A.x + ix, y, A.z + iz, nx, 0, nz, 0, 0), r1 = Rl.v(B.x + ix, y, B.z + iz, nx, 0, nz, 1, 0), r2 = Rl.v(B.x + ix, y + railH, B.z + iz, nx, 0, nz, 1, 1), r3 = Rl.v(A.x + ix, y + railH, A.z + iz, nx, 0, nz, 0, 1);
        if (sgn > 0) Rl.quad(r0, r1, r2, r3);
        else Rl.quad(r1, r0, r3, r2);
      }
    }
  }

  /** walls of a polygon prism from y0 to y1 (+ a roof cap of `roof` kind, -1 = none) */
  prism(poly: P2[], y0: number, y1: number, f: Fac, roof: number, opts: { collide?: boolean; parapet?: number; topH?: number } = {}) {
    const n = poly.length;
    let area = 0;
    for (let i = 0; i < n; i++) area += poly[i].x * poly[(i + 1) % n].z - poly[(i + 1) % n].x * poly[i].z;
    // outward normal of edge a→b: for area > 0 (clockwise from above in x-east/z-south) it is (dz, -dx)·sign
    const sgn = area > 0 ? -1 : 1;
    const top = y1 + (opts.parapet ?? 0);
    const topH = opts.topH ?? top;
    // smooth vertex normals where the outline bends gently
    const en: { x: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      en.push({ x: (-dz / l) * sgn, z: (dx / l) * sgn });
    }
    const vn = (i: number, e: number) => {
      const p = en[(i - 1 + n) % n], q = en[i];
      if (p.x * q.x + p.z * q.z > 0.87) {
        const x = p.x + q.x, z = p.z + q.z, l = Math.hypot(x, z) || 1;
        return { x: x / l, z: z / l };
      }
      return en[e];
    };
    let u = 0;
    const W = this.walls;
    const F = vivid(f, y0, topH);
    W.set('aFac', F.style + Math.min(0.9, F.mural) * 0.5, F.floorH, F.bayW, F.seed);
    W.set('aFPal', F.wall, F.glass, F.groundH, topH);
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const na = vn(i, i), nb = vn((i + 1) % n, i);
      // walls start from the ground floor's v (y0 above the building base keeps the floor count)
      W.set('aFUV', u, y0);
      const v0 = W.v(a.x, y0, a.z, na.x, 0, na.z);
      W.set('aFUV', u + len, y0);
      const v1 = W.v(b.x, y0, b.z, nb.x, 0, nb.z);
      W.set('aFUV', u + len, top);
      const v2 = W.v(b.x, top, b.z, nb.x, 0, nb.z);
      W.set('aFUV', u, top);
      const v3 = W.v(a.x, top, a.z, na.x, 0, na.z);
      // winding: outward-facing
      if (sgn > 0) W.quad(v0, v1, v2, v3);
      else W.quad(v1, v0, v3, v2);
      if (y0 < 0.3 && f.groundH >= 3.4 && y1 >= f.groundH) this.shopfront(a, b, en[i].x, en[i].z, u, len, f, i);
      u += len;
    }
    let frame: RoofFrame | null = null;
    if (roof >= 0) {
      frame = roofFrame(poly);
      this.roofs.set('aRoof', roof);
      const tris = THREE.ShapeUtils.triangulateShape(
        poly.map((p) => new THREE.Vector2(p.x, p.z)),
        [],
      );
      const base = this.roofs.count;
      for (const p of poly) {
        const dx = p.x - frame.ox, dz = p.z - frame.oz;
        this.roofs.set('aRoofL', dx * frame.ux + dz * frame.uz, -dx * frame.uz + dz * frame.ux, frame.W, frame.D);
        this.roofs.v(p.x, y1, p.z, 0, 1, 0);
      }
      for (const t of tris) {
        const [a, b, c] = t;
        const ax = poly[a].x, az = poly[a].z;
        const cr = (poly[b].x - ax) * (poly[c].z - az) - (poly[b].z - az) * (poly[c].x - ax);
        if (cr > 0) this.roofs.tri(base + a, base + c, base + b);
        else this.roofs.tri(base + a, base + b, base + c);
      }
    }
    if (opts.collide !== false) this.collide(poly, y0, top);
    return frame;
  }

  collide(poly: P2[], y0: number, y1: number) {
    // colliders must be convex: use the hull of non-convex outlines (good enough for walls)
    let cx = 0, cz = 0;
    for (const p of poly) {
      cx += p.x;
      cz += p.z;
    }
    cx /= poly.length;
    cz /= poly.length;
    let r = 0;
    for (const p of poly) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
    this.colliders.push({ poly: convexHull(poly), y0, y1, cx, cz, r });
  }

  /** a hip roof (houses): four slopes up to a ridge */
  hipRoof(cx: number, cz: number, w: number, d: number, yaw: number, y: number, h: number, kind: number) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, z: number, yy: number) => [cx + x * c - z * s, yy, cz + x * s + z * c];
    const ow = w / 2 + 0.5, od = d / 2 + 0.5;
    const r = Math.max(0, ow - od);
    const A = P(-ow, -od, y), B = P(ow, -od, y), C = P(ow, od, y), D = P(-ow, od, y);
    const E = P(-r, 0, y + h), F = P(r, 0, y + h);
    this.roofs.set('aRoof', kind);
    this.roofs.set('aRoofL', 0, 0, 0, 0);
    const face = (p: number[][]) => {
      // make it face up
      const [a, b, cc] = p;
      const ux = b[0] - a[0], uz = b[2] - a[2], vx = cc[0] - a[0], vz = cc[2] - a[2];
      const uy = b[1] - a[1], vy = cc[1] - a[1];
      const ny = uz * vx - ux * vz;
      void uy;
      void vy;
      this.roofs.face(ny > 0 ? p : p.slice().reverse());
    };
    face([A, B, F, E]);
    face([B, C, F]);
    face([C, D, E, F]);
    face([D, A, E]);
  }
}

/** a roof's own frame: u along its longest edge, v across, from the corner of its bounding box */
export interface RoofFrame {
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  W: number;
  D: number;
}
function roofFrame(poly: P2[]): RoofFrame {
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l > best) {
      best = l;
      ux = (b.x - a.x) / l;
      uz = (b.z - a.z) / l;
    }
  }
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of poly) {
    const u = p.x * ux + p.z * uz, v = -p.x * uz + p.z * ux;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  // the corner (u0, v0) back in world space
  return { ox: u0 * ux - v0 * uz, oz: u0 * uz + v0 * ux, ux, uz, W: u1 - u0, D: v1 - v0 };
}

export interface Landmarks {
  miamiTower?: { x: number; z: number; y: number; w: number; d: number };
  freedomTower?: { x: number; z: number; y: number };
  arena?: { x: number; z: number; y: number; w: number; d: number };
  pamm?: { x: number; z: number; y: number; w: number; d: number };
  frost?: { x: number; z: number; y: number; r: number };
  bayside?: { x: number; z: number; y: number };
}

/** a podium roof: an amenity deck (pool, loungers, palms) or the open top of a parking garage */
export interface RoofDeck extends RoofFrame {
  kind: 'amenity' | 'parking';
  y: number;
  pool: { cx: number; cz: number; w: number; d: number; yaw: number } | null;
}

function convexHull(poly: P2[]): P2[] {
  const p = poly.slice().sort((a, b) => a.x - b.x || a.z - b.z);
  if (p.length < 3) return p;
  const cr = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lo: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}

// ------------------------------------------------------------------------------- the city

/** sets of named deco hotels on Ocean Drive, south → north (name, wall colour index, neon colour) */
const DECO_HOTELS: [string, number, number][] = [
  ['VICTOR', 9, 0x57e8ff],
  ['AVALON', 9, 0x57e8ff],
  ['MAJESTIC', 7, 0xff4fa0],
  ['CENTURY', 5, 0xff4fa0],
  ['BEACON', 7, 0xff6a3d],
  ['COLONY', 9, 0x3d9bff],
  ['WALDORF', 10, 0xff4fa0],
  ['BREAKWATER', 10, 0xffd84d],
  ['EDISON', 6, 0x57e8ff],
  ['CLEVELANDER', 9, 0x3dffb2],
  ['LESLIE', 7, 0xff4fa0],
  ['CARDOZO', 9, 0x57e8ff],
  ['CARLYLE', 9, 0x57e8ff],
  ['PARK CENTRAL', 8, 0xff4fa0],
  ['TIDES', 9, 0xffd84d],
  ['CRESCENT', 13, 0xff4fa0],
  ['STARLITE', 14, 0x57e8ff],
  ['NETHERLAND', 5, 0xff6a3d],
];

export function buildBuildings(net: Network, beachX: (z: number) => number): BuildingsBuild {
  const B = new Builder();
  const open: BuildingsBuild['open'] = [];
  const decoSigns: BuildingsBuild['decoSigns'] = [];
  const R = rng(9001);
  const named = NAMED.map((n) => ({ ...n, p: ll(n.lat, n.lon), used: false }));
  const mask = net.mask;

  const onLand = (poly: P2[], margin: number) =>
    poly.every((p) => mask.land(p.x, p.z) && mask.land(p.x + margin, p.z) && mask.land(p.x - margin, p.z) && mask.land(p.x, p.z + margin) && mask.land(p.x, p.z - margin));

  /** is this footprint clear of every road and sidewalk? */
  const clearOfRoads = (poly: P2[], pad: number) => {
    const S = { y: 0 } as { y: number };
    void S;
    for (const p of poly) {
      for (const id of net.near(p.x, p.z)) {
        const e = net.edges[id];
        const pr = net.project(e, p.x, p.z, PR);
        if (!pr || pr.off) continue;
        if (pr.y > 3) continue; // under a highway deck is fine
        if (Math.abs(pr.lat) < e.hw + e.spec.sidewalk + pad) return false;
      }
    }
    return true;
  };

  const stats: Record<string, number> = {};
  const stat = (k: string) => (stats[k] = (stats[k] ?? 0) + 1);
  /** the landmarks' grounds: nothing else is built in them */
  const reserved: { x: number; z: number; r: number }[] = [];
  const isReserved = (x: number, z: number, r = 0) => reserved.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + r);
  const towerAt = (cx: number, cz: number, lotW: number, lotD: number, yaw: number, H: number, seed: number) => {
    if (isReserved(cx, cz, Math.min(lotW, lotD) * 0.3)) return false;
    // a named tower close by takes the lot
    let nm: (typeof named)[number] | null = null;
    for (const n of named) {
      if (n.used) continue;
      if (Math.hypot(n.p.x - cx, n.p.z - cz) < Math.max(lotW, lotD) * 0.75) {
        nm = n;
        break;
      }
    }
    const podiumH = nm ? 22 : 14 + Math.floor(R() * 4) * 3.2;
    const tall = nm ? nm.h : Math.max(45, H * (0.42 + R() * 0.58));
    const lot = shapePoly('rect', cx, cz, lotW, lotD, yaw, R);
    if (!onLand(lot, 6)) return stat('tower-water'), false;
    if (!clearOfRoads(lot, 0.6)) return stat('tower-road'), false;
    stat('tower');
    if (nm) nm.used = true;
    const gfH = 5.5;
    // the podium: parking decks behind a glass street front (or the whole lot in glass for offices)
    const office = nm ? nm.style === 1 : R() < 0.3;
    B.prism(lot, 0, gfH, { style: 5, floorH: 4, bayW: 6, seed, wall: 2, glass: 4, groundH: gfH }, -1, { collide: false });
    const amenity = !office && R() < 0.8;
    const frame = B.prism(lot, gfH, podiumH, { style: office ? 1 : 4, floorH: 3.2, bayW: office ? 1.6 : 8.5, seed, wall: office ? 12 : 1, glass: 4, groundH: 0 }, amenity ? 4 : 5, { parapet: 1.1 })!;
    B.collide(lot, 0, podiumH);
    const deck: RoofDeck = { ...frame, kind: amenity ? 'amenity' : 'parking', y: podiumH, pool: null };
    B.decks.push(deck);
    // amenity deck: a pool on the podium roof
    if (amenity) {
      const pw = Math.min(lotW * 0.35, 22), pd = Math.min(lotD * 0.22, 8);
      const off = (lotD / 2 - pd / 2 - 3) * (R() < 0.5 ? 1 : -1);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const px = cx - off * s, pz = cz + off * c;
      const P = shapePoly('rect', px, pz, pw, pd, yaw, R);
      const ids = P.map((p) => B.pools.v(p.x, podiumH + 0.06, p.z, 0, 1, 0));
      B.pools.quad(ids[0], ids[3], ids[2], ids[1]);
      deck.pool = { cx: px, cz: pz, w: pw, d: pd, yaw };
    }
    // the tower
    const shape: Shape = nm ? nm.shape : (['rect', 'round', 'round', 'ellipse', 'chamfer'] as Shape[])[Math.floor(R() * 5)];
    const tw = nm?.w ?? Math.min(lotW * (0.55 + R() * 0.2), 48);
    const td = nm?.d ?? Math.min(lotD * (0.5 + R() * 0.25), 30);
    const tyaw = yaw + (R() < 0.15 ? (R() - 0.5) * 0.4 : 0);
    const style = nm ? nm.style : office ? 1 : R() < 0.75 ? 0 : R() < 0.5 ? 6 : 2;
    const wall = nm ? nm.wall : style === 1 ? 12 : [0, 0, 9, 1, 4][Math.floor(R() * 5)];
    const glass = nm ? nm.glass : [0, 0, 1, 7, 2, 3, 5][Math.floor(R() * 7)];
    const fac: Fac = { style, floorH: style === 1 ? 4.0 : 3.25, bayW: style === 1 ? 1.55 : style === 6 ? 2.2 : 3.6, seed, wall, glass, groundH: 0 };
    const poly = shapePoly(shape, cx, cz, tw, td, tyaw, R);
    if (shape === 'ziggurat') {
      // the County Courthouse: a classical shaft, a stepped pyramid crown
      B.prism(poly, podiumH, tall * 0.72, fac, -1);
      let y = tall * 0.72, k = 1;
      for (let i = 0; i < 5; i++, k *= 0.82) {
        const p2 = shapePoly('rect', cx, cz, tw * k, td * k, tyaw, R);
        B.prism(p2, y, y + (tall * 0.28) / 6, { ...fac, style: 7 }, i === 4 ? 2 : -1);
        y += (tall * 0.28) / 6;
      }
      B.roofTops.push({ x: cx, z: cz, y, w: tw * k, d: td * k, yaw: tyaw });
      return true;
    }
    // a setback near the top for some
    const setback = R() < 0.35 && tall > 110;
    const yTop = setback ? tall * 0.86 : tall;
    B.prism(poly, podiumH, yTop, fac, setback ? 1 : 0, { topH: tall });
    // condos: real balconies (most of them wrap the whole tower)
    if (style === 0) B.balconies(poly, podiumH, yTop, fac.floorH, 1.5 + R() * 0.9);
    if (setback) {
      const p2 = shapePoly(shape, cx, cz, tw * 0.78, td * 0.78, tyaw, R);
      B.prism(p2, yTop, tall, fac, 0);
    }
    // the crown: Miami's towers finish in a statement — a glass screen standing proud of the roof
    // (lit along its top after dark), a stepped glass crown, or a plain mechanical penthouse
    const kind = R();
    const tw2 = setback ? tw * 0.78 : tw, td2 = setback ? td * 0.78 : td;
    const cw = tw2 * 0.42, cd = td2 * 0.45;
    let crownTop = tall;
    if (kind < 0.36 && tall > 70) {
      const sh = 7 + R() * 9;
      const ring = shapePoly(shape, cx, cz, tw2 * 0.985, td2 * 0.985, tyaw, R);
      B.prism(ring, tall, tall + sh, { ...fac, style: R() < 0.5 ? 6 : 1, floorH: sh / 2, bayW: style === 1 ? 1.55 : 2.4, groundH: 0 }, -1, { collide: false, topH: tall + sh });
      crownTop = tall + sh;
      // the plant hides inside it
      const crown = shapePoly('rect', cx, cz, cw, cd, tyaw, R);
      B.prism(crown, tall, tall + Math.min(sh - 1.5, 5), { style: 7, floorH: 3, bayW: 3, seed, wall: 1, glass: 4, groundH: 0 }, 3, { collide: false });
      B.crowns.push({ x: cx, z: cz, y: tall + Math.min(sh - 1.5, 5), w: cw, d: cd, yaw: tyaw, tall });
    } else if (kind < 0.62 && tall > 80) {
      // stepped: three glass tiers, each smaller
      let y = tall;
      let k = 0.86;
      for (let i = 0; i < 3; i++, k -= 0.16) {
        const h = 4 + R() * 3;
        const p3 = shapePoly(shape, cx, cz, tw2 * k, td2 * k, tyaw, R);
        B.prism(p3, y, y + h, { ...fac, floorH: h, groundH: 0 }, i === 2 ? 3 : 0, { topH: y + h + (i === 2 ? 0 : 50) });
        y += h;
      }
      crownTop = y;
      B.crowns.push({ x: cx, z: cz, y, w: tw2 * (k + 0.16) * 0.6, d: td2 * (k + 0.16) * 0.6, yaw: tyaw, tall });
    } else {
      // the mechanical penthouse
      const crownH = 4 + R() * 5;
      const crown = shapePoly('rect', cx, cz, cw, cd, tyaw, R);
      B.prism(crown, tall, tall + crownH, { style: 7, floorH: 3, bayW: 3, seed, wall: wall === 12 ? 2 : 1, glass: 4, groundH: 0 }, 3);
      B.crowns.push({ x: cx, z: cz, y: tall + crownH, w: cw, d: cd, yaw: tyaw, tall });
      crownTop = tall + crownH;
    }
    void crownTop;
    B.roofTops.push({ x: cx, z: cz, y: tall, w: tw * 0.8, d: td * 0.8, yaw: tyaw });
    return true;
  };

  const midriseAt = (cx: number, cz: number, w: number, d: number, yaw: number, h: number, seed: number, deco = false) => {
    if (isReserved(cx, cz, Math.min(w, d) * 0.3)) return false;
    const poly = shapePoly(deco ? 'rect' : R() < 0.2 ? 'chamfer' : 'rect', cx, cz, w, d, yaw, R);
    if (!onLand(poly, 3) || !clearOfRoads(poly, 0.4)) return false;
    const floors = Math.max(1, Math.round((h - 4.5) / 3.3));
    const H = 4.5 + floors * 3.3;
    const style = deco ? 3 : [2, 2, 0, 1, 6, 2][Math.floor(R() * 6)];
    const wall = deco ? [5, 6, 7, 8, 9, 9, 13, 14, 10][Math.floor(R() * 9)] : [0, 1, 3, 4, 9, 15, 11][Math.floor(R() * 7)];
    B.prism(poly, 0, H, { style, floorH: 3.3, bayW: style === 1 ? 1.6 : deco ? 4.2 : 3.2, seed, wall, glass: [0, 2, 4, 6][Math.floor(R() * 4)], groundH: 4.5 }, R() < 0.12 ? 6 : R() < 0.7 ? 0 : 1, { parapet: 1.0 });
    B.roofTops.push({ x: cx, z: cz, y: H, w: w * 0.8, d: d * 0.8, yaw });
    return true;
  };

  const houseAt = (cx: number, cz: number, w: number, d: number, yaw: number, seed: number) => {
    if (isReserved(cx, cz)) return false;
    const poly = shapePoly('rect', cx, cz, w, d, yaw, R);
    if (!onLand(poly, 2) || !clearOfRoads(poly, 1.5)) return false;
    const floors = R() < 0.7 ? 1 : 2;
    const H = 3.4 * floors;
    B.prism(poly, 0, H, { style: 8, floorH: 3.4, bayW: 3.5, seed, wall: [3, 4, 9, 0, 5, 6, 7, 15, 11][Math.floor(R() * 9)], glass: 4, groundH: 0 }, R() < 0.55 ? -1 : 0, { parapet: 0.4 });
    B.hipRoof(cx, cz, w, d, yaw, H, 1.8, 2);
    return true;
  };

  // ---- the landmarks (first: their grounds are reserved before the grids fill in round them)
  const landmarks: Landmarks = {};
  /** the nearest clear lot to a real address: on land, off the roads */
  const site = (lat: number, lon: number, w: number, d: number, yaw: number, shape: Shape = 'rect') => {
    const c = ll(lat, lon);
    for (let r = 0; r <= 220; r += 10)
      for (let k = 0; k < Math.max(1, r / 5); k++) {
        const a = (k / Math.max(1, r / 5)) * Math.PI * 2;
        const x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
        const poly = shapePoly(shape, x, z, w, d, yaw, R);
        if (onLand(poly, 2) && clearOfRoads(poly, 0.5) && !isReserved(x, z, Math.min(w, d) * 0.4)) return { x, z, poly };
      }
    console.warn('[openworld] no site for landmark at', lat, lon);
    return null;
  };
  {
    // Miami Tower (100 SE 2nd St, 1987, I. M. Pei): a garage podium, the office shaft, and the
    // three stepped quarter-round tiers on top that are washed in colour every night
    const s0 = site(25.7722, -80.1908, 64, 52, 0);
    if (s0) {
      reserved.push({ x: s0.x, z: s0.z, r: 40 });
      B.prism(s0.poly, 0, 5.5, { style: 5, floorH: 4, bayW: 6, seed: 3, wall: 0, glass: 4, groundH: 5.5 }, -1, { collide: false });
      B.prism(s0.poly, 5.5, 32, { style: 4, floorH: 3.2, bayW: 8.5, seed: 3, wall: 0, glass: 4, groundH: 0 }, 5, { parapet: 1.1 });
      B.collide(s0.poly, 0, 33);
      const shaft = shapePoly('rect', s0.x + 6, s0.z, 44, 36, 0, R);
      B.prism(shaft, 32, 150, { style: 1, floorH: 4, bayW: 1.55, seed: 4, wall: 0, glass: 3, groundH: 0 }, -1);
      landmarks.miamiTower = { x: s0.x + 6, z: s0.z, y: 150, w: 44, d: 36 };
      B.colliders.push({ poly: convexHull(shapePoly('rect', s0.x + 6, s0.z, 44, 36, 0, R)), y0: 150, y1: 192, cx: s0.x + 6, cz: s0.z, r: 30 });
    }
    // the Freedom Tower (600 Biscayne Blvd, 1925): Spanish Revival, a cupola on a square shaft
    const s1 = site(25.7797, -80.1898, 44, 32, 0);
    if (s1) {
      reserved.push({ x: s1.x, z: s1.z, r: 28 });
      B.prism(s1.poly, 0, 19, { style: 2, floorH: 3.6, bayW: 3.2, seed: 5, wall: 4, glass: 4, groundH: 4.5 }, 2, { parapet: 0.8 });
      const sh = shapePoly('rect', s1.x, s1.z, 15, 15, 0, R);
      B.prism(sh, 19, 58, { style: 2, floorH: 3.6, bayW: 2.6, seed: 6, wall: 4, glass: 4, groundH: 0 }, -1);
      const oct = shapePoly('round', s1.x, s1.z, 11, 11, 0, R);
      B.prism(oct, 58, 66, { style: 3, floorH: 4, bayW: 2.4, seed: 7, wall: 4, glass: 4, groundH: 0 }, -1);
      landmarks.freedomTower = { x: s1.x, z: s1.z, y: 66 };
    }
    // the Kaseya Center (601 Biscayne Blvd): the arena by the bay, a glass drum under a white roof
    const s2 = site(25.7814, -80.1872, 132, 104, 0, 'ellipse');
    if (s2) {
      reserved.push({ x: s2.x, z: s2.z, r: 75 });
      B.prism(s2.poly, 0, 30, { style: 1, floorH: 6, bayW: 3.2, seed: 8, wall: 12, glass: 1, groundH: 0 }, -1, { collide: false });
      B.collide(s2.poly, 0, 44);
      landmarks.arena = { x: s2.x, z: s2.z, y: 30, w: 132, d: 104 };
    }
    // the Pérez Art Museum (Herzog & de Meuron): a glass box under a vast timber canopy on stilts,
    // the hanging gardens dangling from it
    const s3 = site(25.7859, -80.1864, 84, 52, 0);
    if (s3) {
      reserved.push({ x: s3.x, z: s3.z, r: 60 });
      B.prism(s3.poly, 1.5, 15, { style: 1, floorH: 5, bayW: 2.4, seed: 9, wall: 0, glass: 2, groundH: 0 }, 6);
      landmarks.pamm = { x: s3.x, z: s3.z, y: 20, w: 140, d: 92 };
    }
    // Frost Science: white fins and the planetarium sphere
    const s4 = site(25.7848, -80.1879, 58, 40, 0);
    if (s4) {
      reserved.push({ x: s4.x, z: s4.z, r: 42 });
      B.prism(s4.poly, 0, 24, { style: 6, floorH: 4.5, bayW: 2.6, seed: 10, wall: 9, glass: 7, groundH: 0 }, 0, { parapet: 1 });
      landmarks.frost = { x: s4.x + 18, z: s4.z - 4, y: 24 + 13, r: 13.5 };
    }
    // Bayside Marketplace: the two low pavilions, the SkyViews wheel on the bay
    const s5 = site(25.7783, -80.1866, 110, 28, 0);
    if (s5) {
      reserved.push({ x: s5.x, z: s5.z, r: 58 });
      B.prism(s5.poly, 0, 9.5, { style: 5, floorH: 4.5, bayW: 6, seed: 11, wall: 4, glass: 6, groundH: 9.5 }, 0, { parapet: 1.2 });
      landmarks.bayside = { x: s5.x, z: s5.z, y: 10.7 };
    }
  }

  // ---- the grids
  for (const d of DISTRICTS) {
    const a = (d.angle * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const at = (v: number, w: number): P2 => ({ x: d.origin.x + v * ca - w * sa, z: d.origin.z + v * sa + w * ca });
    const yaw = a;
    const cols = d.cols.map((c) => ({ ...c, virtual: false }));
    // the bay side's last row of lots (Brickell Bay Dr, West Ave, Edgewater, Collins' beach hotels)
    if (d.id === 'brickell') cols.unshift({ at: 175 + 330, name: '', kind: 'street', virtual: true });
    if (d.id === 'downtown') cols.push({ at: 681 + 230, name: '', kind: 'street', virtual: true });
    if (d.id === 'southbeach') {
      cols.unshift({ at: cols[0].at - 190, name: '', kind: 'street', virtual: true });
      cols.push({ at: cols[cols.length - 1].at + 250, name: '', kind: 'street', virtual: true });
    }
    cols.sort((p, q) => p.at - q.at);
    for (let i = 0; i + 1 < cols.length; i++) {
      for (let j = 0; j + 1 < d.rows.length; j++) {
        const c0 = cols[i], c1 = cols[i + 1], r0 = d.rows[j], r1 = d.rows[j + 1];
        const inset = (k: (typeof cols)[number] | (typeof d.rows)[number], virtual = false) => (virtual ? 2 : halfWidth(SPEC[k.kind]) + SPEC[k.kind].sidewalk + 1.2);
        const v0 = c0.at + inset(c0, c0.virtual), v1 = c1.at - inset(c1, c1.virtual);
        const w0 = r0.at + inset(r0), w1 = r1.at - inset(r1);
        if (v1 - v0 < 9 || w1 - w0 < 9) continue;
        const ctr = at((v0 + v1) / 2, (w0 + w1) / 2);
        const land = mask.at(ctr.x, ctr.z);
        if (!land) continue;
        if (d.keep && !d.keep(ctr, land) && !c0.virtual && !c1.virtual) continue;
        if (d.id === 'downtown' && (c0.virtual || c1.virtual) && ctr.z > -1680) {
          open.push({ x: ctr.x, z: ctr.z, r: Math.min(v1 - v0, w1 - w0) / 2 });
          continue;
        }
        if (d.id === 'southbeach' && c1.virtual) {
          // east of Ocean Drive / Collins: Lummus Park and the beach south of 15th; hotels north
          if (ctr.z > OCEAN_DRIVE.z0 || ctr.x > beachX(ctr.z) - BEACH_W - 10) continue;
        }
        const seed = R() * 100;
        const bw = v1 - v0, bd = w1 - w0;
        const H = skylineAt(ctr.x, ctr.z);
        const cell = (fv: number, fw: number) => at(v0 + bw * fv, w0 + bd * fw);
        const density = densityOf(d, ctr, H);
        if (density !== 'residential' && density !== 'park') {
          // the block's ground: plazas round the towers, car parks behind the shops, pavers on the beach
          const kind = density === 'lowrise' ? 1 : density === 'deco' ? 2 : 0;
          B.lots.set('aLot', 0, 0, kind);
          const P = [at(v0 - 0.8, w0 - 0.8), at(v1 + 0.8, w0 - 0.8), at(v1 + 0.8, w1 + 0.8), at(v0 - 0.8, w1 + 0.8)];
          if (P.every((q) => mask.land(q.x, q.z))) {
            const ids = P.map((q, k) => {
              B.lots.set('aLot', k === 1 || k === 2 ? bw + 1.6 : 0, k >= 2 ? bd + 1.6 : 0, kind);
              return B.lots.v(q.x, 0.025, q.z, 0, 1, 0);
            });
            // facing up
            const cr = (P[1].x - P[0].x) * (P[2].z - P[0].z) - (P[1].z - P[0].z) * (P[2].x - P[0].x);
            if (cr > 0) B.lots.quad(ids[0], ids[3], ids[2], ids[1]);
            else B.lots.quad(ids[0], ids[1], ids[2], ids[3]);
          }
        }
        if (density === 'tower') {
          // one or two towers on the block
          const two = bw > 110 && R() < 0.6;
          if (two) {
            const p1 = cell(0.25, 0.5), p2 = cell(0.75, 0.5);
            if (!towerAt(p1.x, p1.z, bw / 2 - 3, bd, yaw, H, seed)) midriseAt(p1.x, p1.z, bw / 2 - 4, bd - 2, yaw, 30 + R() * 30, seed);
            if (!towerAt(p2.x, p2.z, bw / 2 - 3, bd, yaw, H, seed + 1)) midriseAt(p2.x, p2.z, bw / 2 - 4, bd - 2, yaw, 30 + R() * 30, seed + 1);
          } else {
            const p = cell(0.5, 0.5);
            if (!towerAt(p.x, p.z, Math.min(bw, 120), Math.min(bd, 100), yaw, H, seed)) midriseAt(p.x, p.z, Math.min(bw, 90) - 4, bd - 4, yaw, 25 + R() * 30, seed);
          }
        } else if (density === 'midrise') {
          const n = Math.max(1, Math.round(bw / 55));
          for (let k = 0; k < n; k++) {
            const p = cell((k + 0.5) / n, 0.5);
            const h = Math.max(12, H * (0.4 + R() * 0.6) + 8);
            if (R() < 0.12) {
              open.push({ x: p.x, z: p.z, r: Math.min(bw / n, bd) / 2 });
              continue;
            }
            midriseAt(p.x, p.z, bw / n - 5, bd - 4 - R() * 10, yaw, h, seed + k);
          }
        } else if (density === 'lowrise') {
          // shops and walk-ups along both long sides, a car park behind
          const n = Math.max(1, Math.round(bw / 26));
          for (const side of [0.22, 0.78]) for (let k = 0; k < n; k++) {
            if (R() < 0.15) continue;
            const p = cell((k + 0.5) / n, side);
            midriseAt(p.x, p.z, bw / n - 2.5, bd * 0.38 - 2, yaw, 4.5 + Math.floor(R() * 4) * 3.3, seed + k + side);
          }
          open.push({ x: cell(0.5, 0.5).x, z: cell(0.5, 0.5).z, r: bd * 0.12 });
        } else if (density === 'residential') {
          const n = Math.max(1, Math.round(bw / 17));
          for (const side of [0.24, 0.76]) for (let k = 0; k < n; k++) {
            if (R() < 0.1) continue;
            const p = cell((k + 0.5) / n, side);
            if (R() < 0.12) midriseAt(p.x, p.z, bw / n - 3, bd * 0.36, yaw, 8 + R() * 6, seed + k);
            else houseAt(p.x, p.z, Math.min(bw / n - 4, 13), Math.min(bd * 0.32, 15), yaw, seed + k);
          }
          open.push({ x: cell(0.5, 0.5).x, z: cell(0.5, 0.5).z, r: bd * 0.15 });
        } else if (density === 'deco') {
          // contiguous deco fronts on both long sides, gaps for the alleys
          const n = Math.max(1, Math.round(bw / 30));
          const oceanFront = Math.abs(cols[i + 1].at - OCEAN_DRIVE.x) < 3 && ctr.z < OCEAN_DRIVE.z1 && ctr.z > OCEAN_DRIVE.z0;
          for (const side of [0.27, 0.73]) for (let k = 0; k < n; k++) {
            const p = cell((k + 0.5) / n, side);
            const tall = H > 60 ? H * (0.5 + R() * 0.5) : R() < 0.12 ? 18 + R() * 25 : 11 + R() * 5;
            midriseAt(p.x, p.z, bw / n - 3, bd * 0.42, yaw, tall, seed + k + side, tall < 25);
          }
          if (oceanFront) {
            // the Ocean Drive hotels face the park: a neon sign on each
            for (const side of [0.27, 0.73]) {
              // on the face toward the park, over the ground floor's porch
              const p = cell(1.0, side);
              const hotel = DECO_HOTELS[decoSigns.length % DECO_HOTELS.length];
              decoSigns.push({ x: p.x - 0.4, y: 5.2, z: p.z, yaw: Math.PI / 2, name: hotel[0], color: hotel[2], h: 13 + R() * 4 });
            }
          }
        } else if (density === 'park') {
          open.push({ x: ctr.x, z: ctr.z, r: Math.min(bw, bd) / 2 });
        }
      }
    }
  }

  // ---- named towers the grids didn't reach (Edgewater bayfront, Brickell Key, South Pointe)
  for (const n of named) {
    if (n.used) continue;
    const yaw = n.p.z < 1500 && n.p.x < 1000 && n.p.z > 400 ? (33.7 * Math.PI) / 180 : 0;
    // search round the real address for a clear lot (the street grid is approximate)
    const tries = [[0, 0], [25, 0], [-25, 0], [0, 25], [0, -25], [40, 30], [-40, 30], [40, -30], [-40, -30], [60, 0], [-60, 0], [0, 60], [0, -60]];
    for (const [dx, dz] of tries) {
      const p = { x: n.p.x + dx, z: n.p.z + dz };
      const save = n.p;
      n.p = p;
      const ok = towerAt(p.x, p.z, (n.w ?? 40) + 18, (n.d ?? 26) + 16, yaw, n.h, R() * 100);
      n.p = save;
      if (ok) break;
    }
  }

  // ---- Brickell Key, the rest of its ring
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const c = ll(25.7679, -80.1836);
    towerAt(c.x + Math.cos(a) * 120, c.z + Math.sin(a) * 100, 50, 46, a, 90 + R() * 40, R() * 100);
  }

  console.info('[shot] [buildings]', JSON.stringify(stats), 'colliders', B.colliders.length, 'named left', named.filter((n) => !n.used).map((n) => n.name).join(', '));
  const group = new THREE.Group();
  group.name = 'Buildings';
  const fm = facadeMaterial();
  group.add(chunkMeshes(B.walls, 1000, fm, { cast: true, receive: true, name: 'walls' }));
  group.add(chunkMeshes(B.roofs, 1000, roofMaterial(), { cast: false, receive: true, name: 'roofs' }));
  if (B.canopies.count) group.add(chunkMeshes(B.canopies, 800, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), { cast: true, receive: true, name: 'awnings' }));
  if (B.lots.count) group.add(chunkMeshes(B.lots, 1200, lotMaterial(), { receive: true, name: 'lots' }));
  if (B.slabs.count) {
    group.add(chunkMeshes(B.slabs, 700, new THREE.MeshStandardMaterial({ color: 0xe9e7e2, roughness: 0.78, metalness: 0 }), { cast: true, receive: true, name: 'balconies' }));
    const railMat = new THREE.MeshPhysicalMaterial({ color: 0xbfd6dc, roughness: 0.18, metalness: 0.1, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
    group.add(chunkMeshes(B.rails, 700, railMat, { cast: false, receive: true, name: 'rails' }));
  }
  if (B.pools.count) {
    const pm = new THREE.MeshStandardMaterial({ color: 0x2bb5c8, roughness: 0.05, metalness: 0.1, emissive: 0x0a5a66, emissiveIntensity: 0.25 });
    group.add(chunkMeshes(B.pools, 2000, pm, { name: 'pools' }));
  }
  return { group, colliders: B.colliders, open, roofs: B.roofTops, decks: B.decks, crowns: B.crowns, decoSigns, landmarks };
}

const PR = { s: 0, lat: 0, y: 0, tx: 0, tz: 0, off: false, i: 0, t: 0 };

function densityOf(d: GridDistrict, p: P2, H: number): 'tower' | 'midrise' | 'lowrise' | 'residential' | 'deco' | 'park' {
  if (d.id === 'southbeach') {
    if (H > 60) return 'tower';
    // Flamingo Park
    const fp = ll(25.7845, -80.1365);
    if (Math.abs(p.x - fp.x) < 160 && Math.abs(p.z - fp.z) < 260) return 'park';
    return 'deco';
  }
  if (d.id === 'havana') return H > 40 ? 'midrise' : 'residential';
  if (H > 75) return 'tower';
  if (H > 30) return 'midrise';
  // west of I-95: Overtown, Allapattah, Little Havana: shops on the avenues, houses behind
  if (p.x < ll(0, -80.2045).x) return 'residential';
  return 'lowrise';
}
