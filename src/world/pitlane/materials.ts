import * as THREE from 'three';
import { weatherUniforms } from '../weatherUniforms.ts';

/**
 * Pit complex materials. All are MeshStandardMaterial + small onBeforeCompile
 * patches so lights, shadows, the sky env map and the aerial fog behave like
 * every other PBR surface. Each reads the shared weather uniforms.
 */

/** shared uniforms (values filled by PitComplex) */
export const pitU = {
  uNoise: { value: null as THREE.Texture | null },
  /** world position of (s = mid, lateral 0) */
  uOrig: { value: new THREE.Vector3() },
  /** horizontal tangent (x,z) and pit-side right (x,z) of the straight at mid */
  uT: { value: new THREE.Vector2(0, 1) },
  uR: { value: new THREE.Vector2(1, 0) },
  /** s of the straight at uOrig */
  uMid: { value: 540 },
  /** first box s, box spacing, box lateral, fast lane lateral */
  uBox: { value: new THREE.Vector4(459, 18, 19.1, 13.7) },
  /** team garages s0, s1, garage front l, garage ceiling height */
  uGar: { value: new THREE.Vector4(450, 630, 25.3, 4.6) },
  /** pit lane s range (lines/rubber), limiter start/end */
  uLane: { value: new THREE.Vector4(120, 960, 270, 810) },
  /** overhead cover: podium s0, s1, podium tip l, building s0 / s1 packed in uCover2 */
  uCover: { value: new THREE.Vector4(576, 604, 7, 25.3) },
  uCover2: { value: new THREE.Vector2(300, 798) },
  uTime: { value: 0 },
};

const W = weatherUniforms;

const COMMON = /* glsl */ `
float pcHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 pcSL(vec3 wp) {
  vec2 d = wp.xz - uOrig.xz;
  return vec2(uMid + dot(d, uT), dot(d, uR));
}
// expanding raindrop rings → xz slope
vec2 pcRipples(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p * (k == 0 ? 2.3 : 3.7) + float(k) * 17.1;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float h = pcHash(cell + float(k) * 3.1);
    vec2 c = (vec2(pcHash(cell + 1.7), pcHash(cell + 5.3)) - 0.5) * 0.5;
    float ph = fract(t * (0.8 + 0.4 * h) + h);
    vec2 dv = f - c;
    float r = length(dv);
    float rr = ph * 0.45;
    float ring = sin((r - rr) * 55.0) * exp(-abs(r - rr) * 22.0) * (1.0 - ph);
    acc += dv / max(r, 1e-3) * ring;
  }
  return acc;
}
`;

