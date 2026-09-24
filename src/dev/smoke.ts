/**
 * FX dev page: cars in formation on an endless wet straight throwing spray.
 *
 *   ?view=chase|tv|front|high   camera (chase follows car `follow`, default the last one)
 *   ?cars=6  ?v=75 (m/s)  ?gap=16 (m)  ?follow=<i>
 *   ?wet=0.85 ?rain=0.7 ?dry=0      weather (wetness, rain rate, dry line)
 *   ?wind=3,1                        wind x,z (m/s)
 *   ?sun=0.4                         sun intensity (overcast ≈ 0.4, dry day ≈ 3.5)
 *   ?fx=smoke|dust|sparks            extra dry effects on the followed car
 *   ?nofx=1                          hide all particles (perf A/B)
 *   ?compound=wet|inter|…            tyres
 */
import * as THREE from 'three';
import { createDevStage } from './devkit.ts';
import { TEAMS } from '../race/Teams.ts';
import { createCar, preloadCarAssets, type CarRig, type Compound } from '../car/CarModel.ts';
import { Particles } from '../fx/Particles.ts';
import { SprayEmitters } from '../fx/Spray.ts';
import { weatherUniforms } from '../world/weatherUniforms.ts';

const P = new URLSearchParams(location.search);
const num = (k: string, d: number) => (P.get(k) !== null ? Number(P.get(k)) : d);
const view = P.get('view') ?? 'chase';
const N = num('cars', 6);
const V = num('v', 75);
const GAP = num('gap', 16);
const follow = Math.min(N - 1, num('follow', N - 1));
const wet = num('wet', 0.85);
const rain = num('rain', 0.7);
const dryLine = num('dry', 0);
const [windX, windZ] = (P.get('wind') ?? '2.5,1').split(',').map(Number);
const sunI = num('sun', wet > 0.1 ? 0.45 : 3.4);

const stage = createDevStage({ fov: 60, near: 0.1, far: 6000 });
const { scene, camera, gfx } = stage;
gfx.grade.set({ exposure: num('exp', 1.0) });
stage.controls.enabled = false;

// ------------------------------------------------------------------ sky / light
const wetLook = wet > 0.1;
const skyTop = new THREE.Color(wetLook ? 0x8d949c : 0x5d8ed8).multiplyScalar(wetLook ? 1.1 : 1.3);
const skyHor = new THREE.Color(wetLook ? 0xb7bcc2 : 0xc9dbee).multiplyScalar(wetLook ? 1.2 : 1.6);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: { top: { value: skyTop }, hor: { value: skyHor } },
  vertexShader: 'varying vec3 vP; void main(){ vP = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
  fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y, 0.0, 1.0); gl_FragColor = vec4(mix(hor, top, pow(h, 0.5)), 1.0); }',
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), skyMat);
sky.frustumCulled = false;
scene.add(sky);
scene.background = skyHor;
scene.fog = new THREE.Fog(skyHor.clone().multiplyScalar(0.95), 150, wetLook ? 900 : 4000);
{
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat.clone()));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a2b2c }));
  ground.position.y = -2;
  envScene.add(ground);
  const pm = new THREE.PMREMGenerator(gfx.renderer);
  scene.environment = pm.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 1;
}
const sun = new THREE.DirectionalLight(0xfff1e0, sunI);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 400 });
sun.shadow.bias = -0.0003;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(skyTop, 0x303030, 0.3);
scene.add(hemi);

