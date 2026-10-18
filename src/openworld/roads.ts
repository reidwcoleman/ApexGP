import { DISTRICTS, LANDS, LandMask, ROUTES, WATER_Y, type GridDistrict, type P2, type RoadKind } from './geo.ts';

/**
 * The road network: every street of the district grids, the causeways, the interstates and the
 * ramps, as one graph. Nodes are junctions (or bends where a route meets a grid), edges carry a
 * dense centreline (x, y, z every few metres; y = the deck height above the land, so the I-95 and
 * the MacArthur bridges are real elevated roads) and the road's cross-section.
 *
 * Everything else reads this: the road and sidewalk meshes, the lane markings, the traffic (its
 * lanes, the signals), the pedestrians (the sidewalks), the physics (the height of the ground
 * under a wheel) and the minimap.
 */

export interface RoadSpec {
  /** travel lanes per direction */
  lanes: number;
  /** half the median (0 = a painted double yellow) */
  median: number;
  /** parking lane width each side (0 = none) */
  parking: number;
  /** paved shoulder each side */
  shoulder: number;
  /** sidewalk width each side (0 = none) */
  sidewalk: number;
  /** speed limit (m/s) */
  speed: number;
  /** palms in the median */
  planted: boolean;
}

export const LANE_W = 3.4;

export const SPEC: Record<RoadKind, RoadSpec> = {
  street: { lanes: 1, median: 0, parking: 2.4, shoulder: 0, sidewalk: 3.6, speed: 12.5, planted: false },
  lane: { lanes: 1, median: 0, parking: 0, shoulder: 0.3, sidewalk: 2.4, speed: 9, planted: false },
  avenue: { lanes: 2, median: 0, parking: 0, shoulder: 0.3, sidewalk: 4.2, speed: 15.6, planted: false },
  boulevard: { lanes: 3, median: 3.2, parking: 0, shoulder: 0.3, sidewalk: 5.2, speed: 17.9, planted: true },
  ocean: { lanes: 1, median: 0, parking: 2.6, shoulder: 0, sidewalk: 6.0, speed: 8.9, planted: false },
  highway: { lanes: 3, median: 0.9, parking: 0, shoulder: 2.6, sidewalk: 0, speed: 29, planted: false },
  causeway: { lanes: 3, median: 0.9, parking: 0, shoulder: 2.2, sidewalk: 0, speed: 22.4, planted: false },
  ramp: { lanes: 1, median: 0.4, parking: 0, shoulder: 2.0, sidewalk: 0, speed: 17.9, planted: false },
  service: { lanes: 1, median: 0, parking: 0, shoulder: 0.5, sidewalk: 2.0, speed: 11, planted: false },
};

export const halfWidth = (s: RoadSpec) => s.median + s.lanes * LANE_W + s.parking + s.shoulder;

export interface RNode {
  id: number;
  x: number;
  z: number;
  y: number;
  edges: number[];
  /** a traffic signal (index into Network.signals), -1 = none */
  signal: number;
  /** grid district id, or 'route' */
  from: string;
}

export interface REdge {
  id: number;
  a: number;
  b: number;
  kind: RoadKind;
  spec: RoadSpec;
  name: string;
  hw: number;
  /** the dense centreline: x, y, z per point */
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  /** cumulative length at each point */
  cum: Float32Array;
  len: number;
  /** trimmed at each end (the junction pads), m */
  trimA: number;
  trimB: number;
  /** the sidewalks stop here (the crossing roads' sidewalks take the corner) */
  walkA: number;
  walkB: number;
  /** points not over land (bridges / causeway fill) */
  water: Uint8Array;
  /** an elevated deck somewhere along it */
  elevated: boolean;
}

export interface Signal {
  node: number;
  /** each incident edge's phase group (0 or 1) — matches RNode.edges */
  group: number[];
  /** seconds into the cycle */
  offset: number;
  /** the edge directions' phase 0 = green for group 0 … */
  cycle: number;
}

