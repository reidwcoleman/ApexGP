import * as THREE from 'three';
import { createDevStage, studioLighting } from './devkit.ts';
import { allEntries } from '../race/Teams.ts';
import { loadPeople, Person } from '../people/Humans.ts';
import { driverLook } from '../people/drivers.ts';
import { naturalStance } from '../people/poses.ts';

/**
 * The 22 drivers in their suits (?team=<index> for a close pair, ?row=0|1 for one
 * half of the field).
 */
const P = new URLSearchParams(location.search);
const team = P.get('team');
const close = team !== null;
const stage = createDevStage({
  cam: close ? new THREE.Vector3(0, 1.62, 2.2) : new THREE.Vector3(0, 1.4, 7.4),
  look: close ? new THREE.Vector3(0, 1.5, 0) : new THREE.Vector3(0, 1.1, 0),
  fov: close ? 30 : 34,
});
studioLighting(stage);
const kit = await loadPeople();
let es = allEntries();
if (close) es = es.filter((e) => e.team === es[Number(team) * 2].team);
else es = es.slice(P.get('row') === '1' ? 11 : 0, P.get('row') === '1' ? 22 : 11);
const people = es.map((e, i) => {
  const p = new Person(kit, driverLook(e.team, e.driver));
  p.root.position.x = (i - (es.length - 1) / 2) * (close ? 0.62 : 0.66);
  p.play('Idle_Loop', { offset: i * 0.17 });
  stage.scene.add(p.root);
  return p;
});
stage.onFrame((dt) => {
  for (const p of people) {
    p.update(dt);
    naturalStance(p, 0.85);
  }
});
stage.start();
