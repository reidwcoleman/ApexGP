import * as THREE from 'three';
import type { CourseBuilder } from './builder.ts';
import { Mode, type Marble } from './physics.ts';
import { glowMat } from './obs-world.ts';

/**
 * Telegraphed hits from above or below: a ring closes in on a spot, then whatever's on it is thrown.
 * Crown Keeper's cannonballs, Meltdown's snowballs and High Tide's geysers. Each is a pure function of
 * the round's clock, so every browser sees the same ones; each browser throws its own beans.
 */
export interface Hit3 {
  /** seconds after the off */
  t: number;
  x: number;
  y: number;
  z: number;
  r: number;
}
export interface Strikes {
  /** the ones landing between t0 and t1 */
  between(t0: number, t1: number, out: Hit3[]): Hit3[];
  warn: number;
}

export function addStrikes(
  b: CourseBuilder,
  o: { list: Hit3[]; warn: number; state: { go: number }; ring: number; ball?: { color: number; r: number }; jet?: number; box: [THREE.Vector3, THREE.Vector3]; out: number; up: number; onHit?: (m: Marble) => void },
): Strikes {
  const list = [...o.list].sort((p, q) => p.t - q.t);
  const between = (t0: number, t1: number, out: Hit3[]) => {
    out.length = 0;
    let lo = 0, hi = list.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (list[m].t < t0) lo = m + 1;
      else hi = m;
    }
    for (let i = lo; i < list.length && list[i].t < t1; i++) out.push(list[i]);
    return out;
  };
  const POOL = 10;
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.84, 1, 40).rotateX(-Math.PI / 2), glowMat(o.ring, 2.2, { transparent: true, opacity: 0.9, depthWrite: false }), POOL);
  const discs = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: o.ring, transparent: true, opacity: 0.24, depthWrite: false }), POOL);
  const balls = o.ball ? new THREE.InstancedMesh(new THREE.SphereGeometry(o.ball.r, 18, 12), new THREE.MeshStandardMaterial({ color: o.ball.color, roughness: 0.4, metalness: 0.2 }), POOL) : null;
  const jets = o.jet !== undefined ? new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 1, 1, 14, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: o.jet, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }), POOL) : null;
  for (const im of [rings, discs, balls, jets]) {
    if (!im) continue;
    im.frustumCulled = false;
    im.count = 0;
    b.group.add(im);
  }
  if (balls) balls.castShadow = true;
  const live: Hit3[] = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3();
  b.animators.push((t) => {
    const x = t - o.state.go;
    between(x - 0.5, x + o.warn, live);
    let nr = 0, nb = 0, nj = 0;
    for (const s of live) {
      const dt = s.t - x;
      if (dt > 0 && nr < POOL) {
        const k = 1 - dt / o.warn;
        rings.setMatrixAt(nr, M.compose(V.set(s.x, s.y + 0.06, s.z), Q, S.setScalar(s.r * (1.6 - 0.6 * k))));
        discs.setMatrixAt(nr, M.compose(V.set(s.x, s.y + 0.05, s.z), Q, S.setScalar(s.r * (0.3 + 0.7 * k))));
        nr++;
        // (a ball on its way down, the last part of the wait)
        if (balls && nb < POOL && k > 0.45) {
          const u = (1 - k) / 0.55;
          balls.setMatrixAt(nb++, M.compose(V.set(s.x, s.y + 0.5 + u * u * 34, s.z), Q, S.setScalar(1)));
        }
      } else if (dt <= 0 && jets && nj < POOL) {
        const h = 9 * Math.sin(Math.min(1, -dt / 0.5) * Math.PI);
        jets.setMatrixAt(nj++, M.compose(V.set(s.x, s.y, s.z), Q, S.set(s.r, Math.max(0.01, h), s.r)));
      }
    }
    rings.count = discs.count = nr;
    rings.instanceMatrix.needsUpdate = discs.instanceMatrix.needsUpdate = true;
    if (balls) {
      balls.count = nb;
      balls.instanceMatrix.needsUpdate = true;
    }
    if (jets) {
      jets.count = nj;
      jets.instanceMatrix.needsUpdate = true;
    }
  });
  const hitBy = new Map<number, number>();
  const now: Hit3[] = [];
  b.world.fields.push({
    min: o.box[0],
    max: o.box[1],
    act: (m, t) => {
      const x = t - o.state.go;
      if (x < 0) return;
      between(x - 0.1, x, now);
      for (const s of now) {
        const dx = m.pos.x - s.x, dz = m.pos.z - s.z, d = Math.hypot(dx, dz);
        if (d > s.r + 0.3 || Math.abs(m.pos.y - s.y) > 2.4) continue;
        if (hitBy.get(m.id) === s.t) continue;
        hitBy.set(m.id, s.t);
        const ux = d > 0.2 ? dx / d : Math.cos(s.t * 13), uz = d > 0.2 ? dz / d : Math.sin(s.t * 13);
        m.vel.x = ux * o.out;
        m.vel.z = uz * o.out;
        m.vel.y = o.up;
        m.groundT = 1;
        if (m.mode !== Mode.Tumble) m.knock(1);
        o.onHit?.(m);
      }
    },
  });
  return { between, warn: o.warn };
}

/** a bot's way out of the rings it has seen: a direction, or null if it's clear */
const SEEN: Hit3[] = [];
export function dodge(S0: Strikes, m: Marble, x: number, react: number): [number, number] | null {
  S0.between(x, x + S0.warn - react, SEEN);
  let fx = 0, fz = 0;
  for (const s of SEEN) {
    const dx = m.pos.x - s.x, dz = m.pos.z - s.z, d = Math.hypot(dx, dz), r = s.r + 0.9;
    if (d > r || Math.abs(m.pos.y - s.y) > 2.4) continue;
    fx += (d > 0.1 ? dx / d : 1) * (r - d);
    fz += (d > 0.1 ? dz / d : 0) * (r - d);
  }
  const l = Math.hypot(fx, fz);
  return l > 0.01 ? [fx / l, fz / l] : null;
}
