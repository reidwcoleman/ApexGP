import * as THREE from 'three';
import type { Network } from '../roads.ts';
import type { Solid } from '../sim/collide.ts';
import { rng } from './build.ts';
import { fx } from '../fx/particles.ts';

/**
 * The sidewalks' furniture: fire hydrants (Miami-Dade's yellow, with red caps), litter bins at the
 * corners, newspaper boxes in clumps, pay stations along the parking lanes, benches, and bus
 * shelters on the avenues (a steel frame, glass back, a lit advert panel after dark).
 *
 * All instanced, in 400 m chunks that cull with distance. The small things can be hit: a car
 * through a bin or a news box sends it tumbling (it ends up lying where it lands); a hydrant
 * sheared off its stand throws up a column of water for half a minute. The shelters are solid.
 */

type RGB = [number, number, number];
type Kind = 'hydrant' | 'bin' | 'news' | 'pay' | 'bench' | 'shelter';

interface Item {
  kind: Kind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** variant (news box colour) */
  v: number;
  /** where it's drawn: the chunk mesh and its instance */
  mesh: THREE.InstancedMesh;
  i: number;
  /** knocked: the tumble's state */
  down: boolean;
}

interface Fly {
  it: Item;
  p: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
  w: THREE.Vector3;
  t: number;
}

const CHUNK = 400;
const FAR: Record<Kind, number> = { hydrant: 260, bin: 300, news: 260, pay: 220, bench: 280, shelter: 650 };
/** knockable: radius (m) and mass (kg) */
const HIT: Partial<Record<Kind, { r: number; m: number; h: number }>> = {
  hydrant: { r: 0.25, m: 90, h: 0.75 },
  bin: { r: 0.35, m: 25, h: 1.0 },
  news: { r: 0.35, m: 40, h: 1.1 },
  pay: { r: 0.25, m: 60, h: 1.5 },
  bench: { r: 0.9, m: 60, h: 0.85 },
};

function paint(g: THREE.BufferGeometry, c: RGB): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const k = n.getAttribute('position').count;
  const col = new Float32Array(k * 3);
  for (let i = 0; i < k; i++) col.set(c, i * 3);
  n.setAttribute('color', new THREE.BufferAttribute(col, 3));
  n.deleteAttribute('uv');
  return n;
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], col: number[] = [];
  for (const g of list) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position'), n = g.getAttribute('normal'), c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(c.getX(i), c.getY(i), c.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: RGB, ry = 0, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, c);
};
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, c: RGB, seg = 12, rz = 0, rx = 0) => {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg);
  if (rz) g.rotateZ(rz);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return paint(g, c);
};

// ---- the models (local: x across, y up, z toward the road)

