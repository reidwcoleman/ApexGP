import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Mat, Mode, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { ringGrid, title } from './course-modes.ts';

/**
 * Bounce House: the floor of a giant inflatable castle that never lets you stand still. Everyone
 * bounces, all the time, and the air fills with balloons. Steer through them to pop them; a jump
 * pressed as you land is a super bounce, up to the high ones; pops close together build a combo.
 * Thunder balloons zap you and break it. Nobody falls off: it's all about what you pop, and the
 * lowest scores go home. The balloons are a function of the clock; who popped what is the host's.
 */
export const BOUNCE = {
  R: 16,
  T: 90,
  /** speed off the floor: a plain bounce, and a super one */
  v: 11.5,
  super: 16.6,
  /** a jump this long before landing still counts */
  press: 0.3,
  life: 9,
  reach: 1.35,
  /** pops this close together build the combo, up to `maxCombo` */
  chain: 2.4,
  maxCombo: 4,
  /** a star balloon every so often, and the storm at the end */
  star: 15,
  starV: 10,
  storm: 16,
};

export const enum Pop {
  Low = 0,
  High = 1,
  Star = 2,
  Thunder = 3,
}

export interface Balloon {
  k: number;
  /** seconds after the off */
  t: number;
  x: number;
  z: number;
  /** its height off the floor */
  h: number;
  kind: Pop;
  /** drifts round this phase */
  ph: number;
}

export interface BounceArena {
  center: THREE.Vector3;
  R: number;
  balloons: Balloon[];
  /** where a balloon is, x seconds after the off */
  at(b: Balloon, x: number, o: THREE.Vector3): THREE.Vector3;
  /** when each bean last super bounced (world time): the game plays it */
  supers: Map<number, number>;
}

const BOUNCE_V = [1, 3, BOUNCE.starV, -3];
export const popValue = (k: Pop) => BOUNCE_V[k];

