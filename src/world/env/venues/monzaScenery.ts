import * as THREE from 'three';
import type { Layout } from '../layout.ts';
import type { WorldMap } from '../worldmap.ts';
import { hash2i, rng } from '../noise.ts';
import { Merge, cityMaterial } from './montrealCity.ts';

/**
 * Monza's own landmarks beyond the circuit, for the helicopter, the intro and the long lenses:
 *
 *   the Villa Reale     the Piermarini palace (1777–80) at the park's southern end: the three-storey
 *                       corps de logis with its pedimented centre, the two long wings round the cour
 *                       d'honneur facing the town, cornices, an attic balustrade and grey hipped roofs;
 *                       the formal lawns behind it run north into the park
 *   Milan               the skyline 13–15 km to the south-west across the plain: Porta Nuova (the
 *                       Unicredit tower and its spire, Solaria, the Diamond, Bosco Verticale's green
 *                       twins), the Pirelli tower's slim lens, CityLife's three (Isozaki's straight
 *                       Allianz, Hadid's twisting Generali, Libeskind's curving PwC), Torre Velasca's
 *                       mushroom top, the Duomo's white marble and its spire, and the city round them
 *
 * Facades use the city window shader (cityMaterial: the Villa in its classical mode, so its windows
 * are tall piano-nobile openings); roofs, cornices, spires and ornament are a plain vertex-colour mesh.
 * No shadows beyond the park; a few hundred boxes in all.
 */

const C = (h: number) => new THREE.Color(h);

