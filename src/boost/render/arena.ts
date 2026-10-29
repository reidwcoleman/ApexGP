import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ARENA, CORNER_R, GOAL_BACK_R, GOAL_EDGE_R, GOAL_POST_R, goalSurfaces, GOAL_TOP_R, octCore, PADS, type TriMesh } from '../sim/arena.ts';
import { MAPS, TIMES, type MapId, type MapLook, type TimeLook } from './looks.ts';
import { buildSurround, type SurroundView } from './surround.ts';
import { buildSpectacle, type Spectacle } from './spectacle.ts';

/**
 * The stadium, authored in the simulation's own frame (cm, z up) under one root group that turns it
 * into three's metres / y-up. The pitch (mown stripes, painted lines, team halves) and the shell (the
 * rounded ramps and the glass walls with their hex panels, cut away at the goal mouths) are built from
 * the same shape as the collision distance field. Then the goals and their nets, the boost pads, the
 * stands and the crowd, the light rings, the LED boards and the two screens.
 */

const R = ARENA.R;
const BLUE = new THREE.Color(0x1d6dff);
const ORANGE = new THREE.Color(0xff7417);

/** 1 by day, 0 at night: every arena shader reads it, so the switch costs no recompiles */
export const uDay = { value: 1 };
/** the arena's palette (see ArenaTheme), shared by every arena shader */
const TH = {
  uPitchA: { value: new THREE.Color() },
  uPitchB: { value: new THREE.Color() },
  uPattern: { value: 0 },
  uLine: { value: new THREE.Color() },
  uLineGlow: { value: 0 },
  uWall: { value: new THREE.Color() },
  uGlass: { value: new THREE.Color() },
  uSeat: { value: new THREE.Color() },
  uFrost: { value: 0 },
  uTrim: { value: new THREE.Color() },
  /** caustics thrown over the pitch from the waves above (the sea floor arena), and their clock */
  uCaus: { value: 0 },
  uClock: { value: 0 },
};
/** the goal housings' structure (coloured with the arena) */
const houseM = new THREE.MeshStandardMaterial({ color: 0x0c0e13, roughness: 0.75, metalness: 0.25 });
/** the ball (0) and up to 8 cars, in sim cm (w = 1 for the ball): the wall's hex panels light up around them */
export const uNear = { value: Array.from({ length: 9 }, () => new THREE.Vector4(0, 0, -9999, 0)) };

const GLSL_COMMON = /* glsl */ `
uniform float uDay;
uniform vec3 uPitchA, uPitchB, uLine, uWall, uGlass, uSeat, uTrim;
uniform float uPattern, uLineGlow, uFrost, uCaus, uClock;
float bbHash(vec2 p){ p = fract(p*vec2(233.34,851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }
float bbNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(bbHash(i), bbHash(i+vec2(1,0)), u.x), mix(bbHash(i+vec2(0,1)), bbHash(i+vec2(1,1)), u.x), u.y); }
// distance to the nearest edge of a hexagon grid cell (0 at the edges)
float bbHex(vec2 p){ p = abs(p); vec2 q = vec2(p.x*1.1547, p.y + p.x*0.57735);
  vec2 pi = floor(q), pf = fract(q); float v = mod(pi.x + pi.y, 3.0);
  float ca = step(1., v), cb = step(2., v); vec2 ma = step(pf.xy, pf.yx);
  float e = dot(ma, 1.0 - pf.yx + ca*(pf.x+pf.y-1.0) + cb*(pf.yx-2.0*pf.xy));
  return e; }
// a height's screen-space slope turned into a perturbed normal (three's bump mapping, inlined)
vec3 bbBump(vec3 sp, vec3 sn, vec2 dh, float fd){ vec3 sx = dFdx(sp), sy = dFdy(sp); vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
  float det = dot(sx, r1) * fd; vec3 g = sign(det) * (dh.x * r1 + dh.y * r2); return normalize(abs(det) * sn - g); }
float bbHexEdge(vec2 p){ vec2 s = vec2(1.0, 1.7320508); vec2 a = mod(p, s) - s*0.5; vec2 b = mod(p - s*0.5, s) - s*0.5;
  vec2 g = dot(a,a) < dot(b,b) ? a : b; g = abs(g); return 0.5 - max(dot(g, normalize(s)), g.x); }
// caustics: two drifting layers of a warped sine lattice, bright where the folds bunch up
float bbCaus(vec2 p, float t){ float c = 0.0;
  for (int k = 0; k < 2; k++){ float s = k == 0 ? 1.0 : -1.0;
    vec2 q = p * (k == 0 ? 1.0 : 1.37) + vec2(t * 0.21, -t * 0.17) * s;
    q += 0.6 * vec2(sin(q.y * 1.7 + t * 0.9), sin(q.x * 1.5 - t * 0.8));
    q += 0.35 * vec2(sin(q.y * 3.1 - t * 1.3), sin(q.x * 2.9 + t * 1.1));
    vec2 w = abs(sin(q * 1.9)); c += pow(1.0 - min(w.x, w.y), 7.0); }
  return c * 0.6; }
`;

/** shader hooks onto a standard material: vSim = the vertex in simulation coordinates */
function simPatch(mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial, frag: string, uniforms: Record<string, THREE.IUniform> = {}, decl = ''): void {
  // (every patch shares this closure's source, which is three's default program key)
  const key = 'bb' + hashStr(frag + decl);
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uDay }, TH);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSim;\nvarying vec2 vBB;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSim = position;\nvBB = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSim;\nvarying vec2 vBB;\n' + GLSL_COMMON + decl)
      .replace('#include <map_fragment>', frag)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bbEmit;')
      // (a patch that defines BB_NRM gives a height bbH, in metres, to relief the surface with)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n#ifdef BB_NRM\nnormal = bbBump(-vViewPosition, normal, vec2(dFdx(bbH), dFdy(bbH)), faceDirection);\n#endif');
  };
}

function hashStr(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

export interface ArenaView {
  root: THREE.Group;
  setDay(day: boolean): void;
  setLook(t: TimeLook, map: MapLook): void;
  /** 0 low … 2 high: how much grass grows */
  setQuality(q: number): void;
  update(t: number, pads: Float32Array, excite: number, score: [number, number], clock: string): void;
}

/** the shrunk octagon as a loop of (x, y, nx, ny) samples with fanned corners; len = arc length at the wall */
function perimeter(offset: number, step: number, fan = 4): { p: number[][]; len: number[] } {
  // the core octagon, its edges pushed out and its vertices fanned by CORNER_R − R
  const V = octCore();
  const rc = CORNER_R - R;
  fan = Math.max(fan, 8);
  const edgeN = (i: number) => {
    const a = V[i];
    const b = V[(i + 1) % V.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, L];
  };
  const pts: number[][] = [];
  for (let i = 0; i < V.length; i++) {
    const a = V[i];
    const b = V[(i + 1) % V.length];
    const [nx, ny, L] = edgeN(i);
    const [px, py] = edgeN((i + V.length - 1) % V.length);
    const a0 = Math.atan2(py, px);
    let d = Math.atan2(ny, nx) - a0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    for (let k = 1; k < fan; k++) {
      const c = Math.cos(a0 + (d * k) / fan);
      const sn = Math.sin(a0 + (d * k) / fan);
      pts.push([a[0] + c * rc, a[1] + sn * rc, c, sn]);
    }
    const n = Math.max(2, Math.ceil(L / step));
    for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n + nx * rc, a[1] + ((b[1] - a[1]) * k) / n + ny * rc, nx, ny]);
  }
  pts.push(pts[0]);
  const len = [0];
  for (let i = 1; i < pts.length; i++) {
    const o = R + offset;
    len.push(len[i - 1] + Math.hypot(pts[i][0] + pts[i][2] * o - pts[i - 1][0] - pts[i - 1][2] * o, pts[i][1] + pts[i][3] * o - pts[i - 1][1] - pts[i - 1][3] * o));
  }
  return { p: pts, len };
}

/** the rounded shell between two heights, sampled along the profile */
function shellGeometry(z0: number, z1: number): THREE.BufferGeometry {
  const { p: per, len } = perimeter(0, 220);
  const prof: [number, number][] = []; // (theta, zc)
  const Z = ARENA.Z;
  // bottom arc
  for (let k = 0; k <= 12; k++) prof.push([-Math.PI / 2 + (k / 12) * (Math.PI / 2), R]);
  for (let k = 1; k <= 10; k++) prof.push([0, R + ((Z - 2 * R) * k) / 10]);
  for (let k = 1; k <= 10; k++) prof.push([(k / 10) * (Math.PI / 2), Z - R]);
  const zOf = ([th, zc]: [number, number]) => zc + R * Math.sin(th);
  // clip the profile to [z0, z1] (insert the cut points)
  const rows: [number, number][] = [];
  for (let i = 0; i < prof.length; i++) {
    const z = zOf(prof[i]);
    if (z >= z0 - 1e-3 && z <= z1 + 1e-3) rows.push(prof[i]);
    if (i + 1 < prof.length) {
      const zn = zOf(prof[i + 1]);
      for (const zc of [z0, z1]) {
        if ((z < zc && zn > zc) || (z > zc && zn < zc)) {
          const t = (zc - z) / (zn - z);
          rows.push([prof[i][0] + (prof[i + 1][0] - prof[i][0]) * t, prof[i][1] + (prof[i + 1][1] - prof[i][1]) * t]);
        }
      }
    }
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  for (let j = 0; j < rows.length; j++) {
    const [th, zc] = rows[j];
    const c = Math.cos(th);
    const s = Math.sin(th);
    for (let i = 0; i < per.length; i++) {
      const [x, y, nx, ny] = per[i];
      pos.push(x + R * c * nx, y + R * c * ny, zc + R * s);
      nrm.push(-c * nx, -c * ny, -s);
      uv.push(len[i], zc + R * s);
    }
  }
  const idx: number[] = [];
  const W = per.length;
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < W - 1; i++) {
      const a = j * W + i;
      idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// (the mouth in the back wall: as wide and tall as the goal plus its rounded posts and crossbar, its
// top corners rounded; sim/arena.ts inMouth)
const GOAL_CUT = /* glsl */ `
  {
    vec2 gq = vec2(abs(vSim.x) - ${(ARENA.GOAL_W - GOAL_EDGE_R).toFixed(1)}, vSim.z - ${(ARENA.GOAL_H - GOAL_EDGE_R).toFixed(1)});
    if (abs(vSim.y) > ${(ARENA.Y - R - 25).toFixed(1)} && abs(vSim.x) < ${(ARENA.GOAL_W + GOAL_POST_R).toFixed(1)} && vSim.z < ${(ARENA.GOAL_H + GOAL_POST_R).toFixed(1)}
      && (gq.x <= 0.0 || gq.y <= 0.0 || length(gq) < ${(GOAL_EDGE_R + GOAL_POST_R).toFixed(1)})) discard;
  }
`;

/** a sim-frame triangle mesh as geometry with smooth normals */
function triGeo(m: TriMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.v, 3));
  g.setIndex(m.t);
  g.computeVertexNormals();
  return g;
}

