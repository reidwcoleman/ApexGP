import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { title } from './course-modes.ts';

/**
 * Big Shot: a ring of cannons round a slippery bullseye in the sky, one bean in each. Steer your
 * barrel, stop the power on the mark, and everyone comes down at once. Then it's a shoving match on
 * ice until the bell: only where you're standing at the bell counts, so a good shot is the start of
 * it, not the end. DIVE in the air slams you down and blasts everyone near off their feet. Each
 * volley adds something: bumpers, a sweeping bar, a bullseye that moves, a floor that turns; the
 * last is worth double. Volleys, hoops and hazards are functions of the clock; each browser fires
 * its own beans, and the host reads the scores at the bell.
 */
export const SHOT = {
  /** the target's radius and its scoring rings */
  R: 15,
  rings: [3, 7, 11.5],
  pts: [50, 25, 10],
  /** the cannons' ring and how high they stand */
  gunR: 33,
  gunH: 3,
  /** seconds a volley, and how long you have to aim */
  V: 13,
  aim: 4.6,
  volleys: 7,
  /** how steep the barrels point */
  pitch: 1.02,
  /** the meter: how far from a perfect shot it swings, and how fast */
  swing: 0.42,
  /** the slam, and how far it reaches */
  slam: 31,
  blast: 6,
  /** a hoop in the air, and a shot stopped dead on the mark */
  hoop: 15,
  perfect: 5,
  /** from which volley each thing comes in */
  bumpersAt: 1,
  moveAt: 2,
  barAt: 3,
  spinAt: 5,
};
export const SHOT_T = SHOT.V * SHOT.volleys;

export interface ShotArena {
  center: THREE.Vector3;
  /** where the bullseye is in this volley */
  bull(n: number, o: THREE.Vector3): THREE.Vector3;
  /** muzzle of cannon k */
  muzzle(k: number, o: THREE.Vector3): THREE.Vector3;
  /** the speed that puts you `d` metres away, from `h` above the target */
  speed(d: number, h?: number): number;
  /** where a bean sits in barrel k, with the barrel turned to `yaw` */
  seat(k: number, yaw: number, o: THREE.Vector3): THREE.Vector3;
  /** what a bean standing here scores in this volley */
  worth(n: number, p: THREE.Vector3): number;
  on(p: THREE.Vector3): boolean;
  /** the hoops: where they are at x seconds after the off */
  hoops(x: number, out: THREE.Vector3[]): THREE.Vector3[];
  /** a bean came down in a slam (the game does the blast); flew through a hoop */
  onSlam: (m: Marble) => void;
  onHoop: (m: Marble) => void;
  guns: { barrel: THREE.Group; tilt: THREE.Group; ring: THREE.Mesh; kick: number }[];
  /** the bar over the floor, for the bots: its angle, and is it out? */
  barOn(x: number): boolean;
  barAngle(x: number): number;
}

const seeded = (s: number) => {
  let sd = s;
  for (let k = 0; k < 8; k++) sd = (sd * 16807) % 2147483647;
  return () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
};

