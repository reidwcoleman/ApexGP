import * as THREE from 'three';
import { buildRoofDress } from './roofDress.ts';
import { BEACH_OCEAN_SHORE, ll, type P2 } from '../geo.ts';
import { signalState, type Network } from '../roads.ts';
import type { RoadBuild } from './roadMesh.ts';
import type { BuildingsBuild } from './buildings.ts';
import { rng } from './build.ts';
import { mergeBasic } from '../vehicles/parts.ts';
import type { Solid } from '../sim/collide.ts';
import { weatherUniforms } from '../../world/weatherUniforms.ts';
import { BEACH_W } from './ground.ts';

/**
 * Miami's street furniture: palms (royal palms down the boulevards and the causeway, coconut palms
 * on the beach and in the parks), the street lights (cobra heads on galvanised poles, twin-arm
 * masts on the highways, deco globes in South Beach) and the traffic signals (yellow heads on mast
 * arms over the road, lit from the network's own signal phases). All instanced, in spatial chunks
 * so the far ones cull; palms sway in the wind.
 */

export interface PropsBuild {
  group: THREE.Group;
  solids: Solid[];
  update(t: number, night: number): void;
  /** hide the chunks too far from the camera to matter (palms past ~1.6 km are a pixel) */
  cull(cam: THREE.Vector3): void;
}

/** how far each kind of street furniture is drawn (m) */
const FAR: Record<string, number> = {
  palmTrunks: 1500,
  palmCrowns: 1700,
  cobras: 900,
  masts: 1400,
  decoLamps: 800,
  decoGlobes: 1400,
  sigPoles: 700,
  sigArms: 700,
  sigHeads: 600,
  roofAC: 2500,
  roofFans: 1200,
  loungers: 900,
  umbrellas: 1100,
  umbrellaPoles: 700,
  cabanas: 1200,
  cabanaPosts: 700,
  daybeds: 800,
  roofCars: 2200,
};

// ------------------------------------------------------------------------------ palm models

let frondTex: THREE.CanvasTexture | null = null;
function frondTexture(): THREE.CanvasTexture {
  if (frondTex) return frondTex;
  const W = 128, H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  // leaflets: long thin blades angled off the rib (the rib runs up the left edge: x = 0)
  const R = rng(5);
  for (let y = 18; y < H - 4; y += 6) {
    const t = y / H;
    const len = W * (0.98 - 0.55 * Math.pow(t, 2.2)) * (0.85 + R() * 0.15);
    const ang = -0.55 - 0.25 * t;
    const g1 = Math.round(50 + 40 * t + R() * 20), g2 = Math.round(95 + 50 * (1 - t) + R() * 20);
    g.strokeStyle = `rgb(${g1},${g2},${Math.round(25 + R() * 15)})`;
    g.lineWidth = 3.2 - 1.6 * t;
    g.beginPath();
    g.moveTo(0, y);
    g.quadraticCurveTo(len * 0.5, y + Math.sin(ang) * len * 0.35, len, y + Math.sin(ang) * len * 0.55 + R() * 10);
    g.stroke();
    // a few broken, browned tips
    if (R() < 0.08) {
      g.strokeStyle = 'rgb(120,96,48)';
      g.beginPath();
      g.moveTo(len * 0.8, y + Math.sin(ang) * len * 0.45);
      g.lineTo(len, y + Math.sin(ang) * len * 0.55);
      g.stroke();
    }
  }
  // the rib
  g.strokeStyle = 'rgb(140,150,70)';
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(1, 0);
  g.lineTo(1, H);
  g.stroke();
  frondTex = new THREE.CanvasTexture(c);
  frondTex.colorSpace = THREE.SRGBColorSpace;
  frondTex.anisotropy = 4;
  return frondTex;
}

