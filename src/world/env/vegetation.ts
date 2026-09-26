import * as THREE from 'three';
import { WorldMap } from './worldmap.ts';
import { fbm2, hash2i, rng, smoothstep } from './noise.ts';
import { buildTreeKit, type SpeciesId, type TreeKit } from './treeproto.ts';
import { bakeImpostors, createTreeUniforms, impostorMaterial, treeDepthMaterial, treeMaterial, type TreeUniforms } from './treematerial.ts';
import type { Layout } from './layout.ts';
import { spielbergSpecies } from './venues/spielberg.ts';

/**
 * The woods of the Parco di Monza.
 *
 * Placement: a jittered grid over the park driven by the forest density
 * (dense right up to the catch fences for most of the lap, open lawns at the
 * stands, Ascari and the Parabolica, big meadows further out, farmland with
 * copses outside the park wall), species by stand-type noise, a layered
 * woodland edge (hazel/bramble understorey and young trees in front of the
 * mature ones), plane-tree avenues and rows of Lombardy poplars.
 *
 * Rendering (≈ 3 draw calls + shadows):
 *   near  one BatchedMesh with every prototype's LOD0/LOD1; only trees within
 *         ~120 m of the circuit are in it, and only those within ~180 m of the
 *         camera are visible (LOD0 < 70 m). Casts leafy shadows.
 *   far   one instanced impostor card per tree (all of them), cross-faded with
 *         the 3D tree by a matched dither between 158 and 182 m.
 */

export interface VegetationBuild {
  group: THREE.Group;
  uniforms: TreeUniforms;
  update(camera: THREE.Camera, elapsed: number): void;
  /** how far the 3D trees reach before the impostors take over (quality level) */
  setDetail(q: 'low' | 'medium' | 'high' | 'ultra'): void;
  count: number;
  near: number;
  /** crown shade discs for the ground mask */
  shade: { x: number; z: number; r: number }[];
  kit: TreeKit;
  timings: Record<string, number>;
  /** placed trees (debug / props) */
  trees: { x: number; y: number; z: number; proto: number; s: number }[];
}

interface Tree {
  x: number;
  y: number;
  z: number;
  proto: number;
  s: number;
  rot: number;
  tint: THREE.Color;
  flip: boolean;
}

const fract = (x: number) => x - Math.floor(x);
const NEAR_BAND = 125; // trees closer than this to the circuit get a 3D version
const R3D = 170;
const LOD0 = 72;

