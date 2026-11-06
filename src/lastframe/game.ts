import * as THREE from 'three';
import type { PeopleKit } from '../people/Humans.ts';
import { Planar, Post } from './post.ts';
import { loadVolume, loadWorld, type Loaded } from './world.ts';
import { LF } from './lighting.ts';
import { Fx } from './fx.ts';
import { Sound } from './audio.ts';
import { Nav } from './nav.ts';
import { Match, type BodyState } from './match.ts';
import { Input, LocalPlayer, type PlayerCtx } from './player.ts';
import { Soldier, angleDiff, loadGuns, preparePeople, ragWorld } from './soldier.ts';
import { stepNade, type NadeSim } from './nade.ts';
import { F, STRIDE, WEAPONS, WEAPON_LIST, ZONE_NAME, type Ev, type MatchConfig, type NadeKind, type Phase, type PlayerInfo, type Req, type WeaponId } from './shared.ts';
import { Guest_, Host, type Down } from './net.ts';
import { Hud } from './ui.ts';
import type { Body } from './hitbox.ts';

interface Snap { t: number; x: number; y: number; z: number; yaw: number; pitch: number; lean: number; flags: number; w: number }

class Actor {
  soldier: Soldier | null = null;
  buf: Snap[] = [];
  x = 0;
  y = -50;
  z = 0;
  yaw = 0;
  pitch = 0;
  lean = 0;
  flags = 0;
  w = 0;
  speed = 0;
  moveYaw = 0;
  step = 0;
  /** corpse stays where it fell */
  deadAt = -1;
  constructor(public info: PlayerInfo) {}
}

export type Role = 'solo' | 'host' | 'guest';

const CAM_STEP = 1 / 30;

