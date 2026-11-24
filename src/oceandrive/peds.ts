import * as THREE from 'three';
import { Person, type PeopleKit, type Look } from '../people/Humans.ts';
import type { Phys, Ragdoll } from '../lastframe/physics.ts';
import type { Env } from './env.ts';
import type { Ground } from './height.ts';
import type { Car } from './cars.ts';
import type { Fx, Sfx, Hittable } from './combat.ts';
import { poseHandsUp, posePunch } from './weapons.ts';

/**
 * South Beach at 5 pm: people strolling both sidewalks of Ocean Drive and the beachwalk, a few on
 * the sand, and diners at the café tables. Walkers keep to a lane, go round whatever stands in it
 * (hydrants, tables, posts, you), turn back at the block's ends; their stride follows the clip's
 * own speed so the feet stay planted. Beyond 70 m they stop animating (but still move).
 *
 * And they're people: a gunshot sends those near it running (or ducking where they stand), a gun
 * pointed at someone puts their hands up, a car bearing down makes them jump, a car that hits
 * them throws them (a ragdoll, if it's fast enough to kill). Shot, they fall where the bullet
 * pushes them. A driver whose car you hit gets out and has words with you (and fists, if you stay),
 * then gets back in and drives off; one you pull from the car shouts after you, or runs.
 */
/** the Rocketbox bodies in street clothes this page loads (the player wears the first) */
export const PEOPLE = ['Male_Adult_08', 'Male_Adult_01', 'Male_Adult_05', 'Male_Adult_14', 'Sports_Male_01', 'Female_Adult_01', 'Female_Adult_02', 'Female_Adult_04', 'Sports_Female_02'];

type State = 'calm' | 'flee' | 'away' | 'cower' | 'handsup' | 'angry' | 'return' | 'dead';

export interface Ped extends Hittable {
  p: Person;
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
  knockT: number;
  kvx: number;
  kvz: number;
  kdir: number;
  hp: number;
  state: State;
  stT: number;
  tx: number;
  tz: number;
  rag: Ragdoll | null;
  deadT: number;
  pooled: boolean;
  car: Car | null;
  punchT: number;
  lineT: number;
  home: { x: number; z: number; lane: number; dir: number; z0: number; z1: number; sit: boolean; clip: string; yaw: number; path?: Path | null };
  playing: string;
  /** a walker on a sidewalk line (downtown): where along it */
  path?: Path | null;
  s?: number;
  hurt: (dmg: number, dir: THREE.Vector3, zone: number, byYou: boolean) => void;
}

/** skin and clothes take more of the sky and the sand's bounce (the env map's dim lower half undersells it on a beach) */
export function fill(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (m && "envMapIntensity" in m) m.envMapIntensity = 1.15;
  });
}

const HAIR = [0x1a120c, 0x2a1d14, 0x4a3020, 0x6b4a2a, 0x9a7444, 0xc9a26b, 0x111111];
const COLS = [0xffffff, 0xf2efe6, 0x1b1b1f, 0x2b3a55, 0xe8b4c0, 0x9fd3d6, 0xf3d36b, 0xd9573b, 0x6f8fb8, 0x3f8f55, 0xc4487a];

const LINES = {
  flee: ['Help!', "He's got a gun!", 'Run!', 'Oh my God!', 'Somebody call the cops!', 'Get down!', 'Are you crazy?!'],
  angry: ['Hey! What the hell, man?!', 'You hit my car!', 'Are you blind?!', "You're paying for that!", 'Get out of the car!', 'Learn to drive!', 'Look what you did!'],
  angryFoot: ["Yeah, that's right, walk away!", 'Come here!', 'You think this is funny?', 'I got your plate, man!'],
  jacked: ["Hey, that's my car!", 'Thief! Somebody stop him!', 'Get out of my car!'],
  bump: ['Watch it!', 'Excuse you!', 'Hey!', 'Seriously?'],
  hands: ["Don't shoot! Please!", 'Take whatever you want!', 'Easy, easy!', 'Please, I have kids!'],
  hurt: ['Agh!', 'My leg!', 'Ow!'],
};

/** a walking line (three x, z) with its running length */
export interface Path {
  pts: THREE.Vector2[];
  cum: number[];
  len: number;
}
export function makePath(pts: THREE.Vector2[]): Path {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, cum, len: cum[cum.length - 1] };
}
function pathAt(P: Path, s: number, out: { x: number; z: number; tx: number; tz: number }) {
  let lo = 0, hi = P.cum.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (P.cum[m] <= s) lo = m;
    else hi = m;
  }
  const a = P.pts[lo], b = P.pts[hi];
  const L = Math.max(1e-4, P.cum[hi] - P.cum[lo]);
  const f = THREE.MathUtils.clamp((s - P.cum[lo]) / L, 0, 1);
  out.x = a.x + (b.x - a.x) * f;
  out.z = a.y + (b.y - a.y) * f;
  out.tx = (b.x - a.x) / L;
  out.tz = (b.y - a.y) / L;
  return out;
}
const PQ = { x: 0, z: 0, tx: 0, tz: 1 };

