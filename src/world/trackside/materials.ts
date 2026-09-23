import * as THREE from 'three';
import { ASPHALT_TILE, GRASS_TILE, GRAVEL_TILE, type GroundTextures } from './textures.ts';

/**
 * Trackside materials. All are MeshStandardMaterial with small onBeforeCompile
 * patches, so lighting, shadows, fog and the env map behave like every other
 * PBR surface in the game.
 *
 * Ground vertex layout (asphalt family):
 *   uv   = (lateral m, s·vScale m)
 *   aA0  = (racing-line lateral, rubber 0..1, skid 0..1, marbles 0..1)
 *   aA1  = (zone, zone-edge lateral |m|, paint flag, half width)
 *          zone: 0 road, 1 kerb, 2 verge, 3 tarmac runoff, 4 pit lane / plain tarmac, 5 pit apron
 */

export const Z_ROAD = 0;
export const Z_KERB = 1;
export const Z_VERGE = 2;
export const Z_RUNOFF = 3;
export const Z_PIT = 4;
export const Z_APRON = 5;

const COMMON = /* glsl */ `
float tsHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tsAA(float edge, float x) { float w = max(fwidth(x) * 0.7, 1e-4); return smoothstep(edge - w, edge + w, x); }
float tsBand(float x, float a, float b) { return tsAA(a, x) * (1.0 - tsAA(b, x)); }
// box-filtered square wave: fraction of [x-w/2, x+w/2] where fract(t) < duty
float tsSqI(float t, float duty) { return floor(t) * duty + min(fract(t), duty); }
float tsSquare(float x, float duty) {
  float w = max(fwidth(x), 1e-4);
  return (tsSqI(x + 0.5 * w, duty) - tsSqI(x - 0.5 * w, duty)) / w;
}
`;

const VERT_PARS = /* glsl */ `
attribute vec4 aA0;
attribute vec4 aA1;
varying vec2 vTrk;
varying vec4 vA0;
varying vec4 vA1;
`;
const VERT_MAIN = /* glsl */ `
vTrk = uv;
vA0 = aA0;
vA1 = aA1;
`;

