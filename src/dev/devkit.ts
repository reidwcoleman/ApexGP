import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Renderer, type QualityLevel } from '../core/Renderer.ts';

/**
 * Tiny harness for the dev pages in src/dev/*.html.
 *
 * URL params understood by every dev page:
 *   ?cam=x,y,z&look=x,y,z   camera position and target
 *   ?fov=50                 vertical fov
 *   ?q=high                 quality level (low|medium|high|ultra)
 *   ?frames=40              frames to render before window.__ready = true
 */
export interface DevStage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  gfx: Renderer;
  controls: OrbitControls;
  params: URLSearchParams;
  onFrame(fn: (dt: number, t: number) => void): void;
  start(): void;
}

declare global {
  interface Window {
    __ready?: boolean;
    __info?: unknown;
  }
}

function vec(p: string | null, d: THREE.Vector3): THREE.Vector3 {
  if (!p) return d;
  const [x, y, z] = p.split(',').map(Number);
  return new THREE.Vector3(x, y, z);
}

export function createDevStage(defaults: { cam?: THREE.Vector3; look?: THREE.Vector3; fov?: number; near?: number; far?: number } = {}): DevStage {
  const params = new URLSearchParams(location.search);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  document.body.style.margin = '0';
  document.body.style.background = '#000';
  document.body.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(Number(params.get('fov') ?? defaults.fov ?? 45), innerWidth / innerHeight, defaults.near ?? 0.1, defaults.far ?? 20000);
  camera.position.copy(vec(params.get('cam'), defaults.cam ?? new THREE.Vector3(6, 3, 8)));
  const look = vec(params.get('look'), defaults.look ?? new THREE.Vector3(0, 0.5, 0));
  camera.lookAt(look);

  const gfx = new Renderer(canvas, scene, camera, (params.get('q') as QualityLevel) ?? 'high');
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(look);
  controls.enableDamping = true;
  controls.update();

  addEventListener('resize', () => gfx.resize());

  const cbs: ((dt: number, t: number) => void)[] = [];
  const readyAfter = Number(params.get('frames') ?? 40);
  let frames = 0;
  const timer = new THREE.Timer();
  return {
    scene,
    camera,
    gfx,
    controls,
    params,
    onFrame(fn) {
      cbs.push(fn);
    },
    start() {
      const loop = (now?: number) => {
        timer.update(now);
        const dt = Math.min(timer.getDelta(), 0.05);
        const t = timer.getElapsed();
        controls.update();
        for (const fn of cbs) fn(dt, t);
        gfx.render(dt);
        frames++;
        if (frames === readyAfter) {
          window.__ready = true;
          const info = gfx.renderer.info;
          window.__info = { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures };
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
  };
}

/** Neutral studio lighting for asset pages that don't bring their own sky. */
export function studioLighting(stage: DevStage, intensity = 1) {
  const pmrem = new THREE.PMREMGenerator(stage.gfx.renderer);
  stage.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  stage.scene.environmentIntensity = 0.9 * intensity;
  stage.scene.background = new THREE.Color(0x1b1d22);
  const key = new THREE.DirectionalLight(0xfff4e6, 3.2 * intensity);
  key.position.set(8, 14, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  stage.scene.add(key);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.55, metalness: 0 }),
  );
  floor.receiveShadow = true;
  stage.scene.add(floor);
  return { key, floor };
}