const UNI_DECL = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uOrig;
uniform vec2 uT;
uniform vec2 uR;
uniform float uMid;
uniform vec4 uBox;
uniform vec4 uGar;
uniform vec4 uLane;
uniform vec4 uCover;
uniform vec2 uCover2;
uniform float uTime;
uniform float uWetness;
uniform float uRain;
uniform float uWeatherTime;
uniform float uLightning;
`;

function bindUniforms(sh: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(sh.uniforms, pitU, {
    uWetness: W.uWetness,
    uRain: W.uRain,
    uWeatherTime: W.uWeatherTime,
    uLightning: W.uLightning,
  });
}

// ------------------------------------------------------------------ solid + print

/**
 * vertex colours + per-vertex (roughness, metalness, emissive gain, rain exposure).
 * `textured` multiplies an atlas map in.
 */
export function solidMaterial(map?: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, map: map ?? null });
  m.onBeforeCompile = (sh) => {
    bindUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aPbr;\nvarying vec4 vPbr;\nvarying vec3 vWP;\nvarying vec3 vWN;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvPbr = aPbr;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * normal);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNI_DECL}\nvarying vec4 vPbr;\nvarying vec3 vWP;\nvarying vec3 vWN;\n${COMMON}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
  roughnessFactor = vPbr.x;
  metalnessFactor = vPbr.y;
  vec3 pcBase = diffuseColor.rgb;
  {
    float wet = uWetness * vPbr.w;
    float up = smoothstep(0.35, 0.95, vWN.y);
    float streak = (1.0 - up) * (0.55 + 0.45 * texture2D(uNoise, vec2(dot(vWP.xz, vec2(0.7, 0.7)) * 0.35, vWP.y * 0.04 - uWeatherTime * 0.02)).g);
    float w = wet * mix(streak * 0.8, 1.0, up);
    diffuseColor.rgb *= 1.0 - 0.38 * w * (1.0 - metalnessFactor);
    roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.18 + 0.2 * (1.0 - up)), clamp(w * 1.2, 0.0, 1.0));
  }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  totalEmissiveRadiance += pcBase * vPbr.z;
  // indoor fill from the ceiling lights (brighter on surfaces facing up)
  totalEmissiveRadiance += pcBase * (1.0 - step(0.02, vPbr.w)) * (0.16 + 0.2 * max(vWN.y, 0.0));`,
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
  {
    // indoor surfaces (no rain exposure) see little of the sky
    float indoor = 1.0 - step(0.02, vPbr.w);
    reflectedLight.indirectDiffuse *= mix(1.0, 0.35, indoor);
    reflectedLight.indirectSpecular *= mix(1.0, 0.25, indoor);
  }`,
      );
  };
  m.customProgramCacheKey = () => (map ? 'pit-print-v3' : 'pit-solid-v3');
  return m;
}

// ------------------------------------------------------------------ glass with interior mapping

/**
 * Curtain-wall glass. Per vertex: aGl = (along-facade metres, floor y, ceiling y, room depth).
 * The interior is ray-cast in the shader (ceiling light grid, back wall, floor),
 * so rooms show parallax and glow from outside; the exterior reflects the sky.
 */
export function glassMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x2c3a44, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.25 });
  m.onBeforeCompile = (sh) => {
    bindUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aGl;\nvarying vec4 vGl;\nvarying vec3 vWP;\nvarying vec3 vWN;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGl = aGl;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNI_DECL}\nvarying vec4 vGl;\nvarying vec3 vWP;\nvarying vec3 vWN;\n${COMMON}`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  {
    vec3 V = normalize(vWP - cameraPosition);
    vec3 N = normalize(vWN);
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
    float into = max(dot(V, -N), 0.05);
    float along0 = vGl.x;
    float D = vGl.w;
    vec3 inner = vec3(0.0);
    // distance along the ray to the back wall, ceiling, floor
    float tBack = D / into;
    float tCeil = V.y > 1e-3 ? (vGl.z - vWP.y) / V.y : 1e9;
    float tFloor = V.y < -1e-3 ? (vGl.y - vWP.y) / V.y : 1e9;
    float t = min(tBack, min(tCeil, tFloor));
    vec3 hit = V * t;
    float a = along0 + dot(hit, T);
    float dep = dot(hit, -N);
    float room = floor(a / 7.5);
    float lit = step(0.18, pcHash(vec2(room, vGl.y * 1.7)));
    float warm = pcHash(vec2(room * 1.3, vGl.z));
    vec3 lamp = mix(vec3(1.0, 0.86, 0.66), vec3(0.85, 0.93, 1.0), step(0.55, warm));
    if (t == tCeil) {
      vec2 g = vec2(fract(a / 3.0), fract(dep / 3.2));
      float panel = step(0.3, g.x) * step(g.x, 0.7) * step(0.4, g.y) * step(g.y, 0.6);
      inner = lamp * (0.06 + panel * 1.3) * lit;
    } else if (t == tFloor) {
      inner = lamp * 0.09 * lit * (0.6 + 0.4 * pcHash(floor(vec2(a, dep) * 1.2)));
    } else {
      float h = (vWP.y + hit.y - vGl.y) / max(vGl.z - vGl.y, 0.1);
      inner = lamp * lit * (0.1 + 0.08 * step(0.35, h) * step(h, 0.7) * step(0.5, pcHash(floor(vec2(a * 0.8, 3.0)))));
    }
    // blinds on a few rooms, darker lower edge
    float blind = step(0.8, pcHash(vec2(room, 7.0 + vGl.y)));
    inner *= mix(1.0, 0.25, blind);
    float fres = pow(1.0 - clamp(dot(-V, N), 0.0, 1.0), 4.0);
    totalEmissiveRadiance += inner * (1.0 - fres) * 0.9;
  }`,
      );
  };
  m.customProgramCacheKey = () => 'pit-glass-v1';
  return m;
}

// ------------------------------------------------------------------ ground

export const Z = { LANE: 0, VERGE: 1, APRON: 2, EPOXY: 3, PADDOCK: 4, GRASS: 5, CONCRETE: 6, WORK: 7 } as const;

/** ground: vertex colour = base albedo; aG = (s, l, zone, lift) */
export function groundMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    bindUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aG;\nvarying vec4 vG;\nvarying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvG = aG;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNI_DECL}\nvarying vec4 vG;\nvarying vec3 vWP;\n${COMMON}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
  vec2 pcSlope = vec2(0.0);
  vec3 pcGlow = vec3(0.0);
  float pcIndoor = 0.0;
  float pcCover = 0.0;
  {
    vec2 wp = vWP.xz;
    vec4 nA = texture2D(uNoise, wp * 0.43);
    vec4 nB = texture2D(uNoise, wp * 0.057);
    vec4 nC = texture2D(uNoise, wp * 0.0081);
    float zone = floor(vG.z + 0.5);
    float s = vG.x;
    float l = vG.y;
    vec3 col = diffuseColor.rgb;
    float rough = 0.85;
    float rub = 0.0;
    float indoor = 0.0;
    if (zone == 0.0 || zone == 1.0 || zone == 4.0 || zone == 7.0) {
      float spk = smoothstep(0.7, 0.92, texture2D(uNoise, wp * 2.9).r);
      col *= 0.8 + 0.32 * nA.r + 0.3 * (nB.g - 0.5) + 0.24 * (nC.b - 0.5);
      col += spk * vec3(0.022, 0.021, 0.02);
      rough = 0.8 + 0.12 * nA.r;
      pcSlope += (vec2(nA.r, nA.a) - 0.5) * 0.12;
      if (zone == 7.0) { rough = 0.62 + 0.1 * nA.r; col *= 0.94 + 0.12 * nB.a; }
      if ((zone == 0.0 || zone == 7.0) && s > uLane.x - 40.0 && s < uLane.y + 40.0) {
        // fast-lane tyre tracks
        float fast = uBox.w;
        float e0 = abs(abs(l - fast) - 0.8);
        rub += 0.28 * exp(-e0 * e0 / 0.05) * (0.5 + 0.9 * nB.g);
        rub += 0.08 * exp(-(l - fast) * (l - fast) / 1.5);
        // swerves into / out of every box, heavy launch marks leaving it
        float kf = clamp(floor((s - uBox.x) / uBox.y + 0.5), 0.0, 9.0);
        float d = s - (uBox.x + kf * uBox.y);
        if (d > -36.0 && d < 32.0) {
          float w = d < 0.0 ? smoothstep(-34.0, -8.0, d) : 1.0 - smoothstep(4.0, 30.0, d);
          float pl = fast + (uBox.z - fast) * w;
          float e = abs(abs(l - pl) - 0.8);
          float trk = exp(-e * e / 0.035);
          rub += trk * (0.25 + 0.4 * w) * (0.5 + 0.8 * nB.a);
          float launch = smoothstep(-2.6, -1.4, d) * (1.0 - smoothstep(1.0, 16.0, d));
          rub += 1.1 * launch * exp(-e * e / 0.02);
          // oil and fluids under the stopped car
          float under = smoothstep(2.4, 1.2, abs(d)) * smoothstep(1.3, 0.4, abs(l - uBox.z));
          col *= 1.0 - 0.45 * under * smoothstep(0.35, 0.75, nA.g);
        }
        rub = clamp(rub, 0.0, 1.0);
        col = mix(col, vec3(0.013, 0.013, 0.014), rub * 0.8);
        rough = mix(rough, 0.62, rub * 0.6);
      }
    } else if (zone == 2.0 || zone == 6.0) {
      // smooth painted concrete in slabs
      col *= 0.9 + 0.14 * nA.g + 0.12 * (nB.g - 0.5);
      float js = abs(fract(s / 4.5) - 0.5) * 4.5;
      float jl = abs(fract((l - 0.4) / 3.0) - 0.5) * 3.0;
      float joint = 1.0 - smoothstep(2.2, 2.235, max(js, 0.0) + 0.0) ;
      joint = max(1.0 - smoothstep(0.0, 0.025, 2.25 - js), zone == 6.0 ? 0.0 : 1.0 - smoothstep(0.0, 0.025, 1.5 - jl));
      col *= 1.0 - 0.4 * joint;
      rough = 0.55 + 0.2 * nA.r;
      // tyre scuffs in front of the garages
      col *= 1.0 - 0.18 * smoothstep(0.6, 0.85, nB.a) * step(zone, 2.5);
    } else if (zone == 3.0) {
      // polished epoxy garage floor
      col *= 0.96 + 0.08 * nB.g;
      rough = 0.16 + 0.1 * nA.r;
      indoor = 1.0;
      // mirror-like reflections of the ceiling light strips
      vec3 V = normalize(vWP - cameraPosition);
      vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
      float tc = (uGar.w - 0.02) / max(R.y, 0.02);
      vec2 hsl = pcSL(vWP + R * tc);
      float gi = floor((hsl.x - uGar.x) / 18.0);
      float gs = hsl.x - uGar.x - gi * 18.0;
      float inG = step(0.0, gi) * step(gi, 9.0) * step(1.2, gs) * step(gs, 16.8);
      float blur = 0.06 + tc * 0.03;
      float rows = 0.0;
      for (int i = 0; i < 4; i++) {
        float lr = uGar.z + 3.2 + float(i) * 4.1;
        rows += smoothstep(0.34 + blur, max(0.34 - blur, 0.0), abs(hsl.y - lr));
      }
      float fres = 0.06 + 0.5 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
      pcGlow += vec3(1.0, 0.97, 0.92) * rows * inG * 1.8 * fres * step(hsl.y, uGar.z + 17.0);
    } else if (zone == 5.0) {
      col *= 0.62 + 0.55 * nA.g + 0.35 * (nB.b - 0.5);
      col = mix(col, col * vec3(1.25, 1.08, 0.7), smoothstep(0.55, 0.8, nC.b) * 0.6);
      rough = 0.95;
      pcSlope += (vec2(nA.g, nA.r) - 0.5) * 0.25;
    }

    // ---------------- rain
    float wet = uWetness * (1.0 - indoor);
    float grass = zone == 5.0 ? 1.0 : 0.0;
    float pud = smoothstep(0.64 - 0.3 * wet, 0.82 - 0.26 * wet, nC.b * 0.55 + nB.g * 0.45 + 0.05 * (1.0 - rub)) * smoothstep(0.2, 0.65, wet) * (1.0 - grass);
    col *= mix(1.0, mix(0.52, 0.8, grass), clamp(wet * 1.4, 0.0, 1.0));
    col *= 1.0 - 0.25 * pud;
    rough = mix(rough, mix(0.34, 0.8, grass), smoothstep(0.0, 0.45, wet));
    rough = mix(rough, 0.035, pud);
    pcSlope *= 1.0 - smoothstep(0.1, 0.5, wet);
    float pcFar = 1.0 - smoothstep(0.015, 0.06, length(fwidth(wp)));
    if (uRain > 0.02 && wet > 0.05 && pcFar > 0.0) pcSlope += pcRipples(wp, uWeatherTime) * 0.16 * uRain * (0.2 + 0.8 * pud) * (1.0 - grass) * pcFar;

    // lit garages mirrored in the wet lane
    if (wet > 0.02 && (zone == 0.0 || zone == 2.0 || zone == 7.0)) {
      vec3 V = normalize(vWP - cameraPosition);
      vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
      vec2 rs = vec2(dot(R.xz, uT), dot(R.xz, uR));
      if (rs.y > 0.02) {
        float t = (uGar.z - l) / rs.y;
        float hy = R.y * t;
        float hs = s + rs.x * t;
        float inG = smoothstep(uGar.x - 1.0, uGar.x + 1.0, hs) * (1.0 - smoothstep(uGar.y - 1.0, uGar.y + 1.0, hs));
        float gj = abs(fract((hs - uGar.x) / 18.0) - 0.5) * 18.0;
        float door = smoothstep(0.1, 0.5, hy) * (1.0 - smoothstep(4.2, 4.8, hy)) * smoothstep(8.2, 7.7, gj);
        float fres = 0.04 + 0.96 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
        float blur = mix(0.12, 0.55, pud) / (1.0 + t * 0.08);
        pcGlow += vec3(0.85, 0.82, 0.76) * inG * door * fres * blur * 0.5 * wet;
        // the fascia lightboxes above
        float fas = smoothstep(4.75, 4.9, hy) * (1.0 - smoothstep(5.8, 5.95, hy)) * inG;
        pcGlow += vec3(0.7) * fas * fres * blur * wet * 0.35;
      }
    }
    diffuseColor.rgb = col;
    roughnessFactor = rough;
    pcIndoor = zone == 3.0 || zone == 6.0 ? 1.0 : 0.0;
    // under the podium deck and the first-floor terrace the sky is hidden
    float underPod = step(uCover.x, s) * step(s, uCover.y) * step(uCover.z, l) * step(l, uCover.w);
    float underTer = step(uCover2.x, s) * step(s, uCover2.y) * smoothstep(uCover.w - 2.6, uCover.w - 1.8, l);
    pcCover = max(underPod * 0.8, underTer * 0.6);
    pcGlow += col * 0.12 * pcIndoor;
  }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  normal = normalize(normal - (viewMatrix * vec4(pcSlope.x, 0.0, pcSlope.y, 0.0)).xyz);`,
      )
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n  totalEmissiveRadiance += pcGlow;`)
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= mix(1.0, 0.35, pcIndoor) * (1.0 - 0.45 * pcCover);
  reflectedLight.indirectSpecular *= mix(1.0, 0.2, pcIndoor) * (1.0 - 0.85 * pcCover);`,
      );
  };
  m.customProgramCacheKey = () => 'pit-ground-v3';
  return m;
}

