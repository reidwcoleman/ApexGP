import * as THREE from 'three';
import type { Track } from './Track.ts';
import type { Renderer } from '../core/Renderer.ts';
import { aerialParams, aerialSunColor, aerialSunDir, installAerialFog } from './env/fog.ts';
import { computeSky, LUT_SCALE, type SkyLUT } from './env/atmosphere.ts';
import { createSkyDome } from './env/sky.ts';
import { PRESETS } from './env/presets.ts';
import { WorldMap } from './env/worldmap.ts';
import { buildTerrain } from './env/terrain.ts';
import { buildSea } from './env/sea.ts';
import { planLayout } from './env/layout.ts';
import { buildVegetation } from './env/vegetation.ts';
import { buildGrandstands } from './env/grandstands.ts';
import { buildPitBuilding, type GarageSlot } from './env/pitbuilding.ts';
import { buildTown } from './env/town.ts';
import { buildHarbour } from './env/harbour.ts';

/**
 * Everything beyond the barriers: sky, sun, clouds, environment map, aerial fog,
 * terrain, sea, vegetation, grandstands + crowds, pit building / paddock,
 * lighthouse, harbour, town and hills.
 *
 * Game loop contract:
 *   const env = createEnvironment(track, gfx, scene, 'golden');
 *   each frame:  env.update(dt, camera);  env.focusShadow(playerPosition);
 */

export type TimeOfDay = 'day' | 'golden' | 'overcast';

export interface Environment {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  focusShadow(target: THREE.Vector3): void;
  setTimeOfDay(t: TimeOfDay): void;
  update(dt: number, camera: THREE.Camera): void;
  /** extras (not part of the core contract) */
  readonly timeOfDay: TimeOfDay;
  readonly buildMs: number;
  /** build breakdown + instance counts */
  readonly stats: Record<string, unknown>;
  /** terrain height at world (x, z) */
  heightAt(x: number, z: number): number;
  /** team garages along the pit building (TEAMS order): pit box s + lateral */
  readonly garages: GarageSlot[];
}

const DEG = Math.PI / 180;
const SHADOW_BOX = 120;
const SHADOW_MAP = 4096;

