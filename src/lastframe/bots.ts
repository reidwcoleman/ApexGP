import type { Match } from './match.ts';
import { BUILD_T, CHARGE_T, F, REINF_T, SIEGE, WALL_CHARGE_T, WEAPONS, WEAPON_LIST, type NadeKind, type WeaponId } from './shared.ts';
import { siteMid } from './walls.ts';
import { move, type Mover } from './collide.ts';
import type { Node } from './nav.ts';
import { angleDiff } from './soldier.ts';
import { barPassable } from './fort.ts';
import type { Order } from './tactics.ts';

interface Vec { x: number; y: number; z: number }

const NAMES = ['Mercer', 'Dolan', 'Rook', 'Vega', 'Haas', 'Okafor', 'Reyes', 'Sato', 'Novak', 'Bishop', 'Kane', 'Ortiz', 'Lund', 'Grady', 'Tran', 'Pike'];
export const botName = (i: number) => NAMES[i % NAMES.length];

/**
 * One computer player. It sees what a person would, ten times a second; walks and aims every frame.
 *
 * Three layers, the upper ones giving way to the lower:
 *   orders    what its side's commander has it doing (tactics.ts): hold a corner, board a doorway, breach, go in, roam
 *   habits    with no orders: stay with its partner, go where the side last saw someone, or where the shooting was,
 *             or to a part of the building nobody on the side is covering; stop and hold an angle when it hears something
 *   the fight someone in its sights: shoot in bursts, sidestep or lean out of cover, get out of the line when hit or
 *             empty, throw something round the corner they went behind, and either wait for them there or go after
 *             them by another way, as its nerve has it
 * What it knows about the other side it shares: a sighting goes into its side's picture (Match.intel), and that is what
 * the others walk toward. Nobody knows where anyone is who hasn't been seen or heard.
 */
