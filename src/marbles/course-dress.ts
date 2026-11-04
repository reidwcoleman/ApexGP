import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CourseBuilder, Path } from './builder.ts';
import { OUTFITS } from './bean.ts';
import { biome, type BiomeId } from './biome.ts';

/**
 * The show round a platform course: an inflatable arch over the way where each zone starts (in
 * that zone's colour), big inflatable arrows on the outside of every turn, little floating islands
 * beside the course each holding a giant toy (gumdrops, lollipops, donuts, beach balls, cupcakes,
 * dice, presents, ice creams, stars), and grandstands full of beans bouncing and waving as the
 * field goes by. Scenery only: no colliders, nothing the bots need to know about. Painted in
 * vertex colours (per triangle, so the stripes are crisp) on one glossy inflatable material, the
 * still parts merged by area into a handful of meshes.
 */

const TOY = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.75, clearcoatRoughness: 0.18, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff) });
const C = new THREE.Color();

/** paints each triangle by its centroid (local coordinates) */
function paint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number) => number) {
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    C.set(fn(x, y, z));
    for (let k = 0; k < 3; k++) C.toArray(col, (i + k) * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal', 'color'].includes(k)) ng.deleteAttribute(k);
  return ng;
}
const solid = (g: THREE.BufferGeometry, c: number) => paint(g, () => c);
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) => g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s)));
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs, false)!;

const BRIGHT = [0xff4f7a, 0x2fa8ff, 0xffcf2a, 0x37c25a, 0x9a5bff, 0xff8a1f, 0x1fc8c0, 0xff5fcf];
const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length) % a.length];

// ------------------------------------------------------------------------------------ the toys
type Toy = (r: () => number) => { g: THREE.BufferGeometry; spin?: number; bob?: number; h: number };
const TOYS: Toy[] = [
  // a gumdrop with sugar on it
  (r) => {
    const c = pick(r, BRIGHT);
    const prof = [[0.001, 0], [2.3, 0], [2.4, 0.3], [2.2, 1.4], [1.7, 2.6], [1.0, 3.3], [0.001, 3.55]].map(([x, y]) => new THREE.Vector2(x, y));
    const gs = [solid(new THREE.LatheGeometry(new THREE.SplineCurve(prof).getPoints(20), 40), c)];
    for (let k = 0; k < 26; k++) {
      const a = r() * Math.PI * 2, y = 0.3 + r() * 2.8;
      const rr = 2.3 - (y / 3.4) * 1.6;
      gs.push(at(solid(new THREE.SphereGeometry(0.11, 6, 4), 0xffffff), Math.cos(a) * rr, y, Math.sin(a) * rr));
    }
    return { g: merge(gs), h: 3.5 };
  },
  // a lollipop on its stick
  (r) => {
    const a = pick(r, BRIGHT), b = 0xffffff;
    const face = (sgn: number) => at(paint(new THREE.RingGeometry(0.02, 2.3, 72, 14), (x, y) => (Math.floor((Math.atan2(y, x) / (Math.PI * 2)) * 6 + Math.hypot(x, y) * 1.1 + 12) % 2 ? a : b)), 0, 0, sgn * 0.32, 0, sgn < 0 ? Math.PI : 0, 0);
    const rim = solid(new THREE.CylinderGeometry(2.3, 2.3, 0.64, 72, 1, true).rotateX(Math.PI / 2), a);
    const head = merge([face(1), face(-1), rim]);
    at(head, 0, 5.4, 0);
    return { g: merge([head, solid(new THREE.CylinderGeometry(0.16, 0.16, 5.2, 12), 0xfff6e8).translate(0, 2.6, 0)]), spin: 0.4, h: 7.7 };
  },
  // a frosted donut with sprinkles, stood on edge
  (r) => {
    const icing = pick(r, [0xff7ab8, 0x8a5232, 0xfff2f8, 0x9a7bff, 0x6fe0c0]);
    const g0 = paint(new THREE.TorusGeometry(1.9, 0.95, 24, 48), (x, y, z) => (z > 0.15 + Math.sin(Math.atan2(y, x) * 9) * 0.12 ? icing : 0xe7a65a));
    const gs = [g0];
    for (let k = 0; k < 40; k++) {
      const a = r() * Math.PI * 2, b = r() * 1.3;
      const R = 1.9 + Math.cos(b) * 0.97;
      const sp = solid(new THREE.CapsuleGeometry(0.05, 0.22, 2, 6), pick(r, BRIGHT));
      sp.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3)));
      gs.push(at(sp, Math.cos(a) * R, Math.sin(a) * R, Math.sin(b) * 0.97));
    }
    const d = merge(gs);
    at(d, 0, 3.1, 0, 0, 0, 0);
    return { g: d, spin: 0.25, h: 6 };
  },
  // a beach ball
  (r) => {
    const cs = [pick(r, BRIGHT), 0xffffff, pick(r, BRIGHT), 0xffffff, pick(r, BRIGHT), 0xffffff];
    const g = paint(new THREE.SphereGeometry(2.2, 48, 28), (x, y, z) => (Math.abs(y) > 2.05 ? 0xffffff : cs[Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 6) % 6]));
    g.translate(0, 2.2, 0);
    return { g, spin: 0.3, bob: 0.25, h: 4.4 };
  },
  // a cupcake: a pleated wrapper, a swirl of frosting, a cherry
  (r) => {
    const w = pick(r, BRIGHT), fr = pick(r, [0xfff2f8, 0xff9ccf, 0xb7f0d8, 0xd8c2ff, 0x8a5232]);
    const gs = [paint(new THREE.CylinderGeometry(2.0, 1.5, 2.2, 48, 2), (x, _y, z) => (Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 24) % 2 ? w : 0xffffff)).translate(0, 1.1, 0)];
    [[2.0, 2.45], [1.55, 3.15], [1.05, 3.75], [0.55, 4.2]].forEach(([R, y]) => gs.push(solid(new THREE.TorusGeometry(R, 0.48, 14, 40).rotateX(Math.PI / 2), fr).translate(0, y, 0)));
    gs.push(solid(new THREE.SphereGeometry(0.42, 16, 12), 0xe8202f).translate(0, 4.95, 0));
    return { g: merge(gs), h: 5.4 };
  },
  // a die, tipped on one corner of an edge
  (r) => {
    const S = 3.0, h = S / 2;
    const gs = [solid(new RoundedBoxGeometry(S, S, S, 4, 0.45), 0xfdf8f0)];
    const pipC = pick(r, [0xe8202f, 0x26283a, 0x2f74ff]);
    const pip = (x: number, y: number, z: number, n: THREE.Vector3) => {
      const g = solid(new THREE.SphereGeometry(0.26, 12, 8).scale(1, 1, 0.35), pipC);
      g.lookAt(n);
      gs.push(g.translate(x, y, z));
    };
    const d = 0.75;
    pip(0, 0, h, new THREE.Vector3(0, 0, 1));
    for (const [x, y] of [[-d, -d], [d, d]]) pip(h, x, y, new THREE.Vector3(1, 0, 0));
    for (const [x, z] of [[-d, -d], [d, d], [-d, d], [d, -d], [0, 0]]) pip(x, h, z, new THREE.Vector3(0, 1, 0));
    for (const [y, z] of [[-d, -d], [d, d], [-d, d], [d, -d]]) pip(-h, y, z, new THREE.Vector3(-1, 0, 0));
    for (const [x, y] of [[-d, -d], [d, d], [-d, d], [d, -d], [-d, 0], [d, 0]]) pip(x, y, -h, new THREE.Vector3(0, 0, -1));
    const g = merge(gs);
    g.rotateZ(0.35).rotateX(0.25).translate(0, h * 1.25, 0);
    return { g, spin: 0.2, bob: 0.3, h: S * 1.3 };
  },
  // a present with a ribbon and a bow
  (r) => {
    const box = pick(r, BRIGHT), rib = pick(r, [0xffffff, 0xffd23a, 0xff4f7a]);
    const gs = [paint(new RoundedBoxGeometry(3.2, 2.6, 3.2, 3, 0.25), (x, _y, z) => (Math.abs(x) < 0.32 || Math.abs(z) < 0.32 ? rib : box)).translate(0, 1.3, 0)];
    for (const s of [-1, 1]) gs.push(solid(new THREE.TorusGeometry(0.55, 0.2, 10, 24).scale(1, 0.75, 1), rib).rotateY((s * Math.PI) / 4).translate(s * 0.4, 2.95, 0));
    gs.push(solid(new THREE.SphereGeometry(0.3, 12, 8), rib).translate(0, 2.75, 0));
    return { g: merge(gs), h: 3.3 };
  },
  // an ice cream cone, two scoops
  (r) => {
    const gs = [paint(new THREE.ConeGeometry(1.35, 3.6, 40, 8).rotateX(Math.PI), (x, y, z) => ((Math.floor((Math.atan2(z, x) * 2.5 + y * 2.2) % 2) + Math.floor((Math.atan2(z, x) * 2.5 - y * 2.2) % 2)) & 1 ? 0xd9944a : 0xf0b670)).translate(0, 1.8, 0)];
    const s1 = pick(r, [0xff9ccf, 0xb7f0d8, 0xfff2c8, 0x8a5232, 0xd8c2ff]), s2 = pick(r, [0xff9ccf, 0xb7f0d8, 0xfff2c8, 0xffcf6a]);
    gs.push(solid(new THREE.SphereGeometry(1.5, 28, 18), s1).translate(0, 4.0, 0));
    gs.push(solid(new THREE.TorusGeometry(1.35, 0.3, 10, 32).rotateX(Math.PI / 2), s1).translate(0, 3.5, 0));
    gs.push(solid(new THREE.SphereGeometry(1.25, 28, 18), s2).translate(0.1, 5.6, 0.05));
    gs.push(solid(new THREE.SphereGeometry(0.32, 12, 8), 0xe8202f).translate(0.2, 6.9, 0.1));
    return { g: merge(gs), h: 7.2 };
  },
  // a fat star, turning
  (r) => {
    const sh = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + Math.PI / 2, rr = k % 2 ? 1.05 : 2.4;
      if (k === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    sh.closePath();
    const c = pick(r, [0xffd23a, 0xffd23a, 0xff5fcf, 0x5fd0ff]);
    const g = solid(new THREE.ExtrudeGeometry(sh, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.35, bevelSize: 0.3, bevelSegments: 4 }).translate(0, 0, -0.3), c);
    g.translate(0, 3.6, 0);
    return { g, spin: 0.6, bob: 0.35, h: 6 };
  },
];