const ASPHALT_FRAG = /* glsl */ `
float trkN = 1.0;
float trkU = vA1.x < 0.5 || (vA1.x > 2.5 && vA1.x < 4.5) ? 1.0 : 0.0; // metre-scale undulation (not on kerbs/paint)
{
  vec3 col = diffuseColor.rgb;
  float lumTex = clamp(dot(col, vec3(0.3, 0.59, 0.11)) / 0.052, 0.45, 2.2);
  float rough = roughnessFactor;
  float lat = vTrk.x;
  float sv = vTrk.y;
  float alat = abs(lat);
  float zone = vA1.x;
  float hw = vA1.w;
  vec4 mA = texture2D(uMacro, vTrk * (1.0 / 96.0));
  vec4 mB = texture2D(uMacro, vTrk * (1.0 / 24.0) + vec2(0.37, 0.61));
  float big = mA.r;
  float med = mB.b;
  float px = length(fwidth(vTrk));      // metres per pixel (for distance fades)

  if (zone < 0.5 || (zone > 3.5 && zone < 4.5)) {
    // ------------------------------------------------ racing asphalt
    col *= (0.82 + 0.34 * big + 0.16 * (med - 0.5)) * mix(vec3(1.025, 1.0, 0.965), vec3(0.975, 1.0, 1.035), mA.a);
    float edgeD = zone < 0.5 ? hw - alat : 99.0;
    // dust and lighter, unused asphalt toward the edges
    float dust = (1.0 - smoothstep(0.25, 2.8, edgeD)) * (0.5 + 0.5 * med);
    col = mix(col, col * 1.38 + vec3(0.009, 0.008, 0.006), dust * 0.75);
    rough = min(1.0, rough + dust * 0.05);

    // rubbered-in racing line: broad band + two tyre tracks
    float d = lat - vA0.x;
    float dd = d + (med - 0.5) * 0.7;
    float rub = vA0.y * (0.62 * exp(-dd * dd / 3.0) + 0.45 * exp(-pow((abs(dd) - 0.82) / 0.33, 2.0)));
    rub = clamp(rub, 0.0, 1.0);
    col = mix(col, vec3(0.018, 0.018, 0.02), rub * 0.72);
    rough = mix(rough, 0.66, rub * 0.5);

    // braking-zone lock-up marks
    if (vA0.z > 0.01) {
      float sk = 0.0;
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        float L = 13.0 + fk * 7.0;
        float cid = floor(sv / L);
        float h1 = tsHash(vec2(cid, fk * 17.0 + 1.0));
        float h2 = tsHash(vec2(cid + 3.1, fk * 5.0 + 2.0));
        float h3 = tsHash(vec2(cid + 7.7, fk * 9.0 + 3.0));
        float f = fract(sv / L);
        float len = 0.35 + 0.6 * h2;
        float st = h3 * (1.0 - len);
        float along = clamp((f - st) / len, 0.0, 1.0);
        float inSeg = step(st, f) * step(f, st + len);
        float off = (h1 - 0.5) * 2.4 + (along - 0.5) * (h2 - 0.5) * 0.9;
        float x = d - off;
        float tr = min(abs(x - 0.8), abs(x + 0.8));
        float w = 0.12 + 0.06 * h3 + px * 0.5;
        float m = 1.0 - smoothstep(w * 0.55, w, tr);
        float fade = smoothstep(0.0, 0.12, along) * (1.0 - smoothstep(0.65, 1.0, along));
        sk = max(sk, m * fade * inSeg * (0.45 + 0.55 * h1));
      }
      float brk = smoothstep(0.2, 0.6, texture2D(uMacro, vec2(lat * 0.4, sv * 0.05)).b);
      sk *= vA0.z * brk;
      col = mix(col, vec3(0.010, 0.010, 0.011), sk * 0.9);
      rough = mix(rough, 0.78, sk * 0.6);
    }

    // marbles and dust off-line near corner exits: a soft grey band that builds toward the edges
    if (vA0.w > 0.01) {
      float offl = smoothstep(2.4, 4.5, abs(d));
      float n1 = texture2D(uMacro, vTrk / 24.0 + vec2(0.21, 0.47)).b;
      float n2 = texture2D(uMacro, vTrk / 6.0 + vec2(0.63, 0.05)).b;
      float m = vA0.w * offl * (0.35 + 0.65 * smoothstep(0.3, 0.8, n1)) * (0.75 + 0.25 * n2);
      m *= 0.6 + 0.4 * (1.0 - smoothstep(0.0, 4.0, edgeD));
      col = mix(col, col * 1.35 + vec3(0.012, 0.011, 0.009), m * 0.55);
      rough = mix(rough, 0.97, m * 0.8);
      float pel = step(0.9, tsHash(floor(vTrk * 26.0))) * (1.0 - smoothstep(0.015, 0.04, px));
      col = mix(col, vec3(0.012), pel * m * 0.8);
    }

    // sealed cracks (tar), only in some areas
    float crack = texture2D(uMacro, vTrk / 32.0 + vec2(0.13, 0.0)).g;
    crack *= smoothstep(0.68, 0.8, texture2D(uMacro, vTrk / 96.0 + vec2(0.5, 0.25)).r) * (1.0 - smoothstep(0.02, 0.06, px));
    col = mix(col, vec3(0.012, 0.012, 0.013), crack * 0.8);
    rough = mix(rough, 0.62, crack);
    trkN = mix(trkN, 0.3, crack);

    // longitudinal paving joint slightly off-centre (very faint)
    float jn = 1.0 - tsAA(0.035 + px * 0.5, abs(lat - 1.9));
    col = mix(col, col * 0.7, jn * 0.5 * (zone < 0.5 ? 1.0 : 0.0));

    // repair patches
    {
      float cid = floor(sv / 48.0);
      float h = tsHash(vec2(cid, 91.0));
      if (h < 0.24 && zone < 0.5) {
        float h2 = tsHash(vec2(cid, 13.0)), h3 = tsHash(vec2(cid, 29.0)), h4 = tsHash(vec2(cid, 47.0));
        float len = 3.0 + 12.0 * h2;
        float w = 1.6 + 3.8 * h4;
        vec2 c = vec2(-hw + 0.8 + w * 0.5 + (2.0 * hw - 1.6 - w) * tsHash(vec2(cid, 71.0)), cid * 48.0 + 4.0 + len * 0.5 + h3 * (40.0 - len));
        vec2 q = abs(vec2(lat, sv) - c) - vec2(w, len) * 0.5;
        float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
        float inside = 1.0 - tsAA(0.0, sd);
        float seam = (1.0 - smoothstep(0.012, 0.03 + px, abs(sd))) * (1.0 - smoothstep(0.03, 0.08, px));
        col = mix(col, col * mix(vec3(0.8, 0.8, 0.82), vec3(1.12, 1.1, 1.06), step(0.5, h4)), inside);
        rough = mix(rough, rough * 0.95, inside);
        col = mix(col, col * 0.45, seam * 0.6);
      }
    }

    if (zone > 3.5 && vA1.z > 1.5) {
      // pit lane: inner line, fast/working lane divider, outer line (analytic → crisp at any distance)
      float pl = tsBand(alat, uPit.x - 0.075, uPit.x + 0.075) + tsBand(alat, uPit.y - 0.075, uPit.y + 0.075) + tsBand(alat, uPit.z - 0.075, uPit.z + 0.075);
      pl *= step(uPitS.x, sv) * step(sv, uPitS.y);
      col = mix(col, vec3(0.62, 0.62, 0.6) * (0.85 + 0.15 * lumTex), clamp(pl, 0.0, 1.0));
      rough = mix(rough, 0.5, clamp(pl, 0.0, 1.0));
    }
    if (zone < 0.5) {
      // white edge line (track limit) on the last 0.2 m of the road
      float line = tsAA(hw - 0.2, alat);
      vec3 paint = vec3(0.66, 0.66, 0.64) * (0.8 + 0.25 * med) * (0.85 + 0.15 * lumTex);
      col = mix(col, paint, line);
      rough = mix(rough, 0.48, line);
      trkN = mix(trkN, 0.35, line);
    }
  } else if (zone < 1.5) {
    // ------------------------------------------------ kerb: red/white 1.2 m blocks
    float red = tsSquare(sv / 2.4, 0.5);
    vec3 cr = vec3(0.47, 0.016, 0.014);
    vec3 cw = vec3(0.70, 0.70, 0.68);
    vec3 paint = mix(cw, cr, red);
    float kd = (alat - hw) / max(0.3, vA1.y - hw);   // 0 at the road edge … 1 outside
    float grime = (0.4 + 0.6 * med) * (0.15 + 0.55 * (1.0 - smoothstep(0.0, 0.7, kd)));
    float rubberMarks = smoothstep(0.45, 0.8, texture2D(uMacro, vec2(lat * 0.35, sv * 0.02)).b) * (1.0 - smoothstep(0.1, 0.8, kd));
    paint = mix(paint, vec3(0.025), clamp(grime * 0.35 + rubberMarks * 0.5, 0.0, 0.8));
    col = paint * (0.82 + 0.18 * lumTex);
    rough = 0.5 + 0.2 * grime;
    trkN = 0.3;
  } else if (zone < 2.5) {
    // ------------------------------------------------ verge: green paint with a blue stripe
    float d = alat - vA1.y;
    if (vA1.z > 0.5) {
      vec3 green = vec3(0.028, 0.09, 0.036);
      vec3 blue = vec3(0.028, 0.055, 0.17);
      float stripe = tsBand(d, 1.12, 1.36) * step(vA1.z, 1.5);
      vec3 paint = mix(green, blue, stripe) * (0.8 + 0.3 * med) * (0.85 + 0.15 * lumTex);
      float worn = smoothstep(0.62, 0.9, med) * 0.35;
      col = mix(paint, col * 1.2, worn);
      rough = 0.72;
      trkN = 0.55;
    } else {
      col *= 1.15 + 0.3 * big;
      rough = min(1.0, rough + 0.03);
    }
  } else if (zone < 3.5) {
    // ------------------------------------------------ tarmac run-off: older, lighter, painted bands
    col *= (1.28 + 0.34 * big + 0.2 * (med - 0.5)) * mix(vec3(1.02, 1.0, 0.97), vec3(0.98, 1.0, 1.02), mA.a);
    rough = min(1.0, rough + 0.03);
    // tyre tracks from cars running wide: shallow arcs out from the edge and back
    {
      float dIn = alat - vA1.y;
      float tt = 0.0;
      for (int k = 0; k < 2; k++) {
        float fk = float(k);
        float L = 34.0 + fk * 22.0;
        float cid = floor(sv / L);
        float h1 = tsHash(vec2(cid, 31.0 + fk * 7.0));
        float f = fract(sv / L);
        float reach = 1.5 + 9.0 * tsHash(vec2(cid, 43.0 + fk));
        float path = sin(3.14159 * f) * reach - 0.8;
        float g = min(abs(dIn - path - 0.8), abs(dIn - path + 0.8));
        tt = max(tt, (1.0 - smoothstep(0.1, 0.22 + px, g)) * step(h1, 0.55) * (0.5 + 0.5 * sin(3.14159 * f)));
      }
      col = mix(col, col * 0.55, tt * 0.55);
    }
    if (vA1.z > 0.5) {
      float d = alat - vA1.y;
      float bA = 0.0;
      float gap = tsBand(d, 0.0, 0.14);
      float bB = tsBand(d, 0.14, 2.4);
      vec3 cA = vec3(0.0);
      vec3 cB = vec3(0.026, 0.06, 0.16);
      vec3 cW = vec3(0.46, 0.46, 0.44);
      vec3 paint = cA * bA + cW * gap + cB * bB;
      float amt = (bA + gap + bB) * (0.78 + 0.22 * med);
      col = mix(col, paint * (0.8 + 0.2 * lumTex), amt);
      rough = mix(rough, 0.68, amt);
      trkN = mix(1.0, 0.55, amt);
    }
  } else {
    // ------------------------------------------------ pit apron: smooth grey concrete slabs
    col = vec3(0.19, 0.19, 0.185) * (0.86 + 0.22 * med + 0.1 * big) * (0.9 + 0.1 * lumTex);
    float jx = abs(fract(lat / 5.0 + 0.5) - 0.5) * 5.0;
    float jy = abs(fract(sv / 6.0 + 0.5) - 0.5) * 6.0;
    float joint = 1.0 - tsAA(0.02 + px * 0.5, min(jx, jy));
    col = mix(col, vec3(0.04), joint * 0.7);
    rough = 0.8;
    trkN = 0.3;
  }
  diffuseColor.rgb = col;
  roughnessFactor = clamp(rough, 0.04, 1.0);
}
`;

