// Photo mode: O freezes the moment and hands you a free camera. Fly it with WASD (Space up, Shift
// down, hold Ctrl to creep), look with the mouse or the arrow keys, Q/E or the wheel to zoom, 1-6
// for a filter, Enter saves a PNG (filter included). O or Esc puts you back where you were.
import * as THREE from 'three';
import { groundAt } from '../world/map';
import type { Game } from './game';

const FILTERS: { name: string; css: string }[] = [
  { name: 'Natural', css: 'none' },
  { name: 'Golden', css: 'sepia(0.28) saturate(1.25) brightness(1.04) contrast(1.05)' },
  { name: 'Vivid', css: 'saturate(1.6) contrast(1.12)' },
  { name: 'Noir', css: 'grayscale(1) contrast(1.35) brightness(0.95)' },
  { name: 'Faded', css: 'saturate(0.7) contrast(0.85) brightness(1.08) sepia(0.12)' },
  { name: 'Neon', css: 'saturate(1.45) hue-rotate(-18deg) contrast(1.15)' },
];

const CSS = `
body.photo > *:not(canvas):not(#photoui){visibility:hidden !important}
#photoui{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);padding:10px 16px;border-radius:16px;background:rgba(14,14,18,.72);color:#fff;font:600 12px/1.5 system-ui,sans-serif;display:none;z-index:60;text-align:center;letter-spacing:.02em}
body.photo #photoui{display:block}
#photoui b{font-weight:800;color:#ffd23f}
`;

export class PhotoMode {
  active = false;
  private yaw = 0;
  private pitch = 0;
  private fov = 55;
  private filter = 0;
  private readonly pos = new THREE.Vector3();
  private readonly saved = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 55 };
  private ui: HTMLDivElement;
  private canvas: HTMLCanvasElement;

  constructor(private game: Game) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.ui = document.createElement('div');
    this.ui.id = 'photoui';
    document.body.appendChild(this.ui);
    this.canvas = game.renderer.domElement;
  }

  toggle() {
    const g = this.game;
    const cam = g.camera;
    this.active = !this.active;
    document.body.classList.toggle('photo', this.active);
    if (this.active) {
      this.saved.pos.copy(cam.position);
      this.saved.quat.copy(cam.quaternion);
      this.saved.fov = cam.fov;
      this.pos.copy(cam.position);
      const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
      this.yaw = e.y;
      this.pitch = e.x;
      this.fov = cam.fov;
      g.audio.cue('click');
    } else {
      cam.position.copy(this.saved.pos);
      cam.quaternion.copy(this.saved.quat);
      cam.fov = this.saved.fov;
      cam.updateProjectionMatrix();
      this.canvas.style.filter = '';
    }
    this.render();
  }

  private render() {
    const f = FILTERS[this.filter];
    this.canvas.style.filter = this.active && f.css !== 'none' ? f.css : '';
    this.ui.innerHTML = `PHOTO MODE · <b>${f.name}</b> · ${Math.round(this.fov)}°<br>WASD fly · Space/Shift up/down · mouse or arrows look · Q/E zoom · 1-6 filter · Enter save · O exit`;
  }

  update(dt: number) {
    const g = this.game;
    const inp = g.input;
    const cam = g.camera;
    if (inp.hit('KeyO') || inp.hit('Escape')) return this.toggle();
    // look
    const sens = 0.0022 * (this.fov / 55);
    this.yaw -= inp.mouseDX * sens;
    this.pitch -= inp.mouseDY * sens;
    const turn = 1.4 * dt * (this.fov / 55);
    if (inp.down('ArrowLeft')) this.yaw += turn;
    if (inp.down('ArrowRight')) this.yaw -= turn;
    if (inp.down('ArrowUp')) this.pitch += turn;
    if (inp.down('ArrowDown')) this.pitch -= turn;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
    // zoom
    const z = (inp.down('KeyQ') ? 1 : 0) - (inp.down('KeyE') ? 1 : 0) + inp.wheel * 4;
    if (z) {
      this.fov = Math.max(12, Math.min(90, this.fov + z * 30 * dt * (inp.wheel ? 4 : 1)));
      this.render();
    }
    // fly
    const speed = (inp.down('ControlLeft') ? 2 : 9) * dt;
    const fw = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
    const st = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    const up = (inp.down('Space') ? 1 : 0) - (inp.down('ShiftLeft') ? 1 : 0);
    const cy = Math.cos(this.pitch);
    const fx = -Math.sin(this.yaw) * cy, fz = -Math.cos(this.yaw) * cy, fy = Math.sin(this.pitch);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.pos.x += (fx * fw + rx * st) * speed;
    this.pos.z += (fz * fw + rz * st) * speed;
    this.pos.y += (fy * fw + up) * speed;
    // stay within 60 m of where you were, and above the ground
    const o = this.saved.pos;
    const dx = this.pos.x - o.x, dy = this.pos.y - o.y, dz = this.pos.z - o.z, dl = Math.hypot(dx, dy, dz);
    if (dl > 60) this.pos.set(o.x + (dx / dl) * 60, o.y + (dy / dl) * 60, o.z + (dz / dl) * 60);
    this.pos.y = Math.max(this.pos.y, groundAt(this.pos.x, this.pos.z) + 0.3);
    for (let k = 1; k <= 6; k++)
      if (inp.hit('Digit' + k)) {
        this.filter = k - 1;
        this.render();
      }
    cam.position.copy(this.pos);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
    if (inp.hit('Enter')) this.save();
  }

  /** a PNG of the next frame with the filter baked in */
  private save() {
    const g = this.game;
    g.renderOnce();
    const src = this.canvas;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const x = c.getContext('2d')!;
    const f = FILTERS[this.filter].css;
    if (f !== 'none') x.filter = f;
    x.drawImage(src, 0, 0);
    const a = document.createElement('a');
    a.download = `palmera-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    a.href = c.toDataURL('image/png');
    a.click();
    this.lastSave = { w: c.width, h: c.height, filter: FILTERS[this.filter].name };
    g.audio.cue('cash');
  }

  lastSave: { w: number; h: number; filter: string } | null = null;
}
