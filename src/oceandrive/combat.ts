import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Phys } from '../lastframe/physics.ts';
import type { Ground } from './height.ts';
import type { Car } from './cars.ts';

/**
 * What fights need, shared by you, the people and the police:
 *
 * - the ragdoll world (Last Frame's Rapier ragdolls) over a 50 cm copy of the city's heightmap, so a
 *   body falls down the curb, slumps against a wall, rolls off a car's bonnet (the cars near the
 *   camera are kinematic boxes in it)
 * - the line of fire: a ray marched through the heightmap (walls, roofs, posts, the ground) and
 *   tested against everyone's capsule and every car's box
 * - effects: muzzle flashes, tracers, dust, sparks and blood, bullet holes and pools of blood, smoke
 *   and fire off a wrecked car, explosions
 * - the sounds: shots (by gun, by distance), impacts, the siren, explosions; and voices (the
 *   browser's speech synthesis, with a subtitle)
 */

const WORLD_GRP = (1 << 16) | 0xffff;

/** a region of ground for the ragdolls: Blender x0, x1, y0, y1 and the cell size */
export type PhysRegion = [number, number, number, number, number];
export async function makePhys(ground: Ground, regions: PhysRegion[] = [[-262, 300, -330, 420, 0.5]]): Promise<Phys> {
  const phys = await Phys.create();
  const w = phys.world;
  const fixed = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  // the city at 50 cm, downtown at 1 m (Blender x / y; three z = -y)
  for (const [x0, x1, y0, y1, st] of regions) {
    const nx = Math.floor((x1 - x0) / st), ny = Math.floor((y1 - y0) / st);
    const hs = new Float32Array((nx + 1) * (ny + 1));
    for (let c = 0; c <= nx; c++)
      for (let r = 0; r <= ny; r++) {
        const x = x0 + c * st, y = y1 - r * st;
        const h = ground.height(x, -y);
        hs[c * (ny + 1) + r] = Number.isNaN(h) ? -4 : h;
      }
    const d = RAPIER.ColliderDesc.heightfield(ny, nx, hs, { x: nx * st, y: 1, z: ny * st });
    d.setTranslation(x0 + (nx * st) / 2, 0, -(y1 + y0) / 2).setFriction(0.8).setCollisionGroups(WORLD_GRP);
    w.createCollider(d, fixed);
  }
  return phys;
}

/** the cars near the camera, as boxes the bodies land on and get thrown by */
export class CarBodies {
  private map = new Map<Car, RAPIER.RigidBody>();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  constructor(readonly phys: Phys) {}
  update(cars: Car[], eye: THREE.Vector3) {
    const w = this.phys.world;
    for (const c of cars) {
      const near = (c.x - eye.x) ** 2 + (c.z - eye.z) ** 2 < 60 * 60;
      let b = this.map.get(c);
      if (!near) {
        if (b) b.setNextKinematicTranslation({ x: c.x, y: -50, z: c.z });
        continue;
      }
      if (!b) {
        b = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(c.x, c.y + 0.75, c.z));
        w.createCollider(RAPIER.ColliderDesc.cuboid(c.halfW * 0.95, 0.62, c.halfL * 0.96).setTranslation(0, 0, 0).setFriction(0.6).setCollisionGroups(WORLD_GRP), b);
        this.map.set(c, b);
      }
      this.q.setFromEuler(this.e.set(c.pitch, c.yaw, c.roll, 'YXZ'));
      b.setNextKinematicTranslation({ x: c.x, y: c.y + 0.72, z: c.z });
      b.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
    }
  }
}

// ------------------------------------------------------------------ particles
const SOFT = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
})();