/** plain vertex-colour geometry with true face normals (roofs, cornices, spires: no windows) */
class Plain {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  private readonly e1 = new THREE.Vector3();
  private readonly e2 = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, k: THREE.Color) {
    this.e1.subVectors(b, a);
    this.e2.subVectors(c, a);
    this.n.crossVectors(this.e1, this.e2).normalize();
    for (const p of [a, b, c]) {
      this.pos.push(p.x, p.y, p.z);
      this.nor.push(this.n.x, this.n.y, this.n.z);
      this.col.push(k.r, k.g, k.b);
    }
  }
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, k: THREE.Color) {
    this.tri(a, b, c, k);
    this.tri(a, c, d, k);
  }
  /** box centred on (x, z), base y0, top y1, w × d, yawed by rot; the top shrunk by `taper` (a hipped roof at 0) */
  box(x: number, z: number, y0: number, y1: number, w: number, d: number, rot: number, k: THREE.Color, taperW = 1, taperD = taperW) {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const P = (lx: number, lz: number, y: number) => new THREE.Vector3(x + lx * ca + lz * sa, y, z - lx * sa + lz * ca);
    const hw = w / 2, hd = d / 2, tw = hw * taperW, td = hd * taperD;
    const b = [P(-hw, -hd, y0), P(hw, -hd, y0), P(hw, hd, y0), P(-hw, hd, y0)];
    const t = [P(-tw, -td, y1), P(tw, -td, y1), P(tw, td, y1), P(-tw, td, y1)];
    // (outward winding: counter-clockwise seen from outside)
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(b[j], b[i], t[i], t[j], k);
    }
    if (tw > 0.01 || td > 0.01) this.quad(t[3], t[2], t[1], t[0], k);
  }
  /** a gable's triangle (pediment) in the plane facing local +z, base width w at y0, apex at y1 */
  gable(x: number, z: number, y0: number, y1: number, w: number, depth: number, rot: number, k: THREE.Color) {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const P = (lx: number, lz: number, y: number) => new THREE.Vector3(x + lx * ca + lz * sa, y, z - lx * sa + lz * ca);
    const fl = P(-w / 2, depth / 2, y0), fr = P(w / 2, depth / 2, y0), fa = P(0, depth / 2, y1);
    const bl = P(-w / 2, -depth / 2, y0), br = P(w / 2, -depth / 2, y0), ba = P(0, -depth / 2, y1);
    this.tri(fl, fr, fa, k);
    this.tri(br, bl, ba, k);
    this.quad(fr, br, ba, fa, k);
    this.quad(bl, fl, fa, ba, k);
  }
  /** a square-section post from a to b */
  post(a: THREE.Vector3, b: THREE.Vector3, s: number, k: THREE.Color, sTop = s) {
    const h = s / 2, ht = sTop / 2;
    const B0 = [new THREE.Vector3(-h, 0, -h), new THREE.Vector3(h, 0, -h), new THREE.Vector3(h, 0, h), new THREE.Vector3(-h, 0, h)].map((v) => v.add(a));
    const T0 = [new THREE.Vector3(-ht, 0, -ht), new THREE.Vector3(ht, 0, -ht), new THREE.Vector3(ht, 0, ht), new THREE.Vector3(-ht, 0, ht)].map((v) => v.add(b));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(B0[j], B0[i], T0[i], T0[j], k);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

export interface MonzaSceneryBuild {
  group: THREE.Group;
  count: number;
}

export function buildMonzaScenery(layout: Layout, map: WorldMap): MonzaSceneryBuild {
  const group = new THREE.Group();
  group.name = 'MonzaScenery';
  const fac = new Merge();
  const plain = new Plain();
  let count = 0;
  // (the height grid stops at the far terrain's edge, ~15 km out: Milan's far side samples its rim)
  const F = map.FAR;
  const ground = (x: number, z: number) => map.height(Math.min(F.x1 - 64, Math.max(F.x0 + 64, x)), Math.min(F.z1 - 64, Math.max(F.z0 + 64, z))) - 0.4;
  const centre = map.A.center;
  /** a point at compass bearing `deg` (0 = north = −z, 90 = east = +x) and distance d from the circuit's centre */
  const bearing = (deg: number, d: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: centre.x + Math.sin(a) * d, z: centre.z - Math.cos(a) * d };
  };

  // ---------------------------------------------------------------- the Villa Reale
  const villa = layout.landmarks?.find((l) => l.kind === 'villa');
  if (villa) {
    count++;
    const rot = villa.rot;
    const ca = Math.cos(rot), sa = Math.sin(rot);
    // local frame: +z toward the town (the cour d'honneur's open side), x along the corps de logis
    const at = (lx: number, lz: number) => ({ x: villa.x + lx * ca + lz * sa, z: villa.z - lx * sa + lz * ca });
    const y = villa.y - 0.3;
    const WALL = C(0xe6d6b2), WALL2 = C(0xdcc9a2), STONE = C(0xeee8da), ROOF = C(0x6f6b66), PLINTH = C(0xb9ad97);
    /** one block: classical facade, cornice, (attic) and hipped roof */
    const block = (lx: number, lz: number, w: number, d: number, h: number, wall: THREE.Color, attic: boolean, seed: number) => {
      const p = at(lx, lz);
      fac.seed = seed;
      fac.base = y;
      fac.box(p.x, p.z, y, y + h, w, d, rot, wall, 2, 0.15);
      fac.seed = 0;
      plain.box(p.x, p.z, y - 0.6, y + 1.1, w + 0.6, d + 0.6, rot, PLINTH);
      plain.box(p.x, p.z, y + h, y + h + 0.9, w + 1.4, d + 1.4, rot, STONE);
      let top = y + h + 0.9;
      if (attic) {
        plain.box(p.x, p.z, top, top + 1.5, w - 0.6, d - 0.6, rot, STONE);
        top += 1.5;
      }
      // hipped roof: the ridge runs along the longer side
      const rw = w - 1.2, rd = d - 1.2;
      const [tw, td] = rw >= rd ? [Math.max(0.05, 1 - (rd * 0.9) / rw), 0.06] : [0.06, Math.max(0.05, 1 - (rw * 0.9) / rd)];
      plain.box(p.x, p.z, top, top + Math.min(6, Math.min(rw, rd) * 0.3), rw, rd, rot, ROOF, tw, td);
      return top;
    };
    // the corps de logis and its pedimented centre on the courtyard side
    block(0, 0, 118, 24, 21, WALL, true, 0.31);
    block(0, 14, 34, 6, 22.5, WALL2, false, 0.31);
    {
      const p = at(0, 15.5);
      plain.gable(p.x, p.z, y + 23.4, y + 28.4, 35, 3.2, rot, STONE);
      // the giant order: six columns across the centre
      for (let k = -2.5; k <= 2.5; k++) {
        const q = at(k * 5.2, 17.6);
        plain.post(new THREE.Vector3(q.x, y + 1.1, q.z), new THREE.Vector3(q.x, y + 22.4, q.z), 1.4, STONE, 1.2);
      }
    }
    // the garden front (north): a shallower centre
    block(0, -13.5, 30, 4, 22, WALL2, false, 0.31);
    // the two long wings round the cour d'honneur, a taller pavilion at each end
    for (const sx of [-1, 1]) {
      block(sx * 50, 52, 18, 80, 17, WALL, false, 0.47 + sx * 0.01);
      block(sx * 50, 96, 24, 12, 19, WALL2, true, 0.47 + sx * 0.01);
    }
    // the low service wings beyond them (the Rotonda and the Teatrino side)
    for (const sx of [-1, 1]) block(sx * 82, 20, 34, 14, 11, WALL2, false, 0.63);
    // the gravel cour d'honneur and the parterre lawns behind
    {
      const p = at(0, 58);
      plain.box(p.x, p.z, y - 0.2, y + 0.42, 80, 84, rot, C(0xc9bda4));
      for (const [lx, lz] of [[-24, -70], [24, -70], [-24, -130], [24, -130]]) {
        const q = at(lx, lz);
        plain.box(q.x, q.z, y - 0.2, y + 0.45, 38, 50, rot, C(0x5f7a3c));
        // clipped box hedges round each parterre
        for (const [hx, hz, hw, hd] of [[0, 25, 38, 0.8], [0, -25, 38, 0.8], [19, 0, 0.8, 50], [-19, 0, 0.8, 50]]) {
          const r = at(lx + hx, lz + hz);
          plain.box(r.x, r.z, y, y + 1.3, hw, hd, rot, C(0x2f4a22));
        }
      }
      // the fountain on the garden axis
      const f = at(0, -100);
      plain.box(f.x, f.z, y, y + 0.7, 9, 9, rot, STONE);
      plain.box(f.x, f.z, y + 0.55, y + 0.62, 8, 8, rot, C(0x5d7280));
    }
  }

  // ---------------------------------------------------------------- Milan across the plain
  {
    const r = rng(1789);
    /** a tower in the facade shader, its storeys counted from its own base */
    const glass = (x: number, z: number, y: number, h: number, w: number, d: number, rot: number, col: number, curtain = 1, refl = 0.9, seed = r()) =>
      fac.tower(x, z, y, h, w, d, rot, C(col), curtain, refl, seed);
    const sliced = (x: number, z: number, y: number, h: number, w: number, d: number, col: number, fn: (t: number) => { dx: number; dz: number; rot: number; s: number }) => {
      // stacked slices: a twisting / curving tower
      const n = Math.round(h / 6);
      fac.seed = 0.37 + r() * 0.5;
      fac.base = y;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const f = fn(t);
        fac.box(x + f.dx, z + f.dz, y + (h * i) / n, y + (h * (i + 1)) / n + 0.05, w * f.s, d * f.s, f.rot, C(col), 1, 1);
      }
      fac.seed = 0;
    };
    // Porta Nuova (≈ 13.8 km, bearing 205)
    const PN = bearing(205, 13800);
    const yPN = ground(PN.x, PN.z);
    {
      count++;
      // Unicredit: the curved glass crescent of three, the tallest crowned by its spire
      const u = PN;
      glass(u.x, u.z, yPN, 140, 46, 30, 0.6, 0x7f97ab, 1, 1, 0.71);
      plain.box(u.x, u.z, yPN + 140, yPN + 160, 40, 26, 0.6, C(0x8ea3b4), 0.5, 0.4);
      plain.post(new THREE.Vector3(u.x, yPN + 158, u.z), new THREE.Vector3(u.x, yPN + 231, u.z), 2.2, C(0xd8dadb), 0.4);
      glass(u.x - 52, u.z + 30, yPN, 100, 34, 26, 0.9, 0x7c93a6, 1, 1, 0.73);
      glass(u.x + 46, u.z + 34, yPN, 84, 30, 24, 0.25, 0x7c93a6, 1, 1, 0.77);
      // Solaria (white balconies), the Diamond (dark faceted glass), Bosco Verticale (green twins)
      glass(u.x - 260, u.z - 120, yPN, 143, 32, 30, 0.2, 0xd8d6cf, 0.55, 0.4, 0.13);
      fac.seed = 0.81;
      fac.base = yPN;
      fac.box(u.x + 380, u.z - 60, yPN, yPN + 140, 44, 36, -0.4, C(0x3d4d63), 1, 1, 0.55);
      fac.seed = 0;
      for (const [dx, dz, h] of [[-120, -380, 111], [-80, -420, 76]] as const) {
        glass(u.x + dx, u.z + dz, yPN, h, 30, 30, 0.1, 0x55634a, 0, 0.1, 0.29);
      }
      // the Pirelli tower: the slim lens-shaped slab by the Central Station
      const pi = { x: u.x + 980, z: u.z + 260 };
      fac.prism(pi.x, pi.z, yPN, yPN + 127, 70, 19, 0.75, C(0x8a9aa1), 1, 0.7, 7);
      plain.box(pi.x, pi.z, yPN + 127, yPN + 129, 66, 14, 0.75, C(0x6d7478));
    }
    // CityLife (≈ 14.6 km, bearing 214)
    {
      count++;
      const CL = bearing(214, 14600);
      const y = ground(CL.x, CL.z);
      // Allianz "il Dritto": straight, a buttress at each end
      glass(CL.x, CL.z, y, 209, 60, 24, 0.5, 0xbfc9cf, 1, 1, 0.53);
      for (const s of [-1, 1]) plain.box(CL.x + Math.cos(0.5) * 33 * s, CL.z - Math.sin(0.5) * 33 * s, y, y + 205, 4, 22, 0.5, C(0xe4e6e6));
      // Generali "lo Storto": a twist up its height
      sliced(CL.x + 260, CL.z + 140, y, 185, 40, 40, 0x9fb4c0, (t) => ({ dx: 0, dz: 0, rot: 0.2 + t * 0.9, s: 1 }));
      // PwC "il Curvo": a curved face, the top leaning over
      sliced(CL.x - 220, CL.z + 180, y, 175, 54, 30, 0x8aa2b3, (t) => ({ dx: -Math.sin(t * 1.4) * 22, dz: 0, rot: 0.3, s: 1 - 0.12 * t }));
    }
    // the centre (≈ 15 km, bearing 203): the Duomo's marble and spire, Torre Velasca's mushroom top
    {
      count++;
      const D = bearing(203, 15100);
      const y = ground(D.x, D.z);
      const MARBLE = C(0xebe6dc);
      plain.box(D.x, D.z, y, y + 45, 66, 158, 0.15, MARBLE);
      plain.box(D.x, D.z, y + 45, y + 56, 40, 150, 0.15, C(0xd8d2c6), 0.5, 1);
      plain.post(new THREE.Vector3(D.x, y + 45, D.z), new THREE.Vector3(D.x, y + 108, D.z), 7, MARBLE, 0.6);
      for (let k = -6; k <= 6; k++)
        for (const s of [-1, 1]) {
          const px = D.x + Math.cos(0.15) * 34 * s + Math.sin(0.15) * k * 12, pz = D.z - Math.sin(0.15) * 34 * s + Math.cos(0.15) * k * 12;
          plain.post(new THREE.Vector3(px, y + 40, pz), new THREE.Vector3(px, y + 60, pz), 1.2, MARBLE, 0.15);
        }
      const V = { x: D.x + 420, z: D.z + 260 };
      fac.seed = 0.43;
      fac.base = y;
      fac.box(V.x, V.z, y, y + 74, 28, 28, 0.15, C(0xb08a76), 0, 0);
      fac.box(V.x, V.z, y + 74, y + 100, 36, 36, 0.15, C(0xb08a76), 0, 0);
      fac.seed = 0;
      // the struts flaring out under the overhang
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const a = new THREE.Vector3(V.x + sx * 12, y + 62, V.z + sz * 12), b = new THREE.Vector3(V.x + sx * 17, y + 74, V.z + sz * 17);
        plain.post(a, b, 1.6, C(0x9c7a68));
      }
      plain.box(V.x, V.z, y + 100, y + 106, 30, 30, 0.15, C(0x7d6a60), 0.6);
    }
    // the city round them: mid-rise blocks and a scatter of towers between Porta Nuova and the centre
    {
      const A = bearing(207, 14400);
      const ux = Math.cos(0.4), uz = -Math.sin(0.4);
      let n = 0;
      for (let a = -3200; a <= 3200; a += 140)
        for (let b = -1800; b <= 1800; b += 140) {
          const ia = Math.round(a / 140), ib = Math.round(b / 140);
          const h0 = hash2i(ia, ib, 7);
          if (h0 > 0.55) continue;
          const x = A.x + ux * a - uz * b, z = A.z + uz * a + ux * b;
          // leave the named towers' plots free
          if (Math.hypot(x - PN.x, z - PN.z) < 520) continue;
          const tall = hash2i(ia, ib, 9);
          const h = tall > 0.93 ? 70 + tall * 50 : 22 + hash2i(ia, ib, 11) * 22;
          const col = [0xd9d2c4, 0xc7bfb0, 0xbcb5a8, 0xe1dccf, 0xa9a7a2, 0x9aa9b4][Math.floor(hash2i(ia, ib, 13) * 6)];
          fac.tower(x, z, ground(x, z), h, 40 + hash2i(ia, ib, 15) * 40, 30 + hash2i(ia, ib, 17) * 30, 0.4, C(col), tall > 0.93 ? 1 : 0, tall > 0.93 ? 0.8 : 0, hash2i(ia, ib, 19));
          n++;
        }
      count += n;
    }
  }

  const facMesh = new THREE.Mesh(fac.geometry(), cityMaterial(false));
  facMesh.name = 'monza_buildings';
  const plainMesh = new THREE.Mesh(plain.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }));
  plainMesh.name = 'monza_ornament';
  for (const m of [facMesh, plainMesh]) {
    // (beyond the park's shadow cascade: no casting; the Villa receives the sun's shade)
    m.castShadow = false;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
  }
  group.matrixAutoUpdate = false;
  return { group, count };
}
