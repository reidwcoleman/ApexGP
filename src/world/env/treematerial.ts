import * as THREE from 'three';
import type { TreeKit, TreeProto } from './treeproto.ts';
import { weatherUniforms } from '../weatherUniforms.ts';

/**
 * Tree materials.
 *
 *  treeMaterial()    3D trees (BatchedMesh): oriented leaf-spray cards (treeCard) + their
 *                    spray atlas and per-leaf normals / bark, crown "volume" lighting
 *                    normals, wind (treeWind: trunk lean + swing, gusts rolling through the
 *                    woods, limb sway, leaf flutter) and a passing car's wake (carWake),
 *                    light through the leaves when back-lit (shadowed properly because it
 *                    rides on the directional light's shadowed colour), crown-depth AO and
 *                    each leaf's place in its spray, hashed alpha at a distance, rain gloss,
 *                    a dithered fade-out at the 3D → impostor distance (a shorter one for
 *                    conifers: instance colour w = 2), and the same dither cross-fading each LOD
 *                    into the next (aLod) — all measured from the camera's look-ahead (uLook).
 *  treeDepthMaterial()  the same cards + wind (no flutter, no wake) + leaf alpha for the shadow map.
 *  impostorMaterial()   camera-facing cards showing the scanned tree's baked frames (8 views
 *                    around it, blended by the camera's bearing), relit from the baked
 *                    normals, swaying with the same trunk wind; they fade in exactly where
 *                    the 3D tree fades out.
 *  feedCarWake()     (Game, once a frame) the nearest cars' positions / speeds for carWake —
 *                    shared with the verge grass (grass.ts).
 */

export interface TreeUniforms {
  uTime: THREE.IUniform<number>;
  /** frame counter: the 3D/impostor hand-over dither moves every frame (a fixed one showed as hatching) */
  uFrame: THREE.IUniform<number>;
  /** 3D fade band (start, end) in metres from the camera */
  uFade: THREE.IUniform<THREE.Vector2>;
  /** the conifers' (shorter) 3D fade band: instance colour w = 2 (vegetation.ts) */
  uFadeC: THREE.IUniform<THREE.Vector2>;
  /**
   * the look-ahead (vegetation.ts update): (direction of travel x, z (unit, or 0), reach ahead for
   * the near detail — LODs, conifers — and for the broadleaf 3D → impostor hand-over (m)). Every
   * fade distance is measured from the segment the camera will cover in the next half second, so a
   * tree the car is heading for is in full detail well before it gets there, not as it goes by.
   */
  uLook: THREE.IUniform<THREE.Vector4>;
  /** LOD cross-fade: (LOD0 → 1 distance, LOD1 → 2 distance, half-width of the dithered band, 0) */
  uLodB: THREE.IUniform<THREE.Vector4>;
  /** world direction toward the sun (for the leaf shadow offset) */
  uSunW: THREE.IUniform<THREE.Vector3>;
  /**
   * sky fill multiplier on foliage: light scattered leaf to leaf through a sunlit crown
   * (strong in sunshine, near 1 under a grey deck where the sky already lights everything)
   */
  uLeafFill: THREE.IUniform<THREE.Vector3>;
}

const FILL_SUN = new THREE.Vector3(3.4, 3.55, 2.8);
const FILL_GREY = new THREE.Vector3(1.35, 1.4, 1.2);
/** set the foliage fill from how much of the light is direct sun (0 … 1) */
export function setLeafFill(u: TreeUniforms, sunShare: number) {
  u.uLeafFill.value.copy(FILL_GREY).lerp(FILL_SUN, Math.min(1, Math.max(0, sunShare)));
}

export function createTreeUniforms(): TreeUniforms {
  return { uTime: { value: 0 }, uFrame: { value: 0 }, uFade: { value: new THREE.Vector2(158, 182) }, uFadeC: { value: new THREE.Vector2(48, 56) }, uLook: { value: new THREE.Vector4() }, uLodB: { value: new THREE.Vector4(34, 50, 4, 0) }, uSunW: { value: new THREE.Vector3(0.4, 0.8, 0.4) }, uLeafFill: { value: FILL_SUN.clone() } };
}

// ---------------------------------------------------------------- car wake

/**
 * The wake of the cars nearest the camera: a car at 300 km/h drags a tongue of turbulent air behind
 * it that ruffles the verge grass, the bushes and the low branches it passes for a second or two.
 * Fed once a frame (feedCarWake, from Game) with the rigs' positions; speed and heading come from
 * how far each one moved since the last frame. Shared by the trees and the grass (CAR_WAKE_GLSL).
 */
