import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import type { Course } from './courses.ts';
import { KartTrack, KERB } from './kart-track.ts';
import { BEAN_BAY, BEAN_PADS } from './kart-layout.ts';
import { RACE, type Racer } from './kart-race.ts';
import { dressScenery, type Land } from './kart-scenery.ts';

/**
 * Bean Bay GP: the circuit, on an island that's been shaped round it. Everything solid here is the
 * ribbon in kart-track.ts, so this file only has to make it look right: the road (a shader paints
 * the rubbered-in racing line, the lines, the grid and the chequers), kerbs, mown run-off, barriers,
 * the bridge, the tunnel and the land. The stands and the funfair are in kart-scenery.ts.
 */

export interface KartArena {
  center: THREE.Vector3;
  /** the grid, for the camera on the way in */
  gridAt: THREE.Vector3;
  track: KartTrack;
  racer(id: number): Racer | undefined;
  all(): Racer[];
  /** set by the race */
  bind(all: Racer[]): void;
  /** the gantry: this many reds on (0..5), or the green */
  lights(n: number, green: boolean): void;
  /** the land's height at a spot */
  land: Land;
}

const V = new THREE.Vector3();

/** a surface swept along the ribbon: `cols` gives (lat, up) across it at each sample */
export function sweep(tr: KartTrack, a: number, b: number, step: number, cols: (i: number) => [number, number][], uv?: (i: number, k: number, s: number) => [number, number]) {
  const rows: number[] = [];
  for (let s = a; s < b; s += step) rows.push(s);
  rows.push(b);
  const nc = cols(tr.idx(a)).length;
  const pos = new Float32Array(rows.length * nc * 3), uvs = new Float32Array(rows.length * nc * 2);
  rows.forEach((s, r) => {
    const i = tr.idx(Math.round(s)), c = cols(i);
    for (let k = 0; k < nc; k++) {
      tr.point(s, c[k][0], c[k][1], V);
      pos.set([V.x, V.y, V.z], (r * nc + k) * 3);
      const t = uv ? uv(i, k, s) : [k / (nc - 1), s / 4];
      uvs.set(t, (r * nc + k) * 2);
    }
  });
  const idx: number[] = [];
  for (let r = 0; r + 1 < rows.length; r++)
    for (let k = 0; k + 1 < nc; k++) {
      const p = r * nc + k, q = p + nc;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** a tiling texture from a painter */
function paint(size: number, f: (x: CanvasRenderingContext2D, S: number) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  f(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** aggregate: thousands of stones in bitumen, with a normal map from the same stones */
function asphalt() {
  const r = rng(77), S = 1024;
  const hgt = new Float32Array(S * S);
  const stone = (cx: number, cy: number, rad: number, h: number) => {
    for (let y = -rad; y <= rad; y++)
      for (let x = -rad; x <= rad; x++) {
        const d = (x * x + y * y) / (rad * rad);
        if (d > 1) continue;
        const i = ((cy + y + S) % S) * S + ((cx + x + S) % S);
        hgt[i] = Math.max(hgt[i], h * (1 - d * d));
      }
  };
  for (let k = 0; k < 42000; k++) stone(Math.floor(r() * S), Math.floor(r() * S), 1 + Math.floor(r() * 3), 0.35 + r() * 0.65);
  const map = paint(S, (x) => {
    const im = x.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const v = 44 + hgt[i] * 58 + ((i * 2654435761) % 13);
      im.data[i * 4] = v * 1.01;
      im.data[i * 4 + 1] = v;
      im.data[i * 4 + 2] = v * 1.03;
      im.data[i * 4 + 3] = 255;
    }
    x.putImageData(im, 0, 0);
  });
  const nrm = paint(S, (x) => {
    const im = x.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let q = 0; q < S; q++) {
        const dx = hgt[y * S + ((q + 1) % S)] - hgt[y * S + ((q + S - 1) % S)], dy = hgt[((y + 1) % S) * S + q] - hgt[((y + S - 1) % S) * S + q];
        const i = (y * S + q) * 4;
        im.data[i] = 128 + dx * 90;
        im.data[i + 1] = 128 + dy * 90;
        im.data[i + 2] = 255;
        im.data[i + 3] = 255;
      }
    x.putImageData(im, 0, 0);
  }, false);
  return { map, nrm };
}

function grassTex() {
  const r = rng(5);
  return paint(1024, (x, S) => {
    x.fillStyle = '#6f9f4a';
    x.fillRect(0, 0, S, S);
    for (let k = 0; k < 90000; k++) {
      const px = r() * S, py = r() * S, l = 3 + r() * 9, a = r() * 6.28;
      const g = 110 + r() * 90;
      x.strokeStyle = `rgba(${Math.floor(g * 0.62)},${Math.floor(g)},${Math.floor(g * 0.36)},0.5)`;
      x.lineWidth = 1 + r();
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
      x.stroke();
    }
  });
}

/** the road: rubber on the racing line, lines at the edge, the grid, the chequers */
function roadMaterial(tx: { map: THREE.Texture; nrm: THREE.Texture }, time: { value: number }) {
  tx.map.repeat.set(1, 1);
  const m = new THREE.MeshStandardMaterial({ map: tx.map, normalMap: tx.nrm, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.82, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute vec4 aRoad;
attribute vec2 aFx;
varying vec4 vRoad;
varying vec2 vFx;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vRoad = aRoad;
vFx = aFx;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
uniform float uT;
varying vec4 vRoad;
varying vec2 vFx;
float mkRub;`).replace('#include <map_fragment>', `#include <map_fragment>
{
  float s = vRoad.x, lat = vRoad.y, hw = vRoad.z, ln = vRoad.w;
  float aw = fwidth(lat) + 0.004, as_ = fwidth(s) + 0.004;
  vec3 c = diffuseColor.rgb;
  // big slow patches: where it's been relaid
  float big = texture2D(map, vec2(s * 0.0031, lat * 0.0043)).r + texture2D(map, vec2(s * 0.0117, lat * 0.0091)).r;
  c *= 0.86 + 0.5 * big;
  // the groove: rubber laid down on the line, heaviest where everyone brakes and turns
  float streak = texture2D(map, vec2(lat * 0.021, s * 0.0017)).r;
  mkRub = exp(-pow((lat - ln) / 1.9, 2.0)) * (0.3 + 0.7 * vFx.x);
  c *= 1.0 - 0.62 * mkRub * (0.62 + streak * 1.1);
  // off the line it's dusty, and marbles of rubber gather at the edges
  float dust = smoothstep(hw - 2.2, hw - 0.4, abs(lat)) * (1.0 - mkRub);
  c = mix(c, c * vec3(1.32, 1.27, 1.18) + 0.018, dust * 0.65);
  // the edge lines
  float e = abs(lat);
  float edge = smoothstep(hw - 0.5 - aw, hw - 0.5 + aw, e) * (1.0 - smoothstep(hw - 0.2 - aw, hw - 0.2 + aw, e));
  // the line, chequers either side of it
  float S0 = ${RACE.start.toFixed(1)};
  float ds = s - S0;
  float chk = step(abs(ds), 1.6) * step(0.0, hw - 0.2 - e);
  float cell = mod(floor(lat / 0.8) + floor(ds / 0.8), 2.0);
  c = mix(c, vec3(mix(0.03, 0.82, cell)), chk);
  // the grid: a bracket for every slot
  float u = (S0 - 6.0 + 1.75 - s) / ${(RACE.row / 2).toFixed(2)};
  float k = floor(u), f = fract(u) * ${(RACE.row / 2).toFixed(2)};
  float side = mod(k, 2.0) < 0.5 ? 1.0 : -1.0;
  float slot = step(0.0, u) * step(k, 25.0);
  float dl = abs(lat - side * 3.0);
  float bar = (1.0 - smoothstep(0.14 - as_, 0.14 + as_, f)) * (1.0 - smoothstep(1.2 - aw, 1.2 + aw, dl));
  float arm = (1.0 - smoothstep(0.65, 0.68, f)) * (1.0 - smoothstep(0.07 - aw, 0.07 + aw, abs(dl - 1.2)));
  float paint_ = max(edge * (1.0 - chk), max(bar, arm) * slot);
  c = mix(c, vec3(0.8, 0.8, 0.76), paint_);
  // in the tunnel: dark, with the lights rolling along the road
  c *= 1.0 - 0.62 * vFx.y;
  diffuseColor.rgb = c;
}`).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.5, mkRub * 0.7);`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float ph = vRoad.x * 0.13 - uT * 2.4;
  vec3 led = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + ph * 0.16));
  totalEmissiveRadiance += led * vFx.y * (0.05 + 0.055 * (0.5 + 0.5 * sin(vRoad.x * 0.78 - uT * 7.0)));
}`);
  };
  return m;
}

export function beanBayGP(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const y0 = 40, center = new THREE.Vector3(-10, y0, 0);
  b.lakeY = y0 - 13;
  const tr = new KartTrack(BEAN_BAY, new THREE.Vector3(0, y0, 0), BEAN_PADS);
  const n = tr.n;
  const state = { go: 1e9 };
  const time = { value: 0 };
  b.animators.push((t) => (time.value = t));
  // ---- how hard each stretch of road gets used, for the rubber
  const plan = new Float32Array(n);
  tr.speeds(tr.line, 1.2, 12, 10, 36, plan);
  const rub = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const brake = Math.max(0, plan[i] - plan[tr.idx(i + 8)]) * 0.14;
    rub[i] = Math.min(1, Math.abs(tr.curve[i]) * 18 + brake);
  }
  for (let p = 0; p < 3; p++) for (let i = 0; i < n; i++) rub[i] = (rub[tr.idx(i - 3)] + rub[i] * 2 + rub[tr.idx(i + 3)]) / 4;
  // ---- the road
  {
    const COLS = 12;
    const g = sweep(tr, 0, n, 1, (i) => {
      const out: [number, number][] = [];
      for (let k = 0; k <= COLS; k++) out.push([tr.hw[i] * (1 - (2 * k) / COLS), 0]);
      return out;
    }, (i, k, s) => [(tr.hw[i] * (1 - (2 * k) / COLS)) / 5.5, s / 5.5]);
    // (the columns run left to right: turned over, or it faces the ground)
    g.index!.array.reverse();
    g.computeVertexNormals();
    const rows = g.getAttribute('position').count / (COLS + 1);
    const road = new Float32Array(rows * (COLS + 1) * 4), fx = new Float32Array(rows * (COLS + 1) * 2);
    for (let r = 0; r < rows; r++) {
      const i = tr.idx(r), lit = tr.tunnel[i] ? 1 : 0;
      // (the tunnel's darkness eases in at the mouths)
      let tn = 0;
      for (let d = -6; d <= 6; d++) tn += tr.tunnel[tr.idx(i + d)];
      for (let k = 0; k <= COLS; k++) {
        const o = r * (COLS + 1) + k;
        road.set([r, tr.hw[i] * (1 - (2 * k) / COLS), tr.hw[i], tr.line[i]], o * 4);
        fx.set([rub[i], lit ? 1 : tn / 13], o * 2);
      }
    }
    g.setAttribute('aRoad', new THREE.BufferAttribute(road, 4));
    g.setAttribute('aFx', new THREE.BufferAttribute(fx, 2));
    const mesh = new THREE.Mesh(g, roadMaterial(asphalt(), time));
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    b.group.add(mesh);
  }
  // ---- the kerbs: a low rolled lip, striped
  {
    const stripes = paint(256, (x, S) => {
      x.fillStyle = '#e8e4da';
      x.fillRect(0, 0, S, S);
      x.fillStyle = '#d6282c';
      x.fillRect(0, 0, S, S / 2);
    });
    const m = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.55 });
    for (const side of [1, -1]) {
      const g = sweep(tr, 0, n, 1, (i) => {
        const w = tr.hw[i];
        return [0, 0.25, 0.5, 0.75, 1].map((e) => [side * (w + e * KERB), 0.055 * Math.sin(e * Math.PI)] as [number, number]);
      }, (_i, k, s) => [k / 4, s / 4.2]);
      if (side < 0) g.index!.array.reverse();
      g.computeVertexNormals();
      const k = new THREE.Mesh(g, m);
      k.receiveShadow = true;
      k.frustumCulled = false;
      b.group.add(k);
    }
  }
  // ---- the run-off: mown grass out to the barriers, gravel traps where there's room
  const grass = grassTex();
  const turf = new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.95 });
  turf.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
diffuseColor.rgb *= 0.74 + 0.5 * texture2D(map, vMapUv * 0.11).g + 0.3 * (texture2D(map, vMapUv * 0.017).r - 0.42);`);
  };
  for (const side of [1, -1]) {
    const wall = side > 0 ? tr.wl : tr.wr;
    const g = sweep(tr, 0, n, 1, (i) => {
      const a = tr.hw[i] + KERB, w = wall[i] + 0.4;
      return [0, 0.5, 1].map((e) => [side * (a + (w - a) * e), -0.02 - 0.02 * e] as [number, number]);
    }, (i, k, s) => [(side * (tr.hw[i] + k * 2)) / 5, s / 5]);
    if (side < 0) g.index!.array.reverse();
    g.computeVertexNormals();
    const rows = g.getAttribute('position').count / 3;
    const col = new Float32Array(rows * 9);
    for (let r = 0; r < rows; r++) {
      const i = tr.idx(r), trap = wall[i] - tr.hw[i] > 8;
      // (mowing stripes, and a band of gravel against the barrier where the run-off is wide)
      const st = Math.floor(r / 7) % 2 ? 1 : 0.84;
      for (let k = 0; k < 3; k++) {
        const c = trap && k === 2 ? [1.7, 1.42, 1.02] : [st * 0.8, st * 0.95, st * 0.66];
        col.set(c, (r * 3 + k) * 3);
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(g, turf);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    b.group.add(mesh);
  }
  // ---- the boost pads: chevrons running up the road
  {
    const m = new THREE.ShaderMaterial({
      uniforms: { uT: time },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
      vertexShader: `varying vec2 vP;
void main() { vP = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec2 vP;
uniform float uT;
void main() {
  // vP.x across (-1..1), vP.y along (0..1)
  float c = fract((vP.y * 3.2 - abs(vP.x) * 0.62) - uT * 1.5);
  float arrow = smoothstep(0.0, 0.05, c) * (1.0 - smoothstep(0.42, 0.47, c));
  float edge = smoothstep(0.86, 0.9, abs(vP.x)) + smoothstep(0.93, 0.97, abs(vP.y * 2.0 - 1.0));
  vec3 lit = mix(vec3(0.05, 0.95, 0.72), vec3(1.0, 1.0, 0.75), arrow);
  float glow = 0.5 + 0.5 * sin(uT * 7.0);
  gl_FragColor = vec4(lit * (1.15 + 0.3 * glow), 0.58 + 0.42 * max(arrow, min(edge, 1.0)));
}`,
    });
    for (const p of tr.pads) {
      const g = sweep(tr, p.s, p.s + p.len, 0.5, () => [[p.lat + p.w, 0.03], [p.lat, 0.03], [p.lat - p.w, 0.03]], (_i, k, s) => [1 - k, (s - p.s) / p.len]);
      g.index!.array.reverse();
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      b.group.add(mesh);
    }
  }
  // ---- the island
  const land = island(b, tr, y0, b.lakeY, turf);
  // ---- the barriers
  barriers(b, tr);
  // ---- the bridge and the tunnel
  bridge(b, tr, land);
  const tunnelT = tunnel(b, tr);
  b.animators.push(tunnelT);
  const gantry = dressScenery(b, tr, land, y0, time);
  b.finish();
  // ---- the race's own numbers
  let racers: Racer[] = [];
  const byId = new Map<number, Racer>();
  const gridAt = tr.point(RACE.start - 20, 0, 1, new THREE.Vector3());
  return {
    id: 'beanbaygp',
    name: info.name,
    kind: 'race',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: -1e6,
    lakeY: b.lakeY,
    state,
    grid: (k) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let i = 0; i < k; i++) {
        const row = Math.floor(i / 2), side = i % 2 ? -1 : 1;
        const s = RACE.start - 6 - row * RACE.row - (i % 2) * (RACE.row / 2);
        out.push({ pos: tr.point(s, side * 3, 0.4, new THREE.Vector3()), yaw: tr.heading(s) });
      }
      return out;
    },
    kart: {
      center,
      gridAt,
      track: tr,
      racer: (id) => byId.get(id),
      all: () => racers,
      bind: (all) => {
        racers = all;
        byId.clear();
        for (const r of all) byId.set(r.id, r);
      },
      lights: gantry.lights,
      land,
    },
    intro: [],
  };
}

