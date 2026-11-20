import * as THREE from 'three';
import type { Box, World } from './collide.ts';
import { BOARDS, BOARDS_WAY } from './shared.ts';

/** A doorway with nothing hung in it: where a barricade can go. Game axes; alongX: the wall it is in runs along x. */
export interface Opening {
  i: number;
  x: number;
  y: number;
  z: number;
  w: number;
  alongX: boolean;
  h: number;
}

/** the map's doorways, each measured up to its head */
export function openingsOf(list: number[][] | undefined, world: World): Opening[] {
  const out: Opening[] = [];
  (list ?? []).forEach((o, i) => {
    const [x, y, z, w, ax] = o;
    const hit = world.ray(x, y + 0.4, z, 0, 1, 0, 3.2, false, true);
    const h = Math.min(2.6, Math.max(2.0, hit ? hit.t + 0.4 : 2.3));
    out.push({ i, x, y, z, w, alongX: ax > 0, h });
  });
  return out;
}

/** the span of board k of a barricade, from the floor */
export function boardSpan(o: Opening, k: number): [number, number] {
  const pitch = (o.h - 0.12) / BOARDS;
  return [o.y + 0.08 + k * pitch, o.y + 0.08 + (k + 1) * pitch - 0.05];
}

/** can a standing body get through with these boards up? */
export const barPassable = (boards: number) => (boards & BOARDS_WAY) === 0;

/**
 * Boards nailed across a doorway. Each board is its own thing to the world: it stops a body, slows a round, and can be
 * shot or kicked out on its own, so a barricade comes apart a board at a time and what is behind it shows through the gap.
 */
export class Barricade {
  boards = 0;
  readonly boxes: Box[] = [];
  readonly planks: THREE.Group[] = [];
  readonly group = new THREE.Group();
  /** the charge on it, while there is one */
  charge: THREE.Mesh | null = null;

  constructor(readonly o: Opening, world: World, mat: THREE.Material) {
    const rnd = (n: number) => {
      const s = Math.sin(o.i * 91.7 + n * 37.3) * 43758.5453;
      return s - Math.floor(s);
    };
    for (let k = 0; k < BOARDS; k++) {
      const [y0, y1] = boardSpan(o, k);
      const half = o.w / 2;
      const box: Box = o.alongX
        ? { min: [o.x - half, y0, o.z - 0.03], max: [o.x + half, y1, o.z + 0.03], pen: true, tag: 'bar', mat: 'planks', off: true, id: o.i * 8 + k }
        : { min: [o.x - 0.03, y0, o.z - half], max: [o.x + 0.03, y1, o.z + half], pen: true, tag: 'bar', mat: 'planks', off: true, id: o.i * 8 + k };
      world.add(box);
      this.boxes.push(box);
      // two planks to a board, each longer than the doorway, nailed to the frame either side and never quite level
      const unit = new THREE.Group();
      const ph = (y1 - y0 - 0.03) / 2;
      for (let q = 0; q < 2; q++) {
        const r = k * 2 + q;
        const len = o.w + 0.16 + rnd(r) * 0.16;
        const geo = new THREE.BoxGeometry(len, ph, 0.024);
        // the grain runs the length of the plank
        const uv = geo.attributes.uv;
        const u0 = rnd(r + 9) * 0.8, v0 = rnd(r + 5) * 0.5;
        for (let n = 0; n < uv.count; n++) uv.setXY(n, u0 + uv.getY(n) * 0.11, v0 + uv.getX(n) * len * 0.45);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(o.x, y0 + ph / 2 + q * (ph + 0.03), o.z);
        const side = (r % 2 ? 1 : -1) * 0.013 + (rnd(r + 3) - 0.5) * 0.008;
        const slide = (rnd(r + 7) - 0.5) * 0.08;
        if (o.alongX) {
          mesh.position.z += side;
          mesh.position.x += slide;
        } else {
          mesh.rotation.y = Math.PI / 2;
          mesh.position.x += side;
          mesh.position.z += slide;
        }
        mesh.rotation.z = (rnd(r + 2) - 0.5) * 0.05;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        unit.add(mesh);
      }
      unit.visible = false;
      this.planks.push(unit);
      this.group.add(unit);
    }
  }

  /** the boards that are up now; returns the ones that just went */
  set(mask: number): number {
    const gone = this.boards & ~mask;
    this.boards = mask;
    for (let k = 0; k < BOARDS; k++) {
      const up = (mask >> k & 1) === 1;
      this.boxes[k].off = !up;
      this.planks[k].visible = up;
    }
    return gone;
  }

  centre(k: number, out = new THREE.Vector3()) {
    const [y0, y1] = boardSpan(this.o, k);
    return out.set(this.o.x, (y0 + y1) / 2, this.o.z);
  }
}
