import * as THREE from 'three';
import { MeshBuilder, srgb } from '../geom.ts';
import { canvas2d, canvasTexture } from '../textures.ts';
import { fbm2, hash2i, rng } from '../noise.ts';
import { weatherUniforms } from '../../weatherUniforms.ts';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout, GrandstandSpec } from '../layout.ts';
import type { TerrainBuild } from '../terrain.ts';
import type { SakhirLayout, SakhirSites } from './sakhir.ts';
import { sakhirKnoll } from './sakhirLand.ts';
import { frondCrown, frondTexture } from './interlagosCity.ts';

/**
 * The Bahrain International Circuit's buildings and desert, merged into a handful of meshes:
 *
 *   the Sakhir Tower     the VIP tower at the end of the paddock: a beige stone podium, a
 *                        bowed glass shaft between two stone cores, and the great white sail
 *                        of a roof cantilevered out toward the main straight
 *   the Main Grandstand  a row of white peaked tent roofs over the seats
 *   beige buildings      the team, media and administration blocks: sand-coloured stone,
 *                        dark window bands, colonnades along the front
 *   date palms           in the irrigated lawns round the tower, the paddock and the entrance
 *   the desert           limestone boulders and rubble scattered over the sand, thicker on the
 *                        knolls; the terrain look (sand everywhere except the irrigated lawns,
 *                        rocky faces on the slopes)
 *   giant flags          the Bahrain flag on two tall masts
 *
 * After dark the tower's floors, the sail's underside, the building windows and the tent roofs
 * glow (keyed off the floodlight level, env/night.ts), so the night race reads like the real one.
 */

export interface SakhirSceneryBuild {
  group: THREE.Group;
}

const STONE = srgb(0xd9c39c);
const STONE_D = srgb(0xbfa47c);
const STONE_L = srgb(0xe8d9bc);
const WHITE = srgb(0xf3f2ee);
const STEEL = srgb(0xd4d7db);
const GLASS = srgb(0x2a3a44);
const GLASS_L = srgb(0x3d5260);

class Local {
  readonly m = new THREE.Matrix4();
  constructor(x: number, y: number, z: number, rot: number) {
    this.m.makeRotationY(rot).setPosition(x, y, z);
  }
  p(x: number, y: number, z: number, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this.m);
  }
}

function localBox(mb: MeshBuilder, L: Local, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: THREE.Color, glow = 0) {
  const lm = new MeshBuilder();
  lm.aabb(x0, y0, z0, x1, y1, z1, c, { leaf: glow });
  lm.transform(L.m);
  mb.append(lm);
}

const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
function beam(mb: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, c: THREE.Color) {
  _z.subVectors(b, a);
  const L = _z.length();
  if (L < 1e-4) return;
  _z.multiplyScalar(1 / L);
  _x.set(0, 1, 0).cross(_z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x.multiplyScalar(w), _y.multiplyScalar(h), _z.multiplyScalar(L));
  _m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mb.box(_m, c);
}

/** vertical walls of a closed polygon (local xz, counter-clockwise seen from above) from y0 to y1, optional top cap */
function wallRing(mb: MeshBuilder, L: Local, poly: [number, number][], y0: number, y1: number, c: THREE.Color, glow = 0, cap = false) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % n];
    mb.quad4(L.p(bx, y0, bz), L.p(ax, y0, az), L.p(ax, y1, az), L.p(bx, y1, bz), c, [0, 0, 1, 1], glow);
  }
  if (cap) {
    let cx = 0, cz = 0;
    for (const [x, z] of poly) { cx += x / n; cz += z / n; }
    const P = L.p(cx, y1, cz);
    const ci = mb.vertex(P.x, P.y, P.z, 0, 1, 0, c, 0, glow);
    const ids = poly.map(([x, z]) => { const q = L.p(x, y1, z); return mb.vertex(q.x, q.y, q.z, 0, 1, 0, c, 0, glow); });
    for (let i = 0; i < n; i++) mb.idx.push(ci, ids[(i + 1) % n], ids[i]);
  }
}

// ---------------------------------------------------------------------------- materials

/**
 * Vertex-coloured standard material whose `aLeaf` channel is a night glow (0 … 1): after dark
 * (the floodlight level, `floodParams.x`, declared by env/night.ts in every lit material) those
 * vertices light up in `glow` colour.
 */
