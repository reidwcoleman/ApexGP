import * as THREE from 'three';
import type { WorldMap } from '../worldmap.ts';
import { ARDENNES_TOWNS } from '../worldmap.ts';
import { rng } from '../noise.ts';
import { Plain } from './monzaScenery.ts';

/**
 * Spa's own landmarks beyond the circuit (the houses themselves are villages.ts, in the Belgian
 * palette, where worldmap's ARDENNES_TOWNS put them):
 *
 *   the churches      Francorchamps' grey-stone church on its village green, the west tower under
 *                     a tall slate spire, the nave and the lower chancel under steep slate; a chapel
 *                     with a squat spire in each hamlet
 *
 * One vertex-colour mesh for the stone and slate; no shadows cast.
 */

const C = (h: number) => new THREE.Color(h);

export interface SpaSceneryBuild {
  group: THREE.Group;
  count: number;
}

export function buildSpaScenery(map: WorldMap): SpaSceneryBuild {
  const group = new THREE.Group();
  group.name = 'SpaScenery';
  const plain = new Plain();
  const r = rng(4410);
  let count = 0;
  const ground = (x: number, z: number) => map.height(x, z);

  // ---------------------------------------------------------------- the churches
  const STONE = C(0x7d766c), STONE2 = C(0x8c8478), SLATE = C(0x33363b), SLATE2 = C(0x2b2e32), TRIM = C(0xa49b8c);
  /**
   * A village church, its axis along local z (rot: local +z = east, the altar end), the tower at
   * the west end. `k` scales the whole (1 = Francorchamps' church, ~0.6 = a hamlet chapel).
   */
  const church = (x: number, z: number, rot: number, k: number) => {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const at = (lx: number, lz: number) => ({ x: x + lx * ca + lz * sa, z: z - lx * sa + lz * ca });
    // (set on the lowest corner of its footprint so no wall floats on a slope)
    let y = Infinity;
    for (const [lx, lz] of [[-7, -20], [7, -20], [-7, 20], [7, 20], [0, 0]]) {
      const q = at(lx * k, lz * k);
      y = Math.min(y, ground(q.x, q.z));
    }
    y -= 0.5;
    const navW = 12 * k, navL = 26 * k, navH = 9 * k;
    // the nave: stone walls, a plinth, steep slate (55°)
    {
      const q = at(0, 0);
      plain.box(q.x, q.z, y, y + navH, navW, navL, rot, STONE);
      plain.box(q.x, q.z, y, y + 1.2 * k + 0.5, navW + 0.5, navL + 0.5, rot, STONE2);
      plain.box(q.x, q.z, y + navH, y + navH + 0.35, navW + 1, navL + 0.6, rot, TRIM);
      plain.gable(q.x, q.z, y + navH + 0.3, y + navH + 0.3 + navW * 0.72, navW + 1.4, navL + 0.8, rot, SLATE);
      // tall round-headed windows down each side (dark glass set into the wall)
      for (let i = -2; i <= 2; i++)
        for (const sx of [-1, 1]) {
          const w = at(sx * (navW / 2 + 0.02), i * navL * 0.18);
          plain.box(w.x, w.z, y + 2.6 * k, y + navH - 1.4 * k, 0.12, 1.5 * k, rot, C(0x1d2024));
        }
    }
    // the chancel: lower and narrower, at the east end
    {
      const q = at(0, navL / 2 + 4.5 * k);
      const cw = navW * 0.72, ch = navH * 0.8;
      plain.box(q.x, q.z, y, y + ch, cw, 9 * k, rot, STONE);
      plain.gable(q.x, q.z, y + ch, y + ch + cw * 0.7, cw + 1, 9.6 * k, rot, SLATE);
    }
    // the west tower and its slate spire (a square base broaching to an octagon reads, from the
    // circuit, as a slim four-sided needle) and the cross on top
    {
      const tw = 7.5 * k, th = 22 * k + 4;
      const q = at(0, -navL / 2 - tw / 2 + 0.3);
      plain.box(q.x, q.z, y, y + th, tw, tw, rot, STONE2);
      plain.box(q.x, q.z, y + th - 0.4, y + th + 0.3, tw + 0.5, tw + 0.5, rot, TRIM);
      // belfry louvres on all four faces
      for (const [lx, lz, w, d] of [[0, tw / 2 + 0.02, 2.2 * k, 0.12], [0, -tw / 2 - 0.02, 2.2 * k, 0.12], [tw / 2 + 0.02, 0, 0.12, 2.2 * k], [-tw / 2 - 0.02, 0, 0.12, 2.2 * k]] as const) {
        const b = at(lx, -navL / 2 - tw / 2 + 0.3 + lz);
        plain.box(b.x, b.z, y + th - 5 * k, y + th - 1.5 * k, w, d, rot, C(0x22252a));
      }
      // the broach: a short skirt, then the needle
      plain.box(q.x, q.z, y + th + 0.3, y + th + 2.2 * k, tw + 0.6, tw + 0.6, rot, SLATE2, 0.62);
      const sh = 20 * k + 3;
      plain.box(q.x, q.z, y + th + 2.2 * k, y + th + 2.2 * k + sh, (tw + 0.6) * 0.62, (tw + 0.6) * 0.62, rot, SLATE, 0.0);
      const top = y + th + 2.2 * k + sh;
      plain.post(new THREE.Vector3(q.x, top - 0.4, q.z), new THREE.Vector3(q.x, top + 2.6 * k, q.z), 0.22, C(0x2a2a28));
      const arm = at(0.9 * k, -navL / 2 - tw / 2 + 0.3), arm2 = at(-0.9 * k, -navL / 2 - tw / 2 + 0.3);
      plain.post(new THREE.Vector3(arm2.x, top + 1.7 * k, arm2.z), new THREE.Vector3(arm.x, top + 1.7 * k, arm.z), 0.2, C(0x2a2a28));
    }
    // the churchyard wall
    {
      const W = navW + 14 * k, Lq = navL + 30 * k;
      for (const [lx, lz, w, d] of [[0, Lq / 2, W, 0.6], [0, -Lq / 2, W, 0.6], [W / 2, 0, 0.6, Lq], [-W / 2, 0, 0.6, Lq]] as const) {
        const b = at(lx, lz - 2);
        const yb = ground(b.x, b.z) - 0.3;
        plain.box(b.x, b.z, yb, yb + 1.5, w, d, rot, STONE2);
      }
    }
    count++;
  };
  for (const t of ARDENNES_TOWNS) {
    // (the church stands at the village's heart, the nave east–west give or take)
    const big = t.name === 'Francorchamps';
    church(t.x + (r() - 0.5) * 30, t.z + (r() - 0.5) * 30, Math.PI / 2 + (r() - 0.5) * 0.4, big ? 1 : 0.62);
  }

  const plainMesh = new THREE.Mesh(plain.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }));
  plainMesh.name = 'spa_landmarks';
  plainMesh.castShadow = false;
  plainMesh.receiveShadow = true;
  group.add(plainMesh);
  for (const m of group.children) {
    m.matrixAutoUpdate = false;
    m.updateMatrix();
  }
  return { group, count };
}

/** the Ardennes villages' ground: gardens and meadow between the lanes, slate where a roof is drawn */
export function spaTerrainLook(u: Record<string, THREE.IUniform>) {
  const roof = u.uRoof?.value;
  if (roof instanceof THREE.Color) roof.set(0x3a3d42);
  if (u.uTownYard) u.uTownYard.value = 1;
}
