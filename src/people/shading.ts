import * as THREE from 'three';

/**
 * Shading for the people: the pieces that make the Quaternius bodies read as people
 * rather than superhero figurines. Shared by the single-person materials (Humans.ts)
 * and the instanced crowd (Crowd.ts).
 *
 *  - SHAPE_GLSL: an ordinary body in bind space: the lats, pecs, traps and arms of the
 *    "Superhero" base taken down, a real waist, and a weight axis (slim … heavy).
 *  - skin lighting: per-channel wrapped diffuse (light bleeding red past the terminator,
 *    the look of subsurface scattering), a second tighter specular lobe (skin oil),
 *    pores as a screen-space bump; skin tones from a palette of real skin albedos.
 *  - hair lighting: Kajiya-Kay, two shifted lobes along the strand direction.
 *  - fabric: wrinkles, folds, seams as bump; white cloth kept at a real white's albedo.
 */

export const NOISE_GLSL = /* glsl */ `
float apHash( vec3 p ) { p = fract( p * 0.3183099 + 0.1 ); p *= 17.0; return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) ); }
float apNoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( apHash( i ), apHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( apHash( i + vec3( 0, 1, 0 ) ), apHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( apHash( i + vec3( 0, 0, 1 ) ), apHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( apHash( i + vec3( 0, 1, 1 ) ), apHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
`;

/**
 * GLSL: reshape a bind-space (T-pose) body point. J0..J2 as CLOTH_GLSL has them
 * (J2 = armY, headY, thighX, armZ); B = (weight −1 slim … +1 heavy, muscle 0 soft … 1 cut,
 * female 0/1, 0).
 */
