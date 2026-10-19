/**
 * Trees and bushes: the engine's baked scans (Poly Haven, CC0: leaf-card crowns with real wind,
 * thin-leaf light and crown AO — see world/env/treeproto.ts and treematerial.ts), put on a lawn as
 * one BatchedMesh. Trees in the garden are drawn at full detail, the wood beyond the fences at a
 * coarser level; the garden's trees cast shadows; a crown that would hide the mower dissolves.
 */
import * as THREE from 'three';
import { loadTreeKit, PROTO_INFO, type TreeKit } from '../world/env/treeproto.ts';
import { createTreeUniforms, setLeafFill, treeDepthMaterial, treeMaterial, type TreeUniforms } from '../world/env/treematerial.ts';
import { weatherUniforms } from '../world/weatherUniforms.ts';
import type { Scenery, SceneryCtx } from './scenery.ts';

const ID = (id: (typeof PROTO_INFO)[number]['id']) => PROTO_INFO.findIndex((p) => p.id === id);

export interface TreePlacement {
  proto: number;
  x: number;
  z: number;
  /** scale on the scanned tree */
  s: number;
  rot: number;
  tint: [number, number, number];
  /** which level of detail to draw (0 best) */
  lod: 0 | 1 | 2;
  /** also casts into the sun's shadow map */
  shade: boolean;
  /** dissolves when it would hide the mower */
  fade: boolean;
}

/** the garden trees: which scan, and how big to draw it (the scans are 11–28 m: these come out at 5–9 m) */
const GARDEN_TREES: { proto: number; base: number }[] = [
  { proto: ID('jacaranda'), base: 0.36 },
  { proto: ID('dome'), base: 0.37 },
  { proto: ID('gnarl'), base: 0.37 },
  { proto: ID('umbrella'), base: 0.5 },
  { proto: ID('poplar'), base: 0.3 },
  { proto: ID('spruce_a'), base: 0.3 },
];
export const SHRUBS = [ID('shrub_a'), ID('shrub_b'), ID('shrub_c')];
export const BACKDROP = [ID('dome'), ID('gnarl'), ID('jacaranda'), ID('spruce_a'), ID('poplar'), ID('fir_b')];

export function gardenTree(variant: number, size: number) {
  const t = GARDEN_TREES[variant % GARDEN_TREES.length];
  return { proto: t.proto, s: t.base * (size / 0.36) };
}

const fadeCode = (flag: number, dirIn: number, t0: number) => flag + 3 * dirIn + 6 * (t0 > 0 ? Math.max(1, Math.round(t0 * 60)) : 0);

export class TreeField implements Scenery {
  readonly group = new THREE.Group();
  private u: TreeUniforms;
  private near: THREE.BatchedMesh | null = null;
  private shade: THREE.BatchedMesh | null = null;
  private ids: { id: number; sid: number; p: TreePlacement; hidden: boolean; flag: number; tint: THREE.Color }[] = [];
  private kit: TreeKit;
  private mats: THREE.Material[] = [];
  private frame = 0;
  private c4 = new THREE.Vector4();

