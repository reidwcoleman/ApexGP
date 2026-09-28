/**
 * The loading-screen key art (public/loading, made by `python3 tools/steam_capsules.py loading`
 * from in-game frames): 1920×1080, the wordmark baked in at the left. The boot loader (index.html)
 * rotates through BOOT_ART; a circuit switch shows the destination's own picture.
 */
export const BOOT_ART = ['yas_chase', 'suzuka_onboard', 'zandvoort_sunset', 'spa_rain', 'interlagos_rain', 'suzuka_dusk', 'hungaroring_golden', 'melbourne_golden', 'silverstone_drizzle', 'mexico_golden', 'monza_sunset', 'monza_rain'];

const BY_TRACK: Record<string, string[]> = {
  yasmarina: ['yas_chase'],
  suzuka: ['suzuka_onboard', 'suzuka_dusk'],
  zandvoort: ['zandvoort_sunset'],
  spa: ['spa_rain'],
  interlagos: ['interlagos_rain'],
  hungaroring: ['hungaroring_golden'],
  melbourne: ['melbourne_golden'],
  silverstone: ['silverstone_drizzle'],
  mexico: ['mexico_golden'],
  monza: ['monza_sunset', 'monza_rain'],
  sakhir: ['sakhir_night'],
  montreal: ['montreal_sunset'],
};

/** the picture for a trip to this circuit (its own, else one from the rotation) */
export function artFor(track: string): string {
  const list = BY_TRACK[track] ?? BOOT_ART;
  return `${import.meta.env.BASE_URL}loading/${list[Math.floor(Math.random() * list.length)]}.webp`;
}
