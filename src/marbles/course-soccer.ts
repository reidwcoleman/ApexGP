import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { title } from './course-modes.ts';

/**
 * Bean Cup: two teams, two goals and a ball as big as you are. Run into it to dribble, DIVE into it
 * for a real shot, JUMP for a header. A shot in the face knocks you over. With a little time left a
 * second ball drops in. Level at the whistle is golden goal. The losing team goes home.
 *
 * The walls and floor here are simple on purpose: the ball is the host's, moved by soccer.ts against
 * the same outline the beans run into.
 */
export const CUP = {
  /** the pitch: half its width and length, the corners cut off so a ball can't sit in one */
  HW: 21,
  HL: 32,
  cut: 7,
  /** the goal: half its mouth, its height, how deep */
  goalHalf: 7.5,
  goalH: 6.2,
  goalD: 5.5,
  /** the ball */
  R: 1.35,
  g: 20,
  ceil: 11,
  /** the clock, the wait after a goal, when the second ball comes (seconds left), golden goal's limit */
  T: 100,
  restart: 2.8,
  second: 32,
  over: 45,
};
export const CUP_COLORS = [0xff4f9a, 0x2f9bff];
export const CUP_NAMES = ['PINK', 'BLUE'];

export interface CupBall {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  /** in play (false: not on yet, or just scored) */
  live: boolean;
  /** when it comes back (world time; 0: not waiting) */
  backAt: number;
  /** who touched it last and before that (bean ids) */
  last: number;
  prev: number;
  /** when a bean last kicked it (no double hits) */
  kickT: number;
}
export interface CupArena {
  center: THREE.Vector3;
  /** each bean's team */
  of: Map<number, number>;
  balls: CupBall[];
  /** the outline as segments, x0 z0 x1 z1 (world), and the posts of everything round */
  segs: [number, number, number, number][];
  rounds: { x: number; z: number; r: number; kick: number }[];
  /** the net shakes */
  shake(team: number, t: number): void;
  /** the goal at whichever end the camera's behind goes see-through */
  view(cam: THREE.Vector3): void;
  /** the middle of the goal a team shoots at */
  goal(team: number, o: THREE.Vector3): THREE.Vector3;
}

