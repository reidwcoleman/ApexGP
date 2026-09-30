import * as THREE from 'three';

/**
 * Car headlights for night races (and twilight).
 *
 * Like the floodlights (env/night.ts), the light the lamps throw is an analytic term patched into
 * three's `lights_fragment_begin` chunk, not real three.js lights: 22 SpotLights would recompile
 * every shader whenever a car appeared or went away and cost every fragment on screen. The
 * `HL_MAX` cars nearest the camera each get one wide, flat beam (both lamps as one source) that
 * lights the road, the kerbs, the barriers and the cars ahead with the material's own BRDF — so a
 * wet track throws back long glossy streaks. Behind the cone, and in daylight, it costs one branch.
 *
 * What you see of the lamps: two LED lenses on the nose with a glare star and an anamorphic streak
 * when a car comes toward the camera, and a faint beam through the air that thickens in rain and
 * mist (instanced: two draws for the whole field).
 */

/** cars whose beams light the world (the nearest to the camera) */
export const HL_MAX = 8;
/** how far the beam carries (m): far enough to see the next braking board on a dark circuit */
const HL_RANGE = 95;
/** beam half-angles: wide across the road, flat vertically (below the axis; above it the cut-off is sharper) */
const TAN_H = Math.tan(THREE.MathUtils.degToRad(28));
const TAN_V = Math.tan(THREE.MathUtils.degToRad(6));

const pos = new Float32Array(HL_MAX * 4);
const dir = new Float32Array(HL_MAX * 4);

/** shared by reference with every lit built-in material (see installHeadlightUniforms) */
export const headlightUniforms = {
  /** per light: xyz world position of the (virtual) source, w intensity (0 = off) */
  pos,
  /** per light: xyz world beam axis (unit), w unused */
  dir,
  /** x lights in use, y 1 / tan(horizontal half-angle), z 1 / tan(vertical half-angle), w range (m) */
  info: { x: 0, y: 1 / TAN_H, z: 1 / TAN_V, w: HL_RANGE },
  color: { r: 1.0, g: 0.975, b: 0.94 },
};

export const HEADLIGHT_PARS = /* glsl */ `
#define HL_MAX ${HL_MAX}
uniform vec4 hlPos[ HL_MAX ];
uniform vec4 hlDir[ HL_MAX ];
uniform vec4 hlInfo;
uniform vec3 hlColor;
`;

/**
 * Appended to `lights_fragment_begin` (after the floodlights). The lamps sit low on the nose; a
 * source that low lights the road at a grazing angle only, so the light comes from a point above
 * the nose instead, and the road (anything facing up) is lit as if the beam met it at a steady
 * angle however far ahead it is — the way a driver sees the road lit out to the next corner. The
 * fall-off is gentler than inverse-square (a focused beam, and the eye adapting to it), so walls
 * and the cars ahead light up 50–100 m away.
 */
export const HEADLIGHT_LIGHT = /* glsl */ `
#if defined( RE_Direct )
if ( hlInfo.x > 0.5 ) {
  vec3 hWp = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
  vec3 hNw = ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz;
  float hUpK = clamp( hNw.y, 0.0, 1.0 );
  hUpK *= hUpK;
  for ( int k = 0; k < HL_MAX; k ++ ) {
    if ( float( k ) >= hlInfo.x ) break;
    vec4 hP = hlPos[ k ];
    vec3 toL = hP.xyz - hWp;
    float d2 = dot( toL, toL );
    if ( d2 > hlInfo.w * hlInfo.w || hP.w <= 0.0 ) continue;
    vec3 fw = hlDir[ k ].xyz;
    // the fragment in the beam's frame: along it, across it, and up
    vec3 ld = -toL;
    float along = dot( ld, fw );
    if ( along < 0.5 ) continue;
    vec3 lf = normalize( vec3( fw.z, 0.0, -fw.x ) + vec3( 1e-5 ) );
    vec3 lu = cross( fw, lf );
    float ex = dot( ld, lf ) / along * hlInfo.y;
    float ey = dot( ld, lu ) / along * hlInfo.z;
    // a real lamp's cut-off: the light stops a degree or so above the axis (no dazzle for the car
    // ahead, whose lower rear catches it), and spreads softly below it onto the road
    ey *= ey > 0.0 ? 3.2 : 1.0;
    float e = ex * ex + ey * ey;
    if ( e >= 1.0 ) continue;
    // a hot centre, soft edges fading out across the road
    float cone = ( 1.0 - smoothstep( 0.1, 1.0, e ) ) * ( 1.0 - 0.45 * smoothstep( 0.0, 0.6, ex * ex ) );
    float d = sqrt( d2 );
    float fall = 1.0 - smoothstep( hlInfo.w * 0.45, hlInfo.w, d );
    vec3 hL = toL / max( d, 1e-3 );
    // the road: lit a little flatter than the grazing angle it really meets it at (the beam is
    // aimed down at it), but a pool that dies away with distance, not an even glow to the horizon
    float hBoost = min( 10.0, max( 1.0, 0.35 * hUpK / max( dot( hNw, hL ), 0.02 ) ) );
    float atten = 1.0 / ( ( d + 2.5 ) * ( 1.0 + d / 35.0 ) );
    IncidentLight hl;
    hl.visible = true;
    hl.direction = normalize( mat3( viewMatrix ) * hL );
    hl.color = hlColor * ( hP.w * cone * fall * hBoost * atten );
    RE_Direct( hl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
}
#endif
`;

