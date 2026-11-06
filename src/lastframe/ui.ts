import './ui.css';
import type { Game } from './game.ts';
import { Guest_, Host, makeCode, type Down } from './net.ts';
import { PRIMARIES, TEAM_NAME, WEAPONS, ZONE_NAME, fmtClock, type Ev, type MatchConfig, type Mode, type PlayerInfo, type Req, type WeaponId } from './shared.ts';
import type * as THREE from 'three';

const MODES: { id: Mode; name: string; note: string; limit: number }[] = [
  { id: 'tdm', name: 'Team Fight', note: 'First team to 40 kills. Respawns on.', limit: 40 },
  { id: 'rounds', name: 'Last Team Standing', note: 'One life a round. First to 5.', limit: 5 },
  { id: 'hold', name: 'Hold Ground', note: 'Keep the zone. First to 150. It moves.', limit: 150 },
  { id: 'ffa', name: 'Free For All', note: 'Everyone against everyone. First to 20.', limit: 20 },
];
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
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Hud {
  root = document.getElementById('ui')!;
  private stamp = el('div', 'stamp');
  private hudEl = el('div', 'hud');
  private feedEl = el('div', 'feed');
  private center = el('div', 'center');
  private promptEl = el('div', 'prompt');
  private ammo = el('div', 'ammo');
  private hp = el('div', 'hp', '<i></i>');
  private top = el('div', 'topline');
  private boardEl = el('div', 'board');
  private lostEl = el('div', 'lost');
  private scope = el('div', 'scope');
  private dmgEl = el('div', 'dmg');
  private menu = el('div', 'menu');
  private pauseEl = el('div', 'pause');
  private toastEl = el('div', 'toast');
  private hint = el('div', 'hint', '<b>WASD</b> move <b>Shift</b> run <b>C</b> crouch <b>Q E</b> lean <b>RMB</b> aim <b>R</b> reload <b>T</b> light <b>F</b> door <b>G</b> frag <b>V</b> flash <b>1 2</b> swap <b>Tab</b> score');
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
  private bots = Number(store.get('bots', '4'));
  private skill = Number(store.get('skill', '1'));
  private code = '';
  private host: Host | null = null;
  private guest: Guest_ | null = null;
  private lobbyPlayers: { id: string; name: string; team: number; primary: WeaponId }[] = [];
  private mySlotInLobby = 0;

  constructor(private g: Game) {
    this.hudEl.append(this.tagBox, this.stamp, this.top, this.feedEl, this.center, this.promptEl, this.ammo, this.hp, this.tick, this.dmgEl, this.scope, this.hint);
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
  }

  ready() {
    const j = new URLSearchParams(location.search).get('join');
    this.home();
    if (j) this.joinFlow(j.toUpperCase());
  }

  // ---------------------------------------------------------------- menus
  private home() {
    const m = this.menu;
    m.className = 'menu on';
    m.innerHTML = `
      <div class="m-left">
        <div class="brand"><span class="dot"></span><span>REC</span></div>
        <h1>Last<br>Frame</h1>
        <p class="tag">Everything you see is what the camera saw.</p>
        <label class="field"><span>Callsign</span><input id="m-name" maxlength="14" spellcheck="false" autocomplete="off" placeholder="Your name" value="${esc(this.name)}"></label>
        <div class="acts">
          <button class="primary" id="m-solo">Play against bots</button>
          <button id="m-host">Host a room</button>
          <div class="join"><input id="m-code" maxlength="4" placeholder="CODE" spellcheck="false" autocomplete="off"><button id="m-join">Join</button></div>
        </div>
        <p class="fine">Mouse and keyboard. Headphones help: you will hear them first.</p>
      </div>`;
    const name = m.querySelector('#m-name') as HTMLInputElement;
    const remember = () => {
      this.name = name.value.trim().slice(0, 14) || 'Officer';
      store.set('name', name.value.trim());
    };
    m.querySelector('#m-solo')!.addEventListener('click', () => {
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

  private pickers(kind: 'solo' | 'host') {
    const seg = (id: string, items: [string, string][], cur: string) => `<div class="seg" data-seg="${id}">${items.map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'sel' : ''}">${l}</button>`).join('')}</div>`;
    const mode = MODES.find((x) => x.id === this.mode) ?? MODES[0];
    return `
      <label class="row"><span>Mode</span>${seg('mode', MODES.map((x) => [x.id, x.name]), this.mode)}</label>
      <p class="note" id="s-note">${mode.note}</p>
      <label class="row"><span>${this.mode === 'ffa' ? 'Players' : 'Team size'}</span>${seg('bots', [['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6']], String(this.bots))}</label>
      <label class="row"><span>Bots</span>${seg('skill', SKILL.map(([l], i) => [String(i), l]), String(this.skill))}</label>
      ${kind === 'solo' ? `<label class="row"><span>Side</span>${seg('team', [['0', TEAM_NAME[0]], ['1', TEAM_NAME[1]]], String(this.team))}</label>` : ''}`;
  }

  private loadout() {
    return `<label class="row"><span>Weapon</span><div class="seg" data-seg="primary">${PRIMARIES.map((w) => `<button data-v="${w}" class="${w === this.primary ? 'sel' : ''}">${WEAPONS[w].name}</button>`).join('')}</div></label>`;
  }

  private bind(root: HTMLElement, after: () => void = () => {}) {
    root.querySelectorAll<HTMLElement>('.seg').forEach((s) => {
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
        store.set(id, v);
        const note = root.querySelector('#s-note');
        if (note) note.textContent = MODES.find((x) => x.id === this.mode)!.note;
        after();
      });
    });
  }

  private config(): MatchConfig {
    const m = MODES.find((x) => x.id === this.mode)!;
    return { mode: this.mode, bots: this.mode === 'ffa' ? this.bots * 2 : this.bots, skill: SKILL[this.skill]?.[1] ?? 0.5, time: this.mode === 'hold' ? 9 : 8, limit: m.limit, seed: Math.floor(Math.random() * 1000) };
  }

  private setup(kind: 'solo' | 'host') {
    const m = this.menu;
    m.innerHTML = `<div class="m-left wide">
      <button class="back" id="s-back">Back</button>
      <h2>${kind === 'solo' ? 'Against bots' : 'Host a room'}</h2>
      ${this.pickers(kind)}
      ${this.loadout()}
      <div class="acts"><button class="primary" id="s-go">${kind === 'solo' ? 'Deploy' : 'Open the room'}</button></div>
    </div>`;
    this.bind(m);
    m.querySelector('#s-back')!.addEventListener('click', () => this.home());
    m.querySelector('#s-go')!.addEventListener('click', () => {
      if (kind === 'solo') {
        this.menu.className = 'menu';
        this.g.startSolo(this.config(), this.name || 'Officer', this.team, this.primary);
      } else this.openRoom();
    });
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
    this.menu.innerHTML = '<div class="m-left"><h2>Opening the room</h2><p class="note">Reaching the room server</p></div>';
  }

  private lobby() {
    const host = this.host;
    if (!host) return;
    const m = this.menu;
    const link = `${location.origin}${location.pathname}?join=${this.code}`;
    const list = (t: number) => this.lobbyPlayers.filter((p) => this.mode === 'ffa' || p.team === t).map((p) => `<li>${esc(p.name)}<em>${WEAPONS[p.primary].name}</em></li>`).join('') || '<li class="none">Bots fill this side</li>';
    m.innerHTML = `<div class="m-left wide">
      <button class="back" id="l-back">Close room</button>
      <h2>Room <span class="code">${this.code}</span></h2>
      <div class="invite"><input readonly value="${link}"><button id="l-copy">Copy link</button></div>
      <div class="teams"><div><h3>${this.mode === 'ffa' ? 'Players' : TEAM_NAME[0]}</h3><ul>${list(0)}</ul></div>${this.mode === 'ffa' ? '' : `<div><h3>${TEAM_NAME[1]}</h3><ul>${list(1)}</ul></div>`}</div>
      ${this.pickers('host')}
      <label class="row"><span>Your side</span><div class="seg" data-seg="team"><button data-v="0" class="${this.team === 0 ? 'sel' : ''}">${TEAM_NAME[0]}</button><button data-v="1" class="${this.team === 1 ? 'sel' : ''}">${TEAM_NAME[1]}</button></div></label>
      ${this.loadout()}
      <div class="acts"><button class="primary" id="l-go">Start the match</button></div>
    </div>`;
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
    m.querySelector('#l-go')!.addEventListener('click', () => this.startHosted());
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
    this.menu.innerHTML = `<div class="m-left"><h2>Joining ${esc(code)}</h2><p class="note">Reaching the host</p><button class="back" id="j-back">Cancel</button></div>`;
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
        this.code = code;
        this.menu.innerHTML = `<div class="m-left wide"><button class="back" id="j-back">Leave</button><h2>Room <span class="code">${esc(code)}</span></h2><p class="note">In the room. The host starts the match.</p><label class="field"><span>Callsign</span><input id="j-name" maxlength="14" spellcheck="false" autocomplete="off" value="${esc(this.name)}"></label>${this.loadout()}</div>`;
        this.bind(this.menu, () => guest.send({ t: 'me', primary: this.primary }));
        (this.menu.querySelector('#j-name') as HTMLInputElement).addEventListener('change', (e) => {
          this.name = (e.target as HTMLInputElement).value.trim().slice(0, 14);
          store.set('name', this.name);
          if (this.name) guest.send({ t: 'me', name: this.name });
        });
        this.menu.querySelector('#j-back')!.addEventListener('click', back);
      } else if (m.t === 'start') {
        const me = m.players.find((p) => p.id === guest.peer.id);
        this.menu.className = 'menu';
        this.g.startGuest(guest, m.cfg, m.players, me?.slot ?? 0);
        this.guest = null;
      }
    };
  }

  // ---------------------------------------------------------------- pause
  pause() {
    const p = this.pauseEl;
    p.className = 'pause on';
    const q = this.g;
    p.innerHTML = `<div class="m-left">
      <h2>${q.me.alive || q.phase !== 'warmup' ? 'Paused' : 'Ready'}</h2>
      <p class="note">${q.role === 'solo' ? 'The match keeps running.' : 'The room keeps playing without you.'}</p>
      <label class="row"><span>Mouse</span><input id="p-sens" type="range" min="0.0006" max="0.005" step="0.0001" value="${q.me.sens}"></label>
      <label class="row"><span>Volume</span><input id="p-vol" type="range" min="0" max="1" step="0.02" value="${q.sound.volume}"></label>
      <label class="row"><span>Resolution</span><div class="seg" data-seg="q">${[['0.7', 'Low'], ['0.85', 'Medium'], ['1', 'High']].map(([v, l]) => `<button data-v="${v}" class="${Number(v) === q.quality ? 'sel' : ''}">${l}</button>`).join('')}</div></label>
      <div class="acts"><button class="primary" id="p-go">Back in</button><button id="p-leave">Leave the match</button></div>
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
    p.querySelector('.seg')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      q.quality = Number(b.dataset.v);
      store.set('quality', b.dataset.v!);
      p.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('sel', x === b));
      q.resize();
    });
  }

  applyPrefs() {
    this.g.me.sens = Number(store.get('sens', String(this.g.me.sens)));
    this.g.sound.volume = Number(store.get('vol', '0.8'));
    this.g.quality = Number(store.get('quality', '1'));
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
    this.hintT = 22;
    this.hint.classList.add('on');
    this.feedEl.innerHTML = '';
    this.boardEl.classList.remove('on', 'final');
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
    const row = (p: PlayerInfo) => `<tr class="${p.slot === g.mySlot ? 'me' : ''}${p.alive ? '' : ' down'}"><td>${esc(p.name)}${p.bot ? ' <i>bot</i>' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.score}</td></tr>`;
    const head = '<tr><th></th><th>K</th><th>D</th><th>Score</th></tr>';
    const by = (t: number) => this.roster.filter((p) => p.team === t).sort((a, b) => b.score - a.score || b.kills - a.kills);
    const ffa = g.cfg?.mode === 'ffa';
    this.boardEl.innerHTML = ffa
      ? `<div><h3>Free For All</h3><table>${head}${[...this.roster].sort((a, b) => b.kills - a.kills).map(row).join('')}</table></div>`
      : `<div><h3>${TEAM_NAME[0]} <b>${g.score[0]}</b></h3><table>${head}${by(0).map(row).join('')}</table></div><div><h3>${TEAM_NAME[1]} <b>${g.score[1]}</b></h3><table>${head}${by(1).map(row).join('')}</table></div>`;
  }

  scoreboard(on: boolean) {
    if (this.boardEl.classList.contains('final')) return;
    this.boardEl.classList.toggle('on', on);
  }

  feed(a: string, b: string, w: number, zone: number, ta: number, tb: number, mine: boolean) {
    const row = el('div', mine ? 'mine' : '');
    const how = zone === 3 ? 'blast' : `${this.g.weaponName(w)}${zone === 0 ? ', head' : ''}`;
    row.innerHTML = `<b class="t${ta}">${esc(a)}</b> <span>${how}</span> <b class="t${tb}">${esc(b)}</b>`;
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
    this.say(`<small>${zone === 0 ? 'Headshot' : 'Down'}</small>${esc(name)}<small>${Math.round(dist)} m</small>`, 1.6, 'kill');
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
    this.lostEl.innerHTML = `<div class="l-in"><small>Last frame ${now.toTimeString().slice(0, 8)}</small><h2>${esc(killer)}</h2><p>${weapon}, ${zone}, ${Math.round(dist)} m</p><em>${rounds ? 'Out until the next round' : 'Back on the feed shortly'}</em></div>`;
    this.lostEl.className = 'lost pre';
  }

  lost() {
    this.lostEl.className = 'lost on';
  }

  spectating(name: string) {
    this.lostEl.className = 'lost spec';
    this.lostEl.innerHTML = `<div class="l-in"><small>Feed</small><p>${esc(name)}'s camera</p><em>Click for the next</em></div>`;
  }

  phase(e: Extract<Ev, { t: 'phase' }>) {
    const g = this.g;
    const myTeam = g.player(g.mySlot)?.team ?? 0;
    if (e.phase === 'warmup') {
      const m = MODES.find((x) => x.id === g.cfg?.mode);
      this.say(`${g.cfg?.mode === 'rounds' ? `Round ${e.round}` : m?.name ?? ''}<small>${m?.note ?? ''}</small>`, 3.8);
      this.boardEl.classList.remove('on', 'final');
    } else if (e.phase === 'live') {
      this.say('Go', 0.8, 'go');
      g.sound.beep(true);
    } else if (e.phase === 'between') {
      const win = e.winner === myTeam;
      this.say(`${e.winner === -1 ? 'Draw' : win ? 'Round won' : 'Round lost'}<small>${e.msg ?? ''}. ${TEAM_NAME[0]} ${e.score[0]}, ${TEAM_NAME[1]} ${e.score[1]}</small>`, 4.6);
    } else if (e.phase === 'over') {
      const ffa = g.cfg?.mode === 'ffa';
      const won = ffa ? e.winner === g.mySlot : e.winner === myTeam;
      const who = ffa ? (g.player(e.winner ?? -1)?.name ?? 'Nobody') : e.winner === -1 ? 'Draw' : TEAM_NAME[e.winner ?? 0];
      this.renderBoard();
      this.boardEl.classList.add('on', 'final');
      this.boardEl.insertAdjacentHTML('afterbegin', `<h2>${e.winner === -1 ? 'Draw' : won ? 'Victory' : esc(who) + ' wins'}</h2>`);
      const acts = el('div', 'end-acts');
      if (g.role !== 'guest') {
        const again = el('button', 'primary', 'Play again');
        again.addEventListener('click', () => g.rematch());
        acts.append(again);
      } else acts.append(el('p', 'note', 'The host can start another.'));
      const btn = el('button', '', 'Leave the match');
      btn.addEventListener('click', () => g.leave());
      acts.append(btn);
      this.boardEl.append(acts);
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
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    const stamp = `${ts}<br>LF-CAM ${this.unit} &nbsp;<span class="rec${d.getSeconds() % 2 ? '' : ' off'}">REC</span>`;
    if (this.stamp.dataset.s !== stamp) {
      this.stamp.dataset.s = stamp;
      this.stamp.innerHTML = stamp;
    }
    const me = g.me;
    const info = g.player(g.mySlot);
    const mode = g.cfg?.mode;
    const score = mode === 'ffa' ? `${info?.kills ?? 0}/${g.cfg?.limit}` : `${g.score[0]} : ${g.score[1]}`;
    const clock = g.phase === 'live' || g.phase === 'warmup' ? fmtClock(g.timer()) : '';
    const line = `<b>${score}</b>${clock ? ' &nbsp;' + clock : ''}${mode === 'hold' && this.holdInfo ? ' &nbsp;' + esc(this.holdInfo) : ''}`;
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
      const txt = a ? `${me.reloadT > 0 ? 'Reloading' : `${a.mag}<small>/${a.res}</small>`}<em>${WEAPONS[me.weapon].name}${me.nades.frag ? ' &nbsp;Frag' : ''}${me.nades.flash ? ' &nbsp;Flash' : ''}</em>` : '';
      if (this.ammo.dataset.s !== txt) {
        this.ammo.dataset.s = txt;
        this.ammo.innerHTML = txt;
      }
      const hp = info?.hp ?? 100;
      (this.hp.firstChild as HTMLElement).style.transform = `scaleX(${hp / 100})`;
      this.hp.classList.toggle('low', hp < 40);
      const scoped = me.weapon === 'rifle' && me.adsK > 0.86;
      this.scope.classList.toggle('on', scoped);
      if (g.actors.get(g.mySlot)?.soldier?.gun) g.actors.get(g.mySlot)!.soldier!.gun!.group.visible = !scoped;
    } else this.scope.classList.remove('on');
  }
}

export { ZONE_NAME };
