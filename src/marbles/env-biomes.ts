import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BiomeId } from './biome.ts';

/**
 * The scenery round each world, far out over the sea: tropical islands with palms, a lighthouse and
 * sailing boats; volcanoes with glowing craters and lava running down them; icebergs and snowy
 * peaks; giant jungle trees and mushrooms; autumn woods; planets with rings and drifting rocks;
 * dead trees, gravestones and glowing pumpkins; neon towers and rings of light; mesas, cacti and
 * pyramids; castles on clouds. Built for the silhouette and the colour (vertex-coloured, each
 * piece one or two meshes), laid round the course past its reach by `layout`.
 */

const BODY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
const SHINY = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0 });
/** lit by itself (colours over 1 bloom) */
const GLOW = new THREE.MeshBasicMaterial({ vertexColors: true });

type G = THREE.BufferGeometry;
const C = new THREE.Color();
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length) % a.length];

/** vertex colours by position (each triangle flat, by its centroid); k scales (over 1 glows) */
function col(g: G, fn: number | ((x: number, y: number, z: number) => number), k = 1): G {
  const ng = g.index ? g.toNonIndexed() : g;
  const p = ng.getAttribute('position');
  const a = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    C.set(typeof fn === 'number' ? fn : fn(x, y, z)).multiplyScalar(k);
    for (let j = 0; j < 3; j++) C.toArray(a, (i + j) * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const key of Object.keys(ng.attributes)) if (!['position', 'normal', 'color'].includes(key)) ng.deleteAttribute(key);
  return ng;
}
/** jagged: every vertex pushed in or out a little (a rock, an iceberg), then faceted */
function rough(g: G, amt: number, s = 1): G {
  const ng = g.index ? g : g;
  const p = ng.getAttribute('position');
  const map = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
    let f = map.get(key);
    if (f === undefined) map.set(key, (f = 1 + (rnd() - 0.5) * 2 * amt));
    p.setXYZ(i, p.getX(i) * f, p.getY(i) * (1 + (f - 1) * s), p.getZ(i) * f);
  }
  const out = ng.index ? ng.toNonIndexed() : ng;
  out.computeVertexNormals();
  return out;
}
const T = (g: G, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
const merge = (gs: G[]) => mergeGeometries(gs, false)!;
const lathe = (pts: [number, number][], seg = 32) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(0.001, x), y)), seg);

/** one piece of scenery: its meshes (by material), where it stands, and how it moves */
interface Piece {
  body?: G[];
  shiny?: G[];
  glow?: G[];
  /** angle round the course, distance past its reach, height over the sea */
  a: number;
  d: number;
  y?: number;
  /** stands in the sea (its foot's radius, for the swirl round it) */
  peg?: number;
  spin?: number;
  bob?: number;
  /** turns about its own axle (a gear standing on edge), rad/s */
  turn?: number;
  /** flickers on now and then (lightning) */
  flash?: boolean;
}

// --------------------------------------------------------------------------------- the pieces
function palm(h: number, lean: number): { body: G[] } {
  const gs: G[] = [];
  const n = 7;
  let x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    const seg = col(new THREE.CylinderGeometry(0.55 * (1 - i * 0.06), 0.62 * (1 - i * 0.06), h / n + 0.2, 8), i % 2 ? 0x9a6a3a : 0x8a5a30);
    const nx = x + lean * (i / n) * 0.5;
    gs.push(T(seg, nx, y + h / n / 2, 0, 0, 0, -lean * 0.15 * (i / n)));
    x = nx;
    y += h / n;
  }
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + rnd() * 0.3;
    const leaf = col(new THREE.ConeGeometry(1.1, h * 0.55, 4, 1).scale(1, 1, 0.25), k % 2 ? 0x2fa84a : 0x3cc05a);
    leaf.translate(0, h * 0.27, 0);
    gs.push(T(leaf, x, y, 0, 0, a, 1.9));
  }
  gs.push(T(col(new THREE.SphereGeometry(0.7, 8, 6), 0x6a4a20), x, y - 0.4, 0));
  return { body: gs };
}

function tree(h: number, leaves: number[]): G[] {
  const gs: G[] = [col(new THREE.CylinderGeometry(h * 0.05, h * 0.09, h * 0.75, 10).translate(0, h * 0.37, 0), 0x6a4a30)];
  const n = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const r = h * (0.2 + rnd() * 0.12);
    const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : h * 0.18;
    gs.push(col(T(rough(new THREE.IcosahedronGeometry(r, 1), 0.12), Math.cos(a) * d, h * (0.72 + rnd() * 0.18), Math.sin(a) * d), pick(leaves)));
  }
  return gs;
}

function island(R: number, top: number, side: number, under: number): G {
  return col(lathe([[0, 2], [R * 0.92, 2], [R, 0.6], [R * 0.96, -1.5], [R * 0.7, -R * 0.25], [R * 0.35, -R * 0.55], [0, -R * 0.7]], 28), (_x, y) => (y > 1.5 ? top : y > -1.8 ? side : under));
}

