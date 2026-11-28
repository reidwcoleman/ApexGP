// Street lamps light more than the pavement under them: a map of where their light falls (each lamp a
// soft 12 m disc, 2 m a pixel over the whole map), baked once from the lamp positions, that palms, trees
// and building walls sample after dark to pick up warm light on whatever stands near a lamp - trunks,
// the lower floors of a facade - fading out above lamp height. Without it everything but the ground
// stayed black beside a lit lamp.
import * as THREE from 'three';

const X0 = -1000, Z0 = -1000, SIZE = 2000, PX = 1000;

export const lampUniforms = {
  uLampMap: { value: null as THREE.Texture | null },
  uLampBox: { value: new THREE.Vector4(X0, Z0, SIZE, SIZE) },
  uLampOn: { value: 0 },
};

/** bake the light map from where each lamp's light lands (the pool centre) */
export function bakeLampField(pts: { x: number; z: number }[]) {
  const c = document.createElement('canvas');
  c.width = c.height = PX;
  const x = c.getContext('2d')!;
  x.fillStyle = '#000';
  x.fillRect(0, 0, PX, PX);
  x.globalCompositeOperation = 'lighter';
  const k = PX / SIZE;
  for (const p of pts) {
    const cx = (p.x - X0) * k, cz = (p.z - Z0) * k, r = 12 * k;
    const g = x.createRadialGradient(cx, cz, 0, cx, cz, r);
    g.addColorStop(0, 'rgba(255,255,255,0.6)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.32)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(cx - r, cz - r, 2 * r, 2 * r);
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  lampUniforms.uLampMap.value = t;
}

/** after dark, add the lamps' warm light to this material where the map says it falls */
export function addLampLight<M extends THREE.Material>(m: M): M {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, lampUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampW;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 lw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  lw = instanceMatrix * lw;
  #endif
  vLampW = (modelMatrix * lw).xyz;
}`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampW; uniform sampler2D uLampMap; uniform vec4 uLampBox; uniform float uLampOn;')
      .replace(
        '#include <opaque_fragment>',
        `if (uLampOn > 0.001) {
  vec2 luv = (vLampW.xz - uLampBox.xy) / uLampBox.zw;
  // strongest at street level, falling off up the wall toward the lamp head and gone above it, and in
  // pools round each lamp rather than one even wash (a whole facade used to glow to the roof)
  float lv = 1.0 - smoothstep(0.0, 7.5, vLampW.y);
  float lf = pow(texture2D(uLampMap, luv).r, 1.35) * lv * sqrt(lv);
  outgoingLight += diffuseColor.rgb * vec3(1.0, 0.7, 0.42) * uLampOn * lf * 2.6;
}
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => prevKey() + '|lamp2';
  return m;
}
