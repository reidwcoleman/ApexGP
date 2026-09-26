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
import { buildFloodField, createFloodRig, setFloodLevel } from './env/night.ts';
import { TIME_PRESETS, lookDelta, sunDirection, weatherLook, type WeatherLook } from './env/presets.ts';
import { buildScenery, type Scenery, type SceneryLight } from './env/scenery.ts';
import { isLowSun, type TimeOfDay, type WeatherState } from './Weather.ts';
import { disposeTree } from '../core/dispose.ts';

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
  /** free every GPU resource this environment owns (world switch); `keep`: shared resources to leave alone */
  dispose(keep?: Set<object>): void;
  readonly buildMs: number;
  /** build breakdown + instance counts */
  readonly stats: Record<string, unknown>;
}

const DEG = Math.PI / 180;
/** ground irradiance the grade is calibrated for (clear 15:00 sun) */
const E_REF = 4.0;
/** floodlight irradiance scale at full night (one row of lamps at the track centre) */
const FLOOD_E = 1.9;

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
  // the world in the env map: the circuit's own surroundings (terrain, trees, stands, pits,
  // the horizon) captured once from beside the track, composited over the live sky in every
  // bake — so cars and glass reflect the real place, and the diffuse fill carries the green
  // bounce off sunlit grass. Re-lit (scaled) as the light changes; re-captured on a big change.
  const worldRT = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType, generateMipmaps: false });
  const worldCam = new THREE.CubeCamera(0.4, 6000, worldRT);
  const worldUniforms = { uWorld: { value: worldRT.texture }, uWorldScale: { value: 1 } };
  const worldSphere = new THREE.Mesh(
    new THREE.SphereGeometry(4, 32, 16),
    new THREE.ShaderMaterial({
      uniforms: worldUniforms,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: /* glsl */ `
        uniform samplerCube uWorld;
        uniform float uWorldScale;
        varying vec3 vDir;
        void main() {
          vec4 w = textureCube( uWorld, normalize( vDir ) );
          if ( w.a < 0.5 ) discard;
          gl_FragColor = vec4( w.rgb * uWorldScale, 1.0 );
        }`,
    }),
  );
  worldSphere.renderOrder = 1;
  worldSphere.frustumCulled = false;
  worldSphere.visible = false;
  envScene.add(worldSphere);
  let worldE = 0;

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

  // rain splashes land on the asphalt
  let splashHint = -1;
  rain.setSurface((x, z, out) => {
    const pr = track.project(x, z, splashHint, 30);
    splashHint = pr.index;
    if (Math.abs(pr.lateral) > track.halfWidthAt(pr.s) + 1.2) return false;
    track.point(pr.s, pr.lateral, 0, out);
    return true;
  });

  // floodlights for twilight and night races (analytic light, see env/night.ts)
  const floods = createFloodRig(track, (x, z) => scenery.heightAt(x, z));
  group.add(floods.group);

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
    // moonlight: the same sun, but read by the eye as cool silver-blue
    if ((P.night ?? 0) > 0.5) C.sunCol.multiply(tmpA.setRGB(0.72, 0.84, 1.0));
    sky.uniforms.uSunRadius.value = (P.night ?? 0) > 0.5 ? 0.017 : 0.0095;
    if ((P.flood ?? 0) > 0) buildFloodField(track, renderer);
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
    const sunI = P.sunIntensity * L.sunVis * (P.direct ?? 1);
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
    if (isLowSun(L.time)) deck.multiply(tmpA.setRGB(1.06, 1.0, 0.94));

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
    const cw = L.time === 'sunset' ? [1.1, 0.78, 0.7] : isLowSun(L.time) ? [1.06, 0.86, 0.78] : [1, 1, 1];
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
    // ground bounce: sunlight off grass and asphalt, tinted by the sun (warm at golden hour),
    // lighting undersides (wings, floors, crowns). The world capture in the env map carries
    // the rest of it (the actual surroundings) through the image-based diffuse.
    const bounce = 0.4 + 0.9 * L.sunVis * Math.max(0.15, sunDir.y);
    hemi.groundColor.setRGB(0.3 * C.sunCol.r, 0.29 * C.sunCol.g, 0.19 * C.sunCol.b).multiplyScalar(bounce);
    hemi.intensity = L.hemi;

    // ---- ground cloud shadows (broken cumulus only; a closed deck already killed the sun)
    cloudShadowA.x = 0.82 * THREE.MathUtils.smoothstep(L.coverage, 0.12, 0.3) * (1 - ov);
    cloudShadowA.y = L.coverage;
    cloudShadowB.z = L.cloudBase + L.cloudThick * 0.35;

    // ---- rain streaks: lit by the sky
    const rc = tmpA.set(skyGrey, skyGrey, skyGrey).lerp(deck, ov).multiplyScalar(0.55);
    rain.set(L.rain, wind.x, wind.z, rc);
    rainBase.copy(rc);

    // ---- eye adaptation: expose (partially) for the light falling on the ground, so a grey
    // day or a golden evening stays readable while keeping its mood
    const skyE = THREE.MathUtils.lerp(C.skyIrr, Math.PI * deckRad * 1.15, ov);
    const eGround = sunI * Math.max(0.05, Math.sin(el)) + skyE + FLOOD_E * (P.flood ?? 0) * 1.4;
    const adapt = THREE.MathUtils.clamp(Math.pow(E_REF / Math.max(0.05, eGround), 0.62), 0.7, 4.5);
    gradeLook.exposure = L.exposure * adapt;
    sky.uniforms.uSkyComp.value = Math.pow(adapt, -0.5);
    sky.uniforms.uHalo.value = (isLowSun(L.time) ? 1.6 : L.time === 'morning' ? 1.2 : 0.8) * (0.4 + 0.6 * L.sunVis);
    gradeLook.saturation = L.saturation;
    gradeLook.contrast = L.contrast;
    gradeLook.tint = L.tint;
    gradeLook.shadowTint = L.shadowTint;
    lightInfo.eGround = +eGround.toFixed(3);
    if (worldE > 0) worldUniforms.uWorldScale.value = eGround / worldE;
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
    applyNightAndBow(L);
  }

  /**
   * After dark and in sun showers: the floodlights (level, glare, the light they throw into
   * mist, rain and low cloud), the night sky (moon, stars, the city's glow) and the rainbow.
   */
  const rainBase = new THREE.Color();
  /** the live weather's extra shape parameters (convective towering, heat haze) */
  const wx = { conv: 0, heat: 0, wet: -1, kind: '' as string };
  let groundY = 0;
  for (let i = 0; i < track.n; i += 10) groundY += track.py[i] / Math.ceil(track.n / 10);
  const floodCol = new THREE.Color(0.96, 0.98, 1.0);
  const cityCol = new THREE.Color(1.0, 0.56, 0.26);
  const nightTmp = new THREE.Color();
  const nightV = new THREE.Vector3();
  function applyNightAndBow(L: WeatherLook) {
    const P = TIME_PRESETS[L.time];
    const night = P.night ?? 0;
    const fl = P.flood ?? 0;
    const cu0 = clouds.uniforms;
    const wetK = THREE.MathUtils.smoothstep(L.rain, 0.02, 0.7);
    // after sunset only the tops still catch the last light
    if ((P.direct ?? 1) < 1) (cu0.uSunCol.value as THREE.Vector3).multiplyScalar(Math.pow(P.direct ?? 1, 0.3));
    // convective cloud: broken cumulus grows into towers (congestus, cumulonimbus); under a storm
    // the deck turns dark, cold and lumpy and the light goes a sickly blue-green
    const conv = wx.conv;
    cu0.uThick.value = L.cloudThick * (1 + 2.4 * conv * (1 - L.overcast * 0.6));
    cloudShadowB.z = L.cloudBase + (cu0.uThick.value as number) * 0.35;
    const storm = conv * wetK;
    if (storm > 0.001) {
      cu0.uDark.value = Math.min(1, (cu0.uDark.value as number) + 0.3 * storm);
      const dk = 1 - 0.42 * storm;
      (cu0.uAmbBase.value as THREE.Vector3).multiply(nightV.set(dk * 0.94, dk * 1.0, dk * 1.04));
      (cu0.uAmbTop.value as THREE.Vector3).multiplyScalar(1 - 0.3 * storm);
      (sky.uniforms.uOvZenith.value as THREE.Vector3).multiply(nightV.set(dk * 0.9, dk * 0.97, dk * 1.02));
      (sky.uniforms.uOvHorizon.value as THREE.Vector3).multiply(nightV.set(dk * 0.95, dk * 1.0, dk * 1.02));
      gradeLook.exposure *= 1 - 0.22 * storm;
      gradeLook.contrast *= 1 + 0.06 * storm;
      gradeLook.saturation *= 1 - 0.1 * storm;
      gradeLook.tint = [gradeLook.tint[0] * (1 - 0.05 * storm), gradeLook.tint[1] * (1 + 0.01 * storm), gradeLook.tint[2] * (1 + 0.04 * storm)];
    }
    // mist lying on the ground: morning mist (trees and stands poking out of it) and the
    // steam hanging over a wet track once the rain stops
    const evap = THREE.MathUtils.smoothstep(wx.wet, 0.25, 0.75) * (1 - THREE.MathUtils.smoothstep(L.rain, 0.04, 0.25)) * 0.8;
    const lying = Math.max(evap, wx.kind === 'mist' ? THREE.MathUtils.smoothstep(L.mist, 0.05, 0.45) : 0);
    if (lying > 0.001) {
      aerialParams.x += lying * 9e-4;
      aerialParams.y = THREE.MathUtils.lerp(aerialParams.y, 1 / 55, lying);
      aerialParams.z = groundY * lying;
    }

    // heat haze: a bleached, milky sky and a big glare round the sun
    const milk = THREE.MathUtils.clamp(wx.heat * 1.3 - 0.25, 0, 1) * THREE.MathUtils.smoothstep(L.mist, 0.1, 0.35) * (1 - L.overcast) * (1 - night);
    sky.uniforms.uMilk.value = milk * 0.8;
    // sunlit haze: bright and warm, not grey
    const milkCol = (sky.uniforms.uMilkCol.value as THREE.Vector3).set(
      (C.horizonAway.r * 0.4 + C.horizonToward.r * 0.6) * 1.12,
      (C.horizonAway.g * 0.4 + C.horizonToward.g * 0.6) * 1.02,
      (C.horizonAway.b * 0.4 + C.horizonToward.b * 0.6) * 0.8,
    ).multiplyScalar(1.45);
    if (milk > 0.001) {
      sky.uniforms.uHalo.value = (sky.uniforms.uHalo.value as number) * (1 + 2.2 * milk);
      fog.color.lerp(nightTmp.setRGB(milkCol.x, milkCol.y, milkCol.z), milk * 0.6);
      gradeLook.tint = [gradeLook.tint[0] * (1 + 0.05 * milk), gradeLook.tint[1] * (1 + 0.01 * milk), gradeLook.tint[2] * (1 - 0.08 * milk)];
      gradeLook.exposure *= 1 + 0.06 * milk;
      gradeLook.contrast *= 1 - 0.04 * milk;
    }
    // shafts: morning mist and haze scatter the sun into beams through the trees
    gfx.setSunShafts(sunDir, P.shafts * L.sunVis * 0.9 * (1 + 1.6 * THREE.MathUtils.smoothstep(L.mist, 0.05, 0.4)) + (L.sunVis > 0.3 ? 0.35 * THREE.MathUtils.smoothstep(L.mist, 0.1, 0.4) : 0), 0.55 * C.E0 * 0.25);
    gfx.grade.setLook(gradeLook);
    const F = FLOOD_E * fl;
    setFloodLevel(F);
    const haze = THREE.MathUtils.clamp(L.mist * 0.8 + L.rain * 0.6, 0, 1);
    floods.set(fl, haze, aerialParams.x);
    const u = sky.uniforms;
    u.uNight.value = night;
    u.uStars.value = night * (1 - L.overcast) * (1 - 0.85 * L.mist) * (1 - L.coverage * 0.5);
    // the city under a cloud deck lights it up from below
    const city = 0.03 * night * (0.6 + 0.6 * L.overcast + 0.5 * L.mist) * (1 - 0.5 * L.rain);
    (u.uCity.value as THREE.Vector3).set(cityCol.r * city, cityCol.g * city, cityCol.b * city);
    const glow = F * 0.01 * (0.4 + 1.8 * haze);
    (u.uFloodGlow.value as THREE.Vector3).set(floodCol.r * glow, floodCol.g * glow, floodCol.b * glow);
    if (night > 0.5) u.uHalo.value = 0.35 * L.sunVis;
    // a rainbow: rain falling while the sun shines, opposite it (lifted a little when the sun is high,
    // or it would sit below the horizon all afternoon)
    const bow = (1 - night) * (P.direct ?? 1) * L.sunVis * THREE.MathUtils.smoothstep(L.rain, 0.04, 0.22) * (1 - L.overcast * 0.7) * (1 - L.mist);
    u.uBow.value = bow;
    const bowI = P.sunIntensity * 0.03;
    (u.uBowCol.value as THREE.Vector3).set(C.sunCol.r * bowI, C.sunCol.g * bowI, C.sunCol.b * bowI);
    u.uBowEl.value = -Math.min(P.elevation, 20) * DEG;
    if (fl <= 0 && night <= 0) return;
    // the haze near the circuit glows with its lights; far off it is the night
    nightTmp.copy(floodCol).multiplyScalar(F * 0.006 * (0.3 + 2.2 * haze)).add(tmpB.copy(cityCol).multiplyScalar(city * 0.6));
    fog.color.add(nightTmp);
    // cloud bases lit orange from the city below, and the lit circuit
    const cu = clouds.uniforms;
    const ab = cu.uAmbBase.value as THREE.Vector3;
    ab.multiplyScalar(1 - 0.5 * night).add(nightV.set(cityCol.r * city * 0.9 + floodCol.r * glow * 0.5, cityCol.g * city * 0.9 + floodCol.g * glow * 0.5, cityCol.b * city * 0.9 + floodCol.b * glow * 0.5));
    // rain streaks catch the floodlights
    rain.set(L.rain, wind.x, wind.z, nightTmp.copy(rainBase).add(tmpB.copy(floodCol).multiplyScalar(F * 0.12)));
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
  /** capture the world (no sky, no rain) into worldRT from beside the start straight */
  const capCam = new THREE.PerspectiveCamera(90, 1, 0.4, 6000);
  function captureWorld() {
    const s = (track.startS - 70 + track.length) % track.length;
    const p = track.point(s, 0, 2.6);
    const ahead = track.point((s + 40) % track.length, 0, 2.2);
    capCam.position.copy(p);
    capCam.lookAt(ahead);
    capCam.updateMatrixWorld();
    // lay out the camera-dependent world (tree LOD, horizon) around the capture point
    scenery.update(0, capCam, elapsed);
    focus.copy(p);
    rig.shadow.focus.copy(p);
    worldCam.position.copy(p);
    const hidden = [sky.mesh, rain.group].filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    const prevEnv = scene.environment;
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    scene.updateMatrixWorld(true);
    worldCam.update(renderer, scene);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    scene.environment = prevEnv;
    for (const o of hidden) o.visible = true;
    worldSphere.visible = true;
    worldE = Math.max(0.05, lightInfo.eGround ?? 1);
    worldUniforms.uWorldScale.value = 1;
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
    rain.setFocus(target);
  }

  function setWeather(w: WeatherState) {
    wind.x = w.windX;
    wind.z = w.windZ;
    const conv = w.conv ?? 0;
    const heat = w.heat ?? 0;
    const convChanged = Math.abs(conv - wx.conv) > 0.004 || Math.abs(heat - wx.heat) > 0.004 || Math.abs(w.wetness - wx.wet) > 0.03 || w.kind !== wx.kind;
    wx.conv = conv;
    wx.heat = heat;
    if (Math.abs(w.wetness - wx.wet) > 0.03) wx.wet = w.wetness;
    wx.kind = w.kind;
    // heat shimmer off hot, dry asphalt under a high sun
    {
      const P = TIME_PRESETS[w.time] ?? TIME_PRESETS.afternoon;
      const sunHigh = THREE.MathUtils.smoothstep(P.elevation, 6, 45) * (P.direct ?? 1) * (1 - (P.night ?? 0));
      const k = heat * sunHigh * look.sunVis * Math.max(0, 1 - w.wetness * 3) * (1 - w.rain);
      (gfx as unknown as { setHeatShimmer?: (a: number) => void }).setHeatShimmer?.(k * 0.9);
    }
    sceneryLight.wetness = w.wetness;
    sceneryLight.windX = w.windX;
    sceneryLight.windZ = w.windZ;
    const changed =
      convChanged ||
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
      // new strike: mostly somewhere ahead of the camera so it is actually seen
      const ahead = Math.atan2(camFwd.z, camFwd.x);
      const a =
        debug.boltAz !== null
          ? Math.atan2(-Math.cos((debug.boltAz * Math.PI) / 180), Math.sin((debug.boltAz * Math.PI) / 180))
          : haveCam && Math.random() < 0.8
            ? ahead + (Math.random() - 0.5) * 1.4
            : Math.random() * Math.PI * 2;
      (sky.uniforms.uFlashDir.value as THREE.Vector3).set(Math.cos(a), 0.12 + Math.random() * 0.1, Math.sin(a)).normalize();
      sky.uniforms.uBoltSeed.value = Math.random() * 100;
      sky.uniforms.uBoltTop.value = Math.atan2(look.cloudBase, 700 + Math.random() * 1900);
    }
    lastLightning = L;
    flashLevel = L;
    sky.uniforms.uFlash.value = L;
    // the deck lit from inside: several times its own brightness, cold white
    (sky.uniforms.uFlashCol.value as THREE.Vector3).set(0.9, 0.95, 1.15).multiplyScalar(Math.max(0.12, lightInfo.deckRad ?? 0.2) * 4.5);
    // the channel stays lit through the restrikes, fading with them
    sky.uniforms.uBolt.value = L > 0.12 ? Math.max(L, 0.45) : 0;
    // the whole scene lights up cold white for an instant (the flash fills the sky the env map is made of)
    scene.environmentIntensity = look.envIntensity * (1 + L * 1.7);
    hemi.intensity = look.hemi + L * 0.7 * (1 - look.sunVis * 0.6);
    gfx.setFlash(L * 0.2);
  }

  function update(dt: number, camera: THREE.Camera) {
    elapsed += dt;
    camera.getWorldPosition(camPos);
    sky.mesh.position.copy(camPos);
    sky.uniforms.uTime.value = elapsed;

    // quality follows the renderer
    if (gfx.qualityLevel !== quality) setQuality(gfx.qualityLevel);

    // clouds drift with the wind aloft (stronger than at the ground, veering a little)
    // (a windy day: the jet is up there too, and the clouds race)
    const ws = 2.6 + 2.2 * THREE.MathUtils.smoothstep(Math.hypot(wind.x, wind.z), 7, 14);
    windOff.x += (wind.x * ws + 3.5) * dt;
    windOff.y += (wind.z * ws + 1.2) * dt;
    (clouds.uniforms.uWind.value as THREE.Vector2).copy(windOff);
    cloudShadowA.z = windOff.x;
    cloudShadowA.w = windOff.y;
    if (debug.clouds) clouds.update(dt, camPos);
    sky.uniforms.uPano.value = clouds.texture;

    rain.update(dt, camera);
    floods.update(camera);
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
  try {
    captureWorld();
  } catch (e) {
    console.warn('[env] world capture failed — sky-only reflections', e);
  }
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
    /** dev: the rain system (splash debugging) */
    get rain() {
      return rain;
    },
    get quality() {
      return quality;
    },
    /** dev: the captured world cube (reflections) and its current exposure scale */
    get envWorld() {
      return { rt: worldRT, scale: worldUniforms.uWorldScale.value, capturedAt: worldE };
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
    dispose(keep = new Set<object>()) {
      if (scene.environment === envRT?.texture) scene.environment = null;
      if (scene.fog === fog) scene.fog = null;
      disposeTree(group, keep);
      disposeTree(envScene, keep);
      clouds.dispose();
      // (the cloud noise is shared between circuits: see createCloudNoise)
      cubeRT.dispose();
      worldRT.dispose();
      envRT?.dispose();
      pmrem.dispose();
      for (const l of lutCache.values()) l.texture.dispose();
      lutCache.clear();
    },
  };
}
