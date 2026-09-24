import * as THREE from 'three';
import type { SunLight } from 'three/examples/jsm/lights/SunLight.js';
import type { Track } from './Track.ts';
import type { Renderer, QualityLevel, GradeLook } from '../core/Renderer.ts';
import { aerialParams, aerialSunColor, aerialSunDir, installAerialFog } from './env/fog.ts';
import { computeSky, LUT_SCALE, type SkyLUT } from './env/atmosphere.ts';
import { createSkyDome } from './env/sky.ts';
import { createCloudNoise } from './env/skyNoise.ts';
import { createCloudPanorama } from './env/skyClouds.ts';
import { createSun, cloudShadowA, cloudShadowB } from './env/lightShadows.ts';
import { createRain } from './env/rain.ts';
import { TIME_PRESETS, lookDelta, sunDirection, weatherLook, type WeatherLook } from './env/presets.ts';
import { buildScenery, type Scenery, type SceneryLight } from './env/scenery.ts';
import type { TimeOfDay, WeatherState } from './Weather.ts';

/**
 * Everything beyond the barriers: sky, sun, clouds, environment map, aerial
 * fog, rain, and the scenery (terrain, park, grandstands, paddock…).
 *
 * Game loop contract:
 *   const env = createEnvironment(track, gfx, scene, weather.state);
 *   each frame:  env.setWeather(weather.state); env.update(dt, camera); env.focusShadow(playerPos);
 *
 * `setWeather` blends time of day × cloud × rain × mist continuously into the
 * sun, sky, clouds, fog, env map, grade and bloom; cheap when nothing changed.
 * The env map (`scene.environment`) is the real sky and is re-filtered in place
 * (same texture object) at most every 0.5 s when the look drifts, so car and
 * road reflections follow the weather.
 */

export interface Environment {
  group: THREE.Group;
  /** the sun (three's cascaded SunLight; position = direction toward the sun) */
  sun: SunLight;
  /** centre of the sharp shadow cascade (the player car) — call every frame */
  focusShadow(target: THREE.Vector3): void;
  /** called every frame with the live weather; cheap when little changed */
  setWeather(w: WeatherState): void;
  update(dt: number, camera: THREE.Camera): void;
  /** terrain height at world (x, z) */
  heightAt(x: number, z: number): number;
  readonly buildMs: number;
  /** build breakdown + instance counts */
  readonly stats: Record<string, unknown>;
}

const DEG = Math.PI / 180;
/** ground irradiance the grade is calibrated for (clear 15:00 sun) */
const E_REF = 4.0;

const QUALITY: Record<QualityLevel, { shadowMap: number; farSize: number; rain: number }> = {
  low: { shadowMap: 1024, farSize: 280, rain: 0.45 },
  medium: { shadowMap: 1536, farSize: 320, rain: 0.7 },
  high: { shadowMap: 2048, farSize: 360, rain: 1 },
  ultra: { shadowMap: 3072, farSize: 420, rain: 1 },
};
/** env cube face size (fixed: see setQuality) */
const ENV_SIZE = 256;

/** a flat lawn standing in for the scenery (dev: ?scenery=0, or if the scenery build throws) */
function stubScenery(): Scenery {
  const group = new THREE.Group();
  group.name = 'SceneryStub';
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12000, 12000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4d6a2c, roughness: 0.95 }),
  );
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  group.add(ground);
  return { group, heightAt: () => 0, setLight() {}, update() {}, setQuality() {}, stats: { stub: true } };
}

