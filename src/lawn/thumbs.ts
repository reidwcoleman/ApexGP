/** A portrait of each mower for the shed, drawn once on a throwaway renderer in a soft studio. */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MOWERS } from './save.ts';
import { buildMowerModel } from './mower.ts';

export function renderThumbs(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 320;
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(320, 320, false);
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    const pm = new THREE.PMREMGenerator(r);
    const scene = new THREE.Scene();
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    const sun = new THREE.DirectionalLight('#fff4dc', 2.2);
    sun.position.set(-3, 6, 4);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
    for (const def of MOWERS) {
      const model = buildMowerModel(def, def.width);
      const g = model.group;
      g.rotation.y = -0.7;
      scene.add(g);
      const box = new THREE.Box3().setFromObject(g);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      cam.position.set(c.x + size * 0.8, c.y + size * 0.55, c.z + size * 1.1);
      cam.lookAt(c);
      r.render(scene, cam);
      out[def.id] = canvas.toDataURL('image/png');
      scene.remove(g);
      model.dispose();
    }
    pm.dispose();
    r.dispose();
    r.forceContextLoss();
  } catch {
    /* no portraits: the shed shows names */
  }
  return out;
}
