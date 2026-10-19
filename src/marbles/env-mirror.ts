import * as THREE from 'three';

/**
 * The paint's mirror: the world seen from under the surface (a camera reflected in the plane of
 * the paint, with an oblique near plane on the surface so nothing below it gets in), drawn small —
 * a third of the screen each way — into a texture the paint shader reads back at its own screen
 * position, bent by its swells. That is what makes a sea of paint read as wet and glossy: the
 * pegs, the clouds and the course standing upside down in it, broken up by the slow waves. (The
 * image light alone can only give the sky.) No shadows are re-rendered for it, and the paint
 * itself is hidden while it is drawn.
 */

const _pos = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _n = new THREE.Vector3(0, 1, 0);
const _view = new THREE.Vector3();
const _look = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();

export class Mirror {
  readonly target: THREE.WebGLRenderTarget;
  readonly camera = new THREE.PerspectiveCamera();
  /** world → the mirror texture's uv (with w) */
  readonly matrix = new THREE.Matrix4();
  /** 0: off (the paint falls back to the image light) */
  enabled = true;
  /** the size of the texture against the drawing buffer */
  scale = 1 / 3;
  private vis: boolean[] = [];

  constructor() {
    this.target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: true });
    this.target.texture.generateMipmaps = false;
  }

  setSize(w: number, h: number) {
    this.target.setSize(Math.max(4, Math.round(w * this.scale)), Math.max(4, Math.round(h * this.scale)));
  }

  /** draws the reflection in the plane y = `y`; `hide` are left out (the paint itself) */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, y: number, hide: THREE.Object3D[]) {
    if (!this.enabled) return;
    camera.updateMatrixWorld();
    _pos.set(0, y, 0);
    _cam.setFromMatrixPosition(camera.matrixWorld);
    // (from under the paint there is nothing to see)
    if (_cam.y <= y + 0.05) return;
    _view.set(_cam.x, 2 * y - _cam.y, _cam.z);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cam);
    _tgt.set(_look.x, 2 * y - _look.y, _look.z);
    const rc = this.camera;
    rc.position.copy(_view);
    rc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_n);
    rc.lookAt(_tgt);
    rc.far = camera.far;
    rc.near = camera.near;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);
    rc.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.matrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // the oblique near plane: the paint's surface (Lengyel)
    _plane.setFromNormalAndCoplanarPoint(_n, _pos).applyMatrix4(rc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const p = rc.projectionMatrix.elements;
    _q.set((Math.sign(_clip.x) + p[8]) / p[0], (Math.sign(_clip.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    _clip.multiplyScalar(2 / _clip.dot(_q));
    p[2] = _clip.x;
    p[6] = _clip.y;
    p[10] = _clip.z + 1 - 0.003;
    p[14] = _clip.w;

    const vis = this.vis;
    hide.forEach((o, i) => {
      vis[i] = o.visible;
      o.visible = false;
    });
    const rt = renderer.getRenderTarget();
    const sh = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, rc);
    renderer.setRenderTarget(rt);
    renderer.shadowMap.autoUpdate = sh;
    hide.forEach((o, i) => (o.visible = vis[i]));
  }
}
