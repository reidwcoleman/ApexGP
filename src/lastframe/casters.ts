import * as THREE from 'three';
import { PRE } from './post.ts';

/**
 * What stands still, as the shadow maps and the depth pass want it: nothing but where it is.
 *
 * A lamp's shadow map was drawing the building the way the picture does, a mesh at a time: forty-five draws for the walls
 * (one per material, and a shadow has no material), a hundred more for the furniture. On this kind of card it is the number
 * of draws that costs, not what is in them. So everything solid that never moves is copied once, at load, into a few blocks
 * of bare positions, a block of the map each; those throw the shadows, and the things themselves throw none. The walls and
 * floors get the same treatment for the depth that is laid down before the picture.
 */
const CELL = 24;

interface Soup {
  pos: number[];
  idx: number[];
}

const HIDDEN = (side: THREE.Side) => new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthFunc: THREE.NeverDepth, side });

function mesh(s: Soup, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.pos), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(s.idx), 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  const m = new THREE.Mesh(g, mat);
  m.matrixAutoUpdate = false;
  return m;
}

export function buildCasters(root: THREE.Object3D, skip: Set<THREE.Object3D>): THREE.Group {
  const out = new THREE.Group();
  out.name = 'casters';
  const cast = new Map<string, Soup>(), arch = new Map<string, Soup>();
  const v = new THREE.Vector3(), c = new THREE.Vector3(), m4 = new THREE.Matrix4();
  const put = (into: Map<string, Soup>, key: string, geo: THREE.BufferGeometry, m: THREE.Matrix4) => {
    let s = into.get(key);
    if (!s) into.set(key, (s = { pos: [], idx: [] }));
    const p = geo.getAttribute('position'), base = s.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      s.pos.push(v.x, v.y, v.z);
    }
    const ix = geo.index;
    if (ix) for (let i = 0; i < ix.count; i++) s.idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.count; i++) s.idx.push(base + i);
  };
  const walk = (o: THREE.Object3D) => {
    if (skip.has(o) || !o.visible) return;
    const me = o as THREE.Mesh, mat = me.material as THREE.Material | undefined;
    if (me.isMesh && me.castShadow && mat && !Array.isArray(mat) && mat.alphaTest === 0 && !mat.transparent && me.frustumCulled !== false || (me.isMesh && me.userData.arch && mat && !Array.isArray(mat) && me.castShadow && mat.alphaTest === 0 && !mat.transparent)) {
      const geo = me.geometry, side = mat!.side === THREE.DoubleSide ? 'd' : 's';
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const bs = geo.boundingSphere!;
      const inst = o as THREE.InstancedMesh;
      const one = (m: THREE.Matrix4) => {
        // a clock on a wall, a tin on a counter: no lamp's shadow of it is ever looked for
        if (!me.userData.arch && bs.radius * m.getMaxScaleOnAxis() < 0.3) return;
        c.copy(bs.center).applyMatrix4(m);
        put(cast, `${side}${Math.floor(c.x / CELL)},${Math.floor(c.z / CELL)}`, geo, m);
      };
      if (inst.isInstancedMesh) {
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, m4);
          one(m4.premultiply(inst.matrixWorld));
        }
      } else if (me.userData.arch) {
        // the walls are one mesh the size of the building: it goes in whole, and by its own numbers exactly, so the depth
        // laid down from the copy is the depth the wall itself will ask for
        put(cast, side + 'arch', geo, me.matrixWorld);
        put(arch, side, geo, me.matrixWorld);
      } else one(me.matrixWorld);
      me.castShadow = false;
    }
    for (const k of o.children) walk(k);
  };
  walk(root);
  const mats = { s: HIDDEN(THREE.FrontSide), d: HIDDEN(THREE.DoubleSide) };
  for (const [k, s] of cast) {
    const m = mesh(s, mats[k[0] as 's' | 'd']);
    m.castShadow = true;
    out.add(m);
  }
  for (const [k, s] of arch) {
    const m = mesh(s, mats[k as 's' | 'd']);
    m.frustumCulled = false;
    m.layers.set(k === 'd' ? PRE + 3 : PRE + 2);
    out.add(m);
  }
  return out;
}