function pitch(): THREE.Mesh {
  const g = new THREE.PlaneGeometry(ARENA.X * 2, (ARENA.Y + ARENA.GOAL_D) * 2, 8, 10);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  simPatch(
    mat,
    /* glsl */ `
    vec2 P = vSim.xy;
    // outside the octagon and not in a goal: nothing (the ramps cover the edge)
    float oct = max(max(abs(P.x) - ${ARENA.X.toFixed(1)}, abs(P.y) - ${ARENA.Y.toFixed(1)}), (abs(P.x)+abs(P.y) - ${ARENA.CORNER.toFixed(1)})*0.7071);
    bool inGoal = (abs(P.x) < ${ARENA.GOAL_W.toFixed(1)} && abs(P.y) < ${(ARENA.Y + ARENA.GOAL_D).toFixed(1)}) || (abs(P.x) < ${(ARENA.GOAL_W + GOAL_POST_R).toFixed(1)} && abs(P.y) < ${(ARENA.Y + GOAL_POST_R).toFixed(1)});
    if (oct > 0.0 && !inGoal) discard;
    float side = sign(P.y);
    vec3 team = side < 0.0 ? vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}) : vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)});
    // the turf, mown to the arena's pattern: bands, checks, diamonds or rings (or synthetic panels)
    float synth = step(3.5, uPattern);
    float fw = fwidth(P.y) + fwidth(P.x);
    float pw = 18.0 + fw;
    float band;
    if (uPattern < 0.5) band = smoothstep(-pw, pw, abs(fract(P.y / 1024.0 + 0.25) - 0.5) * 1024.0 - 256.0);
    else if (uPattern < 1.5) {
      vec2 c = abs(fract(P / 1024.0) - 0.5) * 1024.0 - 256.0;
      band = abs(smoothstep(-pw, pw, c.x) - smoothstep(-pw, pw, c.y));
    } else if (uPattern < 2.5) {
      vec2 d = vec2(P.x + P.y, P.x - P.y) * 0.7071;
      vec2 c = abs(fract(d / 1100.0) - 0.5) * 1100.0 - 275.0;
      band = abs(smoothstep(-pw, pw, c.x) - smoothstep(-pw, pw, c.y));
    } else if (uPattern < 3.5) band = smoothstep(-pw, pw, abs(fract(length(P) / 1000.0) - 0.5) * 1000.0 - 250.0);
    else band = 0.5 + 0.5 * step(0.5, fract(P.y / 2048.0));
    vec3 col = mix(uPitchA, uPitchB, band) * mix(0.85, 1.0, uDay);
    // the turf at every scale: broad patches, clumps, tufts and blades, each octave fading out
    // before it gets smaller than a pixel (so there's grain at every distance and no shimmer)
    float n = bbNoise(P * 0.0035) * 0.4 + bbNoise(P * 0.012) * 0.35 + bbNoise(P * 0.045) * 0.25;
    col *= mix(0.84 + 0.32 * n, 0.94 + 0.12 * n, synth);
    float o1 = (bbNoise(P * 0.21) - 0.5) * (1.0 - smoothstep(4.0, 10.0, fw));
    float o2 = (bbNoise(P * vec2(0.9, 0.7) + 17.0) - 0.5) * (1.0 - smoothstep(1.2, 3.0, fw));
    float o3 = (bbNoise(P * vec2(2.9, 2.2) + 41.0) - 0.5) * (1.0 - smoothstep(0.4, 1.0, fw));
    float blades = (o1 * 0.5 + o2 * 0.8 + o3) * (1.0 - synth);
    col *= 1.0 + blades * 0.28;
    // sunlit tips here and there
    float tip = smoothstep(0.8, 0.95, bbNoise(P * 1.7 + 5.0)) * (1.0 - smoothstep(1.0, 2.5, fw)) * (1.0 - synth);
    col = mix(col, col * vec3(1.22, 1.2, 0.86), tip * 0.5);
    // the blades' relief for the light (not on the goals' floors)
    float bbH = blades * 0.0035 * (1.0 - step(${ARENA.Y.toFixed(1)}, abs(P.y)) * step(abs(P.x), ${ARENA.GOAL_W.toFixed(1)}));
    #define BB_NRM
    // mown grass changes shade with the way you look along it (each stripe's blades lie the other way)
    vec3 camSim = vec3(cameraPosition.x * 100.0, -cameraPosition.z * 100.0, cameraPosition.y * 100.0);
    vec3 vd = normalize(vSim - camSim);
    float lean = uPattern < 0.5 || uPattern > 2.5 ? vd.y : (uPattern < 1.5 ? vd.x * 0.6 + vd.y * 0.6 : (vd.x + vd.y) * 0.7071);
    // (never cancelling the stripes out: they read from every end, just stronger along the cut)
    col *= 1.0 + 0.09 * abs(lean) * (band * 2.0 - 1.0) * (1.0 - synth);
    // each stripe its own faint shade, and a cooler, bluer cast on the dark ones
    float sid = floor(P.y / 512.0) + floor(P.x / 1024.0) * step(0.5, uPattern) * step(uPattern, 1.5);
    col *= 0.96 + 0.08 * bbHash(vec2(sid, 3.7)) * (1.0 - synth);
    col = mix(col, col * vec3(0.92, 1.0, 1.08), (1.0 - band) * 0.5 * (1.0 - synth));
    // the turf darkens where it runs up under the walls
    col *= mix(0.8, 1.0, smoothstep(0.0, 700.0, -(oct + ${R.toFixed(1)})));
    // synthetic turf: hex panels with lit seams
    float sHex = bbHexEdge(P / 300.0);
    float seamS = (1.0 - smoothstep(0.0, 0.025 + fw / 600.0, sHex)) * synth * (1.0 - smoothstep(4.0, 14.0, fw));
    col *= 1.0 - synth * 0.18 * (1.0 - smoothstep(0.0, 0.2, sHex));
    // frost: white round the edges, patchy, and a dusting all over
    float rim = smoothstep(-1000.0, -150.0, oct);
    float fn = bbNoise(P * 0.004) * 0.6 + bbNoise(P * 0.03) * 0.4;
    float frost = uFrost * clamp(rim * (0.2 + 1.1 * fn) + smoothstep(0.78, 0.95, fn) * 0.2, 0.0, 1.0);
    col = mix(col, vec3(0.62, 0.68, 0.74) * mix(0.6, 1.0, uDay), frost * 0.75);
    // a wash of team colour toward each end
    col = mix(col, col * (0.55 + team * 0.9), smoothstep(800.0, 5000.0, abs(P.y)) * 0.55);
    // lines: crisp painted strips (one distance to the nearest, so the edges stay sharp and even),
    // a soft glow round them
    float aa = fwidth(P.x) * 1.2 + 0.8;
    float lw = 22.0;
    float r = length(P);
    vec2 gb = vec2(abs(P.x), ${ARENA.Y.toFixed(1)} - abs(P.y));
    float box = max(gb.x - 1800.0, gb.y - 1150.0);
    float arc = abs(length(vec2(P.x, abs(P.y) - (${ARENA.Y.toFixed(1)} - 1150.0))) - 900.0);
    float dl = abs(P.y) - lw;
    dl = min(dl, abs(r - 1100.0) - lw);
    dl = min(dl, r - 60.0);
    if (gb.y >= 0.0) dl = min(dl, abs(box) - lw);
    if (abs(P.y) <= ${ARENA.Y.toFixed(1)} - 1150.0) dl = min(dl, arc - lw);
    float L = 1.0 - smoothstep(-aa, aa, dl);
    float halo = exp(-max(dl, 0.0) / 45.0) * (1.0 - L);
    bbH *= 1.0 - L;
    // the boundary where the ramp starts
    float edge = abs(oct + ${R.toFixed(1)});
    float bnd = 1.0 - smoothstep(lw - aa, lw + aa, edge);
    // the goal line
    float gl = (1.0 - smoothstep(30.0 - aa, 30.0 + aa, abs(abs(P.y) - ${ARENA.Y.toFixed(1)}))) * step(abs(P.x), ${ARENA.GOAL_W.toFixed(1)});
    vec3 lineC = uLine;
    // (painted on: a touch of wear, the turf's shading still under it)
    float wear = 0.9 + 0.1 * bbNoise(P * 0.35);
    col = mix(col, lineC * wear, L * mix(0.94, 0.6, uLineGlow));
    col = mix(col, team * 1.2, bnd);
    // inside the goals: a dark glossy floor with team light
    float gIn = step(${ARENA.Y.toFixed(1)}, abs(P.y)) * step(abs(P.x), ${ARENA.GOAL_W.toFixed(1)});
    float hex = bbHexEdge(P / 140.0);
    col = mix(col, vec3(0.03, 0.035, 0.05) + team * 0.06 * (1.0 - smoothstep(0.0, 0.06, hex)), gIn);
    // under the blades (round the camera, where they grow): the darker thatch down among the roots
    float thatch = (1.0 - smoothstep(825.0, 1500.0, distance(P, camSim.xy))) * (1.0 - synth) * smoothstep(20.0, 140.0, -(oct + ${R.toFixed(1)})) * step(abs(P.y), ${ARENA.Y.toFixed(1)});
    col = mix(col, col * vec3(0.62, 0.6, 0.48), thatch * 0.55);
    // the sea floor arena: the waves' caustics dancing over the turf, a cooler cast
    float cz = bbCaus(P / 330.0, uClock) * uCaus * (1.0 - smoothstep(25.0, 90.0, fw)) * (1.0 - gIn);
    col *= 1.0 + cz * 1.25;
    col = mix(col, col * vec3(0.88, 1.04, 1.06), min(uCaus, 1.0) * 0.2);
    diffuseColor.rgb *= col;
    float glowK = mix(1.0, 0.45, uDay);
    vec3 bbEmit = lineC * L * (mix(0.09, 0.03, uDay) + uLineGlow * mix(1.6, 0.9, uDay)) + lineC * halo * (0.02 + uLineGlow * 0.3) * mix(1.0, 0.45, uDay) + team * glowK * (bnd * 1.6 + gl * 2.4 + gIn * (1.0 - smoothstep(0.0, 0.05, hex)) * 0.5)
      + mix(lineC, team, 0.5 + 0.5 * sign(P.y) * smoothstep(0.0, 4000.0, abs(P.y))) * seamS * (0.25 + 0.35 * (1.0 - uDay)) * (1.0 - gIn);
    `,
  );
  mat.roughness = 0.85;
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

/** real grass: blades of turf grown around the camera (instanced, placed by the shader from a grid
 * that follows the view, each blade fixed to its spot so nothing swims). Two layers: fine blades close
 * in, coarser ones further out, both fading into the mown surface beyond. Each blade is a curved strip
 * folded along its midrib (so one half catches the sun and the other falls in shade), lets the sun
 * through when it's behind it, and takes the pitch's own colour (stripes, lines, team wash, frost)
 * with blade-to-blade variety and the odd dry tip. They lean with the mowing (each stripe the other
 * way, which is what makes a cut pitch striped), grow in clumps, bow under gusts that roll across the
 * pitch, lie flat under cars and the ball, and catch the cars' shadows. */
function grass(): { group: THREE.Group; setQuality: (q: number) => void; setOn: (on: boolean) => void } {
  const grp = new THREE.Group();
  // one blade: rows up the blade, each an edge, the midrib and the other edge, then the tip
  // (position: x across −0.5…0.5, y 1 on the midrib, z the way up 0…1)
  const T = [0, 0.22, 0.44, 0.64, 0.82];
  const pos: number[] = [];
  for (const t of T) {
    const w = 0.5 * (1 - Math.pow(t, 1.6) * 0.82);
    pos.push(-w, 0, t, 0, 1, t, w, 0, t);
  }
  pos.push(0, 0.6, 1);
  const idx: number[] = [];
  for (let r = 0; r < T.length - 1; r++)
    for (let c = 0; c < 2; c++) {
      const a0 = r * 3 + c;
      idx.push(a0, a0 + 1, a0 + 3, a0 + 1, a0 + 4, a0 + 3);
    }
  const tip = T.length * 3;
  const last = (T.length - 1) * 3;
  idx.push(last, last + 1, tip, last + 1, last + 2, tip);
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bg.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0), 3));
  bg.setIndex(idx);
  const layers: { mesh: THREE.Mesh; uN: { value: number }; n: number[] }[] = [];
  const uOrigin = { value: new THREE.Vector2() };
  const uCam = { value: new THREE.Vector2() };
  const make = (spacing: number, h: number, w: number, n: number[], far: number) => {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = bg.index;
    geo.setAttribute('position', bg.attributes.position);
    geo.setAttribute('normal', bg.attributes.normal);
    geo.instanceCount = n[2] * n[2];
    const uN = { value: n[2] };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uDay, uNear, uOrigin, uCam, uN }, TH);
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uDay;
          uniform vec3 uPitchA, uPitchB, uLine;
          uniform float uPattern, uFrost, uCaus, uClock;
          uniform vec4 uNear[9];
          uniform vec2 uOrigin, uCam;
          uniform float uN;
          varying vec3 vGrass;
          varying float vT;
          float gh(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
          float gn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(gh(i), gh(i + vec2(1, 0)), u.x), mix(gh(i + vec2(0, 1)), gh(i + vec2(1, 1)), u.x), u.y); }
          float bbCausV(vec2 p, float t){ float c = 0.0;
            for (int k = 0; k < 2; k++){ float s = k == 0 ? 1.0 : -1.0;
              vec2 q = p * (k == 0 ? 1.0 : 1.37) + vec2(t * 0.21, -t * 0.17) * s;
              q += 0.6 * vec2(sin(q.y * 1.7 + t * 0.9), sin(q.x * 1.5 - t * 0.8));
              q += 0.35 * vec2(sin(q.y * 3.1 - t * 1.3), sin(q.x * 2.9 + t * 1.1));
              vec2 w = abs(sin(q * 1.9)); c += pow(1.0 - min(w.x, w.y), 7.0); }
            return c * 0.6; }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `// where this blade grows: its cell in a grid that follows the view, jittered by the cell's hash
          float fid = float(gl_InstanceID);
          vec2 cell = floor(uOrigin / ${spacing.toFixed(1)}) + vec2(mod(fid, uN), floor(fid / uN)) - floor(uN * 0.5);
          vec2 P = (cell + vec2(gh(cell), gh(cell + 17.3))) * ${spacing.toFixed(1)};
          // only on the flat turf: not up the ramps, not in the goals, not on synthetic turf
          float oct = max(max(abs(P.x) - ${ARENA.X.toFixed(1)}, abs(P.y) - ${ARENA.Y.toFixed(1)}), (abs(P.x) + abs(P.y) - ${ARENA.CORNER.toFixed(1)}) * 0.7071);
          float onTurf = smoothstep(20.0, 140.0, -(oct + ${R.toFixed(1)})) * (1.0 - step(3.5, uPattern));
          // how much of a blade there is here: none off the turf or past the fade (and then none of
          // the work below either)
          float dc = distance(P, uCam);
          float k = (1.0 - smoothstep(${(far * 0.55).toFixed(1)}, ${far.toFixed(1)}, dc)) * onTurf;
          vec3 bladePos = vec3(P, -500.0);
          vec3 objectNormal = vec3(0.0, 0.0, 1.0);
          vGrass = vec3(0.0);
          vT = 0.0;
          if (k > 0.002) {
          float ang = gh(cell + 5.1) * 6.2832;
          float rnd = gh(cell + 9.7);
          // the mowing: which stripe this is, the way its blades lie
          float pw = 18.0;
          float band;
          vec2 leanD;
          if (uPattern < 0.5) { band = smoothstep(-pw, pw, abs(fract(P.y / 1024.0 + 0.25) - 0.5) * 1024.0 - 256.0); leanD = vec2(0.0, 1.0); }
          else if (uPattern < 1.5) { vec2 c = abs(fract(P / 1024.0) - 0.5) * 1024.0 - 256.0; band = abs(smoothstep(-pw, pw, c.x) - smoothstep(-pw, pw, c.y)); leanD = vec2(0.7071); }
          else if (uPattern < 2.5) { vec2 d = vec2(P.x + P.y, P.x - P.y) * 0.7071; vec2 c = abs(fract(d / 1100.0) - 0.5) * 1100.0 - 275.0; band = abs(smoothstep(-pw, pw, c.x) - smoothstep(-pw, pw, c.y)); leanD = vec2(1.0, 0.0); }
          else { band = smoothstep(-pw, pw, abs(fract(length(P) / 1000.0) - 0.5) * 1000.0 - 250.0); leanD = normalize(P + 0.01); }
          vec3 col = mix(uPitchA, uPitchB, band) * mix(0.85, 1.0, uDay);
          float n = gn(P * 0.0035) * 0.4 + gn(P * 0.012) * 0.35 + gn(P * 0.045) * 0.25;
          col *= 0.84 + 0.32 * n;
          // every blade its own green: lighter or darker, yellower or bluer
          col *= 0.84 + 0.32 * rnd;
          col *= mix(vec3(1.1, 1.05, 0.78), vec3(0.9, 1.0, 1.08), gh(cell + 2.2));
          float side = sign(P.y);
          vec3 team = side < 0.0 ? vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}) : vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)});
          col = mix(col, col * (0.55 + team * 0.9), smoothstep(800.0, 5000.0, abs(P.y)) * 0.55);
          // the painted lines: the blades there are painted too
          float r = length(P);
          vec2 gb = vec2(abs(P.x), ${ARENA.Y.toFixed(1)} - abs(P.y));
          float box = max(gb.x - 1800.0, gb.y - 1150.0);
          float arc = abs(length(vec2(P.x, abs(P.y) - (${ARENA.Y.toFixed(1)} - 1150.0))) - 900.0);
          float dl = abs(P.y) - 22.0;
          dl = min(dl, abs(r - 1100.0) - 22.0);
          dl = min(dl, r - 60.0);
          if (gb.y >= 0.0) dl = min(dl, abs(box) - 22.0);
          if (abs(P.y) <= ${ARENA.Y.toFixed(1)} - 1150.0) dl = min(dl, arc - 22.0);
          float L = 1.0 - smoothstep(-2.0, 2.0, dl);
          col = mix(col, uLine * 0.85, L * 0.9);
          float fr = uFrost * smoothstep(0.55, 0.9, gn(P * 0.004) * 0.6 + gn(P * 0.03) * 0.4 + smoothstep(-1000.0, -150.0, oct) * 0.5);
          col = mix(col, vec3(0.62, 0.68, 0.74) * mix(0.6, 1.0, uDay), fr * 0.7);
          col *= 1.0 + bbCausV(P / 330.0, uClock) * uCaus * 1.25;
          // the odd dead blade: straw from the tip down
          float dry = step(0.94, gh(cell + 11.1)) * (1.0 - L);
          // how tall: in clumps, shorter toward the fade (so the layer has no border) and on the lines
          float clump = gn(P * 0.05 + 3.0);
          float ht = ${h.toFixed(1)} * (0.55 + 0.75 * rnd) * (0.72 + 0.56 * clump) * k * (1.0 - L * 0.45);
          float wd = ${w.toFixed(2)} * (0.7 + 0.6 * gh(cell + 4.4)) * (0.4 + 0.6 * k);
          float t = position.z;
          // which way the blade faces: always turned toward the eye (both of its sides look the same)
          vec2 face = vec2(cos(ang), sin(ang));
          if (dot(face, uCam - P) < 0.0) face = -face;
          vec2 across = vec2(-face.y, face.x);
          // lean: with the mowing, each its own way a little, and gusts rolling over the pitch
          vec2 lean = leanD * (band * 2.0 - 1.0) * 0.5 + face * (0.15 + 0.25 * gh(cell + 6.6));
          float gust = smoothstep(0.35, 0.85, gn(P * 0.0016 + vec2(uClock * 0.35, uClock * 0.12)));
          lean += vec2(0.85, 0.5) * (0.12 + 0.55 * gust) + vec2(sin(uClock * 5.0 + rnd * 40.0), cos(uClock * 4.3 + rnd * 25.0)) * 0.04;
          // and down flat away from cars and the ball
          float press = 0.0;
          for (int i = 0; i < 9; i++) {
            vec4 q = uNear[i];
            vec2 dv = P - q.xy;
            float rr = q.w > 0.5 ? 95.0 : 120.0;
            float hit = (1.0 - smoothstep(rr * 0.4, rr, length(dv))) * (1.0 - smoothstep(60.0, 160.0, q.z - (q.w > 0.5 ? 93.0 : 17.0)));
            press = max(press, hit);
            lean += normalize(dv + 0.01) * hit * 0.8;
          }
          // the shape: a curve that bows over more toward the tip, a V folded along the midrib
          vec2 bendXY = lean * t * t * ht + face * pow(t, 3.0) * ht * 0.18 * (0.5 + rnd);
          float bendZ = t * ht * (1.0 - 0.25 * min(length(lean), 1.6)) * (1.0 - press * 0.45);
          float fold = position.y * 0.32;
          bladePos = vec3(P + across * position.x * wd + face * fold * wd + bendXY, bendZ + 0.6);
          // lit as the blade (each half of the fold its own way), softened toward the turf's up
          float halfSide = position.x < -0.01 ? -1.0 : (position.x > 0.01 ? 1.0 : 0.0);
          vec3 bn = normalize(vec3(face - across * halfSide * 0.7 - lean * 0.6, 0.35 + t * 0.2));
          objectNormal = normalize(mix(vec3(0.0, 0.0, 1.0), bn, 0.6));
          // darker down in the turf, bright and a touch yellow at the tips, straw on a dead blade,
          // lighter where a gust has turned the blades' backs up; into the mown surface's own colour
          // as the blades fade out, so there's no edge
          vec3 tipC = col * vec3(1.12, 1.14, 0.96) + vec3(0.012, 0.016, 0.0);
          vec3 g = mix(col * 0.55, tipC, smoothstep(0.0, 1.0, t));
          g = mix(g, vec3(0.42, 0.36, 0.16) * (0.6 + 0.4 * uDay), dry * smoothstep(0.2, 0.9, t));
          g *= 1.0 + gust * 0.1 * t;
          vGrass = mix(col, g, smoothstep(0.0, 0.6, k));
          vT = t;
          }`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = bladePos;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGrass;\nvarying float vT;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb = vGrass;')
        // (the normal is built to face the eye already: no flipping for back faces)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // light through the blades: with the sun behind them they glow, most at the thin tips
          #if NUM_DIR_LIGHTS > 0
          {
            float through = pow(max(dot(-normalize(vViewPosition), directionalLights[0].direction), 0.0), 3.0);
            totalEmissiveRadiance += vGrass * directionalLights[0].color * through * (0.15 + 0.5 * vT) * 0.5;
          }
          #endif
          totalEmissiveRadiance += vGrass * vT * vT * 0.06;`,
        );
    };
    mat.customProgramCacheKey = () => 'bbgrass2' + spacing;
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    // (the cars' shadows land close by: only the fine layer takes them)
    m.receiveShadow = spacing < 6;
    m.castShadow = false;
    // the grid follows the camera's footprint, pushed ahead along the view so the blades sit in shot
    m.onBeforeRender = (_r, _s, cam) => {
      const cx = cam.position.x * 100;
      const cy = -cam.position.z * 100;
      const d = new THREE.Vector3();
      cam.getWorldDirection(d);
      const f = Math.hypot(d.x, d.z) || 1;
      const ahead = far * 0.45;
      uCam.value.set(cx, cy);
      uOrigin.value.set(cx + (d.x / f) * ahead, cy - (d.z / f) * ahead);
    };
    grp.add(m);
    layers.push({ mesh: m, uN, n });
  };
  // (spacing cm, blade height, width, grid size at quality 0/1/2, fade-out radius)
  make(4, 6.5, 1.5, [0, 160, 240], 600);
  make(10, 7.5, 2.4, [120, 190, 250], 1500);
  const setQuality = (q: number) => {
    for (const l of layers) {
      const n = l.n[Math.max(0, Math.min(2, q))];
      l.uN.value = n;
      (l.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n * n;
      l.mesh.visible = n > 0;
    }
  };
  setQuality(2);
  return { group: grp, setQuality, setOn: (on) => (grp.visible = on) };
}

function shell(): THREE.Group {
  const grp = new THREE.Group();
  const uT = { value: 0 };
  // the ramps and the lower walls: dark padded turf with team light
  const lowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide });
  simPatch(
    lowMat,
    /* glsl */ `
    ${GOAL_CUT}
    float side = sign(vSim.y);
    vec3 team = side < 0.0 ? vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}) : vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)});
    float tw = smoothstep(-2500.0, 2500.0, vSim.y);
    vec3 teamMix = mix(vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}), vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)}), tw);
    float z = vSim.z;
    vec2 q = vec2(vBB.x, z) / 120.0;
    float hex = bbHexEdge(q);
    float n = bbNoise(vec2(vBB.x, z) * 0.02);
    vec3 col = mix(uPitchA * 0.62, uWall, smoothstep(40.0, 260.0, z));
    col *= 0.85 + 0.3 * n;
    col *= 0.85 + 0.15 * smoothstep(0.0, 0.08, hex);
    col *= mix(1.0, mix(2.4, 1.15, smoothstep(0.15, 0.4, max(uWall.r, max(uWall.g, uWall.b)))), uDay);
    // snow banked at the foot of the walls
    col = mix(col, vec3(0.8, 0.85, 0.9) * mix(0.6, 1.0, uDay), uFrost * (1.0 - smoothstep(30.0, 140.0 + n * 80.0, z)) * 0.85);
    col *= 1.0 + bbCaus(vec2(vBB.x, z) / 330.0, uClock) * uCaus * 1.3 * (1.0 - smoothstep(25.0, 90.0, fwidth(vBB.x)));
    diffuseColor.rgb *= col;
    float stripe = smoothstep(14.0, 0.0, abs(z - 330.0)) ;
    float seam = 1.0 - smoothstep(0.0, 0.05, hex);
    vec3 bbEmit = teamMix * (stripe * mix(2.2, 1.3, uDay) + seam * 0.08 * smoothstep(80.0, 300.0, z) * (1.0 - uDay));
    `,
  );
  const low = new THREE.Mesh(shellGeometry(0, 345), lowMat);
  low.receiveShadow = true;
  grp.add(low);
  // the glass: tinted panels in dark frames with a fine honeycomb, a frosted lower band, and a sheen
  // toward grazing angles so the surface reads plainly when a car drives on it; the panels light up
  // round the ball and the cars. The ceiling is the same glass, gridded flat.
  const glassFrag = (ceil: boolean) => /* glsl */ `
    ${ceil ? '' : GOAL_CUT}
    float tw = smoothstep(-3000.0, 3000.0, vSim.y);
    vec3 team = mix(vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}), vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)}), tw);
    float z = vSim.z;
    vec2 W = ${ceil ? 'vSim.xy' : 'vec2(vBB.x, z)'};
    float fw = max(fwidth(W.x), fwidth(W.y)) + 0.01;
    // frames: mullions every 1024 along the wall, rails at 1000 and 1500 (a grid on the ceiling)
    vec2 cell = abs(fract(W / 1024.0 + 0.5) - 0.5) * 1024.0;
    float dFrame = ${ceil ? '9999.0' : 'min(cell.x, abs(z - 1000.0))'};
    float frame = (1.0 - smoothstep(10.0, 10.0 + fw * 1.5, dFrame)) * ${ceil ? '0.0' : '(1.0 - smoothstep(1300.0, 1750.0, z))'};
    float frameLine = 1.0 - smoothstep(2.5, 2.5 + fw, dFrame);
    // the honeycomb, faded out before it can shimmer
    float hs = 95.0;
    float hex = bbHexEdge(W / hs);
    float hfw = fw / hs;
    float hexL = (1.0 - smoothstep(0.0, 0.07 + hfw * 1.2, hex)) * (1.0 - smoothstep(0.04, 0.16, hfw));
    float hexB = 1.0 - smoothstep(0.0, 0.03 + fw / 300.0, bbHexEdge(W / 300.0));
    // a surface's grazing sheen (its normal from the screen-space derivatives)
    vec3 gn = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
    float ndv = abs(dot(gn, normalize(vViewPosition)));
    float fres = pow(1.0 - ndv, 2.0);
    float lower = ${ceil ? '0.0' : '1.0 - smoothstep(900.0, 1100.0, z)'};
    float smudge = bbNoise(W * 0.004) * 0.6 + bbNoise(W * 0.02) * 0.4;
    float near = 0.0;
    for (int i = 0; i < 9; i++) {
      float d = distance(vSim, uNear[i].xyz);
      float r = uNear[i].w > 0.5 ? 620.0 : 460.0;
      near = max(near, (1.0 - smoothstep(0.0, r, d)) * (uNear[i].w > 0.5 ? 1.0 : 0.85));
    }
    float pulse = 0.5 + 0.5 * sin(uTime * 1.3 + W.x * 0.002 - W.y * 0.003);
    vec3 glassC = mix(uGlass, team * 0.35 + 0.03, 0.25 + lower * 0.15);
    vec3 frameC = mix(vec3(0.1, 0.11, 0.13), uTrim * 0.3, 0.5);
    vec3 col = mix(glassC * (0.8 + 0.4 * smudge), vec3(0.15, 0.18, 0.23), hexL * 0.5);
    col = mix(col, frameC, frame);
    diffuseColor.rgb = col;
    float a = ${ceil ? '0.05' : '0.1 + lower * 0.12'} + fres * 0.6 + hexL * 0.1 + hexB * 0.03 + smudge * 0.04;
    a = mix(a, 0.85, frame);
    a += near * near * (0.06 + hexL * 0.3);
    diffuseColor.a = clamp(a, 0.0, 1.0);
    float night = mix(1.0, 0.45, uDay);
    vec3 bbEmit = team * frameLine * frame * ${ceil ? '0.0' : '0.55'} * night
      + team * hexB * (0.08 + 0.06 * pulse) * ${ceil ? '0.3' : '(0.4 + lower * 0.6)'} * night
      + team * hexL * (0.025 + 0.02 * pulse) * night
      + mix(team, vec3(0.9, 0.95, 1.0), 0.2) * near * near * (hexL * 0.9 + 0.08);
    `;
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, metalness: 0, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.55, specularIntensity: 0.45 });
  simPatch(glassMat, glassFrag(false), { uTime: uT, uNear }, 'uniform float uTime;\nuniform vec4 uNear[9];');
  const glass = new THREE.Mesh(shellGeometry(345, ARENA.Z + 1), glassMat);
  glass.renderOrder = 5;
  grp.add(glass);
  // the ceiling: the octagon pulled in by the ramp radius, at the roof
  const ceilMat = glassMat.clone();
  simPatch(ceilMat, glassFrag(true), { uTime: uT, uNear }, 'uniform float uTime;\nuniform vec4 uNear[9];');
  const oct = new THREE.Shape(perimeter(0, 1e5, 10).p.slice(0, -1).map(([x, y]) => new THREE.Vector2(x, y)));
  const cg = new THREE.ShapeGeometry(oct);
  cg.translate(0, 0, ARENA.Z + 0.5);
  const ceiling = new THREE.Mesh(cg, ceilMat);
  ceiling.renderOrder = 5;
  grp.add(ceiling);
  grp.userData.uT = uT;
  return grp;
}

function goal(sideSign: number, team: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const W = ARENA.GOAL_W;
  const H = ARENA.GOAL_H;
  const D = ARENA.GOAL_D;
  const Y = ARENA.Y * sideSign;
  const by = Y + sideSign * D;
  const surf = goalSurfaces(sideSign as 1 | -1, 16, 8);
  // the frame: the posts and crossbar rounded from the back wall into the goal, polished light
  // grey, and the faces where the floor's ramp stops either side; a team light strip runs round the
  // mouth where the frame meets the goal's walls
  const frameM = new THREE.MeshPhysicalMaterial({ color: 0xf1f3f6, roughness: 0.38, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 0.9 });
  const strip = new THREE.MeshBasicMaterial({ color: team.clone().multiplyScalar(3.4) });
  for (const part of [surf.frame, surf.ramps]) {
    const m = new THREE.Mesh(triGeo(part), frameM);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  {
    const RS = GOAL_EDGE_R;
    const pts: THREE.Vector3[] = [];
    const yl = Y + sideSign * (GOAL_POST_R + 3);
    for (let k = 0; k <= 4; k++) pts.push(new THREE.Vector3(-(W - 3), yl, 3 + ((H - RS - 3) * k) / 4));
    for (let k = 1; k < 12; k++) {
      const a = Math.PI - (k / 12) * (Math.PI / 2);
      pts.push(new THREE.Vector3(-(W - RS) + (RS - 3) * Math.cos(a), yl, H - RS + (RS - 3) * Math.sin(a)));
    }
    for (let k = 0; k < 12; k++) {
      const a = Math.PI / 2 - (k / 12) * (Math.PI / 2);
      pts.push(new THREE.Vector3(W - RS + (RS - 3) * Math.cos(a), yl, H - RS + (RS - 3) * Math.sin(a)));
    }
    for (let k = 0; k <= 4; k++) pts.push(new THREE.Vector3(W - 3, yl, H - RS - ((H - RS - 3) * k) / 4));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 160, 3.4, 6, false), strip));
  }
  // inside: solid dark panels carrying the net (sides, roof and back), lit by the team light
  const netM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
  simPatch(
    netM,
    /* glsl */ `
    bool sideWall = abs(vSim.x) > ${(W - 2).toFixed(1)};
    // the curved back unrolled: across, and up the profile (depth plus height)
    vec2 uvb = vec2(vSim.x, vSim.z + abs(vSim.y) - ${ARENA.Y.toFixed(1)});
    vec2 uvn = sideWall ? vSim.yz : uvb;
    // a hex net strung in front of a dark padded panel: the wires catch the light, and their
    // shadow on the panel behind slides with the view (parallax), so the net reads as a net
    vec3 camSim = vec3(cameraPosition.x * 100.0, -cameraPosition.z * 100.0, cameraPosition.y * 100.0);
    vec3 vd = normalize(vSim - camSim);
    vec2 vt = sideWall ? vd.yz / max(0.25, abs(vd.x)) : vec2(vd.x, vd.z) / max(0.25, length(vd.yz));
    float fwn = length(fwidth(uvn)) / 30.0;
    float wire = 1.0 - smoothstep(0.0, 0.05 + fwn, bbHexEdge(uvn / 30.0));
    float shade = 1.0 - smoothstep(0.0, 0.1 + fwn, bbHexEdge((uvn + vt * 30.0) / 30.0));
    // far off the wires average out to a grey sheen instead of shimmering
    float far = smoothstep(0.15, 0.45, fwn);
    wire = mix(wire, 0.28, far);
    shade = mix(shade, 0.3, far);
    // the panel: joints every 2 m, darker in the net's shadow
    vec2 pq = uvn / 220.0;
    float joint = 1.0 - smoothstep(0.0, 0.02, min(abs(fract(pq.x) - 0.5), abs(fract(pq.y) - 0.5)) - 0.47);
    vec3 base = vec3(0.05, 0.055, 0.07) * (1.0 - joint * 0.5) * (1.0 - shade * 0.55);
    // brighter toward the mouth, darker at the back
    float depth = clamp((abs(vSim.y) - ${ARENA.Y.toFixed(1)}) / ${D.toFixed(1)}, 0.0, 1.0);
    diffuseColor.rgb = mix(base, vec3(0.78, 0.8, 0.84), wire * 0.6);
    vec3 tc = vec3(${team.r.toFixed(3)}, ${team.g.toFixed(3)}, ${team.b.toFixed(3)});
    // team light: the wires glow with it, and it pools low in the net
    float low = 1.0 - smoothstep(0.0, 260.0, vSim.z);
    vec3 bbEmit = tc * (wire * (0.2 - depth * 0.09) + 0.02 + low * 0.06 * (1.0 - shade * 0.5));
    `,
  );
  // the box: the floor ramping up into the back wall, the curve over into the roof, the sides joined
  // to both by rounded edges
  {
    const m = new THREE.Mesh(triGeo(surf.inner), netM);
    m.receiveShadow = true;
    g.add(m);
  }
  // team light along the back where it bends
  for (const z of [H - GOAL_TOP_R, GOAL_BACK_R]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(2 * (W - GOAL_EDGE_R), 6, 6), strip);
    m.position.set(0, by - sideSign * 3, z);
    g.add(m);
  }
  // the housing round the box: dark structure, so nothing behind (the seats) shows into the goal
  // (outer slabs only: behind the back, outside the sides, over the roof; the mouth stays open)
  const slab = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), houseM);
    m.position.set(x, y, z);
    g.add(m);
  };
  const ym = Y + sideSign * (D / 2 + 20);
  const P = GOAL_POST_R;
  // (each set 4 back from the panel it covers, so they never fight over the same depth; clear of the
  // rounded frame)
  slab(W * 2 + 2 * P + 128, 60, H + P + 64, 0, by + sideSign * 34, (H + P + 64) / 2 - 2);
  for (const sx of [-1, 1]) slab(60, D + 20, H + P + 64, sx * (W + P + 34), ym, (H + P + 64) / 2 - 2);
  slab(W * 2 + 2 * P + 128, D + 20, 60, 0, ym, H + P + 34);
  // team light round the housing's top, so it reads as part of the goal from the stands
  const edgeM = new THREE.MeshBasicMaterial({ color: team.clone().multiplyScalar(2.2) });
  const edge = (sx: number, sy: number, x: number, y: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 14), edgeM);
    m.position.set(x, y, H + P + 66);
    g.add(m);
  };
  edge(W * 2 + 2 * P + 138, 14, 0, Y + sideSign * (D + 30));
  for (const sx of [-1, 1]) edge(14, D + 30, sx * (W + P + 65), ym);
  // the inner glow light
  const pl = new THREE.PointLight(team, 6, 14, 2);
  pl.position.set(0, Y + sideSign * (D - 200), H * 0.6);
  g.add(pl);
  return g;
}

interface PadMesh {
  /** the energy disc, rim lights and orb / puck: dimmed, refilled and hidden by the update */
  disc: THREE.ShaderMaterial;
  rim: THREE.MeshBasicMaterial;
  orb: THREE.Group | null;
  puck: THREE.Mesh | null;
  big: boolean;
}

const PAD_HOT = new THREE.Color(1.0, 0.6, 0.14);

/** the energy in a pad's recess: rings running outward over a radial grille, filling back up
 * round the dial while the pad recharges (uK 0…1), bright when live */
function padDiscMat(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uK: { value: 1 }, uLive: { value: 1 }, uC: { value: PAD_HOT } },
    vertexShader: `varying vec2 vU; void main(){ vU = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uT, uK, uLive; uniform vec3 uC; varying vec2 vU;
      void main(){
        float r = length(vU);
        float a = atan(vU.y, vU.x) / 6.2831853 + 0.5;
        // rings running outward, a radial grille, a hot core
        float rings = 0.5 + 0.5 * sin(r * 18.0 - uT * 7.0);
        float grille = smoothstep(0.08, 0.0, abs(fract(a * 24.0) - 0.5) - 0.38);
        float core = exp(-r * r * 6.0);
        // recharging: the dial fills clockwise, dim
        float fill = step(a, uK);
        float on = mix(fill * 0.28, 1.0, uLive);
        float k = (0.35 + 0.65 * rings) * (1.0 - grille * 0.55) * smoothstep(1.0, 0.82, r) + core * 1.4 * uLive;
        // a thin bright edge
        k += smoothstep(0.05, 0.0, abs(r - 0.93)) * 1.2;
        gl_FragColor = vec4(uC * k * on * 0.9, 1.0);
      }`,
  });
}

function pads(): { group: THREE.Group; items: PadMesh[]; sparks: THREE.Points; sparkLive: THREE.BufferAttribute } {
  const group = new THREE.Group();
  const items: PadMesh[] = [];
  // the bases: a bevelled metal plinth with a recess for the energy disc
  const plinth = (R: number, h: number, rr: number) => {
    const pts = [
      [0.001, h - 3],
      [rr - 2, h - 3],
      [rr, h],
      [rr + 6, h + 1.5],
      [R - 10, h + 1.5],
      [R - 4, h - 1],
      [R, 2],
      [R + 4, 0],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const g = new THREE.LatheGeometry(pts, 48);
    g.rotateX(Math.PI / 2);
    return g;
  };
  const baseBig = plinth(176, 12, 118);
  const baseSmall = plinth(108, 7, 66);
  const baseM = new THREE.MeshStandardMaterial({ color: 0x2a2e37, roughness: 0.28, metalness: 0.85 });
  const discG = new THREE.CircleGeometry(1, 56);
  // rim lights: a ring of short lit segments round the plinth's shoulder
  const rimSeg = (R: number, n: number, z: number) => {
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const seg = new THREE.BoxGeometry(R * 0.32, 4, 2.4);
      seg.rotateZ(a + Math.PI / 2);
      seg.translate(Math.cos(a) * R, Math.sin(a) * R, z);
      parts.push(seg);
    }
    return mergeGeometries(parts);
  };
  const rimBig = rimSeg(150, 12, 14);
  const rimSmall = rimSeg(90, 8, 8.8);
  // the big orb: a white-hot core in a glowing fresnel shell with a crackle of energy
  const coreM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.1, 0.9, 0.12) });
  const shellM = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uC: { value: PAD_HOT } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uT; uniform vec3 uC; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){ float f = 1.0 - abs(dot(vN, vV));
        vec3 q = normalize(vP) * 3.0;
        float crackle = 0.5 + 0.5 * sin(q.x * 3.1 + uT * 3.0) * sin(q.y * 2.7 - uT * 2.3) * sin(q.z * 3.3 + uT * 1.7);
        float k = pow(f, 2.0) * 1.8 + smoothstep(0.7, 1.0, crackle) * 0.5;
        gl_FragColor = vec4(uC * k * 0.75, 1.0); }`,
  });
  const coreG = new THREE.IcosahedronGeometry(52, 4);
  const shellG = new THREE.IcosahedronGeometry(64, 4);
  // the small pads' puck: a short glowing cylinder hovering over the disc
  const puckG = new THREE.CylinderGeometry(30, 34, 9, 32).rotateX(Math.PI / 2);
  const puckM = new THREE.MeshStandardMaterial({ color: 0xffb040, emissive: PAD_HOT, emissiveIntensity: 2.6, roughness: 0.25, metalness: 0.2 });
  for (const p of PADS) {
    const base = new THREE.Mesh(p.big ? baseBig : baseSmall, baseM);
    base.position.set(p.x, p.y, 0);
    base.receiveShadow = true;
    group.add(base);
    const disc = padDiscMat();
    const dm = new THREE.Mesh(discG, disc);
    dm.scale.setScalar(p.big ? 118 : 66);
    dm.position.set(p.x, p.y, p.big ? 9.6 : 4.6);
    dm.renderOrder = 3;
    group.add(dm);
    const rim = new THREE.MeshBasicMaterial({ color: PAD_HOT.clone().multiplyScalar(3) });
    const rm = new THREE.Mesh(p.big ? rimBig : rimSmall, rim);
    rm.position.set(p.x, p.y, 0);
    group.add(rm);
    let orb: THREE.Group | null = null;
    let puck: THREE.Mesh | null = null;
    if (p.big) {
      orb = new THREE.Group();
      orb.add(new THREE.Mesh(coreG, coreM));
      const sh = new THREE.Mesh(shellG, shellM);
      sh.renderOrder = 8;
      orb.add(sh);
      orb.position.set(p.x, p.y, 120);
      group.add(orb);
    } else {
      puck = new THREE.Mesh(puckG, puckM);
      puck.position.set(p.x, p.y, 24);
      puck.castShadow = false;
      group.add(puck);
    }
    items.push({ disc, rim, orb, puck, big: p.big });
  }
  // sparks rising off every live pad (one draw: each spark knows its pad and phase)
  const N = 22;
  const pos: number[] = [];
  const seed: number[] = [];
  const live: number[] = [];
  PADS.forEach((p, k) => {
    const n = p.big ? N : 8;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (p.big ? 110 : 60) * Math.sqrt(Math.random());
      pos.push(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 0);
      seed.push(Math.random(), p.big ? 1 : 0, k);
      live.push(1);
    }
  });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  sg.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 3));
  const sparkLive = new THREE.Float32BufferAttribute(live, 1);
  sg.setAttribute('live', sparkLive);
  const sm = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uC: { value: PAD_HOT }, uPx: { value: 1 } },
    vertexShader: `attribute vec3 seed; attribute float live; uniform float uT; uniform float uPx; varying float vA;
      void main(){ float h = seed.y > 0.5 ? 320.0 : 110.0; float ph = fract(uT * (seed.y > 0.5 ? 0.45 : 0.7) + seed.x);
        vec3 p = position; p.z = ph * h; p.xy += vec2(sin(uT * 2.0 + seed.x * 30.0), cos(uT * 1.7 + seed.x * 20.0)) * 6.0;
        vA = (1.0 - ph) * smoothstep(0.0, 0.08, ph) * live;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((seed.y > 0.5 ? 0.08 : 0.055) * 650.0 * uPx / max(0.5, -mv.z), 1.0, 24.0); }`,
    fragmentShader: `uniform vec3 uC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float k = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(uC * 1.4 * k * vA, 1.0); }`,
  });
  const sparks = new THREE.Points(sg, sm);
  sparks.frustumCulled = false;
  sparks.renderOrder = 9;
  group.add(sparks);
  group.userData.anim = [shellM, sm];
  return { group, items, sparks, sparkLive };
}