export class Game {
  readonly r: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly cam = new THREE.PerspectiveCamera(84, 16 / 9, 0.045, 900);
  readonly post: Post;
  readonly planar: Planar;
  readonly sound = new Sound();
  readonly hud: Hud;
  L!: Loaded;
  kit!: PeopleKit;
  fx!: Fx;
  nav!: Nav;
  input: Input;
  me = new LocalPlayer();
  mySlot = -1;
  match: Match | null = null;
  role: Role = 'solo';
  host: Host | null = null;
  guest: Guest_ | null = null;
  actors = new Map<number, Actor>();
  phase: Phase = 'warmup';
  clock = 0;
  score: [number, number] = [0, 0];
  round = 1;
  cfg: MatchConfig | null = null;
  inMatch = false;
  private mySoldier: Soldier | null = null;
  private spot: THREE.SpotLight;
  private others: THREE.SpotLight[] = [];
  private flashPoint: THREE.PointLight;
  private flashK = 0;
  private time = 0;
  private last = performance.now();
  private netT = 0;
  private dead = -1;
  private deadFrom = new THREE.Vector3();
  private killYaw = 0;
  private killer = '';
  private frozen = false;
  private whiteout = 0;
  private hurt = 0;
  private nades: (NadeSim & { id: number; kind: NadeKind; mesh: THREE.Mesh; left: number })[] = [];
  private nadeGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.1, 10);
  private nadeMat = new THREE.MeshStandardMaterial({ color: 0x2a3026, roughness: 0.6 });
  private attract = 0;
  private scale = 1;
  private fpsAcc = 0;
  private fpsN = 0;
  private bodyList: [number, Body][] = [];
  private tmp = new THREE.Vector3();
  private spect = -1;
  private spectT = 0;
  private pending: { p: [number, number, number]; yaw: number; primary: WeaponId } | null = null;
  private lastPos = new Map<number, THREE.Vector3>();
  quality = 1;
  holdZone = 0;

  constructor(canvas: HTMLCanvasElement) {
    const r = (this.r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(1);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.post = new Post(r);
    this.planar = new Planar(r);
    this.hud = new Hud(this);
    this.input = new Input(canvas, () => document.pointerLockElement === canvas || this.autoInput);
    // the flashlight: the one light in the map that casts a live shadow
    const s = (this.spot = new THREE.SpotLight(0xfff0dc, 0, 36, 0.66, 1, 1.6));
    s.castShadow = true;
    s.shadow.mapSize.set(1024, 1024);
    s.shadow.camera.near = 0.25;
    s.shadow.camera.far = 34;
    s.shadow.bias = -0.0006;
    s.shadow.normalBias = 0.02;
    this.scene.add(s, s.target);
    for (let i = 0; i < 2; i++) {
      const o = new THREE.SpotLight(0xfff0dc, 0, 24, 0.6, 1, 1.6);
      this.others.push(o);
      this.scene.add(o, o.target);
    }
    this.flashPoint = new THREE.PointLight(0xffc08a, 0, 13, 1.8);
    this.scene.add(this.flashPoint);
  }

  /** test tools drive the game without pointer lock */
  autoInput = false;

  async load(progress: (f: number, what: string) => void) {
    await loadVolume();
    const [L, kit] = await Promise.all([loadWorld(this.r, progress), preparePeople(), loadGuns()]);
    this.L = L;
    ragWorld.w = L.world;
    this.kit = kit as PeopleKit;
    this.scene.add(L.group);
    L.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m.material as THREE.Material).transparent) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const roofs: THREE.Vector4[] = L.map.zones.map((z) => new THREE.Vector4(z.a[0], z.a[2], z.b[0], z.b[2]));
    this.fx = new Fx(roofs);
    this.fx.groundAt = (x, y, z) => L.world.floorAt(x, y, z, 0.01);
    this.fx.onShellTink = (x, y, z) => this.sound.tink(this.tmp.set(x, y, z));
    this.scene.add(this.fx.group);
    progress(0.95, 'Paths');
    const seeds = [...L.map.spawns.a, ...L.map.spawns.b, ...L.map.spawns.ffa];
    this.nav = new Nav(L.world, seeds, (x, y, z) => this.zone(x, y, z) !== 'street');
    addEventListener('resize', () => this.resize());
    this.resize();
    await this.warm();
    progress(1, 'Ready');
    this.attract = 0.001;
    requestAnimationFrame(this.loop);
  }

  /** first-use shaders stall a frame for seconds: pay for them behind the loader */
  private async warm() {
    const s = new Soldier(this.kit, 0, 0), t = new Soldier(this.kit, 1, 1);
    s.setWeapon('carbine');
    t.setWeapon('shotgun');
    this.scene.add(s.root, t.root);
    s.update(0.016, 40, 0, -5, 0, 0, 0, F.alive, 0, 0);
    t.update(0.016, 41, 0, -5, 0, 0, 0, F.alive, 0, 0);
    this.cam.position.set(40, 1.6, -8);
    this.cam.updateMatrixWorld();
    this.spot.intensity = 0.01;
    this.others[0].intensity = 0.01;
    this.flashPoint.intensity = 0.01;
    this.r.compile(this.scene, this.cam);
    this.post.render(this.scene, this.cam, 0.016, 0);
    await new Promise((r) => setTimeout(r));
    s.dispose();
    t.dispose();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const k = Math.min(1, 1600 / (w * dpr)) * dpr * this.scale * this.quality;
    this.post.msaa = this.scale >= 0.95 ? 2 : 0;
    this.r.setSize(w, h, false);
    this.r.domElement.style.width = '100%';
    this.r.domElement.style.height = '100%';
    this.r.setSize(Math.round(w * k), Math.round(h * k), false);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.post.resize(Math.round(w * k), Math.round(h * k));
    this.planar.resize(Math.round(w * k), Math.round(h * k));
  }

  zone(x: number, y: number, z: number): 'street' | 'small' | 'hall' {
    for (const q of this.L.map.zones) {
      if (x > q.a[0] && x < q.b[0] && z > q.a[2] && z < q.b[2] && y < q.b[1]) return q.kind === 'hall' ? 'hall' : 'small';
    }
    return 'street';
  }

  surfaceAt(x: number, y: number, z: number): string {
    const k = this.zone(x, y + 1, z);
    if (y > 2.6 && y < 3.4 && (k === 'hall' || k === 'street')) return 'metal';
    if (k === 'street') return y < -0.05 ? 'wet' : 'grit';
    return k === 'small' ? (Math.floor((x + z) * 0.11) % 2 ? 'wood' : 'hard') : 'hard';
  }

  // ------------------------------------------------------------------ sessions
  startSolo(cfg: MatchConfig, name: string, team: number, primary: WeaponId) {
    this.role = 'solo';
    this.begin(cfg);
    const p = this.match!.addHuman('me', name, team, primary);
    this.mySlot = p.slot;
    this.match!.start();
  }

  /** host side: lobby is in ui.ts; here the match starts */
  startHosted(host: Host, cfg: MatchConfig, humans: { id: string; name: string; team: number; primary: WeaponId }[]) {
    this.role = 'host';
    this.host = host;
    this.begin(cfg);
    for (const h of humans) {
      const p = this.match!.addHuman(h.id, h.name, h.team, h.primary);
      if (h.id === 'me') this.mySlot = p.slot;
    }
    this.match!.fillBots();
    host.all({ t: 'start', cfg, players: this.match!.players });
    host.onReq = (from, m) => {
      if (m.t === 'hello') return this.lateJoin(from, m.name, m.primary);
      const p = this.match?.players.find((q) => q.id === from);
      if (p) this.match!.handle(p.slot, m);
    };
    host.onState = (from, s) => {
      const p = this.match?.players.find((q) => q.id === from);
      if (p) this.remoteState(s, p.slot);
    };
    host.onLeave = (id) => this.match?.removeHuman(id);
    this.match!.start();
  }

  /** someone arrives by invite link in the middle of a match */
  private lateJoin(id: string, name: string, primary: WeaponId) {
    const m = this.match, h = this.host;
    if (!m || !h) return;
    const count = [0, 1].map((t) => m.players.filter((p) => p.team === t && !p.bot).length);
    const team = count[0] <= count[1] ? 0 : 1;
    m.dropBot(team);
    const p = m.addHuman(id, name.slice(0, 14) || 'Guest', team, primary);
    h.send(id, { t: 'welcome', slot: p.slot, cfg: m.cfg, players: m.players, inGame: true, code: h.code });
    h.send(id, { t: 'start', cfg: m.cfg, players: m.players });
    m.emit({ t: 'roster', players: m.players });
    m.emit({ t: 'phase', phase: m.phase, round: m.round, clock: m.clock, score: m.score, hold: m.holdZone });
    window.setTimeout(() => m.joinNow(p), 600);
  }

  /** same teams, same rules, from the top */
  rematch() {
    const m = this.match;
    if (!m || !this.cfg) return;
    const humans = m.players.filter((p) => !p.bot).map((p) => ({ id: p.id, name: p.name, team: p.team, primary: p.primary }));
    const cfg = { ...this.cfg, seed: Math.floor(Math.random() * 1000) };
    if (this.role === 'solo') {
      const me = humans[0];
      this.startSolo(cfg, me.name, me.team, me.primary);
    } else if (this.host) this.startHosted(this.host, cfg, humans);
  }

  startGuest(guest: Guest_, cfg: MatchConfig, players: PlayerInfo[], slot: number) {
    this.role = 'guest';
    this.guest = guest;
    this.begin(cfg);
    this.mySlot = slot;
    this.roster(players);
    guest.onDown = (m: Down) => {
      if (m.t === 'ev') this.onEv(m.e);
      else if (m.t === 'end') this.leave();
      else if (m.t === 'start') {
        // the host called a rematch
        const me = m.players.find((p) => p.id === guest.peer.id);
        this.startGuest(guest, m.cfg, m.players, me?.slot ?? slot);
      }
    };
    guest.onState = (s) => this.remoteState(s, -1);
    guest.onClose = (why) => {
      this.leave();
      this.hud.toast(why || 'Room closed');
    };
  }

  private begin(cfg: MatchConfig) {
    this.cfg = cfg;
    this.inMatch = true;
    this.attract = 0;
    this.score = [0, 0];
    this.round = 1;
    this.dead = -1;
    this.frozen = false;
    for (const a of this.actors.values()) a.soldier?.dispose();
    this.actors.clear();
    this.mySoldier = null;
    for (const d of this.L.doors) d.toggle(null, 0);
    for (const p of this.L.panes) {
      p.broken = false;
      p.box.off = false;
      p.mesh.visible = true;
    }
    if (this.role !== 'guest') {
      this.match = new Match(cfg, this.L.world, this.L.map, this.L.doors, this.L.panes, this.nav, (e) => {
        this.onEv(e);
        this.host?.all({ t: 'ev', e });
      });
    }
    this.hud.enter();
    this.sound.start();
    if (!document.pointerLockElement) this.lock();
  }

  lock() {
    if (this.autoInput) return;
    // refused without a click (a guest's match starts by itself), or too soon after Esc
    const p = this.r.domElement.requestPointerLock?.() as unknown as Promise<void> | undefined;
    p?.catch?.(() => this.hud.pause());
  }

  leave() {
    this.host?.close();
    this.guest?.close();
    this.host = null;
    this.guest = null;
    this.match = null;
    this.inMatch = false;
    this.me.alive = false;
    this.mySlot = -1;
    for (const a of this.actors.values()) a.soldier?.dispose();
    this.actors.clear();
    this.mySoldier = null;
    this.frozen = false;
    this.dead = -1;
    this.attract = 0.001;
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.leave();
  }

  private req(r: Req) {
    if (this.role === 'guest') this.guest?.send(r);
    else this.match?.handle(this.mySlot, r);
  }

  private actor(p: PlayerInfo): Actor {
    let a = this.actors.get(p.slot);
    if (!a) {
      a = new Actor(p);
      this.actors.set(p.slot, a);
    }
    a.info = p;
    return a;
  }

  private body(a: Actor): Soldier {
    if (!a.soldier || a.soldier.team !== Math.min(1, a.info.team === 2 ? a.info.slot % 2 : a.info.team)) {
      a.soldier?.dispose();
      const team = a.info.team === 2 ? a.info.slot % 2 : a.info.team;
      a.soldier = new Soldier(this.kit, team, a.info.slot);
      this.scene.add(a.soldier.root);
      if (a.info.slot === this.mySlot) {
        a.soldier.setFirstPerson(true);
        this.mySoldier = a.soldier;
      }
    }
    return a.soldier;
  }

  private roster(list: PlayerInfo[]) {
    const seen = new Set<number>();
    for (const p of list) {
      seen.add(p.slot);
      this.actor(p);
    }
    for (const [s, a] of this.actors) {
      if (!seen.has(s)) {
        a.soldier?.dispose();
        this.actors.delete(s);
      }
    }
    this.hud.board(list);
  }

  // ------------------------------------------------------------------ events
  private onEv(e: Ev) {
    switch (e.t) {
      case 'roster':
        this.roster(e.players);
        break;
      case 'spawn': {
        const a = this.actors.get(e.s);
        if (!a) break;
        a.info.alive = true;
        a.info.hp = 100;
        a.info.primary = e.primary;
        a.x = e.p[0];
        a.y = e.p[1];
        a.z = e.p[2];
        a.yaw = e.yaw;
        a.flags = F.alive;
        a.buf.length = 0;
        a.deadAt = -1;
        a.w = WEAPON_LIST.indexOf(e.primary);
        const s = this.body(a);
        s.revive();
        s.setWeapon(e.primary);
        s.root.visible = true;
        if (e.s === this.mySlot) {
          this.me.slot = e.s;
          this.me.spawn(e.p[0], e.p[1], e.p[2], e.yaw, e.primary);
          this.dead = -1;
          this.frozen = false;
          this.spect = -1;
          this.mySoldier?.setFirstPerson(true);
          this.post.cutExposure = true;
          this.hud.alive();
          this.sound.beep();
        }
        break;
      }
      case 'shot': {
        if (e.s === this.mySlot) {
          this.landShots(e, false);
          break;
        }
        const a = this.actors.get(e.s);
        const muz = this.tmp.set(e.o[0], e.o[1], e.o[2]).clone();
        if (a?.soldier) {
          a.soldier.muzzle(muz);
          a.soldier.kick = 1;
          const dir = new THREE.Vector3(e.e[0] - muz.x, e.e[1] - muz.y, e.e[2] - muz.z).normalize();
          const id = WEAPON_LIST[e.w];
          this.fx.muzzle(muz, dir, id === 'pistol' ? 0.7 : id === 'carbine' ? 1 : 1.5);
          const dist = this.cam.position.distanceTo(muz);
          if (dist < 34) this.muzzleLight(muz);
          this.fx.tracerLine(muz, e.e[0], e.e[1], e.e[2]);
          // a round past the ear
          const ab = new THREE.Vector3(e.e[0], e.e[1], e.e[2]).sub(muz);
          const t = THREE.MathUtils.clamp(this.cam.position.clone().sub(muz).dot(ab) / ab.lengthSq(), 0, 1);
          if (muz.clone().addScaledVector(ab, t).distanceTo(this.cam.position) < 1.1 && t > 0.05 && t < 0.98) this.sound.snap(this.cam.position.clone().add(new THREE.Vector3(0.4, 0, 0)));
        }
        const muffled = !this.L.world.sees(this.cam.position, muz);
        this.sound.shot(e.w, muz, muffled);
        this.landShots(e, true);
        break;
      }
      case 'hit': {
        const a = this.actors.get(e.s);
        if (a) a.info.hp = e.hp;
        if (e.s === this.mySlot) {
          this.hurt = Math.min(1, this.hurt + 0.42 + e.dmg / 90);
          this.me.hurt(e.dir);
          this.sound.hurt();
          this.hud.damage(e.dir, this.cam, e.hp);
        } else if (e.by === this.mySlot) this.hud.hitTick(false);
        break;
      }
      case 'die': {
        const a = this.actors.get(e.s);
        if (!a) break;
        a.info.alive = false;
        a.flags &= ~F.alive;
        a.deadAt = this.time;
        const d = new THREE.Vector3(...e.dir);
        const s = a.soldier;
        if (s) {
          s.kill(d);
          this.fx.blood(a.x, a.y + 1.2, a.z, d.x, d.y, d.z);
        }
        const by = this.actors.get(e.by);
        this.hud.feed(by?.info.name ?? '?', a.info.name, e.w, e.zone, by?.info.team ?? 2, a.info.team, e.by === this.mySlot || e.s === this.mySlot);
        if (e.by === this.mySlot && e.s !== this.mySlot) {
          this.hud.hitTick(true);
          this.hud.killed(a.info.name, e.zone, e.dist);
        }
        if (e.s === this.mySlot) {
          this.me.alive = false;
          this.dead = 0;
          this.deadFrom.set(a.x, a.y, a.z);
          this.killYaw = Math.atan2(e.dir[0], e.dir[2]);
          this.killer = by && e.by !== e.s ? by.info.name : 'yourself';
          this.hud.down(this.killer, ZONE_NAME[e.zone], e.dist, e.w, this.cfg?.mode === 'rounds');
          this.sound.deafen(1.2);
        }
        break;
      }
      case 'door': {
        const d = this.L.doors[e.i];
        if (d) {
          const was = d.want > 0;
          d.toggle(null, e.open ? e.dir : 0);
          if (was !== e.open > 0) this.sound.door(d.centre, e.open > 0);
        }
        break;
      }
      case 'pane': {
        const p = this.L.panes[e.i];
        if (p && !p.broken) {
          p.broken = true;
          p.box.off = true;
          p.mesh.visible = false;
          const c = p.mesh.position;
          this.fx.impact(c.x, c.y, c.z, 0, 0, 0, 'glass');
          this.sound.impact(c, 'glass');
        }
        break;
      }
      case 'nade': {
        const mesh = new THREE.Mesh(this.nadeGeo, this.nadeMat);
        this.scene.add(mesh);
        this.nades.push({ id: e.id, kind: e.kind, x: e.o[0], y: e.o[1], z: e.o[2], vx: e.v[0], vy: e.v[1], vz: e.v[2], rest: false, mesh, left: e.fuse });
        break;
      }
      case 'boom': {
        const i = this.nades.findIndex((n) => n.id === e.id);
        if (i >= 0) {
          this.scene.remove(this.nades[i].mesh);
          this.nades.splice(i, 1);
        }
        const p = new THREE.Vector3(...e.p);
        this.fx.burst(p, e.kind);
        this.sound.boom(p, e.kind === 'flash');
        this.muzzleLight(p, 30);
        const d = this.cam.position.distanceTo(p);
        if (this.me.alive) {
          const sees = this.L.world.sees(this.cam.position, p.clone().setY(p.y + 0.2));
          if (e.kind === 'flash' && d < 22 && sees) {
            const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion);
            const facing = f.dot(p.clone().sub(this.cam.position).normalize());
            this.whiteout = Math.max(this.whiteout, THREE.MathUtils.clamp((1 - d / 22) * (0.5 + facing * 0.9) * 2.4, 0.15, 2.4));
            this.sound.deafen(1.6 + this.whiteout);
          } else if (d < 9) this.sound.deafen(0.9);
        }
        break;
      }
      case 'phase':
        this.phase = e.phase;
        this.clock = e.clock;
        this.score = [e.score[0], e.score[1]];
        this.round = e.round;
        if (e.hold !== undefined) this.holdZone = e.hold;
        this.hud.phase(e);
        break;
      case 'hold':
        this.score = [e.score[0], e.score[1]];
        this.hud.hold(e);
        break;
      case 'chat':
        this.hud.chat(e.from, e.text);
        break;
    }
  }

  private landShots(e: Extract<Ev, { t: 'shot' }>, sounds: boolean) {
    for (let i = 0; i < e.surf.length; i++) {
      const o = i * 6;
      const s = e.surf[i];
      if (!s) continue;
      this.fx.impact(e.e[o], e.e[o + 1], e.e[o + 2], e.e[o + 3], e.e[o + 4], e.e[o + 5], s);
      if (s === 'flesh') this.fx.blood(e.e[o], e.e[o + 1], e.e[o + 2], -e.e[o + 3], -e.e[o + 4], -e.e[o + 5]);
      if (i === e.surf.length - 1 || sounds) this.sound.impact(this.tmp.set(e.e[o], e.e[o + 1], e.e[o + 2]), s);
    }
  }

  muzzleLight(p: THREE.Vector3, k = 7) {
    this.flashPoint.position.copy(p);
    this.flashK = k;
  }

  // ------------------------------------------------------------------ net state
  private remoteState(s: Float32Array, only: number) {
    const now = performance.now() / 1000;
    for (let o = 0; o + STRIDE <= s.length; o += STRIDE) {
      const slot = only >= 0 ? only : s[o];
      if (slot === this.mySlot) continue;
      const a = this.actors.get(slot);
      if (!a) continue;
      a.buf.push({ t: now, x: s[o + 1], y: s[o + 2], z: s[o + 3], yaw: s[o + 4], pitch: s[o + 5], lean: s[o + 6], flags: s[o + 7], w: s[o + 8] });
      if (a.buf.length > 12) a.buf.shift();
      if (only >= 0 && this.match) {
        const b = this.match.bodies[slot];
        if (b) Object.assign(b, { x: s[o + 1], y: s[o + 2], z: s[o + 3], yaw: s[o + 4], pitch: s[o + 5], lean: s[o + 6], crouch: (s[o + 7] & F.crouch) !== 0, flags: s[o + 7], w: s[o + 8] });
      }
    }
  }

  private sendState() {
    const me = this.me;
    if (this.role === 'guest') {
      const b = new Float32Array(STRIDE);
      const lean = me.leanK;
      b.set([this.mySlot, me.m.x, me.m.y, me.m.z, me.yaw, me.pitch, lean, me.alive ? me.flags() : 0, WEAPON_LIST.indexOf(me.weapon), 0]);
      this.guest?.state(b);
    } else if (this.role === 'host' && this.match) {
      const ps = this.match.players;
      const b = new Float32Array(ps.length * STRIDE);
      ps.forEach((p, i) => {
        const s = this.match!.bodies[p.slot];
        b.set([p.slot, s.x, s.y, s.z, s.yaw, s.pitch, s.lean, s.flags, s.w, 0], i * STRIDE);
      });
      this.host?.states(b);
    }
  }

  private* bodies(): Iterable<[number, Body]> {
    for (const [s, a] of this.actors) {
      if (!a.info.alive || s === this.mySlot) continue;
      yield [s, { x: a.x, y: a.y, z: a.z, yaw: a.yaw, lean: a.lean, crouch: (a.flags & F.crouch) !== 0 }];
    }
  }

  private ctx: PlayerCtx = {
    world: null as never, sound: this.sound, fx: null as never, doors: [],
    bodies: () => this.bodies(),
    surfaceAt: (x, y, z) => this.surfaceAt(x, y, z),
    send: {
      shot: (w, o, e, surf) => this.req({ t: 'shot', w, o, e, surf }),
      hit: (to, dmg, zone, w, dir, dist) => this.req({ t: 'hit', to, dmg, zone, w, dir, dist }),
      door: (i, from) => this.req({ t: 'door', i, from }),
      pane: (i) => this.req({ t: 'pane', i }),
      nade: (kind, o, v, fuse) => this.req({ t: 'nade', kind, o, v, fuse }),
    },
    muzzleLight: (p) => this.muzzleLight(p),
    prompt: (s) => this.hud.prompt(s),
    hitMark: () => {},
  };

  // ------------------------------------------------------------------ the frame
  /** bench tools stop the loop and call tick themselves */
  halt = false;
  private loop = () => {
    requestAnimationFrame(this.loop);
    if (this.halt) return;
    const n = performance.now();
    const raw = (n - this.last) / 1000;
    const dt = Math.min(0.05, raw);
    this.last = n;
    this.time += dt;
    this.govern(raw);
    this.tick(dt);
    (window as unknown as { __frames: number }).__frames = ((window as unknown as { __frames: number }).__frames | 0) + 1;
  };

  private govern(raw: number) {
    this.fpsAcc += raw;
    this.fpsN++;
    if (this.fpsAcc < 1.6) return;
    const fps = this.fpsN / this.fpsAcc;
    this.fpsAcc = 0;
    this.fpsN = 0;
    this.hud.fps(fps);
    if (this.autoInput) return;
    const was = this.scale;
    if (fps < 50) this.scale = Math.max(0.55, this.scale * Math.max(0.82, Math.sqrt(fps / 58)));
    else if (fps > 59 && this.scale < 1) this.scale = Math.min(1, this.scale * 1.05);
    if (Math.abs(was - this.scale) > 0.02) this.resize();
  }

  tick(dt: number) {
    const L = this.L;
    this.ctx.world = L.world;
    this.ctx.fx = this.fx;
    this.ctx.doors = L.doors;
    LF.time.value = this.time;
    this.clock -= dt;
    for (const d of L.doors) d.update(dt);
    this.match?.update(dt);
    if (this.attract > 0) this.attractCam(dt);
    // ---- me
    const me = this.me;
    const mine = this.actors.get(this.mySlot);
    if (this.inMatch && mine) {
      if (me.alive) {
        const sol = this.body(mine);
        const freeze = this.phase === 'warmup' && this.cfg?.mode === 'rounds' || this.phase === 'over';
        me.update(dt, this.input, this.ctx, this.cam, sol, freeze);
        mine.x = me.m.x;
        mine.y = me.m.y;
        mine.z = me.m.z;
        mine.yaw = me.yaw;
        mine.pitch = me.pitch;
        mine.lean = me.leanK;
        mine.flags = me.flags();
        const v = Math.hypot(me.m.vx, me.m.vz);
        sol.setWeapon(me.weapon);
        sol.update(dt, me.m.x, me.m.y, me.m.z, me.yaw, me.pitch, me.leanK, mine.flags, v, Math.atan2(-me.m.vx, -me.m.vz));
        const b = this.match?.bodies[this.mySlot];
        if (b) Object.assign(b, { x: me.m.x, y: me.m.y, z: me.m.z, yaw: me.yaw, pitch: me.pitch, lean: me.leanK, crouch: me.crouch, flags: mine.flags, w: WEAPON_LIST.indexOf(me.weapon) });
      } else if (this.dead >= 0) this.deadCam(dt, mine);
      this.input.take('Tab');
      this.hud.scoreboard(this.input.keys.has('Tab'));
    }
    this.input.endFrame();
    // ---- everyone else
    const now = performance.now() / 1000 - 0.1;
    for (const [s, a] of this.actors) {
      if (s === this.mySlot && me.alive) continue;
      if (s === this.mySlot && this.dead >= 0) {
        a.soldier?.update(dt, a.x, a.y, a.z, a.yaw, a.pitch, 0, a.flags, 0, 0);
        continue;
      }
      this.moveActor(a, s, dt, now);
    }
    this.lights(dt);
    this.fxNades(dt);
    this.fx.update(dt, this.time, this.cam, this.zone(this.cam.position.x, this.cam.position.y, this.cam.position.z) !== 'street');
    this.netT += dt;
    if (this.netT >= CAM_STEP && this.inMatch) {
      this.netT = 0;
      this.sendState();
    }
    this.sound.listen(this.cam, this.zone(this.cam.position.x, this.cam.position.y, this.cam.position.z));
    // ---- post values
    const u = this.post.mFinal.uniforms;
    this.whiteout = Math.max(0, this.whiteout - dt * 0.75);
    this.hurt = Math.max(0, this.hurt - dt * 0.34);
    const hp = mine?.info.hp ?? 100;
    u.whiteout.value = Math.min(1.4, this.whiteout);
    u.hurt.value = Math.min(1, this.hurt * 0.7 + (me.alive ? Math.max(0, (45 - hp) / 45) * 0.5 : 0.35));
    u.fish.value = THREE.MathUtils.lerp(0.85, 0.3, me.alive ? me.adsK : 0);
    if (this.dead >= 0) {
      u.glitch.value = this.dead > 2.0 ? Math.min(1, (this.dead - 2.0) * 1.8) : 0;
    } else u.glitch.value = 0;
    this.hud.update(dt);
    if (!this.frozen) {
      const out = this.zone(this.cam.position.x, this.cam.position.y, this.cam.position.z) === 'street' && this.cam.position.y < 12;
      this.planar.render(this.scene, this.cam, this.mySoldier ? [this.fx.group, this.mySoldier.root] : [this.fx.group], out);
      this.post.render(this.scene, this.cam, dt, this.time);
    }
  }

  private moveActor(a: Actor, s: number, dt: number, now: number) {
    const b = this.match?.bodies[s];
    const bot = this.match?.bots.get(s);
    const ox = a.x, oz = a.z;
    if (bot && b) {
      a.x = b.x;
      a.y = b.y;
      a.z = b.z;
      a.yaw = b.yaw;
      a.pitch = b.pitch;
      a.lean = b.lean;
      a.flags = b.flags;
      a.w = b.w;
    } else if (a.buf.length >= 2) {
      let i = a.buf.length - 1;
      while (i > 0 && a.buf[i - 1].t > now) i--;
      const p = a.buf[Math.max(0, i - 1)], q = a.buf[i];
      const k = q.t > p.t ? THREE.MathUtils.clamp((now - p.t) / (q.t - p.t), 0, 1.2) : 1;
      a.x = p.x + (q.x - p.x) * k;
      a.y = p.y + (q.y - p.y) * k;
      a.z = p.z + (q.z - p.z) * k;
      a.yaw = p.yaw + Math.atan2(Math.sin(q.yaw - p.yaw), Math.cos(q.yaw - p.yaw)) * k;
      a.pitch = p.pitch + (q.pitch - p.pitch) * k;
      a.lean = q.lean;
      a.flags = q.flags;
      a.w = q.w;
    }
    if (a.y < -20) return;
    const dx = a.x - ox, dz = a.z - oz;
    const sp = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
    a.speed += (Math.min(sp, 7) - a.speed) * Math.min(1, dt * 10);
    if (sp > 0.2) a.moveYaw = Math.atan2(-dx, -dz);
    if (!a.info.alive && a.deadAt < 0) return;
    const sol = this.body(a);
    if (a.w >= 0 && a.w < 4) sol.setWeapon(WEAPON_LIST[a.w]);
    sol.update(dt, a.x, a.y, a.z, a.yaw, a.pitch, a.lean, a.flags, a.speed, a.moveYaw);
    if (a.deadAt >= 0 && this.time - a.deadAt > 14) sol.root.visible = false;
    // their boots
    a.step += a.speed * dt;
    if (a.info.alive && a.speed > 0.6) {
      const stride = a.speed > 4 ? 1.65 : 1.25;
      if (a.step > stride) {
        a.step = 0;
        const quiet = (a.flags & F.crouch) ? 0.25 : 1;
        this.sound.step(this.tmp.set(a.x, a.y, a.z), this.surfaceAt(a.x, a.y, a.z), a.speed, quiet * 1.6);
      }
    }
  }

  private lights(dt: number) {
    const me = this.me;
    const s = this.spot;
    if (me.alive && me.light) {
      const hit = this.L.world.ray(me.lightPos.x, me.lightPos.y, me.lightPos.z, me.barrel.x, me.barrel.y, me.barrel.z, 7);
      const wantI = 30 * Math.min(1, Math.pow((hit ? hit.t : 7) / 5, 1.25) + 0.05);
      s.intensity += (wantI - s.intensity) * Math.min(1, dt * 9);
      s.position.copy(me.lightPos);
      s.target.position.copy(me.lightPos).addScaledVector(me.barrel, 5);
    } else s.intensity = 0;
    // other people's lights: the nearest three
    const lit: [number, Actor][] = [];
    for (const [k, a] of this.actors) {
      if (k === this.mySlot || !a.info.alive || !(a.flags & F.light) || !a.soldier) continue;
      lit.push([Math.hypot(a.x - this.cam.position.x, a.z - this.cam.position.z), a]);
    }
    lit.sort((p, q) => p[0] - q[0]);
    this.others.forEach((o, i) => {
      const a = lit[i]?.[1];
      if (!a) {
        o.intensity = 0;
        return;
      }
      o.intensity = 26;
      const yaw = a.yaw, cp = Math.cos(a.pitch);
      const f = this.tmp.set(-Math.sin(yaw) * cp, Math.sin(a.pitch), -Math.cos(yaw) * cp);
      o.position.set(a.x + f.x * 0.5, a.y + ((a.flags & F.crouch) ? 0.95 : 1.42), a.z + f.z * 0.5);
      o.target.position.copy(o.position).addScaledVector(f, 5);
    });
    this.flashPoint.intensity = this.flashK * 12;
    this.flashK = Math.max(0, this.flashK - dt * 110);
  }

  private fxNades(dt: number) {
    for (const n of this.nades) {
      const v = stepNade(this.L.world, n, dt);
      if (v > 1.1) this.sound.tink(this.tmp.set(n.x, n.y, n.z));
      n.mesh.position.set(n.x, n.y, n.z);
      n.mesh.rotation.x += dt * 9 * (n.rest ? 0 : 1);
      n.left -= dt;
    }
  }

  /** dropped: the camera goes down with the body and keeps recording */
  private deadCam(dt: number, mine: Actor) {
    const was = this.dead;
    this.dead += dt;
    const t = this.dead;
    const k = Math.min(1, t / 0.9);
    const e = k * k * (3 - 2 * k);
    const sol = mine.soldier;
    if (sol) this.cam.position.lerp(this.tmp.copy(sol.head).setY(Math.max(sol.head.y, mine.y + 0.1)), Math.min(1, dt * 24));
    const roll = e * 1.25 * (mine.info.slot % 2 ? 1 : -1);
    // the lens ends up turned toward whoever did it
    const face = mine.yaw + angleDiff(this.killYaw, mine.yaw) * e;
    this.cam.rotation.set(THREE.MathUtils.lerp(mine.pitch, 0.1, e), face, roll, 'YXZ');
    if (this.cam.fov !== 84) {
      this.cam.fov = 84;
      this.cam.updateProjectionMatrix();
    }
    this.cam.updateMatrixWorld();
    if (was < 2.45 && t >= 2.45) {
      this.sound.cut();
      this.hud.lost();
    }
    if (t >= 2.6) {
      this.frozen = true;
      if (this.cfg?.mode === 'rounds' && t > 5) this.spectate(dt);
    }
  }

  /** rounds: watch a teammate's feed */
  private spectate(dt: number) {
    this.spectT -= dt;
    const mates = [...this.actors.values()].filter((a) => a.info.alive && a.info.team === this.actors.get(this.mySlot)?.info.team && a.soldier);
    if (!mates.length) return;
    if (this.spect < 0 || !this.actors.get(this.spect)?.info.alive || this.input.firePressed) {
      const i = mates.findIndex((a) => a.info.slot === this.spect);
      this.spect = mates[(i + 1) % mates.length].info.slot;
      this.hud.spectating(this.actors.get(this.spect)!.info.name);
    }
    this.frozen = false;
    const a = this.actors.get(this.spect)!;
    const f = this.tmp.set(-Math.sin(a.yaw), 0, -Math.cos(a.yaw));
    this.cam.position.set(a.x + f.x * 0.16, a.y + ((a.flags & F.crouch) ? 1.08 : 1.66), a.z + f.z * 0.16);
    this.cam.rotation.set(a.pitch, a.yaw, 0, 'YXZ');
    this.cam.updateMatrixWorld();
  }

  /** behind the menu: a slow walk past the block */
  private attractCam(dt: number) {
    this.attract += dt * 0.022;
    const t = this.attract % 1;
    const a = new THREE.Vector3(36, 1.55, -6.2), b = new THREE.Vector3(58, 1.6, -7.4);
    this.cam.position.lerpVectors(a, b, 0.5 - 0.5 * Math.cos(t * Math.PI * 2));
    this.cam.position.y += Math.sin(this.time * 1.7) * 0.012;
    this.cam.rotation.set(0.02 + Math.sin(this.time * 0.6) * 0.012, -1.32 + Math.sin(this.time * 0.23) * 0.1, Math.sin(this.time * 0.9) * 0.006, 'YXZ');
    this.cam.updateMatrixWorld();
  }

  /** teammates' heads on screen, through the same lens the picture goes through */
  mates(out: { x: number; y: number; name: string }[]) {
    out.length = 0;
    const my = this.actors.get(this.mySlot);
    if (!my || !this.me.alive || this.cfg?.mode === 'ffa') return;
    const v = this.tmp;
    const aspect = this.cam.aspect;
    const T = Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2));
    const rd = Math.hypot(aspect, 1), thd = Math.atan(rd * T);
    const fish = this.post.mFinal.uniforms.fish.value as number;
    const mark = (x: number, y: number, z: number, name: string) => {
      v.set(x, y, z).project(this.cam);
      if (v.z > 1) return;
      const px = v.x * aspect, py = v.y;
      const rin = Math.hypot(px, py) || 1e-4;
      // what the final pass does, turned round: from the flat picture to the bent one
      const rho = (Math.atan(rin * T) / thd) * rd;
      const r = rin + (rho - rin) * fish;
      const k = r / rin;
      out.push({ x: 0.5 + (px * k) / (2 * aspect), y: 0.5 - (py * k) / 2, name });
    };
    for (const [s, a] of this.actors) {
      if (s === this.mySlot || !a.info.alive || a.info.team !== my.info.team) continue;
      const eye = { x: a.x, y: a.y + 1.65, z: a.z };
      if (Math.hypot(a.x - this.cam.position.x, a.z - this.cam.position.z) > 45 || !this.L.world.sees(this.cam.position, eye)) continue;
      mark(a.x, a.y + 1.95, a.z, a.info.name);
    }
    if (this.cfg?.mode === 'hold') {
      const c = this.L.map.hold[this.holdZone];
      if (c) mark(c[0], c[1] + 1.6, c[2], 'Hold');
    }
  }

  /** seconds of match left, for the HUD */
  timer() {
    return this.clock;
  }

  player(slot: number) {
    return this.actors.get(slot)?.info;
  }
  weaponName(w: number) {
    return w >= 0 ? WEAPONS[WEAPON_LIST[w]].name : 'Blast';
  }
  bodiesFor(s: number): BodyState | undefined {
    return this.match?.bodies[s];
  }
}
