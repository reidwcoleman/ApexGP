import * as THREE from 'three';
import { mistNoise } from './fxTextures.ts';
import type { FxLighting } from './Particles.ts';
import { DEPTH_PARS } from './fxShaders.ts';

/**
 * "Driving in spray": one screen-filling plane a few metres in front of the camera
 * (depth-tested, so your own car in front of it stays clear). Per pixel it integrates
 * spray-mist density analytically along the view ray — from the plane to where the
 * ray meets the road, or leaves the ~6 m layer of spray above it — so the track and
 * cars ahead fade smoothly with distance into lit, wind-drifting mist. No depth
 * texture needed, no banding, 1 draw call, one blended full-screen layer only while
 * there is spray ahead.
 *
 * The amount comes from CarEffects (how much spray the cars in front of the camera
 * are throwing).
 */

const VERT = /* glsl */ `
uniform float uD0;
uniform float uTanHalf;
uniform float uAspect;
uniform float uOn;
varying vec3 vWorld;
void main() {
  vec3 p = vec3( position.x * uD0 * uTanHalf * uAspect * 1.02, position.y * uD0 * uTanHalf * 1.02, -uD0 );
  vWorld = cameraPosition + ( vec4( p, 0.0 ) * viewMatrix ).xyz;
  gl_Position = uOn < 0.5 ? vec4( 2.0, 2.0, 2.0, 1.0 ) : projectionMatrix * vec4( p, 1.0 );
}
`;

const FRAG = /* glsl */ `
${DEPTH_PARS}
uniform sampler2D uNoise;
uniform vec3 uAmb;
uniform vec3 uSunCol;
uniform vec3 uSunDir;
uniform vec2 uDrift;
uniform float uGround;
uniform float uDensity;
uniform float uD0;
uniform float uSlab;
uniform float uMaxD;
varying vec3 vWorld;
void main() {
  vec3 V = normalize( vWorld - cameraPosition );
  float camH = max( cameraPosition.y - uGround, 0.3 );
  // the part of the ray inside the spray layer [ground, ground + slab], beyond the plane
  vec3 camFwd = -vec3( viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2] );
  float cosF = max( dot( V, camFwd ), 0.2 );
  float dIn = uD0 / cosF;
  // up to the opaque surface behind the pixel (scene depth), else the road / the layer top
  float dEnd = min( uMaxD, sceneViewZ() / cosF );
  if ( V.y < -1e-3 ) {
    dEnd = min( dEnd, camH / -V.y );
    if ( camH > uSlab ) dIn = max( dIn, ( camH - uSlab ) / -V.y );
  } else if ( V.y > 1e-3 ) {
    dEnd = min( dEnd, max( uSlab - camH, 0.0 ) / V.y );
  } else if ( camH > uSlab ) dEnd = 0.0;
  float L = max( 0.0, dEnd - dIn );
  // world-anchored drifting clumps, sampled at a representative depth on the ray
  vec3 q = cameraPosition + V * ( dIn + min( L, 40.0 ) * 0.5 );
  vec2 qa = q.xz - uDrift;
  float n1 = texture2D( uNoise, qa * 0.021 ).r;
  float n2 = texture2D( uNoise, vec2( qa.x + qa.y, q.y * 2.0 ) * 0.043 ).g;
  float clump = clamp( 0.45 + ( n1 - 0.5 ) * 1.3 + ( n2 - 0.5 ) * 0.6, 0.15, 1.5 );
  float a = 1.0 - exp( -uDensity * clump * L );
  if ( a < 0.003 ) discard;
  float mu = max( dot( V, uSunDir ), 0.0 );
  float fwd = mu * mu * mu * mu * mu * mu;
  vec3 col = uAmb * ( 1.0 + 0.1 * n2 ) + uSunCol * fwd * 0.7;
  gl_FragColor = vec4( col, min( a, 0.88 ) );
}
`;

export class SprayVeil {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  get material() {
    return this.mat;
  }
  /** 0 … ~3: how much spray is in front of the camera */
  private target = 0;
  private density = 0;
  private drift = new THREE.Vector2();
  private ground = 0;
  /** extinction per metre per unit of spray amount */
  strength = 0.0032;
  /** metres in front of the camera where the veil starts (beyond your own car in chase view) */
  start = 9;

  constructor(depthUniforms: Record<string, THREE.IUniform>) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.mat = new THREE.ShaderMaterial({
      name: 'fx-veil',
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uD0: { value: 7.5 },
        uTanHalf: { value: Math.tan((30 * Math.PI) / 180) },
        uAspect: { value: 16 / 9 },
        uOn: { value: 0 },
        uNoise: { value: mistNoise() },
        uAmb: { value: new THREE.Vector3(0.8, 0.8, 0.8) },
        uSunCol: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uDrift: { value: this.drift },
        uGround: { value: 0 },
        uDensity: { value: 0 },
        uSlab: { value: 6 },
        uMaxD: { value: 260 },
        ...depthUniforms,
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'spray-veil';
    this.mesh.frustumCulled = false;
    // before the spray puffs (drawn in the soft pass, see Particles)
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      const cam = camera as THREE.PerspectiveCamera;
      if (cam.isPerspectiveCamera) {
        this.mat.uniforms.uTanHalf.value = Math.tan((cam.fov * Math.PI) / 360) / (cam.zoom || 1);
        this.mat.uniforms.uAspect.value = cam.aspect;
        // stay inside the near/far range
        this.mat.uniforms.uD0.value = Math.max(cam.near * 2, this.start);
      }
    };
  }

  /** spray amount in front of the camera (0 = clear); groundY = road height near the camera */
  setDensity(amount: number, groundY: number) {
    this.target = Math.max(0, amount);
    this.ground = groundY;
  }

  setLighting(L: FxLighting) {
    const u = this.mat.uniforms;
    (u.uAmb.value as THREE.Vector3).set(L.ambient.r, L.ambient.g, L.ambient.b);
    (u.uSunCol.value as THREE.Vector3).set(L.sunColor.r, L.sunColor.g, L.sunColor.b).multiplyScalar(1 / Math.PI);
    (u.uSunDir.value as THREE.Vector3).copy(L.sunDir);
  }

  update(dt: number, windX: number, windZ: number) {
    if (dt > 0) {
      const k = 1 - Math.exp(-dt * (this.target > this.density ? 2.2 : 1.1));
      this.density += (this.target - this.density) * k;
      this.drift.x += windX * dt;
      this.drift.y += windZ * dt;
    }
    const d = Math.min(this.density, 3) * this.strength;
    const u = this.mat.uniforms;
    u.uDensity.value = d;
    u.uGround.value = this.ground;
    const on = d > 0.00015;
    u.uOn.value = on ? 1 : 0;
    this.mesh.visible = on;
  }

  clear() {
    this.target = this.density = 0;
    this.mesh.visible = false;
  }

  get amount() {
    return this.density;
  }
}
