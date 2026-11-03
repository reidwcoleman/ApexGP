// The city as data: building footprints, the street graph people and trucks walk, foot traffic per street,
// addresses, property values, rooms and doors. Built once from the baked OpenStreetMap file.
import type { CityDef } from './cities.ts';

export interface Building {
  id: number;
  pts: Float32Array; // x,z pairs, counter-clockwise
  h: number;
  kind: number;
  cx: number; cz: number;
  area: number;
  floors: number;
  name: string;
  addr: string;
  street: string;
  traffic: number; // foot traffic at the door, people / hour
  value: number;
  units: number; // ground-floor rooms to rent
  door: { x: number; z: number; nx: number; nz: number };
  edge: number; // street edge the door faces
  tri0: number; tri1: number; // triangle range in the merged mesh (filled by the renderer)
}

export interface Edge { a: number; b: number; len: number; w: number; cls: number; name: string; foot: number; car: boolean }
export interface Road { cls: number; pts: number[]; name: string }

export const ROAD_W: Record<number, number> = { 0: 6, 1: 9, 2: 11, 3: 14, 4: 18, 5: 8, 6: 3.5 };

export class City {
  def: CityDef;
  W = 0; D = 0;
  buildings: Building[] = [];
  roads: Road[] = [];
  parks: { kind: number; pts: number[] }[] = [];
  nx: Float32Array = new Float32Array(0);
  nz: Float32Array = new Float32Array(0);
  edges: Edge[] = [];
  adj: number[][] = []; // node → edge indices
  footTotal = 0;
  private grid = new Map<number, number[]>(); // 25 m cells → building ids
  private egrid = new Map<number, number[]>(); // 25 m cells → edge ids
  static CELL = 25;

  constructor(def: CityDef, raw: any) {
    this.def = def;
    this.W = raw.size[0];
    this.D = raw.size[1];
    this.parks = raw.p.map((p: number[]) => ({ kind: p[0], pts: p.slice(1) }));
    this.buildGraph(raw.r);
    this.buildBuildings(raw.b, raw.names || {});
  }

  private key(cx: number, cz: number) { return (cx + 512) * 4096 + (cz + 512); }

