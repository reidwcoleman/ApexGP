/**
 * One lawn: the ground, the grass (see grass.ts), the mowing mask the mower paints (mask.ts), the
 * wild flowers, the coins, everything standing on it (scenery.ts) and the life around it.
 */
import * as THREE from 'three';
import type { LevelDef } from './levels.ts';
import { TS } from './nav.ts';
import { MaskField } from './mask.ts';
import { Meadow } from './meadow.ts';
import { Grass, groundGeometry, grassUniforms, makeGroundMaterial, type GrassU } from './grass.ts';
import { FlowerField } from './flowers.ts';
import { Ambient, Particles } from './fx.ts';
import { buildScenery, type Scenery } from './scenery.ts';
import { loadTurfColour, loadTurfNormal } from './assets.ts';
import { damp, lerp, smoothstep } from './util.ts';
import type { Mower } from './mower.ts';

export interface View {
  /** Ground-plane direction the camera looks along (away from the viewer) and its right. */
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  cam: THREE.PerspectiveCamera;
}

export interface LawnEvents {
  coin?: (x: number, z: number) => void;
  flower?: (x: number, z: number, color: string) => void;
  milestone?: (pct: number) => void;
  finished?: () => void;
}

interface Coin {
  x: number;
  z: number;
  g: THREE.Group;
  phase: number;
  state: 0 | 1;
  t: number;
  y: number;
}

export class Lawn {
  readonly group = new THREE.Group();
  readonly fx = new Particles();
  readonly events: LawnEvents = {};
  readonly mask: MaskField;
  readonly grass: Grass;
  private meadow: Meadow;
  readonly u: GrassU;
  readonly coinTotal: number;
  readonly flowerTotal: number;
  coinsGot = 0;
  flowersGot = 0;
  private flowers: FlowerField;
  private scenery: Scenery[] = [];
  private ambient: Ambient;
  private coins: Coin[] = [];
  private coinGeos: THREE.BufferGeometry[] = [];
  private coinMats: THREE.Material[] = [];
  private ground: THREE.Mesh;
  private outside: THREE.Mesh;
  private groundMats: THREE.Material[] = [];
  private time = 0;
  private nextMilestone = 25;
  private readonly tmp = { x: 0, z: 0 };
  private popped: { x: number; z: number; color: string; h: number; kind: number }[] = [];
  private newCells: number[] = [];
  private mower = new THREE.Vector3(0, 0, 0.3);

