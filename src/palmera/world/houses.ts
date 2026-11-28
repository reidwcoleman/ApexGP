// Suburban frontages: what turns a stucco box into a house from the street - a front door on a
// step (half of them under a little porch canopy on posts), a paved path out to the sidewalk, a
// concrete driveway beside the house where the car parks (some under a carport), a mailbox at the
// curb, a white picket fence along some fronts and an AC unit on the side wall. Merged per band
// along z so each band frustum-culls; nothing collides (all low or slim).
import * as THREE from 'three';
import { box, merge } from '../core/geo';
import { groundBase, type CityMap } from './map';
import { glowTexture } from './textures';

const DOORS = [0x6b4a32, 0x2f4f6f, 0x8a2e2e, 0x2e5d4b, 0xf2efe6, 0x3a3a3a];

const CELL = 120;

export function buildHouseFronts(scene: THREE.Scene, map: CityMap) {
  const cells = new Map<string, { x: number; z: number; list: THREE.BufferGeometry[]; pickets: number[]; slabs: number[]; lamps: THREE.BufferGeometry[]; pools: number[]; washes: number[] }>();
  // each house's wall height, from its building (the houses list only has the footprint)
  const wallH = new Map<string, number>();
  for (const b of map.buildings) if (b.style === 2 && b.y0 === 0) wallH.set(Math.round(b.x * 10) + ',' + Math.round(b.z * 10), b.h);
  for (const h of map.houses) {
    const cx = Math.floor(h.x / CELL), cz = Math.floor(h.z / CELL), key = cx + ',' + cz;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL, list: [], pickets: [], slabs: [], lamps: [], pools: [], washes: [] }));
    const pk = cell.pickets;
    const sl = cell.slabs;
    // a concrete top on a slab: al0..al1 across, o0..o1 along, at height up; per vertex x y z, u (m along), v (m across from the middle), kind
    const slab = (al0: number, al1: number, o0: number, o1: number, up: number, kind: number) => {
      const P = (al: number, o: number) => [h.x + h.ax * al + h.nx * o, y0 + up, h.z + h.az * al + h.nz * o];
      const mid = (al0 + al1) / 2;
      const V = (al: number, o: number) => [...P(al, o), o - o0, al - mid, kind];
      const A = V(al0, o0), B = V(al1, o0), C = V(al1, o1), D = V(al0, o1);
      const up_ = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
      if (up_ > 0) sl.push(...A, ...B, ...C, ...A, ...C, ...D);
      else sl.push(...A, ...C, ...B, ...A, ...D, ...C);
    };
    const out = cell.list;
    const y0 = groundBase(h.x, h.z);
    let r = h.seed * 9973;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647) % 1;
    rnd();
    // a box in house space: 'al' along the street, 'up', 'o' out from the front wall toward the street
    const hb = (al: number, up: number, o: number, w: number, hh: number, d: number, c: number, paved = false) => {
      const x = h.x + h.ax * al + h.nx * o, z = h.z + h.az * al + h.nz * o;
      out.push(h.ax ? box(w, hh, d, x, y0 + up, z, c) : box(d, hh, w, x, y0 + up, z, c));
      if (paved) {
        const sx = (h.ax ? w : d) / 2, sz = (h.ax ? d : w) / 2;
        map.paved.push({ x0: x - sx, z0: z - sz, x1: x + sx, z1: z + sz });
      }
    };
    const front = h.hd;
    const setback = 6;
    // centred between the two front windows (the facade shader puts them 1.08-2.52 m either side of the
    // middle): anywhere else the door, its frame or a porch post stood in front of the glass
    const doorAl = (rnd() - 0.5) * 0.12;
    // door, frame and step
    hb(doorAl, 1.08, front + 0.05, 1.0, 2.1, 0.1, DOORS[Math.floor(rnd() * DOORS.length)]);
    hb(doorAl, 1.15, front + 0.03, 1.25, 2.3, 0.06, 0xf4f1ea);
    hb(doorAl, 0.08, front + 0.7, 2.0, 0.16, 1.4, 0xcfc9bd);
    // a porch lantern beside the door (on two houses in three, the side by the drive), and the pool of
    // light it throws on the step and path after dark
    if (rnd() < 0.67) {
      const side = h.drive ? 1 : -1;
      const la = doorAl + side * 0.85;
      const x = h.x + h.ax * la + h.nx * (front + 0.1), z = h.z + h.az * la + h.nz * (front + 0.1);
      cell.list.push(h.ax ? box(0.12, 0.12, 0.06, x - h.nx * 0.04, y0 + 2.0, z - h.nz * 0.04, 0x2a2a2a) : box(0.06, 0.12, 0.12, x - h.nx * 0.04, y0 + 2.0, z - h.nz * 0.04, 0x2a2a2a));
      cell.lamps.push(h.ax ? box(0.14, 0.22, 0.14, x, y0 + 1.9, z, 0xffffff) : box(0.14, 0.22, 0.14, x, y0 + 1.9, z, 0xffffff));
      cell.list.push(box(0.16, 0.04, 0.16, x, y0 + 2.03, z, 0x2a2a2a));
      const px = h.x + h.ax * (doorAl + side * 0.3) + h.nx * (front + 1.3), pz = h.z + h.az * (doorAl + side * 0.3) + h.nz * (front + 1.3);
      cell.pools.push(px, y0 + 0.075, pz);
      // the wash of light on the wall round it, facing out from the front
      cell.washes.push(x - h.nx * 0.07, y0 + 1.85, z - h.nz * 0.07, Math.atan2(h.nx, h.nz));
    }
    // a porch canopy on two posts
    if (rnd() < 0.5) {
      hb(doorAl, 2.62, front + 0.85, 1.6, 0.14, 1.8, 0xf4f1ea);
      for (const s of [-1, 1]) hb(doorAl + s * 0.62, 1.3, front + 1.65, 0.12, 2.6, 0.12, 0xf4f1ea);
    }
    // a paved path to the sidewalk
    hb(doorAl, 0.025, front + (setback + 1.4) / 2, 1.2, 0.05, setback - 1.4, 0xd8d2c6, true);
    slab(doorAl - 0.6, doorAl + 0.6, front + 1.4, front + setback, 0.052, 1);
    // driveway beside the house, maybe under a carport
    const dAl = h.hw + 2.2;
    if (h.drive) {
      hb(dAl, 0.03, front - h.hd + (setback + 2 * h.hd) / 2 - 0.5, 3.4, 0.06, setback + 2 * h.hd - 1, 0xbdb8ae, true);
      {
        const oc = front - h.hd + (setback + 2 * h.hd) / 2 - 0.5, L = setback + 2 * h.hd - 1;
        slab(dAl - 1.7, dAl + 1.7, oc - L / 2, oc + L / 2, 0.062, 0);
      }
      if (rnd() < 0.4) {
        hb(dAl, 2.5, front - 1.5, 3.8, 0.12, 6.5, 0xf4f1ea);
        for (const sa of [-1.75, 1.75]) for (const so of [-4.5, 1.5]) hb(dAl + sa, 1.25, front + so, 0.12, 2.5, 0.12, 0xf4f1ea);
      }
    }
    // mailbox at the curb, by the driveway (or the path)
    const mAl = h.drive ? dAl - 2.1 : doorAl + 1.0;
    hb(mAl, 0.55, front + setback - 0.4, 0.08, 1.1, 0.08, 0x3a3a3a);
    hb(mAl, 1.15, front + setback - 0.4, 0.22, 0.22, 0.42, rnd() < 0.5 ? 0x2a2a2a : 0xf2efe6);
    // a white picket fence along the front, with gaps for the path and the drive
    if (rnd() < 0.35) {
      const fo = front + setback - 1.0;
      const segs: [number, number][] = [[-h.hw - 0.5, doorAl - 0.8], [doorAl + 0.8, h.drive ? dAl - 1.9 : h.hw + 0.5]];
      for (const [a, b] of segs) {
        if (b - a < 0.5) continue;
        // a picket fence: two rails on the posts, and the pickets as one alpha-cut panel in front of them
        // (not one box a picket - that was ~40k boxes)
        for (const ry of [0.22, 0.68]) hb((a + b) / 2, ry, fo - 0.035, b - a, 0.07, 0.035, 0xeeebe4);
        for (let p = a; p <= b + 0.01; p += Math.max(1.2, (b - a) / Math.ceil((b - a) / 1.6))) hb(p, 0.5, fo - 0.035, 0.09, 1.0, 0.09, 0xf7f5f0);
        // the panel: a quad from a to b, 0.03..0.98 m, u in pickets (0.15 m each)
        const P = (al: number, up: number) => [h.x + h.ax * al + h.nx * fo, y0 + up, h.z + h.az * al + h.nz * fo];
        const q = [P(a, 0.03), P(b, 0.03), P(b, 0.98), P(a, 0.98)];
        const u1 = (b - a) / 0.15;
        pk.push(...q[0], 0, 0, ...q[1], u1, 0, ...q[2], u1, 1, ...q[0], 0, 0, ...q[2], u1, 1, ...q[3], 0, 1);
      }
    }
    // gutters under the front and back eaves, a downpipe at each end of them
    const H = wallH.get(Math.round(h.x * 10) + ',' + Math.round(h.z * 10));
    if (H) {
      const gc = rnd() < 0.6 ? 0xf2f0ea : 0x8b8f92;
      for (const s of [-1, 1]) {
        hb(0, H - 0.07, s * (front + 0.47), 2 * h.hw + 0.62, 0.12, 0.12, gc);
        for (const e of [-1, 1]) hb(e * (h.hw - 0.12), (H - 0.1) / 2, s * (front + 0.06), 0.07, H - 0.1, 0.07, gc);
      }
    }
    // an AC unit against the side wall away from the drive
    hb(-h.hw - 0.4, 0.45, -h.hd * 0.3, 0.7, 0.8, 0.8, 0xc9ccce);
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const slabMat = concreteSlabMaterial();
  // the lantern glass: warm and bright after dark, a dull pale shade by day
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.4, emissive: 0xffb866, emissiveIntensity: 0 });
  const poolGeo = new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2);
  const washGeo = new THREE.PlaneGeometry(1.4, 1.4);
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffa860, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const washMat = poolMat.clone();
  const picketMat = new THREE.MeshStandardMaterial({ map: picketTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
  const chunks: { m: THREE.Mesh; x: number; z: number }[] = [];
  for (const c of cells.values()) {
    const m = new THREE.Mesh(merge(c.list), mat);
    chunks.push({ m, x: c.x, z: c.z });
    m.name = "houseFronts";
    // no shadow-pass cost for all this; AO grounds it
    m.castShadow = false;
    m.receiveShadow = true;
    scene.add(m);
    if (c.lamps.length) {
      const lm = new THREE.Mesh(merge(c.lamps), lanternMat);
      scene.add(lm);
      chunks.push({ m: lm, x: c.x, z: c.z });
    }
    if (c.pools.length) {
      const n = c.pools.length / 3;
      const im = new THREE.InstancedMesh(poolGeo, poolMat, n);
      const m4 = new THREE.Matrix4();
      for (let i = 0; i < n; i++) im.setMatrixAt(i, m4.makeTranslation(c.pools[i * 3], c.pools[i * 3 + 1], c.pools[i * 3 + 2]));
      im.renderOrder = 2;
      scene.add(im);
      chunks.push({ m: im, x: c.x, z: c.z });
    }
    if (c.washes.length) {
      const n = c.washes.length / 4;
      const im = new THREE.InstancedMesh(washGeo, washMat, n);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < n; i++) {
        const w = c.washes.slice(i * 4, i * 4 + 4);
        im.setMatrixAt(i, m4.compose(new THREE.Vector3(w[0], w[1], w[2]), q.setFromAxisAngle(up, w[3]), one));
      }
      im.renderOrder = 2;
      scene.add(im);
      chunks.push({ m: im, x: c.x, z: c.z });
    }
    if (c.slabs.length) {
      const n = c.slabs.length / 6;
      const pos = new Float32Array(n * 3), drv = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos.set(c.slabs.slice(i * 6, i * 6 + 3), i * 3);
        drv.set(c.slabs.slice(i * 6 + 3, i * 6 + 6), i * 3);
        nor[i * 3 + 1] = 1;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('aDrv', new THREE.BufferAttribute(drv, 3));
      const sm = new THREE.Mesh(g, slabMat);
      sm.receiveShadow = true;
      scene.add(sm);
      chunks.push({ m: sm, x: c.x, z: c.z });
    }
    if (c.pickets.length) {
      const g = new THREE.BufferGeometry();
      const n = c.pickets.length / 5;
      const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        pos.set(c.pickets.slice(i * 5, i * 5 + 3), i * 3);
        uv.set(c.pickets.slice(i * 5 + 3, i * 5 + 5), i * 2);
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const pm = new THREE.Mesh(g, picketMat);
      pm.castShadow = true;
      pm.receiveShadow = true;
      scene.add(pm);
      chunks.push({ m: pm, x: c.x, z: c.z });
    }
  }
  /** small stuff: each 120 m cell only within 240 m of the camera */
  return {
    update(cam: THREE.Vector3, night = 0) {
      for (const c of chunks) c.m.visible = Math.hypot(c.x - cam.x, c.z - cam.z) < 240 + CELL * 0.7;
      const on = Math.min(1, Math.max(0, (night - 0.2) / 0.5));
      lanternMat.emissiveIntensity = on * 3.2;
      poolMat.opacity = on * 0.42;
      washMat.opacity = on * 0.3;
    },
  };
}

