import * as THREE from 'three';
import { WATER_Y } from '../geo.ts';
import { LANE_W, type Network, type REdge, type RNode } from '../roads.ts';
import { MeshBuilder, chunkMeshes, hull, rng } from './build.ts';
import { concreteMaterial, lawnMaterial, rockMaterial, roadMaterial, sidewalkMaterial } from './materials.ts';
import type { Lamp } from './cityLights.ts';

/**
 * Every surface the network implies: the road ribbons (trimmed at the junctions), the junction
 * pads, the raised sidewalks with their curbs and corner squares, the planted medians of the
 * boulevards, the elevated decks (girders, jersey barriers, pillar bents into the ground or the
 * bay) and the causeways' fill (grass verges, rip-rap into the water). Plus where every street
 * lamp stands (the light map and the lamp posts are made from that list).
 */

export interface RoadBuild {
  group: THREE.Group;
  lamps: (Lamp & { yaw: number; arm: number; type: 'cobra' | 'mast' | 'deco' })[];
  /** palm spots in the medians and on the causeway fill: x, z, y, kind (0 royal, 1 coconut) */
  palms: { x: number; z: number; y: number; kind: number }[];
  /** parking spots: x, z, y, yaw */
  parking: { x: number; y: number; z: number; yaw: number }[];
  /** signal heads: node, the arm position and facing for each approach */
  signalPoles: { node: number; edge: number; x: number; y: number; z: number; yaw: number; reach: number }[];
}

const tmp = { x: 0, y: 0, z: 0, tx: 1, tz: 0 };
const tmp2 = { x: 0, y: 0, z: 0, tx: 1, tz: 0 };

/** the arc lengths to sample an edge at between s0 and s1 */
function samples(e: REdge, s0: number, s1: number, maxStep = 12): number[] {
  const out = [s0];
  for (let i = 1; i < e.px.length - 1; i++) {
    const s = e.cum[i];
    if (s > s0 + 0.3 && s < s1 - 0.3) {
      // subdivide long straight steps (grid edges) so the deck/pillar logic has points
      const prev = out[out.length - 1];
      const n = Math.floor((s - prev) / maxStep);
      for (let k = 1; k <= n; k++) out.push(prev + ((s - prev) * k) / (n + 1));
      out.push(s);
    }
  }
  const prev = out[out.length - 1];
  const n = Math.floor((s1 - prev) / maxStep);
  for (let k = 1; k <= n; k++) out.push(prev + ((s1 - prev) * k) / (n + 1));
  out.push(s1);
  return out;
}

const isGradeRoad = (e: REdge) => e.kind !== 'highway' && e.kind !== 'causeway' && e.kind !== 'ramp';

