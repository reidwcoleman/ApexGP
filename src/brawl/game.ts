import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode, VignetteEffect, HueSaturationEffect } from 'postprocessing';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { initPhysics, makeWorld, STEP, R, solidQuery, type PartRef } from './phys.ts';
import { Fighter, emptyIntent, PEL, CHE, HEAD, type Intent, type FighterHooks } from './fighter.ts';
import { FighterLook, loadLooks } from './look.ts';
import { Arena, type ArenaCtx, type ArenaDef } from './arena.ts';
import { ARENAS } from './arenas/index.ts';
import { Brain, type AiWorld } from './ai.ts';
import { Input } from './input.ts';
import { Sound } from './audio.ts';
import { Fx } from './fx.ts';
import { Ui } from './ui.ts';

/**
 * Plush Panic: up to eight plush fighters on a Blender-built arena, last one standing wins the
 * round, first to N rounds wins. This owns the world, the loop (physics at 120 Hz, drawing at the
 * display rate), the rounds, the camera that frames everyone, and the hooks that turn physics
 * events into sound, stuffing and callouts.
 */

export interface Seat {
  id: number;
  dev: string | null;
  cpu: boolean;
  name: string;
  color: number;
  hat: string;
  level: number;
  wins: number;
}

export const COLORS = [0xff5a6e, 0x3b9cff, 0xffc93a, 0x42c86a, 0xb070ff, 0xff8a2a, 0x2fd2c9, 0xf0f0f0, 0xff7fc4, 0x8a6a52];
export const COLOR_NAMES = ['Cherry', 'Sky', 'Honey', 'Mint', 'Grape', 'Tangerine', 'Lagoon', 'Cotton', 'Bubblegum', 'Cocoa'];
const CPU_NAMES = ['Biscuit', 'Waffles', 'Noodle', 'Pickles', 'Muffin', 'Pudding', 'Dumpling', 'Toffee', 'Sprout', 'Mochi', 'Pretzel', 'Crumpet'];

type State = 'menu' | 'loading' | 'count' | 'fight' | 'roundEnd' | 'matchEnd' | 'free';

