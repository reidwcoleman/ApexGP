import { planMoments, type MomentKind, type MomentPlan, type RaceInfo } from './clip/moments.ts';
import { Studio, type Readback, type StudioHost } from './clip/studio.ts';
import { createSink, pickFormat, type ClipFormat, type ClipSink } from './clip/encoder.ts';
import type { OverlayState, TowerRow } from './clip/graphics.ts';
import { RF, type ReplayBuffer } from '../game/Replay.ts';
import type { WeatherState } from '../world/Weather.ts';

export type { MomentKind, RaceInfo, RaceCar } from './clip/moments.ts';
export type { StudioHost } from './clip/studio.ts';

/**
 * Real broadcast highlights of your races.
 *
 * Nothing is filmed while you race: the full-race replay recording (game/Replay.ts — every
 * car at 15 Hz, a few hundred kB a minute) already holds everything. When the session ends it
 * is handed over here, and in the background — during the podium, the results and the menu,
 * a few milliseconds a frame, never while racing — the moments worth keeping are found in it
 * (overtakes, lead changes, battles, crashes, spins and big saves, the start, the fastest lap,
 * the flag) and each one is produced as a short broadcast package: re-rendered offscreen from
 * the cameras the TV director picks (a trackside angle, then a replay from another — an
 * onboard, often in slow motion), at a fixed 30 fps, with the lower third, the timing tower
 * and a replay wipe between shots burned in, and encoded to H.264 MP4 with WebCodecs
 * (clip/studio.ts, clip/encoder.ts, clip/mp4.ts). The podium ceremony, which the recording
 * doesn't hold, is captured from the screen as it plays.
 *
 * Clips are kept best first in IndexedDB within a storage budget, each with a poster still;
 * every race also gets a reel: its clips in race order, played back to back. The garage wall
 * and the Highlights tab (and its full-screen player) play them.
 */

export interface Highlight {
  id: string;
  kind: MomentKind;
  title: string;
  sub: string;
  track: string;
  date: number;
  score: number;
  /** the clip (MP4 or WebM) */
  video: Blob;
  /** a still of the moment (JPEG) */
  poster: Blob | null;
  mime: string;
  width: number;
  height: number;
  /** seconds */
  duration: number;
  /** seconds into the clip where the moment happens */
  at: number;
  /** the race it's from (its reel) and when in the race (the reel's order) */
  race?: string;
  order?: number;
  /** the broadcast graphics are in the picture */
  burned?: boolean;
  /** you were in it */
  mine?: boolean;
}

/** a race's highlights, back to back */
export interface Reel {
  id: string;
  track: string;
  title: string;
  sub: string;
  date: number;
  poster: Blob | null;
}

export interface ProductionStatus {
  /** producing (or about to) */
  active: boolean;
  /** the race being produced ('Monza') */
  race: string;
  /** clips finished / planned for it (total 0 while its moments are still being found) */
  done: number;
  total: number;
  /** the clip in production and how far along it is (0 … 1) */
  clip: string;
  frac: number;
}

export const MOMENT_LABEL: Record<MomentKind, string> = {
  win: 'Victory',
  podium: 'Podium',
  lead: 'New leader',
  overtake: 'Overtake',
  fastest: 'Fastest lap',
  finish: 'Chequered flag',
  pole: 'Pole position',
  save: 'Big save',
  start: 'Race start',
  crash: 'Incident',
  spin: 'Spin',
  battle: 'Battle',
};

const FPS = 30;
const W = 1280;
const H = 720;
const BITRATE = 6_000_000;
/** clips kept, and their bytes in total */
const KEEP = 30;
const BUDGET = 320 * 1024 * 1024;
const REELS = 6;
/** moments produced per race (plus the podium) */
const PER_RACE = 7;

const DB = 'apexgp';
const DB_V = 3;
/** v1 stored JPEG bursts here: dropped on upgrade */
const OLD_STORE = 'highlights';
const STORE = 'clips';
const REEL_STORE = 'reels';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, DB_V);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (db.objectStoreNames.contains(OLD_STORE)) db.deleteObjectStore(OLD_STORE);
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(REEL_STORE)) db.createObjectStore(REEL_STORE, { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch {
      res(null);
    }
  });
}

function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((res) => {
    try {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => res(req.result as T[]);
      req.onerror = () => res([]);
    } catch {
      res([]);
    }
  });
}

