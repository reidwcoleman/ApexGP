import * as THREE from 'three';
import { SURF } from '../world/Track.ts';
import type { Race } from '../race/Race.ts';
import type { Entry } from '../race/Teams.ts';
import type { CarRig, PartId, WheelId } from '../car/CarModel.ts';
import type { WeatherState } from '../world/Weather.ts';
import type { Particles } from './Particles.ts';
import { SprayEmitters } from './Spray.ts';
import { DMG, type Impact } from '../sim/CarPhysics.ts';
import type { Debris } from './Debris.ts';

/** a part is bent up to this much damage, then it breaks off */
const BREAK: Record<PartId, number> = { fwL: 0.8, fwR: 0.8, rw: 0.9 };
const PART_ZONE: Record<PartId, number> = { fwL: DMG.FWL, fwR: DMG.FWR, rw: DMG.RW };
const WHEELS: WheelId[] = ['wFL', 'wFR', 'wRL', 'wRR'];

interface DamageFx {
  broken: Record<PartId, boolean>;
  destroyed: boolean;
  /** seconds since the car went up */
  burn: number;
  lost: Set<WheelId>;
  smokeAcc: number;
  vals: Record<PartId, number>;
  suspSum: number;
}

/**
 * Per-car visual effects driven by the physics, called once per frame while a
 * session is on screen:
 *   - rain spray (rooster tails, tread sheets, front fans, lingering mist) scaled
 *     by the water under each car × its speed, and the camera spray veil
 *   - rain-light glows that punch through the spray
 *   - tyre smoke (lock-ups, wheelspin, big slides — suppressed in the wet),
 *     grass/gravel dust, sparks (plank on kerbs/compressions, walls, contact)
 */
export class CarEffects {
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3(0, 0, 1);
  readonly spray = new SprayEmitters();
  private readonly dmgFx = new Map<number, DamageFx>();
  private readonly tmp3 = new THREE.Vector3();
  /** flickering light from the nearest fire (a permanent light: adding lights recompiles every shader) */
  readonly fireLight = new THREE.PointLight(0xff7a2a, 0, 40, 1.6);
  /** a heavy hit on some car this frame (audio, camera shake) */
  onImpact: ((carId: number, imp: Impact, isPlayer: boolean) => void) | null = null;
  /** a car went up in flames */
  onExplosion: ((carId: number, pos: THREE.Vector3) => void) | null = null;
  private fireBest = 0;

  constructor(private readonly particles: Particles, private readonly debris: Debris | null = null) {
    this.fireLight.castShadow = false;
    this.fireLight.name = 'fire-light';
  }

