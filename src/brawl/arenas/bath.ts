import * as THREE from 'three';
import type { ArenaDef } from '../arena.ts';
import { PEL } from '../fighter.ts';
import { GRAVITY } from '../phys.ts';

const A = 9.0, B = 5.6, DRAIN = new THREE.Vector3(6.2, 0, -1.6), TAP = new THREE.Vector3(-6.95, 0, 0);
const inTub = (x: number, z: number, k = 1) => (x / (A * k)) ** 2 + (z / (B * k)) ** 2 < 1;
const wave = (x: number, z: number, t: number) => Math.sin(x * 0.7 + t * 1.3) * 0.06 + Math.sin(z * 0.9 - t * 1.1) * 0.05;

/** SPLASH TUB: stand on the rim or the floating toys; the water is out. */
export const BATH: ArenaDef = {
  id: 'bath',
  name: 'Splash Tub',
  blurb: 'Bath time. Keep your footing on the rubber duck and the slippery soap.',
  file: 'bath',
  killY: -6,
  camYaw: 0,
  camPitch: 0.7,
  camMin: 15,
  look: { sky: [0xbfe6ff, 0xeaf6ff], fog: 0xd8eef8, fogNear: 40, fogFar: 120, sun: 0xfff2e0, sunI: 2.5, sunDir: [-0.5, 1, 0.6], hemi: [0xd8ecff, 0x7a96a0, 0.7], exposure: 1, bloom: 0.6 },
  script(a, ctx) {
    // the water: see-through, rippling
    const water = a.nodes.get('water') as THREE.Mesh | undefined;
    const uTime = { value: 0 };
    if (water) {
      const m = new THREE.MeshPhysicalMaterial({ color: 0x5ab8e6, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.68, depthWrite: false, clearcoat: 1, envMapIntensity: 1.2 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = uTime;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWp;')
          .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec2 wp = vWp.xz;
vec3 wn = vec3(cos(wp.x * 2.1 + uTime * 1.7) * 0.06 + cos((wp.x + wp.y) * 3.3 - uTime * 2.3) * 0.04, 1.0, cos(wp.y * 2.6 - uTime * 1.4) * 0.06 + cos((wp.x - wp.y) * 4.1 + uTime * 1.9) * 0.03);
normal = normalize((viewMatrix * vec4(normalize(wn), 0.0)).xyz);`);
      };
      water.material = m;
      water.receiveShadow = true;
      water.castShadow = false;
      water.renderOrder = 2;
    }
    const stream = a.nodes.get('stream');
    stream?.traverse((o) => {
      const mm = o as THREE.Mesh;
      if (mm.isMesh) mm.material = new THREE.MeshStandardMaterial({ color: 0xbfe8ff, roughness: 0.1, transparent: true, opacity: 0.55, emissive: 0x4a90b0, emissiveIntensity: 0.4, depthWrite: false });
    });
    const swirl = a.nodes.get('swirl');
    const foam: THREE.Object3D[] = [];
    a.root.traverse((o) => {
      if (o.name.startsWith('foam_')) foam.push(o);
    });
    const foamBase = foam.map((f) => f.position.clone());
    for (const p of a.props) if (p.node.userData.slick) for (let i = 0; i < p.body.numColliders(); i++) {
      const c = p.body.collider(i);
      ctx.parts.set(c.handle, { ...(ctx.parts.get(c.handle) ?? {}), slick: 1 });
    }
    const q = new THREE.Quaternion(), up = new THREE.Vector3(), ax = new THREE.Vector3(), tmp = new THREE.Vector3();
    const splashed = new Set<number>();
    return {
      step(dt, t) {
        uTime.value = t;
        for (const p of a.props) {
          const b = p.body;
          const ud = p.node.userData as { fx?: number; fy?: number; fz?: number };
          const fy = ud.fy ?? 0.4;
          const tr = b.translation(), v = b.linvel(), w = b.angvel(), M = b.mass();
          const lvl = wave(tr.x, tr.z, t);
          const bottom = tr.y - fy;
          const d = THREE.MathUtils.clamp(lvl - bottom, 0, fy * 2.2);
          if (d > 0) {
            const k = (M * GRAVITY) / (fy * 0.85);
            let fyN = k * d - M * 2.6 * v.y;
            fyN = Math.max(0, fyN);
            // drift: the drain swirls, the tap pushes, water drags
            tmp.set(tr.x - DRAIN.x, 0, tr.z - DRAIN.z);
            const dl = tmp.length() || 1;
            const sw = Math.max(0, 1 - dl / 9) * 1.4;
            let fx = (-tmp.z / dl) * sw * M - (tmp.x / dl) * sw * 0.3 * M - v.x * M * 0.9;
            let fz = (tmp.x / dl) * sw * M - (tmp.z / dl) * sw * 0.3 * M - v.z * M * 0.9;
            const tapD = Math.hypot(tr.x - TAP.x, tr.z - TAP.z);
            if (tapD < 2.4) fx += (2.4 - tapD) * M * 2.5;
            b.applyImpulse({ x: fx * dt, y: fyN * dt, z: fz * dt }, true);
            // stay upright-ish, stop spinning
            const r = b.rotation();
            q.set(r.x, r.y, r.z, r.w);
            up.set(0, 1, 0).applyQuaternion(q);
            ax.crossVectors(up, new THREE.Vector3(0, 1, 0));
            const I = M * fy * fy;
            b.applyTorqueImpulse({ x: (ax.x * 40 - w.x * 4) * I * dt, y: -w.y * 1.5 * I * dt, z: (ax.z * 40 - w.z * 4) * I * dt }, true);
          }
          // a toy that escaped the tub comes back from the tap
          if (tr.y < -5 || !inTub(tr.x, tr.z, 1.15)) {
            b.setTranslation({ x: TAP.x + 2.5, y: 1.5, z: (Math.random() - 0.5) * 3 }, true);
            b.setLinvel({ x: 2, y: 0, z: 0 }, true);
            b.setAngvel({ x: 0, y: 0, z: 0 }, true);
            b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
          }
        }
        // the tap's stream knocks fighters back
        for (const f of ctx.fighters()) {
          if (!f.alive || f.out) continue;
          const p = f.pos[PEL];
          if (Math.hypot(p.x - TAP.x, p.z - TAP.z) < 1.0 && p.y > -0.5 && p.y < 4) {
            for (const bd of f.bodies) bd.applyImpulse({ x: bd.mass() * 9 * dt, y: -bd.mass() * 4 * dt, z: 0 }, true);
          }
        }
      },
      frame(_dt, t) {
        if (swirl) swirl.rotation.y = -t * 1.6;
        foam.forEach((f, i) => {
          const b = foamBase[i];
          f.position.y = b.y + wave(b.x, b.z, t);
          f.rotation.y = t * 0.1 + i;
        });
        if (stream) stream.scale.set(1 + Math.sin(t * 23) * 0.05, 1, 1 + Math.cos(t * 19) * 0.05);
      },
      out(f) {
        const p = f.pos[PEL];
        if (inTub(p.x, p.z) && p.y < -0.3) {
          if (!splashed.has(f.slot)) {
            splashed.add(f.slot);
            ctx.splash(new THREE.Vector3(p.x, 0.1, p.z));
          }
          return true;
        }
        splashed.delete(f.slot);
        return false;
      },
      safe(p) {
        return !(inTub(p.x, p.z) && p.y < 0.15);
      },
    };
  },
};