function targetArt() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d')!;
  x.translate(512, 512);
  const k = 512 / SHOT.R;
  const bands: [number, string][] = [[SHOT.R, '#e8f6ff'], [SHOT.rings[2], '#2fa8ff'], [SHOT.rings[1], '#ff4f7a'], [SHOT.rings[0], '#ffd23a']];
  for (const [r, col] of bands) {
    x.fillStyle = col;
    x.beginPath();
    x.arc(0, 0, r * k, 0, 7);
    x.fill();
  }
  x.strokeStyle = 'rgba(255,255,255,0.75)';
  x.lineWidth = 7;
  for (const r of SHOT.rings) {
    x.beginPath();
    x.arc(0, 0, r * k, 0, 7);
    x.stroke();
  }
  // ice scratches
  x.strokeStyle = 'rgba(255,255,255,0.3)';
  x.lineWidth = 2;
  let s = 91;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const a = rnd() * 6.28, r = rnd() * 480;
    x.beginPath();
    x.arc(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2, r, a, a + 0.2 + rnd() * 0.5);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function bigShot(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 118, 0);
  const { R, gunR, gunH, V } = SHOT;
  const y0 = center.y;
  b.lakeY = y0 - 30;
  const state = { go: 1e9 };
  const N = 24;

  // the bullseye's spot each volley: the middle at first, then wandering
  const rnd = seeded(62017);
  const spots: [number, number][] = [];
  for (let n = 0; n < SHOT.volleys; n++) {
    if (n < SHOT.moveAt) spots.push([0, 0]);
    else {
      const a = rnd() * Math.PI * 2, r = 4.5 + rnd() * 3.5;
      spots.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
  }
  const bull = (n: number, o: THREE.Vector3) => {
    const [x, z] = spots[Math.max(0, Math.min(SHOT.volleys - 1, n))];
    return o.set(center.x + x, y0, center.z + z);
  };
  const B = new THREE.Vector3();
  const on = (p: THREE.Vector3) => p.y > y0 - 1.2 && Math.hypot(p.x - center.x, p.z - center.z) < R + 0.4;
  const worth = (n: number, p: THREE.Vector3) => {
    if (!on(p)) return 0;
    bull(n, B);
    const d = Math.hypot(p.x - B.x, p.z - B.z);
    const v = d < SHOT.rings[0] ? SHOT.pts[0] : d < SHOT.rings[1] ? SHOT.pts[1] : d < SHOT.rings[2] ? SHOT.pts[2] : 2;
    return n === SHOT.volleys - 1 ? v * 2 : v;
  };
  // how fast, to land d metres off (level with the muzzle less its height)
  const speed = (d: number, h = gunH) => {
    const c = Math.cos(SHOT.pitch), s = Math.sin(SHOT.pitch), g = 24;
    // y = d·tan − g·d²/(2v²c²) = −h
    return Math.sqrt((g * d * d) / (2 * c * c * (d * (s / c) + h)));
  };

  // ---- the target
  const spin = (t: number) => {
    const x = t - state.go;
    const n = Math.floor(x / V);
    return n < SHOT.spinAt ? 0 : (x - SHOT.spinAt * V) * 0.32;
  };
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R + 0.4, 96).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: null, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06 }));
  {
    b.world.statics.addGeometry(new THREE.CircleGeometry(R + 0.4, 96).rotateX(-Math.PI / 2).translate(center.x, y0, center.z), Mat.Metal);
    disc.material.color.set(0xdff2ff);
    disc.position.set(center.x, y0 + 0.01, center.z);
    disc.receiveShadow = true;
    b.group.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R + 0.5, 0.42, 14, 96).rotateX(Math.PI / 2).translate(center.x, y0 - 0.1, center.z), new THREE.MeshPhysicalMaterial({ color: 0xffd23a, metalness: 0.7, roughness: 0.3 }));
    b.group.add(rim);
    const under = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.2, 3, 16, 48).translate(center.x, y0 - 8.3, center.z), new THREE.MeshPhysicalMaterial({ color: 0x2f6ad0, roughness: 0.5, clearcoat: 0.6 }));
    under.castShadow = true;
    b.group.add(under);
  }
  // the scoring rings: a target you can read from a cannon, that moves with the bullseye
  const art = new THREE.Mesh(new THREE.CircleGeometry(SHOT.rings[2], 96).rotateX(-Math.PI / 2), new THREE.MeshPhysicalMaterial({ map: targetArt(), roughness: 0.2, clearcoat: 1, transparent: true }));
  {
    // (only the rings of the art: its map is drawn to R, so scale the uv in)
    const uv = art.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const k = SHOT.rings[2] / R;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.5 + (uv.getX(i) - 0.5) * k, 0.5 + (uv.getY(i) - 0.5) * k);
    art.receiveShadow = true;
    b.group.add(art);
  }
  const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 26, 20, 1, true).translate(0, 13, 0), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
  b.group.add(flag);
  let artN = -1;
  const artTo = new THREE.Vector3(center.x, y0 + 0.03, center.z);
  b.animators.push((t) => {
    const x = t - state.go;
    const n = state.go < 1e8 ? Math.max(0, Math.floor(x / V)) : 0;
    if (n !== artN) {
      artN = n;
      bull(n, artTo);
      artTo.y = y0 + 0.03;
    }
    art.position.lerp(artTo, art.position.lengthSq() < 1 ? 1 : 0.06);
    flag.position.set(art.position.x, y0, art.position.z);
    (flag.material as THREE.MeshBasicMaterial).opacity = 0.16 + Math.sin(t * 5) * 0.06;
    disc.rotation.y = spin(t);
  });

  // ---- the cannons
  const guns: ShotArena['guns'] = [];
  const muzzle = (k: number, o: THREE.Vector3) => {
    const a = (k / N) * Math.PI * 2;
    return o.set(center.x + Math.cos(a) * gunR, y0 + gunH, center.z + Math.sin(a) * gunR);
  };
  {
    const brass = new THREE.MeshPhysicalMaterial({ color: 0xffc84a, metalness: 0.85, roughness: 0.28 });
    const iron = new THREE.MeshPhysicalMaterial({ color: 0x30384a, metalness: 0.7, roughness: 0.4 });
    const cols = [0xff4f7a, 0x2fa8ff, 0x37d07a, 0xffa030];
    for (let k = 0; k < N; k++) {
      const p = muzzle(k, new THREE.Vector3());
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 0.9, 6, 20).translate(p.x, p.y - 4.6, p.z), new THREE.MeshPhysicalMaterial({ color: cols[k % 4], roughness: 0.35, clearcoat: 0.8 }));
      stand.castShadow = true;
      b.group.add(stand);
      // (a little deck to fall back to, and something to stand the barrel on)
      const barrel = new THREE.Group();
      barrel.position.set(p.x, p.y - 1.4, p.z);
      barrel.rotation.y = Math.atan2(center.x - p.x, center.z - p.z);
      const tilt = new THREE.Group();
      tilt.rotation.x = Math.PI / 2 - SHOT.pitch;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.2, 3.6, 22, 1, true).translate(0, 1.8, 0), iron);
      (tube.material as THREE.Material).side = THREE.DoubleSide;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.18, 10, 26).rotateX(Math.PI / 2).translate(0, 3.6, 0), brass);
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.14, 0.12, 10, 26).rotateX(Math.PI / 2).translate(0, 1, 0), brass);
      tube.castShadow = true;
      tilt.add(tube, lip, band);
      barrel.add(tilt);
      b.group.add(barrel);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.09, 8, 28).rotateX(Math.PI / 2), glowMat(0xfff0a0, 2));
      ring.position.set(p.x, p.y - 1.5, p.z);
      ring.visible = false;
      b.group.add(ring);
      guns.push({ barrel, tilt, ring, kick: 0 });
    }
  }

  // ---- bumpers: up from the second volley
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.5, r = 9.4;
    const px = center.x + Math.cos(a) * r, pz = center.z + Math.sin(a) * r;
    const H = 1.5;
    const kin = new Kin({ type: 'cyl', r: 1.05, hh: H / 2 }, Mat.Bumper, (t, p, q) => {
      const x = t - state.go - SHOT.bumpersAt * V;
      p.set(px, y0 - H + Math.min(1, Math.max(0, x)) * (H + H / 2), pz);
      q.identity();
    });
    kin.kick = 7;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, H, 26), new THREE.MeshPhysicalMaterial({ color: 0xff4f7a, roughness: 0.25, clearcoat: 1 })));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 12, 0, 6.3, 0, 1.57).scale(1.05, 0.5, 1.05), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 }));
    cap.position.y = H / 2;
    g.add(cap);
    b.obstacle(kin, g, false);
  }
  // ---- the bar: sweeps the floor once everyone's down
  const barOn = (x: number) => x >= SHOT.barAt * V && x % V > SHOT.aim + 3.6 && x % V < SHOT.aim + 6.8;
  const barAngle = (x: number) => (x % V) * 0.62 + Math.floor(x / V) * 1.1;
  {
    const len = R * 2 + 1;
    const Q = new THREE.Quaternion(), Qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), Y = new THREE.Vector3(0, 1, 0);
    const kin = new Kin({ type: 'cyl', r: 0.38, hh: len / 2 }, Mat.Paint, (t, p, q) => {
      const x = t - state.go;
      const up = barOn(x) ? Math.min(1, ((x % V) - SHOT.aim - 3.6) / 0.5, (SHOT.aim + 6.8 - (x % V)) / 0.5) : 0;
      p.set(center.x, y0 - 0.7 + up * 1.3, center.z);
      Q.setFromAxisAngle(Y, barAngle(x));
      q.copy(Q).multiply(Qz);
    });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, len, 20), new THREE.MeshPhysicalMaterial({ color: 0xffd23a, metalness: 0.6, roughness: 0.25 })));
    b.obstacle(kin, g, false);
  }

  // ---- the hoops: gold rings up in the flight paths
  const HOOPS = 7;
  const hoops = (x: number, out: THREE.Vector3[]) => {
    for (let k = 0; k < HOOPS; k++) {
      const a = (k / HOOPS) * Math.PI * 2 + x * 0.14, r = 19 + Math.sin(k * 2.3) * 3;
      out[k].set(center.x + Math.cos(a) * r, y0 + 12 + Math.sin(k * 1.7 + x * 0.3) * 2.4, center.z + Math.sin(a) * r);
    }
    return out;
  };
  const hoopAt = Array.from({ length: HOOPS }, () => new THREE.Vector3());
  const hoopMesh: THREE.Mesh[] = [];
  {
    const g = new THREE.TorusGeometry(2.1, 0.2, 12, 36);
    const m = glowMat(0xffd23a, 2.2);
    for (let k = 0; k < HOOPS; k++) {
      const o = new THREE.Mesh(g, m);
      b.group.add(o);
      hoopMesh.push(o);
    }
    b.animators.push((t) => {
      const x = Math.max(0, t - state.go);
      hoops(state.go < 1e8 ? x : 0, hoopAt);
      hoopMesh.forEach((o, k) => {
        o.position.copy(hoopAt[k]);
        o.lookAt(center.x, hoopAt[k].y, center.z);
        o.rotation.z = t;
      });
    });
  }

  // ---- ice, the slam, the hoops, and the floor turning under you
  const slamming = new Set<number>();
  const hoopGot = new Map<number, number>();
  const LIVE = Array.from({ length: HOOPS }, () => new THREE.Vector3());
  b.world.fields.push({
    min: new THREE.Vector3(center.x - gunR - 6, y0 - 3, center.z - gunR - 6),
    max: new THREE.Vector3(center.x + gunR + 6, y0 + 50, center.z + gunR + 6),
    act: (m: Marble, t: number, dt: number) => {
      if (t < state.go) return;
      const x = t - state.go;
      const air = m.groundT > 0.1;
      // (a cannon shot is mostly the cannon's: the air steers it only a little)
      if (air) m.input.multiplyScalar(0.35);
      if (!air && on(m.pos)) {
        m.gripK = 0.1;
        m.runK = 0.8;
        // (it's a dome, really: the further out you are the harder it is to stay, and worse every volley)
        {
          const dx = m.pos.x - center.x, dz = m.pos.z - center.z, r = Math.hypot(dx, dz);
          if (r > 0.5) {
            const a = ((0.7 + 0.12 * Math.floor(x / V)) * r) / R;
            m.vel.x += (dx / r) * a * dt * 1.2;
            m.vel.z += (dz / r) * a * dt * 1.2;
          }
        }
        // (the first touch down takes most of a landing's speed off, the ice does the rest)
        const hs = Math.hypot(m.vel.x, m.vel.z);
        if (hs > 8) {
          const k = Math.max(8 / hs, 1 - 7 * dt);
          m.vel.x *= k;
          m.vel.z *= k;
        }
        if (Math.floor(x / V) >= SHOT.spinAt) {
          const dx = m.pos.x - center.x, dz = m.pos.z - center.z;
          m.vel.x += -dz * 0.32 * 2.2 * dt;
          m.vel.z += dx * 0.32 * 2.2 * dt;
        }
        if (slamming.delete(m.id)) arena.onSlam(m);
      } else if (!air) slamming.delete(m.id);
      if (air && m.dash) {
        m.dash = false;
        if (!slamming.has(m.id) && m.vel.y < 14) {
          slamming.add(m.id);
          m.vel.x *= 0.3;
          m.vel.z *= 0.3;
          m.vel.y = -SHOT.slam;
          m.dashed = true;
        }
      }
      if (air) {
        hoops(x, LIVE);
        for (const h of LIVE)
          if (h.distanceToSquared(m.pos) < 2.6 * 2.6 && t - (hoopGot.get(m.id) ?? -9) > 1) {
            hoopGot.set(m.id, t);
            arena.onHoop(m);
          }
      }
    },
  });

  // (the bean rides in the mouth of the barrel, head and shoulders out)
  const seat = (k: number, yaw: number, o: THREE.Vector3) => {
    muzzle(k, o);
    const c = Math.cos(SHOT.pitch), L = 3.2;
    o.y += -1.4 + Math.sin(SHOT.pitch) * L - 0.1;
    o.x += Math.sin(yaw) * c * L;
    o.z += Math.cos(yaw) * c * L;
    return o;
  };
  const arena: ShotArena = { center, bull, muzzle, speed, seat, worth, on, hoops, onSlam: () => {}, onHoop: () => {}, guns, barOn, barAngle };

  title(b, info, 'Last one on the bull wins it', 0xff4f7a, new THREE.Vector3(center.x, y0 + 10, center.z - gunR - 8));
  dressArena(b, new THREE.Vector3(center.x, y0 - 2, center.z), gunR + 4, 37);
  b.finish();
  return {
    id: 'bigshot',
    name: info.name,
    kind: 'score',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 9,
    lakeY: b.lakeY,
    state,
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const p = muzzle(Math.round((k * N) / n) % N, new THREE.Vector3());
        out.push({ pos: p, yaw: Math.atan2(center.x - p.x, center.z - p.z) });
      }
      return out;
    },
    plate: { center, radius: R, bars: [] },
    shot: arena,
    intro: [],
  };
}
