import * as THREE from 'three';
import { Bot } from './ai.ts';
import { courseAI } from './ai-course.ts';
import { level, LEVELS, roll, STYLES, type Level, type StyleId } from './ai-style.ts';
import { Sound } from './audio.ts';
import { biome, type Biome } from './biome.ts';
import { buildRound, dealShow, modeName, setShow, DEFAULT_SHOW, POOL, ROUNDS, SHOW, type Course, type RoundId } from './courses.ts';
import { TeamPlay } from './team.ts';
import { CupPlay, type CupEvent } from './soccer.ts';
import { CUP, CUP_COLORS, CUP_NAMES } from './course-soccer.ts';
import { TEAM_T as TEAM_ROUND_T } from './course-paintparty.ts';
import { CALL, shownColour } from './course-modes.ts';
import { BOUNCE, Pop } from './course-bounce.ts';
import { KEEP, KEEP_PHASES } from './course-crown.ts';
import { SPRING } from './course-crumble.ts';
import { STORM } from './course-storm.ts';
import { PAINT_FRENZY } from './team.ts';
import { BouncePlay, KeepPlay } from './modes.ts';
import { RocketPlay } from './modes-play.ts';
import { BumpPlay } from './modes-bash.ts';
import { KartPlay } from './modes-kart.ts';
import { RACE } from './kart-race.ts';
import { CAR } from './course-bumper.ts';
import { ROCKET } from './course-rocket.ts';
import { Fireworks } from './fx.ts';
import { Stars } from './stars.ts';
import { BeanRig, OUTFITS, randomOutfit, type Outfit } from './bean.ts';
import { Confetti, Puffs, Splashes, Rings } from './fx.ts';
import { BUMP, DASH_CD, GRAVITY, Marble, Mat, Mode } from './physics.ts';
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
  private teamPlay: TeamPlay | null = null;
  private puffs = new Puffs();
  /** test links: no round wheel */
  private quick = false;
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
  /** the camera's tilt (mouse or right stick): up looks down from higher */
  private pitchOff = 0;
  /** the player has taken the camera: it stays where they put it */
  private manualCam = false;
  private dragging = false;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private spectate = 0;
  private confetti = new Confetti();
  private fireworks = new Fireworks();
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
  private tilesAcc = 0;
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
    this.scene.add(this.confetti.mesh, this.splashes.group, this.puffs.group, this.rings.group, this.fireworks.points);
    this.fireworks.onBurst = (x, y, z) => this.sound.boom(x, y, z);
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
      this.quick = true;
      this.newShow();
      setShow(DEFAULT_SHOW);
      this.roundIdx = Number(q.get('round'));
      for (const x of this.roster) x.out = x.id >= FIELD - Number(q.get('cut') ?? 0);
      await this.startRound();
      if (q.get('go') === '1') this.toCountdown();
    } else {
      this.toMenu();
      // an invite link: straight into the friend's party
      const j = q.get('join');
      if (j && /^[a-z0-9]{4}$/i.test(j)) this.joinParty(j.toUpperCase());
    }
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
      if (this.state === 'intro') this.pressed.add('Space');
      // the mouse steers the camera (the pointer is locked to the game while you play; ESC lets it go)
      if (e.pointerType === 'mouse' && this.state !== 'menu' && !this.paused && !document.pointerLockElement) {
        const r = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
        r?.catch?.(() => undefined);
        return;
      }
      // (locked: the buttons jump and dive, see below; the mouse already turns the camera)
      if (document.pointerLockElement === this.canvas) return;
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
    });
    // with the pointer locked: left button jumps, right button dives (every press, even with the
    // other held down, so these are mousedowns rather than pointerdowns)
    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      if (e.button === 0) {
        this.pressed.add('MouseLeft');
        this.keys.add('MouseLeft');
      }
      else if (e.button === 2) this.pressed.add('MouseRight');
      else if (e.button === 1) this.keys.add('MouseMiddle');
      e.preventDefault();
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 1) this.keys.delete('MouseMiddle');
      if (e.button === 0) this.keys.delete('MouseLeft');
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas) this.keys.delete('MouseMiddle');
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragging && e.pointerType === 'mouse') this.yawOff -= e.movementX * 0.006;
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.manualCam = true;
      this.yawOff -= e.movementX * 0.0032;
      this.pitchOff = THREE.MathUtils.clamp(this.pitchOff + e.movementY * 0.0026, -0.55, 0.9);
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
    if (this.paused && document.pointerLockElement) document.exitPointerLock();
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
      return { x, y, jump: !!p.buttons[0]?.pressed, dash: !!(p.buttons[2]?.pressed || p.buttons[1]?.pressed), grab: !!(p.buttons[7]?.pressed || p.buttons[5]?.pressed || p.buttons[3]?.pressed), cam: Math.abs(p.axes[2] ?? 0) > 0.2 ? p.axes[2] : 0, tilt: Math.abs(p.axes[3] ?? 0) > 0.2 ? p.axes[3] : 0 };
    }
    return null;
  }
  private padJump = false;
  private padDash = false;

  // ------------------------------------------------------------------------------------- the show
  private toMenu() {
    if (document.pointerLockElement) document.exitPointerLock();
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
    if (!this.course || this.course.id !== 'hopscotch' || this.racers.length === 0 || this.menuMarbles.length === 0) void this.loadRound(0, true);
    this.readyNextShow();
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
    // (solo, every show gets its own seed; online the host's startShow counts them)
    this.showNo = 1 + Math.floor(Math.random() * 9000);
    this.bonks = 0;
    this.kos = 0;
    this.starCount = 0;
    this.deal();
    void this.startRound();
  }

  /** the show's running order: the one already dealt behind the menu, or a new one */
  private deal() {
    if (this.dealt) this.dealt = false;
    else dealShow();
    // (test hook: ?lineup=pinball,bouncehouse plays those, in that order)
    const q = new URLSearchParams(location.search).get('lineup');
    if (q) setShow(q.split(',') as RoundId[]);
  }
  private dealt = false;

  /**
   * A round built before it's needed: while the results are up (or behind the menu) the next
   * course, its bot paths and its shaders are made, so the wheel has nothing left to wait for.
   */
  private buildAhead(id: RoundId) {
    if (this.ahead?.id === id) return;
    this.dropAhead();
    const c = buildRound(id);
    if (c.path) courseAI(c);
    this.ahead = { id, c, world: biome() };
    void this.renderer.compileAsync(c.b.group, this.camera, this.scene).catch(() => undefined);
  }
  private dropAhead() {
    if (this.ahead) disposeGroup(this.ahead.c.b.group);
    this.ahead = null;
  }
  private bounce: BouncePlay | null = null;
  private bumpWarned = -1;
  private popT = 0;
  private bellTick = 0;
  private syncT = 0;
  private bangAt = new THREE.Vector3();
  private bumpP: BumpPlay | null = null;
  private kartP: KartPlay | null = null;
  private rocketP: RocketPlay | null = null;
  private cupP: CupPlay | null = null;
  private cupSent = 0;
  private cupOT = false;
  private cupTwo = false;
  /** the points game's book */
  private get book() {
    return this.bumpP;
  }
  private padsGone = 0;
  private bounceSuper = 0;
  private starN = 0;
  private keepP: KeepPlay | null = null;
  private starsP: Stars | null = null;
  /** stars this show, and bowled-off beans */
  private starCount = 0;
  private kos = 0;
  private lastLeft = Infinity;
  private climbCalled = false;
  /** the view's kick on a big moment (degrees, decays) */
  private fovKick = 0;
  /** beans you've bowled over this show */
  private bonks = 0;
  private keepSent = 0;
  private callI = -1;
  private ahead: { id: RoundId; c: Course; world: Biome } | null = null;
  /** when the browser has a quiet moment */
  private idle(f: () => void) {
    const w = window as Window & { requestIdleCallback?: (f: () => void, o: { timeout: number }) => void };
    if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 900 });
    else window.setTimeout(f, 200);
  }
  /** the next show dealt and its first round built while you look at the menu */
  private readyNextShow() {
    if (this.quick) return;
    this.idle(() => {
      if ((this.state !== 'menu' && this.state !== 'champion') || this.guest) return;
      if (!this.dealt) {
        dealShow();
        this.dealt = true;
      }
      this.buildAhead(SHOW[0].id);
    });
  }

  private async startRound() {
    const alive = this.roster.filter((x) => !x.out).length;
    const info = SHOW[this.roundIdx];
    this.slots = info.kind === 'final' ? 1 : info.id === 'beancup' ? Math.ceil(alive / 2) : info.kind === 'team' ? alive - Math.floor(alive / (alive >= 9 ? 3 : 2)) : Math.max(2, (info.kind === 'survival' ? Math.ceil : Math.round)(alive * info.keep));
    // (online: everyone builds the same round, with the field in the same places)
    const order = this.roster.filter((x) => !x.out).map((x) => x.id).sort(() => Math.random() - 0.5);
    this.loadedBy.clear();
    this.host?.broadcast({ t: 'round', idx: this.roundIdx, order, slots: this.slots, out: this.roster.filter((x) => x.out).map((x) => x.id), key: this.roundKey(), lineup: SHOW.map((x) => x.id) });
    // the wheel spins while the course goes in
    const wheel = this.ui.reveal(POOL.map((id) => ROUNDS[id]), SHOW[this.roundIdx], this.roundIdx + 1, SHOW.length, this.quick);
    await Promise.all([wheel, this.loadRound(this.roundIdx, false, order)]);
    this.introCard();
  }

  /** the round's card over the flyover */
  private introCard() {
    const c = this.course!;
    const alive = this.roster.filter((x) => !x.out).length;
    const info = SHOW[this.roundIdx];
    const goal = c.keep ? `Hold the crown for ${KEEP.hold} seconds to win the show` : c.kind === 'final' ? 'First across the line wins the crown' : c.kind === 'survival' ? `Last ${this.slots} standing go through` : c.cup ? 'The team with the most goals stays in the show' : c.kind === 'team' ? `${c.team!.teams} teams. The team with the least floor goes home` : c.bump ? `The top ${this.slots} on points go through` : c.kind === 'score' ? `The top ${this.slots} poppers go through` : `First ${this.slots} of ${alive} qualify`;
    this.ui.card({ n: this.roundIdx + 1, total: SHOW.length, name: info.name, kind: modeName(info.id), goal, blurb: info.blurb, team: this.teamPlay?.mine() ?? this.cupP?.mine() ?? undefined });
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
    this.teamPlay?.dispose();
    this.teamPlay = null;
    this.bounce?.dispose();
    this.bounce = null;
    this.bumpP?.dispose();
    this.bumpP = null;
    this.kartP?.dispose();
    this.kartP = null;
    this.ui.meter(null);
    this.bumpWarned = -1;
    this.rocketP?.dispose();
    this.rocketP = null;
    this.cupP?.dispose();
    this.cupP = null;
    this.cupOT = this.cupTwo = false;
    this.padsGone = 0;
    this.starN = 0;
    this.bounceSuper = 0;
    this.keepP?.dispose();
    this.keepP = null;
    this.keepPhase = 0;
    this.ui.arrow(null);
    this.fireworks.clear();
    this.starsP?.dispose();
    this.starsP = null;
    this.ui.stars(null);
    this.callI = -1;
    this.swapI = -1;
    this.waveN = -1;
    this.dropI = -1;
    this.tickN = 0;
    this.tickAt = 0;
    this.frenzy = false;
    this.ui.fuse(null);
    this.ui.meter(null);
    this.ui.call(null);
    // (the menu stands on the first platform course; a round may be built already)
    const id: RoundId = menu ? 'hopscotch' : SHOW[idx].id;
    const done = !menu && this.ahead?.id === id ? this.ahead : null;
    if (done) this.ahead = null;
    const c = (this.course = done ? done.c : buildRound(id));
    if (!done && c.path) courseAI(c);
    this.scene.add(c.b.group);
    this.splashes.y = c.lakeY;
    const ctr = c.path ? c.path.P[Math.floor(c.path.count / 2)] : c.kart ? c.kart.center : c.plate!.center;
    // (its world: buildRound chose it)
    this.stage.setBiome(done ? done.world : biome());
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
      m.kart = !!c.kart;
      c.b.world.marbles.push(m);
      const rig = new BeanRig(x.outfit);
      this.scene.add(rig.root);
      const wantBot = menu ? !x.player : local && (x.player ? this.autopilot : !x.human);
      const bot = !wantBot ? null : new Bot(m, x.player ? Number(new URLSearchParams(location.search).get('me') ?? 0.9) : x.skill, x.id * 31 + idx * 7, STYLES[x.style], x.player || menu ? 0 : this.level.boost);
      const hint = c.path ? c.path.projectAll(m.pos).i : 0;
      bot?.reset(hint);
      const r: Racer = { c: x, m, rig, bot, hint, s: 0, cp: c.checkpoints[0] ?? 0, fin: 0, out: false, fell: 0, hold: 0, local, netPos: m.pos.clone(), netT: performance.now() / 1000, netEv: 0, ev: 0, pend: false };
      this.racers.push(r);
      if (menu && x.player) this.preview = r;
      if (c.team && !menu) c.team.of.set(x.id, order[k] % c.team.teams);
      if (c.cup && !menu) c.cup.of.set(x.id, order[k] % 2);
      if (menu) this.menuMarbles.push(r);
    });
    if (c.team && !menu) this.teamPlay = new TeamPlay(c, this.scene, () => this.racers, this.sound);
    if (c.cup && !menu) this.cupP = new CupPlay(c, this.scene, () => this.racers);
    if (c.path && !menu) this.starsP = new Stars(c, this.scene);
    this.lastLeft = Infinity;
    this.climbCalled = false;
    if (c.keep && !menu) this.keepP = new KeepPlay(c, this.scene, () => this.racers);
    // (a new order of calls every time, the same in every browser)
    c.call?.deal(this.roundKey());
    if (c.bounce) {
      this.bounce = new BouncePlay(c, this.scene, () => this.racers);
      for (const r of this.racers) if (r.bot) r.bot.bounce = this.bounce;
    }
    if (c.bump && !menu) this.bumpP = new BumpPlay(c, this.scene, () => this.racers);
    if (c.kart && !menu) {
      this.kartP = new KartPlay(c, this.scene, () => this.racers, this.ui, this.sound, order);
    }
    if (c.rocket && !menu) this.rocketP = new RocketPlay(c, this.scene, () => this.racers);
    this.finCount = 0;
    this.wrapAt = 0;
    this.lavaWarned = false;
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
    if (!done) await this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
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
    if (this.bounce) return this.bounce.ranking() as Racer[];
    if (this.book) return this.book.ranking() as Racer[];
    if (this.keepP) return this.keepP.ranking() as Racer[];
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
          if ((this.stateT > INTRO_T || (skip && this.stateT > 0.5)) && (all || this.stateT > 10)) this.toCountdown();
        } else if (this.stateT > INTRO_T || (skip && this.stateT > 0.25)) this.toCountdown();
        break;
      }
      case 'countdown': {
        const n = Math.ceil((this.goAt - c.b.world.time) / COUNT_T);
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
        this.feedback();
        this.noWaiting();
        if (this.state === 'over' && this.stateT > (c.kind === 'final' ? 3.6 : OVER_T) && !this.guest) this.toResults();
        break;
      case 'results':
      case 'champion':
        if (this.resultsNext) {
          // (space or enter: on with it)
          if (this.pressed.has('Space') || this.pressed.has('Enter')) this.resultsT = 0;
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
    this.botEase();
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
    this.kartP?.step(dt, w.time, c.state.go);
    c.b.sync(w.time);
    if (net) this.netAfter(dt);
    this.sounds(dt);
    this.visuals(dt, now / 1000);
    this.cameraUpdate(dt);
    this.hud();
    this.pressed.clear();
  }
  private lastCount = 0;

  /**
   * Bots hold back for the people in the round, by the difficulty. In a race, one that's got away
   * from the leading person eases off (it comes back to you; on Insane it never does); in the
   * arenas it's a touch slower and slower to react all round.
   */
  private botEase() {
    const c = this.course!;
    const k = this.level.ease;
    let best = -Infinity, any = false;
    for (const r of this.racers)
      if (r.c.human && !r.out) {
        any = true;
        if (!r.fin && r.s > best) best = r.s;
      }
    for (const r of this.racers) {
      if (!r.bot || r.c.human) continue;
      if (!any) r.bot.ease = 0;
      // (not with the lava behind them: holding back there would only feed them to it)
      else if (c.kart) r.bot.ease = k * THREE.MathUtils.clamp((r.s - best - 15) / 130, 0, 1);
      else if (c.path) r.bot.ease = c.lava ? 0 : k * THREE.MathUtils.clamp((r.s - best - 3) / 22, 0, 1) * (c.kind === 'final' ? 1.25 : 1);
      else r.bot.ease = k;
    }
  }

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
    if (pad?.cam) (this.yawOff -= pad.cam * 0.045), (this.manualCam = true);
    if (pad?.tilt) this.pitchOff = THREE.MathUtils.clamp(this.pitchOff + pad.tilt * 0.025, -0.55, 0.9);
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
    if (this.course?.kart) {
      // (a kart has a wheel and pedals: left and right steer, up and down are the pedals. On a touch
      // screen the pedal is down unless you pull back, so one thumb can drive)
      const touch = !!(t && (t.x || t.y));
      p.m.input.set(fx, 0, touch && fy > -0.4 ? 1 : fy);
      p.m.jet = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('MouseLeft') || k.has('ControlLeft') || !!t?.hold || !!pad?.jump || !!pad?.dash;
      return;
    }
    const yaw = this.camYaw + this.yawOff;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3().crossVectors(fwd, UP);
    const inp = p.m.input.set(0, 0, 0).addScaledVector(fwd, fy).addScaledVector(right, fx);
    if (inp.lengthSq() > 1) inp.normalize();
    const live = this.state === 'play' || this.state === 'over';
    let jump = this.pressed.has('Space') || this.pressed.has('MouseLeft') || !!t?.jump;
    // (the party-game layout: right mouse button or Ctrl dives, Shift grabs while held; C, E and
    // the middle mouse button work too)
    let dash = this.pressed.has('MouseRight') || this.pressed.has('ControlLeft') || this.pressed.has('ControlRight') || this.pressed.has('KeyC') || !!t?.dash;
    let grab = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyE') || k.has('MouseMiddle') || !!t?.grab;
    if (pad) {
      if (pad.jump && !this.padJump) jump = true;
      if (pad.dash && !this.padDash) dash = true;
      this.padJump = pad.jump;
      this.padDash = pad.dash;
      grab ||= pad.grab;
    }
    if (t) t.jump = t.dash = false;
    if (live && jump) p.m.jump = true;
    // (the jump button, held: the jetpacks)
    p.m.jet = live && (k.has('Space') || k.has('MouseLeft') || !!t?.hold || !!pad?.jump);
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
    this.goAt = goAt ?? c.b.world.time + 3 * COUNT_T;
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
    } else if (p && c.kart) {
      this.camYaw = p.m.yaw;
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
    if (c.kart) {
      // (the gantry lets go a shower of paper, and the stands go up)
      this.confetti.burst(c.kart.track.point(RACE.start, 0, 7, new THREE.Vector3()), 200, 9);
      this.sound.cheer(0.7);
    }
  }

  /** the round's rules: progress, falls and respawns, the line, eliminations (each browser for its own beans) */
  private rules(dt: number) {
    const c = this.course!;
    const w = c.b.world;
    if (c.team && this.teamPlay) {
      if (this.state === 'play') {
        if (!this.teamPlay.frenzy && this.playT > TEAM_T - PAINT_FRENZY) {
          this.teamPlay.frenzy = true;
          this.ui.banner('PAINT FRENZY!', 'gold', 'Every bomb splats bigger', 1500);
          this.sound.notes([72, 76, 79, 84, 88], 0.07, 0.45, true);
        }
        this.teamPlay.paint();
        // the paint bombs: solo or the host decides who set one off, and tells the guests
        for (const e of this.teamPlay.bombsUpdate(w.time, c.state.go, this.roundKey(), !this.guest)) {
          this.host?.broadcast({ t: 'splat', k: e.k, id: e.id });
          this.bombFx();
        }
      }
      for (const r of this.racers) {
        if (!r.local) continue;
        if (!r.fell && r.m.pos.y < c.killY) {
          r.fell = w.time;
          this.drop(r);
          this.sound.voice('wah', r.m.id, r.m.pos.x, r.m.pos.y, r.m.pos.z, r.c.player);
        } else if (r.fell && w.time - r.fell > 1.4) {
          r.fell = 0;
          this.teamPlay.respawn(r.m);
          r.bot?.reset(0);
        }
      }
      if (!this.guest && this.state === 'play' && this.playT > TEAM_T) this.endRound();
      return;
    }
    if (c.cup && this.cupP) {
      this.cupRules(dt);
      return;
    }
    if (c.bounce && this.bounce) {
      this.bounceRules(dt);
      return;
    }
    if (c.bump && this.bumpP) {
      this.bumpRules();
      return;
    }
    if (c.kart && this.kartP) {
      this.kartRules();
      return;
    }
    if (c.keep && this.keepP) {
      this.keepRules(dt);
      return;
    }
    if (c.plate) {
      if (this.state === 'play') this.partyRules();
      // Storm Deck: a crack and a boom for every bolt (the blast itself is the course's field)
      if (c.storm && this.state === 'play') {
        const x = w.time - c.state.go;
        const wn = Math.floor((x - STORM.waveAt + 1.2) / STORM.waveEvery);
        if (wn >= 0 && wn > this.waveN) {
          this.waveN = wn;
          this.ui.note('BIG WAVE! Hop it!', 1500);
          this.sound.notes([55, 62, 67], 0.08, 0.35, true);
        }
        for (const s of c.storm.between(x - dt, x, this.strikes)) {
          const at = new THREE.Vector3(c.storm.center.x + s.x, c.storm.center.y, c.storm.center.z + s.z);
          this.sound.boom(at.x, at.y, at.z);
          this.puffs.dust(at, s.r > 3 ? 18 : 10, 0.3, s.r);
          const me = this.racers.find((r) => r.c.player);
          if (me && me.m.pos.distanceTo(at) < s.r + 0.4 && !me.out) this.ui.note('ZAP!', 700);
        }
      }
      // Cookie Crumble: a tile someone stands on starts to go (solo or the host: anyone's feet, as
      // seen here, and it tells the guests when each drops; a guest: its own, until the host says)
      if (c.crumble && (this.state === 'play' || this.state === 'over')) {
        const A = c.crumble;
        if (A.mode === 'melt') A.meltTick(w.time, c.state.go);
        else
          for (const r of this.racers) {
            if (r.out || (this.guest && !r.local) || (r.local && r.m.groundT > 0.12)) continue;
            const under = A.under(r.m.pos);
            // (a spring cookie: back up to the floor above, if there's a hole to go through)
            if (r.local && A.springs.has(under) && r.m.vel.y < 4) {
              r.m.vel.y = SPRING.up;
              r.m.groundT = 1;
              if (r.c.player) {
                this.ui.pop('BOING!', true);
                this.sound.notes([67, 74, 79, 86], 0.04, 0.35, true);
              }
              continue;
            }
            A.touch(under, w.time);
          }
        const fresh = A.fresh();
        if (this.host && fresh.length) this.host.broadcast({ t: 'crumble', k: fresh, at: fresh.map((i) => A.drop[i]) });
      }
      for (const r of this.racers) {
        // (once it's over, who went through is settled)
        if (this.state === 'over') break;
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
        // (a whole level of beans can go in one tick: the round stops at the last place, not past it)
        if (this.racers.filter((x) => !x.out).length <= this.slots) break;
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
      // Lava Rush: under the lava, or left behind its front, and out (a fall is into the lava too)
      if (c.lava && this.state === 'play' && !r.fin && !r.pend && !r.fell && r.s < c.lava.s(w.time) - 2) {
        this.lavaOut(r);
        continue;
      }
      // falling: into the paint (a splash), then back at the last checkpoint
      if (r.fell) {
        if (w.time - r.fell > 1.1 && !r.fin) {
          // (Lava Rush: back to the checkpoint only if the lava hasn't got there)
          if (c.lava && this.state === 'play' && r.cp < c.lava.s(w.time) + 4) {
            r.s = r.cp;
            this.lavaOut(r);
          } else this.respawn(r);
        }
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
      for (const cp of c.checkpoints)
        if (pr.s > cp + 1 && cp > r.cp && m.grounded && pr.d < 6) {
          if (r.c.player && r.cp > 0 && this.state === 'play') {
            this.ui.note('Checkpoint!', 1100);
            this.sound.notes([76, 81], 0.06, 0.18, true);
          }
          r.cp = cp;
        }
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
    if (c.lava && this.state === 'play') {
      if (!this.lavaWarned && w.time > c.state.go + 6.2) {
        this.lavaWarned = true;
        this.ui.banner('THE LAVA IS RISING!', 'bad', 'Climb! Fall in and you are out', 1800);
      }
      // (everyone through or melted: done)
      if (!this.guest && this.racers.every((x) => x.fin || x.out)) this.endRound();
    }
  }
  private fuelBeep = 0;
  private rocketAim = false;
  /** Colour Call's calls */
  private partyRules() {
    const c = this.course!;
    const w = c.b.world;
    const x = w.time - c.state.go;
    if (c.rocket && this.rocketP) {
      const A = c.rocket;
      const p = this.player();
      if (p && !p.out) {
        const f = (A.fuel.get(p.m.id) ?? ROCKET.fuel) / ROCKET.fuel;
        this.ui.fuse(f, f < 0.25 ? 0xff3020 : f < 0.5 ? 0xffa030 : 0x4af0ff);
        this.sound.jet(A.burning.has(p.m.id));
        // (nearly dry in the air: the alarm, and which way to go)
        const air = p.m.groundT > 0.1;
        if (f < 0.3 && air && w.time > this.fuelBeep) {
          this.fuelBeep = w.time + 0.32;
          this.sound.notes([88], 0, 0.22, true);
        }
        this.rocketAim = f < 0.45 && air;
        if (this.rocketP.refilled(p.m.id)) {
          this.ui.pop('FUEL!', true);
          this.sound.notes([79, 86], 0.04, 0.35, true);
          this.rings.ring(p.m.pos.clone(), 3, 0x4af0ff, 0.3);
        }
      }
      if (!p || p.out) this.sound.jet(false);
      if (x < 5) this.ui.call(x > 0.5 ? 'HOLD JUMP TO FLY' : null, 0xffb02f);
      else if (x < 5.2) this.ui.call(null);
      const going = A.pads.filter((q) => x > q.out - ROCKET.warn).length;
      if (going > this.padsGone) {
        this.padsGone = going;
        this.ui.note(`A PAD IS GOING! ${A.pads.length - going} LEFT`, 1400);
        this.sound.notes([60, 55], 0.08, 0.35, true);
      }
    }
    if (c.call) {
      const call = c.call.at(x);
      if (call.i !== this.callI && x >= call.t0) {
        this.callI = call.i;
        this.sound.notes([72 + (call.i % 5) * 2, 79], 0.08, 0.4, true);
      }
      // (the call stays up, out of the way, until the floor has gone)
      const on = x >= call.t0 && x < call.drop;
      const col = shownColour(call, x);
      const swapped = call.fake >= 0 && x >= call.swap;
      this.ui.call(on ? (call.c2 >= 0 ? `${CALL.names[call.c]} OR ${CALL.names[call.c2]}!` : swapped ? `SWITCH! ${CALL.names[col]}!` : `${CALL.names[col]}!`) : null, CALL.colors[col]);
      this.ui.fuse(on ? (call.drop - x) / (call.drop - call.t0) : null, CALL.colors[col]);
      // (the switch: the moment the call changes)
      if (swapped && on && this.swapI !== call.i) {
        this.swapI = call.i;
        this.sound.notes([84, 72, 84], 0.05, 0.45, true);
        this.shake = Math.max(this.shake, 0.12);
      }
      // (a tick for each of the last moments, then the floor goes)
      const left = Math.ceil((call.drop - x) / 0.5);
      if (on && left <= 3 && left !== this.tickN) {
        this.tickN = left;
        this.sound.notes([79 + (3 - left) * 2], 0, 0.3, true);
      }
      if (x >= call.drop && x < call.back && this.dropI !== call.i) {
        this.dropI = call.i;
        this.sound.notes([48, 43], 0.05, 0.5);
        this.shake = Math.max(this.shake, 0.18);
      }
      if (!on) this.tickN = 0;
    }
  }

  /** Bean Cup: the ball (the host's), the goals, the second ball, golden goal */
  private cupRules(dt: number) {
    const c = this.course!;
    const w = c.b.world;
    const G = this.cupP!;
    const A = c.cup!;
    const x = w.time - c.state.go;
    const on = this.state === 'play';
    if (on) {
      if (x < 5) this.ui.call(x > 0.4 ? 'RUN INTO THE BALL · DIVE TO SHOOT' : null, 0x37c25a);
      else if (x < 5.3) this.ui.call(null);
      if (!this.guest) {
        if (!A.balls[0].live && !A.balls[0].backAt && !G.second) G.start();
        for (const e of G.tick(dt, w.time, x)) this.cupEvent(e);
        if (this.host && w.time > this.cupSent) {
          this.cupSent = w.time + 1 / 15;
          this.host.broadcast({ t: 'cup', s: G.packet(), a: G.score[0], b: G.score[1] });
        }
      } else G.follow(dt);
      if (!this.cupTwo && x > CUP.T - CUP.second) {
        this.cupTwo = true;
        this.ui.shout('SECOND BALL!', 'Two to play for', 1800);
        this.sound.notes([72, 79, 84], 0.07, 0.45, true);
      }
      if (!this.cupOT && x >= CUP.T && G.score[0] === G.score[1]) {
        this.cupOT = G.overtime = true;
        this.ui.shout('GOLDEN GOAL!', 'Next one wins it', 2200);
        this.sound.notes([67, 72, 76, 79], 0.1, 0.5, true);
        this.shake = Math.max(this.shake, 0.25);
      }
      if (!this.guest && G.done(x)) this.endRound();
    } else if (this.guest) G.follow(dt);
    for (const r of this.racers) {
      if (r.local && r.m.pos.y < c.killY) {
        const s = G.teamOf(r.c.id) === 0 ? -1 : 1;
        r.m.pos.set(A.center.x + (Math.random() - 0.5) * 16, A.center.y + 2, A.center.z + s * 12);
        r.m.vel.set(0, 0, 0);
        r.m.ang.set(0, 0, 0);
        r.m.mode = Mode.Run;
        r.m.tumbleT = r.m.upT = 0;
      }
    }
  }

  /** what the ball did this frame (the host's: a guest only hears about the goals) */
  private cupEvent(e: CupEvent) {
    const G = this.cupP!;
    if (e.k === 'goal') {
      this.host?.broadcast({ t: 'goal', team: e.team, by: e.by, own: e.own, ball: e.ball, a: e.a, b: e.b });
      this.cupGoal(e.team, e.by, e.own, e.ball);
    } else if (e.k === 'hit') {
      const r = this.racers.find((o) => o.c.id === e.id);
      if (!r) return;
      if (r.local) {
        r.m.vel.set(e.vx, e.vy, e.vz);
        r.m.knock(0.6);
      } else if (r.c.owner !== 'host') this.host?.send(r.c.owner, { t: 'shove', id: e.id, kind: 'knock', v: [e.vx, e.vy, e.vz] });
      this.sound.voice('wah', r.m.id, r.m.pos.x, r.m.pos.y, r.m.pos.z, r.c.player);
      if (r.c.player) this.ui.pop('BONK!', true);
    } else if (e.k === 'kick') {
      const b = G.arena.balls[e.ball];
      this.sound.hop(b.pos.x, b.pos.y, b.pos.z, Mat.Bumper);
      if (e.shot) {
        this.puffs.dust(b.pos.clone(), 6, 0.35, 2);
        const me = this.player();
        if (me?.m.id === e.id) {
          this.shake = Math.max(this.shake, 0.14);
          this.ui.pop('SHOT!', true);
        }
      }
    } else if (e.k === 'bang') {
      const b = G.arena.balls[e.ball];
      this.sound.hop(b.pos.x, b.pos.y, b.pos.z, Mat.Bumper);
    }
  }

  /** the net bulges and the place goes up */
  private cupGoal(team: number, by: number, own: boolean, ball: number) {
    const G = this.cupP;
    if (!G) return;
    const c = this.course!;
    const w = c.b.world;
    const b = G.arena.balls[ball];
    G.arena.shake(team === 0 ? 1 : 0, w.time);
    const who = this.racers.find((r) => r.m.id === by);
    const you = !!who?.c.player;
    const mine = this.player() && G.teamOf(this.player()!.c.id) === team;
    const name = CUP_NAMES[team];
    this.ui.shout(own ? 'OWN GOAL!' : you ? 'YOU SCORED!' : 'GOAL!', `${who ? `${who.c.name} · ` : ''}${CUP_NAMES[0]} ${G.score[0]} - ${G.score[1]} ${CUP_NAMES[1]}`, 2400);
    this.confetti.burst(b.pos, 160, 11);
    this.fireworks.show(b.pos, 5, 14, 14, 0.14);
    this.rings.ring(b.pos.clone(), 8, CUP_COLORS[team], 0.5);
    this.sound.boom(b.pos.x, b.pos.y, b.pos.z);
    this.sound.cheer(2);
    this.sound.notes(mine ? [72, 76, 79, 84, 88] : [60, 57, 53], 0.08, 0.5, true);
    this.shake = Math.max(this.shake, 0.4);
    this.fovKick = Math.max(this.fovKick, 5);
    if (!this.host && !this.guest) {
      this.timeScale = 0.45;
      this.slowUntil = performance.now() + 900;
    }
    void name;
  }

  /** Bumper Bash: the bangs (each browser its own cars), the rink coming apart, knockouts (the host's book) */
  private bumpRules() {
    const c = this.course!;
    const w = c.b.world;
    const G = this.bumpP!;
    const A = c.bump!;
    const x = w.time - c.state.go;
    if (x < 0) return;
    const on = this.state === 'play';
    G.tick(w.time, x);
    const p = this.player();
    const me = p && !p.out ? p.m : null;
    if (on) {
      if (x < 6) this.ui.call(x > 0.4 ? 'DIVE BOOSTS · JUMP HOPS · RAM THEM OFF' : null, 0xff3f9e);
      else if (x < 6.3) this.ui.call(null);
      const nx = A.next(x);
      if (nx && nx.at - x < CAR.warn) {
        if (this.bumpWarned !== nx.ring) {
          this.bumpWarned = nx.ring;
          this.ui.shout(`${nx.ring === 2 ? 'OUTER' : 'MIDDLE'} RING DROPPING!`, 'Get to the middle', 1800);
          this.sound.notes([67, 62, 67, 62], 0.12, 0.45);
        }
        const left = Math.ceil(nx.at - x);
        if (left <= 3 && left !== this.bellTick) {
          this.bellTick = left;
          this.sound.notes([76], 0, 0.4, true);
        }
      } else if (this.bumpWarned >= 0) {
        // (it's gone)
        this.bumpWarned = -1;
        this.sound.boom(A.center.x, A.center.y, A.center.z);
        this.shake = Math.max(this.shake, 0.55);
      }
      if (!this.frenzy && A.frenzy(x)) {
        this.frenzy = true;
        this.ui.shout('DOUBLE POINTS!', 'Boost faster, hit harder', 2000);
        this.sound.notes([72, 76, 79, 84, 88], 0.07, 0.5, true);
      }
    }
    for (const h of G.hits) {
      const mine = !!me && (h.a === me.id || h.b === me.id);
      const at = this.bangAt.set(h.x, h.y, h.z);
      if (!mine && at.distanceToSquared(this.camera.position) > 2800) continue;
      const am = this.racers.find((r) => r.m.id === h.a)?.m;
      this.sound.hits([{ kind: h.b < 0 ? 'surface' : 'glass', mat: h.b < 0 ? Mat.Bumper : Mat.Felt, speed: h.power, x: h.x, y: h.y, z: h.z, ny: 0, a: am!, b: this.racers.find((r) => r.m.id === h.b)?.m }], me);
      this.rings.ring(at.clone(), 1.1 + Math.min(2.4, h.power * 0.09), h.power > 16 ? 0xffd23a : 0xffffff, 0.22);
      if (h.power > 9) this.puffs.stars(at.clone());
      if (h.power > 16) this.sound.boom(h.x, h.y, h.z);
      if (mine) {
        this.shake = Math.max(this.shake, Math.min(0.6, h.power * 0.028));
        if (h.power > 8) this.fovKick = Math.max(this.fovKick, Math.min(6, h.power * 0.2));
        if (h.by === me!.id && h.b >= 0 && h.power > 13 && w.time > this.popT) {
          this.popT = w.time + 0.4;
          this.ui.pop(h.power > 24 ? 'WHAM!' : 'BAM!', h.power > 24);
        }
      }
    }
    if (me) {
      const car = A.car(me.id);
      if (car.fired) {
        car.fired = false;
        this.sound.dash(me.pos.x, me.pos.y, me.pos.z);
        this.sound.notes([55, 67], 0.03, 0.22);
        this.fovKick = Math.max(this.fovKick, 5);
      }
      const cd = x > CAR.T - CAR.frenzy ? CAR.cdFrenzy : CAR.cd;
      this.ui.meter(on ? 1 - car.cd / cd : null, car.cd <= 0 ? 'BOOST READY' : 'BOOST', car.cd <= 0);
    } else this.ui.meter(null);
    for (const r of G.fallen) {
      const m = r.m;
      const by = w.time - m.hitT < CAR.credit && m.hitBy >= 0 && m.hitBy !== m.id ? m.hitBy : -1;
      A.respawn(m, w.time);
      if (!on) continue;
      if (this.guest) this.guest.send({ t: 'ko', id: m.id, by });
      else this.bumpKO(m.id, by);
    }
    if (!this.guest && on && this.playT > CAR.T) this.endRound();
  }

  /** (the host) a car's off: the book, and out to everyone */
  private bumpKO(id: number, by: number) {
    const G = this.bumpP;
    if (!G) return;
    const w = this.course!.b.world;
    const e = G.ko(id, by, w.time - this.course!.state.go, w.time);
    this.host?.broadcast({ t: 'ko', id, by, v: e.v, n: e.n, o: e.o, chain: e.chain, crown: e.crown });
    this.koFx(id, by, e.v, e.chain, e.crown);
  }

  /** a knockout, as you see it */
  private koFx(id: number, by: number, v: number, chain: boolean, crown: boolean) {
    const c = this.course!;
    const w = c.b.world;
    const A = c.bump;
    if (!A) return;
    A.car(id).ghost = Math.max(A.car(id).ghost, w.time + CAR.ghost);
    const p = this.player();
    const who = this.racers.find((r) => r.m.id === id);
    if (who) this.sound.voice('wah', id, who.m.pos.x, who.m.pos.y, who.m.pos.z, who === p);
    if (p && by === p.m.id) {
      this.ui.shout(crown ? 'CROWN KO!' : chain ? 'DOUBLE KO!' : 'KNOCKOUT!', `${who?.c.name ?? ''}  +${v}`, 1300);
      this.sound.notes(chain || crown ? [76, 79, 84, 88] : [76, 84], 0.05, 0.45, true);
      this.confetti.burst(p.m.pos, crown ? 110 : 50, 7);
      this.shake = Math.max(this.shake, 0.3);
    } else if (p && id === p.m.id) {
      const k = this.racers.find((r) => r.m.id === by);
      this.ui.pop(k ? `KO BY ${k.c.name.toUpperCase()}` : 'OFF THE EDGE!', true);
      this.sound.notes([55, 50, 45], 0.08, 0.4);
    } else if (who && who.m.pos.distanceTo(this.camera.position) < 30 && Math.random() < 0.5) this.sound.ooh();
  }

  /** the kart race: who's done their two laps, the lap calls, the clock */
  private kartRules() {
    const G = this.kartP!;
    if (this.state !== 'play') return;
    for (const r of this.racers) {
      if (!r.local || r.fin || r.pend || !G.done(r.m.id)) continue;
      if (this.guest) {
        r.pend = true;
        this.guest.send({ t: 'fin', id: r.c.id });
      } else this.finish(r);
    }
    const p = this.player();
    if (p && !p.out && !p.fin) G.calls(p.m.id, this.playT);
    if (!this.guest && this.playT > KART_T) this.endRound();
  }

  /** Bounce House: the pops (the host's), the calls, and anyone who somehow got out of the castle */
  private bounceRules(_dt: number) {
    const c = this.course!;
    const w = c.b.world;
    const G = this.bounce!;
    const A = c.bounce!;
    const x = w.time - c.state.go;
    const on = this.state === 'play';
    if (on) {
      G.refresh(x);
      const n = Math.floor(x / BOUNCE.star);
      if (n > this.starN && x < BOUNCE.T - 2) {
        this.starN = n;
        this.ui.shout('STAR BALLOON!', `Worth ${BOUNCE.starV}: super bounce to it`, 1500);
        this.sound.notes([79, 84, 91], 0.06, 0.4, true);
      }
      if (!this.frenzy && this.playT > BOUNCE.T - BOUNCE.storm) {
        this.frenzy = true;
        this.ui.shout('BALLOON STORM!', 'Pop everything', 1700);
        this.sound.notes([72, 76, 79, 84, 88], 0.07, 0.45, true);
      }
      const p = this.player();
      const sup = p ? (A.supers.get(p.m.id) ?? 0) : 0;
      if (sup > this.bounceSuper) {
        this.bounceSuper = sup;
        this.sound.notes([67, 74, 79], 0.03, 0.3, true);
        this.fovKick = Math.max(this.fovKick, 3);
        this.rings.ring(p!.m.pos.clone().setY(A.center.y + 0.1), 2.4, 0xffffff, 0.3);
      }
      if (!this.guest) {
        for (const e of G.pops(x, w.time)) {
          this.host?.broadcast({ t: 'pop', k: e.k, id: e.id, v: e.v, n: e.n, c: e.combo });
          this.popFx(e.k, e.id, e.v, e.combo);
        }
      }
    }
    for (const r of this.racers) {
      if (r.local && r.m.pos.y < c.killY) {
        const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 8;
        r.m.pos.set(A.center.x + Math.cos(a) * d, A.center.y + 3, A.center.z + Math.sin(a) * d);
        r.m.vel.set(0, 0, 0);
        r.m.mode = Mode.Run;
      }
    }
    if (!this.guest && on && this.playT > BOUNCE.T) this.endRound();
  }

  /** Crown Keeper: the clock on the crown (the host's), falls and getting back on (each browser its own) */
  private keepRules(dt: number) {
    const c = this.course!;
    const w = c.b.world;
    const K = this.keepP!;
    const A = c.keep!;
    const on = this.state === 'play';
    if (!this.guest) {
      const changed = K.tick(dt, w.time, on);
      if (K.taken) this.keepNote(K.taken.id, K.taken.how);
      else if (changed) this.keepNote(-1, 'took', K.knocked, K.homing);
      if (changed || w.time > this.keepSent) {
        this.keepSent = w.time + 0.4;
        this.host?.broadcast({ t: 'keep', h: A.holder, x: A.x, z: A.z, s: [...K.held], how: K.taken?.how, k: K.knocked, home: K.homing });
      }
    }
    if (on) this.keepShow(dt);
    for (const r of this.racers) {
      if (!r.fell && r.m.pos.y < c.killY) {
        r.fell = w.time;
        if (r.local || !this.guest) {
          this.drop(r);
          this.sound.voice('wah', r.m.id, r.m.pos.x, r.m.pos.y, r.m.pos.z, r.c.player);
        }
      } else if (r.fell && r.local && w.time - r.fell > 1.2) {
        r.fell = 0;
        // (back on the inner courtyard, which never goes)
        const a = Math.random() * Math.PI * 2, d = KEEP.keepR + 1.4 + Math.random() * 3.4;
        const rx = A.center.x + Math.cos(a) * d, rz = A.center.z + Math.sin(a) * d;
        r.m.pos.set(rx, A.groundAt(rx, rz) + 2, rz);
        r.m.vel.set(0, 0, 0);
        r.m.ang.set(0, 0, 0);
        r.m.mode = Mode.Run;
        r.m.tumbleT = r.m.upT = r.m.heldT = 0;
        r.m.release();
      } else if (r.fell && !r.local && r.m.pos.y > c.killY + 3) r.fell = 0;
    }
    // (past the clock it isn't over while someone else has the crown and can still catch the leader)
    const late = this.playT > KEEP.T;
    if (!this.guest && on && (K.winner() || (late && (!K.overtime() || this.playT > KEEP.T + KEEP.over)))) this.endRound();
  }

  /** Crown Keeper as you see it: the announcer, the sparkle round the crown, the drums near the end */
  private keepPhase = 0;
  private keepSpark = 0;
  private keepShow(dt: number) {
    const c = this.course!;
    const K = this.keepP!;
    const A = c.keep!;
    const x = c.b.world.time - c.state.go;
    const ph = KEEP_PHASES[this.keepPhase];
    if (ph && x >= ph.at) {
      this.keepPhase++;
      this.ui.shout(ph.text, ph.sub, 2000);
      this.sound.notes([60, 67, 72, 79], 0.07, 0.5);
      this.fireworks.show(A.center, 5, 34, 26);
    }
    // a trail of gold behind the crown
    this.keepSpark -= dt;
    if (A.holder >= 0 && this.keepSpark <= 0) {
      this.keepSpark = 0.24 - 0.12 * A.share;
      this.puffs.stars(K.at.clone().setY(K.at.y - 1.5));
    }
    const h = this.racers.find((r) => r.m.id === A.holder);
    const left = h ? KEEP.hold - (K.held.get(h.m.id) ?? 0) : Infinity;
    if (h && left < 8) this.ui.call(h.c.player ? `${left.toFixed(1)} SECONDS FROM THE CROWN!` : `STOP ${h.c.name.toUpperCase()}! ${left.toFixed(1)}s`, 0xffc21f);
    else if (this.playT > KEEP.T && K.overtime()) this.ui.call('OVERTIME!', 0xff4f6a);
    else if (A.hot(x)) this.ui.call(h && A.onTop(h.m.pos) ? (h.c.player ? 'ON THE THRONE: CLOCK X2' : `${h.c.name.toUpperCase()} IS ON THE THRONE: CLOCK X2`) : 'THE THRONE IS HOT: CLOCK X2', 0xffc21f);
    else this.ui.call(null);
  }

  /** the little moments, for your bean: a dive that bowls someone over, a spring pad under you */
  private feedback() {
    const p = this.player();
    if (!p) return;
    const w = this.course!.b.world;
    const c = this.course!;
    // (a dodgem's ram and a ball's bump have their own noise)
    if (c.bump) p.m.bonked = false;
    if (p.m.bonked) {
      p.m.bonked = false;
      this.bonks++;
      this.ui.pop('BONK!', true);
      this.sound.notes([60, 72], 0.04, 0.4, true);
      this.shake = Math.max(this.shake, 0.2);
      this.fovKick = Math.max(this.fovKick, 3.5);
      this.rings.ring(p.m.pos.clone().setY(p.m.pos.y - 0.4), 2.2, 0xffffff, 0.3);
    }
    if (p.m.sprung) {
      p.m.sprung = false;
      this.ui.pop('BOING!', true);
      this.sound.notes([67, 74, 79, 86], 0.04, 0.35, true);
      this.fovKick = Math.max(this.fovKick, 6);
      this.puffs.dust(p.m.pos.clone().setY(p.m.pos.y - 0.45), 12, 0.3, 3.4);
    }
    if (p.m.boosted) {
      p.m.boosted = false;
      this.ui.pop('ZOOM!', true);
      this.sound.notes([72, 79, 84, 91], 0.03, 0.35, true);
      this.fovKick = Math.max(this.fovKick, 5);
    }
    // a bean you bowled over that's gone over the edge
    for (const r of this.racers) {
      if (c.bump || r === p || r.m.hitBy !== p.m.id) continue;
      if (w.time - r.m.hitT > 4) {
        r.m.hitBy = -1;
        continue;
      }
      if (!r.fell && !r.out && r.m.pos.y > p.m.pos.y - 7) continue;
      r.m.hitBy = -1;
      this.kos++;
      this.ui.shout(`KO! ${r.c.name.toUpperCase()}`, this.kos > 1 ? `${this.kos} KOs this show` : '', 1300);
      this.sound.notes([72, 76, 79, 84], 0.05, 0.45, true);
      this.sound.cheer(0.6);
    }
    // stars
    if (this.starsP && !p.out && !p.fin) {
      const n = this.starsP.take(p.m, w.time);
      if (n) {
        this.starCount += n;
        this.sound.notes([84 + (this.starCount % 10)], 0, 0.22, true);
      }
    }
  }

  /** the announcer, every round: spots running out, the field thinning, the last climb */
  private roundCalls() {
    const c = this.course!;
    if (this.state !== 'play' || c.keep || c.team || c.cup || c.bounce || this.book) return;
    if (c.path) {
      const left = this.slots - this.racers.filter((r) => r.fin).length;
      if (c.kind !== 'final' && left < this.lastLeft && left > 0 && left <= 3) {
        this.ui.shout(left === 1 ? 'LAST SPOT!' : `${left} SPOTS LEFT!`, '', 1300);
        this.sound.notes(left === 1 ? [79, 84, 79, 84] : [76, 79], 0.08, 0.35);
      }
      this.lastLeft = left;
      if (c.kind === 'final' && !this.climbCalled && this.racers.some((r) => r.s > c.finishS * 0.84)) {
        this.climbCalled = true;
        this.ui.shout('THE LAST CLIMB!', 'First through the gate takes the crown', 2000);
        this.sound.notes([60, 67, 72, 79], 0.07, 0.5);
        this.fireworks.show(c.path.P[c.path.index(c.finishS)], 6, 30, 22);
      }
    } else if (c.plate && !c.cup) {
      const left = this.racers.filter((r) => !r.out).length - this.slots;
      if (left < this.lastLeft && left > 0 && left <= 3 && this.lastLeft !== Infinity) {
        this.ui.shout(left === 1 ? 'ONE MORE TO GO!' : `${left} MORE TO GO!`, '', 1300);
        this.sound.notes([76, 79], 0.08, 0.35);
      }
      this.lastLeft = left;
    }
  }

  /** the crown changing hands, as you see it */
  private keepNote(id: number, how: 'took' | 'stole', by = -1, home = false) {
    const p = this.player();
    if (id < 0) {
      this.sound.notes(home ? [72, 76, 79] : [67, 60], 0.05, 0.3, true);
      if (by >= 0 && by === p?.m.id) {
        this.ui.pop('KNOCKED IT LOOSE!', true);
        this.shake = Math.max(this.shake, 0.22);
      } else if (home) this.ui.note('The crown flies home to the throne!', 1500);
      return;
    }
    const r = this.racers.find((q) => q.m.id === id);
    if (!r) return;
    const at = r.m.pos.clone();
    at.y -= 0.45;
    this.rings.ring(at, 3, 0xffd23a, 0.4);
    this.puffs.stars(r.m.pos);
    if (r === p) {
      this.ui.note(how === 'stole' ? 'STOLEN! Now run!' : 'You have the crown! Get to the throne!', 1400);
      this.sound.notes([76, 79, 84], 0.05, 0.4, true);
    } else if (p && this.course?.keep && how === 'stole') this.sound.notes([64, 60], 0.06, 0.25, true);
  }

  /** a balloon going pop: for everyone near, and the score for you */
  private popFx(k: number, id: number, v: number, combo: number) {
    const G = this.bounce!, A = this.course!.bounce!;
    const q = G.balloon(k);
    const x = this.course!.b.world.time - this.course!.state.go;
    const r = this.racers.find((o) => o.m.id === id);
    if (q) {
      const at = A.at(q, x, new THREE.Vector3());
      if (at.distanceTo(this.camera.position) < 40) {
        this.rings.ring(at, q.kind === Pop.Star ? 3.4 : 1.5, q.kind === Pop.Thunder ? 0xfff27a : 0xffffff, 0.22);
        this.confetti.burst(at, q.kind === Pop.Star ? 70 : 9, 5);
      }
    }
    // (the zap lands on whoever runs that bean)
    if (v < 0 && r?.local) {
      r.m.vel.y = -7;
      r.m.knock(0.6);
    }
    const p = this.player();
    if (p?.m.id !== id) return;
    if (v < 0) {
      this.ui.pop(`ZAP! ${v}`, true);
      this.sound.notes([48, 44], 0.05, 0.45);
      this.shake = Math.max(this.shake, 0.28);
      return;
    }
    this.sound.notes([76 + combo * 3 + Math.floor(Math.random() * 2)], 0, 0.3, true);
    this.ui.pop(combo > 1 ? `+${v} x${combo}` : `+${v}`, combo > 1 || v > 2);
    if (q?.kind === Pop.Star) this.fireworks.show(p.m.pos, 3, 16, 12, 0.15);
  }

  private tickN = 0;
  private waveN = -1;
  private swapI = -1;
  private dropI = -1;
  private tickAt = 0;
  private frenzy = false;
  /** the camera's shake (decays) */
  private shake = 0;
  private rings = new Rings();
  private lavaWarned = false;
  private strikes: import('./course-storm.ts').Strike[] = [];

  /** Lava Rush: caught. Out (the host decides for its beans and the bots; a guest asks) */
  private lavaOut(r: Racer) {
    const m = r.m;
    if (this.guest) {
      r.pend = true;
      this.guest.send({ t: 'out', id: r.c.id });
      this.fellOff(r);
    } else this.eliminate(r);
    r.fell = 0;
    m.frozen = true;
    m.vel.set(0, 0, 0);
    m.pos.y -= 0.7;
    this.puffs.dust(m.pos.clone(), 14, 0.5, 2.5);
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
    const m = r.m;
    const at = c.path ? c.path.at(c.finishS, 0, 4) : m.pos.clone().setY(m.pos.y + 3);
    if (r.fin <= this.slots) this.confetti.burst(at, r.c.player ? 260 : 40, r.c.player ? 11 : 8);
    if (r.c.player) {
      if (c.kind === 'final') {
        this.ui.banner('CROWNED!', 'gold', 'You win the show!', 0);
        this.sound.crowned();
        this.fireworks.show(at, 14, 36, 26, 0.22);
      } else if (c.kart) {
        const win = r.fin === 1;
        this.ui.banner(win ? 'YOU WIN!' : `${r.fin}${ordinal(r.fin).toUpperCase()}!`, win ? 'gold' : 'good', r.fin <= this.slots ? 'Qualified' : 'Not quite', 4200);
        this.sound.qualified();
        this.sound.cheer(win ? 1.4 : 0.8);
        this.fireworks.show(at, win ? 10 : 4, 26, 18, 0.2);
        this.kartP?.flagged(m.id, r.fin, r.fin <= this.slots);
        if (!this.online()) {
          this.slowUntil = performance.now() + 900;
          this.timeScale = 0.4;
        }
      } else {
        this.ui.banner('QUALIFIED!', 'good', `${r.fin}${ordinal(r.fin)} across the line`);
        this.sound.qualified();
        this.fireworks.show(at, 4, 22, 16, 0.2);
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
    const c = this.course!;
    const m = r.m;
    this.drop(r);
    this.sound.voice('wah', m.id, m.pos.x, m.pos.y, m.pos.z, r.c.player);
    // (the crowd reacts to anyone going over near the camera)
    if (!r.c.player && m.pos.distanceTo(this.camera.position) < 25 && Math.random() < 0.6) this.sound.ooh();
    if (r.c.player && this.state === 'play') {
      this.ui.banner('ELIMINATED', 'bad', c.crumble ? (c.crumble.mode === 'melt' ? 'Into the icy water' : 'Fell through the floors') : c.lava ? 'Caught by the lava' : c.storm ? 'Blasted overboard' : c.rocket ? 'Out of the sky' : 'Knocked off the plate');
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
    if (r.c.player && !c.plate && !c.lava) this.ui.banner('SPLASH!', 'bad', 'Back to the checkpoint', 1200);
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

  /**
   * (the host, or solo) Nobody waits on bots: once every person in the round is through or out,
   * it wraps up a moment later and the rest is settled where they stand. A round with no people
   * left in it (you're watching the rest of the show) skips on space or enter.
   */
  private noWaiting() {
    const c = this.course!;
    if (this.guest || this.state !== 'play' || this.autopilot) return;
    const people = this.racers.filter((r) => r.c.human);
    const skip = this.pressed.has('Enter') || this.pressed.has('Space');
    const done = people.every((r) => r.out || r.fin > 0);
    if (!done) {
      this.wrapAt = 0;
      return;
    }
    if (!people.length) {
      if (skip) this.wrapUp();
      return;
    }
    if (c.team || c.cup) return;
    // (a kart race gets its moment: the flag, the slow motion, the camera round to the front. And the
    // drift key's the skip key, so one still held down over the line doesn't throw it all away)
    const wait = c.kart ? KART_WRAP : WRAP_T;
    if (!this.wrapAt) this.wrapAt = this.playT + wait;
    if (this.playT >= this.wrapAt || (skip && (!c.kart || this.playT > this.wrapAt - wait + 1.6))) this.wrapUp();
  }
  private wrapAt = 0;

  /** the round settled as it stands: the leaders take the places left, the best of the standing survive */
  private wrapUp() {
    const c = this.course!;
    if (c.team || c.cup || c.bounce || c.keep || this.book) {
      this.endRound();
      return;
    }
    if (c.plate) {
      const still = this.racers.filter((r) => !r.out).map((r) => [r.c.skill + Math.random() * 0.6, r] as const);
      still.sort((a, b) => b[0] - a[0]);
      for (const [, r] of still.slice(this.slots)) r.out = true;
    } else {
      const left = this.racers.filter((r) => !r.fin && !r.out).sort((a, b) => b.s - a.s);
      for (const r of left.slice(0, Math.max(0, this.slots - this.finCount))) r.fin = ++this.finCount;
    }
    this.endRound();
  }

  /** (the host, or solo) time's up or the places are taken: who goes through */
  private endRound() {
    const c = this.course!;
    if (this.state !== 'play') return;
    const loser = this.teamPlay ? this.teamPlay.loser() : this.cupP ? this.cupP.loser() : -1;
    // (Crown Keeper: the one who got to the time, or who has held it longest)
    if (this.keepP) {
      const w = this.keepP.ranking()[0] as Racer | undefined;
      if (w) w.fin = 1;
    }
    const rich = this.bounce ? new Set(this.bounce.ranking().slice(0, this.slots)) : this.book ? new Set(this.book.ranking().slice(0, this.slots) as Racer[]) : this.keepP ? new Set(this.keepP.ranking().slice(0, 1)) : null;
    const through = this.racers.filter((r) => (rich ? rich.has(r) : c.cup ? this.cupP!.teamOf(r.m.id) !== loser : c.team ? this.teamPlay!.teamOf(r.m.id) !== loser : c.plate ? !r.out : r.fin > 0 && r.fin <= this.slots)).map((r) => r.c.id);
    this.host?.broadcast({ t: 'end', through, fins: this.racers.filter((r) => r.fin).map((r) => [r.c.id, r.fin] as [number, number]) });
    this.roundOver(new Set(through));
  }

  /** the round's over (everyone): the field cut to who went through */
  private roundOver(through: Set<number>) {
    const c = this.course!;
    if (this.state !== 'play' && this.state !== 'countdown') return;
    this.state = 'over';
    this.stateT = 0;
    this.ui.fuse(null);
    this.ui.meter(null);
    this.ui.call(null);
    this.sound.jet(false);
    for (const r of this.racers) {
      const ok = through.has(r.c.id);
      if (!ok && !r.out) r.out = true;
      if (!ok) r.c.out = true;
    }
    for (const x of this.roster) if (!through.has(x.id)) x.out = true;
    const p = this.player();
    if (p && p.out && !p.c.out) p.c.out = true;
    if (p && (c.team || c.cup)) {
      const ok = through.has(p.c.id);
      this.ui.banner(ok ? 'QUALIFIED!' : 'ELIMINATED', ok ? 'good' : 'bad', c.cup ? `${CUP_NAMES[0]} ${this.cupP!.score[0]} - ${this.cupP!.score[1]} ${CUP_NAMES[1]}` : ok ? 'Your team painted enough floor' : 'Your team painted the least', 3200);
      if (ok) this.sound.qualified();
      else this.sound.eliminated();
      this.sound.voice(ok ? 'yay' : 'aww', p.m.id, p.m.pos.x, p.m.pos.y, p.m.pos.z, true);
    } else if (p && (c.bounce || this.book)) {
      const ok = through.has(p.c.id);
      this.ui.banner(ok ? 'QUALIFIED!' : 'ELIMINATED', ok ? 'good' : 'bad', c.bump ? (ok ? 'Last car rolling' : 'Not enough knockouts') : ok ? 'You popped your way through' : 'Not enough pops', 3200);
      if (ok) this.sound.qualified();
      else this.sound.eliminated();
      this.sound.voice(ok ? 'yay' : 'aww', p.m.id, p.m.pos.x, p.m.pos.y, p.m.pos.z, true);
    } else if (c.keep) {
      const w = this.racers.find((r) => through.has(r.c.id));
      this.slowUntil = performance.now() + 1800;
      this.timeScale = 0.35;
      this.sound.crowned();
      if (w) this.confetti.burst(w.m.pos, 260, 11);
      this.fireworks.show(c.keep.center, 14, 36, 28, 0.22);
      this.ui.call(null);
      this.ui.arrow(null);
      if (w?.c.player) this.ui.banner('CROWNED!', 'gold', 'You win the show!', 0);
      else if (w) this.ui.banner(`${w.c.name.toUpperCase()} WINS!`, 'gold', 'The crown goes to ' + w.c.name, 0);
    } else if (p && c.plate && !p.out) {
      this.ui.banner('SURVIVED!', 'good', c.call ? 'You kept your footing' : c.rocket ? 'Still flying!' : 'You stayed on the plate');
      this.sound.qualified();
      this.fireworks.show(c.plate.center, 5, 24, 18, 0.2);
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
    // (the cursor back for the buttons)
    if (document.pointerLockElement) document.exitPointerLock();
    const final = c.kind === 'final';
    const p = this.player();
    this.host?.broadcast({ t: final ? 'champion' : 'results' });
    this.state = final ? 'champion' : 'results';
    this.stateT = 0;
    this.ui.hideBanner();
    this.ui.call(null);
    this.ui.hud(false);
    this.sound.setMusic('calm');
    const order = this.ranked();
    const rows: Row[] = order.map((r) => ({
      name: r.c.name,
      color: r.c.outfit.a,
      state: final ? (r.fin === 1 ? 'win' : 'out') : r.c.out ? 'out' : 'q',
      me: r.c.player,
      style: r.c.human ? (r.c.player ? undefined : 'Player') : STYLES[r.c.style].name,
      note: this.keepP ? (r.fin === 1 ? 'CROWN' : `${(this.keepP.held.get(r.m.id) ?? 0).toFixed(1)}s`) : final ? (r.fin === 1 ? 'CROWN' : r.fin ? `${r.fin}${ordinal(r.fin)}` : '') : this.bounce ? `${this.bounce.score.get(r.m.id) ?? 0} PTS` : this.book ? `${this.book.of(r.m.id)} PTS` : c.team && this.teamPlay ? this.teamPlay.nameOf(r.m.id) : this.cupP ? this.cupP.nameOf(r.m.id) : !c.plate && r.fin ? `${r.fin}${ordinal(r.fin)}` : undefined,
    }));
    const online = this.online();
    if (final) {
      this.readyNextShow();
      const win = order.find((r) => r.fin === 1) ?? order[0];
      const me = win?.c.player;
      this.ui.results({
        title: me ? 'YOU WIN THE CROWN!' : `${win.c.name} wins the crown`,
        sub: `${me ? 'Champion of Wobble Mania' : p && !p.c.out ? 'So close. Run it back?' : 'What a show.'}${this.bonks ? ` You bonked ${this.bonks} bean${this.bonks > 1 ? 's' : ''}.` : ''}${this.kos ? ` ${this.kos} KO${this.kos > 1 ? 's' : ''}.` : ''}${this.starCount ? ` ${this.starCount} stars.` : ''}`,
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
      title: playerIn ? 'YOU QUALIFIED!' : p ? 'YOU ARE OUT' : 'ROUND OVER',
      sub: `${left} beans go through to ${SHOW[this.roundIdx + 1]?.name ?? "the next round"}`,
      rows,
      next: this.guest ? 'NEXT ROUND SOON' : playerIn || this.host ? 'NEXT ROUND' : 'NEW SHOW',
      wait: !!this.guest,
      onNext: () => {
        if (this.guest) return;
        if (playerIn || this.host) next();
        else (this.ui.hideResults(), this.newShow());
      },
      extra: online ? { label: 'LEAVE', on: () => this.leaveParty() } : playerIn ? undefined : { label: 'WATCH THE REST', on: next },
      auto: (playerIn || this.host) && !this.guest ? RESULTS_T : undefined,
    });
    this.resultsT = RESULTS_T;
    // (online the host moves the show on, whether it's still in or not)
    this.resultsNext = playerIn || this.host ? next : null;
    if (this.guest) this.resultsNext = null;
    // (the next course goes up behind the results, not after them)
    const up = SHOW[this.roundIdx + 1];
    if (up) this.idle(() => this.state === 'results' && this.buildAhead(up.id));
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
  /** a paint bomb went off: a burst of its team's colour */
  private bombFx() {
    const b = this.teamPlay?.lastBoom;
    if (!b) return;
    this.confetti.burst(b.pos.clone().add(new THREE.Vector3(0, 1, 0)), b.mine ? 160 : 70, 7, 3);
    this.puffs.dust(b.pos, 14, 0.35, 3.2);
    if (b.mine) this.ui.banner('SPLAT!', 'good', 'A paint bomb for your team', 900);
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
      case 'ko':
        if (r && r.c.owner === from) this.bumpKO(m.id, m.by);
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
        if (m.lineup) setShow(m.lineup as RoundId[]);
        await Promise.all([this.ui.reveal(POOL.map((id) => ROUNDS[id]), SHOW[m.idx], m.idx + 1, SHOW.length), this.loadRound(m.idx, false, m.order)]);
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
      case 'cup':
        this.cupP?.heard(m.s, m.a, m.b);
        break;
      case 'goal':
        if (this.cupP) {
          this.cupP.score[0] = m.a;
          this.cupP.score[1] = m.b;
          this.cupGoal(m.team, m.by, m.own, m.ball);
        }
        break;
      case 'ko':
        if (this.bumpP && m.v !== undefined) {
          if (m.by >= 0 && m.n !== undefined) this.bumpP.score.set(m.by, m.n);
          if (m.o !== undefined) this.bumpP.score.set(m.id, m.o);
          this.koFx(m.id, m.by, m.v, !!m.chain, !!m.crown);
        }
        break;
      case 'keep':
        if (this.keepP) {
          const A = this.course!.keep!;
          const was = A.holder;
          const w = this.course!.b.world;
          // (a crown leaving a head flies from where this browser drew it)
          if (was >= 0 && m.h < 0) this.keepP.throwFrom(this.keepP.at, w.time, m.home ? 1.3 : 0.85, m.home ? 9 : 3.4);
          if (was !== m.h && m.h >= 0) A.zoomT = w.time + KEEP.safe;
          A.holder = m.h;
          A.x = m.x;
          A.z = m.z;
          for (const [id, v] of m.s) this.keepP.held.set(id, v);
          if (was !== m.h) this.keepNote(m.h, m.how ?? 'took', m.k ?? -1, m.home);
        }
        break;
      case 'pop':
        if (this.bounce) {
          this.bounce.take(m.k, m.id, m.n);
          this.popFx(m.k, m.id, m.v, m.c);
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
      case 'tiles':
        this.teamPlay?.arena.load(m.c);
        break;
      case 'crumble': {
        const A = this.course?.crumble;
        if (A) m.k.forEach((k, i) => A.set(k, m.at[i]));
        break;
      }
      case 'splat':
        if (this.teamPlay) {
          this.teamPlay.collect(m.k, m.id);
          this.bombFx();
        }
        break;
      case 'lobby':
        this.toMenu();
        this.showLobby();
        break;
    }
  }

  private showLobby(status?: string) {
    // (the code is made here, so it's up at once; the broker catches up behind it)
    const code = this.host ? this.host.code : (this.guest?.code ?? '');
    this.ui.hideMenu();
    this.ui.lobby({
      code,
      host: !!this.host,
      members: this.members.map((x) => ({ name: x.name, color: x.outfit.a, me: x.id === (this.host ? 'host' : this.guest?.id), host: x.id === 'host' })),
      max: MAX_PLAYERS,
      status: this.host && !this.host.peer.open ? 'Opening the party…' : status,
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
    // (solo, every show gets its own seed; online the host's startShow counts them)
    this.showNo = 1 + Math.floor(Math.random() * 9000);
    this.bonks = 0;
    this.kos = 0;
    this.starCount = 0;
    this.deal();
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
    // the team round: the host's floor to everyone twice a second (so every screen shows the same paint)
    if (this.host && this.teamPlay && (this.state === 'play' || this.state === 'over')) {
      this.tilesAcc += dt;
      if (this.tilesAcc > 1) {
        this.tilesAcc = 0;
        this.host.broadcast({ t: 'tiles', c: this.teamPlay.arena.save() });
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
      buf.set([r.c.id, m.pos.x, m.pos.y, m.pos.z, m.vel.x, m.vel.y, m.vel.z, this.kartP ? this.kartP.fx(m.id) : m.yaw, flags, m.quat.x, m.quat.y, m.quat.z, m.quat.w, r.s], o);
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
      if (this.kartP) this.kartP.setFx(m.id, buf[o + 7]);
      else m.yaw = buf[o + 7];
      m.mode = f & 3;
      m.groundT = f & F.GROUND ? 0 : 1;
      m.holding = f & F.HOLD ? m : null;
      m.heldT = f & F.HELD ? 0.3 : 0;
      m.quat.set(buf[o + 9], buf[o + 10], buf[o + 11], buf[o + 12]);
      if (this.course.path || this.course.bump || this.course.kart) r.s = buf[o + 13];
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
      m.knock(BUMP.down);
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
      const lead = c.keep ? 0.45 + 0.55 * Math.max(c.keep.share, this.playT / KEEP.T) : c.kart ? Math.max(0, ...this.racers.map((r) => (r.fin ? 1 : r.s / (c.kart!.track.length * RACE.laps)))) : c.path ? Math.max(0, ...this.racers.map((r) => (r.fin ? 1 : r.s / c.finishS))) : this.playT / 70;
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
    this.fireworks.update(dt);
    this.splashes.update(dt);
    // dust and stars: hard landings, dives, knock-downs (whoever's near enough to see)
    for (const r of this.racers) {
      const m = r.m;
      if (!m.active || !r.rig.root.visible || m.pos.distanceToSquared(cam.position) > 45 * 45) continue;
      const feet = V_FEET.copy(m.pos);
      feet.y -= 0.5;
      if (m.landed > 9) this.puffs.dust(feet, 7, 0.2 + Math.min(0.15, m.landed * 0.01), 2 + m.landed * 0.08);
      if (m.dashed) {
        this.puffs.dust(feet, 6, 0.2, 2.2);
        if (r.c.player) this.shake = Math.max(this.shake, 0.06);
      }
      // (a dust trail along a belly slide)
      if (m.mode === Mode.Dive && m.grounded && m.vel.lengthSq() > 70) this.puffs.dust(feet, 1, 0.16, 1.1);
      if (m.bounced) {
        this.puffs.stars(m.pos);
        this.rings.ring(feet, 1.8, 0xffffff, 0.25);
        if (r.c.player) this.sound.notes([84, 91], 0.05, 0.4, true);
      }
      if (m.knocked) {
        this.puffs.stars(m.pos);
        if (r.c.player) this.shake = Math.max(this.shake, 0.3);
      }
      if (r.c.player && m.landed > 14) this.shake = Math.max(this.shake, Math.min(0.2, m.landed * 0.01));
      if (r.rig.step && r.c.player && m.vel.lengthSq() > 40) this.puffs.dust(feet, 1, 0.12, 0.8);
    }
    this.puffs.update(dt);
    this.rings.update(dt);
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
    if (c.kart && this.kartP) {
      this.kartP.aim(cam, f.m.id, dt, this.snapCam, this.camLook);
      this.snapCam = false;
      this.camPos.copy(cam.position);
      this.fovKick = Math.max(this.fovKick, this.kartP.kick(f.m.id));
      this.shake = Math.max(this.shake, this.kartP.jolt(f.m.id));
      return this.camEnd(dt);
    }
    const m = f.m;
    const speed = m.vel.length();
    if (!this.dragging && !this.manualCam) this.yawOff *= 1 - Math.min(1, dt * (c.plate ? 0.2 : 0.7));
    let want = this.camYaw;
    // the free arenas (Cookie Crumble, Meltdown, the paint rounds): behind you, turning with the way
    // you run (only as much as you're running forward, so a sidestep doesn't spin it round)
    const free = !!(c.crumble || c.team || c.rocket);
    let freeK = 0;
    if (free) {
      const hs = Math.hypot(m.vel.x, m.vel.z);
      if (hs > 2.2 && !f.fell) {
        const vy = Math.atan2(m.vel.x, m.vel.z);
        const fwd = Math.cos(vy - (this.camYaw + this.yawOff));
        freeK = Math.max(0, fwd) * Math.min(1, (hs - 2.2) / 4);
        want = vy - this.yawOff;
      }
    } else if (c.cup && this.cupP) {
      // (the ball in view; right on top of it, the goal you're shooting at)
      const ball = this.cupP.ballNear(m.pos);
      const t = this.camTmp.set(0, 0, 0);
      if (ball) t.subVectors(ball.pos, m.pos);
      if (!ball || Math.hypot(t.x, t.z) < 5) c.cup.goal(this.cupP.teamOf(f.c.id), t).sub(m.pos);
      want = Math.atan2(t.x, t.z);
    } else if (c.bump) {
      // (behind the car: it goes where the nose goes)
      want = m.yaw;
    } else if (c.plate) {
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
    // (the player's camera holds still; otherwise it swings round behind the way ahead)
    if (free) {
      if (!this.dragging) this.camYaw = lerpAngle(this.camYaw, want, this.snapCam ? 1 : Math.min(1, dt * 2.2 * freeK));
    } else if (!this.manualCam || this.snapCam) this.camYaw = lerpAngle(this.camYaw, want, this.snapCam ? 1 : Math.min(1, dt * (c.bump ? 3.4 : c.plate ? 1.5 : 3)));
    const yaw = this.camYaw + this.yawOff;
    const pt = this.pitchOff;
    // (Cookie Crumble: the floors above the one you're on fade away, and the camera looks down on yours)
    if (c.crumble) c.crumble.view(Math.max(0, c.crumble.layerAt(m.pos.y + (f.fell ? 0 : 0.3))), dt);
    const dist = (c.cup ? 10.5 : c.bump ? 12 : c.rocket ? 11.5 : c.crumble ? 7 : c.team ? 7.2 : c.call ? 9.8 : c.bounce ? 8.8 : c.plate ? 8.6 : 5.8 + Math.min(speed, 20) * 0.06) * (1 + Math.max(0, pt) * 0.25 - Math.min(0, pt) * 0.1);
    const hgt = (c.cup ? 6.4 : c.bump ? 7 : c.rocket ? 7.4 : c.crumble ? 4.6 : c.team ? 4.2 : c.call ? 7.6 : c.bounce ? 6 : c.plate ? 4.9 : 2.75 + Math.min(speed, 20) * 0.035) * (1 + pt * (c.crumble ? 0.7 : 1.1));
    const tgt = m.pos.clone();
    if (f.fell) tgt.y = Math.max(tgt.y, c.lakeY + 6);
    // (Bounce House: the view rides a steady height, or you'd be seasick in a minute)
    if (c.bounce) tgt.y = c.bounce.center.y + 1.6 + (tgt.y - c.bounce.center.y - 1.6) * 0.22;
    const pos = new THREE.Vector3(tgt.x - Math.sin(yaw) * dist, tgt.y + hgt, tgt.z - Math.cos(yaw) * dist);
    // (the team arena has walls: out past them, the camera climbs and looks down over them instead)
    if (c.team) {
      const A = c.team;
      const ex = (A.round ? Math.hypot(pos.x - A.center.x, pos.z - A.center.z) : Math.max(Math.abs(pos.x - A.center.x), Math.abs(pos.z - A.center.z))) - (A.half - 0.5);
      if (ex > 0) pos.y += ex * 1.3;
    }
    // (the pitch: inside the glass, always)
    if (c.cup) {
      const ctr = c.cup.center, lx = CUP.HW - 1.2, lz = CUP.HL + 2;
      const ox = Math.abs(pos.x - ctr.x) - lx, oz = Math.abs(pos.z - ctr.z) - lz;
      if (ox > 0) pos.x = ctr.x + Math.sign(pos.x - ctr.x) * lx;
      if (oz > 0) pos.z = ctr.z + Math.sign(pos.z - ctr.z) * lz;
      pos.y += Math.max(0, ox, oz) * 0.45;
      // (over the top of the bar, never level with it)
      if (Math.abs(pos.z - ctr.z) > CUP.HL - 3 && Math.abs(pos.x - ctr.x) < CUP.goalHalf + 3) pos.y = Math.max(pos.y, ctr.y + CUP.goalH + 3.2);
      c.cup.view(pos);
    }
    // (Bounce House: always inside the castle, never out behind its walls)
    if (c.bounce) {
      const A = c.bounce, ex = pos.x - A.center.x, ez = pos.z - A.center.z, er = Math.hypot(ex, ez), lim = A.R - 1.2;
      if (er > lim) {
        pos.x = A.center.x + (ex / er) * lim;
        pos.z = A.center.z + (ez / er) * lim;
        pos.y += (er - lim) * 0.5;
      }
    }
    // (the free arenas: a few metres out in front of you, at your feet's height)
    const look = free || c.bump ? tgt.clone().add(new THREE.Vector3(Math.sin(yaw) * 3.2, 0.5, Math.cos(yaw) * 3.2)) : tgt.clone().add(new THREE.Vector3(Math.sin(yaw) * 2.2, 1.05, Math.cos(yaw) * 2.2));
    if (c.plate && !free && !c.cup && !c.bump) look.lerp(c.plate.center, 0.25);
    if (this.snapCam) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.snapCam = false;
    } else {
      // (the height lags a little more: drops feel like drops)
      const k = Math.min(1, dt * 7);
      this.camPos.x += (pos.x - this.camPos.x) * k;
      this.camPos.z += (pos.z - this.camPos.z) * k;
      this.camPos.y += (pos.y - this.camPos.y) * Math.min(1, dt * (c.crumble ? 9 : 4.5));
      this.camLook.lerp(look, Math.min(1, dt * 10));
    }
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    this.camEnd(dt);
  }

  /** the last of the camera, whatever it's following */
  private camEnd(dt: number) {
    const cam = this.camera;
    // (speed opens the view up; a jolt shakes it)
    if (this.shake > 0.002) {
      const s = this.shake;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shake *= Math.exp(-dt * 9);
    }
    this.fovKick *= Math.exp(-dt * 5);
    const speed = this.focus()?.m.vel.length() ?? 0;
    const fov = 60 + (this.course?.kart ? Math.min(17, speed * 0.52) : Math.min(14, Math.max(0, speed - 9.5) * 1.5)) + this.fovKick;
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
      const big = c.keep ? 1.75 : 1;
      const r = (c.cup ? 52 - t * 12 : (32 - t * 10) * big);
      const at = c.plate.center;
      cam.position.set(at.x + Math.cos(a) * r, at.y + (c.cup ? 26 - t * 8 : (16 - t * 6) * big), at.z + Math.sin(a) * r);
      this.camLook.copy(at);
      cam.lookAt(this.camLook);
      return;
    }
    if (c.kart) {
      // (a long sweep over the circuit, coming down onto the grid)
      const a = -1 + t * 1.6, r = 300 - t * 170, ctr = c.kart.center;
      cam.position.set(ctr.x + Math.cos(a) * r, ctr.y + 120 - t * 74, ctr.z + Math.sin(a) * r - 40);
      this.camLook.lerpVectors(ctr, c.kart.gridAt, t * t);
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

  /** where the crown is, when it's off the screen */
  private crownArrow() {
    const K = this.keepP, p = this.player();
    const ball = this.cupP && p && this.state === 'play' ? this.cupP.ballNear(p.m.pos) : null;
    if (ball) return this.pointAt(ball.pos, 'BALL', 0xffffff);
    const c = this.course;
    if (c?.rocket && !K) {
      if (!p || p.out || this.state !== 'play' || !this.rocketAim) return this.ui.arrow(null);
      const A = c.rocket, x = c.b.world.time - c.state.go;
      let bd = Infinity;
      const at = this.tmpAim, q = this.camTmp;
      for (const pad of A.pads) {
        const y = A.padY(pad, x);
        if (y === null || x > pad.out - 1) continue;
        q.set(A.center.x + pad.x, y, A.center.z + pad.z);
        const d = q.distanceTo(p.m.pos);
        if (d < bd) (bd = d), at.copy(q);
      }
      for (let i = 0; i < A.rings.length; i++) {
        if (x >= A.rings[i].out) continue;
        A.ringAt(i, x, q);
        const d = q.distanceTo(p.m.pos) * 0.8;
        if (d < bd) (bd = d), at.copy(q);
      }
      if (bd === Infinity) return this.ui.arrow(null);
      return this.pointAt(at, 'FUEL', 0x4af0ff);
    }
    if (!K || this.state !== 'play' || !p || K.arena.holder === p.m.id) return this.ui.arrow(null);
    this.pointAt(K.at, 'CROWN', 0xffd23a);
  }
  /** an arrow at the edge of the screen, for something that's off it */
  private pointAt(at: THREE.Vector3, text: string, color: number) {
    const v = this.tmpArrow.copy(at).project(this.camera);
    const behind = v.z > 1;
    if (!behind && Math.abs(v.x) < 0.92 && Math.abs(v.y) < 0.88) return this.ui.arrow(null);
    const W = window.innerWidth, H = window.innerHeight;
    let ax = behind ? -v.x : v.x, ay = behind ? -v.y : v.y;
    const l = Math.max(Math.abs(ax) / 0.86, Math.abs(ay) / 0.78, 1e-3);
    ax /= l;
    ay /= l;
    this.ui.arrow({ x: ((ax + 1) / 2) * W, y: ((1 - ay) / 2) * H, a: Math.atan2(ax, ay), text, color });
  }
  private tmpArrow = new THREE.Vector3();
  private camTmp = new THREE.Vector3();
  private tmpAim = new THREE.Vector3();

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
      // (over the bean, on top of its ball)
      const tall = c.kart ? 1.9 : c.bump ? 2 : 1.4;
      v.copy(r.m.pos).add(new THREE.Vector3(0, tall, 0)).project(cam);
      const dist = r.m.pos.distanceTo(cam.position);
      // (in a kart: no tag on yourself, none on anyone close enough to be read off their kart, and
      // none on a kart that's only near as the crow flies, over a hill on another bit of the road)
      const off = c.kart && f ? Math.abs(r.s - f.s) : 0;
      const show = !r.out && !r.fell && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (c.kart ? !me && dist > 4 && dist < 34 && off < 40 && Math.abs(v.x) < 0.72 : me || dist < (c.plate ? 15 : 22)) && r.m.active;
      this.ui.tag(r.c.id, me ? 'YOU' : r.c.name, ((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H, show || (r.c.human && !(c.kart && me) && !r.out && !r.fell && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && dist < 60), me, r.c.human && !me);
    }
    const alive = this.racers.filter((r) => !r.out).length;
    const race = !c.plate;
    const ranked = this.ranked();
    let status = '';
    if (c.keep && this.keepP) status = p && c.keep.holder === p.m.id ? `YOU HAVE IT! ${(KEEP.hold - (this.keepP.held.get(p.m.id) ?? 0)).toFixed(1)}s TO GO` : c.keep.holder < 0 ? 'THE CROWN IS LOOSE!' : `${this.racers.find((r) => r.m.id === c.keep!.holder)?.c.name.toUpperCase() ?? 'SOMEONE'} HAS THE CROWN!`;
    else if (c.kind === 'final') status = this.finCount ? 'WINNER!' : 'FIRST WINS';
    else if (this.cupP) {
      const mineT = this.cupP.mine();
      status = `${CUP_NAMES[0]} ${this.cupP.score[0]} - ${this.cupP.score[1]} ${CUP_NAMES[1]}${mineT ? ` · YOU'RE ${mineT.name}` : ''}`;
    } else if (c.team && this.teamPlay) status = this.teamPlay.mine() ? `TEAM ${this.teamPlay.mine()!.name}` : 'TEAM GAME';
    else if (c.kart && !this.finCount) status = `TOP ${this.slots} GO THROUGH`;
    else if (race) status = `QUALIFIED ${Math.min(this.finCount, this.slots)} / ${this.slots}`;
    else if (this.bounce) {
      const place = p ? ranked.indexOf(p) + 1 : 0;
      status = `${p ? (this.bounce.score.get(p.m.id) ?? 0) : 0} PTS · ${place}${ordinal(place).toUpperCase()} · ${place <= this.slots ? 'IN' : `TOP ${this.slots} GO THROUGH`}`;
    }
    else if (this.book) {
      const place = p ? ranked.indexOf(p) + 1 : 0;
      const dmg = c.bump && p ? ` · DAMAGE ${Math.round(c.bump.car(p.m.id).dmg * 100)}%` : '';
      const amount = `${p ? this.book.of(p.m.id) : 0} PTS`;
      status = `${amount}${dmg} · ${place}${ordinal(place).toUpperCase()} · ${place <= this.slots ? 'IN' : `TOP ${this.slots} GO THROUGH`}`;
    } else status = `ALIVE ${alive} · TO ${this.slots}`;
    const pos = f && race ? ranked.indexOf(f) + 1 : undefined;
    let timer: string | undefined;
    if (c.team && (this.state === 'play' || this.state === 'over')) timer = clock(Math.max(0, TEAM_T - this.playT));
    else if (this.cupP && (this.state === 'play' || this.state === 'over')) timer = this.playT > CUP.T ? 'GOLDEN GOAL' : clock(Math.max(0, CUP.T - this.playT));
    else if (this.bounce && (this.state === 'play' || this.state === 'over')) timer = clock(Math.max(0, BOUNCE.T - this.playT));
    else if (this.bumpP && (this.state === 'play' || this.state === 'over')) timer = clock(Math.max(0, CAR.T - this.playT));
    else if (c.keep && (this.state === 'play' || this.state === 'over')) timer = this.playT > KEEP.T ? 'OVERTIME' : clock(Math.max(0, KEEP.T - this.playT));
    else if (c.plate && (this.state === 'play' || this.state === 'over')) {
      timer = clock(SURVIVE_T - this.playT);
    } else if (race && this.state === 'play' && this.playT > RACE_T - 30) timer = clock(RACE_T - this.playT);
    const noPeople = !this.guest && this.racers.every((r) => !r.c.human);
    const spectating = !p || p.out ? `Watching ${f?.c.name ?? ''} · ←/→ to switch${noPeople ? ' · ENTER to skip' : ''}` : undefined;
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
    this.ui.teams(this.cupP ? this.cupP.board() : c.team && this.teamPlay ? this.teamPlay.scores() : this.bounce ? this.bounce.board() : this.book ? this.book.board() : this.keepP ? this.keepP.board() : null);
    this.keepP?.sync(c.b.world.time);
    this.crownArrow();
    this.starsP?.sync(c.b.world.time);
    if (this.starsP) this.ui.stars(this.starCount);
    this.roundCalls();
    const fast = p && !p.out && this.state === 'play' ? Math.hypot(p.m.vel.x, p.m.vel.z) : 0;
    this.ui.speed(c.kart ? Math.max(THREE.MathUtils.clamp((fast - 27) / 12, 0, 0.32), p ? (this.kartP?.rush(p.m.id) ?? 0) : 0) : THREE.MathUtils.clamp((fast - 12.5) / 9, 0, 0.75));
    this.teamPlay?.sync();
    this.cupP?.sync();
    const sdt = THREE.MathUtils.clamp(c.b.world.time - this.syncT, 0, 0.05);
    this.syncT = c.b.world.time;
    this.bumpP?.sync(c.b.world.time, sdt);
    this.kartP?.sync(c.b.world.time, sdt, this.camera, f?.m.id ?? -1, this.state === 'countdown' ? this.goAt - c.b.world.time : -1, this.state === 'countdown' || this.state === 'play' || this.state === 'over');
    this.rocketP?.sync(c.b.world.time);
    if (this.bounce && c.state.go < 1e8) {
      this.bounce.sync(c.b.world.time, c.b.world.time - c.state.go, this.camera.position, f?.m.pos ?? null);
      this.bounce.landing(p && !p.out && this.state === 'play' ? p.m : null, GRAVITY);
    }
    if (race && (c.path || c.kart)) {
      const L = c.path ? c.finishS : c.kart!.track.length * RACE.laps;
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
const V_FEET = new THREE.Vector3();
const RACE_T = 180;
/** a kart race's limit: anyone still out by then is out */
const KART_T = 175;
const KART_WRAP = 6.5;
const SURVIVE_T = 150;
const TEAM_T = TEAM_ROUND_T;
const INTRO_T = 3.6;
/** a beat of the 3, 2, 1 */
const COUNT_T = 0.7;
/** the round's end on screen, then the results (they move on by themselves) */
const OVER_T = 2;
const RESULTS_T = 4;
/** from the last person being done to the round wrapping up */
const WRAP_T = 1.4;

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
  const hats: Record<string, string> = { none: 'No hat', beanie: 'Bobble hat', party: 'Party hat', propeller: 'Propeller cap', bow: 'Big bow', horns: 'Little horns', antenna: 'Antennae', flower: 'Flower', tophat: 'Top hat', headphones: 'Headphones', sprout: 'Sprout', cap: 'Baseball cap', bunny: 'Bunny ears', cat: 'Cat ears', dino: 'Dino spikes', shark: 'Shark fin', chef: 'Chef hat', viking: 'Viking helmet', halo: 'Halo', unicorn: 'Unicorn horn', pirate: 'Bandana', mohawk: 'Mohawk', goggles: 'Flying goggles' };
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
  // (the textures go, the materials don't: disposing one lets its shader program go, and the next
  // course would only compile the same program again)
  for (const m of mats) for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
}
