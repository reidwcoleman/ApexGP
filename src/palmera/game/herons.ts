// Wading birds in the swamp: white egrets, grey-blue herons and pink spoonbills standing in the
// shallows at the pond edges, stalking a step now and then and dipping to fish. Come within 14 m on
// foot (25 m in anything with an engine) and one takes off with slow wingbeats, climbs, glides over
// to another pond nearby and lands again. Low-poly and original; drawn within 180 m.
import * as THREE from 'three';
import { Rng, clamp, wrapAngle } from '../core/math';
import { groundAt, pondShape } from '../world/map';
import type { Game } from './game';

type Pond = { x: number; z: number; w: number; d: number };

interface Bird {
  g: THREE.Group;
  neck: THREE.Group;
  wings: THREE.Group[];
  legs: THREE.Group;
  x: number;
  y: number;
  z: number;
  h: number;
  state: 'stand' | 'fly';
  t: number;
  next: number;
  /** flight: from, to, progress */
  fx: number;
  fz: number;
  fy: number;
  tx: number;
  tz: number;
  ty: number;
  u: number;
  len: number;
  ph: number;
}

const SPECIES = [
  { body: 0xf4f2ec, wing: 0xf4f2ec, beak: 0xd9a92a, leg: 0x1c1c1c, s: 1.0 },
  { body: 0x7f8b98, wing: 0x5f6a78, beak: 0xc9a23a, leg: 0x4a4436, s: 1.15 },
  { body: 0xf2a0b4, wing: 0xe8708e, beak: 0x9a8f72, leg: 0x8c3a4a, s: 0.9 },
];

function mat(c: number) {
  return new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
}

function build(sp: (typeof SPECIES)[number]) {
  const g = new THREE.Group();
  const bodyM = mat(sp.body), wingM = mat(sp.wing), beakM = mat(sp.beak), legM = mat(sp.leg);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 7), bodyM);
  body.scale.set(0.75, 0.7, 1.35);
  body.position.y = 0.75;
  body.castShadow = true;
  g.add(body);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.25, 6), wingM);
  tail.rotation.x = -Math.PI / 2 - 0.3;
  tail.position.set(0, 0.72, -0.3);
  g.add(tail);
  // the neck pivots at the shoulders so the bird can stretch up or dip to fish
  const neck = new THREE.Group();
  neck.position.set(0, 0.82, 0.18);
  const nk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.45, 6), bodyM);
  nk.position.y = 0.2;
  nk.rotation.x = 0.35;
  neck.add(nk);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), bodyM);
  head.position.set(0, 0.42, 0.08);
  neck.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.24, 5), beakM);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.41, 0.24);
  neck.add(beak);
  g.add(neck);
  const legs = new THREE.Group();
  for (const s of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 4), legM);
    l.position.set(s * 0.06, 0.31, 0);
    legs.add(l);
  }
  g.add(legs);
  const wings: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pv = new THREE.Group();
    pv.position.set(s * 0.12, 0.8, 0.02);
    const wg = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.02, 0.3), wingM);
    wg.position.x = s * 0.31;
    wg.castShadow = true;
    pv.add(wg);
    g.add(pv);
    wings.push(pv);
  }
  g.scale.setScalar(sp.s);
  return { g, neck, wings, legs };
}

/** a spot in the shallows just inside a pond's edge */
function shallow(p: Pond, a: number): [number, number] {
  const r = pondShape(p, a) * 0.9;
  return [p.x + Math.cos(a) * (p.w / 2) * r, p.z - Math.sin(a) * (p.d / 2) * r];
}

export class Herons {
  readonly list: Bird[] = [];
  private ponds: Pond[];
  private rng = new Rng(9090);

