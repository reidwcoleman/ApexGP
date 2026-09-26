import * as THREE from 'three';
import type { Track } from '../Track.ts';

/**
 * Night racing without hundreds of real lights.
 *
 * Every light added to a three.js scene recompiles every shader and costs every
 * fragment, so the circuit floodlights are an analytic term instead: two rows
 * of lamps run along the track (one each side, `P` metres from the centreline,
 * `H` metres up). A small RGBA8 texture over the circuit stores, per ~3 m cell,
 * the distance to the nearest centreline (or pit lane) point, the direction
 * toward it and the track height there; from that, a fragment rebuilds where
 * the two rows are and lights itself from them with the material's own BRDF
 * (`RE_Direct`, so wet asphalt, car paint and visors all get proper highlights),
 * plus a little bounce light. (The axis is stored as a doubled angle so it has
 * no sign flip at the centreline to smear under bilinear filtering.) It reaches
 * every built-in lit material (road,
 * kerbs, terrain, trees, grandstands, crowd, pit buildings, cars) through a
 * patched `lights_fragment_begin` chunk and uniforms shared by reference from
 * ShaderLib — the same trick as the aerial fog — and costs one uniform branch
 * in daylight.
 *
 * `createFloodRig` builds what you see of the lights: poles, emissive lamp
 * heads and camera-facing glare stars (3 instanced draws).
 */

/** texture size (texels per side); fixed, so the one GPU texture is updated in place per circuit */
const N = 1024;
/** lamp row: lateral offset from the centreline (m), height above the track (m), reach of the light (m) */
export const FLOOD_P = 15;
export const FLOOD_H = 19;
const FLOOD_REACH = 240;

