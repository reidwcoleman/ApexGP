import * as THREE from 'three';
import type { WorldMap } from '../worldmap.ts';
import { fbm2, hash2i, rng } from '../noise.ts';
import { floodUniforms } from '../night.ts';
import { SITES, montrealGeo } from './montrealLand.ts';

/**
 * Montréal across the water, for the TV, helicopter and blimp cameras (and the view down
 * the pit straight): the downtown towers 3–4 km west (1000 de La Gauchetière's copper
 * pyramid, 1250 René-Lévesque's crown, Place Ville Marie's aluminium cross, the dark
 * Tour de la Bourse and CIBC tower…) standing over Old Montréal's grey stone and red brick,
 * the Old Port's quays and the Farine Five Roses sign, Mont Royal behind with its cross and
 * transmitter, the Olympic Stadium's leaning tower far to the north; Longueuil and
 * Saint-Lambert low on the south shore.
 *
 * Cost: generic buildings are one instanced box (the roofs are shaded in), the named towers
 * and the landmarks one merged mesh; a small window shader (curtain walls reflect the sky,
 * windows light up at night). No shadows.
 */

export interface CityBuild {
  group: THREE.Group;
  count: number;
}

const C = (h: number) => new THREE.Color(h);
const STONE = [0x9c968c, 0x8a857c, 0xb0a99c, 0x7d7870, 0xa89f90].map(C);
const BRICK = [0x8a4a36, 0x7c4231, 0x9a5842, 0x6f3a2c, 0xa46048].map(C);
const MODERN = [0xc9ccce, 0xb4b9bd, 0x8f979e, 0xd8d6d0, 0x6d757c, 0xa7aeb3, 0xe2e0da].map(C);
const SUBURB = [0xd9d2c4, 0xc8bca8, 0xb9a58c, 0x9a6a50, 0xe3ddd0, 0xa9a39a].map(C);

/** window-band shader for buildings: aWin.x = curtain wall 0…1, aWin.y = glass reflectivity */
function cityMaterial(instanced: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: !instanced, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFlood = { value: floodUniforms.params };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWin;\nvarying vec2 vWin;\nvarying vec3 vCW;\nvarying vec3 vCN;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
{
  mat4 cm = modelMatrix;
  #ifdef USE_INSTANCING
  cm = modelMatrix * instanceMatrix;
  #endif
  vCW = ( cm * vec4( transformed, 1.0 ) ).xyz;
  vCN = normalize( mat3( cm ) * objectNormal );
  vWin = aWin;
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uFlood;\nvarying vec2 vWin;\nvarying vec3 vCW;\nvarying vec3 vCN;\nfloat cWin;\nfloat cLit;\nfloat cH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float side = 1.0 - smoothstep( 0.3, 0.6, abs( vCN.y ) );
  vec2 tan2 = normalize( vec2( -vCN.z, vCN.x ) + 1e-4 );
  float u = dot( vCW.xz, tan2 );
  float fl = vCW.y / 3.7;
  float fu = fract( fl ), cu = fract( u / 3.2 );
  float punched = step( 0.32, fu ) * step( fu, 0.82 ) * step( 0.18, cu ) * step( cu, 0.82 );
  float curtain = step( 0.12, fu );
  cWin = mix( punched, curtain, vWin.x ) * side * step( 2.5, vCW.y - 0.0 );
  vec3 glass = mix( vec3( 0.05, 0.065, 0.08 ), vec3( 0.16, 0.2, 0.24 ), vWin.y );
  diffuseColor.rgb = mix( diffuseColor.rgb, glass, cWin * 0.88 );
  // flat roofs: tar and gravel, a paler parapet line
  float roof = smoothstep( 0.6, 0.9, vCN.y );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.075, 0.074, 0.072 ) * ( 0.85 + 0.3 * cH( floor( vCW.xz / 9.0 ) ) ), roof * ( 1.0 - vWin.y * 0.5 ) );
  cLit = step( cH( floor( vec2( u / 3.2, fl ) ) + floor( vCW.xz / 97.0 ) ), 0.3 ) * cWin;
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.12, cWin * vWin.y );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, 0.75, cWin * vWin.y );')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3( 1.0, 0.78, 0.5 ) * cLit * 0.9 * smoothstep( 0.0, 0.5, uFlood.x );`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-mtl-city-' + (instanced ? 'i' : 'm');
  return mat;
}