/** hand a lit ShaderLib entry's uniforms the headlight uniforms (by reference: clones share them) */
export function installHeadlightUniforms(uniforms: Record<string, THREE.IUniform>) {
  uniforms.hlPos = { value: headlightUniforms.pos };
  uniforms.hlDir = { value: headlightUniforms.dir };
  uniforms.hlInfo = { value: headlightUniforms.info };
  uniforms.hlColor = { value: headlightUniforms.color };
}

// ---------------------------------------------------------------- the lamps (car body frame: +x left, +y up, +z forward)

/** the two LED lenses on the nose */
const LAMPS: [number, number, number][] = [
  [0.104, 0.205, 2.72],
  [-0.104, 0.205, 2.72],
];
/** where the light is computed from (see HEADLIGHT_LIGHT), and its aim: ~25 m ahead on the road */
const SOURCE: [number, number, number] = [0, 0.95, 2.45];
const AIM = new THREE.Vector3(0, -0.038, 1).normalize();
/** light intensity of one car's beam at full night: a pool on the road ~10–40 m ahead that is gone by ~90 m */
const BEAM_I = 46;
/** beam volume: length and end radius (m) */
const BEAM_LEN = 34;
const BEAM_R = 5.5;

const GLARE_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aFace;
attribute float aOn;
uniform float uPix;
uniform float uHaze;
uniform float uFogD;
varying vec2 vQ;
varying float vA;
void main() {
  vQ = position.xy;
  vec3 toCam = cameraPosition - aPos;
  float dist = length( toCam );
  // the lens throws its light forward: a star head-on, a small glow from the side, nothing from behind
  float facing = dot( toCam / max( dist, 1e-3 ), aFace );
  vA = aOn * ( smoothstep( -0.05, 0.75, facing ) + 0.06 * smoothstep( -0.35, 0.0, facing ) );
  float size = max( 0.55 * ( 1.0 + uHaze * 1.4 ), dist * uPix * 6.0 );
  vA *= clamp( 0.55 * ( 1.0 + uHaze ) / size, 0.25, 1.0 ) * ( 1.0 - smoothstep( 500.0, 1200.0, dist ) );
  vA *= exp( -dist * uFogD * 0.7 );
  vec4 mv = modelViewMatrix * vec4( aPos, 1.0 );
  // the streak is wider than it is tall
  mv.xy += position.xy * size * vec2( 2.2, 1.0 );
  // pull toward the camera so the nose does not cut the star
  mv.xyz *= 1.0 - min( 0.6, dist * 0.5 ) / max( dist, 1e-3 );
  gl_Position = projectionMatrix * mv;
}
`;

const GLARE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uHaze;
varying vec2 vQ;
varying float vA;
void main() {
  vec2 q = vQ * vec2( 2.2, 1.0 );
  float r = length( q );
  if ( vA < 0.003 ) discard;
  float core = exp( -r * r * 60.0 ) * 7.0;
  float halo = exp( -r * 5.5 ) * ( 0.3 + 0.6 * uHaze );
  // a thin horizontal streak (the anamorphic flare of a TV lens), slightly blue
  float streak = exp( -abs( vQ.y ) * 55.0 ) * ( 1.0 - abs( vQ.x ) ) * 0.9;
  vec3 c = uColor * ( core + halo ) + uColor * vec3( 0.75, 0.88, 1.15 ) * streak;
  float edge = 1.0 - smoothstep( 0.8, 1.0, max( abs( vQ.x ), abs( vQ.y ) ) );
  gl_FragColor = vec4( c * vA * edge, 0.0 );
}
`;

