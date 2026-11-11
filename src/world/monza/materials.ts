import * as THREE from 'three';
import { weatherUniforms as W } from '../weatherUniforms.ts';
import type { MonzaAssets } from './assets.ts';

/**
 * The new Monza's surfaces. Every ground mesh carries two track-space attributes:
 *   aTrk = (lateral m, s m, lateral − racing line, half width − |lateral|)
 *   aK   = (zone, rubber, kerb beside, spare)      zone: 0 road · 1 verge strip · 2 run-off
 * and the shaders paint with them: the rubbered line, the edge lines, the green behind the kerbs.
 * Light, shadow, fog, headlights and the weather's light come from the engine's own chunks (any lit
 * three material gets them); the rain's water on the ground is read from the shared weather uniforms.
 */

const VERT_PARS = /* glsl */ `
attribute vec4 aTrk;
attribute vec4 aK;
varying vec4 vTrk;
varying vec4 vK;
`;
const VERT_MAIN = /* glsl */ `
vTrk = aTrk;
vK = aK;
`;
const FRAG_PARS = /* glsl */ `
uniform sampler2D uNoise;
uniform float uWetness;
uniform float uRain;
uniform float uDryLine;
uniform float uWeatherTime;
uniform float uSnowCover;
varying vec4 vTrk;
varying vec4 vK;
float mzRough = 0.8;
vec4 mzN(vec2 p) { return texture2D(uNoise, p); }
// standing water: a film everywhere, pooled where the noise says the surface dips
float mzWater(vec2 p, float wet) { return wet * (0.45 + 0.55 * smoothstep(0.3, 0.75, 0.6 * mzN(p / 71.0).g + 0.4 * mzN(p / 29.0).r)); }
`;

function patch(m: THREE.MeshStandardMaterial, key: string, a: MonzaAssets, main: string, extra: Record<string, THREE.IUniform> = {}) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: a.noise };
    sh.uniforms.uWetness = W.uWetness;
    sh.uniforms.uRain = W.uRain;
    sh.uniforms.uDryLine = W.uDryLine;
    sh.uniforms.uWeatherTime = W.uWeatherTime;
    sh.uniforms.uSnowCover = W.uSnowCover;
    Object.assign(sh.uniforms, extra);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', main)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mzRough;');
  };
  m.customProgramCacheKey = () => key;
}

/** metres one repeat of each photo covers */
export const TILE = { asphalt: 1.5, grass: 2.2, gravel: 0.9, concrete: 2.0 };

/**
 * The 2024 surface: near-black stone-mastic asphalt, rubbered in along the line (two tyre tracks in
 * a darker, smoother band — heaviest into the braking zones and through the corners, which the mesh
 * says in aK.y), a paver's seam down the middle, a day joint now and then, dust off the line, and
 * the white track-limit lines rolled onto its edges. Outside the road the same material is the
 * strip behind the kerbs (painted green where there is a kerb) and the asphalt run-offs.
 */
