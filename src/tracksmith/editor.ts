import * as THREE from 'three';
import { PIECES, T, H, footprint, levelY, pieceMesh, type Placed, type MeshOut } from './pieces.ts';
import { Stage, TrackView, meshGeometry } from './render.ts';
import { THEMES } from './theme.ts';
import type { TrackData } from './track.ts';
import type { Audio } from './audio.ts';
import type { Controls } from './input.ts';

export interface EditorHooks {
  changed(td: TrackData): void;
  status(s: { level: number; rot: number; sel: number; count: number; hover: string }): void;
  test(): void;
  exit(): void;
}

/** the order pieces appear in the palette (and their number keys) */
export const PALETTE = ['road', 'turn1', 'turn2', 'turn3', 'slope', 'slope2', 'climb', 'ramp', 'boost', 'check', 'start', 'finish', 'loop', 'loopR', 'plate', 'block'].map((id) => PIECES.findIndex((p) => p.id === id));

export class Editor {
  td!: TrackData;
  view = new TrackView();
  active = false;
  sel = PALETTE[0];
  rot = 0;
  level = 0;
  private hover: [number, number] | null = null;
  private preview: THREE.Mesh | null = null;
  private previewKey = '';
  private grid: THREE.GridHelper;
  private cursor: THREE.LineSegments;
  private target = new THREE.Vector3(0, 0, 20);
  private yaw = Math.PI * 0.75;
  private pitch = 0.85;
  private dist = 90;
  private undo: string[] = [];
  private redo: string[] = [];
  private drag: { btn: number; x: number; y: number; moved: boolean } | null = null;
  private painting = false;
  private lastPaint = '';
  private ray = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private canvas: HTMLCanvasElement;
  private previewMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.6, depthWrite: false });

  constructor(private stage: Stage, private audio: Audio, private controls: Controls, private hooks: EditorHooks) {
    this.canvas = stage.renderer.domElement;
    this.grid = new THREE.GridHelper(1000, 100, 0xffffff, 0xffffff);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.18;
    (this.grid.material as THREE.Material).depthWrite = false;
    const cg = new THREE.EdgesGeometry(new THREE.BoxGeometry(T, 0.1, T));
    this.cursor = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    this.canvas.addEventListener('wheel', (e) => { if (!this.active) return; e.preventDefault(); this.dist = THREE.MathUtils.clamp(this.dist * Math.exp(e.deltaY * 0.0012), 18, 420); }, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
  }

  open(td: TrackData, keepCam = false) {
    this.td = td;
    this.active = true;
    this.stage.scene.add(this.view.group, this.grid, this.cursor);
    this.stage.setTheme(td.theme, td.pieces, true);
    this.rebuild();
    if (!keepCam) {
      const st = td.pieces.find((p) => PIECES[p.t].feature === 'start') ?? td.pieces[0];
      this.target.set(st ? st.x * T : 0, 0, st ? st.z * T + 20 : 20);
      this.dist = 90;
    }
    this.undo = [];
    this.redo = [];
    this.setLevel(this.level);
    this.status();
  }

  close() {
    this.active = false;
    this.stage.scene.remove(this.view.group, this.grid, this.cursor);
    if (this.preview) this.stage.scene.remove(this.preview);
    this.view.dispose();
  }

  setTheme(i: number) {
    this.td.theme = i;
    this.stage.setTheme(i, this.td.pieces, true);
    this.rebuild();
    this.hooks.changed(this.td);
  }

  private rebuild() {
    this.view.build(this.td.pieces, this.stage.theme);
    this.previewKey = '';
  }

  private snapshot() {
    this.undo.push(JSON.stringify(this.td.pieces));
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
  }

  private commit() {
    this.rebuild();
    this.hooks.changed(this.td);
    this.status();
  }

  setLevel(l: number) {
    this.level = THREE.MathUtils.clamp(l, 0, 24);
    this.grid.position.set(T / 2, levelY(this.level) + 0.03, T / 2);
    this.previewKey = '';
    this.status();
  }

  select(i: number) {
    this.sel = i;
    this.previewKey = '';
    this.status();
  }

  private status() {
    this.hooks.status({ level: this.level, rot: this.rot, sel: this.sel, count: this.td?.pieces.length ?? 0, hover: this.hover ? `${this.hover[0]}, ${this.hover[1]}` : '' });
  }

  /** pieces sharing a cell and a level band with p */
  private conflicts(p: Placed): number[] {
    const def = PIECES[p.t];
    const top = p.l + Math.max(0, def.exit.dl);
    const cells = new Set(footprint(p).map(([x, z]) => x + ',' + z));
    const out: number[] = [];
    this.td.pieces.forEach((q, i) => {
      const dq = PIECES[q.t];
      const qt = q.l + Math.max(0, dq.exit.dl);
      if (qt < p.l - 0 || q.l > top) return;
      if (footprint(q).some(([x, z]) => cells.has(x + ',' + z))) out.push(i);
    });
    return out;
  }

  private place() {
    if (!this.hover) return;
    const p: Placed = { t: this.sel, x: this.hover[0], z: this.hover[1], l: this.level, r: this.rot };
    const key = JSON.stringify(p);
    if (key === this.lastPaint) return;
    this.lastPaint = key;
    this.snapshot();
    const kill = this.conflicts(p);
    // only one start
    if (PIECES[p.t].feature === 'start') this.td.pieces.forEach((q, i) => { if (PIECES[q.t].feature === 'start' && !kill.includes(i)) kill.push(i); });
    this.td.pieces = this.td.pieces.filter((_, i) => !kill.includes(i));
    this.td.pieces.push(p);
    this.audio.place();
    this.commit();
  }

  private pieceAt(): number {
    if (!this.hover) return -1;
    const [hx, hz] = this.hover;
    let best = -1, bd = Infinity;
    this.td.pieces.forEach((q, i) => {
      if (!footprint(q).some(([x, z]) => x === hx && z === hz)) return;
      const d = Math.abs(q.l - this.level);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  private erase() {
    const i = this.pieceAt();
    if (i < 0) return;
    this.snapshot();
    this.td.pieces.splice(i, 1);
    this.audio.erase();
    this.commit();
  }

  private pick() {
    const i = this.pieceAt();
    if (i < 0) return;
    const q = this.td.pieces[i];
    this.sel = q.t;
    this.rot = q.r;
    this.setLevel(q.l);
  }

  doUndo() {
    const s = this.undo.pop();
    if (!s) return;
    this.redo.push(JSON.stringify(this.td.pieces));
    this.td.pieces = JSON.parse(s);
    this.commit();
  }
  doRedo() {
    const s = this.redo.pop();
    if (!s) return;
    this.undo.push(JSON.stringify(this.td.pieces));
    this.td.pieces = JSON.parse(s);
    this.commit();
  }
  clear() {
    this.snapshot();
    this.td.pieces = [];
    this.commit();
  }

  // ------------------------------------------------------------ pointer

  private down(e: PointerEvent) {
    if (!this.active) return;
    this.drag = { btn: e.button, x: e.clientX, y: e.clientY, moved: false };
    this.updateHover(e);
    if (e.button === 0) {
      if (e.altKey) { this.pick(); return; }
      if (e.shiftKey) { this.erase(); this.painting = true; return; }
      this.lastPaint = '';
      this.place();
      this.painting = true;
    }
  }

  private move(e: PointerEvent) {
    if (!this.active) return;
    if (this.drag && (this.drag.btn === 2 || this.drag.btn === 1)) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      if (this.drag.btn === 2 && !e.shiftKey) {
        this.yaw -= dx * 0.006;
        this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.005, 0.15, 1.5);
      } else {
        const s = this.dist * 0.0016;
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        this.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s);
      }
      return;
    }
    if (e.target !== this.canvas) return;
    this.updateHover(e);
    if (this.painting && this.drag?.btn === 0) {
      if (e.shiftKey) this.erase();
      else if (PIECES[this.sel].cells.length === 1) this.place();
    }
  }

  private up(_e: PointerEvent) {
    this.drag = null;
    this.painting = false;
  }

  private updateHover(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.stage.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -levelY(this.level));
    const hit = new THREE.Vector3();
    if (this.ray.ray.intersectPlane(plane, hit)) {
      const c: [number, number] = [Math.round(hit.x / T), Math.round(hit.z / T)];
      if (!this.hover || c[0] !== this.hover[0] || c[1] !== this.hover[1]) {
        this.hover = c;
        this.previewKey = '';
        this.status();
      }
    } else this.hover = null;
  }

  // ------------------------------------------------------------ per frame

  update(dt: number) {
    if (!this.active) return;
    const c = this.controls;
    const k = c.keys;
    const ctrl = k.has('ControlLeft') || k.has('ControlRight') || k.has('MetaLeft') || k.has('MetaRight');
    // pan with WASD / arrows
    const sp = this.dist * 0.9 * dt;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (!ctrl) {
      if (k.has('KeyW') || k.has('ArrowUp')) this.target.addScaledVector(fwd, sp);
      if (k.has('KeyS') || k.has('ArrowDown')) this.target.addScaledVector(fwd, -sp);
      if (k.has('KeyA') || k.has('ArrowLeft')) this.target.addScaledVector(right, -sp);
      if (k.has('KeyD') || k.has('ArrowRight')) this.target.addScaledVector(right, sp);
    }
    if (c.hit('KeyR') && !c.hit('Mod+KeyR')) { this.rot = (this.rot + (c.hit('Shift+KeyR') ? 3 : 1)) % 4; this.previewKey = ''; this.status(); this.audio.click(); }
    if (c.hit('KeyE', 'PageUp')) this.setLevel(this.level + 1);
    if (c.hit('KeyQ', 'PageDown')) this.setLevel(this.level - 1);
    if (c.hit('Delete', 'Backspace', 'KeyX')) this.erase();
    if (c.hit('KeyF')) this.pick();
    if (c.hit('Mod+KeyZ')) { if (c.hit('Shift+KeyZ')) this.doRedo(); else this.doUndo(); }
    if (c.hit('Mod+KeyY')) this.doRedo();
    for (let n = 0; n < 10; n++) if (c.hit('Digit' + ((n + 1) % 10))) this.select(PALETTE[n]);
    if (c.hit('KeyT')) this.hooks.test();
    if (c.hit('Escape')) this.hooks.exit();

    // camera
    this.target.y = levelY(this.level);
    const cam = this.stage.camera;
    const off = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)).multiplyScalar(this.dist);
    cam.position.copy(this.target).add(off);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); }
    this.stage.followShadow(this.target.x, this.target.y, this.target.z);
    const sc = this.stage.sun.shadow.camera;
    const want = Math.max(70, this.dist * 1.2);
    if (sc.right !== want) { sc.left = -want; sc.right = want; sc.top = want; sc.bottom = -want; sc.updateProjectionMatrix(); }

    // preview of the selected piece under the cursor
    if (this.hover) {
      const p: Placed = { t: this.sel, x: this.hover[0], z: this.hover[1], l: this.level, r: this.rot };
      const key = JSON.stringify(p);
      if (key !== this.previewKey) {
        this.previewKey = key;
        if (this.preview) { this.stage.scene.remove(this.preview); this.preview.geometry.dispose(); }
        const m: MeshOut = { pos: [], slot: [], idx: [] };
        pieceMesh(p, m);
        const g = meshGeometry(m, this.stage.theme);
        this.preview = new THREE.Mesh(g, this.previewMat);
        this.preview.position.y = 0.04;
        this.preview.renderOrder = 2;
        this.stage.scene.add(this.preview);
        const bad = this.conflicts(p).length > 0;
        this.previewMat.emissive.setHex(bad ? 0x992222 : 0x226633);
        // cursor box over the footprint
        const fp = footprint(p);
        const xs = fp.map((f) => f[0]), zs = fp.map((f) => f[1]);
        const minx = Math.min(...xs), maxx = Math.max(...xs), minz = Math.min(...zs), maxz = Math.max(...zs);
        this.cursor.scale.set(maxx - minx + 1, 1, maxz - minz + 1);
        this.cursor.position.set(((minx + maxx) / 2) * T, levelY(this.level) + 0.05, ((minz + maxz) / 2) * T);
      }
      this.preview!.visible = true;
      this.cursor.visible = true;
    } else {
      if (this.preview) this.preview.visible = false;
      this.cursor.visible = false;
    }
    this.view.update(performance.now() / 1000);
  }
}

