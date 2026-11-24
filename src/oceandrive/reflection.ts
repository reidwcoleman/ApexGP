import * as THREE from 'three';

/**
 * The bay's mirror: the scene seen from under the water's surface (the camera reflected in the plane
 * y = h), at reduced resolution and only the big things (the sky, the skyline, the tiles' towers, the
 * beach block's hotels: whatever is on layer REFLECT). The water shader looks it up through the
 * reflection's own projection, bent by the waves. Skipped when the camera is nowhere near the bay.
 */
export const REFLECT = 5;

export class PlanarReflection {
  readonly rt: THREE.WebGLRenderTarget;
  readonly texMatrix = new THREE.Matrix4();
  readonly cam = new THREE.PerspectiveCamera();
  private frame = 0;
  active = false;
  private readonly plane = new THREE.Plane();
  private readonly clip = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly v = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly tgt = new THREE.Vector3();
  private readonly rot = new THREE.Matrix4();
  private readonly N = new THREE.Vector3(0, 1, 0);

  constructor(readonly h: number, w = 960, hgt = 540) {
    this.rt = new THREE.WebGLRenderTarget(w, hgt, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
    this.cam.layers.set(REFLECT);
  }

  setSize(w: number, h: number) {
    this.rt.setSize(Math.max(64, Math.round(w * 0.5)), Math.max(64, Math.round(h * 0.5)));
  }

  /** render the reflection (every other frame) when want is true */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, want: boolean) {
    this.active = want;
    if (!want || (this.frame++ & 1) === 1) return;
    const C = this.cam;
    const P0 = new THREE.Vector3(camera.position.x, this.h, camera.position.z);
    const camPos = this.v.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= this.h + 0.05) return;
    // mirrored position and target (as three's Reflector)
    const view = P0.clone().sub(camPos).reflect(this.N).negate().add(P0);
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(camPos);
    this.tgt.subVectors(P0, this.look).reflect(this.N).negate().add(P0);
    C.position.copy(view);
    C.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.N);
    C.lookAt(this.tgt);
    C.far = camera.far;
    C.near = camera.near;
    C.updateMatrixWorld();
    C.projectionMatrix.copy(camera.projectionMatrix);
    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMatrix.multiply(C.projectionMatrix).multiply(C.matrixWorldInverse);
    // oblique near plane at the water (nothing under the surface draws into the mirror)
    this.plane.setFromNormalAndCoplanarPoint(this.N, P0).applyMatrix4(C.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = C.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + pm[8]) / pm[0], (Math.sign(this.clip.y) + pm[9]) / pm[5], -1, (1 + pm[10]) / pm[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    pm[2] = this.clip.x;
    pm[6] = this.clip.y;
    pm[10] = this.clip.z + 1 - 0.003;
    pm[14] = this.clip.w;
    C.projectionMatrixInverse.copy(C.projectionMatrix).invert();
    const prevT = renderer.getRenderTarget();
    const sm = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, C);
    renderer.setRenderTarget(prevT);
    renderer.shadowMap.autoUpdate = sm;
  }
}

/** put an object (and everything under it) in the mirror */
export function reflectable(o: THREE.Object3D, test: (m: THREE.Mesh) => boolean = () => true) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh && test(m)) m.layers.enable(REFLECT);
  });
}
