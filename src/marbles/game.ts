import * as THREE from 'three';
import { Bot } from './ai.ts';
import { courseAI } from './ai-course.ts';
import { level, LEVELS, roll, STYLES, type Level, type StyleId } from './ai-style.ts';
import { Sound } from './audio.ts';
import { buildRound, SHOW, type Course } from './courses.ts';
import { BeanRig, OUTFITS, randomOutfit, type Outfit } from './bean.ts';
import { Confetti, Splashes } from './fx.ts';
import { DASH_CD, Marble, Mode } from './physics.ts';
import { Stage } from './render.ts';
import { ordinal, UI, type Row } from './ui.ts';
import { F, MAX_PLAYERS, PartyGuest, PartyHost, STRIDE, type CtlMsg, type Member, type NetContestant } from './net.ts';

/**
 * Wobble Mania: a knockout show for 24 jelly beans on wooden obstacle courses — races where only
 * the first across the line go through, survival rounds, and a final for the crown. You are one
 * bean; the rest are bots of mixed skill (or, online, your friends and bots). Out of the show, you
 * can watch it to the end.
 */

export interface Contestant {
  id: number;
  name: string;
  outfit: Outfit;
  skill: number;
  style: StyleId;
  /** this browser's own bean */
  player: boolean;
  out: boolean;
  /** online: who runs it ('' this browser; a peer id; 'host' the host's browser) */
  owner: string;
  /** a human (here or online) */
  human: boolean;
}

interface Racer {
  c: Contestant;
  m: Marble;
  rig: BeanRig;
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
  /** this browser runs it (solo: all of them; online: mine, and on the host the bots too) */
  local: boolean;
  /** online, a remote bean's last state: where, when (s), the events in it */
  netPos: THREE.Vector3;
  netT: number;
  netEv: number;
  /** events since the last state this browser sent */
  ev: number;
  /** a finish or a fall told to the host, not answered yet */
  pend: boolean;
}

type State = 'menu' | 'intro' | 'countdown' | 'play' | 'over' | 'results' | 'champion';

