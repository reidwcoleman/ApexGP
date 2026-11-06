import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { DASH_CD, Kin, Mat, Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { title } from './course-modes.ts';

/**
 * Pinball Panic: you are the ball. A giant tilted table, everyone on it at once, rolling. JUMP fires
 * the flippers (all of them), DIVE gives you a nudge. Bumpers, rollover lanes, kick-out holes and a
 * jackpot that lights up every so often all score, times your multiplier; the multiplier climbs the
 * more you hit, and the drain takes it back to one. Near the end the steel balls come out and it's
 * multiball: everything's worth double. The top scores go through.
 *
 * Everything's laid out flat in table coordinates (u across, v down the table to the flippers) and
 * tilted as one. The flippers are each browser's own: your press moves them for what you run, which
 * is all anyone can feel. Who scored what is the owner's to say; the host keeps the book.
 */
export const PIN = {
  /** half width, half length, and the slope */
  W: 15,
  L: 30,
  tilt: 0.17,
  /** the plunger lane's wall, and the middle of what's left */
  lane: 12.6,
  mid: -1.2,
  T: 95,
  /** points */
  bumper: 10,
  sling: 5,
  rollover: 25,
  hole: 50,
  jackpot: 150,
  /** hits to reach each multiplier above one */
  steps: [6, 14, 24, 36],
  /** the jackpot lights this often, for this long */
  jackEvery: 16,
  jackFor: 7,
  /** the last seconds: multiball */
  multi: 22,
  nudge: 11,
  /** steering, straight onto the ball: across, down the table, and up it (less than the slope pulls:
   * you can hang on a little longer, but only a flipper takes you back up) */
  steerU: 26,
  steerDown: 12,
  steerUp: 4.2,
  /** the fastest steering alone will take you */
  steerMax: 15,
  /** every lane across the top lit, and the bank of drop targets flat */
  lanesDone: 300,
  target: 30,
  bankDone: 250,
  /** a flat bank stands up again after this */
  bankBack: 5,
};

/** what scored: a bumper's number, or one of these */
export const PinHit = { Sling: 100, Lane: 200, Hole: 300, Jackpot: 400, Drain: 500, Lanes: 600, Target: 700, Bank: 800 } as const;

export interface PinArena {
  center: THREE.Vector3;
  /** table coordinates → world */
  at(u: number, v: number, h: number, o: THREE.Vector3): THREE.Vector3;
  /** world → table: [u, v] */
  uv(p: THREE.Vector3): [number, number];
  bumpers: { u: number; v: number; kin: Kin }[];
  /** where the flippers' pivots are, for the bots */
  flippers: { u: number; v: number; dir: number }[];
  /** the flippers go up for a person: `hold` keeps them up while the button's down */
  flip(t: number, hold?: boolean): void;
  /** a bot's flip: its ball goes back up the table, and the bat only looks as if it swung, so nobody
   * else's flippers ever move on a person who's timing their own */
  bat(m: Marble, t: number, f: { u: number; v: number; dir: number }): void;
  /** when they last went for a person */
  lastFlip: number;
  /** is the jackpot lit, x seconds after the off? */
  jackLit(x: number): boolean;
  jack: { u: number; v: number };
  holes: { u: number; v: number }[];
  /** the game's hook: this bean scored */
  onHit: (m: Marble, what: number) => void;
  /** whose lit lanes the lamps show */
  setLamps(id: number): void;
  /** back in the plunger lane; true while it's waiting to be fired */
  load(m: Marble): void;
  fire(m: Marble): void;
}

const LANE_LIT = 0xffe04a;

/** bright mirror steel that doesn't need a sky to look like steel */
function chrome() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.42, '#c8d8ff');
  g.addColorStop(0.5, '#5a6aa0');
  g.addColorStop(0.58, '#ff7ad0');
  g.addColorStop(1, '#f0f4ff');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const r = x.createRadialGradient(92, 78, 4, 92, 78, 74);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = r;
  x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshMatcapMaterial({ matcap: t });
}

