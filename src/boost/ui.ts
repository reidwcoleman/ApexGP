import { ACTS, DEFAULT_KEYS, DEFAULT_PAD, keyName, padName, type Act, type KeyBinds, type PadBinds } from './input.ts';
import { botPlan, type BotMode, type LobbyState } from './net.ts';
import { asMap, asTime, MAP_IDS, MAPS, TIME_IDS, TIMES, type MapId, type TimeId } from './render/looks.ts';
import type { Stats } from './sim/world.ts';

/**
 * Every screen and the HUD, as plain DOM over the canvas. The game drives it: show/hide screens,
 * push scores, boost, countdowns, banners and the event feed; the menus call back through `on*`.
 */

export const PAINTS = [0xffffff, 0x1b1d22, 0xffd23a, 0x39e07a, 0xff3b5c, 0xb06bff, 0x2ee6e6, 0xff8ad1, 0xa8ff3a, 0x8a5a2b, 0xc0c6d0, 0xff5a1f, 0x3a6bff, 0x00b38f, 0xffb3a1, 0x6a7380];
const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Profile {
  name: string;
  accent: number;
  fov: number;
  dist: number;
  height: number;
  /** degrees, -15..0 */
  angle: number;
  stiff: number;
  trans: number;
  ballCam: boolean;
  volume: number;
  shake: boolean;
  map: MapId;
  time: TimeId;
  /** keyboard / mouse binds, two per action */
  binds: KeyBinds;
  /** controller binds (standard-mapping buttons) */
  padBinds: PadBinds;
  deadzone: number;
  steerSens: number;
  airSens: number;
  rumble: boolean;
}