interface Box {
  x: number; z: number; y: number;
  w: number; d: number; h: number;
  rot: number;
  col: THREE.Color;
  curtain: number;
  refl: number;
}

/** merged-mesh builder: boxes with colour + aWin */
class Merge {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  win: number[] = [];
  idx: number[] = [];
  private static readonly F: [number[], number[][]][] = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
  ];
  /** box centred on (x, z), base y0, top y1, yawed by rot */
  box(x: number, z: number, y0: number, y1: number, w: number, d: number, rot: number, c: THREE.Color, curtain = 0, refl = 0, taperTop = 1) {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    for (const [n, q] of Merge.F) {
      const b = this.pos.length / 3;
      for (const [px, py, pz] of q) {
        const k = py > 0 ? taperTop : 1;
        const lx = (px * w * k) / 2, lz = (pz * d * k) / 2;
        this.pos.push(x + lx * ca + lz * sa, py > 0 ? y1 : y0, z - lx * sa + lz * ca);
        this.nor.push(n[0] * ca + n[2] * sa, n[1], -n[0] * sa + n[2] * ca);
        this.col.push(c.r, c.g, c.b);
        this.win.push(curtain, refl);
      }
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  /** a pyramid roof (square base w × d at y0, apex at y1) */
  pyramid(x: number, z: number, y0: number, y1: number, w: number, d: number, rot: number, c: THREE.Color) {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const P = (lx: number, lz: number, y: number) => [x + lx * ca + lz * sa, y, z - lx * sa + lz * ca];
    const corners = [P(-w / 2, -d / 2, y0), P(w / 2, -d / 2, y0), P(w / 2, d / 2, y0), P(-w / 2, d / 2, y0)];
    const apex = P(0, 0, y1);
    for (let k = 0; k < 4; k++) {
      const a = corners[k], b = corners[(k + 1) % 4];
      const e1 = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const e2 = new THREE.Vector3(apex[0] - a[0], apex[1] - a[1], apex[2] - a[2]);
      const n = e2.cross(e1).normalize();
      if (n.y < 0) n.negate();
      const i = this.pos.length / 3;
      for (const p of [a, b, apex]) {
        this.pos.push(p[0], p[1], p[2]);
        this.nor.push(n.x, n.y, n.z);
        this.col.push(c.r, c.g, c.b);
        this.win.push(0, 0);
      }
      this.idx.push(i, i + 2, i + 1, i, i + 1, i + 2);
    }
  }
  /** thin beam between two points (square section s) */
  beam(a: THREE.Vector3, b: THREE.Vector3, s: number, c: THREE.Color) {
    const d = new THREE.Vector3().subVectors(b, a);
    const L = d.length();
    if (L < 1e-3) return;
    d.divideScalar(L);
    const x = new THREE.Vector3(0, 1, 0).cross(d);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize().multiplyScalar(s / 2);
    const y = new THREE.Vector3().crossVectors(d, x).normalize().multiplyScalar(s / 2);
    const P = [a.clone().sub(x).sub(y), a.clone().add(x).sub(y), a.clone().add(x).add(y), a.clone().sub(x).add(y)];
    const Q = P.map((p) => p.clone().addScaledVector(d, L));
    for (let k = 0; k < 4; k++) {
      const p0 = P[k], p1 = P[(k + 1) % 4], q1 = Q[(k + 1) % 4], q0 = Q[k];
      const n = new THREE.Vector3().subVectors(p0, a).add(new THREE.Vector3().subVectors(p1, a)).normalize();
      const i = this.pos.length / 3;
      for (const p of [p0, p1, q1, q0]) {
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(n.x, n.y, n.z);
        this.col.push(c.r, c.g, c.b);
        this.win.push(0, 0);
      }
      this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3, i, i + 2, i + 1, i, i + 3, i + 2);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWin', new THREE.Float32BufferAttribute(this.win, 2));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** downtown's centre (circuit frame): ~3.4 km west, a little north */
export const DOWNTOWN = { x: -3380, z: -330 };

export function buildMontrealCity(map: WorldMap): CityBuild {
  const r = rng(2701);
  const group = new THREE.Group();
  group.name = 'MontrealCity';
  const boxes: Box[] = [];
  const ground = (x: number, z: number) => map.height(x, z) - 0.5;
  const onLand = (x: number, z: number, margin = 20) => {
    const g = montrealGeo(map, x, z);
    return (g.land === 3 || g.land === 4) && g.coast > margin;
  };
  const D = DOWNTOWN;

  // ---------------------------------------------------------------- the city (west): blocks on a street grid
  // (the grid runs along the river, ~ 35° off north, like Montréal's "north")
  const ga = 0.6;
  const gx = Math.cos(ga), gz = Math.sin(ga);
  for (let a = -3600; a <= 3600; a += 42)
    for (let b = -2200; b <= 2200; b += 38) {
      const x = D.x + 300 + a * gx - b * gz;
      const z = D.z + a * gz + b * gx;
      if (!onLand(x, z, 40)) continue;
      const ia = Math.round(a / 42), ib = Math.round(b / 38);
      const h0 = hash2i(ia, ib, 3);
      const g = montrealGeo(map, x, z);
      if (g.land !== 3) continue;
      // density: dense near downtown and the old town, thinning out, none on the mountain
      const dd = Math.hypot(x - D.x, z - D.z);
      const Rm = SITES.royal;
      const onRoyal = Math.hypot(x - Rm.x, (z - Rm.z) * 1.25) < Rm.r * 0.8;
      if (onRoyal) continue;
      const dens = 0.85 - 0.45 * Math.min(1, dd / 3500);
      if (h0 > dens) continue;
      const core = Math.max(0, 1 - dd / 900);
      const oldTown = g.inland < 700 && z > D.z - 900 && z < D.z + 900 ? 1 : 0;
      const tall = hash2i(ia, ib, 5);
      let h = 9 + tall * 12;
      if (oldTown) h = 12 + tall * 16;
      if (core > 0 && tall > 0.35) h = 30 + core * 110 * hash2i(ia, ib, 6) ** 1.6;
      else if (tall > 0.93) h = 25 + tall * 30;
      const modern = h > 40 || hash2i(ia, ib, 8) < 0.15;
      boxes.push({
        x: x + (hash2i(ia, ib, 9) - 0.5) * 6, z: z + (hash2i(ia, ib, 10) - 0.5) * 6, y: ground(x, z),
        w: 20 + hash2i(ia, ib, 11) * 16, d: 18 + hash2i(ia, ib, 12) * 14, h, rot: ga,
        col: (modern ? MODERN[Math.floor(hash2i(ia, ib, 13) * MODERN.length)] : oldTown && hash2i(ia, ib, 14) < 0.6 ? STONE[Math.floor(hash2i(ia, ib, 15) * STONE.length)] : BRICK[Math.floor(hash2i(ia, ib, 16) * BRICK.length)]).clone().multiplyScalar(0.9 + r() * 0.2),
        curtain: modern && h > 40 ? 0.6 + 0.4 * hash2i(ia, ib, 17) : 0,
        refl: modern ? 0.5 + 0.5 * hash2i(ia, ib, 18) : 0,
      });
    }
  // the south shore: Saint-Lambert and Longueuil, low houses, a few blocks near the bridge
  for (let a = -4000; a <= 4000; a += 52)
    for (let b = 0; b <= 2600; b += 46) {
      const z = a, x = 1450 + 0.12 * z + b;
      if (!onLand(x, z, 50)) continue;
      const ia = Math.round(a / 52), ib = Math.round(b / 46);
      if (hash2i(ia, ib, 21) > 0.5 - b / 8000) continue;
      if (fbm2(x / 800 + 2, z / 800 - 1, 2) < -0.2) continue;
      const tall = hash2i(ia, ib, 22) > 0.985 || (z < -2600 && hash2i(ia, ib, 23) > 0.9);
      const h = tall ? 30 + hash2i(ia, ib, 24) * 60 : 6 + hash2i(ia, ib, 25) * 6;
      boxes.push({
        x, z, y: ground(x, z), w: tall ? 22 : 16 + hash2i(ia, ib, 26) * 10, d: tall ? 18 : 13 + hash2i(ia, ib, 27) * 8, h, rot: 0.12 + (hash2i(ia, ib, 28) < 0.5 ? 0 : 0.2),
        col: (tall ? MODERN : SUBURB)[Math.floor(hash2i(ia, ib, 29) * 6) % (tall ? MODERN.length : SUBURB.length)].clone(),
        curtain: tall ? 0.3 : 0, refl: tall ? 0.4 : 0,
      });
    }

  // ---------------------------------------------------------------- instanced generic buildings
  {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const win = new Float32Array(boxes.length * 2);
    boxes.forEach((b, i) => {
      win[i * 2] = b.curtain;
      win[i * 2 + 1] = b.refl;
    });
    geo.setAttribute('aWin', new THREE.InstancedBufferAttribute(win, 2));
    const walls = new THREE.InstancedMesh(geo, cityMaterial(true), Math.max(1, boxes.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    boxes.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot);
      m.compose(p.set(b.x, b.y, b.z), q, s.set(b.w, b.h + 0.5, b.d));
      walls.setMatrixAt(i, m);
      walls.setColorAt(i, b.col);
    });
    walls.count = boxes.length;
    walls.instanceMatrix.needsUpdate = true;
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
    walls.computeBoundingSphere();
    walls.name = 'mtl_city_blocks';
    group.add(walls);
  }

  // ---------------------------------------------------------------- the named towers and landmarks
  const M = new Merge();
  const T = (dx: number, dz: number) => ({ x: D.x + dx, z: D.z + dz, y: ground(D.x + dx, D.z + dz) });
  const rotG = ga;
  {
    // 1000 de La Gauchetière: 205 m, pale granite and glass, the copper-green pyramid on top
    const t = T(120, 260);
    M.box(t.x, t.z, t.y, t.y + 150, 48, 40, rotG, C(0xcfc8bb), 0.3, 0.4);
    M.box(t.x, t.z, t.y + 150, t.y + 172, 40, 32, rotG, C(0xcfc8bb), 0.3, 0.4);
    M.pyramid(t.x, t.z, t.y + 172, t.y + 205, 40, 32, rotG, C(0x5f9c86));
    // 1250 René-Lévesque: 199 m, tan stone with glass corners, the stepped crown and light box
    const u = T(-40, 120);
    M.box(u.x, u.z, u.y, u.y + 160, 44, 38, rotG + 0.1, C(0xb9a88e), 0.5, 0.5);
    M.box(u.x, u.z, u.y + 160, u.y + 182, 34, 30, rotG + 0.1, C(0xb9a88e), 0.5, 0.5);
    M.box(u.x, u.z, u.y + 182, u.y + 199, 20, 18, rotG + 0.1, C(0xd8d4cc), 0.8, 0.8);
    // Place Ville Marie: 188 m, the aluminium cruciform
    const v = T(260, -60);
    for (const [w, d] of [[64, 22], [22, 64]]) M.box(v.x, v.z, v.y, v.y + 188, w, d, rotG + 0.785, C(0xa6adb3), 0.2, 0.65);
    // Tour de la Bourse: 190 m, dark bronze, the four corner piers
    const b = T(560, 260);
    M.box(b.x, b.z, b.y, b.y + 190, 42, 42, rotG, C(0x3a3632), 0.7, 0.3);
    // CIBC tower: 187 m, dark green slate
    const c = T(-120, -180);
    M.box(c.x, c.z, c.y, c.y + 187, 40, 34, rotG, C(0x2f3b38), 0.3, 0.35);
    M.box(c.x, c.z, c.y + 187, c.y + 197, 6, 6, 0, C(0x9aa0a4));
    // Tour des Canadiens: 167 m, glass
    const d = T(40, -380);
    M.box(d.x, d.z, d.y, d.y + 167, 34, 26, rotG + 0.2, C(0x8fa4b4), 0.95, 0.9);
    // Deloitte tower, Tour Deloitte / Altitude / Telus: mid-height glass and stone
    for (const [dx, dz, h, w, col, cw] of [
      [340, 420, 132, 36, 0x9fb5c4, 0.95], [-300, 320, 128, 30, 0xc0bcb2, 0.3], [420, -260, 142, 30, 0x7e8f9c, 0.8],
      [-220, -420, 118, 30, 0xb2aea6, 0.4], [680, 40, 120, 34, 0xd2d0ca, 0.3], [200, 640, 112, 34, 0x8a969f, 0.9],
      [-420, 40, 104, 28, 0xa7a097, 0.2], [760, -320, 96, 30, 0x6f7b85, 0.9], [-80, 520, 146, 26, 0x92a7b6, 0.95],
      [480, 580, 90, 40, 0xc9c3b5, 0.2], [-560, -240, 92, 30, 0xbab4a8, 0.3], [880, 360, 84, 30, 0xa1a8ad, 0.6],
    ] as const) {
      const q = T(dx, dz);
      M.box(q.x, q.z, q.y, q.y + h, w, w * 0.8, rotG + (r() - 0.5) * 0.3, C(col), cw, cw * 0.8);
    }
    // Château Champlain: the "cheese grater", 152 m, white with half-moon windows (read as punched)
    const cc = T(-260, 460);
    M.box(cc.x, cc.z, cc.y, cc.y + 152, 46, 20, rotG, C(0xe4e0d6), 0, 0);
  }
  {
    // Farine Five Roses: the grain elevator by the Lachine canal mouth, the red neon letters on its roof
    const x = -2700, z = 230, y = ground(x, z);
    M.box(x, z, y, y + 38, 70, 24, 0.55, C(0x9a8f80));
    M.box(x + 20, z - 10, y + 38, y + 50, 26, 20, 0.55, C(0x8f8576));
    // the sign: a red frame of letters facing the river (east)
    const signC = C(0xff2a1a).multiplyScalar(2.2);
    for (let k = -5; k <= 5; k++) {
      const lx = x + 12 + Math.cos(0.55) * 0, lz = z + k * 4.4;
      M.box(lx - 1, lz, y + 52, y + 57, 0.6, 3.2, 0.55, signC);
    }
  }
  {
    // Mont Royal: the illuminated cross and the CBC transmitter mast
    const R = SITES.royal;
    const cx = R.x + 380, cz = R.z + 120;
    const y = map.height(cx, cz);
    M.box(cx, cz, y, y + 31, 2.2, 2.2, 0.6, C(0xe8e8e8));
    M.box(cx, cz, y + 19, y + 22, 11, 2.2, 0.6, C(0xe8e8e8));
    const mx = R.x - 150, mz = R.z - 320;
    const my = map.height(mx, mz);
    M.box(mx, mz, my, my + 120, 3.2, 3.2, 0, C(0xd8d8d8), 0, 0, 0.4);
    // the Olympic Stadium, far to the north: the oval roof and the leaning tower (45°, 165 m)
    const ox = -2300, oz = -6300, oy = map.height(ox, oz);
    M.box(ox, oz, oy, oy + 32, 300, 220, 0.4, C(0xd9d6cf), 0, 0, 0.8);
    const base = new THREE.Vector3(ox + 150, oy + 10, oz - 20);
    const top = new THREE.Vector3(ox + 60, oy + 170, oz - 80);
    for (let k = 0; k < 6; k++) {
      const f = k / 6;
      M.beam(new THREE.Vector3().lerpVectors(base, top, f), new THREE.Vector3().lerpVectors(base, top, f + 1 / 6), 22 - 12 * f, C(0xe0ddd6));
    }
  }
  const lm = new THREE.Mesh(M.geometry(), cityMaterial(false));
  lm.name = 'mtl_city_towers';
  group.add(lm);

  group.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return { group, count: boxes.length };
}