export const wakeUniforms = {
  /** xyz world position, w speed (m/s); w = 0 when unused */
  uCarP: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
  /** heading in world xz (unit) */
  uCarD: { value: Array.from({ length: 4 }, () => new THREE.Vector2(0, 1)) },
};
const wakePrev = new WeakMap<object, { x: number; y: number; z: number; v: number; dx: number; dz: number }>();
const wakeCand: { d: number; x: number; y: number; z: number; v: number; dx: number; dz: number }[] = [];
const wakeCam = new THREE.Vector3();
/** call once a frame with every car's root object (world position) and the active camera */
export function feedCarWake(cars: Iterable<{ root: THREE.Object3D }>, camera: THREE.Camera, dt: number) {
  camera.getWorldPosition(wakeCam);
  wakeCand.length = 0;
  for (const c of cars) {
    const o = c.root;
    if (!o.visible) continue;
    const p = o.position;
    const q = wakePrev.get(o);
    if (!q) {
      wakePrev.set(o, { x: p.x, y: p.y, z: p.z, v: 0, dx: 0, dz: 1 });
      continue;
    }
    if (dt > 1e-4) {
      const dx = p.x - q.x, dz = p.z - q.z;
      const d = Math.hypot(dx, dz);
      const v = d / dt;
      // (a teleport — replay seek, pit reset — is not a car at warp speed)
      if (v < 110) {
        // (smoothed: frame-time jitter would make the wake flicker)
        q.v += (v - q.v) * Math.min(1, dt * 8);
        if (d > 0.02) {
          q.dx = dx / d;
          q.dz = dz / d;
        }
      } else q.v = 0;
      q.x = p.x;
      q.y = p.y;
      q.z = p.z;
    }
    if (q.v < 8) continue;
    wakeCand.push({ d: (p.x - wakeCam.x) ** 2 + (p.z - wakeCam.z) ** 2, x: p.x, y: p.y, z: p.z, v: q.v, dx: q.dx, dz: q.dz });
  }
  wakeCand.sort((a, b) => a.d - b.d);
  for (let i = 0; i < 4; i++) {
    const c = wakeCand[i];
    if (c && c.d < 250 * 250) {
      wakeUniforms.uCarP.value[i].set(c.x, c.y, c.z, c.v);
      wakeUniforms.uCarD.value[i].set(c.dx, c.dz);
    } else wakeUniforms.uCarP.value[i].w = 0;
  }
}

/**
 * GLSL: carWake( world position ) → (push in m at full strength, xyz; turbulence 0 … ~1, w). The
 * push is the air dragged along behind the car plus a swirl outward and up; it arrives as the car
 * passes (a little before: the nose pushes air aside), rings down over ~1.5 s, reaches further from
 * a faster car (falls to 1/e ≈ 10 m either side at 300 km/h) and hugs the ground. Scales with speed².
 */
export const CAR_WAKE_GLSL = /* glsl */ `
uniform vec4 uCarP[ 4 ];
uniform vec2 uCarD[ 4 ];
vec4 carWake( vec3 P ) {
  vec4 r = vec4( 0.0 );
  for ( int i = 0; i < 4; i++ ) {
    vec4 c = uCarP[ i ];
    if ( c.w < 8.0 ) continue;
    vec2 d = uCarD[ i ];
    vec3 rel = P - c.xyz;
    float along = dot( rel.xz, d );
    vec2 latV = rel.xz - d * along;
    float lat = length( latV );
    float reach = 2.5 + c.w * 0.085;
    if ( lat > reach * 4.0 ) continue;
    // time since the car went by this point (negative: it is still coming)
    float tp = - along / c.w;
    float env = smoothstep( -0.1, 0.03, tp ) * exp( - max( tp, 0.0 ) * 1.5 ) * exp( - lat / reach ) * exp( - max( rel.y, 0.0 ) / ( 2.0 + c.w * 0.04 ) );
    float k = min( c.w * c.w / 6900.0, 1.6 ) * env;
    if ( k < 1e-3 ) continue;
    float sw = sin( tp * 19.0 + dot( P.xz, vec2( 1.3, 1.7 ) ) );
    float sw2 = sin( tp * 11.0 + dot( P.xz, vec2( -0.9, 2.1 ) ) + 1.3 );
    vec2 outD = latV / max( lat, 0.01 );
    r.xyz += ( vec3( d.x, 0.0, d.y ) * ( 0.55 + 0.45 * sw ) + vec3( outD.x, 0.0, outD.y ) * 0.45 * sw2 + vec3( 0.0, 0.3 * sw, 0.0 ) ) * k;
    r.w += k;
  }
  return r;
}
`;

/**
 * GLSL: a tree's fade distance — from the camera's look-ahead segment (the camera and the stretch of
 * the next half second's travel ahead of it, uLook) rather than the camera itself: the same as the
 * plain distance beside and behind, shorter for what lies ahead. Shared by the 3D trees and the
 * impostors so their hand-over dithers stay matched.
 */
const TREE_LOOK = /* glsl */ `
uniform vec4 uLook;
float treeLookDist( vec3 p, float ahead ) {
  vec3 rel = p - cameraPosition;
  vec3 dir = vec3( uLook.x, 0.0, uLook.y );
  return length( rel - dir * clamp( dot( rel, dir ), 0.0, ahead ) );
}
`;

// ---------------------------------------------------------------- the 3D trees' vertex motion

