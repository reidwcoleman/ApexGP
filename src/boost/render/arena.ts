import * as THREE from 'three';
import { ARENA, PADS } from '../sim/arena.ts';
import { MAPS, TIMES, type MapId, type MapLook, type TimeLook } from './looks.ts';
import { buildSurround, type SurroundView } from './surround.ts';

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
/** the arena's grass colour (multiplies the pitch) */
const uGrassTint = { value: new THREE.Color(1, 1, 1) };
/** the ball (0) and up to 8 cars, in sim cm (w = 1 for the ball): the wall's hex panels light up around them */
export const uNear = { value: Array.from({ length: 9 }, () => new THREE.Vector4(0, 0, -9999, 0)) };

const GLSL_COMMON = /* glsl */ `
uniform float uDay;
uniform vec3 uGrassTint;
float bbHash(vec2 p){ p = fract(p*vec2(233.34,851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }
float bbNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(bbHash(i), bbHash(i+vec2(1,0)), u.x), mix(bbHash(i+vec2(0,1)), bbHash(i+vec2(1,1)), u.x), u.y); }
// distance to the nearest edge of a hexagon grid cell (0 at the edges)
float bbHex(vec2 p){ p = abs(p); vec2 q = vec2(p.x*1.1547, p.y + p.x*0.57735);
  vec2 pi = floor(q), pf = fract(q); float v = mod(pi.x + pi.y, 3.0);
  float ca = step(1., v), cb = step(2., v); vec2 ma = step(pf.xy, pf.yx);
  float e = dot(ma, 1.0 - pf.yx + ca*(pf.x+pf.y-1.0) + cb*(pf.yx-2.0*pf.xy));
  return e; }
float bbHexEdge(vec2 p){ vec2 s = vec2(1.0, 1.7320508); vec2 a = mod(p, s) - s*0.5; vec2 b = mod(p - s*0.5, s) - s*0.5;
  vec2 g = dot(a,a) < dot(b,b) ? a : b; g = abs(g); return 0.5 - max(dot(g, normalize(s)), g.x); }
`;

/** shader hooks onto a standard material: vSim = the vertex in simulation coordinates */
function simPatch(mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial, frag: string, uniforms: Record<string, THREE.IUniform> = {}, decl = ''): void {
  // (every patch shares this closure's source, which is three's default program key)
  const key = 'bb' + hashStr(frag + decl);
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, { uDay, uGrassTint });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSim;\nvarying vec2 vBB;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSim = position;\nvBB = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSim;\nvarying vec2 vBB;\n' + GLSL_COMMON + decl)
      .replace('#include <map_fragment>', frag)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += bbEmit;');
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
  update(t: number, pads: Float32Array, excite: number, score: [number, number], clock: string): void;
}

/** the shrunk octagon as a loop of (x, y, nx, ny) samples with fanned corners; len = arc length at the wall */
function perimeter(offset: number, step: number, fan = 4): { p: number[][]; len: number[] } {
  const sx = ARENA.X - R;
  const sy = ARENA.Y - R;
  const sc = ARENA.CORNER - R * Math.SQRT2;
  // counter-clockwise, so the outward normal of edge a→b is (ey, −ex)
  const V: [number, number][] = [
    [sx, -(sc - sx)],
    [sx, sc - sx],
    [sc - sy, sy],
    [-(sc - sy), sy],
    [-sx, sc - sx],
    [-sx, -(sc - sx)],
    [-(sc - sy), -sy],
    [sc - sy, -sy],
  ];
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
    for (let k = 1; k < fan; k++) pts.push([a[0], a[1], Math.cos(a0 + (d * k) / fan), Math.sin(a0 + (d * k) / fan)]);
    const n = Math.max(2, Math.ceil(L / step));
    for (let k = 0; k < n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, nx, ny]);
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

const GOAL_CUT = /* glsl */ `
  if (abs(vSim.x) < ${ARENA.GOAL_W.toFixed(1)} && vSim.z < ${ARENA.GOAL_H.toFixed(1)} && abs(vSim.y) > ${(ARENA.Y - R - 25).toFixed(1)}) discard;
`;