/** stands rising behind the glass: rows of fans drawn in a shader, with a bounce on goals */
/** the stands' rows: how high each riser is, and how far each takes v (the shader's row height) */
const ROW_RISE = 82;
const ROW_H = 85;

function stands(uT: { value: number }, uEx: { value: number }, count: 1 | 2): THREE.Group {
  const grp = new THREE.Group();
  const { p: per, len } = perimeter(0, 300, 12);
  const tiers: [number, number, number, number][] = [
    // (offset from the wall, z bottom, offset top, z top)
    [700, 120, 3600, 2000],
    [4100, 2600, 6600, 4300],
  ].slice(0, count) as [number, number, number, number][];
  // the back of the bowl: just behind and above the top row (the sky and what's beyond show over it)
  const backO = count === 2 ? 7000 : 3800;
  const backZ = count === 2 ? 4700 : 2200;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  simPatch(
    mat,
    /* glsl */ `
    // (the goals' housings take this space)
    if (abs(vSim.x) < ${(ARENA.GOAL_W + 300).toFixed(1)} && abs(vSim.y) > ${ARENA.Y.toFixed(1)} && vSim.z < ${(ARENA.GOAL_H + 120).toFixed(1)}) discard;
    // u along the bowl, v up the rows: each row a tread (to sit on) and a riser (facing the pitch,
    // where the crowd is drawn: seat backs, bodies, heads)
    float rowH = ${ROW_H.toFixed(1)};
    vec3 sn = normalize(cross(dFdx(vSim), dFdy(vSim)));
    float tread = step(0.7, abs(sn.z));
    float row = floor(vBB.y / rowH + tread * 0.5);
    float seatW = 62.0;
    // alternate rows sit half a seat over
    float sx = vBB.x / seatW + mod(row, 2.0) * 0.5;
    float seat = floor(sx);
    vec2 f = vec2(fract(sx), fract(vBB.y / rowH));
    float h = bbHash(vec2(seat, row));
    float h2 = bbHash(vec2(seat * 1.7 + 3.1, row * 0.9 + 7.0));
    // sections: a block every 1500 along, split by a stair; a few rows of each tier left as a walkway,
    // and tunnel mouths through it into the concourse
    float block = floor(vBB.x / 1500.0);
    float hb = bbHash(vec2(block, floor(row / 11.0) + 0.5));
    float walk = step(mod(row, 11.0), 0.5) * step(1.0, row);
    float tunnel = walk * step(abs(fract(vBB.x / 1500.0) - 0.5), 0.09) * step(0.35, hb);
    float occupied = step(0.08 + 0.35 * step(hb, 0.12), h) * (1.0 - walk);
    float bob = uExcite * max(0.0, sin(uTime * (7.0 + h2 * 5.0) + h * 30.0)) * 0.3 + 0.03 * sin(uTime * 2.0 + h * 40.0);
    float body = smoothstep(0.34, 0.26, abs(f.x - 0.5)) * step(f.y, 0.5 + bob) * step(0.1, f.y);
    float head = smoothstep(0.2, 0.14, length((f - vec2(0.5, 0.68 + bob)) * vec2(1.0, 1.2)));
    float person = max(body, head) * occupied * (1.0 - tread);
    // each half of the bowl leans to its team's colours, split at halfway
    float tw = smoothstep(-250.0, 250.0, vSim.y);
    vec3 teamC = mix(vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}), vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)}), tw);
    vec3 rnd = vec3(fract(h2 * 7.3), fract(h2 * 3.1), fract(h2 * 5.7));
    vec3 shirt = h2 < 0.3 ? teamC * 0.7 : (h2 < 0.5 ? vec3(0.55, 0.56, 0.58) : (h2 < 0.72 ? vec3(0.045) : mix(vec3(0.25), rnd * 0.5, 0.6)));
    vec3 skin = mix(vec3(0.85, 0.62, 0.48), vec3(0.3, 0.19, 0.13), fract(h * 13.0));
    // the seats: the arena's colour, picked out in team colour block by block near each end
    vec3 seatC = uSeat * mix(0.7, 1.0, uDay);
    seatC = mix(seatC, teamC * 0.32, step(0.62, hb) * smoothstep(2500.0, 4500.0, abs(vSim.y)));
    // the riser: the seat back, darker toward the tread it meets (the row's own shadow)
    vec3 riser = seatC * (0.5 + 0.5 * smoothstep(0.0, 0.35, f.y));
    vec3 floorC = mix(vec3(0.07, 0.072, 0.08), vec3(0.75, 0.8, 0.86), uFrost * 0.8) * mix(0.55, 1.0, uDay);
    vec3 col = mix(mix(riser, head > body ? skin : shirt, person), floorC, tread);
    col = mix(col, mix(vec3(0.11, 0.115, 0.13), floorC, uFrost) * mix(0.6, 1.0, uDay), walk * (1.0 - tread));
    col = mix(col, vec3(0.006), tunnel * (1.0 - tread));
    // far away the seats are under a pixel: blend to the average instead of shimmering
    float px = max(fwidth(sx), fwidth(vBB.y / rowH));
    float dens = 0.75 + 0.5 * bbNoise(vBB / vec2(420.0, 260.0)) + 0.2 * (bbNoise(vBB / vec2(90.0, 120.0)) - 0.5);
    vec3 crowdAvg = mix(vec3(0.12, 0.12, 0.13), teamC * 0.55, 0.14) * dens * (1.0 - walk) + vec3(0.1) * walk;
    vec3 avg = mix(seatC, crowdAvg, 0.75 * (1.0 - step(hb, 0.12) * 0.5));
    col = mix(col, mix(avg, floorC, tread * 0.6), smoothstep(0.3, 0.8, px));
    // the roof shades the upper rows by day
    col *= mix(1.0, 1.2, uDay) * (1.0 - uDay * 0.35 * smoothstep(2300.0, 4300.0, vSim.z));
    float aisle = step(fract(vBB.x / 1500.0), 0.03);
    col = mix(col, mix(vec3(0.05), uTrim * 0.3, 0.5) * mix(0.6, 1.0, uDay), aisle);
    diffuseColor.rgb *= col;
    // phone lights and camera flashes (more of them in a big moment)
    float flash = step(0.9992 - uExcite * 0.003, bbHash(vec2(seat, row) + floor(uTime * 5.0) * 0.37)) * occupied * (1.0 - tread) * (1.0 - smoothstep(0.5, 1.5, px)) * (1.0 - uDay * (1.0 - uExcite));
    vec3 bbEmit = vec3(1.0) * flash * mix(2.5, 1.2, uDay) + col * 0.1 * (1.0 - uDay) + vec3(1.0, 0.9, 0.7) * tunnel * (1.0 - tread) * 0.02;
    `,
    { uTime: uT, uExcite: uEx },
    'uniform float uTime; uniform float uExcite;',
  );
  for (const [o0, z0, o1, z1] of tiers) {
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const W = per.length;
    // real rows: a tread to sit on, a riser up to the next (the crowd is drawn on the risers, which
    // face the pitch); each riser one row high in v, so the shader's rows land on them
    const rows = Math.max(4, Math.round((z1 - z0) / ROW_RISE));
    const rise = (z1 - z0) / rows;
    const run = (o1 - o0) / rows;
    // u: arc length along the middle of the tier, so seats keep their size round the corners
    const om = (o0 + o1) / 2;
    const us = [0];
    for (let i = 1; i < W; i++) {
      const [ax, ay, anx, any] = per[i - 1];
      const [bx, by, bnx, bny] = per[i];
      us.push(us[i - 1] + Math.hypot(bx + bnx * (R + om) - ax - anx * (R + om), by + bny * (R + om) - ay - any * (R + om)));
    }
    // a strip round the bowl between two (offset, z) points, its v running v0 → v1
    const strip = (oa: number, za: number, ob: number, zb: number, va: number, vb: number, riser: boolean) => {
      const base = pos.length / 3;
      for (const [o, z, v] of [[oa, za, va], [ob, zb, vb]])
        for (let i = 0; i < W; i++) {
          const [x, y, nx, ny] = per[i];
          pos.push(x + nx * (R + o), y + ny * (R + o), z);
          nrm.push(riser ? -nx : 0, riser ? -ny : 0, riser ? 0 : 1);
          uv.push(us[i], v);
        }
      for (let i = 0; i < W - 1; i++) idx.push(base + i, base + i + W, base + i + 1, base + i + 1, base + i + W, base + i + W + 1);
    };
    for (let k = 0; k < rows; k++) {
      const o = o0 + k * run;
      const z = z0 + k * rise;
      // (a tread carries its row's v all across; the shader tells treads from risers by their normal)
      strip(o, z, o + run, z, k * ROW_H, k * ROW_H, false);
      strip(o + run, z, o + run, z + rise, k * ROW_H, (k + 1) * ROW_H, true);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    grp.add(m);
    // the front parapet of each tier: an LED ribbon
    const lp: number[] = [];
    const luv: number[] = [];
    const li: number[] = [];
    for (let j = 0; j <= 1; j++)
      for (let i = 0; i < W; i++) {
        const [x, y, nx, ny] = per[i];
        lp.push(x + nx * (R + o0 - 10), y + ny * (R + o0 - 10), z0 - 120 + j * 120);
        luv.push(len[i], j);
      }
    // (none of it through the goals: the housings take that space)
    const inGoal = (i: number) => Math.abs(lp[i * 3]) < ARENA.GOAL_W + 300 && Math.abs(lp[i * 3 + 1]) > ARENA.Y && z0 - 120 < ARENA.GOAL_H + 120;
    for (let i = 0; i < W - 1; i++) if (!inGoal(i) && !inGoal(i + 1)) li.push(i, i + 1, i + W, i + 1, i + W + 1, i + W);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
    lg.setIndex(li);
    grp.add(new THREE.Mesh(lg, ledMaterial(uT)));
  }
  // under the stands: a dark concourse wall so nothing shows through the gaps
  const back: number[] = [];
  const bi: number[] = [];
  const W = per.length;
  for (let j = 0; j <= 1; j++)
    for (let i = 0; i < W; i++) {
      const [x, y, nx, ny] = per[i];
      back.push(x + nx * (R + backO), y + ny * (R + backO), j ? backZ : -200);
    }
  for (let i = 0; i < W - 1; i++) bi.push(i, i + 1, i + W, i + 1, i + W + 1, i + W);
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(back, 3));
  bg.setIndex(bi);
  bg.computeVertexNormals();
  const backM = new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 1, side: THREE.DoubleSide });
  grp.add(new THREE.Mesh(bg, backM));
  // the concourse floor between the glass and the first tier
  const floorM = new THREE.MeshStandardMaterial({ color: 0x090b10, roughness: 0.95 });
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(26000, 30000), floorM);
  fl.position.z = -6;
  grp.add(fl);
  grp.userData.theme = (day: number, concourse: number) => {
    backM.color.set(0x0b0d14).lerp(new THREE.Color(concourse), day);
    floorM.color.set(0x090b10).lerp(new THREE.Color(concourse).multiplyScalar(1.1), day);
  };
  return grp;
}