/** a JPEG still of a clip `at` seconds in (for clips made before posters were rendered with them) */
function posterOf(url: string, at: number, duration: number): Promise<Blob | null> {
  return new Promise((res) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    const end = (b: Blob | null) => {
      if (done) return;
      done = true;
      v.removeAttribute('src');
      v.load();
      res(b);
    };
    const timer = setTimeout(() => end(null), 6000);
    v.addEventListener('loadeddata', () => {
      v.currentTime = Math.max(0.05, Math.min(at + 0.4, (isFinite(v.duration) ? v.duration : duration) - 0.2));
    });
    v.addEventListener('seeked', () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const g = c.getContext('2d');
      if (!g) return end(null);
      g.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        clearTimeout(timer);
        end(b);
      }, 'image/jpeg', 0.86);
    });
    v.addEventListener('error', () => end(null));
    v.src = url;
  });
}

/** RGBA pixels (top row first) → a JPEG */
function jpegOf(px: Uint8Array, w: number, h: number): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return Promise.resolve(null);
  const img = g.createImageData(w, h);
  img.data.set(px);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  g.putImageData(img, 0, 0);
  return new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', 0.86));
}

/** one output frame of a clip: which shot, when in the race, and the graphics' state */
interface Frame {
  shot: number;
  t: number;
  dt: number;
  wipe: number;
  fade: number;
  l3: number;
  top: number;
}

interface RaceJob {
  info: RaceInfo;
  plans: MomentPlan[] | null;
  gen: Generator<void, MomentPlan[]> | null;
  next: number;
  done: number;
}

interface ClipWork {
  job: RaceJob;
  plan: MomentPlan;
  frames: Frame[];
  /** next frame to render; frames read back and handed to the encoder */
  i: number;
  got: number;
  sink: ClipSink;
  shot: number;
  focus: number;
  mode: import('../game/Cameras.ts').CameraMode;
  posterAt: number;
  poster: Promise<Blob | null> | null;
  finishing: boolean;
  wall0: number;
}

interface LiveCapture {
  kind: MomentKind;
  title: string;
  sub: string;
  score: number;
  track: string;
  race: string | null;
  sink: ClipSink;
  /** seconds captured, frames due, the last index sent, frames read back */
  t: number;
  total: number;
  at: number;
  sent: number;
  got: number;
  last: number;
  posterAt: number;
  poster: Promise<Blob | null> | null;
  finishing: boolean;
  ov: OverlayState;
}

export class Highlights {
  list: Highlight[] = [];
  reels: Reel[] = [];
  readonly ready: Promise<void>;
  /** CPU milliseconds per frame production may use on average (halved when the frame rate sags below 30) */
  budgetMs = 6;
  status: ProductionStatus = { active: false, race: '', done: 0, total: 0, clip: '', frac: 0 };
  /** dev readouts: production timings */
  readonly stats = { frames: 0, renderMs: 0, clips: 0, lastClipMs: 0, lastClipBytes: 0, format: '' };
  private db: IDBDatabase | null = null;
  private listeners: (() => void)[] = [];
  private statusListeners: ((s: ProductionStatus) => void)[] = [];
  private readonly urls = new Map<string, { video?: string; poster?: string }>();
  private host: (StudioHost & { trackId(): string | null }) | null = null;
  private studio: Studio | null = null;
  private fmt: ClipFormat | null | undefined = undefined;
  private jobs: RaceJob[] = [];
  private work: ClipWork | null = null;
  private capture: LiveCapture | null = null;
  private credit = 0;
  private fpsAvg = 60;
  private clipT0 = 0;

  constructor() {
    this.ready = this.load();
  }