export interface You {
  pos: THREE.Vector3;
  driving: boolean;
  car: Car | null;
  /** a gun out (not fists) */
  armed: boolean;
  /** where you're aiming from, and along (null when not aiming) */
  aimFrom: THREE.Vector3 | null;
  aimDir: THREE.Vector3 | null;
  hurt: (dmg: number, dir: THREE.Vector3) => void;
}

const SPV = new THREE.Vector3();
const SPH = new THREE.Sphere(SPV, 1);

export class Peds {
  /** the camera's view, for skipping the people outside it (set each frame) */
  frustum: THREE.Frustum | null = null;
  readonly list: Ped[] = [];
  /** the cars: what blocks a sidewalk, and what's about to hit someone */
  cars: { strike: (x: number, z: number, r?: number) => { vx: number; vz: number; car: Car } | null; blocks: (x: number, z: number) => boolean; reseat: (c: Car, p: Person) => boolean } | null = null;
  phys: Phys | null = null;
  fx: Fx | null = null;
  sfx: Sfx | null = null;
  /** something criminal happened (you did it): for the police */
  crime: (kind: string, x: number, z: number, cop?: boolean) => void = () => {};
  you: You | null = null;
  private rnd: () => number;
  constructor(readonly scene: THREE.Scene, readonly env: Env, readonly kit: PeopleKit, readonly ground: Ground) {
    let s = 1234567;
    this.rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  }

  private look(x = NaN, z = NaN): Look {
    const r = this.rnd;
    const names = PEOPLE.filter((n) => n !== 'Male_Adult_08');
    // the body least worn within 25 m (two strangers in the same outfit side by side give the crowd away)
    const near = new Map<string, number>();
    if (!Number.isNaN(x)) for (const d of this.list) if (Math.abs(d.x - x) < 25 && Math.abs(d.z - z) < 25) near.set(d.p.look.body ?? '', (near.get(d.p.look.body ?? '') ?? 0) + 1);
    const least = Math.min(...names.map((n) => near.get(n) ?? 0));
    const pool = names.filter((n) => (near.get(n) ?? 0) === least);
    const body = pool[Math.floor(r() * pool.length)];
    const female = body.startsWith('Female') || body.includes('Female');
    return {
      female, tone: r(), body, hair: 'none', hairColor: HAIR[Math.floor(r() * HAIR.length)],
      top: 'tshirt', topColor: COLS[Math.floor(r() * COLS.length)], tint: r() < 0.2 ? 0 : 0.65 + r() * 0.35,
      bottom: 'jeans', bottomColor: 0x2d3f63, height: 0.95 + r() * 0.1, build: 0.97 + r() * 0.07,
    };
  }

  private add(x: number, z: number, lane: number, dir: number, z0: number, z1: number, sit = false, yaw = 0, clip = sit ? 'sit' : 'walk', person?: Person): Ped {
    const p = person ?? new Person(this.kit, this.look(x, z));
    if (!person) {
      this.scene.add(p.root);
      this.env.prepObject(p.root, true, true);
      fill(p.root);
    }
    const jog = clip === 'jog';
    const h = this.ground.height(x, z);
    const ped: Ped = {
      p, x, y: Number.isNaN(h) ? 0 : h, z, h: 1.78, r: 0.27, alive: true, dir, lane, speed: jog ? 2.6 + this.rnd() * 0.6 : 1.15 + this.rnd() * 0.45, side: 0, z0, z1, sit, yaw,
      t: this.rnd() * 10, clip, acc: this.rnd() * 0.25, lod: 0, knockT: 0, kvx: 0, kvz: 0, kdir: 0, hp: 100, state: 'calm', stT: 0, tx: 0, tz: 0, rag: null, deadT: 0, pooled: false,
      car: null, punchT: 0, lineT: 0, home: { x, z, lane, dir, z0, z1, sit, clip, yaw }, playing: clip, hurt: () => {},
    };
    ped.hurt = (dmg, d, zone, byYou) => this.hurt(ped, dmg, d, zone, byYou);
    p.play(clip, { offset: this.rnd() });
    p.update(0.016);
    p.root.position.set(x, ped.y, z);
    p.root.rotation.set(0, yaw, 0);
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
      [-7.5, 20, -92, 92],
      [8.3, 16, -100, 100],
      [9.4, 8, -100, 100],
      [-7.2, 9, -92, 92],
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
    for (let i = 0; i < 38; i++) {
      const jog = r() < 0.3;
      this.add(247 + r() * 9, -140 + r() * 280, 247 + r() * 9, r() < 0.5 ? 1 : -1, -160, 160, false, 0, jog ? 'jog' : 'walk');
    }
    // people standing about: by the parked cars on the east sidewalk, on the sand by the loungers
    for (let i = 0; i < 6; i++) this.group(9.6 + r() * 0.6, -80 + r() * 160);
    for (let i = 0; i < 20; i++) this.group(185 + r() * 40, -110 + r() * 220);
    for (let i = 0; i < 14; i++) this.group(232 + r() * 12, -160 + r() * 320);
  }