/** palette thumbnails: each piece rendered alone into a small image */
export function pieceThumbs(stage: Stage, size = 112): string[] {
  const r = stage.renderer;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-3, 6, 2);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
  const rt = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const buf = new Uint8Array(size * size * 4);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g2 = canvas.getContext('2d')!;
  const out: string[] = [];
  const th = THEMES[0];
  const prevTone = r.toneMapping;
  for (let i = 0; i < PIECES.length; i++) {
    const m: MeshOut = { pos: [], slot: [], idx: [] };
    pieceMesh({ t: i, x: 0, z: 0, l: 0, r: 0 }, m);
    const mesh = new THREE.Mesh(meshGeometry(m, th), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 }));
    scene.add(mesh);
    const box = new THREE.Box3().setFromObject(mesh);
    const c = box.getCenter(new THREE.Vector3());
    const rad = box.getSize(new THREE.Vector3()).length() / 2;
    const d = rad / Math.sin((cam.fov * Math.PI) / 360) * 0.92;
    cam.position.copy(c).add(new THREE.Vector3(-0.62, 0.72, -0.55).normalize().multiplyScalar(d));
    cam.lookAt(c);
    r.setRenderTarget(rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    r.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    const img = g2.createImageData(size, size);
    for (let y = 0; y < size; y++) img.data.set(buf.subarray((size - 1 - y) * size * 4, (size - y) * size * 4), y * size * 4);
    g2.putImageData(img, 0, 0);
    out.push(canvas.toDataURL());
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  r.setRenderTarget(null);
  r.setClearColor(0x000000, 1);
  r.toneMapping = prevTone;
  rt.dispose();
  void H;
  return out;
}
