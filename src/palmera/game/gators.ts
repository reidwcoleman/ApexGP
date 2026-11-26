// Alligators in the swamp: most bask at pond edges, head on the bank and tail in the water, swaying
// the tail and now and then gaping in the sun; a few cruise the ponds with only eyes and back showing.
// Walk within 9 m and a basking one swings round to face you, jaws open; closer than 2.8 m and it
// lunges and bites, then settles back. Low-poly and original; drawn only within 150 m.
import * as THREE from 'three';
import { Rng, clamp, damp, wrapAngle } from '../core/math';
import { groundAt, pondShape } from '../world/map';
import type { Game } from './game';

interface Gator {
  g: THREE.Group;
  jaw: THREE.Group;
  tail: THREE.Group;
  x: number;
  z: number;
  y: number;
  h: number;
  hx: number;
  hz: number;
  hh: number;
  swim: boolean;
  /** swimmers circle their pond */
  pond?: { x: number; z: number; rx: number; rz: number; a: number };
  state: 'bask' | 'alert' | 'lunge' | 'back';
  t: number;
  cd: number;
  open: number;
  ph: number;
}

let parts: { skin: THREE.Material; eye: THREE.Material; body: THREE.BufferGeometry; tail: THREE.BufferGeometry; head: THREE.BufferGeometry; upper: THREE.BufferGeometry; lower: THREE.BufferGeometry; leg: THREE.BufferGeometry; eyeG: THREE.BufferGeometry; ridge: THREE.BufferGeometry } | null = null;

function kit() {
  if (parts) return parts;
  const body = new THREE.SphereGeometry(1, 14, 8);
  body.scale(0.44, 0.2, 1.05);
  body.translate(0, 0.2, 0);
  const tail = new THREE.ConeGeometry(0.3, 1.9, 8);
  tail.rotateX(-Math.PI / 2);
  tail.scale(1, 0.55, 1);
  tail.translate(0, 0, -0.95);
  const head = new THREE.BoxGeometry(0.42, 0.18, 0.46);
  head.translate(0, 0.21, 0.2);
  const upper = new THREE.BoxGeometry(0.3, 0.09, 0.68);
  upper.translate(0, 0.02, 0.34);
  const lower = new THREE.BoxGeometry(0.27, 0.07, 0.64);
  lower.translate(0, 0.12, 1.27);
  const leg = new THREE.BoxGeometry(0.14, 0.1, 0.32);
  const eyeG = new THREE.SphereGeometry(0.045, 6, 4);
  // the snout narrows to the tip
  for (const jg of [upper, lower]) {
    jg.computeBoundingBox();
    const bb = jg.boundingBox!;
    const pa = jg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const t = (pa.getZ(i) - bb.min.z) / (bb.max.z - bb.min.z);
      pa.setX(i, pa.getX(i) * (1 - 0.45 * t));
    }
    jg.computeVertexNormals();
  }
  const ridge = new THREE.BoxGeometry(0.05, 0.05, 1.7);
  ridge.translate(0, 0.39, -0.1);
  parts = {
    skin: new THREE.MeshStandardMaterial({ color: 0x262d1a, roughness: 0.8 }),
    eye: new THREE.MeshStandardMaterial({ color: 0xc9b23a, roughness: 0.3, emissive: 0x2a2208 }),
    body, tail, head, upper, lower, leg, eyeG, ridge,
  };
  return parts;
}

function build(): { g: THREE.Group; jaw: THREE.Group; tail: THREE.Group } {
  const k = kit();
  const g = new THREE.Group();
  const m = (geo: THREE.BufferGeometry, mat = k.skin) => {
    const o = new THREE.Mesh(geo, mat);
    o.castShadow = true;
    return o;
  };
  g.add(m(k.body), m(k.ridge));
  const headG = new THREE.Group();
  headG.position.set(0, 0, 0.95);
  headG.add(m(k.head));
  // the upper jaw hinges at the back of the head and lifts to gape
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.22, 0.4);
  jaw.add(m(k.upper));
  headG.add(jaw);
  const low = m(k.lower);
  low.position.z = -0.95;
  headG.add(low);
  for (const s of [-1, 1]) {
    const e = m(k.eyeG, k.eye);
    e.position.set(s * 0.13, 0.32, 0.32);
    headG.add(e);
  }
  g.add(headG);
  const tail = new THREE.Group();
  tail.position.set(0, 0.18, -0.95);
  tail.add(m(k.tail));
  g.add(tail);
  for (const [sx, sz] of [[-1, 0.55], [1, 0.55], [-1, -0.55], [1, -0.55]]) {
    const l = m(k.leg);
    l.position.set(sx * 0.42, 0.08, sz);
    l.rotation.y = sx * (sz > 0 ? 0.6 : -0.6);
    g.add(l);
  }
  return { g, jaw, tail };
}

export class Gators {
  readonly list: Gator[] = [];

