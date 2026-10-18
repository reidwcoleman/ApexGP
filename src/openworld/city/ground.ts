import * as THREE from 'three';
import { BEACH_OCEAN_SHORE, LANDS, WATER_Y, WORLD, ll, type LandMask, type P2 } from '../geo.ts';
import { buildWater, type Water } from '../../world/env/water.ts';
import { MeshBuilder, chunkMeshes } from './build.ts';
import { concreteMaterial, lawnMaterial, sandMaterial } from './materials.ts';

/**
 * The land (every island's top at y = 0, lawn under everything the streets and lots don't cover),
 * the seawalls round it (Miami's shore is almost all wall), Miami Beach's Atlantic beach (a sand
 * strip sloping into the surf) and the water: Biscayne Bay (calm, clear green-turquoise) and the
 * Atlantic (bluer, with surf on the beach), each shading its shallows from a depth map rasterised
 * from the land.
 */

export interface GroundBuild {
  group: THREE.Group;
  water: Water[];
  /** the beach: metres inland of the waterline at a given z (for props) */
  beachX(z: number): number;
}

/** the dry beach's width (sand from the waterline inland) */
export const BEACH_W = 118;

/**
 * The land's top: the outline triangulated, then cut down to small triangles (≤ ~170 m in the
 * map, larger out in the far land). The outlines run 30 km past the map, and a triangle that size
 * interpolates its depth too coarsely: from a few hundred metres the bay, a metre below, showed
 * through the lawns.
 */
