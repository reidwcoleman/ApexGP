/**
 * Every circuit the player has ever opened — by the quick-race chain, by any driver-career season,
 * by any career at all — kept for good. A new season, a new career or a new team never locks a
 * circuit you've already reached again: it stays open in Quick race (and on the season map, where
 * a round you reached before can be raced any time outside the championship).
 */
const KEY = 'apexgp.unlocked.v1';

let set: Set<string> | null = null;
function load(): Set<string> {
  if (set) return set;
  set = new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) for (const id of JSON.parse(raw) as string[]) set.add(id);
  } catch {
    /* unreadable: start empty */
  }
  return set;
}

export function everUnlocked(id: string): boolean {
  return load().has(id);
}

/** record a circuit as opened (no-op if it already is) */
export function unlockForever(id: string) {
  const s = load();
  if (s.has(id)) return;
  s.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* storage unavailable: kept for this session */
  }
}
