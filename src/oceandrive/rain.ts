import * as THREE from 'three';
import { U } from './materials.ts';

/**
 * Rain: twelve thousand drops in a 50 m box that travels with the camera, each a streak along its
 * fall (the motion blur a camera would see), slanted by the wind. Positions come from the drop's
 * seed and the time on the GPU, so nothing is updated per frame but two uniforms. The drops take
 * the sky's light and glint near the lamps at night.
 */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const N = 12000;
    const seed = new Float32Array(N * 2 * 4);
    for (let i = 0; i < N; i++) {
      const a = Math.random(), b = Math.random(), c = Math.random(), sp = 0.8 + Math.random() * 0.4;
      for (let e = 0; e < 2; e++) seed.set([a, b, c, e === 0 ? sp : -sp], (i * 2 + e) * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: U.uTime,
        uRain: U.uRain,
        uWind: U.uWind,
        uCam: { value: new THREE.Vector3() },
        uCol: { value: new THREE.Vector3(0.5, 0.55, 0.6) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime;
        uniform float uRain;
        uniform float uWind;
        uniform vec3 uCam;
        varying float vA;
        void main() {
          const float B = 50.0, H = 26.0;
          float sp = abs( seed.w );
          float fall = 9.0 * sp;
          vec3 wind = vec3( 2.2, 0.0, 1.2 ) * uWind;
          vec3 vel = vec3( wind.x, -fall, wind.z );
          // where the drop is in the box: its seed, carried by its fall, wrapped round the camera
          vec3 p = vec3( seed.x * B, seed.y * H, seed.z * B ) + vel * uTime;
          p = mod( p - ( uCam - vec3( B, H, B ) * 0.5 ), vec3( B, H, B ) ) + uCam - vec3( B, H, B ) * 0.5;
          // the streak's tail: where it was 1/25 s ago
          if ( seed.w < 0.0 ) p -= vel * 0.035;
          // fewer drops when the rain eases (the seed decides who stays)
          float on = step( seed.y, uRain );
          vA = on * ( 1.0 - smoothstep( 8.0, 25.0, length( p - uCam ) ) );
          gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCol;
        varying float vA;
        void main() {
          if ( vA <= 0.0 ) discard;
          gl_FragColor = vec4( uCol * vA * 0.6, 1.0 );
        }`,
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** col: the light the drops catch (the fog's colour, brighter) */
  update(cam: THREE.Vector3, rain: number, col: THREE.Vector3) {
    this.mesh.visible = rain > 0.02;
    (this.mat.uniforms.uCam.value as THREE.Vector3).copy(cam);
    (this.mat.uniforms.uCol.value as THREE.Vector3).copy(col).multiplyScalar(1.6).addScalar(0.02);
  }
}