/** the land: shaped from the track outward, with hills inland and a beach all round */
function island(b: CourseBuilder, tr: KartTrack, y0: number, sea: number, turf: THREE.MeshStandardMaterial): Land {
  const N = 300, SIZE = 1240, cell = SIZE / N, ox = -30 - SIZE / 2, oz = 10 - SIZE / 2, W = N + 1;
  const dist = new Float32Array(W * W).fill(1e9), road = new Float32Array(W * W), cap = new Float32Array(W * W).fill(1e9);
  const R = 130;
  for (let i = 0; i < tr.n; i += 2) {
    const px = tr.P[i * 3], py = tr.P[i * 3 + 1], pz = tr.P[i * 3 + 2], wall = Math.max(tr.wl[i], tr.wr[i]);
    const lx = tr.L[i * 3], ly = tr.L[i * 3 + 1], lz = tr.L[i * 3 + 2], l2 = lx * lx + lz * lz;
    const gx = (px - ox) / cell, gz = (pz - oz) / cell, rr = Math.ceil(R / cell);
    for (let z = Math.max(0, Math.floor(gz - rr)); z <= Math.min(N, gz + rr); z++)
      for (let x = Math.max(0, Math.floor(gx - rr)); x <= Math.min(N, gx + rr); x++) {
        const d = Math.hypot(ox + x * cell - px, oz + z * cell - pz) - wall, k = z * W + x;
        // (a bridge flies over the land: the land just has to stay under it)
        if (tr.raised[i]) {
          if (d < 14) cap[k] = Math.min(cap[k], py - 2.6 + Math.max(0, d) * 0.2);
          continue;
        }
        if (d < dist[k]) {
          dist[k] = d;
          // (the height of the surface across a bank, not just the height of its middle)
          const lat = THREE.MathUtils.clamp(((ox + x * cell - px) * lx + (oz + z * cell - pz) * lz) / l2, -tr.wr[i], tr.wl[i]);
          road[k] = py + lat * ly;
        }
      }
  }
  const noise = (x: number, z: number) => {
    let s = 0, a = 1, f = 0.006;
    for (let o = 0; o < 5; o++) {
      s += a * (Math.sin(x * f + o * 1.7 + Math.sin(z * f * 0.73 + o)) * Math.cos(z * f * 1.13 - o * 2.1 + Math.sin(x * f * 0.51)));
      a *= 0.5;
      f *= 2.03;
    }
    return s;
  };
  const H = new Float32Array(W * W);
  const P = new Float32Array(W * W * 3), C = new Float32Array(W * W * 3), U = new Float32Array(W * W * 2);
  for (let z = 0; z <= N; z++)
    for (let x = 0; x <= N; x++) {
      const k = z * W + x, wx = ox + x * cell, wz = oz + z * cell, d = dist[k];
      const nz = noise(wx, wz);
      // inland: rolling hills rising with distance from the road; then down to the sea
      const coast = 92 + nz * 34;
      const hills = y0 + 1 + Math.max(0, nz + 0.25) * 15 * THREE.MathUtils.smoothstep(d, 16, 90);
      const shore = THREE.MathUtils.smoothstep(d, coast, coast + 74);
      let h = THREE.MathUtils.lerp(hills, sea - 9, shore);
      if (d < 1e8) {
        const t = THREE.MathUtils.smoothstep(d, 0.5, 38);
        h = THREE.MathUtils.lerp(road[k] - 0.5, h, t);
      } else h = sea - 12;
      h = Math.min(h, cap[k]);
      H[k] = h;
      P.set([wx, h, wz], k * 3);
      U.set([wx / 9, wz / 9], k * 2);
    }
  for (let z = 0; z <= N; z++)
    for (let x = 0; x <= N; x++) {
      const k = z * W + x, h = H[k];
      const dx = (H[z * W + Math.min(N, x + 1)] - H[z * W + Math.max(0, x - 1)]) / (2 * cell), dz = (H[Math.min(N, z + 1) * W + x] - H[Math.max(0, z - 1) * W + x]) / (2 * cell);
      const steep = Math.hypot(dx, dz);
      const nz = noise(ox + x * cell + 91, oz + z * cell - 37);
      // meadow, lusher in the hollows, sand at the shore, rock on the steep bits
      const c = new THREE.Color().setRGB(0.62 + nz * 0.08, 0.86 + nz * 0.1, 0.46 + nz * 0.04);
      const sand = 1 - THREE.MathUtils.smoothstep(h, sea + 1.2, sea + 4.2);
      c.lerp(new THREE.Color(2.3, 1.98, 1.42), sand);
      c.lerp(new THREE.Color(0.95, 0.9, 0.82), THREE.MathUtils.smoothstep(steep, 0.55, 0.95) * (1 - sand));
      C.set([c.r, c.g, c.b], k * 3);
    }
  const idx: number[] = [];
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const a = z * W + x, q = a + W;
      idx.push(a, q, a + 1, a + 1, q, q + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, turf);
  m.receiveShadow = true;
  m.frustumCulled = false;
  b.group.add(m);
  return {
    sea,
    /** the height of the land, and how far past the barriers a spot is */
    at(x: number, z: number) {
      const gx = THREE.MathUtils.clamp((x - ox) / cell, 0, N - 0.001), gz = THREE.MathUtils.clamp((z - oz) / cell, 0, N - 0.001);
      const a = Math.floor(gx), c = Math.floor(gz), u = gx - a, v = gz - c, k = c * W + a;
      return { h: (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + W] * (1 - u) + H[k + W + 1] * u) * v, d: dist[Math.round(gz) * W + Math.round(gx)] };
    },
  };
}

