import * as THREE from 'three';
import { box, cyl, merge } from '../core/geo';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SIDEWALK, groundAt, type CityMap } from './map';

/**
 * The street props modelled in Blender (tools/palmera/props.py -> public/palmera/props.glb): bevelled,
 * detailed, ambient occlusion baked into their vertex colours. Each prop_<kind> object becomes a plain
 * non-indexed geometry (position, normal, colour) in the same space as the hand-built ones below.
 */
const propKit = new Map<string, THREE.BufferGeometry>();

export async function loadPropKit(): Promise<void> {
  try {
    const base = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/') + 'palmera/';
    const gl = await new GLTFLoader().loadAsync(base + 'props.glb');
    gl.scene.updateMatrixWorld(true);
    gl.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      const r = /^prop_(\w+)$/.exec(o.name);
      if (!m.isMesh || !r) return;
      let g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      const n = g.getAttribute('position').count;
      const src = g.getAttribute('color');
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set(src ? [src.getX(i), src.getY(i), src.getZ(i)] : [0.5, 0.5, 0.5], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      g.computeBoundingSphere();
      g.computeBoundingBox();
      propKit.set(r[1], g);
    });
  } catch (e) {
    console.warn('palmera: props.glb failed, using the hand-built props', e);
  }
}

/** a Blender-modelled prop, if the kit has it */
export function propGeometry(name: string): THREE.BufferGeometry | null {
  const g = propKit.get(name);
  return g ? g.clone() : null;
}

/**
 * What a sidewalk is furnished with: benches, litter bins, hydrants, newspaper boxes, parking
 * meters, planters with shrubs, street-name signs and bus shelters. Each kind is one geometry
 * (vertex coloured), placed along the curbs of every block, front toward the road (+z).
 */

export type FurnitureKind = 'bench' | 'bin' | 'hydrant' | 'news' | 'meter' | 'planter' | 'sign' | 'shelter';

