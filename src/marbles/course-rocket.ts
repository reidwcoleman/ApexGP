import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat, Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { title } from './course-modes.ts';

/**
 * Rocket Rumble: everyone has a jetpack and not much in it. Hold JUMP to fly; a pad fills you up
 * slowly, a ring all at once. DIVE is a ram: catch someone in the air and they go spinning with no
 * thrust until they gather themselves, and it's a long way down to the sea. The pads go one by one,
 * the rings go out, and mines drift in. Last ones flying go through. It's all a function of the
 * clock; each browser flies its own beans.
 */
export const ROCKET = {
  /** seconds of thrust in a full tank */
  fuel: 3.3,
  thrust: 50,
  /** the fastest it climbs, and the ceiling */
  climb: 11,
  ceil: 19,
  /** fuel a second on a pad, and from a ring */
  regen: 0.85,
  ring: 2.2,
  /** the wait before the same ring fills you again */
  ringWait: 4,
  /** how long a ram leaves you without thrust */
  stun: 0.85,
  /** the first pad goes at this time, then one every `every`, with `warn` of shaking */
  padAt: 20,
  every: 8,
  warn: 3.5,
  /** the rings go out one by one from here, and the big pad goes last of all */
  ringsOut: 62,
  lastPad: 104,
  minesAt: 15,
};

export interface RocketPad {
  x: number;
  z: number;
  y: number;
  r: number;
  /** when it goes (seconds after the off) */
  out: number;
}
export interface RocketRing {
  k: number;
  /** on at the time, gone from `out` */
  out: number;
}
export interface RocketArena {
  center: THREE.Vector3;
  pads: RocketPad[];
  /** a pad's top right now (null: it's gone) */
  padY(p: RocketPad, x: number): number | null;
  rings: RocketRing[];
  ringAt(i: number, x: number, o: THREE.Vector3): THREE.Vector3;
  mines: Kin[];
  /** what's in each bean's tank */
  fuel: Map<number, number>;
  /** each bean's last ring, for the game to flash */
  filled: Map<number, number>;
  /** who's thrusting this frame */
  burning: Set<number>;
}

const PAD_COLS = [0xff4f7a, 0xffb02f, 0x37d07a, 0x2fa8ff, 0xb05aff];

