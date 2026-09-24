import * as THREE from 'three';
import { ssrUniforms } from './materials.ts';
import { weatherUniforms } from '../weatherUniforms.ts';

/**
 * Screen-space reflections for the wet road, and nothing else.
 *
 * The road meshes draw after every other opaque object (renderOrder 1). Just
 * before the first road chunk draws in the main camera's scene pass, this
 * blits the colour + depth rendered so far (cars, walls, trees, sky) into a
 * half-resolution target; the road shader then marches its reflected ray
 * through that depth and blends the hit colour into its specular radiance.
 * One blit per frame; the march only runs on wet, glossy
 * road pixels (uSsrOn is 0 on a dry track and for every other camera/pass).
 */
export class RoadSSR {
  mainCamera: THREE.Camera | null = null;
  enabled = true;
  /** below this wetness the march is skipped entirely */
  minWetness = 0.04;
  /** the copy is this many times smaller than the scene target (2 = half res) */
  downscale = 3;
  /** overrides the quality-driven downscale when set */
  fixedDownscale: number | null = null;
  /** debug: copy the buffers but don't march (to time the copy alone) */
  copyOnly = false;
  private rt: THREE.WebGLRenderTarget | null = null;
  private lastFrame = -1;
  private lastOk = 0;
  private srcKey = '';

  hook(mesh: THREE.Mesh) {
    mesh.onBeforeRender = (renderer, scene, camera) => this.before(renderer, scene, camera);
  }

  private before(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const U = ssrUniforms;
    const frame = renderer.info.render.frame;
    if (frame === this.lastFrame) {
      U.uSsrOn.value = camera === this.mainCamera ? this.lastOk : 0;
      return;
    }
    this.lastFrame = frame;
    this.lastOk = 0;
    U.uSsrOn.value = 0;
    if (!this.enabled || weatherUniforms.uWetness.value < this.minWetness) return;
    if (camera !== this.mainCamera || scene.overrideMaterial) return;
    const src = renderer.getRenderTarget();
    if (!src || !src.depthBuffer || src.samples > 0 || src.width < 64 || (src as THREE.WebGLRenderTarget & { isWebGLCubeRenderTarget?: boolean }).isWebGLCubeRenderTarget) return;
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;

    const gl = renderer.getContext() as WebGL2RenderingContext;
    const dst = this.target(renderer, src);
    const props = renderer.properties;
    const srcFb = (props.get(src) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer;
    const dstFb = (props.get(dst) as { __webglFramebuffer?: WebGLFramebuffer }).__webglFramebuffer;
    if (!srcFb || !dstFb) return;
    const state = renderer.state;
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFb);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dstFb);
    gl.blitFramebuffer(0, 0, src.width, src.height, 0, 0, dst.width, dst.height, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    state.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    state.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    // (no mip chain: generateMipmap + high-LOD sampling of a half-float target is pathologically slow on
    //  ANGLE/Metal; the shader blurs with a few vertical taps instead, which also gives the wet-road streak)
    renderer.setRenderTarget(src);

    U.uSsrColor.value = dst.texture;
    U.uSsrDepth.value = dst.depthTexture;
    U.uSsrProj.value.copy(cam.projectionMatrix);
    U.uSsrNearFar.value.set(cam.near, cam.far);
    U.uSsrOn.value = this.copyOnly ? 0 : 1;
    this.lastOk = U.uSsrOn.value;
  }

  private target(renderer: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget {
    const w = Math.max(1, Math.floor(src.width / this.downscale));
    const h = Math.max(1, Math.floor(src.height / this.downscale));
    const dType = src.depthTexture ? src.depthTexture.type : THREE.UnsignedIntType;
    const key = `${w}x${h}:${src.texture.type}:${dType}:${src.stencilBuffer}`;
    if (this.rt && key === this.srcKey) return this.rt;
    this.rt?.dispose();
    const depth = new THREE.DepthTexture(w, h);
    depth.type = dType;
    depth.format = src.stencilBuffer ? THREE.DepthStencilFormat : THREE.DepthFormat;
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: src.texture.type,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: src.stencilBuffer,
      depthTexture: depth,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    rt.texture.colorSpace = src.texture.colorSpace;
    renderer.initRenderTarget(rt);
    this.rt = rt;
    this.srcKey = key;
    return rt;
  }

  dispose() {
    this.rt?.dispose();
    this.rt = null;
  }
}
