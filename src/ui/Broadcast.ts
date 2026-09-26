import './broadcast.css';
import { uiColor, type Entry } from '../race/Teams.ts';
import { fmtTime } from './HUD.ts';
import type { ReplayEvent, LapMark } from '../game/Replay.ts';

/**
 * The broadcast overlay for spectating and replays: a camera caption (top
 * right), a lower-third for the followed car, a key strip, and in a replay a
 * timeline with lap and event markers you can scrub. The timing tower is the
 * HUD's own (the game switches the HUD into broadcast mode).
 */

export interface BroadcastCallbacks {
  onCamera(dir: 1 | -1): void;
  onCar(dir: 1 | -1): void;
  onCarAt(position: number): void;
  onDirector(): void;
  onSpeed(dir: 1 | -1): void;
  onExit(): void;
  /** replay only */
  onTogglePlay(): void;
  onSeek(t: number): void;
  onSkip(seconds: number): void;
  onEvent(dir: 1 | -1): void;
}

export interface FollowInfo {
  entry: Entry;
  position: number;
  speed: number;
  caption: string;
  /** gap to the car ahead (s), 0 = none */
  gapAhead: number;
  status: '' | 'PIT' | 'OUT' | 'FINISHED';
}

const EVENT_TONE: Record<ReplayEvent['kind'], string> = {
  start: 'w',
  overtake: 'g',
  lead: 'g',
  crash: 'r',
  retired: 'r',
  spin: 'y',
  pit: 'b',
  fastest: 'p',
  finish: 'w',
  vsc: 'y',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  parent?.appendChild(e);
  return e;
}

export class Broadcast {
  readonly root: HTMLDivElement;
  private mode: 'live' | 'replay' | null = null;
  private tag: HTMLElement;
  private camEl: HTMLElement;
  private whereEl: HTMLElement;
  private dirEl: HTMLElement;
  private spdEl: HTMLElement;
  private l3: HTMLDivElement;
  private l3pos: HTMLElement;
  private l3bar: HTMLElement;
  private l3first: HTMLElement;
  private l3last: HTMLElement;
  private l3team: HTMLElement;
  private l3cap: HTMLElement;
  private l3num: HTMLElement;
  private l3kmh: HTMLElement;
  private keys: HTMLDivElement;
  private tl: HTMLDivElement;
  private tlTrack: HTMLDivElement;
  private tlFill: HTMLElement;
  private tlHead: HTMLElement;
  private tlMarks: HTMLDivElement;
  private tlTime: HTMLElement;
  private tlPlay: HTMLButtonElement;
  private tlSpeed: HTMLElement;
  private start = 0;
  private end = 1;
  private scrubbing = false;
  private hidden = false;
  private last = new WeakMap<HTMLElement, string>();
  private lastEntry: Entry | null = null;

  constructor(parent: HTMLElement, private cb: BroadcastCallbacks) {
    this.root = el('div', 'bcast-ui', parent);

    const top = el('div', 'bc-top', this.root);
    this.tag = el('span', 'bc-tag', top, '<i></i>Live');
    this.camEl = el('span', 'bc-cam', top);
    this.whereEl = el('span', 'bc-where', top);
    this.dirEl = el('span', 'bc-dir', top);
    this.spdEl = el('span', 'bc-spd', top);

    this.l3 = el('div', 'bc-l3', this.root);
    this.l3pos = el('div', 'bc-pos', this.l3, 'P1');
    this.l3bar = el('i', 'bc-bar', this.l3);
    const who = el('div', 'bc-who', this.l3);
    const nm = el('div', 'bc-name', who);
    this.l3first = el('span', '', nm);
    this.l3last = el('b', '', nm);
    this.l3num = el('span', 'bc-num', nm);
    const sub = el('div', 'bc-sub', who);
    this.l3team = el('span', '', sub);
    this.l3cap = el('span', 'bc-cap', sub);
    this.l3kmh = el('div', 'bc-kmh', this.l3);

    this.keys = el('div', 'bc-keys', this.root);

    // replay timeline
    this.tl = el('div', 'bc-tl', this.root);
    this.tlPlay = el('button', 'bc-btn play', this.tl);
    this.tlPlay.setAttribute('aria-label', 'Play or pause');
    this.tlPlay.addEventListener('click', () => this.cb.onTogglePlay());
    const prev = el('button', 'bc-btn', this.tl, '<svg viewBox="0 0 16 16"><path d="M4 3v10M13 3 6 8l7 5z"/></svg>');
    prev.setAttribute('aria-label', 'Previous moment');
    prev.addEventListener('click', () => this.cb.onEvent(-1));
    const next = el('button', 'bc-btn', this.tl, '<svg viewBox="0 0 16 16"><path d="M12 3v10M3 3l7 5-7 5z"/></svg>');
    next.setAttribute('aria-label', 'Next moment');
    next.addEventListener('click', () => this.cb.onEvent(1));
    this.tlTime = el('span', 'bc-time', this.tl, '0:00');
    this.tlTrack = el('div', 'bc-track', this.tl);
    el('div', 'bc-rail', this.tlTrack);
    this.tlFill = el('i', 'bc-fill', this.tlTrack);
    this.tlMarks = el('div', 'bc-marks', this.tlTrack);
    this.tlHead = el('b', 'bc-head', this.tlTrack);
    const slower = el('button', 'bc-btn sm', this.tl, '−');
    slower.setAttribute('aria-label', 'Slower');
    slower.addEventListener('click', () => this.cb.onSpeed(-1));
    this.tlSpeed = el('span', 'bc-rate', this.tl, '1×');
    const faster = el('button', 'bc-btn sm', this.tl, '+');
    faster.setAttribute('aria-label', 'Faster');
    faster.addEventListener('click', () => this.cb.onSpeed(1));
    const exit = el('button', 'bc-btn wide', this.tl, 'Exit');
    exit.addEventListener('click', () => this.cb.onExit());

    const seekAt = (e: PointerEvent) => {
      const r = this.tlTrack.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      this.cb.onSeek(this.start + f * (this.end - this.start));
    };
    this.tlTrack.addEventListener('pointerdown', (e) => {
      this.scrubbing = true;
      this.tlTrack.setPointerCapture(e.pointerId);
      seekAt(e);
    });
    this.tlTrack.addEventListener('pointermove', (e) => this.scrubbing && seekAt(e));
    this.tlTrack.addEventListener('pointerup', () => (this.scrubbing = false));
    this.tlTrack.addEventListener('pointercancel', () => (this.scrubbing = false));

    // capture phase: runs before the game's own key handling, which never sees the keys used here
    addEventListener('keydown', (e) => this.onKey(e), { capture: true });
  }

