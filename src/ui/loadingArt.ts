/**
 * The loading-screen key art (public/loading, made by `python3 tools/steam_capsules.py loading`
 * from in-game frames): 1920×1080, the wordmark baked in at the left. The boot loader (index.html)
 * rotates through BOOT_ART; a circuit switch shows the destination's own picture.
 */
export const BOOT_ART = ['monza_sunset', 'monza_rain'];

const BY_TRACK: Record<string, string[]> = {
  monza: ['monza_sunset', 'monza_rain'],
};

/** one fixed key art per circuit (the tour's card: the same picture every time it's picked) */
export function stillFor(track: string): string {
  const list = BY_TRACK[track] ?? BOOT_ART;
  return `${import.meta.env.BASE_URL}loading/${list[0]}.webp`;
}
/** the picture for a trip to this circuit (its own, else one from the rotation) */
export function artFor(track: string): string {
  const list = BY_TRACK[track] ?? BOOT_ART;
  return `${import.meta.env.BASE_URL}loading/${list[Math.floor(Math.random() * list.length)]}.webp`;
}
