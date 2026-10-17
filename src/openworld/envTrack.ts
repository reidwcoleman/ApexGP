import type { CircuitDef } from '../world/CircuitGen.ts';

/**
 * The race Environment (sky, sun, clouds, fog, rain, reflections, the grade) is built around a
 * circuit. The open world has none: it hands it this small invisible loop round downtown instead,
 * which only anchors the environment's averages (ground level 0). Rain splashes, the reflection
 * capture point and the floodlights are all overridden (createEnvironment opts).
 */
export const MIAMI_ENV_TRACK: CircuitDef = {
  id: 'miami-open',
  name: 'Miami',
  short: 'Miami',
  country: 'USA',
  segments: [
    { type: 'straight', length: 500, free: true },
    { type: 'corner', angle: 90, radius: 90 },
    { type: 'straight', length: 380, free: true },
    { type: 'corner', angle: 90, radius: 90 },
    { type: 'straight', length: 500, free: true },
    { type: 'corner', angle: 90, radius: 90 },
    { type: 'straight', length: 380, free: true },
    { type: 'corner', angle: 90, radius: 90 },
  ],
  halfWidth: 6,
  startOffset: 200,
  elevation: [
    [0, 0],
    [0.5, 0],
  ],
  pitSide: 1,
  pit: { start: 60, end: 260 },
  sectors: [0.33, 0.66],
  drs: [],
};
