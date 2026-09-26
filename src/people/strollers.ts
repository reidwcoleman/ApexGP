import * as THREE from 'three';
import { peopleKit, type PeopleKit } from './Humans.ts';
import { Extras, EX, extraBodies, type ExtraSpec } from './Extras.ts';
import { crowdReactions } from './reactions.ts';
import { TEAMS } from '../race/Teams.ts';

/**
 * People on foot: fans strolling the concourses behind the grandstands, the paddock
 * street's crowd (team staff in kit, guests), and the engineers on the pit-wall stands.
 * Each set is one Extras (instanced, baked); a walker moves only while the camera is near
 * (a far one is frozen where it was: nobody can tell). Built once the avatars are in.
 */

interface Walker {
  member: number;
  path: THREE.Vector3[];
  /** cumulative length at each point */
  cum: number[];
  d: number;
  dir: 1 | -1;
  speed: number;
  /** seconds left standing (a chat, a look at the phone) */
  pause: number;
  pausedAct: number;
  lat: number;
}

export interface PeopleSetBuild {
  specs: ExtraSpec[];
  /** still: stands at its spot on the path (a chat, the phone) */
  walkers: { member: number; path: THREE.Vector3[]; d?: number; lat?: number; still?: boolean }[];
}

const tmpA = new THREE.Vector3();

/** a set of extras, some walking paths; lazily built, updated near the camera */
export class PeopleSet {
  readonly group = new THREE.Group();
  protected extras: Extras | null = null;
  private failed = false;
  protected t = 0;
  private walkers: Walker[] = [];
  private readonly cam = new THREE.Vector3();
  walkSpeed = 1.3;

  constructor(
    name: string,
    private readonly make: (kit: PeopleKit) => PeopleSetBuild,
    private readonly opts: { near?: number; far?: number; propFar?: number; shadows?: boolean; active?: number } = {},
  ) {
    this.group.name = name;
    this.group.userData.people = this;
  }

  private build(kit: PeopleKit) {
    const b = this.make(kit);
    this.walkSpeed = kit.speed.get('walk') || 1.3;
    this.extras = new Extras(kit, b.specs, { name: this.group.name + '_extras', near: this.opts.near ?? 24, far: this.opts.far ?? 260, propFar: this.opts.propFar ?? 90, shadows: this.opts.shadows });
    this.group.add(this.extras.group);
    for (const w of b.walkers) {
      if (w.path.length < 2) continue;
      const cum = [0];
      for (let i = 1; i < w.path.length; i++) cum.push(cum[i - 1] + w.path[i].distanceTo(w.path[i - 1]));
      const total = cum[cum.length - 1];
      if (total < 2) continue;
      const pace = b.specs[w.member].pace ?? 1;
      this.walkers.push({ member: w.member, path: w.path, cum, d: (w.d ?? Math.random()) * total, dir: Math.random() < 0.5 ? 1 : -1, speed: this.walkSpeed * pace, pause: w.still ? Infinity : 0, pausedAct: EX.IDLE, lat: w.lat ?? 0 });
    }
    for (const w of this.walkers) this.place(w);
  }

  private place(w: Walker) {
    const { path, cum } = w;
    const total = cum[cum.length - 1];
    const d = THREE.MathUtils.clamp(w.d, 0, total);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const a = path[i - 1], b = path[i];
    const k = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    tmpA.lerpVectors(a, b, k);
    const dx = (b.x - a.x) * w.dir, dz = (b.z - a.z) * w.dir;
    const len = Math.hypot(dx, dz) || 1;
    // keep to one side of the path (walkers pass each other)
    tmpA.x += (-dz / len) * w.lat * w.dir;
    tmpA.z += (dx / len) * w.lat * w.dir;
    this.extras!.setPlace(w.member, tmpA.x, tmpA.y, tmpA.z, Math.atan2(dx, dz));
  }

  /** everyone standing still and quiet (an anthem), or back to what they were doing */
  calm = false;
  private calmed = false;
  private acts0: number[] = [];

  /** a hook for subclasses: after the walkers moved, before the draw */
  protected tick(_dt: number) {}