export const SHAPE_GLSL = /* glsl */ `
float apGauss( float x, float c, float w ) { float d = ( x - c ) / w; return exp( - d * d ); }
vec3 bodyShape( vec3 p, vec4 J0, vec4 J1, vec4 J2, vec4 B ) {
  float ax = abs( p.x );
  float shX = J0.x, wrX = J0.z, neckY = J0.w;
  float chestY = J1.x, waistY = J1.y, kneeY = J1.z, ankleY = J1.w;
  float armY = J2.x, legX = J2.z, armZ = J2.w;
  float male = 1.0 - B.z;
  float w = B.x;
  float heavy = max( w, 0.0 ), slim = max( - w, 0.0 );
  // below the head
  float body = 1.0 - smoothstep( neckY + 0.02, neckY + 0.07, p.y );
  // the arms (T-pose: out along x at shoulder height), hands left alone
  float arm = smoothstep( shX - 0.05, shX + 0.03, ax ) * smoothstep( armY - 0.2, armY - 0.1, p.y );
  float hand = smoothstep( wrX - 0.05, wrX - 0.01, ax );
  float trunk = ( 1.0 - arm ) * body * smoothstep( J1.y - 0.22, J1.y - 0.12, p.y );
  // the legs: below the crotch, around each thigh
  float crotch = waistY - 0.17;
  float leg = ( 1.0 - smoothstep( crotch - 0.02, crotch + 0.06, p.y ) ) * step( ankleY + 0.02, p.y );
  // ---- torso: lats and traps down, a waist, a flatter chest (the male base is a bodybuilder)
  float lat = apGauss( p.y, chestY - 0.05, 0.11 ) * smoothstep( 0.05, 0.16, ax );
  float waist = apGauss( p.y, waistY + 0.02, 0.1 );
  float sx = 1.0 - trunk * ( male * 0.065 * lat - ( 0.045 * male + 0.015 ) * waist );
  // weight: the middle fills out (belly forward, sides out), the slim lose a little everywhere
  float mid = apGauss( p.y, waistY + 0.03, 0.16 ) * trunk;
  sx *= 1.0 + mid * ( 0.13 * heavy - 0.05 * slim ) + trunk * apGauss( p.y, chestY, 0.14 ) * 0.05 * heavy;
  p.x *= sx;
  float zc = -0.03;
  float front = smoothstep( -0.02, 0.1, p.z - zc );
  p.z = zc + ( p.z - zc ) * ( 1.0 + trunk * ( ( 0.035 * male + 0.01 ) * waist + mid * ( 0.06 * heavy - 0.04 * slim ) ) );
  p.z += trunk * front * ( mid * apGauss( p.y, waistY + 0.01, 0.1 ) * 0.075 * heavy - male * 0.012 * apGauss( p.y, chestY + 0.03, 0.07 ) * smoothstep( 0.0, 0.09, p.z ) );
  // traps: the superhero's slope from the ears to the shoulders taken right down
  // (tapered out across the deltoid, so the shoulder line stays one smooth slope with no knob at the end)
  float trap = smoothstep( 0.05, 0.12, ax ) * ( 1.0 - smoothstep( shX - 0.01, shX + 0.12, ax ) ) * smoothstep( armY - 0.05, armY + 0.04, p.y ) * body;
  p.y -= ( male * 0.016 + 0.005 ) * trap * ( 1.0 - 0.5 * heavy );
  // neck: a neck, not a column as wide as the head
  float neck = smoothstep( neckY - 0.08, neckY - 0.04, p.y ) * ( 1.0 - smoothstep( neckY + 0.035, neckY + 0.075, p.y ) ) * ( 1.0 - arm );
  float nk = 1.0 - neck * ( 0.09 * male + 0.04 - 0.08 * heavy );
  p.x *= nk;
  p.z = -0.035 + ( p.z + 0.035 ) * nk;
  // shoulders: the deltoids less padded
  vec3 sj = vec3( sign( p.x ) * shX, armY, armZ );
  float delt = exp( - dot( p - sj, p - sj ) / ( 0.08 * 0.08 ) ) * body;
  p = mix( p, sj + ( p - sj ) * 0.9, delt * ( 0.7 * male + 0.3 ) * ( 1.0 - heavy ) );
  // ---- hands: the base's are big; a little smaller toward the wrist
  vec3 wr = vec3( sign( p.x ) * wrX, armY, armZ );
  p = mix( p, wr + ( p - wr ) * 0.92, hand );
  // ---- arms: slimmer, around the bone axis
  vec2 ad = vec2( p.y - armY, p.z - armZ );
  float upper = 1.0 - smoothstep( J0.y - 0.04, J0.y + 0.04, ax );
  float armK = arm * ( 1.0 - hand ) * ( - ( 0.03 + 0.07 * upper ) * male - 0.01 + 0.13 * heavy - 0.05 * slim );
  ad *= 1.0 + armK;
  p.y = armY + ad.x;
  p.z = armZ + ad.y;
  // ---- legs
  vec2 ld = vec2( ax - legX, p.z + 0.035 );
  float thigh = smoothstep( kneeY - 0.05, kneeY + 0.12, p.y );
  ld *= 1.0 + leg * ( thigh * ( - 0.035 * male + 0.1 * heavy - 0.05 * slim ) + ( 1.0 - thigh ) * ( 0.03 * heavy - 0.03 * slim ) );
  p.x = sign( p.x ) * ( legX + ld.x ) * leg + p.x * ( 1.0 - leg );
  p.z = ( ld.y - 0.035 ) * leg + p.z * ( 1.0 - leg );
  // ---- feet: the base's are narrow and pointed (a shoe is broad, with a round toe box)
  float foot = 1.0 - smoothstep( ankleY - 0.005, ankleY + 0.03, p.y );
  float toe = smoothstep( -0.03, 0.09, p.z );
  float fx = abs( p.x ) - legX;
  p.x = sign( p.x ) * ( legX + fx * ( 1.0 + foot * ( 0.12 + 0.3 * toe ) ) );
  p.y += foot * toe * 0.01 * smoothstep( 0.005, 0.04, p.y );
  // a round toe: the point pulled back
  p.z -= foot * smoothstep( 0.07, 0.14, p.z ) * ( 1.0 - smoothstep( 0.0, 0.03, abs( fx ) ) ) * 0.018;
  return p;
}
`;

