import * as THREE from 'three';
import { Sun, MOVER } from './sun.ts';
import type { PeopleKit } from '../people/Humans.ts';
import { Planar, Post } from './post.ts';
import { MAP_ID, loadVolume, loadWorld, type Door, type Loaded, type MapData } from './world.ts';
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
import { Rats } from './vermin.ts';
import { F, STRIDE, WEAPONS, WEAPON_LIST, W_BOOT, ZONE, ZONE_NAME, solo, type Ev, type MatchConfig, type NadeKind, type Phase, type PlayerInfo, type Req, type WeaponId, flaresAt, type FlareNow } from './shared.ts';
import { Guest_, Host, type Down } from './net.ts';
import { Hud } from './ui.ts';
import { Shafts } from './shafts.ts';
import { Graffiti, graffitiFonts, markUp, storeSigns, trenchSigns } from './graffiti.ts';

/** how thick the air is with dust, by location */
const SHAFT_GAIN: Record<string, number> = { ward: 0.3, store: 0.3 };
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
  private shafts: Shafts | null = null;
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
  /** the arms and the gun lit a little from the front, as a lens sees them in any light */
  private fill = new THREE.PointLight(0xdfe3ea, 0, 2.1, 2);
  /** someone's light pointed straight at the lens */
  private glares: THREE.Sprite[] = [];
  /** other people's beams, seen in the dust from the side */
  private beams: THREE.Mesh[] = [];
  /** how much of each glare's lens can be seen: eased, so a stray hit doesn't make it blink */
  private glareVis = [0, 0];
  /** star shells: lights and the burning magnesium you see, and the clock they run off */
  private flareLights: THREE.PointLight[] = [];
  private flareSprites: THREE.Sprite[] = [];
  private flareNow: FlareNow[] = [];
  private flareSeen = new Set<number>();
  private matchT = 0;
  private flashK = 0;
  private time = 0;
  private last = performance.now();
  private netT = 0;
  private dead = -1;
  private deadFrom = new THREE.Vector3();
  private dropLight: { x: number; y: number; z: number; vy: number; yaw: number; pitch: number } | null = null;
  private killYaw = 0;
  private killer = '';
  private frozen = false;
  private rats: Rats | null = null;
  /** rooms the rain has got into */
  private soaked = new Set<string>();
  private drips: { x: number; y: number; z: number; vy: number; floor: number }[] = [];
  private dripAcc = 0;
  private breathT = 2;
  private caBase = 0.007;
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
    // a weapon light is an LED: cold white, a hard hot spot, the reflector's ring, a wide dim spill
    const s = (this.spot = new THREE.SpotLight(0xeef1ff, 0, 38, 0.85, 0.18, 1.7));
    // the cookie costs a texture unit, and the daylight shaders have none to spare (the sun's maps)
    const cookie = LF.sunOn ? null : beamCookie();
    if (cookie) s.map = cookie;
    s.castShadow = true;
    s.shadow.mapSize.set(1024, 1024);
    s.shadow.camera.near = 0.25;
    s.shadow.camera.far = 34;
    s.shadow.bias = -0.0006;
    s.shadow.normalBias = 0.02;
    this.scene.add(s, s.target);
    for (let i = 0; i < 2; i++) {
      // theirs are the same lights as mine: the same pattern on the wall, and the nearest one throws shadows
      const o = new THREE.SpotLight(0xeef1ff, 0, 30, 0.8, 0.22, 1.7);
      if (cookie) o.map = cookie;
      if (i === 0 && cookie) {
        o.castShadow = true;
        o.shadow.mapSize.set(512, 512);
        o.shadow.camera.near = 0.3;
        o.shadow.camera.far = 28;
        o.shadow.bias = -0.0008;
        o.shadow.normalBias = 0.03;
      }
      this.others.push(o);
      this.scene.add(o, o.target);
      const beam = new THREE.Mesh(beamGeo(), beamMat());
      beam.visible = false;
      beam.frustumCulled = false;
      beam.renderOrder = 5;
      this.beams.push(beam);
      this.scene.add(beam);
    }
    this.flashPoint = new THREE.PointLight(0xffc08a, 0, 13, 1.8);
    this.scene.add(this.flashPoint, this.bounce, this.fill);
    const gt = glareTex();
    for (let i = 0; i < 2; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: new THREE.Color(3.0, 3.2, 3.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      sp.visible = false;
      this.glares.push(sp);
      this.scene.add(sp);
    }
    // star shells: in the scene from the start (at nothing), so one going up never recompiles a shader
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xfff1de, 0, 140, 1.0);
      this.flareLights.push(l);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color: new THREE.Color(14, 12.5, 10.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      sp.visible = false;
      this.flareSprites.push(sp);
    }
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

  /** the map loads behind the menu: what's done, and a promise for the rest */
  loaded = false;
  loadF = 0;
  loadWhat = 'Loading';
  private readyRes!: () => void;
  readonly whenReady = new Promise<void>((r) => (this.readyRes = r));

  async load(progress0: (f: number, what: string) => void) {
    const progress = (f: number, what: string) => {
      this.loadF = Math.max(this.loadF, f);
      this.loadWhat = what;
      progress0(this.loadF, what);
    };
    const [L, kit, phys] = await Promise.all([loadWorld(this.r, progress), preparePeople(), Phys.create(), loadGuns(), loadGear(), loadVolume(), graffitiFonts()]);
    this.L = L;
    for (const f of L.flicks) this.flickOf.set(f.l, f);
    this.phys = phys;
    this.buildPhysics();
    this.kit = kit as PeopleKit;
    this.scene.add(L.group);
    // only a field with star shells pays for their lights in every shader
    if (L.map.flares) this.scene.add(...this.flareLights, ...this.flareSprites);
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
    // what has a roof keeps the rain off: buildings, and dug-in rooms with their roof at the ground (a dugout's top is below 0)
    const roofs: THREE.Vector4[] = L.map.zones.filter((z) => z.b[1] > -1).map((z) => {
      // (a little over, so no rain comes down the thickness of the wall between one room and the next)
      const x0 = Math.min(z.a[0], z.b[0]) - 0.4, x1 = Math.max(z.a[0], z.b[0]) + 0.4, z0 = Math.min(z.a[2], z.b[2]) - 0.4, z1 = Math.max(z.a[2], z.b[2]) + 0.4;
      return new THREE.Vector4(x0, z0, x1, z1);
    });
    if (!roofs.length) roofs.push(new THREE.Vector4(1e6, 1e6, 1e6 + 1, 1e6 + 1));
    this.fx = new Fx(roofs, phys, L.glassMat);
    const wb = L.map.weather?.wb;
    if (wb) (this.post.mFinal.uniforms.wb.value as THREE.Vector3).set(wb[0], wb[1], wb[2]);
    this.fx.rainOn = L.map.weather?.rain ?? 1;
    if (L.map.weather?.key) this.post.exposureKey = L.map.weather.key;
    if (L.map.night) {
      Bot.night = true;
      // the dark is still dark, but the sensor is a better one: it opens further and brings far less noise up with it
      this.post.exposureMax = 5.0;
      this.post.mFinal.uniforms.satK.value = 0.8;
      this.post.mFinal.uniforms.grainK.value = 0.45;
    }
    if (sunInfo) {
      this.post.mFinal.uniforms.caK.value = this.caBase = 0.005;
      this.post.mFinal.uniforms.satK.value = 0.97;
      this.sound.coast = true;
    }
    // the map's mood on top of its bake: light taken down, the sun gone behind cloud, a duller sky, a camera that
    // can only open so far, colour drained
    const wx = L.map.weather;
    if (wx?.dim !== undefined) {
      LF.worldLight.value = wx.dim;
      LF.skyK.value *= wx.dim;
    }
    if (wx?.sunK !== undefined) {
      LF.sunC.value.multiplyScalar(wx.sunK);
      LF.disc.value = 0;
    }
    if (wx?.skyTint) this.scene.traverse((o) => { const u = (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms; if (u?.tint && u.disc) (u.tint.value as THREE.Vector3).set(wx.skyTint![0], wx.skyTint![1], wx.skyTint![2]); });
    if (wx?.expMax) this.post.exposureMax = wx.expMax;
    if (wx?.sat) this.post.mFinal.uniforms.satK.value = wx.sat;
    this.fx.groundAt = (x, y, z) => L.world.floorAt(x, y, z, 0.01, 0.05, true);
    // what blood can land on: any wall, thin or thick, but not a door that will swing away or a pane that will break
    this.fx.rayAt = (x, y, z, dx, dy, dz, far) => {
      const h = L.world.ray(x, y, z, dx, dy, dz, far, false, true);
      return h && (h.box.tag === 'door' || h.box.tag === 'glass') ? L.world.ray(x, y, z, dx, dy, dz, far, true, true) : h;
    };
    this.fx.lensHit = (k) => {
      this.lensBlood = Math.min(1.2, this.lensBlood + k);
      this.post.splat();
    };
    // old blood, where the map says
    for (const s of L.map.stains ?? []) this.fx.stain(s[0], s[1], s[2], s[3], s[4], s[5], s[6]);
    // what people wrote on the walls, and the rooms where it went worst
    const signs = (L.map as unknown as { signs?: number[][] }).signs;
    if (signs?.length) this.scene.add(MAP_ID === 'store' ? storeSigns(signs) : trenchSigns(signs));
    if (!LF.sunOn) {
      const gr = new Graffiti();
      this.scene.add(gr.group);
      const seed = [...MAP_ID].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7);
      const out = markUp(L.map.rooms as never, L.world, this.fx, gr, seed);
      this.soaked = new Set(out.soakedRooms);
      if (location.search.includes('dev=1')) console.log('[lf] graffiti', out.pieces, 'posters', out.posters, 'papers', out.papers, 'soaked rooms', out.soaked, out.soakedRooms.join(' '));
      (this as unknown as { graffiti: Graffiti }).graffiti = gr;
    }
    this.fx.outside = (x, z) => this.zone(x, 1, z) === 'street';
    this.scene.add(this.fx.group);
    this.post.airScene = this.fx.air;
    // light through the windows, into the dust
    this.shafts = new Shafts(L.map as never, (x, y, z, dx, dy, dz, far) => L.world.ray(x, y, z, dx, dy, dz, far), SHAFT_GAIN[MAP_ID], L.doors);
    this.fx.air.add(this.shafts.group);
    this.post.airScale = (s) => this.fx.setScale(s);
    progress(0.95, 'Paths');
    const seeds = [...L.map.spawns.a, ...L.map.spawns.b, ...L.map.spawns.ffa];
    this.nav = new Nav(L.world, seeds, (x, y, z) => this.zone(x, y, z) !== 'street');
    if (L.map.night && this.L.map.rooms?.length) {
      this.rats = new Rats(this.nav.nodes);
      this.rats.onBolt = (p) => this.sound.squeak(p);
      this.scene.add(this.rats.group);
    }
    addEventListener('resize', () => this.resize());
    this.resize();
    await this.warm();
    progress(1, 'Ready');
    this.attract = 0.001;
    this.loaded = true;
    this.readyRes();
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
      if (surf === 'cart') this.sound.trolley(p);
      else if (surf === 'brass' || surf === 'shard') this.sound.tink(p);
      else this.sound.impact(p, surf === 'metal' ? 'metal' : surf === 'flesh' ? 'flesh' : 'wood');
      void v;
    };
  }

  /** what a round knocks off a shelf: a few tins, bottles and cartons, thrown out into the aisle and left on the floor */
  private stockGeo: THREE.BufferGeometry[] | null = null;
  private stockMat: THREE.MeshStandardMaterial[] = [];
  private stockN = 0;
  private knockOff(x: number, y: number, z: number, nx: number, nz: number) {
    if (this.stockN > 70 || !this.looseGroup) return;
    if (!this.stockGeo) {
      this.stockGeo = [new THREE.CylinderGeometry(0.037, 0.037, 0.11, 10), new THREE.CylinderGeometry(0.03, 0.034, 0.2, 10), new THREE.BoxGeometry(0.07, 0.19, 0.07), new THREE.BoxGeometry(0.16, 0.22, 0.06)];
      for (const c of [0x8a1f1a, 0x1f4a7a, 0xb08a1e, 0x2f6a38, 0xb9b4a6, 0x6a3a1c, 0x3a3f46]) {
        const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.1 });
        m.color.multiplyScalar(0.55);
        this.stockMat.push(applyLF(m, {}) as THREE.MeshStandardMaterial);
      }
    }
    const len = Math.hypot(nx, nz), ox = len > 0.3 ? nx / len : 0, oz = len > 0.3 ? nz / len : 0;
    const n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const k = Math.floor(Math.random() * this.stockGeo.length);
      const geo = this.stockGeo[k];
      const mesh = new THREE.Mesh(geo, this.stockMat[Math.floor(Math.random() * this.stockMat.length)]);
      this.looseGroup.add(mesh);
      geo.computeBoundingBox();
      const b = geo.boundingBox!.max;
      const p = new THREE.Vector3(x + ox * 0.12 + (Math.random() - 0.5) * 0.3 * Math.abs(oz), y + (Math.random() - 0.3) * 0.12, z + oz * 0.12 + (Math.random() - 0.5) * 0.3 * Math.abs(ox));
      const v = new THREE.Vector3(ox * (0.7 + Math.random() * 1.6) + (Math.random() - 0.5) * 0.8, 0.6 + Math.random() * 1.4, oz * (0.7 + Math.random() * 1.6) + (Math.random() - 0.5) * 0.8);
      this.stockN++;
      this.phys.drop(mesh, [b.x, b.y, b.z], new THREE.Vector3(), p, new THREE.Quaternion(), v, 14, 0.4, 45, k < 2 ? 'metal' : 'wood');
      setTimeout(() => this.stockN--, 45000);
    }
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
    this.fill.intensity = 0.01;
    // the shaders build on the driver's own threads while the page stays live, instead of one blocking link after another
    await this.r.compileAsync(this.scene, this.cam).catch(() => this.r.compile(this.scene, this.cam));
    this.post.render(this.scene, this.cam, 0.016, 0);
    await new Promise((r) => setTimeout(r));
    s.dispose();
    t.dispose();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const k = Math.min(1, 2560 / (w * dpr)) * dpr * this.scale * this.quality;
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
    this.matchT = 0;
    this.flareSeen.clear();
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
    // every lamp back on
    for (const f of this.L.flicks) {
      f.dead = false;
      f.dying = 0;
      f.k = 0;
      f.mesh.visible = true;
      f.mat.color.copy(f.base);
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
        this.rats?.startle();
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
        if (a?.soldier && e.zone !== ZONE.blast && e.dmg > 0) a.soldier.wound(e.zone, this.tmp.set(e.dir[0], e.dir[1], e.dir[2]));
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
          if (e.zone !== ZONE.blast) s.wound(e.zone, d, 1.5);
          s.kill(this.phys, running, e.zone, d, shove);
          const y = e.zone === 0 ? 1.62 : e.zone === 4 ? 0.7 : 1.2;
          // what the round carries past lands on whatever is behind them
          const h = this.fx.rayAt(a.x, a.y + y, a.z, d.x, d.y * 0.4 - 0.1, d.z, 3.2);
          this.fx.blood(a.x, a.y + y, a.z, d.x, d.y, d.z, h ? { x: a.x + d.x * h.t, y: a.y + y + (d.y * 0.4 - 0.1) * h.t, z: a.z + d.z * h.t, nx: h.nx, ny: h.ny, nz: h.nz } : undefined, e.zone === 0 ? 2.2 : 1.6);
          // it runs out of them onto the floor, then pools
          const died = a.deadAt;
          this.fx.bleed(() => (a.deadAt === died ? s.head : null));
          window.setTimeout(() => {
            if (a.deadAt < 0 || !s.head) return;
            // the floor right under them: searched from just above the head, so a table or a bed beside them doesn't catch it
            let fy = this.L.world.floorAt(s.head.x, s.head.y + 0.15, s.head.z, 0.05, 0.05, true);
            if (!(fy > s.head.y - 0.6)) fy = s.head.y - 0.12;
            this.fx.pool(s.head.x, fy, s.head.z);
          }, 900);
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
          this.dropLight = this.me.light ? { x: this.me.lightPos.x, y: this.me.lightPos.y, z: this.me.lightPos.z, vy: 0, yaw: Math.atan2(-this.me.barrel.x, -this.me.barrel.z) + (Math.random() - 0.5) * 1.4, pitch: Math.asin(Math.max(-1, Math.min(1, this.me.barrel.y))) } : null;
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
        this.muzzleLight(p, 12);
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
      case 'arm': {
        const a = this.actors.get(e.s);
        if (!a) break;
        a.info.primary = e.primary;
        if (e.s === this.mySlot) {
          if (this.me.alive && this.mySoldier) this.me.rearm(e.primary, this.mySoldier, this.sound);
          this.hud.gun(e.primary, e.step);
        } else if (a.info.alive) a.soldier?.setWeapon(e.primary);
        break;
      }
      case 'hold':
        this.score = [e.score[0], e.score[1]];
        this.hud.hold(e);
        break;
      case 'chat':
        if (e.team !== undefined && e.team !== this.actors.get(this.mySlot)?.info.team) break;
        this.hud.chat(e.from, e.text, e.team !== undefined);
        if (e.team !== undefined) this.sound.radio();
        break;
    }
  }

  /**
   * What still moves in an empty building: moths round whatever is still lit, and water coming through the ceilings of
   * the rooms the rain has got into, a drop at a time, each one landing
   */
  private stirring(dt: number) {
    if (!this.L.map.night) return;
    const c = this.cam.position, v = this.tmp, t = this.time, me = this.me;
    let n = 0;
    for (const f of this.L.flicks) {
      if (f.dead || f.l.power <= 0 || (f.l.kind !== 'area' && f.l.kind !== 'point')) continue;
      f.mesh.getWorldPosition(v);
      const d = Math.hypot(v.x - c.x, v.y - c.y, v.z - c.z);
      // too near and the lens turns each one into a ball of light
      if (d > 14 || d < 2.4) continue;
      const seed = v.x * 12.9 + v.z * 78.2;
      const many = 3 + (Math.floor(Math.abs(seed)) % 4);
      for (let k = 0; k < many; k++) {
        // round and round, never the same way twice, now and then straight into the glass
        const a = t * (2.6 + k * 0.9) + seed + k * 2.1 + Math.sin(t * 1.7 + k * 5 + seed) * 1.4;
        const r = 0.12 + 0.24 * (0.5 + 0.5 * Math.sin(t * 2.3 + k * 3.3 + seed)) + 0.06 * Math.sin(t * 11 + k);
        this.fx.mote(v.x + Math.cos(a) * r, v.y - 0.14 + Math.sin(t * 3.1 + k * 1.9) * 0.13, v.z + Math.sin(a) * r, 0.013, 0.6, 0.56, 0.46, 0.9);
      }
      if (++n >= 8) break;
    }
    // and into the beam of your own torch: two or three always find it
    if (me.alive && me.light) {
      for (let k = 0; k < 3; k++) {
        const ph = t * (3.1 + k * 0.8) + k * 2.4 + Math.sin(t * 1.3 + k * 4) * 1.6;
        const out = 1.9 + k * 0.8 + Math.sin(t * 0.7 + k) * 0.35, r = 0.07 + 0.05 * out + 0.04 * Math.sin(t * 9 + k);
        v.copy(me.lightPos).addScaledVector(me.barrel, out);
        this.fx.mote(v.x + Math.cos(ph) * r, v.y + Math.sin(ph * 1.3) * r, v.z + Math.sin(ph) * r, 0.007, 0.5, 0.47, 0.4, 0.9);
      }
    }
    // drips: everywhere a little, in the rooms the rain has got into a lot
    this.dripAcc += dt * 9;
    while (this.dripAcc > 1) {
      this.dripAcc -= 1;
      const a = Math.random() * 6.28, r = 0.8 + Math.random() * 8;
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const room = this.zone(x, c.y, z);
      if (room === 'street') continue;
      const wet = this.soaked.has(room) || /flood|tunnel|branch|boiler|cold|scrub|kitchen|plant|cor|atrium|sales|stock|loft/.test(room);
      if (!wet && Math.random() > 0.25) continue;
      const floor = this.L.world.floorAt(x, c.y + 0.3, z, 0.05);
      const up = this.L.world.ray(x, floor + 1.2, z, 0, 1, 0, 6);
      if (!up || floor < c.y - 3 || this.drips.length > 60) continue;
      this.drips.push({ x, y: floor + 1.2 + up.t - 0.02, z, vy: 0, floor });
    }
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.vy -= 9.8 * dt;
      d.y += d.vy * dt;
      if (d.y <= d.floor) {
        this.fx.spatter(d.x, d.floor, d.z, 1);
        if (Math.hypot(d.x - c.x, d.z - c.z) < 5 && Math.random() < 0.5) this.sound.drip(v.set(d.x, d.floor, d.z));
        this.drips.splice(i, 1);
      } else {
        this.fx.mote(d.x, d.y, d.z, 0.012, 0.62, 0.66, 0.7, 0.8);
        this.fx.mote(d.x, d.y - d.vy * 0.012, d.z, 0.009, 0.62, 0.66, 0.7, 0.5);
      }
    }
    this.pipes(dt);
    // breath shows in the cold rooms, in the cellars and out in the rain: everyone's, yours from just under the lens
    this.breathT -= dt;
    if (this.breathT <= 0) {
      this.breathT = 2.6 + Math.random() * 0.8;
      for (const [s, a] of this.actors) {
        if (!a.info.alive) continue;
        const mine = s === this.mySlot;
        const x = mine ? c.x : a.x, y = mine ? c.y - 0.02 : a.y + ((a.flags & F.crouch) ? 1.05 : 1.6), z = mine ? c.z : a.z;
        if (Math.hypot(x - c.x, z - c.z) > 16) continue;
        const room = this.zone(x, y, z);
        if (!(room === 'street' || y < -1 || /cold|morgue|plant|flood|tunnel|branch|boiler|stock/.test(room))) continue;
        const yaw = mine ? me.yaw : a.yaw;
        this.fx.breath(x, y, z, -Math.sin(yaw), -Math.cos(yaw), mine ? 0.7 : 1);
      }
    }
  }

  /**
   * The sprinkler main under the corridor ceilings has been holding pressure for years. Every couple of minutes a
   * coupling somewhere along it lets go: a bang, and water comes down hard for a quarter of a minute, then less, then drips.
   * It happens down the corridor from whoever is watching, never on top of them, and the bots go to see what the noise was
   */
  private pipe = { at: 55 + Math.random() * 50, t: 0, x: 0, y: 0, z: 0, floor: 0 };
  private pipes(dt: number) {
    const P = this.pipe, c = this.cam.position;
    const shop = !!this.L.map.rooms?.some((r) => r.name === 'backcor');
    if (!shop && !this.L.map.rooms?.some((r) => r.name === 'scor')) return;
    if (P.t <= 0) {
      if (!this.inMatch || this.time < P.at) return;
      P.at = this.time + 80 + Math.random() * 90;
      const fy = c.y > 2.6 && !shop ? 3.6 : 0;
      if (c.y < -1.5 || (shop && c.y > 2.6)) return;
      // the hospital has a main down each corridor on both floors; the shop has one, under the back corridor's ceiling
      const z = shop ? -30.5 : Math.abs(c.z + 6.5) < Math.abs(c.z + 25.5) ? -6.5 : -25.5;
      const heads: number[] = [];
      for (let x = shop ? 0 : 0.5; x + 3 < (shop ? 30.1 : 51.7); x += 3) for (const h of [0.75, 2.25]) if (Math.abs(x + h - c.x) > 5 && Math.abs(x + h - c.x) < 15) heads.push(x + h);
      if (!heads.length) return;
      const x = heads[Math.floor(Math.random() * heads.length)];
      const up = this.L.world.ray(x, fy + 1.4, z, 0, 1, 0, 4);
      if (!up) return;
      Object.assign(P, { t: 34, x, y: fy + 1.4 + up.t - 0.46, z, floor: this.L.world.floorAt(x, fy + 1, z, 0.05) });
      this.sound.spray(this.tmp.set(P.x, P.y, P.z), 15);
      this.match?.noise({ x: P.x, y: fy, z: P.z }, 32);
      this.rats?.startle();
      return;
    }
    P.t -= dt;
    // full bore for fourteen seconds, then the pressure goes
    const k = P.t > 20 ? 1 : P.t > 14 ? (P.t - 14) / 6 * 0.85 + 0.15 : 0.12 * (P.t / 14);
    this.fx.jet(P.x, P.y, P.z, k, dt);
    const hits = Math.ceil(dt * 60 * k);
    for (let i = 0; i < hits; i++) {
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * (0.4 + 2.2 * k);
      this.fx.spatter(P.x + Math.cos(a) * r, P.floor, P.z + Math.sin(a) * r, 1);
    }
    // stand under it and the lens is running with water
    if (Math.hypot(P.x - c.x, P.z - c.z) < 2.4 && Math.abs(c.y - P.floor) < 2.5) this.wet = Math.max(this.wet, 0.9 * k);
  }

  /** every head the camera can see, followed the way redaction software follows one: a beat behind, and generous */
  private tracks = new Map<number, { x: number; y: number; r: number; w: number }>();
  private redact(dt: number) {
    const cam = this.cam, post = this.post, v = this.tmp;
    const tan = Math.tan((cam.fov * Math.PI) / 360);
    const found: [number, number][] = [];
    for (const [s, a] of this.actors) {
      const sol = a.soldier;
      let tr = this.tracks.get(s);
      let seen = false, x = 0, y = 0, r = 0, dist = 0;
      if (sol && sol.root.visible && !(s === this.mySlot && this.me.alive) && a.y > -20 && (a.info.alive || sol.dead >= 0)) {
        const h = sol.head;
        dist = cam.position.distanceTo(h);
        v.copy(h).project(cam);
        if (v.z < 1 && dist > 0.25 && dist < 60 && Math.abs(v.x) < 1.25 && Math.abs(v.y) < 1.25) {
          x = v.x * 0.5 + 0.5;
          y = v.y * 0.5 + 0.5;
          r = 0.15 / (2 * dist * tan);
          seen = this.L.world.sees(cam.position, { x: h.x, y: h.y + 0.05, z: h.z });
        }
      }
      if (!tr) {
        if (!seen) continue;
        this.tracks.set(s, (tr = { x, y, r, w: 0 }));
      }
      if (seen) {
        const k = Math.min(1, dt * 26);
        tr.x += (x - tr.x) * k;
        tr.y += (y - tr.y) * k;
        tr.r += (r - tr.r) * Math.min(1, dt * 14);
      }
      tr.w = Math.max(0, Math.min(1, tr.w + (seen ? dt * 7 : -dt * 4)));
      if (tr.w <= 0) this.tracks.delete(s);
      else found.push([dist || 99, s]);
    }
    found.sort((p, q) => p[0] - q[0]);
    let n = 0;
    for (const [, s] of found) {
      if (n >= post.faces.length) break;
      const tr = this.tracks.get(s)!;
      post.faces[n++].set(tr.x, tr.y, Math.max(0.008, tr.r), tr.w);
    }
    post.mFinal.uniforms.faceN.value = n;
  }

  /** lightning, thunder, and the noises an empty building makes */
  private night(dt: number, outside: boolean) {
    this.sound.dread(this.cam.position, this.cam.position.y < -1, dt, this.inMatch && !outside);
    this.thunderT -= dt;
    if (this.thunderT <= 0 && (this.L.map.weather?.rain ?? 1) > 0) {
      // now and then, one sheet of it a long way off: not a strobe
      this.thunderT = 70 + Math.random() * 110;
      const near = Math.random() * 0.6;
      this.sound.thunder(0.4 + (1 - near) * 3.2, near);
    }
    let f = 0;
    for (let i = 0; i < this.flashes.length; i += 3) {
      const t0 = this.flashes[i], len = this.flashes[i + 1], k = this.flashes[i + 2];
      if (this.time >= t0 && this.time < t0 + len) f = Math.max(f, k * (1 - (this.time - t0) / len));
    }
    if (this.flashes.length && this.time > this.flashes[this.flashes.length - 3] + 1) this.flashes.length = 0;
    LF.skyFlash.value = f;
    // indoors too: the rooms jump out of the dark for a blink, and the windows throw beams across the floor
    const sf = Math.min(1.2, f / 8);
    LF.flash.value.set(0.55, 0.62, 0.9).multiplyScalar(sf * 0.03);
    if (this.shafts) this.shafts.bolt = sf;
    if (f > 0 && outside) this.whiteout = Math.max(this.whiteout, f * 0.006);
    this.creakT -= dt;
    if (this.creakT <= 0 && this.inMatch) {
      this.creakT = 14 + Math.random() * 26;
      // somewhere off in the dark, not where anyone is
      const c = this.cam.position;
      const a = Math.random() * 6.283, d = 14 + Math.random() * 18;
      const p = new THREE.Vector3(c.x + Math.cos(a) * d, c.y + (Math.random() - 0.4) * 3, c.z + Math.sin(a) * d);
      const r = Math.random();
      // in the shop: a trolley moves, something comes off a shelf
      if (MAP_ID === 'store' && r > 0.62) {
        p.y = 0.4;
        if (r > 0.82) this.sound.trolley(p);
        else this.sound.tin(p);
      } else if (r < 0.15) this.sound.groan(p);
      else if (r < 0.5) this.sound.creak(p);
      else if (r < 0.8) this.sound.impact(p, Math.random() < 0.5 ? 'metal' : 'wood');
      else this.sound.door(p, Math.random() < 0.5);
    }
  }

  private landShots(e: Extract<Ev, { t: 'shot' }>, sounds: boolean) {
    this.lampShots(e);
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
      // a round into stocked shelving: something on it bursts, and something else goes on the floor
      if (MAP_ID === 'store' && surf !== 'flesh' && y > 0.15 && y < 2.1 && x > 15 && x < 45 && z < -10.8 && z > -25.8 && Math.abs(x - (16 + 4 * Math.round((x - 16) / 4))) < 0.75) {
        this.fx.spatter(x, y - 0.03, z, 1.5);
        this.knockOff(x, y, z, nx, nz);
        if (Math.random() < 0.4) this.sound.tin(this.tmp.set(x, 0.3, z));
        else if (Math.random() < 0.3) this.sound.impact(this.tmp.set(x, y, z), 'glass');
      }
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
      const hit = this.phys.shot(O[0], O[1], O[2], dx / d, dy / d, dz / d, d, shove * 2.8);
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

  muzzleLight(p: THREE.Vector3, k = 3) {
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
    // a soft picture is worse than a missing effect: the resolution only gives a little, then the air, the
    // occlusion and the reflections go, and only then does it come down further
    const floor = this.liteK >= 2 ? 0.62 : 0.8;
    if (fps < 42) this.scale = Math.max(floor, this.scale * Math.max(0.88, Math.sqrt(fps / 50)));
    else if (fps > 55 && this.scale < 1) this.scale = Math.min(1, this.scale * 1.05);
    if (this.scale <= 0.81 && fps < 40) this.liteK++;
    else if (fps > 55 && this.liteK > 0) this.liteK--;
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
        // the camera rides on the vest, 13 cm under the eyes: the body I see goes down with it, or the shoulders loom over the lens
        sol.update(dt, me.m.x, me.m.y - 0.13, me.m.z, me.yaw, me.pitch, me.leanK, mine.flags, v, Math.atan2(-me.m.vx, -me.m.vz));
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
    // people don't block each other: you walk through a friend (or a foe) in a doorway rather than stick
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
            this.fx.drip(body.x, body.y + 0.9, body.z, s === this.mySlot ? me.m.vx : -Math.sin(a.moveYaw) * a.speed, s === this.mySlot ? me.m.vz : -Math.cos(a.moveYaw) * a.speed);
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
    this.redact(dt);
    this.phys.step(dt);
    this.lights(dt);
    this.fxNades(dt);
    this.stirring(dt);
    this.rats?.update(dt, this.cam.position);
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
    u.hurt.value = Math.min(1, this.hurt * 0.7 + (me.alive ? Math.max(0, (45 - hp) / 45) * 0.5 + me.supK * 0.3 : 0.12));
    u.fish.value = THREE.MathUtils.lerp(0.85, 0.3, me.alive ? me.adsK : 0);
    u.cover.value = me.alive ? me.fixK : 0;
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
      // the feed tears at every knock, stutters now and then, and breaks up for good at the end
      const d = this.dead, j = this.dc.jolt;
      u.glitch.value = Math.min(0.5, j * j * j * 0.3 + (d > 3.9 ? ((d - 3.9) / 0.55) ** 2 * 0.09 : 0) + (d > 1.2 && Math.sin(d * 7.3) * Math.sin(d * 2.9) > 0.93 ? 0.12 : 0));
      u.caK.value = this.caBase + j * 0.05 + Math.min(0.03, d * 0.007);
    } else {
      u.glitch.value = 0;
      u.caK.value = this.caBase;
    }
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
        this.fx.tread(s, a.x, a.y, a.z, a.moveYaw);
      }
    }
  }

  private flickOf = new Map<MapData['lights'][number], Loaded['flicks'][number]>();
  /** a round through a lamp puts it out: every screen works it out from the same shot, so it's dark for everyone */
  private lampShots(e: Extract<Ev, { t: 'shot' }>) {
    const fl = this.L.flicks;
    for (let i = 0; i < e.surf.length; i++) {
      const o = i * 6;
      // every point is somewhere along a round's way from the muzzle (pellets each have their own), except the one after
      // a skip, which starts where the round glanced off
      const skipped = i > 0 && e.surf[i - 1]?.[0] === '~';
      const ax = skipped ? e.e[o - 6] : e.o[0], ay = skipped ? e.e[o - 5] : e.o[1], az = skipped ? e.e[o - 4] : e.o[2];
      const bx = e.e[o], by = e.e[o + 1], bz = e.e[o + 2];
      const dx = bx - ax, dy = by - ay, dz = bz - az, len2 = dx * dx + dy * dy + dz * dz;
      if (len2 > 1e-6 && len2 < 160 * 160) {
        for (let k = 0; k < fl.length; k++) {
          const f = fl[k];
          if (f.dead) continue;
          const p = f.l.pos;
          // nearest the round came to the lamp, and for a tube nearest to anywhere along it
          const t = THREE.MathUtils.clamp(((p[0] - ax) * dx + (p[1] - ay) * dy + (p[2] - az) * dz) / len2, 0, 1);
          const qx = ax + dx * t - p[0], qy = ay + dy * t - p[1], qz = az + dz * t - p[2];
          const ex = Math.max(0, Math.abs(qx) - f.half[0]), ez = Math.max(0, Math.abs(qz) - f.half[1]);
          const r = f.l.kind === 'spot' ? 0.24 : f.l.kind === 'area' ? 0.14 : 0.17;
          if (ex * ex + qy * qy + ez * ez > r * r) continue;
          this.lampOut(k, true);
        }
      }
    }
  }

  lampOut(k: number, fx: boolean) {
    const f = this.L.flicks[k];
    if (!f || f.dead) return;
    f.dead = true;
    f.dying = 0.5;
    this.match?.lampOut(this.L.map.lights.indexOf(f.l));
    if (!fx) return;
    const p = this.tmp.set(f.l.pos[0], f.l.pos[1], f.l.pos[2]).clone();
    this.fx.impact(p.x, p.y, p.z, 0, -1, 0, 'metal');
    this.fx.impact(p.x, p.y - 0.03, p.z, 0, -1, 0, 'glass');
    this.fx.skip(p.x, p.y, p.z, 0, -1, 0);
    this.sound.impact(p, 'glass');
    this.sound.tink(p);
    if (p.distanceTo(this.cam.position) < 30) this.muzzleLight(p, 2.2);
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
      if (f.dead) {
        // the filament's last word: a couple of blinks, then nothing
        f.dying = Math.max(0, f.dying - dt);
        f.k = 1;
        f.mesh.visible = f.k < 1;
      } else if (a <= 0) {
        continue;
      } else if (a > 0.3) {
        // a tube on its last legs: it used to stutter and go out, over and over, and that's all anyone saw of the place.
        // Now it only wavers, slowly, a few parts in a hundred
        f.k = Math.max(0, 0.035 + 0.035 * Math.sin(performance.now() * 0.0011 + f.base.r * 40) + 0.02 * Math.sin(performance.now() * 0.0047 + f.base.g * 23)) * Math.min(1, a);
      } else {
        // a flame: never out, never still
        const n = Math.sin(performance.now() * 0.0031 + f.base.g * 31) * 0.5 + Math.sin(performance.now() * 0.0073 + f.base.b * 17) * 0.5;
        f.k = Math.max(0, n * a * 0.22 + 0.1 * a);
      }
      f.mat.color.copy(f.base).multiplyScalar(1 - f.k * 0.94);
    }
    // eight places in the shaders: the nearest lamps that are down at all, or could be at any moment
    const near = fl.filter((f) => f.dead || f.l.flicker).map((f) => [Math.hypot(f.l.pos[0] - c.x, f.l.pos[1] - c.y, f.l.pos[2] - c.z), f] as [number, typeof fl[number]]).sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < 8; i++) {
      const e = near[i];
      const P = LF.flickP.value[i];
      if (!e || e[0] > 40) {
        P.w = 0;
        continue;
      }
      const l = e[1].l;
      // how far the lamp's own light reaches in the bake, roughly
      // a lamp that's out for good takes more of the room with it than one that only stutters
      const reach = (l.reach ?? (l.kind === 'spot' ? 7 : l.kind === 'area' ? 5.5 : Math.max(1.6, Math.sqrt(l.power) * 1.6))) * (e[1].dead ? 1.55 : 1);
      // a spot's light is out in front of it, where it points
      const ax = l.aim ? l.aim[0] : 0, ay = l.aim ? l.aim[1] : -1, az = l.aim ? l.aim[2] : 0, al = Math.hypot(ax, ay, az) || 1;
      const push = l.kind === 'spot' ? Math.min(2.6, reach * 0.3) : 0.4;
      P.set(l.pos[0] + (l.kind === 'spot' ? (ax / al) * push : 0), l.pos[1] + (l.kind === 'spot' ? (ay / al) * push : -0.4), l.pos[2] + (l.kind === 'spot' ? (az / al) * push : 0), reach);
      LF.flickA.value[i] = e[1].k;
    }
  }

  /** star shells over the field: each a hard white light swinging under its parachute, flickering as it burns */
  private flares(dt: number) {
    const spec = this.L.map.flares;
    if (this.inMatch) this.matchT += dt;
    const now = spec ? flaresAt(this.inMatch ? this.matchT : this.time, spec, this.flareNow) : this.flareNow;
    let glow = 0;
    this.flareLights.forEach((l, i) => {
      const f = now[i];
      const sp = this.flareSprites[i];
      if (!f) {
        l.intensity = 0;
        sp.visible = false;
        return;
      }
      const sway = Math.sin(this.time * 1.7 + f.id) * 0.9;
      const fl = 0.86 + 0.1 * Math.sin(this.time * 23 + f.id * 3) + 0.06 * Math.sin(this.time * 41 + f.id);
      l.position.set(f.x + sway, f.y, f.z + Math.cos(this.time * 1.3 + f.id) * 0.6);
      l.intensity = 50 * f.k * fl;
      sp.visible = f.k > 0.01;
      sp.position.copy(l.position);
      sp.material.opacity = Math.min(1, f.k * 1.4);
      sp.scale.setScalar(2.2 + f.k * 1.8);
      glow = Math.max(glow, f.k * Math.min(1, f.y / 20));
      // the thump of the pistol that fired it, from the line it came from
      if (!this.flareSeen.has(f.id) && f.k < 0.13 && f.y < spec!.h * 0.3) {
        this.flareSeen.add(f.id);
        const d = Math.hypot(f.x - this.cam.position.x, f.z - this.cam.position.z);
        this.sound.thunder(0.05 + d / 340, Math.max(0, 1 - d / 60) * 0.25);
      }
    });
    // the low cloud takes some of it
    if (glow > 0) LF.skyFlash.value = Math.max(LF.skyFlash.value, glow * 1.6);
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
      const fk = this.flickOf.get(l)?.k ?? 0;
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
    this.flares(dt);
    // the air sees the same flashlight and the same flash
    if (me.alive && me.light) {
      AIR.beamP.value.set(me.lightPos.x, me.lightPos.y, me.lightPos.z, s.intensity * 0.12);
      AIR.beamD.value.copy(me.barrel);
    } else if (!(this.dead >= 0 && me.light && this.dropLight)) AIR.beamP.value.w = 0;
    this.shafts?.update(this.time, this.cam, (l) => { const f = this.flickOf.get(l as never); return f ? (f.dead ? 1 - f.k : 1 - f.k * 0.94) : 1; });
    const fp = this.flashPoint.position;
    AIR.spark.value.set(fp.x, fp.y, fp.z, this.flashK * 0.022);
    if (me.alive && me.light) {
      const hit = this.L.world.ray(me.lightPos.x, me.lightPos.y, me.lightPos.z, me.barrel.x, me.barrel.y, me.barrel.z, 16);
      let t = hit ? hit.t : 16;
      // someone stood in the beam is nearer than the wall behind them: the lamp is turned down for them as it is for a wall,
      // or a figure at arm's length is a white shape with nothing on it
      for (const [k, a] of this.actors) {
        if (k === this.mySlot || !a.soldier?.root.visible) continue;
        const dx = a.x - me.lightPos.x, dy = a.y + 1.1 - me.lightPos.y, dz = a.z - me.lightPos.z;
        const al = dx * me.barrel.x + dy * me.barrel.y + dz * me.barrel.z;
        if (al > 0.3 && al < t && Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - al * al)) < 0.25 + al * 0.3) t = Math.min(t, al * 1.4 + 1.1);
      }
      const wantI = 30 * Math.min(1, Math.pow(Math.min(t, 7) / 5.5, 1.6) + 0.04);
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
      b.intensity = this.bounceK * (s.intensity / 30) * 0.8;
    } else if (this.dead >= 0 && me.light && this.dropLight) {
      // the gun went down with its light still on: it lies where it fell and throws a long low fan across the floor
      const d = this.dropLight, fl = this.L.world.floorAt(d.x, d.y + 0.3, d.z, 0.05) + 0.07;
      d.vy -= 9.8 * dt;
      d.y = Math.max(fl, d.y + d.vy * dt);
      if (d.y <= fl) d.vy = 0, d.pitch += (0.05 - d.pitch) * Math.min(1, dt * 8);
      s.intensity += (16 - s.intensity) * Math.min(1, dt * 6);
      s.position.set(d.x, d.y, d.z);
      const cp = Math.cos(d.pitch);
      s.target.position.set(d.x - Math.sin(d.yaw) * cp * 5, d.y + Math.sin(d.pitch) * 5, d.z - Math.cos(d.yaw) * cp * 5);
      AIR.beamP.value.set(d.x, d.y, d.z, s.intensity * 0.12);
      AIR.beamD.value.set(-Math.sin(d.yaw) * cp, Math.sin(d.pitch), -Math.cos(d.yaw) * cp);
      this.bounceK = 0;
      this.bounce.intensity = 0;
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
      o.intensity = 22;
      const yaw = a.yaw, cp = Math.cos(a.pitch);
      const f = this.tmp.set(-Math.sin(yaw) * cp, Math.sin(a.pitch), -Math.cos(yaw) * cp);
      // the light is on the gun: forward of the chest, a little to the right, a little low
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      o.position.set(a.x + f.x * 0.62 + rx * 0.12, a.y + ((a.flags & F.crouch) ? 0.92 : 1.36) + f.y * 0.62, a.z + f.z * 0.62 + rz * 0.12);
      o.target.position.copy(o.position).addScaledVector(f, 5);
    });
    // their beams in the air: as far as the first wall, brighter near the lens
    this.beams.forEach((bm, i) => {
      const o = this.others[i];
      if (!o || o.intensity <= 0.01) { bm.visible = false; return; }
      const dx = o.target.position.x - o.position.x, dy = o.target.position.y - o.position.y, dz = o.target.position.z - o.position.z;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const hit = this.L.world.ray(o.position.x, o.position.y, o.position.z, dx / dl, dy / dl, dz / dl, BEAM_L, true);
      bm.visible = true;
      bm.position.copy(o.position);
      bm.lookAt(o.target.position);
      bm.scale.setScalar(Math.max(0.3, hit ? hit.t : BEAM_L) / BEAM_L);
      const u = (bm.material as THREE.ShaderMaterial).uniforms;
      u.time.value = this.time;
      u.axis.value.set(dx / dl, dy / dl, dz / dl);
    });
    this.flashPoint.intensity = this.flashK * 7;
    this.flashK = Math.max(0, this.flashK - dt * 110);
    // the fill stands behind and above the lens: from there the near arm and the far hand get much the same of it,
    // where a light among the arms burnt whatever passed closest white
    const cf = this.tmp.set(0.05, 0.22, 0.7).applyQuaternion(this.cam.quaternion);
    this.fill.position.copy(this.cam.position).add(cf);
    this.fill.intensity = me.alive ? 0.11 : 0;
    // a light aimed at the lens blooms across it, if nothing's between
    this.others.forEach((o, i) => {
      const g = this.glares[i];
      if (!g) return;
      if (o.intensity <= 0.01) { g.visible = false; return; }
      const to = this.tmp.copy(this.cam.position).sub(o.position);
      const d = to.length();
      to.divideScalar(d || 1);
      const fx = o.target.position.x - o.position.x, fy = o.target.position.y - o.position.y, fz = o.target.position.z - o.position.z;
      const fl = Math.hypot(fx, fy, fz) || 1;
      const al = (to.x * fx + to.y * fy + to.z * fz) / fl;
      // the lens itself glints from anywhere in front of it; looking down the beam, it whites the picture out
      const k = THREE.MathUtils.smoothstep(al, 0.86, 0.995);
      const kw = Math.pow(THREE.MathUtils.smoothstep(al, -0.15, 1.0), 3);
      const blocked = kw > 0 && !!this.L.world.ray(this.cam.position.x, this.cam.position.y, this.cam.position.z, -to.x, -to.y, -to.z, Math.max(0, d - 0.6), true);
      this.glareVis[i] += ((blocked ? 0 : 1) - this.glareVis[i]) * Math.min(1, dt * 3.5);
      g.visible = kw > 0.003 && this.glareVis[i] > 0.01;
      if (!g.visible) return;
      g.position.copy(o.position);
      // a torch in the lens is a soft bloom, not a searchlight: it must never take the picture
      g.material.opacity = Math.min(0.5, kw * 0.3 + k * 0.4) * this.glareVis[i];
      g.scale.setScalar((0.08 + kw * 0.16 + k * 0.36) * Math.min(1.2, d / 3 + 0.45));
    });
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

  /**
   * Dropped. The camera is still clipped to the vest, so it does what the chest does: it folds, twists and goes down with
   * the body, the picture set by where the shoulders and the head are, not by any animation. Half the time the fall
   * knocks it off its clip: it bounces, skids and comes to rest on its side on the floor, looking back along the
   * boards at the man who was wearing it. It records for another four seconds, tearing at each knock, and then it stops.
   */
  private dc = { loose: false, will: false, hit: false, jolt: 0, side: 1, lt: 0, beat: 0, yaw: null as number | null, w: new THREE.Vector3(), ground: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), last: new THREE.Vector3() };
  private deadCam(dt: number, mine: Actor) {
    const was = this.dead;
    this.dead += dt;
    const t = this.dead;
    const sol = mine.soldier, dc = this.dc, cam = this.cam, W = this.L.world;
    if (was === 0) {
      Object.assign(dc, { loose: false, hit: false, will: Math.random() < 0.5, jolt: 1, side: Math.random() < 0.5 ? 1 : -1, lt: 0, beat: 0, yaw: null });
      dc.last.copy(cam.position);
      // the round that did it: a jerk the way it was going, and some of you on the glass
      dc.v.set(Math.sin(this.killYaw), 0, Math.cos(this.killYaw));
      this.lensBlood = Math.min(1.2, this.lensBlood + 0.4);
      this.post.splat();
    }
    dc.jolt = Math.max(0, dc.jolt - dt * 2.4);
    const P = sol?.person;
    if (!dc.loose && sol && P) {
      const chest = P.worldOf('Bip01_Spine2', new THREE.Vector3());
      const up = new THREE.Vector3().copy(sol.head).sub(chest);
      if (up.lengthSq() < 1e-4) up.set(0, 1, 0);
      up.normalize();
      const side = P.worldOf('Bip01_R_UpperArm', new THREE.Vector3()).sub(P.worldOf('Bip01_L_UpperArm', new THREE.Vector3()));
      const front = new THREE.Vector3().crossVectors(up, side);
      if (front.lengthSq() < 1e-4) front.set(-Math.sin(mine.yaw), 0, -Math.cos(mine.yaw));
      front.normalize();
      const z = front.clone().negate();
      const x = new THREE.Vector3().crossVectors(up, z).normalize();
      const y = new THREE.Vector3().crossVectors(z, x);
      const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      const pos = chest.addScaledVector(front, 0.15).addScaledVector(up, 0.06);
      const floor = W.floorAt(pos.x, pos.y + 0.3, pos.z, 0.05);
      const low = pos.y < floor + 0.42;
      pos.y = Math.max(pos.y, floor + 0.07);
      const vel = new THREE.Vector3().copy(pos).sub(dc.last).divideScalar(Math.max(dt, 1e-3));
      dc.last.copy(pos);
      cam.position.lerp(pos, Math.min(1, dt * 30));
      cam.quaternion.slerp(q, Math.min(1, dt * (6 + t * 14)));
      if (!dc.hit && t > 0.25 && low) {
        // the floor
        dc.hit = true;
        dc.jolt = 1;
        this.sound.step(null, this.surfaceAt(pos.x, pos.y, pos.z), 6, 1.5);
        if (dc.will) {
          dc.loose = true;
          dc.p.copy(cam.position);
          dc.v.copy(vel).multiplyScalar(0.5).addScaledVector(front, 1.1 + Math.random() * 0.9).addScaledVector(x, (Math.random() - 0.5) * 1.6);
          dc.v.y = 1.5 + Math.random();
          // it leaves spinning
          dc.w.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.6, Math.random() - 0.5).normalize().multiplyScalar(7 + Math.random() * 6);
          dc.ground = 0;
          this.sound.clack(null, 'mag_out');
        }
      }
    } else if (dc.loose) {
      dc.lt += dt;
      const p = dc.p, v = dc.v;
      v.y -= 9.8 * dt;
      const hs = Math.hypot(v.x, v.z);
      if (hs > 0.05) {
        // a wall stops it dead
        const h = W.ray(p.x, p.y + 0.03, p.z, v.x / hs, 0, v.z / hs, hs * dt + 0.08);
        if (h) {
          // off the wall: it keeps a third of its speed along it and comes back off it with less
          const into = v.x * h.nx + v.z * h.nz;
          v.x -= h.nx * into * 1.35;
          v.z -= h.nz * into * 1.35;
          v.x *= 0.6;
          v.z *= 0.6;
          dc.w.multiplyScalar(0.6).add(this.tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(5));
          dc.jolt = Math.max(dc.jolt, 0.6);
          this.sound.clack(null, 'mag_in');
        }
      }
      p.addScaledVector(v, dt);
      const floor = W.floorAt(p.x, p.y + 0.25, p.z, 0.04) + 0.045;
      if (p.y < floor) {
        p.y = floor;
        if (v.y < -0.9) {
          // a bounce: each one lower, each one knocking the spin somewhere new
          const hit = -v.y;
          v.y *= -0.36;
          dc.w.multiplyScalar(0.5).add(this.tmp.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5).multiplyScalar(hit * 2.6));
          dc.jolt = Math.max(dc.jolt, Math.min(1, hit * 0.3));
          this.sound.clack(null, 'mag_in');
        } else {
          v.y = 0;
          dc.ground += dt;
        }
        // a plastic box on a hard floor: it slides, and the floor takes the spin out of it
        const f = Math.exp(-dt * 3.2);
        v.x *= f;
        v.z *= f;
        dc.w.multiplyScalar(Math.exp(-dt * 5));
      }
      // turning over as a thing in the air does: about whatever axis it left with
      const wl = dc.w.length();
      if (wl > 0.05) cam.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(this.tmp.copy(dc.w).divideScalar(wl), wl * dt));
      cam.position.copy(p);
      // end over end while it flies, then on its side, lens back toward the body
      const body = sol ? sol.head : this.deadFrom;
      if (dc.yaw === null && dc.lt > 0.35) {
        // where it ends up pointing: back at the body if there's a clear look at it, else down the longest stretch of floor
        const toBody = Math.atan2(-(body.x - p.x), -(body.z - p.z)) + dc.side * 0.32;
        let best = toBody, bs = -1;
        for (let k = 0; k < 9; k++) {
          const a = k === 0 ? toBody : (k / 8) * Math.PI * 2;
          const h = W.ray(p.x, p.y + 0.06, p.z, -Math.sin(a), 0.03, -Math.cos(a), 7);
          const sc = (h ? h.t : 7) + (k === 0 ? 2.5 : 0);
          if (sc > bs) {
            bs = sc;
            best = a;
          }
        }
        dc.yaw = best;
      }
      const yaw = dc.yaw ?? Math.atan2(-(body.x - p.x), -(body.z - p.z));
      // once it has stopped bouncing it rocks over onto its flat side and stays there
      const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, yaw, dc.side * 1.34, 'YXZ'));
      const settle = Math.min(1, dc.ground / 0.45);
      cam.quaternion.slerp(rest, Math.min(1, dt * 9 * settle * settle));
    } else if (sol) cam.position.lerp(this.tmp.copy(sol.head).setY(Math.max(sol.head.y, mine.y + 0.1)), Math.min(1, dt * 24));
    // every knock shakes the housing
    if (dc.jolt > 0.02) {
      const j = dc.jolt * dc.jolt * 0.11;
      cam.rotateX((Math.random() - 0.5) * j);
      cam.rotateZ((Math.random() - 0.5) * j * 1.6);
    }
    // the mic is against the chest: a heart that is stopping
    const beats = [0.3, 0.95, 1.8, 2.95];
    if (dc.beat < beats.length && t >= beats[dc.beat]) this.sound.heart(1 - dc.beat * 0.24), dc.beat++;
    if (this.cam.fov !== 92) {
      this.cam.fov = 92;
      this.cam.updateProjectionMatrix();
    }
    this.cam.updateMatrixWorld();
    if (was < 4.3 && t >= 4.3) {
      this.sound.cut();
      this.hud.lost();
    }
    if (t >= 4.45) {
      this.frozen = true;
      if (this.cfg?.mode === 'rounds' && t > 6) this.spectate(dt);
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
    if (!my || !this.me.alive || solo(this.cfg?.mode)) return;
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
/** a soft round glow with a hot centre and short streaks, for a light seen head-on */
const BEAM_L = 14;
/** a cone from the lens forward, BEAM_L long, opening as the light does */
function beamGeo() {
  const r = Math.tan(0.2) * BEAM_L;
  const g = new THREE.ConeGeometry(r, BEAM_L, 28, 8, true);
  g.translate(0, -BEAM_L / 2, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}
/** light in dusty air: brightest down the middle and near the lens, gone at the cone's edge, drifting motes in it */
function beamMat() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, col: { value: new THREE.Color(0.9, 0.93, 1.0) }, axis: { value: new THREE.Vector3(0, 0, 1) } },
    vertexShader: `varying float vA; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4( position, 1.0 );
        vW = w.xyz;
        vA = position.z / ${BEAM_L.toFixed(1)};
        vN = normalize( mat3( modelMatrix ) * normal );
        vV = normalize( cameraPosition - w.xyz );
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `uniform float time; uniform vec3 col; uniform vec3 axis; varying float vA; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      float h( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
      float n3( vec3 p ) { vec3 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
        return mix( mix( mix( h( i ), h( i + vec3( 1, 0, 0 ) ), f.x ), mix( h( i + vec3( 0, 1, 0 ) ), h( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                    mix( mix( h( i + vec3( 0, 0, 1 ) ), h( i + vec3( 1, 0, 1 ) ), f.x ), mix( h( i + vec3( 0, 1, 1 ) ), h( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z ); }
      void main() {
        float c = abs( dot( normalize( vN ), normalize( vV ) ) );
        float core = pow( c, 3.0 );
        float along = clamp( vA, 0.0, 1.0 );
        float fall = smoothstep( 0.0, 0.05, along ) * pow( 1.0 - along, 2.2 ) / ( 0.25 + along * 3.0 );
        float dust = 0.65 + 0.7 * n3( vW * 2.2 + vec3( 0.0, time * 0.12, time * 0.05 ) );
        // seen end-on it's the glare's job, and right at the lens it's nothing: no fog wall in the face
        float endOn = 1.0 - pow( abs( dot( normalize( vV ), axis ) ), 3.0 );
        float near = smoothstep( 0.4, 2.2, distance( cameraPosition, vW ) );
        float a = core * fall * dust * endOn * near * 0.2;
        gl_FragColor = vec4( col * a, 1.0 );
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function glareTex(): THREE.Texture {
  // an LED straight into a small lens: a white-hot core, a soft halo, the aperture's starburst, a streak across
  const N = 256, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const h = N / 2;
  // exponential, not stepped: under a night exposure any kink in the falloff shows as the edge of a disc
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const r = Math.hypot(x + 0.5 - h, y + 0.5 - h) / h;
      const v = Math.exp(-((r / 0.025) ** 2)) + 0.22 * Math.exp(-r / 0.045) + 0.035 * Math.exp(-r / 0.16);
      const e = v * (1 - smooth(0.7, 1.0, r));
      const i = (y * N + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, Math.round(e * 255));
    }
  g.putImageData(img, 0, 0);
  g.globalCompositeOperation = 'lighter';
  g.translate(h, h);
  for (let i = 0; i < 6; i++) {
    g.save();
    g.rotate((i / 6) * Math.PI * 2 + 0.26);
    const sp = g.createLinearGradient(0, 0, h, 0);
    sp.addColorStop(0, 'rgba(255,255,255,0.14)');
    sp.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sp;
    g.beginPath();
    g.moveTo(0, -2.2);
    g.lineTo(h, 0);
    g.lineTo(0, 2.2);
    g.fill();
    g.restore();
  }
  const st = g.createLinearGradient(-h, 0, h, 0);
  st.addColorStop(0, 'rgba(200,215,255,0)');
  st.addColorStop(0.5, 'rgba(225,235,255,0.12)');
  st.addColorStop(1, 'rgba(200,215,255,0)');
  g.fillStyle = st;
  g.fillRect(-h, -1.5, N, 3);
  return new THREE.CanvasTexture(c);
}

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
      // the hot spot, its corona, the reflector's bright ring at the corona's edge, then a wide flat spill
      let v = Math.exp(-((r / 0.06) ** 2)) * 1.1 + Math.exp(-((r / 0.15) ** 2)) * 0.3;
      v += Math.exp(-(((r - 0.175) / 0.018) ** 2)) * 0.1;
      v += 0.11 * (1 - smooth(0.32, 0.5, r));
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
