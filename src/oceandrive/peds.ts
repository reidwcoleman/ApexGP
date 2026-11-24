import * as THREE from 'three';
import { Person, type PeopleKit, type Look } from '../people/Humans.ts';
import type { Env } from './env.ts';
import type { Ground } from './height.ts';

/**
 * South Beach at 5 pm: people strolling both sidewalks of Ocean Drive and the beachwalk, a few on
 * the sand, and diners at the café tables. Walkers keep to a lane, go round whatever stands in it
 * (hydrants, tables, posts, you), turn back at the block's ends; their stride follows the clip's
 * own speed so the feet stay planted. Beyond 70 m they stop animating (but still move).
 */
/** the Rocketbox bodies in street clothes this page loads (the player wears the first) */
export const PEOPLE = ['Male_Adult_08', 'Male_Adult_01', 'Male_Adult_05', 'Male_Adult_14', 'Sports_Male_01', 'Female_Adult_01', 'Female_Adult_02', 'Female_Adult_04', 'Sports_Female_02'];

interface Ped {
  p: Person;
  x: number;
  z: number;
  dir: number; // +1 south (+z), -1 north
  lane: number;
  speed: number;
  side: number;
  z0: number;
  z1: number;
  sit: boolean; // standing or sitting still (clip below)
  yaw: number;
  t: number;
  clip: string;
  acc: number;
  lod: number; // 0 near (shadows), 1 mid, 2 hidden
}

/** skin and clothes take more of the sky and the sand's bounce (the env map's dim lower half undersells it on a beach) */
export function fill(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && 'envMapIntensity' in m) m.envMapIntensity = 1.9;
  });
}

const HAIR = [0x1a120c, 0x2a1d14, 0x4a3020, 0x6b4a2a, 0x9a7444, 0xc9a26b, 0x111111];
const COLS = [0xffffff, 0xf2efe6, 0x1b1b1f, 0x2b3a55, 0xe8b4c0, 0x9fd3d6, 0xf3d36b, 0xd9573b, 0x6f8fb8, 0x3f8f55, 0xc4487a];

export class Peds {
  readonly list: Ped[] = [];
  private rnd: () => number;
  constructor(readonly scene: THREE.Scene, readonly env: Env, readonly kit: PeopleKit, readonly ground: Ground) {
    let s = 1234567;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  }

  private look(): Look {
    const r = this.rnd;
    const names = PEOPLE.filter((n) => n !== 'Male_Adult_08');
    const body = names[Math.floor(r() * names.length)];
    const female = body.startsWith('Female') || body.includes('Female');
    return {
      female, tone: r(), body, hair: 'none', hairColor: HAIR[Math.floor(r() * HAIR.length)],
      top: 'tshirt', topColor: COLS[Math.floor(r() * COLS.length)], tint: r() < 0.5 ? 0 : 0.7 + r() * 0.3,
      bottom: 'jeans', bottomColor: 0x2d3f63, height: 0.95 + r() * 0.1, build: 0.97 + r() * 0.07,
    };
  }

  private add(x: number, z: number, lane: number, dir: number, z0: number, z1: number, sit = false, yaw = 0, clip = sit ? 'sit' : 'walk'): Ped {
    const p = new Person(this.kit, this.look());
    this.scene.add(p.root);
    this.env.prepObject(p.root, true, true);
    fill(p.root);
    const jog = clip === 'jog';
    const ped: Ped = { p, x, z, dir, lane, speed: jog ? 2.6 + this.rnd() * 0.6 : 1.15 + this.rnd() * 0.45, side: 0, z0, z1, sit, yaw, t: this.rnd() * 10, clip, acc: this.rnd() * 0.25, lod: 0 };
    p.play(clip, { offset: this.rnd() });
    p.update(0.016);
    const h = this.ground.height(x, z);
    p.root.position.set(x, Number.isNaN(h) ? 0 : h, z);
    p.root.rotation.y = yaw;
    this.list.push(ped);
    return ped;
  }

  /** two or three people standing together, turned to each other, talking */
  private group(x: number, z: number) {
    const r = this.rnd;
    const n = 2 + (r() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.4;
      const px = x + Math.sin(a) * 0.55, pz = z + Math.cos(a) * 0.55;
      if (this.ground.blocked(px, pz)) continue;
      this.add(px, pz, 0, 1, 0, 0, true, a + Math.PI, r() < 0.5 ? 'talk' : r() < 0.5 ? 'idle' : 'listen');
    }
  }

