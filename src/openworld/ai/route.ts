import * as THREE from 'three';
import type { Network, REdge } from '../roads.ts';

const tmpP = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };

/**
 * A* over the road graph (everything but footpaths) from a car at `pos` heading `yaw` to the node
 * nearest `to`, as points every 10 m down the right-hand lane, ending at `to` (written into `out`).
 */
export function planRoute(net: Network, pos: THREE.Vector3, yaw: number, to: { x: number; y: number; z: number }, out: THREE.Vector3[]) {
  const b = { pos, yaw };
  const drivable = (e: REdge) => e.kind !== 'lane';
  const from = net.nearestEdge(b.pos.x, b.pos.z, b.pos.y, 80, drivable);
  const goal = net.nearestEdge(to.x, to.z, to.y, 160, drivable) ?? net.nearestEdge(to.x, to.z, 0, 300, drivable);
  out.length = 0;
  if (!from || !goal) return;
  const fwd = { x: Math.sin(b.yaw), z: Math.cos(b.yaw) };
  // start at the end of our edge we're heading toward
  const ea = net.nodes[from.e.a], eb = net.nodes[from.e.b];
  const start = (eb.x - ea.x) * fwd.x + (eb.z - ea.z) * fwd.z > 0 ? eb.id : ea.id;
  const goals = new Set([goal.e.a, goal.e.b]);
  const n = net.nodes.length;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const prevE = new Int32Array(n).fill(-1);
  const open: [number, number][] = [];
  const h = (i: number) => Math.hypot(net.nodes[i].x - to.x, net.nodes[i].z - to.z);
  g[start] = 0;
  open.push([h(start), start]);
  let end = -1;
  let iters = 0;
  while (open.length && iters++ < 4000) {
    // (a small binary heap)
    const [, u] = heapPop(open);
    if (goals.has(u)) {
      end = u;
      break;
    }
    for (const eid of net.nodes[u].edges) {
      const e = net.edges[eid];
      if (e.kind === 'lane') continue;
      const w = e.a === u ? e.b : e.a;
      const ng = g[u] + e.len;
      if (ng < g[w]) {
        g[w] = ng;
        prev[w] = u;
        prevE[w] = eid;
        heapPush(open, [ng + h(w), w]);
      }
    }
  }
  if (end < 0) {
    out.push(new THREE.Vector3(to.x, to.y, to.z));
    return;
  }
  const chain: { e: REdge; fwd: boolean }[] = [];
  for (let u = end; prev[u] >= 0; u = prev[u]) {
    const e = net.edges[prevE[u]];
    chain.push({ e, fwd: e.b === u });
  }
  chain.reverse();
  // the rest of our own edge first
  const pts = out;
  const lane = (e: REdge, dir: number) => dir * (e.spec.median + 1.7);
  const ownDir = start === from.e.b ? 1 : -1;
  for (let s = from.pr.s; ownDir > 0 ? s < from.e.len : s > 0; s += ownDir * 10) {
    net.point(from.e, s, lane(from.e, ownDir), tmpP);
    pts.push(new THREE.Vector3(tmpP.x, tmpP.y, tmpP.z));
  }
  for (const { e, fwd: f } of chain) {
    const dir = f ? 1 : -1;
    const n2 = Math.max(2, Math.ceil(e.len / 10));
    for (let k = 1; k <= n2; k++) {
      const s = f ? (k / n2) * e.len : e.len - (k / n2) * e.len;
      net.point(e, s, lane(e, dir), tmpP);
      pts.push(new THREE.Vector3(tmpP.x, tmpP.y, tmpP.z));
    }
  }
  // and along the goal edge to the point beside the target
  const ge = goal.e;
  const fromA = end === ge.a;
  const gdir = fromA ? 1 : -1;
  for (let s = fromA ? 10 : ge.len - 10; fromA ? s < goal.pr.s : s > goal.pr.s; s += gdir * 10) {
    net.point(ge, s, lane(ge, gdir), tmpP);
    pts.push(new THREE.Vector3(tmpP.x, tmpP.y, tmpP.z));
  }
  pts.push(new THREE.Vector3(to.x, to.y, to.z));
}

function heapPush(h: [number, number][], x: [number, number]) {
  h.push(x);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p][0] <= h[i][0]) break;
    [h[p], h[i]] = [h[i], h[p]];
    i = p;
  }
}

function heapPop(h: [number, number][]): [number, number] {
  const top = h[0];
  const last = h.pop()!;
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && h[l][0] < h[m][0]) m = l;
      if (r < h.length && h[r][0] < h[m][0]) m = r;
      if (m === i) break;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }
  return top;
}
