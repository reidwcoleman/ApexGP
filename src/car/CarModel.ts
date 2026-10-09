/**
 * The hero asset: a fully procedural 2026-style F1 car.
 *
 *   root (place/orient; origin = ground level, mid-wheelbase; +Z forward, +X left)
 *   ├─ body            sprung: hull, wings, floor, halo, driver, cockpit … (game pitches/rolls this)
 *   │   ├─ L0 / L1 / L2   detail groups (merged per material)
 *   │   │   ├─ flap pivot (DRS)      └─ steering pivot (L0)
 *   │   └─ anchors: cockpit, tcam, nose, rearWing, exhaust
 *   ├─ unsprung L0/L1  suspension arms, rear uprights/brakes, rear blur discs
 *   ├─ corners FL FR RL RR
 *   │   └─ steer (fronts) → assembly (upright, disc, caliper, duct) + blur disc + spinFlip → spin → tyre, spokes
 *   └─ wheels L2       all four wheels merged (far LOD)
 *
 * Geometry is built once per detail level and shared by every car; materials are per team/driver.
 */
import { bakeCarAO, withCarAO, CAR_FILL } from './carAO.ts';
import * as THREE from 'three';
import type { Team, Driver } from '../race/Teams.ts';
import { buildCarGeometry, FLAP_PIVOT, FW_FLAP_PIVOT, SUSP_LEGS, STEER_PIVOT, STEER_TILT, HELMET_C, HELMET_R, NECK_PIVOT, PART_IDS, PART_HINGE, type CarGeoLevel, type PartId } from './carGeometry.ts';
import { ARM, ARM_REST, WRIST_LOCAL, solveElbow } from './carHands.ts';
export type { PartId } from './carGeometry.ts';
import { acquireLivery, releaseLivery } from './Livery.ts';
import {
  carbonTextures, wheelTextures, trimShared, trimTexture, driverTexture, fontsLoaded, createDashTexture, sharedDashTexture, wheelFaceTexture,
  acquireGloveTexture, releaseGloveTexture, gloveNormalTexture, helmetLook, type Compound, type DashState,
} from './carTextures.ts';
import { WET_PARS, wetUniforms, wetClearcoatBeads } from './carWet.ts';
import { createTyreMaterial, setTyreCompound, applyTyreLook, wornTyreLook, newTyreLook, type TyreLook, type TyreUniforms } from './carTyres.ts';
import { GRIME_PARS, GRIME_VERT, GRIME_VERT_PARS, grimeShaderUniforms, grimeUniforms, flakeTexture, type GrimeUniforms } from './carGrime.ts';
export type { TyreLook } from './carTyres.ts';
export { newTyreLook } from './carTyres.ts';

export type { Compound } from './carTextures.ts';
import { WHEELBASE, TRACK_F, TRACK_R, WHEEL_R, Z_FRONT_AXLE, Z_REAR_AXLE, CAR_WIDTH, TC, trimUV, DRV_W, DRV_H, R_TCAM_NUM, R_HELM_SPON } from './carLayout.ts';

export type WheelId = 'wFL' | 'wFR' | 'wRL' | 'wRR';

export interface CarRig {
  root: THREE.Group;
  body: THREE.Group;
  setSteer(rad: number): void;
  setWheelSpin(frontRad: number, rearRad: number): void;
  setWheelSpeed(mps: number): void;
  setBrakeGlow(v: number): void;
  /** F1 rain light: when on it blinks (call update); bright HDR LED that blooms */
  setRainLight(on: boolean): void;
  /** current rain-light brightness 0 … 1 (blink phase included) — for glows through spray */
  rainLightLevel(): number;
  /** tyre compound: sidewall band colour + wordmark, grooved tread on inters/wets */
  setCompound(c: Compound): void;
  /** tyre condition per corner (FL FR RL RR): wear, graining, pick-up, blisters, dust, flat spots … */
  setTyres?(looks: readonly TyreLook[]): void;
  /** race grime on the bodywork: road film, rubber flecks, off-track dirt (0 … 1 each) */
  setGrime?(film: number, flecks: number, dirt: number): void;
  setDrs(open: number): void;
  /** the steering wheel's live screen and shift lights (the player's car in the onboard views) */
  setDash?(d: DashState): void;
  /** the steering wheel (turning with setSteer; null below the nearest level): the TAA follows its turn */
  readonly wheel?: THREE.Object3D | null;
  setDetail(level: 0 | 1 | 2): void;
  /** the level of detail shown now (the big screens' feed borrows a nearer one for its own lens) */
  readonly detailLevel: 0 | 1 | 2;
  /**
   * show / hide the driver (hidden for the cameras where his head is, and when he's out of the car).
   * `hands`: keep his gloved hands on the wheel while he's hidden (the onboard cameras inside the cockpit)
   */
  setDriverVisible(v: boolean, hands?: boolean): void;
  /** show / hide the halo's centre pillar (the cockpit camera's "halo column" setting) */
  setHaloPillar?(v: boolean): void;
  /** the driver's head reacts: lateral and longitudinal G (m/s², + = left / accelerating), wheel angle (rad) */
  setG(lateral: number, longitudinal: number, steer: number): void;
  /**
   * Crash damage: bend the wing halves / rear wing by 0..1 (≥ 1 = gone), camber each
   * corner by its suspension damage (FL FR RL RR, 1 = broken), burn the paint (0..1).
   */
  setDamage(parts: Record<PartId, number>, susp: readonly number[], char: number): void;
  /** a copy of a part (or a wheel: 'wFL' …) as it sits on the car right now, in world space — for debris */
  cloneBroken(part: PartId | WheelId): THREE.Object3D;
  /** hide a wheel that came off */
  setWheelLost(w: WheelId, lost: boolean): void;
  /**
   * Pit stop: slide a wheel off its hub along the axle (0 fitted … 1 off; at 1 the
   * wheel is gone from the car, the upright and brake stay). Going back from 1 to 0
   * is a new wheel being pushed on (in the car's current compound).
   */
  setWheelOff(w: WheelId, amount: number): void;
  update(dt: number): void;
  /**
   * Shadow-pass LOD (perf): called with `true` right before the shadow maps render and `false`
   * right after. A car beyond detail 0 (and not broken) then casts one merged far-LOD silhouette
   * instead of ~18 meshes per cascade; the camera pass is untouched.
   */
  shadowPass?(on: boolean, full?: boolean): void;
  /** point the car's reflections at a new environment map (a new circuit's sky) */
  setEnvMap?(tex: THREE.Texture | null): void;
  /** the livery's main colour (linear): what this car looks like in another car's mirrors */
  readonly bodyColor: THREE.Color;
  /** the cars its mirrors show (nearest first, their world matrices current), or null: env only */
  setMirrorCars?(cars: readonly CarRig[] | null): void;
  readonly anchors: {
    cockpit: THREE.Object3D;
    tcam: THREE.Object3D;
    nose: THREE.Object3D;
    rearWing: THREE.Object3D;
    exhaust: THREE.Object3D;
    wheelFL: THREE.Object3D;
    wheelFR: THREE.Object3D;
    wheelRL: THREE.Object3D;
    wheelRR: THREE.Object3D;
    /** centre of the rear rain light (crash-structure tail) */
    rainLight: THREE.Object3D;
    /** the driver's eyes, riding the animated head (the helmet cam) */
    eyes?: THREE.Object3D;
  };
  readonly dims: { wheelbase: number; trackFront: number; trackRear: number; length: number; width: number; wheelRadius: number };
  dispose(): void;
}

/** resolves when the livery fonts are loaded (textures repaint automatically either way) */
export function preloadCarAssets(): Promise<void> {
  return fontsLoaded;
}

// ------------------------------------------------------------------------------------ shared geometry
let GEO: CarGeoLevel[] | null = null;
let geoRefs = 0;
function acquireGeo(): CarGeoLevel[] {
  if (!GEO) {
    GEO = [buildCarGeometry(0), buildCarGeometry(1), buildCarGeometry(2)];
    // ambient occlusion baked into the shared geometry (needs the game's renderer: setCarAORenderer)
    const ms = GEO.map((l) => bakeCarAO(l));
    if (ms[0]) console.info(`[car] AO baked in ${ms.join(' / ')} ms`);
  }
  geoRefs++;
  return GEO;
}
function releaseGeo() {
  if (--geoRefs > 0 || !GEO) return;
  for (const g of SHADOW_GEO) g?.dispose();
  SHADOW_GEO.length = 0;
  for (const l of GEO) {
    const all = [l.body.paint, l.body.carbon, l.body.pillar, l.body.trim, l.body.driver, l.body.decals, l.flap, ...l.fwFlaps, l.steer, l.steerFace, l.steerDash, l.arms, l.unsprung.carbon, l.unsprung.trim,
      l.unsprung.blurRear, l.armUnit, l.frontAssy, l.blurFront, l.wheelF, l.wheelR, l.spokesF, l.spokesR, l.wheelsMerged];
    for (const g of all) g?.dispose();
    for (const k of PART_IDS) for (const g of Object.values(l.parts[k])) g?.dispose();
  }
  GEO = null;
}
export function carTriangles(level: 0 | 1 | 2) {
  return (GEO ?? acquireGeo())[level].triangles;
}

// ------------------------------------------------------------------------------------ shadow proxy
/** every far-LOD shadow-casting mesh of a car merged into one position-only geometry (car space, at rest); shared */
const SHADOW_GEO: (THREE.BufferGeometry | undefined)[] = [];
const SHADOW_MAT = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false });
function shadowGeometry(level: 1 | 2, parts: THREE.Object3D[], root: THREE.Object3D): THREE.BufferGeometry {
  const known = SHADOW_GEO[level];
  if (known) return known;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const pos: number[] = [];
  const idx: number[] = [];
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const p of parts)
    p.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh || !me.castShadow || (o as THREE.InstancedMesh).isInstancedMesh) return;
      const g = me.geometry;
      const pa = g.getAttribute('position');
      if (!pa) return;
      m.multiplyMatrices(inv, me.matrixWorld);
      const base = pos.length / 3;
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i).applyMatrix4(m);
        pos.push(v.x, v.y, v.z);
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < pa.count; i++) idx.push(base + i);
    });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  SHADOW_GEO[level] = g;
  return g;
}

// ------------------------------------------------------------------------------------ shaders
const PAINT_KEY = 'apex-paint-v5';
/**
 * Livery paint: base coat (metallic flake where the livery is metallic) under a clearcoat, exposed
 * carbon where the mask says so (lacquered weave), race grime, rain beads on the clearcoat.
 */
