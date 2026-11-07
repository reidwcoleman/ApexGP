import * as THREE from 'three';
import type { Terrain } from './collide.ts';
import { LF, SKY_GLSL, SUN_GLSL } from './lighting.ts';

/** a tile of small waves as a normal map: a few dozen directional ripples that all wrap at the edge, so it scrolls forever */
function waveTile() {
  const N = 256;
  const h = new Float32Array(N * N);
  let s = 77;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 90; k++) {
    const f = 1 + Math.floor(rnd() ** 1.6 * 22);
    const a = (rnd() - 0.5) * 2.4 + 0.5;
    const kx = Math.round(Math.cos(a) * f), ky = Math.round(Math.sin(a) * f);
    if (!kx && !ky) continue;
    const amp = 1 / (Math.hypot(kx, ky) ** 1.15), ph = rnd() * 6.283;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const t = ((x * kx + y * ky) / N) * 6.2832 + ph;
      // peaked, not sine-round: water stands up in crests
      const c = Math.sin(t);
      h[y * N + x] += amp * (1 - Math.abs(c)) * 1.6 - amp * 0.8;
    }
  }
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)], dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const o = (y * N + x) * 4;
    d[o] = Math.max(0, Math.min(255, 128 + dx * 200));
    d[o + 1] = Math.max(0, Math.min(255, 128 + dy * 200));
    d[o + 2] = 255;
    d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** cells of foam: bright lace with dark holes, wrapping */