export class Bot {
  /** the map is dark: lights stay on */
  static night = false;
  m: Mover = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: true, height: 1.78, stepEase: 0 };
  yaw = 0;
  pitch = 0;
  crouch = false;
  lean = 0;
  light = false;
  ads = false;
  weapon: WeaponId = 'carbine';
  ammo = 30;
  reload = 0;
  cool = 0;
  burst = 0;
  target = -1;
  /** temperament: near 0 it sits and waits for you to come round the corner, near 1 it comes for you, and by another way */
  readonly nerve = Math.random();

  private path: Node[] = [];
  private pi = 0;
  private think = Math.random() * 0.1;
  private goalAt = 0;
  private goalNode: Node | null = null;
  private seenAt = -9;
  private seenPos: Vec = { x: 0, y: 0, z: 0 };
  private react = 0;
  private err = 0;
  private errYaw = 0;
  private errPitch = 0;
  private headShot = false;
  private strafe = 0;
  private strafeT = 0;
  private stuck = 0;
  private jams = 0;
  private jamX = 0;
  private jamZ = 0;
  private detourT = 0;
  private lastX = 0;
  private lastZ = 0;
  private heardAt = -9;
  private calledAt = -9;
  private heard: Vec = { x: 0, y: 0, z: 0 };
  private coverT = 0;
  private likesLight = Math.random() < 0.55;
  private t = 0;
  /** rounds still to put through the corner someone just went behind */
  private supp = 0;
  /** caught on a corner: a step to one side, then the other, before trying the way again */
  private nudgeT = 0;
  private nudgeS = 1;
  /** a lamp this one has decided to put out, and how many rounds it will spend trying */
  private lamp: Vec | null = null;
  private lampShots = 0;
  private lampAt = 4 + Math.random() * 20;
  /** a flash went off in its face: until then it sees nothing */
  private blindT = 0;
  private nades: Record<NadeKind, number> = { frag: 1, flash: 1 };
  private nadeAt = 6 + Math.random() * 10;
  /** who it stays with (-1: nobody) */
  private buddy = -1;
  private hurry = false;
  /** moving up on a room that is waiting for it: slowly, sights first */
  private careful = false;
  /** standing somewhere: which way it watches, and until when it keeps to that */
  private watch = 0;
  private watchT = 0;
  private greeted = false;
  private lightAt = 0;
  /** at a doorway: nailing boards up, setting a charge, putting the boot in */
  private workT = 0;
  private kickT = 0;
  /** walking backwards off something about to go off, until then */
  private backT = 0;
  private backX = 0;
  private backZ = 0;
  /** leaning out of cover: which way, and when to change */
  private leanTo = 0;
  private leanT = 0;
  /** heard something and stopped to cover it, until then */
  private holdT = 0;
  private lastOrder: Order | null = null;
  private called = false;
  /** the camera it has decided to shoot out (the lamp code does the shooting) */
  private lampCam = -1;
  private camAt = 3 + Math.random() * 5;

  constructor(private match: Match, readonly slot: number, readonly skill: number) {}

  /** a new gun in the hands, loaded */
  rearm(w: WeaponId) {
    this.weapon = w;
    this.ammo = WEAPONS[w].mag;
    this.reload = 0;
  }

  reset(x: number, y: number, z: number, yaw: number, primary: WeaponId) {
    Object.assign(this.m, { x, y, z, vx: 0, vy: 0, vz: 0, grounded: true, height: 1.78 });
    this.yaw = yaw;
    this.pitch = 0;
    this.weapon = primary;
    this.ammo = WEAPONS[primary].mag;
    this.reload = 0;
    this.target = -1;
    this.path = [];
    this.pi = 0;
    this.crouch = false;
    this.lean = 0;
    this.goalAt = 0;
    this.goalNode = null;
    this.seenAt = -9;
    this.heardAt = -9;
    this.coverT = 0;
    this.blindT = 0;
    this.backT = 0;
    this.holdT = 0;
    this.workT = 0;
    this.kickT = 0;
    this.lastOrder = null;
    // the side breaking in carries more to throw through a doorway
    this.nades = { frag: 1, flash: this.match.cfg.mode === 'siege' && !this.match.isDefender(this.slot) ? 2 : 1 };
    this.hurry = false;
    this.buddy = this.match.buddyFor(this.slot);
  }

  /** how much a long burst has opened its aim up, degrees */
  sprayErr() {
    return Math.min(1.5, this.burst * 0.17) * (1 - this.skill * 0.45);
  }

  /** a flash, k from 0 (far off, or behind it) to 1 (in its face) */
  flashed(k: number) {
    this.blindT = this.t + 1.2 + 3 * k;
    this.err = 9;
    this.react = 0.4 + 0.5 * k;
    this.errYaw = (Math.random() - 0.5) * 2;
    this.errPitch = (Math.random() - 0.5) * 2;
    if (k > 0.4) this.match.say(this.slot, pick(["Can't see!", "I'm blind!", 'Flashed!']), 0.7);
  }

  /** a shot or a footfall somewhere */
  hear(p: Vec, loud: number) {
    const d = Math.hypot(p.x - this.m.x, p.z - this.m.z);
    if (d > loud || this.target >= 0) return;
    this.heard = { x: p.x, y: p.y, z: p.z };
    this.heardAt = this.t;
    // with a job to do it looks that way and gets on with it; with none it goes to see
    const o = this.order();
    if (!o || o.kind === 'hunt') this.goalAt = 0;
  }

  hurt(from: Vec) {
    this.coverT = this.t + 1.6 + Math.random();
    // a round in the body throws the aim off: whoever lands the first one has the fight
    this.err = Math.min(8, this.err + 2.4);
    this.react = Math.max(this.react, 0.14);
    this.errYaw = (Math.random() - 0.5) * 2;
    this.errPitch = (Math.random() - 0.5) * 2;
    const hp = this.match.players.find((p) => p.slot === this.slot)?.hp ?? 100;
    // badly hit, all but the boldest break off and go to ground somewhere out of sight
    if (hp < 40 && this.nerve < 0.72) this.coverT = this.t + 3.5 + Math.random() * 2.5;
    if (hp < 60) this.match.say(this.slot, pick(["I'm hit!", 'Taking fire!', "Hit, I'm hit!", 'They got me, still up.']), 0.5);
    if (this.target < 0) {
      this.heard = { x: from.x, y: from.y, z: from.z };
      this.heardAt = this.t;
      // a bullet from nowhere: turn and face it
      this.yaw = Math.atan2(-(from.x - this.m.x), -(from.z - this.m.z)) + (Math.random() - 0.5) * 0.7;
      this.goalAt = 0;
    }
  }

  /** something thrown at a spot, if it carries one and has the line. For the commander: a flash through a doorway */
  throwAt(kind: NadeKind, at: Vec) {
    if (this.nades[kind] <= 0 || this.t < this.blindT || this.reload > 0) return false;
    if (!this.match.botNade(this, kind, at)) return false;
    this.nades[kind]--;
    this.nadeAt = this.t + 8;
    return true;
  }

  /** one off the belt, if there is one and it can see to throw */
  spend(kind: NadeKind) {
    if (this.nades[kind] <= 0 || this.t < this.blindT) return false;
    this.nades[kind]--;
    this.nadeAt = this.t + 8;
    return true;
  }

  // ---- on the floor
  /** dropped: the gun is no use, the legs are no use; it drags itself toward whoever of its side is nearest */
  wentDown() {
    this.target = -1;
    this.path = [];
    this.goalNode = null;
    this.crouch = true;
    this.ads = false;
    this.lean = 0;
    this.light = false;
    this.lamp = null;
  }
  gotUp() {
    this.crouch = false;
    this.goalAt = 0;
    this.coverT = this.t + 1.5;
    this.react = 0.5;
  }
  crawl(dt: number) {
    this.t += dt;
    const M = this.match, m = this.m;
    let wx = 0, wz = 0;
    let best = 1e9;
    for (const p of M.players) {
      if (p.slot === this.slot || !M.up(p.slot) || M.foes(this.slot, p.slot)) continue;
      const b = M.bodies[p.slot];
      const d = Math.hypot(b.x - m.x, b.z - m.z);
      if (d < best && Math.abs(b.y - m.y) < 1.5) {
        best = d;
        wx = (b.x - m.x) / (d || 1);
        wz = (b.z - m.z) / (d || 1);
      }
    }
    const sp = best < 1.6 || best > 30 ? 0 : 0.55;
    const a = Math.min(1, dt * 6);
    m.vx += (wx * sp - m.vx) * a;
    m.vz += (wz * sp - m.vz) * a;
    m.height = 0.7;
    move(M.world, m, dt);
    this.pitch = 0;
    this.lean = 0;
  }

  private order(): Order | null {
    return this.match.tactics.orderFor(this.slot);
  }

  update(dt: number, live: boolean) {
    this.t += dt;
    const M = this.match, m = this.m;
    const spec = WEAPONS[this.weapon];
    this.cool -= dt;
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) this.ammo = spec.mag;
    }
    this.think -= dt;
    if (this.think <= 0 && live) {
      this.think = 0.1;
      this.sense();
      this.decide();
    }
    // ---- walking
    let wx = 0, wz = 0, speed = 0;
    if (live) {
      const engaged = this.target >= 0 && this.t - this.seenAt < 0.4;
      if (this.t < this.backT) {
        // off the charge, backwards, quickly
        wx = this.backX;
        wz = this.backZ;
        speed = 3.6;
      } else if (this.lamp && !engaged) {
        // stood still to take the shot
      } else if (this.path.length && this.pi < this.path.length && (!engaged || this.t < this.coverT || this.weapon === 'shotgun')) {
        const n = this.path[this.pi];
        const dx = n.x - m.x, dz = n.z - m.z, d = Math.hypot(dx, dz);
        if (d < 0.55 && Math.abs(n.y - m.y) < 1.2) {
          this.pi++;
          // there: think again now, not when the clock says
          if (this.pi >= this.path.length) this.goalAt = 0;
        } else {
          wx = dx / (d || 1);
          wz = dz / (d || 1);
          if (this.t < this.nudgeT) {
            const ox = wx;
            wx = -wz * this.nudgeS * 0.9 - ox * 0.3;
            wz = ox * this.nudgeS * 0.9 - wz * 0.3;
          }
          speed = engaged ? 2.4 : this.t < this.coverT || this.hurry ? 5 : this.careful ? 2.05 : n.indoors ? 2.5 + this.skill * 0.6 : 4.2;
          M.openDoorsNear(m.x, m.y, m.z, wx, wz);
          // boards across the way: stop at them and deal with them
          const prev = this.path[this.pi - 1];
          const bar = prev ? M.barOnStep(prev.i, n.i) : -1;
          const bo = bar >= 0 ? M.openings[bar] : null;
          if (bo && Math.abs(bo.alongX ? bo.z - m.z : bo.x - m.x) < 1.2) {
            speed = 0;
            this.atBar(bar, dt, wx, wz);
          } else this.kickT = Math.max(0, this.kickT - dt);
        }
      } else if (engaged) {
        // sidestep while shooting; from a spot it has been given it leans out instead and keeps its feet where they are
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafe = Math.random() < 0.3 ? 0 : Math.random() < 0.5 ? -1 : 1;
          this.strafeT = 0.5 + Math.random() * 1.1;
        }
        const ord = this.order();
        const rooted = ord?.kind === 'hold' || ord?.kind === 'build';
        const s = rooted ? this.strafe * 0.35 : this.strafe;
        wx = Math.cos(this.yaw) * s;
        wz = -Math.sin(this.yaw) * s;
        speed = this.crouch ? 0.9 : 2;
      }
    }
    const a = Math.min(1, dt * 11);
    m.vx += (wx * speed - m.vx) * a;
    m.vz += (wz * speed - m.vz) * a;
    m.height = this.crouch ? 1.22 : 1.78;
    move(M.world, m, dt);
    // ---- turning
    if (live) this.aimAndFire(dt, wx, wz, speed);
    else this.lean += (0 - this.lean) * Math.min(1, dt * 6);
  }

  /** stopped at a barricade that is in the way */
  private atBar(bar: number, dt: number, wx: number, wz: number) {
    const M = this.match;
    if (M.chargeOn(bar)) {
      // somebody's charge is on it: not the place to stand
      this.backT = this.t + 1.3;
      this.backX = -wx;
      this.backZ = -wz;
      return;
    }
    const ord = this.order();
    if (ord?.kind === 'breach' && ord.bar === bar) return;
    this.kickT += dt;
    // its own side's boards it leaves alone as long as it can
    if (this.kickT > (M.isDefender(this.slot) ? 2.4 : 0.85)) {
      this.kickT = -0.3;
      M.barKick(this.slot, bar);
    }
  }

  private sense() {
    const M = this.match, m = this.m;
    const spec0 = WEAPONS[this.weapon];
    let best = -1, bd = 1e9;
    const eye = { x: m.x, y: m.y + (this.crouch ? 1.05 : 1.6), z: m.z };
    const team = Math.min(2, M.teamOf(this.slot));
    for (const p of M.players) {
      // nobody is fought before the round is on
      if (this.t < this.blindT || M.phase === 'prep') break;
      if (p.slot === this.slot || !p.alive || !M.foes(this.slot, p.slot)) continue;
      const b = M.bodies[p.slot];
      const dx = b.x - m.x, dz = b.z - m.z, d = Math.hypot(dx, dz);
      if (d > 58) continue;
      // inside the field of view (or near enough to feel it)
      const a = Math.abs(angleDiff(Math.atan2(-dx, -dz), this.yaw));
      if (a > 1.15 && d > 3.5 && p.slot !== this.target) continue;
      const crouch = (b.flags & F.crouch) !== 0;
      const head = { x: b.x, y: b.y + (crouch ? 1.1 : 1.6), z: b.z };
      const chest = { x: b.x, y: b.y + (crouch ? 0.7 : 1.15), z: b.z };
      if (!M.world.sees(eye, head) && !M.world.sees(eye, chest)) continue;
      const lit = (b.flags & F.light) !== 0;
      if (Bot.night) {
        // in the dark a figure is a shape at arm's length, unless something lights it: their own light, mine on them,
        // a lamp they're standing under. Moving gives them away further off than standing still, crouched least of all
        if (!lit) {
          const moving = (b.flags & F.moving) !== 0;
          let reach = crouch ? (moving ? 4.5 : 3) : (b.flags & F.sprint) ? 11 : moving ? 7.5 : 5;
          if (this.light && a < 0.42) reach = Math.max(reach, 24);
          if (M.litAt(b.x, b.y, b.z)) reach = Math.max(reach, 34);
          if (p.slot === this.target && this.t - this.seenAt < 1.5) reach *= 1.6;
          if (d > reach) continue;
        }
      } else if (!lit && d > 26 && Math.random() < 0.5) continue;
      // seen: the whole side knows where that one is now
      const known = M.intel[team].get(p.slot);
      if (p.slot !== this.target) this.called = !!known && M.elapsed - known.t < 4 && Math.hypot(known.x - b.x, known.z - b.z) < 3;
      M.intel[team].set(p.slot, { x: b.x, y: b.y, z: b.z, t: M.elapsed });
      // someone on the floor is no threat: only when nobody is standing
      const rank = p.down ? d + 60 : d;
      if (rank < bd) {
        bd = rank;
        best = p.slot;
      }
    }
    if (best >= 0) {
      if (bd >= 60) bd -= 60;
      if (best !== this.target) {
        if (this.t - this.calledAt > 2) {
          this.calledAt = this.t;
          const b = M.bodies[best];
          M.callout(this.slot, { x: b.x, y: b.y, z: b.z });
          const up = b.y - m.y;
          const room = M.cfg.mode === 'siege' && M.inObj(b.x, b.y, b.z);
          M.say(this.slot, room ? pick(['Contact in the room!', "They're on the objective!"]) : bd < 7 ? pick(['Contact, close!', 'Right here!', "He's on top of me!"]) : up > 2 ? pick(['Contact, above us!', 'Movement upstairs.']) : up < -2 ? pick(['Contact, below!', "They're under us."])
            : (b.flags & F.light) ? pick(['I see a light.', 'Torch, straight ahead.']) : pick(['Contact!', 'Got eyes on one.', 'Movement, ahead.', 'Contact front!']), 0.8);
        }
        this.react = 0.66 - this.skill * 0.5 + Math.random() * 0.22 + (bd > 25 ? 0.15 : 0);
        // already watching that way with the sights up: the shot comes sooner
        const ord = this.order();
        if (ord?.kind === 'hold' && M.inObj(m.x, m.y, m.z) && Math.abs(angleDiff(Math.atan2(-(M.bodies[best].x - m.x), -(M.bodies[best].z - m.z)), this.yaw)) < 0.35) this.react *= 0.5;
        // somebody already said where that one was: the sights were halfway there
        if (this.called) this.react *= 0.78;
        this.err = (5.5 - this.skill * 4.2) * (0.7 + Math.random() * 0.6);
        this.errYaw = (Math.random() - 0.5) * 2;
        this.errPitch = (Math.random() - 0.5) * 2;
        this.headShot = Math.random() < 0.05 + this.skill * 0.2;
        this.burst = 0;
        // some of them will shoot the wall you went behind, the way people do
        this.supp = spec0.auto && Math.random() < 0.3 + this.skill * 0.35 ? 3 + Math.floor(Math.random() * 5) : this.weapon === 'pistol' && Math.random() < 0.3 ? 2 : 0;
      }
      this.target = best;
      this.seenAt = this.t;
      const b = M.bodies[best];
      this.seenPos = { x: b.x, y: b.y, z: b.z };
      this.crouch = bd > 7 && this.weapon !== 'shotgun' ? (this.crouch || Math.random() < 0.05) : this.order()?.kind === 'hold' ? this.crouch : false;
    } else if (this.target >= 0 && this.t - this.seenAt > 3.5) {
      this.target = -1;
      this.goalAt = 0;
      if (this.order()?.kind !== 'hold') this.crouch = false;
    }
  }

  /** walk to a node, by a way that costs what the boards across it cost this side */
  private walkTo(goal: Node | null, wander = 0.4, soon = 0) {
    const M = this.match, m = this.m;
    const node = M.nav.nearest(m.x, m.y, m.z);
    if (!node || !goal) return false;
    // already on its way there: it keeps the way it chose. Planning again from every few steps on lets two ways of
    // nearly the same length take turns at being the shorter, and the walker turns round on the stairs for ever
    if (goal === this.goalNode && this.path.length && this.pi < this.path.length) {
      this.goalAt = Math.max(this.goalAt, this.t + 0.5);
      return true;
    }
    this.path = M.nav.path(node, goal, this.t < this.detourT ? 3.5 : wander, M.stepCost(this.slot));
    this.pi = 1;
    this.goalNode = goal;
    // nowhere to walk (it is there already, or there is no way): think again at once, not in five seconds
    this.goalAt = this.t + (this.path.length < 2 ? 0.4 : soon || 3 + Math.random() * 5);
    return this.path.length > 0;
  }

  private stand(until = 0.5) {
    this.path = [];
    this.goalNode = null;
    this.goalAt = this.t + until;
  }

  private decide() {
    const M = this.match, m = this.m;
    // stuck on something
    const moved = Math.hypot(m.x - this.lastX, m.z - this.lastZ);
    this.lastX = m.x;
    this.lastZ = m.z;
    if (this.path.length && this.pi < this.path.length && moved < 0.02 && (this.pi < 1 || M.barOnStep(this.path[this.pi - 1].i, this.path[this.pi].i) < 0)) {
      this.stuck++;
      if (this.stuck > 8) {
        this.stuck = 0;
        this.goalAt = 0;
        this.goalNode = null;
        // caught in the same place again and again: another way round, whatever it costs
        if (Math.hypot(m.x - this.jamX, m.z - this.jamZ) > 1.5) {
          this.jamX = m.x;
          this.jamZ = m.z;
          this.jams = 0;
        }
        if (++this.jams >= 3) {
          this.jams = 0;
          this.detourT = this.t + 8;
        }
        this.nudgeT = this.t + 0.45;
        this.nudgeS = -this.nudgeS;
        M.openDoorsNear(m.x, m.y, m.z, 0, 0);
      }
    } else this.stuck = 0;
    if (this.ammo <= 0 && this.reload <= 0) {
      this.reload = WEAPONS[this.weapon].reload;
      if (this.target >= 0) {
        // empty with someone in front of it: off the line to change the magazine
        this.coverT = Math.max(this.coverT, this.t + 1.8);
        this.goalAt = 0;
        M.say(this.slot, pick(['Reloading!', 'Changing mag!', "I'm out, cover me!"]), 0.7);
      }
    } else if (this.target < 0 && this.ammo < WEAPONS[this.weapon].mag * 0.4 && this.reload <= 0) this.reload = WEAPONS[this.weapon].reload;
    const node = M.nav.nearest(m.x, m.y, m.z);
    // in the dark map everyone needs one; in a fight half of them still keep it on
    // a torch stays as it is for a good while: one going on and off in a fight is a strobe in everyone's lens
    const ord = this.order();
    // someone holding a corner in the dark keeps its light off: the light is what gives the corner away
    const hides = ord?.kind === 'hold' && M.cfg.mode === 'siege';
    const wantLight = hides ? false : Bot.night ? this.likesLight || this.target < 0 : this.likesLight && !!node?.indoors && this.target < 0;
    if (wantLight !== this.light && this.t > this.lightAt) {
      this.light = wantLight;
      this.lightAt = this.t + 9 + Math.random() * 6;
    }
    // standing in a pool of light with nobody in sight: some of them shoot the lamp out, as people do
    if (Bot.night && this.target < 0 && !this.lamp && this.t > this.lampAt && this.ammo > 8 && (!ord || ord.kind === 'hunt' || ord.kind === 'hold')) {
      this.lampAt = this.t + 14 + Math.random() * 30;
      if (Math.random() < 0.3 + this.skill * 0.3) {
        const eye = { x: m.x, y: m.y + 1.5, z: m.z };
        for (const q of M.pools) {
          const d = Math.hypot(q[0] - m.x, q[2] - m.z);
          if (d > 6 || d < 0.8 || q[1] - m.y > 4.5 || q[1] - m.y < 1.2) continue;
          const at = { x: q[0], y: q[1] - 0.08, z: q[2] };
          if (!M.world.sees(eye, at)) continue;
          this.lamp = at;
          this.lampCam = -1;
          this.lampShots = 7;
          break;
        }
      }
    }
    // a camera on the wall, watching the way in: the side breaking in puts a round through it
    if (M.cfg.mode === 'siege' && M.phase === 'live' && !M.isDefender(this.slot) && this.target < 0 && !this.lamp && this.t > this.camAt && this.ammo > 6) {
      this.camAt = this.t + 2.5 + Math.random() * 3;
      const eye = { x: m.x, y: m.y + 1.5, z: m.z };
      for (let i = 0; i < M.cams.length; i++) {
        const c = M.cams[i];
        if (c.dead || Math.hypot(c.x - m.x, c.z - m.z) > 13 || Math.abs(c.y - m.y - 2.3) > 1.2 || !M.world.sees(eye, c) || Math.random() > 0.35 + this.skill * 0.5) continue;
        this.lamp = { x: c.x, y: c.y, z: c.z };
        this.lampCam = i;
        this.lampShots = 5;
        break;
      }
    }
    if (!node) return;
    if (ord !== this.lastOrder) {
      // new orders: drop whatever it was doing
      this.lastOrder = ord;
      this.goalAt = 0;
      this.goalNode = null;
      this.workT = 0;
      this.holdT = 0;
    }
    this.hurry = false;
    this.careful = ord?.kind === 'go' && !ord.fast && M.cfg.mode === 'siege';
    // ---- the fight comes first
    if (this.fight(node, ord)) return;
    // ---- then what it has been told
    if (ord && ord.kind !== 'hunt') {
      this.follow(ord);
      return;
    }
    // ---- then its own habits
    if (this.t < this.goalAt) return;
    this.roam(node);
  }

  /** someone seen, or just lost, or rounds coming in: what to do about it. True if that settles what it does now */
  private fight(node: Node, ord: Order | null): boolean {
    const M = this.match, m = this.m;
    if (this.t < this.coverT) {
      if (this.t < this.goalAt && this.path.length) return true;
      // break line of sight: a nearby node the threat can't see
      const threat = this.target >= 0 ? M.bodies[this.target] : this.heard;
      for (let k = 0; k < 14; k++) {
        const n = M.nav.nodes[node.i + Math.floor((Math.random() - 0.5) * 240)] ?? null;
        if (!n || Math.hypot(n.x - m.x, n.z - m.z) > 11) continue;
        // someone holding a room stays in it
        if (ord && ord.kind !== 'hunt' && ord.kind !== 'go' && M.cfg.mode === 'siege' && M.inObj(m.x, m.y, m.z) && !M.inObj(n.x, n.y, n.z)) continue;
        if (!M.world.sees({ x: n.x, y: n.y + 1.2, z: n.z }, { x: threat.x, y: threat.y + 1.3, z: threat.z })) {
          this.hurry = true;
          this.walkTo(n, 0.4, 1.2);
          return true;
        }
      }
    }
    if (this.target < 0) return false;
    const lost = this.t - this.seenAt;
    // they went round a corner: something through after them first, from the ones who carry it
    if (lost > 1 && lost < 4 && this.t > this.nadeAt && this.reload <= 0 && this.t >= this.blindT) {
      this.nadeAt = this.t + 9 + Math.random() * 14;
      const d = Math.hypot(this.seenPos.x - m.x, this.seenPos.z - m.z);
      const kind: NadeKind = this.nades.flash > 0 && (Math.random() < 0.55 || this.nades.frag <= 0) ? 'flash' : 'frag';
      if (d > 6 && d < 20 && this.nades[kind] > 0 && Math.random() < 0.2 + this.skill * 0.45 && M.botNade(this, kind, this.seenPos)) this.nades[kind]--;
    }
    if (lost <= 0.5) return true;       // in its sights: the walking code sidesteps
    // lost them. Whoever has a place to keep, keeps it, sights on where they went
    const rooted = ord && ord.kind !== 'go' && ord.kind !== 'hunt';
    if (rooted) return lost < 1.6;
    const chase = this.nerve > 0.45 || lost > 2.6 || this.weapon === 'shotgun';
    if (ord?.kind === 'go' && (lost > 2.2 || !chase)) return false;      // on its way somewhere: a look, then on
    if (chase) {
      // the bold ones don't come through the door you're watching
      this.walkTo(M.nav.nearest(this.seenPos.x, this.seenPos.y, this.seenPos.z), this.nerve > 0.75 ? 2.4 : 0.4);
      return true;
    }
    // the careful ones get low and keep their sights on the corner
    this.crouch = true;
    this.stand(0.5);
    return true;
  }

  /** doing what the commander said */
  private follow(ord: Exclude<Order, { kind: 'hunt' }>) {
    const M = this.match, m = this.m;
    const at = (n: Node, r = 0.75) => Math.hypot(n.x - m.x, n.z - m.z) < r && Math.abs(n.y - m.y) < 1.2;
    const face = (x: number, z: number, hold = 0.8) => {
      this.watch = Math.atan2(-(x - m.x), -(z - m.z));
      this.watchT = this.t + hold;
    };
    switch (ord.kind) {
      case 'hold': {
        if (!at(ord.node)) {
          this.hurry = M.phase === 'prep';
          this.walkTo(ord.node);
          return;
        }
        this.stand(0.4);
        this.crouch = !!ord.crouch;
        // eyes on what it was told to watch, with a glance to either side now and then; a noise takes the glance
        if (this.t - this.heardAt < 2.5) face(this.heard.x, this.heard.z, 0.6);
        else if (this.t > this.watchT) {
          const base = Math.atan2(-(ord.look.x - m.x), -(ord.look.z - m.z));
          this.watch = base + (Math.random() < 0.7 ? 0 : (Math.random() - 0.5) * 0.9);
          this.watchT = this.t + 1.2 + Math.random() * 2.2;
        }
        return;
      }
      case 'go': {
        if (!at(ord.node, 0.9)) {
          this.hurry = !!ord.fast;
          this.walkTo(ord.node);
          return;
        }
        this.stand(0.4);
        if (ord.look && this.t > this.watchT) face(ord.look.x, ord.look.z, 1.5);
        return;
      }
      case 'secure': {
        if (!at(ord.node, 0.9)) {
          this.hurry = true;
          this.walkTo(ord.node, 0.4, 1.5);
          return;
        }
        this.stand(0.4);
        // in the room: watch its doorways, one after another
        if (this.t > this.watchT && M.obj) {
          const d = M.openings[M.obj.doors[Math.floor(Math.random() * M.obj.doors.length)]];
          if (d) face(d.x, d.z, 1.4 + Math.random() * 1.6);
        }
        return;
      }
      case 'build': {
        const o = M.openings[ord.bar];
        if (!o || M.bars[ord.bar]) {
          this.stand(0.3);
          return;
        }
        if (!at(ord.node, 0.8)) {
          this.hurry = true;
          this.workT = 0;
          this.walkTo(ord.node, 0.2, 1.5);
          return;
        }
        this.stand(0.2);
        face(o.x, o.z, 0.5);
        if (M.tactics.holdBuild) return;
        this.workT += 0.1;
        if (this.workT >= (M.kitOf(this.slot) === 'fortifier' ? BUILD_T / 2 : BUILD_T)) {
          this.workT = M.build(this.slot, ord.bar) ? 0 : BUILD_T - 0.5;
        }
        return;
      }
      case 'revive': {
        const b = M.bodies[ord.slot];
        const pl = M.players.find((q) => q.slot === ord.slot);
        if (!pl?.alive || !pl.down) {
          this.stand(0.3);
          return;
        }
        if (Math.hypot(b.x - m.x, b.z - m.z) > 1.7 || Math.abs(b.y - m.y) > 1) {
          this.hurry = true;
          this.workT = 0;
          this.walkTo(M.nav.nearest(b.x, b.y, b.z), 0.2, 1);
          return;
        }
        this.stand(0.2);
        this.crouch = true;
        face(b.x, b.z, 0.5);
        this.workT += 0.1;
        if (this.workT >= (M.kitOf(this.slot) === 'medic' ? SIEGE.revive / 2 : SIEGE.revive)) {
          this.workT = 0;
          this.crouch = false;
          M.revive(this.slot, ord.slot);
        }
        return;
      }
      case 'sheet': {
        if (M.sheeted(ord.site) || M.holed(ord.site) || M.sheetsOf(this.slot) <= 0) {
          this.stand(0.3);
          return;
        }
        if (!at(ord.node, 0.8)) {
          this.hurry = true;
          this.workT = 0;
          this.walkTo(ord.node, 0.2, 1.5);
          return;
        }
        this.stand(0.2);
        const c = siteMid(ord.site);
        face(c.x, c.z, 0.5);
        this.workT += 0.1;
        if (this.workT >= (M.kitOf(this.slot) === 'fortifier' ? REINF_T / 2 : REINF_T)) {
          this.workT = 0;
          M.reinforce(this.slot, [ord.site.ax, ord.site.c, ord.site.u0, ord.site.u1, ord.site.y0, ord.site.y1, ord.site.t], ord.side);
        }
        return;
      }
      case 'trip': {
        const o = M.openings[ord.bar];
        if (!o || M.trips.has(ord.bar) || M.tripsOf(this.slot) <= 0) {
          this.stand(0.3);
          return;
        }
        if (!at(ord.node, 0.9)) {
          this.hurry = true;
          this.walkTo(ord.node, 0.2, 1.5);
          return;
        }
        this.stand(0.2);
        this.crouch = true;
        face(o.x, o.z, 0.5);
        this.workT += 0.1;
        if (this.workT >= 1.2) {
          this.workT = 0;
          this.crouch = false;
          M.trip(this.slot, ord.bar);
        }
        return;
      }
      case 'scope': {
        const o = M.openings[ord.bar];
        if (!o || ord.done) {
          this.stand(0.3);
          return;
        }
        if (!at(ord.node, 0.9)) {
          this.workT = 0;
          this.walkTo(ord.node, 0.2, 1.5);
          return;
        }
        this.stand(0.2);
        this.crouch = true;
        face(o.x, o.z, 0.5);
        this.workT += 0.1;
        if (this.workT >= 2.2) {
          this.workT = 0;
          this.crouch = false;
          ord.done = true;
          const n = M.scopeFrom(this.slot, ord.bar);
          M.say(this.slot, n ? pick([`Scope: ${n} in the room.`, `I count ${n} inside.`]) : pick(['Scope shows nobody.', "Can't see anyone in there."]), 0.9);
        }
        return;
      }
      case 'wbreach': {
        const c = siteMid(ord.site);
        if (M.holed(ord.site) || M.sheeted(ord.site)) {
          this.stand(0.3);
          return;
        }
        const d = Math.hypot(c.x - m.x, c.z - m.z);
        if (M.wallCharged(ord.site)) {
          // set: along the wall and away from it
          if (d < 3.6 && this.t > this.backT) {
            const ax = ord.site.ax ? Math.sign(m.x - c.x) || 1 : ord.side * 0.5, az = ord.site.ax ? ord.side * 0.5 : Math.sign(m.z - c.z) || 1;
            const l = Math.hypot(ax, az) || 1;
            this.backT = this.t + 1.3;
            this.backX = ax / l;
            this.backZ = az / l;
          }
          this.stand(0.3);
          face(c.x, c.z, 0.5);
          return;
        }
        if (!at(ord.node, 0.9)) {
          this.workT = 0;
          this.walkTo(ord.node, 0.2, 1.5);
          return;
        }
        this.stand(0.2);
        face(c.x, c.z, 0.5);
        this.workT += 0.1;
        if (this.workT >= (M.kitOf(this.slot) === 'breacher' ? WALL_CHARGE_T / 2 : WALL_CHARGE_T)) {
          this.workT = 0;
          if (M.wallCharge(this.slot, [ord.site.ax, ord.site.c, ord.site.u0, ord.site.u1, ord.site.y0, ord.site.y1, ord.site.t], ord.side)) M.say(this.slot, pick(['Going through the wall!', 'Charge on the wall. Stand clear!', 'Wall breach!']));
          else ord.failed = true;
        }
        return;
      }
      case 'breach': {
        const o = M.openings[ord.bar];
        if (!o || barPassable(M.bars[ord.bar])) {
          this.stand(0.3);
          return;
        }
        const d = Math.hypot(o.x - m.x, o.z - m.z);
        if (M.chargeOn(ord.bar)) {
          // set: get out of its way, to one side
          if (d < 3.4 && this.t > this.backT) {
            const along = o.alongX ? Math.sign(m.x - o.x) || 1 : 0, alongZ = o.alongX ? 0 : Math.sign(m.z - o.z) || 1;
            const away = o.alongX ? [along * 0.8, 0, Math.sign(m.z - o.z) * 0.6] : [Math.sign(m.x - o.x) * 0.6, 0, alongZ * 0.8];
            const l = Math.hypot(away[0], away[2]) || 1;
            this.backT = this.t + 1.2;
            this.backX = away[0] / l;
            this.backZ = away[2] / l;
          }
          this.stand(0.3);
          face(o.x, o.z, 0.5);
          return;
        }
        if (d > 1.7 || Math.abs(o.y - m.y) > 1) {
          this.workT = 0;
          this.walkTo(ord.node, 0.2, 1.5);
          return;
        }
        this.stand(0.2);
        face(o.x, o.z, 0.5);
        this.workT += 0.1;
        if (M.chargesOf(this.slot) > 0) {
          if (this.workT >= (M.kitOf(this.slot) === 'breacher' ? CHARGE_T / 2 : CHARGE_T)) {
            this.workT = 0;
            const side = o.alongX ? Math.sign(m.z - o.z) : Math.sign(m.x - o.x);
            if (M.setCharge(this.slot, ord.bar, side || 1)) M.say(this.slot, pick(['Charge set! Stand clear!', 'Fire in the hole!', 'Breaching, breaching!']));
          }
        } else if (this.workT >= 0.8) {
          this.workT = 0;
          M.barKick(this.slot, ord.bar);
        }
        return;
      }
    }
  }

  /** nobody to shoot and nothing it has been told: where next */
  private roam(node: Node) {
    const M = this.match, m = this.m;
    let goal: Node | null = null;
    let wander = 0.4, soon = 0;
    // heard something: go to where it can see the place, then stop and cover it before walking in
    if (this.t - this.heardAt < 7) {
      const d = Math.hypot(this.heard.x - m.x, this.heard.z - m.z);
      const sees = M.world.sees({ x: m.x, y: m.y + 1.5, z: m.z }, { x: this.heard.x, y: this.heard.y + 1.2, z: this.heard.z });
      if (sees && d > 5 && this.nerve < 0.7 && this.t > this.holdT + 6) this.holdT = this.t + 1.5 + (1 - this.nerve) * 2.5;
      if (this.t < this.holdT) {
        this.crouch = this.nerve < 0.45;
        this.stand(0.4);
        return;
      }
      goal = M.nav.nearest(this.heard.x, this.heard.y, this.heard.z);
      if (this.nerve > 0.75) wander = 1.6;
    }
    // the ones told off to it stay with their partner, a few steps off, watching the way the partner isn't
    if (!goal && this.buddy >= 0 && M.players.find((p) => p.slot === this.buddy)?.alive) {
      const b = M.bodies[this.buddy];
      const d = Math.hypot(b.x - m.x, b.z - m.z);
      const person = !M.players.find((p) => p.slot === this.buddy)?.bot;
      if (!this.greeted && person) {
        this.greeted = true;
        M.say(this.slot, pick(['On you.', "I'm with you.", 'Lead on, I got your back.', 'Right behind you.']), 0.8);
      }
      if (d > 4.2 || Math.abs(b.y - m.y) > 1.5) {
        goal = M.nav.nearest(b.x + (Math.random() - 0.5) * 3.5, b.y, b.z + (Math.random() - 0.5) * 3.5);
        this.hurry = d > 9;
        soon = 0.7 + Math.random() * 0.6;
      } else {
        this.stand(0.7 + Math.random() * 0.8);
        if (this.t > this.watchT) {
          this.watch = b.yaw + Math.PI * (0.55 + Math.random() * 0.9);
          this.watchT = this.t + 2 + Math.random() * 3;
          if (person && Math.random() < 0.04) M.say(this.slot, pick(['Clear this side.', 'Nothing here.', 'Quiet. Too quiet.', 'Watching our back.', 'Which way?']));
        }
        return;
      }
    }
    this.crouch = false;
    if (!goal) goal = M.objective(this.slot);
    if (!goal) return;
    this.walkTo(goal, wander, soon);
  }

  private aimAndFire(dt: number, wx: number, wz: number, speed: number) {
    const M = this.match, m = this.m;
    const spec = WEAPONS[this.weapon];
    let ty = this.yaw, tp = 0;
    const engaged = this.target >= 0 && this.t - this.seenAt < 0.8;
    const eyeY = m.y + (this.crouch ? 1.05 : 1.6);
    if (this.target >= 0) {
      const b = M.bodies[this.target];
      const px = engaged ? b.x : this.seenPos.x, pz = engaged ? b.z : this.seenPos.z, py = engaged ? b.y : this.seenPos.y;
      const crouch = (b.flags & F.crouch) !== 0;
      const aimY = py + (this.headShot ? (crouch ? 1.08 : 1.62) : crouch ? 0.72 : 1.18);
      const dx = px - m.x, dz = pz - m.z, d = Math.hypot(dx, dz) || 1;
      // someone running across the sights is harder to stay on than someone stood still
      const quick = (b.flags & F.sprint) ? 1.7 : (b.flags & F.moving) ? 0.6 : 0;
      this.err = Math.max((1.4 - this.skill * 1.2) * 0.25 + quick * (1.15 - this.skill * 0.6), this.err - dt * (2 + this.skill * 5));
      const e = (this.err * Math.PI) / 180;
      ty = Math.atan2(-dx, -dz) + this.errYaw * e;
      tp = Math.atan2(aimY - eyeY, d) + this.errPitch * e * 0.7;
    } else if (this.lamp) {
      const dx = this.lamp.x - m.x, dz = this.lamp.z - m.z;
      ty = Math.atan2(-dx, -dz);
      tp = Math.atan2(this.lamp.y - (m.y + 1.5), Math.hypot(dx, dz) || 1);
    } else if (speed > 0.1 && this.t >= this.backT) {
      // eyes on where the way leads: the doorway two steps on, not the floor in front
      const far = this.path[Math.min(this.path.length - 1, this.pi + 2)];
      const fx = far ? far.x - m.x : 0, fz = far ? far.z - m.z : 0;
      const ahead = far && Math.hypot(fx, fz) > 1.2 && fx * wx + fz * wz > 0;
      ty = ahead ? Math.atan2(-fx, -fz) : Math.atan2(-wx, -wz);
      tp = far && ahead ? clamp(Math.atan2(far.y - m.y, Math.hypot(fx, fz)), -0.5, 0.5) : 0;
    } else if (this.t < this.watchT) ty = this.watch;
    else if (this.t - this.heardAt < 4) ty = Math.atan2(-(this.heard.x - m.x), -(this.heard.z - m.z));
    const rate = engaged ? 2.6 + this.skill * 7 : 3.4;
    const dy = angleDiff(ty, this.yaw);
    this.yaw += Math.sign(dy) * Math.min(Math.abs(dy), rate * dt);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * rate * 1.3);
    // sights up in a fight, and when holding an angle
    const holding = this.order()?.kind === 'hold' && speed < 0.2;
    this.ads = engaged || (holding && M.cfg.mode === 'siege');
    // from a corner it leans out to shoot and comes back in between bursts
    this.leanT -= dt;
    if (engaged && speed < 0.4 && this.target >= 0 && Math.hypot(M.bodies[this.target].x - m.x, M.bodies[this.target].z - m.z) > 4) {
      if (this.leanT <= 0) {
        this.leanTo = Math.random() < 0.35 ? 0 : Math.random() < 0.5 ? -1 : 1;
        this.leanT = 0.9 + Math.random() * 1.6;
      }
    } else this.leanTo = 0;
    this.lean += (this.leanTo - this.lean) * Math.min(1, dt * 7);
    if (this.lamp && (this.target >= 0 || this.lampShots <= 0 || (this.lampCam >= 0 ? M.cams[this.lampCam]?.dead !== false : !M.pools.some((q) => Math.abs(q[0] - this.lamp!.x) < 0.01 && Math.abs(q[2] - this.lamp!.z) < 0.01)))) {
      this.lamp = null;
      this.lampCam = -1;
    }
    if (this.lamp && this.cool <= 0 && this.reload <= 0 && Math.abs(dy) < 0.03 && Math.abs(tp - this.pitch) < 0.03) {
      this.lampShots--;
      this.ammo--;
      this.cool = 0.32 + Math.random() * 0.3;
      M.botFire(this, WEAPON_LIST.indexOf(this.weapon));
    }
    if (!engaged) {
      this.burst = 0;
      // lost them a moment ago: a few rounds at where they were. Thin walls, and boards, don't stop those
      const since = this.t - this.seenAt;
      if (this.target >= 0 && this.supp > 0 && since > 0.8 && since < 2.4 && this.cool <= 0 && this.reload <= 0 && this.ammo > 2 && Math.abs(dy) < 0.12) {
        const d = Math.hypot(this.seenPos.x - m.x, this.seenPos.z - m.z);
        if (d > 3 && d < 40) {
          this.supp--;
          this.ammo--;
          this.cool = spec.cycle * (spec.auto ? 1.6 : 2.2);
          M.botFire(this, WEAPON_LIST.indexOf(this.weapon));
        } else this.supp = 0;
      }
      return;
    }
    this.react -= dt;
    if (this.react > 0 || this.reload > 0 || this.cool > 0 || this.ammo <= 0) return;
    if (Math.abs(dy) > 0.09) return;
    const dd = Math.hypot(M.bodies[this.target].x - m.x, M.bodies[this.target].z - m.z);
    if (this.weapon === 'shotgun' && dd > 22) return;
    this.ammo--;
    this.burst++;
    this.cool = spec.cycle * (spec.auto ? 1 : 1.25);
    // short bursts at range, longer close in: the pattern climbs, and they know it
    const len = dd > 18 ? 2 + Math.floor(this.skill * 2 + Math.random() * 2) : 3 + Math.floor(this.skill * 5 + Math.random() * 3);
    if (spec.auto && this.burst >= len) {
      this.burst = 0;
      this.cool = 0.25 + Math.random() * 0.45 - this.skill * 0.15;
    }
    M.botFire(this, WEAPON_LIST.indexOf(this.weapon));
  }
}

function pick<T>(a: T[]): T {
  return a[Math.floor(Math.random() * a.length)];
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}
