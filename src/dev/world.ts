import * as THREE from 'three';
import { createDevStage } from './devkit.ts';
import { Track } from '../world/Track.ts';
import { MONZA } from '../world/Circuits.ts';
import { createEnvironment } from '../world/Environment.ts';
import { Weather, planWeather, type TimeOfDay, type WeatherKind } from '../world/Weather.ts';
import { applyWeatherUniforms } from '../world/weatherUniforms.ts';

/**
 * World dev page.
 *   ?weather=clear|cloudy|overcast|drizzle|rain|storm   (default clear)
 *   ?time=morning|afternoon|golden                        (default afternoon)
 *   ?seed=<n>                                             weather plan seed (default 7)
 *   ?cloud=&rain=&fog=&wet=                               override individual weather values
 *   ?flash=1                                              lightning frame (bolt + flash)
 *   ?lens=0.8&lensSpeed=0.5                               water on the lens (onboard look)
 *   ?animate=1                                            run the weather clock (random lightning in storms)
 *   ?s=<lap metres>&lat=<m>&h=<m>   camera at track.point(s, lat, h) looking at track.point(s+ahead, llat, lh)
 *   ?ahead=40                        look-ahead distance for ?s (negative looks back)
 *   ?cam=x,y,z&look=x,y,z            explicit camera (overrides ?s)
 *   ?top=1                           aerial view
 *   ?trackside=1                     use src/world/TrackMesh.ts buildTrackside instead of the placeholder ribbon
 *   ?scenery=0                       skip the scenery (flat lawn) — sky/light work while the park is rebuilt
 *   ?gpu=1                           log GPU frame time (EXT_disjoint_timer_query) to window.__gpu
 *   ?q=low|medium|high|ultra         quality
 */

const params = new URLSearchParams(location.search);
const stage = createDevStage({ far: 60000, near: 0.1, fov: 50 });
const { scene, camera, gfx, controls } = stage;
const track = new Track(MONZA);

const kind = (params.get('weather') as WeatherKind) ?? 'clear';
const time = (params.get('time') as TimeOfDay) ?? 'afternoon';
const weather = new Weather(planWeather(kind, time, 600, Number(params.get('seed') ?? 7)));
const W = weather.state;
const num = (k: string) => (params.get(k) !== null ? Number(params.get(k)) : null);
const ov = { cloud: num('cloud'), rain: num('rain'), fog: num('fog'), wet: num('wet') };
function overrides() {
  if (ov.cloud !== null) W.cloud = ov.cloud;
  if (ov.rain !== null) W.rain = ov.rain;
  if (ov.fog !== null) W.fog = ov.fog;
  if (ov.wet !== null) W.wetness = ov.wet;
}
overrides();
applyWeatherUniforms(W);

const env = createEnvironment(track, gfx, scene, W, { scenery: params.get('scenery') !== '0' });
Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __env: env, __camera: camera, __track: track, __gfx: gfx, __weather: weather });

// ---------------------------------------------------------------- camera
const target = new THREE.Vector3();
if (!params.get('cam')) {
  if (params.get('top')) {
    camera.position.set(-900, 1500, 2600);
    target.set(-200, 0, 300);
  } else {
    const s = Number(params.get('s') ?? track.startS - 120);
    const lat = Number(params.get('lat') ?? 0);
    const h = Number(params.get('h') ?? 1.3);
    const ahead = Number(params.get('ahead') ?? 40);
    track.point(s, lat, h, camera.position);
    track.point((s + ahead + track.length) % track.length, Number(params.get('llat') ?? 0), Number(params.get('lh') ?? 1), target);
    if (params.get('az') !== null) {
      // look along a compass azimuth (0 = north, 90 = east) with an optional pitch (deg)
      const az = THREE.MathUtils.degToRad(Number(params.get('az')));
      const pitch = THREE.MathUtils.degToRad(Number(params.get('pitch') ?? 2));
      target.copy(camera.position).add(new THREE.Vector3(Math.sin(az) * Math.cos(pitch), Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)).multiplyScalar(50));
    }
  }
  camera.lookAt(target);
  controls.target.copy(target);
  controls.update();
} else {
  target.copy(controls.target);
}