function patchPaint(mat: THREE.MeshPhysicalMaterial, mask: THREE.Texture, carbon: THREE.Texture, grime: GrimeUniforms, flake: number) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.liveryMask = { value: mask };
    sh.uniforms.carbonMap = { value: carbon };
    sh.uniforms.flakeMap = { value: flakeTexture() };
    sh.uniforms.uFlake = { value: flake };
    wetUniforms(sh);
    grimeShaderUniforms(sh, grime);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 cuv;\nvarying vec2 vCuv;\n' + GRIME_VERT_PARS)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCuv = cuv;\n' + GRIME_VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D liveryMask;\nuniform sampler2D carbonMap;\nuniform sampler2D flakeMap;\nuniform float uFlake;\nvarying vec2 vCuv;\n' + WET_PARS + GRIME_PARS)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // the livery's colours as real paint: no pigment reflects 0 % or 100 % (black paint ≈ 2 %, white
        // ≈ 75 %, a racing red ≈ 60 % in its own channel). A screen-pure #dc0000 at 72 % rendered as a
        // neon sign in flat light and a white as a lamp in the sun — the most "CG" thing about a car next
        // to real footage. (Saturation is kept: real reds are that pure; greying them read as salmon pink
        // under the clearcoat's sky sheen.)
        {
          float pl = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          diffuseColor.rgb = 0.012 + mix( vec3( pl ), diffuseColor.rgb, 0.97 ) * 0.82;
        }
        vec4 cMasks = texture2D( liveryMask, vMapUv );
        float cMask = cMasks.r;
        // the cockpit's inside (Livery: the mask's blue over its red): matte black, no lacquer
        float cSeat = max( cMasks.b - cMasks.r, 0.0 );
        // (exposed weave near an onboard lens: its average, as for the carbon parts — see patchCarbon)
        vec3 cw = texture2D( carbonMap, vCuv, 5.0 * ( 1.0 - smoothstep( 0.9, 2.2, length( vViewPosition ) ) ) ).rgb;
        diffuseColor.rgb = mix( diffuseColor.rgb, cw, cMask );
        float cWet = carWetAmount();
        diffuseColor.rgb *= mix( 1.0, mix( 0.9, 0.7, cMask ), cWet );
        vec3 cGr = carGrime( vCuv );
        cGr *= 1.0 - 0.6 * cWet;
        diffuseColor.rgb = carGrimeColour( diffuseColor.rgb, cGr );
        float cGrAll = clamp( cGr.x * 0.8 + cGr.y + cGr.z, 0.0, 1.0 );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.34, cMask );\nroughnessFactor = mix( roughnessFactor, 0.78, cSeat );\nroughnessFactor = mix( roughnessFactor, roughnessFactor * 0.5, cWet );\nroughnessFactor = mix( roughnessFactor, 0.8, cGrAll );',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if ( uFlake > 0.0 ) {
          // metallic flake: tiny tilted mirrors in the base coat (the clearcoat above stays smooth)
          vec2 fuv = vCuv * 0.5;
          vec2 fo = texture2D( flakeMap, fuv ).xy * 2.0 - 1.0;
          mat3 ft = wetTBN( normal, - vViewPosition, fuv );
          // (none resolvable inside an onboard lens's defocus, a metre or two away: it only sparkled as noise there)
          float fNear = 1.0 - smoothstep( 0.9, 2.2, length( vViewPosition ) );
          // (flakes lie nearly flat in the base coat — a spread of a few degrees: at ±17° the planar flake
          // map's stretch over the curved hull showed as brushed-metal streaks on every silver car)
          normal = normalize( ft * vec3( fo * 0.12 * uFlake * ( 1.0 - cMask ) * ( 1.0 - cGrAll ) * ( 1.0 - fNear ), 1.0 ) );
        }`,
      )
      .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n' + wetClearcoatBeads('vCuv', 'cWet'))
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix( metalnessFactor, 0.0, max( max( cMask, cSeat ), cGrAll ) );')
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat = mix( material.clearcoat, 0.85, cMask );
          material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.09, cMask );
          material.clearcoat *= 1.0 - 0.95 * cGr.y;
          material.clearcoat *= 1.0 - cSeat;
          material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.4, clamp( cGr.x * 0.7 + cGr.z, 0.0, 1.0 ) );
          material.clearcoat = mix( material.clearcoat, 1.0, cWet );
          material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.018, cWet );
        #endif
        #ifdef USE_SHEEN
          material.sheenColor *= ( 1.0 - max( cMask, cSeat ) ) * ( 1.0 - cWet );
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => PAINT_KEY;
}

const glslV3 = (v: readonly number[]) => `vec3( ${v.map((x) => x.toFixed(4)).join(', ')} )`;
const glslRect = (r: { x: number; y: number; w: number; h: number }) => `vec4( ${r.x.toFixed(1)}, ${r.y.toFixed(1)}, ${r.w.toFixed(1)}, ${r.h.toFixed(1)} )`;
/**
 * The helmet's livery, drawn per pixel from the shell's own shape (helmet-local position over its
 * ellipsoid) rather than read off the driver sheet: the T-cam has the crown ~30 cm from its lens,
 * filling a third of the frame, where the sheet's 256 texels round the whole shell smeared every
 * edge into a blur. The designs are the painters' staples (Arai / Bell race helmets): a stripe
 * from brow to nape, forward arrows over the crown, a crown cap with a ring, a wave round the
 * shell, twin stripes, a diagonal split — each in the driver's second colour with a fine pinstripe
 * round it, the number printed across the crown (read from behind: the T-cam's view) and the
 * sponsor across the back, in whichever ink reads on the paint under them. Edges are
 * antialiased by their screen-space gradient, so they stay sharp at any distance.
 */
const HELMET_GLSL = /* glsl */ `
varying vec3 vHelmP;
uniform vec3 uHelmA;
uniform vec3 uHelmB;
uniform vec3 uHelmLine;
uniform float uHelmStyle;
const vec3 HELM_C = ${glslV3([HELMET_C[0] - NECK_PIVOT[0], HELMET_C[1] - NECK_PIVOT[1], HELMET_C[2] - NECK_PIVOT[2]])};
const vec3 HELM_R = ${glslV3(HELMET_R)};
float helmAA( float f ) {
  float w = max( fwidth( f ), 1e-4 );
  return smoothstep( -w, w, f );
}
// the design's field over the unit shell direction d (+x left, +y up, +z forward): > 0 is the second colour
float helmField( vec3 d ) {
  // (the crown number's patch is kept clear on the busy designs, so the digits read)
  float plate = max( abs( d.x ) - 0.47, abs( d.z + 0.1 ) - 0.25 );
  float f;
  if ( uHelmStyle < 0.5 ) {
    // a stripe from the brow over the crown to the nape, widening toward the visor
    f = min( 0.2 + 0.06 * d.z - abs( d.x ), d.y + 0.2 );
  } else if ( uHelmStyle < 1.5 ) {
    // arrows pointing forward over the crown
    float tri = abs( fract( ( d.z + 1.2 * abs( d.x ) ) * 1.5 ) - 0.5 );
    f = min( min( 0.16 - tri, d.y - 0.3 ), plate );
  } else if ( uHelmStyle < 2.5 ) {
    // a cap over the crown and a ring below it
    f = max( d.y - 0.78 + 0.05 * d.z, 0.045 - abs( d.y - 0.53 ) );
  } else if ( uHelmStyle < 3.5 ) {
    // a wave round the shell, the second colour above it
    float lon = atan( d.x, d.z );
    f = d.y - ( 0.48 + 0.3 * sin( 2.0 * lon + 0.9 ) + 0.06 * sin( 5.0 * lon ) );
  } else if ( uHelmStyle < 4.5 ) {
    // twin stripes front to back
    f = min( min( 0.075 - abs( abs( d.x ) - 0.28 ), d.y + 0.1 ), plate );
  } else {
    // a diagonal split over the top
    f = min( min( d.x * 0.9 - d.z * 0.4 + 0.12 * sin( 3.0 * d.z + 1.0 ), d.y - 0.05 ), plate );
  }
  return f;
}
vec3 helmPaint( vec3 base, vec3 d ) {
  float f = helmField( d );
  vec3 c = mix( base, uHelmB, helmAA( f ) );
  // the pinstripe just outside the shape
  return mix( c, uHelmLine, helmAA( 0.014 - abs( f + 0.022 ) ) );
}
vec2 helmRectUv( vec4 r, vec2 ab ) {
  ab = clamp( ab, 0.0, 1.0 );
  return vec2( ( r.x + 1.0 + ab.x * ( r.z - 2.0 ) ) / ${DRV_W.toFixed(1)}, 1.0 - ( r.y + r.w - 1.0 - ab.y * ( r.w - 2.0 ) ) / ${DRV_H.toFixed(1)} );
}
// a white-on-black mask from the sheet (sRGB: back to coverage) over [0, 1]² of a patch
float helmMask( vec4 r, vec2 ab ) {
  float inside = step( 0.0, ab.x ) * step( ab.x, 1.0 ) * step( 0.0, ab.y ) * step( ab.y, 1.0 );
  return sqrt( texture2D( map, helmRectUv( r, ab ) ).r ) * inside;
}
vec3 helmInk( vec3 under ) {
  return dot( under, vec3( 0.2126, 0.7152, 0.0722 ) ) > 0.22 ? vec3( 0.006 ) : vec3( 0.86 );
}
vec3 helmLivery( vec3 base, vec3 P ) {
  vec3 d = normalize( ( P - HELM_C ) / HELM_R );
  vec3 c = helmPaint( base, d );
  // the number across the crown, its top toward the visor; the sponsor across the back
  float num = helmMask( ${glslRect(R_TCAM_NUM)}, vec2( 0.5 - d.x / 0.8, 0.5 + ( d.z + 0.1 ) / 0.36 ) ) * step( 0.6, d.y );
  float spon = helmMask( ${glslRect(R_HELM_SPON)}, vec2( 0.5 - d.x / 1.25, ( d.y - 0.1 ) / 0.22 ) ) * step( d.z, -0.4 );
  c = mix( c, helmInk( helmPaint( uHelmA, vec3( 0.0, 0.98, -0.1 ) ) ), num );
  return mix( c, helmInk( helmPaint( uHelmA, vec3( 0.0, 0.21, -0.98 ) ) ), spon );
}
`;

/** how many cars behind a mirror can show (nearest first) */
const MIRROR_CARS = 4;
/**
 * The rear-view mirrors' glass. Rendering the scene again from each mirror would cost a second
 * pass over the whole circuit every frame; what a 200 × 60 mm glass at arm's length shows is a
 * blurred handful of things — the car's own sidepod and rear tyre on its inner side, the road
 * running back to a vanishing point, the cars behind, the sky and the trees — so the glass ray-
 * traces those as boxes in its reflected view direction: the own sidepods, rear tyres and the
 * road under the car (in the car's frame), and up to MIRROR_CARS cars behind (a low wide box of
 * body and tyres, the front wing, the airbox), each lit like the scene (the env's irradiance and
 * the sun) and hazed out with distance into the env reflection, which carries everything else.
 * Off (just the env) unless a camera rides in this car: Game feeds it through feedMirrors.
 */
function makeMirrorMaterial(bodyColor: THREE.Color) {
  const u = {
    uMirOn: { value: 0 },
    uMirN: { value: 0 },
    uMirOwn: { value: new THREE.Matrix4() },
    uMirOwnCol: { value: bodyColor },
    uMirInv: { value: Array.from({ length: MIRROR_CARS }, () => new THREE.Matrix4()) },
    uMirCol: { value: Array.from({ length: MIRROR_CARS }, () => new THREE.Color()) },
  };
  // (a real mirror's silvered glass: ~85 % reflective, a hint cool)
  const mat = new THREE.MeshStandardMaterial({ name: 'car-mirror', color: new THREE.Color(0.8, 0.83, 0.86), roughness: 0.05, metalness: 1 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.uniforms.uCarFill = CAR_FILL;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMirW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvMirW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vMirW;
        uniform float uCarFill;
        uniform float uMirOn;
        uniform int uMirN;
        uniform mat4 uMirOwn;
        uniform vec3 uMirOwnCol;
        uniform mat4 uMirInv[ ${MIRROR_CARS} ];
        uniform vec3 uMirCol[ ${MIRROR_CARS} ];
        // a ray (o, d: a car's frame M) against a box: the nearest hit so far, its albedo and world normal
        void mirBox( vec3 o, vec3 d, vec3 lo, vec3 hi, vec3 alb, mat4 M, inout float tHit, inout vec3 aHit, inout vec3 nHit ) {
          vec3 inv = 1.0 / ( sign( d ) * max( abs( d ), vec3( 1e-6 ) ) );
          vec3 t0 = ( lo - o ) * inv;
          vec3 t1 = ( hi - o ) * inv;
          vec3 tn = min( t0, t1 );
          vec3 tf = max( t0, t1 );
          float a = max( max( tn.x, tn.y ), tn.z );
          float b = min( min( tf.x, tf.y ), tf.z );
          if ( a > 0.0 && a < b && a < tHit ) {
            tHit = a;
            aHit = alb;
            vec3 nL = tn.x >= a ? vec3( -sign( d.x ), 0.0, 0.0 ) : tn.y >= a ? vec3( 0.0, -sign( d.y ), 0.0 ) : vec3( 0.0, 0.0, -sign( d.z ) );
            nHit = normalize( ( vec4( nL, 0.0 ) * M ).xyz );
          }
        }
        // a tyre: a cylinder across the car (axis x, radius r round c.yz) from x0 to x1 — round, as
        // the rear tyre's shoulder fills the inner corner of every F1 mirror
        void mirWheel( vec3 o, vec3 d, vec3 c, float x0, float x1, float r, mat4 M, inout float tHit, inout vec3 aHit, inout vec3 nHit ) {
          vec2 oc = o.yz - c.yz;
          float A = dot( d.yz, d.yz );
          float B = dot( oc, d.yz );
          float h = B * B - A * ( dot( oc, oc ) - r * r );
          if ( h > 0.0 && A > 1e-8 ) {
            float t = ( -B - sqrt( h ) ) / A;
            float x = o.x + d.x * t;
            if ( t > 0.0 && t < tHit && x > x0 && x < x1 ) {
              tHit = t;
              aHit = vec3( 0.045 );
              nHit = normalize( ( vec4( 0.0, ( o.yz + d.yz * t - c.yz ) / r, 0.0 ) * M ).xyz );
            }
          }
          for ( int s = 0; s < 2; s++ ) {
            float xs = s == 0 ? x0 : x1;
            float t = ( xs - o.x ) / ( sign( d.x ) * max( abs( d.x ), 1e-6 ) );
            vec2 q = o.yz + d.yz * t - c.yz;
            if ( t > 0.0 && t < tHit && dot( q, q ) < r * r ) {
              tHit = t;
              // (the sidewall, the wheel cover's dark disc inside it)
              aHit = dot( q, q ) < 0.42 * r * r ? vec3( 0.025 ) : vec3( 0.055 );
              nHit = normalize( ( vec4( s == 0 ? -1.0 : 1.0, 0.0, 0.0, 0.0 ) * M ).xyz );
            }
          }
        }`,
      )
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
        #if defined( RE_IndirectSpecular )
        if ( uMirOn > 0.5 ) {
          vec3 rW = normalize( ( vec4( reflect( -geometryViewDir, geometryNormal ), 0.0 ) * viewMatrix ).xyz );
          float tHit = 1e6;
          vec3 aHit = vec3( 0.0 );
          vec3 nHit = vec3( 0.0, 1.0, 0.0 );
          // the own car: sidepods and rear tyres either side, and the road it runs on
          vec3 o = ( uMirOwn * vec4( vMirW, 1.0 ) ).xyz;
          vec3 d = ( uMirOwn * vec4( rW, 0.0 ) ).xyz;
          for ( int s = 0; s < 2; s++ ) {
            float k = s == 0 ? 1.0 : -1.0;
            // (the pod's shoulder, then its top falling away toward the coke bottle)
            vec3 pl = vec3( k * 0.36, 0.12, -0.35 ), ph = vec3( k * 0.66, 0.6, 0.38 );
            mirBox( o, d, min( pl, ph ), max( pl, ph ), uMirOwnCol, uMirOwn, tHit, aHit, nHit );
            pl = vec3( k * 0.3, 0.12, -1.5 ), ph = vec3( k * 0.62, 0.46, -0.35 );
            mirBox( o, d, min( pl, ph ), max( pl, ph ), uMirOwnCol, uMirOwn, tHit, aHit, nHit );
            mirWheel( o, d, vec3( 0.0, 0.36, -1.7 ), min( k * 0.62, k * 1.0 ), max( k * 0.62, k * 1.0 ), 0.36, uMirOwn, tHit, aHit, nHit );
          }
          if ( d.y < -1e-4 ) {
            float t = -o.y / d.y;
            vec3 g = o + d * t;
            // (the circuit's width round the car; past it the env's own ground)
            if ( t < tHit && abs( g.x ) < 7.5 ) {
              tHit = t;
              aHit = vec3( 0.1, 0.1, 0.105 );
              nHit = normalize( ( vec4( 0.0, 1.0, 0.0, 0.0 ) * uMirOwn ).xyz );
            }
          }
          // the cars behind: body and sidepods, the four tyres, the front wing, the airbox
          for ( int i = 0; i < ${MIRROR_CARS}; i++ ) {
            if ( i >= uMirN ) break;
            vec3 co = ( uMirInv[ i ] * vec4( vMirW, 1.0 ) ).xyz;
            vec3 cd = ( uMirInv[ i ] * vec4( rW, 0.0 ) ).xyz;
            vec3 col = uMirCol[ i ];
            mirBox( co, cd, vec3( -0.62, 0.06, -2.0 ), vec3( 0.62, 0.62, 1.9 ), col, uMirInv[ i ], tHit, aHit, nHit );
            mirBox( co, cd, vec3( -0.15, 0.6, -0.75 ), vec3( 0.15, 1.0, 0.15 ), col, uMirInv[ i ], tHit, aHit, nHit );
            mirBox( co, cd, vec3( -0.9, 0.07, 2.45 ), vec3( 0.9, 0.3, 3.05 ), col * 0.45, uMirInv[ i ], tHit, aHit, nHit );
            for ( int s = 0; s < 2; s++ ) {
              float k = s == 0 ? 1.0 : -1.0;
              mirWheel( co, cd, vec3( 0.0, 0.36, 1.7 ), min( k * 0.6, k * 0.98 ), max( k * 0.6, k * 0.98 ), 0.36, uMirInv[ i ], tHit, aHit, nHit );
              mirWheel( co, cd, vec3( 0.0, 0.36, -1.7 ), min( k * 0.62, k * 1.0 ), max( k * 0.62, k * 1.0 ), 0.36, uMirInv[ i ], tHit, aHit, nHit );
            }
          }
          if ( tHit < 1e5 ) {
            vec3 nV = normalize( ( viewMatrix * vec4( nHit, 0.0 ) ).xyz );
            vec3 irr = vec3( 0.0 );
            #ifdef USE_ENVMAP
              // (the sky's fill at the strength the cars themselves get it: carAO CAR_FILL)
              irr += getIBLIrradiance( nV ) * uCarFill;
            #endif
            // (the circuit's sun is a SunLight — three's cascaded one — not a DirectionalLight)
            #if NUM_SUN_LIGHTS > 0
              irr += sunLights[ 0 ].color * max( dot( nV, sunLights[ 0 ].direction ), 0.0 );
            #endif
            #if NUM_DIR_LIGHTS > 0
              irr += directionalLights[ 0 ].color * max( dot( nV, directionalLights[ 0 ].direction ), 0.0 );
            #endif
            radiance = mix( aHit * irr * RECIPROCAL_PI, radiance, smoothstep( 45.0, 170.0, tHit ) );
          }
        }
        #ifdef USE_ENVMAP
        {
          // the sun's disc or a lamp in the env map is a broad blob at its resolution, not a point:
          // past ~4× the average light round the glass it is rolled off (still the brightest thing
          // in the mirror, without filling it)
          const vec3 LW = vec3( 0.2126, 0.7152, 0.0722 );
          float cap = 4.0 * max( dot( getIBLIrradiance( geometryNormal ) * RECIPROCAL_PI, LW ), 1e-4 );
          float L = dot( radiance, LW );
          if ( L > cap ) radiance *= cap * ( 1.0 + 0.5 * log2( L / cap ) ) / L;
        }
        #endif
        #endif`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        // (the punctual lights' highlights off a near-perfect mirror — the sun, each floodlight at
        // night — are GGX spikes thousands of times the scene's light that bloomed into white discs
        // over the glass; what the mirror shows of them is already in the env reflection)
        reflectedLight.directSpecular *= 0.0;`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-mirror-v1';
  mat.userData.mirror = u;
  return { mat, u };
}

/**
 * The driver: the helmet's livery (HELMET_GLSL, on the shell's texels — the driver sheet's left
 * half), an iridium visor (thin-film tint shifting with the view angle); cloth suit, gloves and
 * belts without the gloss
 */
function patchDriver(mat: THREE.MeshPhysicalMaterial, look: ReturnType<typeof helmetLook>) {
  mat.onBeforeCompile = (sh) => {
    // (per material: every car's helmet its own colours and design, one shared program)
    sh.uniforms.uHelmA = { value: look.a };
    sh.uniforms.uHelmB = { value: look.b };
    sh.uniforms.uHelmLine = { value: look.line };
    sh.uniforms.uHelmStyle = { value: look.style };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHelmP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHelmP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', `${HELMET_GLSL}\nvoid main() {`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          // (the shell, its spoiler and chin bar map into the sheet's left half; nothing else does)
          diffuseColor.rgb = mix( diffuseColor.rgb, helmLivery( diffuseColor.rgb, vHelmP ), step( vMapUv.x, 0.5 ) );
        #endif`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        vec2 dC = ( vMapUv - vec2( 0.5, 0.0625 ) ) / vec2( 0.03125, 0.0625 );   // flat cell row (16 px cells at y 224)
        float dRow = step( 0.0, dC.x ) * step( dC.x, 6.0 ) * step( 0.0, dC.y ) * step( dC.y, 1.0 );
        float dVisor = dRow * step( dC.x, 1.0 );
        float dCloth = dRow * step( 1.0, dC.x ) * ( 1.0 - step( 3.0, dC.x ) * step( dC.x, 4.0 ) );`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `if ( dVisor > 0.5 ) {
          float fv = 1.0 - abs( dot( normalize( vViewPosition ), normal ) );
          diffuseColor.rgb = mix( vec3( 0.55, 0.36, 0.12 ), vec3( 0.18, 0.3, 0.75 ), smoothstep( 0.15, 0.75, fv ) ) * 0.55;
          metalnessFactor = 1.0;
          roughnessFactor = 0.035;
        }
        roughnessFactor = mix( roughnessFactor, 0.82, dCloth );
        #include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= 1.0 - dCloth;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-driver-v2';
}

