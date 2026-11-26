// Port Palmera layout: road graph, districts, ground heights, colliders and building lots.
import { Rng, clamp, lerp } from '../core/math';

export const WATER_Y = -0.8;
export const ROAD_HALF = 6; // half width of a road (m)
export const SIDEWALK = 4; // sidewalk width (m)
export const LANE_OFF = 3; // lane centre offset from road centre (m)

// Mainland grid lines
export const XS = [-560, -480, -400, -320, -240, -160, -80, 0, 80, 160, 240, 320, 388];
export const ZS = [-580, -500, -420, -340, -260, -180, -100, -20, 60, 140, 220, 300, 380, 460, 540];
const SWAMP_Z = new Set([-420, -180, 60, 300, 540]);
// Barrier island (Coquina Key) grid lines
export const IXS = [600, 670];
export const IZS = [-580, -420, -260, -100, 60, 220, 380, 540];

export const MAIN = { x0: -720, x1: 400, z0: -620, z1: 620 };
export const ISLAND = { x0: 560, x1: 712, z0: -660, z1: 660 };
export const BEACH = { x0: 676, x1: 800 };
export const BRIDGE = { z: -260, x0: 400, x1: 560, half: 7, peak: 7.5 };
export const WORLD = { x0: -900, x1: 1000, z0: -800, z1: 800 };

export type Region = 'ocean' | 'bay' | 'beach' | 'island' | 'downtown' | 'harbor' | 'suburb' | 'swamp' | 'marina';

export const DISTRICTS: { name: string; x: number; z: number }[] = [
  { name: 'Coquina Key', x: 640, z: 180 },
  { name: 'Downtown Palmera', x: 230, z: -330 },
  { name: 'Harborside', x: 170, z: 260 },
  { name: 'Pelican Marina', x: 352, z: 300 },
  { name: 'Sabal Heights', x: -200, z: 0 },
  { name: 'Gator Flats', x: -620, z: -60 },
  { name: 'Halfmoon Bay', x: 480, z: 100 },
  { name: 'Royal Tern Causeway', x: 480, z: -300 },
];

export function regionAt(x: number, z: number): Region {
  if (x >= MAIN.x0 && x <= MAIN.x1 && z >= MAIN.z0 && z <= MAIN.z1) {
    if (x < -480) return 'swamp';
    if (x < 80) return 'suburb';
    if (z < -20) return 'downtown';
    if (x > 300 && z > 60 && z < 400) return 'marina';
    return 'harbor';
  }
  if (z >= ISLAND.z0 && z <= ISLAND.z1) {
    if (x >= ISLAND.x0 && x < BEACH.x0) return 'island';
    if (x >= BEACH.x0 && x <= BEACH.x1) return 'beach';
    if (x > MAIN.x1 && x < ISLAND.x0) return 'bay';
  }
  if (x > MAIN.x1 && x < ISLAND.x0 && z > MAIN.z0 - 200 && z < MAIN.z1 + 200) return 'bay';
  return 'ocean';
}

export function bridgeDeckY(x: number): number {
  if (x <= BRIDGE.x0 || x >= BRIDGE.x1) return 0;
  return BRIDGE.peak * Math.sin((Math.PI * (x - BRIDGE.x0)) / (BRIDGE.x1 - BRIDGE.x0));
}

/** Terrain height ignoring bridge and docks. */
export function groundBase(x: number, z: number): number {
  if (x >= MAIN.x0 && x <= MAIN.x1 && z >= MAIN.z0 && z <= MAIN.z1) return 0;
  if (z >= ISLAND.z0 && z <= ISLAND.z1 && x >= ISLAND.x0) {
    if (x <= ISLAND.x1) return 0;
    if (x <= BEACH.x1 + 60) return lerp(0, -3.2, (x - ISLAND.x1) / (BEACH.x1 - ISLAND.x1));
  }
  return -6;
}

export interface Platform {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y: number;
}
export const platforms: Platform[] = [];

/** Ground height at (x,z) for something currently at height refY. */
export function groundAt(x: number, z: number, refY = 1e9): number {
  let g = groundBase(x, z);
  if (Math.abs(z - BRIDGE.z) < BRIDGE.half && x > BRIDGE.x0 - 1 && x < BRIDGE.x1 + 1) {
    const d = bridgeDeckY(x);
    if (refY > d - 2.2) g = Math.max(g, d);
  }
  const base = g;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1 || refY <= p.y - 1.6) continue;
    // a floor below the street (the walk-in stores) counts only for someone already down there
    if (p.y < base - 2) {
      if (refY < base - 2) return p.y;
      continue;
    }
    g = Math.max(g, p.y);
  }
  return g;
}

export function isWater(x: number, z: number): boolean {
  return groundBase(x, z) < WATER_Y - 0.5;
}

// ---------------------------------------------------------------- colliders
export interface Box {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
  stamp: number;
  /** street furniture (planters, bins, hydrants): blocks people, not cars or the camera */
  small?: boolean;
}

