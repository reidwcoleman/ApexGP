import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { ringGrid, title } from './course-modes.ts';

/**
 * Bumper Bash: everyone in a dodgem on a neon rink with no sides. Ram the others off it. Every hit
 * you take is damage, and damage is how far the next one throws you. A knockout is points to
 * whoever hit you last; you drop back in from the sky and go again. The rink comes apart ring by
 * ring, the arm in the middle speeds up, and at the end everything counts double.
 *
 * Each browser drives its own cars and feels its own hits, from where it sees everyone else (so
 * nothing has to be told to anyone but the score). The rink and its hazards are a function of the
 * clock, the same everywhere.
 */
export const CAR = {
  T: 90,
  /** the rings of the rink, from the middle out, and when each one goes */
  rings: [
    { r: 15, at: Infinity },
    { r: 22, at: 62 },
    { r: 29, at: 32 },
  ],
  warn: 6,
  frenzy: 15,
  /** a car's size, for hitting things */
  r: 1.2,
  top: 15,
  acc: 34,
  /** how fast it slows with nothing pressed, and how hard the tyres hold a line */
  coast: 0.75,
  grip: 6,
  turn: 6.4,
  boost: 16,
  boostMax: 31,
  /** seconds between boosts */
  cd: 2,
  cdFrenzy: 1.1,
  /** how lively a hit is; a car boosting hits as hard as this many */
  e: 0.9,
  mass: 3,
  /** thrown this hard, the car spins out with no steering */
  stunAt: 9,
  stun: 0.34,
  /** damage: what a hit adds, the most there is, and how much further it throws you */
  dmg: 1 / 130,
  dmgMax: 1.5,
  dmgK: 0.6,
  /** a fall this far is a knockout; the last hit this recent gets the credit */
  fall: 13,
  credit: 7,
  /** back in from this high, and no one can touch you till a moment after you land */
  back: 15,
  ghost: 3.2,
  bumper: 11,
  arm: 12,
  armLen: 7.4,
  armH: 0.9,
  /** the points */
  ko: 100,
  chain: 50,
  chainT: 6,
  crown: 100,
  knocked: 25,
  fell: 50,
};

export interface CarState {
  /** where it points (the velocity is free to slide off it) */
  yaw: number;
  /** seconds to the next boost */
  cd: number;
  /** steering's gone for this long, and it's spinning this fast */
  stun: number;
  spin: number;
  dmg: number;
  /** can't be touched until (world time) */
  ghost: number;
  /** it just boosted (the game's sound and the flame) */
  fired: boolean;
  flame: number;
}

export interface Bumper {
  x: number;
  z: number;
  r: number;
  ring: number;
  hit: number;
}

export interface BumpArena {
  center: THREE.Vector3;
  R: number;
  car(id: number): CarState;
  /** the floor left, x seconds after the off */
  radius(x: number): number;
  /** the next ring to go (null: none left) */
  next(x: number): { ring: number; at: number } | null;
  /** the arm's angle at x */
  arm(x: number): number;
  bumpers: Bumper[];
  gone(ring: number, x: number): boolean;
  frenzy(x: number): boolean;
  /** back in from the sky */
  respawn(m: Marble, t: number): void;
}

const fallOf = (x: number, at: number) => (x > at ? 15 * (x - at) ** 2 : 0);

