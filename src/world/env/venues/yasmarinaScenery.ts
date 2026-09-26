import * as THREE from 'three';
import type { Track } from '../../Track.ts';
import type { WorldMap } from '../worldmap.ts';
import type { Layout } from '../layout.ts';
import { srgb } from '../geom.ts';
import { buildWaters, type Water, type WaterSpec } from '../water.ts';
import { fbm2, hash2i, rng } from '../noise.ts';
import { floodUniforms } from '../night.ts';
import { MARINA, YAS_SITES, YAS_WATER_Y, yasGeo } from './yasmarinaLand.ts';
import { hotelPlan, pitTunnelPlan } from './yasmarina.ts';

/**
 * Yas Marina's landmarks and water, built once per world:
 *
 *   the sea        one water sheet over the whole far terrain (the Gulf: calm, turquoise over the
 *                  shallows), a baked depth map puts the shallow tint on the real banks
 *   the marina     vertical quay walls, pontoons and finger piers, ~40 yachts from 15 m day boats
 *                  to 90 m superyachts (their windows and decks light up after dark), the yacht
 *                  club on the north quay
 *   the W hotel    its two wings either side of the T18–T19 run, the glass bridge over the track,
 *                  and the gridshell: a 220 m free-form steel lattice of diamond glass panels
 *                  draped over both wings and the track, silver-pearl by day, a slow wash of LED
 *                  colour (blue → violet → magenta → cyan) after dark
 *   Ferrari World  the red roof north-east of the hairpin (a rounded triangle sweeping down to the
 *                  ground, the yellow shield on top, the glass funnel in the middle)
 *   the skyline    Al Raha's towers across the channel with the round Aldar HQ, Yas Mall
 *   palms          date palms along every road, the promenades and round the stands
 *
 * Everything but the palms is merged into a handful of meshes (one per material).
 */

// ---------------------------------------------------------------- mesh builder