function patchGround(m: THREE.MeshStandardMaterial, key: string, macro: THREE.Texture, fragMain: string, after = '#include <metalnessmap_fragment>', extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: macro };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n' + VERT_MAIN);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uMacro;\nvarying vec2 vTrk;\nvarying vec4 vA0;\nvarying vec4 vA1;\n' + COMMON)
      .replace(after, after + '\n' + fragMain);
    extra?.(sh);
  };
  m.customProgramCacheKey = () => key;
}

export const pitUniforms = {
  uPit: { value: new THREE.Vector3(-10, -10, -10) },
  uPitS: { value: new THREE.Vector2(0, 0) },
};

export function asphaltMaterial(t: GroundTextures): THREE.MeshStandardMaterial {
  const rep = 1 / ASPHALT_TILE;
  for (const tex of [t.asphaltAlbedo, t.asphaltNormal, t.asphaltRough]) tex.repeat.set(rep, rep);
  const m = new THREE.MeshStandardMaterial({
    map: t.asphaltAlbedo,
    normalMap: t.asphaltNormal,
    roughnessMap: t.asphaltRough,
    normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 1,
    metalness: 0,
  });
  patchGround(m, 'apex-ts-asphalt-2', t.macro, ASPHALT_FRAG, '#include <metalnessmap_fragment>', (sh) => {
    sh.uniforms.uPit = pitUniforms.uPit;
    sh.uniforms.uPitS = pitUniforms.uPitS;
    sh.fragmentShader = sh.fragmentShader
      .replace('uniform sampler2D uMacro;', 'uniform sampler2D uMacro;\nuniform vec3 uPit;\nuniform vec2 uPitS;')
      .replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * trkN;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (trkU > 0.5) {
          // gentle metre-scale unevenness so reflections of the sky ripple like real tarmac
          float h0 = texture2D(uMacro, vTrk / 12.0).b;
          float hx = texture2D(uMacro, (vTrk + vec2(0.35, 0.0)) / 12.0).b;
          float hy = texture2D(uMacro, (vTrk + vec2(0.0, 0.35)) / 12.0).b;
          vec2 g = vec2(hx - h0, hy - h0) * 0.14;
          normal = normalize(normal - normalize(tbn[0]) * g.x - normalize(tbn[1]) * g.y);
        }`,
      );
  });
  return m;
}

const GRAVEL_FRAG = /* glsl */ `
float gRake = 0.0;
{
  vec3 col = diffuseColor.rgb;
  vec4 mA = texture2D(uMacro, vTrk * (1.0 / 96.0));
  vec4 mB = texture2D(uMacro, vTrk * (1.0 / 24.0) + vec2(0.11, 0.73));
  col *= (0.78 + 0.4 * mA.r + 0.22 * (mB.b - 0.5)) * mix(vec3(1.04, 1.0, 0.93), vec3(0.96, 1.0, 1.05), mA.a);
  // jagged edge toward the grass (vA1.y = metres to the gravel's outer edge)
  float n = texture2D(uMacro, vTrk / 6.0 + vec2(0.3, 0.1)).b;
  if (vA1.y < n * 0.9 - 0.1) discard;
  // thinner, darker gravel near the edges and where it was thrown onto the verge
  float thin = 1.0 - smoothstep(0.0, 0.6, vA1.y);
  col = mix(col, col * vec3(0.55, 0.6, 0.45), thin * 0.5);
  // rake ridges parallel to the track
  float rk = vTrk.x * 6.2831 / 0.42 + 2.5 * mB.b;
  float px = length(fwidth(vTrk));
  float rakeAmt = (1.0 - smoothstep(0.03, 0.09, px)) * (0.5 + 0.5 * mA.r);
  gRake = cos(rk) * rakeAmt;
  col *= 1.0 + 0.16 * sin(rk) * rakeAmt;
  // furrows where cars ran wide into the bed (vA1.x = metres from the inner edge)
  {
    float cid = floor(vTrk.y / 40.0);
    float h = tsHash(vec2(cid, 5.0));
    if (h < 0.4) {
      float f = fract(vTrk.y / 40.0);
      float path = (f - 0.15 - 0.3 * h) * 40.0 * (0.18 + 0.2 * tsHash(vec2(cid, 9.0)));
      float along = step(0.0, path) * (1.0 - smoothstep(6.0, 14.0, path));
      float g = min(abs(vA1.x - path - 0.8), abs(vA1.x - path + 0.8));
      float fur = (1.0 - smoothstep(0.12, 0.3 + px, g)) * along;
      col = mix(col, col * vec3(0.62, 0.6, 0.58), fur * 0.8);
      gRake *= 1.0 - fur;
    }
  }
  diffuseColor.rgb = col * 0.82;
  roughnessFactor = 0.93;
}
`;

export function gravelMaterial(t: GroundTextures): THREE.MeshStandardMaterial {
  t.gravelAlbedo.repeat.set(1 / GRAVEL_TILE, 1 / GRAVEL_TILE);
  t.gravelNormal.repeat.set(1 / GRAVEL_TILE, 1 / GRAVEL_TILE);
  const m = new THREE.MeshStandardMaterial({
    map: t.gravelAlbedo,
    normalMap: t.gravelNormal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughness: 0.93,
    metalness: 0,
    // gravel overlaps the grass under its jagged outer edge: keep it on top at any distance
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  patchGround(m, 'apex-ts-gravel-1', t.macro, GRAVEL_FRAG, '#include <metalnessmap_fragment>', (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\nnormal = normalize(normal + normalize(tbn[0]) * gRake * 0.45);',
    );
  });
  return m;
}

const GRASS_FRAG = /* glsl */ `
float gStripe = 0.0;
{
  vec3 col = diffuseColor.rgb;
  vec4 mA = texture2D(uMacro, vTrk * (1.0 / 96.0) + vec2(0.3, 0.8));
  vec4 mB = texture2D(uMacro, vTrk * (1.0 / 24.0) + vec2(0.61, 0.17));
  float clump = texture2D(uMacro, vTrk / 6.0 + vec2(0.7, 0.2)).b;
  col *= (0.78 + 0.42 * mA.r) * (0.8 + 0.4 * clump);
  col = mix(vec3(dot(col, vec3(0.3, 0.59, 0.11))), col, 0.8) * vec3(1.05, 1.0, 0.88);
  // drier, yellower patches
  float dry = smoothstep(0.55, 0.85, mB.b) * 0.6 + smoothstep(0.6, 0.9, mA.a) * 0.4;
  col = mix(col, col * vec3(1.45, 1.2, 0.62), dry * 0.55);
  // worn / muddy strip right next to a hard edge (vA1.y = metres from the inner edge)
  float wear = 1.0 - smoothstep(0.0, 0.5 + 0.6 * mB.b, vA1.y);
  col = mix(col, vec3(0.06, 0.05, 0.035), wear * 0.55);
  // mown stripes (diagonal bands), sign flips per band
  gStripe = tsSquare((vTrk.y + vTrk.x * 0.55) / 12.0, 0.5) * 2.0 - 1.0;
  diffuseColor.rgb = col;
  roughnessFactor = 0.95;
}
`;

export function grassMaterial(t: GroundTextures): THREE.MeshStandardMaterial {
  t.grassAlbedo.repeat.set(1 / GRASS_TILE, 1 / GRASS_TILE);
  t.grassNormal.repeat.set(1 / GRASS_TILE, 1 / GRASS_TILE);
  const m = new THREE.MeshStandardMaterial({
    map: t.grassAlbedo,
    normalMap: t.grassNormal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 0.95,
    metalness: 0,
  });
  patchGround(m, 'apex-ts-grass-1', t.macro, GRASS_FRAG, '#include <metalnessmap_fragment>', (sh) => {
    // mown-stripe sheen: blades laid one way look lighter from one side, darker from the other
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      {
        vec3 V = normalize(vViewPosition);
        vec3 B = normalize(tbn[1]);
        float facing = dot(V, B);
        float sheen = gStripe * facing;
        diffuseColor.rgb *= 1.0 + 0.22 * sheen;
        diffuseColor.rgb += vec3(0.006, 0.01, 0.004) * max(0.0, 1.0 - dot(V, nonPerturbedNormal)) ;
      }`,
    );
  });
  return m;
}

