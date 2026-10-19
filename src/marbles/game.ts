import * as THREE from 'three';
import { Bot } from './ai.ts';
import { courseAI } from './ai-course.ts';
import { Sound } from './audio.ts';
import { buildRound, SHOW, type Course } from './courses.ts';
import { Confetti, Splashes } from './fx.ts';
import { Caustics } from './fx-caustics.ts';
import { Marble, RADIUS } from './physics.ts';
import { Stage, SUN } from './render.ts';
import { DESIGNS, marbleMaterial } from './shaders.ts';
import { ordinal, UI, type Row } from './ui.ts';

/**
 * Marble Mania: a show of four rounds for 24 glass marbles on wooden courses — two races where
 * only the first across the line go through, a survival round, and a final for the crown. You are
 * one marble; the rest are bots of mixed skill. Out of the show, you can watch it to the end.
 */

interface Contestant {
  id: number;
  name: string;
  design: number;
  seed: number;
  skill: number;
  player: boolean;
  out: boolean;
}

interface Racer {
  c: Contestant;
  m: Marble;
  mesh: THREE.Mesh;
  mat: THREE.MeshPhysicalMaterial;
  bot: Bot | null;
  hint: number;
  s: number;
  cp: number;
  /** finishing order (0: not yet) */
  fin: number;
  out: boolean;
  /** time it fell (respawns after a beat) */
  fell: number;
  hold: number;
}

type State = 'menu' | 'intro' | 'countdown' | 'play' | 'over' | 'results' | 'champion';

const NAMES = ['Pebble', 'Glassy', 'Bonk', 'Swirlz', 'Mr. Roundy', 'Clink', 'Shiny', 'Rolo', 'Bubbles', 'Twister', 'Agate', 'Cosmo', 'Taw', 'Jellybean', 'Sparky', 'Comet', 'Biscuit', 'Nugget', 'Ziggy', 'Pip', 'Dotty', 'Boulder', 'Ollie', 'Sprocket', 'Gizmo', 'Tumbles', 'Lucky', 'Mochi', 'Rocket', 'Peanut'];
const FIELD = 24;
const UP = new THREE.Vector3(0, 1, 0);

export class MarbleGame {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  private stage!: Stage;
  private ui: UI;
  readonly sound = new Sound();
  private course: Course | null = null;
  private racers: Racer[] = [];
  private roster: Contestant[] = [];
  private roundIdx = 0;
  private state: State = 'menu';
  private stateT = 0;
  private playT = 0;
  private finCount = 0;
  private slots = 0;
  private design = 0;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private paused = false;
  private camYaw = 0;
  private yawOff = 0;
  private dragging = false;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private spectate = 0;
  private confetti = new Confetti();
  private caustics = new Caustics(48);
  private splashes = new Splashes();
  private timeScale = 1;
  private slowUntil = 0;
  private last = performance.now();
  private geo = new THREE.SphereGeometry(RADIUS, 48, 32);
  private preview: Racer | null = null;
  private resultsT = 0;
  private resultsNext: (() => void) | null = null;
  private quality = 1;
  private fpsAcc = 0;
  private fpsN = 0;
  private menuMarbles: Racer[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    root: HTMLElement,
  ) {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.ui = new UI(root);
    this.bindInput();
    window.addEventListener('resize', () => this.resize());
  }

  async boot(progress: (f: number, s: string) => void) {
    const r = this.renderer;
    progress(0.1, 'Mixing the paint');
    this.stage = new Stage(r, this.scene, this.camera);
    this.scene.add(this.confetti.mesh, this.splashes.group, this.caustics.mesh);
    progress(0.3, 'Laying the planks');
    this.resize();
    // the menu's backdrop: the first course with marbles rolling about the start
    await this.loadRound(0, true);
    progress(0.7, 'Warming the shaders');
    await r.compileAsync(this.scene, this.camera);
    progress(1, 'Ready');
    const q = new URLSearchParams(location.search);
    // (test hooks: ?round=N jumps into the show at that round, ?auto=1 lets a bot drive you)
    if (q.get('round')) {
      this.autopilot = q.get('auto') === '1';
      this.newShow();
      this.roundIdx = Number(q.get('round'));
      for (const x of this.roster) x.out = x.id >= FIELD - Number(q.get('cut') ?? 0);
      await this.startRound();
      if (q.get('go') === '1') this.toCountdown();
    } else this.toMenu();
    r.setAnimationLoop(() => this.frame());
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.stage?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------------------------- input
  private bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.sound.start();
      if (e.code === 'Escape') this.togglePause();
      if (e.code === 'KeyM') this.toggleMusic();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.canvas.addEventListener('pointerdown', (e) => {
      this.sound.start();
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      if (this.state === 'intro') this.pressed.add('Space');
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging && e.pointerType === 'mouse') this.yawOff -= e.movementX * 0.006;
    });
    const up = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  private togglePause() {
    if (this.state !== 'play' && this.state !== 'countdown' && this.state !== 'intro' && this.state !== 'over') return;
    this.paused = !this.paused;
    if (this.paused) this.keys.clear();
    this.ui.pause(this.paused, {
      onResume: () => this.togglePause(),
      onMusic: () => {
        this.toggleMusic();
        this.paused = false;
        this.togglePause();
      },
      onQuit: () => {
        this.paused = false;
        this.ui.pause(false);
        this.toMenu();
      },
      music: this.sound.musicOn,
    });
  }

