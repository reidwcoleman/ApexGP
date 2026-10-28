import * as THREE from 'three';

/**
 * Particles, all in the simulation frame (cm): a glowing additive pool (boost trails, sparks, the
 * goal fireworks, the supersonic streaks) and a soft alpha pool (smoke, dust, confetti), plus the
 * goal shockwave. CPU-integrated, drawn as point sprites with per-particle size, colour and fade.
 */

interface Pool {
  n: number;
  max: number;
  pos: Float32Array;
  vel: Float32Array;
  col: Float32Array;
  life: Float32Array;
  age: Float32Array;
  size: Float32Array;
  grow: Float32Array;
  drag: Float32Array;
  grav: Float32Array;
  geo: THREE.BufferGeometry;
  aPos: THREE.BufferAttribute;
  aCol: THREE.BufferAttribute;
  aSize: THREE.BufferAttribute;
  aAlpha: THREE.BufferAttribute;
  points: THREE.Points;
}

function pool(max: number, additive: boolean): Pool {
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
  const aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
  const aSize = new THREE.BufferAttribute(new Float32Array(max), 1);
  const aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1);
  for (const a of [aPos, aCol, aSize, aAlpha]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', aPos);
  geo.setAttribute('color', aCol);
  geo.setAttribute('size', aSize);
  geo.setAttribute('alpha', aAlpha);
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 800 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; uniform float uScale;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = min(400.0, size * 0.01 * uScale / max(0.2, -mv.z)); vA *= smoothstep(0.8, 3.2, -mv.z); }`,
    fragmentShader: additive
      ? `varying vec3 vC; varying float vA; void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = dot(p,p); if (d > 1.0) discard; float k = exp(-d*3.2); gl_FragColor = vec4(vC * k * vA, k * vA); }`
      : `varying vec3 vC; varying float vA; void main(){ vec2 p = gl_PointCoord*2.0-1.0; float d = dot(p,p); if (d > 1.0) discard; float k = (1.0-d); gl_FragColor = vec4(vC, k*k*vA); }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = additive ? 12 : 11;
  return {
    n: 0,
    max,
    pos: new Float32Array(max * 3),
    vel: new Float32Array(max * 3),
    col: new Float32Array(max * 3),
    life: new Float32Array(max),
    age: new Float32Array(max),
    size: new Float32Array(max),
    grow: new Float32Array(max),
    drag: new Float32Array(max),
    grav: new Float32Array(max),
    geo,
    aPos,
    aCol,
    aSize,
    aAlpha,
    points,
  };
}

export interface Emit {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  r: number;
  g: number;
  b: number;
  life: number;
  size: number;
  grow?: number;
  drag?: number;
  grav?: number;
}

/** a random unit vector */
function rnd3(): [number, number, number] {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return [r * Math.cos(a), r * Math.sin(a), u];
}

export class FX {
  readonly group = new THREE.Group();
  private glow = pool(12000, true);
  private soft = pool(2500, false);
  private waves: { mesh: THREE.Mesh; age: number; life: number; max: number }[] = [];
  private waveGeo = new THREE.SphereGeometry(1, 48, 24);
  private rings: { mesh: THREE.Mesh; age: number; life: number; max: number }[] = [];
  private ringGeo = new THREE.RingGeometry(0.86, 1, 96, 1);
  /** firework streamers: points that trail sparks, then burst */
  private rockets: { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; col: THREE.Color; pop: THREE.Color }[] = [];

  constructor() {
    this.group.add(this.soft.points, this.glow.points);
  }

