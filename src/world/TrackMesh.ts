import * as THREE from 'three';
import '@fontsource/titillium-web/700.css';
import '@fontsource/titillium-web/700-italic.css';
import type { Track } from './Track.ts';
import type { Renderer } from '../core/Renderer.ts';
import { ChunkSet, type MatDef } from './trackside/builder.ts';
import { Ctx } from './trackside/context.ts';
import { makeGroundTextures } from './trackside/textures.ts';
import { DecalAtlas, PrintAtlas } from './trackside/atlas.ts';
import {
  asphaltMaterial,
  decalMaterial,
  fenceMaterial,
  grassMaterial,
  gravelMaterial,
  lampMaterial,
  printMaterial,
  propsMaterial,
} from './trackside/materials.ts';
import { buildSurfaces } from './trackside/surfaces.ts';
import { buildBarriers, buildLightPoles } from './trackside/barriers.ts';
import { buildMarkings } from './trackside/markings.ts';
import { buildStructures, type PanelSpot } from './trackside/structures.ts';
import { RoadSSR } from './trackside/ssr.ts';
import { GRAVEL_EDGE, SURF, VERGE } from './Track.ts';

// ground cross-sections, mirroring trackside/surfaces.ts (kerb profile per style, gravel dish, sunken grass)
const KERB_X = [0, 0.03, 0.1, 0.2, 0.3, 0.86, 0.92, 0.97, 1.0];
const KERB_H = [0, 0.008, 0.022, 0.036, 0.045, 0.045, 0.036, 0.015, 0.0];
const KERBW_H = [0, 0.006, 0.016, 0.026, 0.032, 0.032, 0.026, 0.012, 0.0];
const GRAVEL_CUTS = [0, 0.08, 0.35, 0.8, 1];
const GRAVEL_DIP = [0, -0.02, -0.05, -0.04, 0];
const GRASS_Y = -0.035;
const GRAVEL_Y = -0.02;

function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  for (let k = 1; k < xs.length; k++) {
    if (x <= xs[k]) {
      const f = (x - xs[k - 1]) / (xs[k] - xs[k - 1]);
      return ys[k - 1] + (ys[k] - ys[k - 1]) * f;
    }
  }
  return ys[ys.length - 1];
}

/** see Trackside.groundLift */
function makeGroundLift(track: Track, ctx: Ctx) {
  const n = track.n;
  return (s: number, lat: number): number => {
    const w = track.wrap(s);
    const i = Math.floor(w) % n;
    const a = Math.abs(lat);
    const hw = track.halfWidth[i];
    if (a <= hw) return 0;
    const sd = lat < 0 ? -1 : 1;
    if (ctx.pitOwned(i, sd)) return NaN;
    const P = ctx.side(sd);
    const kw = P.kerb[i];
    if (a <= hw + kw) {
      // kerb runs ramp up over their first/last 1.6 m
      let d = 3;
      for (let k = 1; k <= 2; k++) {
        if (P.kerb[(i + k) % n] <= 0) d = Math.min(d, k - (w - Math.floor(w)));
        if (P.kerb[(i - k + n) % n] <= 0) d = Math.min(d, k - 1 + (w - Math.floor(w)));
      }
      return interp(KERB_X, P.kerbStyle[i] === 3 ? KERBW_H : KERB_H, (a - hw) / kw) * Math.min(1, d / 1.6);
    }
    const vOut = hw + kw + VERGE;
    if (a <= vOut) return 0;
    const bar = P.bar[i];
    if (a > bar) return NaN;
    const ro = P.runoff[i];
    if (ro === SURF.ASPHALT) return 0;
    if (ro === SURF.GRAVEL) {
      const g = bar - GRAVEL_EDGE;
      if (g > vOut + 0.3 && a < g) return GRAVEL_Y + interp(GRAVEL_CUTS, GRAVEL_DIP, (a - vOut) / (g - vOut));
    }
    return GRASS_Y;
  };
}

