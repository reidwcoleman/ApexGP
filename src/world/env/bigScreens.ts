import * as THREE from 'three';
import { weatherUniforms } from '../weatherUniforms.ts';

/**
 * The circuit's giant video screens (built with the stands: grandstands.ts) — the world side.
 *
 * At a Grand Prix the big screens round the circuit carry the world feed: the TV director's
 * broadcast with its graphics, what the viewers at home see. The game films that feed itself
 * (game/ScreenFeed.ts: a second lens, the TV director, the timing graphics) into one shared
 * picture, `bigScreenTarget()`, which every screen of the circuit shows.
 *
 * The panels are outdoor LED walls (≈16–20 mm pitch, 5–7 000 nits by day): black louvred
 * modules whose LEDs read as a dot grid up close, beat against the camera's own pixels as moiré
 * at middle distance and blend into a picture further off. Each LED sits under a little visor
 * (the louvres that keep the sun off the dies), so the wall is bright head-on and from below but
 * goes dark quickly when looked down on — the helicopter sees a grey slab — and dims more gently
 * across (a ~140° horizontal viewing angle). In the rain the face is a wet glossy sheet, beaded
 * and running with water that smears the picture under each drop.
 */

/** the LED picture's resolution: one texel per LED (≈18 mm pitch on the 14 m main-straight screens) */
export const LED_W = 768;
export const LED_H = 432;

let target: THREE.WebGLRenderTarget | null = null;
/**
 * The picture on every screen (display-referred, sRGB-encoded in 8 bits, mipmapped for the
 * distant screens): written by the screen feed's resolve pass, read by bigScreenMaterial.
 * One for the page — it outlives circuit switches.
 */
export function bigScreenTarget(): THREE.WebGLRenderTarget {
  if (!target) {
    target = new THREE.WebGLRenderTarget(LED_W, LED_H, {
      depthBuffer: false,
      type: THREE.UnsignedByteType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      anisotropy: 8,
    });
    target.texture.name = 'big-screen picture';
  }
  return target;
}

/** shared by every big-screen material (set by the screen feed each frame) */
export const bigScreenUniforms = {
  /** scene-linear radiance of the panel's full white (the feed keeps it where the grade shows it bright) */
  uScreenGain: { value: 1 },
  uLedRes: { value: new THREE.Vector2(LED_W, LED_H) },
};

export interface ScreenSite {
  /** centre of the LED face */
  center: THREE.Vector3;
  /** the way the face looks (horizontal) */
  normal: THREE.Vector3;
  w: number;
  h: number;
}

/**
 * The current circuit's screens, for the feed's "is any screen worth a new frame" test (set when
 * the stands are built; `root` is their mesh, so a list whose world is gone can be told apart).
 */
export const screenSites: { list: ScreenSite[]; root: THREE.Object3D | null } = { list: [], root: null };

/** the feed's camera is tagged so per-camera code (LOD probes) can leave the main view's state alone */
export function isFeedCamera(cam: THREE.Camera): boolean {
  return cam.userData.screenFeed === true;
}

const VERT_PARS = /* glsl */ `
attribute vec2 aScr;
varying vec2 vScrUv;
varying vec2 vScrM;
`;

const FRAG_PARS = /* glsl */ `
uniform float uScreenGain;
uniform vec2 uLedRes;
uniform float uRain;
uniform float uWetness;
uniform float uWeatherTime;
varying vec2 vScrUv;
varying vec2 vScrM;
float scrHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
`;

/**
 * The water on the face (after the roughness): rain drives onto a vertical panel and beads on the
 * glossy louvres; the film stays a while after the shower stops (the track's wetness).
 */
const WET_FRAG = /* glsl */ `
float scrWet = clamp( uRain * 1.6 + uWetness * 0.5, 0.0, 1.0 );
// a wet face is a mirror-smooth film over the matte black louvres (and darker where it is diffuse)
roughnessFactor = mix( roughnessFactor, 0.06, scrWet );
diffuseColor.rgb *= 1.0 - 0.35 * scrWet;
`;

/**
 * Beads and runs (after the normal): ~7 cm cells each holding a bead that forms, grows and is
 * washed away a few seconds later; runs every ~12 cm where a drop has let go and slid down,
 * leaving a wet trail. Both tilt the surface normal (the sky and the sun glint in them) and are
 * handed on to the emission, which they refract and smear.
 */
const DROPS_FRAG = /* glsl */ `
vec3 scrN0 = normal;
vec3 scrUpV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
vec3 scrH = normalize( cross( scrUpV, scrN0 ) );
vec3 scrU = cross( scrN0, scrH );
vec2 scrDropN = vec2( 0.0 );
float scrDrop = 0.0;
float scrRun = 0.0;
if ( scrWet > 0.002 ) {
  vec2 q = vScrM * 14.0;
  vec2 id = floor( q );
  float h = scrHash( id );
  vec2 c = vec2( scrHash( id + 3.7 ), scrHash( id + 9.2 ) ) * 0.56 + 0.22;
  float r = 0.16 + 0.2 * scrHash( id + 5.1 );
  float life = fract( uWeatherTime * ( 0.12 + 0.18 * h ) + h * 7.0 );
  float on = step( h, 0.8 * uRain + 0.2 * uWetness ) * smoothstep( 0.0, 0.25, life ) * ( 1.0 - smoothstep( 0.8, 1.0, life ) );
  vec2 d = ( fract( q ) - c ) / ( r * ( 0.6 + 0.4 * life ) );
  float dd = dot( d, d );
  scrDrop = on * ( 1.0 - smoothstep( 0.6, 1.0, dd ) );
  scrDropN = d * scrDrop;
  // runs: a meandering column, a drop sliding down it now and then, the trail it leaves behind
  float col = floor( vScrM.x * 8.0 );
  float hc = scrHash( vec2( col, 17.0 ) );
  float x = fract( vScrM.x * 8.0 ) - 0.5 + 0.25 * sin( vScrM.y * 3.0 + hc * 20.0 ) * ( hc - 0.5 );
  float head = fract( ( vScrM.y + uWeatherTime * ( 0.35 + 0.5 * hc ) ) / 3.5 + hc );
  float lane = 1.0 - smoothstep( 0.035, 0.09, abs( x ) );
  scrRun = lane * step( hc, uRain * 0.9 ) * smoothstep( 0.0, 0.5, head );
  scrDropN.x += lane * sign( x ) * scrRun * 0.6;
  normal = normalize( normal + ( scrH * scrDropN.x - scrU * scrDropN.y ) * 0.45 );
}
`;