// ------------------------------------------------------------------ road
function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3a3b3d';
  g.fillRect(0, 0, 512, 1024);
  for (let i = 0; i < 16000; i++) {
    const v = 40 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v},${v + 2},0.5)`;
    g.fillRect(Math.random() * 512, Math.random() * 1024, 2, 2);
  }
  g.fillStyle = '#dcdcdc';
  g.fillRect(8, 0, 12, 1024);
  g.fillRect(492, 0, 12, 1024);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const ROAD_W = 14;
const TILE = 12;
const roadTex = roadTexture();
roadTex.repeat.set(1, 1600 / TILE);
const road = new THREE.Mesh(
  new THREE.PlaneGeometry(ROAD_W, 1600).rotateX(-Math.PI / 2),
  new THREE.MeshPhysicalMaterial({ map: roadTex, roughness: wetLook ? 0.35 : 0.8, metalness: 0, color: wetLook ? 0x707070 : 0xffffff, clearcoat: wetLook ? 0.35 : 0, clearcoatRoughness: 0.12 }),
);
road.receiveShadow = true;
scene.add(road);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(600, 1600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3d4a2c, roughness: 0.9 }));
grass.position.y = -0.02;
grass.receiveShadow = true;
scene.add(grass);
// Monza-ish tree lines either side (dark backdrop, like the real park)
const treeMat = new THREE.MeshStandardMaterial({ color: 0x1f2a18, roughness: 1 });
const trees = new THREE.Group();
for (const side of [-1, 1]) {
  for (let k = 0; k < 40; k++) {
    const h = 16 + Math.random() * 14;
    const t = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), treeMat);
    t.scale.set(6 + Math.random() * 4, h * 0.6, 6 + Math.random() * 4);
    t.position.set(side * (38 + Math.random() * 10), h * 0.45, k * 40 - 300 + Math.random() * 20);
    trees.add(t);
  }
}
scene.add(trees);
if (P.get('trees') === '0') trees.visible = false;

// ------------------------------------------------------------------ weather
weatherUniforms.uWetness.value = wet;
weatherUniforms.uRain.value = rain;
weatherUniforms.uDryLine.value = dryLine;
weatherUniforms.uWind.value.set(windX, windZ);

// ------------------------------------------------------------------ cars
await preloadCarAssets();
const particles = new Particles();
scene.add(particles.group);
if (P.get('nofx') === '1') particles.group.visible = false;
const spray = new SprayEmitters();
interface Car { rig: CarRig; z: number; x: number; v: number; spin: number }
const cars: Car[] = [];
for (let i = 0; i < N; i++) {
  const team = TEAMS[i % TEAMS.length];
  const seat = (Math.floor(i / TEAMS.length) % 2) as 0 | 1;
  const rig = createCar(team, team.drivers[seat], seat);
  rig.setCompound((P.get('compound') as Compound) ?? (wet > 0.55 ? 'wet' : wet > 0.1 ? 'inter' : 'medium'));
  rig.setRainLight(wet > 0.1 || rain > 0.05);
  scene.add(rig.root);
  cars.push({ rig, z: -i * GAP, x: i % 2 ? 1.6 : -1.6, v: V * (1 - i * 0.002), spin: 0 });
}
const fxKind = P.get('fx');

// ------------------------------------------------------------------ GPU timer (EXT_disjoint_timer_query_webgl2)
const gl = gfx.renderer.getContext() as WebGL2RenderingContext;
const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
const pending: WebGLQuery[] = [];
const gpuMs: number[] = [];
const render0 = gfx.render.bind(gfx);
gfx.render = (dt: number) => {
  let q: WebGLQuery | null = null;
  if (tq && pending.length < 4 && !particles.gpuTiming) {
    q = gl.createQuery()!;
    gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
  }
  render0(dt);
  if (q && tq) {
    gl.endQuery(tq.TIME_ELAPSED_EXT);
    pending.push(q);
  }
  while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
    const r = gl.getQueryParameter(pending[0], gl.QUERY_RESULT) as number;
    if (!gl.getParameter(tq!.GPU_DISJOINT_EXT)) gpuMs.push(r / 1e6);
    gl.deleteQuery(pending.shift()!);
    if (gpuMs.length > 120) gpuMs.shift();
  }
};
let lastInfo: unknown = null;
Object.defineProperty(window, '__info', {
  configurable: true,
  get() {
    const s = gpuMs.slice(-60).sort((a, b) => a - b);
    return { renderer: lastInfo, gpuMsMedian: s.length ? +s[Math.floor(s.length / 2)].toFixed(2) : null, timer: !!tq, particles: particles.stats, veil: +particles.veil.amount.toFixed(2) };
  },
  set(v) {
    lastInfo = v;
  },
});
(window as unknown as { __fx: unknown }).__fx = { particles, gpuMs, cars };

// ------------------------------------------------------------------ loop
const tmp = new THREE.Vector3();
const vel = new THREE.Vector3();
const camTarget = new THREE.Vector3();
stage.onFrame((dt) => {
  const f = cars[follow];
  let veil = 0;
  const camDir = particles.cameraDirection;
  for (const c of cars) {
    c.z += c.v * dt;
    c.spin += (c.v / 0.36) * dt;
    const r = c.rig;
    r.root.position.set(c.x, 0, c.z);
    r.root.rotation.y = 0;
    r.setWheelSpin(c.spin, c.spin);
    r.setWheelSpeed(c.v);
    r.update(dt);
    const d = camera.position.distanceTo(r.root.position);
    const I = spray.emit(particles, cars.indexOf(c), {
      x: c.x, y: 0, z: c.z, yaw: 0, vx: 0, vz: c.v, speed: c.v, wet, camDist: d,
      wheelbase: r.dims.wheelbase, trackF: r.dims.trackFront, trackR: r.dims.trackRear, self: c === f && (view === 'chase'),
    }, dt);
    if (I > 0.02 && d < 160) {
      tmp.copy(r.root.position).sub(camera.position);
      const cosA = tmp.dot(camDir) / Math.max(1e-3, d);
      const t = Math.min(1, Math.max(0, (cosA - 0.15) / 0.6));
      const viewW = d < 9 ? 1 : t * t * (3 - 2 * t);
      const away = Math.max(0, camDir.z);
      veil += I * viewW * Math.exp(-d / 55) * (0.1 + 0.9 * away * away) * (d < 9 ? 0.4 : 1);
    }
    const lvl = r.rainLightLevel();
    if (lvl > 0.01) {
      const a = r.anchors.rainLight.getWorldPosition(tmp);
      P.get('noglow') !== '1' && particles.glow(a, 0.075 + 0.05 * I, 34 * lvl, 1.4 * lvl, 0.7 * lvl, 1, 0.35);
      if (I > 0.05 && P.get('noglow') !== '1') particles.haloGlow(a, 0.6 + 1.4 * I, 0.22 * lvl * I, 0.011 * lvl * I, 0.006 * lvl * I, 1);
    }
  }
  spray.endFrame();
  particles.veil.setDensity(veil, 0);
  particles.setWind(windX, windZ);
  if (fxKind && Math.random() < 0.5) {
    vel.set(0, 0, f.v);
    const w = f.rig.anchors;
    if (fxKind === 'smoke') for (const a of [w.wheelRL, w.wheelRR]) particles.smoke(a.getWorldPosition(tmp), vel, 1, 0);
    if (fxKind === 'dust') for (const a of [w.wheelRL, w.wheelRR]) particles.dust(a.getWorldPosition(tmp), vel, true, 1, 0);
    if (fxKind === 'sparks') particles.sparks(tmp.set(f.x, 0.03, f.z - 0.6), vel, 14, 0);
  }
  particles.update(dt);

  // camera
  const fp = f.rig.root.position;
  if (view === 'chase') {
    camera.position.set(fp.x, 2.15, fp.z - 7.6);
    camTarget.set(fp.x, 1.0, fp.z + 8);
  } else if (view === 'tv') {
    camera.position.set(fp.x + 13, 2.2, fp.z + 34);
    camTarget.set(fp.x, 0.8, fp.z + 6);
  } else if (view === 'front') {
    camera.position.set(fp.x + 3, 1.2, fp.z + 14);
    camTarget.set(fp.x, 0.9, fp.z - 6);
  } else if (view === 'side') {
    camera.position.set(fp.x + 24, 2.2, fp.z - 12);
    camTarget.set(fp.x, 1.4, fp.z - 12);
  } else if (view === 'tele') {
    // trackside TV camera: long lens, high and far
    camera.position.set(fp.x + 34, 12, fp.z + 60);
    camTarget.set(fp.x, 1.2, fp.z - 6);
    if (camera.fov !== 9) {
      camera.fov = 9;
      camera.updateProjectionMatrix();
    }
  } else {
    camera.position.set(fp.x + 22, 18, fp.z - 30);
    camTarget.set(fp.x, 0, fp.z + 20);
  }
  camera.lookAt(camTarget);
  // keep the road / sun / shadow box with the action
  const snap = Math.round(fp.z / TILE) * TILE;
  road.position.z = snap + 500;
  grass.position.z = snap + 500;
  trees.position.z = Math.round(fp.z / 40) * 40;
  sun.target.position.set(fp.x, 0, fp.z);
  sun.position.set(fp.x - 60, 110, fp.z - 80);
  sky.position.copy(camera.position);
});
stage.start();