  /** people on downtown's sidewalks and park paths: n of them, spread by the lines' length */
  spawnWalks(lines: THREE.Vector2[][], n: number) {
    const paths = lines.map(makePath).filter((p) => p.len > 20);
    const tot = paths.reduce((a, p) => a + p.len, 0);
    const r = this.rnd;
    for (let i = 0; i < n; i++) {
      let x = r() * tot;
      let P = paths[0];
      for (const p of paths) {
        x -= p.len;
        if (x <= 0) {
          P = p;
          break;
        }
      }
      const s0 = r() * P.len;
      pathAt(P, s0, PQ);
      const d = this.add(PQ.x, PQ.z, -1, r() < 0.5 ? 1 : -1, 0, 0, false, 0, r() < 0.06 ? 'jog' : 'walk');
      d.path = P;
      d.s = s0;
      d.home.path = P;
    }
  }

  private readonly pos: { x: number; z: number }[] = [];
  /** where everyone on foot is (the traffic stops for them) */
  positions(): { x: number; z: number }[] {
    this.pos.length = 0;
    for (const d of this.list) if (!d.sit && d.alive) this.pos.push({ x: d.x, z: d.z });
    return this.pos;
  }

  private play(d: Ped, clip: string, fade = 0.25) {
    if (d.playing === clip) return;
    d.playing = clip;
    d.p.play(clip, { fade });
  }

  private say(d: Ped, lines: string[], force = false) {
    if (!this.sfx || (!force && d.lineT > 0)) return;
    d.lineT = 3 + this.rnd() * 3;
    const female = d.p.asset.female;
    this.sfx.say(female ? 'Woman' : 'Man', lines[Math.floor(this.rnd() * lines.length)], d.p.root.position, { pitch: female ? 1.35 : 0.85, rate: 1.15 });
  }

