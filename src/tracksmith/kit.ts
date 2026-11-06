import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Slot, T, levelY, type Placed } from './pieces.ts';
import type { Theme } from './theme.ts';

/**
 * The track kit modelled in Blender (blender/tracksmith/kit.py -> public/tracksmith/kit.glb): every
 * piece swept along the same centre line the collision mesh uses, with ambient occlusion baked into
 * its vertices. The materials are only names; the theme paints them here. Without the file (it
 * failed to load) the game falls back to the plain meshes pieces.ts sweeps.
 */

interface Part { pos: Float32Array; nor: Float32Array; ao: Float32Array; mat: string }
const parts = new Map<string, Part[]>();
let loading: Promise<void> | null = null;

export const kitReady = () => parts.size > 0;

export function loadKit(url = 'tracksmith/kit.glb') {
  return (loading ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url).then((g) => {
    g.scene.updateMatrixWorld(true);
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // (an object with several materials comes in as a group of meshes)
      const name = (m.parent && m.parent !== g.scene ? m.parent.name : m.name).replace(/_\d+$/, '');
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      // (the file is packed: integers with a scale on the node, so read through the attribute and the matrix)
      const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), c = geo.getAttribute('color');
      const pos = new Float32Array(p.count * 3), nor = new Float32Array(p.count * 3), ao = new Float32Array(p.count);
      const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p as THREE.BufferAttribute, i).applyMatrix4(m.matrixWorld).toArray(pos, i * 3);
        v.fromBufferAttribute(n as THREE.BufferAttribute, i).applyMatrix3(nm).normalize().toArray(nor, i * 3);
        ao[i] = c ? c.getX(i) : 1;
      }
      const list = parts.get(name) ?? [];
      list.push({ pos, nor, ao, mat: (m.material as THREE.Material).name });
      parts.set(name, list);
    });
  }).catch((e) => {
    console.warn('[tracksmith] no kit, using the plain meshes', e);
  }));
}

const col = new THREE.Color();
function paint(th: Theme, mat: string) {
  switch (mat) {
    case 'road': return th.road;
    case 'line': return th.roadLine;
    case 'edge': return th.edge;
    case 'edgeAlt': return th.edgeAlt;
    case 'side': return th.side;
    case 'under': return th.under;
    case 'boost': return th.boost;
    case 'block': return th.block;
    case 'blockSide': return th.blockSide;
    case 'steel': return th.pillar;
    case 'dark': return th.under;
    case 'banner': return th.accent;
    case 'accent': return th.accent;
    case 'rail': return th.accent;
    case 'wall': return th.blockSide;
    default: return th.edge;
  }
}
void Slot;

/** a growing buffer of painted triangles */
export class Batch {
  pos: number[] = [];
  nor: number[] = [];
  colr: number[] = [];

  /** a kit object placed by a matrix; `skip` drops one of its materials, `only` keeps just one */
  add(name: string, th: Theme, m: THREE.Matrix4, skip?: string, only?: string) {
    const list = parts.get(name);
    if (!list) return;
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (const p of list) {
      if (p.mat === skip || (only && p.mat !== only)) continue;
      col.setHex(paint(th, p.mat));
      const dark = p.mat === 'dark' ? 0.55 : 1;
      for (let i = 0; i < p.ao.length; i++) {
        v.fromArray(p.pos, i * 3).applyMatrix4(m);
        this.pos.push(v.x, v.y, v.z);
        v.fromArray(p.nor, i * 3).applyMatrix3(nm).normalize();
        this.nor.push(v.x, v.y, v.z);
        const a = p.ao[i] * dark;
        this.colr.push(col.r * a, col.g * a, col.b * a);
      }
    }
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colr, 3));
    return g;
  }
}

/** just one material of a kit object (a gate's lamps, which change colour) */
export function kitPart(name: string, mat: string) {
  const list = parts.get(name)?.filter((p) => p.mat === mat) ?? [];
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], nor: number[] = [];
  for (const p of list) {
    pos.push(...p.pos);
    nor.push(...p.nor);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

export function pieceMatrix(p: Placed) {
  return new THREE.Matrix4().compose(new THREE.Vector3(p.x * T, levelY(p.l), p.z * T), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (p.r * Math.PI) / 2), new THREE.Vector3(1, 1, 1));
}
