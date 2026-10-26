import * as THREE from 'three';
import { Audio } from './audio.ts';
import { Controls } from './input.ts';
import { botPlan, Guest2, Host, makeCode, packInputs, quant, type CtlMsg, type LobbyPlayer, type LobbyState } from './net.ts';
import { buildArena, type ArenaView } from './render/arena.ts';
import { asMap, asTime, MAPS, TIMES, type MapId, type TimeId } from './render/looks.ts';
import { BallView } from './render/ball.ts';
import { CAM, ChaseCam, placeCam } from './render/camera.ts';
import { CarView, TEAM_COLORS } from './render/car.ts';
import { FX } from './render/fx.ts';
import { S, Stage } from './render/stage.ts';
import { ARENA, PADS, type Team } from './sim/arena.ts';
import { BALL } from './sim/ball.ts';
import { Bot } from './sim/bot.ts';
import { noInput, type Input } from './sim/car.ts';
import { V3 } from './sim/math.ts';
import { TICK, World, type Player, type WEvent } from './sim/world.ts';
import { UI, type Profile } from './ui.ts';

/**
 * The conductor: modes (the menu's attract match, a match against bots, free play, hosting or
 * joining an online lobby), the fixed 120 Hz loop with interpolated rendering, the online model
 * (the host runs the match; a guest predicts everything locally from its own inputs, then on each
 * snapshot rolls back to the host's state and replays its unacknowledged inputs, smoothing the
 * difference out of the picture), goal replays, and the effects and sounds for every event.
 */

type Mode = 'attract' | 'offline' | 'freeplay' | 'host' | 'guest';

interface Frame {
  ball: [number, number, number, number, number, number, number];
  cars: { p: [number, number, number]; q: [number, number, number, number]; boost: boolean; alive: boolean }[];
}

const tq = new THREE.Quaternion();
const tm = new THREE.Matrix4();
const tv3 = new THREE.Vector3();
const fwd3 = new THREE.Vector3();
const lft3 = new THREE.Vector3();
const up3 = new THREE.Vector3();

function carQuat(c: World['cars'][number], out: THREE.Quaternion): THREE.Quaternion {
  fwd3.set(c.rot.f.x, c.rot.f.y, c.rot.f.z);
  lft3.set(c.rot.l.x, c.rot.l.y, c.rot.l.z);
  up3.set(c.rot.u.x, c.rot.u.y, c.rot.u.z);
  tm.makeBasis(fwd3, lft3, up3);
  return out.setFromRotationMatrix(tm);
}