export function createEnvironment(
  track: Track,
  gfx: Renderer,
  scene: THREE.Scene,
  weather: WeatherState,
  opts: { scenery?: boolean } = {},
): Environment {
  installAerialFog();
  const renderer = gfx.renderer;
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
  let scenery: Scenery;
  if (opts.scenery === false) scenery = stubScenery();
  else {
    try {
      scenery = buildScenery(track, gfx);
    } catch (e) {
      console.error('[env] scenery build failed — using a flat stand-in', e);
      scenery = stubScenery();
    }
  }
  group.add(scenery.group);
  lap('scenery');

  // ------------------------------------------------------------ sky
  let quality: QualityLevel = gfx.qualityLevel;
  const noise = createCloudNoise(renderer);
  const clouds = createCloudPanorama(renderer, noise, quality);
  const sky = createSkyDome();
  sky.uniforms.uPano.value = clouds.texture;
  sky.uniforms.uPanoSize.value = clouds.uniforms.uRes.value;
  group.add(sky.mesh);
  lap('clouds');

  // environment map: sky → cube (6 × dome) → PMREM, re-filtered into the same target
  const envScene = new THREE.Scene();
  envScene.add(sky.envMesh);
  const cubeRT = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.1, 10, cubeRT);
  envScene.add(cubeCam);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT: THREE.WebGLRenderTarget | null = null;

  // ------------------------------------------------------------ light
  const rig = createSun();
  const sun = rig.sun;
  group.add(sun);
  rig.setQuality(QUALITY[quality].shadowMap, QUALITY[quality].farSize);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4030, 0.1);
  group.add(hemi);

  const fog = new THREE.Fog(0xb0b8c0, 900, 16000);
  scene.fog = fog;

  const rain = createRain();
  group.add(rain.group);
  rain.setDensity(QUALITY[quality].rain);

  // ------------------------------------------------------------ state
  /** dev toggles (perf A/B from the console: __env.stats.debug.clouds = false) */
  const debug: { clouds: boolean; boltAz: number | null } = { clouds: true, boltAz: null };
  const sunDir = new THREE.Vector3(0, 1, 0);
  const camFwd = new THREE.Vector3();
  const camPos = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const windOff = new THREE.Vector2(3000, -1200);
  let haveCam = false;
  const lutCache = new Map<TimeOfDay, SkyLUT>();
  let curTime: TimeOfDay | null = null;
  let look: WeatherLook = weatherLook(weather);
  let bakedLook: WeatherLook | null = null;
  let lastBake = -1e9;
  let bakeAge = 0;
  let elapsed = 0;
  const wind = { x: weather.windX, z: weather.windZ };
  let lastLightning = 0;
  let flashLevel = 0;
  const last = { cloud: -1, rain: -1, fog: -1, time: '' as string };

  // colours derived from the atmosphere for the current time (linear radiance)
  const C = {
    sunCol: new THREE.Color(),
    E0: 1,
    skyScale: 1,
    zenith: new THREE.Color(),
    horizonAway: new THREE.Color(),
    horizonToward: new THREE.Color(),
    mid: new THREE.Color(),
    skyIrr: 1,
  };

  function setTime(t: TimeOfDay) {
    curTime = t;
    const P = TIME_PRESETS[t];
    sunDirection(P, sunDir);
    let l = lutCache.get(t);
    if (!l) {
      l = computeSky({ sunElevation: P.elevation * DEG, mie: P.mie, g: P.g, ms: P.ms });
      lutCache.set(t, l);
    }
    const T = l.sunT;
    const tMax = Math.max(T.r, T.g, T.b);
    C.E0 = P.sunIntensity / tMax;
    C.skyScale = C.E0 * P.skyBoost;
    C.sunCol.setRGB(T.r / tMax, T.g / tMax, T.b / tMax);
    const S = (e: number, phi: number) => l!.sample(e * DEG, phi * DEG).multiplyScalar(C.skyScale);
    C.zenith.copy(S(89, 90));
    C.horizonAway.copy(S(1.5, 180)).add(S(1.5, 120)).add(S(1.5, 90)).multiplyScalar(1 / 3);
    C.horizonToward.copy(S(1.5, 0));
    C.mid.copy(S(25, 150));
    // mean sky radiance over the upper hemisphere (for the overcast deck)
    C.skyIrr = (C.zenith.g * 0.5 + C.mid.g * 0.3 + C.horizonAway.g * 0.2) * Math.PI;

    const u = sky.uniforms;
    u.uLut.value = l.texture;
    u.uSkyScale.value = C.skyScale * LUT_SCALE;
    (u.uSunDir.value as THREE.Vector3).copy(sunDir);
    rig.setDirection(sunDir);
    aerialSunDir.x = sunDir.x;
    aerialSunDir.y = sunDir.y;
    aerialSunDir.z = sunDir.z;
    const cu = clouds.uniforms;
    (cu.uSunDir.value as THREE.Vector3).copy(sunDir);
    cloudShadowB.x = sunDir.x / Math.max(0.08, sunDir.y);
    cloudShadowB.y = sunDir.z / Math.max(0.08, sunDir.y);
    clouds.invalidate();
  }

  const gradeLook: GradeLook = { exposure: 1, saturation: 1, contrast: 1, tint: [1, 1, 1], shadowTint: [1, 1, 1] };
  const lightInfo: Record<string, number> = {};
  const tmpA = new THREE.Color();
  const tmpB = new THREE.Color();
  const deck = new THREE.Color();
  const deckTint = new THREE.Color();

  /** push a look into every uniform (cheap: no allocation of GPU resources) */
  function applyLook(L: WeatherLook) {
    if (L.time !== curTime) setTime(L.time);
    const P = TIME_PRESETS[L.time];
    const el = P.elevation * DEG;

    // ---- sun
    const sunI = P.sunIntensity * L.sunVis;
    sun.color.copy(C.sunCol);
    sun.intensity = sunI;
    rig.shadow.radius = L.shadowRadius;
    rig.shadow.intensity = THREE.MathUtils.clamp(0.35 + L.sunVis * 0.65, 0, 1);

    // ---- overcast deck radiance (diffuse light through the clouds)
    const Eh = P.sunIntensity * Math.max(0.12, Math.sin(el)) + C.skyIrr;
    const deckRad = (Eh / Math.PI) * 0.36 * L.deckLight * (1 - 0.35 * L.rain * L.rain);
    const skyGrey = C.zenith.r * 0.2 + C.zenith.g * 0.7 + C.zenith.b * 0.1;
    // deck colour: cool neutral grey, a touch warm at golden hour
    deck.setRGB(0.93, 0.97, 1.05).multiplyScalar(deckRad);
    if (L.time === 'golden') deck.multiply(tmpA.setRGB(1.06, 1.0, 0.94));

    // ---- clouds
    const cu = clouds.uniforms;
    cu.uCoverage.value = L.coverage;
    cu.uBase.value = L.cloudBase;
    cu.uThick.value = L.cloudThick;
    cu.uExt.value = L.cloudExt;
    cu.uDark.value = L.cloudDark;
    cu.uFloor.value = THREE.MathUtils.smoothstep(L.coverage, 0.7, 0.95) * 0.55;
    cu.uHaze.value = L.cloudHaze;
    cu.uCirrus.value = L.cirrus;
    cu.uRain.value = L.rain;
    // sunlight reaching the cloud layer (not dimmed by the clouds themselves)
    const sunRad = C.E0 * 7.5 * 0.24;
    // evening light on cloud undersides reads pinker than the direct beam (it has crossed more air)
    const cw = L.time === 'golden' ? [1.06, 0.86, 0.78] : [1, 1, 1];
    (cu.uSunCol.value as THREE.Vector3).set(C.sunCol.r * sunRad * cw[0], C.sunCol.g * sunRad * cw[1], C.sunCol.b * sunRad * cw[2]);
    const clearTop = tmpA.copy(C.zenith).multiplyScalar(1.25).add(tmpB.copy(C.sunCol).multiplyScalar((P.sunIntensity * Math.max(0.1, Math.sin(el)) / Math.PI) * 0.22));
    const clearBase = tmpB.copy(C.horizonAway).multiplyScalar(0.36).multiply(deckTint.setRGB(0.92, 0.97, 1.08));
    const ov = L.overcast;
    (cu.uAmbTop.value as THREE.Vector3).set(
      THREE.MathUtils.lerp(clearTop.r, deck.r * 3, ov),
      THREE.MathUtils.lerp(clearTop.g, deck.g * 3, ov),
      THREE.MathUtils.lerp(clearTop.b, deck.b * 3, ov),
    );
    (cu.uAmbBase.value as THREE.Vector3).set(
      THREE.MathUtils.lerp(clearBase.r, deck.r, ov),
      THREE.MathUtils.lerp(clearBase.g, deck.g, ov),
      THREE.MathUtils.lerp(clearBase.b, deck.b, ov),
    );
    (cu.uCirrusCol.value as THREE.Vector3).set(C.sunCol.r * C.E0 * 0.09 + C.zenith.r, C.sunCol.g * C.E0 * 0.09 + C.zenith.g, C.sunCol.b * C.E0 * 0.09 + C.zenith.b);
    (cu.uRainCol.value as THREE.Vector3).set(deck.r * 0.95, deck.g * 0.97, deck.b * 1.0);

    // ---- sky dome
    const u = sky.uniforms;
    u.uOvercast.value = ov;
    (u.uOvZenith.value as THREE.Vector3).set(deck.r * 0.92, deck.g * 0.93, deck.b * 0.96);
    (u.uOvHorizon.value as THREE.Vector3).set(deck.r * 1.22, deck.g * 1.24, deck.b * 1.26);
    const disc = P.sunDisc * P.sunIntensity * L.sunVis;
    (u.uSunDisc.value as THREE.Vector3).set(C.sunCol.r * disc, C.sunCol.g * disc, C.sunCol.b * disc);

    // ---- fog / haze: clear-sky horizon → grey mist
    const fogCol = tmpA.copy(C.horizonAway).lerp(tmpB.set(deck.r * 1.2, deck.g * 1.22, deck.b * 1.25), Math.max(ov, L.mist * 0.9));
    fog.color.copy(fogCol);
    aerialParams.x = L.fogDensity;
    aerialParams.y = L.fogFalloff;
    aerialParams.z = 0;
    aerialParams.w = L.fogMax;
    const lobe = tmpB.copy(C.horizonToward).sub(fogCol).multiplyScalar(L.fogLobe / 1.45);
    aerialSunColor.r = Math.max(0, lobe.r);
    aerialSunColor.g = Math.max(0, lobe.g);
    aerialSunColor.b = Math.max(0, lobe.b);

    // ---- ground in reflections: dry grass/earth, darker and glossier when wet
    const irr = (P.sunIntensity * L.sunVis * Math.max(0.05, sunDir.y)) / Math.PI;
    const skyIrr = THREE.MathUtils.lerp((C.zenith.g + C.horizonAway.g) * 0.5, deckRad, ov);
    const gw = 1 - 0.45 * L.rain;
    (u.uGround.value as THREE.Vector3).set(
      0.1 * (irr * C.sunCol.r + skyIrr) * gw,
      0.095 * (irr * C.sunCol.g + skyIrr) * gw,
      0.07 * (irr * C.sunCol.b + skyIrr * 1.1) * gw,
    );

    // ---- fill light
    const mid = tmpA.copy(C.mid).lerp(tmpB.copy(deck), ov);
    hemi.color.copy(mid).multiplyScalar(1 / Math.max(1e-3, Math.max(mid.r, mid.g, mid.b)));
    hemi.groundColor.setRGB(0.35, 0.3, 0.22).multiplyScalar(0.4 + 0.6 * L.sunVis);
    hemi.intensity = L.hemi;

    // ---- ground cloud shadows (broken cumulus only; a closed deck already killed the sun)
    cloudShadowA.x = 0.82 * THREE.MathUtils.smoothstep(L.coverage, 0.12, 0.3) * (1 - ov);
    cloudShadowA.y = L.coverage;
    cloudShadowB.z = L.cloudBase + L.cloudThick * 0.35;

    // ---- rain streaks: lit by the sky
    const rc = tmpA.set(skyGrey, skyGrey, skyGrey).lerp(deck, ov).multiplyScalar(0.55);
    rain.set(L.rain, wind.x, wind.z, rc);

    // ---- eye adaptation: expose (partially) for the light falling on the ground, so a grey
    // day or a golden evening stays readable while keeping its mood
    const skyE = THREE.MathUtils.lerp(C.skyIrr, Math.PI * deckRad * 1.15, ov);
    const eGround = sunI * Math.max(0.05, Math.sin(el)) + skyE;
    const adapt = THREE.MathUtils.clamp(Math.pow(E_REF / Math.max(0.05, eGround), 0.5), 0.7, 4);
    gradeLook.exposure = L.exposure * adapt;
    sky.uniforms.uSkyComp.value = Math.pow(adapt, -0.5);
    sky.uniforms.uHalo.value = (L.time === 'golden' ? 1.6 : L.time === 'morning' ? 1.2 : 0.8) * (0.4 + 0.6 * L.sunVis);
    gradeLook.saturation = L.saturation;
    gradeLook.contrast = L.contrast;
    gradeLook.tint = L.tint;
    gradeLook.shadowTint = L.shadowTint;
    lightInfo.eGround = +eGround.toFixed(3);
    lightInfo.adapt = +adapt.toFixed(3);
    lightInfo.deckRad = +deckRad.toFixed(3);
    lightInfo.skyIrr = +C.skyIrr.toFixed(3);

    // ---- post
    gfx.grade.setLook(gradeLook);
    gfx.bloom.intensity = L.bloom;
    gfx.bloom.luminanceMaterial.threshold = L.bloomThreshold;
    gfx.setSunShafts(sunDir, L.shafts * 0.9, 0.55 * C.E0 * 0.25);

    sceneryLight.sunColor.copy(C.sunCol).multiplyScalar(sunI);
    sceneryLight.skyAmbient.copy(C.zenith).multiplyScalar(0.55).add(tmpB.copy(C.horizonAway).multiplyScalar(0.45)).lerp(deck, ov);
    sceneryLight.rain = L.rain;
    pushSceneryLight();
  }
  const sceneryLight: SceneryLight = {
    sunDir,
    sunColor: new THREE.Color(),
    skyAmbient: new THREE.Color(),
    wetness: weather.wetness,
    rain: 0,
    windX: weather.windX,
    windZ: weather.windZ,
  };
  let sentWet = -1;
  function pushSceneryLight() {
    sentWet = sceneryLight.wetness;
    scenery.setLight(sceneryLight);
  }

  // ------------------------------------------------------------ env map
  let bakeStage = 0; // 0 idle, 1 cube rendered → filter next frame
  function bakeCube() {
    sky.envMesh.position.set(0, 0, 0);
    const prevAuto = renderer.autoClear;
    renderer.autoClear = true;
    cubeCam.update(renderer, envScene);
    renderer.autoClear = prevAuto;
  }
  function bakeFilter() {
    if (!envRT) {
      envRT = pmrem.fromCubemap(cubeRT.texture);
      scene.environment = envRT.texture;
    } else {
      pmrem.fromCubemap(cubeRT.texture, envRT);
    }
  }
  function bakeNow() {
    bakeCube();
    bakeFilter();
    bakedLook = look;
    lastBake = elapsed;
    bakeAge = 0;
  }

  function setQuality(q: QualityLevel) {
    quality = q;
    const Q = QUALITY[q];
    clouds.setQuality(q);
    rig.setQuality(Q.shadowMap, Q.farSize);
    rain.setDensity(Q.rain);
    scenery.setQuality(q);
    // (the env map keeps its size on every level: cars hold a reference to scene.environment,
    // so that texture object must never be replaced)
    bakedLook = null;
  }

  // ------------------------------------------------------------ public
  function focusShadow(target: THREE.Vector3) {
    focus.copy(target);
    if (haveCam) focus.addScaledVector(camFwd, 14);
    rig.shadow.focus.copy(focus);
  }

  function setWeather(w: WeatherState) {
    wind.x = w.windX;
    wind.z = w.windZ;
    sceneryLight.wetness = w.wetness;
    sceneryLight.windX = w.windX;
    sceneryLight.windZ = w.windZ;
    const changed =
      w.time !== last.time || Math.abs(w.cloud - last.cloud) > 0.002 || Math.abs(w.rain - last.rain) > 0.002 || Math.abs(w.fog - last.fog) > 0.004;
    if (changed) {
      last.cloud = w.cloud;
      last.rain = w.rain;
      last.fog = w.fog;
      const timeChanged = w.time !== last.time;
      last.time = w.time;
      look = weatherLook(w);
      applyLook(look);
      if (timeChanged) {
        clouds.invalidate();
        bakedLook = null;
      }
    } else if (Math.abs(w.wetness - sentWet) > 0.02) {
      // the track dries (or floods) while the sky holds still
      pushSceneryLight();
    }
    // lightning: a flicker that lights the deck, the scene and the exposure
    const L = Math.max(0, Math.min(1, w.lightning));
    if (L > 0.5 && lastLightning <= 0.5 && flashLevel < 0.3) {
      // new strike: somewhere in the sky, a bolt for the first flicker
      const a = debug.boltAz !== null ? Math.atan2(-Math.cos((debug.boltAz * Math.PI) / 180), Math.sin((debug.boltAz * Math.PI) / 180)) : Math.random() * Math.PI * 2;
      (sky.uniforms.uFlashDir.value as THREE.Vector3).set(Math.cos(a), 0.12 + Math.random() * 0.1, Math.sin(a)).normalize();
      sky.uniforms.uBoltSeed.value = Math.random() * 100;
      sky.uniforms.uBoltTop.value = Math.atan2(look.cloudBase, 1800 + Math.random() * 4500);
    }
    lastLightning = L;
    flashLevel = L;
    sky.uniforms.uFlash.value = L;
    // the deck lit from inside: several times its own brightness, cold white
    (sky.uniforms.uFlashCol.value as THREE.Vector3).set(0.9, 0.95, 1.15).multiplyScalar(Math.max(0.12, lightInfo.deckRad ?? 0.2) * 4.5);
    sky.uniforms.uBolt.value = L > 0.6 ? L : 0;
    scene.environmentIntensity = look.envIntensity * (1 + L * 0.9);
    gfx.setFlash(L * 0.18);
  }

  function update(dt: number, camera: THREE.Camera) {
    elapsed += dt;
    camera.getWorldPosition(camPos);
    sky.mesh.position.copy(camPos);
    sky.uniforms.uTime.value = elapsed;

    // quality follows the renderer
    if (gfx.qualityLevel !== quality) setQuality(gfx.qualityLevel);

    // clouds drift with the wind aloft (stronger than at the ground, veering a little)
    const ws = 2.6;
    windOff.x += (wind.x * ws + 3.5) * dt;
    windOff.y += (wind.z * ws + 1.2) * dt;
    (clouds.uniforms.uWind.value as THREE.Vector2).copy(windOff);
    cloudShadowA.z = windOff.x;
    cloudShadowA.w = windOff.y;
    if (debug.clouds) clouds.update(dt, camPos);
    sky.uniforms.uPano.value = clouds.texture;

    rain.update(dt, camera);
    scenery.update(dt, camera, elapsed);

    // env map: re-filter in place when the look drifted (or clouds moved on), spread over 2 frames
    bakeAge += dt;
    if (bakeStage === 1) {
      bakeFilter();
      bakeStage = 0;
      bakedLook = look;
      lastBake = elapsed;
      bakeAge = 0;
    } else if (elapsed - lastBake > 0.5) {
      const d = bakedLook ? lookDelta(look, bakedLook) : 1;
      if (d > 0.025 || (bakeAge > 15 && look.coverage > 0.15)) {
        bakeCube();
        bakeStage = 1;
      }
    }

    camera.getWorldDirection(camFwd);
    camFwd.y = 0;
    if (camFwd.lengthSq() > 1e-6) {
      camFwd.normalize();
      haveCam = true;
    }
  }

  // ------------------------------------------------------------ initial state
  setWeather(weather);
  // prime the clouds and the env map so the first frame is complete
  clouds.update(0, camPos.set(track.px[0] ?? 0, 2, track.pz[0] ?? 0));
  sky.uniforms.uPano.value = clouds.texture;
  bakeNow();
  lap('sky+env');

  const buildMs = performance.now() - t0;
  const stats: Record<string, unknown> = {
    buildMs: Math.round(buildMs),
    debug,
    light: lightInfo,
    timings,
    scenery: scenery.stats,
    get rainDrops() {
      return rain.drops;
    },
    get quality() {
      return quality;
    },
  };
  console.info(`[shot] [env] built in ${Math.round(buildMs)} ms ${JSON.stringify({ timings, scenery: scenery.stats })}`);

  return {
    group,
    sun,
    focusShadow,
    setWeather,
    update,
    buildMs,
    stats,
    heightAt: (x: number, z: number) => scenery.heightAt(x, z),
  };
}
