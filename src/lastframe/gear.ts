import * as THREE from 'three';
import type { Opening } from './fort.ts';

/**
 * The small things of the attack-and-defend game that sit in the building for a round: the defenders' cameras up on the
 * walls and the tripwires across doorways. Neither is in the way of anybody, so neither is in the collision world: a round
 * that passes close enough to one has hit it (`shot`).
 */
export interface Cam {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  dead: boolean;
  mesh: THREE.Group;
  led: THREE.Mesh;
}

const BODY = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.55, metalness: 0.1 });
const DARK = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35, metalness: 0.4 });
const LED_ON = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
const LED_OFF = new THREE.MeshBasicMaterial({ color: 0x1a0504 });
const WIRE = new THREE.MeshStandardMaterial({ color: 0xb9b9b0, roughness: 0.5, metalness: 0.3 });
const OLIVE = new THREE.MeshStandardMaterial({ color: 0x3b4230, roughness: 0.8 });

function camModel(): { g: THREE.Group; led: THREE.Mesh } {
  const g = new THREE.Group();
  // built looking down -z: a plate on the wall behind it, an arm, the housing, the glass
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.012), BODY);
  plate.position.set(0, 0.03, 0.1);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.1), BODY);
  arm.position.set(0, 0.03, 0.05);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.07, 0.17), BODY);
  body.position.set(0, 0, -0.03);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.008, 0.2), BODY);
  hood.position.set(0, 0.04, -0.045);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 14), DARK);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0, -0.12);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), LED_ON);
  led.position.set(0.026, -0.022, -0.116);
  g.add(plate, arm, body, hood, lens, led);
  g.traverse((o) => {
    (o as THREE.Mesh).castShadow = false;
  });
  return { g, led };
}

export class Gear {
  cams: Cam[] = [];
  readonly trips = new Map<number, { o: Opening; mesh: THREE.Group; at: THREE.Vector3 }>();

  constructor(private scene: THREE.Object3D) {}

  /** this round's cameras, and which are still working */
  setCams(list: number[][], alive: number): number[] {
    const same = list.length === this.cams.length && list.every((c, i) => Math.abs(c[0] - this.cams[i].pos.x) < 0.01 && Math.abs(c[2] - this.cams[i].pos.z) < 0.01);
    if (!same) {
      for (const c of this.cams) this.scene.remove(c.mesh);
      this.cams = list.map((c) => {
        const { g, led } = camModel();
        g.position.set(c[0], c[1], c[2]);
        g.rotation.set(c[4], c[3], 0, 'YXZ');
        this.scene.add(g);
        return { pos: new THREE.Vector3(c[0], c[1], c[2]), yaw: c[3], pitch: c[4], dead: false, mesh: g, led };
      });
    }
    const went: number[] = [];
    this.cams.forEach((c, i) => {
      const dead = !(alive >> i & 1);
      if (dead && !c.dead) {
        went.push(i);
        // shot: it hangs off its arm, and the light is out
        c.mesh.rotation.set(c.pitch - 0.9, c.yaw + 0.3, 0.4, 'YXZ');
        c.led.material = LED_OFF;
      }
      c.dead = dead;
    });
    return went;
  }

  setTrip(i: number, on: boolean, o: Opening) {
    const old = this.trips.get(i);
    if (old) {
      this.scene.remove(old.mesh);
      this.trips.delete(i);
    }
    if (!on) return old?.at ?? null;
    const g = new THREE.Group();
    const wire = new THREE.Mesh(new THREE.BoxGeometry(o.w, 0.005, 0.005), WIRE);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.045), OLIVE);
    box.position.set(-o.w / 2 + 0.035, 0.0, 0);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.02), OLIVE);
    cap.position.set(o.w / 2 - 0.012, 0, 0);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.005, 6, 5), LED_ON);
    led.position.set(-o.w / 2 + 0.035, 0.04, 0.024);
    g.add(wire, box, cap, led);
    g.position.set(o.x, o.y + 0.24, o.z);
    if (!o.alongX) g.rotation.y = Math.PI / 2;
    this.scene.add(g);
    this.trips.set(i, { o, mesh: g, at: new THREE.Vector3(o.x, o.y + 0.24, o.z) });
    return null;
  }

  /** a round from o that stopped at each point of e (six numbers a point): the cameras and wires it went through on the way */
  shot(o: THREE.Vector3, e: number[], hit: { cams: number[]; trips: number[] }) {
    const near = (px: number, py: number, pz: number, ex: number, ey: number, ez: number, r: number) => {
      const dx = ex - o.x, dy = ey - o.y, dz = ez - o.z;
      const l2 = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((px - o.x) * dx + (py - o.y) * dy + (pz - o.z) * dz) / l2));
      return Math.hypot(o.x + dx * t - px, o.y + dy * t - py, o.z + dz * t - pz) < r;
    };
    for (let k = 0; k + 2 < e.length; k += 6) {
      this.cams.forEach((c, i) => {
        if (!c.dead && !hit.cams.includes(i) && near(c.pos.x, c.pos.y, c.pos.z, e[k], e[k + 1], e[k + 2], 0.16)) hit.cams.push(i);
      });
      for (const [i, t] of this.trips) {
        if (hit.trips.includes(i)) continue;
        // the box on the jamb, or anywhere along the wire
        const o2 = t.o;
        for (let s = 0; s <= 6; s++) {
          const u = -o2.w / 2 + 0.03 + (o2.w - 0.06) * (s / 6);
          const px = o2.x + (o2.alongX ? u : 0), pz = o2.z + (o2.alongX ? 0 : u);
          if (near(px, t.at.y, pz, e[k], e[k + 1], e[k + 2], s === 0 ? 0.09 : 0.045)) {
            hit.trips.push(i);
            break;
          }
        }
      }
    }
  }

  reset() {
    for (const [i, t] of this.trips) {
      this.scene.remove(t.mesh);
      this.trips.delete(i);
    }
  }
}