/**
 * The 3D trees' vertices (layout: treeproto.ts). Everything is computed in world space for the
 * camera that is drawing (the sun's, in the shadow pass) and handed back as a model-space offset.
 *
 * Wind ("physics" in the sense a tree has it — a few coupled oscillators driven by gusty drag):
 *   trunk   the whole tree leans downwind with the mean wind (drag ∝ speed²) and swings about that
 *           at its own slow rate (big trees slower), its top tracing a figure across the wind too
 *   gusts   a wave rolling downwind through the woods: neighbouring trees bend one after another
 *   limbs   every limb swings at its own phase (continuous round the crown, so a limb and its
 *           sprays move together, the far side out of step), bobbing up and down as much as along
 *   leaves  each card rocks about its own axis at its own rate (and its lighting normal with it:
 *           the leaves flash as they turn), harder in the gusts and in a passing car's wake
 * Calm (fog, mist: < 1.5 m/s) barely breathes; a storm (10–15 m/s) bends whole trees and thrashes
 * the crowns.
 */
const COMMON_VERT = /* glsl */ `
attribute vec4 aTree;
attribute vec4 aCard;
attribute vec4 aAxis;
uniform float uTime;
uniform vec2 uWind;
${CAR_WAKE_GLSL}
varying vec4 vTree;
varying vec2 vTUv;
varying vec2 vFadeD;
float treeGust( vec2 xz, vec2 wd, float wl ) {
  float gx = dot( xz, wd ) * 0.026 - uTime * ( 0.45 + wl * 0.11 );
  float cr = dot( xz, vec2( -wd.y, wd.x ) ) * 0.012;
  return clamp( 0.5 + 0.32 * sin( gx ) + 0.2 * sin( gx * 2.3 + 1.7 + cr ) + 0.1 * sin( gx * 5.1 + cr * 3.0 ), 0.0, 1.0 );
}
// world-space displacement (m) of a vertex at wP of the tree rooted at ip (scale sc); w = flutter drive
vec4 treeWind( vec3 ip, vec3 wP, vec4 t, float limbW, float sc ) {
  float wl = length( uWind );
  vec2 wd = wl > 0.2 ? uWind / wl : vec2( 0.8, 0.6 );
  vec3 wd3 = vec3( wd.x, 0.0, wd.y );
  vec3 wp3 = vec3( - wd.y, 0.0, wd.x );
  float g = treeGust( ip.xz, wd, wl );
  // drag ∝ speed² (plus a little: still air is never quite still)
  float str = 0.03 + wl * 0.012 + wl * wl * 0.0045;
  float ph = dot( ip.xz, vec2( 0.071, 0.053 ) );
  // trunk: lean + the tree's own slow swing (≈ 0.3 Hz for a 20 m tree, faster for small ones)
  float fT = 1.9 / sqrt( max( sc, 0.25 ) );
  float swing = sin( uTime * fT + ph ) * 0.6 + sin( uTime * fT * 1.62 + ph * 2.3 ) * 0.25;
  float bend = str * ( 0.6 * g + 0.5 * swing * ( 0.35 + g ) );
  vec3 d = ( wd3 * bend + wp3 * str * 0.2 * sin( uTime * fT * 0.77 + ph * 3.1 ) ) * t.x;
  // limbs
  float lp = t.w;
  float limb = sin( uTime * ( 1.6 + wl * 0.07 ) + lp ) * 0.65 + sin( uTime * ( 2.7 + wl * 0.1 ) + lp * 1.7 + ph ) * 0.35;
  float ls = ( 0.035 + str * 0.42 ) * ( 0.4 + 0.9 * g );
  d += ( wd3 * ( 0.3 + limb ) + vec3( 0.0, 0.55 * limb, 0.0 ) + wp3 * 0.35 * sin( uTime * 1.25 + lp * 2.0 ) ) * ls * limbW;
  // a passing car's wake: the bushes and the low, outer branches take it, the trunks hardly (not in
  // the shadow maps, nor beyond 50 m where nobody could see it)
  vec4 wk = vec4( 0.0 );
  #ifndef TREE_SHADOW
    if ( dot( ip - cameraPosition, ip - cameraPosition ) < 2500.0 ) wk = carWake( wP );
  #endif
  d += wk.xyz * ( 0.04 + limbW * 0.3 ) * ( 1.0 + 1.5 * t.y );
  return vec4( d, g * str * 1.4 + wk.w * 1.5 );
}
// a leaf card's corner, for whatever camera is drawing: the card spans its spray along the axis a
// (leaned into the view plane when looking along it, so it never collapses to a line). Its plane
// is turned about a by psi: bb < 0.5 — a fixed plane (the spray's own, nW) that only leans toward
// the camera by up to ~bb·40°, so it can go edge-on (fir boughs read as layers from below);
// bb ≥ 0.5 — turning with the camera (an axial billboard at 1), so it never goes edge-on.
vec3 treeCard( vec3 cW, vec3 aW, vec3 nW, vec4 card, float sc, float flut ) {
  #ifdef TREE_SHADOW
    vec3 V = normalize( vec3( viewMatrix[ 0 ][ 2 ], viewMatrix[ 1 ][ 2 ], viewMatrix[ 2 ][ 2 ] ) );
  #else
    vec3 V = normalize( cameraPosition - cW );
  #endif
  vec3 a = normalize( aW - V * dot( aW, V ) * 0.5 );
  vec3 n0 = nW - a * dot( nW, a );
  n0 = dot( n0, n0 ) > 1e-6 ? normalize( n0 ) : normalize( cross( a, vec3( 0.3, 0.9, 0.1 ) ) );
  vec3 t0 = cross( a, n0 );
  vec3 Vp = V - a * dot( V, a );
  float vl = length( Vp );
  vec2 cs = vl > 1e-4 ? vec2( dot( Vp, n0 ), dot( Vp, t0 ) ) / vl : vec2( 1.0, 0.0 );
  // (the plane's angle about a, as a unit vector: the spray's own plane, or the camera's bearing,
  // then turned by the lean / pull-back and the flutter — no atan per vertex)
  bool fixedPlane = card.w < 0.5;
  vec2 b0 = fixedPlane ? vec2( 1.0, 0.0 ) : cs;
  float dl = ( fixedPlane ? card.w * 2.8 : card.w * 2.0 - 2.0 ) * cs.x * cs.y + flut;
  float cd = cos( dl ), sd = sin( dl );
  vec3 n = n0 * ( b0.x * cd - b0.y * sd ) + t0 * ( b0.x * sd + b0.y * cd );
  vec3 w = cross( a, n );
  return ( w * card.x + a * card.y ) * sc;
}
// the whole vertex: model-space offset (tm: the instance matrix; nOut: the lighting normal, model space)
vec3 treeMove( mat4 tm, out vec3 nOut ) {
  mat3 m3 = mat3( tm );
  mat3 mw = mat3( modelMatrix ) * m3;
  vec3 ip = ( modelMatrix * vec4( tm[ 3 ].xyz, 1.0 ) ).xyz;
  vec3 wP = ( modelMatrix * ( tm * vec4( position, 1.0 ) ) ).xyz;
  float s2 = max( dot( m3[ 0 ], m3[ 0 ] ), 1e-4 );
  float sc = sqrt( s2 );
  vec4 wd = treeWind( ip, wP, aTree, aCard.z, sc );
  vec3 disp = wd.xyz;
  nOut = normal;
  if ( aTree.y > 0.5 ) {
    float h = fract( dot( position, vec3( 1.2989, 7.8233, 3.7719 ) ) + aAxis.w * 7.31 );
    float fr = 5.0 + h * 4.5 + length( uWind ) * 0.3;
    float amp = 0.05 + min( wd.w, 1.4 ) * 0.5;
    #ifdef TREE_SHADOW
      float flut = 0.0;
    #else
      float flut = ( sin( uTime * fr + h * 40.0 ) + 0.35 * sin( uTime * fr * 2.13 + h * 17.0 ) ) * amp;
    #endif
    disp += treeCard( wP + disp, normalize( mw * aAxis.xyz ), normalize( mw * normal ), aCard, sc, flut );
    #ifdef USE_COLOR
      // (the lighting normal is the crown's surface there, rocked with the leaves)
      nOut = normalize( color.rgb + cross( aAxis.xyz, normal ) * sin( flut ) * 0.8 );
      // seen from its back (the underside of a bough, the inner face of a spray) the lighting normal
      // turns away with it: the undersides of a fir's tiers are the dark bands between them
      if ( dot( cameraPosition - wP, mw * normal ) < 0.0 ) nOut = normalize( nOut - normal * dot( nOut, normal ) * mix( 1.5, 0.35, step( 0.5, aCard.w ) ) );
    #endif
  }
  return transpose( m3 ) * ( transpose( mat3( modelMatrix ) ) * disp ) / s2;
}
`;