  /** near the camera every frame; further off a few times a second (still moving, cheaper) */
  private animate(d: Ped, dt: number, eye: THREE.Vector3) {
    const dd = (eye.x - d.x) ** 2 + (eye.z - d.z) ** 2;
    // shadows only near the camera; past 170 m nobody is visible enough to draw
    const lod = dd < 45 * 45 ? 0 : dd < 140 * 140 ? 1 : 2;
    if (lod !== d.lod) {
      d.lod = lod;
      d.p.root.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        o.castShadow = lod === 0;
        // the soft pass over the hair's ends: only close up
        if (o.name === 'person-hair-soft') o.visible = lod === 0;
      });
    }
    // out of the camera's view (and not near enough to throw a shadow into it): not drawn, not posed
    const seen = lod < 2 && (lod === 0 && dd < 20 * 20 || !this.frustum || this.frustum.intersectsSphere(SPH.set(SPV.set(d.x, d.y + 0.9, d.z), 1.3)));
    d.p.root.visible = seen;
    if (!seen) {
      d.acc += dt;
      return false;
    }
    if (dd < 60 * 60) {
      d.p.update(dt + d.acc);
      d.acc = 0;
      return true;
    }
    d.acc += dt;
    if (d.acc > (dd > 150 * 150 ? 0.5 : 0.2)) {
      d.p.update(d.acc);
      d.acc = 0;
    } else d.p.root.updateMatrixWorld(true);
    return false;
  }

  // ------------------------------------------------------------------ what happens to them
  /** a gunshot, a crash, an explosion at (x, z): everyone within r reacts */
  panic(x: number, z: number, r: number, why: 'shot' | 'boom' | 'body' = 'shot') {
    for (const d of this.list) {
      if (!d.alive || d.state === 'dead') continue;
      const dist = Math.hypot(d.x - x, d.z - z);
      if (dist > r) continue;
      if (d.state === 'flee' || d.state === 'cower') {
        d.stT = Math.max(d.stT, 8);
        d.tx = x;
        d.tz = z;
        continue;
      }
      if (d.state === 'return' && d.car && why === 'body') continue;
      // the nearest drop where they are; the rest run
      const cower = dist < 14 && this.rnd() < 0.3 && why !== 'body';
      this.scare(d, x, z, cower ? 'cower' : 'flee');
      if (this.rnd() < 0.35) this.say(d, LINES.flee);
    }
  }

  private scare(d: Ped, x: number, z: number, st: 'flee' | 'cower') {
    d.state = st;
    d.sit = false;
    d.tx = x;
    d.tz = z;
    d.stT = st === 'cower' ? 4 + this.rnd() * 5 : 12 + this.rnd() * 8;
    this.play(d, st === 'cower' ? 'crouch' : 'run', 0.2);
  }

  /** a driver out of their car: angry at you, or running from you */
  fromCar(person: Person, car: Car, x: number, z: number, yaw: number, mood: 'angry' | 'jacked' | 'flee') {
    this.scene.attach(person.root);
    person.root.position.set(x, this.ground.height(x, z) || 0, z);
    person.root.rotation.set(0, yaw, 0);
    const d = this.add(x, z, 0, 1, -1e4, 1e4, false, yaw, 'walk', person);
    d.home.lane = -999; // not a sidewalk walker: recycled when out of sight
    d.car = mood === 'angry' ? car : null;
    if (mood === 'flee') {
      this.scare(d, x - Math.sin(yaw), z - Math.cos(yaw), 'flee');
      this.say(d, LINES.flee, true);
    } else if (mood === 'jacked') {
      // knocked to the ground by the door, then up and shouting
      d.knockT = 1.6;
      d.kdir = yaw + Math.PI / 2;
      d.kvx = Math.sin(d.kdir) * 2;
      d.kvz = Math.cos(d.kdir) * 2;
      d.state = this.rnd() < 0.5 ? 'flee' : 'angry';
      d.stT = 9;
      setTimeout(() => this.say(d, LINES.jacked, true), 500);
    } else {
      d.state = 'angry';
      d.stT = 10 + this.rnd() * 4;
      this.say(d, LINES.angry, true);
    }
    return d;
  }

  private hurt(d: Ped, dmg: number, dir: THREE.Vector3, zone: number, byYou: boolean) {
    if (!d.alive) return;
    d.hp -= dmg * (zone === 0 ? 3.5 : zone === 2 ? 0.6 : 1);
    if (d.hp <= 0) {
      this.kill(d, dir.clone().multiplyScalar(1.5), zone, Math.min(70, 18 + dmg), byYou);
      return;
    }
    this.say(d, LINES.hurt, true);
    this.scare(d, d.x - dir.x * 5, d.z - dir.z * 5, 'flee');
    d.speed = Math.min(d.speed, 4);
    if (byYou) this.crime('assault', d.x, d.z);
  }

  /** dead: the ragdoll takes over (v: initial velocity, dir + power: the push where they were hit) */
  kill(d: Ped, v: THREE.Vector3, zone: number, power: number, byYou: boolean) {
    if (!d.alive) return;
    d.alive = false;
    d.hp = 0;
    d.state = 'dead';
    d.deadT = 0;
    d.pooled = false;
    d.sit = false;
    d.p.root.rotation.set(0, d.yaw, 0);
    d.p.update(0);
    if (this.phys) d.rag = this.phys.ragdoll(d.p, v, zone, v.clone().normalize(), power);
    if (byYou) this.crime('kill', d.x, d.z);
    this.panic(d.x, d.z, 30, 'body');
  }

  /** a car hit them at (vx, vz): thrown and dead past ~25 km/h, knocked down below */
  private struck(d: Ped, hit: { vx: number; vz: number; car: Car }) {
    const sp = Math.hypot(hit.vx, hit.vz);
    const byYou = !!this.you && this.you.driving && this.you.car === hit.car;
    this.sfx?.hit('flesh', d.p.root.position);
    if (sp > 7) {
      this.kill(d, new THREE.Vector3(hit.vx * 0.85, 1.5 + sp * 0.15, hit.vz * 0.85), 1, sp * 6, byYou);
      return;
    }
    d.hp -= sp * 6;
    d.knockT = 2.6;
    d.kvx = (hit.vx / sp) * Math.min(7, sp * 0.8);
    d.kvz = (hit.vz / sp) * Math.min(7, sp * 0.8);
    d.kdir = Math.atan2(hit.vx, hit.vz);
    this.play(d, 'idle', 0.1);
    if (byYou) {
      this.crime('hitped', d.x, d.z);
      // drivers who knock someone down get chased by the knocked down (or they run)
      d.state = this.rnd() < 0.4 ? 'angry' : 'flee';
      d.stT = 8;
    }
  }

  /** knocked down: thrown, slides, lies a moment, gets up and carries on */
  private down(d: Ped, dt: number, eye: THREE.Vector3) {
    d.knockT -= dt;
    const t = 2.6 - d.knockT;
    const nx = d.x + d.kvx * dt, nz = d.z + d.kvz * dt;
    if (!this.ground.blocked(nx, nz)) {
      d.x = nx;
      d.z = nz;
    }
    const f = Math.max(0, 1 - dt * 3.5);
    d.kvx *= f;
    d.kvz *= f;
    const down = t < 0.3 ? t / 0.3 : d.knockT < 0.6 ? Math.max(0, d.knockT / 0.6) : 1;
    const e = down * down * (3 - 2 * down);
    const h = this.ground.height(d.x, d.z);
    d.y = Number.isNaN(h) ? 0 : h;
    d.p.root.position.set(d.x, d.y + e * 0.12, d.z);
    d.p.root.rotation.set(-e * 1.45, d.kdir + Math.PI, 0, 'YXZ');
    if (d.knockT < 0.65 && d.knockT + dt >= 0.65) this.play(d, 'crouch', 0.25);
    this.animate(d, dt, eye);
    if (d.knockT <= 0) {
      d.knockT = 0;
      d.p.root.rotation.set(0, d.yaw, 0);
      if (d.hp <= 0) d.hp = 10;
      if (d.state === 'calm') this.play(d, d.home.clip, 0.3);
      else if (d.state === 'flee') this.play(d, 'run', 0.3);
      else this.play(d, 'walk', 0.3);
    }
  }

  /** can someone step from (x, z) at height y to (nx, nz) */
  private open(nx: number, nz: number, y: number): boolean {
    const h = this.ground.height(nx, nz);
    if (Number.isNaN(h) || this.ground.blocked(nx, nz) || h - y > 0.5 || h < -1.2) return false;
    return !this.cars?.blocks(nx, nz);
  }

  /** walk/run toward heading `want` (radians), steering round what's in the way; false if boxed in */
  private steer(d: Ped, want: number, speed: number, dt: number): boolean {
    let best = NaN;
    for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.5, -1.5, 2.3, -2.3, Math.PI]) {
      const a = want + off;
      if (this.open(d.x + Math.sin(a) * 0.9, d.z + Math.cos(a) * 0.9, d.y)) {
        best = a;
        break;
      }
    }
    if (Number.isNaN(best)) return false;
    let dy = best - d.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    d.yaw += dy * Math.min(1, dt * 7);
    const nx = d.x + Math.sin(d.yaw) * speed * dt, nz = d.z + Math.cos(d.yaw) * speed * dt;
    if (this.open(nx, nz, d.y)) {
      d.x = nx;
      d.z = nz;
    }
    return true;
  }

  private place(d: Ped) {
    const h = this.ground.heightSmooth(d.x, d.z);
    d.y += ((Number.isNaN(h) ? 0 : h) - d.y) * 0.5;
    d.p.root.position.set(d.x, d.y, d.z);
    d.p.root.rotation.set(0, d.yaw, 0);
  }

  private clipRate(d: Ped, speed: number) {
    const act = (d.p as unknown as { current: THREE.AnimationAction | null }).current;
    const cs = this.kit.speed.get(d.playing) ?? (d.playing === 'run' ? 5.8 : d.playing === 'jog' ? 2.8 : 1.35);
    if (act && (d.playing === 'walk' || d.playing === 'jog' || d.playing === 'run')) act.timeScale = THREE.MathUtils.clamp(speed / cs, 0.4, 1.7);
    else if (act) act.timeScale = 1;
  }

  /** back to an ordinary walker on their own lane (out of sight), or gone (a driver with nowhere to be) */
  private recycle(d: Ped) {
    if (d.rag) {
      d.rag.dispose();
      d.rag = null;
    }
    const H = d.home;
    if (H.lane === -999) {
      // a driver who lost their car: they go home
      d.p.root.removeFromParent();
      this.list.splice(this.list.indexOf(d), 1);
      return;
    }
    d.alive = true;
    d.hp = 100;
    d.state = 'calm';
    d.knockT = 0;
    d.x = H.lane === 0 ? H.x : H.lane;
    d.z = H.sit ? H.z : H.z0 + this.rnd() * (H.z1 - H.z0);
    if (H.sit) d.x = H.x;
    if (H.path) {
      d.path = H.path;
      d.s = this.rnd() * H.path.len;
      pathAt(H.path, d.s, PQ);
      d.x = PQ.x;
      d.z = PQ.z;
    }
    d.lane = H.lane;
    d.dir = H.dir;
    d.sit = H.sit;
    d.yaw = H.yaw;
    d.side = 0;
    d.playing = '';
    d.p.root.rotation.set(0, d.yaw, 0);
    this.play(d, H.clip, 0);
    const h = this.ground.height(d.x, d.z);
    d.y = Number.isNaN(h) ? 0 : h;
    d.p.root.position.set(d.x, d.y, d.z);
  }

  update(dt: number, you: THREE.Vector3, eye: THREE.Vector3 = you) {
    const Y = this.you;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.lineT -= dt;
      // the dead: lie there (the ragdoll moves them); the blood spreads; gone once nobody's looking
      if (d.state === 'dead') {
        d.deadT += dt;
        if (d.rag) {
          d.x = d.rag.head.x;
          d.z = d.rag.head.z;
        }
        if (!d.pooled && d.deadT > 1.2 && this.fx) {
          d.pooled = true;
          const pel = d.p.worldOf('Bip01_Pelvis', new THREE.Vector3());
          const h = this.ground.height(pel.x, pel.z);
          this.fx.bloodPool(pel.setY(Number.isNaN(h) ? pel.y - 0.1 : h));
        }
        if (d.deadT > 45 && Math.hypot(d.x - eye.x, d.z - eye.z) > 60) this.recycle(d);
        continue;
      }
      // a car: knocked flat (or killed) if it hits, a jump aside if it's coming
      if (this.cars && d.knockT <= 0) {
        const hit = this.cars.strike(d.x, d.z, 0.3);
        if (hit) {
          this.struck(d, hit);
          if (!d.alive) continue;
        }
      }
      if (d.knockT > 0) {
        this.down(d, dt, eye);
        continue;
      }
      // a gun pointed at them, close: hands up
      if (Y && Y.aimDir && Y.aimFrom && Y.armed && (d.state === 'calm' || d.state === 'away' || d.state === 'cower')) {
        const dx = d.x - Y.aimFrom!.x, dz = d.z - Y.aimFrom!.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 16) {
          const along = (dx * Y.aimDir!.x + dz * Y.aimDir!.z) / Math.max(1e-3, Math.hypot(Y.aimDir!.x, Y.aimDir!.z));
          const lat = Math.sqrt(Math.max(0, dist * dist - along * along));
          if (along > 0 && lat < 0.9 + dist * 0.04) {
            d.state = 'handsup';
            d.stT = 1.5;
            d.sit = false;
            d.yaw = Math.atan2(-dx, -dz);
            this.play(d, 'idle', 0.2);
            this.say(d, LINES.hands);
          }
        }
      }
      switch (d.state) {
        case 'calm':
          this.calm(d, dt, you, eye);
          continue;
        case 'handsup': {
          const aimed = !!(Y && Y.aimDir);
          d.stT = aimed ? Math.max(d.stT, 1.2) : d.stT - dt;
          if (d.stT <= 0) {
            this.scare(d, Y ? Y.pos.x : d.x, Y ? Y.pos.z : d.z, 'flee');
            break;
          }
          this.place(d);
          if (this.animate(d, dt, eye)) poseHandsUp(d.p, 1);
          continue;
        }
        case 'cower': {
          d.stT -= dt;
          if (d.stT <= 0) this.scare(d, d.tx, d.tz, 'flee');
          this.place(d);
          this.animate(d, dt, eye);
          continue;
        }
        case 'flee': {
          d.stT -= dt;
          const away = Math.atan2(d.x - d.tx, d.z - d.tz);
          if (!this.steer(d, away, 5.4, dt)) d.yaw += dt * 2;
          this.play(d, 'run', 0.2);
          this.clipRate(d, 5.4);
          if (d.stT <= 0) {
            d.state = 'away';
            this.play(d, 'walk', 0.4);
          }
          this.place(d);
          this.animate(d, dt, eye);
          continue;
        }
        case 'away': {
          // walking off; once out of sight they're back where they belong
          this.steer(d, Math.atan2(d.x - d.tx, d.z - d.tz), 1.5, dt);
          this.clipRate(d, 1.5);
          this.place(d);
          this.animate(d, dt, eye);
          if (Math.hypot(d.x - eye.x, d.z - eye.z) > 55) this.recycle(d);
          continue;
        }
        case 'angry': {
          d.stT -= dt;
          d.punchT = Math.max(0, d.punchT - dt);
          const tx = Y ? (Y.driving && Y.car ? Y.car.x : Y.pos.x) : d.x, tz = Y ? (Y.driving && Y.car ? Y.car.z : Y.pos.z) : d.z;
          const dist = Math.hypot(tx - d.x, tz - d.z);
          const reachD = Y && Y.driving && Y.car ? Y.car.halfW + 0.7 : 1.1;
          // a gun out and they think better of it
          if (Y && Y.armed && Y.aimDir && dist < 20) {
            this.scare(d, tx, tz, 'flee');
            this.say(d, LINES.hands, true);
            break;
          }
          if (dist > 35 || d.stT <= 0) {
            d.state = d.car ? 'return' : 'away';
            d.tx = tx;
            d.tz = tz;
            if (dist > 12) this.say(d, LINES.angryFoot);
            break;
          }
          if (dist > reachD) {
            const run = dist > 6;
            this.steer(d, Math.atan2(tx - d.x, tz - d.z), run ? 3.4 : 1.7, dt);
            this.play(d, run ? 'jog' : 'walk', 0.2);
            this.clipRate(d, run ? 3.4 : 1.7);
          } else {
            d.yaw += Math.atan2(Math.sin(Math.atan2(tx - d.x, tz - d.z) - d.yaw), Math.cos(Math.atan2(tx - d.x, tz - d.z) - d.yaw)) * Math.min(1, dt * 6);
            this.play(d, 'talk', 0.25);
            const act = (d.p as unknown as { current: THREE.AnimationAction | null }).current;
            if (act) act.timeScale = 1.7;
            // swing at you (on foot) or bang on the car
            if (d.punchT <= 0 && this.rnd() < dt * 0.9) {
              d.punchT = 0.55;
              setTimeout(() => {
                if (!Y || !d.alive || d.state !== 'angry') return;
                const dd = Math.hypot((Y.driving && Y.car ? Y.car.x : Y.pos.x) - d.x, (Y.driving && Y.car ? Y.car.z : Y.pos.z) - d.z);
                if (dd > reachD + 0.5) return;
                this.sfx?.hit(Y.driving ? 'metal' : 'punch', d.p.root.position);
                if (!Y.driving) Y.hurt(7, new THREE.Vector3(Math.sin(d.yaw), 0, Math.cos(d.yaw)));
              }, 200);
            }
          }
          this.say(d, Y && Y.driving ? LINES.angry : LINES.angryFoot);
          this.place(d);
          if (this.animate(d, dt, eye) && d.punchT > 0) posePunch(d.p, d.p.worldOf('Bip01_Head', new THREE.Vector3()).add(new THREE.Vector3(Math.sin(d.yaw) * 0.7, -0.15, Math.cos(d.yaw) * 0.7)), 1 - d.punchT / 0.55);
          continue;
        }
        case 'return': {
          const c = d.car;
          if (!c || !this.cars || (Y && Y.driving && Y.car === c)) {
            d.state = 'away';
            d.car = null;
            break;
          }
          const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
          const doorX = c.x + co * (c.halfW + 0.5), doorZ = c.z - s * (c.halfW + 0.5);
          const dist = Math.hypot(doorX - d.x, doorZ - d.z);
          if (dist < 0.8) {
            if (this.cars.reseat(c, d.p)) {
              this.list.splice(i, 1);
              continue;
            }
            d.state = 'away';
            break;
          }
          this.steer(d, Math.atan2(doorX - d.x, doorZ - d.z), 1.6, dt);
          this.play(d, 'walk', 0.25);
          this.clipRate(d, 1.6);
          this.place(d);
          this.animate(d, dt, eye);
          continue;
        }
      }
      this.place(d);
      this.animate(d, dt, eye);
    }
  }

  private calm(d: Ped, dt: number, you: THREE.Vector3, eye: THREE.Vector3) {
    if (d.sit) {
      this.animate(d, dt, eye);
      return;
    }
    if (d.path) {
      this.walkPath(d, d.path, dt, you, eye);
      return;
    }
    // keep to the lane, step round what blocks it
    let want = d.speed;
    const ax = d.x, az = d.z + d.dir * 0.9;
    const ahead = this.ground.blocked(ax + d.side, az) || Math.hypot(you.x - d.x, you.z - az) < 0.8 || (!!this.cars && this.cars.blocks(ax + d.side, az));
    // a car bearing down: step smartly out of its way
    const coming = this.cars?.strike(d.x, d.z, 2.2);
    if (coming) {
      const side = Math.sign((d.x - you.x) || 1);
      d.side += side * dt * 5;
      want = Math.max(want, 3);
    }
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
      // you bumped them: give way (and say so)
      d.x += Math.sign(d.x - you.x || 1) * dt * 1.5;
      if (!this.you?.driving) this.say(d, LINES.bump);
    }
    const tyaw = d.dir > 0 ? 0 : Math.PI;
    let dy = tyaw - d.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    d.yaw += dy * Math.min(1, dt * 5);
    const h = this.ground.height(d.x, d.z);
    d.y = Number.isNaN(h) ? 0 : h;
    d.p.root.position.set(d.x, d.y, d.z);
    d.p.root.rotation.set(0, d.yaw, 0);
    if (d.playing !== d.clip) this.play(d, d.clip, 0.3);
    const act = (d.p as unknown as { current: THREE.AnimationAction | null }).current;
    const cs = this.kit.speed.get(d.clip) ?? (d.clip === 'jog' ? 2.8 : 1.35);
    if (act) act.timeScale = want / cs;
    this.animate(d, dt, eye);
  }

  /** along a sidewalk line, stepping round what's in the way, turning back at its ends */
  private walkPath(d: Ped, P: Path, dt: number, you: THREE.Vector3, eye: THREE.Vector3) {
    let want = d.speed;
    pathAt(P, d.s ?? 0, PQ);
    const fx = PQ.tx * d.dir, fz = PQ.tz * d.dir;
    const ax = d.x + fx * 0.9, az = d.z + fz * 0.9;
    const ahead = this.ground.blocked(ax, az) || Math.hypot(you.x - ax, you.z - az) < 0.8 || (!!this.cars && this.cars.blocks(ax, az));
    if (ahead) {
      d.side += (d.side >= 0 ? 1 : -1) * dt * 1.6;
      if (Math.abs(d.side) > 1.3) {
        d.side = 0;
        d.dir = -d.dir;
      }
      want *= 0.5;
    } else d.side *= 1 - Math.min(1, dt * 0.6);
    d.s = (d.s ?? 0) + d.dir * want * dt;
    if (d.s > P.len) {
      d.s = P.len;
      d.dir = -1;
    } else if (d.s < 0) {
      d.s = 0;
      d.dir = 1;
    }
    pathAt(P, d.s, PQ);
    // walkers keep right of the line (two directions pass each other)
    const off = d.side + 0.5 * d.dir;
    const tx = PQ.x - PQ.tz * off, tz = PQ.z + PQ.tx * off;
    d.x += (tx - d.x) * Math.min(1, dt * 3);
    d.z += (tz - d.z) * Math.min(1, dt * 3);
    if (Math.abs(you.x - d.x) < 0.55 && Math.abs(you.z - d.z) < 0.55) {
      d.x += Math.sign(d.x - you.x || 1) * dt * 1.5;
      if (!this.you?.driving) this.say(d, LINES.bump);
    }
    const tyaw = Math.atan2(PQ.tx * d.dir, PQ.tz * d.dir);
    let dy = tyaw - d.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    d.yaw += dy * Math.min(1, dt * 5);
    const h = this.ground.height(d.x, d.z);
    d.y = Number.isNaN(h) ? 0 : h;
    d.p.root.position.set(d.x, d.y, d.z);
    d.p.root.rotation.set(0, d.yaw, 0);
    if (d.playing !== d.clip) this.play(d, d.clip, 0.3);
    const act = (d.p as unknown as { current: THREE.AnimationAction | null }).current;
    const cs = this.kit.speed.get(d.clip) ?? (d.clip === 'jog' ? 2.8 : 1.35);
    if (act) act.timeScale = want / cs;
    this.animate(d, dt, eye);
  }

  /** your fist: the nearest person in front of you within reach */
  punchAt(from: THREE.Vector3, yaw: number): Ped | null {
    let best: Ped | null = null, bd = 1.5;
    for (const d of this.list) {
      if (!d.alive) continue;
      const dx = d.x - from.x, dz = d.z - from.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bd) continue;
      const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
      if (along < 0.2) continue;
      bd = dist;
      best = d;
    }
    return best;
  }

  /** shove (a punch): knocked down if it's hard enough */
  shove(d: Ped, dir: THREE.Vector3, dmg: number) {
    d.hp -= dmg;
    if (d.hp <= 0) {
      this.kill(d, dir.clone().multiplyScalar(2), 1, 30, true);
      return;
    }
    d.knockT = 2.2;
    d.kvx = dir.x * 2.5;
    d.kvz = dir.z * 2.5;
    d.kdir = Math.atan2(dir.x, dir.z);
    d.sit = false;
    this.crime('assault', d.x, d.z);
    this.say(d, LINES.hurt, true);
    d.state = this.rnd() < 0.35 ? 'angry' : 'flee';
    d.tx = d.x - dir.x * 4;
    d.tz = d.z - dir.z * 4;
    d.stT = 10;
  }
}
