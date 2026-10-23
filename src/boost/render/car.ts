import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Car } from '../sim/car.ts';

/**
 * A rocket car built from code, in the simulation's car frame (cm; x forward, y left, z up): a
 * low wedge body between four fender pods, a tinted canopy under a roof panel, a wing, twin boost
 * nozzles, light strips, chunky wheels on visible suspension travel. Clear-coated team paint with the
 * player's accent colour in racing stripes, rims and the wing.
 */

export const TEAM_COLORS = [0x1f63ff, 0xff6a10];

function profile(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/** extrude a side profile (x, z) across the width, centred on y = 0 */
function sideExtrude(pts: [number, number][], width: number, bevel: number, seg = 3): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(profile(pts), { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: seg, curveSegments: 4 });
  g.rotateX(Math.PI / 2);
  g.translate(0, (width - bevel * 2) / 2, 0);
  return g;
}

let shared: {
  body: THREE.BufferGeometry;
  cabin: THREE.BufferGeometry;
  roof: THREE.BufferGeometry;
  fender: THREE.BufferGeometry;
  skirt: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
  tyre: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  nozzle: THREE.BufferGeometry;
  flame: THREE.BufferGeometry;
} | null = null;

function geos() {
  if (shared) return shared;
  const body = sideExtrude(
    [
      [-52, 4],
      [58, 4],
      [71, 7],
      [79, 12],
      [77, 18],
      [52, 24],
      [28, 28],
      [-30, 30.5],
      [-48, 29],
      [-56, 22],
      [-56, 8],
    ],
    76,
    5,
    4,
  );
  // shape the wedge: a narrower nose, tumblehome above the shoulder, a pinched tail
  const p = body.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    let y = p.getY(i);
    if (x > 48) y *= 1 - ((x - 48) / 31) * 0.24;
    if (x < -42) y *= 1 - ((-42 - x) / 14) * 0.06;
    if (z > 19) y *= 1 - ((z - 19) / 12) * 0.13;
    p.setY(i, y);
  }
  body.computeVertexNormals();
  const cabin = sideExtrude(
    [
      [31, 27],
      [7, 41.5],
      [-21, 42.5],
      [-41, 30.5],
      [-39, 29],
      [27, 26],
    ],
    56,
    5,
  );
  const cp = cabin.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    const z = cp.getZ(i);
    cp.setY(i, cp.getY(i) * (1 - Math.max(0, (z - 30) / 12) * 0.2));
  }
  cabin.computeVertexNormals();
  const roof = sideExtrude(
    [
      [5, 43.6],
    [-20, 44.4],
      [-22, 42.8],
      [4, 41.9],
    ],
    42,
    1.2,
    2,
  );
  // fender pod: an arch over the wheel
  const fender = new THREE.TorusGeometry(17, 3.6, 10, 24, Math.PI * 1.08);
  fender.rotateX(Math.PI / 2);
  fender.rotateY(-Math.PI * 0.05);
  const skirt = new THREE.BoxGeometry(48, 7, 7);
  const wing = mergeGeometries([
    (() => {
      const w = sideExtrude(
        [
          [-45, 39.5],
          [-60, 42],
          [-61, 40.5],
          [-46, 38.2],
        ],
        70,
        0.8,
        2,
      );
      return w;
    })(),
    new THREE.BoxGeometry(3, 2.5, 11).translate(-51, 20, 33.5).toNonIndexed(),
    new THREE.BoxGeometry(3, 2.5, 11).translate(-51, -20, 33.5).toNonIndexed(),
  ]);
  const tyre = new THREE.CylinderGeometry(1, 1, 1, 36, 1);
  const rim = mergeGeometries([
    new THREE.CylinderGeometry(0.66, 0.66, 1.04, 24, 1),
    ...[0, 1, 2, 3, 4].map((k) => {
      const b = new THREE.BoxGeometry(0.16, 1.1, 0.62);
      b.translate(0, 0, 0.31);
      b.rotateY((k / 5) * Math.PI * 2);
      return b;
    }),
  ]);
  const nozzle = new THREE.CylinderGeometry(4.6, 3.6, 8, 20, 1, true);
  nozzle.rotateZ(Math.PI / 2);
  const flame = new THREE.ConeGeometry(1, 1, 18, 6, true);
  flame.rotateZ(Math.PI / 2); // tip toward +x... flipped below
  flame.translate(-0.5, 0, 0);
  const crease = (g: THREE.BufferGeometry) => toCreasedNormals(g, (50 * Math.PI) / 180);
  shared = { body: crease(body), cabin: crease(cabin), roof: crease(roof), fender, skirt, wing: crease(wing), tyre, rim, nozzle, flame };
  return shared;
}