/** one frond as two blades in a V (each side of the rib), arching out and drooping */
function frondGeometry(len: number, droop: number, width: number, lift: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = [];
  const N = 10;
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      // rib: out along +x, up then down
      const x = len * t;
      const y = lift * Math.sin(t * Math.PI * 0.55) - droop * t * t;
      const w = width * (0.25 + 0.75 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.62)) * (1 - 0.3 * t);
      // leaflets angle up from the rib (a V), sideways out
      const vz = side * w;
      const vy = w * 0.42;
      pos.push(x, y, 0, x, y + vy, vz);
      uv.push(0, t, 1, t);
      nor.push(0, 1, 0, 0, 1, 0.3 * side);
      if (i < N) {
        const a = base + i * 2;
        if (side > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
        else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

interface PalmModel {
  trunk: THREE.BufferGeometry;
  crown: THREE.BufferGeometry;
  height: number;
}

/** royal palm: a tall smooth grey column, a green crownshaft, a full arching crown */
function royalPalm(seed: number): PalmModel {
  const R = rng(seed);
  const H = 15 + R() * 4;
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    // the bulge low and the swelling at mid height of a royal palm
    const r = 0.32 + 0.1 * Math.exp(-((t - 0.05) ** 2) / 0.004) + 0.05 * Math.exp(-((t - 0.55) ** 2) / 0.03) - 0.06 * t;
    prof.push(new THREE.Vector2(r, t * (H - 2.4)));
  }
  const trunk = new THREE.LatheGeometry(prof, 10);
  // the crownshaft
  const shaft = new THREE.CylinderGeometry(0.24, 0.3, 2.4, 10, 1);
  shaft.translate(0, H - 1.2, 0);
  // colour by height: grey trunk, green crownshaft (vertex colours)
  const tr = colorize(trunk, [0.62, 0.6, 0.56]);
  const sh = colorize(shaft, [0.26, 0.38, 0.12]);
  const trunkG = mergeColored([tr, sh]);
  const fronds: THREE.BufferGeometry[] = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const f = frondGeometry(3.6 + R() * 0.6, 1.6 + R() * 1.4, 0.85, 0.7 + R() * 0.5);
    f.rotateZ(0.35 - (i % 3) * 0.25);
    f.rotateY((i / n) * Math.PI * 2 + R() * 0.3);
    f.translate(0, H, 0);
    fronds.push(f);
  }
  return { trunk: trunkG, crown: mergeUV(fronds), height: H };
}

/** coconut palm: a curving, leaning ringed trunk, a drooping crown and a coconut cluster */
function coconutPalm(seed: number): PalmModel {
  const R = rng(seed);
  const H = 8 + R() * 5;
  const lean = 0.18 + R() * 0.25;
  const path: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    path.push(new THREE.Vector3(Math.sin(t * 1.2) * lean * H * 0.55, t * H, 0));
  }
  const curve = new THREE.CatmullRomCurve3(path);
  const trunk = new THREE.TubeGeometry(curve, 16, 0.22, 8, false);
  // taper: scale the rings toward the top
  const p = trunk.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / H;
    const c = curve.getPoint(Math.min(1, Math.max(0, y)));
    const k = 1.15 - 0.4 * y;
    p.setX(i, c.x + (p.getX(i) - c.x) * k);
    p.setZ(i, c.z + (p.getZ(i) - c.z) * k);
  }
  trunk.computeVertexNormals();
  const top = curve.getPoint(1);
  const tr = colorize(trunk, [0.46, 0.4, 0.33]);
  const nuts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.SphereGeometry(0.13, 6, 5);
    const a = (i / 6) * Math.PI * 2;
    s.translate(top.x + Math.cos(a) * 0.25, top.y - 0.35 - (i % 2) * 0.12, top.z + Math.sin(a) * 0.25);
    nuts.push(colorize(s, [0.42, 0.36, 0.12]));
  }
  const trunkG = mergeColored([tr, ...nuts]);
  const fronds: THREE.BufferGeometry[] = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const f = frondGeometry(3.4 + R() * 0.9, 2.2 + R() * 1.6, 0.8, 0.4 + R() * 0.4);
    f.rotateZ(0.5 - (i % 3) * 0.35);
    f.rotateY((i / n) * Math.PI * 2 + R() * 0.4);
    f.translate(top.x, top.y, top.z);
    fronds.push(f);
  }
  return { trunk: trunkG, crown: mergeUV(fronds), height: top.y };
}

