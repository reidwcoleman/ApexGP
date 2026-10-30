import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { BODY, NPART, PART_NAMES, HEAD, type Fighter } from './fighter.ts';

/**
 * How a fighter looks: the Blender plush (public/brawl/fighter.glb), its eleven bones set straight
 * from the eleven rigid bodies every frame, dyed the fighter's colour with a felt shader, a hat from
 * public/brawl/hats.glb on the head bone, and stars when it's knocked out.
 */

export const HATS = ['party', 'crown', 'beanie', 'chef', 'propeller', 'cone', 'tophat', 'daisy', 'sunhat', 'viking', 'phones', 'bucket', 'sailor'];

interface Assets {
  fighter: THREE.Object3D;
  hats: Map<string, THREE.Object3D>;
}
let assets: Assets | null = null;

export async function loadLooks(base: string) {
  const loader = new GLTFLoader();
  const [f, h] = await Promise.all([loader.loadAsync(base + 'brawl/fighter.glb'), loader.loadAsync(base + 'brawl/hats.glb')]);
  const hats = new Map<string, THREE.Object3D>();
  h.scene.traverse((o) => {
    if (o.name.startsWith('hat_') || o.name.startsWith('spin_')) hats.set(o.name, o);
  });
  assets = { fighter: f.scene, hats };
}

const restPos = (i: number) => {
  const B = BODY;
  const c = [B.pelvis.c, B.chest.c, B.head.c, B.upperarm.c, B.forearm.c, B.upperarm.c, B.forearm.c, B.thigh.c, B.shin.c, B.thigh.c, B.shin.c][i];
  const mirror = i === 5 || i === 6 || i === 9 || i === 10;
  return new THREE.Vector3(mirror ? -c[0] : c[0], c[1], c[2]);
};

/** felt: a fine fuzz in the colour, brighter rims (the sheen does the rest) */
function feltify(m: THREE.MeshStandardMaterial) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFelt;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFelt = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFelt;
float fh(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float fn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(fh(i), fh(i+vec3(1,0,0)), f.x), mix(fh(i+vec3(0,1,0)), fh(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(fh(i+vec3(0,0,1)), fh(i+vec3(1,0,1)), f.x), mix(fh(i+vec3(0,1,1)), fh(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float fz = fn(vFelt * 140.0) * 0.55 + fn(vFelt * 37.0) * 0.45;
diffuseColor.rgb *= 0.86 + 0.2 * fz;`);
  };
  m.customProgramCacheKey = () => 'felt';
}

export class FighterLook {
  root: THREE.Object3D;
  bones: THREE.Bone[] = [];
  offsets: THREE.Matrix4[] = [];
  mats: THREE.MeshPhysicalMaterial[] = [];
  koEyes: THREE.Object3D[] = [];
  eyes: THREE.Object3D[] = [];
  hat: THREE.Object3D | null = null;
  spin: THREE.Object3D | null = null;
  stars: THREE.Group;
  private m = new THREE.Matrix4();
  private s1 = new THREE.Vector3(1, 1, 1);

  constructor(scene: THREE.Scene, color: number, hat: string) {
    if (!assets) throw new Error('looks not loaded');
    this.root = SkeletonUtils.clone(assets.fighter);
    scene.add(this.root);
    const byName = new Map<string, THREE.Bone>();
    this.root.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
      const sm = o as THREE.SkinnedMesh;
      if (sm.isMesh) {
        sm.frustumCulled = false;
        sm.castShadow = true;
        sm.receiveShadow = true;
        const m0 = sm.material as THREE.MeshPhysicalMaterial;
        const m = m0.clone();
        sm.material = m;
        const n = m0.name;
        if (n === 'plush' || n === 'patch') {
          const c = new THREE.Color(color);
          if (n === 'patch') c.lerp(new THREE.Color(0xfff6e8), 0.55);
          m.color.copy(c);
          m.sheen = 0.7;
          m.sheenRoughness = 0.55;
          m.sheenColor = new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.25);
          m.envMapIntensity = 0.6;
          m.roughness = 0.92;
          feltify(m);
          this.mats.push(m);
        }
        if (n === 'thread_ko') {
          this.koEyes.push(sm);
          sm.visible = false;
        }
        if (n === 'button') this.eyes.push(sm);
      }
    });
    // three sanitizes node names ('upperarm.L' -> 'upperarmL')
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < NPART; i++) {
      const b = byName.get(THREE.PropertyBinding.sanitizeNodeName(PART_NAMES[i]))!;
      this.bones[i] = b;
      b.matrixAutoUpdate = false;
      const inv = new THREE.Matrix4().makeTranslation(restPos(i)).invert();
      this.offsets[i] = inv.multiply(b.matrixWorld.clone());
    }
    // the hat hangs on the head bone, built around the rest head centre
    const hb = this.bones[HEAD];
    const hatLocal = new THREE.Matrix4().copy(hb.matrixWorld).invert().multiply(new THREE.Matrix4().makeTranslation(0, BODY.head.c[1] + 0.01, 0));
    const add = (key: string) => {
      const src = assets!.hats.get(key);
      if (!src) return null;
      const h = src.clone(true);
      const local = new THREE.Matrix4().copy(hatLocal).multiply(new THREE.Matrix4().compose(src.position, src.quaternion, src.scale));
      local.decompose(h.position, h.quaternion, h.scale);
      h.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.frustumCulled = false;
        }
      });
      hb.add(h);
      return h;
    };
    this.hat = add('hat_' + hat);
    if (hat === 'propeller') this.spin = add('spin_propeller');
    // knocked-out stars
    this.stars = new THREE.Group();
    const sg = starGeometry();
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffe14a : 0xffffff, toneMapped: false }));
      this.stars.add(s);
    }
    this.stars.visible = false;
    scene.add(this.stars);
  }

  sync(f: Fighter, t: number, dt: number) {
    const vis = f.alive;
    this.root.visible = vis;
    if (!vis) {
      this.stars.visible = false;
      return;
    }
    const m = this.m;
    for (let i = 0; i < NPART; i++) {
      m.compose(f.pos[i], f.rot[i], this.s1).multiply(this.offsets[i]);
      this.bones[i].matrix.copy(m);
    }
    this.root.updateMatrixWorld(true);
    const ko = f.ko > 0;
    for (const e of this.koEyes) e.visible = ko;
    for (const e of this.eyes) e.visible = !ko;
    if (this.spin) this.spin.rotateY(dt * (8 + f.speed * 6));
    this.stars.visible = ko || f.daze > 70;
    if (this.stars.visible) {
      const hp = f.pos[HEAD];
      this.stars.children.forEach((s, i) => {
        const a = t * 3.2 + (i / 4) * Math.PI * 2;
        s.position.set(hp.x + Math.cos(a) * 0.36, hp.y + 0.42 + Math.sin(a * 2) * 0.04, hp.z + Math.sin(a) * 0.36);
        s.rotation.y = -a;
        s.rotation.z = t * 4;
      });
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.root);
    scene.remove(this.stars);
    for (const m of this.mats) m.dispose();
  }
}

let _star: THREE.BufferGeometry | null = null;
function starGeometry() {
  if (_star) return _star;
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.04 : 0.09;
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  _star = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false });
  _star.translate(0, 0, -0.0125);
  return _star;
}