// ------------------------------------------------------------------ vertex-PBR props

function patchPBR(m: THREE.MeshStandardMaterial, key: string) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aPBR;\nvarying vec3 vPBR;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPBR = aPBR;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPBR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nroughnessFactor = vPBR.x;\nmetalnessFactor = vPBR.y;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vPBR.z;');
  };
  m.customProgramCacheKey = () => key;
}

/** Untextured props: vertex colour + per-vertex roughness/metalness/emissive. */
export function propsMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
  patchPBR(m, 'apex-ts-props-1');
  return m;
}

/** Printed surfaces: atlas map × vertex colour, per-vertex PBR. */
export function printMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.6, metalness: 0 });
  patchPBR(m, 'apex-ts-print-1');
  return m;
}

/** Painted road markings: blended over the road in the opaque pass (drawn after it, before cars' transparents). */
export function decalMaterial(atlas: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: atlas,
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    transparent: false,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  patchPBR(m, 'apex-ts-decal-2');
  return m;
}

export function fenceMaterial(tex: THREE.Texture): THREE.MeshStandardMaterial {
  tex.repeat.set(1, 1);
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.55,
    metalness: 0.35,
    alphaTest: 0.01,
  });
  // one pass is enough for a thin mesh (saves a draw per chunk)
  m.forceSinglePass = true;
  // thin wires all but vanish with distance: thin the mip-averaged coverage so fences read as a light veil
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n  diffuseColor.a *= mix(1.0, 0.4, smoothstep(6.0, 45.0, length(vViewPosition)));',
    );
  };
  m.customProgramCacheKey = () => 'apex-ts-fence-2';
  return m;
}

/** Start-light lamps: `aA0.x` holds the column (0..4, or 9 for never-lit lamps). */
export function lampMaterial(): { material: THREE.MeshStandardMaterial; lit: { value: number } } {
  const lit = { value: 0 };
  const m = new THREE.MeshStandardMaterial({ color: 0x2a0303, emissive: 0xff1208, emissiveIntensity: 1, roughness: 0.25, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLit = lit;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aA0;\nvarying float vCol;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvCol = aA0.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uLit;\nvarying float vCol;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= step(vCol + 0.5, uLit) * 38.0;');
  };
  m.customProgramCacheKey = () => 'apex-ts-lamp-1';
  return { material: m, lit };
}
