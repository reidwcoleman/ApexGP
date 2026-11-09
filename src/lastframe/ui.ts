import './ui.css';
import type { Game } from './game.ts';
import { Guest_, Host, makeCode, type Down } from './net.ts';
import { PRIMARIES, TEAM_NAME, WEAPONS, ZONE_NAME, fmtClock, type Ev, type MatchConfig, type Mode, type PlayerInfo, type Req, type WeaponId } from './shared.ts';
import type * as THREE from 'three';
import { BASE, DEFAULT_MAP, MAP_ID } from './world.ts';

const MODES: { id: Mode; name: string; note: string; limit: number }[] = [
  { id: 'tdm', name: 'Team Fight', note: 'First side to 40 kills. Respawns on.', limit: 40 },
  { id: 'rounds', name: 'Last Team Standing', note: 'One life a round. First to 5.', limit: 5 },
  { id: 'hold', name: 'Hold Ground', note: 'Keep the zone. First to 150. It moves.', limit: 150 },
  { id: 'ffa', name: 'Free For All', note: 'Everyone against everyone. First to 20.', limit: 20 },
];
const MAPS: { id: string; name: string; note: string }[] = [
  { id: 'ward', name: 'Ashgrove Ward', note: 'Condemned hospital. Long wards, tight halls.' },
  { id: 'mansion', name: 'Harrowgate House', note: 'Abandoned manor. Ballroom, cellars, two floors.' },
  { id: 'motel', name: 'Pinewood Motor Inn', note: 'Shut motel. Galleries, a pool hall, the diner.' },
  { id: 'block', name: 'Kessler Block', note: 'Tenements. Stairwells, flats, a freight hall.' },
  { id: 'trenches', name: 'The Trenches', note: 'Two lines, the wire, star shells over no man\'s land.' },
];
const HERE = MAPS.find((x) => x.id === MAP_ID) ?? MAPS[0];
const thumb = (id: string) => `${BASE}thumbs/${id}.webp`;
const KEYS: [string, string][] = [['WASD', 'Move'], ['Shift', 'Run'], ['Left click', 'Fire'], ['Right click', 'Aim'], ['C', 'Crouch, slide'], ['Space', 'Jump, climb'], ['Q E', 'Lean'], ['R', 'Reload'], ['F', 'Door, take gun'], ['Z', 'Kick'], ['H', 'Bandage'], ['T', 'Weapon light'], ['G', 'Frag'], ['V', 'Flash'], ['1 2', 'Swap'], ['Tab', 'Case sheet']];
interface Case { id: string; at: number; mode: Mode; won: number; line: string; k: number; d: number; len: number; marks: [number, number][] }
const SKILL = [['Rookie', 0.2], ['Regular', 0.5], ['Veteran', 0.85]] as const;

const store = {
  get(k: string, d: string) {
    try {
      return localStorage.getItem('lastframe.' + k) ?? d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem('lastframe.' + k, v);
    } catch {
      /* private window */
    }
  },
};

