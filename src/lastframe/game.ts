import * as THREE from 'three';
import { Sun, MOVER } from './sun.ts';
import type { PeopleKit } from '../people/Humans.ts';
import { Planar, Post } from './post.ts';
import { loadVolume, loadWorld, type Door, type Loaded, type MapData } from './world.ts';
import { slabGap } from './collide.ts';
import { Phys } from './physics.ts';
import { LF, applyLF } from './lighting.ts';
import { AIR, Fx } from './fx.ts';
import { Sound } from './audio.ts';
import { Nav } from './nav.ts';
import { Bot } from './bots.ts';
import { Match, type BodyState } from './match.ts';
import { Input, LocalPlayer, type PlayerCtx } from './player.ts';
import { Soldier, angleDiff, loadGear, loadGuns, preparePeople } from './soldier.ts';
import { stepNade, type NadeSim } from './nade.ts';
import { F, STRIDE, WEAPONS, WEAPON_LIST, W_BOOT, ZONE_NAME, type Ev, type MatchConfig, type NadeKind, type Phase, type PlayerInfo, type Req, type WeaponId } from './shared.ts';
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
  /** a trail behind the wounded */
  dripD = 0;
  lx = 0;
  lz = 0;
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
  phys!: Phys;
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
  /** where my beam lands, lighting the room back: a soft fill with no shadow */
  private bounce = new THREE.PointLight(0xf2ead8, 0, 8, 2);
  private bounceK = 0;
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
  private lensBlood = 0;
  /** how fast the camera is turning, for the rolling shutter */
  private lastYaw = 0;
  private lastPitch = 0;
  private turnRate = new THREE.Vector2();
  /** the storm and the building at night */
  private thunderT = 12;
  private flashes: number[] = [];
  private creakT = 9;
  private nades: (NadeSim & { id: number; kind: NadeKind; mesh: THREE.Mesh; left: number })[] = [];
  private nadeGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.1, 12);
  private nadeMat = applyLF(new THREE.MeshStandardMaterial({ color: 0x3a4036, roughness: 0.5, metalness: 0.4 }));
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
  looseGroup: THREE.Group | null = null;
  private doorHoles: THREE.Object3D[] = [];
  private lampT = 0;
  private liteK = 0;
  private wet = 1;
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
    const s = (this.spot = new THREE.SpotLight(0xfff0dc, 0, 36, 0.8, 0.2, 1.6));
    // the cookie costs a texture unit, and the daylight shaders have none to spare (the sun's maps)
    if (!LF.sunOn) s.map = beamCookie();
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
    this.scene.add(this.flashPoint, this.bounce);
  }

  sun: Sun | null = null;
  private rideM = new THREE.Matrix4();
  private rideQ = new THREE.Quaternion();
  private rideE = new THREE.Euler();
  private rideV = new THREE.Vector3();
  private rideS = new THREE.Vector3(1, 1, 1);
  /** boats on their moorings: up with the swell, leaning into it, and nodding round the buoy */
  private ride(t: number) {
    for (const f of this.L.floats) {
      f.base.forEach((b, i) => {
        const x = f.x[i], z = f.z[i], k = x * 0.07 + z * 0.05;
        const lift = Math.sin(t * 0.95 + k) * 0.13 + Math.sin(t * 1.7 + k * 2) * 0.05;
        this.rideE.set(Math.sin(t * 0.8 + k) * 0.05, f.yaw[i] + Math.sin(t * 0.13 + k) * 0.1, Math.sin(t * 1.1 + k * 1.3) * 0.075, 'YXZ');
        this.rideQ.setFromEuler(this.rideE);
        this.rideV.setFromMatrixPosition(b);
        this.rideV.y += lift;
        this.rideM.compose(this.rideV, this.rideQ, this.rideS);
        f.mesh.setMatrixAt(i, this.rideM);
      });
      f.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private flareK = 0;
  private flareV = new THREE.Vector3();
  /** where the sun falls on the frame, and whether anything stands in front of it */
  private lensFlare(dt: number) {
    const u = this.post.mFinal.uniforms.flare.value as THREE.Vector3;
    const d = LF.sunDir.value, p = this.cam.position, v = this.flareV;
    v.copy(p).addScaledVector(d, 60).project(this.cam);
    let want = 0;
    if (v.z < 1 && Math.abs(v.x) < 1.3 && Math.abs(v.y) < 1.3) {
      const clear = !this.L.world.ray(p.x, p.y, p.z, d.x, d.y, d.z, 320);
      want = clear ? 1 - Math.max(0, Math.max(Math.abs(v.x), Math.abs(v.y)) - 0.9) / 0.4 : 0;
    }
    this.flareK += (want - this.flareK) * Math.min(1, dt * 9);
    u.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5, this.flareK);
  }

  /** test tools: hold the camera somewhere else for a look */
  camHold: number[] | null = null;
  /** test tools drive the game without pointer lock */
  autoInput = false;

  async load(progress: (f: number, what: string) => void) {
    await loadVolume();
    const [L, kit, phys] = await Promise.all([loadWorld(this.r, progress), preparePeople(), Phys.create(), loadGuns(), loadGear()]);
    this.L = L;
    this.phys = phys;
    this.buildPhysics();
    this.kit = kit as PeopleKit;
    this.scene.add(L.group);
    L.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m.material as THREE.Material).transparent) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const sunInfo = L.map.weather?.sun;
    if (sunInfo) {
      const sun = (this.sun = new Sun(this.r, this.scene, sunInfo));
      const doorParts = new Set<THREE.Object3D>();
      for (const d of L.doors) d.pivot.traverse((o) => { o.layers.enable(MOVER); doorParts.add(o); });
      const glass = new Set<THREE.Object3D>(L.panes.map((p) => p.mesh));
      const lim = L.map.terrain!.limit;
      const c = new THREE.Vector3((lim[0] + lim[2]) / 2, 14, (lim[1] + lim[3]) / 2);
      sun.bake(c, Math.hypot(lim[2] - lim[0], lim[3] - lim[1]) / 2 + 26, (o) => o.name === 'sky' || o.name === 'sea' || o.name === 'grass' || doorParts.has(o) || glass.has(o) || (o as THREE.Light).isLight === true, (o) => o.name === 'veg');
    }
    // what keeps the rain off; a tunnel under open ground doesn't
    const roofs: THREE.Vector4[] = L.map.zones.filter((z) => z.b[1] > 0).map((z) => new THREE.Vector4(z.a[0], z.a[2], z.b[0], z.b[2]));
    this.fx = new Fx(roofs, phys, L.glassMat);
    const wb = L.map.weather?.wb;
    if (wb) (this.post.mFinal.uniforms.wb.value as THREE.Vector3).set(wb[0], wb[1], wb[2]);
    this.fx.rainOn = L.map.weather?.rain ?? 1;
    if (L.map.weather?.key) this.post.exposureKey = L.map.weather.key;
    if (L.map.night) {
      Bot.night = true;
      this.post.exposureMax = 3.2;
      this.post.mFinal.uniforms.satK.value = 0.74;
      this.post.mFinal.uniforms.grainK.value = 1.5;
    }
    if (sunInfo) {
      this.post.mFinal.uniforms.caK.value = 0.0085;
      this.post.mFinal.uniforms.satK.value = 0.97;
      this.sound.coast = true;
    }
    this.fx.groundAt = (x, y, z) => L.world.floorAt(x, y, z, 0.01);
    this.fx.rayAt = (x, y, z, dx, dy, dz, far) => L.world.ray(x, y, z, dx, dy, dz, far, true);
    this.fx.lensHit = (k) => {
      this.lensBlood = Math.min(1.2, this.lensBlood + k);
      this.post.splat();
    };
    // old blood, where the map says
    for (const s of L.map.stains ?? []) this.fx.stain(s[0], s[1], s[2], s[3], s[4], s[5], s[6]);
    this.fx.outside = (x, z) => this.zone(x, 1, z) === 'street';
    this.scene.add(this.fx.group);
    this.post.airScene = this.fx.air;
    this.post.airScale = (s) => this.fx.setScale(s);
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

  private buildPhysics() {
    const { L, phys } = this;
    phys.addMap(L.map);
    if (L.world.terrain) {
      const q = L.map.terrain!.inner;
      phys.addTerrain(L.world.terrain, q[0], q[1], q[2], q[3]);
    }
    for (const d of L.doors) {
      phys.addDoor(d);
      d.onThud = (door, v) => this.sound.impact(door.leafCentre, v > 2 ? 'wood' : 'wood');
    }
    for (const p of L.panes) phys.addPane(p.id, p.box.min, p.box.max);
    const group = new THREE.Group();
    this.scene.add(group);
    this.looseGroup = group;
    for (const q of L.loose) {
      group.add(q.obj);
      phys.addLoose(q.obj, q.def, q.x, q.y, q.z, q.rot);
    }
    phys.onKnock = (x, y, z, surf, v) => {
      const p = this.tmp.set(x, y, z);
      if (p.distanceToSquared(this.cam.position) > 900) return;
      if (surf === 'brass' || surf === 'shard') this.sound.tink(p);
      else this.sound.impact(p, surf === 'metal' ? 'metal' : surf === 'flesh' ? 'flesh' : 'wood');
      void v;
    };
  }

  /** the light capture only wants the architecture */
  hideLoose() {
    if (this.looseGroup) this.looseGroup.visible = false;
    this.fx.group.visible = false;
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
    this.bounce.intensity = 0.01;
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
    if (this.L.grass && k === 'street') return y < 0.02 ? 'wet' : Math.abs(y - this.L.world.ground(x, z)) > 0.12 ? 'hard' : this.L.grass.surface(x, z);
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
      p.mend();
    }
    this.phys.resetPanes();
    this.phys.resetLoose();
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
          if (this.L.map.night) this.me.light = true;
          this.lensBlood = 0;
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
          const miss = muz.clone().addScaledVector(ab, t).distanceTo(this.cam.position);
          if (miss < 2.2 && t > 0.05 && t < 0.98 && this.me.alive && this.foe(e.s)) {
            if (miss < 1.1) this.sound.snap(this.cam.position.clone().add(new THREE.Vector3(0.4, 0, 0)));
            this.me.suppress(1 - miss / 2.2);
          }
        }
        const muffled = !this.L.world.sees(this.cam.position, muz);
        this.sound.shot(e.w, muz, muffled);
        this.landShots(e, true);
        break;
      }
      case 'hit': {
        const a = this.actors.get(e.s);
        if (a) a.info.hp = e.hp;
        if (e.s === this.mySlot) this.me.hp = e.hp;
        if (a?.soldier && e.s !== this.mySlot) a.soldier.flinch(e.zone, this.tmp.set(e.dir[0], e.dir[1], e.dir[2]));
        if (e.s === this.mySlot) {
          this.hurt = Math.min(1, this.hurt + 0.42 + e.dmg / 90);
          this.me.hurt(e.dir, e.zone, e.dmg, e.bleed ?? 0);
          this.sound.hurt();
          this.hud.damage(e.dir, this.cam, e.hp);
          this.hud.wound(e.zone);
        } else if (e.by === this.mySlot) this.hud.hitTick(false);
        break;
      }
      case 'hp': {
        const a = this.actors.get(e.s);
        if (a) a.info.hp = e.hp;
        if (e.s === this.mySlot) {
          this.me.hp = e.hp;
          this.me.bleed = e.bleed;
          if (e.healed) this.me.healed();
        }
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
          // the body keeps what it was doing, plus what the round brought
          const running = new THREE.Vector3(-Math.sin(a.moveYaw), 0, -Math.cos(a.moveYaw)).multiplyScalar(a.speed);
          if (e.s === this.mySlot) running.set(this.me.m.vx, this.me.m.vy, this.me.m.vz);
          const spec = e.w >= 0 ? WEAPONS[WEAPON_LIST[e.w]] : null;
          const shove = spec ? spec.shove * (spec.pellets > 1 ? 9 : 1) * (e.dist < 6 ? 1.5 : 1) * 3 : 60;
          s.kill(this.phys, running, e.zone, d, shove);
          const y = e.zone === 0 ? 1.62 : e.zone === 4 ? 0.7 : 1.2;
          // what the round carries past lands on whatever is behind them
          const h = this.L.world.ray(a.x, a.y + y, a.z, d.x, d.y * 0.4 - 0.1, d.z, 3.2);
          this.fx.blood(a.x, a.y + y, a.z, d.x, d.y, d.z, h ? { x: a.x + d.x * h.t, y: a.y + y + (d.y * 0.4 - 0.1) * h.t, z: a.z + d.z * h.t, nx: h.nx, ny: h.ny, nz: h.nz } : undefined, e.zone === 0 ? 2.2 : 1.6);
          window.setTimeout(() => {
            if (a.deadAt < 0 || !s.head) return;
            this.fx.pool(s.head.x, this.L.world.floorAt(s.head.x, s.head.y + 0.4, s.head.z, 0.1), s.head.z);
          }, 1800);
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
          if (e.blast !== undefined) d.blown(e.dir, e.blast);
          else d.toggle(null, e.open ? e.dir : 0);
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
          p.breakTeeth(this.L.glassMat);
          this.phys.breakPane(p.id);
          const c = p.mesh.position;
          const at = e.at ? new THREE.Vector3(...e.at) : c.clone();
          // it goes the way the round or the blast was going
          const push = at.clone().sub(this.cam.position).setY(0).normalize();
          if (e.at && at.distanceTo(c) > 1.6) push.copy(c).sub(at).setY(0).normalize().multiplyScalar(2.4);
          this.fx.shatter(p.mesh, at, push);
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
        const inside = this.zone(p.x, p.y, p.z) !== 'street';
        this.fx.burst(p, e.kind, inside);
        this.sound.boom(p, e.kind === 'flash');
        this.muzzleLight(p, 30);
        const d = this.cam.position.distanceTo(p);
        const sees = (x: number, y: number, z: number) => this.L.world.sees({ x: p.x, y: p.y + 0.15, z: p.z }, { x, y, z });
        this.phys.blast(p, e.kind === 'frag' ? 120 : 18, e.kind === 'frag' ? 9 : 4, sees);
        if (this.me.alive) this.me.shake(THREE.MathUtils.clamp((e.kind === 'frag' ? 1.2 : 0.5) * (1 - d / 26), 0, 1));
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

  /** lightning, thunder, and the noises an empty building makes */
  private night(dt: number, outside: boolean) {
    this.sound.dread(this.cam.position, this.cam.position.y < -1, dt, this.inMatch && !outside);
    this.thunderT -= dt;
    if (this.thunderT <= 0) {
      this.thunderT = 22 + Math.random() * 40;
      const near = Math.random();
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) this.flashes.push(this.time + i * (0.09 + Math.random() * 0.25), 0.05 + Math.random() * 0.08, (3 + near * 9) * (i === 0 ? 1 : 0.6));
      this.sound.thunder(0.4 + (1 - near) * 3.2, near);
    }
    let f = 0;
    for (let i = 0; i < this.flashes.length; i += 3) {
      const t0 = this.flashes[i], len = this.flashes[i + 1], k = this.flashes[i + 2];
      if (this.time >= t0 && this.time < t0 + len) f = Math.max(f, k * (1 - (this.time - t0) / len));
    }
    if (this.flashes.length && this.time > this.flashes[this.flashes.length - 3] + 1) this.flashes.length = 0;
    LF.skyFlash.value = f;
    if (f > 0 && outside) this.whiteout = Math.max(this.whiteout, f * 0.006);
    this.creakT -= dt;
    if (this.creakT <= 0 && this.inMatch) {
      this.creakT = 14 + Math.random() * 26;
      // somewhere off in the dark, not where anyone is
      const c = this.cam.position;
      const a = Math.random() * 6.283, d = 14 + Math.random() * 18;
      const p = new THREE.Vector3(c.x + Math.cos(a) * d, c.y + (Math.random() - 0.4) * 3, c.z + Math.sin(a) * d);
      const r = Math.random();
      if (r < 0.15) this.sound.groan(p);
      else if (r < 0.5) this.sound.creak(p);
      else if (r < 0.8) this.sound.impact(p, Math.random() < 0.5 ? 'metal' : 'wood');
      else this.sound.door(p, Math.random() < 0.5);
    }
  }

  private landShots(e: Extract<Ev, { t: 'shot' }>, sounds: boolean) {
    const spec = WEAPONS[WEAPON_LIST[e.w]];
    const shove = spec.shove;
    for (let i = 0; i < e.surf.length; i++) {
      const o = i * 6;
      const s = e.surf[i];
      if (!s) continue;
      const x = e.e[o], y = e.e[o + 1], z = e.e[o + 2], nx = e.e[o + 3], ny = e.e[o + 4], nz = e.e[o + 5];
      // ~ is a skip: sparks, a whine, and the next point is where it went
      const skip = s[0] === '~';
      const surf = skip ? s.slice(1) : s;
      if (skip) {
        this.fx.skip(x, y, z, nx, ny, nz);
        this.fx.tracerLine(this.tmp.set(x, y, z), e.e[o + 6], e.e[o + 7], e.e[o + 8]);
        this.sound.ricochet(this.tmp.set(x, y, z));
      }
      // the far side of a wall: the normal runs with the round
      const out = i > 0 && e.surf[i - 1] === s && Math.abs(e.e[o - 6] - x) + Math.abs(e.e[o - 4] - z) < 1.8 && nx * e.e[o - 3] + ny * e.e[o - 2] + nz * e.e[o - 1] < -0.1;
      if (this.sun && surf === 'soil' && y < 0.06) {
        // the bed is under water: what shows is the surface
        this.fx.impact(x, 0.04, z, 0, 1, 0, 'water');
        this.sound.impact(this.tmp.set(x, 0, z), 'water');
        continue;
      }
      this.fx.impact(x, y, z, nx, ny, nz, surf, out);
      if (surf === 'flesh') this.fx.blood(x, y, z, -nx, -ny, -nz);
      if (i === e.surf.length - 1 || sounds) this.sound.impact(this.tmp.set(x, y, z), surf);
      if (surf === 'wood') this.doorHit(x, y, z, nx, nz, shove);
    }
    // whatever isn't bolted down and lies along the line gets the round's push
    const O = e.o;
    for (let i = 0; i < e.surf.length; i++) {
      const o = i * 6;
      const dx = e.e[o] - O[0], dy = e.e[o + 1] - O[1], dz = e.e[o + 2] - O[2], d = Math.hypot(dx, dy, dz) || 1;
      if (d > 120) continue;
      const hit = this.phys.shot(O[0], O[1], O[2], dx / d, dy / d, dz / d, d, shove * 2.2);
      if (hit) {
        this.fx.impact(hit.x, hit.y, hit.z, -dx / d, -dy / d, -dz / d, hit.surf === 'flesh' ? 'flesh' : hit.surf);
        this.sound.impact(this.tmp.set(hit.x, hit.y, hit.z), hit.surf === 'metal' ? 'metal' : hit.surf === 'flesh' ? 'flesh' : 'wood');
        if (hit.surf === 'flesh') this.fx.blood(hit.x, hit.y, hit.z, dx / d, dy / d, dz / d);
      }
    }
  }

  /** a hole in a door stays in the door */
  private doorHit(x: number, y: number, z: number, nx: number, nz: number, shove: number) {
    for (const d of this.L.doors) {
      const b = d.box;
      if (x < b.min[0] - 0.1 || x > b.max[0] + 0.1 || z < b.min[2] - 0.1 || z > b.max[2] + 0.1 || y < b.min[1] || y > b.max[1]) continue;
      if (Math.abs(slabGap(b, x, z).d) > 0.05) continue;
      d.shot(-nx, -nz, shove * 0.09);
      this.holeIn(d, x, y, z, nx, nz);
      return;
    }
  }

  private holeIn(d: Door, x: number, y: number, z: number, nx: number, nz: number) {
    const m = this.fx.holeMesh('wood');
    m.position.set(x + nx * 0.008, y, z + nz * 0.008);
    m.lookAt(x + nx, y, z + nz);
    d.pivot.attach(m);
    this.doorHoles.push(m);
    if (this.doorHoles.length > 40) this.doorHoles.shift()!.removeFromParent();
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
    world: null as never, sound: this.sound, fx: null as never, doors: [], phys: null as never, scene: this.scene,
    bodies: () => this.bodies(),
    surfaceAt: (x, y, z) => this.surfaceAt(x, y, z),
    send: {
      shot: (w, o, e, surf) => this.req({ t: 'shot', w, o, e, surf }),
      hit: (to, dmg, zone, w, dir, dist) => this.req({ t: 'hit', to, dmg, zone, w, dir, dist }),
      door: (i, from) => this.req({ t: 'door', i, from }),
      kick: (i, from) => this.req({ t: 'kick', i, from }),
      heal: () => this.req({ t: 'heal' }),
      pane: (i, at) => this.req({ t: 'pane', i, at }),
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
    // down to the floor and still behind: the air and the occlusion go, the reflections with them
    if (this.scale <= 0.56 && fps < 44) this.liteK++;
    else if (fps > 56 && this.liteK > 0) this.liteK--;
    this.post.lite = this.liteK >= 2 || this.quality < 0.75;
    if (Math.abs(was - this.scale) > 0.02) this.resize();
  }

  tick(dt: number) {
    const L = this.L;
    this.ctx.world = L.world;
    this.ctx.fx = this.fx;
    this.ctx.doors = L.doors;
    this.ctx.phys = this.phys;
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
    // people have shoulders, and the things they walk through are moved by them
    if (this.inMatch && me.alive) for (const [s, a] of this.actors) {
      if (s === this.mySlot || !a.info.alive) continue;
      const dx = me.m.x - a.x, dz = me.m.z - a.z, d2 = dx * dx + dz * dz;
      if (d2 < 0.3 && d2 > 1e-5 && Math.abs(me.m.y - a.y) < 1.5) {
        const d = Math.sqrt(d2), push = (0.55 - d) * Math.min(1, dt * 14);
        const nx = me.m.x + (dx / d) * push, nz = me.m.z + (dz / d) * push;
        if (!L.world.blocked(nx, me.m.y + 0.02, nz, 0.26, 1.7)) {
          me.m.x = nx;
          me.m.z = nz;
        }
      }
    }
    let cap = 0;
    const post = this.post;
    for (const [s, a] of this.actors) {
      const body = s === this.mySlot && me.alive ? me.m : a;
      const alive = a.info.alive;
      if (alive) {
        const md = Math.hypot(body.x - a.lx, body.z - a.lz);
        a.lx = body.x;
        a.lz = body.z;
        const bleeding = s === this.mySlot ? me.bleed > 0 : a.info.hp < 55;
        if (bleeding && md < 2) {
          a.dripD += md + dt * 0.12;
          if (a.dripD > 0.85) {
            a.dripD = 0;
            this.fx.drip(body.x, body.y + 0.9, body.z);
          }
        }
      }
      if (a.y > -20) this.phys.setActor(s, body.x, body.y, body.z, 1.7, alive);
      if (cap >= post.capA.length || !a.soldier?.root.visible) continue;
      const crouch = (a.flags & F.crouch) !== 0;
      const dead = !alive && a.soldier.dead >= 0;
      if (dead) {
        const h = a.soldier.head;
        const y = L.world.floorAt(h.x, h.y + 0.3, h.z, 0.1);
        post.capA[cap].set(h.x, y + 0.14, h.z, 0.26);
        post.capB[cap++].set(h.x, y + 0.2, h.z, 0);
      } else if (alive) {
        post.capA[cap].set(body.x, body.y + 0.14, body.z, 0.19);
        post.capB[cap++].set(body.x, body.y + (crouch ? 1.1 : 1.58), body.z, 0);
      }
    }
    post.capN = cap;
    this.phys.step(dt);
    this.lights(dt);
    this.fxNades(dt);
    this.fx.update(dt, this.time, this.cam, this.zone(this.cam.position.x, this.cam.position.y, this.cam.position.z) !== 'street');
    this.netT += dt;
    if (this.netT >= CAM_STEP && this.inMatch) {
      this.netT = 0;
      this.sendState();
    }
    this.sound.listen(this.cam, this.zone(this.cam.position.x, this.cam.position.y, this.cam.position.z));
    if (this.sun) {
      const c = this.cam.position, shore = -46 + 70 * Math.exp(-(((c.x - 12) / 42) ** 2));
      this.sound.shore(Math.max(0, -c.z - shore), this.zone(c.x, c.y, c.z) !== 'street', c.y, dt);
    }
    // ---- post values
    const u = this.post.mFinal.uniforms;
    this.whiteout = Math.max(0, this.whiteout - dt * 0.75);
    this.hurt = Math.max(0, this.hurt - dt * 0.34);
    const hp = mine?.info.hp ?? 100;
    u.whiteout.value = Math.min(1.4, this.whiteout);
    u.hurt.value = Math.min(1, this.hurt * 0.7 + (me.alive ? Math.max(0, (45 - hp) / 45) * 0.5 + me.supK * 0.3 : 0.35));
    u.fish.value = THREE.MathUtils.lerp(0.85, 0.3, me.alive ? me.adsK : 0);
    const outside = this.zone(this.cam.position.x, this.cam.position.y, this.cam.position.z) === 'street';
    this.wet += ((outside ? 1 : 0) - this.wet) * Math.min(1, dt * (outside ? 0.5 : 0.8));
    const wx = this.L.map.weather;
    u.lensWet.value = this.wet * (wx?.wet ?? 1);
    // blood on the lens dries slowly; rain washes it faster
    this.lensBlood = Math.max(0, this.lensBlood - dt * (0.035 + this.wet * 0.08));
    u.lensBlood.value = this.lensBlood;
    (u.bloodSeed.value as THREE.Vector3).z += dt;
    LF.rain.value = (outside ? 1 : 0.6) * (wx?.rain ?? 1);
    const fog = wx?.fog ?? 1;
    this.post.density += ((outside ? 0.0065 : 0.0095) * fog - this.post.density) * Math.min(1, dt * 2);
    if (this.dead >= 0) {
      u.glitch.value = this.dead > 2.0 ? Math.min(1, (this.dead - 2.0) * 1.8) : 0;
    } else u.glitch.value = 0;
    if (this.L.map.night) this.night(dt, outside);
    {
      const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
      const dy = Math.atan2(Math.sin(e.y - this.lastYaw), Math.cos(e.y - this.lastYaw)), dp = e.x - this.lastPitch;
      this.lastYaw = e.y;
      this.lastPitch = e.x;
      const k = dt > 1e-4 ? 1 / dt : 0;
      this.turnRate.x += (THREE.MathUtils.clamp(dy * k, -9, 9) - this.turnRate.x) * Math.min(1, dt * 20);
      this.turnRate.y += (THREE.MathUtils.clamp(dp * k, -9, 9) - this.turnRate.y) * Math.min(1, dt * 20);
      (u.shutter.value as THREE.Vector2).set(this.turnRate.x * 0.0042, -this.turnRate.y * 0.0042);
    }
    this.hud.update(dt);
    if (this.camHold) {
      this.cam.position.set(this.camHold[0], this.camHold[1], this.camHold[2]);
      this.cam.rotation.set(this.camHold[4], this.camHold[3], 0, 'YXZ');
      if (this.cam.fov !== 50) {
        this.cam.fov = 50;
        this.cam.updateProjectionMatrix();
      }
      this.cam.updateMatrixWorld();
    }
    if (!this.frozen) {
      const out = !this.L.map.terrain && !this.post.lite && this.zone(this.cam.position.x, this.cam.position.y, this.cam.position.z) === 'street' && this.cam.position.y < 12;
      this.planar.render(this.scene, this.cam, this.planarHide(), out);
      // after the mirror, which puts back whatever it hid
      const cp = this.cam.position;
      for (const v of this.L.vegCells) v.mesh.visible = Math.hypot(v.x - cp.x, v.z - cp.z) < v.reach;
      if (this.sun) {
        this.sun.update(this.cam.position, this.time);
        this.L.grass?.update(this.cam);
        this.ride(this.time);
        this.lensFlare(dt);
      }
      this.post.render(this.scene, this.cam, dt, this.time);
    }
  }

  private hideList: THREE.Object3D[] = [];
  /** the street can't see indoors, and the wearer's own arms don't reflect */
  private planarHide() {
    const h = this.hideList;
    h.length = 0;
    h.push(this.fx.group);
    if (this.mySoldier) h.push(this.mySoldier.root);
    for (const o of this.L.indoors) h.push(o);
    return h;
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

  /** the bake has no glints: the nearest lamps the camera can see lend theirs to the shader */
  /** tubes on their last legs and candles in a draught: each frame, the nearest four */
  private flicker(dt: number) {
    const fl = this.L.flicks;
    if (!fl.length) return;
    const c = this.cam.position;
    for (const f of fl) {
      const a = f.l.flicker ?? 0;
      f.t -= dt;
      if (a > 0.3) {
        // a tube: on, then a stutter, then dark for a while, then it catches again
        if (f.t <= 0) {
          if (f.off > 0) {
            f.off = 0;
            f.t = 0.6 + Math.random() * (7 - a * 4);
          } else {
            f.off = Math.random() < a * 0.5 ? 0.4 + Math.random() * 2.2 * a : 0.05 + Math.random() * 0.25;
            f.t = f.off;
          }
        }
        const stutter = f.off > 0 ? (Math.sin(performance.now() * 0.09 + f.base.r * 10) > 0.6 - (f.off > 0.4 ? 1 : 0) ? 0.15 : 1) : Math.random() < 0.01 * a ? 0.6 : 0;
        f.k = Math.min(1, stutter) * Math.min(1, a + 0.2);
      } else {
        // a flame: never out, never still
        const n = Math.sin(performance.now() * 0.011 + f.base.g * 31) * 0.5 + Math.sin(performance.now() * 0.027 + f.base.b * 17) * 0.5;
        f.k = Math.max(0, n * a * 1.6 + (Math.random() - 0.5) * a * 0.6);
      }
      f.mat.color.copy(f.base).multiplyScalar(1 - f.k * 0.94);
    }
    const near = fl.map((f) => [Math.hypot(f.l.pos[0] - c.x, f.l.pos[1] - c.y, f.l.pos[2] - c.z), f] as [number, typeof fl[number]]).sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < 4; i++) {
      const e = near[i];
      const P = LF.flickP.value[i];
      if (!e || e[0] > 40) {
        P.w = 0;
        continue;
      }
      const l = e[1].l;
      // how far the lamp's own light reaches in the bake, roughly
      const reach = l.kind === 'spot' ? 7 : l.kind === 'area' ? 5.5 : Math.max(1.6, Math.sqrt(l.power) * 1.6);
      P.set(l.pos[0], l.pos[1] - (l.kind === 'spot' ? 1.4 : 0.4), l.pos[2], reach);
      LF.flickA.value[i] = e[1].k;
    }
  }

  private lamps(dt: number) {
    this.flicker(dt);
    this.lampT -= dt;
    if (this.lampT > 0) return;
    this.lampT = 0.2;
    const c = this.cam.position;
    const near: [number, MapData['lights'][number]][] = [];
    for (const l of this.L.map.lights) {
      const d = Math.hypot(l.pos[0] - c.x, l.pos[1] - c.y, l.pos[2] - c.z);
      if (d < 48) near.push([d, l]);
    }
    near.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [d, l] of near) {
      if (n >= 6) break;
      if (d > 3 && !this.L.world.sees(c, { x: l.pos[0], y: l.pos[1] - 0.25, z: l.pos[2] })) continue;
      const big = l.kind === 'spot';
      LF.lampP.value[n].set(l.pos[0], l.pos[1], l.pos[2], big ? 26 : 11);
      const fk = l.flicker ? (this.L.flicks.find((f) => f.l === l)?.k ?? 0) : 0;
      const p = (big ? Math.min(l.power, 800) / 800 * 90 : l.power * 1.1) * (1 - fk);
      LF.lampC.value[n].set(l.color[0] * p, l.color[1] * p, l.color[2] * p);
      n++;
    }
    for (; n < 6; n++) LF.lampP.value[n].w = 0;
  }

  private lights(dt: number) {
    const me = this.me;
    const s = this.spot;
    this.lamps(dt);
    // the air sees the same flashlight and the same flash
    if (me.alive && me.light) {
      AIR.beamP.value.set(me.lightPos.x, me.lightPos.y, me.lightPos.z, s.intensity * 0.09);
      AIR.beamD.value.copy(me.barrel);
    } else AIR.beamP.value.w = 0;
    const fp = this.flashPoint.position;
    AIR.spark.value.set(fp.x, fp.y, fp.z, this.flashK * 0.022);
    if (me.alive && me.light) {
      const hit = this.L.world.ray(me.lightPos.x, me.lightPos.y, me.lightPos.z, me.barrel.x, me.barrel.y, me.barrel.z, 16);
      const t = hit ? hit.t : 16;
      const wantI = 52 * Math.min(1, Math.pow(Math.min(t, 7) / 5, 1.25) + 0.05);
      s.intensity += (wantI - s.intensity) * Math.min(1, dt * 9);
      s.position.copy(me.lightPos);
      s.target.position.copy(me.lightPos).addScaledVector(me.barrel, 5);
      // the beam's flux is the same at any range; what comes back off the wall is a fraction of it, spread over the room.
      // Stood off the wall on the near side, so the light it gives is all on this side of it
      const b = this.bounce;
      if (hit) {
        const p = this.tmp.copy(me.lightPos).addScaledVector(me.barrel, t);
        p.x += hit.nx * 0.7;
        p.y += hit.ny * 0.7;
        p.z += hit.nz * 0.7;
        if (this.bounceK < 0.01) b.position.copy(p);
        else b.position.lerp(p, Math.min(1, dt * 14));
      }
      const want = hit ? 1.5 * Math.min(1, t / 1.2) : 0;
      this.bounceK += (want - this.bounceK) * Math.min(1, dt * 10);
      b.intensity = this.bounceK * (s.intensity / 52);
    } else {
      s.intensity = 0;
      this.bounceK = 0;
      this.bounce.intensity = 0;
    }
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
    this.flashPoint.intensity = this.flashK * 6;
    this.flashK = Math.max(0, this.flashK - dt * 110);
  }

  private fxNades(dt: number) {
    for (const n of this.nades) {
      const v = stepNade(this.L.world, n, dt);
      if (v > 1.1) this.sound.tink(this.tmp.set(n.x, n.y, n.z));
      n.mesh.position.set(n.x, n.y + 0.012, n.z);
      // it spins as fast as it travels, and lies on its side when it stops
      const sp = Math.hypot(n.vx, n.vz);
      if (!n.rest) {
        n.mesh.rotation.x += dt * (6 + sp * 3);
        n.mesh.rotation.y = Math.atan2(n.vx, n.vz);
      } else n.mesh.rotation.x += (Math.PI / 2 - (n.mesh.rotation.x % Math.PI)) * Math.min(1, dt * 14);
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
    if (this.cam.fov !== 92) {
      this.cam.fov = 92;
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
    const pts = this.L.map.attract;
    const a = pts ? new THREE.Vector3(...(pts[0] as [number, number, number])) : new THREE.Vector3(36, 1.55, -6.2), b = pts ? new THREE.Vector3(...(pts[1] as [number, number, number])) : new THREE.Vector3(58, 1.6, -7.4);
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
  /** on the other side from me */
  private foe(slot: number) {
    const a = this.actors.get(slot)?.info, b = this.actors.get(this.mySlot)?.info;
    return !!a && !!b && (a.team === 2 || a.team !== b.team);
  }
  weaponName(w: number) {
    return w >= 0 ? WEAPONS[WEAPON_LIST[w]].name : w === W_BOOT ? 'Boot' : 'Blast';
  }
  bodiesFor(s: number): BodyState | undefined {
    return this.match?.bodies[s];
  }
}

/** what a weapon light throws: a hot core, the reflector's ring round it, and a wide dim spill */
function beamCookie(): THREE.Texture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5, dy = (y + 0.5) / N - 0.5;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      let v = Math.exp(-((r / 0.075) ** 2)) * 1.0 + Math.exp(-((r / 0.17) ** 2)) * 0.32;
      v += Math.exp(-(((r - 0.19) / 0.025) ** 2)) * 0.07;
      v += 0.085 * (1 - smooth(0.3, 0.5, r));
      // the reflector isn't perfect
      v *= 1 + 0.06 * Math.sin(a * 7 + r * 40) * smooth(0.05, 0.2, r);
      const k = Math.min(255, Math.round(Math.max(0, v) / 1.33 * 255));
      const i = (y * N + x) * 4;
      img.data[i] = k;
      img.data[i + 1] = Math.round(k * 0.97);
      img.data[i + 2] = Math.round(k * 0.9);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
function smooth(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