  get active() {
    return this.mode !== null;
  }

  show(mode: 'live' | 'replay' | null) {
    this.mode = mode;
    this.root.classList.toggle('on', mode !== null);
    this.root.classList.toggle('replay', mode === 'replay');
    this.hidden = false;
    this.root.classList.remove('clean');
    this.tag.innerHTML = mode === 'replay' ? '<i></i>Replay' : '<i></i>Live';
    this.keys.innerHTML =
      mode === 'replay'
        ? '<kbd>Space</kbd> play <kbd>J</kbd><kbd>L</kbd> ∓10 s <kbd>N</kbd> next moment <kbd>C</kbd> camera <kbd>←</kbd><kbd>→</kbd> car <kbd>D</kbd> director <kbd>H</kbd> hide <kbd>Esc</kbd> exit'
        : '<kbd>C</kbd> camera <kbd>←</kbd><kbd>→</kbd> car <kbd>1</kbd>–<kbd>0</kbd> position <kbd>D</kbd> director <kbd>+</kbd><kbd>−</kbd> speed <kbd>H</kbd> hide <kbd>Esc</kbd> pause';
  }

  private text(e: HTMLElement, t: string) {
    if (this.last.get(e) !== t) {
      e.textContent = t;
      this.last.set(e, t);
    }
  }

  /** camera caption: its name, where it is, whether the director is cutting, the sim speed */
  setShot(camera: string, where: string, director: boolean, speed: number) {
    this.text(this.camEl, camera);
    this.text(this.whereEl, where);
    this.whereEl.style.display = where ? '' : 'none';
    this.text(this.dirEl, director ? 'Auto cameras' : 'Manual · D for auto');
    this.dirEl.classList.toggle('off', !director);
    const sp = speed === 1 ? '' : `${speed < 1 ? speed.toString().replace(/^0/, '') : speed}×`;
    this.text(this.spdEl, sp);
    this.spdEl.style.display = sp ? '' : 'none';
    this.text(this.tlSpeed, `${speed < 1 ? speed.toString().replace(/^0/, '') : speed}×`);
  }

  /** the lower-third for the followed car */
  setFollow(f: FollowInfo) {
    const e = f.entry;
    if (e !== this.lastEntry) {
      this.lastEntry = e;
      this.l3bar.style.background = uiColor(e.team);
      this.text(this.l3first, e.driver.first);
      this.text(this.l3last, e.driver.last.toUpperCase());
      this.text(this.l3num, String(e.driver.number));
      this.text(this.l3team, e.team.name);
      // replay the entrance so a new car reads as a new graphic
      this.l3.classList.remove('in');
      void this.l3.offsetWidth;
      this.l3.classList.add('in');
    }
    this.text(this.l3pos, f.status === 'OUT' ? 'OUT' : `P${f.position}`);
    const cap = f.status === 'PIT' ? 'In the pits' : f.status === 'FINISHED' ? 'Finished' : f.caption || (f.gapAhead > 0 && f.position > 1 ? `+${f.gapAhead.toFixed(1)} s to P${f.position - 1}` : '');
    this.text(this.l3cap, cap);
    this.l3cap.style.display = cap ? '' : 'none';
    this.text(this.l3kmh, f.status === 'OUT' ? '' : `${Math.max(0, Math.round(f.speed * 3.6))}`);
  }

