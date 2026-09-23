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
import { buildBarriers } from './trackside/barriers.ts';
import { buildMarkings } from './trackside/markings.ts';
import { buildPit, preparePit } from './trackside/pit.ts';
import { buildStructures } from './trackside/structures.ts';

/**
 * Everything from the centreline out to (and a few metres behind) the barriers:
 * road, kerbs, verges, run-off, gravel, grass, barriers, fences, markings, pit
 * lane + pit wall, start gantry, bridges, marshal posts, cameras, boards.
 *
 * The lap is cut into ~240 m chunks; inside a chunk everything merges into one
 * mesh per material (asphalt / gravel / grass / decal / props / print / fence),
 * so a chase-cam view draws a few dozen calls and the whole circuit ≈ 150.
 */

export interface StartLights {
  set(lit: number): void;
}

export interface Trackside {
  group: THREE.Group;
  startLights: StartLights;
  update(dt: number, camera: THREE.Camera): void;
}

export interface TracksideStats {
  buildMs: number;
  meshes: number;
  triangles: number;
  chunks: number;
  byKey: Record<string, number>;
  phases: Record<string, number>;
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
    asphalt: { material: asphaltMaterial(tex), spec: { uv: true, a0: true, a1: true }, cast: false, receive: true },
    gravel: { material: gravelMaterial(tex), spec: { uv: true, a0: true, a1: true }, cast: false, receive: true },
    grass: { material: grassMaterial(tex), spec: { uv: true, a0: true, a1: true }, cast: false, receive: true },
    decal: { material: decalMaterial(decals.texture), spec: { uv: true, color: true, pbr: true }, cast: false, receive: true, renderOrder: 1 },
    props: { material: propsMaterial(), spec: { color: true, pbr: true }, cast: true, receive: true },
    print: { material: printMaterial(print.texture), spec: { uv: true, color: true, pbr: true }, cast: true, receive: true },
    fence: { material: fenceMaterial(tex.fence), spec: { uv: true }, cast: false, receive: true, renderOrder: 2 },
    lamp: { material: lamp.material, spec: { a0: true }, cast: false, receive: false },
  };

  const cs = new ChunkSet(track.length, 240, defs);
  const ctx = new Ctx(track, cs);
  const tCtx = performance.now();
  preparePit(ctx);
  buildSurfaces(ctx);
  buildPit(ctx, print);
  buildBarriers(ctx, print);
  buildMarkings(ctx, decals);
  buildStructures(ctx, print);

  const tGeo = performance.now();
  const group = new THREE.Group();
  group.name = 'trackside';
  const { meshes, triangles, byKey } = cs.finish(group);
  group.matrixAutoUpdate = false;

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
    meshes,
    triangles,
    chunks: cs.count,
    byKey,
    phases: { textures: Math.round(tTex - t0), analysis: Math.round(tCtx - tTex), geometry: Math.round(tGeo - tCtx), upload: Math.round(tEnd - tGeo) },
  };

  return {
    group,
    stats,
    startLights: {
      set(lit: number) {
        lamp.lit.value = Math.max(0, Math.min(5, Math.round(lit)));
      },
    },
    update(_dt: number, _camera: THREE.Camera) {
      // static geometry; nothing per frame yet
    },
  };
}
