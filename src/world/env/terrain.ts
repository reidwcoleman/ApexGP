import * as THREE from 'three';
import { FAR_CELL, FINE_CELL, MID_CELL, WorldMap } from './worldmap.ts';
import { detailNormalTexture, noiseTexture } from './textures.ts';
import { weatherUniforms } from '../weatherUniforms.ts';
import type { ParkMasks } from './parkmask.ts';

/**
 * Terrain meshes: 4 m chunks around the circuit, 16 m chunks over the 6 km
 * square, 256 m far ring (plain + Prealps). Grids are stitched (boundary
 * vertices lie on the coarser edge). One splat shader for all of it: mown
 * lawns with mowing stripes, September meadow, leaf litter under the woods,
 * gravel paths and asphalt from the park masks, farmland and villages outside
 * the park. Rain darkens soil and grass, makes everything glossier and fills
 * puddles on the paths.
 */

export interface TerrainBuild {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  uniforms: Record<string, THREE.IUniform>;
  setMasks(m: ParkMasks): void;
}

const lin = (hex: number) => new THREE.Color(hex);
/** (m) where the far land's haze starts to ease (the horizon ring uses the same distance) */
export const HAZE_EASE = 5000;

/**
 * Per-venue ground palette (track agents: tune your venue here). Colour keys override the
 * terrain shader's colours (hex sRGB): lawn, meadow, straw, grassDark, earth, gravel, sand,
 * rock, litter, canopy. `arid` 0 … 1 lays sand/gravel/rock ground over the unmown land:
 * 1 = desert (only lawns, verges and paving stay), ~0.4 = patches (coastal dunes).
 */
export interface TerrainPalette {
  arid?: number;
  lawn?: number;
  meadow?: number;
  straw?: number;
  grassDark?: number;
  earth?: number;
  gravel?: number;
  sand?: number;
  rock?: number;
  litter?: number;
  canopy?: number;
  /**
   * the countryside beyond the 6 km square (no trees are placed there: the canopy is painted):
   * `forest` −0.3 … +0.3 shifts how much of it is woodland (steep ground is always the first to be
   * wooded); `pasture` 0 … 1 the share of grass among the farm fields (the rest: stubble, maize,
   * ploughed earth, hay)
   */
  forest?: number;
  pasture?: number;
}
export const TERRAIN_PALETTES: Record<string, TerrainPalette> = {
  // Bahrain: the Sakhir desert — pale sand, grey-brown limestone pavement, irrigated verges
  sakhir: { arid: 1, sand: 0xcbb58e, rock: 0x93826a, lawn: 0x5e7433, earth: 0xa38c6c, gravel: 0xc9b795 },
  // Abu Dhabi: Yas Island — bright coastal sand, landscaped lawns
  yasmarina: { arid: 1, sand: 0xd8be8c, rock: 0xa08a6a, lawn: 0x587534, earth: 0xae9270, gravel: 0xd0bf9c },
  // Zandvoort: dunes with marram grass between the verges
  zandvoort: { arid: 0.42, sand: 0xd2c29c, rock: 0x9a8f7a, meadow: 0x6e7547, straw: 0xa9a071 },
  // Mexico City: dry highland grass, brown volcanic soil
  mexico: { meadow: 0x7a7646, straw: 0xa28e5c, earth: 0x6e5238, grassDark: 0x4a4e2a },
  // Texas: straw-coloured prairie, limestone and red clay; ranch pasture, mesquite and oak mottes
  austin: { arid: 0.18, meadow: 0x7c7647, straw: 0xab975f, earth: 0x8e6244, grassDark: 0x4c5129, sand: 0xb89c72, rock: 0xa2968a, forest: -0.1, pasture: 0.7 },
  // Hungary in August: sun-dried grass; the plain's big arable fields
  hungaroring: { meadow: 0x76763f, straw: 0xa69455, forest: 0.02, pasture: 0.3 },
  // Melbourne: Albert Park's dry-summer lawns
  melbourne: { meadow: 0x6f7544, straw: 0xa09262 },
  // São Paulo: red tropical earth
  interlagos: { earth: 0x8c4e30, meadow: 0x5f7236 },
  // the Ardennes: spruce and beech on every slope, grazing on the plateaus (Herve cattle country)
  ardennes: { forest: 0.17, pasture: 0.8 },
  // Northamptonshire: big arable fields (harvested wheat, oilseed, beans) with pasture between
  airfield: { forest: -0.04, pasture: 0.36 },
  // Lombardy: maize and wheat on the plain, woods only on the Brianza slopes
  park: { forest: -0.02, pasture: 0.22 },
  // Mie: wooded hills, paddies and tea fields on the plain
  suzuka: { forest: 0.12, pasture: 0.5 },
  // Styria: spruce on the slopes, hay meadows and pasture in the valleys
  spielberg: { forest: 0.14, pasture: 0.85 },
  // the St Lawrence plain: dairy farms and maize
  montreal: { forest: -0.05, pasture: 0.35 },
};
const PALETTE_KEYS: Record<keyof Omit<TerrainPalette, 'arid' | 'forest' | 'pasture'>, string> = {
  lawn: 'uLawn', meadow: 'uMeadow', straw: 'uStraw', grassDark: 'uGrassDark', earth: 'uEarth', gravel: 'uGravel',
  sand: 'uSand', rock: 'uRock', litter: 'uLitter', canopy: 'uCanopy',
};
/** apply a venue palette to a terrain material's uniforms */
export function applyTerrainPalette(uniforms: Record<string, THREE.IUniform>, pal: TerrainPalette | undefined) {
  if (!pal) return;
  for (const [k, u] of Object.entries(PALETTE_KEYS)) {
    const v = pal[k as keyof typeof PALETTE_KEYS];
    if (v !== undefined) (uniforms[u].value as THREE.Color).setHex(v);
  }
  uniforms.uArid.value = pal.arid ?? 0;
  uniforms.uForestCover.value = pal.forest ?? 0;
  uniforms.uPasture.value = pal.pasture ?? 0.32;
}

