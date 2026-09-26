import * as THREE from 'three';
import { createDevStage } from './devkit.ts';
import { Track } from '../world/Track.ts';
import { CIRCUITS, MONZA } from '../world/Circuits.ts';
import { setEvent } from '../world/event.ts';
import { createEnvironment } from '../world/Environment.ts';
import { buildTrackside } from '../world/TrackMesh.ts';
import { Weather, planWeather, type TimeOfDay, type WeatherKind } from '../world/Weather.ts';
import { applyWeatherUniforms } from '../world/weatherUniforms.ts';
import { buildWater, seaPolygon } from '../world/env/water.ts';

/**
 * Landscape / lighting dev page: a circuit with its trackside and full scenery,
 * no cars or game loop (stable while the game is being worked on).
 *   ?track=monza|spa|silverstone|suzuka   ?weather=clear  ?time=afternoon
 *   ?s=<lap m>&lat=&h=&ahead=&llat=&lh=   camera at track.point(s, lat, h) looking at track.point(s+ahead, llat, lh)
 *   ?az=<deg>&pitch=<deg>                 look along a compass bearing instead
 *   ?q=high   ?gpu=1 (GPU frame time → window.__gpu)
 */
const params = new URLSearchParams(location.search);
const def = CIRCUITS.find((c) => c.id === params.get('track')) ?? MONZA;
setEvent(def);
const stage = createDevStage({ far: 30000, near: 0.1, fov: Number(params.get('fov') ?? 50) });
const { scene, camera, gfx, controls } = stage;
const track = new Track(def);
const weather = new Weather(planWeather((params.get('weather') as WeatherKind) ?? 'clear', (params.get('time') as TimeOfDay) ?? 'afternoon', 600, Number(params.get('seed') ?? 7)));
const W = weather.state;
applyWeatherUniforms(W);
const ts = buildTrackside(track, gfx);
scene.add(ts.group);
const env = createEnvironment(track, gfx, scene, W);
Object.assign(window as unknown as Record<string, unknown>, { __env: env, __track: track, __gfx: gfx, __camera: camera });

const n = (k: string, d: number) => (params.get(k) !== null ? Number(params.get(k)) : d);
const s = (n('s', track.startS - 120) + track.length) % track.length;
const target = new THREE.Vector3();
track.point(s, n('lat', 0), n('h', 1.3), camera.position);
track.point((s + n('ahead', 40) + track.length) % track.length, n('llat', 0), n('lh', 1), target);
if (params.get('az') !== null) {
  // look along a compass bearing (0 = north = −Z, 90 = east) with a pitch (deg)
  const az = THREE.MathUtils.degToRad(n('az', 0));
  const pitch = THREE.MathUtils.degToRad(n('pitch', 2));
  target.copy(camera.position).add(new THREE.Vector3(Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)).multiplyScalar(50));
}
camera.lookAt(target);
controls.target.copy(target);
controls.update();

// ?water=lake|sea — a test body of water around the look target (material check)
let water: { update(t: number): void } | null = null;
if (params.get('water')) {
  const kind = params.get('water') as 'lake' | 'sea';
  const c = target.clone();
  const R = n('wr', 70);
  const outline = kind === 'sea' ? seaPolygon({ x: c.x, z: c.z }, n('bearing', 270), 20000) : Array.from({ length: 48 }, (_, i) => ({ x: c.x + Math.cos((i / 48) * Math.PI * 2) * R * (1 + 0.15 * Math.sin(i * 1.7)), z: c.z + Math.sin((i / 48) * Math.PI * 2) * R }));
  let y = -1e9;
  for (const q of outline) y = Math.max(y, env.heightAt(q.x, q.z));
  const w = buildWater({ outline, y: kind === 'sea' ? env.heightAt(c.x, c.z) + 0.5 : y + 0.1, kind });
  scene.add(w.mesh);
  water = w;
}

const gl = gfx.renderer.getContext() as WebGL2RenderingContext;
const tq = params.get('gpu') === '1' ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null;
if (tq) {
  const pending: WebGLQuery[] = [];
  const times: number[] = [];
  const render = gfx.render.bind(gfx);
  gfx.render = (dt: number) => {
    const q = gl.createQuery()!;
    gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    render(dt);
    gl.endQuery(tq.TIME_ELAPSED_EXT);
    pending.push(q);
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const r = pending.shift()!;
      if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) times.push(gl.getQueryParameter(r, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(r);
    }
    if (times.length > 20) {
      const a = times.slice(-90).sort((x, y) => x - y);
      (window as unknown as { __gpu: unknown }).__gpu = { median: +a[a.length >> 1].toFixed(2), p90: +a[Math.floor(a.length * 0.9)].toFixed(2), n: times.length };
    }
  };
}
let tt = 0;
stage.onFrame((dt) => {
  tt += dt;
  water?.update(tt);
  applyWeatherUniforms(W);
  env.setWeather(W);
  env.update(dt, camera);
  env.focusShadow(controls.target);
  ts.update(dt, camera);
  const info = gfx.renderer.info;
  window.__info = { calls: info.render.calls, tris: info.render.triangles, gpu: (window as unknown as { __gpu: unknown }).__gpu };
});
stage.start();