function hydrant(): THREE.BufferGeometry {
  const Y: RGB = [0.78, 0.6, 0.05], RED: RGB = [0.55, 0.06, 0.04], STEEL: RGB = [0.35, 0.35, 0.36];
  return merge([
    cyl(0.17, 0.17, 0.08, 0, 0.04, 0, STEEL, 14),
    cyl(0.12, 0.11, 0.5, 0, 0.33, 0, Y, 14),
    cyl(0.14, 0.14, 0.05, 0, 0.12, 0, Y, 14),
    cyl(0.13, 0.13, 0.05, 0, 0.56, 0, Y, 14),
    // the bonnet and its nut
    (() => {
      const g = new THREE.SphereGeometry(0.115, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      g.translate(0, 0.58, 0);
      return paint(g, RED);
    })(),
    cyl(0.03, 0.03, 0.06, 0, 0.71, 0, RED, 6),
    // the hose outlets either side, the pumper toward the road
    cyl(0.045, 0.045, 0.32, 0, 0.42, 0, Y, 10, Math.PI / 2),
    cyl(0.055, 0.055, 0.04, 0.17, 0.42, 0, RED, 10, Math.PI / 2),
    cyl(0.055, 0.055, 0.04, -0.17, 0.42, 0, RED, 10, Math.PI / 2),
    cyl(0.07, 0.07, 0.14, 0, 0.4, 0.1, Y, 12, 0, Math.PI / 2),
    cyl(0.08, 0.08, 0.04, 0, 0.4, 0.18, RED, 12, 0, Math.PI / 2),
  ]);
}

function bin(): THREE.BufferGeometry {
  const G: RGB = [0.05, 0.12, 0.08], D: RGB = [0.03, 0.03, 0.035];
  const parts = [cyl(0.31, 0.3, 0.86, 0, 0.45, 0, G, 18), cyl(0.33, 0.33, 0.04, 0, 0.06, 0, D, 18), cyl(0.32, 0.32, 0.03, 0, 0.88, 0, D, 18)];
  // the slats
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    parts.push(box(0.05, 0.78, 0.025, Math.sin(a) * 0.315, 0.47, Math.cos(a) * 0.315, G, a));
  }
  // the domed lid with its opening
  const lid = new THREE.SphereGeometry(0.32, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  lid.scale(1, 0.45, 1);
  lid.translate(0, 0.9, 0);
  parts.push(paint(lid, D));
  parts.push(box(0.26, 0.1, 0.06, 0, 0.98, 0.25, [0.01, 0.01, 0.01]));
  return merge(parts);
}

const NEWS: RGB[] = [[0.06, 0.2, 0.55], [0.6, 0.06, 0.05], [0.85, 0.7, 0.08], [0.85, 0.85, 0.83], [0.08, 0.35, 0.18]];
function newsBox(c: RGB): THREE.BufferGeometry {
  const D: RGB = [0.05, 0.05, 0.055], P: RGB = [0.82, 0.82, 0.78];
  return merge([
    // legs
    box(0.03, 0.4, 0.03, -0.18, 0.2, -0.16, D),
    box(0.03, 0.4, 0.03, 0.18, 0.2, -0.16, D),
    box(0.03, 0.4, 0.03, -0.18, 0.2, 0.16, D),
    box(0.03, 0.4, 0.03, 0.18, 0.2, 0.16, D),
    box(0.44, 0.62, 0.42, 0, 0.71, 0, c),
    box(0.46, 0.05, 0.44, 0, 1.04, 0, c),
    // the window with today's paper behind it, the coin slot
    box(0.34, 0.24, 0.01, 0, 0.82, 0.215, [0.1, 0.11, 0.12]),
    box(0.26, 0.16, 0.012, 0, 0.8, 0.214, P),
    box(0.06, 0.08, 0.02, 0.14, 0.98, 0.215, [0.6, 0.6, 0.62]),
  ]);
}

function payStation(): THREE.BufferGeometry {
  const B: RGB = [0.1, 0.12, 0.16], S: RGB = [0.5, 0.52, 0.55];
  return merge([
    box(0.3, 0.06, 0.25, 0, 0.03, 0, S),
    box(0.26, 1.35, 0.2, 0, 0.72, 0, B),
    box(0.3, 0.08, 0.24, 0, 1.43, 0, B),
    box(0.16, 0.12, 0.01, 0, 1.22, 0.105, [0.15, 0.3, 0.32]),
    box(0.18, 0.1, 0.02, 0, 1.02, 0.11, S),
    box(0.06, 0.06, 0.02, 0, 0.86, 0.11, [0.7, 0.55, 0.1]),
  ]);
}

function bench(): THREE.BufferGeometry {
  const W: RGB = [0.32, 0.2, 0.12], M: RGB = [0.08, 0.08, 0.09];
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.7, 0.7]) {
    parts.push(box(0.06, 0.44, 0.5, x, 0.22, 0, M));
    parts.push(box(0.06, 0.5, 0.06, x, 0.65, -0.24, M, 0, -0.18));
  }
  for (let i = 0; i < 4; i++) parts.push(box(1.7, 0.035, 0.1, 0, 0.45, -0.17 + i * 0.12, W));
  for (let i = 0; i < 3; i++) parts.push(box(1.7, 0.09, 0.03, 0, 0.62 + i * 0.13, -0.27 - i * 0.025, W, 0, -0.18));
  return merge(parts);
}

