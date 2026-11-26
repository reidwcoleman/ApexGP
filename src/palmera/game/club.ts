// The Velvet Tide: a downtown nightclub, open 9 pm to 5 am. Outside, a pink-and-cyan neon sign, a
// rope line with a bouncer and a short queue. Walk in (the room is built 60 m under the street, like
// the stores) to a dark room with a dance floor whose tiles pulse on the beat, beams sweeping from
// the ceiling, a DJ, a lit bar and a crowd dancing; the radio plays the dance station while you're in.
import * as THREE from 'three';
import { Human } from '../entities/humans';
import { platforms } from '../world/map';
import { front } from './robbery';
import type { Blip } from './missions';
import type { Game } from './game';

const IY = -60;
const W = 16, D = 14, H = 5;
const BPM = 96;

export class Club {
  door = new THREE.Vector3();
  out = new THREE.Vector3();
  inside = false;
  private group = new THREE.Group();
  private tiles: THREE.InstancedMesh;
  private beams: THREE.Mesh[] = [];
  private lights: THREE.PointLight[] = [];
  private center = new THREE.Vector3();
  private crowd: Human[] = [];
  private street: Human[] = [];
  private fade: HTMLDivElement;
  private busy = false;
  private cool = 0;
  private prevStation = 0;
  private readonly col = new THREE.Color();
  private readonly m4 = new THREE.Matrix4();

  constructor(private game: Game) {
    const map = game.map;
    // a downtown building well away from the corner stores
    const stores = game.robbery.stores.map((s) => s.pos);
    const cands = map.buildings.filter((b) => b.style === 3 && b.y0 === 0 && b.collide && map.blocks.some((k) => k.region === 'downtown' && b.x > k.x0 && b.x < k.x1 && b.z > k.z0 && b.z < k.z1));
    let f: { p: THREE.Vector3; yaw: number } | null = null;
    for (const b of cands) {
      const t = front(map, b);
      if (t && stores.every((s) => s.distanceTo(t.p) > 90)) {
        f = t;
        break;
      }
    }
    if (!f) f = { p: new THREE.Vector3(200, 0, -250), yaw: 0 };
    this.out.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    // find the wall people actually see: a ray in from the street; the door is just in front of it
    const sx = f.p.x + this.out.x * 8, sz = f.p.z + this.out.z * 8;
    const hit = map.colliders.raycast(sx, 1, sz, -this.out.x, 0, -this.out.z, 16, true);
    const t = hit ? hit.t : 8 - 0.2;
    this.door.set(sx - this.out.x * (t - 0.6), 0, sz - this.out.z * (t - 0.6));
    this.buildFront(f.yaw);
    this.tiles = this.buildRoom();
    this.fade = document.createElement('div');
    this.fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .22s;z-index:40';
    document.body.appendChild(this.fade);
  }

  get open() {
    const t = this.game.sky.time;
    return t >= 21 || t < 5;
  }

  get blips(): Blip[] {
    return this.open ? [{ x: this.door.x, z: this.door.z, color: '#ff4fd8', label: 'V', kind: 'mission' }] : [];
  }