function topGeometry(outline: P2[]): THREE.BufferGeometry {
  const pts = outline.map((p) => new THREE.Vector2(p.x, p.z));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const out: number[] = [];
  const maxLen = (x: number, z: number) => {
    const dx = Math.max(WORLD.x0 - x, 0, x - WORLD.x1), dz = Math.max(WORLD.z0 - z, 0, z - WORLD.z1);
    return 170 + Math.hypot(dx, dz) * 0.6;
  };
  const emit = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, depth: number) => {
    const lab = Math.hypot(bx - ax, bz - az), lbc = Math.hypot(cx - bx, cz - bz), lca = Math.hypot(ax - cx, az - cz);
    const l = Math.max(lab, lbc, lca);
    if (depth < 40 && l > maxLen((ax + bx + cx) / 3, (az + bz + cz) / 3)) {
      // (halved across its longest side: the slivers the triangulation makes don't multiply)
      if (l === lab) {
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        emit(ax, az, mx, mz, cx, cz, depth + 1);
        emit(mx, mz, bx, bz, cx, cz, depth + 1);
      } else if (l === lbc) {
        const mx = (bx + cx) / 2, mz = (bz + cz) / 2;
        emit(ax, az, bx, bz, mx, mz, depth + 1);
        emit(ax, az, mx, mz, cx, cz, depth + 1);
      } else {
        const mx = (cx + ax) / 2, mz = (cz + az) / 2;
        emit(ax, az, bx, bz, mx, mz, depth + 1);
        emit(mx, mz, bx, bz, cx, cz, depth + 1);
      }
      return;
    }
    // (wound to face up)
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (cross > 0) out.push(ax, 0, az, cx, 0, cz, bx, 0, bz);
    else out.push(ax, 0, az, bx, 0, bz, cx, 0, cz);
  };
  for (const [a, b, c] of tris) emit(pts[a].x, pts[a].y, pts[b].x, pts[b].y, pts[c].x, pts[c].y, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const n = new Float32Array(out.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.computeBoundingSphere();
  return g;
}

const onWorldEdge = (a: P2, b: P2) => {
  // any edge out in the far land (the outlines run 30 km past the map) is no shore
  const far = (p: P2) => p.x < WORLD.x0 - 1000 || p.z < WORLD.z0 - 1000 || p.z > WORLD.z1 + 1000;
  return far(a) || far(b);
};

export function buildGround(mask: LandMask): GroundBuild {
  const group = new THREE.Group();
  group.name = 'Ground';
  const lawn = lawnMaterial();
  // PortMiami's island is all quay, yards and car parks: concrete, not lawn
  const port = concreteMaterial(0x9d9a93, 0.9, true);
  for (const L of LANDS) {
    const m = new THREE.Mesh(topGeometry(L.outline), L.name === 'Dodge Island' ? port : lawn);
    m.receiveShadow = true;
    m.name = 'land_' + L.name;
    group.add(m);
  }

  // ---- seawalls: a concrete cap and a wall down into the water (not along the beach)
  const wall = new MeshBuilder();
  const isBeach = (a: P2, b: P2) => BEACH_OCEAN_SHORE.some((p) => (Math.abs(p.x - a.x) < 1 && Math.abs(p.z - a.z) < 1) || (Math.abs(p.x - b.x) < 1 && Math.abs(p.z - b.z) < 1)) && Math.abs(a.x - b.x) < 400;
  for (const L of LANDS) {
    const o = L.outline;
    // which way is outward: signed area
    let area = 0;
    for (let i = 0; i < o.length; i++) area += o[i].x * o[(i + 1) % o.length].z - o[(i + 1) % o.length].x * o[i].z;
    const out = area > 0 ? -1 : 1;
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length];
      if (onWorldEdge(a, b) || isBeach(a, b)) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const l = Math.hypot(dx, dz);
      if (l < 0.1) continue;
      // outward normal
      const nx = (-dz / l) * out, nz = (dx / l) * out;
      // the cap: a 0.6 m concrete coping, a hair proud of the lawn
      const A = [a.x, 0.06, a.z], B = [b.x, 0.06, b.z];
      const Ao = [a.x + nx * 0.6, 0.06, a.z + nz * 0.6], Bo = [b.x + nx * 0.6, 0.06, b.z + nz * 0.6];
      const Aw = [a.x + nx * 0.6, WATER_Y - 3, a.z + nz * 0.6], Bw = [b.x + nx * 0.6, WATER_Y - 3, b.z + nz * 0.6];
      // orient each face outward/up by testing its computed normal
      pushFace(wall, [A, B, Bo, Ao], [0, 1, 0]);
      pushFace(wall, [Ao, Bo, Bw, Aw], [nx, 0, nz]);
    }
  }
  group.add(chunkMeshes(wall, 1500, concreteMaterial(0xd2ccc0, 0.8, true), { receive: true, cast: false, name: 'seawalls' }));

  // ---- Miami Beach: the sand strip and its slope into the Atlantic
  const sand = new MeshBuilder().attr('aShoreD', 1);
  const shore = BEACH_OCEAN_SHORE;
  for (let i = 0; i + 1 < shore.length; i++) {
    const a = shore[i], b = shore[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    // inland = west-ish: rotate the along-shore direction
    const ix = dz / l, iz = -dx / l;
    const ox = -ix, oz = -iz;
    // dry sand (y 0.02 → 0.25 dune crest), the wet slope (0 → under water)
    const steps: [number, number][] = [
      [BEACH_W, 0.03],
      [BEACH_W - 10, 0.3],
      [60, 0.18],
      [24, 0.02],
      [0, -0.55],
      [-14, WATER_Y - 0.6],
      [-40, WATER_Y - 2.6],
    ];
    const rows: number[][] = [];
    for (const [d, y] of steps) {
      sand.set('aShoreD', d);
      const ra = d >= 0 ? sand.v(a.x + ix * d, y, a.z + iz * d) : sand.v(a.x + ox * -d, y, a.z + oz * -d);
      const rb = d >= 0 ? sand.v(b.x + ix * d, y, b.z + iz * d) : sand.v(b.x + ox * -d, y, b.z + oz * -d);
      rows.push([ra, rb]);
    }
    for (let k = 0; k + 1 < rows.length; k++) {
      // rows go inland → sea; a, b along the shore (northward): facing up
      sand.quad(rows[k][0], rows[k + 1][0], rows[k + 1][1], rows[k][1]);
    }
  }
  const sandGeo = sand.build(true);
  // make sure it faces up
  const nAttr = sandGeo.getAttribute('normal') as THREE.BufferAttribute;
  if (nAttr.getY(0) < 0) {
    const idx = sandGeo.index!;
    for (let t = 0; t < idx.count; t += 3) {
      const b = idx.getX(t + 1);
      idx.setX(t + 1, idx.getX(t + 2));
      idx.setX(t + 2, b);
    }
    sandGeo.computeVertexNormals();
  }
  const sandMesh = new THREE.Mesh(sandGeo, sandMaterial());
  sandMesh.receiveShadow = true;
  sandMesh.name = 'beach';
  group.add(sandMesh);

  // ---- water: the bay and the ocean, split along the barrier island and down past Fisher Island
  const split = [
    { x: BEACH_OCEAN_SHORE[BEACH_OCEAN_SHORE.length - 1].x + 300, z: WORLD.z0 - 30000 },
    ...BEACH_OCEAN_SHORE.slice()
      .reverse()
      .map((p) => ({ x: p.x - 250, z: p.z })),
    ll(25.7642, -80.1352),
    ll(25.7618, -80.1372),
    ll(25.7560, -80.1365),
    { x: ll(0, -80.1360).x, z: WORLD.z1 + 30000 },
  ];
  const far = 26000;
  const ocean = [...split, { x: WORLD.x1 + far, z: WORLD.z1 + 30000 }, { x: WORLD.x1 + far, z: WORLD.z0 - 30000 }];
  const bay = [...split, { x: WORLD.x0 - 4000, z: WORLD.z1 + 30000 }, { x: WORLD.x0 - 4000, z: WORLD.z0 - 30000 }];
  const depth = depthMap(mask);
  const W: Water[] = [];
  const bayW = buildWater({
    outline: bay,
    y: WATER_Y,
    kind: 'basin',
    deep: [0.016, 0.07, 0.068],
    shallow: [0.06, 0.17, 0.14],
    shore: 0,
    depth: { map: depth.tex, x0: WORLD.x0, z0: WORLD.z0, x1: WORLD.x1, z1: WORLD.z1, range: 6 },
  });
  const oceanW = buildWater({
    outline: ocean,
    y: WATER_Y - 0.004,
    kind: 'sea',
    deep: [0.006, 0.03, 0.055],
    shallow: [0.05, 0.17, 0.17],
    shore: 0,
    depth: { map: depth.tex, x0: WORLD.x0, z0: WORLD.z0, x1: WORLD.x1, z1: WORLD.z1, range: 6 },
  });
  W.push(bayW, oceanW);
  group.add(bayW.mesh, oceanW.mesh);

  const beachX = (z: number) => {
    for (let i = 0; i + 1 < shore.length; i++) {
      const a = shore[i], b = shore[i + 1];
      if ((z <= a.z && z >= b.z) || (z >= a.z && z <= b.z)) {
        const t = (z - a.z) / (b.z - a.z || 1);
        return a.x + (b.x - a.x) * t;
      }
    }
    return shore[0].x;
  };
  return { group, water: W, beachX };
}

