/** GLSL shared by the fx materials. */

/** shared by the soft puffs and the veil: scene depth from the main pass (low-res mode) */
export const DEPTH_PARS = /* glsl */ `
#include <packing>
uniform sampler2D uDepth;
uniform vec2 uInvRes;
uniform vec2 uClip;      // camera near, far
uniform float uUseDepth;
// view distance (along -z) of the opaque surface behind this pixel; huge if none
float sceneViewZ() {
  if ( uUseDepth < 0.5 ) return 1e6;
  float d = texture2D( uDepth, gl_FragCoord.xy * uInvRes ).x;
  if ( d >= 0.99999 ) return 1e6;
  return -perspectiveDepthToViewZ( d, uClip.x, uClip.y );
}
`;
