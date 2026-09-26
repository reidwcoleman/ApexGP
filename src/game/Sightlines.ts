import * as THREE from 'three';
import type { Track } from '../world/Track.ts';

/**
 * What a camera can see: a coarse occupancy grid of the world around the circuit,
 * built once per world from the scene itself — every triangle of the trackside,
 * pit complex and scenery that stands above the ground (walls, grandstands,
 * buildings, bridges, landmarks, advertising), every instanced prop taller than a
 * person, and every tree — plus the terrain height.
 *
 * Each 3 m cell stores the ground height and the slab [lo, hi] above it that is
 * occupied, so a ray can pass under a bridge deck or a tree crown but not
 * through it. See-through catch fences are kept apart: they only count as
 * blocking right in front of the lens (where they'd fill the frame).
 *
 * A sight line is tested by sampling the ray every half cell: a few hundred
 * array reads, cheap enough to run every frame for the camera on air.
 */

const CELL = 3;
const IDENTITY = new THREE.Matrix4();
const MARGIN = 420;
/** relative heights are stored in 0.5 m steps (0 … 127 m) */
const Q = 2;
const EMPTY = 255;
/** anything lower than this above the ground is ground (asphalt, kerbs, grass, water) */
const GROUND_CLEAR = 0.7;

export class Sightlines {
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  /** ground height (decimetres) */
  private readonly ground: Int16Array;
  /** occupied slab above the ground (0.5 m units; lo = EMPTY when free) */
  private readonly lo: Uint8Array;
  private readonly hi: Uint8Array;
  /** top of see-through stuff (fences) above the ground (0.5 m units; 0 = none) */
  private readonly fence: Uint8Array;
  readonly buildMs: number;
  readonly groundMs: number;
  readonly stats = { tris: 0, instances: 0, trees: 0, cells: 0 };

  constructor(track: Track, heightAt: (x: number, z: number) => number, roots: THREE.Object3D[]) {
    const t0 = performance.now();
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (let i = 0; i < track.n; i++) {
      minx = Math.min(minx, track.px[i]);
      maxx = Math.max(maxx, track.px[i]);
      minz = Math.min(minz, track.pz[i]);
      maxz = Math.max(maxz, track.pz[i]);
    }
    this.x0 = minx - MARGIN;
    this.z0 = minz - MARGIN;
    this.nx = Math.ceil((maxx - minx + MARGIN * 2) / CELL);
    this.nz = Math.ceil((maxz - minz + MARGIN * 2) / CELL);
    const n = this.nx * this.nz;
    this.ground = new Int16Array(n);
    this.lo = new Uint8Array(n).fill(EMPTY);
    this.hi = new Uint8Array(n);
    this.fence = new Uint8Array(n);
    for (let j = 0; j < this.nz; j++) {
      const z = this.z0 + (j + 0.5) * CELL;
      for (let i = 0; i < this.nx; i++) this.ground[j * this.nx + i] = Math.round(heightAt(this.x0 + (i + 0.5) * CELL, z) * 10);
    }
    // the road itself is ground too (a crest hides what's over it; an embankment isn't a wall)
    const pt = new THREE.Vector3();
    for (let s = 0; s < track.length; s += 1.5) {
      const hw = track.halfWidthAt(s) + 2.5;
      for (let l = -hw; l <= hw; l += 1.5) {
        track.point(s, l, 0, pt);
        const k = this.cellOf(pt.x, pt.z);
        if (k >= 0) this.ground[k] = Math.max(this.ground[k], Math.round(pt.y * 10));
      }
    }
    this.groundMs = Math.round(performance.now() - t0);
    for (const r of roots) {
      r.updateMatrixWorld(true);
      r.traverse((o) => this.add(o));
    }
    this.buildMs = Math.round(performance.now() - t0);
    for (let i = 0; i < n; i++) if (this.lo[i] !== EMPTY) this.stats.cells++;
  }

  // ------------------------------------------------------------------ building