// ------------------------------------------------------------------------ each world's own toys
const rib = (n: number, a: number, b: number) => (x: number, _y: number, z: number) => (Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * n) % 2 ? a : b);
const palmToy: Toy = (r) => {
  const gs: THREE.BufferGeometry[] = [];
  const lean = 0.5 + r() * 0.6;
  let x = 0, y = 0;
  for (let i = 0; i < 6; i++) {
    gs.push(solid(new THREE.CylinderGeometry(0.28 - i * 0.02, 0.32 - i * 0.02, 1.25, 10), i % 2 ? 0xa8743e : 0x8f6232).translate(x, y + 0.62, 0));
    x += lean * 0.12 * i;
    y += 1.2;
  }
  for (let k = 0; k < 7; k++) {
    const leaf = solid(new THREE.ConeGeometry(0.55, 3.4, 4, 1).scale(1, 1, 0.22), k % 2 ? 0x2fae4a : 0x45c860).translate(0, 1.7, 0);
    leaf.rotateZ(1.75).rotateY((k / 7) * Math.PI * 2);
    gs.push(leaf.translate(x, y, 0));
  }
  gs.push(solid(new THREE.SphereGeometry(0.32, 10, 8), 0x7a5228).translate(x + 0.3, y - 0.3, 0.2), solid(new THREE.SphereGeometry(0.32, 10, 8), 0x7a5228).translate(x - 0.25, y - 0.35, -0.2));
  return { g: merge(gs), h: y + 1 };
};
const pumpkinToy = (face: boolean): Toy => () => {
  const gs = [paint(new THREE.SphereGeometry(2.2, 32, 18).scale(1, 0.82, 1), rib(12, 0xff8a1a, 0xf27410)).translate(0, 1.8, 0), solid(new THREE.CylinderGeometry(0.22, 0.35, 0.9, 8).rotateZ(0.2), 0x4a7a2a).translate(0, 3.7, 0)];
  if (face) {
    const dark = 0x2a1206;
    for (const s2 of [-1, 1]) gs.push(solid(new THREE.ConeGeometry(0.42, 0.6, 3).rotateX(Math.PI / 2).scale(1, 1, 0.3), dark).translate(s2 * 0.75, 2.35, 2.05));
    gs.push(solid(new THREE.BoxGeometry(1.6, 0.35, 0.3), dark).translate(0, 1.35, 2.0));
  }
  return { g: merge(gs), h: 4 };
};
const crystalToy = (cs: number[]): Toy => (r) => {
  const gs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const h = 1.8 + r() * 3.2;
    gs.push(solid(new THREE.ConeGeometry(0.45 + r() * 0.4, h, 6), pick(r, cs)).translate(0, h / 2, 0).rotateZ((r() - 0.5) * 0.9).rotateY(r() * 6).translate((r() - 0.5) * 1.6, 0, (r() - 0.5) * 1.6));
  }
  return { g: merge(gs), h: 4.5 };
};
const treeToy = (leaves: number[], trunk = 0x7a5232): Toy => (r) => {
  const gs = [solid(new THREE.CylinderGeometry(0.3, 0.45, 3.4, 10), trunk).translate(0, 1.7, 0)];
  for (let i = 0; i < 5; i++) gs.push(solid(new THREE.IcosahedronGeometry(1.1 + r() * 0.6, 1), pick(r, leaves)).translate((r() - 0.5) * 1.6, 3.6 + r() * 1.6, (r() - 0.5) * 1.6));
  return { g: merge(gs), h: 6 };
};
const pineToy = (snow: boolean): Toy => () => {
  const gs = [solid(new THREE.CylinderGeometry(0.25, 0.32, 1.4, 8), 0x6a4a30).translate(0, 0.7, 0)];
  [[2.0, 1.2], [1.6, 2.6], [1.15, 3.9], [0.7, 5.0]].forEach(([R0, y]) => gs.push(paint(new THREE.ConeGeometry(R0, 2.0, 10), (_x, yy) => (snow && yy > 0.25 ? 0xffffff : 0x2a7a4a)).translate(0, y + 0.6, 0)));
  return { g: merge(gs), h: 6.4 };
};
const BIOME_TOYS: Partial<Record<BiomeId, Toy[]>> = {
  blossom: [
    treeToy([0xffb8d4, 0xffc8e0, 0xff9ac0, 0xffffff], 0x5a3a34),
    treeToy([0xffc8e0, 0xffd8e8, 0xff9ac0], 0x5a3a34),
    // a stone lantern
    () => ({ g: merge([solid(new THREE.CylinderGeometry(0.7, 0.9, 0.4, 8), 0xb8b0a8).translate(0, 0.2, 0), solid(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 8), 0xb8b0a8).translate(0, 1.2, 0), solid(new THREE.BoxGeometry(1.0, 0.8, 1.0), 0xfff0c0).translate(0, 2.4, 0), solid(new THREE.ConeGeometry(1.0, 0.7, 4).rotateY(Math.PI / 4), 0x8a8078).translate(0, 3.15, 0)]), h: 3.5 }),
  ],
  storm: [
    // a striped buoy with a lamp
    (r) => ({ g: merge([paint(new THREE.CylinderGeometry(0.9, 1.3, 2.6, 16), (_x, y) => (Math.floor(y * 1.5 + 4) % 2 ? 0xffcf2a : 0x1d1b22)).translate(0, 1.3, 0), solid(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6), 0x3a3a40).translate(0, 3.3, 0), solid(new THREE.SphereGeometry(0.3, 10, 8), 0xffe090).translate(0, 4.1, 0)]), h: 4.4, bob: 0.2 + r() * 0.2 }),
    // a weathered rock with a gull
    (r) => ({ g: merge([solid(new THREE.DodecahedronGeometry(1.8 + r(), 0).scale(1, 0.7, 1), 0x5a6068).translate(0, 0.9, 0), solid(new THREE.SphereGeometry(0.28, 8, 6), 0xffffff).translate(0.2, 2.2, 0)]), h: 2.6 }),
  ],
  reef: [
    palmToy,
    crystalToy([0xff6a8a, 0xffa040, 0xb06aff, 0x40e0c0]),
    // a giant clam
    (r) => ({ g: merge([paint(new THREE.SphereGeometry(1.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1), rib(14, 0xb8a0ff, 0xd8c8ff)).translate(0, 0.3, 0), paint(new THREE.SphereGeometry(1.8, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1).rotateX(-2.2), rib(14, 0xb8a0ff, 0xd8c8ff)).translate(0, 0.5, -1.2), solid(new THREE.SphereGeometry(0.45, 14, 10), 0xffffff).translate(0, 0.7, 0.2)]), h: 2.4 }),
  ],
  clockwork: [
    // a gear on a stand, turning
    (r) => {
      const gs = [solid(new THREE.CylinderGeometry(0.2, 0.3, 3, 8), 0x3a2a20).translate(0, 1.5, 0)];
      const n = 12, R = 1.6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        gs.push(solid(new THREE.BoxGeometry(0.45, 0.5, 0.4), 0xd89a3a).translate(Math.cos(a) * R, 3.4 + Math.sin(a) * R, 0).rotateZ(0));
      }
      gs.push(paint(new THREE.TorusGeometry(R * 0.85, 0.35, 8, 24), () => 0xd89a3a).translate(0, 3.4, 0), solid(new THREE.CylinderGeometry(0.4, 0.4, 0.6, 12).rotateX(Math.PI / 2), 0x8a5a2a).translate(0, 3.4, 0));
      return { g: merge(gs), h: 5.4, spin: 0.4 + r() * 0.4 };
    },
    // a boiler with a chimney
    () => ({ g: merge([solid(new THREE.CylinderGeometry(1.2, 1.2, 2.6, 16).rotateZ(Math.PI / 2), 0xc89040).translate(0, 1.3, 0), solid(new THREE.CylinderGeometry(0.35, 0.4, 2.4, 10), 0x3a2a20).translate(0.8, 3.0, 0), solid(new THREE.TorusGeometry(1.22, 0.1, 6, 20).rotateY(Math.PI / 2), 0x8a5a2a).translate(0.6, 1.3, 0), solid(new THREE.TorusGeometry(1.22, 0.1, 6, 20).rotateY(Math.PI / 2), 0x8a5a2a).translate(-0.6, 1.3, 0)]), h: 4.2 }),
  ],
  disco: [
    // a speaker on a stand
    (r) => ({ g: merge([solid(new THREE.BoxGeometry(1.8, 2.8, 1.5), 0x18102a).translate(0, 1.4, 0), solid(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 18).rotateX(Math.PI / 2), pick(r, BRIGHT)).translate(0, 1.0, 0.78), solid(new THREE.CylinderGeometry(0.32, 0.32, 0.14, 16).rotateX(Math.PI / 2), pick(r, BRIGHT)).translate(0, 2.2, 0.78)]), h: 2.8 }),
    // a mirror ball on a pole
    (r) => ({ g: merge([solid(new THREE.CylinderGeometry(0.08, 0.14, 3.2, 8), 0xc8c8d8).translate(0, 1.6, 0), solid(new THREE.IcosahedronGeometry(1.0, 1), 0xe8e8f8).translate(0, 3.9, 0)]), h: 4.9, spin: 0.5 + r() * 0.4 }),
  ],
  circus: [
    // a striped tent
    (r) => {
      const a = pick(r, [0xe8283a, 0x2f6aff, 0xffc21f, 0x37c25a]);
      return { g: merge([paint(new THREE.CylinderGeometry(2.2, 2.2, 1.8, 16, 1, true), rib(12, a, 0xffffff)).translate(0, 0.9, 0), paint(new THREE.ConeGeometry(2.6, 2.2, 16, 1, true), rib(12, a, 0xffffff)).translate(0, 2.9, 0), solid(new THREE.SphereGeometry(0.2, 10, 8), 0xffc21f).translate(0, 4.1, 0)]), h: 4.3 };
    },
    // a drum with a ball on it
    (r) => ({ g: merge([paint(new THREE.CylinderGeometry(1.3, 1.5, 1.4, 20), rib(10, 0xe8283a, 0xffc21f)).translate(0, 0.7, 0), solid(new THREE.SphereGeometry(0.9, 18, 12), pick(r, BRIGHT)).translate(0, 2.3, 0)]), h: 3.2, spin: 0.3 }),
  ],
  pirate: [
    palmToy,
    // a barrel
    () => ({ g: merge([solid(new THREE.CylinderGeometry(0.95, 0.95, 2.0, 16), 0x8a5a2e).translate(0, 1.0, 0), solid(new THREE.TorusGeometry(1.0, 0.07, 6, 20).rotateX(Math.PI / 2), 0x3a2a20).translate(0, 0.5, 0), solid(new THREE.TorusGeometry(1.0, 0.07, 6, 20).rotateX(Math.PI / 2), 0x3a2a20).translate(0, 1.5, 0)]), h: 2.0 }),
    // a chest of gold
    () => ({ g: merge([solid(new THREE.BoxGeometry(2.0, 1.1, 1.4), 0x7a4a24).translate(0, 0.55, 0), solid(new THREE.SphereGeometry(0.9, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 0.5, 0.72), 0xffc830).translate(0, 1.1, 0)]), h: 1.6 }),
  ],
  toybox: [
    // a stack of blocks
    (r) => ({ g: merge([solid(new THREE.BoxGeometry(2.2, 1.3, 2.2), pick(r, BRIGHT)).translate(0, 0.65, 0), solid(new THREE.BoxGeometry(1.6, 1.2, 1.6).rotateY(0.5), pick(r, BRIGHT)).translate(0, 1.9, 0), solid(new THREE.ConeGeometry(0.9, 1.4, 4).rotateY(0.3), pick(r, BRIGHT)).translate(0, 3.2, 0)]), h: 3.9 }),
    // a spinning top
    (r) => {
      const a = pick(r, BRIGHT);
      return { g: merge([paint(new THREE.ConeGeometry(1.4, 1.6, 20).rotateX(Math.PI), rib(10, a, 0xffffff)).translate(0, 0.8, 0), paint(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 20), rib(10, a, 0xffffff)).translate(0, 1.7, 0), solid(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 8), 0xffffff).translate(0, 2.3, 0)]), h: 2.8, spin: 1.6 };
    },
  ],
  beach: [
    palmToy,
    TOYS[3],
    // a beach umbrella and a towel
    (r) => {
      const a = pick(r, BRIGHT);
      return { g: merge([paint(new THREE.ConeGeometry(2.6, 1.1, 16, 1, true), rib(8, a, 0xffffff)).translate(0, 4.1, 0), solid(new THREE.CylinderGeometry(0.09, 0.09, 4.2, 8), 0xffffff).translate(0, 2.0, 0), paint(new THREE.BoxGeometry(1.6, 0.08, 3.0), (x) => (Math.floor(x * 3 + 3) % 2 ? pick(r, BRIGHT) : 0xffffff)).translate(1.4, 0.05, 0)]), h: 4.8 };
    },
    // a sandcastle
    () => {
      const sand = 0xf0d08a;
      const gs = [solid(new THREE.BoxGeometry(3.4, 1.6, 3.4), sand).translate(0, 0.8, 0)];
      for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) gs.push(solid(new THREE.CylinderGeometry(0.6, 0.7, 2.6, 12), sand).translate(x, 1.3, z), solid(new THREE.ConeGeometry(0.75, 0.9, 12), 0xe8b868).translate(x, 3.05, z));
      gs.push(solid(new THREE.CylinderGeometry(0.9, 1.0, 3.4, 14), sand).translate(0, 2.3, 0), solid(new THREE.BoxGeometry(0.05, 0.6, 0.9), 0xff4f7a).translate(0, 4.6, 0.45), solid(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), 0xffffff).translate(0, 4.5, 0));
      return { g: merge(gs), h: 5 };
    },
  ],
  volcano: [
    crystalToy([0x2a1c20, 0x3a2a2e, 0xff6a10]),
    // a fire bowl
    () => ({ g: merge([solid(new THREE.CylinderGeometry(1.6, 0.9, 1.2, 14), 0x3a2e30).translate(0, 1.6, 0), solid(new THREE.CylinderGeometry(0.4, 0.6, 1.2, 10), 0x2a2224).translate(0, 0.6, 0), solid(new THREE.ConeGeometry(1.2, 2.4, 8), 0xff8a20).translate(0, 3.2, 0), solid(new THREE.ConeGeometry(0.7, 1.8, 8), 0xffd040).translate(0.2, 3.1, 0.1)]), h: 4.4, bob: 0.04 }),
    // a little volcano of its own
    () => ({ g: merge([paint(new THREE.CylinderGeometry(0.9, 2.6, 3.2, 14, 3), (_x, y) => (y > 1.2 ? 0xff7a1a : 0x3a2c2a)).translate(0, 1.6, 0), solid(new THREE.SphereGeometry(0.8, 10, 8), 0xffc040).translate(0, 3.3, 0)]), h: 4 }),
  ],
  arctic: [
    pineToy(true),
    crystalToy([0xbfe8ff, 0x8fd0ff, 0xffffff, 0xc8b8ff]),
    // a snowman with a scarf and a carrot
    (r) => {
      const sc = pick(r, BRIGHT);
      const gs = [solid(new THREE.SphereGeometry(1.5, 24, 16), 0xffffff).translate(0, 1.4, 0), solid(new THREE.SphereGeometry(1.1, 24, 16), 0xffffff).translate(0, 3.4, 0), solid(new THREE.SphereGeometry(0.8, 20, 14), 0xffffff).translate(0, 4.9, 0)];
      gs.push(solid(new THREE.TorusGeometry(0.72, 0.18, 8, 20).rotateX(Math.PI / 2), sc).translate(0, 4.3, 0), solid(new THREE.ConeGeometry(0.14, 0.8, 8).rotateX(Math.PI / 2), 0xff7a1a).translate(0, 4.9, 1.1));
      for (const sx of [-0.28, 0.28]) gs.push(solid(new THREE.SphereGeometry(0.09, 8, 6), 0x1a1a22).translate(sx, 5.1, 0.72));
      gs.push(solid(new THREE.CylinderGeometry(0.55, 0.55, 0.8, 16), 0x1a1a22).translate(0, 5.95, 0), solid(new THREE.CylinderGeometry(0.85, 0.85, 0.08, 16), 0x1a1a22).translate(0, 5.58, 0));
      return { g: merge(gs), h: 6.4 };
    },
    // an igloo
    () => ({ g: merge([paint(new THREE.SphereGeometry(2.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), (x, y, z) => (Math.floor(y * 2.2) % 2 === Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 12) % 2 ? 0xffffff : 0xe2f2ff)), solid(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2), 0xf0f8ff).translate(0, 0.4, 2.1)]), h: 2.4 }),
  ],
  jungle: [palmToy, treeToy([0x2f9a3a, 0x3cb04a, 0x58c040]), (r) => ({ g: merge([solid(new THREE.CylinderGeometry(0.45, 0.6, 2.6, 12), 0xf6ecd8).translate(0, 1.3, 0), paint(new THREE.SphereGeometry(2.0, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), (x, _y, z) => (Math.sin(x * 2.6) * Math.sin(z * 2.6) > 0.55 ? 0xffffff : pick(r, [0xe03a3a, 0xff7a1a]))).translate(0, 2.5, 0)]), h: 3.8 }), crystalToy([0xff4f8f, 0xffc21f, 0x9a5bff])],
  autumn: [treeToy([0xe8601a, 0xffa020, 0xc8302a, 0xf0c030]), treeToy([0xffb020, 0xe8501a, 0xd83a2a]), pumpkinToy(false), pineToy(false)],
  space: [
    // a little planet with a ring
    (r) => {
      const a = pick(r, BRIGHT), b2 = pick(r, BRIGHT);
      return { g: merge([paint(new THREE.SphereGeometry(1.7, 28, 16), (_x, y) => (Math.floor(y * 1.8 + 4) % 2 ? a : b2)), paint(new THREE.RingGeometry(2.2, 3.2, 40, 2), (x, y) => (Math.floor(Math.hypot(x, y) * 3) % 2 ? 0xfff2c8 : 0xd8c0ff)).rotateX(-Math.PI / 2 + 0.4)]).translate(0, 3.0, 0), spin: 0.5, bob: 0.3, h: 5 };
    },
    // a rocket
    (r) => {
      const c2 = pick(r, BRIGHT);
      const gs = [solid(new THREE.CylinderGeometry(0.8, 0.9, 4.2, 20), 0xf4f4f8).translate(0, 2.8, 0), solid(new THREE.ConeGeometry(0.8, 1.8, 20), c2).translate(0, 5.8, 0), solid(new THREE.TorusGeometry(0.42, 0.12, 8, 18), 0x3a3a48).translate(0, 3.6, 0.82), solid(new THREE.CircleGeometry(0.4, 18), 0x60d0ff).translate(0, 3.6, 0.86)];
      for (let k = 0; k < 3; k++) gs.push(solid(new THREE.BoxGeometry(0.12, 1.6, 1.2), c2).translate(0, 1.2, 1.0).rotateY((k / 3) * Math.PI * 2));
      return { g: merge(gs), h: 6.8, spin: 0.3 };
    },
    crystalToy([0xff60d0, 0x40e0ff, 0x9a7aff, 0xffffff]),
  ],
  spooky: [
    pumpkinToy(true),
    // a gravestone with a cross
    () => ({ g: merge([solid(new RoundedBoxGeometry(2.0, 3.0, 0.6, 3, 0.3), 0x9a9aa8).translate(0, 1.5, 0), solid(new THREE.BoxGeometry(0.25, 1.2, 0.1), 0x5a5a68).translate(0, 2.1, 0.32), solid(new THREE.BoxGeometry(0.8, 0.25, 0.1), 0x5a5a68).translate(0, 2.3, 0.32)]), h: 3.2 }),
    // a dead tree
    (r) => {
      const gs = [solid(new THREE.CylinderGeometry(0.2, 0.45, 4.5, 7), 0x3a2a3a).translate(0, 2.25, 0)];
      for (let i = 0; i < 5; i++) gs.push(solid(new THREE.CylinderGeometry(0.06, 0.16, 2.2, 5), 0x3a2a3a).translate(0, 1.1, 0).rotateZ(0.6 + r() * 0.6).rotateY(r() * 6).translate(0, 2.4 + r() * 1.8, 0));
      return { g: merge(gs), h: 5.5 };
    },
    // a witch's hat
    () => ({ g: merge([solid(new THREE.CylinderGeometry(2.0, 2.0, 0.2, 24), 0x2a1a3a).translate(0, 0.1, 0), solid(new THREE.ConeGeometry(1.1, 3.6, 20), 0x2a1a3a).translate(0, 2.0, 0).rotateZ(0.12), solid(new THREE.CylinderGeometry(1.12, 1.12, 0.4, 20), 0x9a5bff).translate(0, 0.45, 0)]), h: 3.8, spin: 0.3 }),
  ],
  neon: [
    () => ({ g: paint(new THREE.TorusGeometry(2.0, 0.3, 12, 40), rib(10, 0xff40c0, 0x30e0ff)).translate(0, 2.7, 0), spin: 0.8, bob: 0.25, h: 5 }),
    () => ({ g: paint(new THREE.ConeGeometry(2.4, 3.2, 4), (_x, y) => (Math.floor(y * 3 + 6) % 2 ? 0x30e0ff : 0x1a1040)).translate(0, 1.6, 0), spin: 0.2, h: 3.4 }),
    (r) => {
      const gs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) gs.push(solid(new RoundedBoxGeometry(1.4, 1.4, 1.4, 2, 0.15), pick(r, [0xff40c0, 0x30e0ff, 0xffd040, 0x9a5bff])).rotateY(r() * 2).translate((r() - 0.5) * 1.4, 0.7 + i * 1.35, (r() - 0.5) * 1.4));
      return { g: merge(gs), h: 5.6 };
    },
    palmToy,
  ],
  desert: [
    // a cactus
    () => {
      const c3 = 0x3a9a4a;
      const gs = [solid(new THREE.CapsuleGeometry(0.55, 4.2, 4, 12), c3).translate(0, 2.6, 0), solid(new THREE.CapsuleGeometry(0.38, 1.0, 4, 10).rotateZ(Math.PI / 2), c3).translate(0.9, 2.4, 0), solid(new THREE.CapsuleGeometry(0.38, 1.3, 4, 10), c3).translate(1.5, 3.1, 0), solid(new THREE.CapsuleGeometry(0.34, 0.8, 4, 10).rotateZ(Math.PI / 2), c3).translate(-0.8, 3.2, 0), solid(new THREE.CapsuleGeometry(0.34, 1.0, 4, 10), c3).translate(-1.3, 3.8, 0), solid(new THREE.SphereGeometry(0.28, 10, 8), 0xff5f8a).translate(0, 5.4, 0)];
      return { g: merge(gs), h: 5.8 };
    },
    () => ({ g: paint(new THREE.ConeGeometry(2.6, 3.2, 4, 4), (_x, y) => (Math.floor(y * 2 + 6) % 2 ? 0xf0d098 : 0xe0bc80)).translate(0, 1.6, 0), h: 3.2 }),
    // a mesa of stripes
    () => ({ g: paint(new THREE.CylinderGeometry(1.8, 2.3, 3.6, 9, 4), (_x, y) => [0xd8743a, 0xf0b07a, 0xc8603a][Math.floor(y * 1.1 + 6) % 3]).translate(0, 1.8, 0), h: 3.6 }),
  ],
  royal: [
    // a crown
    (r) => {
      const gs = [paint(new THREE.CylinderGeometry(1.8, 1.6, 1.4, 32, 1, true), () => 0xffc21f).translate(0, 0.9, 0)];
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        gs.push(solid(new THREE.ConeGeometry(0.42, 1.2, 8), 0xffc21f).translate(Math.cos(a) * 1.75, 2.15, Math.sin(a) * 1.75), solid(new THREE.SphereGeometry(0.2, 10, 8), pick(r, [0xff3a5a, 0x3a7aff, 0x2fbf5a])).translate(Math.cos(a) * 1.75, 2.85, Math.sin(a) * 1.75));
      }
      return { g: merge(gs).translate(0, 0.6, 0), spin: 0.4, bob: 0.25, h: 4 };
    },
    // a tower
    (r) => {
      const roof = pick(r, [0x3a5ad8, 0x7a4bdf, 0xd83a5a]);
      const gs = [solid(new THREE.CylinderGeometry(1.0, 1.1, 4.4, 18), 0xfff6e8).translate(0, 2.2, 0), solid(new THREE.ConeGeometry(1.3, 2.4, 18), roof).translate(0, 5.6, 0), solid(new THREE.SphereGeometry(0.22, 10, 8), 0xffc21f).translate(0, 6.9, 0)];
      for (let k = 0; k < 8; k++) gs.push(solid(new THREE.BoxGeometry(0.35, 0.4, 0.35), 0xfff6e8).translate(Math.cos((k / 8) * 6.28) * 1.0, 4.6, Math.sin((k / 8) * 6.28) * 1.0));
      return { g: merge(gs), h: 7 };
    },
    TOYS[6],
    TOYS[8],
  ],
};
const toysOf = () => BIOME_TOYS[biome().id] ?? TOYS;