// ------------------------------------------------------------------ paint decals

export function decalMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    roughness: 0.62,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  m.onBeforeCompile = (sh) => {
    bindUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aPbr;\nvarying vec4 vPbr;\nvarying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvPbr = aPbr;\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${UNI_DECL}\nvarying vec4 vPbr;\nvarying vec3 vWP;\n${COMMON}`)
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
  {
    vec4 nA = texture2D(uNoise, vWP.xz * 0.37);
    vec4 nB = texture2D(uNoise, vWP.xz * 0.05);
    // worn paint: rubbed off where cars run, speckled everywhere
    float wear = smoothstep(0.35, 0.8, nA.r * 0.6 + nB.g * 0.4) * vPbr.y;
    diffuseColor.a *= 1.0 - wear * 0.75;
    diffuseColor.rgb *= 0.86 + 0.18 * nA.g;
    float wet = uWetness * vPbr.w;
    diffuseColor.rgb *= 1.0 - 0.3 * wet;
    roughnessFactor = mix(vPbr.x, 0.12, smoothstep(0.0, 0.5, wet));
    metalnessFactor = 0.0;
  }`,
      );
  };
  m.customProgramCacheKey = () => 'pit-decal-v1';
  return m;
}

// ------------------------------------------------------------------ fence

export function fenceMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map,
    color: 0x9aa0a6,
    alphaTest: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.45,
    metalness: 0.75,
  });
  return m;
}

// ------------------------------------------------------------------ box / exit signal lamps

/**
 * Lamps whose state is driven per team: aSig = (slot, kind 0 red / 1 green / 2 amber).
 * uSig[slot] = 0 off, 1 red, 2 green.
 */
export const signalU = { uSig: { value: new Float32Array(12) } };

export function signalMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSig = signalU.uSig;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec2 aSig;\nuniform float uSig[12];\nvarying float vOn;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  {
    int slot = int(aSig.x + 0.5);
    float st = 0.0;
    for (int i = 0; i < 12; i++) if (i == slot) st = uSig[i];
    float kind = aSig.y;
    vOn = kind < 0.5 ? step(0.5, st) * step(st, 1.5) : kind < 1.5 ? step(1.5, st) : 0.0;
  }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vOn;`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb *= mix(0.006, 1.0, vOn);`);
  };
  m.customProgramCacheKey = () => 'pit-signal-v1';
  return m;
}
