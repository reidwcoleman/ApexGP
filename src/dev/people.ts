import * as THREE from 'three';
import { createDevStage, studioLighting } from './devkit.ts';
import { loadPeople, Person, fanLook, printTexture, type Look } from '../people/Humans.ts';
import { TEAMS } from '../race/Teams.ts';

/** a line-up of people on the new bodies (?clip=Idle_Loop, ?close=1 for faces) */
const P = new URLSearchParams(location.search);
const close = P.get('close') === '1';
const stage = createDevStage({ cam: close ? new THREE.Vector3(0, 1.62, 2.2) : new THREE.Vector3(0, 1.3, 7.5), look: close ? new THREE.Vector3(0, 1.55, 0) : new THREE.Vector3(0, 1.0, 0), fov: close ? 30 : 36 });
studioLighting(stage);
const kit = await loadPeople();
const people: Person[] = [];
const t0 = TEAMS[0];
const suit: Look = {
  female: false, tone: 0.1, hair: 'simpleparted', hairColor: 0x2b1d14, top: 'suit', topColor: t0.primary, top2: '#1a1a1a', accent: '#ffffff',
  bottom: 'suit', bottomColor: t0.primary, shoeColor: 0x111111, gloves: null, cap: t0.primary,
  logo: printTexture({ text: t0.sponsor, color: '#ffffff', sub: t0.short, num: '16' }, { text: 'LECLAIR', color: '#ffffff', num: '16' }),
};
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const looks: Look[] = [suit, { ...suit, female: false, tone: 0.8, hair: 'buzzed', beard: true, cap: null, topColor: '#ff8000', top2: '#101216', accent: '#47c7fc', bottomColor: '#ff8000' }];
for (let i = 0; i < (close ? 2 : 8); i++) looks.push(fanLook(rand, TEAMS[i % TEAMS.length]));
const n = close ? 2 : looks.length;
const clip = P.get('clip') ?? 'Idle_Loop';
for (let i = 0; i < n; i++) {
  const p = new Person(kit, looks[i]);
  p.root.position.x = (i - (n - 1) / 2) * (close ? 0.6 : 0.8);
  stage.scene.add(p.root);
  p.play(clip, { offset: i * 0.13 });
  if (P.get('nonormal')) { const m = p.body.material as THREE.MeshPhysicalMaterial; m.normalMap = null; m.needsUpdate = true; }
  if (P.get('flat')) { const m = p.body.material as THREE.MeshPhysicalMaterial; m.map = null; m.roughnessMap = null; m.normalMap = null; m.needsUpdate = true; }
  people.push(p);
}
stage.onFrame((dt) => {
  for (const p of people) p.update(dt);
});
stage.start();