/** a screen-space bump: tilt the normal by the gradient of a height (view-space metres) */
export const BUMP_GLSL = /* glsl */ `
vec3 apBump( vec3 surfPos, vec3 surfNorm, float h, float faceDir ) {
  vec3 sx = dFdx( surfPos ), sy = dFdy( surfPos );
  vec3 r1 = cross( sy, surfNorm ), r2 = cross( surfNorm, sx );
  float det = dot( sx, r1 ) * faceDir;
  vec3 grad = sign( det ) * ( dFdx( h ) * r1 + dFdy( h ) * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}
`;

/**
 * Lighting hooks spliced into three's physical lighting (MeshStandard/Physical):
 * gSkin (0..1) turns on the skin model, gHair (0..1) the strand model along gHairT
 * (view space). APEX_PEOPLE_LIGHTS must be defined for the hooks to compile in.
 */
export const LIGHT_GLOBALS = /* glsl */ `
float gSkin = 0.0;
float gHair = 0.0;
vec3 gHairT = vec3( 0.0, 1.0, 0.0 );
float gHairShift = 0.0;
vec3 gHairTint = vec3( 1.0 );
`;

let _lights: string | null = null;
/** three's lights_physical_pars_fragment with the skin and hair models spliced in */
export function peopleLightsChunk(): string {
  if (_lights) return _lights;
  let s = THREE.ShaderChunk.lights_physical_pars_fragment;
  const diffLine = 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  const specLine = 'reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;';
  if (!s.includes(diffLine) || !s.includes(specLine)) {
    console.warn('[people] three lighting chunk changed: skin/hair lighting disabled');
    return (_lights = s);
  }
  s = s.replace(
    specLine,
    `{
  float ndlH = dot( geometryNormal, directLight.direction );
  if ( gHair > 0.0 ) {
    // Kajiya-Kay: a white primary lobe and a coloured, broader secondary, shifted along the strand
    vec3 H = normalize( directLight.direction + geometryViewDir );
    vec3 t1 = normalize( gHairT + geometryNormal * ( 0.12 + gHairShift ) );
    vec3 t2 = normalize( gHairT + geometryNormal * ( -0.1 + gHairShift ) );
    float d1 = dot( t1, H ), d2 = dot( t2, H );
    float s1 = pow( max( 0.0, 1.0 - d1 * d1 ), 48.0 );
    float s2 = pow( max( 0.0, 1.0 - d2 * d2 ), 10.0 );
    float att = smoothstep( -0.15, 0.35, ndlH );
    vec3 kk = ( s1 * 0.055 * mix( vec3( 1.0 ), gHairTint, 0.4 ) + s2 * 0.12 * gHairTint ) * att * directLight.color;
    reflectedLight.directSpecular += mix( irradiance * specularBRDF * material.multiScatteringCompensation, kk, gHair );
  } else {
    reflectedLight.directSpecular += irradiance * specularBRDF * material.multiScatteringCompensation;
  }
  if ( gSkin > 0.0 ) {
    // a second, tighter lobe: the oily sheen over the rougher skin
    PhysicalMaterial m2 = material;
    m2.roughness = max( 0.3, material.roughness * 0.6 );
    reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, m2 ) * 0.12 * gSkin;
  }
}`,
  );
  s = s.replace(
    diffLine,
    `vec3 apIrr = irradiance;
if ( gSkin > 0.0 || gHair > 0.0 ) {
  // wrapped diffuse: red scatters furthest under the skin, so it wraps furthest past the terminator
  float ndl = dot( geometryNormal, directLight.direction );
  vec3 wr = mix( vec3( 0.28 ), vec3( 0.5, 0.22, 0.14 ), gSkin / max( gSkin + gHair, 1e-3 ) );
  vec3 wrapped = clamp( ( ndl + wr ) / ( 1.0 + wr ), 0.0, 1.0 );
  wrapped = wrapped * sqrt( wrapped );
  // the shadow term is already in directLight.color
  apIrr = mix( irradiance, wrapped * directLight.color, max( gSkin, gHair ) );
}
reflectedLight.directDiffuse += apIrr * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`,
  );
  return (_lights = s);
}

// ------------------------------------------------------------------------------------ skin tones
/** skin albedos (linear), very fair → very deep, after measured reflectance spectra */
const SKIN_RAMP: [number, number, number][] = [
  [0.64, 0.39, 0.28], [0.59, 0.345, 0.23], [0.52, 0.29, 0.185], [0.44, 0.25, 0.155], [0.35, 0.19, 0.115],
  [0.26, 0.145, 0.088], [0.18, 0.1, 0.062], [0.125, 0.07, 0.046], [0.088, 0.05, 0.035],
];

