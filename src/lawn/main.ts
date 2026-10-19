import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/lilita-one/400.css';
import './lawn.css';
import * as THREE from 'three';
import { buildLevel, THEMES, type LevelDef, type Theme } from './levels.ts';
import { Lawn, type View } from './lawn.ts';
import { Mower } from './mower.ts';
import { GameAudio } from './audio.ts';
import { Input } from './input.ts';
import { UI } from './ui.ts';
import { Environment } from './env.ts';
import { Post } from './post.ts';
import { renderThumbs } from './thumbs.ts';
import { setAnisotropy } from './assets.ts';
import { setPeopleCore, setPeopleRest, loadPeople } from '../people/Humans.ts';
import { loadTreeKit } from '../world/env/treeproto.ts';
import { TS } from './nav.ts';
import { MOWERS, UPGRADES, loadSave, mowerDef, stats, upgradeCost, writeSave, type SaveData, type UpgradeId } from './save.ts';
import { clamp, damp, easeOutBack, easeOutCubic } from './util.ts';

/**
 * APEX LAWN: a peaceful lawn-mowing game. Drag to mow, the grass folds down in stripes, coins and
 * flowers pop, and when the lawn is done you are shown the stripes and taken to the next garden.
 */

type Mode = 'title' | 'play' | 'finishing' | 'celebrate' | 'result' | 'transition' | 'paused';

const q = new URLSearchParams(location.search);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MUSIC: Record<Theme['id'], string> = { morning: 'meadow', day: 'blossom', autumn: 'autumn', dusk: 'dusk' };

interface Cam {
  tx: number;
  ty: number;
  tz: number;
  dist: number;
  yaw: number;
  pitch: number;
}