function glowMaterial(params: THREE.MeshStandardMaterialParameters, glow: THREE.Color, strength: number, key: string): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, ...params });
  const uGlow = { value: glow.clone().multiplyScalar(strength) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSkGlow = uGlow;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aLeaf;\nvarying float vSkGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkGlow = aLeaf;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSkGlow;\nvarying float vSkGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uSkGlow * vSkGlow * smoothstep( 0.05, 1.3, floodParams.x );');
  };
  m.customProgramCacheKey = () => key;
  return m;
}

// ---------------------------------------------------------------------------- terrain look

const OASES_MAX = 24;
const LAWN_ANCHOR = 'float lawn = max( mf.g * inFine, verge );';
const PAVE_ANCHOR = '  // ---- paths and paving';

/**
 * Desert all round: the terrain's lawns (the verges behind the barriers, the clearings round
 * the stands) turn to sand except in the irrigated oases; rocky faces on the knolls' slopes.
 */
export function sakhirTerrainLook(t: TerrainBuild, sites: SakhirSites) {
  const u = t.uniforms;
  const set = (k: string, hex: number) => {
    const v = u[k]?.value;
    if (v instanceof THREE.Color) v.set(hex);
  };
  set('uLawn', 0x55752f);
  set('uGrassDark', 0x3f5a26);
  set('uMeadow', 0x8d8456);
  set('uStraw', 0xb8a47a);
  set('uGravel', 0xcdb895);
  set('uGravelDark', 0xa48c6a);
  set('uEarth', 0xa98d68);
  set('uAsphalt', 0x55575a);
  const oases = sites.oases.slice(0, OASES_MAX);
  const arr: THREE.Vector3[] = [];
  for (let i = 0; i < OASES_MAX; i++) arr.push(oases[i] ? new THREE.Vector3(oases[i].x, oases[i].z, oases[i].r) : new THREE.Vector3(0, 0, 0));
  const su: Record<string, THREE.IUniform> = { uOasis: { value: arr }, uOasisN: { value: oases.length } };
  const mat = t.material;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    if (!sh.fragmentShader.includes(LAWN_ANCHOR) || !sh.fragmentShader.includes(PAVE_ANCHOR)) {
      console.warn('[sakhir] terrain shader anchors not found — no desert look');
      return;
    }
    Object.assign(sh.uniforms, su);
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `uniform vec3 uOasis[${OASES_MAX}];\nuniform int uOasisN;\nvoid main() {`)
      .replace(
        LAWN_ANCHOR,
        `${LAWN_ANCHOR}
  {
    // only the irrigated oases are green (soft, irregular edges); everything else is desert
    float irr = 0.0;
    for ( int i = 0; i < ${OASES_MAX}; i ++ ) {
      if ( i >= uOasisN ) break;
      vec3 o = uOasis[ i ];
      float d = length( p - o.xy ) / o.z;
      irr = max( irr, 1.0 - smoothstep( 0.6 + 0.25 * m3, 0.95 + 0.12 * d2, d ) );
    }
    lawn = irr * inFine;
  }`,
      )
      .replace(
        PAVE_ANCHOR,
        `  {
    // rocky faces: the knolls' crumbling limestone sides, pale bands in the grey-brown
    float sl = 1.0 - clamp( normalize( vWNormal ).y, 0.0, 1.0 );
    float rk = smoothstep( 0.1, 0.28, sl ) * ( 1.0 - lawn ) * ( 1.0 - smoothstep( 0.3, 0.7, paved ) );
    vec3 rockC = uRock * ( 0.72 + 0.5 * d2 ) * ( 0.85 + 0.3 * m3 );
    rockC = mix( rockC, uSand * 1.06, step( 0.55, fract( vWPos.y * 0.7 + d1 * 0.5 ) ) * 0.3 );
    col = mix( col, rockC, rk );
    float bare = ( 1.0 - lawn ) * ( 1.0 - smoothstep( 0.3, 0.7, paved ) );
    // desert pavement: broad patches of grey-brown stones and grit between the pale sand
    float pav = smoothstep( 0.4, 0.58, m1 * 0.5 + m2 * 0.35 + m3 * 0.15 ) * ( 0.7 + 0.3 * d2 );
    vec3 stones = mix( uRock * vec3( 0.8, 0.8, 0.84 ), uSand * 0.9, 0.3 * d1 ) * ( 0.85 + 0.3 * d3 );
    col = mix( col, stones, pav * 0.7 * bare );
    // Jebel ad-Dukhan and the rim: bare rock, dark gullies
    float hi = smoothstep( 24.0, 70.0, vWPos.y + ( m2 - 0.5 ) * 30.0 );
    col = mix( col, uRock * ( 0.62 + 0.45 * m3 ) * ( 0.85 + 0.3 * d1 ), hi * 0.8 * bare );
    // a dusty, sun-bleached haze over the whole plain at distance
    col = mix( col, uSand * 1.04, farF * 0.1 * bare );
    // the Awali field's pipelines: long, dead-straight dark lines across the desert (a few
    // directions, each a run of a few kilometres), with a pale graded service track beside them
    {
      float pl = 0.0, trk = 0.0;
      for ( int i = 0; i < 4; i++ ) {
        float a = 0.35 + float( i ) * 1.13;
        vec2 n = vec2( cos( a ), sin( a ) );
        float off = ( float( i ) - 1.5 ) * 1450.0 + 380.0;
        float d = dot( p - uCenter, n ) - off;
        float run = dot( p - uCenter, vec2( -n.y, n.x ) );
        float seg = step( -5200.0 + float( i ) * 900.0, run ) * step( run, 4800.0 - float( i ) * 700.0 ) * smoothstep( 1900.0, 2400.0, length( p - uCenter ) );
        float w = fwidth( d );
        pl = max( pl, ( 1.0 - smoothstep( 0.6, 0.6 + w * 1.5, abs( d ) ) ) * seg );
        trk = max( trk, ( 1.0 - smoothstep( 2.5, 2.5 + w * 1.5, abs( d - 7.0 ) ) ) * seg );
      }
      float near = 1.0 - smoothstep( 1200.0, 6000.0, length( vWPos - cameraPosition ) );
      col = mix( col, uSand * 1.12, trk * 0.45 * bare * ( 0.4 + 0.6 * near ) );
      col = mix( col, vec3( 0.09, 0.085, 0.08 ), pl * 0.8 * bare * near );
    }
  }
${PAVE_ANCHOR}`,
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => prevKey() + '-sakhir-desert';
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------------------- build

export function buildSakhirScenery(layout: Layout, track: Track, map: WorldMap, terrain: TerrainBuild): SakhirSceneryBuild {
  const group = new THREE.Group();
  group.name = 'SakhirScenery';
  const sites = (layout as SakhirLayout).sakhir;
  if (!sites) return { group };
  sakhirTerrainLook(terrain, sites);
  const solid = new MeshBuilder(); // stone, concrete, paint (aLeaf = night glow)
  const metal = new MeshBuilder(); // painted steel
  const glass = new MeshBuilder(); // glazing (aLeaf = lit windows after dark)
  const membrane = new MeshBuilder(); // tent fabric, the sail (aLeaf = uplight after dark)
  const r = rng(9731);

  // ---------------------------------------------------------------- the Sakhir Tower
  {
    const T = sites.tower;
    const y0 = map.height(T.x, T.z) - 0.3;
    const L = new Local(T.x, y0, T.z, T.rot); // local +z faces the main straight
    // podium: two storeys of stone, a glass band, a canopy over the entrance on the paddock side
    localBox(solid, L, -26, 0, -20, 26, 8, 17, STONE);
    localBox(solid, L, -27, 8, -21, 27, 8.8, 18, STONE_L);
    localBox(glass, L, -24, 1.2, 17, 24, 6.6, 17.25, GLASS_L, 0.8);
    localBox(glass, L, -24, 1.2, -20.25, 24, 6.6, -20, GLASS_L, 0.6);
    localBox(solid, L, -12, 4.5, -30, 12, 5.2, -20, WHITE, 0.15);
    for (const x of [-11, 11]) localBox(metal, L, x - 0.25, 0, -29.5, x + 0.25, 4.5, -29, STEEL);
    // the shaft: a bowed glass front toward the track, flat back, floors every 3.9 m
    const SH0 = 8.8, SH1 = 50;
    const poly: [number, number][] = [];
    const NA = 14;
    for (let i = 0; i <= NA; i++) {
      const t = i / NA; // front arc, from x = +13 to −13
      const x = 13 - 26 * t;
      poly.push([x, 6 + 5.5 * Math.sin(Math.PI * t)]);
    }
    poly.push([-13, -10], [13, -10]);
    for (let y = SH0; y < SH1; y += 3.9) {
      const lit = hash2i(Math.round(y), 3, 17);
      wallRing(glass, L, poly, y + 0.75, y + 3.9, GLASS, lit < 0.85 ? 0.55 + 0.45 * lit : 0.1);
      wallRing(solid, L, poly, y, y + 0.75, WHITE, 0.08);
    }
    wallRing(solid, L, poly, SH1, SH1 + 1.2, WHITE, 0.1, true);
    // stone cores flanking the shaft (lift and stair towers), taller than it, tapering
    for (const s of [-1, 1]) {
      const xa = s * 13, xb = s * 18.5;
      const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
      localBox(solid, L, x0, 8.8, -12, x1, 30, 7, STONE);
      localBox(solid, L, x0 + (s > 0 ? 0 : 0.8), 30, -11, x1 - (s > 0 ? 0.8 : 0), 55, 5, STONE);
      // slit windows up the cores
      for (let y = 11; y < 53; y += 3.9) localBox(glass, L, (x0 + x1) / 2 - 0.5, y, 5.05, (x0 + x1) / 2 + 0.5, y + 2.4, 5.2, GLASS_L, 0.7);
    }
    // the sail: a great white shell rising from the back of the roof and cantilevered forward over
    // the paddock toward the track, its edges curling up; two layers (top and soffit) and a rim
    const NU = 16, NV = 12;
    const sail = (uu: number, v: number, off: number) => {
      const x = uu * 21 * (1 - 0.22 * v);
      const z = -15 + 38 * v;
      const y = 51 + 15 * Math.pow(v, 1.5) + 1.1 * uu * uu * (0.2 + v) - 1.4 * Math.sin(Math.PI * v) + off;
      return L.p(x, y, z);
    };
    for (const [off, up] of [[0.7, 1], [0, -1]] as const) {
      const ids: number[][] = [];
      for (let j = 0; j <= NV; j++) {
        const row: number[] = [];
        for (let i = 0; i <= NU; i++) {
          const P = sail(-1 + (2 * i) / NU, j / NV, off);
          // uplit from below after dark, brighter toward the front
          row.push(membrane.vertex(P.x, P.y, P.z, 0, up, 0, WHITE, 0, up < 0 ? 0.35 + 0.65 * (j / NV) : 0.12));
        }
        ids.push(row);
      }
      for (let j = 0; j < NV; j++)
        for (let i = 0; i < NU; i++) {
          const a = ids[j][i], b = ids[j][i + 1], c = ids[j + 1][i], d = ids[j + 1][i + 1];
          if (up > 0) membrane.idx.push(a, c, b, b, c, d);
          else membrane.idx.push(a, b, c, b, d, c);
        }
    }
    // rim
    const rim: THREE.Vector3[] = [];
    for (let i = 0; i <= NU; i++) rim.push(sail(-1 + (2 * i) / NU, 1, 0));
    for (let j = NV; j >= 0; j--) rim.push(sail(1, j / NV, 0));
    for (let i = NU; i >= 0; i--) rim.push(sail(-1 + (2 * i) / NU, 0, 0));
    for (let j = 0; j <= NV; j++) rim.push(sail(-1, j / NV, 0));
    for (let k = 0; k < rim.length - 1; k++) {
      const a = rim[k], b = rim[k + 1];
      membrane.quad4(a, b, b.clone().setY(b.y + 0.7), a.clone().setY(a.y + 0.7), WHITE, [0, 0, 1, 1], 0.3);
    }
    // the sail's legs: raked white struts from the cores up to its underside
    for (const s of [-1, 1]) {
      beam(metal, L.p(s * 16, 55, 0), sail(s * 0.78, 0.62, 0), 0.9, 0.9, WHITE);
      beam(metal, L.p(s * 16, 55, -9), sail(s * 0.8, 0.12, 0), 0.9, 0.9, WHITE);
    }
    // rooftop plant and the red aviation light
    localBox(solid, L, -6, SH1 + 1.2, -8, 6, SH1 + 4, -2, STONE_D);
    localBox(solid, L, -0.3, 64.5, 22.5, 0.3, 65.3, 23, srgb(0xff2a1a), 1);
  }

  // ---------------------------------------------------------------- the Main Grandstand's tents
  for (const g of sites.main) mainTents(g);
  function mainTents(g: GrandstandSpec) {
    const front = g.center.clone().addScaledVector(g.facing, g.depth / 2);
    const zAxis = g.facing.clone().negate();
    const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
    const M = new THREE.Matrix4().makeBasis(xAxis, new THREE.Vector3(0, 1, 0), zAxis).setPosition(front.x, g.y0, front.z);
    const lp = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(M);
    const top = 1.9 + g.rows * 0.46;
    const depth = g.rows * 0.86 + 0.8;
    const n = Math.max(2, Math.round(g.length / (depth * 0.85)));
    const bay = g.length / n;
    const zf = -3.5, zb = depth + 1.2;
    const eave = top + 3.2, peak = top + 11.5;
    // columns at the tents' corners (slim at the front, where they stand in the first row)
    for (let k = 0; k <= n; k++) {
      const x = -g.length / 2 + k * bay;
      beam(metal, lp(x, -0.5, zb), lp(x, eave, zb), 0.55, 0.55, WHITE);
      beam(metal, lp(x, -0.5, zf + 0.6), lp(x, eave, zf + 0.6), 0.28, 0.28, WHITE);
      // edge cables and the eave beams
      beam(metal, lp(x, eave, zf + 0.6), lp(x, eave, zb), 0.22, 0.3, WHITE);
    }
    beam(metal, lp(-g.length / 2, eave, zb), lp(g.length / 2, eave, zb), 0.3, 0.4, WHITE);
    beam(metal, lp(-g.length / 2, eave, zf + 0.6), lp(g.length / 2, eave, zf + 0.6), 0.25, 0.3, WHITE);
    // one peaked tent per bay: concave faces rising to a central mast
    const N = 10;
    for (let k = 0; k < n; k++) {
      const xa = -g.length / 2 + k * bay, xm = xa + bay / 2;
      const zm = (zf + zb) / 2, hz = (zb - zf) / 2, hx = bay / 2;
      const ids: number[][] = [];
      for (let j = 0; j <= N; j++) {
        const row: number[] = [];
        for (let i = 0; i <= N; i++) {
          const u = -1 + (2 * i) / N, v = -1 + (2 * j) / N;
          const m = Math.max(Math.abs(u), Math.abs(v));
          const y = eave + (peak - eave) * Math.pow(1 - m, 1.9) - 0.25 * Math.sin(Math.PI * Math.min(Math.abs(u), Math.abs(v)));
          const P = lp(xm + u * hx, y, zm + v * hz);
          row.push(membrane.vertex(P.x, P.y, P.z, 0, 1, 0, WHITE, 0, 0.18 + 0.2 * (1 - m)));
        }
        ids.push(row);
      }
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const a = ids[j][i], b = ids[j][i + 1], c = ids[j + 1][i], d = ids[j + 1][i + 1];
          membrane.idx.push(a, b, c, b, d, c);
        }
      // the mast through the peak
      beam(metal, lp(xm, peak - 1, zm), lp(xm, peak + 3.2, zm), 0.25, 0.25, WHITE);
    }
    // stone back wall with the entrance arches' dark openings
    for (let k = 0; k < n * 3; k++) {
      const x0 = -g.length / 2 + (k * g.length) / (n * 3), x1 = x0 + g.length / (n * 3);
      solid.quad4(lp(x1, -0.5, zb + 0.4), lp(x0, -0.5, zb + 0.4), lp(x0, top, zb + 0.4), lp(x1, top, zb + 0.4), STONE);
      solid.quad4(lp(x0, -0.5, zb + 0.45), lp(x1, -0.5, zb + 0.45), lp(x1, top, zb + 0.45), lp(x0, top, zb + 0.45), STONE_D);
    }
  }

  // ---------------------------------------------------------------- beige buildings
  for (const b of sites.blocks) {
    const y0 = map.height(b.x, b.z) - 0.3;
    const L = new Local(b.x, y0, b.z, b.rot); // local z along the track, x across
    const { hw, hl, h } = b;
    localBox(solid, L, -hw, 0, -hl, hw, h, hl, STONE);
    // parapet and a slim cornice
    localBox(solid, L, -hw - 0.3, h, -hl - 0.3, hw + 0.3, h + 0.9, hl + 0.3, STONE_L);
    // window bands on both long sides, lit at night (offices)
    const floors = Math.max(1, Math.floor(h / 3.8));
    for (let f = 0; f < floors; f++) {
      const ya = 1.1 + f * 3.8, yb = ya + 2.1;
      for (const s of [-1, 1]) {
        const x = s * (hw + 0.06);
        const lit = hash2i(Math.round(b.x) + f, Math.round(b.z) + s, 29);
        localBox(glass, L, Math.min(x, x - s * 0.1), ya, -hl + 2, Math.max(x, x - s * 0.1), yb, hl - 2, GLASS, lit < 0.7 ? 0.6 : 0.1);
      }
    }
    // a colonnade along the side facing the track (pointed-arch rhythm read as slim piers)
    // (local +x is (cos rot, −sin rot) in the world: which side the track lies on)
    const pi = track.project(b.x, b.z).index;
    const side = Math.sign((track.px[pi] - b.x) * Math.cos(b.rot) - (track.pz[pi] - b.z) * Math.sin(b.rot)) || 1;
    const cx = side * (hw + 3);
    for (let z = -hl + 2; z <= hl - 2; z += 4) localBox(solid, L, cx - 0.4, 0, z - 0.4, cx + 0.4, 4.5, z + 0.4, STONE_L);
    localBox(solid, L, Math.min(cx, side * hw) - 0.4, 4.5, -hl, Math.max(cx, side * hw) + 0.4, 5.2, hl, STONE_L, 0.1);
    // rooftop plant
    localBox(metal, L, -hw * 0.5, h + 0.9, -hl * 0.3, hw * 0.3, h + 2.6, hl * 0.2, srgb(0xb9bcbf));
  }

  // ---------------------------------------------------------------- giant flags
  const flagMB = new MeshBuilder();
  for (const m of sites.masts) {
    const y = map.height(m.x, m.z) - 0.2;
    const Hm = 38;
    const lm = new MeshBuilder();
    lm.tube([[m.x, y, m.z, 0.45], [m.x, y + Hm, m.z, 0.2]], 8, WHITE);
    metal.append(lm);
    const W = 16, Hf = 9.5;
    // the shamal: the prevailing wind from the north-west
    const rot = -0.7 + r() * 0.2;
    const ux = Math.cos(rot), uz = -Math.sin(rot);
    const nU = 12, nV = 4;
    const base = flagMB.vertexCount;
    for (let j = 0; j <= nV; j++)
      for (let i = 0; i <= nU; i++) {
        const uu = i / nU, v = j / nV;
        flagMB.vertex(m.x + ux * (uu * W + 0.5), y + Hm - 0.6 - Hf + v * Hf, m.z + uz * (uu * W + 0.5), -uz, 0, ux, WHITE, uu, 0, uu, v);
      }
    for (let j = 0; j < nV; j++)
      for (let i = 0; i < nU; i++) {
        const a = base + j * (nU + 1) + i, b = a + 1, c = a + nU + 1, d = c + 1;
        flagMB.idx.push(a, b, c, b, d, c);
      }
  }

  // ---------------------------------------------------------------- meshes
  const add = (mb: MeshBuilder, mat: THREE.Material, name: string, cast: boolean) => {
    if (mb.vertexCount === 0) return;
    const m = new THREE.Mesh(mb.geometry(true), mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  const warm = new THREE.Color(1.0, 0.8, 0.55);
  add(solid, glowMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide }, warm, 0.7, 'sakhir-solid'), 'sakhir_solid', true);
  add(metal, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.3 }), 'sakhir_steel', true);
  add(membrane, glowMaterial({ roughness: 0.7, metalness: 0, side: THREE.DoubleSide, emissive: 0x3a3936 }, new THREE.Color(0.92, 0.95, 1.0), 0.45, 'sakhir-membrane'), 'sakhir_membrane', true);
  add(glass, glowMaterial({ roughness: 0.08, metalness: 0.8 }, warm, 1.5, 'sakhir-glass'), 'sakhir_glass', false);
  if (flagMB.vertexCount) group.add(flagMesh(flagMB));
  group.add(buildPalms(map, sites, track));
  group.add(buildRocks(map));
  return { group };
}

