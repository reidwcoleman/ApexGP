import * as THREE from 'three';

/**
 * A tile's props come as one InstancedMesh per prop (all 434 of downtown's street lamps in one), and
 * three can only cull a mesh whole: so every lamp in the tile was drawn whenever any of it was in view,
 * and again into each shadow cascade. Here each one is cut into 64 m cells (each culled on its own), and
 * the small props are dropped past the distance they'd be a few pixels at.
 */
const CELL = 64;

interface Chunk {
  m: THREE.InstancedMesh;
  x: number;
  z: number;
  /** squared distance it's drawn to */
  far2: number;
}

/** how far a prop is worth drawing: by name, then by how big it is */
function reach(name: string, radius: number): number {
  if (/palm|tree|shade|oak/i.test(name)) return 480;
  if (/lamp|pole|signal|light/i.test(name)) return 190;
  if (radius < 1.2) return 160;
  if (radius < 3) return 260;
  return 600;
}

export class Chunks {
  private list: Chunk[] = [];
  private i = 0;

  /** cut up every InstancedMesh under root (with more than a handful of copies) */
  add(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const todo: THREE.InstancedMesh[] = [];
    root.traverse((o) => {
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh && im.count > 6 && !im.userData.chunk && im.instanceMatrix.usage !== THREE.DynamicDrawUsage) todo.push(im);
    });
    const M = new THREE.Matrix4(), W = new THREE.Matrix4(), P = new THREE.Vector3();
    let made = 0;
    for (const im of todo) {
      const parent = im.parent;
      if (!parent) continue;
      if (!im.geometry.boundingSphere) im.geometry.computeBoundingSphere();
      const r0 = im.geometry.boundingSphere!.radius;
      const cells = new Map<string, number[]>();
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, M);
        W.multiplyMatrices(im.matrixWorld, M);
        P.setFromMatrixPosition(W);
        const k = Math.floor(P.x / CELL) + ',' + Math.floor(P.z / CELL);
        let a = cells.get(k);
        if (!a) cells.set(k, (a = []));
        a.push(i);
      }
      const scale = new THREE.Vector3().setFromMatrixScale(im.matrixWorld).x;
      const far = reach(im.name + '|' + ((im.material as THREE.Material).name ?? ''), r0 * scale);
      for (const idx of cells.values()) {
        const c = new THREE.InstancedMesh(im.geometry, im.material, idx.length);
        c.name = im.name;
        c.userData = { ...im.userData, chunk: true };
        c.position.copy(im.position);
        c.quaternion.copy(im.quaternion);
        c.scale.copy(im.scale);
        c.castShadow = im.castShadow;
        c.receiveShadow = im.receiveShadow;
        c.renderOrder = im.renderOrder;
        c.layers.mask = im.layers.mask;
        c.onBeforeRender = im.onBeforeRender;
        let sx = 0, sz = 0;
        idx.forEach((src, j) => {
          im.getMatrixAt(src, M);
          c.setMatrixAt(j, M);
          if (im.instanceColor) {
            const col = new THREE.Color();
            im.getColorAt(src, col);
            c.setColorAt(j, col);
          }
          W.multiplyMatrices(im.matrixWorld, M);
          P.setFromMatrixPosition(W);
          sx += P.x;
          sz += P.z;
        });
        c.instanceMatrix.needsUpdate = true;
        c.computeBoundingSphere();
        c.computeBoundingBox();
        parent.add(c);
        this.list.push({ m: c, x: sx / idx.length, z: sz / idx.length, far2: far * far });
        made++;
      }
      im.removeFromParent();
    }
    if (todo.length) console.info('[chunks]', todo.length, 'instanced meshes into', made);
  }

  /** hide the cells past their distance (a slice of them a frame: they change slowly) */
  update(eye: THREE.Vector3) {
    const n = this.list.length;
    if (!n) return;
    const step = Math.min(n, 400);
    for (let k = 0; k < step; k++) {
      this.i = (this.i + 1) % n;
      const c = this.list[this.i];
      c.m.visible = (c.x - eye.x) ** 2 + (c.z - eye.z) ** 2 < c.far2;
    }
  }
}