function pitch(): THREE.Mesh {
  const g = new THREE.PlaneGeometry(ARENA.X * 2, (ARENA.Y + ARENA.GOAL_D) * 2, 8, 10);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  simPatch(
    mat,
    /* glsl */ `
    vec2 P = vSim.xy;
    // outside the octagon and not in a goal: nothing (the ramps cover the edge)
    float oct = max(max(abs(P.x) - ${ARENA.X.toFixed(1)}, abs(P.y) - ${ARENA.Y.toFixed(1)}), (abs(P.x)+abs(P.y) - ${ARENA.CORNER.toFixed(1)})*0.7071);
    bool inGoal = abs(P.x) < ${ARENA.GOAL_W.toFixed(1)} && abs(P.y) < ${(ARENA.Y + ARENA.GOAL_D).toFixed(1)};
    if (oct > 0.0 && !inGoal) discard;
    float side = sign(P.y);
    vec3 team = side < 0.0 ? vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}) : vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)});
    // grass: mown bands, mottling, blade grain
    float band = step(0.5, fract(P.y / 1024.0 + 0.25));
    float diag = step(0.5, fract((P.x + P.y) / 2048.0));
    vec3 g1 = mix(vec3(0.105, 0.255, 0.075), vec3(0.1, 0.29, 0.04), uDay), g2 = mix(vec3(0.085, 0.215, 0.06), vec3(0.07, 0.215, 0.03), uDay);
    vec3 col = mix(g1, g2, band);
    col *= 0.94 + 0.06 * diag;
    float n = bbNoise(P * 0.012) * 0.5 + bbNoise(P * 0.045) * 0.3 + bbNoise(P * 0.21) * 0.2;
    col *= 0.82 + 0.36 * n;
    // blade-scale grain up close, faded out before it can shimmer
    float fw = fwidth(P.y) + fwidth(P.x);
    col *= 1.0 + (bbNoise(P * 2.7) - 0.5) * 0.22 * (1.0 - smoothstep(1.5, 5.0, fw));
    col *= 0.94 + 0.12 * bbNoise(P * 0.9);
    col *= uGrassTint;
    // a wash of team colour toward each end
    col = mix(col, col * (0.55 + team * 0.9), smoothstep(800.0, 5000.0, abs(P.y)) * 0.55);
    // lines
    float aa = fwidth(P.x) * 1.5 + 1.0;
    float lw = 22.0;
    float L = 0.0;
    L = max(L, 1.0 - smoothstep(lw - aa, lw + aa, abs(P.y)));
    float r = length(P);
    L = max(L, 1.0 - smoothstep(lw - aa, lw + aa, abs(r - 1100.0)));
    L = max(L, 1.0 - smoothstep(60.0 - aa, 60.0 + aa, r));
    // goal boxes
    vec2 gb = vec2(abs(P.x), ${ARENA.Y.toFixed(1)} - abs(P.y));
    float box = max(gb.x - 1800.0, gb.y - 1150.0);
    L = max(L, (1.0 - smoothstep(lw - aa, lw + aa, abs(box))) * step(0.0, gb.y));
    // the arc in front of each box
    float arc = abs(length(vec2(P.x, abs(P.y) - (${ARENA.Y.toFixed(1)} - 1150.0))) - 900.0);
    L = max(L, (1.0 - smoothstep(lw - aa, lw + aa, arc)) * step(abs(P.y), ${ARENA.Y.toFixed(1)} - 1150.0));
    // the boundary where the ramp starts
    float edge = abs(oct + ${R.toFixed(1)});
    float bnd = 1.0 - smoothstep(lw - aa, lw + aa, edge);
    // the goal line
    float gl = (1.0 - smoothstep(30.0 - aa, 30.0 + aa, abs(abs(P.y) - ${ARENA.Y.toFixed(1)}))) * step(abs(P.x), ${ARENA.GOAL_W.toFixed(1)});
    vec3 lineC = vec3(0.92, 0.95, 1.0);
    col = mix(col, lineC, L * 0.85);
    col = mix(col, team * 1.2, bnd);
    // inside the goals: a dark glossy floor with team light
    float gIn = step(${ARENA.Y.toFixed(1)}, abs(P.y)) * step(abs(P.x), ${ARENA.GOAL_W.toFixed(1)});
    float hex = bbHexEdge(P / 140.0);
    col = mix(col, vec3(0.03, 0.035, 0.05) + team * 0.06 * (1.0 - smoothstep(0.0, 0.06, hex)), gIn);
    diffuseColor.rgb *= col;
    float glowK = mix(1.0, 0.45, uDay);
    vec3 bbEmit = lineC * L * mix(0.09, 0.03, uDay) + team * glowK * (bnd * 1.6 + gl * 2.4 + gIn * (1.0 - smoothstep(0.0, 0.05, hex)) * 0.5);
    `,
  );
  mat.roughness = 0.85;
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
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
    vec3 col = mix(vec3(0.075, 0.12, 0.07), vec3(0.06, 0.065, 0.08), smoothstep(40.0, 260.0, z));
    col *= 0.85 + 0.3 * n;
    col *= 0.85 + 0.15 * smoothstep(0.0, 0.08, hex);
    col *= mix(1.0, 2.4, uDay);
    diffuseColor.rgb *= col;
    float stripe = smoothstep(14.0, 0.0, abs(z - 330.0)) ;
    float seam = 1.0 - smoothstep(0.0, 0.05, hex);
    vec3 bbEmit = teamMix * (stripe * mix(2.2, 1.3, uDay) + seam * 0.08 * smoothstep(80.0, 300.0, z) * (1.0 - uDay));
    `,
  );
  const low = new THREE.Mesh(shellGeometry(0, 345), lowMat);
  low.receiveShadow = true;
  grp.add(low);
  // the glass: hex panels that glow, fading as they go up
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4 });
  simPatch(
    glassMat,
    /* glsl */ `
    ${GOAL_CUT}
    float tw = smoothstep(-3000.0, 3000.0, vSim.y);
    vec3 team = mix(vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}), vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)}), tw);
    float z = vSim.z;
    vec2 q = vec2(vBB.x, z) / 260.0;
    float hex = bbHexEdge(q);
    float edge = 1.0 - smoothstep(0.0, 0.035, hex);
    float fade = 1.0 - smoothstep(500.0, 2300.0, z);
    float pulse = 0.5 + 0.5 * sin(uTime * 1.3 + vBB.x * 0.002 - z * 0.003);
    // the panels light up where the ball or a car comes near (driving on the wall, a ball off it)
    float near = 0.0;
    for (int i = 0; i < 9; i++) {
      float d = distance(vSim, uNear[i].xyz);
      float r = uNear[i].w > 0.5 ? 620.0 : 430.0;
      near = max(near, (1.0 - smoothstep(0.0, r, d)) * (uNear[i].w > 0.5 ? 1.0 : 0.8));
    }
    float rim = 1.0 - smoothstep(0.0, 0.09, hex);
    diffuseColor.rgb = mix(vec3(0.5, 0.6, 0.75), team, 0.4);
    diffuseColor.a = 0.03 + uDay * 0.015 + edge * (0.2 * fade + 0.025) + near * (0.1 + rim * 0.55);
    vec3 bbEmit = (team * edge * (0.7 * fade + 0.12) * (0.75 + 0.25 * pulse) + team * 0.03 * fade) * mix(1.0, 0.4, uDay)
      + mix(team, vec3(0.9, 0.95, 1.0), 0.35) * near * (rim * 1.6 + 0.12);
    `,
    { uTime: uT, uNear },
    'uniform float uTime;\nuniform vec4 uNear[9];',
  );
  const glass = new THREE.Mesh(shellGeometry(345, ARENA.Z + 1), glassMat);
  glass.renderOrder = 5;
  grp.add(glass);
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
  // the frame: squared beams flush with the back wall, light grey, a team light strip on the inside
  const frameM = new THREE.MeshStandardMaterial({ color: 0xd9dde4, roughness: 0.3, metalness: 0.55 });
  const strip = new THREE.MeshBasicMaterial({ color: team.clone().multiplyScalar(3.4) });
  const T = 36;
  const beam = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material = frameM) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = m === frameM;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  for (const sx of [-1, 1]) {
    beam(T, T, H + T, sx * (W + T / 2), Y + sideSign * (T / 2 - 4), (H + T) / 2);
    beam(5, 6, H, sx * (W - 1), Y + sideSign * 4, H / 2, strip);
  }
  beam(W * 2 + T * 2, T, T, 0, Y + sideSign * (T / 2 - 4), H + T / 2);
  beam(W * 2, 6, 5, 0, Y + sideSign * 4, H - 1, strip);
  // inside: solid dark panels carrying the net (sides, roof and back), lit by the team light
  const netM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });
  simPatch(
    netM,
    /* glsl */ `
    bool sideWall = abs(vSim.x) > ${(W - 2).toFixed(1)};
    bool roof = vSim.z > ${(H - 2).toFixed(1)};
    vec2 q = (sideWall ? vSim.yz : (roof ? vSim.xy : vSim.xz)) / 30.0;
    float e = 1.0 - smoothstep(0.0, 0.08, bbHexEdge(q));
    // panel joints every 2 m, the net a little proud of them
    vec2 pq = (sideWall ? vSim.yz : (roof ? vSim.xy : vSim.xz)) / 220.0;
    float joint = 1.0 - smoothstep(0.0, 0.02, min(abs(fract(pq.x) - 0.5), abs(fract(pq.y) - 0.5)) - 0.47);
    vec3 base = vec3(0.045, 0.05, 0.065) * (1.0 - joint * 0.5);
    // brighter toward the mouth, darker at the back
    float depth = clamp((abs(vSim.y) - ${ARENA.Y.toFixed(1)}) / ${D.toFixed(1)}, 0.0, 1.0);
    diffuseColor.rgb = mix(base, vec3(0.6), e * 0.3);
    vec3 tc = vec3(${team.r.toFixed(3)}, ${team.g.toFixed(3)}, ${team.b.toFixed(3)});
    vec3 bbEmit = tc * (e * (0.16 - depth * 0.08) + 0.025);
    `,
  );
  const panel = (w: number, h: number, pos: THREE.Vector3, rot: THREE.Euler) => {
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(rot.x).rotateY(rot.y).rotateZ(rot.z);
    geo.translate(pos.x, pos.y, pos.z);
    const m = new THREE.Mesh(geo, netM);
    m.receiveShadow = true;
    g.add(m);
  };
  panel(W * 2, H, new THREE.Vector3(0, by, H / 2), new THREE.Euler(Math.PI / 2, 0, 0));
  panel(D, H, new THREE.Vector3(-W, Y + (sideSign * D) / 2, H / 2), new THREE.Euler(Math.PI / 2, Math.PI / 2, 0));
  panel(D, H, new THREE.Vector3(W, Y + (sideSign * D) / 2, H / 2), new THREE.Euler(Math.PI / 2, Math.PI / 2, 0));
  panel(W * 2, D, new THREE.Vector3(0, Y + (sideSign * D) / 2, H), new THREE.Euler(0, 0, 0));
  // glowing edges along the back of the box
  const edge = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => beam(sx, sy, sz, x, y, z, strip);
  edge(W * 2, 6, 6, 0, by - sideSign * 3, 3);
  edge(W * 2, 6, 6, 0, by - sideSign * 3, H - 3);
  for (const sx of [-1, 1]) {
    edge(6, 6, H, sx * (W - 3), by - sideSign * 3, H / 2);
    edge(6, D, 6, sx * (W - 3), Y + (sideSign * D) / 2, H - 3);
  }
  // the housing round the box: dark structure, so nothing behind (the seats) shows into the goal
  const houseM = new THREE.MeshStandardMaterial({ color: 0x0c0e13, roughness: 0.8, metalness: 0.2 });
  // (outer slabs only: behind the back, outside the sides, over the roof; the mouth stays open)
  const slab = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), houseM);
    m.position.set(x, y, z);
    g.add(m);
  };
  const ym = Y + sideSign * (D / 2 + 20);
  // (each set 4 back from the panel it covers, so they never fight over the same depth)
  slab(W * 2 + 120, 60, H + 60, 0, by + sideSign * 34, (H + 60) / 2 - 2);
  for (const sx of [-1, 1]) slab(60, D + 20, H + 60, sx * (W + 34), ym, (H + 60) / 2 - 2);
  slab(W * 2 + 120, D + 20, 60, 0, ym, H + 34);
  // the inner glow light
  const pl = new THREE.PointLight(team, 6, 14, 2);
  pl.position.set(0, Y + sideSign * (D - 200), H * 0.6);
  g.add(pl);
  return g;
}

interface PadMesh {
  base: THREE.Mesh;
  orb: THREE.Mesh | null;
  glow: THREE.Mesh;
  big: boolean;
}

function pads(): { group: THREE.Group; items: PadMesh[] } {
  const group = new THREE.Group();
  const items: PadMesh[] = [];
  const baseBig = new THREE.CylinderGeometry(150, 170, 14, 40);
  baseBig.rotateX(Math.PI / 2);
  const baseSmall = new THREE.CylinderGeometry(95, 110, 8, 32);
  baseSmall.rotateX(Math.PI / 2);
  const baseM = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.35, metalness: 0.7 });
  const ringBig = new THREE.RingGeometry(110, 140, 48);
  const ringSmall = new THREE.RingGeometry(55, 78, 40);
  const orbG = new THREE.IcosahedronGeometry(62, 3);
  for (const p of PADS) {
    const base = new THREE.Mesh(p.big ? baseBig : baseSmall, baseM);
    base.position.set(p.x, p.y, p.big ? 4 : 2);
    base.receiveShadow = true;
    group.add(base);
    const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.12).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const glow = new THREE.Mesh(p.big ? ringBig : ringSmall, glowM);
    glow.position.set(p.x, p.y, p.big ? 12 : 7);
    group.add(glow);
    let orb: THREE.Mesh | null = null;
    if (p.big) {
      orb = new THREE.Mesh(
        orbG,
        new THREE.MeshStandardMaterial({ color: 0xffb030, emissive: new THREE.Color(1.0, 0.55, 0.1), emissiveIntensity: 3.2, roughness: 0.2, transparent: true, opacity: 0.92 }),
      );
      orb.position.set(p.x, p.y, 120);
      group.add(orb);
    }
    items.push({ base, orb, glow, big: p.big });
  }
  return { group, items };
}

/** stands rising behind the glass: rows of fans drawn in a shader, with a bounce on goals */
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
    // u along the bowl, v up the slope (in rows)
    float rowH = 85.0;
    float row = floor(vBB.y / rowH);
    float seatW = 62.0;
    // alternate rows sit half a seat over
    float sx = vBB.x / seatW + mod(row, 2.0) * 0.5;
    float seat = floor(sx);
    vec2 f = vec2(fract(sx), fract(vBB.y / rowH));
    float h = bbHash(vec2(seat, row));
    float h2 = bbHash(vec2(seat * 1.7 + 3.1, row * 0.9 + 7.0));
    float occupied = step(0.1, h);
    float bob = uExcite * max(0.0, sin(uTime * (7.0 + h2 * 5.0) + h * 30.0)) * 0.3 + 0.03 * sin(uTime * 2.0 + h * 40.0);
    float body = smoothstep(0.34, 0.26, abs(f.x - 0.5)) * step(f.y, 0.5 + bob) * step(0.08, f.y);
    float head = smoothstep(0.2, 0.14, length((f - vec2(0.5, 0.66 + bob)) * vec2(1.0, 1.2)));
    float person = max(body, head) * occupied;
    // each half of the bowl in its team's colour, split at halfway
    float tw = smoothstep(-250.0, 250.0, vSim.y);
    vec3 teamC = mix(vec3(${BLUE.r.toFixed(3)}, ${BLUE.g.toFixed(3)}, ${BLUE.b.toFixed(3)}), vec3(${ORANGE.r.toFixed(3)}, ${ORANGE.g.toFixed(3)}, ${ORANGE.b.toFixed(3)}), tw);
    vec3 shirt = h2 < 0.38 ? teamC * 0.75 : (h2 < 0.58 ? vec3(0.62) : (h2 < 0.8 ? vec3(0.06) : vec3(fract(h2 * 7.3), fract(h2 * 3.1), fract(h2 * 5.7)) * 0.5));
    vec3 skin = mix(vec3(0.85, 0.62, 0.48), vec3(0.3, 0.19, 0.13), fract(h * 13.0));
    vec3 seatC = mix(vec3(0.05, 0.055, 0.07) + teamC * 0.06, vec3(0.07, 0.075, 0.09) + teamC * 0.07, uDay);
    // the riser: each row's front edge in shadow
    seatC *= 0.55 + 0.45 * smoothstep(0.0, 0.2, f.y);
    vec3 col = mix(seatC, head > body ? skin : shirt, person);
    // far away the seats are under a pixel: blend to the average instead of shimmering
    float px = max(fwidth(sx), fwidth(vBB.y / rowH));
    // (the average of a crowd: shirts, faces and seats; denser and sparser blocks, a sea of team colour)
    vec3 crowdAvg = mix(vec3(0.13, 0.13, 0.14), teamC * 0.55, 0.28);
    float dens = 0.7 + 0.6 * bbNoise(vBB / vec2(420.0, 260.0)) + 0.25 * (bbNoise(vBB / vec2(90.0, 120.0)) - 0.5);
    vec3 avg = mix(seatC, crowdAvg * dens, 0.7);
    col = mix(col, avg, smoothstep(0.25, 0.7, px));
    // a walkway every dozen rows, and the risers' shadow lines as the rows go
    float walk = step(fract(vBB.y / (rowH * 12.0)), 1.0 / 12.0);
    col = mix(col, vec3(0.03, 0.032, 0.04), walk * 0.7);
    col *= 0.9 + 0.1 * smoothstep(0.0, 0.25, fract(vBB.y / rowH)) * (1.0 - smoothstep(0.6, 1.2, px));
    // in the sun the crowd is a shade darker than its lit seats read; the roof shades the upper rows
    col *= mix(1.0, 0.62, uDay) * (1.0 - uDay * 0.45 * smoothstep(2300.0, 4300.0, vSim.z));
    float aisle = step(fract(vBB.x / 1500.0), 0.035);
    col = mix(col, vec3(0.035), aisle);
    diffuseColor.rgb *= col;
    // phone lights and camera flashes
    float flash = step(0.9993, bbHash(vec2(seat, row) + floor(uTime * 5.0) * 0.37)) * occupied * (1.0 - smoothstep(0.5, 1.5, px)) * (1.0 - uDay);
    vec3 bbEmit = vec3(1.0) * flash * 2.5 + col * 0.12 * (1.0 - uDay);
    `,
    { uTime: uT, uExcite: uEx },
    'uniform float uTime; uniform float uExcite;',
  );
  for (const [o0, z0, o1, z1] of tiers) {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const W = per.length;
    const slope = Math.hypot(o1 - o0, z1 - z0);
    // u: arc length along the middle of the tier, so seats keep their size round the corners
    const om = (o0 + o1) / 2;
    const us = [0];
    for (let i = 1; i < W; i++) {
      const [ax, ay, anx, any] = per[i - 1];
      const [bx, by, bnx, bny] = per[i];
      us.push(us[i - 1] + Math.hypot(bx + bnx * (R + om) - ax - anx * (R + om), by + bny * (R + om) - ay - any * (R + om)));
    }
    for (let j = 0; j <= 1; j++) {
      const o = j ? o1 : o0;
      const z = j ? z1 : z0;
      for (let i = 0; i < W; i++) {
        const [x, y, nx, ny] = per[i];
        pos.push(x + nx * (R + o), y + ny * (R + o), z);
        uv.push(us[i], j * slope);
      }
    }
    for (let i = 0; i < W - 1; i++) idx.push(i, i + W, i + 1, i + 1, i + W, i + W + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
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
    for (let i = 0; i < W - 1; i++) li.push(i, i + 1, i + W, i + 1, i + W + 1, i + W);
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
    vec3 col = mix(vec3(0.05, 0.055, 0.065), vec3(0.75, 0.77, 0.8), uDay);
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

export function buildArena(): ArenaView {
  const root = new THREE.Group();
  root.rotation.x = -Math.PI / 2;
  root.scale.setScalar(0.01);
  const uT = { value: 0 };
  const uEx = { value: 0 };
  root.add(pitch());
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
  const rf = roof();
  root.add(rf);
  const scr = screens();
  root.add(scr.group);
  const shellT = sh.userData.uT as { value: number };
  let curMap: MapLook = MAPS.apex;
  let curTime: TimeLook = TIMES.day;
  const view: ArenaView = {
    root,
    setDay(day) {
      view.setLook(day ? TIMES.day : TIMES.night, curMap);
    },
    setLook(t, map) {
      curMap = map;
      curTime = t;
      uDay.value = t.day;
      uGrassTint.value.setRGB(...map.grass);
      for (const [n, g] of standsBy) g.visible = n === map.tiers;
      let st = standsBy.get(map.tiers);
      if (!st) {
        st = stands(uT, uEx, map.tiers);
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
      for (const [id, sv] of surroundBy) if (sv) sv.group.visible = id === map.id;
      if (!surroundBy.has(map.id)) {
        const sv = buildSurround(map);
        surroundBy.set(map.id, sv);
        if (sv) root.add(sv.group);
      }
      surroundBy.get(map.id)?.setLook(t, t.keyDir);
    },
    update(t, padT, excite, score, clock) {
      uT.value = t;
      shellT.value = t;
      uEx.value = excite;
      scr.draw(score, clock);
      for (let k = 0; k < pd.items.length; k++) {
        const it = pd.items[k];
        const live = padT[k] <= 0;
        if (it.orb) {
          it.orb.visible = live;
          it.orb.position.z = 120 + Math.sin(t * 2.2 + k) * 12;
          it.orb.rotation.z = t * 0.8;
        }
        const gm = it.glow.material as THREE.MeshBasicMaterial;
        gm.opacity = live ? 0.85 + 0.15 * Math.sin(t * 4 + k) : 0.12;
      }
    },
  };
  view.setLook(curTime, curMap);
  return view;
}
