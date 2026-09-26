/**
 * Your best racing moments, as real video. While you race, the picture is recorded
 * continuously into a short rolling buffer (a ring of overlapping MediaRecorders on a
 * fixed-size capture of the game canvas), so when something worth remembering happens
 * (an overtake, taking the lead, a fastest lap, the chequered flag, the podium) the clip
 * already holds the few seconds that led up to it. The recorder that started earliest
 * is kept running until a few seconds after the moment, then its WebM file is stored,
 * best first, in IndexedDB within a storage budget. The garage plays them on its video
 * wall; the Highlights tab lists them with a poster frame.
 *
 * Why a ring of recorders rather than one: a WebM stream can only be decoded from its
 * first chunk (the header and the first keyframe), so a tail sliced off one long
 * recording is not a playable file. Each recorder in the ring is a complete file.
 *
 * Cost: the encoder runs off the main thread (H.264 in WebM is hardware encoded on most
 * machines and is tried first); the main thread only copies the canvas into the capture
 * canvas 30 times a second (a GPU blit) and hands the frame over.
 */

export type MomentKind = 'win' | 'podium' | 'lead' | 'overtake' | 'fastest' | 'finish' | 'pole' | 'save';

export interface Highlight {
  id: string;
  kind: MomentKind;
  title: string;
  sub: string;
  track: string;
  date: number;
  score: number;
  /** the clip (WebM) */
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
}

export const MOMENT_LABEL: Record<MomentKind, string> = {
  win: 'Victory',
  podium: 'Podium',
  lead: 'Into the lead',
  overtake: 'Overtake',
  fastest: 'Fastest lap',
  finish: 'Chequered flag',
  pole: 'Pole position',
  save: 'Big save',
};

/** a new recorder in the ring every SEG seconds; each lives 2·SEG unless a moment claims it */
const SEG = 3;
/** seconds of picture kept after the moment */
const POST = 5;
/** a clip never runs longer than this (moments close together share one clip) */
const MAX_LEN = 15;
const FPS = 30;
const KEEP = 16;
/** bytes of video kept in total */
const BUDGET = 200 * 1024 * 1024;

/** hardware-encoded H.264 first (cheap), then the software codecs; all WebM */
const CODECS: { mime: string; hw: boolean }[] = [
  { mime: 'video/webm;codecs=avc1', hw: true },
  { mime: 'video/webm;codecs=h264', hw: true },
  { mime: 'video/webm;codecs=vp9', hw: false },
  { mime: 'video/webm;codecs=vp8', hw: false },
  { mime: 'video/webm', hw: false },
];

const DB = 'apexgp';
const DB_V = 2;
/** v1 stored JPEG bursts here: dropped on upgrade */
const OLD_STORE = 'highlights';
const STORE = 'clips';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, DB_V);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (db.objectStoreNames.contains(OLD_STORE)) db.deleteObjectStore(OLD_STORE);
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch {
      res(null);
    }
  });
}

/** stop a recorder outside the frame (flushing the encoder can take a few milliseconds) */
function stopLater(rec: MediaRecorder) {
  const go = () => {
    try {
      if (rec.state !== 'inactive') rec.stop();
    } catch {
      /* already stopped */
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 400 });
  else setTimeout(go, 0);
}

/** a JPEG still of a clip `at` seconds in */
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
      c.width = 480;
      c.height = 270;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return end(null);
      g.imageSmoothingQuality = 'high';
      g.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => {
        clearTimeout(timer);
        end(b);
      }, 'image/jpeg', 0.85);
    });
    v.addEventListener('error', () => end(null));
    v.src = url;
  });
}

type Meta = Omit<Highlight, 'video' | 'poster' | 'mime' | 'width' | 'height' | 'duration' | 'at'>;

interface Seg {
  rec: MediaRecorder;
  chunks: Blob[];
  /** recording clock when it started */
  t0: number;
  claim: Claim | null;
}

interface Claim {
  meta: Meta;
  /** recording clock at the moment, and when the clip ends */
  tMoment: number;
  tEnd: number;
}

export class Highlights {
  list: Highlight[] = [];
  readonly ready: Promise<void>;
  private db: IDBDatabase | null = null;
  private listeners: (() => void)[] = [];
  private readonly urls = new Map<string, { video?: string; poster?: string }>();

  // ---- capture
  private codec: { mime: string; hw: boolean } | null | undefined = undefined;
  private cap: HTMLCanvasElement | null = null;
  private capCtx: CanvasRenderingContext2D | null = null;
  private track: CanvasCaptureMediaStreamTrack | null = null;
  private stream: MediaStream | null = null;
  private segs: Seg[] = [];
  /** seconds of recorded race picture (stands still while the game is paused) */
  private clock = 0;
  private lastSegAt = -Infinity;
  private lastFrameMs = 0;
  private lastTickMs = 0;
  private paused = false;
  private watchdog = 0;
  private pending: { meta: Meta; fireAt: number } | null = null;
  private active: Seg | null = null;
  /** disable recording altogether (no MediaRecorder, or it failed) */
  private broken = false;

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