// ---------------------------------------------------------------- road placeholder / trackside
function placeholderRoad() {
  const g = new THREE.Group();
  const strip = (lat0: (i: number) => number, lat1: (i: number) => number, lift: number, color: number, rough: number) => {
    const n = track.n;
    const pos = new Float32Array((n + 1) * 2 * 3);
    const p = new THREE.Vector3();
    for (let k = 0; k <= n; k++) {
      const i = k % n;
      track.point(i, lat0(i), lift, p);
      pos.set([p.x, p.y, p.z], k * 6);
      track.point(i, lat1(i), lift, p);
      pos.set([p.x, p.y, p.z], k * 6 + 3);
    }
    const idx: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: rough, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    g.add(m);
  };
  strip((i) => -track.halfWidth[i], (i) => track.halfWidth[i], 0.06, 0x3a3b3e, 0.85);
  strip((i) => -track.barrierL[i], (i) => -track.halfWidth[i], 0.04, 0x51652f, 0.95);
  strip((i) => track.halfWidth[i], (i) => track.barrierR[i], 0.04, 0x51652f, 0.95);
  // barrier walls
  const wall = (side: number) => {
    const n = track.n;
    const pos: number[] = [];
    const idx: number[] = [];
    const p = new THREE.Vector3();
    for (let k = 0; k <= n; k++) {
      const i = k % n;
      const lat = side * (side < 0 ? track.barrierL[i] : track.barrierR[i]);
      track.point(i, lat, 0, p);
      pos.push(p.x, p.y, p.z, p.x, p.y + 1.1, p.z);
    }
    for (let k = 0; k < n; k++) {
      const a = k * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.6, side: THREE.DoubleSide }));
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  };
  wall(-1);
  wall(1);
  return g;
}

let trackside: { update(dt: number, camera: THREE.Camera): void } | null = null;
if (params.get('trackside')) {
  try {
    const modPath = '../world/TrackMesh.ts';
    const mod = (await import(/* @vite-ignore */ modPath)) as {
      buildTrackside?: (t: Track, g: typeof gfx) => { group: THREE.Group; update(dt: number, c: THREE.Camera): void };
    };
    if (mod.buildTrackside) {
      const ts = mod.buildTrackside(track, gfx);
      scene.add(ts.group);
      trackside = ts;
    } else scene.add(placeholderRoad());
  } catch (e) {
    console.warn('[world] trackside unavailable, using placeholder', e);
    scene.add(placeholderRoad());
  }
} else if (params.get('road') !== '0') {
  scene.add(placeholderRoad());
}

// a car-sized stand-in at the focus point so shadows and reflections can be judged
if (params.get('car') !== '0' && !params.get('top')) {
  const s = Number(params.get('s') ?? track.startS - 120) + Number(params.get('carAhead') ?? 14);
  const f = track.frame(s);
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xc8102e, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, metalness: 0.3 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.45, metalness: 0.2 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.85 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(0.9, 0.45, 4.4), paint, 0, 0.42, 0.1);
  add(new THREE.BoxGeometry(1.6, 0.35, 1.6), paint, 0, 0.35, -0.6);
  add(new THREE.BoxGeometry(0.4, 0.5, 0.9), paint, 0, 0.85, -0.3);
  add(new THREE.BoxGeometry(1.7, 0.05, 0.5), carbon, 0, 0.12, 2.6);
  add(new THREE.BoxGeometry(1.0, 0.05, 0.45), carbon, 0, 0.95, -2.3);
  add(new THREE.BoxGeometry(0.05, 0.6, 0.5), carbon, 0.5, 0.7, -2.3);
  add(new THREE.BoxGeometry(0.05, 0.6, 0.5), carbon, -0.5, 0.7, -2.3);
  const w = new THREE.CylinderGeometry(0.36, 0.36, 0.38, 24).rotateZ(Math.PI / 2);
  const wr = new THREE.CylinderGeometry(0.36, 0.36, 0.44, 24).rotateZ(Math.PI / 2);
  add(w, tyre, 0.85, 0.36, 1.75);
  add(w, tyre, -0.85, 0.36, 1.75);
  add(wr, tyre, 0.82, 0.36, -1.85);
  add(wr, tyre, -0.82, 0.36, -1.85);
  g.position.copy(track.point(s, 0, 0.02));
  g.rotation.y = f.heading;
  scene.add(g);
}

