/**
 * Your best racing moments: when something worth remembering happens (an overtake,
 * taking the lead, a fastest lap, the chequered flag, the podium) the live picture is
 * captured as a short burst of frames — a two-second clip — and kept, best first, in
 * IndexedDB. The garage plays them on its video wall; the career page lists them.
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
  /** JPEG data URLs, FRAME_DT apart */
  frames: string[];
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

export const FRAME_DT = 0.16;
const FRAMES = 14;
const KEEP = 18;
const W = 512, H = 288;

const DB = 'apexgp';
const STORE = 'highlights';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch {
      res(null);
    }
  });
}

export class Highlights {
  list: Highlight[] = [];
  readonly ready: Promise<void>;
  private db: IDBDatabase | null = null;
  private burst: { h: Highlight; t: number; delay: number } | null = null;
  private readonly grab: HTMLCanvasElement;
  private listeners: (() => void)[] = [];

  constructor() {
    this.grab = document.createElement('canvas');
    this.grab.width = W;
    this.grab.height = H;
    this.ready = this.load();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  private async load() {
    this.db = await openDb();
    if (!this.db) return;
    await new Promise<void>((res) => {
      const tx = this.db!.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        this.list = (req.result as Highlight[]).sort((a, b) => b.score - a.score || b.date - a.date);
        res();
      };
      req.onerror = () => res();
    });
    for (const f of this.listeners) f();
  }

  /** is a clip being recorded right now */
  get recording(): boolean {
    return !!this.burst;
  }

  /**
   * Something happened: start recording (after `delay` seconds, so the clip catches the
   * moment rather than the build-up). A better moment replaces one being recorded.
   */
  moment(kind: MomentKind, title: string, sub: string, score: number, track: string, delay = 0) {
    if (this.burst && this.burst.h.score >= score) return;
    this.burst = { h: { id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`, kind, title, sub, track, date: Date.now(), score, frames: [] }, t: 0, delay };
  }

  /** call right after the frame is drawn, with the WebGL canvas */
  afterRender(canvas: HTMLCanvasElement, dt: number) {
    const b = this.burst;
    if (!b) return;
    if (b.delay > 0) {
      b.delay -= dt;
      return;
    }
    b.t -= dt;
    if (b.t > 0) return;
    b.t = FRAME_DT;
    const g = this.grab.getContext('2d')!;
    // cover-fit the canvas into 16:9
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
      b.h.frames.push(this.grab.toDataURL('image/jpeg', 0.74));
    } catch {
      this.burst = null;
      return;
    }
    if (b.h.frames.length >= FRAMES) {
      this.burst = null;
      this.store(b.h);
    }
  }

  /** drop a clip that is still recording (e.g. the session ended) */
  cancel() {
    if (this.burst && this.burst.h.frames.length >= 6) this.store(this.burst.h);
    this.burst = null;
  }

  private store(h: Highlight) {
    // a blank frame (the canvas not ready) is not a highlight
    if (!h.frames.length || h.frames[0].length < 3000) return;
    this.list.push(h);
    this.list.sort((a, b) => b.score - a.score || b.date - a.date);
    const drop = this.list.splice(KEEP);
    if (this.db) {
      try {
        const tx = this.db.transaction(STORE, 'readwrite');
        const st = tx.objectStore(STORE);
        st.put(h);
        for (const d of drop) st.delete(d.id);
      } catch {
        /* storage full or unavailable: the clip lives this session */
      }
    }
    for (const f of this.listeners) f();
  }

  clear() {
    this.list = [];
    if (this.db) {
      try {
        this.db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
      } catch {
        /* ignore */
      }
    }
    for (const f of this.listeners) f();
  }
}
