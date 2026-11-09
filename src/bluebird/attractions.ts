// Bluebird Peak: the late-game attractions you can see (ice rink with skaters, a tubing ramp, the summit
// restaurant, a steaming hot-springs spa, a heli-skiing helicopter) and how events show on the mountain
// (a banner over the base, race gates and a finish arch, a torchlight parade, fireworks).
import * as THREE from 'three';
import { Mountain, RUNS } from './mountain.ts';
import type { World } from './world.ts';
import type { Sim } from './sim.ts';
import type { Village } from './village.ts';
import type { Fx } from './fx.ts';
import { skierGeo, JACKETS } from './people.ts';
import { EVENT_BY, tierOf } from './data.ts';

const M = (c: number, r = 0.8, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, ...extra });

export const SPOTS = {
  rink: [-22, 590] as [number, number],
  tubing: [-276, 528] as [number, number],
  summithut: [-28, -506] as [number, number],
  spa: [-218, 584] as [number, number],
  heli: [302, 482] as [number, number],
  banner: [22, 462] as [number, number],
};
const HELI_DROP = new THREE.Vector3(-170, 0, -610);

function bannerTexture(text: string, sub: string, bg: string) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 192;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 1024, 0);
  grd.addColorStop(0, bg); grd.addColorStop(1, '#1f3a5f');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 192);
  g.fillStyle = '#f2c46d'; g.fillRect(0, 0, 1024, 10); g.fillRect(0, 182, 1024, 10);
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = 'italic 800 96px "Barlow Condensed", "Barlow", sans-serif';
  g.fillText(text.toUpperCase(), 512, 112);
  g.font = '700 34px "Barlow", sans-serif'; g.fillStyle = '#f2c46d';
  g.fillText(sub.toUpperCase(), 512, 162);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** additive coloured sparks for fireworks */