export function furnitureGeometry(kind: FurnitureKind, modelledOk = true): THREE.BufferGeometry {
  const modelled = modelledOk ? propGeometry(kind) : null;
  if (modelled) return modelled;
  const P: THREE.BufferGeometry[] = [];
  switch (kind) {
    case 'bench':
      for (let i = 0; i < 4; i++) P.push(box(1.8, 0.04, 0.09, 0, 0.45, -0.18 + i * 0.11, 0x8a5a34));
      for (let i = 0; i < 3; i++) P.push(box(1.8, 0.09, 0.035, 0, 0.62 + i * 0.12, -0.27, 0x8a5a34));
      for (const x of [-0.75, 0.75]) {
        P.push(box(0.06, 0.45, 0.4, x, 0.225, -0.05, 0x2a2c2e));
        P.push(box(0.05, 0.45, 0.05, x, 0.7, -0.29, 0x2a2c2e));
      }
      break;
    case 'bin':
      P.push(cyl(0.27, 0.25, 0.85, 12, 0, 0.425, 0, 0x2f5a3c));
      P.push(cyl(0.3, 0.3, 0.07, 12, 0, 0.88, 0, 0x234431));
      P.push(cyl(0.12, 0.12, 0.04, 8, 0, 0.93, 0, 0x111111));
      break;
    case 'hydrant':
      P.push(cyl(0.12, 0.14, 0.62, 10, 0, 0.31, 0, 0xd8b21c));
      P.push(cyl(0.15, 0.1, 0.12, 10, 0, 0.67, 0, 0xd8b21c));
      P.push(cyl(0.05, 0.05, 0.34, 8, 0, 0.42, 0, 0xc49e10, 'x'));
      P.push(cyl(0.06, 0.06, 0.1, 8, 0, 0.42, 0.13, 0xc49e10, 'z'));
      P.push(cyl(0.18, 0.18, 0.05, 10, 0, 0.025, 0, 0xb0920e));
      break;
    case 'news': {
      const cols = [0x2b5fa8, 0xd8402e, 0xf2c14e];
      cols.forEach((c, i) => {
        const x = (i - 1) * 0.5;
        P.push(box(0.44, 0.75, 0.38, x, 0.5, 0, c));
        P.push(box(0.36, 0.22, 0.02, x, 0.68, 0.2, 0xdedad0));
        P.push(box(0.04, 0.12, 0.3, x - 0.15, 0.06, 0, 0x2a2a2a));
        P.push(box(0.04, 0.12, 0.3, x + 0.15, 0.06, 0, 0x2a2a2a));
      });
      break;
    }
    case 'meter':
      P.push(cyl(0.035, 0.035, 1.1, 8, 0, 0.55, 0, 0x3a3d40));
      P.push(box(0.2, 0.32, 0.16, 0, 1.25, 0, 0x6e7378));
      P.push(box(0.14, 0.1, 0.02, 0, 1.3, 0.085, 0x1a2a20));
      break;
    case 'planter':
      P.push(cyl(0.55, 0.45, 0.55, 14, 0, 0.275, 0, 0xd9d2c4));
      P.push(cyl(0.5, 0.5, 0.05, 14, 0, 0.53, 0, 0x4a3524));
      {
        const s = new THREE.IcosahedronGeometry(0.55, 1);
        const pos = s.getAttribute('position');
        for (let i = 0; i < pos.count; i++) {
          const k = 1 + (Math.sin(pos.getX(i) * 9) + Math.cos(pos.getZ(i) * 7)) * 0.08;
          pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.85, pos.getZ(i) * k);
        }
        s.computeVertexNormals();
        s.translate(0, 0.95, 0);
        P.push(box(0.001, 0.001, 0.001, 0, 0, 0, 0x000000));
        const g = s.index ? s.toNonIndexed() : s;
        const n = g.getAttribute('position').count;
        const col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const y = g.getAttribute('position').getY(i);
          const c = new THREE.Color(0x3f7a33).lerp(new THREE.Color(0x77a84a), (y - 0.6) * 1.2);
          if (Math.sin(i * 12.9898) > 0.93) c.setHex(0xe2496b);
          col.set([c.r, c.g, c.b], i * 3);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        if (g.getAttribute('uv')) g.deleteAttribute('uv');
        P.push(g);
      }
      break;
    case 'sign':
      P.push(cyl(0.035, 0.035, 3.2, 8, 0, 1.6, 0, 0x3a3d40));
      P.push(box(1.1, 0.24, 0.03, 0, 3.0, 0, 0x1d6b3e));
      P.push(box(0.03, 0.24, 1.1, 0, 2.7, 0, 0x1d6b3e));
      P.push(box(0.5, 0.6, 0.03, 0, 2.15, 0.02, 0xeeeeee));
      P.push(box(0.42, 0.5, 0.032, 0, 2.15, 0.025, 0xc0392b));
      break;
    case 'shelter':
      P.push(box(3.6, 0.1, 1.6, 0, 2.55, -0.1, 0xe8e6e0));
      for (const x of [-1.7, 1.7]) P.push(box(0.08, 2.5, 0.08, x, 1.25, -0.8, 0x3a3d40), box(0.08, 2.5, 0.08, x, 1.25, 0.55, 0x3a3d40));
      P.push(box(3.4, 1.9, 0.03, 0, 1.35, -0.82, 0x9fb6c0));
      P.push(box(0.03, 1.9, 1.3, -1.7, 1.35, -0.15, 0x9fb6c0));
      P.push(box(1.1, 1.7, 0.06, 1.0, 1.35, -0.78, 0xf2b84b));
      P.push(box(2.0, 0.06, 0.4, -0.5, 0.48, -0.55, 0x8a8d90));
      P.push(box(2.0, 0.45, 0.04, -0.5, 0.24, -0.72, 0x3a3d40));
      break;
  }
  return merge(P);
}

export interface FurnitureItem { kind: FurnitureKind; m: THREE.Matrix4 }

