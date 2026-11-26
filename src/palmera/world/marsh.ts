// Marsh plants: reed and cattail clumps standing along the swamp ponds' shores (some wading a little
// way in), swaying in the wind, and lily pads floating in loose rafts on about half the ponds, a few
// in flower. Instanced, split into bands along the swamp so each band frustum-culls and switches
// off past 260 m.
import * as THREE from 'three';
import { Rng } from '../core/math';
import { prep, merge } from '../core/geo';
import { pondShape, type CityMap } from './map';
import { cityUniforms } from './city';

const WATER = 0.04;

function reedClump(): THREE.BufferGeometry {
  const rng = new Rng(55);
  const parts: THREE.BufferGeometry[] = [];
  // blades: thin tapered quads leaning out from the clump's root, greener at the base, straw at the tip
  for (let i = 0; i < 20; i++) {
    const a = rng.range(0, Math.PI * 2), lean = rng.range(0.05, 0.45), h = rng.range(0.9, 1.9), w = rng.range(0.04, 0.065);
    const g = new THREE.PlaneGeometry(w, h, 1, 4);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) {
      const t = (pos.getY(k) + h / 2) / h;
      pos.setX(k, pos.getX(k) * (1 - t * 0.85));
      // bend: the lean grows with height
      pos.setY(k, t * h);
      pos.setZ(k, lean * t * t * h * 0.6);
    }
    const tip = rng.range(0.4, 1);
    const base = new THREE.Color(0x3f5a22), straw = new THREE.Color(0xa89a58), c = new THREE.Color();
    const bg = prep(g, (_x, y) => c.copy(base).lerp(straw, Math.pow(Math.min(1, y / h), 2.2) * tip));
    bg.rotateY(a);
    const rr = rng.range(0.02, 0.22);
    bg.translate(Math.cos(a) * rr, 0, Math.sin(a) * rr);
    parts.push(bg);
  }
  // two or three cattails: a stem and a brown head
  for (let i = 0; i < 3; i++) {
    const a = rng.range(0, Math.PI * 2), h = rng.range(1.3, 1.8);
    const stem = new THREE.CylinderGeometry(0.008, 0.012, h, 3);
    stem.translate(Math.cos(a) * 0.08, h / 2, Math.sin(a) * 0.08);
    parts.push(prep(stem, 0x6f7a3a));
    const head = new THREE.CapsuleGeometry(0.022, 0.15, 2, 5);
    head.translate(Math.cos(a) * 0.08, h - 0.18, Math.sin(a) * 0.08);
    parts.push(prep(head, 0x5a3a22));
  }
  return merge(parts);
}

function lilyPad(): THREE.BufferGeometry {
  // a disc with a notch, a touch domed
  const g = new THREE.CircleGeometry(0.3, 12, 0.35, Math.PI * 2 - 0.35);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, 0.012 * (1 - Math.hypot(pos.getX(i), pos.getZ(i)) / 0.3));
  g.computeVertexNormals();
  return prep(g, 0xffffff);
}

function flower(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const p = new THREE.ConeGeometry(0.035, 0.11, 3);
    p.rotateX(0.9);
    p.translate(0, 0.05, 0.05);
    p.rotateY((i / 7) * Math.PI * 2);
    parts.push(prep(p, 0xfff6f8));
  }
  const c = new THREE.SphereGeometry(0.025, 5, 4);
  c.translate(0, 0.06, 0);
  parts.push(prep(c, 0xf2c94c));
  return merge(parts);
}