export interface RayHit {
  t: number;
  nx: number;
  ny: number;
  nz: number;
  box: Box | null;
}

export class ColliderGrid {
  readonly cell = 32;
  readonly ox = WORLD.x0;
  readonly oz = WORLD.z0;
  readonly nx: number;
  readonly nz: number;
  cells: Box[][];
  boxes: Box[] = [];
  private stamp = 1;

  constructor() {
    this.nx = Math.ceil((WORLD.x1 - WORLD.x0) / this.cell);
    this.nz = Math.ceil((WORLD.z1 - WORLD.z0) / this.cell);
    this.cells = [];
    for (let i = 0; i < this.nx * this.nz; i++) this.cells.push([]);
  }

  add(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, small = false): Box {
    const b: Box = { x0, z0, x1, z1, y0, y1, stamp: 0, small };
    this.boxes.push(b);
    const cx0 = this.cx(x0), cx1 = this.cx(x1), cz0 = this.cz(z0), cz1 = this.cz(z1);
    for (let i = cx0; i <= cx1; i++) for (let j = cz0; j <= cz1; j++) this.cells[j * this.nx + i].push(b);
    return b;
  }

  private cx(x: number) {
    return clamp(Math.floor((x - this.ox) / this.cell), 0, this.nx - 1);
  }
  private cz(z: number) {
    return clamp(Math.floor((z - this.oz) / this.cell), 0, this.nz - 1);
  }

  query(x0: number, z0: number, x1: number, z1: number, out: Box[]): Box[] {
    out.length = 0;
    const s = ++this.stamp;
    const cx0 = this.cx(x0), cx1 = this.cx(x1), cz0 = this.cz(z0), cz1 = this.cz(z1);
    for (let i = cx0; i <= cx1; i++)
      for (let j = cz0; j <= cz1; j++) {
        const c = this.cells[j * this.nx + i];
        for (let k = 0; k < c.length; k++) {
          const b = c[k];
          if (b.stamp === s) continue;
          b.stamp = s;
          if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
          out.push(b);
        }
      }
    return out;
  }