/** a skin albedo for tone 0 (fair) … 1 (deep), with an undertone −1 (pink) … +1 (olive / golden) */
export function skinColor(tone: number, undertone = 0, out = new THREE.Color()): THREE.Color {
  const t = THREE.MathUtils.clamp(tone, 0, 1) * (SKIN_RAMP.length - 1);
  const i = Math.min(SKIN_RAMP.length - 2, Math.floor(t));
  const a = new THREE.Color().fromArray(SKIN_RAMP[i]), b = new THREE.Color().fromArray(SKIN_RAMP[i + 1]);
  out.copy(a).lerp(b, t - i);
  // undertone: pink pulls red up and green down, olive the other way (subtle)
  const u = THREE.MathUtils.clamp(undertone, -1, 1) * 0.05;
  out.r *= 1 - u * 0.4;
  out.g *= 1 + u * 0.5;
  out.b *= 1 - u * 0.5;
  return out;
}

/** GLSL: the painted skin texture as detail (÷ its mean) on a target albedo */
export const SKIN_GLSL = /* glsl */ `
vec3 skinAlbedo( vec3 tex, vec3 texMean, vec3 target, vec3 rest ) {
  vec3 d = tex / texMean;
  float l = dot( d, vec3( 0.3, 0.59, 0.11 ) );
  // keep the paint's value structure and a little of its colour (lips, cheeks, knuckles)
  d = mix( vec3( l ), d, 0.7 );
  d = clamp( d, vec3( 0.35 ), vec3( 1.6 ) );
  vec3 c = target * d;
  // mottling: a real complexion is never one flat colour
  float m = apNoise( rest * 38.0 ) * 0.6 + apNoise( rest * 110.0 ) * 0.4;
  c *= vec3( 0.95, 0.965, 0.97 ) + vec3( 0.1, 0.07, 0.06 ) * m;
  return c;
}
`;

// ------------------------------------------------------------------------------------ eyes
/** a person's eye: procedural iris (colour, fibres, limbal ring), pupil, sclera, lid shadow */
export function eyeMaterial(center: THREE.Vector4, iris: THREE.Color, lid = new THREE.Color(0.5, 0.33, 0.25)): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.376, name: 'person-eye' });
  // uBlink 0 open … 1 shut: the upper lid (skin, lashes at its edge) comes down over the ball
  const u = { uEyeC: { value: center }, uIris: { value: iris }, uBlink: { value: 0 }, uLid: { value: lid } };
  m.userData.eye = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vEyeP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vEyeP = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec4 uEyeC; uniform vec3 uIris; uniform float uBlink; uniform vec3 uLid;
varying vec3 vEyeP;
${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `
{
  vec3 c = vec3( sign( vEyeP.x ) * uEyeC.x, uEyeC.y, uEyeC.z );
  vec3 d = ( vEyeP - c ) / uEyeC.w;
  // looking a touch inward, as eyes converge
  vec2 q = d.xy - vec2( -sign( vEyeP.x ) * 0.06, 0.02 );
  float r = length( q ) * step( 0.0, d.z );
  float ang = atan( q.y, q.x );
  float irisR = 0.47, pupilR = 0.17;
  float fib = apNoise( vec3( ang * 9.0, r * 22.0, c.x * 50.0 ) ) * 0.6 + apNoise( vec3( ang * 27.0, r * 40.0, 1.0 ) ) * 0.4;
  vec3 irisC = uIris * ( 0.5 + 0.8 * fib );
  // a lighter ring round the pupil (collarette), a dark limbal ring at the edge
  irisC = mix( irisC, uIris * 1.25 + vec3( 0.02, 0.012, 0.0 ), smoothstep( 0.3, 0.2, r ) * 0.35 );
  irisC *= mix( 1.0, 0.4, smoothstep( irisR - 0.08, irisR, r ) );
  vec3 sclera = vec3( 0.64, 0.6, 0.57 );
  sclera = mix( sclera, vec3( 0.7, 0.52, 0.5 ), smoothstep( 0.6, 0.95, r ) );   // pinker toward the corners
  vec3 col = mix( irisC, sclera, smoothstep( irisR - 0.012, irisR + 0.012, r ) );
  col = mix( vec3( 0.012 ), col, smoothstep( pupilR - 0.02, pupilR + 0.015, r ) );
  // the upper lid's shadow and the socket's
  col *= mix( 1.0, 0.4, smoothstep( -0.15, 0.55, d.y ) ) * mix( 1.0, 0.55, smoothstep( 0.55, 0.95, length( d.xy ) ) );
  if ( uBlink > 0.0 ) {
    float edge = 1.0 - 2.2 * uBlink;
    float lid = smoothstep( edge - 0.03, edge + 0.03, d.y );
    vec3 lc = mix( vec3( 0.02 ), uLid * 0.8, smoothstep( edge, edge + 0.12, d.y ) );
    col = mix( col, lc, lid );
  }
  diffuseColor.rgb = col;
}`);
  };
  m.customProgramCacheKey = () => 'apex-eye-v1';
  return m;
}

