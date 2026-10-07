import * as THREE from 'three';
import { HL_MAX, headlightUniforms } from './headlights.ts';

/**
 * GPU rain around the camera.
 *
 * Two instanced layers of streaks (near: dense and thin, far: sparse sheets that
 * read as falling curtains). Every drop lives in a cube that wraps around the
 * camera in the vertex shader (no CPU work per drop); a spherical fade hides the
 * cube. A streak is the drop's path during the shutter time *relative to the
 * camera*, so at 300 km/h the rain turns into near-horizontal lines rushing at
 * the lens, and it slants with the wind. Streaks are lit by the sky (and
 * lightning) and drawn additively after the opaque pass, depth-tested.
 * `mesh.count` scales with the rain rate, so drizzle costs almost nothing.
 */

const VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCam;
uniform vec3 uCamVel;
uniform vec3 uWind;
uniform float uTime;
uniform float uSize;
uniform float uFall;
uniform float uShutter;
uniform float uWidth;
uniform float uPixel;
uniform float uZoom;
uniform float uSheets;
uniform vec3 uSunDirR;
uniform vec4 hlPos[ ${HL_MAX} ];
uniform vec4 hlDir[ ${HL_MAX} ];
uniform vec4 hlInfo;
varying float vAlpha;
varying vec2 vQuad;
varying float vGlint;
varying float vLamp;