  /** lay out the replay timeline: lap ticks and the moments worth watching */
  buildTimeline(start: number, end: number, laps: readonly LapMark[], events: readonly ReplayEvent[], nameOf: (id: number) => string) {
    this.start = start;
    this.end = Math.max(start + 1, end);
    const span = this.end - this.start;
    const pct = (t: number) => `${(((t - this.start) / span) * 100).toFixed(3)}%`;
    this.tlMarks.innerHTML = '';
    for (const l of laps) {
      if (l.t < start || l.t > end || l.lap < 2) continue;
      const tick = el('i', 'lap', this.tlMarks);
      tick.style.left = pct(l.t);
      if (laps.length < 30 || l.lap % 5 === 0) tick.dataset.lap = `L${l.lap}`;
    }
    let shown = 0;
    for (const e of events) {
      if (e.t < start || e.t > end || e.kind === 'finish') continue;
      if (++shown > 400) break;
      const m = el('b', `ev ${EVENT_TONE[e.kind]}`, this.tlMarks);
      m.style.left = pct(e.t);
      m.title = describeEvent(e, nameOf);
      m.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation();
        this.cb.onSeek(e.t - 3);
      });
    }
  }

  /** the replay position */
  setTime(t: number, raceClock: number, lap: number, totalLaps: number, playing: boolean) {
    const f = Math.max(0, Math.min(1, (t - this.start) / (this.end - this.start)));
    const w = `${(f * 100).toFixed(2)}%`;
    this.tlFill.style.width = w;
    this.tlHead.style.left = w;
    const clock = raceClock > 0 ? fmtClock(raceClock) : 'Grid';
    this.text(this.tlTime, `${clock} · Lap ${Math.max(1, Math.min(totalLaps, lap))}/${totalLaps}`);
    const icon = playing ? 'pause' : 'play';
    if (this.tlPlay.dataset.icon !== icon) {
      this.tlPlay.dataset.icon = icon;
      this.tlPlay.innerHTML = playing ? '<svg viewBox="0 0 16 16"><path d="M5 3v10M11 3v10"/></svg>' : '<svg viewBox="0 0 16 16"><path d="M5 3l8 5-8 5z"/></svg>';
    }
  }

  private onKey(e: KeyboardEvent) {
    if (!this.mode || (e.repeat && !['BracketLeft', 'BracketRight', 'KeyJ', 'KeyL', 'ArrowLeft', 'ArrowRight'].includes(e.code))) return;
    const replay = this.mode === 'replay';
    let used = true;
    switch (e.code) {
      case 'KeyC':
        this.cb.onCamera(e.shiftKey ? -1 : 1);
        break;
      case 'ArrowLeft':
      case 'KeyQ':
        this.cb.onCar(-1);
        break;
      case 'ArrowRight':
      case 'KeyE':
        this.cb.onCar(1);
        break;
      case 'KeyD':
        this.cb.onDirector();
        break;
      case 'Equal':
      case 'NumpadAdd':
      case 'BracketRight':
        this.cb.onSpeed(1);
        break;
      case 'Minus':
      case 'NumpadSubtract':
      case 'BracketLeft':
        this.cb.onSpeed(-1);
        break;
      case 'KeyH':
        this.hidden = !this.hidden;
        this.root.classList.toggle('clean', this.hidden);
        break;
      case 'Escape':
      case 'Backspace':
        this.cb.onExit();
        break;
      case 'Space':
      case 'KeyK':
        if (replay) this.cb.onTogglePlay();
        else used = false;
        break;
      case 'KeyJ':
        if (replay) this.cb.onSkip(-10);
        else used = false;
        break;
      case 'KeyL':
        if (replay) this.cb.onSkip(10);
        else used = false;
        break;
      case 'KeyN':
        if (replay) this.cb.onEvent(e.shiftKey ? -1 : 1);
        else used = false;
        break;
      default:
        if (/^Digit\d$/.test(e.code)) {
          const d = Number(e.code.slice(5));
          this.cb.onCarAt((d === 0 ? 10 : d) + (e.shiftKey ? 10 : 0));
        } else used = false;
    }
    if (used) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  /** hide the lower-third/tower etc. for a clean feed (H) */
  get clean() {
    return this.hidden;
  }
}

function fmtClock(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** one line for an event ("HAM passes VER for P3") */
export function describeEvent(e: ReplayEvent, nameOf: (id: number) => string): string {
  const a = nameOf(e.car);
  const b = e.other >= 0 ? nameOf(e.other) : '';
  switch (e.kind) {
    case 'start':
      return 'Lights out';
    case 'overtake':
      return `${a} passes ${b} for P${e.value}`;
    case 'lead':
      return `${a} takes the lead from ${b}`;
    case 'crash':
      return `${a} crashes`;
    case 'spin':
      return `${a} spins`;
    case 'retired':
      return `${a} is out`;
    case 'pit':
      return `${a} pits`;
    case 'fastest':
      return `Fastest lap · ${a} ${fmtTime(e.value)}`;
    case 'finish':
      return `${a} finishes P${e.value}`;
    case 'vsc':
      return `Virtual safety car · ${a}`;
  }
}