/**
 * The tailpipe: not a brass tube but heat-tinted metal, like every exhaust in ACC's and the real cars'
 * close-ups. The oxide film's thickness follows the temperature, and thin films colour by interference
 * (titanium / Inconel temper colours): grey-blue and blue upstream where the gas is hottest, purple, then
 * bronze and straw toward the cooler end, and a ring of soot round the lip. (Car-space z along the pipe:
 * carGeometry exhaustAndLight, −1.98 under the bodywork → −2.25 at the lip. The chase camera stares
 * straight at it.) Only the exhaust's cell of the trim palette is touched.
 */
const EXHAUST_TINT = /* glsl */ `
if ( abs( vMapUv.x - ${trimUV(TC.exhaust)[0].toFixed(6)} ) + abs( vMapUv.y - ${trimUV(TC.exhaust)[1].toFixed(6)} ) < 1e-3 ) {
  float ez = clamp( ( -1.98 - vTrimPos.z ) / 0.27, 0.0, 1.0 );
  vec3 ex = mix( vec3( 0.29, 0.3, 0.33 ), vec3( 0.18, 0.25, 0.46 ), smoothstep( 0.05, 0.3, ez ) );
  ex = mix( ex, vec3( 0.32, 0.19, 0.34 ), smoothstep( 0.3, 0.5, ez ) );
  ex = mix( ex, vec3( 0.46, 0.29, 0.18 ), smoothstep( 0.5, 0.7, ez ) );
  ex = mix( ex, vec3( 0.58, 0.45, 0.25 ), smoothstep( 0.68, 0.88, ez ) );
  // (a used pipe's film is dull and uneven, not a clean rainbow)
  ex = mix( vec3( dot( ex, vec3( 0.3333 ) ) ), ex, 0.7 );
  float soot = smoothstep( 0.9, 0.99, ez );
  diffuseColor.rgb = mix( ex, vec3( 0.03, 0.028, 0.026 ), soot * 0.9 );
  metalnessFactor = 1.0 - 0.9 * soot;
  roughnessFactor = mix( 0.34, 0.8, soot );
}
`;

