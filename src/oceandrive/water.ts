import * as THREE from 'three';
import { U } from './materials.ts';

/**
 * The Atlantic off Lummus Park.
 *
 * Near the camera the sea is a real surface: a 320 m grid that follows you, displaced by eight
 * Gerstner swells rolling in from the east-south-east. Over the sand bar the swell shoals (taller and
 * steeper as the water shallows), breaks into foam and runs up the beach as a thin sheet (the
 * swash), the waterline climbing and draining every few seconds. Beyond the grid the same shading
 * goes on over a flat plane to the horizon, the swell's slope fading into it.
 *
 * Shading per pixel: the slope from the swells plus two drifting ripple layers (faded with distance
 * so the far sea doesn't shimmer); Fresnel reflection of the sky; the water body's colour by depth
 * (turquoise over the sand, teal, then deep blue); sunlight passing through the crests when you look
 * toward the sun (the green glow in a backlit wave); a tight sun glint and a broad sheen; foam on
 * steep crests, in the surf zone, as trails behind the breakers and as lace at the swash edge; the
 * shallows clear enough to see the sand.
 */

const WAVES: [number, number, number, number][] = [
  // direction (rad in the x/z plane; ~PI travels toward -x, the beach), wavelength m, amplitude m, steepness
  [Math.PI + 0.18, 46, 0.42, 0.55],
  [Math.PI - 0.22, 31, 0.28, 0.6],
  [Math.PI + 0.45, 19, 0.16, 0.65],
  [Math.PI - 0.5, 13, 0.1, 0.6],
  [Math.PI + 0.05, 8.5, 0.06, 0.6],
  [Math.PI + 0.9, 6.1, 0.04, 0.55],
  [Math.PI - 0.95, 4.4, 0.03, 0.5],
  [Math.PI + 1.4, 3.1, 0.018, 0.45],
];

const COMMON = /* glsl */ `
uniform float uTime;
uniform float uWaterX;
uniform float uSwash;
uniform vec4 uW[8];
float seaDepth( float x ) { return max( 0.0, ( x - uWaterX ) * 0.035 ); }
// Gerstner sum: displacement and normal; shoaling grows the swell over the bar, the beach takes it out
void gerstner( vec2 p, float fade, out vec3 disp, out vec3 nrm, out float crest ) {
  disp = vec3( 0.0 );
  vec3 dn = vec3( 0.0 );
  crest = 0.0;
  float d = seaDepth( p.x );
  float shoal = mix( 1.0, 1.7, 1.0 - smoothstep( 1.5, 9.0, d ) ) * smoothstep( 0.0, 1.6, d );
  for ( int i = 0; i < 8; i ++ ) {
    vec4 w = uW[ i ];
    vec2 D = vec2( cos( w.x ), sin( w.x ) );
    float k = 6.2831853 / w.y;
    float c = sqrt( 9.81 / k );
    float f = k * ( dot( D, p ) - c * uTime ) + float( i ) * 1.3;
    float a = w.z * ( i < 3 ? shoal : mix( 1.0, shoal, 0.5 ) ) * fade;
    float q = w.w * ( i < 3 ? mix( 1.0, 1.35, 1.0 - smoothstep( 1.0, 6.0, d ) ) : 1.0 );
    q = min( q, 0.95 ) / ( k * max( a, 1e-3 ) * 8.0 );
    float S = sin( f ), C = cos( f );
    disp += vec3( q * a * D.x * C, a * S, q * a * D.y * C );
    dn += vec3( D.x * k * a * C, q * k * a * S, D.y * k * a * C );
    crest += q * k * a * S;
  }
  nrm = normalize( vec3( -dn.x, 1.0 - dn.y, -dn.z ) );
}
`;

