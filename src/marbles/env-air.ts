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
vec3 mmSky(vec3 d){
  float h = d.y;
  float hh = max(h, 0.0);
  vec3 zen = vec3(0.045, 0.20, 0.78);
  vec3 mid = vec3(0.20, 0.50, 1.0);
  vec3 hor = vec3(0.50, 0.74, 1.0);
  vec3 band = vec3(1.0, 0.86, 0.84);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, hh));
  c = mix(c, zen, smoothstep(0.18, 0.95, hh));
  // (a thin peach band right on the horizon, as over the sea on a clear afternoon)
  c = mix(c, band, exp(-abs(h) * 30.0) * 0.3);
  // below the horizon: the haze lying on the paint
  c = mix(c, vec3(0.70, 0.74, 0.98), smoothstep(0.0, -0.25, h));
  float sd = max(dot(d, MM_SUN), 0.0);
  c += vec3(1.0, 0.72, 0.42) * pow(sd, 5.0) * 0.22;
  c += vec3(1.0, 0.88, 0.70) * pow(sd, 48.0) * 0.55;
  return c;
}
`;

/** metres of clear air before the haze starts */
export const FOG_START = 120;

/** replaces three's fog chunks (once): aerial perspective toward the sky colour of each view ray */
export function installAir(sun: THREE.Vector3) {
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  if (C.fog_fragment.includes('mmSky')) return;
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
  ${SKY_GLSL(sun)}
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
    // (the colour of the sky just above the horizon that way; tinted by the scene's fog colour)
    vec3 fc = mmSky(normalize(vec3(fdir.x, max(fdir.y, 0.0) * 0.4 + 0.015, fdir.z))) * fogColor;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, fogFactor);
  }
#endif
`;
}