/** Armco on the straights, tyre walls on the outside of the bends, concrete on the banking */
function barriers(b: CourseBuilder, tr: KartTrack) {
  // (two-sided: a barrier you can only see from behind is an invisible wall to everyone driving at it)
  const steel = new THREE.MeshStandardMaterial({ color: 0xc8ced6, metalness: 0.55, roughness: 0.42, side: THREE.DoubleSide });
  const conc = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.78 });
  const n = tr.n;
  const post: THREE.Matrix4[] = [], tyres: { m: THREE.Matrix4; c: number }[] = [], fence: [number, number][] = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Tg = new THREE.Vector3(), Up = new THREE.Vector3(), Lf = new THREE.Vector3();
  for (const side of [1, -1]) {
    const wall = side > 0 ? tr.wl : tr.wr;
    const offset = (i: number) => side * (wall[i] + 0.12);
    // the two steel rails, all the way round (the tunnel has its own walls)
    for (const up of [0.42, 0.78]) {
      // (a W-beam: pressed in along the middle, so it catches the light in two lines)
      const g = sweep(tr, 0, n, 1, (i) => [[offset(i) - side * 0.04, up - 0.17], [offset(i) + side * 0.03, up - 0.05], [offset(i) + side * 0.03, up + 0.05], [offset(i) - side * 0.04, up + 0.17]]);
      if (side > 0) g.index!.array.reverse();
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, steel);
      m.frustumCulled = false;
      m.castShadow = true;
      b.group.add(m);
    }
    // a concrete foot along the banking and the bridge
    const plinth = (i: number) => tr.raised[i] || Math.abs(tr.bank[i]) > 0.1;
    let a = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && plinth(i);
      if (on && a < 0) a = i;
      if (!on && a >= 0) {
        const g = sweep(tr, a, i, 1, (k) => [[offset(k) - side * 0.1, 0], [offset(k) - side * 0.1, 1.15], [offset(k) + side * 0.3, 1.25], [offset(k) + side * 0.3, -0.5]]);
        if (side > 0) g.index!.array.reverse();
        g.computeVertexNormals();
        const m = new THREE.Mesh(g, conc);
        m.castShadow = m.receiveShadow = true;
        m.frustumCulled = false;
        b.group.add(m);
        fence.push([a, i]);
        a = -1;
      }
    }
    for (let i = 0; i < n; i += 3) {
      if (tr.tunnel[i]) continue;
      tr.point(i, offset(i) + side * 0.12, 0, V);
      const o = i * 3;
      Lf.set(tr.L[o], tr.L[o + 1], tr.L[o + 2]);
      Up.set(tr.U[o], tr.U[o + 1], tr.U[o + 2]);
      Tg.set(tr.T[o], tr.T[o + 1], tr.T[o + 2]);
      M.makeBasis(Lf, Up, Tg);
      Q.setFromRotationMatrix(M);
      post.push(new THREE.Matrix4().compose(V.clone(), Q.clone(), new THREE.Vector3(1, 1, 1)));
    }
    // tyres in front of the rail, on the outside of anything tight
    let colour = 0;
    for (let s = 0; s < n; s += 0.86) {
      const i = tr.idx(Math.round(s)), outside = -Math.sign(tr.curve[i]) === side;
      if (!outside || Math.abs(tr.curve[i]) < 0.016 || tr.tunnel[i] || tr.raised[i]) continue;
      colour++;
      for (let row = 0; row < 3; row++) {
        // (their faces where the kart actually stops, so nothing drives into them)
        tr.point(s, side * (wall[i] + 0.4), 0.13 + row * 0.27, V);
        M.makeTranslation(V.x, V.y, V.z);
        tyres.push({ m: M.clone(), c: Math.floor(colour / 5) % 2 });
      }
    }
  }
  const pg = new THREE.CylinderGeometry(0.055, 0.055, 1.1, 8).translate(0, 0.55, 0);
  const pm = new THREE.InstancedMesh(pg, steel, post.length);
  post.forEach((m, i) => pm.setMatrixAt(i, m));
  pm.castShadow = true;
  pm.frustumCulled = false;
  b.group.add(pm);
  const tg = new THREE.TorusGeometry(0.34, 0.13, 5, 10).rotateX(Math.PI / 2);
  const tm = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ roughness: 0.62 }), tyres.length);
  const C = new THREE.Color();
  tyres.forEach((t, i) => {
    tm.setMatrixAt(i, t.m);
    tm.setColorAt(i, C.set(t.c ? 0xf0efe8 : 0xd8302f));
  });
  // (no shadow: every one of these is drawn again for each shadow cascade, and they're low and hug the rail)
  tm.frustumCulled = false;
  b.group.add(tm);
  // the catch fence on top of the concrete
  const net = paint(128, (x, S) => {
    x.clearRect(0, 0, S, S);
    x.strokeStyle = 'rgba(210,216,224,0.9)';
    x.lineWidth = 3;
    for (let k = -S; k < S * 2; k += 32) {
      x.beginPath();
      x.moveTo(k, 0);
      x.lineTo(k + S, S);
      x.moveTo(k + S, 0);
      x.lineTo(k, S);
      x.stroke();
    }
  });
  const fm = new THREE.MeshStandardMaterial({ map: net, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 });
  for (const [a, e] of fence) {
    for (const side of [1, -1]) {
      const wall = side > 0 ? tr.wl : tr.wr;
      if (Math.abs(tr.bank[tr.idx(a + 4)]) > 0.1 && Math.sign(tr.bank[tr.idx(a + 4)]) === side) continue;
      const g = sweep(tr, a, e, 2, (k) => [[side * (wall[k] + 0.3), 1.2], [side * (wall[k] + 0.3), 3.4]], (_k, c, s) => [s / 1.6, c * 1.4]);
      const m = new THREE.Mesh(g, fm);
      m.frustumCulled = false;
      b.group.add(m);
    }
  }
}

