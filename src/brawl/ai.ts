import * as THREE from 'three';
import { CHE, PEL, type Fighter, type Intent } from './fighter.ts';

/**
 * A CPU fighter: picks someone, closes in, punches, grabs when they're dazed, drags them to the
 * nearest drop and throws them off; stays away from edges itself, climbs back when hanging,
 * mashes when grabbed or knocked out. It only ever presses the same buttons a player can.
 */

export interface AiWorld {
  fighters: Fighter[];
  /** solid ground under this point that isn't a hazard */
  safe(x: number, y: number, z: number): boolean;
  /** the middle of the arena (where to retreat to) */
  center: THREE.Vector3;
}

const v = new THREE.Vector3(), w = new THREE.Vector3();

export class Brain {
  target: Fighter | null = null;
  private retarget = 0;
  private think = 0;
  private plan: 'approach' | 'punch' | 'kick' | 'grab' | 'jump' | 'backoff' = 'approach';
  private planT = 0;
  private punchT = 0;
  private holdT = 0;
  private stuckT = 0;
  private mashT = 0;
  private edgeT = 0;
  private dragDir = new THREE.Vector3();

  constructor(readonly f: Fighter, readonly level = 1) {}

  update(dt: number, W: AiWorld, I: Intent) {
    const b = this.f;
    I.mx = I.mz = 0;
    I.jump = I.punch = I.kick = I.mash = I.grabL = I.grabR = I.lift = I.run = false;
    if (!b.alive || b.out) return;
    const p = b.pos[PEL];
    const react = [0.5, 0.3, 0.16][this.level];

    this.mashT -= dt;
    if ((b.ko > 0 || b.grabbedBy.size) && this.mashT <= 0) {
      I.mash = true;
      this.mashT = [0.34, 0.2, 0.12][this.level] * (0.6 + Math.random() * 0.8);
    }
    if (b.ko > 0) return;

    this.retarget -= dt;
    if (!this.target || !this.target.alive || this.target.out || this.retarget <= 0) {
      this.target = this.pick(W);
      this.retarget = 2 + Math.random() * 2.5;
    }
    const tgt = this.target;
    let mx = 0, mz = 0;
    const holding = b.hands.find((h) => h.heldFighter && h.heldFighter.alive);

    if (b.hanging()) {
      // hanging off a ledge: hold on, pull toward the middle, hop up
      I.grabL = I.grabR = true;
      v.set(W.center.x - p.x, 0, W.center.z - p.z).normalize();
      mx = v.x;
      mz = v.z;
      this.edgeT += dt;
      if (this.edgeT > 0.4) {
        I.jump = true;
        this.edgeT = 0;
      }
    } else if (holding) {
      this.holdT += dt;
      if (this.holdT < dt * 1.5) this.dragDir.copy(this.edgeDir(W, p));
      mx = this.dragDir.x;
      mz = this.dragDir.z;
      I.grabL = I.grabR = true;
      I.lift = this.holdT > 0.6;
      const near = !W.safe(p.x + mx * 1.3, p.y, p.z + mz * 1.3);
      if ((near && this.holdT > 0.9) || this.holdT > 5.5) {
        I.grabL = I.grabR = false;
        I.lift = true;
        this.holdT = 0;
        this.plan = 'backoff';
        this.planT = 0.9;
      }
      if (holding.heldFighter!.ko <= 0 && holding.heldFighter!.daze < 30 && this.holdT > 2.6) {
        I.grabL = I.grabR = false;
        this.holdT = 0;
      }
    } else if (this.plan === 'backoff' && this.planT > 0) {
      this.planT -= dt;
      v.set(W.center.x - p.x, 0, W.center.z - p.z).normalize();
      mx = v.x;
      mz = v.z;
    } else if (tgt) {
      this.holdT = 0;
      const tp = tgt.pos[CHE];
      v.set(tp.x - p.x, 0, tp.z - p.z);
      const d = v.length();
      v.normalize();
      mx = v.x;
      mz = v.z;
      I.run = d > 4;
      if (d < 1.6) {
        if (d < 0.85) {
          mx *= 0.15;
          mz *= 0.15;
        }
        this.think -= dt;
        if (this.think <= 0) {
          this.think = react * (0.7 + Math.random() * 0.8);
          const r = Math.random();
          if (tgt.ko > 0 || (tgt.daze > 55 && r < 0.6)) this.plan = 'grab';
          else if (r < 0.64) this.plan = 'punch';
          else if (r < 0.78) this.plan = 'kick';
          else if (r < 0.92) this.plan = 'grab';
          else this.plan = 'jump';
          this.planT = 0.7 + Math.random() * 0.7;
        }
        this.planT -= dt;
        if (this.plan === 'punch') {
          this.punchT -= dt;
          if (this.punchT <= 0) {
            I.punch = true;
            this.punchT = [0.5, 0.3, 0.2][this.level];
          }
        } else if (this.plan === 'kick') {
          I.kick = true;
          this.plan = 'punch';
        } else if (this.plan === 'jump') {
          I.jump = true;
          this.plan = 'punch';
        } else if (this.plan === 'grab') {
          I.grabL = I.grabR = true;
          if (this.planT < 0) this.plan = 'punch';
        }
      } else if (this.plan !== 'approach') this.plan = 'approach';
    }

    // never walk off on your own: if the way ahead isn't solid, take the solid direction closest to it
    if (!b.hanging() && (mx || mz)) {
      const m = Math.hypot(mx, mz) || 1;
      const dx = mx / m, dz = mz / m;
      const look = holding ? 0.9 : 1.3;
      if (!W.safe(p.x + dx * look, p.y, p.z + dz * look)) {
        let bx = 0, bz = 0, bs = -9;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const x = Math.sin(a), z = Math.cos(a);
          if (!W.safe(p.x + x * 1.3, p.y, p.z + z * 1.3) || !W.safe(p.x + x * 0.7, p.y, p.z + z * 0.7)) continue;
          const s = x * dx + z * dz;
          if (s > bs) {
            bs = s;
            bx = x;
            bz = z;
          }
        }
        if (bs > -9 && !holding) {
          mx = bx * 0.8;
          mz = bz * 0.8;
        } else if (!holding) {
          mx = mz = 0;
        }
        if (!holding) I.run = false;
      }
    }
    // stuck against something: hop
    const sp = Math.hypot(b.vel[PEL].x, b.vel[PEL].z);
    if (Math.hypot(mx, mz) > 0.5 && sp < 0.35 && b.grounded) this.stuckT += dt;
    else this.stuckT = 0;
    if (this.stuckT > 0.9) {
      const m2 = Math.hypot(mx, mz) || 1;
      if (W.safe(p.x + (mx / m2) * 1.2, p.y, p.z + (mz / m2) * 1.2)) I.jump = true;
      this.stuckT = 0;
    }
    const m = Math.hypot(mx, mz);
    I.mx = m > 1 ? mx / m : mx;
    I.mz = m > 1 ? mz / m : mz;
  }

  /** toward the nearest drop: the first unsafe ring sample around p */
  private edgeDir(W: AiWorld, p: THREE.Vector3) {
    for (let r = 1.5; r < 14; r += 1.5) {
      let bx = 0, bz = 0, n = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = Math.sin(a), z = Math.cos(a);
        if (!W.safe(p.x + x * r, p.y, p.z + z * r)) {
          bx += x;
          bz += z;
          n++;
        }
      }
      if (n) {
        const l = Math.hypot(bx, bz) || 1;
        return new THREE.Vector3(bx / l, 0, bz / l);
      }
    }
    return new THREE.Vector3(p.x - W.center.x, 0, p.z - W.center.z).normalize();
  }

  private pick(W: AiWorld) {
    const b = this.f, p = b.pos[PEL];
    let best: Fighter | null = null, bs = 1e9;
    for (const o of W.fighters) {
      if (o === b || !o.alive || o.out) continue;
      const q = o.pos[PEL];
      let s = Math.hypot(q.x - p.x, q.z - p.z) + Math.random() * 3;
      // someone across a gap is a poor choice
      for (let k = 1; k <= 3; k++) {
        const t = k / 4;
        if (!W.safe(p.x + (q.x - p.x) * t, p.y, p.z + (q.z - p.z) * t)) {
          s += 7;
          break;
        }
      }
      if (o.ko > 0) s -= 3;
      if (!o.cpu) s -= 0.6;
      if (s < bs) {
        bs = s;
        best = o;
      }
    }
    return best;
  }
}