  private cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / CELL);
    const j = Math.floor((z - this.z0) / CELL);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -1;
    return j * this.nx + i;
  }

  /** mark cell k occupied between absolute heights ylo … yhi */
  private mark(k: number, ylo: number, yhi: number, see: boolean) {
    const g = this.ground[k] / 10;
    const rt = yhi - g;
    if (rt < GROUND_CLEAR || rt > 150) return;
    const qt = Math.min(254, Math.ceil(rt * Q));
    if (see) {
      if (qt > this.fence[k]) this.fence[k] = qt;
      return;
    }
    const qb = Math.max(0, Math.min(qt, Math.floor((ylo - g) * Q)));
    if (this.lo[k] === EMPTY || qb < this.lo[k]) this.lo[k] = qb;
    if (qt > this.hi[k]) this.hi[k] = qt;
  }

  private readonly va = new THREE.Vector3();
  private readonly vb = new THREE.Vector3();
  private readonly vc = new THREE.Vector3();
  private readonly m4 = new THREE.Matrix4();
  private readonly box = new THREE.Box3();

  private add(o: THREE.Object3D) {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (o as unknown as THREE.Points).isPoints || (o as unknown as THREE.Line).isLine || (o as unknown as THREE.Sprite).isSprite) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined;
    if (!mat || mat.visible === false || mat.depthWrite === false || mat.side === THREE.BackSide) return;
    // people (the pit crews, marshals, the crowd): nobody blocks a camera for long
    if (o.userData?.noOcclude || (o as THREE.SkinnedMesh).isSkinnedMesh) return;
    const see = (mat.alphaTest ?? 0) > 0 || (mat.transparent && mat.opacity > 0.05);
    if ((o as THREE.BatchedMesh).isBatchedMesh) return this.addBatched(o as THREE.BatchedMesh);
    if ((o as THREE.InstancedMesh).isInstancedMesh) return this.addInstanced(o as THREE.InstancedMesh, see);
    this.addTriangles(mesh, see);
  }

  /** every triangle above the ground, sampled at under a cell's spacing so long thin ones mark only their own cells */
  private addTriangles(mesh: THREE.Mesh, see: boolean) {
    const geo = mesh.geometry as THREE.BufferGeometry;
    const attr = geo.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!attr) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = this.box.copy(geo.boundingBox!).applyMatrix4(mesh.matrixWorld);
    // sky domes, horizon rings, ground planes and far terrain
    if (bb.max.x - bb.min.x > 6000 || bb.max.z - bb.min.z > 6000) return;
    if (bb.max.x < this.x0 || bb.max.z < this.z0 || bb.min.x > this.x0 + this.nx * CELL || bb.min.z > this.z0 + this.nz * CELL) return;
    // world-space vertex positions once (most trackside / scenery meshes are merged with an identity matrix)
    const n = attr.count;
    const P = new Float32Array(n * 3);
    const m = mesh.matrixWorld.elements;
    const ident = mesh.matrixWorld.equals(IDENTITY);
    const direct = !(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && !attr.normalized;
    const arr = direct ? (attr.array as ArrayLike<number>) : null;
    const st = attr.itemSize;
    for (let i = 0; i < n; i++) {
      const x = arr ? arr[i * st] : attr.getX(i), y = arr ? arr[i * st + 1] : attr.getY(i), z = arr ? arr[i * st + 2] : attr.getZ(i);
      if (ident) {
        P[i * 3] = x;
        P[i * 3 + 1] = y;
        P[i * 3 + 2] = z;
      } else {
        P[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        P[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        P[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
    }
    // which vertices stand above the ground
    const up = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      const k = this.cellOf(P[i * 3], P[i * 3 + 2]);
      if (k >= 0 && P[i * 3 + 1] - this.ground[k] / 10 >= GROUND_CLEAR) {
        up[i] = 1;
        any = true;
      }
    }
    if (!any) return;
    const tr0 = this.stats.tris, tm0 = performance.now();
    const idx = geo.index ? geo.index.array : null;
    const triCount = idx ? idx.length / 3 : n / 3;
    const step = CELL * 0.7;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      if (!up[i0] && !up[i1] && !up[i2]) continue;
      const ax = P[i0 * 3], ay = P[i0 * 3 + 1], az = P[i0 * 3 + 2];
      const bx = P[i1 * 3], by = P[i1 * 3 + 1], bz = P[i1 * 3 + 2];
      const cx = P[i2 * 3], cy = P[i2 * 3 + 1], cz = P[i2 * 3 + 2];
      const ext = Math.max(Math.abs(ax - bx), Math.abs(ax - cx), Math.abs(az - bz), Math.abs(az - cz), Math.abs(bx - cx), Math.abs(bz - cz));
      if (ext > 400) continue;
      this.stats.tris++;
      if (ext < step) {
        // small: its corners are enough
        let k = this.cellOf(ax, az);
        if (k >= 0) this.mark(k, ay, ay, see);
        k = this.cellOf(bx, bz);
        if (k >= 0) this.mark(k, by, by, see);
        k = this.cellOf(cx, cz);
        if (k >= 0) this.mark(k, cy, cy, see);
        continue;
      }
      const nn = Math.ceil(ext / step);
      for (let i = 0; i <= nn; i++) {
        for (let j = 0; j <= nn - i; j++) {
          const u = i / nn, v = j / nn;
          const k = this.cellOf(ax + (bx - ax) * u + (cx - ax) * v, az + (bz - az) * u + (cz - az) * v);
          if (k >= 0) {
            const y = ay + (by - ay) * u + (cy - ay) * v;
            this.mark(k, y, y, see);
          }
        }
      }
    }
    const nm = (mesh.name || mesh.parent?.name || '?') + '/' + ((mesh.material as THREE.Material).name || (mesh.material as THREE.Material).type);
    this.perMesh.push([nm, this.stats.tris - tr0, Math.round(performance.now() - tm0)]);
  }
  readonly perMesh: [string, number, number][] = [];

  private low(p: THREE.Vector3): boolean {
    const k = this.cellOf(p.x, p.z);
    return k < 0 || p.y - this.ground[k] / 10 < GROUND_CLEAR;
  }

  /** per instance: its box footprint (props smaller than a person are left out) */
  private addInstanced(im: THREE.InstancedMesh, see: boolean) {
    const geo = im.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const gb = geo.boundingBox!;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, this.m4);
      this.m4.premultiply(im.matrixWorld);
      const bb = this.box.copy(gb).applyMatrix4(this.m4);
      const h = bb.max.y - bb.min.y;
      const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
      if (w > 400 || (h < 2.4 && w < 4)) continue;
      this.stats.instances++;
      this.stamp(bb, 0.85, see, 0);
    }
  }

  /** trees (the near-circuit BatchedMesh): trunk to the top in the middle, the crown around it */
  private addBatched(bm: THREE.BatchedMesh) {
    const n = (bm as unknown as { _instanceInfo: unknown[] })._instanceInfo?.length ?? 0;
    for (let i = 0; i < n; i++) {
      let gid: number;
      try {
        gid = bm.getGeometryIdAt(i);
      } catch {
        continue;
      }
      if (gid < 0) continue;
      bm.getMatrixAt(i, this.m4);
      this.m4.premultiply(bm.matrixWorld);
      const gb = bm.getBoundingBoxAt(gid, this.box);
      if (!gb) continue;
      const bb = this.box.applyMatrix4(this.m4);
      if (bb.max.y - bb.min.y < 1.6) continue;
      this.stats.trees++;
      this.stamp(bb, 0.8, false, 0.18);
    }
  }

  /** mark a box's footprint (shrunk by `shrink`); away from its middle it starts `lift` × its height up */
  private stamp(bb: THREE.Box3, shrink: number, see: boolean, lift: number) {
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const hx = ((bb.max.x - bb.min.x) / 2) * shrink, hz = ((bb.max.z - bb.min.z) / 2) * shrink;
    const h = bb.max.y - bb.min.y;
    for (let x = cx - hx; x <= cx + hx + 0.01; x += CELL * 0.8) {
      for (let z = cz - hz; z <= cz + hz + 0.01; z += CELL * 0.8) {
        const k = this.cellOf(x, z);
        if (k < 0) continue;
        const mid = Math.abs(x - cx) < CELL && Math.abs(z - cz) < CELL;
        this.mark(k, mid ? bb.min.y : bb.min.y + h * lift, bb.max.y, see);
      }
    }
    // the middle cell for thin things (a pole, a trunk)
    const k = this.cellOf(cx, cz);
    if (k >= 0) this.mark(k, bb.min.y, bb.max.y, see);
  }

  // ------------------------------------------------------------------ queries

  /** ground height at (x, z) */
  groundAt(x: number, z: number): number {
    const k = this.cellOf(x, z);
    return k < 0 ? -1e9 : this.ground[k] / 10;
  }

  /** is the point inside something solid (or under the ground)? `fenceToo`: count see-through fences */
  solidAt(x: number, y: number, z: number, fenceToo = false): boolean {
    const k = this.cellOf(x, z);
    if (k < 0) return false;
    const rel = (y - this.ground[k] / 10) * Q;
    if (rel < -0.6) return true;
    const lo = this.lo[k];
    if (lo !== EMPTY && rel >= lo - 0.5 && rel <= this.hi[k] + 0.5) return true;
    return fenceToo && rel <= this.fence[k] + 0.5 && this.fence[k] > 0;
  }

  /**
   * Is the line from the camera `a` to the point `b` clear? The last `skipEnd`
   * metres (the car's own surroundings: the road, its bodywork, a bridge it's on)
   * aren't tested; fences only count within `fenceNear` metres of the lens.
   */
  clear(a: THREE.Vector3, b: THREE.Vector3, skipEnd = 6, fenceNear = 9): boolean {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dy, dz);
    const end = len - skipEnd;
    if (end <= 0.6) return true;
    const step = CELL * 0.5;
    for (let d = 0.6; d < end; d += step) {
      const f = d / len;
      if (this.solidAt(a.x + dx * f, a.y + dy * f, a.z + dz * f, d < fenceNear)) return false;
    }
    return true;
  }

  /** how far from `from` toward `to` is clear (the whole distance if nothing is in the way) */
  clearDistance(from: THREE.Vector3, to: THREE.Vector3, skipStart = 3): number {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    for (let d = skipStart; d < len; d += CELL * 0.4) {
      const f = d / len;
      if (this.solidAt(from.x + dx * f, from.y + dy * f, from.z + dz * f, true)) return Math.max(skipStart * 0.6, d - 1.2);
    }
    return len;
  }
}