/** a scrolling LED board: original sponsor-free slogans */
function ledMaterial(uT: { value: number }): THREE.MeshBasicMaterial {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 64;
  const x = c.getContext('2d')!;
  x.fillStyle = '#05060a';
  x.fillRect(0, 0, c.width, c.height);
  const words = ['BOOSTBALL', 'SUPERSONIC', 'WHAT A SAVE!', 'NITRO LEAGUE', 'AERIAL', 'FLIP RESET', 'KICKOFF', 'CENTERING'];
  x.font = 'italic 900 40px "Titillium Web", Arial, sans-serif';
  x.textBaseline = 'middle';
  let px = 20;
  let k = 0;
  while (px < c.width) {
    const w = words[k % words.length];
    x.fillStyle = k % 3 === 0 ? '#2f8bff' : k % 3 === 1 ? '#ff8a2a' : '#e8f0ff';
    x.fillText(w, px, 34);
    px += x.measureText(w).width + 90;
    k++;
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(12, 1);
  t.anisotropy = 8;
  const m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.6, 1.6, 1.6) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv.x += uTime * 0.02;');
  };
  // UVs are in cm along the bowl: scale them into board widths
  m.map!.repeat.set(1 / 9000, 1);
  return m;
}

/** light rings over the stands and the beams they throw */
function lights(): THREE.Group {
  const g = new THREE.Group();
  const lampG = new THREE.BoxGeometry(260, 60, 120);
  const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9, 9.5) });
  const housingM = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6, metalness: 0.7 });
  const trussM = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5, metalness: 0.8 });
  const { p: per } = perimeter(0, 900);
  // a light shaft: brightest at the lamp, soft at the edges (facing ratio), gone by the pitch
  const beamM = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {},
    vertexShader: `varying float vT; varying vec3 vN; varying vec3 vV; void main(){ vT = uv.y; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vT; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(min(abs(dot(normalize(vN), normalize(vV))), 1.0), 2.0); float a = f * pow(clamp(vT, 0.0, 1.0), 2.5) * 0.035; gl_FragColor = vec4(vec3(0.85,0.9,1.0)*a, a); }`,
  });
  const lamps = new THREE.InstancedMesh(lampG, lampM, per.length);
  const housings = new THREE.InstancedMesh(new THREE.BoxGeometry(300, 90, 160), housingM, per.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const off = 6900;
  const dummy = new THREE.Object3D();
  const zL = 6400;
  for (let i = 0; i < per.length; i++) {
    const [x, y, nx, ny] = per[i];
    const px = x + nx * off;
    const py = y + ny * off;
    const dir = new THREE.Vector3(-px, -py, -zL).normalize();
    dummy.position.set(px, py, zL);
    dummy.up.set(0, 0, 1);
    dummy.lookAt(0, 0, 0);
    q.copy(dummy.quaternion);
    m4.compose(new THREE.Vector3(px, py, zL), q, new THREE.Vector3(1, 1, 1));
    lamps.setMatrixAt(i, m4);
    m4.compose(new THREE.Vector3(px + nx * 40, py + ny * 40, zL + 20), q, new THREE.Vector3(1, 1, 1));
    housings.setMatrixAt(i, m4);
    if (i % 3 === 0) {
      // a faint beam cone toward the pitch
      const L = Math.hypot(px, py, zL) * 0.75;
      const cone = new THREE.ConeGeometry(900, L, 24, 1, true);
      cone.translate(0, -L / 2, 0);
      const beam = new THREE.Mesh(cone, beamM);
      beam.position.set(px, py, zL);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      beam.renderOrder = 8;
      g.add(beam);
    }
  }
  g.add(lamps, housings);
  const beams = g.children.filter((c) => (c as THREE.Mesh).material === beamM);
  g.userData.theme = (t: TimeLook) => {
    lampM.color.setScalar(t.floods ? 9 - 5 * t.day : 1.6).b *= 1.05;
    for (const b of beams) b.visible = t.floods;
  };
  // the roof ring and its trusses
  const ringPts: number[] = [];
  for (const [x, y, nx, ny] of perimeter(0, 600).p) ringPts.push(x + nx * (off + 200), y + ny * (off + 200));
  for (let i = 0; i < ringPts.length / 2 - 1; i++) {
    const ax = ringPts[i * 2];
    const ay = ringPts[i * 2 + 1];
    const bx = ringPts[i * 2 + 2];
    const by = ringPts[i * 2 + 3];
    const L = Math.hypot(bx - ax, by - ay);
    for (const z of [zL + 160, zL + 520]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(L + 30, 40, 40), trussM);
      t.position.set((ax + bx) / 2, (ay + by) / 2, z);
      t.rotation.z = Math.atan2(by - ay, bx - ax);
      g.add(t);
    }
  }
  return g;
}

