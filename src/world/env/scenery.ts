import * as THREE from 'three';
import type { Track } from '../Track.ts';
import type { Renderer } from '../../core/Renderer.ts';
import { WorldMap } from './worldmap.ts';
import { buildTerrain } from './terrain.ts';
import { planLayout } from './layout.ts';
import { buildVegetation } from './vegetation.ts';
import { setLeafFill } from './treematerial.ts';
import { buildHorizon, HORIZON_PRESETS } from './horizon.ts';
import { buildParkMasks } from './parkmask.ts';
import { buildGrandstands } from './grandstands.ts';
import { buildBanking } from './banking.ts';
import { buildVillages } from './villages.ts';
import { austinTerrainLook, buildAustinScenery } from './venues/austinScenery.ts';
import { buildSpielbergScenery, spielbergTerrainLook } from './venues/spielbergScenery.ts';
import { buildMontrealScenery, montrealTerrainLook } from './venues/montrealScenery.ts';
import { tuneInterlagosTerrain } from './venues/interlagosCity.ts';
import { buildZandvoortScenery } from './venues/zandvoortScenery.ts';

/**
 * Scenery: everything beyond the barriers that isn't sky or light — the Parco
 * di Monza (terrain, lawns, paths, woods), grandstands and tifosi, the old
 * banked oval with its bridge over the Serraglio, the Lombardy villages and the
 * Prealps. The Environment owns the sky/sun/fog and calls `setLight` whenever
 * the lighting changes. The pit complex (east of the main straight) belongs to
 * PitComplex, not to the scenery.
 */

export interface SceneryLight {
  /** unit vector toward the sun */
  sunDir: THREE.Vector3;
  /** linear sun colour × intensity (what the DirectionalLight carries) */
  sunColor: THREE.Color;
  /** linear sky ambient (hemisphere, above) */
  skyAmbient: THREE.Color;
  /** track/ground water 0 … 1 and rain rate 0 … 1 */
  wetness: number;
  rain: number;
  /** wind (m/s) in world x/z */
  windX: number;
  windZ: number;
}

export interface Scenery {
  group: THREE.Group;
  /** terrain height at world (x, z) */
  heightAt(x: number, z: number): number;
  setLight(l: SceneryLight): void;
  update(dt: number, camera: THREE.Camera, elapsed: number): void;
  /** scale the costly detail (tree 3D range) with the graphics quality */
  setQuality(q: 'low' | 'medium' | 'high' | 'ultra'): void;
  readonly stats: Record<string, unknown>;
}

export function buildScenery(track: Track, gfx: Renderer): Scenery {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  let tLap = t0;
  const lap = (k: string) => {
    const n = performance.now();
    timings[k] = Math.round(n - tLap);
    tLap = n;
  };
  const group = new THREE.Group();
  group.name = 'Scenery';
  const map = new WorldMap(track);
  const layout = planLayout(track, map);
  lap('layout');
  map.bakeMasks();
  lap('forest');
  map.bake();
  lap('heights');
  const terrain = buildTerrain(map, gfx.maxAnisotropy);
  group.add(terrain.group);
  lap('terrain');
  const veg = buildVegetation(map, layout, gfx.renderer);
  veg.setDetail(gfx.qualityLevel);
  group.add(veg.group);
  lap('trees');
  const masks = buildParkMasks(map, layout, veg.shade);
  terrain.setMasks(masks);
  lap('masks');
  // (a failure in the stands — e.g. the crowd's avatar kit — must not take the whole landscape with it)
  let stands: Pick<ReturnType<typeof buildGrandstands>, 'group' | 'update' | 'people' | 'flags'>;
  try {
    stands = buildGrandstands(layout, track, map);
  } catch (e) {
    console.error('[scenery] grandstands failed — building without them', e);
    stands = { group: new THREE.Group(), update: () => {}, people: 0, flags: 0 };
  }
  group.add(stands.group);
  lap('stands');
  const banking = layout.oval ? buildBanking(layout.oval, track, map, terrain.material) : null;
  if (banking) group.add(banking.group);
  lap('banking');
  const villages = buildVillages(map, layout);
  group.add(villages.group);
  if (map.venue === 'austin') { group.add(buildAustinScenery(layout, track, map).group); austinTerrainLook(terrain.uniforms); }
  if (map.venue === 'spielberg') { group.add(buildSpielbergScenery(map)); spielbergTerrainLook(terrain.uniforms); }
  const mtl = map.venue === 'montreal' ? buildMontrealScenery(layout, track, map) : null;
  if (mtl) { group.add(mtl.group); montrealTerrainLook(terrain.uniforms); }
  if (map.venue === 'interlagos') tuneInterlagosTerrain(terrain.uniforms);
  const zv = map.venue === 'zandvoort' ? buildZandvoortScenery(layout, track, map, terrain) : null;
  if (zv) group.add(zv.group);
  lap('villages');
  // distant mountains / skylines beyond the far terrain (per-venue preset, horizon.ts)
  const horizon = buildHorizon(HORIZON_PRESETS[map.venue] ?? HORIZON_PRESETS.park, map.A.center, map.height(map.A.center.x, map.A.center.z));
  group.add(horizon.mesh);
  lap('horizon');

  if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__park = { map, layout, veg, masks };

  return {
    group,
    heightAt: (x, z) => map.height(x, z),
    setLight(l) {
      // materials read the shared weather uniforms and the scene lights directly;
      // trees need the sun direction for their leaf shadow offset
      veg.uniforms.uSunW.value.copy(l.sunDir);
      horizon.setLight(l);
      zv?.setLight(l);
      // share of direct sun in the light (clear afternoon ≈ 1, grey deck ≈ 0)
      const sunL = l.sunColor.r * 0.2126 + l.sunColor.g * 0.7152 + l.sunColor.b * 0.0722;
      setLeafFill(veg.uniforms, (sunL - 0.4) / 2.6);
    },
    update(_dt, camera, elapsed) {
      veg.update(camera, elapsed);
      horizon.update(camera);
      zv?.update(elapsed, camera);
      mtl?.update(elapsed);
      stands.update(elapsed);
    },
    setQuality(q) {
      veg.setDetail(q);
    },
    stats: { timings, trees: veg.count, treesNear: veg.near, people: stands.people, flags: stands.flags, banking: banking?.stats ?? null, buildings: villages.count, buildMs: Math.round(performance.now() - t0), map: map.timings, veg: veg.timings, masks: masks.timings },
  };
}
