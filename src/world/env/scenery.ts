import { buildSkyline } from './skyline.ts';
import * as THREE from 'three';
import type { Track } from '../Track.ts';
import type { Renderer } from '../../core/Renderer.ts';
import { WorldMap } from './worldmap.ts';
import { buildTerrain } from './terrain.ts';
import { planLayout } from './layout.ts';
import { buildVegetation } from './vegetation.ts';
import { setLeafFill } from './treematerial.ts';
import { buildHorizon, HORIZON_PRESETS } from './horizon.ts';
import { buildGrass, type GrassBuild } from './grass.ts';
import { buildParkMasks } from './parkmask.ts';
import { buildGrandstands } from './grandstands.ts';
import { concourseCrowd } from '../../people/strollers.ts';
import { buildBanking } from './banking.ts';
import { buildSpaScenery, spaTerrainLook } from './venues/spaScenery.ts';
import { buildSilverstoneScenery } from './venues/silverstoneScenery.ts';
import { buildVillages } from './villages.ts';
import { austinTerrainLook, buildAustinScenery } from './venues/austinScenery.ts';
import { buildSpielbergScenery, spielbergTerrainLook } from './venues/spielbergScenery.ts';
import { buildMontrealScenery, montrealTerrainLook } from './venues/montrealScenery.ts';
import { buildMelbourneScenery, melbourneTerrainLook } from './venues/melbourneScenery.ts';
import { buildMexicoScenery, mexicoTerrainLook } from './venues/mexicoScenery.ts';
import { buildYasmarinaScenery, yasmarinaTerrainLook } from './venues/yasmarinaScenery.ts';
import { tuneInterlagosTerrain } from './venues/interlagosCity.ts';
import { buildZandvoortScenery } from './venues/zandvoortScenery.ts';
import { buildSakhirScenery } from './venues/sakhirScenery.ts';
import { buildHungaroringScenery } from './venues/hungaroringScenery.ts';
import { buildMonzaScenery } from './venues/monzaScenery.ts';
import { buildVenueDress } from './venues/dress.ts';

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