/** a pool of round particles (CPU-moved, GPU-drawn), one blending mode */
class Particles {
  readonly points: THREE.Points;
  private n = 0;
  private readonly N: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grow: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private fade: Float32Array;
  private s0: Float32Array;
  constructor(scene: THREE.Scene, N: number, additive: boolean) {
    this.N = N;
    this.pos = new Float32Array(N * 3);
    this.col = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.alpha = new Float32Array(N);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.max = new Float32Array(N);
    this.grow = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.fade = new Float32Array(N);
    this.s0 = new Float32Array(N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: SOFT }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float uScale; varying vec3 vC; varying float vA;
        void main() {
          vC = color; vA = alpha;
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          gl_PointSize = size * uScale / max( 0.1, -mv.z );
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec3 vC; varying float vA;
        void main() {
          float a = texture2D( map, gl_PointCoord ).a * vA;
          if ( a < 0.004 ) discard;
          gl_FragColor = vec4( vC, a );
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, col: THREE.Color | [number, number, number], size: number, life: number, o: { grow?: number; drag?: number; grav?: number; alpha?: number } = {}) {
    const i = this.n;
    this.n = (this.n + 1) % this.N;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    const c = Array.isArray(col) ? col : [col.r, col.g, col.b];
    this.col.set(c, i * 3);
    this.size[i] = size;
    this.s0[i] = size;
    this.life[i] = life;
    this.max[i] = life;
    this.grow[i] = o.grow ?? 0;
    this.drag[i] = o.drag ?? 1;
    this.grav[i] = o.grav ?? 0;
    this.fade[i] = o.alpha ?? 1;
    this.alpha[i] = this.fade[i];
  }
  update(dt: number, h: number) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.max[i]);
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] * (1 + this.grow[i] * (1 - k));
      this.alpha[i] = this.fade[i] * Math.min(1, k * 2.2);
    }
    void h;
    const g = this.points.geometry;
    for (const n of ['position', 'size', 'alpha', 'color']) (g.attributes[n] as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** small flat marks on the ground and walls: bullet holes, splashes, pools of blood */
class Decals {
  readonly mesh: THREE.InstancedMesh;
  private i = 0;
  private grow: { i: number; t: number; T: number; s: number; m: THREE.Matrix4 }[] = [];
  constructor(scene: THREE.Scene, readonly N = 260) {
    const g = new THREE.PlaneGeometry(1, 1);
    const m = new THREE.MeshStandardMaterial({ map: SOFT, transparent: true, depthWrite: false, roughness: 0.25, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.InstancedMesh(g, m, N);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < N; k++) {
      this.mesh.setMatrixAt(k, zero);
      this.mesh.setColorAt(k, new THREE.Color(0, 0, 0));
    }
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  add(p: THREE.Vector3, n: THREE.Vector3, size: number, col: THREE.Color, growT = 0) {
    const k = this.i;
    this.i = (this.i + 1) % this.N;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.random() * 6.28));
    const m = new THREE.Matrix4().compose(p.clone().addScaledVector(n, 0.012), q, new THREE.Vector3(size, size * (0.8 + Math.random() * 0.4), 1));
    this.grow = this.grow.filter((g) => g.i !== k);
    if (growT > 0) {
      this.grow.push({ i: k, t: 0, T: growT, s: size, m });
      this.mesh.setMatrixAt(k, m.clone().multiply(new THREE.Matrix4().makeScale(0.1, 0.1, 1)));
    } else this.mesh.setMatrixAt(k, m);
    this.mesh.setColorAt(k, col);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
  update(dt: number) {
    if (!this.grow.length) return;
    for (const g of this.grow) {
      g.t = Math.min(g.T, g.t + dt);
      const k = 0.1 + 0.9 * Math.sqrt(g.t / g.T);
      this.mesh.setMatrixAt(g.i, g.m.clone().multiply(new THREE.Matrix4().makeScale(k, k, 1)));
    }
    this.grow = this.grow.filter((g) => g.t < g.T);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** muzzle flashes and tracers: short-lived glowing quads */
class Flashes {
  private flashes: { s: THREE.Sprite; t: number }[] = [];
  private tracers: { m: THREE.Mesh; t: number; a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  private fi = 0;
  private ti = 0;
  constructor(scene: THREE.Scene) {
    const fm = new THREE.SpriteMaterial({ map: star(), color: new THREE.Color(14, 9, 4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(fm);
      s.visible = false;
      s.renderOrder = 7;
      scene.add(s);
      this.flashes.push({ s, t: 0 });
    }
    const tg = new THREE.PlaneGeometry(1, 1);
    tg.translate(0, 0.5, 0);
    const tm = new THREE.MeshBasicMaterial({ map: SOFT, color: new THREE.Color(5, 3.6, 1.8), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tg, tm);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 7;
      scene.add(m);
      this.tracers.push({ m, t: 0, a: new THREE.Vector3(), b: new THREE.Vector3() });
    }
  }
  flash(p: THREE.Vector3, size: number) {
    const f = this.flashes[this.fi];
    this.fi = (this.fi + 1) % this.flashes.length;
    f.s.position.copy(p);
    f.s.scale.setScalar(size * (0.8 + Math.random() * 0.5));
    f.s.material.rotation = Math.random() * 6.28;
    f.s.visible = true;
    f.t = 0.045;
  }
  tracer(a: THREE.Vector3, b: THREE.Vector3) {
    const t = this.tracers[this.ti];
    this.ti = (this.ti + 1) % this.tracers.length;
    // a short bright streak travelling down the line
    t.a.copy(a);
    t.b.copy(b);
    t.t = 0;
    t.m.visible = true;
  }
  update(dt: number, cam: THREE.Camera) {
    for (const f of this.flashes) {
      if (!f.s.visible) continue;
      f.t -= dt;
      if (f.t <= 0) f.s.visible = false;
    }
    const cp = cam.position;
    const UP = new THREE.Vector3();
    for (const t of this.tracers) {
      if (!t.m.visible) continue;
      t.t += dt;
      const L = t.a.distanceTo(t.b);
      const speed = 900; // m/s along the line
      const head = Math.min(L, t.t * speed), tail = Math.max(0, head - Math.min(14, L * 0.5));
      if (tail >= L - 0.01 || t.t > 0.25) {
        t.m.visible = false;
        continue;
      }
      const d = UP.copy(t.b).sub(t.a).normalize();
      const p0 = t.a.clone().addScaledVector(d, tail);
      const len = head - tail;
      t.m.position.copy(p0);
      // the quad lies along the line, turned to face the camera
      const toCam = cp.clone().sub(p0).normalize();
      const side = new THREE.Vector3().crossVectors(d, toCam).normalize();
      const nrm = new THREE.Vector3().crossVectors(side, d);
      t.m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, d, nrm));
      t.m.scale.set(0.025, len, 1);
    }
  }
}

function star(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,230,180,0.9)');
  gr.addColorStop(0.5, 'rgba(255,160,60,0.25)');
  gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr;
  for (let k = 0; k < 5; k++) {
    g.rotate((Math.PI * 2) / 5 + Math.random() * 0.4);
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(60, 0);
    g.lineTo(0, 8);
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, 26, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
}

const V = new THREE.Vector3();
const C_BLOOD = new THREE.Color(0.32, 0.02, 0.02);
const C_HOLE = new THREE.Color(0.03, 0.03, 0.03);
const C_POOL = new THREE.Color(0.16, 0.005, 0.005);

export class Fx {
  private readonly soft: Particles;
  private readonly glow: Particles;
  private readonly decals: Decals;
  private readonly flashes: Flashes;
  private burning: { p: () => THREE.Vector3; t: number; fire: boolean }[] = [];
  /** a sudden light: (x, y, z, intensity) folded into the lamp list for a frame or two */
  readonly lights: { p: THREE.Vector3; i: number; t: number }[] = [];
  shake = 0;
  constructor(readonly scene: THREE.Scene) {
    this.soft = new Particles(scene, 900, false);
    this.glow = new Particles(scene, 500, true);
    this.decals = new Decals(scene);
    this.flashes = new Flashes(scene);
  }

  muzzle(p: THREE.Vector3, dir: THREE.Vector3, big: boolean) {
    this.flashes.flash(p, big ? 0.55 : 0.38);
    for (let i = 0; i < 4; i++) this.soft.emit(p, V.copy(dir).multiplyScalar(1.5 + Math.random() * 2).add(new THREE.Vector3(0, 0.4, 0)), [0.55, 0.55, 0.55], 0.08, 0.5, { grow: 4, drag: 2.5, alpha: 0.25 });
    this.lights.push({ p: p.clone(), i: big ? 70 : 45, t: 0.05 });
  }

  tracer(a: THREE.Vector3, b: THREE.Vector3) {
    this.flashes.tracer(a, b);
  }

  /** a bullet strikes: what it struck decides the puff */
  impact(p: THREE.Vector3, n: THREE.Vector3, kind: 'ground' | 'wall' | 'metal' | 'flesh' | 'glass', dir: THREE.Vector3) {
    if (kind === 'flesh') {
      for (let i = 0; i < 10; i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(2.2).addScaledVector(dir, 2.5);
        this.soft.emit(p, v, [0.38 + Math.random() * 0.1, 0.02, 0.02], 0.05 + Math.random() * 0.05, 0.5 + Math.random() * 0.4, { grav: 6, drag: 1.2, grow: 1.5, alpha: 0.9 });
      }
      this.soft.emit(p, dir.clone().multiplyScalar(0.6), [0.45, 0.04, 0.04], 0.16, 0.35, { grow: 2.5, drag: 3, alpha: 0.5 });
      return;
    }
    if (kind === 'metal' || kind === 'glass') {
      for (let i = 0; i < 9; i++) {
        const v = new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(5).addScaledVector(n, 3);
        this.glow.emit(p, v, [3, 1.6, 0.5], 0.025, 0.18 + Math.random() * 0.2, { grav: 9, drag: 0.5 });
      }
      if (kind === 'glass') for (let i = 0; i < 6; i++) this.soft.emit(p, new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(2.5), [0.8, 0.85, 0.9], 0.03, 0.7, { grav: 9, drag: 0.3, alpha: 0.7 });
      this.decals.add(p, n, 0.05, C_HOLE);
      return;
    }
    const dusty: [number, number, number] = kind === 'ground' ? [0.42, 0.4, 0.37] : [0.68, 0.64, 0.58];
    for (let i = 0; i < 7; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.2, Math.random() - 0.5).multiplyScalar(1.4).addScaledVector(n, 1.8 + Math.random() * 1.5);
      this.soft.emit(p, v, dusty, 0.07 + Math.random() * 0.06, 0.6 + Math.random() * 0.5, { grow: 5, drag: 3, grav: 0.6, alpha: 0.55 });
    }
    for (let i = 0; i < 4; i++) this.soft.emit(p, new THREE.Vector3(Math.random() - 0.5, Math.random(), Math.random() - 0.5).multiplyScalar(3).addScaledVector(n, 2), [0.22, 0.21, 0.2], 0.018, 0.5, { grav: 9.8, drag: 0.2 });
    if (Math.random() < 0.4) this.glow.emit(p, n.clone().multiplyScalar(2), [2.5, 1.4, 0.5], 0.03, 0.08);
    this.decals.add(p, n, 0.06 + Math.random() * 0.03, C_HOLE);
  }

  /** blood on the ground under someone hit (a splash), or spreading from where they lie */
  bloodSplash(p: THREE.Vector3) {
    this.decals.add(p, V.set(0, 1, 0), 0.35 + Math.random() * 0.35, C_BLOOD);
  }
  bloodPool(p: THREE.Vector3) {
    this.decals.add(p, new THREE.Vector3(0, 1, 0), 1.3 + Math.random() * 0.5, C_POOL, 9);
  }

  /** a wreck smokes, then burns: call each frame from the car (p: the bonnet) */
  smoke(p: THREE.Vector3, fire: boolean, dt: number) {
    // smoke: thin and grey from a hurt engine, thick and dark off a fire, drifting with the breeze
    if (Math.random() < dt * (fire ? 16 : 10)) {
      const g = fire ? 0.1 + Math.random() * 0.06 : 0.42 + Math.random() * 0.1;
      this.soft.emit(p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5)), new THREE.Vector3(0.5 + (Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 0.8, 0.25 + (Math.random() - 0.5) * 0.4), [g, g, g * 0.97], fire ? 0.45 : 0.3, fire ? 3.2 : 2.2, { grow: fire ? 3.4 : 3, drag: 0.35, alpha: fire ? 0.38 : 0.26 });
    }
    if (fire) {
      // flames: many small tongues, hot at the root, licking up and fading orange to red
      const n = Math.random() < dt * 70 ? 3 : 0;
      for (let k = 0; k < n; k++) {
        const hot = Math.random();
        this.glow.emit(
          p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.1, -0.3 + Math.random() * 0.2, (Math.random() - 0.5) * 1.1)),
          new THREE.Vector3((Math.random() - 0.5) * 0.3, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 0.3),
          [2.6 + hot * 1.4, 0.7 + hot * 0.9, 0.12 + hot * 0.2],
          0.32 + Math.random() * 0.3,
          0.35 + Math.random() * 0.35,
          { grow: -0.45, drag: 0.8 },
        );
      }
      if (Math.random() < dt * 8) this.lights.push({ p: p.clone(), i: 55 + Math.random() * 30, t: 0.15 });
    }
  }

  explosion(p: THREE.Vector3) {
    for (let i = 0; i < 70; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize().multiplyScalar(4 + Math.random() * 9);
      this.glow.emit(p, v, [5, 2 + Math.random(), 0.4], 0.6 + Math.random() * 0.8, 0.5 + Math.random() * 0.5, { grow: 1.5, drag: 3, grav: -1 });
    }
    for (let i = 0; i < 45; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 5);
      this.soft.emit(p, v, [0.07, 0.065, 0.06], 1 + Math.random(), 3 + Math.random() * 2, { grow: 2.5, drag: 1.2, grav: -0.6, alpha: 0.85 });
    }
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() + 0.3, Math.random() - 0.5).multiplyScalar(16);
      this.glow.emit(p, v, [3, 1.4, 0.3], 0.05, 0.9 + Math.random(), { grav: 9.8, drag: 0.3 });
    }
    this.flashes.flash(p, 9);
    this.lights.push({ p: p.clone().setY(p.y + 1.5), i: 900, t: 0.35 });
    this.decals.add(p.clone().setY(p.y - 0.4), new THREE.Vector3(0, 1, 0), 5, new THREE.Color(0.02, 0.02, 0.02));
  }

  update(dt: number, cam: THREE.Camera) {
    this.soft.update(dt, 0);
    this.glow.update(dt, 0);
    this.decals.update(dt);
    this.flashes.update(dt, cam);
    for (let i = this.lights.length - 1; i >= 0; i--) {
      this.lights[i].t -= dt;
      if (this.lights[i].t <= 0) this.lights.splice(i, 1);
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    void this.burning;
  }
}

