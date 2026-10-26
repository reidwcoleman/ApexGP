/**
 * The skies you've raced under lately (kept across sessions): a rolled forecast is rolled again until
 * it's one you haven't seen recently — never the same weather and light twice in a row, nor again
 * within the last dozen or so races.
 */
const KEY = 'apexgp.skies.v1';
const KEEP = 14;

let list: string[] | null = null;
function load(): string[] {
  if (list) return list;
  try {
    const raw = localStorage.getItem(KEY);
    list = raw ? (JSON.parse(raw) as string[]).slice(0, KEEP) : [];
  } catch {
    list = [];
  }
  return list;
}

/** how recently this sky was raced: 0 = last time, 1 = the time before … (Infinity: not lately) */
export function skyAge(key: string): number {
  const i = load().indexOf(key);
  return i < 0 ? Infinity : i;
}

/** record a sky (the newest first) */
export function rememberSky(key: string) {
  const l = load().filter((k) => k !== key);
  l.unshift(key);
  list = l.slice(0, KEEP);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* this session only */
  }
}

/**
 * Roll until the result is fresh: the least recently seen of `tries` rolls (any unseen one at once).
 * `key` names a roll's sky (weather and light).
 */
export function freshest<T>(roll: () => T, key: (t: T) => string, tries = 24): T {
  let best = roll();
  let bestAge = skyAge(key(best));
  for (let i = 1; i < tries && bestAge !== Infinity; i++) {
    const t = roll();
    const a = skyAge(key(t));
    if (a > bestAge) {
      best = t;
      bestAge = a;
    }
  }
  rememberSky(key(best));
  return best;
}
