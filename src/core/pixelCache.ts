/**
 * Generated images kept between visits: the eleven liveries (~1.3 s of per-texel painting) and
 * the grandstand fan atlas (~1.3 s of offscreen WebGL) are the same every load of a given build,
 * so the first visit stores them in IndexedDB as PNGs and later boots draw them straight back.
 *
 * Keys carry the build id, so a new deploy repaints everything once and sweeps the old entries.
 * Off in the dev server (source edits would be masked by stale pixels) unless the URL has ?pixcache.
 */
declare const __BUILD__: string;

const BUILD = typeof __BUILD__ === 'string' ? __BUILD__ : 'dev';
const DB = 'apex-pixels';
const STORE = 'img';
const enabled = typeof indexedDB !== 'undefined' && typeof createImageBitmap === 'function' && (!import.meta.env.DEV || /[?&]pixcache\b/.test(location.search));

const bitmaps = new Map<string, ImageBitmap>();
let dbp: Promise<IDBDatabase | null> | null = null;
let loaded: Promise<void> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (!dbp)
    dbp = new Promise((res) => {
      try {
        const rq = indexedDB.open(DB, 1);
        rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
        rq.onsuccess = () => res(rq.result);
        rq.onerror = rq.onblocked = () => res(null);
      } catch {
        res(null);
      }
    });
  return dbp;
}

/** loads (and decodes, off the main thread) everything stored for this build; sweeps other builds */
export function preloadPixels(): Promise<void> {
  if (!enabled) return Promise.resolve();
  if (!loaded)
    loaded = (async () => {
      const d = await db();
      if (!d) return;
      const rows = await new Promise<{ keys: IDBValidKey[]; vals: Blob[] }>((res) => {
        const tx = d.transaction(STORE, 'readonly');
        const st = tx.objectStore(STORE);
        const out = { keys: [] as IDBValidKey[], vals: [] as Blob[] };
        const k = st.getAllKeys();
        const v = st.getAll();
        tx.oncomplete = () => res({ keys: k.result ?? [], vals: v.result ?? [] });
        tx.onerror = tx.onabort = () => res(out);
      });
      const stale: IDBValidKey[] = [];
      const jobs: Promise<void>[] = [];
      rows.keys.forEach((key, i) => {
        const s = String(key);
        if (!s.startsWith(BUILD + '|')) {
          stale.push(key);
          return;
        }
        jobs.push(
          createImageBitmap(rows.vals[i], { premultiplyAlpha: 'default', colorSpaceConversion: 'none' }).then(
            (b) => void bitmaps.set(s.slice(BUILD.length + 1), b),
            () => void stale.push(key),
          ),
        );
      });
      await Promise.all(jobs);
      if (stale.length) {
        const tx = d.transaction(STORE, 'readwrite');
        for (const k of stale) tx.objectStore(STORE).delete(k);
      }
    })().catch(() => undefined);
  return loaded;
}

/** draws a stored image into `into` (sized to match); false when there isn't one */
export function restorePixels(key: string, into: HTMLCanvasElement): boolean {
  const b = bitmaps.get(key);
  if (!b || b.width !== into.width || b.height !== into.height) return false;
  const g = into.getContext('2d')!;
  g.clearRect(0, 0, into.width, into.height);
  g.drawImage(b, 0, 0);
  b.close();
  bitmaps.delete(key);
  return true;
}

/** stores a finished canvas for the next visit (encoded when the page is idle) */
export function keepPixels(key: string, from: HTMLCanvasElement) {
  if (!enabled) return;
  const later = (f: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(f, { timeout: 8000 }) : setTimeout(f, 3000));
  later(() =>
    from.toBlob((blob) => {
      if (!blob) return;
      void db().then((d) => {
        if (!d) return;
        try {
          d.transaction(STORE, 'readwrite').objectStore(STORE).put(blob, `${BUILD}|${key}`);
        } catch {
          /* quota / private mode: the next visit paints again */
        }
      });
    }, 'image/png'),
  );
}

/** a short stable hash for cache keys */
export function pixelKey(...parts: unknown[]): string {
  const s = JSON.stringify(parts);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h.toString(36);
}
