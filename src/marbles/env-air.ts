import * as THREE from 'three';

/**
 * The sky's colour as a function of direction, and the air between the camera and everything else.
 *
 * One GLSL function (`mmSky`) paints the sky dome, the image light the glass reflects, and the
 * fog: so a far peg, a cloud bank or the paint at the horizon melts into exactly the sky behind it
 * rather than into a flat grey-white. The fog is aerial perspective, not murk: nothing in the first
 * ~90 m is touched at all (the course stays crisp and saturated), then it thickens slowly (a power
 * curve, not an exponential that bites at once), and it takes on the warm glow when you look toward
 * the sun. three's fog chunks are replaced globally, so every lit material made anywhere (the
 * course, the marbles, the paint) gets it without knowing.
 */

export const SKY_GLSL = (sun: THREE.Vector3) => /* glsl */ `
const vec3 MM_SUN = normalize(vec3(${sun.x.toFixed(4)}, ${sun.y.toFixed(4)}, ${sun.z.toFixed(4)}));
uniform vec3 uZen;
uniform vec3 uMid;
uniform vec3 uHor;
uniform vec3 uBand;
uniform vec3 uBelow;
uniform vec3 uGlow;
uniform vec3 uDiscDir;
vec3 mmSky(vec3 d){
  float h = d.y;
  float hh = max(h, 0.0);
  vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.22, hh));
  c = mix(c, uZen, smoothstep(0.18, 0.95, hh));
  // (a thin band right on the horizon)
  c = mix(c, uBand, exp(-abs(h) * 30.0) * 0.3);
  // below the horizon: the haze lying on the sea
  c = mix(c, uBelow, smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, uDiscDir), 0.0);
  c += uGlow * (pow(sd, 5.0) * 0.22 + pow(sd, 48.0) * 0.55);
  return c;
}
`;

/** the sky's uniforms (shared by the dome and the image light's dome); set from a biome */
export function skyUniforms() {
  const v = () => ({ value: new THREE.Vector3() });
  return {
    uZen: v(), uMid: v(), uHor: v(), uBand: v(), uBelow: v(), uGlow: v(), uDisc: v(),
    uDiscDir: { value: new THREE.Vector3(0, 1, 0) },
    uDiscKind: { value: 0 }, uDiscSize: { value: 1 }, uStars: { value: 0 }, uAurora: { value: 0 }, uCirrus: { value: 1 },
  };
}

/** metres of clear air before the haze starts */
export const FOG_START = 120;

/** replaces three's fog chunks (once): aerial perspective toward the sky colour of each view ray */
export function installAir(sun: THREE.Vector3) {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.fog_pars_fragment.includes('MM_FSUN')) return;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogRay;
#endif
`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  // (the view ray in world space: the view matrix is a rotation, its transpose its inverse)
  vFogRay = mvPosition.xyz * mat3(viewMatrix);
#endif
`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  const vec3 MM_FSUN = normalize(vec3(${sun.x.toFixed(4)}, ${sun.y.toFixed(4)}, ${sun.z.toFixed(4)}));
#endif
`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  {
    float fd = length(vFogRay);
    vec3 fdir = vFogRay / max(fd, 1e-4);
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-pow(max(fd - ${FOG_START.toFixed(1)}, 0.0) * fogDensity, 1.45));
    #else
      float fogFactor = smoothstep(fogNear, fogFar, fd);
    #endif
    // (the colour of the sky just above the horizon (the world's: the scene's fog colour), warmer
    // toward the sun)
    vec3 fc = fogColor * (1.0 + pow(max(dot(fdir, MM_FSUN), 0.0), 5.0) * 0.35);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogFactor);
  }
#endif
`;
}