// ---------------------------------------------------------------- GPU timer
const gpuOn = params.get('gpu') === '1';
const gl = gfx.renderer.getContext() as WebGL2RenderingContext;
const tq = gpuOn ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null;
const pending: WebGLQuery[] = [];
const gpuTimes: number[] = [];
(window as unknown as { __gpu: unknown }).__gpu = null;
if (tq) {
  // time exactly the GPU work of one frame: env update (cloud march, bakes) + render
  const render = gfx.render.bind(gfx);
  gfx.render = (dt: number) => {
    const q = gl.createQuery()!;
    gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    render(dt);
    gl.endQuery(tq.TIME_ELAPSED_EXT);
    pending.push(q);
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const r = pending.shift()!;
      if (!gl.getParameter(tq.GPU_DISJOINT_EXT)) gpuTimes.push(gl.getQueryParameter(r, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(r);
    }
    if (gpuTimes.length > 20) {
      const s = gpuTimes.slice(-60).sort((a, b) => a - b);
      (window as unknown as { __gpu: unknown }).__gpu = { median: +s[s.length >> 1].toFixed(2), p90: +s[Math.floor(s.length * 0.9)].toFixed(2), n: gpuTimes.length };
    }
  };
}
/** time a block of GPU work (dev): returns ms via callback when available */
const envTimes: number[] = [];
function timeGpu(fn: () => void) {
  if (!tq) return fn();
  const q = gl.createQuery()!;
  gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
  fn();
  gl.endQuery(tq.TIME_ELAPSED_EXT);
  envPending.push(q);
}
const envPending: WebGLQuery[] = [];

const lensAmount = Number(params.get('lens') ?? 0);
const lensSpeed = params.get('lensSpeed') !== null ? Number(params.get('lensSpeed')) : undefined;
const flash = params.get('flash') === '1';
if (params.get('boltAz') !== null) (env.stats.debug as { boltAz: number | null }).boltAz = Number(params.get('boltAz'));
const animate = params.get('animate') === '1';

const focus = new THREE.Vector3();
let frame = 0;
stage.onFrame((dt) => {
  while (envPending.length && gl.getQueryParameter(envPending[0], gl.QUERY_RESULT_AVAILABLE)) {
    const r = envPending.shift()!;
    envTimes.push(gl.getQueryParameter(r, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(r);
  }
  if (envTimes.length > 20) {
    const s = envTimes.slice(-60).sort((a, b) => a - b);
    (window as unknown as { __gpuEnv: unknown }).__gpuEnv = { median: +s[s.length >> 1].toFixed(2), p90: +s[Math.floor(s.length * 0.9)].toFixed(2) };
  }
  if (animate) weather.update(dt);
  overrides();
  if (flash) W.lightning = 1;
  applyWeatherUniforms(W);
  env.setWeather(W);
  timeGpu(() => env.update(dt, camera));
  focus.copy(controls.target);
  env.focusShadow(focus);
  trackside?.update(dt, camera);
  gfx.setLensRain(lensAmount, lensSpeed);
  frame++;
  if (frame > 5) {
    const info = gfx.renderer.info;
    window.__info = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      buildMs: Math.round(env.buildMs),
      weather: `${W.kind}/${W.time} cloud ${W.cloud.toFixed(2)} rain ${W.rain.toFixed(2)} fog ${W.fog.toFixed(2)}`,
      gpu: (window as unknown as { __gpu: unknown }).__gpu,
      gpuEnvUpdate: (window as unknown as { __gpuEnv: unknown }).__gpuEnv,
    };
  }
});
stage.start();