export function loadProfile(): Profile {
  const def: Profile = { name: 'Player', accent: 0xffffff, fov: 110, dist: 270, height: 100, angle: -4, stiff: 0.45, trans: 1.2, ballCam: true, volume: 0.8, shake: true, map: 'apex', time: 'day', binds: structuredClone(DEFAULT_KEYS), padBinds: { ...DEFAULT_PAD }, deadzone: 0.1, steerSens: 1, airSens: 1, rumble: true };
  try {
    const raw = JSON.parse(localStorage.getItem('boostball.profile') ?? '{}');
    // (profiles from before arenas and times: the old Day / Night switch)
    if (raw.arena && !raw.time) raw.time = raw.arena === 'night' ? 'night' : 'day';
    delete raw.arena;
    // (the old two-layout switch: everyone starts on the genre's PC defaults)
    delete raw.keys;
    const p = { ...def, ...raw };
    p.binds = { ...structuredClone(DEFAULT_KEYS), ...(raw.binds ?? {}) };
    p.padBinds = { ...DEFAULT_PAD, ...(raw.padBinds ?? {}) };
    p.map = asMap(p.map);
    p.time = asTime(p.time);
    return p;
  } catch {
    return def;
  }
}
export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem('boostball.profile', JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

export class UI {
  readonly root: HTMLElement;
  private $ = <T extends HTMLElement = HTMLElement>(s: string) => this.root.querySelector(s) as T;
  onPlay: (size: number, skill: number, minutes: number) => void = () => {};
  onFreeplay: () => void = () => {};
  onHost: () => void = () => {};
  onJoin: (code: string) => void = () => {};
  onLobbyTeam: (team: 0 | 1) => void = () => {};
  onLobbyStart: () => void = () => {};
  onLobbyLeave: () => void = () => {};
  onLobbyOpt: (o: Partial<Pick<LobbyState, 'size' | 'minutes' | 'bots' | 'botSkill' | 'map' | 'time'>>) => void = () => {};
  onLobbyKick: (id: string) => void = () => {};
  onChat: (text: string) => void = () => {};
  onResume: () => void = () => {};
  onLeave: () => void = () => {};
  onAgain: () => void = () => {};
  onProfile: (p: Profile) => void = () => {};
  onClick: () => void = () => {};
  onScreen: (id: string) => void = () => {};
  /** start capturing a bind (the game hands the next key / button back through bindTo) */
  onCaptureStart: (act: Act, kind: 'key' | 'pad', slot: number) => void = () => {};
  onCaptureEnd: () => void = () => {};
  onBindsOpen: (open: boolean) => void = () => {};
  padPS = false;
  private cap: { act: Act; kind: 'key' | 'pad'; slot: number } | null = null;
  profile: Profile;
  private feedEl: HTMLElement;
  private playSize = 2;
  private playSkill = 0.55;
  private playMin = 5;
  private toastT = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.profile = loadProfile();
    root.innerHTML = this.html();
    this.feedEl = this.$('.feed');
    this.wire();
    this.drawBoost(33);
  }

  private html(): string {
    const p = this.profile;
    return `
<div class="menu" id="m-menu">
  <div class="side">
    <div class="logo"><b>BOOST</b><i>BALL</i><small>Rocket-powered car soccer</small></div>
    <div class="screen" id="s-main">
      <button class="mbtn primary" data-go="s-online"><span>Play with friends</span><em>Online lobby · share a code</em></button>
      <button class="mbtn" data-go="s-play"><span>Play vs bots</span><em>1v1 · 2v2 · 3v3</em></button>
      <button class="mbtn" id="b-free"><span>Free play</span><em>Just you and the ball</em></button>
      <button class="mbtn" data-go="s-garage"><span>Garage</span><em>Name · paint</em></button>
      <button class="mbtn" id="b-binds"><span>Controls</span><em id="pad-status">Keyboard &amp; mouse · controller</em></button>
      <button class="mbtn back" id="b-games"><span>← All games</span></button>
    </div>
    <div class="screen" id="s-play" hidden>
      <div class="mhead">Team size</div>
      <div class="seg" id="seg-size"><button data-v="1">1v1</button><button data-v="2" class="on">2v2</button><button data-v="3">3v3</button></div>
      <div class="mhead">Bot skill</div>
      <div class="seg" id="seg-skill"><button data-v="0.3">Rookie</button><button data-v="0.55" class="on">Pro</button><button data-v="0.85">All-Star</button></div>
      <div class="mhead">Match length</div>
      <div class="seg" id="seg-min"><button data-v="3">3 min</button><button data-v="5" class="on">5 min</button><button data-v="10">10 min</button></div>
      <div class="mhead">Arena</div>
      <div class="seg wrap" id="seg-map">${MAP_IDS.map((id) => `<button data-v="${id}" class="${p.map === id ? 'on' : ''}" title="${MAPS[id].blurb}">${MAPS[id].name}</button>`).join('')}</div>
      <div class="mhead">Time of day</div>
      <div class="seg" id="seg-time">${TIME_IDS.map((id) => `<button data-v="${id}" class="${p.time === id ? 'on' : ''}">${TIMES[id].name}</button>`).join('')}</div>
      <button class="mbtn primary" id="b-go" style="margin-top:10px"><span>Kick off</span></button>
      <button class="mbtn back" data-go="s-main"><span>← Back</span></button>
    </div>
    <div class="screen" id="s-online" hidden>
      <div class="hint">Make a lobby and send your friends the code or the link. Up to 8 cars; empty seats can be filled with bots.</div>
      <button class="mbtn primary" id="b-host"><span>Create lobby</span></button>
      <div class="field" style="margin-top:12px"><label>Join with a code</label><input type="text" class="code-in" id="i-code" maxlength="4" placeholder="ABCD" autocomplete="off" spellcheck="false" /></div>
      <button class="mbtn" id="b-join"><span>Join lobby</span></button>
      <div class="msg" id="online-msg"></div>
      <button class="mbtn back" data-go="s-main"><span>← Back</span></button>
    </div>
    <div class="screen" id="s-garage" hidden>
      <div class="field"><label>Name</label><input type="text" id="i-name" maxlength="16" value="${esc(p.name)}" spellcheck="false" /></div>
      <div class="field"><label>Accent paint</label><div class="swatches" id="sw">${PAINTS.map((c) => `<button data-c="${c}" style="background:${hex(c)}" class="${c === p.accent ? 'on' : ''}"></button>`).join('')}</div></div>
      <div class="hint">Your car wears your team's colour; the accent goes on the stripes, the wing and the rims.</div>
      <button class="mbtn back" data-go="s-main"><span>← Back</span></button>
    </div>
    <div class="foot">An original fan-made game. Physics tuned to the published numbers of the rocket-car genre.</div>
  </div>
</div>

<div class="lobby" id="m-lobby" hidden>
  <div class="box screen">
    <div class="top">
      <div><div class="mhead">Online lobby</div><div class="title" id="l-title">Private match</div></div>
      <div class="code"><small>ROOM CODE</small><b id="l-code">----</b><br /><button id="l-copy">Copy invite link</button></div>
    </div>
    <div class="teams">
      <div class="team b"><h3>Blue <button data-team="0">Join blue</button></h3><div id="l-blue"></div></div>
      <div class="team o"><h3>Orange <button data-team="1">Join orange</button></h3><div id="l-orange"></div></div>
    </div>
    <div class="opts" id="l-host-opts">
      <div class="opt"><label>Bots</label><div class="seg small" id="l-fill" title="Even teams: bots only make up a short side (4 players in a 2v2 = no bots, 2 v 1 = one bot). Fill seats: every empty seat up to the team size."><button data-v="even">Even teams</button><button data-v="full">Fill seats</button><button data-v="none">No bots</button></div></div>
      <div class="opt" id="l-size-opt"><label>Team size</label><div class="seg small" id="l-size"><button data-v="1">1v1</button><button data-v="2">2v2</button><button data-v="3">3v3</button><button data-v="4">4v4</button></div></div>
      <div class="opt"><label>Length</label><div class="seg small" id="l-min"><button data-v="3">3 min</button><button data-v="5">5 min</button><button data-v="10">10 min</button></div></div>
      <div class="opt wide"><label>Arena</label><div class="seg small" id="l-map">${MAP_IDS.map((id) => `<button data-v="${id}" title="${MAPS[id].blurb}">${MAPS[id].name}</button>`).join('')}</div></div>
      <div class="opt wide"><label>Time of day</label><div class="seg small" id="l-time">${TIME_IDS.map((id) => `<button data-v="${id}">${TIMES[id].name}</button>`).join('')}</div></div>
    </div>
    <div class="chat"><div class="log" id="l-log"></div><input type="text" id="l-chat" maxlength="120" placeholder="Say something… (Enter)" /></div>
    <div class="row">
      <button class="mbtn primary" id="l-start"><span>Start match</span></button>
      <div class="hint" id="l-wait"></div>
      <button class="mbtn back" id="l-leave" style="margin-left:auto"><span>Leave lobby</span></button>
    </div>
  </div>
</div>

<div class="hud" id="hud" hidden>
  <div class="sb"><div class="s b"><span id="h-sb">0</span></div><div class="clock" id="h-clk"><span>5:00</span></div><div class="s o"><span id="h-so">0</span></div></div>
  <div class="feed"></div>
  <div class="boost"><svg viewBox="0 0 200 200" id="h-bsvg"></svg><div class="num" id="h-bn">33</div><div class="lbl">BOOST</div></div>
  <div class="count" id="h-count"></div>
  <div class="banner" id="h-banner"><div class="big" id="h-bbig"></div><div class="sub" id="h-bsub"></div></div>
  <div class="camtag" id="h-cam">BALL CAM</div>
  <div class="net" id="h-net"></div>
  <div class="replay" id="h-replay">REPLAY<small id="h-skip"></small></div>
  <div class="tip" id="h-tip"></div>
  <div class="toast" id="h-toast"></div>
  <div class="awards" id="h-awards"></div>
</div>

<div class="overlay" id="o-board" hidden><div class="board" id="board"></div></div>
<div class="overlay" id="o-pause" hidden>
  <div class="pause screen">
    <h2>Paused</h2>
    <div class="slider"><span>Field of view</span><input type="range" id="p-fov" min="70" max="120" step="1" value="${p.fov}" /><b id="p-fov-v">${p.fov}</b></div>
    <div class="slider"><span>Cam distance</span><input type="range" id="p-dist" min="180" max="400" step="10" value="${p.dist}" /><b id="p-dist-v">${p.dist}</b></div>
    <div class="slider"><span>Cam height</span><input type="range" id="p-height" min="50" max="200" step="5" value="${p.height}" /><b id="p-height-v">${p.height}</b></div>
    <div class="slider"><span>Cam angle</span><input type="range" id="p-angle" min="-15" max="0" step="1" value="${p.angle}" /><b id="p-angle-v">${p.angle}</b></div>
    <div class="slider"><span>Cam stiffness</span><input type="range" id="p-stiff" min="0" max="1" step="0.05" value="${p.stiff}" /><b id="p-stiff-v">${p.stiff.toFixed(2)}</b></div>
    <div class="slider"><span>Transition speed</span><input type="range" id="p-trans" min="1" max="2" step="0.1" value="${p.trans}" /><b id="p-trans-v">${p.trans.toFixed(1)}</b></div>
    <div class="slider"><span>Volume</span><input type="range" id="p-vol" min="0" max="1" step="0.05" value="${p.volume}" /><b id="p-vol-v">${Math.round(p.volume * 100)}</b></div>
    <div class="seg" id="p-shake"><button data-v="1" class="${p.shake ? 'on' : ''}">Camera shake</button><button data-v="0" class="${p.shake ? '' : 'on'}">No shake</button></div>
    <button class="mbtn small" id="p-binds" style="margin-top:8px"><span>Controls</span></button>
    <button class="mbtn primary small" id="p-resume"><span>Resume</span></button>
    <button class="mbtn small" id="p-leave"><span>Leave match</span></button>
  </div>
</div>
<div class="overlay" id="o-binds" hidden>
  <div class="binds screen">
    <div class="bhead"><h2>Controls</h2><div class="padinfo" id="b-pad">No controller connected</div></div>
    <div class="btable" id="b-table"></div>
    <div class="bsets">
      <div class="slider"><span>Controller deadzone</span><input type="range" id="b-dz" min="0.02" max="0.3" step="0.01" value="${p.deadzone}" /><b id="b-dz-v">${p.deadzone.toFixed(2)}</b></div>
      <div class="slider"><span>Steering sensitivity</span><input type="range" id="b-ss" min="0.5" max="2" step="0.05" value="${p.steerSens}" /><b id="b-ss-v">${p.steerSens.toFixed(2)}</b></div>
      <div class="slider"><span>Aerial sensitivity</span><input type="range" id="b-as" min="0.5" max="2" step="0.05" value="${p.airSens}" /><b id="b-as-v">${p.airSens.toFixed(2)}</b></div>
      <div class="seg" id="b-rumble"><button data-v="1" class="${p.rumble ? 'on' : ''}">Vibration on</button><button data-v="0" class="${p.rumble ? '' : 'on'}">Vibration off</button></div>
    </div>
    <div class="row"><button class="mbtn small" id="b-reset"><span>Reset to defaults</span></button><button class="mbtn primary small" id="b-done" data-pad-back><span>Done</span></button></div>
    <div class="capture" id="b-cap" hidden><div><b id="b-cap-t">Press a key</b><small>Esc cancels · Delete clears</small><button class="mbtn small" id="b-cap-x" data-cap-ui><span>Cancel</span></button></div></div>
  </div>
</div>
<div class="overlay" id="o-end" hidden><div class="end screen" id="end"></div></div>
`;
  }

  private wire(): void {
    const r = this.root;
    r.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('button');
      if (t) this.onClick();
      const go = t?.getAttribute('data-go');
      if (go) this.screen(go);
    });
    const seg = (id: string, f: (v: string) => void) => {
      const el = this.$(id);
      el.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b) return;
        el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        f(b.getAttribute('data-v')!);
      });
    };
    seg('#seg-size', (v) => (this.playSize = Number(v)));
    seg('#seg-skill', (v) => (this.playSkill = Number(v)));
    seg('#seg-min', (v) => (this.playMin = Number(v)));
    seg('#seg-map', (v) => {
      this.profile.map = asMap(v);
      this.save();
    });
    seg('#seg-time', (v) => {
      this.profile.time = asTime(v);
      this.save();
    });
    this.$('#b-go').addEventListener('click', () => this.onPlay(this.playSize, this.playSkill, this.playMin));
    this.$('#b-free').addEventListener('click', () => this.onFreeplay());
    this.$('#b-games').addEventListener('click', () => (location.href = './?pick'));
    this.$('#b-host').addEventListener('click', () => this.onHost());
    const code = this.$<HTMLInputElement>('#i-code');
    code.addEventListener('input', () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    code.addEventListener('keydown', (e) => e.key === 'Enter' && this.onJoin(code.value));
    this.$('#b-join').addEventListener('click', () => this.onJoin(code.value));
    const name = this.$<HTMLInputElement>('#i-name');
    name.addEventListener('input', () => {
      this.profile.name = name.value.trim().slice(0, 16) || 'Player';
      this.save();
    });
    this.$('#sw').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.$('#sw')
        .querySelectorAll('button')
        .forEach((x) => x.classList.toggle('on', x === b));
      this.profile.accent = Number(b.getAttribute('data-c'));
      this.save();
    });
    // lobby
    r.querySelectorAll('.team h3 button').forEach((b) => b.addEventListener('click', () => this.onLobbyTeam(Number(b.getAttribute('data-team')) as 0 | 1)));
    this.$('#l-start').addEventListener('click', () => this.onLobbyStart());
    this.$('#l-leave').addEventListener('click', () => this.onLobbyLeave());
    seg('#l-size', (v) => this.onLobbyOpt({ size: Number(v) as 1 | 2 | 3 | 4 }));
    seg('#l-min', (v) => this.onLobbyOpt({ minutes: Number(v) }));
    seg('#l-fill', (v) => this.onLobbyOpt({ bots: (v === 'full' || v === 'none' ? v : 'even') as BotMode }));
    seg('#l-map', (v) => this.onLobbyOpt({ map: asMap(v) }));
    seg('#l-time', (v) => this.onLobbyOpt({ time: asTime(v) }));
    this.$('#l-copy').addEventListener('click', () => {
      const c = this.$('#l-code').textContent ?? '';
      const url = `${location.origin}${location.pathname}?join=${c}`;
      void navigator.clipboard?.writeText(url).then(() => this.toast('Invite link copied'));
    });
    const chat = this.$<HTMLInputElement>('#l-chat');
    chat.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && chat.value.trim()) {
        this.onChat(chat.value.trim());
        chat.value = '';
      }
    });
    r.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest('[data-kick]');
      if (k) this.onLobbyKick(k.getAttribute('data-kick')!);
    });
    // pause
    const slider = (id: string, key: 'fov' | 'dist' | 'height' | 'angle' | 'stiff' | 'trans' | 'volume', fmt = (v: number) => String(v)) => {
      const el = this.$<HTMLInputElement>(id);
      el.addEventListener('input', () => {
        this.profile[key] = Number(el.value);
        this.$(id + '-v').textContent = fmt(Number(el.value));
        this.save();
      });
    };
    slider('#p-fov', 'fov');
    slider('#p-dist', 'dist');
    slider('#p-height', 'height');
    slider('#p-angle', 'angle');
    slider('#p-stiff', 'stiff', (v) => v.toFixed(2));
    slider('#p-trans', 'trans', (v) => v.toFixed(1));
    slider('#p-vol', 'volume', (v) => String(Math.round(v * 100)));
    seg('#p-shake', (v) => {
      this.profile.shake = v === '1';
      this.save();
    });
    this.$('#p-resume').addEventListener('click', () => this.onResume());
    this.wireBinds(seg);
    this.$('#p-leave').addEventListener('click', () => this.onLeave());
  }

  private save(): void {
    saveProfile(this.profile);
    this.onProfile(this.profile);
  }

  // ------------------------------------------------------------ controls (rebinding)
  private wireBinds(seg: (id: string, f: (v: string) => void) => void): void {
    const open = () => {
      this.drawBinds();
      this.$('#o-binds').hidden = false;
      this.onBindsOpen(true);
    };
    this.$('#b-binds').addEventListener('click', open);
    this.$('#p-binds').addEventListener('click', open);
    this.$('#b-done').addEventListener('click', () => {
      this.stopCapture();
      this.$('#o-binds').hidden = true;
      this.onBindsOpen(false);
    });
    this.$('#b-reset').addEventListener('click', () => {
      this.profile.binds = structuredClone(DEFAULT_KEYS);
      this.profile.padBinds = { ...DEFAULT_PAD };
      this.save();
      this.drawBinds();
      this.toast('Controls reset to the defaults');
    });
    this.$('#b-table').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-bind]');
      if (!b) return;
      const [act, kind, slot] = b.getAttribute('data-bind')!.split(':');
      this.cap = { act: act as Act, kind: kind as 'key' | 'pad', slot: Number(slot) };
      this.$('#b-cap-t').textContent = kind === 'pad' ? `Press a controller button for ${ACTS.find((a) => a.id === act)!.name}` : `Press a key or mouse button for ${ACTS.find((a) => a.id === act)!.name}`;
      this.$('#b-cap').hidden = false;
      this.onCaptureStart(this.cap.act, this.cap.kind, this.cap.slot);
    });
    this.$('#b-cap-x').addEventListener('click', () => this.stopCapture());
    const pslider = (id: string, key: 'deadzone' | 'steerSens' | 'airSens') => {
      const el = this.$<HTMLInputElement>(id);
      el.addEventListener('input', () => {
        this.profile[key] = Number(el.value);
        this.$(id + '-v').textContent = Number(el.value).toFixed(2);
        this.save();
      });
    };
    pslider('#b-dz', 'deadzone');
    pslider('#b-ss', 'steerSens');
    pslider('#b-as', 'airSens');
    seg('#b-rumble', (v) => {
      this.profile.rumble = v === '1';
      this.save();
    });
  }

  private stopCapture(): void {
    if (!this.cap) return;
    this.cap = null;
    this.$('#b-cap').hidden = true;
    this.onCaptureEnd();
  }

  /** the captured key / button: Escape cancels, Delete / Backspace clears the slot */
  bindTo(kind: 'key' | 'pad', code: string | number): void {
    const c = this.cap;
    if (!c) return;
    if (kind === 'key' && code === 'Escape') return this.stopCapture();
    const clear = kind === 'key' && (code === 'Delete' || code === 'Backspace');
    if (c.kind === 'key') {
      if (kind !== 'key') return;
      if (c.act === 'pause' && clear) return this.stopCapture();
      this.profile.binds[c.act][c.slot] = clear ? '' : String(code);
    } else {
      if (kind === 'key' && !clear) return;
      this.profile.padBinds[c.act] = clear ? -1 : Number(code);
    }
    this.save();
    this.stopCapture();
    this.drawBinds();
  }

  bindsOpen(): boolean {
    return !this.$('#o-binds').hidden;
  }

  /** the connected controller, for the menu and the controls screen */
  padInfo(name: string, ps: boolean): void {
    this.padPS = ps;
    const label = name ? (ps ? 'PlayStation controller connected' : 'Controller connected') : 'No controller connected';
    this.$('#b-pad').textContent = name ? `${label} · ${name.replace(/\s*\(.*$/, '').slice(0, 40)}` : `${label} · plug one in or pair it over Bluetooth, then press a button`;
    this.$('#pad-status').textContent = name ? (ps ? 'PlayStation controller ready' : 'Controller ready') : 'Keyboard & mouse · controller';
    if (!this.$('#o-binds').hidden) this.drawBinds();
  }

  private drawBinds(): void {
    const p = this.profile;
    const ps = this.padPS;
    const fixed: Partial<Record<Act, string>> = { left: 'Left stick', right: 'Left stick', pitchUp: 'Left stick', pitchDown: 'Left stick' };
    const cell = (act: Act, kind: 'key' | 'pad', slot: number, label: string) => `<button class="bind ${label === '—' ? 'none' : ''}" data-bind="${act}:${kind}:${slot}">${esc(label)}</button>`;
    this.$('#b-table').innerHTML =
      `<div class="bh"><span>Action</span><span>Key</span><span>Alternate</span><span>${ps ? 'PlayStation' : 'Controller'}</span></div>` +
      ACTS.map((a) => {
        const k = p.binds[a.id];
        const pad = a.pad ? cell(a.id, 'pad', 0, padName(p.padBinds[a.id], ps)) : `<em class="fixed">${fixed[a.id] ?? '—'}</em>`;
        return `<div class="br"><span>${esc(a.name)}</span>${cell(a.id, 'key', 0, keyName(k[0]))}${cell(a.id, 'key', 1, keyName(k[1]))}${pad}</div>`;
      }).join('');
  }

  /** a menu or overlay is up (the pad drives the focus ring, not the car) */
  menuOpen(): boolean {
    return ['#m-menu', '#m-lobby', '#o-pause', '#o-end', '#o-binds'].some((id) => !this.$(id).hidden);
  }

  // ------------------------------------------------------------ screens
  screen(id: string): void {
    this.root.querySelectorAll('#m-menu .screen').forEach((s) => ((s as HTMLElement).hidden = s.id !== id));
    this.onScreen(id);
  }
  showMenu(v: boolean): void {
    this.$('#m-menu').hidden = !v;
    if (v) this.screen('s-main');
  }
  showLobby(v: boolean): void {
    this.$('#m-lobby').hidden = !v;
  }
  showHud(v: boolean): void {
    this.$('#hud').hidden = !v;
    if (!v) {
      this.$('#o-board').hidden = true;
      this.$('#o-pause').hidden = true;
      this.$('#o-end').hidden = true;
    }
  }
  onlineMsg(s: string): void {
    this.$('#online-msg').textContent = s;
  }
  setJoinCode(c: string): void {
    this.$<HTMLInputElement>('#i-code').value = c;
  }

  lobby(l: LobbyState, me: string, host: boolean): void {
    this.$('#l-code').textContent = l.code;
    this.$('#l-title').textContent = l.inMatch ? 'Match in progress' : `${l.bots === 'full' ? `${l.size}v${l.size} ` : ''}private match`;
    const card = (p: LobbyState['players'][number]) =>
      `<div class="pl ${p.id === me ? 'me' : ''}"><i style="background:${hex(p.color)}"></i>${esc(p.name)}${p.bot ? ' <em>BOT</em>' : `<em>${p.id === 'host' ? 'HOST' : p.ping ? Math.round(p.ping) + ' ms' : ''}</em>`}${host && p.id !== 'host' && !p.bot ? `<button data-kick="${esc(p.id)}" title="Kick">✕</button>` : ''}</div>`;
    this.$('#l-blue').innerHTML = l.players.filter((p) => p.team === 0).map(card).join('');
    this.$('#l-orange').innerHTML = l.players.filter((p) => p.team === 1).map(card).join('');
    this.$('#l-host-opts').style.display = host ? '' : 'none';
    this.$('#l-start').style.display = host ? '' : 'none';
    const plan = botPlan(l);
    const nb = plan.blue + plan.orange;
    const kick = `Kick-off: ${plan.size}v${plan.size}` + (nb ? ` · ${nb} bot${nb > 1 ? 's' : ''} (${plan.blue ? plan.blue + ' blue' : ''}${plan.blue && plan.orange ? ', ' : ''}${plan.orange ? plan.orange + ' orange' : ''})` : ' · no bots');
    this.$('#l-wait').textContent = host ? kick : `${kick} · waiting for the host to start…`;
    const mark = (id: string, v: string) => this.$(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.getAttribute('data-v') === v));
    mark('#l-size', String(l.size));
    // (the team size only matters when every seat is filled)
    this.$('#l-size-opt').style.display = l.bots === 'full' ? '' : 'none';
    mark('#l-min', String(l.minutes));
    mark('#l-fill', l.bots ?? 'even');
    mark('#l-map', asMap(l.map));
    mark('#l-time', asTime(l.time));
  }

  chat(from: string, text: string): void {
    const log = this.$('#l-log');
    log.insertAdjacentHTML('beforeend', `<div><b>${esc(from)}:</b> ${esc(text)}</div>`);
    log.scrollTop = log.scrollHeight;
  }

  // ------------------------------------------------------------ hud
  score(s: [number, number], clock: number, overtime: boolean): void {
    this.$('#h-sb').textContent = String(s[0]);
    this.$('#h-so').textContent = String(s[1]);
    const c = this.$('#h-clk');
    const t = Math.max(0, overtime ? Math.floor(clock) : Math.ceil(clock));
    c.firstElementChild!.textContent = `${overtime ? '+' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    c.classList.toggle('ot', overtime);
  }

  clockText(clock: number, overtime: boolean): string {
    const t = Math.max(0, overtime ? Math.floor(clock) : Math.ceil(clock));
    return `${overtime ? '+' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  private lastBoost = -1;
  drawBoost(v: number, team = 0): void {
    const b = Math.round(v);
    if (b === this.lastBoost) return;
    this.lastBoost = b;
    this.$('#h-bn').textContent = String(b);
    const a0 = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;
    const arc = (r: number, f: number) => {
      const a1 = a0 + sweep * f;
      const x0 = 100 + Math.cos(a0) * r;
      const y0 = 100 + Math.sin(a0) * r;
      const x1 = 100 + Math.cos(a1) * r;
      const y1 = 100 + Math.sin(a1) * r;
      return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${sweep * f > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    };
    const col = team === 0 ? '#3d8bff' : '#ff8a30';
    const hot = b >= 100 ? '#ffd34a' : col;
    this.$('#h-bsvg').innerHTML = `
      <defs><filter id="bg"><feGaussianBlur stdDeviation="4"/></filter></defs>
      <circle cx="100" cy="100" r="78" fill="rgba(6,9,18,0.72)"/>
      <path d="${arc(84, 1)}" stroke="rgba(255,255,255,0.12)" stroke-width="12" fill="none" stroke-linecap="round"/>
      ${b > 0 ? `<path d="${arc(84, b / 100)}" stroke="${hot}" stroke-width="12" fill="none" stroke-linecap="round" filter="url(#bg)" opacity="0.8"/><path d="${arc(84, b / 100)}" stroke="${hot}" stroke-width="10" fill="none" stroke-linecap="round"/>` : ''}`;
  }

  count(n: number | 'GO!'): void {
    const el = this.$('#h-count');
    el.textContent = String(n);
    el.style.color = n === 'GO!' ? '#ffd34a' : '#fff';
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  banner(big: string, sub: string, team: number, ms = 2600): void {
    const b = this.$('#h-banner');
    const bb = this.$('#h-bbig');
    bb.textContent = big;
    bb.className = 'big ' + (team === 0 ? 'b' : team === 1 ? 'o' : '');
    this.$('#h-bsub').textContent = sub;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout((b as unknown as { _t: number })._t);
    (b as unknown as { _t: number })._t = window.setTimeout(() => b.classList.remove('on'), ms);
  }

  feed(text: string, team: number): void {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.setProperty('--c', team === 0 ? '#3d8bff' : team === 1 ? '#ff8a30' : '#fff');
    this.feedEl.prepend(d);
    while (this.feedEl.children.length > 5) this.feedEl.lastElementChild!.remove();
    setTimeout(() => d.remove(), 5000);
  }

  cam(ball: boolean): void {
    const c = this.$('#h-cam');
    c.textContent = ball ? 'BALL CAM' : 'CAR CAM';
    c.classList.toggle('on', ball);
  }

  net(s: string): void {
    this.$('#h-net').textContent = s;
  }

  tip(s: string): void {
    this.$('#h-tip').textContent = s;
  }

  replay(v: boolean): void {
    this.$('#h-replay').style.display = v ? 'block' : 'none';
  }

  /** the skip tally under REPLAY: n of `of` players (n = -1: you've asked, waiting on the host) */
  skipVotes(n: number, of: number, pad = false, voted = false): void {
    const key = (pad ? padName(this.profile.padBinds.reset, this.padPS) : keyName(this.profile.binds.reset[0])).toUpperCase();
    let t = `${key} TO SKIP`;
    if (n < 0) t = 'WAITING FOR THE OTHERS';
    else if (n > 0 && n >= of) t = 'SKIPPING';
    else if (n > 0) t = `${n}/${of} WANT TO SKIP · ${voted ? 'WAITING FOR THE OTHERS' : `${key} TO SKIP`}`;
    this.$('#h-skip').textContent = t;
  }

  toast(s: string, ms = 2200): void {
    const t = this.$('#h-toast');
    t.textContent = s;
    t.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => t.classList.remove('on'), ms);
  }

  /** a points pop-up for you, stacking like the arena game's */
  award(what: string, pts: number): void {
    const box = this.$('#h-awards');
    const d = document.createElement('div');
    d.innerHTML = `<b>${esc(what)}</b><i>+${pts}</i>`;
    if (pts >= 50) d.classList.add('big');
    box.prepend(d);
    while (box.children.length > 4) box.lastElementChild!.remove();
    setTimeout(() => d.classList.add('out'), 2200);
    setTimeout(() => d.remove(), 2700);
  }

  board(show: boolean, rows?: { name: string; team: number; st: Stats; me: boolean; ping?: number }[], score?: [number, number]): void {
    const o = this.$('#o-board');
    o.hidden = !show;
    if (!show || !rows || !score) return;
    this.$('#board').innerHTML = this.table(rows, score);
  }

  private table(rows: { name: string; team: number; st: Stats; me: boolean; ping?: number }[], score: [number, number]): string {
    const sorted = [...rows].sort((a, b) => a.team - b.team || b.st.score - a.st.score);
    return `<div class="hd"><span class="b">Blue ${score[0]}</span><span class="o">${score[1]} Orange</span></div>
      <table><tr><th>PLAYER</th><th>SCORE</th><th>GOALS</th><th>ASSISTS</th><th>SAVES</th><th>SHOTS</th><th>DEMOS</th><th>PING</th></tr>
      ${sorted.map((r) => `<tr class="${r.team === 0 ? 'b' : 'o'} ${r.me ? 'me' : ''}"><td>${esc(r.name)}</td><td>${r.st.score}</td><td>${r.st.goals}</td><td>${r.st.assists}</td><td>${r.st.saves}</td><td>${r.st.shots}</td><td>${r.st.demos}</td><td>${r.ping ? Math.round(r.ping) : '–'}</td></tr>`).join('')}
      </table>`;
  }

  pause(v: boolean): void {
    this.$('#o-pause').hidden = !v;
  }

  end(winner: number, rows: { name: string; team: number; st: Stats; me: boolean }[], score: [number, number], again: string | null, leave: string): void {
    const mvp = [...rows].filter((r) => r.team === winner).sort((a, b) => b.st.score - a.st.score)[0];
    const el = this.$('#end');
    el.innerHTML = `<h2 class="${winner === 0 ? 'b' : 'o'}">${winner === 0 ? 'Blue' : 'Orange'} wins</h2>
      ${mvp ? `<div class="mvp">MVP · ${esc(mvp.name)} · ${mvp.st.score} pts</div>` : ''}
      <div class="board">${this.table(rows, score)}</div>
      <div class="row">${again ? `<button class="mbtn primary small" id="e-again"><span>${again}</span></button>` : ''}<button class="mbtn small" id="e-leave"><span>${leave}</span></button></div>`;
    this.$('#o-end').hidden = false;
    el.querySelector('#e-again')?.addEventListener('click', () => this.onAgain());
    el.querySelector('#e-leave')?.addEventListener('click', () => this.onLeave());
  }

  hideEnd(): void {
    this.$('#o-end').hidden = true;
  }
}