/**
 * A spray card's outline: its leaves fade out toward an irregular ellipse inside the card (the cell
 * position cl, 0 … 1), not its square edge — a dense spray (the jacaranda's) would otherwise show
 * its card's corners as a pale square in the crown.
 */
const TREE_RIM = /* glsl */ `
float treeRim( vec2 cl ) {
  vec2 q = cl * 2.0 - 1.0;
  float a = atan( q.y, q.x );
  float wob = 0.86 + 0.07 * sin( a * 5.0 + 1.3 ) + 0.05 * sin( a * 9.0 + 4.1 );
  return 1.0 - smoothstep( wob - 0.22, wob, length( q * vec2( 0.92, 0.97 ) ) );
}
`;

const GET_TANGENT_FRAME = /* glsl */ `
mat3 treeTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
  vec3 q0 = dFdx( eye_pos.xyz );
  vec3 q1 = dFdy( eye_pos.xyz );
  vec2 st0 = dFdx( uv.st );
  vec2 st1 = dFdy( uv.st );
  vec3 N = surf_norm;
  vec3 q1perp = cross( q1, N );
  vec3 q0perp = cross( N, q0 );
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( T, T ), dot( B, B ) );
  float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
  return mat3( T * scale, B * scale, N );
}
float ign( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
${TREE_RIM}
// (offset by the frame: the hand-over reads as a blend in motion instead of a fixed hatch)
uniform float uFrame;
float ignF( vec2 p ) { return ign( p + 5.588238 * mod( uFrame, 64.0 ) ); }
`;

