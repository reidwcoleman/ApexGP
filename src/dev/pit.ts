import * as THREE from 'three';
import { createDevStage } from './devkit.ts';
import { Track } from '../world/Track.ts';
import { MONZA } from '../world/Circuits.ts';
import { buildTrackside } from '../world/TrackMesh.ts';
import { createEnvironment } from '../world/Environment.ts';
import { buildPitComplex, type BoxState } from '../world/PitComplex.ts';
import { applyWeatherUniforms } from '../world/weatherUniforms.ts';
import type { WeatherKind, WeatherState, TimeOfDay } from '../world/Weather.ts';
import { TEAMS } from '../race/Teams.ts';
import { createCar } from '../car/CarModel.ts';

/**
 * Pit complex dev page: the real track + trackside + environment + the pit complex.
 *   ?cam=x,y,z&look=x,y,z        explicit camera
 *   ?s=&lat=&h=                   camera at track.point(s, lat, h) …
 *   ?ls=&ll=&lh=                  … looking at track.point(ls, ll, lh)
 *   ?weather=clear|cloudy|overcast|drizzle|rain|storm   ?time=morning|afternoon|golden
 *   ?wet=0..1                     override standing water
 *   ?state=idle|ready|service|release&p=0.4&team=3   (team omitted = all teams)
 *   ?car=1                        a car stopped in the box of `team` (or every serviced box)
 *   ?anim=1                       loop ready → service → release → idle on the chosen team(s)
 *   ?nopit=1                      without the complex (for comparisons)
 */

const stage = createDevStage({ fov: 50, near: 0.1, far: 60000 });
const { scene, camera, gfx, params, controls } = stage;
const num = (k: string, d: number) => (params.get(k) !== null ? Number(params.get(k)) : d);

const track = new Track(MONZA);
const kind = (params.get('weather') ?? 'clear') as WeatherKind;
const REG: Record<WeatherKind, [number, number]> = { clear: [0.06, 0], haze: [0.12, 0], windy: [0.5, 0], mist: [0.5, 0], drying: [0.35, 0], cloudy: [0.45, 0], overcast: [0.86, 0], fog: [0.78, 0], sunshower: [0.38, 0.3], drizzle: [0.93, 0.26], rain: [0.97, 0.62], storm: [1, 1], thunderstorm: [1, 0.9] };
const [cloud, rain] = REG[kind] ?? REG.clear;
const weather: WeatherState = {
  kind,
  time: (params.get('time') ?? 'afternoon') as TimeOfDay,
  cloud,
  rain,
  wetness: num('wet', rain > 0 ? Math.min(1, rain * 1.3) : 0),
  dryLine: 0,
  fog: rain * 0.5,
  windX: 1.5,
  windZ: -2,
  lightning: 0,
  airTemp: 24,
  trackTemp: 38,
  t: 0,
};
applyWeatherUniforms(weather);
const env = createEnvironment(track, gfx, scene, weather as never);
(env as { setWeather?: (w: WeatherState) => void }).setWeather?.(weather);
const ts = buildTrackside(track, gfx);
scene.add(ts.group);

const pit = params.get('nopit') ? null : buildPitComplex(track, gfx);
if (pit) {
  scene.add(pit.group);
  console.log(`[shot] pit complex ${JSON.stringify(pit.stats)}`);
}

// ---------------------------------------------------------------- crews + cars
const state = (params.get('state') ?? 'idle') as BoxState;
const prog = num('p', 0.3);
const teamSel = params.get('team') !== null ? [num('team', 0)] : TEAMS.map((_, k) => k);
if (pit) for (const k of teamSel) pit.setBox(k, state, prog);
const cars: THREE.Object3D[] = [];
if (params.get('car') && pit) {
  for (const k of teamSel) {
    const slot = pit.garages[k];
    const rig = createCar(TEAMS[k], TEAMS[k].drivers[0], 0, {});
    const f = track.frame(slot.s);
    rig.root.position.copy(track.point(slot.s, slot.lateral, 0));
    rig.root.rotation.y = f.heading;
    scene.add(rig.root);
    cars.push(rig.root);
  }
}

// ---------------------------------------------------------------- camera
const look = new THREE.Vector3();
if (params.get('s') !== null) {
  track.point(num('s', 500), num('lat', 0), num('h', 1.2), camera.position);
  track.point(num('ls', num('s', 500) + 40), num('ll', 0), num('lh', 1), look);
} else {
  track.point(track.startS - 60, -3, 1.3, camera.position);
  track.point(track.startS - 10, 18, 2, look);
}
if (params.get('cam')) camera.position.fromArray(params.get('cam')!.split(',').map(Number));
if (params.get('look')) look.fromArray(params.get('look')!.split(',').map(Number));
camera.lookAt(look);
controls.target.copy(look);
controls.update();
Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __camera: camera, __track: track, __pit: pit, __gfx: gfx });

// let the crews walk to their spots before the shot (?settle=seconds)
if (pit) {
  const settle = num('settle', 12);
  for (let t = 0; t < settle; t += 0.1) pit.update(0.1, camera);
}

// ---------------------------------------------------------------- loop
const anim = !!params.get('anim');
let at = num('at', 0);
const focus = new THREE.Vector3();
stage.onFrame((dt) => {
  weather.t += dt;
  applyWeatherUniforms(weather);
  env.update(dt, camera);
  // shadows around what the camera sees nearby (the game focuses the player's car)
  camera.getWorldDirection(focus);
  focus.y = 0;
  focus.normalize().multiplyScalar(22).add(camera.position);
  env.focusShadow(focus);
  ts.update(dt, camera);
  if (pit) {
    if (anim) {
      at += dt;
      const cyc = at % 16;
      let st: BoxState = 'idle', p = 0;
      if (cyc < 6) st = 'ready';
      else if (cyc < 8.5) { st = 'service'; p = (cyc - 6) / 2.5; }
      else if (cyc < 10) st = 'release';
      for (const k of teamSel) pit.setBox(k, st, p);
    }
    const t0 = performance.now();
    pit.update(dt, camera);
    const ms = performance.now() - t0;
    (window as unknown as { __pitMs: number }).__pitMs = ms;
  }
});
let augmented = false;
stage.onFrame(() => {
  if (!augmented && window.__ready) {
    augmented = true;
    const info = gfx.renderer.info;
    window.__info = { ...(window.__info as object), pit: pit?.stats, pitUpdateMs: (window as unknown as { __pitMs: number }).__pitMs };
    void info;
  }
});
stage.start();