/**
 * Everything from the centreline out to (and a few metres behind) the barriers
 * at Monza: road, kerbs, verges, run-off, gravel, grass, barriers, debris
 * fences, markings, start gantry, footbridges, marshal posts, cameras, boards.
 * (The pit wall, pit lane and its entry/exit spurs belong to the pit module —
 * see PIT_HANDOFF in trackside/context.ts.)
 *
 * The lap is cut into ~360 m chunks; inside a chunk everything merges into one
 * mesh per material (asphalt / gravel / grass / decal / props / print / fence),
 * so the whole circuit is ~100 draws and a chase-cam view a few dozen.
 *
 * Weather: every material reads the shared weatherUniforms (wetness, rain,
 * dry line, clock). The wet road gets screen-space reflections (trackside/ssr.ts).
 */

export interface StartLights {
  set(lit: number): void;
}

export type PanelState = 'off' | 'green' | 'yellow' | 'blue' | 'red' | 'white';

export interface Trackside {
  group: THREE.Group;
  startLights: StartLights;
  update(dt: number, camera: THREE.Camera): void;
  /** marshal LED panels: all posts, or one post by index */
  setPanels?(state: PanelState, post?: number): void;
  /** turn the wet-road screen-space reflections on/off (quality setting) */
  setReflections?(on: boolean): void;
  /** the wet-road reflection pass (tuning/debug) */
  ssr?: RoadSSR;
  /**
   * Height of the rendered ground above the (banked) road plane at (s, lateral):
   * kerb profiles, dished gravel, sunken grass. NaN where this module has no ground
   * (pit-lane side, behind the barriers). Used to lay tyre marks on the surface.
   */
  groundLift?(s: number, lateral: number): number;
  /** the per-sample trackside plan (debug / tools) */
  ctx?: Ctx;
}

export interface TracksideStats {
  buildMs: number;
  meshes: number;
  triangles: number;
  chunks: number;
  byKey: Record<string, number>;
  phases: Record<string, number>;
}

const PANEL_COLORS: Record<PanelState, [number, number, number]> = {
  off: [0, 0, 0],
  green: [0.1, 3.2, 0.35],
  yellow: [3.4, 2.4, 0.05],
  blue: [0.15, 0.6, 3.6],
  red: [3.6, 0.12, 0.08],
  white: [2.6, 2.6, 2.6],
};