/** the signal cycle (s): A green, A amber, all red, B green, B amber, all red */
export const SIG = { green: 17, amber: 3.2, red: 1.6 };
export const SIG_CYCLE = 2 * (SIG.green + SIG.amber + SIG.red);

/** 0 = green, 1 = amber, 2 = red, for phase group g at time t */
export function signalState(sig: Signal, g: number, t: number): number {
  let c = (t + sig.offset) % SIG_CYCLE;
  if (g === 1) c = (c + SIG_CYCLE / 2) % SIG_CYCLE;
  if (c < SIG.green) return 0;
  if (c < SIG.green + SIG.amber) return 1;
  return 2;
}

const rand = (seed: number) => {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
};

export class Network {
  readonly nodes: RNode[] = [];
  readonly edges: REdge[] = [];
  readonly signals: Signal[] = [];
  readonly mask: LandMask;
  /** spatial hash of edge points: cell → edge ids */
  private readonly hash = new Map<number, number[]>();
  static readonly CELL = 40;
  /** what the land off the paving is (0 paved, 1 grass, 2 sand), once the city knows its lawns */
  ground: ((x: number, z: number) => number) | null = null;

  constructor() {
    this.mask = new LandMask(LANDS);
    for (const d of DISTRICTS) this.buildGrid(d);
    this.joinDistricts();
    for (const r of ROUTES) this.buildRoute(r);
    this.prune();
    this.trimAll();
    this.buildSignals();
    this.buildHash();
  }

  // ---------------------------------------------------------------- building

  private addNode(x: number, z: number, y: number, from: string): RNode {
    const n: RNode = { id: this.nodes.length, x, z, y, edges: [], signal: -1, from };
    this.nodes.push(n);
    return n;
  }

