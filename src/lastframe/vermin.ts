import * as THREE from 'three';
import { applyLF } from './lighting.ts';
import type { Node } from './nav.ts';

interface Rat {
  mesh: THREE.Mesh;
  at: Node;
  to: Node | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** seconds it sits still, nose going, before the next run */
  wait: number;
  /** legs of the run left */
  legs: number;
  speed: number;
  side: number;
  ph: number;
}

/**
 * Rats: the only tenants. Each sits against a wall, makes a short run along it to somewhere else, and sits again.
 * Come within a few metres, or fire a shot, and it is gone the other way as fast as it can go. They keep to the
 * building round whoever is watching: one that has been left far behind turns up again further on.
 */
export class Rats {
  readonly group = new THREE.Group();
  private rats: Rat[] = [];
  private scare = 0;

  constructor(private nodes: Node[], n = 5) {
    const inside = nodes.filter((q) => q.indoors && q.cover);
    if (inside.length < 20) return;
    const body = new THREE.SphereGeometry(1, 10, 7);
    body.scale(0.034, 0.03, 0.085);
    body.translate(0, 0.032, 0);
    const head = new THREE.SphereGeometry(1, 8, 6);
    head.scale(0.02, 0.019, 0.038);
    head.translate(0, 0.03, -0.095);
    const tail = new THREE.CylinderGeometry(0.004, 0.0015, 0.15, 5);
    tail.rotateX(Math.PI / 2);
    tail.translate(0, 0.016, 0.155);
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    for (const g of [body, head, tail]) {
      const base = pos.length / 3;
      pos.push(...(g.getAttribute('position').array as Float32Array));
      nor.push(...(g.getAttribute('normal').array as Float32Array));
      for (const i of g.index!.array as Uint16Array) idx.push(i + base);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setIndex(idx);
    const mat = applyLF(new THREE.MeshStandardMaterial({ color: 0x17130f, roughness: 0.92 }));
    for (let i = 0; i < n; i++) {
      const at = inside[Math.floor(Math.random() * inside.length)];
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = false;
      this.group.add(mesh);
      this.rats.push({ mesh, at, to: null, x: at.x, y: at.y, z: at.z, yaw: Math.random() * 6.28, wait: Math.random() * 4, legs: 0, speed: 0, side: Math.random() < 0.5 ? -1 : 1, ph: Math.random() * 6 });
    }
  }

  /** a shot: every rat that heard it runs */
  startle() {
    this.scare = 1.2;
  }

  update(dt: number, cam: THREE.Vector3) {
    this.scare = Math.max(0, this.scare - dt);
    const N = this.nodes;
    for (const r of this.rats) {
      const dx = r.x - cam.x, dz = r.z - cam.z, d = Math.hypot(dx, dz, r.y - cam.y);
      if (d > 34) {
        // left behind: it turns up again somewhere ahead, out of the way
        for (let k = 0; k < 6; k++) {
          const q = N[Math.floor(Math.random() * N.length)];
          const qd = Math.hypot(q.x - cam.x, q.z - cam.z, (q.y - cam.y) * 2);
          if (q.indoors && q.cover && qd > 12 && qd < 24) {
            Object.assign(r, { at: q, to: null, x: q.x, y: q.y, z: q.z, wait: 1 + Math.random() * 3, legs: 0 });
            break;
          }
        }
        continue;
      }
      const flee = d < 4.2 || (this.scare > 0 && d < 22);
      if (!r.to) {
        r.wait -= dt;
        if (flee || r.wait <= 0) {
          r.legs = flee ? 5 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 5);
          r.speed = flee ? 5.2 : 2.6 + Math.random();
        }
        if (r.legs > 0) {
          // the next step: along the wall, and when frightened, whichever way is furthest from the boots
          let best: Node | null = null, bs = -1e9;
          for (const i of r.at.next) {
            const q = N[i];
            if (!q || Math.abs(q.y - r.at.y) > 0.5) continue;
            const away = Math.hypot(q.x - cam.x, q.z - cam.z) - Math.hypot(r.at.x - cam.x, r.at.z - cam.z);
            const sc = (q.cover ? 1.2 : 0) + (flee ? away * 2.5 : 0) + Math.random() * 1.5 + (Math.cos(r.yaw) * -(q.z - r.at.z) + Math.sin(r.yaw) * -(q.x - r.at.x)) * 0.8;
            if (sc > bs) {
              bs = sc;
              best = q;
            }
          }
          r.to = best;
          if (!best) r.legs = 0;
        }
      }
      if (r.to) {
        // hard against the skirting, not down the middle of the floor
        const tx = r.to.x + r.side * 0.3 * Math.sign(r.to.z - r.at.z || 1) * (r.to.cover ? 1 : 0.3), tz = r.to.z - r.side * 0.3 * Math.sign(r.to.x - r.at.x || 1) * (r.to.cover ? 1 : 0.3);
        const ex = tx - r.x, ez = tz - r.z, el = Math.hypot(ex, ez);
        const step = r.speed * dt;
        if (el <= step) {
          r.at = r.to;
          r.to = null;
          r.y = r.at.y;
          if (--r.legs <= 0) r.wait = 1.5 + Math.random() * 6;
        } else {
          r.x += (ex / el) * step;
          r.z += (ez / el) * step;
          r.y += (r.to.y - r.y) * Math.min(1, dt * 8);
          const want = Math.atan2(-ex, -ez);
          r.yaw += Math.atan2(Math.sin(want - r.yaw), Math.cos(want - r.yaw)) * Math.min(1, dt * 16);
        }
        r.ph += dt * r.speed * 9;
      } else r.ph += dt * 7;
      const moving = r.to ? 1 : 0;
      r.mesh.position.set(r.x, r.y + Math.abs(Math.sin(r.ph)) * 0.008 * moving, r.z);
      r.mesh.rotation.set(moving ? 0 : Math.sin(r.ph * 0.4) * 0.12 - 0.1, r.yaw + (moving ? Math.sin(r.ph) * 0.12 : Math.sin(r.ph * 0.23) * 0.3), 0, 'YXZ');
      r.mesh.visible = d < 28;
    }
  }
}