function foamTile() {
  const N = 256, C = 18;
  const px: number[] = [], py: number[] = [];
  let s = 991;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < C * C; i++) {
    px.push(((i % C) + rnd()) / C);
    py.push((Math.floor(i / C) + rnd()) / C);
  }
  const d = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let f1 = 9, f2 = 9;
    const u = x / N, v = y / N, cx = Math.floor(u * C), cy = Math.floor(v * C);
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const a = (cx + i + C) % C, b = (cy + j + C) % C, k = b * C + a;
      let dx = Math.abs(px[k] - u), dy = Math.abs(py[k] - v);
      if (dx > 0.5) dx = 1 - dx;
      if (dy > 0.5) dy = 1 - dy;
      const q = Math.hypot(dx, dy);
      if (q < f1) { f2 = f1; f1 = q; } else if (q < f2) f2 = q;
    }
    const e = Math.min(1, (f2 - f1) * C * 1.5);
    const o = (y * N + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = (1 - e) * 255;
    d[o + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** the swell, in one place: both ends need the same sum */
const SWELL = /* glsl */ `
const vec4 SW[5] = vec4[5](
  vec4(  0.34,  0.94, 34.0, 0.34 ), vec4( -0.28,  0.96, 19.0, 0.19 ), vec4(  0.62,  0.78, 11.0, 0.1 ),
  vec4( -0.7,   0.71, 6.3,  0.055 ), vec4(  0.09,  0.99, 3.7, 0.03 ) );
vec3 swell( vec2 p, float t, out vec2 slope ) {
  vec3 o = vec3( 0.0 );
  slope = vec2( 0.0 );
  for ( int i = 0; i < 5; i++ ) {
    vec2 d = SW[i].xy;
    float k = 6.2831853 / SW[i].z, c = sqrt( 9.8 / k ), f = k * ( dot( d, p ) + c * t ), a = SW[i].w;
    float s = sin( f ), q = cos( f );
    o += vec3( d.x * a * 0.7 * q, a * s, d.y * a * 0.7 * q );
    slope += d * ( k * a * q );
  }
  return o;
}`;

export function buildSea(t: Terrain, hTex: THREE.Texture, foamNear: THREE.Texture | null) {
  const W = (t.nx - 1) * t.step, H = (t.ny - 1) * t.step;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: true,
    uniforms: {
      time: LF.time as { value: number }, tH: { value: hTex }, tNear: { value: foamNear }, tWave: { value: waveTile() }, tFoam: { value: foamTile() }, tSky: LF.sky, skyK: LF.skyK, lmK: LF.lmK,
      area: { value: new THREE.Vector4(t.x0, t.y0, W, H) }, eye: { value: new THREE.Vector3() }, tN: LF.noise,
      lfSunDir: LF.sunDir, lfSunC: LF.sunC, lfSunVP: LF.sunVP, lfDynVP: LF.dynVP, lfSunMap: LF.sunMap, lfDynMap: LF.dynMap, lfCloud: LF.cloud,
    },
    vertexShader: /* glsl */ `
      uniform float time; uniform sampler2D tH; uniform vec4 area; uniform vec3 eye;
      varying vec3 vW; varying float vD;
      ${SWELL}
      void main() {
        vec3 w = position + vec3( floor( eye.x * 0.5 ) * 2.0, 0.0, floor( eye.z * 0.5 ) * 2.0 );
        vec2 uv = vec2( ( w.x - area.x ) / area.z, ( -w.z - area.y ) / area.w );
        float bed = texture2D( tH, uv ).r;
        bool inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
        float depth = inside ? max( -bed, 0.0 ) : 30.0;
        vD = depth;
        vec2 sl;
        float near = 1.0 - smoothstep( 180.0, 520.0, distance( eye.xz, w.xz ) );
        float k = smoothstep( 0.0, 5.5, depth ) * 0.92 + 0.08;
        vec3 g = swell( w.xz, time, sl ) * k * near;
        // the tide's breath on the shore, in time with nothing else
        float lap = sin( time * 0.52 + w.x * 0.012 ) * 0.1 + sin( time * 0.21 ) * 0.06;
        w += g;
        w.y += lap * ( 1.0 - k );
        vW = w;
        vec4 c = projectionMatrix * viewMatrix * vec4( w, 1.0 );
        // reaches past the far plane to the horizon
        c.z = min( c.z, c.w * 0.999995 );
        gl_Position = c;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float time, skyK; uniform sampler2D tH, tNear, tWave, tFoam, tSky, tN; uniform vec4 area; uniform vec3 eye; uniform vec2 lmK;
      varying vec3 vW; varying float vD;
      ${SKY_GLSL}
      ${SUN_GLSL}
      ${SWELL}
      void main() {
        vec2 p = vW.xz;
        float dist = distance( eye, vW );
        vec2 uv = vec2( ( p.x - area.x ) / area.z, ( -p.y - area.y ) / area.w );
        bool inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
        float depth = inside ? -texture2D( tH, uv ).r : 30.0;
        float wet = max( depth, 0.0 ) + vW.y;
        float nearLand = inside ? texture2D( tNear, uv ).r : 0.0;

        // the shape of the surface: the swell by sum, the chop from a scrolling tile at three sizes, calming with distance
        vec2 sl = vec2( 0.0 );
        if ( dist < 520.0 ) { swell( p, time, sl ); sl *= ( 1.0 - smoothstep( 180.0, 520.0, dist ) ) * ( smoothstep( 0.0, 5.5, max( depth, 0.0 ) ) * 0.92 + 0.08 ); }
        vec2 n1 = texture2D( tWave, p * 0.019 + vec2( time * 0.006, time * 0.011 ) ).xy - 0.5;
        vec2 n2 = texture2D( tWave, p * 0.067 + vec2( -time * 0.019, time * 0.024 ) ).xy - 0.5;
        vec2 n3 = texture2D( tWave, p * 0.23 + vec2( time * 0.05, -time * 0.041 ) ).xy - 0.5;
        float near = 1.0 / ( 1.0 + dist * 0.012 );
        vec2 chop = n1 * 0.32 + n2 * 0.34 * ( 0.35 + 0.65 * near ) + n3 * 0.34 * near;
        vec3 n = normalize( vec3( -sl.x - chop.x * 0.9, 1.0, -sl.y - chop.y * 0.9 ) );
        vec3 v = normalize( eye - vW );

        // what it mirrors
        vec3 r = reflect( -v, n );
        r.y = abs( r.y ) + 0.01;
        vec3 sky = lfSky( tSky, lmK, normalize( r ) ) * skyK;
        float nv = clamp( dot( n, v ), 0.0, 1.0 );
        float fr = 0.02 + 0.98 * pow( 1.0 - nv, 5.0 );
        // far away the facets are smaller than a pixel: the mean of what they show is less than the mirror angle says
        fr = min( fr, mix( 0.62, 1.0, near ) );

        // the water itself
        float vis = lfSunVis( vec3( vW.x, 0.05, vW.z ), vec3( 0.0, 1.0, 0.0 ), lfIGN( gl_FragCoord.xy ) * 6.28 ) * lfCloudAt( tN, p );
        float k = 1.0 - exp( -max( wet, 0.0 ) * 0.2 );
        vec3 body = mix( vec3( 0.075, 0.36, 0.3 ), vec3( 0.004, 0.05, 0.075 ), k );
        // weed and rock lying under the shallows, in dark drifts
        float weed = smoothstep( 0.44, 0.62, texture2D( tN, p * 0.0052 ).r );
        body *= mix( 1.0, 0.56, weed * ( 1.0 - k * 0.8 ) );
        float amb = skyK * 0.62;
        vec3 c = body * ( amb + lfSunC * lfSunDir.y * vis * 0.2 );
        // light scattered up through the crests
        float crest = clamp( ( vW.y + 0.1 ) * 1.6, 0.0, 1.0 );
        c += vec3( 0.04, 0.2, 0.17 ) * crest * ( 0.4 + 1.2 * vis ) * pow( clamp( dot( -v, lfSunDir ) * 0.5 + 0.5, 0.0, 1.0 ), 2.0 ) * near;
        c = mix( c, sky, fr );
        // the sun on it: a tight mirror glint on every facet turned the right way, spread into a road on the far water
        vec3 hv = normalize( lfSunDir + v );
        vec3 ng = normalize( vec3( -sl.x - chop.x * 1.7, 1.0, -sl.y - chop.y * 1.7 ) );
        float nh = clamp( dot( ng, hv ), 0.0, 1.0 );
        float sp = pow( nh, 900.0 ) * 26.0 + pow( nh, 120.0 ) * 0.55;
        c += lfSunC * sp * vis * 0.42;

        // foam. Sets of swell stand up as the bottom shelves and break: their phase runs on depth, so they wrap the bay
        float d = max( wet, 0.0 );
        float flow = time * 0.018;
        float wob = texture2D( tN, p * 0.012 ).r;
        float ph = d * 1.5 + time * 0.62 + wob * 8.0;
        // a thin line of white on each set, a thin lip at the water's edge, and lace everywhere between them
        float set = pow( 0.5 + 0.5 * sin( ph ), 14.0 ) * smoothstep( 4.6, 1.2, d ) * smoothstep( 0.0, 0.6, d );
        // the edge comes and goes with the tide's breath: a band of white that's pulled thin as each wave draws back
        float sweep = 0.5 + 0.5 * sin( time * 0.52 + p.x * 0.012 );
        float rim = smoothstep( 0.05 + 0.26 * sweep, 0.0, d );
        float wash = smoothstep( 1.7, 0.2, d ) * 0.15;
        float rocks = smoothstep( 0.2, 0.75, nearLand ) * smoothstep( 6.0, 1.0, d ) * ( 0.6 + 0.4 * sin( time * 0.7 + p.x * 0.09 + p.y * 0.07 ) );
        float want = clamp( set * 0.5 + rim * 0.32 + wash + rocks * 0.3, 0.0, 0.54 );
        // the cells pulled out of true by noise, or they read as paving
        vec2 wp = vec2( texture2D( tN, p * 0.021 + flow ).r, texture2D( tN, p * 0.021 + 0.37 - flow ).r ) - 0.5;
        float lace = texture2D( tFoam, p * 0.2 + wp * 0.42 + vec2( flow, -flow * 0.7 ) ).r * 0.55 + texture2D( tFoam, p * 0.067 + wp * 0.2 + vec2( -flow * 0.4, flow * 0.3 ) ).r * 0.45;
        lace += ( texture2D( tN, p * 0.09 + flow * 2.0 ).r - 0.5 ) * 0.5;
        float foam = smoothstep( 0.84 - want, 1.2 - want, lace ) * clamp( want * 3.0, 0.0, 1.0 );
        // old foam, drifting in long fading streaks beyond the break
        float drift = smoothstep( 0.6, 0.76, texture2D( tFoam, p * 0.05 + vec2( flow * 0.5, flow ) ).r ) * smoothstep( 16.0, 2.0, d ) * smoothstep( 0.4, 0.6, wob ) * 0.3;
        foam = max( foam, drift * near );
        vec3 white = vec3( 0.8, 0.84, 0.84 ) * ( amb * 1.1 + lfSunC * lfSunDir.y * vis * 0.26 );
        c = mix( c, white, foam );

        // out to the haze on the horizon
        vec3 hz = lfSky( tSky, lmK, normalize( vec3( -v.x, 0.012, -v.z ) ) ) * skyK;
        c = mix( c, hz, 1.0 - exp( -dist / 2600.0 ) );

        float alpha = max( 1.0 - exp( -d * 1.7 ), foam );
        alpha = mix( alpha, 1.0, smoothstep( 40.0, 220.0, dist ) );
        alpha *= smoothstep( -0.02, 0.07, wet );
        gl_FragColor = vec4( c, alpha );
      }`,
  });
  // rings out from the eye, close together underfoot and kilometres apart at the horizon
  const seg = 192, rings = 150, pos: number[] = [], idx: number[] = [];
  pos.push(0, 0, 0);
  let r = 0.7;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    r *= i < 60 ? 1.058 : 1.09;
    r += 0.15;
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < seg; j++) {
    const a = 1 + i * seg + j, b = 1 + i * seg + ((j + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = 1;
  m.name = 'sea';
  m.onBeforeRender = (_r, _s, cam) => {
    (mat.uniforms.eye.value as THREE.Vector3).setFromMatrixPosition(cam.matrixWorld);
    mat.uniformsNeedUpdate = true;
  };
  return m;
}