function pushFace(b: MeshBuilder, p: number[][], want: number[]) {
  const [a, c, d] = p;
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * want[0] + ny * want[1] + nz * want[2] < 0) b.face([p[3], p[2], p[1], p[0]]);
  else b.face(p);
}

/**
 * Water depth from the shore (a two-pass chamfer distance over the land mask): R = depth / range.
 * Seawalls drop off fast (the bay's channels), the Atlantic shelves gently off the beach.
 */
function depthMap(mask: LandMask): { tex: THREE.DataTexture } {
  const w = mask.w, h = mask.h;
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask.data[i] ? 0 : INF;
  const c = mask.cell;
  const D1 = c, D2 = c * Math.SQRT2;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (d[k] === 0) continue;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + D1);
      if (j > 0) {
        v = Math.min(v, d[k - w] + D1);
        if (i > 0) v = Math.min(v, d[k - w - 1] + D2);
        if (i < w - 1) v = Math.min(v, d[k - w + 1] + D2);
      }
      d[k] = v;
    }
  for (let j = h - 1; j >= 0; j--)
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      if (d[k] === 0) continue;
      let v = d[k];
      if (i < w - 1) v = Math.min(v, d[k + 1] + D1);
      if (j < h - 1) {
        v = Math.min(v, d[k + w] + D1);
        if (i < w - 1) v = Math.min(v, d[k + w + 1] + D2);
        if (i > 0) v = Math.min(v, d[k + w - 1] + D2);
      }
      d[k] = v;
    }
  const beachEast = ll(0, -80.1320).x;
  const px = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = WORLD.x0 + (i + 0.5) * c;
      // metres of water: gentle off the Atlantic beach, a fast drop off the seawalls
      const slope = x > beachEast ? 0.035 : 0.09;
      const depth = Math.min(d[k], 400) * slope;
      const v = Math.min(255, Math.round((depth / 6) * 255));
      px[k * 4] = v;
      px[k * 4 + 1] = v;
      px[k * 4 + 2] = v;
      px[k * 4 + 3] = 255;
    }
  const tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  return { tex };
}
