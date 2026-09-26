import * as THREE from 'three';
import { loadAvatar, retarget, atlasHalf, mergeParts, type RbAvatar } from '../people/rocketbox.ts';
// head-swap test: ?pairs=Body:Head,Body:Head ?cam=face
const P = new URLSearchParams(location.search);
const pairs = (P.get('pairs') ?? 'Pilot_Male_01:Male_Adult_02').split(',').map((x) => x.split(':'));
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9a9a9a);
scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2));
const d = new THREE.DirectionalLight(0xffffff, 2);
d.position.set(1, 2, 3);
scene.add(d);
const face = P.get('cam') === 'face';
const W = 0.7;
const span = pairs.length * W;
const cam = new THREE.PerspectiveCamera(face ? 20 : 30, innerWidth / innerHeight, 0.05, 100);
cam.position.set(0, face ? 1.55 : 1.0, face ? 0.4 + span * 1.1 : 0.8 + span * 1.3);
cam.lookAt(0, face ? 1.5 : 0.95, 0);
function skeletonOf(a: RbAvatar) {
  const bones = a.names.map((n, i) => {
    const b = new THREE.Bone();
    b.name = n;
    b.position.copy(a.local[i].p);
    b.quaternion.copy(a.local[i].q);
    return b;
  });
  a.parents.forEach((p, i) => p >= 0 && bones[p].add(bones[i]));
  return { root: bones[0], sk: new THREE.Skeleton(bones, a.boneInverses) };
}
for (const [i, [bn, hn]] of pairs.entries()) {
  const B = await loadAvatar(bn), H = await loadAvatar(hn ?? bn);
  const { root, sk } = skeletonOf(B);
  const g = new THREE.Group();
  g.add(root);
  const headG = H === B ? H.skin : retarget(H.skin, H, B);
  const bodyGeo = mergeParts([{ g: B.skin, tris: atlasHalf(B.skin, false) }]);
  const headGeo = mergeParts([{ g: headG, tris: atlasHalf(headG, true) }]);
  const add = (geo: THREE.BufferGeometry, map: THREE.Texture, hair = false) => {
    const m = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 0.7, alphaTest: hair ? 0.4 : 0, side: hair ? THREE.DoubleSide : THREE.FrontSide }));
    m.bind(sk, new THREE.Matrix4());
    m.frustumCulled = false;
    g.add(m);
  };
  add(bodyGeo, B.map);
  add(headGeo, H.map);
  if (H.hair && H.hairMap) add(H === B ? H.hair : retarget(H.hair, H, B), H.hairMap, true);
  g.position.x = (i - (pairs.length - 1) / 2) * W;
  if (P.get('back') === '1') g.rotation.y = Math.PI;
  if (P.get('turn')) g.rotation.y = Number(P.get('turn'));
  scene.add(g);
}
renderer.render(scene, cam);
(window as unknown as { __ready: boolean }).__ready = true;
