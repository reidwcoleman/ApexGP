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
 *                    each leaf's place in its spray, coverage-preserving alpha at a distance,
 *                    rain gloss, and a timed dither cross-fade whenever a tree changes its
 *                    detail (instance colour w: TREE_FADE_GLSL; vegetation.ts decides when).
 *  treeDepthMaterial()  the same cards + wind (no flutter, no wake) + leaf alpha for the shadow map.
 *  impostorMaterial()   camera-facing cards showing the scanned tree's baked frames (8 views
 *                    around it, blended by the camera's bearing), relit from the baked
 *                    normals, swaying with the same trunk wind; a near tree's impostor fades
 *                    in exactly as its 3D tree fades out (the same dither, complementary).
 *  feedCarWake()     (Game, once a frame) the nearest cars' positions / speeds for carWake —
 *                    shared with the verge grass (grass.ts).
 */

export interface TreeUniforms {
  uTime: THREE.IUniform<number>;
  /** frame counter: the hand-over dither moves every frame (a fixed one showed as hatching) */
  uFrame: THREE.IUniform<number>;
  /** the shadow casters' fade-out: (camera x, z, fade start, fade end) m — vegetation.ts */
  uShade: THREE.IUniform<THREE.Vector4>;
  /** the ground's crown mask (parkmask.ts fine, R) and its bounds (x0, z0, 1 / width, 1 / depth; z = 0: none yet) */
  uCanopy: THREE.IUniform<THREE.Texture | null>;
  uCanopyB: THREE.IUniform<THREE.Vector4>;
  /** world direction toward the sun (for the leaf shadow offset) */
  uSunW: THREE.IUniform<THREE.Vector3>;
  /**
   * sky fill multiplier on foliage: light scattered leaf to leaf through a sunlit crown
   * (strong in sunshine, near 1 under a grey deck where the sky already lights everything)
   */
  uLeafFill: THREE.IUniform<THREE.Vector3>;
}

/**
 * The leaf cards' alpha cut: (the cut, extra cut on cards turning edge-on). Shared by every tree
 * material (src/dev/treelod.ts tunes it live).
 */
export const leafTune = { uLeafCut: { value: new THREE.Vector4(0.4, 0.25, 0.25, 0.15) } };

const FILL_SUN =new THREE.Vector3(3.4, 3.55, 2.8);
const FILL_GREY = new THREE.Vector3(1.35, 1.4, 1.2);
/** set the foliage fill from how much of the light is direct sun (0 … 1) */
export function setLeafFill(u: TreeUniforms, sunShare: number) {
  u.uLeafFill.value.copy(FILL_GREY).lerp(FILL_SUN, Math.min(1, Math.max(0, sunShare)));
}

export function createTreeUniforms(): TreeUniforms {
  return { uTime: { value: 0 }, uFrame: { value: 0 }, uShade: { value: new THREE.Vector4(0, 0, 1e5, 1e5 + 1) }, uCanopy: { value: null }, uCanopyB: { value: new THREE.Vector4() }, uSunW: { value: new THREE.Vector3(0.4, 0.8, 0.4) }, uLeafFill: { value: FILL_SUN.clone() } };
}

/** how long a tree's change of detail takes (s of the scenery clock: vegetation.ts) */
export const TREE_FADE = 0.3;

/**
 * GLSL: the share of the hand-over dither an instance takes, [x, y) of the noise. Fading in it
 * takes [0, p), fading out [p, 1) — the two always complementary, so a tree's coverage never
 * dips or doubles while one LOD (or its impostor) dissolves into the next. p runs 0 → 1 over
 * TREE_FADE s from the start t0 (s, kept to 1/60; 0: steady, p = 1).
 */
const TREE_FADE_GLSL = /* glsl */ `
vec2 treeFadeShare( float t0, float dirIn ) {
  float p = t0 > 0.0 ? clamp( ( uTime - t0 ) / ${TREE_FADE.toFixed(3)}, 0.0, 1.0 ) : 1.0;
  return dirIn > 0.5 ? vec2( 0.0, p ) : vec2( p, 1.0 );
}
`;