void main() {
  float fall = uFall * ( 0.8 + 0.4 * aSeed.w );
  vec3 vel = vec3( uWind.x, -fall, uWind.z );
  vec3 base = aSeed.xyz * uSize + vel * uTime;
  vec3 rel = mod( base - uCam, uSize ) - 0.5 * uSize;
  vec3 p = uCam + rel;
  // streak: where the drop was relative to the camera one shutter-time ago
  vec3 rv = vel - uCamVel;
  float rl = length( rv );
  vec3 dir = rv / max( rl, 1e-3 );
  float len = clamp( rl * uShutter, 0.06, 4.5 );
  float dist = length( rel );
  vec3 side = normalize( cross( dir, rel + vec3( 1e-3, 0.0, 0.0 ) ) );
  // keep streaks at least ~1 px wide, conserving their brightness
  float w = max( uWidth, dist * uPixel * 0.9 );
  float thin = uWidth / w;
  vec3 wp = p - dir * len * position.y + side * w * position.x;
  vQuad = position.xy;
  float r = 0.5 * uSize;
  // a long lens magnifies the drops next to it into thick bars (and they'd be out of focus): start later
  vAlpha = smoothstep( r, r * 0.55, dist ) * smoothstep( 0.35 * uZoom, 1.4 * uZoom, dist ) * thin * ( 0.55 + 0.45 * aSeed.w ) / ( 1.0 + 0.2 * ( uZoom - 1.0 ) );
  // drops between the lens and a low sun light up (forward scattering): a shower glitters
  float mu = max( dot( rel / max( dist, 1e-3 ), uSunDirR ), 0.0 );
  // (two lobes: the broad glow of sunlit drops anywhere toward the sun, and the hard sparkle of
  // those nearly in line with it — the silver threads against dark trees in a sun shower)
  float mu2 = mu * mu;
  float mu8 = mu2 * mu2 * mu2 * mu2;
  vGlint = 0.6 * mu2 + 1.4 * mu8 * mu8;
  // drops falling through a car's headlight beam light up (night races in the rain)
  vLamp = 0.0;
  for ( int k = 0; k < ${HL_MAX}; k ++ ) {
    if ( float( k ) >= hlInfo.x ) break;
    vec3 fw = hlDir[ k ].xyz;
    vec3 ld = p - hlPos[ k ].xyz;
    float al = dot( ld, fw );
    if ( al < 0.5 || al > 60.0 ) continue;
    vec3 lf = normalize( vec3( fw.z, 0.0, -fw.x ) + vec3( 1e-5 ) );
    vec3 lu = cross( fw, lf );
    float ex = dot( ld, lf ) / al * hlInfo.y;
    float ey = dot( ld, lu ) / al * hlInfo.z * 0.6;
    float e = ex * ex + ey * ey;
    if ( e < 1.0 ) vLamp += hlPos[ k ].w * ( 1.0 - e ) / ( length( ld ) + 2.5 );
  }
  // longer streaks spread the same water over more pixels (but each streak here stands for a
  // bundle of the hundreds of drops per m³ a real shower has: it stays readable when it smears)
  vAlpha *= clamp( 0.9 / ( len * 1.4 + 0.2 ), 0.25, 1.0 );
  // a downpour falls in sheets: gust-driven bands of heavier rain sweeping across with the wind
  // (the curtains you see marching down the straight in a storm), lighter rain between them
  if ( uSheets > 0.0 ) {
    vec2 wd = length( uWind.xz ) > 0.3 ? normalize( uWind.xz ) : vec2( 0.8, 0.6 );
    float a1 = dot( p.xz, wd ) * 0.075 - uTime * ( 0.35 + 0.075 * length( uWind.xz ) );
    float a2 = dot( p.xz, vec2( -wd.y, wd.x ) ) * 0.031 + a1 * 0.4;
    float band = 0.5 + 0.32 * sin( a1 * 6.2832 ) + 0.18 * sin( a2 * 6.2832 + 1.7 );
    vAlpha *= mix( 1.0, 0.3 + 1.5 * smoothstep( 0.3, 0.85, band ), uSheets );
  }
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uGlint;
uniform float uOpacity;
uniform vec3 hlColor;
varying float vAlpha;
varying vec2 vQuad;
varying float vGlint;
varying float vLamp;
void main() {
  float across = 1.0 - vQuad.x * vQuad.x;
  float along = smoothstep( 0.0, 0.25, vQuad.y ) * smoothstep( 1.0, 0.6, vQuad.y );
  float a = vAlpha * across * along * uOpacity;
  if ( a < 0.002 ) discard;
  // premultiplied: the streak's light is added, and a drop also blocks a little of what is behind
  // it — so rain still reads against a bright sky, as grey streaks, instead of vanishing
  gl_FragColor = vec4( ( uColor + uGlint * vGlint + hlColor * vLamp * 0.18 ) * a, a * 0.45 );
}
`;

// splashes: each drop hitting the asphalt throws a little crown of droplets and a ring
const SPLASH_VERT = /* glsl */ `
attribute vec4 aSplash; // xyz position, w birth time
attribute float aSize;
uniform float uTime;
uniform float uLife;
uniform vec3 uCam;
varying vec2 vQ;
varying float vT;
varying float vSeed;
varying float vFade;
void main() {
  float age = uTime - aSplash.w;
  vT = age / uLife;
  vSeed = fract( aSplash.x * 3.17 + aSplash.z * 1.91 );
  if ( vT < 0.0 || vT > 1.0 ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    return;
  }
  vQ = position.xy;
  // cylindrical billboard: stands upright, turns to face the camera
  vec3 toCam = uCam - aSplash.xyz;
  // (right under the lens a splash would be a big white blot: fade those)
  vT = mix( 2.0, vT, smoothstep( 2.5, 6.0, length( toCam ) ) );
  // a crown is a few millimetres of water: past ~20 m (and down a long lens) the splashes only
  // make the surface fizz — at full strength they read as white popcorn scattered on the road
  vFade = 1.0 - 0.7 * smoothstep( 12.0, 45.0, length( toCam ) );
  vec2 f = normalize( toCam.xz + vec2( 1e-4 ) );
  vec3 right = vec3( -f.y, 0.0, f.x );
  vec3 wp = aSplash.xyz + right * position.x * aSize + vec3( 0.0, position.y * aSize * 1.3, 0.0 );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}
`;

const SPLASH_FRAG = /* glsl */ `
uniform vec3 uColor;
varying vec2 vQ;
varying float vT;
varying float vSeed;
varying float vFade;
void main() {
  float t = vT;
  float a = 0.0;
  // droplets thrown up and out on little parabolas
  for ( int i = 0; i < 5; i++ ) {
    float fi = float( i );
    float dx = ( fi - 2.0 ) * 0.36 + ( fract( vSeed * ( 7.0 + fi * 3.1 ) ) - 0.5 ) * 0.2;
    float up = 0.75 + 0.5 * fract( vSeed * ( 13.0 + fi * 5.7 ) ) - abs( fi - 2.0 ) * 0.14;
    vec2 p = vec2( dx * t * 1.6, up * ( 2.4 * t - 2.6 * t * t ) );
    vec2 d = ( vQ - p ) * vec2( 1.0, 0.5 );
    a += exp( -dot( d, d ) * 320.0 );
  }
  // the crown wall, low and brief, and the ring spreading on the water
  float crown = exp( -pow( ( abs( vQ.x ) - t * 0.9 ) * 14.0, 2.0 ) ) * smoothstep( 0.35 * ( 1.0 - t ), 0.0, vQ.y ) * step( 0.0, vQ.y ) * ( 1.0 - t );
  a = a * ( 1.0 - t * 0.6 ) + crown * 0.8;
  a *= smoothstep( 1.0, 0.7, t ) * vFade;
  if ( a < 0.004 ) discard;
  gl_FragColor = vec4( uColor * a, a );
}
`;

/** where a drop lands: sets `out` to the wet surface point and returns true, or false (no splash there) */
export type SplashSurface = (x: number, z: number, out: THREE.Vector3) => boolean;

interface Layer {
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  max: number;
  uniforms: Record<string, THREE.IUniform>;
}

function makeLayer(max: number, size: number, width: number, fall: number, opacity: number, seed: number): Layer {
  const geo = new THREE.InstancedBufferGeometry();
  const quad = new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]);
  geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const seeds = new Float32Array(max * 4);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < max * 4; i++) seeds[i] = rnd();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = 0;
  const uniforms: Record<string, THREE.IUniform> = {
    uCam: { value: new THREE.Vector3() },
    uCamVel: { value: new THREE.Vector3() },
    uWind: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uSize: { value: size },
    uFall: { value: fall },
    uShutter: { value: 1 / 60 },
    uWidth: { value: width },
    uPixel: { value: 0.001 },
    uZoom: { value: 1 },
    uSheets: { value: 0 },
    uSunDirR: { value: new THREE.Vector3(0, 1, 0) },
    uGlint: { value: new THREE.Color(0, 0, 0) },
    uColor: { value: new THREE.Color(0.5, 0.5, 0.55) },
    uOpacity: { value: opacity },
    // the cars' headlights (shared by reference, see env/headlights.ts)
    hlPos: { value: headlightUniforms.pos },
    hlDir: { value: headlightUniforms.dir },
    hlInfo: { value: headlightUniforms.info },
    hlColor: { value: headlightUniforms.color },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendEquation: THREE.AddEquation,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9000;
  mesh.name = 'Rain';
  return { mesh, max, uniforms };
}

export interface RainSystem {
  group: THREE.Group;
  /** rain rate 0 … 1, wind (m/s), streak colour (linear radiance) */
  set(rain: number, windX: number, windZ: number, color: THREE.Color): void;
  update(dt: number, camera: THREE.Camera): void;
  setDensity(scale: number): void;
  /** the sun seen through the rain: direction toward it and its glint colour (0 = none) */
  setSun(dir: THREE.Vector3, glint: THREE.Color): void;
  /** splashes land on this surface (the track); without one there are none */
  setSurface(fn: SplashSurface | null): void;
  /** the point the splashes crowd round (the car being watched) */
  setFocus(p: THREE.Vector3): void;
  readonly drops: number;
}

export function createRain(): RainSystem {
  const group = new THREE.Group();
  group.name = 'Rain';
  // (a real shower has ~100–300 drops a cubic metre big enough to see (Marshall–Palmer): each of
  // these streaks stands for many of them, so it is brighter than one drop would be)
  const near = makeLayer(14000, 26, 0.0045, 9.5, 1.1, 11);
  const far = makeLayer(12000, 110, 0.03, 8.5, 0.16, 29);
  group.add(near.mesh, far.mesh);
  const layers = [near, far];
  const base = layers.map((l) => ({ width: l.uniforms.uWidth.value as number, fall: l.uniforms.uFall.value as number, opacity: l.uniforms.uOpacity.value as number }));

  // splash pool: a ring buffer of instances, re-seeded on the CPU as drops land
  const SPLASH_MAX = 900;
  const sGeo = new THREE.InstancedBufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
  sGeo.setIndex([0, 1, 2, 2, 1, 3]);
  const sData = new Float32Array(SPLASH_MAX * 4).fill(-1e4);
  const sSize = new Float32Array(SPLASH_MAX).fill(0.1);
  const sAttr = new THREE.InstancedBufferAttribute(sData, 4);
  sAttr.setUsage(THREE.DynamicDrawUsage);
  sGeo.setAttribute('aSplash', sAttr);
  const zAttr = new THREE.InstancedBufferAttribute(sSize, 1);
  zAttr.setUsage(THREE.DynamicDrawUsage);
  sGeo.setAttribute('aSize', zAttr);
  sGeo.instanceCount = SPLASH_MAX;
  const sU = { uTime: { value: 0 }, uLife: { value: 0.28 }, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color(0.5, 0.5, 0.55) } };
  const sMat = new THREE.ShaderMaterial({
    uniforms: sU,
    vertexShader: SPLASH_VERT,
    fragmentShader: SPLASH_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendEquation: THREE.AddEquation,
    fog: false,
  });
  const splashes = new THREE.Mesh(sGeo, sMat);
  splashes.frustumCulled = false;
  splashes.renderOrder = 8995;
  splashes.name = 'RainSplashes';
  group.add(splashes);
  let surface: SplashSurface | null = null;
  const focusP = new THREE.Vector3();
  let haveFocus = false;
  let sNext = 0;
  let sAcc = 0;
  const sp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  let rain = 0;
  let density = 1;
  let time = 0;
  const lastCam = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const step = new THREE.Vector3();
  let have = false;

  const applyCount = () => {
    const k = rain <= 0.01 ? 0 : Math.pow(rain, 0.75) * density;
    for (const l of layers) l.mesh.geometry.instanceCount = Math.floor(l.max * Math.min(1, k));
    group.visible = k > 0;
  };

  return {
    group,
    set(r, wx, wz, color) {
      if (Math.abs(r - rain) > 0.004) {
        rain = r;
        applyCount();
        // the drops themselves change with the rate: drizzle is a mist of ~0.5 mm drops falling at
        // 2–4 m/s (fine, short, faint streaks), a downpour 2–5 mm drops at 7–9 m/s (thick, long,
        // bright) — terminal velocity after Gunn & Kinzer (1949)
        const k = Math.min(1, r);
        const fall = 0.3 + 0.7 * Math.pow(k, 0.7);
        layers.forEach((l, i) => {
          l.uniforms.uFall.value = base[i].fall * fall;
          l.uniforms.uWidth.value = base[i].width * (0.5 + 0.6 * k);
          l.uniforms.uOpacity.value = base[i].opacity * (0.55 + 0.55 * k);
          l.uniforms.uSheets.value = Math.min(1, Math.max(0, (k - 0.6) / 0.35));
        });
      }
      for (const l of layers) {
        (l.uniforms.uWind.value as THREE.Vector3).set(wx * 0.9, 0, wz * 0.9);
        (l.uniforms.uColor.value as THREE.Color).copy(color);
      }
      sU.uColor.value.copy(color).multiplyScalar(0.5);
    },
    setSun(dir, glint) {
      for (const l of layers) {
        (l.uniforms.uSunDirR.value as THREE.Vector3).copy(dir);
        (l.uniforms.uGlint.value as THREE.Color).copy(glint);
      }
    },
    setSurface(fn) {
      surface = fn;
    },
    setFocus(p) {
      focusP.copy(p);
      haveFocus = true;
    },
    setDensity(scale) {
      density = scale;
      applyCount();
    },
    update(dt, camera) {
      if (!group.visible) {
        have = false;
        return;
      }
      time += dt;
      const pos = camera.getWorldPosition(tmp);
      if (have && dt > 0) {
        const jump = pos.distanceTo(lastCam);
        if (jump > 25) vel.set(0, 0, 0);
        else vel.lerp(step.copy(pos).sub(lastCam).divideScalar(dt), Math.min(1, dt * 12));
      }
      lastCam.copy(pos);
      have = true;
      const cam = camera as THREE.PerspectiveCamera;
      const h = window.innerHeight || 900;
      const pixel = cam.isPerspectiveCamera ? (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / h : 0.001;
      for (const l of layers) {
        l.uniforms.uTime.value = time;
        (l.uniforms.uCam.value as THREE.Vector3).copy(pos);
        (l.uniforms.uCamVel.value as THREE.Vector3).copy(vel);
        l.uniforms.uPixel.value = pixel;
        l.uniforms.uZoom.value = cam.isPerspectiveCamera ? Math.max(1, Math.min(6, 50 / cam.fov)) : 1;
        l.uniforms.uShutter.value = 1 / 55;
      }
      // splashes round the car being watched (or ahead of the camera), up to ~2600 drops a second
      sU.uTime.value = time;
      sU.uCam.value.copy(pos);
      splashes.visible = !!surface && rain > 0.05;
      if (splashes.visible && dt > 0) {
        camera.getWorldDirection(fwd);
        const cx = haveFocus && pos.distanceTo(focusP) < 60 ? focusP.x : pos.x + fwd.x * 10;
        const cz = haveFocus && pos.distanceTo(focusP) < 60 ? focusP.z : pos.z + fwd.z * 10;
        sAcc += dt * 2600 * Math.min(1, rain * 1.3) * density;
        let n = Math.min(160, Math.floor(sAcc));
        sAcc -= n;
        let touched = false;
        while (n-- > 0) {
          const r = 24 * Math.sqrt(Math.random());
          const a = Math.random() * Math.PI * 2;
          if (!surface!(cx + Math.cos(a) * r, cz + Math.sin(a) * r, sp)) continue;
          const k = sNext;
          sNext = (sNext + 1) % SPLASH_MAX;
          sData[k * 4] = sp.x;
          sData[k * 4 + 1] = sp.y + 0.01;
          sData[k * 4 + 2] = sp.z;
          sData[k * 4 + 3] = time - Math.random() * dt;
          sSize[k] = 0.08 + 0.09 * Math.random();
          touched = true;
        }
        if (touched) {
          sAttr.needsUpdate = true;
          zAttr.needsUpdate = true;
        }
      }
    },
    get drops() {
      return layers.reduce((s, l) => s + l.mesh.geometry.instanceCount, 0);
    },
  };
}