/** a floating island: a puffy top, a striped rim, tiers tapering away underneath */
function island(R: number, top: number, rim: number, under: number) {
  const prof = [[0.001, 0.0], [R - 0.5, 0.0], [R - 0.1, -0.12], [R, -0.5], [R, -0.9], [R - 0.15, -1.25], [R * 0.82, -1.5], [R * 0.72, -2.4], [R * 0.5, -2.8], [R * 0.4, -3.8], [R * 0.2, -4.3], [0.001, -5]].map(([x, y]) => new THREE.Vector2(x, y));
  return paint(new THREE.LatheGeometry(prof, 48), (x, y, z) => {
    if (y > -0.08) return top;
    if (y > -1.3) return Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 16) % 2 ? rim : 0xffffff;
    return y > -2.6 ? under : new THREE.Color(under).multiplyScalar(0.8).getHex();
  });
}

// ------------------------------------------------------------------------------------ the crowd
/** a grandstand of beans: instanced bodies (each its own colour) and faces, bouncing and waving */
class Crowd {
  readonly body: THREE.InstancedMesh;
  readonly face: THREE.InstancedMesh;
  private base: { p: THREE.Vector3; yaw: number; ph: number; f: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  constructor(n: number) {
    const prof = [[0.001, 0], [0.32, 0.03], [0.45, 0.18], [0.49, 0.45], [0.47, 0.85], [0.39, 1.15], [0.22, 1.32], [0.001, 1.37]].map(([x, y]) => new THREE.Vector2(x, y));
    const bg = merge([
      solid(new THREE.LatheGeometry(new THREE.SplineCurve(prof).getPoints(16), 20), 0xffffff),
      // arms up, cheering
      solid(new THREE.CapsuleGeometry(0.08, 0.38, 3, 8), 0xffffff).rotateZ(-0.7).translate(0.52, 1.08, 0),
      solid(new THREE.CapsuleGeometry(0.08, 0.38, 3, 8), 0xffffff).rotateZ(0.7).translate(-0.52, 1.08, 0),
    ]);
    const fg = merge([
      solid(new THREE.SphereGeometry(0.13, 12, 8).scale(1, 1.15, 0.5), 0xffffff).translate(-0.14, 1.02, 0.38),
      solid(new THREE.SphereGeometry(0.13, 12, 8).scale(1, 1.15, 0.5), 0xffffff).translate(0.14, 1.02, 0.38),
      solid(new THREE.SphereGeometry(0.065, 8, 6).scale(1, 1.1, 0.5), 0x111118).translate(-0.14, 1.02, 0.44),
      solid(new THREE.SphereGeometry(0.065, 8, 6).scale(1, 1.1, 0.5), 0x111118).translate(0.14, 1.02, 0.44),
      solid(new THREE.TorusGeometry(0.08, 0.02, 6, 12, Math.PI).rotateZ(Math.PI), 0x3a0a14).translate(0, 0.84, 0.42),
    ]);
    const bm = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.5, sheenColor: new THREE.Color(0xffffff) });
    this.body = new THREE.InstancedMesh(bg, bm, n);
    this.face = new THREE.InstancedMesh(fg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25 }), n);
    this.body.count = this.face.count = 0;
    for (const x of [this.body, this.face]) {
      x.castShadow = true;
      x.receiveShadow = true;
      x.frustumCulled = false;
    }
  }
  add(p: THREE.Vector3, yaw: number, color: number, r: () => number) {
    const i = this.body.count++;
    this.face.count++;
    this.base.push({ p: p.clone(), yaw: yaw + (r() - 0.5) * 0.5, ph: r() * 10, f: 3 + r() * 2.5 });
    this.body.setColorAt(i, C.set(color));
  }
  update(t: number) {
    this.base.forEach((b, i) => {
      const hop = Math.max(0, Math.sin(t * b.f + b.ph));
      this.v.copy(b.p);
      this.v.y += hop * hop * 0.45;
      this.e.set(0, b.yaw + Math.sin(t * 1.3 + b.ph) * 0.25, Math.sin(t * b.f * 0.5 + b.ph) * 0.12);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v, this.q, this.one);
      this.body.setMatrixAt(i, this.m);
      this.face.setMatrixAt(i, this.m);
    });
    this.body.instanceMatrix.needsUpdate = true;
    this.face.instanceMatrix.needsUpdate = true;
  }
}