function makePanels(spots: PanelSpot[]): THREE.InstancedMesh {
  const geo = new THREE.PlaneGeometry(0.96, 0.66);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPUv;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // LED dot matrix: 32 × 22 dots, off = dark grey dots on black
          vec2 g = vPUv * vec2(32.0, 22.0);
          vec2 f = fract(g) - 0.5;
          float dotm = 1.0 - smoothstep(0.26, 0.4, length(f));
          float far = smoothstep(0.02, 0.08, length(fwidth(vPUv)));
          dotm = mix(dotm, 0.55, far);
          vec3 on = diffuseColor.rgb;
          float lit = step(0.001, dot(on, vec3(1.0)));
          diffuseColor.rgb = mix(vec3(0.012) * dotm + vec3(0.004), on * dotm, lit);
        }`,
      );
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPUv = uv;');
  };
  mat.customProgramCacheKey = () => 'apex-ts-ledpanel-1';
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3();
  spots.forEach((p, k) => {
    // basis: x = right, y = up, z = normal (the plane faces +z)
    up.crossVectors(p.normal, p.right).normalize();
    m.makeBasis(p.right, up, p.normal);
    m.setPosition(p.pos);
    mesh.setMatrixAt(k, m);
    mesh.setColorAt(k, new THREE.Color(0, 0, 0));
  });
  mesh.count = spots.length;
  mesh.name = 'ts_panels';
  mesh.frustumCulled = false;
  return mesh;
}

export function buildTrackside(track: Track, gfx: Renderer): Trackside & { stats: TracksideStats } {
  const t0 = performance.now();
  const aniso = gfx.maxAnisotropy;

  const tex = makeGroundTextures(aniso);
  const print = new PrintAtlas(aniso);
  const decals = new DecalAtlas(aniso);
  const tTex = performance.now();
  const lamp = lampMaterial();

  const defs: Record<string, MatDef> = {
    // the road draws after the other opaques so its wet reflections can see them (ssr.ts)
    asphalt: { material: asphaltMaterial(tex, { kerb: track.def.trackside?.kerb, runoffPaint: track.def.trackside?.runoffPaint }), spec: { uv: true, a0: true, a1: true }, cast: false, receive: true, renderOrder: 1 },
    gravel: { material: gravelMaterial(tex), spec: { uv: true, a0: true, a1: true }, cast: false, receive: true },
    grass: { material: grassMaterial(tex), spec: { uv: true, a0: true, a1: true }, cast: false, receive: true },
    decal: { material: decalMaterial(decals.texture), spec: { uv: true, color: true, pbr: true }, cast: false, receive: true, renderOrder: 2 },
    props: { material: propsMaterial(), spec: { color: true, pbr: true }, cast: true, receive: true },
    print: { material: printMaterial(print.texture), spec: { uv: true, color: true, pbr: true }, cast: true, receive: true },
    fence: { material: fenceMaterial(tex.fence), spec: { uv: true }, cast: false, receive: true, renderOrder: 3 },
    lamp: { material: lamp.material, spec: { a0: true }, cast: false, receive: false },
  };

  const cs = new ChunkSet(track.length, 360, defs);
  const ctx = new Ctx(track, cs);
  const tCtx = performance.now();
  buildSurfaces(ctx);
  buildBarriers(ctx, print);
  buildLightPoles(ctx);
  buildMarkings(ctx, decals);
  const st = buildStructures(ctx, print);

  const tGeo = performance.now();
  const group = new THREE.Group();
  group.name = 'trackside';
  const { meshes, triangles, byKey } = cs.finish(group);
  const panels = makePanels(st.panels);
  group.add(panels);
  group.matrixAutoUpdate = false;

  // wet-road reflections: hook every road chunk (the first one drawn each frame does the copy)
  const ssr = new RoadSSR();
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name.startsWith('ts_asphalt_')) ssr.hook(o as THREE.Mesh);
  });

  // redraw printed textures once the display font is available (skipped if it already was)
  const fontReady = typeof document !== 'undefined' && !!document.fonts && document.fonts.check('italic 700 64px "Titillium Web"') && document.fonts.check('700 64px "Titillium Web"');
  if (!fontReady && typeof document !== 'undefined' && document.fonts) {
    Promise.all([document.fonts.load('700 64px "Titillium Web"'), document.fonts.load('italic 700 64px "Titillium Web"')])
      .then(() => {
        print.draw();
        decals.draw();
      })
      .catch(() => {});
  }

  const tEnd = performance.now();
  const stats: TracksideStats = {
    buildMs: tEnd - t0,
    meshes: meshes + 1,
    triangles,
    chunks: cs.count,
    byKey,
    phases: { textures: Math.round(tTex - t0), analysis: Math.round(tCtx - tTex), geometry: Math.round(tGeo - tCtx), upload: Math.round(tEnd - tGeo) },
  };

  const col = new THREE.Color();
  let reflections = true;
  const setPanels = (state: PanelState, post?: number) => {
    const [r, g, b] = PANEL_COLORS[state] ?? PANEL_COLORS.off;
    col.setRGB(r, g, b);
    for (let k = 0; k < panels.count; k++) if (post === undefined || post === k) panels.setColorAt(k, col);
    if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
  };

  const groundLift = makeGroundLift(track, ctx);

  return {
    group,
    stats,
    groundLift,
    ctx,
    startLights: {
      set(lit: number) {
        lamp.lit.value = Math.max(0, Math.min(5, Math.round(lit)));
      },
    },
    setPanels,
    setReflections(on: boolean) {
      reflections = on;
    },
    ssr,
    update(_dt: number, camera: THREE.Camera) {
      ssr.mainCamera = camera;
      // wet-road reflections scale with the quality preset: off on low/medium, 1/3-res copy on high, 1/2 on ultra
      const q = gfx.qualityLevel;
      ssr.enabled = reflections && (q === 'high' || q === 'ultra');
      ssr.downscale = ssr.fixedDownscale ?? (q === 'low' ? 3 : 2);
    },
  };
}
