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

/**
 * Facade shader for city buildings. aWin = (curtain wall 0…1, glass reflectivity, building seed,
 * base height): storeys and bays are counted from the building's own base, so each tower has its
 * own storey height, bay width, spandrel depth and sill line; every pane its own interior (dark
 * office, pale blinds, a lit room at night) and its own slightly bent reflection; a storefront
 * band at street level and the darker street canyon at the foot. Beyond a few pixels a storey the
 * pattern fades to its own average (no moiré on a tower 3 km away). A 2-component aWin (or a seed
 * of 0) still works: the seed is hashed from the position and storeys count from y = 0.
 * (Also used by Melbourne's CBD.)
 */
export function cityMaterial(instanced: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: !instanced, roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFlood = { value: floodUniforms.params };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin;\nvarying vec4 vWin;\nvarying vec3 vCW;\nvarying vec3 vCN;')
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
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 uFlood;
varying vec4 vWin;
varying vec3 vCW;
varying vec3 vCN;
float cWin;
float cLit;
float cPane;
float cH( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
// a box-filtered band a…b of a 0…1 coordinate (w = its screen footprint)
float cBand( float a, float b, float x, float w ) { return clamp( ( x - a ) / w + 0.5, 0.0, 1.0 ) * clamp( ( b - x ) / w + 0.5, 0.0, 1.0 ); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float side = 1.0 - smoothstep( 0.3, 0.6, abs( vCN.y ) );
  vec2 tan2 = normalize( vec2( -vCN.z, vCN.x ) + 1e-4 );
  float u = dot( vCW.xz, tan2 );
  bool own = vWin.z > 0.0;
  float seed = own ? vWin.z : cH( floor( vCW.xz / 23.0 ) ) + 0.01;
  float hy = vCW.y - ( own ? vWin.w : 0.0 );
  float cw = vWin.x;
  // storey (offices ~4 m, older and residential ~3.2 m) and bay (curtain mullions ~1.5 m, piers ~3 m)
  float storey = mix( 3.1, 3.9, fract( seed * 7.13 ) ) + 0.35 * cw;
  float bay = mix( mix( 2.6, 3.6, fract( seed * 5.31 ) ), mix( 1.35, 1.8, fract( seed * 3.77 ) ), step( 0.5, cw ) );
  float fl = hy / storey, ub = u / bay;
  vec2 fw = fwidth( vec2( ub, fl ) ) + 1e-4;
  float fu = fract( fl ), cu = fract( ub );
  // punched windows: sill to head inside the storey, between piers
  float sill = mix( 0.26, 0.38, fract( seed * 11.1 ) ), head = mix( 0.8, 0.92, fract( seed * 13.7 ) );
  float pier = mix( 0.1, 0.24, fract( seed * 17.3 ) );
  float punched = cBand( sill, head, fu, fw.y ) * cBand( pier, 1.0 - pier, cu, fw.x );
  float punchedMean = ( head - sill ) * ( 1.0 - 2.0 * pier );
  // curtain wall: a spandrel band of the tower's own depth (some all-glass), thin mullions
  float span = mix( 0.08, 0.36, fract( seed * 19.1 ) ) * step( fract( seed * 23.3 ), 0.82 );
  float mull = 0.05;
  float curtain = cBand( span, 0.975, fu, fw.y ) * cBand( mull, 1.0 - mull, cu, fw.x );
  float curtainMean = ( 0.975 - span ) * ( 1.0 - 2.0 * mull );
  float far = smoothstep( 0.3, 0.85, max( fw.x, fw.y ) );
  float cwS = step( 0.5, cw );
  cWin = mix( mix( punched, curtain, cwS ), mix( punchedMean, curtainMean, cwS ), far ) * side * step( 4.6, hy );
  // each pane: its own interior and blind, and its own bend (reflections break up pane by pane)
  vec2 cell = floor( vec2( ub, fl ) );
  cPane = cH( cell + seed * 37.0 );
  float blind = step( 0.8, cPane ) * ( 1.0 - far );
  // (as metal-ish F0: coated curtain-wall glass mirrors the sky; plain windows barely do)
  vec3 glass = mix( vec3( 0.04, 0.05, 0.06 ), vec3( 0.3, 0.36, 0.42 ), vWin.y * vWin.y );
  glass *= mix( 0.7 + 0.6 * cH( cell.yx + seed * 3.1 ), 1.0, far );
  glass = mix( glass, vec3( 0.3, 0.29, 0.26 ), blind * 0.55 ) + vec3( 0.02 ) * far;
  // up high a tower's glass sees open sky, down low its neighbours: reflective glass brightens upward
  glass *= mix( 1.0, mix( 0.75, 1.35, smoothstep( 10.0, 160.0, hy ) ), vWin.y );
  // the frame, spandrels and stone: the building's colour, a touch of storey-to-storey patina
  vec3 wall = diffuseColor.rgb * ( 0.9 + 0.14 * cH( vec2( floor( fl ), seed * 13.0 ) ) * ( 1.0 - far ) );
  // curtain walls' spandrels are mostly opaque glass of the same tint
  wall = mix( wall, wall * 0.55 + glass * 0.6, cw * 0.5 );
  diffuseColor.rgb = mix( wall, glass, cWin * 0.92 );
  // street level: shopfronts (dark glass between piers) under a canopy line
  float gf = ( 1.0 - smoothstep( 4.0, 4.6, hy ) ) * step( 0.35, hy ) * side;
  float shop = mix( cBand( 0.12, 0.88, fract( u / 6.5 ), fwidth( u / 6.5 ) + 1e-4 ), 0.76, far );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.028, 0.03, 0.033 ), gf * shop * 0.9 );
  diffuseColor.rgb *= 1.0 - 0.35 * cBand( 4.25, 4.6, hy, fwidth( hy ) + 1e-3 ) * side;
  // the street canyon: the lower storeys see less sky
  diffuseColor.rgb *= mix( 1.0, mix( 0.55, 1.0, smoothstep( 0.0, 34.0, hy ) ), side );
  // flat roofs: tar and gravel, a paler parapet line
  float roof = smoothstep( 0.6, 0.9, vCN.y );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.075, 0.074, 0.072 ) * ( 0.85 + 0.3 * cH( floor( vCW.xz / 9.0 ) ) ), roof * ( 1.0 - vWin.y * 0.5 ) );
  float litP = step( cH( cell + floor( vCW.xz / 97.0 ) ), 0.3 );
  cLit = mix( litP, 0.3, far ) * cWin;
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.07 + 0.16 * cPane, cWin * vWin.y );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, 0.88, cWin * vWin.y );')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3( 1.0, 0.78, 0.5 ) * cLit * 0.9 * smoothstep( 0.0, 0.5, uFlood.x );`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-mtl-city2-' + (instanced ? 'i' : 'm');
  return mat;
}