interface TrimUniforms {
  uHeat: { value: number };
  uRainLight: { value: number };
  uSelf: { value: number };
}
function patchTrim(mat: THREE.MeshStandardMaterial, u: TrimUniforms) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHeat = u.uHeat;
    sh.uniforms.uRainLight = u.uRainLight;
    sh.uniforms.uSelf = u.uSelf;
    wetUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTrimPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrimPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHeat;\nuniform float uRainLight;\nuniform float uSelf;\nvarying vec3 vTrimPos;\n' + WET_PARS)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        float tWet = carWetAmount();
        ${EXHAUST_TINT}
        roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, tWet );
        diffuseColor.rgb *= mix( 1.0, 0.85, tWet * ( 1.0 - metalnessFactor ) );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `vec4 emM = texture2D( emissiveMap, vEmissiveMapUv );
        float h = clamp( uHeat, 0.0, 1.0 );
        vec3 heat = mix( vec3( 0.9, 0.04, 0.0 ), vec3( 1.0, 0.42, 0.08 ), h * h ) * ( h * h * 17.0 + h * 2.0 );
        totalEmissiveRadiance = heat * emM.r + vec3( 1.0, 0.03, 0.015 ) * emM.g * uRainLight + diffuseColor.rgb * emM.b * uSelf;`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-trim-v3';
}

/**
 * The self-lit trim (button caps, the T-cam's light, the lateral lights), shared by every car. Game
 * scales it against the grade's exposure: a dark wet day is exposed up ~6x and the lights with it.
 */
export const DASH_GLOW = { value: 1.6 };
/**
 * The steering wheel's screen and shift lights: Game holds their brightness at a constant level
 * on the display whatever the lighting grade's exposure (a real screen is driven to be read by the
 * eye, which adapts: a night race's ×4 exposure blew the old screen into a glare; at noon it was
 * a dim grey patch next to the sunlit bodywork).
 */
export const SCREEN_GLOW = { value: 1.6 };
/**
 * The wheel's glass: black, glossy (it mirrors the sky like the real anti-glare glass, faintly),
 * over the dash texture as emissive. The texture is read with a small negative LOD bias so the
 * digits stay crisp where the 1024-texel screen is drawn ~300 px wide (the anisotropic filter keeps
 * the bias from shimmering). Its alpha goes above 1, which marks the pixels "responsive" for the TAA
 * (taa.ts, as the sparks are): the digits change 15 times a second, and a 9 % history blend left the
 * last few readings ghosting under the new one.
 */
function patchDash(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uScreen = SCREEN_GLOW;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uScreen;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= texture2D( emissiveMap, vEmissiveMapUv, -0.6 ).rgb * uScreen;')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = 1.45;');
  };
  mat.customProgramCacheKey = () => 'apex-dash-v1';
}

// ------------------------------------------------------------------------------------ arm rig
const Y_UP = new THREE.Vector3(0, 1, 0);
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _az = new THREE.Vector3();
/** a limb bone's frame: at `from`, +Z toward `to` (scaled by `stretch`), +Y as near `up` as it can be */
function armBasis(from: THREE.Vector3, to: THREE.Vector3, up: THREE.Vector3, out: THREE.Matrix4, stretch = 1) {
  _az.subVectors(to, from).normalize();
  _ax.crossVectors(up, _az).normalize();
  _ay.crossVectors(_az, _ax);
  out.makeBasis(_ax, _ay, _az.multiplyScalar(stretch));
  return out.setPosition(from);
}
/** the forearm's roll: half the hand's (radius and ulna share the wrist's turn along the forearm) */
function armTwist(handUp: THREE.Vector3, out: THREE.Vector3) {
  return out.copy(handUp).add(Y_UP).normalize();
}

// ------------------------------------------------------------------------------------ shared materials
/**
 * per-car carbon: a weave under a lacquer (wings, halo fairings, bodywork) that goes satin on the floor
 * and plank area. The tows' sheen is anisotropic (stretched across each tow, the warp and weft at right
 * angles) under an isotropic clearcoat: the lacquer mirrors the sky, the weave below shimmers.
 */