// ---------------------------------------------------------------------------- flags

/** the Bahrain flag: a white band at the hoist, five white points into the red */
export function drawBahrainFlag(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = '#ce1126';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffffff';
  const band = w * 0.25, tip = w * 0.13;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + band, y);
  for (let k = 0; k < 5; k++) {
    ctx.lineTo(x + band + tip, y + ((k + 0.5) * h) / 5);
    ctx.lineTo(x + band, y + ((k + 1) * h) / 5);
  }
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fill();
}

function flagMesh(mb: MeshBuilder): THREE.Mesh {
  const { canvas, ctx } = canvas2d(512, 320);
  drawBahrainFlag(ctx, 0, 0, 512, 320);
  const mat = new THREE.MeshStandardMaterial({ map: canvasTexture(canvas, true, 8), roughness: 0.8, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWT = weatherUniforms.uWeatherTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWT;\nattribute float aWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
{
  float k = aWind;
  float ph = uWT * 2.6 - k * 5.0 + position.x * 0.01;
  vec3 nrm = normalize( vec3( normal.x, 0.0, normal.z ) );
  transformed += nrm * sin( ph ) * 0.7 * k;
  transformed.y += ( sin( ph * 0.6 ) * 0.25 - 0.6 * k * k ) * k;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'sakhir-flag-v1';
  const mesh = new THREE.Mesh(mb.geometry(true), mat);
  mesh.name = 'sakhir_flags';
  mesh.castShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// ---------------------------------------------------------------------------- date palms

function buildPalms(map: WorldMap, sites: SakhirSites, track: Track): THREE.Group {
  const spots: { x: number; z: number; s: number }[] = [];
  const r = rng(4411);
  const ok = (x: number, z: number) => map.trackClearance(x, z) > 6 && !map.excluded(x, z, 1.5) && map.pathDistance(x, z).d > 1.5 && !map.inPitZone(x, z, 2);
  // clumps in the oases
  for (const o of sites.oases) {
    const n = Math.round((o.r * o.r) / 70);
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * o.r * 0.85;
      const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d;
      if (ok(x, z)) spots.push({ x, z, s: 0.85 + r() * 0.35 });
    }
  }
  // avenues along the service roads
  for (const path of map.paths) {
    if (path.kind !== 2) continue;
    let acc = 0;
    for (let i = 0; i < path.pts.length - 1; i++) {
      const a = path.pts[i], b = path.pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let t = 0; t < L; t += 1) {
        if (++acc < 15) continue;
        acc = 0;
        const f = t / L;
        const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
        for (const sd of [-1, 1]) {
          const off = path.width / 2 + 2.2;
          const x = a.x + (b.x - a.x) * f + nx * sd * off, z = a.z + (b.z - a.z) * f + nz * sd * off;
          if (ok(x, z)) spots.push({ x, z, s: 0.95 + r() * 0.2 });
        }
      }
    }
  }
  // a very few lone palms out in the desert
  for (let k = 0; k < 60; k++) {
    const s = r() * track.n;
    const sd = r() < 0.5 ? -1 : 1;
    const p = track.point(s, sd * (track.barrierAt(s, sd) + 40 + r() * 400));
    if (r() < 0.6 && ok(p.x, p.z)) spots.push({ x: p.x, z: p.z, s: 0.75 + r() * 0.3 });
  }

  // date palm: a thick trunk (the old frond bases give it a rough, stepped bark), a dense crown of
  // stiff blue-grey-green fronds
  const trunk = new THREE.CylinderGeometry(0.3, 0.38, 1, 7, 3, true);
  trunk.translate(0, 0.5, 0);
  const crown = frondCrown();
  const tex = frondTexture();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a7458, roughness: 0.96 });
  trunkMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vTY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTY;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 0.72 + 0.28 * smoothstep( 0.2, 0.8, fract( vTY * 22.0 ) );');
  };
  trunkMat.customProgramCacheKey = () => 'sakhir-date-trunk';
  const leafMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.7, color: 0xffffff });
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.35, side: THREE.DoubleSide });
  const n = spots.length;
  const tm = new THREE.InstancedMesh(trunk, trunkMat, Math.max(1, n));
  const cm = new THREE.InstancedMesh(crown, leafMat, Math.max(1, n));
  cm.customDepthMaterial = leafDepth;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const e = new THREE.Euler();
  const tint = new THREE.Color();
  spots.forEach((sp, i) => {
    const hh = (h: number) => hash2i(Math.floor(sp.x * 3), Math.floor(sp.z * 3), h);
    const H = (6 + hh(5) * 7) * sp.s;
    const y = map.height(sp.x, sp.z) - 0.2;
    e.set((hh(6) - 0.5) * 0.12, hh(7) * Math.PI * 2, 0, 'YXZ');
    q.setFromEuler(e);
    ps.set(sp.x, y, sp.z);
    sc.set(sp.s * 1.1, H, sp.s * 1.1);
    M.compose(ps, q, sc);
    tm.setMatrixAt(i, M);
    const top = new THREE.Vector3(0, H, 0).applyQuaternion(q).add(ps);
    const cs = sp.s * (1.05 + hh(8) * 0.25);
    sc.set(cs, cs * 0.9, cs);
    M.compose(top, q, sc);
    cm.setMatrixAt(i, M);
    // date palms are a dusty blue-grey green
    tint.setRGB(0.78 + r() * 0.12, 0.8 + r() * 0.12, 0.72 + r() * 0.14);
    cm.setColorAt(i, tint);
  });
  tm.count = cm.count = n;
  for (const m of [tm, cm]) {
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    m.receiveShadow = true;
    m.castShadow = true;
  }
  if (cm.instanceColor) cm.instanceColor.needsUpdate = true;
  tm.name = 'sakhir_palm_trunks';
  cm.name = 'sakhir_palm_crowns';
  const g = new THREE.Group();
  g.name = 'SakhirPalms';
  g.add(tm, cm);
  return g;
}

