/**
 * What stands on the lawn besides trees: rocks, a raised flower bed, a pond with lily pads, a
 * bench, a patio set, gnomes, a shed, a fire pit, planters, a sprinkler that really sprays, stumps,
 * hedges and garden fences, lanterns at dusk. Mostly scanned CC0 models (Poly Haven), scaled to
 * real sizes; the rest built here with scanned textures.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LevelDef, ObstacleDef } from './levels.ts';
import type { MaskField } from './mask.ts';
import { glowTexture, type Particles } from './fx.ts';
import { fitted, loadModel, pbrMaterial } from './assets.ts';
import { makeFlowerKinds } from './flowers.ts';
import { SHRUBS, type TreePlacement } from './trees.ts';
import type { Scenery, SceneryCtx } from './scenery.ts';
import { Rng } from './util.ts';

const ROCKS = ['boulder_01', 'rock_07', 'rock_09', 'stone_01', 'rock_moss_set_01'];

async function model(id: string): Promise<THREE.Group | null> {
  try {
    return await loadModel(id);
  } catch (e) {
    console.warn('[lawn] model failed', id, e);
    return null;
  }
}

function place(o: THREE.Object3D, x: number, z: number, rot: number, y = 0) {
  o.position.set(x, y, z);
  o.rotation.y = rot;
  return o;
}

export async function buildProps(level: LevelDef, mask: MaskField, fx: Particles): Promise<{ scenery: Scenery[]; trees: TreePlacement[] }> {
  const out: Scenery[] = [];
  const trees: TreePlacement[] = [];
  const theme = level.theme;
  const group = new THREE.Group();
  const updaters: ((dt: number, ctx: SceneryCtx) => void)[] = [];
  const disposers: (() => void)[] = [];
  const own = { mats: [] as THREE.Material[], geos: [] as THREE.BufferGeometry[] };
  const [fencePbr, stonePbr, pavingPbr, litterPbr, deckPbr] = await Promise.all([
    pbrMaterial('fence', { color: '#d6cfc2' }),
    pbrMaterial('stonewall', {}),
    pbrMaterial('paving', {}),
    pbrMaterial('litter', {}),
    pbrMaterial('deck', {}),
  ]);
  own.mats.push(fencePbr, stonePbr, pavingPbr, litterPbr, deckPbr);
  const waterT = { value: 0 };

  for (const o of level.obstacles) {
    const rng = new Rng(o.seed);
    switch (o.kind) {
      case 'rock': {
        const m = await model(ROCKS[o.variant % ROCKS.length]);
        if (!m) break;
        const r = fitted(m, { size: o.size * (o.variant === 4 ? 1.6 : 1) });
        group.add(place(r, o.x, o.z, o.rot, -0.07 * o.size));
        break;
      }
      case 'gnome': {
        const m = await model('garden_gnome');
        if (m) group.add(place(fitted(m, { height: 0.55 }), o.x, o.z, o.rot));
        break;
      }
      case 'bench': {
        const m = await model('painted_wooden_bench');
        if (m) group.add(place(fitted(m, { size: 1.75 }), o.x, o.z, o.rot));
        break;
      }
      case 'table': {
        const m = await model('outdoor_table_chair_set_01');
        if (m) group.add(place(fitted(m, { size: 2.1 }), o.x, o.z, o.rot));
        break;
      }
      case 'planter': {
        const m = await model(o.variant ? 'planter_box_02' : 'planter_box_01');
        if (m) group.add(place(fitted(m, { size: o.hw * 2.0 }), o.x, o.z, o.rot));
        break;
      }
      case 'stump': {
        const m = await model('tree_stump_01');
        if (m) group.add(place(fitted(m, { size: o.size * 2.2 }), o.x, o.z, o.rot, -0.02));
        break;
      }
      case 'firepit': {
        const m = await model('stone_fire_pit');
        if (m) group.add(place(fitted(m, { size: o.size * 2 }), o.x, o.z, o.rot));
        break;
      }
      case 'sprinkler': {
        const m = await model('garden_sprinkler_01');
        if (!m) break;
        const s = fitted(m, { size: 0.32 });
        group.add(place(s, o.x, o.z, o.rot));
        let ang = rng.range(0, 6);
        updaters.push((dt) => {
          ang += dt * 1.6;
          s.rotation.y = o.rot + ang * 0.0;
          // arcs of water thrown out as the head turns
          for (let k = 0; k < 2; k++) {
            const a = ang + k * Math.PI;
            fx.drop({ x: o.x, y: 0.2, z: o.z, vx: Math.cos(a) * 2.4 + (Math.random() - 0.5) * 0.3, vy: 2.6 + Math.random() * 0.4, vz: Math.sin(a) * 2.4 + (Math.random() - 0.5) * 0.3 });
          }
        });
        break;
      }
      case 'hedge': {
        // a clipped hedge standing in the lawn: a row of the scanned bushes
        const len = o.hw * 2;
        const n = Math.max(2, Math.round(len / 0.8));
        const vertical = Math.abs(Math.sin(o.rot)) > 0.5;
        for (let i = 0; i < n; i++) {
          const t = -o.hw + (i + 0.5) * (len / n);
          const x = o.x + (vertical ? 0 : t);
          const z = o.z + (vertical ? t : 0);
          trees.push({ proto: SHRUBS[rng.int(0, 2)], x, z, s: 0.5 + rng.range(0, 0.1), rot: rng.range(0, 6.28), tint: theme.leafTint, lod: 0, shade: false, fade: false });
        }
        break;
      }
      case 'fence': {
        // a low garden fence of white pickets
        const g: THREE.BufferGeometry[] = [];
        const vertical = Math.abs(Math.sin(o.rot)) > 0.5;
        const len = o.hw * 2;
        const n = Math.floor(len / 0.14);
        for (let i = 0; i < n; i++) {
          const t = -len / 2 + (i + 0.5) * (len / n);
          const pk = new THREE.BoxGeometry(0.09, 0.78, 0.025);
          const tip = new THREE.ConeGeometry(0.0636, 0.08, 4);
          tip.rotateY(Math.PI / 4);
          tip.scale(1, 1, 0.3);
          tip.translate(0, 0.43, 0);
          const piece = mergeGeometries([pk, tip])!;
          pk.dispose();
          tip.dispose();
          piece.translate(0, 0.39, 0);
          if (vertical) piece.rotateY(Math.PI / 2);
          piece.translate(o.x + (vertical ? 0 : t), 0, o.z + (vertical ? t : 0));
          g.push(piece);
        }
        for (const y of [0.2, 0.55]) {
          const rail = new THREE.BoxGeometry(vertical ? 0.04 : len, 0.06, vertical ? len : 0.04);
          rail.translate(o.x + (vertical ? 0.03 : 0), y, o.z + (vertical ? 0 : 0.03));
          g.push(rail);
        }
        const merged = mergeGeometries(g)!;
        g.forEach((x) => x.dispose());
        const mat = new THREE.MeshStandardMaterial({ color: '#f1efe8', roughness: 0.7 });
        own.mats.push(mat);
        own.geos.push(merged);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        break;
      }
      case 'shed': {
        group.add(shed(o, fencePbr, deckPbr, own));
        break;
      }
      case 'bed': {
        group.add(flowerBed(o, fencePbr, litterPbr, theme.blooms, own, rng));
        break;
      }
      case 'pond': {
        const pond = await buildPond(o, waterT, stonePbr, litterPbr, own, rng, theme.ambient === 'fireflies');
        group.add(pond.group);
        updaters.push(...pond.updaters);
        break;
      }
      case 'lantern': {
        const l = lantern(o, own);
        group.add(l.group);
        updaters.push(l.update);
        break;
      }
      default:
        break;
    }
  }

  out.push({
    group,
    update(dt, ctx) {
      waterT.value = ctx.time;
      for (const u of updaters) u(dt, ctx);
    },
    dispose() {
      disposers.forEach((d) => d());
      own.geos.forEach((g) => g.dispose());
      own.mats.forEach((m) => m.dispose());
    },
  });
  return { scenery: out, trees };
}

// ------------------------------------------------------------------ the shed

function shed(o: ObstacleDef, wood: THREE.Material, deck: THREE.Material, own: { mats: THREE.Material[]; geos: THREE.BufferGeometry[] }) {
  const g = new THREE.Group();
  const w = o.hw * 2;
  const d = o.hd * 2;
  const h = 2.0;
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    own.geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const box = (bw: number, bh: number, bd: number, uvs = 0.7) => {
    const b = new THREE.BoxGeometry(bw, bh, bd);
    const uv = b.getAttribute('uv');
    const pos = b.getAttribute('position');
    const nor = b.getAttribute('normal');
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      if (nx > 0.5) uv.setXY(i, (pos.getZ(i) + bd / 2) * uvs, (pos.getY(i) + bh / 2) * uvs);
      else if (ny > 0.5) uv.setXY(i, (pos.getX(i) + bw / 2) * uvs, (pos.getZ(i) + bd / 2) * uvs);
      else uv.setXY(i, (pos.getX(i) + bw / 2) * uvs, (pos.getY(i) + bh / 2) * uvs);
    }
    return b;
  };
  const paint = new THREE.MeshStandardMaterial({ color: '#4d6b57', roughness: 0.8 });
  own.mats.push(paint);
  mk(box(w, h, d), wood, 0, h / 2 + 0.1, 0);
  mk(box(w + 0.3, 0.1, d + 0.3), deck, 0, 0.05, 0);
  // the pitched roof, in two slopes
  const roofMat = new THREE.MeshStandardMaterial({ color: '#2f3033', roughness: 0.9 });
  own.mats.push(roofMat);
  for (const s of [-1, 1]) {
    const r = new THREE.BoxGeometry(w + 0.4, 0.06, d / 2 + 0.35);
    const m = mk(r, roofMat, 0, h + 0.1 + 0.28, s * (d / 4 + 0.02));
    m.rotation.x = -s * 0.32;
  }
  mk(box(0.8, 1.7, 0.05), paint, 0, 0.95, d / 2 + 0.03);
  const handle = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshStandardMaterial({ color: '#b0a58a', metalness: 1, roughness: 0.3 }));
  handle.position.set(0.28, 0.95, d / 2 + 0.08);
  own.mats.push(handle.material as THREE.Material);
  own.geos.push(handle.geometry);
  g.add(handle);
  g.position.set(o.x, 0, o.z);
  g.rotation.y = Math.abs(Math.sin(o.rot)) > 0.5 ? Math.PI / 2 : 0;
  return g;
}

// ------------------------------------------------------------------ a raised flower bed

function flowerBed(o: ObstacleDef, wood: THREE.Material, soil: THREE.Material, blooms: string[], own: { mats: THREE.Material[]; geos: THREE.BufferGeometry[] }, rng: Rng) {
  const g = new THREE.Group();
  const vertical = Math.abs(Math.sin(o.rot)) > 0.5;
  const w = o.hw * 2;
  const d = o.hd * 2;
  const mkBox = (bw: number, bh: number, bd: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const b = new THREE.BoxGeometry(bw, bh, bd);
    const uv = b.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(bw, bd) * 0.8, uv.getY(i) * Math.max(bh, 0.2) * 0.8);
    own.geos.push(b);
    const m = new THREE.Mesh(b, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  // timber edging and the soil, a little proud of the frame
  mkBox(w, 0.28, 0.06, 0, 0.14, d / 2 - 0.03, wood);
  mkBox(w, 0.28, 0.06, 0, 0.14, -d / 2 + 0.03, wood);
  mkBox(0.06, 0.28, d - 0.12, w / 2 - 0.03, 0.14, 0, wood);
  mkBox(0.06, 0.28, d - 0.12, -w / 2 + 0.03, 0.14, 0, wood);
  const sg = new THREE.PlaneGeometry(w - 0.1, d - 0.1);
  sg.rotateX(-Math.PI / 2);
  const suv = sg.getAttribute('uv');
  for (let i = 0; i < suv.count; i++) suv.setXY(i, suv.getX(i) * (w * 0.9), suv.getY(i) * (d * 0.9));
  own.geos.push(sg);
  const sm = new THREE.Mesh(sg, soil);
  sm.position.y = 0.27;
  sm.receiveShadow = true;
  g.add(sm);
  // the flowers
  const kinds = makeFlowerKinds();
  const count = Math.round(w * d * 22);
  const cols = [...blooms, '#e8452f', '#b13a8a', '#f2a03a'];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  const headMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
  const stemMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  own.mats.push(headMat, stemMat);
  const per = [Math.ceil(count * 0.4), Math.ceil(count * 0.25), Math.ceil(count * 0.35)];
  kinds.forEach((kd, ki) => {
    own.geos.push(kd.head, kd.stem);
    const head = new THREE.InstancedMesh(kd.head, headMat, per[ki]);
    const stem = new THREE.InstancedMesh(kd.stem, stemMat, per[ki]);
    head.castShadow = stem.castShadow = false;
    head.receiveShadow = stem.receiveShadow = true;
    for (let i = 0; i < per[ki]; i++) {
      const x = rng.range(-w / 2 + 0.14, w / 2 - 0.14);
      const z = rng.range(-d / 2 + 0.14, d / 2 - 0.14);
      const s = rng.range(1.2, 2.2);
      e.set(0, rng.range(0, 6.28), 0);
      q.setFromEuler(e);
      m4.compose(new THREE.Vector3(x, 0.27, z), q, new THREE.Vector3(s, s, s));
      head.setMatrixAt(i, m4);
      stem.setMatrixAt(i, m4);
      head.setColorAt(i, c.set(ki === 0 ? rng.pick(cols) : ki === 1 ? rng.pick(['#ffd21f', '#ff9a2a', '#e8452f']) : rng.pick(['#e58fb8', '#c58fe0', '#ffffff'])));
    }
    g.add(head, stem);
  });
  g.position.set(o.x, 0, o.z);
  g.rotation.y = vertical ? Math.PI / 2 : 0;
  return g;
}

// ------------------------------------------------------------------ a pond

async function buildPond(o: ObstacleDef, time: { value: number }, stone: THREE.Material, litter: THREE.Material, own: { mats: THREE.Material[]; geos: THREE.BufferGeometry[] }, rng: Rng, dusk: boolean) {
  const g = new THREE.Group();
  const updaters: ((dt: number, ctx: SceneryCtx) => void)[] = [];
  const r = o.size;
  // the wet bank
  const bank = new THREE.RingGeometry(r * 0.9, r * 1.12, 64, 1);
  bank.rotateX(-Math.PI / 2);
  const buv = bank.getAttribute('uv');
  const bpos = bank.getAttribute('position');
  for (let i = 0; i < buv.count; i++) buv.setXY(i, bpos.getX(i) * 0.9, bpos.getZ(i) * 0.9);
  own.geos.push(bank);
  const bm = new THREE.Mesh(bank, litter);
  bm.position.y = 0.012;
  bm.receiveShadow = true;
  g.add(bm);
  // the water: clear, dark, reflecting the sky
  const wg = new THREE.CircleGeometry(r * 0.97, 72);
  wg.rotateX(-Math.PI / 2);
  const col = new Float32Array(wg.getAttribute('position').count * 3);
  const wpos = wg.getAttribute('position');
  const deep = new THREE.Color(dusk ? '#16293a' : '#1b4a55');
  const shallow = new THREE.Color(dusk ? '#3b5a6a' : '#5f8f78');
  const cc = new THREE.Color();
  for (let i = 0; i < wpos.count; i++) {
    const t = Math.hypot(wpos.getX(i), wpos.getZ(i)) / (r * 0.97);
    cc.copy(deep).lerp(shallow, Math.pow(t, 3));
    col.set([cc.r, cc.g, cc.b], i * 3);
  }
  wg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  own.geos.push(wg);
  const wm = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 });
  wm.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWp; uniform float uTime;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec2 p = vWp;
  float t = uTime;
  vec2 gr = vec2(cos(p.x * 3.1 + t * 1.3) * 0.5 + cos(p.y * 2.3 - t * 1.1 + p.x) * 0.4 + cos((p.x + p.y) * 5.3 + t * 2.1) * 0.25,
                 cos(p.y * 3.7 + t * 1.7) * 0.5 + cos(p.x * 2.7 + t * 0.9 - p.y) * 0.4 + cos((p.x - p.y) * 4.7 - t * 1.8) * 0.25) * 0.05;
  normal = normalize(normal + (viewMatrix * vec4(gr.x, 0.0, gr.y, 0.0)).xyz);
}`,
      );
  };
  wm.customProgramCacheKey = () => 'lawn-water-v1';
  own.mats.push(wm);
  const water = new THREE.Mesh(wg, wm);
  water.position.y = 0.05;
  water.receiveShadow = true;
  g.add(water);
  // the stone rim
  const rocks: THREE.Group[] = [];
  const ids = ['rock_07', 'rock_09', 'stone_01'];
  for (const id of ids) {
    const m = await model(id);
    if (m) rocks.push(m);
  }
  const n = Math.round(r * 11);
  for (let i = 0; i < n && rocks.length; i++) {
    const a = (i / n) * Math.PI * 2 + rng.range(-0.05, 0.05);
    const s = rng.range(0.38, 0.7);
    const rock = fitted(rocks[i % rocks.length], { size: s });
    rock.position.set(Math.cos(a) * (r * 1.0 + rng.range(-0.04, 0.08)), -0.04, Math.sin(a) * (r * 1.0 + rng.range(-0.04, 0.08)));
    rock.rotation.y = rng.range(0, 6.28);
    g.add(rock);
  }
  // lily pads with a flower or two
  const padMat = new THREE.MeshStandardMaterial({ color: '#3f7a38', roughness: 0.5, side: THREE.DoubleSide });
  const flowerMat = new THREE.MeshStandardMaterial({ color: '#ffd7ea', roughness: 0.5, side: THREE.DoubleSide });
  own.mats.push(padMat, flowerMat);
  const pads: THREE.Mesh[] = [];
  for (let i = 0; i < Math.round(r * 3); i++) {
    const a = rng.range(0, 6.28);
    const dd = rng.range(0.1, 0.78) * r;
    const pr = rng.range(0.1, 0.2);
    const pg = new THREE.CircleGeometry(pr, 16, 0.35, Math.PI * 2 - 0.35);
    pg.rotateX(-Math.PI / 2);
    own.geos.push(pg);
    const pad = new THREE.Mesh(pg, padMat);
    pad.position.set(Math.cos(a) * dd, 0.058, Math.sin(a) * dd);
    pad.rotation.y = rng.range(0, 6.28);
    pad.receiveShadow = true;
    g.add(pad);
    pads.push(pad);
    if (rng.chance(0.25)) {
      const fg = new THREE.ConeGeometry(0.06, 0.07, 8, 1, true);
      own.geos.push(fg);
      const f = new THREE.Mesh(fg, flowerMat);
      f.position.set(pad.position.x, 0.095, pad.position.z);
      g.add(f);
    }
  }
  updaters.push((_dt, ctx) => {
    pads.forEach((p, i) => (p.position.y = 0.058 + Math.sin(ctx.time * 1.3 + i) * 0.004));
  });
  g.position.set(o.x, 0, o.z);
  return { group: g, updaters };
}

// ------------------------------------------------------------------ a lantern

function lantern(o: ObstacleDef, own: { mats: THREE.Material[]; geos: THREE.BufferGeometry[] }) {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: '#23252b', roughness: 0.5, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: '#ffe7a8', emissive: '#ffcf70', emissiveIntensity: 3.2, roughness: 0.3 });
  own.mats.push(dark, glass);
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
    own.geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = true;
    g.add(m);
    return m;
  };
  mk(new THREE.CylinderGeometry(0.03, 0.04, 1.3, 10), dark, 0.65);
  mk(new THREE.CylinderGeometry(0.1, 0.12, 0.05, 12), dark, 0.02);
  mk(new THREE.CylinderGeometry(0.12, 0.12, 0.26, 6), glass, 1.42);
  mk(new THREE.ConeGeometry(0.17, 0.12, 6), dark, 1.61);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffcf80', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9, fog: false }));
  halo.scale.set(1.6, 1.6, 1);
  halo.position.y = 1.42;
  own.mats.push(halo.material);
  g.add(halo);
  g.position.set(o.x, 0, o.z);
  return {
    group: g,
    update: (_dt: number, ctx: SceneryCtx) => {
      (halo.material as THREE.SpriteMaterial).opacity = 0.82 + Math.sin(ctx.time * 3 + o.seed) * 0.06;
    },
  };
}