/** the Hump: a steel bridge carrying the road over itself */
function bridge(b: CourseBuilder, tr: KartTrack, land: Land) {
  const steel = new THREE.MeshStandardMaterial({ color: 0xe63a35, metalness: 0.4, roughness: 0.42 });
  const under = new THREE.MeshStandardMaterial({ color: 0x4c5560, roughness: 0.7, metalness: 0.2 });
  let a = -1;
  const spans: [number, number][] = [];
  for (let i = 0; i <= tr.n; i++) {
    const on = i < tr.n && !!tr.raised[i];
    if (on && a < 0) a = i;
    if (!on && a >= 0) {
      spans.push([a, i]);
      a = -1;
    }
  }
  for (const [s, e] of spans) {
    const w = (i: number) => Math.max(tr.wl[i], tr.wr[i]) + 0.5;
    const g = sweep(tr, s - 3, e + 3, 1, (i) => [[w(i), -0.05], [w(i), -0.7], [w(i) * 0.5, -1.25], [-w(i) * 0.5, -1.25], [-w(i), -0.7], [-w(i), -0.05]]);
    const deck = new THREE.Mesh(g, under);
    deck.castShadow = true;
    deck.frustumCulled = false;
    b.group.add(deck);
    // piers, in pairs either side of the road below
    for (let i = s + 2; i < e; i += 13) {
      for (const side of [1, -1]) {
        tr.point(i, side * (w(i) - 1.4), -1.1, V);
        const ground = land.at(V.x, V.z).h;
        const h = V.y - ground + 1;
        // (not down through the road that runs underneath)
        let clear = true;
        for (let k = 0; k < tr.n; k += 2) {
          if (tr.raised[k]) continue;
          if (Math.hypot(tr.P[k * 3] - V.x, tr.P[k * 3 + 2] - V.z) < tr.hw[k] + 3.2) clear = false;
        }
        if (!clear || h < 1.2) continue;
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.72, h, 14).translate(V.x, V.y - h / 2, V.z), steel);
        pier.castShadow = true;
        b.group.add(pier);
      }
    }
  }
}

