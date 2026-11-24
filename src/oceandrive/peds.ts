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
  sit: boolean;
  yaw: number;
  t: number;
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

  private add(x: number, z: number, lane: number, dir: number, z0: number, z1: number, sit = false, yaw = 0): Ped {
    const p = new Person(this.kit, this.look());
    this.scene.add(p.root);
    this.env.prepObject(p.root, true, true);
    const ped: Ped = { p, x, z, dir, lane, speed: 1.15 + this.rnd() * 0.45, side: 0, z0, z1, sit, yaw, t: this.rnd() * 10 };
    p.play(sit ? 'sit' : 'walk', { offset: this.rnd() });
    p.root.position.set(x, this.ground.height(x, z) || 0, z);
    this.list.push(ped);
    return ped;
  }

  spawn() {
    const r = this.rnd;
    // west sidewalk (between the café tables and the curb), east sidewalk, beachwalk-ish lane on the lawn
    const lanes: [number, number, number, number][] = [
      [-7.5, 8, -92, 92],
      [8.3, 7, -100, 100],
      [9.4, 3, -100, 100],
      [-7.2, 3, -92, 92],
    ];
    for (const [x, n, a, b] of lanes) {
      for (let i = 0; i < n; i++) {
        const z = a + r() * (b - a);
        this.add(x + (r() - 0.5) * 0.3, z, x, r() < 0.5 ? 1 : -1, a, b);
      }
    }
    // a few on the sand near the water
    for (let i = 0; i < 4; i++) this.add(150 + r() * 90, -60 + r() * 120, 0, r() < 0.5 ? 1 : -1, -90, 90);
  }

  update(dt: number, you: THREE.Vector3) {
    for (const d of this.list) {
      if (d.sit) {
        d.p.update(dt);
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
      const far = Math.hypot(you.x - d.x, you.z - d.z) > 70;
      const act = (d.p as unknown as { current: THREE.AnimationAction | null }).current;
      const cs = this.kit.speed.get('walk') ?? 1.35;
      if (act) act.timeScale = want / cs;
      if (!far) d.p.update(dt);
      else d.p.root.updateMatrixWorld(true);
    }
  }
}