/** reeds bend in the wind, more at the tip */
function swayMat(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = cityUniforms.uTime;
    sh.uniforms.uWind = cityUniforms.uWind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 ip = instanceMatrix[3].xyz;
#else
vec3 ip = vec3(0.0);
#endif
float bend = transformed.y * transformed.y * 0.05 * (0.6 + 0.4 * uWind);
transformed.x += bend * (sin(uTime * 1.7 + ip.x * 0.31 + ip.z * 0.17) + 0.4);
transformed.z += bend * 0.6 * sin(uTime * 1.3 + ip.z * 0.23);`,
    );
  };
  mat.customProgramCacheKey = () => 'palmera-reeds-v1';
  return mat;
}

export class MarshPlants {
  private bands: { g: THREE.Group; z: number }[] = [];

  constructor(scene: THREE.Scene, map: CityMap) {
    const ponds = map.flats.filter((f) => f.kind === 'pond');
    if (!ponds.length) return;
    const rng = new Rng(8181);
    const reedGeo = reedClump(), padGeo = lilyPad(), flGeo = flower();
    const reedMat = swayMat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    const padMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 });
    const flMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    const B = 10, z0 = -640, z1 = 640, bz = (z1 - z0) / B;
    const reeds: THREE.Matrix4[][] = [], pads: THREE.Matrix4[][] = [], fls: THREE.Matrix4[][] = [];
    const padCol: THREE.Color[][] = [];
    for (let b = 0; b < B; b++) reeds.push([]), pads.push([]), fls.push([]), padCol.push([]);
    const band = (z: number) => Math.max(0, Math.min(B - 1, Math.floor((z - z0) / bz)));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (const f of ponds) {
      // reeds in stands along the shore: a few arcs per pond, dense within each
      const arcs = 2 + Math.floor(rng.next() * 3);
      for (let k = 0; k < arcs; k++) {
        const a0 = rng.range(0, Math.PI * 2), span = rng.range(0.5, 1.4);
        const per = (span * (f.w + f.d)) / 4;
        const n = Math.floor(per / 0.65);
        for (let i = 0; i < n; i++) {
          const a = a0 + (i / Math.max(1, n)) * span + rng.range(-0.04, 0.04);
          const r = pondShape(f, a) * rng.range(0.9, 1.06);
          const x = f.x + Math.cos(a) * (f.w / 2) * r, z = f.z - Math.sin(a) * (f.d / 2) * r;
          const sc = rng.range(0.75, 1.3);
          q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
          m.compose(p.set(x, r < 1 ? -0.25 : -0.05, z), q, s.set(sc, sc * rng.range(0.85, 1.15), sc));
          reeds[band(z)].push(m.clone());
        }
      }
      // lily pads on about half the ponds: a raft or two near the edge
      if (rng.chance(0.55)) {
        const rafts = 1 + Math.floor(rng.next() * 2);
        for (let k = 0; k < rafts; k++) {
          const a = rng.range(0, Math.PI * 2), rr = pondShape(f, a) * rng.range(0.45, 0.72);
          const cx = f.x + Math.cos(a) * (f.w / 2) * rr, cz = f.z - Math.sin(a) * (f.d / 2) * rr;
          const n = 14 + Math.floor(rng.next() * 26);
          for (let i = 0; i < n; i++) {
            const pa = rng.range(0, Math.PI * 2), pr = Math.sqrt(rng.next()) * rng.range(2.5, 4.5);
            const x = cx + Math.cos(pa) * pr, z = cz + Math.sin(pa) * pr;
            const sc = rng.range(0.6, 1.4);
            q.setFromAxisAngle(up, rng.range(0, Math.PI * 2));
            m.compose(p.set(x, WATER + 0.005 + rng.range(0, 0.004), z), q, s.set(sc, 1, sc));
            pads[band(z)].push(m.clone());
            padCol[band(z)].push(new THREE.Color().setHSL(rng.range(0.22, 0.3), rng.range(0.4, 0.6), rng.range(0.13, 0.22)));
            if (rng.chance(0.08)) {
              m.compose(p.set(x + 0.05, WATER + 0.012, z), q, s.set(1, 1, 1));
              fls[band(z)].push(m.clone());
            }
          }
        }
      }
    }
    const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[], cols?: THREE.Color[]) => {
      const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((mm, i) => im.setMatrixAt(i, mm));
      if (cols) cols.forEach((c, i) => im.setColorAt(i, c));
      im.count = list.length;
      im.computeBoundingSphere();
      im.receiveShadow = true;
      return im;
    };
    for (let b = 0; b < B; b++) {
      const g = new THREE.Group();
      if (reeds[b].length) g.add(inst(reedGeo, reedMat, reeds[b]));
      if (pads[b].length) g.add(inst(padGeo, padMat, pads[b], padCol[b]));
      if (fls[b].length) g.add(inst(flGeo, flMat, fls[b]));
      scene.add(g);
      this.bands.push({ g, z: z0 + (b + 0.5) * bz });
    }
  }

  update(cam: THREE.Vector3) {
    // the swamp runs x -720..-480; a band shows when the camera is within 260 m of it
    const dx = Math.max(0, cam.x + 480, -720 - cam.x);
    for (const b of this.bands) {
      const dz = Math.max(0, Math.abs(cam.z - b.z) - 64);
      b.g.visible = dx * dx + dz * dz < 260 * 260;
    }
  }
}