/** one picket per tile (0.15 m): a 9 cm painted board with a pointed top, a gap either side */
function picketTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 64, 256);
  // board 0.09 of 0.15 m -> 38 px of 64, centred; point over the top 10% ; slight grain and an edge shade
  const l = 13, r = 51;
  const g = x.createLinearGradient(l, 0, r, 0);
  g.addColorStop(0, '#e4e0d8');
  g.addColorStop(0.15, '#f6f4ef');
  g.addColorStop(0.85, '#f3f1ea');
  g.addColorStop(1, '#d9d5cc');
  x.fillStyle = g;
  x.beginPath();
  x.moveTo(l, 256);
  x.lineTo(l, 28);
  x.lineTo(32, 2);
  x.lineTo(r, 28);
  x.lineTo(r, 256);
  x.closePath();
  x.fill();
  x.globalAlpha = 0.07;
  x.fillStyle = '#6b6152';
  for (let i = 0; i < 26; i++) x.fillRect(l + 2 + Math.random() * (r - l - 4), 30 + Math.random() * 200, 1, 10 + Math.random() * 40);
  // a little dirt splashed up the bottom
  const d = x.createLinearGradient(0, 256, 0, 200);
  d.addColorStop(0, 'rgba(110,96,70,0.9)');
  d.addColorStop(1, 'rgba(110,96,70,0)');
  x.globalAlpha = 0.25;
  x.globalCompositeOperation = 'source-atop';
  x.fillStyle = d;
  x.fillRect(0, 200, 64, 56);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/**
 * Poured concrete on drives (kind 0) and paths (kind 1), in the slab's own metres: a mottled pale
 * grey with fine aggregate, saw-cut joints (every 3 m and down the middle of a drive, every 1.2 m on a
 * path), and on drives two worn tyre tracks and oil stains down the middle where the car stands, with
 * grime along the edges. Detail fades to its average once it's sub-pixel.
 */
function concreteSlabMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aDrv; varying vec3 vDrv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDrv = aDrv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vDrv;
float csH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float csN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(csH(i), csH(i + vec2(1.0, 0.0)), f.x), mix(csH(i + vec2(0.0, 1.0)), csH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float u = vDrv.x, v = vDrv.y;
  bool path = vDrv.z > 0.5;
  vec2 p = vec2(u, v);
  float fw = fwidth(u) + fwidth(v);
  float fine = 1.0 - smoothstep(0.01, 0.05, fw);
  vec3 c = vec3(0.63, 0.62, 0.59) * (0.86 + 0.22 * csN(p * 0.6 + 3.0)) * (0.93 + 0.1 * csN(p * 2.3)) * mix(vec3(1.0), vec3(1.03, 1.0, 0.95), csN(p * 0.25 + 9.0));
  c *= mix(1.0, 0.9 + 0.2 * csH(floor(p * 90.0)), fine * 0.6);
  // saw-cut joints
  float step_ = path ? 1.2 : 3.0;
  float jw = 0.01;
  float ju = 1.0 - smoothstep(jw, jw + fw * 0.7, abs(fract(u / step_ + 0.5) - 0.5) * step_);
  float jv = path ? 0.0 : 1.0 - smoothstep(jw, jw + fw * 0.7, abs(v));
  float joint = max(ju, jv) * (1.0 - smoothstep(0.02, 0.08, fw));
  c *= 1.0 - 0.45 * joint;
  if (!path) {
    // tyre tracks, and oil dripped down the middle
    float track = smoothstep(0.35, 0.0, abs(abs(v) - 0.8));
    c *= 1.0 - 0.14 * track * (0.6 + 0.4 * csN(p * vec2(0.3, 3.0)));
    float oil = smoothstep(0.58, 0.78, csN(p * vec2(0.55, 1.6) + 11.0) * 0.75 + csN(p * 2.7) * 0.25) * (1.0 - smoothstep(0.25, 0.6, abs(v)));
    c = mix(c, vec3(0.25, 0.23, 0.2), oil * 0.55);
  }
  // grime along the edges
  float e = (path ? 0.6 : 1.7) - abs(v);
  c *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.25, e));
  diffuseColor.rgb = c;
}`);
  };
  m.customProgramCacheKey = () => 'palmera-slab-v2';
  return m;
}