/** open-air floodlights: four masts at the corners, each with a bank of lamps aimed at the centre spot */
function masts(tall: number): THREE.Group {
  const g = new THREE.Group();
  const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9, 9.5) });
  const steelM = new THREE.MeshStandardMaterial({ color: 0x8a9099, roughness: 0.45, metalness: 0.8 });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.6, metalness: 0.7 });
  const beamM = new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: `varying float vT; varying vec3 vN; varying vec3 vV; void main(){ vT = uv.y; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `varying float vT; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(min(abs(dot(normalize(vN), normalize(vV))), 1.0), 2.0); float a = f * pow(clamp(vT, 0.0, 1.0), 2.5) * 0.04; gl_FragColor = vec4(vec3(0.85,0.9,1.0)*a, a); }`,
  });
  const beams: THREE.Mesh[] = [];
  const cx = ARENA.X + (tall > 6000 ? 6200 : 3400);
  const cy = ARENA.Y + (tall > 6000 ? 4200 : 2200);
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const x = sx * cx;
      const y = sy * cy;
      // a tapering lattice column (as a slim box) on a footing
      const col = new THREE.Mesh(new THREE.CylinderGeometry(70, 150, tall, 6), steelM);
      col.rotation.x = Math.PI / 2;
      col.position.set(x, y, tall / 2);
      g.add(col);
      // the head: a grid of lamps in a frame, tilted down at the centre
      const head = new THREE.Group();
      head.position.set(x, y, tall + 300);
      head.up.set(0, 0, 1);
      head.lookAt(0, 0, -tall * 0.4);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1500, 700, 80), darkM);
      frame.position.z = -50;
      head.add(frame);
      const lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(150, 110, 40), lampM, 32);
      const m4 = new THREE.Matrix4();
      let k = 0;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) lamps.setMatrixAt(k++, m4.makeTranslation(-610 + c * 175, -240 + r * 160, 10));
      head.add(lamps);
      g.add(head);
      const dir = new THREE.Vector3(-x, -y, -tall).normalize();
      const L = Math.hypot(x, y, tall) * 0.8;
      const cone = new THREE.ConeGeometry(1600, L, 24, 1, true);
      cone.translate(0, -L / 2, 0);
      const beam = new THREE.Mesh(cone, beamM);
      beam.position.set(x, y, tall + 300);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      beam.renderOrder = 8;
      beams.push(beam);
      g.add(beam);
    }
  g.userData.theme = (t: TimeLook) => {
    lampM.color.setScalar(t.floods ? 9 - 5 * t.day : 1.6).b *= 1.05;
    for (const b of beams) b.visible = t.floods;
  };
  return g;
}

/** the roof: a canopy ring over the upper tier, ribbed underneath, open over the pitch */
function roof(): THREE.Mesh {
  const { p: per } = perimeter(0, 400, 10);
  const rings: [number, number][] = [
    [5600, 6650],
    [6400, 6900],
    [8200, 7350],
    [9800, 7500],
  ];
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const W = per.length;
  let u = 0;
  const us = [0];
  for (let i = 1; i < W; i++) {
    u += Math.hypot(per[i][0] - per[i - 1][0], per[i][1] - per[i - 1][1]);
    us.push(u);
  }
  rings.forEach(([o, z], j) => {
    for (let i = 0; i < W; i++) {
      const [x, y, nx, ny] = per[i];
      pos.push(x + nx * (R + o), y + ny * (R + o), z);
      uv.push(us[i], j);
    }
  });
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < W - 1; i++) {
      const a = j * W + i;
      idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  simPatch(
    mat,
    /* glsl */ `
    float rib = smoothstep(0.88, 0.95, abs(fract(vBB.x / 900.0) - 0.5) * 2.0);
    float edge = 1.0 - smoothstep(0.0, 0.08, vBB.y);
    vec3 col = mix(vec3(0.05, 0.055, 0.065), uTrim, uDay);
    col *= 0.75 + 0.25 * rib;
    diffuseColor.rgb *= col;
    float tw = smoothstep(-3000.0, 3000.0, vSim.y);
    vec3 teamC = mix(vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}), vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)}), tw);
    vec3 bbEmit = teamC * edge * mix(2.0, 0.8, uDay) + col * 0.12 * uDay;
    `,
  );
  return new THREE.Mesh(g, mat);
}

/** the screens at each end, drawn from a canvas */
function screens(): { group: THREE.Group; draw: (s: [number, number], clock: string) => void } {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 384;
  const x = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const g = new THREE.Group();
  const scrM = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.5, 1.5, 1.5), fog: false });
  const frameM = new THREE.MeshStandardMaterial({ color: 0x15171d, roughness: 0.5, metalness: 0.8 });
  for (const s of [-1, 1]) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(4200, 1575), scrM);
    scr.rotation.x = Math.PI / 2;
    if (s < 0) scr.rotation.y = Math.PI;
    scr.position.set(0, s * (ARENA.Y + 5600), 5000);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(4400, 120, 1775), frameM);
    fr.position.set(0, s * (ARENA.Y + 5680), 5000);
    g.add(scr, fr);
  }
  let last = '';
  const draw = (sc: [number, number], clock: string) => {
    const key = `${sc[0]}-${sc[1]}-${clock}`;
    if (key === last) return;
    last = key;
    x.fillStyle = '#05070c';
    x.fillRect(0, 0, 1024, 384);
    const grd = x.createLinearGradient(0, 0, 1024, 0);
    grd.addColorStop(0, '#0d3ea8');
    grd.addColorStop(0.42, '#0a1530');
    grd.addColorStop(0.58, '#301606');
    grd.addColorStop(1, '#b8500c');
    x.fillStyle = grd;
    x.fillRect(0, 0, 1024, 384);
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = '#fff';
    x.font = 'italic 900 210px "Titillium Web", Arial, sans-serif';
    x.fillText(String(sc[0]), 170, 200);
    x.fillText(String(sc[1]), 854, 200);
    x.font = '700 120px "Titillium Web", Arial, sans-serif';
    x.fillText(clock, 512, 210);
    x.font = 'italic 900 40px "Titillium Web", Arial, sans-serif';
    x.fillStyle = 'rgba(255,255,255,0.7)';
    x.fillText('BOOSTBALL', 512, 70);
    tex.needsUpdate = true;
  };
  return { group: g, draw };
}

/** the centre logo on the pitch */
function centreLogo(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const x = c.getContext('2d')!;
  x.clearRect(0, 0, 1024, 1024);
  x.translate(512, 512);
  x.strokeStyle = 'rgba(235,245,255,0.75)';
  x.lineWidth = 16;
  x.beginPath();
  x.arc(0, 0, 330, 0, Math.PI * 2);
  x.stroke();
  x.font = 'italic 900 150px "Titillium Web", Arial, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = 'rgba(235,245,255,0.82)';
  x.fillText('BOOST', 0, -50);
  x.fillText('BALL', 0, 90);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1150, 1150), new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.8, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.06 }));
  m.position.z = 1.5;
  m.rotation.z = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

/** snow drifting down through the bowl (Frostpeak): points wrapped round a box over the pitch */
/** flags on poles round the rim of the bowl, waving over the top row in the two teams' colours
 * (gold and white over halfway), seen against the sky from every seat */
function flags(uT: { value: number }, count: 1 | 2): THREE.Group {
  const grp = new THREE.Group();
  const { p: per, len } = perimeter(0, 200, 12);
  const backO = count === 2 ? 7000 : 3800;
  const backZ = count === 2 ? 4700 : 2200;
  const pos: number[] = [];
  const col: number[] = [];
  const nrm: number[] = [];
  const fuv: number[] = [];
  const idx: number[] = [];
  const poles: THREE.BufferGeometry[] = [];
  const total = len[len.length - 1];
  const N = Math.round(total / (count === 2 ? 1500 : 1250));
  const FW = 820;
  const FH = 520;
  const top = backZ + 1500;
  let j = 0;
  for (let f = 0; f < N; f++) {
    const at = (f / N) * total;
    while (j < len.length - 2 && len[j + 1] < at) j++;
    const [x0, y0, nx, ny] = per[j];
    const x = x0 + nx * (R + backO + 60);
    const y = y0 + ny * (R + backO + 60);
    // the flag streams along the bowl
    const tx = -ny;
    const ty = nx;
    const c = Math.abs(y) < 1400 ? (f % 2 ? new THREE.Color(1.0, 0.78, 0.15) : new THREE.Color(0.95, 0.96, 1.0)) : y < 0 ? new THREE.Color(0.06, 0.32, 1.0) : new THREE.Color(1.0, 0.36, 0.04);
    const base = pos.length / 3;
    const SX = 10;
    const SZ = 5;
    for (let b = 0; b <= SZ; b++)
      for (let a = 0; a <= SX; a++) {
        const u = a / SX;
        const v = b / SZ;
        pos.push(x + tx * u * FW, y + ty * u * FW, top - FH + v * FH);
        col.push(c.r, c.g, c.b);
        nrm.push(nx, ny, 0);
        fuv.push(u, v, f);
      }
    for (let b = 0; b < SZ; b++)
      for (let a = 0; a < SX; a++) {
        const i = base + b * (SX + 1) + a;
        idx.push(i, i + 1, i + SX + 1, i + 1, i + SX + 2, i + SX + 1);
      }
    const pole = new THREE.CylinderGeometry(9, 14, top - backZ + 120, 6, 1).rotateX(Math.PI / 2).translate(x, y, (top + backZ) / 2 + 20);
    poles.push(pole.deleteAttribute('uv'));
    poles.push(new THREE.SphereGeometry(22, 8, 6).translate(x, y, top + 90).deleteAttribute('uv'));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('fuv', new THREE.Float32BufferAttribute(fuv, 3));
  g.setIndex(idx);
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = uT;
    Object.assign(sh.uniforms, { uDay });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uT;\nattribute vec3 fuv;\nvarying vec3 vF;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vF = fuv;
        // a wave running out from the pole, growing toward the free end
        float ph = fuv.z * 1.7;
        float wv = sin(uT * 5.5 + ph - fuv.x * 7.0) * 0.7 + sin(uT * 8.3 + ph * 1.3 - fuv.x * 11.0 + fuv.y * 2.0) * 0.3;
        transformed += normal * wv * fuv.x * 70.0;
        transformed.z -= fuv.x * fuv.x * 60.0;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDay;\nvarying vec3 vF;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // a white chevron and a hem along the edge
        float chev = 1.0 - smoothstep(0.06, 0.09, abs(abs(vF.y - 0.5) * 1.1 - (vF.x - 0.35)));
        float hem = step(vF.y, 0.07) + step(0.93, vF.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95), clamp(chev + hem, 0.0, 1.0) * 0.9);
        // (lit from the stadium at night: never dark against the sky)
        vec3 flagGlow = diffuseColor.rgb * mix(0.35, 0.08, uDay);`,
      )
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += flagGlow;');
  };
  m.customProgramCacheKey = () => 'bbflags';
  const fl = new THREE.Mesh(g, m);
  fl.castShadow = false;
  grp.add(fl);
  const pm = new THREE.Mesh(mergeGeometries(poles), new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.35, metalness: 0.85 }));
  grp.add(pm);
  return grp;
}