  update(dt: number, camera: THREE.Camera) {
    this.t += dt;
    if (!this.extras) {
      const kit = peopleKit();
      if (!kit || !kit.complete || this.failed) return;
      try {
        this.build(kit);
      } catch (e) {
        this.failed = true;
        console.warn('[people] ' + this.group.name + ' failed', e);
        return;
      }
    }
    const ex = this.extras!;
    if (this.calm !== this.calmed) {
      this.calmed = this.calm;
      if (this.calm) this.acts0 = ex.members.map((m) => m.act);
      ex.members.forEach((m, i) => ex.setAct(i, this.calm ? EX.IDLE : (this.acts0[i] ?? m.act)));
    }
    camera.getWorldPosition(this.cam);
    const act2 = (this.opts.active ?? 220) ** 2;
    for (const w of this.walkers) {
      // only the ones near the camera move
      const p = ex.members[w.member].pos;
      if (p.distanceToSquared(this.cam) > act2) continue;
      if (w.pause > 0) {
        w.pause -= dt;
        if (w.pause <= 0) ex.setAct(w.member, EX.WALK);
        continue;
      }
      const total = w.cum[w.cum.length - 1];
      w.d += w.dir * w.speed * dt;
      if (w.d >= total || w.d <= 0) {
        w.d = THREE.MathUtils.clamp(w.d, 0, total);
        w.dir = -w.dir as 1 | -1;
      }
      // now and then someone stops: the phone, a look around
      if (Math.random() < dt / 40) {
        w.pause = 3 + Math.random() * 7;
        ex.setAct(w.member, Math.random() < 0.5 ? EX.PHONE : EX.LOOK);
      }
      this.place(w);
    }
    this.tick(dt);
    ex.update(this.t, camera);
  }

  dispose() {
    this.extras?.dispose();
    this.group.removeFromParent();
  }
}

/** a fan's shirt: a team's colours, or the venue's */
function fanShirt(rand: () => number, colors: THREE.ColorRepresentation[]): THREE.ColorRepresentation {
  if (colors.length && rand() < 0.5) return colors[Math.floor(rand() * colors.length)];
  const t = TEAMS[Math.floor(rand() * TEAMS.length)];
  return rand() < 0.75 ? t.primary : t.secondary;
}

/**
 * Fans on the concourses behind the stands: `paths` are polylines on the ground, a walker
 * every `spacing` metres or so, a few standing in pairs.
 */
export function concourseCrowd(paths: THREE.Vector3[][], colors: THREE.ColorRepresentation[] = [], spacing = 9): PeopleSet {
  return new PeopleSet('concourse_people', (kit) => {
    const B = extraBodies(kit);
    let seed = 777;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out: PeopleSetBuild = { specs: [], walkers: [] };
    for (const path of paths) {
      let len = 0;
      for (let i = 1; i < path.length; i++) len += path[i].distanceTo(path[i - 1]);
      const n = Math.max(1, Math.round(len / spacing));
      for (let k = 0; k < n; k++) {
        const female = rand() < 0.35;
        const pool = female ? B.casualF : B.casualM;
        const body = pool[Math.floor(rand() * pool.length)] ?? B.casualM[0];
        const shirt = fanShirt(rand, colors);
        const standing = rand() < 0.22;
        const i = out.specs.length;
        out.specs.push({
          body,
          x: path[0].x,
          y: path[0].y,
          z: path[0].z,
          yaw: 0,
          act: standing ? (rand() < 0.5 ? EX.TALK : EX.PHONE) : EX.WALK,
          tint: shirt,
          tintAmount: 0.9,
          cap: rand() < 0.3 ? shirt : null,
          prop: standing && rand() < 0.4 ? 'phone' : null,
          pace: 0.85 + rand() * 0.3,
          scale: 0.94 + rand() * 0.1,
        });
        if (standing) {
          // parked at a spot on the path (never moves: pause forever)
          out.walkers.push({ member: i, path, d: rand(), lat: (rand() - 0.5) * 3, still: true });
        } else out.walkers.push({ member: i, path, d: rand(), lat: (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 1.2) });
      }
    }
    return out;
  }, { near: 22, far: 240, propFar: 60, shadows: false, active: 200 });
}

// ------------------------------------------------------------------------------------ the pit
export interface PitPeopleSpots {
  /** the pit-wall stools: world position of the seat top, the heading the engineer faces */
  seats: { team: number; pos: THREE.Vector3; heading: number }[];
  /** the paddock street(s) behind the garages */
  paddock: THREE.Vector3[][];
  /** where the teams' hospitality doors are along the street (for the team staff) */
  teamAt?: (p: THREE.Vector3) => number;
}

/**
 * The engineers on the pit wall (team shirts, headsets, watching the screens; the winners'
 * stand erupts at the flag) and the paddock street (team staff in kit, guests).
 */
/** how far below the stool's seat the sitting clip's feet are; the seat's height over the deck */
const SIT_DROP = 0.74;
interface SeatMember {
  member: number;
  team: number;
  y: number;
}
const STOOL = 0.69;

export class PitPeople extends PeopleSet {
  private readonly seatMembers: SeatMember[];

  constructor(spots: PitPeopleSpots) {
    const seats: SeatMember[] = [];
    super('pit_people', (kit) => PitPeople.plan(kit, spots, seats), { near: 22, far: 320, propFar: 70, shadows: true, active: 240 });
    this.seatMembers = seats;
  }

