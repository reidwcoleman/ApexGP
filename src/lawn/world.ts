/** The space around the islands: clouds, the camera's framing of a lawn, and mower portraits for the shop. */
import * as THREE from 'three';
import type { LevelDef } from './levels.ts';
import { MOWERS, type MowerDef } from './save.ts';
import { buildMowerModel } from './mower.ts';
import { Rng } from './util.ts';

export const CAM = { fov: 30, yaw: -0.36, pitch: 0.93 };

export interface Win {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function camDir(yaw = CAM.yaw, pitch = CAM.pitch) {
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

/**
 * Find where the camera has to be so the whole lawn sits inside a window of the screen:
 * pull back until it fits, then slide the target until it is centred in the window.
 */
export function frameLawn(level: LevelDef, center: THREE.Vector3, win: Win, aspect: number): { target: THREE.Vector3; dist: number } {
  const cam = new THREE.PerspectiveCamera(CAM.fov, aspect, 0.1, 500);
  const hasTree = level.obstacles.some((o) => o.kind === 'tree');
  const hw = level.w / 2;
  const hh = level.h / 2;
  const corners: THREE.Vector3[] = [];
  for (const x of [-hw, hw]) for (const z of [-hh, hh]) for (const y of [-0.7, hasTree ? 2.7 : 1.1]) corners.push(new THREE.Vector3(x, y, z).add(center));
  const dir = camDir();
  const target = center.clone();
  const ww = win.x1 - win.x0;
  const wh = win.y1 - win.y0;
  const wcx = (win.x0 + win.x1) / 2;
  const wcy = (win.y0 + win.y1) / 2;
  const v = new THREE.Vector3();
  const measure = (dist: number) => {
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
    cam.updateProjectionMatrix();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const c of corners) {
      v.copy(c).project(cam);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    return { x0, x1, y0, y1 };
  };
  let dist = 30;
  for (let it = 0; it < 4; it++) {
    let lo = 4;
    let hi = 260;
    for (let k = 0; k < 20; k++) {
      const mid = (lo + hi) / 2;
      const b = measure(mid);
      if (b.x1 - b.x0 <= ww && b.y1 - b.y0 <= wh) hi = mid;
      else lo = mid;
    }
    dist = hi;
    const b = measure(dist);
    const k = dist * Math.tan((CAM.fov * Math.PI) / 360);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const dx = ((b.x0 + b.x1) / 2 - wcx) * k * aspect;
    const dy = ((b.y0 + b.y1) / 2 - wcy) * k;
    target.addScaledVector(right, dx).addScaledVector(up, dy);
  }
  return { target, dist };
}

/** Puffy low-poly clouds drifting beneath and around the islands. */
export class Clouds {
  readonly group = new THREE.Group();
  private items: { g: THREE.Group; sp: number; y: number }[] = [];
  private mat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: false, emissive: '#ffffff', emissiveIntensity: 0.34 });
  private R = 46;

  constructor() {
    const rng = new Rng(77);
    const geo = new THREE.IcosahedronGeometry(1, 3);
    for (let i = 0; i < 22; i++) {
      const g = new THREE.Group();
      const n = rng.int(3, 5);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, this.mat);
        const s = rng.range(1.1, 2.1);
        m.scale.set(s * 1.3, s * 0.72, s);
        m.position.set((k - n / 2) * 1.7 + rng.range(-0.4, 0.4), rng.range(-0.3, 0.5), rng.range(-0.8, 0.8));
        g.add(m);
      }
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(16, this.R);
      const y = rng.range(-11, -5);
      g.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this.items.push({ g, sp: rng.range(0.25, 0.7), y });
      this.group.add(g);
    }
  }
  setTint(color: THREE.ColorRepresentation) {
    this.mat.color.set(color).lerp(new THREE.Color('#ffffff'), 0.6);
    this.mat.emissive.set(color).lerp(new THREE.Color('#ffffff'), 0.7);
  }
  update(dt: number) {
    for (const c of this.items) {
      c.g.position.x += c.sp * dt;
      if (c.g.position.x > this.R) c.g.position.x = -this.R;
    }
  }
}

/** A portrait of each mower for the shop, drawn once on a throwaway renderer. */
export function renderThumbs(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    r.setSize(256, 256, false);
    r.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#b9d49a', 1.5));
    const sun = new THREE.DirectionalLight('#fff4dc', 2.4);
    sun.position.set(-3, 6, 4);
    scene.add(sun);
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    for (const def of MOWERS as MowerDef[]) {
      const model = buildMowerModel(def, def.width);
      const g = model.group;
      g.rotation.y = -0.65;
      scene.add(g);
      const box = new THREE.Box3().setFromObject(g);
      const c = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();
      cam.position.set(c.x + size * 0.7, c.y + size * 0.62, c.z + size * 1.05);
      cam.lookAt(c);
      r.render(scene, cam);
      out[def.id] = canvas.toDataURL('image/png');
      scene.remove(g);
      model.dispose();
    }
    r.dispose();
    r.forceContextLoss();
  } catch {
    /* no portraits: the shop shows names */
  }
  return out;
}