const frac = (v: number) => v - Math.floor(v);

interface Box {
  x: number; z: number; y: number;
  w: number; d: number; h: number;
  rot: number;
  col: THREE.Color;
  curtain: number;
  refl: number;
}

/** merged-mesh builder: boxes with colour + aWin */
export class Merge {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  win: number[] = [];
  idx: number[] = [];
  /** the building being built: its seed (0 = hash per box) and base height (storeys count from it) */
  seed = 0;
  base = 0;
  private wv(curtain: number, refl: number, y0: number) {
    this.win.push(curtain, refl, this.seed > 0 ? this.seed : 0, this.seed > 0 ? this.base : y0);
  }
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
        this.wv(curtain, refl, y0);
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
        this.wv(0, 0, y0);
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
        this.wv(0, 0, a.y);
      }
      this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3, i, i + 2, i + 1, i, i + 3, i + 2);
    }
  }
  /** a box with its vertical corners cut off (chamfer `ch` m): eight walls and a flat roof */
  prism(x: number, z: number, y0: number, y1: number, w: number, d: number, rot: number, c: THREE.Color, curtain = 0, refl = 0, ch = 4) {
    const ca = Math.cos(rot), sa = Math.sin(rot);
    const hw = w / 2, hd = d / 2;
    ch = Math.min(ch, hw * 0.45, hd * 0.45);
    const ring: [number, number][] = [[hw, -hd + ch], [hw, hd - ch], [hw - ch, hd], [-hw + ch, hd], [-hw, hd - ch], [-hw, -hd + ch], [-hw + ch, -hd], [hw - ch, -hd]];
    const W = ring.map(([lx, lz]) => [x + lx * ca + lz * sa, z - lx * sa + lz * ca] as const);
    for (let k = 0; k < 8; k++) {
      const [ax, az] = W[k], [bx, bz] = W[(k + 1) % 8];
      let nx = bz - az, nz = -(bx - ax);
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      // outward: away from the centre
      if (nx * ((ax + bx) / 2 - x) + nz * ((az + bz) / 2 - z) < 0) { nx = -nx; nz = -nz; }
      const i = this.pos.length / 3;
      for (const [px, py, pz] of [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]]) {
        this.pos.push(px, py, pz);
        this.nor.push(nx, 0, nz);
        this.col.push(c.r, c.g, c.b);
        this.wv(curtain, refl, y0);
      }
      this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3, i, i + 2, i + 1, i, i + 3, i + 2);
    }
    const i = this.pos.length / 3;
    for (const [px, pz] of W) {
      this.pos.push(px, y1, pz);
      this.nor.push(0, 1, 0);
      this.col.push(c.r, c.g, c.b);
      this.wv(curtain, refl, y0);
    }
    for (let k = 1; k < 7; k++) this.idx.push(i, i + k + 1, i + k, i, i + k, i + k + 1);
  }
  /**
   * A tower the way they're actually put together: a podium on the street (shopfronts, a wider
   * footprint), the shaft (square or with its corners cut), maybe a setback two-thirds of the way
   * up, and a top — a plant room behind a screen, a glazed crown or a mast. `seed` 0…1 picks it.
   */
  tower(x: number, z: number, y: number, h: number, w: number, d: number, rot: number, c: THREE.Color, curtain: number, refl: number, seed: number) {
    const sd = (k: number) => frac(seed * k);
    this.seed = 0.01 + seed * 0.98;
    this.base = y;
    const cham = sd(31.7) < 0.28 && h > 45;
    const shaft = (y0: number, y1: number, ww: number, dd: number) => (cham ? this.prism(x, z, y0, y1, ww, dd, rot, c, curtain, refl, Math.min(ww, dd) * 0.16) : this.box(x, z, y0, y1, ww, dd, rot, c, curtain, refl));
    let top = y + h;
    let tw = w, td = d;
    if (h > 40 && sd(7.7) < 0.7) {
      // podium: stone or darker glass, a little wider than the tower
      const ph = 9 + sd(11.3) * 14;
      const pc = c.clone().lerp(new THREE.Color(0x8a8378), 0.45).multiplyScalar(0.92);
      this.box(x, z, y, y + ph, w * 1.18, d * 1.18, rot, pc, 0.15, 0.25);
      if (h > 90 && sd(13.1) < 0.45) {
        const sb = y + h * (0.6 + 0.18 * sd(17.9));
        shaft(y + ph, sb, w, d);
        tw = w * 0.8;
        td = d * 0.8;
        // a slab edge where it steps back
        this.box(x, z, sb, sb + 1.2, w * 1.01, d * 1.01, rot, c.clone().multiplyScalar(0.7), 0, 0);
        shaft(sb, top, tw, td);
      } else shaft(y + ph, top, w, d);
    } else shaft(y, top, w, d);
    // the top
    const k = sd(41.3);
    const dark = c.clone().multiplyScalar(0.62);
    if (h > 30) {
      // parapet line
      this.box(x, z, top, top + 1.1, tw * 0.99, td * 0.99, rot, c.clone().multiplyScalar(0.85), 0, 0);
      if (k < 0.4) {
        // plant room behind louvres + a couple of units
        this.box(x, z, top, top + 4 + sd(47.1) * 5, tw * 0.6, td * 0.55, rot, dark, 0, 0);
        this.box(x + tw * 0.25, z, top, top + 2.5, tw * 0.2, td * 0.25, rot, dark, 0, 0);
      } else if (k < 0.7 && h > 80) {
        // glazed crown: the curtain wall carried up past the roof as a screen
        this.box(x, z, top, top + 6 + sd(53.7) * 8, tw * 1.0, td * 1.0, rot, c.clone().lerp(new THREE.Color(0x9fb3c2), 0.4), 1, 1);
      } else {
        this.box(x, z, top, top + 3.5, tw * 0.45, td * 0.4, rot, dark, 0, 0);
      }
      if (h > 140 && sd(59.3) < 0.5) {
        const mh = 18 + sd(61.7) * 30;
        this.box(x, z, top, top + mh, 1.6, 1.6, rot, new THREE.Color(0xc8c8c8), 0, 0);
      }
    }
    this.seed = 0;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWin', new THREE.Float32BufferAttribute(this.win, 4));
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

  // the tops of the taller blocks: plant rooms and lift overruns (and a podium under the towers)
  for (const b of boxes.slice()) {
    if (b.h < 24) continue;
    const k = frac(Math.sin(b.x * 3.1 + b.z * 7.7) * 9137.13);
    const dark = b.col.clone().multiplyScalar(0.6);
    boxes.push({ ...b, y: b.y + b.h, h: 3 + k * 5, w: b.w * (0.35 + 0.3 * k), d: b.d * (0.35 + 0.25 * k), col: dark, curtain: 0, refl: 0 });
    if (b.h > 45 && k < 0.7) boxes.push({ ...b, h: 8 + k * 12, w: b.w * 1.16, d: b.d * 1.16, col: b.col.clone().lerp(STONE[0], 0.5).multiplyScalar(0.9), curtain: 0.15, refl: 0.2 });
  }

  // ---------------------------------------------------------------- instanced generic buildings
  {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const win = new Float32Array(boxes.length * 4);
    boxes.forEach((b, i) => {
      win[i * 4] = b.curtain;
      win[i * 4 + 1] = b.refl;
      // a seed per building, storeys counted from its own base
      win[i * 4 + 2] = 0.01 + 0.98 * frac(Math.sin(b.x * 12.9898 + b.z * 78.233) * 43758.5453);
      win[i * 4 + 3] = b.y;
    });
    geo.setAttribute('aWin', new THREE.InstancedBufferAttribute(win, 4));
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
