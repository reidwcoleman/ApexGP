import * as THREE from 'three';
import { TRACK_F, TRACK_R, TYRE_W_F, TYRE_W_R, Z_FRONT_AXLE, Z_REAR_AXLE } from '../../car/carLayout.ts';

/**
 * Contact shadow under a car: the sky the road no longer sees.
 *
 * The sun's shadow map takes the direct light away under a car, but the sky (the env map and the
 * hemisphere fill) still lit the asphalt under the floor as if the car weren't there, so a car sat
 * on a grey road with only its sun shadow beside it — floating, most of all in shade, under cloud
 * and in the long lens. Under a real car the floor runs 4 cm off the road: the asphalt beneath sees
 * almost no sky at all and goes near black, the crevices where the tyres meet the road are darkest,
 * and the darkening fades out within a hand's width of the floor's edge (ACC, every broadcast car).
 *
 * One small quad in car space, a centimetre over the road, multiplying the frame under it by
 * an analytic occlusion of the floor's outline (from carGeometry's floor), the diffuser rising
 * behind it, the nose and front wing, and the four contact patches. No texture, no lighting: one
 * draw per car (3.5 × 6.5 m), its pixels mostly hidden behind the car itself. It is part of the
 * car (a child of its root), so it follows the car into every render — race, replay, highlights,
 * garage — with nothing to keep in sync.
 */

/** occlusion strength (0 … 1), shared by every car */
export const contactShadowStrength = { value: 1 };

const X0 = -1.75;
const X1 = 1.75;
const Z0 = -3.0;
const Z1 = 3.5;
/** above the road: clear of its relief under the car, far below anything the eye could see past */
const LIFT = 0.012;

let geo: THREE.BufferGeometry | null = null;
let mat: THREE.MeshBasicMaterial | null = null;

const VERT = /* glsl */ `
varying vec2 vCar;
varying float vFade;
void main() {
  vCar = position.xz;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  // (gone by the far field: a car 150 m off is a few pixels, and the aerial haze it sits in must
  // not be darkened into a smudge)
  vFade = 1.0 - smoothstep( 110.0, 190.0, -mv.z );
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uStrength;
varying vec2 vCar;
varying float vFade;
float sdBox( vec2 p, vec2 b, float r ) {
  vec2 q = abs( p ) - b + r;
  return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
}
// one tyre's contact: the crevices in front of and behind the patch see the least sky
float tyre( vec2 p, vec2 c, float hw ) {
  vec2 d = ( p - c ) / vec2( hw + 0.03, 0.17 );
  return 0.82 * ( 1.0 - smoothstep( 0.55, 1.9, length( d ) ) );
}
void main() {
  vec2 p = vCar; // x across (left +), y along the car (forward +)
  // the floor (z −1.38 … 1.2, ±0.72 m, 4 cm off the road) and the diffuser rising out behind it to
  // the rear axle: full under the floor, fading out ~25 cm past its edge, weaker where it lifts
  float dF = sdBox( p - vec2( 0.0, -0.33 ), vec2( 0.72, 1.6 ), 0.32 );
  float lift = smoothstep( -1.3, -1.95, p.y );
  float floorOcc = mix( 0.86, 0.5, lift ) * ( 1.0 - smoothstep( -0.22 - 0.1 * lift, 0.24 + 0.2 * lift, dF ) );
  // the nose and the front wing, higher off the road: a lighter shade
  float dN = sdBox( p - vec2( 0.0, 2.05 ), vec2( 0.2, 0.9 ), 0.15 );
  float dW = sdBox( p - vec2( 0.0, 2.68 ), vec2( 0.9, 0.24 ), 0.12 );
  float noseOcc = 0.42 * ( 1.0 - smoothstep( -0.12, 0.3, min( dN, dW ) ) );
  float t = 1.0;
  t *= 1.0 - tyre( p, vec2(  ${(TRACK_F / 2).toFixed(3)}, ${Z_FRONT_AXLE.toFixed(3)} ), ${(TYRE_W_F / 2).toFixed(3)} );
  t *= 1.0 - tyre( p, vec2( -${(TRACK_F / 2).toFixed(3)}, ${Z_FRONT_AXLE.toFixed(3)} ), ${(TYRE_W_F / 2).toFixed(3)} );
  t *= 1.0 - tyre( p, vec2(  ${(TRACK_R / 2).toFixed(3)}, ${Z_REAR_AXLE.toFixed(3)} ), ${(TYRE_W_R / 2).toFixed(3)} );
  t *= 1.0 - tyre( p, vec2( -${(TRACK_R / 2).toFixed(3)}, ${Z_REAR_AXLE.toFixed(3)} ), ${(TYRE_W_R / 2).toFixed(3)} );
  // the whole car (a metre tall, the width of the wheels) still hides a slice of the sky from the
  // road beside it: a faint, wide skirt, kept light because in sunshine most of the light there is
  // the sun's, which only the shadow map may take away
  float dB = sdBox( p - vec2( 0.0, 0.25 ), vec2( 0.95, 2.45 ), 0.6 );
  float bodyOcc = 0.14 * ( 1.0 - smoothstep( -0.2, 0.75, dB ) );
  float occ = 1.0 - ( 1.0 - floorOcc ) * ( 1.0 - noseOcc ) * ( 1.0 - bodyOcc ) * t;
  gl_FragColor = vec4( vec3( 1.0 - occ * uStrength * vFade ), 1.0 );
}`;

function shared(): { geo: THREE.BufferGeometry; mat: THREE.MeshBasicMaterial } {
  if (!geo) {
    geo = new THREE.PlaneGeometry(X1 - X0, Z1 - Z0).rotateX(-Math.PI / 2);
    geo.translate((X0 + X1) / 2, LIFT, (Z0 + Z1) / 2);
    geo.computeBoundingSphere();
  }
  if (!mat) {
    // (a MeshBasicMaterial with its program replaced, not a ShaderMaterial: the car's own material
    // passes — charring, the garage's env swap — walk every mesh under the root and expect `color`)
    mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false, depthTest: true });
    // multiply: dst × src (alpha untouched)
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.ZeroFactor;
    mat.blendDst = THREE.SrcColorFactor;
    mat.blendSrcAlpha = THREE.ZeroFactor;
    mat.blendDstAlpha = THREE.OneFactor;
    // (over the road, its paint and the rubber laid on it: SkidMarks' offset, a touch more)
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -8;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uStrength = contactShadowStrength;
      sh.vertexShader = VERT;
      sh.fragmentShader = FRAG;
    };
    mat.customProgramCacheKey = () => 'car-contact-shadow';
  }
  return { geo, mat };
}

/** the contact shadow for one car, to be added to its root (origin on the ground, mid-wheelbase, +Z forward) */
export function createContactShadow(): THREE.Mesh {
  const { geo, mat } = shared();
  const m = new THREE.Mesh(geo, mat);
  m.name = 'contact-shadow';
  m.castShadow = false;
  m.receiveShadow = false;
  // in the opaque list after the road (1), its markings (2) and the skid marks (2.5), and after the
  // cars themselves (0), which then hide it wherever they stand in front of the road
  m.renderOrder = 3;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/** give a car rig its contact shadow (returns the rig: wraps `createCar(…)` at its call sites) */
export function withContactShadow<T extends { root: THREE.Object3D }>(rig: T): T {
  rig.root.add(createContactShadow());
  return rig;
}
