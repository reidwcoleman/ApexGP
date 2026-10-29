import * as THREE from 'three';

/**
 * The story's markers in the world: a column of light where you have to go (a soft open cylinder
 * that fades up from a bright ring on the ground, rings sliding up it), and a chevron bobbing over
 * a car or a person you have to deal with. Both additive, unlit, drawn through fog lightly so they
 * read from a distance.
 */

const COL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const COL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float y = vUv.y;
  // bright at the foot, fading up; bands sliding upward
  float a = pow( 1.0 - y, 1.6 ) * 0.55 + smoothstep( 0.06, 0.0, y ) * 0.6;
  float bands = smoothstep( 0.0, 0.08, fract( y * 3.0 - uTime * 0.6 ) ) * smoothstep( 0.2, 0.08, fract( y * 3.0 - uTime * 0.6 ) );
  a += bands * ( 1.0 - y ) * 0.35;
  gl_FragColor = vec4( uColor * a * uAlpha, 1.0 );
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length( p );
  float ring = smoothstep( 0.06, 0.0, abs( r - 0.92 ) ) + smoothstep( 0.04, 0.0, abs( r - fract( uTime * 0.5 ) * 0.92 ) ) * 0.5;
  float fill = ( 1.0 - smoothstep( 0.85, 0.95, r ) ) * 0.12;
  gl_FragColor = vec4( uColor * ( ring + fill ) * uAlpha, 1.0 );
}`;

function additive(frag: string, color: THREE.ColorRepresentation) {
  return new THREE.ShaderMaterial({
    vertexShader: COL_VERT,
    fragmentShader: frag,
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
}

export class Beacon {
  readonly group = new THREE.Group();
  private readonly col: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly mats: THREE.ShaderMaterial[];
  radius = 4;

  constructor(color: THREE.ColorRepresentation = 0xffd23f) {
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    cyl.translate(0, 0.5, 0);
    const cm = additive(COL_FRAG, color);
    this.col = new THREE.Mesh(cyl, cm);
    const disc = new THREE.PlaneGeometry(2, 2);
    disc.rotateX(-Math.PI / 2);
    const rm = additive(RING_FRAG, color);
    this.ring = new THREE.Mesh(disc, rm);
    this.ring.position.y = 0.06;
    this.mats = [cm, rm];
    this.group.add(this.col, this.ring);
    this.group.renderOrder = 5;
    this.col.frustumCulled = this.ring.frustumCulled = false;
    this.group.visible = false;
  }

  set(color: THREE.ColorRepresentation) {
    for (const m of this.mats) m.uniforms.uColor.value.set(color);
  }

  place(x: number, y: number, z: number, r: number, height = 7) {
    this.radius = r;
    this.group.position.set(x, y, z);
    this.col.scale.set(r, height, r);
    this.ring.scale.set(r, 1, r);
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  update(t: number, camPos: THREE.Vector3) {
    if (!this.group.visible) return;
    // (a long way off it grows taller so it shows over the roofs)
    const d = camPos.distanceTo(this.group.position);
    const far = THREE.MathUtils.smoothstep(d, 60, 900);
    this.col.scale.y = THREE.MathUtils.lerp(7, 140, far);
    for (const m of this.mats) {
      m.uniforms.uTime.value = t;
      m.uniforms.uAlpha.value = 0.75 + 0.25 * Math.sin(t * 3) * (1 - far);
    }
  }
}

/** a chevron over something to chase, take or destroy */
export class Chevron {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;

  constructor(color: THREE.ColorRepresentation = 0xffd23f) {
    const s = new THREE.Shape();
    s.moveTo(-0.9, 0.7);
    s.lineTo(0, -0.5);
    s.lineTo(0.9, 0.7);
    s.lineTo(0.55, 0.7);
    s.lineTo(0, -0.05);
    s.lineTo(-0.55, 0.7);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: false });
    g.translate(0, 0, -0.125);
    this.mat = new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, opacity: 0.95, depthTest: false });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
  }

  set(color: THREE.ColorRepresentation) {
    this.mat.color.set(color);
  }

  /** over a point (top of the thing), facing the camera, bobbing; scaled with distance */
  at(p: THREE.Vector3, top: number, t: number, cam: THREE.Camera) {
    const d = cam.position.distanceTo(p);
    const k = THREE.MathUtils.clamp(d / 25, 0.8, 9);
    this.mesh.position.set(p.x, p.y + top + 1.2 * k + Math.sin(t * 4) * 0.25 * k, p.z);
    this.mesh.scale.setScalar(k);
    this.mesh.rotation.y = Math.atan2(cam.position.x - p.x, cam.position.z - p.z);
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }
}
