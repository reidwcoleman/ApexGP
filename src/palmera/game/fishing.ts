// Fishing: stand at the edge of open water - the pier rails, the end of a marina dock, the surf -
// and press T to cast. The float sits out on the water; when a fish takes it, it dips and you have a
// moment to strike (T). Then reel: hold T to wind in, but the line's tension climbs while you do and
// the fish makes runs that spike it - let go to ease off before it snaps. Land it and it's sold on the
// spot by the pound: snapper, mackerel, snook, grouper, barracuda, the odd tarpon, and now and then
// something that isn't a fish. Walk away, get in a car or take a hit to reel in and stop.
import * as THREE from 'three';
import { WATER_Y, groundAt } from '../world/map';
import type { Game } from './game';

type Stage = 'idle' | 'wait' | 'bite' | 'reel';

const CATCH = [
  { name: 'Mangrove snapper', lo: 0.8, hi: 4, per: 9, w: 26 },
  { name: 'Spanish mackerel', lo: 1, hi: 6, per: 7, w: 22 },
  { name: 'Snook', lo: 3, hi: 20, per: 10, w: 14 },
  { name: 'Gag grouper', lo: 4, hi: 30, per: 8, w: 10 },
  { name: 'Barracuda', lo: 3, hi: 25, per: 5, w: 12 },
  { name: 'Tarpon', lo: 30, hi: 110, per: 3, w: 3 },
  { name: 'Old boot', lo: 1.5, hi: 1.5, per: 0, w: 6 },
  { name: 'Lost sunglasses', lo: 0.2, hi: 0.2, per: 75, w: 3 },
];

export class Fishing {
  stage: Stage = 'idle';
  private t = 0;
  private spot = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private bob = new THREE.Vector3();
  private fish: (typeof CATCH)[number] & { lb: number; str: number } = { ...CATCH[0], lb: 1, str: 1 };
  private progress = 0;
  private tension = 0;
  private run = 0;
  private runIn = 2;
  private hp = 0;
  private rod: THREE.Mesh;
  private line: THREE.Line;
  private float: THREE.Mesh;
  best = 0;
  caught = 0;

