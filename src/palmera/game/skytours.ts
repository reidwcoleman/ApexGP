// Sky Tours: in the Skylark, press T and a scenic route lights up: rings in the air past the
// tallest towers, over the bridge, the marina, the beach and back. Fly through them in order before
// the clock runs out; the fare is $800 and a bonus for every second to spare.
import * as THREE from 'three';
import { BRIDGE, BEACH } from '../world/map';
import type { Blip } from './missions';
import type { Game } from './game';

const R = 9;

export class SkyTours {
  active = false;
  private route: THREE.Vector3[] = [];
  private i = 0;
  private timer = 0;
  private rings: THREE.Mesh[] = [];
  private readonly mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.9, 0.5), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  private readonly matNext = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.0, 0.3), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });

  constructor(private game: Game) {
    const geo = new THREE.TorusGeometry(R, 0.55, 8, 40);
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(geo, k === 0 ? this.mat : this.matNext);
      m.visible = false;
      m.frustumCulled = false;
      game.scene.add(m);
      this.rings.push(m);
    }
  }

  /** the scenic points: the three tallest towers, the bridge, the marina, the beach, the edge of town */
  private points(): THREE.Vector3[] {
    const g = this.game;
    const towers = [...g.map.buildings].sort((a, b) => b.y0 + b.h - (a.y0 + a.h));
    const pts: THREE.Vector3[] = [];
    for (const b of towers) {
      if (pts.length >= 3) break;
      if (pts.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 120)) continue;
      // alongside the tower, two thirds of the way up
      pts.push(new THREE.Vector3(b.x + b.w / 2 + 16, (b.y0 + b.h) * 0.7, b.z));
    }
    pts.push(new THREE.Vector3((BRIDGE.x0 + BRIDGE.x1) / 2, 26, BRIDGE.z));
    pts.push(new THREE.Vector3(400, 30, 300));
    pts.push(new THREE.Vector3(BEACH.x0 + 30, 28, 120));
    pts.push(new THREE.Vector3(BEACH.x0 + 30, 34, -380));
    pts.push(new THREE.Vector3(-150, 45, -100));
    return pts;
  }

  private start() {
    const g = this.game;
    const c = g.chopper.camera()!;
    // a loop that starts from the nearest point and always goes on to the closest one left
    const left = this.points();
    const order: THREE.Vector3[] = [];
    let at = new THREE.Vector3(c.x, c.y, c.z);
    while (left.length) {
      let bi = 0, bd = 1e9;
      left.forEach((p, k) => {
        const d = p.distanceTo(at);
        if (d < bd) (bd = d), (bi = k);
      });
      at = left.splice(bi, 1)[0];
      order.push(at);
    }
    this.route = order;
    this.i = 0;
    let len = 0;
    let p = new THREE.Vector3(c.x, c.y, c.z);
    for (const q of order) {
      len += p.distanceTo(q);
      p = q;
    }
    this.timer = len / 26 + 25;
    this.active = true;
    g.hud.bigMessage('SKY TOUR', `${order.length} rings · fly through them in order`, '#ffd23f');
    g.audio.cue('start');
  }

  private stop() {
    this.active = false;
    for (const r of this.rings) r.visible = false;
  }

  get blips(): Blip[] {
    if (!this.active) return [];
    const p = this.route[this.i];
    return p ? [{ x: p.x, z: p.z, color: '#ffd23f', label: '', kind: 'dest' }] : [];
  }

  update(dt: number) {
    const g = this.game;
    const c = g.chopper.camera();
    if (!c) {
      if (this.active) {
        this.stop();
        g.hud.toast('Sky Tour cancelled');
      }
      return;
    }
    if (!this.active) {
      if (!g.missions.active) {
        g.hud.prompt('<kbd>T</kbd> Fly a Sky Tour');
        if (g.input.hit('KeyT')) this.start();
      }
      return;
    }
    this.timer -= dt;
    const target = this.route[this.i];
    const pos = new THREE.Vector3(c.x, c.y, c.z);
    // the rings face along the way from the last one
    for (let k = 0; k < 2; k++) {
      const p = this.route[this.i + k];
      const r = this.rings[k];
      r.visible = !!p;
      if (!p) continue;
      const from = k === 0 ? (this.i > 0 ? this.route[this.i - 1] : pos) : this.route[this.i];
      r.position.copy(p);
      r.lookAt(from.x, p.y, from.z);
      r.rotation.z = g.elapsed * 0.4;
    }
    const d = pos.distanceTo(target);
    if (d < R) {
      this.i++;
      g.audio.cue('pickup');
      if (this.i >= this.route.length) {
        const pay = 800 + Math.max(0, Math.round(this.timer * 20));
        g.addCash(pay);
        g.hud.bigMessage('TOUR COMPLETE', `+$${pay}`, '#ffd23f');
        g.audio.cue('pass');
        this.stop();
        return;
      }
    }
    if (this.timer <= 0) {
      g.hud.bigMessage('TOUR FAILED', 'out of time', '#ff5a5a');
      g.audio.cue('fail');
      this.stop();
      return;
    }
    g.hud.prompt(`Sky Tour · ring ${this.i + 1} / ${this.route.length} · ${Math.round(d)} m · <b>${Math.ceil(this.timer)} s</b>`);
  }
}