export class Game {
  renderer!: THREE.WebGLRenderer;
  composer!: EffectComposer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6a5040, 1);
  world!: RAPIER.World;
  parts = new Map<number, PartRef>();
  input!: Input;
  sound = new Sound();
  fx!: Fx;
  ui!: Ui;
  base = import.meta.env.BASE_URL;

  seats: Seat[] = [];
  fighters: Fighter[] = [];
  looks: FighterLook[] = [];
  brains = new Map<Fighter, Brain>();
  intents = new Map<Fighter, Intent>();
  seatOf = new Map<Fighter, Seat>();
  arena: Arena | null = null;
  arenaId = 'tilt';
  arenaPick = 'tilt';
  roundsToWin = 3;
  round = 0;
  state: State = 'menu';
  stateT = 0;
  fightT = 0;
  paused = false;
  time = 0;
  private acc = 0;
  private bloom!: BloomEffect;
  private gltf = new Map<string, THREE.Object3D>();
  private camPos = new THREE.Vector3(0, 10, 20);
  private camTgt = new THREE.Vector3();
  private shake = 0;
  private lastFrame = 0;
  private outT = new Map<Fighter, number>();
  attract = true;
  ctx!: ArenaCtx;
  /** test hook: run the loop by hand */
  manual = false;

  constructor(readonly canvas: HTMLCanvasElement, readonly uiRoot: HTMLElement) {}

  async boot(progress: (f: number, s: string) => void) {
    progress(0.05, 'Stuffing the plushies');
    await initPhysics();
    this.world = makeWorld();
    progress(0.25, 'Sewing on buttons');
    await loadLooks(this.base);
    progress(0.5, 'Building the arenas');
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    const comp = (this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 }));
    comp.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({ intensity: 0.9, luminanceThreshold: 1.05, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7, levels: 6 });
    comp.addPass(new EffectPass(this.camera, this.bloom, new HueSaturationEffect({ saturation: 0.12 }), new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }), new VignetteEffect({ offset: 0.32, darkness: 0.45 })));
    comp.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.fx = new Fx(this.scene);
    this.input = new Input(this.canvas);
    this.ctx = {
      world: this.world,
      scene: this.scene,
      parts: this.parts,
      fighters: () => this.fighters,
      sfx: (n, at, g) => this.sfx(n, at, g),
      burst: (at, c, n) => this.fx.hit(at, new THREE.Vector3(0, 1, 0), n ?? 8, c),
      splash: (at) => {
        this.fx.splash(at);
        this.sound.splash();
      },
    };
    addEventListener('resize', () => this.resize());
    this.resize();
    // the menu's backdrop: CPUs brawling on the first arena
    await this.loadArena(this.arenaId, (f) => progress(0.5 + f * 0.45, 'Building the arenas'));
    this.seats = this.cpuSeats(4);
    this.spawnAll();
    this.state = 'menu';
    this.ui = new Ui(this, this.uiRoot);
    progress(1, 'Ready');
    const unlock = () => this.sound.unlock();
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
    this.lastFrame = performance.now();
    if (!this.manual) requestAnimationFrame((t) => this.frame(t));
  }

  cpuSeats(n: number, from: Seat[] = []) {
    const used = new Set(from.map((s) => s.color));
    const names = CPU_NAMES.slice().sort(() => Math.random() - 0.5);
    const out: Seat[] = [];
    for (let i = 0; i < n; i++) {
      let c = 0;
      while (used.has(COLORS[c]) && c < COLORS.length - 1) c++;
      used.add(COLORS[c]);
      out.push({ id: from.length + i, dev: null, cpu: true, name: names[i % names.length], color: COLORS[c], hat: HAT_ROLL[(i * 5 + 3) % HAT_ROLL.length], level: 1, wins: 0 });
    }
    return out;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ arenas

  def(id: string): ArenaDef {
    return ARENAS.find((a) => a.id === id) ?? ARENAS[0];
  }

  async loadArena(id: string, progress?: (f: number) => void) {
    const def = this.def(id);
    let root = this.gltf.get(def.file);
    if (!root) {
      const g = await new GLTFLoader().loadAsync(this.base + 'brawl/' + def.file + '.glb', (e) => e.total && progress?.(e.loaded / e.total));
      root = g.scene;
      this.gltf.set(def.file, root);
    }
    this.clearFighters();
    if (this.arena) this.arena.dispose(this.ctx);
    this.arena = new Arena(def);
    this.arena.build(root, this.ctx);
    this.arenaId = def.id;
    this.applyLook(def);
  }

  private applyLook(def: ArenaDef) {
    const L = def.look;
    this.scene.background = skyTexture(L.sky[0], L.sky[1]);
    this.scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);
    this.sun.color.set(L.sun);
    this.sun.intensity = L.sunI;
    this.hemi.color.set(L.hemi[0]);
    this.hemi.groundColor.set(L.hemi[1]);
    this.hemi.intensity = L.hemi[2];
    this.bloom.intensity = L.bloom;
    const b = this.arena!.bounds;
    const c = b.getCenter(new THREE.Vector3());
    const r = Math.min(40, b.getSize(new THREE.Vector3()).length() * 0.5);
    const d = new THREE.Vector3(...L.sunDir).normalize();
    this.sun.position.copy(c).addScaledVector(d, 60);
    this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.near = 1;
    sc.far = 140;
    sc.updateProjectionMatrix();
    this.renderer.toneMappingExposure = L.exposure;
  }

  // ------------------------------------------------------------------ fighters

  hooks: FighterHooks = {
    parts: this.parts,
    hit: (by, who, dmg, at, part, kind) => {
      const dir = by ? new THREE.Vector3().subVectors(who.pos[CHE], by.pos[CHE]).setY(0.3).normalize() : new THREE.Vector3(0, 1, 0);
      this.fx.hit(at, dir, dmg, who.color);
      if (kind === 'slam') this.sound.thud(Math.min(1.2, dmg / 15));
      else this.sound.hit(Math.min(1.3, dmg / 14 + (part === HEAD ? 0.3 : 0)));
      if (dmg > 14) this.shake = Math.max(this.shake, Math.min(0.35, dmg / 60));
      const dev = this.seatOf.get(who)?.dev;
      if (dev) this.input.get(dev)?.rumble(Math.min(1, dmg / 20), 0.4, 110);
    },
    ko: (f) => {
      this.sound.ko();
      this.ui?.callout(`${f.name} is seeing stars`, f.color);
    },
    grab: () => this.sound.grab(),
    jump: (f) => this.sound.jump(f.slot),
    thrown: () => this.sound.whoosh(1),
    prop: (_b, _body, at, speed) => {
      if (speed > 2) this.sound.thud(0.6);
      this.fx.dustAt(at, 3);
    },
  };

  clearFighters() {
    for (const f of this.fighters) f.despawn();
    for (const l of this.looks) l.dispose(this.scene);
    this.fighters = [];
    this.looks = [];
    this.brains.clear();
    this.intents.clear();
    this.seatOf.clear();
    this.outT.clear();
  }

  spawnAll() {
    this.clearFighters();
    const a = this.arena!;
    const order = a.spawns.map((_, i) => i).sort(() => Math.random() - 0.5);
    this.seats.forEach((s, i) => {
      const f = new Fighter(this.world, i, this.hooks, s.name, s.color, s.cpu);
      const k = order[i % order.length];
      const p = a.spawns[k].clone();
      if (i >= a.spawns.length) p.y += 2.5 * Math.floor(i / a.spawns.length);
      f.spawn(p, a.spawnYaw[k] ?? 0);
      f.aimTarget = (me, fwd) => this.aimFor(me, fwd);
      this.fighters.push(f);
      this.looks.push(new FighterLook(this.scene, s.color, s.hat));
      this.intents.set(f, emptyIntent());
      this.seatOf.set(f, s);
      if (s.cpu) this.brains.set(f, new Brain(f, s.level));
    });
  }

  private aimFor(me: Fighter, fwd: THREE.Vector3) {
    let best: THREE.Vector3 | null = null, bs = 1.9;
    for (const o of this.fighters) {
      if (o === me || !o.alive || o.out) continue;
      const h = o.pos[HEAD];
      const d = new THREE.Vector3().subVectors(h, me.pos[CHE]);
      const flat = Math.hypot(d.x, d.z);
      if (flat > 1.9 || flat < 0.05) continue;
      const cos = (d.x * fwd.x + d.z * fwd.z) / flat;
      if (cos < 0.55) continue;
      const s = flat - cos * 0.6;
      if (s < bs) {
        bs = s;
        best = o.ko > 0 ? o.pos[CHE] : h;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ matches

  async startMatch(seats: Seat[], arenaPick: string, rounds: number) {
    this.attract = false;
    this.seats = seats.map((s, i) => ({ ...s, id: i, wins: 0 }));
    this.arenaPick = arenaPick;
    this.roundsToWin = rounds;
    this.round = 0;
    this.sound.startMusic('fight');
    await this.nextRound();
  }

  private pickArena() {
    if (this.arenaPick !== 'shuffle') return this.arenaPick;
    const others = ARENAS.filter((a) => a.id !== this.arenaId);
    return others[Math.floor(Math.random() * others.length)].id;
  }

  async nextRound() {
    this.round++;
    this.state = 'loading';
    const id = this.round === 1 && this.arenaPick === 'shuffle' ? ARENAS[Math.floor(Math.random() * ARENAS.length)].id : this.pickArena();
    this.ui.loading(true, this.def(id).name);
    await this.loadArena(id);
    this.spawnAll();
    this.ui.loading(false);
    this.state = 'count';
    this.stateT = 0;
    this.fightT = 0;
    this.ui.roundIntro(this.round, this.def(id));
    this.snapCamera();
  }

  backToMenu() {
    this.attract = true;
    this.state = 'menu';
    this.seats = this.cpuSeats(4);
    this.spawnAll();
    this.sound.startMusic('menu');
    this.ui.showTitle();
  }

  // ------------------------------------------------------------------ the loop

  private sfx(n: string, _at?: THREE.Vector3, g = 1) {
    const s = this.sound as unknown as Record<string, (g?: number) => void>;
    s[n]?.call(this.sound, g);
  }

  aiWorld: AiWorld = {
    fighters: [],
    center: new THREE.Vector3(),
    safe: (x, y, z) => this.safe(x, y, z),
  };

  safe(x: number, y: number, z: number) {
    const a = this.arena;
    if (!a) return true;
    const ray = new R.Ray({ x, y: y + 1.2, z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRayAndGetNormal(ray, 7, true, undefined, solidQuery());
    if (!hit || hit.normal.y < 0.5) return false;
    const hy = y + 1.2 - hit.timeOfImpact;
    if (hy < a.def.killY + 1) return false;
    if (a.script.safe && !a.script.safe(new THREE.Vector3(x, hy, z))) return false;
    return true;
  }

  frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.tick(dt);
    this.draw(dt);
  }

  /** one display frame of game time (the test tools call this directly) */
  tick(dt: number) {
    this.input.poll();
    this.ui?.update(dt);
    if (this.paused || this.state === 'loading' || !this.arena) return;
    this.time += dt;
    this.stateT += dt;
    const a = this.arena;
    const fighting = this.state === 'fight' || this.state === 'menu' || this.state === 'free' || this.state === 'roundEnd' || this.state === 'matchEnd';

    // intents
    this.aiWorld.fighters = this.fighters;
    this.aiWorld.center.copy(a.bounds.getCenter(new THREE.Vector3()));
    const cy = Math.atan2(this.camera.position.x - this.camTgt.x, this.camera.position.z - this.camTgt.z);
    for (const f of this.fighters) {
      const I = this.intents.get(f)!;
      const brain = this.brains.get(f);
      const seat = this.seatOf.get(f)!;
      if (!fighting || f.out) {
        Object.assign(I, emptyIntent());
      } else if (brain) brain.update(dt, this.aiWorld, I);
      else if (seat.dev) {
        const d = this.input.get(seat.dev);
        if (d) {
          // stick is screen-relative: up = away from the camera
          const sx = d.cur.lx, sy = d.cur.ly;
          const c = Math.cos(cy), s = Math.sin(cy);
          I.mx = sx * c + sy * s;
          I.mz = -sx * s + sy * c;
          I.run = d.held('run');
          I.jump = d.pressed('jump');
          I.punch = d.pressed('punch');
          I.kick = d.pressed('kick');
          I.grabL = d.held('grabL');
          I.grabR = d.held('grabR');
          I.lift = d.held('lift');
          I.mash = d.pressed('punch') || d.pressed('kick') || d.pressed('jump') || d.pressed('grabL') || d.pressed('grabR');
        }
      }
      f.feed(I);
    }

    // physics
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 8) {
      this.acc -= STEP;
      n++;
      const t = this.time - this.acc;
      a.script.step?.(STEP, t);
      a.syncMovers();
      for (const f of this.fighters) f.step(STEP, t);
      this.world.step();
    }
    if (n === 8) this.acc = 0;
    a.syncProps();
    a.script.frame?.(dt, this.time);

    // falling out
    for (const f of this.fighters) {
      if (!f.alive) continue;
      if (!f.out && (f.pos[PEL].y < a.def.killY || a.script.out?.(f))) {
        f.out = true;
        f.releaseAll();
        for (const g of [...f.grabbedBy]) g.releaseFighter(f);
        this.outT.set(f, 0);
        this.sound.fall();
        const by = f.lastHitBy && f.lastHitBy !== f && f.lastHitT < 8 ? f.lastHitBy : null;
        if (this.state !== 'menu') this.ui.callout(by ? `${by.name} sent ${f.name} packing` : `${f.name} is out`, f.color);
      }
      if (f.out) {
        const t = (this.outT.get(f) ?? 0) + dt;
        this.outT.set(f, t);
        if (t > 3 || f.pos[PEL].y < a.def.killY - 40) f.despawn();
      }
      f.lastHitT += dt;
    }

    this.rounds(dt);
  }

  private rounds(dt: number) {
    const alive = this.fighters.filter((f) => f.alive && !f.out);
    if (this.state === 'free') return;
    if (this.state === 'menu') {
      // the backdrop never ends: knocked-off CPUs come back
      if (alive.length <= 1 && this.stateT > 4) {
        this.stateT = 0;
        this.spawnAll();
      }
      return;
    }
    if (this.state === 'count') {
      const left = 3 - Math.floor(this.stateT);
      this.ui.countdown(left);
      if (this.stateT >= 3) {
        this.state = 'fight';
        this.stateT = 0;
      }
      return;
    }
    if (this.state === 'fight') {
      this.fightT += dt;
      if (alive.length <= 1) {
        if (this.stateT > 0.1 && this.endT === 0) this.endT = this.stateT;
        if (this.endT && this.stateT - this.endT > 1.6) {
          this.endT = 0;
          const w = alive[0] ?? null;
          const seat = w ? this.seatOf.get(w)! : null;
          if (seat) seat.wins++;
          this.state = 'roundEnd';
          this.stateT = 0;
          const done = seat && seat.wins >= this.roundsToWin;
          if (w) this.fx.confetti(w.pos[HEAD].clone().add(new THREE.Vector3(0, 1, 0)), 90);
          this.sound.fanfare();
          this.ui.roundResult(seat, this.seats, !!done);
          if (done) this.state = 'matchEnd';
        }
      } else this.endT = 0;
      return;
    }
    if (this.state === 'roundEnd' && this.stateT > 4) void this.nextRound();
  }
  private endT = 0;

  snapCamera() {
    this.updateCamera(1, true);
  }

  private updateCamera(dt: number, snap = false) {
    const a = this.arena;
    if (!a) return;
    const def = a.def;
    const pts = this.fighters.filter((f) => f.alive && (!f.out || (this.outT.get(f) ?? 0) < 0.8)).map((f) => f.pos[CHE]);
    const c = new THREE.Vector3();
    if (pts.length) {
      for (const p of pts) c.add(p);
      c.multiplyScalar(1 / pts.length);
    } else c.copy(a.bounds.getCenter(new THREE.Vector3()));
    let r = 2;
    for (const p of pts) r = Math.max(r, p.distanceTo(c));
    const aspect = Math.min(1.6, this.camera.aspect);
    const dist = THREE.MathUtils.clamp((r * 2.1) / aspect + 7, def.camMin, 46);
    const yaw = def.camYaw + (this.state === 'menu' ? Math.sin(this.time * 0.07) * 0.35 : 0);
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(def.camPitch), Math.sin(def.camPitch), Math.cos(yaw) * Math.cos(def.camPitch));
    const tgt = c.clone().add(new THREE.Vector3(0, 0.3, 0));
    const pos = tgt.clone().addScaledVector(dir, dist);
    const k = snap ? 1 : 1 - Math.exp(-dt * 2.6);
    this.camTgt.lerp(tgt, k);
    this.camPos.lerp(pos, k);
    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.2);
      const s = this.shake * 0.25;
      this.camera.position.add(new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s));
    }
    this.camera.lookAt(this.camTgt);
  }

  draw(dt: number) {
    if (!this.arena) return;
    if (!this.paused) {
      this.updateCamera(dt);
      for (let i = 0; i < this.fighters.length; i++) this.looks[i].sync(this.fighters[i], this.time, dt);
      this.fx.update(dt);
    }
    this.ui?.hud(dt);
    this.composer.render(dt);
  }
}

const HAT_ROLL = ['party', 'crown', 'beanie', 'chef', 'propeller', 'cone', 'tophat', 'daisy', 'sunhat', 'viking', 'phones', 'bucket', 'sailor'];

function skyTexture(top: number, bottom: number) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#' + new THREE.Color(top).getHexString());
  gr.addColorStop(1, '#' + new THREE.Color(bottom).getHexString());
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
