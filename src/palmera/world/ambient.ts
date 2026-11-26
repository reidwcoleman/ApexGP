import * as THREE from 'three';
import { carModel } from '../entities/carModels';
import { BEACH, ISLAND, WATER_Y } from './map';

/**
 * The life above and off the city: gulls wheeling over the sand, boats running up and down the
 * coast with white wakes, and a little plane towing a banner along the beach (Florida's oldest
 * advertisement).
 */

const gullVert = /* glsl */ `
attribute float aPhase;
uniform float uTime;
varying float vShade;
void main() {
  vec3 p = position;
  // the wings flap: tips (|x| big) go up and down
  float flap = sin(uTime * 9.0 + aPhase * 6.28) * 0.55;
  p.y += abs(p.x) * flap;
  vShade = 0.75 + 0.25 * step(0.0, p.y);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const gullFrag = /* glsl */ `
varying float vShade;
uniform vec3 uLight;
void main() { gl_FragColor = vec4(vec3(0.93, 0.93, 0.9) * vShade * uLight, 1.0); }`;

function gullGeo(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // body along z, two swept wings along x
  const v = [
    0, 0, 0.35, -0.55, 0.04, -0.05, 0, 0, -0.1,
    0, 0, 0.35, 0, 0, -0.1, 0.55, 0.04, -0.05,
    -0.55, 0.04, -0.05, -0.85, 0.0, -0.25, 0, 0, -0.1,
    0.55, 0.04, -0.05, 0, 0, -0.1, 0.85, 0.0, -0.25,
    0, 0.02, 0.35, 0, 0.02, -0.45, 0.04, -0.06, 0.0,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

interface Boat { mesh: THREE.Mesh; wake: THREE.Mesh; cx: number; cz: number; rx: number; rz: number; w: number; a: number }

export class Ambient {
  private gulls: THREE.InstancedMesh;
  private gullU: Record<string, THREE.IUniform>;
  private flocks: { cx: number; cz: number; r: number; h: number; speed: number; n: number; a0: number }[] = [];
  private boats: Boat[] = [];
  private plane: THREE.Group;
  private planeT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const n = 36;
    const geo = gullGeo();
    const ph = new Float32Array(n);
    for (let i = 0; i < n; i++) ph[i] = Math.random();
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(ph, 1));
    this.gullU = { uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } };
    this.gulls = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ vertexShader: gullVert, fragmentShader: gullFrag, uniforms: this.gullU, side: THREE.DoubleSide }), n);
    this.gulls.frustumCulled = false;
    scene.add(this.gulls);
    for (let f = 0; f < 6; f++) this.flocks.push({ cx: 0, cz: 0, r: 14 + Math.random() * 20, h: 9 + Math.random() * 16, speed: 0.15 + Math.random() * 0.2, n: 6, a0: Math.random() * 6 });

    // boats offshore
    const bm = carModel('boat');
    const hull = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
    const detail = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
    const lamps = new THREE.MeshBasicMaterial({ vertexColors: true });
    const wakeMat = new THREE.MeshBasicMaterial({ map: wakeTexture(), transparent: true, depthWrite: false, opacity: 0.85 });
    const wakeGeo = new THREE.PlaneGeometry(5, 26);
    wakeGeo.rotateX(-Math.PI / 2);
    wakeGeo.translate(0, 0, -15);
    for (let i = 0; i < 7; i++) {
      const mesh = new THREE.Mesh(bm.geo, [hull, detail, lamps]);
      mesh.scale.setScalar(0.8 + Math.random() * 0.6);
      mesh.castShadow = true;
      const wake = new THREE.Mesh(wakeGeo, wakeMat);
      wake.renderOrder = 2;
      mesh.add(wake);
      scene.add(mesh);
      this.boats.push({
        mesh, wake,
        cx: BEACH.x1 + 140 + Math.random() * 260, cz: (Math.random() - 0.5) * 900,
        rx: 40 + Math.random() * 120, rz: 200 + Math.random() * 300,
        w: (0.012 + Math.random() * 0.02) * (Math.random() < 0.5 ? -1 : 1), a: Math.random() * 6,
      });
    }

    // the banner plane
    this.plane = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.35, 7, 10), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.4, metalness: 0.2 }));
    body.rotation.x = Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(10, 0.12, 1.4), body.material);
    wing.position.set(0, 0.4, 0.8);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.9), body.material);
    tail.position.set(0, 0.2, -3.2);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 1), new THREE.MeshStandardMaterial({ color: 0xd8574a }));
    fin.position.set(0, 0.8, -3.2);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(26, 4), new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.9 }));
    banner.rotation.y = Math.PI / 2;
    banner.position.set(0, -1.5, -28);
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 14), new THREE.MeshBasicMaterial({ color: 0x333333 }));
    rope.position.set(0, -0.8, -10);
    this.plane.add(body, wing, tail, fin, banner, rope);
    this.plane.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    scene.add(this.plane);
  }

  update(dt: number, t: number, focus: THREE.Vector3, day: number, light: THREE.Color) {
    this.gullU.uTime.value = t;
    (this.gullU.uLight.value as THREE.Color).copy(light);
    // flocks follow you along the coast (they hang over the beach and the bay)
    let k = 0;
    this.flocks.forEach((f, fi) => {
      const tx = BEACH.x0 + 30 + fi * 18 + Math.sin(fi * 2.1) * 40;
      const tz = focus.z + (fi - 2.5) * 45;
      if (Math.abs(f.cx - tx) > 200 || Math.abs(f.cz - tz) > 260) {
        f.cx = tx;
        f.cz = tz;
      }
      f.cx += (tx - f.cx) * dt * 0.05;
      f.cz += (tz - f.cz) * dt * 0.05;
      for (let i = 0; i < f.n; i++) {
        const a = f.a0 + t * f.speed + (i / f.n) * 1.4 + Math.sin(t * 0.3 + i) * 0.1;
        const r = f.r + Math.sin(i * 3.3) * 4;
        const x = f.cx + Math.cos(a) * r, z = f.cz + Math.sin(a) * r, y = WATER_Y + f.h + Math.sin(t * 0.7 + i) * 1.5;
        this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + (f.speed > 0 ? Math.PI : 0));
        const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.35);
        this.q.multiply(bank);
        this.m.compose(this.v.set(x, y, z), this.q, new THREE.Vector3(0.9, 0.9, 0.9));
        this.gulls.setMatrixAt(k++, this.m);
      }
    });
    this.gulls.count = day > 0.2 ? k : 0;
    this.gulls.instanceMatrix.needsUpdate = true;

    for (const b of this.boats) {
      b.a += b.w * dt * 3;
      const x = b.cx + Math.cos(b.a) * b.rx, z = b.cz + Math.sin(b.a) * b.rz;
      const dx = -Math.sin(b.a) * b.rx * Math.sign(b.w), dz = Math.cos(b.a) * b.rz * Math.sign(b.w);
      b.mesh.position.set(x, WATER_Y + Math.sin(t * 1.3 + b.cx) * 0.12, z);
      b.mesh.rotation.set(-0.05, Math.atan2(dx, dz), Math.sin(t * 0.9 + b.cz) * 0.04);
    }

    // the banner plane: a pass along the beach every couple of minutes
    this.planeT += dt;
    const period = 95, pass = this.planeT % period;
    const span = ISLAND.z1 - ISLAND.z0 + 600;
    const s = pass / 40;
    this.plane.visible = s < 1 && day > 0.3;
    if (this.plane.visible) {
      const dir = Math.floor(this.planeT / period) % 2 ? 1 : -1;
      const z = dir > 0 ? ISLAND.z0 - 300 + s * span : ISLAND.z1 + 300 - s * span;
      this.plane.position.set(BEACH.x0 + 110, WATER_Y + 70, z);
      this.plane.rotation.set(0, dir > 0 ? 0 : Math.PI, Math.sin(t) * 0.03);
    }
  }
}

function wakeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 900; i++) {
    const v = i / 900;
    const y = 256 * v;
    const spread = 6 + v * 26;
    const a = (1 - v) * 0.5;
    x.fillStyle = `rgba(255,255,255,${a * Math.random()})`;
    for (const sgn of [-1, 1]) x.fillRect(32 + sgn * spread * (0.6 + Math.random() * 0.4) - 1, 256 - y, 2 + Math.random() * 3, 2);
    x.fillStyle = `rgba(255,255,255,${a * 0.5 * Math.random()})`;
    x.fillRect(32 - spread * 0.3 + Math.random() * spread * 0.6, 256 - y, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

function bannerTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff8ec';
  x.fillRect(0, 0, 1024, 160);
  x.fillStyle = '#e2445c';
  x.font = 'bold 92px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('PALMERA DAYS FEST · SAT', 512, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
