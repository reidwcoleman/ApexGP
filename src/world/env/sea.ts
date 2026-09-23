import * as THREE from 'three';
import { FAR_CELL, WorldMap } from './worldmap.ts';
import { noiseTexture, waterNormalTexture } from './textures.ts';

/**
 * The Mediterranean. A flat y = 0 mesh covering every cell that can show water,
 * shaded by a patched MeshStandardMaterial so it gets the real sky reflection
 * (scene.environment), GGX sun glitter, shadows and the aerial fog for free:
 *   - 4 octaves of scrolling normal maps (swell → ripples), faded with distance
 *   - depth-based body colour from a baked seabed height texture:
 *       turquoise over sand in the shallows → deep ultramarine offshore
 *   - animated shoreline foam where the seabed meets the surface
 *   - roughness rising with distance so the low sun paints a broad glitter path
 */

export interface SeaBuild {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
}

export function buildSea(map: WorldMap): SeaBuild {
  const { SQUARE, FINE, FAR } = map;
  // ---------------- seabed height textures straight from the baked grids
  const gridTex = (g: Float32Array, W: number, H: number) => {
    const d = new Uint16Array(W * H);
    for (let i = 0; i < d.length; i++) d[i] = THREE.DataUtils.toHalfFloat(Math.max(-80, Math.min(20, g[i])));
    const t = new THREE.DataTexture(d, W, H, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const depthTex = gridTex(map.mid, map.midW, map.midH);
  const depthFine = gridTex(map.fine, map.fineW, map.fineH);

  // ---------------- geometry: cells that may show water
  const pos: number[] = [];
  const idx: number[] = [];
  const vmap = new Map<string, number>();
  const vert = (x: number, z: number) => {
    const key = x + ',' + z;
    let v = vmap.get(key);
    if (v === undefined) {
      v = pos.length / 3;
      pos.push(x, 0, z);
      vmap.set(key, v);
    }
    return v;
  };
  const quad = (x0: number, z0: number, x1: number, z1: number) => {
    const a = vert(x0, z0), b = vert(x1, z0), c = vert(x0, z1), d = vert(x1, z1);
    idx.push(a, d, b, a, c, d);
  };
  // inside the square: 64 m cells, test the 16 m mid grid underneath
  {
    const C = 64;
    const k = C / 16;
    for (let z = SQUARE.z0; z < SQUARE.z1; z += C)
      for (let x = SQUARE.x0; x < SQUARE.x1; x += C) {
        const i0 = Math.round((x - SQUARE.x0) / 16), j0 = Math.round((z - SQUARE.z0) / 16);
        let min = Infinity;
        for (let j = j0; j <= j0 + k; j++)
          for (let i = i0; i <= i0 + k; i++) min = Math.min(min, map.mid[Math.min(j, map.midH - 1) * map.midW + Math.min(i, map.midW - 1)]);
        // fine detail near the coast: also check the exact height at a few points
        if (min > 1.2) {
          for (let q = 0; q < 9 && min > 1.2; q++) min = Math.min(min, map.height(x + ((q % 3) + 0.5) * (C / 3), z + (Math.floor(q / 3) + 0.5) * (C / 3)));
        }
        if (min < 1.2) quad(x, z, x + C, z + C);
      }
  }
  // outside: 512 m cells from the far grid
  {
    const C = FAR_CELL;
    for (let j = 0; j < map.farH - 1; j++)
      for (let i = 0; i < map.farW - 1; i++) {
        const x = FAR.x0 + i * C, z = FAR.z0 + j * C;
        const cx = x + C / 2, cz = z + C / 2;
        if (cx > SQUARE.x0 && cx < SQUARE.x1 && cz > SQUARE.z0 && cz < SQUARE.z1) continue;
        const f = map.far;
        const W = map.farW;
        const min = Math.min(f[j * W + i], f[j * W + i + 1], f[(j + 1) * W + i], f[(j + 1) * W + i + 1]);
        if (min < 2) quad(x, z, x + C, z + C);
      }
  }
  // horizon skirt: a huge ring far out to the south so the sea meets the sky
  {
    const R0 = 15000, R1 = 60000;
    const segs = 48;
    const cx = -500, cz = 500;
    for (let s = 0; s < segs; s++) {
      const a0 = (s / segs) * Math.PI * 2, a1 = ((s + 1) / segs) * Math.PI * 2;
      // only the seaward half (south-ish)
      const mid = (a0 + a1) / 2;
      if (Math.sin(mid) < -0.25) continue;
      const p = [
        [cx + Math.cos(a0) * R0, cz + Math.sin(a0) * R0],
        [cx + Math.cos(a1) * R0, cz + Math.sin(a1) * R0],
        [cx + Math.cos(a0) * R1, cz + Math.sin(a0) * R1],
        [cx + Math.cos(a1) * R1, cz + Math.sin(a1) * R1],
      ];
      // skip parts already covered by the FAR grid
      const ins = (x: number, z: number) => x > FAR.x0 && x < FAR.x1 && z > FAR.z0 && z < FAR.z1;
      if (ins(p[0][0], p[0][1]) && ins(p[1][0], p[1][1])) continue;
      const v0 = pos.length / 3;
      for (const [x, z] of p) pos.push(x, 0, z);
      idx.push(v0, v0 + 3, v0 + 1, v0, v0 + 2, v0 + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const uniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uWaterN: { value: waterNormalTexture() },
    uNoise: { value: noiseTexture() },
    uSeabed: { value: depthTex },
    uSeabedBox: { value: new THREE.Vector4(SQUARE.x0, SQUARE.z0, SQUARE.x1 - SQUARE.x0, SQUARE.z1 - SQUARE.z0) },
    uSeabedFine: { value: depthFine },
    uSeabedFineBox: { value: new THREE.Vector4(FINE.x0, FINE.z0, FINE.x1 - FINE.x0, FINE.z1 - FINE.z0) },
    uDeep: { value: new THREE.Color(0x06243f) },
    uMid: { value: new THREE.Color(0x0b4f6a) },
    uShallow: { value: new THREE.Color(0x2c9c9a) },
    uSandWet: { value: new THREE.Color(0x6f8a78) },
    uWaveScale: { value: 1 },
  };

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSeaPos;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvSeaPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform sampler2D uWaterN;
uniform sampler2D uNoise;
uniform sampler2D uSeabed;
uniform vec4 uSeabedBox;
uniform sampler2D uSeabedFine;
uniform vec4 uSeabedFineBox;
uniform vec3 uDeep, uMid, uShallow, uSandWet;
uniform float uWaveScale;
varying vec3 vSeaPos;
float sRough;
vec3 sN;
vec2 wslope( vec2 uv ) {
  vec3 n = texture2D( uWaterN, uv ).rgb * 2.0 - 1.0;
  return n.xy / max( n.z, 0.2 );
}
`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 p = vSeaPos.xz;
  float dist = length( vSeaPos - cameraPosition );
  vec2 suv = ( p - uSeabedBox.xy ) / uSeabedBox.zw;
  float bed = -60.0;
  vec2 fuv = ( p - uSeabedFineBox.xy ) / uSeabedFineBox.zw;
  // grid vertices sit on texel centres
  vec2 tsF = vec2( textureSize( uSeabedFine, 0 ) );
  vec2 tsM = vec2( textureSize( uSeabed, 0 ) );
  if ( fuv.x > 0.0 && fuv.y > 0.0 && fuv.x < 1.0 && fuv.y < 1.0 ) bed = texture2D( uSeabedFine, ( fuv * ( tsF - 1.0 ) + 0.5 ) / tsF ).r;
  else if ( suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0 ) bed = texture2D( uSeabed, ( suv * ( tsM - 1.0 ) + 0.5 ) / tsM ).r;
  float depth = max( 0.0, -bed );
  float t = uTime;
  // waves: swell → ripples, high octaves fade out with distance
  float f1 = 1.0 - smoothstep( 40.0, 420.0, dist );
  float f2 = 1.0 - smoothstep( 180.0, 1600.0, dist );
  // non-harmonic scales + rotations so no two octaves repeat together
  vec2 s = wslope( mat2( 0.94, 0.34, -0.34, 0.94 ) * p * 0.0071 + t * vec2( 0.0016, 0.0026 ) ) * 1.0
         + wslope( mat2( 0.82, -0.57, 0.57, 0.82 ) * p * 0.0193 + t * vec2( -0.0051, 0.0043 ) ) * 0.6 * ( 0.45 + 0.55 * f2 )
         + wslope( mat2( 0.5, 0.87, -0.87, 0.5 ) * p * 0.061 + t * vec2( 0.0105, 0.0071 ) ) * 0.4 * f2
         + wslope( mat2( 0.98, 0.17, -0.17, 0.98 ) * p * 0.173 + t * vec2( -0.019, 0.023 ) ) * 0.24 * f1;
  // wind slicks: large calmer / rougher patches (breaks up the glitter path)
  float slick = texture2D( uNoise, p * 0.00085 + vec2( t * 0.0004, 0.0 ) ).r * 0.6 + texture2D( uNoise, p * 0.0031 ).g * 0.4;
  s *= 0.2 * uWaveScale * mix( 0.45, 1.35, smoothstep( 0.3, 0.72, slick ) );
  // calmer inside the harbour & the shallows
  s *= mix( 0.45, 1.0, smoothstep( 1.5, 7.0, depth ) );
  sN = normalize( vec3( -s.x, 1.0, -s.y ) );
  // body colour
  float dk = 1.0 - exp( - depth / 6.0 );
  vec3 body = mix( uShallow, uMid, smoothstep( 0.0, 0.55, dk ) );
  body = mix( body, uDeep, smoothstep( 0.45, 1.0, dk ) );
  body = mix( uSandWet, body, smoothstep( 0.0, 0.8, depth ) );
  // shoreline foam: wash bands + noise
  float fn = texture2D( uNoise, p * 0.071 + vec2( t * 0.013, 0.0 ) ).b * 0.6 + texture2D( uNoise, p * 0.23 - vec2( 0.0, t * 0.021 ) ).a * 0.6;
  float wash = 0.5 + 0.5 * sin( t * 0.9 - depth * 3.2 + fn * 2.0 );
  float band = 1.0 - smoothstep( 0.0, 0.45, depth );
  float foam = smoothstep( 0.62, 0.98, fn * 0.8 + wash * 0.5 ) * band;
  foam = max( foam, smoothstep( 0.1, 0.0, depth ) * 0.35 * ( 0.4 + 0.6 * fn ) );
  foam *= 0.75;
  diffuseColor.rgb = mix( body, vec3( 0.86, 0.88, 0.88 ), foam );
  sRough = mix( 0.035, 0.16, smoothstep( 60.0, 3500.0, dist ) );
  sRough = mix( sRough, 0.75, foam );
}
`,
      )
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = sRough;`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = normalize( ( viewMatrix * vec4( sN, 0.0 ) ).xyz );`,
      );
  };
  mat.customProgramCacheKey = () => 'apex-sea-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'Sea';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  return { mesh, uniforms };
}