function fieldArt(W: number, L: number) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 2048;
  const x = c.getContext('2d')!;
  const sx = 1024 / (W * 2), sy = 2048 / (L * 2);
  const X = (u: number) => (u + W) * sx, Y = (v: number) => (v + L) * sy;
  const g = x.createLinearGradient(0, 0, 0, 2048);
  g.addColorStop(0, '#1a0b52');
  g.addColorStop(0.5, '#0f2a78');
  g.addColorStop(1, '#3a0a5c');
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 2048);
  // sunburst behind the top bumpers
  x.save();
  x.translate(X(PIN.mid), Y(-14));
  for (let k = 0; k < 24; k++) {
    x.rotate(Math.PI / 12);
    x.fillStyle = k % 2 ? 'rgba(255,80,190,0.16)' : 'rgba(60,220,255,0.13)';
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(-90, -1300);
    x.lineTo(90, -1300);
    x.fill();
  }
  x.restore();
  // chevrons up the middle
  for (let k = 0; k < 9; k++) {
    const y = Y(21 - k * 3.6), cx = X(PIN.mid);
    x.strokeStyle = `hsl(${(k * 38) % 360} 100% 62%)`;
    x.lineWidth = 16;
    x.beginPath();
    x.moveTo(cx - 92, y + 36);
    x.lineTo(cx, y - 24);
    x.lineTo(cx + 92, y + 36);
    x.stroke();
  }
  // stars and dots
  let s = 77;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 150; k++) {
    x.fillStyle = `hsla(${r() * 360} 100% 72% / ${0.25 + r() * 0.5})`;
    x.beginPath();
    x.arc(r() * 1024, r() * 2048, 2 + r() * 7, 0, 7);
    x.fill();
  }
  // the name, big, down the bottom half
  x.save();
  x.translate(X(PIN.mid), Y(11));
  x.textAlign = 'center';
  x.font = '900 122px Arial Black, Impact, sans-serif';
  x.lineWidth = 16;
  x.strokeStyle = '#ff2fa0';
  x.fillStyle = '#fff6a0';
  x.strokeText('PANIC', 0, 0);
  x.fillText('PANIC', 0, 0);
  x.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function pinball(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 118, 0);
  const { W, L, tilt, lane, mid } = PIN;
  b.lakeY = center.y - 34;
  const state = { go: 1e9 };
  const Qt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
  const Mt = new THREE.Matrix4().compose(center, Qt, new THREE.Vector3(1, 1, 1));
  const Minv = Mt.clone().invert();
  const at = (u: number, v: number, h: number, o: THREE.Vector3) => o.set(u, h, v).applyMatrix4(Mt);
  const LOC = new THREE.Vector3();
  const uv = (p: THREE.Vector3): [number, number] => {
    LOC.copy(p).applyMatrix4(Minv);
    return [LOC.x, LOC.z];
  };
  // everything that doesn't move hangs off this, in table coordinates
  const table = new THREE.Group();
  table.position.copy(center);
  table.quaternion.copy(Qt);
  b.group.add(table);

  // ---- the playfield
  const BOT = 27;
  {
    const len = L + BOT;
    const g = new THREE.BoxGeometry(W * 2, 0.6, len).translate(0, -0.3, (BOT - L) / 2);
    b.world.statics.addGeometry(g, Mat.Felt, Mt);
    const top = new THREE.PlaneGeometry(W * 2, L * 2).rotateX(-Math.PI / 2);
    const art = new THREE.Mesh(top, new THREE.MeshPhysicalMaterial({ map: fieldArt(W, L), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 }));
    art.position.y = 0.012;
    art.receiveShadow = true;
    // (the art stops where the table does: the drain is just the edge)
    const p = top.getAttribute('position') as THREE.BufferAttribute, q = top.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++)
      if (p.getZ(i) > BOT) {
        p.setZ(i, BOT);
        q.setY(i, 1 - (BOT + L) / (L * 2));
      }
    table.add(art);
    const under = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 1.4, 2.6, len + 1.4).translate(0, -1.6, (BOT - L) / 2), new THREE.MeshPhysicalMaterial({ color: 0x241048, roughness: 0.4, clearcoat: 0.8 }));
    under.castShadow = true;
    table.add(under);
    // the plunger lane runs on past the drain
    const ext = new THREE.BoxGeometry(W - lane, 0.6, L - BOT).translate((W + lane) / 2, -0.3, (L + BOT) / 2);
    b.world.statics.addGeometry(ext, Mat.Felt, Mt);
    const extM = new THREE.Mesh(ext, new THREE.MeshPhysicalMaterial({ color: 0x3a1a7a, roughness: 0.4 }));
    table.add(extM);
  }

  // ---- the rails
  const railM = new THREE.MeshPhysicalMaterial({ color: 0x8a6cff, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 });
  const neon = [0xff2fa0, 0x38e8ff, 0xffe04a, 0x7aff5a];
  const strips: THREE.MeshBasicMaterial[] = [];
  const wall = (u0: number, v0: number, u1: number, v1: number, o: { h?: number; th?: number; mat?: Mat; glow?: number } = {}) => {
    const h = o.h ?? 2.6, th = o.th ?? 0.6;
    const len = Math.hypot(u1 - u0, v1 - v0);
    const a = Math.atan2(-(v1 - v0), u1 - u0);
    const g = new THREE.BoxGeometry(len + th, h, th).rotateY(a).translate((u0 + u1) / 2, h / 2, (v0 + v1) / 2);
    b.world.statics.addGeometry(g, o.mat ?? Mat.Bumper, Mt);
    const m = new THREE.Mesh(g, railM);
    m.castShadow = true;
    table.add(m);
    const lit = glowMat(neon[(o.glow ?? 0) % 4], 2.2);
    strips.push(lit);
    const s = new THREE.Mesh(new THREE.BoxGeometry(len + th * 0.8, 0.14, th * 0.5).rotateY(a).translate((u0 + u1) / 2, h + 0.07, (v0 + v1) / 2), lit);
    table.add(s);
  };
  wall(-W, -L, -W, L, { glow: 0 });
  wall(W, -L, W, L, { glow: 1 });
  wall(-W, -L, W, -L, { glow: 2, h: 3.4 });
  // the plunger lane, and the bend at the top that turns a launch into the table
  wall(lane, -20, lane, L, { glow: 3 });
  wall(8.5, -L, W, -23.5, { glow: 2 });
  wall(-W, -24, -9.5, -L, { glow: 2 });
  // the funnel down to the flippers
  const fl = { u: mid - 6.3, v: 23.4 }, fr = { u: mid + 6.3, v: 23.4 };
  wall(-W, 12.5, fl.u - 0.3, fl.v - 0.3, { glow: 0 });
  wall(lane, 12.5, fr.u + 0.3, fr.v - 0.3, { glow: 1 });
  // and solid behind it
  {
    const apron = new THREE.MeshPhysicalMaterial({ color: 0x5a1a9a, roughness: 0.3, clearcoat: 1 });
    for (const [u1, ue] of [[fl.u, -W], [fr.u, lane]] as const) {
      const s = new THREE.Shape();
      s.moveTo(ue, 12.5);
      s.lineTo(u1, 23.1);
      s.lineTo(u1, BOT);
      s.lineTo(ue, BOT);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 1.5, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, 1.5, 0);
      b.world.statics.addGeometry(g, Mat.Bumper, Mt);
      const m = new THREE.Mesh(g, apron);
      m.castShadow = true;
      table.add(m);
    }
  }

  // ---- bumpers
  const hook = { on: (_m: Marble, _w: number) => {} };
  const stamp = new Map<number, number>();
  /** one score per bean per thing per moment, however many substeps it stays in contact */
  const once = (m: Marble, w: number, t: number, gap = 0.22) => {
    const k = m.id * 1024 + w;
    if (t - (stamp.get(k) ?? -9) < gap) return false;
    stamp.set(k, t);
    return true;
  };
  const bumpers: PinArena['bumpers'] = [];
  const spots: [number, number, number][] = [
    [mid - 6.2, -17, 0], [mid + 6.2, -17, 1], [mid, -12.2, 2],
    [mid - 9.2, -1.6, 3], [mid + 9.2, -1.6, 0], [mid - 3.6, 2.4, 1], [mid + 3.6, 2.4, 2],
  ];
  spots.forEach(([u, v, ci], i) => {
    const pos = at(u, v, 0.95, new THREE.Vector3());
    const k = new Kin({ type: 'cyl', r: 1.55, hh: 1.15 }, Mat.Bumper, (_t, p, q) => {
      p.copy(pos);
      q.copy(Qt);
    });
    k.kick = 12;
    k.onHit = (m) => {
      const t = b.world.time;
      if (t >= state.go && once(m, i, t)) hook.on(m, i);
    };
    const g = new THREE.Group();
    const col = neon[ci];
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.6, 1.5, 32), new THREE.MeshPhysicalMaterial({ color: 0xf2f4ff, roughness: 0.3, clearcoat: 1 }));
    body.position.y = -0.3;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 0.5, 32), glowMat(col, 1.5));
    cap.position.y = 0.72;
    const skirt = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.16, 12, 40).rotateX(Math.PI / 2), glowMat(col, 2.6));
    skirt.position.y = -0.55;
    g.add(body, cap, skirt);
    b.obstacle(k, g, false);
    b.animators.push((t) => {
      const f = Math.max(0, 1 - (t - k.lastHit) * 5);
      g.scale.set(1 + f * 0.2, 1 - f * 0.1, 1 + f * 0.2);
      (cap.material as THREE.MeshBasicMaterial).color.set(col).multiplyScalar(1.4 + f * 3 + Math.sin(t * 3 + i) * 0.25);
    });
    bumpers.push({ u, v, kin: k });
  });

  // ---- slingshots: the springy walls just above the flippers
  for (const side of [-1, 1]) {
    const u0 = mid + side * 10.2, v0 = 12.6, u1 = mid + side * 6.3, v1 = 18.8;
    const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, len = Math.hypot(u1 - u0, v1 - v0);
    const a = Math.atan2(-(v1 - v0), u1 - u0);
    const pos = at(uc, vc, 0.8, new THREE.Vector3());
    const quat = Qt.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a));
    const k = new Kin({ type: 'box', hx: len / 2, hy: 0.85, hz: 0.42 }, Mat.Bumper, (_t, p, q) => {
      p.copy(pos);
      q.copy(quat);
    });
    k.kick = 9;
    k.onHit = (m) => {
      const t = b.world.time;
      if (t >= state.go && once(m, PinHit.Sling + (side > 0 ? 1 : 0), t, 0.4)) hook.on(m, PinHit.Sling);
    };
    const g = new THREE.Group();
    const lit = glowMat(0xff5a2f, 2);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(len, 1.7, 0.84), lit));
    b.obstacle(k, g, false);
    b.animators.push((t) => {
      const f = Math.max(0, 1 - (t - k.lastHit) * 6);
      lit.color.set(0xff5a2f).multiplyScalar(1.6 + f * 3.4);
    });
  }

  // ---- flippers
  // (how far up they are, 0 to 1, moved on by the clock: a press in the middle of a swing carries on from
  // where the bat is, so it never jumps)
  const flip = { until: -9, a: 0, t: 0 };
  const swing = (t: number) => {
    const dt = t - flip.t;
    if (dt > 0) {
      flip.t = t;
      flip.a = t < flip.until ? Math.min(1, flip.a + dt / 0.075) : Math.max(0, flip.a - dt / 0.16);
    }
    return flip.a;
  };
  /** the swing a bat seems to make for a bot's ball, by side: looks only */
  const ghost = [-9, -9];
  const flippers: PinArena['flippers'] = [];
  const flipper = (u: number, v: number, dir: number, len: number, rest: number, up: number, ci: number) => {
    flippers.push({ u, v, dir });
    const Y = new THREE.Vector3(0, 1, 0);
    const Q = new THREE.Quaternion();
    const pv = at(u, v, 0.7, new THREE.Vector3());
    const D = new THREE.Vector3();
    const k = new Kin({ type: 'box', hx: len / 2, hy: 0.72, hz: 0.42 }, Mat.Paint, (t, p, q) => {
      const a = rest - swing(t) * (rest + up);
      Q.setFromAxisAngle(Y, dir > 0 ? -a : Math.PI + a);
      q.copy(Qt).multiply(Q);
      D.set(len / 2, 0, 0).applyQuaternion(q);
      p.copy(pv).add(D);
    });
    const g = new THREE.Group();
    // (hung from its pivot, so a bot's flip can swing the look of it without moving the real thing)
    const hinge = new THREE.Group();
    hinge.position.x = -len / 2;
    const bat = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, len - 0.5, 8, 18).rotateZ(Math.PI / 2).translate(len / 2, 0, 0), new THREE.MeshPhysicalMaterial({ color: 0xfff4f4, roughness: 0.25, clearcoat: 1 }));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(len - 0.4, 0.2, 0.88).translate(len / 2, 0, 0), glowMat(neon[ci], 2.2));
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 1.5, 20), railM);
    hinge.add(bat, stripe, pin);
    g.add(hinge);
    b.obstacle(k, g, false);
    const side = dir > 0 ? 0 : 1;
    b.animators.push((t) => {
      const u = t - ghost[side];
      const f = u < 0 || u > 0.3 ? 0 : u < 0.08 ? u / 0.08 : 1 - (u - 0.08) / 0.22;
      // (only while the real bat's down)
      hinge.rotation.y = f * (1 - flip.a) * 0.75;
    });
  };
  flipper(fl.u, fl.v, 1, 4.6, 0.42, 0.45, 0);
  flipper(fr.u, fr.v, -1, 4.6, 0.42, 0.45, 1);
  // and a pair half way up the sides: a second chance, and a way back at the top bumpers
  flipper(-W + 0.6, 7.4, 1, 3.6, 0.55, 0.3, 2);
  flipper(lane - 0.6, 7.4, -1, 3.6, 0.55, 0.3, 2);

  // ---- rollover lanes along the top
  const lanes = [-11.4, -6.4, -1.4, 3.6, 8.6];
  for (const u of [-13.8, ...lanes.map((x) => x + 2.5)].slice(0, 6)) {
    if (u > 10.4) continue;
    const pos = at(u, -25.2, 0.7, new THREE.Vector3());
    const k = new Kin({ type: 'cyl', r: 0.32, hh: 0.8 }, Mat.Metal, (_t, p, q) => {
      p.copy(pos);
      q.copy(Qt);
    });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.6, 14), railM));
    b.obstacle(k, g, false);
  }
  const laneLamp = lanes.map((u) => {
    const m = glowMat(LANE_LIT, 0.5);
    const d = new THREE.Mesh(new THREE.CircleGeometry(1.05, 28).rotateX(-Math.PI / 2), m);
    d.position.set(u, 0.04, -25.2);
    table.add(d);
    return { u, m, t: -9, on: false };
  });
  /** which lanes each bean has lit (all five is a bonus) */
  const laneMask = new Map<number, number>();
  /** the ball the lamps show (yours) */
  let lampFor = -1;

  // ---- kick-out holes and the jackpot
  const holes = [{ u: mid - 10.4, v: -8 }, { u: mid + 10.4, v: -8 }];
  for (const h of holes) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.5, 36).rotateX(-Math.PI / 2), glowMat(0x7aff5a, 2.2));
    ring.position.set(h.u, 0.04, h.v);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(1.15, 36).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x04020c }));
    hole.position.set(h.u, 0.03, h.v);
    table.add(ring, hole);
  }
  const jack = { u: mid, v: -5.2 };
  const jackLit = (x: number) => x > 6 && (x % PIN.jackEvery) < PIN.jackFor;
  const jackM = glowMat(0xffd23a, 1);
  const jackRing = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.1, 44).rotateX(-Math.PI / 2), jackM);
  jackRing.position.set(jack.u, 0.05, jack.v);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 14, 24, 1, true).translate(0, 7, 0), new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
  beam.position.set(jack.u, 0, jack.v);
  table.add(jackRing, beam);

  // ---- the steel balls: multiball. Each a function of the clock, loose on the table until the end
  {
    const n = 5;
    const steel = chrome();
    for (let i = 0; i < n; i++) {
      const R = 1.5;
      const P = new THREE.Vector3();
      const k = new Kin({ type: 'sph', r: R }, Mat.Bumper, (t, p, q) => {
        const x = t - state.go - (PIN.T - PIN.multi) - i * 0.7;
        if (x < 0) {
          at(0, -L - 6, -30, p);
          q.identity();
          return;
        }
        const u = mid + Math.sin(x * (0.5 + i * 0.09) + i * 1.9) * 10.6;
        const v = -6 + Math.sin(x * (0.37 + i * 0.07) + i) * 15;
        at(u, v, R + Math.max(0, 1 - x) * 16, P);
        p.copy(P);
        q.setFromAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), x * 5);
      });
      k.kick = 7;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(R, 32, 22), steel));
      b.obstacle(k, g, false);
    }
  }

  // ---- the drop targets: a bank across the table. Knock them flat, the last one pays the bonus
  const bank: { k: Kin; down: boolean; up: number }[] = [];
  let bankDownT = -1;
  for (let i = 0; i < 4; i++) {
    const u = mid - 5.4 + i * 3.6, v = 8.2;
    const P = at(u, v, 0.8, new THREE.Vector3()), low = at(u, v, -1.4, new THREE.Vector3());
    const e = { k: null as unknown as Kin, down: false, up: 0 };
    const k = new Kin({ type: 'box', hx: 1.15, hy: 0.8, hz: 0.34 }, Mat.Bumper, (_t, p, q) => {
      p.copy(e.down ? low : P);
      q.copy(Qt);
    });
    k.kick = 5;
    e.k = k;
    k.onHit = (m) => {
      const t = b.world.time;
      if (e.down || t < state.go) return;
      e.down = true;
      e.up = t;
      hook.on(m, PinHit.Target);
      if (bank.every((o) => o.down)) {
        bankDownT = t;
        hook.on(m, PinHit.Bank);
      }
    };
    const g = new THREE.Group();
    const lit = glowMat(neon[(i + 1) % 4], 2);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.6, 0.68), new THREE.MeshPhysicalMaterial({ color: 0xfff4f4, roughness: 0.3, clearcoat: 1 })));
    const face = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 0.72), lit);
    face.position.y = 0.2;
    g.add(face);
    b.obstacle(k, g, false);
    bank.push(e);
  }
  b.animators.push((t) => {
    if (bankDownT > 0 && t - bankDownT > PIN.bankBack) {
      bankDownT = -1;
      for (const e of bank) e.down = false;
    }
  });

  // ---- the plunger
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3, 16).rotateX(Math.PI / 2), new THREE.MeshPhysicalMaterial({ color: 0xff2fa0, metalness: 0.5, roughness: 0.3 }));
  rod.position.set((W + lane) / 2, 0.7, L - 0.5);
  table.add(rod);

  // ---- the back of the table, up on legs
  {
    const back = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 2, 10, 1.6), new THREE.MeshPhysicalMaterial({ color: 0x2a0f60, roughness: 0.35, clearcoat: 1 }));
    back.position.set(0, 5, -L - 0.8);
    back.castShadow = true;
    table.add(back);
    const legM = new THREE.MeshPhysicalMaterial({ color: 0x6a4cc8, roughness: 0.35, clearcoat: 0.8 });
    for (const [u, v] of [[-W + 1, -L + 2], [W - 1, -L + 2], [-W + 1, BOT - 1], [W - 1, BOT - 1]]) {
      const P = at(u, v, -1, new THREE.Vector3());
      const h = P.y - b.lakeY;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, h, 16).translate(P.x, P.y - h / 2, P.z), legM);
      b.group.add(leg);
    }
  }
  title(b, info, 'You are the ball', 0xff2fa0, at(0, -L - 1.7, 7.2, new THREE.Vector3()));

  // ---- the rules of the table, for whoever's on it
  const lo = at(-W - 3, -L - 3, 0, new THREE.Vector3()), hi = at(W + 3, L + 3, 0, new THREE.Vector3());
  const P0 = new THREE.Vector3();
  const still = new Map<number, number>();
  b.world.fields.push({
    min: new THREE.Vector3(lo.x, hi.y - 8, lo.z),
    max: new THREE.Vector3(hi.x, lo.y + 26, hi.z),
    grip: 0.1,
    g: 1.25,
    act: (m: Marble, t: number, dt: number) => {
      if (t < state.go) return;
      // (a ball, the whole round)
      if (m.mode !== Mode.Tumble) {
        m.guardT = 0;
        m.knock(30);
      }
      m.tumbleT = 30;
      if (m.jump) {
        arena.flip(t);
        m.jump = false;
      } else if (m.jet) arena.flip(t, true);
      if (m.dash) {
        m.dash = false;
        if (m.dashCD <= 0) {
          m.dashCD = DASH_CD;
          m.dashed = true;
          const il = m.input.length();
          if (il > 0.05) m.vel.addScaledVector(m.input, PIN.nudge / il);
          m.vel.y += 1.5;
        }
      }
      // steering. A rolling bean's own steering only spins it, which on this slope does next to
      // nothing: here the push goes straight onto the ball, and it's strong enough to feel
      {
        const ix = THREE.MathUtils.clamp(m.input.x, -1, 1), iz = THREE.MathUtils.clamp(m.input.z, -1, 1);
        if (ix * m.vel.x < PIN.steerMax * Math.abs(ix)) m.vel.x += ix * PIN.steerU * dt;
        if (iz > 0 ? m.vel.z < PIN.steerMax : m.vel.z > -6) m.vel.z += iz * (iz > 0 ? PIN.steerDown : PIN.steerUp) * dt;
        m.input.set(0, 0, 0);
      }
      // (nothing in pinball goes through the glass)
      const sp = m.vel.length();
      if (sp > 34) m.vel.multiplyScalar(34 / sp);
      // (wedged somewhere: the table gives it a shake)
      const s0 = sp < 1.3 ? (still.get(m.id) ?? 0) + dt : 0;
      still.set(m.id, s0);
      if (s0 > 2.2) {
        still.set(m.id, 0);
        m.vel.x += (Math.random() - 0.5) * 12;
        m.vel.z += 3 + Math.random() * 5;
        m.vel.y += 3;
      }
      const [u, v] = uv(m.pos);
      const x = t - state.go;
      // (the plunger lane only runs one way: anything rolling back down it goes straight up again)
      if (u > lane && v > -19) {
        const down = m.vel.z * Math.cos(tilt) - m.vel.y * Math.sin(tilt);
        if (down > 0.5) arena.fire(m);
      }
      // the rollovers: each one's worth something, and all five lit is a bonus
      if (v > -26.4 && v < -24) {
        laneLamp.forEach((l, i) => {
          if (Math.abs(u - l.u) >= 1.5 || !once(m, PinHit.Lane + i, t, 2.5)) return;
          l.t = t;
          hook.on(m, PinHit.Lane);
          const mask = (laneMask.get(m.id) ?? 0) | (1 << i);
          if (mask === 31) {
            laneMask.set(m.id, 0);
            hook.on(m, PinHit.Lanes);
          } else laneMask.set(m.id, mask);
        });
      }
      // the holes: a moment's pause, and it spits you back up the table
      for (let i = 0; i < holes.length; i++) {
        const h = holes[i];
        if (Math.hypot(u - h.u, v - h.v) < 1.3 && once(m, PinHit.Hole + i, t, 3)) {
          hook.on(m, PinHit.Hole);
          const a = (i ? -1 : 1) * (0.25 + Math.random() * 0.5);
          at(h.u, h.v, 0, P0);
          m.pos.copy(P0).addScaledVector(new THREE.Vector3(0, 1, 0), 0.55);
          m.vel.set(Math.sin(a) * 19, 3, -Math.cos(a) * 19);
        }
      }
      if (jackLit(x) && Math.hypot(u - jack.u, v - jack.v) < 1.9 && once(m, PinHit.Jackpot, t, PIN.jackFor)) {
        hook.on(m, PinHit.Jackpot);
        m.vel.y += 7;
      }
    },
  });

  const BV = new THREE.Vector3();
  const arena: PinArena = {
    center,
    at,
    uv,
    bumpers,
    flippers,
    jack,
    holes,
    jackLit,
    onHit: () => {},
    lastFlip: 0,
    flip(t, hold) {
      swing(t);
      flip.until = Math.max(flip.until, t + (hold ? 0.06 : 0.16));
      if (!hold) this.lastFlip = t;
    },
    bat(m, t, f) {
      ghost[f.dir > 0 ? 0 : 1] = t;
      // (up the table, wide of where it came from, from whichever side of the bat it's on)
      const a = -f.dir * (0.06 + Math.random() * 0.34) + (Math.random() - 0.5) * 0.3;
      const s = 21 + Math.random() * 6;
      BV.set(Math.sin(a) * s, 1.2, -Math.cos(a) * s).applyQuaternion(Qt);
      m.vel.copy(BV);
    },
    setLamps(id) {
      lampFor = id;
    },
    load(m) {
      const k = 21 + Math.random() * 7.5;
      at((W + lane) / 2, k, 0.6, m.pos);
      m.vel.set(0, 0, 0);
      m.ang.set(0, 0, 0);
      m.frozen = true;
    },
    fire(m) {
      m.frozen = false;
      // (up the lane, hard enough to come round the bend, and already rolling so none of it's lost)
      m.vel.set(0, Math.sin(tilt) * 33, -Math.cos(tilt) * 33);
      m.ang.set(-33 / 0.5, 0, 0);
    },
  };
  hook.on = (m, w) => arena.onHit(m, w);

  b.animators.push((t) => {
    const x = t - state.go;
    const lit = state.go < 1e8 && jackLit(x);
    beam.visible = lit;
    jackM.color.set(0xffd23a).multiplyScalar(lit ? 2.2 + Math.sin(t * 14) * 1.4 : 0.35);
    jackRing.scale.setScalar(lit ? 1 + Math.sin(t * 9) * 0.08 : 1);
    const mask = laneMask.get(lampFor) ?? 0;
    laneLamp.forEach((l, i) => l.m.color.set(LANE_LIT).multiplyScalar((mask & (1 << i) ? 1.7 : 0.4) + Math.max(0, 1 - (t - l.t) * 0.8) * 3));
    const wild = state.go < 1e8 && x > PIN.T - PIN.multi;
    strips.forEach((m, i) => {
      const c = neon[(i + (wild ? Math.floor(t * 8) : Math.floor(t * 1.5))) % 4];
      m.color.set(c).multiplyScalar(2.2);
    });
    rod.position.z = L - 0.5 + Math.sin(t * 2) * 0.1;
  });

  dressArena(b, new THREE.Vector3(center.x, center.y - 8, center.z), L + 6, 71);
  b.finish();
  return {
    id: 'pinball',
    name: info.name,
    kind: 'score',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: at(0, BOT, 0, new THREE.Vector3()).y - 7,
    lakeY: b.lakeY,
    state,
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const row = Math.floor(k / 12), col = k % 12;
        out.push({ pos: at(-12.6 + col * 1.95 + row, -22 + row * 1.5, 0.6, new THREE.Vector3()), yaw: Math.PI });
      }
      return out;
    },
    plate: { center, radius: W, bars: [] },
    pin: arena,
    intro: [],
  };
}
