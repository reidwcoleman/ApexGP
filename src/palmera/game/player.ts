// Player control on foot and in vehicles, plus the third-person / chase camera.
import * as THREE from 'three';
import { clamp, damp, lerp, wrapAngle } from '../core/math';
import type { Vehicle } from '../entities/vehicle';
import { WATER_Y, groundAt, groundBase } from '../world/map';
import type { Game } from './game';
import { WEAPONS, WEAPON_ORDER } from './weapons';

/** an invisible stand-in for a car's glass, seen from inside in first person */
const NO_GLASS = new THREE.MeshBasicMaterial({ visible: false });

export const TUNING = {
  runSpeed: 5.0,
  sprintSpeed: 7.6,
  aimWalkSpeed: 2.6,
  swimSpeed: 2.2,
  groundAccel: 32,
  airAccel: 5,
  jumpVel: 5.6,
  gravity: 15,
  mouseSens: 0.0024,
  fovFoot: 62,
  fovAim: 46,
  fovCarMax: 80,
  camDistFoot: 4.3,
  camDistAim: 1.9,
  punchDamage: 20,
  punchCooldown: 0.45,
  punchRange: 1.5,
  enterRange: 4.2,
  healthRegenDelay: 6,
  healthRegenRate: 2,
};

export class PlayerController {
  camYaw = Math.PI;
  camPitch = 0.22;
  aiming = false;
  aimW = 0;
  private camDist = TUNING.camDistFoot;
  mouseIdle = 10;
  /** first-person view (N) */
  fp = false;
  private headV = new THREE.Vector3();
  private clearGlass: Vehicle | null = null;
  private savedGlass: THREE.Material | null = null;
  private punchCd = 0;
  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private v = new THREE.Vector3();
  aimPoint = new THREE.Vector3();
  enterTarget: Vehicle | null = null;
  private enterT = 0;
  fov = TUNING.fovFoot;
  lastDamage = 0;

  constructor(private game: Game) {}

  /** mouse look (also while flying, when the rest of update is skipped) */
  look(dt: number) {
    const inp = this.game.input;
    if (inp.mouseDX || inp.mouseDY) this.mouseIdle = 0;
    else this.mouseIdle += dt;
    const sens = TUNING.mouseSens * (this.aiming ? 0.6 : 1);
    this.camYaw -= inp.mouseDX * sens;
    this.camPitch = clamp(this.camPitch + inp.mouseDY * sens, -0.65, 1.1);
  }

  update(dt: number) {
    const g = this.game;
    const inp = g.input;
    const p = g.player;
    this.look(dt);
    if (g.input.hit('KeyN') && !g.chopper?.flying) {
      this.fp = !this.fp;
      g.hud.toast(this.fp ? 'First-person view · N to switch back' : 'Third-person view');
    }
    if (p.dead) {
      g.setDesired(p, 0, 0);
      return;
    }
    if (p.vehicle) this.drive(dt, p.vehicle);
    else if (g.shop.open) g.setDesired(p, 0, 0);
    else this.onFoot(dt);
    // health regeneration
    if (g.elapsed - this.lastDamage > TUNING.healthRegenDelay && p.health < p.maxHealth && !p.dead) p.health = Math.min(p.maxHealth, p.health + TUNING.healthRegenRate * dt);
  }

  /** the wall (or car) you're crouched behind: its normal points out toward you */
  private cover: { nx: number; nz: number; car: import('../entities/vehicle').Vehicle | null } | null = null;
  private coverScanT = 0;
  private coverHint = false;
  private coverW = 0;

