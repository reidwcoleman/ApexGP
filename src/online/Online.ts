import * as THREE from 'three';
import { RaceHost, RaceGuest, MAX_PLAYERS, type CtlMsg, type GridSlot, type LobbySettings, type Member, type RaceConfig } from './net.ts';
import { RaceSync } from './RaceSync.ts';
import { TEAMS, uiColor, type Entry, type Driver } from '../race/Teams.ts';
import { ALL_CIRCUITS } from '../world/Circuits.ts';
import { POINTS, type Race } from '../race/Race.ts';
import './online.css';

/**
 * Online races with friends: a room (4-letter code / invite link), a lobby where everyone picks a
 * team and the host picks the race, then everyone travels to the circuit, the lights go out at the
 * same moment on every machine, and each player drives their own car (RaceSync carries the rest).
 */

export const AI_LEVELS = [
  { label: 'Rookie', v: 0.925 },
  { label: 'Pro', v: 0.965 },
  { label: 'Elite', v: 0.985 },
  { label: 'Legend', v: 1.0 },
];
const WEATHERS: [string, string][] = [
  ['random', 'Random'],
  ['clear', 'Clear'],
  ['cloudy', 'Cloudy'],
  ['changeable', 'Changeable'],
  ['drizzle', 'Drizzle'],
  ['rain', 'Rain'],
  ['storm', 'Storm'],
  ['snow', 'Snow'],
];
const TIMES: [string, string][] = [
  ['random', 'Random'],
  ['morning', 'Morning'],
  ['midday', 'Midday'],
  ['golden', 'Golden hour'],
  ['sunset', 'Sunset'],
  ['night', 'Night'],
];
const LAPS = [2, 3, 5, 8, 10, 15];
const AIS = [0, 3, 6, 9, 13, 19];
const DAMAGE: [LobbySettings['damage'], string][] = [
  ['full', 'Full'],
  ['visual', 'Cosmetic'],
  ['off', 'Off'],
];
const GRIDS: [LobbySettings['grid'], string][] = [
  ['random', 'Shuffled'],
  ['back', 'Players at the back'],
];
const QUICK = ['Nice move!', 'Sorry!', 'GG', "Let's go!"];
const NAME_KEY = 'apexgp.online.name';
const TEAM_KEY = 'apexgp.online.team';
const SET_KEY = 'apexgp.online.settings';

const DEFAULTS: LobbySettings = { track: 'monza', laps: 3, ai: 6, level: 1, weather: 'random', time: 'random', contact: true, damage: 'visual', grid: 'random' };

export interface OnlineHooks {
  /** travel to the circuit; resolves true once its world is ready */
  travel(track: string): Promise<boolean>;
  /** build and start the race (the short intro; the lights wait for `lightsDue`) */
  begin(cfg: RaceConfig, me: string): Race | null;
  /** leave the race for the garage */
  end(): void;
  ui(k: 'move' | 'select' | 'back'): void;
  rig(e: Entry): THREE.Object3D | null;
  camera: THREE.PerspectiveCamera;
  /** the circuit the garage is at now */
  currentTrack(): string;
}

type Screen = 'off' | 'entry' | 'lobby' | 'loading' | 'race';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement | null, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}
function load<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? { ...d, ...JSON.parse(v) } : d;
  } catch {
    return d;
  }
}
function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const teamOf = (i: number) => TEAMS[((i % TEAMS.length) + TEAMS.length) % TEAMS.length];

export class Online {
  screen: Screen = 'off';
  private host: RaceHost | null = null;
  private guest: RaceGuest | null = null;
  /** 'host', or the guest's peer id */
  me = '';
  name: string;
  team: number;
  members: Member[] = [];
  settings: LobbySettings;
  /** the host says a race is running (a guest who joins mid-race waits for the next) */
  racing = false;
  cfg: RaceConfig | null = null;
  race: Race | null = null;
  sync: RaceSync | null = null;
  /** lights: start at session time `startAt`, out `hold` s after the fifth */
  startAt = Infinity;
  hold = 1;
  private loaded = new Set<string>();
  private loadedSelf = false;
  private pendingStart: { at: number; hold: number } | null = null;
  private loadTimer = 0;
  private raceSeq = 0;
  private names = new Map<Driver, { code: string; first: string; last: string }>();
  private error = '';
  private chatLog: { from: string; text: string; t: number }[] = [];

  readonly root: HTMLElement;
  private panel: HTMLElement;
  private hudEl: HTMLElement;
  private feed: HTMLElement;
  private chip: HTMLElement;
  private tags = new Map<number, HTMLElement>();
  private readonly v = new THREE.Vector3();

