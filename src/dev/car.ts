/**
 * Car dev page.
 *   ?team=<id>&seat=0|1   livery (default rossa, seat 0)
 *   ?grid=1               all 10 teams in two rows
 *   ?spin=1               spin wheels + sweep steering     ?speed=<m/s> fixed wheel speed (blur)
 *   ?drs=1  ?brake=1  ?rain=1  ?detail=0|1|2  ?driver=0  ?yaw=<deg>
 */
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { createDevStage, studioLighting } from './devkit.ts';
import { TEAMS } from '../race/Teams.ts';
import { createCar, preloadCarAssets, carTriangles, type CarRig } from '../car/CarModel.ts';

const grid = new URLSearchParams(location.search).get('grid') === '1';
const stage = createDevStage({
  cam: grid ? new THREE.Vector3(-2, 10.5, 19) : new THREE.Vector3(5, 1.6, 6),
  look: new THREE.Vector3(0, grid ? 0.2 : 0.5, 0),
  fov: 40,
});
const P = stage.params;
stage.gfx.grade.set({ exposure: Number(P.get('exp') ?? 0.85) });
const { key, floor } = studioLighting(stage, 1);
key.intensity = 2.3;
stage.scene.environmentIntensity = 0.6;
key.shadow.camera.left = key.shadow.camera.bottom = grid ? -14 : -6;
key.shadow.camera.right = key.shadow.camera.top = grid ? 14 : 6;
key.shadow.camera.updateProjectionMatrix();
key.shadow.mapSize.set(4096, 4096);
key.position.set(6, 14, 8);

// studio: gradient cyclorama + soft boxes
RectAreaLightUniformsLib.init();
const scene = stage.scene;
scene.background = new THREE.Color(0x0d0e11);
(floor.material as THREE.MeshStandardMaterial).color.set(0x2c2e33);
floor.scale.setScalar(2.2);
(floor.material as THREE.MeshStandardMaterial).roughness = 0.75;
const cyc = new THREE.Mesh(
  new THREE.SphereGeometry(60, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'varying vec3 vP; void main(){ float h = clamp(vP.y/60.0,0.0,1.0); vec3 a = vec3(0.055,0.058,0.066); vec3 b = vec3(0.012,0.013,0.016); gl_FragColor = vec4(mix(a,b,pow(h,0.6)),1.0); }',
  }),
);
scene.add(cyc);
if (P.get('softbox') === '1') {
  const box = new THREE.RectAreaLight(0xfff6ec, 0.12, 10, 4);
  box.position.set(0, 6, 0);
  box.lookAt(0, 0, 0);
  scene.add(box);
}
const fill = new THREE.DirectionalLight(0xdfe8ff, 0.6);
fill.position.set(-8, 5, 4);
scene.add(fill);

await preloadCarAssets();

if (P.get('dispose') === '1') {
  // lifecycle check: build + dispose every team, then continue normally
  for (const t of TEAMS) {
    const a = createCar(t, t.drivers[0], 0);
    const b = createCar(t, t.drivers[1], 1);
    a.dispose();
    b.dispose();
  }
  console.log('[shot] dispose cycle ok');
}
const cars: CarRig[] = [];
const t0 = performance.now();
if (grid) {
  TEAMS.forEach((team, i) => {
    const seat = (Number(P.get('seat') ?? 0) as 0 | 1);
    const car = createCar(team, team.drivers[seat], seat);
    const row = Math.floor(i / 5);
    const col = i % 5;
    car.root.position.set((col - 2) * 3.7 + (row ? 1.2 : 0), 0, row === 0 ? 3.4 : -3.6);
    car.root.rotation.y = Number(P.get('yaw') ?? 22) * (Math.PI / 180);
    scene.add(car.root);
    cars.push(car);
  });
} else {
  const team = TEAMS.find((t) => t.id === (P.get('team') ?? 'rossa')) ?? TEAMS[0];
  const seat = (Number(P.get('seat') ?? 0) as 0 | 1);
  const car = createCar(team, team.drivers[seat], seat);
  car.root.rotation.y = Number(P.get('yaw') ?? 0) * (Math.PI / 180);
  scene.add(car.root);
  cars.push(car);
}
const buildMs = performance.now() - t0;
(window as unknown as { __carRoot: THREE.Object3D }).__carRoot = cars[0].root;
if (P.get('atlas')) {
  // debug: show a texture of the first car's paint/trim/driver material
  const which = P.get('atlas')!;
  let img: HTMLCanvasElement | null = null;
  cars[0].root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!img && m && m.name && m.name.includes(which) && m.map) img = m.map.image as HTMLCanvasElement;
  });
  if (img) {
    const c = img as HTMLCanvasElement;
    c.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:auto;z-index:10;background:#000';
    document.body.appendChild(c);
  }
}

const detail = Number(P.get('detail') ?? 0) as 0 | 1 | 2;
if (P.get('hide')) {
  const h = P.get('hide')!;
  for (const c of cars)
    c.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && m.name.includes(h)) m.visible = false;
    });
}
for (const c of cars) {
  c.setDetail(detail);
  c.setDrs(P.get('drs') === '1' ? 1 : 0);
  c.setBrakeGlow(P.get('brake') === '1' ? 1 : Number(P.get('brake') ?? 0));
  c.setRainLight(P.get('rain') === '1');
  c.setDriverVisible(P.get('driver') !== '0');
  if (P.get('steer')) c.setSteer(Number(P.get('steer')));
  if (P.get('speed')) c.setWheelSpeed(Number(P.get('speed')));
}

function countDraws(o: THREE.Object3D): number {
  if (!o.visible) return 0;
  let n = (o as THREE.Mesh).isMesh ? 1 : 0;
  for (const c of o.children) n += countDraws(c);
  return n;
}
let lastInfo: unknown = null;
Object.defineProperty(window, '__info', {
  configurable: true,
  get() {
    return {
      renderer: lastInfo,
      carDraws: countDraws(cars[0].root),
      carTris: [carTriangles(0), carTriangles(1), carTriangles(2)],
      bbox: (() => {
        const b = new THREE.Box3().setFromObject(cars[0].root);
        const v = b.getSize(new THREE.Vector3());
        return [v.x, v.y, v.z].map((n) => +n.toFixed(3));
      })(),
      buildMs: Math.round(buildMs),
    };
  },
  set(v) {
    lastInfo = v;
  },
});

const spin = P.get('spin') === '1';
let ang = 0;
stage.onFrame((dt, t) => {
  for (const c of cars) {
    if (spin) {
      const v = 30;
      ang += (v / 0.36) * dt;
      c.setWheelSpin(ang, ang);
      c.setWheelSpeed(v);
      c.setSteer(Math.sin(t * 1.3) * 0.3);
    }
    c.update(dt);
  }
});
stage.start();