  private constructor(readonly level: LevelDef, turfN: THREE.Texture, turfC: THREE.Texture) {
    this.mask = new MaskField(level);
    this.u = grassUniforms(level.theme, this.mask);
    this.grass = new Grass(level, this.mask, this.u);
    this.meadow = new Meadow(level, this.u);
    const gm = makeGroundMaterial(this.u, turfN, false, turfC);
    const om = makeGroundMaterial(this.u, turfN, true, turfC);
    this.groundMats.push(gm, om);
    this.ground = new THREE.Mesh(groundGeometry(level), gm);
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    // the land beyond the fences: one big plane, drier and duller
    const og = new THREE.PlaneGeometry(900, 900);
    og.rotateX(-Math.PI / 2);
    const uv = og.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) - 0.5) * 900 / 1.4, (uv.getY(i) - 0.5) * 900 / 1.4);
    this.outside = new THREE.Mesh(og, om);
    this.outside.position.y = -0.015;
    this.outside.receiveShadow = true;
    this.group.add(this.outside, this.ground, this.grass.group, this.meadow.group, this.fx.group);

    this.flowers = new FlowerField(level.flowers, this.mask);
    this.flowerTotal = level.flowers.length;
    this.group.add(this.flowers.group);

    // coins: real gold, minted, standing on edge and slowly turning
    const disc = new THREE.CylinderGeometry(0.13, 0.13, 0.026, 40);
    disc.rotateX(Math.PI / 2);
    const rim = new THREE.TorusGeometry(0.108, 0.013, 10, 40);
    rim.translate(0, 0, 0.013);
    const star = new THREE.CylinderGeometry(0.052, 0.052, 0.01, 5);
    star.rotateX(Math.PI / 2);
    star.translate(0, 0, 0.016);
    this.coinGeos.push(disc, rim, star);
    const gold = new THREE.MeshStandardMaterial({ color: '#ffc83a', metalness: 1, roughness: 0.22, envMapIntensity: 1.5 });
    const gold2 = new THREE.MeshStandardMaterial({ color: '#ffe27a', metalness: 1, roughness: 0.16, envMapIntensity: 1.7 });
    this.coinMats.push(gold, gold2);
    for (const cd of level.coins) {
      const g = new THREE.Group();
      const a = new THREE.Mesh(disc, gold);
      const b = new THREE.Mesh(rim, gold2);
      const c = new THREE.Mesh(star, gold2);
      const b2 = b.clone();
      b2.position.z = -0.026;
      b2.rotation.y = Math.PI;
      const c2 = c.clone();
      c2.position.z = -0.016;
      a.castShadow = b.castShadow = c.castShadow = true;
      g.add(a, b, c, b2, c2);
      g.position.set(cd.x, 0.55, cd.z);
      this.group.add(g);
      this.coins.push({ x: cd.x, z: cd.z, g, phase: Math.random() * 6.28, state: 0, t: 0, y: 0.55 });
    }
    this.coinTotal = this.coins.length;
    this.ambient = new Ambient(level.theme, this.mask.W, this.mask.H, level.seed * 13 + 5);
    this.group.add(this.ambient.group);
  }

  static async create(level: LevelDef): Promise<Lawn> {
    const [turfN, turfC] = await Promise.all([loadTurfNormal(), loadTurfColour()]);
    turfN.anisotropy = 8;
    turfC.anisotropy = 8;
    const lawn = new Lawn(level, turfN, turfC);
    const sc = await buildScenery(level, lawn.mask, lawn.fx);
    lawn.scenery = sc;
    for (const s of sc) lawn.group.add(s.group);
    return lawn;
  }

  get progress() {
    return this.mask.progress;
  }
  get finished() {
    return this.mask.finished;
  }
  get finishing() {
    return this.mask.finishing;
  }

  /** Stripe tone for a heading: which way the grass lies as seen from the camera. */
  private tone(h: number, v: View) {
    const dx = Math.sin(h);
    const dz = Math.cos(h);
    const s = dx * v.fx + dz * v.fz + 0.3 * (dx * v.rx + dz * v.rz);
    return Math.round(smoothstep(-0.22, 0.22, s) * 255);
  }

  startFinish(m: Mower) {
    this.mask.startFinish(m.x, m.z);
    this.nextMilestone = 1000;
  }

  update(dt: number, m: Mower, view: View, setup: { magnet: number; active?: boolean; dens: number; sun: THREE.Vector3 }) {
    this.time += dt;
    const u = this.u;
    u.uTime.value = this.time;
    const mk = this.mask;
    const live = !mk.finished && setup.active !== false;
    this.mower.set(m.x, m.z, m.width * 0.5);
    u.uMower.value.copy(this.mower);

    const newCells = this.newCells;
    newCells.length = 0;
    if (live && !mk.finishing) {
      const d = m.deck();
      mk.cut(d.x, d.z, m.heading, m.width, this.tone(m.heading, view), newCells);
    } else mk.idleSweep();
    const justFinished = mk.update(dt, newCells);
    if (justFinished) this.events.finished?.();

    // clippings thrown from the chute and kicked up by the cut
    if (newCells.length) {
      const f = m.forward();
      // the chute side: the mower's local -x
      const rx = -Math.cos(m.heading);
      const rz = Math.sin(m.heading);
      const take = mk.finishing ? Math.min(newCells.length, 40) : Math.min(newCells.length, 7);
      const g = this.level.theme.grass;
      const tint = [g.tipA, g.tipB, g.cutL, g.base];
      for (let n = 0; n < take; n++) {
        const k = newCells[(Math.random() * newCells.length) | 0];
        const p = mk.cellPos(k, this.tmp);
        const up = 0.8 + Math.random() * 1.6;
        const side = mk.finishing ? (Math.random() - 0.5) * 1.6 : 1.4 + Math.random() * 1.6;
        this.fx.clipping({
          x: p.x, y: 0.1, z: p.z,
          vx: rx * side + f.x * m.speed * 0.3 + (Math.random() - 0.5) * 0.5,
          vy: up,
          vz: rz * side + f.z * m.speed * 0.3 + (Math.random() - 0.5) * 0.5,
          color: tint[(Math.random() * tint.length) | 0],
        });
      }
    }

    // flowers pop as the blades reach them
    this.flowers.pop(mk, this.popped as never);
    for (const f of this.popped) {
      this.flowersGot++;
      for (let q = 0; q < 6; q++) {
        const a = Math.random() * Math.PI * 2;
        this.fx.petal({ x: f.x, y: f.h + 0.1, z: f.z, vx: Math.cos(a) * 0.7, vy: 1.0 + Math.random() * 0.9, vz: Math.sin(a) * 0.7, color: f.color });
      }
      this.events.flower?.(f.x, f.z, f.color);
    }

    // coins: hover over the long grass, swoon into the mower
    for (const c of this.coins) {
      if (c.state === 0) {
        c.y = damp(c.y, 0.55, 5, dt);
        c.g.position.set(c.x, c.y + Math.sin(this.time * 2.2 + c.phase) * 0.03, c.z);
        c.g.rotation.y += dt * 2.4;
        const d = Math.hypot(m.x - c.x, m.z - c.z);
        if (live && d < setup.magnet) {
          const pull = (1 - d / setup.magnet) * 5.5 * dt + (d < 1.6 ? 3 * dt : 0);
          c.x += ((m.x - c.x) / Math.max(d, 0.01)) * pull * Math.max(0.3, d);
          c.z += ((m.z - c.z) / Math.max(d, 0.01)) * pull * Math.max(0.3, d);
        }
        if (live && d < 0.6) {
          c.state = 1;
          c.t = 0;
          this.coinsGot++;
          this.events.coin?.(c.x, c.z);
          for (let q = 0; q < 10; q++) {
            const a = (q / 10) * Math.PI * 2;
            this.fx.spark({ x: c.x, y: c.y + 0.1, z: c.z, vx: Math.cos(a) * 1.2, vy: 0.6 + Math.random() * 0.7, vz: Math.sin(a) * 1.2, life: 0.5 });
          }
        }
      } else {
        c.t += dt;
        const t = Math.min(1, c.t / 0.34);
        c.g.position.set(lerp(c.x, m.x, t * 0.5), c.y + t * 0.7, lerp(c.z, m.z, t * 0.5));
        c.g.rotation.y += dt * 18;
        c.g.scale.setScalar(Math.max(0, 1 + Math.sin(t * Math.PI) * 0.5 - t * t * 1.1));
        if (t >= 1) c.g.visible = false;
      }
    }

    const ctx = { mx: m.x, mz: m.z, view, time: this.time, sun: setup.sun };
    for (const s of this.scenery) s.update?.(dt, ctx);

    const pct = this.progress * 100;
    if (pct >= this.nextMilestone && this.nextMilestone < 100) {
      this.events.milestone?.(this.nextMilestone);
      this.nextMilestone += 25;
    }

    this.grass.update(m.x, m.z, setup.dens);
    this.meadow.update(m.x, m.z, setup.dens);
    this.ambient.setCamera(view.cam.quaternion);
    this.ambient.update(this.time);
    this.fx.update(dt, view.cam);
  }

  /** The nearest bit of long grass to a point, for the nudge arrow. */
  nearestUncut(x: number, z: number, heading?: number) {
    return this.mask.nearestUncut(x, z, heading);
  }

  dispose() {
    for (const s of this.scenery) s.dispose?.();
    this.grass.dispose();
    this.meadow.dispose();
    this.flowers.dispose();
    this.fx.dispose();
    this.ambient.dispose();
    this.mask.dispose();
    this.ground.geometry.dispose();
    this.outside.geometry.dispose();
    this.groundMats.forEach((m) => m.dispose());
    this.coinGeos.forEach((g) => g.dispose());
    this.coinMats.forEach((m) => m.dispose());
  }
}

export { TS };
