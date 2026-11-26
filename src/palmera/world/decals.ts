// Road decals: manhole covers in the lanes, storm-drain grates along the curbs, darker patches of
// re-laid asphalt and oil stains - from an atlas rendered in Blender (tools/palmera/decals.py ->
// public/palmera/decals.webp, four 1 m tiles). Placed along every paved road, clear of the junctions.
import * as THREE from 'three';
import { LANE_OFF, ROAD_HALF, groundAt, type CityMap } from './map';

export type DecalKind = 'manhole' | 'grate' | 'patch' | 'oil';
export const DECAL_TILE: Record<DecalKind, number> = { manhole: 0, grate: 1, patch: 2, oil: 3 };

/** a flat 1 x 1 m quad on the ground showing one atlas tile */
export function decalGeometry(kind: DecalKind): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const t = DECAL_TILE[kind];
  for (let i = 0; i < uv.count; i++) uv.setX(i, (t + uv.getX(i)) / 4);
  return g;
}

export function placeDecals(map: CityMap): Record<DecalKind, { m: THREE.Matrix4 }[]> {
  const out: Record<DecalKind, { m: THREE.Matrix4 }[]> = { manhole: [], grate: [], patch: [], oil: [] };
  let s = 9091;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const put = (k: DecalKind, x: number, z: number, h: number, sx: number, sz: number, lift: number) => {
    q.setFromAxisAngle(up, h);
    out[k].push({ m: new THREE.Matrix4().compose(new THREE.Vector3(x, groundAt(x, z) + lift, z), q, new THREE.Vector3(sx, 1, sz)) });
  };
  for (const e of map.edges) {
    if (e.swamp || e.len < 24) continue;
    const A = map.nodes[e.a];
    const h = Math.atan2(e.dx, e.dz);
    const rx = -e.dz, rz = e.dx;
    const at = (t: number, off: number): [number, number] => [A.x + e.dx * t + rx * off, A.z + e.dz * t + rz * off];
    const t0 = 8, t1 = e.len - 8;
    // drains along both curbs
    for (const side of [-1, 1]) for (let t = t0 + r() * 10; t < t1; t += 22 + r() * 10) {
      const [x, z] = at(t, side * (ROAD_HALF - 0.22));
      put('grate', x, z, h + Math.PI / 2, 0.75, 0.75, 0.03);
    }
    // manholes on a lane or the centre line
    for (let t = t0 + r() * 15; t < t1; t += 25 + r() * 20) {
      const [x, z] = at(t, [0, LANE_OFF, -LANE_OFF][Math.floor(r() * 3)] + (r() - 0.5) * 0.8);
      put('manhole', x, z, r() * Math.PI * 2, 0.95, 0.95, 0.032);
    }
    // patches of re-laid asphalt
    for (let t = t0 + r() * 40; t < t1; t += 45 + r() * 50) {
      const [x, z] = at(t, (r() - 0.5) * 8);
      put('patch', x, z, h + (r() < 0.5 ? 0 : Math.PI / 2), 1.6 + r() * 2.4, 1.2 + r() * 1.6, 0.026);
    }
    // oil where cars stand and drive
    for (let t = t0 + r() * 8; t < t1; t += 10 + r() * 12) {
      const [x, z] = at(t, (r() < 0.5 ? -1 : 1) * LANE_OFF + (r() - 0.5) * 1.2);
      const k = 0.8 + r() * 1.3;
      put('oil', x, z, r() * Math.PI * 2, k, k * (0.7 + r() * 0.5), 0.029);
    }
  }
  return out;
}