  /** the sign, the rope line */
  private buildFront(yaw: number) {
    const g = new THREE.Group();
    // on the wall face (the door point is 0.6 m out from it)
    g.position.copy(this.door).addScaledVector(this.out, -0.55);
    g.rotation.y = yaw;
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const x = c.getContext('2d')!;
    x.fillStyle = '#0b0710';
    x.fillRect(0, 0, 1024, 256);
    x.textAlign = 'center';
    x.font = 'italic 900 150px system-ui, sans-serif';
    x.shadowColor = '#ff3fd2';
    x.shadowBlur = 30;
    x.fillStyle = '#ff7ae6';
    x.fillText('VELVET', 340, 180);
    x.shadowColor = '#2ef2ff';
    x.fillStyle = '#9cf8ff';
    x.fillText('TIDE', 760, 180);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshStandardMaterial({ map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.6, roughness: 0.5 }));
    sign.position.set(0, 4.9, 0.6);
    g.add(sign);
    // a dark doorway with a magenta glow
    const doorway = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.035, 0.01, 0.04) }));
    doorway.position.set(0, 1.25, 0.04);
    g.add(doorway);
    // a thin magenta neon frame round it
    const frame = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.3, 2.0) });
    for (const [w, h, x, y] of [[1.9, 0.05, 0, 2.52], [0.05, 2.5, -0.93, 1.25], [0.05, 2.5, 0.93, 1.25]] as [number, number, number, number][]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.04), frame);
      m.position.set(x, y, 0.06);
      g.add(m);
    }
    // brass posts and a red rope
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.9, roughness: 0.3 });
    const rope = new THREE.MeshStandardMaterial({ color: 0x8a0f2a, roughness: 0.6 });
    for (const px of [1.4, 3.0, 4.6]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.95, 8), brass);
      p.position.set(px, 0.48, 0.9);
      g.add(p);
    }
    for (const px of [2.2, 3.8]) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.025, 6, 16, Math.PI), rope);
      r.position.set(px, 0.92, 0.9);
      r.rotation.z = Math.PI;
      g.add(r);
    }
    this.game.scene.add(g);
  }

  private buildRoom(): THREE.InstancedMesh {
    const g = this.game;
    this.center.set(this.door.x, IY, this.door.z);
    const G = this.group;
    G.position.copy(this.center);
    G.visible = false;
    g.scene.add(G);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, solid = false) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      G.add(mesh);
      if (solid) {
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        g.map.colliders.add(this.center.x + x + bb.min.x, this.center.z + z + bb.min.z, this.center.x + x + bb.max.x, this.center.z + z + bb.max.z, IY + y + bb.min.y, IY + y + bb.max.y);
      }
      return mesh;
    };
    const dark = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
    add(new THREE.BoxGeometry(W, 0.2, D), dark(0x14101a, { roughness: 0.3, metalness: 0.3 }), 0, -0.1, 0);
    add(new THREE.BoxGeometry(W, 0.2, D), dark(0x07060a), 0, H + 0.1, 0);
    const wall = dark(0x2a1030);
    add(new THREE.BoxGeometry(W, H, 0.2), wall, 0, H / 2, -D / 2 - 0.1, true);
    add(new THREE.BoxGeometry(0.2, H, D), wall, -W / 2 - 0.1, H / 2, 0, true);
    add(new THREE.BoxGeometry(0.2, H, D), wall, W / 2 + 0.1, H / 2, 0, true);
    add(new THREE.BoxGeometry(W / 2 - 1, H, 0.2), wall, -(W / 4 + 0.5), H / 2, D / 2 + 0.1, true);
    add(new THREE.BoxGeometry(W / 2 - 1, H, 0.2), wall, W / 4 + 0.5, H / 2, D / 2 + 0.1, true);
    add(new THREE.PlaneGeometry(2, 2.6), new THREE.MeshBasicMaterial({ color: 0x050307 }), 0, 1.3, D / 2 + 0.05).rotation.y = Math.PI;
    // neon strips along the walls
    const neonA = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.4, 2.4) });
    const neonB = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.6, 3) });
    add(new THREE.BoxGeometry(W - 0.4, 0.06, 0.06), neonA, 0, H - 0.4, -D / 2 + 0.05);
    add(new THREE.BoxGeometry(0.06, 0.06, D - 0.4), neonB, -W / 2 + 0.05, H - 0.4, 0);
    add(new THREE.BoxGeometry(0.06, 0.06, D - 0.4), neonA, W / 2 - 0.05, H - 0.4, 0);
    // the DJ booth at the back
    add(new THREE.BoxGeometry(3.4, 1.15, 1.0), dark(0x111111, { metalness: 0.6, roughness: 0.3 }), 0, 0.58, -D / 2 + 1.3, true);
    add(new THREE.BoxGeometry(3.4, 0.08, 0.04), neonB, 0, 0.9, -D / 2 + 1.82);
    // the bar along the left wall, a lit shelf of bottles behind it
    add(new THREE.BoxGeometry(1.0, 1.1, 6), dark(0x3a1d14, { roughness: 0.4 }), -W / 2 + 1.6, 0.55, 1, true);
    add(new THREE.BoxGeometry(0.4, 1.2, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.9, 0.4) }), -W / 2 + 0.3, 1.9, 1);
    const bottle = new THREE.CylinderGeometry(0.05, 0.06, 0.32, 6);
    const bcols = [0x2f8f4a, 0x8a5a1a, 0xd8e8ff, 0x7a1830, 0x3a4fa8];
    for (let i = 0; i < 24; i++) add(bottle, new THREE.MeshStandardMaterial({ color: bcols[i % bcols.length], roughness: 0.15, transparent: true, opacity: 0.85 }), -W / 2 + 0.55, 2.62 + (i % 2) * 0.01, -1.8 + i * 0.24);
    // the dance floor: 6 x 6 tiles that pulse with the beat
    const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.96, 0.05, 0.96), new THREE.MeshBasicMaterial({ color: 0xffffff }), 36);
    for (let i = 0; i < 36; i++) {
      this.m4.makeTranslation(-2.5 + (i % 6), 0.03, -2 + Math.floor(i / 6));
      tiles.setMatrixAt(i, this.m4);
      tiles.setColorAt(i, this.col.setRGB(0.2, 0.05, 0.3));
    }
    G.add(tiles);
    // beams sweeping from the ceiling
    const beamGeo = new THREE.ConeGeometry(0.9, 5, 16, 1, true);
    beamGeo.translate(0, -2.5, 0);
    const beamCols = [new THREE.Color(1.2, 0.2, 1.0), new THREE.Color(0.2, 1.0, 1.2), new THREE.Color(1.2, 0.9, 0.2), new THREE.Color(0.4, 0.3, 1.3)];
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: beamCols[i], transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      b.position.set(-4.5 + i * 3, H - 0.1, -1.5);
      G.add(b);
      this.beams.push(b);
    }
    for (const [x, c] of [[-3, 0xff3fd2], [3, 0x2ef2ff]] as [number, number][]) {
      const l = new THREE.PointLight(c, 0, 16, 1.4);
      l.position.set(x, H - 0.8, 0);
      G.add(l);
      this.lights.push(l);
    }
    platforms.push({ x0: this.center.x - W / 2 - 1, z0: this.center.z - D / 2 - 1, x1: this.center.x + W / 2 + 1, z1: this.center.z + D / 2 + 1, y: IY });
    return tiles;
  }

  private person(x: number, y: number, z: number, yaw: number, clip: string) {
    const h = new Human('ped');
    h.pos.set(x, y, z);
    h.yaw = yaw;
    h.state = 'event';
    h.clip = clip;
    h.health = h.maxHealth = 60;
    this.game.addNpc(h);
    return h;
  }

  private go(enter: boolean) {
    const g = this.game;
    this.busy = true;
    this.fade.style.opacity = '1';
    setTimeout(() => {
      const p = g.player;
      this.group.visible = enter;
      for (const l of this.lights) l.intensity = enter ? 14 : 0;
      const r = g.audio.radio;
      if (enter) {
        p.pos.set(this.center.x, IY, this.center.z + D / 2 - 1.2);
        g.playerCtl.camYaw = Math.PI;
        // the crowd, the DJ
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2, rr = 0.6 + Math.random() * 2.6;
          this.crowd.push(this.person(this.center.x + Math.cos(a) * rr * 1.1, IY, this.center.z + 0.5 + Math.sin(a) * rr * 0.9 - 1, Math.random() * 6.28, Math.random() < 0.75 ? 'dance' : 'cheer3'));
        }
        this.crowd.push(this.person(this.center.x, IY, this.center.z - D / 2 + 0.6, 0, 'dance'));
        this.prevStation = r.station;
        let guard = 0;
        while (r.station !== 3 && guard++ < 8) r.tune(1);
        this.inside = true;
      } else {
        p.pos.set(this.door.x + this.out.x * 1.4, 0, this.door.z + this.out.z * 1.4);
        g.playerCtl.camYaw = Math.atan2(this.out.x, this.out.z);
        for (const h of this.crowd) g.removeNpc(h);
        this.crowd = [];
        let guard = 0;
        while (r.station !== this.prevStation && guard++ < 8) r.tune(1);
        this.inside = false;
      }
      p.vx = p.vz = 0;
      g.post.reset();
      this.fade.style.opacity = '0';
      this.cool = 1.2;
      setTimeout(() => (this.busy = false), 250);
    }, 230);
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    this.cool -= dt;
    const t = g.elapsed;
    // the street side: a bouncer and a short queue while it's open and you're around
    const near = Math.hypot(p.pos.x - this.door.x, p.pos.z - this.door.z) < 140 || this.inside;
    if (this.open && near && !this.street.length) {
      const rx = Math.cos(Math.atan2(this.out.x, this.out.z)), rz = -Math.sin(Math.atan2(this.out.x, this.out.z));
      const yawOut = Math.atan2(this.out.x, this.out.z);
      this.street.push(this.person(this.door.x - rx * 1.4, 0, this.door.z - rz * 1.4, yawOut, 'idle'));
      for (let i = 0; i < 3; i++) this.street.push(this.person(this.door.x + rx * (2.2 + i * 0.9) + this.out.x * 1.6, 0, this.door.z + rz * (2.2 + i * 0.9) + this.out.z * 1.6, yawOut + Math.PI / 2 + Math.PI, i === 1 ? 'talk' : 'idle'));
    } else if ((!this.open || !near) && this.street.length && !this.inside) {
      for (const h of this.street) g.removeNpc(h);
      this.street = [];
    }
    if (this.inside) {
      // tiles on the beat, beams sweeping, lights breathing
      const beat = (t * BPM) / 60;
      const pulse = Math.pow(1 - (beat % 1), 3);
      for (let i = 0; i < 36; i++) {
        const cx = i % 6, cz = Math.floor(i / 6);
        const h = (Math.floor(beat / 2) * 0.13 + (cx + cz) * 0.06) % 1;
        const lit = ((cx + cz + Math.floor(beat)) % 3 === 0 ? 1 : 0.25) * (0.5 + pulse);
        this.tiles.setColorAt(i, this.col.setHSL(h, 1, 0.5).multiplyScalar(lit * 1.6));
      }
      this.tiles.instanceColor!.needsUpdate = true;
      this.beams.forEach((b, i) => b.rotation.set(Math.sin(t * 0.7 + i * 1.7) * 0.6, 0, Math.cos(t * 0.9 + i * 2.3) * 0.6));
      this.lights[0].intensity = 8 + pulse * 10;
      this.lights[1].intensity = 8 + (1 - pulse) * 8;
    }
    if (this.busy || p.vehicle || p.dead) return;
    const moving = Math.hypot(p.vx, p.vz);
    if (!this.inside) {
      const d = Math.hypot(p.pos.x - this.door.x, p.pos.z - this.door.z);
      if (d > 3) return;
      if (!this.open) {
        g.hud.prompt('The Velvet Tide · opens at 9 pm');
        return;
      }
      if (g.wanted.level > 0) {
        g.hud.prompt('The Velvet Tide · <b>the bouncer won’t let you in with heat on you</b>');
        return;
      }
      g.hud.prompt('Walk in: The Velvet Tide');
      const inward = -(p.vx * this.out.x + p.vz * this.out.z);
      if (d < 1.5 && inward > 0.8 && moving > 0.8 && this.cool <= 0) this.go(true);
    } else {
      const ex = this.center.x, ez = this.center.z + D / 2 - 0.5;
      const d = Math.hypot(p.pos.x - ex, p.pos.z - ez);
      if (d < 1.2 && p.vz > 0.8 && this.cool <= 0) this.go(false);
    }
  }
}
