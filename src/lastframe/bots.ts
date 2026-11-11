import type { Match } from './match.ts';
import { F, WEAPONS, WEAPON_LIST, type WeaponId } from './shared.ts';
import { move, type Mover } from './collide.ts';
import type { Node } from './nav.ts';
import { angleDiff } from './soldier.ts';

interface Vec { x: number; y: number; z: number }

const NAMES = ['Mercer', 'Dolan', 'Rook', 'Vega', 'Haas', 'Okafor', 'Reyes', 'Sato', 'Novak', 'Bishop', 'Kane', 'Ortiz', 'Lund', 'Grady', 'Tran', 'Pike'];
export const botName = (i: number) => NAMES[i % NAMES.length];

/** One computer player. Thinks ten times a second, walks and aims every frame, sees what a person would. */
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
  private path: Node[] = [];
  private pi = 0;
  private think = Math.random() * 0.1;
  private goalAt = 0;
  target = -1;
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
  private lastX = 0;
  private lastZ = 0;
  private heardAt = -9;
  private calledAt = -9;
  private heard: Vec = { x: 0, y: 0, z: 0 };
  private coverT = 0;
  private likesLight = Math.random() < 0.55;
  private t = 0;
  private pending = false;
  /** rounds still to put through the corner someone just went behind */
  private supp = 0;
  /** caught on a corner: a step to one side, then the other, before trying the way again */
  private nudgeT = 0;
  private nudgeS = 1;
  /** a lamp this one has decided to put out, and how many rounds it will spend trying */
  private lamp: Vec | null = null;
  private lampShots = 0;
  private lampAt = 4 + Math.random() * 20;

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
    this.goalAt = 0;
    this.seenAt = -9;
    this.coverT = 0;
  }

  /** a shot or a footfall somewhere */
  hear(p: Vec, loud: number) {
    const d = Math.hypot(p.x - this.m.x, p.z - this.m.z);
    if (d > loud || this.target >= 0) return;
    this.heard = { x: p.x, y: p.y, z: p.z };
    this.heardAt = this.t;
    this.goalAt = 0;
  }

  hurt(from: Vec) {
    this.coverT = this.t + 1.6 + Math.random();
    if (this.target < 0) {
      this.heard = { x: from.x, y: from.y, z: from.z };
      this.heardAt = this.t;
      // a bullet from nowhere: turn and face it
      this.yaw = Math.atan2(-(from.x - this.m.x), -(from.z - this.m.z)) + (Math.random() - 0.5) * 0.7;
      this.goalAt = 0;
    }
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
      this.plan();
    }
    // ---- walking
    let wx = 0, wz = 0, speed = 0;
    if (live) {
      const engaged = this.target >= 0 && this.t - this.seenAt < 0.4;
      if (this.lamp && !engaged) {
        // stood still to take the shot
      } else if (this.path.length && this.pi < this.path.length && (!engaged || this.t < this.coverT || this.weapon === 'shotgun')) {
        const n = this.path[this.pi];
        const dx = n.x - m.x, dz = n.z - m.z, d = Math.hypot(dx, dz);
        if (d < 0.55 && Math.abs(n.y - m.y) < 1.2) {
          this.pi++;
          // there: think again now, not when the clock says
          if (this.pi >= this.path.length) this.goalAt = 0;
        }
        else {
          wx = dx / (d || 1);
          wz = dz / (d || 1);
          if (this.t < this.nudgeT) {
            const ox = wx;
            wx = -wz * this.nudgeS * 0.9 - ox * 0.3;
            wz = ox * this.nudgeS * 0.9 - wz * 0.3;
          }
          const indoors = n.indoors;
          speed = engaged ? 2.4 : this.t < this.coverT ? 5 : indoors ? 2.5 + this.skill * 0.6 : 4.2;
          M.openDoorsNear(m.x, m.y, m.z, wx, wz);
        }
      } else if (engaged) {
        // sidestep while shooting
        this.strafeT -= dt;
        if (this.strafeT <= 0) {
          this.strafe = Math.random() < 0.3 ? 0 : Math.random() < 0.5 ? -1 : 1;
          this.strafeT = 0.5 + Math.random() * 1.1;
        }
        const s = this.strafe;
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
  }

  private sense() {
    const M = this.match, m = this.m;
    const spec0 = WEAPONS[this.weapon];
    let best = -1, bd = 1e9;
    const eye = { x: m.x, y: m.y + (this.crouch ? 1.05 : 1.6), z: m.z };
    for (const p of M.players) {
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
      if (d < bd) {
        bd = d;
        best = p.slot;
      }
    }
    if (best >= 0) {
      if (best !== this.target) {
        if (this.t - this.calledAt > 2) {
          this.calledAt = this.t;
          const b = M.bodies[best];
          M.callout(this.slot, { x: b.x, y: b.y, z: b.z });
        }
        this.react = 0.68 - this.skill * 0.5 + Math.random() * 0.22 + (bd > 25 ? 0.15 : 0);
        this.err = (5.5 - this.skill * 4.2) * (0.7 + Math.random() * 0.6);
        this.errYaw = (Math.random() - 0.5) * 2;
        this.errPitch = (Math.random() - 0.5) * 2;
        this.headShot = Math.random() < 0.08 + this.skill * 0.3;
        this.burst = 0;
        // some of them will shoot the wall you went behind, the way people do
        this.supp = spec0.auto && Math.random() < 0.3 + this.skill * 0.35 ? 3 + Math.floor(Math.random() * 5) : this.weapon === 'pistol' && Math.random() < 0.3 ? 2 : 0;
      }
      this.target = best;
      this.seenAt = this.t;
      const b = M.bodies[best];
      this.seenPos = { x: b.x, y: b.y, z: b.z };
      this.crouch = bd > 7 && this.weapon !== 'shotgun' ? (this.crouch || Math.random() < 0.05) : false;
    } else if (this.target >= 0 && this.t - this.seenAt > 3.5) {
      this.target = -1;
      this.goalAt = 0;
      this.crouch = false;
    }
  }

  private plan() {
    const M = this.match, m = this.m;
    // stuck on something
    const moved = Math.hypot(m.x - this.lastX, m.z - this.lastZ);
    this.lastX = m.x;
    this.lastZ = m.z;
    if (this.path.length && this.pi < this.path.length && moved < 0.02) {
      this.stuck++;
      if (this.stuck > 8) {
        this.stuck = 0;
        this.goalAt = 0;
        this.nudgeT = this.t + 0.45;
        this.nudgeS = -this.nudgeS;
        M.openDoorsNear(m.x, m.y, m.z, 0, 0);
      }
    } else this.stuck = 0;
    if (this.ammo <= 0 && this.reload <= 0) this.reload = WEAPONS[this.weapon].reload;
    else if (this.target < 0 && this.ammo < WEAPONS[this.weapon].mag * 0.4 && this.reload <= 0) this.reload = WEAPONS[this.weapon].reload;
    const node = M.nav.nearest(m.x, m.y, m.z);
    // in the dark map everyone needs one; in a fight half of them still keep it on
    this.light = Bot.night ? this.likesLight || this.target < 0 : this.likesLight && !!node?.indoors && this.target < 0;
    // standing in a pool of light with nobody in sight: some of them shoot the lamp out, as people do
    if (Bot.night && this.target < 0 && !this.lamp && this.t > this.lampAt && this.ammo > 8) {
      this.lampAt = this.t + 14 + Math.random() * 30;
      if (Math.random() < 0.3 + this.skill * 0.3) {
        const eye = { x: m.x, y: m.y + 1.5, z: m.z };
        for (const q of M.pools) {
          const d = Math.hypot(q[0] - m.x, q[2] - m.z);
          if (d > 6 || d < 0.8 || q[1] - m.y > 4.5 || q[1] - m.y < 1.2) continue;
          const at = { x: q[0], y: q[1] - 0.08, z: q[2] };
          if (!M.world.sees(eye, at)) continue;
          this.lamp = at;
          this.lampShots = 7;
          break;
        }
      }
    }
    if (this.t < this.goalAt || this.pending) return;
    if (!node) return;
    let goal: Node | null = null;
    if (this.t < this.coverT) {
      // break line of sight: a nearby node the threat can't see
      const threat = this.target >= 0 ? M.bodies[this.target] : this.heard;
      for (let k = 0; k < 14; k++) {
        const n = M.nav.nodes[node.i + Math.floor((Math.random() - 0.5) * 240)] ?? null;
        if (!n || Math.hypot(n.x - m.x, n.z - m.z) > 11) continue;
        if (!M.world.sees({ x: n.x, y: n.y + 1.2, z: n.z }, { x: threat.x, y: threat.y + 1.3, z: threat.z })) {
          goal = n;
          break;
        }
      }
    }
    if (!goal && this.target >= 0 && this.t - this.seenAt > 0.5) goal = M.nav.nearest(this.seenPos.x, this.seenPos.y, this.seenPos.z);
    if (!goal && this.t - this.heardAt < 7) goal = M.nav.nearest(this.heard.x, this.heard.y, this.heard.z);
    if (!goal) goal = M.objective(this.slot);
    if (!goal) return;
    this.path = M.nav.path(node, goal, 0.4);
    this.pi = 1;
    this.goalAt = this.t + 3 + Math.random() * 5;
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
      this.err = Math.max((1.4 - this.skill * 1.2) * 0.25, this.err - dt * (2 + this.skill * 5));
      const e = (this.err * Math.PI) / 180;
      ty = Math.atan2(-dx, -dz) + this.errYaw * e;
      tp = Math.atan2(aimY - eyeY, d) + this.errPitch * e * 0.7;
    } else if (this.lamp) {
      const dx = this.lamp.x - m.x, dz = this.lamp.z - m.z;
      ty = Math.atan2(-dx, -dz);
      tp = Math.atan2(this.lamp.y - (m.y + 1.5), Math.hypot(dx, dz) || 1);
    } else if (speed > 0.1) {
      // eyes on where the way leads: the doorway two steps on, not the floor in front
      const far = this.path[Math.min(this.path.length - 1, this.pi + 2)];
      const fx = far ? far.x - m.x : 0, fz = far ? far.z - m.z : 0;
      const ahead = far && Math.hypot(fx, fz) > 1.2 && fx * wx + fz * wz > 0;
      ty = ahead ? Math.atan2(-fx, -fz) : Math.atan2(-wx, -wz);
      tp = far && ahead ? clamp(Math.atan2(far.y - m.y, Math.hypot(fx, fz)), -0.5, 0.5) : 0;
    } else if (this.t - this.heardAt < 4) {
      ty = Math.atan2(-(this.heard.x - m.x), -(this.heard.z - m.z));
    }
    const rate = engaged ? 2.6 + this.skill * 7 : 3.4;
    const dy = angleDiff(ty, this.yaw);
    this.yaw += Math.sign(dy) * Math.min(Math.abs(dy), rate * dt);
    this.pitch += (tp - this.pitch) * Math.min(1, dt * rate * 1.3);
    this.ads = engaged;
    if (this.lamp && (this.target >= 0 || this.lampShots <= 0 || !M.pools.some((q) => Math.abs(q[0] - this.lamp!.x) < 0.01 && Math.abs(q[2] - this.lamp!.z) < 0.01))) this.lamp = null;
    if (this.lamp && this.cool <= 0 && this.reload <= 0 && Math.abs(dy) < 0.03 && Math.abs(tp - this.pitch) < 0.03) {
      this.lampShots--;
      this.ammo--;
      this.cool = 0.32 + Math.random() * 0.3;
      M.botFire(this, WEAPON_LIST.indexOf(this.weapon));
    }
    if (!engaged) {
      // lost them a moment ago: a few rounds at where they were. Thin walls don't stop those
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
    const pause = spec.auto && this.burst >= 3 + Math.floor(this.skill * 5 + Math.random() * 3);
    if (pause) {
      this.burst = 0;
      this.cool = 0.25 + Math.random() * 0.45 - this.skill * 0.15;
    }
    M.botFire(this, WEAPON_LIST.indexOf(this.weapon));
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}
