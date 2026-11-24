import * as THREE from 'three';
import { U } from './materials.ts';

/**
 * The Atlantic off Lummus Park. One big plane at sea level, shaded per pixel:
 *  - waves: a dozen directional swells and chop (analytic slopes), the small ones fading with distance
 *    so the far sea doesn't shimmer; the swell comes in from the east-south-east
 *  - colour by depth (the sea floor keeps the beach's slope out to sea): turquoise in the shallows,
 *    the sand showing through the first metre, deep blue-green beyond
 *  - reflection of the same sky (Fresnel), a tight sun glint and a broader sheen
 *  - surf: lines of foam that run up the beach and break in the shallows, and the swash: the
 *    whole sheet climbs and falls the beach slope every few seconds (uSwash, also used by the
 *    sand to darken where the water has just been)
 */
export function makeSea(waterX: number, sea: number, hdr: THREE.Texture, sunColor: THREE.Color): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    name: 'od_water',
    transparent: true,
    depthWrite: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        tSky: { value: hdr },
        uSunCol: { value: sunColor },
        uWaterX: { value: waterX },
        uSeaZ: { value: sea },
      },
    ]),
    vertexShader: /* glsl */ `
      uniform float uSwash;
      varying vec3 vW;
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4( position, 1.0 );
        w.y += uSwash;
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSky;
      uniform vec3 uSunCol;
      uniform vec3 uSunDir;
      uniform float uTime;
      uniform float uWaterX;
      uniform float uSeaZ;
      uniform float uSwash;
      uniform float uNight;
      varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      vec2 eqUv( vec3 d ) { return vec2( atan( d.z, d.x ) * RECIPROCAL_PI2 + 0.5, asin( clamp( d.y, -1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5 ); }
      float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
      float vn( vec2 x ) { vec2 i = floor( x ); vec2 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), f.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), f.x ), f.y ); }
      // slopes of a sum of travelling waves
      vec2 waves( vec2 p, float t, float detail ) {
        vec2 g = vec2( 0.0 );
        float a = 0.32, k = 0.09;
        float ang = 2.75; // swell from the ESE, travelling west (toward the beach)
        for ( int i = 0; i < 12; i ++ ) {
          float fi = float( i );
          vec2 d = vec2( cos( ang ), sin( ang ) );
          float w = sqrt( 9.81 * k );
          float ph = dot( d, p ) * k - w * t + fi * 1.7;
          float fade = i < 4 ? 1.0 : detail;
          g += d * ( a * k * cos( ph ) ) * fade;
          a *= 0.66; k *= 1.42;
          ang += 0.9 + 0.35 * sin( fi * 2.1 );
        }
        return g;
      }
      void main() {
        vec3 V = normalize( vW - cameraPosition );
        float dist = length( vW - cameraPosition );
        float detail = 1.0 - smoothstep( 40.0, 400.0, dist );
        vec2 g = waves( vW.xz, uTime, detail );
        // ripples
        float rp = vn( vW.xz * 1.3 + uTime * 0.6 ) - vn( vW.xz * 1.3 - uTime * 0.5 + 7.0 );
        g += vec2( rp, vn( vW.zx * 1.7 - uTime * 0.4 ) - 0.5 ) * 0.06 * detail;
        vec3 N = normalize( vec3( -g.x, 1.0, -g.y ) );
        // depth below the surface (the sea floor continues the beach: 3.5 cm per metre)
        float depth = max( 0.0, ( vW.x - uWaterX ) * 0.035 + uSwash * 0.0 );
        float dShore = vW.x - uWaterX;
        vec3 R = reflect( V, N );
        R.y = abs( R.y );
        vec3 sky = texture2D( tSky, eqUv( R ) ).rgb;
        sky = min( sky, vec3( 40.0 ) ) * mix( 1.0, 0.16, uNight );
        float cosi = max( dot( -V, N ), 0.0 );
        float F = 0.02 + 0.98 * pow( 1.0 - cosi, 5.0 );
        // a choppy surface shows more of the high sky and the water body than a mirror would
        F = min( F, 0.5 ) * 0.78;
        // water body: scattering lit by the sky (and a little sun), tinted by depth
        // upwelling light: the sand bottom shows turquoise through the shallows, deep water is dark teal
        vec3 shallow = vec3( 0.34, 0.86, 0.80 );
        vec3 mid = vec3( 0.07, 0.50, 0.55 );
        vec3 deep = vec3( 0.02, 0.15, 0.22 );
        vec3 body = mix( shallow, mid, smoothstep( 0.3, 2.2, depth ) );
        body = mix( body, deep, smoothstep( 2.2, 16.0, depth ) );
        float sunUp = max( uSunDir.y, 0.0 );
        // lit by the sun through the surface and the sky (irradiance / pi)
        body *= ( uSunCol * sunUp * ( 1.0 - uNight ) + vec3( 1.1, 1.35, 1.8 ) * mix( 1.0, 0.12, uNight ) ) * 0.3183;
        // sun: a tight glint and a broad sheen
        float rs = max( dot( R, uSunDir ), 0.0 );
        vec3 spec = uSunCol * ( pow( rs, 1400.0 ) * 60.0 + pow( rs, 160.0 ) * 1.2 ) * ( 0.25 + 0.75 * detail ) * ( 1.0 - uNight );
        // surf: breaking lines in the shallows, running in toward the beach
        float surfZone = 1.0 - smoothstep( 4.0, 40.0, dShore );
        float lineP = dShore * 0.22 + uTime * 0.55 + vn( vW.xz * 0.05 ) * 3.0;
        float crest = smoothstep( 0.82, 0.97, sin( lineP ) * 0.5 + 0.5 );
        float foamN = vn( vW.xz * vec2( 0.9, 0.35 ) + vec2( uTime * 0.3, 0.0 ) ) * vn( vW.xz * 2.7 + 3.0 );
        float foam = crest * surfZone * smoothstep( 0.18, 0.55, foamN );
        // the swash edge: a lace of foam where the sheet thins out on the sand
        float edge = 1.0 - smoothstep( 0.0, 5.0, dShore + 2.0 - uSwash * 40.0 );
        foam = max( foam, edge * smoothstep( 0.25, 0.6, vn( vW.xz * 1.8 + uTime * 0.2 ) ) );
        vec3 col = mix( body, sky, F ) + spec;
        vec3 foamCol = vec3( 0.92, 0.94, 0.95 ) * ( 0.55 + 0.45 * sunUp * 2.0 ) * mix( 1.0, 0.12, uNight );
        col = mix( col, foamCol, clamp( foam, 0.0, 1.0 ) * 0.9 );
        // the shallows let the sand show: transparent at the waterline
        float alpha = mix( 0.12, 1.0, smoothstep( 0.0, 1.6, depth + 0.25 ) );
        alpha = max( alpha, foam * 0.9 );
        alpha = max( alpha, F );
        gl_FragColor = vec4( col, alpha );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  // the shared clock, swash and sun (merge() cloned them)
  m.uniforms.uTime = U.uTime;
  m.uniforms.uSwash = U.uSwash;
  m.uniforms.uSunDir = U.uSunDir;
  m.uniforms.uNight = U.uNight;
  return m;
}

/** sea and swash timing (the swash period: a set of waves every ~9 s) */
export function seaTick(t: number) {
  U.uTime.value = t;
  // the sheet runs up the beach (a few cm of height = metres on a 2% slope) and drains back
  const s = Math.sin(t * 0.7) * 0.5 + Math.sin(t * 0.23 + 1.3) * 0.5;
  U.uSwash.value = 0.07 * s;
}