class MB {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  get n() {
    return this.pos.length / 3;
  }
  v(p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  /** flat quad a b c d (counter-clockwise seen from the front) */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, col: THREE.Color) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    const i = this.v(a, n, col), j = this.v(b, n, col), k = this.v(c, n, col), l = this.v(d, n, col);
    this.idx.push(i, j, k, i, k, l);
  }
  /** quad whose normal is flipped to agree with `out` */
  quadOut(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, col: THREE.Color, out: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    if (n.dot(out) >= 0) this.quad(a, b, c, d, col);
    else this.quad(d, c, b, a, col);
  }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color, out?: THREE.Vector3) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    if (out && n.dot(out) < 0) {
      n.negate();
      const t = b;
      b = c;
      c = t;
    }
    const i = this.v(a, n, col), j = this.v(b, n, col), k = this.v(c, n, col);
    this.idx.push(i, j, k);
  }
  /** oriented box: centre, half extents along the local axes (x right, y up, z forward), yaw */
  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number, col: THREE.Color, bottom = false) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (x: number, y: number, z: number) => new THREE.Vector3(cx + x * c + z * s, cy + y, cz - x * s + z * c);
    const p = [P(-hx, -hy, -hz), P(hx, -hy, -hz), P(hx, -hy, hz), P(-hx, -hy, hz), P(-hx, hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), P(-hx, hy, hz)];
    this.quad(p[4], p[7], p[6], p[5], col);
    this.quad(p[3], p[2], p[6], p[7], col);
    this.quad(p[1], p[0], p[4], p[5], col);
    this.quad(p[2], p[1], p[5], p[6], col);
    this.quad(p[0], p[3], p[7], p[4], col);
    if (bottom) this.quad(p[0], p[1], p[2], p[3], col);
  }
  /** vertical prism over a closed plan polygon (x, z), from y0 to y1, with a top cap (fan from the centroid) */
  prism(plan: { x: number; z: number }[], y0: number, y1: number, col: THREE.Color, capCol?: THREE.Color, cap = true) {
    let cx = 0, cz = 0;
    for (const q of plan) { cx += q.x; cz += q.z; }
    cx /= plan.length;
    cz /= plan.length;
    for (let i = 0; i < plan.length; i++) {
      const a = plan[i], b = plan[(i + 1) % plan.length];
      const out = new THREE.Vector3((a.x + b.x) / 2 - cx, 0, (a.z + b.z) / 2 - cz);
      this.quadOut(new THREE.Vector3(a.x, y0, a.z), new THREE.Vector3(b.x, y0, b.z), new THREE.Vector3(b.x, y1, b.z), new THREE.Vector3(a.x, y1, a.z), col, out);
      if (cap) this.tri(new THREE.Vector3(cx, y1, cz), new THREE.Vector3(a.x, y1, a.z), new THREE.Vector3(b.x, y1, b.z), capCol ?? col, new THREE.Vector3(0, 1, 0));
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** stadium plan (rectangle with semicircular ends): centre, half width / half length, yaw of the long axis */
function stadium(cx: number, cz: number, hw: number, hl: number, yaw: number, seg = 10): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const r = hw, e = Math.max(0, hl - hw);
  const push = (u: number, v: number) => out.push({ x: cx + u * c + v * s, z: cz - u * s + v * c });
  for (let k = 0; k <= seg; k++) {
    const a = -Math.PI / 2 + (k / seg) * Math.PI;
    push(Math.sin(a) * r, e + Math.cos(a) * r);
  }
  for (let k = 0; k <= seg; k++) {
    const a = Math.PI / 2 + (k / seg) * Math.PI;
    push(Math.sin(a) * r, -e + Math.cos(a) * r);
  }
  return out;
}

// ---------------------------------------------------------------- materials

/** night factor (0 day … 1 night) shared with the floodlights */
const NIGHT = 'smoothstep( 0.0, 0.5, uFlood.x )';
/** animation clock for the LED shows (seconds) */
const uClock = { value: 0 };

/** vertex-coloured, emits its vertex colour × k after dark (yacht windows, lamps, glowing signs) */
function litMat(k: number, base: number, key: string, rough = 0.3): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: srgb(base), vertexColors: true, roughness: rough, metalness: 0.2 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlood = { value: floodUniforms.params };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uFlood;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * ${k.toFixed(2)} * ${NIGHT};`);
  };
  m.customProgramCacheKey = () => 'apex-yas-lit-' + key;
  return m;
}

/**
 * Buildings: vertex colour = the cladding; floors every 3.5 m with a glass band, mullions every
 * 2.6 m; after dark about half the rooms light up warm (a few cool-white offices).
 */
function facadeMat(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlood = { value: floodUniforms.params };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFW;\nvarying vec3 vFN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvFW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvFN = normalize( mat3( modelMatrix ) * objectNormal );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uFlood;\nvarying vec3 vFW;\nvarying vec3 vFN;\nfloat fHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float fWin = 0.0;
float fLit = 0.0;
{
  float side = 1.0 - smoothstep( 0.35, 0.6, abs( vFN.y ) );
  float fl = vFW.y / 3.5;
  float h = dot( vFW.xz, normalize( vec2( -vFN.z, vFN.x ) + 1e-4 ) ) / 2.6;
  float band = smoothstep( 0.24, 0.3, fract( fl ) ) * ( 1.0 - smoothstep( 0.9, 0.96, fract( fl ) ) );
  float mull = smoothstep( 0.04, 0.1, fract( h ) ) * ( 1.0 - smoothstep( 0.9, 0.96, fract( h ) ) );
  fWin = band * mull * side;
  float room = fHash( vec2( floor( fl ), floor( h / 2.0 ) ) + floor( vFW.xz / 60.0 ) );
  fLit = fWin * step( 0.45, room );
  // far off the windows melt into an average (no shimmer on the distant towers)
  float aa = clamp( ( fwidth( fl ) + fwidth( h ) ) * 2.0 - 0.35, 0.0, 1.0 );
  fWin = mix( fWin, 0.5 * side, aa );
  fLit = mix( fLit, 0.26 * side, aa );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.05, 0.07, 0.09 ), fWin * 0.88 );
}`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.08, fWin );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, 0.6, fWin );')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float warm = fHash( floor( vFW.xz / 30.0 ) + 3.7 );
  vec3 lamp = mix( vec3( 1.0, 0.72, 0.42 ), vec3( 0.85, 0.92, 1.0 ), step( 0.75, warm ) );
  totalEmissiveRadiance += lamp * fLit * 1.25 * ${NIGHT};
}`,
      );
  };
  m.customProgramCacheKey = () => 'apex-yas-facade';
  return m;
}

/**
 * The gridshell: a steel lattice of diamond panels in shell coordinates (attribute `aShell`,
 * metres along the surface). Silver-pearl glass by day (each panel pivoted a little, so they
 * catch the sky differently); after dark every panel is an LED pixel of a slow colour wash.
 */
function gridshellMat(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: srgb(0xdfe5ea), roughness: 0.22, metalness: 0.75, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFlood = { value: floodUniforms.params };
    sh.uniforms.uClock = uClock;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aShell;\nvarying vec2 vShell;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShell = aShell;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 uFlood;
uniform float uClock;
varying vec2 vShell;
float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 41.3, 289.1 ) ) ) * 17831.73 ); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 gD = vec2( vShell.x * 1.25 + vShell.y, vShell.x * 1.25 - vShell.y ) * ( 0.7071 / 2.5 );
vec2 gF = fract( gD );
vec2 gId = floor( gD );
float gW = fwidth( gD.x ) + fwidth( gD.y );
float gEdge = min( min( gF.x, 1.0 - gF.x ), min( gF.y, 1.0 - gF.y ) );
float gFrame = 1.0 - smoothstep( 0.035, 0.035 + gW * 1.2, gEdge );
gFrame = mix( gFrame, 0.3, smoothstep( 0.25, 0.6, gW ) );
// the panels are separate pivoting diamonds: an open slot between each one and the lattice
// (close up you see through the shell to the hotel; far off it closes into a veil, no shimmer)
if ( gW < 0.22 && gEdge > 0.04 && gEdge < 0.04 + 0.055 * ( 1.0 - smoothstep( 0.1, 0.22, gW ) ) ) discard;
float gH = gHash( gId );
diffuseColor.rgb *= mix( 0.8 + 0.35 * gH, 0.55, gFrame );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize( normal + ( vec3( gH, gHash( gId + 7.1 ), gHash( gId + 3.3 ) ) - 0.5 ) * 0.35 * ( 1.0 - gFrame ) );`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( 0.12 + 0.2 * gH, 0.55, gFrame );')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float night = ${NIGHT};
  if ( night > 0.001 ) {
    // a slow wash of colour rolling along the shell, with a few panels sparkling
    float ph = uClock * 0.045 + vShell.y * 0.0045 + sin( vShell.x * 0.03 + uClock * 0.2 ) * 0.06;
    // Yas's palette: deep blue → violet → magenta → back through cyan, never far from blue
    float k = fract( ph );
    vec3 c = k < 0.25 ? mix( vec3( 0.12, 0.3, 1.0 ), vec3( 0.55, 0.18, 1.0 ), k * 4.0 )
           : k < 0.5 ? mix( vec3( 0.55, 0.18, 1.0 ), vec3( 1.0, 0.2, 0.62 ), ( k - 0.25 ) * 4.0 )
           : k < 0.75 ? mix( vec3( 1.0, 0.2, 0.62 ), vec3( 0.1, 0.75, 1.0 ), ( k - 0.5 ) * 4.0 )
           : mix( vec3( 0.1, 0.75, 1.0 ), vec3( 0.12, 0.3, 1.0 ), ( k - 0.75 ) * 4.0 );
    float tw = pow( max( 0.0, sin( uClock * ( 0.7 + 1.9 * gH ) + gH * 40.0 ) ), 24.0 );
    float lvl = 0.7 + 0.3 * sin( vShell.x * 0.05 - uClock * 0.4 + gH ) + 1.6 * tw;
    float pix = smoothstep( 0.1, 0.2, gEdge ) * 0.75 + 0.25;
    totalEmissiveRadiance += c * lvl * ( 1.0 - gFrame ) * pix * 2.4 * night;
    diffuseColor.rgb *= 1.0 - 0.8 * night;
  }
}`,
      );
  };
  m.customProgramCacheKey = () => 'apex-yas-gridshell';
  return m;
}

// ---------------------------------------------------------------- water

function buildSea(map: WorldMap): Water {
  const F = map.FAR, S = map.SQUARE;
  const N = 512;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = S.x0 + ((i + 0.5) / N) * (S.x1 - S.x0), z = S.z0 + ((j + 0.5) / N) * (S.z1 - S.z0);
      const d = Math.max(0, Math.min(1, (YAS_WATER_Y - map.height(x, z)) / 7));
      const k = (j * N + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(d * 255);
      data[k + 3] = 255;
    }
  const depth = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  depth.magFilter = THREE.LinearFilter;
  depth.minFilter = THREE.LinearFilter;
  depth.generateMipmaps = false;
  depth.needsUpdate = true;
  const sea: WaterSpec = {
    outline: [{ x: F.x0, z: F.z0 }, { x: F.x1, z: F.z0 }, { x: F.x1, z: F.z1 }, { x: F.x0, z: F.z1 }],
    y: YAS_WATER_Y,
    kind: 'sea',
    flow: { x: 0.05, z: 0.02 },
    // the Gulf: clear, warm, turquoise over the sand shallows
    deep: [0.008, 0.045, 0.058],
    shallow: [0.05, 0.17, 0.15],
    shore: 0,
    depth: { map: depth, x0: S.x0, z0: S.z0, x1: S.x1, z1: S.z1, range: 7 },
  };
  return buildWaters([sea]);
}

/** Abu Dhabi in December: irrigated lawns, pale sand, flat pale roofs */
export function yasmarinaTerrainLook(u: Record<string, THREE.IUniform>) {
  const set = (k: string, hex: number) => {
    const v = u[k]?.value;
    if (v instanceof THREE.Color) v.set(hex);
  };
  set('uLawn', 0x5a7a34);
  set('uMeadow', 0x7d7a4c);
  set('uStraw', 0xb09c6c);
  set('uGrassDark', 0x3f5a24);
  set('uRoof', 0xd6d0c4);
  set('uGravel', 0xcdbd98);
  set('uCanopy', 0x46562c);
}

// ---------------------------------------------------------------- palms

/** date palms: a stout ringed trunk and a round crown of stiff, arching blue-green fronds */
function buildPalms(spots: { x: number; y: number; z: number; s: number }[]): THREE.Group {
  const trunk = new THREE.CylinderGeometry(0.26, 0.34, 1, 6, 3, true);
  trunk.translate(0, 0.5, 0);
  const crown = frondCrown();
  const tex = frondTexture();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8d7b62, roughness: 0.95 });
  trunkMat.onBeforeCompile = (sh) => {
    // the stubs of the cut leaf bases: a diamond cross-hatch up the trunk
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTU;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTU = vec2( atan( position.x, position.z ) * 1.6, position.y * 22.0 );');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTU;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 d = fract( vec2( vTU.x + vTU.y, vTU.x - vTU.y ) * 0.5 );
  float e = min( min( d.x, 1.0 - d.x ), min( d.y, 1.0 - d.y ) );
  diffuseColor.rgb *= 0.72 + 0.4 * smoothstep( 0.03, 0.2, e );
}`,
      );
  };
  trunkMat.customProgramCacheKey = () => 'apex-yas-palm-trunk';
  const leafMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7, color: 0xffffff });
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.4, side: THREE.DoubleSide });
  const n = spots.length;
  const tm = new THREE.InstancedMesh(trunk, trunkMat, Math.max(1, n));
  const cm = new THREE.InstancedMesh(crown, leafMat, Math.max(1, n));
  cm.customDepthMaterial = leafDepth;
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  const e = new THREE.Euler();
  const tint = new THREE.Color();
  const top = new THREE.Vector3();
  spots.forEach((sp, i) => {
    const hx = Math.floor(sp.x * 3), hz = Math.floor(sp.z * 3);
    const H = (6.5 + hash2i(hx, hz, 5) * 6) * sp.s;
    const lean = (hash2i(hx, hz, 6) - 0.5) * 0.1;
    const yaw = hash2i(hx, hz, 7) * Math.PI * 2;
    e.set(lean, yaw, 0, 'YXZ');
    q.setFromEuler(e);
    ps.set(sp.x, sp.y - 0.15, sp.z);
    sc.set(sp.s, H, sp.s);
    M.compose(ps, q, sc);
    tm.setMatrixAt(i, M);
    top.set(0, H, 0).applyQuaternion(q).add(ps);
    const cs = sp.s * (1.0 + hash2i(hx, hz, 8) * 0.3);
    e.set(lean * 0.5, yaw * 3.1, 0, 'YXZ');
    q.setFromEuler(e);
    sc.set(cs, cs, cs);
    M.compose(top, q, sc);
    cm.setMatrixAt(i, M);
    const h = hash2i(hx, hz, 9);
    tint.setRGB(0.85 + h * 0.25, 0.9 + h * 0.14, 0.82 + hash2i(hx, hz, 10) * 0.2);
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
  tm.name = 'yas_palm_trunks';
  cm.name = 'yas_palm_crowns';
  const g = new THREE.Group();
  g.name = 'Palms';
  g.add(tm, cm);
  return g;
}

/** 18 stiff fronds in three tiers (arching out and a little down) + a few young upright ones */
function frondCrown(): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const add = (yaw: number, pitch: number, len: number, width: number, droop: number) => {
    const seg = 3;
    const base = pos.length / 3;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    let rx = 0, ry = 0;
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      if (k > 0) {
        const th = Math.max(-1.1, pitch - droop * (t - 0.5 / seg));
        rx += Math.cos(th) * (len / seg);
        ry += Math.sin(th) * (len / seg);
      }
      const w = width * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.1)) * 0.5;
      // date palm leaflets stand up in a V along the rachis
      for (const sgn of [-1, 1]) {
        pos.push(dir.x * rx + side.x * w * sgn, ry + w * 0.3, dir.z * rx + side.z * w * sgn);
        uv.push(sgn < 0 ? 0 : 1, t);
      }
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };
  const N = 18;
  for (let i = 0; i < N; i++) {
    const yaw = (i / N) * Math.PI * 2 + (i % 3) * 0.17;
    const tier = i % 3;
    add(yaw, [0.1, 0.5, 0.95][tier], [4.2, 4.0, 3.4][tier] + ((i * 7) % 5) * 0.1, 1.5, [1.1, 0.9, 0.6][tier]);
  }
  for (let i = 0; i < 4; i++) add((i / 4) * Math.PI * 2 + 0.4, 1.35, 2.6, 1.0, 0.3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const nr = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < nr.count; i++) {
    const v = new THREE.Vector3(nr.getX(i), Math.abs(nr.getY(i)) + 0.8, nr.getZ(i)).normalize();
    nr.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** a date-palm frond seen flat: stiff narrow leaflets at a sharp angle, grey-green */
function frondTexture(): THREE.CanvasTexture {
  const W = 128, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const r = rng(91);
  ctx.lineCap = 'round';
  for (let y = 16; y < H - 4; y += 5) {
    const t = y / H;
    const len = W * 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.06)) * (0.85 + r() * 0.2);
    for (const sgn of [-1, 1]) {
      const g = 0.8 + r() * 0.3;
      ctx.strokeStyle = `rgb(${Math.round(78 * g)},${Math.round(104 * g)},${Math.round(62 * g)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      ctx.lineTo(W / 2 + sgn * len, y + len * 0.95 + (r() - 0.5) * 5);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = '#7a6f45';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- Ferrari World's roof texture

function ferrariRoofTexture(): THREE.CanvasTexture {
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#c4161c';
  ctx.fillRect(0, 0, S, S);
  // panel seams: concentric rings and radial ribs
  ctx.strokeStyle = 'rgba(90,6,10,0.35)';
  ctx.lineWidth = 2;
  for (let r = 20; r < S * 0.7; r += 18) {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(S / 2 + Math.cos(a) * 40, S / 2 + Math.sin(a) * 40);
    ctx.lineTo(S / 2 + Math.cos(a) * S, S / 2 + Math.sin(a) * S);
    ctx.stroke();
  }
  // the shield (scudetto) on the south-west lobe: yellow, the tricolore on top, the black horse
  ctx.save();
  ctx.translate(S * 0.37, S * 0.63);
  ctx.rotate(0.62);
  const w = 120, h = 160;
  ctx.fillStyle = '#ffd200';
  ctx.beginPath();
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  ctx.lineTo(w / 2, h * 0.12);
  ctx.quadraticCurveTo(w / 2, h * 0.4, 0, h / 2);
  ctx.quadraticCurveTo(-w / 2, h * 0.4, -w / 2, h * 0.12);
  ctx.closePath();
  ctx.fill();
  for (const [c, k] of [['#009246', 0], ['#f4f4f4', 1], ['#ce2b37', 2]] as const) {
    ctx.fillStyle = c;
    ctx.fillRect(-w / 2 + (k * w) / 3, -h / 2, w / 3 + 0.5, h * 0.1);
  }
  // the prancing horse, a rough silhouette
  ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.moveTo(-10, 55);
  ctx.lineTo(-4, 20);
  ctx.quadraticCurveTo(-26, 10, -22, -12);
  ctx.lineTo(-34, -30);
  ctx.lineTo(-24, -34);
  ctx.quadraticCurveTo(-10, -44, 4, -40);
  ctx.lineTo(10, -50);
  ctx.lineTo(14, -36);
  ctx.quadraticCurveTo(26, -24, 20, -4);
  ctx.quadraticCurveTo(34, 8, 28, 30);
  ctx.lineTo(20, 26);
  ctx.quadraticCurveTo(22, 12, 12, 8);
  ctx.lineTo(8, 55);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------------------------------------------------------------- build

export interface YasScenery {
  group: THREE.Group;
  tris: number;
  update(elapsed: number): void;
}

export function buildYasmarinaScenery(layout: Layout, track: Track, map: WorldMap): YasScenery {
  const group = new THREE.Group();
  group.name = 'YasMarinaScenery';
  const r = rng(2009);
  const g = (x: number, z: number) => map.height(x, z);
  const W = YAS_WATER_Y;

  const solid = new MB(); // concrete, pontoons, hulls below the sheer
  const gloss = new MB(); // white gloss: yacht superstructures, hotel slabs
  const glass = new MB(); // lit glass (yachts' windows, the bridge, lamps)
  const facade = new MB(); // buildings with windows
  const steel = new MB();
  const shellMB: { pos: number[]; nor: number[]; sh: number[]; idx: number[] } = { pos: [], nor: [], sh: [], idx: [] };

  const water = buildSea(map);
  group.add(water.mesh);

  // ---------------------------------------------------------------- the marina: quays and pontoons
  const M = MARINA;
  const coastAt = (z: number) => {
    // where the land ends east along the quay (walk until the coast goes negative)
    let x = M.x0;
    while (x < M.x1 && yasGeo(x + 4, z - 12).coast > 2 && yasGeo(x + 4, z + 12).coast > 2) x += 4;
    return x;
  };
  {
    const conc = srgb(0xd9d2c3), cap = srgb(0xece6d8);
    const yBot = W - 1.2;
    const edge = (ax: number, az: number, bx: number, bz: number, inward: THREE.Vector3) => {
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(L / 10));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const ya = Math.max(W + 1.1, g(x0 - inward.x * 3, z0 - inward.z * 3) + 0.08);
        const yb = Math.max(W + 1.1, g(x1 - inward.x * 3, z1 - inward.z * 3) + 0.08);
        const a = new THREE.Vector3(x0, yBot, z0), b = new THREE.Vector3(x1, yBot, z1);
        const at = new THREE.Vector3(x0, ya, z0), bt = new THREE.Vector3(x1, yb, z1);
        solid.quadOut(a, b, bt, at, conc, inward);
        const ao = at.clone().addScaledVector(inward, -1.4), bo = bt.clone().addScaledVector(inward, -1.4);
        solid.quadOut(at, bt, bo, ao, cap, new THREE.Vector3(0, 1, 0));
      }
    };
    const xn = coastAt(M.z0), xs = coastAt(M.z1);
    edge(M.x0, M.z0, xn, M.z0, new THREE.Vector3(0, 0, 1));
    edge(M.x0, M.z1, xs, M.z1, new THREE.Vector3(0, 0, -1));
    edge(M.x0, M.z0, M.x0, M.z1, new THREE.Vector3(1, 0, 0));
    // breakwater heads at the harbour mouth
    for (const [x, z] of [[xn, M.z0], [xs, M.z1]] as const) solid.box(x + 6, W + 0.3, z, 7, 1.8, 7, 0, srgb(0xbdb5a4));
  }

  // pontoons: two long piers into the basin with finger piers, a pontoon along the west quay
  const deck = srgb(0x9c8a70), float = srgb(0xe6e3dc);
  const pontoon = (x0: number, z0: number, x1: number, z1: number, w: number) => {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const L = Math.hypot(x1 - x0, z1 - z0);
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    solid.box(cx, W + 0.45, cz, w / 2, 0.08, L / 2, yaw, deck);
    solid.box(cx, W + 0.2, cz, w / 2 - 0.05, 0.18, L / 2 - 0.05, yaw, float);
  };
  type Berth = { x: number; z: number; yaw: number; L: number };
  const berths: Berth[] = [];
  {
    // the superyacht quay: side-to along the north quay (bows east)
    let x = M.x0 + 28;
    while (x < M.x0 + 360) {
      const L = 48 + r() * 42;
      berths.push({ x: x + L / 2, z: M.z0 + 5 + (0.19 * L + 2) / 2 + 1, yaw: Math.PI / 2, L });
      x += L + 9;
    }
    // two piers running south with finger berths both sides (bows toward the pier's axis)
    for (const px of [M.x0 + 120, M.x0 + 250]) {
      const zA = M.z0 + 45, zB = M.z1 - 70;
      pontoon(px, zA, px, zB, 3.2);
      for (let z = zA + 8; z < zB - 6; z += 10 + r() * 4) {
        for (const sd of [-1, 1]) {
          if (r() < 0.18) continue;
          const L = 16 + r() * 22;
          pontoon(px + sd * 1.6, z, px + sd * (1.6 + L * 0.7), z, 1.2);
          berths.push({ x: px + sd * (2.2 + L / 2), z: z + 4.5, yaw: sd > 0 ? -Math.PI / 2 : Math.PI / 2, L });
        }
      }
    }
    // along the west quay, under the hotel: mid-size yachts side-to (bows north)
    let z = M.z0 + 60;
    while (z < M.z1 - 40) {
      const L = 30 + r() * 26;
      berths.push({ x: M.x0 + 4 + (0.19 * L + 2) / 2 + 1, z: z + L / 2, yaw: Math.PI, L });
      z += L + 8;
    }
    // a couple at anchor off the harbour mouth
    berths.push({ x: M.x1 + 120, z: M.z0 + 120, yaw: 2.2, L: 95 });
    berths.push({ x: M.x1 + 60, z: M.z1 + 180, yaw: 0.6, L: 70 });
  }

  // ---------------------------------------------------------------- yachts
  const hullWhite = srgb(0xf2f1ee), hullNavy = srgb(0x1a2433), hullGrey = srgb(0x6d737a);
  const boot = srgb(0x1b1b1b);
  const winLit = srgb(0xffc98a), winCool = srgb(0xbfe6ff);
  const yacht = (b: Berth) => {
    const { x, z, yaw, L } = b;
    const B = 0.19 * L + 2;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // local frame: +z = bow, +x = starboard
    const P = (u: number, y: number, v: number) => new THREE.Vector3(x + u * c + v * s, y, z - u * s + v * c);
    const q = r();
    const hullC = q < 0.62 ? hullWhite : q < 0.85 ? hullNavy : hullGrey;
    const free = 1.2 + 0.035 * L;
    const yDeck = W + free;
    // hull: rings along the length (stern → bow), the bow pointed and raised
    const rings = 9;
    const ring = (t: number) => {
      const hb = (B / 2) * (t < 0.55 ? 1 - 0.08 * (1 - t / 0.55) : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2)));
      const v = -L / 2 + t * L;
      const sheer = yDeck + 0.9 * Math.max(0, t - 0.6) ** 2 * 3;
      return [P(-hb, sheer, v), P(-hb * 0.94, W + 0.05, v), P(-hb * 0.35, W - 1.4, v), P(hb * 0.35, W - 1.4, v), P(hb * 0.94, W + 0.05, v), P(hb, sheer, v)];
    };
    const R: THREE.Vector3[][] = [];
    for (let k = 0; k <= rings; k++) R.push(ring(Math.min(0.999, k / rings)));
    const bowTip = P(0, yDeck + 0.9 * 0.16 * 3 + 0.1, L / 2 + 0.6);
    for (let k = 0; k < rings; k++) {
      const a = R[k], bb = R[k + 1];
      for (let e = 0; e < 5; e++) {
        const col = e === 0 || e === 4 ? hullC : e === 1 || e === 3 ? boot : hullC;
        const out = new THREE.Vector3().subVectors(a[e], P(0, W, -L / 2 + (k / rings) * L)).setY(0);
        if (e === 2) out.set(0, -1, 0);
        solid.quadOut(a[e], bb[e], bb[e + 1], a[e + 1], col, out.lengthSq() > 1e-6 ? out : new THREE.Vector3(0, -1, 0));
      }
      // deck
      gloss.quadOut(a[0], bb[0], bb[5], a[5], srgb(0xc9b28e), new THREE.Vector3(0, 1, 0));
    }
    // the transom and the bow cap
    const st = R[0];
    solid.quadOut(st[0], st[1], st[4], st[5], hullC, P(0, 0, -1).sub(P(0, 0, 0)));
    const bw = R[rings];
    for (let e = 0; e < 5; e++) solid.tri(bw[e], bw[e + 1], bowTip, e === 2 ? boot : hullC, P(0, 0, 1).sub(P(0, 0, 0)));
    // superstructure: decks stepping back and in, each with a band of windows
    const decks = L < 22 ? 1 : L < 40 ? 2 : L < 65 ? 3 : 4;
    const supC = hullC === hullNavy && q > 0.75 ? hullNavy : hullWhite;
    // (each deck: a plan swept back to a raked point at the front, like the real thing)
    const deckPlan = (hw: number, hl: number, off: number) =>
      [[-hw, -hl], [hw, -hl], [hw, hl * 0.35], [hw * 0.55, hl * 0.82], [0, hl], [-hw * 0.55, hl * 0.82], [-hw, hl * 0.35]].map(([u, v]) => {
        const q = P(u, 0, off + v);
        return { x: q.x, z: q.z };
      });
    for (let d = 0; d < decks; d++) {
      const hl = L * (0.32 - d * 0.055);
      const off = -L * (0.06 + d * 0.03);
      const hw = (B / 2) * (0.86 - d * 0.1);
      const y0 = yDeck + d * 2.9;
      gloss.prism(deckPlan(hw, hl, off), y0, y0 + 2.9, supC);
      // glass band (slightly proud), lit after dark
      const lit = r() < 0.8;
      glass.prism(deckPlan(hw + 0.07, hl * 0.95, off), y0 + 0.95, y0 + 2.25, lit ? (r() < 0.8 ? winLit : winCool) : srgb(0x000000), undefined, false);
      // the overhanging deck roof
      gloss.prism(deckPlan(hw + 0.3, hl + 0.9, off + 0.3), y0 + 2.87, y0 + 3.02, supC);
    }
    // mast / radar arch and the deck lights (a few warm points along the rails)
    if (L > 25) {
      const m = P(0, 0, -L * 0.1);
      steel.box(m.x, yDeck + decks * 2.9 + 1.6, m.z, 0.25, 1.6, 0.6, yaw, srgb(0xd9d9d9));
      const tl = P(0, 0, -L * 0.1);
      glass.box(tl.x, yDeck + decks * 2.9 + 3.3, tl.z, 0.15, 0.15, 0.15, yaw, srgb(0xffffff));
    }
    for (let k = 0; k < Math.floor(L / 8); k++) {
      const t = -L / 2 + 3 + k * 8;
      for (const sd of [-1, 1]) {
        const lp = P(sd * (B / 2 - 0.2), yDeck + 0.5, t);
        glass.box(lp.x, lp.y, lp.z, 0.08, 0.08, 0.08, yaw, winLit);
      }
    }
  };
  for (const b of berths) yacht(b);

  // ---------------------------------------------------------------- the yacht club and the marina buildings (north quay)
  {
    const zq = M.z0 - 28;
    for (const [x0, x1, floors] of [[M.x0 + 20, M.x0 + 120, 2], [M.x0 + 140, M.x0 + 240, 3], [M.x0 + 262, M.x0 + 330, 2]] as const) {
      const y = g((x0 + x1) / 2, zq);
      facade.box((x0 + x1) / 2, y + floors * 1.75, zq, (x1 - x0) / 2, floors * 1.75, 9, 0, srgb(0xf0ede6));
      gloss.box((x0 + x1) / 2, y + floors * 3.5 + 0.25, zq, (x1 - x0) / 2 + 2.5, 0.25, 11.5, 0, srgb(0xfaf8f4));
    }
    // promenade lamps along the quay
    for (let x = M.x0 + 8; x < coastAt(M.z0) - 10; x += 16) {
      const y = g(x, M.z0 - 3);
      steel.box(x, y + 2.3, M.z0 - 3, 0.06, 2.3, 0.06, 0, srgb(0x3a3d40));
      glass.box(x, y + 4.7, M.z0 - 3, 0.22, 0.12, 0.22, 0, srgb(0xffe0b0));
    }
  }

  // ---------------------------------------------------------------- the W Yas Marina hotel
  const hotel = hotelPlan(track);
  {
    const f = track.frame(hotel.sBridge);
    const O = track.point(hotel.sBridge, 0, 0);
    const y0 = track.heightAt(hotel.sBridge);
    const A = f.right.clone().setY(0).normalize();
    const V = f.tangent.clone().setY(0).normalize();
    const P = (u: number, y: number, v: number) => new THREE.Vector3(O.x + A.x * u + V.x * v, y0 + y, O.z + A.z * u + V.z * v);
    const white = srgb(0xf4f3ef);
    // the wings: stadium plans, ten floors (the east wing on the marina), a darker glazed lobby
    const wingH = [29, 27];
    hotel.wings.forEach((w, k) => {
      const plan = stadium(w.x, w.z, w.hw, w.hl, w.yaw, 8);
      const top = y0 + wingH[k];
      facade.prism(plan, y0 - 0.2, top, white, srgb(0xdedcd6));
      // a band of white fins at every other floor (the hotel's horizontal louvres)
      for (let fl = 7; fl < wingH[k]; fl += 7) {
        const band = stadium(w.x, w.z, w.hw + 0.5, w.hl + 0.5, w.yaw, 8);
        gloss.prism(band, y0 + fl - 0.25, y0 + fl + 0.25, white, white);
      }
      // the lobby: dark glass podium
      glass.prism(stadium(w.x, w.z, w.hw + 0.3, w.hl + 0.3, w.yaw, 8), y0 - 0.2, y0 + 4.6, srgb(0xffd9a0), undefined, false);
    });
    // the bridge over the track: a two-storey glass link on a white frame
    {
      const e = hotel.wings[0], wv = hotel.wings[1];
      const uE = (e.x - O.x) * A.x + (e.z - O.z) * A.z - e.hw + 1;
      const uW = (wv.x - O.x) * A.x + (wv.z - O.z) * A.z + wv.hw - 1;
      const mid = P((uE + uW) / 2, 0, 0);
      const len = uE - uW;
      const yaw = Math.atan2(A.x, A.z);
      // (box local z runs across the track, along A)
      facade.box(mid.x, y0 + 25.5, mid.z, 7, 3.2, len / 2, yaw, srgb(0xdfe6ea));
      // white fins down its sides every 3 m
      for (let t = -len / 2 + 1.5; t < len / 2; t += 3) {
        for (const sd of [-1, 1]) {
          const q = mid.clone().addScaledVector(A, t).addScaledVector(V, sd * 7.25);
          gloss.box(q.x, y0 + 25.5, q.z, 0.12, 3.3, 0.18, yaw, white);
        }
      }
      gloss.box(mid.x, y0 + 22.1, mid.z, 7.6, 0.3, len / 2 + 0.2, yaw, white, true);
      gloss.box(mid.x, y0 + 29, mid.z, 7.6, 0.35, len / 2 + 0.2, yaw, white);
    }
    // ------------------------------------------------ the gridshell
    // a lens over both wings and the track: half width w(v), crown height sweeping down to the rim
    // (long and low: ~240 m along the marina, ~125 m across, the rim 18 m up so the wings' lower
    // floors show beneath it, the crown ~45 m, a slow wave along its length)
    const U0 = 62, V0 = 132;
    const uc = (v: number) => 4 + 3 * Math.sin((v / V0) * Math.PI);
    const halfW = (v: number) => U0 * Math.sqrt(Math.max(0, 1 - Math.abs(v / V0) ** 2.2));
    const height = (nu: number, tv: number) => {
      // the rim rides high in the middle and sweeps down toward the tapering ends; the crown waves
      const rim = 12.5 + 9.5 * (1 - tv * tv) + 1.2 * Math.sin(tv * 7.5);
      const crown = rim + 22 * Math.sqrt(Math.max(0, 1 - tv * tv)) + 1.8 * Math.sin(tv * 4.6 + 0.6);
      return rim + (crown - rim) * Math.sqrt(Math.max(0, 1 - Math.abs(nu) ** 4));
    };
    const NU = 56, NV = 84;
    const S = (i: number, j: number) => {
      const tv = -0.985 + (j / NV) * 1.97;
      const v = tv * V0;
      const nu = -1 + (2 * i) / NU;
      const u = uc(v) + nu * halfW(v);
      return { p: P(u, height(nu, tv), v), u, v, nu, tv };
    };
    const grid: { p: THREE.Vector3; su: number; sv: number }[][] = [];
    for (let j = 0; j <= NV; j++) {
      const row: { p: THREE.Vector3; su: number; sv: number }[] = [];
      for (let i = 0; i <= NU; i++) row.push({ p: S(i, j).p, su: 0, sv: 0 });
      // arc length across (from the middle column) so the diamonds keep their size on the slopes
      const mid = NU / 2;
      for (let i = mid + 1; i <= NU; i++) row[i].su = row[i - 1].su + row[i].p.distanceTo(row[i - 1].p);
      for (let i = mid - 1; i >= 0; i--) row[i].su = row[i + 1].su - row[i].p.distanceTo(row[i + 1].p);
      grid.push(row);
    }
    for (let i = 0; i <= NU; i++) for (let j = 1; j <= NV; j++) grid[j][i].sv = grid[j - 1][i].sv + grid[j][i].p.distanceTo(grid[j - 1][i].p);
    const base = shellMB.pos.length / 3;
    for (let j = 0; j <= NV; j++)
      for (let i = 0; i <= NU; i++) {
        const q = grid[j][i];
        shellMB.pos.push(q.p.x, q.p.y, q.p.z);
        shellMB.sh.push(q.su, q.sv);
        shellMB.nor.push(0, 1, 0);
      }
    for (let j = 0; j < NV; j++)
      for (let i = 0; i < NU; i++) {
        const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1;
        shellMB.idx.push(a, c, b, b, c, d);
      }
    // the edge beam round the rim, and the struts that carry the shell down onto the wings' roofs
    const rim: THREE.Vector3[] = [];
    for (let j = 0; j <= NV; j++) rim.push(grid[j][NU].p);
    for (let j = NV; j >= 0; j--) rim.push(grid[j][0].p);
    const beam = srgb(0xcfd3d6);
    for (let k = 0; k + 1 < rim.length; k++) {
      const a = rim[k], b = rim[k + 1];
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const d = b.clone().sub(a);
      steel.box(mid.x, mid.y, mid.z, 0.45, 0.45, d.length() / 2 + 0.3, Math.atan2(d.x, d.z), beam);
    }
    hotel.wings.forEach((w, k) => {
      for (const t of [-0.7, 0, 0.7]) {
        const px = w.x + Math.sin(w.yaw) * w.hl * t, pz = w.z + Math.cos(w.yaw) * w.hl * t;
        steel.box(px, y0 + wingH[k] + 3, pz, 0.35, 3, 0.35, 0, beam);
      }
    });
  }

  // ---------------------------------------------------------------- the pit-exit tunnel's mouth
  {
    const tn = pitTunnelPlan(track);
    const conc = srgb(0xa9a397), dark = srgb(0x050505), lane = srgb(0x2e3034);
    const at = (s: number, lat: number, y = 0) => {
      const q = track.point(s, lat, 0);
      return new THREE.Vector3(q.x, g(q.x, q.z) + y, q.z);
    };
    // the ramp: a lane rising out of the ground between two retaining walls
    const HW = 4.2;
    for (let s = tn.s0; s < tn.s1; s += 5) {
      const s2 = Math.min(tn.s1, s + 5);
      const a0 = at(s, tn.lat - HW, 0.06), a1 = at(s, tn.lat + HW, 0.06), b0 = at(s2, tn.lat - HW, 0.06), b1 = at(s2, tn.lat + HW, 0.06);
      solid.quadOut(a0, a1, b1, b0, lane, new THREE.Vector3(0, 1, 0));
      // the walls fall from 5.5 m at the mouth to kerb height where the lane meets the road
      const hA = 3.6 * Math.max(0, 1 - (s - tn.s0) / (tn.s1 - tn.s0)) + 0.6, hB = 3.6 * Math.max(0, 1 - (s2 - tn.s0) / (tn.s1 - tn.s0)) + 0.6;
      for (const sd of [-1, 1]) {
        const w0 = at(s, tn.lat + sd * (HW + 0.3)), w1 = at(s2, tn.lat + sd * (HW + 0.3));
        const out = new THREE.Vector3().subVectors(at(s, tn.lat + sd * 10), at(s, tn.lat));
        solid.quadOut(w0, w1, w1.clone().setY(w1.y + hB), w0.clone().setY(w0.y + hA), conc, out);
        solid.quadOut(w0.clone().setY(w0.y + hA), w1.clone().setY(w1.y + hB), w1.clone().setY(w1.y + hB).addScaledVector(out.clone().normalize(), 0.5), w0.clone().setY(w0.y + hA).addScaledVector(out.clone().normalize(), 0.5), conc, new THREE.Vector3(0, 1, 0));
        solid.quadOut(w1.clone().addScaledVector(out.clone().normalize(), 0.5), w0.clone().addScaledVector(out.clone().normalize(), 0.5), w0.clone().setY(w0.y + hA).addScaledVector(out.clone().normalize(), 0.5), w1.clone().setY(w1.y + hB).addScaledVector(out.clone().normalize(), 0.5), conc, out);
      }
    }
    // the portal: a headwall over the mouth, a black opening, the lane's lights inside
    const f = track.frame(tn.s0);
    const yaw = Math.atan2(f.tangent.x, f.tangent.z);
    const m = at(tn.s0 - 1.2, tn.lat);
    solid.box(m.x, m.y + 2.7, m.z, HW + 2.2, 2.7, 1.2, yaw, conc);
    // the cut-and-cover box behind it, running back toward the track under a planted berm
    const bx = at(tn.s0 - 9, tn.lat);
    solid.box(bx.x, bx.y + 2.2, bx.z, HW + 2.4, 2.2, 8, yaw, conc);
    solid.box(bx.x, bx.y + 4.5, bx.z, HW + 3.2, 0.2, 8.6, yaw, srgb(0x5d7a34));
    const o = at(tn.s0 + 0.05, tn.lat);
    solid.box(o.x, o.y + 2.1, o.z, HW, 2.1, 0.05, yaw, dark);
    for (const sd of [-1, 1]) {
      const l = at(tn.s0 + 0.2, tn.lat + sd * (HW - 0.6), 3.6);
      glass.box(l.x, l.y, l.z, 0.35, 0.12, 0.08, yaw, srgb(0xfff1d8));
    }
    // "PIT EXIT" band on the headwall: a yellow stripe
    const band = at(tn.s0 - 0.55, tn.lat, 4.7);
    glass.box(band.x, band.y, band.z, HW + 1.6, 0.35, 0.05, yaw, srgb(0xffc400));
  }

  // ---------------------------------------------------------------- Ferrari World
  const ferrari = new THREE.Group();
  {
    const F = YAS_SITES.ferrari;
    const y0 = g(F.x, F.z);
    const Rr = (th: number) => F.r * (1 + 0.13 * Math.cos(3 * th + 0.9) + 0.03 * Math.cos(6 * th));
    // the eaves ride low on the three lobes and lift between them over the glazed entrances;
    // the roof swells to a dome round the funnel
    const eave = (th: number) => 3 + 8 * (0.5 + 0.5 * Math.cos(3 * th + 0.9 + Math.PI));
    const hAt = (rho: number, th = 0) => {
      const e = eave(th);
      return e + (34 - e) * Math.pow(Math.max(0, 1 - Math.pow(rho, 1.7)), 0.9) + 12 * Math.exp(-((rho / 0.28) ** 2));
    };
    const NT = 144, NR = 26;
    const rho0 = 0.1;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const span = F.r * 2.6;
    for (let j = 0; j <= NR; j++) {
      const rho = rho0 + (1 - rho0) * (j / NR) ** 0.9;
      for (let i = 0; i <= NT; i++) {
        const th = (i / NT) * Math.PI * 2;
        const R = Rr(th) * rho;
        const x = F.x + Math.cos(th) * R, z = F.z + Math.sin(th) * R;
        pos.push(x, y0 + hAt(rho, th), z);
        uv.push((x - F.x) / span + 0.5, 1 - ((z - F.z) / span + 0.5));
      }
    }
    for (let j = 0; j < NR; j++)
      for (let i = 0; i < NT; i++) {
        const a = j * (NT + 1) + i, b = a + 1, c = a + NT + 1, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const roofMat = new THREE.MeshStandardMaterial({ map: ferrariRoofTexture(), roughness: 0.32, metalness: 0.2, emissive: srgb(0x000000) });
    roofMat.onBeforeCompile = (sh) => {
      sh.uniforms.uFlood = { value: floodUniforms.params };
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uFlood;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3( 1.0, 0.35, 0.3 ) * 0.22 * ${NIGHT};`);
    };
    roofMat.customProgramCacheKey = () => 'apex-yas-ferrari-roof';
    const roof = new THREE.Mesh(geo, roofMat);
    roof.name = 'yas_ferrari_roof';
    roof.castShadow = true;
    roof.receiveShadow = true;
    ferrari.add(roof);
    // the skirt: dark glass from the roof's edge down to the ground
    for (let i = 0; i < NT; i++) {
      const t0 = (i / NT) * Math.PI * 2, t1 = ((i + 1) / NT) * Math.PI * 2;
      const a = new THREE.Vector3(F.x + Math.cos(t0) * Rr(t0), y0 - 0.3, F.z + Math.sin(t0) * Rr(t0));
      const b = new THREE.Vector3(F.x + Math.cos(t1) * Rr(t1), y0 - 0.3, F.z + Math.sin(t1) * Rr(t1));
      const out = new THREE.Vector3(Math.cos((t0 + t1) / 2), 0, Math.sin((t0 + t1) / 2));
      glass.quadOut(a, b, b.clone().setY(y0 + hAt(1, t1)), a.clone().setY(y0 + hAt(1, t0)), srgb(0x8a5a30), out);
    }
    // the funnel: a glass trumpet rising out of the middle, lattice ribs
    const fy = y0 + hAt(rho0);
    const NF = 40;
    for (let k = 0; k < NF; k++) {
      const a0 = (k / NF) * Math.PI * 2, a1 = ((k + 1) / NF) * Math.PI * 2;
      let prev0: THREE.Vector3 | null = null, prev1: THREE.Vector3 | null = null;
      for (let q = 0; q <= 6; q++) {
        const t = q / 6;
        const rad = 12 + 30 * t * t;
        const yy = fy - 6 + 26 * t;
        const p0 = new THREE.Vector3(F.x + Math.cos(a0) * rad, yy, F.z + Math.sin(a0) * rad);
        const p1 = new THREE.Vector3(F.x + Math.cos(a1) * rad, yy, F.z + Math.sin(a1) * rad);
        if (prev0 && prev1) {
          const out = new THREE.Vector3(Math.cos((a0 + a1) / 2), -0.4, Math.sin((a0 + a1) / 2));
          steel.quadOut(prev0, prev1, p1, p0, srgb(0xbfc9d0), out);
          steel.quadOut(prev1, prev0, p0, p1, srgb(0xaab4bb), out.clone().negate());
          steel.box((prev0.x + p0.x) / 2, (prev0.y + p0.y) / 2, (prev0.z + p0.z) / 2, 0.3, p0.distanceTo(prev0) / 2, 0.3, 0, srgb(0xe0e0e0));
        }
        prev0 = p0;
        prev1 = p1;
      }
    }
  }
  group.add(ferrari);

  // ---------------------------------------------------------------- Yas Mall, Al Raha's towers and the Aldar HQ
  {
    const Mm = YAS_SITES.mall;
    const y = g(Mm.x, Mm.z);
    const yaw = 0.25;
    facade.box(Mm.x, y + 11, Mm.z, 220, 11, 100, yaw, srgb(0xe9e3d6));
    gloss.box(Mm.x, y + 22.6, Mm.z, 226, 0.6, 106, yaw, srgb(0xf3f1ec));
    // the towers along the mainland shore across the channel
    const rr = rng(4411);
    for (let k = 0; k < 150; k++) {
      const x = -900 + rr() * 3900;
      const zShore = 2250 - 0.42 * x;
      const z = zShore + 40 + rr() * 420;
      const gg = yasGeo(x, z);
      if (gg.land !== 2 || gg.coast < 25) continue;
      if (Math.hypot(x - YAS_SITES.aldar.x, z - YAS_SITES.aldar.z) < 90) continue;
      const near = 1 - Math.min(1, (z - zShore) / 500);
      const tall = Math.exp(-(((x - 1300) / 900) ** 2));
      const slim = rr() < 0.25;
      const h = 18 + rr() * 40 + tall * near * (40 + rr() * 110) + (slim ? 40 : 0);
      const w = slim ? 9 + rr() * 6 : 14 + rr() * 16, d = slim ? 9 + rr() * 6 : 14 + rr() * 14;
      const col = [0xe7e2d6, 0x8fb0c2, 0xd9cfbd, 0x7f9fb0, 0xf0ece4, 0x9fbcb0, 0xc9c2b4][Math.floor(rr() * 7)];
      const yaw = -0.42 + (rr() - 0.5) * 0.3;
      const yb = g(x, z);
      facade.box(x, yb + h / 2, z, w, h / 2, d, yaw, srgb(col));
      // a set-back crown on the taller ones
      if (h > 70) facade.box(x, yb + h + 4, z, w * 0.7, 4, d * 0.7, yaw, srgb(col));
    }
    // the Aldar HQ: the round tower, a disc on its edge facing the island
    const Al = YAS_SITES.aldar;
    const ay = g(Al.x, Al.z);
    const R = 56, T = 12;
    const face = Math.atan2(YAS_SITES.hotel.x - Al.x, YAS_SITES.hotel.z - Al.z);
    const fx = Math.sin(face), fz = Math.cos(face);
    const sx = Math.cos(face), sz = -Math.sin(face);
    const NS = 40;
    const rimP = (k: number, d: number) => {
      const a = (k / NS) * Math.PI * 2;
      return new THREE.Vector3(Al.x + sx * Math.cos(a) * R + fx * d, ay + R + 2 + Math.sin(a) * R, Al.z + sz * Math.cos(a) * R + fz * d);
    };
    const cF = new THREE.Vector3(Al.x + fx * T, ay + R + 2, Al.z + fz * T), cB = new THREE.Vector3(Al.x - fx * T, ay + R + 2, Al.z - fz * T);
    for (let k = 0; k < NS; k++) {
      const a0 = rimP(k, T), a1 = rimP(k + 1, T), b0 = rimP(k, -T), b1 = rimP(k + 1, -T);
      const out = a0.clone().add(a1).multiplyScalar(0.5).sub(new THREE.Vector3(Al.x, ay + R + 2, Al.z));
      facade.quadOut(a0, a1, b1, b0, srgb(0xc8d2d8), out);
      facade.tri(cF, a0, a1, srgb(0xb8c6cf), new THREE.Vector3(fx, 0, fz));
      facade.tri(cB, b1, b0, srgb(0xb8c6cf), new THREE.Vector3(-fx, 0, -fz));
    }
  }

  // ---------------------------------------------------------------- palms
  const spots: { x: number; y: number; z: number; s: number }[] = [];
  {
    const taken = new Set<number>();
    const ok = (x: number, z: number, gap = 5) => {
      if (map.trackClearance(x, z) < gap) return false;
      if (map.excluded(x, z, 1.5)) return false;
      if (map.inPitZone(x, z, 6)) return false;
      if (yasGeo(x, z).coast < 3) return false;
      if (map.pathDistance(x, z).d < 1.2) return false;
      const key = Math.floor(x / 4) * 100003 + Math.floor(z / 4);
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    };
    const add = (x: number, z: number, s: number) => {
      if (spots.length < 1900 && ok(x, z)) spots.push({ x, y: g(x, z), z, s });
    };
    // behind the grandstands: a row along each concourse
    for (const gs of layout.grandstands) {
      const along = new THREE.Vector3(gs.facing.z, 0, -gs.facing.x);
      for (let t = -gs.length / 2; t <= gs.length / 2; t += 12) {
        const x = gs.center.x + along.x * t - gs.facing.x * (gs.depth / 2 + 12);
        const z = gs.center.z + along.z * t - gs.facing.z * (gs.depth / 2 + 12);
        add(x, z, 1 + r() * 0.2);
      }
    }
    // round the hotel's wings and the marina's quays
    for (const w of hotel.wings) for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; add(w.x + Math.cos(a) * (w.hw + 12), w.z + Math.sin(a) * (w.hl + 10), 1.1); }
    for (let x = M.x0 + 6; x < M.x1; x += 12) add(x, M.z0 - 13, 1.15);
    for (let z = M.z0 + 6; z < M.z1; z += 12) add(M.x0 - 16, z, 1.1);
    // Ferrari World's forecourt ring
    { const F = YAS_SITES.ferrari; for (let k = 0; k < 90; k++) { const a = (k / 90) * Math.PI * 2; add(F.x + Math.cos(a) * (F.r * 1.25 + 20), F.z + Math.sin(a) * (F.r * 1.25 + 20), 1.1); } }
    // avenues along the roads (both sides) and the promenades
    for (const path of map.paths) {
      if (path.kind !== 2) continue;
      const step = path.width > 16 ? 16 : 13;
      let acc = 0;
      for (let i = 0; i < path.pts.length - 1; i++) {
        const a = path.pts[i], b = path.pts[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        if (L < 1e-3) continue;
        const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
        // (sparser far from the circuit: the budget goes where the cameras are)
        const st = map.distToTrack(a.x, a.z) > 450 ? step * 2.5 : step;
        for (let t = 0; t < L; t += 1) {
          if (++acc < st) continue;
          acc = 0;
          const f = t / L;
          const off = path.width / 2 + 2.6;
          for (const sd of [-1, 1]) add(a.x + (b.x - a.x) * f + nx * sd * off, a.z + (b.z - a.z) * f + nz * sd * off, 0.95 + r() * 0.25);
        }
      }
    }
    // clumps on the landscaped lawns round the circuit
    const p = new THREE.Vector3();
    for (let k = 0; k < 2400; k++) {
      const s = r() * track.n;
      const side = r() < 0.5 ? -1 : 1;
      track.point(s, side * (track.barrierAt(s, side) + 10 + r() * 180), 0, p);
      if (fbm2(p.x / 120 + 2.2, p.z / 120 - 1.3, 2) < 0.12) continue;
      add(p.x + (r() - 0.5) * 6, p.z + (r() - 0.5) * 6, 0.8 + r() * 0.45);
    }
  }
  group.add(buildPalms(spots));

  // ---------------------------------------------------------------- meshes
  const add = (mb: MB, mat: THREE.Material, name: string, cast: boolean) => {
    if (mb.n === 0) return;
    const m = new THREE.Mesh(mb.geometry(), mat);
    m.name = name;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 }), 'yas_solid', true);
  add(gloss, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.05 }), 'yas_gloss', true);
  add(glass, litMat(1.6, 0x0b0f14, 'glass', 0.08), 'yas_glass', false);
  add(facade, facadeMat(), 'yas_facade', true);
  add(steel, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7 }), 'yas_steel', true);
  {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(shellMB.pos, 3));
    geo.setAttribute('aShell', new THREE.Float32BufferAttribute(shellMB.sh, 2));
    geo.setIndex(shellMB.idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, gridshellMat());
    m.name = 'yas_gridshell';
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  let tris = shellMB.idx.length / 3;
  for (const mb of [solid, gloss, glass, facade, steel]) tris += mb.idx.length / 3;
  return {
    group,
    tris,
    update: (t: number) => {
      water.update(t);
      uClock.value = t;
    },
  };
}