  private emit() {
    for (const f of this.listeners) f();
  }

  private async load() {
    this.db = await openDb();
    if (!this.db) return;
    await new Promise<void>((res) => {
      try {
        const tx = this.db!.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
          this.list = (req.result as Highlight[]).filter((h) => h && h.video instanceof Blob).sort((a, b) => b.score - a.score || b.date - a.date);
          res();
        };
        req.onerror = () => res();
      } catch {
        res();
      }
    });
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
  posterUrl(h: Highlight): string {
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

  /** is a clip being recorded right now */
  get recording(): boolean {
    return !!this.active || !!this.pending;
  }

  /**
   * Something happened (`delay` seconds from now, so the clip is centred on the moment
   * rather than the build-up). A moment during a clip extends it; a better one that
   * doesn't fit replaces it.
   */
  moment(kind: MomentKind, title: string, sub: string, score: number, track: string, delay = 0) {
    if (this.broken) return;
    const meta: Meta = { id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`, kind, title, sub, track, date: Date.now(), score };
    if (this.pending && this.pending.meta.score >= score) return;
    this.pending = { meta, fireAt: this.clock + Math.max(0, delay) };
  }

  /** call right after the frame is drawn, with the WebGL canvas (race and celebration only) */
  afterRender(canvas: HTMLCanvasElement, dt: number) {
    if (this.broken) return;
    if (!this.cap && !this.startCapture(canvas)) return;
    const now = performance.now();
    this.lastTickMs = now;
    if (this.paused) {
      this.paused = false;
      for (const s of this.segs) if (s.rec.state === 'paused') s.rec.resume();
    }
    this.clock += Math.min(dt, 0.1);

    // hand the encoder a frame, 30 a second
    if (now - this.lastFrameMs >= 1000 / FPS - 4) {
      this.lastFrameMs = now;
      this.grab(canvas);
    }

    // the ring: a fresh recorder every SEG seconds; old unclaimed ones are thrown away
    if (this.clock - this.lastSegAt >= SEG) this.startSeg();
    for (const s of this.segs.slice()) {
      if (!s.claim && this.clock - s.t0 > SEG * 2 + 0.25) this.drop(s);
    }

    // a moment is due
    const p = this.pending;
    if (p && this.clock >= p.fireAt) {
      this.pending = null;
      this.claim(p.meta);
    }

    // the clip being kept ends
    const a = this.active;
    if (a?.claim && this.clock >= a.claim.tEnd) this.finish(a);
  }

  /** drop a clip that is still recording (the session ended): keep it if the moment is in it */
  cancel() {
    this.pending = null;
    const a = this.active;
    if (a?.claim && this.clock - a.claim.tMoment >= 1.2) this.finish(a);
    for (const s of this.segs.slice()) if (!s.claim) this.drop(s);
    this.active = null;
    this.lastSegAt = -Infinity;
    clearInterval(this.watchdog);
    this.watchdog = 0;
    this.paused = false;
    // posters are made once the racing stops (a still from the clip itself)
    setTimeout(() => this.makePosters(), 1500);
  }

  // ------------------------------------------------------------------ capture

  private startCapture(canvas: HTMLCanvasElement): boolean {
    if (this.codec === undefined) {
      this.codec = null;
      try {
        if (typeof MediaRecorder !== 'undefined') this.codec = CODECS.find((c) => MediaRecorder.isTypeSupported(c.mime)) ?? null;
      } catch {
        this.codec = null;
      }
    }
    if (!this.codec || !canvas.width) {
      this.broken = !this.codec;
      return false;
    }
    // 1080p when the game renders that big and the encoder is hardware; 720p otherwise
    // (540p for the software encoders, which cost a whole CPU core at 720p)
    const H = !this.codec.hw ? 540 : canvas.height >= 1000 ? 1080 : 720;
    const W = Math.round((H * 16) / 9 / 2) * 2;
    const cap = document.createElement('canvas');
    cap.width = W;
    cap.height = H;
    const ctx = cap.getContext('2d', { alpha: false });
    if (!ctx) {
      this.broken = true;
      return false;
    }
    // plain bilinear: the high-quality filter costs GPU time every captured frame
    ctx.imageSmoothingQuality = 'low';
    try {
      this.stream = cap.captureStream(0);
      this.track = this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    } catch {
      this.broken = true;
      return false;
    }
    this.cap = cap;
    this.capCtx = ctx;
    return true;
  }

  /** copy the game canvas (cover-fit into 16:9) into the capture canvas and push the frame */
  private grab(canvas: HTMLCanvasElement) {
    const cap = this.cap!, g = this.capCtx!;
    const W = cap.width, H = cap.height;
    const ar = canvas.width / canvas.height;
    let sw = canvas.width, sh = canvas.height, sx = 0, sy = 0;
    if (ar > W / H) {
      sw = canvas.height * (W / H);
      sx = (canvas.width - sw) / 2;
    } else {
      sh = canvas.width / (W / H);
      sy = (canvas.height - sh) / 2;
    }
    try {
      g.drawImage(canvas, sx, sy, sw, sh, 0, 0, W, H);
      this.track?.requestFrame();
    } catch {
      /* canvas not ready */
    }
  }

  private startSeg() {
    if (!this.stream || !this.codec) return;
    this.lastSegAt = this.clock;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, { mimeType: this.codec.mime, videoBitsPerSecond: this.cap!.height >= 1080 ? 12e6 : this.cap!.height >= 720 ? 8e6 : 4e6 });
    } catch {
      this.broken = true;
      return;
    }
    const s: Seg = { rec, chunks: [], t0: this.clock, claim: null };
    rec.ondataavailable = (e) => {
      if (e.data.size) s.chunks.push(e.data);
    };
    rec.onerror = () => this.drop(s);
    try {
      rec.start();
    } catch {
      this.broken = true;
      return;
    }
    this.segs.push(s);
    // pause the recorders when the game stops drawing race frames (pause menu, flashback)
    if (!this.watchdog)
      this.watchdog = window.setInterval(() => {
        if (this.paused || performance.now() - this.lastTickMs < 180) return;
        this.paused = true;
        for (const x of this.segs) if (x.rec.state === 'recording') x.rec.pause();
      }, 120);
  }

  private drop(s: Seg) {
    const i = this.segs.indexOf(s);
    if (i >= 0) this.segs.splice(i, 1);
    if (this.active === s) this.active = null;
    s.rec.ondataavailable = null;
    s.chunks.length = 0;
    if (s.rec.state !== 'inactive') stopLater(s.rec);
  }

  private claim(meta: Meta) {
    const t = this.clock;
    const a = this.active;
    if (a?.claim) {
      const c = a.claim;
      if (t + POST - a.t0 <= MAX_LEN) {
        // close enough to share the clip: run on, and lead with the better moment
        c.tEnd = Math.max(c.tEnd, t + POST);
        if (meta.score > c.meta.score) {
          c.meta = meta;
          c.tMoment = t;
        }
        return;
      }
      if (meta.score <= c.meta.score) return;
      this.finish(a);
    }
    // the oldest recorder still running gives the longest run-up (SEG … 2·SEG seconds)
    let s = this.segs.filter((x) => !x.claim).sort((x, y) => x.t0 - y.t0)[0];
    if (!s) {
      this.startSeg();
      s = this.segs[this.segs.length - 1];
      if (!s) return;
    }
    s.claim = { meta, tMoment: t, tEnd: t + POST };
    this.active = s;
  }

  /** stop the kept recorder and store its clip when the file is complete */
  private finish(s: Seg) {
    const c = s.claim;
    if (this.active === s) this.active = null;
    const i = this.segs.indexOf(s);
    if (i >= 0) this.segs.splice(i, 1);
    if (!c) return;
    const duration = this.clock - s.t0;
    const at = c.tMoment - s.t0;
    const mime = s.rec.mimeType || this.codec?.mime || 'video/webm';
    const w = this.cap?.width ?? 0, h = this.cap?.height ?? 0;
    s.rec.onstop = () => {
      const video = new Blob(s.chunks, { type: mime.split(';')[0] });
      s.chunks.length = 0;
      // a clip that is too short or empty (the canvas wasn't ready) is not a highlight
      if (video.size < 20000 || duration < 1.5) return;
      this.store({ ...c.meta, video, poster: null, mime, width: w, height: h, duration, at });
    };
    stopLater(s.rec);
  }

  /**
   * Posters: a still of each clip at its moment, decoded from the clip itself once no
   * race is being recorded (reading pixels back from the GPU mid-race would stall a frame).
   */
  private posterBusy = false;
  private async makePosters() {
    if (this.posterBusy || this.segs.length) return;
    this.posterBusy = true;
    try {
      for (const h of this.list.slice()) {
        if (h.poster || this.segs.length) continue;
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

  // ------------------------------------------------------------------ storage

  private store(h: Highlight) {
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
    if (!this.segs.length) this.makePosters();
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

  clear() {
    for (const h of this.list) this.revoke(h.id);
    this.list = [];
    if (this.db) {
      try {
        this.db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
      } catch {
        /* ignore */
      }
    }
    this.emit();
  }
}