function floorArt() {
  const S = 2048, c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const k = S / 2 / 29.6;
  x.fillStyle = '#0b0a24';
  x.fillRect(0, 0, S, S);
  x.translate(S / 2, S / 2);
  const bands = [
    { r0: 0, r1: 15, a: '#1c1250', b: '#28186e', n: 24 },
    { r0: 15, r1: 22, a: '#10204f', b: '#16306e', n: 36 },
    { r0: 22, r1: 29.6, a: '#3a0f46', b: '#551763', n: 48 },
  ];
  for (const q of bands) {
    for (let s = 0; s < q.n; s++) {
      x.beginPath();
      x.arc(0, 0, q.r1 * k, (s / q.n) * Math.PI * 2, ((s + 1) / q.n) * Math.PI * 2);
      x.arc(0, 0, q.r0 * k, ((s + 1) / q.n) * Math.PI * 2, (s / q.n) * Math.PI * 2, true);
      x.closePath();
      x.fillStyle = s % 2 ? q.a : q.b;
      x.fill();
    }
  }
  // the glowing rings, and the chevrons that say which way is the middle
  x.shadowBlur = 24;
  for (const [r, col] of [[14.7, '#38e8ff'], [21.7, '#ffe14a'], [28.9, '#ff3f9e']] as const) {
    x.strokeStyle = col;
    x.shadowColor = col;
    x.lineWidth = 11;
    x.beginPath();
    x.arc(0, 0, r * k, 0, 7);
    x.stroke();
  }
  x.lineWidth = 6;
  for (const [r, n, col] of [[18.4, 12, '#38e8ff'], [25.6, 16, '#ffe14a']] as const) {
    x.strokeStyle = col;
    x.shadowColor = col;
    for (let s = 0; s < n; s++) {
      const a = (s / n) * Math.PI * 2;
      x.save();
      x.rotate(a);
      x.translate(r * k, 0);
      x.beginPath();
      x.moveTo(26, -34);
      x.lineTo(-10, 0);
      x.lineTo(26, 34);
      x.stroke();
      x.restore();
    }
  }
  x.shadowBlur = 0;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function bumperBash(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 120, 0);
  const y0 = center.y, cx = center.x, cz = center.z;
  const R = CAR.rings[CAR.rings.length - 1].r;
  const state = { go: 1e9 };
  b.lakeY = y0 - 34;
  const clock = (t: number) => (state.go > 1e8 ? 0 : t - state.go);
  const gone = (ring: number, x: number) => x >= CAR.rings[ring].at;
  // ---- the floor: one disc per ring, the outer ones dropping out from under you
  const tx = floorArt();
  CAR.rings.forEach((ring, i) => {
    const r0 = i ? CAR.rings[i - 1].r : 0;
    const kin = new Kin({ type: 'cyl', r: ring.r, hh: 1 }, Mat.Wood, (t, p) => p.set(cx, y0 - 1 - fallOf(clock(t), ring.at), cz));
    b.world.addKin(kin);
    const g = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ map: tx, emissive: 0xffffff, emissiveMap: tx, emissiveIntensity: 0.55, roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.3 });
    const top = new THREE.RingGeometry(Math.max(0.01, r0), ring.r, 128, 2).rotateX(-Math.PI / 2);
    const pos = top.getAttribute('position') as THREE.BufferAttribute, uv = top.getAttribute('uv') as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) uv.setXY(k, 0.5 + pos.getX(k) / 59.2, 0.5 - pos.getZ(k) / 59.2);
    const floor = new THREE.Mesh(top, mat);
    floor.receiveShadow = true;
    g.add(floor);
    const rimCol = [0x38e8ff, 0xffe14a, 0xff3f9e][i];
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(ring.r, ring.r - 2.6, 3.2, 96, 1, true).translate(0, -1.6, 0), new THREE.MeshPhysicalMaterial({ color: 0x1a1640, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }));
    g.add(skirt);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(ring.r - 0.05, 0.13, 8, 128).rotateX(Math.PI / 2), glowMat(rimCol, 2.2));
    g.add(rim);
    g.position.copy(center);
    b.group.add(g);
    b.animators.push((t) => {
      const x = clock(t), left = ring.at - x;
      g.position.y = y0 - fallOf(x, ring.at);
      g.visible = g.position.y > y0 - 60;
      // (about to go: it flashes and rattles)
      if (left < CAR.warn && left > 0) {
        const f = Math.sin(t * (8 + (CAR.warn - left) * 3)) * 0.5 + 0.5;
        mat.emissive.setRGB(1, 0.35 + 0.65 * (1 - f), 0.35 + 0.65 * (1 - f));
        mat.emissiveIntensity = 0.55 + f * 0.9;
        g.position.x = cx + Math.sin(t * 61) * 0.03 * (CAR.warn - left);
      }
    });
  });
  // ---- the humps: at speed they're a little hop, on a boost they're a launch
  {
    const hr = 9, up = 0.8;
    const cap = new THREE.SphereGeometry(hr, 40, 10, 0, Math.PI * 2, 0, Math.acos((hr - up) / hr));
    const mat = new THREE.MeshPhysicalMaterial({ color: 0x38e8ff, emissive: 0x1090c0, emissiveIntensity: 0.8, roughness: 0.3, clearcoat: 1 });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5, x = cx + Math.cos(a) * 10.8, z = cz + Math.sin(a) * 10.8;
      b.world.addKin(new Kin({ type: 'sph', r: hr }, Mat.Wood, (_, p) => p.set(x, y0 + up - hr, z)));
      const m = new THREE.Mesh(cap, mat);
      m.position.set(x, y0 + up - hr, z);
      m.receiveShadow = true;
      b.group.add(m);
    }
  }
  // ---- the bumpers: touch one and it throws you
  const bumpers: Bumper[] = [];
  {
    const put = (r: number, n: number, ring: number, a0: number) => {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + a0;
        bumpers.push({ x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, r: 1.45, ring, hit: -9 });
      }
    };
    put(11, 3, 0, 0.5 + Math.PI / 3);
    put(18.5, 5, 1, 0.2);
    put(25.6, 6, 2, 0.9);
    const n = bumpers.length;
    const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.45, 1.6, 1.3, 28).translate(0, 0.65, 0), new THREE.MeshPhysicalMaterial({ color: 0xf4f4ff, roughness: 0.25, clearcoat: 1 }), n);
    const cap = new THREE.InstancedMesh(new THREE.SphereGeometry(1.5, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1).translate(0, 1.3, 0), glowMat(0xff3f9e, 1.7), n);
    const band = new THREE.InstancedMesh(new THREE.TorusGeometry(1.52, 0.1, 8, 36).rotateX(Math.PI / 2).translate(0, 1.1, 0), glowMat(0xfff4a0, 2.4), n);
    stem.castShadow = cap.castShadow = true;
    stem.frustumCulled = cap.frustumCulled = band.frustumCulled = false;
    b.group.add(stem, cap, band);
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion();
    b.animators.push((t) => {
      const x = clock(t);
      bumpers.forEach((q, k) => {
        const hit = Math.max(0, 1 - (t - q.hit) * 6);
        P.set(q.x, y0 - fallOf(x, CAR.rings[q.ring].at), q.z);
        S.set(1 + hit * 0.22, 1 - hit * 0.14, 1 + hit * 0.22);
        M.compose(P, Q, S);
        stem.setMatrixAt(k, M);
        cap.setMatrixAt(k, M);
        band.setMatrixAt(k, M);
      });
      stem.instanceMatrix.needsUpdate = cap.instanceMatrix.needsUpdate = band.instanceMatrix.needsUpdate = true;
    });
  }
  // ---- the arm: goes round the middle, faster and faster. Hop it or get swatted
  const arm = (x: number) => 0.8 * x + 0.0075 * x * x;
  {
    const L = CAR.armLen;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 2.4, 3.2, 32).translate(cx, y0 + 1.6, cz), new THREE.MeshPhysicalMaterial({ color: 0x2a2470, roughness: 0.3, metalness: 0.6, clearcoat: 1 }));
    post.castShadow = true;
    const crown = new THREE.Mesh(new THREE.TorusGeometry(2, 0.16, 8, 40).rotateX(Math.PI / 2).translate(cx, y0 + 3.2, cz), glowMat(0x38e8ff, 2.4));
    const g = new THREE.Group();
    g.position.set(cx, y0, cz);
    const body = new THREE.MeshPhysicalMaterial({ color: 0xffd23a, emissive: 0xff8a10, emissiveIntensity: 0.55, roughness: 0.3, clearcoat: 1 });
    const bar = new THREE.Mesh(new THREE.BoxGeometry(L * 2, 0.5, 0.62).translate(0, CAR.armH - 0.25, 0), body);
    bar.castShadow = true;
    g.add(bar);
    for (const s of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14).translate(s * L, CAR.armH - 0.25, 0), glowMat(0xff3f20, 2));
      g.add(end);
    }
    b.group.add(post, crown, g);
    b.animators.push((t) => {
      g.rotation.y = -arm(clock(t));
    });
  }
  // ---- how a dodgem drives. The bean's own running is switched off (grip 0): this is all of it
  const cars = new Map<number, CarState>();
  const car = (id: number) => {
    let c = cars.get(id);
    if (!c) cars.set(id, (c = { yaw: NaN, cd: 0, stun: 0, spin: 0, dmg: 0, ghost: 0, fired: false, flame: 0 }));
    return c;
  };
  const drive = (m: Marble, t: number, dt: number) => {
    const c = car(m.id);
    m.noFace = true;
    if (Number.isNaN(c.yaw)) c.yaw = m.yaw;
    const x = t - state.go;
    const inp = m.input;
    const il = Math.min(1, Math.hypot(inp.x, inp.z));
    c.cd = Math.max(0, c.cd - dt);
    c.stun = Math.max(0, c.stun - dt);
    c.flame = Math.max(0, c.flame - dt);
    const free = c.stun <= 0;
    let off = 0;
    if (free && il > 0.1) {
      off = Math.atan2(inp.x, inp.z) - c.yaw;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      c.yaw += THREE.MathUtils.clamp(off, -CAR.turn * dt, CAR.turn * dt);
    } else if (!free) c.yaw += c.spin * dt;
    // the boost: wherever you're steering, on the ground or (the save) in the air
    if (m.dash) {
      m.dash = false;
      if (c.cd <= 0 && free) {
        if (il > 0.2) c.yaw = Math.atan2(inp.x, inp.z);
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        const along = m.vel.x * fx + m.vel.z * fz;
        const to = Math.min(CAR.boostMax, Math.max(along, 0) + CAR.boost);
        if (to > along) {
          m.vel.x += fx * (to - along);
          m.vel.z += fz * (to - along);
        }
        if (m.groundT > 0.12) m.vel.y = Math.max(m.vel.y, 6);
        c.cd = x > CAR.T - CAR.frenzy ? CAR.cdFrenzy : CAR.cd;
        c.fired = true;
        c.flame = 0.5;
      }
    }
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    if (m.groundT < 0.1) {
      let along = m.vel.x * fx + m.vel.z * fz;
      let side = m.vel.x * fz - m.vel.z * fx;
      const push = free ? il * Math.max(0, Math.cos(off)) : 0;
      if (along < CAR.top && push > 0.02) along = Math.min(CAR.top, along + CAR.acc * push * dt);
      // (over the top speed: a boost, or a hit, wearing off)
      else if (along > CAR.top) along -= (along - CAR.top) * Math.min(1, 1.5 * dt);
      if (push < 0.3) along *= Math.exp(-CAR.coast * dt);
      side *= Math.exp(-(free ? CAR.grip : 1) * dt);
      m.vel.x = fx * along + fz * side;
      m.vel.z = fz * along - fx * side;
    } else if (free && il > 0.1) {
      // (a little steer in the air)
      m.vel.x += inp.x * 5 * dt;
      m.vel.z += inp.z * 5 * dt;
    }
    // (however it got going: nothing crosses the rink in a blink)
    const hs = Math.hypot(m.vel.x, m.vel.z);
    if (hs > 36) {
      m.vel.x *= 36 / hs;
      m.vel.z *= 36 / hs;
    }
    m.yaw = c.yaw;
    inp.set(0, 0, 0);
  };
  b.world.fields.push({
    min: new THREE.Vector3(cx - 200, y0 - 80, cz - 200),
    max: new THREE.Vector3(cx + 200, y0 + 60, cz + 200),
    grip: 0,
    jump: 0.88,
    act: drive,
  });
  // ---- round the edge: a dotted line of lamps on each ring's rim is in the art; the sign and the view
  title(b, info, 'Ram them off · Most points go through', 0xff3f9e, new THREE.Vector3(cx, y0 + 11, cz - R - 9));
  dressArena(b, new THREE.Vector3(cx, y0 - 6, cz), R + 10, 71);
  b.finish();
  const radius = (x: number) => {
    let r = CAR.rings[0].r;
    for (const q of CAR.rings) if (x < q.at) r = Math.max(r, q.r);
    return r;
  };
  let sd = 90411;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  return {
    id: 'bumperbash',
    name: info.name,
    kind: 'score',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 60,
    lakeY: b.lakeY,
    state,
    grid: (n) => ringGrid(center, n, 21, 4.2, 12).map((g) => ({ ...g, pos: g.pos.clone().setY(y0 + 0.55) })),
    plate: { center, radius: R, bars: [] },
    bump: {
      center,
      R,
      car,
      radius,
      next: (x) => {
        let best: { ring: number; at: number } | null = null;
        CAR.rings.forEach((q, ring) => {
          if (q.at > x && q.at < 1e6 && (!best || q.at < best.at)) best = { ring, at: q.at };
        });
        return best;
      },
      arm,
      bumpers,
      gone,
      frenzy: (x) => x > CAR.T - CAR.frenzy,
      respawn: (m, t) => {
        const c = car(m.id);
        const x = t - state.go, r = (radius(x) - 3.5) * Math.sqrt(rnd()), a = rnd() * Math.PI * 2;
        m.pos.set(cx + Math.cos(a) * Math.max(r, 7), y0 + CAR.back, cz + Math.sin(a) * Math.max(r, 7));
        m.vel.set(0, 0, 0);
        m.hitBy = -1;
        c.yaw = Math.atan2(cx - m.pos.x, cz - m.pos.z);
        m.yaw = c.yaw;
        c.dmg = 0;
        c.stun = 0;
        c.cd = 0;
        c.ghost = t + CAR.ghost;
      },
    },
    intro: [],
  };
}
