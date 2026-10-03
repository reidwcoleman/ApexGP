import * as THREE from 'three';
import type { MeshBuilder } from './geom.ts';
import { weatherUniforms } from '../weatherUniforms.ts';

/**
 * Architectural surfaces for the grandstands (and anything else built with MeshBuilder):
 * one vertex-coloured MeshStandardMaterial whose fragment stage adds the detail a real stand
 * shows in race footage — none of it in textures, all procedural, all faded out by its own
 * screen-space footprint so nothing shimmers at 300 m.
 *
 * Per vertex, MeshBuilder's two free channels carry:
 *   aLeaf  the surface class (ARCH.*)
 *   aWind  the yaw of the structure's long axis (radians, world x→z), so ribs, seats and
 *          panel joints run along the stand whatever way it faces
 *
 *   CONCRETE  cast-in-place concrete: blotchy cure/weathering at two scales, long vertical
 *             rain-run streaks on walls, formwork panel joints and tie holes up close
 *   STEEL     painted steel: a faint mottle and chalky, uneven sheen (never a mirror)
 *   CLAD      corrugated profiled sheet (roof decks, back cladding): trapezoidal ribs bent into
 *             the normal along the axis, groove shading, dirt washed down the ribs
 *   SEAT      moulded plastic seats: a 0.5 m pitch of seat backs with dark gaps, each seat
 *             its own sun-faded shade, a satin sheen
 *   PLAIN     no detail (doors, scrim, dark voids)
 *   FABRIC    PVC membrane / scrim: soft broad mottle, very rough
 *
 * Rain darkens and glosses every class, more on upward faces, with streaks down walls.
 */
export const ARCH = { CONCRETE: 0, STEEL: 1, CLAD: 2, SEAT: 3, PLAIN: 4, FABRIC: 5 } as const;

/** set the class of every vertex of `mb` from index `from` on */
export function tagClass(mb: MeshBuilder, from: number, cls: number) {
  for (let i = from; i < mb.leaf.length; i++) mb.leaf[i] = cls;
}
/** set the axis yaw of every vertex of `mb` from index `from` on */
export function tagAxis(mb: MeshBuilder, from: number, yaw: number) {
  for (let i = from; i < mb.wind.length; i++) mb.wind[i] = yaw;
}

/** MeshBuilder.append without spreading (a whole stand overflows the argument stack) */
export function appendInto(dst: MeshBuilder, src: MeshBuilder) {
  const off = dst.vertexCount;
  for (let i = 0; i < src.pos.length; i++) {
    dst.pos.push(src.pos[i]);
    dst.nor.push(src.nor[i]);
    dst.col.push(src.col[i]);
  }
  for (let i = 0; i < src.wind.length; i++) {
    dst.wind.push(src.wind[i]);
    dst.leaf.push(src.leaf[i]);
  }
  for (let i = 0; i < src.uv.length; i++) dst.uv.push(src.uv[i]);
  for (let i = 0; i < src.idx.length; i++) dst.idx.push(src.idx[i] + off);
}

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
/**
 * A straight member (box section) between two points: width `w` across, depth `t` in the
 * plane closest to `upHint`. Used for truss chords, diagonals, braces and handrails.
 */
export function member(mb: MeshBuilder, a: THREE.Vector3, b: THREE.Vector3, w: number, t: number, c: THREE.Color, upHint = new THREE.Vector3(0, 1, 0), opts: { skipBottom?: boolean; skipTop?: boolean; caps?: boolean } = {}) {
  _x.subVectors(b, a);
  const len = _x.length();
  if (len < 1e-4) return;
  _x.divideScalar(len);
  _z.crossVectors(_x, upHint);
  if (_z.lengthSq() < 1e-6) _z.crossVectors(_x, new THREE.Vector3(1, 0, 0));
  _z.normalize();
  _y.crossVectors(_z, _x).normalize();
  if (opts.caps) {
    _m.makeBasis(_x.clone().multiplyScalar(len), _y.clone().multiplyScalar(t), _z.clone().multiplyScalar(w));
    _m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    mb.box(_m, c, opts);
    return;
  }
  // the four long faces only (the end caps of a slender member never show): 8 triangles
  const hy = t / 2, hz = w / 2;
  const corner = (s: number, sy: number, sz: number) =>
    new THREE.Vector3().copy(s ? b : a).addScaledVector(_y, sy * hy).addScaledVector(_z, sz * hz);
  // each face spans from corner (sy0, sz0) to the next corner around the section
  const ring: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let f = 0; f < 4; f++) {
    const [sy0, sz0] = ring[f], [sy1, sz1] = ring[(f + 1) % 4];
    // (normal of the face between corners f and f+1: the average direction of the two)
    const nn = new THREE.Vector3().addScaledVector(_y, (sy0 + sy1) / 2).addScaledVector(_z, (sz0 + sz1) / 2).normalize();
    const p0 = corner(0, sy0, sz0), p1 = corner(0, sy1, sz1), p2 = corner(1, sy1, sz1), p3 = corner(1, sy0, sz0);
    const i0 = mb.vertex(p0.x, p0.y, p0.z, nn.x, nn.y, nn.z, c);
    const i1 = mb.vertex(p1.x, p1.y, p1.z, nn.x, nn.y, nn.z, c);
    const i2 = mb.vertex(p2.x, p2.y, p2.z, nn.x, nn.y, nn.z, c);
    const i3 = mb.vertex(p3.x, p3.y, p3.z, nn.x, nn.y, nn.z, c);
    // wind the pair so it faces along nn
    const e1 = new THREE.Vector3().subVectors(p1, p0), e2 = new THREE.Vector3().subVectors(p2, p0);
    if (e1.cross(e2).dot(nn) >= 0) mb.idx.push(i0, i1, i2, i0, i2, i3);
    else mb.idx.push(i0, i2, i1, i0, i3, i2);
  }
}

