// Fireworks over the pier: every night from 21:00 to about 21:50 a barge moored off the end of the
// pier sends shells up - a whistling climb with a spark trail, then a burst: peony spheres, drooping
// gold willows, rings, crackling glitter and palm fronds, in a handful of palettes, with the boom
// arriving late across the water. Additive point sprites, bright enough for the bloom; no lights.
import * as THREE from 'three';
import type { Game } from './game';

const MAX = 4000;
const BARGE = { x: 950, z: 140 };
const PALETTES: number[][] = [
  [0xff3355, 0xffffff],
  [0x33ccff, 0x9ef0ff],
  [0xffcc33, 0xff8a1f],
  [0x7dff6a, 0xffffff],
  [0xd06bff, 0xff6fb5],
  [0xff5a2a, 0xffd06a],
];
type Kind = 'peony' | 'willow' | 'ring' | 'crackle' | 'palm';

interface Shell {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  t: number; fuse: number;
  kind: Kind; pal: number[];
}

export class Fireworks {
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 3);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private age = new Float32Array(MAX);
  private base = new Float32Array(MAX * 3);
  private drag = new Float32Array(MAX);
  private twinkle = new Uint8Array(MAX);
  private n = 0;
  private geo = new THREE.BufferGeometry();
  private shells: Shell[] = [];
  private next = 0;
  private wasOn = false;
  private barge: THREE.Mesh;

  constructor(private game: Game) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (1500.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec3 vC;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = smoothstep(0.5, 0.0, r); gl_FragColor = vec4(vC * (a * a * 2.2 + smoothstep(0.18, 0.0, r) * 2.0), 1.0); }`,
    });
    const pts = new THREE.Points(this.geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    game.scene.add(pts);
    // the barge the show is fired from
    const bg = new THREE.BoxGeometry(14, 1.4, 7);
    this.barge = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.7 }));
    this.barge.position.set(BARGE.x, -0.5, BARGE.z);
    game.scene.add(this.barge);
  }

  /** the show runs 21:00 - 21:50, every night */
  get on() {
    const t = this.game.sky.time;
    return t >= 21 && t < 21.84;
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: number, life: number, size: number, drag: number, tw = 0) {
    if (this.n >= MAX) return;
    const i = this.n++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    const cc = new THREE.Color(c);
    this.base.set([cc.r, cc.g, cc.b], i * 3);
    this.life[i] = life;
    this.age[i] = 0;
    this.size[i] = size;
    this.drag[i] = drag;
    this.twinkle[i] = tw;
  }

  private launch() {
    const kinds: Kind[] = ['peony', 'peony', 'willow', 'ring', 'crackle', 'palm'];
    const x = BARGE.x + (Math.random() - 0.5) * 10, z = BARGE.z + (Math.random() - 0.5) * 6;
    const h = 80 + Math.random() * 60;
    const vy = Math.sqrt(2 * 9.8 * h);
    this.shells.push({
      x, y: 0.5, z,
      vx: (Math.random() - 0.5) * 6, vy, vz: (Math.random() - 0.5) * 10,
      t: 0, fuse: vy / 9.8 * (0.92 + Math.random() * 0.08),
      kind: kinds[Math.floor(Math.random() * kinds.length)],
      pal: PALETTES[Math.floor(Math.random() * PALETTES.length)],
    });
    const d = this.game.camera.position.distanceTo(new THREE.Vector3(x, 0, z));
    if (d < 900) this.game.audio.firework(d, 'launch');
  }

  private burst(s: Shell) {
    const [c1, c2] = s.pal;
    const n = s.kind === 'ring' ? 120 : s.kind === 'palm' ? 80 : 220;
    const speed = s.kind === 'willow' ? 24 : s.kind === 'palm' ? 36 : 32;
    // a ring lies in a random tilted plane
    const ax = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize();
    const u = new THREE.Vector3(0, 1, 0).cross(ax).normalize(), w = ax.clone().cross(u);
    for (let i = 0; i < n; i++) {
      let dx: number, dy: number, dz: number;
      if (s.kind === 'ring') {
        const a = (i / n) * Math.PI * 2;
        dx = u.x * Math.cos(a) + w.x * Math.sin(a);
        dy = u.y * Math.cos(a) + w.y * Math.sin(a);
        dz = u.z * Math.cos(a) + w.z * Math.sin(a);
      } else {
        // an even sphere (golden spiral), a little jitter
        const yy = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - yy * yy), a = i * 2.399963;
        dx = Math.cos(a) * r;
        dy = yy;
        dz = Math.sin(a) * r;
      }
      const sp = speed * (0.85 + Math.random() * 0.3) * (s.kind === 'palm' ? 0.6 + 0.4 * (i % 5 === 0 ? 1 : 0.5) : 1);
      const c = s.kind === 'willow' ? 0xffc46a : i % 3 === 0 ? c2 : c1;
      const life = s.kind === 'willow' ? 3.6 + Math.random() : 2.0 + Math.random() * 0.9;
      this.emit(s.x, s.y, s.z, dx * sp + s.vx * 0.3, dy * sp, dz * sp + s.vz * 0.3, c, life, s.kind === 'willow' ? 0.75 : 0.9, s.kind === 'willow' ? 0.9 : 1.35, s.kind === 'crackle' ? 1 : 0);
    }
    // the flash at the heart of it
    this.emit(s.x, s.y, s.z, 0, 0, 0, 0xffffff, 0.3, 9, 0);
    const d = this.game.camera.position.distanceTo(new THREE.Vector3(s.x, s.y, s.z));
    if (d < 1400) this.game.audio.firework(d, s.kind === 'crackle' ? 'crackle' : 'boom');
  }

  update(dt: number) {
    const g = this.game;
    const on = this.on && g.mode === 'play';
    if (on && !this.wasOn && g.camera.position.distanceTo(new THREE.Vector3(BARGE.x, 0, BARGE.z)) < 900) g.hud.toast('Fireworks over the pier');
    this.wasOn = on;
    if (on) {
      this.next -= dt;
      if (this.next <= 0) {
        this.launch();
        // salvos now and then
        this.next = Math.random() < 0.2 ? 0.15 : 0.7 + Math.random() * 1.4;
      }
    }
    // shells climbing, trailing sparks
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      s.vy -= 9.8 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      if (Math.random() < dt * 40) this.emit(s.x, s.y, s.z, (Math.random() - 0.5) * 1.5, -2, (Math.random() - 0.5) * 1.5, 0xffd9a0, 0.5, 0.35, 2);
      if (s.t >= s.fuse) {
        this.burst(s);
        this.shells.splice(i, 1);
      }
    }
    // the stars: drag, gravity, fade; crackle stars flicker and pop at the end
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      const L = this.life[i], a = this.age[i];
      if (a >= L) continue;
      const k = Math.exp(-this.drag[i] * dt);
      const vx = this.vel[i * 3] * k, vy = this.vel[i * 3 + 1] * k - 9.8 * 0.55 * dt, vz = this.vel[i * 3 + 2] * k;
      const x = this.pos[i * 3] + vx * dt, y = this.pos[i * 3 + 1] + vy * dt, z = this.pos[i * 3 + 2] + vz * dt;
      const f = 1 - a / L;
      let br = f * f * 3.2 + 0.08;
      if (this.twinkle[i]) br *= Math.random() < 0.5 ? 1.8 : 0.15;
      // compact the live ones to the front
      if (w !== i) {
        this.age[w] = a;
        this.life[w] = L;
        this.drag[w] = this.drag[i];
        this.twinkle[w] = this.twinkle[i];
        this.size[w] = this.size[i];
        this.base[w * 3] = this.base[i * 3];
        this.base[w * 3 + 1] = this.base[i * 3 + 1];
        this.base[w * 3 + 2] = this.base[i * 3 + 2];
      }
      this.vel[w * 3] = vx;
      this.vel[w * 3 + 1] = vy;
      this.vel[w * 3 + 2] = vz;
      this.pos[w * 3] = x;
      this.pos[w * 3 + 1] = y;
      this.pos[w * 3 + 2] = z;
      this.col[w * 3] = this.base[w * 3] * br;
      this.col[w * 3 + 1] = this.base[w * 3 + 1] * br;
      this.col[w * 3 + 2] = this.base[w * 3 + 2] * br;
      w++;
    }
    this.n = w;
    this.geo.setDrawRange(0, w);
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
    this.barge.visible = g.sky.night > 0.2;
  }
}
