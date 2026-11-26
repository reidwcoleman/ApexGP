// Parachute: any long fall (bailing out of the helicopter, walking off a helipad roof, the bridge)
// starts a freefall you can steer; Space opens a striped parafoil. Under the canopy A/D turn, W dives
// (faster, steeper), S flares (slower, flatter), and you touch down softly. Without one, the ground
// still wins. Also makes the helipad roofs walkable so you can jump off them.
import * as THREE from 'three';
import { clamp, damp, wrapAngle } from '../core/math';
import { WATER_Y, groundAt, isWater, platforms } from '../world/map';
import type { Game } from './game';
import { TUNING } from './player';

export class Parachute {
  state: 'none' | 'fall' | 'open' = 'none';
  private yaw = 0;
  private bank = 0;
  private openT = 0;
  private readonly canopy: THREE.Group;

  constructor(private game: Game) {
    for (const [b] of game.city.padAt) platforms.push({ x0: b.x - b.w / 2, z0: b.z - b.d / 2, x1: b.x + b.w / 2, z1: b.z + b.d / 2, y: b.y0 + b.h });
    this.canopy = this.build();
    this.canopy.visible = false;
    game.scene.add(this.canopy);
  }

  private build(): THREE.Group {
    const W = 7.4, C = 2.7, R = 5.4, H = 5.0;
    const geo = new THREE.PlaneGeometry(W, C, 24, 2);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const edge: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      const a = pos.getX(i) / R;
      // arched across the span, the leading edge a touch lower than the trailing one
      pos.setXYZ(i, R * Math.sin(a), R * Math.cos(a) - R + H - pos.getZ(i) * 0.08, pos.getZ(i));
    }
    geo.computeVertexNormals();
    for (let k = 0; k <= 6; k++) {
      const a = ((k / 6 - 0.5) * W) / R;
      for (const z of [-C / 2, C / 2]) edge.push(new THREE.Vector3(R * Math.sin(a), R * Math.cos(a) - R + H - z * 0.08, z));
    }
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 8;
    const x = cv.getContext('2d')!;
    const cols = ['#ff4d4d', '#ffffff', '#ffb000', '#ffffff', '#1fa3ff', '#ffffff', '#ff4d4d', '#ffffff'];
    cols.forEach((c, i) => {
      x.fillStyle = c;
      x.fillRect((i * 256) / cols.length, 0, 256 / cols.length + 1, 8);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sail = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.75 }));
    sail.castShadow = true;
    // suspension lines down to the harness at the shoulders
    const lp: number[] = [];
    for (const e of edge) lp.push(e.x, e.y, e.z, Math.sign(e.x) * 0.22, 1.45, 0);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.7 }));
    const grp = new THREE.Group();
    grp.add(sail, lines);
    return grp;
  }

  private close() {
    if (this.state === 'none') return;
    this.state = 'none';
    this.canopy.visible = false;
    this.game.player.sky = 0;
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    const inp = g.input;
    if (p.vehicle || p.dead || p.swimming || p.hidden || p.onGround) {
      if (this.state === 'open' && p.onGround && !p.dead) g.audio.punch();
      this.close();
      return;
    }
    const gy = groundAt(p.pos.x, p.pos.z, p.pos.y);
    const below = isWater(p.pos.x, p.pos.z) ? Math.max(gy, WATER_Y) : gy;
    const h = p.pos.y - below;
    if (this.state === 'none') {
      // a real fall: already dropping, and a long way up
      if (p.vy > -4 || h < 14) return;
      this.state = 'fall';
      this.yaw = p.yaw;
    }
    // input relative to the camera
    const cy = g.playerCtl.camYaw;
    const f = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0);
    const s = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    if (this.state === 'fall') {
      p.sky = 1;
      // tracking: lean the way you want to go
      const mx = Math.sin(cy) * f - Math.cos(cy) * s, mz = Math.cos(cy) * f + Math.sin(cy) * s;
      p.vx = damp(p.vx, mx * 11, 0.8, dt);
      p.vz = damp(p.vz, mz * 11, 0.8, dt);
      p.dvx = p.vx;
      p.dvz = p.vz;
      p.vy = Math.max(p.vy, -46);
      if (Math.hypot(mx, mz) > 0.1) p.yaw = Math.atan2(mx, mz);
      g.hud.prompt(`<kbd>Space</kbd> Open parachute · ${Math.round(h)} m`);
      if (inp.hit('Space') && h > 3) {
        this.state = 'open';
        this.openT = 0;
        this.yaw = p.yaw;
        this.bank = 0;
        this.canopy.visible = true;
        g.audio.whoosh();
      }
      return;
    }
    // ---- under the canopy
    this.openT += dt;
    p.sky = 2;
    const turn = -s;
    this.yaw += turn * 1.15 * dt;
    this.bank = damp(this.bank, -turn * 0.32, 3, dt);
    const sp = 9 + Math.max(0, f) * 5 - Math.max(0, -f) * 4;
    const sink = 4.3 + Math.max(0, f) * 3.2 - Math.max(0, -f) * 1.8;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    p.vx = damp(p.vx, fx * sp, 2, dt);
    p.vz = damp(p.vz, fz * sp, 2, dt);
    // the physics step adds gravity after this, so cancel it here: the canopy holds the sink rate
    p.vy = damp(p.vy, -sink, 2.6, dt) + TUNING.gravity * dt;
    p.dvx = p.vx;
    p.dvz = p.vz;
    p.yaw = this.yaw;
    // the camera swings round behind you unless you're looking about
    if (g.playerCtl.mouseIdle > 1) g.playerCtl.camYaw += wrapAngle(this.yaw - cy) * clamp(dt * 1.5, 0, 1);
    const k = Math.min(1, 0.12 + this.openT * 1.8);
    this.canopy.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.canopy.rotation.set(0, this.yaw, this.bank, 'YXZ');
    this.canopy.scale.set(k, 0.4 + k * 0.6, k);
    g.hud.prompt(`<kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>W</kbd> dive · <kbd>S</kbd> flare · ${Math.round(h)} m`);
  }
}