  private toggleMusic() {
    this.sound.musicOn = !this.sound.musicOn;
    this.sound.setMusic(this.state === 'menu' ? 'menu' : this.state === 'play' ? 'play' : 'calm');
  }

  private gamepad() {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p) continue;
      const x = Math.abs(p.axes[0]) > 0.15 ? p.axes[0] : 0, y = Math.abs(p.axes[1]) > 0.15 ? -p.axes[1] : 0;
      return { x, y, jump: !!p.buttons[0]?.pressed, dash: !!(p.buttons[2]?.pressed || p.buttons[1]?.pressed || p.buttons[5]?.pressed), cam: Math.abs(p.axes[2] ?? 0) > 0.2 ? p.axes[2] : 0 };
    }
    return null;
  }
  private padJump = false;
  private padDash = false;

  // ------------------------------------------------------------------------------------- the show
  private toMenu() {
    this.state = 'menu';
    this.stateT = 0;
    this.ui.hud(false);
    this.ui.hideCard();
    this.ui.hideBanner();
    this.ui.hideResults();
    this.ui.clearTags();
    this.confetti.clear();
    if (!this.course || this.course.id !== 'timber' || this.racers.length === 0 || this.menuMarbles.length === 0) void this.loadRound(0, true);
    this.ui.menu({
      design: DESIGNS[this.design].name,
      kind: kindName(DESIGNS[this.design].kind),
      onPrev: () => this.pickDesign(-1),
      onNext: () => this.pickDesign(1),
      onPlay: () => this.newShow(),
    });
    this.sound.setMusic('menu');
  }

  private pickDesign(d: number) {
    this.sound.start();
    this.sound.click();
    this.design = (this.design + d + DESIGNS.length) % DESIGNS.length;
    this.ui.design(DESIGNS[this.design].name, kindName(DESIGNS[this.design].kind));
    if (this.preview) {
      const mat = marbleMaterial(DESIGNS[this.design], 0.37);
      this.preview.mesh.material = mat;
      this.preview.mat.dispose();
      this.preview.mat = mat;
    }
  }

  autopilot = false;
  private newShow() {
    this.sound.start();
    this.sound.click();
    this.ui.hideMenu();
    const designs = DESIGNS.map((_, i) => i).filter((i) => i !== this.design);
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    this.roster = [];
    this.roster.push({ id: 0, name: 'You', design: this.design, seed: 0.37, skill: 1, player: true, out: false });
    for (let k = 1; k < FIELD; k++) {
      this.roster.push({
        id: k,
        name: names[k % names.length],
        design: designs[(k * 7) % designs.length],
        seed: Math.random() * 10,
        // a spread of ability: a few naturals, a solid middle, some hopeless
        skill: THREE.MathUtils.clamp(0.42 + Math.random() * 0.5 + (Math.random() < 0.15 ? 0.1 : 0), 0.4, 0.97),
        player: false,
        out: false,
      });
    }
    this.roundIdx = 0;
    void this.startRound();
  }

  private async startRound() {
    await this.loadRound(this.roundIdx, false);
    const c = this.course!;
    const alive = this.roster.filter((x) => !x.out).length;
    const info = SHOW[this.roundIdx];
    this.slots = c.kind === 'final' ? 1 : c.kind === 'survival' ? Math.max(2, Math.ceil(alive / 2)) : Math.max(2, Math.round(alive * (this.roundIdx === 0 ? 0.66 : 0.62)));
    const goal = c.kind === 'final' ? 'First across the line wins the crown' : c.kind === 'survival' ? `Last ${this.slots} on the plate go through` : `First ${this.slots} of ${alive} qualify`;
    this.ui.card({ n: this.roundIdx + 1, total: SHOW.length, name: info.name, kind: c.kind === 'survival' ? 'SURVIVAL' : c.kind === 'final' ? 'FINAL · RACE' : 'RACE', goal, blurb: info.blurb });
    this.state = 'intro';
    this.stateT = 0;
    this.ui.hud(false);
    this.sound.setKey(this.roundIdx);
    this.sound.setMusic('calm');
    this.sound.notes([67, 72], 0.12, 0.4, true);
  }

  /** builds a round's course and puts the field (or, for the menu, a handful) on the grid */
  private async loadRound(idx: number, menu: boolean) {
    if (this.course) {
      this.scene.remove(this.course.b.group);
      disposeGroup(this.course.b.group);
    }
    for (const r of this.racers) {
      this.scene.remove(r.mesh);
      r.mat.dispose();
    }
    this.racers = [];
    this.menuMarbles = [];
    this.preview = null;
    this.ui.clearTags();
    const c = (this.course = buildRound(SHOW[idx].id));
    if (c.path) courseAI(c);
    this.scene.add(c.b.group);
    this.splashes.y = c.lakeY;
    const ctr = c.path ? c.path.P[Math.floor(c.path.count / 2)] : c.plate!.center;
    this.stage.setCourse(c.lakeY, ctr);
    const field = menu ? this.menuField() : this.roster.filter((x) => !x.out);
    const grid = c.grid(field.length);
    // (the player at a random spot on the grid)
    const order = field.map((_, i) => i);
    if (!menu) order.sort(() => Math.random() - 0.5);
    field.forEach((x, k) => {
      const g = grid[order[k]];
      const m = new Marble(x.id);
      m.pos.copy(g.pos);
      m.quat.setFromAxisAngle(new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(), Math.random() * 6);
      m.frozen = !menu;
      c.b.world.marbles.push(m);
      const mat = marbleMaterial(DESIGNS[x.design], x.seed);
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      const bot = x.player && !(this.autopilot && !menu) ? null : new Bot(m, x.player ? 0.9 : x.skill, x.id * 31 + idx * 7);
      const hint = c.path ? c.path.projectAll(m.pos).i : 0;
      bot?.reset(hint);
      const r: Racer = { c: x, m, mesh, mat, bot, hint, s: 0, cp: c.checkpoints[0] ?? 0, fin: 0, out: false, fell: 0, hold: 0 };
      this.racers.push(r);
      if (menu && x.player) this.preview = r;
      if (menu) this.menuMarbles.push(r);
    });
    this.finCount = 0;
    this.playT = 0;
    this.confetti.clear();
    this.spectate = 0;
    this.yawOff = 0;
    const p = this.focus();
    if (p && c.path) {
      const i = c.path.index(p.s || 0);
      this.camYaw = Math.atan2(c.path.T[i].x, c.path.T[i].z);
    }
    // a frame of shader work up front for the new materials
    await new Promise((r) => setTimeout(r, 0));
  }

  private menuField(): Contestant[] {
    const out: Contestant[] = [{ id: 0, name: 'You', design: this.design, seed: 0.37, skill: 1, player: true, out: false }];
    for (let k = 1; k < 9; k++) out.push({ id: k, name: NAMES[k], design: (k * 5) % DESIGNS.length, seed: k * 1.7, skill: 0.6 + (k % 4) * 0.1, player: false, out: false });
    return out;
  }

  private player() {
    return this.racers.find((r) => r.c.player) ?? null;
  }
  /** the marble the camera follows: you, or (out) the one you're watching */
  private focus(): Racer | null {
    const p = this.player();
    if (p && !p.out) return p;
    const live = this.ranked().filter((r) => !r.out);
    if (!live.length) return this.racers[0] ?? null;
    return live[((this.spectate % live.length) + live.length) % live.length];
  }

  private ranked() {
    return [...this.racers].sort((a, b) => {
      if (a.fin && b.fin) return a.fin - b.fin;
      if (a.fin) return -1;
      if (b.fin) return 1;
      if (a.out !== b.out) return a.out ? 1 : -1;
      return b.s - a.s;
    });
  }

  // ------------------------------------------------------------------------------------- frame
  private frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.adapt(dt);
    if (!this.paused) this.tick(dt, now);
    this.render();
  }

  /** a test hook: run the show ahead without drawing */
  ff(seconds: number) {
    for (let t = 0; t < seconds; t += 1 / 60) {
      this.last = performance.now();
      this.tick(1 / 60, this.last);
    }
  }

  private tick(dt: number, now: number) {
    if (this.slowUntil > now) dt *= this.timeScale;
    this.stateT += dt;
    const c = this.course;
    if (!c) return;
    this.controls();
    switch (this.state) {
      case 'menu':
        this.menuTick(dt);
        break;
      case 'intro':
        if (this.stateT > 6.2 || this.pressed.has('Space') || this.pressed.has('Enter')) this.toCountdown();
        break;
      case 'countdown': {
        const n = 3 - Math.floor(this.stateT);
        if (n !== this.lastCount) {
          this.lastCount = n;
          if (n > 0) {
            this.ui.count(String(n));
            this.sound.countdown(n);
          }
        }
        if (this.stateT >= 3) this.go();
        break;
      }
      case 'play':
      case 'over':
        this.playT += dt;
        this.rules(dt);
        if (this.state === 'over' && this.stateT > 3.6) this.toResults();
        break;
      case 'results':
      case 'champion':
        if (this.resultsNext) {
          this.resultsT -= dt;
          this.ui.autoCount(this.resultsT);
          if (this.resultsT <= 0) {
            const f = this.resultsNext;
            this.resultsNext = null;
            f();
          }
        }
        break;
    }
    // bots drive; the world turns; marbles roll
    const w = c.b.world;
    for (const r of this.racers) if (r.bot && !r.out) r.bot.update(dt, w.time, c, w.marbles);
    w.step(dt);
    c.b.sync(w.time);
    this.sounds(dt);
    this.visuals(dt, now / 1000);
    this.cameraUpdate(dt);
    this.hud();
    this.pressed.clear();
  }
  private lastCount = 0;

  private render() {
    // (the shadow follows the action)
    this.stage.render(this.camLook);
  }

  /** the resolution follows the frame rate */
  private adapt(dt: number) {
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc < 2) return;
    const avg = this.fpsAcc / this.fpsN;
    this.fpsAcc = this.fpsN = 0;
    const max = Math.min(window.devicePixelRatio, 1.5);
    let q = this.quality;
    if (avg > 1 / 45) q = Math.max(0.6, q - 0.15);
    else if (avg < 1 / 58) q = Math.min(1, q + 0.05);
    if (q !== this.quality) {
      this.quality = q;
      this.renderer.setPixelRatio(max * q);
      this.resize();
    }
  }

  private controls() {
    const p = this.player();
    const pad = this.gamepad();
    if (pad?.cam) this.yawOff -= pad.cam * 0.04;
    if (!p || p.out || this.state === 'menu' || this.autopilot) return;
    const k = this.keys;
    let fx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let fy = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const t = this.ui.touch;
    if (t && (t.x || t.y)) {
      fx = t.x;
      fy = t.y;
    }
    if (pad && (pad.x || pad.y)) {
      fx = pad.x;
      fy = pad.y;
    }
    const yaw = this.camYaw + this.yawOff;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3().crossVectors(fwd, UP);
    const inp = p.m.input.set(0, 0, 0).addScaledVector(fwd, fy).addScaledVector(right, fx);
    if (inp.lengthSq() > 1) inp.normalize();
    const live = this.state === 'play' || this.state === 'over';
    let jump = this.pressed.has('Space') || !!t?.jump;
    let dash = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight') || this.pressed.has('KeyE') || !!t?.dash;
    if (pad) {
      if (pad.jump && !this.padJump) jump = true;
      if (pad.dash && !this.padDash) dash = true;
      this.padJump = pad.jump;
      this.padDash = pad.dash;
    }
    if (t) t.jump = t.dash = false;
    if (live && jump) p.m.jump = true;
    if (live && dash) p.m.dash = true;
  }

  private menuTick(dt: number) {
    const c = this.course!;
    // the attract mode: marbles nudged about the start platform behind the gate, the camera on yours
    for (const r of this.menuMarbles) {
      if (r.c.player) {
        r.m.input.set(0, 0, 0);
        continue;
      }
      const t = this.stateT + r.c.id * 1.3;
      r.m.input.set(Math.sin(t * 0.9), 0, Math.cos(t * 0.7)).multiplyScalar(0.35);
      if (Math.random() < dt * 0.25) r.m.jump = true;
      if (r.m.pos.y < c.killY + 10 || r.m.pos.distanceTo(c.path!.P[0]) > 40) this.placeAt(r, c.checkpoints[0] - 6, (Math.random() - 0.5) * 8);
    }
    // yours sits on show in front of the rest, turning slowly
    const p = this.preview;
    if (p) {
      const s = c.checkpoints[0] - 3.5;
      if (p.m.pos.distanceTo(c.path!.at(s, 2.5, 0.52)) > 0.05) this.placeAt(p, s, 2.5);
      p.m.frozen = true;
      p.m.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, dt * 0.6)).normalize();
    }
  }

  private toCountdown() {
    const c = this.course!;
    this.ui.hideCard();
    this.state = 'countdown';
    this.stateT = 0;
    this.lastCount = 0;
    this.ui.hud(true);
    this.yawOff = 0;
    const p = this.focus();
    if (p && c.path) {
      const i = c.path.index(c.path.projectAll(p.m.pos).s);
      this.camYaw = Math.atan2(c.path.T[i].x, c.path.T[i].z);
    } else if (p && c.plate) {
      const d = p.m.pos.clone().sub(c.plate.center);
      this.camYaw = Math.atan2(-d.x, -d.z);
    }
    this.snapCam = true;
    this.sound.setMusic('calm');
  }
  private snapCam = false;

  private go() {
    const c = this.course!;
    c.state.go = c.b.world.time;
    for (const r of this.racers) r.m.frozen = false;
    this.state = 'play';
    this.stateT = 0;
    this.playT = 0;
    this.ui.count('GO!');
    this.sound.countdown(0);
    this.sound.setMusic('play');
  }

  /** the round's rules: progress, falls and respawns, the line, eliminations */
  private rules(dt: number) {
    const c = this.course!;
    const w = c.b.world;
    const p = this.player();
    if (c.plate) {
      for (const r of this.racers) {
        if (r.out) continue;
        if (r.m.pos.y < c.killY) {
          r.out = true;
          r.m.active = false;
          this.drop(r);
          // (the crowd reacts to anyone going over near the camera)
          if (!r.c.player && r.m.pos.distanceTo(this.camera.position) < 25 && Math.random() < 0.6) this.sound.ooh();
          if (r.c.player && this.state === 'play') {
            this.ui.banner('ELIMINATED', 'bad', 'Knocked off the plate');
            this.sound.eliminated();
          }
        }
      }
      const alive = this.racers.filter((r) => !r.out).length;
      if (this.state === 'play' && (alive <= this.slots || this.playT > 80)) this.endRound();
      return;
    }
    const path = c.path!;
    for (const r of this.racers) {
      const m = r.m;
      if (r.out && !r.fin) continue;
      // falling: into the paint (a splash), then back at the last checkpoint
      if (r.fell) {
        if (w.time - r.fell > 1.1 && !r.fin) this.respawn(r);
        continue;
      }
      if (r.hold > 0) {
        r.hold -= dt;
        if (r.hold <= 0) m.frozen = false;
      }
      const pr = path.project(m.pos, r.hint, 40);
      if (pr.d < 9) {
        r.hint = pr.i;
        r.s = Math.max(r.s, Math.min(pr.s, r.s + 30));
      }
      if (m.pos.y < c.killY || pr.h < -9) {
        r.fell = w.time;
        this.drop(r);
        if (r.c.player) {
          this.sound.notes([60, 55], 0.12, 0.3);
          this.sound.ooh();
        }
        continue;
      }
      for (const cp of c.checkpoints) if (pr.s > cp + 1 && cp > r.cp && m.grounded && pr.d < 6) r.cp = cp;
      if (!r.fin && pr.s >= c.finishS && pr.d < 8 && this.state === 'play') {
        r.fin = ++this.finCount;
        const at = path.at(c.finishS, 0, 4);
        const ok = r.fin <= this.slots;
        if (ok) this.confetti.burst(at, r.c.player ? 260 : 40, r.c.player ? 11 : 8);
        if (r.c.player) {
          if (c.kind === 'final') {
            this.ui.banner('CROWNED!', 'gold', 'You win the show!', 0);
            this.sound.crowned();
          } else {
            this.ui.banner('QUALIFIED!', 'good', `${r.fin}${ordinal(r.fin)} across the line`);
            this.sound.qualified();
          }
        } else {
          const near = m.pos.distanceTo(this.camera.position) < 40;
          if (near) this.sound.notes([79], 0, 0.15);
        }
        if (c.kind === 'final') {
          this.slowUntil = performance.now() + 1800;
          this.timeScale = 0.35;
          if (!r.c.player) {
            this.sound.crowned();
            this.ui.banner(`${r.c.name.toUpperCase()} WINS!`, 'gold', 'The crown goes to ' + r.c.name, 0);
          }
          this.endRound();
        } else if (this.finCount >= this.slots) this.endRound();
      }
    }
    // the clock: two and a half minutes
    if (this.state === 'play' && this.playT > 150) this.endRound();
    void p;
  }

  private drop(r: Racer) {
    const c = this.course!;
    const m = r.m;
    // a splash where it'll land (straight down from here)
    const x = m.pos.x + m.vel.x * 0.4, z = m.pos.z + m.vel.z * 0.4;
    const fallT = Math.sqrt(Math.max(0, (2 * (m.pos.y - c.lakeY)) / 24));
    window.setTimeout(() => {
      this.splashes.splash(x, z);
      this.sound.splash(x, c.lakeY, z);
    }, Math.min(1500, fallT * 1000 * 0.9));
    if (r.c.player && !c.plate) this.ui.banner('SPLASH!', 'bad', 'Back to the checkpoint', 1200);
  }

  private respawn(r: Racer) {
    const c = this.course!;
    r.fell = 0;
    this.placeAt(r, r.cp, (Math.random() - 0.5) * 4);
    r.hold = 0.35;
    r.m.frozen = true;
    const path = c.path!;
    const i = path.index(r.cp);
    r.m.vel.copy(path.T[i]).multiplyScalar(3);
    r.bot?.reset(i);
    if (r.c.player) this.sound.respawn();
  }

  private placeAt(r: Racer, s: number, lat: number) {
    const path = this.course!.path!;
    const i = path.index(s);
    const half = path.sec[i].w / 2 - 1.2;
    r.m.pos.copy(path.at(s, THREE.MathUtils.clamp(lat, -half, half), 0.55));
    r.m.vel.set(0, 0, 0);
    r.m.ang.set(0, 0, 0);
    r.hint = i;
    r.s = s;
  }

  private endRound() {
    const c = this.course!;
    if (this.state !== 'play') return;
    this.state = 'over';
    this.stateT = 0;
    // who goes through
    for (const r of this.racers) {
      const through = c.plate ? !r.out : r.fin > 0 && r.fin <= this.slots;
      if (!through && !r.out) r.out = true;
      if (!through) r.c.out = true;
    }
    const p = this.player();
    if (p && p.out && !p.c.out) p.c.out = true;
    if (p && c.plate && !p.out) {
      this.ui.banner('SURVIVED!', 'good', 'You stayed on the plate');
      this.sound.qualified();
    } else if (p && !c.plate && p.out && !p.fin) {
      this.ui.banner('ELIMINATED', 'bad', 'The places are all taken');
      this.sound.eliminated();
    }
    if (c.kind !== 'final') this.sound.cheer(0.6);
  }

  private toResults() {
    const c = this.course!;
    const final = c.kind === 'final';
    const p = this.player();
    this.state = final ? 'champion' : 'results';
    this.stateT = 0;
    this.ui.hideBanner();
    this.ui.hud(false);
    this.sound.setMusic('calm');
    const order = this.ranked();
    const rows: Row[] = order.map((r) => ({
      name: r.c.name,
      color: DESIGNS[r.c.design].a,
      state: final ? (r.fin === 1 ? 'win' : 'out') : r.c.out ? 'out' : 'q',
      me: r.c.player,
      note: final ? (r.fin === 1 ? 'CROWN' : r.fin ? `${r.fin}${ordinal(r.fin)}` : '') : !c.plate && r.fin ? `${r.fin}${ordinal(r.fin)}` : undefined,
    }));
    if (final) {
      const win = order.find((r) => r.fin === 1) ?? order[0];
      const me = win?.c.player;
      this.ui.results({
        title: me ? 'YOU WIN THE CROWN!' : `${win.c.name} wins the crown`,
        sub: me ? 'Champion of Marble Mania' : p && !p.c.out ? 'So close. Run it back?' : 'What a show.',
        rows,
        next: 'PLAY AGAIN',
        onNext: () => {
          this.ui.hideResults();
          this.newShow();
        },
        extra: { label: 'MENU', on: () => this.toMenu() },
      });
      return;
    }
    const playerIn = p ? !p.c.out : false;
    const left = this.roster.filter((x) => !x.out).length;
    const next = () => {
      this.ui.hideResults();
      this.roundIdx++;
      void this.startRound();
    };
    this.ui.results({
      title: playerIn ? 'YOU QUALIFIED!' : p?.c.out && this.roster.find((x) => x.player)?.out ? 'ROUND OVER' : 'ROUND OVER',
      sub: `${left} marbles go through to ${SHOW[this.roundIdx + 1].name}`,
      rows,
      next: playerIn ? 'NEXT ROUND' : 'WATCH THE SHOW',
      onNext: next,
      extra: playerIn ? undefined : { label: 'NEW SHOW', on: () => (this.ui.hideResults(), this.newShow()) },
      auto: playerIn ? 8 : undefined,
    });
    this.resultsT = 8;
    this.resultsNext = playerIn ? next : null;
  }

  // ------------------------------------------------------------------------------------- sound
  private sounds(dt: number) {
    const c = this.course!;
    const s = this.sound;
    if (!s.ctx) return;
    s.cam.copy(this.camera.position);
    s.right.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const p = this.focus();
    s.hits(c.b.world.hits, p?.m);
    const list = this.racers
      .filter((r) => r.m.active && !r.m.frozen)
      .map((r) => ({ key: r.c.id, x: r.m.pos.x, y: r.m.pos.y, z: r.m.pos.z, speed: r.m.vel.length(), on: r.m.groundT < 0.05, mat: r.m.groundMat }));
    s.rolling(list, p?.c.id, dt);
    s.windAt(p ? p.m.vel.length() : 0);
    // the music heats up: the leader near the line, a survival round getting late
    const live = this.state === 'play';
    s.crowd(live || this.state === 'over' || this.state === 'countdown');
    if (live) {
      const lead = c.path ? Math.max(0, ...this.racers.map((r) => (r.fin ? 1 : r.s / c.finishS))) : this.playT / 70;
      s.setHeat(THREE.MathUtils.clamp((lead - 0.45) / 0.45, 0, 1));
    } else s.setHeat(0);
    for (const r of this.racers) {
      if (r.m.hopped && r.m.pos.distanceToSquared(this.camera.position) < 900) s.hop(r.m.pos.x, r.m.pos.y, r.m.pos.z, r.m.groundMat);
      if (r.m.dashed && r.m.pos.distanceToSquared(this.camera.position) < 900) s.dash(r.m.pos.x, r.m.pos.y, r.m.pos.z);
    }
  }

  // ------------------------------------------------------------------------------------- visuals
  private inv = new THREE.Matrix4();
  private visuals(dt: number, t: number) {
    const cam = this.camera;
    for (const r of this.racers) {
      const mesh = r.mesh;
      mesh.visible = r.m.active || r.m.pos.y > this.course!.lakeY;
      mesh.position.copy(r.m.pos);
      mesh.quaternion.copy(r.m.quat);
      mesh.updateMatrixWorld();
    }
    // the glass: the camera in each marble's frame, and its rotation to the world
    this.scene.traverseVisible((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      const u = m && (m.userData?.u as { uCamObj?: { value: THREE.Vector3 }; uRotW?: { value: THREE.Matrix3 } } | undefined);
      if (!u?.uCamObj) return;
      o.updateWorldMatrix(true, false);
      this.inv.copy(o.matrixWorld).invert();
      u.uCamObj.value.copy(cam.position).applyMatrix4(this.inv);
      u.uRotW!.value.setFromMatrix4(o.matrixWorld);
      const s = o.userData.giant as number | undefined;
      if (s) u.uRotW!.value.multiplyScalar(1);
    });
    // the light through the glass: tinted shadows, the lens's bright focus
    const statics = this.course!.b.world.statics;
    this.caustics.update(
      this.racers.filter((r) => r.mesh.visible).map((r) => ({ pos: r.m.pos, design: DESIGNS[r.c.design] })),
      SUN,
      (x, y, z, d) => statics.floorBelow(x, y, z, d),
      this.camLook,
    );
    this.stage.update(dt, t);
    this.confetti.update(dt, t);
    this.splashes.update(dt);
    const crown = this.course?.crown;
    if (crown) crown.rotation.y += dt * 0.8;
  }

  // ------------------------------------------------------------------------------------- camera
  private cameraUpdate(dt: number) {
    const c = this.course!;
    const cam = this.camera;
    // (a test hook: a fixed camera)
    const dc = (window as unknown as { __cam?: { p: number[]; l: number[] } }).__cam;
    if (dc) {
      cam.position.fromArray(dc.p);
      this.camLook.fromArray(dc.l);
      cam.lookAt(this.camLook);
      return;
    }
    if (this.state === 'intro') return this.introCam();
    if (this.state === 'menu') return this.menuCam();
    if (this.state === 'champion') return this.championCam(dt);
    const f = this.focus();
    if (!f) return;
    const m = f.m;
    const speed = m.vel.length();
    if (!this.dragging) this.yawOff *= 1 - Math.min(1, dt * (c.plate ? 0.2 : 0.7));
    let want = this.camYaw;
    if (c.plate) {
      const d = m.pos.clone().sub(c.plate.center);
      d.y = 0;
      if (d.length() > 1) want = Math.atan2(-d.x, -d.z);
    } else if (c.path && !f.fell) {
      const i = c.path.index(f.s + 4);
      const T = c.path.T[i];
      want = Math.atan2(T.x, T.z);
      if (speed > 4 && m.grounded) {
        const vy = Math.atan2(m.vel.x, m.vel.z);
        want = lerpAngle(want, vy, 0.35);
      }
    }
    this.camYaw = lerpAngle(this.camYaw, want, this.snapCam ? 1 : Math.min(1, dt * (c.plate ? 1.5 : 3)));
    const yaw = this.camYaw + this.yawOff;
    const dist = c.plate ? 9.5 : 6.3 + Math.min(speed, 26) * 0.1;
    const hgt = c.plate ? 5.2 : 3.5 + Math.min(speed, 26) * 0.05;
    const tgt = m.pos.clone();
    if (f.fell) tgt.y = Math.max(tgt.y, c.lakeY + 6);
    const pos = new THREE.Vector3(tgt.x - Math.sin(yaw) * dist, tgt.y + hgt, tgt.z - Math.cos(yaw) * dist);
    const look = tgt.clone().add(new THREE.Vector3(Math.sin(yaw) * 2.6, 0.55, Math.cos(yaw) * 2.6));
    if (c.plate) look.lerp(c.plate.center, 0.25);
    if (this.snapCam) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.snapCam = false;
    } else {
      // (the height lags a little more: drops feel like drops)
      const k = Math.min(1, dt * 7);
      this.camPos.x += (pos.x - this.camPos.x) * k;
      this.camPos.z += (pos.z - this.camPos.z) * k;
      this.camPos.y += (pos.y - this.camPos.y) * Math.min(1, dt * 4.5);
      this.camLook.lerp(look, Math.min(1, dt * 10));
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    const fov = 60 + Math.min(14, Math.max(0, speed - 8) * 0.6);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }

  private introCam() {
    const c = this.course!;
    const cam = this.camera;
    const t = this.stateT / 6.2;
    if (c.plate) {
      const a = 0.6 + t * 2.4;
      const r = 32 - t * 10;
      cam.position.set(c.plate.center.x + Math.cos(a) * r, c.plate.center.y + 16 - t * 6, c.plate.center.z + Math.sin(a) * r);
      this.camLook.copy(c.plate.center);
      cam.lookAt(this.camLook);
      return;
    }
    const path = c.path!;
    // high over the course, start to finish, then a swoop back to the grid
    const e = t * t * (3 - 2 * t);
    const s = e * path.length * 0.92;
    const i = path.index(s);
    const side = new THREE.Vector3().crossVectors(path.T[i], UP).normalize();
    const p = path.at(s, 0, 0).addScaledVector(side, 16).add(new THREE.Vector3(0, 22, 0)).addScaledVector(path.T[i], -14);
    const look = path.at(Math.min(path.length, s + 22), 0, 0);
    cam.position.lerp(p, this.stateT < 0.1 ? 1 : 0.08);
    this.camLook.lerp(look, this.stateT < 0.1 ? 1 : 0.1);
    cam.lookAt(this.camLook);
  }

  /** the winner: the crown floats down onto it, the camera circles, confetti keeps coming */
  private championCam(dt: number) {
    const c = this.course!;
    const win = this.racers.find((r) => r.fin === 1) ?? this.racers[0];
    if (!win) return;
    const cam = this.camera;
    const tgt = win.m.pos;
    const a = this.stateT * 0.35;
    const r = 4.2 - Math.min(1, this.stateT * 0.3) * 0.8;
    cam.position.lerp(new THREE.Vector3(tgt.x + Math.sin(a) * r, tgt.y + 1.6, tgt.z + Math.cos(a) * r), Math.min(1, dt * 3));
    this.camLook.lerp(tgt.clone().add(new THREE.Vector3(0, 0.7, 0)), Math.min(1, dt * 4));
    cam.lookAt(this.camLook);
    if (c.crown) {
      const h = 1.05 + Math.max(0, 2.5 - this.stateT * 1.5);
      c.crown.position.lerp(tgt.clone().add(new THREE.Vector3(0, h, 0)), Math.min(1, dt * 5));
      c.crown.scale.setScalar(0.55);
    }
    this.confT -= dt;
    if (this.confT <= 0) {
      this.confT = 0.7;
      this.confetti.burst(tgt.clone().add(new THREE.Vector3(0, 3, 0)), 50, 7, 4);
    }
  }
  private confT = 0;

  private menuCam() {
    const p = this.preview;
    const path = this.course?.path;
    if (!p || !path) return;
    const cam = this.camera;
    // from behind the gate, swaying side to side, your marble right of centre (the title is on the left)
    const i = path.index(p.s);
    const a = Math.sin(this.stateT * 0.22) * 0.55 + 0.35;
    const back = path.T[i].clone().negate(), side = path.Rt[i];
    const tgt = p.m.pos;
    const dir = back.multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
    cam.position.copy(tgt).addScaledVector(dir, 3.3).add(new THREE.Vector3(0, 1.05, 0));
    const cr = new THREE.Vector3().subVectors(tgt, cam.position).cross(UP).normalize();
    this.camLook.copy(tgt).addScaledVector(cr, -1.05).add(new THREE.Vector3(0, 0.2, 0));
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - 42) > 0.1) {
      cam.fov = 42;
      cam.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------------------------------- HUD
  private hud() {
    const c = this.course!;
    if (this.state === 'menu' || this.state === 'intro') return;
    const cam = this.camera;
    const W = window.innerWidth, H = window.innerHeight;
    const p = this.player();
    const f = this.focus();
    const v = new THREE.Vector3();
    for (const r of this.racers) {
      const me = r.c.player;
      v.copy(r.m.pos).add(new THREE.Vector3(0, 0.95, 0)).project(cam);
      const dist = r.m.pos.distanceTo(cam.position);
      const show = !r.out && !r.fell && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (me || dist < 22) && r.m.active;
      this.ui.tag(r.c.id, me ? 'YOU' : r.c.name, ((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H, show, me);
    }
    const alive = this.racers.filter((r) => !r.out).length;
    const race = !c.plate;
    const ranked = this.ranked();
    let status = '';
    if (c.kind === 'final') status = this.finCount ? 'WINNER!' : 'FIRST WINS';
    else if (race) status = `QUALIFIED ${Math.min(this.finCount, this.slots)} / ${this.slots}`;
    else status = `ALIVE ${alive} · TO ${this.slots}`;
    const pos = f && race ? ranked.indexOf(f) + 1 : undefined;
    let timer: string | undefined;
    if (c.plate && (this.state === 'play' || this.state === 'over')) {
      const left = Math.max(0, 80 - this.playT);
      timer = `0:${String(Math.ceil(left)).padStart(2, '0')}`;
    } else if (race && this.state === 'play' && this.playT > 120) timer = `0:${String(Math.ceil(150 - this.playT)).padStart(2, '0')}`;
    const spectating = p && p.out ? `Watching ${f?.c.name ?? ''} · ←/→ to switch` : undefined;
    if (spectating && (this.pressed.has('ArrowLeft') || this.pressed.has('KeyA'))) this.spectate--;
    if (spectating && (this.pressed.has('ArrowRight') || this.pressed.has('KeyD'))) this.spectate++;
    this.ui.hudData({
      title: SHOW[this.roundIdx].name.toUpperCase(),
      status,
      pos: pos && pos > 0 ? pos : undefined,
      total: this.racers.length,
      posNote: f && f.fin && f.fin <= this.slots ? 'QUALIFIED' : undefined,
      timer,
      dash: p ? 1 - p.m.dashCD / 1.8 : 1,
      spectate: spectating,
      race,
      keys: this.roundIdx === 0 && this.playT < 12,
    });
    if (race && c.path) {
      const L = c.finishS;
      this.ui.progress(this.racers.map((r) => ({ id: r.c.id, f: r.fin ? 1 : r.s / L, color: DESIGNS[r.c.design].a, me: r.c.player, out: r.out && !r.fin })));
    }
  }
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function kindName(k: number) {
  return ["Cat's eye", 'Ribbon', 'Galaxy', 'Candy', 'Bubble glass', 'Lava core', 'Rainbow vane', 'Opal', 'Swirl', 'Mica', 'Pearl'][k] ?? 'Glass';
}

function disposeGroup(g: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mm = m.material;
    if (Array.isArray(mm)) mm.forEach((x) => mats.add(x));
    else if (mm) mats.add(mm);
  });
  for (const m of mats) {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
    m.dispose();
  }
}
