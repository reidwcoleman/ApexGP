import * as THREE from 'three';
import { SURF } from '../world/Track.ts';
import type { Race } from '../race/Race.ts';
import type { Entry } from '../race/Teams.ts';
import type { CarRig } from '../car/CarModel.ts';
import type { WeatherState } from '../world/Weather.ts';
import type { Particles } from './Particles.ts';
import { SprayEmitters } from './Spray.ts';

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

  constructor(private readonly particles: Particles) {}

  update(dt: number, race: Race, rigs: Map<Entry, CarRig>, cam: THREE.Vector3, weather: WeatherState) {
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
      if ((hi && car.onKerb && emit(0.6)) || (speed > 75 && car.heave < -0.02 && emit(0.25)) || (car.contact.wallHit > 1 && emit(1)) || (c.contactTimer > 0 && speed > 20 && emit(0.8))) {
        this.tmp.set(root.x - Math.sin(car.yaw) * 0.6, g + 0.03, root.z - Math.cos(car.yaw) * 0.6);
        P.sparks(this.tmp, vel.set(wx, 0, wz), 8 + Math.floor(Math.random() * 10), g);
      }
      if (c.contactTimer > 0) c.contactTimer -= dt;
    }
    this.spray.endFrame();
    P.veil.setDensity(veil, groundNear);
  }

  /** drop per-car emitter state (new session, flashback) */
  reset() {
    this.spray.reset();
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
