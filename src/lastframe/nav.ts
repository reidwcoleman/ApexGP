import type { World } from './collide.ts';

/**
 * Where a body can walk, as a graph of points a metre apart, flood-filled from the spawns at load.
 * Doors don't count (bots open them). Paths are A* with a little noise, so two bots rarely take the
 * same line.
 */
export interface Node {
  i: number;
  x: number;
  y: number;
  z: number;
  next: number[];
  /** walls within reach: somewhere to stand in cover */
  cover: boolean;
  indoors: boolean;
}

const STEP = 1;

export class Nav {
  nodes: Node[] = [];
  private byCell = new Map<number, number[]>();

  constructor(w: World, seeds: number[][], indoors: (x: number, y: number, z: number) => boolean) {
    const dyn = w.dyn;
    w.dyn = [];
    const key = (x: number, y: number, z: number) => `${x}|${Math.round(y * 2)}|${z}`;
    const seen = new Map<string, Node>();
    const queue: Node[] = [];
    const add = (x: number, y: number, z: number) => {
      const k = key(x, y, z);
      let n = seen.get(k);
      if (n) return n;
      n = { i: this.nodes.length, x, y, z, next: [], cover: false, indoors: indoors(x, y + 1, z) };
      seen.set(k, n);
      this.nodes.push(n);
      queue.push(n);
      return n;
    };
    for (const s of seeds) {
      const gx = Math.round(s[0]), gz = Math.round(s[2]);
      const f = w.floorAt(gx, s[1] + 1, gz, 0.2, 0);
      add(gx, f > -50 ? f : s[1], gz);
    }
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (queue.length) {
      const n = queue.pop()!;
      for (const [dx, dz] of D) {
        const x = n.x + dx * STEP, z = n.z + dz * STEP;
        // walk the step in small hops, climbing as a body would
        let y = n.y, ok = true;
        const hops = 5;
        for (let h = 1; h <= hops && ok; h++) {
          const px = n.x + (dx * STEP * h) / hops, pz = n.z + (dz * STEP * h) / hops;
          const f = w.floorAt(px, y + 0.46, pz, 0.22, 0);
          if (f < -50 || y - f > 0.7 || f - y > 0.46 || ((w.terrain || w.limit) && w.barred(px, pz, dx, dz))) ok = false;
          // clear from the shins up: a body steps over a stair nosing or a kerb, the walk code does the same
          else if (w.blocked(px, f + 0.3, pz, 0.26, 1.35)) ok = false;
          else y = f;
        }
        if (!ok) continue;
        const m = add(x, y, z);
        if (!n.next.includes(m.i)) n.next.push(m.i);
      }
    }
    w.dyn = dyn;
    for (const n of this.nodes) {
      const k = this.cell(n.x, n.z);
      const c = this.byCell.get(k);
      if (c) c.push(n.i);
      else this.byCell.set(k, [n.i]);
      n.cover = n.next.length < 8;
    }
  }

  private cell(x: number, z: number) {
    return Math.floor(x / 4) * 4096 + Math.floor(z / 4);
  }

  nearest(x: number, y: number, z: number): Node | null {
    let best: Node | null = null, bd = 1e9;
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let r = 0; r < 4 && !best; r++) {
      for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
        const c = this.byCell.get(i * 4096 + j);
        if (!c) continue;
        for (const k of c) {
          const n = this.nodes[k];
          const d = (n.x - x) ** 2 + (n.z - z) ** 2 + ((n.y - y) * 3) ** 2;
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
      }
    }
    return best;
  }

  path(from: Node, to: Node, noise = 0): Node[] {
    if (from === to) return [to];
    const N = this.nodes.length;
    const g = new Float32Array(N).fill(1e9), came = new Int32Array(N).fill(-1);
    const open: [number, number][] = [[0, from.i]];
    g[from.i] = 0;
    const h = (n: Node) => Math.hypot(n.x - to.x, n.z - to.z) + Math.abs(n.y - to.y) * 2;
    let budget = 40000;
    while (open.length && budget-- > 0) {
      // binary heap by hand
      const [, cur] = pop(open);
      if (cur === to.i) break;
      const n = this.nodes[cur];
      for (const k of n.next) {
        const m = this.nodes[k];
        const step = Math.hypot(m.x - n.x, m.z - n.z) * (1 + noise * ((k * 2654435761) % 97) / 97) + (m.cover ? 0 : 0.12);
        const c = g[cur] + step;
        if (c < g[k]) {
          g[k] = c;
          came[k] = cur;
          push(open, [c + h(m), k]);
        }
      }
    }
    if (came[to.i] < 0) return [];
    const out: Node[] = [];
    for (let c = to.i; c >= 0; c = came[c]) out.push(this.nodes[c]);
    return out.reverse();
  }
}

function push(h: [number, number][], v: [number, number]) {
  h.push(v);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}
function pop(h: [number, number][]): [number, number] {
  const top = h[0], last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const a = i * 2 + 1, b = a + 1;
      let s = i;
      if (a < h.length && h[a][0] < h[s][0]) s = a;
      if (b < h.length && h[b][0] < h[s][0]) s = b;
      if (s === i) break;
      [h[s], h[i]] = [h[i], h[s]];
      i = s;
    }
  }
  return top;
}
