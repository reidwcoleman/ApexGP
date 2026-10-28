import * as THREE from 'three';
import type { WeatherState } from './Weather.ts';
// installs the floodlight chunk into three's lit materials before anything compiles
import './env/night.ts';
// (and the snow that settles on the tops of things, env/snowTop.ts)
import './env/snowTop.ts';
/** the menu garage is indoors: no floodlight term there (see env/night.ts) */
export { suppressFloods } from './env/night.ts';

/**
 * Weather values shared by every material that reacts to rain (road, kerbs,
 * car paint, terrain, puddles…). Put these uniform objects straight into a
 * ShaderMaterial's `uniforms`, or into `shader.uniforms` in onBeforeCompile —
 * they are the same objects everywhere, so one update per frame reaches all.
 * The game calls `applyWeatherUniforms` once per frame.
 */
export const weatherUniforms = {
  /** standing water on the track 0 … 1 */
  uWetness: { value: 0 },
  /** rain rate 0 … 1 */
  uRain: { value: 0 },
  /** 0 … 1, how much drier the racing line is */
  uDryLine: { value: 0 },
  /** cloud cover 0 … 1 */
  uCloud: { value: 0 },
  /** snow (or hoar frost) lying on the ground, the run-off and the roofs 0 … 1 (set by the Environment) */
  uSnowCover: { value: 0 },
  /**
   * what else lies on, or blows across, the ground (set by the Environment): x snow or sand lying on the
   * road off the racing line, y how much of what lies is hailstones (pebbles, not a sheet), z blowing
   * snow / sand streaming across the surface with the wind, w 0 … 1 snow → sand
   */
  uSurfWx: { value: new THREE.Vector4() },
  /** 0 … 1: the cover is a hoar frost (a silver rime on the blades), not snow */
  uFrost: { value: 0 },
  /** lightning flash 0 … 1 */
  uLightning: { value: 0 },
  /** wind (m/s) in world x/z */
  uWind: { value: new THREE.Vector2() },
  /** weather clock (s), for ripples / streaks */
  uWeatherTime: { value: 0 },
  /**
   * how much the backlit signs glow: printed boards and lightboxes are only visibly lit after dark
   * (in daylight a lightbox is barely brighter than a painted sign). Set by the Environment.
   */
  uSignGlow: { value: 0.12 },
};

export function applyWeatherUniforms(w: WeatherState) {
  weatherUniforms.uWetness.value = w.wetness;
  weatherUniforms.uRain.value = w.rain;
  weatherUniforms.uDryLine.value = w.dryLine;
  weatherUniforms.uCloud.value = w.cloud;
  weatherUniforms.uLightning.value = w.lightning;
  weatherUniforms.uWind.value.set(w.windX, w.windZ);
  weatherUniforms.uWeatherTime.value = w.t;
}
