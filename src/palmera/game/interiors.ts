// Walk-in stores. Each corner store has a room you can walk into: tiled floor, strip lights, two aisles
// of stocked shelves, drinks fridges glowing along the back, a counter with the till and the clerk
// behind it. The room is built 40 m below its shop (out of sight under the street) and you step
// through the door with a quick fade, the way most open-world games do it.
import * as THREE from 'three';
import { platforms } from '../world/map';
import type { Game } from './game';

const IY = -40; // floor height of the rooms
const W = 10, D = 8.5, H = 3.4;

interface Room {
  store: number;
  center: THREE.Vector3; // floor centre
  out: THREE.Vector3; // unit vector out of the door
  group: THREE.Group;
  lights: THREE.PointLight[];
  door: THREE.Vector3; // inside, just in front of the door
  counter: THREE.Vector3; // where the clerk stands
  outside: THREE.Vector3;
}

function tileTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      x.fillStyle = (i + j) % 2 ? '#d9d4c7' : '#bfb8a8';
      x.fillRect(i * 32, j * 32, 32, 32);
    }
  x.strokeStyle = 'rgba(80,70,60,0.35)';
  for (let i = 0; i <= 4; i++) {
    x.beginPath();
    x.moveTo(i * 32, 0);
    x.lineTo(i * 32, 128);
    x.moveTo(0, i * 32);
    x.lineTo(128, i * 32);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Interiors {
  rooms: Room[] = [];
  inside: Room | null = null;
  private fade: HTMLDivElement;
  private busy = 0;
  private cool = 0;

  constructor(private game: Game) {
    this.fade = document.createElement('div');
    this.fade.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;transition:opacity .22s;z-index:40';
    document.body.appendChild(this.fade);
    const tiles = tileTexture();
    game.robbery.stores.forEach((s, i) => this.rooms.push(this.build(i, s.pos, s.face, tiles)));
  }

  private build(store: number, door: THREE.Vector3, face: number, tiles: THREE.Texture): Room {
    const g = this.game;
    const out = new THREE.Vector3(Math.sin(face), 0, Math.cos(face));
    const center = door.clone().addScaledVector(out, -(D / 2 + 1.6));
    center.y = IY;
    const group = new THREE.Group();
    group.position.copy(center);
    group.rotation.y = face;
    // local frame: +z is out through the door
    const mat = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, solid = false) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (solid) {
        geo.computeBoundingBox();
        const bb = geo.boundingBox!;
        const corners = [new THREE.Vector3(bb.min.x + x, 0, bb.min.z + z), new THREE.Vector3(bb.max.x + x, 0, bb.max.z + z)].map((v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), face).add(center));
        g.map.colliders.add(Math.min(corners[0].x, corners[1].x), Math.min(corners[0].z, corners[1].z), Math.max(corners[0].x, corners[1].x), Math.max(corners[0].z, corners[1].z), IY + bb.min.y + y, IY + bb.max.y + y);
      }
      return mesh;
    };
    tiles.repeat.set(W / 2, D / 2);
    add(new THREE.BoxGeometry(W, 0.2, D), mat(0xffffff, { map: tiles, roughness: 0.35 }), 0, -0.1, 0);
    add(new THREE.BoxGeometry(W, 0.2, D), mat(0xe8e6e0), 0, H + 0.1, 0, true);
    const wall = mat(0xe9e1cf);
    add(new THREE.BoxGeometry(W, H, 0.2), wall, 0, H / 2, -D / 2 - 0.1, true);
    add(new THREE.BoxGeometry(0.2, H, D), wall, -W / 2 - 0.1, H / 2, 0, true);
    add(new THREE.BoxGeometry(0.2, H, D), wall, W / 2 + 0.1, H / 2, 0, true);
    // front wall with a glass door and shop window full of daylight
    add(new THREE.BoxGeometry(W / 2 - 0.8, H, 0.2), wall, -(W / 4 + 0.4), H / 2, D / 2 + 0.1, true);
    add(new THREE.BoxGeometry(W / 2 - 0.8, H, 0.2), wall, W / 4 + 0.4, H / 2, D / 2 + 0.1, true);
    add(new THREE.BoxGeometry(1.6, H - 2.4, 0.2), wall, 0, 2.4 + (H - 2.4) / 2, D / 2 + 0.1, true);
    const daylight = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 1.75), toneMapped: true });
    add(new THREE.PlaneGeometry(1.5, 2.35), daylight, 0, 1.2, D / 2 + 0.21).rotation.y = Math.PI;
    add(new THREE.BoxGeometry(1.6, 2.4, 0.06), mat(0x9fb4bd, { transparent: true, opacity: 0.25, roughness: 0.05 }), 0, 1.2, D / 2 + 0.02);
    add(new THREE.BoxGeometry(1.6, 2.4, 0.06), mat(0x222222), 0, 1.2, D / 2 + 0.24, true).visible = false;
    for (const s of [-1, 1]) add(new THREE.PlaneGeometry(2.6, 1.4), daylight, s * 3.2, 1.6, D / 2 - 0.0).rotation.y = Math.PI;
    // strip lights
    const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.0) });
    for (const x of [-2.5, 0, 2.5]) add(new THREE.BoxGeometry(0.25, 0.05, D - 2), lightMat, x, H - 0.03, 0).castShadow = false;
    // fridges along the back
    const fridgeGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.4, 1.6) });
    for (let k = 0; k < 4; k++) {
      const x = -3.6 + k * 2.4;
      add(new THREE.BoxGeometry(2.2, 2.3, 0.8), mat(0x2b2f33, { metalness: 0.4 }), x, 1.15, -D / 2 + 0.4, true);
      add(new THREE.PlaneGeometry(2.0, 1.9), fridgeGlow, x, 1.2, -D / 2 + 0.81);
      for (let r = 0; r < 4; r++) for (let b = 0; b < 8; b++) add(new THREE.BoxGeometry(0.16, 0.3, 0.05), mat([0xd62828, 0x1f6fd1, 0xf2b705, 0x2a9d4a, 0xff7ac0][(b + r + k) % 5], { roughness: 0.3 }), x - 0.85 + b * 0.24, 0.45 + r * 0.46, -D / 2 + 0.83);
    }
    // two aisles of shelves with stock
    const shelfMat = mat(0xcfd3d6, { metalness: 0.3, roughness: 0.5 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const stock = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.6 }), 260);
    let n = 0;
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    const cols = [0xe63946, 0xf4a261, 0x2a9d8f, 0x457b9d, 0xffd166, 0x8338ec, 0xffffff, 0x06d6a0];
    for (const x of [-1.6, 1.6]) {
      add(new THREE.BoxGeometry(0.9, 1.7, 4.2), shelfMat, x, 0.85, -0.6, true);
      for (const side of [-1, 1])
        for (let lvl = 0; lvl < 4; lvl++)
          for (let k = 0; k < 7 && n < 260; k++) {
            const w = 0.18 + Math.random() * 0.2, h = 0.16 + Math.random() * 0.2;
            m4.makeScale(0.14, h, w).setPosition(x + side * 0.5, 0.25 + lvl * 0.42 + h / 2, -2.4 + k * 0.58 + Math.random() * 0.1);
            stock.setMatrixAt(n, m4);
            stock.setColorAt(n++, col.set(cols[(n * 7 + lvl) % cols.length]));
          }
    }
    stock.count = n;
    stock.castShadow = true;
    group.add(stock);
    // the counter, till and a lottery-ticket stand by the door
    add(new THREE.BoxGeometry(3.2, 1.0, 0.8), mat(0x6b4f3a), -3.0, 0.5, 2.2, true);
    add(new THREE.BoxGeometry(0.45, 0.3, 0.4), mat(0x1c1c1c, { roughness: 0.4 }), -2.4, 1.15, 2.2);
    add(new THREE.BoxGeometry(0.8, 1.9, 0.5), mat(0x3a3f45), -4.4, 0.95, 0.8, true);
    for (let r = 0; r < 5; r++) add(new THREE.BoxGeometry(0.7, 0.06, 0.35), mat(cols[r % cols.length]), -4.4, 1.0 + r * 0.32, 1.05);
    platforms.push({ x0: center.x - W / 2 - 1, z0: center.z - W / 2 - 1, x1: center.x + W / 2 + 1, z1: center.z + W / 2 + 1, y: IY });
    g.scene.add(group);
    group.visible = false;
    const lights: THREE.PointLight[] = [];
    for (const z of [-1.8, 1.8]) {
      const l = new THREE.PointLight(0xfff1dc, 0, 14, 1.5);
      l.position.set(0, H - 0.4, z);
      group.add(l);
      lights.push(l);
    }
    const toWorld = (x: number, z: number) => new THREE.Vector3(x, 0, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), face).add(center);
    return { store, center, out, group, lights, door: toWorld(0, D / 2 - 0.9), counter: toWorld(-3.0, 3.0), outside: door.clone() };
  }

  update(dt: number) {
    const g = this.game;
    const p = g.player;
    if (this.busy > 0 || p.vehicle || p.dead) return;
    this.cool -= dt;
    const moving = Math.hypot(p.vx, p.vz);
    if (!this.inside) {
      for (const r of this.rooms) {
        const d = Math.hypot(p.pos.x - r.outside.x, p.pos.z - r.outside.z);
        if (d > 3) continue;
        const store = g.robbery.stores[r.store];
        if (d < 2.5) g.hud.prompt(`Walk in: ${store.name}`);
        // walking into the door
        const inward = -(p.vx * r.out.x + p.vz * r.out.z);
        if (d < 1.3 && inward > 0.8 && moving > 0.8 && this.cool <= 0) this.go(r, true);
      }
    } else {
      const r = this.inside;
      const d = Math.hypot(p.pos.x - r.door.x, p.pos.z - r.door.z);
      const outward = p.vx * r.out.x + p.vz * r.out.z;
      if (d < 0.9 && outward > 0.8 && this.cool <= 0) this.go(r, false);
    }
  }

  private go(r: Room, enter: boolean) {
    const g = this.game;
    this.busy = 1;
    this.fade.style.opacity = '1';
    setTimeout(() => {
      const p = g.player;
      const store = g.robbery.stores[r.store];
      r.group.visible = enter;
      for (const l of r.lights) l.intensity = enter ? 9 : 0;
      if (enter) {
        p.pos.set(r.door.x - r.out.x * 0.6, IY, r.door.z - r.out.z * 0.6);
        g.playerCtl.camYaw = Math.atan2(-r.out.x, -r.out.z);
        if (store.clerk && store.clerk.state === 'wait') {
          store.clerk.pos.set(r.counter.x, IY, r.counter.z);
          store.clerk.yaw = Math.atan2(r.out.x, r.out.z);
        }
        this.inside = r;
      } else {
        p.pos.set(r.outside.x + r.out.x * 1.2, 0, r.outside.z + r.out.z * 1.2);
        g.playerCtl.camYaw = Math.atan2(r.out.x, r.out.z);
        if (store.clerk && store.clerk.state === 'wait') store.clerk.pos.set(r.outside.x + r.out.z * 1.8, 0, r.outside.z - r.out.x * 1.8);
        this.inside = null;
      }
      p.vx = p.vz = 0;
      g.post.reset();
      this.fade.style.opacity = '0';
      this.cool = 1.2;
      setTimeout(() => (this.busy = 0), 250);
    }, 230);
  }
}