const GLSL_COMMON = /* glsl */ `
varying vec3 vArWP;
varying vec3 vArWN;
varying vec2 vAr;
uniform float uWetness;
float arH( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float arN( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( arH( i ), arH( i + vec2( 1.0, 0.0 ) ), f.x ), mix( arH( i + vec2( 0.0, 1.0 ) ), arH( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
/** distance (in cells) to the nearest grid line of period p, anti-aliased by the footprint fw */
float arLine( float x, float p, float w, float fw ) {
  float d = abs( fract( x / p + 0.5 ) - 0.5 ) * p;
  return 1.0 - smoothstep( w, w + fw * 1.5, d );
}
`;

/**
 * `fine`: for the slender parts (rails, truss webs, bracing, stairs): beyond ~180 m at a normal
 * field of view (further down a long lens) they are sub-pixel, so the vertex stage drops them
 * before they cost any rasterising; the seats (ARCH.SEAT) always stay.
 */
export function archMaterial(fine = false): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  if (fine) m.defines = { ARCH_FINE: '' };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWetness = weatherUniforms.uWetness;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float aWind;\nattribute float aLeaf;\nvarying vec3 vArWP;\nvarying vec3 vArWN;\nvarying vec2 vAr;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvArWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvArWN = normalize( mat3( modelMatrix ) * objectNormal );\nvAr = vec2( aWind, aLeaf );`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef ARCH_FINE
  // (distance in "60 degree lens" metres: a telephoto keeps the detail further out)
  if ( aLeaf != 3.0 && distance( cameraPosition, vArWP ) * 1.732 / projectionMatrix[ 1 ][ 1 ] > 180.0 ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
#endif`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\nvec3 arBend = vec3( 0.0 );`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
{
  float cls = floor( vAr.y + 0.5 );
  vec3 N = normalize( vArWN );
  vec2 ax = vec2( cos( vAr.x ), sin( vAr.x ) );
  float along = dot( vArWP.xz, ax );
  float vert = 1.0 - smoothstep( 0.45, 0.8, abs( N.y ) );
  // face coordinates: walls use (metres along the wall, height); floors and roofs plan x/z
  vec2 tW = normalize( vec2( -N.z, N.x ) + vec2( 1e-4 ) );
  vec2 q = mix( vArWP.xz, vec2( dot( vArWP.xz, tW ), vArWP.y ), vert );
  float fw = length( fwidth( q ) );
  float near = 1.0 - smoothstep( 0.03, 0.12, fw );
  float big = arN( q * 0.11 ) * 0.6 + arN( q * 0.43 + 7.1 ) * 0.4;
  float fine = arN( q * 3.7 );
  vec3 col = diffuseColor.rgb;
  float rough = 0.85, metal = 0.0;
  if ( cls < 0.5 ) {
    // ---- concrete
    col *= 0.84 + 0.26 * big + 0.1 * ( fine - 0.5 ) * near;
    // rain-run streaks down walls (long vertical noise), stronger near the top of a pour
    float run = arN( vec2( q.x * 2.2, q.y * 0.09 ) );
    float streak = vert * smoothstep( 0.52, 0.86, run ) * ( 0.6 + 0.4 * big );
    col *= 1.0 - 0.2 * streak;
    // formwork: 2.4 x 1.2 m panel joints and tie holes, only where they resolve
    if ( near > 0.0 ) {
      float j = max( arLine( q.x, 2.4, 0.008, fw ), arLine( q.y + 0.3, 1.2, 0.006, fw ) ) * vert;
      vec2 tc = vec2( fract( q.x / 0.6 ) - 0.5, fract( ( q.y + 0.3 ) / 0.6 ) - 0.5 ) * 0.6;
      float tie = ( 1.0 - smoothstep( 0.012, 0.012 + fw, length( tc ) ) ) * vert;
      col *= 1.0 - ( 0.16 * j + 0.3 * tie ) * near;
    }
    // horizontal surfaces collect grime
    col *= 1.0 - 0.1 * ( 1.0 - vert ) * smoothstep( 0.4, 0.8, big );
    rough = 0.82 + 0.12 * fine;
  } else if ( cls < 1.5 ) {
    // ---- painted steel
    col *= 0.92 + 0.12 * big;
    float rust = smoothstep( 0.78, 0.95, arN( vec2( q.x * 3.0, q.y * 0.3 ) ) ) * vert * 0.5;
    col = mix( col, col * vec3( 0.78, 0.66, 0.55 ), rust * 0.35 );
    rough = 0.42 + 0.22 * big + 0.1 * fine * near;
    metal = 0.25;
  } else if ( cls < 2.5 ) {
    // ---- corrugated profiled sheet: 0.2 m trapezoidal ribs along the axis
    float ph = along / 0.2;
    float fwr = fwidth( ph );
    float k = 1.0 - smoothstep( 0.25, 0.6, fwr );
    float tri = abs( fract( ph ) - 0.5 ) * 2.0;
    float slope = ( smoothstep( 0.15, 0.35, tri ) - smoothstep( 0.65, 0.85, tri ) );
    float dir = sign( fract( ph ) - 0.5 );
    arBend = vec3( ax.x, 0.0, ax.y ) * dir * slope * 0.55 * k;
    float groove = smoothstep( 0.7, 1.0, tri );
    col *= ( 1.0 - 0.12 * groove * k ) * ( 0.9 + 0.16 * big );
    // dirt washed down the ribs
    col *= 1.0 - 0.14 * smoothstep( 0.55, 0.9, arN( vec2( along * 1.6, ( vert > 0.5 ? vArWP.y : dot( vArWP.xz, vec2( -ax.y, ax.x ) ) ) * 0.12 ) ) );
    rough = 0.48 + 0.2 * big;
    metal = 0.4;
  } else if ( cls < 3.5 ) {
    // ---- plastic seats at a 0.5 m pitch
    float ph = along / 0.5;
    float fws = fwidth( ph );
    float k = 1.0 - smoothstep( 0.18, 0.45, fws );
    float sx = fract( ph );
    float gap = ( 1.0 - smoothstep( 0.0, 0.07 + fws, sx ) * smoothstep( 1.0, 0.93 - fws, sx ) ) * k;
    float seatId = floor( ph ) + floor( vArWP.y * 2.17 ) * 37.0;
    float fade = arH( vec2( seatId, 3.7 ) );
    col *= ( 0.88 + 0.2 * fade * k ) * ( 1.0 - 0.55 * gap ) * ( 0.9 + 0.15 * big );
    // sun-bleached toward grey in patches
    col = mix( col, vec3( dot( col, vec3( 0.333 ) ) ), 0.25 * smoothstep( 0.55, 0.85, big ) );
    rough = 0.42 + 0.12 * fade;
  } else if ( cls < 4.5 ) {
    rough = 0.7;
  } else {
    // ---- membrane / scrim
    col *= 0.92 + 0.14 * big;
    rough = 0.9;
  }
  // rain: darker and glossier, most on what faces up; streaks running down walls
  if ( uWetness > 0.002 ) {
    float up = clamp( N.y, 0.0, 1.0 );
    float col2 = floor( q.x * 9.0 );
    float h1 = arH( vec2( col2, 1.3 ) );
    float runW = fract( vArWP.y * ( 0.2 + 0.3 * arH( vec2( col2, 7.7 ) ) ) + h1 );
    float st = step( 0.5, h1 ) * smoothstep( 0.0, 0.25, runW ) * ( 1.0 - 0.6 * runW ) * vert;
    float w = clamp( uWetness * ( 0.45 + 0.55 * up ) + st * uWetness * 0.7, 0.0, 1.0 );
    col *= 1.0 - 0.3 * w * ( 1.0 - metal );
    rough = mix( rough, rough * 0.35, w );
  }
  diffuseColor.rgb = col;
  roughnessFactor = rough;
  metalnessFactor = metal;
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  normal = normalize( normal + ( viewMatrix * vec4( arBend, 0.0 ) ).xyz );`,
      );
  };
  m.customProgramCacheKey = () => (fine ? 'apex-arch-fine-v1' : 'apex-arch-v1');
  return m;
}
