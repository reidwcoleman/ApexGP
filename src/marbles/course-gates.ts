import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { title } from './course-modes.ts';
import { makeCrown } from './course-kit.ts';
import { CUP_CFG, type CupArena, type CupBall } from './course-soccer.ts';

/**
 * Gate Crashers, the final. A round arena, and in its wall a gate for every bean left in the show,
 * in that bean's colour with its name over it. Balls drop in. A ball through YOUR gate and you're
 * out: your gate shuts and you're fired out of the arena. Run into a ball to dribble it, DIVE into
 * it to shoot, stand in front of your gate to keep it out. More balls come, and the gates grow
 * wider as it goes on. The last bean standing takes the crown.
 *
 * The balls are the host's, run by soccer.ts like every other ball game's; the gates are just
 * angles round the ring, so the ball's side of it is a few lines of maths there.
 */
export const GATES = {
  /** the arena's radius, and how high a gate is (a ball over the top of one comes back off the wall) */
  R: 17,
  H: 4.4,
  /** a gate's width at the off is a share of the wall each bean has, between these (m) */
  share: 0.4,
  min: 5,
  max: 12,
  /** then, from `growAt` seconds in, every gate widens this fast (m/s) */
  growAt: 14,
  grow: 0.085,
  /** when the second and third balls drop in (s), and the latest it can go on */
  ballAt: [0, 20, 44],
  T: 150,
  /** lives each: a ball through your gate costs one (a big final is sudden death, or it would never end) */
  lives: (n: number) => (n <= 6 ? 3 : n <= 10 ? 2 : 1),
};
export const GATE_COLORS = [0xff4f9a, 0x2f9bff, 0xffc21f, 0x37c25a, 0xff7a1f, 0x9b6bff, 0x1fc8c0, 0xff3a4a, 0xb4e02e, 0xf2f2f6, 0xb07a44, 0x5a6cff];

export interface Gate {
  /** where round the ring its middle is (rad, from +x toward +z) */
  a: number;
  /** whose it is (bean id; -1: nobody's) */
  owner: number;
  open: boolean;
  col: number;
}
export interface GateRing {
  R: number;
  H: number;
  list: Gate[];
  /** half the angle an open gate spans now (set by the game every frame, from the clock and who's left) */
  cur: number;
  /** the lives every bean has left (by bean id) */
  lives: Map<number, number>;
  /** a ball's gone through gate i but its bean has lives left: the gate flashes */
  hit(i: number, t: number): void;
  half(x: number, alive: number): number;
  /** gate i belongs to this bean */
  own(i: number, id: number, name: string, me: boolean): void;
  /** gate i is shut for good */
  close(i: number, t: number): void;
  /** the middle of gate i, on the wall */
  at(i: number, o: THREE.Vector3): THREE.Vector3;
}

