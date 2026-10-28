import { ACTS, DEFAULT_KEYS, DEFAULT_PAD, keyName, OLD_PAD_ROLL, padName, type Act, type KeyBinds, type PadBinds } from './input.ts';
import { botPlan, type BotMode, type LobbyState } from './net.ts';
import { asMap, asTime, MAP_IDS, MAPS, TIME_IDS, TIMES, type MapId, type MapLook, type TimeId } from './render/looks.ts';
import { BODIES, BOOMS, DECALS, FINISHES, packLoadout, TRAILS } from './loadout.ts';
import type { Stats } from './sim/world.ts';

/**
 * Every screen and the HUD, as plain DOM over the canvas. The game drives it: show/hide screens,
 * push scores, boost, countdowns, banners and the event feed; the menus call back through `on*`.
 */

export const PAINTS = [0xffffff, 0x1b1d22, 0xffd23a, 0x39e07a, 0xff3b5c, 0xb06bff, 0x2ee6e6, 0xff8ad1, 0xa8ff3a, 0x8a5a2b, 0xc0c6d0, 0xff5a1f, 0x3a6bff, 0x00b38f, 0xffb3a1, 0x6a7380];
const hex = (c: number) => '#' + (c % 0x1000000).toString(16).padStart(6, '0');

// line icons for the menus (24×24, stroked in currentColor)
const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  friends: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.5" cy="9" r="2.4"/><path d="M16 14.2c2.9.3 5 2.6 5 5.8"/>'),
  bots: svg('<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4"/><circle cx="12" cy="3.5" r="1"/><circle cx="9.5" cy="13.5" r="1.3"/><circle cx="14.5" cy="13.5" r="1.3"/><path d="M2.5 13v2M21.5 13v2"/>'),
  free: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5l2.6 4.3-2.6 3.2-2.6-3.2z"/><path d="M4.2 9.6l4.6 1.4 1 4-3.6 2.6M19.8 9.6l-4.6 1.4-1 4 3.6 2.6"/>'),
  garage: svg('<path d="M3 15l2-5.5C5.5 8 6.6 7 8 7h8c1.4 0 2.5 1 3 2.5L21 15v3h-2.5M5.5 18H3v-3"/><circle cx="7.5" cy="17.5" r="2"/><circle cx="16.5" cy="17.5" r="2"/><path d="M9.5 17.5h5M3 13h18"/>'),
  controls: svg('<path d="M6.5 8h11a4.5 4.5 0 0 1 4.3 5.8l-1 3.4a2.4 2.4 0 0 1-4.1.9L14.6 16H9.4l-2.1 2.1a2.4 2.4 0 0 1-4.1-.9l-1-3.4A4.5 4.5 0 0 1 6.5 8z"/><path d="M7 11v3M5.5 12.5h3"/><circle cx="16" cy="11.5" r=".6"/><circle cx="18" cy="13.5" r=".6"/>'),
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  go: svg('<path d="M7 4.5v15l12-7.5z"/>'),
};
const TIME_ICON: Record<TimeId, string> = {
  morning: svg('<path d="M3 18h18M6 18a6 6 0 0 1 12 0"/><path d="M12 6v2M5.6 9.6l1.4 1.4M18.4 9.6L17 11"/>'),
  day: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'),
  sunset: svg('<path d="M3 17h18M7 17a5 5 0 0 1 10 0"/><path d="M12 9V4M9.5 6.5L12 4l2.5 2.5"/><path d="M5 21h14"/>'),
  night: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
};
/** the skyline drawn over an arena card's colour (what stands beyond its bowl) */
function arenaArt(id: MapId): string {
  const m = MAPS[id];
  const fill = 'rgba(4,8,18,0.55)';
  const bowl = `<path d="M0 74 Q50 54 100 74 L100 100 L0 100Z" fill="rgba(4,8,18,0.7)"/><path d="M8 80 Q50 64 92 80" stroke="rgba(255,255,255,0.45)" stroke-width="1.2" fill="none"/>`;
  const far: Record<MapLook['surround'], string> = {
    none: `<path d="M0 60 Q50 30 100 60 L100 70 Q50 44 0 70Z" fill="${fill}"/><g fill="rgba(255,255,255,0.75)">${[14, 30, 50, 70, 86].map((x) => `<rect x="${x - 2}" y="${48 - Math.sin((x / 100) * Math.PI) * 12}" width="4" height="2" rx="1"/>`).join('')}</g>`,
    mountains: `<path d="M0 66 L14 40 L22 50 L36 22 L48 44 L58 32 L72 52 L84 30 L100 56 L100 74 L0 74Z" fill="${fill}"/><path d="M33 27 L36 22 L40 29 L37 28Z M81 35 L84 30 L88 37 L85 36Z" fill="rgba(255,255,255,0.85)"/>`,
    city: `<g fill="${fill}">${[[4, 36], [12, 24], [20, 44], [28, 14], [36, 32], [46, 20], [56, 40], [64, 10], [74, 30], [84, 22], [92, 40]].map(([x, y]) => `<rect x="${x}" y="${y}" width="7" height="${74 - y}"/>`).join('')}</g><g fill="rgba(120,240,255,0.8)">${[[30, 20], [66, 16], [48, 26], [86, 28]].map(([x, y]) => `<rect x="${x}" y="${y}" width="2" height="2"/>`).join('')}</g>`,
    hills: `<path d="M0 60 Q20 40 40 56 T80 50 T100 54 L100 74 L0 74Z" fill="${fill}"/><g fill="rgba(4,30,10,0.6)">${[10, 18, 62, 70, 78, 90].map((x, k) => `<circle cx="${x}" cy="${52 - (k % 2) * 3}" r="4"/>`).join('')}</g>`,
    canyon: `<path d="M0 60 L8 60 L8 40 L26 40 L26 52 L44 52 L44 30 L60 30 L60 48 L74 48 L74 36 L92 36 L92 56 L100 56 L100 74 L0 74Z" fill="${fill}"/>`,
  };
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${far[m.surround]}${bowl}</svg>`;
}
// garage swatches: a sketch of each car's stance, each trail's colours, each explosion's look
const BODY_ART = [
  'linear-gradient(160deg,#3d8bff 0 45%,#0d1a33 46%)',
  'linear-gradient(172deg,#3d8bff 0 52%,#0d1a33 53%)',
  'linear-gradient(176deg,#3d8bff 0 60%,#0d1a33 61%)',
  'linear-gradient(168deg,#3d8bff 0 55%,#0d1a33 56%)',
  'linear-gradient(165deg,#3d8bff 0 50%,#0d1a33 51%)',
  'linear-gradient(180deg,#0d1a33 0 18%,#3d8bff 19% 62%,#0d1a33 63%)',
];
const TRAIL_ART = [
  'linear-gradient(90deg,transparent,#3d8bff 40%,#bfe0ff)',
  'linear-gradient(90deg,transparent,#c14cff 40%,#ffe0ff)',
  'linear-gradient(90deg,#ff4040,#ffb020,#ffff40,#40ff70,#40b0ff,#b050ff)',
  'repeating-linear-gradient(115deg,#0b1430 0 6px,#9fe6ff 6px 8px,#0b1430 8px 14px)',
  'linear-gradient(90deg,#2a1208,#ff3a0a 40%,#ffd040)',
  'radial-gradient(circle at 20% 40%,#fff 0 2px,transparent 3px),radial-gradient(circle at 60% 70%,#ffe08a 0 2px,transparent 3px),radial-gradient(circle at 80% 30%,#fff 0 1.5px,transparent 2.5px),linear-gradient(90deg,#0b1430,#3a2f6a)',
];
const TRAIL_BLURB = ['Your team\'s jet, sparks and smoke', 'A clean jet in your accent paint', 'Every colour, cycling', 'Crackling blue-white arcs', 'Roaring flames, thick smoke', 'Glittering gold and white'];
const BOOM_ART = [
  'radial-gradient(circle,#fff 0 12%,#ffb040 25%,#ff5a0a 45%,#1a0d05 75%)',
  'radial-gradient(circle,#fff 0 8%,transparent 9% 30%,#8fd8ff 31% 36%,transparent 37% 55%,#4fa0ff 56% 60%,#08101e 61%)',
  'radial-gradient(circle at 30% 40%,#ff5ab0 0 8%,transparent 9%),radial-gradient(circle at 70% 35%,#5affc0 0 8%,transparent 9%),radial-gradient(circle at 50% 70%,#ffd040 0 9%,transparent 10%),#0a0e20',
  'conic-gradient(from 0deg,#2a1060,#8a5aff,#2a1060,#c0a0ff,#2a1060)',
  'radial-gradient(circle at 20% 30%,#ff4060 0 4px,transparent 5px),radial-gradient(circle at 70% 60%,#40d0ff 0 4px,transparent 5px),radial-gradient(circle at 40% 75%,#ffe040 0 4px,transparent 5px),radial-gradient(circle at 80% 25%,#60ff80 0 4px,transparent 5px),#1a1d2e',
  'radial-gradient(circle,#000 0 22%,#7a3cff 30%,#1a0a33 50%,#05030a 75%)',
];
const BOOM_BLURB = ['A white-hot fireball and fireworks', 'Rings of light racing out', 'A barrage of coloured rockets', 'A twister of light up to the roof', 'A blast of party confetti', 'Everything sucked in, then out'];

const arenaCards = (sel?: MapId) =>
  MAP_IDS.map((id) => `<button data-v="${id}" class="acard ${sel === id ? 'on' : ''}" title="${MAPS[id].blurb}"><span class="art" style="background:${MAPS[id].theme.css}">${arenaArt(id)}</span><b>${MAPS[id].name}</b><small>${MAPS[id].blurb}</small></button>`).join('');
const timePills = (sel?: TimeId) => TIME_IDS.map((id) => `<button data-v="${id}" class="${sel === id ? 'on' : ''}">${TIME_ICON[id]}<span>${TIMES[id].name}</span></button>`).join('');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface Profile {
  name: string;
  accent: number;
  decal: number;
  finish: number;
  body: number;
  trail: number;
  boom: number;
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
  const def: Profile = { name: 'Player', accent: 0xffffff, decal: 0, finish: 0, body: 0, trail: 0, boom: 0, fov: 110, dist: 270, height: 100, angle: -4, stiff: 0.45, trans: 1.2, ballCam: true, volume: 0.8, shake: true, map: 'apex', time: 'day', binds: structuredClone(DEFAULT_KEYS), padBinds: { ...DEFAULT_PAD }, deadzone: 0.1, steerSens: 1, airSens: 1, rumble: true };
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
    // (L1 / R1 air roll were our own extra defaults: back to the genre's, unbound, unless changed)
    if (p.padBinds.rollLeft === OLD_PAD_ROLL[0] && p.padBinds.rollRight === OLD_PAD_ROLL[1]) {
      p.padBinds.rollLeft = -1;
      p.padBinds.rollRight = -1;
    }
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
  /** the garage wants a preview on the car: its boost trail, its goal explosion (null: none) */
  onPreview: (what: 'trail' | 'boom' | null) => void = () => {};
  private afterName: (() => void) | null = null;
  /** the garage tab open (the trail tab keeps the car boosting) */
  gTab = 'car';
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
      <button class="mbtn primary" id="b-friends"><i class="ic">${ICON.friends}</i><span>Play with friends<em>Online lobby · share a code</em></span></button>
      <button class="mbtn" data-go="s-play"><i class="ic">${ICON.bots}</i><span>Play vs bots<em>1v1 · 2v2 · 3v3</em></span></button>
      <button class="mbtn" id="b-free"><i class="ic">${ICON.free}</i><span>Free play<em>Just you and the ball</em></span></button>
      <button class="mbtn" data-go="s-garage"><i class="ic">${ICON.garage}</i><span>Garage<em>Car · paint · boost · goal explosion</em></span></button>
      <button class="mbtn" id="b-binds"><i class="ic">${ICON.controls}</i><span>Controls<em id="pad-status">Keyboard &amp; mouse · controller</em></span></button>
      <button class="mbtn back" id="b-games"><i class="ic">${ICON.back}</i><span>All games</span></button>
    </div>
    <div class="screen" id="s-play" hidden>
      <div class="row3">
        <div><div class="mhead">Team size</div><div class="seg" id="seg-size"><button data-v="1">1v1</button><button data-v="2" class="on">2v2</button><button data-v="3">3v3</button></div></div>
        <div><div class="mhead">Bot skill</div><div class="seg" id="seg-skill"><button data-v="0.3">Rookie</button><button data-v="0.55" class="on">Pro</button><button data-v="0.85">All-Star</button></div></div>
        <div><div class="mhead">Length</div><div class="seg" id="seg-min"><button data-v="3">3 min</button><button data-v="5" class="on">5 min</button><button data-v="10">10 min</button></div></div>
      </div>
      <div class="mhead">Arena</div>
      <div class="arenas" id="seg-map">${arenaCards(p.map)}</div>
      <div class="mhead">Time of day</div>
      <div class="pills" id="seg-time">${timePills(p.time)}</div>
      <button class="mbtn primary" id="b-go" style="margin-top:10px"><i class="ic">${ICON.go}</i><span>Kick off<em>Into the arena</em></span></button>
      <button class="mbtn back" data-go="s-main"><i class="ic">${ICON.back}</i><span>Back</span></button>
    </div>
    <div class="screen" id="s-online" hidden>
      <div class="hint">Make a lobby and send your friends the code or the link. Up to 8 cars; empty seats can be filled with bots.</div>
      <button class="mbtn primary" id="b-host"><span>Create lobby</span></button>
      <div class="field" style="margin-top:12px"><label>Join with a code</label><input type="text" class="code-in" id="i-code" maxlength="4" placeholder="ABCD" autocomplete="off" spellcheck="false" /></div>
      <button class="mbtn" id="b-join"><span>Join lobby</span></button>
      <div class="msg" id="online-msg"></div>
      <button class="mbtn back" data-go="s-main"><i class="ic">${ICON.back}</i><span>Back</span></button>
    </div>
    <div class="screen" id="s-garage" hidden>
      <div class="field"><label>Car name <small>shown over your car in online matches</small></label><input type="text" class="i-name" id="i-name" maxlength="16" value="${esc(p.name)}" spellcheck="false" /></div>
      <div class="tabs" id="g-tabs"><button data-tab="car" class="on">Car</button><button data-tab="paint">Paint</button><button data-tab="trail">Boost</button><button data-tab="boom">Goal explosion</button></div>
      <div class="pane" data-pane="car">
        <div class="items" id="seg-body">${BODIES.map((b, k) => `<button data-v="${k}" class="item ${p.body === k ? 'on' : ''}"><span class="sw" style="background:${BODY_ART[k]}"></span><b>${b.name}</b><small>${b.blurb}</small></button>`).join('')}</div>
      </div>
      <div class="pane" data-pane="paint" hidden>
        <div class="field"><label>Accent paint</label><div class="swatches" id="sw">${PAINTS.map((c) => `<button data-c="${c}" style="background:${hex(c)}" class="${c === p.accent ? 'on' : ''}"></button>`).join('')}</div></div>
        <div class="field"><label>Decal</label><div class="seg wrap three" id="seg-decal">${DECALS.map((d, k) => `<button data-v="${k}" class="${p.decal === k ? 'on' : ''}">${d}</button>`).join('')}</div></div>
        <div class="field"><label>Finish</label><div class="seg" id="seg-finish">${FINISHES.map((d, k) => `<button data-v="${k}" class="${p.finish === k ? 'on' : ''}">${d}</button>`).join('')}</div></div>
        <div class="hint">Your car wears your team's colour; the accent paints the decal, the wing and the rims.</div>
      </div>
      <div class="pane" data-pane="trail" hidden>
        <div class="items" id="seg-trail">${TRAILS.map((t, k) => `<button data-v="${k}" class="item ${p.trail === k ? 'on' : ''}"><span class="sw" style="background:${TRAIL_ART[k]}"></span><b>${t}</b><small>${TRAIL_BLURB[k]}</small></button>`).join('')}</div>
      </div>
      <div class="pane" data-pane="boom" hidden>
        <div class="items" id="seg-boom">${BOOMS.map((t, k) => `<button data-v="${k}" class="item ${p.boom === k ? 'on' : ''}"><span class="sw" style="background:${BOOM_ART[k]}"></span><b>${t}</b><small>${BOOM_BLURB[k]}</small></button>`).join('')}</div>
        <button class="mbtn small" id="b-boom"><i class="ic">${ICON.go}</i><span>Preview explosion</span></button>
      </div>
      <button class="mbtn back" data-go="s-main"><i class="ic">${ICON.back}</i><span>Back</span></button>
    </div>
    <div class="screen" id="s-name" hidden>
      <div class="mhead">Before you play online</div>
      <div class="namecard">
        <b>Name your car</b>
        <small>Your friends see it over your car and on the scoreboard.</small>
        <div class="namerow"><input type="text" class="i-name" id="i-name2" maxlength="16" placeholder="Your car's name" spellcheck="false" autocomplete="off" /><button class="dice" id="b-name-rnd" title="Random name">Random</button></div>
        <div class="msg" id="name-msg"></div>
      </div>
      <button class="mbtn primary" id="b-name-ok"><i class="ic">${ICON.go}</i><span>Continue<em>On to the online lobby</em></span></button>
      <button class="mbtn" data-go="s-garage"><i class="ic">${ICON.garage}</i><span>Equip it first<em>Car · paint · boost · explosion</em></span></button>
      <button class="mbtn back" data-go="s-main"><i class="ic">${ICON.back}</i><span>Back</span></button>
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
      <div class="opt full"><label>Arena</label><div class="arenas small" id="l-map">${arenaCards()}</div></div>
      <div class="opt"><label>Time of day</label><div class="pills small" id="l-time">${timePills()}</div></div>
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
    seg('#seg-decal', (v) => {
      this.profile.decal = Number(v);
      this.save();
    });
    seg('#seg-finish', (v) => {
      this.profile.finish = Number(v);
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
    // the garage's tabs, and what each one previews on the car
    this.$('#g-tabs').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      const tab = b.getAttribute('data-tab')!;
      this.garageTab(tab);
    });
    const equip = (id: string, key: 'body' | 'trail' | 'boom') =>
      seg(id, (v) => {
        this.profile[key] = Number(v);
        this.save();
        if (key === 'boom') this.onPreview('boom');
      });
    equip('#seg-body', 'body');
    equip('#seg-trail', 'trail');
    equip('#seg-boom', 'boom');
    this.$('#b-boom').addEventListener('click', () => this.onPreview('boom'));
    // online play needs a name on the car first
    this.$('#b-friends').addEventListener('click', () => this.needName(() => this.screen('s-online')));
    const name2 = this.$<HTMLInputElement>('#i-name2');
    const nameOk = () => {
      const v = name2.value.trim();
      const bad = v.length < 2 ? 'At least 2 characters' : /^player$/i.test(v) ? 'Pick a name of your own' : '';
      this.$('#name-msg').textContent = bad;
      if (bad) return;
      this.profile.name = v.slice(0, 16);
      name.value = this.profile.name;
      this.save();
      const then = this.afterName;
      this.afterName = null;
      (then ?? (() => this.screen('s-online')))();
    };
    name2.addEventListener('keydown', (e) => e.key === 'Enter' && nameOk());
    // (no keyboard on a controller: roll one)
    this.$('#b-name-rnd').addEventListener('click', () => {
      const a = ['Turbo', 'Nitro', 'Rapid', 'Sonic', 'Blaze', 'Rocket', 'Comet', 'Thunder', 'Neon', 'Apex', 'Drift', 'Flash'];
      const b = ['Fox', 'Viper', 'Hawk', 'Shark', 'Wolf', 'Bolt', 'Racer', 'Storm', 'Falcon', 'Tiger', 'Jet', 'Ace'];
      const r = (l: string[]) => l[Math.floor(Math.random() * l.length)];
      name2.value = `${r(a)} ${r(b)}`;
      this.$('#name-msg').textContent = '';
    });
    name2.addEventListener('input', () => (this.$('#name-msg').textContent = ''));
    this.$('#b-name-ok').addEventListener('click', nameOk);
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
  /** the profile's loadout as a car colour number */
  carColor(): number {
    return packLoadout(this.profile);
  }

  /** a name of your own: 2+ characters, not the default */
  nameOk(): boolean {
    const n = this.profile.name.trim();
    return n.length >= 2 && !/^player$/i.test(n);
  }

  /** run `then` once the car has a name, asking for one first if it hasn't */
  needName(then: () => void): void {
    if (this.nameOk()) return then();
    this.afterName = then;
    this.$('#m-menu').hidden = false;
    this.screen('s-name');
    const i = this.$<HTMLInputElement>('#i-name2');
    i.value = /^player$/i.test(this.profile.name) ? '' : this.profile.name;
    setTimeout(() => i.focus(), 50);
  }

  garageTab(tab: string): void {
    this.gTab = tab;
    this.$('#g-tabs')
      .querySelectorAll('button')
      .forEach((x) => x.classList.toggle('on', x.getAttribute('data-tab') === tab));
    this.root.querySelectorAll<HTMLElement>('#s-garage .pane').forEach((p) => (p.hidden = p.getAttribute('data-pane') !== tab));
    this.onPreview(tab === 'trail' ? 'trail' : null);
  }

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
    // in a match the line shows in the feed too
    if (!this.$('#hud').hidden) this.feed(`${from}: ${text}`, -1);
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
    // 30 segments round a 270° sweep, lit up to the boost; a soft glow under the lit ones
    const N = 30;
    let segs = '';
    for (let k = 0; k < N; k++) {
      const f0 = k / N + 0.006;
      const f1 = (k + 1) / N - 0.006;
      const ra = a0 + sweep * f0;
      const rb = a0 + sweep * f1;
      const p = (r: number, a: number) => `${(100 + Math.cos(a) * r).toFixed(1)} ${(100 + Math.sin(a) * r).toFixed(1)}`;
      const lit = (k + 0.5) / N <= b / 100;
      segs += `<path d="M${p(90, ra)} A90 90 0 0 1 ${p(90, rb)} L${p(76, rb)} A76 76 0 0 0 ${p(76, ra)}Z" fill="${lit ? hot : 'rgba(255,255,255,0.09)'}"/>`;
    }
    this.$('#h-bsvg').innerHTML = `
      <defs><filter id="bg"><feGaussianBlur stdDeviation="5"/></filter>
      <radialGradient id="bd" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="rgba(30,38,62,0.92)"/><stop offset="1" stop-color="rgba(6,9,18,0.9)"/></radialGradient></defs>
      <circle cx="100" cy="100" r="70" fill="url(#bd)" stroke="rgba(255,255,255,0.1)" stroke-width="1.5"/>
      ${b > 0 ? `<path d="${arc(83, b / 100)}" stroke="${hot}" stroke-width="14" fill="none" filter="url(#bg)" opacity="0.55"/>` : ''}
      ${segs}`;
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