export function createTerrainMaterial(maxAniso: number): { material: THREE.MeshStandardMaterial; uniforms: Record<string, THREE.IUniform> } {
  const noise = noiseTexture();
  const detail = detailNormalTexture();
  noise.anisotropy = maxAniso;
  detail.anisotropy = maxAniso;
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;
  const uniforms: Record<string, THREE.IUniform> = {
    uNoise: { value: noise },
    uDetailN: { value: detail },
    uMaskFine: { value: blank },
    uMaskCoarse: { value: blank },
    uMaskTrack: { value: blank },
    uFineO: { value: new THREE.Vector2() },
    uFineS: { value: new THREE.Vector2(1, 1) },
    uSqO: { value: new THREE.Vector2() },
    uSqS: { value: new THREE.Vector2(1, 1) },
    uCenter: { value: new THREE.Vector2() },
    // (a deeper, duller lawn than a game's: verges and parkland as camera footage shows them)
    uLawn: { value: lin(0x46692f) },
    uMeadow: { value: lin(0x636840) },
    uStraw: { value: lin(0x958a5a) },
    uGrassDark: { value: lin(0x3e4f28) },
    uLitter: { value: lin(0x4e3d2a) },
    uLitterDark: { value: lin(0x2e261c) },
    uMoss: { value: lin(0x46562a) },
    uGravel: { value: lin(0xb4a78b) },
    uGravelDark: { value: lin(0x857a65) },
    uAsphalt: { value: lin(0x4d4f52) },
    uEarth: { value: lin(0x7d664c) },
    uCanopy: { value: lin(0x33462a) },
    uRoof: { value: lin(0x9a5a3e) },
    uSand: { value: lin(0xc2a472) },
    uRock: { value: lin(0x86705a) },
    uArid: { value: 0 },
    uForestCover: { value: 0 },
    uPasture: { value: 0.32 },
    /** 1 = the city goes on to the horizon beyond the square (São Paulo), 0 = towns ringed by farmland */
    uCity: { value: 0 },
    /** share of town ground that is gardens rather than painted roofs (Spa's villages are real houses on lawns) */
    uTownYard: { value: 0.14 },
    /**
     * (m) beyond this the land's haze distance grows only as √distance, like the horizon ring's
     * (horizon.ts HAZE_EASE): the hills 8–15 km off keep their woods and folds through a summer haze
     * instead of fading into one pale band. Set it very large where real buildings stand far out
     * (São Paulo's city): they must not be hazier than the ground under them.
     */
    uHazeEase: { value: HAZE_EASE },
    uWetness: weatherUniforms.uWetness,
    uRain: weatherUniforms.uRain,
    uWTime: weatherUniforms.uWeatherTime,
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHazeEase;
varying vec3 vWPos;
varying vec3 vWNormal;`,
      )
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>
#ifdef USE_FOG
{
  float fd = length( vFogRay );
  if ( fd > uHazeEase ) vFogRay *= sqrt( uHazeEase / fd );
}
#endif`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vWNormal = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uNoise;
uniform sampler2D uDetailN;
uniform sampler2D uMaskFine;
uniform sampler2D uMaskCoarse;
uniform sampler2D uMaskTrack;
uniform vec2 uFineO, uFineS, uSqO, uSqS, uCenter;
uniform vec3 uLawn, uMeadow, uStraw, uGrassDark, uLitter, uLitterDark, uMoss, uGravel, uGravelDark, uAsphalt, uEarth, uCanopy, uRoof, uSand, uRock;
uniform float uArid;
uniform float uForestCover, uPasture;
uniform float uWetness, uRain, uWTime;
uniform float uCity;
uniform float uTownYard;
varying vec3 vWPos;
varying vec3 vWNormal;
float tRough;
float tAO;
float tWood = 0.0;
float tAridK = 0.0;
vec3 tRipple = vec3( 0.0 );
vec3 tDetailN;
float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
// the painted woods beyond the square (the same mask as procF below), sampled anywhere
float tWoodAt( vec2 q, float fShift ) {
  float a1 = texture2D( uNoise, q * 0.00093 + vec2( 0.13, 0.71 ) ).r;
  float a2 = texture2D( uNoise, q * 0.0041 + vec2( 0.37, 0.19 ) ).g;
  float a3 = texture2D( uNoise, q * 0.019 ).b;
  float aF = texture2D( uNoise, mat2( 0.8, -0.6, 0.6, 0.8 ) * q * 0.00041 + vec2( 0.31, 0.87 ) ).r;
  return smoothstep( 0.6 - fShift, 0.7 - fShift, ( aF * 0.55 + a1 * 0.45 ) * 0.6 + a2 * 0.4 + ( a3 - 0.5 ) * 0.09 );
}
`,
      )
      .replace(
        '#include <map_fragment>',
        `
{
  vec2 p = vWPos.xz;
  float camDist = length( vWPos - cameraPosition );
  float m1 = texture2D( uNoise, p * 0.00093 + vec2( 0.13, 0.71 ) ).r;
  float m2 = texture2D( uNoise, p * 0.0041 + vec2( 0.37, 0.19 ) ).g;
  float m3 = texture2D( uNoise, p * 0.019 ).b;
  float d1 = texture2D( uNoise, mat2( 0.8, -0.6, 0.6, 0.8 ) * p * 0.121 ).a;
  float d2 = texture2D( uNoise, p * 0.43 + vec2( 0.5 ) ).g;
  float d3 = texture2D( uNoise, p * 1.37 + vec2( 0.21, 0.77 ) ).b;
  float nearF = 1.0 - smoothstep( 25.0, 220.0, camDist );
  float farF = smoothstep( 260.0, 1400.0, camDist );

  // ---- masks
  vec2 fuv = ( p - uFineO ) / uFineS;
  vec2 fe = min( fuv, 1.0 - fuv );
  float inFine = smoothstep( 0.0, 0.015, min( fe.x, fe.y ) );
  vec4 mf = texture2D( uMaskFine, clamp( fuv, 0.001, 0.999 ) );
  vec2 cuv = ( p - uSqO ) / uSqS;
  vec2 ce = min( cuv, 1.0 - cuv );
  float inSq = smoothstep( 0.0, 0.03, min( ce.x, ce.y ) );
  vec4 mc = texture2D( uMaskCoarse, clamp( cuv, 0.001, 0.999 ) );
  // outside the square: procedural woods + farmland. Steep ground is wooded first (nobody ploughs
  // a valley side), woods have ragged edges and spurs, and the venue sets how wooded it all is
  float slopeT = 1.0 - clamp( normalize( vWNormal ).y, 0.0, 1.0 );
  float fShift = uForestCover + smoothstep( 0.03, 0.2, slopeT ) * 0.32;
  // (m1 repeats every ~1 km: out here, where nothing has to line up with placed trees or houses,
  // a rotated 2.4 km octave is mixed in so the woods and towns never fall into a visible lattice)
  float mF = texture2D( uNoise, mat2( 0.8, -0.6, 0.6, 0.8 ) * p * 0.00041 + vec2( 0.31, 0.87 ) ).r;
  float mFar = mF * 0.55 + m1 * 0.45;
  float procF = smoothstep( 0.6 - fShift, 0.7 - fShift, mFar * 0.6 + m2 * 0.4 + ( m3 - 0.5 ) * 0.09 );
  float coarseForest = mix( procF * 0.92, mc.r, inSq );
  float park = mix( 0.0, mc.g, inSq );
  float forest = mix( coarseForest * 0.9, clamp( mf.r * 1.25, 0.0, 1.0 ), inFine );
  // track-aligned: R mowing band, G verge, B run-off wear (parkmask.ts)
  vec4 mt = texture2D( uMaskTrack, clamp( fuv, 0.001, 0.999 ) ) * inFine;
  float verge = mt.g;
  float lawn = max( mf.g * inFine, verge );
  float gravel = mf.b * inFine;
  float paved = mf.a * inFine;

  // ---- grass: rough September meadow ↔ mown lawn with stripes
  // very large scale: whole fields drift between fresh green, blue-green and sun-bleached
  float m0 = texture2D( uNoise, p * 0.00031 + vec2( 0.61, 0.27 ) ).g;
  float hueF = ( m0 - 0.5 ) * 2.0;
  vec3 macroTint = vec3( 1.0 + 0.1 * hueF, 1.0 + 0.02 * hueF, 1.0 - 0.14 * hueF ) * ( 0.94 + 0.12 * m1 );
  float dry = smoothstep( 0.38, 0.78, m2 * 0.55 + m3 * 0.45 );
  vec3 meadow = mix( uMeadow, uStraw, dry * 0.75 );
  meadow = mix( meadow, uGrassDark, smoothstep( 0.55, 0.85, d1 ) * 0.4 );
  // clumps of darker, lusher tussock and pale seed heads
  meadow = mix( meadow, uGrassDark * 0.85, smoothstep( 0.62, 0.8, d2 ) * 0.35 * ( 0.4 + 0.6 * nearF ) );
  meadow = mix( meadow, uStraw * 1.1, smoothstep( 0.78, 0.92, d3 ) * 0.25 * nearF );
  meadow *= 0.86 + 0.26 * d2 * ( 0.5 + 0.5 * nearF ) + 0.08 * m1;
  // from a height unmown grassland is a mosaic, not a carpet: darker tussocky stands and bramble,
  // paler dry swards on the thin soil, with fairly crisp edges between them
  {
    float mos = smoothstep( 0.47, 0.6, m3 * 0.6 + m2 * 0.4 );
    meadow = mix( meadow, meadow * vec3( 0.74, 0.8, 0.76 ), mos * ( 0.2 + 0.35 * farF ) );
    float pale = smoothstep( 0.6, 0.72, m2 * 0.5 + m1 * 0.3 + d1 * 0.2 );
    meadow = mix( meadow, mix( meadow, uStraw, 0.55 ), pale * ( 0.15 + 0.3 * farF ) );
  }
  vec3 lawnC = uLawn * ( 0.88 + 0.16 * m3 + 0.06 * d1 );
  // lawns: slightly patchy (clover, drier crowns where the soil is thin)
  lawnC = mix( lawnC, mix( uLawn, uStraw, 0.4 ), smoothstep( 0.6, 0.85, m2 * 0.6 + d1 * 0.4 ) * 0.35 );
  lawnC = mix( lawnC, uGrassDark, smoothstep( 0.6, 0.9, d2 ) * 0.18 );
  {
    // mowing stripes: the mower follows long gentle curves (the direction varies smoothly,
    // no seams), the contrast is the light/dark of grass laid toward and away from the eye
    // one direction per venue (a direction varying with position swirls: the stripe phase is dot(p, dir))
    float ang = 0.35 + fract( uCenter.x * 0.00137 + uCenter.y * 0.00071 ) * 3.0;
    vec2 dir = vec2( cos( ang ), sin( ang ) );
    float u = dot( p, dir ) / 6.2 + m2 * 0.8;
    float aa = fwidth( u );
    float st = smoothstep( 0.5 - aa * 1.5, 0.5 + aa * 1.5, abs( fract( u ) - 0.5 ) * 2.0 );
    // how the laid blades read depends on which way we look along the stripe
    vec3 vdir = normalize( vWPos - cameraPosition );
    float along = abs( dot( normalize( vdir.xz + 1e-4 ), dir ) );
    float amp = 0.045 + 0.035 * along;
    // along the circuit the verges are mown in bands across the track, following every curve
    float stT = smoothstep( 0.3, 0.7, mt.r / max( verge, 0.05 ) );
    st = mix( st, stT, verge );
    amp = mix( amp, 0.075, verge );
    lawnC *= mix( 1.0, mix( 1.0 - amp, 1.0 + amp, st ), ( 1.0 - smoothstep( 0.2, 0.55, aa ) * ( 1.0 - verge ) ) * ( 1.0 - farF ) );
    // white clover patches in the sward, a bluer, darker green
    float clover = smoothstep( 0.64, 0.72, d1 * 0.55 + m3 * 0.45 ) * ( 0.5 + 0.5 * nearF );
    lawnC = mix( lawnC, lawnC * vec3( 0.86, 0.98, 0.95 ), clover * 0.6 );
  }
  meadow *= macroTint;
  lawnC *= mix( vec3( 1.0 ), macroTint, 0.6 );
  vec3 grass = mix( meadow, lawnC, lawn );
  // run-off wear: where cars run wide the grass is scuffed, dusty and dry
  float wear = mt.b * smoothstep( 0.35, 0.7, d1 * 0.5 + d2 * 0.5 + mt.b * 0.3 );
  grass = mix( grass, mix( uStraw, uEarth, 0.5 ) * ( 0.85 + 0.2 * d3 ), wear * 0.7 );
  // hollows in the verge where rain stands: flattened, muddy grass (puddles when wet)
  float mudK = verge * smoothstep( 0.74, 0.8, d1 * 0.6 + m2 * 0.4 );
  grass = mix( grass, uEarth * 0.55, mudK * 0.55 );
  // wild flowers: daisies and clover heads in the lawns, buttercups and knapweed in meadow
  float fFade = 1.0 - smoothstep( 7.0, 28.0, camDist );
  if ( fFade > 0.0 ) {
    vec2 fc = p * 2.6;
    vec2 fi = floor( fc );
    vec2 ff = fract( fc ) - 0.5;
    float fh = h21( fi );
    float fk = h21( fi + 5.3 );
    vec2 fo = vec2( h21( fi + 1.7 ), h21( fi + 4.1 ) ) - 0.5;
    float dens = mix( 0.1, 0.035, lawn ) * smoothstep( 0.3, 0.7, m3 * 0.6 + d1 * 0.4 ) * ( 1.0 - forest ) * ( 1.0 - wear );
    float disc = 1.0 - smoothstep( 0.05, 0.1, length( ff - fo * 0.7 ) );
    vec3 fcol = fk < 0.55 ? vec3( 0.78, 0.78, 0.72 ) : fk < 0.82 ? vec3( 0.8, 0.62, 0.06 ) : vec3( 0.42, 0.22, 0.5 );
    grass = mix( grass, fcol, step( fh, dens ) * disc * fFade );
  }
  // trampled / worn grass near paths and stands
  float worn = smoothstep( 0.02, 0.3, gravel ) * ( 1.0 - smoothstep( 0.5, 0.9, gravel ) );
  grass = mix( grass, uEarth * ( 0.8 + 0.3 * d2 ), worn * 0.6 );

  // ---- forest floor: leaf litter, moss, bare soil, fallen yellow leaves
  vec3 floorC = mix( uLitter, uLitterDark, smoothstep( 0.3, 0.8, d1 ) );
  floorC = mix( floorC, uMoss, smoothstep( 0.55, 0.8, m3 ) * 0.55 );
  floorC *= 0.8 + 0.35 * d2;
  float fleck = step( 0.82, d3 ) * nearF;
  floorC = mix( floorC, vec3( 0.42, 0.28, 0.07 ), fleck * 0.5 );
  // from afar the woods read as canopy, not floor: clumps of crowns (lit tops, shaded gaps),
  // darker blue-green conifer blocks among the broadleaf, a few yellowing or bronze crowns
  {
    float conifer = smoothstep( 0.52, 0.6, m1 * 0.5 + m0 * 0.5 );
    vec3 canopyC = mix( uCanopy, uCanopy * vec3( 0.66, 0.78, 0.86 ), conifer );
    // (as dark as the real trees nearer in: a canopy is mostly shadow seen from above)
    canopyC *= 0.48 + 0.36 * m3 + 0.2 * ( m2 - 0.5 ) + 0.16 * d1;
    canopyC = mix( canopyC, canopyC * vec3( 1.35, 1.15, 0.7 ), smoothstep( 0.7, 0.9, d2 ) * 0.4 * ( 1.0 - conifer ) );
    floorC = mix( floorC, canopyC, farF * ( 1.0 - inFine * 0.4 ) );
  }
  vec3 col = mix( grass, floorC, forest );
#if defined( USE_FOG ) && NUM_DIR_LIGHTS > 0
  // the painted woods beyond the square stand ~20 m tall: they throw a shadow out over the fields
  // on the side away from the sun (and the 3D trees inside the square throw their own), so from a
  // TV tower or a hillside a wood reads as a mass with height, not a stain on the ground
  {
    vec2 sxz = aerialSunDir.xz;
    float sl = length( sxz );
    float sunK = smoothstep( 0.4, 2.0, dot( directionalLights[ 0 ].color, vec3( 0.2126, 0.7152, 0.0722 ) ) );
    if ( inSq < 0.99 && sl > 0.05 && aerialSunDir.y > 0.03 && sunK > 0.01 ) {
      float L = clamp( 20.0 * sl / aerialSunDir.y, 10.0, 110.0 );
      float wSun = max( tWoodAt( p + sxz / sl * L * 0.55, fShift ), tWoodAt( p + sxz / sl * L, fShift ) ) * 0.92;
      col *= 1.0 - 0.5 * sunK * clamp( ( wSun - coarseForest ) * 1.5, 0.0, 1.0 ) * ( 1.0 - inSq );
    }
  }
#endif

  // ---- outside the park: towns ringing the park wall, farmland and copses beyond
  float rc = length( p - uCenter );
  float procUrban = ( 1.0 - smoothstep( 3500.0, 7000.0, rc ) ) * smoothstep( 0.55, 0.7, mFar * 0.7 + m2 * 0.3 ) + smoothstep( 0.68, 0.8, mFar ) * 0.7;
  procUrban = mix( procUrban, smoothstep( 0.3, 0.42, m1 * 0.55 + m2 * 0.45 ), uCity );
  float urban = mix( procUrban * ( 1.0 - park ), mc.b, inSq ) * ( 1.0 - inFine * 0.0 );
  float mtn = smoothstep( 90.0, 320.0, vWPos.y );
  float farm = ( 1.0 - park ) * ( 1.0 - forest ) * ( 1.0 - urban ) * ( 1.0 - mtn );
  if ( farm > 0.01 ) {
    vec2 wp = p + ( vec2( m1, m2 ) - 0.5 ) * 260.0;
    // metres per pixel across the field grid (grazing views: the long axis of the footprint)
    float rpx = max( length( fwidth( wp ) ), 0.05 );
    vec2 fs = vec2( 320.0, 210.0 );
    vec2 cell = floor( wp / fs );
    float h1 = h21( cell );
    float h2 = h21( cell + 17.3 );
    vec2 fc = fract( wp / fs );
    float edge = smoothstep( 0.0, 0.02, min( min( fc.x, 1.0 - fc.x ), min( fc.y, 1.0 - fc.y ) ) );
    // (the hedged grid is shared with the hedgerow trees, textures.fieldWarp) — some parcels are
    // split by a plain fence into two crops, so the patchwork never reads as one repeated tile
    float h3 = h21( cell + 5.9 );
    float fence = 1.0;
    if ( h3 < 0.48 ) {
      float sp = 0.3 + 0.4 * h21( cell + 8.1 );
      float t = h3 < 0.24 ? fc.x : fc.y;
      float side = step( sp, t );
      h1 = fract( h1 + side * 0.381 );
      h2 = fract( h2 + side * 0.537 );
      fence = smoothstep( 0.0, 0.008, abs( t - sp ) );
    }
    // late summer: pasture, golden stubble with straw swaths, deep-green maize, ploughed earth,
    // pale hay — distinct enough that the patchwork reads from the ground, not one green plain;
    // muted as a lens sees them (no bright yellow squares)
    float fa = floor( h2 * 4.0 ) * 0.785 + 0.2;
    float fu = dot( p, vec2( cos( fa ), sin( fa ) ) );
    float furA = 1.0 - smoothstep( 0.2, 0.7, fwidth( fu / 1.6 ) );
    float furrow = ( 0.5 + 0.5 * sin( fu / 1.6 * 6.2832 ) ) * furA;
    float swA = 1.0 - smoothstep( 0.2, 0.7, fwidth( fu / 9.0 ) );
    float swath = smoothstep( 0.8, 0.95, abs( fract( fu / 9.0 ) - 0.5 ) * 2.0 ) * swA;
    // tramlines: the sprayer's wheel tracks every 24 m, visible from a helicopter
    float trA = 1.0 - smoothstep( 0.15, 0.5, fwidth( fu / 24.0 ) );
    float tram = smoothstep( 0.965, 0.99, abs( fract( fu / 24.0 ) - 0.5 ) * 2.0 ) * trA;
    vec3 fieldCol;
    if ( h1 < uPasture ) {
      // grazing: greens of several ages, darker tussocks and dung patches, a worn gateway corner
      float g = h1 / max( uPasture, 0.01 );
      fieldCol = mix( mix( uMeadow, uLawn, 0.5 ), mix( uMeadow, uGrassDark, 0.45 ), g ) * ( 0.92 + 0.16 * m3 );
      fieldCol = mix( fieldCol, uGrassDark * 0.85, smoothstep( 0.6, 0.85, d2 ) * 0.3 );
      fieldCol = mix( fieldCol, mix( uStraw, uMeadow, 0.5 ), smoothstep( 0.65, 0.9, m2 * 0.5 + d1 * 0.5 ) * 0.35 );
    } else {
      float a = ( h1 - uPasture ) / max( 1.0 - uPasture, 0.01 );
      if ( a < 0.3 ) fieldCol = mix( mix( uStraw, uMeadow, 0.28 ) * 0.92, uStraw * 1.08, swath * 0.6 );
      else if ( a < 0.5 ) fieldCol = mix( uLawn, uGrassDark, 0.6 ) * ( 0.84 + 0.12 * furrow );
      else if ( a < 0.66 ) fieldCol = mix( uEarth * 0.6, uEarth * 0.42, furrow * 0.8 );
      else if ( a < 0.86 ) fieldCol = mix( uStraw, uMeadow, 0.45 ) * ( 0.93 + 0.08 * swath );
      else fieldCol = mix( uMeadow, uLawn, 0.25 ) * 1.02;
      fieldCol *= 1.0 - 0.1 * tram;
    }
    // soil and moisture: every field is patchy at 50–200 m (wet hollows greener, thin crowns paler)
    fieldCol *= ( 0.9 + 0.16 * d1 ) * ( 0.9 + 0.18 * m3 ) * ( 0.95 + 0.1 * m2 );
    // field margins: a darker strip of rough grass and hedge bottom; a fence line between crops
    // (a hedge a few metres wide is a hit-or-miss sample once a pixel spans more than that: far off
    // it becomes its share of the field, a slightly darker tone, not dark speckle and streaks)
    float hedgeK = mix( 1.0 - edge, 0.07, smoothstep( 3.0, 10.0, rpx ) );
    fieldCol = mix( fieldCol, uGrassDark * 0.6, hedgeK );
    fieldCol = mix( mix( uGrassDark, uMeadow, 0.5 ), fieldCol, 1.0 - ( 1.0 - fence ) * ( 1.0 - smoothstep( 2.0, 6.0, rpx ) ) );
    // country lanes beyond the square (no placed hedgerow trees out there to stand on them): some
    // runs of the hedged boundaries carry a narrow road with pale verges, so from a height and down
    // a long lens the patchwork is threaded with lanes running off between the villages. A lane
    // runs for a few parcels, then stops at a junction; once it is thinner than a pixel it fades to
    // its share of the pixel instead of aliasing into dashes.
    if ( inSq < 0.99 ) {
      vec2 fm = fc * fs;
      float hx0 = h21( vec2( cell.x, floor( cell.y / 5.0 ) ) + 41.7 ), hx1 = h21( vec2( cell.x + 1.0, floor( cell.y / 5.0 ) ) + 41.7 );
      float hz0 = h21( vec2( floor( cell.x / 4.0 ), cell.y ) + 63.1 ), hz1 = h21( vec2( floor( cell.x / 4.0 ), cell.y + 1.0 ) + 63.1 );
      float dl = min( min( hx0 < 0.2 ? fm.x : 1e4, hx1 < 0.2 ? fs.x - fm.x : 1e4 ), min( hz0 < 0.16 ? fm.y : 1e4, hz1 < 0.16 ? fs.y - fm.y : 1e4 ) );
      float lane = ( 1.0 - smoothstep( 3.0 - rpx * 0.5, 3.0 + rpx * 0.5, dl ) ) * min( 1.0, 6.0 / rpx );
      float lverge = ( 1.0 - smoothstep( 6.5 - rpx * 0.5, 6.5 + rpx * 0.5, dl ) ) * min( 1.0, 13.0 / rpx ) - lane;
      fieldCol = mix( fieldCol, mix( uStraw, uMeadow, 0.5 ) * 1.05, max( lverge, 0.0 ) * 0.7 * ( 1.0 - inSq ) );
      fieldCol = mix( fieldCol, uAsphalt * ( 0.95 + 0.15 * d1 ), lane * ( 1.0 - inSq ) );
    }
    // once a parcel is only a few pixels deep the patchwork, its hedges and lanes alias into streaks
    // (a ruled-paper horizon): it fades to the parcels' mean, still drifting at the kilometre scale
    // between greener grazing and paler stubble, so the far plain keeps a tone without the moire
    vec3 fieldMean = mix( mix( uMeadow, uLawn, 0.3 ), mix( uStraw, uMeadow, 0.45 ), clamp( 1.0 - uPasture + ( m1 - 0.5 ) * 0.8, 0.0, 1.0 ) ) * ( 0.88 + 0.2 * mF );
    fieldCol = mix( fieldCol, fieldMean, smoothstep( 80.0, 220.0, rpx ) );
    col = mix( col, fieldCol, farm );
  }
  // towns: blocks of terracotta and grey roofs, streets, courtyards
  if ( urban > 0.01 ) {
    float ang = floor( m1 * 4.0 ) * 0.4 + 0.2;
    mat2 rot = mat2( cos( ang ), -sin( ang ), sin( ang ), cos( ang ) );
    vec2 q = rot * p;
    vec2 bs = vec2( 64.0, 46.0 );
    vec2 bc = floor( q / bs );
    vec2 bf = fract( q / bs ) * bs;
    float street = 1.0 - step( 7.0, bf.x ) * step( 7.0, bf.y );
    vec2 lc = floor( ( bf - 7.0 ) / vec2( 14.0, 13.0 ) );
    float hb = h21( bc * 7.1 + lc );
    vec3 roof = hb < 0.55 ? uRoof * ( 0.8 + 0.4 * h21( lc + bc ) ) : hb < 0.82 ? vec3( 0.26, 0.25, 0.24 ) : vec3( 0.55, 0.53, 0.5 );
    // pitched roofs: light/dark halves
    roof *= 0.82 + 0.3 * step( 0.5, fract( ( bf.y - 7.0 ) / 13.0 ) );
    vec3 yard = mix( uLawn, uGrassDark, 0.4 ) * ( 0.8 + 0.3 * d1 );
    vec3 townC = h21( bc + lc * 3.3 ) < uTownYard ? yard : roof;
    // (garden villages: the lanes are faint tracks between the plots, not a street grid)
    townC = mix( townC, vec3( 0.22, 0.22, 0.23 ), street * ( uTownYard > 0.5 ? 0.3 : 1.0 ) );
    col = mix( col, townC, urban * ( 1.0 - forest * 0.6 ) );
  }
  // mountains: wooded slopes, bare rock and scree higher up
  if ( mtn > 0.01 ) {
    // dark conifer and beech forest on the slopes (crowns lit and shaded like the woods below),
    // alpine pasture and hay meadows in the clearings on the gentler ground and the shoulders: the
    // mosaic that gives a hillside 10 km off its shape through the haze, not one green felt
    float woodK = smoothstep( 0.42, 0.58, mFar * 0.45 + m2 * 0.3 + m3 * 0.1 + slopeT * 1.4 + uForestCover * 0.6 );
    float conifer = smoothstep( 0.45, 0.6, m1 * 0.5 + m0 * 0.5 );
    vec3 wood = mix( uCanopy, uCanopy * vec3( 0.66, 0.78, 0.86 ), conifer ) * ( 0.5 + 0.38 * m3 + 0.18 * d1 + 0.12 * ( m2 - 0.5 ) );
    vec3 alp = mix( mix( uMeadow, uLawn, 0.45 ), uStraw, smoothstep( 0.55, 0.8, m3 ) * 0.4 ) * ( 0.9 + 0.2 * d1 );
    vec3 rockC = mix( vec3( 0.32, 0.3, 0.28 ), vec3( 0.46, 0.44, 0.4 ), m3 );
    vec3 mcol = mix( mix( alp, wood, woodK ), rockC, smoothstep( 700.0, 1150.0, vWPos.y + ( m2 - 0.5 ) * 300.0 ) );
    col = mix( col, mcol, mtn );
    tWood = woodK * mtn;
  }

  // ---- arid ground (TERRAIN_PALETTES.arid): sand drifts with wind ripples, gravel pans,
  // rock outcrops and sparse scrub. 1 = desert everywhere except irrigated lawns and verges;
  // less = patches (coastal dunes, semi-arid scrubland)
  if ( uArid > 0.01 ) {
    float sandMask = smoothstep( 1.0 - uArid - 0.07, 1.0 - uArid + 0.07, m2 * 0.6 + m1 * 0.4 );
    vec3 sandC = uSand * mix( vec3( 0.94, 0.96, 1.02 ), vec3( 1.06, 1.02, 0.92 ), m2 );
    // compacted, darker sand in hollows; pale wind-blown crests
    sandC = mix( sandC, uSand * 0.74, smoothstep( 0.42, 0.75, m3 ) * 0.6 );
    sandC = mix( sandC, uSand * 1.14, smoothstep( 0.68, 0.9, d1 ) * 0.4 );
    // drift streaks: long bands of wind-sorted sand lying across the prevailing wind
    float streak = sin( dot( p, vec2( 0.55, -0.83 ) ) * 0.045 + m2 * 5.0 ) * 0.5 + 0.5;
    sandC *= mix( 0.9, 1.07, smoothstep( 0.25, 0.85, streak ) );
    // wind ripples: shaded by the low sun (a normal wobble) as well as tinted
    float ripPh = dot( p, vec2( 0.83, 0.55 ) ) * 3.3 + d2 * 7.0;
    float rip = sin( ripPh );
    sandC *= 1.0 + 0.08 * rip * nearF;
    tRipple = vec3( 0.83, 0.0, 0.55 ) * cos( ripPh ) * 0.22 * nearF;
    // desert pavement: gravel pans of dark stones
    vec3 pan = mix( uRock * 0.9, uSand * 0.72, d3 );
    sandC = mix( sandC, pan, smoothstep( 0.56, 0.7, m1 * 0.6 + d1 * 0.4 ) * 0.55 );
    // rock outcrops
    float rockK = smoothstep( 0.7, 0.8, m1 * 0.5 + m3 * 0.5 );
    sandC = mix( sandC, uRock * ( 0.75 + 0.45 * d2 ), rockK );
    // sparse scrub tufts
    float scrub = step( 0.84, d3 ) * smoothstep( 0.4, 0.62, m2 ) * ( 1.0 - rockK );
    sandC = mix( sandC, vec3( 0.12, 0.11, 0.06 ), scrub * 0.55 * ( 0.35 + 0.65 * nearF ) );
    // from a height a desert is never one tone: kilometre-wide sheets of pale wind-blown sand over
    // darker grey-brown gravel plains (reg), and wadis where the scrub gathers along a winding line
    float sheet = smoothstep( 0.4, 0.62, m0 * 0.6 + m1 * 0.4 );
    sandC *= mix( vec3( 0.74, 0.73, 0.75 ), vec3( 1.06, 1.03, 0.97 ), sheet );
    float wadiU = ( m1 * 0.7 + m0 * 0.3 ) * 9.0;
    float wadi = 1.0 - smoothstep( -0.06, 0.05 + fwidth( wadiU ) * 1.5, abs( fract( wadiU ) - 0.5 ) - 0.4 );
    wadi *= ( 1.0 - smoothstep( 0.25, 0.6, fwidth( wadiU ) ) ) * ( 0.55 + 0.45 * d2 );
    // (a soft bed of darker, coarser sand, dotted with scrub)
    vec3 wadiC = mix( uSand * 0.78, uRock * 0.8, 0.4 );
    wadiC = mix( wadiC, vec3( 0.12, 0.11, 0.06 ), step( 0.72, d3 ) * 0.5 );
    sandC = mix( sandC, wadiC, wadi * 0.35 );
    // vehicle tracks: pale, winding, criss-crossing the plain (the contours of two slow noises)
    float tkU = m2 * 7.0 + m1 * 3.0;
    float tkW = fwidth( tkU );
    float tk = ( 1.0 - smoothstep( 0.0, 0.012 + tkW, abs( fract( tkU ) - 0.5 ) - 0.47 ) ) * ( 1.0 - smoothstep( 0.15, 0.45, tkW ) );
    tk *= step( 0.5, h21( floor( vec2( tkU, m0 * 3.0 ) ) ) );
    sandC = mix( sandC, uSand * 1.12, tk * 0.5 * ( 1.0 - rockK ) );
    float aridK = sandMask * ( 1.0 - lawn ) * ( 1.0 - smoothstep( 0.3, 0.7, paved ) ) * ( 1.0 - urban * 0.7 );
    col = mix( col, sandC, aridK );
    tAridK = aridK;
    tRipple *= aridK;
  }

  // ---- paths and paving
  vec3 grav = mix( uGravel, uGravelDark, d1 * 0.6 + m3 * 0.4 ) * ( 0.88 + 0.24 * d3 );
  col = mix( col, grav, smoothstep( 0.35, 0.75, gravel ) );
  vec3 asph = uAsphalt * ( 0.82 + 0.3 * d1 ) * ( 0.94 + 0.12 * d3 );
  float pv = smoothstep( 0.3, 0.7, paved );
  col = mix( col, asph, pv );

  // ---- rain: darker, glossier, puddles on paths / paving / hollows
  float wet = uWetness;
  float soil = max( max( gravel, pv ), forest * 0.6 );
  col *= mix( 1.0, mix( 0.8, 0.58, soil ), wet );
  float pud = smoothstep( 0.6, 0.66, d1 * 0.55 + m3 * 0.45 + wet * 0.22 ) * smoothstep( 0.3, 0.9, wet );
  pud *= max( smoothstep( 0.4, 0.8, gravel ), pv * 0.9 ) + 0.25 * lawn * step( 0.72, m2 ) + mudK * 1.4;
  col = mix( col, col * 0.32 + vec3( 0.004 ), pud );

  diffuseColor.rgb *= col;
  // sky occlusion: under the canopy the ground sees little sky (and the trees' own green bounce)
  tAO = 1.0 - 0.6 * clamp( forest * 1.2, 0.0, 1.0 ) * ( 1.0 - farF * 0.5 );
  tRough = mix( 0.93, 0.97, forest );
  tRough = mix( tRough, 0.86, lawn * ( 1.0 - forest ) );
  tRough = mix( tRough, 0.82, pv );
  tRough = mix( tRough, tRough * mix( 0.75, 0.45, soil ), wet );
  tRough = mix( tRough, 0.06, pud );
  float dStr = nearF * ( 0.6 + 0.4 * ( 1.0 - pv ) ) * ( 1.0 - pud );
  vec3 dn1 = texture2D( uDetailN, p * 0.31 ).rgb * 2.0 - 1.0;
  vec3 dn2 = texture2D( uDetailN, mat2( 0.6, 0.8, -0.8, 0.6 ) * p * 0.083 ).rgb * 2.0 - 1.0;
  tDetailN = vec3( dn1.x + dn2.x * 0.8, 0.0, dn1.y + dn2.y * 0.8 ) * ( 0.45 + 0.35 * forest ) * dStr + tRipple * ( 1.0 - pud );
  // a painted canopy seen from afar: crowns ~20 m across, sunlit on one side and shaded on the other,
  // so the woods have texture and relief in the light instead of one flat green (mipmapped: it
  // averages away smoothly where the crowns are smaller than a pixel)
  vec3 cn = texture2D( uDetailN, mat2( 0.8, 0.6, -0.6, 0.8 ) * p * 0.047 + vec2( 0.3, 0.6 ) ).rgb * 2.0 - 1.0;
  tDetailN += vec3( cn.x, 0.0, cn.y ) * 0.9 * max( forest, tWood ) * farF * ( 1.0 - pud );
  // the far mesh is 256 m (16 m in the square): spurs, gullies, folds and banks smaller than that are
  // a relief in the shading only — a height (m) from the same noise octaves, its gradient across the
  // pixel quad tilting the normal (as on the horizon ring). Strongest on hillsides and mountains,
  // a gentle roll on the plain; nothing near the camera, where the mesh carries the real shape
  {
    float relK = farF * ( 0.3 + 0.7 * max( mtn, smoothstep( 0.04, 0.2, slopeT ) ) ) * ( 1.0 - inFine * 0.7 );
    // (each octave fades out before it is under ~3 px: on the foreshortened slopes near a far
    // crest a sub-pixel octave's gradient would only be noise — glitter on the skyline)
    float mpp = length( fwidth( vWPos.xz ) );
    float H = ( ( mF - 0.5 ) * 110.0 * ( 1.0 - smoothstep( 300.0, 700.0, mpp ) ) + ( m1 - 0.5 ) * 60.0 * ( 1.0 - smoothstep( 120.0, 300.0, mpp ) ) + ( m2 - 0.5 ) * 16.0 * ( 1.0 - smoothstep( 30.0, 80.0, mpp ) ) ) * relK;
    vec3 n0 = normalize( vWNormal );
    vec3 dpx = dFdx( vWPos ), dpy = dFdy( vWPos );
    vec3 r1 = cross( dpy, n0 ), r2 = cross( n0, dpx );
    float det = dot( dpx, r1 );
    vec3 grad = sign( det ) * ( dFdx( H ) * r1 + dFdy( H ) * r2 );
    vec3 nr = normalize( abs( det ) * n0 - grad );
    vec3 dn = nr - n0;
    if ( abs( det ) > 1e-6 ) tDetailN += dn * min( 1.0, 0.55 / max( length( dn ), 1e-4 ) ) * ( 1.0 - pud );
  }
  // rain rings in the puddles
  if ( pud > 0.01 && uRain > 0.01 ) {
    vec2 rp = p * 1.6;
    vec2 ci = floor( rp );
    vec2 cf = fract( rp ) - 0.5;
    float ph = fract( uWTime * 0.9 + h21( ci ) );
    float r = length( cf - ( vec2( h21( ci + 3.1 ), h21( ci + 7.7 ) ) - 0.5 ) * 0.4 );
    float ring = sin( ( r - ph * 0.5 ) * 60.0 ) * smoothstep( 0.5, 0.0, r ) * ( 1.0 - ph );
    tDetailN += vec3( cf.x, 0.0, cf.y ) * ring * 0.9 * pud * uRain;
  }
}
`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = tRough;`)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
reflectedLight.indirectDiffuse *= tAO * mix( vec3( 1.0 ), vec3( 0.9, 1.05, 0.8 ), 1.0 - tAO );
reflectedLight.indirectSpecular *= tAO * tAO;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 nW = normalize( vWNormal + tDetailN );
  normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
}`,
      );
  };
  material.customProgramCacheKey = () => 'apex-park-terrain-v10';
  return { material, uniforms };
}

interface GridSource {
  heights: Float32Array;
  W: number;
  H: number;
  x0: number;
  z0: number;
  cell: number;
}

function buildChunk(
  map: WorldMap,
  g: GridSource,
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  skipCell: (x: number, z: number) => boolean,
  skirt: { x0?: boolean; x1?: boolean; z0?: boolean; z1?: boolean },
): THREE.BufferGeometry | null {
  const nx = i1 - i0 + 1;
  const nz = j1 - j0 + 1;
  const vcount = nx * nz;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const C = g.cell;
  const hAt = (i: number, j: number) => {
    if (i >= 0 && j >= 0 && i < g.W && j < g.H) return g.heights[j * g.W + i];
    return map.height(g.x0 + i * C, g.z0 + j * C);
  };
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const v = (j - j0) * nx + (i - i0);
      pos[v * 3] = g.x0 + i * C;
      pos[v * 3 + 1] = g.heights[j * g.W + i];
      pos[v * 3 + 2] = g.z0 + j * C;
      const hx = hAt(i + 1, j) - hAt(i - 1, j);
      const hz = hAt(i, j + 1) - hAt(i, j - 1);
      const L = Math.hypot(hx, 2 * C, hz);
      nor[v * 3] = -hx / L;
      nor[v * 3 + 1] = (2 * C) / L;
      nor[v * 3 + 2] = -hz / L;
    }
  const idx: number[] = [];
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      const x = g.x0 + (i + 0.5) * C, z = g.z0 + (j + 0.5) * C;
      if (skipCell(x, z)) continue;
      const a = (j - j0) * nx + (i - i0);
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx.push(a, d, b, a, c, d);
    }
  if (idx.length === 0) return null;
  const extraPos: number[] = [];
  const extraNor: number[] = [];
  let next = vcount;
  const addSkirt = (verts: number[], flip: boolean) => {
    for (let q = 0; q < verts.length - 1; q++) {
      const va = verts[q], vb = verts[q + 1];
      for (const v of [va, vb]) {
        extraPos.push(pos[v * 3], pos[v * 3 + 1] - 3, pos[v * 3 + 2]);
        extraNor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
      }
      const sa = next++, sb = next++;
      if (flip) idx.push(va, sb, vb, va, sa, sb);
      else idx.push(va, vb, sb, va, sb, sa);
    }
  };
  if (skirt.z0) addSkirt(Array.from({ length: nx }, (_, i) => i), false);
  if (skirt.z1) addSkirt(Array.from({ length: nx }, (_, i) => (nz - 1) * nx + i), true);
  if (skirt.x0) addSkirt(Array.from({ length: nz }, (_, j) => j * nx), true);
  if (skirt.x1) addSkirt(Array.from({ length: nz }, (_, j) => j * nx + nx - 1), false);

  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(pos.length + extraPos.length);
  P.set(pos);
  P.set(extraPos, pos.length);
  const Nn = new Float32Array(nor.length + extraNor.length);
  Nn.set(nor);
  Nn.set(extraNor, nor.length);
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  geo.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export function buildTerrain(map: WorldMap, maxAniso: number): TerrainBuild {
  const { SQUARE, FINE, FAR } = map;
  const group = new THREE.Group();
  group.name = 'Terrain';
  const { material, uniforms } = createTerrainMaterial(maxAniso);
  applyTerrainPalette(uniforms, TERRAIN_PALETTES[map.venue]);

  const addMesh = (geo: THREE.BufferGeometry | null, name: string) => {
    if (!geo) return;
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.receiveShadow = true;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    group.add(m);
  };

  // fine chunks (4 m, 250 cells = 1 km)
  {
    const g: GridSource = { heights: map.fine, W: map.fineW, H: map.fineH, x0: FINE.x0, z0: FINE.z0, cell: FINE_CELL };
    const CH = 250;
    for (let j0 = 0; j0 < g.H - 1; j0 += CH)
      for (let i0 = 0; i0 < g.W - 1; i0 += CH) {
        const i1 = Math.min(i0 + CH, g.W - 1);
        const j1 = Math.min(j0 + CH, g.H - 1);
        addMesh(buildChunk(map, g, i0, j0, i1, j1, () => false, { x0: i0 === 0, x1: i1 === g.W - 1, z0: j0 === 0, z1: j1 === g.H - 1 }), `terrain_fine_${i0}_${j0}`);
      }
  }
  // mid chunks (16 m, 128 cells = 2 km), skipping the fine region
  {
    const g: GridSource = { heights: map.mid, W: map.midW, H: map.midH, x0: SQUARE.x0, z0: SQUARE.z0, cell: MID_CELL };
    const CH = 128;
    const inFine = (x: number, z: number) => x > FINE.x0 && x < FINE.x1 && z > FINE.z0 && z < FINE.z1;
    for (let j0 = 0; j0 < g.H - 1; j0 += CH)
      for (let i0 = 0; i0 < g.W - 1; i0 += CH) {
        const i1 = Math.min(i0 + CH, g.W - 1);
        const j1 = Math.min(j0 + CH, g.H - 1);
        addMesh(buildChunk(map, g, i0, j0, i1, j1, inFine, {}), `terrain_mid_${i0}_${j0}`);
      }
  }
  // far ring (256 m)
  {
    const g: GridSource = { heights: map.far, W: map.farW, H: map.farH, x0: FAR.x0, z0: FAR.z0, cell: FAR_CELL };
    const inSquare = (x: number, z: number) => x > SQUARE.x0 && x < SQUARE.x1 && z > SQUARE.z0 && z < SQUARE.z1;
    addMesh(buildChunk(map, g, 0, 0, g.W - 1, g.H - 1, inSquare, {}), 'terrain_far');
  }
  return {
    group,
    material,
    uniforms,
    setMasks(m: ParkMasks) {
      uniforms.uMaskFine.value = m.fine;
      uniforms.uMaskTrack.value = m.track;
      uniforms.uMaskCoarse.value = m.coarse;
      (uniforms.uFineO.value as THREE.Vector2).set(m.fineBounds.x0, m.fineBounds.z0);
      (uniforms.uFineS.value as THREE.Vector2).set(m.fineBounds.x1 - m.fineBounds.x0, m.fineBounds.z1 - m.fineBounds.z0);
      (uniforms.uSqO.value as THREE.Vector2).set(m.coarseBounds.x0, m.coarseBounds.z0);
      (uniforms.uSqS.value as THREE.Vector2).set(m.coarseBounds.x1 - m.coarseBounds.x0, m.coarseBounds.z1 - m.coarseBounds.z0);
      (uniforms.uCenter.value as THREE.Vector2).set((m.coarseBounds.x0 + m.coarseBounds.x1) / 2, (m.coarseBounds.z0 + m.coarseBounds.z1) / 2);
    },
  };
}