const floodData = new Uint8Array(N * N * 4);
const floodTex = new THREE.DataTexture(floodData, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
floodTex.magFilter = THREE.LinearFilter;
floodTex.minFilter = THREE.LinearFilter;
floodTex.wrapS = floodTex.wrapT = THREE.ClampToEdgeWrapping;
floodTex.generateMipmaps = false;
floodTex.colorSpace = THREE.NoColorSpace;
floodTex.name = 'flood-field';

/** shared by reference with every lit built-in material (plain objects: UniformsUtils.clone keeps them shared) */
export const floodUniforms = {
  /** x, z origin (m), 1 / extent (1/m) */
  xform: { x: 0, y: 0, z: 0, w: 0 },
  /** x irradiance at the track (0 = off), y row offset P, z row height H, w reach */
  params: { x: 0, y: FLOOD_P, z: FLOOD_H, w: FLOOD_REACH },
  /** x height at alpha 0, y height range (m) */
  height: { x: 0, y: 1, z: 0, w: 0 },
  color: { r: 0.96, g: 0.98, b: 1.0 },
};

const PARS = /* glsl */ `
uniform sampler2D floodMap;
uniform vec4 floodXform;
uniform vec4 floodParams;
uniform vec4 floodHeight;
uniform vec3 floodColor;
`;

const LIGHT = /* glsl */ `
#if ( NUM_SUN_LIGHTS > 0 ) && defined( RE_Direct )
vec3 floodBounce = vec3( 0.0 );
if ( floodParams.x > 0.0 ) {
  vec3 fWp = ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz;
  vec2 fUv = ( fWp.xz - floodXform.xy ) * floodXform.zw;
  if ( fUv.x > 0.0 && fUv.y > 0.0 && fUv.x < 1.0 && fUv.y < 1.0 ) {
    vec4 fm = texture2D( floodMap, fUv );
    float fd = fm.r * 255.0;
    if ( fd < floodParams.w ) {
      // the axis across the track is stored as a doubled angle (it has no sign, so it stays smooth
      // over the centreline); which way the centre lies is read off the distance a step along it
      vec2 fa2 = fm.gb * 2.0 - 1.0;
      float fAng = 0.5 * atan( fa2.y, fa2.x + 1e-5 );
      vec2 fu = vec2( cos( fAng ), sin( fAng ) );
      float fd2 = texture2D( floodMap, fUv + fu * 3.0 * floodXform.zw ).r * 255.0;
      if ( fd2 > fd ) fu = -fu;
      float fP = floodParams.y;
      float fH = floodParams.z;
      float fy = max( floodHeight.x + fm.a * floodHeight.y + fH - fWp.y, 1.5 );
      float fr0 = sqrt( fP * fP + fH * fH );
      // the lamps are aimed at the track: the light dies away over the run-off and the stands beyond
      float fFade = ( 1.0 - smoothstep( floodParams.w * 0.5, floodParams.w, fd ) ) * exp( -max( fd - fP - 8.0, 0.0 ) / 55.0 );
      // both rows as one light: for diffuse this is exact (N·L is linear in L while both face the
      // point), and it keeps the cost to a single BRDF evaluation
      vec3 fL = vec3( 0.0 );
      float fSum = 0.0;
      float fHSum = 0.0;
      for ( int k = 0; k < 2; k ++ ) {
        float fs = k == 0 ? fd - fP : fd + fP;
        vec3 toL = vec3( fu.x * fs, fy, fu.y * fs );
        float r = length( toL );
        // a row of lamps falls off ~1/r; they aim at the track, so behind the near row there is only spill
        float e = fr0 / max( r, 5.0 );
        if ( k == 0 ) e *= mix( 1.0, 0.22, smoothstep( fP - 3.0, fP + 14.0, fd ) );
        fSum += e;
        fL += toL * ( e / r );
        fHSum += length( toL.xz ) * ( e / r );
      }
      float fLen = length( fL );
      IncidentLight fl;
      fl.visible = true;
      fl.direction = normalize( mat3( viewMatrix ) * ( fL / fLen ) );
      fl.color = floodColor * ( fLen * fFade * floodParams.x );
      RE_Direct( fl, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
      fSum *= fFade * floodParams.x;
      // light bounced off the asphalt and the stands, and scattered in the air
      floodBounce = floodColor * fSum * 0.11;
      // the sideways light the two rows cancel out in the sum still falls on walls and car flanks
      // facing either row: give it back as diffuse to surfaces that face sideways
      vec3 fNw = ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz;
      floodBounce += floodColor * ( ( fHSum - length( fL.xz ) ) * 0.5 * length( fNw.xz ) * fFade * floodParams.x );
    }
  }
}
#if defined( RE_IndirectDiffuse )
irradiance += floodBounce;
#endif
#endif
`;

let installed = false;

/** Patch the light chunks and hand every lit ShaderLib entry the flood uniforms. Idempotent. */
export function installFloodChunk() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin + PARS;
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin + LIGHT;
  for (const key of Object.keys(THREE.ShaderLib)) {
    const sh = (THREE.ShaderLib as Record<string, { uniforms: Record<string, THREE.IUniform> }>)[key];
    if (sh && sh.uniforms && 'sunLights' in sh.uniforms) {
      sh.uniforms.floodMap = { value: floodTex };
      sh.uniforms.floodXform = { value: floodUniforms.xform };
      sh.uniforms.floodParams = { value: floodUniforms.params };
      sh.uniforms.floodHeight = { value: floodUniforms.height };
      sh.uniforms.floodColor = { value: floodUniforms.color };
    }
  }
}
installFloodChunk();

let floodLevel = 0;
let floodOff = false;
/** floodlight irradiance at the track (0 = off); the Environment sets it from the time of day */
export function setFloodLevel(e: number) {
  floodLevel = e;
  floodUniforms.params.x = floodOff ? 0 : e;
}
/** switch the flood term off while the camera is indoors (the menu garage has a roof the term can't see) */
export function suppressFloods(off: boolean) {
  if (off === floodOff) return;
  floodOff = off;
  floodUniforms.params.x = off ? 0 : floodLevel;
}

let fieldFor: Track | null = null;

/**
 * Rasterise the circuit's lamp field into the shared texture (once per circuit, ~30 ms; only
 * when a session is lit). `renderer` uploads it: materials hold clones of the texture that share
 * its GPU storage, so the original has to be the one that uploads.
 */