// ------------------------------------------------------------------ the line of fire
export interface Hittable {
  /** the feet (three coords) */
  x: number;
  y: number;
  z: number;
  h: number;
  r: number;
  alive: boolean;
}

export type HitKind = 'ground' | 'wall' | 'actor' | 'car';
export interface Hit<A> {
  kind: HitKind;
  p: THREE.Vector3;
  n: THREE.Vector3;
  d: number;
  actor?: A;
  /** 0 head, 1 body, 2 legs */
  zone?: number;
  car?: Car;
}

/** first thing on a ray: the city (marched through the heightmap), people (capsules), cars (boxes) */
export function castRay<A extends Hittable>(ground: Ground, o: THREE.Vector3, d: THREE.Vector3, max: number, actors: A[], cars: Car[], skip: (a: A | Car) => boolean): Hit<A> | null {
  let best: Hit<A> | null = null;
  // the city: step through the 25 cm map
  const step = 0.2;
  let prevY = o.y, prevH = ground.height(o.x, o.z);
  for (let t = step; t < max; t += step) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    const h = ground.height(x, z);
    if (Number.isNaN(h)) {
      if (y < 0) {
        best = { kind: 'ground', p: new THREE.Vector3(x, 0, z), n: new THREE.Vector3(0, 1, 0), d: t };
        break;
      }
      continue;
    }
    const blocked = ground.blocked(x, z) && y < h + 2.4;
    if (y <= h || blocked) {
      // came in from above (the ground, a roof) or through the side (a wall, a post)
      const fromAbove = prevY > prevH + 0.05 && h - prevH < 0.3 && !blocked;
      let n: THREE.Vector3;
      if (fromAbove) n = new THREE.Vector3(0, 1, 0);
      else {
        n = new THREE.Vector3(-d.x, 0, -d.z);
        // which side: the gradient of the map across the step
        const gx = ground.height(x + 0.25, z) - ground.height(x - 0.25, z), gz = ground.height(x, z + 0.25) - ground.height(x, z - 0.25);
        if (Math.abs(gx) + Math.abs(gz) > 0.2) n.set(-gx, 0, -gz);
        n.normalize();
      }
      const p = new THREE.Vector3(x, fromAbove ? h : y, z);
      best = { kind: fromAbove ? 'ground' : 'wall', p, n, d: t };
      break;
    }
    prevY = y;
    prevH = h;
  }
  const lim = best ? best.d : max;
  // people: vertical capsules
  for (const a of actors) {
    if (!a.alive || skip(a)) continue;
    const ox = o.x - a.x, oz = o.z - a.z;
    const A = d.x * d.x + d.z * d.z;
    if (A < 1e-6) continue;
    const Bq = 2 * (ox * d.x + oz * d.z), Cq = ox * ox + oz * oz - a.r * a.r;
    const disc = Bq * Bq - 4 * A * Cq;
    if (disc < 0) continue;
    const t = (-Bq - Math.sqrt(disc)) / (2 * A);
    if (t < 0.05 || t > lim) continue;
    const y = o.y + d.y * t;
    if (y < a.y || y > a.y + a.h) continue;
    if (!best || t < best.d) {
      const rel = (y - a.y) / a.h;
      best = { kind: 'actor', p: new THREE.Vector3(o.x + d.x * t, y, o.z + d.z * t), n: new THREE.Vector3(ox + d.x * t, 0, oz + d.z * t).normalize(), d: t, actor: a, zone: rel > 0.86 ? 0 : rel > 0.5 ? 1 : 2 };
    }
  }
  // cars: oriented boxes (slab test in the car's frame)
  for (const c of cars) {
    if (skip(c)) continue;
    const dx = c.x - o.x, dz = c.z - o.z;
    if (dx * dx + dz * dz > (max + 4) ** 2) continue;
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    // into the car's frame: lx along its left, lz along its nose
    const lox = (o.x - c.x) * co - (o.z - c.z) * s, loz = (o.x - c.x) * s + (o.z - c.z) * co, loy = o.y - (c.y + 0.75);
    const ldx = d.x * co - d.z * s, ldz = d.x * s + d.z * co, ldy = d.y;
    let t0 = 0, t1 = best ? best.d : max;
    let nAxis = 0, nSign = 0;
    const slab = (oo: number, dd: number, h: number, ax: number) => {
      if (Math.abs(dd) < 1e-6) return oo > -h && oo < h;
      let a = (-h - oo) / dd, b = (h - oo) / dd;
      let sg = -1;
      if (a > b) {
        [a, b] = [b, a];
        sg = 1;
      }
      if (a > t0) {
        t0 = a;
        nAxis = ax;
        nSign = sg;
      }
      t1 = Math.min(t1, b);
      return t0 <= t1;
    };
    if (!slab(lox, ldx, c.halfW * 0.96, 0) || !slab(loy, ldy, 0.72, 1) || !slab(loz, ldz, c.halfL * 0.97, 2)) continue;
    if (t0 < 0.05) continue;
    if (!best || t0 < best.d) {
      const n = new THREE.Vector3();
      if (nAxis === 1) n.set(0, nSign, 0);
      else if (nAxis === 0) n.set(co * nSign, 0, -s * nSign);
      else n.set(s * nSign, 0, co * nSign);
      best = { kind: 'car', p: new THREE.Vector3(o.x + d.x * t0, o.y + d.y * t0, o.z + d.z * t0), n, d: t0, car: c };
    }
  }
  return best;
}