/** searchlights behind the stands sweeping the sky in the teams' colours and neon: they come up
 * with the evening and the excitement */
function searchlights(count: 1 | 2): { group: THREE.Group; update: (t: number, day: number, ex: number) => void } {
  const grp = new THREE.Group();
  const backO = count === 2 ? 7400 : 4200;
  const z = count === 2 ? 4900 : 2500;
  const geo = new THREE.CylinderGeometry(1500, 60, 40000, 24, 1, true).translate(0, 20000, 0).rotateX(Math.PI / 2);
  const cols = [new THREE.Color(0.2, 0.5, 1.6), new THREE.Color(1.6, 0.55, 0.12), new THREE.Color(1.3, 0.25, 1.2), new THREE.Color(0.25, 1.3, 1.4)];
  const beams: { m: THREE.Mesh; mat: THREE.ShaderMaterial; ph: number; base: THREE.Vector2 }[] = [];
  const pts: [number, number][] = [];
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.31;
    const ex = Math.cos(a) * (ARENA.X + R + backO);
    const ey = Math.sin(a) * (ARENA.Y + R + backO);
    pts.push([ex, ey]);
  }
  pts.forEach(([x, y], k) => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: { uC: { value: cols[(y < 0 ? 0 : 1) + (k % 3 === 2 ? 2 : 0)].clone() }, uK: { value: 0 } },
      vertexShader: `varying float vL; varying vec3 vN; varying vec3 vV; void main(){ vL = position.z / 40000.0; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uC; uniform float uK; varying float vL; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = (0.25 + f) * pow(1.0 - clamp(vL, 0.0, 1.0), 2.0) * uK; gl_FragColor = vec4(uC * a, a); }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.frustumCulled = false;
    m.renderOrder = 4;
    grp.add(m);
    // a lamp head
    const head = new THREE.Mesh(new THREE.CylinderGeometry(70, 90, 120, 12).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: (mat.uniforms.uC.value as THREE.Color).clone().multiplyScalar(2.5) }));
    head.position.set(x, y, z);
    grp.add(head);
    beams.push({ m, mat, ph: k * 1.7, base: new THREE.Vector2(x, y).normalize() });
  });
  const q = new THREE.Quaternion();
  const d = new THREE.Vector3();
  const up = new THREE.Vector3(0, 0, 1);
  return {
    group: grp,
    update(t, day, ex) {
      const k = (1 - Math.min(1, day * 1.15)) * 0.22 + ex * 0.14 + 0.01;
      for (const b of beams) {
        // lean out over the stands and sweep side to side, crossing overhead now and then
        const sw = Math.sin(t * 0.35 + b.ph) * 0.9;
        const lean = 0.62 + 0.22 * Math.sin(t * 0.23 + b.ph * 1.3);
        const ox = -(b.base.x * Math.cos(sw) - b.base.y * Math.sin(sw));
        const oy = -(b.base.x * Math.sin(sw) + b.base.y * Math.cos(sw));
        d.set(ox * Math.sin(lean), oy * Math.sin(lean), Math.cos(lean)).normalize();
        b.m.quaternion.copy(q.setFromUnitVectors(up, d));
        b.mat.uniforms.uK.value = k;
      }
    },
  };
}

function snowfall(uT: { value: number }): THREE.Points {
  const N = 7000;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 14000;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 17000;
    pos[i * 3 + 2] = Math.random() * 5200;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: uT, uDayS: uDay, uPx: { value: 1 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float seed;
      uniform float uTime; uniform float uPx;
      varying float vA;
      void main(){
        vec3 p = position;
        float fall = 70.0 + seed * 60.0;
        p.z = mod(p.z - uTime * fall, 5200.0);
        p.x += sin(uTime * (0.4 + seed * 0.5) + seed * 40.0) * 120.0 + uTime * 25.0;
        p.y += cos(uTime * (0.3 + seed * 0.4) + seed * 17.0) * 90.0;
        p.x = mod(p.x + 7000.0, 14000.0) - 7000.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp((0.09 + seed * 0.09) * 650.0 * uPx / -mv.z, 0.8, 7.0);
        // fade in from the top, out at the floor and very near the lens
        vA = smoothstep(0.0, 300.0, p.z) * (1.0 - smoothstep(4400.0, 5200.0, p.z)) * smoothstep(0.6, 3.0, -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDayS;
      varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = (1.0 - smoothstep(0.15, 0.5, d)) * vA * 0.7;
        gl_FragColor = vec4(vec3(mix(0.7, 1.0, uDayS)), a);
      }`,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return pts;
}