export function buildVegetation(map: WorldMap, layout: Layout, renderer: THREE.WebGLRenderer): VegetationBuild {
  const timings: Record<string, number> = {};
  let tl = performance.now();
  const lap = (k: string) => {
    const n = performance.now();
    timings[k] = Math.round(n - tl);
    tl = n;
  };
  const kit = buildTreeKit();
  lap('kit');
  Object.assign(timings, kit.timings);
  const r = rng(424242);
  const trees: Tree[] = [];
  const S = map.SQUARE;
  const track = map.track;

  const pick = (sp: SpeciesId, h: number) => {
    const list = kit.bySpecies[sp];
    return list[Math.floor(h * list.length) % list.length];
  };
  const tintFor = (sp: SpeciesId, h: number, h2: number, h3 = fract(h * 7.31 + h2 * 3.17)) => {
    // every tree its own green: brightness, and a hue swing between fresh yellow-green
    // and deep blue-green (the variety that makes a wood read as many trees, not one mass)
    const j = (h - 0.5) * 0.24;
    const hue = (h3 - 0.5) * 2;
    const c = new THREE.Color((1 + j) * (1 + hue * 0.1), (1 + j * 0.9) * (1 + hue * 0.03), (1 + j * 0.5) * (1 - hue * 0.14));
    if (sp === 'spruce') c.multiplyScalar(0.92 + h3 * 0.18);
    // São Paulo in spring (November): deep, glossy tropical greens, nothing turning
    if (map.venue === 'interlagos') return c.multiply(new THREE.Color(0.9, 1.06, 0.84));
    // a few trees already turning (September): planes go yellow-brown, chestnuts brown
    // (not in Montréal: the Canadian GP is in June)
    if (map.venue === 'montreal') return c;
    if (h2 < 0.05 && (sp === 'plane' || sp === 'chestnut' || sp === 'poplar')) c.setRGB(1.28, 1.02, 0.5);
    else if (h2 < 0.09 && sp !== 'shrub' && sp !== 'spruce') c.setRGB(1.12, 1.03, 0.78);
    return c;
  };
  /** species by stand type */
  const speciesAt = (x: number, z: number, h: number): SpeciesId => {
    const n = fbm2(x / 260 + 4.1, z / 260 - 2.7, 3);
    const n2 = fbm2(x / 90 - 1.3, z / 90 + 8.8, 2);
    // the Ardennes: spruce plantations with stands of beech/oak (the chestnut crowns stand in for beech)
    // (about a third broadleaf, in stands, so the hills read as a patchwork of dark conifer and lighter beech)
    if (map.venue === 'ardennes') return n < -0.02 || (n < 0.18 && h > 0.5) || h > 0.9 ? 'spruce' : n2 > -0.1 ? 'chestnut' : 'oak';
    // English lowland: oak and ash (the plane crowns stand in for ash), a few horse chestnuts and poplars
    if (map.venue === 'airfield') return n < 0.05 ? 'oak' : n < 0.3 ? 'plane' : n2 > 0.3 ? 'poplar' : 'chestnut';
    // Suzuka: sugi cedar and pine on the slopes (the spruce crowns stand in), oak and chestnut in the hollows
    if (map.venue === 'suzuka') return n < 0.15 || h > 0.5 ? 'spruce' : n2 > 0.1 ? 'oak' : 'chestnut';
    // Zandvoort: dune scrub (sea buckthorn, creeping willow) and wind-bent pines; pine plantations
    // (the spruce crowns stand in) and the estates' oaks inland
    if (map.venue === 'zandvoort') return map.forest(x, z) > 0.55 && map.distToTrack(x, z) > 480 ? (h < 0.8 ? 'spruce' : n2 > 0 ? 'oak' : 'chestnut') : h < 0.95 ? 'shrub' : 'spruce';
    // São Paulo: tipuanas and sibipirunas (the plane crowns: wide, feathery), figs and mango (oak), ipês (chestnut)
    if (map.venue === 'interlagos') return n < -0.05 || h < 0.25 ? 'plane' : n2 > 0.15 ? 'chestnut' : 'oak';
    // Styria: spruce (and larch) forest on the slopes, beech stands (the chestnut crowns), ash and lime in the valley
    if (map.venue === 'spielberg') return spielbergSpecies(map, x, z, n, n2, h);
    // Texas: live oak (the oak crowns), pecan (chestnut crowns) and mesquite / cedar scrub
    if (map.venue === 'austin') return n2 > 0.3 ? 'chestnut' : h < 0.16 ? 'shrub' : 'oak';
    // Montréal: silver and Norway maples (the plane crowns: palmate leaves), ash and oak, a few
    // poplars along the water and spruce in the Expo 67 gardens
    if (map.venue === 'montreal') return h < 0.07 ? 'spruce' : n < -0.12 ? 'plane' : n < 0.22 ? (n2 > 0.3 ? 'poplar' : n2 > -0.1 ? 'plane' : 'oak') : n2 > 0 ? 'chestnut' : 'plane';
    let sp: SpeciesId;
    if (n < -0.18) sp = 'plane';
    else if (n < 0.12) sp = 'oak';
    else if (n < 0.34) sp = 'chestnut';
    else sp = n2 > 0.25 ? 'poplar' : 'plane';
    // mixed woods: a quarter of the trees are something else
    if (h < 0.12) sp = 'oak';
    else if (h < 0.2) sp = 'plane';
    else if (h < 0.26) sp = 'chestnut';
    return sp;
  };

  const okTree = (x: number, z: number, trackGap: number) => {
    if (x < S.x0 + 30 || x > S.x1 - 30 || z < S.z0 + 30 || z > S.z1 - 30) return false;
    if (map.trackClearance(x, z) < trackGap) return false;
    if (map.excluded(x, z, 1)) return false;
    if (map.ovalClearance(x, z) < 1.5) return false;
    if (map.pathDistance(x, z).d < 1.2) return false;
    if (map.inPitZone(x, z, 8)) return false;
    return true;
  };
  const add = (sp: SpeciesId, x: number, z: number, scale: number, h: number, h2: number) => {
    // (Zandvoort: the pines out in the open dunes are small and wind-bent, the scrub dense and low)
    if (map.venue === 'zandvoort' && (map.forest(x, z) < 0.55 || map.distToTrack(x, z) <= 480)) scale *= sp === 'spruce' ? 0.5 : sp === 'shrub' ? 1.3 : 1;
    const y = map.height(x, z) - 0.12;
    // Texas trees are low and wide-spreading: live oak, mesquite, stunted cedar
    if (map.venue === 'austin') scale *= sp === 'spruce' ? 0.55 : sp === 'shrub' ? 1 : 0.8;
    trees.push({ x, y, z, proto: pick(sp, h), s: scale, rot: h2 * Math.PI * 2 * 7.3, tint: tintFor(sp, hash2i(Math.floor(x * 3), Math.floor(z * 3), 21), h2), flip: h > 0.5 });
  };

  // ---------------------------------------------------------------- the woods (jittered grid)
  {
    const bb = map.A.bb;
    for (let pass = 0; pass < 3; pass++) {
      const C = pass === 0 ? 8.6 : pass === 1 ? 12 : 17;
      // pass 0 only needs the circuit's bounding box (+ its 360 m reach)
      const X0 = pass === 0 ? Math.max(S.x0 + 40, Math.floor((bb.x0 - 380) / C) * C) : S.x0 + 40;
      const X1 = pass === 0 ? Math.min(S.x1 - 40, bb.x1 + 380) : S.x1 - 40;
      const Z0 = pass === 0 ? Math.max(S.z0 + 40, Math.floor((bb.z0 - 380) / C) * C) : S.z0 + 40;
      const Z1 = pass === 0 ? Math.min(S.z1 - 40, bb.z1 + 380) : S.z1 - 40;
      for (let z = Z0; z < Z1; z += C)
        for (let x = X0; x < X1; x += C) {
          const d = map.distToTrack(x, z);
          // pass 0: within 360 m of the track, pass 1: 360–1300 m, pass 2: beyond
          if (pass === 0 && d > 360) continue;
          if (pass === 1 && (d <= 360 || d > 1300)) continue;
          if (pass === 2 && d <= 1300) continue;
          const ix = Math.floor(x / C), iz = Math.floor(z / C);
          const px = x + (hash2i(ix, iz, 1 + pass) - 0.5) * C * 0.92;
          const pz = z + (hash2i(ix, iz, 5 + pass) - 0.5) * C * 0.92;
          const f = map.forest(px, pz);
          if (f < 0.04) continue;
          const keep = pass === 0 ? 0.95 : pass === 1 ? 0.85 : 0.75;
          const h = hash2i(ix, iz, 9 + pass);
          if (h > f * keep) continue;
          if (!okTree(px, pz, 4.2)) continue;
          const h2 = hash2i(ix, iz, 13 + pass);
          const sp = speciesAt(px, pz, hash2i(ix, iz, 17 + pass));
          // lone trees on lawns grow bigger; young trees mix into the woods
          const lone = f < 0.35 ? 1.12 : 1;
          const young = h2 > 0.86 ? 0.62 + h2 * 0.2 : 1;
          add(sp, px, pz, (0.84 + hash2i(ix, iz, 19) * 0.32) * lone * young * (pass === 2 ? 1.1 : 1), h / Math.max(f * keep, 1e-3), h2);
        }
    }
  }
  // ---------------------------------------------------------------- layered woodland edge along the circuit
  {
    const p = new THREE.Vector3();
    for (const side of [-1, 1]) {
      for (let s = 0; s < track.n; s += 3.2) {
        const hs = hash2i(Math.floor(s), side, 31);
        const bar = track.barrierAt(s, side);
        track.point(s, side * (bar + 7), 0, p);
        const f = map.forest(p.x, p.z);
        if (f < 0.35) continue;
        // understorey shrubs right behind the fence line, and a second, taller band further in
        if (hs < 0.8) {
          const lat = side * (bar + 2.8 + hash2i(Math.floor(s), side, 32) * 5);
          track.point(s + (hs - 0.5) * 3, lat, 0, p);
          if (okTree(p.x, p.z, 2.4)) add('shrub', p.x, p.z, 0.8 + hash2i(Math.floor(s), side, 33) * 0.7, hs, 0.5);
        }
        if (hs > 0.25) {
          const lat = side * (bar + 8 + hash2i(Math.floor(s), side, 38) * 9);
          track.point(s + 1.6, lat, 0, p);
          if (okTree(p.x, p.z, 3)) add('shrub', p.x, p.z, 1.2 + hash2i(Math.floor(s), side, 39) * 0.8, 1 - hs, 0.5);
        }
        // young trees between the shrubs and the big trees
        if (hs > 0.5) {
          const lat = side * (bar + 5 + hash2i(Math.floor(s), side, 34) * 7);
          track.point(s, lat, 0, p);
          const sp = speciesAt(p.x, p.z, hash2i(Math.floor(s), side, 35));
          if (okTree(p.x, p.z, 4)) add(sp, p.x, p.z, 0.45 + hash2i(Math.floor(s), side, 36) * 0.25, hash2i(Math.floor(s), side, 37), 0.5);
        }
      }
    }
  }
  // scattered understorey inside the woods near the circuit
  for (let k = 0; k < 5000; k++) {
    const i = Math.floor(r() * track.n);
    const side = r() < 0.5 ? -1 : 1;
    const lat = side * (track.barrierAt(i, side) + 8 + r() * 70);
    const q = track.point(i, lat, 0);
    if (map.forest(q.x, q.z) < 0.5) continue;
    if (!okTree(q.x, q.z, 3)) continue;
    add('shrub', q.x, q.z, 0.6 + r() * 0.7, r(), 0.5);
  }
  // ---------------------------------------------------------------- avenues & poplar rows
  for (const q of layout.avenueTrees) {
    if (!okTree(q.x, q.z, 6)) continue;
    add('plane', q.x, q.z, 0.95 + r() * 0.15, r(), r() * 0.3 + 0.2);
  }
  for (const q of layout.poplarRows) {
    if (q.x < S.x0 + 30 || q.x > S.x1 - 30 || q.z < S.z0 + 30 || q.z > S.z1 - 30) continue;
    if (map.trackClearance(q.x, q.z) < 8 || map.excluded(q.x, q.z, 1) || map.ovalClearance(q.x, q.z) < 2) continue;
    add('poplar', q.x, q.z, 0.9 + r() * 0.2, r(), r() * 0.5 + 0.3);
  }
  // ---------------------------------------------------------------- English field hedgerows
  // Northamptonshire farmland: fields bounded by hawthorn hedges with an oak or ash
  // standing every so often, gappy in places — the tree lines that close every
  // horizon around the old airfield. Kept well away from the circuit, so they are
  // impostors only (one instanced card each).
  if (map.venue === 'airfield') {
    const bb = map.A.bb;
    const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2;
    const ang = 0.33;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const R = 2900;
    const lines: { u: number; vertical: boolean }[] = [];
    for (const vertical of [false, true]) {
      let u = -R;
      while (u < R) {
        lines.push({ u, vertical });
        u += 230 + r() * 190;
      }
    }
    for (const L of lines) {
      const seed = Math.floor(L.u) + (L.vertical ? 7919 : 0);
      for (let v = -R; v < R; v += 7 + r() * 5) {
        // gaps: long missing stretches where the hedge was grubbed out, gateways
        const gap = fbm2(v / 180 + seed * 0.013, seed * 0.07, 2);
        if (gap < -0.12) continue;
        const lu = L.u + (r() - 0.5) * 2.5, lv = v;
        const ox = L.vertical ? lu : lv, oz = L.vertical ? lv : lu;
        const x = cx + ox * ca - oz * sa, z = cz + ox * sa + oz * ca;
        if (map.distToTrack(x, z) < 150) continue;
        if (!okTree(x, z, 20)) continue;
        const h = r();
        const hx = hash2i(Math.floor(x), Math.floor(z), 61);
        if (h < 0.24) add(hx < 0.55 ? 'oak' : hx < 0.85 ? 'plane' : 'chestnut', x, z, 0.72 + r() * 0.4, r(), r() * 0.5 + 0.3);
        else add('shrub', x, z, 1.5 + r() * 0.6, r(), 0.5);
      }
    }
  }
  // saplings growing out of the abandoned banking's edges
  if (layout.oval) {
    const o = layout.oval;
    for (let i = 20; i < o.n - 20; i += 23) {
      if (Math.abs(i - o.bridgeU) < 40) continue;
      const h = hash2i(i, 3, 41);
      if (h > 0.55) continue;
      const side = h < 0.3 ? -1 : 1;
      const off = side * (o.width / 2 + 0.6);
      const x = o.x[i] + o.tz[i] * -off, z = o.z[i] + o.tx[i] * off;
      trees.push({ x, y: map.height(x, z), z, proto: pick(h < 0.2 ? 'shrub' : 'oak', h * 3), s: h < 0.2 ? 0.8 : 0.35 + h * 0.3, rot: h * 40, tint: new THREE.Color(1, 1, 1), flip: h > 0.3 });
    }
  }

  lap('place');
  // ---------------------------------------------------------------- render: near batch + impostors
  const uniforms = createTreeUniforms();
  uniforms.uFade.value.set(R3D - 12, R3D + 12);
  const group = new THREE.Group();
  group.name = 'Vegetation';

  const nearIdx: number[] = [];
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    if (map.distToTrack(t.x, t.z) < NEAR_BAND) nearIdx.push(i);
  }
  const isNear = new Uint8Array(trees.length);
  for (const i of nearIdx) isNear[i] = 1;

  // BatchedMesh
  let maxV = 0, maxI = 0;
  for (const p of kit.protos)
    for (const g of p.lods) {
      maxV += g.attributes.position.count;
      maxI += g.index!.count;
    }
  const mat = treeMaterial(kit, uniforms);
  const bm = new THREE.BatchedMesh(Math.max(1, nearIdx.length), maxV, maxI, mat);
  bm.name = 'trees_near';
  const geoIds: number[][] = kit.protos.map((p) => p.lods.map((g) => bm.addGeometry(g)));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const upA = new THREE.Vector3(0, 1, 0);
  const sv = new THREE.Vector3();
  const pv = new THREE.Vector3();
  const nearInst: number[] = [];
  for (const i of nearIdx) {
    const t = trees[i];
    const id = bm.addInstance(geoIds[t.proto][1]);
    q.setFromAxisAngle(upA, t.rot);
    sv.set(t.s * (t.flip ? -1 : 1), t.s * (0.94 + ((t.rot * 13.7) % 1) * 0.12), t.s);
    pv.set(t.x, t.y, t.z);
    m4.compose(pv, q, sv);
    bm.setMatrixAt(id, m4);
    bm.setColorAt(id, t.tint);
    bm.setVisibleAt(id, false);
    nearInst.push(id);
  }
  bm.perObjectFrustumCulled = true;
  bm.sortObjects = false;
  bm.castShadow = true;
  bm.receiveShadow = true;
  bm.customDepthMaterial = treeDepthMaterial(kit, uniforms);
  bm.computeBoundingBox();
  bm.computeBoundingSphere();
  bm.frustumCulled = false;
  bm.renderOrder = -1;
  group.add(bm);

  lap('batch');
  // impostors
  const atlas = bakeImpostors(renderer, kit, 512);
  lap('bake');
  const base = new THREE.InstancedBufferGeometry();
  base.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  base.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  base.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  base.setIndex([0, 1, 2, 0, 2, 3]);
  // small shrubs don't matter beyond the 3D range, but the big understorey bushes
  // hide the bare trunks of the woodland edge when seen from afar
  const shrubSet = new Set(kit.bySpecies.shrub);
  const impList: number[] = [];
  for (let i = 0; i < trees.length; i++) if (!shrubSet.has(trees[i].proto) || trees[i].s >= 1.1) impList.push(i);
  const N = impList.length;
  const iPos = new Float32Array(N * 4);
  const iInfo = new Float32Array(N * 4);
  const iTint = new Float32Array(N * 3);
  impList.forEach((ti, i) => {
    const t = trees[ti];
    iPos.set([t.x, t.y, t.z, t.s], i * 4);
    iInfo.set([t.proto, t.flip ? 1 : 0, isNear[ti], 0], i * 4);
    iTint.set([t.tint.r, t.tint.g, t.tint.b], i * 3);
  });
  base.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
  base.setAttribute('iInfo', new THREE.InstancedBufferAttribute(iInfo, 4));
  base.setAttribute('iTint', new THREE.InstancedBufferAttribute(iTint, 3));
  base.instanceCount = N;
  base.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const imp = new THREE.Mesh(base, impostorMaterial(atlas, uniforms));
  imp.name = 'trees_impostors';
  imp.frustumCulled = false;
  imp.castShadow = false;
  imp.receiveShadow = false;
  imp.renderOrder = 1;
  group.add(imp);

  // ---------------------------------------------------------------- LOD manager (cells of 64 m)
  const CELL = 64;
  const cells = new Map<number, number[]>();
  nearIdx.forEach((ti, k) => {
    const t = trees[ti];
    const key = (Math.floor(t.x / CELL) + 1024) * 2048 + Math.floor(t.z / CELL) + 1024;
    let a = cells.get(key);
    if (!a) cells.set(key, (a = []));
    a.push(k);
  });
  const lodNow = new Int8Array(nearIdx.length).fill(-1);
  // double-buffered active lists + a per-tree stamp: no allocation per LOD pass
  let active: number[] = [];
  let next: number[] = [];
  const stamp = new Uint32Array(nearIdx.length);
  let gen = 0;
  const cam = new THREE.Vector3();
  const last = new THREE.Vector3(1e9, 0, 0);
  let frames = 0;
  let reach = R3D + 16;
  let lod0 = LOD0;
  // 3D range per quality level: [impostor fade start, fade end, LOD0 distance]
  // (perf: 3D trees are the scenery's main GPU cost, in the camera and both shadow cascades; High was
  // [122, 142, 56] — impostors take over a little sooner now)
  // (leaf cards face the camera in the 3D trees and the impostors alike, so the hand-over can
  // come closer: fewer 3D trees on screen, the main tree cost)
  const DETAIL = { low: [56, 72, 28], medium: [80, 96, 38], high: [98, 116, 46], ultra: [128, 150, 60] } as const;
  const setDetail = (q: keyof typeof DETAIL) => {
    const [f0, f1, l0] = DETAIL[q];
    uniforms.uFade.value.set(f0, f1);
    reach = f1 + 4;
    lod0 = l0;
    last.set(1e9, 0, 0);
  };
  const update = (camera: THREE.Camera, elapsed: number) => {
    uniforms.uTime.value = elapsed;
    camera.getWorldPosition(cam);
    frames++;
    if (cam.distanceToSquared(last) < 4 && frames % 15 !== 0) return;
    last.copy(cam);
    gen++;
    next.length = 0;
    const c0x = Math.floor((cam.x - reach) / CELL), c1x = Math.floor((cam.x + reach) / CELL);
    const c0z = Math.floor((cam.z - reach) / CELL), c1z = Math.floor((cam.z + reach) / CELL);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const arr = cells.get((cx + 1024) * 2048 + cz + 1024);
        if (!arr) continue;
        for (const k of arr) {
          const t = trees[nearIdx[k]];
          const dx = t.x - cam.x, dz = t.z - cam.z, dy = t.y - cam.y;
          const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
          if (d > reach) continue;
          const want = d < (lodNow[k] === 0 ? lod0 + 4 : lod0 - 4) ? 0 : 1;
          if (lodNow[k] !== want) {
            if (lodNow[k] === -1) bm.setVisibleAt(nearInst[k], true);
            bm.setGeometryIdAt(nearInst[k], geoIds[t.proto][want]);
            lodNow[k] = want;
          }
          next.push(k);
          stamp[k] = gen;
        }
      }
    // hide the ones that dropped out
    for (const k of active) {
      if (stamp[k] !== gen) {
        bm.setVisibleAt(nearInst[k], false);
        lodNow[k] = -1;
      }
    }
    const t = active;
    active = next;
    next = t;
  };

  const shade = trees.map((t) => ({ x: t.x, z: t.z, r: kit.protos[t.proto].crownR * t.s }));
  return { group, uniforms, update, setDetail, count: trees.length, near: nearIdx.length, shade, kit, trees, timings };
}

void smoothstep;