  setViewport(h: number, fovDeg: number): void {
    const s = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const p of [this.glow, this.soft]) (p.points.material as THREE.ShaderMaterial).uniforms.uScale.value = s;
  }

  private add(p: Pool, e: Emit): void {
    if (p.n >= p.max) return;
    const i = p.n++;
    p.pos[i * 3] = e.x;
    p.pos[i * 3 + 1] = e.y;
    p.pos[i * 3 + 2] = e.z;
    p.vel[i * 3] = e.vx ?? 0;
    p.vel[i * 3 + 1] = e.vy ?? 0;
    p.vel[i * 3 + 2] = e.vz ?? 0;
    p.col[i * 3] = e.r;
    p.col[i * 3 + 1] = e.g;
    p.col[i * 3 + 2] = e.b;
    p.life[i] = e.life;
    p.age[i] = 0;
    p.size[i] = e.size;
    p.grow[i] = e.grow ?? 0;
    p.drag[i] = e.drag ?? 0;
    p.grav[i] = e.grav ?? 0;
  }

  spark(e: Emit): void {
    this.add(this.glow, e);
  }
  smoke(e: Emit): void {
    this.add(this.soft, e);
  }

  /** a burst of glowing sparks */
  burst(x: number, y: number, z: number, n: number, speed: number, col: THREE.Color, size: number, life: number, grav = 650): void {
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const v = speed * (0.3 + Math.random() * 0.7);
      this.spark({ x, y, z, vx: Math.cos(a) * s * v, vy: Math.sin(a) * s * v, vz: u * v, r: col.r, g: col.g, b: col.b, life: life * (0.5 + Math.random() * 0.5), size: size * (0.5 + Math.random()), drag: 1.5, grav });
    }
  }

  /** the goal explosion: a white-hot flash into a team fireball, firework streamers that burst
   * again where they die, a shock ring racing over the floor and a spherical wave, embers raining
   * down and a column of team-tinted smoke */
  goal(x: number, y: number, z0: number, team: number, style = 0): void {
    // (from the goal mouth, thrown out toward the field: the back of the net would hide half of it)
    const sy = Math.sign(y) || 1;
    y = sy * Math.min(Math.abs(y), 5060);
    const z = Math.max(120, Math.min(z0, 520));
    this.explode(x, y, z, team, style, 1, sy);
  }

  /** an explosion in the open (the garage's preview): `k` scales it, nothing is thrown away from a goal */
  preview(x: number, y: number, z: number, team: number, style: number, k: number): void {
    this.explode(x, y, z, team, style, k, 0);
  }

  /** things an explosion does a moment later (a black hole's burst, a shockwave's second ring) */
  private later: { t: number; fn: () => void }[] = [];

  private explode(x: number, y: number, z: number, team: number, style: number, K: number, sy: number): void {
    const out = (d: [number, number, number]) => {
      if (sy && d[1] * sy > 0) d[1] = -d[1] * 0.75;
      return d;
    };
    const tc = new THREE.Color(team === 0 ? 0x2f7bff : 0xff6a10);
    const hot = new THREE.Color(3.2, 3.0, 2.7);
    if (style === 1) return this.shockwave(x, y, z, tc, hot, K, out);
    if (style === 2) return this.fireworks(x, y, z, tc, hot, K, out);
    if (style === 3) return this.vortex(x, y, z, tc, hot, K);
    if (style === 4) return this.confetti(x, y, z, tc, hot, K, out);
    if (style === 5) return this.blackHole(x, y, z, tc, hot, K, out);
    this.supernova(x, y, z, tc, hot, K, out, sy || 1);
  }

  private supernova(x: number, y: number, z: number, tc: THREE.Color, hot: THREE.Color, K: number, out: (d: [number, number, number]) => [number, number, number], sy: number): void {
    const c = tc.clone().multiplyScalar(3.2);
    const pale = tc.clone().lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(3);
    const n = (v: number) => Math.round(v * Math.max(0.35, K));
    // the core: a dense white-hot ball that blooms out and cools to the team colour
    for (let k = 0; k < n(700); k++) {
      const d = out(rnd3());
      const v = (900 + Math.random() * 2600) * K;
      const col = Math.random() < 0.25 ? hot : Math.random() < 0.4 ? pale : c;
      this.spark({ x, y, z, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, r: col.r, g: col.g, b: col.b, life: 0.7 + Math.random() * 0.8, size: (150 + Math.random() * 200) * K, grow: -70, drag: 3.2, grav: -80 });
    }
    // fast sparks thrown far
    for (let k = 0; k < n(900); k++) {
      const d = out(rnd3());
      const v = (2500 + Math.random() * 4200) * K;
      const col = Math.random() < 0.2 ? hot : c;
      this.spark({ x, y, z, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v * 0.8 + 500, r: col.r, g: col.g, b: col.b, life: 0.7 + Math.random() * 1.1, size: 26 + Math.random() * 30, drag: 1.6, grav: 520 });
    }
    // streamers: firework rockets trailing light, each popping into a burst of its own
    for (let k = 0; k < n(22); k++) {
      const d = out(rnd3());
      d[2] = Math.abs(d[2]) * 0.9 + 0.35;
      const v = (2600 + Math.random() * 2200) * K;
      this.rockets.push({ x, y, z, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, age: 0, life: 0.55 + Math.random() * 0.5, col: Math.random() < 0.3 ? hot.clone() : pale.clone(), pop: Math.random() < 0.75 ? c.clone() : hot.clone() });
    }
    // embers drifting down for a while after
    for (let k = 0; k < n(500); k++) {
      const d = out(rnd3());
      const v = (600 + Math.random() * 1800) * K;
      this.spark({ x, y, z: z + 100, vx: d[0] * v, vy: d[1] * v, vz: Math.abs(d[2]) * v + 600, r: c.r * 0.8, g: c.g * 0.8, b: c.b * 0.8, life: 2.2 + Math.random() * 1.8, size: 14 + Math.random() * 12, drag: 1.1, grav: 260 });
    }
    // smoke: a rolling ring outward and a column rising, tinted by the team
    const sm = new THREE.Color(0.11, 0.12, 0.15).lerp(tc, 0.18);
    for (let k = 0; k < n(60); k++) {
      const a = sy > 0 ? Math.PI + Math.random() * Math.PI : Math.random() * Math.PI;
      const v = (900 + Math.random() * 1400) * K;
      this.smoke({ x, y, z: Math.max(40, z * 0.5), vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 100 + Math.random() * 300, r: sm.r, g: sm.g, b: sm.b, life: 1.8 + Math.random() * 1.2, size: 160 * K, grow: 260 * K, drag: 1.8, grav: -60 });
    }
    for (let k = 0; k < n(36); k++) {
      this.smoke({ x: x + (Math.random() - 0.5) * 300, y: y + (Math.random() - 0.5) * 300, z, vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 300, vz: 500 + Math.random() * 900, r: sm.r * 1.2, g: sm.g * 1.2, b: sm.b * 1.2, life: 3 + Math.random() * 2, size: 260 * K, grow: 360 * K, drag: 0.9, grav: -30 });
    }
    // the flash, the waves
    this.wave(x, y, z, 1100 * K, 0.45, hot, 2.2);
    this.wave(x, y, z, 1700 * K, 0.7, c, 1.2);
    this.wave(x, y, z, 3200 * K, 1.25, c, 0);
    this.wave(x, y, z, 1900 * K, 0.8, pale, 0);
    this.ring(x, y, Math.max(3, z - 300), 4200 * K, 1.4, c);
    this.ring(x, y, Math.max(3, z - 300), 2600 * K, 0.9, hot);
  }

  private shockwave(x: number, y: number, z: number, tc: THREE.Color, hot: THREE.Color, K: number, out: (d: [number, number, number]) => [number, number, number]): void {
    // rings of light racing out one after another, a pillar of light, crackling arcs
    const ice = new THREE.Color(0.9, 2.2, 3.2);
    const c = tc.clone().lerp(ice, 0.5).multiplyScalar(2.6);
    const fz = Math.max(3, z - 300);
    for (let k = 0; k < 5; k++) this.later.push({ t: k * 0.16, fn: () => { this.ring(x, y, fz, (2400 + k * 900) * K, 0.9 + k * 0.15, k % 2 ? ice.clone() : c.clone()); this.wave(x, y, z, (900 + k * 500) * K, 0.5 + k * 0.08, k % 2 ? c.clone() : ice.clone(), 0); } });
    this.wave(x, y, z, 800 * K, 0.35, hot, 2.4);
    for (let k = 0; k < Math.round(500 * Math.max(0.4, K)); k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 90 * K;
      this.spark({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z, vz: (1800 + Math.random() * 3800) * K, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80, r: ice.r, g: ice.g, b: ice.b, life: 0.7 + Math.random() * 0.6, size: (40 + Math.random() * 60) * K, grow: -40, drag: 1.4, grav: -100 });
    }
    // arcs: jagged chains of sparks shooting out along the floor and up
    for (let a = 0; a < 16; a++) {
      const d = out(rnd3());
      let px = x;
      let py = y;
      let pz = z;
      for (let s = 0; s < 22; s++) {
        px += (d[0] * 90 + (Math.random() - 0.5) * 70) * K;
        py += (d[1] * 90 + (Math.random() - 0.5) * 70) * K;
        pz = Math.max(10, pz + (d[2] * 90 + (Math.random() - 0.5) * 70) * K);
        this.spark({ x: px, y: py, z: pz, r: 2.2, g: 2.7, b: 3.2, life: 0.25 + Math.random() * 0.35, size: 34 * K, grow: -60 * K, drag: 4 });
      }
    }
    this.burst(x, y, z, Math.round(600 * Math.max(0.4, K)), 3200 * K, c, 30 * K, 1.1, 300);
  }

  private fireworks(x: number, y: number, z: number, tc: THREE.Color, hot: THREE.Color, K: number, out: (d: [number, number, number]) => [number, number, number]): void {
    // a barrage of rockets in every colour, each bursting in its own
    this.wave(x, y, z, 900 * K, 0.4, hot, 2);
    this.burst(x, y, z, Math.round(300 * Math.max(0.4, K)), 1800 * K, tc.clone().multiplyScalar(3), 60 * K, 0.8, 200);
    const N = Math.round(46 * Math.max(0.4, K));
    for (let k = 0; k < N; k++) {
      const d = out(rnd3());
      d[2] = Math.abs(d[2]) * 1.2 + 0.4;
      const v = (2200 + Math.random() * 2600) * K;
      const hue = new THREE.Color().setHSL(Math.random(), 1, 0.55).multiplyScalar(3);
      this.later.push({ t: Math.random() * 0.6, fn: () => this.rockets.push({ x, y, z, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, age: 0, life: 0.5 + Math.random() * 0.6, col: hot.clone(), pop: hue }) });
    }
  }

  private vortex(x: number, y: number, z: number, tc: THREE.Color, hot: THREE.Color, K: number): void {
    // a twister: light laid out on a rising helix, every particle swirling round it and climbing
    const vio = new THREE.Color(1.6, 0.8, 3.2);
    const c = tc.clone().multiplyScalar(3);
    const N = Math.round(1600 * Math.max(0.4, K));
    for (let k = 0; k < N; k++) {
      const t = Math.random();
      const arm = k % 3;
      const a = t * Math.PI * 9 + (arm * Math.PI * 2) / 3;
      const r = (120 + t * 900) * K;
      const h = t * 2400 * K;
      const tv = (700 + t * 1200) * K;
      const col = Math.random() < 0.2 ? hot : arm === 0 ? vio : c;
      this.spark({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, z: z + h - 100 * K, vx: -Math.sin(a) * tv, vy: Math.cos(a) * tv, vz: (300 + Math.random() * 500) * K, r: col.r, g: col.g, b: col.b, life: 1.3 + Math.random() * 1.2, size: (36 + Math.random() * 64) * Math.max(0.6, K), grow: -15, drag: 1.1, grav: -250 });
    }
    this.wave(x, y, z, 1000 * K, 0.5, hot, 2);
    this.ring(x, y, Math.max(3, z - 300), 3000 * K, 1.2, vio);
    this.ring(x, y, Math.max(3, z - 300), 2000 * K, 0.9, c);
  }

  private confetti(x: number, y: number, z: number, tc: THREE.Color, hot: THREE.Color, K: number, out: (d: [number, number, number]) => [number, number, number]): void {
    // a party popper: paper in every colour, fluttering down, and white streamers
    const cols = [0xff4060, 0x40d0ff, 0xffe040, 0x60ff80, 0xb070ff, 0xffffff].map((h) => new THREE.Color(h));
    const N = Math.round(1100 * Math.max(0.4, K));
    for (let k = 0; k < N; k++) {
      const d = out(rnd3());
      d[2] = Math.abs(d[2]) + 0.3;
      const v = (900 + Math.random() * 2600) * K;
      const c = cols[k % cols.length];
      this.smoke({ x, y, z, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, r: c.r, g: c.g, b: c.b, life: 3 + Math.random() * 2.5, size: (38 + Math.random() * 34) * Math.max(0.6, K), grow: 0, drag: 1.7, grav: 120 });
    }
    for (let k = 0; k < Math.round(14 * Math.max(0.4, K)); k++) {
      const d = out(rnd3());
      d[2] = Math.abs(d[2]) + 0.6;
      const v = (2400 + Math.random() * 1600) * K;
      this.rockets.push({ x, y, z, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, age: 0, life: 0.6 + Math.random() * 0.4, col: hot.clone(), pop: cols[k % cols.length].clone().multiplyScalar(3) });
    }
    this.wave(x, y, z, 900 * K, 0.4, hot, 2.2);
    this.burst(x, y, z, Math.round(260 * Math.max(0.4, K)), 2400 * K, tc.clone().multiplyScalar(3), 40 * K, 0.8, 300);
  }

  private blackHole(x: number, y: number, z: number, tc: THREE.Color, hot: THREE.Color, K: number, out: (d: [number, number, number]) => [number, number, number]): void {
    // light pulled in from all round to a point, a beat of darkness, then everything thrown out
    const vio = new THREE.Color(1.5, 0.6, 3.2);
    const T = 0.6;
    const N = Math.round(1300 * Math.max(0.4, K));
    for (let k = 0; k < N; k++) {
      const d = rnd3();
      const r = (700 + Math.random() * 900) * K;
      const life = T * (0.7 + Math.random() * 0.3);
      const col = Math.random() < 0.5 ? vio : tc.clone().multiplyScalar(2.6);
      this.spark({ x: x + d[0] * r, y: y + d[1] * r, z: Math.max(20, z + d[2] * r), vx: (-d[0] * r) / life, vy: (-d[1] * r) / life, vz: (-d[2] * r) / life, r: col.r, g: col.g, b: col.b, life, size: (30 + Math.random() * 40) * K, grow: -30 * K });
    }
    this.wave(x, y, z, 1600 * K, T, vio, 0);
    this.later.push({
      t: T,
      fn: () => {
        const c = tc.clone().multiplyScalar(3.2);
        for (let k = 0; k < Math.round(1300 * Math.max(0.4, K)); k++) {
          const d = out(rnd3());
          const v = (1500 + Math.random() * 4500) * K;
          const col = Math.random() < 0.3 ? hot : Math.random() < 0.5 ? vio : c;
          this.spark({ x, y, z, vx: d[0] * v, vy: d[1] * v, vz: d[2] * v, r: col.r, g: col.g, b: col.b, life: 0.6 + Math.random() * 0.9, size: (40 + Math.random() * 90) * K, grow: -40, drag: 2.2, grav: 100 });
        }
        this.wave(x, y, z, 1200 * K, 0.4, hot, 2.4);
        this.wave(x, y, z, 3000 * K, 1.1, vio, 0);
        this.ring(x, y, Math.max(3, z - 300), 4200 * K, 1.3, c);
      },
    });
  }

  demo(x: number, y: number, z: number): void {
    const f = new THREE.Color(3, 1.3, 0.3);
    this.burst(x, y, z, 260, 1800, f, 80, 1.0, 200);
    this.burst(x, y, z, 120, 2600, new THREE.Color(3, 2.6, 1.8), 30, 0.8, 650);
    for (let k = 0; k < 50; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 200 + Math.random() * 500;
      this.smoke({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: 200 + Math.random() * 400, r: 0.12, g: 0.12, b: 0.13, life: 2.4, size: 160, grow: 160, drag: 1.2, grav: -60 });
    }
    this.wave(x, y, z, 700, 0.45, f);
  }

  /** a spherical wave: a bright rim (fresnel), or with `core` a glowing ball that fills in */
  private wave(x: number, y: number, z: number, max: number, life: number, c: THREE.Color, core = 0): void {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uK: { value: 1 }, uC: { value: c }, uCore: { value: core } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uK; uniform vec3 uC; uniform float uCore; varying vec3 vN; varying vec3 vV; void main(){ float ndv = abs(dot(normalize(vN),normalize(vV))); float f = pow(max(1.0-ndv, 0.0), 3.0) + uCore * pow(ndv, 1.5) * 0.5; gl_FragColor = vec4(uC*f*uK, min(1.0, f*uK)); }`,
    });
    const m = new THREE.Mesh(this.waveGeo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 13;
    this.group.add(m);
    this.waves.push({ mesh: m, age: 0, life, max });
  }

  /** a shock ring racing out over the floor (sim z = up) */
  private ring(x: number, y: number, z: number, max: number, life: number, c: THREE.Color): void {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uK: { value: 1 }, uC: { value: c } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uK; uniform vec3 uC; varying vec2 vP; void main(){ float r = length(vP); float e = smoothstep(0.86, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r)); gl_FragColor = vec4(uC*e*uK, e*uK); }`,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.set(x, y, z);
    m.renderOrder = 13;
    this.group.add(m);
    this.rings.push({ mesh: m, age: 0, life, max });
  }

  update(dt: number): void {
    for (let k = this.later.length - 1; k >= 0; k--) {
      const l = this.later[k];
      l.t -= dt;
      if (l.t <= 0) {
        this.later.splice(k, 1);
        l.fn();
      }
    }
    // streamers: trail, fall, burst where they die
    for (let k = this.rockets.length - 1; k >= 0; k--) {
      const r = this.rockets[k];
      r.age += dt;
      const dr = Math.exp(-0.9 * dt);
      r.vx *= dr;
      r.vy *= dr;
      r.vz = r.vz * dr - 700 * dt;
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.z += r.vz * dt;
      for (let q = 0; q < 3; q++)
        this.spark({ x: r.x - r.vx * dt * (q / 3), y: r.y - r.vy * dt * (q / 3), z: r.z - r.vz * dt * (q / 3), vx: (Math.random() - 0.5) * 60, vy: (Math.random() - 0.5) * 60, vz: (Math.random() - 0.5) * 60, r: r.col.r, g: r.col.g, b: r.col.b, life: 0.35 + Math.random() * 0.25, size: 34, grow: -50, drag: 2, grav: 120 });
      if (r.age >= r.life || r.z < 20) {
        this.burst(r.x, r.y, Math.max(30, r.z), 70, 900, r.pop, 34, 0.9, 380);
        this.spark({ x: r.x, y: r.y, z: r.z, r: 3, g: 2.9, b: 2.7, life: 0.18, size: 260, grow: -400 });
        this.rockets.splice(k, 1);
      }
    }
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const w = this.rings[k];
      w.age += dt;
      const t = w.age / w.life;
      if (t >= 1) {
        this.group.remove(w.mesh);
        (w.mesh.material as THREE.Material).dispose();
        this.rings.splice(k, 1);
        continue;
      }
      w.mesh.scale.setScalar(w.max * (1 - Math.pow(1 - t, 2.4)));
      ((w.mesh.material as THREE.ShaderMaterial).uniforms.uK as { value: number }).value = (1 - t) * (1 - t) * 1.6;
    }
    for (const p of [this.glow, this.soft]) {
      let j = 0;
      for (let i = 0; i < p.n; i++) {
        const age = p.age[i] + dt;
        if (age >= p.life[i]) continue;
        // compact into slot j
        if (j !== i) {
          p.pos.copyWithin(j * 3, i * 3, i * 3 + 3);
          p.vel.copyWithin(j * 3, i * 3, i * 3 + 3);
          p.col.copyWithin(j * 3, i * 3, i * 3 + 3);
          p.life[j] = p.life[i];
          p.size[j] = p.size[i];
          p.grow[j] = p.grow[i];
          p.drag[j] = p.drag[i];
          p.grav[j] = p.grav[i];
        }
        p.age[j] = age;
        const dr = Math.exp(-p.drag[j] * dt);
        p.vel[j * 3] *= dr;
        p.vel[j * 3 + 1] *= dr;
        p.vel[j * 3 + 2] = p.vel[j * 3 + 2] * dr - p.grav[j] * dt;
        p.pos[j * 3] += p.vel[j * 3] * dt;
        p.pos[j * 3 + 1] += p.vel[j * 3 + 1] * dt;
        p.pos[j * 3 + 2] += p.vel[j * 3 + 2] * dt;
        if (p.pos[j * 3 + 2] < 2) {
          p.pos[j * 3 + 2] = 2;
          p.vel[j * 3 + 2] *= -0.3;
        }
        p.size[j] += p.grow[j] * dt;
        const t = age / p.life[j];
        const pa = p.aPos.array as Float32Array;
        pa[j * 3] = p.pos[j * 3];
        pa[j * 3 + 1] = p.pos[j * 3 + 1];
        pa[j * 3 + 2] = p.pos[j * 3 + 2];
        const ca = p.aCol.array as Float32Array;
        ca[j * 3] = p.col[j * 3];
        ca[j * 3 + 1] = p.col[j * 3 + 1];
        ca[j * 3 + 2] = p.col[j * 3 + 2];
        (p.aSize.array as Float32Array)[j] = p.size[j];
        (p.aAlpha.array as Float32Array)[j] = (1 - t) * Math.min(1, age * 20);
        j++;
      }
      p.n = j;
      p.geo.setDrawRange(0, j);
      for (const a of [p.aPos, p.aCol, p.aSize, p.aAlpha]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, j * a.itemSize);
        a.needsUpdate = true;
      }
    }
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const w = this.waves[k];
      w.age += dt;
      const t = w.age / w.life;
      if (t >= 1) {
        this.group.remove(w.mesh);
        (w.mesh.material as THREE.Material).dispose();
        this.waves.splice(k, 1);
        continue;
      }
      w.mesh.scale.setScalar(w.max * (1 - Math.pow(1 - t, 3)));
      ((w.mesh.material as THREE.ShaderMaterial).uniforms.uK as { value: number }).value = 1 - t;
    }
  }
}