  constructor(kit: TreeKit, list: TreePlacement[], sunDir: THREE.Vector3) {
    this.kit = kit;
    const u = (this.u = createTreeUniforms());
    u.uSunW.value.copy(sunDir);
    setLeafFill(u, 0.8);
    weatherUniforms.uWind.value.set(1.6, 0.8);
    if (!kit.ready || !list.length) return;
    // which prototypes and levels are used
    const used = new Set<string>();
    for (const p of list) used.add(`${p.proto}:${p.lod}`);
    const shadeProtos = new Set(list.filter((p) => p.shade).map((p) => p.proto));
    let maxV = 0;
    let maxI = 0;
    for (const key of used) {
      const [pi, lod] = key.split(':').map(Number);
      const g = kit.protos[pi].lods[lod];
      maxV += g.attributes.position.count;
      maxI += g.index!.count;
    }
    const mat = treeMaterial(kit, u);
    this.mats.push(mat);
    const b = new THREE.BatchedMesh(list.length, maxV, maxI, mat);
    const geo = new Map<string, number>();
    for (const key of used) {
      const [pi, lod] = key.split(':').map(Number);
      geo.set(key, b.addGeometry(kit.protos[pi].lods[lod]));
    }
    let sV = 0;
    let sI = 0;
    for (const pi of shadeProtos) {
      const g = kit.protos[pi].lods[kit.protos[pi].lods.length - 1];
      sV += g.attributes.position.count;
      sI += g.index!.count;
    }
    const nShade = list.filter((p) => p.shade).length;
    const sb = nShade ? new THREE.BatchedMesh(nShade, sV, sI, mat) : null;
    const sgeo = new Map<number, number>();
    if (sb) for (const pi of shadeProtos) sgeo.set(pi, sb.addGeometry(kit.protos[pi].lods[kit.protos[pi].lods.length - 1]));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const sv = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const conifer = new Set([ID('spruce_a'), ID('fir_a'), ID('fir_b'), ID('fir_c')]);
    for (const p of list) {
      q.setFromAxisAngle(up, p.rot);
      sv.set(p.s, p.s * (0.95 + ((p.rot * 7.3) % 1) * 0.1), p.s);
      pv.set(p.x, 0, p.z);
      m4.compose(pv, q, sv);
      const flag = conifer.has(p.proto) ? 2 : 1;
      const tint = new THREE.Color(p.tint[0], p.tint[1], p.tint[2]);
      const id = b.addInstance(geo.get(`${p.proto}:${p.lod}`)!);
      b.setMatrixAt(id, m4);
      this.c4.set(tint.r, tint.g, tint.b, fadeCode(flag, 1, 0));
      b.setColorAt(id, this.c4 as never);
      let sid = -1;
      if (sb && p.shade) {
        sid = sb.addInstance(sgeo.get(p.proto)!);
        sb.setMatrixAt(sid, m4);
      }
      this.ids.push({ id, sid, p, hidden: false, flag, tint });
    }
    b.perObjectFrustumCulled = true;
    b.sortObjects = true;
    b.castShadow = false;
    b.receiveShadow = true;
    b.computeBoundingBox();
    b.computeBoundingSphere();
    b.frustumCulled = false;
    this.group.add(b);
    this.near = b;
    if (sb) {
      // (the shadow batch builds its draw list in onBeforeShadow, per shadow camera)
      sb.onBeforeRender = function () {
        (this as unknown as { _multiDrawCount: number })._multiDrawCount = 0;
      };
      sb.onBeforeShadow = function (renderer, _object, _camera, shadowCamera, geometry, depthMaterial) {
        THREE.BatchedMesh.prototype.onBeforeRender.call(this, renderer, null as unknown as THREE.Scene, shadowCamera, geometry, depthMaterial, null as unknown as THREE.Group);
      };
      sb.perObjectFrustumCulled = true;
      sb.sortObjects = false;
      sb.castShadow = true;
      sb.receiveShadow = false;
      const dm = treeDepthMaterial(kit, u);
      this.mats.push(dm);
      sb.customDepthMaterial = dm;
      sb.computeBoundingBox();
      sb.computeBoundingSphere();
      sb.frustumCulled = false;
      this.group.add(sb);
      this.shade = sb;
    }
  }

  update(dt: number, ctx: SceneryCtx) {
    const u = this.u;
    u.uTime.value = ctx.time;
    u.uFrame.value = this.frame++;
    u.uSunW.value.copy(ctx.sun);
    if (!this.near) return;
    // a crown standing between the camera and the mower dissolves
    const { mx, mz, view } = ctx;
    const cx = view.cam.position.x;
    const cy = view.cam.position.y;
    const cz = view.cam.position.z;
    const sx = mx - cx;
    const sz = mz - cz;
    const sl = sx * sx + sz * sz || 1;
    for (const t of this.ids) {
      if (!t.p.fade) continue;
      const info = this.kit.protos[t.p.proto];
      const px = t.p.x - cx;
      const pz = t.p.z - cz;
      // where along the camera-to-mower sight line (on the ground plane) the tree stands
      const u = (px * sx + pz * sz) / sl;
      const ex = px - sx * u;
      const ez = pz - sz * u;
      const dist = Math.hypot(ex, ez);
      const crown = info.crownR * t.p.s * 0.85 + 0.7;
      const rayY = cy + (0.6 - cy) * Math.min(1, Math.max(0, u));
      const reach = info.height * t.p.s * 0.95;
      // (and a crown the camera is inside of, or hanging right over it)
      const nearCam = Math.hypot(px, pz) < crown + 5 && cy < reach + 3;
      const hide = (u > -0.05 && u < 1.02 && dist < crown && rayY < reach + 1.5) || nearCam;
      if (hide !== t.hidden) {
        t.hidden = hide;
        this.c4.set(t.tint.r, t.tint.g, t.tint.b, fadeCode(t.flag, hide ? 0 : 1, ctx.time));
        this.near.setColorAt(t.id, this.c4 as never);
        // (the shadow stays: the tree is still there)
      }
    }
  }

  dispose() {
    this.near?.dispose();
    this.shade?.dispose();
    this.mats.forEach((m) => m.dispose());
  }
}

export async function treeKit() {
  return loadTreeKit();
}