class Sparks {
  points: THREE.Points;
  N = 2400;
  pos = new Float32Array(this.N * 3);
  vel = new Float32Array(this.N * 3);
  col = new Float32Array(this.N * 3);
  life = new Float32Array(this.N);
  head = 0;
  constructor(scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
      vertexShader: `varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = clamp(3000.0 / -mv.z, 1.5, 9.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); if (a < 0.02) discard; gl_FragColor = vec4(vC * a * 1.6, 1.0); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  burst(x: number, y: number, z: number, color: THREE.Color, n = 140, speed = 26) {
    for (let k = 0; k < n; k++) {
      const i = this.head; this.head = (this.head + 1) % this.N;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const v = speed * (0.75 + Math.random() * 0.25);
      this.pos.set([x, y, z], i * 3);
      this.vel.set([r * Math.cos(th) * v, u * v, r * Math.sin(th) * v], i * 3);
      this.life[i] = 1.6 + Math.random() * 0.8;
      this.col.set([color.r, color.g, color.b], i * 3);
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) { if (this.pos[i * 3 + 1] > -900) this.pos[i * 3 + 1] = -1000; continue; }
      this.life[i] -= dt;
      const d = Math.exp(-dt * 1.6);
      this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - 9 * dt; this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const fade = Math.min(1, this.life[i] / 0.8);
      this.col[i * 3] *= fade < 1 ? 0.985 : 1; this.col[i * 3 + 1] *= fade < 1 ? 0.975 : 1; this.col[i * 3 + 2] *= fade < 1 ? 0.975 : 1;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('color').needsUpdate = true;
  }
}

interface Mover { a: number; r: number; sp: number; ph: number }

export class Attractions {
  group = new THREE.Group();
  ev = new THREE.Group();
  private key = '';
  private evKey = '';
  private skaters: THREE.InstancedMesh | null = null;
  private skaterJ: THREE.InstancedMesh | null = null;
  private movers: Mover[] = [];
  private tubes: THREE.InstancedMesh | null = null;
  private tubeLanes = 0;
  private heli: THREE.Group | null = null;
  private rotor: THREE.Object3D | null = null;
  private heliT = 0;
  private spaPool: THREE.Vector3 | null = null;
  private torches: THREE.InstancedMesh;
  private sparks: Sparks;
  private fwT = 0;
  private dummy = new THREE.Object3D();
  private glowM: THREE.MeshStandardMaterial;

  constructor(private w: World, private m: Mountain, private village: Village, private fx: Fx) {
    w.scene.add(this.group, this.ev);
    this.glowM = w.glow(M(0xffffff, 0.4, { emissive: 0xffd9a0, emissiveIntensity: 1 }), 2.2);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffa040 });
    this.torches = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 8, 6), tm, 30);
    this.torches.count = 0;
    this.torches.frustumCulled = false;
    w.scene.add(this.torches);
    this.sparks = new Sparks(w.scene);
  }

  private at(x: number, z: number) { return this.m.at(x, z); }
  private put(o: THREE.Object3D, x: number, z: number, rot = 0, dy = 0) {
    o.position.set(x, this.at(x, z) + dy, z);
    o.rotation.y = rot;
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    this.group.add(o);
    return o;
  }

  update(sim: Sim) {
    const key = ['tubing', 'rink', 'summithut', 'spa', 'heli'].map((k) => tierOf(sim.lv(k), 4)).join(',');
    if (key !== this.key) { this.key = key; this.rebuild(sim); }
  }

  private rebuild(sim: Sim) {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.skaters = this.skaterJ = this.tubes = null;
    this.heli = this.rotor = null;
    this.spaPool = null;
    const vis = (k: string) => tierOf(sim.lv(k), 4);

    // ---------------------------------------------------------------- ice rink
    const R = vis('rink');
    if (R) {
      const g = new THREE.Group();
      const a = 17 + R * 2, b = 10 + R;
      const ice = new THREE.Mesh(new THREE.CircleGeometry(1, 48), M(0xd8eef8, 0.12, { metalness: 0.1 }));
      ice.scale.set(a, b, 1); ice.rotation.x = -Math.PI / 2; ice.position.y = 0.25;
      g.add(ice);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 64), M(0xffffff, 0.5));
      ring.scale.set(a + 0.4, b + 0.4, 12); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.6;
      g.add(ring);
      const top = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 4, 64), M(0x2f7fe0, 0.5));
      top.scale.set(a + 0.4, b + 0.4, 6); top.rotation.x = -Math.PI / 2; top.position.y = 1.15;
      g.add(top);
      // string lights on poles
      for (let i = 0; i < 12; i++) {
        const th = (i / 12) * Math.PI * 2;
        const x = Math.cos(th) * (a + 2.5), z = Math.sin(th) * (b + 2.5);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5, 5), M(0x3b2a1e));
        pole.position.set(x, 2.5, z);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), this.glowM);
        bulb.position.set(x, 5.1, z);
        g.add(pole, bulb);
      }
      // a little warming hut
      const hut = this.village.chalet(6, 4, 3, 0x3f6f9a, { trim: 0x24425e });
      hut.position.set(a + 6, 0, -2);
      hut.rotation.y = -Math.PI / 2;
      g.add(hut);
      this.put(g, SPOTS.rink[0], SPOTS.rink[1], 0, 0);
      const n = 8 + R * 8;
      const sg = skierGeo('stand');
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
      this.skaters = new THREE.InstancedMesh(sg.rest, mat, n);
      this.skaterJ = new THREE.InstancedMesh(sg.jacket, mat, n);
      this.skaterJ.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      const col = new THREE.Color();
      for (let i = 0; i < n; i++) this.skaterJ.setColorAt(i, col.setHex(JACKETS[i % JACKETS.length]));
      this.movers = Array.from({ length: n }, () => ({ a, r: 0.35 + Math.random() * 0.55, sp: 0.18 + Math.random() * 0.22, ph: Math.random() * Math.PI * 2 }));
      for (const im of [this.skaters, this.skaterJ]) { im.frustumCulled = false; im.castShadow = true; this.group.add(im); }
      (this.skaters as any).userData.ab = [a, b];
    }

    // ---------------------------------------------------------------- tubing ramp
    const T = vis('tubing');
    if (T) {
      const g = new THREE.Group();
      const lanes = 2 + T, lw = 5, L = 70, H = 11;
      const W = lanes * lw + 4;
      // a snow ramp built up on the flat: wedge, high at the north end
      const shape = new THREE.Shape();
      shape.moveTo(-L / 2, 0); shape.lineTo(L / 2, 0); shape.lineTo(L / 2 - 6, 0.4); shape.lineTo(-L / 2 + 10, H); shape.lineTo(-L / 2, H); shape.closePath();
      const wedge = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false }), M(0xf2f5fa, 0.85));
      wedge.rotation.y = -Math.PI / 2; // run along +z
      wedge.position.set(W / 2, 0, 0);
      g.add(wedge);
      for (let i = 0; i <= lanes; i++) {
        const div = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 56), M(i % 2 ? 0x2f7fe0 : 0xd2453a, 0.6));
        const x = -W / 2 + 2 + i * lw;
        div.position.set(x, 0, 2);
        div.rotation.x = Math.atan2(H, L - 16);
        div.position.y = H * 0.5 + 0.2;
        g.add(div);
      }
      const deck = new THREE.Mesh(new THREE.BoxGeometry(W, 0.6, 10), M(0x9b7350));
      deck.position.set(0, H + 0.3, -L / 2 + 5);
      g.add(deck);
      const sg = this.village.sign('TUBING', '', 7, '#e0457b');
      sg.position.set(0, H + 4, -L / 2 + 1);
      sg.rotation.y = Math.PI;
      g.add(sg);
      this.put(g, SPOTS.tubing[0], SPOTS.tubing[1], 0, 0);
      this.tubeLanes = lanes;
      this.tubes = new THREE.InstancedMesh(new THREE.TorusGeometry(1.1, 0.45, 8, 16), M(0xff6f91, 0.5), lanes * 2);
      this.tubes.castShadow = true; this.tubes.frustumCulled = false;
      const tc = new THREE.Color();
      for (let i = 0; i < lanes * 2; i++) this.tubes.setColorAt(i, tc.setHex([0xff6f91, 0xf2c46d, 0x3fb7c9, 0x2fb65a][i % 4]));
      this.group.add(this.tubes);
      (this.tubes as any).userData = { L, H, W, lw };
    }

    // ---------------------------------------------------------------- summit restaurant
    const S = vis('summithut');
    if (S) {
      const g = new THREE.Group();
      const w = 14 + S * 4, d = 10 + S * 2;
      const hall = this.village.chalet(w, d, 5 + S, 0x6f6a64, { floors: S > 2 ? 2 : 1, trim: 0x2b3036 });
      g.add(hall);
      // a glass sun room facing the valley
      const glass = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 3.4, 5), M(0x9fc6e0, 0.1, { metalness: 0.4, transparent: true, opacity: 0.55, emissive: 0xffc890, emissiveIntensity: 0.1 }));
      glass.position.set(0, 2.2, d / 2 + 2.5);
      g.add(glass);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 6, 0.6, 9), M(0x9b7350));
      deck.position.set(0, 0.6, d / 2 + 9);
      g.add(deck);
      for (let i = 0; i < 4 + S * 2; i++) {
        const um = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.8, 8), M(i % 2 ? 0xd2453a : 0xf2c46d));
        um.position.set(-w / 2 + (i + 0.5) * ((w + 4) / (4 + S * 2)), 3.2, d / 2 + 10);
        g.add(um);
      }
      const sg = this.village.sign('SUMMIT 2650', 'RESTAURANT', 9, '#1f3a5f');
      sg.position.set(0, 6 + S + 1.6, d / 2 + 0.4);
      g.add(sg);
      this.put(g, SPOTS.summithut[0], SPOTS.summithut[1], 0, -0.3);
    }

    // ---------------------------------------------------------------- hot springs spa
    const P = vis('spa');
    if (P) {
      const g = new THREE.Group();
      const pw = 12 + P * 3, pd = 8 + P;
      const rim = new THREE.Mesh(new THREE.BoxGeometry(pw + 2, 1.0, pd + 2), M(0x8a8580, 0.95));
      rim.position.y = 0.5;
      const water = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.2, pd), M(0x3fb7c9, 0.1, { metalness: 0.2, emissive: 0x1d8fa6, emissiveIntensity: 0.25 }));
      water.position.y = 1.0;
      g.add(rim, water);
      for (let i = 0; i < 6; i++) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9 + (i % 3) * 0.3), M(0x6f6a64, 0.95));
        rock.position.set(-pw / 2 + (i * pw) / 5, 1.0, (i % 2 ? 1 : -1) * (pd / 2 + 1));
        g.add(rock);
      }
      const hut = this.village.chalet(8 + P * 2, 6, 3.5, 0x6a4cc2, { trim: 0x3a2a6a });
      hut.position.set(0, 0, -pd / 2 - 6);
      g.add(hut);
      this.put(g, SPOTS.spa[0], SPOTS.spa[1], 0.1, 0);
      this.spaPool = new THREE.Vector3(SPOTS.spa[0], this.at(SPOTS.spa[0], SPOTS.spa[1]) + 1.2, SPOTS.spa[1]);
      (this.spaPool as any).w = pw; (this.spaPool as any).d = pd;
    }

    // ---------------------------------------------------------------- heli pad + helicopter
    const Hh = vis('heli');
    if (Hh) {
      const pad = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, 0.5, 32), M(0x2b3036, 0.8));
      disc.position.y = 0.25;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.25, 4, 40), M(0xf2c46d, 0.6));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.52;
      const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 6), M(0xffffff, 0.6)), h2 = h1.clone(), h3 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 0.8), M(0xffffff, 0.6));
      h1.position.set(-1.6, 0.53, 0); h2.position.set(1.6, 0.53, 0); h3.position.set(0, 0.53, 0);
      pad.add(disc, ring, h1, h2, h3);
      this.put(pad, SPOTS.heli[0], SPOTS.heli[1]);
      const heli = new THREE.Group();
      const bodyM = M(0xd2453a, 0.35, { metalness: 0.3 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), bodyM);
      body.scale.set(1, 0.9, 1.5); body.position.y = 1.9;
      const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M(0x1b2833, 0.1, { metalness: 0.6 }));
      canopy.rotation.x = Math.PI / 2.4; canopy.position.set(0, 2.1, 1.3);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.35, 5, 8), bodyM);
      tail.rotation.x = Math.PI / 2; tail.position.set(0, 2.2, -3.8);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.4, 0.8), bodyM);
      fin.position.set(0, 2.8, -6.1);
      for (const s of [-1, 1]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 4), M(0x2b3036)); sk.position.set(s * 1.1, 0.3, 0.2); heli.add(sk); }
      const rotor = new THREE.Group();
      for (let i = 0; i < 4; i++) { const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 6.5), M(0x23262b)); blade.position.z = 3.2; const arm = new THREE.Group(); arm.rotation.y = (i * Math.PI) / 2; arm.add(blade); rotor.add(arm); }
      rotor.position.y = 3.5;
      heli.add(body, canopy, tail, fin, rotor);
      heli.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
      heli.scale.setScalar(1.3);
      this.group.add(heli);
      this.heli = heli; this.rotor = rotor;
      this.heliT = 0;
    }
  }

  // ------------------------------------------------------------------ event visuals
  private buildEvent(sim: Sim) {
    for (const c of [...this.ev.children]) this.ev.remove(c);
    const e = sim.eventToday;
    if (!e) return;
    const bg = { banner: '#e0457b', jam: '#f08a24', race: '#d2453a', torch: '#c0571a', fireworks: '#6a4cc2' }[e.fx];
    const arch = (x: number, z: number, rot: number, text: string, sub: string, w = 22) => {
      const g = new THREE.Group();
      for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 9, 8), M(0x23262b)); p.position.set((s * w) / 2, 4.5, 0); g.add(p); }
      const b = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.1875), new THREE.MeshStandardMaterial({ map: bannerTexture(text, sub, bg), roughness: 0.6, side: THREE.DoubleSide, emissive: 0xffffff, emissiveIntensity: 0.12 }));
      b.position.y = 8.2;
      g.add(b);
      g.position.set(x, this.at(x, z), z);
      g.rotation.y = rot;
      g.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
      this.ev.add(g);
    };
    arch(SPOTS.banner[0], SPOTS.banner[1], 0, e.name, sim.s.event?.state === 'live' ? 'today at Bluebird Peak' : 'today from 8:30');
    if (e.run && (e.fx === 'race' || e.fx === 'jam')) {
      const p = this.m.runOf[e.run];
      const n = p.x.length;
      // finish arch at the bottom
      const iE = n - 6;
      arch(p.x[iE], p.z[iE], Math.atan2(p.tx[iE], p.tz[iE]), e.fx === 'race' ? 'Finish' : e.name, e.name, p.def.w * 0.8);
      if (e.fx === 'race') {
        const gates = 14;
        for (let k = 1; k < gates; k++) {
          const i = Math.floor((k / gates) * (n - 10));
          const side = k % 2 ? 1 : -1;
          const off = (p.def.w * 0.18) * side;
          const x = p.x[i] - p.tz[i] * off, z = p.z[i] + p.tx[i] * off;
          const gm = M(side > 0 ? 0xd2453a : 0x2f7fe0, 0.5);
          for (const d of [-1.4, 1.4]) {
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 5), gm);
            pole.position.set(x - p.tz[i] * d, this.at(x, z) + 1.1, z + p.tx[i] * d);
            this.ev.add(pole);
          }
          const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.2), new THREE.MeshStandardMaterial({ color: side > 0 ? 0xd2453a : 0x2f7fe0, side: THREE.DoubleSide, roughness: 0.7 }));
          flag.position.set(x, this.at(x, z) + 1.6, z);
          flag.rotation.y = Math.atan2(-p.tz[i], p.tx[i]) + Math.PI / 2;
          this.ev.add(flag);
        }
      } else {
        // a start arch at the top too and crowd barriers along the park
        const i0 = 8;
        arch(p.x[i0], p.z[i0], Math.atan2(p.tx[i0], p.tz[i0]), 'Drop in', e.name, p.def.w * 0.8);
      }
    }
  }

  // ------------------------------------------------------------------ per frame
  frame(dt: number, t: number, sim: Sim, night: number, gameDt: number) {
    const ek = (sim.eventToday?.id ?? '') + ':' + (sim.s.event?.state ?? '');
    if (ek !== this.evKey) { this.evKey = ek; this.buildEvent(sim); }
    const D = this.dummy;

    // skaters circle the rink
    if (this.skaters && this.skaterJ) {
      const [a, b] = (this.skaters as any).userData.ab as [number, number];
      const [cx, cz] = SPOTS.rink;
      const y = this.at(cx, cz) + 0.3;
      const busy = sim.isOpen || sim.hour > 16 && sim.hour < 21.5;
      this.skaters.count = this.skaterJ.count = busy ? this.movers.length : Math.floor(this.movers.length / 4);
      this.movers.forEach((mv, i) => {
        mv.ph += gameDt * mv.sp * 0.06 + dt * 0.02 * mv.sp;
        const x = cx + Math.cos(mv.ph) * a * mv.r * 0.95, z = cz + Math.sin(mv.ph) * b * mv.r * 0.95;
        D.position.set(x, y, z);
        D.rotation.set(0, Math.atan2(-Math.sin(mv.ph) * a, Math.cos(mv.ph) * b), Math.sin(t * 3 + i) * 0.08);
        D.updateMatrix();
        this.skaters!.setMatrixAt(i, D.matrix); this.skaterJ!.setMatrixAt(i, D.matrix);
      });
      this.skaters.instanceMatrix.needsUpdate = true; this.skaterJ.instanceMatrix.needsUpdate = true;
    }

    // tubes slide down, ride back up
    if (this.tubes) {
      const { L, H, W, lw } = (this.tubes as any).userData;
      const [tx, tz] = SPOTS.tubing;
      const gy = this.at(tx, tz);
      const n = this.tubeLanes * 2;
      this.tubes.count = sim.isOpen ? n : 0;
      for (let i = 0; i < n; i++) {
        const lane = i % this.tubeLanes;
        const u = ((t * 0.09 + i * 0.37) % 1); // 0 top .. 1 bottom
        const zz = -L / 2 + 6 + u * (L - 8);
        const h = Math.max(0.6, H * (1 - Math.max(0, (zz + L / 2 - 10) / (L - 16))) + 0.6);
        D.position.set(tx - W / 2 + 4.5 + lane * lw, gy + h + 0.4, tz + zz);
        D.rotation.set(-Math.PI / 2, 0, t * 2 + i);
        D.updateMatrix();
        this.tubes.setMatrixAt(i, D.matrix);
      }
      this.tubes.instanceMatrix.needsUpdate = true;
    }

    // spa steam
    if (this.spaPool && Math.random() < 0.5) {
      const p = this.spaPool, w = (p as any).w, d = (p as any).d;
      this.fx.emit(p.x + (Math.random() - 0.5) * w, p.y, p.z + (Math.random() - 0.5) * d, 0, 7, 0, 0.8, 1, 1.4, 140);
    }

    // the helicopter: pad -> the backcountry peak -> pad, while the lifts run
    if (this.heli && this.rotor) {
      const pad = new THREE.Vector3(SPOTS.heli[0], this.at(SPOTS.heli[0], SPOTS.heli[1]) + 0.5, SPOTS.heli[1]);
      const drop = HELI_DROP.clone(); drop.y = this.at(drop.x, drop.z) + 0.5;
      const flying = sim.isOpen || this.heliT > 0.01;
      if (flying) this.heliT = (this.heliT + gameDt * 0.012 + dt * 0.004) % 1;
      const ph = this.heliT;
      let pos: THREE.Vector3, yaw = 0, spin = flying ? 1 : 0;
      const cruise = Math.max(pad.y, drop.y) + 120;
      const lerp3 = (a: THREE.Vector3, b: THREE.Vector3, k: number, alt: number) => { const p = a.clone().lerp(b, k); p.y = a.y + (b.y - a.y) * k + Math.sin(Math.PI * k) * alt; return p; };
      if (ph < 0.08) { pos = pad.clone(); spin = ph < 0.02 ? ph / 0.02 : 1; pos.y += Math.max(0, (ph - 0.04) / 0.04) * 6; }
      else if (ph < 0.46) { const k = (ph - 0.08) / 0.38; const ks = k * k * (3 - 2 * k); pos = lerp3(pad, drop, ks, cruise - (pad.y + drop.y) / 2); }
      else if (ph < 0.56) { pos = drop.clone(); }
      else if (ph < 0.94) { const k = (ph - 0.56) / 0.38; const ks = k * k * (3 - 2 * k); pos = lerp3(drop, pad, ks, cruise - (pad.y + drop.y) / 2); }
      else pos = pad.clone();
      const goingOut = ph < 0.5;
      const dir = goingOut ? drop.clone().sub(pad) : pad.clone().sub(drop);
      yaw = Math.atan2(dir.x, dir.z);
      this.heli.position.copy(pos);
      this.heli.rotation.set(ph > 0.1 && ph < 0.44 || ph > 0.58 && ph < 0.92 ? 0.12 : 0, yaw, 0);
      this.rotor.rotation.y += dt * 40 * spin;
    }

    // torchlight parade at dusk
    const e = sim.eventToday;
    const live = sim.s.event?.state === 'live' && !!e;
    this.torches.count = 0;
    if (live && e!.fx === 'torch' && night > 0.25 && e!.run) {
      const p = this.m.runOf[e!.run];
      const n = 26;
      const head = ((sim.hour - 16.5) / 2.5) % 1;
      for (let i = 0; i < n; i++) {
        const u = head - i * 0.012;
        if (u < 0 || u > 1) continue;
        const k = Math.floor(u * (p.x.length - 1));
        const lat = Math.sin(i * 1.7 + t) * p.def.w * 0.25;
        D.position.set(p.x[k] - p.tz[k] * lat, p.h[k] + 1.6, p.z[k] + p.tx[k] * lat);
        D.rotation.set(0, 0, 0);
        D.scale.setScalar(0.8 + Math.sin(t * 13 + i) * 0.2);
        D.updateMatrix();
        this.torches.setMatrixAt(this.torches.count++, D.matrix);
        if (Math.random() < 0.15) this.fx.emit(D.position.x, D.position.y, D.position.z, 0, 2, 0, 0.6, 1, 0.6, 40);
      }
      D.scale.setScalar(1);
      this.torches.instanceMatrix.needsUpdate = true;
    }

    // fireworks over the village
    const show = live && (e!.fx === 'fireworks' || e!.fx === 'torch' || e!.id === 'worldcup') && night > 0.35 && sim.hour < 22;
    if (show) {
      this.fwT -= dt;
      if (this.fwT <= 0) {
        this.fwT = 0.35 + Math.random() * 0.9;
        const c = new THREE.Color().setHSL(Math.random(), 0.9, 0.6);
        this.sparks.burst(-40 + Math.random() * 180, 120 + Math.random() * 70, 380 + Math.random() * 120, c, 160 + Math.floor(Math.random() * 90), 30 + Math.random() * 16);
        this.boom = true;
      }
    }
    this.sparks.update(dt);
  }
  /** set when a firework bursts (main plays the sound) */
  boom = false;
}

export { RUNS, EVENT_BY };
