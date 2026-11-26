// The pier: a timber boardwalk on piles running out to sea from the middle of the beach, with
// string lights along its rails, a pair of kiosks, and at the end a 40 m observation wheel facing
// the city - spokes, twin rims studded with bulbs, gondolas that hang level as it turns. Walkable
// (and drivable, for the brave); the bulbs come up after dark. Original.
import * as THREE from 'three';
import { box, cyl, merge, prep } from '../core/geo';
import { groundBase, platforms, type CityMap } from './map';
import type { Game } from '../game/game';

const Z = 140, X0 = 712, X1 = 860, W = 12, DECK = 1.25;
/** where the pier is, for the people walking on it */
export const PIER = { z: Z, x0: X0, x1: X1, w: W, deck: DECK, endX: X1 + 26, endHalf: 15 };
const HUB = { x: 868, y: DECK + 24, z: Z }, R = 20, N = 20;
/** the loading platform's top */
const LOAD = DECK + 0.92;

export class Pier {
  private wheel = new THREE.Group();
  private gondolas: THREE.Object3D[] = [];
  private bulbMat: THREE.MeshBasicMaterial;
  private stringMat: THREE.MeshBasicMaterial;
  private t = 0;
  /** the gondola you're riding in, if any */
  riding: THREE.Object3D | null = null;
  private rideT = 0;
  private wantOff = false;
  private wv = new THREE.Vector3();
  private neonMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, map: CityMap) {
    const root = new THREE.Group();
    scene.add(root);
    const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const parts: THREE.BufferGeometry[] = [];
    // the deck: planks in two tones, and a wider platform at the end for the wheel
    const len = X1 - X0;
    for (let i = 0; i < len / 1.2; i++) parts.push(box(1.12, 0.2, W, X0 + 0.6 + i * 1.2, DECK - 0.1, Z, i % 3 ? 0x8a6a4a : 0x7b5d40));
    parts.push(box(28, 0.2, 30, X1 + 12, DECK - 0.1, Z, 0x86664a));
    // piles and cross-beams
    for (let x = X0 + 4; x < X1 + 26; x += 6) {
      const wide = x > X1 - 2;
      for (const s of wide ? [-14, -7, 0, 7, 14] : [-W / 2 + 0.4, W / 2 - 0.4]) {
        const by = Math.min(-0.2, groundBase(x, Z + s));
        const h = DECK - 0.2 - by + 2.5;
        parts.push(cyl(0.22, 0.25, h, 7, x, by - 2.5 + h / 2, Z + s, 0x5c4a38));
      }
      parts.push(box(0.3, 0.35, wide ? 30 : W, x, DECK - 0.38, Z, 0x5a4634));
    }
    // rails along both sides (and round the end platform)
    const railTop = DECK + 1.05;
    for (const s of [-1, 1]) {
      parts.push(box(len, 0.1, 0.12, X0 + len / 2, railTop, Z + s * (W / 2 - 0.1), 0xe8e2d6));
      parts.push(box(len, 0.06, 0.08, X0 + len / 2, DECK + 0.55, Z + s * (W / 2 - 0.1), 0xe8e2d6));
      for (let x = X0; x <= X1; x += 2) parts.push(box(0.1, 1.05, 0.1, x, DECK + 0.52, Z + s * (W / 2 - 0.1), 0xe8e2d6));
      parts.push(box(28, 0.1, 0.12, X1 + 12, railTop, Z + s * 14.9, 0xe8e2d6));
      for (let x = X1; x <= X1 + 26; x += 2) parts.push(box(0.1, 1.05, 0.1, x, DECK + 0.52, Z + s * 14.9, 0xe8e2d6));
    }
    parts.push(box(0.12, 0.1, 30, X1 + 25.9, railTop, Z, 0xe8e2d6));
    // two kiosks with striped awnings halfway along
    for (const [kx, s, c] of [[X0 + 60, -1, 0xff8a7a], [X0 + 95, 1, 0x7fd8d0]] as [number, number, number][]) {
      const kz = Z + s * (W / 2 - 1.6);
      parts.push(box(3, 2.4, 2.4, kx, DECK + 1.2, kz, 0xf4efe6));
      parts.push(box(3.2, 0.12, 1.2, kx, DECK + 2.3, kz - s * 1.6, c));
      parts.push(box(3.4, 0.25, 2.8, kx, DECK + 2.55, kz, c));
      parts.push(box(2.2, 0.9, 0.05, kx, DECK + 1.5, kz - s * 1.21, 0x2a2a2a));
    }
    const deck = new THREE.Mesh(merge(parts), wood);
    deck.castShadow = true;
    deck.receiveShadow = true;
    root.add(deck);
    // walk on it (and drive, carefully); rails stop you going over
    platforms.push({ x0: X0, z0: Z - W / 2, x1: X1, z1: Z + W / 2, y: DECK });
    platforms.push({ x0: X1 - 2, z0: Z - 15, x1: X1 + 26, z1: Z + 15, y: DECK });
    const col = map.colliders;
    for (const s of [-1, 1]) {
      col.add(X0 + 2, Z + s * (W / 2) - 0.15, X1 - 2, Z + s * (W / 2) + 0.15, DECK - 0.5, DECK + 1.1);
      col.add(X1 - 2, Z + s * 15 - 0.15, X1 + 26, Z + s * 15 + 0.15, DECK - 0.5, DECK + 1.1);
      col.add(X1 - 2.2, s > 0 ? Z + W / 2 : Z - 15, X1 - 1.8, s > 0 ? Z + 15 : Z - W / 2, DECK - 0.5, DECK + 1.1);
    }
    col.add(X1 + 25.8, Z - 15, X1 + 26.2, Z + 15, DECK - 0.5, DECK + 1.1);
    // the wheel's A-frame legs and its base
    const steel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.6 });
    const frame: THREE.BufferGeometry[] = [];
    const tube = (a: number[], b: number[], r: number, color: number, list = frame) => {
      const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
      const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), 8);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
      g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      list.push(prep(g, color));
    };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tube([HUB.x + sx * 3.2, DECK, HUB.z + sz * 11], [HUB.x + sx * 1.6, HUB.y, HUB.z], 0.45, 0xf2f2f0);
    // the loading platform under the wheel: the gondolas clear it by a hand's width at the bottom
    frame.push(box(12, 0.8, 6, HUB.x, DECK + 0.4, HUB.z, 0x2f6f8f));
    frame.push(box(13, 0.12, 7, HUB.x, DECK + 0.86, HUB.z, 0xf2f2f0));
    for (let k = 0; k < 3; k++) frame.push(box(1.6, 0.3 * (k + 1), 0.5, HUB.x - 7.3, DECK + 0.15 * (k + 1), HUB.z - 1 + k * 0.5 - 0.5, 0xf2f2f0));
    platforms.push({ x0: HUB.x - 6.5, z0: HUB.z - 3.5, x1: HUB.x + 6.5, z1: HUB.z + 3.5, y: LOAD });
    tube([HUB.x - 2.2, HUB.y, HUB.z], [HUB.x + 2.2, HUB.y, HUB.z], 0.9, 0xd0d4d8);
    const fm = new THREE.Mesh(merge(frame), steel);
    fm.castShadow = true;
    root.add(fm);
    // the wheel: in the y-z plane (it faces the city), turning about x
    this.wheel.position.set(HUB.x, HUB.y, HUB.z);
    root.add(this.wheel);
    const wp: THREE.BufferGeometry[] = [];
    for (const sx of [-1.3, 1.3]) {
      const rim = new THREE.TorusGeometry(R, 0.28, 6, 72);
      rim.rotateY(Math.PI / 2);
      rim.translate(sx, 0, 0);
      wp.push(prep(rim, 0xf4f4f2));
      const inner = new THREE.TorusGeometry(R * 0.86, 0.14, 5, 64);
      inner.rotateY(Math.PI / 2);
      inner.translate(sx, 0, 0);
      wp.push(prep(inner, 0xf4f4f2));
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        tube([sx * 0.4, 0, 0], [sx, Math.cos(a) * R, Math.sin(a) * R], 0.08, 0xe0e4e8, wp);
      }
    }
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      tube([-1.3, Math.cos(a) * R, Math.sin(a) * R], [1.3, Math.cos(a) * R, Math.sin(a) * R], 0.1, 0xe0e4e8, wp);
    }
    const wm = new THREE.Mesh(merge(wp), steel);
    wm.castShadow = true;
    this.wheel.add(wm);
    // gondolas: rounded cabins in candy colours, hung from the rim, kept level
    const cabGeo = (() => {
      const g: THREE.BufferGeometry[] = [];
      const body = new THREE.CylinderGeometry(1.25, 1.1, 2.0, 10);
      body.translate(0, -2.1, 0);
      g.push(prep(body, 0xffffff));
      const roof = new THREE.SphereGeometry(1.3, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      roof.scale(1, 0.45, 1);
      roof.translate(0, -1.1, 0);
      g.push(prep(roof, 0xffffff));
      const win = new THREE.CylinderGeometry(1.27, 1.27, 0.7, 10, 1, true);
      win.translate(0, -1.75, 0);
      g.push(prep(win, 0x1d2b36));
      g.push(cyl(0.06, 0.06, 1.0, 4, 0, -0.5, 0, 0xcccccc));
      return merge(g);
    })();
    const cols = [0xff6f91, 0xffc75f, 0x7fd8d0, 0x9a8cff, 0xff9671, 0x58d68d];
    for (let i = 0; i < N; i++) {
      const a = ((i + 0.5) / N) * Math.PI * 2;
      const holder = new THREE.Group();
      holder.position.set(0, Math.cos(a) * R, Math.sin(a) * R);
      const cab = new THREE.Mesh(cabGeo, new THREE.MeshStandardMaterial({ vertexColors: true, color: cols[i % cols.length], roughness: 0.45, metalness: 0.2 }));
      cab.castShadow = true;
      holder.add(cab);
      this.wheel.add(holder);
      this.gondolas.push(holder);
    }
    // bulbs: round both rims and down the spokes; string lights along the pier rails
    // unlit, so each bulb keeps its colour; brightened past 1 at night (not tone-mapped) so the bloom catches them
    this.bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const bulbG = new THREE.SphereGeometry(0.22, 6, 4);
    const bulbCols = [0xff2d7a, 0x22d8ff, 0xffa41f, 0x6dff5a];
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const rimB: THREE.Matrix4[] = [], rimC: THREE.Color[] = [];
    for (const sx of [-1.3, 1.3]) {
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        rimB.push(m.clone().makeTranslation(sx, Math.cos(a) * (R + 0.3), Math.sin(a) * (R + 0.3)));
        rimC.push(c.clone().setHex(bulbCols[Math.floor(i / 4) % bulbCols.length]));
      }
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        for (let k = 1; k <= 6; k++) {
          const r = (k / 7) * R;
          rimB.push(m.clone().makeTranslation(sx, Math.cos(a) * r, Math.sin(a) * r));
          rimC.push(c.clone().setHex(0xffc46a));
        }
      }
    }
    const rb = new THREE.InstancedMesh(bulbG, this.bulbMat, rimB.length);
    rimB.forEach((mm, i) => (rb.setMatrixAt(i, mm), rb.setColorAt(i, rimC[i])));
    this.wheel.add(rb);
    // a neon tube round each rim that cycles colour after dark (it's what you see of it from across town)
    this.neonMat = new THREE.MeshBasicMaterial({ color: 0xff2d7a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    for (const sx of [-1.45, 1.45]) {
      const n = new THREE.Mesh(new THREE.TorusGeometry(R + 0.55, 0.14, 5, 96), this.neonMat);
      n.rotation.y = Math.PI / 2;
      n.position.x = sx;
      this.wheel.add(n);
    }
    this.stringMat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, toneMapped: false });
    // posts on the rails every 8 m, a sagging wire between each pair, bulbs hung along it
    const sB: THREE.Matrix4[] = [];
    const posts: THREE.BufferGeometry[] = [];
    const wire: number[] = [];
    const postH = railTop + 1.5, sag = 0.45, span = 8;
    for (const s of [-1, 1]) {
      const z = Z + s * (W / 2 - 0.1);
      for (let x = X0; x <= X1; x += span) posts.push(cyl(0.04, 0.05, postH - DECK, 5, x, (postH + DECK) / 2, z, 0x3a3c40));
      for (let x = X0; x < X1; x += span) {
        let px = x, py = postH;
        for (let k = 1; k <= 8; k++) {
          const u = k / 8, nx = x + span * u, ny = postH - sag * 4 * u * (1 - u);
          wire.push(px, py, z, nx, ny, z);
          px = nx;
          py = ny;
          if (k < 8) sB.push(m.clone().makeTranslation(nx, ny - 0.1, z));
        }
      }
    }
    const pm = new THREE.Mesh(merge(posts), steel);
    root.add(pm);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    root.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2a2a })));
    const sb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 5, 3), this.stringMat, sB.length);
    sB.forEach((mm, i) => sb.setMatrixAt(i, mm));
    root.add(sb);
  }

  /** where the camera should follow while you ride (the same shape as the helicopter's) */
  rideCamera(): { x: number; y: number; z: number; yaw: number; speed: number } | null {
    if (!this.riding) return null;
    this.riding.getWorldPosition(this.wv);
    return { x: this.wv.x, y: this.wv.y - 2.6, z: this.wv.z, yaw: -Math.PI / 2, speed: 0 };
  }

  /** how far the gondola is from the bottom of its turn (0 = at the loading platform) */
  private fromBottom(g: THREE.Object3D) {
    g.getWorldPosition(this.wv);
    return Math.hypot(this.wv.y - (HUB.y - R), this.wv.z - HUB.z);
  }

  update(dt: number, night: number, game?: Game) {
    this.t += dt;
    // a slow turn: about four minutes a revolution (one a minute while you're aboard)
    this.wheel.rotation.x += dt * (this.riding ? 0.1 : 0.026);
    if (game) this.ride(dt, game);
    for (const g of this.gondolas) g.rotation.x = -this.wheel.rotation.x;
    this.bulbMat.color.setScalar(0.8 + night * 1.6 * (0.85 + 0.15 * Math.sin(this.t * 2.1)));
    this.neonMat.opacity = Math.min(1, night * 1.3);
    this.neonMat.color.setHSL((this.t * 0.03) % 1, 1, 0.5).multiplyScalar(2.5);

    this.stringMat.color.setRGB(1, 0.886, 0.66).multiplyScalar(0.7 + night * 2.6);
  }

  private ride(dt: number, g: Game) {
    const p = g.player;
    if (!this.riding) {
      if (p.vehicle || p.dead || p.hidden || g.chopper?.flying) return;
      if (Math.hypot(p.pos.x - HUB.x, p.pos.z - HUB.z) > 4.5 || p.pos.y < LOAD - 0.3) return;
      if (g.wanted.level > 0) {
        g.hud.prompt('The wheel is closed to you while the police are after you');
        return;
      }
      g.hud.prompt(`<kbd>F</kbd> Ride the wheel · $5`);
      if (!g.input.hit('KeyF')) return;
      if (g.cash < 5) {
        g.hud.toast('Not enough cash');
        return;
      }
      g.addCash(-5);
      // board whichever gondola is lowest
      let best = this.gondolas[0], bd = 1e9;
      for (const c of this.gondolas) {
        const d = this.fromBottom(c);
        if (d < bd) (bd = d), (best = c);
      }
      this.riding = best;
      this.rideT = 0;
      this.wantOff = false;
      p.hidden = true;
      p.vx = p.vz = p.vy = 0;
      g.audio.cue('pickup');
      g.hud.toast('Round we go · F to get off at the bottom');
      return;
    }
    this.rideT += dt;
    this.riding.getWorldPosition(this.wv);
    p.pos.set(this.wv.x, this.wv.y - 3.0, this.wv.z);
    // F any time: you step off when your gondola next comes round to the platform
    if (this.rideT > 1 && g.input.hit('KeyF')) this.wantOff = !this.wantOff;
    const low = this.fromBottom(this.riding) < 3;
    if (this.rideT > 1) g.hud.prompt(this.wantOff ? 'Getting off at the bottom · <kbd>F</kbd> stay on' : '<kbd>F</kbd> Get off at the bottom · look around with the mouse');
    if (low && this.rideT > 4) {
      if (this.wantOff) {
        this.riding = null;
        p.hidden = false;
        p.pos.set(HUB.x - 2.5, LOAD, HUB.z - 2.2);
        p.vy = 0;
        p.onGround = true;
      }
    }
  }
}
