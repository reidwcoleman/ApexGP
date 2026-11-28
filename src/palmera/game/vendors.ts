// Street food: a dozen carts around town - tacos, paletas (fruit ice pops) and hot dogs - each with a
// striped umbrella, a vendor behind the counter and, now and then, a customer or two waiting. They
// trade from mid-morning until late evening. Walk up to the counter and press T to buy something:
// a few dollars, and it puts some health back.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { Human } from '../entities/humans';
import { placeFurniture } from '../world/furniture';
import { groundAt, regionAt } from '../world/map';
import type { Game } from './game';

interface Kind {
  name: string;
  food: string;
  price: number;
  heal: number;
  body: number;
  stripe: string;
  ink: string;
}

const KINDS: Kind[] = [
  { name: 'TACO TIDE', food: 'two fish tacos', price: 7, heal: 35, body: 0x2f8f6a, stripe: '#2f8f6a', ink: '#fff4d6' },
  { name: 'PALETAS', food: 'a mango paleta', price: 4, heal: 20, body: 0xf27aa6, stripe: '#f27aa6', ink: '#ffffff' },
  { name: 'SUNNY DOGS', food: 'a chili dog', price: 5, heal: 30, body: 0xd8442f, stripe: '#f2c230', ink: '#fff6dc' },
];

interface Cart {
  kind: Kind;
  x: number;
  z: number;
  yaw: number;
  group: THREE.Group;
  vendor: Human | null;
  queue: Human[];
  qT: number;
}

export class Vendors {
  carts: Cart[] = [];
  private busy = 0;
  private open = false;

  constructor(private game: Game) {
    const map = game.map;
    const kit = KINDS.map((k) => cartModel(k));
    const v = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler();
    const tmp: ReturnType<typeof map.colliders.query> = [];
    let n = 0;
    for (const it of placeFurniture(map)) {
      if (it.kind !== 'bench' || this.carts.length >= 12) continue;
      it.m.decompose(v, q, sc);
      const yaw = e.setFromQuaternion(q, 'YXZ').y;
      // a few steps along the sidewalk from the bench
      const x = v.x + Math.cos(yaw) * 3.4, z = v.z - Math.sin(yaw) * 3.4;
      const r = regionAt(x, z);
      if (r !== 'downtown' && r !== 'harbor' && r !== 'marina' && r !== 'suburb') continue;
      if (r === 'suburb' && n++ % 3) continue;
      if (this.carts.some((c) => Math.hypot(c.x - x, c.z - z) < 150)) continue;
      const y = groundAt(x, z);
      tmp.length = 0;
      if (map.colliders.query(x - 1.6, z - 1.6, x + 1.6, z + 1.6, tmp).some((b) => b.y0 < y + 2 && b.y1 > y + 0.1)) continue;
      const kind = KINDS[this.carts.length % KINDS.length];
      const group = kit[KINDS.indexOf(kind)].clone();
      group.position.set(x, y, z);
      group.rotation.y = yaw;
      game.scene.add(group);
      map.colliders.add(x - 0.75, z - 0.75, x + 0.75, z + 0.75, y, y + 1.3, true);
      this.carts.push({ kind, x, z, yaw, group, vendor: null, queue: [], qT: Math.random() * 10 });
    }
  }

  /** local (along the cart, out from its front) to world */
  private at(c: Cart, lx: number, lz: number) {
    return { x: c.x + Math.cos(c.yaw) * lx + Math.sin(c.yaw) * lz, z: c.z - Math.sin(c.yaw) * lx + Math.cos(c.yaw) * lz };
  }

  update(dt: number) {
    const g = this.game;
    const t = g.sky.time;
    this.open = t > 9.5 && t < 22.5;
    if (this.busy > 0) this.busy -= dt;
    const f = g.focus;
    const pl = g.player;
    for (const c of this.carts) {
      const d = Math.hypot(c.x - f.x, c.z - f.z);
      c.group.visible = d < 400;
      if (c.vendor && (!g.npcs.includes(c.vendor) || c.vendor.dead || c.vendor.state !== 'vendor')) c.vendor = null;
      c.queue = c.queue.filter((h) => g.npcs.includes(h) && h.state === 'queue');
      if (!this.open || d > 110) continue;
      const hidden = d > 35 && !g.inView(c.x, 1, c.z);
      // the vendor behind the counter
      if (!c.vendor && (hidden || d > 70)) {
        const p = this.at(c, 0, -0.95);
        const h = this.ped(p.x, p.z, 'vendor', 1e9);
        h.yaw = c.yaw;
        c.vendor = h;
      }
      // now and then someone stops to buy
      c.qT -= dt;
      if (c.qT <= 0) {
        c.qT = 14 + Math.random() * 22;
        if (c.vendor && c.queue.length < 2 && (hidden || d > 60) && g.sky.day > 0.2) {
          const p = this.at(c, (Math.random() - 0.5) * 0.8, 1.15 + c.queue.length * 0.85);
          const h = this.ped(p.x, p.z, 'queue', 16 + Math.random() * 20);
          h.yaw = c.yaw + Math.PI + (Math.random() - 0.5) * 0.5;
          h.texting = Math.random() < 0.25;
          c.queue.push(h);
        }
      }
      // you, at the counter
      if (pl.vehicle || pl.dead || !c.vendor) continue;
      const front = this.at(c, 0, 1.1);
      if (Math.hypot(pl.pos.x - front.x, pl.pos.z - front.z) > 1.5) continue;
      const k = c.kind;
      if (g.cash < k.price) {
        g.hud.prompt(`${titleCase(k.name)} · ${k.food} $${k.price} · <b>not enough cash</b>`);
        continue;
      }
      g.hud.prompt(`<kbd>T</kbd> Buy ${k.food} · $${k.price}`);
      if (g.input.hit('KeyT') && this.busy <= 0) {
        this.busy = 1.2;
        g.cash -= k.price;
        pl.health = Math.min(pl.maxHealth, pl.health + k.heal);
        g.audio.cue('cash');
        g.hud.toast(`${titleCase(k.name)}: ${k.food} · +${k.heal} health`);
      }
    }
  }