  /** an edge along `pts` (x, y, z triples, first = node a, last = node b) */
  private addEdge(a: RNode, b: RNode, pts: { x: number; y: number; z: number }[], kind: RoadKind, name: string): REdge {
    const spec = SPEC[kind];
    const n = pts.length;
    const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n), cum = new Float32Array(n);
    const water = new Uint8Array(n);
    let elevated = false;
    for (let i = 0; i < n; i++) {
      px[i] = pts[i].x;
      py[i] = pts[i].y;
      pz[i] = pts[i].z;
      if (i) cum[i] = cum[i - 1] + Math.hypot(px[i] - px[i - 1], pz[i] - pz[i - 1], py[i] - py[i - 1]);
      water[i] = this.mask.land(px[i], pz[i]) ? 0 : 1;
      if (pts[i].y > 2.5) elevated = true;
    }
    const e: REdge = { id: this.edges.length, a: a.id, b: b.id, kind, spec, name, hw: halfWidth(spec), px, py, pz, cum, len: cum[n - 1], trimA: 0, trimB: 0, walkA: 0, walkB: 0, water, elevated };
    this.edges.push(e);
    a.edges.push(e.id);
    b.edges.push(e.id);
    return e;
  }

  /** a straight edge, subdivided so long blocks still have points to hang things on */
  private straight(a: RNode, b: RNode, kind: RoadKind, name: string) {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(l / 24));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
    return this.addEdge(a, b, pts, kind, name);
  }

  private grids = new Map<string, { d: GridDistrict; at: (v: number, w: number) => P2; nodes: (RNode | null)[][] }>();

  private buildGrid(d: GridDistrict) {
    const a = (d.angle * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const at = (v: number, w: number): P2 => ({ x: d.origin.x + v * ca - w * sa, z: d.origin.z + v * sa + w * ca });
    const nodes: (RNode | null)[][] = [];
    for (let i = 0; i < d.cols.length; i++) {
      nodes.push([]);
      for (let j = 0; j < d.rows.length; j++) {
        const p = at(d.cols[i].at, d.rows[j].at);
        const land = this.mask.at(p.x, p.z);
        const span = d.cols[i].span;
        const inSpan = !span || (p.z >= Math.min(span[0], span[1]) - 1 && p.z <= Math.max(span[0], span[1]) + 1);
        const ok = land > 0 && inSpan && (!d.keep || d.keep(p, land)) && this.mask.land(p.x + 6, p.z) && this.mask.land(p.x - 6, p.z) && this.mask.land(p.x, p.z + 6) && this.mask.land(p.x, p.z - 6);
        nodes[i].push(ok ? this.addNode(p.x, p.z, 0, d.id) : null);
      }
    }
    // columns (along w) and rows (along v)
    for (let i = 0; i < d.cols.length; i++)
      for (let j = 0; j + 1 < d.rows.length; j++) {
        const A = nodes[i][j], B = nodes[i][j + 1];
        if (A && B && this.mask.segLand(A, B, 4)) this.straight(A, B, d.cols[i].kind, d.cols[i].name);
      }
    for (let j = 0; j < d.rows.length; j++)
      for (let i = 0; i + 1 < d.cols.length; i++) {
        const A = nodes[i][j], B = nodes[i + 1][j];
        if (A && B && this.mask.segLand(A, B, 4)) this.straight(A, B, d.rows[j].kind, d.rows[j].name);
      }
    this.grids.set(d.id, { d, at, nodes });
  }

  /** bridges between neighbouring grids: over the Miami River, and where Brickell meets Little Havana */
  private joinDistricts() {
    const pairs: [string, string, number, number][] = [
      ['downtown', 'brickell', 260, 4],
      ['downtown', 'havana', 260, 6],
      ['brickell', 'havana', 220, 6],
    ];
    for (const [ia, ib, maxD, maxN] of pairs) {
      const A = this.nodes.filter((n) => n.from === ia && n.edges.length > 0 && n.edges.length < 4);
      const B = this.nodes.filter((n) => n.from === ib && n.edges.length > 0 && n.edges.length < 4);
      const cands: { a: RNode; b: RNode; d: number }[] = [];
      for (const a of A)
        for (const b of B) {
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d < maxD && d > 30) cands.push({ a, b, d });
        }
      cands.sort((p, q) => p.d - q.d);
      const used: RNode[] = [];
      let made = 0;
      for (const c of cands) {
        if (made >= maxN) break;
        if (used.some((u) => Math.hypot(u.x - c.a.x, u.z - c.a.z) < 230 || Math.hypot(u.x - c.b.x, u.z - c.b.z) < 230)) continue;
        // a bridge over the river, or a short link on land
        const pts = this.curveBetween(c.a, c.b);
        const wet = pts.some((p) => !this.mask.land(p.x, p.z));
        if (wet) {
          const n = pts.length;
          for (let i = 0; i < n; i++) pts[i].y = Math.sin((i / (n - 1)) * Math.PI) * 2.2;
        }
        const kind: RoadKind = this.edgeKindAt(c.a) === 'boulevard' || this.edgeKindAt(c.b) === 'boulevard' ? 'boulevard' : 'avenue';
        this.addEdge(c.a, c.b, pts, kind, wet ? 'Miami River Bridge' : 'Connector');
        used.push(c.a, c.b);
        made++;
      }
    }
  }

  private edgeKindAt(n: RNode): RoadKind {
    let best: RoadKind = 'street';
    for (const id of n.edges) if (this.edges[id].kind === 'boulevard') best = 'boulevard';
    return best;
  }

  /** a smooth link leaving each node along its own grid's nearest street direction */
  private curveBetween(a: RNode, b: RNode): { x: number; y: number; z: number }[] {
    const dir = (n: RNode, toward: P2) => {
      const g = this.grids.get(n.from);
      const ang = g ? (g.d.angle * Math.PI) / 180 : 0;
      const axes = [
        { x: Math.cos(ang), z: Math.sin(ang) },
        { x: -Math.sin(ang), z: Math.cos(ang) },
      ];
      const dx = toward.x - n.x, dz = toward.z - n.z;
      const l = Math.hypot(dx, dz) || 1;
      let best = axes[0], bd = -2;
      for (const ax of axes)
        for (const s of [1, -1]) {
          const d = (ax.x * s * dx + ax.z * s * dz) / l;
          if (d > bd) {
            bd = d;
            best = { x: ax.x * s, z: ax.z * s };
          }
        }
      return best;
    };
    const ta = dir(a, b), tb = dir(b, a);
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const k = L * 0.4;
    const pts: { x: number; y: number; z: number }[] = [];
    const n = Math.max(4, Math.ceil(L / 5));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const h1 = 2 * t * t * t - 3 * t * t + 1, h2 = t * t * t - 2 * t * t + t, h3 = -2 * t * t * t + 3 * t * t, h4 = t * t * t - t * t;
      pts.push({
        x: h1 * a.x + h2 * ta.x * k + h3 * b.x + h4 * -tb.x * k,
        y: 0,
        z: h1 * a.z + h2 * ta.z * k + h3 * b.z + h4 * -tb.z * k,
      });
    }
    return pts;
  }

  /** the routes: a Catmull-Rom through the control points, sampled every ~5 m, ends snapped */
  private buildRoute(r: (typeof ROUTES)[number]) {
    const cp = r.pts;
    const pts: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i + 1 < cp.length; i++) {
      const p0 = cp[Math.max(0, i - 1)].p, p1 = cp[i].p, p2 = cp[i + 1].p, p3 = cp[Math.min(cp.length - 1, i + 2)].p;
      const y1 = cp[i].y, y2 = cp[i + 1].y;
      const L = Math.hypot(p2.x - p1.x, p2.z - p1.z);
      const n = Math.max(2, Math.ceil(L / 5));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        const x = 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
        const z = 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
        const s = t * t * (3 - 2 * t);
        pts.push({ x, y: y1 + (y2 - y1) * s, z });
      }
    }
    const last = cp[cp.length - 1];
    pts.push({ x: last.p.x, y: last.y, z: last.p.z });
    // ends: a grid node or a point on another road nearby (split it), else a new node
    const end = (p: { x: number; y: number; z: number }): RNode => {
      let best: RNode | null = null, bd = 70;
      for (const n of this.nodes) {
        if (Math.abs(n.y - p.y) > 2.5) continue;
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      if (best) return best;
      const split = this.splitNear(p, 45);
      if (split) return split;
      return this.addNode(p.x, p.z, p.y, 'route');
    };
    const A = end(pts[0]);
    const B = end(pts[pts.length - 1]);
    pts[0] = { x: A.x, y: A.y, z: A.z };
    pts[pts.length - 1] = { x: B.x, y: B.y, z: B.z };
    // a closed loop (island drives) ends at a point of itself: split there
    if (A === B && pts.length > 8) {
      const mid = Math.floor(pts.length / 2);
      const M = this.addNode(pts[mid].x, pts[mid].z, pts[mid].y, 'route');
      this.addEdge(A, M, pts.slice(0, mid + 1), r.kind, r.name);
      this.addEdge(M, B, pts.slice(mid), r.kind, r.name);
      return;
    }
    this.addEdge(A, B, pts, r.kind, r.name);
  }

  /** split the edge passing nearest `p` (within `maxD`, at a matching height) and return the new node */
  private splitNear(p: { x: number; y: number; z: number }, maxD: number): RNode | null {
    let best: { e: REdge; i: number; d: number } | null = null;
    for (const e of this.edges) {
      if (e.len < 0) continue;
      for (let i = 1; i + 1 < e.px.length; i++) {
        if (Math.abs(e.py[i] - p.y) > 2.5) continue;
        const d = Math.hypot(e.px[i] - p.x, e.pz[i] - p.z);
        if (d < maxD && (!best || d < best.d)) best = { e, i, d };
      }
    }
    if (!best) return null;
    const { e, i } = best;
    const M = this.addNode(e.px[i], e.pz[i], e.py[i], 'route');
    const pts = (from: number, to: number) => {
      const out = [];
      for (let k = from; k <= to; k++) out.push({ x: e.px[k], y: e.py[k], z: e.pz[k] });
      return out;
    };
    const A = this.nodes[e.a], B = this.nodes[e.b];
    // detach the old edge, add the two halves (the old id stays as an empty husk)
    A.edges = A.edges.filter((id) => id !== e.id);
    B.edges = B.edges.filter((id) => id !== e.id);
    e.len = -1;
    this.addEdge(A, M, pts(0, i), e.kind, e.name);
    this.addEdge(M, B, pts(i, e.px.length - 1), e.kind, e.name);
    return M;
  }

  /** drop husks and lone nodes, renumber */
  private prune() {
    const live = this.edges.filter((e) => e.len > 0);
    const usedNodes = new Set<number>();
    for (const e of live) {
      usedNodes.add(e.a);
      usedNodes.add(e.b);
    }
    const nodeMap = new Map<number, number>();
    const nodes = this.nodes.filter((n) => usedNodes.has(n.id));
    nodes.forEach((n, i) => {
      nodeMap.set(n.id, i);
      n.id = i;
      n.edges = [];
    });
    live.forEach((e, i) => {
      e.id = i;
      e.a = nodeMap.get(e.a)!;
      e.b = nodeMap.get(e.b)!;
      nodes[e.a].edges.push(i);
      nodes[e.b].edges.push(i);
    });
    this.nodes.length = 0;
    this.nodes.push(...nodes);
    this.edges.length = 0;
    this.edges.push(...live);
  }

  /** each edge stops short of its junctions by the widest road crossing it there */
  private trimAll() {
    for (const n of this.nodes) {
      if (n.edges.length < 2) continue;
      for (const id of n.edges) {
        const e = this.edges[id];
        let t = 0, w = 0;
        for (const o of n.edges) {
          if (o === id) continue;
          const f = this.edges[o];
          // the angle between the two: a road meeting at a shallow angle needs a longer pad
          const da = this.dirAt(e, n.id), db = this.dirAt(f, n.id);
          const s = Math.abs(da.x * db.z - da.z * db.x);
          if (n.edges.length === 2 && s < 0.35) continue;
          const k = Math.max(0.5, s);
          t = Math.max(t, Math.min((f.hw + 0.5) / k, 40));
          w = Math.max(w, Math.min((f.hw + f.spec.sidewalk) / k, 46));
        }
        // never more than a third of the edge
        t = Math.min(t, e.len * 0.33);
        w = Math.min(Math.max(w, t), e.len * 0.4);
        if (e.a === n.id) {
          e.trimA = t;
          e.walkA = w;
        }
        if (e.b === n.id) {
          e.trimB = t;
          e.walkB = w;
        }
      }
    }
  }

  /** unit direction of edge `e` leaving node `nid` (xz) */
  dirAt(e: REdge, nid: number): P2 {
    const n = e.px.length;
    let dx: number, dz: number;
    if (e.a === nid) {
      const k = Math.min(n - 1, 2);
      dx = e.px[k] - e.px[0];
      dz = e.pz[k] - e.pz[0];
    } else {
      const k = Math.max(0, n - 3);
      dx = e.px[k] - e.px[n - 1];
      dz = e.pz[k] - e.pz[n - 1];
    }
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  private buildSignals() {
    const R = rand(4242);
    for (const n of this.nodes) {
      if (n.edges.length < 3 || n.from === 'route' || n.y > 1) continue;
      const kinds = n.edges.map((id) => this.edges[id].kind);
      const big = kinds.filter((k) => k !== 'street' && k !== 'lane').length;
      // quiet residential crossings are all-way stops; anything on an avenue gets a signal
      if (big === 0 && R() < 0.55) continue;
      const d0 = this.dirAt(this.edges[n.edges[0]], n.id);
      const group = n.edges.map((id) => {
        const d = this.dirAt(this.edges[id], n.id);
        return Math.abs(d.x * d0.x + d.z * d0.z) > 0.7 ? 0 : 1;
      });
      n.signal = this.signals.length;
      this.signals.push({ node: n.id, group, offset: R() * SIG_CYCLE, cycle: SIG_CYCLE });
    }
  }

  private key(i: number, j: number) {
    return i * 100003 + j;
  }

  private buildHash() {
    const C = Network.CELL;
    for (const e of this.edges) {
      const r = e.hw + e.spec.sidewalk + 2;
      const seen = new Set<number>();
      for (let i = 0; i < e.px.length; i++) {
        const i0 = Math.floor((e.px[i] - r) / C), i1 = Math.floor((e.px[i] + r) / C);
        const j0 = Math.floor((e.pz[i] - r) / C), j1 = Math.floor((e.pz[i] + r) / C);
        for (let a = i0; a <= i1; a++)
          for (let b = j0; b <= j1; b++) {
            const k = this.key(a, b);
            if (seen.has(k)) continue;
            seen.add(k);
            let l = this.hash.get(k);
            if (!l) this.hash.set(k, (l = []));
            l.push(e.id);
          }
      }
    }
  }

  // ---------------------------------------------------------------- queries

  /** the edges with points near (x, z) */
  near(x: number, z: number): number[] {
    return this.hash.get(this.key(Math.floor(x / Network.CELL), Math.floor(z / Network.CELL))) ?? [];
  }

  /**
   * Project (x, z) onto edge `e`: arc length s, signed lateral offset (+ = right of travel a → b),
   * deck height y, and the unit tangent. `null` when the point is off the ends.
   */
  project(e: REdge, x: number, z: number, out: Proj): Proj | null {
    let best = Infinity;
    const n = e.px.length;
    for (let i = 0; i + 1 < n; i++) {
      const ax = e.px[i], az = e.pz[i], bx = e.px[i + 1], bz = e.pz[i + 1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1e-6;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      const off = t < -0.001 && i === 0 ? true : t > 1.001 && i === n - 2;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + dx * t, qz = az + dz * t;
      const d2 = (x - qx) ** 2 + (z - qz) ** 2;
      if (d2 < best) {
        best = d2;
        const l = Math.sqrt(l2);
        out.tx = dx / l;
        out.tz = dz / l;
        out.s = e.cum[i] + (e.cum[i + 1] - e.cum[i]) * t;
        out.y = e.py[i] + (e.py[i + 1] - e.py[i]) * t;
        // right of travel: (−tz, tx) rotated… right-hand in x-east z-south: right = (−tz, tx)
        out.lat = (x - qx) * -out.tz + (z - qz) * out.tx;
        out.off = off;
        out.i = i;
        out.t = t;
      }
    }
    return Number.isFinite(best) ? out : null;
  }

  /** a point on edge `e` at arc length s, lateral offset `lat` (+ right of a → b) */
  point(e: REdge, s: number, lat: number, out: { x: number; y: number; z: number; tx: number; tz: number }) {
    const n = e.px.length;
    s = Math.max(0, Math.min(e.len, s));
    // binary search
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (e.cum[m] <= s) lo = m;
      else hi = m;
    }
    const seg = e.cum[hi] - e.cum[lo] || 1e-6;
    const t = (s - e.cum[lo]) / seg;
    const dx = e.px[hi] - e.px[lo], dz = e.pz[hi] - e.pz[lo];
    const l = Math.hypot(dx, dz) || 1e-6;
    out.tx = dx / l;
    out.tz = dz / l;
    out.x = e.px[lo] + dx * t - out.tz * lat;
    out.z = e.pz[lo] + dz * t + out.tx * lat;
    out.y = e.py[lo] + (e.py[hi] - e.py[lo]) * t;
    return out;
  }

  /**
   * The drivable surface height at (x, z) for something now at height `y`: the highest road deck
   * or sidewalk at or a little above it (a car under the I-95 stays on the street), else the land
   * (0) or, over open water, null.
   */
  surface(x: number, z: number, y: number, out: Surf): Surf {
    let best = -Infinity;
    // (a carriageway beats the sidewalk band of a road meeting it: the junction's corners are road)
    let road = -Infinity, rEdge = -1, rLat = 0, rS = 0, rTx = 0, rTz = 0;
    out.edge = -1;
    out.sidewalk = false;
    out.grass = out.sand = false;
    const pr = PROJ;
    for (const id of this.near(x, z)) {
      const e = this.edges[id];
      if (!this.project(e, x, z, pr) || pr.off) continue;
      const a = Math.abs(pr.lat);
      const curb = e.hw;
      const outer = e.hw + e.spec.sidewalk;
      let h: number;
      let walk = false;
      if (a <= curb + 0.05) h = pr.y + (e.elevated || pr.y > 0.3 ? 0.0 : 0);
      else if (a <= outer && e.spec.sidewalk > 0 && pr.y < 0.5) {
        h = pr.y + 0.15;
        walk = true;
      } else if (a <= curb + 1.2 && pr.y > 0.5) h = pr.y; // the barrier strip of a deck
      else continue;
      if (h > y + 1.4) continue;
      if (!walk && h > road) {
        road = h;
        rEdge = id;
        rLat = pr.lat;
        rS = pr.s;
        rTx = pr.tx;
        rTz = pr.tz;
      }
      if (h > best) {
        best = h;
        out.edge = id;
        out.lat = pr.lat;
        out.s = pr.s;
        out.tx = pr.tx;
        out.tz = pr.tz;
        out.sidewalk = walk;
      }
    }
    if (out.sidewalk && road > best - 0.2) {
      best = road;
      out.edge = rEdge;
      out.lat = rLat;
      out.s = rS;
      out.tx = rTx;
      out.tz = rTz;
      out.sidewalk = false;
    }
    if (best > -Infinity) {
      out.y = best;
      out.water = false;
      return out;
    }
    const land = this.mask.land(x, z);
    out.y = land ? 0 : WATER_Y - 3;
    out.water = !land;
    if (land && this.ground) {
      const k = this.ground(x, z);
      out.grass = k === 1;
      out.sand = k === 2;
    }
    return out;
  }

  /** the nearest edge to (x, z) at about height y, its projection in `out` */
  nearestEdge(x: number, z: number, y: number, maxD = 60, filter?: (e: REdge) => boolean): { e: REdge; pr: Proj } | null {
    let best: { e: REdge; pr: Proj } | null = null;
    let bd = maxD;
    const C = Network.CELL;
    const R = Math.ceil(maxD / C);
    const seen = new Set<number>();
    const pr: Proj = { s: 0, lat: 0, y: 0, tx: 0, tz: 0, off: false, i: 0, t: 0 };
    for (let a = -R; a <= R; a++)
      for (let b = -R; b <= R; b++) {
        for (const id of this.hash.get(this.key(Math.floor(x / C) + a, Math.floor(z / C) + b)) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = this.edges[id];
          if (filter && !filter(e)) continue;
          if (!this.project(e, x, z, pr)) continue;
          if (Math.abs(pr.y - y) > 4) continue;
          // the true distance (past an edge's end the perpendicular offset alone lies)
          const q = this.point(e, pr.s, 0, NE_Q);
          const d = Math.hypot(x - q.x, z - q.z);
          if (d < bd) {
            bd = d;
            best = { e, pr: { ...pr } };
          }
        }
      }
    return best;
  }
}

export interface Proj {
  s: number;
  lat: number;
  y: number;
  tx: number;
  tz: number;
  off: boolean;
  i: number;
  t: number;
}
export interface Surf {
  y: number;
  edge: number;
  lat: number;
  s: number;
  tx: number;
  tz: number;
  water: boolean;
  sidewalk: boolean;
  /** off the paving: a lawn, the beach (see Network.ground) */
  grass: boolean;
  sand: boolean;
}
const PROJ: Proj = { s: 0, lat: 0, y: 0, tx: 0, tz: 0, off: false, i: 0, t: 0 };

export function makeSurf(): Surf {
  return { y: 0, edge: -1, lat: 0, s: 0, tx: 1, tz: 0, water: false, sidewalk: false, grass: false, sand: false };
}

const NE_Q = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