export function buildFloodField(track: Track, renderer: THREE.WebGLRenderer) {
  if (fieldFor === track) return;
  fieldFor = track;
  const t0 = performance.now();
  // seeds: the centreline, and the middle of the pit lane
  const sx: number[] = [];
  const sz: number[] = [];
  const sy: number[] = [];
  for (let i = 0; i < track.n; i++) {
    sx.push(track.px[i]);
    sz.push(track.pz[i]);
    sy.push(track.py[i]);
  }
  const pit = track.pit;
  if (pit && pit.sEnd > pit.sStart) {
    const p = new THREE.Vector3();
    const lat = pit.side * (pit.laneInner + pit.laneOuter) * 0.5;
    for (let s = pit.sStart; s <= pit.sEnd; s += 1.5) {
      track.point(s, lat, 0, p);
      sx.push(p.x);
      sz.push(p.z);
      sy.push(p.y);
    }
  }
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, miny = Infinity, maxy = -Infinity;
  for (let i = 0; i < sx.length; i++) {
    minx = Math.min(minx, sx[i]); maxx = Math.max(maxx, sx[i]);
    minz = Math.min(minz, sz[i]); maxz = Math.max(maxz, sz[i]);
    miny = Math.min(miny, sy[i]); maxy = Math.max(maxy, sy[i]);
  }
  const M = FLOOD_REACH + 20;
  const ext = Math.max(maxx - minx, maxz - minz) + 2 * M;
  const cell = Math.max(2, ext / N);
  const ox = (minx + maxx) / 2 - (cell * N) / 2;
  const oz = (minz + maxz) / 2 - (cell * N) / 2;
  const hr = Math.max(1, maxy - miny);

  // nearest seed per cell: seed where the line passes, then two raster sweeps (8SSEDT-style)
  const near = new Int32Array(N * N).fill(-1);
  const best = new Float32Array(N * N).fill(Infinity);
  const cx = (gx: number) => ox + (gx + 0.5) * cell;
  const cz = (gz: number) => oz + (gz + 0.5) * cell;
  for (let i = 0; i < sx.length; i++) {
    const gx = Math.floor((sx[i] - ox) / cell);
    const gz = Math.floor((sz[i] - oz) / cell);
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) continue;
    const k = gz * N + gx;
    const d = Math.hypot(cx(gx) - sx[i], cz(gz) - sz[i]);
    if (d < best[k]) {
      best[k] = d;
      near[k] = i;
    }
  }
  const relax = (k: number, gx: number, gz: number, nk: number) => {
    const j = near[nk];
    if (j < 0) return;
    const d = Math.hypot(cx(gx) - sx[j], cz(gz) - sz[j]);
    if (d < best[k]) {
      best[k] = d;
      near[k] = j;
    }
  };
  for (let gz = 0; gz < N; gz++)
    for (let gx = 0; gx < N; gx++) {
      const k = gz * N + gx;
      if (gx > 0) relax(k, gx, gz, k - 1);
      if (gz > 0) {
        relax(k, gx, gz, k - N);
        if (gx > 0) relax(k, gx, gz, k - N - 1);
        if (gx < N - 1) relax(k, gx, gz, k - N + 1);
      }
    }
  for (let gz = N - 1; gz >= 0; gz--)
    for (let gx = N - 1; gx >= 0; gx--) {
      const k = gz * N + gx;
      if (gx < N - 1) relax(k, gx, gz, k + 1);
      if (gz < N - 1) {
        relax(k, gx, gz, k + N);
        if (gx < N - 1) relax(k, gx, gz, k + N + 1);
        if (gx > 0) relax(k, gx, gz, k + N - 1);
      }
    }
  for (let k = 0; k < N * N; k++) {
    const o = k * 4;
    const j = near[k];
    const d = best[k];
    if (j < 0 || d >= 255) {
      floodData[o] = 255;
      floodData[o + 1] = floodData[o + 2] = 128;
      floodData[o + 3] = 0;
      continue;
    }
    const gx = k % N;
    const gz = (k / N) | 0;
    // axis toward the nearest line point as a doubled angle (sign-free); at the line itself, across the track
    let ang: number;
    if (d > 0.5) ang = Math.atan2(sz[j] - cz(gz), sx[j] - cx(gx));
    else {
      const jn = Math.min(j + 1, sx.length - 1), jp = Math.max(j - 1, 0);
      ang = Math.atan2(sz[jn] - sz[jp], sx[jn] - sx[jp]) + Math.PI / 2;
    }
    floodData[o] = Math.round(d);
    floodData[o + 1] = Math.round((Math.cos(2 * ang) * 0.5 + 0.5) * 255);
    floodData[o + 2] = Math.round((Math.sin(2 * ang) * 0.5 + 0.5) * 255);
    floodData[o + 3] = Math.round(((sy[j] - miny) / hr) * 255);
  }
  floodTex.needsUpdate = true;
  renderer.initTexture(floodTex);
  floodUniforms.xform.x = ox;
  floodUniforms.xform.y = oz;
  floodUniforms.xform.z = floodUniforms.xform.w = 1 / (cell * N);
  floodUniforms.height.x = miny;
  floodUniforms.height.y = hr;
  console.info(`[shot] [night] flood field ${N}² @ ${cell.toFixed(1)} m in ${Math.round(performance.now() - t0)} ms`);
}

