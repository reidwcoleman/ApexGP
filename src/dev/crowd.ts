import * as THREE from 'three';
import { createDevStage, studioLighting } from './devkit.ts';
import { loadPeople } from '../people/Humans.ts';
import { FanCrowd, renderFanAtlas, type FanSpot } from '../people/Crowd.ts';

/** the instanced crowd (?n=rows, ?act=0…9 forces an act, ?atlas=1 shows the grandstand atlas, ?calm=0..1, ?lod=metres: beyond it the far level of detail) */
const P = new URLSearchParams(location.search);
const stage = createDevStage({ cam: new THREE.Vector3(0, 2.2, 9), look: new THREE.Vector3(0, 1.2, 0), fov: 40 });
studioLighting(stage);
const kit = await loadPeople();
const spots: FanSpot[] = [];
const rows = Number(P.get('n') ?? 4);
for (let r = 0; r < rows; r++)
  for (let c = -8; c <= 8; c++) spots.push({ x: c * 0.72 + (r % 2) * 0.36, y: 0, z: -r * 0.8, yaw: (Math.random() - 0.5) * 0.4, team: Math.floor(Math.random() * 11), act: P.get('act') !== null ? Number(P.get('act')) : undefined });
const t0 = performance.now();
const crowd = new FanCrowd(kit, spots, { shadows: true, lodDistance: P.get('lod') !== null ? Number(P.get('lod')) : undefined });
console.log('[shot] crowd built in', Math.round(performance.now() - t0), 'ms for', spots.length);
stage.scene.add(crowd.group);
if (P.get('atlas') === '1') {
  const cv = renderFanAtlas(kit);
  cv.style.cssText = 'position:fixed;left:0;bottom:0;width:100%;background:#556';
  document.body.appendChild(cv);
}
const calm = Number(P.get('calm') ?? 0);
stage.onFrame((_dt, t) => crowd.update(t, calm));
stage.start();