function build(id: BiomeId): Piece[] {
  seed = 7 + id.length * 13;
  const P: Piece[] = [];
  const ring = (n: number, f: (k: number) => Omit<Piece, 'a' | 'd'> & { d?: number }, d0 = 40, dd = 320) => {
    for (let k = 0; k < n; k++) {
      const p = f(k);
      P.push({ d: d0 + rnd() * dd, ...p, a: (k / n) * Math.PI * 2 + rnd() * 0.4 });
    }
  };
  switch (id) {
    case 'beach': {
      ring(11, () => {
        const R = 22 + rnd() * 26;
        const body: G[] = [col(lathe([[0, 4], [R * 0.5, 3.6], [R * 0.85, 1.2], [R, -0.5], [R * 1.05, -3]], 36), (_x, y) => (y > 0.2 ? 0xf2d79a : 0xe2be7a))];
        body.push(T(col(new THREE.SphereGeometry(R * 0.45, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), 0x4cb84a), rnd() * 4, 3.4, rnd() * 4, 0, 0, 0, 1, 0.55, 1));
        const n = 3 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const a = rnd() * Math.PI * 2, r = R * (0.3 + rnd() * 0.45);
          const p = palm(12 + rnd() * 10, 1 + rnd() * 2.5);
          for (const g of p.body) body.push(T(g, Math.cos(a) * r, 3.5, Math.sin(a) * r, 0, rnd() * 6, 0, 1.2));
        }
        for (let i = 0; i < 4; i++) {
          const a = rnd() * Math.PI * 2;
          body.push(T(col(rough(new THREE.DodecahedronGeometry(2 + rnd() * 3, 0), 0.25), 0x8a8a90), Math.cos(a) * R, 0, Math.sin(a) * R));
        }
        return { body, peg: R * 1.05 };
      });
      // a lighthouse
      {
        const body = [col(new THREE.CylinderGeometry(4, 6.5, 46, 24, 8).translate(0, 23, 0), (_x, y) => (Math.floor(y / 7) % 2 ? 0xffffff : 0xe03a3a)), col(new THREE.CylinderGeometry(5.6, 5.6, 1.5, 24).translate(0, 46.5, 0), 0x2a2a30), col(new THREE.ConeGeometry(5, 6, 24).translate(0, 54, 0), 0xe03a3a)];
        const glow = [col(new THREE.CylinderGeometry(3.6, 3.6, 4.6, 16).translate(0, 49.5, 0), 0xfff0b0, 3)];
        body.push(col(lathe([[0, 2], [16, 2], [18, 0], [19, -3]], 30), 0xb8b0a8));
        P.push({ body, glow, a: 1.1, d: 90, peg: 19 });
      }
      // sailing boats
      for (let k = 0; k < 5; k++) {
        const sail = rnd() < 0.5 ? 0xffffff : pick([0xff6a3d, 0xffc21f, 0x2f8cff]);
        const body = [col(new THREE.CylinderGeometry(2.2, 1.2, 1.6, 12, 1).scale(1, 1, 3.4).translate(0, 0.8, 0), 0xffffff), col(new THREE.CylinderGeometry(0.18, 0.18, 13, 6).translate(0, 7.5, 0), 0x6a4a30)];
        const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 11), new THREE.Vector2(5.5, 0)]);
        body.push(col(new THREE.ShapeGeometry(tri).rotateY(Math.PI / 2).translate(0, 2.2, -0.2), sail));
        P.push({ body, a: rnd() * Math.PI * 2, d: 20 + rnd() * 120, bob: 0.5, spin: 0.02 });
      }
      break;
    }
    case 'volcano': {
      for (let k = 0; k < 3; k++) {
        const R = 150 + rnd() * 90, H = 150 + rnd() * 90, cr = R * 0.18;
        const g = rough(lathe([[0, H * 0.82], [cr * 0.7, H * 0.86], [cr, H], [cr * 1.4, H * 0.96], [R * 0.4, H * 0.62], [R * 0.7, H * 0.3], [R, 0], [R * 1.08, -8]], 40), 0.05, 0.4);
        const body = [col(g, (_x, y) => (y > H * 0.9 ? 0x3a2a26 : y > H * 0.5 ? 0x2a2022 : 0x3a2c28))];
        const glow: G[] = [col(new THREE.CircleGeometry(cr * 0.95, 24).rotateX(-Math.PI / 2).translate(0, H * 0.84, 0), 0xff7a20, 3.5)];
        // lava running down
        for (let i = 0; i < 4; i++) {
          const a = rnd() * Math.PI * 2;
          const pts: THREE.Vector3[] = [];
          for (let j = 0; j <= 10; j++) {
            const u = j / 10;
            const r = cr * 1.3 + (R - cr * 1.3) * u;
            const y = H * 0.97 - u * H * 0.98;
            const aw = a + Math.sin(u * 5 + i) * 0.12;
            pts.push(new THREE.Vector3(Math.cos(aw) * r, y + 1, Math.sin(aw) * r));
          }
          glow.push(col(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 2.2 + rnd() * 2, 6), 0xff6a10, 2.6));
        }
        P.push({ body, glow, a: (k / 3) * Math.PI * 2 + 0.5, d: 260 + rnd() * 220, peg: R });
      }
      ring(16, () => {
        const body: G[] = [];
        const n = 3 + Math.floor(rnd() * 5);
        for (let i = 0; i < n; i++) {
          const h = 20 + rnd() * 60, r = 5 + rnd() * 5;
          body.push(col(new THREE.CylinderGeometry(r, r * 1.1, h, 6).translate((rnd() - 0.5) * 16, h / 2 - 4, (rnd() - 0.5) * 16), (_x, y) => (y > h - 6 ? 0x4a3a38 : 0x2a2224)));
        }
        return { body, glow: [col(new THREE.TorusGeometry(14, 1.2, 6, 24).rotateX(Math.PI / 2), 0xff5a10, 2.4)], peg: 16 };
      }, 30, 260);
      break;
    }
    case 'arctic': {
      ring(14, () => {
        const R = 14 + rnd() * 26, H = 10 + rnd() * 34;
        const g = rough(new THREE.IcosahedronGeometry(1, 2), 0.18);
        g.scale(R, H, R * (0.7 + rnd() * 0.5));
        const body = [col(g, (_x, y) => (y > H * 0.25 ? 0xffffff : y > -H * 0.1 ? 0xd8f0ff : 0x7ac0e8))];
        return { shiny: body, peg: R };
      }, 30, 300);
      // snowy peaks far out
      ring(9, () => {
        const R = 90 + rnd() * 80, H = 140 + rnd() * 160;
        const g = rough(new THREE.ConeGeometry(R, H, 9, 6).translate(0, H / 2 - 10, 0), 0.12, 0.3);
        return { body: [col(g, (_x, y) => (y > H * 0.45 ? 0xffffff : y > H * 0.3 ? 0xd0e4f4 : 0x5a6a88))], peg: R };
      }, 380, 300);
      break;
    }
    case 'jungle':
    case 'autumn': {
      const leaves = id === 'jungle' ? [0x2f9a3a, 0x3cb04a, 0x24803a, 0x58c040] : [0xe8601a, 0xffa020, 0xc8302a, 0xf0c030, 0xb85020];
      ring(14, () => {
        const h = 70 + rnd() * 90;
        const body = tree(h, leaves);
        body.push(island(h * 0.22, id === 'jungle' ? 0x4ca03a : 0xc89040, 0x8a6a48, 0x6a5038).translate(0, -1.6, 0));
        return { body, peg: h * 0.22 };
      }, 30, 330);
      if (id === 'jungle') {
        ring(7, () => {
          const h = 30 + rnd() * 40, r = h * 0.55;
          const cap = col(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, h, 0), (x, _y, z) => (Math.sin(x * 0.4) * Math.sin(z * 0.4) > 0.6 ? 0xffffff : pick([0xe03a3a, 0xe03a3a, 0xff7a1a])));
          return { body: [col(new THREE.CylinderGeometry(r * 0.22, r * 0.3, h, 16).translate(0, h / 2, 0), 0xf6ecd8), cap], peg: r * 0.3 };
        }, 60, 240);
      } else {
        // (and haystacks and big pumpkins in the stubble)
        ring(8, () => {
          const r = 10 + rnd() * 10;
          const g = col(new THREE.SphereGeometry(r, 24, 14).scale(1, 0.75, 1), (x, _y, z) => (Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 12) % 2 ? 0xff8a1a : 0xf07010));
          return { body: [g.translate(0, r * 0.4, 0), col(new THREE.CylinderGeometry(1, 1.4, 5, 8).translate(0, r * 1.15, 0), 0x4a7a2a)], peg: r };
        }, 50, 260);
      }
      break;
    }
    case 'space': {
      const planet = (R: number, bands: number[], ringC?: number) => {
        const body = [col(new THREE.SphereGeometry(R, 48, 24), (_x, y) => bands[Math.floor((y / R + 1) * 3.5 + Math.sin(y * 0.3) * 0.4) % bands.length])];
        const glow: G[] = [];
        if (ringC !== undefined) body.push(col(new THREE.RingGeometry(R * 1.35, R * 2.1, 64, 3).rotateX(-Math.PI / 2 + 0.35), (x, _y, z) => (Math.floor(Math.hypot(x, z) / (R * 0.12)) % 2 ? ringC : 0xd8c8b0)));
        return { body, glow };
      };
      P.push({ ...planet(130, [0xe8a060, 0xd88040, 0xf0c890, 0xc87040], 0xe8d0a0), a: 0.6, d: 520, y: 260, spin: 0.01 });
      P.push({ ...planet(70, [0x3a7ae0, 0x2a5ab8, 0x58a0f0]), a: 2.4, d: 380, y: 180, spin: 0.02 });
      P.push({ ...planet(45, [0xc84a8a, 0x9a3a7a, 0xe878b0], 0x9a7ad8), a: 3.9, d: 300, y: 120, spin: 0.03 });
      P.push({ ...planet(220, [0x5a4aa8, 0x3a2a7a, 0x7a6ad0]), a: 5.2, d: 760, y: 340, spin: 0.005 });
      ring(34, () => ({ body: [col(rough(new THREE.DodecahedronGeometry(4 + rnd() * 14, 1), 0.3), pick([0x6a6070, 0x7a7080, 0x5a5262]))], y: 20 + rnd() * 160, spin: 0.05 + rnd() * 0.1, bob: 2 }), 20, 400);
      // crystal spires out of the nebula
      ring(10, () => {
        const body: G[] = [], glow: G[] = [];
        const c = pick([0xff60d0, 0x40e0ff, 0x9a7aff]);
        for (let i = 0; i < 5; i++) {
          const h = 20 + rnd() * 50;
          glow.push(col(new THREE.ConeGeometry(4 + rnd() * 4, h, 5).translate((rnd() - 0.5) * 18, h / 2 - 3, (rnd() - 0.5) * 18).rotateZ((rnd() - 0.5) * 0.5), c, 1.4));
        }
        return { body, glow, peg: 14 };
      }, 40, 240);
      break;
    }
    case 'spooky': {
      ring(14, () => {
        const body: G[] = [];
        const h = 50 + rnd() * 50;
        body.push(col(new THREE.CylinderGeometry(h * 0.035, h * 0.08, h, 7).translate(0, h / 2, 0), 0x2a2030));
        const branch = (x: number, y: number, z: number, len: number, a: number, tilt: number, depth: number) => {
          const g = col(new THREE.CylinderGeometry(len * 0.04, len * 0.07, len, 5).translate(0, len / 2, 0), 0x2a2030);
          body.push(T(g, x, y, z, 0, a, tilt));
          if (depth <= 0) return;
          const ex = x + Math.sin(tilt) * -Math.cos(a) * len * -1, ey = y + Math.cos(tilt) * len, ez = z + Math.sin(tilt) * Math.sin(a) * len;
          for (let i = 0; i < 2; i++) branch(ex, ey, ez, len * 0.65, a + (rnd() - 0.5) * 2, tilt + (rnd() - 0.5) * 0.9, depth - 1);
        };
        for (let i = 0; i < 4; i++) branch(0, h * (0.55 + rnd() * 0.35), 0, h * 0.35, rnd() * 6, 0.6 + rnd() * 0.5, 2);
        body.push(island(h * 0.25, 0x3a4a3a, 0x3a3040, 0x2a2230).translate(0, -1.6, 0));
        return { body, peg: h * 0.25 };
      }, 30, 330);
      ring(9, () => {
        const r = 12 + rnd() * 12;
        const body = [col(new THREE.SphereGeometry(r, 28, 16).scale(1, 0.8, 1), (x, _y, z) => (Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 14) % 2 ? 0xff7a10 : 0xe86008)), col(new THREE.CylinderGeometry(1.2, 1.8, 6, 8).translate(0, r * 0.85, 0), 0x3a5a2a)];
        // the face, glowing, turned toward the course (local -z faces it once laid out)
        const glow: G[] = [];
        const tri = (cx: number, cy: number, s: number, flip: number) => glow.push(col(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-s, -s * 0.6 * flip), new THREE.Vector2(s, -s * 0.6 * flip), new THREE.Vector2(0, s * 0.8 * flip)])).translate(cx, cy, 0).rotateY(Math.PI).translate(0, 0, -r * 0.98), 0xffc040, 3));
        tri(-r * 0.35, r * 0.2, r * 0.18, 1);
        tri(r * 0.35, r * 0.2, r * 0.18, 1);
        glow.push(col(new THREE.PlaneGeometry(r * 0.9, r * 0.2).translate(0, -r * 0.25, 0).rotateY(Math.PI).translate(0, 0, -r * 0.97), 0xffc040, 3));
        return { body, glow, peg: r, y: r * 0.5 };
      }, 40, 220);
      ring(16, () => {
        const body: G[] = [];
        for (let i = 0; i < 4; i++) {
          const w = 5 + rnd() * 3, h = 8 + rnd() * 6;
          const g = new THREE.Shape();
          g.moveTo(-w / 2, 0);
          g.lineTo(w / 2, 0);
          g.lineTo(w / 2, h - w / 2);
          g.absarc(0, h - w / 2, w / 2, 0, Math.PI, false);
          g.lineTo(-w / 2, 0);
          body.push(T(col(new THREE.ExtrudeGeometry(g, { depth: 1.5, bevelEnabled: false }), 0x8a8a98), (rnd() - 0.5) * 30, -1, (rnd() - 0.5) * 30, (rnd() - 0.5) * 0.3, rnd() * 6, (rnd() - 0.5) * 0.3));
        }
        body.push(island(22, 0x3a4a3a, 0x3a3040, 0x2a2230).translate(0, -1.4, 0));
        return { body, peg: 22 };
      }, 20, 280);
      break;
    }
    case 'neon': {
      ring(22, () => {
        const w = 12 + rnd() * 16, h = 60 + rnd() * 200;
        const c = pick([0xff40c0, 0x30e0ff, 0xffd040, 0x9a5bff]);
        const body = [col(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), 0x140c2a)];
        const glow: G[] = [];
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) glow.push(col(new THREE.BoxGeometry(0.8, h, 0.8).translate((sx * w) / 2, h / 2, (sz * w) / 2), c, 2.2));
        for (let y = 12; y < h; y += 14) glow.push(col(new THREE.BoxGeometry(w + 0.6, 0.6, w + 0.6).translate(0, y, 0), c, 1.2));
        return { body, glow, peg: w * 0.8 };
      }, 50, 380);
      ring(5, () => ({ glow: [col(new THREE.TorusGeometry(30 + rnd() * 30, 1.6, 8, 64), pick([0xff40c0, 0x30e0ff]), 2.6)], y: 60 + rnd() * 80, spin: 0.2 }), 60, 200);
      ring(4, () => {
        const R = 60 + rnd() * 40;
        const g = new THREE.ConeGeometry(R, R * 1.1, 4, 1).translate(0, R * 0.55, 0);
        const e = new THREE.EdgesGeometry(g);
        const edges: G[] = [];
        const pa = e.getAttribute('position');
        for (let i = 0; i < pa.count; i += 2) {
          const A = new THREE.Vector3().fromBufferAttribute(pa, i), B = new THREE.Vector3().fromBufferAttribute(pa, i + 1);
          const len = A.distanceTo(B);
          const bar = new THREE.CylinderGeometry(0.9, 0.9, len, 6).translate(0, len / 2, 0);
          bar.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
          edges.push(col(bar.translate(A.x, A.y, A.z), 0x30e0ff, 2.4));
        }
        return { body: [col(g, 0x0c0820)], glow: edges, peg: R };
      }, 300, 300);
      break;
    }
    case 'desert': {
      const strata = [0xd8743a, 0xe8925a, 0xc8603a, 0xf0b07a, 0xb8502a];
      ring(12, () => {
        const R = 40 + rnd() * 60, H = 50 + rnd() * 90;
        const g = rough(new THREE.CylinderGeometry(R * 0.8, R, H, 12, 6).translate(0, H / 2 - 5, 0), 0.1, 0);
        return { body: [col(g, (_x, y) => (y > H - 6 ? 0xc8803a : strata[Math.floor(y / 9 + 10) % strata.length]))], peg: R };
      }, 60, 400);
      ring(14, () => {
        const h = 22 + rnd() * 26, r = h * 0.07;
        const c = 0x3a9a4a;
        const body = [col(new THREE.CapsuleGeometry(r, h, 4, 10).translate(0, h / 2, 0), c)];
        for (const s of [-1, 1]) {
          if (rnd() < 0.2) continue;
          const y0 = h * (0.35 + rnd() * 0.25), L = h * (0.2 + rnd() * 0.15);
          body.push(col(new THREE.CapsuleGeometry(r * 0.75, r * 3, 4, 8).rotateZ(Math.PI / 2).translate(s * r * 2.4, y0, 0), c));
          body.push(col(new THREE.CapsuleGeometry(r * 0.75, L, 4, 8).translate(s * r * 4.2, y0 + L / 2, 0), c));
        }
        body.push(island(h * 0.35, 0xe8c088, 0xd8a868, 0xb87848).translate(0, -1.6, 0));
        return { body, peg: h * 0.35 };
      }, 30, 260);
      ring(3, () => {
        const R = 70 + rnd() * 50;
        return { body: [col(new THREE.ConeGeometry(R, R * 1.25, 4, 6).translate(0, R * 0.62 - 3, 0), (_x, y) => (Math.floor(y / 5) % 2 ? 0xe8c890 : 0xdcb880))], peg: R };
      }, 380, 200);
      break;
    }
    case 'royal': {
      ring(8, () => {
        const body: G[] = [], shiny: G[] = [];
        const roof = pick([0x3a5ad8, 0x7a4bdf, 0xd83a5a]);
        const n = 4 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const r = 4 + rnd() * 5, h = 20 + rnd() * 40;
          const x = i === 0 ? 0 : (rnd() - 0.5) * 34, z = i === 0 ? 0 : (rnd() - 0.5) * 34;
          const hh = i === 0 ? h * 1.5 : h;
          body.push(col(new THREE.CylinderGeometry(r, r * 1.05, hh, 16).translate(x, hh / 2, z), 0xfff6e8));
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            body.push(col(new THREE.BoxGeometry(1.4, 1.6, 1.4).translate(x + Math.cos(a) * r, hh + 0.8, z + Math.sin(a) * r), 0xfff6e8));
          }
          body.push(col(new THREE.ConeGeometry(r * 1.2, r * 2.4, 16).translate(x, hh + r * 1.2 + 1.5, z), roof));
          shiny.push(col(new THREE.SphereGeometry(r * 0.25, 12, 8).translate(x, hh + r * 2.4 + 1.8, z), 0xffc21f));
        }
        // the cloud it stands on
        for (let i = 0; i < 9; i++) {
          const a = rnd() * Math.PI * 2, d = rnd() * 30, r = 10 + rnd() * 10;
          body.push(col(new THREE.IcosahedronGeometry(r, 2).scale(1, 0.55, 1).translate(Math.cos(a) * d, -r * 0.2, Math.sin(a) * d), 0xffffff));
        }
        return { body, shiny, y: 30 + rnd() * 60, bob: 1.5 };
      }, 60, 380);
      ring(6, () => ({ shiny: [col(new THREE.SphereGeometry(16, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), 0xffc21f), col(new THREE.ConeGeometry(2, 8, 12).translate(0, 19, 0), 0xffc21f)], body: [col(new THREE.CylinderGeometry(17, 17, 10, 32).translate(0, -5, 0), 0xfff6e8), col(new THREE.IcosahedronGeometry(24, 2).scale(1, 0.4, 1).translate(0, -12, 0), 0xffffff)], y: 40 + rnd() * 50, bob: 1 }), 120, 300);
      break;
    }
    case 'blossom': {
      const pinks = [0xffb8d4, 0xffc8e0, 0xff9ac0, 0xffd8e8, 0xffffff];
      ring(15, () => {
        const h = 40 + rnd() * 50;
        const body: G[] = [col(new THREE.CylinderGeometry(h * 0.04, h * 0.08, h * 0.7, 9).translate(0, h * 0.35, 0), 0x5a3a34)];
        for (let i = 0; i < 3; i++) {
          const a = rnd() * 6, l = h * 0.3;
          body.push(T(col(new THREE.CylinderGeometry(h * 0.02, h * 0.035, l, 6).translate(0, l / 2, 0), 0x5a3a34), 0, h * 0.5, 0, Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8));
        }
        const n = 6 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const r = h * (0.16 + rnd() * 0.12), a = rnd() * Math.PI * 2, d = i === 0 ? 0 : h * (0.12 + rnd() * 0.16);
          body.push(col(T(rough(new THREE.IcosahedronGeometry(r, 1), 0.15), Math.cos(a) * d, h * (0.66 + rnd() * 0.22), Math.sin(a) * d, 0, 0, 0, 1, 0.75, 1), pick(pinks)));
        }
        body.push(island(h * 0.3, 0x9ad88a, 0x8a7a5a, 0x6a5a48).translate(0, -1.6, 0));
        return { body, peg: h * 0.3 };
      }, 30, 320);
      // tiered towers with curling roofs
      ring(5, () => {
        const body: G[] = [], glow: G[] = [];
        const tiers = 4 + Math.floor(rnd() * 3);
        let y = 0, w = 14;
        for (let i = 0; i < tiers; i++) {
          const hh = 8;
          body.push(col(new THREE.CylinderGeometry(w * 0.55, w * 0.6, hh, 8).translate(0, y + hh / 2, 0), 0xf6ece0));
          body.push(col(lathe([[0, 2.4], [w * 0.5, 2.2], [w * 0.95, 0.4], [w * 1.05, 0.9], [w * 1.0, 0]], 8).translate(0, y + hh, 0), 0xc83a3a));
          glow.push(col(new THREE.CylinderGeometry(w * 0.56, w * 0.56, 1.4, 8, 1, true).translate(0, y + hh * 0.55, 0), 0xffe0a0, 1.6));
          y += hh + 2;
          w *= 0.82;
        }
        body.push(col(new THREE.ConeGeometry(1.2, 10, 8).translate(0, y + 5, 0), 0xffc21f));
        body.push(island(22, 0x9ad88a, 0x8a7a5a, 0x6a5a48).translate(0, -1.4, 0));
        return { body, glow, peg: 22 };
      }, 80, 300);
      // far hills dusted pink
      ring(9, () => {
        const R = 90 + rnd() * 80, H = 70 + rnd() * 70;
        const g = rough(new THREE.SphereGeometry(R, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, H / R, 1), 0.06, 0.2);
        return { body: [col(g, () => (rnd() < 0.3 ? 0xffb8d4 : rnd() < 0.5 ? 0x7ac87a : 0x8ad88a))], peg: R };
      }, 380, 300);
      break;
    }
    case 'storm': {
      // sea stacks: tall broken pillars of rock
      ring(18, () => {
        const body: G[] = [];
        const n = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          const h = 40 + rnd() * 90, r = 6 + rnd() * 9;
          const g = rough(new THREE.CylinderGeometry(r * 0.7, r, h, 8, 6).translate((rnd() - 0.5) * 20, h / 2 - 6, (rnd() - 0.5) * 20), 0.14, 0.1);
          body.push(col(g, (_x, y) => (y > h - 10 ? 0x6a7a6a : y < 4 ? 0x2a3034 : pick([0x4a5058, 0x545a62, 0x3e444c]))));
        }
        return { body, peg: 18 };
      }, 30, 330);
      // a black-and-white lighthouse, its lamp lit
      {
        const body = [col(new THREE.CylinderGeometry(4, 6.5, 50, 24, 8).translate(0, 25, 0), (_x, y) => (Math.floor(y / 8) % 2 ? 0xf0f0f0 : 0x22262c)), col(new THREE.ConeGeometry(5, 6, 24).translate(0, 58, 0), 0x22262c)];
        const glow = [col(new THREE.CylinderGeometry(3.6, 3.6, 4.6, 16).translate(0, 53, 0), 0xfff0b0, 4)];
        body.push(col(rough(lathe([[0, 3], [14, 2], [18, -1], [20, -6]], 16), 0.15), 0x3a4048));
        P.push({ body, glow, a: 2.2, d: 110, peg: 20 });
      }
      // lightning, now and then
      ring(7, () => {
        const pts: THREE.Vector3[] = [];
        let x = 0, z = 0;
        for (let y = 260; y > -2; y -= 18 + rnd() * 16) {
          pts.push(new THREE.Vector3(x, y, z));
          x += (rnd() - 0.5) * 30;
          z += (rnd() - 0.5) * 30;
        }
        const glow = [col(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0), 40, 1.1, 5), 0xe8f0ff, 5)];
        for (let k = 0; k < 2; k++) {
          const i0 = 2 + Math.floor(rnd() * (pts.length - 4));
          const b0 = pts[i0];
          const br = [b0, b0.clone().add(new THREE.Vector3((rnd() - 0.5) * 50, -40, (rnd() - 0.5) * 50)), b0.clone().add(new THREE.Vector3((rnd() - 0.5) * 70, -70, (rnd() - 0.5) * 70))];
          glow.push(col(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(br, false, 'catmullrom', 0), 12, 0.6, 4), 0xe8f0ff, 4));
        }
        return { glow, flash: true };
      }, 120, 350);
      break;
    }
    case 'reef': {
      const corals = [0xff6a8a, 0xffa040, 0xb06aff, 0xff5aa0, 0x40e0c0, 0xffd040];
      ring(16, () => {
        const body: G[] = [], shiny: G[] = [];
        const n = 4 + Math.floor(rnd() * 5);
        for (let i = 0; i < n; i++) {
          const c = pick(corals);
          const h = 14 + rnd() * 40, x = (rnd() - 0.5) * 26, z = (rnd() - 0.5) * 26;
          if (rnd() < 0.5) {
            // a branching coral: a trunk and arms with knobs
            body.push(col(new THREE.CylinderGeometry(1.2, 2.2, h, 8).translate(x, h / 2 - 3, z), c));
            for (let k = 0; k < 4; k++) {
              const a = rnd() * 6, l = h * 0.45;
              const arm = col(new THREE.CylinderGeometry(0.8, 1.2, l, 6).translate(0, l / 2, 0), c);
              body.push(T(arm, x, h * (0.4 + rnd() * 0.4), z, Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7));
              shiny.push(col(new THREE.SphereGeometry(1.3, 10, 8).translate(x + Math.sin(a) * l * -0.65, h * 0.55 + l * 0.75, z + Math.cos(a) * l * 0.65), c));
            }
          } else {
            // a fan or a brain coral
            if (rnd() < 0.5) body.push(col(new THREE.CircleGeometry(h * 0.45, 20, 0, Math.PI).translate(x, h * 0.15, z).rotateY(rnd() * 3), c));
            else shiny.push(col(rough(new THREE.SphereGeometry(h * 0.3, 18, 12), 0.08).scale(1, 0.7, 1).translate(x, 0, z), c));
          }
        }
        body.push(col(lathe([[0, 1], [16, 1], [18, -1], [20, -5]], 20), 0xffe8c0));
        return { body, shiny, peg: 20 };
      }, 30, 320);
      // giant spiral shells on sandbars
      ring(6, () => {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 14; i++) {
          const u = i / 14;
          pts.push([Math.max(0.2, 14 * (1 - u) * (0.6 + 0.4 * Math.abs(Math.sin(u * 14)))), u * 34]);
        }
        const shell = col(lathe(pts, 24), (_x, y) => (Math.floor(y / 3) % 2 ? 0xffd8c0 : 0xffa880));
        return { shiny: [shell.rotateZ(0.5)], body: [col(lathe([[0, 1], [22, 1], [24, -3]], 20), 0xf8dca8)], peg: 24 };
      }, 70, 260);
      // sea arches
      ring(4, () => {
        const R = 30 + rnd() * 20;
        return { body: [col(rough(new THREE.TorusGeometry(R, R * 0.22, 8, 20, Math.PI), 0.1), (_x, y) => (y > R * 0.9 ? 0x6ac06a : 0xc8a070))], peg: R };
      }, 160, 300);
      // a few palm islets
      ring(6, () => {
        const body: G[] = [col(lathe([[0, 2], [10, 1.8], [14, -0.5], [15, -3]], 24), 0xf8e0b0)];
        const p = palm(12 + rnd() * 6, 1.5 + rnd());
        for (const g of p.body) body.push(T(g, 0, 1.8, 0, 0, rnd() * 6, 0));
        return { body, peg: 15 };
      }, 40, 240);
      break;
    }
    case 'clockwork': {
      const gear = (R: number, teeth: number, depth: number, c: number) => {
        const sh = new THREE.Shape();
        for (let i = 0; i < teeth * 2; i++) {
          const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
          const r = i % 2 ? R : R * 1.12;
          if (i === 0) sh.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
          else sh.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
          sh.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
        }
        const hole = new THREE.Path();
        hole.absarc(0, 0, R * 0.28, 0, Math.PI * 2, true);
        sh.holes.push(hole);
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          const w = new THREE.Path();
          w.absarc(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62, R * 0.18, 0, Math.PI * 2, true);
          sh.holes.push(w);
        }
        return col(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: depth * 0.15, bevelThickness: depth * 0.15, bevelSegments: 1, curveSegments: 6 }).translate(0, 0, -depth / 2), c);
      };
      // giant gears standing on edge, turning
      ring(9, (k) => {
        const R = 30 + rnd() * 50;
        return { shiny: [gear(R, 14 + Math.floor(R / 6), 5, pick([0xd89a3a, 0xc07a3a, 0xa8a8b0]))], body: [col(new THREE.CylinderGeometry(R * 0.26, R * 0.26, 12, 20).rotateX(Math.PI / 2), 0x3a2a20)], y: R * 0.7, turn: (k % 2 ? 1 : -1) * (0.05 + rnd() * 0.08) };
      }, 80, 360);
      // brass towers with lit windows and chimneys
      ring(14, () => {
        const body: G[] = [], shiny: G[] = [], glow: G[] = [];
        const h = 50 + rnd() * 110, r = 6 + rnd() * 6;
        shiny.push(col(new THREE.CylinderGeometry(r, r * 1.1, h, 16).translate(0, h / 2, 0), 0xc89040));
        for (let y = 10; y < h - 6; y += 12) {
          shiny.push(col(new THREE.TorusGeometry(r * 1.06, 0.6, 6, 20).rotateX(Math.PI / 2).translate(0, y, 0), 0x8a5a2a));
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + y;
            glow.push(col(new THREE.PlaneGeometry(1.6, 2.6).rotateY(-a + Math.PI / 2).translate(Math.cos(a) * r * 1.01, y + 4, Math.sin(a) * r * 1.01), 0xffc060, 2.2));
          }
        }
        shiny.push(col(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, h, 0), 0x4a8a8a));
        body.push(col(new THREE.CylinderGeometry(1.4, 1.6, 14, 10).translate(r * 0.5, h + 7, 0), 0x3a2a20));
        body.push(island(r * 2.2, 0x6a5a4a, 0x5a4a3a, 0x3a2e24).translate(0, -1.6, 0));
        return { body, shiny, glow, peg: r * 2.2 };
      }, 30, 320);
      break;
    }
    case 'disco': {
      // mirror balls hanging in the night, turning
      ring(9, (k) => {
        const R = 10 + rnd() * 18;
        const g = new THREE.IcosahedronGeometry(R, 2).toNonIndexed();
        g.computeVertexNormals();
        return { shiny: [col(g, () => pick([0xe8e8f8, 0xc8c8e0, 0xf8f0ff, 0xb8c0e0]))], y: 60 + rnd() * 90, spin: (k % 2 ? 1 : -1) * 0.2, bob: 2 };
      }, 110, 300);
      // towers of speakers and light, standing in the sea
      ring(16, () => {
        const body: G[] = [], glow: G[] = [];
        const w = 14 + rnd() * 12, h = 50 + rnd() * 120, c = pick([0xff3a8a, 0x2fa8ff, 0xffd21f, 0xb05aff, 0x2fe06a]);
        body.push(col(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), 0x18102a));
        for (let y = 8; y < h - 4; y += 7) glow.push(col(new THREE.BoxGeometry(w + 0.5, 1.1, w + 0.5).translate(0, y, 0), c, 2.2));
        for (let q = 0; q < 3; q++) body.push(col(new THREE.CylinderGeometry(w * 0.28, w * 0.28, 0.6, 20).rotateX(Math.PI / 2).translate(0, h * (0.25 + q * 0.25), w / 2 + 0.3), 0x3a3a50));
        return { body, glow, peg: w };
      }, 40, 320);
      // records lying on the water, spinning
      ring(7, (k) => {
        const R = 40 + rnd() * 40;
        const body = [col(new THREE.CylinderGeometry(R, R, 2.4, 40), (x, _y, z) => (Math.floor(Math.hypot(x, z) / 3) % 2 ? 0x141420 : 0x1e1e2e))];
        const glow = [col(new THREE.CylinderGeometry(R * 0.3, R * 0.3, 2.6, 28), pick([0xff3a8a, 0x2fa8ff, 0xffd21f]), 1.6)];
        return { body, glow, y: 1, peg: R, spin: (k % 2 ? 1 : -1) * 0.25 };
      }, 200, 260);
      break;
    }
    case 'circus': {
      const tent = (R: number, h: number, a: number, b: number): G[] => {
        const gs: G[] = [];
        gs.push(col(new THREE.CylinderGeometry(R, R, h * 0.45, 24, 1, true).translate(0, h * 0.22, 0), (x, _y, z) => (Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 16) % 2 ? a : b)));
        gs.push(col(new THREE.ConeGeometry(R * 1.12, h * 0.55, 24, 1, true).translate(0, h * 0.72, 0), (x, _y, z) => (Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 16) % 2 ? a : b)));
        gs.push(col(new THREE.CylinderGeometry(R * 0.03, R * 0.03, h * 0.2, 6).translate(0, h * 1.08, 0), 0xffffff));
        gs.push(T(col(new THREE.ConeGeometry(R * 0.07, R * 0.24, 3).rotateZ(-Math.PI / 2).scale(1, 1, 0.2), b === 0xffffff ? a : b), R * 0.12, h * 1.14, 0));
        return gs;
      };
      // the big tents out on the grass
      ring(11, () => {
        const R = 24 + rnd() * 34, h = R * (1.1 + rnd() * 0.4);
        const [a, b] = pick([[0xe8283a, 0xffffff], [0x2f6aff, 0xffffff], [0xffc21f, 0xe8283a], [0x37c25a, 0xfff0c0], [0xb05aff, 0xffc21f]]);
        return { body: tent(R, h, a, b), peg: R };
      }, 50, 320);
      // a great wheel, turning
      ring(2, (k) => {
        const R = 60 + rnd() * 20;
        const gs: G[] = [col(new THREE.TorusGeometry(R, 1.1, 8, 48), 0xffc21f), col(new THREE.TorusGeometry(R * 0.6, 0.7, 8, 36), 0xe8283a)];
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          gs.push(T(col(new THREE.CylinderGeometry(0.5, 0.5, R, 6).translate(0, R / 2, 0), 0xffffff), 0, 0, 0, 0, 0, a - Math.PI / 2));
          gs.push(col(new THREE.BoxGeometry(6, 6, 6).translate(Math.cos(a) * R, Math.sin(a) * R, 0), pick([0xe8283a, 0x2f6aff, 0x37c25a, 0xff7a2a])));
        }
        return { shiny: gs, y: R + 10, turn: (k % 2 ? 1 : -1) * 0.1 };
      }, 180, 120);
      // balloons going up
      ring(20, () => {
        const R = 3 + rnd() * 4;
        const g = lathe([[0, -R * 1.25], [R * 0.2, -R * 1.05], [R * 0.75, -R * 0.2], [R, R * 0.35], [R * 0.75, R * 0.95], [0, R * 1.25]], 16);
        return { shiny: [col(g, pick([0xe8283a, 0xffc21f, 0x2f6aff, 0x37c25a, 0xff5ab0, 0xb05aff]))], y: 30 + rnd() * 120, bob: 3 };
      }, 40, 240);
      break;
    }
    case 'pirate': {
      const ship = (s: number, sail: number): G[] => {
        const gs: G[] = [];
        const hull = new THREE.CylinderGeometry(9 * s, 5 * s, 9 * s, 12, 1).scale(0.55, 1, 2.5).translate(0, 4.5 * s, 0);
        gs.push(col(hull, (_x, y) => (y > 6.8 * s ? 0xc89a40 : y > 4 * s ? 0x7a4a24 : 0x5a3418)));
        gs.push(col(new THREE.BoxGeometry(9 * s, 5 * s, 8 * s).translate(0, 10 * s, -18 * s), 0x8a5a2e));
        for (const [z, h] of [[-8, 34], [8, 30]] as const) {
          gs.push(col(new THREE.CylinderGeometry(0.5 * s, 0.7 * s, h * s, 8).translate(0, 8 * s + (h * s) / 2, z * s), 0x4a2e18));
          for (const [y, w] of [[0.45, 14], [0.75, 10]] as const) {
            const sl = new THREE.PlaneGeometry(w * s, h * s * 0.27, 6, 3);
            const p = sl.getAttribute('position');
            for (let i = 0; i < p.count; i++) p.setZ(i, Math.cos((p.getX(i) / (w * s)) * Math.PI) * 2.4 * s);
            gs.push(col(sl.translate(0, 8 * s + h * s * y, z * s + 1.2 * s), (x) => (Math.floor(x / (2.6 * s) + 20) % 2 ? sail : 0xfff4e0)));
          }
        }
        return gs;
      };
      // ships at anchor
      ring(7, () => {
        const s = 1.2 + rnd() * 1.1;
        const sail = pick([0xc83a3a, 0xfff4e0, 0x2a2a34, 0x2a6a9a]);
        return { body: ship(s, sail), bob: 0.8, peg: 14 * s };
      }, 90, 280);
      // rocky islands with palms
      ring(14, () => {
        const R = 24 + rnd() * 34;
        const body: G[] = [rough(col(new THREE.SphereGeometry(R, 12, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55 + rnd() * 0.5, 1), (_x, y) => (y < R * 0.1 ? 0xf0d8a0 : y < R * 0.3 ? 0x8a9a5a : 0x7a6a5a)), 0.1, 0.4)];
        const n = 2 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) {
          const a = rnd() * 6.28;
          for (const g of palm(16 + rnd() * 12, rnd() * 1.4).body) body.push(T(g, Math.cos(a) * R * 0.5, R * 0.3, Math.sin(a) * R * 0.5, 0, a));
        }
        return { body, peg: R };
      }, 40, 340);
      // a grinning rock (eyes in a cliff), far out
      ring(2, () => {
        const R = 70;
        const body: G[] = [rough(col(new THREE.SphereGeometry(R, 16, 12).scale(1, 0.9, 0.9), 0xa8a090), 0.05, 0.5)];
        for (const e of [-1, 1]) body.push(T(col(new THREE.SphereGeometry(R * 0.2, 12, 10), 0x201a18), e * R * 0.36, R * 0.2, R * 0.74));
        for (let i = -2; i <= 2; i++) body.push(T(col(new THREE.BoxGeometry(R * 0.13, R * 0.2, R * 0.2), 0x201a18), i * R * 0.17, -R * 0.28, R * 0.74));
        return { body, y: R * 0.35, peg: R };
      }, 300, 120);
      break;
    }
    case 'toybox': {
      const bright = [0xff4f6a, 0xffc21f, 0x37c25a, 0x2fa8ff, 0x9a5bff, 0xff8a1f];
      // towers of building blocks
      ring(16, () => {
        const gs: G[] = [];
        let y = 0;
        const n = 3 + Math.floor(rnd() * 5);
        for (let i = 0; i < n; i++) {
          const w = 18 + rnd() * 16, h = 12 + rnd() * 10, c = pick(bright);
          const off = (rnd() - 0.5) * 6;
          gs.push(T(col(new THREE.BoxGeometry(w, h, w), c), off, y + h / 2, off * 0.6, 0, rnd() * 0.6));
          for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) gs.push(T(col(new THREE.CylinderGeometry(w * 0.13, w * 0.13, 2, 14), c), off + sx * w * 0.24, y + h + 1, off * 0.6 + sz * w * 0.24));
          y += h;
        }
        return { shiny: gs, peg: 18 };
      }, 40, 320);
      // crayons stood on end
      ring(12, () => {
        const c = pick(bright), r = 5 + rnd() * 3, h = 70 + rnd() * 70;
        return { shiny: [col(new THREE.CylinderGeometry(r, r, h, 12).translate(0, h / 2, 0), (_x, y) => (y > h * 0.1 && y < h * 0.86 && Math.floor(y / 9) % 3 === 0 ? 0x2a2a34 : c)), col(new THREE.ConeGeometry(r, r * 2.2, 12).translate(0, h + r * 1.1, 0), c)], peg: r * 2 };
      }, 70, 320);
      // stacking rings on a post
      ring(6, () => {
        const gs: G[] = [col(new THREE.CylinderGeometry(3, 3, 60, 12).translate(0, 30, 0), 0xfff0c8)];
        let y = 3;
        for (let i = 0; i < 6; i++) {
          const R = 24 - i * 3.2;
          gs.push(col(new THREE.TorusGeometry(R * 0.72, R * 0.3, 10, 26).rotateX(Math.PI / 2).translate(0, y, 0), bright[i]));
          y += R * 0.5;
        }
        return { shiny: gs, peg: 26 };
      }, 110, 280);
      // ducks afloat
      ring(9, () => {
        const s = 6 + rnd() * 8;
        const gs: G[] = [col(new THREE.SphereGeometry(s * 1.4, 18, 12).scale(1.3, 0.85, 1), 0xffd21f).translate(0, s, 0), col(new THREE.SphereGeometry(s * 0.85, 16, 12), 0xffd21f).translate(s * 1.25, s * 2.2, 0), col(new THREE.ConeGeometry(s * 0.34, s * 0.8, 10).rotateZ(-Math.PI / 2), 0xff7a1f).translate(s * 2.25, s * 2.1, 0)];
        for (const e of [-1, 1]) gs.push(col(new THREE.SphereGeometry(s * 0.13, 8, 6), 0x20202a).translate(s * 1.85, s * 2.5, e * s * 0.42));
        return { shiny: gs, bob: 1.2, peg: s * 1.6 };
      }, 60, 300);
      break;
    }
    default:
      break;
  }
  return P;
}