function label(text: string, col: number, me: boolean) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const x = c.getContext('2d')!;
  const css = `#${col.toString(16).padStart(6, '0')}`;
  x.fillStyle = me ? '#ffd23a' : '#17182a';
  x.beginPath();
  x.roundRect(8, 8, 496, 112, 40);
  x.fill();
  x.lineWidth = 10;
  x.strokeStyle = css;
  x.stroke();
  x.fillStyle = me ? '#17182a' : '#ffffff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = '86px "Lilita One", "Arial Black", sans-serif';
  x.fillText(text.toUpperCase().slice(0, 10), 256, 68, 460);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function floorArt(R: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(512, 512, 40, 512, 512, 512);
  g.addColorStop(0, '#5b3fb8');
  g.addColorStop(0.55, '#4a2f9c');
  g.addColorStop(1, '#2f1d70');
  x.fillStyle = g;
  x.fillRect(0, 0, 1024, 1024);
  // rings, and a sunburst from the middle
  for (let k = 0; k < 24; k++) {
    x.fillStyle = k % 2 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.05)';
    x.beginPath();
    x.moveTo(512, 512);
    x.arc(512, 512, 512, (k / 24) * Math.PI * 2, ((k + 1) / 24) * Math.PI * 2);
    x.closePath();
    x.fill();
  }
  x.strokeStyle = '#ffd23a';
  x.lineWidth = 7;
  for (const r of [3.2, R * 0.55, R - 0.5]) {
    x.beginPath();
    x.arc(512, 512, (r / R) * 512, 0, 7);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function gateCrashers(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 124, 0), y0 = center.y, R = GATES.R, C = CUP_CFG.gates;
  b.lakeY = y0 - 30;
  const state = { go: 1e9 };

  // ---- the floor
  b.world.statics.addGeometry(new THREE.CylinderGeometry(R + 1.4, R + 1.4, 1, 72).translate(center.x, y0 - 0.5, center.z), Mat.Felt);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 0.2, 96).rotateX(-Math.PI / 2).translate(center.x, y0 + 0.01, center.z), new THREE.MeshStandardMaterial({ map: floorArt(R), roughness: 0.6 }));
  floor.receiveShadow = true;
  b.group.add(floor);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.9, R + 0.6, 3, 72).translate(center.x, y0 - 1.52, center.z), new THREE.MeshPhysicalMaterial({ color: 0xffc534, roughness: 0.35, metalness: 0.5, clearcoat: 0.7 }));
  base.receiveShadow = true;
  b.group.add(base);
  b.group.add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.7, 4, 18, 10).translate(center.x, y0 - 12, center.z), new THREE.MeshPhysicalMaterial({ color: 0x3a2386, roughness: 0.55 })));

  // ---- the wall: a padded kerb all the way round, glass over it (for the beans; the ball has its own maths)
  const SEG = 56;
  for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * Math.PI * 2;
    b.world.statics.addGeometry(new THREE.BoxGeometry(((Math.PI * 2 * (R + 0.4)) / SEG) * 1.08, 3.4, 0.6).rotateY(-a + Math.PI / 2).translate(center.x + Math.cos(a) * (R + 0.4), y0 + 1.7, center.z + Math.sin(a) * (R + 0.4)), Mat.Bumper);
  }
  const kerb = new THREE.Mesh(new THREE.TorusGeometry(R + 0.4, 0.62, 14, 120).rotateX(Math.PI / 2).translate(center.x, y0 + 0.55, center.z), new THREE.MeshPhysicalMaterial({ color: 0xf4eefc, roughness: 0.3, clearcoat: 1 }));
  kerb.castShadow = true;
  b.group.add(kerb);
  b.group.add(new THREE.Mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.4, 2.6, 96, 1, true).translate(center.x, y0 + 2.1, center.z), new THREE.MeshPhysicalMaterial({ color: 0xd8f2ff, transparent: true, opacity: 0.08, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide })));
  b.group.add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.4, 0.08, 6, 120).rotateX(Math.PI / 2).translate(center.x, y0 + 3.4, center.z), glowMat(0xfff4c0, 1.6)));

  // ---- the bumper in the middle: nothing sits still in here
  const rounds: CupArena['rounds'] = [{ x: center.x, z: center.z, r: 1.7, kick: 7 }];
  {
    const r = 1.7, H = 1.9;
    const k = new Kin({ type: 'cyl', r, hh: H / 2 }, Mat.Bumper, (_t, p, q) => {
      p.set(center.x, y0 + H / 2, center.z);
      q.identity();
    });
    k.kick = 7;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.2, H, 36), new THREE.MeshPhysicalMaterial({ color: 0xffc534, roughness: 0.25, metalness: 0.4, clearcoat: 1 })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(r, 30, 12, 0, 6.3, 0, 1.57).scale(1, 0.42, 1).translate(0, H / 2, 0), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1 })));
    b.obstacle(k, g, false);
    b.animators.push((t) => {
      const f = Math.max(0, 1 - (t - k.lastHit) * 5);
      g.scale.set(1 + f * 0.16, 1 - f * 0.12, 1 + f * 0.16);
    });
  }

  // ---- the crown, hanging over the middle for whoever's left
  const crown = makeCrown();
  crown.position.set(center.x, y0 + 8.5, center.z);
  b.group.add(crown);
  b.animators.push((t) => {
    if (state.go < 1e8 && crown.position.y > y0 + 6) crown.position.y = y0 + 8.5 + Math.sin(t * 1.4) * 0.35;
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.2, 8, 24, 1, true).translate(center.x, y0 + 5.2, center.z), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
  b.group.add(beam);

  // ---- the gates: made when the field's known (one each)
  const list: Gate[] = [];
  interface Vis {
    posts: THREE.Mesh[];
    arc: THREE.Mesh;
    wedge: THREE.Mesh;
    tag: THREE.Mesh | null;
    mat: THREE.MeshPhysicalMaterial;
    glow: THREE.MeshBasicMaterial;
    half: number;
    shut: number;
    me: boolean;
    hitT: number;
  }
  const vis: Vis[] = [];
  const gatesG = new THREE.Group();
  b.group.add(gatesG);
  const postG = new THREE.CylinderGeometry(0.42, 0.5, GATES.H, 16).translate(0, GATES.H / 2, 0);
  const shape = (i: number, half: number) => {
    const g = list[i], v = vis[i];
    v.half = half;
    v.posts.forEach((p, k) => {
      const a = g.a + (k ? half : -half);
      p.position.set(center.x + Math.cos(a) * (R + 0.3), y0, center.z + Math.sin(a) * (R + 0.3));
    });
    v.arc.geometry.dispose();
    // (three's torus arc starts on +x and runs toward +y: laid flat, that's toward -z, so it's turned over)
    v.arc.geometry = new THREE.TorusGeometry(R + 0.3, 0.3, 8, 40, half * 2).rotateX(Math.PI / 2).rotateY(-(g.a - half));
    v.wedge.geometry.dispose();
    // (and a ring laid flat runs the other way round)
    v.wedge.geometry = new THREE.RingGeometry(R - 3.4, R - 0.1, 40, 1, 0, half * 2).rotateX(-Math.PI / 2).rotateY(-(g.a + half));
  };
  const layout = (n: number) => {
    if (list.length === n) return;
    for (const v of vis) {
      for (const o of [...v.posts, v.arc, v.wedge]) gatesG.remove(o);
      if (v.tag) gatesG.remove(v.tag);
    }
    list.length = vis.length = 0;
    for (let i = 0; i < n; i++) {
      const col = GATE_COLORS[i % GATE_COLORS.length];
      list.push({ a: (i / n) * Math.PI * 2 + Math.PI / 2, owner: -1, open: true, col });
      const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.28, clearcoat: 1, emissive: col, emissiveIntensity: 0.25 });
      const glow = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false });
      const posts = [new THREE.Mesh(postG, mat), new THREE.Mesh(postG, mat)];
      for (const p of posts) p.castShadow = true;
      const arc = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      arc.position.set(center.x, y0 + GATES.H, center.z);
      const wedge = new THREE.Mesh(new THREE.BufferGeometry(), glow);
      wedge.position.set(center.x, y0 + 0.04, center.z);
      wedge.renderOrder = 1;
      gatesG.add(...posts, arc, wedge);
      vis.push({ posts, arc, wedge, tag: null, mat, glow, half: 0, shut: -1, me: false, hitT: -9 });
      shape(i, ring.half(0, n));
    }
    ring.cur = ring.half(0, n);
  };
  const ring: GateRing = {
    R,
    H: GATES.H,
    list,
    cur: 0.2,
    lives: new Map(),
    hit(i, t) {
      if (vis[i]) vis[i].hitT = t;
    },
    half(x, alive) {
      const n = Math.max(1, list.length), left = Math.max(2, Math.min(n, alive));
      // (wider with fewer left to guard against, wider as it goes on, never into the next bean's)
      const arc = THREE.MathUtils.clamp(((Math.PI * 2 * R) / left) * GATES.share, GATES.min, GATES.max) + Math.max(0, x - GATES.growAt) * GATES.grow;
      return Math.min(arc / (2 * R), Math.PI / n - 0.07);
    },
    own(i, id, name, me) {
      const g = list[i], v = vis[i];
      if (!g) return;
      g.owner = id;
      ring.lives.set(id, GATES.lives(list.length));
      v.me = me;
      if (v.tag) gatesG.remove(v.tag);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(me ? 6.4 : 5, me ? 1.6 : 1.25), new THREE.MeshBasicMaterial({ map: label(me ? 'YOUR GATE' : name, g.col, me), transparent: true, toneMapped: false }));
      tag.position.set(center.x + Math.cos(g.a) * (R + 0.4), y0 + GATES.H + (me ? 1.5 : 1.2), center.z + Math.sin(g.a) * (R + 0.4));
      tag.lookAt(center.x, y0 + GATES.H + 1.2, center.z);
      gatesG.add(tag);
      v.tag = tag;
    },
    close(i, t) {
      const g = list[i], v = vis[i];
      if (!g || !g.open) return;
      g.open = false;
      v.shut = t;
    },
    at(i, o) {
      const g = list[i];
      return o.set(center.x + Math.cos(g.a) * R, y0, center.z + Math.sin(g.a) * R);
    },
  };
  b.animators.push((t) => {
    vis.forEach((v, i) => {
      const g = list[i];
      if (g.open) {
        if (Math.abs(ring.cur - v.half) > 0.006) shape(i, ring.cur);
        // (yours beats like a heart: you never have to look for it; one on its last life flickers;
        // one a ball's just gone through flashes white)
        const last = (ring.lives.get(g.owner) ?? 1) <= 1 && GATES.lives(list.length) > 1;
        const f = Math.max(0, 1 - (t - v.hitT) / 0.7);
        v.glow.opacity = Math.min(1, (v.me ? 0.5 + 0.3 * Math.sin(t * 5) : last ? 0.3 + 0.2 * Math.sin(t * 11 + i) : 0.32 + 0.06 * Math.sin(t * 2 + i)) + f * 0.6);
        v.glow.color.set(g.col).lerp(WHITE, f);
        v.mat.emissiveIntensity = 0.25 + f * 1.5;
      } else if (v.shut >= 0) {
        // shut: it slams to nothing and goes grey
        const k = Math.min(1, (t - v.shut) / 0.5);
        v.glow.opacity = 0.5 * (1 - k);
        v.mat.color.lerpColors(v.mat.color, GREY, k);
        v.mat.emissiveIntensity = 0.25 * (1 - k);
        if (k >= 1) {
          v.wedge.visible = false;
          if (v.tag) v.tag.visible = false;
          v.shut = -1;
        }
      }
    });
  });

  const balls: CupBall[] = Array.from({ length: C.balls }, () => ({ pos: new THREE.Vector3(center.x, y0 + C.R, center.z), vel: new THREE.Vector3(), quat: new THREE.Quaternion(), live: false, backAt: 0, last: -1, prev: -1, kickT: -9, by: [-1, -1] as [number, number], byT: [-99, -99] as [number, number], worth: 2, py: 0, held: -1, thrower: -1, passT: -9, inAir: false, fumbler: -1, dropT: -9, gripT: 0 }));
  const arena: CupArena = {
    center,
    cfg: C,
    of: new Map(),
    balls,
    segs: [],
    rounds,
    shake() {},
    view() {},
    goal(_team, o) {
      return o.copy(center);
    },
    hoops: [],
    gates: ring,
    colors: GATE_COLORS,
  };
  title(b, info, 'Last bean standing takes the crown', 0xffc534, new THREE.Vector3(center.x, y0 + 14, center.z - R - 6));
  dressArena(b, new THREE.Vector3(center.x, y0 - 3, center.z), R + 8, 41);
  b.finish();
  return {
    id: 'gatecrashers',
    name: info.name,
    kind: 'final',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 8,
    lakeY: b.lakeY,
    state,
    // (everyone in front of their own gate, facing the middle)
    grid: (n) => {
      layout(n);
      return list.map((g) => ({ pos: new THREE.Vector3(center.x + Math.cos(g.a) * (R - 4), y0 + 0.6, center.z + Math.sin(g.a) * (R - 4)), yaw: Math.atan2(-Math.cos(g.a), -Math.sin(g.a)) }));
    },
    plate: { center, radius: R, bars: [] },
    cup: arena,
    crown,
    intro: [],
  };
}
const GREY = new THREE.Color(0x6a6a78), WHITE = new THREE.Color(0xffffff);