/**
 * GLSL: how much of the sun the woods upwind take from a point of a tree beyond the shadow
 * casters' range (uShade: the 3D trees cast into the shadow maps only out to ~60 m; beyond, and for
 * every impostor, nothing did — a low sun lit every distant crown, so at golden hour the woods past
 * 60 m glowed orange while the near trees sat, correctly, in their neighbours' shade). The ground's crown
 * mask (parkmask.ts, R: the trees' own crowns, ~1.5 m a texel) is read at three points toward the
 * sun, as far as a ray from the point climbs past the crowns (≈ 19 m up): a crown there that rises
 * above the ray's height blocks it. The tops stay lit, the lower crown and the trunks go into the
 * shade of the trees upwind — long shadows at sunset, only the neighbours' at noon. Fades in
 * exactly as the real shadow casters fade out, so nothing is shaded twice.
 */
const TREE_CANOPY_GLSL = /* glsl */ `
uniform sampler2D uCanopy;
uniform vec4 uCanopyB;
uniform vec4 uShade;
float treeCanopyOcc( vec3 P, float hy, float r0, vec3 root ) {
  if ( uCanopyB.z <= 0.0 ) return 0.0;
  float w = smoothstep( uShade.z, uShade.w, length( root.xz - uShade.xy ) );
  if ( w <= 0.0 ) return 0.0;
  vec3 L = normalize( uSunW );
  float lh = length( L.xz );
  if ( L.y <= 0.0 || lh < 1e-3 ) return 0.0;
  float t = max( L.y, 0.04 ) / lh;
  vec2 dir = L.xz / lh;
  float reach = clamp( ( 19.0 - hy ) / t, 0.0, 140.0 );
  float lit = 1.0;
  for ( int k = 0; k < 3; k++ ) {
    float d = r0 + reach * ( 0.15 + 0.35 * float( k ) );
    vec2 uv = ( P.xz + dir * d - uCanopyB.xy ) * uCanopyB.zw;
    if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 ) continue;
    float c = textureLod( uCanopy, uv, 1.0 ).r;
    lit *= 1.0 - clamp( c * 1.6, 0.0, 1.0 ) * ( 1.0 - smoothstep( 12.0, 20.0, hy + d * t ) );
  }
  return ( 1.0 - lit ) * w;
}
`;

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
varying float vSunOcc;
void RE_Direct_Leaf( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  IncidentLight dl = directLight;
  // (sun on the outside of a crown is strong — the bright, warm tops the footage shows — and the
  // inside sits in its own shade)
  dl.color *= mix( 1.0, mix( 0.5, 1.35, vAOL ), vLeafL );
  // (the sun the woods upwind take, where the shadow maps have no casters: TREE_CANOPY_GLSL)
  dl.color *= 1.0 - 0.85 * vSunOcc;
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
      uWind: weatherUniforms.uWind,
      uWet: weatherUniforms.uWetness,
      uLeafMap: { value: kit.leafMap },
      uLeafN: { value: kit.leafNormal },
      uBark: { value: kit.bark },
      uLeafSize: { value: kit.leafSize },
      uSunW: u.uSunW,
      uShade: u.uShade,
      uCanopy: u.uCanopy,
      uCanopyB: u.uCanopyB,
      uLeafFill: u.uLeafFill,
      uLeafCut: leafTune.uLeafCut,
      uLeafCover: { value: kit.leafCover },
      uLeafCoverN: { value: kit.leafCover.image.height },
      uLeafGrid: { value: kit.leafGrid },
      ...wakeUniforms,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT}\n${TREE_FADE_GLSL}\nvarying vec2 vLodK;\nvarying float vLeafL;\nvarying float vAOL;\nvarying float vSunOcc;