function shelter(): { frame: THREE.BufferGeometry; glass: THREE.BufferGeometry; ad: (v: number) => THREE.BufferGeometry } {
  const M: RGB = [0.2, 0.21, 0.22], R: RGB = [0.62, 0.63, 0.64];
  const parts: THREE.BufferGeometry[] = [];
  const W = 4.2, D = 1.6, H = 2.55;
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-D / 2 + 0.05, D / 2 - 0.3]) parts.push(box(0.08, H, 0.08, x, H / 2, z, M));
  // the roof: a shallow slab sloping back, its fascia
  parts.push(box(W + 0.2, 0.08, D + 0.25, 0, H + 0.04, 0.05, R, 0, -0.04));
  parts.push(box(W + 0.22, 0.16, 0.04, 0, H, D / 2 + 0.18, M));
  // the bench along the back
  parts.push(box(2.2, 0.05, 0.38, 0.4, 0.46, -D / 2 + 0.3, M));
  parts.push(box(0.05, 0.44, 0.3, -0.6, 0.23, -D / 2 + 0.3, M));
  parts.push(box(0.05, 0.44, 0.3, 1.4, 0.23, -D / 2 + 0.3, M));
  // the stop's sign on a post at the front corner
  parts.push(box(0.06, 2.9, 0.06, W / 2 + 0.35, 1.45, D / 2 + 0.05, M));
  parts.push(box(0.04, 0.45, 0.36, W / 2 + 0.35, 2.7, D / 2 + 0.05, [0.06, 0.2, 0.55]));
  const glass = merge([box(W - 1.4, 1.95, 0.02, 0.7 - 0.0, 1.15, -D / 2 + 0.05, [1, 1, 1]), box(0.02, 1.95, D - 0.5, -W / 2 + 0.05, 1.15, -0.1, [1, 1, 1])]);
  // the advert: a lightbox at the end of the back wall, a poster each side (one of four)
  const ad = (v: number) => {
    const faces: THREE.BufferGeometry[] = [];
    for (const side of [1, -1]) {
      const g = new THREE.PlaneGeometry(1.2, 1.8);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, (v + (side > 0 ? uv.getX(i) : 1 - uv.getX(i))) * 0.25);
      if (side < 0) g.rotateY(Math.PI);
      g.translate(-W / 2 + 0.72, 1.15, -D / 2 + 0.05 + side * 0.065);
      faces.push(g);
    }
    const out = new THREE.BufferGeometry();
    const pos: number[] = [], nor: number[] = [], uvs: number[] = [];
    for (const f of faces) {
      const n = f.index ? f.toNonIndexed() : f;
      pos.push(...(n.getAttribute('position').array as Float32Array));
      nor.push(...(n.getAttribute('normal').array as Float32Array));
      uvs.push(...(n.getAttribute('uv').array as Float32Array));
    }
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    return out;
  };
  parts.push(box(1.33, 1.93, 0.1, -W / 2 + 0.72, 1.15, -D / 2 + 0.02, M));
  return { frame: merge(parts), glass, ad };
}

export interface FurnitureBuild {
  group: THREE.Group;
  /** the shelters: solid */
  solids: Solid[];
  /** a vehicle through the street (its box and velocity): anything it hits goes over. Returns the speed lost (m/s) */
  hit(x: number, z: number, y: number, yaw: number, hl: number, hw: number, vx: number, vz: number, mass: number): number;
  update(dt: number, cam: THREE.Vector3, night: number, t: number): void;
}

