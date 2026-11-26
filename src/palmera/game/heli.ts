// The police helicopter: up at three stars, circling over you with a searchlight at night, a
// marksman in the door at four. Shoot it enough and it comes down in flames.
import * as THREE from 'three';
import { Human } from '../entities/humans';
import { groundAt, WATER_Y } from '../world/map';
import type { Game } from './game';

export class Heli {
  root = new THREE.Group();
  active = false;
  health = 900;
  private rotor: THREE.Mesh;
  private tailRotor: THREE.Mesh;
  private light: THREE.SpotLight;
  private beam: THREE.Mesh;
  private pos = new THREE.Vector3(0, 80, 0);
  private vel = new THREE.Vector3();
  private orbit = Math.random() * 6;
  private fireT = 2;
  private shooter = new Human('cop');
  private down = false;
  private downT = 0;
  private spin = 0;

  constructor(private game: Game) {
    const navy = new THREE.MeshPhysicalMaterial({ color: 0x16233f, roughness: 0.35, metalness: 0.4, clearcoat: 1 });
    const white = new THREE.MeshPhysicalMaterial({ color: 0xf2f2f0, roughness: 0.35, metalness: 0.2, clearcoat: 1 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1418, roughness: 0.05, metalness: 0.3, clearcoat: 1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.5, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), navy);
    body.scale.set(1.25, 1.15, 2.4);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45), white);
    belly.scale.set(1.27, 1.17, 2.42);
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), glass);
    canopy.scale.set(1.1, 0.8, 1.3);
    canopy.position.set(0, 0.15, 1.1);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.38, 5, 10), navy);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0.35, -3.8);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.9), navy);
    fin.position.set(0, 1.0, -6.1);
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), navy);
    stab.position.set(0, 0.4, -5.6);
    for (const x of [-0.85, 0.85]) {
      const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.6, 8), dark);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(x, -1.45, 0.1);
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.5, 0.07), dark);
      strut.position.set(x, -1.2, 0.8);
      const strut2 = strut.clone();
      strut2.position.z = -0.6;
      this.root.add(skid, strut, strut2);
    }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.5, 8), dark);
    mast.position.set(0, 1.35, 0);
    // rotor: blades plus a blurred disc
    const rg = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.04, 5.2), dark);
      blade.position.z = 2.6;
      const arm = new THREE.Group();
      arm.rotation.y = (i / 4) * Math.PI * 2;
      arm.add(blade);
      rg.add(arm);
    }
    const disc = new THREE.Mesh(new THREE.CircleGeometry(5.2, 40), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    disc.rotation.x = -Math.PI / 2;
    rg.add(disc);
    this.rotor = rg as unknown as THREE.Mesh;
    rg.position.set(0, 1.62, 0);
    const tr = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.3, 0.12), dark);
      b.rotation.x = i * Math.PI / 2;
      tr.add(b);
    }
    tr.position.set(0.18, 1.0, -6.2);
    this.tailRotor = tr as unknown as THREE.Mesh;
    // "POLICE" on the boom
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.font = 'bold 44px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('POLICE', 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    for (const sx of [-1, 1]) {
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      lab.position.set(sx * 1.27, 0.1, -0.2);
      lab.rotation.y = sx * Math.PI / 2;
      this.root.add(lab);
    }
    this.root.add(body, belly, canopy, boom, fin, stab, mast, rg, tr);
    this.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    // the searchlight
    this.light = new THREE.SpotLight(0xf4f6ff, 0, 140, 0.13, 0.5, 1.2);
    this.light.position.set(0, -1.2, 1.5);
    this.root.add(this.light);
    game.scene.add(this.light.target);
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(4.5, 1, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xe8eeff, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    game.scene.add(this.beam);
    this.root.visible = false;
    game.scene.add(this.root);
    this.shooter.weapon = 'rifle';
  }

  /** ray against the helicopter (a sphere), for the bullets */
  hit(o: THREE.Vector3, d: THREE.Vector3, maxT: number): number | null {
    if (!this.active || this.down) return null;
    const c = this.pos;
    const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const cc = ox * ox + oy * oy + oz * oz - 2.6 * 2.6;
    const disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < maxT ? t : null;
  }

  damage(n: number) {
    if (this.down) return;
    this.health -= n;
    if (this.health <= 0) {
      this.down = true;
      this.downT = 0;
      this.game.effects.explosion(this.pos.x, this.pos.y, this.pos.z);
      this.game.audio.explosion(this.game.camera.position.distanceTo(this.pos));
      this.game.hud.toast('Police chopper down');
    }
  }

  update(dt: number, t: number) {
    const g = this.game;
    const want = g.wanted.level >= 3;
    if (want && !this.active) {
      // in from out of sight
      this.active = true;
      this.down = false;
      this.health = 900;
      const a = Math.random() * Math.PI * 2;
      this.pos.set(g.player.pos.x + Math.cos(a) * 260, 90, g.player.pos.z + Math.sin(a) * 260);
      this.vel.set(0, 0, 0);
      this.root.visible = true;
      g.hud.toast('Police helicopter inbound');
    }
    if (!this.active) {
      g.audio.setRotor(0);
      this.light.intensity = 0;
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0;
      return;
    }
    const target = g.wanted.level > 0 ? g.wanted.lastKnown : g.player.pos;
    if (this.down) {
      // spinning down, smoking, then a blast where it lands
      this.downT += dt;
      this.spin += dt * 6;
      this.vel.y -= 9.81 * dt;
      this.pos.addScaledVector(this.vel, dt);
      g.effects.fire(this.pos.x, this.pos.y + 0.5, this.pos.z);
      g.effects.puff(this.pos.x, this.pos.y, this.pos.z, 'dark');
      const gy = Math.max(groundAt(this.pos.x, this.pos.z), WATER_Y);
      if (this.pos.y < gy + 1) {
        g.blast(this.pos.clone().setY(gy), 10, 160, g.player);
        this.active = false;
        this.root.visible = false;
      }
    } else if (!want) {
      // leave: climb away
      this.vel.lerp(new THREE.Vector3(30, 8, 0), dt * 0.5);
      this.pos.addScaledVector(this.vel, dt);
      if (this.pos.distanceTo(g.player.pos) > 330) {
        this.active = false;
        this.root.visible = false;
      }
    } else {
      // orbit the last place you were seen
      this.orbit += dt * 0.22;
      const r = 42, h = 34;
      const goal = new THREE.Vector3(target.x + Math.cos(this.orbit) * r, Math.max(groundAt(target.x, target.z), WATER_Y) + h, target.z + Math.sin(this.orbit) * r);
      const to = goal.sub(this.pos);
      const dist = to.length();
      const sp = Math.min(38, dist * 0.6);
      this.vel.lerp(to.normalize().multiplyScalar(sp), Math.min(1, dt * 1.2));
      this.pos.addScaledVector(this.vel, dt);
      // the marksman (four stars and up)
      this.fireT -= dt;
      if (g.wanted.level >= 4 && this.fireT <= 0 && !g.player.dead) {
        this.fireT = 1.1 + Math.random() * 0.8;
        this.shooter.pos.copy(this.pos).add(new THREE.Vector3(0, -2.4, 0));
        const aim = g.player.vehicle ? g.player.vehicle.pos : g.player.pos;
        this.shooter.yaw = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
        g.weapons.npcFire(this.shooter, aim.clone().add(new THREE.Vector3(0, 1, 0)), 0.35);
      }
    }
    // pose: nose into the flight, banked into turns
    const fwd = Math.atan2(this.vel.x, this.vel.z);
    const look = this.down ? this.spin : Math.atan2(target.x - this.pos.x, target.z - this.pos.z) * 0.4 + fwd * 0.6;
    this.root.position.copy(this.pos);
    this.root.rotation.set(Math.min(0.3, this.vel.length() * 0.008), look, Math.sin(this.orbit) * 0.12, 'YXZ');
    (this.rotor as unknown as THREE.Group).rotation.y += dt * 38;
    (this.tailRotor as unknown as THREE.Group).rotation.x += dt * 60;
    g.audio.setRotor(Math.max(0, 1 - this.pos.distanceTo(g.camera.position) / 260));
    // searchlight when it's dark
    const night = g.sky.night;
    this.light.intensity = night > 0.2 && !this.down ? 900 * night : 0;
    this.light.target.position.copy(target);
    const beamOn = night > 0.2 && !this.down;
    const bm = this.beam.material as THREE.MeshBasicMaterial;
    bm.opacity = beamOn ? 0.07 * night : 0;
    if (beamOn) {
      const from = this.light.getWorldPosition(new THREE.Vector3());
      const L = from.distanceTo(target);
      this.beam.position.copy(from).lerp(target, 0.5);
      this.beam.scale.set(1, L, 1);
      this.beam.lookAt(target);
      this.beam.rotateX(-Math.PI / 2);
    }
    void t;
  }
}