function pitchArt() {
  const { HW, HL, goalHalf } = CUP;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1536;
  const x = c.getContext('2d')!;
  const sx = 1024 / (HW * 2), sz = 1536 / (HL * 2);
  const X = (u: number) => (u + HW) * sx, Z = (v: number) => (v + HL) * sz;
  for (let k = 0; k < 16; k++) {
    x.fillStyle = k % 2 ? '#39c45e' : '#2fb352';
    x.fillRect(0, (k * 1536) / 16, 1024, 1536 / 16 + 1);
  }
  // each end in its team's colour
  const end = (z0: number, z1: number, col: string) => {
    const g = x.createLinearGradient(0, Z(z0), 0, Z(z1));
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, Math.min(Z(z0), Z(z1)), 1024, Math.abs(Z(z1) - Z(z0)));
  };
  end(-HL, -HL + 20, 'rgba(255,79,154,0.55)');
  end(HL, HL - 20, 'rgba(47,155,255,0.55)');
  x.strokeStyle = '#fffdf2';
  x.lineWidth = 9;
  x.strokeRect(X(-HW + 0.7), Z(-HL + 0.7), (HW * 2 - 1.4) * sx, (HL * 2 - 1.4) * sz);
  x.beginPath();
  x.moveTo(0, Z(0));
  x.lineTo(1024, Z(0));
  x.stroke();
  x.beginPath();
  x.arc(X(0), Z(0), 8 * sx, 0, 7);
  x.stroke();
  x.fillStyle = '#fffdf2';
  x.beginPath();
  x.arc(X(0), Z(0), 12, 0, 7);
  x.fill();
  for (const s of [-1, 1]) {
    const w = goalHalf + 5, d = 11;
    x.strokeRect(X(-w), Z(s < 0 ? -HL : HL - d), w * 2 * sx, d * sz);
    x.beginPath();
    x.arc(X(0), Z(s * (HL - d)), 5 * sx, s < 0 ? 0 : Math.PI, s < 0 ? Math.PI : Math.PI * 2);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function netArt() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.strokeStyle = 'rgba(255,255,255,0.92)';
  x.lineWidth = 7;
  x.beginPath();
  x.moveTo(64, 0);
  x.lineTo(128, 64);
  x.lineTo(64, 128);
  x.lineTo(0, 64);
  x.closePath();
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function cupBallArt() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fffaf0';
  x.fillRect(0, 0, 1024, 512);
  // fat stars in the two teams' colours, and a gold band: easy to see it turning
  const star = (px: number, py: number, r: number, col: string) => {
    x.fillStyle = col;
    x.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2, q = k % 2 ? r * 0.5 : r;
      x.lineTo(px + Math.cos(a) * q, py + Math.sin(a) * q);
    }
    x.closePath();
    x.fill();
  };
  for (let k = 0; k < 6; k++) {
    star(k * 171 + 60, 130, 62, k % 2 ? '#2f9bff' : '#ff4f9a');
    star(k * 171 + 145, 382, 62, k % 2 ? '#ff4f9a' : '#2f9bff');
  }
  x.fillStyle = '#ffc21f';
  x.fillRect(0, 238, 1024, 36);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function beanCup(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 118, 0);
  const { HW, HL, cut, goalHalf: gh, goalH, goalD, ceil } = CUP;
  const y0 = center.y;
  b.lakeY = y0 - 30;
  const state = { go: 1e9 };

  // ---- the pitch
  {
    const g = new THREE.BoxGeometry(HW * 2 + 4, 1, (HL + goalD) * 2 + 4).translate(center.x, y0 - 0.5, center.z);
    b.world.statics.addGeometry(g, Mat.Felt);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2, HL * 2).rotateX(-Math.PI / 2).translate(center.x, y0 + 0.01, center.z), new THREE.MeshStandardMaterial({ map: pitchArt(), roughness: 0.82 }));
    art.receiveShadow = true;
    b.group.add(art);
    const base = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 5, 3, (HL + goalD) * 2 + 5).translate(center.x, y0 - 1.52, center.z), new THREE.MeshPhysicalMaterial({ color: 0x2a6ae0, roughness: 0.4, clearcoat: 0.7 }));
    base.receiveShadow = true;
    b.group.add(base);
    const keel = new THREE.Mesh(new THREE.CylinderGeometry(HL * 0.8, 6, 18, 8).scale(0.72, 1, 1.05).translate(center.x, y0 - 12, center.z), new THREE.MeshPhysicalMaterial({ color: 0x2452b8, roughness: 0.55 }));
    b.group.add(keel);
  }

  // ---- the walls: the same outline for beans and for the ball
  const segs: CupArena['segs'] = [];
  const pad = [new THREE.MeshPhysicalMaterial({ color: CUP_COLORS[0], roughness: 0.3, clearcoat: 1 }), new THREE.MeshPhysicalMaterial({ color: CUP_COLORS[1], roughness: 0.3, clearcoat: 1 })];
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8f2ff, transparent: true, opacity: 0.1, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide });
  const topLine = glowMat(0xfff4c0, 1.6);
  const wall = (x0: number, z0: number, x1: number, z1: number, o: { ball?: boolean; h?: number; low?: number; pad?: boolean } = {}) => {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(-(z1 - z0), x1 - x0);
    const mx = center.x + (x0 + x1) / 2, mz = center.z + (z0 + z1) / 2;
    const low = o.low ?? 0, h = (o.h ?? ceil + 1) - low;
    b.world.statics.addGeometry(new THREE.BoxGeometry(len + 0.5, h, 0.5).rotateY(a).translate(mx, y0 + low + h / 2, mz), Mat.Bumper);
    if (o.ball !== false) segs.push([center.x + x0, center.z + z0, center.x + x1, center.z + z1]);
    if (o.pad !== false) {
      const col = (z0 + z1) / 2 < 0 ? 0 : 1;
      const tube = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, len, 8, 16).rotateZ(Math.PI / 2).rotateY(a).translate(mx, y0 + 0.7, mz), pad[col]);
      tube.castShadow = true;
      b.group.add(tube);
    }
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, h).rotateY(a).translate(mx, y0 + low + h / 2, mz), glass);
    b.group.add(pane);
    const top = new THREE.Mesh(new THREE.BoxGeometry(len + 0.3, 0.16, 0.16).rotateY(a).translate(mx, y0 + low + h, mz), topLine);
    b.group.add(top);
  };
  for (const s of [-1, 1]) {
    // the long sides, the cut corners, and each end up to the goal
    wall(s * HW, -HL + cut, s * HW, HL - cut);
    wall(s * HW, HL - cut, s * (HW - cut), HL);
    wall(s * HW, -HL + cut, s * (HW - cut), -HL);
    wall(s * (HW - cut), HL, s * gh, HL);
    wall(s * (HW - cut), -HL, s * gh, -HL);
  }

  // ---- the goals
  const nets: THREE.Group[] = [];
  const see: THREE.Material[][] = [[], []];
  const hit = [-9, -9];
  const netTex = netArt();
  for (const team of [0, 1]) {
    // (team 0 defends the -z end)
    const s = team === 0 ? -1 : 1;
    const z = s * HL, zb = s * (HL + goalD);
    // over the bar is still a wall; inside, the sides, the back and the roof hold the ball
    wall(-gh, z, gh, z, { low: goalH, pad: false, ball: false });
    wall(-gh, z, -gh, zb, { h: goalH, pad: false });
    wall(gh, z, gh, zb, { h: goalH, pad: false });
    wall(-gh, zb, gh, zb, { h: goalH, pad: false });
    b.world.statics.addGeometry(new THREE.BoxGeometry(gh * 2 + 0.5, 0.4, goalD).translate(center.x, y0 + goalH + 0.2, center.z + s * (HL + goalD / 2)), Mat.Bumper);
    const frame = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.25, clearcoat: 1, transparent: true });
    see[team].push(frame);
    const trim = glowMat(CUP_COLORS[team], 2);
    const g = new THREE.Group();
    g.position.set(center.x, y0, center.z + z);
    for (const px of [-gh, gh]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, goalH, 16).translate(px, goalH / 2, 0), frame);
      post.castShadow = true;
      g.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, gh * 2 + 0.68, 16).rotateZ(Math.PI / 2).translate(0, goalH, 0), frame);
    bar.castShadow = true;
    g.add(bar);
    g.add(new THREE.Mesh(new THREE.BoxGeometry(gh * 2, 0.1, 0.4).translate(0, 0.05, 0), trim));
    b.group.add(g);
    const net = new THREE.Group();
    net.position.copy(g.position);
    const nm = (w: number, h: number) => {
      const t = netTex.clone();
      t.repeat.set(w / 1.4, h / 1.4);
      t.needsUpdate = true;
      const q = new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xffffff });
      see[team].push(q);
      return q;
    };
    const back = new THREE.Mesh(new THREE.PlaneGeometry(gh * 2, goalH).translate(0, goalH / 2, s * goalD), nm(gh * 2, goalH));
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(gh * 2, goalD).rotateX(Math.PI / 2).translate(0, goalH, (s * goalD) / 2), nm(gh * 2, goalD));
    net.add(back, roof);
    for (const px of [-gh, gh]) net.add(new THREE.Mesh(new THREE.PlaneGeometry(goalD, goalH).rotateY(Math.PI / 2).translate(px, goalH / 2, (s * goalD) / 2), nm(goalD, goalH)));
    b.group.add(net);
    nets.push(net);
    // a hot strip of the team's colour inside the goal
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(gh * 2, goalD).rotateX(-Math.PI / 2).translate(center.x, y0 + 0.03, center.z + s * (HL + goalD / 2)), new THREE.MeshBasicMaterial({ color: CUP_COLORS[team], transparent: true, opacity: 0.4, toneMapped: false }));
    b.group.add(glow);
  }

  // ---- the two big bumpers on the halfway line: a wall that throws it back
  const rounds: CupArena['rounds'] = [];
  for (const s of [-1, 1]) {
    const px = center.x + s * (HW + 0.2), pz = center.z, r = 2.6, H = 2.2;
    rounds.push({ x: px, z: pz, r, kick: 6 });
    const k = new Kin({ type: 'cyl', r, hh: H / 2 }, Mat.Bumper, (_t, p, q) => {
      p.set(px, y0 + H / 2, pz);
      q.identity();
    });
    k.kick = 7;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.2, H, 36), new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.25, clearcoat: 1 })));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 30, 12, 0, 6.3, 0, 1.57).scale(1, 0.42, 1).translate(0, H / 2, 0), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 }));
    g.add(cap);
    b.obstacle(k, g, false);
    b.animators.push((t) => {
      const f = Math.max(0, 1 - (t - k.lastHit) * 5);
      g.scale.set(1 + f * 0.16, 1 - f * 0.12, 1 + f * 0.16);
    });
  }

  // ---- floodlights on the corners
  {
    const pole = new THREE.MeshPhysicalMaterial({ color: 0xeaf0ff, roughness: 0.35, clearcoat: 0.8 });
    const lamp = glowMat(0xfff6d0, 2.8);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = center.x + sx * (HW + 3.5), z = center.z + sz * (HL + 2);
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 21, 12).translate(x, y0 + 10, z), pole);
        p.castShadow = true;
        const head = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 0.6), lamp);
        head.position.set(x, y0 + 21, z);
        head.lookAt(center.x, y0, center.z);
        b.group.add(p, head);
      }
  }

  const balls: CupBall[] = [0, 1].map(() => ({ pos: new THREE.Vector3(center.x, y0 + CUP.R, center.z), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), live: false, backAt: 0, last: -1, prev: -1, kickT: -9 }));
  b.animators.push((t) => {
    nets.forEach((n, i) => {
      const f = Math.max(0, 1 - (t - hit[i]) * 1.4);
      const s = i === 0 ? -1 : 1;
      n.scale.z = 1 + Math.sin((t - hit[i]) * 18) * f * 0.09;
      n.position.z = center.z + s * HL;
    });
  });
  const arena: CupArena = {
    center,
    of: new Map(),
    balls,
    segs,
    rounds,
    shake(team, t) {
      hit[team] = t;
    },
    view(cam) {
      see.forEach((list, i) => {
        const past = ((i === 0 ? -1 : 1) * (cam.z - center.z) - (HL - 7)) / 5;
        const o = 1 - 0.9 * THREE.MathUtils.clamp(past, 0, 1);
        for (const m of list) m.opacity = o;
      });
    },
    goal(team, o) {
      return o.set(center.x, y0, center.z + (team === 0 ? 1 : -1) * HL);
    },
  };
  title(b, info, 'Most goals stays in the show', 0xff4f9a, new THREE.Vector3(center.x, y0 + 15, center.z - HL - goalD - 3));
  dressArena(b, new THREE.Vector3(center.x, y0 - 3, center.z), HL + 10, 29);
  b.finish();
  return {
    id: 'beancup',
    name: info.name,
    kind: 'team',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 8,
    lakeY: b.lakeY,
    state,
    // (even places on the pink end, odd on the blue: everyone in their own half, facing the ball)
    grid: (n) => {
      const out: { pos: THREE.Vector3; yaw: number }[] = [];
      for (let k = 0; k < n; k++) {
        const s = k % 2 ? 1 : -1, i = Math.floor(k / 2), col = i % 6, row = Math.floor(i / 6);
        const pos = new THREE.Vector3(center.x + (col - 2.5) * 6.2 + row * 2.4, y0 + 0.6, center.z + s * (11 + row * 7));
        out.push({ pos, yaw: s > 0 ? Math.PI : 0 });
      }
      return out;
    },
    plate: { center, radius: HW, bars: [] },
    cup: arena,
    intro: [],
  };
}