  private static plan(kit: PeopleKit, spots: PitPeopleSpots, seatMembers: SeatMember[]): PeopleSetBuild {
    const B = extraBodies(kit);
    let seed = 9091;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out: PeopleSetBuild = { specs: [], walkers: [] };
    for (const s of spots.seats) {
      const t = TEAMS[s.team % TEAMS.length];
      const i = out.specs.length;
      out.specs.push({ body: B.shirt, x: s.pos.x, y: s.pos.y - SIT_DROP, z: s.pos.z, yaw: s.heading, act: EX.SIT, tint: t.primary, tintAmount: 1, prop: 'headset', propColor: 0x121316, pace: 0.8 + rand() * 0.4 });
      seatMembers.push({ member: i, team: s.team, y: s.pos.y });
    }
    for (const path of spots.paddock) {
      let len = 0;
      for (let i = 1; i < path.length; i++) len += path[i].distanceTo(path[i - 1]);
      const n = Math.max(1, Math.round(len / 7));
      for (let k = 0; k < n; k++) {
        const r = rand();
        const i = out.specs.length;
        const team = TEAMS[Math.floor(rand() * TEAMS.length)];
        const p0 = path[0];
        if (r < 0.45) {
          // team staff in kit
          out.specs.push({ body: rand() < 0.5 ? B.crew : B.shirt, x: p0.x, y: p0.y, z: p0.z, yaw: 0, act: EX.WALK, tint: team.primary, tintAmount: 1, dyeAll: true, cap: rand() < 0.4 ? team.primary : null, pace: 0.9 + rand() * 0.25 });
        } else {
          const female = rand() < 0.4;
          const pool = female ? B.casualF : B.casualM;
          out.specs.push({ body: pool[Math.floor(rand() * pool.length)] ?? B.casualM[0], x: p0.x, y: p0.y, z: p0.z, yaw: 0, act: EX.WALK, tint: rand() < 0.5 ? 0xf2f2f2 : 0x1d2230, tintAmount: 0.7, prop: rand() < 0.2 ? 'phone' : null, pace: 0.85 + rand() * 0.3 });
        }
        out.walkers.push({ member: i, path, d: rand(), lat: (rand() - 0.5) * 6 });
      }
    }
    return out;
  }

  private celebrating: object | null = null;

  protected override tick(dt: number) {
    const ex = this.extras!;
    // the winner's pit wall: up on their feet, cheering (then back to the screens)
    const cel = crowdReactions.celebrate;
    const team = cel ? TEAMS.indexOf(cel.team as (typeof TEAMS)[number]) : -1;
    if ((cel?.team ?? null) !== this.celebrating) {
      this.celebrating = cel?.team ?? null;
      for (const s of this.seatMembers) {
        const on = s.team === team;
        ex.setAct(s.member, on ? (Math.random() < 0.5 ? EX.CHEER : EX.JUMP) : EX.SIT, Math.random());
        // standing: on the deck, a step back from the stool
        const m = ex.members[s.member];
        const back = on ? -0.35 : 0;
        ex.setPlace(s.member, m.spec.x + Math.sin(m.yaw) * back, on ? s.y - STOOL : s.y - SIT_DROP, m.spec.z + Math.cos(m.yaw) * back, m.yaw);
      }
    }
    void dt;
  }
}

/**
 * The podium's team celebration: the top three teams' crews in their kit, packed at the
 * barrier round parc fermé, jumping, cheering, clapping, a few waving team flags.
 */
export function teamCelebration(spots: { x: number; y: number; z: number; yaw: number; team: number }[]): PeopleSet {
  return new PeopleSet('podium_crews', (kit) => {
    const B = extraBodies(kit);
    let seed = 5150;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const out: PeopleSetBuild = { specs: [], walkers: [] };
    for (const sp of spots) {
      const t = TEAMS[sp.team % TEAMS.length];
      const r = rand();
      const flag = r < 0.1;
      out.specs.push({
        body: rand() < 0.8 ? B.crew : B.shirt,
        x: sp.x,
        y: sp.y,
        z: sp.z,
        yaw: sp.yaw,
        act: flag ? EX.WAVE : r < 0.45 ? EX.JUMP : r < 0.8 ? EX.CHEER : EX.CLAP,
        tint: t.primary,
        tintAmount: 1,
        dyeAll: true,
        cap: rand() < 0.55 ? (rand() < 0.7 ? t.primary : t.secondary) : null,
        prop: flag ? 'flag' : null,
        propColor: t.primary,
        pace: 0.85 + rand() * 0.35,
        scale: 0.95 + rand() * 0.09,
      });
    }
    return out;
  }, { near: 16, far: 200, propFar: 120, shadows: false });
}