// ---------------------------------------------------------------- what you see

const GLARE_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aFace;
attribute float aSeed;
uniform float uSize;
uniform float uPix;
uniform float uHaze;
uniform float uFogD;
varying vec2 vQ;
varying float vA;
void main() {
  vQ = position.xy;
  vec3 toCam = cameraPosition - aPos;
  float dist = length( toCam );
  // lamps face the track: a lamp seen from behind is only a dim housing
  float facing = dot( toCam / max( dist, 1e-3 ), aFace );
  vA = smoothstep( -0.25, 0.55, facing ) * ( 0.85 + 0.3 * aSeed );
  // a glare star stays at least a few pixels wide far away, and swells in mist and rain
  float size = max( uSize * ( 1.0 + uHaze * 1.6 ), dist * uPix * 7.0 );
  vA *= clamp( ( uSize * ( 1.0 + uHaze ) ) / size, 0.2, 1.0 ) * ( 1.0 - smoothstep( 900.0, 2400.0, dist ) );
  // lost in fog with distance (a glow survives a little further than the lamp itself)
  vA *= exp( -dist * uFogD * 0.7 );
  vec4 mv = modelViewMatrix * vec4( aPos, 1.0 );
  mv.xy += position.xy * size;
  // pull toward the camera so the housing does not cut the star
  mv.xyz *= 1.0 - min( 1.2, dist * 0.5 ) / max( dist, 1e-3 );
  gl_Position = projectionMatrix * mv;
}
`;

const GLARE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uHaze;
varying vec2 vQ;
varying float vA;
void main() {
  float r = length( vQ );
  if ( r > 1.0 || vA < 0.003 ) discard;
  float core = exp( -r * r * 180.0 ) * 6.0;
  float halo = exp( -r * 7.0 ) * ( 0.35 + 0.5 * uHaze );
  // a four-point diffraction star, a little rotated
  vec2 q = mat2( 0.966, 0.259, -0.259, 0.966 ) * vQ;
  float spikes = ( exp( -abs( q.x ) * 70.0 ) + exp( -abs( q.y ) * 70.0 ) ) * ( 1.0 - r ) * 0.55;
  float a = ( core + halo + spikes ) * vA * ( 1.0 - smoothstep( 0.7, 1.0, r ) );
  gl_FragColor = vec4( uColor * a, 0.0 );
}
`;

export interface FloodRig {
  group: THREE.Group;
  /** light level 0 … 1, haze 0 … 1 (bigger glare in mist/rain), aerial fog density at the ground (1/m) */
  set(level: number, haze: number, fogDensity?: number): void;
  update(camera: THREE.Camera): void;
  readonly count: number;
}