  private ped(x: number, z: number, state: string, t: number): Human {
    const h = new Human('ped');
    h.pos.set(x, groundAt(x, z), z);
    h.state = state;
    h.stateT = t;
    h.clip = 'idle';
    h.health = h.maxHealth = 60;
    this.game.addNpc(h);
    return h;
  }
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
}

/** a street cart, built along local x (1.9 m) with its serving front facing +z */
function cartModel(k: Kind): THREE.Group {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: k.body, roughness: 0.45, metalness: 0.1 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.28, metalness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.8 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, shadow = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  // the box on its chassis, a steel counter overhanging the front
  add(new RoundedBoxGeometry(1.9, 0.82, 0.86, 3, 0.06), paint, 0, 0.78, 0);
  add(new RoundedBoxGeometry(2.04, 0.05, 1.04, 2, 0.02), steel, 0, 1.215, 0.05);
  add(new THREE.BoxGeometry(1.86, 0.05, 0.82), steel, 0, 0.36, 0);
  // the sign on the front and back
  const sign = signTexture(k);
  const sm = new THREE.MeshStandardMaterial({ map: sign, roughness: 0.5 });
  const front = add(new THREE.PlaneGeometry(1.6, 0.46), sm, 0, 0.86, 0.435, false);
  const back = front.clone();
  back.position.z = -0.435;
  back.rotation.y = Math.PI;
  g.add(back);
  // two big wheels at one end, a pair of legs and a push handle at the other
  const wheel = new THREE.CylinderGeometry(0.3, 0.3, 0.07, 18);
  wheel.rotateX(Math.PI / 2);
  for (const s of [-1, 1]) {
    add(wheel, dark, -0.62, 0.3, s * 0.47);
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 10).rotateX(Math.PI / 2), steel, -0.62, 0.3, s * 0.515);
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6), steel, 0.8, 0.18, s * 0.36);
  }
  const handle = new THREE.CylinderGeometry(0.022, 0.022, 0.8, 8);
  handle.rotateX(Math.PI / 2);
  add(handle, steel, 1.12, 1.0, 0);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.018, 0.018, 0.24, 6).rotateZ(Math.PI / 2), steel, 1.0, 1.0, s * 0.38);
  // on the counter: a steel well with lids, squeeze bottles, a napkin box
  add(new THREE.BoxGeometry(0.9, 0.1, 0.5), steel, -0.25, 1.29, -0.12);
  const bottle = new THREE.CylinderGeometry(0.035, 0.04, 0.2, 8);
  const sauces = [0xd8301e, 0xf2c230, 0x3f8f3a];
  sauces.forEach((c, i) => add(bottle, new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }), 0.5 + i * 0.1, 1.34, 0.25, false));
  add(new THREE.BoxGeometry(0.18, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.9 }), 0.78, 1.3, -0.15, false);
  // the umbrella on its pole
  add(new THREE.CylinderGeometry(0.022, 0.022, 1.5, 8), steel, 0.15, 1.95, -0.2);
  const canopy = new THREE.ConeGeometry(1.35, 0.45, 16, 1, true);
  const um = new THREE.MeshStandardMaterial({ map: stripeTexture(k), roughness: 0.8, side: THREE.DoubleSide });
  add(canopy, um, 0.15, 2.72, -0.2);
  add(new THREE.SphereGeometry(0.04, 8, 6), steel, 0.15, 2.96, -0.2, false);
  return g;
}

function signTexture(k: Kind) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 148;
  const x = c.getContext('2d')!;
  x.fillStyle = '#' + new THREE.Color(k.body).getHexString();
  x.fillRect(0, 0, 512, 148);
  x.fillStyle = k.ink;
  x.fillRect(10, 10, 492, 4);
  x.fillRect(10, 134, 492, 4);
  x.textAlign = 'center';
  x.font = '900 70px system-ui, sans-serif';
  x.fillText(k.name, 256, 90);
  x.font = '700 24px system-ui, sans-serif';
  x.fillText(`${k.food.toUpperCase()} · $${k.price}`, 256, 124);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function stripeTexture(k: Kind) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 16;
  const x = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) {
    x.fillStyle = i % 2 ? '#f6f2e8' : k.stripe;
    x.fillRect(i * 16, 0, 16, 16);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
