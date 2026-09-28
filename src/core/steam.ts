/**
 * Steam achievements, through the desktop shell (desktop/preload.cjs). On the website there is no
 * shell and every call is a no-op. The ids must match the achievements set up in Steamworks
 * (Stats & Achievements) — see steam/STEAM.md for the list.
 */
interface DesktopBridge {
  achievement(id: string): void;
}
const bridge = (): DesktopBridge | null => (globalThis as { apexDesktop?: DesktopBridge }).apexDesktop ?? null;

export const ACHIEVEMENTS = {
  FIRST_RACE: 'FIRST_RACE',
  FIRST_POINTS: 'FIRST_POINTS',
  FIRST_PODIUM: 'FIRST_PODIUM',
  FIRST_WIN: 'FIRST_WIN',
  FASTEST_LAP: 'FASTEST_LAP',
  UNLOCK_5: 'UNLOCK_5',
  SEASON_OPEN: 'SEASON_OPEN',
  ALL_MEDALS: 'ALL_MEDALS',
  GRAND_SLAM: 'GRAND_SLAM',
  FULL_DEV: 'FULL_DEV',
} as const;

/** true when running as the desktop (Steam) build */
export const isDesktop = () => bridge() !== null;

export function unlockAchievement(id: string) {
  try {
    bridge()?.achievement(id);
  } catch {
    /* the shell is gone: nothing to tell */
  }
}