export function createFloodRig(track: Track, groundAt: (x: number, z: number) => number): FloodRig {
  const group = new THREE.Group();
  group.name = 'Floodlights';
  group.visible = false;

  // pole bases along both sides, staggered, behind the barriers, off other parts of the circuit
  const spacing = 46;
  const bases: { x: number; y: number; z: number; fx: number; fz: number }[] = [];
  const p = new THREE.Vector3();
  const c = new THREE.Vector3();
  const pit = track.pit;
  const L = track.length;
  for (let s0 = 0; s0 < L; s0 += spacing) {
    for (const side of [-1, 1] as const) {
      const s = (s0 + (side > 0 ? spacing / 2 : 0)) % L;
      const inPit = pit && side === pit.side && s > pit.sStart - 40 && s < pit.sEnd + 40;
      // the pit side of the main straight: lamps along the pit wall instead of behind the garages
      const lat = inPit
        ? pit.laneInner - 1.2
        : Math.min(track.halfWidthAt(s) + 60, Math.max(track.halfWidthAt(s) + track.kerbAt(s, side) + 5, track.barrierAt(s, side) + 2.8));
      track.point(s, side * lat, 0, p);
      const idx = Math.round(s) % track.n;
      if (track.distanceToOther(p.x, p.z, idx, 140) < lat + 10) continue;
      track.point(s, 0, 0, c);
      const g = inPit ? c.y : Math.max(c.y - 3, Math.min(c.y + 8, groundAt(p.x, p.z)));
      const fx = c.x - p.x;
      const fz = c.z - p.z;
      const fl = Math.hypot(fx, fz) || 1;
      bases.push({ x: p.x, y: g, z: p.z, fx: fx / fl, fz: fz / fl });
    }
  }
  const n = bases.length;

  // poles: slim tapered masts, dark galvanised steel (lit by the floods like everything else)
  const H = FLOOD_H;
  const poleGeo = new THREE.CylinderGeometry(0.16, 0.3, H, 6, 1, true).translate(0, H / 2, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a5e63, roughness: 0.5, metalness: 0.6 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, n));
  poles.name = 'flood-poles';
  // lamp heads: a bank of LED panels on a crossbar, tilted down toward the track
  const headGeo = new THREE.BoxGeometry(3.4, 1.1, 0.3);
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.96, 0.98, 1.0).multiplyScalar(26), fog: true });
  const heads = new THREE.InstancedMesh(headGeo, headMat, Math.max(1, n));
  heads.name = 'flood-heads';
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const aPos = new Float32Array(n * 3);
  const aFace = new Float32Array(n * 3);
  const aSeed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = bases[i];
    m.makeTranslation(b.x, b.y, b.z);
    poles.setMatrixAt(i, m);
    const yaw = Math.atan2(b.fx, b.fz);
    e.set(-0.5, yaw, 0, 'YXZ');
    q.setFromEuler(e);
    const hx = b.x + b.fx * 0.6;
    const hy = b.y + H + 0.4;
    const hz = b.z + b.fz * 0.6;
    m.compose(p.set(hx, hy, hz), q, one);
    heads.setMatrixAt(i, m);
    // the glare sits just in front of the lamp face
    aPos[i * 3] = hx + b.fx * 0.35;
    aPos[i * 3 + 1] = hy - 0.15;
    aPos[i * 3 + 2] = hz + b.fz * 0.35;
    // the face points at the track and ~30° down
    aFace[i * 3] = b.fx * 0.87;
    aFace[i * 3 + 1] = -0.48;
    aFace[i * 3 + 2] = b.fz * 0.87;
    aSeed[i] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
  }
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  poles.computeBoundingSphere();
  heads.computeBoundingSphere();
  poles.castShadow = false;
  poles.receiveShadow = false;
  heads.castShadow = false;
  group.add(poles, heads);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aFace', new THREE.InstancedBufferAttribute(aFace, 3));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
  geo.instanceCount = n;
  const glareU = {
    uSize: { value: 3.2 },
    uPix: { value: 0.001 },
    uHaze: { value: 0 },
    uFogD: { value: 0 },
    uColor: { value: new THREE.Color(0.96, 0.98, 1.0).multiplyScalar(3) },
  };
  const glareMat = new THREE.ShaderMaterial({
    uniforms: glareU,
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
  });
  const glare = new THREE.Mesh(geo, glareMat);
  glare.frustumCulled = false;
  glare.renderOrder = 8990;
  glare.name = 'flood-glare';
  group.add(glare);

  let level = 0;
  return {
    group,
    count: n,
    set(l, haze, fogDensity = 0) {
      glareU.uFogD.value = fogDensity;
      level = l;
      group.visible = l > 0.01 && n > 0;
      const k = Math.min(1, l);
      headMat.color.setRGB(0.96, 0.98, 1.0).multiplyScalar(4 + 26 * k);
      glareU.uColor.value.setRGB(0.96, 0.98, 1.0).multiplyScalar(3 * k);
      glareU.uHaze.value = haze;
    },
    update(camera) {
      if (level <= 0.01) return;
      const cam = camera as THREE.PerspectiveCamera;
      const h = (typeof window !== 'undefined' && window.innerHeight) || 900;
      glareU.uPix.value = cam.isPerspectiveCamera ? (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h : 0.001;
    },
  };
}
