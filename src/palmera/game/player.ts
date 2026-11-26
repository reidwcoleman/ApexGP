// Player control on foot and in vehicles, plus the third-person / chase camera.
import * as THREE from 'three';
import { clamp, damp, lerp, wrapAngle } from '../core/math';
import type { Vehicle } from '../entities/vehicle';
import { WATER_Y, groundAt, groundBase } from '../world/map';
import type { Game } from './game';
import { WEAPONS, WEAPON_ORDER } from './weapons';

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
  private mouseIdle = 10;
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

  private onFoot(dt: number) {
    const g = this.game;
    const inp = g.input;
    const p = g.player;
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
    this.aiming = inp.aim && !p.swimming;
    this.aimW = damp(this.aimW, this.aiming ? 1 : 0, 14, dt);
    p.aim = p.weapon !== 'fist' ? this.aimW : 0;
    p.aimPitch = -this.camPitch * 0.9 + 0.05;
    const sx = Math.sin(this.camYaw), sz = Math.cos(this.camYaw);
    const rx = -sz, rz = sx;
    let mx = sx * fw + rx * st, mz = sz * fw + rz * st;
    const ml = Math.hypot(mx, mz);
    p.sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    let speed = p.swimming ? TUNING.swimSpeed : this.aiming ? TUNING.aimWalkSpeed : p.sprint ? TUNING.sprintSpeed : TUNING.runSpeed;
    if (ml > 0) {
      mx /= ml;
      mz /= ml;
    } else speed = 0;
    g.setDesired(p, mx * speed, mz * speed);
    // facing
    if (this.aiming || (p.weapon !== 'fist' && inp.fire)) p.yaw = this.camYaw;
    else if (ml > 0) p.yaw += wrapAngle(Math.atan2(mx, mz) - p.yaw) * clamp(12 * dt, 0, 1);
    // jump
    if (inp.hit('Space') && p.onGround && !p.swimming) {
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
        this.camPitch = damp(this.camPitch, v.isBoat ? 0.2 : 0.16, 2, dt);
      }
      dist = v.spec.len * 0.85 + 3.4 + Math.min(sp, 40) * 0.05;
      height = v.spec.hgt + 0.6;
      fov = lerp(TUNING.fovFoot, TUNING.fovCarMax, clamp(sp / 50, 0, 1));
      this.camTarget.set(v.pos.x, v.pos.y + height, v.pos.z);
    } else {
      const aim = this.aimW;
      dist = lerp(TUNING.camDistFoot, TUNING.camDistAim, aim);
      side = lerp(0.35, 0.75, aim);
      height = lerp(1.55, 1.62, aim);
      const scoped = p.weapon === 'sniper' && aim > 0.5;
      fov = scoped ? 14 : lerp(TUNING.fovFoot, TUNING.fovAim, aim) + (p.sprint && Math.hypot(p.vx, p.vz) > 6 ? 4 : 0);
      if (scoped) dist = 0.4;
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
    const hit = g.map.colliders.raycast(px, py, pz, -lx, -ly, -lz, d + 0.3);
    if (hit) d = Math.max(0.6, hit.t - 0.3);
    this.camPos.set(px - lx * d, py - ly * d, pz - lz * d);
    // keep the camera out of the sea (but not out of the walk-in stores below the street)
    const gy = Math.max(groundAt(this.camPos.x, this.camPos.z, this.camPos.y), groundBase(this.camPos.x, this.camPos.z) < WATER_Y - 0.5 ? WATER_Y : -1e9) + 0.35;
    if (this.camPos.y < gy) this.camPos.y = gy;
    cam.position.copy(this.camPos);
    cam.lookAt(px + lx * 10, py + ly * 10, pz + lz * 10);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