  /** call `fn` when the list changes; returns a function that stops it */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((f) => f !== fn);
    };
  }

  /** call `fn` as production progresses; returns a function that stops it */
  onStatus(fn: (s: ProductionStatus) => void): () => void {
    this.statusListeners.push(fn);
    return () => {
      this.statusListeners = this.statusListeners.filter((f) => f !== fn);
    };
  }

  private emit() {
    for (const f of this.listeners) f();
  }

  private setStatus(p: Partial<ProductionStatus>) {
    Object.assign(this.status, p);
    for (const f of this.statusListeners) f(this.status);
  }

  private async load() {
    this.db = await openDb();
    if (!this.db) return;
    const clips = await getAll<Highlight>(this.db, STORE);
    this.list = clips.filter((h) => h && h.video instanceof Blob).sort((a, b) => b.score - a.score || b.date - a.date);
    this.reels = (await getAll<Reel>(this.db, REEL_STORE)).filter((r) => r && r.id).sort((a, b) => b.date - a.date);
    this.emit();
    this.makePosters();
  }

  /** an object URL for the clip (made once, kept while the clip exists) */
  videoUrl(h: Highlight): string {
    const u = this.urls.get(h.id) ?? {};
    u.video ??= URL.createObjectURL(h.video);
    this.urls.set(h.id, u);
    return u.video;
  }

  /** an object URL for the poster still ('' if there is none) */
  posterUrl(h: Highlight | Reel): string {
    if (!h.poster) return '';
    const u = this.urls.get(h.id) ?? {};
    u.poster ??= URL.createObjectURL(h.poster);
    this.urls.set(h.id, u);
    return u.poster;
  }

  private revoke(id: string) {
    const u = this.urls.get(id);
    if (!u) return;
    if (u.video) URL.revokeObjectURL(u.video);
    if (u.poster) URL.revokeObjectURL(u.poster);
    this.urls.delete(id);
  }

  /** a race's clips in race order (the podium last) */
  reelClips(r: Reel | string): Highlight[] {
    const id = typeof r === 'string' ? r : r.id;
    return this.list.filter((h) => h.race === id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  /** the reels that still have clips, newest first */
  get liveReels(): Reel[] {
    return this.reels.filter((r) => this.list.some((h) => h.race === r.id));
  }

  /** the podium is being captured right now */
  get recording(): boolean {
    return !!this.capture;
  }

  // ------------------------------------------------------------------ wiring (Game)

  /** the game's world, renderer and car factory: production can start */
  attach(host: StudioHost & { trackId(): string | null }) {
    this.host = host;
    this.studio = new Studio(host, W, H, FPS);
    pickFormat(W, H, FPS, BITRATE).then((f) => {
      this.fmt = f;
      this.stats.format = f ? `${f.kind} ${f.codec}` : 'none';
      if (!f) console.warn('[highlights] no video encoder: highlights are off');
    });
  }

  /** a finished session: find its moments and produce them in the background */
  queueRace(info: RaceInfo) {
    if (this.owns(info.replay)) return;
    this.queued.add(info.replay);
    // (a backlog of races is capped: the oldest not yet started goes)
    while (this.jobs.length >= 3) {
      const i = this.jobs.findIndex((j) => j !== this.work?.job && j.next === 0);
      if (i < 0) break;
      this.jobs.splice(i, 1);
    }
    this.jobs.push({ info, plans: null, gen: null, next: 0, done: 0 });
    this.setStatus({ active: true, race: info.trackShort, done: 0, total: 0, clip: '', frac: 0 });
  }

  /** this recording belongs to a queued race (the game must start a new one rather than reuse it) */
  owns(replay: ReplayBuffer): boolean {
    return this.queued.has(replay);
  }
  private readonly queued = new WeakSet<ReplayBuffer>();

  /** while a race is waiting to be produced in the menu, the world keeps its weather */
  worldWeather(trackId: string): WeatherState | null {
    const j = this.jobs[0];
    return j && j.info.trackId === trackId && this.fmt ? j.info.weather : null;
  }

  /**
   * The podium (the only moment the recording doesn't hold): capture the screen from now,
   * with the moment `delay` seconds from now. Other kinds are found in the recording after
   * the race and are ignored here.
   */
  moment(kind: MomentKind, title: string, sub: string, score: number, track: string, delay = 0) {
    if ((kind !== 'win' && kind !== 'podium') || this.capture || !this.studio || !this.fmt) return;
    const sink = createSink(this.fmt, W, H, FPS, BITRATE);
    if (sink.failed) return;
    const at = Math.max(0, delay);
    const job = [...this.jobs].reverse().find((j) => j.info.trackShort === track) ?? null;
    const names = job ? job.info.podium : '';
    this.capture = {
      kind,
      title,
      sub,
      score,
      track,
      race: job?.info.id ?? null,
      sink,
      t: 0,
      total: Math.round((at + 5.5) * FPS),
      at,
      sent: 0,
      got: 0,
      last: -1,
      posterAt: Math.round((at + 0.8) * FPS),
      poster: null,
      finishing: false,
      ov: { tag: null, info: null, slow: 1, camera: null, cameraSub: null, tower: null, l3: { kicker: kind === 'win' ? 'Victory' : 'Podium', title, sub: names || sub, color: '#ff2b3f' }, l3In: 0, topIn: 0 },
    };
  }

  /** call right after the frame is drawn, with the WebGL canvas (the podium only) */
  afterRender(_canvas: HTMLCanvasElement, dt: number) {
    const c = this.capture;
    const st = this.studio;
    if (!c || c.finishing || !st) return;
    c.t += Math.min(dt, 0.1);
    const due = Math.min(c.total - 1, Math.floor(c.t * FPS));
    if (due > c.last) {
      const f = due / FPS;
      const end = c.total / FPS;
      c.ov.l3In = Math.max(0, Math.min(1, (f - 0.8) / 0.55, (c.at + 4 - f) / 0.4));
      const fade = Math.max(0, Math.min(1, (due + 1) / 9, (c.total - 1 - due) / 10));
      if (st.captureCanvas({ kind: 'frame', index: due, w: W, h: H, tag: 'live' }, c.ov, fade)) {
        c.last = due;
        c.sent++;
        if (due >= c.posterAt && !c.poster && st.capturePoster({ kind: 'poster', index: due, w: W / 2, h: H / 2, tag: 'live' }, 1)) c.poster = Promise.resolve(null);
        void end;
      }
    }
    if (c.last >= c.total - 1) this.endCapture();
  }

  /** the session is over (or the world is going): stop any capture, keeping it if the moment is in it */
  cancel() {
    if (this.capture && !this.capture.finishing) this.endCapture();
  }

  private endCapture() {
    const c = this.capture;
    if (!c || c.finishing) return;
    c.finishing = true;
    if (c.last / FPS < c.at + 1) {
      c.sink.close();
      this.capture = null;
      return;
    }
    this.maybeFinishCapture();
  }

  private async maybeFinishCapture() {
    const c = this.capture;
    if (!c || !c.finishing || c.got < c.sent) return;
    this.capture = null;
    const video = await c.sink.finish();
    const poster = c.poster ? await c.poster : null;
    if (!video || video.size < 20000) return;
    this.store({
      id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      kind: c.kind,
      title: c.title,
      sub: c.sub,
      track: c.track,
      date: Date.now(),
      score: c.score,
      video,
      poster,
      mime: video.type,
      width: W,
      height: H,
      duration: (c.last + 1) / FPS,
      at: c.at,
      race: c.race ?? undefined,
      order: 1e9,
      burned: true,
      mine: true,
    });
  }

  // ------------------------------------------------------------------ production (every frame, after the render)

  /**
   * The game's frame is done: read back what the GPU finished, and — in the menu, the results
   * and the podium, within the budget — render the next frames of the clip in production.
   */
  tick(dt: number, state: string) {
    const st = this.studio;
    if (!st) return;
    st.poll((px, meta) => this.onPixels(px, meta));
    if (this.capture?.finishing) this.maybeFinishCapture();
    if (this.capture && state !== 'celebration') this.endCapture();
    this.fpsAvg = this.fpsAvg * 0.93 + (1 / Math.max(dt, 1e-3)) * 0.07;
    const can = state === 'menu' || state === 'results' || state === 'celebration';
    if (!can || !this.fmt || (!this.jobs.length && !this.work)) {
      this.credit = 0;
      return;
    }
    let budget = this.budgetMs * (this.fpsAvg < 30 ? 0.5 : 1) * (this.capture ? 0.6 : 1);
    if (state === 'celebration' && this.fpsAvg < 40) budget = 0;
    this.credit = Math.min(budget, this.credit + budget);
    const t0 = performance.now();
    while (this.credit > 0) {
      const s = performance.now();
      const did = this.step();
      this.credit -= performance.now() - s;
      if (!did || performance.now() - t0 > budget) break;
    }
  }

  private onPixels(px: Uint8Array, meta: Readback) {
    if (meta.tag === 'live') {
      const c = this.capture;
      if (!c) return;
      if (meta.kind === 'poster') {
        c.poster = jpegOf(px, meta.w, meta.h);
        return;
      }
      c.sink.add(px, meta.index, meta.index % FPS === 0 || c.got === 0);
      c.got++;
      if (c.finishing) this.maybeFinishCapture();
      return;
    }
    const w = this.work;
    if (!w) return;
    if (meta.kind === 'poster') {
      w.poster = jpegOf(px, meta.w, meta.h);
      return;
    }
    w.sink.add(px, meta.index, meta.index % FPS === 0);
    w.got++;
    if (w.got >= w.frames.length && !w.finishing) {
      w.finishing = true;
      this.finishClip(w);
    }
  }

  /** one unit of work; false when there's nothing to do this frame */
  private step(): boolean {
    const st = this.studio!;
    const here = this.host?.trackId() ?? null;
    const w = this.work;
    if (w) {
      if (w.job.info.trackId !== here) {
        // the circuit changed under it: that race can't be filmed any more
        w.sink.close();
        this.work = null;
        this.jobs = this.jobs.filter((j) => j !== w.job);
        st.endShots();
        this.idle();
        return true;
      }
      return this.stepClip(w);
    }
    const job = this.jobs[0];
    if (!job) return false;
    if (job.info.trackId !== here) {
      this.jobs.shift();
      this.idle();
      return true;
    }
    if (!job.plans) {
      job.gen ??= planMoments(job.info, PER_RACE);
      const t0 = performance.now();
      while (performance.now() - t0 < 3) {
        const r = job.gen.next();
        if (r.done) {
          job.plans = r.value;
          job.gen = null;
          this.setStatus({ active: true, race: job.info.trackShort, done: 0, total: job.plans.length, clip: '', frac: 0 });
          console.info(`[shot] [highlights] ${job.info.trackShort}: ${job.plans.length} moments ${JSON.stringify(job.plans.map((p) => `${p.kind}@${p.t.toFixed(1)}:${Math.round(p.score)}`))}`);
          break;
        }
      }
      return true;
    }
    if (!st.prepare(job.info)) return true;
    if (job.next >= job.plans.length) {
      this.jobs.shift();
      this.idle();
      return true;
    }
    this.work = this.startClip(job, job.plans[job.next++]);
    return true;
  }

  private idle() {
    if (!this.jobs.length && !this.work) this.setStatus({ active: false, clip: '', frac: 0 });
  }

  private startClip(job: RaceJob, plan: MomentPlan): ClipWork {
    const frames = this.schedule(plan);
    // the poster: the moment itself, in the first (trackside) shot
    let posterAt = frames.findIndex((f) => f.shot === 0 && f.t >= plan.t + 0.25);
    if (posterAt < 0) posterAt = Math.floor(frames.filter((f) => f.shot === 0).length / 2);
    this.clipT0 = performance.now();
    this.setStatus({ active: true, race: job.info.trackShort, done: job.done, total: job.plans?.length ?? 0, clip: plan.title, frac: 0 });
    return {
      job,
      plan,
      frames,
      i: 0,
      got: 0,
      sink: createSink(this.fmt!, W, H, FPS, BITRATE),
      shot: -1,
      focus: plan.shots[0].focus,
      mode: 'tv',
      posterAt,
      poster: null,
      finishing: false,
      wall0: performance.now(),
    };
  }

  /** the clip's frames: its shots back to back, wipes over the cuts, fades at the ends, the graphics' timing */
  private schedule(plan: MomentPlan): Frame[] {
    const frames: Frame[] = [];
    const cuts: number[] = [];
    plan.shots.forEach((s, k) => {
      if (k > 0) cuts.push(frames.length);
      const n = Math.max(1, Math.round(((s.t1 - s.t0) / s.speed) * FPS));
      for (let j = 0; j < n; j++) frames.push({ shot: k, t: s.t0 + (j * s.speed) / FPS, dt: s.speed / FPS, wipe: -1, fade: 1, l3: 0, top: 1 });
    });
    const N = frames.length;
    for (const F of cuts) for (let f = F - 7; f <= F + 7; f++) if (frames[f]) frames[f].wipe = (f - (F - 7)) / 14;
    const firstEnd = cuts.length ? cuts[0] : N;
    const l3Out = Math.min(firstEnd - 16, 12 + FPS * 5.5);
    frames.forEach((fr, f) => {
      fr.fade = Math.max(0, Math.min(1, (f + 1) / 9, (N - 1 - f) / 10));
      fr.l3 = Math.max(0, Math.min(1, (f - 12) / 15, (l3Out - f) / 10));
      fr.top = Math.max(0, Math.min(1, (f - 4) / 12, (N - 4 - f) / 10));
    });
    return frames;
  }

  private stepClip(w: ClipWork): boolean {
    const st = this.studio!;
    if (w.finishing) return false;
    if (w.sink.failed) {
      this.abortClip(w);
      return true;
    }
    if (w.i >= w.frames.length) return false;
    // (the podium capture gets read-back slots first)
    if (!st.canRender || w.sink.backlog > 6 || (this.capture && !this.capture.finishing && st.freeSlots < 2)) return false;
    if (w.sink.realtime && performance.now() < w.wall0 + (w.i * 1000) / FPS) return false;
    const f = w.frames[w.i];
    const info = w.job.info;
    if (f.shot !== w.shot) {
      w.shot = f.shot;
      const s = st.beginShot(info, w.plan.shots[f.shot]);
      w.focus = s.focus;
      w.mode = s.mode;
    }
    const ok = st.renderFrame(info, f.t, f.dt, { kind: 'frame', index: w.i, w: W, h: H, tag: 'clip' }, () => this.overlay(w, f), f.wipe, f.fade, w.i === w.posterAt);
    if (!ok) return false;
    this.stats.frames++;
    this.stats.renderMs = this.stats.renderMs * 0.9 + st.lastMs * 0.1;
    w.i++;
    if (w.i % 10 === 0) this.setStatus({ frac: w.i / w.frames.length });
    return true;
  }

  /** the graphics for a frame (after the recording was applied at its time) */
  private overlay(w: ClipWork, f: Frame): OverlayState {
    const info = w.job.info;
    const R = info.replay;
    const shot = w.plan.shots[f.shot];
    const cap = this.studio!.caption(w.mode, info, w.focus);
    const lap = Math.max(1, Math.min(info.laps, R.leaderLap + 1));
    return {
      tag: 'Replay',
      info: `Lap ${lap} / ${info.laps}`,
      slow: shot.speed,
      camera: cap.camera,
      cameraSub: cap.sub,
      tower: this.tower(info, w.plan.cars),
      l3: { kicker: w.plan.kicker, title: w.plan.title, sub: w.plan.sub, color: w.plan.color },
      l3In: f.l3,
      topIn: f.top,
    };
  }

  /** five places around the cars the moment is about */
  private tower(info: RaceInfo, ids: number[]): TowerRow[] {
    const R = info.replay;
    const n = info.cars.length;
    const byPos: number[] = [];
    for (let i = 0; i < n; i++) if (R.pos[i] > 0) byPos[R.pos[i]] = i;
    const ps = ids.map((i) => R.pos[i] || 1);
    let lo = Math.max(1, Math.min(...ps) - 1);
    let hi = Math.min(n, Math.max(...ps) + 1);
    while (hi - lo < 4 && (lo > 1 || hi < n)) {
      if (lo > 1) lo--;
      if (hi - lo < 4 && hi < n) hi++;
    }
    const rows: TowerRow[] = [];
    const racing = R.phase >= 2;
    for (let p = lo; p <= hi; p++) {
      const id = byPos[p];
      const c = id === undefined ? null : info.cars[id];
      if (!c) continue;
      const fl = R.flags[id];
      let gap = '';
      if (fl & RF.retired) gap = 'OUT';
      else if (fl & RF.pit) gap = 'PIT';
      else if (racing) {
        if (p === 1) gap = 'Leader';
        else if (R.gap[id] < 0) gap = `+${Math.round(-R.gap[id])} lap`;
        else {
          const ahead = byPos[p - 1];
          const d = ahead !== undefined && R.gap[ahead] >= 0 ? R.gap[id] - R.gap[ahead] : R.gap[id];
          gap = `+${Math.max(0, d).toFixed(1)}`;
        }
      }
      rows.push({ pos: p, code: c.code, color: c.color, gap, hi: ids.includes(id) });
    }
    return rows;
  }

  private abortClip(w: ClipWork) {
    w.sink.close();
    this.studio?.endShots();
    if (this.work === w) this.work = null;
    w.job.done++;
  }

  private async finishClip(w: ClipWork) {
    this.studio?.endShots();
    const info = w.job.info;
    const video = await w.sink.finish();
    const poster = w.poster ? await w.poster : null;
    if (this.work === w) this.work = null;
    w.job.done++;
    const ms = performance.now() - this.clipT0;
    this.setStatus({ done: w.job.done, frac: 0, clip: '' });
    if (!video || video.size < 20000) {
      this.idle();
      return;
    }
    this.stats.clips++;
    this.stats.lastClipMs = Math.round(ms);
    this.stats.lastClipBytes = video.size;
    console.info(`[shot] [highlights] ${w.plan.kind} "${w.plan.title}" ${w.frames.length} frames, ${(video.size / 1e6).toFixed(2)} MB, produced in ${(ms / 1000).toFixed(1)} s`);
    const sub = w.plan.sub.includes(info.trackShort) || w.plan.sub.includes(info.trackName) ? w.plan.sub : `${w.plan.sub} · ${info.trackShort}`;
    this.ensureReel(info, poster, w.plan.score);
    this.store({
      id: `${info.id}-${w.plan.kind}-${Math.round(w.plan.t * 10)}`,
      kind: w.plan.kind,
      title: w.plan.title,
      sub,
      track: info.trackShort,
      date: info.date,
      score: w.plan.score,
      video,
      poster,
      mime: video.type,
      width: W,
      height: H,
      duration: w.frames.length / FPS,
      at: w.posterAt / FPS,
      race: info.id,
      order: w.plan.t,
      burned: true,
      mine: w.plan.mine,
    });
    this.idle();
  }

  // ------------------------------------------------------------------ storage

  private reelScore = new Map<string, number>();
  private ensureReel(info: RaceInfo, poster: Blob | null, score: number) {
    let r = this.reels.find((x) => x.id === info.id);
    const best = this.reelScore.get(info.id) ?? -1;
    if (r && (score <= best || !poster)) return;
    if (!r) {
      r = { id: info.id, track: info.trackShort, title: `${info.trackName}`, sub: info.spectating ? 'Simulated race' : info.result, date: info.date, poster: null };
      this.reels.unshift(r);
    }
    if (poster && score > best) {
      this.reelScore.set(info.id, score);
      this.revoke(r.id);
      r.poster = poster;
    }
    // the newest few races keep their reels
    this.reels.sort((a, b) => b.date - a.date);
    const drop = this.reels.splice(REELS);
    for (const d of drop) this.revoke(d.id);
    if (this.db) {
      try {
        const tx = this.db.transaction(REEL_STORE, 'readwrite');
        const s = tx.objectStore(REEL_STORE);
        s.put(r);
        for (const d of drop) s.delete(d.id);
      } catch {
        /* the reel lives this session */
      }
    }
  }

  private store(h: Highlight) {
    this.list = this.list.filter((x) => x.id !== h.id);
    this.list.push(h);
    this.list.sort((a, b) => b.score - a.score || b.date - a.date);
    // the best first, within the count and the byte budget
    const keep: Highlight[] = [];
    const drop: Highlight[] = [];
    let bytes = 0;
    for (const x of this.list) {
      const b = x.video.size + (x.poster?.size ?? 0);
      if (keep.length < KEEP && bytes + b <= BUDGET) {
        keep.push(x);
        bytes += b;
      } else drop.push(x);
    }
    this.list = keep;
    for (const d of drop) this.revoke(d.id);
    if (this.db && keep.includes(h)) {
      try {
        const tx = this.db.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        st.put(h);
        for (const d of drop) st.delete(d.id);
      } catch {
        /* storage full or unavailable: the clip lives this session */
      }
    }
    this.emit();
  }

  /** clips from before posters were rendered with them: a still from the clip itself */
  private posterBusy = false;
  private async makePosters() {
    if (this.posterBusy) return;
    this.posterBusy = true;
    try {
      for (const h of this.list.slice()) {
        if (h.poster) continue;
        const b = await posterOf(this.videoUrl(h), h.at, h.duration);
        if (!b || !this.list.includes(h)) continue;
        h.poster = b;
        if (this.db) {
          try {
            this.db.transaction(STORE, 'readwrite').objectStore(STORE).put(h);
          } catch {
            /* the poster lives this session */
          }
        }
        this.emit();
      }
    } finally {
      this.posterBusy = false;
    }
  }

  clear() {
    for (const h of this.list) this.revoke(h.id);
    for (const r of this.reels) this.revoke(r.id);
    this.list = [];
    this.reels = [];
    this.reelScore.clear();
    if (this.db) {
      try {
        const tx = this.db.transaction([STORE, REEL_STORE], 'readwrite');
        tx.objectStore(STORE).clear();
        tx.objectStore(REEL_STORE).clear();
      } catch {
        /* ignore */
      }
    }
    this.emit();
  }
}