const WHEELS: [number, number, number][] = [
  [51.25, 33, 12.8],
  [51.25, -33, 12.8],
  [-33.75, 33, 15],
  [-33.75, -33, 15],
];

export class CarView {
  readonly group = new THREE.Group();
  private readonly paint: THREE.MeshPhysicalMaterial;
  private wheels: { pivot: THREE.Group; spin: THREE.Group; r: number; front: boolean; z0: number }[] = [];
  private flames: THREE.Mesh[] = [];
  private flameMat: THREE.ShaderMaterial;
  private nozzleGlow: THREE.MeshBasicMaterial;
  private spin = 0;
  private tag: THREE.Sprite | null = null;
  readonly team: number;
  boostVis = 0;

  constructor(team: number, accent: number, name?: string) {
    this.team = team;
    const g = geos();
    const teamC = new THREE.Color(TEAM_COLORS[team]);
    const accC = new THREE.Color(accent);
    this.paint = new THREE.MeshPhysicalMaterial({ color: teamC, metalness: 0.4, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.0 });
    const uAcc = { value: accC };
    this.paint.onBeforeCompile = (sh) => {
      sh.uniforms.uAcc = uAcc;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObj;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObj = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vObj;\nuniform vec3 uAcc;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float st = step(abs(abs(vObj.y) - 7.5), 3.0) * step(23.0, vObj.z);
          float side = step(abs(vObj.z - 16.0 - vObj.x * 0.04), 1.4) * step(30.0, abs(vObj.y)) * step(vObj.x, 70.0) * step(-50.0, vObj.x);
          float skirt = step(vObj.z, 8.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, uAcc, max(st, side));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), skirt);`,
        );
    };
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.55, metalness: 0.4 });
    const carbon = new THREE.MeshPhysicalMaterial({ color: 0x1b1d22, roughness: 0.35, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0e16, roughness: 0.04, metalness: 0.9, envMapIntensity: 1.8, clearcoat: 1 });
    const accentM = new THREE.MeshPhysicalMaterial({ color: accC, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0f0f11, roughness: 0.92, metalness: 0 });
    const rimM = new THREE.MeshStandardMaterial({ color: accC.clone().lerp(new THREE.Color(0xd0d4dc), 0.45), roughness: 0.28, metalness: 0.55, envMapIntensity: 1.6 });

    const add = (geo: THREE.BufferGeometry, m: THREE.Material, cast = true) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    add(g.body, this.paint);
    add(g.cabin, glass);
    add(g.roof, this.paint);
    add(g.wing, accentM);
    for (const [wx, wy] of WHEELS) {
      const f = add(g.fender, carbon);
      const wr = wx > 0 ? 12.8 : 15;
      f.position.set(wx, wy + Math.sign(wy) * 4.5, wr - 17 + 1.5);
      f.scale.set((wr + 4) / 17, 1, (wr + 4) / 17);
    }
    for (const sy of [-1, 1]) {
      const s = add(g.skirt, carbon);
      s.position.set(9, sy * 36, 7);
      // the splitter and diffuser
    }
    add(new THREE.BoxGeometry(16, 64, 2).translate(70, 0, 4), carbon);
    add(new THREE.BoxGeometry(6, 56, 7).translate(-55, 0, 8), carbon);
    // lights
    const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 4.4) });
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.25, 0.2) });
    for (const sy of [-1, 1]) {
      add(new THREE.BoxGeometry(2, 14, 2).translate(77.6, sy * 15, 14.5), head, false);
      add(new THREE.BoxGeometry(1.5, 14, 2.2).translate(-56.8, sy * 22, 24), tail, false);
    }
    // boost nozzles and flames
    this.nozzleGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.4, 0.1) });
    this.flameMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(team === 0 ? 0x5fb0ff : 0xffa040) }, uK: { value: 0 } },
      vertexShader: `varying vec3 vP; varying vec2 vU; void main(){ vP = position; vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
      fragmentShader: `uniform float uT; uniform vec3 uC; uniform float uK; varying vec3 vP; varying vec2 vU;
        float h(float n){ return fract(sin(n)*43758.5453); }
        void main(){ float t = clamp(-vP.x, 0.0, 1.0);
          float n = 0.5 + 0.5*sin(vU.x*40.0 + uT*60.0) * sin(t*20.0 - uT*80.0);
          float core = (1.0 - t) * (1.0 - t);
          vec3 c = mix(uC * 1.6, vec3(1.6, 1.5, 1.2), core * 0.8);
          float a = (1.0 - t) * (0.6 + 0.4*n) * uK;
          gl_FragColor = vec4(c * a * 2.2, a); }`,
    });
    for (const sy of [-1, 1]) {
      const nz = add(g.nozzle, dark, false);
      nz.position.set(-57, sy * 11, 15);
      const glow = add(new THREE.CircleGeometry(3.4, 16).rotateY(-Math.PI / 2).translate(-58.5, sy * 11, 15), this.nozzleGlow, false);
      void glow;
      const fl = new THREE.Mesh(g.flame, this.flameMat);
      fl.position.set(-60, sy * 11, 15);
      fl.scale.set(60, 4.8, 4.8);
      fl.renderOrder = 9;
      fl.frustumCulled = false;
      this.group.add(fl);
      this.flames.push(fl);
    }
    // wheels
    for (const [wx, wy, wr] of WHEELS) {
      const pivot = new THREE.Group();
      const spin = new THREE.Group();
      const z0 = wr - 17;
      pivot.position.set(wx, wy, z0);
      const w = wr < 15 ? 10 : 12;
      const t = new THREE.Mesh(g.tyre, rubber);
      t.scale.set(wr, w, wr);
      t.castShadow = true;
      const rm = new THREE.Mesh(g.rim, rimM);
      rm.scale.set(wr, w, wr);
      spin.add(t, rm);
      pivot.add(spin);
      this.group.add(pivot);
      this.wheels.push({ pivot, spin, r: wr, front: wx > 0, z0 });
    }
    if (name) this.setName(name);
  }

  setName(name: string): void {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 96;
    const x = c.getContext('2d')!;
    x.font = 'italic 900 56px "Titillium Web", Arial, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.lineWidth = 10;
    x.strokeStyle = 'rgba(0,0,0,0.75)';
    x.strokeText(name.toUpperCase(), 256, 50);
    x.fillStyle = this.team === 0 ? '#7fb6ff' : '#ffb27a';
    x.fillText(name.toUpperCase(), 256, 50);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, fog: false }));
    sp.scale.set(160, 30, 1);
    sp.position.set(0, 0, 110);
    sp.renderOrder = 20;
    this.tag = sp;
    this.group.add(sp);
  }

  showTag(v: boolean): void {
    if (this.tag) this.tag.visible = v;
  }

  setAccent(c: number): void {
    void c;
  }

  /** pose from the simulated car (positions already smoothed by the caller) */
  update(car: Car, pos: THREE.Vector3, quat: THREE.Quaternion, dt: number, t: number): void {
    this.group.visible = car.alive;
    if (!car.alive) return;
    this.group.position.copy(pos);
    this.group.quaternion.copy(quat);
    const vf = car.vel.dot(car.rot.f);
    this.spin += (vf / 14) * dt;
    const steer = car.input.steer * (0.42 - Math.min(0.3, Math.abs(vf) / 6000));
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.spin.rotation.y = this.spin * (14 / w.r);
      if (w.front) w.pivot.rotation.z = -steer * (car.onGround ? 1 : 0.6);
      const comp = car.wheelComp[i];
      const target = w.z0 + (car.wheelContact[i] ? Math.min(6, comp) - 1.5 : -2.5);
      w.pivot.position.z += (target - w.pivot.position.z) * Math.min(1, dt * 25);
    }
    const k = car.boosting ? 1 : 0;
    this.boostVis += (k - this.boostVis) * Math.min(1, dt * (k ? 30 : 12));
    this.flameMat.uniforms.uT.value = t;
    this.flameMat.uniforms.uK.value = this.boostVis;
    for (const f of this.flames) {
      f.visible = this.boostVis > 0.02;
      const L = 40 + 30 * this.boostVis + Math.sin(t * 70 + f.position.y) * 6;
      f.scale.set(L, 4.4 + this.boostVis, 4.4 + this.boostVis);
    }
    this.nozzleGlow.color.setRGB(1 + this.boostVis * 5, 0.35 + this.boostVis * 2.5, 0.1 + this.boostVis * 1.2);
  }
}