  constructor(
    uiRoot: HTMLElement,
    readonly hooks: OnlineHooks,
  ) {
    this.name = (() => {
      try {
        return localStorage.getItem(NAME_KEY) ?? '';
      } catch {
        return '';
      }
    })();
    this.team = load(TEAM_KEY, { t: Math.floor(Math.random() * TEAMS.length) }).t;
    this.settings = load(SET_KEY, DEFAULTS);
    this.root = el('div', 'ol-root', document.body);
    this.panel = el('div', 'ol-panel', this.root);
    // (typing in the room's fields must not drive the car or the garage menu)
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && this.screen === 'entry') this.leave();
    });
    this.root.addEventListener('keyup', (e) => e.stopPropagation());
    this.hudEl = el('div', 'ol-hud', uiRoot);
    this.feed = el('div', 'ol-feed', this.hudEl);
    this.chip = el('div', 'ol-chip', this.hudEl);
    addEventListener('keydown', (e) => {
      if (this.screen !== 'race' || e.repeat) return;
      const k = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (k >= 0) this.chat(QUICK[k]);
    });
  }

  get open() {
    return this.screen === 'entry' || this.screen === 'lobby' || this.screen === 'loading';
  }
  get inRace() {
    return this.screen === 'race' && !!this.race;
  }
  get isHost() {
    return !!this.host;
  }
  get connected() {
    return !!this.host || !!this.guest;
  }
  get code() {
    return this.host?.code ?? this.guest?.code.toUpperCase() ?? '';
  }
  now() {
    return this.host ? this.host.now() : this.guest ? this.guest.now() : performance.now() / 1000;
  }
  lightsDue() {
    return this.now() >= this.startAt;
  }

  // ------------------------------------------------------------------ opening / rooms

  /** open the online screen (from the garage), or straight into a room with `join` */
  show(join?: string) {
    if (this.connected) {
      this.setScreen(this.screen === 'race' ? 'race' : 'lobby');
      return;
    }
    this.setScreen('entry');
    if (join) this.joinRoom(join);
  }

  private setScreen(s: Screen) {
    this.screen = s;
    this.root.classList.toggle('on', this.open);
    this.hudEl.classList.toggle('on', s === 'race');
    this.render();
  }

  private saveMe() {
    try {
      localStorage.setItem(NAME_KEY, this.name);
      localStorage.setItem(TEAM_KEY, JSON.stringify({ t: this.team }));
    } catch {
      /* private mode */
    }
  }

  private cleanName(): string {
    return (this.name.trim() || 'Driver').slice(0, 14);
  }

  createRoom() {
    this.saveMe();
    this.error = '';
    const h = (this.host = new RaceHost());
    this.me = 'host';
    this.members = [{ id: 'host', name: this.cleanName(), team: this.team, ready: true, ping: 0 }];
    h.onOpen = () => this.render();
    h.onError = (e) => {
      this.closeNet();
      if (e === 'taken') return this.createRoom();
      this.error = 'Could not open a room (network trouble). Try again.';
      this.setScreen('entry');
    };
    h.onJoin = () => {};
    h.onCtl = (from, m) => this.hostCtl(from, m);
    h.onState = (_from, b) => this.sync?.receive(b);
    h.onLeave = (id) => this.memberLeft(id);
    this.setScreen('lobby');
    this.pushUrl();
  }

  joinRoom(code: string) {
    code = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      this.error = 'Room codes are 4 letters.';
      this.render();
      return;
    }
    this.saveMe();
    this.error = '';
    const g = (this.guest = new RaceGuest(code, { name: this.cleanName(), team: this.team }));
    this.render('Joining room ' + code + '…');
    g.onCtl = (m) => this.guestCtl(m);
    g.onState = (b) => this.sync?.receive(b);
    g.onClose = (why) => {
      const wasRace = this.screen === 'race';
      this.guest = null;
      this.endRace();
      this.members = [];
      this.error = why || 'Disconnected.';
      if (wasRace) this.hooks.end();
      this.setScreen('entry');
      this.pushUrl();
    };
  }

  /** leave the room altogether */
  leave() {
    const wasRace = this.screen === 'race';
    this.closeNet();
    this.endRace();
    this.members = [];
    if (wasRace) this.hooks.end();
    this.setScreen('off');
    this.pushUrl();
  }

  private closeNet() {
    this.host?.close();
    this.guest?.close();
    this.host = null;
    this.guest = null;
  }

  private pushUrl() {
    const u = new URL(location.href);
    if (this.code) u.searchParams.set('join', this.code);
    else u.searchParams.delete('join');
    history.replaceState(null, '', u);
  }

  inviteLink() {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('join', this.code);
    return u.toString();
  }

  // ------------------------------------------------------------------ host

  private hostCtl(from: string, m: CtlMsg) {
    const h = this.host!;
    if (m.t === 'hello') {
      if (this.members.length >= MAX_PLAYERS) return h.kick(from, 'That room is full.');
      this.members = this.members.filter((x) => x.id !== from);
      this.members.push({ id: from, name: (m.name || 'Driver').slice(0, 14), team: m.team | 0, ready: false, ping: 0, busy: this.racing });
      h.send(from, { t: 'welcome', id: from, members: this.members, settings: this.settings, racing: this.racing });
      this.note(`${m.name || 'Driver'} joined`);
      this.hostMembers();
    } else if (m.t === 'me') {
      const x = this.members.find((y) => y.id === from);
      if (!x) return;
      if (m.name !== undefined) x.name = m.name.slice(0, 14) || 'Driver';
      if (m.team !== undefined) x.team = m.team | 0;
      if (m.ready !== undefined) x.ready = m.ready;
      if (m.busy !== undefined) x.busy = m.busy;
      this.hostMembers();
    } else if (m.t === 'loaded') {
      if (this.cfg && m.raceId === this.cfg.raceId) {
        this.loaded.add(from);
        this.checkLoaded();
        this.render();
      }
    } else if (m.t === 'chat') {
      const x = this.members.find((y) => y.id === from);
      const msg: CtlMsg = { t: 'chat', from: x?.name ?? 'Driver', text: m.text.slice(0, 80) };
      h.broadcast(msg, from);
      this.addChat(msg.from, msg.text);
    }
  }

  private hostMembers() {
    const h = this.host;
    if (!h) return;
    for (const x of this.members) if (x.id !== 'host') x.ping = Math.round(h.pingOf(x.id));
    h.broadcast({ t: 'members', members: this.members, settings: this.settings, racing: this.racing });
    this.render();
  }

  private memberLeft(id: string) {
    const x = this.members.find((y) => y.id === id);
    this.members = this.members.filter((y) => y.id !== id);
    if (x) this.note(`${x.name} left`);
    this.dropCar(id);
    this.loaded.delete(id);
    if (this.screen === 'loading') this.checkLoaded();
    this.hostMembers();
  }

  /** a player gone mid-race: their car is out */
  private dropCar(owner: string) {
    if (!this.race || !this.cfg) return;
    this.cfg.grid.forEach((g, i) => {
      if (g.owner !== owner) return;
      const c = this.race!.cars.find((c) => c.entry === this.entryAt(i));
      if (!c || !c.remote) return;
      c.retired = true;
      c.removed = true;
      const r = this.hooks.rig(c.entry);
      if (r) r.visible = false;
    });
  }

  setSetting<K extends keyof LobbySettings>(k: K, v: LobbySettings[K]) {
    if (!this.host) return;
    this.settings[k] = v;
    try {
      localStorage.setItem(SET_KEY, JSON.stringify(this.settings));
    } catch {
      /* private mode */
    }
    this.hostMembers();
  }

  private buildGrid(): GridSlot[] {
    const humans = this.members.slice();
    const taken = new Set<string>();
    const slots: GridSlot[] = [];
    for (const m of humans) {
      let placed = false;
      for (let k = 0; k < TEAMS.length && !placed; k++) {
        const t = (((m.team + k) % TEAMS.length) + TEAMS.length) % TEAMS.length;
        for (const seat of [0, 1] as const) {
          const key = `${t}/${seat}`;
          if (taken.has(key)) continue;
          taken.add(key);
          slots.push({ team: t, seat, owner: m.id, name: m.name });
          placed = true;
          break;
        }
      }
    }
    const free: GridSlot[] = [];
    TEAMS.forEach((_, t) => ([0, 1] as const).forEach((seat) => !taken.has(`${t}/${seat}`) && free.push({ team: t, seat, owner: '', name: '' })));
    const ai = shuffle(free).slice(0, Math.max(0, Math.min(this.settings.ai, TEAMS.length * 2 - slots.length)));
    // (the AI by car: the quick ones at the front, with a little shuffle)
    ai.sort((a, b) => TEAMS[b.team].pace + Math.random() * 0.01 - (TEAMS[a.team].pace + Math.random() * 0.01));
    shuffle(slots);
    if (this.settings.grid === 'back') return [...ai, ...slots];
    // shuffled: the players spread through the AI field
    const out = ai.slice();
    for (const s of slots) out.splice(Math.floor(Math.random() * (out.length + 1)), 0, s);
    return out;
  }

  startRace() {
    const h = this.host;
    if (!h || this.screen !== 'lobby') return;
    const cfg: RaceConfig = {
      settings: { ...this.settings },
      grid: this.buildGrid(),
      seed: (Math.random() * 2 ** 31) | 0,
      formSeed: (Math.random() * 2 ** 31) | 0,
      wxSeed: (Math.random() * 2 ** 31) | 0,
      raceId: ++this.raceSeq,
      epoch: Math.floor(h.now()),
    };
    this.racing = true;
    for (const x of this.members) x.busy = true;
    h.broadcast({ t: 'load', cfg });
    this.hostMembers();
    this.loadTimer = window.setTimeout(() => this.sendStart(), 60000);
    void this.loadRace(cfg);
  }

  private checkLoaded() {
    if (!this.host || !this.cfg || this.screen !== 'loading' || !this.loadedSelf) return;
    const all = this.members.every((x) => x.id === 'host' || this.loaded.has(x.id));
    if (all) this.sendStart();
  }

  private sendStart() {
    clearTimeout(this.loadTimer);
    const h = this.host;
    if (!h || !this.cfg || this.screen !== 'loading') return;
    const msg = { t: 'start', raceId: this.cfg.raceId, at: h.now() + 4.5, hold: 0.6 + Math.random() * 2.2 } as const;
    h.broadcast(msg);
    this.go(msg.at, msg.hold);
  }

  /** the host scores the race for the room's standings (once): F1 points by place, players only */
  private scored = -1;
  private scoreRace() {
    const race = this.race, cfg = this.cfg;
    if (!this.host || !race || !cfg || this.scored === cfg.raceId || race.phase === 'grid' || race.phase === 'lights') return;
    this.scored = cfg.raceId;
    for (const r of race.classification()) {
      const g = cfg.grid.find((x) => x.owner && teamOf(x.team) === r.entry.team && x.seat === r.entry.seat);
      const m = g && this.members.find((x) => x.id === g.owner);
      if (!m || r.dnf) continue;
      m.points = (m.points ?? 0) + (POINTS[r.pos - 1] ?? 0);
      if (r.pos === 1) m.wins = (m.wins ?? 0) + 1;
    }
  }

  /** back to the lobby (host: ends the race for everyone) */
  toLobby() {
    if (this.host) {
      this.scoreRace();
      this.racing = false;
      for (const x of this.members) x.busy = false;
      this.host.broadcast({ t: 'lobby' });
    } else this.guest?.send({ t: 'me', busy: false, ready: false });
    const was = this.screen === 'race';
    this.endRace();
    if (was) this.hooks.end();
    this.setScreen(this.connected ? 'lobby' : 'off');
    if (this.host) this.hostMembers();
  }

  // ------------------------------------------------------------------ guest

  private guestCtl(m: CtlMsg) {
    if (m.t === 'welcome') {
      this.me = m.id;
      this.members = m.members;
      this.settings = m.settings;
      this.racing = m.racing;
      this.setScreen('lobby');
      this.pushUrl();
    } else if (m.t === 'members') {
      this.members = m.members;
      this.settings = m.settings;
      this.racing = m.racing;
      const mine = this.members.find((x) => x.id === this.me);
      if (mine) this.team = mine.team;
      if (this.open) this.render();
    } else if (m.t === 'load') {
      void this.loadRace(m.cfg);
    } else if (m.t === 'start') {
      if (!this.cfg || m.raceId !== this.cfg.raceId) return;
      if (this.loadedSelf) this.go(m.at, m.hold);
      else this.pendingStart = { at: m.at, hold: m.hold };
    } else if (m.t === 'chat') {
      this.addChat(m.from, m.text);
    } else if (m.t === 'lobby') {
      const was = this.screen === 'race';
      this.endRace();
      if (was) this.hooks.end();
      this.racing = false;
      this.setScreen('lobby');
      if (was) this.note('The host is back in the lobby');
    }
  }

  setMe(p: { name?: string; team?: number; ready?: boolean }) {
    if (p.name !== undefined) this.name = p.name;
    if (p.team !== undefined) this.team = ((p.team % TEAMS.length) + TEAMS.length) % TEAMS.length;
    this.saveMe();
    const mine = this.members.find((x) => x.id === this.me);
    if (mine) {
      if (p.name !== undefined) mine.name = this.cleanName();
      if (p.team !== undefined) mine.team = this.team;
      if (p.ready !== undefined) mine.ready = p.ready;
    }
    if (this.host) this.hostMembers();
    else this.guest?.send({ t: 'me', name: p.name !== undefined ? this.cleanName() : undefined, team: p.team !== undefined ? this.team : undefined, ready: p.ready });
    this.render();
  }

  // ------------------------------------------------------------------ the race

  private async loadRace(cfg: RaceConfig) {
    this.endRace();
    this.cfg = cfg;
    this.loaded.clear();
    this.loadedSelf = false;
    this.pendingStart = null;
    this.setScreen('loading');
    const ok = await this.hooks.travel(cfg.settings.track);
    if (this.cfg !== cfg) return;
    if (!ok) {
      this.error = 'Could not load the circuit.';
      return this.toLobby();
    }
    this.loadedSelf = true;
    if (this.guest) {
      this.guest.send({ t: 'loaded', raceId: cfg.raceId });
      const ps = this.pendingStart as { at: number; hold: number } | null;
      if (ps) this.go(ps.at, ps.hold);
      else this.render();
    } else this.checkLoaded();
  }

  /** the grid slot's entry (by the team's index; the seat) */
  entryAt(i: number): Entry {
    const g = this.cfg!.grid[i];
    const team = teamOf(g.team);
    return { team, driver: team.drivers[g.seat], seat: g.seat };
  }

  private go(at: number, hold: number) {
    const cfg = this.cfg;
    if (!cfg) return;
    this.startAt = at;
    this.hold = hold;
    // (names first: the timing tower is laid out when the race starts)
    this.applyNames(cfg);
    const race = this.hooks.begin(cfg, this.me);
    if (!race) {
      this.restoreNames();
      return this.toLobby();
    }
    this.race = race;
    // (the competitor ids are the race's own: map them to the grid slots by entry)
    const owners = race.cars.map((c) => {
      const i = cfg.grid.findIndex((g) => teamOf(g.team) === c.entry.team && g.seat === c.entry.seat);
      return i >= 0 ? cfg.grid[i].owner : '';
    });
    const sync = new RaceSync(race, {
      host: !!this.host,
      now: () => this.now(),
      epoch: cfg.epoch,
      owners,
      lightsAt: at,
      hold,
      send: (b) => {
        if (this.host) for (const id of this.host.guests.keys()) this.host.states(id, b);
        else this.guest?.state(b);
      },
    });
    this.sync = sync;
    race.net = sync;
    this.ahead.clear();
    this.setScreen('race');
    this.chip.innerHTML = '';
    for (const t of this.tags.values()) t.remove();
    this.tags.clear();
  }

  /** the players' names on the timing tower, the tags and the results (put back after) */
  private applyNames(cfg: RaceConfig) {
    this.restoreNames();
    cfg.grid.forEach((g) => {
      if (!g.owner) return;
      const name = this.members.find((x) => x.id === g.owner)?.name ?? g.name ?? 'Driver';
      const d = teamOf(g.team).drivers[g.seat];
      this.names.set(d, { code: d.code, first: d.first, last: d.last });
      const letters = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      d.code = (letters + 'XXX').slice(0, 3);
      d.first = '';
      d.last = name;
    });
  }
  private restoreNames() {
    for (const [d, n] of this.names) Object.assign(d, n);
    this.names.clear();
  }

  /** the race is over here (leaving it, or a new one) */
  private endRace() {
    if (this.race) this.race.net = null;
    this.race = null;
    this.sync = null;
    this.startAt = Infinity;
    this.restoreNames();
    for (const t of this.tags.values()) t.remove();
    this.tags.clear();
  }

  /** is this competitor another player (not AI)? */
  ownerOf(id: number): string {
    return this.sync?.o.owners[id] ?? '';
  }

  // ------------------------------------------------------------------ chat

  chat(text: string) {
    text = text.trim().slice(0, 80);
    if (!text) return;
    const from = this.cleanName();
    if (this.host) this.host.broadcast({ t: 'chat', from, text });
    else this.guest?.send({ t: 'chat', from, text });
    this.addChat(from, text);
  }
  private addChat(from: string, text: string) {
    this.chatLog.push({ from, text, t: performance.now() });
    if (this.chatLog.length > 40) this.chatLog.shift();
    this.hooks.ui('move');
    this.renderFeed();
    if (this.screen === 'lobby') this.renderChat();
  }
  private note(text: string) {
    this.addChat('', text);
  }

  // ------------------------------------------------------------------ in-race overlay

  /** each frame in a race: name tags over the other players' cars, the feed, the room chip */
  frame(live = true) {
    this.hudEl.classList.toggle('on', this.screen === 'race' && live);
    if (this.screen !== 'race' || !this.race || !live) return;
    const race = this.race;
    const cam = this.hooks.camera;
    const w = innerWidth, h = innerHeight;
    for (const c of race.cars) {
      const owner = this.ownerOf(c.id);
      let tag = this.tags.get(c.id);
      if (!owner || c.isPlayer || c.removed) {
        if (tag) tag.style.display = 'none';
        continue;
      }
      if (!tag) {
        tag = el('div', 'ol-tag', this.hudEl);
        tag.style.setProperty('--tc', uiColor(c.entry.team));
        this.tags.set(c.id, tag);
      }
      const rig = this.hooks.rig(c.entry);
      if (!rig) continue;
      this.v.copy(rig.position);
      this.v.y += 1.45;
      const d = this.v.distanceTo(cam.position);
      this.v.project(cam);
      if (this.v.z > 1 || d > 400 || d < 2.5) {
        tag.style.display = 'none';
        continue;
      }
      tag.style.display = '';
      const sc = THREE.MathUtils.clamp(26 / d, 0.55, 1.1);
      tag.style.transform = `translate(${((this.v.x + 1) / 2) * w}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -100%) scale(${sc.toFixed(3)})`;
      const txt = `<b>P${c.position}</b>${esc(c.entry.driver.last)}`;
      if (tag.dataset.t !== txt) {
        tag.dataset.t = txt;
        tag.innerHTML = txt;
      }
    }
    this.watchPasses(race);
    const ping = this.guest ? Math.round(this.guest.rtt * 1000) : 0;
    const chip = `<span class="dot"></span>Room <b>${this.code}</b>${this.guest ? ` · ${ping} ms` : ''} · <kbd>1</kbd>-<kbd>4</kbd> quick chat`;
    if (this.chip.dataset.t !== chip) {
      this.chip.dataset.t = chip;
      this.chip.innerHTML = chip;
    }
    // (old lines fade from the feed)
    const now = performance.now();
    if (this.feed.childElementCount && this.chatLog.length && now - this.chatLog[this.chatLog.length - 1].t > 9000 && !this.feed.classList.contains('old')) this.feed.classList.add('old');
  }

  /** were you ahead of each other player last frame? (a swap is a pass worth a shout) */
  private ahead = new Map<number, boolean>();
  private passCool = 0;
  private watchPasses(race: Race) {
    const me = race.player;
    const live = race.phase === 'racing' && race.raceTime > 4;
    for (const c of race.cars) {
      if (c.isPlayer || !this.ownerOf(c.id) || c.removed) continue;
      const a = me.position < c.position;
      const was = this.ahead.get(c.id);
      this.ahead.set(c.id, a);
      if (!live || was === undefined || was === a || c.retired || me.retired || c.finished || me.finished) continue;
      if (performance.now() < this.passCool) continue;
      this.passCool = performance.now() + 1500;
      this.toast(a ? `You passed <b>${esc(c.entry.driver.last)}</b>` : `<b>${esc(c.entry.driver.last)}</b> passed you`, a ? 'up' : 'down', uiColor(c.entry.team));
      this.hooks.ui(a ? 'select' : 'back');
    }
  }
  private toastEl: HTMLElement | null = null;
  private toastT = 0;
  private toast(html: string, kind: string, color: string) {
    this.toastEl?.remove();
    const t = (this.toastEl = el('div', `ol-toast ${kind}`, this.hudEl, html));
    t.style.setProperty('--tc', color);
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.add('out'), 2200);
  }

  private renderFeed() {
    const now = performance.now();
    this.feed.classList.remove('old');
    this.feed.innerHTML = this.chatLog
      .filter((m) => now - m.t < 9000)
      .slice(-5)
      .map((m) => (m.from ? `<div><b>${esc(m.from)}</b> ${esc(m.text)}</div>` : `<div class="sys">${esc(m.text)}</div>`))
      .join('');
  }

  // ------------------------------------------------------------------ the room screens

  private render(status?: string) {
    const p = this.panel;
    if (!this.open) return;
    p.innerHTML = '';
    if (this.screen === 'entry') this.renderEntry(p, status);
    else if (this.screen === 'lobby') this.renderLobby(p);
    else if (this.screen === 'loading') this.renderLoading(p);
  }

  private btn(parent: HTMLElement, label: string, cls: string, fn: () => void, disabled = false) {
    const b = el('button', 'ol-btn ' + cls, parent, label);
    b.disabled = disabled;
    b.addEventListener('click', () => {
      this.hooks.ui('select');
      fn();
    });
    return b;
  }

  private renderEntry(p: HTMLElement, status?: string) {
    el('div', 'ol-eyebrow', p, 'Online');
    el('h1', 'ol-title', p, 'Race your friends');
    el('p', 'ol-lede', p, 'Open a room, send the link, and go wheel to wheel. Up to 12 players, with AI cars to fill the grid if you want them.');
    const nm = el('label', 'ol-field', p, '<span>Your name</span>');
    const ni = el('input', '', nm);
    ni.maxLength = 14;
    ni.placeholder = 'Driver';
    ni.value = this.name;
    ni.addEventListener('input', () => (this.name = ni.value));
    const row = el('div', 'ol-actions', p);
    this.btn(row, 'Create a room', 'primary', () => this.createRoom(), !!this.guest);
    const join = el('div', 'ol-join', p);
    const ci = el('input', '', join);
    ci.maxLength = 4;
    ci.placeholder = 'CODE';
    ci.autocapitalize = 'characters';
    ci.addEventListener('keydown', (e) => e.key === 'Enter' && this.joinRoom(ci.value));
    this.btn(join, 'Join', '', () => this.joinRoom(ci.value), !!this.guest);
    if (status || this.error) el('div', 'ol-status' + (this.error && !status ? ' err' : ''), p, esc(status ?? this.error));
    this.btn(el('div', 'ol-foot', p), 'Back to the garage', 'ghost', () => this.leave());
    if (!this.name) ni.focus();
  }

  private renderLobby(p: HTMLElement) {
    const host = !!this.host;
    const head = el('div', 'ol-head', p);
    const left = el('div', '', head);
    el('div', 'ol-eyebrow', left, host ? 'Your room' : 'Room');
    el('div', 'ol-code', left, this.code || '····');
    const share = el('div', 'ol-share', head);
    const copy = this.btn(share, 'Copy invite link', 'primary', () => {
      void navigator.clipboard?.writeText(this.inviteLink()).then(
        () => (copy.textContent = 'Link copied'),
        () => (copy.textContent = this.inviteLink()),
      );
    });
    el('div', 'ol-hint', share, host && !this.host?.peer.open ? 'Opening the room…' : 'Friends open the link, or enter the code under Online.');

    const body = el('div', 'ol-body', p);
    // ---- the players
    const col1 = el('div', 'ol-col', body);
    el('div', 'ol-sub', col1, `Drivers · ${this.members.length}/${MAX_PLAYERS}`);
    const list = el('div', 'ol-list', col1);
    for (const m of this.members) {
      const t = teamOf(m.team);
      const r = el('div', 'ol-member' + (m.id === this.me ? ' me' : ''), list);
      r.style.setProperty('--tc', uiColor(t));
      el('span', 'bar', r);
      el('span', 'nm', r, `${esc(m.name)}${m.id === 'host' ? '<i>host</i>' : ''}`);
      el('span', 'tm', r, `${m.points ? `<b>${m.points}</b> pts${m.wins ? ` · ${m.wins}W` : ''} · ` : ''}${esc(t.short)}`);
      el('span', 'st' + (m.ready || m.id === 'host' ? ' ok' : ''), r, m.busy ? 'racing' : m.id === 'host' ? (m.ping ? `${m.ping} ms` : '') : m.ready ? 'ready' : 'not ready');
    }
    if (!host && this.racing) el('div', 'ol-status', col1, 'A race is on. You are in for the next one.');
    // ---- my car
    el('div', 'ol-sub', col1, 'Your car');
    const t = teamOf(this.team);
    const car = el('div', 'ol-car', col1);
    car.style.setProperty('--tc', uiColor(t));
    car.style.setProperty('--t1', t.primary);
    car.style.setProperty('--t2', t.secondary);
    this.btn(car, '‹', 'arrow', () => this.setMe({ team: this.team - 1 }));
    el('div', 'sw', car, `<span class="chip"></span><b>${esc(t.name)}</b>`);
    this.btn(car, '›', 'arrow', () => this.setMe({ team: this.team + 1 }));
    const nm = el('label', 'ol-field small', col1, '<span>Name</span>');
    const ni = el('input', '', nm);
    ni.maxLength = 14;
    ni.value = this.name;
    ni.addEventListener('change', () => this.setMe({ name: ni.value }));

    // ---- the race
    const col2 = el('div', 'ol-col', body);
    el('div', 'ol-sub', col2, host ? 'The race · you pick' : 'The race · the host picks');
    const s = this.settings;
    const cd = ALL_CIRCUITS.find((c) => c.id === s.track) ?? ALL_CIRCUITS[0];
    const opt = (label: string, value: string, change: (d: number) => void) => {
      const r = el('div', 'ol-opt', col2);
      el('span', 'k', r, label);
      if (host) this.btn(r, '‹', 'arrow', () => change(-1));
      el('span', 'v', r, esc(value));
      if (host) this.btn(r, '›', 'arrow', () => change(1));
    };
    const step = <T>(arr: T[], cur: T, d: number) => arr[(((arr.indexOf(cur) + d) % arr.length) + arr.length) % arr.length] ?? arr[0];
    opt('Circuit', cd.name, (d) => this.setSetting('track', step(ALL_CIRCUITS.map((c) => c.id), s.track, d)));
    opt('Laps', String(s.laps), (d) => this.setSetting('laps', step(LAPS, s.laps, d)));
    opt('AI cars', s.ai ? String(Math.min(s.ai, TEAMS.length * 2 - this.members.length)) : 'None', (d) => this.setSetting('ai', step(AIS, s.ai, d)));
    if (s.ai) opt('AI level', AI_LEVELS[s.level]?.label ?? 'Pro', (d) => this.setSetting('level', (s.level + d + AI_LEVELS.length) % AI_LEVELS.length));
    opt('Grid', GRIDS.find((g) => g[0] === s.grid)?.[1] ?? 'Shuffled', (d) => this.setSetting('grid', step(GRIDS.map((g) => g[0]), s.grid, d)));
    opt('Weather', WEATHERS.find((w) => w[0] === s.weather)?.[1] ?? 'Random', (d) => this.setSetting('weather', step(WEATHERS.map((w) => w[0]), s.weather, d)));
    opt('Time of day', TIMES.find((w) => w[0] === s.time)?.[1] ?? 'Random', (d) => this.setSetting('time', step(TIMES.map((w) => w[0]), s.time, d)));
    opt('Contact', s.contact ? 'On (rubbing is racing)' : 'Ghost cars', () => this.setSetting('contact', !s.contact));
    opt('Damage', DAMAGE.find((x) => x[0] === s.damage)?.[1] ?? 'Cosmetic', (d) => this.setSetting('damage', step(DAMAGE.map((x) => x[0]), s.damage, d)));

    // ---- chat
    const col3 = el('div', 'ol-col chat', body);
    el('div', 'ol-sub', col3, 'Chat');
    el('div', 'ol-chat', col3);
    const ci = el('input', 'ol-chatin', col3);
    ci.placeholder = 'Say something…';
    ci.maxLength = 80;
    ci.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      this.chat(ci.value);
      ci.value = '';
    });
    this.renderChat();

    // ---- go
    const foot = el('div', 'ol-foot', p);
    this.btn(foot, 'Leave room', 'ghost', () => this.leave());
    if (host) {
      const waiting = this.members.filter((m) => m.id !== 'host' && !m.ready).length;
      this.btn(foot, waiting ? `Start race (${waiting} not ready)` : 'Start race', 'primary big', () => this.startRace(), !this.host?.peer.open);
    } else {
      const mine = this.members.find((m) => m.id === this.me);
      this.btn(foot, mine?.ready ? 'Ready ✓' : 'Ready up', 'primary big' + (mine?.ready ? ' on' : ''), () => this.setMe({ ready: !mine?.ready }));
    }
  }

  private renderChat() {
    const box = this.panel.querySelector('.ol-chat');
    if (!box) return;
    box.innerHTML = this.chatLog
      .slice(-30)
      .map((m) => (m.from ? `<div><b>${esc(m.from)}</b> ${esc(m.text)}</div>` : `<div class="sys">${esc(m.text)}</div>`))
      .join('');
    box.scrollTop = box.scrollHeight;
  }

  private renderLoading(p: HTMLElement) {
    const cfg = this.cfg;
    const cd = ALL_CIRCUITS.find((c) => c.id === cfg?.settings.track);
    el('div', 'ol-eyebrow', p, `Room ${this.code}`);
    el('h1', 'ol-title', p, `Heading to ${esc(cd?.name ?? 'the circuit')}`);
    el('p', 'ol-lede', p, `${cfg?.settings.laps ?? 0} laps · everyone loads the circuit, then the lights go out together.`);
    const list = el('div', 'ol-list', p);
    for (const m of this.members) {
      const done = m.id === this.me ? this.loadedSelf : this.host ? m.id === 'host' || this.loaded.has(m.id) : false;
      const r = el('div', 'ol-member', list);
      r.style.setProperty('--tc', uiColor(teamOf(m.team)));
      el('span', 'bar', r);
      el('span', 'nm', r, esc(m.name));
      el('span', 'st' + (done ? ' ok' : ''), r, done ? 'ready' : this.host || m.id === this.me ? 'loading…' : '');
    }
    el('div', 'ol-spin', p);
  }

  /** dev/test: the room's state */
  debug() {
    return { screen: this.screen, code: this.code, me: this.me, members: this.members, racing: this.racing, startAt: this.startAt, now: this.now(), cars: this.race?.cars.map((c) => ({ id: c.id, remote: c.remote, player: c.isPlayer, s: c.car.s, laps: c.laps, pos: c.position, code: c.entry.driver.code })) };
  }
}
