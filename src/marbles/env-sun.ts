import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightShadow } from 'three/addons/lights/SunLightShadow.js';

/**
 * The sun and its shadow: three's SunLight (two cascades in one atlas, fitted to slices of the view
 * frustum, each a bounding sphere snapped to its own texel grid, so a shadow edge stays put while the
 * camera turns and slides instead of crawling) with our own split of the view: the near cascade
 * covers only the first ~`split` metres (the marbles, the planks, the rails: crisp, a few cm a texel)
 * and the far one reaches out to `reach` (the trestles' shadows on the paint 30 m below, the next
 * loop of the course). three's own split (the "practical" average of uniform and log) would hand the
 * near cascade a quarter of the whole range — far too wide for a toy seen from 6 m.
 */

const _orient = new THREE.Matrix4();
const _viewToLight = new THREE.Matrix4();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _c = new THREE.Vector3();
const _near = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _far = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _slice = Array.from({ length: 8 }, () => new THREE.Vector3());
const FADE = 0.12;

/** the shadow's insides that three keeps private (SunLightShadow / LightShadow) */
interface Inner {
  _cameras: THREE.OrthographicCamera[];
  _matrices: THREE.Matrix4[];
  _frustums: THREE.Frustum[];
  _cascadeData: THREE.Vector4[];
  _viewports: THREE.Vector4[];
  _updateMatrix(cam: THREE.OrthographicCamera, m: THREE.Matrix4, f: THREE.Frustum, vp: THREE.Vector4): void;
}

export class StageShadow extends SunLightShadow {
  /** where the near cascade hands over to the far one (m from the camera) */
  split = 34;
  /** how far out anything casts a shadow at all (m) */
  reach = 320;

  override updateMatrices(light: THREE.Light, view?: THREE.Camera) {
    if (!view) return;
    const me = this as unknown as Inner;
    const cam = view as THREE.PerspectiveCamera;
    const insetX = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.x);
    const insetY = Math.min(0.25, (Math.ceil(this.radius) + 1) / this.mapSize.y);
    for (let i = 0; i < 2; i++) me._viewports[i].set(i + insetX, insetY, 1 - 2 * insetX, 1 - 2 * insetY);
    const res = Math.min(this.mapSize.x * (1 - 2 * insetX), this.mapSize.y * (1 - 2 * insetY));
    const near = cam.near;
    const far = Math.max(near + 1e-3, Math.min(this.reach, cam.far));
    const splits = [near, Math.min(this.split, far * 0.5), far];

    _dir.setFromMatrixPosition(light.matrixWorld).negate().normalize();
    _up.set(0, 1, 0);
    if (Math.abs(_up.dot(_dir)) > 0.99) _up.set(0, 0, 1);
    _orient.lookAt(_c.set(0, 0, 0), _dir, _up);
    _viewToLight.copy(_orient).transpose().multiply(cam.matrixWorld);
    let maxZ = -Infinity;
    for (let i = 0; i < 4; i++) {
      const x = i === 0 || i === 1 ? 1 : -1;
      const y = i === 0 || i === 3 ? 1 : -1;
      const n = _near[i].set(x, y, -1).applyMatrix4(cam.projectionMatrixInverse);
      _far[i].copy(n).multiplyScalar(far / near);
      n.applyMatrix4(_viewToLight);
      _far[i].applyMatrix4(_viewToLight);
      maxZ = Math.max(maxZ, n.z, _far[i].z);
    }
    // (casters up to a whole range sunward of the view still throw their shadow into it: the
    // course's upper loops over the lower ones)
    maxZ += far;
    const sNear = this.camera.near;
    for (let i = 0; i < 2; i++) {
      const cNear = i === 0 ? splits[0] : me._cascadeData[0].z;
      const cFar = splits[i + 1];
      const fade = cFar - FADE * (cFar - splits[i]);
      me._cascadeData[i].set(i === 0 ? -1e10 : cNear, cFar, fade, 0);
      const a0 = (cNear - near) / (far - near), a1 = (cFar - near) / (far - near);
      _c.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        _slice[j * 2].lerpVectors(_near[j], _far[j], a0);
        _slice[j * 2 + 1].lerpVectors(_near[j], _far[j], a1);
        _c.add(_slice[j * 2]).add(_slice[j * 2 + 1]);
      }
      _c.multiplyScalar(1 / 8);
      let r2 = 0, minZ = Infinity;
      for (let j = 0; j < 8; j++) {
        r2 = Math.max(r2, _slice[j].distanceToSquared(_c));
        minZ = Math.min(minZ, _slice[j].z);
      }
      // (a bounding sphere: the same size whichever way the camera turns; snapped to whole texels)
      let r = Math.sqrt(r2) / (1 - 1 / res);
      r = Math.ceil(r);
      const tx = (2 * r) / res;
      _c.x = Math.round(_c.x / tx) * tx;
      _c.y = Math.round(_c.y / tx) * tx;
      _c.z = maxZ + sNear;
      _c.applyMatrix4(_orient);
      const sc = me._cameras[i];
      sc.position.copy(_c);
      sc.quaternion.setFromRotationMatrix(_orient);
      sc.left = sc.bottom = -r;
      sc.right = sc.top = r;
      sc.near = sNear;
      sc.far = maxZ - minZ + 2 * sNear;
      sc.updateProjectionMatrix();
      sc.updateMatrixWorld();
      me._updateMatrix(sc, me._matrices[i], me._frustums[i], me._viewports[i]);
    }
  }
}

/** the sun: from `dir` (unit, toward the sun), warm, with its cascaded shadow */
export function makeSun(dir: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number) {
  const sun = new SunLight(color, intensity);
  sun.position.copy(dir).multiplyScalar(100);
  const sh = new StageShadow();
  sh.mapSize.set(2048, 2048);
  sh.camera.near = 0.5;
  sh.bias = -0.0002;
  sh.normalBias = 0.025;
  sh.radius = 2.2;
  sun.shadow = sh;
  sun.castShadow = true;
  return sun as SunLight & { shadow: StageShadow };
}