function makeCarbon(grime: GrimeUniforms) {
  const c = carbonTextures();
  const mat = new THREE.MeshPhysicalMaterial({
    name: 'car-carbon',
    map: c.map,
    normalMap: c.normal,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughnessMap: c.rough,
    roughness: 1.3,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.1,
    specularIntensity: 0.55,
    envMapIntensity: 0.6,
    anisotropy: 0.7,
    anisotropyMap: c.aniso,
  });
  patchCarbon(mat, grime);
  return mat;
}
function patchCarbon(mat: THREE.MeshPhysicalMaterial, grime: GrimeUniforms) {
  mat.onBeforeCompile = (sh) => {
    wetUniforms(sh);
    grimeShaderUniforms(sh, grime);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + GRIME_VERT_PARS)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + GRIME_VERT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WET_PARS + GRIME_PARS)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // the tub and halo fairings a metre from an onboard lens: far inside its defocus, so the 5 mm weave
        // can't resolve — sharp, it survived the blur as a regular checker on every cockpit side (a CG tell
        // in the onboard shots). Read as the weave's average there: colour, gloss and relief.
        float cNear = 1.0 - smoothstep( 0.9, 2.2, length( vViewPosition ) );
        #ifdef USE_MAP
          if ( cNear > 0.01 ) diffuseColor.rgb = mix( diffuseColor.rgb, diffuse * texture2D( map, vMapUv, 5.0 ).rgb, cNear );
        #endif
        float cWet = carWetAmount();
        diffuseColor.rgb *= mix( 1.0, 0.66, cWet );
        vec3 cGr = carGrime( vMapUv ) * ( 1.0 - 0.6 * cWet );
        diffuseColor.rgb = carGrimeColour( diffuseColor.rgb, cGr );
        float cGrAll = clamp( cGr.x * 0.8 + cGr.y + cGr.z, 0.0, 1.0 );
        // floor / plank level: satin, not lacquered
        float cFloor = 1.0 - smoothstep( 0.05, 0.12, vGrimePos.y );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        #ifdef USE_ROUGHNESSMAP
          if ( cNear > 0.01 ) roughnessFactor = mix( roughnessFactor, roughness * texture2D( roughnessMap, vRoughnessMapUv, 5.0 ).g, cNear );
        #endif
        roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.42, cWet );
        roughnessFactor = mix( roughnessFactor, 0.85, cGrAll );`,
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize( mix( normal, nonPerturbedNormal, cNear ) );')
      .replace('#include <clearcoat_normal_fragment_maps>', '#include <clearcoat_normal_fragment_maps>\n' + wetClearcoatBeads('vMapUv', 'cWet'))
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= ( 1.0 - 0.6 * cFloor ) * ( 1.0 - 0.95 * cGr.y );
          material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.32, max( cFloor, clamp( cGr.x * 0.7 + cGr.z, 0.0, 1.0 ) ) );
          material.clearcoat = mix( material.clearcoat, 1.0, cWet );
          material.clearcoatRoughness = mix( material.clearcoatRoughness, 0.03, cWet );
        #endif
        #if defined( USE_ANISOTROPY ) && defined( USE_ANISOTROPYMAP )
        {
          // the weave's stretched sheen only where the tows resolve: once a pixel spans a tow (12 to a
          // uv unit) it sees warp and weft together — isotropic on average (the mip-blended directions
          // would otherwise streak it diagonally); none inside an onboard lens's defocus or under grime
          float aTow = length( fwidth( vAnisotropyMapUv ) ) * 12.0;
          // the tow frame comes from the uv derivatives: on a plate's rounded edge, a pylon or a thin link
          // the uvs are stretched or folded, the frame collapses onto the normal, and the stretched lobe
          // turned into a needle-sharp highlight — single-pixel fireflies that bloomed into "lights" on
          // the wing tips. Re-square the frame on the shading normal and drop the sheen where it degenerates.
          vec3 aT = material.anisotropyT - normal * dot( normal, material.anisotropyT );
          float aOk = smoothstep( 0.35, 0.8, length( aT ) );
          aT = normalize( aT + 1e-5 );
          material.anisotropyT = aT;
          material.anisotropyB = cross( normal, aT );
          material.anisotropy *= aOk * ( 1.0 - smoothstep( 0.35, 1.0, aTow ) ) * ( 1.0 - cNear ) * ( 1.0 - cGrAll );
          // never sharper than the pixel's own curvature allows across the tows either
          material.roughness = max( material.roughness, 0.18 + geometryRoughness );
          material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
        }
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-carbon-v4';
}

/** loose pit-stop wheels share a material per compound and condition (new / used) */
const propMats = new Map<string, { mat: THREE.MeshPhysicalMaterial; u: TyreUniforms }>();
function propWheel(c: Compound, worn: number) {
  const key = `${c}:${worn.toFixed(2)}`;
  let hit = propMats.get(key);
  if (!hit) {
    hit = createTyreMaterial(c, `car-wheel-prop-${key}`);
    applyTyreLook(hit.u, worn > 0 ? wornTyreLook(worn) : newTyreLook());
    propMats.set(key, hit);
  }
  return hit.mat;
}

interface PaintBase {
  mat: THREE.MeshPhysicalMaterial;
  mask: THREE.Texture;
  flake: number;
  refs: number;
}
const paintCache = new Map<string, PaintBase>();
/** the team's paint (livery textures + finish), shared; each car wears its own copy (its own grime) */
function acquirePaint(team: Team): PaintBase {
  const hit = paintCache.get(team.id);
  if (hit) {
    hit.refs++;
    return hit;
  }
  const liv = acquireLivery(team);
  const c = new THREE.Color(team.primary);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const metallic = team.metallic ?? (hsl.s < 0.15 && hsl.l > 0.25 && hsl.l < 0.85 ? 0.55 : 0.08);
  const m = team.matte;
  const mat = new THREE.MeshPhysicalMaterial({
    name: `car-paint-${team.id}`,
    map: liv.map,
    roughness: 0.46 + 0.22 * m - metallic * 0.12,
    metalness: metallic,
    clearcoat: 1 - 0.72 * m,
    // (a race car's lacquer is no showroom mirror: orange peel, vinyl wrap edges and a film of road dust
    // soften every reflection — the sky and the sun glint still read, just not like chrome)
    clearcoatRoughness: 0.065 + 0.4 * m,
    // the base coat's own reflection: under the lacquer it meets resin of nearly its own index, not air,
    // so a lacquered solid colour has almost none — the air-facing reflection is the clearcoat's alone.
    // At full strength it laid a broad milky lobe (roughness ~0.46) under the crisp clearcoat glint: the
    // look of moulded plastic, not of a deep painted panel (ACC's paint is a sharp lacquer over a clean
    // colour). A matte livery has little lacquer, so its base keeps its sheen. (A uniform: no new program.)
    specularIntensity: 1 - 0.75 * (1 - m),
    sheen: 0.4 * m,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0.3, 0.3, 0.32),
  });
  const base: PaintBase = { mat, mask: liv.mask, flake: THREE.MathUtils.clamp((metallic - 0.05) * 1.6, 0, 1) * (1 - 0.7 * m), refs: 1 };
  paintCache.set(team.id, base);
  return base;
}
function releasePaint(team: Team) {
  const hit = paintCache.get(team.id);
  if (!hit) return;
  if (--hit.refs <= 0) {
    hit.mat.dispose();
    releaseLivery(team);
    paintCache.delete(team.id);
  }
}

// ------------------------------------------------------------------------------------ a loose wheel
/**
 * A wheel off the car (pit crews carry the old set away and bring the new one):
 * the car's own wheel geometry and compound material, axle along local x,
 * centred on the hub. `worn` > 0: a used set (dull, grained, marbles and brake dust); 0: brand new.
 */
export interface WheelProp {
  root: THREE.Group;
  setCompound(c: Compound): void;
  /** 0 brand new … 1 worn out */
  setWorn(w: number): void;
  dispose(): void;
}
export function createWheelProp(front: boolean, compound: Compound, worn = 0): WheelProp {
  const geo = acquireGeo();
  const L = geo[1];
  const root = new THREE.Group();
  root.name = 'wheel-prop';
  const meshes: THREE.Mesh[] = [];
  const q = (w: number) => Math.round(Math.min(1, Math.max(0, w)) * 10) / 10;
  let cur = compound;
  let wornQ = q(worn);
  for (const g of [front ? L.wheelF : L.wheelR, front ? L.spokesF : L.spokesR]) {
    if (!g) continue;
    const m = new THREE.Mesh(g, propWheel(compound, wornQ));
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    meshes.push(m);
  }
  let alive = true;
  return {
    root,
    setCompound(c) {
      if (c === cur) return;
      cur = c;
      for (const m of meshes) m.material = propWheel(c, wornQ);
    },
    setWorn(w) {
      const k = q(w);
      if (k === wornQ) return;
      wornQ = k;
      for (const m of meshes) m.material = propWheel(cur, wornQ);
    },
    dispose() {
      if (!alive) return;
      alive = false;
      root.removeFromParent();
      releaseGeo();
    },
  };
}

// ------------------------------------------------------------------------------------ mirrors
let mirrorFed: CarRig | null = null;
const mirrorPick: { rig: CarRig; d: number }[] = [];
const mirrorCars: CarRig[] = [];
const mirrorAll: CarRig[] = [];
const mirV = new THREE.Vector3();
const mirM = new THREE.Matrix4();
/**
 * Show the cars behind in the mirrors of the car a camera rides in (`followed`: its root, null when
 * the camera isn't on a car): the nearest few behind or alongside it, within ~180 m (further, a
 * car is a couple of pixels in a glass the size of a phone). Once a frame, after the cars moved.
 */
export function feedMirrors(rigsIn: Iterable<CarRig>, followed: THREE.Object3D | null) {
  // (an iterator — a Map's values() — runs once: keep the cars for the second pass)
  const rigs = mirrorAll;
  rigs.length = 0;
  let own: CarRig | null = null;
  if (followed)
    for (const r of rigsIn) {
      rigs.push(r);
      if (r.root === followed) own = r;
    }
  if (own !== mirrorFed) {
    mirrorFed?.setMirrorCars?.(null);
    mirrorFed = own;
  }
  if (!own) return;
  // (this frame's poses: the glass' ray origins are this frame's too)
  own.root.updateWorldMatrix(true, false);
  mirM.copy(own.root.matrixWorld).invert();
  mirrorPick.length = 0;
  for (const r of rigs) {
    if (r === own || !r.root.visible || !r.root.parent) continue;
    r.root.updateWorldMatrix(true, false);
    mirV.setFromMatrixPosition(r.root.matrixWorld).applyMatrix4(mirM);
    // (a mirror sees nothing ahead of itself)
    if (mirV.z > 1.5) continue;
    const d = mirV.lengthSq();
    if (d < 180 * 180) mirrorPick.push({ rig: r, d });
  }
  mirrorPick.sort((a, b) => a.d - b.d);
  mirrorCars.length = 0;
  for (let i = 0; i < Math.min(MIRROR_CARS, mirrorPick.length); i++) mirrorCars.push(mirrorPick[i].rig);
  own.setMirrorCars?.(mirrorCars);
}

// ------------------------------------------------------------------------------------ createCar
export function createCar(team: Team, driver: Driver, seat: 0 | 1, opts: { envMap?: THREE.Texture } = {}): CarRig {
  const geo = acquireGeo();
  const paintBase = acquirePaint(team);
  // per-car paint and carbon (the livery textures are the team's): each car carries its own grime
  const grime = grimeUniforms();
  const paint = paintBase.mat.clone();
  paint.name = `car-paint-${team.id}`;
  patchPaint(paint, paintBase.mask, carbonTextures().map, grime, paintBase.flake);
  withCarAO(paint);
  const carbon = withCarAO(makeCarbon(grime));
  let compound: Compound = 'soft';
  // one wheel material per corner (FL FR RL RR): each tyre shows its own wear; one shared program
  const tyres = [0, 1, 2, 3].map((i) => createTyreMaterial(compound, `car-wheel-${['FL', 'FR', 'RL', 'RR'][i]}`));
  const ts = trimShared();
  const trimTex = trimTexture(team, driver, seat);
  const uniforms: TrimUniforms = { uHeat: { value: 0 }, uRainLight: { value: 0 }, uSelf: DASH_GLOW };
  const trim = new THREE.MeshStandardMaterial({
    name: 'car-trim',
    map: trimTex,
    roughnessMap: ts.orm,
    metalnessMap: ts.orm,
    roughness: 1,
    metalness: 1,
    emissive: 0xffffff,
    emissiveMap: ts.emis,
  });
  patchTrim(trim, uniforms);
  withCarAO(trim);
  const drvTex = driverTexture(team, driver);
  const driverMat = new THREE.MeshPhysicalMaterial({
    name: 'car-driver',
    map: drvTex,
    alphaTest: 0.5,
    roughness: 0.32,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  patchDriver(driverMat, helmetLook(driver));
  withCarAO(driverMat);
  const blurMat = new THREE.MeshStandardMaterial({
    name: 'car-wheel-blur',
    map: wheelTextures('soft').blur,
    transparent: true,
    depthWrite: false,
    opacity: 0,
    roughness: 0.7,
    metalness: 0.2,
  });
  // the steering wheel's face (its printed legends, shared), its glass (the screen: shared until a
  // camera rides in this car, then its own live texture) and the driver's gloves (the team's)
  const faceMat = new THREE.MeshStandardMaterial({ name: 'car-wheel-face', map: wheelFaceTexture(), roughness: 0.46, metalness: 0.1 });
  withCarAO(faceMat);
  const dashMat = new THREE.MeshStandardMaterial({
    name: 'car-dash',
    color: 0x000000,
    roughness: 0.16,
    metalness: 0,
    envMapIntensity: 0.3,
    emissive: 0xffffff,
    emissiveMap: sharedDashTexture(),
  });
  patchDash(dashMat);
  let liveDash: ReturnType<typeof createDashTexture> | null = null;
  const gloveTex = acquireGloveTexture(team);
  // (suede and Nomex knit: matte, with the velvety rim a brushed fabric has — sheen)
  const gloveMat = new THREE.MeshPhysicalMaterial({
    name: 'car-gloves',
    map: gloveTex,
    normalMap: gloveNormalTexture(),
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.84,
    metalness: 0,
    sheen: 0.45,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0.24, 0.24, 0.26),
  });
  withCarAO(gloveMat);
  const bodyColor = new THREE.Color(team.primary);
  const mirror = makeMirrorMaterial(bodyColor);
  const own: THREE.Material[] = [trim, driverMat, blurMat, paint, carbon, faceMat, dashMat, gloveMat, mirror.mat, ...tyres.map((t) => t.mat)];
  const paintMat: THREE.Material = paint;
  if (opts.envMap) for (const m of own as THREE.MeshStandardMaterial[]) m.envMap = opts.envMap;

  const root = new THREE.Group();
  root.name = `car-${team.id}-${driver.code}`;
  const body = new THREE.Group();
  body.name = 'body';
  root.add(body);

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true, recv = true) => {
    const x = new THREE.Mesh(g, m);
    x.castShadow = cast;
    x.receiveShadow = recv;
    return x;
  };

  // ---- body per level
  const bodyL: THREE.Group[] = [];
  const unsprungL: THREE.Group[] = [];
  const flapPivots: THREE.Object3D[] = [];
  const fwFlapPivots: THREE.Object3D[] = [];
  const driverMeshes: { all: THREE.Mesh; decals: THREE.Mesh | null; head: THREE.Mesh | null }[] = [];
  const headPivots: THREE.Object3D[] = [];
  const partPivots: Record<PartId, THREE.Group[]> = { fwL: [], fwR: [], rw: [] };
  let steerSpin: THREE.Object3D | null = null;
  let steerPivot: THREE.Object3D | null = null;
  let arms: THREE.SkinnedMesh | null = null;
  /** per side (left, right): upper arm, forearm, hand */
  const armBones: THREE.Bone[][] = [];
  const pillars: THREE.Mesh[] = [];
  for (let lv = 0; lv < 3; lv++) {
    const L = geo[lv];
    const g = new THREE.Group();
    g.name = `L${lv}`;
    g.add(mesh(L.body.paint, paintMat));
    g.add(mesh(L.body.carbon, carbon));
    g.add(mesh(L.body.trim, trim));
    if (L.body.mirror) g.add(mesh(L.body.mirror, mirror.mat, false, false));
    if (L.body.pillar) {
      const pm = mesh(L.body.pillar, carbon);
      pm.name = 'halo_pillar';
      pillars.push(pm);
      g.add(pm);
    }
    if (L.body.driver) {
      const all = mesh(L.body.driver, driverMat);
      g.add(all);
      let dec: THREE.Mesh | null = null;
      if (L.body.decals) {
        dec = mesh(L.body.decals, driverMat, false);
        dec.visible = false;
        g.add(dec);
      }
      let head: THREE.Mesh | null = null;
      if (L.body.head) {
        const pv = new THREE.Group();
        pv.position.set(NECK_PIVOT[0], NECK_PIVOT[1], NECK_PIVOT[2]);
        head = mesh(L.body.head, driverMat);
        pv.add(head);
        g.add(pv);
        headPivots.push(pv);
      }
      driverMeshes.push({ all, decals: dec, head });
    }
    // breakable parts: each on a hinge so it can bend before it breaks off
    const partMats = { paint: paintMat, carbon, trim } as const;
    const pivOf: Record<PartId, THREE.Group> = {} as Record<PartId, THREE.Group>;
    for (const k of PART_IDS) {
      const h = PART_HINGE[k];
      const pv = new THREE.Group();
      pv.name = `part-${k}`;
      pv.position.set(h[0], h[1], h[2]);
      const inner = new THREE.Group();
      inner.position.set(-h[0], -h[1], -h[2]);
      for (const mk of ['paint', 'carbon', 'trim'] as const) {
        const pg = L.parts[k][mk];
        if (pg) inner.add(mesh(pg, partMats[mk]));
      }
      pv.add(inner);
      g.add(pv);
      pivOf[k] = pv;
      partPivots[k].push(pv);
    }
    const fp = new THREE.Group();
    fp.position.set(FLAP_PIVOT[0] - PART_HINGE.rw[0], FLAP_PIVOT[1] - PART_HINGE.rw[1], FLAP_PIVOT[2] - PART_HINGE.rw[2]);
    fp.add(mesh(L.flap, paintMat));
    // the active rear flaps go wherever the rear wing goes
    pivOf.rw.add(fp);
    flapPivots.push(fp);
    // the front wing's active flaps, one pair on each (breakable) wing half
    (['fwL', 'fwR'] as const).forEach((k, i) => {
      const f = new THREE.Group();
      f.position.set(FW_FLAP_PIVOT[0] - PART_HINGE[k][0], FW_FLAP_PIVOT[1] - PART_HINGE[k][1], FW_FLAP_PIVOT[2] - PART_HINGE[k][2]);
      f.add(mesh(L.fwFlaps[i], paintMat));
      pivOf[k].add(f);
      fwFlapPivots.push(f);
    });
    if (L.steer) {
      const pv = new THREE.Group();
      pv.position.set(STEER_PIVOT[0], STEER_PIVOT[1], STEER_PIVOT[2]);
      pv.rotation.x = STEER_TILT;
      const spin = new THREE.Group();
      spin.name = 'steering-wheel';
      spin.add(mesh(L.steer, trim, false));
      if (L.steerFace) spin.add(mesh(L.steerFace, faceMat, false));
      if (L.steerDash) spin.add(mesh(L.steerDash, dashMat, false, false));
      pv.add(spin);
      g.add(pv);
      steerSpin = spin;
      steerPivot = pv;
      if (L.arms) {
        // the arms: shoulder → elbow (IK) → the hand on the wheel (a bone riding the wheel's turn)
        const bones: THREE.Bone[] = [];
        const inv: THREE.Matrix4[] = [];
        const { S, E, W } = ARM_REST;
        const handUp = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), STEER_TILT);
        for (const side of [1, -1]) {
          const up = new THREE.Bone();
          const fore = new THREE.Bone();
          const hand = new THREE.Bone();
          g.add(up, fore);
          spin.add(hand);
          hand.position.set(WRIST_LOCAL[0] * side, WRIST_LOCAL[1], WRIST_LOCAL[2]);
          const sv = (p: readonly number[]) => new THREE.Vector3(p[0] * side, p[1], p[2]);
          inv.push(
            armBasis(sv(S), sv(E), Y_UP, new THREE.Matrix4()).invert(),
            armBasis(sv(E), sv(W), armTwist(handUp, new THREE.Vector3()), new THREE.Matrix4()).invert(),
            new THREE.Matrix4().makeRotationX(STEER_TILT).setPosition(STEER_PIVOT[0], STEER_PIVOT[1], STEER_PIVOT[2]).multiply(new THREE.Matrix4().makeTranslation(sv(WRIST_LOCAL))).invert(),
          );
          bones.push(up, fore, hand);
          armBones.push([up, fore, hand]);
        }
        arms = new THREE.SkinnedMesh(L.arms, [driverMat, gloveMat]);
        arms.name = 'driver-arms';
        arms.castShadow = false;
        arms.receiveShadow = true;
        arms.frustumCulled = false;
        // (bind matrix identity: the geometry is in this level group's space, as the bones are)
        arms.bind(new THREE.Skeleton(bones, inv), new THREE.Matrix4());
        g.add(arms);
      }
    }
    body.add(g);
    bodyL.push(g);
    if (lv < 2) {
      const u = new THREE.Group();
      u.name = `unsprung-L${lv}`;
      u.add(mesh(L.unsprung.carbon, carbon));
      u.add(mesh(L.unsprung.trim, trim));
      if (L.unsprung.blurRear) {
        const b = mesh(L.unsprung.blurRear, blurMat, false, false);
        b.name = 'blur';
        b.visible = false;
        u.add(b);
      }
      root.add(u);
      unsprungL.push(u);
    } else {
      const u = new THREE.Group();
      u.name = 'unsprung-L2';
      u.add(mesh(L.unsprung.carbon, carbon));
      u.add(mesh(L.unsprung.trim, trim));
      root.add(u);
      unsprungL.push(u);
    }
  }
  // (far LOD: all four wheels in one mesh, shown in the rear-left tyre's condition)
  const wheelsFar = mesh(geo[2].wheelsMerged!, tyres[2].mat);
  root.add(wheelsFar);
  // one merged far-LOD silhouette for the shadow pass (see shadowPass); never drawn by the camera
  const shadowProxy = new THREE.Mesh(shadowGeometry(2, [bodyL[2], unsprungL[2], wheelsFar], root), SHADOW_MAT);

  shadowProxy.name = 'shadow-proxy';
  shadowProxy.castShadow = true;
  shadowProxy.receiveShadow = false;
  shadowProxy.visible = false;
  root.add(shadowProxy);
  const shadowSaved: boolean[] = [];
  let shadowProxyOn = false;

  // ---- corners
  interface Corner {
    group: THREE.Group;
    steer: THREE.Group;
    spin: THREE.Group;
    side: number;
    front: boolean;
    lv: { tyre: THREE.Mesh; spokes: THREE.Mesh | null; assy: THREE.Mesh | null; blur: THREE.Mesh | null }[];
  }
  const corners: Corner[] = [];
  const mkCorner = (front: boolean, side: number, wheel: THREE.Material) => {
    const group = new THREE.Group();
    group.position.set(((front ? TRACK_F : TRACK_R) / 2) * side, WHEEL_R, front ? Z_FRONT_AXLE : Z_REAR_AXLE);
    const steer = new THREE.Group();
    group.add(steer);
    const flip = new THREE.Group();
    if (side < 0) flip.rotation.y = Math.PI;
    steer.add(flip);
    const spin = new THREE.Group();
    flip.add(spin);
    const lv: Corner['lv'] = [];
    for (let l = 0; l < 2; l++) {
      const L = geo[l];
      const tyre = mesh(front ? L.wheelF! : L.wheelR!, wheel);
      spin.add(tyre);
      // (2022+ wheel covers: the spokes are part of the old geometry only)
      const sg = front ? L.spokesF : L.spokesR;
      const spokes = sg ? mesh(sg, wheel) : null;
      if (spokes) spin.add(spokes);
      let assy: THREE.Mesh | null = null;
      let blur: THREE.Mesh | null = null;
      if (front) {
        const mirror = new THREE.Group();
        mirror.scale.x = side;
        assy = mesh(L.frontAssy!, trim, false);
        blur = mesh(L.blurFront!, blurMat, false, false);
        blur.visible = false;
        mirror.add(assy, blur);
        steer.add(mirror);
      }
      lv.push({ tyre, spokes, assy, blur });
    }
    root.add(group);
    const c: Corner = { group, steer, spin, side, front, lv };
    corners.push(c);
    return c;
  };
  const FL = mkCorner(true, 1, tyres[0].mat);
  const FR = mkCorner(true, -1, tyres[1].mat);
  const RL = mkCorner(false, 1, tyres[2].mat);
  const RR = mkCorner(false, -1, tyres[3].mat);
  // ---- live suspension links (near levels): each leg joins its chassis pickup (moves with the
  // sprung body) to its upright pickup (moves with the corner and, at the front, the steering)
  const linkMeshes: (THREE.InstancedMesh | null)[] = [0, 1].map((lv) => {
    const g = geo[lv].armUnit;
    if (!g) return null;
    const im = new THREE.InstancedMesh(g, carbon, SUSP_LEGS.length * 2);
    im.name = 'links';
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    unsprungL[lv].add(im);
    return im;
  });
  const lkA = new THREE.Vector3(), lkB = new THREE.Vector3(), lkX = new THREE.Vector3(), lkY = new THREE.Vector3(), lkZ = new THREE.Vector3();
  const lkM = new THREE.Matrix4(), lkC = new THREE.Matrix4();
  const FWD = new THREE.Vector3(0, 0, 1);
  const updateLinks = (lv: number) => {
    const im = linkMeshes[lv];
    if (!im) return;
    body.updateMatrix();
    for (const c of corners) {
      c.group.updateMatrix();
      c.steer.updateMatrix();
    }
    let i = 0;
    for (const side of [1, -1]) {
      for (const l of SUSP_LEGS) {
        lkA.set(l.inner[0] * side, l.inner[1], l.inner[2]).applyMatrix4(body.matrix);
        const c = l.front ? (side > 0 ? FL : FR) : side > 0 ? RL : RR;
        lkC.copy(c.group.matrix);
        if (l.front) lkC.multiply(c.steer.matrix);
        lkB.set(l.outer[0] * side, l.outer[1], l.outer[2]).applyMatrix4(lkC);
        lkZ.subVectors(lkB, lkA);
        const len = lkZ.length();
        lkZ.multiplyScalar(1 / Math.max(len, 1e-5));
        // chord with the airflow: the car's forward axis, square to the link
        lkX.copy(FWD).addScaledVector(lkZ, -FWD.dot(lkZ));
        if (lkX.lengthSq() < 1e-4) lkX.set(0, 1, 0).addScaledVector(lkZ, -lkZ.y);
        lkX.normalize();
        lkY.crossVectors(lkZ, lkX);
        lkM.makeBasis(lkX.multiplyScalar(l.chord), lkY.multiplyScalar(l.thick), lkZ.multiplyScalar(len));
        lkM.setPosition(lkA);
        im.setMatrixAt(i++, lkM);
      }
    }
    im.instanceMatrix.needsUpdate = true;
  };
  updateLinks(0);
  updateLinks(1);
  // ---- the arms (nearest level): the hands ride the wheel; each elbow is solved from its shoulder
  // and wrist (two-bone IK, bent down and out toward ARM.pole), the forearm rolling half the hand's turn
  const faS = new THREE.Matrix4(), faM = new THREE.Matrix4();
  const faSh = new THREE.Vector3(), faE = new THREE.Vector3(), faW = new THREE.Vector3(), faUp = new THREE.Vector3(), faPole = new THREE.Vector3();
  let faSteer = NaN;
  const updateArms = () => {
    if (!arms || !steerSpin || !steerPivot || !arms.visible) return;
    const ang = steerSpin.rotation.z;
    if (ang === faSteer) return;
    faSteer = ang;
    steerPivot.updateMatrix();
    steerSpin.updateMatrix();
    faS.multiplyMatrices(steerPivot.matrix, steerSpin.matrix);
    faUp.set(0, 1, 0).transformDirection(faS);
    armTwist(faUp, faUp);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const [up, fore] = armBones[i];
      faSh.set(ARM.shoulder[0] * side, ARM.shoulder[1], ARM.shoulder[2]);
      faW.set(WRIST_LOCAL[0] * side, WRIST_LOCAL[1], WRIST_LOCAL[2]).applyMatrix4(faS);
      faPole.set(ARM.pole[0] * side, ARM.pole[1], ARM.pole[2]);
      solveElbow(faSh, faW, faPole, faE);
      armBasis(faSh, faE, Y_UP, faM).decompose(up.position, up.quaternion, up.scale);
      // (out of reach — full lock with the hand at the bottom — the forearm stretches the last bit)
      armBasis(faE, faW, faUp, faM, Math.max(1, faE.distanceTo(faW) / ARM.fore)).decompose(fore.position, fore.quaternion, fore.scale);
    }
  };
  updateArms();
  // the near cars' shadow silhouette, from the middle level of detail (built at rest, shared)
  const shadowL1 = shadowGeometry(1, [bodyL[1], unsprungL[1], ...corners.flatMap((c) => [c.lv[1].tyre, c.lv[1].spokes, c.lv[1].assy].filter((m): m is THREE.Mesh => !!m))], root);

  // ---- anchors
  const anchor = (name: string, p: [number, number, number], parent: THREE.Object3D) => {
    const o = new THREE.Object3D();
    o.name = name;
    o.position.set(p[0], p[1], p[2]);
    parent.add(o);
    return o;
  };
  const anchors = {
    cockpit: anchor('cockpit', [0, HELMET_C[1] + 0.005, HELMET_C[2] + 0.07], body),
    tcam: anchor('tcam', [0, 1.036, -0.255], body),
    nose: anchor('nose', [0, 0.215, 2.86], body),
    rearWing: anchor('rearWing', [0, 0.88, -2.12], body),
    exhaust: anchor('exhaust', [0, 0.458, -2.25], body),
    wheelFL: anchor('wheelFL', [0, 0, 0], FL.group),
    wheelFR: anchor('wheelFR', [0, 0, 0], FR.group),
    wheelRL: anchor('wheelRL', [0, 0, 0], RL.group),
    wheelRR: anchor('wheelRR', [0, 0, 0], RR.group),
    rainLight: anchor('rainLight', [0, 0.316, -2.39], body),
    eyes: headPivots[0]
      ? anchor('eyes', [HELMET_C[0] - NECK_PIVOT[0], HELMET_C[1] - NECK_PIVOT[1] - 0.014, HELMET_C[2] - NECK_PIVOT[2] + 0.1], headPivots[0])
      : anchor('eyes', [0, HELMET_C[1] - 0.014, HELMET_C[2] + 0.1], body),
  };
  // ---- state
  let detail: 0 | 1 | 2 = 0;
  let blur = 0;
  let rainOn = false;
  let rainT = 0;
  let rainLevel = 0;
  let driverVisible = true;
  let handsVisible = false;
  const head = { roll: 0, pitch: 0, yaw: 0 };
  const headT = { roll: 0, pitch: 0, yaw: 0 };
  const partState: Record<PartId, number> = { fwL: 0, fwR: 0, rw: 0 };
  const wheelLost: Record<WheelId, boolean> = { wFL: false, wFR: false, wRL: false, wRR: false };
  /** pit stop: how far each wheel is off its hub (0 … 1) */
  const wheelOff: Record<WheelId, number> = { wFL: 0, wFR: 0, wRL: 0, wRR: 0 };
  const cornerOf: Record<WheelId, Corner> = { wFL: FL, wFR: FR, wRL: RL, wRR: RR };
  const cornerHome = corners.map((c) => c.group.position.clone());
  let charLevel = 0;
  // materials this car owns outright (so burning one car doesn't burn the whole team)
  const charMats: { m: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial; color: THREE.Color; rough: number; cc: number; sheen: number; env: number }[] = [];
  const ensureCharMats = () => {
    if (charMats.length) return;
    const swap = (m: THREE.Material): THREE.Material => {
      if (own.includes(m)) return m;
      const src = m as THREE.MeshPhysicalMaterial;
      const c = src.clone();
      c.onBeforeCompile = src.onBeforeCompile;
      c.customProgramCacheKey = src.customProgramCacheKey;
      own.push(c);
      return c;
    };
    const remap = new Map<THREE.Material, THREE.Material>();
    root.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh || me.material === blurMat) return;
      const one = (m: THREE.Material) => {
        let r = remap.get(m);
        if (!r) {
          r = swap(m);
          remap.set(m, r);
        }
        return r;
      };
      // (the driver's arms carry two: sleeves and gloves)
      me.material = Array.isArray(me.material) ? me.material.map(one) : one(me.material);
    });
    for (const m of new Set(remap.values()) as Set<THREE.MeshPhysicalMaterial>) {
      charMats.push({ m, color: m.color.clone(), rough: m.roughness, cc: m.clearcoat ?? 0, sheen: m.sheen ?? 0, env: m.envMapIntensity });
    }
  };

  const applyVisibility = () => {
    bodyL.forEach((g, i) => (g.visible = i === detail));
    unsprungL.forEach((g, i) => (g.visible = i === detail));
    wheelsFar.visible = detail === 2;
    const showBlur = blur > 0.02;
    for (const c of corners) {
      c.group.visible = detail < 2 && !(wheelLost as Record<string, boolean>)[`w${c.front ? 'F' : 'R'}${c.side > 0 ? 'L' : 'R'}`];
      c.lv.forEach((m, i) => {
        const on = i === detail;
        const off = wheelOff[`w${c.front ? 'F' : 'R'}${c.side > 0 ? 'L' : 'R'}` as WheelId] >= 0.999;
        m.tyre.visible = on && !off;
        if (m.spokes) m.spokes.visible = on && !off && blur < 0.6;
        if (m.assy) m.assy.visible = on;
        if (m.blur) m.blur.visible = on && showBlur;
      });
    }
    for (const u of unsprungL) {
      const b = u.getObjectByName('blur');
      if (b) b.visible = showBlur;
    }
    for (const d of driverMeshes) {
      d.all.visible = driverVisible;
      if (d.head) d.head.visible = driverVisible;
      if (d.decals) d.decals.visible = !driverVisible;
    }
    if (arms) arms.visible = driverVisible || handsVisible;
  };
  applyVisibility();

  const mirInv = new THREE.Matrix4();
  const rig: CarRig = {
    root,
    body,
    anchors,
    bodyColor,
    setMirrorCars(cars) {
      const u = mirror.u;
      u.uMirOn.value = cars ? 1 : 0;
      if (!cars) return;
      u.uMirOwn.value.copy(root.matrixWorld).invert();
      const n = Math.min(MIRROR_CARS, cars.length);
      for (let i = 0; i < n; i++) {
        u.uMirInv.value[i].copy(mirInv.copy(cars[i].root.matrixWorld).invert());
        u.uMirCol.value[i].copy(cars[i].bodyColor);
      }
      u.uMirN.value = n;
    },
    dims: { wheelbase: WHEELBASE, trackFront: TRACK_F, trackRear: TRACK_R, length: 5.46, width: CAR_WIDTH, wheelRadius: WHEEL_R },
    setSteer(rad) {
      FL.steer.rotation.y = rad;
      FR.steer.rotation.y = rad;
      // (a quick rack, saturating short of the grips crossing the middle of the onboard picture)
      if (steerSpin) steerSpin.rotation.z = -1.35 * Math.tanh((rad * 5.5) / 1.35);
    },
    setWheelSpin(f, r) {
      FL.spin.rotation.x = f;
      FR.spin.rotation.x = -f;
      RL.spin.rotation.x = r;
      RR.spin.rotation.x = -r;
    },
    setWheelSpeed(mps) {
      const v = Math.abs(mps);
      const t = Math.min(1, Math.max(0, (v - 3) / 9));
      const b = t * t * (3 - 2 * t);
      if (Math.abs(b - blur) < 1e-3) return;
      const wasShown = blur > 0.02;
      const wasSpokes = blur < 0.6;
      blur = b;
      blurMat.opacity = b;
      for (const t of tyres) t.u.uTyreC.value.z = b;
      if (wasShown !== blur > 0.02 || wasSpokes !== blur < 0.6) applyVisibility();
    },
    setBrakeGlow(v) {
      uniforms.uHeat.value = Math.min(1, Math.max(0, v));
    },
    setRainLight(on) {
      if (on === rainOn) return;
      rainOn = on;
      // each car's LED runs on its own clock
      rainT = Math.random() * 0.25;
      if (!on) uniforms.uRainLight.value = rainLevel = 0;
    },
    rainLightLevel() {
      return rainLevel;
    },
    setCompound(c) {
      if (c === compound) return;
      compound = c;
      // same materials (same program), the compound's atlas swapped in
      for (const t of tyres) setTyreCompound(t.mat, t.u, c);
      blurMat.map = wheelTextures(c).blur;
    },
    setTyres(looks) {
      let dust = 0;
      let dirt = 0;
      for (let i = 0; i < 4; i++) {
        const s = looks[i];
        if (!s) continue;
        applyTyreLook(tyres[i].u, s);
        dust += s.dust / 4;
        dirt += Math.max(s.grass, s.wear * 0.5) / 4;
      }
      // the spinning-wheel smear picks up the brake dust and grime too
      blurMat.color.setRGB(1 - 0.05 * dirt, 1 - 0.1 * dust - 0.06 * dirt, 1 - 0.2 * dust - 0.1 * dirt);
    },
    setGrime(film, flecks, dirt) {
      grime.uGrime.value.set(film, flecks, dirt, 0);
    },
    setDrs(open) {
      // 2026 active aero: straight mode lays the rear AND front flaps flatter
      const o = Math.min(1, Math.max(0, open));
      for (const fp of flapPivots) fp.rotation.x = -0.5 * o;
      for (const fp of fwFlapPivots) fp.rotation.x = -0.26 * o;
    },
    setDash(d) {
      // (the first live frame: this car gets a screen of its own)
      if (!liveDash) {
        liveDash = createDashTexture();
        dashMat.emissiveMap = liveDash.tex;
      }
      liveDash.paint(d);
    },
    get wheel() {
      return detail === 0 ? steerSpin : null;
    },
    get detailLevel() {
      return detail;
    },
    setDetail(level) {
      if (level === detail) return;
      detail = level;
      applyVisibility();
    },
    setHaloPillar(v) {
      for (const m of pillars) m.visible = v;
    },
    setDriverVisible(v, hands = false) {
      driverVisible = v;
      handsVisible = hands;
      applyVisibility();
    },
    setG(lateral, longitudinal, steer) {
      // pushed toward the outside of the corner, nodding under braking, eyes into the turn
      headT.roll = THREE.MathUtils.clamp(lateral * 0.0045, -0.2, 0.2);
      headT.pitch = THREE.MathUtils.clamp(-longitudinal * 0.004, -0.08, 0.16);
      headT.yaw = THREE.MathUtils.clamp(steer * 1.3, -0.35, 0.35);
    },
    update(dt) {
      if (detail < 2) updateLinks(detail);
      if (detail === 0) updateArms();
      const k = Math.min(1, dt * 7);
      head.roll += (headT.roll - head.roll) * k;
      head.pitch += (headT.pitch - head.pitch) * k;
      head.yaw += (headT.yaw - head.yaw) * Math.min(1, dt * 4);
      for (const p of headPivots) p.rotation.set(head.pitch, head.yaw, head.roll, 'YXZ');
      if (rainOn) {
        // ~4 Hz LED blink: on 55 % of the cycle
        rainT += dt;
        const on = rainT % 0.25 < 0.1375;
        rainLevel = on ? 1 : 0.015;
        // bright enough to bloom, not so bright the bloom swallows your own car in chase view
        uniforms.uRainLight.value = on ? 8 : 0.25;
      }
    },
    setDamage(parts, susp, char) {
      for (const k of PART_IDS) {
        const d = parts[k];
        if (d === partState[k]) continue;
        partState[k] = d;
        const gone = d >= 1;
        const b = Math.min(1, d);
        for (const pv of partPivots[k]) {
          pv.visible = !gone;
          if (k === 'rw') {
            // the upper rear wing folds back and leans
            pv.rotation.set(-0.5 * b * b, 0, 0.12 * b * b);
          } else {
            // the wing half droops at its tip, bends back and twists
            const side = k === 'fwL' ? 1 : -1;
            pv.rotation.set(0.22 * b * b, 0.22 * b * b * side, -0.2 * b * b * side);
            pv.position.y = PART_HINGE[k][1] - 0.04 * b;
          }
        }
      }
      // suspension: the wheel leans in and gets pushed back as the corner folds
      corners.forEach((c, i) => {
        const d = Math.min(1, susp[i] ?? 0);
        const home = cornerHome[i];
        c.group.rotation.z = d * d * 0.38 * -c.side;
        c.group.position.set(home.x - c.side * 0.12 * d * d, home.y - 0.05 * d * d, home.z - (c.front ? 0.18 : 0.08) * d * d);
      });
      if (char !== charLevel) {
        if (char > 0) ensureCharMats();
        charLevel = char;
        const soot = new THREE.Color(0.035, 0.032, 0.03);
        for (const q of charMats) {
          q.m.color.copy(q.color).lerp(soot, Math.min(1, char * 1.1));
          q.m.roughness = THREE.MathUtils.lerp(q.rough, 0.95, char);
          q.m.envMapIntensity = q.env * (1 - 0.75 * char);
          const pm = q.m as THREE.MeshPhysicalMaterial;
          if ('clearcoat' in pm) pm.clearcoat = q.cc * (1 - char);
          if ('sheen' in pm) pm.sheen = q.sheen * (1 - char);
        }
      }
    },
    cloneBroken(part) {
      root.updateWorldMatrix(true, true);
      const out = new THREE.Group();
      const lv = Math.min(detail, 1);
      const isWheel = part in cornerOf;
      const src: THREE.Object3D = isWheel ? cornerOf[part as WheelId].spin : partPivots[part as PartId][lv];
      const wheelMesh = isWheel ? cornerOf[part as WheelId].lv[lv].tyre : null;
      // copy the meshes (the detailed level), baked into one transform relative to the part
      const inv = new THREE.Matrix4().copy(src.matrixWorld).invert();
      src.traverse((o) => {
        const me = o as THREE.Mesh;
        if (!me.isMesh || me.material === blurMat) return;
        if (wheelMesh && me !== wheelMesh) return;
        const c = new THREE.Mesh(me.geometry, me.material);
        c.castShadow = true;
        c.receiveShadow = true;
        c.matrixAutoUpdate = false;
        c.matrix.multiplyMatrices(inv, me.matrixWorld);
        out.add(c);
      });
      src.matrixWorld.decompose(out.position, out.quaternion, out.scale);
      return out;
    },
    setWheelOff(w, amount) {
      const a = Math.min(1, Math.max(0, amount));
      if (a === wheelOff[w]) return;
      const was = wheelOff[w] >= 0.999;
      wheelOff[w] = a;
      // the wheel slides outboard along its axle (+x inside the side flip is outboard on both sides)
      cornerOf[w].spin.position.x = a * 0.42;
      if (was !== a >= 0.999) applyVisibility();
    },
    setWheelLost(w, lost) {
      if (wheelLost[w] === lost) return;
      wheelLost[w] = lost;
      applyVisibility();
    },
    setEnvMap(tex) {
      opts.envMap = tex ?? undefined;
      for (const m of own) if ('envMap' in m) (m as THREE.MeshStandardMaterial).envMap = tex;
    },
    shadowPass(on, full = false) {
      if (on) {
        // the player's car (full) keeps its detailed shadow up close
        if (shadowProxyOn || (detail === 0 && full) || !root.visible) return;
        if (partState.fwL > 0 || partState.fwR > 0 || partState.rw > 0 || wheelLost.wFL || wheelLost.wFR || wheelLost.wRL || wheelLost.wRR) return;
        // mid pit stop (wheels off, on the jacks): the real shape casts the shadow
        if (wheelOff.wFL > 0 || wheelOff.wFR > 0 || wheelOff.wRL > 0 || wheelOff.wRR > 0) return;
        shadowProxyOn = true;
        for (const c of root.children) {
          shadowSaved.push(c.visible);
          c.visible = false;
        }
        shadowProxy.geometry = detail === 0 ? shadowL1 : (SHADOW_GEO[2] ?? shadowProxy.geometry);
        shadowProxy.visible = true;
        // (hidden, its world matrix isn't kept up to date: it sits at the car's origin)
        shadowProxy.matrixWorld.copy(root.matrixWorld);
      } else if (shadowProxyOn) {
        shadowProxyOn = false;
        root.children.forEach((c, i) => (c.visible = shadowSaved[i] ?? c.visible));
        shadowSaved.length = 0;
        shadowProxy.visible = false;
      }
    },
    dispose() {
      root.removeFromParent();
      for (const m of own) m.dispose();
      trimTex.dispose();
      drvTex.dispose();
      liveDash?.tex.dispose();
      releaseGloveTexture(gloveTex);
      releasePaint(team);
      releaseGeo();
    },
  };
  return rig;
}