export function rocketRumble(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 118, 0);
  const y0 = center.y;
  b.lakeY = y0 - 34;
  const state = { go: 1e9 };
  const R = ROCKET;

  // ---- the pads: a big one in the middle and a ring of small ones round it
  const pads: RocketPad[] = [{ x: 0, z: 0, y: 0, r: 5.2, out: R.lastPad }];
  const OUTER = 9;
  const order = [3, 7, 1, 5, 8, 2, 6, 0, 4];
  for (let k = 0; k < OUTER; k++) {
    const a = (k / OUTER) * Math.PI * 2;
    const r = k % 2 ? 19 : 14.5;
    pads.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: (k % 3) * 2.2 - 1, r: 3.8, out: R.padAt + order.indexOf(k) * R.every });
  }
  const padY = (p: RocketPad, x: number) => {
    const u = x - p.out;
    if (u > 2.2) return null;
    const bob = Math.sin(x * 0.8 + p.x) * 0.25;
    const shake = u > -R.warn && u < 0 ? Math.sin(x * 40) * 0.09 : 0;
    return y0 + p.y + bob + shake - (u > 0 ? u * u * 14 : 0);
  };
  pads.forEach((p, i) => {
    const hh = 0.5;
    const kin = new Kin({ type: 'cyl', r: p.r, hh }, Mat.Paint, (t, pos, q) => {
      const x = Math.max(0, t - state.go);
      const y = padY(p, state.go < 1e8 ? x : 0);
      pos.set(center.x + p.x, (y ?? y0 - 200) - hh, center.z + p.z);
      q.identity();
    });
    const g = new THREE.Group();
    const col = PAD_COLS[i % PAD_COLS.length];
    const top = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r * 0.92, hh * 2, 40), new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.32, clearcoat: 1 }));
    const under = new THREE.Mesh(new THREE.ConeGeometry(p.r * 0.86, p.r * 0.9, 32).rotateX(Math.PI).translate(0, -hh - p.r * 0.45, 0), new THREE.MeshPhysicalMaterial({ color: 0x2e2a44, metalness: 0.5, roughness: 0.4 }));
    const lamp = glowMat(0xfff0a0, 2.4);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(p.r - 0.28, 0.1, 8, 44).rotateX(Math.PI / 2).translate(0, hh + 0.02, 0), lamp);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(p.r * 0.5, 6).rotateX(-Math.PI / 2).translate(0, hh + 0.02, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 }));
    const jet = new THREE.Mesh(new THREE.ConeGeometry(p.r * 0.34, 3.2, 14, 1, true).rotateX(Math.PI).translate(0, -hh - p.r * 0.9 - 1.5, 0), new THREE.MeshBasicMaterial({ color: 0x8ae8ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    g.add(top, under, rim, pad, jet);
    b.obstacle(kin, g, false);
    b.animators.push((t) => {
      const x = state.go < 1e8 ? t - state.go : 0;
      const danger = x > p.out - R.warn && x < p.out + 3;
      lamp.color.set(danger ? (Math.sin(t * 22) > 0 ? 0xff2020 : 0xffd020) : 0xfff0a0).multiplyScalar(2.4);
      jet.scale.y = 0.8 + Math.sin(t * 30 + i) * 0.2;
      jet.visible = x < p.out;
      g.visible = x < p.out + 3;
    });
  });

  // ---- the fuel rings, flying round
  const NR = 7;
  const rings: RocketRing[] = [];
  for (let k = 0; k < NR; k++) rings.push({ k, out: R.ringsOut + (NR - 1 - k) * 8 });
  const ringAt = (i: number, x: number, o: THREE.Vector3) => {
    const dir = i % 2 ? 1 : -1;
    const a = (i / NR) * Math.PI * 2 + dir * x * (0.21 + (i % 3) * 0.05);
    const r = 9 + (i % 3) * 5.5 + Math.sin(x * 0.3 + i) * 1.6;
    return o.set(center.x + Math.cos(a) * r, y0 + 6 + (i % 4) * 2.2 + Math.sin(x * 0.6 + i * 1.3) * 1.5, center.z + Math.sin(a) * r);
  };
  const ringG = new THREE.TorusGeometry(2.2, 0.22, 12, 40);
  const ringMesh = rings.map(() => {
    const o = new THREE.Mesh(ringG, glowMat(0x4af0ff, 2.6));
    const core = new THREE.Mesh(new THREE.CircleGeometry(2, 28), new THREE.MeshBasicMaterial({ color: 0x4af0ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    o.add(core);
    b.group.add(o);
    return o;
  });
  const RP = new THREE.Vector3();
  b.animators.push((t) => {
    const x = state.go < 1e8 ? Math.max(0, t - state.go) : 0;
    ringMesh.forEach((o, i) => {
      ringAt(i, x, RP);
      o.position.copy(RP);
      o.rotation.y = t * 0.8 + i;
      const left = rings[i].out - x;
      o.visible = left > 0 && (left > 3 || Math.sin(t * 20) > 0);
    });
  });

  // ---- mines
  const mines: Kin[] = [];
  for (let k = 0; k < 7; k++) {
    const P = new THREE.Vector3();
    const kin = new Kin({ type: 'sph', r: 1 }, Mat.Bumper, (t, p, q) => {
      const x = t - state.go - R.minesAt - k * 7;
      if (x < 0) {
        p.set(center.x, y0 - 90, center.z);
        q.identity();
        return;
      }
      const a = k * 2.4 + x * (k % 2 ? 0.26 : -0.21);
      const r = 6 + (k % 4) * 4.4 + Math.sin(x * 0.4 + k) * 2.2;
      P.set(center.x + Math.cos(a) * r, y0 + 3 + (k % 3) * 3 + Math.sin(x * 0.7 + k) * 2, center.z + Math.sin(a) * r);
      p.copy(P);
      q.setFromAxisAngle(new THREE.Vector3(0.3, 1, 0.2).normalize(), x);
    });
    kin.kick = 8;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshPhysicalMaterial({ color: 0x241a30, metalness: 0.6, roughness: 0.35 })));
    const spikeM = new THREE.MeshPhysicalMaterial({ color: 0xff3a30, emissive: 0xff2010, emissiveIntensity: 1.2 });
    const ico = new THREE.IcosahedronGeometry(1, 0).getAttribute('position');
    const seen = new Set<string>();
    for (let i = 0; i < ico.count; i++) {
      const d = new THREE.Vector3().fromBufferAttribute(ico, i).normalize();
      const key = d.toArray().map((v) => v.toFixed(2)).join();
      if (seen.has(key)) continue;
      seen.add(key);
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 8), spikeM);
      s.position.copy(d).multiplyScalar(1.1);
      s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      g.add(s);
    }
    b.obstacle(kin, g, false);
    mines.push(kin);
  }

  // ---- the jetpacks
  const fuel = new Map<number, number>();
  const filled = new Map<number, number>();
  const burning = new Set<number>();
  const ringGot = new Map<number, number>();
  const stunned = new Map<number, number>();
  const RG = new THREE.Vector3();
  b.world.fields.push({
    min: new THREE.Vector3(center.x - 60, y0 - 40, center.z - 60),
    max: new THREE.Vector3(center.x + 60, y0 + 60, center.z + 60),
    act: (m: Marble, t: number, dt: number) => {
      burning.delete(m.id);
      if (t < state.go) return;
      const x = t - state.go;
      let f = fuel.get(m.id) ?? R.fuel;
      const air = m.groundT > 0.1;
      if (!air) f = Math.min(R.fuel, f + R.regen * dt);
      // (spinning in the air: a moment without thrust, then you've got it back, if it isn't too late)
      if (m.mode === Mode.Tumble) {
        if (!stunned.has(m.id)) stunned.set(m.id, t + R.stun);
        if (air && t > (stunned.get(m.id) ?? 0)) {
          m.mode = Mode.Run;
          m.tumbleT = 0;
          m.guardT = 0.7;
          m.ang.set(0, 0, 0);
        }
      } else stunned.delete(m.id);
      if (m.jet && f > 0 && m.mode !== Mode.Tumble) {
        // (out of a ram: thrust takes you back upright)
        if (m.mode === Mode.Dive) m.mode = Mode.Run;
        if (m.vel.y < R.climb) m.vel.y = Math.min(R.climb, m.vel.y + R.thrust * dt);
        f = Math.max(0, f - dt);
        m.groundT = Math.max(m.groundT, 0.2);
        burning.add(m.id);
      }
      if (m.pos.y > y0 + R.ceil && m.vel.y > 0) m.vel.y *= 1 - Math.min(1, 9 * dt);
      for (let i = 0; i < rings.length; i++) {
        if (x >= rings[i].out) continue;
        ringAt(i, x, RG);
        if (RG.distanceToSquared(m.pos) < 3 * 3) {
          const k = m.id * 16 + i;
          if (t - (ringGot.get(k) ?? -9) > R.ringWait) {
            ringGot.set(k, t);
            f = Math.min(R.fuel, f + R.ring);
            filled.set(m.id, t);
          }
        }
      }
      fuel.set(m.id, f);
    },
  });

  title(b, info, 'Hold JUMP to fly · Last ones up', 0xffb02f, new THREE.Vector3(center.x, y0 + 11, center.z - 26));
  dressArena(b, new THREE.Vector3(center.x, y0 - 8, center.z), 26, 83);
  b.finish();
  const arena: RocketArena = { center, pads, padY, rings, ringAt, mines, fuel, filled, burning };
  return {
    id: 'rocketrumble',
    name: info.name,
    kind: 'survival',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 24,
    lakeY: b.lakeY,
    state,
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      const outer = pads.slice(1);
      for (let k = 0; k < n; k++) {
        const p = outer[k % outer.length];
        const a = Math.floor(k / outer.length) * 2.1 + k;
        const r = k < outer.length ? 0 : 1.9;
        const pos = new THREE.Vector3(center.x + p.x + Math.cos(a) * r, y0 + p.y + 0.8, center.z + p.z + Math.sin(a) * r);
        out.push({ pos, yaw: Math.atan2(-p.x, -p.z) });
      }
      return out;
    },
    plate: { center, radius: 22, bars: [] },
    rocket: arena,
    intro: [],
  };
}