export function buildArena(): ArenaView {
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(0.01);
  const uT = { value: 0 };
  const uEx = { value: 0 };
  root.add(pitch());
  const turf = grass();
  root.add(turf.group);
  root.add(centreLogo());
  const sh = shell();
  root.add(sh);
  root.add(goal(-1, BLUE), goal(1, ORANGE));
  const pd = pads();
  root.add(pd.group);
  // the dressing that changes with the arena: built on first use, then only shown or hidden
  const standsBy = new Map<number, THREE.Group>();
  const lightsBy = new Map<string, THREE.Group>();
  const surroundBy = new Map<MapId, SurroundView | null>();
  const specBy = new Map<MapId, Spectacle | null>();
  const rf = roof();
  root.add(rf);
  const scr = screens();
  root.add(scr.group);
  const shellT = sh.userData.uT as { value: number };
  const snow = snowfall(uT);
  snow.visible = false;
  root.add(snow);
  let curMap: MapLook = MAPS.apex;
  let curTime: TimeLook = TIMES.day;
  const view: ArenaView = {
    root,
    setDay(day) {
      view.setLook(day ? TIMES.day : TIMES.night, curMap);
    },
    setQuality(q) {
      turf.setQuality(q);
    },
    setLook(t, map) {
      curMap = map;
      turf.setOn(map.theme.pattern < 3.5);
      curTime = t;
      uDay.value = t.day;
      const th = map.theme;
      TH.uPitchA.value.setRGB(...th.pitchA);
      TH.uPitchB.value.setRGB(...th.pitchB);
      TH.uPattern.value = th.pattern;
      TH.uLine.value.setRGB(...th.line);
      TH.uLineGlow.value = th.lineGlow;
      TH.uWall.value.setRGB(...th.wall);
      TH.uGlass.value.setRGB(...th.glass);
      TH.uSeat.value.setRGB(...th.seat);
      TH.uFrost.value = th.frost;
      TH.uTrim.value.setRGB(...th.trim);
      TH.uCaus.value = map.surround === 'ocean' ? (t.day > 0.25 ? 0.5 + 0.5 * t.day : 0.12) : 0;
      houseM.color.setRGB(...th.trim).multiplyScalar(0.05 + 0.07 * t.day);
      for (const [n, g] of standsBy) g.visible = n === map.tiers;
      let st = standsBy.get(map.tiers);
      if (!st) {
        st = stands(uT, uEx, map.tiers);
        st.add(flags(uT, map.tiers));
        const sl = searchlights(map.tiers);
        st.add(sl.group);
        st.userData.search = sl.update;
        standsBy.set(map.tiers, st);
        root.add(st);
      }
      st.userData.theme(t.day, map.concourse);
      const lk = map.lights === 'ring' ? 'ring' : 'masts' + map.tiers;
      for (const [k, g] of lightsBy) g.visible = k === lk;
      let li = lightsBy.get(lk);
      if (!li) {
        li = map.lights === 'ring' ? lights() : masts(map.tiers === 2 ? 7600 : 4600);
        lightsBy.set(lk, li);
        root.add(li);
      }
      li.userData.theme(t);
      rf.visible = map.roof;
      snow.visible = map.theme.frost > 0.5;
      for (const [id, sv] of surroundBy) if (sv) sv.group.visible = id === map.id;
      if (!surroundBy.has(map.id)) {
        const sv = buildSurround(map);
        surroundBy.set(map.id, sv);
        if (sv) root.add(sv.group);
      }
      surroundBy.get(map.id)?.setLook(t, t.keyDir);
      for (const [id, sp] of specBy) if (sp) sp.group.visible = id === map.id;
      if (!specBy.has(map.id)) {
        const sp = buildSpectacle(map);
        specBy.set(map.id, sp);
        if (sp) root.add(sp.group);
      }
    },
    update(t, padT, excite, score, clock) {
      uT.value = t;
      TH.uClock.value = t;
      surroundBy.get(curMap.id)?.update?.(t);
      specBy.get(curMap.id)?.update(t, curTime.day);
      standsBy.get(curMap.tiers)?.userData.search?.(t, curTime.day, excite);
      shellT.value = t;
      uEx.value = excite;
      scr.draw(score, clock);
      for (const m of pd.group.userData.anim as THREE.ShaderMaterial[]) m.uniforms.uT.value = t;
      const sl = pd.sparkLive.array as Float32Array;
      const seeds = (pd.sparks.geometry.attributes.seed as THREE.BufferAttribute).array as Float32Array;
      for (let k = 0; k < pd.items.length; k++) {
        const it = pd.items[k];
        const live = padT[k] <= 0;
        // (a big pad takes 10 s to come back, a small one 4)
        const k01 = live ? 1 : 1 - Math.min(1, padT[k] / (it.big ? 10 : 4));
        it.disc.uniforms.uT.value = t + k * 0.37;
        it.disc.uniforms.uLive.value = live ? 1 : 0;
        it.disc.uniforms.uK.value = k01;
        it.rim.color.copy(PAD_HOT).multiplyScalar(live ? 2.6 + 0.6 * Math.sin(t * 4 + k) : 0.35);
        if (it.orb) {
          it.orb.visible = live;
          it.orb.position.z = 120 + Math.sin(t * 2.2 + k) * 10;
          it.orb.rotation.z = t * 0.8;
        }
        if (it.puck) {
          it.puck.visible = live;
          it.puck.position.z = 24 + Math.sin(t * 3 + k) * 3;
          it.puck.rotation.z = t * 1.5;
        }
      }
      for (let i = 0; i < sl.length; i++) sl[i] = padT[seeds[i * 3 + 2]] <= 0 ? 1 : 0;
      pd.sparkLive.needsUpdate = true;
    },
  };
  view.setLook(curTime, curMap);
  return view;
}