/** RE_Direct wrapper: thin-leaf transmission + crown self-shadowing */
const LEAF_LIGHT = /* glsl */ `
varying float vLeafL;
varying float vAOL;
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  IncidentLight dl = directLight;
  // (sun on the outside of a crown is strong — the bright, warm tops the footage shows — and the
  // inside sits in its own shade)
  dl.color *= mix( 1.0, mix( 0.5, 1.35, vAOL ), vLeafL );
  RE_Direct_Physical( dl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  if ( vLeafL > 0.5 ) {
    float VL = saturate( dot( -geometryViewDir, directLight.direction ) );
    // thin leaves: diffuse transmission through the lit-from-behind side of the crown
    // (wrapped, so the terminator is soft) plus the bright forward-scatter glow around
    // the sun when the crown is back-lit
    float back = saturate( dot( -geometryNormal, directLight.direction ) * 0.6 + 0.4 );
    float through = pow( VL, 6.0 ) * 0.85 + 0.3 * back * back;
    // light through a leaf comes out a saturated yellow-green (albedo squared, renormalised)
    vec3 dc = material.diffuseColor;
    vec3 tc = dc * dc / max( max( dc.r, dc.g ), 1e-3 );
    reflectedLight.directDiffuse += dl.color * tc * vec3( 1.0, 1.0, 0.5 ) * through * 0.62;
    // soft wrap on the lit side: a leafy mass never shows a hard N·L terminator
    float wrapL = saturate( ( dot( geometryNormal, directLight.direction ) + 0.35 ) / 1.35 ) - saturate( dot( geometryNormal, directLight.direction ) );
    reflectedLight.directDiffuse += dl.color * dc * wrapL * 0.25 * RECIPROCAL_PI;
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Leaf
`;

