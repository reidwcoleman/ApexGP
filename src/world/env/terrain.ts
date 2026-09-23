import * as THREE from 'three';
import { FAR_CELL, FINE_CELL, MID_CELL, WorldMap, bilinear } from './worldmap.ts';
import { detailNormalTexture, noiseTexture } from './textures.ts';
import { fbm2, smoothstep } from './noise.ts';

/**
 * Terrain meshes: 4 m chunks around the circuit, 16 m chunks over the 6 km square,
 * 512 m far ring. Grids are stitched (boundary vertices lie on the coarser edge),
 * cells fully under the sea are dropped. One splat shader for all of it.
 */

export interface TerrainBuild {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  uniforms: Record<string, THREE.IUniform>;
}

const lin = (hex: number) => new THREE.Color(hex);

export function createTerrainMaterial(maxAniso: number): { material: THREE.MeshStandardMaterial; uniforms: Record<string, THREE.IUniform> } {
  const noise = noiseTexture();
  const detail = detailNormalTexture();
  noise.anisotropy = maxAniso;
  detail.anisotropy = maxAniso;
  const uniforms: Record<string, THREE.IUniform> = {
    uNoise: { value: noise },
    uDetailN: { value: detail },
    uGrassDry: { value: lin(0x9c8f55) },
    uGrassGreen: { value: lin(0x5f7436) },
    uGrassDark: { value: lin(0x3f5427) },
    uDirt: { value: lin(0x9a6e4c) },
    uRock: { value: lin(0xb9ad98) },
    uRockDark: { value: lin(0x6f6559) },
    uSand: { value: lin(0xd8c49c) },
    uForest: { value: lin(0x5a4a33) },
    uPaved: { value: lin(0x77746f) },
    uCanopy: { value: lin(0x37452a) },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 aSplat;
varying vec4 vSplat;
varying vec3 vWPos;
varying vec3 vWNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vSplat = aSplat;
vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vWNormal = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uNoise;
uniform sampler2D uDetailN;
uniform vec3 uGrassDry, uGrassGreen, uGrassDark, uDirt, uRock, uRockDark, uSand, uForest, uPaved, uCanopy;
varying vec4 vSplat;
varying vec3 vWPos;
varying vec3 vWNormal;
float tRough;
vec3 tDetailN;
`,
      )
      .replace(
        '#include <map_fragment>',
        `
{
  vec2 p = vWPos.xz;
  float camDist = length( vWPos - cameraPosition );
  float m1 = texture2D( uNoise, p * 0.00093 + vec2( 0.13, 0.71 ) ).r;
  float m2 = texture2D( uNoise, p * 0.0041 + vec2( 0.37, 0.19 ) ).g;
  float m3 = texture2D( uNoise, p * 0.019 ).b;
  float d1 = texture2D( uNoise, mat2( 0.8, -0.6, 0.6, 0.8 ) * p * 0.121 ).a;
  float d2 = texture2D( uNoise, p * 0.43 + vec2( 0.5 ) ).g;
  float nearF = 1.0 - smoothstep( 30.0, 260.0, camDist );
  float slope = 1.0 - clamp( vWNormal.y, 0.0, 1.0 );

  // dry Mediterranean grass: gold ↔ olive green, clumpy
  float greenK = smoothstep( 0.36, 0.72, m1 * 0.55 + m2 * 0.45 );
  vec3 grass = mix( uGrassDry, uGrassGreen, greenK );
  grass = mix( grass, uGrassDark, smoothstep( 0.55, 0.85, m3 ) * 0.45 );
  // straw / ochre drift
  grass *= mix( vec3( 1.0 ), vec3( 1.08, 0.97, 0.82 ), smoothstep( 0.4, 0.8, m3 * 0.5 + d1 * 0.5 ) );
  // macchia stipple: dark speckles that read as scrub from afar
  float st = texture2D( uNoise, p * 0.071 + vec2( 0.3, 0.1 ) ).a * texture2D( uNoise, p * 0.017 ).g * 2.0;
  float scrub = smoothstep( 0.62, 0.8, st ) * ( 1.0 - smoothstep( 0.35, 0.6, slope ) ) * ( 1.0 - vSplat.y );
  grass = mix( grass, uGrassDark * 0.6, scrub * 0.8 );
  grass *= mix( 1.0, 0.72 + 0.5 * d1 * ( 0.75 + 0.25 * d2 ), 0.35 + 0.65 * nearF );
  // bare earth patches (terra rossa)
  float bare = smoothstep( 0.6, 0.78, m2 * 0.55 + m3 * 0.45 + ( d1 - 0.5 ) * 0.12 );
  bare = max( bare * 0.8, vSplat.w );
  vec3 dirt = uDirt * ( 0.78 + 0.35 * d2 ) * ( 0.9 + 0.2 * m3 );
  vec3 col = mix( grass, dirt, bare );
  // farmland patchwork on gentle low ground (domain-warped cells, hedge lines)
  {
    vec2 wp = p + ( vec2( m1, m2 ) - 0.5 ) * 160.0;
    vec2 fs = vec2( 150.0, 105.0 );
    vec2 cell = floor( wp / fs );
    float h1 = fract( sin( dot( cell, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
    float h2 = fract( sin( dot( cell, vec2( 269.5, 183.3 ) ) ) * 43758.5453 );
    vec2 fc = fract( wp / fs );
    float edge = smoothstep( 0.0, 0.035, min( min( fc.x, 1.0 - fc.x ), min( fc.y, 1.0 - fc.y ) ) );
    float fieldK = ( 1.0 - smoothstep( 0.05, 0.14, slope ) ) * ( 1.0 - smoothstep( 70.0, 150.0, vWPos.y ) ) * step( 0.4, h2 )
                 * ( 1.0 - vSplat.z ) * ( 1.0 - vSplat.y ) * ( 1.0 - vSplat.x ) * ( 1.0 - vSplat.w );
    vec3 fieldCol = h1 < 0.3 ? uGrassDry * vec3( 1.08, 1.03, 0.9 ) : h1 < 0.48 ? mix( uDirt, uGrassDry, 0.35 ) : h1 < 0.7 ? mix( uGrassGreen, uGrassDry, 0.3 ) : uGrassDry * vec3( 0.9, 0.92, 0.86 );
    // furrow / stubble stripes
    float stripe = 0.93 + 0.07 * sin( dot( p, vec2( 0.8, 0.6 ) * ( 1.5 + h2 ) ) );
    col = mix( col, fieldCol * stripe * ( 0.9 + 0.2 * d1 ), fieldK * 0.6 );
    col = mix( col, uGrassDark * 0.85, fieldK * ( 1.0 - edge ) * 0.45 );
  }
  // pine forest: needle floor up close, canopy mass from afar
  float farF = smoothstep( 220.0, 1100.0, camDist );
  vec3 forestC = mix( uForest * ( 0.75 + 0.45 * d1 ), uCanopy * ( 0.75 + 0.5 * m3 ), farF );
  col = mix( col, forestC, vSplat.z * mix( 0.8, 0.97, farF ) );
  // limestone rock on steep ground: triplanar-ish strata
  vec3 an = abs( vWNormal );
  float rn = texture2D( uNoise, vWPos.xy * 0.045 ).b * an.z + texture2D( uNoise, vWPos.zy * 0.045 ).b * an.x + m3 * an.y;
  float strata = texture2D( uNoise, vec2( vWPos.y * 0.09, ( vWPos.x + vWPos.z ) * 0.002 ) ).g;
  vec3 rockC = mix( uRockDark, uRock, smoothstep( 0.25, 0.75, rn * 0.6 + strata * 0.6 ) );
  float rock = smoothstep( 0.3, 0.52, slope + ( m3 - 0.5 ) * 0.22 + ( d1 - 0.5 ) * 0.1 );
  // limestone outcrops on the hills
  rock = max( rock, smoothstep( 0.66, 0.8, m2 * 0.45 + m3 * 0.55 ) * smoothstep( 45.0, 130.0, vWPos.y ) * 0.85 );
  col = mix( col, rockC, rock );
  // sand + wet sand at the waterline
  float sandK = vSplat.x * ( 1.0 - rock * 0.7 );
  col = mix( col, uSand * ( 0.9 + 0.18 * d2 ), sandK );
  float wet = 1.0 - smoothstep( 0.15, 1.1, vWPos.y );
  col *= mix( 1.0, 0.62, wet * max( sandK, 0.5 ) );
  // paved (paddock, quays, plazas)
  col = mix( col, uPaved * ( 0.86 + 0.22 * d1 ) * ( 0.92 + 0.16 * m3 ), vSplat.y );
  // under water: seabed darkens
  col *= mix( 1.0, 0.55, smoothstep( 0.0, -3.0, vWPos.y ) );
  diffuseColor.rgb *= col;
  tRough = mix( 0.96, 0.82, rock );
  tRough = mix( tRough, 0.9, vSplat.y );
  tRough = mix( tRough, 0.55, wet * sandK );
  float dStr = nearF * ( 0.55 + 0.45 * ( 1.0 - vSplat.y ) );
  vec3 dn1 = texture2D( uDetailN, p * 0.31 ).rgb * 2.0 - 1.0;
  vec3 dn2 = texture2D( uDetailN, mat2( 0.6, 0.8, -0.8, 0.6 ) * p * 0.083 ).rgb * 2.0 - 1.0;
  tDetailN = vec3( dn1.x + dn2.x * 0.8, 0.0, dn1.y + dn2.y * 0.8 ) * ( 0.45 + rock * 0.5 ) * dStr;
}
`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = tRough;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
{
  vec3 nW = normalize( vWNormal + tDetailN );
  vec3 nV = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
  normal = normalize( mix( normal, nV, 1.0 ) );
}`,
      );
  };
  material.customProgramCacheKey = () => 'apex-terrain-v1';
  return { material, uniforms };
}

interface GridSource {
  heights: Float32Array;
  W: number;
  H: number;
  x0: number;
  z0: number;
  cell: number;
}

function splatFor(map: WorldMap, x: number, z: number, h: number, trackW: number, paved: number, sand: number, out: number[]) {
  if (h < -3) {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
    return;
  }
  const town = map.town(x, z);
  const pavedK = Math.max(paved, town * 0.3);
  const forest = map.forest(x, z) * (1 - pavedK) * (1 - sand);
  // worn dirt just behind the barriers and in the runoff blend band
  let dirt = 0;
  if (trackW > 0.02 && trackW < 0.98) {
    dirt = smoothstep(0.05, 0.5, trackW) * (1 - smoothstep(0.7, 0.98, trackW)) * (0.4 + 0.6 * (fbm2(x / 40, z / 40, 2) * 0.5 + 0.5));
  }
  out[0] = sand;
  out[1] = pavedK;
  out[2] = forest;
  out[3] = dirt * (1 - pavedK);
}

function buildChunk(
  map: WorldMap,
  g: GridSource,
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  skipCell: (x: number, z: number) => boolean,
  extras: { track?: Float32Array; paved?: Float32Array; sand?: Float32Array },
  skirt: { x0?: boolean; x1?: boolean; z0?: boolean; z1?: boolean },
): THREE.BufferGeometry | null {
  const nx = i1 - i0 + 1;
  const nz = j1 - j0 + 1;
  const vcount = nx * nz;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const spl = new Uint8Array(vcount * 4);
  const tmp = [0, 0, 0, 0];
  const C = g.cell;
  const hAt = (i: number, j: number) => {
    if (i >= 0 && j >= 0 && i < g.W && j < g.H) return g.heights[j * g.W + i];
    return map.height(g.x0 + i * C, g.z0 + j * C);
  };
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const v = (j - j0) * nx + (i - i0);
      const x = g.x0 + i * C, z = g.z0 + j * C;
      const h = g.heights[j * g.W + i];
      pos[v * 3] = x;
      pos[v * 3 + 1] = h;
      pos[v * 3 + 2] = z;
      const hx = hAt(i + 1, j) - hAt(i - 1, j);
      const hz = hAt(i, j + 1) - hAt(i, j - 1);
      const L = Math.hypot(hx, 2 * C, hz);
      nor[v * 3] = -hx / L;
      nor[v * 3 + 1] = (2 * C) / L;
      nor[v * 3 + 2] = -hz / L;
      const k = j * g.W + i;
      splatFor(map, x, z, h, extras.track ? extras.track[k] : 0, extras.paved ? extras.paved[k] : 0, extras.sand ? extras.sand[k] : 0, tmp);
      spl[v * 4] = tmp[0] * 255;
      spl[v * 4 + 1] = tmp[1] * 255;
      spl[v * 4 + 2] = tmp[2] * 255;
      spl[v * 4 + 3] = tmp[3] * 255;
    }
  const idx: number[] = [];
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++) {
      const x = g.x0 + (i + 0.5) * C, z = g.z0 + (j + 0.5) * C;
      const k = j * g.W + i;
      const hs = g.heights;
      if (hs[k] < -3 && hs[k + 1] < -3 && hs[k + g.W] < -3 && hs[k + g.W + 1] < -3) continue;
      if (skipCell(x, z)) continue;
      const a = (j - j0) * nx + (i - i0);
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      // diagonal a–d (matches WorldMap.height's bilinear split)
      idx.push(a, d, b, a, c, d);
    }
  if (idx.length === 0) return null;
  // skirts: extra vertices dropped 3 m below along chosen chunk edges
  const extraPos: number[] = [];
  const extraNor: number[] = [];
  const extraSpl: number[] = [];
  let next = vcount;
  const addSkirt = (verts: number[], flip: boolean) => {
    for (let q = 0; q < verts.length - 1; q++) {
      const va = verts[q], vb = verts[q + 1];
      for (const v of [va, vb]) {
        extraPos.push(pos[v * 3], pos[v * 3 + 1] - 3, pos[v * 3 + 2]);
        extraNor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
        extraSpl.push(spl[v * 4], spl[v * 4 + 1], spl[v * 4 + 2], spl[v * 4 + 3]);
      }
      const sa = next++, sb = next++;
      if (flip) idx.push(va, sb, vb, va, sa, sb);
      else idx.push(va, vb, sb, va, sb, sa);
    }
  };
  if (skirt.z0) addSkirt(Array.from({ length: nx }, (_, i) => i), false);
  if (skirt.z1) addSkirt(Array.from({ length: nx }, (_, i) => (nz - 1) * nx + i), true);
  if (skirt.x0) addSkirt(Array.from({ length: nz }, (_, j) => j * nx), true);
  if (skirt.x1) addSkirt(Array.from({ length: nz }, (_, j) => j * nx + nx - 1), false);

  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(pos.length + extraPos.length);
  P.set(pos);
  P.set(extraPos, pos.length);
  const Nn = new Float32Array(nor.length + extraNor.length);
  Nn.set(nor);
  Nn.set(extraNor, nor.length);
  const S = new Uint8Array(spl.length + extraSpl.length);
  S.set(spl);
  S.set(extraSpl, spl.length);
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(S, 4, true));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export function buildTerrain(map: WorldMap, maxAniso: number): TerrainBuild {
  const { SQUARE, FINE, FAR } = map;
  const group = new THREE.Group();
  group.name = 'Terrain';
  const { material, uniforms } = createTerrainMaterial(maxAniso);

  const addMesh = (geo: THREE.BufferGeometry | null, name: string) => {
    if (!geo) return;
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.receiveShadow = true;
    m.castShadow = false;
    m.matrixAutoUpdate = false;
    group.add(m);
  };

  // fine chunks (4 m, 128 cells ≈ 512 m)
  {
    const g: GridSource = { heights: map.fine, W: map.fineW, H: map.fineH, x0: FINE.x0, z0: FINE.z0, cell: FINE_CELL };
    const CH = 128;
    for (let j0 = 0; j0 < g.H - 1; j0 += CH)
      for (let i0 = 0; i0 < g.W - 1; i0 += CH) {
        const i1 = Math.min(i0 + CH, g.W - 1);
        const j1 = Math.min(j0 + CH, g.H - 1);
        const geo = buildChunk(map, g, i0, j0, i1, j1, () => false, { track: map.fineTrack, paved: map.finePaved, sand: map.fineSand }, {
          x0: i0 === 0, x1: i1 === g.W - 1, z0: j0 === 0, z1: j1 === g.H - 1,
        });
        addMesh(geo, `terrain_fine_${i0}_${j0}`);
      }
  }
  // mid chunks (16 m, 64 cells = 1024 m), skipping the fine region
  {
    const g: GridSource = { heights: map.mid, W: map.midW, H: map.midH, x0: SQUARE.x0, z0: SQUARE.z0, cell: MID_CELL };
    const CH = 64;
    const inFine = (x: number, z: number) => x > FINE.x0 && x < FINE.x1 && z > FINE.z0 && z < FINE.z1;
    for (let j0 = 0; j0 < g.H - 1; j0 += CH)
      for (let i0 = 0; i0 < g.W - 1; i0 += CH) {
        const i1 = Math.min(i0 + CH, g.W - 1);
        const j1 = Math.min(j0 + CH, g.H - 1);
        const geo = buildChunk(map, g, i0, j0, i1, j1, inFine, { sand: map.midSand }, {});
        addMesh(geo, `terrain_mid_${i0}_${j0}`);
      }
  }
  // far ring (512 m)
  {
    const g: GridSource = { heights: map.far, W: map.farW, H: map.farH, x0: FAR.x0, z0: FAR.z0, cell: FAR_CELL };
    const inSquare = (x: number, z: number) => x > SQUARE.x0 && x < SQUARE.x1 && z > SQUARE.z0 && z < SQUARE.z1;
    const geo = buildChunk(map, g, 0, 0, g.W - 1, g.H - 1, inSquare, {}, {});
    addMesh(geo, 'terrain_far');
  }
  void bilinear;
  return { group, material, uniforms };
}
