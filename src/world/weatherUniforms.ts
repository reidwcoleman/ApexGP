import * as THREE from 'three';
import type { WeatherState } from './Weather.ts';

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
  /** lightning flash 0 … 1 */
  uLightning: { value: 0 },
  /** wind (m/s) in world x/z */
  uWind: { value: new THREE.Vector2() },
  /** weather clock (s), for ripples / streaks */
  uWeatherTime: { value: 0 },
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