export function asphaltMaterial(a: MonzaAssets): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: a.asphalt, normalMap: a.asphaltN, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.8, metalness: 0 });
  patch(
    m,
    'mz-asphalt-6',
    a,
    /* glsl */ `
{
  float lat = vTrk.x, sv = vTrk.y, lineD = vTrk.z, edgeIn = vTrk.w;
  float zone = vK.x;
  vec2 tp = vec2(lat, sv);
  // the photo at two scales, swapped by a slow noise: no repeat to find down a 1 km straight
  vec3 a1 = texture2D(map, vMapUv).rgb;
  vec3 a2 = texture2D(map, vec2(lat * 0.83 + sv * 0.21, sv * 0.83 - lat * 0.21) / 4.3 + 0.37).rgb;
  vec4 nA = mzN(tp / 11.0);
  vec4 nB = mzN(vec2(lat * 0.6, sv) / 53.0);
  vec3 alb = mix(a1, a2 * 1.02, smoothstep(0.38, 0.62, nA.r));
  // (the photo's grain at two thirds: full strength it glittered under the car and crawled at speed)
  alb = mix(vec3(0.075), alb, 0.66);
  // laid in passes and in days: slow drifts of tone, a touch browner where the binder has weathered
  alb *= 0.86 + 0.28 * nB.r;
  alb *= 0.95 + 0.1 * nA.b;
  alb = mix(alb, alb * vec3(1.05, 1.0, 0.93), smoothstep(0.5, 0.8, nB.g) * 0.5);
  mzRough = 0.74 + 0.1 * nA.a - 0.25 * (dot(a1, vec3(0.33)) - 0.06) / 0.06 * 0.2;
  float px = max(fwidth(lat), 1e-4);
  if (zone < 0.5) {
    // the paver's seam between the two passes, and a transverse day joint every ~210 m: sealed, darker, glossier
    float seam = 1.0 - smoothstep(0.012, 0.03 + px, abs(lat + 0.35 + (nA.g - 0.5) * 0.08));
    float jv = abs(fract(sv / 210.0 + 0.31) - 0.5) * 210.0;
    seam = max(seam * 0.55, 1.0 - smoothstep(0.02, 0.05 + fwidth(sv), jv));
    alb = mix(alb, alb * 0.55, seam * 0.6);
    mzRough = mix(mzRough, 0.45, seam * 0.6);
    // rubber: thousands of laps on nearly the same line — a soft dark band, two blacker tyre tracks in it,
    // laid in long streaks; it fills the texture, so it is smoother and catches the sky
    float band = exp(-lineD * lineD / 2.6);
    float trk = exp(-pow((abs(lineD) - 0.8) / 0.34, 2.0));
    float streak = mzN(vec2(lat * 0.7, sv * 0.0045)).b;
    float rub = clamp(vK.y * (0.6 * band + 0.42 * trk) * (0.6 + 0.8 * smoothstep(0.25, 0.75, streak)), 0.0, 1.0);
    alb = mix(alb, vec3(0.017, 0.017, 0.019), rub * 0.82);
    mzRough = mix(mzRough, 0.4, rub * 0.75);
    // off the line nothing sweeps the surface: a paler, dustier road toward the edges
    float off = smoothstep(2.4, 4.6, abs(lineD)) * (0.5 + 0.5 * nA.b);
    alb = mix(alb, alb * 1.22 + 0.004, off * 0.5);
    // the white lines: 15 cm of road paint on the last of the asphalt, its edge ragged with the stone,
    // greyed where the tyres cross it
    float rag = (a1.g - 0.06) * 0.25;
    float lw = smoothstep(-px, px, edgeIn - 0.02 + rag) * (1.0 - smoothstep(-px, px, edgeIn - 0.17 + rag));
    vec3 paintC = vec3(0.66, 0.66, 0.63) * (0.82 + 0.3 * mzN(tp / 2.1).r) * mix(1.0, 0.62, rub + 0.35 * smoothstep(0.55, 0.8, nA.g));
    alb = mix(alb, paintC * (0.9 + 1.4 * (a1.g - 0.06)), lw * 0.94);
    mzRough = mix(mzRough, 0.5, lw);
  } else if (zone < 1.5) {
    // behind a kerb: green anti-slip paint, scuffed and dirty; with no kerb, the road's unswept shoulder
    vec3 green = vec3(0.022, 0.19, 0.06) * (0.75 + 0.5 * nA.r) * (0.9 + 2.0 * (a1.g - 0.06));
    green = mix(green, alb * 1.4, smoothstep(0.55, 0.85, nA.g) * 0.55);
    alb = mix(alb * 1.2 + 0.004, green, vK.z);
    mzRough = mix(0.86, 0.7, vK.z);
  } else {
    // an asphalt run-off: an older, coarser, greyer mix, with dust lying on it
    alb = alb * 1.75 + 0.012 * nB.b;
    alb = mix(alb, alb * vec3(1.06, 1.0, 0.9), 0.4);
    mzRough = 0.88;
  }
  // rain: wet asphalt is nearly black and mirrors the sky where the water stands; the line dries first
  float wet = mzWater(tp, uWetness) * (1.0 - 0.75 * uDryLine * exp(-lineD * lineD / 3.0) * step(zone, 0.5));
  alb *= 1.0 - 0.55 * smoothstep(0.0, 0.5, wet);
  mzRough = mix(mzRough, 0.16, smoothstep(0.3, 1.0, wet));
  diffuseColor.rgb = alb;
}
`,
  );
  return m;
}

/**
 * Kerbs: flat cast-concrete units painted red and white, 1.5 m a block. The paint is thick and a
 * little glossy; the tyres' side of it carries rubber, the white is never white, and here and there
 * a chip shows the concrete.
 */