/** the Light Tunnel: a tube of ribs, each one a ring of colour chasing down the road */
function tunnel(b: CourseBuilder, tr: KartTrack) {
  let a = -1, e = -1;
  for (let i = 0; i < tr.n; i++) {
    if (tr.tunnel[i]) {
      if (a < 0) a = i;
      e = i;
    }
  }
  const shell = new THREE.MeshStandardMaterial({ color: 0x151826, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
  const hgt = 6.4;
  const arch = (i: number): [number, number][] => {
    const w = Math.max(tr.wl[i], tr.wr[i]) + 0.5, out: [number, number][] = [];
    for (let k = 0; k <= 12; k++) {
      const u = Math.PI * (k / 12);
      out.push([Math.cos(u) * w, Math.sin(u) ** 0.8 * hgt]);
    }
    return out;
  };
  const g = sweep(tr, a, e, 2, arch);
  const m = new THREE.Mesh(g, shell);
  m.castShadow = m.receiveShadow = true;
  m.frustumCulled = false;
  b.group.add(m);
  // the ribs
  const ribs: number[] = [];
  for (let s = a; s <= e; s += 3.2) ribs.push(s);
  const ring = new THREE.TorusGeometry(1, 0.035, 6, 28, Math.PI);
  const lm = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), ribs.length);
  lm.frustumCulled = false;
  const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Lf = new THREE.Vector3(), Up = new THREE.Vector3(), Tg = new THREE.Vector3();
  ribs.forEach((s, k) => {
    const i = tr.idx(Math.round(s)), o = i * 3, w = Math.max(tr.wl[i], tr.wr[i]) + 0.2;
    tr.point(s, 0, 0.1, V);
    Lf.set(tr.L[o], tr.L[o + 1], tr.L[o + 2]);
    Up.set(tr.U[o], tr.U[o + 1], tr.U[o + 2]);
    Tg.set(tr.T[o], tr.T[o + 1], tr.T[o + 2]);
    Mx.makeBasis(Lf, Up, Tg);
    Q.setFromRotationMatrix(Mx);
    S.set(w, hgt - 0.3, w);
    lm.setMatrixAt(k, Mx.compose(V, Q, S));
    lm.setColorAt(k, new THREE.Color(1, 1, 1));
  });
  b.group.add(lm);
  // the portals: a bright surround at each end
  for (const s of [a, e]) {
    const i = tr.idx(s), o = i * 3, w = Math.max(tr.wl[i], tr.wr[i]) + 0.9;
    tr.point(s, 0, 0, V);
    const p = new THREE.Mesh(new THREE.TorusGeometry(1, 0.075, 10, 36, Math.PI), new THREE.MeshPhysicalMaterial({ color: 0xffc21f, metalness: 0.3, roughness: 0.3, clearcoat: 1 }));
    Lf.set(tr.L[o], tr.L[o + 1], tr.L[o + 2]);
    Up.set(tr.U[o], tr.U[o + 1], tr.U[o + 2]);
    Tg.set(tr.T[o], tr.T[o + 1], tr.T[o + 2]);
    Mx.makeBasis(Lf, Up, Tg);
    p.quaternion.setFromRotationMatrix(Mx);
    p.position.copy(V);
    p.scale.set(w, hgt + 0.5, w * 2);
    p.castShadow = true;
    b.group.add(p);
  }
  const C = new THREE.Color();
  return (t: number) => {
    // (the colour runs down the tube ahead of you)
    ribs.forEach((s, k) => {
      const h = (s * 0.012 - t * 0.22) % 1;
      const pulse = 0.5 + 0.5 * Math.sin(s * 0.78 - t * 7);
      C.setHSL((h + 1) % 1, 1, 0.55).multiplyScalar(1.5 + 3 * pulse);
      lm.setColorAt(k, C);
    });
    lm.instanceColor!.needsUpdate = true;
  };
}