export class Game {
  readonly stage: Stage;
  readonly field = new THREE.Group(); // simulation frame (cm, z up) → three
  readonly arena: ArenaView;
  readonly ball = new BallView();
  readonly fx = new FX();
  readonly cam = new ChaseCam();
  readonly audio = new Audio();
  readonly controls: Controls;
  readonly ui: UI;
  world = new World();
  mode: Mode = 'attract';
  me = -1;
  bots = new Map<number, Bot>();
  views: CarView[] = [];
  private ballQ = new THREE.Quaternion();
  private prev: { p: V3; q: THREE.Quaternion }[] = [];
  private prevBall = new V3();
  private visOff: { p: V3; q: THREE.Quaternion }[] = [];
  private ballOff = new V3();
  private acc = 0;
  private last = performance.now();
  private time = 0;
  paused = false;
  private excite = 0;
  private flashK = 0;
  private boardOpen = false;
  // replays
  private frames: Frame[] = [];
  private clip: Frame[] = [];
  private clipT = 0;
  private replayCam = new V3();
  private replayLook = new V3();
  // online
  host: Host | null = null;
  guest: Guest2 | null = null;
  lobby: LobbyState | null = null;
  myId = 'host';
  private seq = 0;
  private hist: Input[] = [];
  private snap: Float32Array | null = null;
  private lastSnapTick = -1;
  private acks: number[] = [];
  private snapBuf = new Float32Array(4096);
  private owners: string[] = [];
  private lastPhase = '';
  private lastSnapAt = 0;
  private hiddenTicker: Worker | null = null;
  private padsPrev = new Float32Array(PADS.length);
  private offlineOpts = { size: 2, skill: 0.55, minutes: 5 };

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.stage = new Stage(canvas);
    // a driver reset loses the env map and render targets; outside an online match a reload is cleanest
    this.stage.onRestored = () => {
      if (this.mode !== 'host' && this.mode !== 'guest') location.reload();
    };
    this.field.rotation.x = -Math.PI / 2;
    this.field.scale.setScalar(S);
    this.arena = buildArena();
    this.stage.scene.add(this.arena.root, this.field);
    this.field.add(this.ball.mesh, this.ball.glow, this.fx.group);
    this.controls = new Controls(canvas);
    this.ui = new UI(uiRoot);
    this.applyProfile(this.ui.profile);
    this.wireUI();
    this.controls.onAction = (a) => this.action(a);
    window.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { capture: true });
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('resize', () => this.fx.setViewport(this.stage.renderer.domElement.height, this.stage.camera.fov));
  }

  // ------------------------------------------------------------------ setup
  private applyProfile(p: Profile): void {
    CAM.FOV = p.fov;
    CAM.DIST = p.dist;
    CAM.HEIGHT = p.height;
    this.cam.ballCam = p.ballCam;
    this.audio.setVolume(p.volume);
    this.controls.classic = p.keys === 'classic';
    this.ui.cam(this.cam.ballCam);
    // the arena follows your setting except inside an online lobby, where the host picks
    if (!this.lobby) this.setLook(this.q.get('map') ?? p.map, this.q.get('time') ?? p.time);
  }
  /** ?map= and ?time= pin the look (links, screenshots) */
  private readonly q = new URLSearchParams(location.search);

  /** the arena and the time of day (the stage's light and the arena's dressing together) */
  setLook(map: MapId | string | undefined, time: TimeId | string | undefined): void {
    const m = MAPS[asMap(map)];
    const t = TIMES[asTime(time)];
    if (this.lookKey === m.id + t.id) return;
    this.lookKey = m.id + t.id;
    this.stage.setLook(t, m);
    this.arena.setLook(t, m);
  }
  private lookKey = '';
  private lastReset: number[] = Array(8).fill(-9);

  /** build cars for a roster */
  private setup(roster: Player[], authority: boolean): void {
    for (const v of this.views) this.field.remove(v.group);
    this.views = [];
    this.world = new World();
    this.world.authority = authority;
    this.bots.clear();
    this.prev = [];
    this.visOff = [];
    roster.forEach((p, i) => {
      this.world.addCar(p);
      const v = new CarView(p.team, p.color, this.mode === 'host' || this.mode === 'guest' ? p.name : undefined);
      this.views.push(v);
      this.field.add(v.group);
      if (p.bot && authority) this.bots.set(i, new Bot(i, p.skill));
      this.prev.push({ p: new V3(), q: new THREE.Quaternion() });
      this.visOff.push({ p: new V3(), q: new THREE.Quaternion() });
    });
    this.owners = roster.map((p) => p.owner);
    this.acks = roster.map(() => 0);
    this.frames = [];
    this.lastPhase = '';
    this.fx.setViewport(this.stage.renderer.domElement.height, this.stage.camera.fov);
  }

  private botRoster(size: number, skill: number, withMe: boolean): Player[] {
    const names = ['Blaze', 'Nova', 'Vortex', 'Comet', 'Torque', 'Rook', 'Jinx', 'Sundown', 'Echo', 'Maverick', 'Pulse', 'Sizzle', 'Turbo', 'Halo'];
    const r: Player[] = [];
    let n = Math.floor(Math.random() * names.length);
    if (withMe) r.push({ name: this.ui.profile.name, team: 0, bot: false, skill: 1, color: this.ui.profile.accent, owner: 'local' });
    for (const team of [0, 1] as Team[]) {
      const have = r.filter((p) => p.team === team).length;
      for (let k = have; k < size; k++) r.push({ name: names[n++ % names.length], team, bot: true, skill, color: [0xffffff, 0xffd23a, 0x39e07a, 0x1b1d22, 0xb06bff][k % 5], owner: 'bot' });
    }
    return r;
  }

  attract(): void {
    this.leaveNet();
    if (this.showcase) {
      this.field.remove(this.showcase.group);
      this.showcase = null;
    }
    this.mode = 'attract';
    this.me = -1;
    this.tvSnap = true;
    if (!this.lobby) this.setLook(this.q.get('map') ?? this.ui.profile.map, this.q.get('time') ?? this.ui.profile.time);
    this.setup(this.botRoster(2, 0.75, false), true);
    this.world.start({ minutes: 99, freeplay: false });
    this.world.phaseT = 0.5;
    this.ui.showHud(false);
    this.ui.showLobby(false);
    this.ui.showMenu(true);
    this.controls.enabled = false;
  }

  playOffline(size: number, skill: number, minutes: number): void {
    this.offlineOpts = { size, skill, minutes };
    this.mode = 'offline';
    this.setup(this.botRoster(size, skill, true), true);
    this.me = 0;
    this.world.start({ minutes });
    this.enterMatch();
  }

  freeplay(): void {
    this.mode = 'freeplay';
    this.setup([{ name: this.ui.profile.name, team: 0, bot: false, skill: 1, color: this.ui.profile.accent, owner: 'local' }], true);
    this.me = 0;
    this.world.start({ freeplay: true, unlimitedBoost: true });
    this.world.ball.pos.set(0, 600, 92.75);
    this.enterMatch();
    this.ui.tip('Free play · unlimited boost · Enter resets the ball');
  }

  private enterMatch(): void {
    this.paused = false;
    if (this.showcase) {
      this.field.remove(this.showcase.group);
      this.showcase = null;
    }
    this.ui.showMenu(false);
    this.ui.showLobby(false);
    this.ui.showHud(true);
    this.ui.hideEnd();
    this.ui.pause(false);
    this.ui.tip('');
    this.controls.enabled = true;
    const c = this.world.cars[this.me];
    if (c) this.cam.snap(this.camTarget());
    this.audio.unlock();
  }

  // ------------------------------------------------------------------ UI wiring
  private wireUI(): void {
    const ui = this.ui;
    ui.onClick = () => this.audio.ui();
    ui.onPlay = (size, skill, minutes) => this.playOffline(size, skill, minutes);
    ui.onFreeplay = () => this.freeplay();
    ui.onHost = () => this.hostLobby();
    ui.onJoin = (code) => this.joinLobby(code);
    ui.onProfile = (p) => {
      this.applyProfile(p);
      if (this.showcase) this.buildShowcase();
    };
    ui.onScreen = (id) => {
      if (this.mode !== 'attract') return;
      if (id === 's-garage') this.buildShowcase();
      else if (this.showcase) {
        this.field.remove(this.showcase.group);
        this.showcase = null;
      }
    };
    ui.onResume = () => this.setPause(false);
    ui.onLeave = () => this.leaveMatch();
    ui.onAgain = () => {
      if (this.mode === 'offline') this.playOffline(this.offlineOpts.size, this.offlineOpts.skill, this.offlineOpts.minutes);
      else if (this.mode === 'host') this.backToLobby();
    };
    ui.onLobbyTeam = (team) => {
      if (this.host && this.lobby) {
        const me = this.lobby.players.find((p) => p.id === 'host');
        if (me) me.team = team;
        this.pushLobby();
      } else this.guest?.send({ t: 'team', team });
    };
    ui.onLobbyOpt = (o) => {
      if (!this.host || !this.lobby) return;
      Object.assign(this.lobby, o);
      if (o.map || o.time) this.setLook(this.lobby.map, this.lobby.time);
      this.pushLobby();
    };
    ui.onLobbyKick = (id) => this.host?.kick(id);
    ui.onLobbyStart = () => this.startOnline();
    ui.onLobbyLeave = () => this.attract();
    ui.onChat = (text) => {
      const from = this.ui.profile.name;
      if (this.host) {
        this.host.broadcast({ t: 'chat', from, text });
        this.ui.chat(from, text);
      } else this.guest?.send({ t: 'chat', from, text });
    };
  }

  private action(a: 'ballcam' | 'pause' | 'board' | 'boardUp' | 'skip'): void {
    if (this.mode === 'attract') return;
    if (a === 'ballcam') {
      this.cam.ballCam = !this.cam.ballCam;
      this.ui.profile.ballCam = this.cam.ballCam;
      this.ui.cam(this.cam.ballCam);
    } else if (a === 'pause') this.setPause(!this.paused);
    else if (a === 'board') {
      this.boardOpen = true;
      this.showBoard();
    } else if (a === 'boardUp') {
      this.boardOpen = false;
      this.ui.board(false);
    } else if (a === 'skip') {
      if (this.mode === 'freeplay') {
        this.world.ball.reset();
        this.world.ball.pos.set(0, 0, 92.75);
        this.world.phase = 'play';
      } else if (this.world.phase === 'replay' && this.world.authority) this.world.phaseT = Math.min(this.world.phaseT, 0.05);
      else if (this.world.phase === 'replay') this.clipT = 99;
    }
  }

  private showBoard(): void {
    const w = this.world;
    const pings = this.owners.map((o) => (o === 'local' || o === 'host' ? 0 : (this.host?.guests.get(o)?.ping ?? this.lobby?.players.find((p) => p.id === o)?.ping ?? 0)));
    this.ui.board(
      true,
      w.players.map((p, i) => ({ name: p.name, team: p.team, st: w.stats[i], me: i === this.me, ping: pings[i] })),
      w.score,
    );
  }

  private setPause(v: boolean): void {
    if (this.mode === 'attract') return;
    this.paused = v;
    this.ui.pause(v);
    this.controls.enabled = !v;
  }

  private leaveMatch(): void {
    this.ui.pause(false);
    this.ui.hideEnd();
    this.attract();
  }

  // ------------------------------------------------------------------ online: host
  private hostLobby(): void {
    this.leaveNet();
    this.ui.onlineMsg('Opening a lobby…');
    const h = (this.host = new Host());
    this.myId = 'host';
    h.onError = (e) => {
      if (e === 'taken') {
        h.close();
        this.host = null;
        this.hostLobby();
      } else if (!this.lobby) this.ui.onlineMsg('Could not open a lobby (' + e + '). Try again in a moment.');
      else this.ui.toast('Lobby server trouble: ' + e);
    };
    h.onOpen = () => {
      this.lobby = {
        code: h.code,
        players: [{ id: 'host', name: this.ui.profile.name, team: 0, color: this.ui.profile.accent, bot: false, skill: 1, ping: 0 }],
        size: 2,
        minutes: 5,
        bots: 'even',
        botSkill: 0.55,
        inMatch: false,
        map: this.ui.profile.map,
        time: this.ui.profile.time,
      };
      this.ui.onlineMsg('');
      this.ui.showMenu(false);
      this.ui.showLobby(true);
      this.ui.chat('Lobby', `Room ${h.code} is open. Share the code or the invite link.`);
      this.pushLobby();
      history.replaceState(null, '', `?join=${h.code}`);
    };
    h.onCtl = (from, m) => this.hostCtl(from, m);
    h.onLeave = (id) => {
      if (!this.lobby) return;
      const p = this.lobby.players.find((x) => x.id === id);
      this.lobby.players = this.lobby.players.filter((x) => x.id !== id);
      if (p) {
        this.ui.chat('Lobby', `${p.name} left.`);
        this.host?.broadcast({ t: 'chat', from: 'Lobby', text: `${p.name} left.` });
      }
      // in a match: a bot takes the wheel
      const i = this.owners.indexOf(id);
      if (i >= 0 && this.mode === 'host') {
        this.owners[i] = 'bot';
        this.bots.set(i, new Bot(i, 0.6));
        this.ui.feed(`${this.world.players[i].name} left · a bot takes over`, -1);
      }
      this.pushLobby();
    };
  }

  private hostCtl(from: string, m: CtlMsg): void {
    const L = this.lobby;
    if (!L || !this.host) return;
    if (m.t === 'hello') {
      const blue = L.players.filter((p) => p.team === 0).length;
      const orange = L.players.filter((p) => p.team === 1).length;
      const name = (m.name || 'Player').slice(0, 16);
      L.players.push({ id: from, name, team: blue <= orange ? 0 : 1, color: m.color, bot: false, skill: 1, ping: 0 });
      this.host.send(from, { t: 'welcome', id: from, lobby: L });
      this.ui.chat('Lobby', `${name} joined.`);
      this.host.broadcast({ t: 'chat', from: 'Lobby', text: `${name} joined.` });
      if (L.inMatch) this.host.send(from, { t: 'chat', from: 'Lobby', text: 'A match is on; you will be in the next one.' });
      this.pushLobby();
    } else if (m.t === 'team') {
      const p = L.players.find((x) => x.id === from);
      if (p) p.team = m.team;
      this.pushLobby();
    } else if (m.t === 'chat') {
      const p = L.players.find((x) => x.id === from);
      const text = m.text.slice(0, 120);
      this.host.broadcast({ t: 'chat', from: p?.name ?? '?', text });
      this.ui.chat(p?.name ?? '?', text);
    }
  }

  private pushLobby(): void {
    if (!this.lobby || !this.host) return;
    for (const p of this.lobby.players) if (p.id !== 'host') p.ping = this.host.guests.get(p.id)?.ping ?? 0;
    this.host.broadcast({ t: 'lobby', lobby: this.lobby });
    if (!this.lobby.inMatch) this.ui.lobby(this.lobby, 'host', true);
  }

  private startOnline(): void {
    const L = this.lobby;
    if (!L || !this.host) return;
    const roster: Player[] = L.players.map((p) => ({ name: p.name, team: p.team, bot: false, skill: 1, color: p.color, owner: p.id }));
    const plan = botPlan(L);
    const names = ['Blaze', 'Nova', 'Vortex', 'Comet', 'Torque', 'Rook', 'Jinx', 'Echo'];
    let n = 0;
    for (const team of [0, 1] as Team[]) for (let k = 0; k < (team === 0 ? plan.blue : plan.orange); k++) roster.push({ name: names[n++ % names.length], team, bot: true, skill: L.botSkill, color: 0xffffff, owner: 'bot' });
    if (!roster.some((p) => p.team === 0) || !roster.some((p) => p.team === 1)) {
      this.ui.toast('Each team needs at least one car (or turn bots on)');
      return;
    }
    L.inMatch = true;
    this.lobbyIdle = false;
    const seed = (Math.random() * 1e9) | 0;
    this.host.broadcast({ t: 'start', roster, minutes: L.minutes, seed });
    this.mode = 'host';
    this.setup(roster, true);
    this.me = roster.findIndex((p) => p.owner === 'host');
    this.world.seed = seed;
    this.world.start({ minutes: L.minutes });
    this.enterMatch();
    this.pushLobby();
  }

  private backToLobby(): void {
    if (!this.lobby) return;
    this.lobby.inMatch = false;
    this.host?.broadcast({ t: 'toLobby' });
    this.mode = 'attract';
    this.me = -1;
    this.ui.showHud(false);
    this.ui.hideEnd();
    this.ui.showLobby(true);
    this.pushLobby();
    // keep a match running behind the lobby
    this.setup(this.botRoster(2, 0.75, false), true);
    this.world.start({ minutes: 99 });
    this.mode = 'host';
    this.me = -1;
    this.lobbyIdle = true;
  }
  private lobbyIdle = false;

  // ------------------------------------------------------------------ online: guest
  private joinLobby(code: string): void {
    code = code.trim().toUpperCase();
    if (code.length !== 4) {
      this.ui.onlineMsg('Codes are 4 letters.');
      return;
    }
    this.leaveNet();
    this.ui.onlineMsg(`Connecting to ${code}…`);
    const g = (this.guest = new Guest2(code, { name: this.ui.profile.name, color: this.ui.profile.accent }));
    g.onClose = (why) => {
      if (this.guest !== g) return;
      this.guest = null;
      this.lobby = null;
      if (this.mode === 'guest' || !this.ui.root.querySelector<HTMLElement>('#m-lobby')!.hidden) {
        this.attract();
        this.ui.screen('s-online');
      }
      this.ui.onlineMsg(why);
    };
    g.onCtl = (m) => this.guestCtl(m);
    g.onSnap = (s) => {
      if (this.mode !== 'guest') return;
      if (!this.snap || s[0] > this.snap[0]) this.snap = s;
      const now = performance.now();
      this.lastSnapAt = now;
    };
  }

  private guestCtl(m: CtlMsg): void {
    if (m.t === 'welcome') {
      this.myId = m.id;
      this.lobby = m.lobby;
      this.setLook(m.lobby.map, m.lobby.time);
      this.ui.onlineMsg('');
      this.ui.showMenu(false);
      this.ui.showLobby(!m.lobby.inMatch);
      this.ui.lobby(m.lobby, this.myId, false);
      if (m.lobby.inMatch) this.ui.toast('A match is on — you are in the next one');
    } else if (m.t === 'lobby') {
      this.lobby = m.lobby;
      this.setLook(m.lobby.map, m.lobby.time);
      if (this.mode !== 'guest') this.ui.lobby(m.lobby, this.myId, false);
    } else if (m.t === 'chat') this.ui.chat(m.from, m.text);
    else if (m.t === 'start') {
      this.mode = 'guest';
      this.setup(m.roster, false);
      this.me = m.roster.findIndex((p) => p.owner === this.myId);
      this.world.seed = m.seed;
      this.world.start({ minutes: m.minutes });
      this.seq = 0;
      this.hist = [];
      this.snap = null;
      this.lastSnapTick = -1;
      this.enterMatch();
      if (this.me < 0) this.ui.tip('Spectating — you are in the next match');
    } else if (m.t === 'toLobby') {
      this.mode = 'attract';
      this.me = -1;
      this.ui.showHud(false);
      this.ui.hideEnd();
      this.ui.showLobby(true);
      if (this.lobby) this.ui.lobby(this.lobby, this.myId, false);
      this.setup(this.botRoster(2, 0.75, false), true);
      this.world.start({ minutes: 99 });
    } else if (m.t === 'ev') {
      if (this.mode === 'guest') this.onEvent(m.ev, true);
    } else if (m.t === 'stats') {
      if (this.mode === 'guest') m.stats.forEach((s, i) => this.world.stats[i] && Object.assign(this.world.stats[i], s));
      if (this.boardOpen) this.showBoard();
    } else if (m.t === 'kick') {
      this.guest?.close('The host removed you from the lobby.');
    }
  }

  private leaveNet(): void {
    this.host?.close();
    this.host = null;
    this.guest?.close();
    this.guest = null;
    this.lobby = null;
    this.lobbyIdle = false;
    if (location.search.includes('join=')) history.replaceState(null, '', location.pathname);
  }

  // ------------------------------------------------------------------ the loop
  start(): void {
    const frame = () => {
      requestAnimationFrame(frame);
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.advance(dt);
      this.render(dt);
    };
    requestAnimationFrame(frame);
  }

  /** run the simulation forward by real time dt */
  private advance(dt: number): void {
    if (this.paused && this.mode !== 'host' && this.mode !== 'guest') return;
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK && n < 12) {
      this.tick();
      this.acc -= TICK;
      n++;
    }
    if (n >= 12) this.acc = 0;
  }

  private onVisibility(): void {
    // a hidden host tab must keep the match going for everyone: a worker clock drives it
    if (document.hidden && (this.mode === 'host' || this.mode === 'guest')) {
      if (!this.hiddenTicker) {
        const src = 'let t=setInterval(()=>postMessage(0),16);';
        this.hiddenTicker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        let last = performance.now();
        this.hiddenTicker.onmessage = () => {
          const now = performance.now();
          this.advance(Math.min(0.1, (now - last) / 1000));
          last = now;
          this.last = now;
        };
      }
    } else if (this.hiddenTicker) {
      this.hiddenTicker.terminate();
      this.hiddenTicker = null;
      this.last = performance.now();
    }
  }

  private tick(): void {
    const w = this.world;
    // poses before the step, for interpolation
    for (let i = 0; i < w.cars.length; i++) {
      this.prev[i].p.copy(w.cars[i].pos);
      carQuat(w.cars[i], this.prev[i].q);
    }
    this.prevBall.copy(w.ball.pos);

    if (this.mode === 'guest') this.guestTick();
    else {
      const inputs: Input[] = [];
      const mine = this.me >= 0 ? this.controls.read() : noInput();
      for (let i = 0; i < w.cars.length; i++) {
        const bot = this.bots.get(i);
        if (i === this.me) inputs.push(mine);
        else if (bot) inputs.push(bot.step(w));
        else if (this.mode === 'host' && this.host) {
          const r = this.host.nextInput(this.owners[i]);
          inputs.push(r.input ?? noInput());
          this.acks[i] = r.seq;
        } else inputs.push(noInput());
      }
      w.step(inputs);
      if (this.mode === 'host' && this.host && !this.lobbyIdle) {
        if (w.tick % 3 === 0) {
          const n = w.snapSize();
          if (this.snapBuf.length < n) this.snapBuf = new Float32Array(n * 2);
          this.host.snapshot(w.write(this.snapBuf, this.acks).subarray(0, n));
        }
        if (w.tick % 120 === 0) this.host.broadcast({ t: 'stats', stats: w.stats });
      }
    }
    this.integrateBallSpin(w);
    this.recordFrame();
    // events
    const evs = w.events;
    w.events = [];
    for (const e of evs) this.onEvent(e, false);
    if (this.mode === 'attract' && w.phase === 'end') w.start({ minutes: 99 });
  }

  private integrateBallSpin(w: World): void {
    const b = w.ball.w;
    const a = b.len() * TICK;
    if (a > 1e-6) {
      tv3.set(b.x / b.len(), b.y / b.len(), b.z / b.len());
      tq.setFromAxisAngle(tv3, a);
      this.ballQ.premultiply(tq);
    }
  }

  private guestTick(): void {
    const w = this.world;
    if (!this.guest) return;
    // a new snapshot: roll back to it and replay what the host hasn't seen yet
    if (this.snap && this.snap[0] > this.lastSnapTick) this.applySnapshot(this.snap);
    this.snap = null;
    this.seq++;
    const inp = this.me >= 0 ? quant(this.controls.read()) : noInput();
    this.hist[this.seq & 255] = inp;
    const send: Input[] = [];
    for (let k = 0; k < 6 && this.seq - k > 0; k++) send.push(this.hist[(this.seq - k) & 255]);
    this.guest.inputs(packInputs(this.seq, send));
    const inputs = w.cars.map((c, i) => (i === this.me ? inp : c.input));
    w.step(inputs);
  }

  private applySnapshot(s: Float32Array): void {
    const w = this.world;
    this.lastSnapTick = s[0];
    const oldP = w.cars.map((c) => c.pos.clone());
    const oldQ = w.cars.map((c) => carQuat(c, new THREE.Quaternion()));
    const oldAlive = w.cars.map((c) => c.alive);
    const oldBall = w.ball.pos.clone();
    const acks = w.read(s);
    const ack = this.me >= 0 ? acks[this.me] : this.seq;
    const saved = w.events;
    w.events = [];
    const from = Math.max(ack + 1, this.seq - 40);
    for (let k = from; k <= this.seq; k++) {
      const mine = this.hist[k & 255] ?? noInput();
      w.step(w.cars.map((c, i) => (i === this.me ? mine : c.input)));
    }
    w.events = saved;
    // smooth the correction out over the next few frames
    for (let i = 0; i < w.cars.length; i++) {
      const c = w.cars[i];
      const d = new V3().subVectors(oldP[i], c.pos);
      if (d.len() < 450 && oldAlive[i] === c.alive) {
        this.visOff[i].p.add(d);
        const nq = carQuat(c, new THREE.Quaternion());
        this.visOff[i].q.premultiply(oldQ[i].clone().multiply(nq.invert()));
      } else {
        this.visOff[i].p.set(0, 0, 0);
        this.visOff[i].q.identity();
        this.prev[i].p.copy(c.pos);
        carQuat(c, this.prev[i].q);
      }
      if (oldAlive[i] && !c.alive) this.onEvent({ t: 'demo', by: -1, car: i, x: c.pos.x, y: c.pos.y, z: c.pos.z }, true);
    }
    const db = new V3().subVectors(oldBall, w.ball.pos);
    if (db.len() < 600) this.ballOff.add(db);
    else {
      this.ballOff.set(0, 0, 0);
      this.prevBall.copy(w.ball.pos);
    }
    // phase changes the host decided
    if (this.lastPhase === 'countdown' && w.phase === 'play') this.onEvent({ t: 'go' }, true);
    this.lastPhase = w.phase;
  }

  // ------------------------------------------------------------------ events
  private onEvent(e: WEvent, remote: boolean): void {
    const w = this.world;
    const camP = this.cam.pos;
    const att = (x: number, y: number, z: number) => Math.min(1, 2500 / Math.max(800, Math.hypot(x - camP.x, y - camP.y, z - camP.z)));
    const pan = (x: number, y: number) => {
      const r = new THREE.Vector3(1, 0, 0).applyQuaternion(this.stage.camera.quaternion);
      const dx = x * S - this.stage.camera.position.x;
      const dz = -y * S - this.stage.camera.position.z;
      const l = Math.hypot(dx, dz) || 1;
      return ((dx * r.x + dz * r.z) / l) * 0.8;
    };
    const playing = this.mode !== 'attract';
    // the host relays the rules' events to guests
    if (this.mode === 'host' && this.host && !remote && ['goal', 'demo', 'save', 'shot', 'end', 'overtime'].includes(e.t)) {
      this.host.broadcast({ t: 'ev', ev: e });
      if (e.t === 'goal' || e.t === 'end') this.host.broadcast({ t: 'stats', stats: w.stats });
    }
    const name = (i: number) => w.players[i]?.name ?? '?';
    switch (e.t) {
      case 'hit': {
        const c = w.cars[e.car];
        const b = w.ball.pos;
        if (!c) break;
        this.ball.hit(e.power, w.players[e.car].team);
        const mid = new V3().copy(b).add(c.pos).scale(0.5);
        if (e.power > 600) this.fx.burst(mid.x, mid.y, mid.z, Math.min(60, 8 + e.power / 50), 900 + e.power * 0.3, new THREE.Color(2.2, 2.2, 2.4), 22, 0.35, 300);
        if (playing) this.audio.hit(e.power, att(b.x, b.y, b.z), pan(b.x, b.y));
        if (e.car === this.me && e.power > 1800 && this.ui.profile.shake) this.cam.shake(14, 0.18);
        break;
      }
      case 'bounce':
        if (playing) this.audio.bounce(e.speed, att(w.ball.pos.x, w.ball.pos.y, w.ball.pos.z), pan(w.ball.pos.x, w.ball.pos.y));
        break;
      case 'jump':
      case 'dodge': {
        const c = w.cars[e.car];
        if (c && playing) this.audio.whoosh(att(c.pos.x, c.pos.y, c.pos.z) * (e.car === this.me ? 1 : 0.6), pan(c.pos.x, c.pos.y), e.t === 'dodge');
        if (c && e.t === 'jump' && c.pos.z < 60) for (let k = 0; k < 10; k++) this.fx.smoke({ x: c.pos.x + (Math.random() - 0.5) * 80, y: c.pos.y + (Math.random() - 0.5) * 80, z: 6, vx: (Math.random() - 0.5) * 300, vy: (Math.random() - 0.5) * 300, vz: 40, r: 0.4, g: 0.42, b: 0.38, life: 0.7, size: 70, grow: 120, drag: 3 });
        break;
      }
      case 'reset': {
        const c = w.cars[e.car];
        if (!c || !playing) break;
        // (a guest's resimulation can repeat the event; once a second is plenty)
        if (this.time - this.lastReset[e.car] < 1) break;
        this.lastReset[e.car] = this.time;
        this.fx.burst(c.pos.x, c.pos.y, c.pos.z, 26, 500, new THREE.Color(1.6, 1.8, 2.4), 22, 0.4, 0);
        this.audio.pad(false);
        if (e.car === this.me) this.ui.feed('Flip reset', w.players[e.car].team);
        break;
      }
      case 'pad': {
        const p = PADS[e.pad];
        const c = new THREE.Color(2.6, 1.6, 0.4);
        this.fx.burst(p.x, p.y, p.big ? 100 : 30, p.big ? 70 : 14, p.big ? 900 : 400, c, p.big ? 45 : 25, 0.5, -200);
        if (e.car === this.me) this.audio.pad(p.big);
        break;
      }
      case 'bump': {
        const c = w.cars[e.car];
        if (c && playing) this.audio.hit(e.power * 0.6, att(c.pos.x, c.pos.y, c.pos.z), pan(c.pos.x, c.pos.y));
        break;
      }
      case 'demo': {
        this.fx.demo(e.x, e.y, e.z);
        if (playing) this.audio.explosion(att(e.x, e.y, e.z), pan(e.x, e.y), false);
        if (playing && e.by >= 0) this.ui.feed(`${name(e.by)} demolished ${name(e.car)}`, w.players[e.by]?.team ?? -1);
        if (e.car === this.me && this.ui.profile.shake) this.cam.shake(30, 0.5);
        break;
      }
      case 'count':
        if (playing && this.mode !== 'freeplay') {
          this.ui.count(e.n);
          this.audio.beep(false);
        }
        break;
      case 'go':
        if (playing && this.mode !== 'freeplay') {
          this.ui.count('GO!');
          this.audio.beep(true);
        }
        break;
      case 'goal': {
        this.fx.goal(e.x, e.y, Math.max(200, e.z), e.team);
        this.stage.flash.color.set(e.team === 0 ? 0x4a8dff : 0xff8a3a);
        this.flashK = 1;
        this.stage.flash.position.set(e.x * S, Math.max(2, e.z * S), -e.y * S);
        this.excite = 1;
        this.clip = this.frames.slice(-280);
        if (playing) {
          this.audio.goal();
          if (this.ui.profile.shake) this.cam.shake(40, 0.9);
          const kph = Math.round(e.speed * 0.036);
          const who = e.scorer >= 0 ? name(e.scorer) : e.team === 0 ? 'Blue' : 'Orange';
          const lt = w.touches[0]?.[0];
          const own = e.scorer < 0 && lt !== undefined && w.players[lt]?.team !== e.team ? ' (own goal)' : '';
          this.ui.banner(e.team === 0 ? 'Blue scores!' : 'Orange scores!', `${who}${own} · ${kph} km/h${e.assist >= 0 ? ` · assist ${name(e.assist)}` : ''}`, e.team, 2800);
          this.ui.feed(`${who} scored${e.assist >= 0 ? ` (assist ${name(e.assist)})` : ''}`, e.team);
          if (this.mode === 'guest') w.phase = 'goal';
        }
        break;
      }
      case 'save':
        if (playing) this.ui.feed(`Save! · ${name(e.car)}`, w.players[e.car]?.team ?? -1);
        if (e.car === this.me) this.ui.toast('SAVE  +50');
        break;
      case 'shot':
        if (playing) this.ui.feed(`Shot on goal · ${name(e.car)}`, w.players[e.car]?.team ?? -1);
        if (e.car === this.me) this.ui.toast('SHOT ON GOAL  +20', 1400);
        break;
      case 'overtime':
        if (playing) this.ui.banner('Overtime', 'Next goal wins', -1, 2600);
        break;
      case 'end':
        if (playing) this.matchEnd();
        break;
    }
  }

  private matchEnd(): void {
    const w = this.world;
    const winner = w.score[0] > w.score[1] ? 0 : 1;
    const rows = w.players.map((p, i) => ({ name: p.name, team: p.team, st: w.stats[i], me: i === this.me }));
    this.controls.enabled = false;
    setTimeout(() => {
      if (this.mode === 'offline') this.ui.end(winner, rows, w.score, 'Play again', 'Main menu');
      else if (this.mode === 'host') this.ui.end(winner, rows, w.score, 'Back to lobby', 'Close lobby');
      else this.ui.end(winner, rows, w.score, null, 'Leave lobby');
    }, 1800);
    if (this.me >= 0 && w.players[this.me]) this.ui.banner(w.players[this.me].team === winner ? 'Victory' : 'Defeat', `${w.score[0]} – ${w.score[1]}`, winner, 1800);
  }

  // ------------------------------------------------------------------ replays
  private recordFrame(): void {
    const w = this.world;
    if (w.tick % 2 || w.phase !== 'play') return;
    const b = w.ball;
    this.frames.push({
      ball: [b.pos.x, b.pos.y, b.pos.z, this.ballQ.x, this.ballQ.y, this.ballQ.z, this.ballQ.w],
      cars: w.cars.map((c) => {
        const q = carQuat(c, tq);
        return { p: [c.pos.x, c.pos.y, c.pos.z], q: [q.x, q.y, q.z, q.w], boost: c.boosting, alive: c.alive };
      }),
    });
    if (this.frames.length > 400) this.frames.splice(0, this.frames.length - 400);
  }

  // ------------------------------------------------------------------ rendering
  private camTarget() {
    const w = this.world;
    const c = w.cars[this.me];
    const pos = new V3().copy(c.pos).add(this.visOff[this.me]?.p ?? new V3());
    return { pos, f: c.rot.f, u: c.rot.u, vel: c.vel, onGround: c.onGround, ball: new V3().copy(w.ball.pos).add(this.ballOff) };
  }

  private render(dt: number): void {
    this.time += dt;
    const w = this.world;
    const alpha = this.paused && this.mode !== 'host' && this.mode !== 'guest' ? 1 : this.acc / TICK;
    const decay = Math.exp(-dt * 9);
    const replaying = w.phase === 'replay' && this.clip.length > 10 && this.mode !== 'attract';
    this.ui.replay(replaying);

    // ball
    const bp = new V3();
    if (replaying) {
      this.clipT += dt;
      const fi = Math.min(this.clip.length - 1, Math.floor(this.clipT * 60 * 0.75));
      const f = this.clip[fi];
      bp.set(f.ball[0], f.ball[1], f.ball[2]);
      tq.set(f.ball[3], f.ball[4], f.ball[5], f.ball[6]);
      this.ball.update(tv3.set(bp.x, bp.y, bp.z), tq, 0, dt);
      this.ball.mesh.visible = true;
      for (let i = 0; i < this.views.length; i++) {
        const cf = f.cars[i];
        if (!cf) continue;
        const v = this.views[i];
        v.group.visible = cf.alive;
        v.group.position.set(cf.p[0], cf.p[1], cf.p[2]);
        v.group.quaternion.set(cf.q[0], cf.q[1], cf.q[2], cf.q[3]);
        v.boostVis = cf.boost ? 1 : v.boostVis * 0.8;
        if (cf.boost) this.trail(i, new V3(cf.p[0], cf.p[1], cf.p[2]), v.group.quaternion, new V3());
      }
      this.replayCamera(bp, dt);
    } else {
      this.clipT = 0;
      this.ballOff.scale(decay);
      bp.set(this.prevBall.x + (w.ball.pos.x - this.prevBall.x) * alpha, this.prevBall.y + (w.ball.pos.y - this.prevBall.y) * alpha, this.prevBall.z + (w.ball.pos.z - this.prevBall.z) * alpha).add(this.ballOff);
      this.ball.update(tv3.set(bp.x, bp.y, bp.z), this.ballQ, w.ball.vel.len(), dt);
      this.ball.mesh.visible = w.phase !== 'goal' && w.phase !== 'replay';
      this.ball.glow.visible = this.ball.mesh.visible;
      const sp = w.ball.vel.len();
      if (sp > 3200 && this.ball.mesh.visible) {
        const team = w.touches[0] ? w.players[w.touches[0][0]]?.team : -1;
        const c = team === 0 ? [0.6, 1.2, 2.6] : team === 1 ? [2.6, 1.2, 0.4] : [1.8, 1.8, 2];
        this.fx.spark({ x: bp.x, y: bp.y, z: bp.z, r: c[0], g: c[1], b: c[2], life: 0.35, size: 120, drag: 0 });
      }
      // cars
      for (let i = 0; i < w.cars.length; i++) {
        const c = w.cars[i];
        const v = this.views[i];
        const off = this.visOff[i];
        off.p.scale(decay);
        off.q.slerp(new THREE.Quaternion(), 1 - decay);
        const p = this.prev[i].p;
        const pos = tv3.set(p.x + (c.pos.x - p.x) * alpha + off.p.x, p.y + (c.pos.y - p.y) * alpha + off.p.y, p.z + (c.pos.z - p.z) * alpha + off.p.z);
        const q = carQuat(c, new THREE.Quaternion());
        q.copy(this.prev[i].q).slerp(q, alpha).premultiply(off.q);
        v.update(c, pos, q, dt, this.time);
        v.showTag(i !== this.me);
        if (!c.alive) continue;
        const sv = new V3(pos.x, pos.y, pos.z);
        if (c.boosting) this.trail(i, sv, q, c.vel);
        if (c.supersonic && (w.tick & 1) === 0) {
          for (const sy of [-1, 1]) {
            const o = new THREE.Vector3(-52, sy * 30, 14).applyQuaternion(q);
            this.fx.spark({ x: sv.x + o.x, y: sv.y + o.y, z: sv.z + o.z, r: 1.6, g: 1.7, b: 2.0, life: 0.22, size: 16 });
          }
        }
        if (c.onGround && c.handbrake > 0.5 && c.vel.len() > 500) {
          for (const sy of [-1, 1]) {
            const o = new THREE.Vector3(-34, sy * 32, -14).applyQuaternion(q);
            this.fx.smoke({ x: sv.x + o.x, y: sv.y + o.y, z: sv.z + o.z, vz: 60, r: 0.55, g: 0.56, b: 0.6, life: 0.9, size: 60, grow: 140, drag: 2 });
          }
        }
        if (c.bodyTouch && c.vel.len() > 900 && Math.random() < 0.5) this.fx.burst(sv.x, sv.y, sv.z, 4, 600, new THREE.Color(2.6, 1.8, 0.8), 14, 0.3, 650);
      }
      // camera
      if (this.showcase && this.mode === 'attract') this.garage(dt);
      else if (this.dbgCam) {
        this.stage.camera.fov = this.dbgCam.fov;
        this.stage.camera.updateProjectionMatrix();
        placeCam(this.stage.camera, this.dbgCam.pos, this.dbgCam.look);
      } else if (this.mode === 'attract' || this.me < 0) this.tvCamera(bp, dt);
      else {
        const c = w.cars[this.me];
        if (c.alive) {
          this.stage.setHFov(CAM.FOV);
          const t = this.camTarget();
          t.pos.set(this.views[this.me].group.position.x, this.views[this.me].group.position.y, this.views[this.me].group.position.z);
          t.ball.copy(bp);
          this.cam.update(t, dt);
        } else {
          // demolished: hold the camera, watch the ball
          this.cam.look.x += (bp.x - this.cam.look.x) * Math.min(1, dt * 3);
          this.cam.look.y += (bp.y - this.cam.look.y) * Math.min(1, dt * 3);
          this.cam.look.z += (bp.z - this.cam.look.z) * Math.min(1, dt * 3);
          if (c.demoTimer < 0.1) this.cam.snap(this.camTarget());
        }
        this.cam.apply(this.stage.camera, dt);
      }
    }

    // effects
    this.fx.setViewport(this.stage.renderer.domElement.height, this.stage.camera.fov);
    this.fx.update(dt);
    this.flashK = Math.max(0, this.flashK - dt * 1.4);
    this.stage.flash.intensity = this.flashK * this.flashK * 6000;
    const nearGoal = THREE.MathUtils.smoothstep(Math.abs(w.ball.pos.y), 2500, 5000);
    this.excite = Math.max(this.excite - dt * 0.25, nearGoal * 0.5);
    this.arena.update(this.time, w.pads, this.excite, w.score, this.ui.clockText(w.clock, w.overtime));

    // hud + sound
    if (this.mode !== 'attract') {
      this.ui.score(w.score, w.opts.freeplay ? 0 : w.clock, w.overtime);
      const c = w.cars[this.me];
      if (c) this.ui.drawBoost(c.boost, w.players[this.me].team);
      if (this.mode === 'guest' && this.guest) {
        const age = performance.now() - this.lastSnapAt;
        const ping = this.lobby?.players.find((p) => p.id === this.myId)?.ping ?? 0;
        this.ui.net(age > 1500 ? 'CONNECTION LOST…' : ping ? `PING ${Math.round(ping)} ms` : '');
      } else if (this.mode === 'host') this.ui.net(`ROOM ${this.host?.code ?? ''}`);
      else this.ui.net('');
    }
    if (this.audio.ctx) {
      const camQ = this.stage.camera;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camQ.quaternion);
      for (let i = 0; i < w.cars.length && i < 8; i++) {
        const c = w.cars[i];
        const p = this.views[i].group.position;
        const dx = p.x * S - camQ.position.x;
        const dz = -p.y * S - camQ.position.z;
        const dy = p.z * S - camQ.position.y;
        const d = Math.hypot(dx, dy, dz);
        const pan = (dx * right.x + dz * right.z) / Math.max(1, d);
        this.audio.engine(i, c.vel.dot(c.rot.f), c.input.throttle, c.boosting, c.supersonic, d, pan, c.alive && this.mode !== 'attract', i === this.me);
      }
      this.audio.crowdLevel(this.mode === 'attract' ? 0.15 : this.excite);
    }
    this.stage.render(dt);
    this.padsPrev.set(w.pads);
  }

  /** boost exhaust: glowing particles from both nozzles */
  private trail(i: number, pos: V3, q: THREE.Quaternion, vel: V3): void {
    const team = this.world.players[i]?.team ?? 0;
    const col = team === 0 ? [0.5, 1.1, 3.2] : [3.2, 1.3, 0.35];
    const back = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
    for (const sy of [-1, 1]) {
      const o = new THREE.Vector3(-63, sy * 11, 15).applyQuaternion(q);
      for (let k = 0; k < 2; k++) {
        const sp = 500 + Math.random() * 400;
        this.fx.spark({
          x: pos.x + o.x,
          y: pos.y + o.y,
          z: pos.z + o.z,
          vx: vel.x * 0.25 + back.x * sp + (Math.random() - 0.5) * 120,
          vy: vel.y * 0.25 + back.y * sp + (Math.random() - 0.5) * 120,
          vz: vel.z * 0.25 + back.z * sp + (Math.random() - 0.5) * 120,
          r: col[0],
          g: col[1],
          b: col[2],
          life: 0.32 + Math.random() * 0.15,
          size: 38,
          grow: -40,
          drag: 2.5,
        });
      }
    }
    if (Math.random() < 0.4)
      this.fx.smoke({ x: pos.x + back.x * 70, y: pos.y + back.y * 70, z: pos.z + 17 + back.z * 70, vx: vel.x * 0.1, vy: vel.y * 0.1, vz: 30, r: 0.3, g: 0.32, b: 0.36, life: 0.8, size: 40, grow: 120, drag: 2 });
  }

  /** the garage: your car on the centre spot, the camera orbiting it */
  private showcase: CarView | null = null;
  private buildShowcase(): void {
    if (this.showcase) this.field.remove(this.showcase.group);
    const v = (this.showcase = new CarView(0, this.ui.profile.accent, this.ui.profile.name));
    this.field.add(v.group);
  }
  private garage(dt: number): void {
    const v = this.showcase!;
    v.group.position.set(0, 0, 17);
    v.group.quaternion.identity();
    v.group.visible = true;
    v.boostVis = 0;
    const a = this.time * 0.35;
    this.stage.camera.fov = 34;
    this.stage.camera.updateProjectionMatrix();
    // (offset so the car sits right of the menu)
    placeCam(this.stage.camera, new V3(Math.cos(a) * 560, Math.sin(a) * 560, 150), new V3(Math.sin(a) * 120, -Math.cos(a) * 120, 22));
    if (this.dbgCam) {
      this.stage.camera.fov = this.dbgCam.fov;
      this.stage.camera.updateProjectionMatrix();
      placeCam(this.stage.camera, this.dbgCam.pos, this.dbgCam.look);
    }
    v.showTag(false);
    for (const cv of this.views) cv.group.visible = false;
    this.ball.mesh.visible = this.ball.glow.visible = false;
    void dt;
  }

  /** a fixed camera for screenshots: __boost.debugCam([x,y,z],[x,y,z],fov) in sim cm */
  dbgCam: { pos: V3; look: V3; fov: number } | null = null;
  debugCam(p: number[] | null, l?: number[], fov = 60): void {
    this.dbgCam = p && l ? { pos: new V3(p[0], p[1], p[2]), look: new V3(l[0], l[1], l[2]), fov } : null;
  }

  /** the broadcast camera (menu backdrop, spectating): high on the side, tracking the ball */
  private tvCam = new V3(-5200, 0, 2200);
  private tvLook = new V3();
  private tvSnap = true;
  private tvCamera(bp: V3, dt: number): void {
    const t = this.time * 0.05;
    const want = new V3(Math.cos(t) * 3300, Math.max(-3800, Math.min(3800, bp.y * 0.5 + Math.sin(t) * 1400)), 1000 + Math.sin(t * 1.7) * 350);
    const k = this.tvSnap ? 1 : Math.min(1, dt * 0.8);
    this.tvCam.x += (want.x - this.tvCam.x) * k;
    this.tvCam.y += (want.y - this.tvCam.y) * k;
    this.tvCam.z += (want.z - this.tvCam.z) * k;
    const kl = this.tvSnap ? 1 : Math.min(1, dt * 2.5);
    this.tvSnap = false;
    this.tvLook.x += (bp.x * 0.8 - this.tvLook.x) * kl;
    this.tvLook.y += (bp.y - this.tvLook.y) * kl;
    this.tvLook.z += (bp.z * 0.5 - this.tvLook.z) * kl;
    this.stage.camera.fov = 58;
    this.stage.camera.updateProjectionMatrix();
    placeCam(this.stage.camera, this.tvCam, this.tvLook);
    this.cam.pos.copy(this.tvCam);
  }

  private replayCamera(bp: V3, dt: number): void {
    if (this.clipT < dt * 1.5) {
      this.replayCam.set(bp.x + (bp.x > 0 ? 1 : -1) * 1500, bp.y - Math.sign(bp.y || 1) * 1800, 700);
      this.replayLook.copy(bp);
    }
    const want = new V3(bp.x * 0.7 + (bp.x > 0 ? 900 : -900), bp.y - Math.sign(this.world.lastGoal?.y ?? 1) * 1500, Math.max(350, bp.z + 380));
    const k = Math.min(1, dt * 1.6);
    this.replayCam.x += (want.x - this.replayCam.x) * k;
    this.replayCam.y += (want.y - this.replayCam.y) * k;
    this.replayCam.z += (want.z - this.replayCam.z) * k;
    const kl = Math.min(1, dt * 6);
    this.replayLook.x += (bp.x - this.replayLook.x) * kl;
    this.replayLook.y += (bp.y - this.replayLook.y) * kl;
    this.replayLook.z += (bp.z - this.replayLook.z) * kl;
    this.stage.camera.fov = 60;
    this.stage.camera.updateProjectionMatrix();
    placeCam(this.stage.camera, this.replayCam, this.replayLook);
  }

  // ------------------------------------------------------------------ boot helpers
  /** compile every shader up front so the first boost / goal doesn't hitch */
  async warm(): Promise<void> {
    const v = new CarView(0, 0xffffff, 'warm');
    this.field.add(v.group);
    this.fx.goal(0, 0, 300, 0);
    this.fx.demo(0, 0, 100);
    for (let k = 0; k < 3; k++) this.fx.update(0.016);
    await this.stage.renderer.compileAsync(this.stage.scene, this.stage.camera);
    this.stage.render(0.016);
    this.field.remove(v.group);
    for (let k = 0; k < 400; k++) this.fx.update(0.05);
    this.stage.expectLit = true;
  }

  /** url switches for tests and links */
  boot(): void {
    const q = new URLSearchParams(location.search);
    const join = q.get('join');
    this.attract();
    if (q.get('auto')) this.playOffline(Number(q.get('size') ?? 2), Number(q.get('skill') ?? 0.55), Number(q.get('min') ?? 5));
    else if (q.get('free')) this.freeplay();
    else if (join) {
      this.ui.screen('s-online');
      this.ui.setJoinCode(join.toUpperCase());
      this.joinLobby(join);
    }
    void ARENA;
    void BALL;
    void makeCode;
    void TEAM_COLORS;
    void (null as unknown as LobbyPlayer);
  }
}