/** the toy islands and grandstands, wherever they're put: still parts collected, spinners and fans animated */
class Set_ {
  readonly stills: THREE.BufferGeometry[] = [];
  private spinners: { obj: THREE.Object3D; spin: number; bob: number; y0: number; r0: number; ph: number }[] = [];
  private crowd = new Crowd(320);
  constructor(
    readonly b: CourseBuilder,
    readonly rnd: () => number,
  ) {}
  /** a floating island of radius R at p (its top) with a giant toy on it */
  toyIsle(p: THREE.Vector3, R: number) {
    const rnd = this.rnd;
    const bi = biome();
    const ig = island(R, pick(rnd, bi.isle.top), pick(rnd, bi.deck.arch), bi.isle.under);
    ig.translate(p.x, p.y, p.z);
    this.stills.push(ig);
    const set = toysOf();
    const toy = set[Math.floor(rnd() * set.length)](rnd);
    const sc = Math.min(1.25, (R * 0.95) / 2.4);
    toy.g.scale(sc, sc, sc);
    if (toy.spin || toy.bob) {
      const mesh = new THREE.Mesh(toy.g, TOY);
      mesh.position.copy(p);
      mesh.rotation.y = rnd() * 6;
      mesh.castShadow = mesh.receiveShadow = true;
      this.b.group.add(mesh);
      this.spinners.push({ obj: mesh, spin: (toy.spin ?? 0) * (rnd() < 0.5 ? -1 : 1), bob: toy.bob ?? 0, y0: p.y, r0: mesh.rotation.y, ph: rnd() * 6 });
    } else {
      toy.g.rotateY(rnd() * 6);
      toy.g.translate(p.x, p.y, p.z);
      this.stills.push(toy.g);
    }
  }
  /** a grandstand at p (its floor) facing `yaw`: three tiers of cheering beans */
  stand(p: THREE.Vector3, yaw: number) {
    const rnd = this.rnd;
    const bi = biome();
    const parts = [island(7.2, bi.isle.top[0], pick(rnd, bi.deck.arch), bi.isle.under)];
    const tierC = [bi.deck.arch[0], bi.deck.arch[1 % bi.deck.arch.length], bi.deck.arch[2 % bi.deck.arch.length]];
    for (let t = 0; t < 3; t++) parts.push(solid(new RoundedBoxGeometry(11, 0.7 * (t + 1), 2.0, 2, 0.2), tierC[t]).translate(0, 0.35 * (t + 1), -1.0 - t * 2.0 + 2.2));
    // poles with balls at the back corners
    for (const x of [-5.6, 5.6]) parts.push(solid(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), 0xffffff).translate(x, 2.5, -4.2), solid(new THREE.SphereGeometry(0.3, 10, 8), 0xffd23a).translate(x, 5.1, -4.2));
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const st = merge(parts);
    st.applyMatrix4(new THREE.Matrix4().compose(p, qy, new THREE.Vector3(1, 1, 1)));
    this.stills.push(st);
    // the fans: three rows, each a little higher and further back
    for (let t = 0; t < 3; t++)
      for (let x = -4.6; x <= 4.61; x += 1.15) {
        if (rnd() < 0.12) continue;
        const lp = new THREE.Vector3(x + (rnd() - 0.5) * 0.3, 0.7 * (t + 1), 2.2 - 1.0 - t * 2.0 + (rnd() - 0.5) * 0.3).applyQuaternion(qy).add(p);
        this.crowd.add(lp, yaw, OUTFITS[Math.floor(rnd() * OUTFITS.length)].a, rnd);
      }
  }
  /** into the course: the fans, and their animation */
  done() {
    const crowd = this.crowd, spinners = this.spinners;
    if (crowd.body.count) {
      this.b.group.add(crowd.body, crowd.face);
      crowd.update(0);
    }
    this.b.animators.push((t) => {
      for (const s of spinners) {
        s.obj.rotation.y = s.r0 + s.spin * t;
        if (s.bob) s.obj.position.y = s.y0 + Math.sin(t * 1.1 + s.ph) * s.bob;
      }
      if (crowd.body.count) crowd.update(t);
    });
  }
}