export function bounceHouse(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 118, 0);
  const R = BOUNCE.R, y0 = center.y;
  const state = { go: 1e9 };
  b.lakeY = y0 - 30;
  let sd = 40111;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  // ---- the balloons, all of them, from the off
  const balloons: Balloon[] = [];
  {
    let k = 0;
    const spot = (r0: number) => {
      const a = rnd() * Math.PI * 2, r = r0 * Math.sqrt(rnd());
      return { x: center.x + Math.cos(a) * r, z: center.z + Math.sin(a) * r, ph: rnd() * 6.28 };
    };
    for (let t = 1.5; t < BOUNCE.T; ) {
      const storm = t > BOUNCE.T - BOUNCE.storm;
      const u = rnd();
      const kind = u < 0.6 ? Pop.Low : u < 0.84 ? Pop.High : Pop.Thunder;
      balloons.push({ k: k++, t, ...spot(R - 2.5), h: kind === Pop.Low ? 1.9 + rnd() * 1.2 : kind === Pop.High ? 3.9 + rnd() * 1.3 : 2 + rnd() * 3, kind });
      t += (storm ? 0.11 : Math.max(0.19, 0.33 - t * 0.0016)) * (0.7 + rnd() * 0.6);
    }
    for (let t = BOUNCE.star; t < BOUNCE.T - 2; t += BOUNCE.star) balloons.push({ k: k++, t, ...spot(R - 6), h: 5.4, kind: Pop.Star });
    balloons.sort((p, q) => p.t - q.t);
  }
  const at = (q: Balloon, x: number, o: THREE.Vector3) => {
    const u = x - q.t;
    const rise = Math.min(1, u / 0.7);
    const drift = q.kind === Pop.Star ? 3.2 : 0.7;
    return o.set(q.x + Math.sin(u * 0.7 + q.ph) * drift, y0 + 0.4 + (q.h - 0.4) * (1 - (1 - rise) ** 3) + Math.sin(u * 1.7 + q.ph) * 0.18, q.z + Math.cos(u * 0.6 + q.ph) * drift);
  };
  // ---- the floor: puffed rings of vinyl (it looks soft; the bounce is the field below)
  {
    const cols = ['#ff4f7a', '#ffd23a', '#2fa8ff', '#37d07a', '#a05aff', '#ff8a2f'];
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const x = c.getContext('2d')!;
    x.translate(512, 512);
    for (let r = 6; r >= 0; r--) {
      for (let s = 0; s < 12; s++) {
        x.beginPath();
        x.moveTo(0, 0);
        x.arc(0, 0, (r + 1) * 73, (s / 12) * Math.PI * 2, ((s + 1) / 12) * Math.PI * 2);
        x.closePath();
        x.fillStyle = cols[(s + r * 2) % cols.length];
        x.fill();
      }
    }
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    x.lineWidth = 5;
    for (let r = 1; r <= 7; r++) {
      x.beginPath();
      x.arc(0, 0, r * 73, 0, Math.PI * 2);
      x.stroke();
    }
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    const flat = new THREE.CircleGeometry(R + 0.4, 96).rotateX(-Math.PI / 2).translate(center.x, y0, center.z);
    b.world.statics.addGeometry(flat, Mat.Felt);
    const m = new THREE.Mesh(new THREE.RingGeometry(0.01, R + 0.4, 128, 24).rotateX(-Math.PI / 2).translate(center.x, y0, center.z), new THREE.MeshPhysicalMaterial({ map: tx, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.5 }));
    const uv = m.geometry.getAttribute('uv') as THREE.BufferAttribute, pos = m.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + (pos.getX(i) - center.x) / (2 * (R + 0.4)), 0.5 - (pos.getZ(i) - center.z) / (2 * (R + 0.4)));
    const base = Float32Array.from({ length: pos.count }, (_, i) => Math.hypot(pos.getX(i) - center.x, pos.getZ(i) - center.z));
    m.receiveShadow = true;
    b.group.add(m);
    b.animators.push((t) => {
      for (let i = 0; i < pos.count; i++) pos.setY(i, y0 + Math.sin(base[i] * 0.9 - t * 3.2) * 0.07 * Math.min(1, (R + 0.4 - base[i]) * 0.5));
      pos.needsUpdate = true;
      m.geometry.computeVertexNormals();
    });
    const under = new THREE.Mesh(new THREE.CylinderGeometry(R + 1, R * 0.5, 9, 40).translate(center.x, y0 - 4.6, center.z), new THREE.MeshPhysicalMaterial({ color: 0xff4f7a, roughness: 0.4, clearcoat: 0.8 }));
    b.group.add(under);
  }
  // ---- the walls: fat tubes all the way round, striped, and a turret at each quarter
  {
    const H = 7;
    const wall = new THREE.CylinderGeometry(R + 0.7, R + 0.7, H + 2, 64, 1, true).translate(center.x, y0 + H / 2, center.z);
    b.world.statics.addGeometry(wall, Mat.Bumper);
    const stripes = [0xff4f7a, 0xffd23a, 0x2fa8ff];
    for (let k = 0; k < 3; k++) {
      const tube = new THREE.Mesh(new THREE.TorusGeometry(R + 1.2, 0.72, 16, 96).rotateX(Math.PI / 2).translate(center.x, y0 + 0.6 + k * 1.34, center.z), new THREE.MeshPhysicalMaterial({ color: stripes[k], roughness: 0.28, clearcoat: 1 }));
      tube.castShadow = tube.receiveShadow = true;
      b.group.add(tube);
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8, r = R + 1.5;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const col = stripes[k % 3], tall = 6.2 + (k % 2) * 1.6;
      const mat = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.28, clearcoat: 1 });
      const tow = new THREE.Mesh(new THREE.CapsuleGeometry(1.25, tall, 6, 20).translate(x, y0 + tall / 2, z), mat);
      tow.castShadow = true;
      b.group.add(tow);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.4, 20).translate(x, y0 + tall + 2.2, z), new THREE.MeshPhysicalMaterial({ color: stripes[(k + 1) % 3], roughness: 0.28, clearcoat: 1 }));
      cap.castShadow = true;
      b.group.add(cap);
      // (the whole castle's breathing)
      const y1 = tow.scale.y;
      b.animators.push((t) => {
        tow.scale.x = tow.scale.z = 1;
        cap.position.y = Math.sin(t * 2.1 + k) * 0.08;
        tow.position.y = Math.sin(t * 2.1 + k) * 0.05 * y1;
      });
    }
  }
  // the lamps of the show on the walls
  {
    const n = 40;
    const lamp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8), glowMat(0xfff0c0, 2.6), n);
    const M = new THREE.Matrix4();
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      lamp.setMatrixAt(k, M.makeTranslation(center.x + Math.cos(a) * (R + 0.55), y0 + 3.9, center.z + Math.sin(a) * (R + 0.55)));
    }
    b.group.add(lamp);
  }
  // ---- the bounce itself
  const supers = new Map<number, number>();
  const pressed = new Map<number, number>();
  b.world.fields.push({
    min: new THREE.Vector3(center.x - R - 2, y0 - 2, center.z - R - 2),
    max: new THREE.Vector3(center.x + R + 2, y0 + 22, center.z + R + 2),
    act: (m: Marble, t: number) => {
      if (t < state.go) return;
      if (m.jumpBuf > 0) {
        pressed.set(m.id, t);
        m.jumpBuf = 0;
      }
      if (m.vel.y > 0.5 || m.pos.y - 0.5 - y0 > 0.14 || m.mode === Mode.Tumble) return;
      const up = t - (pressed.get(m.id) ?? -9) < BOUNCE.press;
      m.vel.y = up ? BOUNCE.super : BOUNCE.v;
      if (m.mode === Mode.Dive) m.mode = Mode.Run;
      m.groundT = 1;
      m.hopped = true;
      if (up) {
        supers.set(m.id, t);
        pressed.delete(m.id);
      }
    },
  });
  title(b, info, 'Pop the most · Least goes home', 0xff4f7a, new THREE.Vector3(center.x, y0 + 12, center.z - R - 7));
  dressArena(b, new THREE.Vector3(center.x, y0 - 2, center.z), R + 8, 53);
  b.finish();
  return {
    id: 'bouncehouse',
    name: info.name,
    kind: 'score',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: y0 - 8,
    lakeY: b.lakeY,
    state,
    grid: (n) => ringGrid(center, n, 4.2, 3, 9),
    plate: { center, radius: R, bars: [] },
    bounce: { center, R, balloons, at, supers },
    intro: [],
  };
}
