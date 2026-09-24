import * as THREE from 'three';

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
varying float vAlpha;
varying vec2 vQuad;

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
  vAlpha = smoothstep( r, r * 0.55, dist ) * smoothstep( 0.35, 1.4, dist ) * thin * ( 0.55 + 0.45 * aSeed.w );
  // longer streaks spread the same water over more pixels
  vAlpha *= clamp( 0.9 / ( len * 2.0 + 0.2 ), 0.12, 1.0 );
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying vec2 vQuad;
void main() {
  float across = 1.0 - vQuad.x * vQuad.x;
  float along = smoothstep( 0.0, 0.25, vQuad.y ) * smoothstep( 1.0, 0.6, vQuad.y );
  float a = vAlpha * across * along * uOpacity;
  if ( a < 0.002 ) discard;
  gl_FragColor = vec4( uColor * a, a );
}
`;

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
    uColor: { value: new THREE.Color(0.5, 0.5, 0.55) },
    uOpacity: { value: opacity },
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
    blendDst: THREE.OneFactor,
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
  readonly drops: number;
}

export function createRain(): RainSystem {
  const group = new THREE.Group();
  group.name = 'Rain';
  const near = makeLayer(14000, 26, 0.0045, 9.5, 0.55, 11);
  const far = makeLayer(12000, 110, 0.03, 8.5, 0.16, 29);
  group.add(near.mesh, far.mesh);
  const layers = [near, far];
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
      }
      for (const l of layers) {
        (l.uniforms.uWind.value as THREE.Vector3).set(wx * 0.9, 0, wz * 0.9);
        (l.uniforms.uColor.value as THREE.Color).copy(color);
      }
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
        l.uniforms.uShutter.value = 1 / 55;
      }
    },
    get drops() {
      return layers.reduce((s, l) => s + l.mesh.geometry.instanceCount, 0);
    },
  };
}
