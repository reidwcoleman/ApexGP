import type { DressData } from './dressing.ts';

/**
 * Every street a car can take, in both districts: Ocean Drive's grid (from dressing.json) and downtown's
 * streets with the bridge (from downtown.json, which already carries the beach-side ends of the bridge
 * route: they meet the grid at 7th and Washington). Three coords (x, z). For the police: the way to you
 * (A*), the road nearest you, the corners a unit can appear at.
 */
export class RoadGraph {
  readonly x: number[] = [];
  readonly z: number[] = [];
  /** per node: [neighbour, edge index] */
  readonly adj: [number, number][][] = [];
  /** edge: from, to, polyline (x, z pairs, from -> to), length */
  readonly edges: { a: number; b: number; pts: number[]; len: number }[] = [];

  constructor(dress: DressData, dt?: { pts: [number, number][]; edges: [number, number, [number, number][], number][] } | null) {
    // the beach block's grid: every avenue x every street
    const X = [(dress.od[0] + dress.od[1]) / 2 - 0.9, ...dress.xs.map(([a, b]) => (a + b) / 2)].sort((a, b) => a - b);
    const Z = dress.ys.map(([a, b]) => -(a + b) / 2).sort((a, b) => a - b);
    const id: number[][] = X.map((x) => Z.map((z) => this.node(x, z)));
    for (let i = 0; i < X.length; i++)
      for (let j = 0; j < Z.length; j++) {
        if (i + 1 < X.length) this.edge(id[i][j], id[i + 1][j], [X[i], Z[j], X[i + 1], Z[j]]);
        if (j + 1 < Z.length) this.edge(id[i][j], id[i][j + 1], [X[i], Z[j], X[i], Z[j + 1]]);
      }
    // Ocean Drive runs on past the grid's ends
    const odx = X[0];
    this.edge(id[0][0], this.node(odx, Z[0] - 90), [odx, Z[0], odx, Z[0] - 90]);
    this.edge(id[0][Z.length - 1], this.node(odx, Z[Z.length - 1] + 90), [odx, Z[Z.length - 1], odx, Z[Z.length - 1] + 90]);
    if (!dt) return;
    // downtown: its nodes merge with the grid's where they coincide
    const map = dt.pts.map(([bx, by]) => this.node(bx, -by, 6));
    for (const [a, b, pl] of dt.edges) {
      const flat: number[] = [];
      for (const [bx, by] of pl) flat.push(bx, -by);
      this.edge(map[a], map[b], flat);
    }
  }

  private node(x: number, z: number, merge = 0.5): number {
    for (let i = 0; i < this.x.length; i++) if (Math.abs(this.x[i] - x) < merge && Math.abs(this.z[i] - z) < merge) return i;
    this.x.push(x);
    this.z.push(z);
    this.adj.push([]);
    return this.x.length - 1;
  }

  private edge(a: number, b: number, pts: number[]) {
    if (a === b) return;
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    const e = this.edges.length;
    this.edges.push({ a, b, pts, len });
    this.adj[a].push([b, e]);
    this.adj[b].push([a, e]);
  }

  nearestNode(x: number, z: number): number {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.x.length; i++) {
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** the nearest point on any street's centreline */
  nearestRoad(x: number, z: number): { x: number; z: number; d: number } {
    let bx = x, bz = z, bd = Infinity;
    for (const e of this.edges) {
      const p = e.pts;
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], az = p[i - 1], dx = p[i] - ax, dz = p[i + 1] - az;
        const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const qx = ax + dx * t, qz = az + dz * t;
        const d = (qx - x) ** 2 + (qz - z) ** 2;
        if (d < bd) {
          bd = d;
          bx = qx;
          bz = qz;
        }
      }
    }
    return { x: bx, z: bz, d: Math.sqrt(bd) };
  }

  /** the way from (fx, fz) to (tx, tz) along the streets: points to drive through, ending at the target */
  route(fx: number, fz: number, tx: number, tz: number): { x: number; z: number }[] {
    if (Math.hypot(tx - fx, tz - fz) < 30) return [{ x: tx, z: tz }];
    const s = this.nearestNode(fx, fz), g = this.nearestNode(tx, tz);
    if (s === g) return [{ x: this.x[s], z: this.z[s] }, { x: tx, z: tz }];
    const n = this.x.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const pe = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    dist[s] = 0;
    const open = [s];
    const h = (i: number) => Math.hypot(this.x[i] - this.x[g], this.z[i] - this.z[g]);
    while (open.length) {
      let bi = 0;
      for (let k = 1; k < open.length; k++) if (dist[open[k]] + h(open[k]) < dist[open[bi]] + h(open[bi])) bi = k;
      const u = open.splice(bi, 1)[0];
      if (u === g) break;
      if (done[u]) continue;
      done[u] = 1;
      for (const [v, e] of this.adj[u]) {
        const nd = dist[u] + this.edges[e].len;
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          pe[v] = e;
          open.push(v);
        }
      }
    }
    if (prev[g] < 0) return [{ x: tx, z: tz }];
    const chain: number[] = [];
    for (let v = g; v !== s; v = prev[v]) chain.push(v);
    chain.reverse();
    const out: { x: number; z: number }[] = [{ x: this.x[s], z: this.z[s] }];
    let at = s;
    for (const v of chain) {
      const e = this.edges[pe[v]];
      const p = e.pts;
      const fwd = e.a === at;
      const m = p.length / 2;
      for (let k = 1; k < m; k++) {
        const i = fwd ? k : m - 1 - k;
        out.push({ x: p[i * 2], z: p[i * 2 + 1] });
      }
      at = v;
    }
    out.push({ x: tx, z: tz });
    // thin it to a point every ~6 m
    const thin: { x: number; z: number }[] = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const q = thin[thin.length - 1];
      if (i === out.length - 1 || Math.hypot(out[i].x - q.x, out[i].z - q.z) > 6) thin.push(out[i]);
    }
    return thin;
  }

  /** junctions between r0 and r1 metres from (x, z) */
  ring(x: number, z: number, r0: number, r1: number): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < this.x.length; i++) {
      if (this.adj[i].length < 2) continue;
      const d = Math.hypot(this.x[i] - x, this.z[i] - z);
      if (d >= r0 && d <= r1) out.push([this.x[i], this.z[i]]);
    }
    return out;
  }

  /** the heading of the street leaving node nearest (x, z) that points most toward (tx, tz) */
  headingAt(x: number, z: number, tx: number, tz: number): number {
    const n = this.nearestNode(x, z);
    let best = Math.atan2(tx - x, tz - z), bd = -2;
    const want = Math.atan2(tx - x, tz - z);
    for (const [, e] of this.adj[n]) {
      const E = this.edges[e];
      const p = E.pts;
      const fwd = E.a === n;
      const i0 = fwd ? 0 : p.length - 2, i1 = fwd ? 2 : p.length - 4;
      const hd = Math.atan2(p[i1] - p[i0], p[i1 + 1] - p[i0 + 1]);
      const c = Math.cos(hd - want);
      if (c > bd) {
        bd = c;
        best = hd;
      }
    }
    return best;
  }
}