  /** the nearest thing to hide behind within reach: a wall (ray) or a vehicle */
  private findCover(p: { pos: THREE.Vector3 }, reach: number) {
    const g = this.game;
    let best: { d: number; nx: number; nz: number; car: import('../entities/vehicle').Vehicle | null } | null = null;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      const hit = g.map.colliders.raycast(p.pos.x, p.pos.y + 0.9, p.pos.z, dx, 0, dz, reach);
      if (hit && (!best || hit.t < best.d)) best = { d: hit.t, nx: -dx, nz: -dz, car: null };
    }
    for (const v of g.vehicles) {
      if (v.isBoat || v.driver === 'player') continue;
      const ox = v.pos.x - p.pos.x, oz = v.pos.z - p.pos.z, d = Math.hypot(ox, oz);
      const surf = d - Math.min(v.spec.wid, v.spec.len) * 0.6;
      if (d < 0.01 || surf > reach) continue;
      if (!best || surf < best.d) best = { d: Math.max(0, surf), nx: -ox / d, nz: -oz / d, car: v };
    }
    return best;
  }

  private leaveCover() {
    this.cover = null;
    this.game.player.inCover = false;
  }

  private onFoot(dt: number) {
    const g = this.game;
    const inp = g.input;
    const p = g.player;
    if (this.vault) {
      this.stepVault(dt);
      return;
    }
    if (this.enterT > 0) {
      // walking to the door
      this.enterT -= dt;
      const v = this.enterTarget!;
      const door = v.doorPos(this.v);
      const dx = door.x - p.pos.x, dz = door.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.6 && this.enterT > 0) g.setDesired(p, (dx / d) * 5, (dz / d) * 5);
      else {
        this.enterT = 0;
        g.enterVehicle(v);
      }
      if (p.down > 0 || v.wrecked) this.enterT = 0;
      return;
    }
    if (p.down > 0) {
      p.down -= dt;
      g.setDesired(p, 0, 0);
      return;
    }
    const fw = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
    const st = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    // cover: X to get down behind the nearest wall or car (when there's a fight on), X again to leave
    const fight = g.wanted.level > 0 || p.weapon !== 'fist';
    this.coverScanT -= dt;
    if (!this.cover && fight && this.coverScanT <= 0 && !p.swimming) {
      this.coverScanT = 0.25;
      this.coverHint = !!this.findCover(p, 1.8);
    }
    if (!this.cover && this.coverHint && fight) g.hud.prompt('<kbd>X</kbd> Take cover');
    if (inp.hit('KeyX') && !p.swimming) {
      if (this.cover) this.leaveCover();
      else {
        const c = this.findCover(p, 2.2);
        if (c) {
          this.cover = { nx: c.nx, nz: c.nz, car: c.car };
          p.inCover = true;
          // back up against it
          const gap = Math.max(0, c.d - 0.45);
          p.pos.x -= c.nx * gap;
          p.pos.z -= c.nz * gap;
          p.vx = p.vz = 0;
        }
      }
    }
    if (this.cover) {
      const c = this.cover;
      const run = p.sprint || inp.hit('Space') || p.down > 0 || (c.car && (c.car.speed > 1.5 || c.car.driver === 'player'));
      // pull away from it (S relative to the wall) and you're out
      const sx0 = Math.sin(this.camYaw), sz0 = Math.cos(this.camYaw);
      const away = (sx0 * fw) * c.nx + (sz0 * fw) * c.nz;
      if (run || away > 0.6) this.leaveCover();
    }
    this.aimW = damp(this.aimW, this.aiming ? 1 : 0, 14, dt);
    p.aim = p.weapon !== 'fist' ? this.aimW : 0;
    p.aimPitch = -this.camPitch * 0.9 + 0.05;
    const sx = Math.sin(this.camYaw), sz = Math.cos(this.camYaw);
    const rx = -sz, rz = sx;
    let mx = sx * fw + rx * st, mz = sz * fw + rz * st;
    if (this.cover) {
      // in cover you slide along it (A/D relative to the camera), and stop at its edge
      const tx = -this.cover.nz, tz = this.cover.nx;
      const side = (rx * tx + rz * tz) >= 0 ? st : -st;
      mx = tx * side;
      mz = tz * side;
      if (side !== 0 && !this.cover.car) {
        const ahead = g.map.colliders.raycast(p.pos.x + tx * side * 0.5, p.pos.y + 0.9, p.pos.z + tz * side * 0.5, -this.cover.nx, 0, -this.cover.nz, 1.0);
        if (!ahead) mx = mz = 0;
      }
    }
    const ml = Math.hypot(mx, mz);
    p.sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    let speed = p.swimming ? TUNING.swimSpeed : this.cover ? 1.7 : this.aiming ? TUNING.aimWalkSpeed : p.sprint ? TUNING.sprintSpeed : TUNING.runSpeed;
    if (ml > 0) {
      mx /= ml;
      mz /= ml;
    } else speed = 0;
    g.setDesired(p, mx * speed, mz * speed);
    // facing (in first person you always face where you look, and move relative to it)
    if (this.fp && !this.cover) p.yaw = this.camYaw;
    if (this.aiming || (p.weapon !== 'fist' && inp.fire)) p.yaw = this.camYaw;
    else if (this.cover) p.yaw += wrapAngle(Math.atan2(-this.cover.nx, -this.cover.nz) + Math.PI - p.yaw) * clamp(10 * dt, 0, 1);
    else if (ml > 0 && !this.fp) p.yaw += wrapAngle(Math.atan2(mx, mz) - p.yaw) * clamp(12 * dt, 0, 1);
    // jump
    if (inp.hit('Space') && p.onGround && !p.swimming && !p.inCover && !this.tryVault()) {
      p.vy = TUNING.jumpVel;
      p.onGround = false;
      g.audio.whoosh();
    }
    // weapons
    if (inp.hit('KeyQ') || inp.wheel < 0) g.weapons.cycle(-1);
    if (inp.hit('KeyE') || inp.wheel > 0) g.weapons.cycle(1);
    for (let k = 0; k < WEAPON_ORDER.length; k++) if (inp.hit('Digit' + (k + 1))) g.weapons.select(WEAPON_ORDER[k]);
    if (inp.hit('KeyR')) g.weapons.reload();
    this.punchCd -= dt;
    if (!p.swimming) {
      if (p.weapon === 'fist' || p.weapon === 'bat') {
        if ((inp.lmbPressed || inp.hit('Mouse0')) && this.punchCd <= 0) this.punch();
      } else {
        const auto = WEAPONS[p.weapon].auto;
        const want = auto ? inp.fire : inp.lmbPressed || inp.hit('Mouse0');
        if (want) {
          this.computeAimPoint();
          if (g.weapons.playerFire(this.aimPoint, this.aiming)) p.yaw = this.camYaw;
        }
      }
    }
    // enter vehicle
    const near = g.nearestVehicle(p.pos, TUNING.enterRange);
    if (near && !p.swimming) {
      g.hud.prompt(`<kbd>F</kbd> ${near.driver === 'npc' ? 'Steal' : 'Enter'} ${near.spec.label}`);
      if (inp.hit('KeyF')) {
        this.enterTarget = near;
        this.enterT = 1.2;
        if (near.driver === 'npc') g.ejectDriver(near, false);
      }
    } else if (p.swimming) {
      const near2 = g.nearestVehicle(p.pos, 5.5);
      if (near2 && near2.isBoat) {
        g.hud.prompt(`<kbd>F</kbd> Climb aboard`);
        if (inp.hit('KeyF')) g.enterVehicle(near2);
      }
    }
  }

  private punch() {
    const g = this.game;
    const p = g.player;
    this.punchCd = TUNING.punchCooldown;
    p.punchT = 0.38;
    g.audio.whoosh();
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    let best: (typeof g.humans)[number] | null = null, bd = TUNING.punchRange + 0.3;
    for (const h of g.humans) {
      if (h === p || h.vehicle || h.dead || h.hidden) continue;
      const dx = h.pos.x - p.pos.x, dz = h.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01 || Math.abs(h.pos.y - p.pos.y) > 1.2) continue;
      if ((dx * fx + dz * fz) / d < 0.45) continue;
      best = h;
      bd = d;
    }
    if (best) {
      const bat = p.weapon === 'bat';
      const knock = (p.sprint ? 7 : 3) + (bat ? 3 : 0);
      const killed = best.hurt(TUNING.punchDamage * (bat ? 2.4 : 1), p.pos.x, p.pos.z, knock);
      g.audio.punch();
      g.onHumanHurt(best, p, killed, 'punch');
      g.hud.hitT = 0.15;
      return;
    }
    const v = g.nearestVehicle(p.pos.clone().add(new THREE.Vector3(fx * 1.2, 0, fz * 1.2)), 1.6);
    if (v) {
      v.damage(p.weapon === 'bat' ? 30 : 4);
      g.audio.punch();
      if (v.police) g.onVehicleAttacked(v);
    }
  }

  /** an arc from where you stand, over the obstacle, to the ground beyond it */
  private vault: { t: number; dur: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; top: number; fx: number; fz: number; sp: number } | null = null;

  /**
   * Space in front of something low and thin (a bench, planter, low wall, railing, a parked car)
   * vaults over it instead of jumping into it. Checks the far side is clear ground.
   */
  private tryVault(): boolean {
    const g = this.game;
    const p = g.player;
    const map = g.map.colliders;
    // the way you're moving, else the way you face
    const hs = Math.hypot(p.vx, p.vz);
    const fx = hs > 1 ? p.vx / hs : Math.sin(p.yaw), fz = hs > 1 ? p.vz / hs : Math.cos(p.yaw);
    let top = 0, exit = 0, car = false;
    // a parked or slow car just ahead: slide across it (only across, never along its length)
    const ahead = new THREE.Vector3(p.pos.x + fx * 1.6, p.pos.y, p.pos.z + fz * 1.6);
    const v = g.nearestVehicle(ahead, 1.2);
    if (v && !v.isBoat && v.speed < 3 && v.spec.hgt < 1.9) {
      const c = Math.cos(v.heading), s = Math.sin(v.heading);
      const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      const ux = fx * c - fz * s, uz = fx * s + fz * c;
      const hw = v.spec.wid / 2 + 0.1, hl = v.spec.len / 2 + 0.1;
      const slab = (o: number, d: number, h: number): [number, number] => (Math.abs(d) < 1e-6 ? (Math.abs(o) < h ? [-1e9, 1e9] : [1e9, -1e9]) : [Math.min((-h - o) / d, (h - o) / d), Math.max((-h - o) / d, (h - o) / d)]);
      const [ax0, ax1] = slab(lx, ux, hw), [az0, az1] = slab(lz, uz, hl);
      const t0 = Math.max(ax0, az0), t1 = Math.min(ax1, az1);
      if (t0 < t1 && t0 > -0.3 && t0 < 2.6 && t1 - Math.max(0, t0) < 3.2) {
        exit = t1;
        // over the bonnet or boot it's lower than over the roof
        const mid = lz + uz * (t0 + t1) / 2;
        top = v.pos.y + v.spec.hgt * (Math.abs(mid) > v.spec.len * 0.22 ? 0.62 : 1.0);
        car = true;
      }
    }
    if (!car) {
      const hit = map.raycast(p.pos.x, p.pos.y + 0.45, p.pos.z, fx, 0, fz, 2.2);
      const b = hit?.box;
      if (!hit || !b) return false;
      const rise = b.y1 - p.pos.y;
      if (rise < 0.3 || rise > 1.45 || b.y0 > p.pos.y + 0.4) return false;
      // through the box from where the ray met it
      const ex = p.pos.x + fx * hit.t, ez = p.pos.z + fz * hit.t;
      const tx = fx > 1e-6 ? (b.x1 - ex) / fx : fx < -1e-6 ? (b.x0 - ex) / fx : 1e9;
      const tz = fz > 1e-6 ? (b.z1 - ez) / fz : fz < -1e-6 ? (b.z0 - ez) / fz : 1e9;
      const depth = Math.min(tx, tz);
      if (depth > 2.4) return false;
      // head room over it (nothing else at chest height just past the edge)
      if (map.raycast(p.pos.x, b.y1 + 0.5, p.pos.z, fx, 0, fz, hit.t + depth + 0.6)) return false;
      top = b.y1;
      exit = hit.t + depth;
    }
    const lx = p.pos.x + fx * (exit + 0.55), lz = p.pos.z + fz * (exit + 0.55);
    const ly = groundAt(lx, lz, p.pos.y + 1.5);
    if (Math.abs(ly - p.pos.y) > 1.6 || ly < WATER_Y - 0.3) return false;
    if (map.resolveCircle(lx, lz, 0.35, ly + 0.35, ly + 1.8, g.tmpBoxes)) return false;
    if (g.nearestVehicle(new THREE.Vector3(lx, ly, lz), 0.3)) return false;
    const dist = exit + 0.55;
    this.vault = { t: 0, dur: 0.32 + dist * 0.07 + (top - p.pos.y) * 0.08, x0: p.pos.x, y0: p.pos.y, z0: p.pos.z, x1: lx, y1: ly, z1: lz, top, fx, fz, sp: clamp(hs, 2.5, 6) };
    p.yaw = Math.atan2(fx, fz);
    p.vaultRoll = car ? 0.55 : 0;
    p.vaultU = 0;
    p.onGround = false;
    p.vx = p.vz = p.vy = 0;
    g.audio.whoosh();
    return true;
  }

  private stepVault(dt: number) {
    const g = this.game;
    const p = g.player;
    const vt = this.vault!;
    if (p.dead || p.down > 0 || p.vehicle) {
      this.vault = null;
      p.vaultU = -1;
      return;
    }
    vt.t += dt;
    const u = Math.min(1, vt.t / vt.dur);
    const e = u * u * (3 - 2 * u);
    const base = lerp(vt.y0, vt.y1, e);
    // the feet clear the top with a little to spare at the middle of the arc
    const lift = Math.max(0, vt.top + 0.12 - (vt.y0 + vt.y1) / 2);
    p.pos.set(lerp(vt.x0, vt.x1, e), base + 4 * e * (1 - e) * lift, lerp(vt.z0, vt.z1, e));
    p.vaultU = u;
    if (u >= 1) {
      this.vault = null;
      p.vaultU = -1;
      p.vaultRoll = 0;
      p.pos.y = vt.y1;
      p.onGround = true;
      // carry on at the speed you came in with
      p.vx = vt.fx * vt.sp;
      p.vz = vt.fz * vt.sp;
    }
  }

  private drive(dt: number, v: Vehicle) {
    const g = this.game;
    const inp = g.input;
    const p = g.player;
    this.aiming = false;
    this.aimW = 0;
    p.aim = 0;
    const thr = (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0) - (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0);
    const steer = (inp.down('KeyA') || inp.down('ArrowLeft') ? 1 : 0) - (inp.down('KeyD') || inp.down('ArrowRight') ? 1 : 0);
    v.input.thr = thr;
    v.input.steer = steer;
    v.input.hand = inp.down('Space');
    // the radio
    if (inp.hit('KeyQ') || inp.hit('KeyE')) g.hud.toast(g.audio.radio.tune(inp.hit('KeyE') ? 1 : -1));
    const horn = inp.down('KeyH');
    // the siren, in anything that has one
    if (inp.hit('KeyG') && v.sirenRed) {
      v.siren = !v.siren;
      g.hud.toast(v.siren ? 'Siren on' : 'Siren off');
    }
    g.audio.setHorn(horn);
    if (horn) g.alertDanger(v.pos, 12, false, true);
    if (inp.hit('KeyF')) {
      g.exitVehicle();
      return;
    }
  }

  computeAimPoint() {
    const g = this.game;
    const cam = g.camera;
    const dir = this.v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    // start the ray beyond the player to avoid hitting ourselves
    const o = cam.position.clone().addScaledVector(dir, this.camDist + 0.4);
    const hit = g.weapons.trace(o, dir.clone(), 200, g.player);
    this.aimPoint.copy(hit.point);
  }

  /** Camera placement. */
  updateCamera(dt: number) {
    const g = this.game;
    const p = g.player;
    const cam = g.camera;
    const v = p.vehicle;
    let dist: number, height: number, fov: number, side = 0;
    const air = g.chopper?.camera();
    if (air) {
      // the helicopter: well back and above, following its heading unless you've looked around
      if (this.mouseIdle > 1.2) {
        this.camYaw += wrapAngle(air.yaw - this.camYaw) * clamp(dt * 1.6, 0, 1);
        this.camPitch = damp(this.camPitch, 0.22, 2, dt);
      }
      dist = 13 + Math.min(air.speed, 45) * 0.08;
      height = 1.6;
      fov = lerp(TUNING.fovFoot, TUNING.fovCarMax, clamp(air.speed / 60, 0, 1));
      this.camTarget.set(air.x, air.y + height, air.z);
    } else if (v) {
      const sp = v.speed;
      const fwdSpeed = v.forwardSpeed;
      // follow the car heading unless the player has looked around recently
      if (this.mouseIdle > 1.2) {
        const target = fwdSpeed < -2 ? v.heading + Math.PI : v.heading;
        this.camYaw += wrapAngle(target - this.camYaw) * clamp(dt * (2 + sp * 0.06), 0, 1);
        this.camPitch = damp(this.camPitch, this.fp ? 0.04 : v.isBoat ? 0.2 : 0.16, 2, dt);
      }
      dist = v.spec.len * 0.85 + 3.4 + Math.min(sp, 40) * 0.05;
      height = v.spec.hgt + 0.6;
      fov = lerp(TUNING.fovFoot, TUNING.fovCarMax, clamp(sp / 50, 0, 1));
      this.camTarget.set(v.pos.x, v.pos.y + height, v.pos.z);
    } else {
      const aim = this.aimW;
      dist = lerp(TUNING.camDistFoot, TUNING.camDistAim, aim);
      // crouched in cover: a lower, wider shoulder view that rises when you peek to aim
      this.coverW = damp(this.coverW, p.inCover ? 1 - aim : 0, 8, dt);
      side = lerp(lerp(0.35, 0.75, aim), 0.85, this.coverW);
      height = lerp(lerp(1.55, 1.62, aim), 1.05, this.coverW);
      dist += this.coverW * 0.6;
      const scoped = p.weapon === 'sniper' && aim > 0.5;
      fov = scoped ? 14 : lerp(TUNING.fovFoot, TUNING.fovAim, aim) + (p.sprint && Math.hypot(p.vx, p.vz) > 6 ? 4 : 0);
      if (scoped) dist = 0.4;
      // in the air: further back and up, so the whole canopy is in frame
      if (p.sky === 2) { dist = 9.5; height = 3.6; side = 0; fov += 6; }
      else if (p.sky === 1) { dist = 6; side = 0; fov += 8; }
      const ty = p.swimming ? WATER_Y + 0.6 : p.pos.y + height;
      this.camTarget.set(p.pos.x, ty, p.pos.z);
    }
    if (g.cameraKick > 0) {
      this.camPitch -= g.cameraKick;
      g.cameraKick = 0;
    }
    this.camDist = damp(this.camDist, dist, 8, dt);
    this.fov = damp(this.fov, fov, 6, dt);
    const cy = Math.cos(this.camPitch), sy = Math.sin(this.camPitch);
    const lx = Math.sin(this.camYaw) * cy, lz = Math.cos(this.camYaw) * cy, ly = -sy;
    const rx = -Math.cos(this.camYaw), rz = Math.sin(this.camYaw);
    // pivot shifted to the shoulder
    const px = this.camTarget.x + rx * side, pz = this.camTarget.z + rz * side, py = this.camTarget.y;
    let d = this.camDist;
    const hit = g.map.colliders.raycast(px, py, pz, -lx, -ly, -lz, d + 0.3, true);
    if (hit) d = Math.max(0.6, hit.t - 0.3);
    this.camPos.set(px - lx * d, py - ly * d, pz - lz * d);
    // keep the camera out of the sea (but not out of the walk-in stores below the street)
    const gy = Math.max(groundAt(this.camPos.x, this.camPos.z, this.camPos.y), groundBase(this.camPos.x, this.camPos.z) < WATER_Y - 0.5 ? WATER_Y : -1e9) + 0.35;
    if (this.camPos.y < gy) this.camPos.y = gy;
    cam.position.copy(this.camPos);
    cam.lookAt(px + lx * 10, py + ly * 10, pz + lz * 10);
    // first person: the eyes, on foot or in the driver's seat (not in the helicopter)
    const fpOn = this.fp && !air && !p.dead && !p.swimming;
    g.skinned.hideId = fpOn ? p.id : -1;
    // from inside, your own car's tinted glass would be a dark mirror: drop it while you look out through it
    const glassCar = fpOn && v ? v : null;
    if (this.clearGlass !== glassCar) {
      if (this.clearGlass) {
        const ms = this.clearGlass.body.material as THREE.Material[];
        if (Array.isArray(ms) && this.savedGlass) ms[3] = this.savedGlass;
      }
      this.clearGlass = glassCar;
      this.savedGlass = null;
      if (glassCar) {
        const ms = glassCar.body.material as THREE.Material[];
        if (Array.isArray(ms) && ms.length > 3) {
          this.savedGlass = ms[3];
          ms[3] = NO_GLASS;
        }
      }
    }
    if (fpOn) {
      const e = this.headV;
      if (v && v.seat) {
        const host = v.type === 'bike' || v.type === 'jetski' || v.type === 'airboat' ? v.body : v.root;
        host.updateWorldMatrix(true, false);
        const cabin = v.type !== 'bike' && v.type !== 'jetski' && v.type !== 'airboat' && v.type !== 'bus';
        // a car: a 'bonnet' view from the top of the windscreen, ahead of the (blocky) cabin, out over the bonnet;
        // on a bike or skiff: the rider's eyes over the seat
        if (cabin && v.roofY > 0) e.set(0, v.roofY - 0.08, v.spec.len * 0.2);
        else e.set(v.seat.x, v.seat.y + 1.12, v.seat.z + 0.05);
        host.localToWorld(e);
      } else e.set(p.pos.x + Math.sin(p.yaw) * 0.12, p.pos.y + 1.62, p.pos.z + Math.cos(p.yaw) * 0.12);
      cam.position.copy(e);
      cam.lookAt(e.x + lx * 10, e.y + ly * 10, e.z + lz * 10);
      const ff = v ? 72 : 74;
      if (Math.abs(cam.fov - ff) > 0.01 && this.aimW < 0.5) {
        cam.fov = ff;
        cam.updateProjectionMatrix();
      }
      return;
    }
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