  /** Push a circle out of boxes overlapping the vertical range [y0,y1]. Returns push vector or null. */
  resolveCircle(x: number, z: number, r: number, y0: number, y1: number, tmp: Box[], skipSmall = false): { x: number; z: number; nx: number; nz: number; small: boolean } | null {
    this.query(x - r, z - r, x + r, z + r, tmp);
    let px = x, pz = z, hit = false, nx = 0, nz = 0, small = false;
    for (const b of tmp) {
      if (b.y1 <= y0 || b.y0 >= y1 || (skipSmall && b.small)) continue;
      const cx = clamp(px, b.x0, b.x1), cz = clamp(pz, b.z0, b.z1);
      let dx = px - cx, dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (b.small) small = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        dx /= d;
        dz /= d;
        px = cx + dx * r;
        pz = cz + dz * r;
        nx += dx;
        nz += dz;
      } else {
        // centre inside the box: push out along the shallowest axis
        const l = px - b.x0, rr = b.x1 - px, t = pz - b.z0, bo = b.z1 - pz;
        const m = Math.min(l, rr, t, bo);
        if (m === l) { px = b.x0 - r; nx -= 1; }
        else if (m === rr) { px = b.x1 + r; nx += 1; }
        else if (m === t) { pz = b.z0 - r; nz -= 1; }
        else { pz = b.z1 + r; nz += 1; }
      }
    }
    if (!hit) return null;
    const nl = Math.hypot(nx, nz) || 1;
    return { x: px, z: pz, nx: nx / nl, nz: nz / nl, small };
  }

  /** 3D ray against boxes using a 2D DDA over the grid. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, skipSmall = false): RayHit | null {
    const s = ++this.stamp;
    let best: RayHit | null = null;
    let cx = Math.floor((ox - this.ox) / this.cell);
    let cz = Math.floor((oz - this.oz) / this.cell);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? this.cell / Math.abs(dx) : 1e9;
    const tdz = Math.abs(dz) > 1e-9 ? this.cell / Math.abs(dz) : 1e9;
    const bx = this.ox + (cx + (dx > 0 ? 1 : 0)) * this.cell;
    const bz = this.oz + (cz + (dz > 0 ? 1 : 0)) * this.cell;
    let tmx = Math.abs(dx) > 1e-9 ? (bx - ox) / dx : 1e9;
    let tmz = Math.abs(dz) > 1e-9 ? (bz - oz) / dz : 1e9;
    let tCell = 0;
    for (let iter = 0; iter < 400; iter++) {
      if (cx >= 0 && cz >= 0 && cx < this.nx && cz < this.nz) {
        const c = this.cells[cz * this.nx + cx];
        for (let k = 0; k < c.length; k++) {
          const b = c[k];
          if (b.stamp === s) continue;
          b.stamp = s;
          if (skipSmall && b.small) continue;
          const h = rayBox(ox, oy, oz, dx, dy, dz, b);
          if (h && h.t <= maxT && (!best || h.t < best.t)) best = h;
        }
      }
      const tNext = Math.min(tmx, tmz);
      if (best && best.t <= tNext) break;
      tCell = tNext;
      if (tCell > maxT) break;
      if (tmx < tmz) { tmx += tdx; cx += stepX; } else { tmz += tdz; cz += stepZ; }
    }
    return best;
  }
}

function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box): RayHit | null {
  let tmin = -1e9, tmax = 1e9, nx = 0, ny = 0, nz = 0;
  const axis = (o: number, d: number, lo: number, hi: number, id: number): boolean => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    let t1 = (lo - o) / d, t2 = (hi - o) / d, n = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; n = 1; }
    if (t1 > tmin) {
      tmin = t1;
      nx = ny = nz = 0;
      if (id === 0) nx = n; else if (id === 1) ny = n; else nz = n;
    }
    if (t2 < tmax) tmax = t2;
    return tmin <= tmax;
  };
  if (!axis(ox, dx, b.x0, b.x1, 0)) return null;
  if (!axis(oy, dy, b.y0, b.y1, 1)) return null;
  if (!axis(oz, dz, b.z0, b.z1, 2)) return null;
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, nx: -dx, ny: -dy, nz: -dz, box: b };
  return { t: tmin, nx, ny, nz, box: b };
}

// ---------------------------------------------------------------- road graph
export interface RNode {
  id: number;
  x: number;
  z: number;
  edges: number[];
  light: boolean;
  phase: number;
}
export interface REdge {
  id: number;
  a: number;
  b: number;
  len: number;
  dx: number;
  dz: number;
  bridge: boolean;
  swamp: boolean;
}

export interface Block {
  id: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  region: Region;
  park: boolean;
  walk: boolean;
}

export interface BuildingSpec {
  x: number; // centre
  z: number;
  w: number; // x size
  d: number; // z size
  h: number;
  y0: number;
  color: number;
  style: number; // 0 glass, 1 deco, 2 house, 3 shop/apartment, 4 plain
  seed: number;
  roof: 0 | 1; // 1 = gable roof
  roofColor: number;
  collide: boolean;
}

export interface PropSpec {
  x: number;
  z: number;
  s: number;
  r: number;
  kind: 'palm' | 'tree' | 'cypress' | 'lamp' | 'umbrella' | 'bush' | 'lounger' | 'tower';
  color?: number;
}

export interface ParkingSpot {
  x: number;
  z: number;
  h: number;
  region: Region;
}

export interface PoolSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  kind: 'pool' | 'pond' | 'court' | 'lot' | 'plaza' | 'grass';
}

export class CityMap {
  nodes: RNode[] = [];
  edges: REdge[] = [];
  nodeIndex = new Map<string, number>();
  blocks: Block[] = [];
  buildings: BuildingSpec[] = [];
  props: PropSpec[] = [];
  parking: ParkingSpot[] = [];
  flats: PoolSpec[] = [];
  colliders = new ColliderGrid();
  docks: Platform[] = [];
  moored: { x: number; z: number; h: number; color: number }[] = [];
  hospital = { x: 150, z: 128, h: 0 };
  policeHQ = { x: 92, z: -480, h: 0 };

  constructor() {
    this.buildGraph();
    this.buildBlocks();
    const rng = new Rng(20261125);
    this.buildMarina(rng);
    for (const b of this.blocks) this.fillBlock(b, rng);
    this.buildSwamp(rng);
    this.buildStreetProps(rng);
    this.buildBeach(rng);
    this.buildBridgeColliders();
    for (const b of this.buildings) if (b.collide) this.colliders.add(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, b.y0 - 1, b.y0 + b.h);
    for (const p of this.props) {
      if (p.kind === 'palm' || p.kind === 'tree' || p.kind === 'lamp' || p.kind === 'cypress' || p.kind === 'tower') {
        const r = p.kind === 'tower' ? 1.6 : p.kind === 'lamp' ? 0.18 : 0.3 * p.s;
        this.colliders.add(p.x - r, p.z - r, p.x + r, p.z + r, -1, 6);
      }
    }
  }

  // ---------------------------------------------------------- graph
  private node(x: number, z: number): number {
    const k = `${x},${z}`;
    let id = this.nodeIndex.get(k);
    if (id === undefined) {
      id = this.nodes.length;
      this.nodes.push({ id, x, z, edges: [], light: false, phase: 0 });
      this.nodeIndex.set(k, id);
    }
    return id;
  }

  private edge(ax: number, az: number, bx: number, bz: number, bridge = false, swamp = false) {
    const a = this.node(ax, az), b = this.node(bx, bz);
    const len = Math.hypot(bx - ax, bz - az);
    const e: REdge = { id: this.edges.length, a, b, len, dx: (bx - ax) / len, dz: (bz - az) / len, bridge, swamp };
    this.edges.push(e);
    this.nodes[a].edges.push(e.id);
    this.nodes[b].edges.push(e.id);
  }

  private buildGraph() {
    for (const z of ZS)
      for (let i = 0; i < XS.length - 1; i++) {
        const xa = XS[i], xb = XS[i + 1];
        if (xa >= -480 || SWAMP_Z.has(z)) this.edge(xa, z, xb, z, false, xa < -480);
      }
    for (const x of XS)
      for (let j = 0; j < ZS.length - 1; j++) this.edge(x, ZS[j], x, ZS[j + 1], false, x < -480);
    for (const x of IXS) for (let j = 0; j < IZS.length - 1; j++) this.edge(x, IZS[j], x, IZS[j + 1]);
    for (const z of IZS) this.edge(IXS[0], z, IXS[1], z);
    this.edge(388, BRIDGE.z, 600, BRIDGE.z, true);
    for (const n of this.nodes) {
      n.light = n.edges.length >= 3 && n.x >= -480;
      n.phase = ((n.x * 7 + n.z * 13) % 20 + 20) % 20;
    }
  }

  otherEnd(e: REdge, n: number): number {
    return e.a === n ? e.b : e.a;
  }

  nearestNode(x: number, z: number): RNode {
    let best = this.nodes[0], bd = 1e18;
    for (const n of this.nodes) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /** Nearest point on any road centre line. */
  nearestRoad(x: number, z: number): { e: REdge; t: number; dist: number; px: number; pz: number } {
    let best = { e: this.edges[0], t: 0, dist: 1e18, px: 0, pz: 0 };
    for (const e of this.edges) {
      const A = this.nodes[e.a];
      const t = clamp((x - A.x) * e.dx + (z - A.z) * e.dz, 0, e.len);
      const px = A.x + e.dx * t, pz = A.z + e.dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best.dist) best = { e, t, dist: d, px, pz };
    }
    return best;
  }

  /** Breadth-first path of node ids from a to b. */
  path(from: number, to: number): number[] {
    if (from === to) return [from];
    const prev = new Int32Array(this.nodes.length).fill(-1);
    prev[from] = from;
    const q = [from];
    for (let qi = 0; qi < q.length; qi++) {
      const n = q[qi];
      if (n === to) break;
      for (const eid of this.nodes[n].edges) {
        const m = this.otherEnd(this.edges[eid], n);
        if (prev[m] === -1) { prev[m] = n; q.push(m); }
      }
    }
    if (prev[to] === -1) return [];
    const out = [to];
    let c = to;
    while (c !== from) { c = prev[c]; out.push(c); }
    return out.reverse();
  }

  edgeBetween(a: number, b: number): REdge | null {
    for (const eid of this.nodes[a].edges) {
      const e = this.edges[eid];
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e;
    }
    return null;
  }

  // ---------------------------------------------------------- blocks
  private buildBlocks() {
    const add = (x0: number, z0: number, x1: number, z1: number, walk: boolean) => {
      if (x1 - x0 < 8 || z1 - z0 < 8) return;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      this.blocks.push({ id: this.blocks.length, x0, z0, x1, z1, region: regionAt(cx, cz), park: false, walk });
    };
    // mainland (east of the swamp)
    const bx = [-480, ...XS.slice(2), MAIN.x1];
    const bz = [MAIN.z0, ...ZS, MAIN.z1];
    for (let i = 0; i < bx.length - 1; i++)
      for (let j = 0; j < bz.length - 1; j++) {
        const x0 = bx[i] + ROAD_HALF;
        const x1 = i === bx.length - 2 ? bx[i + 1] - 1 : bx[i + 1] - ROAD_HALF;
        const z0 = j === 0 ? bz[j] + 1 : bz[j] + ROAD_HALF;
        const z1 = j === bz.length - 2 ? bz[j + 1] - 1 : bz[j + 1] - ROAD_HALF;
        add(x0, z0, x1, z1, j > 0 && j < bz.length - 2 && i < bx.length - 2);
      }
    // island
    const ibx = [ISLAND.x0, 600, 670];
    const ibz = [ISLAND.z0, ...IZS, ISLAND.z1];
    for (let i = 0; i < ibx.length - 1; i++)
      for (let j = 0; j < ibz.length - 1; j++) {
        const x0 = i === 0 ? ibx[0] + 1 : ibx[i] + ROAD_HALF;
        const x1 = ibx[i + 1] - ROAD_HALF;
        const z0 = j === 0 ? ibz[j] + 1 : ibz[j] + ROAD_HALF;
        const z1 = j === ibz.length - 2 ? ibz[j + 1] - 1 : ibz[j + 1] - ROAD_HALF;
        add(x0, z0, x1, z1, j > 0 && j < ibz.length - 2);
      }
    // parks
    for (const b of this.blocks) {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      if (b.region === 'suburb' && ((Math.abs(cx + 200) < 30 && Math.abs(cz - 100) < 30) || (Math.abs(cx + 360) < 30 && Math.abs(cz + 380) < 30))) b.park = true;
      if (b.region === 'downtown' && Math.abs(cx - 200) < 30 && Math.abs(cz + 220) < 30) b.park = true;
    }
  }

  blockAt(x: number, z: number): Block | null {
    for (const b of this.blocks) if (x >= b.x0 - 0.5 && x <= b.x1 + 0.5 && z >= b.z0 - 0.5 && z <= b.z1 + 0.5) return b;
    return null;
  }

  // ---------------------------------------------------------- contents
  private addBuilding(x: number, z: number, w: number, d: number, h: number, color: number, style: number, rng: Rng, roof: 0 | 1 = 0, roofColor = 0x8a7a70, y0 = 0, collide = true) {
    rng.next(); // (still drawn, so everything generated after keeps its place)
    // the seed comes from the footprint's centre, so a tower and its set-back tiers share their glass
    const seed = (((Math.sin(Math.round(x) * 12.9898 + Math.round(z) * 78.233) * 43758.5453) % 1) + 1) % 1;
    this.buildings.push({ x, z, w, d, h, y0, color, style, seed, roof, roofColor, collide });
  }

  private fillBlock(b: Block, rng: Rng) {
    const ix0 = b.x0 + SIDEWALK, ix1 = b.x1 - SIDEWALK, iz0 = b.z0 + SIDEWALK, iz1 = b.z1 - SIDEWALK;
    const W = ix1 - ix0, D = iz1 - iz0, cx = (ix0 + ix1) / 2, cz = (iz0 + iz1) / 2;
    if (W < 6 || D < 6) return;
    if (b.park) {
      this.flats.push({ x: cx, z: cz, w: W, d: D, kind: b.region === 'downtown' ? 'plaza' : 'grass' });
      const n = Math.floor(W * D / 140);
      for (let i = 0; i < n; i++) this.props.push({ x: rng.range(ix0 + 3, ix1 - 3), z: rng.range(iz0 + 3, iz1 - 3), s: rng.range(0.8, 1.2), r: rng.range(0, 6.28), kind: b.region === 'downtown' ? 'palm' : rng.chance(0.6) ? 'tree' : 'palm' });
      if (b.region === 'suburb') this.flats.push({ x: cx + 12, z: cz - 12, w: 18, d: 28, kind: 'court' });
      return;
    }
    switch (b.region) {
      case 'downtown': {
        if (b.x1 > 390) {
          // bayfront promenade strip
          for (let z = iz0 + 4; z < iz1; z += 14) this.props.push({ x: cx, z, s: rng.range(0.9, 1.15), r: rng.range(0, 6.28), kind: 'palm' });
          return;
        }
        const dc = Math.hypot(cx - 250, cz + 320);
        const baseH = 40 + 120 * clamp(1 - dc / 330, 0, 1);
        const frame = [0xd5dde2, 0xb7c6cf, 0xe6dccd, 0x9fb1bd, 0xd9cbbf, 0xa9c4d4, 0xf0e8dc];
        const layout = rng.int(0, 2);
        const towers: [number, number, number, number][] = [];
        if (layout === 0) towers.push([cx, cz, W - 6, D - 6]);
        else if (layout === 1) {
          towers.push([cx - W / 4, cz, W / 2 - 5, D - 8], [cx + W / 4, cz, W / 2 - 5, D - 8]);
        } else {
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) towers.push([cx + (sx * W) / 4, cz + (sz * D) / 4, W / 2 - 5, D / 2 - 5]);
        }
        // podium
        this.addBuilding(cx, cz, W, D, rng.range(5, 9), 0xe8e0d4, 3, rng);
        for (const [tx, tz, tw, td] of towers) {
          const h = Math.max(22, baseH * rng.range(0.5, 1.15) * (towers.length > 2 ? 0.7 : 1));
          const col = rng.pick(frame);
          const style = rng.chance(0.8) ? 0 : 3;
          this.addBuilding(tx, tz, tw, td, h, col, style, rng);
          if (rng.chance(0.5) && h > 50) {
            const h2 = rng.range(10, 30);
            this.addBuilding(tx, tz, tw * 0.65, td * 0.65, h2, col, style, rng, 0, 0, h, false);
            this.addBuilding(tx, tz, tw * 0.2, td * 0.2, rng.range(3, 8), 0x9aa3a8, 4, rng, 0, 0, h + h2, false);
          } else {
            this.addBuilding(tx + tw * 0.15, tz, tw * 0.3, td * 0.3, 3, 0x9aa3a8, 4, rng, 0, 0, h, false);
          }
        }
        for (let x = ix0 + 2; x < ix1; x += 16) {
          this.props.push({ x, z: b.z0 + 2.2, s: 0.9, r: rng.range(0, 6), kind: 'palm' });
          this.props.push({ x, z: b.z1 - 2.2, s: 0.9, r: rng.range(0, 6), kind: 'palm' });
        }
        this.parking.push({ x: b.x0 - 1.0, z: cz + rng.range(-20, 20), h: Math.PI, region: b.region });
        return;
      }
      case 'harbor':
      case 'marina': {
        if (b.region === 'marina' || (b.x1 > 390 && b.z0 > 40)) {
          if (b.x1 > 390) {
            // waterfront boardwalk
            for (let z = iz0 + 4; z < iz1; z += 12) this.props.push({ x: cx, z, s: rng.range(0.9, 1.1), r: rng.range(0, 6.28), kind: 'palm' });
            return;
          }
          // boat sheds and a parking lot
          this.addBuilding(cx - W / 4, cz - D / 4, W / 2 - 4, D / 2 - 4, rng.range(8, 12), rng.pick([0xf2f2ee, 0xcfe3ee, 0xe9dfc9]), 4, rng, 1, 0x6f8fa6);
          this.addBuilding(cx + W / 4, cz + D / 4, W / 2 - 4, D / 2 - 6, rng.range(5, 8), rng.pick([0x8fc1d4, 0xf2d0a4, 0xf2f2ee]), 3, rng);
          this.flats.push({ x: cx + W / 4, z: cz - D / 4, w: W / 2 - 2, d: D / 2 - 2, kind: 'lot' });
          for (let i = 0; i < 5; i++) this.parking.push({ x: cx + W / 4 - 12 + i * 6, z: cz - D / 4, h: 0, region: 'marina' });
          return;
        }
        const pastel = [0xf6c6b5, 0xf9e2ae, 0xbfe3d0, 0xc9d7f2, 0xf2b8c6, 0xffffff, 0xd8c8ee, 0xa9dfe0];
        // buildings along each side
        const depth = 16;
        const sides: [number, number, number, number, boolean][] = [
          [ix0, iz0, ix1, iz0 + depth, true],
          [ix0, iz1 - depth, ix1, iz1, true],
          [ix0, iz0 + depth + 2, ix0 + depth, iz1 - depth - 2, false],
          [ix1 - depth, iz0 + depth + 2, ix1, iz1 - depth - 2, false],
        ];
        for (const [x0, z0, x1, z1, horiz] of sides) {
          const len = horiz ? x1 - x0 : z1 - z0;
          let p = 0;
          while (p < len - 8) {
            const seg = Math.min(len - p, rng.range(14, 26));
            const h = rng.range(8, 20);
            if (horiz) this.addBuilding(x0 + p + seg / 2, (z0 + z1) / 2, seg - 1.5, z1 - z0, h, rng.pick(pastel), 3, rng);
            else this.addBuilding((x0 + x1) / 2, z0 + p + seg / 2, x1 - x0, seg - 1.5, h, rng.pick(pastel), 3, rng);
            p += seg;
          }
        }
        this.flats.push({ x: cx, z: cz, w: W - depth * 2 - 2, d: D - depth * 2 - 2, kind: 'lot' });
        this.parking.push({ x: cx - 6, z: cz, h: 0, region: b.region }, { x: cx + 6, z: cz, h: Math.PI, region: b.region });
        this.props.push({ x: cx, z: cz + 10, s: 1, r: rng.range(0, 6), kind: 'palm' });
        return;
      }
      case 'suburb': {
        const houseCols = [0xf4ecd8, 0xf7d9c4, 0xd6eadf, 0xdfe7f2, 0xf9f1b9, 0xf0d0d8, 0xe8dccb, 0xcfe0e8, 0xffffff];
        const roofCols = [0x9b6b54, 0x7c8b93, 0xb5764f, 0x6e6a66, 0xc49a6c];
        const pitch = 17;
        const setback = 6;
        const hw = 11, hd = 9;
        const doSide = (horiz: boolean, fixed: number, a0: number, a1: number, dir: number) => {
          const n = Math.floor((a1 - a0 - 4) / pitch);
          const off = (a1 - a0 - n * pitch) / 2;
          for (let i = 0; i < n; i++) {
            const a = a0 + off + pitch * (i + 0.5);
            const c = fixed + dir * (setback + hd / 2);
            const h = rng.chance(0.3) ? rng.range(6, 7) : rng.range(3.4, 4.2);
            const col = rng.pick(houseCols);
            if (horiz) this.addBuilding(a, c, hw, hd, h, col, 2, rng, 1, rng.pick(roofCols));
            else this.addBuilding(c, a, hd, hw, h, col, 2, rng, 1, rng.pick(roofCols));
            // driveway car
            if (rng.chance(0.28)) {
              const dc = fixed + dir * 2.6;
              const da = a + hw / 2 + 2.2;
              if (horiz) this.parking.push({ x: da, z: dc, h: dir > 0 ? 0 : Math.PI, region: 'suburb' });
              else this.parking.push({ x: dc, z: da, h: dir > 0 ? Math.PI / 2 : -Math.PI / 2, region: 'suburb' });
            }
            // yard tree / palm
            if (rng.chance(0.6)) {
              const tc = fixed + dir * rng.range(1.5, 3.5);
              const ta = a - hw / 2 + rng.range(-1, 2);
              const kind = rng.chance(0.55) ? 'palm' : 'tree';
              if (horiz) this.props.push({ x: ta, z: tc, s: rng.range(0.7, 1.05), r: rng.range(0, 6), kind });
              else this.props.push({ x: tc, z: ta, s: rng.range(0.7, 1.05), r: rng.range(0, 6), kind });
            }
          }
        };
        doSide(true, iz0, ix0, ix1, 1);
        doSide(true, iz1, ix0, ix1, -1);
        doSide(false, ix0, iz0 + 24, iz1 - 24, 1);
        doSide(false, ix1, iz0 + 24, iz1 - 24, -1);
        // backyards: pools and trees
        const pools = rng.int(1, 3);
        for (let i = 0; i < pools; i++) this.flats.push({ x: rng.range(cx - 12, cx + 12), z: rng.range(cz - 12, cz + 12), w: rng.range(4, 7), d: rng.range(6, 9), kind: 'pool' });
        for (let i = 0; i < 4; i++) this.props.push({ x: rng.range(cx - 16, cx + 16), z: rng.range(cz - 16, cz + 16), s: rng.range(0.8, 1.3), r: rng.range(0, 6), kind: 'tree' });
        return;
      }
      case 'island': {
        if (b.x1 > 640) {
          // deco hotels facing the beach
          const deco = [0xf6a9c0, 0x9fe3c9, 0xffcfa8, 0xd2c0f0, 0x9fd6ef, 0xfff0a0, 0xff9f86, 0x86dce9, 0xfde2e4];
          let p = iz0 + 2;
          while (p < iz1 - 20) {
            const len = Math.min(iz1 - p, rng.range(32, 46));
            const h = rng.range(12, 30);
            const depth = rng.range(26, W - 4);
            const col = rng.pick(deco);
            const hx = ix1 - depth / 2;
            this.addBuilding(hx, p + len / 2, depth, len - 4, h, col, 1, rng);
            // stepped crown
            const cw = rng.range(0.3, 0.55);
            this.addBuilding(hx + depth * 0.2, p + len / 2, depth * 0.45, (len - 4) * cw, rng.range(3, 7), 0xfaf6ef, 1, rng, 0, 0, h, false);
            // vertical fin facing the ocean
            this.addBuilding(ix1 + 0.6, p + len / 2, 1.2, rng.range(2, 4), h + rng.range(3, 8), rng.chance(0.5) ? 0xffffff : 0x3ec7c2, 4, rng, 0, 0, 0, false);
            p += len;
          }
          for (let z = b.z0 + 6; z < b.z1; z += 22) this.props.push({ x: b.x0 + 2.5, z, s: rng.range(0.9, 1.1), r: rng.range(0, 6), kind: 'palm' });
          this.parking.push({ x: b.x1 + 1.5, z: cz + rng.range(-40, 40), h: 0, region: 'island' });
          return;
        }
        // west strip: low shops
        const shop = [0xfff3e0, 0xf8d8c8, 0xc8ecd8, 0xd8e8f8, 0xf8e8a8];
        let p = iz0 + 2;
        while (p < iz1 - 10) {
          const len = Math.min(iz1 - p, rng.range(14, 24));
          this.addBuilding(ix1 - 9, p + len / 2, 16, len - 2, rng.range(5, 9), rng.pick(shop), 3, rng);
          p += len + rng.range(2, 8);
        }
        for (let z = b.z0 + 4; z < b.z1; z += 18) this.props.push({ x: b.x1 - 2, z, s: rng.range(0.9, 1.1), r: rng.range(0, 6), kind: 'palm' });
        return;
      }
      default:
        return;
    }
  }

  private buildSwamp(rng: Rng) {
    // ponds, cypress groves and a few stilt shacks
    const roadClear = (x: number, z: number, m: number) => {
      if (Math.abs(x + 560) < m || Math.abs(x + 480) < m) return false;
      for (const sz of SWAMP_Z) if (Math.abs(z - sz) < m && x > -566) return false;
      return true;
    };
    for (let i = 0; i < 26; i++) {
      const x = rng.range(-710, -500), z = rng.range(-600, 600);
      const w = rng.range(14, 40), d = rng.range(14, 50);
      if (!roadClear(x, z, Math.max(w, d) / 2 + 8)) continue;
      this.flats.push({ x, z, w, d, kind: 'pond' });
    }
    for (let i = 0; i < 520; i++) {
      const x = rng.range(-715, -486), z = rng.range(-615, 615);
      if (!roadClear(x, z, 9)) continue;
      this.props.push({ x, z, s: rng.range(0.7, 1.4), r: rng.range(0, 6.28), kind: rng.chance(0.8) ? 'cypress' : 'bush' });
    }
    for (const sz of SWAMP_Z) {
      const x = rng.range(-540, -500);
      this.addBuilding(x, sz + 14, 8, 7, 3.4, rng.pick([0x8d6e57, 0x7a8b6f, 0x9c8a72]), 4, rng, 1, 0x5d5a52, 0.8);
    }
    this.parking.push({ x: -546, z: 300 - 9, h: 0, region: 'swamp' }, { x: -546, z: -180 - 9, h: Math.PI / 2, region: 'swamp' });
  }

  private buildStreetProps(rng: Rng) {
    // streetlights along both sides of every non-swamp road
    for (const e of this.edges) {
      if (e.swamp) continue;
      const A = this.nodes[e.a];
      const rx = -e.dz, rz = e.dx;
      const step = e.bridge ? 32 : 38;
      for (let t = 14; t < e.len - 10; t += step) {
        for (const side of [-1, 1]) {
          const tt = side > 0 ? t : t + step / 2;
          if (tt > e.len - 10) continue;
          const off = e.bridge ? ROAD_HALF + 0.5 : ROAD_HALF + 0.9;
          const x = A.x + e.dx * tt + rx * off * side, z = A.z + e.dz * tt + rz * off * side;
          if (!e.bridge && groundBase(x, z) < -0.1) continue;
          this.props.push({ x, z, s: 1, r: Math.atan2(-rx * side, -rz * side), kind: 'lamp' });
        }
      }
    }
  }

  private buildBeach(rng: Rng) {
    // promenade palms, umbrellas, loungers and lifeguard towers on Coquina Key's beach
    for (let z = ISLAND.z0 + 10; z < ISLAND.z1 - 10; z += 13) this.props.push({ x: BEACH.x0 + 4 + rng.range(-1, 1), z, s: rng.range(0.95, 1.25), r: rng.range(0, 6.28), kind: 'palm' });
    const umb = [0xff6f61, 0x3ec7c2, 0xffd166, 0xf78fb3, 0x6c8cff, 0xffffff];
    for (let i = 0; i < 140; i++) {
      const x = rng.range(BEACH.x0 + 14, ISLAND.x1 + 18), z = rng.range(ISLAND.z0 + 20, ISLAND.z1 - 20);
      this.props.push({ x, z, s: rng.range(0.9, 1.1), r: rng.range(0, 6.28), kind: 'umbrella', color: rng.pick(umb) });
      this.props.push({ x: x + 1.6, z: z + rng.range(-1, 1), s: 1, r: rng.range(-0.3, 0.3), kind: 'lounger', color: rng.pick(umb) });
    }
    for (let z = -560; z < 640; z += 200) this.props.push({ x: ISLAND.x1 + 8, z, s: 1, r: -Math.PI / 2, kind: 'tower', color: rng.pick([0xff8a7a, 0x7fd8d0, 0xffd27f]) });
  }

  private buildMarina(rng: Rng) {
    // piers out into Halfmoon Bay
    const pierZ = [110, 170, 230, 290, 350];
    this.docks.push({ x0: 399, z0: 96, x1: 406, z1: 364, y: 0.05 });
    for (const z of pierZ) this.docks.push({ x0: 406, z0: z - 1.6, x1: 470, z1: z + 1.6, y: 0.05 });
    for (const d of this.docks) {
      platforms.push(d);
      this.colliders.add(d.x0, d.z0, d.x1, d.z1, -3, d.y - 0.1);
    }
    const hulls = [0xffffff, 0xf2f2f2, 0x1f4e79, 0xc0392b, 0xf4d03f, 0x2e8b57];
    for (const z of pierZ)
      for (let x = 414; x < 466; x += 11) {
        for (const side of [-1, 1]) {
          if (rng.chance(0.35)) continue;
          if (z === 230 && side > 0) continue; // keep the player's berth and its way out clear
          const bz = z + side * 5.2;
          this.moored.push({ x, z: bz, h: rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, color: rng.pick(hulls) });
          this.colliders.add(x - 3.5, bz - 1.4, x + 3.5, bz + 1.4, -3, 0.0);
        }
      }
  }

  private buildBridgeColliders() {
    for (let x = BRIDGE.x0; x < BRIDGE.x1; x += 8) {
      const y = Math.min(bridgeDeckY(x), bridgeDeckY(x + 8));
      for (const s of [-1, 1]) {
        const z = BRIDGE.z + s * (BRIDGE.half - 0.3);
        this.colliders.add(x, z - 0.3, x + 8, z + 0.3, y - 0.2, y + 1.2);
      }
    }
    // pillars
    for (let x = BRIDGE.x0 + 20; x < BRIDGE.x1 - 10; x += 30) {
      const y = bridgeDeckY(x);
      for (const s of [-1, 1]) this.colliders.add(x - 1.2, BRIDGE.z + s * 4 - 1.2, x + 1.2, BRIDGE.z + s * 4 + 1.2, -6, y - 0.8);
    }
  }
}
