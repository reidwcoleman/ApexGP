import * as THREE from 'three';

/**
 * Tileable 3D cloud noise, generated on the GPU once at start-up (a few ms):
 *
 *   R  Perlin-Worley (billowy low-frequency cloud shape, 4 cells per tile)
 *   G  Worley fBm, 8 cells   \
 *   B  Worley fBm, 16 cells   }  shape fBm / erosion detail
 *   A  Worley fBm, 32 cells  /
 *
 * 128³ RGBA8 with mipmaps (≈ 9.5 MB). Sampled with `textureLod` from the cloud
 * raymarcher; the mip level follows the march step so far clouds don't alias.
 */

const VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform float uZ;
layout(location = 0) out vec4 outColor;

vec3 hash33( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}

float worley( vec3 p, float period ) {
  vec3 cell = floor( p );
  vec3 f = p - cell;
  float d = 1e9;
  for ( int z = -1; z <= 1; z++ )
  for ( int y = -1; y <= 1; y++ )
  for ( int x = -1; x <= 1; x++ ) {
    vec3 o = vec3( float( x ), float( y ), float( z ) );
    vec3 c = mod( cell + o, period );
    vec3 fp = o + hash33( c + 17.0 ) - f;
    d = min( d, dot( fp, fp ) );
  }
  return clamp( sqrt( d ), 0.0, 1.0 );
}

vec3 grad3( vec3 c ) {
  return normalize( hash33( c ) * 2.0 - 1.0 + 1e-4 );
}

float perlin( vec3 p, float period ) {
  vec3 i = floor( p );
  vec3 f = p - i;
  vec3 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float n000 = dot( grad3( mod( i + vec3( 0, 0, 0 ), period ) ), f - vec3( 0, 0, 0 ) );
  float n100 = dot( grad3( mod( i + vec3( 1, 0, 0 ), period ) ), f - vec3( 1, 0, 0 ) );
  float n010 = dot( grad3( mod( i + vec3( 0, 1, 0 ), period ) ), f - vec3( 0, 1, 0 ) );
  float n110 = dot( grad3( mod( i + vec3( 1, 1, 0 ), period ) ), f - vec3( 1, 1, 0 ) );
  float n001 = dot( grad3( mod( i + vec3( 0, 0, 1 ), period ) ), f - vec3( 0, 0, 1 ) );
  float n101 = dot( grad3( mod( i + vec3( 1, 0, 1 ), period ) ), f - vec3( 1, 0, 1 ) );
  float n011 = dot( grad3( mod( i + vec3( 0, 1, 1 ), period ) ), f - vec3( 0, 1, 1 ) );
  float n111 = dot( grad3( mod( i + vec3( 1, 1, 1 ), period ) ), f - vec3( 1, 1, 1 ) );
  return mix( mix( mix( n000, n100, u.x ), mix( n010, n110, u.x ), u.y ),
              mix( mix( n001, n101, u.x ), mix( n011, n111, u.x ), u.y ), u.z );
}

float perlinFbm( vec3 p, float period ) {
  float s = 0.0, a = 0.5, n = 0.0;
  for ( int i = 0; i < 5; i++ ) {
    s += a * perlin( p, period );
    n += a;
    p *= 2.0;
    period *= 2.0;
    a *= 0.5;
  }
  return s / n;
}

float worleyFbm( vec3 p, float period ) {
  // inverted (1 = cell centre), three octaves
  return ( 1.0 - worley( p, period ) ) * 0.625
       + ( 1.0 - worley( p * 2.0, period * 2.0 ) ) * 0.25
       + ( 1.0 - worley( p * 4.0, period * 4.0 ) ) * 0.125;
}

float remap( float x, float a, float b, float c, float d ) {
  return c + ( x - a ) / ( b - a ) * ( d - c );
}

void main() {
  vec3 p = vec3( vUv, uZ );
  // Perlin-Worley
  float pf = perlinFbm( p * 4.0, 4.0 ) * 0.5 + 0.5;
  pf = clamp( remap( pf, 0.25, 0.8, 0.0, 1.0 ), 0.0, 1.0 );
  float wf = worleyFbm( p * 4.0, 4.0 );
  float pw = clamp( remap( pf, 0.0, 1.0, wf, 1.0 ), 0.0, 1.0 );
  pw = clamp( remap( pw, 0.25, 1.0, 0.0, 1.0 ), 0.0, 1.0 );
  outColor = vec4(
    pw,
    worleyFbm( p * 8.0, 8.0 ),
    worleyFbm( p * 16.0, 16.0 ),
    worleyFbm( p * 32.0, 32.0 )
  );
}
`;

export function createCloudNoise(renderer: THREE.WebGLRenderer, size = 128): THREE.Data3DTexture {
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const tex = rt.texture as unknown as THREE.Data3DTexture;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;

  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: /* glsl */ `
      in vec3 position;
      in vec2 uv;
      ${VERT}`,
    fragmentShader: FRAG,
    uniforms: { uZ: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  renderer.autoClear = false;
  for (let z = 0; z < size; z++) {
    mat.uniforms.uZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(rt, z);
    renderer.render(quad, cam);
  }
  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  // mip chain for distance-based filtering in the march
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const glTex = (renderer.properties.get(tex) as { __webglTexture?: WebGLTexture }).__webglTexture;
  if (glTex) {
    renderer.state.bindTexture(gl.TEXTURE_3D, glTex);
    gl.generateMipmap(gl.TEXTURE_3D);
    renderer.state.unbindTexture();
  }
  mat.dispose();
  quad.geometry.dispose();
  return tex;
}