  constructor(private game: Game) {
    this.ponds = game.map.flats.filter((f) => f.kind === 'pond');
    if (!this.ponds.length) return;
    for (let i = 0; i < 26; i++) {
      const p = this.ponds[Math.floor(this.rng.next() * this.ponds.length)];
      const [x, z] = shallow(p, this.rng.range(0, Math.PI * 2));
      const { g, neck, wings, legs } = build(SPECIES[i % 5 === 4 ? 2 : i % 2]);
      game.scene.add(g);
      const y = groundAt(x, z);
      this.list.push({ g, neck, wings, legs, x, y, z, h: this.rng.range(0, Math.PI * 2), state: 'stand', t: this.rng.range(0, 10), next: this.rng.range(2, 8), fx: x, fz: z, fy: y, tx: x, tz: z, ty: y, u: 0, len: 1, ph: this.rng.range(0, 6.28) });
    }
  }

  private takeOff(b: Bird, awayX: number, awayZ: number) {
    // somewhere else: a pond 40-160 m off, preferring the far side from whatever scared it
    let best: Pond | null = null, bs = -1e9;
    for (let k = 0; k < 12; k++) {
      const p = this.ponds[Math.floor(this.rng.next() * this.ponds.length)];
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d < 40 || d > 160) continue;
      const sc = (p.x - b.x) * (b.x - awayX) + (p.z - b.z) * (b.z - awayZ);
      if (sc > bs) { bs = sc; best = p; }
    }
    if (!best) return;
    const [tx, tz] = shallow(best, this.rng.range(0, Math.PI * 2));
    b.state = 'fly';
    b.fx = b.x; b.fz = b.z; b.fy = b.y;
    b.tx = tx; b.tz = tz; b.ty = groundAt(tx, tz);
    b.u = 0;
    b.len = Math.hypot(tx - b.x, tz - b.z);
    b.h = Math.atan2(tx - b.x, tz - b.z);
  }

  update(dt: number) {
    const g = this.game;
    const cam = g.camera.position;
    const p = g.player;
    const src = p.vehicle ? p.vehicle.pos : p.pos;
    const scare = p.vehicle ? 25 : 14;
    for (const b of this.list) {
      const far = Math.hypot(b.x - cam.x, b.z - cam.z) > 180;
      b.g.visible = !far;
      b.t += dt;
      if (b.state === 'stand') {
        if (far) continue;
        const d = Math.hypot(src.x - b.x, src.z - b.z);
        if (d < scare && !p.dead) {
          this.takeOff(b, src.x, src.z);
          continue;
        }
        // stalk: a slow step or a turn now and then; dip to fish
        b.next -= dt;
        if (b.next <= 0) {
          b.next = this.rng.range(3, 9);
          b.h += this.rng.range(-0.9, 0.9);
        }
        const dip = Math.max(0, Math.sin(b.t * 0.7 + b.ph) - 0.85) * 6.5;
        b.neck.rotation.x = dip * 0.9;
        for (const w of b.wings) {
          w.rotation.z = 0;
          w.scale.x = 0.35;
        }
        b.legs.visible = true;
      } else {
        // fly: slow deep wingbeats, a climb to cruise height, a glide down to land
        b.u += (9 / Math.max(1, b.len)) * dt;
        const u = clamp(b.u, 0, 1);
        b.x = b.fx + (b.tx - b.fx) * u;
        b.z = b.fz + (b.tz - b.fz) * u;
        const cruise = Math.min(22, 6 + b.len * 0.15);
        b.y = b.fy + (b.ty - b.fy) * u + Math.sin(u * Math.PI) * cruise;
        const glide = u > 0.55 && u < 0.9;
        for (let k = 0; k < 2; k++) {
          const s = k ? 1 : -1;
          b.wings[k].scale.x = 1;
          b.wings[k].rotation.z = s * (glide ? 0.08 : Math.sin(b.t * 6.5 + b.ph) * 0.7);
        }
        b.neck.rotation.x = 0.9;
        b.legs.visible = u > 0.9 || u < 0.08;
        if (u >= 1) {
          b.state = 'stand';
          b.y = b.ty;
          b.next = this.rng.range(2, 6);
        }
      }
      b.g.position.set(b.x, b.y, b.z);
      b.g.rotation.y = wrapAngle(b.h);
    }
  }
}
