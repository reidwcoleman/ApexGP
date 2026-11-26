// Pigeons: little flocks pecking along the pavements by day. Walk into them, drive past or fire a
// shot and they go up in a clatter, wheel round and come down again somewhere down the street.
// One instanced mesh; the wings only flap in the air (a per-bird attribute folds them on the ground).
import * as THREE from 'three';
import { groundAt } from '../world/map';
import type { Game } from './game';

const vert = /* glsl */ `
attribute float aPhase;
attribute float aFly;
uniform float uTime;
varying float vShade;
varying vec3 vCol;
varying vec3 vW;
void main() {
  vec3 p = position;
  float wing = step(0.09, abs(p.x));
  // folded on the ground: the wings tuck in against the body
  p.x = mix(p.x, p.x * 0.3, wing * (1.0 - aFly));
  float flap = sin(uTime * 16.0 + aPhase * 6.28) * 0.9 * aFly;
  p.y += abs(p.x) * flap * wing;
  vShade = 0.72 + 0.28 * step(0.0, p.y + 0.02) ;
  vCol = instanceColor;
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const frag = /* glsl */ `
uniform vec3 uLight;
varying float vShade;
varying vec3 vCol;
varying vec3 vW;
void main() {
  // faceted light from the triangle's own normal (the mesh has none)
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  float lam = 0.38 + 0.62 * abs(dot(n, normalize(vec3(0.3, 1.0, 0.25))));
  gl_FragColor = vec4(vCol * lam * (0.85 + 0.15 * vShade) * uLight, 1.0);
}`;

/** a pigeon about 32 cm long: plump body, head, tail, two wings (x), facing +z */
function pigeonGeo(): THREE.BufferGeometry {
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);
  const body = [
    [0, 0.13, 0.1], [-0.075, 0.08, 0.0], [0.075, 0.08, 0.0], [0, 0.02, 0.04], [0, 0.17, -0.05], [0, 0.06, -0.13],
  ];
  const [nose, l, r, belly, back, tail] = body;
  tri(nose, l, back);
  tri(nose, back, r);
  tri(nose, belly, l);
  tri(nose, r, belly);
  tri(l, belly, tail);
  tri(r, tail, belly);
  tri(l, tail, back);
  tri(r, back, tail);
  // head
  tri([0, 0.17, 0.12], [-0.03, 0.12, 0.1], [0.03, 0.12, 0.1]);
  tri([0, 0.17, 0.12], [0, 0.13, 0.18], [-0.03, 0.12, 0.1]);
  tri([0, 0.17, 0.12], [0.03, 0.12, 0.1], [0, 0.13, 0.18]);
  // tail fan
  tri([-0.04, 0.06, -0.1], [0.04, 0.06, -0.1], [0, 0.05, -0.22]);
  // wings
  tri([-0.06, 0.11, 0.05], [-0.3, 0.1, -0.04], [-0.06, 0.11, -0.08]);
  tri([0.06, 0.11, 0.05], [0.06, 0.11, -0.08], [0.3, 0.1, -0.04]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}

interface Bird {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  fly: number; // 0 on the ground .. 1 flapping
  walkT: number;
  peck: number;
  phase: number;
}

interface Flock {
  birds: Bird[];
  air: boolean;
  t: number;
  tx: number;
  tz: number;
}

const MAX = 110;

export class Pigeons {
  private flocks: Flock[] = [];
  private mesh: THREE.InstancedMesh;
  private aFly: THREE.InstancedBufferAttribute;
  private u = { uTime: { value: 0 }, uLight: { value: new THREE.Color(1, 1, 1) } };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private spawnT = 0;
  private shots = 0;
  private readonly pv = new THREE.Vector3();
  private readonly sc = new THREE.Vector3(1.4, 1.6, 1.4);

  constructor(private game: Game) {
    const geo = pigeonGeo();
    const phase = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) phase[i] = Math.random();
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    this.aFly = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1);
    this.aFly.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFly', this.aFly);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.u, side: THREE.DoubleSide }), MAX);
    const c = new THREE.Color();
    for (let i = 0; i < MAX; i++) this.mesh.setColorAt(i, c.setHSL(0.62 + Math.random() * 0.05, 0.06 + Math.random() * 0.1, 0.26 + Math.random() * 0.16));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    game.scene.add(this.mesh);
  }

  /** a spot on a pavement near (but not right on top of) the camera's focus */
  private pavement(minD: number, maxD: number): { x: number; z: number } | null {
    const g = this.game;
    const f = g.focus;
    const paths = g.peds.paths.filter((p) => !p.beach);
    for (let a = 0; a < 20; a++) {
      const p = paths[Math.floor(Math.random() * paths.length)];
      const side = Math.floor(Math.random() * 4), t = Math.random();
      const x = side === 0 ? p.x0 + (p.x1 - p.x0) * t : side === 1 ? p.x1 : side === 2 ? p.x0 + (p.x1 - p.x0) * t : p.x0;
      const z = side === 0 ? p.z0 : side === 1 ? p.z0 + (p.z1 - p.z0) * t : side === 2 ? p.z1 : p.z0 + (p.z1 - p.z0) * t;
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < minD || d > maxD) continue;
      if (d < 35 && g.inView(x, 0.3, z)) continue;
      return { x, z };
    }
    return null;
  }

  private spawn() {
    const s = this.pavement(18, 90);
    if (!s) return;
    const n = 6 + Math.floor(Math.random() * 7);
    const birds: Bird[] = [];
    for (let i = 0; i < n; i++) {
      const x = s.x + (Math.random() - 0.5) * 3, z = s.z + (Math.random() - 0.5) * 3;
      birds.push({ x, y: groundAt(x, z), z, yaw: Math.random() * 6.28, vx: 0, vy: 0, vz: 0, fly: 0, walkT: Math.random() * 2, peck: 0, phase: Math.random() * 6.28 });
    }
    this.flocks.push({ birds, air: false, t: 0, tx: s.x, tz: s.z });
  }

  /** up they go: each bird away from the scare and up, then the flock heads for somewhere else */
  private scare(f: Flock, sx: number, sz: number) {
    if (f.air) return;
    f.air = true;
    f.t = 0;
    const land = this.pavement(25, 65) ?? { x: f.birds[0].x + 30, z: f.birds[0].z };
    f.tx = land.x;
    f.tz = land.z;
    for (const b of f.birds) {
      const dx = b.x - sx, dz = b.z - sz, d = Math.hypot(dx, dz) || 1;
      b.vx = (dx / d) * 4 + (Math.random() - 0.5) * 2;
      b.vz = (dz / d) * 4 + (Math.random() - 0.5) * 2;
      b.vy = 4 + Math.random() * 2.5;
    }
  }

  update(dt: number) {
    const g = this.game;
    const day = g.sky.day;
    this.u.uTime.value = g.elapsed;
    const dl = 0.35 + 0.65 * day;
    this.u.uLight.value.setRGB(dl, dl, dl * 0.97);
    // roosting at night
    if (day < 0.25) {
      this.flocks.length = 0;
      this.mesh.count = 0;
      return;
    }
    const f0 = g.focus;
    // keep a few flocks around, drop the far ones
    this.flocks = this.flocks.filter((f) => Math.hypot(f.birds[0].x - f0.x, f.birds[0].z - f0.z) < 150);
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.flocks.length < 9) {
      this.spawnT = 0.6;
      this.spawn();
    }
    // what scares them: you close on foot, anything moving on wheels, gunfire
    const p = g.player;
    const shot = g.stats.shots !== this.shots;
    this.shots = g.stats.shots;
    for (const f of this.flocks) {
      if (f.air) continue;
      const b0 = f.birds[0];
      if (shot && Math.hypot(b0.x - p.pos.x, b0.z - p.pos.z) < 45) {
        this.scare(f, p.pos.x, p.pos.z);
        continue;
      }
      const run = Math.hypot(p.vx, p.vz);
      if (!p.vehicle && Math.hypot(b0.x - p.pos.x, b0.z - p.pos.z) < (run > 3 ? 7 : run > 0.5 ? 3.5 : 2)) {
        this.scare(f, p.pos.x, p.pos.z);
        continue;
      }
      for (const v of g.vehicles) {
        if (v.speed < 2 || Math.abs(v.pos.x - b0.x) > 9 || Math.abs(v.pos.z - b0.z) > 9) continue;
        if (Math.hypot(v.pos.x - b0.x, v.pos.z - b0.z) < 4 + v.speed * 0.25) {
          this.scare(f, v.pos.x, v.pos.z);
          break;
        }
      }
    }
    // move and draw
    let k = 0;
    for (const f of this.flocks) {
      f.t += dt;
      let landed = 0;
      for (const b of f.birds) {
        const gy = groundAt(b.x, b.z);
        if (f.air) {
          if (b.fly < 1) b.fly = Math.min(1, b.fly + dt * 6);
          const toX = f.tx + Math.sin(b.phase) * 2 - b.x, toZ = f.tz + Math.cos(b.phase) * 2 - b.z;
          const dist = Math.hypot(toX, toZ) || 1;
          // climb out, cruise at rooftop-ish height, then glide down onto the spot
          const want = f.t < 1.2 ? 9 : dist > 12 ? 7 + Math.sin(b.phase + f.t) : Math.max(0, dist * 0.5);
          const sp = f.t < 1.2 ? 5 : Math.min(9, 3 + dist * 0.4);
          b.vx += ((toX / dist) * sp - b.vx) * Math.min(1, dt * (f.t < 1.2 ? 0.8 : 1.6));
          b.vz += ((toZ / dist) * sp - b.vz) * Math.min(1, dt * (f.t < 1.2 ? 0.8 : 1.6));
          b.vy += (want + gy - b.y) * dt * 1.8 - b.vy * dt * 1.5;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.z += b.vz * dt;
          b.yaw = Math.atan2(b.vx, b.vz);
          if (dist < 1.5 && b.y - gy < 0.25 && f.t > 2) {
            b.y = gy;
            b.vx = b.vy = b.vz = 0;
            landed++;
          }
        } else {
          // on the ground: little walks and pecks
          b.fly = Math.max(0, b.fly - dt * 4);
          b.walkT -= dt;
          if (b.walkT <= 0) {
            b.walkT = 0.6 + Math.random() * 2.2;
            b.yaw += (Math.random() - 0.5) * 2.4;
            b.peck = Math.random() < 0.5 ? 0.5 : 0;
          }
          const walking = b.walkT > 0.4 && b.peck === 0;
          if (walking) {
            b.x += Math.sin(b.yaw) * 0.35 * dt;
            b.z += Math.cos(b.yaw) * 0.35 * dt;
          }
          b.peck = Math.max(0, b.peck - dt);
          b.y = gy;
        }
        if (k >= MAX) continue;
        const bob = !f.air && b.peck > 0 ? Math.sin(b.peck * 25) * 0.35 + 0.3 : 0;
        const pitch = f.air ? THREE.MathUtils.clamp(-b.vy * 0.08, -0.5, 0.5) : bob;
        this.q.setFromEuler(this.e.set(pitch, b.yaw, f.air ? Math.sin(g.elapsed * 2 + b.phase) * 0.2 : 0, 'YXZ'));
        this.m.compose(this.pv.set(b.x, b.y, b.z), this.q, this.sc);
        this.mesh.setMatrixAt(k, this.m);
        this.aFly.setX(k, b.fly);
        k++;
      }
      if (f.air && (landed === f.birds.length || f.t > 14)) {
        f.air = false;
        for (const b of f.birds) {
          b.vx = b.vy = b.vz = 0;
          b.y = groundAt(b.x, b.z);
        }
      }
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aFly.needsUpdate = true;
  }

  /** how many are in the air right now (for tests) */
  get flying() {
    let n = 0;
    for (const f of this.flocks) if (f.air) n += f.birds.length;
    return n;
  }
  get count() {
    let n = 0;
    for (const f of this.flocks) n += f.birds.length;
    return n;
  }
  /** the flocks, for tests */
  get list() {
    return this.flocks;
  }
}