function colorize(g: THREE.BufferGeometry, c: number[]): THREE.BufferGeometry {
  const ng = g.index ? g : g;
  const n = ng.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // ring marks: a darker band every 0.3 m on trunks
    const y = ng.getAttribute('position').getY(i);
    const ring = 0.88 + 0.12 * Math.sin(y * 21);
    col[i * 3] = c[0] * ring;
    col[i * 3 + 1] = c[1] * ring;
    col[i * 3 + 2] = c[2] * ring;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

function mergeColored(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  let base = 0;
  for (let g of list) {
    if (!g.index) g = g.toNonIndexed();
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

function mergeUV(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let base = 0;
  for (const g of list) {
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), u = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

const windU = { uWindT: { value: 0 } };

/** the fronds: alpha-tested leaves, sway with the wind (more at the tips) */
function frondMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, color: 0xc8d6a8 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, windU, { uWind: weatherUniforms.uWind });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindT;\nuniform vec2 uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
  vec3 ip = instanceMatrix[ 3 ].xyz;
  #else
  vec3 ip = vec3( 0.0 );
  #endif
  float ph = ip.x * 0.13 + ip.z * 0.07;
  float tip = smoothstep( 0.0, 4.0, length( transformed.xz ) );
  float gust = 0.6 + 0.4 * sin( uWindT * 0.7 + ph );
  float w = ( 0.25 + length( uWind ) * 0.08 ) * gust;
  transformed.y += sin( uWindT * 2.3 + ph + transformed.x * 0.8 ) * 0.18 * tip * w;
  transformed.x += sin( uWindT * 1.7 + ph ) * 0.12 * tip * w;
  transformed.z += cos( uWindT * 1.9 + ph ) * 0.12 * tip * w;
}`,
      );
  };
  m.customProgramCacheKey = () => 'ow-frond';
  return m;
}

// ------------------------------------------------------------------------------ lamp models

function cobraGeometry(): { pole: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.075, 0.13, 9, 8);
  pole.translate(0, 4.5, 0);
  parts.push(pole);
  const base = new THREE.CylinderGeometry(0.22, 0.25, 0.6, 8);
  base.translate(0, 0.3, 0);
  parts.push(base);
  // the arm reaches out along +z, rising slightly
  const arm = new THREE.CylinderGeometry(0.045, 0.06, 2.6, 6);
  arm.rotateX(Math.PI / 2 - 0.08);
  arm.translate(0, 8.95, 1.3);
  parts.push(arm);
  const head = new THREE.BoxGeometry(0.32, 0.14, 0.75);
  head.translate(0, 9.02, 2.65);
  parts.push(head);
  const lens = new THREE.BoxGeometry(0.26, 0.03, 0.55);
  lens.translate(0, 8.94, 2.68);
  return { pole: mergeBasic(parts), lens };
}
function mastGeometry(): { pole: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.11, 0.2, 13, 8);
  pole.translate(0, 6.5, 0);
  parts.push(pole);
  const lensParts: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    const arm = new THREE.CylinderGeometry(0.05, 0.07, 3.4, 6);
    arm.rotateX((Math.PI / 2 - 0.1) * s);
    arm.translate(0, 12.9, 1.7 * s);
    parts.push(arm);
    const head = new THREE.BoxGeometry(0.4, 0.16, 0.9);
    head.translate(0, 13.05, 3.4 * s);
    parts.push(head);
    const lens = new THREE.BoxGeometry(0.32, 0.03, 0.7);
    lens.translate(0, 12.96, 3.4 * s);
    lensParts.push(lens);
  }
  return { pole: mergeBasic(parts), lens: mergeBasic(lensParts) };
}
function decoGeometry(): { pole: THREE.BufferGeometry; lens: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.06, 0.11, 4.2, 10);
  pole.translate(0, 2.1, 0);
  parts.push(pole);
  const base = new THREE.CylinderGeometry(0.2, 0.26, 0.9, 10);
  base.translate(0, 0.45, 0);
  parts.push(base);
  const cap = new THREE.ConeGeometry(0.28, 0.25, 10);
  cap.translate(0, 4.95, 0);
  parts.push(cap);
  const lens = new THREE.SphereGeometry(0.26, 12, 8);
  lens.translate(0, 4.55, 0);
  return { pole: mergeBasic(parts), lens };
}

// ------------------------------------------------------------------------------ signals

function signalPoleGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pole = new THREE.CylinderGeometry(0.14, 0.2, 6.6, 8);
  pole.translate(0, 3.3, 0);
  parts.push(pole);
  // the mast arm along +z (unit length; scaled per instance in z)
  return mergeBasic(parts);
}
function signalArmGeometry(): THREE.BufferGeometry {
  const arm = new THREE.CylinderGeometry(0.08, 0.12, 1, 6);
  arm.rotateX(Math.PI / 2);
  arm.translate(0, 6.3, 0.5);
  return arm;
}
function signalHeadGeometry(): THREE.BufferGeometry {
  // a 3-light vertical head with visors, its back toward +z (faces -z: toward the traffic)
  const parts: THREE.BufferGeometry[] = [];
  const box = new THREE.BoxGeometry(0.36, 1.05, 0.26);
  parts.push(box);
  for (let i = 0; i < 3; i++) {
    const visor = new THREE.CylinderGeometry(0.15, 0.15, 0.22, 10, 1, true, -Math.PI / 2, Math.PI);
    visor.rotateX(Math.PI / 2);
    visor.rotateZ(Math.PI);
    visor.translate(0, 0.33 - i * 0.33 + 0.02, -0.22);
    parts.push(visor);
  }
  const plate = new THREE.BoxGeometry(0.62, 1.3, 0.03);
  plate.translate(0, 0, 0.14);
  parts.push(plate);
  return mergeBasic(parts);
}

// ------------------------------------------------------------------------------ build

interface Inst {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  sz?: number;
}

/** instanced meshes split in spatial chunks */
function chunkedInstances(geo: THREE.BufferGeometry, mat: THREE.Material, list: Inst[], chunk: number, opts: { cast?: boolean; name: string; tilt?: (i: Inst) => THREE.Euler }): THREE.Group {
  const g = new THREE.Group();
  g.name = opts.name;
  const buckets = new Map<string, Inst[]>();
  for (const it of list) {
    const k = Math.floor(it.x / chunk) + ',' + Math.floor(it.z / chunk);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(it);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (const b of buckets.values()) {
    const im = new THREE.InstancedMesh(geo, mat, b.length);
    b.forEach((it, i) => {
      q.setFromEuler(opts.tilt ? opts.tilt(it) : new THREE.Euler(0, it.yaw, 0));
      s.set(it.s, it.s, it.sz ?? it.s);
      p.set(it.x, it.y, it.z);
      im.setMatrixAt(i, m4.compose(p, q, s));
    });
    im.castShadow = opts.cast ?? false;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}

export function buildProps(net: Network, roads: RoadBuild, bld: BuildingsBuild, beachX: (z: number) => number): PropsBuild {
  const group = new THREE.Group();
  group.name = 'Props';
  const solids: Solid[] = [];
  const R = rng(4711);

  // ---------------------------------------------------------------- palms
  const royal = [royalPalm(1), royalPalm(2)];
  const coco = [coconutPalm(3), coconutPalm(4), coconutPalm(5)];
  const lists: Inst[][] = [[], [], [], [], []];
  const free = (x: number, z: number, r = 1.4) => {
    if (!net.mask.land(x, z)) return false;
    for (const id of net.near(x, z)) {
      const e = net.edges[id];
      const pr = net.project(e, x, z, PR);
      if (!pr || pr.off || pr.y > 2) continue;
      if (Math.abs(pr.lat) < e.hw + r) return false;
    }
    for (const c of bld.colliders) {
      if (Math.abs(c.cx - x) > c.r + 3 || Math.abs(c.cz - z) > c.r + 3) continue;
      if (inPoly(x, z, c.poly)) return false;
    }
    return true;
  };
  const addPalm = (x: number, z: number, y: number, kind: number) => {
    const k = kind === 0 ? Math.floor(R() * 2) : 2 + Math.floor(R() * 3);
    lists[k].push({ x, y, z, yaw: R() * Math.PI * 2, s: 0.85 + R() * 0.3 });
    solids.push({ poly: [], circle: 0.4, y0: y - 1, y1: y + 12, cx: x, cz: z, r: 0.4, kind: 'palm' });
  };
  for (const p of roads.palms) addPalm(p.x, p.z, p.y, p.kind);
  // the podium decks and tower tops (their planter palms join the palms here)
  const roofDress = buildRoofDress(bld, addPalm);
  group.add(roofDress.group);
  // street palms on the avenues' sidewalks
  const tmp = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  for (const e of net.edges) {
    if (e.elevated || e.spec.sidewalk < 3.5) continue;
    if (e.kind === 'street' && R() < 0.75) continue;
    const step = e.kind === 'ocean' ? 11 : 17;
    for (let s = (e.walkA || 10) + 4; s < e.len - (e.walkB || 10) - 4; s += step + R() * 6) {
      for (const side of [-1, 1]) {
        if (R() < 0.35) continue;
        const lat = side * (e.hw + 1.2);
        net.point(e, s, lat, tmp);
        addPalm(tmp.x, tmp.z, tmp.y + 0.18, e.kind === 'ocean' ? 1 : 0);
      }
    }
  }
  // open lots and plazas
  for (const o of bld.open) {
    const n = Math.min(10, Math.ceil(o.r / 7));
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = R() * o.r * 0.8;
      const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
      if (free(x, z)) addPalm(x, z, 0, R() < 0.6 ? 1 : 0);
    }
  }
  // Lummus Park and the beach: coconut palms in loose groves along the sand's edge
  for (let i = 0; i + 1 < BEACH_OCEAN_SHORE.length; i++) {
    const a = BEACH_OCEAN_SHORE[i], b = BEACH_OCEAN_SHORE[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let d = 0; d < L; d += 9) {
      const t = d / L;
      const z = a.z + (b.z - a.z) * t;
      const x = beachX(z) - BEACH_W - 4 - R() * 40;
      if (R() < 0.55 && free(x, z, 1)) addPalm(x, z, 0, 1);
    }
  }
  // the bayfront parks east of Biscayne Blvd, and the islands
  const scatter = (c: P2, rx: number, rz: number, n: number, kind: number) => {
    for (let i = 0; i < n; i++) {
      const x = c.x + (R() - 0.5) * 2 * rx, z = c.z + (R() - 0.5) * 2 * rz;
      if (free(x, z, 2)) addPalm(x, z, 0, kind);
    }
  };
  scatter(ll(25.7760, -80.1852), 90, 330, 120, 1);
  scatter(ll(25.7850, -80.1858), 80, 170, 60, 0);
  scatter(ll(25.7872, -80.1760), 350, 230, 120, 1);
  scatter(ll(25.7776, -80.1489), 250, 120, 70, 1);
  scatter(ll(25.7836, -80.1560), 380, 70, 50, 1);
  scatter(ll(25.7858, -80.1492), 360, 60, 45, 1);
  scatter(ll(25.7605, -80.1430), 380, 330, 140, 1);
  scatter(ll(25.7679, -80.1836), 200, 160, 60, 1);
  scatter(ll(25.7680, -80.1345), 200, 120, 60, 1);

  const trunkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const fm = frondMaterial();
  const models = [...royal, ...coco];
  models.forEach((m, k) => {
    if (!lists[k].length) return;
    group.add(chunkedInstances(m.trunk, trunkMat, lists[k], 600, { cast: true, name: 'palmTrunks' }));
    group.add(chunkedInstances(m.crown, fm, lists[k], 600, { cast: true, name: 'palmCrowns' }));
  });

  // ---------------------------------------------------------------- street lights
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d9093, metalness: 0.65, roughness: 0.45 });
  const decoMat = new THREE.MeshStandardMaterial({ color: 0x1d4a46, metalness: 0.4, roughness: 0.5 });
  const lensWarm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.45) });
  const lensCool = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.95, 1.0) });
  const lensDeco = new THREE.MeshStandardMaterial({ color: 0xf4efe2, emissive: 0xffe0b0, emissiveIntensity: 0.0, roughness: 0.3, transparent: true, opacity: 0.92 });
  const cobra = cobraGeometry(), mast = mastGeometry(), deco = decoGeometry();
  const L: Record<'cobra' | 'mast' | 'deco', Inst[]> = { cobra: [], mast: [], deco: [] };
  const lensW: Inst[] = [], lensC: Inst[] = [];
  for (const l of roads.lamps) {
    // the pole stands at the curb (the lamp's x/z is where its light falls: back off along the arm)
    const fx = Math.sin(l.yaw), fz = Math.cos(l.yaw);
    const px = l.x - fx * l.arm, pz = l.z - fz * l.arm;
    const it = { x: px, y: l.base + (l.type === 'mast' ? 0.9 : 0.15), z: pz, yaw: l.yaw + (l.type === 'cobra' ? Math.PI : 0) + (l.type === 'mast' ? Math.PI / 2 : 0), s: 1 };
    // cobra geometry reaches along +z: face the arm over the road
    if (l.type === 'cobra') it.yaw = l.yaw;
    L[l.type].push(it);
    if (l.type !== 'deco') (l.kind === 1 ? lensC : lensW).push(it);
    if (l.type !== 'mast') solids.push({ poly: [], circle: 0.22, y0: l.base - 1, y1: l.base + 8, cx: px, cz: pz, r: 0.22, kind: 'pole' });
  }
  group.add(chunkedInstances(cobra.pole, poleMat, L.cobra, 400, { cast: true, name: 'cobras' }));
  group.add(chunkedInstances(mast.pole, poleMat, L.mast, 600, { cast: true, name: 'masts' }));
  group.add(chunkedInstances(deco.pole, decoMat, L.deco, 400, { cast: true, name: 'decoLamps' }));
  const lensSplit = (list: Inst[], mat: THREE.Material) => {
    const cl = list.filter((i) => L.cobra.includes(i)), ml = list.filter((i) => L.mast.includes(i));
    if (cl.length) group.add(chunkedInstances(cobra.lens, mat, cl, 1100, { name: 'lenses' }));
    if (ml.length) group.add(chunkedInstances(mast.lens, mat, ml, 600, { name: 'lenses' }));
  };
  lensSplit(lensW, lensWarm);
  lensSplit(lensC, lensCool);
  if (L.deco.length) group.add(chunkedInstances(deco.lens, lensDeco, L.deco, 400, { name: 'decoGlobes' }));

  // ---------------------------------------------------------------- signals
  const sigPoleMat = new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.6, roughness: 0.45 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xd9b21a, metalness: 0.1, roughness: 0.55 });
  const poles: Inst[] = [], arms: Inst[] = [], heads: Inst[] = [];
  /** per lamp disc: which signal, which phase group, which colour (0 red, 1 amber, 2 green) */
  const discs: { sig: number; group: number; c: number; m: THREE.Matrix4 }[] = [];
  for (const sp of roads.signalPoles) {
    const node = net.nodes[sp.node];
    const sig = net.signals[node.signal];
    const gi = node.edges.indexOf(sp.edge);
    const group = sig.group[gi];
    // the pole on the corner, the arm out over the approach (toward the road's centre)
    const yaw = sp.yaw;
    poles.push({ x: sp.x, y: sp.y, z: sp.z, yaw, s: 1 });
    // arm direction: across the road (90° from the traffic's travel), i.e. local +z rotated
    const armYaw = yaw + Math.PI / 2;
    arms.push({ x: sp.x, y: sp.y, z: sp.z, yaw: armYaw, s: 1, sz: sp.reach });
    for (const f of [0.55, 0.92]) {
      const hx = sp.x + Math.sin(armYaw) * sp.reach * f, hz = sp.z + Math.cos(armYaw) * sp.reach * f;
      heads.push({ x: hx, y: sp.y + 5.55, z: hz, yaw, s: 1 });
      for (let c = 0; c < 3; c++) {
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(hx, sp.y + 5.55 + 0.33 - c * 0.33 + 0.02, hz).add(new THREE.Vector3(-Math.sin(yaw) * 0.14, 0, -Math.cos(yaw) * 0.14)),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        discs.push({ sig: node.signal, group, c, m });
      }
    }
    solids.push({ poly: [], circle: 0.25, y0: sp.y - 1, y1: sp.y + 6, cx: sp.x, cz: sp.z, r: 0.25, kind: 'pole' });
  }
  group.add(chunkedInstances(signalPoleGeometry(), sigPoleMat, poles, 500, { cast: true, name: 'sigPoles' }));
  group.add(chunkedInstances(signalArmGeometry(), sigPoleMat, arms, 500, { cast: true, name: 'sigArms' }));
  group.add(chunkedInstances(signalHeadGeometry(), headMat, heads, 500, { cast: true, name: 'sigHeads' }));
  // the lamps: one instanced disc mesh, coloured per frame from the phases
  const discGeo = new THREE.CircleGeometry(0.12, 12);
  discGeo.rotateY(Math.PI);
  const discMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const discMesh = new THREE.InstancedMesh(discGeo, discMat, Math.max(1, discs.length));
  discs.forEach((d, i) => discMesh.setMatrixAt(i, d.m));
  discMesh.count = discs.length;
  discMesh.computeBoundingSphere();
  discMesh.frustumCulled = false;
  group.add(discMesh);
  const ON = [new THREE.Color(5, 0.25, 0.15), new THREE.Color(5, 2.6, 0.2), new THREE.Color(0.3, 4.5, 2.2)];
  const OFF = [new THREE.Color(0.12, 0.02, 0.02), new THREE.Color(0.12, 0.08, 0.02), new THREE.Color(0.02, 0.1, 0.06)];
  const col = new THREE.Color();
  let lastNight = -1;

  // the cull list: every chunk of the kinds above, with its bounding sphere
  const culled: { m: THREE.Object3D; c: THREE.Vector3; r: number; far: number }[] = [];
  group.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh) return;
    const far = FAR[im.name] ?? FAR[im.parent?.name ?? ''];
    if (!far || !im.boundingSphere) return;
    culled.push({ m: im, c: im.boundingSphere.center.clone(), r: im.boundingSphere.radius, far });
  });

  return {
    group,
    solids,
    cull(cam) {
      for (const k of culled) k.m.visible = k.c.distanceTo(cam) - k.r < k.far;
    },
    update(t, night) {
      windU.uWindT.value = t;
      roofDress.update(t, night);
      // the signals (every frame: cheap, a colour per disc)
      for (let i = 0; i < discs.length; i++) {
        const d = discs[i];
        const st = signalState(net.signals[d.sig], d.group, t);
        const lit = (st === 0 && d.c === 2) || (st === 1 && d.c === 1) || (st === 2 && d.c === 0);
        col.copy(lit ? ON[d.c] : OFF[d.c]);
        if (lit) col.multiplyScalar(0.55 + 0.45 * night + 0.25);
        discMesh.setColorAt(i, col);
      }
      if (discMesh.instanceColor) discMesh.instanceColor.needsUpdate = true;
      if (Math.abs(night - lastNight) > 0.02) {
        lastNight = night;
        const k = 0.15 + night * 6;
        lensWarm.color.setRGB(1.0 * k, 0.72 * k, 0.42 * k);
        lensCool.color.setRGB(0.9 * k, 0.95 * k, 1.0 * k);
        lensDeco.emissiveIntensity = night * 3;
      }
    },
  };
}

const PR = { s: 0, lat: 0, y: 0, tx: 0, tz: 0, off: false, i: 0, t: 0 };

function inPoly(x: number, z: number, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