export function makeSea(waterX: number, sea: number, hdr: THREE.Texture, sunColor: THREE.Color, displaced = false): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    name: 'od_water',
    transparent: true,
    depthWrite: true,
    fog: true,
    defines: displaced ? { DISPLACED: '' } : {},
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        tSky: { value: hdr },
        uSunCol: { value: sunColor },
        uWaterX: { value: waterX },
        uSeaZ: { value: sea },
        uW: { value: WAVES.map((w) => new THREE.Vector4(...w)) },
        uFadeR: { value: new THREE.Vector2(110, 158) },
        uCenter: { value: new THREE.Vector2() },
      },
    ]),
    vertexShader: /* glsl */ `
      uniform float uSeaZ;
      uniform vec2 uFadeR;
      uniform vec2 uCenter;
      varying vec3 vW;
      varying vec3 vN;
      varying float vCrest;
      varying float vH;
      ${COMMON}
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4( position, 1.0 );
        w.y = uSeaZ + uSwash;
        vec3 disp = vec3( 0.0 ), n = vec3( 0.0, 1.0, 0.0 );
        float crest = 0.0;
        #ifdef DISPLACED
          float r = max( abs( w.x - uCenter.x ), abs( w.z - uCenter.y ) );
          float fade = 1.0 - smoothstep( uFadeR.x, uFadeR.y, r );
          gerstner( w.xz, fade, disp, n, crest );
          disp *= smoothstep( 0.0, 0.5, seaDepth( w.x ) + 0.05 );
          w.xyz += disp;
        #endif
        vW = w.xyz;
        vN = n;
        vCrest = crest;
        vH = disp.y;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSky;
      uniform vec3 uSunCol;
      uniform vec3 uSunDir;
      uniform float uNight;
      uniform vec2 uCenter;
      uniform vec2 uFadeR;
      varying vec3 vW;
      varying vec3 vN;
      varying float vCrest;
      varying float vH;
      ${COMMON}
      #include <common>
      #include <fog_pars_fragment>
      vec2 eqUv( vec3 d ) { return vec2( atan( d.z, d.x ) * RECIPROCAL_PI2 + 0.5, asin( clamp( d.y, -1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5 ); }
      float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
      float vn( vec2 x ) { vec2 i = floor( x ); vec2 f = fract( x ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( h12( i ), h12( i + vec2( 1, 0 ) ), f.x ), mix( h12( i + vec2( 0, 1 ) ), h12( i + vec2( 1, 1 ) ), f.x ), f.y ); }
      float fbm( vec2 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 4; i ++ ) { s += a * vn( p ); p = p * 2.07 + 13.1; a *= 0.5; } return s; }
      vec2 ripples( vec2 p, float t ) {
        float e = 0.08;
        vec2 a = p * 0.9 + vec2( t * 0.35, t * 0.12 ), b = p * 1.7 - vec2( t * 0.2, -t * 0.3 );
        float h0 = vn( a ) + 0.5 * vn( b );
        float hx = vn( a + vec2( e, 0 ) ) + 0.5 * vn( b + vec2( e, 0 ) );
        float hz = vn( a + vec2( 0, e ) ) + 0.5 * vn( b + vec2( 0, e ) );
        return vec2( hx - h0, hz - h0 ) / e;
      }
      void main() {
        vec3 V = normalize( vW - cameraPosition );
        float dist = length( vW - cameraPosition );
        float detail = 1.0 - smoothstep( 30.0, 350.0, dist );
        vec3 N = vN;
        float crest = vCrest;
        #ifndef DISPLACED
          // the far sea: inside the near grid it's hidden; outside, the swell's slope fades out
          float inGrid = 1.0 - step( uFadeR.y - 2.0, max( abs( vW.x - uCenter.x ), abs( vW.z - uCenter.y ) ) );
          if ( inGrid > 0.5 && cameraPosition.y < 60.0 ) discard;
          vec3 dsp;
          gerstner( vW.xz, 1.0 - smoothstep( 300.0, 1500.0, dist ), dsp, N, crest );
        #endif
        vec2 rp = ripples( vW.xz, uTime ) * 0.09 * detail;
        N = normalize( N + vec3( -rp.x, 0.0, -rp.y ) );
        float depth = seaDepth( vW.x );
        float dShore = vW.x - uWaterX;
        vec3 R = reflect( V, N );
        R.y = abs( R.y );
        vec3 sky = min( texture2D( tSky, eqUv( R ) ).rgb, vec3( 40.0 ) ) * mix( 1.0, 0.14, uNight );
        float cosi = max( dot( -V, N ), 0.0 );
        float F = 0.02 + 0.98 * pow( 1.0 - cosi, 5.0 );
        F = min( F, 0.55 ) * 0.8;
        vec3 shallow = vec3( 0.30, 0.86, 0.78 );
        vec3 mid = vec3( 0.05, 0.46, 0.52 );
        vec3 deep = vec3( 0.015, 0.12, 0.2 );
        vec3 body = mix( shallow, mid, smoothstep( 0.3, 2.4, depth ) );
        body = mix( body, deep, smoothstep( 2.4, 18.0, depth ) );
        float sunUp = max( uSunDir.y, 0.0 ) * ( 1.0 - uNight );
        vec3 E = uSunCol * sunUp + vec3( 1.1, 1.35, 1.8 ) * mix( 1.0, 0.1, uNight );
        body *= E * 0.3183;
        float back = pow( max( dot( V, normalize( uSunDir * vec3( 1.0, 0.3, 1.0 ) ) ), 0.0 ), 3.0 );
        float thin = clamp( vH * 1.6 + 0.35, 0.0, 1.0 ) * smoothstep( 0.2, 1.5, depth );
        vec3 sss = vec3( 0.12, 0.75, 0.6 ) * uSunCol * sunUp * back * thin * 0.22;
        float rs = max( dot( R, uSunDir ), 0.0 );
        vec3 spec = uSunCol * ( pow( rs, 1200.0 ) * 18.0 + pow( rs, 140.0 ) * 0.9 ) * ( 0.3 + 0.7 * detail ) * ( 1.0 - uNight );
        float fn = fbm( vW.xz * vec2( 0.55, 0.35 ) + vec2( uTime * 0.25, 0.0 ) );
        float fd = fbm( vW.xz * 2.4 - uTime * 0.1 );
        float whitecap = smoothstep( 0.55, 0.95, crest ) * smoothstep( 0.35, 0.65, fn );
        float surf = ( 1.0 - smoothstep( 0.6, 2.2, depth ) ) * smoothstep( 0.15, 0.9, vH + 0.4 * fn ) * smoothstep( 0.3, 0.6, fd );
        // the swash edge: where the sheet over the sand thins out (the beach rises ~2 cm per metre)
        float thick = dShore < 0.0 ? uSwash + dShore * 0.02 : depth + uSwash;
        float edge = ( 1.0 - smoothstep( 0.015, 0.07, thick ) ) * smoothstep( 0.3, 0.6, fd * 0.7 + fn * 0.5 + 0.1 );
        edge = max( edge, ( 1.0 - smoothstep( 0.0, 0.025, thick ) ) * 0.85 );
        float trail = ( 1.0 - smoothstep( 1.0, 12.0, dShore ) ) * smoothstep( 0.55, 0.75, fbm( vW.xz * vec2( 0.25, 1.2 ) + vec2( uTime * 0.4, 0.0 ) ) ) * 0.7;
        float foam = clamp( max( max( whitecap, surf ), max( edge, trail ) ), 0.0, 1.0 );
        vec3 col = mix( body + sss, sky, F ) + spec;
        vec3 foamCol = vec3( 0.93, 0.95, 0.96 ) * E * 0.3183 * ( 0.75 + 0.25 * fd );
        col = mix( col, foamCol, foam * 0.92 );
        float alpha = mix( 0.08, 1.0, smoothstep( 0.0, 1.3, depth + 0.12 ) ) * smoothstep( 0.0, 0.035, thick );
        alpha = max( alpha, max( foam * 0.9, F ) );
        gl_FragColor = vec4( col, alpha );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uTime = U.uTime;
  m.uniforms.uSwash = U.uSwash;
  m.uniforms.uSunDir = U.uSunDir;
  m.uniforms.uNight = U.uNight;
  return m;
}

/** the near sea: a displaced grid that follows the camera (snapped, so the swell doesn't swim) */
export class NearSea {
  readonly mesh: THREE.Mesh;
  constructor(readonly mat: THREE.ShaderMaterial, readonly far: THREE.ShaderMaterial, private readonly waterX: number) {
    const g = new THREE.PlaneGeometry(320, 320, 280, 280);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      // vertices squeezed toward the centre: ~0.5 m apart near you, ~2 m at the edge
      const f = (v: number) => Math.sign(v) * 160 * Math.pow(Math.abs(v) / 160, 1.6);
      p.setXYZ(i, f(p.getX(i)), 0, f(p.getZ(i)));
    }
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(cam: THREE.Vector3) {
    // centred under you, but its west edge never further in than the waterline
    const cx = Math.max(cam.x, this.waterX + 100), cz = cam.z;
    const sn = 4;
    this.mesh.position.set(Math.round(cx / sn) * sn, 0, Math.round(cz / sn) * sn);
    for (const m of [this.mat, this.far]) (m.uniforms.uCenter.value as THREE.Vector2).set(this.mesh.position.x, this.mesh.position.z);
  }
}

/** sea and swash timing (a set of waves every ~9 s) */
export function seaTick(t: number) {
  U.uTime.value = t;
  const s = Math.sin(t * 0.7) * 0.5 + Math.sin(t * 0.23 + 1.3) * 0.5;
  U.uSwash.value = 0.07 * s;
}
