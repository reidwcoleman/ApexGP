import * as THREE from 'three';
import { createDevStage } from './devkit.ts';
import { Track } from '../world/Track.ts';
import { COSTA_DEL_SOL } from '../world/Circuits.ts';
import { createEnvironment, type TimeOfDay } from '../world/Environment.ts';

/**
 * World dev page.
 *   ?time=golden|day|overcast
 *   ?s=<lap metres>&lat=<m>&h=<m>   camera at track.point(s, lat, h) looking at track.point(s+40, 0, 1)
 *   ?ahead=40                        look-ahead distance for ?s
 *   ?cam=x,y,z&look=x,y,z            explicit camera (overrides ?s)
 *   ?top=1                           aerial view
 *   ?trackside=1                     use src/world/TrackMesh.ts buildTrackside (if present) instead of the placeholder ribbon
 */

const params = new URLSearchParams(location.search);
const stage = createDevStage({ far: 60000, near: 0.1, fov: 50 });
const { scene, camera, gfx, controls } = stage;
const track = new Track(COSTA_DEL_SOL);
const time = (params.get('time') as TimeOfDay) ?? 'golden';
const env = createEnvironment(track, gfx, scene, time);
Object.assign(window as unknown as Record<string, unknown>, { __scene: scene, __env: env, __camera: camera, __track: track, __gfx: gfx });

// ---------------------------------------------------------------- camera
const target = new THREE.Vector3();
if (!params.get('cam')) {
  if (params.get('top')) {
    camera.position.set(-300, 1900, 2300);
    target.set(-480, 0, 500);
  } else {
    const s = Number(params.get('s') ?? track.startS - 120);
    const lat = Number(params.get('lat') ?? 0);
    const h = Number(params.get('h') ?? 1.3);
    const ahead = Number(params.get('ahead') ?? 40);
    track.point(s, lat, h, camera.position);
    track.point(s + ahead, Number(params.get('llat') ?? 0), Number(params.get('lh') ?? 1), target);
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
  strip((i) => -track.halfWidth[i], (i) => track.halfWidth[i], 0.02, 0x3a3b3e, 0.85);
  strip((i) => -track.barrierL[i], (i) => -track.halfWidth[i], 0.0, 0x51652f, 0.95);
  strip((i) => track.halfWidth[i], (i) => track.barrierR[i], 0.0, 0x51652f, 0.95);
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

// a car-sized box at the focus point so shadows can be judged
if (params.get('car') !== '0' && !params.get('top')) {
  const s = Number(params.get('s') ?? track.startS - 120) + Number(params.get('carAhead') ?? 14);
  const f = track.frame(s);
  const car = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 5.4), new THREE.MeshPhysicalMaterial({ color: 0xc8102e, roughness: 0.3, clearcoat: 1, metalness: 0.2 }));
  car.position.copy(track.point(s, 0, 0.55));
  car.rotation.y = f.heading;
  car.castShadow = true;
  car.receiveShadow = true;
  scene.add(car);
}

const focus = new THREE.Vector3();
let frame = 0;
stage.onFrame((dt) => {
  env.update(dt, camera);
  focus.copy(controls.target);
  env.focusShadow(focus);
  trackside?.update(dt, camera);
  frame++;
  if (frame > 5) {
    const info = gfx.renderer.info;
    window.__info = {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      buildMs: Math.round(env.buildMs),
      time: env.timeOfDay,
    };
  }
});
stage.start();