/** still parts merged by area (so they cull), on the toy material */
function mergeStills(b: CourseBuilder, stills: THREE.BufferGeometry[]) {
  const cells = new Map<string, THREE.BufferGeometry[]>();
  for (const g of stills) {
    g.computeBoundingSphere();
    const c = g.boundingSphere!.center;
    const k = `${Math.floor(c.x / 90)},${Math.floor(c.z / 90)}`;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k)!.push(g);
  }
  for (const gs of cells.values()) {
    const mesh = new THREE.Mesh(merge(gs), TOY);
    mesh.castShadow = mesh.receiveShadow = true;
    b.group.add(mesh);
  }
}

/**
 * Round a survival or team arena (centre on its floor, radius to its edge): grandstands on three
 * sides facing in (the fourth has the round's sign) and toy islands between and beyond them.
 */
export function dressArena(b: CourseBuilder, center: THREE.Vector3, R: number, seed: number) {
  let sd = seed * 9301 + 49297;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const set = new Set_(b, rnd);
  // (the sign stands at -z: angle -π/2)
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 0.25, Math.PI * 0.75]) {
    const r = R + (a % (Math.PI / 2) ? 13 : 9.5);
    const p = new THREE.Vector3(center.x + Math.cos(a) * r, center.y - 1.5 - (a % (Math.PI / 2) ? 1 : 0), center.z + Math.sin(a) * r);
    set.stand(p, Math.atan2(center.x - p.x, center.z - p.z));
  }
  for (let k = 0; k < 9; k++) {
    const a = -Math.PI / 2 + 0.55 + (k / 8) * (Math.PI * 2 - 1.1) + (rnd() - 0.5) * 0.2;
    const r = R + 24 + rnd() * 10;
    const p = new THREE.Vector3(center.x + Math.cos(a) * r, center.y - 4 + rnd() * 6, center.z + Math.sin(a) * r);
    set.toyIsle(p, 4.2 + rnd() * 1.8);
  }
  mergeStills(b, set.stills);
  set.done();
}