// ---------------------------------------------------------------------------- boulders

/** limestone boulders and rubble over the desert, thick on the knolls, none near the track */
function buildRocks(map: WorldMap): THREE.InstancedMesh {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  // lumpy: jitter the vertices (shared positions keep the shape closed)
  const pa = geo.attributes.position as THREE.BufferAttribute;
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const jit = new Map<string, number>();
  for (let i = 0; i < pa.count; i++) {
    const k = key(pa.getX(i), pa.getY(i), pa.getZ(i));
    if (!jit.has(k)) jit.set(k, 0.72 + 0.5 * hash2i(i * 7, 3, 11));
  }
  for (let i = 0; i < pa.count; i++) {
    const f = jit.get(key(pa.getX(i), pa.getY(i), pa.getZ(i)))!;
    pa.setXYZ(i, pa.getX(i) * f, Math.max(pa.getY(i) * f, -0.35), pa.getZ(i) * f);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb09a7c, roughness: 0.95, flatShading: true });
  const S = map.SQUARE;
  const c = map.A.center;
  const spots: { x: number; z: number; s: number; y: number }[] = [];
  const r = rng(5151);
  for (let k = 0; k < 24000 && spots.length < 4200; k++) {
    const x = c.x + (r() - 0.5) * 2800, z = c.z + (r() - 0.5) * 2800;
    if (x < S.x0 + 20 || x > S.x1 - 20 || z < S.z0 + 20 || z > S.z1 - 20) continue;
    const dT = map.distToTrack(x, z);
    if (dT < 45) continue;
    const kn = sakhirKnoll(x, z);
    const field = fbm2(x / 150 + 3.3, z / 150 - 8.1, 2) * 0.5 + 0.5;
    const want = 0.06 + 0.7 * kn + 0.3 * Math.max(0, field - 0.5) + 0.1 * (1 - Math.min(1, dT / 400));
    if (r() > want) continue;
    if (map.excluded(x, z, 2) || map.pathDistance(x, z).d < 3 || map.inPitZone(x, z, 10) || map.trackClearance(x, z) < 12) continue;
    const s = (0.3 + Math.pow(r(), 2.2) * 2.6) * (1 + kn * 0.6);
    spots.push({ x, z, s, y: map.height(x, z) });
  }
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  spots.forEach((p, i) => {
    e.set((r() - 0.5) * 0.4, r() * Math.PI * 2, (r() - 0.5) * 0.4);
    q.setFromEuler(e);
    sc.set(p.s * (0.8 + r() * 0.6), p.s * (0.45 + r() * 0.35), p.s * (0.8 + r() * 0.6));
    ps.set(p.x, p.y - p.s * 0.12, p.z);
    M.compose(ps, q, sc);
    im.setMatrixAt(i, M);
    const g = 0.85 + r() * 0.3;
    col.setRGB(g * (0.98 + r() * 0.06), g * (0.95 + r() * 0.05), g * (0.9 + r() * 0.08));
    im.setColorAt(i, col);
  });
  im.count = spots.length;
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = true;
  im.receiveShadow = true;
  im.name = 'sakhir_rocks';
  return im;
}