const BEAM_VERT = /* glsl */ `
attribute float aOn;
varying float vAlong;
varying float vFacing;
varying float vOn;
varying float vH;
varying float vDist;
void main() {
  vOn = aOn;
  // the cone runs along +z from its apex at the lamp
  vAlong = position.z / ${BEAM_LEN.toFixed(1)};
  vec4 wp = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  vec3 n = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * normal );
  vec3 v = normalize( cameraPosition - wp.xyz );
  vFacing = abs( dot( n, v ) );
  // height above the car's ground (the instance origin is the lamp, ~0.2 m up)
  vH = wp.y - ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).y + 0.2;
  vDist = length( cameraPosition - wp.xyz );
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform float uFogD;
varying float vAlong;
varying float vFacing;
varying float vOn;
varying float vH;
varying float vDist;
void main() {
  if ( vOn < 0.01 ) discard;
  float a = vAlong;
  // bright near the lamp, dying away down the beam
  float k = smoothstep( 0.0, 0.04, a ) * pow( 1.0 - a, 2.2 );
  // soft sides: the edges of the cone (seen edge-on) fade to nothing
  k *= pow( vFacing, 1.6 );
  // no hard line where the beam meets the road
  k *= smoothstep( 0.0, 0.35, vH );
  k *= exp( -vDist * uFogD * 0.5 );
  gl_FragColor = vec4( uColor * k * uStrength * vOn, 0.0 );
}
`;

export interface HeadlightCar {
  /** the car's sprung body (lamps ride on it) */
  body: THREE.Object3D;
  /** the car's root (hidden cars are skipped) */
  root: THREE.Object3D;
}

/**
 * The field's headlights: set the level (0 day … 1 night) and haze each frame from the weather,
 * then `update` with the cars right before the frame renders.
 */
export class Headlights {
  readonly group = new THREE.Group();
  private level = 0;
  private haze = 0;
  private fogD = 0;
  private readonly glare: THREE.Mesh;
  private readonly glareU: Record<string, THREE.IUniform>;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aFace: THREE.InstancedBufferAttribute;
  private readonly aOnG: THREE.InstancedBufferAttribute;
  private readonly beams: THREE.InstancedMesh;
  private readonly beamU: Record<string, THREE.IUniform>;
  private readonly aOnB: THREE.InstancedBufferAttribute;
  private readonly max: number;
  private readonly m = new THREE.Matrix4();
  private readonly mb = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly f = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly order: { i: number; d: number }[] = [];
  private readonly srcW: THREE.Vector3[] = [];
  private readonly fwdW: THREE.Vector3[] = [];

