import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const tmpColor = new THREE.Color();

/** Normalise a geometry for merging: non-indexed, position + normal + color only. */
export function prep(g: THREE.BufferGeometry, color: number | THREE.Color | ((x: number, y: number, z: number) => THREE.Color), keepUv = false): THREE.BufferGeometry {
  let geo = g.index ? g.toNonIndexed() : g;
  if (!keepUv && geo.getAttribute('uv')) geo.deleteAttribute('uv');
  if (geo.getAttribute('uv1')) geo.deleteAttribute('uv1');
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let c: THREE.Color;
    if (typeof color === 'function') c = color(pos.getX(i), pos.getY(i), pos.getZ(i));
    else if (typeof color === 'number') c = tmpColor.setHex(color);
    else c = color;
    cols[i * 3] = c.r;
    cols[i * 3 + 1] = c.g;
    cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return prep(g, color);
}

export function cyl(rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, color: number, axis: 'x' | 'y' | 'z' = 'y'): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return prep(g, color);
}

export function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(list, false);
  if (!m) throw new Error('merge failed');
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

export function mergeGroups(groups: THREE.BufferGeometry[][]): THREE.BufferGeometry {
  const parts = groups.map((g) => merge(g));
  const m = mergeGeometries(parts, true);
  if (!m) throw new Error('merge failed');
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

export function hex(c: number): THREE.Color {
  return new THREE.Color(c);
}