/** can a point see another (through the heightmap only: walls and roofs block, people and cars don't) */
export function lineOfSight(ground: Ground, a: THREE.Vector3, b: THREE.Vector3): boolean {
  const L = a.distanceTo(b);
  const n = Math.ceil(L / 0.5);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
    const h = ground.height(x, z);
    if (!Number.isNaN(h) && h > y) return false;
  }
  return true;
}

// ------------------------------------------------------------------ sounds
export class Sfx {
  private siren: { o: OscillatorNode; g: GainNode; p: StereoPannerNode } | null = null;
  private listener = new THREE.Vector3();
  private right = new THREE.Vector3();
  private noiseBuf: AudioBuffer | null = null;
  private sub: HTMLDivElement;
  private subT = 0 as unknown as ReturnType<typeof setTimeout>;
  private lastSay = 0;
  constructor(readonly out: () => { ctx: AudioContext; master: GainNode } | null) {
    this.sub = document.createElement('div');
    this.sub.style.cssText = 'position:fixed;left:50%;bottom:13%;transform:translateX(-50%);z-index:6;font:600 20px "Barlow Condensed",sans-serif;color:#fff;text-shadow:0 2px 6px #000,0 0 2px #000;letter-spacing:.03em;pointer-events:none;opacity:0;transition:opacity .25s;text-align:center;max-width:70vw';
    document.body.appendChild(this.sub);
  }