  constructor(maxCars = 24) {
    this.max = maxCars;
    this.group.name = 'Headlights';
    this.group.visible = false;
    for (let i = 0; i < maxCars; i++) {
      this.srcW.push(new THREE.Vector3());
      this.fwdW.push(new THREE.Vector3());
      this.order.push({ i, d: 0 });
    }

    // glare: one camera-facing quad per lens
    const n = maxCars * LAMPS.length;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aFace = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.aOnG = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    for (const a of [this.aPos, this.aFace, this.aOnG]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aFace', this.aFace);
    geo.setAttribute('aOn', this.aOnG);
    geo.instanceCount = n;
    this.glareU = {
      uPix: { value: 0.001 },
      uHaze: { value: 0 },
      uFogD: { value: 0 },
      uColor: { value: new THREE.Color(1.0, 0.97, 0.9).multiplyScalar(3) },
    };
    this.glare = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.glareU,
        vertexShader: GLARE_VERT,
        fragmentShader: GLARE_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquation: THREE.AddEquation,
        fog: false,
      }),
    );
    this.glare.frustumCulled = false;
    this.glare.renderOrder = 8991;
    this.glare.name = 'headlight-glare';

    // beams: a flattened open cone per car, apex at the nose, opening along +z
    const cone = new THREE.ConeGeometry(BEAM_R, BEAM_LEN, 20, 1, true);
    cone.translate(0, -BEAM_LEN / 2, 0);
    cone.rotateX(-Math.PI / 2);
    cone.scale(1, 0.32, 1);
    this.aOnB = new THREE.InstancedBufferAttribute(new Float32Array(maxCars), 1);
    this.aOnB.setUsage(THREE.DynamicDrawUsage);
    cone.setAttribute('aOn', this.aOnB);
    this.beamU = {
      uColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
      uStrength: { value: 0 },
      uFogD: { value: 0 },
    };
    this.beams = new THREE.InstancedMesh(
      cone,
      new THREE.ShaderMaterial({
        uniforms: this.beamU,
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        blendEquation: THREE.AddEquation,
        fog: false,
      }),
      maxCars,
    );
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 8990;
    this.beams.castShadow = false;
    this.beams.receiveShadow = false;
    this.beams.name = 'headlight-beams';
    this.group.add(this.beams, this.glare);
  }

  /** 0 = off (day) … 1 = full night; haze 0 … 1 (rain, mist: bigger glare, visible beams); ground fog density (1/m) */
  set(level: number, haze: number, fogDensity = 0) {
    this.level = THREE.MathUtils.clamp(level, 0, 1);
    this.haze = THREE.MathUtils.clamp(haze, 0, 1);
    this.fogD = fogDensity;
  }

  /** place the lamps on the cars and pick the beams that light the world (call right before rendering) */
  update(cars: readonly HeadlightCar[], camera: THREE.Camera) {
    const on = this.level > 0.01 && cars.length > 0;
    this.group.visible = on;
    const info = headlightUniforms.info;
    if (!on) {
      info.x = 0;
      return;
    }
    const k = this.level;
    const cam = camera as THREE.PerspectiveCamera;
    camera.getWorldPosition(this.camPos);
    const h = (typeof window !== 'undefined' && window.innerHeight) || 900;
    this.glareU.uPix.value = cam.isPerspectiveCamera ? (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h : 0.001;
    this.glareU.uHaze.value = this.haze;
    this.glareU.uFogD.value = this.fogD;
    (this.glareU.uColor.value as THREE.Color).setRGB(1.0, 0.97, 0.9).multiplyScalar(2.0 * k);
    this.beamU.uStrength.value = k * (0.02 + 0.14 * this.haze);
    this.beamU.uFogD.value = this.fogD;

    const n = Math.min(cars.length, this.max);
    const aPos = this.aPos.array as Float32Array;
    const aFace = this.aFace.array as Float32Array;
    const aOnG = this.aOnG.array as Float32Array;
    const aOnB = this.aOnB.array as Float32Array;
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      const car = i < n ? cars[i] : null;
      const shown = car !== null && isShown(car.root);
      if (!car || !shown) {
        aOnB[i] = 0;
        for (let j = 0; j < LAMPS.length; j++) aOnG[i * LAMPS.length + j] = 0;
        this.beams.setMatrixAt(i, this.m.identity());
        continue;
      }
      // (this frame's pose: the renderer only refreshes world matrices later)
      car.body.updateWorldMatrix(true, false);
      const mw = car.body.matrixWorld;
      const fwd = this.f.copy(AIM).transformDirection(mw);
      for (let j = 0; j < LAMPS.length; j++) {
        const L = LAMPS[j];
        const p = this.v.set(L[0], L[1], L[2]).applyMatrix4(mw);
        const o = (i * LAMPS.length + j) * 3;
        aPos[o] = p.x;
        aPos[o + 1] = p.y;
        aPos[o + 2] = p.z;
        aFace[o] = fwd.x;
        aFace[o + 1] = fwd.y;
        aFace[o + 2] = fwd.z;
        aOnG[i * LAMPS.length + j] = 1;
      }
      // the beam volume sits between the lenses
      this.mb.makeTranslation(0, LAMPS[0][1], LAMPS[0][2]);
      this.m.multiplyMatrices(mw, this.mb);
      this.beams.setMatrixAt(i, this.m);
      aOnB[i] = 1;
      this.srcW[i].set(SOURCE[0], SOURCE[1], SOURCE[2]).applyMatrix4(mw);
      this.fwdW[i].copy(fwd);
      const o = this.order[live++];
      o.i = i;
      o.d = this.srcW[i].distanceToSquared(this.camPos);
    }
    this.aPos.needsUpdate = true;
    this.aFace.needsUpdate = true;
    this.aOnG.needsUpdate = true;
    this.aOnB.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;

    // the beams that light the world: the cars nearest the camera
    const sorted = this.order.slice(0, live).sort((a, b) => a.d - b.d);
    const m = Math.min(HL_MAX, sorted.length);
    for (let s = 0; s < HL_MAX; s++) {
      const o = s * 4;
      if (s >= m) {
        pos[o] = pos[o + 1] = pos[o + 2] = pos[o + 3] = 0;
        dir[o] = dir[o + 1] = dir[o + 3] = 0;
        dir[o + 2] = 1;
        continue;
      }
      const i = sorted[s].i;
      const src = this.srcW[i];
      const fw = this.fwdW[i];
      pos[o] = src.x;
      pos[o + 1] = src.y;
      pos[o + 2] = src.z;
      pos[o + 3] = BEAM_I * k;
      dir[o] = fw.x;
      dir[o + 1] = fw.y;
      dir[o + 2] = fw.z;
      dir[o + 3] = 0;
    }
    info.x = m;
  }

  /** switch the lighting term off (menus, indoor scenes) without touching the level */
  suspend() {
    this.group.visible = false;
    headlightUniforms.info.x = 0;
  }

  dispose() {
    this.glare.geometry.dispose();
    (this.glare.material as THREE.Material).dispose();
    this.beams.geometry.dispose();
    (this.beams.material as THREE.Material).dispose();
  }
}

function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}