const el = <K extends keyof HTMLElementTagNameMap>(t: K, c = '', h = '') => {
  const e = document.createElement(t);
  e.className = c;
  if (h) e.innerHTML = h;
  return e;
};
const pad2 = (n: number) => String(n).padStart(2, '0');
/** the way body cameras burn the time in: date, T, local time, the offset from UTC */
const tz = (d: Date) => {
  const o = -d.getTimezoneOffset();
  return `${o < 0 ? '-' : '+'}${pad2(Math.floor(Math.abs(o) / 60))}${pad2(Math.abs(o) % 60)}`;
};
const stampNow = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${tz(d)}`;
const scrub = (marks: [number, number][], len: number) => `<div class="scrub"><i></i>${marks.map(([t, k]) => `<u class="${k ? '' : 'dn'}" style="left:${((t / Math.max(1, len)) * 100).toFixed(2)}%"></u>`).join('')}</div>`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Hud {
  root = document.getElementById('ui')!;
  private stamp = el('div', 'stamp');
  private hudEl = el('div', 'hud');
  private feedEl = el('div', 'feed');
  private center = el('div', 'center');
  private promptEl = el('div', 'prompt');
  private ammo = el('div', 'ammo');
  private ammoT = 0;
  private hp = el('div', 'hp', '<i></i>');
  private wounds = el('div', 'wounds');
  private vitals = el('div', 'vitals');
  private healBar = el('div', 'heal', '<i></i>');
  private top = el('div', 'topline');
  private boardEl = el('div', 'board');
  private lostEl = el('div', 'lost');
  private scope = el('div', 'scope');
  private dmgEl = el('div', 'dmg');
  private menu = el('div', 'menu');
  private pauseEl = el('div', 'pause');
  private toastEl = el('div', 'toast');
  private hpT = 0;
  private lastHp = 100;
  private hint = el('div', 'hint', KEYS.map(([k, a]) => `<div><b>${k}</b>${a}</div>`).join(''));
  private tick = el('div', 'tick');
  private roster: PlayerInfo[] = [];
  private unit = String(1000 + Math.floor(Math.random() * 8999));
  private msgT = 0;
  private hintT = 0;
  private tickT = 0;
  private dmgT = 0;
  private tagBox = el('div', 'mates');
  private tags: HTMLElement[] = [];
  private mateList: { x: number; y: number; name: string }[] = [];
  private holdInfo = '';
  private fpsV = 0;
  private name = store.get('name', '');
  private primary = store.get('primary', 'carbine') as WeaponId;
  private team = Number(store.get('team', '0'));
  private mode = (store.get('mode', 'tdm') as Mode);
  private bots = Number(store.get('teamsize', '8'));
  private skill = Number(store.get('skill', '1'));
  private code = '';
  private host: Host | null = null;
  private guest: Guest_ | null = null;
  private lobbyPlayers: { id: string; name: string; team: number; primary: WeaponId }[] = [];
  private caseId = '';
  /** the report for this case is filed */
  private closed = false;
  private startedAt = 0;
  private marks: [number, number][] = [];
  private heads = 0;
  private far = 0;
  private sheet = el('div', 'sheet');
  private shTop = el('div', 'sh-top');
  private report = el('div', 'report');
  private tables = el('div', 'sh-tables');
  private shActs = el('div', 'sh-acts');

  constructor(private g: Game) {
    this.vitals.append(this.wounds, this.hp);
    this.hudEl.append(this.tagBox, this.stamp, this.top, this.feedEl, this.center, this.promptEl, this.healBar, this.ammo, this.vitals, this.tick, this.dmgEl, this.scope, this.hint);
    this.sheet.append(this.shTop, this.report, this.tables, this.shActs);
    this.boardEl.append(this.sheet);
    this.root.append(this.hudEl, this.boardEl, this.lostEl, this.pauseEl, this.menu, this.toastEl);
    this.hudEl.style.display = 'none';
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && g.inMatch && !document.pointerLockElement && !g.autoInput) this.resume();
    });
    document.addEventListener('pointerlockchange', () => {
      if (g.inMatch && !document.pointerLockElement && !g.autoInput) this.pause();
      else this.pauseEl.classList.remove('on');
    });
    g.r.domElement.addEventListener('click', () => {
      if (g.inMatch && !document.pointerLockElement) g.lock();
    });
    window.setInterval(() => {
      const e = this.menu.querySelector('[data-now]');
      if (e) e.textContent = stampNow();
    }, 1000);
  }

  private cases(): Case[] {
    try {
      return JSON.parse(store.get('cases', '[]')) as Case[];
    } catch {
      return [];
    }
  }

  private nextCase() {
    const n = Number(store.get('caseno', '411')) + 1;
    store.set('caseno', String(n));
    this.caseId = `${String(new Date().getFullYear()).slice(2)}-${String(n).padStart(4, '0')}`;
    this.closed = false;
  }

  ready() {
    const j = new URLSearchParams(location.search).get('join');
    this.home();
    const again = new URLSearchParams(location.search).get('setup');
    if (again === 'solo' || again === 'host') this.setup(again);
    if (j) this.joinFlow(j.toUpperCase());
  }

  /** the location loading behind the menu: every load line on screen follows it */
  loading(f: number, what: string) {
    const done = f >= 1;
    this.menu.querySelectorAll<HTMLElement>('.viewer').forEach((v) => v.classList.toggle('live', done));
    this.menu.querySelectorAll<HTMLElement>('[data-load]').forEach((e) => {
      (e.querySelector('[data-pct]') as HTMLElement).textContent = `${Math.round(f * 100)}%`;
      (e.querySelector('i') as HTMLElement).style.transform = `scaleX(${f})`;
      e.title = what;
    });
    this.menu.querySelectorAll<HTMLElement>('button.waiting').forEach((b) => {
      b.style.setProperty('--f', String(f));
    });
  }

  /** a start that has to wait for the location: the button says so and fills, and goes when it can */
  private whenLoaded(b: HTMLButtonElement, go: () => void) {
    if (this.g.loaded) return go();
    if (b.classList.contains('waiting')) return;
    b.classList.add('waiting');
    b.style.setProperty('--f', String(this.g.loadF));
    b.innerHTML = `<span>Loading the location</span><kbd>starts when ready</kbd>`;
    void this.g.whenReady.then(() => {
      if (b.isConnected) go();
    });
  }

  // ---------------------------------------------------------------- menus
  /** the live picture beside the rail, stamped like the camera, on a transport from the last case */
  private viewer() {
    const last = this.cases()[0];
    const live = this.g.loaded;
    return `<div class="viewer${live ? ' live' : ''}">
      <div class="still" style="background-image:url('${thumb(MAP_ID)}')"></div>
      <div class="ldg" data-load><span>Loading ${esc(HERE.name)}</span><b class="num" data-pct>${Math.round(this.g.loadF * 100)}%</b><i style="transform:scaleX(${this.g.loadF})"></i></div>
      <div class="stamp"><span data-now>${stampNow()}</span><br>LF BODY 4 &nbsp;X${this.unit}0${this.unit.slice(-3)} &nbsp;<span class="rec">REC</span></div>
      <div class="transport"><span>${last ? `CASE ${last.id}` : 'NO FOOTAGE'}</span>${scrub(last?.marks ?? [], last?.len ?? 1)}<span>${last ? fmtClock(last.len) : '0:00'}</span></div>
    </div>`;
  }

  private home() {
    const m = this.menu;
    m.className = 'menu on';
    const log = this.cases().slice(0, 3);
    m.innerHTML = `<div class="rail">
        <div class="mast"><i class="dot"></i>REC<span class="sp">Evidence console</span></div>
        <div><h1>Last<br>Frame</h1><p class="tag">Everything you see is what the camera saw.</p></div>
        <button class="loc" id="m-loc" aria-label="Change location"><img src="${thumb(MAP_ID)}" alt=""><span class="loc-t"><small>Location</small><b>${esc(HERE.name)}</b><em>${esc(HERE.note)}</em></span><span class="loc-c">Change</span></button>
        <label class="field"><span>Callsign</span><input id="m-name" maxlength="14" spellcheck="false" autocomplete="off" placeholder="Your name" value="${esc(this.name)}"></label>
        <div class="acts">
          <button class="primary" id="m-solo">Start a case<kbd>vs bots</kbd></button>
          <button id="m-host">Open a room</button>
          <div class="join"><input id="m-code" maxlength="4" placeholder="CODE" aria-label="Room code" spellcheck="false" autocomplete="off"><button id="m-join">Join</button></div>
        </div>
        <div class="group log push"><div class="lab">Case log</div>${log.length ? log.map((c) => `<div class="r"><b>${esc(c.line)}</b><span class="num">${c.k} / ${c.d}</span><small>${c.id}</small><span class="num">${MODES.find((x) => x.id === c.mode)?.name ?? ''}</span></div>`).join('') : '<div class="none">Nothing on file. Your matches land here.</div>'}</div>
      </div>${this.viewer()}`;
    const name = m.querySelector('#m-name') as HTMLInputElement;
    const remember = () => {
      this.name = name.value.trim().slice(0, 14) || 'Officer';
      store.set('name', name.value.trim());
    };
    m.querySelector('#m-solo')!.addEventListener('click', () => {
      remember();
      this.setup('solo');
    });
    m.querySelector('#m-loc')!.addEventListener('click', () => {
      remember();
      this.setup('solo');
    });
    m.querySelector('#m-host')!.addEventListener('click', () => {
      remember();
      this.setup('host');
    });
    const code = m.querySelector('#m-code') as HTMLInputElement;
    code.addEventListener('input', () => (code.value = code.value.toUpperCase()));
    const go = () => {
      remember();
      if (code.value.trim().length === 4) this.joinFlow(code.value.trim());
      else this.toast('Enter the 4-letter room code');
    };
    m.querySelector('#m-join')!.addEventListener('click', go);
    code.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  }

  private seg(id: string, items: [string, string][], cur: string) {
    return `<div class="seg" data-seg="${id}">${items.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'sel' : ''}">${l}</button>`).join('')}</div>`;
  }

  private pickers(kind: 'solo' | 'host') {
    return `
      <div class="group"><div class="lab">Mode</div><div class="list" data-seg="mode">${MODES.map((x) => `<button data-v="${x.id}" class="${x.id === this.mode ? 'sel' : ''}"><b>${x.name}</b><span>${x.note}</span></button>`).join('')}</div></div>
      <div class="two">
        <div class="group"><div class="lab">${this.mode === 'ffa' ? 'Players' : 'Team size'}</div>${this.seg('bots', [['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8']], String(this.bots))}</div>
        <div class="group"><div class="lab">Bots</div>${this.seg('skill', SKILL.map(([l], i) => [String(i), l]), String(this.skill))}</div>
      </div>
      ${kind === 'solo' ? `<div class="group"><div class="lab">Side</div>${this.seg('team', [['0', TEAM_NAME[0]], ['1', TEAM_NAME[1]]], String(this.team))}</div>` : ''}`;
  }

  private loadout() {
    const stat = (w: WeaponId) => {
      const q = WEAPONS[w];
      return `${q.pellets > 1 ? `${q.dmg}x${q.pellets}` : q.dmg} dmg &nbsp;${Math.round(60 / q.cycle)} rpm &nbsp;${q.mag} rounds`;
    };
    return `<div class="group"><div class="lab">Weapon</div><div class="list" data-seg="primary">${PRIMARIES.map((w) => `<button data-v="${w}" class="${w === this.primary ? 'sel' : ''}"><b>${WEAPONS[w].name}</b><span class="num">${stat(w)}</span></button>`).join('')}</div></div>`;
  }

  private bind(root: HTMLElement, after: () => void = () => {}) {
    root.querySelectorAll<HTMLElement>('[data-seg]').forEach((s) => {
      s.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        const v = b.dataset.v!;
        const id = s.dataset.seg!;
        s.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
        if (id === 'mode') this.mode = v as Mode;
        if (id === 'bots') this.bots = Number(v);
        if (id === 'skill') this.skill = Number(v);
        if (id === 'team') this.team = Number(v);
        if (id === 'primary') this.primary = v as WeaponId;
        if (id === 'map') return;
        store.set(id === 'bots' ? 'teamsize' : id, v);
        after();
      });
    });
  }

  private config(): MatchConfig {
    const m = MODES.find((x) => x.id === this.mode)!;
    return { map: MAP_ID, mode: this.mode, bots: this.mode === 'ffa' ? Math.min(16, this.bots * 2) : this.bots, skill: SKILL[this.skill]?.[1] ?? 0.5, time: this.mode === 'hold' ? 9 : 8, limit: m.limit, seed: Math.floor(Math.random() * 1000) };
  }

  private setup(kind: 'solo' | 'host') {
    const m = this.menu;
    this.nextCase();
    m.innerHTML = `<div class="rail wide">
      <div class="mast"><i class="dot"></i>REC<span class="sp">Case ${this.caseId}</span></div>
      <button class="plain" id="s-back">Back</button>
      <h2>${kind === 'solo' ? 'New case' : 'Open a room'}</h2>
      <div class="group"><div class="lab">Location</div><div class="maps" data-seg="map">${MAPS.map((x) => `<button data-v="${x.id}" class="${x.id === MAP_ID ? 'sel' : ''}"><img src="${thumb(x.id)}" alt=""><b>${esc(x.name)}</b><span>${esc(x.note)}</span></button>`).join('')}</div></div>
      ${this.pickers(kind)}
      ${this.loadout()}
      <div class="acts push"><button class="primary" id="s-go">${kind === 'solo' ? 'Start recording' : 'Open the room'}</button></div>
    </div>${this.viewer()}`;
    (m.querySelector('.viewer') as HTMLElement).style.left = '560px';
    m.querySelector('[data-seg="map"]')!.addEventListener('click', (e) => {
      const v = (e.target as HTMLElement).closest('button')?.dataset.v;
      if (v && v !== MAP_ID) {
        // each location is its own load: the page comes back on it, at this same screen
        const u = new URL(location.href);
        if (v !== DEFAULT_MAP) u.searchParams.set('map', v);
        else u.searchParams.delete('map');
        u.searchParams.set('setup', kind);
        location.href = u.toString();
      }
    });
    this.bind(m, () => {
      // a team-size label depends on the mode
      const lab = m.querySelector('.two .lab');
      if (lab) lab.textContent = this.mode === 'ffa' ? 'Players' : 'Team size';
    });
    m.querySelector('#s-back')!.addEventListener('click', () => this.home());
    const go = m.querySelector('#s-go') as HTMLButtonElement;
    go.addEventListener('click', () =>
      this.whenLoaded(go, () => {
        if (kind === 'solo') {
          this.menu.className = 'menu';
          this.g.startSolo(this.config(), this.name || 'Officer', this.team, this.primary);
        } else this.openRoom();
      }),
    );
  }

  private openRoom() {
    this.code = makeCode();
    const host = (this.host = new Host(this.code));
    this.lobbyPlayers = [{ id: 'me', name: this.name || 'Host', team: this.team, primary: this.primary }];
    host.onError = (e) => {
      this.toast(e === 'taken' ? 'That code was taken. Try again.' : `Could not open the room (${e})`);
      host.close();
      this.host = null;
      this.home();
    };
    host.onOpen = () => this.lobby();
    host.onReq = (from, r) => {
      if (r.t === 'hello') {
        const team = this.lobbyPlayers.filter((p) => p.team === 0).length <= this.lobbyPlayers.filter((p) => p.team === 1).length ? 0 : 1;
        this.lobbyPlayers.push({ id: from, name: r.name.slice(0, 14) || 'Guest', team, primary: r.primary });
        host.send(from, { t: 'welcome', slot: 0, cfg: this.config(), players: [], inGame: false, code: this.code });
        this.lobby();
      } else if (r.t === 'me') {
        const p = this.lobbyPlayers.find((q) => q.id === from);
        if (p) {
          if (r.primary) p.primary = r.primary;
          if (r.team !== undefined) p.team = r.team;
          if (r.name) p.name = r.name.slice(0, 14);
          this.lobby();
        }
      }
    };
    host.onLeave = (id) => {
      this.lobbyPlayers = this.lobbyPlayers.filter((p) => p.id !== id);
      this.lobby();
    };
    this.menu.innerHTML = '<div class="rail"><h2>Opening the room</h2><p class="note">Reaching the room server.</p></div>';
  }

  private lobby() {
    const host = this.host;
    if (!host) return;
    const m = this.menu;
    const link = `${location.origin}${location.pathname}?join=${this.code}`;
    const list = (t: number) => this.lobbyPlayers.filter((p) => this.mode === 'ffa' || p.team === t).map((p) => `<li>${esc(p.name)}<em>${WEAPONS[p.primary].name}</em></li>`).join('') || '<li class="none">Bots fill this side</li>';
    m.innerHTML = `<div class="rail wide">
      <div class="mast"><i class="dot"></i>REC<span class="sp">Room open</span></div>
      <button class="plain" id="l-back">Close room</button>
      <div class="group"><div class="lab">Room code</div><div class="code">${this.code}</div></div>
      <div class="invite"><input readonly aria-label="Invite link" value="${link}"><button id="l-copy">Copy link</button></div>
      <div class="teams"><div><h3>${this.mode === 'ffa' ? 'Players' : TEAM_NAME[0]}</h3><ul>${list(0)}</ul></div>${this.mode === 'ffa' ? '' : `<div><h3>${TEAM_NAME[1]}</h3><ul>${list(1)}</ul></div>`}</div>
      ${this.pickers('host')}
      <div class="group"><div class="lab">Your side</div>${this.seg('team', [['0', TEAM_NAME[0]], ['1', TEAM_NAME[1]]], String(this.team))}</div>
      ${this.loadout()}
      <div class="acts push"><button class="primary" id="l-go">Start recording</button></div>
    </div>${this.viewer()}`;
    (m.querySelector('.viewer') as HTMLElement).style.left = '560px';
    this.bind(m, () => {
      const me = this.lobbyPlayers[0];
      me.team = this.team;
      me.primary = this.primary;
      this.lobby();
    });
    m.querySelector('#l-copy')!.addEventListener('click', () => {
      void navigator.clipboard?.writeText(link);
      this.toast('Invite link copied');
    });
    m.querySelector('#l-back')!.addEventListener('click', () => {
      host.close();
      this.host = null;
      this.home();
    });
    const go = m.querySelector('#l-go') as HTMLButtonElement;
    go.addEventListener('click', () => this.whenLoaded(go, () => this.startHosted()));
  }

  startHosted() {
    if (!this.host) return;
    this.menu.className = 'menu';
    const h = this.host;
    this.host = null;
    this.g.startHosted(h, this.config(), this.lobbyPlayers);
  }

  private joinFlow(code: string) {
    this.menu.className = 'menu on';
    this.menu.innerHTML = `<div class="rail"><button class="plain" id="j-back">Cancel</button><div class="group"><div class="lab">Joining room</div><div class="code">${esc(code)}</div></div><p class="note">Reaching the host.</p></div>`;
    const hello: Req = { t: 'hello', name: this.name || 'Guest', primary: this.primary, team: 0 };
    const guest = (this.guest = new Guest_(code, hello));
    const back = () => {
      guest.close();
      this.guest = null;
      this.home();
    };
    this.menu.querySelector('#j-back')!.addEventListener('click', back);
    guest.onClose = (why) => {
      this.guest = null;
      this.home();
      if (why) this.toast(why);
    };
    guest.onDown = (m: Down) => {
      if (m.t === 'welcome') {
        if ((m.cfg.map ?? 'block') !== MAP_ID) {
          // the host is on the other location: come back on it and join again
          const u = new URL(location.href);
          const want = m.cfg.map ?? 'block';
          if (want !== DEFAULT_MAP) u.searchParams.set('map', want);
          else u.searchParams.delete('map');
          u.searchParams.set('join', code);
          location.href = u.toString();
          return;
        }
        this.code = code;
        this.menu.innerHTML = `<div class="rail"><button class="plain" id="j-back">Leave</button><div class="group"><div class="lab">Room code</div><div class="code">${esc(code)}</div></div><p class="note">You're in. The host starts the match.</p><label class="field"><span>Callsign</span><input id="j-name" maxlength="14" spellcheck="false" autocomplete="off" value="${esc(this.name)}"></label>${this.loadout()}</div>${this.viewer()}`;
        this.bind(this.menu, () => guest.send({ t: 'me', primary: this.primary }));
        (this.menu.querySelector('#j-name') as HTMLInputElement).addEventListener('change', (e) => {
          this.name = (e.target as HTMLInputElement).value.trim().slice(0, 14);
          store.set('name', this.name);
          if (this.name) guest.send({ t: 'me', name: this.name });
        });
        this.menu.querySelector('#j-back')!.addEventListener('click', back);
      } else if (m.t === 'start') {
        const me = m.players.find((p) => p.id === guest.peer.id);
        this.guest = null;
        void this.g.whenReady.then(() => {
          this.menu.className = 'menu';
          this.g.startGuest(guest, m.cfg, m.players, me?.slot ?? 0);
        });
      }
    };
  }

  // ---------------------------------------------------------------- pause
  pause() {
    const p = this.pauseEl;
    p.className = 'pause on';
    const q = this.g;
    p.innerHTML = `<div class="rail">
      <div class="mast"><i class="dot"></i>${q.role === 'solo' ? 'Still recording' : 'Room still live'}<span class="sp">Case ${this.caseId || '--'}</span></div>
      <h2>Paused</h2>
      <div class="group">
        <label class="line"><span>Mouse</span><input id="p-sens" type="range" min="0.0006" max="0.005" step="0.0001" value="${q.me.sens}"></label>
        <label class="line"><span>Volume</span><input id="p-vol" type="range" min="0" max="1" step="0.02" value="${q.sound.volume}"></label>
        <div class="line"><span>Resolution</span>${this.seg('q', [['0.7', 'Low'], ['0.85', 'Medium'], ['1', 'High']], ['0.7', '0.85', '1'].find((v) => Number(v) === q.quality) ?? '1')}</div>
        <div class="line"><span>Free aim</span>${this.seg('fa', [['1', 'On'], ['0', 'Off']], q.me.freeAim ? '1' : '0')}</div>
      </div>
      <div class="group"><div class="lab">Controls</div><div class="keys">${KEYS.map(([k, a]) => `<div><span>${a}</span><b>${k}</b></div>`).join('')}</div></div>
      <div class="acts push"><button class="primary" id="p-go">Back in<kbd>Esc</kbd></button><button class="danger" id="p-leave">Leave the match</button></div>
    </div>`;
    p.querySelector('#p-go')!.addEventListener('click', () => this.resume());
    p.querySelector('#p-leave')!.addEventListener('click', () => q.leave());
    (p.querySelector('#p-sens') as HTMLInputElement).addEventListener('input', (e) => {
      q.me.sens = Number((e.target as HTMLInputElement).value);
      store.set('sens', String(q.me.sens));
    });
    (p.querySelector('#p-vol') as HTMLInputElement).addEventListener('input', (e) => {
      q.sound.setVolume(Number((e.target as HTMLInputElement).value));
      store.set('vol', String(q.sound.volume));
    });
    p.querySelectorAll<HTMLElement>('.seg').forEach((sg) => sg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      sg.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
      if (sg.dataset.seg === 'fa') {
        q.me.freeAim = b.dataset.v === '1';
        store.set('freeaim', b.dataset.v!);
        return;
      }
      q.quality = Number(b.dataset.v);
      store.set('quality', b.dataset.v!);
      q.resize();
    }));
  }

  applyPrefs() {
    this.g.me.sens = Number(store.get('sens', String(this.g.me.sens)));
    this.g.sound.volume = Number(store.get('vol', '0.8'));
    this.g.quality = Number(store.get('quality', '1'));
    this.g.me.freeAim = store.get('freeaim', '1') === '1';
  }

  private resume() {
    this.g.sound.start();
    this.g.lock();
  }

  // ---------------------------------------------------------------- in the match
  enter() {
    this.menu.className = 'menu';
    this.hudEl.style.display = '';
    this.pauseEl.classList.remove('on');
    this.lostEl.className = 'lost';
    // the first few matches get the keys on screen; after that the pause screen has them
    const n = Number(store.get('played', '0'));
    store.set('played', String(n + 1));
    this.hintT = n < 4 ? 12 : 0;
    this.hint.classList.toggle('on', n < 4);
    this.feedEl.innerHTML = '';
    this.boardEl.classList.remove('on', 'final');
    if (!this.caseId || this.closed) this.nextCase();
    this.startedAt = performance.now();
    this.marks = [];
    this.heads = this.far = 0;
  }

  leave() {
    this.hudEl.style.display = 'none';
    this.boardEl.classList.remove('on', 'final');
    this.lostEl.className = 'lost';
    this.pauseEl.classList.remove('on');
    this.home();
  }

  toast(s: string) {
    this.toastEl.textContent = s;
    this.toastEl.classList.add('on');
    window.setTimeout(() => this.toastEl.classList.remove('on'), 3400);
  }

  fps(v: number) {
    this.fpsV = v;
  }

  prompt(s: string) {
    if (this.promptEl.textContent !== s) this.promptEl.textContent = s;
  }

  board(list: PlayerInfo[]) {
    this.roster = list;
    this.renderBoard();
  }

  private renderBoard() {
    const g = this.g;
    const row = (p: PlayerInfo) => `<tr class="${p.slot === g.mySlot ? 'me' : ''}${p.alive ? '' : ' down'}"><td>${esc(p.name)}${p.bot ? '<i>bot</i>' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.score}</td></tr>`;
    const head = '<tr><th></th><th>K</th><th>D</th><th>Score</th></tr>';
    const by = (t: number) => this.roster.filter((p) => p.team === t).sort((a, b) => b.score - a.score || b.kills - a.kills);
    const ffa = g.cfg?.mode === 'ffa';
    this.shTop.innerHTML = `<span>CASE ${this.caseId}</span><span>${MODES.find((x) => x.id === g.cfg?.mode)?.name ?? ''}${g.phase === 'live' ? ' &nbsp;' + fmtClock(g.timer()) : ''}</span>`;
    this.tables.className = 'sh-tables' + (ffa ? ' one' : '');
    this.tables.innerHTML = ffa
      ? `<div><h3>Free For All</h3><table>${head}${[...this.roster].sort((a, b) => b.kills - a.kills).map(row).join('')}</table></div>`
      : `<div><h3>${TEAM_NAME[0]} <b>${g.score[0]}</b></h3><table>${head}${by(0).map(row).join('')}</table></div><div><h3>${TEAM_NAME[1]} <b>${g.score[1]}</b></h3><table>${head}${by(1).map(row).join('')}</table></div>`;
  }

  scoreboard(on: boolean) {
    if (this.boardEl.classList.contains('final')) return;
    if (on && !this.boardEl.classList.contains('on')) this.renderBoard();
    this.boardEl.classList.toggle('on', on);
  }

  feed(a: string, b: string, w: number, zone: number, ta: number, tb: number, mine: boolean) {
    const row = el('div', mine ? 'mine' : '');
    const how = zone === 3 ? 'blast' : `${this.g.weaponName(w)}${zone === 0 ? ', head' : ''}`;
    const t = new Date().toTimeString().slice(0, 8);
    row.innerHTML = `<time>${t}</time><b class="t${ta}">${esc(a)}</b><span>${how}</span><b class="t${tb}">${esc(b)}</b>`;
    this.feedEl.prepend(row);
    while (this.feedEl.children.length > 5) this.feedEl.lastChild!.remove();
    window.setTimeout(() => row.classList.add('out'), 6000);
    window.setTimeout(() => row.remove(), 6500);
  }

  private say(s: string, sec: number, cls = '') {
    this.center.innerHTML = s;
    this.center.className = 'center on ' + cls;
    this.msgT = sec;
  }

  killed(name: string, zone: number, dist: number) {
    this.say(`${esc(name)}<small>${zone === 0 ? 'Head' : 'Down'}, ${Math.round(dist)} m</small>`, 1.6, 'kill');
    this.mark(1);
    if (zone === 0) this.heads++;
    this.far = Math.max(this.far, dist);
  }

  /** a tick on the case timeline: 1 a kill, 0 a death */
  private mark(k: number) {
    this.marks.push([(performance.now() - this.startedAt) / 1000, k]);
  }

  /** where a round landed, for the wound list */
  /** a round landed: the camera shows what is left */
  wound(zone: number) {
    if (zone !== 3) this.ammoT = 0;
  }

  hitTick(kill: boolean) {
    this.tick.className = 'tick on' + (kill ? ' kill' : '');
    this.tickT = kill ? 0.3 : 0.12;
  }

  damage(dir: [number, number, number], cam: THREE.Camera, hp: number) {
    // which way it came from, as a smear on the lens edge
    const f = cam.getWorldDirection(new (cam.position.constructor as new () => THREE.Vector3)());
    const a = Math.atan2(f.x, f.z) - Math.atan2(-dir[0], -dir[2]);
    this.dmgEl.style.transform = `rotate(${a}rad)`;
    this.dmgEl.classList.add('on');
    this.dmgT = 0.7;
    void hp;
  }

  alive() {
    this.lostEl.className = 'lost';
    this.scope.classList.remove('on');
  }

  down(killer: string, zone: string, dist: number, w: number, rounds: boolean) {
    const weapon = this.g.weaponName(w);
    const now = new Date();
    this.mark(0);
    this.lostEl.innerHTML = `<div class="l-in"><small>LAST FRAME ${now.toTimeString().slice(0, 8)}.${String(Math.floor(now.getMilliseconds() / 40)).padStart(2, '0')}</small><h2>${esc(killer)}</h2><p>${weapon}, ${zone}, ${Math.round(dist)} m</p>${rounds ? '<em>Out until the next round</em>' : '<em>Next camera</em><div class="l-bar"><i></i></div>'}</div>`;
    this.lostEl.className = 'lost pre';
  }

  lost() {
    this.lostEl.className = 'lost on';
  }

  spectating(name: string) {
    this.lostEl.className = 'lost spec';
    this.lostEl.innerHTML = `<div class="l-in"><small>WATCHING</small><p>${esc(name)}</p><em>Click for the next camera</em></div>`;
  }

  phase(e: Extract<Ev, { t: 'phase' }>) {
    const g = this.g;
    const myTeam = g.player(g.mySlot)?.team ?? 0;
    if (e.phase === 'warmup') {
      const m = MODES.find((x) => x.id === g.cfg?.mode);
      this.say(`${g.cfg?.mode === 'rounds' ? `Round ${e.round}` : m?.name ?? ''}<small>CASE ${this.caseId} &nbsp;${m?.note ?? ''}${e.round <= 1 ? '<br>In the dark your light is what they see. T turns it off.' : ''}</small>`, e.round <= 1 ? 5.5 : 3.8);
      this.boardEl.classList.remove('on', 'final');
    } else if (e.phase === 'live') {
      this.say('Recording', 0.8, 'go');
      g.sound.beep(true);
    } else if (e.phase === 'between') {
      const win = e.winner === myTeam;
      this.say(`${e.winner === -1 ? 'Draw' : win ? 'Round won' : 'Round lost'}<small>${e.msg ?? ''}. ${TEAM_NAME[0]} ${e.score[0]}, ${TEAM_NAME[1]} ${e.score[1]}</small>`, 4.6);
    } else if (e.phase === 'over') {
      const ffa = g.cfg?.mode === 'ffa';
      const won = ffa ? e.winner === g.mySlot : e.winner === myTeam;
      const who = ffa ? (g.player(e.winner ?? -1)?.name ?? 'Nobody') : e.winner === -1 ? 'Draw' : TEAM_NAME[e.winner ?? 0];
      const me = g.player(g.mySlot);
      const len = (performance.now() - this.startedAt) / 1000;
      const title = e.winner === -1 ? 'Draw' : won ? 'Case closed. You won.' : `${esc(who)} won`;
      const line = ffa ? `${esc(who)} first to ${g.cfg?.limit}` : `${TEAM_NAME[0]} ${g.score[0]}, ${TEAM_NAME[1]} ${g.score[1]}`;
      const parts = [`${me?.kills ?? 0} down`, `${me?.deaths ?? 0} lost`];
      if (this.heads) parts.push(`${this.heads} to the head`);
      if (this.far >= 1) parts.push(`longest ${Math.round(this.far)} m`);
      this.report.innerHTML = `<h2>${title}</h2><p>${line}. ${parts.join(', ')}.</p>
        <div class="tl">${scrub(this.marks, len)}<div class="legend"><span>0:00</span><span>Up: your kills. Down, red: your deaths.</span><span>${fmtClock(len)}</span></div></div>`;
      this.renderBoard();
      this.boardEl.classList.add('on', 'final');
      this.shActs.innerHTML = '';
      if (g.role !== 'guest') {
        const again = el('button', 'primary', 'Run it back');
        again.addEventListener('click', () => {
          this.nextCase();
          g.rematch();
        });
        this.shActs.append(again);
      } else this.shActs.append(el('p', 'note', 'The host can start another.'));
      const btn = el('button', '', 'Leave the match');
      btn.addEventListener('click', () => g.leave());
      this.shActs.append(btn);
      const log = [{ id: this.caseId, at: Date.now(), mode: g.cfg?.mode ?? 'tdm', won: won ? 1 : 0, line: `${won ? 'Won' : e.winner === -1 ? 'Draw' : 'Lost'}, ${ffa ? `${me?.kills ?? 0} kills` : `${g.score[0]} to ${g.score[1]}`}`, k: me?.kills ?? 0, d: me?.deaths ?? 0, len, marks: this.marks } satisfies Case, ...this.cases()].slice(0, 12);
      store.set('cases', JSON.stringify(log));
      this.closed = true;
      this.lostEl.className = 'lost';
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  hold(e: Extract<Ev, { t: 'hold' }>) {
    this.g.holdZone = e.zone;
    const names = ['Bridge', 'Warehouse', 'Tenement'];
    this.holdInfo = `${names[e.zone] ?? ''}: ${e.owner < 0 ? 'open' : TEAM_NAME[e.owner]}`;
  }

  chat(from: string, text: string) {
    const row = el('div', '', `<b>${esc(from)}</b> <span>${esc(text)}</span>`);
    this.feedEl.prepend(row);
    window.setTimeout(() => row.remove(), 7000);
  }

  update(dt: number) {
    const g = this.g;
    if (!g.inMatch) return;
    this.msgT -= dt;
    if (this.msgT <= 0 && this.center.classList.contains('on')) this.center.classList.remove('on');
    this.tickT -= dt;
    if (this.tickT <= 0) this.tick.className = 'tick';
    this.dmgT -= dt;
    if (this.dmgT <= 0) this.dmgEl.classList.remove('on');
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.hint.classList.remove('on');
    }
    const d = new Date();
    const stamp = `${stampNow(d)}<br>LF BODY 4 &nbsp;X${this.unit}0${this.unit.slice(-3)} &nbsp;<span class="rec${d.getSeconds() % 2 ? '' : ' off'}">REC</span>`;
    if (this.stamp.dataset.s !== stamp) {
      this.stamp.dataset.s = stamp;
      this.stamp.innerHTML = stamp;
    }
    const me = g.me;
    const info = g.player(g.mySlot);
    const mode = g.cfg?.mode;
    const score = mode === 'ffa' ? `${info?.kills ?? 0}/${g.cfg?.limit}` : `${g.score[0]} : ${g.score[1]}`;
    const clock = g.phase === 'live' || g.phase === 'warmup' ? fmtClock(g.timer()) : '';
    const line = `<b>${score}</b>${clock ? `<span>${clock}</span>` : ''}${mode === 'hold' && this.holdInfo ? `<span>${esc(this.holdInfo)}</span>` : ''}`;
    if (this.top.dataset.s !== line) {
      this.top.dataset.s = line;
      this.top.innerHTML = line;
    }
    g.mates(this.mateList);
    while (this.tags.length < this.mateList.length) {
      const t = el('div', 'mate');
      this.tags.push(t);
      this.tagBox.append(t);
    }
    this.tags.forEach((t, i) => {
      const m = this.mateList[i];
      t.style.display = m ? '' : 'none';
      if (!m) return;
      t.style.transform = `translate(${(m.x * innerWidth).toFixed(0)}px, ${(m.y * innerHeight).toFixed(0)}px)`;
      if (t.textContent !== m.name) t.textContent = m.name;
    });
    if (me.alive) {
      const a = me.ammo.get(me.weapon);
      const txt = a ? `${me.reloadT > 0 ? 'Reloading' : `${a.mag}<small> / &infin;</small>`}<em>${WEAPONS[me.weapon].name}${me.nades.frag ? ' &nbsp;Frag' : ''}${me.nades.flash ? ' &nbsp;Flash' : ''}</em>` : '';
      if (this.ammo.dataset.s !== txt) {
        this.ammo.dataset.s = txt;
        this.ammo.innerHTML = txt;
        this.ammoT = 2.6;
      }
      // the camera has no ammo counter: it shows up when you've just used it, or when it matters
      this.ammoT -= dt;
      const low = !!a && a.mag <= Math.ceil(WEAPONS[me.weapon].mag * 0.25);
      this.ammo.classList.toggle('on', this.ammoT > 0 || low || me.reloadT > 0);
      const hp = info?.hp ?? 100;
      (this.hp.firstChild as HTMLElement).style.transform = `scaleX(${hp / 100})`;
      // nor a health bar: it comes up when you're hit, and stays while it matters
      if (hp !== this.lastHp) {
        this.lastHp = hp;
        this.hpT = 3.5;
      }
      this.hpT -= dt;
      this.vitals.classList.toggle('on', this.hpT > 0 || hp < 45 || me.bleed > 0 || me.limp > 0.2 || me.arm > 0.2 || me.healT > 0);
      this.hp.classList.toggle('low', hp < 40);
      const ws: string[] = [];
      if (me.bleed > 0) ws.push('BLEEDING');
      if (me.limp > 0.2) ws.push('LEG');
      if (me.arm > 0.2) ws.push('ARM');
      const wtxt = ws.length ? `${ws.map((w) => `<b>${w}</b>`).join('')}<br><span>H bandage ${me.wraps ? `x${me.wraps}` : 'none left'}</span>` : hp < 70 && me.wraps ? `<span>H bandage x${me.wraps}</span>` : '';
      if (this.wounds.dataset.s !== wtxt) {
        this.wounds.dataset.s = wtxt;
        this.wounds.innerHTML = wtxt;
      }
      this.healBar.classList.toggle('on', me.healT > 0);
      if (me.healT > 0) (this.healBar.firstChild as HTMLElement).style.transform = `scaleX(${Math.min(1, me.healT / 3.2)})`;
      const scoped = me.weapon === 'rifle' && me.adsK > 0.86;
      this.scope.classList.toggle('on', scoped);
      if (g.actors.get(g.mySlot)?.soldier?.gun) g.actors.get(g.mySlot)!.soldier!.gun!.group.visible = !scoped;
    } else this.scope.classList.remove('on');
  }
}

export { ZONE_NAME };
