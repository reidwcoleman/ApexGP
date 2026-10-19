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
import { Clouds, frameLawn, renderThumbs, camDir, CAM, type Win } from './world.ts';
import { MOWERS, UPGRADES, loadSave, mowerDef, stats, upgradeCost, writeSave, type SaveData, type UpgradeId } from './save.ts';
import { clamp, damp, easeInOut, easeOutBack, easeOutCubic } from './util.ts';

/**
 * APEX LAWN: a peaceful lawn-mowing game. Drag to mow, the grass folds down in stripes, coins and
 * flowers pop, and when the lawn is done another one drops out of the sky.
 */

type Mode = 'title' | 'play' | 'finishing' | 'celebrate' | 'result' | 'transition' | 'paused';

const WIN_PLAY: Win = { x0: -0.9, x1: 0.9, y0: -0.84, y1: 0.7 };
const WIN_TITLE: Win = { x0: -0.78, x1: 0.78, y0: -0.34, y1: 0.46 };
const WIN_RES_WIDE: Win = { x0: -0.95, x1: 0.1, y0: -0.8, y1: 0.7 };
const WIN_RES_TALL: Win = { x0: -0.9, x1: 0.9, y0: 0.06, y1: 0.8 };
const q = new URLSearchParams(location.search);

class Game {
  readonly canvas = document.getElementById('gl') as HTMLCanvasElement;
  readonly renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CAM.fov, 1, 0.1, 400);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#a8c98a', 1.7);
  readonly sun = new THREE.DirectionalLight('#fff1cf', 2.5);
  readonly clouds = new Clouds();
  readonly mower = new Mower();
  readonly audio = new GameAudio();
  readonly input: Input;
  readonly ui: UI;
  save: SaveData = loadSave();
  mode: Mode = 'title';
  lawn!: Lawn;
  level!: LevelDef;
  theme: Theme = THEMES[0];
  thumbs: Record<string, string> = {};

  private camTarget = new THREE.Vector3();
  private camDist = 30;
  private goalTarget = new THREE.Vector3();
  private goalDist = 30;
  private camLambda = 4;
  private shake = 0;
  private time = 0;
  private last = performance.now();
  private view: View;
  private skyFlip = false;
  private hemiSky = new THREE.Color();
  private hemiGround = new THREE.Color();
  private sunCol = new THREE.Color();
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
  private tr: { t: number; old: Lawn; nu: Lawn; D: number; popped: boolean; landed: boolean; level: LevelDef } | null = null;
  private saveT = 0;
  private bot = q.has('auto');
  private botGoal: { x: number; z: number } | null = null;
  private botT = 0;
  private cutSound = 0;
  private lastOdo = 0;

  constructor() {
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x000000, 0);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.clouds.group);
    this.sun.position.set(-6.4, 10, 3);
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
    });
    this.input.onFirstMove = () => {
      this.save.tutorial = true;
      this.ui.setHint(false);
    };
  }

  // ------------------------------------------------------------------ setup

  start() {
    this.thumbs = renderThumbs();
    this.resize();
    const index = Number(q.get('lawn')) || this.save.lawn;
    this.setTheme(THEMES[Math.floor((index - 1) / 3) % THEMES.length], true);
    this.loadLawn(index, 0);
    this.snapCamera();
    this.setMode('title');
    document.getElementById('loading')?.classList.add('done');
    requestAnimationFrame(() => this.frame());
    (window as unknown as { __lawn: Game; __ready: boolean }).__lawn = this;
    (window as unknown as { __ready: boolean }).__ready = true;
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.lawn) this.refit();
  }

  private win(): Win {
    if (this.mode === 'title') return WIN_TITLE;
    if (this.mode === 'result') return this.camera.aspect > 1.15 ? WIN_RES_WIDE : WIN_RES_TALL;
    return WIN_PLAY;
  }
  private refit() {
    const f = frameLawn(this.level, this.lawn.group.position, this.win(), this.camera.aspect);
    this.goalTarget.copy(f.target);
    this.goalDist = f.dist;
  }
  private snapCamera() {
    this.refit();
    this.camTarget.copy(this.goalTarget);
    this.camDist = this.goalDist;
  }

  private setTheme(theme: Theme, instant = false) {
    this.theme = theme;
    const a = document.getElementById('skyA') as HTMLElement;
    const b = document.getElementById('skyB') as HTMLElement;
    const grad = `linear-gradient(180deg, ${theme.skyTop} 0%, ${theme.skyBottom} 78%)`;
    if (instant) {
      a.style.background = grad;
      b.style.opacity = '0';
    } else {
      const [on, off] = this.skyFlip ? [a, b] : [b, a];
      on.style.background = grad;
      on.style.opacity = '1';
      off.style.opacity = '0';
      this.skyFlip = !this.skyFlip;
    }
    this.clouds.setTint(theme.skyBottom);
    this.audio.setTheme(theme.id);
    this.ui.setLawnName('', theme.tipA);
  }

  private loadLawn(index: number, offsetX: number, drop = false): Lawn {
    const level = buildLevel(index);
    const lawn = new Lawn(level);
    lawn.group.position.set(offsetX, drop ? 14 : 0, 0);
    this.scene.add(lawn.group);
    lawn.events.coin = (x, z) => this.onCoin(lawn, x, z);
    lawn.events.flower = () => this.onFlower();
    lawn.events.milestone = (p) => this.onMilestone(p);
    lawn.events.finished = () => this.onFinished();
    if (!this.tr) {
      this.level = level;
      this.lawn = lawn;
    }
    return lawn;
  }

  private equipMower() {
    const s = stats(this.save);
    this.mower.setDef(s.mower, s.width, s.speed);
  }

  private placeMower(lawn: Lawn, level: LevelDef) {
    this.equipMower();
    lawn.body.add(this.mower.root);
    this.mower.place(level.start.x, level.start.z, level.start.heading);
  }

  // ------------------------------------------------------------------ modes

  private setMode(m: Mode) {
    this.mode = m;
    this.input.enabled = m === 'play';
    const play = m === 'play' || m === 'finishing' || m === 'celebrate';
    this.ui.setHud(play || m === 'paused' || m === 'result');
    if (m === 'title') {
      this.placeMower(this.lawn, this.level);
      this.mower.appear = 1;
      this.ui.setLawnName(`${this.level.name} · ${this.theme.name}`, this.theme.tipA);
      this.ui.setProgress(0);
      this.ui.showTitle(this.level.index, () => this.begin());
      this.ui.setHud(false);
      this.refit();
    }
  }

  private begin() {
    this.audio.unlock();
    this.audio.setSound(this.save.sound);
    this.audio.setMusic(this.save.music);
    this.audio.startMusic(this.theme.id);
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
    this.ui.setLawnName(`${this.level.name} · ${this.theme.name}`, this.theme.tipA);
    this.ui.setProgress(0);
    this.ui.setShopDot(this.canAffordSomething());
    this.ui.setHint(!this.save.tutorial && this.level.index <= 2);
    this.refit();
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
      home: () => this.goHome(),
      sound: this.save.sound,
      music: this.save.music,
      onSound: () => this.toggleSound(),
      onMusic: () => this.toggleMusic(),
    });
  }

  private goHome() {
    // restart the same lawn from the title (progress on it is not kept, coins are)
    this.audio.stopMusic();
    this.lawn.body.remove(this.mower.root);
    this.scene.remove(this.lawn.group);
    this.lawn.dispose();
    this.loadLawn(this.level.index, 0);
    this.snapCamera();
    this.ui.setHud(false);
    this.setMode('title');
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
    if (fromPause && this.mode === 'paused') this.pauseGame2();
  }
  private pauseGame2() {
    this.mode = 'play';
    this.pauseGame();
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
    if (this.mode === 'title' || this.mode === 'result') this.mower.appear = 1;
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
    if (this.save.music) this.audio.startMusic(this.theme.id);
    this.ui.setToggles(this.save.sound, this.save.music);
    writeSave(this.save);
  }
  private flush() {
    writeSave(this.save);
    this.saveT = 0;
  }

  // ------------------------------------------------------------------ events

  private project(lawn: Lawn, x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).add(lawn.group.position);
    v.project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight };
  }

  private onCoin(lawn: Lawn, x: number, z: number) {
    const v = stats(this.save).coinValue;
    this.save.coins += v;
    this.runCoins += v;
    this.chain = this.time - this.lastCoinT < 1.5 ? this.chain + 1 : 0;
    this.lastCoinT = this.time;
    this.audio.coin(this.chain);
    navigator.vibrate?.(8);
    const p = this.project(lawn, x, 0.9, z);
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
    for (let i = 0; i < 160; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      lawn.fx.confetti({
        x: cx, y: 0.6, z: cz,
        vx: Math.cos(a) * sp * 0.7, vy: 5 + Math.random() * 5, vz: Math.sin(a) * sp * 0.7,
        color: new THREE.Color().setHSL(Math.random(), 0.8, 0.62),
        life: 2.2 + Math.random() * 1.2,
      });
    }
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      lawn.fx.spark({ x: cx, y: 0.5, z: cz, vx: Math.cos(a) * 3, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 3, life: 0.8, color: '#fff3a8' });
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
    this.refit();
    this.ui.setCoins(this.save.coins);
    this.ui.showResult({
      name: lvl.name,
      rows: [
        { label: 'Grass cut', value: '100%' },
        { label: 'Coins', value: `${lawn.coinsGot} / ${lawn.coinTotal}` },
        { label: 'Flowers', value: `${lawn.flowersGot} / ${lawn.flowerTotal}` },
        { label: allCoins && allFlowers ? 'Perfect lawn bonus' : 'Lawn bonus', value: `+${bonus}`, bonus: true },
      ],
      earned,
      shopDot: this.canAffordSomething(),
      onNext: () => this.nextLawn(),
      onShop: () => this.openShop(),
    });
  }

  // ------------------------------------------------------------------ transition to the next lawn

  private nextLawn() {
    const old = this.lawn;
    const nextIndex = this.save.lawn;
    const nextLevel = buildLevel(nextIndex);
    const D = old.level.w / 2 + nextLevel.w / 2 + 5;
    const nu = new Lawn(nextLevel);
    nu.group.position.set(old.group.position.x + D * Math.cos(CAM.yaw), 16, old.group.position.z - D * Math.sin(CAM.yaw));
    nu.group.position.set(old.group.position.x + D, 16, old.group.position.z);
    this.scene.add(nu.group);
    nu.events.coin = (x, z) => this.onCoin(nu, x, z);
    nu.events.flower = () => this.onFlower();
    nu.events.milestone = (p) => this.onMilestone(p);
    nu.events.finished = () => this.onFinished();
    this.tr = { t: 0, old, nu, D, popped: false, landed: false, level: nextLevel };
    this.mode = 'transition';
    this.input.enabled = false;
    this.audio.whoosh();
    // camera glides over to where the new lawn will land
    const f = frameLawn(nextLevel, new THREE.Vector3(old.group.position.x + D, 0, old.group.position.z), WIN_PLAY, this.camera.aspect);
    this.goalTarget.copy(f.target);
    this.goalDist = f.dist;
    this.camLambda = 3;
    const nt = THEMES[Math.floor((nextIndex - 1) / 3) % THEMES.length];
    if (nt.id !== this.theme.id) this.setTheme(nt);
    this.ui.setHud(false);
    this.ui.setHint(false);
  }

  private updateTransition(dt: number) {
    const tr = this.tr!;
    tr.t += dt;
    const t = tr.t;
    // the old island sinks away into the clouds
    const u = clamp((t - 0.45) / 1.2, 0, 1);
    tr.old.group.position.y = -easeInOutCubic(u) * 18;
    tr.old.group.rotation.z = u * 0.12;
    // the new one drops in and settles
    const d = clamp((t - 0.05) / 1.1, 0, 1);
    tr.nu.group.position.y = 16 * (1 - bounce(d));
    if (d >= 1 && !tr.landed) {
      tr.landed = true;
      this.shake = 0.5;
      this.audio.bump(5);
      const nu = tr.nu;
      const lv = tr.level;
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.5 + 0.5;
        nu.fx.dust({
          x: Math.cos(a) * (lv.w / 2) * r, y: 0.1, z: Math.sin(a) * (lv.h / 2) * r,
          vx: Math.cos(a) * 1.6, vy: 0.5 + Math.random() * 0.8, vz: Math.sin(a) * 1.6,
          size: 0.35 + Math.random() * 0.3, life: 0.9,
        });
      }
    }
    // the mower hops out of nowhere
    if (t > 1.35 && !tr.popped) {
      tr.popped = true;
      this.level = tr.level;
      this.lawn = tr.nu;
      this.runCoins = 0;
      this.placeMower(tr.nu, tr.level);
      this.mower.appear = 0;
      this.audio.pop();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        tr.nu.fx.puff({ x: tr.level.start.x, y: 0.3, z: tr.level.start.z, vx: Math.cos(a) * 1.2, vy: 0.6, vz: Math.sin(a) * 1.2, size: 0.3 });
      }
    }
    if (tr.popped) {
      this.mower.appear = easeOutBack(clamp((t - 1.35) / 0.5, 0, 1));
      this.mower.sync();
    }
    if (t > 2.05) {
      // the world re-centres so numbers never grow
      const old = tr.old;
      const nu = tr.nu;
      const shift = nu.group.position.x;
      nu.group.position.x = 0;
      this.camTarget.x -= shift;
      this.goalTarget.x -= shift;
      this.scene.remove(old.group);
      old.dispose();
      this.tr = null;
      this.camLambda = 4;
      this.mower.appear = 1;
      this.beginLawn();
      this.refit();
    }
  }

  // ------------------------------------------------------------------ the loop

  private frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (document.hidden) return;
    this.time += dt;
    this.step(dt);
    this.render();
  }

  private step(dt: number) {
    const m = this.mower;
    const lawn = this.lawn;
    this.clouds.update(dt);
    this.updateView();

    if (this.mode === 'paused') {
      lawn.fx.update(0, this.camera);
      return;
    }

    if (this.tr) {
      this.tr.old.update(dt, m, this.view, { magnet: 0, active: false });
      this.tr.nu.update(dt, m, this.view, { magnet: 0, active: false });
      this.updateTransition(dt);
    } else {
      this.driveAndCut(dt);
    }

    // the islands bob a little
    const bob = Math.sin(this.time * 0.9) * 0.05;
    lawn.body.position.y = bob;
    if (this.tr) this.tr.nu.body.position.y = bob;

    // camera: ease to the goal, drift, shake
    this.camTarget.x = damp(this.camTarget.x, this.goalTarget.x, this.camLambda, dt);
    this.camTarget.y = damp(this.camTarget.y, this.goalTarget.y, this.camLambda, dt);
    this.camTarget.z = damp(this.camTarget.z, this.goalTarget.z, this.camLambda, dt);
    this.camDist = damp(this.camDist, this.goalDist, this.camLambda, dt);
    this.shake = damp(this.shake, 0, 6, dt);
    const sway = this.mode === 'title' ? Math.sin(this.time * 0.35) * 0.05 : Math.sin(this.time * 0.25) * 0.012;
    const dir = camDir(CAM.yaw + sway, CAM.pitch);
    this.camera.position.copy(this.camTarget).addScaledVector(dir, this.camDist);
    this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.25;
    this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.25;
    this.camera.lookAt(this.camTarget);
    this.clouds.group.position.set(this.camTarget.x, 0, this.camTarget.z);
    this.sun.target.position.copy(this.camTarget);
    this.sun.position.set(this.camTarget.x - 6.4, 10, this.camTarget.z + 3);

    // light follows the theme
    this.hemiSky.set(this.theme.hemiSky);
    this.hemiGround.set(this.theme.hemiGround);
    this.sunCol.set(this.theme.sun);
    this.hemi.color.lerp(this.hemiSky, 1 - Math.exp(-3 * dt));
    this.hemi.groundColor.lerp(this.hemiGround, 1 - Math.exp(-3 * dt));
    this.sun.color.lerp(this.sunCol, 1 - Math.exp(-3 * dt));

    this.saveT += dt;
    if (this.saveT > 6) this.flush();
  }

  private updateView() {
    const f = new THREE.Vector3(this.camTarget.x, 0, this.camTarget.z).sub(new THREE.Vector3(this.camera.position.x, 0, this.camera.position.z));
    if (f.lengthSq() < 1e-6) return;
    f.normalize();
    this.view.fx = f.x;
    this.view.fz = f.z;
    this.view.rx = -f.z;
    this.view.rz = f.x;
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
      for (let i = 0; i < 5; i++) {
        lawn.fx.dust({ x: m.x + (res.hit ? -res.hit.nx * m.radius : 0), y: 0.2, z: m.z + (res.hit ? -res.hit.nz * m.radius : 0), vx: (Math.random() - 0.5) * 1.5, vy: 0.5, vz: (Math.random() - 0.5) * 1.5, size: 0.2 });
      }
    }

    const before = lawn.done;
    lawn.update(dt, m, v, { magnet: stats(this.save).magnet });
    const cutRate = clamp((lawn.done - before) / (dt * 220), 0, 1);
    this.cutSound = damp(this.cutSound, cutRate, 14, dt);
    const speed01 = m.speed / m.maxSpeed;
    this.audio.setProgress(lawn.progress);
    this.audio.drive(speed01, m.throttle, this.cutSound, this.mode === 'play' || this.mode === 'finishing');

    // exhaust and the occasional dust from the wheels
    if (m.speed > 0.5 && Math.random() < dt * 14 && this.mode === 'play') {
      const p = m.exhaustWorld(new THREE.Vector3());
      lawn.fx.puff({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * 0.3, vy: 0.5, vz: (Math.random() - 0.5) * 0.3, size: 0.1, life: 0.55, color: '#dfe5ea' });
    }

    if (this.mode === 'play') {
      this.ui.setProgress(lawn.progress);
      if (lawn.done !== this.lastDone) {
        this.idle = 0;
        this.lastDone = lawn.done;
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
      const hop = Math.abs(Math.sin(this.celT * 5.5)) * 0.55 * Math.max(0, 1 - this.celT / 1.6);
      m.extraY = hop;
      m.spin = easeOutCubic(clamp(this.celT / 1.3, 0, 1)) * Math.PI * 2;
      m.sync();
      if (this.celT > 1.1 && !this.resultShown) this.showResult();
    } else if (this.mode === 'title') {
      m.sync();
    }
    if (this.mode === 'result') {
      m.extraY = damp(m.extraY, 0, 8, dt);
    }
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
    const a = this.project(lawn, m.x, 0.6, m.z);
    const b = this.project(lawn, t.x, 0.2, t.z);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 90) {
      this.ui.setArrow(false);
      return;
    }
    this.ui.setArrow(true, a.x + (dx / d) * 78, a.y + (dy / d) * 78, Math.atan2(dx, -dy));
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

  private render() {
    this.renderer.render(this.scene, this.camera);
  }
}

const easeInOutCubic = easeInOut;
function bounce(t: number) {
  // 0 -> 1 with two small rebounds at the end
  if (t < 0.62) return Math.pow(t / 0.62, 2);
  if (t < 0.82) {
    const k = (t - 0.62) / 0.2;
    return 1 - 0.07 * Math.sin(k * Math.PI);
  }
  const k = (t - 0.82) / 0.18;
  return 1 - 0.025 * Math.sin(k * Math.PI);
}

const game = new Game();
try {
  game.start();
} catch (e) {
  const err = document.querySelector('#loading .err') as HTMLElement | null;
  if (err) err.textContent = String(e);
  console.error(e);
}