  private buildGraph(r: any[]) {
    const ids = new Map<string, number>();
    const xs: number[] = [], zs: number[] = [];
    const node = (x: number, z: number) => {
      const k = x.toFixed(1) + ',' + z.toFixed(1);
      let i = ids.get(k);
      if (i === undefined) { i = xs.length; ids.set(k, i); xs.push(x); zs.push(z); }
      return i;
    };
    const edges: Edge[] = [];
    for (const w of r) {
      const cls = w[0] as number;
      const name = typeof w[w.length - 1] === 'string' ? (w[w.length - 1] as string) : '';
      const pts = w.slice(1, typeof w[w.length - 1] === 'string' ? -1 : undefined) as number[];
      this.roads.push({ cls, pts, name });
      for (let i = 0; i + 3 < pts.length; i += 2) {
        const a = node(pts[i], pts[i + 1]), b = node(pts[i + 2], pts[i + 3]);
        if (a === b) continue;
        const len = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
        edges.push({ a, b, len, w: ROAD_W[cls] ?? 8, cls, name, foot: 0, car: cls <= 4 && cls >= 0 && cls !== 5 && cls !== 6 });
      }
    }
    // keep the largest connected piece so every walk and every truck can reach every other
    const n = xs.length;
    const adj: number[][] = Array.from({ length: n }, () => []);
    edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });
    const comp = new Int32Array(n).fill(-1);
    let best = -1, bestN = 0;
    for (let s = 0, c = 0; s < n; s++) {
      if (comp[s] >= 0) continue;
      const st = [s]; comp[s] = c; let cnt = 0;
      while (st.length) { const u = st.pop()!; cnt++; for (const ei of adj[u]) { const e = edges[ei]; const v = e.a === u ? e.b : e.a; if (comp[v] < 0) { comp[v] = c; st.push(v); } } }
      if (cnt > bestN) { bestN = cnt; best = c; }
      c++;
    }
    const remap = new Int32Array(n).fill(-1);
    const nx: number[] = [], nz: number[] = [];
    for (let i = 0; i < n; i++) if (comp[i] === best) { remap[i] = nx.length; nx.push(xs[i]); nz.push(zs[i]); }
    this.nx = Float32Array.from(nx);
    this.nz = Float32Array.from(nz);
    this.edges = edges.filter((e) => remap[e.a] >= 0 && remap[e.b] >= 0).map((e) => ({ ...e, a: remap[e.a], b: remap[e.b] }));
    this.adj = Array.from({ length: nx.length }, () => []);
    this.edges.forEach((e, i) => { this.adj[e.a].push(i); this.adj[e.b].push(i); });
    // edge grid
    const C = City.CELL;
    this.edges.forEach((e, i) => {
      const x0 = Math.min(this.nx[e.a], this.nx[e.b]), x1 = Math.max(this.nx[e.a], this.nx[e.b]);
      const z0 = Math.min(this.nz[e.a], this.nz[e.b]), z1 = Math.max(this.nz[e.a], this.nz[e.b]);
      for (let cx = Math.floor(x0 / C) - 1; cx <= Math.floor(x1 / C) + 1; cx++)
        for (let cz = Math.floor(z0 / C) - 1; cz <= Math.floor(z1 / C) + 1; cz++) {
          const k = this.key(cx, cz);
          let l = this.egrid.get(k); if (!l) this.egrid.set(k, (l = []));
          l.push(i);
        }
    });
    this.computeFoot();
  }

  /** Foot traffic per street: class, closeness to the busy middle, how connected the corner is, plus slow noise. */
  private computeFoot() {
    const R = Math.max(this.W, this.D) / 2;
    const clsW: Record<number, number> = { 0: 0.25, 1: 0.55, 2: 0.8, 3: 1.15, 4: 0.6, 5: 1.6, 6: 0.9 };
    let tot = 0;
    for (const e of this.edges) {
      const mx = (this.nx[e.a] + this.nx[e.b]) / 2, mz = (this.nz[e.a] + this.nz[e.b]) / 2;
      const d = Math.hypot(mx, mz) / R;
      const deg = (this.adj[e.a].length + this.adj[e.b].length) / 2;
      const hot = 0.5 + 0.5 * Math.sin(mx * 0.011 + 1.3) * Math.cos(mz * 0.009 - 0.4);
      e.foot = Math.max(0.05, (clsW[e.cls] ?? 0.5) * (1.25 - 0.7 * Math.min(1, d)) * (0.7 + 0.12 * Math.min(deg, 5)) * (0.55 + 0.9 * hot));
      tot += e.foot * e.len;
    }
    this.footTotal = tot;
  }

  private buildBuildings(raw: number[][], names: Record<string, string>) {
    const C = City.CELL;
    const land = this.def.land;
    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      const pts = Float32Array.from(r.slice(2));
      let area = 0, cx = 0, cz = 0;
      const n = pts.length / 2;
      for (let j = 0; j < n; j++) {
        const x0 = pts[j * 2], z0 = pts[j * 2 + 1], x1 = pts[((j + 1) % n) * 2], z1 = pts[((j + 1) % n) * 2 + 1];
        const c = x0 * z1 - x1 * z0;
        area += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c;
      }
      area /= 2;
      if (Math.abs(area) < 1e-3) continue;
      cx /= 6 * area; cz /= 6 * area;
      area = Math.abs(area);
      const h = r[0];
      const b: Building = {
        id: this.buildings.length, pts, h, kind: r[1], cx, cz, area, floors: Math.max(1, Math.round(h / 3.4)),
        name: names[i] || '', addr: '', street: '', traffic: 0, value: 0, units: 1, door: { x: cx, z: cz, nx: 0, nz: 1 }, edge: -1, tri0: 0, tri1: 0,
      };
      this.buildings.push(b);
      // door: the footprint vertex-edge midpoint closest to a street
      let best = 1e9;
      for (let j = 0; j < n; j++) {
        const x0 = pts[j * 2], z0 = pts[j * 2 + 1], x1 = pts[((j + 1) % n) * 2], z1 = pts[((j + 1) % n) * 2 + 1];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 3) continue;
        const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        // outward normal of a positive-area polygon in x/z: (dz, -dx)
        const ox = (z1 - z0) / len, oz = -(x1 - x0) / len;
        const q = this.nearestEdge(mx + ox * 4, mz + oz * 4, 40);
        if (q && q.d < best) { best = q.d; b.door = { x: mx, z: mz, nx: ox, nz: oz }; b.edge = q.e; }
      }
      if (b.edge < 0) { const q = this.nearestEdge(cx, cz, 400); if (q) b.edge = q.e; }
      const e = this.edges[b.edge];
      b.street = e?.name || '';
      b.traffic = e ? Math.round(e.foot * 160 * this.def.crowd) : 20;
      const per = Math.sqrt(area) * 4;
      b.units = Math.max(1, Math.min(6, Math.round(per / 26)));
      b.value = Math.round((area * b.floors * 16 + area * 60) * land * (0.6 + Math.min(2.2, b.traffic / 90)) / 100) * 100;
      // grid
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let j = 0; j < n; j++) { x0 = Math.min(x0, pts[j * 2]); x1 = Math.max(x1, pts[j * 2]); z0 = Math.min(z0, pts[j * 2 + 1]); z1 = Math.max(z1, pts[j * 2 + 1]); }
      for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++)
        for (let gz = Math.floor(z0 / C); gz <= Math.floor(z1 / C); gz++) {
          const k = this.key(gx, gz);
          let l = this.grid.get(k); if (!l) this.grid.set(k, (l = []));
          l.push(b.id);
        }
    }
    // addresses: number along the street, by position
    const byStreet = new Map<string, Building[]>();
    for (const b of this.buildings) {
      if (!b.street) continue;
      let l = byStreet.get(b.street); if (!l) byStreet.set(b.street, (l = []));
      l.push(b);
    }
    for (const [st, l] of byStreet) {
      const e = this.edges[l[0].edge];
      const dx = this.nx[e.b] - this.nx[e.a], dz = this.nz[e.b] - this.nz[e.a];
      const horiz = Math.abs(dx) > Math.abs(dz);
      l.sort((p, q) => (horiz ? p.door.x - q.door.x : p.door.z - q.door.z));
      l.forEach((b, i) => {
        const side = (horiz ? b.door.nz : b.door.nx) > 0 ? 0 : 1;
        b.addr = `${(i + 1) * 2 + side + (st.length % 7) * 10} ${st}`;
      });
    }
    for (const b of this.buildings) if (!b.addr) b.addr = `Lot ${100 + b.id}`;
  }

  buildingAt(x: number, z: number): Building | null {
    const l = this.grid.get(this.key(Math.floor(x / City.CELL), Math.floor(z / City.CELL)));
    if (!l) return null;
    for (const id of l) if (pointIn(this.buildings[id].pts, x, z)) return this.buildings[id];
    return null;
  }

  nearestEdge(x: number, z: number, maxD = 60): { e: number; t: number; d: number; px: number; pz: number } | null {
    const C = City.CELL;
    let best: { e: number; t: number; d: number; px: number; pz: number } | null = null;
    const r = Math.ceil(maxD / C);
    const gx = Math.floor(x / C), gz = Math.floor(z / C);
    const seen = new Set<number>();
    for (let cx = gx - r; cx <= gx + r; cx++)
      for (let cz = gz - r; cz <= gz + r; cz++) {
        const l = this.egrid.get(this.key(cx, cz));
        if (!l) continue;
        for (const i of l) {
          if (seen.has(i)) continue;
          seen.add(i);
          const e = this.edges[i];
          const ax = this.nx[e.a], az = this.nz[e.a], bx = this.nx[e.b], bz = this.nz[e.b];
          const dx = bx - ax, dz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          const px = ax + dx * t, pz = az + dz * t;
          const d = Math.hypot(x - px, z - pz);
          if (d < maxD && (!best || d < best.d)) best = { e: i, t, d, px, pz };
        }
      }
    return best;
  }

  /** Foot traffic (people / game hour) around a point, summed over nearby streets with distance falloff. */
  footAt(x: number, z: number, radius = 30): number {
    const C = City.CELL;
    let s = 0;
    const r = Math.ceil(radius / C);
    const gx = Math.floor(x / C), gz = Math.floor(z / C);
    const seen = new Set<number>();
    for (let cx = gx - r; cx <= gx + r; cx++)
      for (let cz = gz - r; cz <= gz + r; cz++) {
        const l = this.egrid.get(this.key(cx, cz));
        if (!l) continue;
        for (const i of l) {
          if (seen.has(i)) continue;
          seen.add(i);
          const e = this.edges[i];
          const ax = this.nx[e.a], az = this.nz[e.a], bx = this.nx[e.b], bz = this.nz[e.b];
          const dx = bx - ax, dz = bz - az;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          if (d < radius) s += e.foot * Math.min(e.len, radius) * (1 - d / radius);
        }
      }
    return Math.round(s * 4 * this.def.crowd);
  }

  /** A* over the street graph (cars only when `car`), node path. */
  path(from: number, to: number, car = true): number[] | null {
    if (from === to) return [from];
    const n = this.nx.length;
    const g = new Float32Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const open: number[] = [from];
    const f = new Float32Array(n).fill(Infinity);
    const h = (i: number) => Math.hypot(this.nx[i] - this.nx[to], this.nz[i] - this.nz[to]);
    g[from] = 0; f[from] = h(from);
    const closed = new Uint8Array(n);
    let guard = 0;
    while (open.length && guard++ < 40000) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const u = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (u === to) break;
      if (closed[u]) continue;
      closed[u] = 1;
      for (const ei of this.adj[u]) {
        const e = this.edges[ei];
        if (car && !e.car) continue;
        const v = e.a === u ? e.b : e.a;
        const ng = g[u] + e.len * (car ? (e.cls >= 3 ? 0.8 : e.cls === 0 ? 1.4 : 1) : 1);
        if (ng < g[v]) { g[v] = ng; prev[v] = u; f[v] = ng + h(v); open.push(v); }
      }
    }
    if (prev[to] < 0) return car ? this.path(from, to, false) : null;
    const p = [to];
    for (let u = to; u !== from; ) { u = prev[u]; p.push(u); }
    return p.reverse();
  }

  nearestNode(x: number, z: number, car = true): number {
    const q = this.nearestEdge(x, z, 300);
    if (!q) return 0;
    const e = this.edges[q.e];
    if (car && !e.car) {
      // walk to a car node
      let best = 0, bd = 1e12;
      for (let i = 0; i < this.nx.length; i++) {
        if (!this.adj[i].some((k) => this.edges[k].car)) continue;
        const d = (this.nx[i] - x) ** 2 + (this.nz[i] - z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    return q.t < 0.5 ? e.a : e.b;
  }

  /** The node on the city's edge nearest a bearing, for the freight terminal. */
  edgeNode(): number {
    let best = 0, bs = -1e9;
    for (let i = 0; i < this.nx.length; i++) {
      if (!this.adj[i].some((k) => this.edges[k].car && this.edges[k].cls >= 2)) continue;
      const s = this.nx[i] * 0.8 + this.nz[i];
      if (s > bs) { bs = s; best = i; }
    }
    return best;
  }
}

export function pointIn(pts: Float32Array | number[], x: number, z: number): boolean {
  let c = false;
  const n = pts.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2], zi = pts[i * 2 + 1], xj = pts[j * 2], zj = pts[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export async function loadCity(def: CityDef): Promise<City> {
  const r = await fetch(`${import.meta.env.BASE_URL}mogul/${def.id}.json`);
  if (!r.ok) throw new Error(`city ${def.id}: ${r.status}`);
  return new City(def, await r.json());
}