export function createEnvironment(track: Track, gfx: Renderer, scene: THREE.Scene, time: TimeOfDay): Environment {
  installAerialFog();
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = 'Environment';
  scene.add(group);

  // ------------------------------------------------------------ world shape
  const timings: Record<string, number> = {};
  let tLap = t0;
  const lap = (k: string) => {
    const n = performance.now();
    timings[k] = Math.round(n - tLap);
    tLap = n;
  };
  const map = new WorldMap(track);
  const layout = planLayout(track, map);
  lap('fields');
  map.bakeMasks();
  map.bake();
  lap('bake');

  const terrain = buildTerrain(map, gfx.maxAnisotropy);
  group.add(terrain.group);
  lap('terrain');
  const sea = buildSea(map);
  group.add(sea.mesh);
  lap('sea');
  const veg = buildVegetation(map, { palms: layout.palms, cypresses: layout.cypresses });
  group.add(veg.group);
  lap('vegetation');
  const stands = buildGrandstands(layout.grandstands, (x, z) => map.height(x, z), (x, z) => map.height(x, z) + 0.05);
  group.add(stands.group);
  const pitb = buildPitBuilding(track, layout);
  group.add(pitb.group);
  lap('stands+pits');
  const town = buildTown(map, layout, track);
  group.add(town.group);
  const harbour = buildHarbour(map, layout);
  group.add(harbour.group);
  lap('town+harbour');

  // ------------------------------------------------------------ sky + light
  const sky = createSkyDome();
  group.add(sky.mesh);
  const envScene = new THREE.Scene();
  envScene.add(sky.envMesh);
  const pmrem = new THREE.PMREMGenerator(gfx.renderer);
  let envRT: THREE.WebGLRenderTarget | null = null;

  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.name = 'Sun';
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  const sc = sun.shadow.camera;
  sc.left = -SHADOW_BOX / 2;
  sc.right = SHADOW_BOX / 2;
  sc.top = SHADOW_BOX / 2;
  sc.bottom = -SHADOW_BOX / 2;
  sc.near = 1;
  sc.far = 700;
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = 2;
  group.add(sun);
  group.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4030, 0.1);
  group.add(hemi);

  const fog = new THREE.Fog(0xb0b8c0, 900, 16000);
  scene.fog = fog;

  const sunDir = new THREE.Vector3(0, 1, 0);
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const focusSnap = new THREE.Vector3();
  const camFwd = new THREE.Vector3();
  let haveCam = false;
  let shadowHalfH = SHADOW_BOX / 2;

  const lutCache = new Map<TimeOfDay, SkyLUT>();
  let current: TimeOfDay = time;

  function setTimeOfDay(t: TimeOfDay) {
    current = t;
    const P = PRESETS[t];
    const el = P.sunElevation * DEG;
    const az = P.sunAzimuth * DEG;
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    let lut = lutCache.get(t);
    if (!lut) {
      lut = computeSky({ sunElevation: el, mie: P.mie, g: P.g, ms: P.ms });
      lutCache.set(t, lut);
    }
    const T = lut.sunT;
    const tMax = Math.max(T.r, T.g, T.b);
    const E0 = P.sunIntensity / tMax;
    const skyScale = E0 * P.skyBoost;
    const sunCol = new THREE.Color(T.r / tMax, T.g / tMax, T.b / tMax);

    sun.color.copy(sunCol);
    sun.intensity = P.sunIntensity;

    // colours sampled from the LUT (radiance, linear)
    const S = (e: number, phi: number) => lut!.sample(e * DEG, phi * DEG).multiplyScalar(skyScale);
    const zenith = S(89, 90);
    const horizonAway = S(1.2, 180).add(S(1.2, 120)).add(S(1.2, 90)).multiplyScalar(1 / 3);
    const horizonToward = S(1.2, 0);
    const mid = S(25, 150);

    const u = sky.uniforms;
    u.uLut.value = lut.texture;
    u.uSkyScale.value = skyScale * LUT_SCALE;
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    (u.uSunDisc.value as THREE.Vector3).set(sunCol.r, sunCol.g, sunCol.b).multiplyScalar(P.sunDisc * P.sunIntensity);
    (u.uCloud.value as THREE.Vector4).set(...P.clouds);
    const sunRad = (E0 / Math.PI) * 1.15;
    (u.uCloudSun.value as THREE.Vector3).set(T.r * sunRad, T.g * sunRad, T.b * sunRad);
    const amb = zenith.clone().multiplyScalar(0.55).add(horizonAway.clone().multiplyScalar(0.45));
    if (P.overcast > 0) {
      const l = amb.r * 0.3 + amb.g * 0.55 + amb.b * 0.15;
      amb.setRGB(l * 1.05, l * 1.08, l * 1.12).multiplyScalar(2.2);
    }
    (u.uCloudAmb.value as THREE.Vector3).set(amb.r, amb.g, amb.b);
    (u.uCloudDark.value as THREE.Vector3).set(amb.r * 0.45, amb.g * 0.47, amb.b * 0.52);
    // ground seen in reflections: dry grass/earth lit by sun + sky
    const irr = (P.sunIntensity * Math.max(0.05, sunDir.y)) / Math.PI;
    const skyIrr = (zenith.g + horizonAway.g) * 0.5;
    const ga = new THREE.Color(0x6b6448);
    (u.uGround.value as THREE.Vector3).set(ga.r * (irr * sunCol.r + skyIrr), ga.g * (irr * sunCol.g + skyIrr), ga.b * (irr * sunCol.b + skyIrr * 1.1));

    // aerial fog
    const fogCol = P.overcast > 0 ? new THREE.Color(amb.r * 0.9, amb.g * 0.92, amb.b * 0.95) : horizonAway.clone();
    fog.color.copy(fogCol);
    aerialParams.x = P.fogDensity;
    aerialParams.y = P.fogFalloff;
    aerialParams.z = 0;
    aerialParams.w = 1;
    aerialSunDir.x = sunDir.x;
    aerialSunDir.y = sunDir.y;
    aerialSunDir.z = sunDir.z;
    const lobe = horizonToward.clone().sub(fogCol).multiplyScalar(P.fogLobe / 1.45);
    aerialSunColor.r = Math.max(0, lobe.r);
    aerialSunColor.g = Math.max(0, lobe.g);
    aerialSunColor.b = Math.max(0, lobe.b);

    hemi.color.copy(mid).multiplyScalar(1 / Math.max(1e-3, Math.max(mid.r, mid.g, mid.b)));
    hemi.groundColor.set(0x5a4c38);
    hemi.intensity = P.hemi;

    scene.environmentIntensity = P.envIntensity;
    (veg.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir);
    (veg.uniforms.uSunCol.value as THREE.Color).copy(sunCol).multiplyScalar(P.sunIntensity);
    sea.uniforms.uWaveScale.value = P.waves;

    // post
    gfx.grade.set(P.grade);
    gfx.bloom.intensity = P.bloom;
    gfx.bloom.luminanceMaterial.threshold = P.bloomThreshold;

    // shadow box height adapts to the sun elevation (see focusShadow)
    shadowHalfH = Math.min(SHADOW_BOX / 2, (SHADOW_BOX / 2) * Math.sin(el) + 20);
    sc.top = shadowHalfH;
    sc.bottom = -shadowHalfH;
    sc.updateProjectionMatrix();
    lightRight.crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
    lightUp.crossVectors(sunDir, lightRight).normalize();

    // environment map
    sky.envMesh.position.set(0, 0, 0);
    const prev = envRT;
    envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
    scene.environment = envRT.texture;
    if (prev) prev.dispose();
    applyFocus();
  }

  function applyFocus() {
    // texel-snapped placement in light space
    const texW = SHADOW_BOX / SHADOW_MAP;
    const texH = (shadowHalfH * 2) / SHADOW_MAP;
    const a = Math.round(focus.dot(lightRight) / texW) * texW;
    const b = Math.round(focus.dot(lightUp) / texH) * texH;
    const c = focus.dot(sunDir);
    const center = focusSnap.set(0, 0, 0).addScaledVector(lightRight, a).addScaledVector(lightUp, b).addScaledVector(sunDir, c);
    sun.target.position.copy(center);
    sun.position.copy(center).addScaledVector(sunDir, 350);
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  function focusShadow(target: THREE.Vector3) {
    focus.copy(target);
    // push the box ahead of the camera so more of the visible ground is shadowed
    if (haveCam) focus.addScaledVector(camFwd, 28);
    applyFocus();
  }

  let elapsed = 0;
  function update(dt: number, camera: THREE.Camera) {
    elapsed += dt;
    sky.mesh.position.copy(camera.position);
    sky.uniforms.uTime.value = elapsed;
    sea.uniforms.uTime.value = elapsed;
    veg.uniforms.uTime.value = elapsed;
    veg.update(camera);
    stands.update(elapsed);
    town.update(dt);
    harbour.update(elapsed);
    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    if (camFwd.lengthSq() > 1e-6) {
      camFwd.normalize();
      haveCam = true;
    }
  }

  setTimeOfDay(time);
  lap('sky+env');
  const buildMs = performance.now() - t0;
  const stats = {
    buildMs: Math.round(buildMs),
    timings,
    trees: veg.count,
    treesNear: veg.nearCount,
    people: stands.people,
    houses: town.houses,
    boats: harbour.boats,
  };
  console.info(`[shot] [env] built in ${stats.buildMs} ms ${JSON.stringify(stats)}`);

  return {
    group,
    sun,
    focusShadow,
    setTimeOfDay,
    update,
    get timeOfDay() {
      return current;
    },
    buildMs,
    stats,
    heightAt: (x: number, z: number) => map.height(x, z),
    garages: pitb.garages,
  };
}