export function buildRoads(net: Network): RoadBuild {
  const R = rng(1977);
  const group = new THREE.Group();
  group.name = 'Roads';
  const road = new MeshBuilder().attr('aRUV', 2).attr('aRSpec', 4).attr('aREnd', 4);
  const walk = new MeshBuilder().attr('aSUV', 2).attr('aSKind', 1);
  const median = new MeshBuilder();
  const deck = new MeshBuilder();
  const barrier = new MeshBuilder();
  const verge = new MeshBuilder();
  const rocks = new MeshBuilder();
  const out: RoadBuild = { group, lamps: [], palms: [], parking: [], signalPoles: [] };

  const ROAD_Y = 0.03;
  const CURB = 0.15;

  for (const e of net.edges) {
    const A = net.nodes[e.a], B = net.nodes[e.b];
    const s0 = e.trimA, s1 = e.len - e.trimB;
    if (s1 - s0 < 0.5) continue;
    const S = samples(e, s0, s1, e.elevated || e.water.some((w) => w) ? 6 : 24);
    const hw = e.hw;
    const sp = e.spec;
    const hwy = !isGradeRoad(e);
    const crossA = isGradeRoad(e) && A.edges.length >= 3 && A.y < 1 ? 1 : 0;
    const crossB = isGradeRoad(e) && B.edges.length >= 3 && B.y < 1 ? 1 : 0;
    const L = s1 - s0;
    road.set('aRSpec', sp.lanes, sp.median, sp.parking, sp.shoulder);
    road.set('aREnd', L, crossA, crossB, hwy ? 1 : 0);
    // ---- the carriageway
    let prevL = -1, prevR = -1;
    for (const s of S) {
      net.point(e, s, 0, tmp);
      const rx = -tmp.tz, rz = tmp.tx;
      const y = tmp.y + ROAD_Y;
      road.set('aRUV', -hw, s - s0);
      const l = road.v(tmp.x - rx * hw, y, tmp.z - rz * hw);
      road.set('aRUV', hw, s - s0);
      const r = road.v(tmp.x + rx * hw, y, tmp.z + rz * hw);
      if (prevL >= 0) road.quad(prevL, prevR, r, l);
      prevL = l;
      prevR = r;
    }

    // ---- per sample: what's under it
    const under = S.map((s) => {
      net.point(e, s, 0, tmp);
      const land = net.mask.land(tmp.x, tmp.z);
      const y = tmp.y;
      const isDeck = y > 2.8 || (!land && e.kind !== 'causeway') || (y > 0.35 && land && hwy);
      const isFill = !land && !isDeck;
      return { s, x: tmp.x, z: tmp.z, y, tx: tmp.tx, tz: tmp.tz, land, isDeck, isFill };
    });

    // ---- sidewalks (at grade and on the low bridges)
    const sw = sp.sidewalk;
    const walkS0 = Math.max(s0, e.walkA), walkS1 = Math.min(s1, e.len - e.walkB);
    if (sw > 0 && walkS1 - walkS0 > 0.5 && !e.elevated) {
      const kind = A.from === 'brickell' || e.kind === 'ocean' ? 1 : 0;
      const WS = samples(e, walkS0, walkS1, 24);
      for (const side of [-1, 1]) {
        let pi = -1, po = -1, pcb = -1, pct = -1;
        for (const s of WS) {
          net.point(e, s, 0, tmp);
          const rx = -tmp.tz, rz = tmp.tx;
          const y = tmp.y + ROAD_Y;
          const ix = tmp.x + rx * hw * side, iz = tmp.z + rz * hw * side;
          const ox = tmp.x + rx * (hw + sw) * side, oz = tmp.z + rz * (hw + sw) * side;
          walk.set('aSKind', kind);
          walk.set('aSUV', 0, s);
          const vi = walk.v(ix, y + CURB, iz);
          walk.set('aSUV', sw, s);
          const vo = walk.v(ox, y + CURB, oz);
          // the curb face, toward the road
          walk.set('aSKind', 2);
          walk.set('aSUV', 0, s);
          const cb = walk.v(ix, y - 0.02, iz, -rx * side, 0, -rz * side);
          const ct = walk.v(ix, y + CURB, iz, -rx * side, 0, -rz * side);
          if (pi >= 0) {
            if (side > 0) {
              walk.quad(pi, po, vo, vi);
              walk.quad(cb, pcb, pct, ct);
            } else {
              walk.quad(po, pi, vi, vo);
              walk.quad(pcb, cb, ct, pct);
            }
          }
          pi = vi;
          po = vo;
          pcb = cb;
          pct = ct;
        }
      }
    }

    // ---- planted median (boulevards): a curb island with lawn, royal palms down the middle
    if (sp.median > 1 && !e.elevated) {
      const MS = samples(e, s0 + 6, s1 - 6, 24);
      if (MS.length >= 2 && s1 - s0 > 14) {
        let pl = -1, pr = -1;
        const mw = sp.median - 0.2;
        for (const s of MS) {
          net.point(e, s, 0, tmp);
          const rx = -tmp.tz, rz = tmp.tx;
          const y = tmp.y + ROAD_Y + CURB;
          const l = median.v(tmp.x - rx * mw, y, tmp.z - rz * mw);
          const r = median.v(tmp.x + rx * mw, y, tmp.z + rz * mw);
          if (pl >= 0) median.quad(pl, pr, r, l);
          pl = l;
          pr = r;
        }
        // its curbs, as a closed wall each side
        for (const side of [-1, 1]) {
          for (let i = 0; i + 1 < MS.length; i++) {
            net.point(e, MS[i], side * mw, tmp);
            net.point(e, MS[i + 1], side * mw, tmp2);
            const y = tmp.y + ROAD_Y;
            const f = side > 0 ? [[tmp.x, y - 0.02, tmp.z], [tmp2.x, y - 0.02, tmp2.z], [tmp2.x, y + CURB, tmp2.z], [tmp.x, y + CURB, tmp.z]] : [[tmp2.x, y - 0.02, tmp2.z], [tmp.x, y - 0.02, tmp.z], [tmp.x, y + CURB, tmp.z], [tmp2.x, y + CURB, tmp2.z]];
            barrier.face(f);
          }
        }
        for (let s = s0 + 10; s < s1 - 10; s += 13 + R() * 3) {
          net.point(e, s, 0, tmp);
          out.palms.push({ x: tmp.x, z: tmp.z, y: tmp.y + ROAD_Y + CURB, kind: 0 });
        }
      }
    }

    // ---- median barrier (highways, causeways)
    if (hwy && sp.median > 0.3) jersey(barrier, net, e, S, 0, 0.62, 0.86, ROAD_Y);

    // ---- decks: girders, barriers, pillars
    let run: typeof under = [];
    const flushDeck = () => {
      if (run.length >= 2) buildDeck(net, e, run, deck, barrier, hw + (sw > 0 ? sw : 0), ROAD_Y);
      run = [];
    };
    for (const u of under) {
      if (u.isDeck) run.push(u);
      else flushDeck();
    }
    flushDeck();
    // ---- causeway fill
    let fill: typeof under = [];
    const flushFill = () => {
      if (fill.length >= 2) {
        buildFill(net, e, fill, verge, rocks, hw, ROAD_Y);
        // palms down both verges
        for (let k = 0; k < fill.length; k++) {
          const u = fill[k];
          if (k % 4 !== 1) continue;
          for (const side of [-1, 1]) {
            if (R() < 0.25) continue;
            const lat = side * (hw + 3.5 + R() * 2.5);
            net.point(e, u.s, lat, tmp);
            out.palms.push({ x: tmp.x, z: tmp.z, y: u.y - 0.1, kind: 0 });
          }
        }
      }
      fill = [];
    };
    for (const u of under) {
      if (u.isFill) fill.push(u);
      else flushFill();
    }
    flushFill();

    // ---- street lamps
    if (hwy) {
      // tall twin-arm masts in the median barrier every 48 m
      for (let s = s0 + 20; s < s1 - 10; s += 48) {
        net.point(e, s, 0, tmp);
        out.lamps.push({ x: tmp.x, z: tmp.z, base: tmp.y, kind: 1, power: 1.25, radius: 30, yaw: Math.atan2(tmp.tx, tmp.tz), arm: hw * 0.5, type: 'mast' });
      }
    } else if (!e.elevated) {
      const deco = e.kind === 'ocean' || A.from === 'southbeach';
      const step = e.kind === 'street' ? 34 : 30;
      let side = R() < 0.5 ? -1 : 1;
      for (let s = s0 + 9 + R() * 6; s < s1 - 6; s += step) {
        const lat = side * (hw + 0.7);
        net.point(e, s, lat, tmp);
        const sx = -tmp.tz * side, sz = tmp.tx * side;
        const arm = deco ? 0 : Math.min(3.2, hw * 0.45);
        // the light falls where the head is: over the road
        out.lamps.push({
          x: tmp.x - sx * arm,
          z: tmp.z - sz * arm,
          base: tmp.y,
          kind: deco ? 0 : e.kind === 'boulevard' || e.kind === 'avenue' ? 1 : 0,
          power: e.kind === 'street' ? 0.8 : 1.0,
          radius: 24,
          yaw: Math.atan2(-sx, -sz),
          arm,
          type: deco ? 'deco' : 'cobra',
        });
        if (e.kind !== 'street') side = -side;
      }
    }

    // ---- parking along the curb
    if (sp.parking > 0 && !e.elevated) {
      for (const side of [-1, 1]) {
        for (let s = s0 + 9; s < s1 - 9; s += 6.5) {
          if (R() < 0.42) continue;
          const lat = side * (hw - sp.parking / 2 - 0.1);
          net.point(e, s + 3.25, lat, tmp);
          out.parking.push({ x: tmp.x, y: tmp.y + ROAD_Y, z: tmp.z, yaw: Math.atan2(tmp.tx * side, tmp.tz * side) });
        }
      }
    }
  }

  // ---- junction pads and sidewalk corners
  for (const n of net.nodes) {
    if (n.edges.length < 2) continue;
    const pts: { x: number; z: number }[] = [];
    let need = false;
    for (const id of n.edges) {
      const e = net.edges[id];
      const atA = e.a === n.id;
      const t = atA ? e.trimA : e.trimB;
      if (t > 0.01) need = true;
      net.point(e, atA ? t : e.len - t, 0, tmp);
      const rx = -tmp.tz, rz = tmp.tx;
      pts.push({ x: tmp.x + rx * e.hw, z: tmp.z + rz * e.hw }, { x: tmp.x - rx * e.hw, z: tmp.z - rz * e.hw });
    }
    if (!need) continue;
    const h = hull(pts);
    road.set('aRSpec', 0, 0, 0, 0);
    road.set('aREnd', 0, 0, 0, 0);
    road.set('aRUV', 0, 0);
    fan(road, h, n.y + 0.031);
    // traffic signal poles: one per approach, on the far right corner
    if (n.signal >= 0) {
      for (const id of n.edges) {
        const e = net.edges[id];
        const atA = e.a === n.id;
        const d = net.dirAt(e, n.id);
        // arriving traffic travels -d; its right is (dz, -dx)... the pole stands on the near right corner
        const rr = { x: d.z, z: -d.x };
        const t = (atA ? e.walkA : e.walkB) || e.hw + 4;
        const px = n.x + d.x * (atA ? e.trimA : e.trimB) + rr.x * (e.hw + 0.9);
        const pz = n.z + d.z * (atA ? e.trimA : e.trimB) + rr.z * (e.hw + 0.9);
        void t;
        out.signalPoles.push({ node: n.id, edge: id, x: px, y: n.y + ROAD_Y + CURB, z: pz, yaw: Math.atan2(-d.x, -d.z), reach: Math.min(e.hw * 1.1, 11) });
      }
    }
    // sidewalk corners
    const inc = n.edges
      .map((id) => {
        const e = net.edges[id];
        const d = net.dirAt(e, n.id);
        return { e, d, ang: Math.atan2(d.z, d.x), atA: e.a === n.id };
      })
      .filter((q) => q.e.spec.sidewalk > 0 && !q.e.elevated)
      .sort((a, b) => a.ang - b.ang);
    if (inc.length < 2 || n.y > 1) continue;
    for (let i = 0; i < inc.length; i++) {
      const A = inc[i], Bq = inc[(i + 1) % inc.length];
      if (A === Bq) continue;
      let dAng = Bq.ang - A.ang;
      if (dAng <= 0) dAng += Math.PI * 2;
      if (dAng > Math.PI * 0.97) {
        // (nearly straight through: a quad bridging the two sidewalk ends)
        if (dAng > Math.PI * 1.03) continue;
      }
      const rA = { x: -A.d.z, z: A.d.x };
      const lB = { x: B_left(Bq.d).x, z: B_left(Bq.d).z };
      const hwA = A.e.hw, swA = A.e.spec.sidewalk, hwB = Bq.e.hw, swB = Bq.e.spec.sidewalk;
      const wA = A.atA ? A.e.walkA : A.e.walkB;
      const wB = Bq.atA ? Bq.e.walkA : Bq.e.walkB;
      const P = (d: { x: number; z: number }, s: number, r: { x: number; z: number }, l: number) => ({ x: n.x + d.x * s + r.x * l, z: n.z + d.z * s + r.z * l });
      const aC = P(A.d, wA, rA, hwA), aO = P(A.d, wA, rA, hwA + swA);
      const bC = P(Bq.d, wB, lB, hwB), bO = P(Bq.d, wB, lB, hwB + swB);
      const cC = intersect(n, A.d, rA, hwA, Bq.d, lB, hwB) ?? mid(aC, bC);
      const cO = intersect(n, A.d, rA, hwA + swA, Bq.d, lB, hwB + swB) ?? mid(aO, bO);
      const y = n.y + ROAD_Y + CURB;
      const poly = [cC, aC, aO, cO, bO, bC].filter((p, k, arr) => k === 0 || Math.hypot(p.x - arr[k - 1].x, p.z - arr[k - 1].z) > 0.05);
      if (poly.some((p) => Math.hypot(p.x - n.x, p.z - n.z) > 70)) continue;
      walk.set('aSKind', A.e.kind === 'ocean' || n.from === 'brickell' ? 1 : 0);
      walk.set('aSUV', -100, 0);
      fan(walk, poly, y);
      // the corner's curbs
      walk.set('aSKind', 2);
      for (const [p, q] of [
        [aC, cC],
        [cC, bC],
      ]) {
        if (Math.hypot(p.x - q.x, p.z - q.z) < 0.05) continue;
        walk.face([
          [p.x, y - CURB - 0.05, p.z],
          [q.x, y - CURB - 0.05, q.z],
          [q.x, y, q.z],
          [p.x, y, p.z],
        ]);
      }
    }
  }

  const rm = roadMaterial();
  group.add(chunkMeshes(road, 900, rm, { receive: true, name: 'road' }));
  group.add(chunkMeshes(walk, 900, sidewalkMaterial(), { receive: true, name: 'sidewalks' }));
  if (median.count) group.add(chunkMeshes(median, 1200, lawnMaterial(), { receive: true, name: 'medians' }));
  const conc = concreteMaterial(0xc9c3b8, 0.82, true);
  group.add(chunkMeshes(deck, 1000, conc, { cast: true, receive: true, name: 'decks' }));
  group.add(chunkMeshes(barrier, 1200, concreteMaterial(0xd6d1c6, 0.8, false), { cast: true, receive: true, name: 'barriers' }));
  if (verge.count) group.add(chunkMeshes(verge, 1200, lawnMaterial(), { receive: true, name: 'verges' }));
  if (rocks.count) group.add(chunkMeshes(rocks, 1500, rockMaterial(), { receive: true, name: 'riprap' }));
  return out;
}