export function buildFurniture(net: Network, taken: (x: number, z: number, r: number) => boolean): FurnitureBuild {
  const R = rng(9091);
  const group = new THREE.Group();
  group.name = 'Furniture';
  const items: Omit<Item, 'mesh' | 'i'>[] = [];
  const pt = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  const pt2 = { x: 0, y: 0, z: 0, tx: 0, tz: 0 };
  const occupied: { x: number; z: number; r: number }[] = [];
  const clear = (x: number, z: number, r: number) => {
    if (taken(x, z, r)) return false;
    for (const o of occupied) if (Math.abs(o.x - x) < o.r + r && Math.abs(o.z - z) < o.r + r) return false;
    return true;
  };
  const put = (kind: Kind, e: (typeof net.edges)[number], s: number, lat: number, v = 0, r = 0.5, along = 0) => {
    net.point(e, s, lat, pt);
    net.point(e, s, lat - Math.sign(lat), pt2);
    // facing the road (local +z toward it), optionally turned to run along the curb
    const yaw = Math.atan2(pt2.x - pt.x, pt2.z - pt.z) + along;
    if (!clear(pt.x, pt.z, r)) return false;
    occupied.push({ x: pt.x, z: pt.z, r });
    items.push({ kind, x: pt.x, y: pt.y + 0.15, z: pt.z, yaw, v, down: false });
    return true;
  };
  for (const e of net.edges) {
    if (e.elevated || e.spec.sidewalk < 2.3 || e.kind === 'highway' || e.kind === 'ramp' || e.kind === 'causeway') continue;
    const s0 = (e.walkA || 8) + 1.5, s1 = e.len - (e.walkB || 8) - 1.5;
    if (s1 - s0 < 6) continue;
    const curb = e.hw + 0.55;
    for (const side of [-1, 1]) {
      // the corners: a bin, sometimes a clump of news boxes
      for (const [s, dir] of [[s0 + 1.5, 1], [s1 - 1.5, -1]] as const) {
        if (R() < 0.55) put('bin', e, s, side * curb, 0, 0.45);
        if (R() < 0.3) {
          const n = 2 + Math.floor(R() * 3);
          for (let k = 0; k < n; k++) put('news', e, s + dir * (1.4 + k * 0.52), side * (curb + 0.1), Math.floor(R() * NEWS.length), 0.27);
        }
      }
      // hydrants every block or so
      for (let s = s0 + 6 + R() * 40; s < s1 - 4; s += 70 + R() * 50) put('hydrant', e, s, side * (curb - 0.05), 0, 0.4);
      // pay stations along the parking lanes
      if (e.spec.parking > 0) for (let s = s0 + 12 + R() * 20; s < s1 - 6; s += 45 + R() * 30) put('pay', e, s, side * curb, 0, 0.35);
      // benches on the promenades and the avenues
      if (e.kind === 'ocean' || ((e.kind === 'avenue' || e.kind === 'boulevard') && R() < 0.4))
        for (let s = s0 + 8 + R() * 20; s < s1 - 6; s += e.kind === 'ocean' ? 22 + R() * 10 : 80 + R() * 60) put('bench', e, s, side * (e.hw + e.spec.sidewalk - 0.7), 0, 1.0);
      // bus shelters: one a block or two along the avenues, at the back of a wide sidewalk
      if ((e.kind === 'avenue' || e.kind === 'boulevard') && e.spec.sidewalk >= 3.4 && e.len > 90 && R() < 0.5) put('shelter', e, (s0 + s1) / 2 + (R() - 0.5) * 20, side * (e.hw + e.spec.sidewalk - 1.05), Math.floor(R() * 4), 2.4);
    }
  }
  // ---- the meshes, by kind (and colour) and chunk
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9fb3b8, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false });
  const adMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0, map: adTexture() });
  const sh = shelter();
  const geos: Record<string, THREE.BufferGeometry> = { hydrant: hydrant(), bin: bin(), pay: payStation(), bench: bench(), shelter: sh.frame };
  NEWS.forEach((c, i) => (geos['news' + i] = newsBox(c)));
  for (let v = 0; v < 4; v++) geos['shelter' + v] = sh.frame;
  const buckets = new Map<string, Omit<Item, 'mesh' | 'i'>[]>();
  for (const it of items) {
    const k = (it.kind === 'news' || it.kind === 'shelter' ? it.kind + it.v : it.kind) + '|' + Math.floor(it.x / CHUNK) + ',' + Math.floor(it.z / CHUNK);
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(it);
  }
  const all: Item[] = [];
  const culled: { m: THREE.Object3D; c: THREE.Vector3; r: number; far: number }[] = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  const solids: Solid[] = [];
  for (const [key, list] of buckets) {
    const geoKey = key.split('|')[0];
    const kind = list[0].kind;
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, cast: boolean) => {
      const im = new THREE.InstancedMesh(geo, m, list.length);
      list.forEach((it, i) => im.setMatrixAt(i, m4.compose(p.set(it.x, it.y, it.z), q.setFromEuler(new THREE.Euler(0, it.yaw, 0)), one)));
      im.castShadow = cast;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = 'furniture-' + kind;
      group.add(im);
      culled.push({ m: im, c: im.boundingSphere!.center.clone(), r: im.boundingSphere!.radius, far: FAR[kind] });
      return im;
    };
    const im = add(geos[geoKey], mat, true);
    list.forEach((it, i) => all.push({ ...it, mesh: im, i }));
    if (kind === 'shelter') {
      add(sh.glass, glassMat, false);
      add(sh.ad(list[0].v), adMat, false);
      for (const it of list) {
        // (solid: its footprint, turned)
        const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
        const corner = (lx: number, lz: number) => ({ x: it.x + lx * c + lz * s, z: it.z - lx * s + lz * c });
        solids.push({ poly: [corner(-2.2, -0.85), corner(2.2, -0.85), corner(2.2, 0.75), corner(-2.2, 0.75)], y0: it.y - 1, y1: it.y + 2.7, cx: it.x, cz: it.z, r: 2.4, kind: 'barrier' });
      }
    }
  }
  // a spatial hash of the knockable things
  const grid = new Map<number, Item[]>();
  const gk = (x: number, z: number) => Math.floor(x / 20) * 100003 + Math.floor(z / 20);
  for (const it of all) {
    if (!HIT[it.kind]) continue;
    const k = gk(it.x, it.z);
    let b = grid.get(k);
    if (!b) grid.set(k, (b = []));
    b.push(it);
  }
  const flying: Fly[] = [];
  const geysers: { x: number; y: number; z: number; t: number; acc: number }[] = [];
  const E = new THREE.Euler();
  return {
    group,
    solids,
    hit(x, z, y, yaw, hl, hw, vx, vz, mass) {
      const sp = Math.hypot(vx, vz);
      if (sp < 1.5) return 0;
      let lost = 0;
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      for (let gx = -1; gx <= 1; gx++)
        for (let gz = -1; gz <= 1; gz++) {
          const b = grid.get(gk(x + gx * 20, z + gz * 20));
          if (!b) continue;
          for (const it of b) {
            if (it.down) continue;
            const H = HIT[it.kind]!;
            if (Math.abs(it.y - y) > 2) continue;
            const dx = it.x - x, dz = it.z - z;
            // into the car's frame
            const lz = dx * sy + dz * cy, lx = dx * cy - dz * sy;
            if (Math.abs(lz) > hl + H.r || Math.abs(lx) > hw + H.r) continue;
            it.down = true;
            // it takes the car's speed (and then some: it's light), spinning; the car loses a little
            const k = mass / (mass + H.m);
            const v = new THREE.Vector3(vx * (1.1 + Math.random() * 0.4), 1.5 + sp * 0.18 + Math.random() * 2, vz * (1.1 + Math.random() * 0.4));
            v.x += -(lx / (hw + H.r)) * cy * sp * 0.3;
            v.z += (lx / (hw + H.r)) * sy * sp * 0.3;
            flying.push({ it, p: new THREE.Vector3(it.x, it.y, it.z), v, q: new THREE.Quaternion().setFromEuler(E.set(0, it.yaw, 0)), w: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 12), t: 0 });
            lost += sp * (1 - k);
            const P = fx.p;
            if (P) {
              // the clatter: bits and dust
              for (let n = 0; n < 6; n++) P.puff({ x: it.x, y: it.y + 0.4, z: it.z, vx: vx * 0.3 + (P.rand() - 0.5) * 3, vy: 0.8 + P.rand() * 1.5, vz: vz * 0.3 + (P.rand() - 0.5) * 3, life: 0.9 + P.rand(), s0: 0.15, s1: 1.0, a: 0.25, r: 0.5, g: 0.48, b: 0.45, drag: 2.2, grav: 0.2, floor: it.y, fadeIn: 0.02 });
              if (it.kind === 'hydrant') for (let n = 0; n < 10; n++) P.spark({ x: it.x, y: it.y + 0.2, z: it.z, vx: vx * 0.2 + (P.rand() - 0.5) * 6, vy: 1 + P.rand() * 3, vz: vz * 0.2 + (P.rand() - 0.5) * 6, life: 0.2 + P.rand() * 0.3, s0: 0.05, s1: 0.03, a: 1, r: 5, g: 3, b: 1.2, grav: 1, floor: it.y, stretch: 0.02, fadeIn: 0 });
            }
            if (it.kind === 'hydrant') geysers.push({ x: it.x, y: it.y, z: it.z, t: 30, acc: 0 });
          }
        }
      return lost;
    },
    update(dt, cam, night, t) {
      for (const k of culled) k.m.visible = k.c.distanceTo(cam) - k.r < k.far;
      adMat.emissiveIntensity = 0.15 + night * 2.2;
      // the tumbling ones: a ballistic arc and a spin, settling on their side where they land
      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i];
        f.t += dt;
        f.v.y -= 9.81 * dt;
        f.p.addScaledVector(f.v, dt);
        const floor = f.it.y + (HIT[f.it.kind]!.r * 0.8);
        q.setFromAxisAngle(p.copy(f.w).normalize(), f.w.length() * dt);
        f.q.premultiply(q);
        if (f.p.y < floor) {
          f.p.y = floor;
          f.v.y = Math.abs(f.v.y) * 0.25;
          f.v.x *= 0.6;
          f.v.z *= 0.6;
          f.w.multiplyScalar(0.55);
        }
        const done = f.t > 3 || (f.p.y <= floor + 0.01 && f.v.length() < 0.4);
        if (done) {
          // at rest: lying on its side, the way it was turning
          E.setFromQuaternion(f.q, 'YXZ');
          f.q.setFromEuler(E.set(Math.PI / 2, E.y, 0, 'YXZ'));
          f.p.y = f.it.y + HIT[f.it.kind]!.r * 0.7;
        }
        f.it.mesh.setMatrixAt(f.it.i, m4.compose(p.copy(f.p).add(new THREE.Vector3(0, -HIT[f.it.kind]!.h * 0.5, 0).applyQuaternion(f.q)), f.q, one));
        f.it.mesh.instanceMatrix.needsUpdate = true;
        f.it.mesh.computeBoundingSphere();
        if (done) flying.splice(i, 1);
      }
      // the broken hydrants: a column of white water, falling back as spray
      const P = fx.p;
      for (let i = geysers.length - 1; i >= 0; i--) {
        const g = geysers[i];
        g.t -= dt;
        if (g.t <= 0) {
          geysers.splice(i, 1);
          continue;
        }
        if (!P || Math.abs(g.x - cam.x) + Math.abs(g.z - cam.z) > 400) continue;
        const k = Math.min(1, g.t / 6);
        g.acc += dt * 70 * k;
        while (g.acc >= 1) {
          g.acc -= 1;
          const a = P.rand() * Math.PI * 2, r = P.rand() * 0.6;
          P.puff({
            x: g.x + Math.cos(a) * 0.08, y: g.y + 0.3, z: g.z + Math.sin(a) * 0.08,
            vx: Math.cos(a) * r, vy: (8 + P.rand() * 4) * (0.6 + 0.4 * k), vz: Math.sin(a) * r,
            life: 1.6 + P.rand() * 0.6, s0: 0.12, s1: 0.9 + P.rand() * 0.8, a: 0.42, r: 0.85, g: 0.9, b: 0.95,
            drag: 0.35, grav: 1, floor: g.y + 0.05, fadeIn: 0.02,
          });
        }
      }
      void t;
    },
  };
}

/** the shelters' adverts: a few made-up posters on one canvas (each lightbox shows one column) */
function adTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const ads: [string, string, string, string][] = [
    ['#0a7a8c', '#f6d365', 'SUNSET', 'RUM'],
    ['#1b1b2f', '#e94560', 'NIGHT', 'RADIO'],
    ['#f4f1de', '#e07a5f', 'BAY', 'FERRY'],
    ['#2d6a4f', '#ffffff', 'COCO', 'WATER'],
  ];
  ads.forEach(([bg, fg, a, b], i) => {
    const x = i * 128;
    g.fillStyle = bg;
    g.fillRect(x, 0, 128, 256);
    const gr = g.createLinearGradient(x, 0, x, 256);
    gr.addColorStop(0, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = gr;
    g.fillRect(x, 0, 128, 256);
    g.fillStyle = fg;
    g.beginPath();
    g.arc(x + 64, 95, 34, 0, Math.PI * 2);
    g.fill();
    g.font = 'bold 26px sans-serif';
    g.textAlign = 'center';
    g.fillText(a, x + 64, 180);
    g.font = '18px sans-serif';
    g.fillText(b, x + 64, 206);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