uniform vec3 uSunW;
${TREE_CANOPY_GLSL}`)
      .replace('#include <shadowmap_vertex>', `#ifdef USE_SHADOWMAP\n  worldPosition.xyz += uSunW * ( 0.45 * step( 0.5, aTree.y ) );\n#endif\n#include <shadowmap_vertex>`)
      // (leaf cards: the colour attribute carries the lighting normal, the tint rides in aAxis.w)
      .replace(
        '#include <color_vertex>',
        `vColor = vec4( aTree.y > 0.5 ? vec3( aAxis.w ) : color, 1.0 );
{
  #ifdef USE_BATCHING_COLOR
    vec4 bc = getBatchingColor( getIndirectIndex( gl_DrawID ) );
  #else
    vec4 bc = vec4( 1.0, 1.0, 1.0, 4.0 );
  #endif
  vColor.rgb *= bc.rgb;
  // instance colour w = flag + 3 dirIn + 6 · t0 · 60 (vegetation.ts fadeCode): this instance's share
  // of the hand-over dither, and the species flag (2: a conifer) in vColor.a
  float t60 = floor( bc.a / 6.0 + 1e-3 );
  float rem = bc.a - t60 * 6.0;
  float dirIn = floor( rem / 3.0 + 1e-3 );
  vColor.a = rem - dirIn * 3.0;
  vLodK = treeFadeShare( t60 / 60.0, dirIn );
}`,
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
vTree = aTree;
vTUv = uv;
vLeafL = step( 0.5, aTree.y );
vAOL = aTree.z;
{
  #ifdef USE_BATCHING
    mat4 tBm = batchingMatrix;
  #else
    mat4 tBm = mat4( 1.0 );
  #endif
  vec3 tRoot = ( modelMatrix * vec4( tBm[ 3 ].xyz, 1.0 ) ).xyz;
  vec3 tWP = ( modelMatrix * ( tBm * vec4( transformed, 1.0 ) ) ).xyz;
  vSunOcc = treeCanopyOcc( tWP, tWP.y - tRoot.y, 4.0 * length( tBm[ 0 ].xyz ), tRoot );
}
// (an instance wholly faded out — the LOD a tree has just left, until vegetation.ts retires it —
// is dropped before rasterising)
if ( vLodK.y <= vLodK.x ) transformed = vec3( 0.0, -1e5, 0.0 );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uLeafMap;
uniform sampler2D uLeafN;
uniform sampler2D uBark;
uniform vec2 uLeafSize;
uniform float uWet;
uniform vec4 uLeafCut;
uniform sampler2D uLeafCover;
uniform float uLeafCoverN;
uniform vec3 uLeafFill;
varying vec4 vTree;
varying vec2 vTUv;
uniform vec2 uLeafGrid;
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
// (mid-change: this instance's share of the hand-over dither, vLodK)
if ( vLodK.x > 0.0 || vLodK.y < 1.0 ) {
  float ig = ignF( gl_FragCoord.xy );
  if ( ig < vLodK.x || ig >= vLodK.y ) discard;
}
if ( leafK > 0.5 ) {
  // (sharper than the default mip: individual leaves stay legible a little further out — the hashed
  // coverage-preserving cut below keeps the extra detail from thinning out)
  vec4 lt = texture2D( uLeafMap, vTUv, -0.7 );
  vec2 dx = dFdx( vTUv * uLeafSize ), dy = dFdy( vTUv * uLeafSize );
  float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) - 0.7 );
  // cards turning edge-on thin out instead of showing smeared leaves
  vec3 fN = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
  float edgeOn = abs( dot( fN, normalize( vViewPosition ) ) );
  // (the cut, leafTune: conifers lower — a needle covers a texel only partly)
  vec2 cut = vColor.a > 1.5 ? uLeafCut.zw : uLeafCut.xy;
  float thr = cut.x + cut.y * ( 1.0 - smoothstep( 0.12, 0.42, edgeOn ) );
  // a spray's leaves run to the card's edge: fade them out over its last few per cent, so no card
  // shows a straight cut
  vec2 cl = fract( vTUv * uLeafGrid );
  float rim = treeRim( cl );
  // coverage-preserving alpha (treeproto leafCoverage): the mip's alpha scaled so this spray keeps
  // its full-resolution share of leaf at any distance — no thinning far off, and no hashed noise
  // (which speckled and crawled as the mip level changed): one clean cut the TAA anti-aliases
  ivec2 ccell = ivec2( floor( vTUv * uLeafGrid ) );
  int ci = ccell.y * int( uLeafGrid.x ) + ccell.x;
  float lc0 = min( lod, uLeafCoverN - 1.0 );
  int l0 = int( floor( lc0 ) );
  float cg = mix( texelFetch( uLeafCover, ivec2( ci, l0 ), 0 ).r, texelFetch( uLeafCover, ivec2( ci, min( l0 + 1, int( uLeafCoverN ) - 1 ) ), 0 ).r, fract( lc0 ) );
  if ( lt.a * cg * rim < thr ) discard;
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
  // specular anti-aliasing (Kaplanyan & Hoffman, "Filtering Distributions of Normals for Shading
  // Antialiasing", 2016): where the per-leaf normals change faster than a pixel can hold — a distant
  // crown, and worst on wet, glossy leaves in the rain — widen the highlight by the normals' spread
  // instead of letting single pixels flash on and off as the leaves move
  vec3 dnx = dFdx( normal ), dny = dFdy( normal );
  float nvar = min( 0.5 * max( dot( dnx, dnx ), dot( dny, dny ) ), 0.22 );
  roughnessFactor = min( 1.0, sqrt( roughnessFactor * roughnessFactor + nvar ) );
}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix( 0.86, 0.72, leafK );
// wet: leaves take a film of water and gloss (cuticle + water ≈ 0.4); bark soaks it up — it darkens
// (map_fragment) and only loses a little roughness: a sodden trunk is dark, not shiny
roughnessFactor *= mix( 1.0, mix( 0.8, 0.55, leafK ), uWet );`,
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
  mat.customProgramCacheKey = () => 'apex-tree-3d-v12';
  return mat;
}

export function treeDepthMaterial(kit: TreeKit, u: TreeUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uTime: u.uTime, uShade: u.uShade, uWind: weatherUniforms.uWind, uLeafMap: { value: kit.leafMap }, uLeafGrid: { value: kit.leafGrid }, uLeafSize: { value: kit.leafSize }, uLeafCut: leafTune.uLeafCut, uLeafCover: { value: kit.leafCover }, uLeafCoverN: { value: kit.leafCover.image.height }, ...wakeUniforms });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\n#define TREE_SHADOW\n${COMMON_VERT}
uniform vec4 uShade;
varying float vShadeK;`).replace(
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
  // (the far casters' shade thins out before vegetation.ts drops them from the shadow pass)
  #ifdef USE_BATCHING
    vec3 sip = ( modelMatrix * vec4( batchingMatrix[ 3 ].xyz, 1.0 ) ).xyz;
  #else
    vec3 sip = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  #endif
  vShadeK = 1.0 - smoothstep( uShade.z, uShade.w, length( sip.xz - uShade.xy ) );
}`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uLeafMap;\nuniform vec2 uLeafGrid;\nuniform vec2 uLeafSize;\nuniform vec4 uLeafCut;\nuniform sampler2D uLeafCover;\nuniform float uLeafCoverN;\nvarying vec4 vTree;\nvarying vec2 vTUv;\nvarying float vShadeK;\n${TREE_RIM}`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
// a far caster's shade goes leaf by leaf (a hash fixed to the spray texture: stable as the tree
// sways, and soft under the shadow filter) — not all at once as it leaves the shadow range
if ( vShadeK < 1.0 && fract( sin( dot( floor( vTUv * uLeafSize / 24.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) >= vShadeK ) discard;
if ( vTree.y > 0.5 ) {
  vec2 cl = fract( vTUv * uLeafGrid );
  float rim = treeRim( cl );
  // (the same coverage-preserving gain as the lit cards: a crown far down the shadow cascade, its
  // sprays a few texels across, still casts a full shade, not a sieve)
  vec2 dx = dFdx( vTUv * uLeafSize ), dy = dFdy( vTUv * uLeafSize );
  float lod = clamp( 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ), 0.0, uLeafCoverN - 1.0 );
  ivec2 cc = ivec2( floor( vTUv * uLeafGrid ) );
  float cg = texelFetch( uLeafCover, ivec2( cc.y * int( uLeafGrid.x ) + cc.x, int( lod + 0.5 ) ), 0 ).r;
  if ( texture2D( uLeafMap, vTUv ).a * cg * rim < uLeafCut.x ) discard;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-tree-depth-v7';
  return mat;
}

// ---------------------------------------------------------------- impostors

/**
 * Per prototype, the impostor's colour relative to its baked frames (linear rgb gain), so that the
 * hand-over from the 3D tree is a change of detail, not of colour. The frames are renders of the
 * full scan under the bake's light; the 3D trees are its sprays under the game's leaf shading, and
 * the two came out up to 1.6× apart in brightness (most frames brighter, the young fir's and one
 * fir's darker). Solved with `node tools/treelod.mjs calib` (LOD2 against the impostor at the
 * hand-over distance, mean over four bearings, three rounds: within ±5 % before the last round).
 * Re-run it whenever the 3D trees' shading or the bake changes.
 */
export const IMP_GAIN: Record<string, [number, number, number]> = {
  jacaranda: [0.879, 0.867, 0.858],
  dome: [0.734, 0.765, 0.853],
  gnarl: [0.862, 0.874, 1.085],
  umbrella: [0.825, 0.894, 0.947],
  poplar: [0.695, 0.72, 0.797],
  spruce_a: [1.304, 1.352, 1.303],
  fir_a: [0.718, 0.779, 0.743],
  fir_b: [0.696, 0.74, 0.677],
  fir_c: [1.138, 1.245, 1.315],
  shrub_a: [0.922, 1.008, 1.006],
  shrub_b: [0.827, 0.846, 0.9],
  shrub_c: [0.889, 0.887, 1.029],
};

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
      uTime: u.uTime,
      uFrame: u.uFrame,
      uWind: weatherUniforms.uWind,
      uWet: weatherUniforms.uWetness,
      uImpA: { value: kit.impC },
      uImpN: { value: kit.impN },
      uProtos: { value: protos },
      uImpGain: { value: kit.protos.map((p) => new THREE.Vector3(...(IMP_GAIN[p.id] ?? [1, 1, 1]))).concat(Array.from({ length: 16 - kit.protos.length }, () => new THREE.Vector3(1, 1, 1))) },
      uImpCrown: { value: kit.protos.map((p) => new THREE.Vector2(p.crownY, p.crownR)).concat(Array.from({ length: 16 - kit.protos.length }, () => new THREE.Vector2(1, 1))) },
      uLeafFill: u.uLeafFill,
      uSunW: u.uSunW,
      uShade: u.uShade,
      uCanopy: u.uCanopy,
      uCanopyB: u.uCanopyB,
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
uniform vec3 uImpGain[ 16 ];
uniform vec2 uImpGrid;
uniform float uTime;
uniform vec2 uWind;
attribute vec2 iFade;
${TREE_FADE_GLSL}
uniform vec3 uSunW;
varying float vSunOcc;
${TREE_CANOPY_GLSL}
varying vec4 vIUv;
varying float vIW;
varying vec3 vIR;
varying vec3 vIU;
varying vec3 vIF;
varying vec3 vITint;
varying vec2 vISph;
uniform vec2 uImpCrown[ 16 ];
varying vec2 vIFade;
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
  // (a near tree's impostor: its share of the hand-over to and from its 3D tree, iFade — the other
  // side of the same dither; every other tree's is always shown)
  vIFade = iInfo.z > 0.5 ? treeFadeShare( iFade.x, iFade.y ) : vec2( 0.0, 1.0 );
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
  if ( vIFade.y <= vIFade.x ) transformed = vec3( 0.0, -1e5, 0.0 );
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
  vITint = iTint * uImpGain[ int( iInfo.x + 0.5 ) ];
  {
    // (where on the crown's sphere this corner lies, in crown radii: its lighting normal)
    vec2 cr = uImpCrown[ int( iInfo.x + 0.5 ) ] * iPos.w;
    vISph = vec2( c.x * Wc * flip, c.y * S - cr.x ) / max( cr.y, 0.5 );
  }
  vLeafL = 1.0;
  vAOL = 1.0;
  // (the woods upwind: per corner, the card's foot in their shade sooner than its top)
  vSunOcc = treeCanopyOcc( transformed, transformed.y - P.y, uImpCrown[ int( iInfo.x + 0.5 ) ].y * iPos.w, P );
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
varying vec2 vISph;
varying vec2 vIFade;
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
  if ( vIFade.x > 0.0 || vIFade.y < 1.0 ) {
    float ig = ignF( gl_FragCoord.xy );
    if ( ig < vIFade.x || ig >= vIFade.y ) discard;
  }
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
  // blended with a sphere round the crown (its centre and radius: uImpCrown): the frames' normals are
  // the scan's leaves, which mostly face the camera that baked them, so a front-lit impostor came out
  // evenly bright and a side-lit one evenly dark — the 3D trees light their leaves by the crown's
  // surface (treeproto: the lighting normal), sunlit side bright, the far side and the inside dark
  vec3 nS = vec3( vISph, sqrt( max( 0.0, 1.0 - dot( vISph, vISph ) ) ) + 0.25 );
  nb = normalize( mix( normalize( nb ), normalize( nS ), 0.55 ) );
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
  mat.customProgramCacheKey = () => 'apex-tree-impostor-v9';
  return mat;
}