const B_left = (d: { x: number; z: number }) => ({ x: d.z, z: -d.x });
const mid = (a: { x: number; z: number }, b: { x: number; z: number }) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });

/** where the line along dA offset oA meets the line along dB offset oB (null when ~parallel) */
function intersect(n: RNode, dA: { x: number; z: number }, rA: { x: number; z: number }, oA: number, dB: { x: number; z: number }, rB: { x: number; z: number }, oB: number) {
  const ax = n.x + rA.x * oA, az = n.z + rA.z * oA;
  const bx = n.x + rB.x * oB, bz = n.z + rB.z * oB;
  const den = dA.x * dB.z - dA.z * dB.x;
  if (Math.abs(den) < 0.12) return null;
  const t = ((bx - ax) * dB.z - (bz - az) * dB.x) / den;
  return { x: ax + dA.x * t, z: az + dA.z * t };
}

/** fan-triangulate a convex-ish polygon at height y, facing up */
function fan(b: MeshBuilder, poly: { x: number; z: number }[], y: number) {
  if (poly.length < 3) return;
  // orientation: in x-east/z-south a positive shoelace sum is clockwise seen from above
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], c = poly[(i + 1) % poly.length];
    area += a.x * c.z - c.x * a.z;
  }
  const ids = poly.map((p) => b.v(p.x, y, p.z, 0, 1, 0));
  for (let i = 1; i + 1 < ids.length; i++) {
    if (area > 0) b.tri(ids[0], ids[i + 1], ids[i]);
    else b.tri(ids[0], ids[i], ids[i + 1]);
  }
}