/** the scenery in one go (see sceneryBuilder for the sliced build behind the garage) */
export function buildScenery(track: Track, gfx: Renderer): Scenery {
  const it = sceneryBuilder(track, gfx);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * The scenery built in slices: each `yield` is a point where the caller may draw a frame (the
 * garage keeps moving while the landscape of the next circuit grows behind it). Abandoned
 * half-way, `group` of the yielded value holds what exists so far, for disposal.
 */
export function* sceneryBuilder(track: Track, gfx: Renderer): Generator<{ group: THREE.Group; step: string }, Scenery, void> {
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
  yield { group, step: 'layout' };
  tLap = performance.now();
  map.bakeMasks();
  lap('forest');
  yield { group, step: 'forest' };
  tLap = performance.now();
  map.bake();
  lap('heights');
  yield { group, step: 'heights' };
  tLap = performance.now();
  const terrain = buildTerrain(map, gfx.maxAnisotropy);
  group.add(terrain.group);
  lap('terrain');
  yield { group, step: 'terrain' };
  tLap = performance.now();
  const veg = buildVegetation(map, layout, gfx.renderer);
  veg.setDetail(gfx.qualityLevel);
  group.add(veg.group);
  lap('trees');
  yield { group, step: 'trees' };
  tLap = performance.now();
  const masks = buildParkMasks(map, layout, veg.shade);
  terrain.setMasks(masks);
  // grass blades on the verges around the camera (High/Ultra)
  let grass: GrassBuild | null = null;
  try {
    const tu = terrain.uniforms;
    grass = buildGrass(map, { lawn: tu.uLawn.value as THREE.Color, meadow: tu.uMeadow.value as THREE.Color, straw: tu.uStraw.value as THREE.Color });
    grass.setEnabled(gfx.qualityLevel === 'high' || gfx.qualityLevel === 'ultra');
    group.add(grass.mesh);
  } catch (e) {
    console.error('[scenery] grass blades failed — skipping them', e);
  }
  lap('grass');
  yield { group, step: 'grass' };
  tLap = performance.now();
  lap('masks');
  // (a failure in the stands — e.g. the crowd's avatar kit — must not take the whole landscape with it)
  let stands: Pick<ReturnType<typeof buildGrandstands>, 'group' | 'update' | 'people' | 'flags' | 'concourse'>;
  try {
    stands = buildGrandstands(layout, track, map);
  } catch (e) {
    console.error('[scenery] grandstands failed — building without them', e);
    stands = { group: new THREE.Group(), update: () => {}, people: 0, flags: 0 };
  }
  group.add(stands.group);
  // fans walking the concourses behind the stands
  const strollers = concourseCrowd(stands.concourse ?? []);
  group.add(strollers.group);
  lap('stands');
  yield { group, step: 'stands' };
  tLap = performance.now();
  const banking = layout.oval ? buildBanking(layout.oval, track, map, terrain.material) : null;
  if (banking) group.add(banking.group);
  lap('banking');
  yield { group, step: 'banking' };
  tLap = performance.now();
  const villages = buildVillages(map, layout);
  group.add(villages.group);
  if (map.venue === 'airfield') group.add(buildSilverstoneScenery(layout, map));
  if (map.venue === 'ardennes') { group.add(buildSpaScenery(map).group); spaTerrainLook(terrain.uniforms); }
  if (map.venue === 'austin') { group.add(buildAustinScenery(layout, track, map).group); austinTerrainLook(terrain.uniforms); }
  if (map.venue === 'spielberg') { group.add(buildSpielbergScenery(map)); spielbergTerrainLook(terrain.uniforms); }
  const mtl = map.venue === 'montreal' ? buildMontrealScenery(layout, track, map) : null;
  if (mtl) { group.add(mtl.group); montrealTerrainLook(terrain.uniforms); }
  const mel = map.venue === 'melbourne' ? buildMelbourneScenery(layout, track, map) : null;
  if (mel) { group.add(mel.group); melbourneTerrainLook(terrain.uniforms); }
  const mex = map.venue === 'mexico' ? buildMexicoScenery(layout, track, map) : null;
  if (mex) { group.add(mex.group); mexicoTerrainLook(terrain.uniforms); }
  const yas = map.venue === 'yasmarina' ? buildYasmarinaScenery(layout, track, map) : null;
  if (yas) { group.add(yas.group); yasmarinaTerrainLook(terrain.uniforms); }
  if (map.venue === 'interlagos') {
    tuneInterlagosTerrain(terrain.uniforms);
    // (São Paulo is real buildings out to ~13 km: the ground under them takes the full haze too)
    terrain.uniforms.uHazeEase.value = 1e9;
  }
  const zv = map.venue === 'zandvoort' ? buildZandvoortScenery(layout, track, map, terrain) : null;
  if (zv) group.add(zv.group);
  if (map.venue === 'sakhir') group.add(buildSakhirScenery(layout, track, map, terrain).group);
  if (map.venue === 'hungaroring') group.add(buildHungaroringScenery(layout, track, map, terrain));
  // Monza: the Villa Reale, Milan's towers across the plain
  if (track.def.id === 'monza') group.add(buildMonzaScenery(layout, map).group);
  // the venue's own race-weekend dressing: gantries, hoardings, painted run-off, its pit roof (venues/dress.ts)
  const dress = buildVenueDress(track, map, layout);
  if (dress) group.add(dress);
  lap('villages');
  yield { group, step: 'villages' };
  tLap = performance.now();
  // wind farms, pylon lines, oil field: what stands up out of each venue's countryside
  const skyline = buildSkyline(map);
  if (skyline) group.add(skyline.group);
  lap('skyline');
  yield { group, step: 'skyline' };
  tLap = performance.now();
  // distant mountains / skylines beyond the far terrain (per-venue preset, horizon.ts)
  const horizon = buildHorizon(HORIZON_PRESETS[map.venue] ?? HORIZON_PRESETS.park, map.A.center, map.height(map.A.center.x, map.A.center.z), map);
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
      grass?.update(camera, elapsed);
      horizon.update(camera);
      zv?.update(elapsed, camera);
      mtl?.update(elapsed);
      mel?.update(elapsed);
      mex?.update(elapsed);
      yas?.update(elapsed);
      stands.update(elapsed);
      skyline?.update(elapsed);
      strollers.update(_dt, camera);
    },
    setQuality(q) {
      veg.setDetail(q);
      grass?.setEnabled(q === 'high' || q === 'ultra');
    },
    stats: { timings, trees: veg.count, treesNear: veg.near, people: stands.people, flags: stands.flags, banking: banking?.stats ?? null, buildings: villages.count, buildMs: Math.round(performance.now() - t0), map: map.timings, veg: veg.timings, masks: masks.timings },
  };
}