const NAMES = ['Wobbles', 'Jellyroll', 'Bonk', 'Squish', 'Mr. Beans', 'Gumdrop', 'Sprinkles', 'Noodle', 'Bubbles', 'Twister', 'Pudding', 'Cosmo', 'Waddle', 'Jiggly', 'Sparky', 'Comet', 'Biscuit', 'Nugget', 'Ziggy', 'Pip', 'Dotty', 'Flop', 'Ollie', 'Sprocket', 'Gizmo', 'Tumbles', 'Lucky', 'Mochi', 'Rocket', 'Peanut', 'Splat', 'Boing'];
const FIELD = 24;
const UP = new THREE.Vector3(0, 1, 0);
const PT = new THREE.Vector3();

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
  /** the bots' difficulty (the menu's choice, remembered; ?diff= for tests) */
  private level: Level = level(readPref());
  private roundIdx = 0;
  private state: State = 'menu';
  private stateT = 0;
  private playT = 0;
  private finCount = 0;
  private slots = 0;
  private design = readOutfit();
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
  private splashes = new Splashes();
  private timeScale = 1;
  private slowUntil = 0;
  private last = performance.now();
  private preview: Racer | null = null;
  private resultsT = 0;
  private resultsNext: (() => void) | null = null;
  private quality = 1;
  private fpsAcc = 0;
  private fpsN = 0;
  private menuMarbles: Racer[] = [];
  // ---- party play
  private host: PartyHost | null = null;
  private guest: PartyGuest | null = null;
  private members: Member[] = [];
  private myName = readName();
  /** online without a name: one made up */
  private anon = `${NAMES[Math.floor(Math.random() * NAMES.length)]} ${10 + Math.floor(Math.random() * 90)}`;
  /** a show's number and the round in it, on every state sent (an old round's are ignored) */
  private showNo = 0;
  /** guest: the host's world clock minus performance.now() (s) */
  private worldOff = NaN;
  private sendAcc = 0;
  private shoveT = new Map<string, number>();
  private loadedBy = new Set<string>();
  /** the world time the gate opens */
  private goAt = 0;
  /** online: the menu over a live show (it doesn't stop) */
  private overlay = false;

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
    this.scene.add(this.confetti.mesh, this.splashes.group);
    progress(0.3, 'Laying the planks');
    this.resize();
    // the menu's backdrop: the first course with marbles rolling about the start
    await this.loadRound(0, true);
    progress(0.7, 'Warming the shaders');
    await r.compileAsync(this.scene, this.camera);
    progress(1, 'Ready');
    const q = new URLSearchParams(location.search);
    // (test hooks: ?round=N jumps into the show at that round, ?auto=1 lets a bot drive you)
    if (q.get('diff')) this.level = level(q.get('diff'));
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
    if (this.online()) {
      // (online the show can't stop for one of you)
      this.overlay = !this.overlay;
      this.ui.pause(this.overlay, {
        onResume: () => this.togglePause(),
        onMusic: () => {
          this.toggleMusic();
          this.overlay = false;
          this.togglePause();
        },
        onQuit: () => {
          this.overlay = false;
          this.ui.pause(false);
          this.leaveParty();
        },
        music: this.sound.musicOn,
        online: true,
      });
      return;
    }
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
      return { x, y, jump: !!p.buttons[0]?.pressed, dash: !!(p.buttons[2]?.pressed || p.buttons[1]?.pressed), grab: !!(p.buttons[7]?.pressed || p.buttons[5]?.pressed || p.buttons[3]?.pressed), cam: Math.abs(p.axes[2] ?? 0) > 0.2 ? p.axes[2] : 0 };
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
    this.ui.hideLobby();
    this.ui.pause(false);
    this.overlay = false;
    this.ui.clearTags();
    this.confetti.clear();
    if (!this.course || this.course.id !== 'timber' || this.racers.length === 0 || this.menuMarbles.length === 0) void this.loadRound(0, true);
    this.ui.menu({
      design: OUTFITS[this.design].name,
      kind: hatName(OUTFITS[this.design]),
      onPrev: () => this.pickDesign(-1),
      onNext: () => this.pickDesign(1),
      onPlay: () => this.newShow(),
      onHost: () => this.hostParty(),
      onJoin: (code) => this.joinParty(code),
      name: this.myName,
      onName: (n) => {
        this.myName = n;
        writeName(n);
      },
      levels: LEVELS.map((l) => ({ id: l.id, name: l.name, blurb: l.blurb })),
      level: this.level.id,
      onLevel: (id) => {
        this.sound.start();
        this.sound.click();
        this.level = level(id);
        writePref(id);
      },
    });
    this.sound.setMusic('menu');
  }

  private pickDesign(d: number) {
    this.sound.start();
    this.sound.click();
    this.design = (this.design + d + OUTFITS.length) % OUTFITS.length;
    writeOutfit(this.design);
    this.ui.design(OUTFITS[this.design].name, hatName(OUTFITS[this.design]));
    const p = this.preview;
    if (p) {
      // (a new bean in the same spot)
      this.scene.remove(p.rig.root);
      p.rig.dispose();
      p.c.outfit = OUTFITS[this.design];
      p.rig = new BeanRig(p.c.outfit);
      p.rig.pose = 'wave';
      this.scene.add(p.rig.root);
      p.rig.update(p.m, 0, 0);
      this.sound.voice('hup', p.m.id, 0, 0, 0, true);
    }
  }

  autopilot = false;
  private newShow() {
    this.sound.start();
    this.sound.click();
    this.ui.hideMenu();
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    this.roster = [];
    this.roster.push({ id: 0, name: this.myName || 'You', outfit: OUTFITS[this.design], skill: 1, style: 'racer', player: true, out: false, owner: '', human: true });
    for (let k = 1; k < FIELD; k++) {
      // a spread of ability for the difficulty (a few naturals at the top), and a style each
      const { skill, style } = roll(this.level, Math.random);
      this.roster.push({ id: k, name: names[k % names.length], outfit: k < OUTFITS.length && Math.random() < 0.5 ? OUTFITS[(this.design + k) % OUTFITS.length] : randomOutfit(Math.random), skill, style, player: false, out: false, owner: '', human: false });
    }
    this.roundIdx = 0;
    void this.startRound();
  }

  private async startRound() {
    const alive = this.roster.filter((x) => !x.out).length;
    const info = SHOW[this.roundIdx];
    this.slots = info.kind === 'final' ? 1 : Math.max(2, (info.kind === 'survival' ? Math.ceil : Math.round)(alive * info.keep));
    // (online: everyone builds the same round, with the field in the same places)
    const order = this.roster.filter((x) => !x.out).map((x) => x.id).sort(() => Math.random() - 0.5);
    this.loadedBy.clear();
    this.host?.broadcast({ t: 'round', idx: this.roundIdx, order, slots: this.slots, out: this.roster.filter((x) => x.out).map((x) => x.id), key: this.roundKey() });
    await this.loadRound(this.roundIdx, false, order);
    this.introCard();
  }

  /** the round's card over the flyover */
  private introCard() {
    const c = this.course!;
    const alive = this.roster.filter((x) => !x.out).length;
    const info = SHOW[this.roundIdx];
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
  private async loadRound(idx: number, menu: boolean, order0?: number[]) {
    if (this.course) {
      this.scene.remove(this.course.b.group);
      disposeGroup(this.course.b.group);
    }
    for (const r of this.racers) {
      this.scene.remove(r.rig.root);
      r.rig.dispose();
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
    const field = menu ? this.menuField() : order0 ? order0.map((id) => this.roster.find((x) => x.id === id)!).filter(Boolean) : this.roster.filter((x) => !x.out);
    const grid = c.grid(field.length);
    // (the player at a random spot on the grid; online, the host's order)
    const order = field.map((_, i) => i);
    if (!menu && !order0) order.sort(() => Math.random() - 0.5);
    field.forEach((x, k) => {
      const g = grid[order[k]];
      const local = menu || this.isLocal(x);
      const m = new Marble(x.id);
      m.pos.copy(g.pos);
      m.yaw = g.yaw;
      m.frozen = !menu;
      m.puppet = !local;
      c.b.world.marbles.push(m);
      const rig = new BeanRig(x.outfit);
      this.scene.add(rig.root);
      const wantBot = menu ? !x.player : local && (x.player ? this.autopilot : !x.human);
      const bot = !wantBot ? null : new Bot(m, x.player ? 0.9 : x.skill, x.id * 31 + idx * 7, STYLES[x.style], x.player || menu ? 0 : this.level.boost);
      const hint = c.path ? c.path.projectAll(m.pos).i : 0;
      bot?.reset(hint);
      const r: Racer = { c: x, m, rig, bot, hint, s: 0, cp: c.checkpoints[0] ?? 0, fin: 0, out: false, fell: 0, hold: 0, local, netPos: m.pos.clone(), netT: performance.now() / 1000, netEv: 0, ev: 0, pend: false };
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
    // the new materials' shaders compiled up front, not mid-race
    await this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
  }

  private menuField(): Contestant[] {
    const out: Contestant[] = [{ id: 0, name: 'You', outfit: OUTFITS[this.design], skill: 1, style: 'racer', player: true, out: false, owner: '', human: true }];
    for (let k = 1; k < 9; k++) out.push({ id: k, name: NAMES[k], outfit: OUTFITS[(k * 5) % OUTFITS.length], skill: 0.6 + (k % 4) * 0.1, style: 'racer', player: false, out: false, owner: '', human: false });
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
      case 'intro': {
        // (online the host starts the countdown once everyone has the round built, or has waited long enough)
        const skip = this.pressed.has('Space') || this.pressed.has('Enter');
        if (this.guest) {
          if (skip) this.ui.hideCard();
        } else if (this.host) {
          const all = [...this.host.guests.keys()].every((id) => this.loadedBy.has(id) || !this.roster.some((x) => x.owner === id && !x.out));
          if ((this.stateT > INTRO_T || (skip && this.stateT > 1.5)) && (all || this.stateT > 20)) this.toCountdown();
        } else if (this.stateT > INTRO_T || skip) this.toCountdown();
        break;
      }
      case 'countdown': {
        const n = Math.ceil(this.goAt - c.b.world.time);
        if (n !== this.lastCount && n <= 3) {
          this.lastCount = n;
          if (n > 0) {
            this.ui.count(String(n));
            this.sound.countdown(n);
          }
        }
        if (c.b.world.time >= this.goAt) this.go();
        break;
      }
      case 'play':
      case 'over':
        this.playT += dt;
        this.rules(dt);
        if (this.state === 'over' && this.stateT > 3.6 && !this.guest) this.toResults();
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
    // bots drive; the world turns; beans run
    const w = c.b.world;
    const net = this.online() && this.state !== 'menu';
    if (net) dt = this.netBefore(dt);
    for (const r of this.racers) {
      if (r.bot && !r.out) r.bot.update(dt, w.time, c, w.marbles);
      else if (r.out && r.m.active && r.local) {
        // (out: it stops trying, and once it's in the paint it's gone)
        r.m.input.set(0, 0, 0);
        r.m.grab = false;
        if (r.m.pos.y < c.lakeY - 2) r.m.active = false;
      }
    }
    w.step(dt);
    c.b.sync(w.time);
    if (net) this.netAfter(dt);
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
    let dash = this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight') || this.pressed.has('ControlLeft') || !!t?.dash;
    let grab = k.has('KeyE') || k.has('KeyF') || !!t?.grab;
    if (pad) {
      if (pad.jump && !this.padJump) jump = true;
      if (pad.dash && !this.padDash) dash = true;
      this.padJump = pad.jump;
      this.padDash = pad.dash;
      grab ||= pad.grab;
    }
    if (t) t.jump = t.dash = false;
    if (live && jump) p.m.jump = true;
    if (live && dash) p.m.dash = true;
    p.m.grab = live && grab;
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
      p.rig.pose = 'wave';
    }
  }

  /** the countdown to GO at world time `goAt` (online: the host's, sent to all) */
  private toCountdown(goAt?: number) {
    const c = this.course!;
    this.goAt = goAt ?? c.b.world.time + 3;
    this.host?.broadcast({ t: 'count', go: this.goAt });
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
    c.state.go = this.goAt;
    for (const r of this.racers) r.m.frozen = false;
    this.state = 'play';
    this.stateT = 0;
    this.playT = 0;
    this.ui.count('GO!');
    this.sound.countdown(0);
    this.sound.setMusic('play');
  }

  /** the round's rules: progress, falls and respawns, the line, eliminations (each browser for its own beans) */
  private rules(dt: number) {
    const c = this.course!;
    const w = c.b.world;
    if (c.plate) {
      for (const r of this.racers) {
        if (r.out || r.m.pos.y >= c.killY) continue;
        if (!r.local) {
          // (someone else's: just the splash; the host says when it's out)
          if (!r.fell) {
            r.fell = w.time;
            this.drop(r);
            this.sound.voice('wah', r.m.id, r.m.pos.x, r.m.pos.y, r.m.pos.z, false);
          }
          continue;
        }
        if (this.guest) {
          if (!r.pend) {
            r.pend = true;
            this.guest.send({ t: 'out', id: r.c.id });
            this.fellOff(r);
          }
          continue;
        }
        this.eliminate(r);
      }
      const alive = this.racers.filter((r) => !r.out).length;
      if (!this.guest && this.state === 'play' && (alive <= this.slots || this.playT > SURVIVE_T)) this.endRound();
      return;
    }
    const path = c.path!;
    for (const r of this.racers) {
      const m = r.m;
      if (r.out && !r.fin) continue;
      if (!r.local) {
        // (someone else's: its progress comes with its state; a splash when it goes in)
        if (!r.fell && m.pos.y < c.killY) {
          r.fell = w.time;
          this.drop(r);
        } else if (r.fell && m.pos.y > c.killY + 3) r.fell = 0;
        continue;
      }
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
        this.sound.voice('wah', m.id, m.pos.x, m.pos.y, m.pos.z, r.c.player);
        if (r.c.player) {
          this.sound.notes([60, 55], 0.12, 0.3);
          this.sound.ooh();
        }
        continue;
      }
      for (const cp of c.checkpoints) if (pr.s > cp + 1 && cp > r.cp && m.grounded && pr.d < 6) r.cp = cp;
      if (!r.fin && !r.pend && pr.s >= c.finishS && pr.d < 8 && this.state === 'play') {
        if (this.guest) {
          // (the host gives out the places)
          r.pend = true;
          this.guest.send({ t: 'fin', id: r.c.id });
        } else this.finish(r);
      }
    }
    // the clock
    if (!this.guest && this.state === 'play' && this.playT > RACE_T) this.endRound();
  }

  /** (the host, or solo) a bean across the line: its place */
  private finish(r: Racer) {
    const c = this.course!;
    if (r.fin || this.state !== 'play') return;
    r.fin = ++this.finCount;
    this.host?.broadcast({ t: 'fin', id: r.c.id, place: r.fin });
    this.finished(r);
    if (c.kind === 'final') this.endRound();
    else if (this.finCount >= this.slots) this.endRound();
  }

  /** a finish as everyone sees it: confetti, the banner, the slow-motion crown */
  private finished(r: Racer) {
    const c = this.course!;
    const path = c.path!;
    const m = r.m;
    const at = path.at(c.finishS, 0, 4);
    if (r.fin <= this.slots) this.confetti.burst(at, r.c.player ? 260 : 40, r.c.player ? 11 : 8);
    if (r.c.player) {
      if (c.kind === 'final') {
        this.ui.banner('CROWNED!', 'gold', 'You win the show!', 0);
        this.sound.crowned();
      } else {
        this.ui.banner('QUALIFIED!', 'good', `${r.fin}${ordinal(r.fin)} across the line`);
        this.sound.qualified();
      }
      this.sound.voice('yay', m.id, m.pos.x, m.pos.y, m.pos.z, true);
    } else if (m.pos.distanceTo(this.camera.position) < 40) this.sound.notes([79], 0, 0.15);
    if (c.kind === 'final' && r.fin === 1) {
      this.slowUntil = performance.now() + 1800;
      this.timeScale = 0.35;
      if (!r.c.player) {
        this.sound.crowned();
        this.ui.banner(`${r.c.name.toUpperCase()} WINS!`, 'gold', 'The crown goes to ' + r.c.name, 0);
      }
    }
  }

  /** (the host, or solo) off the plate and out */
  private eliminate(r: Racer) {
    if (r.out) return;
    this.host?.broadcast({ t: 'out', id: r.c.id });
    if (!r.pend && !r.fell) this.fellOff(r);
    r.out = true;
  }

  /** going over the edge of the plate, as everyone sees it */
  private fellOff(r: Racer) {
    const m = r.m;
    this.drop(r);
    this.sound.voice('wah', m.id, m.pos.x, m.pos.y, m.pos.z, r.c.player);
    // (the crowd reacts to anyone going over near the camera)
    if (!r.c.player && m.pos.distanceTo(this.camera.position) < 25 && Math.random() < 0.6) this.sound.ooh();
    if (r.c.player && this.state === 'play') {
      this.ui.banner('ELIMINATED', 'bad', 'Knocked off the plate');
      this.sound.eliminated();
    }
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
    r.m.mode = Mode.Run;
    r.m.tumbleT = r.m.upT = r.m.heldT = 0;
    r.m.release();
    r.m.yaw = Math.atan2(path.T[i].x, path.T[i].z);
    r.hint = i;
    r.s = s;
  }

  /** (the host, or solo) time's up or the places are taken: who goes through */
  private endRound() {
    const c = this.course!;
    if (this.state !== 'play') return;
    const through = this.racers.filter((r) => (c.plate ? !r.out : r.fin > 0 && r.fin <= this.slots)).map((r) => r.c.id);
    this.host?.broadcast({ t: 'end', through, fins: this.racers.filter((r) => r.fin).map((r) => [r.c.id, r.fin] as [number, number]) });
    this.roundOver(new Set(through));
  }

  /** the round's over (everyone): the field cut to who went through */
  private roundOver(through: Set<number>) {
    const c = this.course!;
    if (this.state !== 'play' && this.state !== 'countdown') return;
    this.state = 'over';
    this.stateT = 0;
    for (const r of this.racers) {
      const ok = through.has(r.c.id);
      if (!ok && !r.out) r.out = true;
      if (!ok) r.c.out = true;
    }
    for (const x of this.roster) if (!through.has(x.id)) x.out = true;
    const p = this.player();
    if (p && p.out && !p.c.out) p.c.out = true;
    if (p && c.plate && !p.out) {
      this.ui.banner('SURVIVED!', 'good', 'You stayed on the plate');
      this.sound.qualified();
      this.sound.voice('yay', p.m.id, p.m.pos.x, p.m.pos.y, p.m.pos.z, true);
    } else if (p && !c.plate && p.out && !p.fin) {
      this.ui.banner('ELIMINATED', 'bad', 'The places are all taken');
      this.sound.eliminated();
      this.sound.voice('aww', p.m.id, p.m.pos.x, p.m.pos.y, p.m.pos.z, true);
    }
    if (c.kind !== 'final') this.sound.cheer(0.6);
  }

  private toResults() {
    const c = this.course!;
    const final = c.kind === 'final';
    const p = this.player();
    this.host?.broadcast({ t: final ? 'champion' : 'results' });
    this.state = final ? 'champion' : 'results';
    this.stateT = 0;
    this.ui.hideBanner();
    this.ui.hud(false);
    this.sound.setMusic('calm');
    const order = this.ranked();
    const rows: Row[] = order.map((r) => ({
      name: r.c.name,
      color: r.c.outfit.a,
      state: final ? (r.fin === 1 ? 'win' : 'out') : r.c.out ? 'out' : 'q',
      me: r.c.player,
      style: r.c.human ? (r.c.player ? undefined : 'Player') : STYLES[r.c.style].name,
      note: final ? (r.fin === 1 ? 'CROWN' : r.fin ? `${r.fin}${ordinal(r.fin)}` : '') : !c.plate && r.fin ? `${r.fin}${ordinal(r.fin)}` : undefined,
    }));
    const online = this.online();
    if (final) {
      const win = order.find((r) => r.fin === 1) ?? order[0];
      const me = win?.c.player;
      this.ui.results({
        title: me ? 'YOU WIN THE CROWN!' : `${win.c.name} wins the crown`,
        sub: me ? 'Champion of Wobble Mania' : p && !p.c.out ? 'So close. Run it back?' : 'What a show.',
        rows,
        next: this.guest ? 'WAITING FOR THE HOST' : 'PLAY AGAIN',
        wait: !!this.guest,
        onNext: () => {
          if (this.guest) return;
          this.ui.hideResults();
          if (this.host) this.startShow();
          else this.newShow();
        },
        extra: online ? (this.host ? { label: 'LOBBY', on: () => this.toLobby() } : { label: 'LEAVE', on: () => this.leaveParty() }) : { label: 'MENU', on: () => this.toMenu() },
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
      title: playerIn ? 'YOU QUALIFIED!' : 'ROUND OVER',
      sub: `${left} beans go through to ${SHOW[this.roundIdx + 1].name}`,
      rows,
      next: this.guest ? 'NEXT ROUND SOON' : playerIn || this.host ? 'NEXT ROUND' : 'WATCH THE SHOW',
      wait: !!this.guest,
      onNext: () => {
        if (!this.guest) next();
      },
      extra: online ? { label: 'LEAVE', on: () => this.leaveParty() } : playerIn ? undefined : { label: 'NEW SHOW', on: () => (this.ui.hideResults(), this.newShow()) },
      auto: (playerIn || this.host) && !this.guest ? 8 : undefined,
    });
    this.resultsT = 8;
    // (online the host moves the show on, whether it's still in or not)
    this.resultsNext = playerIn || this.host ? next : null;
    if (this.guest) this.resultsNext = null;
  }

  // ------------------------------------------------------------------------------------- party play
  private online() {
    return !!(this.host || this.guest);
  }
  /** run by this browser: everything solo; online, my own bean (and on the host, the bots) */
  private isLocal(x: Contestant) {
    if (this.host) return x.owner === 'host';
    if (this.guest) return x.owner === this.guest.id;
    return true;
  }
  private roundKey() {
    return this.showNo * 100 + this.roundIdx;
  }
  private me(): Member {
    return { id: this.host ? 'host' : (this.guest?.id ?? ''), name: this.myName || this.anon, outfit: OUTFITS[this.design] };
  }

  private hostParty() {
    this.sound.start();
    this.sound.click();
    this.leaveNet();
    const h = (this.host = new PartyHost());
    this.members = [this.me()];
    h.clock = () => this.course?.b.world.time ?? 0;
    this.showLobby();
    h.onOpen = () => this.showLobby();
    h.onError = (e) => {
      if (e === 'taken') {
        // (someone has that code: another)
        this.leaveNet();
        this.hostParty();
        return;
      }
      if (this.host === h) this.leaveParty(`Couldn't open a party (${e}). Check your connection.`);
    };
    h.onCtl = (from, m) => this.hostCtl(from, m);
    h.onState = (from, buf) => this.applyStates(buf, from);
    h.onLeave = (id) => {
      const gone = this.members.find((x) => x.id === id);
      this.members = this.members.filter((x) => x.id !== id);
      if (gone) this.ui.note(`${gone.name} left the party`);
      this.hostMembers();
      // (their bean drops out of the show)
      for (const x of this.roster) if (x.owner === id) x.out = true;
      for (const r of this.racers)
        if (r.c.owner === id && !r.out) {
          r.out = true;
          r.m.active = false;
          this.host?.broadcast({ t: 'out', id: r.c.id });
        }
    };
  }

  private hostMembers() {
    this.host?.broadcast({ t: 'members', members: this.members, inShow: this.state !== 'menu' });
    if (this.state === 'menu') this.showLobby();
  }

  private hostCtl(from: string, m: CtlMsg) {
    const h = this.host!;
    const r = 'id' in m && typeof m.id === 'number' ? this.racers.find((x) => x.c.id === m.id) : undefined;
    switch (m.t) {
      case 'hello': {
        if (this.members.length >= MAX_PLAYERS) return h.kick(from, 'That party is full.');
        this.members = this.members.filter((x) => x.id !== from);
        this.members.push({ id: from, name: String(m.name || 'Bean').slice(0, 14), outfit: m.outfit });
        h.send(from, { t: 'welcome', id: from, members: this.members, inShow: this.state !== 'menu' });
        this.ui.note(`${String(m.name || 'Bean').slice(0, 14)} joined the party`);
        this.sound.notes([72, 76], 0.08, 0.25, true);
        this.hostMembers();
        break;
      }
      case 'loaded':
        this.loadedBy.add(from);
        break;
      case 'fin':
        if (r && r.c.owner === from) this.finish(r);
        break;
      case 'out':
        if (r && r.c.owner === from && this.state === 'play') this.eliminate(r);
        break;
      case 'shove':
        if (!r) return;
        if (r.local) this.applyShove(r, m.kind, m.v);
        else h.send(r.c.owner, m);
        break;
    }
  }

  private joinParty(code: string) {
    this.sound.start();
    this.sound.click();
    this.leaveNet();
    const g = (this.guest = new PartyGuest(code, { name: this.myName || this.anon, outfit: OUTFITS[this.design] }));
    this.members = [];
    this.ui.hideMenu();
    this.ui.lobby({ code, host: false, members: [], max: MAX_PLAYERS, status: 'Joining…', onStart: () => undefined, onLeave: () => this.leaveParty() });
    g.onClose = (why) => {
      if (this.guest === g) this.leaveParty(why);
    };
    g.onCtl = (m) => void this.guestCtl(m);
    g.onState = (buf) => this.applyStates(buf, 'host');
  }

  private pendingGo = NaN;
  private async guestCtl(m: CtlMsg) {
    const g = this.guest!;
    const r = 'id' in m && typeof m.id === 'number' ? this.racers.find((x) => x.c.id === m.id) : undefined;
    switch (m.t) {
      case 'welcome':
      case 'members':
        this.members = m.members;
        if (this.state === 'menu') this.showLobby(m.inShow ? 'A show is on: you are in the next one' : undefined);
        break;
      case 'show':
        this.roster = m.roster.map((x: NetContestant) => ({ ...x, style: x.style as StyleId, player: x.owner === g.id, out: false }));
        this.ui.hideLobby();
        this.ui.hideResults();
        this.ui.hideMenu();
        break;
      case 'round': {
        if (!this.roster.some((x) => x.player)) return;
        this.roundIdx = m.idx;
        this.slots = m.slots;
        this.showNo = Math.floor(m.key / 100);
        for (const x of this.roster) x.out = m.out.includes(x.id);
        this.pendingGo = NaN;
        this.worldOff = NaN;
        this.ui.hideResults();
        this.confetti.clear();
        await this.loadRound(m.idx, false, m.order);
        g.send({ t: 'loaded' });
        this.introCard();
        if (!Number.isNaN(this.pendingGo)) this.toCountdown(this.pendingGo);
        break;
      }
      case 'count':
        if (this.state === 'intro') this.toCountdown(m.go);
        else this.pendingGo = m.go;
        break;
      case 'fin':
        if (r && m.place && !r.fin) {
          r.fin = m.place;
          r.pend = false;
          this.finCount = Math.max(this.finCount, m.place);
          this.finished(r);
        }
        break;
      case 'out':
        if (r && !r.out) {
          r.out = true;
          if (r.local && !r.pend) this.fellOff(r);
        }
        break;
      case 'end':
        for (const [id, place] of m.fins) {
          const x = this.racers.find((y) => y.c.id === id);
          if (x && !x.fin) x.fin = place;
        }
        this.roundOver(new Set(m.through));
        break;
      case 'results':
      case 'champion':
        if (this.state === 'over' || this.state === 'play') this.toResults();
        break;
      case 'shove':
        if (r?.local) this.applyShove(r, m.kind, m.v);
        break;
      case 'lobby':
        this.toMenu();
        this.showLobby();
        break;
    }
  }

  private showLobby(status?: string) {
    const code = this.host ? (this.host.peer.open ? this.host.code : '') : (this.guest?.code ?? '');
    this.ui.hideMenu();
    this.ui.lobby({
      code,
      host: !!this.host,
      members: this.members.map((x) => ({ name: x.name, color: x.outfit.a, me: x.id === (this.host ? 'host' : this.guest?.id), host: x.id === 'host' })),
      max: MAX_PLAYERS,
      status: this.host && !code ? 'Opening the party…' : status,
      onStart: () => this.startShow(),
      onLeave: () => this.leaveParty(),
    });
  }

  /** (the host) a new show for everyone in the party, bots making up the 24 */
  private startShow() {
    if (!this.host) return;
    this.sound.start();
    this.sound.click();
    this.ui.hideLobby();
    this.ui.hideMenu();
    this.ui.hideResults();
    const names = [...NAMES].sort(() => Math.random() - 0.5);
    this.roster = this.members.map((x, k) => ({ id: k, name: x.name, outfit: x.outfit, skill: 1, style: 'racer' as StyleId, player: x.id === 'host', out: false, owner: x.id, human: true }));
    for (let k = this.roster.length; k < FIELD; k++) {
      const { skill, style } = roll(this.level, Math.random);
      this.roster.push({ id: k, name: names[k % names.length], outfit: randomOutfit(Math.random), skill, style, player: false, out: false, owner: 'host', human: false });
    }
    this.showNo++;
    this.host.broadcast({ t: 'show', roster: this.roster.map(({ id, name, outfit, skill, style, owner, human }) => ({ id, name, outfit, skill, style, owner, human })) });
    this.roundIdx = 0;
    void this.startRound();
  }

  /** (the host) everyone back to the lobby */
  private toLobby() {
    this.host?.broadcast({ t: 'lobby' });
    this.toMenu();
    this.showLobby();
  }

  private leaveNet() {
    this.host?.close();
    this.guest?.close();
    this.host = null;
    this.guest = null;
    this.members = [];
    this.worldOff = NaN;
  }

  private leaveParty(why = '') {
    const g = this.guest;
    this.guest = null;
    g?.close();
    this.leaveNet();
    this.toMenu();
    if (why) this.ui.note(why, 5000);
  }

  /** online, before the world steps: the guest's clock kept on the host's, the remote beans eased to where they are */
  private netBefore(dt: number) {
    const w = this.course!.b.world;
    const now = performance.now() / 1000;
    if (this.guest && !Number.isNaN(this.worldOff)) {
      const err = now + this.worldOff - w.time;
      if (Math.abs(err) > 0.4) {
        // (a jump: the obstacles go straight there, no sweep through the gap)
        w.time += err;
        for (const k of w.kins) {
          k.set(w.time);
          k.prev.copy(k.m);
        }
      } else dt = Math.max(0, dt + THREE.MathUtils.clamp(err * 0.3, -0.008, 0.008));
    }
    const k = 1 - Math.exp(-dt * 14);
    for (const r of this.racers) {
      if (r.local) continue;
      const m = r.m;
      const age = Math.min(0.25, now - r.netT);
      PT.copy(r.netPos).addScaledVector(m.vel, age);
      if (m.pos.distanceToSquared(PT) > 25) m.pos.copy(PT);
      else m.pos.lerp(PT, k);
    }
    return dt;
  }

  /** online, after the step: events, shoves to pass on, and 30 states a second out */
  private netAfter(dt: number) {
    const w = this.course!.b.world;
    for (const r of this.racers) {
      const m = r.m;
      if (r.local) r.ev |= (m.hopped ? F.HOP : 0) | (m.dashed ? F.DIVE : 0) | (m.knocked ? F.KNOCK : 0) | (m.grabbed ? F.GRAB : 0);
      else {
        m.hopped = !!(r.netEv & F.HOP);
        m.dashed = !!(r.netEv & F.DIVE);
        m.knocked = !!(r.netEv & F.KNOCK);
        m.grabbed = !!(r.netEv & F.GRAB);
        r.netEv = 0;
      }
    }
    const now = performance.now() / 1000;
    for (const sh of w.shoves) {
      const key = `${sh.target.id}:${sh.kind}`;
      if (now - (this.shoveT.get(key) ?? -9) < (sh.kind === 'knock' ? 0.4 : 0.12)) continue;
      this.shoveT.set(key, now);
      const msg: CtlMsg = { t: 'shove', id: sh.target.id, kind: sh.kind, v: [sh.vx, sh.vy, sh.vz] };
      if (this.guest) this.guest.send(msg);
      else {
        const r = this.racers.find((x) => x.m === sh.target);
        if (r && r.c.owner !== 'host') this.host?.send(r.c.owner, msg);
      }
    }
    this.sendAcc += dt;
    if (this.sendAcc < 1 / 30) return;
    this.sendAcc = 0;
    const list = this.host ? this.racers : this.racers.filter((r) => r.local);
    const buf = new Float32Array(4 + list.length * STRIDE);
    buf[0] = this.host ? 2 : 1;
    buf[1] = this.roundKey();
    buf[2] = w.time;
    buf[3] = list.length;
    list.forEach((r, k) => {
      const m = r.m, o = 4 + k * STRIDE;
      const flags = m.mode | (m.groundT < 0.12 ? F.GROUND : 0) | (m.holding ? F.HOLD : 0) | (m.heldT > 0 ? F.HELD : 0) | (r.fell ? F.FELL : 0) | (r.local ? r.ev : r.ev);
      buf.set([r.c.id, m.pos.x, m.pos.y, m.pos.z, m.vel.x, m.vel.y, m.vel.z, m.yaw, flags, m.quat.x, m.quat.y, m.quat.z, m.quat.w, r.s], o);
      r.ev = 0;
    });
    if (this.host) this.host.states(buf);
    else this.guest?.state(buf);
  }

  /** bean states in: the remote ones are moved; a guest's clock is set by the host's */
  private applyStates(buf: Float32Array, from: string) {
    if (buf.length < 4 || buf[1] !== this.roundKey() || !this.course) return;
    const now = performance.now() / 1000;
    if (this.guest && buf[0] === 2) {
      const est = buf[2] + this.guest.rtt / 2 - now;
      this.worldOff = Number.isNaN(this.worldOff) || Math.abs(est - this.worldOff) > 0.25 ? est : this.worldOff + (est - this.worldOff) * 0.05;
    }
    const n = Math.min(buf[3], Math.floor((buf.length - 4) / STRIDE));
    for (let k = 0; k < n; k++) {
      const o = 4 + k * STRIDE;
      const r = this.racers.find((x) => x.c.id === buf[o]);
      if (!r || r.local || (this.host && r.c.owner !== from)) continue;
      const m = r.m;
      const f = buf[o + 8];
      r.netPos.set(buf[o + 1], buf[o + 2], buf[o + 3]);
      m.vel.set(buf[o + 4], buf[o + 5], buf[o + 6]);
      m.yaw = buf[o + 7];
      m.mode = f & 3;
      m.groundT = f & F.GROUND ? 0 : 1;
      m.holding = f & F.HOLD ? m : null;
      m.heldT = f & F.HELD ? 0.3 : 0;
      m.quat.set(buf[o + 9], buf[o + 10], buf[o + 11], buf[o + 12]);
      if (this.course.path) r.s = buf[o + 13];
      r.netEv |= f & (F.HOP | F.DIVE | F.KNOCK | F.GRAB);
      // (a host relays the guests' events on)
      if (this.host) r.ev |= f & (F.HOP | F.DIVE | F.KNOCK | F.GRAB);
      r.netT = now;
    }
  }

  /** someone else's bean did something to mine */
  private applyShove(r: Racer, kind: 'knock' | 'grab', v: [number, number, number]) {
    const m = r.m;
    if (!m.active || m.frozen) return;
    if (kind === 'knock') {
      m.vel.set(v[0], Math.max(m.vel.y, v[1]), v[2]);
      m.knock(0.8);
    } else {
      m.heldT = Math.max(m.heldT, 0.3);
      m.vel.x += v[0] * 0.3;
      m.vel.z += v[2] * 0.3;
    }
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
    // footfalls and voices
    for (const r of this.racers) {
      const m = r.m;
      if (!m.active || !r.rig.root.visible) continue;
      const mine = r === p;
      const near = mine || m.pos.distanceToSquared(this.camera.position) < 40 * 40;
      if (!near) continue;
      if (r.rig.step) s.step(m.pos.x, m.pos.y, m.pos.z, mine, m.groundMat);
      // (not every jump: a bean that shouts every hop is tiring)
      if (m.hopped && Math.random() < (mine ? 0.55 : 0.25)) s.voice('hup', m.id, m.pos.x, m.pos.y, m.pos.z, mine);
      if (m.dashed) s.voice('hyah', m.id, m.pos.x, m.pos.y, m.pos.z, mine);
      if (m.knocked) s.voice('oof', m.id, m.pos.x, m.pos.y, m.pos.z, mine);
      if (m.grabbed) s.voice('heh', m.id, m.pos.x, m.pos.y, m.pos.z, mine);
    }
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
      const root = r.rig.root;
      root.visible = (r.m.active || r.m.pos.y > this.course!.lakeY) && r.m.pos.y > this.course!.lakeY - 1;
      if (root.visible) r.rig.update(r.m, dt, t);
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
    this.stage.movers = this.racers.filter((r) => r.rig.root.visible).map((r) => r.rig.core);
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
    const dist = c.plate ? 8.6 : 5.5 + Math.min(speed, 20) * 0.06;
    const hgt = c.plate ? 4.9 : 2.75 + Math.min(speed, 20) * 0.035;
    const tgt = m.pos.clone();
    if (f.fell) tgt.y = Math.max(tgt.y, c.lakeY + 6);
    const pos = new THREE.Vector3(tgt.x - Math.sin(yaw) * dist, tgt.y + hgt, tgt.z - Math.cos(yaw) * dist);
    const look = tgt.clone().add(new THREE.Vector3(Math.sin(yaw) * 2.2, 1.05, Math.cos(yaw) * 2.2));
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
    const fov = 60 + Math.min(10, Math.max(0, speed - 9) * 0.8);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }
  }

  private introCam() {
    const c = this.course!;
    const cam = this.camera;
    const t = Math.min(1, this.stateT / INTRO_T);
    if (c.plate) {
      const a = 0.6 + t * 2.4;
      const r = 32 - t * 10;
      cam.position.set(c.plate.center.x + Math.cos(a) * r, c.plate.center.y + 16 - t * 6, c.plate.center.z + Math.sin(a) * r);
      this.camLook.copy(c.plate.center);
      cam.lookAt(this.camLook);
      return;
    }
    const path = c.path!;
    // high over the opening of the course (the whole of it is too long to fly in the time)
    const e = t * t * (3 - 2 * t);
    const s = e * Math.min(path.length * 0.92, 640);
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
    win.rig.pose = 'win';
    win.m.yaw = Math.atan2(cam.position.x - tgt.x, cam.position.z - tgt.z);
    cam.position.lerp(new THREE.Vector3(tgt.x + Math.sin(a) * r, tgt.y + 1.5, tgt.z + Math.cos(a) * r), Math.min(1, dt * 3));
    this.camLook.lerp(tgt.clone().add(new THREE.Vector3(0, 0.75, 0)), Math.min(1, dt * 4));
    cam.lookAt(this.camLook);
    if (c.crown) {
      // (down onto the head, and it rides the head as the bean bounces)
      const h = Math.max(0, 2.5 - this.stateT * 1.5);
      win.rig.top.updateWorldMatrix(true, false);
      const top = new THREE.Vector3().setFromMatrixPosition(win.rig.top.matrixWorld);
      c.crown.position.lerp(top.add(new THREE.Vector3(0, 0.12 + h, 0)), Math.min(1, dt * (h > 0 ? 5 : 20)));
      c.crown.scale.setScalar(0.4);
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
    cam.position.copy(tgt).addScaledVector(dir, 4.4).add(new THREE.Vector3(0, 1.25, 0));
    const cr = new THREE.Vector3().subVectors(tgt, cam.position).cross(UP).normalize();
    this.camLook.copy(tgt).addScaledVector(cr, -1.3).add(new THREE.Vector3(0, 0.55, 0));
    cam.lookAt(this.camLook);
    // (your bean turned to the camera, swaying a little)
    p.m.yaw = Math.atan2(cam.position.x - tgt.x, cam.position.z - tgt.z) + Math.sin(this.stateT * 0.9) * 0.35;
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
      v.copy(r.m.pos).add(new THREE.Vector3(0, 1.4, 0)).project(cam);
      const dist = r.m.pos.distanceTo(cam.position);
      const show = !r.out && !r.fell && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (me || dist < 22) && r.m.active;
      this.ui.tag(r.c.id, me ? 'YOU' : r.c.name, ((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H, show || (r.c.human && !r.out && !r.fell && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && dist < 60), me, r.c.human && !me);
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
      timer = clock(SURVIVE_T - this.playT);
    } else if (race && this.state === 'play' && this.playT > RACE_T - 30) timer = clock(RACE_T - this.playT);
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
      dash: p ? 1 - p.m.dashCD / DASH_CD : 1,
      spectate: spectating,
      race,
      keys: this.roundIdx === 0 && this.playT < 12,
    });
    if (race && c.path) {
      const L = c.finishS;
      this.ui.progress(this.racers.map((r) => ({ id: r.c.id, f: r.fin ? 1 : r.s / L, color: r.c.outfit.a, me: r.c.player, out: r.out && !r.fin })));
    }
  }
}

function lerpAngle(a: number, b: number, k: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** the round clocks: a race's time limit, how long a survival round lasts, the intro flyover */
const RACE_T = 180;
const SURVIVE_T = 110;
const INTRO_T = 8;

function clock(sec: number) {
  const k = Math.max(0, Math.ceil(sec));
  return `${Math.floor(k / 60)}:${String(k % 60).padStart(2, '0')}`;
}

function readPref() {
  try {
    return localStorage.getItem('mm.level');
  } catch {
    return null;
  }
}
function writePref(id: string) {
  try {
    localStorage.setItem('mm.level', id);
  } catch {
    /* (private window: not remembered) */
  }
}

function hatName(o: Outfit) {
  const hats: Record<string, string> = { none: 'No hat', beanie: 'Bobble hat', party: 'Party hat', propeller: 'Propeller cap', bow: 'Big bow', horns: 'Little horns', antenna: 'Antennae', flower: 'Flower', tophat: 'Top hat', headphones: 'Headphones', sprout: 'Sprout', cap: 'Baseball cap' };
  return `${o.pat === 'solid' ? 'Plain' : o.pat[0].toUpperCase() + o.pat.slice(1)} · ${hats[o.hat]}`;
}

function readName() {
  try {
    return localStorage.getItem('mm.name') ?? '';
  } catch {
    return '';
  }
}
function writeName(n: string) {
  try {
    localStorage.setItem('mm.name', n);
  } catch {
    /* (not remembered) */
  }
}

function readOutfit() {
  try {
    const n = Number(localStorage.getItem('mm.outfit'));
    return Number.isInteger(n) && n >= 0 && n < OUTFITS.length ? n : 0;
  } catch {
    return 0;
  }
}
function writeOutfit(n: number) {
  try {
    localStorage.setItem('mm.outfit', String(n));
  } catch {
    /* (not remembered) */
  }
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