/** a concrete jersey barrier along the edge at lateral `lat` (both faces, for the median) */
function jersey(b: MeshBuilder, net: Network, e: REdge, S: number[], lat: number, base: number, h: number, lift: number) {
  const prof = [
    [-base / 2, 0],
    [-base / 2 + 0.06, 0.08],
    [-0.13, 0.33],
    [-0.09, h],
    [0.09, h],
    [0.13, 0.33],
    [base / 2 - 0.06, 0.08],
    [base / 2, 0],
  ];
  const ring: number[][] = [];
  for (const s of S) {
    net.point(e, s, lat, tmp);
    const rx = -tmp.tz, rz = tmp.tx;
    ring.push(prof.flatMap(([o, y]) => [tmp.x + rx * o, tmp.y + lift + y, tmp.z + rz * o]));
  }
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i], c = ring[i + 1];
    for (let k = 0; k + 1 < prof.length; k++) {
      const p = (r: number[], j: number) => [r[j * 3], r[j * 3 + 1], r[j * 3 + 2]];
      b.face([p(a, k + 1), p(c, k + 1), p(c, k), p(a, k)]);
    }
  }
}

function buildDeck(net: Network, e: REdge, run: { s: number; x: number; z: number; y: number; tx: number; tz: number; land: boolean }[], deck: MeshBuilder, barrier: MeshBuilder, half: number, lift: number) {
  const D = 1.5;
  const edge = half + 0.45;
  // sides and underside
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i], c = run[i + 1];
    for (const side of [-1, 1]) {
      const ra = { x: -a.tz * side, z: a.tx * side }, rc = { x: -c.tz * side, z: c.tx * side };
      const ga = a.land ? 0 : WATER_Y - 0.2, gc = c.land ? 0 : WATER_Y - 0.2;
      const ba = Math.max(ga, a.y - D), bc = Math.max(gc, c.y - D);
      const A0 = [a.x + ra.x * edge, ba, a.z + ra.z * edge], A1 = [a.x + ra.x * edge, a.y + lift + 0.02, a.z + ra.z * edge];
      const C0 = [c.x + rc.x * edge, bc, c.z + rc.z * edge], C1 = [c.x + rc.x * edge, c.y + lift + 0.02, c.z + rc.z * edge];
      if (side > 0) deck.face([A0, C0, C1, A1]);
      else deck.face([C0, A0, A1, C1]);
    }
    // underside (only where it's off the ground)
    const ga = a.land ? 0 : WATER_Y, gc = c.land ? 0 : WATER_Y;
    if (a.y - D > ga + 0.3 && c.y - D > gc + 0.3) {
      const L = (u: typeof a, sd: number) => [u.x - u.tz * edge * sd, u.y - D, u.z + u.tx * edge * sd];
      deck.face([L(a, 1), L(a, -1), L(c, -1), L(c, 1)]);
    }
  }
  // the outer barriers (parapets on the low bridges)
  const S = run.map((u) => u.s);
  for (const side of [-1, 1]) jersey(barrier, net, e, S, side * (half + 0.2), 0.42, 0.9, lift);
  // pillar bents every ~32 m where the deck stands clear of the ground
  let next = run[0].s + 8;
  for (const u of run) {
    if (u.s < next) continue;
    const g = u.land ? 0 : WATER_Y - 2;
    const top = u.y - D;
    if (top - (u.land ? 0 : WATER_Y) < 1.6) continue;
    next = u.s + 32;
    const cols = half > 12 ? [-0.6, 0, 0.6] : [-0.5, 0.5];
    for (const c of cols) {
      const x = u.x - u.tz * half * c, z = u.z + u.tx * half * c;
      deck.cylinder(x, g, z, 0.85, 0.78, top - 1.1 - g, 14, false);
    }
    // the cap beam
    deck.box(u.x, top - 0.55, u.z, half * 0.82, 0.55, 0.9, Math.atan2(u.tx, u.tz));
  }
}