/** along every block's curbs, every few metres, something (clear of corners, lamps and palms) */
export function placeFurniture(map: CityMap): FurnitureItem[] {
  const out: FurnitureItem[] = [];
  let s = 1234567;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const props = map.props.filter((p) => p.kind === 'lamp' || p.kind === 'palm' || p.kind === 'tree');
  const clear = (x: number, z: number) => {
    for (const p of props) if (Math.abs(p.x - x) < 1.6 && Math.abs(p.z - z) < 1.6) return false;
    return true;
  };
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let blockN = 0;
  for (const b of map.blocks) {
    if (b.park || !b.walk) continue;
    blockN++;
    const edges: { x0: number; z0: number; x1: number; z1: number; yaw: number }[] = [
      { x0: b.x0 + 0.85, z0: b.z0, x1: b.x0 + 0.85, z1: b.z1, yaw: -Math.PI / 2 },
      { x0: b.x1 - 0.85, z0: b.z0, x1: b.x1 - 0.85, z1: b.z1, yaw: Math.PI / 2 },
      { x0: b.x0, z0: b.z0 + 0.85, x1: b.x1, z1: b.z0 + 0.85, yaw: Math.PI },
      { x0: b.x0, z0: b.z1 - 0.85, x1: b.x1, z1: b.z1 - 0.85, yaw: 0 },
    ];
    edges.forEach((e, ei) => {
      const len = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
      if (len < 20) return;
      const dx = (e.x1 - e.x0) / len, dz = (e.z1 - e.z0) / len;
      // a street sign at one corner
      if (ei === 0) {
        const x = e.x0 + dx * 2.2, z = e.z0 + dz * 2.2;
        out.push({ kind: 'sign', m: new THREE.Matrix4().compose(new THREE.Vector3(x, groundAt(x, z), z), q.setFromAxisAngle(up, e.yaw), new THREE.Vector3(1, 1, 1)) });
      }
      // a bus shelter on some blocks
      if (ei === 2 && blockN % 3 === 0 && len > 40) {
        const t = len * 0.5;
        const x = e.x0 + dx * t + (e.yaw === Math.PI ? 0 : 0), z = e.z0 + dz * t + 0.6 * (e.yaw === Math.PI ? 1 : -1);
        if (clear(x, z)) {
          out.push({ kind: 'shelter', m: new THREE.Matrix4().compose(new THREE.Vector3(x, groundAt(x, z), z), q.setFromAxisAngle(up, e.yaw), new THREE.Vector3(1, 1, 1)) });
          return;
        }
      }
      for (let t = 7 + rnd() * 4; t < len - 7; t += 7 + rnd() * 9) {
        const x = e.x0 + dx * t, z = e.z0 + dz * t;
        if (!clear(x, z)) continue;
        const r = rnd();
        const kind: FurnitureKind = r < 0.2 ? 'bench' : r < 0.38 ? 'bin' : r < 0.5 ? 'hydrant' : r < 0.6 ? 'news' : r < 0.78 ? 'meter' : r < 0.97 ? 'planter' : 'bench';
        const inset = kind === 'planter' ? 0.6 : kind === 'bench' ? 0.9 : kind === 'news' ? 0.8 : 0;
        // inset away from the curb, toward the buildings
        const ix = e.yaw === -Math.PI / 2 ? inset : e.yaw === Math.PI / 2 ? -inset : 0;
        const iz = e.yaw === Math.PI ? inset : e.yaw === 0 ? -inset : 0;
        const px = x + ix, pz = z + iz;
        void SIDEWALK;
        out.push({ kind, m: new THREE.Matrix4().compose(new THREE.Vector3(px, groundAt(px, pz), pz), q.setFromAxisAngle(up, e.yaw + (kind === 'bench' ? 0 : rnd() * 0.2 - 0.1)), new THREE.Vector3(1, 1, 1)) });
      }
    });
  }
  return out;
}
