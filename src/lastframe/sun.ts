import * as THREE from 'three';
import { LF } from './lighting.ts';

/**
 * Daylight. The bake holds the sky and the bounce; the sun itself is drawn live, so a normal map answers to it and a person
 * walks in and out of it. Nothing that casts a sun shadow moves except people and what they knock over, so the whole village
 * goes into one big depth map once, at load, and only the movers get a small map of their own each frame.
 */
const BIG = 4096;
const SMALL = 1024;
const REACH = 26;

export interface SunInfo {
  dir: number[];
  power: number;
  color: number[];
  sky: number;
}

/** the layer movers go on, so the small map can draw them and nothing else */
export const MOVER = 2;

function depthTarget(n: number) {
  const rt = new THREE.WebGLRenderTarget(n, n, { depthBuffer: true, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  rt.depthTexture = new THREE.DepthTexture(n, n, THREE.UnsignedIntType);
  rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
  return rt;
}

export class Sun {
  private big = depthTarget(BIG);
  private small = depthTarget(SMALL);
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1200);
  private dyn = new THREE.OrthographicCamera(-REACH, REACH, REACH, -REACH, 1, 240);
  private blank = new THREE.MeshBasicMaterial({ colorWrite: false });
  private dir = new THREE.Vector3();
  private rt = new THREE.Vector3();
  private up = new THREE.Vector3();
  private v = new THREE.Vector3();
  private texel = (REACH * 2) / SMALL;
  private wind = new THREE.Vector2(0.31, 0.12);
  every = 1;
  private n = 0;

  constructor(private r: THREE.WebGLRenderer, private scene: THREE.Scene, info: SunInfo) {
    const d = this.dir.set(info.dir[0], info.dir[1], info.dir[2]).normalize();
    LF.sunDir.value.copy(d);
    LF.sunC.value.set(info.color[0], info.color[1], info.color[2]).multiplyScalar(info.power);
    this.rt.crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize();
    this.up.crossVectors(this.rt, d).normalize();
    this.dyn.layers.set(MOVER);
    LF.sunMap.value = this.big.depthTexture;
    LF.dynMap.value = this.small.depthTexture;
    // until the first frame, the small map says nothing is in the way
    const old = r.getRenderTarget();
    r.setRenderTarget(this.small);
    r.clear(false, true, false);
    r.setRenderTarget(old);
  }

  /** once: everything that stands still. c is the middle of the map, R how far round it the map has to reach */
  bake(c: THREE.Vector3, R: number, skip: (o: THREE.Object3D) => boolean, cutout: (o: THREE.Object3D) => boolean) {
    const { r, scene, cam } = this;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.position.copy(c).addScaledVector(this.dir, 600);
    cam.up.copy(this.up);
    cam.lookAt(c);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const hidden: THREE.Object3D[] = [], cut: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) return;
      if (skip(o)) { o.visible = false; hidden.push(o); } else if (cutout(o)) { o.visible = false; cut.push(o); }
    });
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    const keep = r.getRenderTarget();
    r.setRenderTarget(this.big);
    r.clear(true, true, false);
    scene.overrideMaterial = this.blank;
    r.render(scene, cam);
    scene.overrideMaterial = null;
    // leaves keep their holes: drawn with their own materials on top of what's there
    const auto2 = r.autoClear;
    r.autoClear = false;
    const rest: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (o.visible && (o as THREE.Mesh).isMesh && !cut.includes(o)) { rest.push(o); }
    });
    for (const o of rest) o.visible = false;
    for (const o of cut) o.visible = true;
    // their materials read the sun's map, which is what's being drawn: give them the small one for this pass
    LF.sunMap.value = this.small.depthTexture;
    r.render(scene, cam);
    LF.sunMap.value = this.big.depthTexture;
    for (const o of rest) o.visible = true;
    r.autoClear = auto2;
    r.setRenderTarget(keep);
    r.shadowMap.autoUpdate = auto;
    for (const o of hidden) o.visible = true;
    LF.sunVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }

  /** each frame: the movers near the camera, on a grid of texels so their edges don't crawl */
  update(eye: THREE.Vector3, time: number) {
    LF.cloud.value.set(this.wind.x * time * 0.0012, this.wind.y * time * 0.0012);
    if (++this.n % this.every) return;
    const { r, scene, dyn, v, rt, up, dir } = this;
    const a = Math.round(eye.dot(rt) / this.texel) * this.texel, b = Math.round(eye.dot(up) / this.texel) * this.texel, c = eye.dot(dir);
    v.set(0, 0, 0).addScaledVector(rt, a).addScaledVector(up, b).addScaledVector(dir, c + 110);
    dyn.position.copy(v);
    dyn.up.copy(up);
    dyn.lookAt(v.x - dir.x, v.y - dir.y, v.z - dir.z);
    dyn.updateMatrixWorld();
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    const keep = r.getRenderTarget();
    r.setRenderTarget(this.small);
    r.clear(true, true, false);
    scene.overrideMaterial = this.blank;
    r.render(scene, dyn);
    scene.overrideMaterial = null;
    r.setRenderTarget(keep);
    r.shadowMap.autoUpdate = auto;
    LF.dynVP.value.multiplyMatrices(dyn.projectionMatrix, dyn.matrixWorldInverse);
  }
}