function buildFill(net: Network, e: REdge, run: { s: number; x: number; z: number; y: number; tx: number; tz: number }[], verge: MeshBuilder, rocks: MeshBuilder, hw: number, lift: number) {
  void net;
  void e;
  for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i], c = run[i + 1];
    for (const side of [-1, 1]) {
      const P = (u: typeof a, lat: number, y: number) => [u.x - u.tz * lat * side, y, u.z + u.tx * lat * side];
      const v = [P(a, hw - 0.2, a.y + lift - 0.01), P(c, hw - 0.2, c.y + lift - 0.01), P(c, hw + 8, c.y - 0.35), P(a, hw + 8, a.y - 0.35)];
      const r = [P(a, hw + 8, a.y - 0.35), P(c, hw + 8, c.y - 0.35), P(c, hw + 19, WATER_Y - 2.4), P(a, hw + 19, WATER_Y - 2.4)];
      if (side < 0) {
        verge.face(v);
        rocks.face(r);
      } else {
        verge.face([v[1], v[0], v[3], v[2]]);
        rocks.face([r[1], r[0], r[3], r[2]]);
      }
    }
    // the fill under the road itself (seen from a boat)
    const U = (u: typeof a, lat: number) => [u.x - u.tz * lat, u.y + lift - 0.05, u.z + u.tx * lat];
    verge.face([U(a, -hw), U(a, hw), U(c, hw), U(c, -hw)]);
  }
  void LANE_W;
}