  /**
   * Crash damage for one car: impacts throw shards, sparks and dust; parts bend
   * and break off (tumbling away as debris); a damaged engine smokes; a
   * destroyed car explodes, burns and chars. Runs for every car every frame.
   */
  private damage(dt: number, c: Race['cars'][number], rig: CarRig, dist: number, cam: THREE.Vector3) {
    const car = c.car;
    const P = this.particles;
    let st = this.dmgFx.get(c.id);
    if (!st) {
      st = { broken: { fwL: false, fwR: false, rw: false }, destroyed: false, burn: 0, lost: new Set(), smokeAcc: 0, vals: { fwL: 0, fwR: 0, rw: 0 }, suspSum: 0 };
      this.dmgFx.set(c.id, st);
    }
    const root = rig.root.position;
    const [wx, wz] = car.worldVelocity();
    const vel = this.tmp2.set(wx, 0, wz);
    // ---- hits
    for (const imp of car.impacts) {
      if (imp.speed > 5 && dist < 300) {
        const amt = Math.min(1, (imp.speed - 5) / 22);
        this.debris?.burst(imp.x, root.y, imp.z, wx, wz, imp.nx, imp.nz, amt, c.entry.team.primary);
        this.tmp.set(imp.x, root.y + 0.2, imp.z);
        P.sparks(this.tmp, vel, 6 + Math.floor(amt * 18), root.y);
        for (let k = 0; k < 2 + amt * 5; k++) P.dust(this.tmp, vel, true, 0.5 + amt * 0.5, root.y);
        if (amt > 0.35) P.flashGlow(this.tmp, 0.9 + amt, 0.35 * amt);
      }
      this.onImpact?.(c.id, imp, c.isPlayer);
    }
    car.impacts.length = 0;
    // ---- parts: bend, then break off
    let changed = false;
    for (const k of ['fwL', 'fwR', 'rw'] as PartId[]) {
      const d = car.dmg[PART_ZONE[k]];
      const brk = d >= BREAK[k] || (st.destroyed && k !== 'rw') || (st.destroyed && d > 0.3);
      if (brk && !st.broken[k]) {
        // spin it off with the car's speed and a kick up and outward
        const obj = rig.cloneBroken(k);
        const side = k === 'fwL' ? 1 : k === 'fwR' ? -1 : 0;
        const lx = Math.cos(car.yaw) * side, lz = -Math.sin(car.yaw) * side;
        const kick = st.destroyed ? 7 : 3;
        this.debris?.addPart(obj, wx * 0.8 + lx * kick + (Math.random() - 0.5) * 2, 2 + Math.random() * (st.destroyed ? 7 : 3), wz * 0.8 + lz * kick + (Math.random() - 0.5) * 2, 10 + Math.random() * 12);
      }
      if (brk !== st.broken[k]) changed = true;
      st.broken[k] = brk;
      const v = brk ? 1 : Math.min(0.95, d / BREAK[k]);
      if (Math.abs(v - st.vals[k]) > 1e-4) changed = true;
      st.vals[k] = v;
    }
    // ---- destroyed: explosion once, then it burns
    if (car.destroyed && !st.destroyed) {
      st.destroyed = true;
      st.burn = 0;
      const at = this.tmp3.copy(root);
      at.y += 0.3;
      P.explosion(at, vel, root.y);
      this.onExplosion?.(c.id, at);
      this.debris?.burst(root.x, root.y + 0.4, root.z, wx, wz, 0, 0, 1, c.entry.team.primary);
      this.debris?.burst(root.x, root.y + 0.4, root.z, wx, wz, 0, 0, 1, c.entry.team.secondary);
      // one or two wheels come off (the most damaged corners first)
      const order = [0, 1, 2, 3].sort((a, b) => car.susp[b] - car.susp[a]);
      const nLost = 1 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < nLost; i++) {
        const w = WHEELS[order[i]];
        const obj = rig.cloneBroken(w);
        const side = order[i] % 2 === 0 ? 1 : -1;
        const lx = Math.cos(car.yaw) * side, lz = -Math.sin(car.yaw) * side;
        this.debris?.addPart(obj, wx * 0.7 + lx * (5 + Math.random() * 5), 4 + Math.random() * 6, wz * 0.7 + lz * (5 + Math.random() * 5), 14);
        rig.setWheelLost(w, true);
        st.lost.add(w);
      }
      changed = true;
    } else if (!car.destroyed && st.destroyed) {
      // flashback to before it happened
      st.destroyed = false;
      for (const w of st.lost) rig.setWheelLost(w, false);
      st.lost.clear();
      changed = true;
    }
    if (st.destroyed) st.burn += dt;
    const char = st.destroyed ? Math.min(1, st.burn / 3.5) : 0;
    const suspSum = car.susp[0] + car.susp[1] + car.susp[2] + car.susp[3];
    if (changed || st.destroyed || suspSum !== st.suspSum) rig.setDamage(st.vals, car.susp, char);
    st.suspSum = suspSum;
    // ---- smoke and fire
    if (dist > 500) return;
    const emit = (rate: number) => Math.random() < rate * dt;
    if (st.destroyed) {
      // flames for ~25 s, then smouldering smoke
      const f = Math.max(0, 1 - st.burn / 26);
      const body = rig.anchors.exhaust.getWorldPosition(this.tmp3);
      if (f > 0) {
        // flames along the body: mostly from the engine bay and sidepods
        if (emit(26 * (0.35 + f))) {
          const off = -0.9 + Math.random() * 1.9;
          this.tmp.set(root.x + Math.sin(car.yaw) * off, root.y + 0.35, root.z + Math.cos(car.yaw) * off);
          P.fire(this.tmp, vel, Math.min(1, 0.4 + f), 0.7);
        }
        if (emit(16 * (0.3 + f))) P.blackSmoke(body.setY(root.y + 0.8), vel, 0.7 + 0.3 * f, root.y);
        const flick = 0.75 + 0.25 * Math.sin(st.burn * 23) * Math.sin(st.burn * 9.7 + 1) + (Math.random() - 0.5) * 0.3;
        const lvl = f * flick * 2.4;
        const d = root.distanceToSquared(cam);
        if (lvl > 0 && (this.fireBest < 0 || d < this.fireBest)) {
          this.fireBest = d;
          this.fireLight.position.set(root.x, root.y + 1.2, root.z);
          this.fireLight.intensity = lvl;
        }
      } else if (emit(3 * Math.max(0.1, 1 - (st.burn - 26) / 60))) P.engineSmoke(body, vel, 0.7, root.y);
      if (st.burn < 0.35) {
        const at = this.tmp.copy(root);
        at.y += 1;
        P.flashGlow(at, 6, (1 - st.burn / 0.35) * 2);
        if (this.fireBest < 0 || root.distanceToSquared(cam) < this.fireBest) {
          this.fireBest = root.distanceToSquared(cam);
          this.fireLight.position.copy(at);
          this.fireLight.intensity = 30 * (1 - st.burn / 0.35);
        }
      }
    } else if (car.damageMode !== 'off') {
      // a wounded car: grey smoke from the engine cover, a little fire when it's nearly gone
      const hurt = Math.max(car.dmg[DMG.ENGINE], 1 - car.integrity);
      if (hurt > 0.45) {
        const body = rig.anchors.exhaust.getWorldPosition(this.tmp3);
        st.smokeAcc += dt * (hurt - 0.45) * 40;
        while (st.smokeAcc > 1) {
          st.smokeAcc -= 1;
          P.engineSmoke(body, vel, Math.min(1, (hurt - 0.45) * 2.5), root.y);
        }
        if (hurt > 0.8 && emit(12)) P.fire(body, vel, 0.3, 0.25);
      }
    }
  }

  update(dt: number, race: Race, rigs: Map<Entry, CarRig>, cam: THREE.Vector3, weather: WeatherState) {
    this.fireBest = -1;
    const P = this.particles;
    P.setWind(weather.windX, weather.windZ);
    this.camDir.copy(P.cameraDirection);
    const track = race.track;
    const wetBase = weather.wetness;
    let veil = 0;
    let groundNear = cam.y - 1.2;
    let nearest = 1e9;

    // the camera's own car (chase / T-cam / cockpit): nearest car within 12 m
    let selfId = -1;
    let selfD = 12 * 12;
    for (const c of race.cars) {
      const r = rigs.get(c.entry);
      if (!r) continue;
      const d = r.root.position.distanceToSquared(cam);
      if (d < selfD) {
        selfD = d;
        selfId = c.id;
      }
    }

    for (const c of race.cars) {
      const car = c.car;
      const rig = rigs.get(c.entry);
      if (!rig) continue;
      const root = rig.root.position;
      const dxc = root.x - cam.x, dyc = root.y - cam.y, dzc = root.z - cam.z;
      const d2 = dxc * dxc + dyc * dyc + dzc * dzc;
      const dist = Math.sqrt(d2);
      if (dist < nearest) {
        nearest = dist;
        groundNear = root.y;
      }
      if (c.removed !== !rig.root.visible) rig.root.visible = !c.removed;
      if (c.removed) continue;
      if (dt > 0) this.damage(dt, c, rig, dist, cam);
      const [wx, wz] = car.worldVelocity();
      const speed = car.speed;

      // ---------------------------------------------------------- water under the car
      let wet = 0;
      if (wetBase > 0.01) {
        const line = track.racingLineAt(car.s);
        const dl = (car.lateral - line) / 2.3;
        wet = wetBase * (1 - 0.85 * weather.dryLine * Math.exp(-dl * dl));
        const offRoad = (s: number) => s === SURF.GRASS || s === SURF.GRAVEL;
        if (offRoad(car.surfaceRL) && offRoad(car.surfaceRR)) wet *= 0.45;
      }

      // ---------------------------------------------------------- spray
      let I = 0;
      if (wet > 0.01 && dist < 420) {
        I = this.spray.emit(P, c.id, {
          x: root.x, y: root.y, z: root.z, yaw: car.yaw, vx: wx, vz: wz, speed, wet, camDist: dist,
          wheelbase: rig.dims.wheelbase, trackF: rig.dims.trackFront, trackR: rig.dims.trackRear, self: c.id === selfId,
        }, dt);
        if (I > 0.02 && dist < 160) {
          // how much of this car's spray hangs between the camera and what it looks at
          const inv = 1 / Math.max(dist, 1e-3);
          const cosA = (dxc * this.camDir.x + dyc * this.camDir.y + dzc * this.camDir.z) * inv;
          const view = dist < 9 ? 1 : smoothstep(0.15, 0.75, cosA);
          const away = Math.max(0, Math.sin(car.yaw) * this.camDir.x + Math.cos(car.yaw) * this.camDir.z);
          veil += I * view * Math.exp(-dist / 55) * (0.1 + 0.9 * away * away) * (dist < 9 ? 0.4 : 1);
        }
      }

      // ---------------------------------------------------------- rain light glows
      const lvl = rig.rainLightLevel();
      if (lvl > 0.01 && dist < 700) {
        const a = rig.anchors.rainLight.getWorldPosition(this.tmp);
        const att = Math.exp(-dist / 900);
        const self = c.id === selfId;
        // your own light is already right there (emissive LED + bloom): only other cars get the flare
        if (!self) P.glow(a, 0.06 + 0.04 * I, 24 * lvl, 1 * lvl, 0.5 * lvl, att, 0.35);
        // the red light scattering in the spray around it
        const haze = Math.max(I, wetBase * 0.4);
        if (haze > 0.03 && !self) P.haloGlow(a, 0.6 + 1.4 * haze, 0.22 * lvl * haze, 0.011 * lvl * haze, 0.006 * lvl * haze, att);
      }

      if (dist > 260) {
        if (c.contactTimer > 0) c.contactTimer -= dt;
        continue;
      }
      const vel = this.tmp2.set(wx, 0, wz);
      const emit = (amount: number) => Math.random() < amount * dt * 60;
      const wheelPos = (o: THREE.Object3D) => o.getWorldPosition(this.tmp);
      const g = root.y;
      // water suppresses tyre smoke almost completely
      const dry = 1 - Math.min(1, wet * 2.5);

      // lock-ups & wheelspin → tyre smoke (sparingly: F1 tyres rarely smoke)
      if (dry > 0.05) {
        if (car.lockup > 0.35 && speed > 8 && emit(car.lockup * 0.5 * dry)) {
          P.smoke(wheelPos(rig.anchors.wheelFL), vel, car.lockup, g);
          P.smoke(wheelPos(rig.anchors.wheelFR), vel, car.lockup, g);
        }
        if (car.wheelspin > 0.3 && emit(car.wheelspin * 0.6 * dry)) {
          P.smoke(wheelPos(rig.anchors.wheelRL), vel, car.wheelspin, g);
          P.smoke(wheelPos(rig.anchors.wheelRR), vel, car.wheelspin, g);
        }
        // big slides only
        const slide = Math.max(0, car.slipRear - 2.2) + Math.max(0, car.slipFront - 2.6);
        if (slide > 0.2 && speed > 10 && emit(Math.min(0.4, slide * 0.3) * dry)) {
          P.smoke(wheelPos(rig.anchors.wheelRL), vel, Math.min(1, slide) * 0.6, g);
          P.smoke(wheelPos(rig.anchors.wheelRR), vel, Math.min(1, slide) * 0.6, g);
        }
      }
      // dirt off track (damp grass throws far less dust)
      const dirt = 1 - Math.min(0.75, wet);
      const wheels: [number, THREE.Object3D][] = [
        [car.surfaceFL, rig.anchors.wheelFL],
        [car.surfaceFR, rig.anchors.wheelFR],
        [car.surfaceRL, rig.anchors.wheelRL],
        [car.surfaceRR, rig.anchors.wheelRR],
      ];
      for (const [sf, a] of wheels) {
        if ((sf === SURF.GRASS || sf === SURF.GRAVEL) && speed > 6 && emit(Math.min(1, speed / 30) * (sf === SURF.GRAVEL ? 0.8 : 0.35) * dirt)) {
          P.dust(wheelPos(a), vel, sf === SURF.GRAVEL, Math.min(1, speed / 25), g);
        }
      }
      // sparks: plank on the kerbs / compressions at high speed, walls, contact
      const hi = speed > 62;
      if ((hi && car.onKerb && emit(0.15)) || (speed > 80 && car.heave < -0.05 && emit(0.05)) || (car.contact.wallHit > 1 && emit(0.6)) || (c.contactTimer > 0 && speed > 20 && emit(0.35))) {
        this.tmp.set(root.x - Math.sin(car.yaw) * 0.6, g + 0.03, root.z - Math.cos(car.yaw) * 0.6);
        P.sparks(this.tmp, vel.set(wx, 0, wz), 3 + Math.floor(Math.random() * 4), g);
      }
      if (c.contactTimer > 0) c.contactTimer -= dt;
    }
    this.spray.endFrame();
    P.veil.setDensity(veil, groundNear);
    if (this.fireBest < 0) this.fireLight.intensity = 0;
  }

  /** drop per-car emitter state (new session, flashback) */
  reset() {
    this.spray.reset();
  }

  /** a new session: forget damage state (the rigs are reset by the game) */
  resetDamage() {
    this.dmgFx.clear();
    this.debris?.clear();
    this.fireLight.intensity = 0;
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