  constructor(private game: Game) {
    const rodGeo = new THREE.CylinderGeometry(0.006, 0.016, 2.4, 6);
    rodGeo.translate(0, 1.2, 0);
    const grip = new THREE.CylinderGeometry(0.022, 0.022, 0.35, 8);
    grip.translate(0, 0.12, 0);
    const reel = new THREE.CylinderGeometry(0.04, 0.04, 0.05, 12);
    reel.rotateZ(Math.PI / 2);
    reel.translate(0.05, 0.38, 0);
    this.rod = new THREE.Mesh(mergeGeos([rodGeo, grip, reel]), new THREE.MeshStandardMaterial({ color: 0x1d2a33, roughness: 0.35, metalness: 0.4 }));
    this.rod.castShadow = true;
    this.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(new Array(12).fill(0).map(() => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: 0xe8e8e0, transparent: true, opacity: 0.7 }));
    this.line.frustumCulled = false;
    const fg = new THREE.SphereGeometry(0.06, 10, 8);
    const cols = new Float32Array(fg.getAttribute('position').count * 3);
    const p = fg.getAttribute('position');
    for (let i = 0; i < p.count; i++) cols.set(p.getY(i) > 0 ? [0.9, 0.1, 0.08] : [0.95, 0.95, 0.92], i * 3);
    fg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.float = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }));
    for (const o of [this.rod, this.line, this.float]) {
      o.visible = false;
      game.scene.add(o);
    }
  }

  /** open water just off where you stand, the way you face if possible: the direction to cast, or null */
  private waterEdge(): THREE.Vector3 | null {
    const pl = this.game.player;
    if (pl.vehicle || pl.swimming || pl.dead) return null;
    const y = pl.pos.y;
    if (y < WATER_Y + 0.3) return null;
    let best: THREE.Vector3 | null = null, bs = -2;
    for (let k = 0; k < 16; k++) {
      const a = pl.yaw + (k / 16) * Math.PI * 2;
      const dx = Math.sin(a), dz = Math.cos(a);
      // the ground (or deck) a step out and the water further out must both be well below you
      const near = groundAt(pl.pos.x + dx * 1.6, pl.pos.z + dz * 1.6, y + 0.5);
      const far = groundAt(pl.pos.x + dx * 9, pl.pos.z + dz * 9, y + 0.5);
      if (near > WATER_Y - 0.15 || far > WATER_Y - 0.4) continue;
      const s = Math.cos(a - pl.yaw);
      if (s > bs) (bs = s), (best = new THREE.Vector3(dx, 0, dz));
    }
    return best;
  }

  private cast(dir: THREE.Vector3) {
    const g = this.game;
    const pl = g.player;
    this.stage = 'wait';
    this.t = 3 + Math.random() * 9;
    this.spot.copy(pl.pos);
    this.dir.copy(dir);
    pl.yaw = Math.atan2(dir.x, dir.z);
    pl.fishing = true;
    this.hp = pl.health;
    this.bob.set(pl.pos.x + dir.x * 9, WATER_Y + 0.02, pl.pos.z + dir.z * 9);
    g.effects.puff(this.bob.x, WATER_Y + 0.05, this.bob.z, 'splash');
    g.audio.whoosh();
    for (const o of [this.rod, this.line, this.float]) o.visible = true;
  }

  private stop(msg?: string) {
    this.stage = 'idle';
    this.game.player.fishing = false;
    for (const o of [this.rod, this.line, this.float]) o.visible = false;
    if (msg) this.game.hud.toast(msg);
  }

  private hook() {
    let r = Math.random() * CATCH.reduce((s, c) => s + c.w, 0);
    let c = CATCH[0];
    for (const q of CATCH) if ((r -= q.w) <= 0) { c = q; break; }
    const lb = Math.round((c.lo + Math.pow(Math.random(), 2) * (c.hi - c.lo)) * 10) / 10;
    this.fish = { ...c, lb, str: Math.min(1.9, 0.55 + Math.sqrt(lb) * 0.16) };
    this.progress = 0;
    this.tension = 0.15;
    this.run = 0;
    this.runIn = 1 + Math.random() * 2;
    this.stage = 'reel';
  }

  private land() {
    const g = this.game;
    const f = this.fish;
    const pay = Math.round(f.lb * f.per);
    g.cash += pay;
    this.caught++;
    const junk = f.per === 0;
    if (!junk && f.lb > this.best) this.best = f.lb;
    g.audio.cue(pay > 0 ? 'cash' : 'fail');
    g.effects.puff(this.bob.x, WATER_Y + 0.05, this.bob.z, 'splash');
    g.hud.bigMessage(junk ? 'JUNK' : f.name.toUpperCase(), junk ? 'An old boot. Back it goes.' : `${f.lb} lb${pay ? ` · sold for $${pay}` : ''}`, junk ? '#b0b0b0' : '#7dd3ff');
    // straight back out for the next one
    this.cast(this.dir);
  }

  update(dt: number) {
    const g = this.game;
    const pl = g.player;
    if (this.stage === 'idle') {
      if (g.missions.active || g.activities.active || g.delivery?.active) return;
      const dir = this.waterEdge();
      if (!dir) return;
      g.hud.prompt('<kbd>T</kbd> Cast a line');
      if (g.input.hit('KeyT')) this.cast(dir);
      return;
    }
    // anything that pulls you away ends it
    if (pl.vehicle || pl.dead || pl.swimming || Math.hypot(pl.pos.x - this.spot.x, pl.pos.z - this.spot.z) > 0.7) return this.stop('Reeled in');
    if (pl.health < this.hp - 1) return this.stop('Not now');
    this.hp = pl.health;
    pl.yaw = Math.atan2(this.dir.x, this.dir.z);
    const T = g.elapsed;
    let dip = 0;
    if (this.stage === 'wait') {
      this.t -= dt;
      // the odd nibble before the real bite
      dip = Math.sin(T * 2.1) * 0.015 + (Math.sin(T * 13) > 0.97 ? -0.04 : 0);
      g.hud.prompt('Waiting for a bite… <span style="opacity:.7">walk away to stop</span>');
      if (this.t <= 0) {
        this.stage = 'bite';
        this.t = 1.3;
        g.audio.whoosh();
        g.effects.puff(this.bob.x, WATER_Y + 0.05, this.bob.z, 'splash');
      }
    } else if (this.stage === 'bite') {
      this.t -= dt;
      dip = -0.12 + Math.sin(T * 30) * 0.05;
      g.hud.prompt('<b>Bite!</b> <kbd>T</kbd> Strike');
      if (g.input.hit('KeyT')) this.hook();
      else if (this.t <= 0) {
        this.stage = 'wait';
        this.t = 3 + Math.random() * 8;
        g.hud.toast('It took the bait and ran');
      }
    } else {
      // reeling: winding in raises the tension; the fish's runs raise it faster
      const f = this.fish;
      const hold = g.input.down('KeyT');
      this.runIn -= dt;
      if (this.runIn <= 0) {
        this.run = 0.6 + Math.random() * 0.9;
        this.runIn = this.run + 1.2 + Math.random() * 2.4 / f.str;
        g.effects.puff(this.bob.x, WATER_Y + 0.05, this.bob.z, 'splash');
      }
      const running = this.run > 0;
      if (running) this.run -= dt;
      this.tension += dt * ((hold ? 0.34 * f.str : -0.55) + (running ? 0.42 * f.str : 0));
      this.tension = Math.max(0, this.tension);
      this.progress += dt * (hold ? (running ? 0.05 : 0.2) / f.str : running ? -0.06 : -0.01);
      this.progress = Math.max(0, this.progress);
      dip = -0.1 + Math.sin(T * (running ? 24 : 9)) * 0.05;
      if (this.tension >= 1) {
        this.stop(`Snap! The ${f.per === 0 ? 'line caught on something' : f.lb > 12 ? 'big one' : 'fish'} broke the line`);
        return;
      }
      if (this.progress >= 1) return this.land();
      const bar = (v: number, c: string) => `<span style="display:inline-block;width:110px;height:8px;border-radius:4px;background:#ffffff33;vertical-align:middle;margin:0 6px"><span style="display:block;height:100%;width:${Math.round(Math.min(1, v) * 100)}%;border-radius:4px;background:${c}"></span></span>`;
      g.hud.prompt(`<kbd>T</kbd> hold to reel ${bar(this.progress, '#7dd3ff')} tension ${bar(this.tension, this.tension > 0.75 ? '#ff4b4b' : this.tension > 0.5 ? '#ffb020' : '#7dff9a')}${running ? ' <b>it’s running!</b>' : ''}`);
    }
    // the float comes in as you reel, swings about on the runs
    const out = 9 - this.progress * 7.5;
    const side = this.stage === 'reel' && this.run > 0 ? Math.sin(T * 3) * 1.2 : 0;
    this.bob.set(this.spot.x + this.dir.x * out - this.dir.z * side, WATER_Y + 0.02 + dip, this.spot.z + this.dir.z * out + this.dir.x * side);
    this.float.position.copy(this.bob);
    // the rod: held in both hands at the hip, tip up and out over the water, bending on a fish
    const fx = this.dir.x, fz = this.dir.z, rx = -fz, rz = fx;
    const hx = pl.pos.x + fx * 0.42 + rx * 0.08, hy = pl.pos.y + 1.12, hz = pl.pos.z + fz * 0.42 + rz * 0.08;
    this.rod.position.set(hx, hy, hz);
    const pitch = this.stage === 'reel' ? 0.75 + this.tension * 0.35 : 0.95;
    const up = new THREE.Vector3(fx * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch));
    this.rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const tip = new THREE.Vector3(hx, hy, hz).addScaledVector(up, 2.4);
    // the line from the tip down to the float, sagging when slack and straight when tight
    const tight = this.stage === 'reel' ? Math.min(1, 0.4 + this.tension) : 0.15;
    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 12; i++) {
      const u = i / 11;
      const sag = (1 - tight) * Math.sin(u * Math.PI) * 0.8;
      pos.setXYZ(i, tip.x + (this.bob.x - tip.x) * u, tip.y + (this.bob.y - tip.y) * u - sag, tip.z + (this.bob.z - tip.z) * u);
    }
    pos.needsUpdate = true;
  }
}

function mergeGeos(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [];
  for (let g of list) {
    if (g.index) g = g.toNonIndexed();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