export function treeMaterial(kit: TreeKit, u: TreeUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uTime: u.uTime,
      uFrame: u.uFrame,
      uFade: u.uFade,
      uFadeC: u.uFadeC,
      uLook: u.uLook,
      uLodB: u.uLodB,
      uWind: weatherUniforms.uWind,
      uWet: weatherUniforms.uWetness,
      uLeafMap: { value: kit.leafMap },
      uLeafN: { value: kit.leafNormal },
      uBark: { value: kit.bark },
      uLeafSize: { value: kit.leafSize },
      uSunW: u.uSunW,
      uLeafFill: u.uLeafFill,
      uLeafGrid: { value: kit.leafGrid },
      ...wakeUniforms,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT}\n${TREE_LOOK}\nattribute float aLod;\nuniform vec4 uLodB;\nvarying vec2 vLodK;\nvarying float vLeafL;\nvarying float vAOL;\nuniform vec3 uSunW;`)
      .replace('#include <shadowmap_vertex>', `#ifdef USE_SHADOWMAP\n  worldPosition.xyz += uSunW * ( 0.45 * step( 0.5, aTree.y ) );\n#endif\n#include <shadowmap_vertex>`)
      // (leaf cards: the colour attribute carries the lighting normal, the tint rides in aAxis.w)
      .replace(
        '#include <color_vertex>',
        `vColor = vec4( aTree.y > 0.5 ? vec3( aAxis.w ) : color, 1.0 );
#ifdef USE_BATCHING_COLOR
  vColor *= getBatchingColor( getIndirectIndex( gl_DrawID ) );
#endif`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#ifdef USE_BATCHING
  #define TREE_TM batchingMatrix
#elif defined( USE_INSTANCING )
  #define TREE_TM instanceMatrix
#else
  #define TREE_TM mat4( 1.0 )
#endif
vec3 objectNormal;
vec3 treeDisp = treeMove( TREE_TM, objectNormal );
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
transformed += treeDisp;
{
  #ifdef USE_BATCHING
    vec3 ip = ( modelMatrix * vec4( batchingMatrix[ 3 ].xyz, 1.0 ) ).xyz;
  #else
    vec3 ip = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  #endif
  vTree = aTree;
  vTUv = uv;
  vLeafL = step( 0.5, aTree.y );
  vAOL = aTree.z;
  // (near detail and conifers by the full look-ahead, the broadleaf hand-over by half of it)
  vFadeD = vec2( treeLookDist( ip, uLook.z ), treeLookDist( ip, uLook.w ) );
  // this LOD's share of the dither: [ x, y ) of the noise. Neighbouring LODs take complementary
  // ranges across each band (the 3D tree's overall share is untouched), so a tree turns into its
  // next LOD over a few metres in a matched dither, the same way it hands over to its impostor
  float s0 = smoothstep( uLodB.x - uLodB.z, uLodB.x + uLodB.z, vFadeD.x );
  float s1 = smoothstep( uLodB.y - uLodB.z, uLodB.y + uLodB.z, vFadeD.x );
  vLodK = aLod < 0.5 ? vec2( s0, 2.0 ) : aLod < 1.5 ? vec2( s1, s0 ) : vec2( -1.0, s1 );
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uLeafMap;
uniform sampler2D uLeafN;
uniform sampler2D uBark;
uniform vec2 uLeafSize;
uniform vec2 uFade;
uniform vec2 uFadeC;
uniform float uWet;
uniform vec3 uLeafFill;
varying vec4 vTree;
varying vec2 vTUv;
uniform vec2 uLeafGrid;
varying vec2 vFadeD;
varying vec2 vLodK;
${GET_TANGENT_FRAME}`,
      )
      .replace(
        '#include <lights_physical_pars_fragment>',
        `#include <lights_physical_pars_fragment>
// (a leaf's place in its spray: 1 at the front face, 0 at the back — the leaves behind sit in the
// front ones' shade: leaf_n alpha)
float gLeafS = 1.0;
${LEAF_LIGHT.replace('mix( 0.5, 1.35, vAOL )', 'mix( 0.5, 1.35, vAOL ) * mix( 0.7, 1.0, gLeafS )')}`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
// leaves: a soft waxy sheen, never a mirror-like grazing sky reflection
material.specularColor *= mix( 1.0, 0.35, leafK );
material.specularF90 = mix( material.specularF90, 0.22, leafK );`,
      )
      .replace(
        '#include <map_fragment>',
        `
float leafK = step( 0.5, vTree.y );
{
  // (instance colour w: 2 = a conifer, on its own shorter 3D band)
  bool fir = vColor.a > 1.5;
  vec2 fb = fir ? uFadeC : uFade;
  float f = fb.y > 0.0 ? smoothstep( fb.x, fb.y, fir ? vFadeD.x : vFadeD.y ) : 0.0;
  float ig = ignF( gl_FragCoord.xy );
  if ( f > ig || ig < vLodK.x || ig >= vLodK.y ) discard;
}
if ( leafK > 0.5 ) {
  // (sharper than the default mip: individual leaves stay legible a little further out — the hashed
  // alpha below keeps the extra detail from turning into a hard-edged shimmer)
  vec4 lt = texture2D( uLeafMap, vTUv, -0.7 );
  vec2 dx = dFdx( vTUv * uLeafSize ), dy = dFdy( vTUv * uLeafSize );
  float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) - 0.7 );
  // cards turning edge-on thin out instead of showing smeared leaves
  vec3 fN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
  float edgeOn = abs( dot( fN, normalize( vViewPosition ) ) );
  // (a little more sky through the crowns: real foliage is full of holes, not a solid lump)
  float thr = 0.5 + 0.5 * ( 1.0 - smoothstep( 0.12, 0.42, edgeOn ) );
  // a spray's leaves run to the card's edge: fade them out over its last few per cent, so no card
  // shows a straight cut
  vec2 cl = fract( vTUv * uLeafGrid );
  float rim = treeRim( cl );
  // hashed alpha once the leaves are smaller than a few texels: a texel's partial coverage (half a
  // needle, the edge of a leaf) is kept as that share of its pixels instead of a hard 0.5 cut, so a
  // distant spray reads as fine foliage texture with sky through it, not a solid cut-out shape. The
  // hash is anchored to the atlas texel at the current mip: the pattern moves with the leaves.
  float hs = fract( 52.9829189 * fract( dot( floor( vTUv * uLeafSize / exp2( floor( lod ) ) ), vec2( 0.06711056, 0.00583715 ) ) ) );
  float jit = ( hs - 0.5 ) * clamp( ( lod - 0.5 ) * 0.35, 0.0, 0.7 );
  if ( lt.a * rim * ( 1.0 + lod * 0.08 ) < thr + jit ) discard;
  // foliage as camera footage shows it: a dark olive mass, not a bright game green (the clumps are the
  // scans' own leaves; a touch of desaturation and warmth matches them to the graded footage)
  vec3 lc = lt.rgb;
  lc = mix( vec3( dot( lc, vec3( 0.2126, 0.7152, 0.0722 ) ) ), lc, 0.8 ) * vec3( 0.93, 0.92, 0.84 );
  diffuseColor.rgb *= lc;
} else {
  // the scan's own bark colour is in the vertex colour; the bark tile adds the detail around it
  vec4 bk = texture2D( uBark, vTUv );
  diffuseColor.rgb *= 0.45 + bk.a * 1.1;
  diffuseColor.rgb *= mix( 1.0, 0.55, uWet );
}
`,
      )
      .replace('normal *= faceDirection;', 'normal *= mix( faceDirection, 1.0, step( 0.5, vTree.y ) );')
      .replace(
        '#include <normal_fragment_maps>',
        `{
  vec3 mapN;
  if ( vTree.y > 0.5 ) {
    vec4 ln = texture2D( uLeafN, vTUv, -0.7 );
    mapN = ln.xyz * 2.0 - 1.0;
    // (each leaf its own tilt: the crown speckles light and dark leaf by leaf instead of shading
    // card by card)
    mapN.xy *= 1.5;
    gLeafS = ln.a;
  } else {
    mapN = texture2D( uBark, vTUv ).xyz * 2.0 - 1.0;
    mapN.xy *= 1.2;
  }
  mat3 tbnT = treeTangentFrame( - vViewPosition, normal, vTUv );
  normal = normalize( tbnT * normalize( mapN ) );
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix( 0.86, 0.72, leafK );
roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, uWet );`,
      )
      .replace(
        '#include <aomap_fragment>',
        `{
  // (the inside of a crown is deep in shade: little sky reaches it)
  float ambientOcclusion = mix( mix( 0.45, 0.24, leafK ), 1.0, pow( vTree.z, 1.25 ) ) * mix( 1.0, mix( 0.6, 1.0, gLeafS ), leafK );
  // leaves: sky light scattered through the outer foliage (the crown is not an opaque blob)
  reflectedLight.indirectDiffuse *= ambientOcclusion * mix( vec3( 1.0 ), uLeafFill, leafK );
  reflectedLight.indirectSpecular *= ambientOcclusion * ambientOcclusion * mix( 1.0, 0.3, leafK );
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-tree-3d-v9';
  return mat;
}

export function treeDepthMaterial(kit: TreeKit, u: TreeUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: u.uTime, uWind: weatherUniforms.uWind, uLeafMap: { value: kit.leafMap }, uLeafGrid: { value: kit.leafGrid }, ...wakeUniforms });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n#define TREE_SHADOW\n${COMMON_VERT}`).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
{
  vec3 nIgnored;
  #ifdef USE_BATCHING
    transformed += treeMove( batchingMatrix, nIgnored );
  #elif defined( USE_INSTANCING )
    transformed += treeMove( instanceMatrix, nIgnored );
  #else
    transformed += treeMove( mat4( 1.0 ), nIgnored );
  #endif
  vTree = aTree;
  vTUv = uv;
}`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uLeafMap;\nuniform vec2 uLeafGrid;\nvarying vec4 vTree;\nvarying vec2 vTUv;\n${TREE_RIM}`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
if ( vTree.y > 0.5 ) {
  vec2 cl = fract( vTUv * uLeafGrid );
  float rim = treeRim( cl );
  if ( texture2D( uLeafMap, vTUv ).a * rim < 0.5 ) discard;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-tree-depth-v5';
  return mat;
}

// ---------------------------------------------------------------- impostors

/**
 * Camera-facing cards showing the baked frames of the scanned tree (tools/bake_trees.mjs): eight
 * views around it; the two frames either side of the camera's bearing (in the tree's own, rotated
 * and maybe mirrored, frame) are blended, so a tree turns as you drive round it instead of
 * following you. The baked normals are relit like the 3D trees; they fade in exactly where the 3D
 * tree fades out.
 *
 * Instance attributes: iPos (x, y, z, scale), iInfo (prototype, mirrored, near (has a 3D tree), yaw),
 * iTint (rgb).
 */
export function impostorMaterial(kit: TreeKit, u: TreeUniforms): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0 });
  // per prototype: (card width, card height (m), atlas row, 0)
  const protos: THREE.Vector4[] = kit.protos.map((p: TreeProto, i: number) => new THREE.Vector4(p.W, p.Hc, kit.impRow[i], 0));
  while (protos.length < 16) protos.push(new THREE.Vector4());
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, {
      uFade: u.uFade,
      uFadeC: u.uFadeC,
      uLook: u.uLook,
      uTime: u.uTime,
      uFrame: u.uFrame,
      uWind: weatherUniforms.uWind,
      uWet: weatherUniforms.uWetness,
      uImpA: { value: kit.impC },
      uImpN: { value: kit.impN },
      uProtos: { value: protos },
      uLeafFill: u.uLeafFill,
      uImpGrid: { value: new THREE.Vector2(kit.frames, kit.impRows) },
      uImpSize: { value: new THREE.Vector2(kit.frames * 256, kit.impRows * 256) },
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 iPos;
attribute vec4 iInfo;
attribute vec3 iTint;
uniform vec4 uProtos[ 16 ];
uniform vec2 uImpGrid;
uniform vec2 uFade;
uniform vec2 uFadeC;
uniform float uTime;
uniform vec2 uWind;
${TREE_LOOK}
varying vec4 vIUv;
varying float vIW;
varying vec3 vIR;
varying vec3 vIU;
varying vec3 vIF;
varying vec3 vITint;
varying float vIFade;
varying float vLeafL;
varying float vAOL;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = vec3( 0.0, 0.0, 1.0 );
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( 1.0, 0.0, 0.0 );
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed;
{
  vec4 pr = uProtos[ int( iInfo.x + 0.5 ) ];
  float S = pr.y * iPos.w;
  float Wc = pr.x * iPos.w;
  vec3 P = iPos.xyz;
  vec3 toCam = cameraPosition - P;
  float horiz = max( length( toCam.xz ), 1e-3 );
  vec3 fwd = vec3( toCam.x / horiz, 0.0, toCam.z / horiz );
  vec3 right = vec3( fwd.z, 0.0, -fwd.x );
  float elev = atan( toCam.y - S * 0.45, horiz );
  float tilt = clamp( elev, 0.0, 0.75 ) * 0.8;
  vec3 up = vec3( 0.0, cos( tilt ), 0.0 ) - fwd * sin( tilt );
  vec3 nrm = fwd * cos( tilt ) + vec3( 0.0, sin( tilt ), 0.0 );
  float flip = iInfo.y > 0.5 ? -1.0 : 1.0;
  // (the 3D trees' own fade distances: the look-ahead, full for conifers, half for broadleaf)
  vIFade = iInfo.z > 1.5 ? smoothstep( uFadeC.x, uFadeC.y, treeLookDist( P, uLook.z ) ) : iInfo.z > 0.5 ? smoothstep( uFade.x, uFade.y, treeLookDist( P, uLook.w ) ) : 1.0;
  // the 3D trees' wind (treeWind's trunk term): a lean with the mean wind, the tree's own slow swing
  // and the gusts rolling downwind through the woods — a card can only lean in its own plane, so it
  // takes the wind's component across the view; the crown breathes a little (limbs swinging) too
  float wl = length( uWind );
  vec2 wd = wl > 0.2 ? uWind / wl : vec2( 0.8, 0.6 );
  float gx = dot( P.xz, wd ) * 0.026 - uTime * ( 0.45 + wl * 0.11 );
  float cr = dot( P.xz, vec2( -wd.y, wd.x ) ) * 0.012;
  float gust = clamp( 0.5 + 0.32 * sin( gx ) + 0.2 * sin( gx * 2.3 + 1.7 + cr ) + 0.1 * sin( gx * 5.1 + cr * 3.0 ), 0.0, 1.0 );
  float str = 0.03 + wl * 0.012 + wl * wl * 0.0045;
  float ph = dot( P.xz, vec2( 0.071, 0.053 ) );
  float fT = 1.9 / sqrt( max( iPos.w, 0.25 ) );
  float swing = sin( uTime * fT + ph ) * 0.6 + sin( uTime * fT * 1.62 + ph * 2.3 ) * 0.25;
  float bend = str * ( 0.6 * gust + 0.5 * swing * ( 0.35 + gust ) ) * S / 20.0;
  vec2 c = position.xy;
  float breathe = 1.0 + 0.05 * str * ( 0.4 + gust ) * sin( uTime * 1.7 + ph * 5.0 );
  transformed = P + right * ( c.x * Wc * breathe ) + up * ( c.y * S ) + right * ( dot( vec3( wd.x, 0.0, wd.y ), right ) * bend * c.y * c.y );
  if ( vIFade <= 0.0 ) transformed = vec3( 0.0, -1e5, 0.0 );
  // the camera's bearing in the tree's own frame (yaw undone, mirror undone) → the two frames around it
  float az = ( atan( toCam.x, toCam.z ) - iInfo.w ) * flip;
  float f = fract( az / 6.2831853 ) * uImpGrid.x;
  float f0 = floor( f );
  vIW = f - f0;
  float f1 = mod( f0 + 1.0, uImpGrid.x );
  float uu = c.x * flip + 0.5;
  float vv = ( uImpGrid.y - 1.0 - pr.z + c.y * 0.98 + 0.02 ) / uImpGrid.y;
  vIUv = vec4( ( f0 + uu ) / uImpGrid.x, vv, ( f1 + uu ) / uImpGrid.x, vv );
  vIR = right * flip;
  vIU = up;
  vIF = nrm;
  vITint = iTint;
  vLeafL = 1.0;
  vAOL = 1.0;
  objectNormal = nrm;
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uImpA;
uniform sampler2D uImpN;
uniform vec2 uImpSize;
uniform float uWet;
uniform vec3 uLeafFill;
varying vec4 vIUv;
varying float vIW;
varying vec3 vIR;
varying vec3 vIU;
varying vec3 vIF;
varying vec3 vITint;
varying float vIFade;
${GET_TANGENT_FRAME}`,
      )
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${LEAF_LIGHT.replace('varying float vLeafL;\nvarying float vAOL;', 'varying float vLeafL;\nvarying float vAOL;\nfloat gImpAO = 1.0;').replace('mix( 0.5, 1.35, vAOL )', 'mix( 0.5, 1.35, gImpAO ) * 0.86')}`)
      .replace(
        '#include <map_fragment>',
        `
vec4 ia0 = texture2D( uImpA, vIUv.xy );
vec4 ia1 = texture2D( uImpA, vIUv.zw );
vec4 ia = mix( ia0, ia1, vIW );
{
  vec2 dx = dFdx( vIUv.xy * uImpSize ), dy = dFdy( vIUv.xy * uImpSize );
  float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
  if ( ia.a * ( 1.0 + lod * 0.3 ) < 0.5 ) discard;
  if ( vIFade < 1.0 && vIFade <= ignF( gl_FragCoord.xy ) ) discard;
}
// (sRGB atlas: the colour arrives linear)
diffuseColor.rgb = ia.rgb * vITint;
// (the same footage foliage tint as the 3D trees, so near and far match)
diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ), diffuseColor.rgb, 0.8 ) * vec3( 0.93, 0.92, 0.84 );
`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
  // (the nearer frame's normals: lighting doesn't need the blend, and it saves a fetch per fragment)
  vec4 inr = texture2D( uImpN, vIW < 0.5 ? vIUv.xy : vIUv.zw );
  vec3 nb = inr.xyz * 2.0 - 1.0;
  vec3 nW = normalize( vIR * nb.x + vIU * nb.y + vIF * nb.z );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
  gImpAO = inr.a;
}`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix( 0.74, 0.42, uWet );`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\nmaterial.specularColor *= 0.35;\nmaterial.specularF90 = 0.22;`)
      .replace(
        '#include <aomap_fragment>',
        `{
  // (× 0.8: the 3D trees' leaves sit partly in their sprays' own shade — gLeafS — and the far woods match them)
  reflectedLight.indirectDiffuse *= mix( 0.36, 1.0, gImpAO ) * uLeafFill * 0.8;
  reflectedLight.indirectSpecular *= gImpAO * gImpAO * 0.3;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-tree-impostor-v6';
  return mat;
}
