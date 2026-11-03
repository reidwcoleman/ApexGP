// Street life and scenery: traffic (cars, taxis, vans, buses) that stops at corners, street trees, park
// trees, lamps that glow at night, rooftop clutter, drifting clouds and the sky dome.
import * as THREE from 'three';
import type { City } from './city.ts';
import { pointIn } from './city.ts';

const rnd = (s: number) => () => ((s = (s * 16807) % 2147483647) / 2147483647);

/** Box with per-vertex colour and a glow tag (1 = headlight, 2 = taillight, 3 = window lit at night). */
function box(out: { p: number[]; n: number[]; c: number[]; g: number[] }, sx: number, sy: number, sz: number, x: number, y: number, z: number, col: [number, number, number], glow = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z).toNonIndexed();
  const P = g.getAttribute('position').array as Float32Array, N = g.getAttribute('normal').array as Float32Array;
  for (let i = 0; i < P.length; i += 3) {
    out.p.push(P[i], P[i + 1], P[i + 2]); out.n.push(N[i], N[i + 1], N[i + 2]); out.c.push(...col); out.g.push(glow);
  }
}
function geoOf(o: { p: number[]; n: number[]; c: number[]; g: number[] }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(o.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(o.c, 3));
  g.setAttribute('aGlow', new THREE.Float32BufferAttribute(o.g, 1));
  return g;
}
function glowMat(night: { value: number }) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = night;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow; varying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; varying float vGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vGlow > 0.5 && vGlow < 1.5) totalEmissiveRadiance += vec3(1.0, 0.95, 0.8) * (0.25 + 2.2 * uNight);
        else if (vGlow > 1.5 && vGlow < 2.5) totalEmissiveRadiance += vec3(1.0, 0.1, 0.05) * (0.3 + 1.6 * uNight);
        else if (vGlow > 2.5) totalEmissiveRadiance += vec3(1.0, 0.85, 0.55) * 1.4 * uNight;`);
  };
  return m;
}

interface Car { e: number; dir: number; s: number; v: number; vmax: number; wait: number; lane: number; type: number; on: boolean }

export class Life {
  city: City;
  scene: THREE.Scene;
  night: { value: number };
  cars: Car[] = [];
  carMesh: THREE.InstancedMesh[] = [];
  private carEdges: number[] = [];
  private carCum: Float32Array;
  roofs!: THREE.InstancedMesh;
  tanks!: THREE.InstancedMesh;
  private roofRange = new Map<number, number[]>();
  private tankRange = new Map<number, number[]>();
  private roofM: THREE.Matrix4[] = [];
  private tankM: THREE.Matrix4[] = [];
  lampHead!: THREE.InstancedMesh;
  pools!: THREE.InstancedMesh;
  clouds: THREE.Group[] = [];
  sky: THREE.Mesh;
  skyU = { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunC: { value: new THREE.Color() }, uNight: { value: 0 }, uTime: { value: 0 } };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(scene: THREE.Scene, city: City, night: { value: number }) {
    this.scene = scene; this.city = city; this.night = night;
    const R = rnd(city.def.id.length * 7919 + 13);
    // ---------------------------------------------------------------- cars
    const c = city;
    let acc = 0;
    const cum: number[] = [];
    c.edges.forEach((e, i) => { if (e.car && e.cls >= 1) { this.carEdges.push(i); acc += e.len * (e.cls >= 3 ? 2.2 : e.cls === 2 ? 1.3 : 0.6); cum.push(acc); } });
    this.carCum = Float32Array.from(cum);
    const carG = (() => {
      const o = { p: [] as number[], n: [] as number[], c: [] as number[], g: [] as number[] };
      const W: [number, number, number] = [1, 1, 1], D: [number, number, number] = [0.12, 0.14, 0.17], T: [number, number, number] = [0.15, 0.15, 0.15];
      box(o, 1.8, 0.75, 4.4, 0, 0.62, 0, W);
      box(o, 1.6, 0.62, 2.3, 0, 1.3, -0.25, D);
      box(o, 1.62, 0.1, 2.0, 0, 1.66, -0.25, W);
      for (const x of [-0.92, 0.92]) for (const z of [-1.35, 1.35]) box(o, 0.22, 0.6, 0.6, x, 0.3, z, T);
      box(o, 0.4, 0.18, 0.06, -0.6, 0.72, 2.2, [1, 1, 0.9], 1); box(o, 0.4, 0.18, 0.06, 0.6, 0.72, 2.2, [1, 1, 0.9], 1);
      box(o, 0.4, 0.16, 0.06, -0.6, 0.78, -2.2, [0.8, 0.1, 0.1], 2); box(o, 0.4, 0.16, 0.06, 0.6, 0.78, -2.2, [0.8, 0.1, 0.1], 2);
      return geoOf(o);
    })();
    const vanG = (() => {
      const o = { p: [] as number[], n: [] as number[], c: [] as number[], g: [] as number[] };
      box(o, 2.0, 2.1, 5.2, 0, 1.35, 0, [1, 1, 1]);
      box(o, 1.9, 0.7, 0.1, 0, 1.75, 2.6, [0.12, 0.14, 0.17]);
      for (const x of [-1, 1]) for (const z of [-1.6, 1.6]) box(o, 0.24, 0.66, 0.66, x, 0.33, z, [0.15, 0.15, 0.15]);
      box(o, 0.4, 0.2, 0.06, -0.65, 0.8, 2.62, [1, 1, 0.9], 1); box(o, 0.4, 0.2, 0.06, 0.65, 0.8, 2.62, [1, 1, 0.9], 1);
      box(o, 0.3, 0.3, 0.06, -0.8, 1.0, -2.62, [0.8, 0.1, 0.1], 2); box(o, 0.3, 0.3, 0.06, 0.8, 1.0, -2.62, [0.8, 0.1, 0.1], 2);
      return geoOf(o);
    })();
    const busG = (() => {
      const o = { p: [] as number[], n: [] as number[], c: [] as number[], g: [] as number[] };
      box(o, 2.5, 2.7, 11.5, 0, 1.75, 0, [1, 1, 1]);
      box(o, 2.54, 0.9, 10.2, 0, 2.2, -0.3, [0.13, 0.16, 0.2], 3);
      box(o, 2.3, 1.1, 0.1, 0, 2.1, 5.76, [0.13, 0.16, 0.2]);
      for (const x of [-1.2, 1.2]) for (const z of [-3.8, 3.6]) box(o, 0.26, 0.9, 0.9, x, 0.45, z, [0.15, 0.15, 0.15]);
      box(o, 0.45, 0.22, 0.06, -0.85, 0.9, 5.77, [1, 1, 0.9], 1); box(o, 0.45, 0.22, 0.06, 0.85, 0.9, 5.77, [1, 1, 0.9], 1);
      box(o, 0.35, 0.35, 0.06, -1.0, 1.1, -5.77, [0.8, 0.1, 0.1], 2); box(o, 0.35, 0.35, 0.06, 1.0, 1.1, -5.77, [0.8, 0.1, 0.1], 2);
      return geoOf(o);
    })();
    const nCars = Math.round(Math.min(340, Math.max(80, this.carEdges.length * 0.9)) * c.def.crowd);
    const counts = [nCars, Math.round(nCars * 0.12), Math.max(4, Math.round(nCars * 0.05))];
    const mat = glowMat(night);
    [carG, vanG, busG].forEach((g, k) => {
      const im = new THREE.InstancedMesh(g, mat, counts[k]);
      im.castShadow = true;
      im.frustumCulled = false;
      this.carMesh.push(im);
      scene.add(im);
    });
    const carCols = [0xe8e6e1, 0x2b2d33, 0x9aa3ad, 0xb33951, 0x2f5fa8, 0xf2c230, 0xf2c230, 0xf2c230, 0x5c6b4a, 0xffffff, 0x7a1f2b, 0x3d7be5];
    const vanCols = [0xffffff, 0xf4f1e8, 0x8a5a3c, 0xe5533d];
    const busCols = [0x3d7be5, 0xe5533d, 0x22b26b];
    const col = new THREE.Color();
    counts.forEach((n, k) => {
      for (let i = 0; i < n; i++) {
        const car: Car = { e: 0, dir: 1, s: 0, v: 0, vmax: k === 2 ? 8 : 9 + R() * 6, wait: 0, lane: 0, type: k, on: true };
        this.spawnCar(car, R);
        this.cars.push(car);
        const pal = k === 0 ? carCols : k === 1 ? vanCols : busCols;
        this.carMesh[k].setColorAt(i, col.setHex(pal[Math.floor(R() * pal.length)]));
      }
    });
    // ---------------------------------------------------------------- trees + lamps
    const trees: number[][] = [];
    const lamps: number[][] = [];
    const nearBuilding = (x: number, z: number) => c.buildingAt(x, z) || c.buildingAt(x + 1.6, z) || c.buildingAt(x - 1.6, z) || c.buildingAt(x, z + 1.6) || c.buildingAt(x, z - 1.6);
    for (const e of c.edges) {
      if (!e.car || e.cls < 1 || e.len < 18) continue;
      const ax = c.nx[e.a], az = c.nz[e.a], bx = c.nx[e.b], bz = c.nz[e.b];
      const ux = (bx - ax) / e.len, uz = (bz - az) / e.len;
      for (const side of [-1, 1]) {
        const off = e.w / 2 + 2.3;
        for (let t = 7; t < e.len - 7; t += 11 + R() * 5) {
          const x = ax + ux * t - uz * off * side, z = az + uz * t + ux * off * side;
          if (nearBuilding(x, z)) continue;
          if (R() < 0.82) trees.push([x, z, 0.75 + R() * 0.55, R()]);
        }
        if (side === 1) for (let t = 10; t < e.len - 5; t += 30) {
          const x = ax + ux * t - uz * (e.w / 2 + 0.9) * side, z = az + uz * t + ux * (e.w / 2 + 0.9) * side;
          if (!c.buildingAt(x, z)) lamps.push([x, z, Math.atan2(-uz * side, ux * side)]);
        }
      }
    }
    for (const p of c.parks) {
      if (p.kind === 1 || p.kind === 2) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < p.pts.length; i += 2) { x0 = Math.min(x0, p.pts[i]); x1 = Math.max(x1, p.pts[i]); z0 = Math.min(z0, p.pts[i + 1]); z1 = Math.max(z1, p.pts[i + 1]); }
      const area = (x1 - x0) * (z1 - z0);
      const n = Math.min(160, Math.floor(area / (p.kind === 3 ? 60 : 140)));
      for (let k = 0; k < n; k++) {
        const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
        if (pointIn(p.pts, x, z) && !c.buildingAt(x, z) && !c.nearestEdge(x, z, 5)) trees.push([x, z, 0.9 + R() * 0.8, R()]);
      }
    }
    trees.length = Math.min(trees.length, 4200);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.24, 2.6, 6).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 1 }), trees.length);
    const crownG = new THREE.IcosahedronGeometry(2.2, 1);
    crownG.translate(0, 4.2, 0);
    const crown = new THREE.InstancedMesh(crownG, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), trees.length);
    trees.forEach((t, i) => {
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), t[3] * 6.28);
      this.m.compose(this.v.set(t[0], 0, t[1]), this.q, this.sc.set(t[2], t[2] * (0.9 + t[3] * 0.3), t[2]));
      trunk.setMatrixAt(i, this.m);
      crown.setMatrixAt(i, this.m);
      crown.setColorAt(i, col.setHSL(0.24 + t[3] * 0.1, 0.45 + t[3] * 0.15, 0.36 + t[3] * 0.1));
    });
    crown.castShadow = true; trunk.castShadow = true; crown.receiveShadow = true;
    scene.add(trunk, crown);
    // lamps: a pole, an arm and a head that lights up, plus a warm pool on the pavement at night
    const poleO = { p: [] as number[], n: [] as number[], c: [] as number[], g: [] as number[] };
    box(poleO, 0.18, 6, 0.18, 0, 3, 0, [0.22, 0.23, 0.25]);
    box(poleO, 0.12, 0.12, 1.6, 0, 5.9, 0.8, [0.22, 0.23, 0.25]);
    box(poleO, 0.5, 0.18, 0.7, 0, 5.8, 1.5, [1, 0.9, 0.7], 3);
    const pole = new THREE.InstancedMesh(geoOf(poleO), glowMat(night), lamps.length);
    const poolMat = new THREE.MeshBasicMaterial({ color: 0xffc77a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const pools = new THREE.InstancedMesh(new THREE.CircleGeometry(5.5, 20).rotateX(-Math.PI / 2), poolMat, lamps.length);
    lamps.forEach((l, i) => {
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), l[2]);
      this.m.compose(this.v.set(l[0], 0, l[1]), this.q, this.sc.set(1, 1, 1));
      pole.setMatrixAt(i, this.m);
      const hx = l[0] + Math.sin(l[2]) * 1.5, hz = l[1] + Math.cos(l[2]) * 1.5;
      this.m.makeTranslation(hx, 0.16, hz);
      pools.setMatrixAt(i, this.m);
    });
    pools.renderOrder = 3;
    this.pools = pools;
    this.lampHead = pole;
    scene.add(pole, pools);
    // ---------------------------------------------------------------- rooftops
    const roofs: number[][] = [], tanks: number[][] = [];
    const tall = c.def.defaultH >= 30 || c.def.id === 'nyc';
    for (const b of c.buildings) {
      if (b.area < 140 || R() < 0.4) continue;
      const n = Math.min(3, 1 + Math.floor(b.area / 900) + (R() < 0.3 ? 1 : 0));
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < b.pts.length; i += 2) { x0 = Math.min(x0, b.pts[i]); x1 = Math.max(x1, b.pts[i]); z0 = Math.min(z0, b.pts[i + 1]); z1 = Math.max(z1, b.pts[i + 1]); }
      const rr: number[] = [], tr: number[] = [];
      for (let k = 0, guard = 0; k < n && guard < 20; guard++) {
        const x = x0 + R() * (x1 - x0), z = z0 + R() * (z1 - z0);
        if (!pointIn(b.pts, x, z) || !pointIn(b.pts, x + 3, z) || !pointIn(b.pts, x - 3, z) || !pointIn(b.pts, x, z + 3) || !pointIn(b.pts, x, z - 3)) continue;
        k++;
        if (tall && b.h > 25 && R() < 0.35) { tr.push(tanks.length); tanks.push([x, b.h, z, 0.75 + R() * 0.45]); }
        else { rr.push(roofs.length); roofs.push([x, b.h, z, 1.6 + R() * 3, 1.2 + R() * 2, 1.6 + R() * 3, R() * 3.14]); }
      }
      if (rr.length) this.roofRange.set(b.id, rr);
      if (tr.length) this.tankRange.set(b.id, tr);
    }
    this.roofs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xc9c2b6, roughness: 0.9 }), Math.max(1, roofs.length));
    roofs.forEach((r, i) => {
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), r[6]);
      this.m.compose(this.v.set(r[0], r[1], r[2]), this.q, this.sc.set(r[3], r[4], r[5]));
      this.roofs.setMatrixAt(i, this.m);
      this.roofM.push(this.m.clone());
      this.roofs.setColorAt(i, col.setHSL(0.08, 0.05 + R() * 0.08, 0.72 + R() * 0.16));
    });
    const tankG = new THREE.CylinderGeometry(1.7, 1.7, 2.6, 12).translate(0, 3.1, 0);
    const legs = new THREE.CylinderGeometry(1.3, 1.3, 1.8, 4, 1, true).translate(0, 0.9, 0);
    const cone = new THREE.ConeGeometry(1.85, 1.1, 12).translate(0, 4.95, 0);
    const tg = new THREE.BufferGeometry();
    {
      const parts = [tankG, legs, cone].map((g) => g.toNonIndexed());
      const P: number[] = [], N: number[] = [];
      parts.forEach((g) => { P.push(...(g.getAttribute('position').array as Float32Array)); N.push(...(g.getAttribute('normal').array as Float32Array)); });
      tg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      tg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    }
    this.tanks = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0xa8774f, roughness: 0.95, side: THREE.DoubleSide }), Math.max(1, tanks.length));
    tanks.forEach((t, i) => {
      this.m.compose(this.v.set(t[0], t[1], t[2]), this.q.identity(), this.sc.set(t[3], t[3], t[3]));
      this.tanks.setMatrixAt(i, this.m);
      this.tankM.push(this.m.clone());
    });
    if (!tanks.length) this.tanks.count = 0;
    if (!roofs.length) this.roofs.count = 0;
    this.roofs.castShadow = true; this.tanks.castShadow = true; this.roofs.receiveShadow = true;
    scene.add(this.roofs, this.tanks);
    // ---------------------------------------------------------------- clouds
    const RR = Math.max(c.W, c.D);
    const cloudM = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
    for (let k = 0; k < 16; k++) {
      const g = new THREE.Group();
      const n = 4 + Math.floor(R() * 4);
      for (let j = 0; j < n; j++) {
        const s = 22 + R() * 30;
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), cloudM);
        m.position.set((j - n / 2) * s * 0.9 + R() * 10, R() * s * 0.4, R() * 20 - 10);
        m.scale.y = 0.55;
        g.add(m);
      }
      g.position.set((R() - 0.5) * RR * 2.4, 420 + R() * 180, (R() - 0.5) * RR * 2.4);
      g.userData.v = 4 + R() * 5;
      this.clouds.push(g);
      scene.add(g);
    }
    // ---------------------------------------------------------------- sky dome
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyU,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunC; uniform float uNight; uniform float uTime; varying vec3 vD;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        void main(){
          float y = max(vD.y, 0.0);
          vec3 c = mix(uHor, uTop, pow(y, 0.55));
          float sd = max(dot(normalize(vD), normalize(uSun)), 0.0);
          c += uSunC * (pow(sd, 600.0) * 3.0 + pow(sd, 12.0) * 0.35) * (1.0 - uNight);
          vec3 q = floor(vD * 420.0);
          float st = step(0.9975, h(q)) * smoothstep(0.05, 0.4, y) * uNight;
          c += vec3(st) * (0.6 + 0.4 * sin(uTime * 2.0 + h(q) * 30.0));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    scene.add(this.sky);
  }

  private spawnCar(car: Car, R: () => number = Math.random) {
    const r = R() * this.carCum[this.carCum.length - 1];
    let lo = 0, hi = this.carCum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.carCum[m] < r) lo = m + 1; else hi = m; }
    car.e = this.carEdges[lo];
    car.dir = R() < 0.5 ? 1 : -1;
    car.s = R() * this.city.edges[car.e].len;
    car.v = car.vmax * 0.6;
    car.wait = 0;
    car.lane = 0;
  }

  /** Hide rooftop clutter on buildings that were rebuilt as something else. */
  hideRoofs(ids: Set<number>) {
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const [b, list] of this.roofRange) for (const i of list) this.roofs.setMatrixAt(i, ids.has(b) ? z : this.roofM[i]);
    for (const [b, list] of this.tankRange) for (const i of list) this.tanks.setMatrixAt(i, ids.has(b) ? z : this.tankM[i]);
    this.roofs.instanceMatrix.needsUpdate = true;
    this.tanks.instanceMatrix.needsUpdate = true;
  }

  setSky(top: THREE.Color, hor: THREE.Color, sunDir: THREE.Vector3, sunC: THREE.Color, night: number) {
    this.skyU.uTop.value.copy(top);
    this.skyU.uHor.value.copy(hor);
    this.skyU.uSun.value.copy(sunDir);
    this.skyU.uSunC.value.copy(sunC);
    this.skyU.uNight.value = night;
  }

  update(dt: number, speed: number, crowd: number, cam: THREE.Vector3) {
    this.skyU.uTime.value += dt;
    this.sky.position.copy(cam);
    (this.pools.material as THREE.MeshBasicMaterial).opacity = 0.32 * this.night.value;
    this.pools.visible = this.night.value > 0.05;
    const c = this.city;
    const sdt = dt * Math.min(speed, 3);
    const want = Math.max(0.25, Math.min(1, crowd));
    const idx = [0, 0, 0];
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      const k = car.type;
      const id = idx[k]++;
      // fewer cars late at night: some park (hidden) at their next corner
      const keep = (i % 100) / 100 < want;
      let e = c.edges[car.e];
      if (car.wait > 0) car.wait -= sdt;
      else {
        const toEnd = e.len - car.s;
        const target = toEnd < 12 && car.lane === 1 ? car.vmax * 0.35 : car.vmax;
        car.v += (target - car.v) * Math.min(1, sdt * 1.5);
        car.s += car.v * sdt;
        if (car.s >= e.len) {
          const node = car.dir > 0 ? e.b : e.a;
          const opts = c.adj[node].filter((x) => x !== car.e && c.edges[x].car && c.edges[x].cls >= 1);
          car.on = keep;
          if (!opts.length) { car.dir = -car.dir; car.s = 0; }
          else {
            let tot = 0;
            for (const x of opts) tot += c.edges[x].cls + 0.5;
            let r = Math.random() * tot, ne = opts[0];
            for (const x of opts) { r -= c.edges[x].cls + 0.5; if (r <= 0) { ne = x; break; } }
            car.s -= e.len;
            car.e = ne;
            e = c.edges[ne];
            car.dir = e.a === node ? 1 : -1;
            if (car.s > e.len) car.s = 0;
            // a red light at a real intersection now and then
            if (c.adj[node].length >= 3 && Math.random() < 0.3) { car.wait = 1 + Math.random() * 3; car.v = 0; }
          }
          car.lane = c.adj[car.dir > 0 ? e.b : e.a].length >= 3 ? 1 : 0;
        }
      }
      if (!car.on) { this.m.makeScale(0, 0, 0); this.carMesh[k].setMatrixAt(id, this.m); continue; }
      const ax = c.nx[e.a], az = c.nz[e.a], bx = c.nx[e.b], bz = c.nz[e.b];
      const L = e.len || 1;
      let ux = (bx - ax) / L, uz = (bz - az) / L;
      const t = car.dir > 0 ? car.s : L - car.s;
      const off = Math.max(1.6, e.w / 4) * car.dir;
      const x = ax + ux * t - uz * off, z = az + uz * t + ux * off;
      if (car.dir < 0) { ux = -ux; uz = -uz; }
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), Math.atan2(ux, uz));
      this.m.compose(this.v.set(x, 0.1, z), this.q, this.sc.set(1, 1, 1));
      this.carMesh[k].setMatrixAt(id, this.m);
    }
    for (const im of this.carMesh) im.instanceMatrix.needsUpdate = true;
    // clouds drift east
    const RR = Math.max(c.W, c.D) * 1.3;
    for (const g of this.clouds) {
      g.position.x += g.userData.v * dt * Math.max(1, speed);
      if (g.position.x > RR) g.position.x = -RR;
    }
  }
}