export function kerbMaterial(a: MonzaAssets): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: a.kerb, normalMap: a.concreteN, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.6, metalness: 0 });
  patch(
    m,
    'mz-kerb-4',
    a,
    /* glsl */ `
{
  float u = vTrk.x, sv = vTrk.y;
  // the photographed kerb: four 1.5 m blocks a repeat (red, white, red, white), its width across the units
  vec3 col = texture2D(map, vec2(sv / 6.0, 0.08 + 0.84 * u)).rgb;
  vec4 n1 = mzN(vec2(u * 0.6, sv * 0.02));
  vec4 n2 = mzN(vec2(u, sv) / 1.7);
  // (paint as paint: a little under the photo's studio white, and no two stretches quite alike)
  col *= 0.8 * (0.9 + 0.2 * mzN(vec2(sv / 37.0, 0.3)).r);
  // rubber where the tyres ride (the road side), in streaks along the lap; a road film over the rest
  float rub = (1.0 - smoothstep(0.1, 0.75, u)) * smoothstep(0.35, 0.75, n1.b) * (0.5 + 0.5 * vK.y);
  col = mix(col, vec3(0.03, 0.03, 0.032), rub * 0.6);
  col *= 0.88 + 0.12 * n2.r;
  // the groove against the road, packed with grit
  col *= 1.0 - 0.6 * (1.0 - smoothstep(0.0, 0.035, u));
  mzRough = mix(0.45, 0.7, rub);
  float wet = mzWater(vec2(u, sv), uWetness);
  col *= 1.0 - 0.4 * smoothstep(0.0, 0.5, wet);
  mzRough = mix(mzRough, 0.1, smoothstep(0.2, 0.9, wet));
  diffuseColor.rgb = col;
}
`,
  );
  return m;
}

/**
 * Grass. `open` 0 = the mown verge between the road and the barrier (stripes from the mower, worn
 * and dusty against the road), 1 = the park's ground beyond it (longer, patchier, leaf litter and
 * bare earth under the trees — the woodland-floor photo mixed in by a slow noise).
 */
export function grassMaterial(a: MonzaAssets, open: boolean): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: a.grass, normalMap: a.grassN, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.92, metalness: 0 });
  patch(
    m,
    open ? 'mz-ground-2' : 'mz-verge-2',
    a,
    /* glsl */ `
{
  vec2 tp = vTrk.xy;
  vec3 g1 = texture2D(map, vMapUv).rgb;
  vec3 g2 = texture2D(map, vec2(tp.x * 0.8 + tp.y * 0.3, tp.y * 0.8 - tp.x * 0.3) / 7.9 + 0.21).rgb;
  vec4 nA = mzN(tp / 23.0);
  vec4 nB = mzN(tp / 97.0);
  vec3 col = mix(g1, g2 * 1.05, smoothstep(0.35, 0.65, nA.r));
  // sward: drier, yellower patches and lusher ones, tens of metres across
  col *= 0.8 + 0.4 * nB.r;
  col = mix(col, col * vec3(1.22, 1.08, 0.72), smoothstep(0.5, 0.85, nB.g) * 0.55);
  col = mix(col, col * vec3(0.82, 1.0, 0.85), smoothstep(0.55, 0.85, nA.b) * 0.4);
  mzRough = 0.9;
  ${
    open
      ? /* glsl */ `
  // under the trees: leaf litter, bare earth, thin grass
  vec3 fl = texture2D(uFloor, tp / 3.1).rgb;
  float lit = smoothstep(0.42, 0.6, nA.g * 0.6 + nB.b * 0.5 + vK.y * 0.35);
  col = mix(col * 0.92, fl * (0.8 + 0.4 * nA.a), lit * 0.85);
  `
      : /* glsl */ `
  // the mower's passes along the track, and the worn, dusty first half-metre by the asphalt
  col *= 1.0 + 0.07 * sin(tp.x * 2.6) * (1.0 - smoothstep(0.02, 0.12, fwidth(tp.x)));
  float wear = (1.0 - smoothstep(0.0, 0.9, vK.z)) * (0.4 + 0.6 * nA.r);
  col = mix(col, vec3(0.15, 0.125, 0.085) * (0.7 + 0.6 * nA.a), wear * 0.5);
  `
  }
  float wet = uWetness;
  col *= 1.0 - 0.25 * wet;
  mzRough = mix(mzRough, 0.55, wet * 0.6);
  col = mix(col, vec3(0.78, 0.8, 0.84), uSnowCover * smoothstep(0.2, 0.6, nA.r + uSnowCover * 0.6));
  diffuseColor.rgb = col;
}
`,
    open ? { uFloor: { value: a.floor } } : {},
  );
  if (open) {
    const base = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      base.call(m, sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('uniform sampler2D uNoise;', 'uniform sampler2D uNoise;\nuniform sampler2D uFloor;');
    };
  }
  return m;
}