// ---------------------------------------------------------------------------- crowd

/** fan shirt colours: Bahrain red and white, white thobes, team kit mixes in (grandstands.ts) */
export const SAKHIR_FANS = ['#ce1126', '#ffffff', '#f4f2ec', '#b50f22', '#e9e5da', '#1d1d1f', '#d8cdb6', '#ce1126', '#ffffff', '#3a3f47'];

/** crowd/hand flag designs 0–3 for grandstands.ts: Bahrain flag, BAHRAIN banner, SAKHIR banner, red-white GP banner */
export function drawSakhirFlags(ctx: CanvasRenderingContext2D, at: (k: number) => readonly [number, number], S: number, txt: (x: number, y: number, s: string, size: number, col: string) => void) {
  {
    const [x, y] = at(0);
    drawBahrainFlag(ctx, x, y, S, S);
  }
  {
    const [x, y] = at(1);
    ctx.fillStyle = '#ce1126';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y + S * 0.7, S, S * 0.07);
    txt(x + S / 2, y + S * 0.46, 'BAHRAIN', 52, '#ffffff');
  }
  {
    const [x, y] = at(2);
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ce1126';
    ctx.fillRect(x, y, S, S * 0.14);
    ctx.fillRect(x, y + S * 0.86, S, S * 0.14);
    txt(x + S / 2, y + S * 0.5, 'SAKHIR', 62, '#ce1126');
  }
  {
    const [x, y] = at(3);
    ctx.fillStyle = '#16181c';
    ctx.fillRect(x, y, S, S);
    ctx.fillStyle = '#ce1126';
    ctx.fillRect(x, y + S * 0.66, S, S * 0.1);
    txt(x + S / 2, y + S * 0.44, 'F1 BGP', 66, '#ffffff');
  }
}