// ------------------------------------------------------------------------------------ the dressing
export interface DressZone {
  s0: number;
  s1: number;
  color: number;
}
export interface DressTurn {
  s0: number;
  s1: number;
  /** +1 right, -1 left */
  dir: number;
}

export function dressCourse(b: CourseBuilder, path: Path, o: { zones: DressZone[]; turns: DressTurn[]; gateS: number; finishS: number; seed: number }) {
  let seed = o.seed * 9301 + 49297;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stills: THREE.BufferGeometry[] = [];
  // ---- (how far a point is from the course, in plan, beyond its edge)
  const samples: { x: number; z: number; y: number; hw: number }[] = [];
  for (let i = 0; i < path.count; i += 8) samples.push({ x: path.P[i].x, z: path.P[i].z, y: path.P[i].y, hw: path.sec[i].w / 2 });
  const clearance = (p: THREE.Vector3) => {
    let d = Infinity;
    for (const s of samples) if (Math.abs(s.y - p.y) < 30) d = Math.min(d, Math.hypot(s.x - p.x, s.z - p.z) - s.hw);
    return d;
  };
  const frame = (s: number) => {
    const i = path.index(s);
    return { P: path.P[i], R: path.Rt[i], U: path.U[i], T: path.T[i], hw: path.sec[i].w / 2 };
  };

  // ---- the arches: one where each zone starts, in its colour, white stripes round it
  for (const z of o.zones) {
    const f = frame(z.s0 + 0.75);
    const R = f.hw + 0.8;
    const tube = 0.42;
    const g = paint(new THREE.TorusGeometry(R, tube, 14, 70, Math.PI), (x, y) => (Math.floor((Math.atan2(y, x) / Math.PI) * 14) % 2 ? z.color : 0xffffff));
    const legs: THREE.BufferGeometry[] = [g];
    for (const sx of [-1, 1]) {
      legs.push(solid(new THREE.CylinderGeometry(tube * 0.95, tube * 0.8, 2.4, 16), z.color).translate(sx * R, -1.2, 0));
      legs.push(solid(new THREE.SphereGeometry(tube * 1.15, 16, 10), 0xffffff).translate(sx * R, -2.45, 0));
    }
    // a star on top
    const sh = new THREE.Shape();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + Math.PI / 2, rr = k % 2 ? 0.42 : 0.95;
      if (k === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    legs.push(solid(new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 2 }), 0xffd23a).translate(0, R + 1.25, -0.12));
    const a = merge(legs);
    // (x across, y up, z back down the course: R × U = -T)
    a.applyMatrix4(new THREE.Matrix4().makeBasis(f.R, f.U, f.T.clone().negate()).setPosition(f.P));
    stills.push(a);
  }

  // ---- arrows on the outside of the turns, facing the field as it comes
  for (const tn of o.turns) {
    const len = tn.s1 - tn.s0;
    const n = len > 18 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const s = tn.s0 + ((k + 0.5) / n) * len;
      const f = frame(s);
      const sh = new THREE.Shape([new THREE.Vector2(-1.1, 1.0), new THREE.Vector2(-0.2, 1.0), new THREE.Vector2(1.0, 0), new THREE.Vector2(-0.2, -1.0), new THREE.Vector2(-1.1, -1.0), new THREE.Vector2(0.1, 0)]);
      const front = solid(new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.12, bevelSegments: 3 }), 0xffd23a);
      const back = solid(new THREE.ExtrudeGeometry(sh, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2 }).scale(1.28, 1.28, 1).translate(-0.1, 0, -0.32), 0xe8202f);
      const ball = solid(new THREE.SphereGeometry(0.5, 16, 10), 0xffffff).translate(0, -1.9, 0);
      const pole = solid(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 10), 0xffffff).translate(0, -1.2, 0);
      const head = merge([front, back]);
      // (a left turn: the same arrow turned round about its point's axis; it's symmetric top to bottom)
      if (tn.dir < 0) head.rotateZ(Math.PI);
      const g = merge([head, pole, ball]);
      g.scale(1.25, 1.25, 1.25);
      // x across (right), y up, z back up the course toward the field as it comes (R × U = -T)
      const pos = f.P.clone().addScaledVector(f.R, -tn.dir * (f.hw + 2.6)).addScaledVector(f.U, 2.6);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(f.R, f.U, f.T.clone().negate()).setPosition(pos));
      stills.push(g);
    }
  }

  // ---- islands with giant toys beside the course
  const isles: { p: THREE.Vector3; r: number }[] = [];
  const set = new Set_(b, rnd);
  let side = rnd() < 0.5 ? -1 : 1;
  for (let s = o.gateS + 26; s < o.finishS - 10; s += 30 + rnd() * 16) {
    side = rnd() < 0.7 ? -side : side;
    const f = frame(s);
    const R = 4.2 + rnd() * 1.6;
    let placed = false;
    for (const lat of [12, 16, 20]) {
      const p = f.P.clone().addScaledVector(f.R, side * (f.hw + lat)).addScaledVector(f.U, -2.5 + rnd() * 3.5);
      p.addScaledVector(f.T, (rnd() - 0.5) * 6);
      if (clearance(p) < R + 4 || isles.some((q) => q.p.distanceTo(p) < q.r + R + 3)) continue;
      isles.push({ p, r: R });
      set.toyIsle(p, R);
      placed = true;
      break;
    }
    if (!placed) side = -side;
  }

  // ---- grandstands: one near the start, one or two along the way, one at the finish
  const standAt = [o.gateS + 14, (o.gateS + o.finishS) * 0.5, o.finishS - 4];
  if (o.finishS - o.gateS > 380) standAt.splice(1, 1, o.gateS + (o.finishS - o.gateS) * 0.33, o.gateS + (o.finishS - o.gateS) * 0.66);
  standAt.forEach((s, k) => {
    for (const sd of k % 2 ? [1, -1] : [-1, 1]) {
      const f = frame(s);
      const p = f.P.clone().addScaledVector(f.R, sd * (f.hw + 9.5)).addScaledVector(f.U, -1.2);
      if (clearance(p) < 8 || isles.some((q) => q.p.distanceTo(p) < q.r + 9)) continue;
      isles.push({ p, r: 7 });
      const toward = f.R.clone().multiplyScalar(-sd).setY(0).normalize();
      set.stand(p, Math.atan2(toward.x, toward.z));
      break;
    }
  });
  stills.push(...set.stills);
  set.done();

  mergeStills(b, stills);
}