/** the scenery for one world: build once, lay round a course, animate */
export class Scenery {
  readonly group = new THREE.Group();
  private items: { o: THREE.Object3D; p: Piece; y0: number }[] = [];
  constructor(readonly id: BiomeId) {
    for (const p of build(id)) {
      const o = new THREE.Group();
      const add = (gs: G[] | undefined, m: THREE.Material, shadow: boolean) => {
        if (!gs?.length) return;
        const mesh = new THREE.Mesh(merge(gs), m);
        mesh.castShadow = shadow;
        o.add(mesh);
      };
      add(p.body, BODY, true);
      add(p.shiny, SHINY, true);
      add(p.glow, GLOW, false);
      if (p.peg) o.userData.peg = p.peg;
      this.group.add(o);
      this.items.push({ o, p, y0: p.y ?? 0 });
    }
  }
  get empty() {
    return this.items.length === 0;
  }
  /** round a course reaching `reach` m out from its middle */
  layout(reach: number) {
    for (const { o, p, y0 } of this.items) {
      const r = reach + p.d;
      o.position.set(Math.cos(p.a) * r, y0, Math.sin(p.a) * r);
      // (facing the course: a pumpkin's face, a boat side-on)
      o.rotation.y = Math.PI / 2 - p.a;
    }
  }
  update(t: number) {
    for (const { o, p, y0 } of this.items) {
      if (p.spin) o.rotation.y += p.spin * 0.016;
      if (p.bob) o.position.y = y0 + Math.sin(t * 0.5 + p.a * 3) * p.bob;
      if (p.turn) for (const c of o.children) c.rotation.z = t * p.turn;
      if (p.flash) {
        // (a strike: a flicker or two, now and then, each bolt on its own clock)
        const k = Math.floor(t * 9 + p.a * 31);
        const h = Math.sin(k * 12.9898 + p.a * 78.233) * 43758.5453;
        o.visible = h - Math.floor(h) > 0.985 || (h - Math.floor(h) > 0.97 && Math.floor(t * 9 + p.a * 31) % 2 === 0);
      }
    }
  }
}