// ------------------------------------------------------------------------------------ fabric
/**
 * GLSL: a fabric height field (metres) from the rest position, for apBump: weave,
 * soft folds, creases at the elbows, knees and waist, seams. clPart as clothAt sets it.
 */
export const FABRIC_GLSL = /* glsl */ `
float fabricHeight( vec3 r, vec3 n, vec4 J0, vec4 J1, vec4 J2, float part, float kind, out float seam ) {
  float ax = abs( r.x );
  float armY = J2.x;
  float arm = step( J0.x - 0.02, ax ) * step( armY - 0.2, r.y );
  seam = 0.0;
  // weave
  float h = ( apNoise( r * 1500.0 ) - 0.5 ) * 0.00006;
  if ( part > 3.5 ) return h;
  // big soft folds everywhere, stretched along the limbs
  vec3 fq = arm > 0.5 ? vec3( ax * 7.0, r.y * 38.0, r.z * 38.0 ) : vec3( r.x * 20.0, r.y * 11.0, r.z * 20.0 );
  float folds = apNoise( fq ) + 0.5 * apNoise( fq * 2.3 + 7.1 );
  float amp = kind > 6.5 ? 0.0013 : 0.0022;
  h += ( folds - 0.75 ) * amp;
  // creases: rings round the elbow and knee, a band at the waist, bunching above the shoes
  float elbow = arm * exp( - pow( ( ax - J0.y ) / 0.045, 2.0 ) );
  float knee = ( 1.0 - arm ) * exp( - pow( ( r.y - J1.z ) / 0.06, 2.0 ) );
  float cr = sin( ( arm > 0.5 ? ax : r.y ) * 260.0 + apNoise( r * 30.0 ) * 6.0 );
  h += cr * ( elbow + knee ) * 0.0011;
  h += ( 1.0 - arm ) * exp( - pow( ( r.y - ( J1.w + 0.08 ) ) / 0.04, 2.0 ) ) * sin( r.y * 300.0 + apNoise( r * 25.0 ) * 5.0 ) * 0.0012 * step( 0.5, part - 1.5 );
  // seams: shoulder, sides (tops) / outside leg (bottoms), cuff and hem lines
  float sd = abs( abs( n.x ) - 0.74 );
  float side = ( 1.0 - arm ) * ( 1.0 - smoothstep( 0.0, 0.035, sd ) );
  float shoulder = ( 1.0 - smoothstep( 0.0, 0.006, abs( ax - J0.x - 0.015 ) ) ) * step( armY - 0.12, r.y );
  float hem = part < 1.5 ? 1.0 - smoothstep( 0.0, 0.004, abs( r.y - J1.y + 0.02 ) ) : 0.0;
  seam = max( max( side, shoulder * step( 0.5, part ) * step( part, 1.5 ) ), hem );
  h -= seam * 0.0007;
  return h;
}
`;

/** a real white fabric reflects ~80 %, never 100 % (keeps kit whites out of the bloom) */
export const CLOTH_WHITE_MAX = 0.78;