/**
 * The LEDs (replacing three's emissive map): the picture sampled per LED up close (crisp pixel
 * squares, not a bilinear blur), drawn as round dies on the black face with their red, green and
 * blue chips at arm's length; the grid fades to its average as the LEDs shrink below a pixel
 * (some moiré survives the hand-over, as it does on camera); the louvres' viewing angle; the drops'
 * lensing. White = uScreenGain.
 */
const LED_FRAG = /* glsl */ `
{
  vec2 uvS = vScrUv;
  vec2 p = uvS * uLedRes;
  vec2 fwp = fwidth( p );
  float w = max( fwp.x, fwp.y );
  float nearK = 1.0 - smoothstep( 0.3, 0.7, w );
  vec2 cellUv = ( floor( p ) + 0.5 ) / uLedRes;
  vec2 suv = mix( uvS, cellUv, nearK ) - scrDropN * 0.006;
  vec2 gx = dFdx( uvS ), gy = dFdy( uvS );
  // (a bead is a little lens: it shows a smeared, flipped patch of the picture; a run smears it down)
  float blur = 1.0 + 6.0 * scrDrop + 3.0 * scrRun;
  vec3 led = textureGrad( emissiveMap, suv, gx * blur, gy * blur ).rgb;
  led = pow( led, vec3( 2.2 ) ); // the picture is stored display-encoded
  // the dies: round, ~70 % of the pitch across, on the black module face
  vec2 f = fract( p ) - 0.5;
  float aa = max( w * 0.5, 0.015 );
  float die = 1.0 - smoothstep( 0.34 - aa, 0.34 + aa, length( f ) );
  float grid = mix( die / 0.363, 1.0, smoothstep( 0.25, 0.8, w ) );
  // the three chips of each SMD die, side by side, when the camera is right up against the panel
  float chips = 1.0 - smoothstep( 0.05, 0.14, w );
  vec3 rgbM = vec3( 1.0 );
  if ( chips > 0.0 ) {
    float x = f.x / 0.3;
    vec3 chip = 1.0 - smoothstep( vec3( 0.12 ), vec3( 0.36 ), abs( vec3( x + 0.55, x, x - 0.55 ) ) );
    rgbM = mix( vec3( 1.0 ), chip * 2.6, chips );
  }
  // the viewing angle (radiance toward the eye): gentle across, the visors cut it hard from above
  vec3 V = normalize( vViewPosition );
  float vz = dot( V, scrN0 );
  float vx = dot( V, scrH );
  float vy = dot( V, scrU );
  float ch = vz / max( length( vec2( vx, vz ) ), 1e-4 );
  float cv = vz / max( length( vec2( vy, vz ) ), 1e-4 );
  float fh = pow( max( ch, 0.0 ), 0.65 );
  float fv = pow( max( cv, 0.0 ), vy > 0.0 ? 7.0 : 1.3 );
  float view = fh * fv * step( 0.0, vz );
  // off axis the red dies fall away first: a cool cast toward the edge of the viewing cone
  vec3 offTint = mix( vec3( 0.84, 0.97, 1.06 ), vec3( 1.0 ), view );
  // a bead also scatters some of the light round it (a soft glow in each drop)
  float scatter = 1.0 + 0.5 * scrDrop + 0.2 * scrRun;
  totalEmissiveRadiance = led * grid * rgbM * offTint * ( view * scatter * uScreenGain );
}
`;

/**
 * The screens' face: a lit black louvred surface (sun and sky glint on it, more so wet) whose
 * emission is the shared LED picture. One program for every circuit.
 */
export function bigScreenMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x060708,
    roughness: 0.55,
    metalness: 0,
    emissive: 0xffffff,
    emissiveMap: bigScreenTarget().texture,
  });
  mat.name = 'big-screen';
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uScreenGain = bigScreenUniforms.uScreenGain;
    sh.uniforms.uLedRes = bigScreenUniforms.uLedRes;
    sh.uniforms.uRain = weatherUniforms.uRain;
    sh.uniforms.uWetness = weatherUniforms.uWetness;
    sh.uniforms.uWeatherTime = weatherUniforms.uWeatherTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvScrUv = uv;\nvScrM = uv * aScr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${WET_FRAG}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${DROPS_FRAG}`)
      .replace('#include <emissivemap_fragment>', LED_FRAG);
  };
  mat.customProgramCacheKey = () => 'apex-bigscreen-v1';
  return mat;
}

/** per-vertex screen size (m) for the drops: four vertices per screen quad, in build order */
export function screenSizeAttribute(sizes: readonly { w: number; h: number }[]): THREE.BufferAttribute {
  const a = new Float32Array(sizes.length * 8);
  sizes.forEach((s, i) => {
    for (let k = 0; k < 4; k++) {
      a[i * 8 + k * 2] = s.w;
      a[i * 8 + k * 2 + 1] = s.h;
    }
  });
  return new THREE.BufferAttribute(a, 2);
}