class Game {
  readonly canvas = document.getElementById('gl') as HTMLCanvasElement;
  readonly renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 700);
  readonly env: Environment;
  readonly post: Post;
  readonly mower = new Mower();
  readonly audio = new GameAudio();
  readonly input: Input;
  readonly ui: UI;
  save: SaveData = loadSave();
  mode: Mode = 'title';
  lawn!: Lawn;
  level!: LevelDef;
  theme: Theme = THEMES[1];
  thumbs: Record<string, string> = {};

  private cam: Cam = { tx: 0, ty: 1, tz: 0, dist: 40, yaw: 0.3, pitch: 0.5 };
  private goal: Cam = { tx: 0, ty: 1, tz: 0, dist: 40, yaw: 0.3, pitch: 0.5 };
  private camSpeed = 1.8;
  private followYaw = -0.35;
  private followPitch = 1.0;
  private zoom = 1;
  private shake = 0;
  private time = 0;
  private last = performance.now();
  private view: View;
  private runCoins = 0;
  private runFlowers = 0;
  private chain = 0;
  private lastCoinT = -9;
  private idle = 0;
  private lastDone = 0;
  private arrowT = 0;
  private arrowTarget: { x: number; z: number } | null = null;
  private celT = 0;
  private resultShown = false;
  private saveT = 0;
  private bot = q.has('auto');
  private botGoal: { x: number; z: number } | null = null;
  private botT = 0;
  private cutSound = 0;
  private busy = false;
  private focusV = new THREE.Vector3();
  private fade = document.getElementById('fade') as HTMLElement;
  private loadingStep = document.querySelector('#loading .lstep') as HTMLElement | null;

  constructor() {
    const r = this.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));
    this.env = new Environment(this.scene, r);
    this.post = new Post(r, this.scene, this.camera);
    this.post.onChange = (qq) => {
      this.env.setShadowQuality(qq.shadow);
    };
    this.view = { fx: 0, fz: -1, rx: 1, rz: 0, cam: this.camera };

    const root = document.getElementById('ui') as HTMLElement;
    this.ui = new UI(root, {
      onPause: () => this.pauseGame(),
      onShop: () => this.openShop(),
      onSound: () => this.toggleSound(),
      onMusic: () => this.toggleMusic(),
    });
    this.input = new Input(this.canvas);
    this.ui.click = () => this.audio.tap();
    this.ui.tick = () => this.audio.count();
    this.audio.sound = this.save.sound;
    this.audio.music = this.save.music;
    this.ui.setToggles(this.save.sound, this.save.music);
    this.ui.setCoins(this.save.coins, true);
    this.scene.add(this.mower.root);

    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.flush();
        if (this.mode === 'play') this.pauseGame();
      }
      this.last = performance.now();
    });
    window.addEventListener('pagehide', () => this.flush());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.ui.shopOpen) this.closeShop();
        else if (this.mode === 'play') this.pauseGame();
      }
      if (e.key === 'q' || e.key === '-') this.zoom = clamp(this.zoom * 1.1, 0.7, 2.4);
      if (e.key === 'e' || e.key === '=' || e.key === '+') this.zoom = clamp(this.zoom / 1.1, 0.7, 2.4);
    });
    this.canvas.addEventListener('wheel', (e) => {
      this.zoom = clamp(this.zoom * Math.exp(e.deltaY * 0.0012), 0.7, 2.4);
      e.preventDefault();
    }, { passive: false });
    this.input.onFirstMove = () => {
      this.save.tutorial = true;
      this.ui.setHint(false);
    };
  }

  private say(s: string) {
    if (this.loadingStep) this.loadingStep.textContent = s;
  }

  // ------------------------------------------------------------------ boot

  async start() {
    this.resize();
    setPeopleCore(['Gardener_Male_01']);
    setPeopleRest(false);
    this.say('Waking the gardener');
    const people = loadPeople();
    const trees = loadTreeKit();
    this.thumbs = renderThumbs();
    const index = Number(q.get('lawn')) || this.save.lawn;
    this.say('Laying the turf');
    await this.loadLawn(index);
    this.say('Unrolling the sky');
    await Promise.all([people, trees]);
    this.equipMower();
    this.placeMower();
    this.snapCamera();
    this.say('Warming up the mower');
    await this.warm();
    this.setMode('title');
    document.getElementById('loading')?.classList.add('done');
    this.renderer.setAnimationLoop(() => this.frame());
    (window as unknown as { __lawn: Game; __ready: boolean }).__lawn = this;
    (window as unknown as { __ready: boolean }).__ready = true;
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.post.resize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Build lawn `index` (the old one stays until the new one is ready). */
  private async loadLawn(index: number) {
    const level = buildLevel(index);
    await this.env.setTheme(level.theme);
    const lawn = await Lawn.create(level);
    const old = this.lawn;
    this.scene.add(lawn.group);
    lawn.events.coin = (x, z) => this.onCoin(x, z);
    lawn.events.flower = () => this.onFlower();
    lawn.events.milestone = (p) => this.onMilestone(p);
    lawn.events.finished = () => this.onFinished();
    this.lawn = lawn;
    this.level = level;
    this.theme = level.theme;
    this.audio.setTheme(MUSIC[level.theme.id]);
    if (old) {
      this.scene.remove(old.group);
      old.dispose();
    }
    this.env.setShadowQuality(this.post.q.shadow);
  }

  /** Compile every shader and draw a few frames now, so nothing stalls (or shows black) once the fade lifts. */
  private async warm() {
    this.stepCamera(0.016);
    try {
      await this.renderer.compileAsync(this.scene, this.camera);
    } catch {
      /* the first real frames compile instead */
    }
    for (let i = 0; i < 3; i++) this.post.render(0.016);
  }

  private equipMower() {
    const s = stats(this.save);
    this.mower.setDef(s.mower, s.width, s.speed);
  }

  private placeMower() {
    const l = this.level;
    this.mower.place(l.start.x, l.start.z, l.start.heading);
    this.mower.appear = 1;
    this.mower.extraY = 0;
    this.mower.spin = 0;
  }

  // ------------------------------------------------------------------ camera

  /** The distance at which the whole lawn (and its house) fits the view. */
  private fitDist() {
    const W = this.level.w * TS;
    const H = this.level.h * TS;
    const R = Math.hypot(W, H) / 2 + (this.level.house ? 5 : 3);
    const vf = (this.camera.fov * Math.PI) / 360;
    const hf = Math.atan(Math.tan(vf) * Math.min(1.3, this.camera.aspect));
    return R / Math.sin(Math.min(vf, hf)) * 0.82;
  }

  private followDist() {
    const rider = this.mower.def?.kind === 'rider';
    const big = Math.max(this.level.w, this.level.h) * TS;
    // (a tall phone screen sees less across: stand back)
    const a = this.camera.aspect;
    const wide = a < 1.2 ? Math.min(1.9, Math.pow(1.2 / a, 0.7)) : 1;
    return (12.5 + Math.min(8, big * 0.14) + (rider ? 2.5 : 0)) * this.zoom * wide;
  }

  private goalFor(mode: 'orbit' | 'follow' | 'overview') {
    const g = this.goal;
    if (mode === 'follow') {
      const m = this.mower;
      const f = m.forward();
      const lead = 0.4 * m.speed;
      g.tx = m.x + f.x * lead;
      g.ty = 0.6;
      g.tz = m.z + f.z * lead;
      g.dist = this.followDist();
      g.yaw = this.followYaw;
      g.pitch = this.followPitch;
    } else {
      const a = this.time * (mode === 'orbit' ? 0.07 : 0.05);
      g.tx = 0;
      g.ty = 0.8;
      g.tz = this.level.house ? -1 : 0;
      g.dist = this.fitDist() * (mode === 'overview' ? 0.92 : 1);
      g.yaw = this.followYaw + Math.sin(a) * 0.9;
      g.pitch = mode === 'orbit' ? 0.5 : 0.7;
    }
  }

  private snapCamera() {
    this.goalFor('orbit');
    Object.assign(this.cam, this.goal);
  }

  private stepCamera(dt: number) {
    const mode = this.mode === 'title' ? 'orbit' : this.mode === 'result' || this.mode === 'celebrate' || this.mode === 'finishing' ? 'overview' : 'follow';
    // (finishing keeps the mower's own view for a beat, then pulls back once the lawn is done)
    this.goalFor(this.mode === 'finishing' ? 'follow' : mode);
    const c = this.cam;
    const g = this.goal;
    const follow = mode === 'follow';
    const lt = follow ? 3.4 : this.camSpeed * 0.9;
    const ld = follow ? 2.2 : this.camSpeed * 0.8;
    c.tx = damp(c.tx, g.tx, lt, dt);
    c.ty = damp(c.ty, g.ty, lt, dt);
    c.tz = damp(c.tz, g.tz, lt, dt);
    c.dist = damp(c.dist, g.dist, ld, dt);
    const dy = Math.atan2(Math.sin(g.yaw - c.yaw), Math.cos(g.yaw - c.yaw));
    c.yaw += dy * (1 - Math.exp(-ld * dt));
    c.pitch = damp(c.pitch, g.pitch, ld, dt);
    this.shake = damp(this.shake, 0, 6, dt);
    const cp = Math.cos(c.pitch);
    const dir = new THREE.Vector3(Math.sin(c.yaw) * cp, Math.sin(c.pitch), Math.cos(c.yaw) * cp);
    this.camera.position.set(c.tx, c.ty, c.tz).addScaledVector(dir, c.dist);
    this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.05;
    this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.05;
    this.camera.lookAt(c.tx, c.ty, c.tz);
    this.camera.updateMatrixWorld();
    // the ground basis for the stick and the stripe tone
    this.view.fx = -Math.sin(c.yaw);
    this.view.fz = -Math.cos(c.yaw);
    this.view.rx = Math.cos(c.yaw);
    this.view.rz = -Math.sin(c.yaw);
    // lens: sharp round the mower, the far end of the garden softening
    this.focusV.set(this.mower.x, 0.9, this.mower.z);
    this.post.focus(follow ? this.focusV : this.focusV.set(c.tx, 0.8, c.tz), follow ? 10 : 80);
  }

  // ------------------------------------------------------------------ modes

  private setMode(m: Mode) {
    this.mode = m;
    this.input.enabled = m === 'play';
    const play = m === 'play' || m === 'finishing' || m === 'celebrate';
    this.ui.setHud(play || m === 'paused' || m === 'result');
    if (m === 'title') {
      this.ui.setLawnName(`${this.level.name} · ${this.theme.name}`, this.theme.grass.tipA);
      this.ui.setProgress(0);
      this.ui.showTitle(this.level.index, () => this.begin());
      this.ui.setHud(false);
    }
  }

  private begin() {
    this.audio.unlock();
    this.audio.setSound(this.save.sound);
    this.audio.setMusic(this.save.music);
    this.audio.startMusic(MUSIC[this.theme.id]);
    this.audio.whoosh();
    this.ui.hideTitle();
    this.beginLawn();
  }

  private beginLawn() {
    this.runCoins = 0;
    this.runFlowers = 0;
    this.chain = 0;
    this.idle = 0;
    this.lastDone = 0;
    this.resultShown = false;
    this.celT = 0;
    this.mode = 'play';
    this.input.enabled = true;
    this.ui.setHud(true);
    this.ui.setLawnName(`${this.level.name} · ${this.theme.name}`, this.theme.grass.tipA);
    this.ui.setProgress(0);
    this.ui.setShopDot(this.canAffordSomething());
    this.ui.setHint(!this.save.tutorial && this.level.index <= 2);
  }

  private pauseGame() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.input.enabled = false;
    this.flush();
    this.ui.showPause({
      resume: () => {
        this.mode = 'play';
        this.input.enabled = true;
      },
      shop: () => this.openShop(true),
      home: () => void this.goHome(),
      sound: this.save.sound,
      music: this.save.music,
      onSound: () => this.toggleSound(),
      onMusic: () => this.toggleMusic(),
    });
  }

  private async goHome() {
    // the same lawn from the title (progress on it is not kept, coins are)
    this.audio.stopMusic();
    this.ui.setHud(false);
    await this.swapLawn(this.level.index);
    this.setMode('title');
  }

  /** Fade out, build the lawn, fade in. */
  private async swapLawn(index: number) {
    this.busy = true;
    this.fade.classList.add('on');
    await sleep(700);
    await this.loadLawn(index);
    this.equipMower();
    this.placeMower();
    this.snapCamera();
    await this.warm();
    this.fade.classList.remove('on');
    await sleep(200);
    this.busy = false;
  }

  // ------------------------------------------------------------------ economy

  private canAffordSomething() {
    const s = this.save;
    for (const u of UPGRADES) if (s.upgrades[u.id] < u.max && s.coins >= upgradeCost(u, s.upgrades[u.id])) return true;
    return MOWERS.some((m) => !s.owned.includes(m.id) && s.coins >= m.price);
  }

  private openShop(fromPause = false) {
    this.audio.unlock();
    if (this.mode === 'play') {
      // opening the shed mid-lawn pauses the lawn
      this.mode = 'paused';
      this.input.enabled = false;
      fromPause = true;
    }
    this.ui.openShop({
      save: () => this.save,
      thumbs: this.thumbs,
      buyUpgrade: (id) => this.buyUpgrade(id),
      buyMower: (id) => this.buyMower(id),
      equip: (id) => this.equipById(id),
      close: () => this.closeShop(fromPause),
    });
  }
  private closeShop(fromPause = false) {
    this.ui.closeShop();
    this.audio.back();
    this.ui.setShopDot(this.canAffordSomething());
    if (fromPause && this.mode === 'paused') {
      this.mode = 'play';
      this.pauseGame();
    }
  }
  private buyUpgrade(id: UpgradeId) {
    const u = UPGRADES.find((x) => x.id === id)!;
    const lvl = this.save.upgrades[id];
    const cost = upgradeCost(u, lvl);
    if (lvl >= u.max || this.save.coins < cost) {
      this.audio.nope();
      return;
    }
    this.save.coins -= cost;
    this.save.upgrades[id] = lvl + 1;
    this.audio.buy();
    this.afterShop();
  }
  private buyMower(id: string) {
    const m = mowerDef(id);
    if (this.save.owned.includes(id) || this.save.coins < m.price) {
      this.audio.nope();
      return;
    }
    this.save.coins -= m.price;
    this.save.owned.push(id);
    this.save.mower = id;
    this.audio.buy();
    this.afterShop();
  }
  private equipById(id: string) {
    if (!this.save.owned.includes(id)) return;
    this.save.mower = id;
    this.audio.tap();
    this.afterShop();
  }
  private afterShop() {
    writeSave(this.save);
    this.ui.setCoins(this.save.coins, true);
    this.ui.bumpCoins();
    this.equipMower();
    this.ui.refreshShop();
  }
  private toggleSound() {
    this.save.sound = !this.save.sound;
    this.audio.unlock();
    this.audio.setSound(this.save.sound);
    this.ui.setToggles(this.save.sound, this.save.music);
    writeSave(this.save);
    this.audio.tap();
  }
  private toggleMusic() {
    this.save.music = !this.save.music;
    this.audio.unlock();
    this.audio.setMusic(this.save.music);
    if (this.save.music) this.audio.startMusic(MUSIC[this.theme.id]);
    this.ui.setToggles(this.save.sound, this.save.music);
    writeSave(this.save);
  }
  private flush() {
    writeSave(this.save);
    this.saveT = 0;
  }

  // ------------------------------------------------------------------ events

  private project(x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  private onCoin(x: number, z: number) {
    const v = stats(this.save).coinValue;
    this.save.coins += v;
    this.runCoins += v;
    this.chain = this.time - this.lastCoinT < 1.5 ? this.chain + 1 : 0;
    this.lastCoinT = this.time;
    this.audio.coin(this.chain);
    navigator.vibrate?.(8);
    const p = this.project(x, 0.7, z);
    this.ui.floatText(p.x, p.y - 8, `+${v}`);
    this.ui.flyCoin(p.x, p.y, () => {
      this.ui.setCoins(this.save.coins);
      this.ui.bumpCoins();
    });
  }
  private onFlower() {
    this.save.coins += 1;
    this.runFlowers += 1;
    this.audio.flower();
    this.ui.setCoins(this.save.coins);
  }
  private onMilestone(p: number) {
    this.audio.milestone(p / 25 - 1);
    this.ui.flashBar();
  }

  private onFinished() {
    this.mode = 'celebrate';
    this.celT = 0;
    this.audio.complete();
    this.input.enabled = false;
    this.ui.setHint(false);
    this.ui.setArrow(false);
    this.ui.setRing({ show: false, x: 0, y: 0, nx: 0, ny: 0 });
    const lawn = this.lawn;
    const cx = this.mower.x;
    const cz = this.mower.z;
    for (let i = 0; i < 220; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 4;
      lawn.fx.confetti({
        x: cx, y: 1.2, z: cz,
        vx: Math.cos(a) * sp * 0.7, vy: 4 + Math.random() * 4, vz: Math.sin(a) * sp * 0.7,
        color: new THREE.Color().setHSL(Math.random(), 0.8, 0.62),
        life: 2.4 + Math.random() * 1.4,
      });
    }
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      lawn.fx.spark({ x: cx, y: 0.8, z: cz, vx: Math.cos(a) * 2.2, vy: 0.8 + Math.random() * 1.5, vz: Math.sin(a) * 2.2, life: 0.8, color: '#fff3a8' });
    }
  }

  private showResult() {
    const lvl = this.level;
    const lawn = this.lawn;
    const allCoins = lawn.coinsGot >= lawn.coinTotal;
    const allFlowers = lawn.flowersGot >= lawn.flowerTotal;
    const bonus = 20 + lvl.index * 4 + (allCoins && lawn.coinTotal ? 15 : 0) + (allFlowers && lawn.flowerTotal ? 15 : 0);
    const earned = this.runCoins + this.runFlowers + bonus;
    this.save.coins += bonus;
    this.save.lawn = lvl.index + 1;
    this.save.best = Math.max(this.save.best, lvl.index);
    this.save.flowers += this.runFlowers;
    this.save.tutorial = true;
    this.flush();
    this.mode = 'result';
    this.resultShown = true;
    this.ui.setCoins(this.save.coins);
    this.ui.showResult({
      name: lvl.name,
      rows: [
        { label: 'Mown', value: `${Math.round(lvl.area)} m²` },
        { label: 'Coins', value: `${lawn.coinsGot} / ${lawn.coinTotal}` },
        { label: 'Flowers', value: `${lawn.flowersGot} / ${lawn.flowerTotal}` },
        { label: allCoins && allFlowers ? 'Perfect lawn bonus' : 'Lawn bonus', value: `+${bonus}`, bonus: true },
      ],
      earned,
      shopDot: this.canAffordSomething(),
      onNext: () => void this.nextLawn(),
      onShop: () => this.openShop(),
    });
  }

  // ------------------------------------------------------------------ the next garden

  private async nextLawn() {
    if (this.busy) return;
    this.mode = 'transition';
    this.input.enabled = false;
    this.audio.whoosh();
    this.ui.setHud(false);
    this.ui.setHint(false);
    await this.swapLawn(this.save.lawn);
    this.audio.pop();
    this.beginLawn();
  }

  // ------------------------------------------------------------------ the loop

  private frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) return;
    this.time += dt;
    this.step(dt);
    this.post.govern(dt);
    this.post.render(dt);
  }

  private step(dt: number) {
    if (!this.lawn) return;
    this.stepCamera(dt);
    if (this.mode === 'paused' || this.busy) {
      this.lawn.fx.update(0, this.camera);
      return;
    }
    this.driveAndCut(dt);
    this.env.follow(this.mower.x, this.mower.z);
    this.saveT += dt;
    if (this.saveT > 6) this.flush();
  }

  private driveAndCut(dt: number) {
    const m = this.mower;
    const lawn = this.lawn;
    const v = this.view;
    let drive: { dx: number; dz: number } | null = null;
    if (this.mode === 'play') {
      if (this.bot) drive = this.botDrive(dt);
      else {
        const s = this.input.read();
        this.ui.setRing(this.input.ring);
        if (s.mag > 0.02) drive = { dx: (v.rx * s.x - v.fx * s.y) * s.mag, dz: (v.rz * s.x - v.fz * s.y) * s.mag };
      }
    } else {
      this.ui.setRing({ show: false, x: 0, y: 0, nx: 0, ny: 0 });
    }
    const res = m.update(dt, drive, lawn.level.nav);
    if (res.impact > 0.9) {
      this.audio.bump(res.impact);
      this.shake = Math.min(1, this.shake + res.impact * 0.1);
      navigator.vibrate?.(12);
      for (let i = 0; i < 4; i++) {
        lawn.fx.dust({ x: m.x + (res.hit ? -res.hit.nx * m.radius : 0), y: 0.1, z: m.z + (res.hit ? -res.hit.nz * m.radius : 0), vx: (Math.random() - 0.5) * 0.8, vy: 0.3, vz: (Math.random() - 0.5) * 0.8, size: 0.14 });
      }
    }

    const before = lawn.mask.done;
    lawn.update(dt, m, v, { magnet: stats(this.save).magnet, dens: this.post.q.grass, sun: this.env.sunDir });
    const cutRate = clamp((lawn.mask.done - before) / (dt * 600), 0, 1);
    this.cutSound = damp(this.cutSound, cutRate, 14, dt);
    const speed01 = m.speed / m.maxSpeed;
    this.audio.setProgress(lawn.progress);
    this.audio.drive(speed01, m.throttle, this.cutSound, this.mode === 'play' || this.mode === 'finishing');

    // exhaust
    if (m.speed > 0.4 && Math.random() < dt * 12 && this.mode === 'play') {
      const p = m.exhaustWorld(new THREE.Vector3());
      lawn.fx.puff({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 0.2, vy: 0.3, vz: (Math.random() - 0.5) * 0.2, size: 0.05, life: 0.8, color: '#cfd6dc' });
    }

    if (this.mode === 'play') {
      this.ui.setProgress(lawn.progress);
      if (lawn.mask.done !== this.lastDone) {
        this.idle = 0;
        this.lastDone = lawn.mask.done;
      } else this.idle += dt;
      if (lawn.progress >= 0.985) {
        this.mode = 'finishing';
        this.input.enabled = false;
        lawn.startFinish(m);
      }
      this.updateArrow(dt);
    } else if (this.mode === 'finishing') {
      this.ui.setProgress(lawn.progress);
      this.ui.setArrow(false);
    } else if (this.mode === 'celebrate') {
      this.ui.setProgress(1);
      this.celT += dt;
      // a victory hop and a full spin
      m.extraY = Math.abs(Math.sin(this.celT * 5.5)) * 0.25 * Math.max(0, 1 - this.celT / 1.6);
      m.spin = easeOutCubic(clamp(this.celT / 1.3, 0, 1)) * Math.PI * 2;
      m.sync(0);
      if (this.celT > 1.4 && !this.resultShown) this.showResult();
    }
    if (this.mode === 'result') m.extraY = damp(m.extraY, 0, 8, dt);
  }

  private updateArrow(dt: number) {
    const lawn = this.lawn;
    const m = this.mower;
    if (this.idle < 3.2) {
      this.ui.setArrow(false);
      return;
    }
    this.arrowT -= dt;
    if (this.arrowT <= 0) {
      this.arrowT = 0.6;
      this.arrowTarget = lawn.nearestUncut(m.x, m.z);
    }
    const t = this.arrowTarget;
    if (!t) {
      this.ui.setArrow(false);
      return;
    }
    const a = this.project(m.x, 0.8, m.z);
    const b = this.project(t.x, 0.1, t.z);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 120) {
      this.ui.setArrow(false);
      return;
    }
    this.ui.setArrow(true, a.x + (dx / d) * 90, a.y + (dy / d) * 90, Math.atan2(dx, -dy));
  }

  // a stand-in player for headless testing: ?auto
  private botDrive(dt: number): { dx: number; dz: number } | null {
    const m = this.mower;
    const lawn = this.lawn;
    this.botT -= dt;
    if (this.botT <= 0 || !this.botGoal || Math.hypot(this.botGoal.x - m.x, this.botGoal.z - m.z) < 0.5) {
      this.botT = 0.4;
      const g0 = lawn.nearestUncut(m.x, m.z, m.heading);
      this.botGoal = g0;
      if (g0) {
        // aim for the nearest spot the body can actually stand on
        const nav = lawn.level.nav;
        let best = 1e9;
        for (let oz = -0.8; oz <= 0.8; oz += 0.2) {
          for (let ox = -0.8; ox <= 0.8; ox += 0.2) {
            const x = g0.x + ox;
            const z = g0.z + oz;
            if (!nav.reachable(x, z)) continue;
            const d = Math.hypot(ox, oz);
            if (d < best) {
              best = d;
              this.botGoal = { x, z };
            }
          }
        }
      }
    }
    const g = this.botGoal;
    if (!g) return null;
    const dx = g.x - m.x;
    const dz = g.z - m.z;
    const d = Math.hypot(dx, dz) || 1;
    const mag = d < 0.7 ? 0.6 : 1;
    return { dx: (dx / d) * mag, dz: (dz / d) * mag };
  }
}

void easeOutBack;

const game = new Game();
game.start().catch((e) => {
  const err = document.querySelector('#loading .err') as HTMLElement | null;
  if (err) err.textContent = String(e?.stack ?? e);
  console.error(e);
});