  listen(cam: THREE.Camera) {
    this.listener.copy(cam.position);
    this.right.set(1, 0, 0).applyQuaternion(cam.quaternion);
  }

  private noise(ctx: AudioContext) {
    if (this.noiseBuf) return this.noiseBuf;
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (this.noiseBuf = b);
  }

  /** gain and pan for a sound at p: falls off with distance, panned by the camera's right */
  private place(p: THREE.Vector3 | null, ref = 8): { gain: number; pan: number; far: number } {
    if (!p) return { gain: 1, pan: 0, far: 0 };
    const d = this.listener.distanceTo(p);
    const dir = p.clone().sub(this.listener).normalize();
    return { gain: Math.min(1, ref / Math.max(ref, d)), pan: THREE.MathUtils.clamp(dir.dot(this.right), -1, 1) * 0.8, far: Math.min(1, d / 120) };
  }

  /** a gunshot: a crack, the body of it, and the street's slap-back echo (longer the further off) */
  shot(kind: 'pistol' | 'shotgun' | 'rifle', p: THREE.Vector3 | null) {
    const o = this.out();
    if (!o) return;
    const { ctx, master } = o;
    const { gain, pan, far } = this.place(p, 10);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = (kind === 'shotgun' ? 2600 : kind === 'rifle' ? 4800 : 4000) * (1 - far * 0.75);
    const g = ctx.createGain();
    const L = kind === 'shotgun' ? 0.5 : kind === 'rifle' ? 0.32 : 0.26;
    const v = (kind === 'shotgun' ? 1.0 : kind === 'rifle' ? 0.8 : 0.7) * gain;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(v * 0.25, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0008, t + L);
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan;
    src.connect(lp).connect(g).connect(pn).connect(master);
    src.start(t, Math.random(), L + 0.05);
    // the thump
    const th = ctx.createOscillator();
    th.type = 'sine';
    th.frequency.setValueAtTime(kind === 'shotgun' ? 95 : 140, t);
    th.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(v * 0.9, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    th.connect(tg).connect(pn);
    th.start(t);
    th.stop(t + 0.2);
    // the echo off the buildings
    const d = ctx.createDelay(1);
    d.delayTime.value = 0.09 + far * 0.25;
    const eg = ctx.createGain();
    eg.gain.value = 0.28;
    const elp = ctx.createBiquadFilter();
    elp.type = 'lowpass';
    elp.frequency.value = 1500;
    g.connect(d).connect(elp).connect(eg).connect(master);
  }

  /** dull thud (a punch, a body hitting a car) or the clank of a round into metal */
  hit(kind: 'flesh' | 'metal' | 'punch', p: THREE.Vector3 | null) {
    const o = this.out();
    if (!o) return;
    const { ctx, master } = o;
    const { gain, pan } = this.place(p, 6);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = kind === 'metal' ? 'bandpass' : 'lowpass';
    f.frequency.value = kind === 'metal' ? 3200 : 600;
    f.Q.value = kind === 'metal' ? 6 : 0.7;
    const g = ctx.createGain();
    const v = (kind === 'punch' ? 0.8 : 0.5) * gain;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'metal' ? 0.25 : 0.12));
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan;
    src.connect(f).connect(g).connect(pn).connect(master);
    src.start(t, Math.random(), 0.3);
  }

  explosion(p: THREE.Vector3) {
    const o = this.out();
    if (!o) return;
    const { ctx, master } = o;
    const { gain, pan } = this.place(p, 30);
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(1.6 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    const pn = ctx.createStereoPanner();
    pn.pan.value = pan;
    src.connect(lp).connect(g).connect(pn).connect(master);
    src.start(t, 0, 2.7);
    const th = ctx.createOscillator();
    th.frequency.setValueAtTime(70, t);
    th.frequency.exponentialRampToValueAtTime(25, t + 0.8);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(1.4 * gain, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    th.connect(tg).connect(pn);
    th.start(t);
    th.stop(t + 1.3);
  }

  /** the police siren: the nearest wailing unit (or null to stop) */
  sirenAt(p: THREE.Vector3 | null, time: number) {
    const o = this.out();
    if (!o) return;
    const { ctx, master } = o;
    if (!p) {
      if (this.siren) this.siren.g.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      return;
    }
    if (!this.siren) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 2200;
      const g = ctx.createGain();
      g.gain.value = 0;
      const pn = ctx.createStereoPanner();
      osc.connect(f).connect(g).connect(pn).connect(master);
      osc.start();
      this.siren = { o: osc, g, p: pn };
    }
    const { gain, pan } = this.place(p, 15);
    // a wail: up and down over 4 s, the yelp faster when close
    const ph = (time % 4) / 4;
    const fq = 650 + 650 * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2));
    this.siren.o.frequency.setTargetAtTime(fq, ctx.currentTime, 0.05);
    this.siren.g.gain.setTargetAtTime(0.12 * gain, ctx.currentTime, 0.1);
    this.siren.p.pan.setTargetAtTime(pan, ctx.currentTime, 0.1);
  }

  /** a line spoken (speech synthesis where the browser has it) with its subtitle */
  say(who: string, line: string, p: THREE.Vector3 | null, opts: { pitch?: number; rate?: number; force?: boolean } = {}) {
    const now = performance.now();
    if (!opts.force && now - this.lastSay < 1400) return;
    this.lastSay = now;
    this.sub.innerHTML = `<span style="color:#ffd36b">${who}:</span> ${line}`;
    this.sub.style.opacity = '1';
    clearTimeout(this.subT);
    this.subT = setTimeout(() => (this.sub.style.opacity = '0'), 2600);
    const ss = window.speechSynthesis;
    if (!ss || !this.out()) return;
    const { gain } = this.place(p, 8);
    if (gain < 0.08) return;
    try {
      if (ss.speaking) ss.cancel();
      const u = new SpeechSynthesisUtterance(line);
      u.pitch = opts.pitch ?? 1;
      u.rate = opts.rate ?? 1.1;
      u.volume = Math.min(1, gain * 1.2);
      ss.speak(u);
    } catch {
      /* no voice */
    }
  }
}
