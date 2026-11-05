import * as THREE from 'three';
import { CourseBuilder } from './builder.ts';
import { Kin, Mat, type Marble } from './physics.ts';
import type { Course } from './courses.ts';
import { dressArena } from './course-dress.ts';
import { glowMat } from './obs-world.ts';
import { ringGrid, title } from './course-modes.ts';

/**
 * Crown Keeper, the other final: an open round floor in the sky and one crown. Pick it up and your
 * clock runs; hold it for KEEP.hold seconds in all and you win the show. A dive or a grab knocks it
 * loose, so does going over, and so does the edge. A low bar starts sweeping the floor part way in.
 * Who has it is the host's to say (modes.ts); the bar is a function of the clock.
 */
export const KEEP = { R: 15, hold: 25, T: 130, pick: 1.5, steal: 1.8, safe: 1.7, barAt: 20, barV: 0.85 };

export interface KeepArena {
  center: THREE.Vector3;
  R: number;
  /** who has the crown (a bean id, -1: it's lying loose) */
  holder: number;
  /** where it's lying */
  x: number;
  z: number;
  /** the sweeping bar's angle at x seconds after the off (null: not started) */
  bar(x: number): number | null;
  /** the plinths: something to hop on and run round */
  posts: { x: number; z: number; r: number }[];
}

export function crownKeep(info: { name: string; blurb: string }): Course {
  const b = new CourseBuilder();
  const center = new THREE.Vector3(0, 124, 0);
  const R = KEEP.R;
  const state = { go: 1e9 };
  b.lakeY = center.y - 30;
  const bar = (x: number) => (x < KEEP.barAt ? null : (x - KEEP.barAt) * (KEEP.barV + 0.003 * (x - KEEP.barAt)));
  const arena: KeepArena = { center, R, holder: -1, x: center.x, z: center.z, bar, posts: [] };
  // the floor: a checked royal round with a gold rim
  {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const x = c.getContext('2d')!;
    for (let k = 0; k < 16; k++)
      for (let r = 0; r < 6; r++) {
        x.beginPath();
        x.arc(512, 512, 512 - r * 80, (k / 16) * Math.PI * 2, ((k + 1) / 16) * Math.PI * 2);
        x.arc(512, 512, 432 - r * 80, ((k + 1) / 16) * Math.PI * 2, (k / 16) * Math.PI * 2, true);
        x.closePath();
        x.fillStyle = (k + r) % 2 ? '#5a2fb8' : '#7a4be0';
        x.fill();
      }
    x.beginPath();
    x.arc(512, 512, 506, 0, Math.PI * 2);
    x.lineWidth = 12;
    x.strokeStyle = '#ffd23a';
    x.stroke();
    x.beginPath();
    x.arc(512, 512, 40, 0, Math.PI * 2);
    x.fillStyle = '#ffd23a';
    x.fill();
    const tx = new THREE.CanvasTexture(c);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    const top = new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2).translate(center.x, center.y, center.z);
    b.world.statics.addGeometry(top, Mat.Paint);
    const tm = new THREE.Mesh(top, new THREE.MeshPhysicalMaterial({ map: tx, roughness: 0.35, clearcoat: 0.7 }));
    tm.receiveShadow = true;
    b.group.add(tm);
    const rim = new THREE.CylinderGeometry(R, R * 0.92, 1.6, 96, 1, true).translate(center.x, center.y - 0.8, center.z);
    b.world.statics.addGeometry(rim, Mat.Paint);
    const rm = new THREE.Mesh(rim, new THREE.MeshPhysicalMaterial({ color: 0xffc21f, roughness: 0.3, metalness: 0.6 }));
    rm.castShadow = true;
    b.group.add(rm);
    b.group.add(new THREE.Mesh(new THREE.ConeGeometry(R * 0.92, 12, 48, 1, true).rotateX(Math.PI).translate(center.x, center.y - 7.6, center.z), new THREE.MeshStandardMaterial({ color: 0x3a2070, roughness: 0.7, side: THREE.DoubleSide })));
  }
  // four plinths to hop on and dodge round
  {
    const m = new THREE.MeshPhysicalMaterial({ color: 0xffd23a, roughness: 0.3, clearcoat: 0.8 });
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4, r = 8.4, pr = 1.5, h = 1;
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      arena.posts.push({ x, z, r: pr });
      const g = new THREE.CylinderGeometry(pr, pr * 1.1, h, 28).translate(x, center.y + h / 2, z);
      b.world.statics.addGeometry(g, Mat.Paint);
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = mesh.receiveShadow = true;
      b.group.add(mesh);
    }
  }
  // the bar: hop it, or down you go and the crown with you
  {
    const L = R - 1.2, hh = 0.26, y = center.y + 0.42;
    const kin = new Kin({ type: 'box', hx: L, hy: hh, hz: 0.3 }, Mat.Paint, (t, pos, quat) => {
      const a = bar(t - state.go);
      pos.set(center.x, a === null ? y - 60 : y, center.z);
      quat.setFromAxisAngle(UP, a ?? 0);
    });
    b.world.addKin(kin);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(L * 2, hh * 2, 0.6), new THREE.MeshPhysicalMaterial({ color: 0xff4f6a, roughness: 0.3, clearcoat: 0.8, emissive: 0xff2040, emissiveIntensity: 0.25 }));
    mesh.castShadow = true;
    mesh.visible = false;
    b.group.add(mesh);
    b.animators.push((t) => {
      const a = bar(t - state.go);
      mesh.visible = a !== null;
      if (a === null) return;
      mesh.position.set(center.x, y, center.z);
      mesh.rotation.y = a;
    });
  }
  // the holder is a touch slower, or nobody could ever catch them
  b.world.fields.push({
    min: new THREE.Vector3(center.x - R - 3, center.y - 2, center.z - R - 3),
    max: new THREE.Vector3(center.x + R + 3, center.y + 8, center.z + R + 3),
    act: (m: Marble) => {
      if (arena.holder === m.id) m.runK *= 0.93;
    },
  });
  // a ring of gold lamps round the sky
  {
    const lamp = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 12, 8), glowMat(0xffd070, 3), 24);
    const M = new THREE.Matrix4();
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      lamp.setMatrixAt(k, M.makeTranslation(center.x + Math.cos(a) * (R + 5), center.y + 3 + Math.sin(k * 1.7) * 0.6, center.z + Math.sin(a) * (R + 5)));
    }
    b.group.add(lamp);
  }
  title(b, info, 'The final · Keep the crown', 0xffc21f, new THREE.Vector3(center.x, center.y + 8, center.z - R - 6));
  dressArena(b, new THREE.Vector3(center.x, center.y - 2, center.z), R + 6, 47);
  b.finish();
  return {
    id: 'crownkeep',
    name: info.name,
    kind: 'final',
    blurb: info.blurb,
    b,
    path: null,
    finishS: 0,
    gaps: [],
    checkpoints: [],
    killY: center.y - 6,
    lakeY: b.lakeY,
    state,
    grid: (n) => ringGrid(center, n, 6, 3.2, 8),
    plate: { center, radius: R, bars: [] },
    keep: arena,
    intro: [],
  };
}
const UP = new THREE.Vector3(0, 1, 0);
