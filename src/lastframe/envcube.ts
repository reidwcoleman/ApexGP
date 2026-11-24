import * as THREE from 'three';

/**
 * The room as it looks from where the wearer stands, kept as a small cube of six pictures: what a gun's steel, a glove's
 * leather and a wet sleeve actually reflect. The light probes baked into the building are six colours a cell, which is
 * enough to say how bright a thing is and nothing like enough to put the strip light or the window on a receiver.
 *
 * One side is drawn at a time, a few frames apart, so the cost is a sixth of a small picture every few frames. The picture
 * is a second or so behind where the wearer has walked to; in something this blurred that does not show.
 */
export const ENV = {
  map: { value: null as THREE.Texture | null },
  /** 0 until all six sides have been drawn once */
  k: { value: 0 },
};

export class EnvCube {
  readonly rt: THREE.WebGLCubeRenderTarget;
  private rig: THREE.CubeCamera;
  private face = 0;
  private frame = 0;
  private primed = 0;
  private at = new THREE.Vector3(1e9, 0, 0);

  constructor(private r: THREE.WebGLRenderer, size = 128) {
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    this.rig = new THREE.CubeCamera(0.12, 90, this.rt);
    this.rig.coordinateSystem = r.coordinateSystem;
    this.rig.updateCoordinateSystem();
    ENV.map.value = this.rt.texture;
  }

  /** start again: somewhere new (a new match, put down across the map) */
  reset() {
    this.primed = 0;
    ENV.k.value = 0;
  }

  /** draws one side if one is due: every `every` frames, or every frame until all six exist */
  update(scene: THREE.Scene, at: THREE.Vector3, hide: THREE.Object3D[], every: number) {
    // put down somewhere else entirely: what it shows is another room
    if (this.at.distanceToSquared(at) > 36) this.reset();
    if (this.primed >= 6 && ++this.frame % every) return;
    this.at.copy(at);
    const r = this.r;
    this.rig.position.copy(at);
    this.rig.updateMatrixWorld(true);
    const cam = this.rig.children[this.face] as THREE.PerspectiveCamera;
    const vis = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt, this.face);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = auto;
    hide.forEach((o, i) => (o.visible = vis[i]));
    this.face = (this.face + 1) % 6;
    if (this.primed < 6 && ++this.primed === 6) ENV.k.value = 1;
  }
}

/** GLSL for a material that shows it: declarations, and the lines that add it to what the surface reflects.
 *  `gain` scales it; put ENV_FRAG just before `#include <lights_fragment_end>` */
export const ENV_PARS = /* glsl */ `
uniform samplerCube lfEnv;
uniform float lfEnvK;
`;
export const envFrag = (gain: string) => /* glsl */ `
{
  vec3 eN = normalize( ( vec4( geometryNormal, 0.0 ) * viewMatrix ).xyz );
  vec3 eV = normalize( ( vec4( geometryViewDir, 0.0 ) * viewMatrix ).xyz );
  vec3 eR = reflect( - eV, eN );
  // rougher surfaces see a wider, softer piece of the room
  vec3 eC = textureLod( lfEnv, eR, roughnessFactor * 6.0 ).rgb;
  radiance += min( eC, vec3( 8.0 ) ) * lfEnvK * ( ${gain} );
}
`;