/** the traps: a bed of grey limestone chippings, paler where fresh and darker where cars have been dug out */
export function gravelMaterial(a: MonzaAssets): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: a.gravel, normalMap: a.gravelN, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.92, metalness: 0 });
  patch(
    m,
    'mz-gravel-2',
    a,
    /* glsl */ `
{
  vec2 tp = vTrk.xy;
  vec3 g1 = texture2D(map, vMapUv).rgb;
  vec3 g2 = texture2D(map, vec2(tp.x * 0.86 - tp.y * 0.2, tp.y * 0.86 + tp.x * 0.2) / 2.9 + 0.4).rgb;
  vec4 nA = mzN(tp / 9.0);
  vec4 nB = mzN(tp / 41.0);
  vec3 col = mix(g1, g2, smoothstep(0.38, 0.62, nA.r));
  col *= 0.82 + 0.36 * nB.r;
  col = mix(col, col * vec3(1.08, 1.0, 0.88), smoothstep(0.45, 0.8, nB.g) * 0.5);
  // raked along the track: faint ridges, lost where it has been driven through
  col *= 1.0 + 0.05 * sin(tp.x * 14.0 + 3.0 * nA.b) * (1.0 - smoothstep(0.02, 0.07, fwidth(tp.x))) * smoothstep(0.3, 0.6, nA.g);
  mzRough = 0.93;
  float wet = uWetness;
  col *= 1.0 - 0.45 * wet;
  mzRough = mix(mzRough, 0.5, wet * 0.7);
  col = mix(col, vec3(0.78, 0.8, 0.84), uSnowCover * smoothstep(0.2, 0.6, nA.r + uSnowCover * 0.6));
  diffuseColor.rgb = col;
}
`,
  );
  return m;
}

/** cast concrete (the pit-straight wall, the stands' structure): the photo, streaked by rain from the top */
export function concreteMaterial(a: MonzaAssets): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: a.concrete, normalMap: a.concreteN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
  patch(
    m,
    'mz-concrete-2',
    a,
    /* glsl */ `
{
  vec3 c = texture2D(map, vMapUv).rgb;
  vec4 n = mzN(vec2(vTrk.y * 0.11, vTrk.x * 0.35));
  c *= 0.8 + 0.3 * mzN(vTrk.yx / 19.0).r;
  // runs of dirt down the face from the coping
  c *= 1.0 - 0.32 * smoothstep(0.5, 0.8, n.g) * smoothstep(0.0, 0.9, vTrk.x);
  mzRough = 0.88;
  c *= 1.0 - 0.3 * uWetness;
  diffuseColor.rgb = c;
}
`,
  );
  return m;
}

/** galvanised guard rail and its posts: dull zinc, a little weathered */
export function steelMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.21, 0.22), roughness: 0.58, metalness: 0.45, side: THREE.DoubleSide });
}

/** painted steelwork (gantries, stand frames, fence posts) */
export function paintedSteel(color: THREE.ColorRepresentation, rough = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.3 });
}

/** the debris fence: chain-link you see through (blended, so far off it is a faint veil, not a noise) */
export function fenceMaterial(a: MonzaAssets): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: a.fence, transparent: true, opacity: 0.85, alphaTest: 0.02, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6 });
}

/**
 * Tyre barriers: four tyres high, bolted in columns, drawn as a picture of their faces (the dark
 * mouth of each tyre, the lit tread, the gaps between columns) on a face that leans with the stack.
 */
export function tyreWallMaterial(): THREE.MeshStandardMaterial {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#060607';
  g.fillRect(0, 0, 256, 256);
  // 4 columns across (each 0.62 m), 4 tyres up (each 0.25 m)
  for (let cx = 0; cx < 4; cx++) {
    for (let cy = 0; cy < 4; cy++) {
      const x = cx * 64 + 3, y = cy * 64 + 3, w = 58, h = 58;
      const gr = g.createLinearGradient(x, y, x, y + h);
      gr.addColorStop(0, '#34353a');
      gr.addColorStop(0.3, '#1d1e21');
      gr.addColorStop(1, '#0c0c0e');
      g.fillStyle = gr;
      g.beginPath();
      g.roundRect(x, y, w, h, 14);
      g.fill();
      // tread blocks catching the light
      g.strokeStyle = 'rgba(70,72,78,0.55)';
      g.lineWidth = 1.5;
      for (let k = 0; k < 9; k++) {
        g.beginPath();
        g.moveTo(x + 6 + k * 6, y + 6);
        g.lineTo(x + 3 + k * 6, y + 20);
        g.stroke();
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
}