  constructor(private game: Game) {
    const rng = new Rng(4242);
    const ponds = game.map.flats.filter((f) => f.kind === 'pond');
    if (!ponds.length) return;
    for (let i = 0; i < 18; i++) {
      const f = ponds[Math.floor(rng.next() * ponds.length)];
      const swim = i % 4 === 3;
      const a = rng.range(0, Math.PI * 2);
      const r = pondShape(f, a);
      const ox = Math.cos(a), oz = -Math.sin(a);
      let x: number, z: number, h: number;
      if (swim) {
        x = f.x + ox * (f.w / 2) * r * 0.5;
        z = f.z + oz * (f.d / 2) * r * 0.5;
        h = Math.atan2(-oz, ox);
      } else {
        // on the bank facing out of the water, the tail still in it
        x = f.x + ox * ((f.w / 2) * r + 0.7);
        z = f.z + oz * ((f.d / 2) * r + 0.7);
        h = Math.atan2(ox, oz) + rng.range(-0.6, 0.6);
      }
      const { g, jaw, tail } = build();
      const s = rng.range(0.85, 1.3);
      g.scale.setScalar(s);
      game.scene.add(g);
      const y = swim ? -0.16 : groundAt(x, z);
      this.list.push({ g, jaw, tail, x, z, y, h, hx: x, hz: z, hh: h, swim, pond: swim ? { x: f.x, z: f.z, rx: (f.w / 2) * 0.5, rz: (f.d / 2) * 0.5, a } : undefined, state: 'bask', t: rng.range(0, 10), cd: 0, open: 0, ph: rng.range(0, 6.28) });
    }
  }

  update(dt: number) {
    const g = this.game;
    const cam = g.camera.position;
    const p = g.player;
    const onFoot = !p.vehicle && !p.dead && !p.hidden;
    for (const a of this.list) {
      const far = Math.hypot(a.x - cam.x, a.z - cam.z) > 150;
      a.g.visible = !far;
      if (far) continue;
      a.t += dt;
      const dx = p.pos.x - a.x, dz = p.pos.z - a.z;
      const d = Math.hypot(dx, dz);
      let gape = 0;
      // solid: you can't walk through one
      const rad = 1.25 * a.g.scale.x;
      if (onFoot && d < rad && d > 1e-3 && !a.swim) {
        p.pos.x = a.x + (dx / d) * rad;
        p.pos.z = a.z + (dz / d) * rad;
      }
      if (a.swim) {
        // cruise slowly round the pond
        const pd = a.pond!;
        pd.a += dt * 0.05;
        const tx = pd.x + Math.cos(pd.a) * pd.rx, tz = pd.z - Math.sin(pd.a) * pd.rz;
        const want = Math.atan2(tx - a.x, tz - a.z);
        a.h += wrapAngle(want - a.h) * clamp(dt * 0.8, 0, 1);
        a.x += Math.sin(a.h) * 0.45 * dt;
        a.z += Math.cos(a.h) * 0.45 * dt;
        a.y = -0.16 + Math.sin(a.t * 0.9 + a.ph) * 0.02;
      } else {
        a.cd -= dt;
        if (a.state === 'bask') {
          // sunning: now and then the jaws hang open
          gape = Math.max(0, Math.sin(a.t * 0.13 + a.ph) - 0.6) * 1.2;
          if (onFoot && d < 9) {
            a.state = 'alert';
            g.audio.whoosh();
          }
        } else if (a.state === 'alert') {
          const want = Math.atan2(dx, dz);
          a.h += wrapAngle(want - a.h) * clamp(dt * 2.2, 0, 1);
          gape = 0.55 + Math.sin(a.t * 9) * 0.05;
          if (!onFoot || d > 13) a.state = 'back';
          else if (d < 2.8 && a.cd <= 0 && Math.abs(wrapAngle(want - a.h)) < 0.5) {
            a.state = 'lunge';
            a.t = 0;
          }
        } else if (a.state === 'lunge') {
          // a fast snap forward, jaws shut at the end
          const u = a.t / 0.32;
          gape = u < 0.6 ? 0.8 : 0;
          const step = u < 1 ? 4.5 * dt : 0;
          a.x += Math.sin(a.h) * step;
          a.z += Math.cos(a.h) * step;
          if (u >= 0.6 && a.cd <= 0) {
            a.cd = 2.6;
            if (onFoot && d < 2.3) {
              const killed = p.hurt(18, a.x, a.z, 5);
              g.audio.punch();
              g.hud.hitT = 0.25;
              if (killed) g.onHumanHurt(p, p, true, 'car');
            }
          }
          if (u >= 1.6) a.state = 'alert';
        } else {
          // back to its spot on the bank
          const bx = a.hx - a.x, bz = a.hz - a.z;
          const bd = Math.hypot(bx, bz);
          if (bd > 0.1) {
            const want = Math.atan2(bx, bz);
            a.h += wrapAngle(want - a.h) * clamp(dt * 2, 0, 1);
            a.x += (bx / bd) * Math.min(bd, 1.2 * dt);
            a.z += (bz / bd) * Math.min(bd, 1.2 * dt);
          } else a.h += wrapAngle(a.hh - a.h) * clamp(dt, 0, 1);
          if (bd < 0.1 && Math.abs(wrapAngle(a.hh - a.h)) < 0.05) a.state = 'bask';
          if (onFoot && d < 7) a.state = 'alert';
        }
        a.y = groundAt(a.x, a.z);
      }
      a.open = damp(a.open, gape, 10, dt);
      a.jaw.rotation.x = -a.open * 0.75;
      a.tail.rotation.y = Math.sin(a.t * (a.swim ? 1.6 : 0.5) + a.ph) * (a.swim ? 0.35 : 0.12);
      a.g.position.set(a.x, a.y, a.z);
      a.g.rotation.y = a.h;
    }
  }
}