  spawn() {
    const r = this.rnd;
    // west sidewalk (between the café tables and the curb), east sidewalk, beachwalk-ish lane on the lawn
    const lanes: [number, number, number, number][] = [
      [-7.5, 12, -92, 92],
      [8.3, 10, -100, 100],
      [9.4, 5, -100, 100],
      [-7.2, 5, -92, 92],
    ];
    for (const [x, n, a, b] of lanes) {
      for (let i = 0; i < n; i++) {
        const z = a + r() * (b - a);
        this.add(x + (r() - 0.5) * 0.3, z, x, r() < 0.5 ? 1 : -1, a, b);
      }
    }
    // a few on the sand near the water
    for (let i = 0; i < 4; i++) this.add(150 + r() * 90, -60 + r() * 120, 0, r() < 0.5 ? 1 : -1, -90, 90);
    // along the water's edge: strollers on the wet sand and a few joggers
    for (let i = 0; i < 12; i++) {
      const jog = r() < 0.3;
      this.add(247 + r() * 9, -140 + r() * 280, 247 + r() * 9, r() < 0.5 ? 1 : -1, -160, 160, false, 0, jog ? 'jog' : 'walk');
    }
    // people standing about: by the parked cars on the east sidewalk, on the sand by the loungers
    for (let i = 0; i < 6; i++) this.group(9.6 + r() * 0.6, -80 + r() * 160);
    for (let i = 0; i < 5; i++) this.group(185 + r() * 40, -70 + r() * 140);
    for (let i = 0; i < 4; i++) this.group(232 + r() * 10, -90 + r() * 180);
  }

  private readonly pos: { x: number; z: number }[] = [];
  /** where everyone on foot is (the traffic stops for them) */
  positions(): { x: number; z: number }[] {
    this.pos.length = 0;
    for (const d of this.list) if (!d.sit) this.pos.push({ x: d.x, z: d.z });
    return this.pos;
  }

  /** near the camera every frame; further off a few times a second (still moving, cheaper) */
  private animate(d: Ped, dt: number, eye: THREE.Vector3) {
    const dd = (eye.x - d.x) ** 2 + (eye.z - d.z) ** 2;
    // shadows only near the camera; past 170 m nobody is visible enough to draw
    const lod = dd < 45 * 45 ? 0 : dd < 170 * 170 ? 1 : 2;
    if (lod !== d.lod) {
      d.lod = lod;
      d.p.root.visible = lod < 2;
      d.p.root.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.castShadow = lod === 0) : 0));
    }
    if (lod === 2) return;
    if (dd < 60 * 60) {
      d.p.update(dt + d.acc);
      d.acc = 0;
      return;
    }
    d.acc += dt;
    if (d.acc > (dd > 150 * 150 ? 0.5 : 0.2)) {
      d.p.update(d.acc);
      d.acc = 0;
    } else d.p.root.updateMatrixWorld(true);
  }

  update(dt: number, you: THREE.Vector3, eye: THREE.Vector3 = you) {
    for (const d of this.list) {
      if (d.sit) {
        this.animate(d, dt, eye);
        continue;
      }
      // keep to the lane, step round what blocks it
      let want = d.speed;
      const ax = d.x, az = d.z + d.dir * 0.9;
      const ahead = this.ground.blocked(ax + d.side, az) || (Math.hypot(you.x - (d.x), you.z - az) < 0.8);
      if (ahead) {
        d.side += (d.side >= 0 ? 1 : -1) * dt * 1.6;
        if (Math.abs(d.side) > 1.4) {
          d.side = 0;
          d.dir = -d.dir;
        }
        want *= 0.5;
      } else d.side *= 1 - Math.min(1, dt * 0.6);
      const lanex = d.lane === 0 ? d.x : d.lane;
      d.x += (lanex + d.side - d.x) * Math.min(1, dt * 2);
      d.z += d.dir * want * dt;
      if (d.z > d.z1) d.dir = -1;
      if (d.z < d.z0) d.dir = 1;
      if (Math.abs(you.x - d.x) < 0.55 && Math.abs(you.z - d.z) < 0.55) {
        // you bumped them: give way
        d.x += Math.sign(d.x - you.x || 1) * dt * 1.5;
      }
      const tyaw = d.dir > 0 ? 0 : Math.PI;
      let dy = tyaw - d.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      d.yaw += dy * Math.min(1, dt * 5);
      const h = this.ground.height(d.x, d.z);
      d.p.root.position.set(d.x, Number.isNaN(h) ? 0 : h, d.z);
      d.p.root.rotation.y = d.yaw;
      const act = (d.p as unknown as { current: THREE.AnimationAction | null }).current;
      const cs = this.kit.speed.get(d.clip) ?? (d.clip === 'jog' ? 2.8 : 1.35);
      if (act) act.timeScale = want / cs;
      this.animate(d, dt, eye);
    }
  }
}
