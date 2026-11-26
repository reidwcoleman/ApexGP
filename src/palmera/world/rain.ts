import * as THREE from 'three';

/** Rain: streaks falling through a box that follows the camera, slanted by the wind. */
const N = 4000;
const SIZE = 60;

const vert = /* glsl */ `
attribute float aEnd;
uniform float uTime;
uniform vec3 uCam;
uniform float uAmount;
varying float vA;
void main() {
  vec3 p = position;
  float fall = 22.0;
  // each drop's own phase in position.y; wrap inside a box round the camera
  float y = mod(p.y - uTime * fall, ${SIZE}.0);
  vec3 w = vec3(mod(p.x - uCam.x + uTime * 3.0, ${SIZE}.0) - ${SIZE / 2}.0, y - ${SIZE / 2}.0, mod(p.z - uCam.z, ${SIZE}.0) - ${SIZE / 2}.0);
  w += uCam;
  // the tail: back up along the fall
  w += aEnd * vec3(-0.12, 0.9, 0.0);
  // thin the rain out by amount
  vA = step(fract(p.x * 13.17 + p.z * 7.31), uAmount) * 0.35;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const frag = /* glsl */ `
varying float vA;
uniform vec3 uColor;
void main() { if (vA <= 0.0) discard; gl_FragColor = vec4(uColor, vA); }`;

export class Rain {
  mesh: THREE.LineSegments;
  u: Record<string, THREE.IUniform>;
  constructor(scene: THREE.Scene) {
    const pos = new Float32Array(N * 6), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * SIZE, y = Math.random() * SIZE, z = Math.random() * SIZE;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.u = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uColor: { value: new THREE.Color(0.75, 0.78, 0.82) } };
    this.mesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.u, transparent: true, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  update(t: number, cam: THREE.Vector3, amount: number, light: number) {
    this.mesh.visible = amount > 0.01;
    this.u.uTime.value = t;
    (this.u.uCam.value as THREE.Vector3).copy(cam);
    this.u.uAmount.value = amount;
    (this.u.uColor.value as THREE.Color).setScalar(0.25 + 0.6 * light);
  }
}
